"""Open-Meteo adapters (forecast + current, archive top-up) for the eight divisional weather points.

Forecast (``openmeteo_forecast``): one request per point with current, hourly and daily blocks (``timezone=auto``).
  * current  -> weather_values(time_step='current', data_kind='model_current')
  * hourly   -> weather_values(time_step='hourly',  data_kind='forecast')
  * daily    -> weather_values(time_step='daily',   data_kind='forecast')
  The newest run replaces an older value for the same valid_time; history comes from the archive.
Archive (``openmeteo_archive``): daily ERA5/ERA5-Land values for the last ``ARCHIVE_DAYS`` days
  -> weather_values(data_kind='reanalysis') and the legacy ``weather_daily`` table, then complete months are
  recomputed in ``weather_monthly`` (partial months are never stored).

Values that are missing or outside plausible ranges are skipped (never stored, never overwrite a stored value).
Values are weather-model output, not station readings.

Time convention: ``valid_time`` is the weather point's local time exactly as Open-Meteo returns it with
``timezone=auto`` — all eight points are in Asia/Dhaka (UTC+06:00, no daylight saving). Daily values use the local
calendar date (same as the legacy ``weather_daily`` table); hourly and current values use local ``YYYY-MM-DDTHH:MM``.
"""
from __future__ import annotations

import calendar
import sqlite3
from datetime import date, datetime, timedelta

from pydantic import ValidationError

from .http import HttpClient, HttpError
from .runs import RunStats, iso, utcnow
from .validate import OpenMeteoResponse, in_range

FORECAST_SOURCE = "openmeteo_forecast"
ARCHIVE_SOURCE = "openmeteo_archive"
ARCHIVE_DAYS = 14

CURRENT_VARS = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m"]
HOURLY_VARS = ["temperature_2m", "relative_humidity_2m", "precipitation", "precipitation_probability",
               "wind_speed_10m", "et0_fao_evapotranspiration", "soil_moisture_3_to_9cm"]
DAILY_FORECAST_VARS = ["temperature_2m_max", "temperature_2m_min", "temperature_2m_mean", "precipitation_sum",
                       "precipitation_probability_max", "wind_speed_10m_max", "et0_fao_evapotranspiration"]
# archive variable -> legacy weather_daily column
ARCHIVE_VARS = {
    "precipitation_sum": "precip_mm",
    "temperature_2m_max": "tmax_c",
    "temperature_2m_min": "tmin_c",
    "temperature_2m_mean": "tmean_c",
    "et0_fao_evapotranspiration": "et0_mm",
    "soil_moisture_0_to_7cm_mean": "soil_moisture_m3m3",
}

UPSERT_VALUE = """
INSERT INTO weather_values (location_id, variable, data_kind, time_step, valid_time, value, unit, source_id,
                            model_run, retrieved_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(location_id, variable, data_kind, time_step, valid_time) DO UPDATE SET
  value = excluded.value, unit = excluded.unit, source_id = excluded.source_id, model_run = excluded.model_run,
  retrieved_at = excluded.retrieved_at
WHERE weather_values.value IS NOT excluded.value OR weather_values.unit IS NOT excluded.unit
"""


def weather_points(conn: sqlite3.Connection) -> list[tuple[str, float, float]]:
    return [tuple(r) for r in conn.execute(
        "SELECT id, lat, lon FROM locations WHERE is_weather_point = 1 AND lat IS NOT NULL ORDER BY id")]


def _upsert(conn: sqlite3.Connection, rows: list[tuple], stats: RunStats) -> None:
    for row in rows:
        exists = conn.execute(
            "SELECT 1 FROM weather_values WHERE location_id=? AND variable=? AND data_kind=? AND time_step=? "
            "AND valid_time=?", row[:5]).fetchone()
        before = conn.total_changes
        conn.execute(UPSERT_VALUE, row)
        if conn.total_changes > before:
            if exists:
                stats.updated += 1
            else:
                stats.inserted += 1


def _block_rows(location: str, block, units: dict[str, str] | None, variables: list[str], data_kind: str,
                time_step: str, source: str, retrieved: str, stats: RunStats) -> list[tuple]:
    rows = []
    series = block.series()
    for var in variables:
        values = series.get(var)
        if values is None:
            stats.errors.append(f"{location}: {time_step} variable {var} missing from response")
            continue
        unit = (units or {}).get(var, "")
        for t, v in zip(block.time, values):
            if not in_range(var, v):
                stats.skipped += 1
                continue
            rows.append((location, var, data_kind, time_step, t, float(v), unit, source, retrieved, retrieved))
    return rows


