"""M2 3D Water Explorer: /map/layers and /weather."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from ..schemas.common import ScenarioParams, Series, SeriesPoint
from ..schemas.modules import LayerInfo, MapLayersResponse, RegionValues, WeatherResponse
from ..services import data_access as da
from ..services import ml_artifacts as mla
from ..services import regional
from ..services.measure import CLIMATE_NORMAL_AS_OF, engine, m
from ..settings import get_settings
from .deps import context, region_or_404, scenario_query

router = APIRouter(tags=["3D Water Explorer"])


@lru_cache
def _geo(name: str) -> dict:
    p = get_settings().data_dir / "geo" / name
    return json.loads(p.read_text(encoding="utf-8"))


LAYERS = [
    LayerInfo(id="boundaries", label="Division and district boundaries", provenance="historical",
              sourceIds=["geoboundaries"], description="geoBoundaries ADM1/ADM2, simplified."),
    LayerInfo(id="rivers", label="Rivers and canals (basemap waterways)", provenance="historical",
              sourceIds=["carto_basemap"], description="OpenStreetMap waterways rendered by the CARTO basemap."),
    LayerInfo(id="surface_water", label="Surface water occurrence (JRC GSW)", provenance="historical",
              sourceIds=["jrc_gsw"], description="Share of 1984-2021 Landsat observations with water, 30 m."),
    LayerInfo(id="groundwater_risk", label="Groundwater storage trend (GRACE, regional)", provenance="historical",
              sourceIds=["grace_csr"], description="One Bangladesh-wide value: ~300 km resolution, not well depth."),
    LayerInfo(id="scarcity", label="Scarcity risk (engine stress + ML dryness)", provenance="estimated",
              sourceIds=["aquaguard_engine", "aquaguard_ml"],
              description="Combined risk class per division; districts show their parent division."),
    LayerInfo(id="terrain", label="3D terrain (exaggerated)", provenance="historical", sourceIds=["aws_terrain"],
              description="Terrarium DEM tiles; vertical exaggeration labelled on the map."),
]


@router.get("/map/layers", response_model=MapLayersResponse)
def map_layers(region: str = "bd", scenario: ScenarioParams = Depends(scenario_query)) -> MapLayersResponse:
    region_or_404(region)
    run = regional.run(region, scenario)
    sc, smp = run.is_scenario, run.is_sample
    values: dict[str, RegionValues] = {}
    target = None
    clim = da.climatology().df
    for d, dr in regional.all_divisions(scenario).items():
        a, dd = dr.totals("annual"), dr.totals("dry")
        rk = regional.region_risk(dr, 1)
        f = rk["forecast"]
        target = f["targetMonth"] if f else target
        fprov = "simulated" if (f and f.get("simulated")) else "predicted"
        annual_rain = float(clim[clim["division"] == d]["precip_mm"].sum())
        values[d] = RegionValues(
            regionId=d, name=dr.region["name"], level="division", divisionId=d,
            annualRainfall=m(annual_rain, "mm", "historical", "openmeteo_archive", sample=smp,
                             as_of=CLIMATE_NORMAL_AS_OF, digits=0),
            forecastD=m(f["value"] if f else None, "mm", fprov, "aquaguard_ml", sample=smp,
                        as_of=(f["targetMonth"] + "-01") if f else None, low=f["low"] if f else None,
                        high=f["high"] if f else None, digits=1),
            forecastZ=m(rk["z"], "z-score", fprov, "aquaguard_ml", sample=smp, digits=2),
            stressRatio=engine(a["stressRatio"], "ratio", sc, smp, 4),
            dryStressRatio=engine(dd["stressRatio"], "ratio", sc, smp, 4),
            risk=rk["label"], riskLevel=rk["level"],
            population=m(dr.region["population"], "persons", "historical", "hdx_cod_ps", sample=smp,
                         as_of="2022-12-31", digits=0),
            area=m(dr.region["area_km2"], "km²", "estimated", "geoboundaries", sample=smp, digits=0))
    for r in da.regions():
        if r["level"] == "district" and r["parent_id"] in values:
            p = values[r["parent_id"]]
            values[r["id"]] = p.model_copy(update={
                "regionId": r["id"], "name": r["name"], "level": "district",
                "population": m(r["population"], "persons", "historical", "hdx_cod_ps", sample=smp,
                                as_of="2022-12-31", digits=0),
                "area": m(r["area_km2"], "km²", "estimated", "geoboundaries", sample=smp, digits=0)})
    g = mla.grace_trend()
    grace = (m(g["trendCmPerYr"], "cm/yr", "historical", "grace_csr", low=g["trendCi95"][0], high=g["trendCi95"][1],
               as_of=g["period"]["to"]) if g else m(None, "cm/yr", "historical", "grace_csr"))
    return MapLayersResponse(context=context(run), divisions=_geo("divisions.geojson"),
                             districts=_geo("districts.geojson"), values=values, layers=LAYERS, graceTrend=grace,
                             forecastTargetMonth=target)


@router.get("/weather", response_model=WeatherResponse)
def weather(region: str = "bd", start: str | None = None, end: str | None = None,
            agg: Literal["daily", "monthly"] = "monthly") -> WeatherResponse:
    region_or_404(region)
    run = regional.run(region)
    divs = run.divisions
    if agg == "monthly":
        t = da.monthly()
        df = t.df[t.df["division"].isin(divs)].copy()
        df["t"] = df["year"].astype(int).astype(str) + "-" + df["month"].astype(int).map("{:02d}".format)
        if start:
            df = df[df["t"] >= start[:7]]
        if end:
            df = df[df["t"] <= end[:7]]
    else:
        frames = [da.daily(d, start, end) for d in divs]
        t = frames[0]
        df = pd.concat([f.df for f in frames])
        df["t"] = df["date"]
        if len(df) > 4000 * len(divs):
            raise HTTPException(status_code=400, detail="Daily range too long; request at most ~10 years.")
    g = df.groupby("t").mean(numeric_only=True).reset_index().sort_values("t")
    smp = t.is_sample
    defs = [("precip_mm", "Rainfall", "mm"), ("tmean_c", "Mean temperature", "°C"), ("et0_mm", "ET0 (FAO-56)", "mm"),
            ("soil_moisture_m3m3", "Soil moisture 0-7 cm (model)", "m³/m³")]
    if "d_mm" in g:
        defs.insert(3, ("d_mm", "Climatic water balance P - ET0", "mm"))
    series = [Series(id=col, label=lab, points=[
        SeriesPoint(t=str(r["t"]), v=m(None if r[col] != r[col] else float(r[col]), unit, "historical",
                                       "openmeteo_archive", sample=smp, as_of=str(r["t"]), digits=3))
        for _, r in g.iterrows()]) for col, lab, unit in defs if col in g]
    return WeatherResponse(context=context(run), agg=agg, series=series)
