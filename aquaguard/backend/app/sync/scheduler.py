"""APScheduler (BackgroundScheduler) running the sync jobs inside the API process.

* Enabled with ``AQUAGUARD_SCHEDULER_ENABLED=1`` (default off); never started when ``AQUAGUARD_OFFLINE=1``.
* One interval trigger per job (UTC), ``max_instances=1`` and ``coalesce=True`` so missed runs collapse into one,
  ``misfire_grace_time`` for short pauses. The first runs are staggered a few seconds after startup; the job's
  min-interval check skips work that another worker or a recent run already did.
* Several API workers are safe: each run takes the DB lease ``job:<name>`` (see ``jobs.run_job``).
* Free hosting that sleeps stops the scheduler; data then ages to ``stale`` and is refreshed on the next start.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from .jobs import JOBS, interval_seconds, run_job
from .runs import new_owner

log = logging.getLogger("aquaguard.scheduler")
STARTUP_DELAY_S = 5
STAGGER_S = 5
MISFIRE_GRACE_S = 300

_scheduler: BackgroundScheduler | None = None


def build_scheduler(settings, runner=run_job, start_at: datetime | None = None) -> BackgroundScheduler:
    sched = BackgroundScheduler(timezone=timezone.utc, job_defaults={
        "max_instances": 1, "coalesce": True, "misfire_grace_time": MISFIRE_GRACE_S})
    owner = new_owner()
    first = start_at or datetime.now(timezone.utc) + timedelta(seconds=STARTUP_DELAY_S)
    for i, (name, job) in enumerate(JOBS.items()):
        sched.add_job(runner, IntervalTrigger(seconds=interval_seconds(job, settings), timezone=timezone.utc),
                      args=[name], kwargs={"settings": settings, "owner": owner}, id=f"sync:{name}",
                      name=f"sync {name} ({job.source_id})", next_run_time=first + timedelta(seconds=i * STAGGER_S),
                      replace_existing=True)
    return sched


def start(settings) -> BackgroundScheduler | None:
    global _scheduler
    if not settings.scheduler_enabled:
        return None
    if settings.offline:
        log.warning("scheduler not started: AQUAGUARD_OFFLINE is set")
        return None
    if _scheduler is not None and _scheduler.running:
        return _scheduler
    _scheduler = build_scheduler(settings)
    _scheduler.start()
    log.info("scheduler started: %s", ", ".join(
        f"{name} every {interval_seconds(job, settings)}s" for name, job in JOBS.items()))
    return _scheduler


def stop() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("scheduler stopped")
    _scheduler = None
