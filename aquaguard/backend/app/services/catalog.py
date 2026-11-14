"""Source catalog for the P3 API: registry rows + computed status, the ``meta`` block and Measure helpers.

Status comes from ``app.sync.status`` (fresh / stale / unavailable / not_configured) and is cached in-process for
``STATUS_TTL_S`` seconds; the cache is dropped whenever the table cache is (after a sync).
"""
from __future__ import annotations

import math
import sqlite3
import threading
import time

from ..db import connection
from ..schemas.common import Measure, Provenance
from ..schemas.v2 import Meta
from ..settings import get_settings
from ..sync import status as sync_status

STATUS_TTL_S = 15.0
STATUS_ORDER = {"fresh": 0, "stale": 1, "unavailable": 2, "not_configured": 3}
_lock = threading.Lock()
_cache: dict[str, object] = {"at": 0.0, "value": None}

# legacy provenance for the new data kinds (old UI components still read `provenance`)
PROVENANCE: dict[str, Provenance] = {
    "observed": "observed", "model_current": "estimated", "forecast": "predicted", "reanalysis": "historical",
    "satellite_monthly": "historical", "satellite_historical": "historical", "statistic": "historical",
    "derived": "estimated", "prediction": "predicted", "scenario": "simulated", "conceptual": "simulated",
    "reference": "historical",
}
NATIONAL_WEATHER_NOTE = "National estimate based on eight representative divisional weather points."
NATIONAL_DATA_NOTE = "National data: this source has no division-level values."


def _load() -> dict[str, dict]:
    s = get_settings()
    if not s.db_path.exists():
        return {}
    conn = connection.connect(s.db_path, read_only=True)
    try:
        rows = conn.execute("SELECT id, name, url, licence, attribution, cadence, cadence_seconds, data_kind, "
                            "spatial_level, requires_credentials, notes FROM data_sources ORDER BY id").fetchall()
        cols = ("id", "name", "url", "licence", "attribution", "cadence", "cadence_seconds", "data_kind",
                "spatial_level", "requires_credentials", "notes")
        registry = {r[0]: dict(zip(cols, r)) for r in rows}
        for st in sync_status.all_statuses(conn, s):
            registry.get(st["source_id"], {}).update(st)
        return registry
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def sources() -> dict[str, dict]:
    now = time.monotonic()
    with _lock:
        if _cache["value"] is not None and now - float(_cache["at"]) < STATUS_TTL_S:
            return _cache["value"]  # type: ignore[return-value]
    value = _load()
    with _lock:
        _cache.update(at=now, value=value)
    return value


def clear() -> None:
    from . import indicators

    with _lock:
        _cache.update(at=0.0, value=None)
    indicators.clear()


def source(source_id: str) -> dict:
    return sources().get(source_id, {"id": source_id, "status": "unavailable", "attribution": source_id})


def status_of(source_id: str) -> str:
    return source(source_id).get("status", "unavailable")


def worst(statuses) -> str:
    statuses = [s for s in statuses if s]
    return max(statuses, key=lambda s: STATUS_ORDER.get(s, 2)) if statuses else "unavailable"


def meta(source_ids: list[str], data_kinds: list[str], spatial_level: str, *, observed_at: str | None = None,
         unit: str | None = None, note: str | None = None, retrieved_at: str | None = None,
         status: str | None = None) -> Meta:
    infos = [source(s) for s in source_ids]
    retrieved = retrieved_at or max((i.get("retrieved_at") or "" for i in infos), default="") or None
    return Meta(source=source_ids, data_kind=list(dict.fromkeys(data_kinds)), observed_at=observed_at,
                retrieved_at=retrieved, unit=unit, spatial_level=spatial_level,
                status=status or worst(i.get("status") for i in infos),
                attribution=list(dict.fromkeys(i.get("attribution") or i["id"] for i in infos)), note=note)


def mv(value: float | None, unit: str, data_kind: str, source_id: str, spatial_level: str, *,
       observed_at: str | None = None, reference_year: int | None = None, note: str | None = None,
       low: float | None = None, high: float | None = None, digits: int = 3, status: str | None = None) -> Measure:
    """A Measure with the P3 metadata (and the legacy provenance for old components)."""
    from ..schemas.common import Interval

    if value is not None and (math.isnan(value) or math.isinf(value)):
        value = None
    info = source(source_id)
    unc = None
    if low is not None and high is not None and not (math.isnan(low) or math.isnan(high)):
        unc = Interval(low=round(low, digits), high=round(high, digits))
    return Measure(value=None if value is None else round(float(value), digits), unit=unit,
                   provenance=PROVENANCE.get(data_kind, "estimated"), sourceId=source_id,
                   asOf=observed_at, uncertainty=unc, dataKind=data_kind,  # type: ignore[arg-type]
                   status=status or info.get("status", "unavailable"), observedAt=observed_at,
                   retrievedAt=info.get("retrieved_at"), spatialLevel=spatial_level,  # type: ignore[arg-type]
                   referenceYear=reference_year, note=note)
