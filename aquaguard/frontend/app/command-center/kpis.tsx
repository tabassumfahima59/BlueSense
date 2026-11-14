"use client";
/**
 * Command Center KPIs (master prompt §6.1, plan §3): five cards from GET /api/dashboard/summary. Each card shows
 * value, unit, date, data kind and status, and a comparison only with a real earlier value of the same time step.
 * Clicking a card opens a DetailDrawer with its chart, formula and sources.
 */
import { Droplets, Gauge, Layers, Sprout, Waves } from "lucide-react";
import type { ReactNode } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SERIES } from "@/components/charts/theme";
import { DataStatusBadge, DATA_KIND_LABEL, fromMeasure } from "@/components/ui/DataStatus";
import { KpiCard } from "@/components/ui/MeasureView";
import { DetailDrawer } from "@/components/ui/Overlay";
import { EmptyState, ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { fmtDateTime, monthLabel } from "@/lib/format/time";
import type { DashboardSummary, Kpi, Measure, StatSeries } from "@/lib/types/contract";

const ICONS: Record<string, ReactNode> = {
  availability: <Droplets size={16} />, demand: <Layers size={16} />, utilization: <Gauge size={16} />,
  groundwater: <Waves size={16} />, saving: <Sprout size={16} />,
};

export function comparisonText(k: Kpi): string {
  if (!k.comparison || k.comparison.value === null) {
    return k.key === "demand" && k.value.dataKind === "statistic"
      ? "No other genuine reference year to compare"
      : k.key === "saving" ? "Scenario — no comparison" : "No earlier value to compare";
  }
  return `${fmtMeasure(k.comparison, { signed: true })} ${k.comparisonLabel ?? ""}`.trim();
}

export function KpiGrid({ data, onOpen }: { data: DashboardSummary; onOpen: (k: Kpi) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {data.kpis.map((k) => (
        <KpiCard key={k.key} label={k.label} m={k.value} icon={ICONS[k.key]} onOpen={() => onOpen(k)}
                 hint={<span>{comparisonText(k)}</span>}>
          <div className="text-[26px] font-semibold leading-tight tabular-nums text-ink">{fmtMeasure(k.value)}</div>
          {k.classLabel && <div className="text-[12.5px] font-medium text-primary-dark">{k.classLabel}</div>}
          {k.note && <div className="text-[12px] text-muted">{k.note}</div>}
        </KpiCard>
      ))}
    </div>
  );
}

function MeasureFacts({ m }: { m: Measure }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      <dt className="text-muted">Data kind</dt><dd>{m.dataKind ? DATA_KIND_LABEL[m.dataKind] : m.provenance}</dd>
      <dt className="text-muted">Source</dt><dd>{m.sourceId ?? "—"}</dd>
      <dt className="text-muted">Observed</dt><dd>{m.referenceYear ? `Reference year ${m.referenceYear}` : m.observedAt ?? "—"}</dd>
      <dt className="text-muted">Retrieved</dt><dd>{fmtDateTime(m.retrievedAt)}</dd>
      <dt className="text-muted">Spatial level</dt><dd>{m.spatialLevel ?? "—"}</dd>
      {m.note && <><dt className="text-muted">Note</dt><dd>{m.note}</dd></>}
    </dl>
  );
}

/** Lines + markers at genuine reference years only (no interpolation between missing years). */
function ReferenceYears({ series, logY = false, bands }: { series: StatSeries[]; logY?: boolean; bands?: number[] }) {
  const unit = series[0]?.unit ?? "";
  const data = series.map((s, i) => {
    const pts = s.points.filter((p) => p.value !== null);
    return {
      type: "scatter", mode: pts.length > 1 ? "lines+markers" : "markers", name: s.label,
      x: pts.map((p) => p.referenceYear), y: pts.map((p) => p.value),
      line: { color: SERIES[i % SERIES.length], width: 2 }, marker: { size: 9, color: SERIES[i % SERIES.length] },
      hovertemplate: `%{x}: %{y:,.2f} ${s.unit}<extra>${s.label}</extra>`,
    };
  });
  const shapes = (bands ?? []).map((y) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
                                             line: { color: NEUTRAL.axis, width: 1, dash: "dot" } }));
  return (
    <Plot data={data} height={260} filename="reference-years" ariaLabel={`${series.map((s) => s.label).join(", ")} by reference year`}
          tableKeyLabel="Reference year"
          layout={baseLayout({ shapes, xaxis: { ...baseLayout().xaxis as object, title: axisTitle("Reference year"), dtick: 2 },
                               yaxis: { ...baseLayout().yaxis as object, title: axisTitle(logY ? `${unit} (log scale)` : unit), type: logY ? "log" : "linear" } })} />
  );
}

