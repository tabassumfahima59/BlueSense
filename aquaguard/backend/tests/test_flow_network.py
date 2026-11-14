"""Water Flow network controls: pump on/off, capacity, source limit, allocation, closed valves, demand factors,
supply-demand balance and the accounting identity. Every value stays conceptual and finite."""
from __future__ import annotations

import json
import math

import pytest

from app.engine import flow_sim

DESTS = ["residential", "agricultural", "industrial", "other"]


def by_id(st: dict) -> dict:
    return {d["id"]: d for d in st["destinations"]}


def test_normal_operation_is_balanced_and_every_zone_served():
    st = flow_sim.simulate(0.5, 45.0, {}, 0.2)
    assert [d["id"] for d in st["destinations"]] == DESTS
    assert st["balanceStatus"] == "balanced" and st["limitingFactor"] is None
    assert all(d["status"] == "served" for d in st["destinations"])
    assert st["pumpFlowM3s"] == pytest.approx(st["deliveredTotalM3s"] + st["leakTotalM3s"])
    assert sum(d["sharePct"] for d in st["destinations"]) == pytest.approx(100.0)
    assert st["efficiencyPct"] == pytest.approx(80.0, abs=0.1) and st["pumpUtilizationPct"] == pytest.approx(62.5)


def test_pump_off_stops_everything_without_errors():
    st = flow_sim.simulate(0.5, 45.0, {"res": 2}, 0.2, pump_on=False)
    assert st["pumpFlowM3s"] == 0 and st["deliveredTotalM3s"] == 0 and st["leakTotalM3s"] == 0
    assert st["limitingFactor"] == "pump_off" and st["balanceStatus"] == "deficit" and st["efficiencyPct"] is None
    assert all(d["status"] == "no_supply" and d["pressureM"] == 0 for d in st["destinations"])


@pytest.mark.parametrize("kw,factor,q", [({"capacity_m3s": 0.35}, "pump_capacity", 0.35),
                                         ({"source_limit_m3s": 0.30}, "source_limit", 0.30)])
def test_capacity_and_source_limits_cap_the_flow_explicitly(kw, factor, q):
    st = flow_sim.simulate(0.5, 45.0, {}, 0.2, **kw)
    assert st["pumpFlowM3s"] == pytest.approx(q) and st["requestedPumpFlowM3s"] == 0.5
    assert st["limitingFactor"] == factor and st["balanceStatus"] == "deficit"
    assert abs(st["massBalanceErrorM3s"]) < 1e-9


def test_allocation_moves_water_between_branches():
    base = by_id(flow_sim.simulate(0.5, 45.0, {}, 0.2))
    st = flow_sim.simulate(0.5, 45.0, {}, 0.2, allocation={"residential": 25, "agricultural": 50, "industrial": 15,
                                                            "other": 10})
    d = by_id(st)
    assert d["agricultural"]["deliveredM3s"] > base["agricultural"]["deliveredM3s"]
    assert d["residential"]["deliveredM3s"] < base["residential"]["deliveredM3s"]
    assert d["agricultural"]["sharePct"] == pytest.approx(50.0)
    assert abs(st["massBalanceErrorM3s"]) < 1e-9


def test_a_closed_branch_gets_nothing_and_its_share_goes_to_the_open_ones():
    st = flow_sim.simulate(0.5, 45.0, {}, 0.2, closed=["res"])
    d = by_id(st)
    assert d["residential"]["status"] == "closed" and d["residential"]["deliveredM3s"] == 0
    assert sum(x["sharePct"] for x in st["destinations"]) == pytest.approx(100.0)
    assert d["residential"]["sharePct"] == 0
    pipe = next(p for p in st["pipes"] if p["id"] == "res")
    assert pipe["flowM3s"] == 0 and pipe["leakM3s"] == 0
    assert flow_sim.simulate(0.5, 45.0, {}, 0.2, closed=["trunk"])["limitingFactor"] == "valve_closed"


def test_demand_increase_creates_an_explicit_deficit():
    st = flow_sim.simulate(0.5, 45.0, {}, 0.2, demand_factors={"agricultural": 1.6})
    assert st["balanceStatus"] == "deficit" and by_id(st)["agricultural"]["status"] == "under_supplied"
    assert by_id(st)["agricultural"]["supplyPct"] < 98


def test_unknown_ids_are_rejected():
    with pytest.raises(ValueError):
        flow_sim.simulate(0.5, 45.0, {}, 0.2, allocation={"moon": 100})
    with pytest.raises(ValueError):
        flow_sim.simulate(0.5, 45.0, {}, 0.2, closed=["nope"])


# ---------------------------------------------------------------- API

def finite(obj) -> bool:
    if isinstance(obj, float):
        return math.isfinite(obj)
    if isinstance(obj, dict):
        return all(finite(v) for v in obj.values())
    if isinstance(obj, list):
        return all(finite(v) for v in obj)
    return True


@pytest.mark.parametrize("body", [
    {}, {"pumpOn": False}, {"pumpCapacityM3s": 0.35}, {"sourceLimitM3s": 0.0}, {"closedPipes": ["res", "agr", "ind",
                                                                                                     "oth"]},
    {"leaks": {"trunk": 3, "res": 3}, "optimize": True},
    {"allocationPct": {"residential": 0, "agricultural": 0, "industrial": 0, "other": 100}},
])
def test_api_values_are_finite_and_the_identity_holds(client, body):
    r = client.post("/api/flow/simulate", json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert finite(j) and "NaN" not in json.dumps(j)
    s = j["state"]
    assert abs(s["inflowDaily"]["value"] - s["deliveredDaily"]["value"] - s["leakDaily"]["value"]) <= 2
    assert abs(s["accountingResidualDaily"]["value"]) < 1e-3
    assert all(m["dataKind"] == "conceptual" for m in (s["inflowDaily"], s["efficiency"], s["supplyBalanceDaily"]))
    assert j["reservoirCapacity"]["dataKind"] == "conceptual"
    assert sum(j["defaultAllocationPct"].values()) == pytest.approx(100.0)


def test_api_pipe_and_destination_details(client):
    s = client.post("/api/flow/simulate", json={"leaks": {"res": 1}, "closedPipes": ["oth"]}).json()["state"]
    pipes = {p["id"]: p for p in s["pipes"]}
    assert pipes["trunk"]["kind"] == "main" and pipes["res"]["kind"] == "branch"
    assert pipes["res"]["status"] == "leaking" and pipes["oth"]["status"] == "closed" and pipes["agr"]["status"] == "open"
    d = {x["id"]: x for x in s["destinations"]}
    assert d["other"]["status"] == "closed" and d["residential"]["share"]["unit"] == "%"


@pytest.mark.parametrize("body,needle", [
    ({"allocationPct": {"residential": 50, "agricultural": 30}}, "add up to 100"),
    ({"allocationPct": {"residential": 120, "agricultural": -20}}, "between 0 and 100"),
    ({"demandFactors": {"industrial": 5}}, "between 0 and 3"),
    ({"allocationPct": {"moon": 100}}, "unknown destinations"),
    ({"closedPipes": ["nope"]}, "unknown pipe ids"),
])
def test_api_rejects_invalid_configurations(client, body, needle):
    r = client.post("/api/flow/simulate", json=body)
    assert r.status_code == 422 and needle in json.dumps(r.json())


def test_optimise_with_no_flow_says_so(client):
    j = client.post("/api/flow/simulate", json={"pumpOn": False, "optimize": True}).json()
    assert j["optimized"] is None and "Nothing to optimise" in j["optimizationNote"]
