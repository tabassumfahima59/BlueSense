"use client";
/**
 * Division view (GET /api/water/scarcity/divisions): a choropleth of one weather-derived indicator (category filter)
 * with its classes, thresholds and their source, a hover panel and click-to-select; and the regional table of every
 * division indicator (sortable, keyboard selectable, CSV). National statistics are never shown per division.
 */
import dynamic from "next/dynamic";
import { ArrowDownUp, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { NO_CLASS, TONE_COLOR } from "@/components/charts/theme";
import { DEFAULT_LAYERS } from "@/components/maps/layers";
import { Card, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, fromMeasure } from "@/components/ui/DataStatus";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { downloadText, fmtMeasure, toCsv } from "@/lib/format";
import type { DivisionIndicators, DivisionRow, IndicatorClass, IndicatorDef } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), {
  ssr: false, loading: () => <Skeleton className="h-[380px] w-full" />,
});
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const MAP_KEYS = ["dryness_3m", "rain_30d_anomaly", "water_balance_next_7d", "reference_crop_need_30d"] as const;
const SHORT: Record<string, string> = {
  dryness_3m: "Dryness (3 mo)", rain_30d_anomaly: "Rain vs normal", water_balance_next_7d: "Next 7 days",
  reference_crop_need_30d: "Irrigation need",
};

function range(c: IndicatorClass, unit: string): string {
  const u = unit === "z-score" ? "" : ` ${unit}`;
  if (c.min === null || c.min === undefined) return `< ${c.max}${u}`;
  if (c.max === null || c.max === undefined) return `≥ ${c.min}${u}`;
  return `${c.min} to ${c.max}${u}`;
}

export function ClassChip({ c }: { c: IndicatorClass | null | undefined }) {
  if (!c) return <span className="text-[12px] text-muted">no class</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[12px]">
      <span className="h-2.5 w-2.5 rounded-sm border border-black/10" style={{ background: TONE_COLOR[c.tone] }} aria-hidden />
      {c.label}
    </span>
  );
}

