"""P3 data endpoints with the ``{data, meta}`` envelope: weather, water, groundwater, dashboard, predictions,
water budget, what-if and irrigation recommendations. Existing endpoints are unchanged (backward compatible).

All take ``region`` = ``bd`` (national) or a division id. Districts are rejected (decision 6). National statistics
are never split into divisions (decision 1): for a division they are returned as national data and labelled so.
"""
from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query

from ..config.params import pval
from ..db import connection
from ..errors import ApiError
from ..schemas.common import Measure
from ..schemas.modules import IrrigationRequest, IrrigationResponse, ScenarioRequest
from ..schemas.v2 import (
    BudgetLink,
    BudgetNode,
    DashboardSummary,
    Envelope,
    GridCell,
    GroundwaterPoint,
    GroundwaterTrends,
    Kpi,
    NationalBudget,
    PredictionPoint,
    Predictions,
    RegionRef,
    ScarcityIndicator,
    SeriesValues,
    StatValue,
    WaterAvailability,
    WaterBudget,
    WaterScarcity,
    WeatherCurrent,
    WeatherSeries,
    WhatIf,
)
from ..services import catalog, regional, store
from ..services import ml_artifacts as mla
from ..services.catalog import NATIONAL_DATA_NOTE, NATIONAL_WEATHER_NOTE, mv
from ..settings import get_settings

router = APIRouter(tags=["Data API (P3)"])
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
GRACE_QUANTITY = "Total water storage (TWS) anomaly, cm equivalent water height — not a groundwater level"
GRACE_RESOLUTION = ("CSR RL06.3 mascons: 0.25° grid of 1° equal-area mascons, native resolution ~300 km. "
                    "Regional context only; never a division score.")


def db() -> Iterator:
    s = get_settings()
    if not s.db_path.exists():
        raise ApiError(503, "unavailable", "The database is not available.")
    conn = connection.connect(s.db_path, read_only=True)
    try:
        yield conn
    finally:
        conn.close()


def resolve(conn, region_id: str) -> dict:
    try:
        return store.region(conn, region_id)
    except store.RegionError as e:
        raise ApiError(422 if "District" in str(e) else 404,
                       "unsupported_region" if "District" in str(e) else "unknown_region", str(e)) from None


def ref(reg: dict) -> RegionRef:
    return RegionRef(id=reg["id"], name=reg["name"], level=reg["level"])


def level(reg: dict) -> str:
    return "national" if reg["level"] == "country" else "division"


def weather_level(reg: dict) -> str:
    return "national" if reg["level"] == "country" else "point"


def _local(t: str | None) -> str | None:
    """Weather valid_time (Asia/Dhaka local) with its UTC offset for unambiguous display."""
    return None if t is None else (t + "+06:00" if "T" in t else t)


# ---------------------------------------------------------------- weather

@router.get("/weather/current", response_model=Envelope[WeatherCurrent])
def weather_current(region: str = "bd", conn=Depends(db)) -> Envelope[WeatherCurrent]:
    reg = resolve(conn, region)
    cur = store.current(conn, reg)
    lvl = weather_level(reg)
    note = NATIONAL_WEATHER_NOTE if reg["level"] == "country" else "Value at the division's representative point."
    values = {var: mv(v["value"], v["unit"], "model_current", "openmeteo_forecast", lvl,
                      observed_at=_local(v["observed"]), digits=2,
                      note="Weather-model estimate of current conditions, not a station reading.")
              for var, v in cur["values"].items()}
    return Envelope(data=WeatherCurrent(region=ref(reg), validTime=_local(cur["valid_time"]), timezone=store.TIMEZONE,
                                        values=values, points=cur["points"]),
                    meta=catalog.meta(["openmeteo_forecast"], ["model_current"], lvl,
                                      observed_at=_local(cur["valid_time"]), note=note))


def _series(wide: dict, labels: dict, units: dict, digits: int = 2) -> list[SeriesValues]:
    out = []
    for var, label in labels.items():
        pts = wide.get(var, {})
        label_text, unit = label if isinstance(label, tuple) else (label, units.get(var, ""))
        out.append(SeriesValues(variable=var, label=label_text, unit=unit, t=list(pts),
                                v=[None if v is None else round(v, digits) for v in pts.values()]))
    return out