def parse_forecast(location: str, payload: dict, retrieved: str, stats: RunStats) -> list[tuple]:
    resp = OpenMeteoResponse.model_validate(payload)
    rows: list[tuple] = []
    if resp.current:
        t = resp.current.get("time")
        for var in CURRENT_VARS:
            v = resp.current.get(var)
            if t is None or not in_range(var, v):
                stats.skipped += 1
                continue
            rows.append((location, var, "model_current", "current", t, float(v), (resp.current_units or {}).get(var, ""),
                         FORECAST_SOURCE, retrieved, retrieved))
    if resp.hourly:
        rows += _block_rows(location, resp.hourly, resp.hourly_units, HOURLY_VARS, "forecast", "hourly",
                            FORECAST_SOURCE, retrieved, stats)
    if resp.daily:
        rows += _block_rows(location, resp.daily, resp.daily_units, DAILY_FORECAST_VARS, "forecast", "daily",
                            FORECAST_SOURCE, retrieved, stats)
    return rows


def parse_archive(location: str, payload: dict, retrieved: str, stats: RunStats) -> list[tuple]:
    resp = OpenMeteoResponse.model_validate(payload)
    if not resp.daily:
        raise ValueError("archive response has no daily block")
    return _block_rows(location, resp.daily, resp.daily_units, list(ARCHIVE_VARS), "reanalysis", "daily",
                       ARCHIVE_SOURCE, retrieved, stats)


def _params(settings, base: dict) -> dict:
    params = dict(base)
    if settings.openmeteo_api_key:
        params["apikey"] = settings.openmeteo_api_key.get_secret_value()
    return params


def sync_forecast(conn: sqlite3.Connection, client: HttpClient, settings, now: datetime | None = None) -> RunStats:
    stats = RunStats()
    retrieved = iso(now or utcnow())
    points = weather_points(conn)
    if not points:
        stats.errors.append("no weather points in locations")
        return stats
    for location, lat, lon in points:
        params = _params(settings, {
            "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 16,
            "current": ",".join(CURRENT_VARS), "hourly": ",".join(HOURLY_VARS), "daily": ",".join(DAILY_FORECAST_VARS),
        })
        try:
            payload = client.get_json(settings.openmeteo_forecast_url, params=params)
            rows = parse_forecast(location, payload, retrieved, stats)
            stats.retrieved += 1
        except (HttpError, ValidationError, ValueError) as exc:
            stats.errors.append(f"{location}: {_short(exc)}")
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            _upsert(conn, rows, stats)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        stats.ok += 1
    return stats


def sync_archive(conn: sqlite3.Connection, client: HttpClient, settings, now: datetime | None = None,
                 days: int = ARCHIVE_DAYS) -> RunStats:
    stats = RunStats()
    now = now or utcnow()
    retrieved = iso(now)
    today = (now + timedelta(hours=6)).date()  # Asia/Dhaka calendar date (UTC+6, no DST)
    start, end = today - timedelta(days=days), today - timedelta(days=1)
    touched: set[tuple[str, int, int]] = set()
    for location, lat, lon in weather_points(conn):
        params = _params(settings, {
            "latitude": lat, "longitude": lon, "timezone": "auto", "start_date": start.isoformat(),
            "end_date": end.isoformat(), "daily": ",".join(ARCHIVE_VARS),
        })
        try:
            payload = client.get_json(settings.openmeteo_archive_url, params=params)
            rows = parse_archive(location, payload, retrieved, stats)
            stats.retrieved += 1
        except (HttpError, ValidationError, ValueError) as exc:
            stats.errors.append(f"{location}: {_short(exc)}")
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            _upsert(conn, rows, stats)
            _update_legacy_daily(conn, rows, retrieved)
            for r in rows:
                d = date.fromisoformat(r[4])
                touched.add((location, d.year, d.month))
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        stats.ok += 1
    if touched:
        conn.execute("BEGIN IMMEDIATE")
        try:
            recompute_monthly(conn, touched, retrieved)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return stats


