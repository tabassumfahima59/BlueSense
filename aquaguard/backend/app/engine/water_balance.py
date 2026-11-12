"""Water-balance engine (per division, monthly climatological year, volumes in MCM).

    Supply_total   = Surface_supply + Groundwater_supply
    Surface_supply = Inflow_component + Local_runoff
    Local_runoff   = runoff_coefficient x rainfall x area
    Demand_s, s in {agriculture, domestic, industry, environment}
      agriculture  = irrigated area x gross irrigation requirement (FAO-56 engine)
      domestic     = population x per-capita demand
      industry     = AQUASTAT industrial withdrawal, split by population share
      environment  = reserved share of surface supply
    Losses         = conveyed volume x loss_rate   (piped domestic + industrial conveyance)
    Balance        : Supply_total = sum(Delivered_s) + Losses + dStorage   (|error| <= 0.01 MCM)
    Unmet_s        = max(0, Demand_s - Delivered_s)
    Stress_ratio   = consumptive demand / (Supply_total - environmental reserve)   [SDG 6.4.2 / Aqueduct form]

Pure functions only: inputs are passed in, nothing is read from disk here.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import fao56

SECTORS = ("agriculture", "domestic", "industry", "environment")
PIPED = ("domestic", "industry")
DAYS = fao56.DAYS_IN_MONTH


@dataclass(frozen=True)
class DivisionClimate:
    division: str
    area_km2: float
    area_share: float          # of national area (for inflow, groundwater and crop-area splits)
    population: float
    pop_share: float           # of national population (for industry split)
    precip_mm: tuple[float, ...]   # 12 monthly normals
    et0_mm: tuple[float, ...]
    tmean_c: tuple[float, ...]


@dataclass(frozen=True)
class BalanceConfig:
    runoff_coefficient: float
    environmental_reserve_share: float
    domestic_lpcd: float
    industrial_mcm_yr: float
    inflow_mcm_yr: float
    inflow_shape: tuple[float, ...]   # 12 monthly shares summing to 1
    groundwater_mcm_yr: float
    loss_rate: float
    irrigation_efficiency: float
    demand_multiplier: float = 1.0    # domestic + industry (scenario)
    groundwater_multiplier: float = 1.0


@dataclass
class MonthBalance:
    month: int
    precip_mm: float
    et0_mm: float
    inflow: float
    runoff: float
    surface: float
    groundwater: float
    supply: float
    demand: dict[str, float]
    need: dict[str, float]          # volume that must be conveyed to satisfy demand (incl. losses)
    allocation: dict[str, float]    # volume conveyed/assigned per sector
    delivered: dict[str, float]
    losses: float
    storage_change: float           # unallocated: retained in storage or flowing out
    unmet: dict[str, float]
    agri_net: float = 0.0

    @property
    def consumptive_demand(self) -> float:
        return sum(self.demand[s] for s in ("agriculture", "domestic", "industry"))

    @property
    def balance_error(self) -> float:
        return self.supply - (sum(self.delivered.values()) + self.losses + self.storage_change)


@dataclass
class Balance:
    division: str
    months: list[MonthBalance] = field(default_factory=list)
    agri_detail: dict = field(default_factory=dict)


def local_runoff_mcm(runoff_coefficient: float, precip_mm: float, area_km2: float) -> float:
    """mm x km2 = 1e-3 m x 1e6 m2 = 1e3 m3 = 1e-3 MCM."""
    return runoff_coefficient * max(precip_mm, 0.0) * area_km2 * 1e-3


def domestic_mcm(population: float, lpcd: float, days: int) -> float:
    """persons x L/person/day x days -> m3 (/1e3) -> MCM (/1e6)."""
    return population * lpcd * days / 1e9


def needs_from_demand(demand: dict[str, float], loss_rate: float) -> dict[str, float]:
    if not 0 <= loss_rate < 1:
        raise ValueError("loss_rate must be in [0, 1)")
    return {s: (demand[s] / (1 - loss_rate) if s in PIPED else demand[s]) for s in SECTORS}


def deliver(allocation: dict[str, float], loss_rate: float) -> tuple[dict[str, float], float]:
    delivered = {s: (allocation[s] * (1 - loss_rate) if s in PIPED else allocation[s]) for s in SECTORS}
    losses = sum(allocation[s] * loss_rate for s in PIPED)
    return delivered, losses


def allocate_proportional(supply: float, need: dict[str, float]) -> dict[str, float]:
    """Current-practice proxy: everyone is served when supply suffices; otherwise pro-rata rationing."""
    total = sum(need.values())
    if total <= supply or total == 0:
        return dict(need)
    f = supply / total
    return {s: need[s] * f for s in SECTORS}


def settle(month: int, precip: float, et0: float, inflow: float, runoff: float, gw: float,
           demand: dict[str, float], loss_rate: float, allocation: dict[str, float] | None = None,
           agri_net: float = 0.0) -> MonthBalance:
    surface = inflow + runoff
    supply = surface + gw
    need = needs_from_demand(demand, loss_rate)
    alloc = allocation if allocation is not None else allocate_proportional(supply, need)
    if sum(alloc.values()) > supply + 1e-9:
        raise ValueError("allocation exceeds supply")
    delivered, losses = deliver(alloc, loss_rate)
    storage = supply - sum(alloc.values())
    unmet = {s: max(0.0, demand[s] - delivered[s]) for s in SECTORS}
    return MonthBalance(month=month, precip_mm=precip, et0_mm=et0, inflow=inflow, runoff=runoff, surface=surface,
                        groundwater=gw, supply=supply, demand=demand, need=need, allocation=alloc,
                        delivered=delivered, losses=losses, storage_change=storage, unmet=unmet, agri_net=agri_net)


def division_balance(clim: DivisionClimate, cfg: BalanceConfig) -> Balance:
    agri = fao56.agricultural_demand_monthly(list(clim.precip_mm), list(clim.et0_mm),
                                             cfg.irrigation_efficiency, clim.area_share)
    demand_m, need_tot = [], []
    for m in range(12):
        dom = domestic_mcm(clim.population, cfg.domestic_lpcd, DAYS[m]) * cfg.demand_multiplier
        ind = cfg.industrial_mcm_yr * clim.pop_share * DAYS[m] / 365.0 * cfg.demand_multiplier
        demand_m.append({"agriculture": agri["gross_mcm"][m], "domestic": dom, "industry": ind})
        need_tot.append(agri["gross_mcm"][m] + (dom + ind) / (1 - cfg.loss_rate))
    gw_year = cfg.groundwater_mcm_yr * clim.area_share * cfg.groundwater_multiplier
    total_need = sum(need_tot)
    out = Balance(division=clim.division, agri_detail=agri)
    for m in range(12):
        inflow = cfg.inflow_mcm_yr * clim.area_share * cfg.inflow_shape[m]
        runoff = local_runoff_mcm(cfg.runoff_coefficient, clim.precip_mm[m], clim.area_km2)
        # Aquifer storage buffers seasonal recharge: annual renewable groundwater is usable in
        # proportion to each month's consumptive need (assumption A-07).
        gw = gw_year * (need_tot[m] / total_need) if total_need > 0 else gw_year / 12.0
        demand = {**demand_m[m], "environment": cfg.environmental_reserve_share * (inflow + runoff)}
        out.months.append(settle(m + 1, clim.precip_mm[m], clim.et0_mm[m], inflow, runoff, gw, demand,
                                 cfg.loss_rate, agri_net=agri["net_mcm"][m]))
    return out


# ---------------------------------------------------------------- aggregation

def _sum_dicts(items: list[dict[str, float]]) -> dict[str, float]:
    return {s: sum(i[s] for i in items) for s in SECTORS}


def aggregate(months: list[MonthBalance]) -> dict:
    """Totals over any set of months (one or many divisions)."""
    supply = sum(m.supply for m in months)
    env = sum(m.demand["environment"] for m in months)
    consumptive = sum(m.consumptive_demand for m in months)
    demand = _sum_dicts([m.demand for m in months])
    delivered = _sum_dicts([m.delivered for m in months])
    allocation = _sum_dicts([m.allocation for m in months])
    unmet = _sum_dicts([m.unmet for m in months])
    losses = sum(m.losses for m in months)
    storage = sum(m.storage_change for m in months)
    usable = supply - env
    return {
        "inflow": sum(m.inflow for m in months), "runoff": sum(m.runoff for m in months),
        "surface": sum(m.surface for m in months), "groundwater": sum(m.groundwater for m in months),
        "supply": supply, "demand": demand, "consumptiveDemand": consumptive, "allocation": allocation,
        "delivered": delivered, "losses": losses, "storageChange": storage, "unmet": unmet,
        "unmetTotal": sum(unmet.values()), "agriNet": sum(m.agri_net for m in months),
        "stressRatio": (consumptive / usable) if usable > 0 else float("inf"),
        "balanceError": supply - (sum(delivered.values()) + losses + storage),
    }


def stress_class(ratio: float, classes: list[dict]) -> str:
    for c in classes:
        if c["max"] is None or ratio < c["max"]:
            return c["name"]
    return classes[-1]["name"]
