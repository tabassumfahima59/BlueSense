"""Open-Meteo adapters: historical archive (ERA5 reanalysis), forecast and GloFAS flood API.

Usage:
    python ml/fetch_openmeteo.py archive   # daily 1991-01-01 .. latest, 8 divisions (slow: rate limits)
    python ml/fetch_openmeteo.py forecast  # 7 past + 16 forecast days, 8 divisions
    python ml/fetch_openmeteo.py glofas    # daily river discharge at 3 river cells, 1991 .. latest
    python ml/fetch_openmeteo.py all

Raw responses are stored unchanged in data/raw/. Open-Meteo weights long requests as
multiple API calls, so archive requests are spaced out to stay inside the free limits.
Data: Open-Meteo.com, CC BY 4.0. ERA5 / ERA5-Land: Copernicus Climate Change Service.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, timedelta
from urllib.parse import urlencode

from common import RAW, http_get, load_divisions, load_geo_registry, now_iso, record_retrieval, write_json

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"

START_DATE = "1991-01-01"
DAILY_ARCHIVE = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "et0_fao_evapotranspiration",
    "soil_moisture_0_to_7cm_mean",
]
DAILY_FORECAST = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "et0_fao_evapotranspiration",
]
PAUSE_SECONDS = 75  # spacing between long archive requests (per-minute weighted limit)


def _archive_end() -> str:
    # The archive lags real time by several days; ask for data up to 7 days ago.
    return (date.today() - timedelta(days=7)).isoformat()


def fetch_archive() -> None:
    end = _archive_end()
    for i, d in enumerate(load_divisions()):
        out = RAW / "openmeteo" / f"archive_{d['id']}.json"
        params = {
            "latitude": d["lat"], "longitude": d["lon"],
            "start_date": START_DATE, "end_date": end,
            "daily": ",".join(DAILY_ARCHIVE), "timezone": "Asia/Dhaka",
        }
        print(f"[archive] {d['id']} {START_DATE}..{end}")
        body = http_get(f"{ARCHIVE_URL}?{urlencode(params)}", timeout=300, backoff=65)
        payload = json.loads(body)
        payload["_retrievedAt"] = now_iso()
        payload["_request"] = params
        write_json(out, payload)
        if i < 7:
            time.sleep(PAUSE_SECONDS)
    record_retrieval("openmeteo_archive", {"period": f"{START_DATE}/{end}", "points": 8})


def fetch_forecast() -> None:
    for d in load_divisions():
        params = {
            "latitude": d["lat"], "longitude": d["lon"],
            "daily": ",".join(DAILY_FORECAST),
            "hourly": "soil_moisture_3_to_9cm",
            "past_days": 7, "forecast_days": 16, "timezone": "Asia/Dhaka",
        }
        print(f"[forecast] {d['id']}")
        payload = json.loads(http_get(f"{FORECAST_URL}?{urlencode(params)}", timeout=60))
        payload["_retrievedAt"] = now_iso()
        payload["_request"] = params
        write_json(RAW / "openmeteo" / f"forecast_{d['id']}.json", payload)
        time.sleep(1)
    record_retrieval("openmeteo_forecast", {"points": 8})


def fetch_glofas() -> None:
    end = _archive_end()
    for g in load_geo_registry()["riverGauges"]:
        params = {
            "latitude": g["lat"], "longitude": g["lon"], "daily": "river_discharge",
            "start_date": START_DATE, "end_date": end,
        }
        print(f"[glofas] {g['id']}")
        payload = json.loads(http_get(f"{FLOOD_URL}?{urlencode(params)}", timeout=300, backoff=65))
        payload["_retrievedAt"] = now_iso()
        payload["_request"] = params
        write_json(RAW / "glofas" / f"discharge_{g['id']}.json", payload)
        time.sleep(10)
    record_retrieval("openmeteo_glofas", {"period": f"{START_DATE}/{end}", "cells": 3})


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("forecast", "all"):
        fetch_forecast()
    if what in ("glofas", "all"):
        fetch_glofas()
    if what in ("archive", "all"):
        fetch_archive()
