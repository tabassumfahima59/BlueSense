/**
 * M8 Copilot streaming client. POST /api/copilot/stream returns server-sent events (tool, delta, done, error).
 * EventSource cannot POST, so the response body is read and parsed here. The parser is pure for unit tests.
 */
import type { CopilotRequest, CopilotToolCall } from "../types/contract";
import { API_BASE, ApiError } from "./client";

export type CopilotEvent =
  | { type: "delta"; text: string }
  | ({ type: "tool" } & CopilotToolCall)
  | { type: "done"; model: string; stopReason: string; tools: CopilotToolCall[]; unverifiedNumbers: number[] }
  | { type: "error"; code: string; detail: string };

/** Split an SSE buffer into complete events and the unfinished remainder. */
export function parseSSE(buffer: string): { events: CopilotEvent[]; rest: string } {
  const events: CopilotEvent[] = [];
  const norm = buffer.replace(/\r\n/g, "\n");
  const parts = norm.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const chunk of parts) {
    const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as CopilotEvent);
    } catch {
      /* ignore a malformed event; the stream continues */
    }
  }
  return { events, rest };
}

export async function streamCopilot(body: CopilotRequest, onEvent: (e: CopilotEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/copilot/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Cannot reach the AquaGuard API. Check that the backend is running and reachable.", "network");
  }
  if (!res.ok || !res.body) {
    let detail = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const j = await res.json();
      detail = typeof j?.detail === "string" ? j.detail : detail;
      code = j?.code;
    } catch {
      /* non-JSON body */
    }
    const ra = Number(res.headers.get("Retry-After"));
    throw new ApiError(res.status, detail, code, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSE(buf);
    buf = rest;
    events.forEach(onEvent);
  }
  const { events } = parseSSE(`${buf}\n\n`);
  events.forEach(onEvent);
}
