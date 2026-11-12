"use client";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { SankeyChart } from "@/components/charts/Sankey";
import { axisTitle, baseLayout, SECTOR_COLOR, SERIES } from "@/components/charts/theme";
import { Button, Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/MeasureView";
import { MeasureBadge } from "@/components/ui/Provenance";
import { Async, ErrorCard } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure, MONTHS } from "@/lib/format";
import { rebalance } from "@/lib/format/shares";
import { useRegionScenario } from "@/lib/store/hooks";
import type { BudgetState, OptimizeResponse } from "@/lib/types/contract";

const SECTORS = ["agriculture", "domestic", "industry", "environment"] as const;
const LABEL: Record<string, string> = { agriculture: "Agriculture", domestic: "Domestic", industry: "Industry", environment: "Environment" };

function BalanceIndicator({ s }: { s: BudgetState }) {
  return s.balanced ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-success/50 bg-[#e8f8f2] px-2 py-0.5 text-[12px] font-medium text-[#0f7a55]">
      <CheckCircle2 size={13} aria-hidden /> Balanced: input = output (|error| {Math.abs(s.balanceError.value ?? 0).toFixed(4)} MCM)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-risk/50 bg-[#fdeeee] px-2 py-0.5 text-[12px] font-medium text-[#b42318]">
      <XCircle size={13} aria-hidden /> Not balanced (|error| {Math.abs(s.balanceError.value ?? 0).toFixed(4)} MCM)
    </span>
  );
}

function SectorTable({ s }: { s: BudgetState }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead className="text-left text-[12px] text-muted">
          <tr className="border-b border-border"><th className="py-1.5 font-medium">Sector</th><th className="text-right font-medium">Demand</th><th className="text-right font-medium">Allocated</th><th className="text-right font-medium">Delivered</th><th className="text-right font-medium">Unmet</th><th className="text-right font-medium">Share</th></tr>
        </thead>
        <tbody>
          {s.sectors.map((r) => (
            <tr key={r.sector} className="border-b border-border/60">
              <td className="py-1.5"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: SECTOR_COLOR[r.sector] }} aria-hidden />{LABEL[r.sector]}</td>
              <td className="text-right tabular-nums">{fmtMeasure(r.demand)}</td>
              <td className="text-right tabular-nums">{fmtMeasure(r.allocation)}</td>
              <td className="text-right tabular-nums">{fmtMeasure(r.delivered)}</td>
              <td className="text-right tabular-nums">{fmtMeasure(r.unmet)}</td>
              <td className="text-right tabular-nums">{fmtMeasure(r.share)}</td>
            </tr>
          ))}
          <tr className="border-b border-border/60 text-muted"><td className="py-1.5">Distribution losses</td><td /><td /><td className="text-right tabular-nums">{fmtMeasure(s.losses)}</td><td /><td /></tr>
          <tr className="text-muted"><td className="py-1.5">Unallocated (storage / outflow)</td><td /><td /><td className="text-right tabular-nums">{fmtMeasure(s.storageChange)}</td><td /><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

