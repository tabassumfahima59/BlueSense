"""Loader for parameters.yaml — the single home of every engine assumption."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

PARAMS_PATH = Path(__file__).resolve().parent / "parameters.yaml"
SOURCES_PATH = Path(__file__).resolve().parent / "sources.yaml"


@lru_cache
def params() -> dict[str, Any]:
    return yaml.safe_load(PARAMS_PATH.read_text(encoding="utf-8"))


def pval(*path: str) -> Any:
    """Return the `value` of a parameter entry, e.g. pval('water_balance', 'runoff_coefficient')."""
    node: Any = params()
    for key in path:
        node = node[key]
    return node["value"] if isinstance(node, dict) and "value" in node else node


def pentry(*path: str) -> dict[str, Any]:
    node: Any = params()
    for key in path:
        node = node[key]
    return node


def assumptions_table() -> list[dict[str, Any]]:
    """Flatten every {value, unit, source, assumption} entry for the UI's assumptions panels."""
    out: list[dict[str, Any]] = []

    def walk(node: Any, path: list[str]) -> None:
        if isinstance(node, dict):
            if "value" in node and "source" in node:
                out.append({
                    "key": ".".join(path), "value": node["value"], "unit": node.get("unit", ""),
                    "source": node["source"], "assumption": bool(node.get("assumption", False)),
                    "note": node.get("note"),
                })
                return
            for k, v in node.items():
                walk(v, [*path, str(k)])

    walk(params(), [])
    return out


@lru_cache
def sources_registry() -> list[dict[str, Any]]:
    return yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))["sources"]
