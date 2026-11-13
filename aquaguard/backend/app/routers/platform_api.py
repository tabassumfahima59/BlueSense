"""P3 platform endpoints: alert read marks, search, data-source status, manual refresh and admin sync.

* ``POST /api/refresh`` is public: it never replaces the scheduler, only re-runs the near-real-time Open-Meteo jobs,
  answers "already up to date" while their data is fresh, and is throttled server-side (one run per
  ``REFRESH_INTERVAL_S`` for the whole server, DB lease ``refresh:manual``). It never triggers the GRACE download.
* ``POST /api/sync/{source}`` requires ``Authorization: Bearer <ADMIN_TOKEN>`` (``security.require_admin``).
"""
from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from ..db import connection
from ..errors import ApiError
from ..schemas.v2 import (
    Envelope,
    LastUpdated,
    ReadRequest,
    ReadResult,
    RefreshResult,
    SearchItem,
    SearchResults,
    SourceStatus,
    SyncResult,
)
from ..security import require_admin
from ..services import alert_engine, catalog
from ..settings import get_settings
from ..sync import jobs
from ..sync.runs import acquire_lock, iso, new_owner, parse_iso, utcnow

router = APIRouter(tags=["Platform API (P3)"])
REFRESH_INTERVAL_S = 600
REFRESH_JOBS = ("forecast", "archive")
SOURCE_TO_JOB = {job.source_id: name for name, job in jobs.JOBS.items()}

MODULES = [
    ("command-center", "Command Center", "KPIs, scarcity map, alerts and regional overview"),
    ("explorer", "3D Water Explorer", "Map layers: divisions, GRACE grid, surface water, weather points"),
    ("prediction-lab", "AI Prediction Lab", "Climatic water balance forecasts and model card"),
    ("water-flow", "3D Water Flow", "Conceptual distribution network illustration"),
    ("water-budget", "Water Budget Sankey", "National AQUASTAT budget and the monthly model"),
    ("what-if", "What-if Simulator", "Scenario levers on the national water-balance model"),
    ("irrigation", "Smart Irrigation", "FAO-56 irrigation advice from the weather forecast"),
    ("copilot", "AI Copilot", "Questions about the stored data (requires an LLM key)"),
    ("data-sources", "Data Sources", "Sources, licences, freshness and status"),
]
INDICATORS = [
    ("rainfall", "Rainfall", "Daily and monthly precipitation (reanalysis, forecast)", "command-center"),
    ("temperature", "Temperature", "Current, forecast and historical air temperature", "command-center"),
    ("et0", "Reference evapotranspiration (ET0)", "FAO-56 reference ET0 from Open-Meteo", "irrigation"),
    ("soil-moisture", "Soil moisture (model estimate)", "Open-Meteo modelled soil moisture", "irrigation"),
    ("water-balance", "Climatic water balance (P - ET0)", "Weather-derived dryness indicator", "prediction-lab"),
    ("water-stress", "Water stress (SDG 6.4.2)", "National AQUASTAT water stress", "command-center"),
    ("renewable-resources", "Renewable water resources", "National AQUASTAT availability", "water-budget"),
    ("withdrawals", "Water withdrawals by sector", "National AQUASTAT withdrawals", "water-budget"),
    ("tws", "Water storage (GRACE TWS anomaly)", "Regional total water storage anomaly", "explorer"),
    ("irrigation-need", "Irrigation need", "Reference-crop and crop-specific requirement", "irrigation"),
    ("alerts", "Alerts", "Rule-based alerts from stored data", "command-center"),
]


def _conn(read_only: bool = True):
    s = get_settings()
    if not s.db_path.exists():
        raise ApiError(503, "unavailable", "The database is not available.")
    return connection.connect(s.db_path, read_only=read_only)


def db_read() -> Iterator:
    conn = _conn(True)
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------- alerts: mark read

@router.post("/alerts/{alert_id}/read", response_model=Envelope[ReadResult])
def mark_read(alert_id: int, req: ReadRequest) -> Envelope[ReadResult]:
    conn = _conn(False)
    try:
        if conn.execute("SELECT 1 FROM alerts WHERE id = ?", (alert_id,)).fetchone() is None:
            raise ApiError(404, "not_found", f"Alert {alert_id} does not exist.")
        conn.execute("INSERT OR IGNORE INTO alert_reads (alert_id, client_id, read_at) VALUES (?, ?, ?)",
                     (alert_id, req.clientId, iso(utcnow())))
    finally:
        conn.close()
    return Envelope(data=ReadResult(alertId=alert_id, read=True),
                    meta=catalog.meta(["aquaguard_engine"], ["derived"], "mixed",
                                      note="Read marks are stored per client (browser) id; there is no login."))


