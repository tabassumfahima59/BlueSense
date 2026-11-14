"use client";
/**
 * M8 Copilot chat. Streams answers from /api/copilot/stream, shows each read-only tool the model used (with module
 * link and data kind), flags numbers that could not be matched to the looked-up data, and can be stopped. Without a
 * server-side LLM key it says so and accepts no questions: there are no canned answers.
 */
import { AlertTriangle, Bot, CircleSlash, Loader2, Send, Square, User, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { type CopilotEvent, streamCopilot } from "@/lib/api/copilot";
import { useApi } from "@/lib/api/useApi";
import { fmtNumber } from "@/lib/format";
import { clientId, useAppStore } from "@/lib/store";
import type { ChatTurn, CopilotToolCall } from "@/lib/types/contract";

export interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: CopilotToolCall[];
  unverified?: number[];
  model?: string;
  streaming?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  "What is the weather in Dhaka right now?",
  "Which divisions are driest this season?",
  "What does the model predict for next month in Rajshahi?",
  "Is Bangladesh's water storage declining (GRACE)?",
  "What if rainfall drops 20%?",
  "আমার বিভাগে পানির ঝুঁকি কেমন?",
];

export const TOOL_LABEL: Record<string, string> = {
  get_current_weather: "Current weather", get_weather_forecast: "Weather forecast", get_dashboard_kpis: "Dashboard KPIs",
  get_division_indicators: "Division indicators", get_water_statistics: "AQUASTAT statistics",
  get_national_water_budget: "National water budget", get_groundwater_trend: "GRACE storage trend", get_alerts: "Alerts",
  get_prediction: "ML prediction", estimate_irrigation: "Irrigation estimate", run_what_if: "What-if run",
};
const MODULE_PATH: Record<string, string> = {
  "Command Center": "/command-center", "Water Budget": "/water-budget", "Water Explorer": "/explorer",
  "Prediction Lab": "/prediction-lab", "Smart Irrigation": "/irrigation", "What-if": "/what-if",
};

/** Apply one stream event to the assistant message being built (pure, exported for tests). */
export function applyEvent(m: Msg, e: CopilotEvent): Msg {
  switch (e.type) {
    case "delta":
      return { ...m, content: m.content + e.text };
    case "tool": {
      const tools = [...(m.tools ?? [])];
      const i = tools.findIndex((t) => t.name === e.name && t.status === "running");
      const call: CopilotToolCall = { name: e.name, status: e.status, module: e.module, input: e.input, dataKind: e.dataKind,
                                      source: e.source, observedAt: e.observedAt, ms: e.ms };
      if (i >= 0 && e.status !== "running") tools[i] = call;
      else if (e.status === "running" || i < 0) tools.push(call);
      return { ...m, tools };
    }
    case "done":
      return { ...m, streaming: false, tools: e.tools, unverified: e.unverifiedNumbers, model: e.model };
    case "error":
      return { ...m, streaming: false, error: e.detail };
  }
}

