"use client";
import { Bot, Send, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { fmtMeasure } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { ChatTurn, CopilotResponse } from "@/lib/types/contract";
import { MeasureBadge } from "../ui/Provenance";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: CopilotResponse;
  error?: boolean;
}

const SUGGESTIONS = [
  "Summarize the water situation",
  "What is the scarcity risk and why?",
  "Explain the active scenario",
  "What does the forecast say?",
  "Explain the water budget",
  "পানির ঝুঁকি কেমন?",
];

const MODULE_PATH: Record<string, string> = {
  "command-center": "/command-center", "prediction-lab": "/prediction-lab", "water-budget": "/water-budget",
  "water-flow": "/water-flow", "what-if": "/what-if", irrigation: "/irrigation", "data-sources": "/data-sources",
};

export function ChatUI({ compact = false }: { compact?: boolean }) {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history: ChatTurn[] = msgs.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.copilot({ message, region, scenario, history });
      setMsgs((m) => [...m, { role: "assistant", content: res.answer, meta: res }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">
              Ask about {region === "bd" ? "Bangladesh" : "the selected region"}. Answers use only AquaGuard data for the current region and
              scenario; numbers come from the platform, and missing data is stated.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.slice(0, compact ? 4 : 6).map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-border bg-white px-2.5 py-1 text-[12.5px] text-ink hover:border-primary hover:text-primary">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                <Bot size={15} aria-hidden />
              </span>
            )}
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] leading-relaxed ${
              m.role === "user" ? "bg-primary text-white" : m.error ? "border border-risk/40 bg-white text-ink" : "border border-border bg-white text-ink"
            }`}>
              <p className="whitespace-pre-wrap font-bangla">{m.content}</p>
              {m.meta && (
                <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11.5px] text-muted">
                  <div>
                    Mode: {m.meta.mode === "llm" ? "LLM (grounded, numbers checked)" : "Rule-based fallback"} · intent: {m.meta.intent}
                  </div>
                  {m.meta.references.slice(0, compact ? 3 : 6).map((r, j) => (
                    <div key={j} className="flex flex-wrap items-center gap-1">
                      <Link href={MODULE_PATH[r.module] ?? "/command-center"} className="text-primary underline-offset-2 hover:underline">
                        {r.label}
                      </Link>
                      {r.measure && (
                        <>
                          <span>{fmtMeasure(r.measure)}</span>
                          <MeasureBadge m={r.measure} small />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {m.role === "user" && (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-muted">
                <User size={15} aria-hidden />
              </span>
            )}
          </div>
        ))}
        {busy && <div className="pl-9 text-[12.5px] text-muted">Looking up platform data…</div>}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor={compact ? "copilot-input-panel" : "copilot-input"} className="sr-only">
          Ask the Copilot
        </label>
        <input
          id={compact ? "copilot-input-panel" : "copilot-input"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="Ask in English or বাংলা…"
          className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-[13.5px] font-bangla"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="rounded-lg bg-primary px-3 text-white disabled:opacity-50">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
