"use client";
import dynamic from "next/dynamic";
import { FlaskConical, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, SERIES } from "@/components/charts/theme";
import { Button, Card, Note, PageHeader } from "@/components/ui/Card";
import { MeasureText } from "@/components/ui/MeasureView";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { fmtMeasure } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { FlowResponse, FlowState } from "@/lib/types/contract";

const FlowScene = dynamic(() => import("@/components/three/FlowScene").then((m) => m.FlowScene), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const PIPES = [
  { id: "trunk", label: "Trunk main (pump → junction)" },
  { id: "res", label: "Residential branch" },
  { id: "agr", label: "Agricultural branch" },
  { id: "ind", label: "Industrial branch" },
];
const DEFAULTS = { pump: 0.5, setpoint: 45, leaks: { trunk: 0, res: 0, agr: 0, ind: 0 } as Record<string, number> };

function Slider({ id, label, value, min, max, step, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className="flex justify-between text-[12.5px]"><span>{label}</span><span className="tabular-nums text-muted">{value} {unit}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

function ResultTable({ before, after }: { before: FlowState; after?: FlowState | null }) {
  const rows: [string, (s: FlowState) => Parameters<typeof fmtMeasure>[0]][] = [
    ["Pump set-point", (s) => s.setpoint],
    ["Pump flow", (s) => s.pumpFlow],
    ["Delivered (total)", (s) => s.deliveredTotal],
    ["Leakage (total)", (s) => s.leakTotal],
    ["Water loss", (s) => s.lossPct],
    ...before.destinations.map((d, i) => [`${d.id[0].toUpperCase() + d.id.slice(1)} delivered`, (s: FlowState) => s.destinations[i].deliveredDaily] as [string, (s: FlowState) => Parameters<typeof fmtMeasure>[0]]),
    ...before.destinations.map((d, i) => [`${d.id[0].toUpperCase() + d.id.slice(1)} pressure`, (s: FlowState) => s.destinations[i].pressure] as [string, (s: FlowState) => Parameters<typeof fmtMeasure>[0]]),
    ["Mass-balance error", (s) => s.massBalanceError],
  ];
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-muted"><tr className="border-b border-border"><th className="py-1 font-medium">Result</th><th className="text-right font-medium">Current</th>{after && <th className="text-right font-medium">Optimized</th>}</tr></thead>
      <tbody>
        {rows.map(([label, f]) => (
          <tr key={label} className="border-b border-border/60">
            <td className="py-1">{label}</td>
            <td className="text-right tabular-nums">{fmtMeasure(f(before))}</td>
            {after && <td className="text-right font-medium tabular-nums text-primary">{fmtMeasure(f(after))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function WaterFlow() {
  const scenarioLoss = useAppStore((s) => s.activeScenario.pipelineLossPct);
  const [pump, setPump] = useState(DEFAULTS.pump);
  const [setpoint, setSetpoint] = useState(DEFAULTS.setpoint);
  const [leaks, setLeaks] = useState<Record<string, number>>(DEFAULTS.leaks);
  const [running, setRunning] = useState(true);
  const [res, setRes] = useState<FlowResponse | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [optimized, setOptimized] = useState(false);
  const [view, setView] = useState<"current" | "optimized">("current");
  const [lowPower, setLowPower] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setLowPower(window.matchMedia("(max-width: 768px)").matches);
  }, []);

  const body = useMemo(() => ({ pumpFlowM3s: pump, setpointM: setpoint, leaks, lossPct: scenarioLoss, optimize: optimized }), [pump, setpoint, leaks, scenarioLoss, optimized]);

  useEffect(() => {
    const t = setTimeout(() => {
      api.flow(body).then((r) => { setRes(r); setErr(null); }).catch((e: Error) => setErr(e));
    }, 200);
    return () => clearTimeout(t);
  }, [body, nonce]);

  const shown = view === "optimized" && res?.optimized ? res.optimized : res?.state;
  const reset = () => { setPump(DEFAULTS.pump); setSetpoint(DEFAULTS.setpoint); setLeaks(DEFAULTS.leaks); setOptimized(false); setView("current"); setRunning(true); };

  return (
    <div className="space-y-4">
      <PageHeader title="3D Water Flow Visualization" description="A hypothetical reservoir → pump → trunk main → three-branch network. Hazen–Williams head loss and pressure-dependent leakage, solved at steady state." />
      <div role="status" className="flex items-center gap-2 rounded-lg border border-dashed border-primary bg-primary-soft px-3 py-2 text-[13px] font-semibold text-primary">
        <FlaskConical size={16} aria-hidden /> SIMULATED — no IoT sensors, no real-time pipe pressure, no pump or valve control. AquaGuard does not detect physical leaks.
      </div>
      {err && <ErrorCard error={err} onRetry={() => setNonce((n) => n + 1)} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card relative h-[460px] overflow-hidden p-0 lg:h-[calc(100vh-260px)] lg:min-h-[520px]">
          {shown ? <FlowScene state={shown} running={running} lowPower={lowPower} /> : <Skeleton className="h-full w-full" />}
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {res?.optimized && (
              <div role="radiogroup" aria-label="Network state shown" className="inline-flex rounded-lg border border-border bg-white p-0.5 text-[12px]">
                {(["current", "optimized"] as const).map((v) => (
                  <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={`rounded-md px-2 py-1 capitalize ${view === v ? "bg-primary text-white" : "text-muted"}`}>{v}</button>
                ))}
              </div>
            )}
            <button onClick={() => setLowPower((x) => !x)} aria-pressed={lowPower} className="rounded-lg border border-border bg-white px-2 py-1 text-[12px] text-muted">{lowPower ? "Lite mode on" : "Lite mode"}</button>
          </div>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-white/95 px-2 py-1 text-[11.5px] text-muted shadow-sm">
            Pipe colour = end pressure:
            <span className="h-2.5 w-16 rounded" style={{ background: "linear-gradient(90deg,#CCEFEA,#0B5F58)" }} aria-hidden /> 0 → 50 m
            <span className="ml-2 h-2.5 w-2.5 rounded-full bg-[#2A78D6]" aria-hidden /> flow particles (speed ∝ velocity)
            <span className="ml-2 h-2.5 w-2.5 rounded-full bg-risk" aria-hidden /> leak
          </div>
        </div>
        <div className="space-y-4">
          <Card title="Controls">
            <div className="space-y-3">
              <Slider id="pump" label="Pump flow rate" value={pump} min={0.1} max={1.0} step={0.05} unit="m³/s" onChange={(v) => { setPump(v); setOptimized(false); }} />
              <Slider id="setpoint" label="Pressure set-point" value={setpoint} min={20} max={70} step={1} unit="m head" onChange={(v) => { setSetpoint(v); setOptimized(false); }} />
              <fieldset className="space-y-2">
                <legend className="text-[12.5px] font-medium">Leaks (burst severity 0–3)</legend>
                {PIPES.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <input type="checkbox" aria-label={`Leak on ${p.label}`} checked={leaks[p.id] > 0}
                      onChange={(e) => { setLeaks({ ...leaks, [p.id]: e.target.checked ? 1 : 0 }); setOptimized(false); }} className="h-4 w-4" />
                    <span className="w-36 text-[12px]">{p.label}</span>
                    <input type="range" min={0} max={3} step={0.5} value={leaks[p.id]} aria-label={`${p.label} leak severity`}
                      onChange={(e) => { setLeaks({ ...leaks, [p.id]: Number(e.target.value) }); setOptimized(false); }} className="flex-1" />
                    <span className="w-6 text-right text-[12px] tabular-nums">{leaks[p.id]}</span>
                  </div>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setRunning(true)} disabled={running}><Play size={14} aria-hidden /> Run</Button>
                <Button variant="secondary" onClick={() => setRunning(false)} disabled={!running}><Pause size={14} aria-hidden /> Pause</Button>
                <Button variant="secondary" onClick={reset}><RotateCcw size={14} aria-hidden /> Reset</Button>
              </div>
              <Button onClick={() => { setOptimized(true); setView("optimized"); }} className="w-full justify-center"><Sparkles size={14} aria-hidden /> Optimize (pressure management)</Button>
              <p className="text-[11.5px] text-muted">
                Background leakage calibrated to the platform loss rate: {res ? <MeasureText m={res.backgroundLossRate} /> : "…"}
                {scenarioLoss !== null && " (from the active What-if scenario)"}
              </p>
            </div>
          </Card>
          {res && (
            <Card title="Results" subtitle={res.optimizationNote ?? "Steady-state solution"}>
              <ResultTable before={res.state} after={res.optimized} />
              {res.savings && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
                  {Object.entries(res.savings).map(([k, m]) => (
                    <div key={k} className="rounded-lg bg-primary-soft p-2">
                      <div className="text-muted">{{ leakReduction: "Leakage avoided", lossPctReduction: "Loss reduction", deliveredGain: "Extra delivered", setpointReduction: "Set-point lowered by" }[k] ?? k}</div>
                      <div className="font-semibold text-ink">{fmtMeasure(m)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      {res?.optimized && (
        <Card title="Before vs after optimization" subtitle="Delivered volume per destination and leakage (m³/day)">
          <Plot filename="flow-before-after" ariaLabel="Delivered volumes and leakage before and after optimization" height={280}
            data={[
              { type: "bar", name: "Current", x: [...res.state.destinations.map((d) => d.id), "leakage"], y: [...res.state.destinations.map((d) => d.deliveredDaily.value), (res.state.leakTotal.value ?? 0) * 86400], marker: { color: SERIES[1] }, hovertemplate: "%{y:,.0f} m³/day" },
              { type: "bar", name: "Optimized", x: [...res.optimized.destinations.map((d) => d.id), "leakage"], y: [...res.optimized.destinations.map((d) => d.deliveredDaily.value), (res.optimized.leakTotal.value ?? 0) * 86400], marker: { color: SERIES[0] }, hovertemplate: "%{y:,.0f} m³/day" },
            ]}
            layout={baseLayout({ barmode: "group", bargap: 0.3, bargroupgap: 0.08, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("m³/day") } })} />
        </Card>
      )}
      <Note>{res?.disclaimer ?? "All values are Simulated."} Head loss: Hazen–Williams (C from config). Leakage: Q = k·P^N1 (FAVAD). Mass balance Q_pump = ΣQ_delivered + ΣQ_leak is checked on every run.</Note>
    </div>
  );
}
