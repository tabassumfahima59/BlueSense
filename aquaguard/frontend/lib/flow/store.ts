/**
 * Water Flow module state: one store for the simulation inputs, the selected object, the view, the layers and the
 * playback. The 3D scene, schematic, data table, KPIs and panels all read from here and from the engine's answer.
 */
"use client";
import { create } from "zustand";
import { rebalance } from "@/lib/format/shares";
import type { AnyPipeId, DestId, NodeId, PipeId } from "./network";
import { DEFAULT_INPUTS, type FlowInputs, scenarioById } from "./scenarios";

export type LayerKey =
  | "buildings" | "reservoirs" | "pumps" | "mainPipes" | "branchPipes" | "residential" | "agricultural" | "industrial"
  | "other" | "particles" | "arrows" | "labels" | "leaks" | "terrain" | "roads";

export const LAYER_LABEL: Record<LayerKey, string> = {
  buildings: "3D buildings", reservoirs: "Reservoir & treatment", pumps: "Pump station", mainPipes: "Main pipelines",
  branchPipes: "Branch pipelines", residential: "Residential zone", agricultural: "Agricultural zone",
  industrial: "Industrial zone", other: "Commercial & public zone", particles: "Flow particles",
  arrows: "Flow direction arrows", labels: "Labels", leaks: "Leak markers", terrain: "Terrain & water bodies",
  roads: "Roads & vegetation",
};

export const ALL_LAYERS: Record<LayerKey, boolean> = Object.fromEntries(
  (Object.keys(LAYER_LABEL) as LayerKey[]).map((k) => [k, true])) as Record<LayerKey, boolean>;

export type Selection = { kind: "node"; id: NodeId } | { kind: "pipe"; id: AnyPipeId } | null;
export type ViewMode = "3d" | "schematic" | "table";
export type CameraCommand = { type: "reset" | "focus" | "zoomIn" | "zoomOut" | "left" | "right"; nonce: number };

interface FlowStore {
  inputs: FlowInputs;
  scenarioId: string; // a scenario id, or "custom" after a manual change
  optimize: boolean;
  showOptimized: boolean;
  running: boolean;
  speed: number;
  lowPower: boolean;
  pipeColour: "type" | "pressure";
  layers: Record<LayerKey, boolean>;
  view: ViewMode;
  selection: Selection;
  hover: Selection;
  camera: CameraCommand | null;
  setInputs: (patch: Partial<FlowInputs>) => void;
  setLeak: (pipe: PipeId, severity: number) => void;
  setAllocation: (dest: DestId, pct: number) => void;
  toggleValve: (pipe: PipeId) => void;
  setDemandFactor: (dest: DestId, factor: number) => void;
  applyScenario: (id: string) => void;
  resetSimulation: () => void;
  setOptimize: (on: boolean) => void;
  setShowOptimized: (on: boolean) => void;
  setRunning: (on: boolean) => void;
  setSpeed: (s: number) => void;
  setLowPower: (on: boolean) => void;
  setPipeColour: (m: "type" | "pressure") => void;
  toggleLayer: (k: LayerKey) => void;
  setView: (v: ViewMode) => void;
  select: (s: Selection) => void;
  setHover: (s: Selection) => void;
  cameraCommand: (type: CameraCommand["type"]) => void;
}

const custom = (inputs: FlowInputs) => ({ inputs, scenarioId: "custom", optimize: false, showOptimized: false });

export const useFlowStore = create<FlowStore>((set, get) => ({
  inputs: DEFAULT_INPUTS,
  scenarioId: "normal",
  optimize: false,
  showOptimized: false,
  running: true,
  speed: 1,
  lowPower: false,
  pipeColour: "type",
  layers: ALL_LAYERS,
  view: "3d",
  selection: null,
  hover: null,
  camera: null,
  setInputs: (patch) => set((s) => custom({ ...s.inputs, ...patch })),
  setLeak: (pipe, severity) => set((s) => custom({ ...s.inputs, leaks: { ...s.inputs.leaks, [pipe]: severity } })),
  setAllocation: (dest, pct) => set((s) => custom({
    ...s.inputs, allocation: rebalance(s.inputs.allocation, dest, pct) as Record<DestId, number> })),
  toggleValve: (pipe) => set((s) => {
    const closed = s.inputs.closed.includes(pipe) ? s.inputs.closed.filter((p) => p !== pipe) : [...s.inputs.closed, pipe];
    return custom({ ...s.inputs, closed });
  }),
  setDemandFactor: (dest, factor) => set((s) => custom({
    ...s.inputs, demandFactors: { ...s.inputs.demandFactors, [dest]: factor } })),
  applyScenario: (id) => {
    const sc = scenarioById(id);
    if (!sc) return;
    set({ inputs: sc.apply(DEFAULT_INPUTS), scenarioId: id, optimize: false, showOptimized: false });
  },
  resetSimulation: () => set({ inputs: DEFAULT_INPUTS, scenarioId: "normal", optimize: false, showOptimized: false,
                               running: true, speed: 1, selection: null, camera: { type: "reset", nonce: Date.now() } }),
  setOptimize: (on) => set({ optimize: on, showOptimized: on }),
  setShowOptimized: (on) => set({ showOptimized: on }),
  setRunning: (on) => set({ running: on }),
  setSpeed: (speed) => set({ speed }),
  setLowPower: (lowPower) => set({ lowPower }),
  setPipeColour: (pipeColour) => set({ pipeColour }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setView: (view) => set({ view }),
  select: (selection) => set({ selection }),
  setHover: (hover) => (sameSel(get().hover, hover) ? undefined : set({ hover })),
  cameraCommand: (type) => set({ camera: { type, nonce: Date.now() + Math.random() } }),
}));

export function sameSel(a: Selection, b: Selection): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}