@router.get("/weather/forecast", response_model=Envelope[WeatherSeries])
def weather_forecast(region: str = "bd", days: int = Query(7, ge=1, le=16),
                     step: Literal["daily", "hourly"] = "daily", conn=Depends(db)) -> Envelope[WeatherSeries]:
    if step == "hourly" and days > 7:
        raise ApiError(422, "invalid_range", "Hourly forecasts are served for at most 7 days.")
    reg = resolve(conn, region)
    f = store.forecast(conn, reg, days, step)
    series = _series(f["wide"], f["labels"], f["units"])
    lvl = weather_level(reg)
    has = any(s.t for s in series)
    note = (NATIONAL_WEATHER_NOTE if reg["level"] == "country" else "Forecast at the division's representative point.")
    if not has:
        note += " No stored forecast covers this period."
    return Envelope(data=WeatherSeries(region=ref(reg), step=step, timezone=store.TIMEZONE, start=f["start"],
                                       end=f["end"], series=series),
                    meta=catalog.meta(["openmeteo_forecast"], ["forecast"], lvl, retrieved_at=f["retrieved_at"],
                                      note=note, status=None if has else "unavailable"))


@router.get("/weather/history", response_model=Envelope[WeatherSeries])
def weather_history(region: str = "bd", start: str | None = None, end: str | None = None,
                    step: Literal["daily", "monthly"] = "monthly", conn=Depends(db)) -> Envelope[WeatherSeries]:
    reg = resolve(conn, region)
    pattern = DAY_RE if step == "daily" else MONTH_RE
    for name, v in (("start", start), ("end", end)):
        if v is not None and not pattern.match(v):
            raise ApiError(422, "invalid_date", f"{name} must be {'YYYY-MM-DD' if step == 'daily' else 'YYYY-MM'}.")
    last = conn.execute("SELECT MAX(date) FROM weather_daily").fetchone()[0] or date.today().isoformat()
    if step == "daily":
        end = end or last
        start = start or (date.fromisoformat(end) - timedelta(days=89)).isoformat()
        if (date.fromisoformat(end) - date.fromisoformat(start)).days > 3660:
            raise ApiError(422, "invalid_range", "Daily history is served for at most 10 years per request.")
    else:
        end = end or last[:7]
        y, m = int(end[:4]), int(end[5:7])
        start = start or f"{y - 2 + (m == 12):04d}-{m % 12 + 1:02d}"
    if start > end:
        raise ApiError(422, "invalid_range", "start must not be after end.")
    h = store.history(conn, reg, start, end, step)
    series = _series(h["wide"], h["columns"], {}, 3)
    lvl = weather_level(reg)
    note = "ERA5/ERA5-Land reanalysis via Open-Meteo."
    if reg["level"] == "country":
        note = NATIONAL_WEATHER_NOTE + " " + note
    if not any(s.t for s in series):
        note += " No data in this range."
    observed = max((s.t[-1] for s in series if s.t), default=None)
    return Envelope(data=WeatherSeries(region=ref(reg), step=step, timezone=store.TIMEZONE, start=start, end=end,
                                       series=series),
                    meta=catalog.meta(["openmeteo_archive"], ["reanalysis"] + (["derived"] if step == "monthly" else []),
                                      lvl, observed_at=observed, note=note))


# ---------------------------------------------------------------- water (AQUASTAT national, GRACE regional)

AVAILABILITY = [(4188, "trwr", "Total renewable water resources"),
                (4185, "surface_renewable", "Total renewable surface water"),
                (4187, "groundwater_renewable", "Total renewable groundwater"),
                (4176, "surface_external", "Surface water entering the country (external)"),
                (4549, "efr", "Environmental flow requirements")]


