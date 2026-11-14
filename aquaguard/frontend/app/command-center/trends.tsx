"use client";
/**
 * Trends on the Command Center:
 * - Availability vs demand by AQUASTAT reference year (genuine years only, never interpolated; national).
 * - Monthly weather anomalies against the 1991-2020 normal, following the global date filter over the whole archive.
 * - Model checks (legacy national engine vs AQUASTAT), loaded only when expanded.
 */
import { useState } from "react";
import { effectiveRange, useDateBounds } from "@/components/layout/DateFilter";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, SERIES } from "@/components/charts/theme";
import { Card } from "@/components/ui/Card";
import { DataStatusBadge, fromMeta } from "@/components/ui/DataStatus";
import { MeasureText } from "@/components/ui/MeasureView";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { monthLabel } from "@/lib/format/time";
import { useAppStore } from "@/lib/store";
import { BASELINE } from "@/lib/types/contract";

export function AvailabilityDemand({ national }: { national: boolean }) {
  const h = useApi("water-history|4188,4253", () => api.waterHistory([4188, 4253]));
  return (
    <Card title="Availability vs demand by reference year" subtitle="AQUASTAT national statistics; markers only where a genuine reference year exists"
          actions={h.data && <DataStatusBadge info={fromMeta(h.data.meta)} compact />}>
      {h.error && <ErrorCard error={h.error} onRetry={h.retry} />}
      {!h.data && !h.error && <Skeleton className="h-[280px] w-full" />}
      {h.data && (
        <>
          <Plot height={280} filename="availability-vs-demand" ariaLabel="Renewable water resources and total withdrawal by reference year"
                tableKeyLabel="Reference year"
                data={h.data.data.series.map((s, i) => {
                  const pts = s.points.filter((p) => p.value !== null);
                  return { type: "scatter", mode: pts.length > 1 ? "lines+markers" : "markers", name: s.label,
                           x: pts.map((p) => p.referenceYear), y: pts.map((p) => p.value),
                           line: { color: SERIES[i], width: 2 }, marker: { size: 10, color: SERIES[i] },
                           hovertemplate: `%{x}: %{y:,.1f} ${s.unit}<extra>${s.label}</extra>` };
                })}
                layout={baseLayout({ xaxis: { ...baseLayout().xaxis as object, title: axisTitle("Reference year"), dtick: 2 },
                                     yaxis: { ...baseLayout().yaxis as object, type: "log", title: axisTitle("km³/yr (log scale)") } })} />
          <p className="mt-2 text-[12px] text-muted">
            Renewable resources are a long-term average (FAO estimates); total withdrawal has one genuine reference year (2008), so no
            withdrawal trend exists. {national ? "" : "National data — not available per division."}
          </p>
        </>
      )}
    </Card>
  );
}

const ANOMALY_VARS: [string, string][] = [["precip_mm", "Rainfall"], ["d_mm", "Climatic water balance P − ET0"]];

export function WeatherTrends({ region }: { region: string }) {
  const probe = useApi(`wh-probe|${region}`, () => api.weatherHistory(region, { normals: true }));
  // the last month that actually has data (the requested end can be the current, incomplete month)
  const first = probe.data?.data.series.find((x) => x.t.length)?.t[0] ?? null;
  const latest = probe.data?.data.series.find((x) => x.t.length)?.t.at(-1) ?? null;
  // the archive starts in January 1991 (Deviation D3); by default the last ~24 months are shown
  const bounds = latest ? { min: "1991-01", max: latest.slice(0, 7), label: "Weather trends",
                            defaultFrom: first?.slice(0, 7), defaultTo: latest.slice(0, 7) } : null;
  useDateBounds(bounds);
  const dateRange = useAppStore((s) => s.dateRange);
  const custom = Boolean(dateRange.from || dateRange.to);
  const eff = effectiveRange(dateRange, bounds);
  const ranged = useApi(custom && eff.from ? `wh-range|${region}|${eff.from}|${eff.to}` : null,
                        () => api.weatherHistory(region, { start: eff.from!, end: eff.to!, normals: true }));
  const src = custom ? ranged : probe;
  const d = src.data?.data;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {ANOMALY_VARS.map(([key, label]) => {
        const s = d?.series.find((x) => x.variable === key);
        const n = d?.normals?.find((x) => x.variable === key);
        const anom = s && n ? s.v.map((v, i) => (v === null || n.v[i] === null || n.v[i] === undefined ? null : v - (n.v[i] as number))) : [];
        const months = s?.t ?? [];
        return (
          <Card key={key} title={`${label} vs 1991–2020 normal`}
                subtitle={months.length ? `${months.length} months · ${monthLabel(months[0])} to ${monthLabel(months.at(-1))} · use the date filter to change the period` : "No data in this range"}
                actions={src.data && <DataStatusBadge info={fromMeta(src.data.meta)} compact />}>
            {src.error && <ErrorCard error={src.error} onRetry={src.retry} />}
            {!src.data && !src.error && <Skeleton className="h-[240px] w-full" />}
            {src.data && (months.length ? (
              <Plot height={240} filename={`${key}-anomaly`} ariaLabel={`${label} anomaly against the 1991-2020 normal by month`} tableKeyLabel="Month"
                    data={[{ type: "bar", name: `${label} anomaly`, x: months, y: anom,
                             marker: { color: anom.map((v) => ((v ?? 0) >= 0 ? SERIES[0] : SERIES[1])) },
                             hovertemplate: "%{x}: %{y:+.0f} mm vs normal<extra></extra>" }]}
                    layout={baseLayout({ showlegend: false, yaxis: { ...baseLayout().yaxis as object, title: axisTitle("mm vs 1991–2020 normal") } })} />
            ) : <p className="text-[13px] text-muted">No data in this range.</p>)}
            <p className="mt-1 text-[12px] text-muted">Blue: above the normal; orange: below. ERA5 reanalysis; complete months only.</p>
          </Card>
        );
      })}
    </div>
  );
}

export function ModelChecks() {
  const [open, setOpen] = useState(false);
  const ov = useApi(open ? "overview|bd|checks" : null, () => api.overview("bd", BASELINE));
  return (
    <details className="card p-4 sm:p-5" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-[15px] font-semibold text-ink">Model checks against official statistics (national)</summary>
      <p className="mt-1 text-[12.5px] text-muted">The national monthly water-balance model (derived) compared with FAO AQUASTAT. The model itself is shown in Water Budget and What-if.</p>
      {open && !ov.data && !ov.error && <Skeleton className="mt-3 h-24 w-full" />}
      {ov.error && <ErrorCard error={ov.error} onRetry={ov.retry} />}
      {ov.data && (
        <ul className="mt-3 space-y-2 text-[13px]">
          {ov.data.validation.map((v) => (
            <li key={v.label}>
              <div className="font-medium">{v.label}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>AquaGuard: <MeasureText m={v.model} /></span>
                <span>Reference: <MeasureText m={v.reference} /></span>
              </div>
              <p className="text-[12px] text-muted">{v.note}</p>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
