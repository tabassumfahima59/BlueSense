"""M4 3D Water Flow: /flow/simulate (every value Simulated)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config.params import pval
from ..engine import flow_sim
from ..schemas.modules import DestinationState, FlowRequest, FlowResponse, FlowState, PipeState
from ..services.measure import m

router = APIRouter(tags=["3D Water Flow"])
SRC = "aquaguard_engine"
DISCLAIMER = ("SIMULATED hypothetical network. AquaGuard has no IoT sensors, no real-time pipe pressure and no "
              "pump or valve control; it does not detect physical leaks.")


def _s(v: float, unit: str, digits: int = 4):
    return m(v, unit, "simulated", SRC, digits=digits)


def to_state(st: dict) -> FlowState:
    return FlowState(
        pumpFlow=_s(st["pumpFlowM3s"], "m³/s"), setpoint=_s(st["setpointM"], "m", 2),
        pipes=[PipeState(
            id=p["id"], fromNode=p["from"], toNode=p["to"], flow=_s(p["flowM3s"], "m³/s"),
            velocity=_s(p["velocityMs"], "m/s", 3), headLoss=_s(p["headLossM"], "m", 3),
            pressureStart=_s(p["pressureStartM"], "m", 2), pressureEnd=_s(p["pressureEndM"], "m", 2),
            pressureEndKpa=_s(p["pressureEndM"] * flow_sim.KPA_PER_M, "kPa", 1), leak=_s(p["leakM3s"], "m³/s", 5),
            burstSeverity=float(st["burstLeaks"].get(p["id"], 0.0))) for p in st["pipes"]],
        destinations=[DestinationState(
            id=d["id"], delivered=_s(d["deliveredM3s"], "m³/s"), deliveredDaily=_s(d["deliveredM3s"] * 86400, "m³/day", 0),
            pressure=_s(d["pressureM"], "m", 2), minServicePressure=_s(d["minServicePressureM"], "m", 1),
            serviceOk=d["serviceOk"]) for d in st["destinations"]],
        leakTotal=_s(st["leakTotalM3s"], "m³/s", 5), deliveredTotal=_s(st["deliveredTotalM3s"], "m³/s"),
        lossPct=_s(st["lossPct"], "%", 2), massBalanceError=_s(st["massBalanceErrorM3s"], "m³/s", 9))


@router.post("/flow/simulate", response_model=FlowResponse)
def simulate(req: FlowRequest) -> FlowResponse:
    for pid, sev in req.leaks.items():
        if not 0 <= sev <= 3:
            raise HTTPException(status_code=422, detail=f"leak severity for '{pid}' must be between 0 and 3")
    loss = (req.lossPct / 100.0) if req.lossPct is not None else pval("water_balance", "distribution_loss_rate")
    try:
        st = flow_sim.simulate(req.pumpFlowM3s, req.setpointM, req.leaks, loss, req.leakageExponent)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    opt = note = savings = None
    if req.optimize:
        o = flow_sim.optimise(req.pumpFlowM3s, req.setpointM, req.leaks, loss, req.leakageExponent)
        opt, note = o["state"], o["note"]
        savings = {
            "leakReduction": _s((st["leakTotalM3s"] - opt["leakTotalM3s"]) * 86400, "m³/day", 0),
            "lossPctReduction": _s(st["lossPct"] - opt["lossPct"], "percentage points", 2),
            "deliveredGain": _s((opt["deliveredTotalM3s"] - st["deliveredTotalM3s"]) * 86400, "m³/day", 0),
            "setpointReduction": _s(st["setpointM"] - opt["setpointM"], "m", 2),
        }
    return FlowResponse(state=to_state(st), optimized=to_state(opt) if opt else None, optimizationNote=note,
                        savings=savings, backgroundLossRate=_s(loss, "ratio", 3), disclaimer=DISCLAIMER)
