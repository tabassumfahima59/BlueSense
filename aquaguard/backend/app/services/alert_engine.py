"""Alert rules engine (P3): evaluates ``config/alert_rules.yaml`` and keeps one open alert per rule and location.

* firing rule      -> open a new alert, or update the open one when severity, value or observation date changed
* rule not firing  -> resolve the open alert (``resolved_at``)
* input unavailable-> leave the alert untouched (never resolved or opened without data)
Runs after every sync job (``app.sync.jobs``) and from the CLI (``python -m app.sync.run alerts``).
Indicators are computed with SQL on the given connection (``services.store``) plus the ML / GRACE trend artifacts.
"""
from __future__ import annotations

import logging
import operator
import sqlite3
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import yaml

from ..sync.runs import iso, utcnow
from . import ml_artifacts as mla
from . import store

log = logging.getLogger("aquaguard.alerts")
RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "alert_rules.yaml"
OPS = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le}
SEVERITIES = ("info", "low", "medium", "high", "critical")


@lru_cache
def rules() -> list[dict]:
    doc = yaml.safe_load(RULES_PATH.read_text(encoding="utf-8"))
    out = doc["rules"]
    for r in out:
        for lv in r["levels"]:
            if lv["op"] not in OPS or lv["severity"] not in SEVERITIES:
                raise ValueError(f"invalid level in alert rule {r['id']}")
    return out


def rule(rule_id: str) -> dict | None:
    return next((r for r in rules() if r["id"] == rule_id), None)


def level_label(rule_id: str, severity: str) -> str | None:
    r = rule(rule_id)
    return next((lv["label"] for lv in r["levels"] if lv["severity"] == severity), None) if r else None


# ---------------------------------------------------------------- indicators: (conn, location, rule) -> dict | None

def _sdg(conn, loc, r, now):
    s = store.stat(conn, 4550)
    if not s:
        return None
    return {"value": s["value"], "observed": str(s["year"])}


def _rain_anomaly(conn, loc, r, now):
    w = store.rain_30d(conn, loc)
    if not w or w["normal"] is None or w["anomalyPct"] is None or w["normal"] < r.get("min_normal_mm", 0):
        return None
    return {"value": w["anomalyPct"], "observed": w["end"], "start": w["start"], "end": w["end"],
            "total": w["total"], "normal": w["normal"]}


def _heavy_rain(conn, loc, r, now):
    f = store.forecast_window(conn, loc, 7, now)
    if not f:
        return None
    return {"value": f["maxDayMm"], "observed": f["maxDay"], "max_day": f["maxDay"]}


def _dryness_3m(conn, loc, r, now):
    d = store.water_balance_3m_z(conn, loc)
    if not d:
        return None
    return {"value": d["z"], "observed": d["end"], "window": d["window"], "total": d["value"]}


def _predicted_dryness(conn, loc, r, now):
    f = mla.baseline_forecast(loc, 1)
    if not f or f.get("z") is None:
        return None
    return {"value": f["z"], "observed": f["targetMonth"], "target": f["targetMonth"], "total": f["value"]}


def _grace_trend(conn, loc, r, now):
    g = mla.grace_trend()
    if not g:
        return None
    lo, hi = g["trendCi95"]
    return {"value": g["trendCmPerYr"], "observed": g["period"]["to"][:7], "low": lo, "high": hi}


INDICATORS = {
    "sdg642_water_stress_pct": _sdg,
    "rain_30d_anomaly_pct": _rain_anomaly,
    "forecast_max_daily_rain_mm": _heavy_rain,
    "water_balance_3m_z": _dryness_3m,
    "predicted_water_balance_z": _predicted_dryness,
    "grace_tws_trend_cm_yr": _grace_trend,
}


def _locations(conn, scope: str) -> list[str]:
    if scope == "national":
        return [r[0] for r in conn.execute("SELECT id FROM locations WHERE level = 'country'")]
    return [r[0] for r in conn.execute("SELECT id FROM locations WHERE level = 'division' ORDER BY id")]


def _match(r: dict, ind: dict) -> dict | None:
    for lv in r["levels"]:
        if OPS[lv["op"]](ind["value"], lv["threshold"]):
            if lv.get("require_ci_below_zero") and not (ind.get("high") is not None and ind["high"] < 0):
                continue
            return lv
    return None


