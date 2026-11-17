"""Bootstrap seed: build the database from the committed, verified historical files when it is missing.

Used at API startup (``AQUAGUARD_BOOTSTRAP_ON_STARTUP=1``, default) for hosts whose disk starts empty. It runs the
same idempotent importer as ``python ml/build_db.py`` (migrations + ``data/processed``). Seeded rows keep their
original observation and retrieval dates, so their sources report ``stale`` until the first successful sync.
It never touches an existing database.
"""
from __future__ import annotations

import importlib
import logging
import sys

log = logging.getLogger("aquaguard.seed")


def bootstrap_if_missing(settings) -> dict | None:
    if settings.db_path.exists():
        return None
    ml_dir = settings.root / "ml"
    if not (ml_dir / "build_db.py").exists() or not (settings.data_dir / "processed").is_dir():
        log.warning("database %s is missing and the bootstrap inputs (ml/, data/processed/) are not available",
                    settings.db_path.name)
        return None
    if str(ml_dir) not in sys.path:
        sys.path.insert(0, str(ml_dir))
    build_db = importlib.import_module("build_db")
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    result = build_db.build(settings.db_path, backup=False, backup_dir=settings.backup_dir)
    log.info("bootstrap seed: database built from data/processed (%d tables)", len(result.get("after", {})))
    return result