function ToolChips({ tools }: { tools: CopilotToolCall[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Data looked up">
      {tools.map((t, i) => {
        const where = typeof t.input?.region === "string" ? ` · ${t.input.region}` : "";
        const label = `${TOOL_LABEL[t.name] ?? t.name}${where}`;
        const icon = t.status === "running" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : t.status === "error" ? <CircleSlash size={12} aria-hidden /> : <Wrench size={12} aria-hidden />;
        const cls = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${t.status === "error" ? "border-risk/40 text-[#b42318]" : "border-border text-muted"}`;
        const body = <>{icon}{label}{t.dataKind?.length ? ` · ${t.dataKind.join(", ")}` : ""}{t.status === "error" ? " · failed" : ""}</>;
        return (
          <li key={i}>
            {t.module && MODULE_PATH[t.module] && t.status === "done"
              ? <Link href={MODULE_PATH[t.module]} className={`${cls} hover:border-primary hover:text-primary`} title={`Open ${t.module}`}>{body}</Link>
              : <span className={cls}>{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function ChatUI({ compact = false }: { compact?: boolean }) {
  const region = useAppStore((s) => s.selectedRegion) || "bd";
  const status = useApi("copilot-status", api.copilotStatus);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ready = status.data?.status === "ready";
  const inputId = compact ? "copilot-input-panel" : "copilot-input";
  const noteId = `${inputId}-status`;

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);
  useEffect(() => () => abort.current?.abort(), []);

  const update = (fn: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || !ready) return;
    const history: ChatTurn[] = msgs.filter((m) => !m.error && m.content).slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    setMsgs((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "", tools: [], streaming: true }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await streamCopilot({ message, region, history, clientId: clientId() }, (e) => update((m) => applyEvent(m, e)), ctrl.signal);
      update((m) => (m.streaming ? { ...m, streaming: false } : m));
    } catch (e) {
      const err = e as Error;
      update((m) => ({ ...m, streaming: false, error: err.name === "AbortError" ? "Stopped." : err.message }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite" aria-busy={busy}>
        {status.data && !ready && (
          <div id={noteId} role="status" className="rounded-lg border border-warning/50 bg-[#fff6e5] p-3 text-[13px] text-ink">
            <p className="font-semibold">The Copilot is not configured.</p>
            <p className="mt-1 text-muted">{status.data.reason} AquaGuard gives no canned or rule-based answers instead. An administrator can set the key on the server; it is never sent to the browser.</p>
          </div>
        )}
        {status.error && <p id={noteId} role="status" className="text-[13px] text-[#b42318]">Copilot status unavailable: {status.error.message}</p>}
        {ready && status.data?.disclosure && (
          <div role="note" aria-label="How your question is processed" data-testid="copilot-disclosure"
               className="rounded-lg border border-border bg-bg/60 px-3 py-2 text-[12px] leading-relaxed text-muted">
            <span className="font-semibold text-ink">AI provider: {status.data.providerLabel}.</span> {status.data.disclosure}
            {status.data.policyUrl && (
              <> <a href={status.data.policyUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">Provider terms</a></>
            )}
          </div>
        )}
        {ready && msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">
              Ask about water, weather, risk, statistics, predictions, irrigation or scenarios. The Copilot looks the numbers up with read-only
              AquaGuard tools and shows which data it used.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.slice(0, compact ? 4 : 6).map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-border bg-white px-2.5 py-1 text-[12.5px] text-ink hover:border-primary hover:text-primary">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`} data-testid={m.role === "assistant" ? "copilot-answer" : undefined}>
            {m.role === "assistant" && (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><Bot size={15} aria-hidden /></span>
            )}
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] leading-relaxed ${m.role === "user" ? "bg-primary text-white" : "border border-border bg-white text-ink"}`}>
              {m.content && <p className="whitespace-pre-wrap font-bangla">{m.content}</p>}
              {m.streaming && !m.content && <p className="text-[12.5px] text-muted">Looking up AquaGuard data…</p>}
              {!!m.tools?.length && <ToolChips tools={m.tools} />}
              {!!m.unverified?.length && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md bg-[#fff6e5] px-2 py-1 text-[12px] text-[#8a4b00]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  Check {m.unverified.map((n) => fmtNumber(n)).join(", ")}: not found in the data the Copilot looked up.
                </p>
              )}
              {m.error && <p className="mt-1 text-[12.5px] text-[#b42318]">{m.error}</p>}
              {m.model && <p className="mt-2 text-[11px] text-muted">Generated by {m.model} from AquaGuard data. AI answers can contain mistakes.</p>}
            </div>
            {m.role === "user" && (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-muted"><User size={15} aria-hidden /></span>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <label htmlFor={inputId} className="sr-only">Ask the Copilot</label>
        <input id={inputId} value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} disabled={!ready}
               aria-describedby={!ready ? noteId : undefined}
               placeholder={ready ? "Ask in English or বাংলা…" : status.data ? "Copilot not configured" : "Checking Copilot…"}
               className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-[13.5px] font-bangla disabled:bg-bg disabled:text-muted" />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop answer" className="rounded-lg border border-border bg-white px-3 text-ink hover:bg-bg">
            <Square size={15} aria-hidden />
          </button>
        ) : (
          <button type="submit" disabled={!ready || !input.trim()} aria-label="Send" className="rounded-lg bg-primary px-3 text-white disabled:opacity-50">
            <Send size={16} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