def list_alerts(conn: sqlite3.Connection, region_id: str, severities: list[str] | None, include_resolved: bool,
                client_id: str | None) -> list[dict]:
    """Stored alerts for a region: 'bd' -> every location; a division -> the division and national alerts."""
    where, params = [], []
    if region_id != "bd":
        where.append("a.location_id IN (?, 'bd')")
        params.append(region_id)
    if severities:
        where.append(f"a.severity IN ({','.join('?' for _ in severities)})")
        params += severities
    if not include_resolved:
        where.append("a.resolved_at IS NULL")
    sql = ("SELECT a.id, a.rule_id, a.location_id, l.name, a.severity, a.indicator, a.value, a.threshold, a.unit, "
           "a.basis, a.data_kind, a.source_id, a.message, a.observed_at, a.created_at, a.updated_at, a.resolved_at, "
           "EXISTS (SELECT 1 FROM alert_reads r WHERE r.alert_id = a.id AND r.client_id = ?) "
           "FROM alerts a JOIN locations l ON l.id = a.location_id"
           + (" WHERE " + " AND ".join(where) if where else ""))
    order = {s: i for i, s in enumerate(reversed(SEVERITIES))}
    out = []
    for row in conn.execute(sql, [client_id or "", *params]):
        r = rule(row[1]) or {}
        out.append({"id": row[0], "ruleId": row[1], "regionId": row[2], "regionName": row[3], "severity": row[4],
                    "title": r.get("title", row[1]), "indicator": row[5], "value": row[6], "threshold": row[7],
                    "unit": row[8], "basis": level_label(row[1], row[4]) or row[9], "dataKind": row[10],
                    "isPrediction": row[10] == "prediction", "sourceId": row[11],
                    "thresholdSource": r.get("threshold_source"), "message": row[12], "observedAt": row[13],
                    "createdAt": row[14], "updatedAt": row[15], "resolvedAt": row[16], "read": bool(row[17])})
    out.sort(key=lambda a: (order[a["severity"]], a["resolvedAt"] is not None, a["regionName"]))
    return out


def evaluate(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, int]:
    """Evaluate every rule for every location in its scope (one transaction). Returns counts."""
    now_s = iso(now or utcnow())
    counts = {"opened": 0, "updated": 0, "resolved": 0, "unchanged": 0, "unavailable": 0}
    computed = []
    for r in rules():
        fn = INDICATORS[r["indicator"]]
        for loc in _locations(conn, r["scope"]):
            try:
                ind = fn(conn, loc, r, now)
            except (sqlite3.Error, ValueError, KeyError, TypeError, ZeroDivisionError) as exc:
                log.warning("alert rule %s for %s could not be evaluated: %s", r["id"], loc, type(exc).__name__)
                ind = None
            computed.append((r, loc, ind))
    conn.execute("BEGIN IMMEDIATE")
    try:
        for r, loc, ind in computed:
            if ind is None or ind.get("value") is None:
                counts["unavailable"] += 1
                continue
            lv = _match(r, ind)
            row = conn.execute("SELECT id, severity, value, observed_at FROM alerts WHERE rule_id = ? AND location_id = ? "
                               "AND resolved_at IS NULL", (r["id"], loc)).fetchone()
            if lv is None:
                if row:
                    conn.execute("UPDATE alerts SET resolved_at = ?, updated_at = ? WHERE id = ?", (now_s, now_s, row[0]))
                    counts["resolved"] += 1
                else:
                    counts["unchanged"] += 1
                continue
            message = r["message"].format(label=lv["label"], **ind)
            value = round(float(ind["value"]), 4)
            if row is None:
                conn.execute(
                    "INSERT INTO alerts (rule_id, location_id, severity, indicator, value, threshold, unit, basis, "
                    "data_kind, source_id, message, observed_at, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (r["id"], loc, lv["severity"], r["indicator"], value, lv["threshold"], r["unit"], r["basis"],
                     r["basis"], r["source_id"], message, ind["observed"], now_s, now_s))
                counts["opened"] += 1
            elif (row[1], row[2], row[3]) != (lv["severity"], value, ind["observed"]):
                conn.execute("UPDATE alerts SET severity = ?, value = ?, threshold = ?, message = ?, "
                             "observed_at = ?, updated_at = ? WHERE id = ?",
                             (lv["severity"], value, lv["threshold"], message, ind["observed"], now_s, row[0]))
                counts["updated"] += 1
            else:
                counts["unchanged"] += 1
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return counts
