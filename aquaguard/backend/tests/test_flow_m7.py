"""M7 Water Flow: a conceptual illustration. Network values are `conceptual` (legacy provenance kept), no real data
is used by the network, and real AQUASTAT magnitudes come separately, marked as statistics, for scale."""
from __future__ import annotations

BODY = {"pumpFlowM3s": 0.5, "setpointM": 45, "leaks": {"res": 2}, "optimize": True}


def test_network_values_are_conceptual(client):
    j = client.post("/api/flow/simulate", json=BODY).json()
    assert j["label"] == "Conceptual illustration" and "CONCEPTUAL ILLUSTRATION" in j["disclaimer"]
    for state in (j["state"], j["optimized"]):
        for key in ("pumpFlow", "deliveredTotal", "leakTotal", "lossPct", "massBalanceError"):
            m = state[key]
            assert m["dataKind"] == "conceptual" and m["provenance"] == "simulated", key
            assert m["spatialLevel"] is None and "hypothetical" in m["note"]
        for p in state["pipes"]:
            assert p["flow"]["dataKind"] == "conceptual"
    assert all(m["dataKind"] == "conceptual" for m in j["savings"].values())
    loss = j["backgroundLossRate"]
    assert loss["dataKind"] == "conceptual" and loss["note"].startswith("Assumption")


def test_real_parts_are_marked_and_not_used(client):
    j = client.post("/api/flow/simulate", json=BODY).json()
    assert j["realPartsUsed"] == []
    keys = {x["key"]: x for x in j["scaleContext"]}
    assert keys, "AQUASTAT withdrawals are stored in the test database"
    for x in keys.values():
        v = x["value"]
        assert v["dataKind"] == "statistic" and v["sourceId"] == "fao_aquastat" and v["referenceYear"]
        assert "not used by the network" in v["note"]


def test_mass_balance_and_leak_validation_unchanged(client):
    j = client.post("/api/flow/simulate", json=BODY).json()
    assert abs(j["state"]["massBalanceError"]["value"]) < 1e-6
    assert client.post("/api/flow/simulate", json={"leaks": {"res": 9}}).status_code == 422
