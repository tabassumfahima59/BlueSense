"""SQLite connection configuration (single place for PRAGMAs).

Per-connection settings: ``foreign_keys = ON`` and ``busy_timeout = 5000`` ms; ``query_only = ON`` for read-only
use. ``journal_mode = WAL`` is a database-level, persistent setting and must be changed outside any transaction,
so it lives in :func:`ensure_wal` and is called before migrations run — never inside one.

Connections use ``isolation_level=None`` (autocommit) so callers control transactions explicitly with
``BEGIN IMMEDIATE`` / ``COMMIT`` / ``ROLLBACK``.
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

BUSY_TIMEOUT_MS = 5000


def connect(path: str | Path, *, read_only: bool = False) -> sqlite3.Connection:
    """Open a configured connection. ``read_only`` blocks writes with ``PRAGMA query_only`` (works with WAL,
    unlike ``mode=ro`` URIs, which cannot create the shared-memory file)."""
    conn = sqlite3.connect(str(path), timeout=BUSY_TIMEOUT_MS / 1000, isolation_level=None, check_same_thread=False)
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys = ON")
    if read_only:
        conn.execute("PRAGMA query_only = ON")
    return conn


def ensure_wal(path: str | Path) -> str:
    """Switch the database file to WAL journal mode (idempotent). Returns the resulting mode.

    SQLite does not invoke the busy handler for a journal-mode change, so "database is locked" is returned at once
    while another connection holds a lock (e.g. several API workers migrating at startup). The switch is therefore
    retried until ``BUSY_TIMEOUT_MS``; a database already in WAL mode returns immediately."""
    deadline = time.monotonic() + BUSY_TIMEOUT_MS / 1000
    conn = sqlite3.connect(str(path), timeout=BUSY_TIMEOUT_MS / 1000, isolation_level=None)
    try:
        if conn.in_transaction:  # defensive: journal_mode cannot change inside a transaction
            raise RuntimeError("cannot change journal_mode inside a transaction")
        while True:
            try:
                mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
                if str(mode).lower() == "wal":
                    return mode
                return conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]
            except sqlite3.OperationalError as exc:
                busy = "locked" in str(exc).lower() or "busy" in str(exc).lower()
                if not busy or time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)
    finally:
        conn.close()


def pragma_state(conn: sqlite3.Connection) -> dict[str, object]:
    return {
        "journal_mode": conn.execute("PRAGMA journal_mode").fetchone()[0],
        "foreign_keys": conn.execute("PRAGMA foreign_keys").fetchone()[0],
        "busy_timeout": conn.execute("PRAGMA busy_timeout").fetchone()[0],
        "query_only": conn.execute("PRAGMA query_only").fetchone()[0],
    }