function Optimizer({ region, period, base }: { region: string; period: string; base: BudgetState }) {
  const { scenario } = useRegionScenario();
  const initial = Object.fromEntries(base.sectors.map((r) => [r.sector, Math.round((r.share.value ?? 0) * 1000) / 10]));
  const [shares, setShares] = useState<Record<string, number>>(rebalance(initial, "agriculture", initial.agriculture ?? 25));
  const [res, setRes] = useState<OptimizeResponse | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (mode: "optimized" | "shares") => {
    setBusy(true);
    try {
      setRes(await api.optimize({ region, period, scenario, mode, shares: mode === "shares" ? shares : null }));
      setErr(null);
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  return (
    <Card title="Allocation: current vs optimized" subtitle="Run the optimizer (domestic first, environmental minimum protected) or set your own shares">
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Button onClick={() => run("optimized")} disabled={busy} className="w-full justify-center"><Sparkles size={14} aria-hidden /> Optimize allocation</Button>
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-[12.5px] font-medium">Custom shares of allocable supply (total {total.toFixed(1)}%)</legend>
            {SECTORS.map((k) => (
              <label key={k} className="block text-[12.5px]">
                <span className="flex justify-between"><span>{LABEL[k]}</span><span className="tabular-nums">{shares[k]?.toFixed(1)}%</span></span>
                <input type="range" min={0} max={100} step={0.5} value={shares[k] ?? 0} onChange={(e) => setShares(rebalance(shares, k, Number(e.target.value)))} className="w-full" />
              </label>
            ))}
            <Button variant="secondary" onClick={() => run("shares")} disabled={busy} className="w-full justify-center">Apply custom shares</Button>
          </fieldset>
        </div>
        <div>
          {err && <ErrorCard error={err} />}
          {!res && !err && <p className="text-[13px] text-muted">Results appear here. Each proposal is re-balanced by the same engine and must pass the 0.01 MCM balance check.</p>}
          {res && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-4">
                {Object.entries(res.savings).map(([k, m]) => (
                  <div key={k} className="rounded-lg bg-primary-soft p-2 text-[12.5px]">
                    <div className="text-muted">{{ unmetReduction: "Unmet demand reduced", domesticUnmetReduction: "Domestic unmet reduced", lossChange: "Change in losses", deliveredGain: "Extra delivered" }[k] ?? k}</div>
                    <div className="font-semibold">{fmtMeasure(m, { signed: true })}</div>
                  </div>
                ))}
              </div>
              <Plot filename="allocation-current-vs-proposed" ariaLabel="Delivered water by sector, current versus proposed" height={260}
                data={[
                  { type: "bar", name: "Current", x: SECTORS.map((k) => LABEL[k]), y: res.current.sectors.map((r) => r.delivered.value), marker: { color: SERIES[1] }, hovertemplate: "%{y:,.0f} MCM" },
                  { type: "bar", name: res.method.startsWith("Linear") ? "Optimized" : "Custom shares", x: SECTORS.map((k) => LABEL[k]), y: res.proposed.sectors.map((r) => r.delivered.value), marker: { color: SERIES[0] }, hovertemplate: "%{y:,.0f} MCM" },
                ]}
                layout={baseLayout({ barmode: "group", bargap: 0.3, bargroupgap: 0.08, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("Delivered (MCM)"), type: "log" } })} />
              <div className="flex flex-wrap items-center gap-2 text-[12px]"><BalanceIndicator s={res.proposed} /> <MeasureBadge m={res.proposed.supply} small /></div>
              <p className="text-[12px] text-muted">{res.method}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function WaterBudget() {
  const { region, scenario, key } = useRegionScenario();
  const [period, setPeriod] = useState("dry");
  const b = useApi(`budget|${period}|${key}`, () => api.budget(region, period, scenario));
  return (
    <div className="space-y-5">
      <PageHeader title="Water Budget Sankey" description="Where water comes from and where it goes: surface and groundwater → total available → agriculture, domestic, industry, environment and distribution losses. Inputs always equal outputs.">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Period" value={period.length <= 2 ? "month" : period} onChange={(v) => setPeriod(v === "month" ? "1" : v)}
            options={[{ value: "dry", label: "Dry season" }, { value: "annual", label: "Annual" }, { value: "month", label: "Month" }]} />
          {period.length <= 2 && (
            <select aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-[13px]">
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
          )}
        </div>
      </PageHeader>
      <Async state={b} rows={3} label="Loading water budget">
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label={`Total available · ${d.periodLabel}`} m={d.current.supply} hint={<span>surface {fmtMeasure(d.current.surface)} · groundwater {fmtMeasure(d.current.groundwater)}</span>} />
              <KpiCard label="Distribution losses" m={d.current.losses} />
              <KpiCard label="Unmet demand" m={d.current.unmetTotal} />
              <KpiCard label="Balance check">
                <div className="py-2"><BalanceIndicator s={d.current} /></div>
                <p className="text-[12px] text-muted">Supply = Σ delivered + losses + storage change, tolerance 0.01 MCM.</p>
              </KpiCard>
            </div>
            <Card title={`Water budget — ${d.periodLabel}`} subtitle={`${d.context.region.name} · MCM and % of total available`} actions={<MeasureBadge m={d.current.supply} small />}>
              <SankeyChart state={d.current} filename={`sankey-${d.context.region.id}-${period}`} />
            </Card>
            <Card title="Sector detail" subtitle="'Current' is a pro-rata proxy of current practice, not observed allocation data">
              <SectorTable s={d.current} />
            </Card>
            <Optimizer key={`${key}|${period}`} region={region} period={period} base={d.current} />
            <Note>
              {d.notes.join(" ")} {d.context.region.level === "district" && d.context.scopeNote} Provenance: <MeasureBadge m={d.current.supply} small />
            </Note>
          </>
        )}
      </Async>
    </div>
  );
}
