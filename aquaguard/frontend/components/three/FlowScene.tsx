"use client";
/**
 * The 3D view of the conceptual (hypothetical) water-distribution network: a reservoir, a treatment plant, a pump
 * station, a junction and four consumer zones joined by pipelines. Every value comes from the engine's answer
 * (`state`); selection, hover, layers, playback and camera commands come from the module store, so the 3D view, the
 * schematic and the data table always agree.
 *
 * Performance: repeated pieces are instanced, the device pixel ratio is capped, shadows are off in Lite mode, the
 * render loop runs only while the animation plays (on demand otherwise) and stops when the tab is hidden.
 */
import { CameraControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { DEST_STATUS, num } from "@/lib/flow/derive";
import { type NodeId, nodeById, pipeById } from "@/lib/flow/network";
import { type Selection, useFlowStore } from "@/lib/flow/store";
import type { FlowState } from "@/lib/types/contract";
import { Environment } from "./flow/Environment";
import { Junction, PumpStation, Reservoir, TreatmentPlant } from "./flow/Facilities";
import { HoverTip, LabelPortal, Labels } from "./flow/Labels";
import { PIPE_Y, Pipes, pipeCurve } from "./flow/Pipes";
import { Agricultural, Industrial, OtherZone, Residential } from "./flow/Zones";

const HOME_POS: [number, number, number] = [2, 50, 52];
const HOME_TARGET: [number, number, number] = [-2, 0, 1.5];

/** World point of a selectable object (used to focus the camera and by the end-to-end tests). */
export function objectPoint(sel: NonNullable<Selection>): THREE.Vector3 | null {
  if (sel.kind === "node") {
    const n = nodeById(sel.id);
    return n ? new THREE.Vector3(n.pos[0], 1, n.pos[1]) : null;
  }
  const def = pipeById(sel.id);
  return def ? pipeCurve(def).getPointAt(0.5).setY(PIPE_Y) : null;
}

function CameraRig({ reduced }: { reduced: boolean }) {
  const ref = useRef<CameraControls>(null);
  const cmd = useFlowStore((s) => s.camera);
  useEffect(() => {
    ref.current?.setLookAt(...HOME_POS, ...HOME_TARGET, false);
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c || !cmd) return;
    const smooth = !reduced;
    if (cmd.type === "reset") void c.setLookAt(...HOME_POS, ...HOME_TARGET, smooth);
    else if (cmd.type === "zoomIn") void c.dolly(8, smooth);
    else if (cmd.type === "zoomOut") void c.dolly(-8, smooth);
    else if (cmd.type === "left") void c.rotate(-Math.PI / 8, 0, smooth);
    else if (cmd.type === "right") void c.rotate(Math.PI / 8, 0, smooth);
    else if (cmd.type === "focus") {
      const sel = useFlowStore.getState().selection;
      const p = sel ? objectPoint(sel) : null;
      if (p) void c.setLookAt(p.x + 8, 20, p.z + 20, p.x, 0.5, p.z, smooth);
    }
  }, [cmd, reduced]);
  return (
    <CameraControls ref={ref} makeDefault minDistance={9} maxDistance={85} maxPolarAngle={Math.PI / 2.25}
                    smoothTime={0.4} dollySpeed={0.6} />
  );
}

declare global {
  interface Window {
    /** Screen position of a 3D object (end-to-end tests click objects through this). */
    __flowProject?: (kind: "node" | "pipe", id: string) => { x: number; y: number } | null;
  }
}

function ProjectHook() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    window.__flowProject = (kind, id) => {
      const p = objectPoint({ kind, id } as NonNullable<Selection>);
      if (!p) return null;
      const v = p.project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    return () => { delete window.__flowProject; };
  }, [camera, gl]);
  return null;
}

type Tone = "good" | "warn" | "bad" | "off";
function zoneTone(state: FlowState, id: NodeId): Tone {
  const d = state.destinations.find((x) => x.id === id);
  return d ? DEST_STATUS[d.status]?.tone ?? "off" : "off";
}

function World({ state }: { state: FlowState }) {
  const layers = useFlowStore((s) => s.layers);
  const running = useFlowStore((s) => s.running);
  const lowPower = useFlowStore((s) => s.lowPower);
  const cap = num(state.pumpCapacity) ?? 1;
  const flowShare = cap > 0 ? Math.min(1, (num(state.pumpFlow) ?? 0) / cap) : 0;
  const limited = state.limitingFactor === "pump_capacity" || state.limitingFactor === "source_limit";
  const n = (id: NodeId) => nodeById(id)!.pos;
  return (
    <>
      <Environment terrain={layers.terrain} roads={layers.roads} running={running} lowPower={lowPower} />
      {layers.reservoirs && (
        <>
          <Reservoir pos={n("reservoir")} running={running} />
          <TreatmentPlant pos={n("treatment")} running={running} />
        </>
      )}
      {layers.pumps && <PumpStation pos={n("pump")} flowShare={flowShare} on={state.pumpOn} limited={limited} running={running} />}
      {layers.mainPipes && <Junction pos={n("junction")} />}
      {layers.residential && <Residential pos={n("residential")} tone={zoneTone(state, "residential")} buildings={layers.buildings} />}
      {layers.agricultural && <Agricultural pos={n("agricultural")} tone={zoneTone(state, "agricultural")} />}
      {layers.industrial && <Industrial pos={n("industrial")} tone={zoneTone(state, "industrial")} buildings={layers.buildings} />}
      {layers.other && <OtherZone pos={n("other")} tone={zoneTone(state, "other")} buildings={layers.buildings} />}
      <Pipes state={state} />
      <Labels state={state} />
      <HoverTip state={state} />
    </>
  );
}

export function FlowScene({ state, active = true }: { state: FlowState; active?: boolean }) {
  const running = useFlowStore((s) => s.running);
  const lowPower = useFlowStore((s) => s.lowPower);
  const select = useFlowStore((s) => s.select);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return (
    <LabelPortal.Provider value={overlay}>
    <div className="relative h-full w-full">
    <Canvas
      shadows={lowPower ? false : "percentage"}
      camera={{ position: HOME_POS, fov: 40, near: 0.5, far: 400 }}
      dpr={[1, lowPower ? 1 : 1.6]}
      frameloop={!visible || !active ? "never" : running ? "always" : "demand"}
      gl={{ antialias: !lowPower, powerPreference: lowPower ? "low-power" : "default" }}
      onPointerMissed={() => select(null)}
      onCreated={({ gl }) => gl.domElement.setAttribute("data-flow-canvas", "true")}
      role="img"
      aria-label="Conceptual 3D water distribution network (hypothetical). Use the Schematic or Data table view, or the object list, to explore it with a keyboard or screen reader."
    >
      <color attach="background" args={["#EAF2F8"]} />
      <fog attach="fog" args={["#EAF2F8", 70, 140]} />
      <hemisphereLight args={["#F4F9FF", "#B9C9A8", 0.85]} />
      <directionalLight
        position={[18, 32, 14]} intensity={1.5} castShadow={!lowPower}
        shadow-mapSize-width={1536} shadow-mapSize-height={1536} shadow-camera-left={-40} shadow-camera-right={40}
        shadow-camera-top={32} shadow-camera-bottom={-32} shadow-camera-far={120} shadow-bias={-0.0005}
      />
      <World state={state} />
      <CameraRig reduced={reduced} />
      <ProjectHook />
    </Canvas>
    {/* labels are portalled here (see LabelPortal) */}
    <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
    </LabelPortal.Provider>
  );
}
