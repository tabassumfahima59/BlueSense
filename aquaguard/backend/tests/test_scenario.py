"""Scenario engine: all-zero changes equal baseline; directions of change are physically consistent."""
import pytest

from app.engine import scenario
from app.schemas.common import ScenarioParams
from app.services import regional
from app.services.inputs import baseline_config, division_climates


def test_hargreaves_ratio():
    assert scenario.hargreaves_ratio(25.0, 0.0) == 1.0
    assert scenario.hargreaves_ratio(25.0, 2.0) == pytest.approx((25 + 2 + 17.8) / (25 + 17.8))


def test_all_zero_equals_baseline():
    p = ScenarioParams()
    assert p.is_baseline()
    for d, c in division_climates().items():
        c2, cfg2 = scenario.apply(c, baseline_config(), p)
        assert c2 == c
        assert cfg2 == baseline_config()
    b = regional.run("bd", ScenarioParams()).totals("annual")
    explicit = ScenarioParams(rainfallChangePct=0, temperatureChangeC=0, demandChangePct=0, groundwaterAvailabilityPct=0)
    s = regional.run("bd", explicit).totals("annual")
    assert s["supply"] == pytest.approx(b["supply"])
    assert s["unmetTotal"] == pytest.approx(b["unmetTotal"])


def test_dry_year_reduces_availability_and_raises_need():
    base = regional.run("rajshahi", ScenarioParams())
    dry = regional.run("rajshahi", ScenarioParams(rainfallChangePct=-20))
    assert dry.totals("annual")["runoff"] < base.totals("annual")["runoff"]
    assert dry.totals("annual")["supply"] < base.totals("annual")["supply"]
    assert dry.totals("annual")["demand"]["agriculture"] > base.totals("annual")["demand"]["agriculture"]
    assert dry.totals("dry")["stressRatio"] >= base.totals("dry")["stressRatio"]


def test_warming_raises_irrigation_need():
    base = regional.run("dhaka", ScenarioParams()).totals("annual")["demand"]["agriculture"]
    warm = regional.run("dhaka", ScenarioParams(temperatureChangeC=2)).totals("annual")["demand"]["agriculture"]
    assert warm > base


def test_efficiency_and_loss_and_groundwater_and_demand():
    base = regional.run("bd", ScenarioParams()).totals("annual")
    eff = regional.run("bd", ScenarioParams(irrigationEfficiency=0.9)).totals("annual")
    assert eff["demand"]["agriculture"] < base["demand"]["agriculture"]
    loss = regional.run("bd", ScenarioParams(pipelineLossPct=40)).totals("annual")
    assert loss["losses"] > base["losses"]
    gw = regional.run("bd", ScenarioParams(groundwaterAvailabilityPct=-50)).totals("annual")
    assert gw["groundwater"] == pytest.approx(base["groundwater"] * 0.5)
    dem = regional.run("bd", ScenarioParams(demandChangePct=50)).totals("annual")
    assert dem["demand"]["domestic"] == pytest.approx(base["demand"]["domestic"] * 1.5)


def test_scenario_params_validation():
    with pytest.raises(ValueError):
        ScenarioParams(rainfallChangePct=-80)
    with pytest.raises(ValueError):
        ScenarioParams(irrigationEfficiency=0.1)
