/**
 * Turns the engine's answer (FlowState) into the values every view shows: node and pipe details, statuses and
 * short labels. One function per object, so the 3D labels, info panel, schematic and data table agree exactly.
 */
import type { FlowResponse, FlowState } from "@/lib/types/contract";
import { type AnyPipeId, DEST_PIPE, isDestId, isPipeId, type NodeId, nodeById, NODES, PIPE_DEFS, pipeById } from "./network";

type M = { value?: number | null; unit?: string } | null | undefined;

export function num(m: M): number | null {
  const v = m?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function fmt(v: number | null, digits = 0): string {
  return v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export const perDay = (m: M) => `${fmt(num(m))} m³/day`;

export const DEST_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "off" }> = {
  served: { label: "Served", tone: "good" },
  under_supplied: { label: "Under-supplied", tone: "warn" },
  low_pressure: { label: "Low pressure", tone: "warn" },
  no_supply: { label: "No supply", tone: "bad" },
  closed: { label: "Valve closed", tone: "off" },
};

export const BALANCE_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "off" }> = {
  balanced: { label: "Balanced", tone: "good" },
  surplus: { label: "Surplus", tone: "warn" },
  deficit: { label: "Deficit", tone: "bad" },
  invalid: { label: "Invalid configuration", tone: "off" },
};

export const LIMIT_TEXT: Record<string, string> = {
  pump_off: "Pump is off: no water moves.",
  valve_closed: "No open path: the trunk valve or every branch valve is closed.",
  pump_capacity: "Flow limited by the pump capacity.",
  source_limit: "Flow limited by the water available at the source.",
};

export interface Row { label: string; value: string }
export interface Info {
  title: string;
  category: string;
  modelled: boolean;
  status?: { label: string; tone: "good" | "warn" | "bad" | "off" };
  rows: Row[];
}

export function pumpStatus(s: FlowState) {
  if (!s.pumpOn) return { label: "Off", tone: "bad" as const };
  if (s.limitingFactor === "valve_closed") return { label: "Running against a closed valve", tone: "warn" as const };
  if (s.limitingFactor) return { label: "Running (limited)", tone: "warn" as const };
  return { label: "Running", tone: "good" as const };
}

export function nodeInfo(id: NodeId, s: FlowState, r: FlowResponse | null): Info {
  const n = nodeById(id)!;
  const inflow = perDay(s.inflowDaily);
  if (id === "reservoir") {
    return { title: n.label, category: n.category, modelled: false, rows: [
      { label: "Outflow to treatment / pump", value: inflow },
      { label: "Capacity (illustrative)", value: r?.reservoirCapacity ? `${fmt(num(r.reservoirCapacity))} m³` : "—" },
      { label: "Inflow to the reservoir", value: "Not modelled (steady state: refilled at the rate drawn)" },
      { label: "Storage level", value: "Not modelled (level shown is illustrative)" },
    ] };
  }
  if (id === "treatment") {
    return { title: n.label, category: n.category, modelled: false, rows: [
      { label: "Throughput", value: inflow },
      { label: "Treatment losses", value: "Not modelled" },
    ] };
  }
  if (id === "pump") {
    return { title: n.label, category: n.category, modelled: true, status: pumpStatus(s), rows: [
      { label: "Flow delivered", value: `${fmt(num(s.pumpFlow), 3)} m³/s (${inflow})` },
      { label: "Flow requested", value: `${fmt(num(s.requestedPumpFlow), 3)} m³/s` },
      { label: "Capacity", value: `${fmt(num(s.pumpCapacity), 2)} m³/s` },
      { label: "Utilization", value: `${fmt(num(s.pumpUtilization), 1)} %` },
      { label: "Outlet pressure (set-point)", value: s.pumpOn ? `${fmt(num(s.setpoint), 1)} m head` : "0 m (off)" },
      ...(s.limitingFactor ? [{ label: "Limit", value: LIMIT_TEXT[s.limitingFactor] }] : []),
      { label: "Pump speed", value: "Not modelled" },
    ] };
  }
  if (id === "junction") {
    const trunk = s.pipes.find((p) => p.id === "trunk");
    const q = trunk ? (num(trunk.flowDaily) ?? 0) : 0;
    return { title: n.label, category: n.category, modelled: true, rows: [
      { label: "Pressure", value: `${fmt(num(trunk?.pressureEnd), 1)} m head` },
      { label: "Mean trunk flow", value: `${fmt(q)} m³/day` },
      { label: "Branches", value: "Residential, agricultural, industrial, commercial & public" },
    ] };
  }
  if (isDestId(id)) {
    const d = s.destinations.find((x) => x.id === id);
    if (!d) return { title: n.label, category: n.category, modelled: true, rows: [{ label: "Values", value: "Unavailable" }] };
    return { title: n.label, category: n.category, modelled: true, status: DEST_STATUS[d.status], rows: [
      { label: "Delivered", value: perDay(d.deliveredDaily) },
      { label: "Demand (hypothetical)", value: perDay(d.demandDaily) },
      { label: "Supply", value: num(d.supply) === null ? "—" : `${fmt(num(d.supply), 1)} % of demand` },
      { label: "Allocated share", value: `${fmt(num(d.share), 1)} % (${perDay(d.allocatedDaily)})` },
      { label: "Pressure", value: `${fmt(num(d.pressure), 1)} m (minimum ${fmt(num(d.minServicePressure), 0)} m)` },
      { label: "Feeding pipe", value: pipeById(DEST_PIPE[id])!.label },
    ] };
  }
  return { title: n.label, category: n.category, modelled: n.modelled, rows: [] };
}

