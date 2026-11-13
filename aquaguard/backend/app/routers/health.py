"""GET /health — status and data freshness. ``sampleMode`` is always False (no sample fallback since P2)."""
from __future__ import annotations

from fastapi import APIRouter

from ..schemas.common import StatusResponse
from ..services import data_access as da
from ..services import ml_artifacts as mla
from ..settings import get_settings

router = APIRouter(tags=["Platform"])
VERSION = "0.1.0"


@router.get("/health", response_model=StatusResponse)
def health() -> StatusResponse:
    s = get_settings()
    period = da.data_period()
    freshness = {
        "weatherArchiveTo": period["to"],
        "weatherRetrievedAt": da.retrieved_at("openmeteo_archive"),
        "aquastatRetrievedAt": da.retrieved_at("fao_aquastat"),
        "graceRetrievedAt": da.retrieved_at("grace_csr"),
        "modelsTrainedAt": (mla.model_meta() or {}).get("trainedAt"),
    }
    has_data = not da.table("weather_monthly").df.empty
    return StatusResponse(status="ok" if has_data else "degraded", sampleMode=False, dataFreshness=freshness,
                          llmEnabled=bool(s.llm_api_key and s.llm_model), version=VERSION)

