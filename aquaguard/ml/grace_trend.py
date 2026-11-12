"""GRACE/GRACE-FO terrestrial water storage (TWS) anomaly over Bangladesh.

Input : data/raw/grace/CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc (CSR RL06.3 mascons)
Output: data/processed/storage_anomaly.csv   date, year, month, tws_cm (area-weighted mean over Bangladesh)
        ml/artifacts/grace_trend.json         seasonal cycle, deseasonalised series, OLS trend (cm/yr) with
                                              95% CI, and an optional 12-month projection (Predicted)

Method: grid cells (0.25°) whose centres fall inside the geoBoundaries ADM0 polygon are averaged with
cos(latitude) weights. The seasonal cycle is the mean anomaly of each calendar month; the trend is an OLS
fit y = a + b·t + annual + semi-annual harmonics. The CI ignores residual autocorrelation (stated as a
limitation). GRACE resolves ~300 km: this is a REGIONAL storage trend, not well depth or water level.

If the input file is missing the script exits without writing anything; the platform then shows an
empty state with download instructions.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

from common import ARTIFACTS, PROCESSED, RAW, now_iso, record_retrieval, write_json

NC = RAW / "grace" / "CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc"
ADM0 = RAW / "geo" / "geoBoundaries-BGD-ADM0_simplified.geojson"


def _in_ring(x: float, y: float, ring) -> bool:
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def bangladesh_mask(lats: np.ndarray, lons: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    gj = json.loads(ADM0.read_text(encoding="utf-8"))
    geom = gj["features"][0]["geometry"]
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    li = np.where((lats > 20) & (lats < 27))[0]
    lo = np.where((lons > 87.5) & (lons < 93))[0]
    cells = []
    for i in li:
        for j in lo:
            if any(_in_ring(float(lons[j]), float(lats[i]), p[0]) for p in polys):
                cells.append((i, j))
    return np.array(cells), li


def extract() -> pd.DataFrame:
    import h5py

    with h5py.File(NC, "r") as f:
        lats = f["lat"][:]
        lons = f["lon"][:]
        times = f["time"][:]
        cells, _ = bangladesh_mask(lats, lons)
        if len(cells) == 0:
            raise RuntimeError("no GRACE cells inside Bangladesh polygon")
        i0, i1 = cells[:, 0].min(), cells[:, 0].max() + 1
        j0, j1 = cells[:, 1].min(), cells[:, 1].max() + 1
        block = f["lwe_thickness"][:, i0:i1, j0:j1]  # (time, lat, lon) in cm
    w = np.cos(np.radians(lats[cells[:, 0]]))
    vals = block[:, cells[:, 0] - i0, cells[:, 1] - j0]
    series = (vals * w).sum(axis=1) / w.sum()
    epoch = date(2002, 1, 1)
    dates = [epoch + timedelta(days=float(t)) for t in times]
    df = pd.DataFrame({"year": [d.year for d in dates], "month": [d.month for d in dates], "tws_cm": series})
    df = df.groupby(["year", "month"], as_index=False)["tws_cm"].mean()  # one value per calendar month
    df["date"] = [f"{y}-{m:02d}-15" for y, m in zip(df["year"], df["month"])]
    print(f"GRACE: {len(cells)} grid cells, {len(df)} months {df['date'].iloc[0]}..{df['date'].iloc[-1]}")
    return df[["date", "year", "month", "tws_cm"]].round(4)


def trend(df: pd.DataFrame) -> dict:
    t = (df["year"] + (df["month"] - 0.5) / 12.0).to_numpy()
    y = df["tws_cm"].to_numpy()
    t0 = t.mean()
    tc = t - t0
    X = np.column_stack([np.ones_like(tc), tc, np.sin(2 * math.pi * t), np.cos(2 * math.pi * t),
                         np.sin(4 * math.pi * t), np.cos(4 * math.pi * t)])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    n, k = X.shape
    sigma2 = float(resid @ resid) / (n - k)
    cov = sigma2 * np.linalg.inv(X.T @ X)
    se_b = math.sqrt(cov[1, 1])
    from scipy import stats

    tcrit = float(stats.t.ppf(0.975, n - k))
    clim = df.groupby("month")["tws_cm"].mean()
    deseason = df["tws_cm"] - df["month"].map(clim) + clim.mean()

    # Optional 12-month projection (Predicted, wide interval): trend + harmonics, 95% prediction interval.
    last_y, last_m = int(df["year"].iloc[-1]), int(df["month"].iloc[-1])
    proj = []
    for h in range(1, 13):
        m = (last_m - 1 + h) % 12 + 1
        yy = last_y + (last_m - 1 + h) // 12
        tt = yy + (m - 0.5) / 12.0
        x = np.array([1, tt - t0, math.sin(2 * math.pi * tt), math.cos(2 * math.pi * tt),
                      math.sin(4 * math.pi * tt), math.cos(4 * math.pi * tt)])
        mean = float(x @ beta)
        se_pred = math.sqrt(sigma2 + float(x @ cov @ x))
        proj.append({"date": f"{yy}-{m:02d}-15", "value": round(mean, 3),
                     "low": round(mean - tcrit * se_pred, 3), "high": round(mean + tcrit * se_pred, 3)})
    return {
        "source_id": "grace_csr",
        "generatedAt": now_iso(),
        "period": {"from": df["date"].iloc[0], "to": df["date"].iloc[-1], "months": int(n)},
        "unit": "cm equivalent water height",
        "trendCmPerYr": round(float(beta[1]), 4),
        "trendCi95": [round(float(beta[1] - tcrit * se_b), 4), round(float(beta[1] + tcrit * se_b), 4)],
        "method": "OLS on monthly anomaly with annual + semi-annual harmonics; 95% CI from OLS standard error "
                  "(residual autocorrelation not accounted for, so the CI is likely too narrow).",
        "seasonalCycleCm": {str(int(m)): round(float(v), 3) for m, v in clim.items()},
        "deseasonalised": [{"date": d, "value": round(float(v), 3)} for d, v in zip(df["date"], deseason)],
        "projection": proj,
        "note": "Regional storage trend, roughly 300 km resolution; not well depth.",
    }


def main() -> int:
    if not NC.exists():
        print(f"GRACE file not found at {NC}. Download it from "
              "https://download.csr.utexas.edu/outgoing/grace/RL0603_mascons/ and re-run.")
        return 0
    df = extract()
    df.to_csv(PROCESSED / "storage_anomaly.csv", index=False)
    record_retrieval("grace_csr", {"file": NC.name, "months": len(df)})
    out = trend(df)
    write_json(ARTIFACTS / "grace_trend.json", out)
    print(f"trend {out['trendCmPerYr']} cm/yr, 95% CI {out['trendCi95']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
