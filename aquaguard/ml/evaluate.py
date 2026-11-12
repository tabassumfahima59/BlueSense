"""Evaluate on the held-out TEST period and write ml/artifacts/metrics.json.

    python ml/evaluate.py      (after train_scarcity.py)

Regression (D, mm/month): MAE, RMSE, R² for climatology, persistence, Random Forest, XGBoost.
Risk classes: z = (D - mean_train(month)) / sd_train(month) mapped to SPI/SPEI dryness classes; the
confusion matrix and macro-F1 compare the class of the predicted D with the class of the actual D.
Interval coverage: share of test targets inside the 90% interval.
Every number in metrics.json is computed here — the UI shows nothing else.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, f1_score, mean_absolute_error, mean_squared_error, r2_score

from common import ARTIFACTS, now_iso, write_json

CLASSES = ["Extremely dry", "Severely dry", "Moderately dry", "Near normal or wet"]
MODELS = ("climatology", "persistence", "random_forest", "xgboost")


def dryness(z: np.ndarray) -> np.ndarray:
    out = np.full(z.shape, "Near normal or wet", dtype=object)
    out[z <= -1.0] = "Moderately dry"
    out[z <= -1.5] = "Severely dry"
    out[z <= -2.0] = "Extremely dry"
    return out


def regression(y: np.ndarray, p: np.ndarray) -> dict:
    return {"mae": round(float(mean_absolute_error(y, p)), 3),
            "rmse": round(float(np.sqrt(mean_squared_error(y, p))), 3),
            "r2": round(float(r2_score(y, p)), 4)}


def main() -> None:
    df = pd.read_csv(ARTIFACTS / "test_predictions.csv")
    meta = json.loads((ARTIFACTS / "model_meta.json").read_text(encoding="utf-8"))
    out = {"generatedAt": now_iso(), "trainedAt": meta["trainedAt"], "target": "D = P - ET0 (mm/month)",
           "split": json.loads((ARTIFACTS / "split.json").read_text(encoding="utf-8"))["rule"], "horizons": {}}
    for h, g in df.groupby("horizon"):
        y = g["target_d"].to_numpy()
        sel = g["selected"].iloc[0]
        reg = {m: regression(y, g[f"pred_{m}"].to_numpy()) for m in MODELS}
        sd = g["clim_sd_target"].to_numpy()
        mean = g["clim_d_target"].to_numpy()
        actual_cls = dryness((y - mean) / sd)
        pred_cls = dryness((g[f"pred_{sel}"].to_numpy() - mean) / sd)
        clim_cls = dryness(np.zeros_like(y))
        cm = confusion_matrix(actual_cls, pred_cls, labels=CLASSES)
        coverage = float(np.mean((y >= g["low"].to_numpy()) & (y <= g["high"].to_numpy())))
        t0 = g.sort_values(["target_year", "target_month"]).iloc[0]
        t1 = g.sort_values(["target_year", "target_month"]).iloc[-1]
        out["horizons"][str(int(h))] = {
            "selectedModel": sel,
            "testPeriod": f"{int(t0.target_year)}-{int(t0.target_month):02d} to "
                          f"{int(t1.target_year)}-{int(t1.target_month):02d}",
            "samples": int(len(g)),
            "regression": reg,
            "classification": {
                "classes": CLASSES,
                "confusionMatrix": cm.tolist(),
                "confusionAxes": "rows = actual class, columns = predicted class",
                "macroF1": round(float(f1_score(actual_cls, pred_cls, labels=CLASSES, average="macro",
                                                zero_division=0)), 4),
                "macroF1Climatology": round(float(f1_score(actual_cls, clim_cls, labels=CLASSES, average="macro",
                                                           zero_division=0)), 4),
                "actualClassCounts": {c: int((actual_cls == c).sum()) for c in CLASSES},
            },
            "interval": {"nominal": 0.90, "testCoverage": round(coverage, 4),
                         "method": meta["horizons"][str(int(h))]["intervalMethod"]},
            "validationRmse": meta["horizons"][str(int(h))]["validationRmse"],
        }
        print(f"h={h} {sel}: " + ", ".join(f"{m} RMSE {reg[m]['rmse']}" for m in MODELS)
              + f" | macroF1 {out['horizons'][str(int(h))]['classification']['macroF1']} | coverage {coverage:.2f}")
    write_json(ARTIFACTS / "metrics.json", out)


if __name__ == "__main__":
    main()
