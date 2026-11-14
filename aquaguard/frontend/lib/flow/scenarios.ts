/**
 * Simulation inputs, the request sent to the engine, and the eight conceptual scenarios. A scenario only sets
 * engine inputs; every number shown comes from the engine's answer. Scenarios are illustrations, never measured
 * events.
 */
import type { FlowRequest } from "@/lib/types/contract";
import type { DestId, PipeId } from "./network";

export interface FlowInputs {
  pumpOn: boolean;
  pumpFlow: number;          // m³/s requested
  pumpCapacity: number;      // m³/s
  setpoint: number;          // m of head at the pump outlet
  sourceLimit: number | null; // m³/s available at the source (water shortage), null = unlimited
  leaks: Record<PipeId, number>;       // burst severity 0-3
  allocation: Record<DestId, number>;  // % of the junction flow, sum 100
  closed: PipeId[];                    // closed valves
  demandFactors: Record<DestId, number>;
}

export const DEFAULT_INPUTS: FlowInputs = {
  pumpOn: true,
  pumpFlow: 0.5,
  pumpCapacity: 0.8,
  setpoint: 45,
  sourceLimit: null,
  leaks: { trunk: 0, res: 0, agr: 0, ind: 0, oth: 0 },
  allocation: { residential: 45, agricultural: 30, industrial: 15, other: 10 },
  closed: [],
  demandFactors: { residential: 1, agricultural: 1, industrial: 1, other: 1 },
};

export function toRequest(i: FlowInputs, extra: Partial<FlowRequest> = {}): FlowRequest {
  const leaks = Object.fromEntries(Object.entries(i.leaks).filter(([, v]) => v > 0));
  const factors = Object.fromEntries(Object.entries(i.demandFactors).filter(([, v]) => v !== 1));
  return {
    pumpFlowM3s: i.pumpFlow,
    setpointM: i.setpoint,
    leaks,
    pumpOn: i.pumpOn,
    pumpCapacityM3s: i.pumpCapacity,
    sourceLimitM3s: i.sourceLimit,
    allocationPct: i.allocation,
    closedPipes: i.closed,
    demandFactors: Object.keys(factors).length ? factors : null,
    optimize: false,
    ...extra,
  };
}

export interface Scenario {
  id: string;
  label: string;
  /** what changes, in plain words */
  change: string;
  /** why the results move */
  why: string;
  apply: (base: FlowInputs) => FlowInputs;
}

const clone = (i: FlowInputs): FlowInputs => ({
  ...i, leaks: { ...i.leaks }, allocation: { ...i.allocation }, closed: [...i.closed], demandFactors: { ...i.demandFactors },
});

export const SCENARIOS: Scenario[] = [
  {
    id: "normal", label: "Normal operation", change: "Default pump flow, set-point, allocation and demand; no burst leaks.",
    why: "The reference point: supply meets the hypothetical demand after background leakage.",
    apply: () => clone(DEFAULT_INPUTS),
  },
  {
    id: "high-demand", label: "High water demand", change: "Every zone needs 30 % more water; the pump flow stays the same.",
    why: "Delivered water cannot rise without more pumping, so the network runs a deficit.",
    apply: (b) => ({ ...clone(b), demandFactors: { residential: 1.3, agricultural: 1.3, industrial: 1.3, other: 1.3 } }),
  },
  {
    id: "pump-capacity", label: "Pump capacity reduction", change: "Pump capacity drops to 0.35 m³/s (e.g. worn impeller or one pump down).",
    why: "The pump can no longer reach the requested flow, so every zone receives less.",
    apply: (b) => ({ ...clone(b), pumpCapacity: 0.35 }),
  },
  {
    id: "leakage", label: "Pipeline leakage", change: "A severe burst on the trunk main and a smaller one on the residential branch.",
    why: "Pressure-dependent leakage (FAVAD) takes water before it reaches the zones: losses rise, deliveries fall.",
    apply: (b) => ({ ...clone(b), leaks: { ...b.leaks, trunk: 2, res: 1 } }),
  },
  {
    id: "agri-demand", label: "Agricultural demand increase", change: "Irrigation demand rises by 60 % (dry spell) with the same allocation.",
    why: "The agricultural branch keeps its share of the flow, so its supply falls short of the higher demand.",
    apply: (b) => ({ ...clone(b), demandFactors: { ...b.demandFactors, agricultural: 1.6 } }),
  },
  {
    id: "industry-demand", label: "Industrial demand increase", change: "Industrial demand rises by 80 % (new production line).",
    why: "Industry keeps its share of the flow, so its supply falls short of the higher demand.",
    apply: (b) => ({ ...clone(b), demandFactors: { ...b.demandFactors, industrial: 1.8 } }),
  },
  {
    id: "pump-failure", label: "Pump failure", change: "The pump stops.",
    why: "With no pumping the conceptual network is depressurised: no zone receives water.",
    apply: (b) => ({ ...clone(b), pumpOn: false }),
  },
  {
    id: "shortage", label: "Water shortage", change: "Only 0.30 m³/s is available at the source.",
    why: "The pump cannot deliver more than the source provides, so every zone is short.",
    apply: (b) => ({ ...clone(b), sourceLimit: 0.3 }),
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
