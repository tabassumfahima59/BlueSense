"""Data-source status, computed when read (never stored): ``fresh`` · ``stale`` · ``unavailable`` · ``not_configured``.

Scheduled sources (Open-Meteo forecast and archive, AQUASTAT, GRACE CSR):
  * no stored data                                        -> unavailable
  * data, but no successful sync yet (bootstrap snapshot) -> stale (original observation dates are kept)
  * last successful sync older than stale_factor x cadence -> stale
  * otherwise                                             -> fresh
  A failed attempt after a success does not erase data: the status ages from the last success and the error is shown.
Credential-gated sources without credentials (JPL GRACE, BWDB import) -> not_configured.
Reference sources that are not scheduled (boundaries, census, JRC tiles, engines) are reported with
``scheduled = False``: static datasets are fresh; annual ones age from their bootstrap retrieval date.

The observation date (``latest_observation``) is always reported separately from the retrieval date.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime

from .runs import last_attempt, last_success, parse_iso, utcnow

# job name -> source id (the four scheduled adapters)
SCHEDULED = {"forecast": "openmeteo_forecast", "archive": "openmeteo_archive", "aquastat": "fao_aquastat",
             "grace": "grace_csr"}
STATUSES = ("fresh", "stale", "unavailable", "not_configured")

# latest observation (not retrieval) per scheduled source
LATEST_OBSERVATION = {
    "openmeteo_forecast": "SELECT MAX(valid_time) FROM weather_values WHERE source_id = 'openmeteo_forecast' "
                          "AND data_kind = 'model_current'",
    "openmeteo_archive": "SELECT MAX(date) FROM weather_daily",
    "fao_aquastat": "SELECT MAX(reference_year) FROM water_statistics WHERE source_id = 'fao_aquastat' "
                    "AND superseded_at IS NULL",
    "grace_csr": "SELECT MAX(period_start) FROM water_storage WHERE source_id = 'grace_csr' AND scope = 'national'",
}
HAS_DATA = {
    "openmeteo_forecast": "SELECT 1 FROM weather_values WHERE source_id = 'openmeteo_forecast' LIMIT 1",
    "openmeteo_archive": "SELECT 1 FROM weather_daily LIMIT 1",
    "fao_aquastat": "SELECT 1 FROM water_statistics WHERE source_id = 'fao_aquastat' LIMIT 1",
    "grace_csr": "SELECT 1 FROM water_storage WHERE source_id = 'grace_csr' LIMIT 1",
}


def cadence_seconds(settings) -> dict[str, int]:
    return {
        "openmeteo_forecast": settings.sync_forecast_minutes * 60,
        "openmeteo_archive": settings.sync_archive_hours * 3600,
        "fao_aquastat": settings.sync_aquastat_days * 86400,
        "grace_csr": settings.sync_grace_hours * 3600,
    }


def _scalar(conn: sqlite3.Connection, sql: str):
    try:
        row = conn.execute(sql).fetchone()
    except sqlite3.Error:
        return None
    return None if row is None else row[0]


def _legacy_retrieved(conn: sqlite3.Connection, source_id: str) -> str | None:
    """Last retrieval recorded in the legacy ``sources`` table (bootstrap; updated by every sync that retrieved data)."""
    try:
        row = conn.execute("SELECT retrieved_at FROM sources WHERE id = ?", (source_id,)).fetchone()
    except sqlite3.Error:
        return None
    return None if row is None else row[0]


def source_status(conn: sqlite3.Connection, source: dict, settings, now: datetime | None = None) -> dict:
    """Status of one ``data_sources`` row (dict with id, cadence, cadence_seconds, requires_credentials)."""
    now = now or utcnow()
    sid = source["id"]
    out = {"source_id": sid, "scheduled": sid in SCHEDULED.values(), "status": "unavailable",
           "cadence_seconds": source.get("cadence_seconds"), "last_success_at": None, "last_attempt_at": None,
           "last_attempt_status": None, "last_error": None, "latest_observation": None,
           "retrieved_at": _legacy_retrieved(conn, sid), "note": None}

    if sid == "grace_jpl":
        out["status"] = "not_configured"
        out["note"] = ("JPL mascon adapter planned (Deviation D1); EARTHDATA_TOKEN is set but the adapter is not "
                       "implemented yet." if settings.earthdata_token else "Requires EARTHDATA_TOKEN (not set).")
        return out
    if source.get("cadence") == "manual" and source.get("requires_credentials"):
        out["status"] = "not_configured"
        out["note"] = "Manual import; no data imported."
        return out

    if sid in SCHEDULED.values():
        cadence = cadence_seconds(settings)[sid]
        out["cadence_seconds"] = cadence
        out["latest_observation"] = _scalar(conn, LATEST_OBSERVATION[sid])
        ok = last_success(conn, sid)
        attempt = last_attempt(conn, sid)
        if attempt:
            out.update(last_attempt_at=attempt["started_at"], last_attempt_status=attempt["status"],
                       last_error=attempt["error_summary"] if attempt["status"] in ("failed", "partial") else None)
        if not _scalar(conn, HAS_DATA[sid]):
            out["status"] = "unavailable"
            out["note"] = "No data stored yet."
            return out
        if ok is None:
            out["status"] = "stale"
            out["note"] = "Bootstrap snapshot; no successful sync yet. Original observation dates are kept."
            return out
        out["last_success_at"] = ok["finished_at"]
        age = (now - (parse_iso(ok["finished_at"]) or now)).total_seconds()
        out["status"] = "fresh" if age <= settings.stale_factor * cadence else "stale"
        return out

    # not scheduled: reference datasets and on-demand engines
    has_cadence = source.get("cadence_seconds")
    retrieved = parse_iso(out["retrieved_at"])
    notes = {"static": "Static reference dataset.", "on_demand": "Computed on request from stored data.",
             "irregular": "Bootstrap snapshot; not refreshed automatically."}
    if not has_cadence:
        out["status"] = "fresh"
        out["note"] = notes.get(source.get("cadence"), "Not refreshed automatically.")
    elif retrieved is None:
        out["status"] = "unavailable"
    else:
        age = (now - retrieved).total_seconds()
        out["status"] = "fresh" if age <= settings.stale_factor * has_cadence else "stale"
        out["note"] = "Not refreshed automatically; bootstrap retrieval date."
    return out


def all_statuses(conn: sqlite3.Connection, settings, now: datetime | None = None) -> list[dict]:
    rows = conn.execute("SELECT id, cadence, cadence_seconds, requires_credentials FROM data_sources ORDER BY id")
    cols = ("id", "cadence", "cadence_seconds", "requires_credentials")
    return [source_status(conn, dict(zip(cols, r)), settings, now) for r in rows.fetchall()]