def stat_value(conn, code: int, key: str, label: str) -> StatValue | None:
    s = store.stat(conn, code)
    if not s:
        return None
    unit = store.AQUASTAT_UNIT.get(s["unit"], s["unit"])
    value = mv(s["value"], unit, "statistic", "fao_aquastat", "national", observed_at=str(s["year"]),
               reference_year=s["year"], note=f"AQUASTAT symbol {s['symbol']}" if s["symbol"] else None)
    prev = s["previous"]
    previous = change = None
    if prev:
        previous = mv(prev["value"], unit, "statistic", "fao_aquastat", "national", observed_at=str(prev["year"]),
                      reference_year=prev["year"])
        change = mv(s["value"] - prev["value"], unit, "derived", "fao_aquastat", "national",
                    note=f"Reference year {s['year']} vs {prev['year']}")
    return StatValue(key=key, label=label, value=value, previous=previous, change=change)


def grace_latest(conn) -> tuple:
    series = store.grace_series(conn)
    if not series:
        return series, None, None, None
    t, v = series[-1]
    last_year = f"{int(t[:4]) - 1}{t[4:]}"
    prev = next((x for x in series if x[0] == last_year), None)
    latest = mv(v, "cm", "satellite_monthly", "grace_csr", "regional", observed_at=t[:7], note=GRACE_QUANTITY)
    prev_m = (mv(prev[1], "cm", "satellite_monthly", "grace_csr", "regional", observed_at=prev[0][:7])
              if prev else None)
    change = (mv(v - prev[1], "cm", "derived", "grace_csr", "regional", note=f"{t[:7]} vs {prev[0][:7]}")
              if prev else None)
    return series, latest, prev_m, change


def grace_trend_measure() -> Measure | None:
    g = mla.grace_trend()
    if not g:
        return None
    return mv(g["trendCmPerYr"], "cm/yr", "derived", "grace_csr", "regional", observed_at=g["period"]["to"][:7],
              low=g["trendCi95"][0], high=g["trendCi95"][1],
              note="OLS trend of the national TWS anomaly with seasonal harmonics; regional (~300 km).")


@router.get("/water/availability", response_model=Envelope[WaterAvailability])
def water_availability(region: str = "bd", conn=Depends(db)) -> Envelope[WaterAvailability]:
    reg = resolve(conn, region)
    rows = [v for code, key, label in AVAILABILITY if (v := stat_value(conn, code, key, label))]
    _, latest, _, _ = grace_latest(conn)
    years = sorted({r.value.referenceYear for r in rows if r.value.referenceYear})
    note = None if reg["level"] == "country" else NATIONAL_DATA_NOTE
    return Envelope(data=WaterAvailability(region=ref(reg), nationalOnly=reg["level"] != "country", renewable=rows,
                                           storage=latest, storageTrend=grace_trend_measure()),
                    meta=catalog.meta(["fao_aquastat", "grace_csr"], ["statistic", "satellite_monthly"], "national",
                                      observed_at=str(years[-1]) if years else None, note=note))


