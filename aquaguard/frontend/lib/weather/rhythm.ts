import type { WeatherSeries } from "@/lib/types/contract";

export type RhythmMode = "rainfall" | "balance" | "dryness";
export interface RhythmPoint {
  month: string;
  rainfall: number | null;
  rainfallNormal: number | null;
  rainfallAnomaly: number | null;
  et0: number | null;
  balance: number | null;
  balanceNormal: number | null;
  dryness: number | null;
}

export const RHYTHM_MODES: { id: RhythmMode; label: string; title: string; unit: string; baseline: string }[] = [
  { id: "rainfall", label: "Rainfall", title: "Monthly rainfall anomaly", unit: "mm", baseline: "1991–2020 rainfall normal" },
  { id: "balance", label: "Water Balance", title: "Monthly climatic water balance · P − ET0", unit: "mm", baseline: "Zero = rainfall equals reference ET0" },
  { id: "dryness", label: "Dryness", title: "Three-month P − ET0 standardized anomaly", unit: "z-score", baseline: "Same three calendar months in 1991–2020" },
];

export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

/** Fill only the calendar axis, never the values. Normals are matched by timestamp, not array position. */
export function rhythmPoints(history: WeatherSeries): RhythmPoint[] {
  const times = history.series.flatMap((s) => s.t).sort();
  if (!times.length) return [];
  const by = (variable: string, normal = false) => {
    const s = (normal ? history.normals : history.series)?.find((v) => v.variable === variable);
    return new Map(s?.t.map((t, i) => [t.slice(0, 7), Number.isFinite(s.v[i]) ? s.v[i] : null]) ?? []);
  };
  const rain = by("precip_mm"), normal = by("precip_mm", true), et = by("et0_mm");
  const balance = by("d_mm"), balanceNormal = by("d_mm", true), dryness = by("dryness_3m");
  const result: RhythmPoint[] = [];
  for (let month = times[0].slice(0, 7); month <= times.at(-1)!.slice(0, 7); month = shiftMonth(month, 1)) {
    const p = rain.get(month) ?? null, n = normal.get(month) ?? null;
    result.push({ month, rainfall: p, rainfallNormal: n, rainfallAnomaly: p === null || n === null ? null : p - n,
      et0: et.get(month) ?? null, balance: balance.get(month) ?? null,
      balanceNormal: balanceNormal.get(month) ?? null, dryness: dryness.get(month) ?? null });
  }
  return result;
}

export function rhythmValue(point: RhythmPoint, mode: RhythmMode): number | null {
  return mode === "rainfall" ? point.rainfallAnomaly : mode === "balance" ? point.balance : point.dryness;
}

export function availableIndices(points: RhythmPoint[], mode: RhythmMode): number[] {
  return points.flatMap((p, i) => rhythmValue(p, mode) === null ? [] : [i]);
}

/** Same dry/wet thresholds as backend services/indicators.py; this is a z-score, not fitted SPI. */
export function drynessInterpretation(z: number): string {
  if (z <= -2) return "Extremely dry";
  if (z <= -1.5) return "Severely dry";
  if (z <= -1) return "Moderately dry";
  if (z >= 2) return "Extremely wet";
  if (z >= 1.5) return "Very wet";
  if (z >= 1) return "Moderately wet";
  return "Near normal";
}

/** Straight segments preserve point values. A missing observation always starts a new path. */
export function waveformPaths(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  const segments: string[] = [];
  let path = "";
  values.forEach((v, i) => {
    if (v === null) { if (path) segments.push(path); path = ""; return; }
    path += `${path ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
  });
  if (path) segments.push(path);
  return segments;
}
