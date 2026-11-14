"""P3: envelope contract, spatial rules (decisions 1/4/6), validation, error codes, refresh throttling, admin sync,
alerts read marks, search and cache headers. Runs on the session test copy of the database (conftest)."""
from __future__ import annotations

import sqlite3

import pytest

from app.services import catalog, store
from app.settings import get_settings
from app.sync import jobs

META_KEYS = {"source", "data_kind", "observed_at", "retrieved_at", "unit", "spatial_level", "status", "attribution",
             "note"}
STATUSES = {"fresh", "stale", "unavailable", "not_configured"}
KINDS = {"observed", "model_current", "forecast", "reanalysis", "satellite_monthly", "satellite_historical",
         "statistic", "derived", "prediction", "scenario", "conceptual", "reference"}
GETS = [
    "/api/weather/current?region=bd", "/api/weather/current?region=dhaka", "/api/weather/forecast?region=bd",
    "/api/weather/forecast?region=dhaka&step=hourly&days=2", "/api/weather/history?region=bd",
    "/api/weather/history?region=dhaka&step=daily&start=2026-10-01&end=2026-10-31",
    "/api/water/availability?region=bd", "/api/water/scarcity?region=bd", "/api/water/scarcity?region=sylhet",
    "/api/groundwater/trends?region=bd", "/api/dashboard/summary?region=bd", "/api/dashboard/summary?region=khulna",
    "/api/predictions?region=bd", "/api/water-budget?region=bd", "/api/water-budget?mode=derived",
    "/api/alerts?region=bd", "/api/search?q=dhaka", "/api/data/sources", "/api/data/last-updated",
    "/api/irrigation/recommendations?crop=potato&region=dhaka&plantingDate=2026-11-15",
]


def measures(obj):
    """Every Measure-like dict in a response."""
    if isinstance(obj, dict):
        if {"value", "unit", "provenance"} <= set(obj):
            yield obj
        for v in obj.values():
            yield from measures(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from measures(v)


@pytest.mark.parametrize("url", GETS)
def test_envelope_contract(client, url):
    r = client.get(url)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"data", "meta"} <= set(body)
    meta = body["meta"]
    assert set(meta) == META_KEYS
    assert meta["status"] in STATUSES and meta["source"] and meta["attribution"]
    assert set(meta["data_kind"]) <= KINDS
    for m in measures(body["data"]):
        if m.get("dataKind") is not None:  # every new-style value carries its own metadata
            assert m["dataKind"] in KINDS and m["status"] in STATUSES and m["spatialLevel"]


def test_districts_and_unknown_regions_are_rejected_with_codes(client):
    r = client.get("/api/weather/current?region=dhaka-district")
    assert r.status_code == 404 and r.json()["code"] == "unknown_region"
    con = sqlite3.connect(get_settings().db_path)
    district = con.execute("SELECT id FROM locations WHERE level = 'district' LIMIT 1").fetchone()[0]
    con.close()
    r = client.get(f"/api/water/scarcity?region={district}")
    assert r.status_code == 422 and r.json()["code"] == "unsupported_region"


@pytest.mark.parametrize("url", ["/api/water/availability?region=dhaka", "/api/dashboard/summary?region=dhaka",
                                 "/api/water/scarcity?region=dhaka", "/api/water-budget?region=dhaka"])
def test_national_statistics_are_never_division_values(client, url):
    """Decision 1: AQUASTAT values stay national even when a division is selected."""
    body = client.get(url).json()
    stats = [m for m in measures(body["data"]) if m.get("dataKind") == "statistic"]
    assert stats, "expected AQUASTAT values"
    assert all(m["spatialLevel"] == "national" for m in stats)
    if "availability" in url:
        assert body["data"]["nationalOnly"] is True and "National data" in body["meta"]["note"]


def test_division_demand_is_weather_based_not_withdrawal(client):
    kpis = {k["key"]: k for k in client.get("/api/dashboard/summary?region=dhaka").json()["data"]["kpis"]}
    assert kpis["demand"]["value"]["dataKind"] == "derived" and kpis["demand"]["value"]["spatialLevel"] == "point"
    assert "Kc = 1" in kpis["demand"]["value"]["note"]