function AquastatChart({ codes, logY, bands, note }: { codes: number[]; logY?: boolean; bands?: number[]; note?: string }) {
  const h = useApi(`water-history|${codes.join(",")}`, () => api.waterHistory(codes));
  if (h.error) return <ErrorCard error={h.error} onRetry={h.retry} />;
  if (!h.data) return <Skeleton className="h-[260px] w-full" />;
  if (!h.data.data.series.length) return <EmptyState title="No data">AQUASTAT has no genuine values for these indicators.</EmptyState>;
  return (
    <div className="space-y-2">
      <ReferenceYears series={h.data.data.series} logY={logY} bands={bands} />
      <p className="text-[12px] text-muted">{note ?? h.data.data.note}</p>
    </div>
  );
}

function StorageChart({ region }: { region: string }) {
  const start = `${new Date().getUTCFullYear() - 4}-01`;
  const g = useApi(`gw|${region}|${start}`, () => api.groundwaterTrends(region, start));
  if (g.error) return <ErrorCard error={g.error} onRetry={g.retry} />;
  if (!g.data) return <Skeleton className="h-[260px] w-full" />;
  const d = g.data.data;
  return (
    <div className="space-y-2">
      <Plot height={260} filename="tws-anomaly" ariaLabel="GRACE total water storage anomaly by month" tableKeyLabel="Month"
            data={[{ type: "scatter", mode: "lines+markers", name: "TWS anomaly", x: d.series.map((p) => p.t), y: d.series.map((p) => p.v),
                     line: { color: SERIES[0], width: 2 }, marker: { size: 8 }, connectgaps: false, hovertemplate: "%{x}: %{y:.1f} cm<extra></extra>" }]}
            layout={baseLayout({ yaxis: { ...baseLayout().yaxis as object, title: axisTitle("cm equivalent water height") } })} />
      <p className="text-[12px] text-muted">{d.quantity}. {d.resolutionNote} Months without a solution stay empty (e.g. the 2017–2018 gap between missions).</p>
    </div>
  );
}

function RainVsEt0({ region }: { region: string }) {
  const w = useApi(`wh-daily30|${region}`, () => api.weatherHistory(region, { step: "daily" }));
  if (w.error) return <ErrorCard error={w.error} onRetry={w.retry} />;
  if (!w.data) return <Skeleton className="h-[260px] w-full" />;
  const s = Object.fromEntries(w.data.data.series.map((x) => [x.variable, x]));
  const p = s.precip_mm;
  const e = s.et0_mm;
  const n = 30;
  return (
    <Plot height={260} filename="rain-et0-30d" ariaLabel="Daily rainfall and reference ET0, last 30 days" tableKeyLabel="Date"
          data={[
            { type: "bar", name: "Rainfall", x: p?.t.slice(-n), y: p?.v.slice(-n), marker: { color: SERIES[0] }, hovertemplate: "%{x}: %{y:.1f} mm<extra></extra>" },
            { type: "scatter", mode: "lines+markers", name: "Reference ET0", x: e?.t.slice(-n), y: e?.v.slice(-n), line: { color: SERIES[1], width: 2 }, marker: { size: 8 }, hovertemplate: "%{x}: %{y:.1f} mm<extra></extra>" },
          ]}
          layout={baseLayout({ yaxis: { ...baseLayout().yaxis as object, title: axisTitle("mm per day") } })} />
  );
}

