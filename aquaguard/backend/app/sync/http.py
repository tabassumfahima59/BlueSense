"""Reusable HTTP client for data-source adapters (httpx, synchronous).

* Separate connect / read / write / pool timeouts.
* Retries with exponential backoff and full jitter on transient failures only:
  timeouts, network errors, remote protocol errors and HTTP 408, 425, 429, 500, 502, 503, 504.
* ``Retry-After`` (seconds or HTTP-date) is honoured, capped at ``retry_after_max`` seconds.
* Other 4xx responses fail immediately (no retry).
* Safe logging: method, host + path, status or error class, attempt and delay only. Query values of
  credential-like parameters are redacted; headers and bodies are never logged.
* One pooled ``httpx.Client`` per instance; use as a context manager or call ``close()``.
"""
from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

log = logging.getLogger("aquaguard.http")
# httpx/httpcore log every request at INFO with the full URL, query values included (an API key passed as a query
# parameter would be written to the logs). This module logs redacted URLs itself, so theirs stay at WARNING.
for _name in ("httpx", "httpcore"):
    logging.getLogger(_name).setLevel(logging.WARNING)

RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})
RETRYABLE_EXCEPTIONS = (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)
SENSITIVE_KEYS = ("key", "token", "secret", "password", "signature", "auth", "apikey", "api_key", "credential")
USER_AGENT = "AquaGuard/0.2 (water decision-support prototype)"


class HttpError(RuntimeError):
    """A request failed permanently (non-retryable status, or retries exhausted)."""

    def __init__(self, message: str, *, status: int | None = None, url: str = "", attempts: int = 0):
        super().__init__(message)
        self.status = status
        self.url = url
        self.attempts = attempts


@dataclass(frozen=True)
class RetryPolicy:
    max_retries: int = 4
    backoff_base: float = 1.0
    backoff_max: float = 60.0
    retry_after_max: float = 300.0


def _host(parts) -> str:
    """host[:port] without user-info (credentials in the URL are never logged)."""
    host = parts.hostname or ""
    return f"{host}:{parts.port}" if parts.port else host


def redact_url(url: str) -> str:
    """Return scheme://host[:port]/path?query with credential-like query values replaced by ***."""
    parts = urlsplit(str(url))
    query = [(k, "***" if any(s in k.lower() for s in SENSITIVE_KEYS) else v)
             for k, v in parse_qsl(parts.query, keep_blank_values=True)]
    return urlunsplit((parts.scheme, _host(parts), parts.path, urlencode(query, safe="*,"), ""))


def short_url(url: str) -> str:
    """scheme://host[:port]/path without query or credentials — used in error messages stored in sync_runs."""
    parts = urlsplit(str(url))
    return urlunsplit((parts.scheme, _host(parts), parts.path, "", ""))


def parse_retry_after(value: str | None, now: datetime | None = None) -> float | None:
    """Seconds to wait from a Retry-After header (delta-seconds or HTTP-date); None when absent/invalid."""
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return max(0.0, (when - now).total_seconds())


