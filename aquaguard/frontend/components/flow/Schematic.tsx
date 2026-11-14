"use client";
/**
 * Schematic view: the same network as a clean SVG diagram. Line width follows the flow, dashes mean a closed valve,
 * a warning badge marks a leak, and moving dashes show the direction while the animation plays. Every node and
 * pipe is a keyboard-focusable button that selects the same object as the 3D view and the data table.
 */
import type { KeyboardEvent } from "react";
import { DEST_STATUS, fmt, nodeSummary, pipeFlow, pumpStatus, type Tone } from "@/lib/flow/derive";
import { type AnyPipeId, isDestId, NODES, type NodeDef, PIPE_DEFS, type PipeDef, nodeById } from "@/lib/flow/network";
import { sameSel, type Selection, useFlowStore } from "@/lib/flow/store";
import type { FlowState } from "@/lib/types/contract";

const W = 1000;
const H = 620;
const TONE_STROKE: Record<Tone, string> = { good: "#16A34A", warn: "#D97706", bad: "#DC2626", off: "#94A3B8" };
const TONE_TEXT: Record<Tone, string> = { good: "#166534", warn: "#92400E", bad: "#B42318", off: "#475569" };
const TONE_MARK: Record<Tone, string> = { good: "✓", warn: "!", bad: "×", off: "–" };
const KIND_STROKE = { intake: "#64748B", main: "#1E40AF", branch: "#0284C7" } as const;

function nodeBox(n: NodeDef) {
  const w = isDestId(n.id) ? 210 : n.id === "reservoir" || n.id === "junction" ? 112 : 126;
  const h = isDestId(n.id) ? 86 : 70;
  return { x: n.sch[0] - w / 2, y: n.sch[1] - h / 2, w, h };
}

const BRANCH_OFFSET: Record<string, number> = { res: -21, agr: -7, ind: 7, oth: 21 };

/** Straight runs: horizontal for the intake and trunk, one diagonal per branch (no shared segments). */
function edgeGeometry(def: PipeDef) {
  const a = nodeById(def.from)!;
  const b = nodeById(def.to)!;
  const ax = a.sch[0] + nodeBox(a).w / 2;
  const ay = a.sch[1] + (BRANCH_OFFSET[def.id] ?? 0);
  const bx = b.sch[0] - nodeBox(b).w / 2 - 4;
  const by = b.sch[1];
  return { d: `M${ax},${ay} L${bx},${by}`, mx: (ax + bx) / 2, my: (ay + by) / 2 };
}

function onKey(e: KeyboardEvent, fn: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
}

function Edge({ def, state, running }: { def: PipeDef; state: FlowState; running: boolean }) {
  const sel = { kind: "pipe" as const, id: def.id as AnyPipeId };
  const selected = useFlowStore((s) => sameSel(s.selection, sel));
  const hovered = useFlowStore((s) => sameSel(s.hover, sel));
  const select = useFlowStore((s) => s.select);
  const setHover = useFlowStore((s) => s.setHover);
  const f = pipeFlow(def.id, state);
  const flowing = !f.closed && f.flow > 1e-6;
  const width = f.closed ? 4 : Math.max(3, Math.min(14, 3 + f.flow * 18));
  const { d, mx, my } = edgeGeometry(def);
  const branch = def.kind === "branch";
  const lx = mx;
  const ly = branch ? my - 9 : my - 16;
  const value = f.closed ? "Valve closed" : `${fmt(f.flow, 3)} m³/s`;
  const label = `${def.label}: ${value}${f.severity > 0 ? `, leaking ${fmt(f.leak, 3)} m³/s` : ""}${def.modelled ? "" : " (illustrative)"}`;
  return (
    <g role="button" tabIndex={0} aria-label={label} aria-pressed={selected} className="cursor-pointer outline-none"
       onClick={() => select(sel)} onKeyDown={(e) => onKey(e, () => select(sel))}
       onMouseEnter={() => setHover(sel)} onMouseLeave={() => setHover(null)}
       onFocus={() => setHover(sel)} onBlur={() => setHover(null)}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={26} />
      {(selected || hovered) && (
        <path d={d} fill="none" stroke={selected ? "#F59E0B" : "#38BDF8"} strokeWidth={width + 8} strokeLinecap="round" opacity={0.6} />
      )}
      <path d={d} fill="none" stroke={f.closed ? "#9CA3AF" : KIND_STROKE[def.kind]} strokeWidth={width}
            strokeLinecap="round" strokeDasharray={f.closed ? "8 8" : undefined} markerEnd={flowing ? "url(#sch-arrow)" : undefined} />
      {flowing && (
        <path d={d} fill="none" stroke="#E0F7FF" strokeWidth={Math.max(1.5, width / 3)} strokeDasharray="4 14" strokeLinecap="round">
          {running && <animate attributeName="stroke-dashoffset" from="36" to="0" dur={`${Math.max(0.4, 2.4 - f.velocity)}s`} repeatCount="indefinite" />}
        </path>
      )}
      <text x={lx} y={ly} textAnchor="middle"
            fontSize={14} className="fill-[#102b50] font-medium" style={{ paintOrder: "stroke" }} stroke="#ffffff" strokeWidth={5}>
        {def.modelled ? value : ""}
      </text>
      {f.severity > 0 && (
        <g transform={`translate(${lx},${branch ? ly + 24 : my + 58})`}>
          <rect x={-70} y={-15} width={140} height={22} rx={11} fill="#FEE2E2" stroke="#DC2626" />
          <text x={0} y={1} textAnchor="middle" fontSize={13.5} className="fill-[#B42318] font-semibold">⚠ Leak {fmt(f.leak, 3)} m³/s</text>
        </g>
      )}
    </g>
  );
}

