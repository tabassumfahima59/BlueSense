"use client";
import { Globe2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SERIES } from "@/components/charts/theme";
import { Button, Card, Note, PageHeader } from "@/components/ui/Card";
import { MeasureBadge } from "@/components/ui/Provenance";
import { RiskPill, RiskRule } from "@/components/ui/Risk";
import { ErrorCard, LoadingCard } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { fmtMeasure, MONTHS } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline, RANGES } from "@/lib/store/scenario";
import { BASELINE, type Compare, type Scenario, type ScenarioResponse } from "@/lib/types/contract";

const PRESETS: { label: string; s: Partial<Scenario> }[] = [
  { label: "Dry year: rainfall −20%", s: { rainfallChangePct: -20 } },
  { label: "Hot & dry: −20% rain, +1.5 °C", s: { rainfallChangePct: -20, temperatureChangeC: 1.5 } },
  { label: "Efficiency push: irrigation efficiency 0.90", s: { irrigationEfficiency: 0.9 } },
  { label: "Groundwater stress: −30%", s: { groundwaterAvailabilityPct: -30 } },
  { label: "Urban growth: demand +30%", s: { demandChangePct: 30 } },
  { label: "Leaky network: loss 35%", s: { pipelineLossPct: 35 } },
];

const LEVERS: { key: keyof Scenario; label: string; unit: string; help: string; nullable?: { base: number; baseLabel: string } }[] = [
  { key: "rainfallChangePct", label: "Rainfall change", unit: "%", help: "Changes local runoff and effective rainfall (FAO-56)" },
  { key: "temperatureChangeC", label: "Temperature change", unit: "°C", help: "Scales ET0 by the Hargreaves ratio → crop water need" },
  { key: "demandChangePct", label: "Domestic & industrial demand", unit: "%", help: "Population/economic demand growth" },
  { key: "groundwaterAvailabilityPct", label: "Groundwater availability", unit: "%", help: "Scales renewable groundwater supply" },
  { key: "irrigationEfficiency", label: "Irrigation efficiency", unit: "", help: "Gross need = net need / efficiency", nullable: { base: 0.78, baseLabel: "baseline 0.78 (AQUASTAT-derived)" } },
  { key: "pipelineLossPct", label: "Pipeline loss", unit: "%", help: "Distribution loss rate (also feeds 3D Water Flow)", nullable: { base: 20, baseLabel: "baseline 20% (assumption)" } },
];