def weather_indicators(conn, reg: dict) -> list[ScarcityIndicator]:
    pts = store.points_for(conn, reg)
    lvl = weather_level(reg)
    per = {p: (store.rain_30d(conn, p), store.forecast_window(conn, p, 7), store.water_balance_3m_z(conn, p))
           for p in pts}

    def agg(fn):
        return store.weighted({p: fn(*per[p]) for p in pts}, pts)

    r0 = next((v[0] for v in per.values() if v[0]), None)
    f0 = next((v[1] for v in per.values() if v[1]), None)
    d0 = next((v[2] for v in per.values() if v[2]), None)
    out = []
    anomaly = agg(lambda r, f, d: r["anomalyPct"] if r else None)
    out.append(ScarcityIndicator(
        key="rain_30d_anomaly", label="Rainfall, last 30 days vs 1991-2020 mean",
        value=mv(anomaly, "%", "derived", "openmeteo_archive", lvl, observed_at=r0["end"] if r0 else None, digits=1),
        method="(sum of the last 30 days - mean of the same days 1991-2020) / mean x 100, ERA5 reanalysis"))
    vs_ly = agg(lambda r, f, d: (r["total"] - r["lastYear"]) if r and r["lastYear"] is not None else None)
    out.append(ScarcityIndicator(
        key="rain_30d_vs_last_year", label="Rainfall, last 30 days minus the same days last year",
        value=mv(vs_ly, "mm", "derived", "openmeteo_archive", lvl, observed_at=r0["end"] if r0 else None, digits=1),
        method="difference of 30-day reanalysis totals"))
    bal = agg(lambda r, f, d: (r["total"] - r["et0"]) if r and r["et0"] is not None else None)
    out.append(ScarcityIndicator(
        key="water_balance_30d", label="Climatic water balance P - ET0, last 30 days",
        value=mv(bal, "mm", "reanalysis", "openmeteo_archive", lvl, observed_at=r0["end"] if r0 else None, digits=1),
        method="30-day sum of reanalysis precipitation minus FAO-56 reference ET0"))
    fbal = agg(lambda r, f, d: f["balance"] if f else None)
    out.append(ScarcityIndicator(
        key="water_balance_next_7d", label="Climatic water balance P - ET0, next 7 days (forecast)",
        value=mv(fbal, "mm", "forecast", "openmeteo_forecast", lvl, observed_at=f0["end"] if f0 else None, digits=1),
        method="7-day sum of forecast precipitation minus forecast ET0"))
    need = agg(lambda r, f, d: store.reference_crop_need(r))
    out.append(ScarcityIndicator(
        key="reference_crop_need_30d", label="Reference-crop irrigation need, last 30 days",
        value=mv(need, "mm", "derived", "openmeteo_archive", lvl, observed_at=r0["end"] if r0 else None, digits=1,
                 note="Reference-crop estimate (Kc = 1), not a crop-specific recommendation."),
        method="max(0, ET0 - Pe) with USDA-SCS effective rainfall scaled to the 30-day period"))
    z = agg(lambda r, f, d: d["z"] if d else None)
    label, lv = store.spi_class(z) if z is not None else (None, None)
    out.append(ScarcityIndicator(
        key="dryness_3m", label="Seasonal dryness, last 3 months (P - ET0 z-score)",
        value=mv(z, "z-score", "derived", "openmeteo_archive", lvl, observed_at=d0["end"] if d0 else None, digits=2),
        classLabel=label, classLevel=lv,
        method="normal z-score of 3-month P - ET0 against the same months 1991-2020; SPI classes (WMO-No. 1090)"))
    return out


@router.get("/water/scarcity", response_model=Envelope[WaterScarcity])
def water_scarcity(region: str = "bd", conn=Depends(db)) -> Envelope[WaterScarcity]:
    reg = resolve(conn, region)
    stats = []
    s = store.stat(conn, 4550)
    if s:
        label, lv = store.sdg_class(s["value"])
        stats.append(ScarcityIndicator(
            key="sdg642_water_stress", label="Water stress (SDG 6.4.2)",
            value=mv(s["value"], "%", "statistic", "fao_aquastat", "national", observed_at=str(s["year"]),
                     reference_year=s["year"], digits=2),
            classLabel=label, classLevel=lv,
            method="total freshwater withdrawal / (total renewable water resources - environmental flow) x 100 "
                   "(FAO AQUASTAT variable 4550)"))
    note = (NATIONAL_WEATHER_NOTE + " Water stress is a national statistic." if reg["level"] == "country" else
            "Water stress (SDG 6.4.2) is national data; the division has weather-derived indicators only.")
    return Envelope(data=WaterScarcity(region=ref(reg), statistics=stats, weather=weather_indicators(conn, reg),
                                       note=note),
                    meta=catalog.meta(["fao_aquastat", "openmeteo_archive", "openmeteo_forecast"],
                                      ["statistic", "reanalysis", "derived", "forecast"], "mixed", note=note))


