"""M8 AquaGuard AI Copilot: /copilot/chat (rate limited per client IP)."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

from ..schemas.modules import CopilotReference, CopilotRequest, CopilotResponse
from ..services import copilot
from ..settings import get_settings
from .deps import region_or_404

router = APIRouter(tags=["AI Copilot"])
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def rate_limit(ip: str) -> None:
    limit = get_settings().copilot_rate_per_min
    now = time.monotonic()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(status_code=429, detail=f"Copilot rate limit: {limit} requests per minute. "
                                                        "Please wait a moment.")
        q.append(now)


@router.post("/copilot/chat", response_model=CopilotResponse)
def chat(req: CopilotRequest, request: Request) -> CopilotResponse:
    rate_limit(request.client.host if request.client else "unknown")
    region_or_404(req.region)
    out = copilot.answer(req.message, req.region, req.scenario, [t.model_dump() for t in req.history])
    return CopilotResponse(answer=out["answer"], mode=out["mode"], intent=out["intent"],
                           references=[CopilotReference(**r) for r in out["references"]])
