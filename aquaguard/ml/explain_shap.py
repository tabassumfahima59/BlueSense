"""SHAP explanations (TreeExplainer) for the operational models -> ml/artifacts/shap.json.

    python ml/explain_shap.py

global : mean |SHAP| per feature over the test-period rows (up to 400 rows), per horizon
local  : per division, the latest forecast row: base value, prediction, top contributions
"""
from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd
import shap

from common import ARTIFACTS, PROCESSED, now_iso, write_json
from features import feature_columns, make_features

HORIZONS = (1, 3, 6)
TOP = 12

LABELS = {
    "target_month_sin": "Target month (sin)", "target_month_cos": "Target month (cos)",
    "clim_d_target": "Normal D for target month", "clim_sd_target": "Variability of D (target month)",
    "division_id": "Division", "sm_lag0": "Soil moisture (latest month)",
    "d_roll3": "D, 3-month mean", "d_roll6": "D, 6-month mean", "d_roll12": "D, 12-month mean",
    "p_roll3": "Rainfall, 3-month mean", "p_roll6": "Rainfall, 6-month mean",
}


def label(f: str) -> str:
    if f in LABELS:
        return LABELS[f]
    var, lag = f.rsplit("_lag", 1)
    name = {"d": "D (P - ET0)", "p": "Rainfall", "et0": "ET0", "tmean": "Mean temperature",
            "d_anom": "D anomaly"}.get(var, var)
    return f"{name}, {lag} month(s) ago" if lag != "0" else f"{name}, latest month"


def main() -> None:
    meta = json.loads((ARTIFACTS / "model_meta.json").read_text(encoding="utf-8"))
    monthly = pd.read_csv(PROCESSED / "weather_monthly.csv")
    clim = pd.read_csv(ARTIFACTS / "train_climatology.csv")
    cols = feature_columns()
    out = {"generatedAt": now_iso(), "method": "shap.TreeExplainer on the operational model", "horizons": {}}
    for h in HORIZONS:
        model = joblib.load(ARTIFACTS / meta["horizons"][str(h)]["modelFile"])
        explainer = shap.TreeExplainer(model)
        feats = pd.read_csv(ARTIFACTS / f"features_h{h}.csv")
        test = feats[feats["split"] == "test"]
        sample = test.sample(n=min(400, len(test)), random_state=0)
        sv = explainer.shap_values(sample[cols])
        imp = np.abs(sv).mean(axis=0)
        order = np.argsort(imp)[::-1][:TOP]
        latest = make_features(monthly, clim, h).sort_values(["year", "month"]).groupby("division").tail(1)
        lv = explainer.shap_values(latest[cols])
        base = float(np.ravel(explainer.expected_value)[0])
        local = {}
        for i, (_, row) in enumerate(latest.iterrows()):
            contrib = sorted(zip(cols, lv[i], row[cols]), key=lambda t: -abs(t[1]))[:8]
            local[row["division"]] = {
                "baseValue": round(base, 3), "prediction": round(base + float(lv[i].sum()), 3),
                "contributions": [{"feature": f, "label": label(f), "shap": round(float(s), 3),
                                   "value": None if pd.isna(v) else round(float(v), 3)} for f, s, v in contrib],
            }
        out["horizons"][str(h)] = {
            "model": meta["horizons"][str(h)]["selected"], "rows": int(len(sample)),
            "global": [{"feature": cols[j], "label": label(cols[j]), "meanAbsShap": round(float(imp[j]), 3)}
                       for j in order],
            "local": local,
        }
        print(f"h={h}: top features {[cols[j] for j in order[:5]]}")
    write_json(ARTIFACTS / "shap.json", out)


if __name__ == "__main__":
    main()