def _update_legacy_daily(conn: sqlite3.Connection, rows: list[tuple], retrieved: str) -> None:
    """Keep legacy weather_daily (read by the current API and ML) in step. NULL never overwrites a value."""
    by_day: dict[tuple[str, str], dict[str, float]] = {}
    for loc, var, _kind, _step, day, value, *_ in rows:
        by_day.setdefault((loc, day), {})[ARCHIVE_VARS[var]] = value
    cols = list(ARCHIVE_VARS.values())
    for (loc, day), values in by_day.items():
        vals = [values.get(c) for c in cols]
        conn.execute(
            f"INSERT INTO weather_daily (division, date, {', '.join(cols)}, source_id, retrieved_at, provenance, is_sample) "
            f"VALUES (?, ?, {', '.join('?' for _ in cols)}, 'openmeteo_archive', ?, 'historical', 0) "
            "ON CONFLICT(division, date) DO UPDATE SET "
            + ", ".join(f"{c} = COALESCE(excluded.{c}, weather_daily.{c})" for c in cols)
            + ", retrieved_at = excluded.retrieved_at WHERE "
            + " OR ".join(f"weather_daily.{c} IS NOT COALESCE(excluded.{c}, weather_daily.{c})" for c in cols),
            [loc, day, *vals, retrieved])


def recompute_monthly(conn: sqlite3.Connection, months: set[tuple[str, int, int]], retrieved: str) -> int:
    """Derived monthly aggregates for complete months only (same rules as ml/process_weather.py)."""
    changed = 0
    for loc, year, month in sorted(months):
        ndays = calendar.monthrange(year, month)[1]
        first = f"{year:04d}-{month:02d}-01"
        last = f"{year:04d}-{month:02d}-{ndays:02d}"
        row = conn.execute(
            "SELECT COUNT(precip_mm), SUM(precip_mm), SUM(et0_mm), AVG(tmean_c), AVG(tmax_c), AVG(tmin_c), "
            "AVG(soil_moisture_m3m3), COUNT(et0_mm) FROM weather_daily WHERE division = ? AND date BETWEEN ? AND ?",
            (loc, first, last)).fetchone()
        n, p, e, tmean, tmax, tmin, sm, n_et0 = row
        if n != ndays or n_et0 != ndays:
            continue  # incomplete month: never stored
        vals = [round(p, 3), round(e, 3), round(p - e, 3), _r(tmean), _r(tmax), _r(tmin), _r(sm), n]
        before = conn.total_changes
        conn.execute(
            "INSERT INTO weather_monthly (division, year, month, precip_mm, et0_mm, d_mm, tmean_c, tmax_c, tmin_c, "
            "soil_moisture_m3m3, n_days, source_id, retrieved_at, provenance, is_sample) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'openmeteo_archive', ?, 'historical', 0) "
            "ON CONFLICT(division, year, month) DO UPDATE SET precip_mm = excluded.precip_mm, et0_mm = excluded.et0_mm, "
            "d_mm = excluded.d_mm, tmean_c = COALESCE(excluded.tmean_c, weather_monthly.tmean_c), "
            "tmax_c = COALESCE(excluded.tmax_c, weather_monthly.tmax_c), "
            "tmin_c = COALESCE(excluded.tmin_c, weather_monthly.tmin_c), "
            "soil_moisture_m3m3 = COALESCE(excluded.soil_moisture_m3m3, weather_monthly.soil_moisture_m3m3), "
            "n_days = excluded.n_days, retrieved_at = excluded.retrieved_at "
            "WHERE abs(weather_monthly.precip_mm - excluded.precip_mm) > 1e-6 "
            "OR abs(weather_monthly.et0_mm - excluded.et0_mm) > 1e-6 OR weather_monthly.n_days IS NOT excluded.n_days "
            "OR weather_monthly.tmean_c IS NOT COALESCE(excluded.tmean_c, weather_monthly.tmean_c) "
            "OR weather_monthly.tmax_c IS NOT COALESCE(excluded.tmax_c, weather_monthly.tmax_c) "
            "OR weather_monthly.tmin_c IS NOT COALESCE(excluded.tmin_c, weather_monthly.tmin_c) "
            "OR weather_monthly.soil_moisture_m3m3 IS NOT COALESCE(excluded.soil_moisture_m3m3, "
            "weather_monthly.soil_moisture_m3m3)",
            [loc, year, month, *vals, retrieved])
        changed += conn.total_changes - before
    return changed


def _r(v):
    return None if v is None else round(v, 3)


def _short(exc: Exception) -> str:
    text = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
    return f"{type(exc).__name__}: {text}"[:200]


