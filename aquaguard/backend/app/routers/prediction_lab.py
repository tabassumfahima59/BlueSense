"""M3 AI Water Prediction Lab: scarcity, demand, groundwater, metrics, SHAP."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config.params import pentry
from ..engine import risk as riskmod
from ..schemas.common import ScenarioParams, Series, SeriesPoint
from ..schemas.modules import (
    DemandResponse,
    DemandYear,
    ForecastPoint,
    GroundwaterResponse,
    MetricsResponse,
    ScarcityResponse,
    ShapResponse,
    TestPoint,
)
from ..services import data_access as da
from ..services import ml_artifacts as mla
from ..services import regional
from ..services.inputs import division_climates
from ..services.measure import engine, m
from .command_center import risk_class
from .deps import context, region_or_404, scenario_query

router = APIRouter(tags=["AI Water Prediction Lab"])

MODEL_NAMES = {"random_forest": "Random Forest", "xgboost": "XGBoost"}
LIMITATIONS = [
    "Target is the climatic water balance D = P - ET0 from ERA5 reanalysis at one point per division, "
    "not measured scarcity or water availability.",
    "Monthly rainfall is only weakly predictable months ahead; compare the model with the climatology "
    "baseline in the metrics panel before relying on it.",
    "The 90% interval comes from validation residuals per calendar month; its computed test coverage is "
    "shown in the metrics panel.",
    "Under a scenario the forecast is re-run with perturbed recent inputs plus the scenario's direct "
    "effect on the target month — labelled Simulated, not a forecast.",
]


def _weights(divs: list[str]) -> dict[str, float]:
    c = division_climates()
    w = {d: c[d].area_km2 for d in divs}
    s = sum(w.values())
    return {d: v / s for d, v in w.items()}


def _forecast_point(f: dict, h: int, smp: bool) -> ForecastPoint:
    prov = "simulated" if f.get("simulated") else "predicted"
    return ForecastPoint(
        horizon=h, issuedMonth=f["issuedMonth"], targetMonth=f["targetMonth"],
        value=m(f["value"], "mm", prov, "aquaguard_ml", sample=smp, as_of=f["targetMonth"] + "-01",
                low=f["low"], high=f["high"], digits=1),
        normal=m(f["climMean"], "mm", "historical", "openmeteo_archive", sample=smp, digits=1),
        z=m(f["z"], "z-score", prov, "aquaguard_ml", sample=smp, digits=2),
        drynessClass=f.get("drynessClass") if not f.get("simulated") else riskmod.dryness_label(f["z"]))


@router.get("/predictions/scarcity", response_model=ScarcityResponse)
def scarcity(region: str = "bd", horizon: int = Query(1), scenario: ScenarioParams = Depends(scenario_query)
             ) -> ScarcityResponse:
    if horizon not in mla.HORIZONS:
        raise HTTPException(status_code=422, detail="horizon must be 1, 3 or 6 (months)")
    region_or_404(region)
    run = regional.run(region, scenario)
    smp = run.is_sample
    preds = mla.predictions()
    if not preds:
        return ScarcityResponse(context=context(run), horizon=horizon, target="D = P - ET0 (mm/month)",
                                history=Series(id="d", label="Climatic water balance", points=[]), test=[],
                                forecast=None, allHorizons=[], risk=None, available=False, model={},
                                summary="No model artifacts found. Run `make ml` to train and evaluate the models.",
                                limitations=LIMITATIONS)
    w = _weights(run.divisions)
    hist: dict[str, float] = {}
    for d, wt in w.items():
        for p in preds["history"].get(d, []):
            hist[p["t"]] = hist.get(p["t"], 0.0) + wt * p["d"]
    history = Series(id="d_history", label="Climatic water balance P - ET0 (ERA5)", points=[
        SeriesPoint(t=t, v=m(v, "mm", "historical", "openmeteo_archive", sample=smp, as_of=t + "-01", digits=1))
        for t, v in sorted(hist.items())])
    test: dict[str, list[float]] = {}
    for d, wt in w.items():
        for p in preds["testSeries"].get(d, {}).get(str(horizon), []):
            acc = test.setdefault(p["t"], [0.0, 0.0, 0.0, 0.0])
            for i, k in enumerate(("actual", "predicted", "low", "high")):
                acc[i] += wt * p[k]
    test_points = [TestPoint(
        t=t, actual=m(v[0], "mm", "historical", "openmeteo_archive", sample=smp, as_of=t + "-01", digits=1),
        predicted=m(v[1], "mm", "predicted", "aquaguard_ml", sample=smp, as_of=t + "-01", low=v[2], high=v[3],
                    digits=1)) for t, v in sorted(test.items())]
    all_h = []
    for h in mla.HORIZONS:
        f = regional.region_forecast(run, h)
        if f:
            all_h.append(_forecast_point(f, h, smp))
    fc = next((p for p in all_h if p.horizon == horizon), None)
    rk = regional.region_risk(run, horizon)
    meta = mla.model_meta() or {}
    hmeta = meta.get("horizons", {}).get(str(horizon), {})
    summary = "No forecast available."
    if fc is not None:
        label = MODEL_NAMES.get(hmeta.get("selected", ""), hmeta.get("selected", "model"))
        kind = "simulates" if run.is_scenario else "forecasts"
        summary = (
            f"For {run.region['name']}, the {label} model {kind} a climatic water balance of "
            f"{fc.value.value:.0f} mm for {fc.targetMonth} (90% interval {fc.value.uncertainty.low:.0f} to "
            f"{fc.value.uncertainty.high:.0f} mm), against a training-period normal of {fc.normal.value:.0f} mm "
            f"(z = {fc.z.value:.2f}, {fc.drynessClass or 'class unavailable'}). With a dry-season stress ratio of "
            f"{rk['stressRatio'] * 100:.0f}% ({rk['stressClass']}), the combined scarcity risk is {rk['label']}.")
        if run.region["level"] == "district":
            summary += " " + run.scope_note
    split = mla.split_info() or {}
    return ScarcityResponse(
        context=context(run), horizon=horizon, target=preds["target"], history=history, test=test_points,
        forecast=fc, allHorizons=all_h, risk=risk_class(rk, run.is_scenario, smp), summary=summary,
        model={"selected": hmeta.get("selected"), "trainedAt": meta.get("trainedAt"), "dataPeriod": preds["dataPeriod"],
               "trainSamples": hmeta.get("trainSamples"), "validationSamples": hmeta.get("validationSamples"),
               "testSamples": hmeta.get("testSamples"), "split": split.get("rule"),
               "aggregation": "area-weighted mean of division forecasts" if len(run.divisions) > 1 else None},
        limitations=LIMITATIONS, available=True)


@router.get("/predictions/demand", response_model=DemandResponse)
def demand(region: str = "bd", horizon: int | None = Query(None, description="final projection year"),
           scenario: ScenarioParams = Depends(scenario_query)) -> DemandResponse:
    region_or_404(region)
    run = regional.run(region, scenario)
    cfg = pentry("demand_projection")
    years = [y for y in cfg["horizon_years"] if horizon is None or y <= horizon]
    proj = da.population_projection()
    pop = {int(r["year"]): float(r["population"]) for r in proj.df.to_dict("records")}
    base_year = cfg["base_year"]
    if base_year not in pop:
        raise HTTPException(status_code=503, detail="Population projection unavailable.")
    ann = run.totals("annual")
    region_pop = float(sum(division_climates()[d].population for d in run.divisions))
    sc, smp = run.is_scenario, run.is_sample or proj.is_sample
    out = []
    for y in [base_year, *years]:
        if y not in pop:
            continue
        f = pop[y] / pop[base_year]
        dom = ann["demand"]["domestic"] * f
        agri, ind = ann["demand"]["agriculture"], ann["demand"]["industry"]
        out.append(DemandYear(
            year=y, population=m(region_pop * f, "persons", "estimated", "worldbank_pep", sample=smp,
                                 as_of=f"{y}-12-31", digits=0),
            agriculture=engine(agri, "MCM", sc, smp, 0), domestic=engine(dom, "MCM", sc, smp, 1),
            industry=engine(ind, "MCM", sc, smp, 1), total=engine(agri + dom + ind, "MCM", sc, smp, 0)))
    return DemandResponse(context=context(run), method=cfg["method"], years=out, limitations=[
        "No reliable monthly consumption history exists for Bangladeshi divisions, so this is a transparent "
        "projection (Estimated), not a machine-learning forecast.",
        "Regional population follows the national World Bank projection ratio (2022 regional shares held fixed).",
        "Agricultural demand is held at today's irrigated area and the 1991-2020 climate normal.",
    ])


@router.get("/predictions/groundwater", response_model=GroundwaterResponse)
def groundwater(region: str = "bd") -> GroundwaterResponse:
    region_or_404(region)
    run = regional.run(region)
    note = "Regional storage trend, roughly 300 km resolution; not well depth."
    t = da.storage_anomaly()
    g = mla.grace_trend()
    if not len(t.df) or not g:
        return GroundwaterResponse(
            context=context(run), available=False, series=None, deseasonalised=None, projection=None, trend=None,
            method=None, note=note,
            instructions="Download CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc from "
                         "https://download.csr.utexas.edu/outgoing/grace/RL0603_mascons/ into data/raw/grace/, then "
                         "run `make data` (ml/grace_trend.py).")
    smp = t.is_sample
    series = Series(id="tws", label="Terrestrial water storage anomaly (GRACE/GRACE-FO, Bangladesh mean)", points=[
        SeriesPoint(t=r["date"][:7], v=m(r["tws_cm"], "cm", "historical", "grace_csr", sample=smp, as_of=r["date"],
                                          digits=2)) for r in t.df.sort_values("date").to_dict("records")])
    des = Series(id="tws_deseasonalised", label="Seasonal cycle removed", points=[
        SeriesPoint(t=p["date"][:7], v=m(p["value"], "cm", "historical", "grace_csr", sample=smp, as_of=p["date"],
                                          digits=2)) for p in g["deseasonalised"]])
    proj = Series(id="tws_projection", label="12-month projection (trend + seasonal cycle)", points=[
        SeriesPoint(t=p["date"][:7], v=m(p["value"], "cm", "predicted", "grace_csr", sample=smp, as_of=p["date"],
                                          low=p["low"], high=p["high"], digits=2)) for p in g["projection"]])
    if run.region["level"] != "country":
        note += " The same Bangladesh-wide series is shown for every division and district."
    return GroundwaterResponse(
        context=context(run), available=True, series=series, deseasonalised=des, projection=proj,
        trend=m(g["trendCmPerYr"], "cm/yr", "historical", "grace_csr", sample=smp, low=g["trendCi95"][0],
                high=g["trendCi95"][1], as_of=g["period"]["to"], digits=3),
        method=g["method"], note=note, instructions=None)


@router.get("/models/metrics", response_model=MetricsResponse)
def model_metrics() -> MetricsResponse:
    met = mla.metrics()
    preds = mla.predictions() or {}
    split = mla.split_info() or {}
    if not met:
        return MetricsResponse(evaluated=False, metrics=None, trainedAt=None, dataPeriod=None, split=None, samples=None)
    return MetricsResponse(evaluated=True, metrics=met, trainedAt=met.get("trainedAt"),
                           dataPeriod=preds.get("dataPeriod"), split=split.get("rule"), samples=split.get("counts"))


@router.get("/models/shap", response_model=ShapResponse)
def model_shap(region: str = "bd", horizon: int = Query(1)) -> ShapResponse:
    if horizon not in mla.HORIZONS:
        raise HTTPException(status_code=422, detail="horizon must be 1, 3 or 6 (months)")
    r = region_or_404(region)
    sv = mla.shap_values()
    if not sv:
        return ShapResponse(available=False, horizon=horizon, model=None, globalImportance=[], local=None,
                            localNote="SHAP values not computed yet. Run `make ml`.")
    h = sv["horizons"][str(horizon)]
    div = r["id"] if r["level"] == "division" else (r["parent_id"] if r["level"] == "district" else None)
    local = h["local"].get(div) if div else None
    note = ("Local explanation of the latest baseline forecast for this division." if r["level"] == "division" else
            "District: explanation shown for the parent division." if r["level"] == "district" else
            "Select a division to see a local explanation (the national value is an area-weighted mean of "
            "division forecasts).")
    return ShapResponse(available=True, horizon=horizon, model=h["model"], globalImportance=h["global"],
                        local={"division": div, **local} if local else None, localNote=note)
