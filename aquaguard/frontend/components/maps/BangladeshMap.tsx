"use client";
/**
 * MapLibre map of Bangladesh (client-only). Layers: boundaries, rivers (basemap waterways), JRC surface water,
 * GRACE grid cells (TWS anomaly, ~300 km effective resolution), the eight weather points, scarcity risk
 * (choropleth or 3D extrusion), raster-dem terrain.
 *
 * With `explorer` (3D Water Explorer only; other pages keep the original behaviour) the map also: restyles the
 * OpenStreetMap water of the basemap (water bodies, rivers and canals by class, river names, wetlands where mapped),
 * labels the divisions, switches between a 3D and a flat 2D view without re-creating the map, takes the terrain
 * exaggeration and pitch from props, reports clicks on any feature (weather point > GRACE cell > river > water body >
 * division / district) through `onFeature`, and highlights the selected feature.
 */
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, FilterSpecification, Map as MLMap, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { SERIES } from "@/components/charts/theme";
import { riskColor } from "@/lib/format";
import type { RegionValues } from "@/lib/types/contract";
import { type LayerState, TERRAIN_EXAGGERATION } from "./layers";
import { EMPTY_FC, graceColorExpression } from "./overlays";

export { DEFAULT_LAYERS, type LayerState, TERRAIN_EXAGGERATION } from "./layers";

// MapLibre v6 loads its worker by URL; serve it from public/ (copied by scripts/copy-maplibre-worker.mjs).
let workerSet = false;
function ensureWorker() {
  if (!workerSet) {
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    workerSet = true;
  }
}

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const HOME = { center: [90.3, 23.75] as [number, number], zoom: 6.15, pitch: 45, bearing: -10 };
const FLAT_HOME = { center: [90.3, 23.75] as [number, number], zoom: 6.0, pitch: 0, bearing: 0 };
const FONT = ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"];
const FONT_ITALIC = ["Montserrat Regular Italic", "Open Sans Italic", "Noto Sans Regular"];
const WATER_KINDS = ["river", "canal", "stream", "drain", "ditch"];
const WETLAND_KINDS = ["wetland", "marsh", "swamp", "bog", "wet_meadow", "reedbed", "mangrove"];
const NAME = ["coalesce", ["get", "name:en"], ["get", "name"], ""] as unknown as ExpressionSpecification;
const NONE: FilterSpecification = ["==", ["get", "id"], "__none__"];

export type FeatureHit =
  | { kind: "division" | "district" | "weather_point"; id: string }
  | { kind: "grace_cell"; id: string; lat: number; lon: number; v: number }
  | { kind: "river" | "water"; id: string; name: string; waterKind: string | null };

export type MapCamera = { type: "reset" | "rotateLeft" | "rotateRight" | "north"; nonce: number };

declare global {
  interface Window {
    /** Screen position of a longitude / latitude on the Explorer map (end-to-end tests click through this). */
    __explorerProject?: (lon: number, lat: number) => { x: number; y: number } | null;
  }
}

function riskExpression(values: Record<string, RegionValues>, ids: string[]) {
  const pairs = ids.flatMap((id) => [id, riskColor(values[id]?.riskLevel ?? 0)]);
  return (pairs.length ? ["match", ["get", "id"], ...pairs, "#CBD5E1"] : "#CBD5E1") as unknown as ExpressionSpecification;
}

/** Explicit colour per region id (M1 choropleth of a weather indicator class); unknown ids get the no-data grey. */
function colorExpression(colors: Record<string, string>, ids: string[]) {
  const pairs = ids.flatMap((id) => [id, colors[id] ?? "#EEF2F6"]);
  return (pairs.length ? ["match", ["get", "id"], ...pairs, "#EEF2F6"] : "#EEF2F6") as unknown as ExpressionSpecification;
}

