import type { Measure, Provenance } from "../types/contract";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  observed: "Observed",
  historical: "Historical",
  predicted: "Predicted",
  estimated: "Estimated",
  simulated: "Simulated",
};

export const PROVENANCE_HELP: Record<Provenance, string> = {
  observed: "Field or station measurement",
  historical: "Archived or reanalysis dataset (e.g. ERA5, AQUASTAT, GRACE)",
  predicted: "Machine-learning or third-party forecast output",
  estimated: "Calculated from formulas and documented assumptions",
  simulated: "Output of a hypothetical scenario or simulation",
};

const UNIT_DISPLAY: Record<string, string> = { ratio: "%", "m3/s": "m³/s" };

/** Display preference for water volumes (Settings > Units). "native" keeps the unit each source publishes. */
export type VolumeDisplay = "native" | "MCM" | "km3";
let volumeDisplay: VolumeDisplay = "native";
export function setVolumeDisplay(v: VolumeDisplay): void {
  volumeDisplay = v;
}

const VOLUME: Record<string, { factorToMcm: number; suffix: string }> = {
  MCM: { factorToMcm: 1, suffix: "" }, "MCM/yr": { factorToMcm: 1, suffix: "/yr" },
  "km³": { factorToMcm: 1000, suffix: "" }, "km³/yr": { factorToMcm: 1000, suffix: "/yr" },
};

/** Convert a volume to the preferred unit (1 km³ = 1000 MCM); other units are returned unchanged. */
export function convertVolume(v: number, unit: string, pref: VolumeDisplay = volumeDisplay): { v: number; unit: string } {
  const u = VOLUME[unit];
  if (!u || pref === "native") return { v, unit };
  const mcm = v * u.factorToMcm;
  return pref === "MCM" ? { v: mcm, unit: `MCM${u.suffix}` } : { v: mcm / 1000, unit: `km³${u.suffix}` };
}

/** Format a number with sensible precision for its magnitude. */
export function fmtNumber(v: number, maxDigits?: number): string {
  const abs = Math.abs(v);
  const digits = maxDigits ?? (abs >= 1000 ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3);
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Unit label after the volume preference (for intervals and axis text). */
export function displayUnit(unit: string): string {
  const u = convertVolume(1, unit).unit;
  return UNIT_DISPLAY[u] ?? u;
}

/** Value + unit for a Measure. Ratios are shown as percentages. */
export function fmtMeasure(m: Measure | null | undefined, opts: { digits?: number; signed?: boolean } = {}): string {
  if (!m || m.value === null || m.value === undefined) return "—";
  const conv = convertVolume(m.value, m.unit);
  let v = conv.v;
  let unit = UNIT_DISPLAY[conv.unit] ?? conv.unit;
  if (m.unit === "ratio") v = v * 100;
  const s = fmtNumber(v, opts.digits ?? (m.unit === "ratio" ? 1 : undefined));
  const sign = opts.signed && v > 0 ? "+" : "";
  if (unit === "-" || unit === "") unit = "";
  return `${sign}${s}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;
}

export function fmtInterval(m: Measure | null | undefined, digits?: number): string | null {
  if (!m?.uncertainty) return null;
  const k = m.unit === "ratio" ? 100 : convertVolume(1, m.unit).v;
  return `${fmtNumber(m.uncertainty.low * k, digits)} to ${fmtNumber(m.uncertainty.high * k, digits)}`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const RISK_COLORS = ["#20C997", "#9AD9A0", "#F5B942", "#F08A4B", "#F06464"];
export const RISK_LABELS = ["Low", "Low-medium", "Medium-high", "High", "Extremely high"];

export function riskColor(level: number): string {
  return RISK_COLORS[Math.max(0, Math.min(4, level))];
}

/** CSV with proper quoting. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c === null || c === undefined ? "" : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
