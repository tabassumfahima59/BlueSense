import { describe, expect, it } from "vitest";
import { applyEvent, type Msg } from "../components/copilot/ChatUI";
import { parseSSE } from "../lib/api/copilot";

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

describe("Copilot server-sent events", () => {
  it("parses complete events and keeps the unfinished remainder", () => {
    const buf = ev("delta", { text: "Hel" }) + ev("delta", { text: "lo" }) + "event: tool\ndata: {\"type\":\"to";
    const { events, rest } = parseSSE(buf);
    expect(events).toEqual([{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }]);
    expect(rest).toBe("event: tool\ndata: {\"type\":\"to");
  });

  it("handles CRLF line endings and skips malformed data", () => {
    const { events } = parseSSE("event: delta\r\ndata: {\"type\":\"delta\",\"text\":\"a\"}\r\n\r\ndata: {broken\n\n");
    expect(events).toEqual([{ type: "delta", text: "a" }]);
  });
});

describe("assembling an answer", () => {
  it("appends text, tracks tool status and finishes with the verification result", () => {
    let m: Msg = { role: "assistant", content: "", tools: [], streaming: true };
    m = applyEvent(m, { type: "delta", text: "Checking. " });
    m = applyEvent(m, { type: "tool", name: "get_current_weather", status: "running" });
    expect(m.tools?.[0].status).toBe("running");
    m = applyEvent(m, { type: "tool", name: "get_current_weather", status: "done", module: "Command Center", dataKind: ["model_current"] });
    expect(m.tools).toHaveLength(1);
    expect(m.tools?.[0]).toMatchObject({ status: "done", module: "Command Center" });
    m = applyEvent(m, { type: "delta", text: "It is 21 °C." });
    m = applyEvent(m, { type: "done", model: "claude-opus-5-5", stopReason: "end_turn", tools: m.tools ?? [], unverifiedNumbers: [98765] });
    expect(m.content).toBe("Checking. It is 21 °C.");
    expect(m.streaming).toBe(false);
    expect(m.unverified).toEqual([98765]);
  });

  it("an error ends the answer and is shown, never replaced by a canned reply", () => {
    const m = applyEvent({ role: "assistant", content: "", streaming: true }, { type: "error", code: "refusal", detail: "The model declined to answer this request." });
    expect(m).toMatchObject({ content: "", streaming: false, error: "The model declined to answer this request." });
  });
});
