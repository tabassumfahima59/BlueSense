"""SQL readers shared by the P3 endpoints and the alert engine (every function takes an open connection).

Spatial rules (master prompt §2, decisions 1 and 4):
* Weather is stored at eight divisional representative points. A division's weather is its point; the national value
  is the area-weighted mean of the eight points ("National estimate based on eight representative divisional weather
  points", D2) and is only computed when every point has the value.
* AQUASTAT and SDG 6.4.2 are national only and are never split into divisions.
* GRACE is a regional TWS anomaly (~300 km); it is never presented as a division score.
Times: weather ``valid_time`` is Asia/Dhaka local time (UTC+06:00, no DST).
"""
from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timedelta, timezone

from ..engine.fao56 import effective_rainfall_period

DHAKA = timedelta(hours=6)
TIMEZONE = "Asia/Dhaka (UTC+06:00)"
NORMAL_YEARS = (1991, 2020)

CURRENT_VARS = {"temperature_2m": "Temperature (2 m)", "relative_humidity_2m": "Relative humidity",
                "precipitation": "Precipitation", "wind_speed_10m": "Wind speed (10 m)"}
DAILY_VARS = {"precipitation_sum": "Precipitation", "precipitation_probability_max": "Precipitation probability (max)",
              "temperature_2m_max": "Temperature max", "temperature_2m_min": "Temperature min",
              "temperature_2m_mean": "Temperature mean", "et0_fao_evapotranspiration": "Reference ET0 (FAO-56)",
              "wind_speed_10m_max": "Wind speed max"}
HOURLY_VARS = {"temperature_2m": "Temperature (2 m)", "relative_humidity_2m": "Relative humidity",
               "precipitation": "Precipitation", "precipitation_probability": "Precipitation probability",
               "wind_speed_10m": "Wind speed (10 m)", "et0_fao_evapotranspiration": "Reference ET0 (FAO-56)",
               "soil_moisture_3_to_9cm": "Soil moisture 3-9 cm (model estimate)"}
HISTORY_DAILY = {"precip_mm": ("Precipitation", "mm"), "tmax_c": ("Temperature max", "°C"),
                 "tmin_c": ("Temperature min", "°C"), "tmean_c": ("Temperature mean", "°C"),
                 "et0_mm": ("Reference ET0 (FAO-56)", "mm"),
                 "soil_moisture_m3m3": ("Soil moisture 0-7 cm (model estimate)", "m³/m³")}
HISTORY_MONTHLY = {**HISTORY_DAILY, "d_mm": ("Climatic water balance P - ET0", "mm")}


class RegionError(ValueError):
    """Unknown region, or a level the new API does not serve (districts)."""


def dhaka_now(now: datetime | None = None) -> datetime:
    return ((now or datetime.now(timezone.utc)).astimezone(timezone.utc) + DHAKA).replace(tzinfo=None)


# ---------------------------------------------------------------- regions

def region(conn: sqlite3.Connection, region_id: str) -> dict:
    row = conn.execute("SELECT id, name, level, parent_id FROM locations WHERE id = ?", (region_id,)).fetchone()
    if row is None:
        raise RegionError(f"Unknown region '{region_id}'. Use 'bd' or a division id (GET /api/regions).")
    if row[2] == "district":
        raise RegionError(f"District-level data is not available; use its division '{row[3]}'.")
    return {"id": row[0], "name": row[1], "level": row[2]}


def weather_points(conn: sqlite3.Connection) -> dict[str, float]:
    """Division weather points and their area (km²) for the national area-weighted estimate."""
    return {r[0]: float(r[1] or 0.0) for r in conn.execute(
        "SELECT id, area_km2 FROM locations WHERE is_weather_point = 1 ORDER BY id")}


def points_for(conn: sqlite3.Connection, reg: dict) -> dict[str, float]:
    pts = weather_points(conn)
    return pts if reg["level"] == "country" else {reg["id"]: pts.get(reg["id"], 1.0)}


def weighted(values: dict[str, float | None], weights: dict[str, float]) -> float | None:
    """Area-weighted mean; None unless every point has a value."""
    if not weights or any(values.get(p) is None for p in weights):
        return None
    total = sum(weights.values())
    return sum(values[p] * w for p, w in weights.items()) / total if total else None


# ---------------------------------------------------------------- weather