function Legend({ def }: { def: IndicatorDef }) {
  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={`Legend: ${def.label}`}>
        {def.classes.map((c) => (
          <li key={c.label} className="inline-flex items-center gap-1.5 text-[12px] text-ink">
            <span className="h-3 w-3 rounded-sm border border-black/10" style={{ background: TONE_COLOR[c.tone] }} aria-hidden />
            {c.label} <span className="text-muted">({range(c, def.unit)})</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 text-[12px] text-ink">
          <span className="h-3 w-3 rounded-sm border border-black/10" style={{ background: NO_CLASS }} aria-hidden /> No class / no data
        </li>
      </ul>
      <p className="text-[11.5px] text-muted">
        Classes: {def.classSource}{def.assumption ? " — assumption, not an official classification" : ""}. Method: {def.method}.
      </p>
    </div>
  );
}

export function ScarcityMap({ data, selected, onSelect }: { data: DivisionIndicators; selected: string; onSelect: (id: string) => void }) {
  const [key, setKey] = useState<(typeof MAP_KEYS)[number]>("dryness_3m");
  const [hover, setHover] = useState<string | null>(null);
  const geo = useApi("geo-divisions", () => api.geo("divisions"));
  const def = data.indicators.find((d) => d.key === key)!;
  const colors = useMemo(() => Object.fromEntries(data.divisions.map((r) => {
    const c = r.classes[key];
    return [r.id, c ? TONE_COLOR[c.tone] : NO_CLASS];
  })), [data, key]);
  const h = data.divisions.find((r) => r.id === hover);
  const sample = data.divisions[0]?.values[key];
  const status = sample ? fromMeasure(sample) : null;
  return (
    <Card title="Scarcity map (weather-derived)" subtitle="Value at each division's representative point — click a division to select it"
          actions={status && <DataStatusBadge info={status} compact />}>
      <div className="mb-2 overflow-x-auto">
        <Segmented label="Map indicator" value={key} onChange={setKey} options={MAP_KEYS.map((k) => ({ value: k, label: SHORT[k] }))} />
      </div>
      <div className="relative">
        {geo.error && <ErrorCard error={geo.error} onRetry={geo.retry} title="Boundaries could not be loaded" />}
        {geo.data ? (
          <BangladeshMap divisions={geo.data} districts={EMPTY} values={{}} colors={colors} onHover={setHover}
                         layers={{ ...DEFAULT_LAYERS, terrain: false, extrude: false, rivers: false }} flat height={380}
                         selected={selected} onSelect={onSelect} />
        ) : !geo.error && <Skeleton className="h-[380px] w-full" />}
        {h && (
          <div className="glass pointer-events-none absolute left-3 top-3 max-w-[240px] p-2.5 text-[12.5px]" role="status">
            <p className="font-semibold text-ink">{h.name}</p>
            <p className="tabular-nums text-ink">{fmtMeasure(h.values[key])}</p>
            <ClassChip c={h.classes[key]} />
          </div>
        )}
      </div>
      <div className="mt-3"><Legend def={def} /></div>
    </Card>
  );
}

const COLS: { key: string; label: string }[] = [
  { key: "rain_30d_anomaly", label: "Rain 30 d vs normal" }, { key: "rain_30d_vs_last_year", label: "vs last year" },
  { key: "water_balance_30d", label: "P − ET0 30 d" }, { key: "water_balance_next_7d", label: "P − ET0 next 7 d" },
  { key: "reference_crop_need_30d", label: "Ref. irrigation need 30 d" }, { key: "dryness_3m", label: "Dryness z (3 mo)" },
];

export function DivisionTable({ data, selected, onSelect }: { data: DivisionIndicators; selected: string; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "dryness_3m", dir: 1 });
  const rows = [...data.divisions].sort((a, b) => {
    const va = a.values[sort.key]?.value ?? Number.POSITIVE_INFINITY;
    const vb = b.values[sort.key]?.value ?? Number.POSITIVE_INFINITY;
    return (va - vb) * sort.dir;
  });
  const exportCsv = () => downloadText("aquaguard-division-indicators.csv", toCsv([
    ["Division", ...COLS.flatMap((c) => [`${c.label} (${data.divisions[0]?.values[c.key]?.unit ?? ""})`, `${c.label} class`]), "Observed (rain)", "Observed (dryness)"],
    ...[data.national, ...data.divisions].map((r: DivisionRow) => [r.name, ...COLS.flatMap((c) => [r.values[c.key]?.value ?? null, r.classes[c.key]?.label ?? ""]),
      r.values.rain_30d_anomaly?.observedAt ?? "", r.values.dryness_3m?.observedAt ?? ""]),
  ]));
  return (
    <Card title="Regional risk table" subtitle="Weather-derived indicators per division (national row = area-weighted estimate)"
          actions={<button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted transition hover:bg-light hover:text-ink"><Download size={13} aria-hidden /> CSV</button>}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Regional risk table (scrollable)">
        <table className="w-full min-w-[860px] text-[12.5px]">
          <thead className="text-left text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-1.5 pr-2 font-medium">Division</th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className="pr-2 font-medium" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-light hover:text-ink">
                    {c.label} <ArrowDownUp size={12} aria-hidden />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[data.national, ...rows].map((r) => {
              const isNational = r.id === data.national.id;
              const active = r.id === selected || (isNational && selected === "bd");
              return (
                <tr key={r.id} className={`border-b border-border/60 ${active ? "bg-light" : ""} ${isNational ? "font-medium" : ""}`}>
                  <th scope="row" className="py-1.5 pr-2 text-left">
                    <button type="button" onClick={() => onSelect(isNational ? "bd" : r.id)} aria-pressed={active}
                            className="rounded px-1 text-left font-medium text-primary hover:underline">
                      {isNational ? "Bangladesh (estimate)" : r.name}
                    </button>
                  </th>
                  {COLS.map((c) => (
                    <td key={c.key} className="pr-2 align-top">
                      <span className="block tabular-nums text-ink">{fmtMeasure(r.values[c.key], { signed: c.key !== "reference_crop_need_30d" })}</span>
                      {r.classes[c.key] !== undefined && data.indicators.find((d) => d.key === c.key)?.classes.length ? <ClassChip c={r.classes[c.key]} /> : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted">{data.note}</p>
    </Card>
  );
}
