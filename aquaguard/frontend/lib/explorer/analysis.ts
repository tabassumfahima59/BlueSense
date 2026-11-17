/**
 * Pure helpers of the Water Explorer analysis views: formatting, ranking and the spatial-pattern statements built
 * from the overview rows. Every statement names its basis (observed reanalysis vs estimated) and never claims a
 * cause. Kept free of React so it is unit-tested.
 */
import type { OverviewRow } from "@/lib/types/contract";

export const RISK_LABELS = ["Low", "Low-medium", "Medium-high", "High", "Extremely high"] as const;

export function signed(v: number | null | undefined, digits = 0, unit = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s}${unit}`;
}

export function num(v: number | null | undefined, digits = 0, unit = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`;
}

export type SortKey = "name" | "risk" | "rainDep" | "tempAnom" | "dryness" | "area" | "population";

export function sortValue(r: OverviewRow, key: SortKey): number | string | null {
  switch (key) {
    case "name": return r.name;
    case "risk": return r.risk.level * 10 + r.risk.dryStressRatio; // level first, then the stress ratio
    case "rainDep": return r.last12?.rainDeparturePct ?? null;
    case "tempAnom": return r.last12?.tmeanAnomaly ?? null;
    case "dryness": return r.drynessZ ?? null;
    case "area": return r.area ?? null;
    case "population": return r.population ?? null;
  }
}

/** Sort rows; missing values always go last (never treated as zero). */
export function sortRows(rows: OverviewRow[], key: SortKey, dir: 1 | -1): OverviewRow[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
  });
}

export interface Pattern {
  id: string;
  text: string;
  basis: "observed (reanalysis)" | "estimated (engine + ML)" | "derived" | "coverage";
  regions: string[];
}

/** Spatial patterns across the eight divisions (the national row is excluded). */
export function patterns(rows: OverviewRow[]): Pattern[] {
  const div = rows.filter((r) => r.level === "division");
  const out: Pattern[] = [];
  if (!div.length) return out;
  const maxLevel = Math.max(...div.map((r) => r.risk.level));
  const top = div.filter((r) => r.risk.level === maxLevel);
  out.push({
    id: "risk-top", basis: "estimated (engine + ML)", regions: top.map((r) => r.id),
    text: `${top.length === div.length ? "All divisions share" : `${list(top.map((r) => r.name))} ${top.length > 1 ? "have" : "has"}`} the highest estimated scarcity risk (${RISK_LABELS[maxLevel]}).`,
  });
  const stressDriven = div.filter((r) => r.risk.driver === "stress" || r.risk.driver === "both");
  if (stressDriven.length) {
    out.push({ id: "risk-driver", basis: "estimated (engine + ML)", regions: stressDriven.map((r) => r.id),
               text: `In ${stressDriven.length} of ${div.length} divisions the estimated risk level is set by the dry-season stress class (engine estimate), not by the predicted dryness.` });
  }
  const withRain = div.filter((r) => r.last12?.rainDeparturePct !== null && r.last12?.rainDeparturePct !== undefined);
  if (withRain.length) {
    const sorted = [...withRain].sort((a, b) => a.last12!.rainDeparturePct! - b.last12!.rainDeparturePct!);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    out.push({
      id: "rain-range", basis: "observed (reanalysis)", regions: [lo.id, hi.id],
      text: `Rainfall over the last 12 complete months ranged from ${signed(lo.last12!.rainDeparturePct, 0, "%")} (${lo.name}) to ${signed(hi.last12!.rainDeparturePct, 0, "%")} (${hi.name}) against the 1991–2020 normal.`,
    });
    const deficit = withRain.filter((r) => r.last12!.rainDeparturePct! <= -15);
    if (deficit.length) {
      out.push({ id: "rain-deficit", basis: "observed (reanalysis)", regions: deficit.map((r) => r.id),
                 text: `${list(deficit.map((r) => r.name))}: rainfall at least 15% below normal over the last 12 complete months.` });
    }
  }
  const dry = div.filter((r) => r.drynessZ !== null && r.drynessZ !== undefined && r.drynessZ <= -1);
  if (dry.length) {
    out.push({ id: "dry", basis: "derived", regions: dry.map((r) => r.id),
               text: `${list(dry.map((r) => `${r.name} (${r.drynessClass ?? "dry"})`))}: seasonal dryness at least moderately dry (3-month P − ET0, SPI classes).` });
  }
  const missing = div.filter((r) => !r.last12);
  out.push({ id: "coverage", basis: "coverage", regions: missing.map((r) => r.id),
             text: missing.length ? `${list(missing.map((r) => r.name))}: no 12 complete months of weather data, so no rainfall comparison.`
               : "All eight divisions have 12 complete months of weather data; no district-level water data exists (districts are reference boundaries)." });
  return out;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Year range "YYYY-YYYY" validation for the period comparison form. */
export function validRange(v: string, min = 1991, max = new Date().getFullYear()): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(v.trim());
  if (!m) return "Use the form YYYY-YYYY.";
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a < min) return `Weather history starts in ${min}.`;
  if (b < a) return "The end year must not be before the start year.";
  if (b > max) return `The end year cannot be after ${max}.`;
  return null;
}
