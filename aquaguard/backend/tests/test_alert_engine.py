"""P3: alert rules engine — rule config, thresholds, one open alert per rule and location, resolve, unavailable
inputs, prediction labelling and the post-sync hook. Uses a small migrated DB; weather rows are test inputs only."""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import connection, migrate
from app.services import alert_engine, store
from app.services import ml_artifacts as mla

NOW = datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = tmp_path / "alerts.db"
    migrate.migrate(path, backup=False)
    conn = connection.connect(path)
    conn.execute("INSERT INTO locations (id, name, level, lat, lon, point_kind, is_weather_point, is_selectable, "
                 "area_km2) VALUES ('bd', 'Bangladesh', 'country', 23.7, 90.3, 'geometry_centroid', 0, 1, 147570)")
    conn.execute("INSERT INTO locations (id, name, level, parent_id, lat, lon, point_kind, is_weather_point, "
                 "is_selectable, area_km2) VALUES ('dhaka', 'Dhaka', 'division', 'bd', 23.81, 90.41, "
                 "'representative_point', 1, 1, 20973)")
    conn.close()
    # model and GRACE artifacts are not part of these tests unless a test sets them
    monkeypatch.setattr(mla, "baseline_forecast", lambda d, h: None)
    monkeypatch.setattr(mla, "grace_trend", lambda: None)
    return path


def forecast_rain(conn, mm_by_day: dict[str, float]):
    for d, mm in mm_by_day.items():
        for var, v in (("precipitation_sum", mm), ("et0_fao_evapotranspiration", 3.0)):
            conn.execute("INSERT OR REPLACE INTO weather_values (location_id, variable, data_kind, time_step, valid_time, "
                         "value, unit, source_id, retrieved_at) VALUES ('dhaka', ?, 'forecast', 'daily', ?, ?, 'mm', "
                         "'openmeteo_forecast', 'x')", (var, d, v))


def week(start: date, mm: list[float]) -> dict[str, float]:
    return {(start + timedelta(days=i)).isoformat(): v for i, v in enumerate(mm)}


def open_alerts(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT rule_id, location_id, severity, value, data_kind FROM alerts WHERE resolved_at IS NULL "
                         "ORDER BY rule_id").fetchall()
    finally:
        c.close()


def test_rule_config_is_complete_and_valid():
    rules = alert_engine.rules()
    assert len({r["id"] for r in rules}) == len(rules)
    for r in rules:
        assert r["indicator"] in alert_engine.INDICATORS and r["scope"] in ("national", "divisions")
        assert r["threshold_source"] and isinstance(r["assumption"], bool) and r["levels"]
        assert r["basis"] in ("statistic", "derived", "forecast", "prediction", "satellite_monthly", "reanalysis")


def test_threshold_classes():
    assert store.sdg_class(25.0) == ("No stress", 0) and store.sdg_class(25.01) == ("Low", 1)
    assert store.sdg_class(50) == ("Low", 1) and store.sdg_class(75) == ("Medium", 2)
    assert store.sdg_class(100) == ("High", 3) and store.sdg_class(100.5) == ("Critical", 4)
    assert store.spi_class(-0.99)[0] == "Near normal" and store.spi_class(-1.0)[0] == "Moderately dry"
    assert store.spi_class(-1.5)[0] == "Severely dry" and store.spi_class(-2.0)[0] == "Extremely dry"


