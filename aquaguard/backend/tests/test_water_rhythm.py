"""Water Rhythm reads the same dryness definition as current indicators; no database writes are needed."""
import math
import sqlite3

import pytest

from app.services import store


def archive():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE weather_monthly (division TEXT, year INTEGER, month INTEGER, d_mm REAL)")
    conn.execute("CREATE TABLE locations (id TEXT, area_km2 REAL, is_weather_point INTEGER)")
    conn.executemany("INSERT INTO locations VALUES (?, ?, 1)", [("a", 1), ("b", 3)])
    conn.executemany("INSERT INTO weather_monthly VALUES (?, ?, ?, ?)",
                     [(division, y, m, (y - 1991) * factor + m * 0.7)
                      for division, factor in [("a", 1), ("b", 2)] for y in range(1991, 2027) for m in range(1, 13)])
    return conn


def test_historical_score_matches_original_sample_standardization():
    conn = archive()
    reg = {"id": "a", "level": "division"}
    got = store.water_balance_3m_history(conn, reg, ["2026-12"])[0]
    totals = [3 * (y - 1991) + (10 + 11 + 12) * 0.7 for y in range(1991, 2021)]
    mean = sum(totals) / 30
    sd = math.sqrt(sum((v - mean) ** 2 for v in totals) / 29)
    expected = (3 * 35 + 33 * 0.7 - mean) / sd
    assert got == pytest.approx(expected)
    assert got == pytest.approx(store.water_balance_3m_z(conn, "a")["z"])
    conn.close()


def test_cross_year_window_and_missing_month_are_not_interpolated():
    conn = archive()
    reg = {"id": "a", "level": "division"}
    assert store.water_balance_3m_history(conn, reg, ["2026-01"])[0] is not None
    conn.execute("DELETE FROM weather_monthly WHERE division='a' AND year=2025 AND month=12")
    assert store.water_balance_3m_history(conn, reg, ["2026-01"])[0] is None
    assert store.water_balance_3m_history(conn, reg, ["2026-04"])[0] is not None
    conn.close()


def test_insufficient_or_constant_reference_windows_are_unavailable():
    conn = archive()
    reg = {"id": "a", "level": "division"}
    conn.execute("DELETE FROM weather_monthly WHERE year BETWEEN 1991 AND 1996")
    assert store.water_balance_3m_history(conn, reg, ["2026-12"])[0] is None
    conn.close()
    conn = archive()
    conn.execute("UPDATE weather_monthly SET d_mm=1 WHERE year<=2021")
    assert store.water_balance_3m_history(conn, reg, ["2026-12"])[0] is None
    conn.close()


def test_national_weights_point_scores_and_requires_every_point():
    conn = archive()
    month = ["2026-11"]
    a = store.water_balance_3m_history(conn, {"id": "a", "level": "division"}, month)[0]
    b = store.water_balance_3m_history(conn, {"id": "b", "level": "division"}, month)[0]
    national = {"id": "bd", "level": "country"}
    conn.execute("PRAGMA query_only = ON")
    assert store.water_balance_3m_history(conn, national, month)[0] == pytest.approx((a + 3 * b) / 4)
    conn.execute("PRAGMA query_only = OFF")
    conn.execute("DELETE FROM weather_monthly WHERE division='b' AND year=2026 AND month=10")
    assert store.water_balance_3m_history(conn, national, month)[0] is None
    conn.close()


@pytest.mark.parametrize("region", ["dhaka", "bd"])
def test_history_api_opt_in_dryness_keeps_normal_months_and_units(client, region):
    plain = client.get(f"/api/weather/history?region={region}&normals=true").json()
    result = client.get(f"/api/weather/history?region={region}&normals=true&dryness=true").json()
    assert plain["data"]["series"] == result["data"]["series"][:-1]
    assert plain["data"]["normals"] == result["data"]["normals"]
    score = result["data"]["series"][-1]
    assert score["variable"] == "dryness_3m" and score["unit"] == "z-score"
    assert len(score["t"]) == len(score["v"])
    assert result["meta"]["source"] == ["openmeteo_archive"]
    assert "not a gamma-fitted SPI" in result["meta"]["note"]


def test_daily_dryness_and_district_history_are_rejected(client):
    assert client.get("/api/weather/history?step=daily&dryness=true").status_code == 422
    assert client.get("/api/weather/history?region=dhaka-sadar&dryness=true").status_code == 404
