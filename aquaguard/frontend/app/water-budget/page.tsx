"use client";
/**
 * M4 Water Budget. Default tab: the national AQUASTAT budget (statistics, each with its own reference year).
 * Second tab: the monthly water-balance model (derived, national only, decision 8). The tab is kept in the URL.
 */
import { CheckCircle2, Sparkles, TriangleAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable, Plot } from "@/components/charts/Plot";
import { type FlowLink, type FlowNode, Sankey, SankeyChart } from "@/components/charts/Sankey";
import { axisTitle, baseLayout, FLOW_COLOR, NEUTRAL, SECTOR_COLOR, SERIES } from "@/components/charts/theme";
import { Button, Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { DATA_KIND_LABEL, DataStatusBadge, fromMeasure, fromMeta } from "@/components/ui/DataStatus";
import { KpiCard } from "@/components/ui/MeasureView";
import { DetailDrawer } from "@/components/ui/Overlay";
import { MeasureBadge } from "@/components/ui/Provenance";
import { Async, EmptyState, ErrorCard } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure, fmtNumber, MONTHS } from "@/lib/format";
import { rebalance } from "@/lib/format/shares";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline, scenarioQuery } from "@/lib/store/scenario";
import type { BudgetHistory, BudgetNode, BudgetResponse, BudgetState, Meta, NationalBudget, OptimizeResponse } from "@/lib/types/contract";

type View = "national" | "model";
const VIEWS: { value: View; label: string }[] = [
  { value: "national", label: "National statistics (AQUASTAT)" },
  { value: "model", label: "Monthly model (derived)" },
];

function readView(): View {
  if (typeof window === "undefined") return "national";
  return new URLSearchParams(window.location.search).get("view") === "model" ? "model" : "national";
}

export default function WaterBudget() {
  const [view, setViewState] = useState<View>("national");
  useEffect(() => setViewState(readView()), []);
  const setView = (v: View) => {
    setViewState(v);
    const p = new URLSearchParams(window.location.search);
    if (v === "model") p.set("view", "model"); else p.delete("view");
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Water Budget"
                  description="Where Bangladesh's water comes from and where it goes. The national AQUASTAT statistics are the default; the monthly water-balance model is a separate, derived view.">
        <Segmented label="Budget view" value={view} onChange={setView} options={VIEWS} />
      </PageHeader>
      {view === "national" ? <NationalView /> : <ModelView />}
    </div>
  );
}

// ---------------------------------------------------------------- national AQUASTAT budget

const NODE_COLOR = (n: BudgetNode) => FLOW_COLOR[n.id] ?? SECTOR_COLOR[n.id] ?? NEUTRAL.reference;
const refLabel = (n: BudgetNode) => (n.value.referenceYear ? `ref. ${n.value.referenceYear}` : n.value.dataKind === "derived" ? "derived" : undefined);

function NationalView() {
  const region = useAppStore((s) => s.selectedRegion) || "bd";
  const b = useApi(`water-budget|national|${region}`, () => api.waterBudget("national", { region }));
  return (
    <Async state={b} rows={3} label="Loading the national water budget">
      {(env) => env.data.national && env.data.national.nodes.length > 0
        ? <NationalBody nb={env.data.national} meta={env.meta} />
        : (
          <EmptyState title="No national budget data stored">
            No genuine AQUASTAT values for total renewable water resources are stored yet. Run the AQUASTAT sync from
            Data Sources; nothing is estimated in their place.
          </EmptyState>
        )}
    </Async>
  );
}

function yearsByPart(nb: NationalBudget): string {
  const groups = new Map<number, string[]>();
  for (const n of nb.nodes) {
    const y = n.value.referenceYear;
    if (y) groups.set(y, [...(groups.get(y) ?? []), n.label.toLowerCase()]);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([y, parts]) => `${y}: ${parts.join(", ")}`).join(" · ");
}