function Node({ n, state }: { n: NodeDef; state: FlowState }) {
  const sel = { kind: "node" as const, id: n.id };
  const selected = useFlowStore((s) => sameSel(s.selection, sel));
  const hovered = useFlowStore((s) => sameSel(s.hover, sel));
  const select = useFlowStore((s) => s.select);
  const setHover = useFlowStore((s) => s.setHover);
  const box = nodeBox(n);
  let tone: Tone | null = null;
  let status = "";
  if (isDestId(n.id)) {
    const d = state.destinations.find((x) => x.id === n.id);
    if (d) ({ tone, label: status } = DEST_STATUS[d.status] ?? { tone: null, label: "" });
  } else if (n.id === "pump") ({ tone, label: status } = pumpStatus(state));
  const summary = n.modelled ? nodeSummary(n.id, state).split(" · ")[0] : "Illustrative";
  return (
    <g role="button" tabIndex={0} aria-label={`${n.label}: ${summary}${status ? `, ${status}` : ""}`} aria-pressed={selected}
       className="cursor-pointer outline-none" onClick={() => select(sel)} onKeyDown={(e) => onKey(e, () => select(sel))}
       onMouseEnter={() => setHover(sel)} onMouseLeave={() => setHover(null)}
       onFocus={() => setHover(sel)} onBlur={() => setHover(null)}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={12}
            fill={n.modelled ? "#FFFFFF" : "#F1F5F9"} stroke={selected ? "#F59E0B" : hovered ? "#38BDF8" : tone ? TONE_STROKE[tone] : "#94A3B8"}
            strokeWidth={selected || hovered ? 3.5 : 1.8} strokeDasharray={n.modelled ? undefined : "5 4"} />
      <text x={n.sch[0]} y={box.y + 24} textAnchor="middle" fontSize={15} className="fill-[#102b50] font-semibold">{n.label}</text>
      <text x={n.sch[0]} y={box.y + 45} textAnchor="middle" fontSize={13.5} className="fill-[#475569]">{summary}</text>
      {status && tone && (
        <text x={n.sch[0]} y={box.y + 66} textAnchor="middle" fill={TONE_TEXT[tone]} fontSize={13.5} className="font-semibold">
          {TONE_MARK[tone]} {status}
        </text>
      )}
    </g>
  );
}

export function Schematic({ state }: { state: FlowState }) {
  const running = useFlowStore((s) => s.running);
  const select = useFlowStore((s) => s.select);
  return (
    <div className="h-full w-full overflow-auto bg-[#f7fbff]" data-testid="flow-schematic">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full min-h-[360px] w-full min-w-[600px]" role="group"
           aria-label="Schematic of the conceptual network: reservoir, treatment plant, pump station, junction and four consumer zones"
           onClick={(e) => { if (e.target === e.currentTarget) select(null as Selection); }}>
        <defs>
          <marker id="sch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#1E3A8A" />
          </marker>
        </defs>
        {PIPE_DEFS.map((def) => <Edge key={def.id} def={def} state={state} running={running} />)}
        {NODES.map((n) => <Node key={n.id} n={n} state={state} />)}
      </svg>
    </div>
  );
}
