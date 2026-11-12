"""Cross-module consistency: in baseline, Command Center totals = Sankey totals = What-if baseline totals."""
import pytest

from app.config.params import pval

TOL = pval("water_balance", "balance_tolerance_mcm")


@pytest.mark.parametrize("region", ["bd", "rajshahi", "sylhet"])
def test_baseline_totals_match_across_modules(client, region):
    ov = client.get(f"/api/overview?region={region}").json()["kpis"]
    budget = client.get(f"/api/budget?region={region}&period=annual").json()["current"]
    wi = client.post("/api/scenario/run", json={"region": region, "params": {}}).json()
    wcmp = {c["key"]: c for c in wi["comparisons"]}

    supply_cc = ov["availability"]["value"]
    supply_sankey = budget["supply"]["value"]
    supply_whatif = wcmp["availability"]["baseline"]["value"]
    assert supply_cc == pytest.approx(supply_sankey, abs=1.0)
    assert supply_cc == pytest.approx(supply_whatif, abs=1.0)

    demand_sankey = sum(s["demand"]["value"] for s in budget["sectors"] if s["sector"] != "environment")
    assert ov["demand"]["value"] == pytest.approx(demand_sankey, abs=1.0)
    assert ov["demand"]["value"] == pytest.approx(wcmp["demand"]["baseline"]["value"], abs=1.0)
    assert wcmp["availability"]["change"]["value"] == pytest.approx(0.0, abs=1e-6)


@pytest.mark.parametrize("period", ["annual", "dry", "1", "7"])
def test_sankey_inputs_equal_outputs(client, period):
    for scen in ("", "&rainfallChangePct=-40&pipelineLossPct=35"):
        b = client.get(f"/api/budget?region=bd&period={period}{scen}").json()["current"]
        links = b["links"]
        inflow = sum(lk["value"]["value"] for lk in links if lk["target"] == "available")
        outflow = sum(lk["value"]["value"] for lk in links if lk["source"] == "available")
        assert b["balanced"]
        assert abs(b["balanceError"]["value"]) <= TOL
        assert inflow == pytest.approx(outflow, abs=0.5)  # link values are rounded to 0.1 MCM


def test_irrigation_engine_feeds_water_balance():
    """Agricultural demand in the water balance is computed by the same FAO-56 functions as the advisor."""
    from app.engine import fao56
    from app.services.inputs import baseline_config, division_climates

    c = division_climates()["dhaka"]
    direct = fao56.agricultural_demand_monthly(list(c.precip_mm), list(c.et0_mm),
                                               baseline_config().irrigation_efficiency, c.area_share)
    from app.services import regional

    run = regional.run("dhaka")
    via_balance = [m.demand["agriculture"] for m in run.balances["dhaka"].months]
    assert via_balance == pytest.approx(direct["gross_mcm"])
