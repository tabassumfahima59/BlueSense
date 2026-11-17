"""M6 Explorer: weather-point layer and GRACE grid cells for the map."""
from __future__ import annotations

import os

from app.db import connection


def test_weather_points_are_the_eight_representative_points(client):
    r = client.get("/api/weather/points")
    assert r.status_code == 200, r.text
    assert "max-age" in r.headers.get("cache-control", "")
    body = r.json()
    pts = body["data"]["points"]
    conn = connection.connect(os.environ["AQUAGUARD_DB_PATH"], read_only=True)
    want = {row[0]: (row[1], row[2]) for row in conn.execute(
        "SELECT id, lat, lon FROM locations WHERE is_weather_point = 1")}
    conn.close()
    assert {p["id"]: (p["lat"], p["lon"]) for p in pts} == want and len(pts) == 8
    assert body["meta"]["data_kind"] == ["model_current"] and body["meta"]["spatial_level"] == "point"
    assert "not weather stations" in body["data"]["note"]
    for p in pts:
        if p["temperature"]:
            assert p["temperature"]["dataKind"] == "model_current" and p["temperature"]["unit"]
            assert p["temperature"]["observedAt"].endswith("+06:00")


def test_grace_cells_are_labelled_with_their_resolution(client):
    d = client.get("/api/groundwater/trends?region=bd&cells=true").json()["data"]
    if not d["series"]:
        return  # no GRACE data stored in this database
    assert d["cells"] and d["cellsPeriod"]
    assert "300 km" in d["resolutionNote"]
    lats = sorted({c["lat"] for c in d["cells"]})
    assert all(abs((b - a) - 0.25) < 1e-6 or (b - a) > 0.25 for a, b in zip(lats, lats[1:], strict=False))
    assert client.get("/api/groundwater/trends?region=bd").json()["data"]["cells"] == []  # only on request
