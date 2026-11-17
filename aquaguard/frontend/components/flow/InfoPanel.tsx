"use client";
/** Details of the selected object (same numbers as the labels, schematic and table) with quick actions. */
import { Crosshair, X } from "lucide-react";
import { nodeInfo, pipeInfo } from "@/lib/flow/derive";
import { isPipeId, nodeById, pipeById } from "@/lib/flow/network";
import { scenarioById } from "@/lib/flow/scenarios";
import { useFlowStore } from "@/lib/flow/store";
import type { FlowResponse, FlowState } from "@/lib/types/contract";
import { StatusPill } from "./Status";

export function InfoPanel({ state, res, showing, className = "", headingId }: {
  state: FlowState; res: FlowResponse | null; showing: "current" | "optimized"; className?: string; headingId: string;
}) {
  const selection = useFlowStore((s) => s.selection);
  const select = useFlowStore((s) => s.select);
  const view = useFlowStore((s) => s.view);
  const running = useFlowStore((s) => s.running);
  const scenarioId = useFlowStore((s) => s.scenarioId);
  const inputs = useFlowStore((s) => s.inputs);
  const toggleValve = useFlowStore((s) => s.toggleValve);
  const setLeak = useFlowStore((s) => s.setLeak);
  const setInputs = useFlowStore((s) => s.setInputs);
  const cameraCommand = useFlowStore((s) => s.cameraCommand);
  if (!selection) return null;
  if (selection.kind === "node" && !nodeById(selection.id)) return null;
  if (selection.kind === "pipe" && !pipeById(selection.id)) return null;
  const info = selection.kind === "node" ? nodeInfo(selection.id, state, res) : pipeInfo(selection.id, state);
  const pipe = selection.kind === "pipe" && isPipeId(selection.id) ? selection.id : null;
  const scenario = scenarioById(scenarioId)?.label ?? "Custom settings";
  return (
    <section aria-labelledby={headingId} data-testid="flow-info"
             className={`flex-col overflow-hidden border border-border bg-white shadow-lg ${className}`}>
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{info.category}</p>
          <h2 id={headingId} className="text-[15px] font-semibold text-ink">{info.title}</h2>
        </div>
        <button type="button" onClick={() => select(null)} aria-label="Close details"
                className="rounded-md p-1 text-muted hover:bg-light hover:text-ink"><X size={16} aria-hidden /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {info.status && <StatusPill status={info.status} />}
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${info.modelled ? "border-primary/40 text-primary" : "border-border text-muted"}`}>
            {info.modelled ? "Simulated (conceptual)" : "Illustrative · not modelled"}
          </span>
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-2 gap-y-1 text-[12.5px]">
          {info.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-muted">{r.label}</dt>
              <dd className="tabular-nums text-ink">{r.value}</dd>
            </div>
          ))}
          <div className="contents">
            <dt className="text-muted">Simulation</dt>
            <dd className="text-ink">{running ? "Animating" : "Paused"} · {scenario} · {showing === "optimized" ? "optimized state" : "current state"}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {view === "3d" && (
            <button type="button" onClick={() => cameraCommand("focus")}
                    className="inline-flex items-center gap-1 rounded-lg border border-control px-2 py-1 text-[12px] hover:bg-light">
              <Crosshair size={13} aria-hidden /> Focus camera
            </button>
          )}
          {pipe && (
            <>
              <button type="button" onClick={() => toggleValve(pipe)}
                      className="rounded-lg border border-control px-2 py-1 text-[12px] hover:bg-light">
                {inputs.closed.includes(pipe) ? "Open valve" : "Close valve"}
              </button>
              <button type="button" onClick={() => setLeak(pipe, inputs.leaks[pipe] > 0 ? 0 : 1)}
                      className="rounded-lg border border-control px-2 py-1 text-[12px] hover:bg-light">
                {inputs.leaks[pipe] > 0 ? "Repair leak" : "Add a leak"}
              </button>
            </>
          )}
          {selection.kind === "node" && selection.id === "pump" && (
            <button type="button" onClick={() => setInputs({ pumpOn: !inputs.pumpOn })}
                    className="rounded-lg border border-control px-2 py-1 text-[12px] hover:bg-light">
              {inputs.pumpOn ? "Stop pump" : "Start pump"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
