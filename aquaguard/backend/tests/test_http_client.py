"""P1: reusable HTTP client — success, timeouts, retries, Retry-After, non-retryable errors, safe logging."""
import logging
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest

from app.sync.http import HttpClient, HttpError, RetryPolicy, parse_retry_after, redact_url


def make(handler, **kw):
    sleeps: list[float] = []
    client = HttpClient(transport=httpx.MockTransport(handler), sleep=sleeps.append, rng=lambda: 0.5,
                        policy=RetryPolicy(max_retries=kw.pop("retries", 3), backoff_base=1.0, backoff_max=8.0,
                                           retry_after_max=30.0), **kw)
    return client, sleeps


def test_success_returns_json():
    client, sleeps = make(lambda req: httpx.Response(200, json={"ok": True}))
    with client:
        assert client.get_json("https://example.org/data", params={"a": 1}) == {"ok": True}
    assert sleeps == []


def test_timeout_is_retried_with_backoff():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json={"n": calls["n"]})

    client, sleeps = make(handler)
    assert client.get_json("https://example.org/x") == {"n": 3}
    assert sleeps == [0.5, 1.0]  # full jitter (rng=0.5) of 1, 2 seconds


def test_server_errors_retried_then_exhausted():
    client, sleeps = make(lambda req: httpx.Response(503), retries=2)
    with pytest.raises(HttpError) as exc:
        client.get("https://example.org/x")
    assert exc.value.attempts == 3 and len(sleeps) == 2


def test_retry_after_seconds_is_honoured():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "7"}) if calls["n"] == 1 else httpx.Response(200, json=1)

    client, sleeps = make(handler)
    assert client.get_json("https://example.org/x") == 1
    assert sleeps == [7.0]


def test_retry_after_is_capped():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(503, headers={"Retry-After": "3600"}) if calls["n"] == 1 else httpx.Response(200, json=1)

    client, sleeps = make(handler)
    client.get_json("https://example.org/x")
    assert sleeps == [30.0]


def test_retry_after_http_date():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert parse_retry_after(format_datetime(now + timedelta(seconds=20), usegmt=True), now=now) == pytest.approx(20)
    assert parse_retry_after("garbage") is None
    assert parse_retry_after(None) is None


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_non_retryable_status_fails_immediately(status):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(status)

    client, sleeps = make(handler)
    with pytest.raises(HttpError) as exc:
        client.get("https://example.org/x")
    assert exc.value.status == status and calls["n"] == 1 and sleeps == []


def test_unsupported_protocol_is_not_retried():
    calls = {"n": 0}

    def handler(request):  # what httpx raises for a scheme it has no transport for
        calls["n"] += 1
        raise httpx.UnsupportedProtocol("Request URL has an unsupported protocol 'ftp://'.", request=request)

    client, sleeps = make(handler)
    with pytest.raises(HttpError):
        client.get("ftp://example.org/x")
    assert calls["n"] == 1 and sleeps == []


def test_params_are_sent_and_logged_redacted(caplog):
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(500)

    client, _ = make(handler, retries=1)
    with caplog.at_level(logging.WARNING, logger="aquaguard.http"), pytest.raises(HttpError):
        client.get("https://example.org/f", params={"latitude": 23.8, "token": "T0KEN"})
    assert "token=T0KEN" in seen["url"]          # the real request carries the value
    assert "T0KEN" not in caplog.text and "token=***" in caplog.text


def test_safe_logging_redacts_credentials(caplog):
    client, _ = make(lambda req: httpx.Response(503), retries=1)
    with caplog.at_level(logging.WARNING, logger="aquaguard.http"):
        with pytest.raises(HttpError) as exc:
            client.get("https://api.example.org/v1?latitude=23.8&apikey=SUPERSECRET123",
                       headers={"Authorization": "Bearer HEADERSECRET"})
    text = caplog.text + str(exc.value)
    assert "SUPERSECRET123" not in text and "HEADERSECRET" not in text
    assert "latitude=23.8" in text and "apikey=***" in text


def test_redact_url():
    assert redact_url("https://h/p?token=abc&x=1") == "https://h/p?token=***&x=1"
    assert "user:pass" not in redact_url("https://user:pass@h/p")
    assert redact_url("http://user:pw@127.0.0.1:9/v1?apikey=k") == "http://127.0.0.1:9/v1?apikey=***"


def test_from_settings_uses_configured_timeouts():
    from app.settings import get_settings

    client = HttpClient.from_settings(get_settings(), transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    s = get_settings()
    assert client.policy.max_retries == s.http_max_retries
    assert client._client.timeout.connect == s.http_connect_timeout_s
    assert client._client.timeout.read == s.http_read_timeout_s
    client.close()


def test_library_request_logs_never_contain_query_secrets(caplog):
    """httpx logs full URLs at INFO; the client keeps those loggers at WARNING so keys never reach the logs."""
    client, _ = make(lambda req: httpx.Response(200, json={}))
    with caplog.at_level(logging.DEBUG):
        client.get_json("https://api.example.org/v1", params={"latitude": 23.8, "apikey": "LIBRARYSECRET"})
    assert "LIBRARYSECRET" not in caplog.text
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