def test_one_open_alert_per_rule_and_location_update_and_resolve(db):
    conn = connection.connect(db)
    today = store.dhaka_now(NOW).date()
    forecast_rain(conn, week(today, [0, 50, 0, 0, 0, 0, 0]))  # heavy rain (44-88 mm) on day 2
    assert alert_engine.evaluate(conn, NOW)["opened"] == 1
    assert open_alerts(db) == [("heavy_rain_forecast", "dhaka", "medium", 50.0, "forecast")]
    assert alert_engine.evaluate(conn, NOW)["opened"] == 0  # idempotent: still one open alert

    forecast_rain(conn, week(today, [0, 120, 0, 0, 0, 0, 0]))  # newer forecast: very heavy
    counts = alert_engine.evaluate(conn, NOW)
    assert counts["updated"] == 1 and open_alerts(db) == [("heavy_rain_forecast", "dhaka", "high", 120.0, "forecast")]

    forecast_rain(conn, week(today, [0, 10, 0, 0, 0, 0, 0]))  # condition no longer met
    assert alert_engine.evaluate(conn, NOW)["resolved"] == 1 and open_alerts(db) == []
    n = conn.execute("SELECT COUNT(*) FROM alerts WHERE rule_id = 'heavy_rain_forecast'").fetchone()[0]
    assert n == 1  # resolved row kept as history

    forecast_rain(conn, week(today, [0, 60, 0, 0, 0, 0, 0]))  # fires again -> a new open alert
    alert_engine.evaluate(conn, NOW)
    assert conn.execute("SELECT COUNT(*) FROM alerts WHERE rule_id = 'heavy_rain_forecast'").fetchone()[0] == 2
    with pytest.raises(sqlite3.IntegrityError):  # the unique partial index forbids a second open alert
        conn.execute("INSERT INTO alerts (rule_id, location_id, severity, indicator, data_kind, message, created_at) "
                     "VALUES ('heavy_rain_forecast', 'dhaka', 'low', 'x', 'forecast', 'm', 't')")
    conn.close()


def test_unavailable_input_leaves_alert_untouched(db):
    conn = connection.connect(db)
    today = store.dhaka_now(NOW).date()
    forecast_rain(conn, week(today, [0, 100, 0, 0, 0, 0, 0]))
    alert_engine.evaluate(conn, NOW)
    conn.execute("DELETE FROM weather_values")  # the forecast disappears (e.g. failed sync window)
    counts = alert_engine.evaluate(conn, NOW)
    assert counts["resolved"] == 0 and len(open_alerts(db)) == 1  # never resolved without data
    conn.close()


def test_prediction_alerts_are_labelled(db, monkeypatch):
    monkeypatch.setattr(mla, "baseline_forecast", lambda d, h: {"z": -1.4, "targetMonth": "2026-12", "value": -80.0})
    conn = connection.connect(db)
    alert_engine.evaluate(conn, NOW)
    rows = alert_engine.list_alerts(conn, "dhaka", None, False, None)
    conn.close()
    pred = [a for a in rows if a["ruleId"] == "forecast_dryness_1m"]
    assert pred and pred[0]["isPrediction"] and pred[0]["dataKind"] == "prediction"
    assert "Prediction, not an observation" in pred[0]["message"]


def test_storage_decline_needs_ci_below_zero(db, monkeypatch):
    conn = connection.connect(db)
    monkeypatch.setattr(mla, "grace_trend", lambda: {"trendCmPerYr": -0.6, "trendCi95": [-1.2, 0.1],
                                                     "period": {"to": "2026-09-15"}})
    alert_engine.evaluate(conn, NOW)
    assert open_alerts(db) == []  # CI includes 0: no alert
    monkeypatch.setattr(mla, "grace_trend", lambda: {"trendCmPerYr": -0.6, "trendCi95": [-0.8, -0.4],
                                                     "period": {"to": "2026-09-15"}})
    alert_engine.evaluate(conn, NOW)
    conn.close()
    assert open_alerts(db) == [("storage_decline", "bd", "low", -0.6, "satellite_monthly")]


def test_alerts_are_evaluated_after_each_sync_job(db, monkeypatch):
    from app.settings import get_settings
    from app.sync import jobs
    from app.sync.runs import RunStats

    seen = []
    monkeypatch.setattr(alert_engine, "evaluate", lambda conn, now=None: seen.append(now) or {})
    monkeypatch.setitem(jobs.JOBS, "forecast", jobs.Job("forecast", "openmeteo_forecast",
                                                        lambda c, h, s, now=None: RunStats(ok=1), lambda s: 60, 60))
    s = get_settings().model_copy(update={"db_path": db, "offline": False})
    r = jobs.run_job("forecast", settings=s, client=object(), now=NOW)
    assert r.status == "success" and seen == [NOW]
