"""Gemini adapter and Copilot usage limits. Gemini is reached through httpx.MockTransport with recorded-shape
responses; no test calls Google."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import httpx
import pytest

from app.routers import copilot as copilot_router
from app.services import copilot
from app.services import copilot_limits as cl
from app.services.copilot_limits import LIMITS, LimitError
from app.services.llm import gemini as gem
from app.settings import get_settings

KEY = "test-gemini-key-0123456789"
READY = copilot.CopilotConfig("ready", "gemini", "gemini-3.6-flash", None, "Google Gemini", gem.POLICY_URL,
                              gem.DISCLOSURE)


def sse_body(chunks: list[dict]) -> bytes:
    return "".join(f"data: {json.dumps(c)}\r\n\r\n" for c in chunks).encode()


def text_chunk(text: str, finish: str | None = None) -> dict:
    cand = {"content": {"role": "model", "parts": [{"text": text}]}}
    if finish:
        cand["finishReason"] = finish
    return {"candidates": [cand], "modelVersion": "gemini-3.6-flash-001"}


CALL_PART = {"functionCall": {"id": "c1", "name": "get_current_weather", "args": {"region": "dhaka"}},
             "thoughtSignature": "c2lnbmF0dXJlLWJ5dGVz"}


class Script:
    """A fake Gemini endpoint: each request gets the next response (status, chunks or exception)."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        status, payload = nxt
        if status != 200:
            return httpx.Response(status, json=payload)
        return httpx.Response(200, content=sse_body(payload), headers={"content-type": "text/event-stream"})

    def body(self, i: int) -> dict:
        return json.loads(self.requests[i].content)


@pytest.fixture()
def gemini(monkeypatch):
    monkeypatch.setattr(copilot, "config", lambda: READY)
    LIMITS.reset()

    def install(responses):
        script = Script(responses)
        monkeypatch.setattr(copilot, "make_provider", lambda cfg: gem.GeminiProvider(
            KEY, cfg.model, "low", 5.0, transport=httpx.MockTransport(script)))
        return script

    return install


def events_of(r) -> list[dict]:
    return [json.loads(dict(ln.split(": ", 1) for ln in c.splitlines() if ": " in ln)["data"])
            for c in r.text.strip().split("\n\n")]


def settings(monkeypatch, **kw):
    s = get_settings().model_copy(update=kw)
    monkeypatch.setattr(copilot, "get_settings", lambda: s)
    monkeypatch.setattr(copilot_router, "get_settings", lambda: s)
    return s


# ---------------------------------------------------------------- the Gemini protocol

