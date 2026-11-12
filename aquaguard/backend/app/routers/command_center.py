"""M1 Command Center: /overview and /alerts."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..engine import risk as riskmod
from ..schemas.common import RiskClass, RuleTrace, ScenarioParams, Series, SeriesPoint
from ..schemas.modules import (
    Alert,
    AlertsResponse,
    MonthlyBalancePoint,
    OverviewKpis,
    OverviewResponse,
    Rainfall30d,
    RegionalRow,
    SectorValues,
    ValidationCheck,
)
from ..services import alerts as alertsvc
from ..services import data_access as da
from ..services import ml_artifacts as mla
from ..services import regional
from ..services.measure import engine, m
from .deps import context, region_or_404, scenario_query

router = APIRouter(tags=["Command Center"])


def risk_class(rk: dict, simulated: bool, sample: bool) -> RiskClass:
    f = rk.get("forecast")
    inputs = {"dryStressRatio": engine(rk["stressRatio"], "ratio", simulated, sample, 4)}
    if rk.get("z") is not None and f is not None:
        inputs["forecastZ"] = m(rk["z"], "z-score", "simulated" if f.get("simulated") else "predicted",
                                "aquaguard_ml", sample=sample, as_of=f["targetMonth"] + "-01")
    return RiskClass(label=rk["label"], level=rk["level"], provenance="simulated" if simulated else "estimated",
                     rule=RuleTrace(rule=rk["rule"], inputs=inputs))


def monthly_points(run: regional.RegionRun) -> list[MonthlyBalancePoint]:
    out = []
    sc, smp = run.is_scenario, run.is_sample
    for month in range(1, 13):
        t = run.totals(str(month))
        out.append(MonthlyBalancePoint(
            month=month, supply=engine(t["supply"], "MCM", sc, smp, 1),
            usableSupply=engine(t["supply"] - t["demand"]["environment"], "MCM", sc, smp, 1),
            consumptiveDemand=engine(t["consumptiveDemand"], "MCM", sc, smp, 1),
            environment=engine(t["demand"]["environment"], "MCM", sc, smp, 1),
            unmet=engine(t["unmetTotal"], "MCM", sc, smp, 1)))
    return out


def _anomaly_series(divisions: list[str], var: str, label: str, months: int = 24) -> Series:
    mon = da.monthly().df
    clim = da.climatology().df
    sample = da.table("weather_monthly").is_sample
    mon = mon[mon["division"].isin(divisions)]
    clim = clim[clim["division"].isin(divisions)]
    merged = mon.merge(clim[["division", "month", var]], on=["division", "month"], suffixes=("", "_n"))
    merged["anom"] = merged[var] - merged[f"{var}_n"]
    g = merged.groupby(["year", "month"])["anom"].mean().reset_index().tail(months)
    return Series(id=f"{var}_anomaly", label=label, points=[
        SeriesPoint(t=f"{int(r.year)}-{int(r.month):02d}",
                    v=m(float(r.anom), "mm", "historical", "openmeteo_archive", sample=sample,
                        as_of=f"{int(r.year)}-{int(r.month):02d}-01", digits=1))
        for r in g.itertuples()])


@router.get("/overview", response_model=OverviewResponse)
def overview(region: str = "bd", scenario: ScenarioParams = Depends(scenario_query)) -> OverviewResponse:
    region_or_404(region)
    run = regional.run(region, scenario)
    sc, smp = run.is_scenario, run.is_sample
    ann, dry = run.totals("annual"), run.totals("dry")
    rk = regional.region_risk(run, 1)

    g = mla.grace_trend()
    gw = (m(g["trendCmPerYr"], "cm/yr", "historical", "grace_csr", low=g["trendCi95"][0], high=g["trendCi95"][1],
            as_of=g["period"]["to"], digits=3) if g else m(None, "cm/yr", "historical", "grace_csr"))

    rain = None
    if run.divisions:
        totals: list[float] = []
        normals: list[float] = []
        start = end = None
        sample_rain = False
        for d in run.divisions:
            t, s, e, smp_r = da.last_n_days_rain(d)
            if t is None:
                continue
            n = da.clim_rain_for_window(d, s, e)
            totals.append(t)
            normals.append(n or 0.0)
            start, end, sample_rain = s, e, smp_r
        if totals:
            tot, nor = sum(totals) / len(totals), sum(normals) / len(normals)
            rain = Rainfall30d(
                total=m(tot, "mm", "historical", "openmeteo_archive", sample=sample_rain, as_of=end, digits=1),
                normal=m(nor, "mm", "historical", "openmeteo_archive", sample=sample_rain, as_of=end, digits=1),
                anomalyPct=m(((tot - nor) / nor * 100) if nor > 0 else None, "%", "historical", "openmeteo_archive",
                             sample=sample_rain, as_of=end, digits=1),
                window=f"{start} to {end}" + (" (division mean)" if len(totals) > 1 else ""))

    kpis = OverviewKpis(
        availability=engine(ann["supply"], "MCM", sc, smp, 0),
        usableAvailability=engine(ann["supply"] - ann["demand"]["environment"], "MCM", sc, smp, 0),
        demand=engine(ann["consumptiveDemand"], "MCM", sc, smp, 0),
        dryAvailability=engine(dry["supply"], "MCM", sc, smp, 0),
        dryDemand=engine(dry["consumptiveDemand"], "MCM", sc, smp, 0),
        stressRatio=engine(ann["stressRatio"], "ratio", sc, smp, 4),
        stressClass=riskmod.stress_label(ann["stressRatio"]),
        dryStressRatio=engine(dry["stressRatio"], "ratio", sc, smp, 4),
        dryStressClass=riskmod.stress_label(dry["stressRatio"]),
        scarcityRisk=risk_class(rk, sc, smp),
        groundwaterTrend=gw,
        rainfall30d=rain,
        distributionEfficiency=engine(1 - run.loss_rate, "ratio", sc, smp, 3),
        unmetDry=engine(dry["unmetTotal"], "MCM", sc, smp, 1),
    )
    sectors = SectorValues(**{s: engine(ann["demand"][s], "MCM", sc, smp, 0) for s in
                              ("agriculture", "domestic", "industry", "environment")})
    rows = []
    for d, dr in regional.all_divisions(scenario).items():
        a, dd = dr.totals("annual"), dr.totals("dry")
        rr = regional.region_risk(dr, 1)
        rows.append(RegionalRow(
            regionId=d, name=dr.region["name"], availability=engine(a["supply"], "MCM", sc, smp, 0),
            demand=engine(a["consumptiveDemand"], "MCM", sc, smp, 0),
            stressRatio=engine(a["stressRatio"], "ratio", sc, smp, 4),
            dryStressRatio=engine(dd["stressRatio"], "ratio", sc, smp, 4), risk=rr["label"], riskLevel=rr["level"]))

    validation = []
    if run.region["level"] == "country":
        wr, wsmp = da.water_resources()
        if "withdrawal_agri_km3" in wr:
            ref = wr["withdrawal_agri_km3"]
            validation.append(ValidationCheck(
                label="Agricultural demand: FAO-56 model vs AQUASTAT reported withdrawal",
                model=engine(ann["demand"]["agriculture"], "MCM", sc, smp, 0),
                reference=m(ref["value"] * 1000, "MCM", "historical", "fao_aquastat", sample=wsmp,
                            as_of=f"{int(ref['reference_year'])}-12-31", digits=0),
                note=f"AQUASTAT value from {int(ref['reference_year'])}, carried forward to {int(ref['year'])}. "
                     "The model applies FAO-56 to all AQUASTAT irrigated rice as Boro; differences show the "
                     "uncertainty of these assumptions."))
        if "sdg642_water_stress_pct" in wr:
            ref = wr["sdg642_water_stress_pct"]
            validation.append(ValidationCheck(
                label="Annual stress ratio: AquaGuard vs FAO SDG 6.4.2 water stress",
                model=engine(ann["stressRatio"] * 100, "%", sc, smp, 2),
                reference=m(ref["value"], "%", "historical", "fao_aquastat", sample=wsmp,
                            as_of=f"{int(ref['year'])}-12-31", digits=2),
                note="Both divide withdrawals/demand by renewable supply minus environmental flow requirements."))

    return OverviewResponse(
        context=context(run), kpis=kpis, monthly=monthly_points(run), sectors=sectors, regional=rows,
        trends=[_anomaly_series(run.divisions, "precip_mm", "Rainfall anomaly vs 1991-2020 normal"),
                _anomaly_series(run.divisions, "d_mm", "Climatic water balance (P - ET0) anomaly")],
        validation=validation)


@router.get("/alerts", response_model=AlertsResponse)
def alerts(region: str = "bd", scenario: ScenarioParams = Depends(scenario_query)) -> AlertsResponse:
    region_or_404(region)
    run = regional.run(region, scenario)
    return AlertsResponse(context=context(run), alerts=[Alert(**a) for a in alertsvc.evaluate(run)])
