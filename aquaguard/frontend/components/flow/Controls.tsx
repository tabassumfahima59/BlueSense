"use client";
/** Controls tab: pump, pressure, source, leakage, allocation, demand and valves. Every change re-runs the engine. */
import { RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Card";
import { fmtMeasure } from "@/lib/format";
import { DEST_LABEL, DEST_PIPE, DESTS, PIPES, pipeById } from "@/lib/flow/network";
import { DEFAULT_INPUTS } from "@/lib/flow/scenarios";
import { useFlowStore } from "@/lib/flow/store";
import type { FlowResponse } from "@/lib/types/contract";

export function Slider({ id, label, value, display, min, max, step, onChange, disabled, hint }: {
  id: string; label: string; value: number; display: string; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <div className={disabled ? "opacity-55" : ""}>
      <label htmlFor={id} className="flex justify-between gap-2 text-[12.5px]">
        <span>{label}</span><span className="tabular-nums text-muted">{display}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
             aria-valuetext={display} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#0868CC]" />
      {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2.5 rounded-lg border border-border p-3">
      <legend className="px-1 text-[12.5px] font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

export const severityWord = (v: number) => (v <= 0 ? "none" : v <= 1 ? "minor" : v <= 2 ? "moderate" : "severe");

export function ControlsPanel({ res, scenarioLoss }: { res: FlowResponse | null; scenarioLoss: number | null }) {
  const inputs = useFlowStore((s) => s.inputs);
  const setInputs = useFlowStore((s) => s.setInputs);
  const setLeak = useFlowStore((s) => s.setLeak);
  const setAllocation = useFlowStore((s) => s.setAllocation);
  const toggleValve = useFlowStore((s) => s.toggleValve);
  const setDemandFactor = useFlowStore((s) => s.setDemandFactor);
  const setOptimize = useFlowStore((s) => s.setOptimize);
  const total = DESTS.reduce((s, d) => s + inputs.allocation[d], 0);

  return (
    <div className="space-y-3">
      <Section title="Pump station">
        <label className="flex items-center justify-between gap-2 text-[12.5px]">
          <span>Pump running</span>
          <input type="checkbox" role="switch" aria-checked={inputs.pumpOn} checked={inputs.pumpOn}
                 onChange={(e) => setInputs({ pumpOn: e.target.checked })} className="h-4 w-4 accent-[#0868CC]" />
        </label>
        <Slider id="pump" label="Pump flow rate" value={inputs.pumpFlow} display={`${inputs.pumpFlow} m³/s`} min={0.1} max={1.0}
                step={0.05} onChange={(v) => setInputs({ pumpFlow: v })} disabled={!inputs.pumpOn} />
        <Slider id="capacity" label="Pump capacity" value={inputs.pumpCapacity} display={`${inputs.pumpCapacity} m³/s`} min={0.2}
                max={1.5} step={0.05} onChange={(v) => setInputs({ pumpCapacity: v })}
                hint="The pump delivers the requested flow up to its capacity. Pump speed is not modelled: flow is set directly." />
      </Section>

      <Section title="Pressure">
        <Slider id="setpoint" label="Pressure set-point" value={inputs.setpoint} display={`${inputs.setpoint} m head`} min={20} max={70}
                step={1} onChange={(v) => setInputs({ setpoint: v })}
                hint="Head at the pump outlet. Higher pressure serves zones better but pushes more water out of leaks." />
      </Section>

      <Section title="Water source">
        <label className="flex items-center justify-between gap-2 text-[12.5px]">
          <span>Limit the water available at the source</span>
          <input type="checkbox" checked={inputs.sourceLimit !== null} className="h-4 w-4 accent-[#0868CC]"
                 onChange={(e) => setInputs({ sourceLimit: e.target.checked ? 0.4 : null })} />
        </label>
        {inputs.sourceLimit !== null && (
          <Slider id="source" label="Water available at the source" value={inputs.sourceLimit} display={`${inputs.sourceLimit} m³/s`}
                  min={0.05} max={1.0} step={0.05} onChange={(v) => setInputs({ sourceLimit: v })} />
        )}
      </Section>

      <Section title="Leakage (burst severity 0–3)">
        {PIPES.map((p) => {
          const label = pipeById(p)!.label;
          const v = inputs.leaks[p];
          return (
            <div key={p} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
              <input type="checkbox" aria-label={`Leak on ${label}`} checked={v > 0} className="h-4 w-4 accent-[#DC2626]"
                     onChange={(e) => setLeak(p, e.target.checked ? 1 : 0)} />
              <div className="min-w-0">
                <div className="flex justify-between gap-2 text-[12px]"><span>{label}</span>
                  <span className="tabular-nums text-muted">{v} · {severityWord(v)}</span></div>
                <input type="range" min={0} max={3} step={0.5} value={v} aria-label={`${label} leak severity`}
                       aria-valuetext={`${v}, ${severityWord(v)}`} onChange={(e) => setLeak(p, Number(e.target.value))}
                       className="w-full accent-[#DC2626]" />
              </div>
            </div>
          );
        })}
        <p className="text-[11.5px] text-muted">
          Background leakage is calibrated to an assumed loss rate of {res ? fmtMeasure(res.backgroundLossRate) : "…"}
          {scenarioLoss !== null ? " (from the active What-if scenario)" : " (platform assumption, not a statistic)"}.
        </p>
      </Section>

      <Section title="Allocation (share of the junction flow)">
        {DESTS.map((d) => (
          <Slider key={d} id={`alloc-${d}`} label={`${DEST_LABEL[d]} share`} value={inputs.allocation[d]}
                  display={`${inputs.allocation[d].toFixed(1)} %`} min={0} max={100} step={1}
                  onChange={(v) => setAllocation(d, v)} disabled={inputs.closed.includes(DEST_PIPE[d])} />
        ))}
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted" aria-live="polite">Total {total.toFixed(1)} % (the other shares rescale automatically)</span>
          <Button variant="ghost" onClick={() => setInputs({ allocation: DEFAULT_INPUTS.allocation })} ariaLabel="Reset allocation">
            <RotateCcw size={13} aria-hidden /> Reset
          </Button>
        </div>
      </Section>

      <Section title="Demand (× hypothetical normal demand)">
        {DESTS.map((d) => (
          <Slider key={d} id={`demand-${d}`} label={`${DEST_LABEL[d]} demand`} value={inputs.demandFactors[d]}
                  display={`${inputs.demandFactors[d].toFixed(1)}×`} min={0.5} max={2} step={0.1}
                  onChange={(v) => setDemandFactor(d, v)} />
        ))}
      </Section>

      <Section title="Valves">
        {PIPES.map((p) => (
          <label key={p} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span>{pipeById(p)!.label} valve open</span>
            <input type="checkbox" checked={!inputs.closed.includes(p)} onChange={() => toggleValve(p)} className="h-4 w-4 accent-[#0868CC]" />
          </label>
        ))}
      </Section>

      <Button onClick={() => setOptimize(true)} className="w-full justify-center">
        <Sparkles size={14} aria-hidden /> Optimize (pressure management)
      </Button>
      <p className="text-[11.5px] text-muted">
        Isolates burst leaks for repair, then finds the lowest pump set-point that still gives every open zone its minimum
        service pressure: lower pressure, less leakage. A conceptual what-if, not an operating instruction.
      </p>
    </div>
  );
}
