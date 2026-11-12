"""Feature builder shared by training (ml/) and serving (backend/app/services/ml_artifacts.py).

Target: climatic water balance D = P - ET0 (mm/month) at month t + h, issued at month t.
Features use only months <= t (no leakage from the forecast period):
  lags 0-11 of P, ET0 and D; Tmean lags 0-2; soil moisture lag 0 (ERA5-Land model data);
  rolling means of D (3, 6, 12) and P (3, 6); D anomaly vs training climatology (lags 0-2);
  target-month sin/cos; training-period climatology mean/sd of D for the target month; division id.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

DIVISIONS = ["barishal", "chattogram", "dhaka", "khulna", "mymensingh", "rajshahi", "rangpur", "sylhet"]
LAGS = 12


def feature_columns() -> list[str]:
    cols = []
    for v in ("d", "p", "et0"):
        cols += [f"{v}_lag{k}" for k in range(LAGS)]
    cols += [f"tmean_lag{k}" for k in range(3)]
    cols += ["sm_lag0", "d_roll3", "d_roll6", "d_roll12", "p_roll3", "p_roll6",
             "d_anom_lag0", "d_anom_lag1", "d_anom_lag2",
             "target_month_sin", "target_month_cos", "clim_d_target", "clim_sd_target", "division_id"]
    return cols


def train_climatology(monthly: pd.DataFrame, last_train_year: int) -> pd.DataFrame:
    base = monthly[monthly["year"] <= last_train_year]
    return base.groupby(["division", "month"]).agg(d_mean=("d_mm", "mean"), d_sd=("d_mm", "std")).reset_index()


def make_features(monthly: pd.DataFrame, clim: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """monthly: division, year, month, precip_mm, et0_mm, d_mm, tmean_c, soil_moisture_m3m3."""
    frames = []
    for div, g in monthly.sort_values(["division", "year", "month"]).groupby("division"):
        g = g.reset_index(drop=True)
        cm = clim[clim["division"] == div].set_index("month")
        out = pd.DataFrame({"division": div, "year": g["year"], "month": g["month"]})
        for k in range(LAGS):
            out[f"d_lag{k}"] = g["d_mm"].shift(k)
            out[f"p_lag{k}"] = g["precip_mm"].shift(k)
            out[f"et0_lag{k}"] = g["et0_mm"].shift(k)
        for k in range(3):
            out[f"tmean_lag{k}"] = g["tmean_c"].shift(k)
        out["sm_lag0"] = g["soil_moisture_m3m3"]
        out["d_roll3"] = g["d_mm"].rolling(3).mean()
        out["d_roll6"] = g["d_mm"].rolling(6).mean()
        out["d_roll12"] = g["d_mm"].rolling(12).mean()
        out["p_roll3"] = g["precip_mm"].rolling(3).mean()
        out["p_roll6"] = g["precip_mm"].rolling(6).mean()
        anom = g["d_mm"] - g["month"].map(cm["d_mean"])
        for k in range(3):
            out[f"d_anom_lag{k}"] = anom.shift(k)
        tm = ((g["month"] - 1 + horizon) % 12) + 1
        out["target_month"] = tm
        out["target_year"] = g["year"] + (g["month"] - 1 + horizon) // 12
        out["target_month_sin"] = np.sin(2 * math.pi * tm / 12)
        out["target_month_cos"] = np.cos(2 * math.pi * tm / 12)
        out["clim_d_target"] = tm.map(cm["d_mean"]).to_numpy()
        out["clim_sd_target"] = tm.map(cm["d_sd"]).to_numpy()
        out["division_id"] = DIVISIONS.index(div)
        out["target_d"] = g["d_mm"].shift(-horizon)
        frames.append(out)
    df = pd.concat(frames, ignore_index=True)
    return df.dropna(subset=[c for c in feature_columns() if c != "sm_lag0"])


def perturb_recent(monthly: pd.DataFrame, rainfall_change_pct: float, temperature_change_c: float,
                   months: int = 3) -> pd.DataFrame:
    """Scenario hook: scale the last `months` of P (rainfall %) and ET0 (Hargreaves temperature ratio)."""
    df = monthly.sort_values(["division", "year", "month"]).copy()
    key = df["year"] * 12 + df["month"]
    recent = key >= key.max() - months + 1
    r = 1.0 + rainfall_change_pct / 100.0
    ratio = (df["tmean_c"] + temperature_change_c + 17.8) / (df["tmean_c"] + 17.8)
    df.loc[recent, "precip_mm"] = df.loc[recent, "precip_mm"] * r
    df.loc[recent, "et0_mm"] = df.loc[recent, "et0_mm"] * ratio[recent]
    df.loc[recent, "tmean_c"] = df.loc[recent, "tmean_c"] + temperature_change_c
    df["d_mm"] = df["precip_mm"] - df["et0_mm"]
    return df
