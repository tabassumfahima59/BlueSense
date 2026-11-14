"use client";
/** Right-hand panel: division selector, layers, terrain and camera controls, legend. */
import { Info } from "lucide-react";
import { TONE_COLOR } from "@/components/charts/theme";
import { EXAGGERATION_RANGE, type LayerState } from "@/components/maps/layers";
import { GRACE_BINS } from "@/components/maps/overlays";
import { Card, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, type StatusInfo } from "@/components/ui/DataStatus";
import { MeasureText } from "@/components/ui/MeasureView";
import { ProvenanceBadge } from "@/components/ui/Provenance";
import { RiskLegend } from "@/components/ui/Risk";
import { useExplorer } from "@/lib/explorer/store";
import type { LayerInfo, Measure, Provenance } from "@/lib/types/contract";

type Toggle = "boundaries" | "rivers" | "wetlands" | "surfaceWater" | "groundwater" | "weatherPoints" | "scarcity" | "terrain" | "labels";
const TOGGLES: { key: Toggle; label: string; layerId?: string; opacity?: keyof LayerState["opacity"]; only3d?: boolean; needsGl?: boolean; description?: string }[] = [
  { key: "boundaries", label: "Division boundaries", layerId: "boundaries" },
  { key: "labels", label: "Division names", needsGl: true },
  { key: "rivers", label: "Rivers & canals", layerId: "rivers", needsGl: true,
    description: "OpenStreetMap rivers, canals and water bodies (CARTO basemap). Names where mapped; no discharge data." },
  { key: "wetlands", label: "Wetlands (where mapped)", needsGl: true, description: "OpenStreetMap wetland areas; coverage is incomplete." },
  { key: "surfaceWater", label: "Surface water (JRC)", layerId: "surface_water", opacity: "surfaceWater", needsGl: true },
  { key: "groundwater", label: "GRACE grid cells (~300 km)", opacity: "groundwater",
    description: "Terrestrial water storage anomaly per 0.25° grid cell for the latest month. The effective resolution is about 300 km, so neighbouring cells are not independent. Not a well level." },
  { key: "weatherPoints", label: "Weather points (8)", description: "One representative Open-Meteo point per division; not weather stations." },
  { key: "scarcity", label: "Scarcity risk (estimated)", layerId: "scarcity", opacity: "scarcity" },
  { key: "terrain", label: "3D terrain (exaggerated)", layerId: "terrain", only3d: true, needsGl: true },
];