# ---------------------------------------------------------------- search

def _score(q: str, *texts: str) -> int:
    best = 0
    for t in texts:
        t = (t or "").lower()
        if not t:
            continue
        if t == q:
            best = max(best, 100)
        elif t.startswith(q):
            best = max(best, 80)
        elif any(w.startswith(q) for w in t.replace("-", " ").split()):
            best = max(best, 60)
        elif q in t:
            best = max(best, 40)
    return best


@router.get("/search", response_model=Envelope[SearchResults])
def search(q: str = Query(..., min_length=1, max_length=100), limit: int = Query(12, ge=1, le=50),
           conn=Depends(db_read)) -> Envelope[SearchResults]:
    query = q.strip().lower()
    if not query:
        raise ApiError(422, "invalid_request", "q must not be blank.")
    found: list[tuple[int, SearchItem]] = []
    names = {r[0]: r[1] for r in conn.execute("SELECT id, name FROM locations WHERE level IN ('country', 'division')")}
    for rid, name, name_bn, lvl, parent in conn.execute(
            "SELECT id, name, name_bn, level, parent_id FROM locations ORDER BY level, name"):
        sc = _score(query, name, name_bn or "", rid)
        if not sc:
            continue
        if lvl == "district":
            target = parent or "bd"
            item = SearchItem(type="region", id=rid, label=name,
                              description=f"District of {names.get(target, target)} division — data are shown for "
                                          "the division (no district-level data)",
                              href=f"/command-center?region={target}")
            sc -= 10
        else:
            item = SearchItem(type="region", id=rid, label=name,
                              description="Bangladesh (national)" if lvl == "country" else "Division",
                              href=f"/command-center?region={rid}")
        found.append((sc, item))
    for mid, label, desc in MODULES:
        if sc := _score(query, label, mid, desc):
            found.append((sc, SearchItem(type="module", id=mid, label=label, description=desc, href=f"/{mid}")))
    for iid, label, desc, module in INDICATORS:
        if sc := _score(query, label, iid, desc):
            found.append((sc - 5, SearchItem(type="indicator", id=iid, label=label, description=desc,
                                             href=f"/{module}")))
    for sid, name, cadence in conn.execute("SELECT id, name, cadence FROM data_sources"):
        if sc := _score(query, name, sid):
            found.append((sc - 10, SearchItem(type="source", id=sid, label=name, description=f"Data source ({cadence})",
                                              href=f"/data-sources#{sid}")))
    for aid, rule_id, loc, message in conn.execute(
            "SELECT id, rule_id, location_id, message FROM alerts WHERE resolved_at IS NULL"):
        r = alert_engine.rule(rule_id) or {}
        title = r.get("title", rule_id)
        if sc := _score(query, title, names.get(loc, loc), message):
            found.append((sc - 15, SearchItem(type="alert", id=str(aid), label=f"{title} — {names.get(loc, loc)}",
                                              description=message[:160], href=f"/command-center?region={loc}&alert={aid}")))
    found.sort(key=lambda x: (-x[0], x[1].label))
    return Envelope(data=SearchResults(query=q, items=[i for _, i in found[:limit]]),
                    meta=catalog.meta(["aquaguard_engine"], ["reference"], "mixed"))


# ---------------------------------------------------------------- data sources and last updated

def _source_rows() -> list[SourceStatus]:
    out = []
    for sid, s in sorted(catalog.sources().items()):
        out.append(SourceStatus(
            id=sid, name=s["name"], url=s["url"], licence=s["licence"], attribution=s["attribution"],
            cadence=s["cadence"], cadenceSeconds=s.get("cadence_seconds"), dataKind=s["data_kind"],
            spatialLevel=s["spatial_level"], scheduled=bool(s.get("scheduled")), status=s.get("status", "unavailable"),
            retrievedAt=s.get("retrieved_at"), lastSuccessAt=s.get("last_success_at"),
            lastAttemptAt=s.get("last_attempt_at"), lastAttemptStatus=s.get("last_attempt_status"),
            lastError=s.get("last_error"),
            latestObservation=None if s.get("latest_observation") is None else str(s["latest_observation"]),
            note=s.get("note")))
    return out