@router.get("/groundwater/trends", response_model=Envelope[GroundwaterTrends])
def groundwater_trends(region: str = "bd", start: str | None = None, end: str | None = None,
                       cells: bool = False, conn=Depends(db)) -> Envelope[GroundwaterTrends]:
    reg = resolve(conn, region)
    for name, v in (("start", start), ("end", end)):
        if v is not None and not MONTH_RE.match(v):
            raise ApiError(422, "invalid_date", f"{name} must be YYYY-MM.")
    series, latest, prev, change = grace_latest(conn)
    window = [(t, v) for t, v in series if (not start or t[:7] >= start) and (not end or t[:7] <= end)]
    grid, period = [], None
    if cells and series:
        period = series[-1][0]
        grid = [GridCell(id=c[0], lat=c[1], lon=c[2], v=round(c[3], 3)) for c in store.grace_cells(conn, period)]
    trend = grace_trend_measure()
    g = mla.grace_trend() or {}
    note = GRACE_RESOLUTION + ("" if reg["level"] == "country" else " The same regional series is shown for every "
                               "division.") + ("" if window else " No data in this range.")
    return Envelope(data=GroundwaterTrends(
        region=ref(reg), quantity=GRACE_QUANTITY, series=[GroundwaterPoint(t=t[:7], v=round(v, 3)) for t, v in window],
        latest=latest, sameMonthLastYear=prev, change=change, trend=trend, trendMethod=g.get("method"),
        cells=grid, cellsPeriod=period[:7] if period else None, resolutionNote=GRACE_RESOLUTION),
        meta=catalog.meta(["grace_csr"], ["satellite_monthly"], "regional", unit="cm",
                          observed_at=series[-1][0][:7] if series else None, note=note))


# ---------------------------------------------------------------- dashboard summary (Command Center KPIs, §3)

def _kpi_stat(conn, code: int, key: str, label: str, formula: str) -> Kpi | None:
    sv = stat_value(conn, code, key, label)
    if sv is None:
        return None
    return Kpi(key=key, label=label, value=sv.value, comparison=sv.change,
               comparisonLabel=(f"vs reference year {sv.previous.referenceYear}" if sv.previous else None),
               formula=formula)


