"use client";
/**
 * Pipelines as tubes along smooth paths. Flow particles ride inside each pipe at a speed that follows the computed
 * velocity (and stop when the pipe carries no water), cones show the flow direction, and burst leaks get a pulsing
 * ring, a small spray and a value label. A fat invisible tube makes every pipe easy to click.
 */
import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { AlertTriangle } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { pipeFlow } from "@/lib/flow/derive";
import { type AnyPipeId, PIPE_DEFS, type PipeDef } from "@/lib/flow/network";
import { sameSel, useFlowStore } from "@/lib/flow/store";
import type { FlowState } from "@/lib/types/contract";
import { particleStep } from "../flow";
import { useLabelPortal } from "./Labels";
import { HOVER_COLOR, SELECT_COLOR } from "./Selectable";

export const PIPE_Y = 0.55;
export const PIPE_COLOR = { intake: "#64748B", main: "#1E40AF", branch: "#0284C7", closed: "#9CA3AF" } as const;
const PARTICLE = "#E0F7FF";
const LEAK = "#DC2626";

/** Sequential teal ramp (light = low pressure, dark = high). */
export function pressureColor(p: number, min = 0, max = 50): string {
  const t = Math.max(0, Math.min(1, (p - min) / (max - min)));
  return new THREE.Color("#CCEFEA").lerp(new THREE.Color("#0B5F58"), t).getStyle();
}

const curves = new Map<string, THREE.CatmullRomCurve3>();
/** The smooth 3D path of a pipe (cached: the network layout is fixed). */
export function pipeCurve(def: PipeDef): THREE.CatmullRomCurve3 {
  let c = curves.get(def.id);
  if (!c) {
    c = new THREE.CatmullRomCurve3(def.path.map(([x, z]) => new THREE.Vector3(x, PIPE_Y, z)), false, "centripetal", 0.4);
    curves.set(def.id, c);
  }
  return c;
}

const radiusOf = (def: PipeDef) => (def.kind === "branch" ? 0.24 : 0.34);