function CompareCard({ c }: { c: Compare }) {
  const pct = c.baseline.value ? ((c.simulated.value ?? 0) - c.baseline.value) / Math.abs(c.baseline.value) * 100 : 0;
  return (
    <div className="card flex flex-col gap-1 p-3.5">
      <span className="text-[12.5px] font-medium text-muted">{c.label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[22px] font-semibold tabular-nums">{fmtMeasure(c.simulated)}</span>
        <span className="text-[12px] text-muted">vs {fmtMeasure(c.baseline)}</span>
      </div>
      <span className="text-[12px] tabular-nums text-ink">{fmtMeasure(c.change, { signed: true })}{Number.isFinite(pct) && c.baseline.unit !== "ratio" ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</span>
      <div className="mt-auto flex gap-1"><MeasureBadge m={c.baseline} small /><MeasureBadge m={c.simulated} small /></div>
    </div>
  );
}

export default function WhatIf() {
  const region = useAppStore((s) => s.selectedRegion);
  const active = useAppStore((s) => s.activeScenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const resetGlobal = useAppStore((s) => s.resetScenario);
  const [local, setLocal] = useState<Scenario>(active);
  const [res, setRes] = useState<ScenarioResponse | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => setLocal(active), [active]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.scenario({ region, params: local }).then((r) => { setRes(r); setErr(null); }).catch((e: Error) => setErr(e));
    }, 250);
    return () => clearTimeout(t);
  }, [region, local, nonce]);

  const applied = JSON.stringify(active) === JSON.stringify(local);
  const months = MONTHS;

  return (
    <div className="space-y-5">
      <PageHeader title="What-if Scenario Simulator" description="Change six levers and compare baseline with simulated outcomes. 'Apply across platform' makes every module (Command Center, Explorer, Prediction Lab, Sankey) show the scenario.">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setLocal({ ...BASELINE }); resetGlobal(); }}><RotateCcw size={14} aria-hidden /> Reset to baseline</Button>
          <Button onClick={() => setScenario(local)} disabled={applied}><Globe2 size={14} aria-hidden /> {applied && !isBaseline(local) ? "Applied across platform" : "Apply across platform"}</Button>
        </div>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Scenario levers">
            <div className="space-y-4">
              {LEVERS.map((l) => {
                const [min, max, step] = RANGES[l.key];
                const raw = local[l.key];
                const v = raw === null ? l.nullable!.base : (raw as number);
                return (
                  <div key={l.key}>
                    <label htmlFor={`lever-${l.key}`} className="flex justify-between text-[13px]">
                      <span className="font-medium">{l.label}</span>
                      <span className="tabular-nums text-muted">{raw === null ? l.nullable!.baseLabel : `${(raw as number) > 0 && l.unit !== "" ? "+" : ""}${raw}${l.unit ? ` ${l.unit}` : ""}`}</span>
                    </label>
                    <input id={`lever-${l.key}`} type="range" min={min} max={max} step={step} value={v}
                      onChange={(e) => setLocal({ ...local, [l.key]: Number(e.target.value) })} className="w-full" />
                    <div className="flex justify-between text-[11px] text-muted"><span>{min}</span><span>{max}</span></div>
                    <p className="text-[11.5px] text-muted">{l.help}</p>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => setLocal({ ...BASELINE, ...p.s })} className="rounded-full border border-border bg-white px-2.5 py-1 text-[12px] hover:border-primary hover:text-primary">
                  {p.label}
                </button>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          {err && <ErrorCard error={err} onRetry={() => setNonce((n) => n + 1)} />}
          {!res && !err && <LoadingCard rows={3} label="Running scenario" />}
          {res && (
            <>
              <Card title="Scenario summary" subtitle={isBaseline(local) ? "Baseline — no levers changed" : describeScenario(local)}>
                <p className="text-[14px] leading-relaxed">{res.summary}</p>
                {!applied && <p className="mt-2 text-[12.5px] text-primary">Preview only — click “Apply across platform” to update the other modules.</p>}
              </Card>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {res.comparisons.filter((c) => ["dryAvailability", "dryDemand", "dryUnmet", "dryStress", "availability", "irrigationNeed", "losses", "groundwater"].includes(c.key)).map((c) => <CompareCard key={c.key} c={c} />)}
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <Card title="Scarcity risk" subtitle="Baseline → simulated (1-month horizon)">
                  <div className="flex flex-wrap items-center gap-3">
                    {res.riskBaseline && <RiskPill label={res.riskBaseline.label} level={res.riskBaseline.level} />}
                    <span className="text-muted">→</span>
                    {res.riskSimulated && <RiskPill label={res.riskSimulated.label} level={res.riskSimulated.level} />}
                  </div>
                  {res.riskSimulated && <div className="mt-2"><RiskRule risk={res.riskSimulated} /></div>}
                </Card>
                <Card title="Allocation (delivered, dry season)" subtitle="MCM by sector">
                  <Plot filename="scenario-allocation" ariaLabel="Delivered water by sector, baseline versus simulated" height={220}
                    data={[
                      { type: "bar", name: "Baseline", x: res.allocation.map((c) => c.label), y: res.allocation.map((c) => c.baseline.value), marker: { color: NEUTRAL.reference }, hovertemplate: "%{y:,.0f} MCM" },
                      { type: "bar", name: "Simulated", x: res.allocation.map((c) => c.label), y: res.allocation.map((c) => c.simulated.value), marker: { color: SERIES[0] }, hovertemplate: "%{y:,.0f} MCM" },
                    ]}
                    layout={baseLayout({ barmode: "group", bargap: 0.3, bargroupgap: 0.08, yaxis: { ...(baseLayout().yaxis as object), type: "log", title: axisTitle("MCM (log scale)") } })} />
                </Card>
              </div>
              <Card title="Monthly demand and unmet demand" subtitle="Consumptive demand (lines) and unmet demand (bars), MCM per month">
                <Plot filename="scenario-monthly" ariaLabel="Monthly demand and unmet demand, baseline versus simulated" height={300}
                  data={[
                    { type: "scatter", mode: "lines+markers", name: "Demand — baseline", x: months, y: res.monthlyBaseline.map((p) => p.consumptiveDemand.value), line: { color: NEUTRAL.reference, width: 2 }, marker: { size: 8 }, hovertemplate: "%{y:,.0f} MCM" },
                    { type: "scatter", mode: "lines+markers", name: "Demand — simulated", x: months, y: res.monthlySimulated.map((p) => p.consumptiveDemand.value), line: { color: SERIES[0], width: 2 }, marker: { size: 8 }, hovertemplate: "%{y:,.0f} MCM" },
                    { type: "bar", name: "Unmet — baseline", x: months, y: res.monthlyBaseline.map((p) => p.unmet.value), marker: { color: "#CBD5E1" }, hovertemplate: "%{y:,.0f} MCM" },
                    { type: "bar", name: "Unmet — simulated", x: months, y: res.monthlySimulated.map((p) => p.unmet.value), marker: { color: SERIES[1] }, hovertemplate: "%{y:,.0f} MCM" },
                  ]}
                  layout={baseLayout({ barmode: "group", bargap: 0.25, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("MCM per month") } })} />
              </Card>
              <Card title="All comparisons">
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead className="text-left text-[12px] text-muted"><tr className="border-b border-border"><th className="py-1.5 font-medium">Output</th><th className="text-right font-medium">Baseline</th><th className="text-right font-medium">Simulated</th><th className="text-right font-medium">Change</th></tr></thead>
                    <tbody>
                      {[...res.comparisons, ...res.sectorDemand.map((c) => ({ ...c, label: `${c.label} demand (annual)` }))].map((c) => (
                        <tr key={c.label} className="border-b border-border/60"><td className="py-1.5">{c.label}</td><td className="text-right tabular-nums">{fmtMeasure(c.baseline)}</td><td className="text-right tabular-nums">{fmtMeasure(c.simulated)}</td><td className="text-right tabular-nums">{fmtMeasure(c.change, { signed: true })}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Note>Every simulated value is labelled Simulated. Rainfall changes act on local runoff and effective rainfall, not on transboundary inflow. {res.context.scopeNote}</Note>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
