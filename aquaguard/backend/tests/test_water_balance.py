"""Water-balance engine: mass balance in every state, unit conversions, edge cases."""
from dataclasses import replace

import pytest

from app.config.params import pval
from app.engine import water_balance as wb
from app.services.inputs import baseline_config, division_climates

TOL = pval("water_balance", "balance_tolerance_mcm")


def all_months(cfg, climates):
    out = []
    for c in climates.values():
        out += wb.division_balance(c, cfg).months
    return out


def test_unit_conversions():
    # 100 mm on 10 km2 with C = 1 -> 1e-1 m x 1e7 m2 = 1e6 m3 = 1 MCM
    assert wb.local_runoff_mcm(1.0, 100.0, 10.0) == pytest.approx(1.0)
    # 1 million people x 100 L/day x 10 days = 1e9 L = 1e6 m3 = 1 MCM
    assert wb.domestic_mcm(1e6, 100.0, 10) == pytest.approx(1.0)


def test_mass_balance_every_month_baseline():
    for mb in all_months(baseline_config(), division_climates()):
        assert abs(mb.balance_error) <= TOL
        assert mb.storage_change >= -1e-9
        for s in wb.SECTORS:
            assert mb.delivered[s] <= mb.demand[s] + 1e-9
            assert mb.unmet[s] >= 0


@pytest.mark.parametrize("loss", [0.0, 0.2, 0.5])
@pytest.mark.parametrize("gw", [0.5, 1.0, 1.2])
def test_mass_balance_varied_states(loss, gw):
    cfg = replace(baseline_config(), loss_rate=loss, groundwater_multiplier=gw, demand_multiplier=1.5)
    agg = wb.aggregate(all_months(cfg, division_climates()))
    assert abs(agg["balanceError"]) <= TOL


def test_zero_rainfall():
    c = next(iter(division_climates().values()))
    dry = replace(c, precip_mm=tuple(0.0 for _ in range(12)))
    b = wb.division_balance(dry, baseline_config())
    assert all(m.runoff == 0 for m in b.months)
    assert all(abs(m.balance_error) <= TOL for m in b.months)
    base = wb.division_balance(c, baseline_config())
    # no rain -> no effective rainfall -> irrigation demand cannot fall
    assert wb.aggregate(b.months)["demand"]["agriculture"] >= wb.aggregate(base.months)["demand"]["agriculture"]


def test_efficiency_one_gives_net_requirement():
    cfg = replace(baseline_config(), irrigation_efficiency=1.0)
    c = next(iter(division_climates().values()))
    b = wb.division_balance(c, cfg)
    for m in b.months:
        assert m.demand["agriculture"] == pytest.approx(m.agri_net)


def test_no_losses_when_loss_rate_zero():
    cfg = replace(baseline_config(), loss_rate=0.0)
    agg = wb.aggregate(all_months(cfg, division_climates()))
    assert agg["losses"] == 0.0


def test_proportional_rationing_when_short():
    need = {"agriculture": 60.0, "domestic": 30.0, "industry": 10.0, "environment": 0.0}
    alloc = wb.allocate_proportional(50.0, need)
    assert sum(alloc.values()) == pytest.approx(50.0)
    assert alloc["agriculture"] / alloc["domestic"] == pytest.approx(2.0)


def test_stress_classes():
    classes = [{"name": "Low", "max": 0.1}, {"name": "Medium", "max": 0.4}, {"name": "High", "max": None}]
    assert wb.stress_class(0.05, classes) == "Low"
    assert wb.stress_class(0.1, classes) == "Medium"
    assert wb.stress_class(5.0, classes) == "High"