class HttpClient:
    def __init__(self, *, connect_timeout: float = 10.0, read_timeout: float = 60.0,
                 policy: RetryPolicy | None = None, transport: httpx.BaseTransport | None = None,
                 sleep: Callable[[float], None] = time.sleep, rng: Callable[[], float] = random.random,
                 user_agent: str = USER_AGENT):
        self.policy = policy or RetryPolicy()
        self._sleep = sleep
        self._rng = rng
        self._client = httpx.Client(
            timeout=httpx.Timeout(read_timeout, connect=connect_timeout, write=read_timeout, pool=connect_timeout),
            headers={"User-Agent": user_agent}, transport=transport, follow_redirects=True)

    @classmethod
    def from_settings(cls, settings=None, **kwargs) -> HttpClient:
        if settings is None:
            from ..settings import get_settings

            settings = get_settings()
        policy = RetryPolicy(max_retries=settings.http_max_retries, backoff_base=settings.http_backoff_base_s,
                             backoff_max=settings.http_backoff_max_s, retry_after_max=settings.http_retry_after_max_s)
        return cls(connect_timeout=settings.http_connect_timeout_s, read_timeout=settings.http_read_timeout_s,
                   policy=policy, **kwargs)

    # ---------------------------------------------------------------- lifecycle
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> HttpClient:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ---------------------------------------------------------------- requests
    def backoff_delay(self, attempt: int) -> float:
        """Full-jitter exponential backoff for retry number ``attempt`` (0-based)."""
        cap = min(self.policy.backoff_max, self.policy.backoff_base * (2 ** attempt))
        return cap * self._rng()

    def request(self, method: str, url: str, *, params: dict[str, Any] | None = None,
                headers: dict[str, str] | None = None) -> httpx.Response:
        full = httpx.URL(url)
        if params:
            full = full.copy_merge_params(params)
        safe = redact_url(str(full))
        brief = short_url(str(full))
        last_error: str = ""
        for attempt in range(self.policy.max_retries + 1):
            try:
                response = self._client.request(method, url, params=params, headers=headers)
            except RETRYABLE_EXCEPTIONS as exc:
                last_error = type(exc).__name__
                if attempt >= self.policy.max_retries:
                    break
                delay = self.backoff_delay(attempt)
                log.warning("%s %s failed (%s); retry %d/%d in %.1fs", method, safe, last_error, attempt + 1,
                            self.policy.max_retries, delay)
                self._sleep(delay)
                continue
            except httpx.HTTPError as exc:  # invalid URL, unsupported protocol, ...: not retryable
                raise HttpError(f"{method} {brief} failed: {type(exc).__name__}", url=safe,
                                attempts=attempt + 1) from None

            if response.status_code < 400:
                if attempt:
                    log.info("%s %s succeeded after %d retries", method, safe, attempt)
                return response
            if response.status_code not in RETRYABLE_STATUS:
                raise HttpError(f"HTTP {response.status_code} from {method} {brief}", status=response.status_code,
                                url=safe, attempts=attempt + 1)
            last_error = f"HTTP {response.status_code}"
            if attempt >= self.policy.max_retries:
                break
            retry_after = parse_retry_after(response.headers.get("Retry-After"))
            delay = (min(retry_after, self.policy.retry_after_max) if retry_after is not None
                     else self.backoff_delay(attempt))
            log.warning("%s %s returned %s; retry %d/%d in %.1fs%s", method, safe, last_error, attempt + 1,
                        self.policy.max_retries, delay, " (Retry-After)" if retry_after is not None else "")
            self._sleep(delay)
        raise HttpError(f"{last_error} from {method} {brief} after {self.policy.max_retries + 1} attempts",
                        url=safe, attempts=self.policy.max_retries + 1)

    def get(self, url: str, **kwargs) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def head(self, url: str, **kwargs) -> httpx.Response:
        return self.request("HEAD", url, **kwargs)

    def get_json(self, url: str, **kwargs) -> Any:
        response = self.get(url, **kwargs)
        try:
            return response.json()
        except ValueError as exc:
            raise HttpError(f"invalid JSON from GET {short_url(url)}", status=response.status_code,
                            url=redact_url(url)) from exc

    def download(self, url: str, dest, *, max_bytes: int, chunk_size: int = 1 << 20) -> int:
        """Stream a large file to ``dest`` (same retry rules as ``request``). Returns bytes written.
        A partial file is removed on failure; responses larger than ``max_bytes`` are rejected."""
        from pathlib import Path

        dest = Path(dest)
        safe = redact_url(url)
        brief = short_url(url)
        last_error = ""
        for attempt in range(self.policy.max_retries + 1):
            written = 0
            try:
                with self._client.stream("GET", url) as response:
                    if response.status_code >= 400:
                        if response.status_code not in RETRYABLE_STATUS:
                            raise HttpError(f"HTTP {response.status_code} from GET {brief}",
                                            status=response.status_code, url=safe, attempts=attempt + 1)
                        last_error = f"HTTP {response.status_code}"
                        retry_after = parse_retry_after(response.headers.get("Retry-After"))
                    else:
                        declared = int(response.headers.get("Content-Length") or 0)
                        if declared > max_bytes:
                            raise HttpError(f"GET {brief} is {declared} bytes (limit {max_bytes})", url=safe)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        with open(dest, "wb") as fh:
                            for chunk in response.iter_bytes(chunk_size):
                                written += len(chunk)
                                if written > max_bytes:
                                    raise HttpError(f"GET {brief} exceeded {max_bytes} bytes", url=safe)
                                fh.write(chunk)
                        return written
            except RETRYABLE_EXCEPTIONS as exc:
                last_error = type(exc).__name__
                retry_after = None
            except HttpError:
                dest.unlink(missing_ok=True)
                raise
            dest.unlink(missing_ok=True)
            if attempt >= self.policy.max_retries:
                break
            delay = (min(retry_after, self.policy.retry_after_max) if retry_after is not None
                     else self.backoff_delay(attempt))
            log.warning("GET %s download failed (%s); retry %d/%d in %.1fs", safe, last_error, attempt + 1,
                        self.policy.max_retries, delay)
            self._sleep(delay)
        raise HttpError(f"{last_error} from GET {brief} (download) after {self.policy.max_retries + 1} attempts",
                        url=safe, attempts=self.policy.max_retries + 1)
