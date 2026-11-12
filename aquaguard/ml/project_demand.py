"""Write the transparent water-demand projection (Estimated) for every region to ml/artifacts/demand_projection.json.

    python ml/project_demand.py

This is NOT an ML forecast: no reliable monthly consumption history exists for Bangladeshi divisions.
It calls the same backend code that serves /api/predictions/demand (domestic scaled by the World Bank
population projection; agriculture = FAO-56 requirement for the AQUASTAT irrigated area; industry constant),
so the artifact and the API can never disagree.
"""
from __future__ import annotations

import os
import sys

from common import ARTIFACTS, ROOT, now_iso, write_json

os.environ.setdefault("AQUAGUARD_OFFLINE", "1")
sys.path.insert(0, str(ROOT / "backend"))

from app.routers.prediction_lab import demand  # noqa: E402
from app.schemas.common import ScenarioParams  # noqa: E402
from app.services import data_access as da  # noqa: E402


def main() -> None:
    out = {"generatedAt": now_iso(), "label": "Estimated (projection)", "regions": {}}
    for r in [x for x in da.regions() if x["level"] in ("country", "division")]:
        resp = demand(region=r["id"], horizon=None, scenario=ScenarioParams())
        out["regions"][r["id"]] = {
            "method": resp.method,
            "years": [{"year": y.year, "population": y.population.value, "agricultureMcm": y.agriculture.value,
                       "domesticMcm": y.domestic.value, "industryMcm": y.industry.value, "totalMcm": y.total.value}
                      for y in resp.years],
        }
    write_json(ARTIFACTS / "demand_projection.json", out)
    print(f"demand projection for {len(out['regions'])} regions")


if __name__ == "__main__":
    main()
