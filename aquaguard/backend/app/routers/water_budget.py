"""M5 Water Budget Sankey: /budget and /budget/optimize."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..config.params import pval
from ..engine import optimizer
from ..engine.water_balance import SECTORS, MonthBalance, aggregate
from ..schemas.common import ScenarioParams
from ..schemas.modules import (
    BudgetResponse,
    BudgetState,
    OptimizeRequest,
    OptimizeResponse,
    SankeyLink,
    SankeyNode,
    SectorRow,
)
from ..services import regional
from ..services.measure import engine
from .deps import context, region_or_404, scenario_query

router = APIRouter(tags=["Water Budget Sankey"])
LABELS = {"agriculture": "Agriculture", "domestic": "Domestic", "industry": "Industry", "environment": "Environment"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def period_label(period: str) -> str:
    if period == "annual":
        return "Annual (climatological year)"
    if period == "dry":
        months = pval("water_balance", "dry_season_months")
        return f"Dry season ({MONTHS[months[0] - 1]}-{MONTHS[months[-1] - 1]})"
    return MONTHS[int(period) - 1]


def budget_state(months: list[MonthBalance], sc: bool, smp: bool) -> BudgetState:
    t = aggregate(months)
    tol = pval("water_balance", "balance_tolerance_mcm")
    e = lambda v, d=1: engine(v, "MCM", sc, smp, d)  # noqa: E731
    nodes = [SankeyNode(id="surface", label="Surface water", kind="source"),
             SankeyNode(id="groundwater", label="Groundwater", kind="source"),
             SankeyNode(id="available", label="Total available", kind="pool")]
    links = [SankeyLink(source="surface", target="available", value=e(t["surface"])),
             SankeyLink(source="groundwater", target="available", value=e(t["groundwater"]))]
    for s in SECTORS:
        nodes.append(SankeyNode(id=s, label=LABELS[s], kind="sector"))
        links.append(SankeyLink(source="available", target=s, value=e(t["delivered"][s])))
    nodes.append(SankeyNode(id="losses", label="Distribution losses", kind="loss"))
    links.append(SankeyLink(source="available", target="losses", value=e(t["losses"])))
    if abs(t["storageChange"]) > tol:
        nodes.append(SankeyNode(id="storage", label="Unallocated (storage / outflow)", kind="storage"))
        links.append(SankeyLink(source="available", target="storage", value=e(t["storageChange"])))
    total_alloc = sum(t["allocation"].values())
    rows = [SectorRow(sector=s, demand=e(t["demand"][s]), allocation=e(t["allocation"][s]),
                      delivered=e(t["delivered"][s]), unmet=e(t["unmet"][s]),
                      share=engine(t["allocation"][s] / total_alloc if total_alloc else 0.0, "ratio", sc, smp, 4))
            for s in SECTORS]
    return BudgetState(nodes=nodes, links=links, supply=e(t["supply"]), surface=e(t["surface"]),
                       groundwater=e(t["groundwater"]), losses=e(t["losses"]), storageChange=e(t["storageChange"]),
                       unmetTotal=e(t["unmetTotal"]), sectors=rows, balanceError=engine(t["balanceError"], "MCM", sc, smp, 6),
                       balanced=abs(t["balanceError"]) <= tol)


NOTES = [
    "Supply = surface (transboundary inflow + local runoff) + renewable groundwater; Estimated from AQUASTAT "
    "and ERA5 rainfall normals.",
    "Environment = reserved in-stream share of surface supply (AQUASTAT environmental flow requirement).",
    "Distribution losses apply to piped domestic and industrial conveyance; irrigation losses are inside "
    "agricultural gross demand (irrigation efficiency).",
    "'Current' allocation is a pro-rata proxy for current practice, not observed allocation data.",
]


@router.get("/budget", response_model=BudgetResponse)
def budget(region: str = "bd", period: str = "dry", scenario: ScenarioParams = Depends(scenario_query)) -> BudgetResponse:
    region_or_404(region)
    try:
        period = regional.validate_period(period)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    run = regional.run(region, scenario)
    return BudgetResponse(context=context(run), period=period, periodLabel=period_label(period),
                          current=budget_state(run.months(period), run.is_scenario, run.is_sample), notes=NOTES)


@router.post("/budget/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    region_or_404(req.region)
    try:
        period = regional.validate_period(req.period)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if req.mode == "shares":
        if not req.shares or set(req.shares) - set(SECTORS) or sum(max(0, v) for v in req.shares.values()) <= 0:
            raise HTTPException(status_code=422, detail=f"shares must map sectors {list(SECTORS)} to non-negative "
                                                        "numbers with a positive sum")
    run = regional.run(req.region, req.scenario)
    sc, smp = run.is_scenario, run.is_sample
    current_months = run.months(period)
    proposed_months = regional.reallocated(run, period, req.mode, req.shares)
    cur, prop = aggregate(current_months), aggregate(proposed_months)
    savings = {
        "unmetReduction": engine(cur["unmetTotal"] - prop["unmetTotal"], "MCM", sc, smp, 1),
        "domesticUnmetReduction": engine(cur["unmet"]["domestic"] - prop["unmet"]["domestic"], "MCM", sc, smp, 2),
        "lossChange": engine(prop["losses"] - cur["losses"], "MCM", sc, smp, 2),
        "deliveredGain": engine(sum(prop["delivered"].values()) - sum(cur["delivered"].values()), "MCM", sc, smp, 1),
    }
    method = ("Linear program per month (scipy linprog/HiGHS): minimise weighted unmet demand with weights "
              f"{optimizer.WEIGHTS} (domestic first) and the environmental reserve protected at "
              f"{optimizer.ENV_MIN_FRACTION:.0%}." if req.mode == "optimized" else
              "User-defined allocation shares (normalised to 100%), capped at each sector's need.")
    return OptimizeResponse(context=context(run), period=period, current=budget_state(current_months, sc, smp),
                            proposed=budget_state(proposed_months, sc, smp), savings=savings, method=method)
