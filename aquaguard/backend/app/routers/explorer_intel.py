"""3D Water Explorer spatial intelligence: regional analysis, division overview, time series, period comparison.

Read-only; every value comes from the stored data (services/spatial_intel.py). Districts are reference boundaries:
requesting one returns 422 `unsupported_region` (no district water values exist).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Query

from ..errors import ApiError
from ..schemas.explorer import ExplorerOverview, ExplorerSeries, PeriodComparison, RegionIntel
from ..schemas.v2 import Envelope
from ..services import catalog, spatial_intel as si, store
from .data_api import db

router = APIRouter(tags=["3D Water Explorer"])
YEARS = re.compile(r"^(\d{4})-(\d{4})$")
SOURCES = ["openmeteo_archive", "openmeteo_forecast", "grace_csr", "aquaguard_engine", "aquaguard_ml",
           "geoboundaries", "hdx_cod_ps"]
KINDS = ["reanalysis", "model_current", "satellite_monthly", "derived", "prediction", "reference", "statistic"]


def _region(conn, region: str) -> None:
    try:
        store.region(conn, region)
    except store.RegionError as e:
        district = "District" in str(e)
        raise ApiError(422 if district else 404, "unsupported_region" if district else "unknown_region",
                       str(e) + (" District boundaries are a reference layer: no district water values exist."
                                 if district else "")) from None


def _db_key(conn) -> str:
    row = conn.execute("SELECT MAX(finished_at) FROM sync_runs").fetchone()
    return f"intel|{row[0] if row else ''}"


@router.get("/explorer/intelligence", response_model=Envelope[RegionIntel])
def intelligence(region: str = "bd", conn=Depends(db)) -> Envelope[RegionIntel]:
    _region(conn, region)
    data = si.build(conn, region, _db_key(conn))
    level = "national" if data["region"]["level"] == "national" else "division"
    return Envelope(data=RegionIntel.model_validate(data), meta=catalog.meta(
        SOURCES, KINDS, "mixed", observed_at=(data["last12"] or {}).get("end"),
        note=f"Evidence-based analysis for {data['region']['name']} ({level}); every finding lists its values."))


@router.get("/explorer/overview", response_model=Envelope[ExplorerOverview])
def overview(conn=Depends(db)) -> Envelope[ExplorerOverview]:
    rows = si.overview(conn, _db_key(conn))
    return Envelope(data=ExplorerOverview.model_validate({
        "rows": rows, "normal": si.NORMAL,
        "notes": ["Bangladesh row: area-weighted mean of the eight representative points (weather) and the national "
                  "engine run (risk).",
                  "Scarcity risk is an estimate per division; districts have no water values.",
                  "Rainfall and temperature: last 12 complete months of ERA5 reanalysis vs the 1991–2020 normal."]}),
        meta=catalog.meta(SOURCES, KINDS, "mixed",
                          observed_at=max(((r["last12"] or {}).get("end") or "" for r in rows), default="") or None))


@router.get("/explorer/timeseries", response_model=Envelope[ExplorerSeries])
def timeseries(region: str = "bd", conn=Depends(db)) -> Envelope[ExplorerSeries]:
    _region(conn, region)
    d = si.timeseries(conn, region)
    g = d.pop("graceTrend") or {}
    d.update(graceTrendCmPerYr=g.get("trendCmPerYr"), graceTrendCi95=g.get("trendCi95"),
             graceTrendPeriod=(f"{g['period']['from'][:7]} to {g['period']['to'][:7]}" if g.get("period") else None))
    last = next((m["t"] for m in reversed(d["monthly"]) if m["complete"]), None)
    return Envelope(data=ExplorerSeries.model_validate(d), meta=catalog.meta(
        ["openmeteo_archive", "grace_csr"], ["reanalysis", "derived", "satellite_monthly"], "mixed", observed_at=last,
        note="Weather: complete months only (incomplete months carry no value). GRACE: national series, missing "
             "months are null (not interpolated)."))


@router.get("/explorer/compare", response_model=Envelope[PeriodComparison])
def compare(region: str = "bd", a: str = Query("1991-2000"), b: str = Query("2016-2025"),
            conn=Depends(db)) -> Envelope[PeriodComparison]:
    _region(conn, region)
    periods = []
    for name, v in (("a", a), ("b", b)):
        m = YEARS.match(v)
        if not m:
            raise ApiError(422, "invalid_period", f"{name} must be YYYY-YYYY.")
        y0, y1 = int(m.group(1)), int(m.group(2))
        if not 1991 <= y0 <= y1 <= 2100:
            raise ApiError(422, "invalid_period", f"{name}: years must be 1991 or later and in order.")
        periods.append((y0, y1))
    d = si.compare(conn, region, periods[0], periods[1])
    return Envelope(data=PeriodComparison.model_validate(d), meta=catalog.meta(
        ["openmeteo_archive", "grace_csr"], ["reanalysis", "derived", "satellite_monthly"], "mixed",
        note="Complete years only; GRACE national months present; no interpolation."))
