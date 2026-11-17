"""M1 Command Center: division indicators and their classes, AQUASTAT history, weather normals, insights, KPI
formulas and reference geometry. Runs on the session test copy of the database (conftest)."""
from __future__ import annotations

import sqlite3

import pytest

from app.config.params import pval
from app.services import indicators, store
from app.settings import get_settings


def _db():
    return sqlite3.connect(get_settings().db_path)


@pytest.mark.parametrize("key,value,label", [
    ("rain_30d_anomaly", -19.4, "Normal"), ("rain_30d_anomaly", -19.6, "Deficient"),
    ("rain_30d_anomaly", -60.0, "Large deficient"), ("rain_30d_anomaly", 59.4, "Excess"),
    ("rain_30d_anomaly", 61.0, "Large excess"), ("dryness_3m", -1.0, "Moderately dry"),
    ("dryness_3m", -0.99, "Near normal"), ("dryness_3m", -2.0, "Extremely dry"), ("dryness_3m", 1.6, "Very wet"),
    ("water_balance_next_7d", -25.0, "Strong deficit"), ("reference_crop_need_30d", 120.0, "Very high"),
    # boundaries belong to the class farther from neutral (SPI convention), so there are no gaps
    ("reference_crop_need_30d", 25.0, "Moderate"), ("dryness_3m", 1.0, "Moderately wet"),
    ("water_balance_next_7d", -20.0, "Strong deficit"), ("water_balance_next_7d", 5.0, "Surplus"),
])
def test_indicator_classes(key, value, label):
    assert indicators.classify(key, value)["label"] == label


def test_unclassified_indicators_and_missing_values():
    assert indicators.classify("water_balance_30d", -50.0) is None
    assert indicators.classify("dryness_3m", None) is None


def test_every_classified_indicator_states_its_class_source():
    for d in indicators.DEFINITIONS:
        if d["classes"]:
            assert d["classSource"] and isinstance(d["assumption"], bool)
            tones = [c[3] for c in d["classes"]]
            assert all(-3 <= t <= 3 for t in tones)
        assert d["dataKind"] in ("derived", "reanalysis", "forecast")  # never a national statistic per division


def test_division_indicators_endpoint(client):
    body = client.get("/api/water/scarcity/divisions").json()
    d = body["data"]
    assert len(d["divisions"]) == 8 and d["national"]["id"] == "bd"
    keys = {i["key"] for i in d["indicators"]}
    for row in d["divisions"] + [d["national"]]:
        assert set(row["values"]) == keys
        for k, m in row["values"].items():
            assert m["dataKind"] in ("derived", "reanalysis", "forecast")  # decision 1
            expected = indicators.classify(k, m["value"]) if not (
                k == "rain_30d_anomaly" and m["value"] is None) else None
            got = row["classes"][k]
            assert (got or {}).get("label") == (expected or {}).get("label")
    assert all(r["values"]["dryness_3m"]["spatialLevel"] == "point" for r in d["divisions"])
    assert d["national"]["values"]["dryness_3m"]["spatialLevel"] == "national"


def test_water_history_lists_genuine_reference_years_only(client):
    d = client.get("/api/water/history?codes=4253,4188").json()["data"]
    by = {s["code"]: s for s in d["series"]}
    assert [p["referenceYear"] for p in by["4253"]["points"]] == [2008]  # withdrawals: 2008 only
    con = _db()
    imputed = {r[0] for r in con.execute("SELECT reference_year FROM water_statistics WHERE indicator_code='4188' "
                                         "AND (imputed = 1 OR symbol = 'I')")}
    con.close()
    years = [p["referenceYear"] for p in by["4188"]["points"]]
    assert years == sorted(years) and not (set(years) & imputed)
    assert all(p["dataKind"] == "statistic" and p["spatialLevel"] == "national" for p in by["4188"]["points"])
    r = client.get("/api/water/history?codes=1234")
    assert r.status_code == 422 and r.json()["code"] == "invalid_parameter"


def test_weather_normals_match_climatology(client):
    d = client.get("/api/weather/history?region=dhaka&normals=true").json()["data"]
    n = {s["variable"]: s for s in d["normals"]}["precip_mm"]
    con = _db()
    for t, v in zip(n["t"], n["v"]):
        want = con.execute("SELECT precip_mm FROM climatology WHERE division='dhaka' AND month=?", (int(t[5:7]),)).fetchone()[0]
        assert v == pytest.approx(want, abs=1e-3)
    con.close()
    assert set(n["t"]) == {t for s in d["series"] for t in s["t"]}
    r = client.get("/api/weather/history?step=daily&normals=true")
    assert r.status_code == 422


def test_insights_are_sourced_and_regional(client):
    nat = client.get("/api/dashboard/summary?region=bd").json()["data"]["insights"]
    div = client.get("/api/dashboard/summary?region=sylhet").json()["data"]["insights"]
    assert nat and div
    for i in nat + div:
        assert i["sources"] and i["status"] in ("fresh", "stale", "unavailable", "not_configured") and i["text"]
    stress = next(i for i in nat if i["key"] == "water_stress")
    s = store.stat(_db(), 4550)
    assert f"{s['value']:.1f}%" in stress["text"] and str(s["year"]) in stress["text"]
    assert "national statistic" in stress["text"]
    assert any("Sylhet" in i["text"] for i in div)
    assert not any("Range across divisions" in i["text"] for i in div)


def test_saving_kpi_formula(client):
    k = {x["key"]: x for x in client.get("/api/dashboard/summary?targetEfficiency=0.9").json()["data"]["kpis"]}
    agri = store.stat(_db(), 4250)
    current = float(pval("water_balance", "irrigation_efficiency"))
    assert k["saving"]["value"]["value"] == pytest.approx(agri["value"] * (1 - current / 0.9), abs=0.01)
    assert k["saving"]["value"]["dataKind"] == "scenario"


def test_reference_geometry(client):
    r = client.get("/api/geo/divisions")
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=86400"
    fc = r.json()
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == 8
    assert client.get("/api/geo/provinces").status_code == 422
