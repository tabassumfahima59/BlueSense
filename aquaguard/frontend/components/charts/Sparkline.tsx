import type { Series } from "@/lib/types/contract";
import { NEUTRAL, SERIES } from "./theme";

/** Tiny anomaly bar sparkline (positive = teal, negative = orange) with a zero line and native tooltips. */
export function Sparkline({ series, height = 56 }: { series: Series; height?: number }) {
  const vals = series.points.map((p) => p.v.value ?? 0);
  const max = Math.max(1, ...vals.map(Math.abs));
  const w = 240;
  const bw = w / Math.max(1, vals.length);
  const mid = height / 2;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={`${series.label}, last ${vals.length} months`}>
      <line x1={0} x2={w} y1={mid} y2={mid} stroke={NEUTRAL.axis} strokeWidth={1} />
      {series.points.map((p, i) => {
        const v = p.v.value ?? 0;
        const h = (Math.abs(v) / max) * (mid - 2);
        return (
          <rect key={p.t} x={i * bw + 1} width={Math.max(1, bw - 2)} y={v >= 0 ? mid - h : mid} height={Math.max(0.5, h)} rx={1.5} fill={v >= 0 ? SERIES[0] : SERIES[1]}>
            <title>{`${p.t}: ${v > 0 ? "+" : ""}${v.toFixed(0)} ${p.v.unit}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
