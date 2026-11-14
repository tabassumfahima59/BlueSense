"""M2 Smart Irrigation Advisor: /irrigation/estimate (FAO-56 engine + stored Open-Meteo forecast).

Weather (Deviation D5): the forecast stored by the scheduled sync for the nearest of the eight divisional weather
points, over the next ``WINDOW_DAYS`` local days. Days with missing ET0 or rainfall are never filled with 0: the window
stops before the first incomplete day and the missing dates are reported. When nothing is stored yet, the live request
(or its cache) is used. Every input is listed in ``why`` with its source and age; recent dryness of the division is
given as context and only changes the advice text, not the FAO-56 calculation.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from ..config.params import pentry, pval
from ..db import connection
from ..engine import fao56
from ..schemas.modules import AssumptionRow, IrrigationRequest, IrrigationResponse, WhyItem
from ..services import catalog, indicators, store
from ..services import data_access as da
from ..services.catalog import mv
from ..settings import get_settings

WINDOW_DAYS = 7

router = APIRouter(tags=["Smart Irrigation Advisor"])
NOTE = "Estimate — validate locally. This is not a field prescription; check with local extension services."


def _stage_offset(crop: fao56.Crop, stage: str) -> int:
    """Days since planting at the middle of the requested stage."""
    bounds = {"initial": (0, crop.l_ini), "development": (crop.l_ini, crop.l_ini + crop.l_dev),
              "mid-season": (crop.l_ini + crop.l_dev, crop.l_ini + crop.l_dev + crop.l_mid),
              "late season": (crop.l_ini + crop.l_dev + crop.l_mid, crop.season_days)}[stage]
    return (bounds[0] + bounds[1]) // 2


def _assumptions(crop_key: str, soil_key: str, efficiency: float, eff_from_user: bool) -> list[AssumptionRow]:
    c = pentry("fao56", "crops")[crop_key]
    s = pentry("fao56", "soils")
    rows = [
        AssumptionRow(key="Kc (ini / mid / end)", value=f"{c['kc']['ini']} / {c['kc']['mid']} / {c['kc']['end']}",
                      unit="-", source=c["kc_source"], assumption=False),
        AssumptionRow(key="Stage lengths (ini/dev/mid/late)", value="/".join(str(v) for v in c["stages_days"].values()),
                      unit="days", source=c["stages_source"], assumption=True),
        AssumptionRow(key="Default planting date", value=f"{c['planting']['day']:02d}-{c['planting']['month']:02d}",
                      unit="dd-mm", source=c["planting_source"], assumption=True),
        AssumptionRow(key="Rooting depth Zr / depletion fraction p", value=f"{c['zr_m']} / {c['p']}", unit="m / -",
                      source=c["zr_p_source"], assumption=True),
        AssumptionRow(key=f"Soil ({s[soil_key]['label']}) theta_FC / theta_WP",
                      value=f"{s[soil_key]['theta_fc']} / {s[soil_key]['theta_wp']}", unit="m³/m³",
                      source=s["source"], assumption=True),
        AssumptionRow(key="Irrigation efficiency", value=f"{efficiency:.2f}", unit="-",
                      source="User input" if eff_from_user else pentry("water_balance", "irrigation_efficiency")["source"],
                      assumption=not eff_from_user),
        AssumptionRow(key="Effective rainfall", value="USDA-SCS monthly method", unit="-",
                      source=pentry("fao56", "effective_rainfall_method"), assumption=False),
    ]
    if c["ponded"]:
        for k in ("land_preparation_mm", "percolation_mm_day", "ponding_depth_mm", "awd_saving_fraction"):
            e = pentry("fao56", "rice", k)
            rows.append(AssumptionRow(key=k.replace("_", " "), value=str(e["value"]), unit=e["unit"],
                                      source=e["source"], assumption=bool(e["assumption"])))
    return rows


@router.post("/irrigation/estimate", response_model=IrrigationResponse)
def estimate(req: IrrigationRequest) -> IrrigationResponse:
    crops = fao56.crops()
    if req.crop not in crops:
        raise HTTPException(status_code=422, detail=f"Unknown crop '{req.crop}'. Options: {sorted(crops)}")
    soils = [k for k in pentry("fao56", "soils") if k != "source"]
    if req.soil not in soils:
        raise HTTPException(status_code=422, detail=f"Unknown soil '{req.soil}'. Options: {soils}")
    crop = crops[req.crop]

    if req.lat is not None and req.lon is not None:
        lat, lon, name = req.lat, req.lon, f"{req.lat:.3f}, {req.lon:.3f}"
        key = f"{lat:.2f}_{lon:.2f}"
    else:
        r = da.region(req.region or "dhaka")
        if r is None or r["level"] == "country":
            raise HTTPException(status_code=422, detail="Provide a division/district region id or lat/lon.")
        lat, lon, name, key = float(r["lat"]), float(r["lon"]), r["name"], r["id"]

    fc = da.stored_forecast(lat, lon)  # nearest divisional weather point (D5)
    if fc.daily.empty:
        fc = da.forecast(lat, lon, key)  # nothing stored yet: live request, then its cache
    if fc.daily.empty:
        raise HTTPException(status_code=503, detail="No weather data available (stored, live or cached forecast).")
    today = (datetime.now(timezone.utc) + timedelta(hours=6)).date()  # Asia/Dhaka
    df = fc.daily.copy()
    window_note = None
    if df[df["date"] >= today.isoformat()].empty:
        first = (df[df["kind"] == "forecast"]["date"].min() if (df["kind"] == "forecast").any() else df["date"].min())
        today = date.fromisoformat(first)
        window_note = (f"The stored forecast ends before today, so its own window from {first} is evaluated "
                       f"(retrieved {_age(fc.retrieved_at)}). Refresh the weather data for a current estimate.")
    window = df[df["date"] >= today.isoformat()].sort_values("date").head(WINDOW_DAYS)
    complete, missing = [], []
    for row in window.itertuples():
        ok = _num(row.precip_mm) is not None and _num(row.et0_mm) is not None
        if ok and not missing:
            complete.append(row.Index)
        else:
            missing.append(str(row.date))
    if not complete:
        raise HTTPException(status_code=503, detail="The forecast has no complete day (ET0 and rainfall) to evaluate.")
    df = df.loc[complete].copy()
    future = df
    if req.temperatureOverrideC is not None:
        ratio = (future["tmean_c"] + req.temperatureOverrideC + 17.8) / (future["tmean_c"] + 17.8)
        df.loc[future.index, "et0_mm"] = future["et0_mm"] * ratio
    if req.rainfallOverrideMm is not None:
        df.loc[future.index, "precip_mm"] = req.rainfallOverrideMm / len(future)
    days = [{"date": d["date"], "et0_mm": _num(d["et0_mm"]), "precip_mm": _num(d["precip_mm"])}
            for d in df[["date", "et0_mm", "precip_mm"]].to_dict("records")]

    assumed_today = False
    if req.plantingDate:
        try:
            planting = date.fromisoformat(req.plantingDate)
        except ValueError as e:
            raise HTTPException(status_code=422, detail="plantingDate must be YYYY-MM-DD") from e
    elif req.stage:
        planting = today - timedelta(days=_stage_offset(crop, req.stage))
    else:
        planting = fao56.planting_date_for(crop, today)
        if not 0 <= (today - planting).days < crop.season_days:
            # The configured season is over: assume sowing/transplanting today rather than return nothing.
            planting = today
            assumed_today = True
    eff = req.efficiency if req.efficiency is not None else pval("water_balance", "irrigation_efficiency")
    try:
        a = fao56.advise(crop, req.soil, planting, today, days, req.areaHa, eff, fc.soil_moisture)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    overridden = req.temperatureOverrideC is not None or req.rainfallOverrideMm is not None
    kind = "scenario" if overridden else "derived"
    E = lambda v, u, d=2: mv(v, u, kind, "aquaguard_engine", "point", digits=d)  # noqa: E731
    fstatus = "fresh" if fc.mode in ("live", "cache") else catalog.status_of("openmeteo_forecast")
    window_obs = f"{a['periodFrom']} to {a['periodTo']}"
    F = lambda v, u, d=2, sim=False: mv(v, u, "scenario" if sim else "forecast", "openmeteo_forecast", "point",  # noqa: E731
                                        observed_at=window_obs, digits=d, status=fstatus)
    why, context, point = _why(req, crop, a, fc, planting, assumed_today, eff, fstatus, missing, name)
    recs = []
    if assumed_today:
        recs.append(f"The default {crop.label} season is not active today, so sowing/transplanting today "
                    f"({today.isoformat()}) was assumed. Enter your actual planting date for a better estimate.")
    if not a["inSeason"]:
        recs.append(f"The crop is outside its season for the selected dates ({a['stage']}); no irrigation is "
                    "estimated. Adjust the planting date or stage.")
    elif a["nextIrrigationDate"]:
        recs.append(f"Next irrigation around {a['nextIrrigationDate']}: apply about {a['perIrrigationGrossMm']:.0f} mm "
                    f"gross ({a['perIrrigationGrossM3']:,.0f} m³ for {req.areaHa:g} ha).")
    else:
        recs.append(f"No irrigation trigger reached between {a['periodFrom']} and {a['periodTo']} given forecast "
                    "rainfall; re-check as the forecast updates.")
    land_prep = pval("fao56", "rice", "land_preparation_mm")
    if crop.ponded and a["inSeason"] and a["daysSincePlanting"] == 0:
        recs.append(f"The requirement includes about {land_prep:.0f} mm of land-preparation water (puddling and initial "
                    f"flooding) needed at transplanting, about {fao56.mm_ha_to_m3(land_prep / eff, req.areaHa):,.0f} m³ "
                    f"gross for {req.areaHa:g} ha.")
    if crop.ponded and a["inSeason"]:
        saving = pval("fao56", "rice", "awd_saving_fraction")
        recs.append(f"Use Alternate Wetting and Drying (AWD): re-flood to ~5 cm when the field water level falls "
                    f"15 cm below the surface. At an assumed {saving:.0%} saving this period's gross need would fall "
                    f"by about {a['girM3'] * saving:,.0f} m³ (assumption — verify locally).")
    if eff < 0.75 and a["girMm"] > 0:
        better = a["nirMm"] / 0.75
        recs.append(f"Raising irrigation efficiency from {eff:.2f} to 0.75 (e.g. lined channels, buried pipes) "
                    f"would cut this period's gross requirement from {a['girMm']:.0f} to {better:.0f} mm.")
    if fc.soil_moisture is None:
        recs.append("Soil moisture was unavailable; the starting depletion was assumed (see assumptions).")
    dry = [c for c in context if c.dataKind == "derived" and any(w in c.value for w in ("dry", "deficient"))]
    if dry and a["inSeason"]:
        recs.append(f"Recent conditions at {point} are dry ({'; '.join(c.value for c in dry)}). The model soil "
                    "moisture may overstate field moisture: check the field before relying on the date above.")
    if missing:
        recs.append(f"The forecast has no complete ET0/rainfall for {', '.join(missing)}; the estimate covers "
                    f"{a['periodFrom']} to {a['periodTo']} only (missing days are never assumed to be dry).")
    return IrrigationResponse(
        crop=req.crop, cropLabel=crop.label, location={"name": name, "lat": lat, "lon": lon},
        weatherMode=fc.mode, weatherRetrievedAt=fc.retrieved_at, sampleData=False,
        period=f"{a['periodFrom']} to {a['periodTo']} ({a['periodDays']} days)", stage=a["stage"],
        daysSincePlanting=a["daysSincePlanting"], inSeason=a["inSeason"],
        et0=F(a["et0MeanMmDay"], "mm/day", 2, req.temperatureOverrideC is not None),
        kc=E(a["kcToday"], "-", 3), etc=E(a["etcMeanMmDay"], "mm/day"),
        rainfall=F(a["precipMm"], "mm", 1, req.rainfallOverrideMm is not None),
        effectiveRainfall=E(a["effectiveRainMm"], "mm", 1), riceExtra=E(a["riceExtraMm"], "mm", 1),
        netRequirementMm=E(a["nirMm"], "mm", 1), grossRequirementMm=E(a["girMm"], "mm", 1),
        netRequirementM3=E(a["nirM3"], "m³", 0), grossRequirementM3=E(a["girM3"], "m³", 0),
        taw=E(a["tawMm"], "mm", 1), raw=E(a["rawMm"], "mm", 1), trigger=E(a["triggerMm"], "mm", 1),
        startDepletion=E(a["startDepletionMm"], "mm", 1),
        startBasis=a["startBasis"],
        soilMoisture=mv(fc.soil_moisture, "m³/m³", "forecast", "openmeteo_forecast", "point", digits=3,
                        status=fstatus, note="Open-Meteo model estimate (3-9 cm), not a field measurement"),
        nextIrrigationDate=a["nextIrrigationDate"], interval=E(a["intervalDays"], "days", 1),
        perIrrigationGrossMm=E(a["perIrrigationGrossMm"], "mm", 1),
        perIrrigationGrossM3=E(a["perIrrigationGrossM3"], "m³", 0), daily=a["trace"], recommendations=recs,
        assumptions=_assumptions(req.crop, req.soil, eff, req.efficiency is not None), note=NOTE,
        why=why, context=context, forecastStatus=fstatus, pointId=fc.point_id, missingDays=missing,
        windowNote=window_note)


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _age(iso: str | None) -> str:
    if not iso:
        return "at an unknown time"
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    sec = max(0.0, (datetime.now(timezone.utc) - t).total_seconds())
    if sec < 3600:
        return f"{int(sec // 60)} min ago"
    if sec < 48 * 3600:
        return f"{int(sec // 3600)} h ago"
    return f"{int(sec // 86400)} days ago"


def _why(req, crop, a: dict, fc, planting: date, assumed_today: bool, eff: float, fstatus: str, missing: list[str],
         name: str) -> tuple[list[WhyItem], list[WhyItem], str]:
    """Every input of the estimate with its source and age, and the division's recent conditions."""
    c = pentry("fao56", "crops")[req.crop]
    soil = pentry("fao56", "soils")
    s = get_settings()
    point_name = name
    context: list[WhyItem] = []
    if fc.point_id and s.db_path.exists():
        conn = connection.connect(s.db_path, read_only=True)
        try:
            row = conn.execute("SELECT name FROM locations WHERE id = ?", (fc.point_id,)).fetchone()
            point_name = row[0] if row else fc.point_id
            vals = indicators.all_divisions(conn, str(s.db_path)).get(fc.point_id, {})
            for key, label in (("rain_30d_anomaly", "Rainfall, last 30 days vs 1991-2020"),
                               ("dryness_3m", "Seasonal dryness (3-month P - ET0)")):
                v, observed = vals.get(key, (None, None))
                if v is None:
                    continue
                cls = indicators.classify(key, v)
                unit = "%" if key == "rain_30d_anomaly" else ""
                text = f"{v:+.{0 if unit else 2}f}{unit} ({cls['label'] if cls else 'no class'})"
                context.append(WhyItem(label=label, value=text,
                                       source="ERA5 reanalysis via Open-Meteo", dataKind="derived", observedAt=observed,
                                       status=catalog.status_of("openmeteo_archive")))
            st = store.stat(conn, 4550)
            if st:
                context.append(WhyItem(label="National water stress (SDG 6.4.2)",
                                       value=f"{st['value']:.1f}% ({store.sdg_class(st['value'])[0]}), national",
                                       source="FAO AQUASTAT", dataKind="statistic", observedAt=str(st["year"]),
                                       status=catalog.status_of("fao_aquastat")))
        finally:
            conn.close()
    ret = fc.retrieved_at
    why = [
        WhyItem(label="Weather point", value=f"{point_name} representative point (one of eight divisional points)",
                source="geoBoundaries / AquaGuard locations", dataKind="reference"),
        WhyItem(label="Reference ET0", value=f"{a['et0MeanMmDay']:.1f} mm/day mean, {a['periodFrom']} to {a['periodTo']}",
                source=f"Open-Meteo forecast ({fc.mode})", dataKind="forecast", observedAt=a["periodFrom"],
                retrievedAt=ret, age=_age(ret), status=fstatus),
        WhyItem(label="Rainfall", value=f"{a['precipMm']:.1f} mm forecast, {a['effectiveRainMm']:.1f} mm effective "
                                        "(USDA-SCS method scaled to the period)",
                source=f"Open-Meteo forecast ({fc.mode})", dataKind="forecast", observedAt=a["periodFrom"],
                retrievedAt=ret, age=_age(ret), status=fstatus),
        WhyItem(label="Soil moisture (start)",
                value=(f"{fc.soil_moisture:.3f} m³/m³ model estimate -> starting depletion {a['startDepletionMm']:.0f} mm"
                       if fc.soil_moisture is not None else f"unavailable -> {a['startBasis']}"),
                source="Open-Meteo model (3-9 cm), not a field measurement", dataKind="forecast",
                retrievedAt=ret, age=_age(ret), status=fstatus if fc.soil_moisture is not None else "unavailable"),
        WhyItem(label="Crop coefficient", value=f"Kc {a['kcToday']:.2f} today ({a['stage']}, day {a['daysSincePlanting']})",
                source=c["kc_source"], dataKind="reference"),
        WhyItem(label="Planting date", value=planting.isoformat() + (" (assumed today: season not active)" if assumed_today
                                                                     else " (entered)" if req.plantingDate
                                                                     else " (from growth stage)" if req.stage
                                                                     else " (typical date)"),
                source="User input" if (req.plantingDate or req.stage) else c["planting_source"], dataKind="reference"),
        WhyItem(label="Soil", value=f"{soil[req.soil]['label']}: TAW {a['tawMm']:.0f} mm, RAW {a['rawMm']:.0f} mm",
                source=soil["source"], dataKind="reference"),
        WhyItem(label="Irrigation efficiency", value=f"{eff:.2f}",
                source="User input" if req.efficiency is not None else pentry("water_balance", "irrigation_efficiency")["source"],
                dataKind="reference"),
    ]
    if missing:
        why.append(WhyItem(label="Incomplete forecast days", value=", ".join(missing), source="Open-Meteo forecast",
                           dataKind="forecast", status="unavailable"))
    return why, context, point_name
