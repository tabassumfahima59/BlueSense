"""Slow synchronous model I/O must not prevent SSE keepalives or resource cleanup."""
import time
from threading import Event

import anyio

from app.routers.copilot import _sse


def test_slow_provider_sends_keepalives_and_closes_generator():
    closed = Event()

    def events():
        try:
            time.sleep(0.05)
            yield {"type": "done"}
        finally:
            closed.set()

    async def collect():
        return [chunk async for chunk in _sse(events(), heartbeat_s=0.005)]

    chunks = anyio.run(collect)
    assert chunks[0] == ": connected\n\n"
    assert ": keepalive\n\n" in chunks
    assert chunks[-1].startswith("event: done\n")
    assert closed.is_set()


def test_disconnection_closes_worker_generator():
    entered, release, closed = Event(), Event(), Event()

    def events():
        try:
            entered.set()
            release.wait(timeout=2)
            yield {"type": "done"}
        finally:
            closed.set()

    async def consume():
        async for _ in _sse(events(), heartbeat_s=0.005):
            pass

    async def disconnect():
        async with anyio.create_task_group() as group:
            group.start_soon(consume)
            with anyio.fail_after(2):
                while not entered.is_set():
                    await anyio.sleep(0.001)
            group.cancel_scope.cancel()
        release.set()
        with anyio.fail_after(2):
            while not closed.is_set():
                await anyio.sleep(0.001)

    anyio.run(disconnect)
