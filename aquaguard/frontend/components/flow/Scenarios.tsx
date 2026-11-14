"use client";
/** Scenarios tab: eight conceptual presets and a comparison with normal operation (the baseline), with the reason. */
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { balanceStatus, delta, fmt, num } from "@/lib/flow/derive";
import { DEST_LABEL, type DestId } from "@/lib/flow/network";
import { SCENARIOS, scenarioById } from "@/lib/flow/scenarios";
import { useFlowStore } from "@/lib/flow/store";
import type { FlowState } from "@/lib/types/contract";
import { StatusText } from "./Status";

function Change({ now, base, digits = 0, unit = "" }: { now: number | null; base: number | null; digits?: number; unit?: string }) {
  const d = delta(now, base, digits);
  const Icon = d.dir === "up" ? ArrowUpRight : d.dir === "down" ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center justify-end gap-0.5 tabular-nums">
      <Icon size={12} aria-hidden className="text-muted" />{d.text}{d.dir !== "same" && unit ? ` ${unit}` : ""}
    </span>
  );
}

export function ScenariosPanel({ state, baseline }: { state: FlowState; baseline: FlowState | null }) {
  const scenarioId = useFlowStore((s) => s.scenarioId);
  const applyScenario = useFlowStore((s) => s.applyScenario);
  const sc = scenarioById(scenarioId);
  const rows: { label: string; now: number | null; base: number | null; digits?: number; unit: string }[] = baseline ? [
    { label: "Total inflow", now: num(state.inflowDaily), base: num(baseline.inflowDaily), unit: "m³/day" },
    { label: "Delivered", now: num(state.deliveredDaily), base: num(baseline.deliveredDaily), unit: "m³/day" },
    { label: "Leakage", now: num(state.leakDaily), base: num(baseline.leakDaily), unit: "m³/day" },
    { label: "Efficiency", now: num(state.efficiency), base: num(baseline.efficiency), digits: 1, unit: "pp" },
    { label: "Demand (hypothetical)", now: num(state.demandDaily), base: num(baseline.demandDaily), unit: "m³/day" },
    ...state.destinations.map((d) => ({
      label: `${DEST_LABEL[d.id as DestId]} supply`, now: num(d.supply),
      base: num(baseline.destinations.find((b) => b.id === d.id)?.supply), digits: 1, unit: "pp",
    })),
  ] : [];
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Scenario" className="grid gap-1.5">
        {SCENARIOS.map((s) => {
          const on = s.id === scenarioId;
          return (
            <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => applyScenario(s.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition ${on ? "border-primary bg-primary-soft" : "border-border bg-white hover:bg-light"}`}>
              <span className="block text-[13px] font-semibold text-ink">{s.label}</span>
              <span className="block text-[11.5px] text-muted">{s.change}</span>
            </button>
          );
        })}
      </div>
      {scenarioId === "custom" && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted">
          Custom settings: you changed the controls by hand. Pick a scenario to start again from a preset.
        </p>
      )}
      <section aria-labelledby="flow-vs-base" data-testid="scenario-compare">
        <h3 id="flow-vs-base" className="mb-1 text-[13px] font-semibold text-ink">
          {sc ? sc.label : "Custom settings"} vs normal operation
        </h3>
        {sc && sc.id !== "normal" && <p className="mb-2 text-[12px] text-ink"><b>Why:</b> {sc.why}</p>}
        {!baseline ? <p className="text-[12px] text-muted">Loading the baseline…</p> : (
          <>
            <table className="w-full text-[12px]">
              <thead className="text-left text-muted"><tr className="border-b border-border">
                <th className="py-1 font-medium">Result</th><th className="text-right font-medium">Normal</th>
                <th className="text-right font-medium">Now</th><th className="text-right font-medium">Change</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-border/60">
                    <th scope="row" className="py-1 text-left font-normal">{r.label}</th>
                    <td className="text-right tabular-nums">{fmt(r.base, r.digits ?? 0)}{r.unit === "pp" ? " %" : ""}</td>
                    <td className="text-right tabular-nums">{fmt(r.now, r.digits ?? 0)}{r.unit === "pp" ? " %" : ""}</td>
                    <td className="text-right"><Change now={r.now} base={r.base} digits={r.digits} unit={r.unit === "pp" ? "pp" : ""} /></td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-1 text-left font-normal">Water balance</th>
                  <td className="text-right"><StatusText status={balanceStatus(baseline)} /></td>
                  <td className="text-right" colSpan={2}><StatusText status={balanceStatus(state)} /></td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[11.5px] text-muted">Volumes in m³/day; pp = percentage points. Scenarios are conceptual illustrations, not measured events.</p>
          </>
        )}
      </section>
    </div>
  );
}
