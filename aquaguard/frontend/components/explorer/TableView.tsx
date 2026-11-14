"use client";
/**
 * Data Table: Bangladesh and the eight divisions with the values of /api/explorer/overview (sortable, filterable,
 * row selection shared with the map), plus the districts as a geography-only reference list.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, fromMeta } from "@/components/ui/DataStatus";
import { RiskPill } from "@/components/ui/Risk";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { num, signed, type SortKey, sortRows } from "@/lib/explorer/analysis";
import { downloadText, fmtMeasure, toCsv } from "@/lib/format";
import type { MapLayersResponse } from "@/lib/types/contract";

const COLS: { key: SortKey | null; label: string; right?: boolean }[] = [
  { key: "name", label: "Region" },
  { key: "area", label: "Area (km²)", right: true },
  { key: null, label: "Districts", right: true },
  { key: "population", label: "Population", right: true },
  { key: "rainDep", label: "Rain, 12 mo vs normal", right: true },
  { key: "tempAnom", label: "Temp., 12 mo vs normal", right: true },
  { key: "dryness", label: "Seasonal dryness (z)", right: true },
  { key: "risk", label: "Est. scarcity risk" },
];

export function TableView({ selectedDivision, onSelect, values }: {
  selectedDivision: string | null;
  onSelect: (id: string) => void;
  values: MapLayersResponse["values"] | undefined;
}) {
  const ov = useApi("explorer-overview", api.explorerOverview);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [show, setShow] = useState<"all" | "divisions">("all");
  const [tab, setTab] = useState<"regions" | "districts">("regions");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    let r = ov.data?.data.rows ?? [];
    if (show === "divisions") r = r.filter((x) => x.level === "division");
    return sort ? sortRows(r, sort.key, sort.dir) : r;
  }, [ov.data, show, sort]);
  const districts = useMemo(() => Object.values(values ?? {}).filter((v) => v.level === "district")
    .filter((v) => !q.trim() || `${v.name} ${values?.[v.divisionId]?.name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [values, q]);

  if (ov.error) return <ErrorCard error={ov.error} onRetry={ov.retry} title="Table data unavailable" />;
  if (!ov.data) return <Skeleton className="h-[420px] w-full" />;
  const toggle = (key: SortKey) => setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));
  const csv = () => downloadText("aquaguard-divisions.csv", toCsv([
    ["region", "level", "area_km2", "districts", "population", "rain_12m_mm", "rain_12m_vs_normal_pct", "period", "tmean_12m_c", "tmean_anomaly_c", "dryness_z", "est_risk", "dry_season_stress_ratio"],
    ...rows.map((r) => [r.name, r.level, r.area, r.districts, r.population, r.last12?.rain?.toFixed(1), r.last12?.rainDeparturePct?.toFixed(1),
      r.last12 ? `${r.last12.start}/${r.last12.end}` : "", r.last12?.tmean?.toFixed(2), r.last12?.tmeanAnomaly?.toFixed(2),
      r.drynessZ?.toFixed(2), r.risk.label, r.risk.dryStressRatio.toFixed(3)]),
  ]));
  return (
    <Card title="Data table" subtitle={`Values from /api/explorer/overview · normal ${ov.data.data.normal}`}
          actions={<DataStatusBadge info={fromMeta(ov.data.meta)} compact />}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Table" value={tab} onChange={setTab}
                   options={[{ value: "regions", label: "Divisions & national" }, { value: "districts", label: "Districts (reference)" }]} />
        {tab === "regions" ? (
          <>
            <label className="flex items-center gap-1.5 text-[12.5px] text-muted">Show
              <select value={show} onChange={(e) => setShow(e.target.value as "all" | "divisions")} className="rounded-lg border border-control bg-white px-2 py-1 text-[12.5px] text-ink">
                <option value="all">Bangladesh and divisions</option><option value="divisions">Divisions only</option>
              </select>
            </label>
            <button type="button" onClick={csv} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-control bg-white px-2.5 py-1 text-[12.5px] hover:bg-light">
              <Download size={13} aria-hidden /> CSV
            </button>
          </>
        ) : (
          <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted">Filter
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="District or division"
                   className="min-w-0 flex-1 rounded-lg border border-control px-2 py-1 text-[12.5px] text-ink" />
          </label>
        )}
      </div>
      {tab === "regions" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]" aria-label="Divisions and Bangladesh: water indicators" data-testid="explorer-table">
            <thead className="bg-light text-left text-muted">
              <tr>
                {COLS.map((c) => {
                  const active = c.key && sort?.key === c.key;
                  const Icon = !active ? ArrowUpDown : sort!.dir === 1 ? ArrowUp : ArrowDown;
                  return (
                    <th key={c.label} scope="col" aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : c.key ? "none" : undefined}
                        className={`px-2.5 py-2 font-medium ${c.right ? "text-right" : ""}`}>
                      {c.key ? (
                        <button type="button" onClick={() => toggle(c.key!)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-ink">
                          {c.label} <Icon size={12} aria-hidden />
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = r.level === "division" ? selectedDivision === r.id : selectedDivision === null;
                return (
                  <tr key={r.id} aria-selected={on} tabIndex={0} onClick={() => onSelect(r.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.id); } }}
                      className={`cursor-pointer border-b border-border/70 outline-none focus-visible:bg-primary-soft ${on ? "bg-[#FEF3C7]" : "hover:bg-light"}`}>
                    <th scope="row" className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-ink">
                      {r.name}{r.level === "national" && <span className="ml-1 text-[11px] font-normal text-muted">(national)</span>}
                    </th>
                    <td className="px-2.5 text-right tabular-nums">{num(r.area)}</td>
                    <td className="px-2.5 text-right tabular-nums">{r.districts}</td>
                    <td className="px-2.5 text-right tabular-nums">{num(r.population)}</td>
                    <td className="whitespace-nowrap px-2.5 text-right tabular-nums">{r.last12 ? `${num(r.last12.rain)} mm (${signed(r.last12.rainDeparturePct, 0, "%")})` : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 text-right tabular-nums">{r.last12 ? `${num(r.last12.tmean, 1)} °C (${signed(r.last12.tmeanAnomaly, 1)})` : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 text-right tabular-nums">{r.drynessZ !== null ? `${signed(r.drynessZ, 2)} · ${r.drynessClass ?? "—"}` : "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-1"><RiskPill label={r.risk.label} level={r.risk.level} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">{ov.data.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[520px] text-[12.5px]" aria-label="Districts: geography only">
            <thead className="sticky top-0 bg-light text-left text-muted"><tr>
              <th scope="col" className="px-2.5 py-2 font-medium">District</th><th scope="col" className="px-2.5 font-medium">Division</th>
              <th scope="col" className="px-2.5 text-right font-medium">Area</th><th scope="col" className="px-2.5 text-right font-medium">Population (2022)</th>
            </tr></thead>
            <tbody>
              {districts.map((v) => (
                <tr key={v.regionId} className="border-b border-border/70">
                  <th scope="row" className="px-2.5 py-1.5 text-left font-medium">{v.name}</th>
                  <td className="px-2.5">{values?.[v.divisionId]?.name ?? v.divisionId}</td>
                  <td className="px-2.5 text-right tabular-nums">{fmtMeasure(v.area)}</td>
                  <td className="px-2.5 text-right tabular-nums">{fmtMeasure(v.population)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-muted">{districts.length} districts. Reference geography only (geoBoundaries area, HDX population): AquaGuard has no district-level water data.</p>
        </div>
      )}
    </Card>
  );
}
