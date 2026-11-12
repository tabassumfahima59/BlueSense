"""Single read path for all stored data.

Order of preference for every table:
  1. SQLite database (data/aquaguard.db), built by `make data`.
  2. data/sample/<table>.csv — a frozen snapshot of the same schema, flagged is_sample = 1.
Live Open-Meteo forecasts: network (unless AQUAGUARD_OFFLINE) -> on-disk cache -> sample snapshot.
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
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd

from ..config.params import sources_registry
from ..settings import get_settings

_lock = threading.Lock()
_state = {"sample_tables": set()}  # tables served from the sample snapshot in this process


@dataclass(frozen=True)
class Table:
    df: pd.DataFrame
    is_sample: bool


def _db_available() -> bool:
    s = get_settings()
    return (not s.force_sample) and s.db_path.exists()


def _read(name: str) -> Table:
    s = get_settings()
    if _db_available():
        try:
            con = sqlite3.connect(f"file:{s.db_path}?mode=ro", uri=True)
            try:
                df = pd.read_sql_query(f"SELECT * FROM {name}", con)
            finally:
                con.close()
            if len(df):
                return Table(df, False)
        except sqlite3.Error:
            pass
    path = s.data_dir / "sample" / f"{name}.csv"
    if path.exists():
        with _lock:
            _state["sample_tables"].add(name)
        df = pd.read_csv(path)
        df["is_sample"] = 1
        return Table(df, True)
    return Table(pd.DataFrame(), True)


@lru_cache(maxsize=32)
def table(name: str) -> Table:
    return _read(name)


def clear_cache() -> None:
    table.cache_clear()
    _region_index.cache_clear()
    with _lock:
        _state["sample_tables"].clear()


def sample_tables() -> list[str]:
    with _lock:
        return sorted(_state["sample_tables"])


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
    df = t.df if division is None else t.df[t.df["division"] == division]
    return Table(df.sort_values(["division", "year", "month"]).reset_index(drop=True), t.is_sample)


def climatology(division: str | None = None) -> Table:
    t = table("climatology")
    df = t.df if division is None else t.df[t.df["division"] == division]
    return Table(df.sort_values(["division", "month"]).reset_index(drop=True), t.is_sample)


def daily(division: str, start: str | None = None, end: str | None = None) -> Table:
    t = table("weather_daily")
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
    s = get_settings()
    f = s.data_dir / "processed" / "sources_retrieved.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8")).get(source_id, {}).get("retrievedAt")
    readme = s.data_dir / "sample" / "README.json"
    if readme.exists():
        return json.loads(readme.read_text(encoding="utf-8")).get("sources_retrieved", {}).get(source_id, {}).get(
            "retrievedAt")
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
    mode: str                    # 'live' | 'cache' | 'sample'
    is_sample: bool


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
    # stale cache is better than nothing
    if cache.exists():
        js = json.loads(cache.read_text(encoding="utf-8"))
        df, sm = _parse_forecast(js)
        return Forecast(df, sm, js.get("_retrievedAt"), "cache", False)
    # ingestion-time forecast snapshot for the nearest division
    return _sample_forecast(lat, lon)


def _nearest_division(lat: float, lon: float) -> str:
    divs = [r for r in regions() if r["level"] == "division"]
    return min(divs, key=lambda r: (r["lat"] - lat) ** 2 + (r["lon"] - lon) ** 2)["id"]


def _sample_forecast(lat: float, lon: float) -> Forecast:
    s = get_settings()
    div = _nearest_division(lat, lon)
    for p in (s.data_dir / "raw" / "openmeteo" / f"forecast_{div}.json",
              s.data_dir / "sample" / f"forecast_{div}.json"):
        if Path(p).exists():
            js = json.loads(Path(p).read_text(encoding="utf-8"))
            df, sm = _parse_forecast(js)
            with _lock:
                _state["sample_tables"].add("forecast")
            return Forecast(df, sm, js.get("_retrievedAt"), "sample", True)
    with _lock:
        _state["sample_tables"].add("forecast")
    return Forecast(pd.DataFrame(columns=["date", "precip_mm", "tmax_c", "tmin_c", "tmean_c", "et0_mm", "kind"]),
                    None, None, "sample", True)


def last_n_days_rain(division: str, n: int = 30) -> tuple[float | None, str | None, str | None, bool]:
    """Rainfall total for the last n days available in the archive (Historical reanalysis)."""
    t = table("weather_daily")
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
