"""M4 Water Budget: national AQUASTAT budget (sources -> total -> uses, own reference years, genuine history and
comparison years, 'no data' parts never filled) and the derived monthly model tab (national only, scenario-aware)."""
from __future__ import annotations

import os

import pytest

from app.db import connection
from app.services import store

TOL = 0.05


def national(client, path="/api/water-budget"):
    r = client.get(path)
    assert r.status_code == 200, r.text
    return r.json()


def test_national_budget_flows_balance_and_keep_reference_years(client):
    body = national(client)
    d = body["data"]["national"]
    nodes = {n["id"]: n for n in d["nodes"]}
    assert body["data"]["mode"] == "national" and body["meta"]["spatial_level"] == "national"
    assert nodes["trwr"]["kind"] == "total" and nodes["trwr"]["code"] == "4188"
    # every drawn statistic keeps its own reference year; only the remainder is derived
    for n in d["nodes"]:
        if n["value"]["value"] is None:
            continue
        if n["id"] == "remainder":
            assert n["value"]["dataKind"] == "derived" and n["value"]["referenceYear"] is None
        else:
            assert n["value"]["dataKind"] == "statistic" and n["value"]["referenceYear"] in d["referenceYears"]
    assert d["mixedReferenceYears"] == (len(d["referenceYears"]) > 1)
    links = d["links"]
    into = sum(lk["value"]["value"] for lk in links if lk["target"] == "trwr")
    out = sum(lk["value"]["value"] for lk in links if lk["source"] == "trwr")
    total = nodes["trwr"]["value"]["value"]
    if any(lk["target"] == "trwr" for lk in links):  # sources drawn only when they reproduce the total
        assert into == pytest.approx(total, abs=TOL)
        assert {nodes["surface"]["kind"], nodes["groundwater"]["kind"]} == {"source"}
    if not d["missing"]:
        assert out == pytest.approx(total, abs=TOL)


def test_history_holds_only_genuine_years_and_comparison_years_come_from_it(client):
    d = national(client)["data"]["national"]
    conn = connection.connect(os.environ["AQUAGUARD_DB_PATH"], read_only=True)
    years = set()
    for h in d["history"]:
        got = [p["referenceYear"] for p in h["points"]]
        want = [r[0] for r in conn.execute(
            "SELECT reference_year FROM water_statistics WHERE source_id = 'fao_aquastat' AND indicator_code = ? "
            "AND superseded_at IS NULL AND imputed = 0 ORDER BY reference_year", (h["code"],))]
        assert got == want  # imputed years excluded, nothing interpolated
        assert all(p["dataKind"] == "statistic" for p in h["points"])
        years.update(got)
    conn.close()
    assert d["comparisonYears"] == sorted(years)


def test_missing_part_is_no_data_and_blocks_the_remainder(client, monkeypatch):
    real = store.stat
    monkeypatch.setattr(store, "stat", lambda conn, code: None if code == 4250 else real(conn, code))
    d = national(client)["data"]["national"]
    nodes = {n["id"]: n for n in d["nodes"]}
    assert "agriculture" in d["missing"]
    assert nodes["agriculture"]["value"]["value"] is None and nodes["agriculture"]["value"]["status"] == "unavailable"
    assert not any(lk["target"] == "agriculture" for lk in d["links"])
    assert "remainder" not in nodes  # never computed from an incomplete set of parts


def test_source_split_is_dropped_when_it_does_not_add_up(client, monkeypatch):
    real = store.stat

    def skewed(conn, code):
        s = real(conn, code)
        return {**s, "value": s["value"] + 5.0} if code == 4187 and s else s

    monkeypatch.setattr(store, "stat", skewed)
    d = national(client)["data"]["national"]
    assert not any(lk["target"] == "trwr" for lk in d["links"])
    assert any("split is not drawn" in n for n in d["notes"])


def test_division_selection_is_labelled_national(client):
    body = national(client, "/api/water-budget?region=sylhet")
    assert body["meta"]["spatial_level"] == "national" and "National" in (body["meta"]["note"] or "")


def test_derived_tab_is_national_and_labels_scenarios(client):
    base = client.get("/api/water-budget?mode=derived&period=dry&region=khulna").json()
    assert base["meta"]["data_kind"] == ["derived"] and base["data"]["derived"]["context"]["region"]["id"] == "bd"
    sc = client.get("/api/water-budget?mode=derived&period=dry&rainfallChangePct=-20").json()
    assert sc["meta"]["data_kind"] == ["scenario"] and "Scenario levers applied" in sc["meta"]["note"]
    a, b = base["data"]["derived"]["current"], sc["data"]["derived"]["current"]
    assert b["supply"]["value"] < a["supply"]["value"]
    assert a["balanced"] and b["balanced"]
    # colour-clash fix lives in the frontend; the model still emits distinct groundwater and losses nodes
    ids = [n["id"] for n in a["nodes"]]
    assert "groundwater" in ids and "losses" in ids