export function pipeInfo(id: AnyPipeId, s: FlowState): Info {
  const def = pipeById(id)!;
  const from = nodeById(def.from)!.label;
  const to = nodeById(def.to)!.label;
  if (!isPipeId(id)) {
    return { title: def.label, category: "Intake pipeline (illustrative)", modelled: false, rows: [
      { label: "Pipeline ID", value: id }, { label: "From → to", value: `${from} → ${to}` },
      { label: "Flow", value: perDay(s.inflowDaily) }, { label: "Pressure / leakage", value: "Not modelled" },
    ] };
  }
  const p = s.pipes.find((x) => x.id === id);
  if (!p) return { title: def.label, category: def.kind, modelled: true, rows: [{ label: "Values", value: "Unavailable" }] };
  const tone = p.status === "closed" ? "off" : p.status === "leaking" ? "bad" : (num(p.flow) ?? 0) > 0 ? "good" : "off";
  return {
    title: def.label, category: def.kind === "main" ? "Main pipeline" : "Branch pipeline", modelled: true,
    status: { label: p.status === "closed" ? "Valve closed" : p.status === "leaking" ? `Leaking (burst severity ${p.burstSeverity})`
      : (num(p.flow) ?? 0) > 0 ? "Open, flowing" : "Open, no flow", tone },
    rows: [
      { label: "Pipeline ID", value: id },
      { label: "From → to", value: `${from} → ${to}` },
      { label: "Length · diameter", value: `${fmt(p.lengthM)} m · ${fmt(p.diameterM * 1000)} mm` },
      { label: "Mean flow", value: `${perDay(p.flowDaily)} (${fmt(num(p.velocity), 2)} m/s)` },
      { label: "Pressure start → end", value: `${fmt(num(p.pressureStart), 1)} → ${fmt(num(p.pressureEnd), 1)} m` },
      { label: "Head loss", value: `${fmt(num(p.headLoss), 2)} m` },
      { label: "Estimated leakage", value: perDay(p.leakDaily) },
    ],
  };
}

/** Short value under a 3D / schematic label. */
export function nodeSummary(id: NodeId, s: FlowState): string {
  if (isDestId(id)) {
    const d = s.destinations.find((x) => x.id === id);
    return d ? `${perDay(d.deliveredDaily)} · ${DEST_STATUS[d.status].label}` : "—";
  }
  if (id === "pump") return `${fmt(num(s.pumpFlow), 2)} m³/s · ${pumpStatus(s).label}`;
  if (id === "junction") return `${fmt(num(s.pipes.find((p) => p.id === "trunk")?.pressureEnd), 1)} m head`;
  if (id === "reservoir") return `${perDay(s.inflowDaily)} out`;
  return "Illustrative";
}

/** Pipe flow (m³/s) used to animate: intake pipes carry the pump flow. */
export function pipeFlow(id: AnyPipeId, s: FlowState): { flow: number; velocity: number; leak: number; severity: number;
  closed: boolean; pressure: number } {
  if (!isPipeId(id)) {
    const trunk = s.pipes.find((p) => p.id === "trunk");
    return { flow: num(s.pumpFlow) ?? 0, velocity: num(trunk?.velocity) ?? 0, leak: 0, severity: 0, closed: false,
             pressure: num(s.setpoint) ?? 0 };
  }
  const p = s.pipes.find((x) => x.id === id);
  return { flow: num(p?.flow) ?? 0, velocity: num(p?.velocity) ?? 0, leak: num(p?.leak) ?? 0,
           severity: p?.burstSeverity ?? 0, closed: p?.status === "closed",
           pressure: ((num(p?.pressureStart) ?? 0) + (num(p?.pressureEnd) ?? 0)) / 2 };
}

