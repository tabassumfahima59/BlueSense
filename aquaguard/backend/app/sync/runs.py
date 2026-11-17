"""sync_runs bookkeeping, sync_state markers and the DB lease lock used by scheduled jobs."""
from __future__ import annotations

import os
import socket
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

MAX_ERROR_CHARS = 500


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@dataclass
class RunStats:
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    ok: int = 0  # units (locations, files, responses) processed and committed without error
    retrieved: int = 0  # payloads actually downloaded and parsed (a GRACE HEAD-only check retrieves nothing)

    def add(self, other: RunStats) -> None:
        self.inserted += other.inserted
        self.updated += other.updated
        self.skipped += other.skipped
        self.errors += other.errors
        self.ok += other.ok
        self.retrieved += other.retrieved

    def outcome(self) -> str:
        """success: no errors; partial: errors but some units succeeded; failed: nothing succeeded."""
        if not self.errors:
            return "success"
        return "partial" if self.ok else "failed"


# ---------------------------------------------------------------- sync_runs

def start_run(conn: sqlite3.Connection, source_id: str, job: str, location_id: str | None = None,
              now: datetime | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO sync_runs (source_id, location_id, job, started_at, status) VALUES (?, ?, ?, ?, 'running')",
        (source_id, location_id, job, iso(now or utcnow())))
    return int(cur.lastrowid)


def finish_run(conn: sqlite3.Connection, run_id: int, status: str, stats: RunStats, now: datetime | None = None) -> None:
    summary = "; ".join(stats.errors)[:MAX_ERROR_CHARS] or None
    conn.execute(
        "UPDATE sync_runs SET finished_at = ?, status = ?, inserted = ?, updated = ?, skipped = ?, error_summary = ? "
        "WHERE id = ?",
        (iso(now or utcnow()), status, stats.inserted, stats.updated, stats.skipped, summary, run_id))


def last_success(conn: sqlite3.Connection, source_id: str, job: str | None = None) -> dict | None:
    sql = ("SELECT id, job, started_at, finished_at, status FROM sync_runs WHERE source_id = ? "
           "AND status IN ('success', 'partial')")
    params: list = [source_id]
    if job:
        sql += " AND job = ?"
        params.append(job)
    row = conn.execute(sql + " ORDER BY finished_at DESC LIMIT 1", params).fetchone()
    return None if row is None else dict(zip(("id", "job", "started_at", "finished_at", "status"), row))


def last_attempt(conn: sqlite3.Connection, source_id: str) -> dict | None:
    row = conn.execute(
        "SELECT id, job, started_at, finished_at, status, error_summary FROM sync_runs WHERE source_id = ? "
        "ORDER BY started_at DESC, id DESC LIMIT 1", (source_id,)).fetchone()
    return None if row is None else dict(zip(("id", "job", "started_at", "finished_at", "status", "error_summary"), row))


# ---------------------------------------------------------------- sync_state

def get_state(conn: sqlite3.Connection, source_id: str, key: str) -> str | None:
    row = conn.execute("SELECT value FROM sync_state WHERE source_id = ? AND key = ?", (source_id, key)).fetchone()
    return None if row is None else row[0]


def set_state(conn: sqlite3.Connection, source_id: str, key: str, value: str, now: datetime | None = None) -> None:
    conn.execute(
        "INSERT INTO sync_state (source_id, key, value, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(source_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (source_id, key, value, iso(now or utcnow())))


# ---------------------------------------------------------------- lease lock

def new_owner() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def acquire_lock(conn: sqlite3.Connection, name: str, owner: str, ttl_s: int, now: datetime | None = None) -> bool:
    """Take or renew a lease. Expired leases (crashed holder) are taken over."""
    now = now or utcnow()
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT owner, expires_at FROM scheduler_lock WHERE name = ?", (name,)).fetchone()
        expires = iso(now + timedelta(seconds=ttl_s))
        if row is None:
            conn.execute("INSERT INTO scheduler_lock (name, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
                         (name, owner, iso(now), expires))
        elif row[0] == owner or (parse_iso(row[1]) or now) <= now:
            conn.execute("UPDATE scheduler_lock SET owner = ?, acquired_at = ?, expires_at = ? WHERE name = ?",
                         (owner, iso(now), expires, name))
        else:
            conn.execute("ROLLBACK")
            return False
        conn.execute("COMMIT")
        return True
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def release_lock(conn: sqlite3.Connection, name: str, owner: str, now: datetime | None = None) -> None:
    conn.execute("UPDATE scheduler_lock SET expires_at = ? WHERE name = ? AND owner = ?",
                 (iso(now or utcnow()), name, owner))
