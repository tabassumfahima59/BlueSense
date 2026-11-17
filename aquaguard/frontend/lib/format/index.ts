import type { Measure, Provenance } from "../types/contract";
import { useAppStore } from "../store";

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
export function setVolumeDisplay(v: VolumeDisplay): void {
  useAppStore.getState().setPrefs({ volumeUnit: v });
}

const VOLUME_BASE: Record<string, number> = { MCM: 1, "km³": 1000, km3: 1000, "m³": 1e-6, m3: 1e-6 };

/** Convert a volume to the preferred unit (1 km³ = 1000 MCM); other units are returned unchanged. */
export function convertVolume(v: number, unit: string, pref: VolumeDisplay = useAppStore.getState().prefs.volumeUnit): { v: number; unit: string } {
  const match = /^(MCM|km³|km3|m³|m3)(\/(?:yr|year|day|month))?$/.exec(unit);
  if (!match || pref === "native") return { v, unit };
  const mcm = v * VOLUME_BASE[match[1]];
  const suffix = match[2] ?? "";
  return pref === "MCM" ? { v: mcm, unit: `MCM${suffix}` } : { v: mcm / 1000, unit: `km³${suffix}` };
}

/** Format a number with sensible precision for its magnitude. */
export function fmtNumber(v: number, maxDigits?: number): string {
  const abs = Math.abs(v);
  const digits = maxDigits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2
    : abs > 0 ? Math.min(15, Math.max(3, Math.ceil(-Math.log10(abs)) + 2)) : 3);
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Unit label after the volume preference (for intervals and axis text). */
export function displayUnit(unit: string): string {
  const u = convertVolume(1, unit).unit;
  return UNIT_DISPLAY[u] ?? u;
}

/** Numeric value text for a volume table whose unit is in its column heading. */
export function volumeValue(value: number | null | undefined, unit: string): number | null {
  return value === null || value === undefined ? null : convertVolume(value, unit).v;
}

export function fmtVolume(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "—";
  const converted = convertVolume(value, unit);
  return `${fmtNumber(converted.v)} ${converted.unit}`;
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