function NationalBody({ nb, meta }: { nb: NationalBudget; meta: Meta }) {
  const [open, setOpen] = useState<string | null>(null);
  const node = (id: string) => nb.nodes.find((n) => n.id === id);
  const trwr = node("trwr");
  const unit = trwr?.value.unit ?? "km³/yr";
  const total = trwr?.value.value ?? null;
  const flowNodes: FlowNode[] = nb.nodes.map((n) => ({
    id: n.id, color: NODE_COLOR(n), pool: n.kind === "total", detail: refLabel(n),
    label: n.value.value === null ? `${n.label} (no data)` : n.label,
  }));
  const flowLinks: FlowLink[] = nb.links.map((l) => ({ source: l.source, target: l.target, value: l.value.value ?? null }));
  const missing = nb.nodes.filter((n) => n.value.value === null);
  const selected = open ? node(open) : undefined;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DataStatusBadge info={fromMeta(meta)} />
        <span className="text-[12.5px] text-muted">FAO AQUASTAT · national · {unit}</span>
      </div>
      {meta.note && <Note>{meta.note}</Note>}
      {nb.mixedReferenceYears && (
        <Note tone="warn">
          <span className="inline-flex items-start gap-1.5">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong>Mixed reference years.</strong> The parts were not all reported for the same year ({yearsByPart(nb)}).
              The diagram combines the latest genuine value of each part, so it is not a single-year balance.
            </span>
          </span>
        </Note>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["trwr", "agriculture", "environment", "remainder"] as const).map((id) => {
          const n = node(id);
          if (!n) return null;
          return <KpiCard key={id} label={n.label} m={n.value} onOpen={() => setOpen(id)}
                          hint={n.code ? `AQUASTAT variable ${n.code}` : n.value.dataKind === "derived" ? "Derived from the parts" : "No data"} />;
        })}
      </div>
      <Card title="National water budget" subtitle={`Renewable resources by origin → uses · ${unit} and % of total renewable resources`}
            actions={trwr ? <MeasureBadge m={trwr.value} small /> : undefined}>
        <Sankey nodes={flowNodes} links={flowLinks} unit={unit} total={total} totalLabel="total renewable resources" height={400}
                filename="water-budget-national-aquastat" caption="National water budget flows (AQUASTAT)" onNodeClick={setOpen}
                ariaLabel="National water budget Sankey: renewable surface water and groundwater to total renewable water resources, then to agricultural, municipal and industrial withdrawals, the environmental flow requirement and the remainder" />
        {missing.length > 0 && (
          <p className="mt-2 text-[12.5px] text-muted" data-testid="budget-missing">
            No data: {missing.map((n) => n.label).join(", ")}. Missing parts are not drawn and nothing is estimated in their place.
          </p>
        )}
      </Card>
      <YearComparison nb={nb} onOpen={setOpen} />
      <Note>{nb.notes.join(" ")} {meta.attribution.join(" · ")}</Note>
      <DetailDrawer open={!!selected} onClose={() => setOpen(null)} title={selected?.label ?? ""}
                    subtitle={selected ? `${selected.value.dataKind ? DATA_KIND_LABEL[selected.value.dataKind] : ""} · national` : undefined}>
        {selected && <NodeDetail n={selected} nb={nb} total={total} />}
      </DetailDrawer>
    </>
  );
}

function NodeDetail({ n, nb, total }: { n: BudgetNode; nb: NationalBudget; total: number | null }) {
  const h = nb.history.find((x) => x.id === n.id);
  const v = n.value.value;
  const rows: [string, string][] = [
    ["Value", v === null ? "No data" : `${fmtNumber(v)} ${n.value.unit}`],
    ["Share of total renewable resources", v !== null && total ? `${((v / total) * 100).toFixed(1)}%` : "—"],
    ["Reference year", n.value.referenceYear ? String(n.value.referenceYear) : n.value.dataKind === "derived" ? "Mixed (derived)" : "—"],
    ["Data kind", n.value.dataKind ? DATA_KIND_LABEL[n.value.dataKind] : "—"],
    ["Source", "FAO AQUASTAT"],
    ...(n.code ? [["AQUASTAT variable", `${n.code}${n.indicator ? ` · ${n.indicator}` : ""}`] as [string, string]] : []),
  ];
  const parts = nb.nodes.filter((x) => x.kind === "use");
  return (
    <div className="space-y-4 text-[13px]">
      <DataStatusBadge info={fromMeasure(n.value)} />
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-3 gap-y-1.5">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums">{val}</dd>
          </div>
        ))}
      </dl>
      {n.value.note && <p className="text-[12.5px] text-muted">{n.value.note}</p>}
      {n.kind === "remainder" && (
        <div>
          <h3 className="mb-1 text-[12.5px] font-semibold">How it is derived</h3>
          <p className="text-[12.5px] text-muted">
            Total renewable water resources − {parts.map((p) => p.label.toLowerCase()).join(" − ")}. Each part keeps its own reference year.
          </p>
        </div>
      )}
      {h ? (
        <div>
          <h3 className="mb-1 text-[12.5px] font-semibold">Genuine reference years</h3>
          <DataTable caption={`${n.label}: genuine AQUASTAT reference years`} head={["Year", h.unit]} maxHeight={260}
                     rows={[...h.points].reverse().map((p) => [p.referenceYear ?? "—", p.value ?? null])} />
          <p className="mt-1 text-[12px] text-muted">Imputed values are excluded; years are never interpolated.</p>
        </div>
      ) : n.kind !== "remainder" && <p className="text-[12.5px] text-muted">No genuine AQUASTAT values are stored for this part.</p>}
    </div>
  );
}

