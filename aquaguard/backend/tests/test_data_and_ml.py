"""Derived parameters match their datasets; ML artifacts are code-produced; no sample fallback exists."""
import json

import pytest

from app.config.params import assumptions_table, pval
from app.services import data_access as da
from app.services import ml_artifacts as mla
from app.settings import get_settings


def test_every_parameter_has_source_and_unit():
    rows = assumptions_table()
    assert len(rows) > 20
    for r in rows:
        assert r["source"], r["key"]
        assert "unit" in r


def test_derived_parameters_match_aquastat():
    wr, _ = da.water_resources()
    v = lambda k: wr[k]["value"]  # noqa: E731
    assert pval("water_balance", "runoff_coefficient") == pytest.approx(
        v("surface_internal_km3") / v("precip_volume_km3"), abs=1e-4)
    assert pval("water_balance", "environmental_reserve_share") == pytest.approx(
        v("efr_km3") / v("surface_renewable_km3"), abs=1e-4)
    assert pval("water_balance", "irrigation_efficiency") == pytest.approx(
        v("irrigation_requirement_km3") / v("withdrawal_agri_km3"), abs=0.005)
    assert pval("water_balance", "domestic_per_capita_lpcd") == pytest.approx(
        v("municipal_per_capita_m3") * 1000 / 365, abs=0.01)
    assert pval("water_balance", "surface_inflow_mcm") == pytest.approx(v("surface_external_km3") * 1000)
    assert pval("water_balance", "groundwater_renewable_mcm") == pytest.approx(v("groundwater_renewable_km3") * 1000)
    assert pval("water_balance", "industrial_withdrawal_mcm") == pytest.approx(v("withdrawal_industrial_km3") * 1000)


def test_inflow_shape_sums_to_one():
    shape, _ = da.inflow_shape()
    assert len(shape) == 12 and sum(shape.values()) == pytest.approx(1.0, abs=1e-4)


def test_metrics_file_is_code_produced():
    p = get_settings().artifacts_dir / "metrics.json"
    if not p.exists():
        pytest.skip("run `make ml` first")
    m = json.loads(p.read_text(encoding="utf-8"))
    assert "generatedAt" in m and m["horizons"]
    for h in m["horizons"].values():
        assert {"climatology", "persistence", "random_forest", "xgboost"} <= set(h["regression"])
        assert h["samples"] > 0 and h["testPeriod"].startswith("2021")


def test_metrics_endpoint_not_evaluated_state(client, monkeypatch):
    monkeypatch.setattr(mla, "metrics", lambda: None)
    j = client.get("/api/models/metrics").json()
    assert j["evaluated"] is False and j["metrics"] is None


def test_scenario_forecast_zero_equals_baseline():
    if not mla.available():
        pytest.skip("no artifacts")
    base = mla.baseline_forecast("rajshahi", 1)
    rerun = mla.scenario_forecast("rajshahi", 1, 0.0, 0.0)
    assert rerun["value"] == pytest.approx(base["value"], abs=0.05)
    drier = mla.scenario_forecast("rajshahi", 1, -30.0, 0.0)
    assert drier["value"] <= base["value"]


def test_no_groundwater_depth_anywhere(client):
    """GRACE is storage anomaly only: no endpoint returns a groundwater depth or level."""
    gw = client.get("/api/predictions/groundwater?region=bd").json()
    assert "not well depth" in gw["note"]
    blob = json.dumps(client.get("/api/map/layers?region=bd").json()["values"]).lower()
    assert "depth" not in blob and "water level" not in blob


def test_missing_database_has_no_sample_fallback(monkeypatch, client, tmp_path):
    """Decision 5: no runtime sample/mock data. Without a database (and with external APIs blocked) the API reports
    'degraded' and 'unavailable' — it never serves a snapshot labelled as sample data."""
    s = get_settings()
    monkeypatch.setattr(s, "db_path", tmp_path / "missing.db")
    monkeypatch.setattr(s, "data_dir", tmp_path)  # no forecast cache either
    monkeypatch.setattr(s, "offline", True)
    da.clear_cache()
    try:
        h = client.get("/api/health").json()
        assert h["status"] == "degraded" and h["sampleMode"] is False
        t = da.table("weather_monthly")
        assert t.df.empty and t.is_sample is False and da.sample_tables() == []
        r = client.post("/api/irrigation/estimate",
                        json={"crop": "potato", "lat": 23.8, "lon": 90.4, "plantingDate": "2026-11-15"})
        assert r.status_code == 503 and "No weather data" in r.json()["detail"]
    finally:
        monkeypatch.undo()
        da.clear_cache()
