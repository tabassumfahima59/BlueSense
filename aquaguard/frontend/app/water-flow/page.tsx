"use client";
/**
 * 3D Water Flow: an interactive conceptual simulation of a hypothetical water-distribution network (reservoir →
 * treatment → pump → trunk main → junction → four consumer zones). Every value has data kind "conceptual"; real
 * national AQUASTAT magnitudes appear separately, marked as real, for scale only.
 *
 * One store (lib/flow/store) holds the inputs, the selection, the view, the layers and the playback; one engine answer
 * (POST /api/flow/simulate) feeds the 3D view, the schematic, the data table, the KPIs and the panels, so they always
 * agree. Nothing here is a live measurement, a sensor reading or a control of real infrastructure.
 */
import dynamic from "next/dynamic";
import {
  Crosshair, FlaskConical, Home, Layers, Pause, Play, RotateCcw, RotateCw, ZoomIn, ZoomOut,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/flow/DataTable";
import { ControlsPanel } from "@/components/flow/Controls";
import { InfoPanel } from "@/components/flow/InfoPanel";
import { KpiBar, Legend, ResultsPanel } from "@/components/flow/Results";
import { ScenariosPanel } from "@/components/flow/Scenarios";
import { Schematic } from "@/components/flow/Schematic";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, SERIES } from "@/components/charts/theme";
import { hasWebGL } from "@/components/maps/overlays";
import { Button, Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, fromMeasure } from "@/components/ui/DataStatus";
import { Popover } from "@/components/ui/Popover";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { fmtMeasure, fmtNumber } from "@/lib/format";
import { NODES, PIPE_DEFS } from "@/lib/flow/network";
import { DEFAULT_INPUTS, toRequest } from "@/lib/flow/scenarios";
import { ALL_LAYERS, LAYER_LABEL, type LayerKey, type Selection, useFlowStore, type ViewMode } from "@/lib/flow/store";
import { useAppStore } from "@/lib/store";
import type { FlowResponse, FlowState } from "@/lib/types/contract";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3];
const TABS = [
  { id: "controls", label: "Controls" },
  { id: "results", label: "Results" },
  { id: "scenarios", label: "Scenarios" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const FlowScene = dynamic(() => import("@/components/three/FlowScene").then((m) => m.FlowScene), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

/** km³/yr -> m³/day */
const perDay = (km3yr: number) => (km3yr * 1e9) / 365;

function RealParts({ res }: { res: FlowResponse }) {
  const scale = res.scaleContext ?? [];
  const realParts = res.realPartsUsed ?? [];
  const municipal = scale.find((x) => x.key === "municipal");
  const delivered = res.state.deliveredTotal.value;
  const share = municipal?.value.value && delivered ? (delivered * 86400) / perDay(municipal.value.value) * 100 : null;
  return (
    <Card title="What is real here?" subtitle="The network is conceptual; real numbers are marked as real">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Network values</dt>
        <dd>{fromMeasure(res.state.lossPct) ? <DataStatusBadge info={fromMeasure(res.state.lossPct)} compact /> : "Conceptual"}</dd>
        <dt className="text-muted">Real data used by the network</dt>
        <dd data-testid="real-parts">{realParts.length ? realParts.join(", ") : "none"}</dd>
        <dt className="text-muted">Background loss rate</dt>
        <dd>{fmtMeasure(res.backgroundLossRate)} (assumption)</dd>
        <dt className="text-muted">Reservoir capacity</dt>
        <dd>{res.reservoirCapacity ? `${fmtNumber(res.reservoirCapacity.value ?? 0)} m³ (illustrative)` : "—"}</dd>
      </dl>
      {scale.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Real national magnitudes (for scale)</h3>
          <ul className="space-y-1.5 text-[12.5px]">
            {scale.map((x) => (
              <li key={x.key} className="flex flex-wrap items-center justify-between gap-x-2">
                <span>{x.label}</span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">{fmtMeasure(x.value)} {fromMeasure(x.value) && <DataStatusBadge info={fromMeasure(x.value)} compact />}</span>
              </li>
            ))}
          </ul>
          {share !== null && municipal && (
            <p className="mt-2 text-[12px] text-muted">
              For scale: the conceptual network delivers {fmtNumber((delivered ?? 0) * 86400)} m³/day, about {share < 0.1 ? share.toFixed(2) : share.toFixed(1)}% of
              Bangladesh&apos;s municipal withdrawal ({fmtNumber(perDay(municipal.value.value ?? 0))} m³/day, AQUASTAT reference year {municipal.value.referenceYear}).
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function CameraButtons({ hasSelection }: { hasSelection: boolean }) {
  const cameraCommand = useFlowStore((s) => s.cameraCommand);
  const b = "grid h-9 w-9 place-items-center rounded-lg text-ink transition hover:bg-light disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label="Camera" className="absolute bottom-3 right-3 z-20 flex flex-col gap-0.5 rounded-xl border border-border bg-white/95 p-1 shadow-md">
      <button type="button" className={b} aria-label="Reset view" title="Reset view" onClick={() => cameraCommand("reset")}><Home size={16} aria-hidden /></button>
      <button type="button" className={b} aria-label="Zoom in" title="Zoom in" onClick={() => cameraCommand("zoomIn")}><ZoomIn size={16} aria-hidden /></button>
      <button type="button" className={b} aria-label="Zoom out" title="Zoom out" onClick={() => cameraCommand("zoomOut")}><ZoomOut size={16} aria-hidden /></button>
      <button type="button" className={b} aria-label="Rotate left" title="Rotate left" onClick={() => cameraCommand("left")}><RotateCcw size={16} aria-hidden /></button>
      <button type="button" className={b} aria-label="Rotate right" title="Rotate right" onClick={() => cameraCommand("right")}><RotateCw size={16} aria-hidden /></button>
      <button type="button" className={b} aria-label="Focus on the selected object" title="Focus on the selected object" disabled={!hasSelection}
              onClick={() => cameraCommand("focus")}><Crosshair size={16} aria-hidden /></button>
    </div>
  );
}

function ObjectPicker() {
  const selection = useFlowStore((s) => s.selection);
  const select = useFlowStore((s) => s.select);
  const value = selection ? `${selection.kind}:${selection.id}` : "";
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
      <span className="sr-only sm:not-sr-only">Object</span>
      <select aria-label="Select an object" value={value} className="min-w-0 max-w-[13rem] rounded-lg border border-control bg-white px-2 py-1 text-[12.5px] text-ink"
              onChange={(e) => {
                const [kind, id] = e.target.value.split(":");
                select(kind ? ({ kind, id } as Selection) : null);
              }}>
        <option value="">None selected</option>
        <optgroup label="Facilities and zones">
          {NODES.map((n) => <option key={n.id} value={`node:${n.id}`}>{n.label}</option>)}
        </optgroup>
        <optgroup label="Pipelines">
          {PIPE_DEFS.map((p) => <option key={p.id} value={`pipe:${p.id}`}>{p.label}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

function LayersMenu() {
  const layers = useFlowStore((s) => s.layers);
  const toggleLayer = useFlowStore((s) => s.toggleLayer);
  const pipeColour = useFlowStore((s) => s.pipeColour);
  const setPipeColour = useFlowStore((s) => s.setPipeColour);
  return (
    <Popover label="Layers" panelLabel="Layers" align="right" width="w-64"
             trigger={<span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink"><Layers size={15} aria-hidden /> Layers</span>}>
      {() => (
        <fieldset className="space-y-1 p-1">
          <legend className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Show in the 3D view</legend>
          {(Object.keys(LAYER_LABEL) as LayerKey[]).map((k) => (
            <label key={k} className="flex items-center gap-2 rounded px-1 py-0.5 text-[12.5px] text-ink hover:bg-light">
              <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} className="h-4 w-4 accent-[#0868CC]" />
              {LAYER_LABEL[k]}
            </label>
          ))}
          <div className="border-t border-border pt-2">
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Pipe colour</p>
            <Segmented label="Pipe colour" value={pipeColour} onChange={setPipeColour}
                       options={[{ value: "type", label: "By type" }, { value: "pressure", label: "By pressure" }]} />
            {pipeColour === "pressure" && (
              <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="h-2.5 w-14 rounded" style={{ background: "linear-gradient(90deg,#CCEFEA,#0B5F58)" }} aria-hidden />
                mean pressure 0 → 50 m (light → dark)
              </p>
            )}
          </div>
        </fieldset>
      )}
    </Popover>
  );
}

function PanelTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length
      : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label="Simulation panel" className="grid grid-cols-3 gap-1 border-b border-border p-1.5">
      {TABS.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`flow-tab-${t.id}`}
                aria-selected={tab === t.id} aria-controls={tab === t.id ? `flow-panel-${t.id}` : undefined} tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}
                className={`rounded-lg px-2 py-1.5 text-[13px] font-medium transition ${tab === t.id ? "bg-primary text-white" : "text-muted hover:bg-light hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function WaterFlow() {
  const scenarioLoss = useAppStore((s) => s.activeScenario.pipelineLossPct);
  const inputs = useFlowStore((s) => s.inputs);
  const optimize = useFlowStore((s) => s.optimize);
  const showOptimized = useFlowStore((s) => s.showOptimized);
  const setShowOptimized = useFlowStore((s) => s.setShowOptimized);
  const running = useFlowStore((s) => s.running);
  const setRunning = useFlowStore((s) => s.setRunning);
  const speed = useFlowStore((s) => s.speed);
  const setSpeed = useFlowStore((s) => s.setSpeed);
  const lowPower = useFlowStore((s) => s.lowPower);
  const setLowPower = useFlowStore((s) => s.setLowPower);
  const layers = useFlowStore((s) => s.layers);
  const view = useFlowStore((s) => s.view);
  const setView = useFlowStore((s) => s.setView);
  const selection = useFlowStore((s) => s.selection);
  const select = useFlowStore((s) => s.select);
  const resetSimulation = useFlowStore((s) => s.resetSimulation);

  const [res, setRes] = useState<FlowResponse | null>(null);
  const [baseline, setBaseline] = useState<FlowState | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("controls");
  const seq = useRef(0);

  useEffect(() => {
    setWebgl(hasWebGL());
    if (window.matchMedia("(max-width: 768px)").matches) setLowPower(true);
  }, [setLowPower]);

  const body = useMemo(() => toRequest(inputs, { lossPct: scenarioLoss, optimize }), [inputs, scenarioLoss, optimize]);
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(() => {
      api.flow(body)
        .then((r) => { if (id === seq.current) { setRes(r); setErr(null); } })
        .catch((e: Error) => { if (id === seq.current) setErr(e); });
    }, 180);
    return () => clearTimeout(t);
  }, [body, nonce]);

  useEffect(() => {
    api.flow(toRequest(DEFAULT_INPUTS, { lossPct: scenarioLoss })).then((r) => setBaseline(r.state)).catch(() => setBaseline(null));
  }, [scenarioLoss, nonce]);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLElement && e.target.closest("[role=region]"))) select(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection, select]);

  const showing: "current" | "optimized" = showOptimized && res?.optimized ? "optimized" : "current";
  const shown = showing === "optimized" ? res?.optimized : res?.state;
  const enabledLayers = (Object.keys(ALL_LAYERS) as LayerKey[]).filter((k) => layers[k]).join(",");
  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: "3d", label: "3D view" }, { value: "schematic", label: "Schematic" }, { value: "table", label: "Data table" },
  ];
  const threeD = view === "3d" && webgl !== false;

  return (
    <div className="space-y-4">
      <PageHeader title="3D Water Flow"
        description="A hypothetical network from reservoir to four consumer zones: change the pump, pressure, leaks, valves and allocation and see the flows, pressures and water balance respond." />
      <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-primary bg-primary-soft px-3 py-2 text-[13px] text-primary">
        <FlaskConical size={16} aria-hidden className="shrink-0" />
        <strong className="font-semibold">Conceptual Simulation — Not Live Infrastructure Measurements.</strong>
        <span className="text-ink">The network is hypothetical: no IoT sensors, no real-time pipe pressure, no pump or valve control; AquaGuard does not detect physical leaks.</span>
      </div>
      {err && <ErrorCard error={err} onRetry={() => setNonce((n) => n + 1)} title="The simulation could not run" />}

      <div className="card relative z-20 flex flex-wrap items-center gap-2 p-2.5">
        <Segmented label="View" value={view} options={viewOptions} onChange={setView} />
        {res?.optimized && (
          <div role="radiogroup" aria-label="Network state shown" className="inline-flex rounded-lg border border-control bg-white p-0.5 text-[12.5px]">
            {(["current", "optimized"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={showing === v} onClick={() => setShowOptimized(v === "optimized")}
                      className={`rounded-md px-2.5 py-1 font-medium capitalize ${showing === v ? "bg-primary text-white" : "text-muted hover:text-ink"}`}>{v}</button>
            ))}
          </div>
        )}
        <ObjectPicker />
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Button variant="secondary" onClick={() => setRunning(!running)} ariaLabel={running ? "Pause animation" : "Play animation"}>
            {running ? <><Pause size={14} aria-hidden /> Pause</> : <><Play size={14} aria-hidden /> Play</>}
          </Button>
          <Button variant="secondary" onClick={() => { resetSimulation(); setTab("controls"); }} ariaLabel="Reset simulation">
            <RotateCcw size={14} aria-hidden /> Reset
          </Button>
          <div className="flex items-center gap-1.5">
            <label htmlFor="flow-speed" className="whitespace-nowrap text-[12.5px] text-muted">Animation speed</label>
            <input id="flow-speed" type="range" min={0} max={SPEEDS.length - 1} step={1} value={SPEEDS.indexOf(speed)}
                   aria-valuetext={`${speed} times`} onChange={(e) => setSpeed(SPEEDS[Number(e.target.value)])} className="w-20 accent-[#0868CC]" />
            <span className="w-9 text-[12.5px] tabular-nums text-ink">{speed}×</span>
          </div>
          <LayersMenu />
          <button type="button" onClick={() => setLowPower(!lowPower)} aria-pressed={lowPower}
                  className="rounded-lg border border-control bg-white px-2.5 py-1 text-[12.5px] text-muted hover:text-ink">
            {lowPower ? "Lite mode on" : "Lite mode"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <div className="card relative h-[420px] overflow-hidden p-0 sm:h-[500px] lg:h-[calc(100vh-350px)] lg:min-h-[480px]"
               data-testid="flow-scene" data-running={running} data-speed={speed} data-layers={enabledLayers} data-view={view}
               data-selection={selection ? `${selection.kind}:${selection.id}` : ""}>
            {!shown && <Skeleton className="h-full w-full" />}
            {/* the 3D scene stays mounted while another view is shown (keeps the camera; no WebGL context churn) */}
            {shown && webgl && (
              <div className={view === "3d" ? "h-full w-full" : "hidden"} aria-hidden={view !== "3d"}>
                <FlowScene state={shown} active={view === "3d"} />
              </div>
            )}
            {shown && view === "3d" && webgl === null && <Skeleton className="h-full w-full" />}
            {shown && view === "3d" && webgl === false && (
              <div className="flex h-full flex-col">
                <p role="note" className="border-b border-border bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#6b4a07]">
                  3D view unavailable: this browser or device has no WebGL. Showing the schematic instead; every control still works.
                </p>
                <div className="min-h-0 flex-1"><Schematic state={shown} /></div>
              </div>
            )}
            {shown && view === "schematic" && <Schematic state={shown} />}
            {shown && view === "table" && <DataTable state={shown} />}
            {view !== "table" && (
              <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-md border border-primary/40 bg-white/95 px-2 py-0.5 text-[11.5px] font-semibold text-primary shadow-sm">
                Conceptual simulation
              </div>
            )}
            {threeD && shown && <CameraButtons hasSelection={!!selection} />}
            {threeD && shown && (
              <p className="pointer-events-none absolute bottom-3 left-3 z-20 hidden rounded-md bg-white/90 px-2 py-1 text-[11.5px] text-muted shadow-sm sm:block">
                Drag to rotate · right-drag or two fingers to pan · scroll or pinch to zoom · click an object for details
              </p>
            )}
            {threeD && shown && (
              <InfoPanel state={shown} res={res} showing={showing} headingId="flow-info-desktop"
                         className="absolute left-3 top-3 z-30 hidden max-h-[calc(100%-24px)] w-[300px] rounded-xl lg:flex" />
            )}
          </div>
          {!threeD && shown && (
            <InfoPanel state={shown} res={res} showing={showing} headingId="flow-info-inline" className="hidden rounded-xl lg:flex" />
          )}
        </div>

        <div className="card flex min-w-0 flex-col p-0 lg:h-[calc(100vh-350px)] lg:min-h-[480px]">
          <PanelTabs tab={tab} setTab={setTab} />
          <div role="tabpanel" id={`flow-panel-${tab}`} aria-labelledby={`flow-tab-${tab}`} tabIndex={0}
               className="min-h-0 flex-1 overflow-y-auto p-3 outline-none">
            {tab === "controls" && <ControlsPanel res={res} scenarioLoss={scenarioLoss ?? null} />}
            {tab === "results" && (shown ? <ResultsPanel state={shown} res={res} /> : <Skeleton className="h-40 w-full" />)}
            {tab === "scenarios" && (shown ? <ScenariosPanel state={shown} baseline={baseline} /> : <Skeleton className="h-40 w-full" />)}
          </div>
        </div>
      </div>

      {shown && (
        <section className="card space-y-3 p-3" aria-label="Simulation summary">
          <KpiBar state={shown} />
          <div className="border-t border-border pt-2"><Legend /></div>
        </section>
      )}

      {shown && (
        <InfoPanel state={shown} res={res} showing={showing} headingId="flow-info-sheet"
                   className="fixed inset-x-0 bottom-0 z-40 flex max-h-[55vh] rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+3.5rem)] lg:hidden" />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {res && <RealParts res={res} />}
        {res?.optimized && (
          <Card title="Before vs after optimization" subtitle="Delivered volume per destination and leakage (m³/day)">
            <Plot filename="flow-before-after" ariaLabel="Delivered volumes and leakage before and after optimization" height={280}
              data={[
                { type: "bar", name: "Current", x: [...res.state.destinations.map((d) => d.id), "leakage"], y: [...res.state.destinations.map((d) => d.deliveredDaily.value), (res.state.leakTotal.value ?? 0) * 86400], marker: { color: SERIES[1] }, hovertemplate: "%{y:,.0f} m³/day" },
                { type: "bar", name: "Optimized", x: [...res.optimized.destinations.map((d) => d.id), "leakage"], y: [...res.optimized.destinations.map((d) => d.deliveredDaily.value), (res.optimized.leakTotal.value ?? 0) * 86400], marker: { color: SERIES[0] }, hovertemplate: "%{y:,.0f} m³/day" },
              ]}
              layout={baseLayout({ barmode: "group", bargap: 0.3, bargroupgap: 0.08, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("m³/day") } })} />
          </Card>
        )}
      </div>
      <Note>
        {res?.disclaimer ?? "All network values are conceptual."} Head loss: Hazen–Williams (C from config). Leakage: Q = k·P^N1 (FAVAD).
        Water balance at the network boundary (pump outlet → delivery points): inflow = delivered + leakage (+ storage change, not
        modelled: steady state); the identity is checked on every run. Allocation splits the junction flow; demand is hypothetical.
      </Note>
    </div>
  );
}
