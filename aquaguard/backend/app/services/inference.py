"""M5 event-driven inference: re-run the stored models (never trains) on the latest complete months in
``weather_monthly`` and store each prediction in ``predictions_v2`` together with the exact feature values used
(``input_snapshot``).

Runs after a successful weather-archive sync (``app.sync.jobs``) and on demand (``python -m app.sync.run predict``).
Retraining is a separate, manual step in ``ml/`` (train_scarcity.py -> evaluate.py -> predict.py).

Idempotent: one row per (model, model_version, division, target, horizon, issued month); a repeated run for the same
month inserts nothing and never overwrites a stored prediction.
"""
from __future__ import annotations

import json
import logging
import math
import sqlite3
from datetime import UTC, datetime

import pandas as pd

from ..engine import risk
from . import ml_artifacts as mla

log = logging.getLogger("aquaguard.inference")

TARGET = "water_balance_d"  # D = P - ET0 (mm/month)
UNIT = "mm"
INTERVAL_LEVEL = 0.9
SOURCE_NOTE = "weather_monthly: ERA5 reanalysis via the Open-Meteo archive (complete months only)"


def _now_iso(now: datetime | None) -> str:
    return (now or datetime.now(UTC)).astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _monthly(conn: sqlite3.Connection) -> pd.DataFrame:
    return pd.read_sql_query(
        "SELECT division, year, month, precip_mm, et0_mm, d_mm, tmean_c, soil_moisture_m3m3 FROM weather_monthly "
        "ORDER BY division, year, month", conn)


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def run(conn: sqlite3.Connection, *, now: datetime | None = None) -> dict:
    """Issue predictions from the newest complete month of every division for every horizon."""
    meta = mla.model_meta()
    clim = mla._train_clim()
    if not meta or clim is None:
        return {"status": "not_configured", "inserted": 0, "skipped": 0, "errors": ["model artifacts are missing"]}
    version = meta["trainedAt"]
    f = mla._features_module()
    cols = f.feature_columns()
    monthly = _monthly(conn)
    if monthly.empty:
        return {"status": "unavailable", "inserted": 0, "skipped": 0, "errors": ["weather_monthly is empty"]}
    newest = {d: (int(g["year"].iloc[-1]), int(g["month"].iloc[-1])) for d, g in monthly.groupby("division")}
    generated = _now_iso(now)
    rows, errors, issued = [], [], set()
    for h in mla.HORIZONS:
        model = mla._model(h)
        hm = meta["horizons"][str(h)]
        if model is None:
            errors.append(f"h{h}: model file {hm['modelFile']} is missing")
            continue
        feats = f.make_features(monthly, clim, h)
        latest = feats.sort_values(["year", "month"]).groupby("division").tail(1)
        for _, row in latest.iterrows():
            div = row["division"]
            ym = (int(row["year"]), int(row["month"]))
            if ym != newest.get(div):
                # never issue from an older month: the newest month lacks a feature (e.g. a missing variable)
                errors.append(f"{div} h{h}: features incomplete for {newest[div][0]:04d}-{newest[div][1]:02d}")
                continue
            x = row[cols].to_frame().T.astype(float)
            p = float(model.predict(x)[0])
            tm = int(row["target_month"])
            q_lo, q_hi = hm["intervalResidualQuantiles"][str(tm)]
            mean, sd = float(row["clim_d_target"]), float(row["clim_sd_target"])
            z = (p - mean) / sd if sd > 0 else None
            issued_period = f"{ym[0]:04d}-{ym[1]:02d}"
            issued.add(issued_period)
            snapshot = {
                "features": {c: _num(row[c]) for c in cols},
                "issuedFrom": issued_period,
                "source": SOURCE_NOTE,
                "featureCode": "ml/features.py (shared with training)",
                "targetMonthClimatology": {"meanMm": round(mean, 3), "sdMm": round(sd, 3), "period": "training years"},
                "intervalResidualQuantiles": [q_lo, q_hi],
                "intervalMethod": hm.get("intervalMethod"),
                "z": None if z is None else round(z, 4),
                "drynessClass": risk.dryness_label(z),
            }
            rows.append((hm["selected"], version, TARGET, div, h, "month", issued_period,
                         f"{int(row['target_year']):04d}-{tm:02d}", round(p, 3), UNIT, round(p + q_lo, 3),
                         round(p + q_hi, 3), INTERVAL_LEVEL, "prediction", generated,
                         json.dumps(snapshot, separators=(",", ":"), sort_keys=True), "aquaguard_ml"))
    inserted = 0
    if rows:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for r in rows:
                cur = conn.execute(
                    "INSERT INTO predictions_v2 (model, model_version, target, location_id, horizon, horizon_unit, "
                    "issued_period, target_period, value, unit, lower, upper, interval_level, data_kind, generated_at, "
                    "input_snapshot, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT (model, model_version, location_id, target, horizon, issued_period) DO NOTHING", r)
                inserted += cur.rowcount
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    mla.clear_stored()
    status = "success" if rows and not errors else "partial" if rows else "failed"
    out = {"status": status, "modelVersion": version, "issued": sorted(issued), "inserted": inserted,
           "skipped": len(rows) - inserted, "errors": errors[:10]}
    log.info("inference: %s (inserted %d, skipped %d, errors %d)", status, inserted, len(rows) - inserted, len(errors))
    return out


def stored(conn: sqlite3.Connection, model_version: str | None = None) -> dict[str, dict[int, dict]]:
    """Latest stored prediction per division and horizon for the current model version, in the artifact's shape."""
    meta = mla.model_meta()
    version = model_version or (meta or {}).get("trainedAt")
    if not version:
        return {}
    try:
        cur = conn.execute(
            "SELECT id, location_id, horizon, issued_period, target_period, value, lower, upper, generated_at, "
            "input_snapshot, model FROM predictions_v2 p WHERE target = ? AND model_version = ? "
            "AND data_kind = 'prediction' AND issued_period = (SELECT MAX(issued_period) FROM predictions_v2 q "
            "WHERE q.location_id = p.location_id AND q.horizon = p.horizon AND q.target = p.target "
            "AND q.model_version = p.model_version AND q.data_kind = 'prediction')", (TARGET, version))
    except sqlite3.OperationalError:  # database before migration 0006
        return {}
    out: dict[str, dict[int, dict]] = {}
    for pid, loc, h, issued, target, value, lo, hi, gen, snap, model in cur.fetchall():
        s = json.loads(snap)
        clim = s.get("targetMonthClimatology") or {}
        out.setdefault(loc, {})[int(h)] = {
            "issuedMonth": issued, "targetMonth": target, "value": round(value, 2), "low": round(lo, 2),
            "high": round(hi, 2), "model": model, "climMean": round(clim.get("meanMm"), 2),
            "climSd": round(clim.get("sdMm"), 2), "z": s.get("z"), "drynessClass": s.get("drynessClass"),
            "generatedAt": gen, "storage": "database", "predictionId": pid, "inputs": s}
    return out
