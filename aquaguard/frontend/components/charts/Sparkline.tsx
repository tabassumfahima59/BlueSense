"use client";
/** Monthly anomaly bar sparkline (above normal = blue, below = orange, never colour alone: sign is in the table and
 * tooltips) with a zero line, native tooltips, gaps drawn as gaps and a "View as table" toggle. */
import { useState } from "react";
import type { Series } from "@/lib/types/contract";
import { DataTable } from "./Plot";
import { NEUTRAL, SERIES } from "./theme";

export function Sparkline({ series, height = 56 }: { series: Series; height?: number }) {
  const [asTable, setAsTable] = useState(false);
  const vals = series.points.map((p) => p.v.value);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v ?? 0)));
  const w = 240;
  const bw = w / Math.max(1, vals.length);
  const mid = height / 2;
  const unit = series.points[0]?.v.unit ?? "";
  return (
    <div>
      {asTable ? (
        <DataTable caption={series.label} head={["Month", `Anomaly (${unit})`]} maxHeight={220}
                   rows={series.points.map((p) => [p.t, p.v.value === null ? null : Math.round(p.v.value * 10) / 10])} />
      ) : (
        <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img"
             aria-label={`${series.label}, ${vals.length} months${vals.length ? ` from ${series.points[0].t} to ${series.points.at(-1)!.t}` : ""}`}>
          <line x1={0} x2={w} y1={mid} y2={mid} stroke={NEUTRAL.axis} strokeWidth={1} />
          {series.points.map((p, i) => {
            const v = p.v.value;
            if (v === null || v === undefined) return null; // a gap stays a gap
            const h = (Math.abs(v) / max) * (mid - 2);
            return (
              <rect key={p.t} x={i * bw + 1} width={Math.max(1, bw - 2)} y={v >= 0 ? mid - h : mid} height={Math.max(0.5, h)} rx={1.5}
                    fill={v >= 0 ? SERIES[0] : SERIES[1]}>
                <title>{`${p.t}: ${v > 0 ? "+" : ""}${v.toFixed(0)} ${p.v.unit}`}</title>
              </rect>
            );
          })}
        </svg>
      )}
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}
                className="rounded-md px-2 py-0.5 text-[12px] font-medium text-muted transition hover:bg-light hover:text-ink">
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
    </div>
  );
}
