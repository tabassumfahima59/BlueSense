"""Hybrid retrieval over the committed documentation index: cosine similarity + BM25.

* The index (``docs_index.json`` with the chunks, ``docs_embeddings.npy`` with their vectors) is built offline by
  ``scripts/build_docs_index.py``; at run time only the query is embedded (one Gemini call, short timeout, no retry).
* Score = ``SEMANTIC_WEIGHT`` x cosine (rescaled to 0-1 over the index) + ``(1 - SEMANTIC_WEIGHT)`` x BM25 (divided
  by the best BM25 score of the query).
* If the query cannot be embedded (no key, quota, 503, timeout, bad response) or the index has no usable vectors,
  the search falls back to BM25 alone and says so in ``retrieval``. Retrieval never raises because of the embedding
  service, so the Copilot keeps working.
"""
from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from .chunking import Chunk
from .embeddings import EMBED_DIM, EMBED_MODEL, EmbeddingError, embed_texts, query_text

log = logging.getLogger("aquaguard.rag")

INDEX_DIR = Path(__file__).resolve().parent
INDEX_FILE = INDEX_DIR / "docs_index.json"
EMBEDDINGS_FILE = INDEX_DIR / "docs_embeddings.npy"
SEMANTIC_WEIGHT = 0.6
QUERY_TIMEOUT_S = 8.0
K1, B = 1.2, 0.75

TOKEN = re.compile(r"[^\W_]+(?:[.\-][^\W_]+)*", re.UNICODE)
STOP = frozenset("a an and are as at be by for from has have how in is it its of on or that the this to was what "
                 "when where which who why with does do did can i you we they not no".split())


def tokenize(text: str) -> list[str]:
    out = []
    for tok in TOKEN.findall(text.lower()):
        if tok not in STOP:
            out.append(tok)
            if "-" in tok or "." in tok:  # "fao-56" also matches "fao" and "56"; "p-et0" also matches "et0"
                out.extend(t for t in re.split(r"[.\-]", tok) if t and t not in STOP)
    return out


class BM25:
    def __init__(self, docs: list[str], k1: float = K1, b: float = B):
        self.k1, self.b = k1, b
        self.tfs = [Counter(tokenize(d)) for d in docs]
        self.lens = np.array([sum(tf.values()) for tf in self.tfs], dtype=float)
        self.avg = float(self.lens.mean()) if len(self.lens) else 0.0
        df = Counter(t for tf in self.tfs for t in tf)
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query: str) -> np.ndarray:
        out = np.zeros(len(self.tfs))
        terms = [t for t in dict.fromkeys(tokenize(query)) if t in self.idf]
        for i, tf in enumerate(self.tfs):
            norm = self.k1 * (1 - self.b + self.b * self.lens[i] / (self.avg or 1.0))
            out[i] = sum(self.idf[t] * tf[t] * (self.k1 + 1) / (tf[t] + norm) for t in terms if tf[t])
        return out


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    score: float
    semantic: float | None
    keyword: float


@dataclass(frozen=True)
class SearchResult:
    retrieval: str           # "hybrid" or "keyword"
    fallback_reason: str | None
    hits: list[Hit]


class DocIndex:
    def __init__(self, chunks: list[Chunk], embeddings: np.ndarray | None, model: str | None = None):
        self.chunks = chunks
        ok = embeddings is not None and embeddings.ndim == 2 and embeddings.shape[0] == len(chunks)
        self.embeddings = embeddings.astype(np.float32) if ok else None
        self.model = model
        self.bm25 = BM25([c.contextual_text for c in chunks])

    @classmethod
    def load(cls, index_file: Path = INDEX_FILE, embeddings_file: Path = EMBEDDINGS_FILE) -> DocIndex:
        data = json.loads(index_file.read_text(encoding="utf-8"))
        chunks = [Chunk(**c) for c in data["chunks"]]
        emb = None
        if embeddings_file.exists():
            emb = np.load(embeddings_file, allow_pickle=False)
            if data.get("embeddingModel") != EMBED_MODEL or emb.shape[-1] != EMBED_DIM:
                log.warning("docs index embeddings do not match %s/%d; keyword search only", EMBED_MODEL, EMBED_DIM)
                emb = None
        return cls(chunks, emb, data.get("embeddingModel"))

    def search(self, query: str, k: int = 4,
               embed_query: Callable[[str], np.ndarray] | None = None) -> SearchResult:
        kw = self.bm25.scores(query)
        kw_norm = kw / kw.max() if kw.max() > 0 else kw
        sem = None
        reason = None
        if self.embeddings is None:
            reason = "the index has no embeddings"
        elif embed_query is None:
            reason = "no embedding service is configured"
        else:
            try:
                q = np.asarray(embed_query(query), dtype=np.float32).reshape(-1)
                if q.shape[0] != self.embeddings.shape[1]:
                    raise EmbeddingError("query vector has the wrong size")
                cos = self.embeddings @ (q / (np.linalg.norm(q) or 1.0))
                lo, hi = float(cos.min()), float(cos.max())
                sem = (cos - lo) / (hi - lo) if hi > lo else np.zeros_like(cos)
            except Exception as e:  # noqa: BLE001 - any embedding failure falls back to keyword search
                reason = str(e) if isinstance(e, EmbeddingError) else f"embedding failed ({type(e).__name__})"
                log.warning("docs search: query embedding failed (%s); keyword search only", reason)
        if sem is not None:
            score = SEMANTIC_WEIGHT * sem + (1 - SEMANTIC_WEIGHT) * kw_norm
        else:
            score = kw_norm
        order = np.argsort(-score, kind="stable")
        hits = [Hit(self.chunks[i], float(score[i]), float(sem[i]) if sem is not None else None, float(kw_norm[i]))
                for i in order[:k] if score[i] > 0]
        return SearchResult("hybrid" if sem is not None else "keyword", reason, hits)


@lru_cache(maxsize=1)
def default_index() -> DocIndex:
    return DocIndex.load()


def gemini_query_embedder() -> Callable[[str], np.ndarray] | None:
    """Embed a query with the server's Gemini key, or None when no key is configured."""
    from ..settings import get_settings

    key = get_settings().gemini_api_key
    secret = key.get_secret_value().strip() if key else ""
    if not secret:
        return None
    return lambda q: embed_texts([query_text(q)], secret, timeout_s=QUERY_TIMEOUT_S)[0]


def search_docs(query: str, k: int = 4, index: DocIndex | None = None,
                embed_query: Callable[[str], np.ndarray] | None = None) -> SearchResult:
    idx = index or default_index()
    return idx.search(query, k, embed_query if embed_query is not None else gemini_query_embedder())
