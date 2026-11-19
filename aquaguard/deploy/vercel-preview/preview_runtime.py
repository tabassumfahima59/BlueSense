"""Initialize a verified, immutable SQLite seed in instance-local scratch storage."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import closing, contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


@contextmanager
def publication_lock(path: Path):
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield  # Closing the handle releases the process-level lock.


def initialize(seed: Path, expected: str, scratch: Path) -> Path:
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("Invalid packaged seed digest")
    directory = scratch / f"bluesense-phase2a-{expected}"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise RuntimeError("Invalid SQLite scratch directory")
    database = directory / "aquaguard.db"
    with publication_lock(directory / "publish.lock"):
        if database.is_symlink():
            raise RuntimeError("Invalid SQLite scratch target")
        if not database.exists():
            publish(seed, expected, database)
        if digest(database) != expected:
            raise RuntimeError("Instance SQLite copy failed checksum verification")
    return database


def publish(seed: Path, expected: str, database: Path) -> None:
    with tempfile.TemporaryDirectory(dir=database.parent, prefix=".seed-") as staging:
        candidate = Path(staging) / "candidate.db"
        with seed.open("rb") as source, candidate.open("xb") as output:
            shutil.copyfileobj(source, output)
            output.flush()
            os.fsync(output.fileno())
        if digest(candidate) != expected:
            raise RuntimeError("Packaged SQLite seed failed checksum verification")
        with closing(sqlite3.connect(candidate.as_uri() + "?mode=ro", uri=True)) as db:
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("Packaged SQLite seed failed integrity verification")
            if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("Packaged SQLite seed failed foreign-key verification")
            if db.execute("PRAGMA journal_mode").fetchone() != ("delete",):
                raise RuntimeError("Packaged SQLite seed requires a standalone journal")
        if os.name != "nt":
            candidate.chmod(0o400)
        os.replace(candidate, database)


def configure() -> None:
    if not os.getenv("CORS_ORIGINS", "").strip():
        raise ValueError("CORS_ORIGINS must specify the approved frontend HTTPS origin")
    data = ROOT / "data"
    scratch = Path("/tmp") if os.getenv("VERCEL") else Path(tempfile.gettempdir())
    seed_hash = (data / "preview-seed.sha256").read_text(encoding="ascii").strip()
    database = initialize(data / "preview-seed.db", seed_hash, scratch)
    os.environ.update(
        AQUAGUARD_ENV="production",
        PYTHON_DOTENV_DISABLED="1",
        AQUAGUARD_DB_PATH=str(database),
        AQUAGUARD_BACKUP_DIR=str(database.parent / "disabled-backups"),
        AQUAGUARD_MIGRATE_ON_STARTUP="0",
        AQUAGUARD_BOOTSTRAP_ON_STARTUP="0",
        AQUAGUARD_SCHEDULER_ENABLED="0",
        BLUESENSE_PREVIEW_READ_ONLY="1",
    )
