"use client";
/**
 * MapLibre map of Bangladesh (client-only). Layers: boundaries, rivers (basemap waterways), JRC surface water,
 * GRACE grid cells (TWS anomaly, ~300 km effective resolution), the eight weather points, scarcity risk
 * (choropleth or 3D extrusion), raster-dem terrain.
 */
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, Map as MLMap, MapLayerMouseEvent } from "maplibre-gl";
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

export function BangladeshMap({ divisions, districts, values, layers, selected, onSelect, graceCells, cellsLabel, points, interactive = true, height = "100%", flat = false, lite = false, resetSignal = 0, colors, onHover }: {
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
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const cellsLabelRef = useRef(cellsLabel);
  cellsLabelRef.current = cellsLabel;

  // create once
  useEffect(() => {
    if (!el.current) return;
    ensureWorker();
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: HOME.center,
      zoom: flat ? 5.7 : HOME.zoom,
      pitch: flat ? 0 : HOME.pitch,
      bearing: flat ? 0 : HOME.bearing,
      maxPitch: 75,
      interactive,
      attributionControl: { compact: true },
      pixelRatio: Math.min(window.devicePixelRatio, lite ? 1 : 2),
    });
    map.current = m;
    if (interactive && !flat) m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
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
      m.addLayer({ id: "hillshade", type: "hillshade", source: "hillshade-dem", paint: { "hillshade-shadow-color": "#94a3b8", "hillshade-exaggeration": 0.35 } }, "water");
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
      m.on("click", "grace-cells", (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        const v = Number(p.v);
        new maplibregl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat)
          .setText(`GRACE cell ${Number(p.lat).toFixed(3)}°N ${Number(p.lon).toFixed(3)}°E: water storage anomaly ${v >= 0 ? "+" : ""}${v.toFixed(1)} cm${cellsLabelRef.current ? ` (${cellsLabelRef.current})` : ""}. Effective resolution about 300 km; not a well level.`)
          .addTo(m);
      });
      for (const lvl of ["divisions", "districts"] as const) {
        m.addLayer({ id: `${lvl}-fill`, type: "fill", source: lvl, paint: { "fill-color": "#CBD5E1", "fill-opacity": 0.7 } });
        m.addLayer({
          id: `${lvl}-extrude`, type: "fill-extrusion", source: lvl,
          paint: { "fill-extrusion-color": "#CBD5E1", "fill-extrusion-height": 0, "fill-extrusion-opacity": 0.75 },
        });
        m.addLayer({ id: `${lvl}-line`, type: "line", source: lvl, paint: { "line-color": "#334155", "line-width": lvl === "divisions" ? 1.4 : 0.6, "line-opacity": 0.7 } });
        m.addLayer({
          id: `${lvl}-selected`, type: "line", source: lvl, filter: ["==", ["get", "id"], ""],
          paint: { "line-color": "#0755B8", "line-width": 3 },
        });
        m.on("click", `${lvl}-fill`, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id && onSelectRef.current) onSelectRef.current(String(id));
        });
        m.on("click", `${lvl}-extrude`, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id && onSelectRef.current) onSelectRef.current(String(id));
        });
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
      m.addSource("weather-points", { type: "geojson", data: EMPTY_FC });
      m.addLayer({ id: "weather-points", type: "circle", source: "weather-points",
                   paint: { "circle-radius": 7, "circle-color": SERIES[0], "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });
      m.addLayer({ id: "weather-points-label", type: "symbol", source: "weather-points",
                   layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top" },
                   paint: { "text-color": "#102B50", "text-halo-color": "#FFFFFF", "text-halo-width": 1.5 } });
      m.on("click", "weather-points", (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (id && onSelectRef.current) onSelectRef.current(String(id));
      });
      m.on("mouseenter", "weather-points", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "weather-points", () => (m.getCanvas().style.cursor = ""));
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
      const extrude = layers.extrude && !flat && layers.scarcity;
      m.setLayoutProperty(`${lvl}-fill`, "visibility", vis(layers.scarcity && !extrude));
      m.setLayoutProperty(`${lvl}-extrude`, "visibility", vis(extrude));
      m.setLayoutProperty(`${lvl}-line`, "visibility", vis(layers.boundaries));
      m.setLayoutProperty(`${lvl}-selected`, "visibility", "visible");
      for (const k of ["fill", "extrude", "line", "selected"]) m.setLayoutProperty(`${other}-${k}`, "visibility", k === "line" && layers.boundaries && lvl === "districts" ? "visible" : "none");
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
      m.moveLayer("grace-cells", `${lvl}-line`); // above the flat choropleth, below boundaries and points
      m.setPaintProperty("grace-cells", "fill-opacity", layers.opacity.groundwater);
      (m.getSource("weather-points") as maplibregl.GeoJSONSource | undefined)?.setData(points ?? EMPTY_FC);
      for (const id of ["weather-points", "weather-points-label"]) m.setLayoutProperty(id, "visibility", vis(layers.weatherPoints && !!points));
      m.setLayoutProperty("gsw", "visibility", vis(layers.surfaceWater));
      m.setPaintProperty("gsw", "raster-opacity", layers.opacity.surfaceWater);
      for (const id of ["waterway", "water"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis(layers.rivers));
      m.setLayoutProperty("hillshade", "visibility", vis(layers.terrain && !flat));
      m.setTerrain(layers.terrain && !flat && !lite ? { source: "dem", exaggeration: TERRAIN_EXAGGERATION } : null);
      m.setFilter(`${lvl}-selected`, ["==", ["get", "id"], selected ?? ""]);
    };
    if (ready.current) apply();
    else pending.current = apply;
  }, [layers, values, selected, divisions, districts, graceCells, points, flat, lite, colors]);

  // reset view
  useEffect(() => {
    if (resetSignal > 0) map.current?.easeTo({ ...HOME, duration: 800 });
  }, [resetSignal]);

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl" aria-label="Map of Bangladesh" role="region" />;
}
