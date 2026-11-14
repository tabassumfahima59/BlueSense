"use client";
/**
 * 3D Bangladesh Water Explorer. Six synchronised views share one geographic selection (lib/explorer/store):
 * 3D Map and 2D Map (one MapLibre map that switches between 3D terrain and a flat view; an SVG map without WebGL),
 * Time Series, Data Table, Analysis and Spatial Intelligence. Layers: divisions and districts (reference), OpenStreetMap
 * rivers / canals / water bodies / wetlands, JRC surface water (1984–2021), GRACE grid cells (~300 km), the eight
 * representative weather points, estimated scarcity risk and exaggerated terrain. Every value comes from the backend
 * with its source and data kind; nothing is invented, districts carry no water values, and the map assistant is the
 * existing provider-independent Copilot with read-only tools.
 */
import dynamic from "next/dynamic";
import { Bot, Compass, Map as MapIcon, Mountain, RotateCcw, RotateCw, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisView } from "@/components/explorer/AnalysisView";
import { IntelView } from "@/components/explorer/IntelView";
import { KpiStrip } from "@/components/explorer/KpiStrip";
import { MapAssistant } from "@/components/explorer/MapAssistant";
import { RegionPanel } from "@/components/explorer/RegionPanel";
import { SeriesView } from "@/components/explorer/SeriesView";
import { DivisionSelect, LayersCard, LegendCard } from "@/components/explorer/SidePanel";
import { TableView } from "@/components/explorer/TableView";
import type { FeatureHit } from "@/components/maps/BangladeshMap";
import { cellsToGeoJSON, hasWebGL, pointsToGeoJSON } from "@/components/maps/overlays";
import { Card, Note, PageHeader } from "@/components/ui/Card";
import { fromMeta } from "@/components/ui/DataStatus";
import { Async, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { analysisRegion, type ExplorerView, type MapSelection, useExplorer, VIEWS } from "@/lib/explorer/store";
import { riskColor } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useRegionScenario } from "@/lib/store/hooks";
import type { MapLayersResponse } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full" />,
});
const FlatMap = dynamic(() => import("@/components/maps/FlatMap").then((m) => m.FlatMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full" />,
});

type Values = MapLayersResponse["values"];