/** Default comparison year: the newest earlier reference year in which some part has a different genuine value. */
function defaultYear(nb: NationalBudget): number | null {
  const changed: number[] = [];
  for (const h of nb.history) {
    const ref = nb.nodes.find((n) => n.id === h.id)?.value.referenceYear;
    const now = ref ? valueIn(h, ref) : null;
    for (const p of h.points) if (ref && now !== null && p.referenceYear && p.referenceYear < ref && p.value !== now) changed.push(p.referenceYear);
  }
  if (changed.length) return Math.max(...changed);
  return nb.comparisonYears.length ? nb.comparisonYears[nb.comparisonYears.length - 1] : null;
}

function valueIn(h: BudgetHistory | undefined, year: number): number | null {
  return h?.points.find((p) => p.referenceYear === year)?.value ?? null;
}

function YearComparison({ nb, onOpen }: { nb: NationalBudget; onOpen: (id: string) => void }) {
  const [year, setYear] = useState<number | null>(() => defaultYear(nb));
  const rows = useMemo(() => nb.nodes.filter((n) => n.kind !== "remainder").map((n) => {
    const h = nb.history.find((x) => x.id === n.id);
    const then = year === null ? null : valueIn(h, year);
    const now = n.value.value;
    const same = year !== null && n.value.referenceYear === year;
    // compare at the history's precision (the node value is rounded for display)
    const nowExact = n.value.referenceYear ? valueIn(h, n.value.referenceYear) ?? now : now;
    const change = nowExact !== null && then !== null && !same ? nowExact - then : null;
    return { n, now, then, same, change };
  }), [nb, year]);
  if (!nb.comparisonYears.length) {
    return <Card title="Compare years"><p className="text-[13px] text-muted">No genuine reference years are stored, so there is nothing to compare.</p></Card>;
  }
  const unit = nb.nodes[0]?.value.unit ?? "";
  return (
    <Card title="Compare with an earlier reference year" subtitle="Only years with a genuine AQUASTAT value are offered; a part without a value in that year shows “No data”">
      <label className="mb-3 inline-flex items-center gap-2 text-[13px]">
        <span>Compare latest values with</span>
        <select aria-label="Comparison year" value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-lg border border-border bg-white px-2 py-1.5 text-[13px]">
          {[...nb.comparisonYears].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Year comparison table">
        <table className="w-full min-w-[560px] text-[13px]">
          <caption className="sr-only">Latest budget values compared with {year}</caption>
          <thead className="text-left text-[12px] text-muted">
            <tr className="border-b border-border">
              <th className="py-1.5 font-medium">Part</th>
              <th className="text-right font-medium">Latest ({unit})</th>
              <th className="text-right font-medium">{year} ({unit})</th>
              <th className="text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ n, now, then, same, change }) => (
              <tr key={n.id} className="border-b border-border/60">
                <td className="py-1.5">
                  <button type="button" onClick={() => onOpen(n.id)} className="inline-flex items-center gap-1.5 text-left hover:underline">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NODE_COLOR(n) }} aria-hidden />{n.label}
                  </button>
                </td>
                <td className="text-right tabular-nums">{now === null ? "No data" : `${fmtNumber(now)} (${n.value.referenceYear})`}</td>
                <td className="text-right tabular-nums">{then === null ? "No data" : fmtNumber(then)}</td>
                <td className="text-right tabular-nums">
                  {same ? <span className="text-muted">same year</span>
                    : change === null ? <span className="text-muted">—</span>
                      : `${change > 0 ? "+" : change < 0 ? "−" : "±"}${fmtNumber(Math.abs(change))}${then ? ` (${change >= 0 ? "+" : "−"}${Math.abs((change / then) * 100).toFixed(1)}%)` : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- monthly model (derived, national)

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
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Sector detail table">
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

function Optimizer({ period, base }: { period: string; base: BudgetState }) {
  const scenario = useAppStore((s) => s.activeScenario);
  const initial = Object.fromEntries(base.sectors.map((r) => [r.sector, Math.round((r.share.value ?? 0) * 1000) / 10]));
  const [shares, setShares] = useState<Record<string, number>>(rebalance(initial, "agriculture", initial.agriculture ?? 25));
  const [res, setRes] = useState<OptimizeResponse | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (mode: "optimized" | "shares") => {
    setBusy(true);
    try {
      setRes(await api.optimize({ region: "bd", period, scenario, mode, shares: mode === "shares" ? shares : null }));
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

function ModelNodeDetail({ id, s }: { id: string; s: BudgetState }) {
  const label = (x: string) => s.nodes.find((n) => n.id === x)?.label ?? x;
  const inflow = s.links.filter((l) => l.target === id);
  const outflow = s.links.filter((l) => l.source === id);
  const sector = s.sectors.find((r) => r.sector === id);
  const rows: (string | number | null)[][] = [
    ...inflow.map((l) => [`From ${label(l.source)}`, l.value.value ?? null]),
    ...outflow.map((l) => [`To ${label(l.target)}`, l.value.value ?? null]),
    ...(sector ? [["Demand", sector.demand.value ?? null], ["Allocated", sector.allocation.value ?? null],
                  ["Delivered", sector.delivered.value ?? null], ["Unmet", sector.unmet.value ?? null]] : []),
  ];
  return (
    <div className="space-y-3 text-[13px]">
      <DataStatusBadge info={fromMeasure(inflow[0]?.value ?? outflow[0]?.value ?? s.supply)} />
      <DataTable caption={`${label(id)} flows (MCM)`} head={["Flow", "MCM"]} rows={rows} />
      <p className="text-[12px] text-muted">Monthly water-balance model (derived). National totals; not observed allocation data.</p>
    </div>
  );
}

function ModelView() {
  const region = useAppStore((s) => s.selectedRegion) || "bd";
  const scenario = useAppStore((s) => s.activeScenario);
  const [period, setPeriod] = useState("dry");
  const [open, setOpen] = useState<string | null>(null);
  const b = useApi(`water-budget|derived|${period}|${scenarioQuery(scenario)}`, () => api.waterBudget("derived", { period, scenario }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Period" value={period.length <= 2 ? "month" : period} onChange={(v) => setPeriod(v === "month" ? "1" : v)}
                   options={[{ value: "dry", label: "Dry season" }, { value: "annual", label: "Annual" }, { value: "month", label: "Month" }]} />
        {period.length <= 2 && (
          <select aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-[13px]">
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        )}
      </div>
      {region !== "bd" && <Note>The monthly model runs for Bangladesh as a whole; the division selected in the header does not change it.</Note>}
      {!isBaseline(scenario) && (
        <Note tone="warn">Scenario applied: {describeScenario(scenario)}. Change or reset the levers on the <Link href="/what-if" className="font-medium text-primary underline">What-if</Link> page.</Note>
      )}
      <Async state={b} rows={3} label="Loading the monthly model budget">
        {(env) => {
          const d = env.data.derived as BudgetResponse | null | undefined;
          if (!d) return <EmptyState title="Model budget unavailable">The monthly model returned no budget for this period.</EmptyState>;
          return (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <DataStatusBadge info={fromMeta(env.meta)} />
                <span className="text-[12.5px] text-muted">{env.meta.note}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label={`Total available · ${d.periodLabel}`} m={d.current.supply} hint={<span>surface {fmtMeasure(d.current.surface)} · groundwater {fmtMeasure(d.current.groundwater)}</span>} />
                <KpiCard label="Distribution losses" m={d.current.losses} />
                <KpiCard label="Unmet demand" m={d.current.unmetTotal} />
                <KpiCard label="Balance check">
                  <div className="py-2"><BalanceIndicator s={d.current} /></div>
                  <p className="text-[12px] text-muted">Supply = Σ delivered + losses + storage change, tolerance 0.01 MCM.</p>
                </KpiCard>
              </div>
              <Card title={`Model water budget — ${d.periodLabel}`} subtitle="Bangladesh · MCM and % of total available · derived" actions={<MeasureBadge m={d.current.supply} small />}>
                <SankeyChart state={d.current} filename={`sankey-model-${period}`} onNodeClick={setOpen} />
              </Card>
              <Card title="Sector detail" subtitle="'Current' is a pro-rata proxy of current practice, not observed allocation data">
                <SectorTable s={d.current} />
              </Card>
              <Optimizer key={`${period}|${scenarioQuery(scenario)}`} period={period} base={d.current} />
              <Note>{d.notes.join(" ")}</Note>
              <DetailDrawer open={!!open} onClose={() => setOpen(null)} title={d.current.nodes.find((n) => n.id === open)?.label ?? ""} subtitle={`Monthly model · ${d.periodLabel}`}>
                {open && <ModelNodeDetail id={open} s={d.current} />}
              </DetailDrawer>
            </>
          );
        }}
      </Async>
    </>
  );
}