function SavingControl({ kpi, target, onTarget }: { kpi: Kpi; target: number; onTarget: (v: number) => void }) {
  const current = kpi.context?.find((m) => m.unit === "ratio")?.value ?? 0.78;
  const min = Math.round((current + 0.01) * 100) / 100;
  return (
    <div className="space-y-2">
      <label htmlFor="target-eff" className="block text-[13px] font-medium text-ink">
        Target irrigation efficiency: <span className="tabular-nums">{target.toFixed(2)}</span>
      </label>
      <input id="target-eff" type="range" min={min} max={0.95} step={0.01} value={Math.max(target, min)}
             onChange={(e) => onTarget(Number(e.target.value))} className="w-full" aria-describedby="target-eff-help" />
      <p id="target-eff-help" className="text-[12px] text-muted">
        Current efficiency {current.toFixed(2)} (AQUASTAT irrigation requirement ÷ agricultural withdrawal). The saving is a
        scenario, not a measurement; it updates as you move the slider.
      </p>
    </div>
  );
}

export function KpiDrawer({ kpi, region, onClose, target, onTarget }: {
  kpi: Kpi | null; region: string; onClose: () => void; target: number; onTarget: (v: number) => void;
}) {
  if (!kpi) return null;
  const status = fromMeasure(kpi.value);
  const division = kpi.value.spatialLevel === "point";
  return (
    <DetailDrawer open onClose={onClose} title={kpi.label} subtitle={comparisonText(kpi)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[28px] font-semibold tabular-nums text-ink">{fmtMeasure(kpi.value)}</span>
          {status && <DataStatusBadge info={status} />}
          {kpi.classLabel && <span className="rounded-full border border-primary/30 bg-light px-2 py-0.5 text-[12px] font-medium text-primary-dark">{kpi.classLabel}</span>}
        </div>
        <section aria-label="Chart">
          {kpi.key === "availability" && <AquastatChart codes={[4188, 4185, 4187, 4549]} />}
          {kpi.key === "demand" && (division ? <RainVsEt0 region={region} />
            : <AquastatChart codes={[4253, 4250, 4251, 4252]} note="Withdrawals exist for reference year 2008 only (and municipal/industrial 1990); later AQUASTAT years are imputed and not shown." />)}
          {kpi.key === "utilization" && <AquastatChart codes={[4550]} bands={[25, 50, 75, 100]}
            note="Dotted lines: FAO SDG 6.4.2 class limits (25 / 50 / 75 / 100 %). AQUASTAT values after 2008 are FAO estimates (symbol E)." />}
          {kpi.key === "groundwater" && <StorageChart region={region} />}
          {kpi.key === "saving" && <SavingControl kpi={kpi} target={target} onTarget={onTarget} />}
        </section>
        <section className="space-y-1.5">
          <h3 className="text-[13.5px] font-semibold text-ink">Formula</h3>
          <p className="text-[13px] leading-relaxed text-ink">{kpi.formula}</p>
          {kpi.note && <p className="text-[12.5px] text-muted">{kpi.note}</p>}
        </section>
        <section className="space-y-1.5">
          <h3 className="text-[13.5px] font-semibold text-ink">Source and dates</h3>
          <MeasureFacts m={kpi.value} />
        </section>
        {kpi.context && kpi.context.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[13.5px] font-semibold text-ink">Context</h3>
            {kpi.context.map((m, i) => (
              <div key={i} className="rounded-lg border border-border bg-white/70 p-2.5">
                <div className="text-[14px] font-medium tabular-nums">{fmtMeasure(m)} {m.observedAt && <span className="text-[12px] text-muted">· {m.observedAt.length === 7 ? monthLabel(m.observedAt) : m.observedAt}</span>}</div>
                {m.note && <p className="text-[12px] text-muted">{m.note}</p>}
              </div>
            ))}
          </section>
        )}
      </div>
    </DetailDrawer>
  );
}
