"""Export the OpenAPI spec and Phase-0 mock JSON for every endpoint.

    python backend/scripts/export_openapi_and_mocks.py

Mocks are captured from the API running on the frozen sample snapshot (AQUAGUARD_FORCE_SAMPLE=1,
AQUAGUARD_OFFLINE=1), so every Measure in them carries isSample = true. The frontend serves them when
NEXT_PUBLIC_API_MODE=mock, letting UI work proceed without a backend.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ["AQUAGUARD_FORCE_SAMPLE"] = "1"
os.environ["AQUAGUARD_OFFLINE"] = "1"
os.environ.pop("LLM_API_KEY", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MOCKS = ROOT / "frontend" / "public" / "mocks"

GETS = {
    "health": "/api/health", "regions": "/api/regions", "sources": "/api/sources",
    "overview": "/api/overview?region=bd", "alerts": "/api/alerts?region=bd", "map-layers": "/api/map/layers?region=bd",
    "weather": "/api/weather?region=dhaka&agg=monthly&start=2024-01",
    "predictions-scarcity": "/api/predictions/scarcity?region=bd&horizon=1",
    "predictions-demand": "/api/predictions/demand?region=bd",
    "predictions-groundwater": "/api/predictions/groundwater?region=bd",
    "models-metrics": "/api/models/metrics", "models-shap": "/api/models/shap?region=dhaka&horizon=1",
    "budget": "/api/budget?region=bd&period=dry",
}
POSTS = {
    "flow-simulate": ("/api/flow/simulate", {"pumpFlowM3s": 0.5, "setpointM": 45, "leaks": {"res": 2}, "optimize": True}),
    "budget-optimize": ("/api/budget/optimize", {"region": "bd", "period": "dry"}),
    "scenario-run": ("/api/scenario/run", {"region": "bd", "params": {"rainfallChangePct": -20}}),
    "irrigation-estimate": ("/api/irrigation/estimate", {"crop": "potato", "region": "dhaka", "soil": "silty_clay_loam",
                                                         "areaHa": 1, "plantingDate": "2026-11-15"}),
    "copilot-chat": ("/api/copilot/chat", {"message": "Summarize the water situation", "region": "bd"}),
}


def main() -> None:
    c = TestClient(app)
    MOCKS.mkdir(parents=True, exist_ok=True)
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "openapi.json").write_text(json.dumps(app.openapi(), indent=1), encoding="utf-8")
    for name, url in GETS.items():
        r = c.get(url)
        r.raise_for_status()
        (MOCKS / f"{name}.json").write_text(json.dumps(r.json()), encoding="utf-8")
    for name, (url, body) in POSTS.items():
        r = c.post(url, json=body)
        r.raise_for_status()
        (MOCKS / f"{name}.json").write_text(json.dumps(r.json()), encoding="utf-8")
    print(f"openapi -> docs/openapi.json; {len(GETS) + len(POSTS)} mocks -> {MOCKS}")


if __name__ == "__main__":
    main()
