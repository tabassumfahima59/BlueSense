"use client";
/**
 * Low-poly R3F scene of the simulated network. Particle speed follows simulated velocity, pipes are coloured
 * by end pressure (sequential teal ramp), red markers show burst leaks. Rendering pauses when paused or the
 * tab is hidden; device pixel ratio is capped.
 */
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { FlowState } from "@/lib/types/contract";

const NODES: Record<string, [number, number, number]> = {
  reservoir: [-10, 0, 0],
  pump: [-6, 0, 0],
  junction: [0, 0, 0],
  residential: [6, 0, -5],
  agricultural: [7, 0, 0.5],
  industrial: [5.5, 0, 5.5],
};
const PIPE_ENDS: Record<string, [string, string]> = { trunk: ["pump", "junction"], res: ["junction", "residential"], agr: ["junction", "agricultural"], ind: ["junction", "industrial"] };
const LABEL: Record<string, string> = { residential: "Residential", agricultural: "Agricultural", industrial: "Industrial" };

/** Sequential teal ramp (light = low pressure, dark = high). */
export function pressureColor(p: number, min = 0, max = 50): string {
  const t = Math.max(0, Math.min(1, (p - min) / (max - min)));
  return new THREE.Color("#CCEFEA").lerp(new THREE.Color("#0B5F58"), t).getStyle();
}

