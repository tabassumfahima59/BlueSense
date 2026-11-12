"use client";
import dynamic from "next/dynamic";
import { Info, Mountain, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DEFAULT_LAYERS, TERRAIN_EXAGGERATION, type LayerState } from "@/components/maps/layers";
import { Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { MeasureText } from "@/components/ui/MeasureView";
import { ProvenanceBadge } from "@/components/ui/Provenance";
import { RiskLegend, RiskPill } from "@/components/ui/Risk";
import { Async, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useRegionScenario } from "@/lib/store/hooks";
import type { MapLayersResponse, Provenance } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full" />,
});

type Toggle = "boundaries" | "rivers" | "surfaceWater" | "groundwater" | "scarcity" | "terrain";
const TOGGLES: { key: Toggle; label: string; layerId: string; opacity?: keyof LayerState["opacity"] }[] = [
  { key: "boundaries", label: "Division & district boundaries", layerId: "boundaries" },
  { key: "rivers", label: "Rivers & canals", layerId: "rivers" },
  { key: "surfaceWater", label: "Surface water (JRC)", layerId: "surface_water", opacity: "surfaceWater" },
  { key: "groundwater", label: "Groundwater storage trend (GRACE)", layerId: "groundwater_risk", opacity: "groundwater" },
  { key: "scarcity", label: "Scarcity risk", layerId: "scarcity", opacity: "scarcity" },
  { key: "terrain", label: `3D terrain (×${TERRAIN_EXAGGERATION} exaggeration)`, layerId: "terrain" },
];

function graceColor(trend: number | null | undefined): string {
  if (trend === null || trend === undefined) return "#CBD5E1";
  return trend < -0.5 ? "#D55181" : trend < 0 ? "#E9A3BF" : "#2A78D6";
}