export type Tone = "good" | "warn" | "bad" | "off";

/** Accounting identity at the network boundary (pump outlet → delivery points). */
export interface Accounting {
  inflow: number | null;
  delivered: number | null;
  leakage: number | null;
  storageChange: null; // not modelled: steady state
  residual: number | null;
  /** valid when the identity closes within 0.1 % of the inflow (or 1 m³/day at zero flow) */
  valid: boolean;
}

export function accounting(s: FlowState): Accounting {
  const inflow = num(s.inflowDaily);
  const delivered = num(s.deliveredDaily);
  const leakage = num(s.leakDaily);
  const residual = inflow === null || delivered === null || leakage === null ? null : inflow - delivered - leakage;
  const tol = Math.max(1, (inflow ?? 0) * 0.001);
  return { inflow, delivered, leakage, storageChange: null, residual, valid: residual !== null && Math.abs(residual) <= tol };
}

/** Supply-vs-demand status, or "invalid" when the accounting identity does not close. */
export function balanceStatus(s: FlowState): { key: string; label: string; tone: Tone } {
  const key = accounting(s).valid ? s.balanceStatus : "invalid";
  const b = BALANCE_STATUS[key] ?? BALANCE_STATUS.invalid;
  return { key, ...b };
}

export interface TableRow {
  kind: "node" | "pipe";
  id: string;
  name: string;
  type: string;
  group: "facility" | "zone" | "pipeline";
  flowDaily: number | null;
  pressure: number | null;
  leakDaily: number | null;
  status: { label: string; tone: Tone };
  modelled: boolean;
}

/** One row per object, for the data table (same numbers as the info panel and the labels). */
export function tableRows(s: FlowState): TableRow[] {
  const rows: TableRow[] = [];
  const inflow = num(s.inflowDaily);
  const trunk = s.pipes.find((p) => p.id === "trunk");
  const illustrative = { label: "Illustrative", tone: "off" as const };
  for (const n of NODES) {
    if (isDestId(n.id)) {
      const d = s.destinations.find((x) => x.id === n.id);
      rows.push({ kind: "node", id: n.id, name: n.label, type: "Consumer zone", group: "zone",
        flowDaily: num(d?.deliveredDaily), pressure: num(d?.pressure), leakDaily: null,
        status: d ? DEST_STATUS[d.status] ?? illustrative : illustrative, modelled: true });
    } else if (n.id === "pump") {
      rows.push({ kind: "node", id: n.id, name: n.label, type: "Pump station", group: "facility", flowDaily: inflow,
        pressure: s.pumpOn ? num(s.setpoint) : 0, leakDaily: null, status: pumpStatus(s), modelled: true });
    } else if (n.id === "junction") {
      rows.push({ kind: "node", id: n.id, name: n.label, type: "Junction", group: "facility",
        flowDaily: num(trunk?.flowDaily), pressure: num(trunk?.pressureEnd), leakDaily: null,
        status: { label: "Operating", tone: "good" }, modelled: true });
    } else {
      rows.push({ kind: "node", id: n.id, name: n.label, type: n.id === "reservoir" ? "Reservoir" : "Treatment plant",
        group: "facility", flowDaily: inflow, pressure: null, leakDaily: null, status: illustrative, modelled: false });
    }
  }
  for (const def of PIPE_DEFS) {
    if (!isPipeId(def.id)) {
      rows.push({ kind: "pipe", id: def.id, name: def.label, type: "Intake pipeline", group: "pipeline", flowDaily: inflow,
        pressure: null, leakDaily: null, status: illustrative, modelled: false });
      continue;
    }
    const info = pipeInfo(def.id, s);
    const p = s.pipes.find((x) => x.id === def.id);
    const f = pipeFlow(def.id, s);
    rows.push({ kind: "pipe", id: def.id, name: def.label, type: def.kind === "main" ? "Main pipeline" : "Branch pipeline",
      group: "pipeline", flowDaily: num(p?.flowDaily), pressure: p ? f.pressure : null, leakDaily: num(p?.leakDaily),
      status: info.status ?? illustrative, modelled: true });
  }
  return rows;
}

/** Signed change with a direction word, for the scenario comparison (never colour alone). */
export function delta(now: number | null, base: number | null, digits = 0): { text: string; dir: "up" | "down" | "same" } {
  if (now === null || base === null) return { text: "—", dir: "same" };
  const d = now - base;
  const eps = 0.5 * 10 ** -digits;
  if (Math.abs(d) < eps) return { text: "no change", dir: "same" };
  return { text: `${d > 0 ? "+" : "−"}${fmt(Math.abs(d), digits)}`, dir: d > 0 ? "up" : "down" };
}
