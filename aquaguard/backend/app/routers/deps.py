"""Shared router helpers: scenario query parsing, region lookup, context block."""
from __future__ import annotations

from fastapi import HTTPException, Query
from pydantic import ValidationError

from ..schemas.common import Region, ScenarioParams
from ..schemas.modules import Context
from ..services import data_access as da
from ..services.regional import RegionRun


def scenario_query(
    rainfallChangePct: float = Query(0.0, description="-50..+50 %"),
    temperatureChangeC: float = Query(0.0, description="-2..+4 °C"),
    demandChangePct: float = Query(0.0, description="-30..+50 %"),
    agriculturalDemandChangePct: float = Query(0.0, description="-50..+50 % (agricultural consumption)"),
    groundwaterAvailabilityPct: float = Query(0.0, description="-50..+20 %"),
    irrigationEfficiency: float | None = Query(None, description="0.30..0.90; absent = baseline"),
    pipelineLossPct: float | None = Query(None, description="0..50 %; absent = baseline"),
) -> ScenarioParams:
    try:
        return ScenarioParams(rainfallChangePct=rainfallChangePct, temperatureChangeC=temperatureChangeC,
                              demandChangePct=demandChangePct, agriculturalDemandChangePct=agriculturalDemandChangePct,
                              groundwaterAvailabilityPct=groundwaterAvailabilityPct,
                              irrigationEfficiency=irrigationEfficiency, pipelineLossPct=pipelineLossPct)
    except ValidationError as e:
        msg = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors())
        raise HTTPException(status_code=422, detail=f"Invalid scenario parameters — {msg}") from e


def to_region(r: dict) -> Region:
    return Region(id=r["id"], name=r["name"], nameBn=r.get("name_bn") if isinstance(r.get("name_bn"), str) else None,
                  level=r["level"], centroid=(float(r["lon"]), float(r["lat"])),
                  parentId=r.get("parent_id") if isinstance(r.get("parent_id"), str) else None)


def region_or_404(region_id: str) -> dict:
    r = da.region(region_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Unknown region '{region_id}'. See GET /api/regions.")
    return r


def context(run: RegionRun) -> Context:
    return Context(region=to_region(run.region), scopeNote=run.scope_note, scenario=run.params,
                   scenarioActive=run.is_scenario, sampleData=run.is_sample or bool(da.sample_tables()))