def current(conn: sqlite3.Connection, reg: dict) -> dict:
    pts = points_for(conn, reg)
    per: dict[str, dict[str, tuple]] = {}
    for p in pts:
        t = conn.execute("SELECT MAX(valid_time) FROM weather_values WHERE location_id = ? AND variable = "
                         "'temperature_2m' AND data_kind = 'model_current' AND time_step = 'current'", (p,)).fetchone()[0]
        if t is None:
            continue
        for var, value, unit in conn.execute(
                "SELECT variable, value, unit FROM weather_values WHERE location_id = ? AND data_kind = "
                "'model_current' AND time_step = 'current' AND valid_time = ?", (p, t)):
            per.setdefault(var, {})[p] = (value, unit, t)
    out = {}
    times = sorted({v[2] for d in per.values() for v in d.values()})
    for var in CURRENT_VARS:
        d = per.get(var, {})
        value = weighted({p: d[p][0] for p in d}, pts)
        unit = next((v[1] for v in d.values()), "")
        observed = min((d[p][2] for p in pts if p in d), default=None)
        out[var] = {"value": value, "unit": unit, "observed": observed, "points": len(d)}
    return {"values": out, "valid_time": times[0] if times else None, "points": len(pts)}


def _wide(rows, pts: dict[str, float]) -> dict[str, dict[str, float | None]]:
    """rows (location, variable, t, value) -> {variable: {t: weighted value}}."""
    acc: dict[str, dict[str, dict[str, float]]] = {}
    for loc, var, t, value in rows:
        acc.setdefault(var, {}).setdefault(t, {})[loc] = value
    return {var: {t: weighted(v, pts) for t, v in sorted(ts.items())} for var, ts in acc.items()}


def forecast(conn: sqlite3.Connection, reg: dict, days: int, step: str, now: datetime | None = None) -> dict:
    pts = points_for(conn, reg)
    local = dhaka_now(now)
    start = local.date()
    end = start + timedelta(days=days)
    variables = DAILY_VARS if step == "daily" else HOURLY_VARS
    lo = start.isoformat() if step == "daily" else local.strftime("%Y-%m-%dT%H:00")
    hi = end.isoformat() if step == "daily" else end.isoformat() + "T00:00"
    marks = ",".join("?" for _ in pts)
    names = ",".join("?" for _ in variables)
    rows = conn.execute(
        f"SELECT location_id, variable, valid_time, value FROM weather_values WHERE location_id IN ({marks}) "
        f"AND variable IN ({names}) AND data_kind = 'forecast' AND time_step = ? AND valid_time >= ? "
        f"AND valid_time < ?", [*pts, *variables, step, lo, hi]).fetchall()
    units = dict(conn.execute(
        f"SELECT variable, unit FROM weather_values WHERE location_id = ? AND variable IN ({names}) "
        f"AND data_kind = 'forecast' AND time_step = ? GROUP BY variable", [next(iter(pts)), *variables, step]))
    retrieved = conn.execute(
        f"SELECT MAX(retrieved_at) FROM weather_values WHERE location_id IN ({marks}) AND data_kind = 'forecast' "
        f"AND time_step = ? AND valid_time >= ?", [*pts, step, lo]).fetchone()[0]
    return {"wide": _wide(rows, pts), "units": units, "start": lo, "end": hi, "retrieved_at": retrieved,
            "labels": variables}


def history(conn: sqlite3.Connection, reg: dict, start: str, end: str, step: str) -> dict:
    pts = points_for(conn, reg)
    marks = ",".join("?" for _ in pts)
    cols = HISTORY_DAILY if step == "daily" else HISTORY_MONTHLY
    if step == "daily":
        rows = conn.execute(f"SELECT division, date, {', '.join(cols)} FROM weather_daily WHERE division IN ({marks}) "
                            "AND date BETWEEN ? AND ? ORDER BY date", [*pts, start, end]).fetchall()
    else:
        rows = conn.execute(
            f"SELECT division, printf('%04d-%02d', year, month) AS t, {', '.join(cols)} FROM weather_monthly "
            f"WHERE division IN ({marks}) AND printf('%04d-%02d', year, month) BETWEEN ? AND ? ORDER BY t",
            [*pts, start[:7], end[:7]]).fetchall()
    long = [(r[0], col, r[1], r[2 + i]) for r in rows for i, col in enumerate(cols)]
    return {"wide": _wide(long, pts), "columns": cols}


# ---------------------------------------------------------------- AQUASTAT (national only)

