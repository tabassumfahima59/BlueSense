"""Documentation RAG: section-based contextual chunking, the committed index, BM25 + cosine hybrid search, the
keyword-only fallback when the query cannot be embedded, the Gemini embedding client (faked transport) and the
Copilot's search_docs tool. No test calls a real API (conftest blanks GEMINI_API_KEY)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import numpy as np
import pytest

from app.db import connection
from app.rag import chunking, search
from app.rag.chunking import Chunk, chunk_markdown
from app.rag.embeddings import EMBED_DIM, EMBED_MODEL, EmbeddingError, embed_texts
from app.services import copilot
from app.settings import get_settings

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_docs_index  # noqa: E402

DOC = """# Guide

Intro paragraph.

## 1. Water balance {#wb}

Supply minus demand.

### Stress ratio

Demand / supply.

```
# not a heading inside code
x = 1
```

## Empty parent

### Child

Child text.
"""


# ---------------------------------------------------------------- chunking

def test_chunks_follow_headings_with_title_and_section_path():
    chunks = chunk_markdown(DOC, "GUIDE.md")
    assert [c.section for c in chunks] == ["Introduction", "1. Water balance", "1. Water balance > Stress ratio",
                                           "Empty parent > Child"]
    assert all(c.doc == "GUIDE.md" and c.doc_title == "Guide" for c in chunks)
    stress = chunks[2]
    assert "# not a heading inside code" in stress.text  # a '#' line inside a code fence is not a heading
    assert stress.contextual_text.startswith("Document: Guide (GUIDE.md)\nSection: 1. Water balance > Stress ratio\n")
    assert stress.context == "Guide > 1. Water balance > Stress ratio"
    assert len({c.id for c in chunks}) == len(chunks)


def test_long_sections_are_split_into_numbered_parts_and_tables_keep_their_header():
    rows = "\n".join(f"| A-{i:02d} | assumption number {i} with some explanatory words |" for i in range(60))
    md = f"# T\n\n## Table\n\n| ID | Assumption |\n|---|---|\n{rows}\n"
    chunks = chunk_markdown(md, "T.md", max_chars=600)
    assert len(chunks) > 3
    n = len(chunks)
    assert [c.section for c in chunks] == [f"Table (part {i}/{n})" for i in range(1, n + 1)]
    for c in chunks:
        assert len(c.text) <= 600
        assert c.text.startswith("| ID | Assumption |\n|---|---|\n")
    body = "\n".join(c.text for c in chunks)
    assert all(f"| A-{i:02d} |" in body for i in range(60))  # nothing is lost


def test_knowledge_base_documents_are_all_chunked_within_the_size_limit():
    chunks = build_docs_index.build_chunks()
    assert {c.doc for c in chunks} == set(chunking.DOCS) == {"METHODS.md", "DATA_SOURCES.md", "MODEL_CARD.md",
                                                             "LIMITATIONS.md", "ASSUMPTIONS.md"}
    assert all(0 < len(c.text) <= chunking.MAX_CHARS for c in chunks)
    assert len({len(c.text) for c in chunks}) > 10  # variable, section-based sizes


# ---------------------------------------------------------------- committed index

def test_committed_index_matches_the_documents_and_has_one_normalized_vector_per_chunk():
    data = json.loads(search.INDEX_FILE.read_text(encoding="utf-8"))
    assert data["sources"] == build_docs_index.source_hashes(), "docs changed: run backend/scripts/build_docs_index.py"
    assert data["embeddingModel"] == EMBED_MODEL and data["dimensions"] == EMBED_DIM
    assert [Chunk(**c) for c in data["chunks"]] == build_docs_index.build_chunks()
    emb = np.load(search.EMBEDDINGS_FILE, allow_pickle=False)
    assert emb.shape == (len(data["chunks"]), EMBED_DIM) and emb.dtype == np.float32
    assert np.allclose(np.linalg.norm(emb, axis=1), 1.0, atol=1e-3)
    idx = search.DocIndex.load()
    assert idx.embeddings is not None and idx.model == EMBED_MODEL


# ---------------------------------------------------------------- hybrid search and keyword fallback

def _tiny_index():
    chunks = [Chunk("a#1", "A.md", "A", "Rain", "rainfall rainfall monsoon totals"),
              Chunk("b#1", "B.md", "B", "Model", "random forest forecast accuracy"),
              Chunk("c#1", "C.md", "C", "Soil", "soil moisture layers")]
    emb = np.eye(3, 4, dtype=np.float32)  # chunk i points along axis i
    return search.DocIndex(chunks, emb, EMBED_MODEL)


def test_bm25_ranks_keyword_matches_and_ignores_stopwords():
    bm = search.BM25(["the rainfall in dhaka", "soil moisture", "rainfall rainfall totals"])
    s = bm.scores("what is the rainfall")
    assert s[1] == 0 and s[2] > s[0] > 0
    assert "fao" in search.tokenize("FAO-56 method") and "fao-56" in search.tokenize("FAO-56 method")


def test_hybrid_search_combines_cosine_and_bm25():
    idx = _tiny_index()
    # the query words match chunk A, but its embedding points at chunk B
    res = idx.search("rainfall totals", k=3, embed_query=lambda q: np.array([0, 1, 0, 0], dtype=np.float32))
    assert res.retrieval == "hybrid" and res.fallback_reason is None
    by_id = {h.chunk.id: h for h in res.hits}
    assert by_id["a#1"].keyword == 1.0 and by_id["a#1"].semantic == 0.0
    assert by_id["b#1"].semantic == 1.0 and by_id["b#1"].keyword == 0.0
    assert by_id["b#1"].score == pytest.approx(search.SEMANTIC_WEIGHT)
    assert by_id["a#1"].score == pytest.approx(1 - search.SEMANTIC_WEIGHT)
    assert res.hits[0].chunk.id == "b#1"  # semantic weight 0.6 > keyword weight 0.4


def test_real_index_hybrid_search_finds_the_section_whose_vector_matches():
    idx = search.DocIndex.load()
    target = next(i for i, c in enumerate(idx.chunks) if c.doc == "MODEL_CARD.md" and c.section == "Test-period metrics")
    res = idx.search("test period metrics", embed_query=lambda q: idx.embeddings[target])
    assert res.retrieval == "hybrid" and res.hits[0].chunk is idx.chunks[target]


@pytest.mark.parametrize("failure", [EmbeddingError("Gemini embedding HTTP 503 UNAVAILABLE"),
                                     EmbeddingError("Gemini embedding HTTP 429 RESOURCE_EXHAUSTED"),
                                     TimeoutError("slow")])
def test_failed_query_embedding_falls_back_to_keyword_search(failure):
    def broken(q):
        raise failure

    res = search.DocIndex.load().search("FAO-56 crop coefficient irrigation", embed_query=broken)
    assert res.retrieval == "keyword" and res.fallback_reason
    assert res.hits and res.hits[0].chunk.doc == "METHODS.md" and "FAO-56" in res.hits[0].chunk.section
    assert all(h.semantic is None for h in res.hits)


def test_keyword_only_without_api_key_or_embeddings():
    assert search.gemini_query_embedder() is None  # the test environment has no GEMINI_API_KEY
    res = search.search_docs("GRACE terrestrial water storage resolution")
    assert res.retrieval == "keyword" and res.hits
    idx = _tiny_index()
    no_vectors = search.DocIndex(idx.chunks, None)
    res = no_vectors.search("soil", embed_query=lambda q: pytest.fail("must not embed without index vectors"))
    assert res.retrieval == "keyword" and res.hits[0].chunk.id == "c#1"
    assert search.DocIndex(idx.chunks, None).search("zzzz unknown").hits == []


# ---------------------------------------------------------------- Gemini embedding client (fake transport)

def test_embed_texts_batches_requests_and_normalizes_vectors():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append((request, body))
        return httpx.Response(200, json={"embeddings": [{"values": [3.0, 4.0] + [0.0] * (EMBED_DIM - 2)}
                                                        for _ in body["requests"]]})

    out = embed_texts([f"t{i}" for i in range(150)], "secret-key", transport=httpx.MockTransport(handler))
    assert out.shape == (150, EMBED_DIM) and np.allclose(out[:, :2], [0.6, 0.8])
    assert [len(b["requests"]) for _, b in seen] == [100, 50]  # batchEmbedContents, 100 per call
    req, body = seen[0]
    assert str(req.url).endswith(f"/models/{EMBED_MODEL}:batchEmbedContents")
    assert req.headers["x-goog-api-key"] == "secret-key" and "secret-key" not in str(req.url)
    assert body["requests"][0] == {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": "t0"}]},
                                   "outputDimensionality": EMBED_DIM}


@pytest.mark.parametrize("response", [httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}}),
                                      httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED"}}),
                                      httpx.Response(200, json={"embeddings": []}),
                                      httpx.Response(200, text="not json")])
def test_embedding_errors_raise_embedding_error_without_the_key(response):
    with pytest.raises(EmbeddingError) as e:
        embed_texts(["q"], "secret-key", transport=httpx.MockTransport(lambda r: response))
    assert "secret-key" not in str(e.value)


def test_embedding_transport_failure_is_an_embedding_error():
    def boom(request):
        raise httpx.ConnectError("down")

    with pytest.raises(EmbeddingError):
        embed_texts(["q"], "k", transport=httpx.MockTransport(boom))


# ---------------------------------------------------------------- the Copilot tool

def test_search_docs_tool_returns_cited_sections():
    conn = connection.connect(get_settings().db_path, read_only=True)
    out, is_error, summary = copilot.run_tool(conn, "search_docs", {"query": "How is FAO-56 irrigation calculated?"})
    conn.close()
    assert not is_error
    data = json.loads(out)
    assert data["aquaguardModule"] == "Documentation" and data["retrieval"] == "keyword"
    assert 1 <= len(data["results"]) <= 4
    top = data["results"][0]
    assert top["document"] == "METHODS.md" and "FAO-56" in top["section"]
    assert top["cite"] == f"[{top['document']} > {top['section']}]" and top["text"]
    assert summary["status"] == "done" and summary["module"] == "Documentation"
    assert summary["dataKind"] == ["documentation"] and "METHODS.md" in summary["source"]
    assert len(out) <= copilot.MAX_TOOL_RESULT_CHARS


@pytest.mark.parametrize("inp", [{}, {"query": ""}, {"query": "x" * 301}, {"query": "rain", "k": 50}])
def test_search_docs_input_is_validated(inp):
    out, is_error, _ = copilot.run_tool(None, "search_docs", inp)
    assert is_error and "INVALID_INPUT" in out


def test_search_docs_is_offered_to_the_model_and_named_in_the_system_prompt():
    spec = next(s for s in copilot.tool_specs() if s.name == "search_docs")
    assert spec.schema["required"] == ["query"] and spec.schema["additionalProperties"] is False
    assert "search_docs" in copilot.SYSTEM_PROMPT and "cite" in copilot.SYSTEM_PROMPT