def test_tool_loop_sends_the_key_only_in_a_header_and_returns_model_parts_unchanged(client, gemini, caplog):
    script = gemini([
        (200, [{"candidates": [{"content": {"role": "model", "parts": [CALL_PART]}, "finishReason": "STOP"}]}]),
        (200, [text_chunk("Dhaka is warm "), text_chunk("[Command Center].", "STOP")]),
    ])
    with caplog.at_level(logging.INFO):
        r = client.post("/api/copilot/stream", json={"message": "How warm is Dhaka?", "region": "dhaka"})
    ev = events_of(r)
    assert [e["type"] for e in ev][-1] == "done" and ev[-1]["provider"] == "gemini"
    assert ev[-1]["model"] == "gemini-3.6-flash-001" and ev[-1]["tools"][0]["name"] == "get_current_weather"
    assert "".join(e["text"] for e in ev if e["type"] == "delta") == "Dhaka is warm [Command Center]."
    req = script.requests[0]
    assert req.headers["x-goog-api-key"] == KEY and KEY not in str(req.url)
    assert str(req.url).endswith("/models/gemini-3.6-flash:streamGenerateContent?alt=sse")
    b0 = script.body(0)
    assert "data, not instructions" in b0["systemInstruction"]["parts"][0]["text"]
    decls = b0["tools"][0]["functionDeclarations"]
    assert {d["name"] for d in decls} == {t.name for t in copilot.TOOLS}
    assert all(d["parametersJsonSchema"]["additionalProperties"] is False for d in decls)
    assert b0["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
    assert b0["contents"][-1]["parts"][0]["text"].startswith("App context (set by AquaGuard")
    b1 = script.body(1)
    model_turn, tool_turn = b1["contents"][-2], b1["contents"][-1]
    assert model_turn == {"role": "model", "parts": [CALL_PART]}  # exactly as received, signature included
    fr = tool_turn["parts"][0]["functionResponse"]
    assert fr["id"] == "c1" and fr["name"] == "get_current_weather" and "result" in fr["response"]
    assert KEY not in caplog.text and KEY not in r.text


def test_quota_exhausted_is_an_error_without_retry_or_provider_switch(client, gemini, monkeypatch):
    switched = []
    script = gemini([(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded"}})])
    real = copilot.make_provider
    monkeypatch.setattr(copilot, "make_provider", lambda cfg: switched.append(cfg.provider) or real(cfg))
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev == [{"type": "error", "code": "quota_exhausted", "detail": gem.QUOTA_DETAIL}]
    assert len(script.requests) == 1 and switched == ["gemini"]
    script.responses.append((429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}}))
    r = client.post("/api/copilot/chat", json={"message": "q"})
    assert r.status_code == 429 and r.json()["code"] == "quota_exhausted" and "Pacific" in r.json()["detail"]
    assert switched == ["gemini", "gemini"] and len(script.requests) == 2


@pytest.mark.parametrize("response,code", [
    ((403, {"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "API key not valid"}}), "llm_auth"),
    ((404, {"error": {"code": 404, "status": "NOT_FOUND", "message": "model not found"}}), "llm_config"),
    ((400, {"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": "bad"}}), "llm_error"),
    ((200, [{"candidates": [{"content": {"parts": []}, "finishReason": "SAFETY"}]}]), "refusal"),
    ((200, [{"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}}]), "refusal"),
    ((200, [{"candidates": [{"content": {"parts": []}, "finishReason": "MALFORMED_FUNCTION_CALL"}]}]), "model_error"),
])
def test_provider_errors_are_reported_clearly(client, gemini, response, code):
    gemini([response])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert len(ev) == 1 and ev[0]["type"] == "error" and ev[0]["code"] == code and KEY not in ev[0]["detail"]


def test_unavailable_is_retried_once_then_reported(client, gemini):
    script = gemini([(503, {"error": {"code": 503, "status": "UNAVAILABLE"}}), (200, [text_chunk("ok", "STOP")])])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev[-1]["type"] == "done" and len(script.requests) == 2
    gemini([(503, {"error": {"code": 503}}), (503, {"error": {"code": 503}})])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev == [{"type": "error", "code": "llm_unavailable",
                   "detail": "The AI service is temporarily unavailable. Try again shortly."}]


def test_timeout_is_reported(client, gemini):
    gemini([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev[0]["code"] == "llm_timeout"
    gemini([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")])
    r = client.post("/api/copilot/chat", json={"message": "q"})
    assert r.status_code == 504 and r.json()["code"] == "llm_timeout"


# ---------------------------------------------------------------- usage limits

def test_site_daily_model_call_budget(client, gemini, monkeypatch):
    settings(monkeypatch, copilot_daily_model_calls=1)
    gemini([(200, [{"candidates": [{"content": {"role": "model", "parts": [CALL_PART]}, "finishReason": "STOP"}]}])])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev[-1]["code"] == "site_daily_limit"  # the second model call of the question is refused
    r = client.post("/api/copilot/stream", json={"message": "q"})
    assert r.status_code == 429 and r.json()["code"] == "site_daily_limit"


def test_daily_limit_per_client(client, gemini, monkeypatch):
    settings(monkeypatch, copilot_daily_per_client=1)
    gemini([(200, [text_chunk("ok", "STOP")])])
    assert client.post("/api/copilot/chat", json={"message": "q", "clientId": "x1"}).status_code == 200
    r = client.post("/api/copilot/chat", json={"message": "q", "clientId": "x2"})  # same IP
    assert r.status_code == 429 and r.json()["code"] == "daily_limit"


def test_concurrency_slots_and_expiry(monkeypatch):
    LIMITS.reset()
    slot = LIMITS.admit(["ip:a"], 10, 10, 10, 1)
    with pytest.raises(LimitError) as e:
        LIMITS.admit(["ip:b"], 10, 10, 10, 1)
    assert e.value.code == "busy" and e.value.status == 503
    LIMITS.release(slot)
    slot2 = LIMITS.admit(["ip:b"], 10, 10, 10, 1)
    real = cl.time.monotonic
    monkeypatch.setattr(cl.time, "monotonic", lambda: real() + cl.SLOT_TTL_S + 1)  # a disconnected visitor's slot
    LIMITS.admit(["ip:c"], 10, 10, 10, 1)  # expired slot freed
    LIMITS.release(slot2)


def test_quota_day_follows_pacific_midnight():
    assert cl.provider_day(datetime(2026, 11, 14, 7, 59, tzinfo=UTC)) == "2026-11-13"
    assert cl.provider_day(datetime(2026, 11, 14, 8, 0, tzinfo=UTC)) == "2026-11-14"  # PST = UTC-8


# ---------------------------------------------------------------- status and disclosure

def test_status_shows_provider_disclosure_and_limits_but_never_the_key(client, monkeypatch):
    from pydantic import SecretStr

    s = get_settings().model_copy(update={"gemini_api_key": SecretStr(KEY), "llm_provider": "gemini",
                                          "llm_model": None})
    monkeypatch.setattr(copilot, "get_settings", lambda: s)
    j = client.get("/api/copilot/status").json()
    assert j["status"] == "ready" and j["provider"] == "gemini" and j["providerLabel"] == "Google Gemini"
    assert j["model"] == "gemini-3.6-flash" and j["policyUrl"].startswith("https://")
    assert "Do not enter personal or sensitive information" in j["disclosure"] and "18" in j["disclosure"]
    assert j["limits"]["perMinute"] >= 1 and "Pacific" in j["limits"]["resetsAt"]
    assert KEY not in json.dumps(j) and KEY not in client.get("/api/health").text
