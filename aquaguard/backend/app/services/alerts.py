"""Rule-based alerts over engine + model outputs. Thresholds live in parameters.yaml (alerts.*).
Every alert carries the rule text and the Measures that fired it."""
from __future__ import annotations

from ..config.params import pentry
from . import data_access as da
from . import ml_artifacts as mla
from .measure import engine, m
from .regional import RegionRun, region_risk


def _alert(aid: str, severity: str, title: str, message: str, recommendation: str, rule: str, inputs: dict,
           module: str) -> dict:
    return {"id": aid, "severity": severity, "title": title, "message": message, "recommendation": recommendation,
            "rule": rule, "inputs": inputs, "module": module}


def evaluate(r: RegionRun) -> list[dict]:
    th = pentry("alerts")
    sc, smp = r.is_scenario, r.is_sample
    out: list[dict] = []
    dry = r.totals("dry")

    t = th["stress_high"]["value"]
    if dry["stressRatio"] >= t:
        sev = "critical" if dry["stressRatio"] >= 0.8 else "warning"
        out.append(_alert(
            "dry_stress", sev, "High dry-season water stress",
            f"Dry-season (Dec-Apr) stress ratio is {dry['stressRatio'] * 100:.0f}% of usable supply.",
            "Prioritise domestic supply, promote Alternate Wetting and Drying in Boro rice and review "
            "groundwater abstraction schedules (see Water Budget optimizer).",
            f"dry-season stress ratio >= {t:.2f} ({th['stress_high']['source']})",
            {"dryStressRatio": engine(dry["stressRatio"], "ratio", sc, smp, 4)}, "water-budget"))

    rk = region_risk(r, 1)
    zt = th["dryness_z"]["value"]
    if rk["z"] is not None and rk["z"] <= zt:
        f = rk["forecast"]
        out.append(_alert(
            "forecast_dry", "warning", "Drier than normal month forecast",
            f"Predicted climatic water balance for {f['targetMonth']} is {f['value']:.0f} mm (z = {rk['z']:.2f}).",
            "Plan irrigation scheduling ahead and check the Smart Irrigation Advisor for the coming weeks.",
            f"forecast z <= {zt} ({th['dryness_z']['source']})",
            {"forecastZ": m(rk["z"], "z-score", "simulated" if f.get("simulated") else "predicted", "aquaguard_ml",
                            sample=smp, as_of=f["targetMonth"] + "-01")}, "prediction-lab"))

    unmet_share = dry["unmetTotal"] / sum(dry["demand"].values()) if sum(dry["demand"].values()) else 0.0
    ut = th["unmet_demand_share"]["value"]
    if unmet_share > ut:
        out.append(_alert(
            "unmet_demand", "warning", "Unmet dry-season demand",
            f"{dry['unmetTotal']:.0f} MCM ({unmet_share * 100:.1f}%) of dry-season demand is not met.",
            "Run the Water Budget optimizer (domestic first, environmental minimum protected) and consider "
            "irrigation-efficiency improvements in the What-if Simulator.",
            f"unmet / demand > {ut:.2f} ({th['unmet_demand_share']['source']})",
            {"unmetDry": engine(dry["unmetTotal"], "MCM", sc, smp, 1),
             "unmetShare": engine(unmet_share, "ratio", sc, smp, 4)}, "water-budget"))

    lt = th["loss_rate_high"]["value"]
    if r.loss_rate > lt:
        out.append(_alert(
            "loss_rate", "warning", "High distribution losses",
            f"Distribution loss rate is {r.loss_rate * 100:.0f}% of conveyed piped volume.",
            "Prioritise leak detection surveys and pressure management (see 3D Water Flow).",
            f"loss rate > {lt:.2f} ({th['loss_rate_high']['source']})",
            {"lossRate": engine(r.loss_rate, "ratio", sc, smp, 3)}, "water-flow"))

    rain, start, end, rs = da.last_n_days_rain(r.divisions[0]) if len(r.divisions) == 1 else (None,) * 4
    if rain is not None:
        normal = da.clim_rain_for_window(r.divisions[0], start, end)
        if normal and normal > 5:
            pct = (rain - normal) / normal * 100
            rt = th["rainfall_deficit_pct"]["value"]
            if pct <= rt:
                out.append(_alert(
                    "rain_deficit", "info", "Recent rainfall below normal",
                    f"Rainfall {start} to {end} was {rain:.0f} mm vs a 1991-2020 normal of {normal:.0f} mm "
                    f"({pct:.0f}%).",
                    "Monitor soil moisture and irrigation needs; check the Irrigation Advisor.",
                    f"30-day rainfall anomaly <= {rt:.0f}% ({th['rainfall_deficit_pct']['source']})",
                    {"rain30d": m(rain, "mm", "historical", "openmeteo_archive", sample=rs, as_of=end),
                     "normal30d": m(normal, "mm", "historical", "openmeteo_archive", sample=rs, as_of=end)},
                    "command-center"))

    g = mla.grace_trend()
    gt = th["gw_trend_negative_cm_yr"]["value"]
    if g and g["trendCmPerYr"] < gt and g["trendCi95"][1] < 0:
        out.append(_alert(
            "storage_decline", "info", "Declining regional water storage (GRACE)",
            f"Bangladesh-wide storage anomaly trend is {g['trendCmPerYr']:.2f} cm/yr "
            f"(95% CI {g['trendCi95'][0]:.2f} to {g['trendCi95'][1]:.2f}). Regional signal, not well depth.",
            "Treat groundwater as a finite buffer: avoid expanding dry-season abstraction without monitoring.",
            f"GRACE trend < {gt} cm/yr and CI upper bound < 0 ({th['gw_trend_negative_cm_yr']['source']})",
            {"graceTrend": m(g["trendCmPerYr"], "cm/yr", "historical", "grace_csr", low=g["trendCi95"][0],
                             high=g["trendCi95"][1], as_of=g["period"]["to"])}, "prediction-lab"))
    order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(out, key=lambda a: order[a["severity"]])
