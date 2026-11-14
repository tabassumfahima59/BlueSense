"""Copilot usage limits that protect the AI provider's free quota.

* per client (real IP address and browser client id): questions per minute and per day
* whole site: model calls per day, counted on the provider's quota day (midnight Pacific time)
* concurrency: questions answered at the same time

Counters live in memory (one API worker). Free hosting that restarts or sleeps resets them; the provider's own quota
remains the hard limit and its "quota used up" answer is shown to the user as such.
"""
from __future__ import annotations

import itertools
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from zoneinfo import ZoneInfo

PROVIDER_DAY_TZ = ZoneInfo("America/Los_Angeles")  # Gemini daily quotas reset at midnight Pacific time
SLOT_TTL_S = 300  # a slot whose question never finished (e.g. the visitor disconnected) is freed after this
RESET_NOTE = "midnight Pacific time (about 1-2 pm in Bangladesh)"


class LimitError(Exception):
    def __init__(self, status: int, code: str, detail: str, retry_after: int | None = None):
        super().__init__(detail)
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after


def provider_day(now: datetime | None = None) -> str:
    return (now or datetime.now(PROVIDER_DAY_TZ)).astimezone(PROVIDER_DAY_TZ).date().isoformat()


class Limits:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._minute: dict[str, deque] = defaultdict(deque)
        self._daily: dict[str, int] = defaultdict(int)
        self._model_calls = 0
        self._day = provider_day()
        self._slots: dict[int, float] = {}
        self._ids = itertools.count(1)

    def reset(self) -> None:
        with self._lock:
            self._minute.clear()
            self._daily.clear()
            self._model_calls = 0
            self._day = provider_day()
            self._slots.clear()

    def _roll_day(self) -> None:
        today = provider_day()
        if today != self._day:
            self._day = today
            self._daily.clear()
            self._model_calls = 0

    def admit(self, keys: list[str], per_minute: int, per_day: int, site_calls: int, max_concurrent: int) -> int:
        """Count one question for every key and take a concurrency slot (returns its id), or raise LimitError
        (nothing counted)."""
        now = time.monotonic()
        with self._lock:
            for sid, started in list(self._slots.items()):
                if now - started > SLOT_TTL_S:
                    del self._slots[sid]
            self._roll_day()
            if self._model_calls >= site_calls:
                raise LimitError(429, "site_daily_limit", "The Copilot has reached today's site-wide limit, which "
                                 f"protects the free AI quota. It resets at {RESET_NOTE}.")
            for key in keys:
                q = self._minute[key]
                while q and now - q[0] > 60:
                    q.popleft()
                if len(q) >= per_minute:
                    raise LimitError(429, "rate_limited", f"Copilot limit: {per_minute} questions per minute. "
                                     "Please wait a moment.", retry_after=60)
                if self._daily[key] >= per_day:
                    raise LimitError(429, "daily_limit", f"You have reached today's Copilot limit of {per_day} "
                                     f"questions. It resets at {RESET_NOTE}.")
            if len(self._slots) >= max_concurrent:
                raise LimitError(503, "busy", "The Copilot is answering other questions. Try again in a few seconds.",
                                 retry_after=5)
            for key in keys:
                self._minute[key].append(now)
                self._daily[key] += 1
            slot = next(self._ids)
            self._slots[slot] = now
            return slot

    def release(self, slot: int) -> None:
        with self._lock:
            self._slots.pop(slot, None)

    def take_model_call(self, site_calls: int) -> bool:
        with self._lock:
            self._roll_day()
            if self._model_calls >= site_calls:
                return False
            self._model_calls += 1
            return True

    def snapshot(self) -> dict:
        with self._lock:
            self._roll_day()
            return {"day": self._day, "modelCallsToday": self._model_calls, "active": len(self._slots)}


LIMITS = Limits()