def stat(conn: sqlite3.Connection, code: int) -> dict | None:
    """Latest genuine (non-imputed, current) reference-year value and the previous reference year."""
    rows = conn.execute(
        "SELECT reference_year, value, unit, symbol, indicator_name, retrieved_at FROM water_statistics "
        "WHERE source_id = 'fao_aquastat' AND indicator_code = ? AND superseded_at IS NULL AND imputed = 0 "
        "ORDER BY reference_year DESC LIMIT 2", (str(code),)).fetchall()
    if not rows:
        return None
    keys = ("year", "value", "unit", "symbol", "name", "retrieved_at")
    latest = dict(zip(keys, rows[0]))
    latest["previous"] = dict(zip(keys, rows[1])) if len(rows) > 1 else None
    return latest


AQUASTAT_UNIT = {"10^9 m3/year": "km³/yr", "%": "%"}


def sdg_class(pct: float) -> tuple[str, int]:
    """FAO SDG 6.4.2 water stress classes: <=25 no stress, >25-50 low, >50-75 medium, >75-100 high, >100 critical."""
    if pct > 100:
        return "Critical", 4
    if pct > 75:
        return "High", 3
    if pct > 50:
        return "Medium", 2
    if pct > 25:
        return "Low", 1
    return "No stress", 0


# ---------------------------------------------------------------- GRACE (regional TWS anomaly)

def _grace_release(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT release_version FROM water_storage WHERE source_id = 'grace_csr' AND scope = 'national' "
                       "ORDER BY retrieved_at DESC LIMIT 1").fetchone()
    return row[0] if row else None


def grace_series(conn: sqlite3.Connection, start: str | None = None, end: str | None = None) -> list[tuple[str, float]]:
    rel = _grace_release(conn)
    if rel is None:
        return []
    return [(r[0], r[1]) for r in conn.execute(
        "SELECT period_start, tws_anomaly_cm FROM water_storage WHERE source_id = 'grace_csr' AND release_version = ? "
        "AND scope = 'national' AND location_id = 'bd' AND cell_id = '' AND period_start BETWEEN ? AND ? "
        "ORDER BY period_start", (rel, start or "0000", end or "9999"))]


def grace_cells(conn: sqlite3.Connection, period_start: str) -> list[tuple[str, float, float, float]]:
    rel = _grace_release(conn)
    return [tuple(r) for r in conn.execute(
        "SELECT cell_id, cell_lat, cell_lon, tws_anomaly_cm FROM water_storage WHERE source_id = 'grace_csr' "
        "AND release_version = ? AND scope = 'grid_cell' AND location_id = 'bd' AND period_start = ? ORDER BY cell_id",
        (rel, period_start))]


# ---------------------------------------------------------------- division weather indicators

def _sum_window(conn, division: str, col: str, start: date, end: date) -> float | None:
    """Sum of a daily column over [start, end]; None unless every day has a value."""
    n_days = (end - start).days + 1
    row = conn.execute(f"SELECT COUNT({col}), SUM({col}) FROM weather_daily WHERE division = ? AND date BETWEEN ? AND ?",
                       (division, start.isoformat(), end.isoformat())).fetchone()
    return float(row[1]) if row[0] == n_days else None


def last_complete_day(conn, division: str) -> date | None:
    row = conn.execute("SELECT MAX(date) FROM weather_daily WHERE division = ? AND precip_mm IS NOT NULL "
                       "AND et0_mm IS NOT NULL", (division,)).fetchone()
    return date.fromisoformat(row[0]) if row and row[0] else None


def _shift_year(d: date, years: int) -> date | None:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 February
        return None


def rain_30d(conn, division: str) -> dict | None:
    """Last 30 days of reanalysis rainfall vs the same days last year and vs the 1991-2020 mean."""
    end = last_complete_day(conn, division)
    if end is None:
        return None
    start = end - timedelta(days=29)
    total = _sum_window(conn, division, "precip_mm", start, end)
    et0 = _sum_window(conn, division, "et0_mm", start, end)
    if total is None:
        return None
    ly_s, ly_e = _shift_year(start, -1), _shift_year(end, -1)
    last_year = _sum_window(conn, division, "precip_mm", ly_s, ly_e) if ly_s and ly_e else None
    normals = []
    for y in range(NORMAL_YEARS[0], NORMAL_YEARS[1] + 1):
        s, e = _shift_year(start, y - end.year), _shift_year(end, y - end.year)
        if s and e:
            v = _sum_window(conn, division, "precip_mm", s, e)
            if v is not None:
                normals.append(v)
    normal = sum(normals) / len(normals) if len(normals) >= 25 else None
    return {"start": start.isoformat(), "end": end.isoformat(), "total": total, "et0": et0, "lastYear": last_year,
            "normal": normal, "normalYears": len(normals),
            "anomalyPct": (total - normal) / normal * 100 if normal and normal > 0 else None}