def test_national_weather_is_area_weighted_mean_of_eight_points(client):
    body = client.get("/api/weather/current?region=bd").json()
    assert body["data"]["points"] == 8 and "eight representative divisional weather points" in body["meta"]["note"]
    con = sqlite3.connect(get_settings().db_path)
    pts = store.weather_points(con)
    vals = {}
    for p in pts:
        t = con.execute("SELECT MAX(valid_time) FROM weather_values WHERE location_id = ? AND variable = "
                        "'temperature_2m' AND data_kind = 'model_current'", (p,)).fetchone()[0]
        row = con.execute("SELECT value FROM weather_values WHERE location_id = ? AND variable = 'temperature_2m' "
                          "AND data_kind = 'model_current' AND valid_time = ?", (p, t)).fetchone()
        vals[p] = row[0] if row else None
    con.close()
    expected = store.weighted(vals, pts)
    got = body["data"]["values"]["temperature_2m"]["value"]
    assert (got is None and expected is None) or got == pytest.approx(expected, abs=0.01)
    assert store.weighted({"a": 1.0, "b": None}, {"a": 1.0, "b": 1.0}) is None  # never a partial national value
    assert store.weighted({"a": 1.0, "b": 3.0}, {"a": 3.0, "b": 1.0}) == pytest.approx(1.5)


@pytest.mark.parametrize("url,code", [
    ("/api/weather/forecast?days=17", "invalid_request"),
    ("/api/weather/forecast?step=hourly&days=8", "invalid_range"),
    ("/api/weather/history?step=daily&start=2026/01/01", "invalid_date"),
    ("/api/weather/history?step=daily&start=2000-01-01&end=2026-01-01", "invalid_range"),
    ("/api/weather/history?start=2026-05&end=2026-01", "invalid_range"),
    ("/api/groundwater/trends?start=2020", "invalid_date"),
    ("/api/predictions?category=demand", "unsupported_category"),
    ("/api/predictions?horizon=2", "invalid_parameter"),
    ("/api/water-budget?mode=derived&period=13", "invalid_parameter"),
    ("/api/dashboard/summary?targetEfficiency=0.5", "invalid_parameter"),
    ("/api/search?q=", "invalid_request"),
    ("/api/alerts?severity=urgent", "invalid_parameter"),
])
def test_validation_errors_have_codes(client, url, code):
    r = client.get(url)
    assert r.status_code == 422 and r.json()["code"] == code and r.json()["detail"]


def test_groundwater_is_labelled_tws_and_regional(client):
    body = client.get("/api/groundwater/trends?region=dhaka&cells=true").json()
    d = body["data"]
    assert "not a groundwater level" in d["quantity"] and "~300 km" in d["resolutionNote"]
    assert body["meta"]["spatial_level"] == "regional" and d["latest"]["spatialLevel"] == "regional"
    assert len(d["cells"]) == 206 or not d["series"]  # 206 cells once the grid is stored
    if d["sameMonthLastYear"]:
        assert d["sameMonthLastYear"]["observedAt"][:4] == str(int(d["latest"]["observedAt"][:4]) - 1)


def test_dashboard_kpis_follow_the_definitions(client):
    kpis = {k["key"]: k for k in client.get("/api/dashboard/summary?region=bd").json()["data"]["kpis"]}
    assert set(kpis) == {"availability", "demand", "utilization", "groundwater", "saving"}
    util = kpis["utilization"]
    assert util["classLabel"] == store.sdg_class(util["value"]["value"])[0]
    assert kpis["saving"]["value"]["dataKind"] == "scenario" and "Assumption" in kpis["saving"]["value"]["note"]
    assert kpis["groundwater"]["value"]["dataKind"] == "satellite_monthly"
    hi = client.get("/api/dashboard/summary?region=bd&targetEfficiency=0.95").json()["data"]["kpis"]
    assert next(k for k in hi if k["key"] == "saving")["value"]["value"] > kpis["saving"]["value"]["value"]