function heightExpression(values: Record<string, RegionValues>, ids: string[]) {
  const pairs = ids.flatMap((id) => [id, 4000 + 9000 * (values[id]?.riskLevel ?? 0)]);
  return (pairs.length ? ["match", ["get", "id"], ...pairs, 0] : 0) as unknown as ExpressionSpecification;
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Explorer-only water styling and layers on top of the basemap's OpenStreetMap water (source "protomaps"). */
function addExplorerWater(m: MLMap) {
  const src = m.getSource("protomaps") ? "protomaps" : null;
  if (m.getLayer("water")) m.setPaintProperty("water", "fill-color", "#62B4EC");
  for (const id of ["watername_sea", "watername_ocean"]) {
    if (m.getLayer(id)) {
      m.setPaintProperty(id, "text-color", "#1C5D99");
      m.setPaintProperty(id, "text-halo-color", "#E6F3FC");
    }
  }
  if (!src) return;
  if (m.getLayer("waterway")) m.setLayoutProperty("waterway", "visibility", "none"); // replaced by aq-rivers
  const lines: FilterSpecification = ["all", ["==", ["geometry-type"], "LineString"],
    ["in", ["get", "kind"], ["literal", WATER_KINDS]]] as FilterSpecification;
  const before = m.getLayer("water") ? "water" : undefined;
  m.addLayer({ id: "aq-wetlands", type: "fill", source: src, "source-layer": "landuse",
               filter: ["in", ["get", "kind"], ["literal", WETLAND_KINDS]] as FilterSpecification,
               paint: { "fill-color": "#6CCFD6", "fill-opacity": 0.45 } }, before);
  m.addLayer({ id: "aq-rivers", type: "line", source: src, "source-layer": "water", filter: lines,
               layout: { "line-cap": "round", "line-join": "round" },
               paint: {
                 "line-color": ["match", ["get", "kind"], "river", "#1683D8", "canal", "#0FAFC0", "#5DB7EE"] as unknown as ExpressionSpecification,
                 "line-width": ["interpolate", ["linear"], ["zoom"],
                   5, ["match", ["get", "kind"], "river", 1.3, 0.4],
                   8, ["match", ["get", "kind"], "river", 2.6, 1],
                   12, ["match", ["get", "kind"], "river", 5, 2]] as unknown as ExpressionSpecification,
                 "line-opacity": 0.95,
               } });
  m.addLayer({ id: "aq-water-selected", type: "line", source: src, "source-layer": "water",
               filter: NONE, paint: { "line-color": "#F59E0B", "line-width": 3 } });
  m.addLayer({ id: "aq-rivers-selected", type: "line", source: src, "source-layer": "water", filter: NONE,
               layout: { "line-cap": "round", "line-join": "round" },
               paint: { "line-color": "#F59E0B", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 7] as unknown as ExpressionSpecification } });
  m.addLayer({ id: "aq-rivers-hit", type: "line", source: src, "source-layer": "water", filter: lines,
               paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 12 } });
  m.addLayer({ id: "aq-river-labels", type: "symbol", source: src, "source-layer": "water",
               filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "name"],
                 ["in", ["get", "kind"], ["literal", ["river", "canal"]]]] as FilterSpecification,
               layout: { "symbol-placement": "line", "text-field": NAME, "text-font": FONT_ITALIC,
                         "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 10, 13] as unknown as ExpressionSpecification,
                         "symbol-spacing": 280, "text-keep-upright": true },
               paint: { "text-color": "#0B5394", "text-halo-color": "#FFFFFF", "text-halo-width": 1.4 } });
}

