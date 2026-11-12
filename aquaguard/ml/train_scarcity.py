"""Train scarcity (climatic water balance) models for horizons 1, 3, 6 months.

    python ml/train_scarcity.py      (after build_features.py)

Per horizon:
  1. Fit Random Forest and XGBoost on TRAIN; pick the one with the lower VALIDATION RMSE.
  2. Prediction interval: 5th/95th percentiles of the selected model's validation residuals, computed
     separately for each target calendar month (errors are much larger in the monsoon).
  3. Refit the selected configuration on TRAIN+VALIDATION -> predict TEST (evaluated by evaluate.py).
  4. Refit on ALL labelled data -> operational model used for the latest forecast and scenarios.
Baselines (climatology, persistence) are written alongside for evaluation.
"""
from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor

from common import ARTIFACTS, now_iso, write_json
from features import feature_columns

HORIZONS = (1, 3, 6)
SEED = 42


def make_model(kind: str):
    if kind == "random_forest":
        return RandomForestRegressor(n_estimators=200, min_samples_leaf=5, max_features=0.5, n_jobs=-1,
                                     random_state=SEED)
    if kind == "xgboost":
        return XGBRegressor(n_estimators=500, learning_rate=0.03, max_depth=4, subsample=0.8,
                            colsample_bytree=0.7, min_child_weight=3, random_state=SEED, n_jobs=4)
    raise ValueError(kind)


def rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def main() -> None:
    cols = feature_columns()
    meta = {"trainedAt": now_iso(), "features": cols, "horizons": {}}
    test_rows = []
    for h in HORIZONS:
        df = pd.read_csv(ARTIFACTS / f"features_h{h}.csv")
        lab = df.dropna(subset=["target_d"])
        tr, va, te = (lab[lab["split"] == s] for s in ("train", "validation", "test"))
        val_scores, val_resid = {}, {}
        for kind in ("random_forest", "xgboost"):
            m = make_model(kind).fit(tr[cols], tr["target_d"])
            pred = m.predict(va[cols])
            val_scores[kind] = rmse(va["target_d"].to_numpy(), pred)
            val_resid[kind] = va["target_d"].to_numpy() - pred
        best = min(val_scores, key=val_scores.get)
        resid = pd.DataFrame({"m": va["target_month"].to_numpy(), "r": val_resid[best]})
        q = {int(m): [float(np.quantile(g["r"], 0.05)), float(np.quantile(g["r"], 0.95))]
             for m, g in resid.groupby("m")}

        trval = pd.concat([tr, va])
        m_eval = make_model(best).fit(trval[cols], trval["target_d"])
        other = "xgboost" if best == "random_forest" else "random_forest"
        m_other = make_model(other).fit(trval[cols], trval["target_d"])
        out = te[["division", "year", "month", "target_year", "target_month", "target_d",
                  "clim_d_target", "clim_sd_target", "d_lag0"]].copy()
        out["horizon"] = h
        out[f"pred_{best}"] = m_eval.predict(te[cols])
        out[f"pred_{other}"] = m_other.predict(te[cols])
        out["pred_climatology"] = te["clim_d_target"]
        out["pred_persistence"] = te["d_lag0"]
        out["selected"] = best
        out["low"] = out[f"pred_{best}"] + out["target_month"].map(lambda m: q[int(m)][0])
        out["high"] = out[f"pred_{best}"] + out["target_month"].map(lambda m: q[int(m)][1])
        test_rows.append(out)

        m_final = make_model(best).fit(lab[cols], lab["target_d"])
        path = ARTIFACTS / f"model_h{h}.joblib"
        joblib.dump(m_final, path, compress=3)
        meta["horizons"][str(h)] = {
            "selected": best, "validationRmse": {k: round(v, 3) for k, v in val_scores.items()},
            "intervalResidualQuantiles": {str(m): [round(v[0], 3), round(v[1], 3)] for m, v in q.items()},
            "intervalMethod": "5th-95th percentile of validation residuals per target month (90% interval)",
            "modelFile": path.name, "trainSamples": int(len(tr)), "validationSamples": int(len(va)),
            "testSamples": int(len(te)), "finalFitSamples": int(len(lab)),
        }
        print(f"h={h}: val RMSE {val_scores} -> {best}")
    pd.concat(test_rows).to_csv(ARTIFACTS / "test_predictions.csv", index=False)
    write_json(ARTIFACTS / "model_meta.json", meta)


if __name__ == "__main__":
    main()
