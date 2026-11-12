"""FAO-56 engine: Kc curve, USDA-SCS effective rainfall, volumes, advisor robustness."""
from datetime import date, timedelta

import pytest

from app.engine import fao56


def test_effective_rainfall_usda_scs():
    assert fao56.effective_rainfall_monthly(0) == 0
    assert fao56.effective_rainfall_monthly(100) == pytest.approx(100 * (125 - 20) / 125)
    assert fao56.effective_rainfall_monthly(250) == pytest.approx(150.0)
    assert fao56.effective_rainfall_monthly(300) == pytest.approx(155.0)  # 125 + 0.1 x 300
    # continuous at the 250 mm breakpoint
    assert fao56.effective_rainfall_monthly(250.001) == pytest.approx(150.0, abs=1e-3)


def test_kc_curve_rice_table12():
    rice = fao56.crops()["boro_rice"]
    assert fao56.kc_on_day(rice, 0) == 1.05
    assert fao56.kc_on_day(rice, rice.l_ini + rice.l_dev + 1) == 1.20
    assert fao56.kc_on_day(rice, rice.season_days - 1) == pytest.approx(rice.kc_end, abs=0.02)
    assert fao56.kc_on_day(rice, rice.season_days) == 0
    mid_dev = rice.l_ini + rice.l_dev // 2
    assert 1.05 < fao56.kc_on_day(rice, mid_dev) < 1.20


def test_volume_conversion():
    assert fao56.mm_ha_to_m3(10, 1) == 100.0          # 10 mm on 1 ha = 100 m3
    assert fao56.mm_kha_to_mcm(100, 1) == pytest.approx(1.0)   # 100 mm on 1000 ha = 1 MCM


def test_monthly_requirement_efficiency_one_and_zero_rain():
    wheat = fao56.crops()["wheat"]
    p0 = [0.0] * 12
    et0 = [100.0] * 12
    rows = fao56.monthly_requirement(wheat, p0, et0, 1.0)
    for r in rows:
        assert r["gir_mm"] == pytest.approx(r["nir_mm"])
        assert r["nir_mm"] == pytest.approx(r["etc_mm"])  # no rain, no rice extras
    assert sum(r["days"] for r in rows) == wheat.season_days
    with pytest.raises(ValueError):
        fao56.monthly_requirement(wheat, p0, et0, 0.0)


def test_rice_extras_included():
    rice = fao56.crops()["boro_rice"]
    rows = fao56.monthly_requirement(rice, [0.0] * 12, [0.0] * 12, 1.0)
    extra = sum(r["extra_mm"] for r in rows)
    rp = fao56.rice_params()
    assert extra == pytest.approx(rp["land_preparation_mm"] + rp["percolation_mm_day"] * rice.season_days)


def _days(start: date, n: int, et0=4.0, p=0.0):
    return [{"date": (start + timedelta(days=i)).isoformat(), "et0_mm": et0, "precip_mm": p} for i in range(n)]


def test_advisor_works_without_soil_moisture():
    wheat = fao56.crops()["wheat"]
    today = date(2026, 1, 10)
    a = fao56.advise(wheat, "loam", date(2025, 11, 20), today, _days(today, 16), 2.0, 0.7, None)
    assert a["inSeason"]
    assert a["startBasis"].startswith("assumed")
    assert a["girMm"] == pytest.approx(a["nirMm"] / 0.7)
    assert a["girM3"] == pytest.approx(a["girMm"] * 2.0 * 10)
    assert a["nextIrrigationDate"] is not None
    assert a["intervalDays"] == pytest.approx(a["triggerMm"] / (sum(4.0 * fao56.kc_on_day(wheat, 51 + i)
                                                                    for i in range(16)) / 16), rel=1e-6)


def test_advisor_reproducible():
    pot = fao56.crops()["potato"]
    today = date(2026, 12, 1)
    args = (pot, "sandy_loam", date(2026, 11, 15), today, _days(today, 16, p=2.0), 1.0, 0.75, 0.25)
    assert fao56.advise(*args) == fao56.advise(*args)


def test_unknown_soil():
    with pytest.raises(KeyError):
        fao56.soil_water("peat", fao56.crops()["wheat"])
