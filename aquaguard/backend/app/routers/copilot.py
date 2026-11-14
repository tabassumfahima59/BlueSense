"""M8 AquaGuard Copilot endpoints.

GET  /copilot/status  configuration state (never the key), read-only tool list, rate limit
POST /copilot/stream  streamed answer (server-sent events: tool, delta, done | error)
POST /copilot/chat    the same answer as one JSON response (kept for existing clients)

Without an LLM key both POST endpoints return 503 `not_configured`: no canned or rule-based answers (decision 3).
Rate limited per client (IP address, and the browser's client id when given).
"""
from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from collections.abc import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..db import connection
from ..errors import ApiError
from ..schemas.modules import (
    CopilotReference,
    CopilotRequest,
    CopilotResponse,
    CopilotStatus,
    CopilotToolCall,
    CopilotToolInfo,
)
from ..services import copilot
from ..settings import get_settings
from .deps import region_or_404

router = APIRouter(tags=["AI Copilot"])
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def rate_limit(*keys: str) -> None:
    limit = get_settings().copilot_rate_per_min
    now = time.monotonic()
    with _lock:
        for key in keys:
            q = _hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                raise ApiError(429, "rate_limited", f"Copilot rate limit: {limit} questions per minute. Please wait "
                                                    "a moment.", headers={"Retry-After": "60"})
        for key in keys:
            _hits[key].append(now)


def _client_keys(req: CopilotRequest, request: Request) -> tuple[str, list[str]]:
    ip = request.client.host if request.client else "unknown"
    keys = [f"ip:{ip}"]
    if req.clientId:
        keys.append(f"cid:{req.clientId}")
    return f"{ip}|{req.clientId or '-'}", keys


def _prepare(req: CopilotRequest, request: Request) -> str:
    cfg = copilot.config()
    if cfg.status != "ready":
        raise ApiError(503, "not_configured", f"The Copilot is not configured: {cfg.reason} It gives no answers "
                                              "without a language model.")
    region_or_404(req.region)
    client_key, keys = _client_keys(req, request)
    rate_limit(*keys)
    return client_key


def _events(req: CopilotRequest, client_key: str) -> Iterator[dict]:
    conn = connection.connect(get_settings().db_path, read_only=True)
    try:
        yield from copilot.stream_answer(req.message, [t.model_dump() for t in req.history], conn, client_key,
                                         req.region)
    except copilot.NotConfigured as e:
        yield {"type": "error", "code": "not_configured", "detail": str(e)}
    finally:
        conn.close()


@router.get("/copilot/status", response_model=CopilotStatus)
def status() -> CopilotStatus:
    cfg = copilot.config()
    return CopilotStatus(status=cfg.status, provider=cfg.provider, model=cfg.model, reason=cfg.reason,
                         tools=[CopilotToolInfo(name=t.name, description=t.description, module=t.module)
                                for t in copilot.TOOLS],
                         rateLimitPerMin=get_settings().copilot_rate_per_min)


@router.post("/copilot/stream", responses={200: {"content": {"text/event-stream": {}}}})
def stream(req: CopilotRequest, request: Request) -> StreamingResponse:
    client_key = _prepare(req, request)

    def sse() -> Iterator[str]:
        for ev in _events(req, client_key):
            yield f"event: {ev['type']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/copilot/chat", response_model=CopilotResponse)
def chat(req: CopilotRequest, request: Request) -> CopilotResponse:
    client_key = _prepare(req, request)
    parts: list[str] = []
    done: dict | None = None
    for ev in _events(req, client_key):
        if ev["type"] == "delta":
            parts.append(ev["text"])
        elif ev["type"] == "done":
            done = ev
        elif ev["type"] == "error":
            status_code = 503 if ev["code"] in ("not_configured", "llm_unavailable", "llm_auth") else 502
            raise ApiError(429 if ev["code"] == "llm_rate_limited" else status_code, ev["code"], ev["detail"])
    tools = [CopilotToolCall(**t) for t in (done or {}).get("tools", [])]
    refs = [CopilotReference(module=t.module or "AquaGuard", label=t.name) for t in tools if t.status == "done"]
    return CopilotResponse(answer="".join(parts).strip(), mode="llm", references=refs, intent="tools",
                           tools=tools, unverifiedNumbers=(done or {}).get("unverifiedNumbers", []))