function Particles({ curve, length, radius, velocity, count, running, speed }: {
  curve: THREE.CatmullRomCurve3; length: number; radius: number; velocity: number; count: number; running: boolean;
  speed: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => i / count), [count]);
  const samples = useMemo(() => curve.getSpacedPoints(240), [curve]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const place = () => {
    if (!ref.current) return;
    for (let i = 0; i < count; i++) {
      tmp.position.copy(samples[Math.min(samples.length - 1, Math.floor(offsets[i] * (samples.length - 1)))]);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(place);
  useFrame((_, dt) => {
    if (!running) return;
    for (let i = 0; i < count; i++) offsets[i] = particleStep(offsets[i], velocity, speed, Math.min(dt, 0.1), length, running);
    place();
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} raycast={() => null}>
      <sphereGeometry args={[radius * 0.62, 8, 8]} />
      <meshBasicMaterial color={PARTICLE} toneMapped={false} />
    </instancedMesh>
  );
}

function Arrows({ curve, color }: { curve: THREE.CatmullRomCurve3; color: string }) {
  const marks = useMemo(() => [0.3, 0.7].map((t) => {
    const p = curve.getPointAt(t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(t).normalize());
    return { p: p.setY(PIPE_Y + 0.75), q };
  }), [curve]);
  return (
    <>
      {marks.map((m, i) => (
        <mesh key={i} position={m.p} quaternion={m.q} raycast={() => null}>
          <coneGeometry args={[0.32, 0.75, 14]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
        </mesh>
      ))}
    </>
  );
}

function Leak({ point, severity, leak, flow, label, running }: {
  point: THREE.Vector3; severity: number; leak: number; flow: number | null; label: boolean; running: boolean;
}) {
  const portal = useLabelPortal();
  const ring = useRef<THREE.Mesh>(null);
  const spray = useRef<THREE.InstancedMesh>(null);
  const n = 12;
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ring.current) ring.current.scale.setScalar(1 + (running ? (Math.sin(t * 3) + 1) * 0.12 : 0));
    if (!spray.current) return;
    for (let i = 0; i < n; i++) {
      const phase = ((running ? t * 0.9 : 0.5) + i / n) % 1;
      const a = (i / n) * Math.PI * 2;
      const r = phase * (0.5 + 0.35 * severity);
      tmp.position.set(point.x + Math.cos(a) * r, PIPE_Y + 0.2 + phase * (1 - phase) * (2 + severity), point.z + Math.sin(a) * r);
      tmp.scale.setScalar(1 - phase * 0.6);
      tmp.updateMatrix();
      spray.current.setMatrixAt(i, tmp.matrix);
    }
    spray.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <mesh ref={ring} position={[point.x, 0.08, point.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.55 + 0.2 * severity, 0.85 + 0.25 * severity, 40]} />
        <meshBasicMaterial color={LEAK} transparent opacity={0.85} />
      </mesh>
      <mesh position={[point.x, 0.06, point.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[0.5 + 0.35 * severity, 32]} />
        <meshBasicMaterial color="#5AA9E6" transparent opacity={0.45} />
      </mesh>
      <instancedMesh ref={spray} args={[undefined, undefined, n]} raycast={() => null}>
        <sphereGeometry args={[0.09, 6, 6]} />
        <meshBasicMaterial color="#7CC4F5" />
      </instancedMesh>
      {label && (
        <Html position={[point.x, PIPE_Y + 2.4, point.z]} center zIndexRange={[20, 0]} portal={portal}
              style={{ pointerEvents: "none" }}>
          <div className="flex items-center gap-1 whitespace-nowrap rounded border border-[#f3b4b4] bg-white/95 px-1.5 py-0.5 text-[11px] font-semibold text-[#b42318] shadow">
            <AlertTriangle size={11} aria-hidden />
            <span>Leak {leak.toFixed(3)} m³/s</span>
            {flow !== null && <span className="font-normal text-[#475569]">· flow {flow.toFixed(3)} m³/s</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

function Pipe({ def, state }: { def: PipeDef; state: FlowState }) {
  const curve = pipeCurve(def);
  const length = useMemo(() => curve.getLength(), [curve]);
  const radius = radiusOf(def);
  const tube = useMemo(() => new THREE.TubeGeometry(curve, Math.max(24, Math.round(length * 5)), radius, 14, false), [curve, length, radius]);
  const hit = useMemo(() => new THREE.TubeGeometry(curve, 32, 0.8, 6, false), [curve]);
  const halo = useMemo(() => new THREE.TubeGeometry(curve, Math.max(24, Math.round(length * 5)), radius + 0.16, 14, false), [curve, length, radius]);
  useLayoutEffect(() => () => { tube.dispose(); hit.dispose(); halo.dispose(); }, [tube, hit, halo]);
  const mid = useMemo(() => curve.getPointAt(0.5), [curve]);

  const layers = useFlowStore((s) => s.layers);
  const running = useFlowStore((s) => s.running);
  const speed = useFlowStore((s) => s.speed);
  const lowPower = useFlowStore((s) => s.lowPower);
  const pipeColour = useFlowStore((s) => s.pipeColour);
  const select = useFlowStore((s) => s.select);
  const setHover = useFlowStore((s) => s.setHover);
  const sel = useMemo(() => ({ kind: "pipe" as const, id: def.id as AnyPipeId }), [def.id]);
  const selected = useFlowStore((s) => sameSel(s.selection, sel));
  const hovered = useFlowStore((s) => sameSel(s.hover, sel));

  const visible = def.kind === "branch" ? layers.branchPipes : def.kind === "main" ? layers.mainPipes : layers.reservoirs;
  if (!visible) return null;
  const f = pipeFlow(def.id, state);
  const flowing = !f.closed && f.flow > 1e-6;
  const base = f.closed ? PIPE_COLOR.closed : pipeColour === "pressure" && def.modelled ? pressureColor(f.pressure) : PIPE_COLOR[def.kind];
  const count = Math.max(4, Math.round(length / (lowPower ? 2.2 : 1.1)));

  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); select(sel); };
  const onOver = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(sel); document.body.style.cursor = "pointer"; };
  const onOut = () => { setHover(null); document.body.style.cursor = ""; };

  return (
    <group>
      <mesh geometry={tube} castShadow={!lowPower}>
        <meshStandardMaterial color={base} transparent opacity={flowing ? 0.55 : 0.85} roughness={0.35} metalness={0.15}
                              depthWrite={false} emissive={f.severity > 0 && layers.leaks ? LEAK : "#000000"}
                              emissiveIntensity={f.severity > 0 && layers.leaks ? 0.25 : 0} />
      </mesh>
      {(selected || hovered) && (
        <mesh geometry={halo} raycast={() => null}>
          <meshBasicMaterial color={selected ? SELECT_COLOR : HOVER_COLOR} transparent opacity={selected ? 0.55 : 0.4}
                             depthWrite={false} />
        </mesh>
      )}
      <mesh geometry={hit} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {f.closed && (
        <group position={[mid.x, PIPE_Y, mid.z]}>
          <mesh raycast={() => null}>
            <boxGeometry args={[0.9, 0.9, 0.9]} />
            <meshStandardMaterial color="#6B7280" />
          </mesh>
          <mesh position={[0, 0.75, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
            <torusGeometry args={[0.38, 0.07, 8, 20]} />
            <meshStandardMaterial color="#B91C1C" />
          </mesh>
        </group>
      )}
      {flowing && layers.particles && (
        <Particles curve={curve} length={length} radius={radius} velocity={f.velocity} count={count} running={running}
                   speed={speed} />
      )}
      {flowing && layers.arrows && <Arrows curve={curve} color={def.kind === "branch" ? "#075985" : "#1E3A8A"} />}
      {f.severity > 0 && layers.leaks && (
        <Leak point={curve.getPointAt(def.kind === "main" ? 0.6 : 0.72)} severity={f.severity} leak={f.leak}
              flow={layers.labels ? f.flow : null} label running={running} />
      )}
    </group>
  );
}

export function Pipes({ state }: { state: FlowState }) {
  return (
    <group>
      {PIPE_DEFS.map((def) => <Pipe key={def.id} def={def} state={state} />)}
    </group>
  );
}
