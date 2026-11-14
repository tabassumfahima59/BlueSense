"use client";
import { Globe2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SERIES } from "@/components/charts/theme";
import { Button, Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, fromMeasure } from "@/components/ui/DataStatus";
import { RiskPill, RiskRule } from "@/components/ui/Risk";
import { ErrorCard, LoadingCard } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { fmtMeasure, MONTHS } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline, RANGES, scenarioToParams } from "@/lib/store/scenario";
import { BASELINE, type Compare, type Scenario, type WhatIf } from "@/lib/types/contract";

type Basis = "latest" | "normal";
function readBasis(): Basis {
  if (typeof window === "undefined") return "latest";
  return new URLSearchParams(window.location.search).get("basis") === "normal" ? "normal" : "latest";
}

const PRESETS: { label: string; s: Partial<Scenario> }[] = [
  { label: "Dry year: rainfall −20%", s: { rainfallChangePct: -20 } },
  { label: "Hot & dry: −20% rain, +1.5 °C", s: { rainfallChangePct: -20, temperatureChangeC: 1.5 } },
  { label: "Efficiency push: irrigation efficiency 0.90", s: { irrigationEfficiency: 0.9 } },
  { label: "Groundwater stress: −30%", s: { groundwaterAvailabilityPct: -30 } },
  { label: "Urban growth: demand +30%", s: { demandChangePct: 30 } },
  { label: "More irrigation: agriculture +20%", s: { agriculturalDemandChangePct: 20 } },
  { label: "Leaky network: loss 35%", s: { pipelineLossPct: 35 } },
];

const LEVERS: { key: keyof Scenario; label: string; unit: string; help: string; nullable?: { base: number; baseLabel: string } }[] = [
  { key: "rainfallChangePct", label: "Rainfall change", unit: "%", help: "Changes local runoff and effective rainfall (FAO-56)" },
  { key: "temperatureChangeC", label: "Temperature change", unit: "°C", help: "Scales ET0 by the Hargreaves ratio → crop water need" },
  { key: "demandChangePct", label: "Domestic & industrial demand", unit: "%", help: "Population/economic demand growth" },
  { key: "agriculturalDemandChangePct", label: "Agricultural consumption", unit: "%", help: "Scales the gross irrigation demand (FAO-56)" },
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
      <div className="mt-auto flex flex-wrap gap-1">
        {fromMeasure(c.baseline) && <DataStatusBadge compact info={{ ...fromMeasure(c.baseline)!, note: `Baseline: ${c.baseline.observedAt ?? ""}` }} />}
        {fromMeasure(c.simulated) && <DataStatusBadge compact info={fromMeasure(c.simulated)} />}
      </div>
    </div>
  );
}

export default function WhatIf() {
  const region = useAppStore((s) => s.selectedRegion);
  const active = useAppStore((s) => s.activeScenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const resetGlobal = useAppStore((s) => s.resetScenario);
  const [local, setLocal] = useState<Scenario>(active);
  const [data, setData] = useState<WhatIf | null>(null);
  const res = data?.result ?? null;
  const [basis, setBasisState] = useState<Basis>("latest");
  useEffect(() => setBasisState(readBasis()), []);
  const setBasis = (b: Basis) => {
    setBasisState(b);
    const p = new URLSearchParams(window.location.search);
    if (b === "normal") p.set("basis", "normal"); else p.delete("basis");
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };
  const [err, setErr] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => setLocal(active), [active]);
  // keep the levers in the URL (same keys as the platform scenario) so a what-if link reloads with them
  useEffect(() => {
    const p = scenarioToParams(local, new URLSearchParams(window.location.search));
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [local]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.whatif({ region: region || "bd", params: local, basis }).then((r) => { setData(r.data); setErr(null); }).catch((e: Error) => setErr(e));
    }, 250);
    return () => clearTimeout(t);
  }, [region, local, nonce, basis]);

  const applied = JSON.stringify(active) === JSON.stringify(local);
  const months = MONTHS;

  return (
    <div className="space-y-5">
      <PageHeader title="What-if Scenario Simulator" description="Deterministic national water-balance model: change the levers and compare the baseline (latest real data) with the scenario. Every result is labelled Scenario. 'Apply across platform' carries the levers to the other modules.">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setLocal({ ...BASELINE }); resetGlobal(); }}><RotateCcw size={14} aria-hidden /> Reset to baseline</Button>
          <Button onClick={() => setScenario(local)} disabled={applied}><Globe2 size={14} aria-hidden /> {applied && !isBaseline(local) ? "Applied across platform" : "Apply across platform"}</Button>
        </div>
      </PageHeader>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Baseline" subtitle={data?.basisPeriod ? `Weather: ${data.basisPeriod}` : "Loading…"}>
            <Segmented label="Baseline weather" value={basis} onChange={setBasis}
                       options={[{ value: "latest", label: "Latest 12 months" }, { value: "normal", label: "1991–2020 normal" }]} />
            <p className="mt-2 text-[12px] text-muted">Statistics are the latest genuine AQUASTAT reference years. Results are for Bangladesh as a whole.</p>
          </Card>
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
          {region !== "bd" && <Note>National model: results are for Bangladesh. National statistics cannot be split into divisions (decision 1).</Note>}
          {err && <ErrorCard error={err} onRetry={() => setNonce((n) => n + 1)} />}
          {!res && !err && <LoadingCard rows={3} label="Running scenario" />}
          {res && (
            <>
              <Card title="Scenario summary" subtitle={isBaseline(local) ? "Baseline — no levers changed" : describeScenario(local)}>
                <p className="text-[14px] leading-relaxed">{res.summary}</p>
                {!applied && <p className="mt-2 text-[12.5px] text-primary">Preview only — click “Apply across platform” to update the other modules.</p>}
              </Card>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {res.comparisons.filter((c) => ["dryAvailability", "dryDemand", "dryUnmet", "dryStress", "availability", "irrigationNeed", "losses", "groundwater"].includes(c.key)).map((c) => <CompareCard key={c.key} c={c} />)}
              </div>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
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
              {data?.method && data.method.length > 0 && (
                <Card title="Model and method" subtitle="Deterministic; the same inputs always give the same result">
                  <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink">{data.method.map((m) => <li key={m}>{m}</li>)}</ul>
                </Card>
              )}
              <Note>Every result is labelled Scenario and every baseline value Derived. Rainfall changes act on local runoff and effective rainfall, not on transboundary inflow.</Note>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
