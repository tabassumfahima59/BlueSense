"""M3 What-if: national deterministic model, latest-data baseline, agricultural consumption lever, labels."""
from __future__ import annotations

import re

import pytest


def _run(client, params=None, basis="latest", region="bd"):
    r = client.post("/api/whatif", json={"region": region, "params": params or {}, "basis": basis})
    assert r.status_code == 200, r.text
    return r.json()


def _cmp(body, key, group="comparisons"):
    return next(c for c in body["data"]["result"][group] if c["key"] == key)


def test_latest_baseline_uses_recent_months(client):
    latest = _run(client)
    normal = _run(client, basis="normal")
    assert latest["data"]["basis"] == "latest"
    assert re.fullmatch(r"\d{4}-\d{2} to \d{4}-\d{2}", latest["data"]["basisPeriod"])
    assert normal["data"]["basisPeriod"] == "1991-2020 normal year"
    a = _cmp(latest, "irrigationNeed")["baseline"]["value"]
    b = _cmp(normal, "irrigationNeed")["baseline"]["value"]
    assert a != b  # the recent year differs from the normal year
    assert latest["data"]["method"] and any("decision 1" in m for m in latest["data"]["method"])


def test_every_output_is_labelled(client):
    body = _run(client, {"rainfallChangePct": -20})
    for group in ("comparisons", "sectorDemand", "allocation"):
        for c in body["data"]["result"][group]:
            assert c["baseline"]["dataKind"] == "derived"
            assert c["simulated"]["dataKind"] == "scenario" and c["change"]["dataKind"] == "scenario"
            assert c["simulated"]["spatialLevel"] == "national"
    assert all(p["unmet"]["dataKind"] == "scenario" for p in body["data"]["result"]["monthlySimulated"])


def test_agricultural_consumption_lever(client):
    base = _run(client)
    more = _run(client, {"agriculturalDemandChangePct": 10})
    b = _cmp(base, "agriculture", "sectorDemand")["simulated"]["value"]
    m = _cmp(more, "agriculture", "sectorDemand")["simulated"]["value"]
    assert m == pytest.approx(b * 1.10, rel=1e-3)
    dom_b = _cmp(base, "domestic", "sectorDemand")["simulated"]["value"]
    dom_m = _cmp(more, "domestic", "sectorDemand")["simulated"]["value"]
    assert dom_m == pytest.approx(dom_b)  # only agriculture changes
    assert "agricultural consumption +10%" in more["data"]["result"]["summary"]


def test_reset_equals_baseline_and_division_is_national(client):
    body = _run(client, {}, region="dhaka")
    assert body["data"]["result"]["context"]["region"]["id"] == "bd"
    assert "National data" in body["meta"]["note"]
    for c in body["data"]["result"]["comparisons"]:
        assert c["simulated"]["value"] == pytest.approx(c["baseline"]["value"])


@pytest.mark.parametrize("params", [{"agriculturalDemandChangePct": 60}, {"rainfallChangePct": -90},
                                    {"irrigationEfficiency": 0.2}])
def test_lever_ranges_are_validated(client, params):
    r = client.post("/api/whatif", json={"params": params})
    assert r.status_code == 422 and r.json()["code"] == "invalid_request"