export function BangladeshMap({ divisions, districts, values, layers, selected, onSelect, graceCells, cellsLabel, points, interactive = true, height = "100%", flat = false, lite = false, resetSignal = 0, colors, onHover,
  explorer = false, mode, exaggeration = TERRAIN_EXAGGERATION, pitch = HOME.pitch, labelPoints, onFeature, highlight, camera }: {
  divisions: GeoJSON.FeatureCollection;
  districts: GeoJSON.FeatureCollection;
  values: Record<string, RegionValues>;
  /** Fill colour per region id; replaces the risk-level colours when given. */
  colors?: Record<string, string>;
  /** Hovered region id (null when the pointer leaves). */
  onHover?: (id: string | null) => void;
  layers: LayerState;
  selected?: string;
  onSelect?: (id: string) => void;
  /** GRACE grid cells as polygons (property v = anomaly in cm). */
  graceCells?: GeoJSON.FeatureCollection;
  /** e.g. "September 2026" for the cell popup. */
  cellsLabel?: string;
  /** Weather points (property id = division id, name). */
  points?: GeoJSON.FeatureCollection;
  interactive?: boolean;
  height?: number | string;
  flat?: boolean;
  lite?: boolean;
  resetSignal?: number;
  /** Water Explorer extensions (see the file comment). */
  explorer?: boolean;
  mode?: "3d" | "2d";
  exaggeration?: number;
  pitch?: number;
  /** Division label points (property name). */
  labelPoints?: GeoJSON.FeatureCollection;
  onFeature?: (hit: FeatureHit) => void;
  /** Feature to highlight besides divisions / districts (river or water name, weather point id, cell id). */
  highlight?: { kind: string; id: string } | null;
  camera?: MapCamera | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onFeatureRef = useRef(onFeature);
  onFeatureRef.current = onFeature;
  const cellsLabelRef = useRef(cellsLabel);
  cellsLabelRef.current = cellsLabel;
  const isFlat = flat || mode === "2d";
  const flatRef = useRef(isFlat);
  flatRef.current = isFlat;
  const levelRef = useRef(layers.level);
  levelRef.current = layers.level;

  // create once
  useEffect(() => {
    if (!el.current) return;
    ensureWorker();
    const start = isFlat ? (explorer ? FLAT_HOME : { ...HOME, zoom: 5.7, pitch: 0, bearing: 0 }) : { ...HOME, pitch };
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: start.center,
      zoom: start.zoom,
      pitch: start.pitch,
      bearing: start.bearing,
      maxPitch: 75,
      interactive,
      attributionControl: { compact: true },
      pixelRatio: Math.min(window.devicePixelRatio, lite ? 1 : 2),
    });
    map.current = m;
    if (interactive && (!flat || explorer)) m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (explorer) m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    m.on("load", () => {
      m.addSource("dem", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium", tileSize: 256, maxzoom: 12,
        attribution: "Terrain: AWS Terrain Tiles (SRTM et al.)",
      });
      m.addSource("hillshade-dem", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium", tileSize: 256, maxzoom: 12,
      });
      m.addLayer({ id: "hillshade", type: "hillshade", source: "hillshade-dem", paint: { "hillshade-shadow-color": "#94a3b8", "hillshade-exaggeration": explorer ? 0.5 : 0.35 } }, "water");
      if (explorer) addExplorerWater(m);
      m.addSource("gsw", {
        type: "raster",
        tiles: ["https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png"],
        tileSize: 256, maxzoom: 13,
        attribution: "Surface water: EC JRC/Google, Pekel et al. (2016)",
      });
      m.addLayer({ id: "gsw", type: "raster", source: "gsw", paint: { "raster-opacity": 0.8 } });
      m.addSource("divisions", { type: "geojson", data: divisions, promoteId: "id" });
      m.addSource("districts", { type: "geojson", data: districts, promoteId: "id" });
      m.addSource("grace-cells", { type: "geojson", data: EMPTY_FC });
      m.addLayer({ id: "grace-cells", type: "fill", source: "grace-cells",
                   paint: { "fill-color": graceColorExpression() as unknown as ExpressionSpecification, "fill-opacity": 0.6, "fill-outline-color": "#FFFFFF" } });
      m.addLayer({ id: "grace-cells-selected", type: "line", source: "grace-cells", filter: NONE,
                   paint: { "line-color": "#F59E0B", "line-width": 3 } });
      if (!explorer) {
        m.on("click", "grace-cells", (e: MapLayerMouseEvent) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          const v = Number(p.v);
          new maplibregl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat)
            .setText(`GRACE cell ${Number(p.lat).toFixed(3)}°N ${Number(p.lon).toFixed(3)}°E: water storage anomaly ${v >= 0 ? "+" : ""}${v.toFixed(1)} cm${cellsLabelRef.current ? ` (${cellsLabelRef.current})` : ""}. Effective resolution about 300 km; not a well level.`)
            .addTo(m);
        });
      }
      for (const lvl of ["divisions", "districts"] as const) {
        m.addLayer({ id: `${lvl}-fill`, type: "fill", source: lvl, paint: { "fill-color": "#CBD5E1", "fill-opacity": 0.7 } });
        m.addLayer({
          id: `${lvl}-extrude`, type: "fill-extrusion", source: lvl,
          paint: { "fill-extrusion-color": "#CBD5E1", "fill-extrusion-height": 0, "fill-extrusion-opacity": 0.75 },
        });
        m.addLayer({ id: `${lvl}-line`, type: "line", source: lvl, paint: { "line-color": "#334155", "line-width": lvl === "divisions" ? 1.4 : 0.6, "line-opacity": 0.7 } });
        if (explorer) {
          m.addLayer({ id: `${lvl}-extrude-selected`, type: "fill-extrusion", source: lvl, filter: NONE,
                       paint: { "fill-extrusion-color": "#F59E0B", "fill-extrusion-height": 0, "fill-extrusion-opacity": 0.85 } });
        }
        m.addLayer({
          id: `${lvl}-selected`, type: "line", source: lvl, filter: ["==", ["get", "id"], ""],
          paint: { "line-color": explorer ? "#F59E0B" : "#0755B8", "line-width": explorer ? 3.5 : 3 },
        });
        if (!explorer) {
          m.on("click", `${lvl}-fill`, (e: MapLayerMouseEvent) => {
            const id = e.features?.[0]?.properties?.id;
            if (id && onSelectRef.current) onSelectRef.current(String(id));
          });
          m.on("click", `${lvl}-extrude`, (e: MapLayerMouseEvent) => {
            const id = e.features?.[0]?.properties?.id;
            if (id && onSelectRef.current) onSelectRef.current(String(id));
          });
        }
        m.on("mouseenter", `${lvl}-fill`, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", `${lvl}-fill`, () => {
          m.getCanvas().style.cursor = "";
          onHoverRef.current?.(null);
        });
        m.on("mousemove", `${lvl}-fill`, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) onHoverRef.current?.(String(id));
        });
      }
      if (explorer) {
        m.addSource("aq-labels", { type: "geojson", data: labelPoints ?? EMPTY_FC });
        m.addLayer({ id: "aq-labels", type: "symbol", source: "aq-labels",
                     layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 14, "text-allow-overlap": false,
                               "text-anchor": "bottom", "text-offset": [0, -0.9] },
                     paint: { "text-color": "#0F2F57", "text-halo-color": "#FFFFFF", "text-halo-width": 2 } });
      }
      m.addSource("weather-points", { type: "geojson", data: EMPTY_FC });
      m.addLayer({ id: "weather-points-selected", type: "circle", source: "weather-points", filter: NONE,
                   paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#F59E0B", "circle-stroke-width": 3 } });
      m.addLayer({ id: "weather-points", type: "circle", source: "weather-points",
                   paint: { "circle-radius": 7, "circle-color": SERIES[0], "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });
      m.addLayer({ id: "weather-points-label", type: "symbol", source: "weather-points",
                   layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top",
                             ...(explorer ? { "text-font": FONT, "text-optional": true } : {}) },
                   paint: { "text-color": "#102B50", "text-halo-color": "#FFFFFF", "text-halo-width": 1.5 } });
      if (!explorer) {
        m.on("click", "weather-points", (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id && onSelectRef.current) onSelectRef.current(String(id));
        });
      } else {
        // one click handler with a fixed priority, so a river inside a division selects the river
        m.on("click", (e: MapMouseEvent) => {
          const cb = onFeatureRef.current;
          if (!cb) return;
          const visible = (id: string) => m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== "none";
          const first = (ids: string[]) => {
            const live = ids.filter(visible);
            return live.length ? m.queryRenderedFeatures(e.point, { layers: live })[0] : undefined;
          };
          const pt = first(["weather-points"]);
          if (pt) return cb({ kind: "weather_point", id: String(pt.properties?.id) });
          const cell = first(["grace-cells"]);
          if (cell) {
            const p = cell.properties ?? {};
            return cb({ kind: "grace_cell", id: String(p.id), lat: Number(p.lat), lon: Number(p.lon), v: Number(p.v) });
          }
          const river = first(["aq-rivers-hit"]);
          if (river) {
            const p = river.properties ?? {};
            const name = String(p["name:en"] ?? p.name ?? "");
            if (name) return cb({ kind: "river", id: name, name, waterKind: p.kind ? String(p.kind) : null });
          }
          const water = first(["water"]);
          if (water) {
            const p = water.properties ?? {};
            const name = String(p["name:en"] ?? p.name ?? "");
            if (name) return cb({ kind: "water", id: name, name, waterKind: p.kind ? String(p.kind) : null });
          }
          const lvl = levelRef.current === "district" ? "districts" : "divisions";
          const area = first([`${lvl}-extrude`, `${lvl}-fill`]);
          if (area?.properties?.id) return cb({ kind: lvl === "districts" ? "district" : "division", id: String(area.properties.id) });
        });
        for (const id of ["weather-points", "grace-cells", "aq-rivers-hit"]) {
          m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
        }
        window.__explorerProject = (lon, lat) => {
          const p = m.project([lon, lat]);
          const r = m.getCanvas().getBoundingClientRect();
          return { x: r.left + p.x, y: r.top + p.y };
        };
      }
      ready.current = true;
      pending.current?.();
      pending.current = null;
    });
    const onVis = () => {
      // pause rendering work when the tab is hidden
      if (document.hidden) m.stop();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (explorer) delete window.__explorerProject;
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply layer state + values
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const lvl = layers.level === "division" ? "divisions" : "districts";
      const other = lvl === "divisions" ? "districts" : "divisions";
      const ids = (lvl === "divisions" ? divisions : districts).features.map((f) => String(f.properties?.id));
      const vis = (on: boolean) => (on ? "visible" : "none");
      const extrude = layers.extrude && !isFlat && layers.scarcity;
      m.setLayoutProperty(`${lvl}-fill`, "visibility", vis(layers.scarcity && !extrude));
      m.setLayoutProperty(`${lvl}-extrude`, "visibility", vis(extrude));
      m.setLayoutProperty(`${lvl}-line`, "visibility", vis(layers.boundaries));
      m.setLayoutProperty(`${lvl}-selected`, "visibility", "visible");
      for (const k of ["fill", "extrude", "line", "selected"]) m.setLayoutProperty(`${other}-${k}`, "visibility", k === "line" && layers.boundaries && lvl === "districts" ? "visible" : "none");
      if (explorer) {
        m.setLayoutProperty(`${other}-extrude-selected`, "visibility", "none");
        m.setLayoutProperty(`${lvl}-extrude-selected`, "visibility", vis(extrude && !!selected));
        m.setFilter(`${lvl}-extrude-selected`, ["==", ["get", "id"], selected ?? "__none__"]);
        m.setPaintProperty(`${lvl}-extrude-selected`, "fill-extrusion-height",
          ["+", heightExpression(values, ids), 1500] as unknown as ExpressionSpecification);
      }
      // keep clicks working when the choropleth is off: an invisible fill still needs to exist
      if (!layers.scarcity) {
        m.setLayoutProperty(`${lvl}-fill`, "visibility", "visible");
        m.setPaintProperty(`${lvl}-fill`, "fill-opacity", 0);
      } else {
        m.setPaintProperty(`${lvl}-fill`, "fill-opacity", layers.opacity.scarcity);
      }
      const fill = colors ? colorExpression(colors, ids) : riskExpression(values, ids);
      m.setPaintProperty(`${lvl}-fill`, "fill-color", fill);
      m.setPaintProperty(`${lvl}-extrude`, "fill-extrusion-color", fill);
      m.setPaintProperty(`${lvl}-extrude`, "fill-extrusion-height", heightExpression(values, ids));
      m.setPaintProperty(`${lvl}-extrude`, "fill-extrusion-opacity", layers.opacity.scarcity);
      (m.getSource("grace-cells") as maplibregl.GeoJSONSource | undefined)?.setData(graceCells ?? EMPTY_FC);
      m.setLayoutProperty("grace-cells", "visibility", vis(layers.groundwater && !!graceCells));
      m.setLayoutProperty("grace-cells-selected", "visibility", vis(layers.groundwater && !!graceCells));
      m.moveLayer("grace-cells", `${lvl}-line`); // above the flat choropleth, below boundaries and points
      m.setPaintProperty("grace-cells", "fill-opacity", layers.opacity.groundwater);
      (m.getSource("weather-points") as maplibregl.GeoJSONSource | undefined)?.setData(points ?? EMPTY_FC);
      for (const id of ["weather-points", "weather-points-label", "weather-points-selected"]) m.setLayoutProperty(id, "visibility", vis(layers.weatherPoints && !!points));
      if (explorer && layers.labels !== false && layers.level === "division") m.setLayoutProperty("weather-points-label", "visibility", "none");
      m.setLayoutProperty("gsw", "visibility", vis(layers.surfaceWater));
      m.setPaintProperty("gsw", "raster-opacity", layers.opacity.surfaceWater);
      for (const id of ["waterway", "water"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis(layers.rivers && !(explorer && id === "waterway")));
      if (explorer) {
        for (const id of ["aq-rivers", "aq-rivers-hit", "aq-river-labels", "aq-rivers-selected", "aq-water-selected"]) {
          if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis(layers.rivers));
        }
        if (m.getLayer("aq-wetlands")) m.setLayoutProperty("aq-wetlands", "visibility", vis(layers.rivers && layers.wetlands !== false));
        if (m.getLayer("aq-labels")) {
          m.setLayoutProperty("aq-labels", "visibility", vis(layers.labels !== false && layers.level === "division"));
          (m.getSource("aq-labels") as maplibregl.GeoJSONSource | undefined)?.setData(labelPoints ?? EMPTY_FC);
          m.moveLayer("aq-labels");
        }
        for (const id of ["weather-points-selected", "weather-points", "weather-points-label"]) m.moveLayer(id);
        const h = highlight ?? null;
        const byName = (name: string) => ["==", NAME, name] as unknown as FilterSpecification;
        if (m.getLayer("aq-rivers-selected")) m.setFilter("aq-rivers-selected", h?.kind === "river" ? ["all", ["==", ["geometry-type"], "LineString"], byName(h.id)] as FilterSpecification : NONE);
        if (m.getLayer("aq-water-selected")) m.setFilter("aq-water-selected", h?.kind === "water" ? ["all", ["==", ["geometry-type"], "Polygon"], byName(h.id)] as FilterSpecification : NONE);
        m.setFilter("weather-points-selected", h?.kind === "weather_point" ? ["==", ["get", "id"], h.id] : NONE);
        m.setFilter("grace-cells-selected", h?.kind === "grace_cell" ? ["==", ["get", "id"], h.id] : NONE);
      }
      m.setLayoutProperty("hillshade", "visibility", vis(layers.terrain && !isFlat));
      m.setTerrain(layers.terrain && !isFlat && !lite ? { source: "dem", exaggeration } : null);
      m.setFilter(`${lvl}-selected`, ["==", ["get", "id"], selected ?? ""]);
    };
    if (ready.current) apply();
    else pending.current = apply;
  }, [layers, values, selected, divisions, districts, graceCells, points, isFlat, lite, colors, exaggeration, highlight, labelPoints, explorer]);

  // 3D <-> 2D without re-creating the map (Explorer)
  useEffect(() => {
    const m = map.current;
    if (!m || !explorer || mode === undefined) return;
    const duration = reducedMotion() ? 0 : 700;
    if (mode === "2d") {
      m.dragRotate.disable();
      m.touchZoomRotate.disableRotation();
      m.easeTo({ pitch: 0, bearing: 0, duration });
    } else {
      m.dragRotate.enable();
      m.touchZoomRotate.enableRotation();
      m.easeTo({ pitch, duration });
    }
  }, [mode, pitch, explorer]);

  // camera commands (Explorer) and the legacy reset signal
  useEffect(() => {
    const m = map.current;
    if (!m || !camera) return;
    const duration = reducedMotion() ? 0 : 700;
    const flatNow = flatRef.current;
    if (camera.type === "reset") m.easeTo({ ...(flatNow ? FLAT_HOME : { ...HOME, pitch }), duration });
    else if (camera.type === "north") m.easeTo({ bearing: 0, duration });
    else if (!flatNow) m.easeTo({ bearing: m.getBearing() + (camera.type === "rotateLeft" ? -30 : 30), duration });
  }, [camera, pitch]);

  useEffect(() => {
    if (resetSignal > 0) map.current?.easeTo({ ...HOME, duration: 800 });
  }, [resetSignal]);

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl" aria-label="Map of Bangladesh" role="region" />;
}
