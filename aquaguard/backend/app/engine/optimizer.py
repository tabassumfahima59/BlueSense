"""Allocation optimizer for the Water Budget module.

Per month, a small linear program (scipy.optimize.linprog, HiGHS):

    minimise   sum_s w_s * unmet_s              (delivered-volume terms)
    subject to sum_s a_s <= supply              (conveyed allocations)
               a_s <= need_s                    (no sector gets more than it needs)
               a_env >= env_min * need_env      (environmental minimum protected)
               a_s >= 0
    where delivered_s = a_s * (1 - loss) for piped sectors, a_s otherwise.

Weights put domestic first (w = 100), then agriculture (10) and industry (5). The environment carries
no unmet weight beyond its protected minimum. Weights and the minimum are documented in METHODS.md.
User-defined shares are also supported (shares always normalised to sum to 1).
"""
from __future__ import annotations

from scipy.optimize import linprog

from .water_balance import PIPED, SECTORS, MonthBalance, settle

WEIGHTS = {"domestic": 100.0, "agriculture": 10.0, "industry": 5.0, "environment": 0.0}
ENV_MIN_FRACTION = 1.0


def optimal_allocation(supply: float, need: dict[str, float], loss_rate: float,
                       env_min_fraction: float = ENV_MIN_FRACTION) -> dict[str, float]:
    env_min = min(need["environment"] * env_min_fraction, supply)
    if sum(need.values()) <= supply:
        return dict(need)
    # maximise weighted delivered volume == minimise weighted unmet
    c = [-(WEIGHTS[s] * ((1 - loss_rate) if s in PIPED else 1.0)) for s in SECTORS]
    bounds = []
    for s in SECTORS:
        lo = env_min if s == "environment" else 0.0
        bounds.append((lo, max(need[s], lo)))
    res = linprog(c, A_ub=[[1.0] * len(SECTORS)], b_ub=[supply], bounds=bounds, method="highs")
    if not res.success:
        raise RuntimeError(f"optimizer failed: {res.message}")
    alloc = {s: float(max(0.0, x)) for s, x in zip(SECTORS, res.x)}
    over = sum(alloc.values()) - supply  # numerical guard
    if over > 0:
        biggest = max(alloc, key=alloc.get)
        alloc[biggest] -= over
    return alloc


def allocation_by_shares(supply: float, need: dict[str, float], shares: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, shares.get(s, 0.0)) for s in SECTORS)
    if total <= 0:
        raise ValueError("allocation shares must have a positive sum")
    norm = {s: max(0.0, shares.get(s, 0.0)) / total for s in SECTORS}
    usable = min(supply, sum(need.values()))
    return {s: min(need[s], usable * norm[s]) for s in SECTORS}


def reallocate(month: MonthBalance, loss_rate: float, mode: str, shares: dict[str, float] | None = None) -> MonthBalance:
    if mode == "optimized":
        alloc = optimal_allocation(month.supply, month.need, loss_rate)
    elif mode == "shares":
        alloc = allocation_by_shares(month.supply, month.need, shares or {})
    else:
        raise ValueError(mode)
    return settle(month.month, month.precip_mm, month.et0_mm, month.inflow, month.runoff, month.groundwater,
                  month.demand, loss_rate, allocation=alloc, agri_net=month.agri_net)
