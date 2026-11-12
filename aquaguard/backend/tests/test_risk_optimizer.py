"""Risk classes and the allocation optimizer."""
import pytest

from app.engine import optimizer, risk
from app.engine.water_balance import aggregate
from app.schemas.common import ScenarioParams
from app.services import regional


def test_stress_labels_wri():
    assert risk.stress_label(0.05) == "Low"
    assert risk.stress_label(0.15) == "Low-medium"
    assert risk.stress_label(0.30) == "Medium-high"
    assert risk.stress_label(0.50) == "High"
    assert risk.stress_label(0.90) == "Extremely high"


def test_dryness_labels():
    assert risk.dryness_label(0.0) == "Near normal or wet"
    assert risk.dryness_label(-1.2) == "Moderately dry"
    assert risk.dryness_label(-1.7) == "Severely dry"
    assert risk.dryness_label(-2.5) == "Extremely dry"
    assert risk.dryness_label(None) is None


def test_combined_takes_max():
    assert risk.combined(0.05, -2.5)["label"] == "Extremely high"
    assert risk.combined(0.5, 0.0)["label"] == "High"


def test_optimizer_domestic_first_env_protected():
    need = {"agriculture": 100.0, "domestic": 20.0, "industry": 10.0, "environment": 30.0}
    alloc = optimizer.optimal_allocation(60.0, need, 0.2)
    assert sum(alloc.values()) <= 60.0 + 1e-6
    assert alloc["environment"] == pytest.approx(30.0)
    assert alloc["domestic"] == pytest.approx(20.0)


def test_shares_sum_normalised():
    need = {"agriculture": 100.0, "domestic": 100.0, "industry": 100.0, "environment": 100.0}
    alloc = optimizer.allocation_by_shares(100.0, need, {"agriculture": 2, "domestic": 1, "industry": 1, "environment": 0})
    assert alloc["agriculture"] == pytest.approx(50.0)
    with pytest.raises(ValueError):
        optimizer.allocation_by_shares(100.0, need, {"agriculture": 0})


@pytest.mark.parametrize("mode", ["optimized", "shares"])
def test_reallocation_keeps_balance(mode):
    r = regional.run("bd", ScenarioParams(rainfallChangePct=-30))
    shares = {"agriculture": 0.6, "domestic": 0.1, "industry": 0.05, "environment": 0.25}
    months = regional.reallocated(r, "dry", mode, shares)
    assert abs(aggregate(months)["balanceError"]) <= 0.01


def test_optimizer_never_increases_domestic_unmet():
    r = regional.run("bd", ScenarioParams(rainfallChangePct=-30, groundwaterAvailabilityPct=-50))
    cur = aggregate(r.months("dry"))
    opt = aggregate(regional.reallocated(r, "dry", "optimized"))
    assert opt["unmet"]["domestic"] <= cur["unmet"]["domestic"] + 1e-6
