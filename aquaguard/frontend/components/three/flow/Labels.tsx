"use client";
/**
 * Labels above every facility and zone (name, key value, status with an icon, never colour alone), a hover tooltip,
 * and small flow tags on the modelled pipes. Labels never capture the pointer, so they cannot block a click.
 */
import { Html } from "@react-three/drei";
import { createContext, type RefObject, useContext } from "react";
import { AlertTriangle, CheckCircle2, CircleOff, Info } from "lucide-react";
import { DEST_STATUS, fmt, nodeSummary, pipeFlow, pumpStatus } from "@/lib/flow/derive";
import { isDestId, nodeById, NODES, type NodeDef, PIPE_DEFS, pipeById } from "@/lib/flow/network";
import { type LayerKey, useFlowStore } from "@/lib/flow/store";
import type { FlowState } from "@/lib/types/contract";
import { PIPE_Y, pipeCurve } from "./Pipes";

/**
 * A fixed overlay element that every label is portalled into. Without it drei's Html mounts into the canvas container
 * and re-mounts when the event source connects, which can leave a label empty (and throw "removeChild").
 */
export const LabelPortal = createContext<RefObject<HTMLDivElement | null> | null>(null);
export function useLabelPortal() {
  return (useContext(LabelPortal) ?? undefined) as RefObject<HTMLElement> | undefined;
}

type Tone = "good" | "warn" | "bad" | "off";
const TONE_CLASS: Record<Tone, string> = {
  good: "text-[#166534]", warn: "text-[#92400e]", bad: "text-[#b42318]", off: "text-[#475569]",
};

export function ToneIcon({ tone, size = 11 }: { tone: Tone; size?: number }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "bad" ? AlertTriangle : CircleOff;
  return <Icon size={size} aria-hidden className={TONE_CLASS[tone]} />;
}

export function nodeLayer(id: NodeDef["id"]): LayerKey {
  if (id === "reservoir" || id === "treatment") return "reservoirs";
  if (id === "pump") return "pumps";
  if (id === "junction") return "mainPipes";
  return id;
}

function nodeTone(id: NodeDef["id"], s: FlowState): Tone | null {
  if (isDestId(id)) {
    const d = s.destinations.find((x) => x.id === id);
    return d ? DEST_STATUS[d.status]?.tone ?? null : null;
  }
  if (id === "pump") return pumpStatus(s).tone;
  return null;
}

function NodeLabel({ n, state }: { n: NodeDef; state: FlowState }) {
  const portal = useLabelPortal();
  const tone = nodeTone(n.id, state);
  const status = isDestId(n.id) ? DEST_STATUS[state.destinations.find((x) => x.id === n.id)?.status ?? ""]?.label
    : n.id === "pump" ? pumpStatus(state).label : null;
  const summary = nodeSummary(n.id, state).split(" · ")[0];
  return (
    <Html position={n.labelPos ?? [n.pos[0], n.labelY, n.pos[1]]} center zIndexRange={[15, 0]} portal={portal}
          style={{ pointerEvents: "none" }}>
      <div data-flow-label={n.id} className="pointer-events-none select-none whitespace-nowrap rounded-md border border-[#cfe0f1] bg-white/95 px-2 py-1 text-[11.5px] leading-tight text-[#102b50] shadow-sm">
        <div className="font-semibold">{n.label}</div>
        <div className="flex items-center gap-1 text-[10.5px] text-[#475569]">
          {!n.modelled && <Info size={10} aria-hidden />}
          <span>{n.modelled ? summary : "Illustrative"}</span>
          {status && tone && (
            <span className={`ml-1 inline-flex items-center gap-0.5 font-medium ${TONE_CLASS[tone]}`}>
              <ToneIcon tone={tone} size={10} /> {status}
            </span>
          )}
        </div>
      </div>
    </Html>
  );
}

function PipeTag({ id, state }: { id: string; state: FlowState }) {
  const portal = useLabelPortal();
  const def = pipeById(id)!;
  const f = pipeFlow(def.id, state);
  const p = pipeCurve(def).getPointAt(def.kind === "main" ? 0.4 : 0.6);
  return (
    <Html position={[p.x, PIPE_Y + 1.15, p.z]} center zIndexRange={[12, 0]} portal={portal}
          style={{ pointerEvents: "none" }}>
      <div className="pointer-events-none select-none whitespace-nowrap rounded bg-[#0f2f57]/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {f.closed ? "Valve closed" : `${fmt(f.flow, 3)} m³/s`}
      </div>
    </Html>
  );
}

export function Labels({ state }: { state: FlowState }) {
  const layers = useFlowStore((s) => s.layers);
  if (!layers.labels) return null;
  return (
    <group>
      {NODES.filter((n) => layers[nodeLayer(n.id)]).map((n) => <NodeLabel key={n.id} n={n} state={state} />)}
      {PIPE_DEFS.filter((d) => d.modelled && (d.kind === "main" ? layers.mainPipes : layers.branchPipes)
        && !(layers.leaks && pipeFlow(d.id, state).severity > 0))
        .map((d) => <PipeTag key={d.id} id={d.id} state={state} />)}
    </group>
  );
}

/** Tooltip for the hovered object (not shown for the selected one: the info panel already describes it). */
export function HoverTip({ state }: { state: FlowState }) {
  const hover = useFlowStore((s) => s.hover);
  const selection = useFlowStore((s) => s.selection);
  const portal = useLabelPortal();
  if (!hover || (selection && selection.kind === hover.kind && selection.id === hover.id)) return null;
  let pos: [number, number, number];
  let title: string;
  let line: string;
  if (hover.kind === "node") {
    const n = nodeById(hover.id)!;
    pos = [n.pos[0], n.labelY + 1.6, n.pos[1]];
    title = n.label;
    line = n.modelled ? nodeSummary(n.id, state) : "Illustrative · not modelled";
  } else {
    const def = pipeById(hover.id)!;
    const p = pipeCurve(def).getPointAt(0.5);
    const f = pipeFlow(def.id, state);
    pos = [p.x, PIPE_Y + 2, p.z];
    title = def.label;
    line = f.closed ? "Valve closed · no flow"
      : `${fmt(f.flow, 3)} m³/s · ${fmt(f.velocity, 2)} m/s${f.severity > 0 ? ` · leak ${fmt(f.leak, 3)} m³/s` : ""}`;
    if (!def.modelled) line = `${line} · illustrative`;
  }
  return (
    <Html position={pos} center zIndexRange={[25, 0]} portal={portal} style={{ pointerEvents: "none" }}>
      <div role="tooltip" className="pointer-events-none whitespace-nowrap rounded-md bg-[#0f2f57] px-2 py-1 text-[11px] text-white shadow-lg">
        <div className="font-semibold">{title}</div>
        <div className="text-[10.5px] text-[#d6e6f7]">{line}</div>
        <div className="text-[10px] text-[#9fc0e3]">Click for details</div>
      </div>
    </Html>
  );
}

