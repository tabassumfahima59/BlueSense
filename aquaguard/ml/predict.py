"""Issue the latest forecasts with the operational models and write ml/artifacts/predictions.json.

    python ml/predict.py      (after train_scarcity.py and evaluate.py)
"""
from __future__ import annotations

import json

import joblib
import pandas as pd

from common import ARTIFACTS, PROCESSED, now_iso, write_json
from evaluate import dryness
from features import feature_columns, make_features

HORIZONS = (1, 3, 6)


def main() -> None:
    monthly = pd.read_csv(PROCESSED / "weather_monthly.csv")
    clim = pd.read_csv(ARTIFACTS / "train_climatology.csv")
    meta = json.loads((ARTIFACTS / "model_meta.json").read_text(encoding="utf-8"))
    tests = pd.read_csv(ARTIFACTS / "test_predictions.csv")
    cols = feature_columns()
    forecasts: dict = {}
    test_series: dict = {}
    for h in HORIZONS:
        model = joblib.load(ARTIFACTS / meta["horizons"][str(h)]["modelFile"])
        qmap = meta["horizons"][str(h)]["intervalResidualQuantiles"]
        feats = make_features(monthly, clim, h)
        latest = feats.sort_values(["year", "month"]).groupby("division").tail(1)
        preds = model.predict(latest[cols])
        for (_, row), p in zip(latest.iterrows(), preds):
            z = (p - row["clim_d_target"]) / row["clim_sd_target"]
            q_lo, q_hi = qmap[str(int(row["target_month"]))]
            forecasts.setdefault(row["division"], {})[str(h)] = {
                "issuedMonth": f"{int(row['year'])}-{int(row['month']):02d}",
                "targetMonth": f"{int(row['target_year'])}-{int(row['target_month']):02d}",
                "value": round(float(p), 2), "low": round(float(p + q_lo), 2), "high": round(float(p + q_hi), 2),
                "model": meta["horizons"][str(h)]["selected"],
                "climMean": round(float(row["clim_d_target"]), 2), "climSd": round(float(row["clim_sd_target"]), 2),
                "z": round(float(z), 3), "drynessClass": str(dryness(pd.Series([z]).to_numpy())[0]),
            }
        sel = meta["horizons"][str(h)]["selected"]
        for div, g in tests[tests["horizon"] == h].groupby("division"):
            g = g.sort_values(["target_year", "target_month"])
            test_series.setdefault(div, {})[str(h)] = [
                {"t": f"{int(r.target_year)}-{int(r.target_month):02d}", "actual": round(float(r.target_d), 2),
                 "predicted": round(float(getattr(r, f"pred_{sel}")), 2), "low": round(float(r.low), 2),
                 "high": round(float(r.high), 2)} for r in g.itertuples()]
    history = {}
    for div, g in monthly.groupby("division"):
        g = g.sort_values(["year", "month"]).tail(72)
        history[div] = [{"t": f"{int(r.year)}-{int(r.month):02d}", "d": round(float(r.d_mm), 2),
                         "p": round(float(r.precip_mm), 2), "et0": round(float(r.et0_mm), 2)} for r in g.itertuples()]
    last = monthly.sort_values(["year", "month"]).iloc[-1]
    write_json(ARTIFACTS / "predictions.json", {
        "generatedAt": now_iso(), "trainedAt": meta["trainedAt"],
        "dataPeriod": f"{int(monthly['year'].min())}-01 to {int(last.year)}-{int(last.month):02d}",
        "target": "D = P - ET0 (mm/month)", "forecasts": forecasts, "history": history, "testSeries": test_series,
    })
    print(f"forecasts for {len(forecasts)} divisions, issued {last.year}-{last.month:02d}")


if __name__ == "__main__":
    main()
