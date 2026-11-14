"""Division-level weather indicators (M1): definitions, legend classes with their source, and per-division values.

Only weather-derived indicators are computed per division (decision 1); AQUASTAT stays national and GRACE regional.
Each classified indicator states where its class thresholds come from; display bins that are not an official
classification are flagged as an assumption. Results are cached for ``TTL_S`` seconds (cleared with the catalog).
"""
from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime

from . import store

TTL_S = 60.0
_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}

# class: (lower bound or None, upper bound or None, label, tone -3 (dry/bad) .. +3 (wet/good)). Bounds are inclusive;
# a value on a boundary belongs to the class farther from neutral (larger |tone|), as in the SPI table
# (z = -1.0 is "moderately dry", z = -2.0 "extremely dry", z = +1.0 "moderately wet").
DEFINITIONS: list[dict] = [
    {"key": "dryness_3m", "label": "Seasonal dryness (3-month P − ET0 z-score)", "unit": "z-score",
     "dataKind": "derived", "sourceId": "openmeteo_archive",
     "method": "normal z-score of the last 3 complete months of P − ET0 against the same months 1991–2020 "
               "(SPI-style; not a gamma-fitted SPI)",
     "classSource": "SPI classes (McKee et al. 1993; WMO-No. 1090, 2012)", "assumption": False,
     "classes": [(None, -2.0, "Extremely dry", -3), (-2.0, -1.5, "Severely dry", -2), (-1.5, -1.0, "Moderately dry", -1),
                 (-1.0, 1.0, "Near normal", 0), (1.0, 1.5, "Moderately wet", 1), (1.5, 2.0, "Very wet", 2),
                 (2.0, None, "Extremely wet", 3)]},
    {"key": "rain_30d_anomaly", "label": "Rainfall, last 30 days vs 1991–2020 mean", "unit": "%",
     "dataKind": "derived", "sourceId": "openmeteo_archive",
     "method": "(30-day reanalysis total − mean of the same days 1991–2020) / mean × 100; not classified when "
               "that mean is below 5 mm (dry season)",
     "classSource": "India Meteorological Department rainfall departure categories", "assumption": False,
     "classes": [(None, -59.5, "Large deficient", -3), (-59.5, -19.5, "Deficient", -2), (-19.5, 19.5, "Normal", 0),
                 (19.5, 59.5, "Excess", 2), (59.5, None, "Large excess", 3)]},
    {"key": "water_balance_next_7d", "label": "Climatic water balance P − ET0, next 7 days (forecast)", "unit": "mm",
     "dataKind": "forecast", "sourceId": "openmeteo_forecast",
     "method": "7-day sum of forecast precipitation minus forecast FAO-56 reference ET0",
     "classSource": "AquaGuard display bins (not an official classification)", "assumption": True,
     "classes": [(None, -20.0, "Strong deficit", -2), (-20.0, -5.0, "Deficit", -1), (-5.0, 5.0, "Near balance", 0),
                 (5.0, 20.0, "Surplus", 1), (20.0, None, "Strong surplus", 2)]},
    {"key": "reference_crop_need_30d", "label": "Reference-crop irrigation need, last 30 days", "unit": "mm",
     "dataKind": "derived", "sourceId": "openmeteo_archive",
     "method": "max(0, ET0 − Pe) over 30 days, USDA-SCS effective rainfall scaled to the period, Kc = 1 "
               "(reference-crop estimate, not a crop recommendation)",
     "classSource": "AquaGuard display bins (not an official classification)", "assumption": True,
     "classes": [(None, 25.0, "Low", 0), (25.0, 50.0, "Moderate", -1), (50.0, 100.0, "High", -2),
                 (100.0, None, "Very high", -3)]},
    {"key": "water_balance_30d", "label": "Climatic water balance P − ET0, last 30 days", "unit": "mm",
     "dataKind": "reanalysis", "sourceId": "openmeteo_archive",
     "method": "30-day sum of reanalysis precipitation minus FAO-56 reference ET0", "classSource": None,
     "assumption": False, "classes": []},
    {"key": "rain_30d_vs_last_year", "label": "Rainfall, last 30 days minus the same days last year", "unit": "mm",
     "dataKind": "derived", "sourceId": "openmeteo_archive",
     "method": "difference of 30-day reanalysis totals (same calendar days)", "classSource": None,
     "assumption": False, "classes": []},
]
BY_KEY = {d["key"]: d for d in DEFINITIONS}


def classify(key: str, value: float | None) -> dict | None:
    d = BY_KEY[key]
    if value is None or not d["classes"]:
        return None
    hits = [(lo, hi, label, tone) for lo, hi, label, tone in d["classes"]
            if (lo is None or value >= lo) and (hi is None or value <= hi)]
    if not hits:
        return None
    lo, hi, label, tone = max(hits, key=lambda c: abs(c[3]))
    return {"label": label, "tone": tone, "min": lo, "max": hi}


def point_values(conn: sqlite3.Connection, point: str, now: datetime | None = None) -> dict[str, tuple]:
    """{key: (value, observed_at)} for one weather point; value None when the data is incomplete."""
    r = store.rain_30d(conn, point)
    f = store.forecast_window(conn, point, 7, now)
    d = store.water_balance_3m_z(conn, point)
    end = r["end"] if r else None
    small_normal = bool(r and (r["normal"] is None or r["normal"] < 5))
    return {
        "dryness_3m": (d["z"] if d else None, d["end"] if d else None),
        "rain_30d_anomaly": (None if not r or small_normal else r["anomalyPct"], end),
        "water_balance_next_7d": (f["balance"] if f else None, f["end"] if f else None),
        "reference_crop_need_30d": (store.reference_crop_need(r), end),
        "water_balance_30d": ((r["total"] - r["et0"]) if r and r["et0"] is not None else None, end),
        "rain_30d_vs_last_year": ((r["total"] - r["lastYear"]) if r and r["lastYear"] is not None else None, end),
        "_detail": (r, f, d),
    }


def all_divisions(conn: sqlite3.Connection, db_key: str) -> dict[str, dict]:
    """Per-division values (cached); key 'bd' holds the area-weighted national estimate."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get(db_key)
        if hit and now - hit[0] < TTL_S:
            return hit[1]
    pts = store.weather_points(conn)
    per = {p: point_values(conn, p) for p in pts}
    national = {}
    for d in DEFINITIONS:
        k = d["key"]
        v = store.weighted({p: per[p][k][0] for p in pts}, pts)
        observed = min((per[p][k][1] for p in pts if per[p][k][1]), default=None)
        national[k] = (v, observed)
    out = {**per, "bd": national}
    with _lock:
        _cache[db_key] = (now, out)
    return out


def clear() -> None:
    with _lock:
        _cache.clear()
