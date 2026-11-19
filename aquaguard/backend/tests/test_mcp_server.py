"""bluesense-mcp: lists exactly the Copilot's tools (14 data tools + search_docs) with the same schemas, marks them
read-only, and runs calls through copilot.run_tool. Uses the MCP SDK's in-memory client (real protocol messages,
no subprocess). Skipped when the optional ``mcp`` package (bluesense_mcp/requirements.txt) is not installed."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import anyio
import pytest

pytest.importorskip("mcp")
from mcp import Client  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # aquaguard/, which contains bluesense_mcp
from app.services import copilot  # noqa: E402
from bluesense_mcp import server as mcp_server  # noqa: E402


def _with_client(fn):
    async def run():
        async with Client(mcp_server.build_server()) as client:
            return await fn(client)
    return anyio.run(run)


def test_mcp_lists_the_copilot_tools_plus_search_docs_as_read_only():
    tools = _with_client(lambda c: c.list_tools()).tools
    assert len(tools) == len(copilot.TOOLS) == 15
    assert {t.name for t in tools} == {t.name for t in copilot.TOOLS}
    assert "search_docs" in {t.name for t in tools}
    specs = {s.name: s for s in copilot.tool_specs()}
    for t in tools:
        assert t.input_schema == specs[t.name].schema and t.description == specs[t.name].description
        assert t.annotations.read_only_hint is True and t.annotations.destructive_hint is False


def test_mcp_tool_calls_run_through_the_copilot_tool_path():
    async def calls(c):
        return (await c.call_tool("search_docs", {"query": "GRACE resolution"}),
                await c.call_tool("get_current_weather", {"region": "dhaka"}),
                await c.call_tool("get_current_weather", {"region": "bd", "sql": "DROP TABLE alerts"}),
                await c.call_tool("execute_sql", {"query": "DELETE FROM alerts"}))

    docs, weather, injected, unknown = _with_client(calls)
    d = json.loads(docs.content[0].text)
    assert not docs.is_error and d["aquaguardModule"] == "Documentation" and d["results"]
    w = json.loads(weather.content[0].text)
    assert not weather.is_error and w["aquaguardModule"] == "Command Center"
    assert injected.is_error and "INVALID_INPUT" in injected.content[0].text
    assert unknown.is_error and "Unknown tool" in unknown.content[0].text
