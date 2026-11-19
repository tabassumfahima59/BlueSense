"""Gemini text embeddings over REST with httpx, like the Copilot's Gemini adapter (no Google SDK).

``gemini-embedding-2`` takes no ``taskType`` field; the retrieval task is written into the text instead, as Google's
embedding guide prescribes: documents as ``title: ... | text: ...`` and queries as
``task: search result | query: ...``. Vectors are requested at 768 dimensions (the model renormalizes truncated
outputs) and normalized again here. The API key goes only in the ``x-goog-api-key`` header.
"""
from __future__ import annotations

import httpx
import numpy as np

from ..services.llm.gemini import BASE_URL

EMBED_MODEL = "gemini-embedding-2"
EMBED_DIM = 768
BATCH_SIZE = 100  # batchEmbedContents accepts up to 100 requests per call


class EmbeddingError(Exception):
    """The embedding call failed (quota, unavailable, timeout, bad response). The message never contains the key."""


def document_text(title: str, text: str) -> str:
    return f"title: {title or 'none'} | text: {text}"


def query_text(query: str) -> str:
    return f"task: search result | query: {query}"


def _normalize(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=-1, keepdims=True)
    return m / np.where(norms == 0, 1.0, norms)


def embed_texts(texts: list[str], api_key: str, *, model: str = EMBED_MODEL, dim: int = EMBED_DIM,
                timeout_s: float = 30.0, base_url: str = BASE_URL,
                transport: httpx.BaseTransport | None = None) -> np.ndarray:
    """Embed texts with ``batchEmbedContents`` (one call per 100 texts). Returns a (n, dim) float32 array, rows
    normalized to length 1."""
    if not api_key:
        raise EmbeddingError("No Gemini API key is configured.")
    url = f"{base_url}/models/{model}:batchEmbedContents"
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    rows: list[list[float]] = []
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout_s, connect=min(5.0, timeout_s)), transport=transport) as c:
            for i in range(0, len(texts), BATCH_SIZE):
                batch = texts[i:i + BATCH_SIZE]
                body = {"requests": [{"model": f"models/{model}", "content": {"parts": [{"text": t}]},
                                      "outputDimensionality": dim} for t in batch]}
                resp = c.post(url, headers=headers, json=body)
                if resp.status_code >= 400:
                    try:
                        status = (resp.json().get("error") or {}).get("status") or ""
                    except ValueError:
                        status = ""
                    raise EmbeddingError(f"Gemini embedding HTTP {resp.status_code} {str(status)[:40]}".strip())
                embs = resp.json().get("embeddings") or []
                if len(embs) != len(batch):
                    raise EmbeddingError("Gemini embedding returned an unexpected number of vectors.")
                rows.extend(e.get("values") or [] for e in embs)
        m = np.asarray(rows, dtype=np.float32)
    except httpx.HTTPError as e:
        raise EmbeddingError(f"Gemini embedding request failed ({type(e).__name__}).") from None
    except (ValueError, AttributeError, TypeError):
        raise EmbeddingError("Gemini embedding returned an unreadable response.") from None
    if m.ndim != 2 or m.shape[1] != dim:
        raise EmbeddingError("Gemini embedding returned vectors of an unexpected size.")
    return _normalize(m)
