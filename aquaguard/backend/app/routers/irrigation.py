"""M7 Smart Irrigation Advisor: /irrigation/estimate (FAO-56 engine + Open-Meteo forecast)."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from ..config.params import pentry, pval
from ..engine import fao56
from ..schemas.modules import AssumptionRow, IrrigationRequest, IrrigationResponse
from ..services import data_access as da
from ..services.measure import m

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

    fc = da.forecast(lat, lon, key)
    if fc.daily.empty:
        raise HTTPException(status_code=503, detail="No weather data available (live, cached or sample).")
    today = date.today()
    df = fc.daily.copy()
    if df[df["date"] >= today.isoformat()].empty:
        # Sample snapshot is older than today: evaluate its own forecast window instead of failing.
        today = date.fromisoformat(df[df["kind"] == "forecast"]["date"].min() if (df["kind"] == "forecast").any()
                                   else df["date"].min())
    future = df[df["date"] >= today.isoformat()]
    if req.temperatureOverrideC is not None:
        ratio = (future["tmean_c"] + req.temperatureOverrideC + 17.8) / (future["tmean_c"] + 17.8)
        df.loc[future.index, "et0_mm"] = future["et0_mm"] * ratio
    if req.rainfallOverrideMm is not None:
        df.loc[future.index, "precip_mm"] = req.rainfallOverrideMm / len(future)
    days = df[["date", "et0_mm", "precip_mm"]].to_dict("records")

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

    smp = fc.is_sample
    wprov = "predicted"
    overridden = req.temperatureOverrideC is not None or req.rainfallOverrideMm is not None
    est = "simulated" if overridden else "estimated"
    E = lambda v, u, d=2: m(v, u, est, "aquaguard_engine", sample=smp, digits=d)  # noqa: E731
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
    return IrrigationResponse(
        crop=req.crop, cropLabel=crop.label, location={"name": name, "lat": lat, "lon": lon},
        weatherMode=fc.mode, weatherRetrievedAt=fc.retrieved_at, sampleData=smp,
        period=f"{a['periodFrom']} to {a['periodTo']} ({a['periodDays']} days)", stage=a["stage"],
        daysSincePlanting=a["daysSincePlanting"], inSeason=a["inSeason"],
        et0=m(a["et0MeanMmDay"], "mm/day", "simulated" if req.temperatureOverrideC is not None else wprov,
              "openmeteo_forecast", sample=smp, as_of=fc.retrieved_at),
        kc=E(a["kcToday"], "-", 3), etc=E(a["etcMeanMmDay"], "mm/day"),
        rainfall=m(a["precipMm"], "mm", "simulated" if req.rainfallOverrideMm is not None else wprov,
                   "openmeteo_forecast", sample=smp, as_of=fc.retrieved_at, digits=1),
        effectiveRainfall=E(a["effectiveRainMm"], "mm", 1), riceExtra=E(a["riceExtraMm"], "mm", 1),
        netRequirementMm=E(a["nirMm"], "mm", 1), grossRequirementMm=E(a["girMm"], "mm", 1),
        netRequirementM3=E(a["nirM3"], "m³", 0), grossRequirementM3=E(a["girM3"], "m³", 0),
        taw=E(a["tawMm"], "mm", 1), raw=E(a["rawMm"], "mm", 1), trigger=E(a["triggerMm"], "mm", 1),
        startDepletion=E(a["startDepletionMm"], "mm", 1),
        startBasis=a["startBasis"],
        soilMoisture=m(fc.soil_moisture, "m³/m³", "predicted", "openmeteo_forecast", sample=smp,
                       as_of=fc.retrieved_at),
        nextIrrigationDate=a["nextIrrigationDate"], interval=E(a["intervalDays"], "days", 1),
        perIrrigationGrossMm=E(a["perIrrigationGrossMm"], "mm", 1),
        perIrrigationGrossM3=E(a["perIrrigationGrossM3"], "m³", 0), daily=a["trace"], recommendations=recs,
        assumptions=_assumptions(req.crop, req.soil, eff, req.efficiency is not None), note=NOTE)
