/**
 * M6 map overlays shared by the 3D (MapLibre) and 2D (SVG) maps: GRACE grid cells, weather points and WebGL
 * detection. Kept free of MapLibre so the page and the 2D fallback can import it without loading WebGL code.
 */
import { NO_CLASS, TONE_COLOR } from "@/components/charts/theme";
import type { GridCell, WeatherPoint } from "@/lib/types/contract";

/** GRACE cells are 0.25° grid points; the CSR mascon solution's effective resolution is about 300 km. */
export const GRACE_CELL_DEG = 0.25;

/**
 * Display bins for the terrestrial water storage anomaly (cm). AquaGuard display choice, not an official
 * classification. As for the other indicator classes, a boundary value belongs to the class farther from neutral
 * (-20 is in the lowest class, +3 in the first wet class); MapLibre's `case` expression mirrors `graceTone`.
 */
export const GRACE_BINS: { max: number | null; inclusive: boolean; tone: number; label: string }[] = [
  { max: -20, inclusive: true, tone: -3, label: "−20 cm or lower" },
  { max: -10, inclusive: true, tone: -2, label: "−20 to −10 cm" },
  { max: -3, inclusive: true, tone: -1, label: "−10 to −3 cm" },
  { max: 3, inclusive: false, tone: 0, label: "−3 to +3 cm" },
  { max: 10, inclusive: false, tone: 1, label: "+3 to +10 cm" },
  { max: 20, inclusive: false, tone: 2, label: "+10 to +20 cm" },
  { max: null, inclusive: false, tone: 3, label: "+20 cm or higher" },
];

export function graceTone(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  for (const b of GRACE_BINS) {
    if (b.max === null || (b.inclusive ? v <= b.max : v < b.max)) return b.tone;
  }
  return 3;
}

export function graceColor(v: number | null | undefined): string {
  const t = graceTone(v);
  return t === null ? NO_CLASS : TONE_COLOR[t];
}

/** MapLibre `case` expression equivalent to `graceColor`. */
export function graceColorExpression(): unknown[] {
  const out: unknown[] = ["case"];
  for (const b of GRACE_BINS) {
    if (b.max === null) break;
    out.push([b.inclusive ? "<=" : "<", ["get", "v"], b.max], TONE_COLOR[b.tone]);
  }
  out.push(TONE_COLOR[3]);
  return out;
}

export function cellsToGeoJSON(cells: GridCell[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const h = GRACE_CELL_DEG / 2;
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { id: c.id, v: c.v, lat: c.lat, lon: c.lon },
      geometry: { type: "Polygon", coordinates: [[[c.lon - h, c.lat - h], [c.lon + h, c.lat - h], [c.lon + h, c.lat + h], [c.lon - h, c.lat + h], [c.lon - h, c.lat - h]]] },
    })),
  };
}

export function pointsToGeoJSON(points: WeatherPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: { id: p.id, name: p.name, t: p.temperature?.value ?? null },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** True when the browser can create a WebGL context (MapLibre needs WebGL; otherwise the 2D map is used). */
export function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
