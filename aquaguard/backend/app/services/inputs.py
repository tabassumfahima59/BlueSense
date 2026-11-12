"""Assemble engine inputs from the data layer + parameters.yaml (the only bridge between I/O and engines)."""
from __future__ import annotations

from functools import lru_cache

from ..config.params import pval
from ..engine.water_balance import BalanceConfig, DivisionClimate
from . import data_access as da


@lru_cache
def baseline_config() -> BalanceConfig:
    shape, _ = da.inflow_shape()
    if len(shape) != 12:
        raise RuntimeError("inflow shape unavailable")
    total = sum(shape.values())
    return BalanceConfig(
        runoff_coefficient=pval("water_balance", "runoff_coefficient"),
        environmental_reserve_share=pval("water_balance", "environmental_reserve_share"),
        domestic_lpcd=pval("water_balance", "domestic_per_capita_lpcd"),
        industrial_mcm_yr=pval("water_balance", "industrial_withdrawal_mcm"),
        inflow_mcm_yr=pval("water_balance", "surface_inflow_mcm"),
        inflow_shape=tuple(shape[m] / total for m in range(1, 13)),
        groundwater_mcm_yr=pval("water_balance", "groundwater_renewable_mcm"),
        loss_rate=pval("water_balance", "distribution_loss_rate"),
        irrigation_efficiency=pval("water_balance", "irrigation_efficiency"),
    )


@lru_cache
def division_climates() -> dict[str, DivisionClimate]:
    regs = [r for r in da.regions() if r["level"] == "division"]
    area_total = sum(r["area_km2"] for r in regs)
    pop_total = sum(r["population"] for r in regs)
    clim = da.climatology().df
    out = {}
    for r in regs:
        c = clim[clim["division"] == r["id"]].sort_values("month")
        if len(c) != 12:
            raise RuntimeError(f"climatology incomplete for {r['id']}")
        out[r["id"]] = DivisionClimate(
            division=r["id"], area_km2=float(r["area_km2"]), area_share=float(r["area_km2"]) / area_total,
            population=float(r["population"]), pop_share=float(r["population"]) / pop_total,
            precip_mm=tuple(float(x) for x in c["precip_mm"]), et0_mm=tuple(float(x) for x in c["et0_mm"]),
            tmean_c=tuple(float(x) for x in c["tmean_c"]),
        )
    return out


def inputs_are_sample() -> bool:
    return any(da.table(t).is_sample for t in ("climatology", "regions", "inflow_shape"))


def clear() -> None:
    baseline_config.cache_clear()
    division_climates.cache_clear()