function InfoPanel({ data, id, onClose }: { data: MapLayersResponse; id: string; onClose: () => void }) {
  const v = data.values[id];
  if (!v) return null;
  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold">{v.name}</div>
          <div className="text-[12px] capitalize text-muted">{v.level}{v.level === "district" ? ` · values from ${data.values[v.divisionId]?.name} division` : ""}</div>
        </div>
        <button onClick={onClose} aria-label="Close region panel" className="rounded p-1 text-muted hover:bg-bg"><X size={15} /></button>
      </div>
      <RiskPill label={v.risk} level={v.riskLevel} />
      <dl className="grid grid-cols-1 gap-1.5">
        {[
          ["Annual rainfall (1991–2020 normal)", v.annualRainfall],
          [`Forecast P − ET0 (${data.forecastTargetMonth ?? "next month"})`, v.forecastD],
          ["Forecast dryness z-score", v.forecastZ],
          ["Stress ratio (annual)", v.stressRatio],
          ["Stress ratio (dry season)", v.dryStressRatio],
          ["Population (2022)", v.population],
          ["Area", v.area],
        ].map(([label, m]) => (
          <div key={label as string} className="flex flex-wrap items-center justify-between gap-x-2 border-b border-border/60 pb-1">
            <dt className="text-muted">{label as string}</dt>
            <dd><MeasureText m={m as never} /></dd>
          </div>
        ))}
      </dl>
      <p className="text-[11.5px] text-muted">Sources: ERA5 via Open-Meteo, AquaGuard engine & ML, HDX COD-PS, geoBoundaries.</p>
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
  const state = useApi(`map|${key.split("|")[1]}`, () => api.mapLayers("bd", scenario));
  const layerMeta = useMemo(() => Object.fromEntries((state.data?.layers ?? []).map((l) => [l.id, l])), [state.data]);
  const selectedId = region !== "bd" ? region : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="3D Water Explorer" description="Bangladesh in 3D: terrain, rivers, surface water, the GRACE regional storage trend and scarcity risk. Click a division or district for details." />
      <Async state={state} rows={3} label="Loading map layers">
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="card relative min-h-[520px] overflow-hidden p-0 lg:h-[calc(100vh-220px)]">
              <BangladeshMap divisions={d.divisions as unknown as GeoJSON.FeatureCollection} districts={d.districts as unknown as GeoJSON.FeatureCollection}
                values={d.values} layers={layers} selected={selectedId} lite={lite} resetSignal={reset}
                graceColor={graceColor(d.graceTrend.value)}
                onSelect={(id) => { setRegion(id); setPanel(true); }} />
              <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
                <button onClick={() => setReset((n) => n + 1)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12.5px] shadow-sm hover:bg-bg">
                  <RotateCcw size={13} aria-hidden /> Reset view
                </button>
                <button onClick={() => setLite((x) => !x)} aria-pressed={lite} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12.5px] shadow-sm hover:bg-bg">
                  <Mountain size={13} aria-hidden /> {lite ? "Lite mode on" : "Lite mode (mobile)"}
                </button>
              </div>
              {layers.terrain && (
                <div className="absolute right-3 bottom-8 rounded-md bg-white/90 px-2 py-1 text-[11.5px] text-muted shadow-sm">
                  Terrain vertical exaggeration ×{TERRAIN_EXAGGERATION} (Bangladesh is mostly flat)
                </div>
              )}
              {selectedId && panel && (
                <div className="absolute left-3 top-3 w-[min(290px,calc(100%-90px))] rounded-xl border border-border bg-white/95 p-3 shadow-md">
                  <InfoPanel data={d} id={selectedId} onClose={() => setPanel(false)} />
                </div>
              )}
            </div>
            <div className="space-y-4">
              <Card title="Layers">
                <div className="mb-3">
                  <Segmented label="Boundary level" value={layers.level} onChange={(level) => setLayers({ ...layers, level })}
                    options={[{ value: "division", label: "Divisions" }, { value: "district", label: "Districts" }]} />
                </div>
                <ul className="space-y-3">
                  {TOGGLES.map((t) => {
                    const meta = layerMeta[t.layerId];
                    return (
                      <li key={t.key}>
                        <label className="flex items-center gap-2 text-[13px]">
                          <input type="checkbox" checked={layers[t.key]} onChange={(e) => setLayers({ ...layers, [t.key]: e.target.checked })} className="h-4 w-4 accent-[#0D9488]" />
                          <span className="flex-1">{t.label}</span>
                          {meta && <ProvenanceBadge p={meta.provenance as Provenance} small />}
                        </label>
                        {t.opacity && layers[t.key] && (
                          <label className="mt-1 flex items-center gap-2 pl-6 text-[12px] text-muted">
                            Opacity
                            <input type="range" min={0.1} max={1} step={0.05} value={layers.opacity[t.opacity]} aria-label={`${t.label} opacity`}
                              onChange={(e) => setLayers({ ...layers, opacity: { ...layers.opacity, [t.opacity!]: Number(e.target.value) } })} className="flex-1" />
                          </label>
                        )}
                        {t.key === "scarcity" && layers.scarcity && (
                          <label className="mt-1 flex items-center gap-2 pl-6 text-[12px] text-muted">
                            <input type="checkbox" checked={layers.extrude} onChange={(e) => setLayers({ ...layers, extrude: e.target.checked })} className="h-3.5 w-3.5" />
                            Extrude by risk level (3D)
                          </label>
                        )}
                        {meta && <p className="pl-6 text-[11.5px] text-muted">{meta.description}</p>}
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
                  <div>
                    <div className="mb-1 font-medium">GRACE storage trend</div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-5 rounded" style={{ background: graceColor(d.graceTrend.value) }} aria-hidden />
                      <MeasureText m={d.graceTrend} digits={2} />
                    </div>
                    <p className="text-muted">One Bangladesh-wide value; ~300 km resolution, not well depth. Darker magenta = declining (&lt; −0.5 cm/yr).</p>
                  </div>
                  <div>
                    <div className="mb-1 font-medium">Surface water (JRC)</div>
                    <p className="text-muted">Light to dark blue = water present in more of the 1984–2021 Landsat observations.</p>
                  </div>
                </div>
              </Card>
              <Note>
                <Info size={13} className="mr-1 inline" aria-hidden />
                No groundwater depths or water levels are shown: AquaGuard has no measured well data (BWDB importer ready, see Data Sources).
                Rotate with right-drag or Ctrl+drag; zoom with scroll. Selected: {selectedId ? d.values[selectedId]?.name : "none"}{" "}
                {selectedId && `(risk ${d.values[selectedId]?.risk}, dry-season stress ${fmtMeasure(d.values[selectedId]?.dryStressRatio)})`}
              </Note>
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}