@router.get("/dashboard/summary", response_model=Envelope[DashboardSummary])
def dashboard_summary(region: str = "bd", targetEfficiency: float | None = Query(None, ge=0.3, le=0.95),
                      conn=Depends(db)) -> Envelope[DashboardSummary]:
    reg = resolve(conn, region)
    national_note = None if reg["level"] == "country" else NATIONAL_DATA_NOTE
    kpis: list[Kpi] = []
    k = _kpi_stat(conn, 4188, "availability", "Water availability",
                  "AQUASTAT total renewable water resources (variable 4188), national long-term average")
    if k:
        trend = grace_trend_measure()
        k.context = [trend] if trend else []
        k.note = national_note
        kpis.append(k)
    if reg["level"] == "country":
        k = _kpi_stat(conn, 4253, "demand", "Water demand",
                      "AQUASTAT total freshwater withdrawal (variable 4253), national")
        if k:
            k.note = (f"Latest genuine AQUASTAT reference year is {k.value.referenceYear}; later AQUASTAT years are "
                      "imputed and not used.")
            kpis.append(k)
    else:
        r30 = store.rain_30d(conn, reg["id"])
        need = store.reference_crop_need(r30)
        kpis.append(Kpi(key="demand", label="Irrigation demand (weather-based)",
                        value=mv(need, "mm", "derived", "openmeteo_archive", "point",
                                 observed_at=r30["end"] if r30 else None, digits=1,
                                 note="Reference-crop estimate (Kc = 1) at the division's representative point."),
                        formula="last 30 days: max(0, ET0 - Pe), USDA-SCS effective rainfall (Kc = 1)",
                        note="National withdrawal statistics are not available per division."))
    s = store.stat(conn, 4550)
    if s:
        label, _ = store.sdg_class(s["value"])
        k = _kpi_stat(conn, 4550, "utilization", "Water utilization (SDG 6.4.2 water stress)",
                      "total withdrawal / (renewable resources - environmental flow) x 100")
        k.classLabel = label
        k.note = national_note
        kpis.append(k)
    _, latest, prev, change = grace_latest(conn)
    if latest:
        trend = grace_trend_measure()
        kpis.append(Kpi(key="groundwater", label="Water storage (GRACE TWS anomaly)", value=latest, comparison=change,
                        comparisonLabel=f"vs {prev.observedAt}" if prev else None,
                        formula="CSR RL06.3 national TWS anomaly (cm EWH, baseline 2004.0-2009.999)",
                        context=[trend] if trend else [],
                        note="Total water storage, not a groundwater level; regional (~300 km)."))
    agri = store.stat(conn, 4250)
    current = float(pval("water_balance", "irrigation_efficiency"))
    target = targetEfficiency if targetEfficiency is not None else 0.85
    if target <= current:
        raise ApiError(422, "invalid_parameter",
                       f"targetEfficiency must be above the current irrigation efficiency ({current:.2f}).")
    if agri:
        saving = agri["value"] * (1 - current / target)
        kpis.append(Kpi(
            key="saving", label="Potential water saving (scenario)",
            value=mv(saving, "km³/yr", "scenario", "fao_aquastat", "national", observed_at=str(agri["year"]),
                     reference_year=agri["year"], digits=2,
                     note=f"Assumption: irrigation efficiency rises from {current:.2f} to {target:.2f}."),
            formula="agricultural withdrawal (AQUASTAT 4250) x (1 - current efficiency / target efficiency)",
            context=[mv(agri["value"], "km³/yr", "statistic", "fao_aquastat", "national",
                        observed_at=str(agri["year"]), reference_year=agri["year"], digits=2),
                     mv(current, "ratio", "derived", "aquaguard_engine", "national",
                        note="Current efficiency: AQUASTAT irrigation requirement / agricultural withdrawal")],
            note=national_note))
    scope = ("bd",) if reg["level"] == "country" else (reg["id"], "bd")
    open_alerts = (conn.execute("SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL").fetchone()[0]
                   if reg["level"] == "country" else conn.execute(
                       "SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL AND location_id IN (?, ?)", scope
                   ).fetchone()[0])
    sources = ["fao_aquastat", "grace_csr"] + ([] if reg["level"] == "country" else ["openmeteo_archive"])
    return Envelope(data=DashboardSummary(region=ref(reg), kpis=kpis, openAlerts=open_alerts),
                    meta=catalog.meta(sources, ["statistic", "satellite_monthly", "derived", "scenario"], "mixed",
                                      note=national_note))


# ---------------------------------------------------------------- predictions

def _prediction_point(f: dict, h: int, lvl: str) -> PredictionPoint:
    observed = f["targetMonth"]
    return PredictionPoint(
        horizon=h, issuedMonth=f["issuedMonth"], targetMonth=f["targetMonth"],
        value=mv(f["value"], "mm", "prediction", "aquaguard_ml", lvl, observed_at=observed, low=f["low"],
                 high=f["high"], digits=1, note="90% interval from validation residuals"),
        normal=mv(f["climMean"], "mm", "derived", "openmeteo_archive", lvl, digits=1,
                  note="training-period mean for the target month"),
        z=mv(f["z"], "z-score", "prediction", "aquaguard_ml", lvl, observed_at=observed, digits=2),
        drynessClass=f.get("drynessClass"))