function Pipe({ id, state, running, lowPower }: { id: string; state: FlowState; running: boolean; lowPower: boolean }) {
  const p = state.pipes.find((x) => x.id === id)!;
  const [a, b] = PIPE_ENDS[id];
  const start = useMemo(() => new THREE.Vector3(...NODES[a]).setY(0.4), [a]);
  const end = useMemo(() => new THREE.Vector3(...NODES[b]).setY(0.4), [b]);
  const dir = useMemo(() => end.clone().sub(start), [start, end]);
  const len = dir.length();
  const mid = useMemo(() => start.clone().add(end).multiplyScalar(0.5), [start, end]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), [dir]);
  const radius = (p.toNode === "junction" ? 0.22 : 0.16);
  const count = lowPower ? 10 : 24;
  const inst = useRef<THREE.InstancedMesh>(null);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => i / count), [count]);
  const speed = Math.max(0.02, (p.velocity.value ?? 0) * 0.25); // visual units per second, proportional to velocity
  const tmp = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, dt) => {
    if (!inst.current) return;
    for (let i = 0; i < count; i++) {
      if (running) offsets[i] = (offsets[i] + (speed * dt) / (len / 10)) % 1;
      tmp.position.copy(start).addScaledVector(dir, offsets[i]);
      tmp.updateMatrix();
      inst.current.setMatrixAt(i, tmp.matrix);
    }
    inst.current.instanceMatrix.needsUpdate = true;
  });

  const color = pressureColor(p.pressureEnd.value ?? 0);
  const leak = p.burstSeverity > 0;
  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[radius, radius, len, 10, 1, true]} />
        <meshStandardMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={inst} args={[undefined, undefined, count]}>
        <sphereGeometry args={[0.09, 6, 6]} />
        <meshBasicMaterial color="#2A78D6" />
      </instancedMesh>
      {leak && (
        <group position={mid.clone().setY(0.9)}>
          <mesh>
            <sphereGeometry args={[0.18 + 0.08 * p.burstSeverity, 10, 10]} />
            <meshBasicMaterial color="#F06464" />
          </mesh>
          <Html center distanceFactor={14} zIndexRange={[10, 0]}>
            <div className="whitespace-nowrap rounded bg-white/95 px-1.5 py-0.5 text-[11px] font-medium text-[#b42318] shadow">
              Leak {(p.leak.value ?? 0).toFixed(3)} m³/s
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

function Destination({ id, state }: { id: string; state: FlowState }) {
  const d = state.destinations.find((x) => x.id === id)!;
  const [x, , z] = NODES[id];
  return (
    <group position={[x, 0, z]}>
      {id === "residential" &&
        [[-0.7, -0.5], [0.6, -0.4], [0, 0.6], [-0.9, 0.7], [0.9, 0.8]].map(([dx, dz], i) => (
          <mesh key={i} position={[dx, 0.4, dz]}>
            <boxGeometry args={[0.6, 0.8, 0.6]} />
            <meshStandardMaterial color="#D3E4F5" />
          </mesh>
        ))}
      {id === "agricultural" && (
        <mesh position={[1, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3.2, 2.6]} />
          <meshStandardMaterial color="#B7E4C7" />
        </mesh>
      )}
      {id === "industrial" && (
        <>
          <mesh position={[0, 0.6, 0]}><boxGeometry args={[1.8, 1.2, 1.2]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
          <mesh position={[0.6, 1.5, 0.2]}><cylinderGeometry args={[0.15, 0.15, 1.2, 8]} /><meshStandardMaterial color="#94A3B8" /></mesh>
        </>
      )}
      <Html position={[0, 2.2, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
        <div className={`whitespace-nowrap rounded border bg-white/95 px-1.5 py-0.5 text-[11px] shadow ${d.serviceOk ? "border-[#E2E8F0]" : "border-[#F06464]"}`}>
          <b>{LABEL[id]}</b> · {(d.deliveredDaily.value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} m³/day · {(d.pressure.value ?? 0).toFixed(1)} m
          {!d.serviceOk && <span className="text-[#b42318]"> · below min</span>}
        </div>
      </Html>
    </group>
  );
}

export function FlowScene({ state, running, lowPower }: { state: FlowState; running: boolean; lowPower: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return (
    <Canvas
      camera={{ position: [1, 17, 21], fov: 42 }}
      dpr={[1, lowPower ? 1 : 1.5]}
      frameloop={visible ? "always" : "never"}
      gl={{ antialias: !lowPower, powerPreference: "low-power" }}
      aria-label="3D simulated water distribution network"
    >
      <color attach="background" args={["#F5F9FC"]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[8, 12, 6]} intensity={0.9} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[80, 60]} />
        <meshBasicMaterial color="#E8EEF3" />
      </mesh>
      {/* reservoir */}
      <group position={NODES.reservoir}>
        <mesh position={[0, 0.7, 0]}><cylinderGeometry args={[1.6, 1.6, 1.4, 20]} /><meshStandardMaterial color="#CBD5E1" /></mesh>
        <mesh position={[0, 1.25, 0]}><cylinderGeometry args={[1.5, 1.5, 0.12, 20]} /><meshStandardMaterial color="#38BDF8" /></mesh>
        <Html position={[0, 2.4, 0]} center distanceFactor={14} zIndexRange={[10, 0]}><div className="whitespace-nowrap rounded bg-white/95 px-1.5 py-0.5 text-[11px] shadow"><b>Reservoir</b></div></Html>
      </group>
      {/* pump station */}
      <group position={NODES.pump}>
        <mesh position={[0, 0.5, 0]}><boxGeometry args={[1.4, 1, 1.2]} /><meshStandardMaterial color="#0868CC" /></mesh>
        <Html position={[0, 1.8, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
          <div className="whitespace-nowrap rounded bg-white/95 px-1.5 py-0.5 text-[11px] shadow"><b>Pump</b> · {(state.pumpFlow.value ?? 0).toFixed(2)} m³/s · {(state.setpoint.value ?? 0).toFixed(1)} m</div>
        </Html>
      </group>
      <mesh position={[(NODES.reservoir[0] + NODES.pump[0]) / 2, 0.4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.22, 0.22, 4, 10]} /><meshStandardMaterial color="#94A3B8" />
      </mesh>
      <mesh position={[0, 0.4, 0]}><sphereGeometry args={[0.35, 12, 12]} /><meshStandardMaterial color="#64748B" /></mesh>
      {Object.keys(PIPE_ENDS).map((id) => <Pipe key={id} id={id} state={state} running={running} lowPower={lowPower} />)}
      {["residential", "agricultural", "industrial"].map((id) => <Destination key={id} id={id} state={state} />)}
      <OrbitControls enablePan={false} minDistance={8} maxDistance={40} maxPolarAngle={Math.PI / 2.15} />
    </Canvas>
  );
}
