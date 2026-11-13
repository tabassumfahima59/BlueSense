"""Single read path for all stored data.

Every table is read from the SQLite database (data/aquaguard.db). There is no sample/mock fallback (decision 5):
a missing table reads as empty and the caller reports the data as unavailable. ``Table.is_sample`` is kept for API
compatibility and is always False.

Tables are cached per process. The cache is cleared after a sync job in this process and, at most every
``INVALIDATE_CHECK_S`` seconds, when ``sync_runs`` shows a run that finished in another process (e.g. the CLI).

Open-Meteo forecast for a point: network (unless AQUAGUARD_OFFLINE) -> on-disk cache (TTL) -> the forecast stored by
the scheduled sync for the nearest divisional weather point -> unavailable.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from urllib.parse import urlencode

import pandas as pd

from ..config.params import sources_registry
from ..db import connection
from ..settings import get_settings

_lock = threading.Lock()
INVALIDATE_CHECK_S = 30.0
_sync_marker: dict[str, object] = {"checked": 0.0, "value": None}


@dataclass(frozen=True)
class Table:
    df: pd.DataFrame
    is_sample: bool


def _read(name: str) -> Table:
    s = get_settings()
    if s.db_path.exists():
        try:
            con = connection.connect(s.db_path, read_only=True)  # WAL-safe; writes blocked by query_only
            try:
                df = pd.read_sql_query(f"SELECT * FROM {name}", con)
            finally:
                con.close()
            return Table(df, False)
        except sqlite3.Error:
            pass
    return Table(pd.DataFrame(), False)


@lru_cache(maxsize=32)
def _cached(name: str) -> Table:
    return _read(name)


def _latest_sync() -> str | None:
    s = get_settings()
    if not s.db_path.exists():
        return None
    try:
        con = connection.connect(s.db_path, read_only=True)
        try:
            return con.execute("SELECT MAX(finished_at) FROM sync_runs").fetchone()[0]
        finally:
            con.close()
    except sqlite3.Error:
        return None


def _invalidate_if_synced_elsewhere() -> None:
    now = time.monotonic()
    with _lock:
        if now - float(_sync_marker["checked"]) < INVALIDATE_CHECK_S:
            return
        _sync_marker["checked"] = now
    latest = _latest_sync()
    with _lock:
        changed = latest != _sync_marker["value"]
        _sync_marker["value"] = latest
    if changed:
        from . import catalog

        _cached.cache_clear()
        _region_index.cache_clear()
        catalog.clear()


def table(name: str) -> Table:
    _invalidate_if_synced_elsewhere()
    return _cached(name)


def clear_cache() -> None:
    from . import catalog

    _cached.cache_clear()
    _region_index.cache_clear()
    catalog.clear()
    with _lock:
        _sync_marker["checked"] = 0.0


def sample_tables() -> list[str]:
    """Kept for API compatibility: no table is ever served from a sample snapshot (decision 5)."""
    return []


# ---------------------------------------------------------------- regions

@lru_cache
def _region_index() -> dict[str, dict]:
    df = table("regions").df
    df = df.astype(object).where(pd.notna(df), None)  # NaN (e.g. missing parent_id) -> None
    return {r["id"]: r for r in df.to_dict("records")}


def regions() -> list[dict]:
    return list(_region_index().values())


def region(region_id: str) -> dict | None:
    return _region_index().get(region_id)


def division_ids() -> list[str]:
    return sorted(r["id"] for r in regions() if r["level"] == "division")


def resolve_division_scope(region_id: str) -> tuple[list[str], str]:
    """Map a region to the divisions whose data represent it.

    country -> all divisions; division -> itself; district -> its parent division (district-level
    data is not available, which the response states in `scopeNote`).
    """
    r = region(region_id)
    if r is None:
        raise KeyError(region_id)
    if r["level"] == "country":
        return division_ids(), "National totals = sum of the 8 divisions."
    if r["level"] == "division":
        return [r["id"]], "Division values."
    return [r["parent_id"]], (f"District-level data is not available; values shown are for the parent "
                              f"division ({region(r['parent_id'])['name']}).")


# ---------------------------------------------------------------- weather

def monthly(division: str | None = None) -> Table:
    t = table("weather_monthly")
    if t.df.empty:
        return t
    df = t.df if division is None else t.df[t.df["division"] == division]
    return Table(df.sort_values(["division", "year", "month"]).reset_index(drop=True), t.is_sample)


def climatology(division: str | None = None) -> Table:
    t = table("climatology")
    if t.df.empty:
        return t
    df = t.df if division is None else t.df[t.df["division"] == division]
    return Table(df.sort_values(["division", "month"]).reset_index(drop=True), t.is_sample)


def daily(division: str, start: str | None = None, end: str | None = None) -> Table:
    t = table("weather_daily")
    if t.df.empty:
        return t
    df = t.df[t.df["division"] == division]
    if start:
        df = df[df["date"] >= start]
    if end:
        df = df[df["date"] <= end]
    return Table(df.sort_values("date").reset_index(drop=True), t.is_sample)


def water_resources() -> tuple[dict[str, dict], bool]:
    t = table("water_resources")
    return {r["key"]: r for r in t.df.to_dict("records")}, t.is_sample


def inflow_shape() -> tuple[dict[int, float], bool]:
    t = table("inflow_shape")
    return {int(r["month"]): float(r["share"]) for r in t.df.to_dict("records")}, t.is_sample


def population_projection() -> Table:
    return table("population_projection")


def storage_anomaly() -> Table:
    return table("storage_anomaly")


def station_observations() -> Table:
    return table("station_observations")


def retrieved_at(source_id: str) -> str | None:
    df = table("sources").df
    if len(df) and "id" in df:
        hit = df[df["id"] == source_id]
        if len(hit):
            return hit.iloc[0]["retrieved_at"]
    f = get_settings().data_dir / "processed" / "sources_retrieved.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8")).get(source_id, {}).get("retrievedAt")
    return None


def sources() -> list[dict]:
    out = []
    for src in sources_registry():
        item = {k: src[k] for k in ("id", "name", "url", "license", "spatialResolution", "temporalResolution", "notes")}
        item["retrievedAt"] = retrieved_at(src["id"]) or "not retrieved"
        out.append(item)
    return out


def data_period() -> dict[str, str | None]:
    m = monthly().df
    if not len(m):
        return {"from": None, "to": None}
    first = m.sort_values(["year", "month"]).iloc[0]
    last = m.sort_values(["year", "month"]).iloc[-1]
    return {"from": f"{int(first.year)}-{int(first.month):02d}", "to": f"{int(last.year)}-{int(last.month):02d}"}


# ---------------------------------------------------------------- live forecast

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_DAILY = "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean,et0_fao_evapotranspiration"


@dataclass
class Forecast:
    daily: pd.DataFrame          # date, precip_mm, tmax_c, tmin_c, tmean_c, et0_mm, kind ('past'|'forecast')
    soil_moisture: float | None  # latest hourly 3-9 cm value (m3/m3), model data
    retrieved_at: str | None
    mode: str                    # 'live' | 'cache' | 'stored' | 'unavailable'
    is_sample: bool              # always False (kept for API compatibility)
    point_id: str | None = None  # 'stored': the divisional weather point whose forecast was used


def _parse_forecast(js: dict) -> tuple[pd.DataFrame, float | None]:
    df = pd.DataFrame(js["daily"]).rename(columns={
        "time": "date", "precipitation_sum": "precip_mm", "temperature_2m_max": "tmax_c",
        "temperature_2m_min": "tmin_c", "temperature_2m_mean": "tmean_c", "et0_fao_evapotranspiration": "et0_mm"})
    today = date.today().isoformat()
    df["kind"] = ["past" if d < today else "forecast" for d in df["date"]]
    sm = None
    hourly = js.get("hourly") or {}
    if hourly.get("soil_moisture_3_to_9cm"):
        now = datetime.now().strftime("%Y-%m-%dT%H:00")
        pairs = [(t, v) for t, v in zip(hourly["time"], hourly["soil_moisture_3_to_9cm"]) if v is not None and t <= now]
        if pairs:
            sm = float(pairs[-1][1])
    return df, sm


def forecast(lat: float, lon: float, cache_key: str) -> Forecast:
    s = get_settings()
    cache = s.data_dir / "raw" / "openmeteo" / "live" / f"forecast_{cache_key}.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < s.forecast_ttl_s:
        js = json.loads(cache.read_text(encoding="utf-8"))
        df, sm = _parse_forecast(js)
        return Forecast(df, sm, js.get("_retrievedAt"), "cache", False)
    if not s.offline:
        params = {"latitude": lat, "longitude": lon, "daily": _DAILY, "hourly": "soil_moisture_3_to_9cm",
                  "past_days": 7, "forecast_days": 16, "timezone": "Asia/Dhaka"}
        try:
            req = urllib.request.Request(f"{FORECAST_URL}?{urlencode(params)}",
                                         headers={"User-Agent": "AquaGuard-prototype/0.1"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                js = json.loads(resp.read())
            js["_retrievedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(js), encoding="utf-8")
            df, sm = _parse_forecast(js)
            return Forecast(df, sm, js["_retrievedAt"], "live", False)
        except Exception:
            pass
    # an expired cache is still the newest forecast for this exact point
    if cache.exists():
        js = json.loads(cache.read_text(encoding="utf-8"))
        df, sm = _parse_forecast(js)
        return Forecast(df, sm, js.get("_retrievedAt"), "cache", False)
    return stored_forecast(lat, lon)


FORECAST_COLUMNS = ["date", "precip_mm", "tmax_c", "tmin_c", "tmean_c", "et0_mm", "kind"]
_STORED_DAILY = {"precipitation_sum": "precip_mm", "temperature_2m_max": "tmax_c", "temperature_2m_min": "tmin_c",
                 "temperature_2m_mean": "tmean_c", "et0_fao_evapotranspiration": "et0_mm"}


def _nearest_weather_point(con: sqlite3.Connection, lat: float, lon: float) -> str | None:
    rows = con.execute("SELECT id, lat, lon FROM locations WHERE is_weather_point = 1 AND lat IS NOT NULL").fetchall()
    if not rows:
        return None
    return min(rows, key=lambda r: (r[1] - lat) ** 2 + (r[2] - lon) ** 2)[0]


def stored_forecast(lat: float, lon: float, past_days: int = 7) -> Forecast:
    """Forecast stored by the scheduled Open-Meteo sync for the nearest divisional weather point.

    The window is the newest stored 16-day forecast plus ``past_days`` before it (when sync is current: today-7 to
    today+15). When the scheduler has been stopped the newest stored run is returned as is; ``retrieved_at`` and
    mode 'stored' disclose its age."""
    s = get_settings()
    empty = Forecast(pd.DataFrame(columns=FORECAST_COLUMNS), None, None, "unavailable", False)
    if not s.db_path.exists():
        return empty
    dhaka_now = datetime.now(timezone.utc) + timedelta(hours=6)  # Asia/Dhaka (UTC+6, no DST)
    today = dhaka_now.date()
    try:
        con = connection.connect(s.db_path, read_only=True)
        try:
            point = _nearest_weather_point(con, lat, lon)
            if point is None:
                return empty
            names = ",".join("?" for _ in _STORED_DAILY)
            newest = con.execute(
                "SELECT MAX(valid_time) FROM weather_values WHERE location_id = ? AND data_kind = 'forecast' "
                "AND time_step = 'daily'", (point,)).fetchone()[0]
            if newest is None:
                return empty
            anchor = min(today, date.fromisoformat(newest[:10]) - timedelta(days=15))
            rows = con.execute(
                f"SELECT valid_time, variable, value, retrieved_at FROM weather_values WHERE location_id = ? "
                f"AND data_kind = 'forecast' AND time_step = 'daily' AND variable IN ({names}) AND valid_time >= ?",
                [point, *_STORED_DAILY, (anchor - timedelta(days=past_days)).isoformat()]).fetchall()
            sm = con.execute(
                "SELECT value FROM weather_values WHERE location_id = ? AND data_kind = 'forecast' "
                "AND time_step = 'hourly' AND variable = 'soil_moisture_3_to_9cm' AND valid_time <= ? "
                "ORDER BY valid_time DESC LIMIT 1", (point, dhaka_now.strftime("%Y-%m-%dT%H:00"))).fetchone()
        finally:
            con.close()
    except sqlite3.Error:
        return empty
    if not rows:
        return empty
    wide = (pd.DataFrame(rows, columns=["date", "variable", "value", "retrieved_at"])
            .pivot_table(index="date", columns="variable", values="value", aggfunc="last")
            .rename(columns=_STORED_DAILY).reset_index())
    for col in FORECAST_COLUMNS[1:-1]:
        if col not in wide:
            wide[col] = None
    wide["kind"] = ["past" if d < today.isoformat() else "forecast" for d in wide["date"]]
    retrieved = max(r[3] for r in rows)
    return Forecast(wide[FORECAST_COLUMNS].sort_values("date").reset_index(drop=True),
                    None if sm is None else float(sm[0]), retrieved, "stored", False, point)


def last_n_days_rain(division: str, n: int = 30) -> tuple[float | None, str | None, str | None, bool]:
    """Rainfall total for the last n days available in the archive (Historical reanalysis)."""
    t = table("weather_daily")
    if t.df.empty:
        return None, None, None, False
    df = t.df[t.df["division"] == division].dropna(subset=["precip_mm"])
    if not len(df):
        return None, None, None, t.is_sample
    end = df["date"].max()
    start = (date.fromisoformat(end) - timedelta(days=n - 1)).isoformat()
    window = df[df["date"] >= start]
    return float(window["precip_mm"].sum()), start, end, t.is_sample


def clim_rain_for_window(division: str, start: str, end: str) -> float | None:
    """1991-2020 normal rainfall for the same calendar days (mean over years of the daily window sums)."""
    t = table("weather_daily")
    if t.df.empty:
        return None
    df = t.df[t.df["division"] == division].copy()
    if not len(df):
        return None
    df["date"] = pd.to_datetime(df["date"])
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    totals = []
    for y in range(1991, 2021):
        try:
            ys = s.replace(year=y - (1 if s.year < e.year else 0))
            ye = e.replace(year=y)
        except ValueError:  # 29 Feb
            continue
        w = df[(df["date"] >= pd.Timestamp(ys)) & (df["date"] <= pd.Timestamp(ye))]
        if len(w) >= (ye - ys).days * 0.9:
            totals.append(float(w["precip_mm"].sum()))
    if len(totals) < 10:
        # Daily history not available (e.g. sample snapshot): fall back to the monthly normals.
        clim = climatology(division).df
        if not len(clim):
            return None
        days = pd.date_range(s, e)
        return float(sum(
            clim.loc[clim["month"] == d.month, "precip_mm"].iloc[0] / d.days_in_month for d in days))
    return sum(totals) / len(totals)
