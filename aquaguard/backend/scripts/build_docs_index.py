"""Build the Copilot's documentation index once, offline: chunk the docs and embed every chunk with Gemini.

    python backend/scripts/build_docs_index.py            # needs GEMINI_API_KEY (environment or backend/.env)
    python backend/scripts/build_docs_index.py --check    # only report whether the committed index is current

Writes ``backend/app/rag/docs_index.json`` (chunks, model, dimension, source hashes) and
``backend/app/rag/docs_embeddings.npy`` (float32, one normalized row per chunk). All chunks are embedded with
``batchEmbedContents`` (up to 100 chunks per call), so a full rebuild normally costs a single API request.
Re-run after editing any of the indexed documents; the test suite fails while the index is out of date.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import numpy as np  # noqa: E402

from app.rag.chunking import DOCS, MAX_CHARS, chunk_markdown  # noqa: E402
from app.rag.embeddings import EMBED_DIM, EMBED_MODEL, document_text, embed_texts  # noqa: E402
from app.rag.search import EMBEDDINGS_FILE, INDEX_FILE  # noqa: E402

DOCS_DIR = BACKEND.parent / "docs"


def source_hashes() -> dict[str, str]:
    """SHA-256 of each document with line endings normalized to LF, so Windows (CRLF) and Linux checkouts agree."""
    return {d: hashlib.sha256((DOCS_DIR / d).read_bytes().replace(b"\r\n", b"\n")).hexdigest() for d in DOCS}


def build_chunks():
    chunks = []
    for d in DOCS:
        chunks.extend(chunk_markdown((DOCS_DIR / d).read_text(encoding="utf-8"), d))
    return chunks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if the committed index is out of date")
    args = ap.parse_args()

    if args.check:
        current = json.loads(INDEX_FILE.read_text(encoding="utf-8")).get("sources") if INDEX_FILE.exists() else None
        ok = current == source_hashes()
        print("docs index is current" if ok else "docs index is OUT OF DATE: run build_docs_index.py")
        return 0 if ok else 1

    from app.settings import get_settings  # loads backend/.env like the API does

    key = get_settings().gemini_api_key
    secret = key.get_secret_value().strip() if key else ""
    if not secret:
        print("GEMINI_API_KEY is not set", file=sys.stderr)
        return 2
    chunks = build_chunks()
    vectors = embed_texts([document_text(c.context, c.text) for c in chunks], secret, timeout_s=120.0)
    INDEX_FILE.write_text(json.dumps({
        "builtAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "embeddingModel": EMBED_MODEL,
        "dimensions": EMBED_DIM,
        "maxChunkChars": MAX_CHARS,
        "sources": source_hashes(),
        "chunks": [c.to_dict() for c in chunks],
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    np.save(EMBEDDINGS_FILE, vectors.astype(np.float32), allow_pickle=False)
    print(f"{len(chunks)} chunks from {len(DOCS)} documents, {vectors.shape[1]}-dim {EMBED_MODEL} embeddings "
          f"({(len(chunks) + 99) // 100} batch call(s)) -> {INDEX_FILE.name}, {EMBEDDINGS_FILE.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
