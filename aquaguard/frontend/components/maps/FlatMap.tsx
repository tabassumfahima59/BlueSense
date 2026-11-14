"use client";
/**
 * 2D fallback map (SVG, no WebGL): division / district boundaries, the scarcity choropleth, GRACE grid cells and the
 * eight weather points. Used when WebGL is unavailable or on small screens. Planar projection with the longitude
 * scaled by cos(23.7°) (Bangladesh's mid latitude), which keeps shapes true to within a few percent.
 */
import { geoIdentity, geoPath } from "d3";
import { useMemo } from "react";
import { NEUTRAL } from "@/components/charts/theme";
import type { GridCell, WeatherPoint } from "@/lib/types/contract";
import type { LayerState } from "./layers";
import { cellsToGeoJSON, graceColor } from "./overlays";

const K = Math.cos((23.7 * Math.PI) / 180);
type Pos = number[];

function scaleLon(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const ring = (r: Pos[]) => r.map(([x, y]) => [x * K, y]);
  const geom = (g: GeoJSON.Geometry): GeoJSON.Geometry => {
    if (g.type === "Polygon") return { ...g, coordinates: g.coordinates.map(ring) };
    if (g.type === "MultiPolygon") return { ...g, coordinates: g.coordinates.map((p) => p.map(ring)) };
    if (g.type === "Point") return { ...g, coordinates: [g.coordinates[0] * K, g.coordinates[1]] };
    return g;
  };
  return { ...fc, features: fc.features.map((f) => ({ ...f, geometry: geom(f.geometry) })) };
}

export function FlatMap({ divisions, districts, layers, colors, cells, cellsLabel, points, selected, onSelect, names }: {
  divisions: GeoJSON.FeatureCollection;
  districts?: GeoJSON.FeatureCollection;
  layers: LayerState;
  /** Scarcity-risk fill per region id. */
  colors: Record<string, string>;
  cells?: GridCell[];
  cellsLabel?: string;
  points?: WeatherPoint[];
  selected?: string;
  onSelect: (id: string) => void;
  names: Record<string, string>;
}) {
  const W = 600;
  const H = 720;
  const geo = useMemo(() => {
    const div = scaleLon(divisions);
    const proj = geoIdentity().reflectY(true).fitExtent([[12, 12], [W - 12, H - 12]], div);
    return {
      path: geoPath(proj),
      div,
      dist: districts ? scaleLon(districts) : null,
      cells: cells ? scaleLon(cellsToGeoJSON(cells)) : null,
      xy: (lon: number, lat: number) => proj([lon * K, lat]) as [number, number],
    };
  }, [divisions, districts, cells]);
  const showDistricts = layers.boundaries && layers.level === "district" && geo.dist;
  return (
    <div className="flex h-full flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-full max-h-[640px] w-full" role="img"
           aria-label="2D map of Bangladesh: divisions, GRACE grid cells and the eight weather points" style={{ background: "#F4F8FC" }}>
        <g>
          {geo.div.features.map((f) => {
            const id = String(f.properties?.id);
            return (
              <path key={id} d={geo.path(f) ?? undefined} data-region={id} onClick={() => onSelect(id)} style={{ cursor: "pointer" }}
                    fill={layers.scarcity ? colors[id] ?? "#EEF2F6" : "#FFFFFF"} fillOpacity={layers.scarcity ? layers.opacity.scarcity : 1}
                    stroke={layers.boundaries ? "#334155" : "none"} strokeWidth={1.2}>
                <title>{names[id] ?? id}</title>
              </path>
            );
          })}
        </g>
        {showDistricts && (
          <g fill="transparent" stroke="#64748B" strokeWidth={0.5}>
            {geo.dist!.features.map((f) => {
              const id = String(f.properties?.id);
              return (
                <path key={id} d={geo.path(f) ?? undefined} data-region={id} onClick={() => onSelect(id)} style={{ cursor: "pointer" }}>
                  <title>{`${f.properties?.name ?? id} (district boundary, reference only)`}</title>
                </path>
              );
            })}
          </g>
        )}
        {layers.groundwater && geo.cells && (
          <g fillOpacity={layers.opacity.groundwater} stroke="#FFFFFF" strokeWidth={0.4}>
            {geo.cells.features.map((f) => {
              const v = Number(f.properties?.v);
              return (
                <path key={String(f.properties?.id)} d={geo.path(f) ?? undefined} fill={graceColor(v)} pointerEvents="visiblePainted">
                  <title>{`GRACE cell ${Number(f.properties?.lat).toFixed(3)}°N ${Number(f.properties?.lon).toFixed(3)}°E: ${v >= 0 ? "+" : ""}${v.toFixed(1)} cm${cellsLabel ? ` (${cellsLabel})` : ""}; ~300 km effective resolution`}</title>
                </path>
              );
            })}
          </g>
        )}
        {selected && (
          <g fill="none" stroke="#0755B8" strokeWidth={3} pointerEvents="none">
            {geo.div.features.filter((f) => String(f.properties?.id) === selected).map((f) => <path key="sel" d={geo.path(f) ?? undefined} />)}
          </g>
        )}
        {layers.weatherPoints && points?.map((p) => {
          const [x, y] = geo.xy(p.lon, p.lat);
          return (
            <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }} data-point={p.id}>
              <circle cx={x} cy={y} r={7} fill="#0868CC" stroke="#FFFFFF" strokeWidth={2} />
              <text x={x} y={y + 20} textAnchor="middle" fontSize={13} fill={NEUTRAL.ink} stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke">{p.name}</text>
              <title>{`${p.name} weather point${p.temperature?.value != null ? `: ${p.temperature.value} ${p.temperature.unit}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