def test_national_budget_keeps_reference_years(client):
    d = client.get("/api/water-budget").json()["data"]["national"]
    nodes = {n["id"]: n["value"] for n in d["nodes"]}
    assert d["mixedReferenceYears"] == (len(d["referenceYears"]) > 1)
    if not d["missing"]:
        parts = sum(nodes[k]["value"] for k in ("agriculture", "municipal", "industrial", "environment"))
        assert nodes["remainder"]["value"] == pytest.approx(nodes["trwr"]["value"] - parts, abs=0.02)
        assert nodes["remainder"]["dataKind"] == "derived"


def test_whatif_is_national_scenario(client):
    r = client.post("/api/whatif", json={"region": "sylhet", "params": {"rainfallChangePct": -20}})
    body = r.json()
    assert r.status_code == 200 and "scenario" in body["meta"]["data_kind"]
    assert body["meta"]["spatial_level"] == "national" and "National data" in body["meta"]["note"]
    assert body["data"]["result"]["context"]["region"]["id"] == "bd"


def test_irrigation_get_matches_post(client):
    q = {"crop": "potato", "region": "rangpur", "soil": "sandy_loam", "areaHa": 1.5, "plantingDate": "2026-11-15"}
    get = client.get("/api/irrigation/recommendations", params=q).json()
    post = client.post("/api/irrigation/estimate", json=q).json()
    assert get["data"]["grossRequirementMm"] == post["grossRequirementMm"] and get["data"]["period"] == post["period"]
    assert client.get("/api/irrigation/recommendations?crop=tea&region=dhaka").status_code == 422


# ---------------------------------------------------------------- alerts

def _eval_alerts():
    from app.db import connection
    from app.services import alert_engine

    conn = connection.connect(get_settings().db_path)
    try:
        return alert_engine.evaluate(conn)
    finally:
        conn.close()


def test_alerts_keep_legacy_fields_and_add_stored_ones(client):
    _eval_alerts()
    body = client.get("/api/alerts?region=bd").json()
    assert {"context", "alerts", "data", "meta"} <= set(body)  # legacy UI fields kept
    stored = body["data"]["alerts"]
    assert stored and all(a["severity"] in ("info", "low", "medium", "high", "critical") for a in stored)
    assert all(a["isPrediction"] == (a["dataKind"] == "prediction") for a in stored)
    division = client.get("/api/alerts?region=dhaka").json()["data"]["alerts"]
    assert all(a["regionId"] in ("dhaka", "bd") for a in division)
    high = client.get("/api/alerts?region=bd&severity=high").json()["data"]["alerts"]
    assert all(a["severity"] == "high" for a in high)


def test_mark_read_per_client(client):
    _eval_alerts()
    alerts = client.get("/api/alerts?region=bd&clientId=client-aaaa1111").json()["data"]
    aid = alerts["alerts"][0]["id"]
    before = alerts["counts"]["unread"]
    r = client.post(f"/api/alerts/{aid}/read", json={"clientId": "client-aaaa1111"})
    assert r.status_code == 200 and r.json()["data"] == {"alertId": aid, "read": True}
    again = client.post(f"/api/alerts/{aid}/read", json={"clientId": "client-aaaa1111"})
    assert again.status_code == 200  # idempotent
    after = client.get("/api/alerts?region=bd&clientId=client-aaaa1111").json()["data"]
    assert after["counts"]["unread"] == before - 1
    other = client.get("/api/alerts?region=bd&clientId=client-bbbb2222").json()["data"]
    assert next(a for a in other["alerts"] if a["id"] == aid)["read"] is False  # per client
    assert client.post("/api/alerts/999999/read", json={"clientId": "client-aaaa1111"}).status_code == 404
    bad = client.post(f"/api/alerts/{aid}/read", json={"clientId": "x"})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_request"


# ---------------------------------------------------------------- search, data sources

def test_search_regions_modules_and_districts(client):
    items = client.get("/api/search?q=dhaka").json()["data"]["items"]
    assert items[0]["type"] == "region" and items[0]["id"] == "dhaka"
    district = next((i for i in items if i["type"] == "region" and i["id"] != "dhaka"
                     and "District" in i["description"]), None)
    if district:
        assert district["href"].startswith("/command-center?region=")  # navigates to its division
    mods = client.get("/api/search?q=irrigation").json()["data"]["items"]
    assert any(i["type"] == "module" and i["href"] == "/irrigation" for i in mods)