def reference_crop_need(r30: dict) -> float | None:
    """Kc = 1 reference-crop irrigation need over the 30-day window: max(0, ET0 - Pe) with USDA-SCS Pe scaled to
    the period (fao56.effective_rainfall_period). Reference-crop estimate, not a crop recommendation."""
    if r30 is None or r30.get("et0") is None:
        return None
    return max(0.0, r30["et0"] - effective_rainfall_period(r30["total"], 30))


def forecast_window(conn, division: str, days: int = 7, now: datetime | None = None) -> dict | None:
    """Next `days` local days of stored forecast: P - ET0 and the wettest day. None unless all days are stored."""
    start = dhaka_now(now).date()
    end = start + timedelta(days=days)
    rows = conn.execute(
        "SELECT valid_time, variable, value FROM weather_values WHERE location_id = ? AND data_kind = 'forecast' "
        "AND time_step = 'daily' AND variable IN ('precipitation_sum', 'et0_fao_evapotranspiration') "
        "AND valid_time >= ? AND valid_time < ?", (division, start.isoformat(), end.isoformat())).fetchall()
    p = {t: v for t, var, v in rows if var == "precipitation_sum"}
    e = {t: v for t, var, v in rows if var == "et0_fao_evapotranspiration"}
    if len(p) < days or len(e) < days:
        return None
    wettest = max(p.items(), key=lambda kv: kv[1])
    return {"start": start.isoformat(), "end": (end - timedelta(days=1)).isoformat(), "precip": sum(p.values()),
            "et0": sum(e.values()), "balance": sum(p.values()) - sum(e.values()), "maxDay": wettest[0],
            "maxDayMm": wettest[1]}


def water_balance_3m_z(conn, division: str) -> dict | None:
    """SPI-style z-score of the last 3 complete months of P - ET0 against the same 3 calendar months of 1991-2020
    (normal-distribution z, not a gamma-fitted SPI)."""
    rows = conn.execute("SELECT year, month, d_mm FROM weather_monthly WHERE division = ? AND d_mm IS NOT NULL "
                        "ORDER BY year DESC, month DESC LIMIT 3", (division,)).fetchall()
    if len(rows) < 3:
        return None
    (y2, m2, _), (y1, m1, _), (y0, m0, _) = rows
    if (y2 * 12 + m2) - (y0 * 12 + m0) != 2:
        return None  # the three latest months are not consecutive
    value = sum(r[2] for r in rows)
    months = [(m0, 0), (m1, (y1 - y0)), (m2, (y2 - y0))]
    sums = []
    for y in range(NORMAL_YEARS[0], NORMAL_YEARS[1] + 1):
        vals = [conn.execute("SELECT d_mm FROM weather_monthly WHERE division = ? AND year = ? AND month = ?",
                             (division, y + off, mo)).fetchone() for mo, off in months]
        if all(v and v[0] is not None for v in vals):
            sums.append(sum(v[0] for v in vals))
    if len(sums) < 25:
        return None
    mean = sum(sums) / len(sums)
    sd = math.sqrt(sum((s - mean) ** 2 for s in sums) / (len(sums) - 1))
    if sd <= 0:
        return None
    return {"value": value, "z": (value - mean) / sd, "mean": mean, "sd": sd,
            "window": f"{y0:04d}-{m0:02d} to {y2:04d}-{m2:02d}", "end": f"{y2:04d}-{m2:02d}"}


SPI_CLASSES = [(-2.0, "Extremely dry", 3), (-1.5, "Severely dry", 2), (-1.0, "Moderately dry", 1)]


def spi_class(z: float) -> tuple[str, int]:
    """SPI classes (McKee et al. 1993; WMO-No. 1090, 2012) for the dry side; wet side reported as near normal/wet."""
    for limit, label, level in SPI_CLASSES:
        if z <= limit:
            return label, level
    return ("Near normal" if z < 1.0 else "Wet"), 0
