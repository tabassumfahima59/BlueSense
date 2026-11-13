"""Versioned SQL migration runner for AquaGuard's SQLite database.

    python -m app.db.migrate                 # from backend/: apply pending migrations to the configured DB
    python -m app.db.migrate --status        # list applied / pending migrations
    python -m app.db.migrate --db PATH       # another database file
    python -m app.db.migrate --no-backup     # skip the pre-migration backup (tests only)

Guarantees
* Migrations live in ``backend/app/db/migrations/NNNN_name.sql`` and are applied in version order.
* History is kept in ``schema_migrations`` (version, name, checksum, applied_at, execution_ms).
* Each migration runs in a single ``BEGIN IMMEDIATE`` transaction; any error rolls it back completely and stops.
* Idempotent: applied versions are skipped (re-checked inside the write lock, so concurrent workers are safe).
* Checksums of applied migrations are verified; an edited applied migration stops the run.
* Destructive statements (DROP …, DELETE, ALTER … DROP / RENAME, VACUUM, PRAGMA journal_mode/foreign_keys) are
  rejected before anything executes.
* ``PRAGMA foreign_key_check`` must be clean before a migration commits.
* Before pending migrations run on a database that already holds tables, a backup is written with the SQLite
  online-backup API and verified (integrity_check, identical table list and row counts).
* WAL is configured outside any transaction, before migrations (``connection.ensure_wal``).
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import connection

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
FILENAME_RE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")
FORBIDDEN = [
    (re.compile(r"\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b", re.I), "DROP statements are not allowed"),
    (re.compile(r"\bALTER\s+TABLE\b.*\b(DROP|RENAME)\b", re.I | re.S), "ALTER TABLE … DROP/RENAME is not allowed"),
    (re.compile(r"^\s*DELETE\b", re.I), "DELETE is not allowed in migrations"),
    (re.compile(r"^\s*VACUUM\b", re.I), "VACUUM is not allowed in migrations"),
    (re.compile(r"\bPRAGMA\s+(journal_mode|foreign_keys)\b", re.I),
     "journal_mode/foreign_keys are configured by the connection layer, not migrations"),
]
HISTORY_DDL = """CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  execution_ms INTEGER NOT NULL
)"""


class MigrationError(RuntimeError):
    """A migration failed and was rolled back."""


class MigrationIntegrityError(RuntimeError):
    """Migration files or history are inconsistent (edited, duplicated or forbidden content)."""


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: Path
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


@dataclass
class MigrationReport:
    db_path: str
    applied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    backup_path: str | None = None
    journal_mode: str | None = None


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------- discovery and parsing

def discover(migrations_dir: Path = MIGRATIONS_DIR) -> list[Migration]:
    found: dict[str, Migration] = {}
    for path in sorted(Path(migrations_dir).glob("*.sql")):
        m = FILENAME_RE.match(path.name)
        if not m:
            raise MigrationIntegrityError(f"unexpected file name in migrations dir: {path.name}")
        version, name = m.groups()
        if version in found:
            raise MigrationIntegrityError(f"duplicate migration version {version}")
        found[version] = Migration(version, name, path, path.read_text(encoding="utf-8"))
    return [found[v] for v in sorted(found)]


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def split_statements(sql: str) -> list[str]:
    """Split a script into complete statements (handles semicolons inside strings and triggers)."""
    statements: list[str] = []
    buf = ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            stmt = buf.strip()
            if _strip_comments(stmt).strip(" \n\t;"):
                statements.append(stmt)
            buf = ""
    if _strip_comments(buf).strip():
        raise MigrationIntegrityError(f"incomplete SQL statement at end of migration: {buf.strip()[:80]!r}")
    return statements


def check_forbidden(migration: Migration) -> None:
    for stmt in split_statements(migration.sql):
        code = _strip_comments(stmt)
        for pattern, message in FORBIDDEN:
            if pattern.search(code):
                raise MigrationIntegrityError(f"{migration.path.name}: {message}: {code.strip()[:100]!r}")


# ---------------------------------------------------------------- backup

def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {n: conn.execute(f'SELECT COUNT(*) FROM "{n}"').fetchone()[0] for n in names}


def backup_database(db_path: Path, backup_dir: Path, label: str = "pre-migration") -> Path:
    """Online backup + verification. Raises if the copy is not identical in tables and row counts."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    dest = backup_dir / f"{db_path.stem}-{label}-{stamp}.db"
    src = connection.connect(db_path, read_only=True)
    dst = sqlite3.connect(str(dest))
    try:
        src.backup(dst)
    finally:
        dst.close()
    check = sqlite3.connect(str(dest))
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
        same = table_counts(check) == table_counts(src)
    finally:
        check.close()
        src.close()
    if integrity != "ok" or not same:
        raise MigrationError(f"backup verification failed for {dest} (integrity={integrity}, counts_equal={same})")
    return dest


