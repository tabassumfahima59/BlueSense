"""Flow simulation: Hazen-Williams, mass balance, zero leakage, pressure management."""
import pytest

from app.engine import flow_sim


def test_hazen_williams_reference():
    # hf = 10.67 L Q^1.852 / (C^1.852 D^4.87)
    hf = flow_sim.hazen_williams_hf(0.1, 1000, 0.3, 130)
    assert hf == pytest.approx(10.67 * 1000 * 0.1 ** 1.852 / (130 ** 1.852 * 0.3 ** 4.87))
    assert flow_sim.hazen_williams_hf(0.2, 1000, 0.3, 130) > hf


@pytest.mark.parametrize("leaks", [{}, {"res": 1}, {"trunk": 3, "agr": 2, "ind": 0.5}])
@pytest.mark.parametrize("loss", [0.0, 0.2, 0.4])
def test_mass_balance(leaks, loss):
    st = flow_sim.simulate(0.5, 45.0, leaks, loss)
    assert abs(st["massBalanceErrorM3s"]) < 1e-9
    assert st["pumpFlowM3s"] == pytest.approx(st["deliveredTotalM3s"] + st["leakTotalM3s"])


def test_all_leaks_off_zero_loss():
    st = flow_sim.simulate(0.5, 45.0, {"res": 0, "agr": 0}, 0.0)
    assert st["leakTotalM3s"] == 0.0
    assert st["lossPct"] == 0.0


def test_background_calibration_matches_loss_rate():
    st = flow_sim.simulate(0.5, 45.0, {}, 0.2)
    assert st["lossPct"] == pytest.approx(20.0, abs=0.05)


def test_burst_increases_loss_and_pressure_reduces_it():
    base = flow_sim.simulate(0.5, 45.0, {}, 0.2)
    burst = flow_sim.simulate(0.5, 45.0, {"res": 2}, 0.2)
    low = flow_sim.simulate(0.5, 35.0, {}, 0.2)
    assert burst["lossPct"] > base["lossPct"]
    assert low["lossPct"] < base["lossPct"]


def test_optimise_meets_service_pressure_and_reduces_loss():
    before = flow_sim.simulate(0.5, 45.0, {"res": 2}, 0.2)
    o = flow_sim.optimise(0.5, 45.0, {"res": 2}, 0.2)
    after = o["state"]
    assert o["setpointM"] <= 45.0
    assert all(d["serviceOk"] for d in after["destinations"])
    assert after["lossPct"] < before["lossPct"]
    assert abs(after["massBalanceErrorM3s"]) < 1e-9


def test_unknown_pipe():
    with pytest.raises(ValueError):
        flow_sim.simulate(0.5, 45.0, {"nope": 1}, 0.2)
