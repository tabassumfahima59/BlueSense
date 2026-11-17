"""Region x scenario computations shared by every module (one calculation, one place).

Command Center, Water Budget, What-if, Explorer, Prediction Lab and the Copilot all call `run()`, so their
baseline totals are identical by construction (checked by tests/test_consistency.py).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

from ..config.params import pval
from ..engine import optimizer, risk
from ..engine import scenario as scen
from ..engine import water_balance as wb
from ..schemas.common import ScenarioParams
from . import data_access as da
from . import ml_artifacts as mla
from .inputs import baseline_config, division_climates, inputs_are_sample, latest_climates

PERIODS = ("annual", "dry")


@dataclass
class RegionRun:
    region: dict
    divisions: list[str]
    scope_note: str
    params: ScenarioParams
    is_scenario: bool
    is_sample: bool
    balances: dict[str, wb.Balance]
    loss_rate: float
    irrigation_efficiency: float

    def months(self, period: str = "annual", division: str | None = None) -> list[wb.MonthBalance]:
        sel = self.balances.values() if division is None else [self.balances[division]]
        out = []
        for b in sel:
            out += [mm for mm in b.months if in_period(mm.month, period)]
        return out

    def totals(self, period: str = "annual", division: str | None = None) -> dict:
        return wb.aggregate(self.months(period, division))


def in_period(month: int, period: str) -> bool:
    if period == "annual":
        return True
    if period == "dry":
        return month in pval("water_balance", "dry_season_months")
    if period.isdigit():
        return month == int(period)
    raise ValueError(f"unknown period {period!r}")


def validate_period(period: str) -> str:
    if period in PERIODS or (period.isdigit() and 1 <= int(period) <= 12):
        return period
    raise ValueError("period must be 'annual', 'dry' or a month number 1-12")


def _key(p: ScenarioParams) -> str:
    return json.dumps(p.model_dump(), sort_keys=True)


@lru_cache(maxsize=256)
def _division_balance(division: str, key: str, basis: str = "normal") -> wb.Balance:
    p = ScenarioParams(**json.loads(key))
    climates = latest_climates()[0] if basis == "latest" else division_climates()
    clim, cfg = scen.apply(climates[division], baseline_config(), p)
    return wb.division_balance(clim, cfg)


def run(region_id: str, params: ScenarioParams | None = None, basis: str = "normal") -> RegionRun:
    params = params or ScenarioParams()
    region = da.region(region_id)
    if region is None:
        raise KeyError(region_id)
    divisions, note = da.resolve_division_scope(region_id)
    key = _key(params)
    balances = {d: _division_balance(d, key, basis) for d in divisions}
    cfg = scen.apply_config(baseline_config(), params.demandChangePct, params.groundwaterAvailabilityPct,
                            params.irrigationEfficiency, params.pipelineLossPct, params.agriculturalDemandChangePct)
    return RegionRun(region=region, divisions=divisions, scope_note=note, params=params,
                     is_scenario=not params.is_baseline(), is_sample=inputs_are_sample(), balances=balances,
                     loss_rate=cfg.loss_rate, irrigation_efficiency=cfg.irrigation_efficiency)


def all_divisions(params: ScenarioParams | None = None) -> dict[str, RegionRun]:
    return {d: run(d, params) for d in da.division_ids()}


def reallocated(r: RegionRun, period: str, mode: str, shares: dict[str, float] | None = None) -> list[wb.MonthBalance]:
    return [optimizer.reallocate(mm, r.loss_rate, mode, shares) for mm in r.months(period)]


# ---------------------------------------------------------------- scarcity forecast + risk

def forecast(division: str, h: int, params: ScenarioParams) -> dict | None:
    if params.rainfallChangePct == 0 and params.temperatureChangeC == 0:
        f = mla.baseline_forecast(division, h)
        return None if f is None else {**f, "simulated": not params.is_baseline()}
    f = mla.scenario_forecast(division, h, params.rainfallChangePct, params.temperatureChangeC)
    return None if f is None else {**f, "simulated": True}


def region_forecast(r: RegionRun, h: int) -> dict | None:
    """Area-weighted combination of division forecasts for multi-division regions."""
    parts = []
    climates = division_climates()
    for d in r.divisions:
        f = forecast(d, h, r.params)
        if f is None:
            return None
        parts.append((climates[d].area_km2, f))
    if len(parts) == 1:
        return parts[0][1]
    w = sum(a for a, _ in parts)
    agg = {k: sum(a * f[k] for a, f in parts) / w for k in ("value", "low", "high", "climMean")}
    # sd of an area-weighted mean is not the mean of sds; use the weighted z instead (documented).
    z = sum(a * f["z"] for a, f in parts) / w
    return {**parts[0][1], **{k: round(v, 2) for k, v in agg.items()}, "z": round(z, 3),
            "drynessClass": risk.dryness_label(z), "climSd": None, "aggregated": True}


def region_risk(r: RegionRun, h: int = 1) -> dict:
    dry = r.totals("dry")
    f = region_forecast(r, h)
    z = f["z"] if f else None
    out = risk.combined(dry["stressRatio"], z)
    out["stressRatio"] = dry["stressRatio"]
    out["z"] = z
    out["forecast"] = f
    return out
