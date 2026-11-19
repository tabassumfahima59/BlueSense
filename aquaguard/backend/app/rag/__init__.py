"""Retrieval over BlueSense's own documentation (methods, data sources, model card, limitations, assumptions).

* ``chunking``: section-based, contextual chunks from the markdown documents.
* ``index``: the committed index (chunk texts + Gemini embeddings), built offline by ``scripts/build_docs_index.py``.
* ``search``: hybrid retrieval (cosine similarity + BM25); keyword-only when the query cannot be embedded.

No vector database and no ML framework: the index is a few hundred kilobytes and is searched with NumPy.
"""
