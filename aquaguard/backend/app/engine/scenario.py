"""Scenario engine: applies ScenarioParams to baseline inputs. Outputs are labelled Simulated.

    Rainfall change %        -> local runoff (surface supply) and effective rainfall in FAO-56
    Temperature change C     -> ET0 x (Tmean + dT + 17.8) / (Tmean + 17.8)   (Hargreaves temperature term)
    Demand change %          -> domestic and industrial demand
    Agricultural demand %    -> gross agricultural (irrigation) demand
    Groundwater availability -> groundwater supply
    Irrigation efficiency    -> GIR = NIR / efficiency
    Pipeline loss %          -> loss_rate in the water balance and the flow-simulation baseline
"""
from __future__ import annotations

from dataclasses import replace

from .water_balance import BalanceConfig, DivisionClimate


def hargreaves_ratio(tmean_c: float, delta_c: float) -> float:
    return (tmean_c + delta_c + 17.8) / (tmean_c + 17.8)


def apply_climate(clim: DivisionClimate, rainfall_change_pct: float, temperature_change_c: float) -> DivisionClimate:
    rain = 1.0 + rainfall_change_pct / 100.0
    precip = tuple(p * rain for p in clim.precip_mm)
    et0 = tuple(e * hargreaves_ratio(t, temperature_change_c) for e, t in zip(clim.et0_mm, clim.tmean_c))
    tmean = tuple(t + temperature_change_c for t in clim.tmean_c)
    return replace(clim, precip_mm=precip, et0_mm=et0, tmean_c=tmean)


def apply_config(cfg: BalanceConfig, demand_change_pct: float, groundwater_availability_pct: float,
                 irrigation_efficiency: float | None, pipeline_loss_pct: float | None,
                 agricultural_demand_change_pct: float = 0.0) -> BalanceConfig:
    return replace(
        cfg,
        demand_multiplier=1.0 + demand_change_pct / 100.0,
        agri_multiplier=1.0 + agricultural_demand_change_pct / 100.0,
        groundwater_multiplier=1.0 + groundwater_availability_pct / 100.0,
        irrigation_efficiency=irrigation_efficiency if irrigation_efficiency is not None else cfg.irrigation_efficiency,
        loss_rate=(pipeline_loss_pct / 100.0) if pipeline_loss_pct is not None else cfg.loss_rate,
    )


def apply(clim: DivisionClimate, cfg: BalanceConfig, p) -> tuple[DivisionClimate, BalanceConfig]:
    """p: ScenarioParams (duck-typed so the engine does not import the API schema)."""
    return (
        apply_climate(clim, p.rainfallChangePct, p.temperatureChangeC),
        apply_config(cfg, p.demandChangePct, p.groundwaterAvailabilityPct, p.irrigationEfficiency, p.pipelineLossPct,
                     getattr(p, "agriculturalDemandChangePct", 0.0)),
    )
