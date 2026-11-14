"""Provider-independent interface for the Copilot's language model.

The Copilot core (services/copilot.py) owns the tools, validation, limits and events; a provider adapter only turns
the conversation into its API's format, streams one model turn, and maps its errors to ``LLMError`` codes. Assistant
turns are kept in the provider's own format (``Turn.assistant``) and sent back unchanged, as the APIs require.
There is never an automatic switch to another provider or to canned text.
"""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

ErrorCode = Literal["quota_exhausted", "llm_rate_limited", "llm_unavailable", "llm_timeout", "llm_auth",
                    "llm_config", "llm_error", "refusal", "truncated", "model_error"]


class LLMError(Exception):
    """A provider failure with a stable code and a message that is safe to show (never contains a key)."""

    def __init__(self, code: ErrorCode, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass
class ToolCall:
    id: str
    name: str
    args: Any


@dataclass
class Turn:
    """The end of one model call."""
    stop: Literal["end", "tool_calls", "pause"]
    tool_calls: list[ToolCall] = field(default_factory=list)
    assistant: Any = None       # the provider-native assistant message, appended to the conversation unchanged
    model: str | None = None
    finish: str | None = None   # the provider's own stop / finish reason, for reporting


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    schema: dict


@dataclass(frozen=True)
class ToolResult:
    call: ToolCall
    content: str                # JSON text
    is_error: bool


class Provider(Protocol):
    name: str                   # "gemini" | "anthropic"
    label: str                  # shown to users, e.g. "Google Gemini"
    model: str
    policy_url: str
    disclosure: str

    def user_message(self, context: str, question: str) -> Any: ...

    def history_message(self, role: str, text: str) -> Any: ...

    def tool_results_message(self, results: list[ToolResult]) -> Any: ...

    def stream_turn(self, system: str, messages: list, tools: list[ToolSpec],
                    max_tokens: int) -> Iterator[str | Turn]:
        """Yield text deltas, then exactly one ``Turn``. Raise ``LLMError`` on failure."""
        ...
