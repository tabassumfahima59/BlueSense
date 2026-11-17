"""Sync job registry and runner (used by the scheduler, the CLI and — in P3 — the admin endpoint).

Every run:
  1. skips when AQUAGUARD_OFFLINE is set (no outbound calls);
  2. takes the DB lease ``job:<name>`` so several API workers never run the same job at once;
  3. skips (unless forced) when the last successful run is younger than 0.9 x the job interval
     (another worker or a restart already did the work);
  4. records ``sync_runs`` (running -> success / partial / failed) with inserted / updated / skipped counts and a
     short error summary (URLs in errors are redacted by the HTTP client; secrets are never included);
  5. after a successful retrieval updates the legacy ``sources.retrieved_at`` and clears the API's table cache.
A job never raises into the scheduler: unexpected errors are rolled back and recorded as ``failed``.
Stored data is never deleted by a failed run.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from ..db import connection
from . import aquastat, grace, openmeteo
from .http import HttpClient
from .runs import RunStats, acquire_lock, finish_run, iso, last_success, new_owner, parse_iso, release_lock, start_run, utcnow

log = logging.getLogger("aquaguard.sync")
MIN_INTERVAL_FRACTION = 0.9


@dataclass(frozen=True)
class Job:
    name: str
    source_id: str
    run: Callable[..., RunStats]
    interval: Callable[[object], int]
    lease_s: int


JOBS: dict[str, Job] = {
    "forecast": Job("forecast", openmeteo.FORECAST_SOURCE, openmeteo.sync_forecast,
                    lambda s: s.sync_forecast_minutes * 60, 900),
    "archive": Job("archive", openmeteo.ARCHIVE_SOURCE, openmeteo.sync_archive,
                   lambda s: s.sync_archive_hours * 3600, 900),
    "aquastat": Job("aquastat", aquastat.SOURCE, aquastat.sync_aquastat, lambda s: s.sync_aquastat_days * 86400, 900),
    "grace": Job("grace", grace.SOURCE, grace.sync_grace, lambda s: s.sync_grace_hours * 3600, 3600),
}


def interval_seconds(job: Job, settings) -> int:
    return int(settings.sync_interval_override_s or job.interval(settings))


@dataclass
class JobResult:
    job: str
    status: str  # success | partial | failed | skipped | locked
    run_id: int | None = None
    stats: RunStats = field(default_factory=RunStats)
    reason: str | None = None

    def as_dict(self) -> dict:
        return {"job": self.job, "status": self.status, "run_id": self.run_id, "inserted": self.stats.inserted,
                "updated": self.stats.updated, "skipped": self.stats.skipped, "ok_units": self.stats.ok,
                "errors": self.stats.errors[:5], "reason": self.reason}


def _touch_legacy_source(conn, source_id: str, when: str) -> None:
    conn.execute("INSERT INTO sources (id, retrieved_at, details_json) VALUES (?, ?, NULL) "
                 "ON CONFLICT(id) DO UPDATE SET retrieved_at = excluded.retrieved_at", (source_id, when))


def _clear_api_cache(tables: bool) -> None:
    from ..services import catalog, data_access

    catalog.clear()  # source status depends on sync_runs: always recompute after a run
    if tables:
        data_access.clear_cache()


def _evaluate_alerts(conn, now) -> None:
    """Re-evaluate the alert rules after a run (P3). An alert-engine error never fails the sync job."""
    from ..services import alert_engine

    try:
        counts = alert_engine.evaluate(conn, now=now)
        log.info("alerts evaluated: %s", counts)
    except Exception as exc:  # noqa: BLE001
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        log.error("alert evaluation failed with %s", type(exc).__name__)


def _run_inference(conn, now) -> None:
    """M5: after new reanalysis months arrive, issue predictions with the stored models (never trains). An inference
    error never fails the sync job; the API keeps serving the last stored prediction or the artifact."""
    from ..services import inference

    try:
        out = inference.run(conn, now=now)
        log.info("inference after archive sync: %s, inserted %d", out["status"], out["inserted"])
    except Exception as exc:  # noqa: BLE001
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        log.error("inference failed with %s", type(exc).__name__)


def run_job(name: str, *, settings=None, client: HttpClient | None = None, force: bool = False,
            now: datetime | None = None, owner: str | None = None) -> JobResult:
    if settings is None:
        from ..settings import get_settings

        settings = get_settings()
    job = JOBS[name]
    if settings.offline:
        return JobResult(name, "skipped", reason="AQUAGUARD_OFFLINE is set")
    owner = owner or new_owner()
    lock = f"job:{name}"
    conn = connection.connect(settings.db_path)
    try:
        if not acquire_lock(conn, lock, owner, job.lease_s, now=now):
            return JobResult(name, "locked", reason="another worker holds the lease")
        try:
            if not force:
                ok = last_success(conn, job.source_id, name)
                when = parse_iso(ok["finished_at"]) if ok else None
                if when and ((now or utcnow()) - when).total_seconds() < MIN_INTERVAL_FRACTION * interval_seconds(
                        job, settings):
                    return JobResult(name, "skipped", reason=f"last success at {ok['finished_at']}")
            run_id = start_run(conn, job.source_id, name, now=now)
            stats = RunStats()
            own_client = client is None
            http = client or HttpClient.from_settings(settings)
            try:
                stats = job.run(conn, http, settings, now=now)
                status = stats.outcome()
            except Exception as exc:  # never let one job crash the scheduler; nothing stored is deleted
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                stats.errors.append(f"{type(exc).__name__}: {str(exc).splitlines()[0][:180] if str(exc) else ''}")
                status = "failed"
                log.error("sync job %s failed with %s", name, type(exc).__name__)
            finally:
                if own_client:
                    http.close()
            if status in ("success", "partial") and name == "archive":
                # before finish_run (other processes invalidate their caches on the run's finished_at) and before
                # the alerts, so the predicted-dryness rule sees the new predictions
                _run_inference(conn, now)
            finished = now or utcnow()
            finish_run(conn, run_id, status, stats, now=finished)
            if status in ("success", "partial") and stats.retrieved:
                _touch_legacy_source(conn, job.source_id, iso(finished))
            if status in ("success", "partial"):
                _evaluate_alerts(conn, now)
            _clear_api_cache(tables=bool(stats.inserted or stats.updated))
            log.info("sync job %s: %s (inserted %d, updated %d, skipped %d, errors %d)", name, status, stats.inserted,
                     stats.updated, stats.skipped, len(stats.errors))
            return JobResult(name, status, run_id, stats)
        finally:
            release_lock(conn, lock, owner, now=now)
    finally:
        conn.close()
