"""M2 Smart Irrigation: stored 7-day forecast of the nearest divisional point, no zero-filling of missing days,
'why' list with sources and ages, conditions context and data kinds."""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from app.engine import fao56
from app.services import data_access as da

BODY = {"crop": "potato", "region": "dhaka", "soil": "silty_clay_loam", "areaHa": 1, "plantingDate": "2026-11-15"}


def test_engine_refuses_missing_weather():
    crop = fao56.crops()["potato"]
    days = [{"date": "2026-11-20", "et0_mm": 3.0, "precip_mm": None}]
    with pytest.raises(ValueError, match="missing ET0 or rainfall for 2026-11-20"):
        fao56.advise(crop, "loam", date(2026, 11, 15), date(2026, 11, 20), days, 1.0, 0.7, None)


def test_estimate_uses_stored_forecast_and_explains_itself(client):
    r = client.post("/api/irrigation/estimate", json=BODY)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["pointId"] == "dhaka" and j["weatherMode"] in ("stored", "live", "cache")
    days = int(j["period"].split("(")[1].split()[0])
    assert 1 <= days <= 7  # 7-day window
    labels = [w["label"] for w in j["why"]]
    for need in ("Weather point", "Reference ET0", "Rainfall", "Soil moisture (start)", "Crop coefficient",
                 "Planting date", "Soil", "Irrigation efficiency"):
        assert need in labels
    et0 = next(w for w in j["why"] if w["label"] == "Reference ET0")
    assert et0["dataKind"] == "forecast" and et0["age"] and et0["status"] == j["forecastStatus"]
    assert j["et0"]["dataKind"] == "forecast" and j["netRequirementMm"]["dataKind"] == "derived"
    assert j["soilMoisture"]["note"].startswith("Open-Meteo model estimate")
    assert any(c["dataKind"] == "statistic" and "national" in c["value"] for c in j["context"])


def test_coordinates_map_to_the_nearest_divisional_point(client):
    j = client.post("/api/irrigation/estimate", json={**BODY, "region": None, "lat": 25.75, "lon": 89.25}).json()
    assert j["pointId"] == "rangpur"


def test_missing_forecast_days_are_reported_not_filled(client, monkeypatch):
    real = da.stored_forecast

    def gappy(lat, lon, past_days=7):
        fc = real(lat, lon, past_days)
        df = fc.daily.copy()
        fut = df[df["kind"] == "forecast"].sort_values("date").index
        if len(fut) >= 4:
            df.loc[fut[3], "precip_mm"] = float("nan")  # test-only gap in a real recorded forecast
        return da.Forecast(df, fc.soil_moisture, fc.retrieved_at, fc.mode, False, fc.point_id)

    monkeypatch.setattr(da, "stored_forecast", gappy)
    j = client.post("/api/irrigation/estimate", json=BODY).json()
    if j.get("windowNote") is None:  # only meaningful while the stored forecast covers today
        assert j["missingDays"], j["period"]
        assert any("missing days are never assumed to be dry" in r for r in j["recommendations"])
        assert any(w["label"] == "Incomplete forecast days" for w in j["why"])


def test_overrides_are_scenarios(client):
    j = client.post("/api/irrigation/estimate", json={**BODY, "rainfallOverrideMm": 50}).json()
    assert j["rainfall"]["dataKind"] == "scenario" and j["grossRequirementMm"]["dataKind"] == "scenario"


def test_engine_values_unchanged_for_complete_days():
    crop = fao56.crops()["wheat"]
    days = [{"date": f"2026-12-{d:02d}", "et0_mm": 2.5, "precip_mm": 0.0} for d in range(1, 8)]
    a = fao56.advise(crop, "loam", date(2026, 11, 20), date(2026, 12, 1), days, 1.0, 0.7, None)
    assert a["periodDays"] == 7 and a["precipMm"] == 0.0 and a["et0MeanMmDay"] == pytest.approx(2.5)
    assert not pd.isna(a["nirMm"])
