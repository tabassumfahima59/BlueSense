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
from app.services.llm.base import LLMError
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
            for c in r.text.strip().split("\n\n") if "data: " in c]


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
    assert b0["contents"][-1]["parts"][0]["text"].startswith("App context (set by BlueSense")
    b1 = script.body(1)
    model_turn, tool_turn = b1["contents"][-2], b1["contents"][-1]
    assert model_turn == {"role": "model", "parts": [CALL_PART]}  # exactly as received, signature included
    fr = tool_turn["parts"][0]["functionResponse"]
    assert fr["id"] == "c1" and fr["name"] == "get_current_weather" and "result" in fr["response"]
    assert fr["response"]["result"]["aquaguardModule"] == "Command Center"  # so the model cites the right module
    assert "No Markdown headings" in b0["systemInstruction"]["parts"][0]["text"]
    assert KEY not in caplog.text and KEY not in r.text


def test_quota_exhausted_is_an_error_without_retry_or_provider_switch(client, gemini, monkeypatch):
    switched = []
    script = gemini([(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded"}})])
    real = copilot.make_provider
    monkeypatch.setattr(copilot, "make_provider", lambda cfg: switched.append(cfg.provider) or real(cfg))
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev == [{"type": "error", "code": "quota_exhausted",
                   "detail": f"Gemini HTTP 429 RESOURCE_EXHAUSTED: Quota exceeded\n{gem.QUOTA_DETAIL}"}]
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
    if response[0] >= 400:
        assert f"Gemini HTTP {response[0]}" in ev[0]["detail"]
        assert response[1]["error"]["message"] in ev[0]["detail"]


def test_unavailable_is_retried_once_then_reported(client, gemini):
    script = gemini([(503, {"error": {"code": 503, "status": "UNAVAILABLE"}}), (200, [text_chunk("ok", "STOP")])])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev[-1]["type"] == "done" and len(script.requests) == 2
    gemini([(503, {"error": {"code": 503}}), (503, {"error": {"code": 503}})])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev == [{"type": "error", "code": "llm_unavailable",
                   "detail": "Gemini HTTP 503\nThe AI service is temporarily unavailable. Try again shortly."}]


def test_timeout_is_reported(client, gemini):
    gemini([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")])
    ev = events_of(client.post("/api/copilot/stream", json={"message": "q"}))
    assert ev[0]["code"] == "llm_timeout"
    gemini([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")])
    r = client.post("/api/copilot/chat", json={"message": "q"})
    assert r.status_code == 504 and r.json()["code"] == "llm_timeout"


def test_connection_failures_are_logged_without_secret_details(client, gemini, caplog, monkeypatch):
    monkeypatch.setattr(gem.time, "sleep", lambda _: None)
    script = gemini([httpx.ConnectError(f"connection failed with key {KEY}") for _ in range(2)])
    with caplog.at_level(logging.WARNING):
        r = client.post("/api/copilot/stream", json={"message": "q"})
    assert events_of(r)[0]["code"] == "llm_unavailable"
    assert len(script.requests) == 2
    assert "ConnectError" in caplog.text and "attempt 2/2" in caplog.text
    assert KEY not in caplog.text and KEY not in r.text


def test_provider_error_logs_redact_the_key(client, gemini, caplog):
    gemini([(403, {"error": {"status": "PERMISSION_DENIED", "message": f"Rejected key {KEY}"}})])
    with caplog.at_level(logging.WARNING):
        r = client.post("/api/copilot/stream", json={"message": "q"})
    assert events_of(r)[0]["code"] == "llm_auth"
    assert "[redacted]" in caplog.text and KEY not in caplog.text


@pytest.mark.parametrize("partial", [False, True])
def test_read_timeout_retries_only_before_text_is_delivered(monkeypatch, partial):
    monkeypatch.setattr(gem.time, "sleep", lambda _: None)

    class InterruptedStream(httpx.SyncByteStream):
        closed = False

        def __iter__(self):
            if partial:
                yield sse_body([text_chunk("Partial answer")])
            raise httpx.ReadTimeout("first streamed content stalled")

        def close(self):
            self.closed = True

    interrupted = InterruptedStream()
    requests = []

    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, stream=interrupted)
        return httpx.Response(200, content=sse_body([text_chunk("Recovered", "STOP")]))

    provider = gem.GeminiProvider(KEY, READY.model, transport=httpx.MockTransport(respond))
    try:
        stream = provider.stream_turn("system", [], [], 128)
        if partial:
            assert next(stream) == "Partial answer"
            with pytest.raises(LLMError, match="stopped responding"):
                next(stream)
            assert len(requests) == 1
        else:
            items = list(stream)
            assert items[0] == "Recovered" and items[-1].stop == "end"
            assert len(requests) == 2
        assert interrupted.closed
    finally:
        provider.close()


def test_retry_timeout_is_capped_by_whole_answer_deadline(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(gem.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(gem.time, "sleep", lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    timeouts = []

    def respond(request):
        timeouts.append(request.extensions["timeout"])
        clock[0] += 3
        raise httpx.ReadTimeout("slow")

    provider = gem.GeminiProvider(KEY, READY.model, timeout_s=60, deadline_s=5,
                                transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(LLMError):
            list(provider.stream_turn("system", [], [], 128))
        assert [t["read"] for t in timeouts] == [5, 1]
        assert all(t["connect"] <= t["read"] for t in timeouts)
    finally:
        provider.close()


# ---------------------------------------------------------------- usage limits

@pytest.mark.parametrize("header,info,expected", [
    ("2", None, 2),
    (None, "3.5s", 3.5),
    ("2", "4s", 4),
    ("invalid", "invalid", None),
    (None, "NaNs", None),
    (None, "-1s", None),
])
def test_quota_retry_uses_provider_delay(monkeypatch, header, info, expected):
    sleeps = []
    monkeypatch.setattr(gem.time, "sleep", sleeps.append)
    requests = []

    def respond(request):
        requests.append(request)
        if len(requests) > 1:
            return httpx.Response(200, content=sse_body([text_chunk("Recovered", "STOP")]))
        details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": info}] if info else []
        return httpx.Response(429, headers={"Retry-After": header} if header else {},
                              json={"error": {"status": "RESOURCE_EXHAUSTED", "details": details}})

    provider = gem.GeminiProvider(KEY, READY.model, transport=httpx.MockTransport(respond))
    try:
        if expected is None:
            with pytest.raises(LLMError) as error:
                list(provider.stream_turn("system", [], [], 128))
            assert error.value.code == "quota_exhausted"
            assert sleeps == [] and len(requests) == 1
        else:
            assert list(provider.stream_turn("system", [], [], 128))[0] == "Recovered"
            assert sleeps == [expected] and len(requests) == 2
    finally:
        provider.close()


@pytest.mark.parametrize("max_wait,deadline,delay", [(0, 240, "0"), (5, 240, "6"), (60, 3, "3")])
def test_quota_wait_is_bounded(monkeypatch, max_wait, deadline, delay):
    sleeps = []
    monkeypatch.setattr(gem.time, "sleep", sleeps.append)
    transport = httpx.MockTransport(lambda request: httpx.Response(
        429, headers={"Retry-After": delay}, json={"error": {"status": "RESOURCE_EXHAUSTED"}}))
    provider = gem.GeminiProvider(KEY, READY.model, transport=transport, deadline_s=deadline,
                                retry_after_max_s=max_wait)
    try:
        with pytest.raises(LLMError) as error:
            list(provider.stream_turn("system", [], [], 128))
        assert error.value.code == "quota_exhausted" and sleeps == []
    finally:
        provider.close()


@pytest.mark.parametrize("max_retries,expected_sleeps", [(0, []), (3, [2, 4, 8])])
def test_configurable_retry_budget_and_exponential_backoff(monkeypatch, max_retries, expected_sleeps):
    sleeps, requests = [], []
    monkeypatch.setattr(gem.time, "sleep", sleeps.append)

    def respond(request):
        requests.append(request)
        return httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}})

    provider = gem.GeminiProvider(KEY, READY.model, transport=httpx.MockTransport(respond),
                                max_retries=max_retries, retry_backoff_s=2)
    try:
        with pytest.raises(LLMError):
            list(provider.stream_turn("system", [], [], 128))
        assert sleeps == expected_sleeps and len(requests) == max_retries + 1
    finally:
        provider.close()


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
