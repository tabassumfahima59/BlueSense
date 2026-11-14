"""3D Water Flow: /flow/simulate. M7: a conceptual illustration. Every network value has data kind
``conceptual`` (legacy provenance "simulated"); real AQUASTAT magnitudes are returned separately for scale and are
never used by the network."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..config.params import pval
from ..engine import flow_sim
from ..schemas.modules import DestinationState, FlowRequest, FlowResponse, FlowState, PipeState, ScaleItem
from ..services import store
from ..services.catalog import mv
from .data_api import db

router = APIRouter(tags=["3D Water Flow"])
SRC = "aquaguard_engine"
DISCLAIMER = ("CONCEPTUAL ILLUSTRATION (SIMULATED hypothetical network). AquaGuard has no IoT sensors, no real-time "
              "pipe pressure and no pump or valve control; it does not detect physical leaks. The network uses no real "
              "data; the national AQUASTAT magnitudes are shown beside it for scale only.")
NOTE = "Conceptual illustration: hypothetical network, not a real system."
SCALE = [(4251, "municipal", "Municipal water withdrawal, Bangladesh"),
         (4252, "industrial", "Industrial water withdrawal, Bangladesh"),
         (4250, "agricultural", "Agricultural water withdrawal, Bangladesh")]


def _s(v: float, unit: str, digits: int = 4):
    return mv(v, unit, "conceptual", SRC, None, digits=digits, note=NOTE)  # type: ignore[arg-type]


def _day(v: float | None) -> object:
    return _s(None if v is None else v * 86400, "m³/day", 0)


def _pipe_status(p: dict, st: dict) -> str:
    if p["id"] in st.get("closedPipes", []):
        return "closed"
    return "leaking" if float(st["burstLeaks"].get(p["id"], 0.0)) > 0 else "open"


def to_state(st: dict) -> FlowState:
    return FlowState(
        pumpFlow=_s(st["pumpFlowM3s"], "m³/s"), setpoint=_s(st["setpointM"], "m", 2),
        pipes=[PipeState(
            id=p["id"], fromNode=p["from"], toNode=p["to"], flow=_s(p["flowM3s"], "m³/s"),
            velocity=_s(p["velocityMs"], "m/s", 3), headLoss=_s(p["headLossM"], "m", 3),
            pressureStart=_s(p["pressureStartM"], "m", 2), pressureEnd=_s(p["pressureEndM"], "m", 2),
            pressureEndKpa=_s(p["pressureEndM"] * flow_sim.KPA_PER_M, "kPa", 1), leak=_s(p["leakM3s"], "m³/s", 5),
            burstSeverity=float(st["burstLeaks"].get(p["id"], 0.0)),
            kind="main" if p["from"] == "pump" else "branch", status=_pipe_status(p, st), lengthM=p["lengthM"],
            diameterM=p["diameterM"], flowDaily=_day(p["flowM3s"]), leakDaily=_day(p["leakM3s"])) for p in st["pipes"]],
        destinations=[DestinationState(
            id=d["id"], delivered=_s(d["deliveredM3s"], "m³/s"), deliveredDaily=_s(d["deliveredM3s"] * 86400, "m³/day", 0),
            pressure=_s(d["pressureM"], "m", 2), minServicePressure=_s(d["minServicePressureM"], "m", 1),
            serviceOk=d["serviceOk"], demandDaily=_day(d["demandM3s"]), allocatedDaily=_day(d["allocatedM3s"]),
            share=_s(d["sharePct"], "%", 1), supply=_s(d["supplyPct"], "%", 1), status=d["status"])
            for d in st["destinations"]],
        leakTotal=_s(st["leakTotalM3s"], "m³/s", 5), deliveredTotal=_s(st["deliveredTotalM3s"], "m³/s"),
        lossPct=_s(st["lossPct"], "%", 2), massBalanceError=_s(st["massBalanceErrorM3s"], "m³/s", 9),
        requestedPumpFlow=_s(st["requestedPumpFlowM3s"], "m³/s"), pumpOn=st["pumpOn"],
        pumpCapacity=_s(st["pumpCapacityM3s"], "m³/s"), pumpUtilization=_s(st["pumpUtilizationPct"], "%", 1),
        sourceLimit=None if st["sourceLimitM3s"] is None else _s(st["sourceLimitM3s"], "m³/s"),
        limitingFactor=st["limitingFactor"], inflowDaily=_day(st["pumpFlowM3s"]),
        deliveredDaily=_day(st["deliveredTotalM3s"]), leakDaily=_day(st["leakTotalM3s"]),
        demandDaily=_day(st["demandTotalM3s"]), supplyBalanceDaily=_day(st["supplyBalanceM3s"]),
        accountingResidualDaily=_s(st["massBalanceErrorM3s"] * 86400, "m³/day", 6),
        efficiency=_s(st["efficiencyPct"], "%", 1), balanceStatus=st["balanceStatus"], closedPipes=st["closedPipes"])


def _scale(conn) -> list[ScaleItem]:
    out = []
    for code, key, label in SCALE:
        s = store.stat(conn, code)
        if s:
            unit = store.AQUASTAT_UNIT.get(s["unit"], s["unit"])
            out.append(ScaleItem(key=key, label=label, value=mv(
                s["value"], unit, "statistic", "fao_aquastat", "national", observed_at=str(s["year"]),
                reference_year=s["year"], digits=2, note="Real national statistic, shown for scale; not used by the network.")))
    return out


@router.post("/flow/simulate", response_model=FlowResponse)
def simulate(req: FlowRequest, conn=Depends(db)) -> FlowResponse:
    for pid, sev in req.leaks.items():
        if not 0 <= sev <= 3:
            raise HTTPException(status_code=422, detail=f"leak severity for '{pid}' must be between 0 and 3")
    if req.allocationPct is not None:
        if any(not 0 <= v <= 100 for v in req.allocationPct.values()):
            raise HTTPException(status_code=422, detail="each allocation share must be between 0 and 100 %")
        total = sum(req.allocationPct.values())
        if abs(total - 100.0) > 0.5:
            raise HTTPException(status_code=422, detail=f"allocation shares must add up to 100 % (now {total:.1f} %)")
    if req.demandFactors is not None and any(not 0 <= v <= 3 for v in req.demandFactors.values()):
        raise HTTPException(status_code=422, detail="demand factors must be between 0 and 3")
    loss = (req.lossPct / 100.0) if req.lossPct is not None else pval("water_balance", "distribution_loss_rate")
    options = {"pump_on": req.pumpOn, "capacity_m3s": req.pumpCapacityM3s, "source_limit_m3s": req.sourceLimitM3s,
               "allocation": req.allocationPct, "closed": req.closedPipes, "demand_factors": req.demandFactors}
    try:
        st = flow_sim.simulate(req.pumpFlowM3s, req.setpointM, req.leaks, loss, req.leakageExponent, **options)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    opt = note = savings = None
    if req.optimize and st["pumpFlowM3s"] > 0:
        o = flow_sim.optimise(req.pumpFlowM3s, req.setpointM, req.leaks, loss, req.leakageExponent, **options)
        opt, note = o["state"], o["note"]
        savings = {
            "leakReduction": _s((st["leakTotalM3s"] - opt["leakTotalM3s"]) * 86400, "m³/day", 0),
            "lossPctReduction": _s(st["lossPct"] - opt["lossPct"], "percentage points", 2),
            "deliveredGain": _s((opt["deliveredTotalM3s"] - st["deliveredTotalM3s"]) * 86400, "m³/day", 0),
            "setpointReduction": _s(st["setpointM"] - opt["setpointM"], "m", 2),
        }
    loss_m = mv(loss, "ratio", "conceptual", SRC, None, digits=3,  # type: ignore[arg-type]
                note="Assumption (parameters.yaml distribution_loss_rate or the What-if lever), not a statistic.")
    if req.optimize and st["pumpFlowM3s"] <= 0:
        note = "Nothing to optimise: no water is flowing (pump off, valve closed or no supply)."
    cfg = flow_sim.network()[1]
    return FlowResponse(state=to_state(st), optimized=to_state(opt) if opt else None, optimizationNote=note,
                        savings=savings, backgroundLossRate=loss_m, disclaimer=DISCLAIMER,
                        reservoirCapacity=_s(pval("flow_sim", "reservoir_capacity_m3"), "m³", 0),
                        defaultAllocationPct={k: round(v * 100, 1) for k, v in cfg["demand_split"].items()},
                        realPartsUsed=[], scaleContext=_scale(conn))
