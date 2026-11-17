/** Map layer state and defaults (kept separate so pages can import them without loading MapLibre). */
export interface LayerState {
  boundaries: boolean;
  rivers: boolean;
  surfaceWater: boolean;
  /** GRACE grid cells (terrestrial water storage anomaly, ~300 km effective resolution). */
  groundwater: boolean;
  weatherPoints: boolean;
  scarcity: boolean;
  terrain: boolean;
  extrude: boolean;
  level: "division" | "district";
  opacity: { surfaceWater: number; scarcity: number; groundwater: number };
  /** Wetlands where OpenStreetMap maps them (Water Explorer only). */
  wetlands?: boolean;
  /** Division name labels (Water Explorer only). */
  labels?: boolean;
}

export const DEFAULT_LAYERS: LayerState = {
  boundaries: true, rivers: true, surfaceWater: false, groundwater: false, weatherPoints: true, scarcity: true,
  terrain: true, extrude: true, level: "division", opacity: { surfaceWater: 0.8, scarcity: 0.7, groundwater: 0.6 },
  wetlands: true, labels: true,
};

/** Default vertical exaggeration of the terrain (Bangladesh is mostly flat; always disclosed on the map). */
export const TERRAIN_EXAGGERATION = 25;
export const EXAGGERATION_RANGE = { min: 1, max: 40 };