@router.get("/predictions", response_model=Envelope[Predictions])
def predictions(region: str = "bd", category: str = "water_balance", horizon: int = Query(1),
                conn=Depends(db)) -> Envelope[Predictions]:
    if category != "water_balance":
        raise ApiError(422, "unsupported_category",
                       "Only category 'water_balance' (climatic water balance P - ET0) has a working model.")
    if horizon not in mla.HORIZONS:
        raise ApiError(422, "invalid_parameter", "horizon must be 1, 3 or 6 (months).")
    reg = resolve(conn, region)
    lvl = level(reg)
    preds = mla.predictions()
    run = regional.run(reg["id"])
    all_h = []
    for h in mla.HORIZONS:
        f = regional.region_forecast(run, h)
        if f:
            all_h.append(_prediction_point(f, h, lvl))
    fc = next((p for p in all_h if p.horizon == horizon), None)
    end = conn.execute("SELECT MAX(printf('%04d-%02d', year, month)) FROM weather_monthly").fetchone()[0] or "2000-01"
    y, m = int(end[:4]), int(end[5:7])
    hist = store.history(conn, reg, f"{y - 3 + (m == 12):04d}-{m % 12 + 1:02d}", end, "monthly")
    pts = hist["wide"].get("d_mm", {})
    meta_ = mla.model_meta() or {}
    hm = meta_.get("horizons", {}).get(str(horizon), {})
    model = {"name": {"random_forest": "Random Forest", "xgboost": "XGBoost"}.get(hm.get("selected"), hm.get("selected")),
             "version": meta_.get("trainedAt"), "trainedAt": meta_.get("trainedAt"),
             "dataPeriod": (preds or {}).get("dataPeriod"), "trainSamples": hm.get("trainSamples"),
             "validationRmse": (hm.get("validationRmse") or {}).get(hm.get("selected")),
             "interval": hm.get("intervalMethod"), "trainingData": "ERA5 reanalysis (Open-Meteo archive), real data",
             "experimental": "no"}
    note = ("Prediction of the climatic water balance (P - ET0), not measured water availability."
            + (" " + NATIONAL_WEATHER_NOTE if reg["level"] == "country" else ""))
    return Envelope(data=Predictions(
        region=ref(reg), category=category, target=(preds or {}).get("target", "D = P - ET0 (mm/month)"),
        horizon=horizon, history=SeriesValues(variable="d_mm", label="Climatic water balance P - ET0 (ERA5)", unit="mm",
                                              t=list(pts), v=[None if v is None else round(v, 1) for v in pts.values()]),
        forecast=fc, allHorizons=all_h, model=model, storage="artifact"),  # predictions_v2 is filled in M5
        meta=catalog.meta(["aquaguard_ml", "openmeteo_archive"], ["prediction", "reanalysis"], lvl,
                          observed_at=fc.targetMonth if fc else None, note=note,
                          retrieved_at=(preds or {}).get("generatedAt"),
                          status=None if fc else "unavailable"))


# ---------------------------------------------------------------- water budget

BUDGET_PARTS = [(4250, "agriculture", "Agricultural withdrawal"), (4251, "municipal", "Municipal withdrawal"),
                (4252, "industrial", "Industrial withdrawal"), (4549, "environment", "Environmental flow requirement")]


def national_budget(conn) -> NationalBudget:
    nodes, links, missing, years = [], [], [], []
    trwr = store.stat(conn, 4188)
    notes = ["National AQUASTAT statistics; each value keeps its own reference year.",
             "Remainder = renewable resources minus all shown uses (derived), only when every part has data."]
    if trwr is None:
        return NationalBudget(nodes=[], links=[], referenceYears=[], mixedReferenceYears=False,
                              missing=["trwr"] + [k for _, k, _ in BUDGET_PARTS], notes=notes)
    unit = store.AQUASTAT_UNIT.get(trwr["unit"], trwr["unit"])
    nodes.append(BudgetNode(id="trwr", label="Total renewable water resources",
                            value=mv(trwr["value"], unit, "statistic", "fao_aquastat", "national",
                                     observed_at=str(trwr["year"]), reference_year=trwr["year"], digits=2)))
    years.append(trwr["year"])
    used = 0.0
    for code, key, label in BUDGET_PARTS:
        s = store.stat(conn, code)
        if s is None:
            missing.append(key)
            nodes.append(BudgetNode(id=key, label=f"{label} (no data)",
                                    value=mv(None, unit, "statistic", "fao_aquastat", "national")))
            continue
        v = mv(s["value"], unit, "statistic", "fao_aquastat", "national", observed_at=str(s["year"]),
               reference_year=s["year"], digits=2)
        nodes.append(BudgetNode(id=key, label=label, value=v))
        links.append(BudgetLink(source="trwr", target=key, value=v))
        used += s["value"]
        years.append(s["year"])
    if not missing:
        rem = mv(trwr["value"] - used, unit, "derived", "fao_aquastat", "national", digits=2,
                 note="Renewable resources minus withdrawals and environmental flow (mixed reference years)")
        nodes.append(BudgetNode(id="remainder", label="Remainder", value=rem))
        links.append(BudgetLink(source="trwr", target="remainder", value=rem))
    ys = sorted(set(years))
    return NationalBudget(nodes=nodes, links=links, referenceYears=ys, mixedReferenceYears=len(ys) > 1,
                          missing=missing, notes=notes)