# ---------------------------------------------------------------- runner

def _history(conn: sqlite3.Connection) -> dict[str, str]:
    return {v: c for v, c in conn.execute("SELECT version, checksum FROM schema_migrations")}


def status(db_path: Path, migrations_dir: Path = MIGRATIONS_DIR) -> list[tuple[str, str, str]]:
    conn = connection.connect(db_path)
    try:
        conn.execute(HISTORY_DDL)
        done = _history(conn)
    finally:
        conn.close()
    return [(m.version, m.name, "applied" if m.version in done else "pending") for m in discover(migrations_dir)]


def migrate(db_path: str | Path, migrations_dir: Path = MIGRATIONS_DIR, *, backup: bool = True,
            backup_dir: Path | None = None) -> MigrationReport:
    db_path = Path(db_path)
    migrations = discover(migrations_dir)
    for m in migrations:
        check_forbidden(m)
    report = MigrationReport(db_path=str(db_path))
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # 1. Read the current state without changing anything.
    conn = connection.connect(db_path)
    try:
        has_history = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").fetchone() is not None
        done = _history(conn) if has_history else {}
        has_user_tables = any(n != "schema_migrations" for n in table_counts(conn))
    finally:
        conn.close()
    known = {m.version: m for m in migrations}
    for version, checksum in done.items():
        if version in known and known[version].checksum != checksum:
            raise MigrationIntegrityError(
                f"applied migration {version} was modified after it ran (checksum mismatch); "
                "add a new migration instead of editing an applied one")
    pending = [m for m in migrations if m.version not in done]
    report.skipped = [m.version for m in migrations if m.version in done]

    # 2. Backup before the first modification of a database that holds data.
    if pending and backup and has_user_tables:
        target = backup_dir or (db_path.parent / "backups")
        report.backup_path = str(backup_database(db_path, target))

    # 3. WAL outside any transaction (idempotent), then the history table.
    report.journal_mode = connection.ensure_wal(db_path)
    if not pending:
        return report
    conn = connection.connect(db_path)
    try:
        conn.execute(HISTORY_DDL)
        for m in pending:
            started = time.perf_counter()
            conn.execute("BEGIN IMMEDIATE")
            try:
                if conn.execute("SELECT 1 FROM schema_migrations WHERE version = ?", (m.version,)).fetchone():
                    conn.execute("ROLLBACK")  # applied meanwhile by another process
                    report.skipped.append(m.version)
                    continue
                for stmt in split_statements(m.sql):
                    conn.execute(stmt)
                violations = conn.execute("PRAGMA foreign_key_check").fetchall()
                if violations:
                    raise MigrationError(f"foreign key violations after {m.path.name}: {violations[:5]}")
                conn.execute(
                    "INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_ms) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (m.version, m.name, m.checksum, utcnow(), int((time.perf_counter() - started) * 1000)))
                conn.execute("COMMIT")
                report.applied.append(m.version)
            except Exception as exc:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                if isinstance(exc, MigrationError):
                    raise
                raise MigrationError(f"migration {m.path.name} failed and was rolled back: {exc}") from exc
        return report
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    from ..settings import get_settings

    parser = argparse.ArgumentParser(description="Apply AquaGuard SQLite migrations")
    parser.add_argument("--db", type=Path, default=None, help="database file (default: settings.db_path)")
    parser.add_argument("--status", action="store_true", help="show applied/pending migrations and exit")
    parser.add_argument("--no-backup", action="store_true", help="do not back up before migrating")
    args = parser.parse_args(argv)
    settings = get_settings()
    db = args.db or settings.db_path
    if args.status:
        for version, name, state in status(db):
            print(f"{version} {name:24s} {state}")
        return 0
    rep = migrate(db, backup=not args.no_backup, backup_dir=settings.backup_dir)
    print(f"database: {rep.db_path} (journal_mode={rep.journal_mode})")
    print(f"applied: {rep.applied or 'none'}; already applied: {rep.skipped or 'none'}")
    if rep.backup_path:
        print(f"verified backup: {rep.backup_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