@router.get("/data/sources", response_model=Envelope[list[SourceStatus]])
def data_sources() -> Envelope[list[SourceStatus]]:
    rows = _source_rows()
    if not rows:
        raise ApiError(503, "unavailable", "The source registry is not available.")
    return Envelope(data=rows, meta=catalog.meta([r.id for r in rows if r.scheduled], ["reference"], "mixed",
                                                 note="Status is computed from the last successful sync and the "
                                                      "source cadence."))


@router.get("/data/last-updated", response_model=Envelope[LastUpdated])
def data_last_updated() -> Envelope[LastUpdated]:
    rows = [r for r in _source_rows() if r.scheduled]
    latest = max((r.lastSuccessAt or r.retrievedAt or "" for r in rows), default="") or None
    overall = catalog.worst(r.status for r in rows)
    return Envelope(data=LastUpdated(sources=rows, latestRetrievedAt=latest, overallStatus=overall),
                    meta=catalog.meta([r.id for r in rows], ["reference"], "mixed"))


# ---------------------------------------------------------------- manual refresh (public, throttled)

def _jobs_due() -> list[str]:
    return [name for name in REFRESH_JOBS if catalog.status_of(jobs.JOBS[name].source_id) != "fresh"]


@router.post("/refresh", response_model=Envelope[RefreshResult])
def refresh() -> Envelope[RefreshResult]:
    s = get_settings()
    sources = [jobs.JOBS[n].source_id for n in REFRESH_JOBS]
    if s.offline:
        raise ApiError(503, "offline", "External data access is disabled on this server.")
    catalog.clear()
    due = _jobs_due()
    if not due:
        return Envelope(data=RefreshResult(result="up_to_date", message="Already up to date.", jobs=[]),
                        meta=catalog.meta(sources, ["model_current", "forecast", "reanalysis"], "mixed"))
    conn = _conn(False)
    try:
        if not acquire_lock(conn, "refresh:manual", new_owner(), REFRESH_INTERVAL_S):
            row = conn.execute("SELECT expires_at FROM scheduler_lock WHERE name = 'refresh:manual'").fetchone()
            until = parse_iso(row[0]) if row else None
            wait = max(1, int((until - datetime.now(timezone.utc)).total_seconds())) if until else REFRESH_INTERVAL_S
            raise ApiError(429, "refresh_throttled",
                           f"A refresh ran recently; try again in {wait // 60 + 1} minutes.",
                           headers={"Retry-After": str(wait)})
    finally:
        conn.close()
    results = [jobs.run_job(name, settings=s) for name in due]
    statuses = {r.status for r in results}
    if statuses <= {"success", "skipped"}:
        result, msg = "refreshed", "Data refreshed."
    elif "success" in statuses or "partial" in statuses:
        result, msg = "partial", "Some data could not be refreshed; the last valid data is kept."
    else:
        result, msg = "failed", "The refresh failed; the last valid data is kept."
    catalog.clear()
    return Envelope(data=RefreshResult(result=result, message=msg,
                                       jobs=[{"job": r.job, "status": r.status, "inserted": r.stats.inserted,
                                              "updated": r.stats.updated} for r in results]),
                    meta=catalog.meta(sources, ["model_current", "forecast", "reanalysis"], "mixed"))


# ---------------------------------------------------------------- admin sync

@router.post("/sync/{source}", response_model=Envelope[SyncResult], dependencies=[Depends(require_admin)])
def admin_sync(source: str, force: bool = False) -> Envelope[SyncResult]:
    name = source if source in jobs.JOBS else SOURCE_TO_JOB.get(source)
    if name is None:
        raise ApiError(404, "unknown_source",
                       f"Unknown source '{source}'. Use one of: {', '.join(jobs.JOBS)} (or their source ids).")
    r = jobs.run_job(name, settings=get_settings(), force=force)
    d = r.as_dict()
    catalog.clear()
    return Envelope(data=SyncResult(job=d["job"], status=d["status"], runId=d["run_id"], inserted=d["inserted"],
                                    updated=d["updated"], skipped=d["skipped"], okUnits=d["ok_units"],
                                    errors=d["errors"], reason=d["reason"]),
                    meta=catalog.meta([jobs.JOBS[name].source_id],
                                      [catalog.source(jobs.JOBS[name].source_id).get("data_kind", "reference")],
                                      "mixed"))
