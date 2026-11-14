"use client";
/**
 * M6 Water Explorer. 3D MapLibre map (lazy-loaded) with a 2D SVG fallback when WebGL is unavailable or the screen is
 * small. Layers: division boundaries (districts as a reference layer only), rivers, JRC surface water, GRACE grid
 * cells (~300 km), the eight weather points, scarcity risk and terrain. Clicking a division, district or weather point
 * opens an info panel filled from the backend (indicators, current weather, the stored 1-month prediction).
 */
import dynamic from "next/dynamic";
import { Info, Map as MapIcon, Mountain, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TONE_COLOR } from "@/components/charts/theme";
import { DEFAULT_LAYERS, type LayerState, TERRAIN_EXAGGERATION } from "@/components/maps/layers";
import { cellsToGeoJSON, GRACE_BINS, hasWebGL, pointsToGeoJSON } from "@/components/maps/overlays";
import { Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, fromMeasure, fromMeta } from "@/components/ui/DataStatus";
import { MeasureText } from "@/components/ui/MeasureView";
import { ProvenanceBadge } from "@/components/ui/Provenance";
import { RiskLegend, RiskPill } from "@/components/ui/Risk";
import { Async, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure, riskColor } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useRegionScenario } from "@/lib/store/hooks";
import type { MapLayersResponse, Provenance } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full" />,
});
const FlatMap = dynamic(() => import("@/components/maps/FlatMap").then((m) => m.FlatMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full" />,
});

type Toggle = "boundaries" | "rivers" | "surfaceWater" | "groundwater" | "weatherPoints" | "scarcity" | "terrain";
const TOGGLES: { key: Toggle; label: string; layerId?: string; opacity?: keyof LayerState["opacity"]; only3d?: boolean; description?: string }[] = [
  { key: "boundaries", label: "Division boundaries", layerId: "boundaries" },
  { key: "rivers", label: "Rivers & canals", layerId: "rivers", only3d: true },
  { key: "surfaceWater", label: "Surface water (JRC)", layerId: "surface_water", opacity: "surfaceWater", only3d: true },
  { key: "groundwater", label: "GRACE grid cells (~300 km)", opacity: "groundwater",
    description: "Terrestrial water storage anomaly per 0.25° grid cell for the latest month. The effective resolution is about 300 km, so neighbouring cells are not independent. Not a well level." },
  { key: "weatherPoints", label: "Weather points (8)", description: "One representative Open-Meteo point per division; not weather stations." },
  { key: "scarcity", label: "Scarcity risk", layerId: "scarcity", opacity: "scarcity" },
  { key: "terrain", label: `3D terrain (×${TERRAIN_EXAGGERATION} exaggeration)`, layerId: "terrain", only3d: true },
];

type Mode = "3d" | "2d";
type Why = "webgl" | "small" | "user" | null;