function ViewTabs({ view, setView }: { view: ExplorerView; setView: (v: ExplorerView) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? (i + 1) % VIEWS.length : e.key === "ArrowLeft" ? (i + VIEWS.length - 1) % VIEWS.length
      : e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    setView(VIEWS[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label="Explorer views" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-white/80 p-1 shadow-sm">
      {VIEWS.map((v, i) => (
        <button key={v.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`explorer-tab-${v.id}`}
                aria-selected={view === v.id} aria-controls={view === v.id ? "explorer-panel" : undefined} tabIndex={view === v.id ? 0 : -1}
                onClick={() => setView(v.id)} onKeyDown={(e) => onKey(e, i)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${view === v.id ? "bg-primary text-white shadow-sm" : "text-muted hover:bg-light hover:text-ink"}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

function MapButtons({ threeD }: { threeD: boolean }) {
  const cameraCommand = useExplorer((s) => s.cameraCommand);
  const lite = useExplorer((s) => s.lite);
  const setLite = useExplorer((s) => s.setLite);
  const b = "inline-flex items-center gap-1 rounded-lg border border-border bg-white/95 px-2.5 py-1.5 text-[12.5px] shadow-sm hover:bg-bg";
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2">
      <button type="button" onClick={() => cameraCommand("reset")} className={b}><RotateCcw size={13} aria-hidden /> Reset view</button>
      {threeD && (
        <>
          <button type="button" onClick={() => cameraCommand("rotateLeft")} className={b} aria-label="Rotate left"><RotateCcw size={13} aria-hidden /></button>
          <button type="button" onClick={() => cameraCommand("rotateRight")} className={b} aria-label="Rotate right"><RotateCw size={13} aria-hidden /></button>
          <button type="button" onClick={() => cameraCommand("north")} className={b} aria-label="Face north"><Compass size={13} aria-hidden /></button>
        </>
      )}
      <button type="button" onClick={() => setLite(!lite)} aria-pressed={lite} className={b}>
        <Mountain size={13} aria-hidden /> {lite ? "Lite mode on" : "Lite mode"}
      </button>
    </div>
  );
}

export default function Explorer() {
  const { scenario, key } = useRegionScenario();
  const region = useAppStore((s) => s.selectedRegion);
  const setRegion = useAppStore((s) => s.setRegion);
  const view = useExplorer((s) => s.view);
  const setView = useExplorer((s) => s.setView);
  const selection = useExplorer((s) => s.selection);
  const select = useExplorer((s) => s.select);
  const layers = useExplorer((s) => s.layers);
  const exaggeration = useExplorer((s) => s.exaggeration);
  const pitch = useExplorer((s) => s.pitch);
  const lite = useExplorer((s) => s.lite);
  const setLite = useExplorer((s) => s.setLite);
  const camera = useExplorer((s) => s.camera);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [small, setSmall] = useState(false);
  const [desktop, setDesktop] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const gl = hasWebGL();
    const isSmall = window.matchMedia("(max-width: 767px)").matches;
    setWebgl(gl);
    setSmall(isSmall);
    if (isSmall) {
      setLite(true);
      if (useExplorer.getState().view === "3d") setView("2d");
    }
  }, [setLite, setView]);

  const state = useApi(`map|${key.split("|")[1]}`, () => api.mapLayers("bd", scenario));
  const regions = useApi("regions", api.regions);
  const pts = useApi("weather-points", api.weatherPoints);
  const grace = useApi(layers.groundwater ? "grace-cells" : null, () => api.groundwaterTrends("bd", undefined, true));
  const values: Values | undefined = state.data?.values;
  const layerMeta = useMemo(() => Object.fromEntries((state.data?.layers ?? []).map((l) => [l.id, l])), [state.data]);
  const cellsFc = useMemo(() => (grace.data?.data.cells.length ? cellsToGeoJSON(grace.data.data.cells) : undefined), [grace.data]);
  const pointsFc = useMemo(() => (pts.data ? pointsToGeoJSON(pts.data.data.points) : undefined), [pts.data]);
  const labelPoints = useMemo<GeoJSON.FeatureCollection | undefined>(() => (regions.data ? {
    type: "FeatureCollection",
    features: regions.data.divisions.map((d) => ({ type: "Feature", properties: { id: d.id, name: d.name },
                                                   geometry: { type: "Point", coordinates: d.centroid } })),
  } : undefined), [regions.data]);
  const cellsPeriod = grace.data?.data.cellsPeriod ?? null;
  const divisionIds = useMemo(() => Object.values(values ?? {}).filter((v) => v.level === "division").map((v) => v.regionId).sort(), [values]);
  const names = useMemo(() => Object.fromEntries(Object.entries(values ?? {}).map(([id, v]) => [id, v.name])), [values]);

  const divisionSelection = (id: string): MapSelection => ({ kind: "division", id, name: `${names[id] ?? id} Division`, divisionId: id });
  const choose = (sel: MapSelection | null) => {
    select(sel);
    setPanelOpen(true);
    const target = sel?.divisionId;
    if (target && target !== region) setRegion(target);
    if (!sel && region !== "bd") setRegion("bd");
  };
  const chooseDivision = (id: string) => choose(id === "bd" ? null : divisionSelection(id));
  const onFeature = (hit: FeatureHit) => {
    if (!values) return;
    if (hit.kind === "division") return choose(divisionSelection(hit.id));
    if (hit.kind === "district") {
      const v = values[hit.id];
      return choose({ kind: "district", id: hit.id, name: v?.name ?? hit.id, divisionId: v?.divisionId });
    }
    if (hit.kind === "weather_point") {
      const p = pts.data?.data.points.find((x) => x.id === hit.id);
      return choose({ kind: "weather_point", id: hit.id, name: `${names[hit.id] ?? hit.id} weather point`, divisionId: hit.id,
                      props: { lat: p?.lat ?? null, lon: p?.lon ?? null } });
    }
    if (hit.kind === "grace_cell") {
      return choose({ kind: "grace_cell", id: hit.id, name: `GRACE cell ${hit.lat.toFixed(2)}°N ${hit.lon.toFixed(2)}°E`,
                      props: { lat: hit.lat, lon: hit.lon, v: hit.v } });
    }
    if (hit.kind === "river" || hit.kind === "water") choose({ kind: hit.kind, id: hit.id, name: hit.name, props: { waterKind: hit.waterKind } });
  };
  const onFlatSelect = (id: string) => {
    if (!values) return;
    onFeature(values[id]?.level === "district" ? { kind: "district", id } : { kind: "division", id });
  };

  // follow the global region (header selector, URL) — only when it changes
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!values || synced.current === region) return;
    synced.current = region;
    const cur = useExplorer.getState().selection;
    if (region && region !== "bd") {
      if (cur?.divisionId !== region) select(divisionSelection(region));
    } else if (cur?.divisionId) {
      select(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, values]);

  // Escape closes the details
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) setPanelOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection]);

  const isMapView = view === "3d" || view === "2d";
  const mapKind: "3d" | "2d" | "svg" = webgl === false ? "svg" : view === "2d" ? "2d" : "3d";
  const aRegion = analysisRegion(selection);
  const aName = aRegion === "bd" ? "Bangladesh" : names[aRegion] ?? aRegion;
  const divisionName = selection?.divisionId ? names[selection.divisionId] ?? null : null;
  const selectedArea = selection?.kind === "district" && layers.level === "district" ? selection.id : selection?.divisionId;
  const highlight = selection && ["river", "water", "weather_point", "grace_cell"].includes(selection.kind) ? { kind: selection.kind, id: selection.id } : null;
  const colors = useMemo(() => Object.fromEntries(Object.entries(values ?? {}).map(([id, v]) => [id, riskColor(v.riskLevel)])), [values]);
  const modeText = webgl === null ? "Checking WebGL…" : webgl === false
    ? "2D map — WebGL is not available in this browser, so the 3D map cannot run"
    : view === "2d" ? `2D map (MapLibre, flat)${small ? " — chosen for this small screen" : ""}` : "3D map (MapLibre, WebGL)";
  const askAssistant = () => {
    const el = document.getElementById("explorer-assistant-input") as HTMLInputElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  };
  const panel = (cls: string, id: string) => selection && panelOpen && (
    <RegionPanel sel={selection} values={values} cellsPeriod={cellsPeriod} headingId={id} className={cls}
                 onClose={() => setPanelOpen(false)} onIntel={() => setView("intel")} onAsk={askAssistant}
                 onSelectDivision={(d) => choose(divisionSelection(d))} />
  );

  return (
    <div className="space-y-4">
      <PageHeader title="3D Bangladesh Water Explorer"
        description="Terrain, rivers, historical surface water, GRACE storage cells, the eight weather points and estimated scarcity risk — with regional analysis, history and an AI assistant grounded in AquaGuard data." />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs view={view} setView={setView} />
        <span className="rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary" title="Every value comes from stored data with its source and data kind">
          Hydrological digital twin · source-backed data
        </span>
      </div>
      <Async state={state} rows={3} label="Loading map layers">
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div id="explorer-panel" role="tabpanel" aria-labelledby={`explorer-tab-${view}`} className="min-w-0 space-y-3">
              <div className={isMapView ? "space-y-2" : "hidden"}>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <MapIcon size={14} className="text-muted" aria-hidden />
                  <span className="text-muted" data-testid="map-mode">{modeText}</span>
                </div>
                <div className="card relative h-[460px] overflow-hidden p-0 sm:h-[540px] lg:h-[calc(100vh-290px)] lg:min-h-[560px]" data-testid="explorer-map"
                     data-view={view} data-selection={selection ? `${selection.kind}:${selection.id}` : ""}>
                  {webgl && (
                    <BangladeshMap explorer mode={view === "2d" ? "2d" : "3d"} divisions={d.divisions as unknown as GeoJSON.FeatureCollection}
                      districts={d.districts as unknown as GeoJSON.FeatureCollection} values={d.values} layers={layers}
                      selected={selectedArea} lite={lite} graceCells={cellsFc} cellsLabel={cellsPeriod ?? undefined} points={pointsFc}
                      exaggeration={exaggeration} pitch={pitch} labelPoints={labelPoints} onFeature={onFeature} highlight={highlight} camera={camera} />
                  )}
                  {webgl === false && (
                    <FlatMap divisions={d.divisions as unknown as GeoJSON.FeatureCollection} districts={d.districts as unknown as GeoJSON.FeatureCollection}
                      layers={layers} colors={colors} cells={grace.data?.data.cells} cellsLabel={cellsPeriod ?? undefined}
                      points={pts.data?.data.points} selected={selectedArea} onSelect={onFlatSelect} names={names} />
                  )}
                  {webgl === null && <Skeleton className="h-full w-full" />}
                  {webgl && <MapButtons threeD={view === "3d"} />}
                  {webgl && view === "3d" && layers.terrain && !lite && (
                    <div className="absolute bottom-14 right-3 z-10 rounded-md bg-white/90 px-2 py-1 text-[11.5px] font-medium text-primary shadow-sm sm:bottom-9">
                      Terrain vertical exaggeration ×{exaggeration} (Bangladesh is mostly flat)
                    </div>
                  )}
                  {webgl && view === "3d" && layers.terrain && lite && (
                    <div className="absolute bottom-14 right-3 z-10 rounded-md bg-white/90 px-2 py-1 text-[11.5px] text-muted shadow-sm sm:bottom-9">Lite mode: terrain off</div>
                  )}
                  {desktop && panel(`absolute top-3 ${webgl === false ? "right-3" : "left-3"} z-20 flex max-h-[calc(100%-76px)] w-[min(320px,calc(100%-24px))] rounded-xl`, "region-panel-desktop")}
                </div>
              </div>
              {view === "series" && <SeriesView region={aRegion} regionName={aName} />}
              {view === "table" && <TableView selectedDivision={selection?.divisionId ?? null} onSelect={chooseDivision} values={d.values} />}
              {view === "analysis" && <AnalysisView selectedDivision={selection?.divisionId ?? null} />}
              {view === "intel" && <IntelView region={aRegion} regionName={aName} sel={selection} divisionName={divisionName} />}
              {!isMapView && selection && (
                <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  Selected: <b className="text-ink">{selection.name}</b>{aRegion !== "bd" ? ` · analysis for ${aName}` : " · analysis for Bangladesh (this feature has no division data)"}
                  <button type="button" onClick={() => choose(null)} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 hover:bg-light">
                    <X size={12} aria-hidden /> Clear selection
                  </button>
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-4">
              <DivisionSelect ids={divisionIds} names={names} value={selection?.divisionId ?? "bd"} onChange={chooseDivision} />
              {isMapView && (
                <LayersCard layerMeta={layerMeta} mapKind={mapKind} graceLoading={grace.loading}
                            graceEmpty={!!grace.data && !grace.data.data.cells.length} />
              )}
              {view !== "intel" && (
                <Card title="Map assistant" subtitle="AI answers grounded in AquaGuard's read-only data tools" id="map-assistant-card">
                  <MapAssistant sel={selection} region={aRegion} regionName={aName} divisionName={divisionName} idPrefix="explorer-assistant" />
                </Card>
              )}
              {isMapView && (
                <LegendCard cellsPeriod={cellsPeriod} graceNote={grace.data?.data.resolutionNote} graceTrend={d.graceTrend}
                            pointsStatus={pts.data ? fromMeta(pts.data.meta) : null} scenarioActive={d.context.scenarioActive} />
              )}
            </div>
          </div>
        )}
      </Async>
      {isMapView && !desktop && panel("fixed inset-x-0 bottom-0 z-40 flex max-h-[60vh] rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+3.5rem)]", "region-panel-sheet")}
      <KpiStrip />
      <Note>
        <Bot size={13} className="mr-1 inline" aria-hidden />
        Sources: Open-Meteo (ERA5 reanalysis and forecast, one representative point per division), GRACE / GRACE-FO CSR RL06.3
        (regional, ~300 km), JRC Global Surface Water (1984–2021, map only), FAO AQUASTAT (national), OpenStreetMap via CARTO (rivers,
        water bodies), geoBoundaries and HDX (boundaries, population), AWS Terrain Tiles (elevation, exaggerated). Scarcity risk is an
        AquaGuard estimate. No groundwater levels, river discharge or real-time water levels exist in AquaGuard.
      </Note>
    </div>
  );
}
