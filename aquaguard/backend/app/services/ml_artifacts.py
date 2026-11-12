"""Read ML artifacts (never trains). Re-runs the stored models for scenarios.

Artifacts (ml/artifacts/): predictions.json, metrics.json, shap.json, model_meta.json, grace_trend.json,
train_climatology.csv, model_h{1,3,6}.joblib. Missing artifacts -> callers show "Not evaluated yet" /
empty states.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from functools import lru_cache
from types import ModuleType

import pandas as pd

from ..settings import get_settings
from . import data_access as da

HORIZONS = (1, 3, 6)


def _artifact(name: str):
    p = get_settings().artifacts_dir / name
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


@lru_cache
def predictions() -> dict | None:
    return _artifact("predictions.json")


@lru_cache
def metrics() -> dict | None:
    return _artifact("metrics.json")


@lru_cache
def shap_values() -> dict | None:
    return _artifact("shap.json")


@lru_cache
def model_meta() -> dict | None:
    return _artifact("model_meta.json")


@lru_cache
def grace_trend() -> dict | None:
    return _artifact("grace_trend.json")


@lru_cache
def split_info() -> dict | None:
    return _artifact("split.json")


@lru_cache
def _features_module() -> ModuleType:
    """Load ml/features.py — the same feature code used in training."""
    path = get_settings().root / "ml" / "features.py"
    spec = importlib.util.spec_from_file_location("aquaguard_ml_features", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["aquaguard_ml_features"] = mod
    spec.loader.exec_module(mod)
    return mod


@lru_cache
def _model(h: int):
    import joblib

    meta = model_meta()
    if not meta:
        return None
    p = get_settings().artifacts_dir / meta["horizons"][str(h)]["modelFile"]
    return joblib.load(p) if p.exists() else None


@lru_cache
def _train_clim() -> pd.DataFrame | None:
    p = get_settings().artifacts_dir / "train_climatology.csv"
    return pd.read_csv(p) if p.exists() else None


def available() -> bool:
    return predictions() is not None and model_meta() is not None


def baseline_forecast(division: str, h: int) -> dict | None:
    p = predictions()
    if not p:
        return None
    return p["forecasts"].get(division, {}).get(str(h))


@lru_cache(maxsize=256)
def scenario_forecast(division: str, h: int, rain_pct: float, temp_c: float) -> dict | None:
    """Re-run the operational model with perturbed recent rainfall/temperature (last 3 months), then add
    the scenario's direct effect on the target month: + r x P_normal - (Hargreaves ratio - 1) x ET0_normal.
    The result is Simulated."""
    base = baseline_forecast(division, h)
    model, clim_train = _model(h), _train_clim()
    if base is None or model is None or clim_train is None:
        return None
    f = _features_module()
    monthly = da.monthly().df[["division", "year", "month", "precip_mm", "et0_mm", "d_mm", "tmean_c",
                               "soil_moisture_m3m3"]]
    pert = f.perturb_recent(monthly, rain_pct, temp_c)
    feats = f.make_features(pert[pert["division"] == division], clim_train, h)
    row = feats.sort_values(["year", "month"]).tail(1)
    if not len(row):
        return None
    pred = float(model.predict(row[f.feature_columns()])[0])
    tm = int(row["target_month"].iloc[0])
    normals = da.climatology(division).df.set_index("month").loc[tm]
    ratio = (normals["tmean_c"] + temp_c + 17.8) / (normals["tmean_c"] + 17.8)
    direct = (rain_pct / 100.0) * normals["precip_mm"] - (ratio - 1.0) * normals["et0_mm"]
    value = pred + direct
    shift = value - base["value"]
    z = (value - base["climMean"]) / base["climSd"]
    return {**base, "value": round(value, 2), "low": round(base["low"] + shift, 2),
            "high": round(base["high"] + shift, 2), "z": round(z, 3), "modelRecentEffect": round(pred - base["value"], 2),
            "directEffect": round(float(direct), 2)}


def clear() -> None:
    for fn in (predictions, metrics, shap_values, model_meta, grace_trend, split_info, _model, _train_clim,
               scenario_forecast):
        fn.cache_clear()
