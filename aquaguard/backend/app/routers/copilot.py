"""AquaGuard Copilot endpoints (provider-independent).

GET  /copilot/status  configuration state (never a key), provider, model, data-use disclosure, tools, limits
POST /copilot/stream  streamed answer (server-sent events: tool, delta, done | error)
POST /copilot/chat    the same answer as one JSON response (kept for existing clients)

Without a key both POST endpoints return 503 `not_configured`: no canned or rule-based answers (decision 3).
Limits per client (real IP address, and the browser client id when given), per site and day (model calls), and on
concurrent questions protect the provider's free quota. Provider errors (quota used up, unavailable, timeout) are
returned as errors; there is no switch to another provider.
"""
from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..db import connection
from ..errors import ApiError
from ..schemas.modules import (
    CopilotLimits,
    CopilotReference,
    CopilotRequest,
    CopilotResponse,
    CopilotStatus,
    CopilotToolCall,
    CopilotToolInfo,
)
from ..services import copilot
from ..services.copilot_limits import LIMITS, RESET_NOTE, LimitError
from ..settings import get_settings
from .deps import region_or_404

router = APIRouter(tags=["AI Copilot"])

ERROR_STATUS = {"not_configured": 503, "llm_unavailable": 503, "llm_auth": 503, "llm_config": 503,
                "quota_exhausted": 429, "llm_rate_limited": 429, "site_daily_limit": 429, "llm_timeout": 504}


def _client_keys(req: CopilotRequest, request: Request) -> tuple[str, list[str]]:
    # behind a proxy (Render) uvicorn runs with --proxy-headers, so client.host is the visitor's address
    ip = request.client.host if request.client else "unknown"
    keys = [f"ip:{ip}"]
    if req.clientId:
        keys.append(f"cid:{req.clientId}")
    return f"{ip}|{req.clientId or '-'}", keys


def _prepare(req: CopilotRequest, request: Request) -> tuple[str, int]:
    """Check configuration, region and limits; on success a concurrency slot is held (released by _events)."""
    cfg = copilot.config()
    if cfg.status != "ready":
        raise ApiError(503, "not_configured", f"The Copilot is not configured: {cfg.reason} It gives no answers "
                                              "without a language model.")
    region_or_404(req.region)
    client_key, keys = _client_keys(req, request)
    s = get_settings()
    try:
        slot = LIMITS.admit(keys, s.copilot_rate_per_min, s.copilot_daily_per_client, s.copilot_daily_model_calls,
                            s.copilot_max_concurrent)
    except LimitError as e:
        raise ApiError(e.status, e.code, e.detail,
                       headers={"Retry-After": str(e.retry_after)} if e.retry_after else None) from None
    return client_key, slot


def _events(req: CopilotRequest, client_key: str, slot: int) -> Iterator[dict]:
    """Run one question; always releases the concurrency slot taken by _prepare."""
    site_calls = get_settings().copilot_daily_model_calls
    conn = None
    try:
        conn = connection.connect(get_settings().db_path, read_only=True)
        yield from copilot.stream_answer(req.message, [t.model_dump() for t in req.history], conn, client_key,
                                         req.region, take_model_call=lambda: LIMITS.take_model_call(site_calls),
                                         map_context=req.context.model_dump() if req.context else None)
    except copilot.NotConfigured as e:
        yield {"type": "error", "code": "not_configured", "detail": str(e)}
    finally:
        if conn is not None:
            conn.close()
        LIMITS.release(slot)


@router.get("/copilot/status", response_model=CopilotStatus)
def status() -> CopilotStatus:
    cfg = copilot.config()
    s = get_settings()
    snap = LIMITS.snapshot()
    return CopilotStatus(
        status=cfg.status, provider=cfg.provider, providerLabel=cfg.label or cfg.provider, model=cfg.model,
        reason=cfg.reason, disclosure=cfg.disclosure, policyUrl=cfg.policy_url,
        tools=[CopilotToolInfo(name=t.name, description=t.description, module=t.module) for t in copilot.TOOLS],
        rateLimitPerMin=s.copilot_rate_per_min,
        limits=CopilotLimits(perMinute=s.copilot_rate_per_min, perDay=s.copilot_daily_per_client,
                             siteModelCallsPerDay=s.copilot_daily_model_calls,
                             siteModelCallsUsedToday=snap["modelCallsToday"], maxConcurrent=s.copilot_max_concurrent,
                             maxModelCallsPerQuestion=s.copilot_max_model_calls, resetsAt=RESET_NOTE))


@router.post("/copilot/stream", responses={200: {"content": {"text/event-stream": {}}}})
def stream(req: CopilotRequest, request: Request) -> StreamingResponse:
    client_key, slot = _prepare(req, request)

    def sse() -> Iterator[str]:
        events = _events(req, client_key, slot)
        try:
            for ev in events:
                yield f"event: {ev['type']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
        finally:
            events.close()

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/copilot/chat", response_model=CopilotResponse)
def chat(req: CopilotRequest, request: Request) -> CopilotResponse:
    client_key, slot = _prepare(req, request)
    parts: list[str] = []
    done: dict | None = None
    events = _events(req, client_key, slot)
    try:
        for ev in events:
            if ev["type"] == "delta":
                parts.append(ev["text"])
            elif ev["type"] == "done":
                done = ev
            elif ev["type"] == "error":
                raise ApiError(ERROR_STATUS.get(ev["code"], 502), ev["code"], ev["detail"])
    finally:
        events.close()
    tools = [CopilotToolCall(**t) for t in (done or {}).get("tools", [])]
    refs = [CopilotReference(module=t.module or "AquaGuard", label=t.name) for t in tools if t.status == "done"]
    return CopilotResponse(answer="".join(parts).strip(), mode="llm", references=refs, intent="tools",
                           tools=tools, unverifiedNumbers=(done or {}).get("unverifiedNumbers", []))