export function DivisionSelect({ ids, names, value, onChange }: { ids: string[]; names: Record<string, string>; value: string; onChange: (id: string) => void }) {
  return (
    <Card title="Select a division" subtitle="Keyboard alternative to clicking the map">
      <label htmlFor="explorer-division" className="sr-only">Division</label>
      <select id="explorer-division" value={value} onChange={(e) => onChange(e.target.value)}
              className="w-full rounded-lg border border-control bg-white px-2.5 py-1.5 text-[13px]">
        <option value="bd">Bangladesh (national)</option>
        {ids.map((id) => <option key={id} value={id}>{names[id]}</option>)}
      </select>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition ${value === id ? "border-primary bg-primary text-white" : "border-border bg-white hover:border-primary"}`}>
            {names[id]}
          </button>
        ))}
      </div>
    </Card>
  );
}

export function LayersCard({ layerMeta, mapKind, graceLoading, graceEmpty }: {
  layerMeta: Record<string, LayerInfo>;
  /** "3d" MapLibre 3D, "2d" MapLibre flat, "svg" the WebGL-free 2D map */
  mapKind: "3d" | "2d" | "svg";
  graceLoading: boolean;
  graceEmpty: boolean;
}) {
  const layers = useExplorer((s) => s.layers);
  const setLayers = useExplorer((s) => s.setLayers);
  const exaggeration = useExplorer((s) => s.exaggeration);
  const setExaggeration = useExplorer((s) => s.setExaggeration);
  const pitch = useExplorer((s) => s.pitch);
  const setPitch = useExplorer((s) => s.setPitch);
  return (
    <Card title="Layers">
      <div className="mb-3">
        <Segmented label="Boundary level" value={layers.level} onChange={(level) => setLayers({ ...layers, level })}
          options={[{ value: "division", label: "Divisions" }, { value: "district", label: "Districts (reference)" }]} />
        {layers.level === "district" && <p className="mt-1 text-[11.5px] text-muted">District boundaries are a reference layer: no district water values exist; panels show the parent division.</p>}
      </div>
      <ul className="space-y-2.5">
        {TOGGLES.map((t) => {
          const meta = t.layerId ? layerMeta[t.layerId] : undefined;
          const off = (mapKind === "svg" && t.needsGl) || (mapKind !== "3d" && t.only3d);
          const desc = t.description ?? meta?.description;
          const checked = t.key === "wetlands" ? layers.wetlands !== false : t.key === "labels" ? layers.labels !== false : layers[t.key];
          return (
            <li key={t.key}>
              <label className={`flex items-center gap-2 text-[13px] ${off ? "text-muted" : ""}`}>
                <input type="checkbox" checked={!!checked && !off} disabled={off}
                       onChange={(e) => setLayers({ ...layers, [t.key]: e.target.checked })} className="h-4 w-4 accent-[#0868CC]" />
                <span className="flex-1">{t.label}</span>
                {meta && <ProvenanceBadge p={meta.provenance as Provenance} small />}
              </label>
              {off && <p className="pl-6 text-[11.5px] text-muted">{mapKind === "svg" ? "Needs the 3D map (map tiles and WebGL)." : "Shown in the 3D map view."}</p>}
              {!off && t.opacity && layers[t.key] && (
                <label className="mt-1 flex items-center gap-2 pl-6 text-[12px] text-muted">
                  Opacity
                  <input type="range" min={0.1} max={1} step={0.05} value={layers.opacity[t.opacity]} aria-label={`${t.label === "Scarcity risk (estimated)" ? "Scarcity risk" : t.label} opacity`}
                    onChange={(e) => setLayers({ ...layers, opacity: { ...layers.opacity, [t.opacity!]: Number(e.target.value) } })} className="flex-1" />
                  <span className="w-9 text-right tabular-nums">{Math.round(layers.opacity[t.opacity] * 100)}%</span>
                </label>
              )}
              {t.key === "scarcity" && layers.scarcity && mapKind === "3d" && (
                <label className="mt-1 flex items-center gap-2 pl-6 text-[12px] text-muted">
                  <input type="checkbox" checked={layers.extrude} onChange={(e) => setLayers({ ...layers, extrude: e.target.checked })} className="h-3.5 w-3.5" />
                  Extrude by risk level (3D)
                </label>
              )}
              {t.key === "groundwater" && layers.groundwater && graceLoading && <p className="pl-6 text-[11.5px] text-muted">Loading GRACE cells…</p>}
              {t.key === "groundwater" && layers.groundwater && mapKind === "3d" && layers.scarcity && layers.extrude && (
                <p className="pl-6 text-[11.5px] text-muted">Tip: switch off “Extrude by risk level” to see the cells under the 3D risk blocks.</p>
              )}
              {t.key === "groundwater" && layers.groundwater && graceEmpty && <p className="pl-6 text-[11.5px] text-muted">No GRACE grid cells are stored.</p>}
              {desc && !off && <p className="pl-6 text-[11.5px] text-muted">{desc}</p>}
            </li>
          );
        })}
      </ul>
      {mapKind === "3d" && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div>
            <label htmlFor="terrain-exaggeration" className="flex justify-between text-[12.5px]">
              <span>Terrain vertical exaggeration</span><span className="tabular-nums text-muted">×{exaggeration}</span>
            </label>
            <input id="terrain-exaggeration" type="range" min={EXAGGERATION_RANGE.min} max={EXAGGERATION_RANGE.max} step={1} value={exaggeration}
                   aria-valuetext={`${exaggeration} times`} onChange={(e) => setExaggeration(Number(e.target.value))} className="w-full accent-[#0868CC]" disabled={!layers.terrain} />
            <p className="text-[11.5px] text-muted">Heights are multiplied by ×{exaggeration} so Bangladesh&apos;s low relief is visible; they are not true elevations.</p>
          </div>
          <div>
            <label htmlFor="camera-pitch" className="flex justify-between text-[12.5px]">
              <span>Camera tilt (pitch)</span><span className="tabular-nums text-muted">{pitch}°</span>
            </label>
            <input id="camera-pitch" type="range" min={0} max={70} step={5} value={pitch} aria-valuetext={`${pitch} degrees`}
                   onChange={(e) => setPitch(Number(e.target.value))} className="w-full accent-[#0868CC]" />
          </div>
        </div>
      )}
    </Card>
  );
}

export function LegendCard({ cellsPeriod, graceNote, graceTrend, pointsStatus, scenarioActive }: {
  cellsPeriod: string | null;
  graceNote?: string;
  graceTrend?: Measure | null;
  pointsStatus?: StatusInfo | null;
  scenarioActive?: boolean;
}) {
  const layers = useExplorer((s) => s.layers);
  return (
    <Card title="Legend">
      <div className="space-y-3 text-[12.5px]">
        <div>
          <div className="mb-1 font-medium">Scarcity risk (division level, estimated{scenarioActive ? ", scenario" : ""})</div>
          <RiskLegend />
        </div>
        {layers.surfaceWater && (
          <div>
            <div className="mb-1 font-medium">Surface water (JRC, 1984–2021)</div>
            <div className="h-2.5 w-full rounded" style={{ background: "linear-gradient(90deg,#C7E4FB,#4C9BE8,#1D3FAE)" }} aria-hidden />
            <div className="mt-0.5 flex justify-between text-[11.5px] text-muted"><span>Water less often</span><span>More often</span></div>
            <p className="text-[11.5px] text-muted">Share of Landsat observations with water. Historical, not current conditions.</p>
          </div>
        )}
        {layers.rivers && (
          <ul className="space-y-1">
            <li className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-[#1683D8]" aria-hidden />River (OpenStreetMap)</li>
            <li className="flex items-center gap-2"><span className="h-1 w-6 rounded bg-[#0FAFC0]" aria-hidden />Canal</li>
            <li className="flex items-center gap-2"><span className="h-3 w-6 rounded bg-[#62B4EC]" aria-hidden />Water body / Bay of Bengal</li>
            {layers.wetlands !== false && <li className="flex items-center gap-2"><span className="h-3 w-6 rounded bg-[#6CCFD6]/70" aria-hidden />Wetland (where mapped)</li>}
          </ul>
        )}
        {layers.groundwater && (
          <div>
            <div className="mb-1 font-medium">GRACE water storage anomaly{cellsPeriod ? ` · ${cellsPeriod}` : ""}</div>
            <ul className="grid grid-cols-1 gap-0.5">
              {GRACE_BINS.map((b) => (
                <li key={b.label} className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm" style={{ background: TONE_COLOR[b.tone] }} aria-hidden />{b.label}</li>
              ))}
            </ul>
            <p className="mt-1 text-muted">AquaGuard display bins (not an official classification). {graceNote}</p>
          </div>
        )}
        <div>
          <div className="mb-1 font-medium">National GRACE storage trend</div>
          <MeasureText m={graceTrend} digits={2} />
          <p className="text-muted">Seasonal cycle removed; regional, not well depth.</p>
        </div>
        {layers.weatherPoints && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-white bg-[#0868CC] shadow" aria-hidden />
            Weather point (one per division)
            {pointsStatus && <DataStatusBadge info={pointsStatus} compact />}
          </div>
        )}
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-[#F59E0B]" aria-hidden />Selected feature (amber outline)</div>
        <p className="flex items-start gap-1 text-[11.5px] text-muted">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden /> No groundwater depths, river discharge or real-time water levels are shown: AquaGuard has no such measurements.
        </p>
      </div>
    </Card>
  );
}
