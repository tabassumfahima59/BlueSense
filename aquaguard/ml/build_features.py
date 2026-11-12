"""Build the modelling tables for horizons 1, 3, 6 and record the time split.

    python ml/build_features.py

Split by TARGET date (never random):
  train       target year <= 2016
  validation  2017-2020
  test        2021 .. latest complete month
Feature climatology (clim_d_target, anomalies) is computed from training years only.
"""
from __future__ import annotations

import pandas as pd

from common import ARTIFACTS, PROCESSED, write_json
from features import feature_columns, make_features, train_climatology

HORIZONS = (1, 3, 6)
TRAIN_END, VAL_END = 2016, 2020


def split_label(target_year: int) -> str:
    if target_year <= TRAIN_END:
        return "train"
    if target_year <= VAL_END:
        return "validation"
    return "test"


def main() -> None:
    monthly = pd.read_csv(PROCESSED / "weather_monthly.csv")
    clim = train_climatology(monthly, TRAIN_END)
    clim.to_csv(ARTIFACTS / "train_climatology.csv", index=False)
    summary = {}
    for h in HORIZONS:
        df = make_features(monthly, clim, h)
        df["split"] = df["target_year"].map(split_label)
        df.to_csv(ARTIFACTS / f"features_h{h}.csv", index=False)
        labelled = df.dropna(subset=["target_d"])
        summary[str(h)] = {s: int((labelled["split"] == s).sum()) for s in ("train", "validation", "test")}
        summary[str(h)]["unlabelledLatest"] = int(df["target_d"].isna().sum())
    write_json(ARTIFACTS / "split.json", {
        "rule": f"train: target year <= {TRAIN_END}; validation: {TRAIN_END + 1}-{VAL_END}; test: {VAL_END + 1}+",
        "features": feature_columns(), "counts": summary,
        "dataPeriod": f"{int(monthly['year'].min())}-{int(monthly['month'].iloc[0]):02d} to "
                      f"{int(monthly['year'].max())}-{int(monthly[monthly['year'] == monthly['year'].max()]['month'].max()):02d}",
    })
    print(summary)


if __name__ == "__main__":
    main()
