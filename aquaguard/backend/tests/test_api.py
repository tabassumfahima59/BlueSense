"""API contract: every endpoint responds, numbers are Measures, inputs are validated with clear 4xx errors."""
import pytest

GET_ENDPOINTS = [
    "/api/health", "/api/regions", "/api/sources", "/api/overview?region=bd", "/api/overview?region=sylhet",
    "/api/overview?region=rajshahi-rajshahi", "/api/alerts?region=bd", "/api/map/layers?region=bd",
    "/api/weather?region=dhaka&start=2024-01&agg=monthly", "/api/weather?region=dhaka&start=2026-10-01&agg=daily",
    "/api/predictions/scarcity?region=bd&horizon=1", "/api/predictions/scarcity?region=khulna&horizon=6",
    "/api/predictions/demand?region=bd", "/api/predictions/groundwater?region=bd", "/api/models/metrics",
    "/api/models/shap?region=dhaka&horizon=3", "/api/budget?region=bd&period=annual",
    "/api/budget?region=dhaka&period=3",
]
MEASURE_KEYS = {"value", "unit", "provenance", "isSample", "sourceId", "asOf", "uncertainty"}
PROVENANCES = {"observed", "historical", "predicted", "estimated", "simulated"}


def walk_numbers(obj, path="$", skip=("divisions", "districts")):
    """Yield (path, value) for every bare number that is not inside a Measure."""
    if isinstance(obj, dict):
        if MEASURE_KEYS <= set(obj):
            assert obj["provenance"] in PROVENANCES, path
            assert isinstance(obj["unit"], str) and obj["unit"], path
            return
        for k, v in obj.items():
            if k in skip:
                continue
            yield from walk_numbers(v, f"{path}.{k}", skip)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_numbers(v, f"{path}[{i}]", skip)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        yield path, obj


# Structural integers that are identifiers/indices rather than data (documented exceptions).
ALLOWED_BARE = ("month", "level", "riskLevel", "horizon", "year", "burstSeverity", ".metrics", ".samples",
                ".daily", ".centroid", ".local", ".globalImportance", ".model.", "Samples", "daysSincePlanting",
                ".location", ".scenario.", ".counts.", "].id")  # P3: alert tallies and stored-alert ids


@pytest.mark.parametrize("url", GET_ENDPOINTS)
def test_get_endpoints(client, url):
    r = client.get(url)
    assert r.status_code == 200, r.text
    bare = [(p, v) for p, v in walk_numbers(r.json()) if not any(a in p for a in ALLOWED_BARE)]
    assert not bare, f"numbers outside Measures: {bare[:5]}"


def test_scenario_query_changes_overview(client):
    b = client.get("/api/overview?region=bd").json()
    s = client.get("/api/overview?region=bd&rainfallChangePct=-20").json()
    assert s["context"]["scenarioActive"] and not b["context"]["scenarioActive"]
    assert s["kpis"]["availability"]["provenance"] == "simulated"
    assert b["kpis"]["availability"]["provenance"] == "estimated"
    assert s["kpis"]["availability"]["value"] < b["kpis"]["availability"]["value"]


@pytest.mark.parametrize("url,code", [
    ("/api/overview?region=atlantis", 404),
    ("/api/overview?region=bd&rainfallChangePct=-90", 422),
    ("/api/overview?region=bd&irrigationEfficiency=2", 422),
    ("/api/predictions/scarcity?region=bd&horizon=2", 422),
    ("/api/budget?region=bd&period=winter", 422),
])
def test_validation_errors(client, url, code):
    r = client.get(url)
    assert r.status_code == code
    assert "detail" in r.json() and r.json()["detail"]


def test_post_endpoints(client):
    r = client.post("/api/flow/simulate", json={"pumpFlowM3s": 0.5, "setpointM": 45, "leaks": {"res": 2}, "optimize": True})
    assert r.status_code == 200
    j = r.json()
    assert j["state"]["lossPct"]["provenance"] == "simulated"
    assert abs(j["state"]["massBalanceError"]["value"]) < 1e-6
    assert j["optimized"]["lossPct"]["value"] < j["state"]["lossPct"]["value"]
    assert "SIMULATED" in j["disclaimer"]

    r = client.post("/api/budget/optimize", json={"region": "bd", "period": "dry"})
    assert r.status_code == 200 and r.json()["proposed"]["balanced"]

    r = client.post("/api/scenario/run", json={"region": "bd", "params": {"rainfallChangePct": -20}})
    assert r.status_code == 200
    comps = {c["key"]: c for c in r.json()["comparisons"]}
    assert comps["availability"]["simulated"]["provenance"] == "simulated"

    r = client.post("/api/irrigation/estimate", json={"crop": "potato", "region": "rangpur", "soil": "sandy_loam",
                                                      "areaHa": 1.5, "plantingDate": "2026-11-15"})
    assert r.status_code == 200, r.text
    assert "validate locally" in r.json()["note"]

    r = client.post("/api/copilot/chat", json={"message": "Summarize Dhaka", "region": "dhaka"})
    assert r.status_code == 200 and r.json()["mode"] == "fallback"


@pytest.mark.parametrize("path,body", [
    ("/api/flow/simulate", {"pumpFlowM3s": -1}),
    ("/api/flow/simulate", {"leaks": {"res": 9}}),
    ("/api/flow/simulate", {"leaks": {"unknown": 1}}),
    ("/api/irrigation/estimate", {"crop": "banana", "region": "dhaka"}),
    ("/api/irrigation/estimate", {"crop": "wheat", "region": "dhaka", "soil": "peat"}),
    ("/api/irrigation/estimate", {"crop": "wheat", "lat": 10, "lon": 90}),
    ("/api/budget/optimize", {"mode": "shares", "shares": {"agriculture": 0}}),
    ("/api/copilot/chat", {"message": ""}),
])
def test_post_validation(client, path, body):
    r = client.post(path, json=body)
    assert 400 <= r.status_code < 500
    assert r.json().get("detail")


def test_sources_have_attribution(client):
    src = client.get("/api/sources").json()["sources"]
    ids = {s["id"] for s in src}
    assert {"openmeteo_archive", "fao_aquastat", "grace_csr", "geoboundaries", "hdx_cod_ps"} <= ids
    for s in src:
        assert s["license"] and s["url"] and s["retrievedAt"]


def test_cors_allowlist(client):
    ok = client.options("/api/health", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    bad = client.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert bad.headers.get("access-control-allow-origin") is None
