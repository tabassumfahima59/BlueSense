"""GET /sources — dataset attribution with licence and retrieval time."""
from __future__ import annotations

from fastapi import APIRouter

from ..config.params import assumptions_table
from ..schemas.common import ParameterRow, Source, SourcesResponse
from ..services import data_access as da

router = APIRouter(tags=["Platform"])


@router.get("/sources", response_model=SourcesResponse)
def sources() -> SourcesResponse:
    params = [ParameterRow(key=r["key"], value=str(r["value"]), unit=str(r["unit"]), source=r["source"],
                           assumption=r["assumption"], note=r.get("note")) for r in assumptions_table()]
    return SourcesResponse(sources=[Source(**s) for s in da.sources()], parameters=params)
