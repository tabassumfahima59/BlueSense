"""bluesense-mcp: the BlueSense Copilot's read-only tools as a Model Context Protocol server (stdio transport).

The server does not reimplement anything. It lists ``app.services.copilot.TOOLS`` (the Copilot's 14 data tools plus
``search_docs``) with the JSON schemas from ``copilot.tool_specs()`` and runs every call through
``copilot.run_tool``, the same validated, allowlisted, read-only path the Copilot uses, on a read-only SQLite
connection. No language model is called by this server; ``search_docs`` embeds the query with Gemini only when
``GEMINI_API_KEY`` is set and otherwise uses keyword search.

Run from the ``aquaguard`` directory:  ``python -m bluesense_mcp``  (requirements: ``bluesense_mcp/requirements.txt``).
It is not part of the Vercel deployment. stdout carries the protocol, so logs go to stderr.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import anyio  # noqa: E402
from mcp import types  # noqa: E402
from mcp.server.lowlevel import Server  # noqa: E402
from mcp.server.stdio import stdio_server  # noqa: E402

from app.db import connection  # noqa: E402
from app.services import copilot  # noqa: E402
from app.settings import get_settings  # noqa: E402

NAME = "bluesense-mcp"
VERSION = "0.1.0"
INSTRUCTIONS = (
    "Read-only access to BlueSense, a water decision-support prototype for Bangladesh: weather, KPIs, AQUASTAT "
    "statistics, GRACE storage anomalies, alerts, ML predictions, FAO-56 irrigation estimates, what-if scenarios, "
    "regional analysis, and search_docs over the BlueSense methods, data sources, model card, limitations and "
    "assumptions. Every result says what kind of data it is (data_kind) and where it comes from.")

log = logging.getLogger("aquaguard.mcp")


def list_tool_definitions() -> list[types.Tool]:
    """One MCP tool per Copilot tool, with the Copilot's own description and input schema."""
    by_name = {t.name: t for t in copilot.TOOLS}
    return [types.Tool(name=spec.name, description=spec.description, inputSchema=spec.schema,
                       annotations=types.ToolAnnotations(title=f"{spec.name} ({by_name[spec.name].module})",
                                                         readOnlyHint=True, destructiveHint=False,
                                                         idempotentHint=True,
                                                         openWorldHint=spec.name == "search_docs"))
            for spec in copilot.tool_specs()]


def call_tool_sync(name: str, arguments: dict | None) -> types.CallToolResult:
    """Run one tool through copilot.run_tool on a fresh read-only connection."""
    conn = connection.connect(get_settings().db_path, read_only=True)
    try:
        text, is_error, _summary = copilot.run_tool(conn, name, arguments or {}, client="mcp")
    finally:
        conn.close()
    return types.CallToolResult(content=[types.TextContent(text=text)], isError=is_error)


async def _on_list_tools(ctx, params) -> types.ListToolsResult:
    return types.ListToolsResult(tools=list_tool_definitions())


async def _on_call_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    return await anyio.to_thread.run_sync(call_tool_sync, params.name, params.arguments)


def build_server() -> Server:
    return Server(NAME, version=VERSION, instructions=INSTRUCTIONS,
                  on_list_tools=_on_list_tools, on_call_tool=_on_call_tool)


async def _serve() -> None:
    server = build_server()
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s %(name)s %(message)s")
    db = get_settings().db_path
    if not Path(db).exists():
        print(f"{NAME}: database not found at {db}; set AQUAGUARD_DB_PATH", file=sys.stderr)
        raise SystemExit(2)
    log.info("%s %s: %d read-only tools over stdio, database %s", NAME, VERSION, len(copilot.TOOLS), db)
    anyio.run(_serve)


if __name__ == "__main__":
    main()