def test_data_sources_status(client):
    rows = {r["id"]: r for r in client.get("/api/data/sources").json()["data"]}
    assert len(rows) == 13 and rows["grace_jpl"]["status"] == "not_configured"
    assert all(r["status"] in STATUSES for r in rows.values())
    lu = client.get("/api/data/last-updated").json()["data"]
    assert {r["id"] for r in lu["sources"]} == {"openmeteo_forecast", "openmeteo_archive", "fao_aquastat", "grace_csr"}
    assert lu["overallStatus"] in STATUSES


# ---------------------------------------------------------------- refresh and admin sync

def test_refresh_offline_up_to_date_and_throttled(client, monkeypatch):
    assert client.post("/api/refresh").json()["code"] == "offline"  # tests run with AQUAGUARD_OFFLINE=1
    s = get_settings()
    monkeypatch.setattr(s, "offline", False)
    monkeypatch.setattr(catalog, "status_of", lambda sid: "fresh")
    r = client.post("/api/refresh")
    assert r.status_code == 200 and r.json()["data"]["result"] == "up_to_date"

    calls = []

    def fake_run(name, **kw):
        calls.append(name)
        return jobs.JobResult(name, "success")

    monkeypatch.setattr(catalog, "status_of", lambda sid: "stale")
    monkeypatch.setattr(jobs, "run_job", fake_run)
    con = sqlite3.connect(get_settings().db_path)
    con.execute("DELETE FROM scheduler_lock WHERE name = 'refresh:manual'")  # test isolation only
    con.commit()
    con.close()
    first = client.post("/api/refresh")
    assert first.status_code == 200 and first.json()["data"]["result"] == "refreshed"
    assert calls == ["forecast", "archive"]  # never the GRACE download or AQUASTAT
    second = client.post("/api/refresh")
    assert second.status_code == 429 and second.json()["code"] == "refresh_throttled"
    assert 0 < int(second.headers["Retry-After"]) <= 600 and calls == ["forecast", "archive"]


def test_admin_sync_requires_token(client, monkeypatch):
    from pydantic import SecretStr

    assert client.post("/api/sync/forecast").status_code == 503  # no ADMIN_TOKEN configured
    s = get_settings()
    monkeypatch.setattr(s, "admin_token", SecretStr("t0ken-for-tests-only"))
    assert client.post("/api/sync/forecast").status_code == 401
    assert client.post("/api/sync/forecast", headers={"Authorization": "Bearer wrong"}).status_code == 403
    ran = []
    monkeypatch.setattr(jobs, "run_job", lambda name, **kw: ran.append((name, kw.get("force"))) or jobs.JobResult(
        name, "success", 7))
    ok = client.post("/api/sync/openmeteo_forecast?force=true", headers={"Authorization": "Bearer t0ken-for-tests-only"})
    assert ok.status_code == 200 and ok.json()["data"]["job"] == "forecast" and ran == [("forecast", True)]
    unknown = client.post("/api/sync/nasa", headers={"Authorization": "Bearer t0ken-for-tests-only"})
    assert unknown.status_code == 404 and unknown.json()["code"] == "unknown_source"
    assert "t0ken" not in ok.text + unknown.text


def test_unhandled_errors_hide_internals(client, monkeypatch):
    from app.routers import data_api

    def boom(*a, **k):
        raise RuntimeError("C:/secret/path.db is broken")

    monkeypatch.setattr(data_api.store, "grace_series", boom)
    from fastapi.testclient import TestClient

    from app.main import app

    r = TestClient(app, raise_server_exceptions=False).get("/api/groundwater/trends")
    assert r.status_code == 500 and r.json() == {"detail": "Internal server error.", "code": "internal_error"}


def test_cache_headers(client):
    assert client.get("/api/alerts?region=bd").headers["Cache-Control"] == "no-store"
    assert client.get("/api/data/sources").headers["Cache-Control"] == "no-store"
    assert client.get("/api/weather/current").headers["Cache-Control"] == "public, max-age=60"
    assert client.get("/api/water/availability").headers["Cache-Control"] == "public, max-age=300"
