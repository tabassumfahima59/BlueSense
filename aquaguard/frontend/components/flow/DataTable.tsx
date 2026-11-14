"use client";
/** Data table view: every facility, zone and pipeline with flow, pressure, leakage and status; sortable, filterable,
 *  and row selection is shared with the 3D view and the schematic. */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { fmt, type TableRow, tableRows } from "@/lib/flow/derive";
import { sameSel, useFlowStore } from "@/lib/flow/store";
import type { FlowState } from "@/lib/types/contract";
import { StatusText } from "./Status";

type Key = "name" | "type" | "flowDaily" | "pressure" | "leakDaily" | "status";
const COLS: { key: Key; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Object" },
  { key: "type", label: "Type" },
  { key: "flowDaily", label: "Flow (m³/day)", numeric: true },
  { key: "pressure", label: "Pressure (m)", numeric: true },
  { key: "leakDaily", label: "Leakage (m³/day)", numeric: true },
  { key: "status", label: "Status" },
];
const FILTERS = {
  all: "All objects", facility: "Facilities", zone: "Consumer zones", pipeline: "Pipelines",
  issues: "Needs attention",
} as const;
type Filter = keyof typeof FILTERS;

const sortValue = (r: TableRow, k: Key) => (k === "status" ? r.status.label : r[k]);

export function DataTable({ state }: { state: FlowState }) {
  const select = useFlowStore((s) => s.select);
  const selection = useFlowStore((s) => s.selection);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    let out = tableRows(state);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((r) => `${r.name} ${r.type} ${r.status.label}`.toLowerCase().includes(q));
    if (filter === "issues") out = out.filter((r) => r.status.tone === "warn" || r.status.tone === "bad");
    else if (filter !== "all") out = out.filter((r) => r.group === filter);
    if (sort) {
      out = [...out].sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (va === null) return 1;
        if (vb === null) return -1;
        return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
      });
    }
    return out;
  }, [state, query, filter, sort]);

  const toggleSort = (key: Key) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  return (
    <div className="flex h-full flex-col bg-white" data-testid="flow-table">
      <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
        <label className="flex min-w-0 flex-1 flex-col text-[12px] text-muted">
          Filter by name, type or status
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. leaking, pump, branch"
                 className="mt-0.5 rounded-lg border border-control px-2 py-1 text-[13px] text-ink" />
        </label>
        <label className="flex flex-col text-[12px] text-muted">
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}
                  className="mt-0.5 rounded-lg border border-control bg-white px-2 py-1 text-[13px] text-ink">
            {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <p className="w-full text-[11.5px] text-muted" aria-live="polite">{rows.length} of {tableRows(state).length} objects · click a row to select it in every view</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[720px] text-[12.5px]" aria-label="Network objects (conceptual simulation)">
          <thead className="sticky top-0 bg-light text-left text-muted">
            <tr>
              {COLS.map((c) => {
                const active = sort?.key === c.key;
                const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                      className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}>
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-ink">
                      {c.label} <Icon size={12} aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sel = { kind: r.kind, id: r.id } as NonNullable<typeof selection>;
              const on = sameSel(selection, sel);
              return (
                <tr key={`${r.kind}-${r.id}`} aria-selected={on} tabIndex={0}
                    onClick={() => select(on ? null : sel)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(on ? null : sel); } }}
                    className={`cursor-pointer border-b border-border/70 outline-none focus-visible:bg-primary-soft ${on ? "bg-[#FEF3C7]" : "hover:bg-light"}`}>
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-ink">
                    {r.name}
                  </th>
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted">{r.type}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.flowDaily)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.modelled ? fmt(r.pressure, 1) : "Not modelled"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.kind === "pipe" && r.modelled ? fmt(r.leakDaily) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5"><StatusText status={r.status} /></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={COLS.length} className="px-3 py-6 text-center text-muted">No object matches this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
