/** Pure helpers for scenarios and their URL form (?region=dhaka&rain=-20&temp=1&demand=10&gw=-20&eff=0.75&loss=30). */
import { BASELINE, type Scenario } from "../types/contract";

export const SCENARIO_URL_KEYS: Record<keyof Scenario, string> = {
  rainfallChangePct: "rain",
  temperatureChangeC: "temp",
  demandChangePct: "demand",
  agriculturalDemandChangePct: "agri",
  groundwaterAvailabilityPct: "gw",
  irrigationEfficiency: "eff",
  pipelineLossPct: "loss",
};

export const RANGES: Record<keyof Scenario, [number, number, number]> = {
  // [min, max, step]
  rainfallChangePct: [-50, 50, 1],
  temperatureChangeC: [-2, 4, 0.1],
  demandChangePct: [-30, 50, 1],
  agriculturalDemandChangePct: [-50, 50, 1],
  groundwaterAvailabilityPct: [-50, 20, 1],
  irrigationEfficiency: [0.3, 0.9, 0.01],
  pipelineLossPct: [0, 50, 1],
};

const clamp = (v: number, [lo, hi]: [number, number, number]) => Math.min(hi, Math.max(lo, v));

export function isBaseline(s: Scenario): boolean {
  return (Object.keys(BASELINE) as (keyof Scenario)[]).every((k) => s[k] === BASELINE[k]);
}

export function scenarioFromParams(p: URLSearchParams): Scenario {
  const out: Scenario = { ...BASELINE };
  (Object.keys(SCENARIO_URL_KEYS) as (keyof Scenario)[]).forEach((k) => {
    const raw = p.get(SCENARIO_URL_KEYS[k]);
    if (raw === null || raw === "") return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    (out[k] as number) = clamp(v, RANGES[k]);
  });
  return out;
}

export function scenarioToParams(s: Scenario, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base ?? undefined);
  (Object.keys(SCENARIO_URL_KEYS) as (keyof Scenario)[]).forEach((k) => {
    const key = SCENARIO_URL_KEYS[k];
    const v = s[k];
    if (v === null || v === BASELINE[k]) p.delete(key);
    else p.set(key, String(v));
  });
  return p;
}

/** Query string for API calls (full field names, baseline fields omitted). */
export function scenarioQuery(s: Scenario): string {
  const p = new URLSearchParams();
  (Object.keys(BASELINE) as (keyof Scenario)[]).forEach((k) => {
    const v = s[k];
    if (v !== null && v !== BASELINE[k]) p.set(k, String(v));
  });
  return p.toString();
}

/** Request body form (null = baseline). */
export function scenarioBody(s: Scenario): Scenario {
  return { ...s };
}

export function describeScenario(s: Scenario): string {
  const parts: string[] = [];
  if (s.rainfallChangePct) parts.push(`Rain ${s.rainfallChangePct > 0 ? "+" : ""}${s.rainfallChangePct}%`);
  if (s.temperatureChangeC) parts.push(`Temp ${s.temperatureChangeC > 0 ? "+" : ""}${s.temperatureChangeC} °C`);
  if (s.demandChangePct) parts.push(`Demand ${s.demandChangePct > 0 ? "+" : ""}${s.demandChangePct}%`);
  if (s.agriculturalDemandChangePct)
    parts.push(`Agriculture ${s.agriculturalDemandChangePct > 0 ? "+" : ""}${s.agriculturalDemandChangePct}%`);
  if (s.groundwaterAvailabilityPct)
    parts.push(`Groundwater ${s.groundwaterAvailabilityPct > 0 ? "+" : ""}${s.groundwaterAvailabilityPct}%`);
  if (s.irrigationEfficiency !== null) parts.push(`Irrigation eff. ${s.irrigationEfficiency}`);
  if (s.pipelineLossPct !== null) parts.push(`Pipe loss ${s.pipelineLossPct}%`);
  return parts.join(" · ");
}
