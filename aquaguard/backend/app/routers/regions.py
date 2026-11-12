"""GET /regions — country, divisions and districts with centroids."""
from __future__ import annotations

from fastapi import APIRouter

from ..schemas.common import RegionsResponse
from ..services import data_access as da
from .deps import to_region

router = APIRouter(tags=["Platform"])


@router.get("/regions", response_model=RegionsResponse)
def regions() -> RegionsResponse:
    regs = da.regions()
    country = next(r for r in regs if r["level"] == "country")
    return RegionsResponse(
        country=to_region(country),
        divisions=[to_region(r) for r in sorted(regs, key=lambda r: r["name"]) if r["level"] == "division"],
        districts=[to_region(r) for r in sorted(regs, key=lambda r: (r["parent_id"] or "", r["name"]))
                   if r["level"] == "district"])