function RegionPanel({ id, clicked, values, onClose }: { id: string; clicked: string | null; values: MapLayersResponse["values"]; onClose: () => void }) {
  const v = values[id];
  const ind = useApi("divisions", api.divisions);
  const cur = useApi(`weather-current|${id}`, () => api.weatherCurrent(id));
  const pred = useApi(`predictions|${id}|1|water_balance`, () => api.predictions(id, 1));
  const row = ind.data?.data.divisions.find((d) => d.id === id);
  const defs = ind.data?.data.indicators ?? [];
  const cv = cur.data?.data.values ?? {};
  const fc = pred.data?.data.forecast;
  return (
    <div className="space-y-3 text-[13px]" data-testid="region-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{v?.name ?? id}</h2>
          <p className="text-[12px] text-muted">
            {clicked ? `${values[clicked]?.name ?? clicked} district (reference boundary) · data for ${v?.name ?? id} division` : "Division"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close region panel" className="rounded p-1 text-muted hover:bg-bg"><X size={15} aria-hidden /></button>
      </div>
      <section aria-label="Current weather">
        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Current weather</h3>
        {cur.error ? <p className="text-muted">Unavailable.</p> : !cur.data ? <Skeleton className="h-10 w-full" /> : (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {([["temperature_2m", "Temperature"], ["precipitation", "Rain (now)"], ["relative_humidity_2m", "Humidity"], ["wind_speed_10m", "Wind"]] as const).map(([k, label]) => (
                <div key={k} className="contents"><dt className="text-muted">{label}</dt><dd className="tabular-nums">{cv[k] ? fmtMeasure(cv[k]) : "—"}</dd></div>
              ))}
            </dl>
            <div className="mt-1"><DataStatusBadge info={fromMeta(cur.data.meta)} compact /></div>
          </>
        )}
      </section>
      <section aria-label="Weather indicators">
        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Indicators</h3>
        {ind.error ? <p className="text-muted">Unavailable.</p> : !row ? <Skeleton className="h-16 w-full" /> : (
          <ul className="space-y-1">
            {defs.map((d) => {
              const m = row.values[d.key];
              const c = row.classes[d.key];
              return (
                <li key={d.key} className="flex flex-wrap items-center justify-between gap-x-2 border-b border-border/60 pb-1">
                  <span className="text-muted">{d.label}</span>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    {m ? fmtMeasure(m) : "—"}
                    {c && <span className="inline-flex items-center gap-1 text-[11.5px]"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TONE_COLOR[c.tone] }} aria-hidden />{c.label}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-label="Prediction">
        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Predicted P − ET0, next month</h3>
        {pred.error ? <p className="text-muted">Unavailable.</p> : !pred.data ? <Skeleton className="h-8 w-full" /> : fc ? (
          <div className="space-y-1">
            <div className="tabular-nums">{fmtMeasure(fc.value)} for {fc.targetMonth} <span className="text-muted">(90% interval {fc.value.uncertainty ? `${fc.value.uncertainty.low} to ${fc.value.uncertainty.high} mm` : "—"})</span></div>
            <div className="text-[12px] text-muted">{fc.drynessClass} · {fc.storage === "database" ? "stored prediction" : "training-time file"}</div>
            {fromMeasure(fc.value) && <DataStatusBadge info={fromMeasure(fc.value)} compact />}
          </div>
        ) : <p className="text-muted">No prediction available.</p>}
      </section>
      {v && (
        <section aria-label="Scarcity risk">
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Scarcity risk (engine + ML)</h3>
          <RiskPill label={v.risk} level={v.riskLevel} />
          <p className="mt-1 text-[12px] text-muted">Dry-season stress ratio {fmtMeasure(v.dryStressRatio)} · population {fmtMeasure(v.population)}</p>
        </section>
      )}
    </div>
  );
}

function GraceLegend({ period, note }: { period: string | null | undefined; note: string | undefined }) {
  return (
    <div>
      <div className="mb-1 font-medium">GRACE water storage anomaly{period ? ` · ${period}` : ""}</div>
      <ul className="grid grid-cols-1 gap-0.5">
        {GRACE_BINS.map((b) => (
          <li key={b.label} className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm" style={{ background: TONE_COLOR[b.tone] }} aria-hidden />{b.label}</li>
        ))}
      </ul>
      <p className="mt-1 text-muted">AquaGuard display bins (not an official classification). {note}</p>
    </div>
  );
}

export default function Explorer() {
  const { scenario, key } = useRegionScenario();
  const region = useAppStore((s) => s.selectedRegion);
  const setRegion = useAppStore((s) => s.setRegion);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [reset, setReset] = useState(0);
  const [lite, setLite] = useState(false);
  const [panel, setPanel] = useState(true);
  const [clicked, setClicked] = useState<string | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [why, setWhy] = useState<Why>(null);
  useEffect(() => {
    const gl = hasWebGL();
    const small = window.matchMedia("(max-width: 767px)").matches;
    setWebgl(gl);
    setMode(gl && !small ? "3d" : "2d");
    setWhy(!gl ? "webgl" : small ? "small" : null);
  }, []);
  const state = useApi(`map|${key.split("|")[1]}`, () => api.mapLayers("bd", scenario));
  const pts = useApi("weather-points", api.weatherPoints);
  // lazy: the GRACE grid is fetched only once the layer is switched on
  const grace = useApi(layers.groundwater ? "grace-cells" : null, () => api.groundwaterTrends("bd", undefined, true));
  const layerMeta = useMemo(() => Object.fromEntries((state.data?.layers ?? []).map((l) => [l.id, l])), [state.data]);
  const cellsFc = useMemo(() => (grace.data?.data.cells.length ? cellsToGeoJSON(grace.data.data.cells) : undefined), [grace.data]);
  const pointsFc = useMemo(() => (pts.data ? pointsToGeoJSON(pts.data.data.points) : undefined), [pts.data]);
  const cellsPeriod = grace.data?.data.cellsPeriod ?? null;
  const selectedId = region && region !== "bd" ? region : undefined;

  const select = (values: MapLayersResponse["values"], id: string) => {
    const v = values[id];
    if (v?.level === "district") {
      setClicked(id);
      setRegion(v.divisionId); // districts are a reference layer only (decision 6)
    } else {
      setClicked(null);
      setRegion(id);
    }
    setPanel(true);
  };
  const switchMode = (m: Mode) => { setMode(m); setWhy(m === "2d" ? "user" : null); };

  return (
    <div className="space-y-4">
      <PageHeader title="Water Explorer" description="Bangladesh in 3D: terrain, rivers, surface water, GRACE storage cells, the eight weather points and scarcity risk. Click a division, district or weather point for details." />
      <Async state={state} rows={3} label="Loading map layers">
        {(d) => {
          const names = Object.fromEntries(Object.entries(d.values).map(([id, v]) => [id, v.name]));
          const colors = Object.fromEntries(Object.entries(d.values).map(([id, v]) => [id, riskColor(v.riskLevel)]));
          const divisionIds = Object.values(d.values).filter((v) => v.level === "division").map((v) => v.regionId).sort();
          return (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  {mode === "3d" ? (
                    <button type="button" onClick={() => switchMode("2d")} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 shadow-sm hover:bg-bg">
                      <MapIcon size={13} aria-hidden /> Show 2D map
                    </button>
                  ) : (
                    <button type="button" onClick={() => switchMode("3d")} disabled={!webgl} title={webgl ? undefined : "WebGL is not available in this browser"}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 shadow-sm hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60">
                      <Mountain size={13} aria-hidden /> Show 3D map
                    </button>
                  )}
                  <span className="text-muted" data-testid="map-mode">
                    {mode === "3d" ? "3D map (MapLibre, WebGL)" : mode === "2d"
                      ? `2D map${why === "webgl" ? " — WebGL is not available in this browser, so the 3D map cannot run" : why === "small" ? " — chosen for this small screen" : ""}`
                      : "Checking WebGL…"}
                  </span>
                </div>
                <div className="card relative min-h-[520px] overflow-hidden p-0 lg:h-[calc(100vh-260px)]">
                  {mode === "3d" && (
                    <BangladeshMap divisions={d.divisions as unknown as GeoJSON.FeatureCollection} districts={d.districts as unknown as GeoJSON.FeatureCollection}
                      values={d.values} layers={layers} selected={selectedId} lite={lite} resetSignal={reset}
                      graceCells={cellsFc} cellsLabel={cellsPeriod ?? undefined} points={pointsFc}
                      onSelect={(id) => select(d.values, id)} />
                  )}
                  {mode === "2d" && (
                    <FlatMap divisions={d.divisions as unknown as GeoJSON.FeatureCollection} districts={d.districts as unknown as GeoJSON.FeatureCollection}
                      layers={layers} colors={colors} cells={grace.data?.data.cells} cellsLabel={cellsPeriod ?? undefined}
                      points={pts.data?.data.points} selected={selectedId} onSelect={(id) => select(d.values, id)} names={names} />
                  )}
                  {mode === "3d" && (
                    <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setReset((n) => n + 1)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12.5px] shadow-sm hover:bg-bg">
                        <RotateCcw size={13} aria-hidden /> Reset view
                      </button>
                      <button type="button" onClick={() => setLite((x) => !x)} aria-pressed={lite} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12.5px] shadow-sm hover:bg-bg">
                        <Mountain size={13} aria-hidden /> {lite ? "Lite mode on" : "Lite mode"}
                      </button>
                    </div>
                  )}
                  {mode === "3d" && layers.terrain && (
                    <div className="absolute bottom-8 right-3 rounded-md bg-white/90 px-2 py-1 text-[11.5px] text-muted shadow-sm">
                      Terrain vertical exaggeration ×{TERRAIN_EXAGGERATION} (Bangladesh is mostly flat)
                    </div>
                  )}
                  {selectedId && panel && (
                    <div className={`absolute top-3 ${mode === "2d" ? "right-3" : "left-3"} max-h-[calc(100%-24px)] w-[min(300px,calc(100%-24px))] overflow-y-auto rounded-xl border border-border bg-white/95 p-3 shadow-md`}>
                      <RegionPanel id={selectedId} clicked={clicked} values={d.values} onClose={() => setPanel(false)} />
                    </div>
                  )}
                </div>
                <Card title="Select a division" subtitle="Keyboard alternative to clicking the map">
                  <div className="flex flex-wrap gap-1.5">
                    {divisionIds.map((id) => (
                      <button key={id} type="button" aria-pressed={selectedId === id} onClick={() => select(d.values, id)}
                              className={`rounded-full border px-2.5 py-1 text-[12.5px] transition ${selectedId === id ? "border-primary bg-primary text-white" : "border-border bg-white hover:border-primary"}`}>
                        {names[id]}
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
              <div className="space-y-4">
                <Card title="Layers">
                  <div className="mb-3">
                    <Segmented label="Boundary level" value={layers.level} onChange={(level) => setLayers({ ...layers, level })}
                      options={[{ value: "division", label: "Divisions" }, { value: "district", label: "Districts (reference)" }]} />
                    {layers.level === "district" && <p className="mt-1 text-[11.5px] text-muted">District boundaries are a reference layer; values shown are for the parent division.</p>}
                  </div>
                  <ul className="space-y-3">
                    {TOGGLES.map((t) => {
                      const meta = t.layerId ? layerMeta[t.layerId] : undefined;
                      const off2d = mode === "2d" && t.only3d;
                      const desc = t.description ?? meta?.description;
                      return (
                        <li key={t.key}>
                          <label className={`flex items-center gap-2 text-[13px] ${off2d ? "text-muted" : ""}`}>
                            <input type="checkbox" checked={layers[t.key] && !off2d} disabled={off2d} onChange={(e) => setLayers({ ...layers, [t.key]: e.target.checked })} className="h-4 w-4 accent-[#0868CC]" />
                            <span className="flex-1">{t.label}</span>
                            {meta && <ProvenanceBadge p={meta.provenance as Provenance} small />}
                          </label>
                          {off2d && <p className="pl-6 text-[11.5px] text-muted">Needs the 3D map (map tiles and WebGL).</p>}
                          {!off2d && t.opacity && layers[t.key] && (
                            <label className="mt-1 flex items-center gap-2 pl-6 text-[12px] text-muted">
                              Opacity
                              <input type="range" min={0.1} max={1} step={0.05} value={layers.opacity[t.opacity]} aria-label={`${t.label} opacity`}
                                onChange={(e) => setLayers({ ...layers, opacity: { ...layers.opacity, [t.opacity!]: Number(e.target.value) } })} className="flex-1" />
                            </label>
                          )}
                          {t.key === "scarcity" && layers.scarcity && mode === "3d" && (
                            <label className="mt-1 flex items-center gap-2 pl-6 text-[12px] text-muted">
                              <input type="checkbox" checked={layers.extrude} onChange={(e) => setLayers({ ...layers, extrude: e.target.checked })} className="h-3.5 w-3.5" />
                              Extrude by risk level (3D)
                            </label>
                          )}
                          {t.key === "groundwater" && layers.groundwater && grace.loading && <p className="pl-6 text-[11.5px] text-muted">Loading GRACE cells…</p>}
                          {t.key === "groundwater" && layers.groundwater && mode === "3d" && layers.scarcity && layers.extrude && (
                            <p className="pl-6 text-[11.5px] text-muted">Tip: switch off “Extrude by risk level” to see the cells under the 3D risk blocks.</p>
                          )}
                          {t.key === "groundwater" && layers.groundwater && grace.data && !grace.data.data.cells.length && <p className="pl-6 text-[11.5px] text-muted">No GRACE grid cells are stored.</p>}
                          {desc && !off2d && <p className="pl-6 text-[11.5px] text-muted">{desc}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
                <Card title="Legend">
                  <div className="space-y-3 text-[12.5px]">
                    <div>
                      <div className="mb-1 font-medium">Scarcity risk {d.context.scenarioActive && "(Simulated)"}</div>
                      <RiskLegend />
                    </div>
                    {layers.groundwater && <GraceLegend period={cellsPeriod} note={grace.data?.data.resolutionNote} />}
                    <div>
                      <div className="mb-1 font-medium">National GRACE storage trend</div>
                      <MeasureText m={d.graceTrend} digits={2} />
                      <p className="text-muted">Seasonal cycle removed; regional, not well depth.</p>
                    </div>
                    {layers.weatherPoints && (
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full border-2 border-white bg-[#0868CC] shadow" aria-hidden />
                        Weather point (one per division)
                        {pts.data && <DataStatusBadge info={fromMeta(pts.data.meta)} compact />}
                      </div>
                    )}
                    {mode === "3d" && (
                      <div>
                        <div className="mb-1 font-medium">Surface water (JRC)</div>
                        <p className="text-muted">Light to dark blue = water present in more of the 1984–2021 Landsat observations.</p>
                      </div>
                    )}
                  </div>
                </Card>
                <Note>
                  <Info size={13} className="mr-1 inline" aria-hidden />
                  No groundwater depths or water levels are shown: AquaGuard has no measured well data. {mode === "3d" ? "Rotate with right-drag or Ctrl+drag; zoom with scroll or the + / − buttons; pan by dragging." : ""}
                </Note>
              </div>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
