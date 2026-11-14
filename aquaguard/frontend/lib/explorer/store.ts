/**
 * Water Explorer state shared by every view (3D map, 2D map, time series, data table, analysis, spatial
 * intelligence) and the map assistant: the active view, the selected geographic feature, layers and camera.
 * Division selection is mirrored into the global region (existing behaviour), so other modules follow it.
 */
"use client";
import { create } from "zustand";
import { DEFAULT_LAYERS, type LayerState, TERRAIN_EXAGGERATION } from "@/components/maps/layers";

export type ExplorerView = "3d" | "2d" | "series" | "table" | "analysis" | "intel";
export const VIEWS: { id: ExplorerView; label: string }[] = [
  { id: "3d", label: "3D Map" },
  { id: "2d", label: "2D Map" },
  { id: "series", label: "Time Series" },
  { id: "table", label: "Data Table" },
  { id: "analysis", label: "Analysis" },
  { id: "intel", label: "Spatial Intelligence" },
];

export type FeatureKind = "division" | "district" | "weather_point" | "grace_cell" | "river" | "water";

export interface MapSelection {
  kind: FeatureKind;
  /** region id (division / district / weather point), cell id, or the feature name for rivers and water */
  id: string;
  name: string;
  /** division whose data applies (divisions, districts, weather points) */
  divisionId?: string;
  /** extra properties shown in the panel (river class, cell lat / lon / value, coordinates) */
  props?: Record<string, string | number | null>;
}

export type CameraCommand = { type: "reset" | "rotateLeft" | "rotateRight" | "north"; nonce: number };

export const KIND_LABEL: Record<FeatureKind, string> = {
  division: "Division", district: "District (reference boundary)", weather_point: "Representative weather point",
  grace_cell: "GRACE grid cell (~300 km effective)", river: "River or canal (OpenStreetMap)",
  water: "Water body (OpenStreetMap)",
};

interface ExplorerStore {
  view: ExplorerView;
  selection: MapSelection | null;
  layers: LayerState;
  exaggeration: number;
  pitch: number;
  lite: boolean;
  camera: CameraCommand | null;
  setView: (v: ExplorerView) => void;
  select: (s: MapSelection | null) => void;
  setLayers: (l: LayerState) => void;
  setExaggeration: (x: number) => void;
  setPitch: (p: number) => void;
  setLite: (on: boolean) => void;
  cameraCommand: (type: CameraCommand["type"]) => void;
}

export const useExplorer = create<ExplorerStore>((set) => ({
  view: "3d",
  selection: null,
  layers: DEFAULT_LAYERS,
  exaggeration: TERRAIN_EXAGGERATION,
  pitch: 45,
  lite: false,
  camera: null,
  setView: (view) => set({ view }),
  select: (selection) => set({ selection }),
  setLayers: (layers) => set({ layers }),
  setExaggeration: (exaggeration) => set({ exaggeration }),
  setPitch: (pitch) => set({ pitch }),
  setLite: (lite) => set({ lite }),
  cameraCommand: (type) => set({ camera: { type, nonce: Date.now() + Math.random() } }),
}));

/** Region whose data the analysis views use: the selected division (or a district's / point's division), else bd. */
export function analysisRegion(sel: MapSelection | null): string {
  return sel?.divisionId ?? "bd";
}