@router.get("/water-budget", response_model=Envelope[WaterBudget])
def water_budget(region: str = "bd", mode: Literal["national", "derived"] = "national", period: str = "annual",
                 conn=Depends(db)) -> Envelope[WaterBudget]:
    reg = resolve(conn, region)
    note = None if reg["level"] == "country" else NATIONAL_DATA_NOTE
    if mode == "national":
        nb = national_budget(conn)
        return Envelope(data=WaterBudget(mode=mode, region=ref(reg), national=nb),
                        meta=catalog.meta(["fao_aquastat"], ["statistic", "derived"], "national",
                                          observed_at=str(nb.referenceYears[-1]) if nb.referenceYears else None,
                                          note=note, status=None if nb.nodes else "unavailable"))
    from .water_budget import budget

    try:
        period = regional.validate_period(period)
    except ValueError:
        raise ApiError(422, "invalid_parameter", "period must be 'annual', 'dry' or a month number 1-12.") from None
    legacy = budget(region="bd", period=period, scenario=ScenarioRequest().params)
    derived_note = "Monthly water-balance model (derived), national only (decision 8)."
    return Envelope(data=WaterBudget(mode=mode, region=ref(reg), derived=legacy.model_dump()),
                    meta=catalog.meta(["aquaguard_engine", "fao_aquastat", "openmeteo_archive"], ["derived"],
                                      "national", note=derived_note + (" " + note if note else "")))


# ---------------------------------------------------------------- what-if (national model)

@router.post("/whatif", response_model=Envelope[WhatIf])
def whatif(req: ScenarioRequest, conn=Depends(db)) -> Envelope[WhatIf]:
    reg = resolve(conn, req.region)
    from .what_if import run_scenario

    result = run_scenario(ScenarioRequest(region="bd", params=req.params))
    note = ("Deterministic national water-balance model; all outputs are scenario results."
            + ("" if reg["level"] == "country" else " " + NATIONAL_DATA_NOTE))
    return Envelope(data=WhatIf(region=ref(reg), result=result),
                    meta=catalog.meta(["aquaguard_engine", "fao_aquastat", "openmeteo_archive"], ["scenario"],
                                      "national", note=note))


# ---------------------------------------------------------------- irrigation recommendations (GET wrapper)

@router.get("/irrigation/recommendations", response_model=Envelope[IrrigationResponse])
def irrigation_recommendations(crop: str, region: str | None = None, lat: float | None = None,
                               lon: float | None = None, soil: str = "silty_clay_loam",
                               plantingDate: str | None = None,
                               stage: Literal["initial", "development", "mid-season", "late season"] | None = None,
                               areaHa: float = Query(1.0, gt=0, le=100000),
                               efficiency: float | None = Query(None, ge=0.3, le=0.95),
                               conn=Depends(db)) -> Envelope[IrrigationResponse]:
    if region is not None:
        resolve(conn, region)
    from pydantic import ValidationError

    from .irrigation import estimate

    try:
        req = IrrigationRequest(crop=crop, region=region, lat=lat, lon=lon, soil=soil, plantingDate=plantingDate,
                                stage=stage, areaHa=areaHa, efficiency=efficiency)
    except ValidationError as e:
        raise ApiError(422, "invalid_parameter", "; ".join(f"{err['loc'][-1]}: {err['msg']}" for err in e.errors())) from None
    res = estimate(req)
    status = "fresh" if res.weatherMode in ("live", "cache") else None
    meta = catalog.meta(["openmeteo_forecast", "aquaguard_engine"], ["forecast", "derived"], "point",
                        retrieved_at=res.weatherRetrievedAt, status=status,
                        note=f"Weather: {res.weatherMode}. Estimate — validate locally.")
    return Envelope(data=res, meta=meta)
