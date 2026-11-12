"""M6 What-if Scenario Simulator: /scenario/run (baseline vs simulated)."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter

from ..schemas.common import ScenarioParams
from ..schemas.modules import Compare, ScenarioRequest, ScenarioResponse
from ..services import regional
from ..services.measure import engine
from ..settings import get_settings
from .command_center import monthly_points, risk_class
from .deps import context, region_or_404

router = APIRouter(tags=["What-if Scenario Simulator"])


def _cmp(key: str, label: str, b: float, s: float, unit: str, smp: bool, digits: int = 1) -> Compare:
    return Compare(key=key, label=label, baseline=engine(b, unit, False, smp, digits),
                   simulated=engine(s, unit, True, smp, digits), change=engine(s - b, unit, True, smp, digits))


def _log(region: str, p: ScenarioParams, summary: str) -> None:
    """Persist scenario runs (scenarios table). Failures never break the response."""
    s = get_settings()
    if not s.db_path.exists() or s.force_sample:
        return
    try:
        con = sqlite3.connect(s.db_path)
        con.execute("INSERT INTO scenarios (created_at, region, params_json, summary_json) VALUES (?,?,?,?)",
                    (datetime.now(timezone.utc).isoformat(), region, json.dumps(p.model_dump()), json.dumps(summary)))
        con.commit()
        con.close()
    except sqlite3.Error:
        pass


def _summary(name: str, p: ScenarioParams, base: dict, sim: dict, rb: dict, rs: dict) -> str:
    parts = []
    if p.rainfallChangePct:
        parts.append(f"rainfall {p.rainfallChangePct:+.0f}%")
    if p.temperatureChangeC:
        parts.append(f"temperature {p.temperatureChangeC:+.1f} °C")
    if p.demandChangePct:
        parts.append(f"domestic/industrial demand {p.demandChangePct:+.0f}%")
    if p.groundwaterAvailabilityPct:
        parts.append(f"groundwater availability {p.groundwaterAvailabilityPct:+.0f}%")
    if p.irrigationEfficiency is not None:
        parts.append(f"irrigation efficiency {p.irrigationEfficiency:.2f}")
    if p.pipelineLossPct is not None:
        parts.append(f"pipeline loss {p.pipelineLossPct:.0f}%")
    if not parts:
        return f"Baseline for {name}: no scenario changes applied."
    return (f"Scenario for {name} ({', '.join(parts)}): dry-season supply changes from {base['supply']:,.0f} to "
            f"{sim['supply']:,.0f} MCM and consumptive demand from {base['consumptiveDemand']:,.0f} to "
            f"{sim['consumptiveDemand']:,.0f} MCM. Dry-season unmet demand moves from {base['unmetTotal']:,.0f} to "
            f"{sim['unmetTotal']:,.0f} MCM and the stress ratio from {base['stressRatio'] * 100:.0f}% to "
            f"{sim['stressRatio'] * 100:.0f}%. Scarcity risk: {rb['label']} -> {rs['label']}. All results are Simulated.")


@router.post("/scenario/run", response_model=ScenarioResponse)
def run_scenario(req: ScenarioRequest) -> ScenarioResponse:
    region_or_404(req.region)
    base_run = regional.run(req.region, ScenarioParams())
    sim_run = regional.run(req.region, req.params)
    smp = sim_run.is_sample
    ba, sa = base_run.totals("annual"), sim_run.totals("annual")
    bd, sd = base_run.totals("dry"), sim_run.totals("dry")
    comparisons = [
        _cmp("availability", "Annual water availability", ba["supply"], sa["supply"], "MCM", smp, 0),
        _cmp("dryAvailability", "Dry-season availability", bd["supply"], sd["supply"], "MCM", smp, 0),
        _cmp("demand", "Annual consumptive demand", ba["consumptiveDemand"], sa["consumptiveDemand"], "MCM", smp, 0),
        _cmp("dryDemand", "Dry-season consumptive demand", bd["consumptiveDemand"], sd["consumptiveDemand"], "MCM", smp, 0),
        _cmp("unmet", "Annual unmet demand", ba["unmetTotal"], sa["unmetTotal"], "MCM", smp),
        _cmp("dryUnmet", "Dry-season unmet demand", bd["unmetTotal"], sd["unmetTotal"], "MCM", smp),
        _cmp("stress", "Annual stress ratio", ba["stressRatio"], sa["stressRatio"], "ratio", smp, 4),
        _cmp("dryStress", "Dry-season stress ratio", bd["stressRatio"], sd["stressRatio"], "ratio", smp, 4),
        _cmp("losses", "Annual distribution losses", ba["losses"], sa["losses"], "MCM", smp),
        _cmp("irrigationNeed", "Gross irrigation requirement (annual)", ba["demand"]["agriculture"],
             sa["demand"]["agriculture"], "MCM", smp, 0),
        _cmp("groundwater", "Groundwater supply (annual)", ba["groundwater"], sa["groundwater"], "MCM", smp, 0),
    ]
    sectors = [_cmp(s, s.capitalize(), ba["demand"][s], sa["demand"][s], "MCM", smp, 0)
               for s in ("agriculture", "domestic", "industry", "environment")]
    allocation = [_cmp(s, s.capitalize(), bd["delivered"][s], sd["delivered"][s], "MCM", smp, 0)
                  for s in ("agriculture", "domestic", "industry", "environment")]
    rb, rs = regional.region_risk(base_run, 1), regional.region_risk(sim_run, 1)
    summary = _summary(sim_run.region["name"], req.params, bd, sd, rb, rs)
    _log(req.region, req.params, summary)
    risk_b = risk_class(rb, False, smp)
    risk_s = risk_class(rs, True, smp)
    return ScenarioResponse(context=context(sim_run), comparisons=comparisons, sectorDemand=sectors,
                            allocation=allocation, riskBaseline=risk_b, riskSimulated=risk_s,
                            monthlyBaseline=monthly_points(base_run), monthlySimulated=monthly_points(sim_run),
                            summary=summary)


