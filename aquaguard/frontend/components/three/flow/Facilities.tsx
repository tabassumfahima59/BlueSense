"use client";
/** Reservoir, treatment plant, pump station and junction. Each is recognisable on its own and selectable. */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { Selectable } from "./Selectable";

const CONCRETE = "#D5DDE5";
const WATER = "#2F86D6";

/** Animated water surface: gentle bob and shimmer while the animation runs. */
function WaterDisc({ radius, y, running }: { radius: number; y: number; running: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!running || !mesh.current || !mat.current) return;
    const t = clock.getElapsedTime();
    mesh.current.position.y = y + Math.sin(t * 1.4) * 0.03;
    mat.current.emissiveIntensity = 0.12 + Math.sin(t * 2.1) * 0.05;
  });
  return (
    <mesh ref={mesh} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 40]} />
      <meshStandardMaterial ref={mat} color={WATER} emissive="#1D6FC0" emissiveIntensity={0.12} roughness={0.08}
                            metalness={0.2} transparent opacity={0.92} />
    </mesh>
  );
}

export function Reservoir({ pos, running }: { pos: [number, number]; running: boolean }) {
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "reservoir" }} radius={3.9} height={3}>
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <cylinderGeometry args={[3.7, 3.7, 0.12, 40]} />
          <meshStandardMaterial color="#C3CCD6" />
        </mesh>
        <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[3.3, 3.45, 2.4, 40, 1, true]} />
          <meshStandardMaterial color={CONCRETE} side={THREE.DoubleSide} roughness={0.85} />
        </mesh>
        <mesh position={[0, 2.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[3.33, 0.09, 8, 48]} />
          <meshStandardMaterial color="#AAB6C3" />
        </mesh>
        {/* illustrative level (not modelled) */}
        <WaterDisc radius={3.22} y={1.95} running={running} />
        {/* ladder */}
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[3.48, 0.4 + i * 0.45, 0]}>
            <boxGeometry args={[0.06, 0.05, 0.6]} />
            <meshStandardMaterial color="#7B8794" />
          </mesh>
        ))}
        {[-0.3, 0.3].map((z) => (
          <mesh key={z} position={[3.48, 1.3, z]}>
            <boxGeometry args={[0.06, 2.4, 0.06]} />
            <meshStandardMaterial color="#7B8794" />
          </mesh>
        ))}
        {/* outlet stub towards the intake */}
        <mesh position={[3.6, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.32, 0.32, 0.6, 16]} />
          <meshStandardMaterial color="#3B82C4" />
        </mesh>
      </Selectable>
    </group>
  );
}

export function TreatmentPlant({ pos, running }: { pos: [number, number]; running: boolean }) {
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "treatment" }} radius={3.2} height={2.6}>
        <mesh position={[0, 0.05, -1]} receiveShadow>
          <boxGeometry args={[6.4, 0.1, 6]} />
          <meshStandardMaterial color="#C9D2DB" />
        </mesh>
        <mesh position={[0, 1.05, 0.3]} castShadow receiveShadow>
          <boxGeometry args={[3.6, 2, 2.4]} />
          <meshStandardMaterial color="#F2F6FA" roughness={0.7} />
        </mesh>
        <mesh position={[0, 2.15, 0.3]} castShadow>
          <boxGeometry args={[3.8, 0.2, 2.6]} />
          <meshStandardMaterial color="#7FA7D1" />
        </mesh>
        {/* windows */}
        {[-1, 0, 1].map((i) => (
          <mesh key={i} position={[i * 1.05, 1.3, 1.51]}>
            <planeGeometry args={[0.6, 0.45]} />
            <meshStandardMaterial color="#9CC5EE" emissive="#5B9BD5" emissiveIntensity={0.15} />
          </mesh>
        ))}
        {/* clarifier basins */}
        {[-1.45, 1.45].map((x) => (
          <group key={x} position={[x, 0, -2.6]}>
            <mesh position={[0, 0.45, 0]} castShadow>
              <cylinderGeometry args={[1.25, 1.3, 0.8, 32, 1, true]} />
              <meshStandardMaterial color={CONCRETE} side={THREE.DoubleSide} />
            </mesh>
            <WaterDisc radius={1.18} y={0.7} running={running} />
            <mesh position={[0, 0.95, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.04, 0.04, 2.4, 6]} />
              <meshStandardMaterial color="#64748B" />
            </mesh>
          </group>
        ))}
      </Selectable>
    </group>
  );
}

export function PumpStation({ pos, flowShare, on, limited, running }: {
  pos: [number, number];
  /** pump flow / capacity, 0..1 (fan speed) */
  flowShare: number;
  on: boolean;
  limited: boolean;
  running: boolean;
}) {
  const fan = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, dt) => {
    if (fan.current && on && running) fan.current.rotation.x += dt * (4 + 22 * flowShare);
    if (light.current) light.current.emissiveIntensity = on ? 0.9 + Math.sin(clock.getElapsedTime() * 4) * 0.25 : 0.6;
  });
  const status = !on ? "#DC2626" : limited ? "#F59E0B" : "#16A34A";
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "pump" }} radius={3.1} height={2.8}>
        <mesh position={[0, 0.08, 0]} receiveShadow>
          <boxGeometry args={[5, 0.16, 4]} />
          <meshStandardMaterial color="#BCC6D0" />
        </mesh>
        {/* pump house */}
        <mesh position={[0, 1.15, -1.1]} castShadow receiveShadow>
          <boxGeometry args={[3.4, 2.1, 1.6]} />
          <meshStandardMaterial color="#E8EEF5" />
        </mesh>
        <mesh position={[0, 2.3, -1.1]} castShadow>
          <boxGeometry args={[3.7, 0.22, 1.9]} />
          <meshStandardMaterial color="#2563EB" />
        </mesh>
        <mesh position={[0.9, 0.85, -0.29]}>
          <planeGeometry args={[0.8, 1.3]} />
          <meshStandardMaterial color="#64748B" />
        </mesh>
        {/* pump unit: base, volute, coupling, motor, fan cowl */}
        <group position={[0, 0.16, 0.8]}>
          <mesh position={[0, 0.18, 0]} castShadow>
            <boxGeometry args={[3.2, 0.36, 1]} />
            <meshStandardMaterial color="#475569" />
          </mesh>
          <mesh position={[-0.9, 0.85, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.62, 0.62, 0.5, 28]} />
            <meshStandardMaterial color="#1D4ED8" metalness={0.35} roughness={0.4} />
          </mesh>
          <mesh position={[-0.35, 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.16, 0.16, 0.6, 12]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.6} />
          </mesh>
          <mesh position={[0.45, 0.85, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.48, 0.48, 1.1, 24]} />
            <meshStandardMaterial color="#0F766E" metalness={0.3} roughness={0.5} />
          </mesh>
          <mesh ref={fan} position={[1.08, 0.85, 0]}>
            <boxGeometry args={[0.08, 0.85, 0.16]} />
            <meshStandardMaterial color="#CBD5E1" />
          </mesh>
          <mesh position={[1.12, 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.5, 0.5, 0.12, 24, 1, true]} />
            <meshStandardMaterial color="#334155" side={THREE.DoubleSide} />
          </mesh>
          {/* inlet (left) and outlet (right) pipes with flanges */}
          <mesh position={[-1.85, 0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.3, 1.3, 16]} />
            <meshStandardMaterial color="#3B82C4" />
          </mesh>
          <mesh position={[-1.25, 0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.42, 0.42, 0.08, 20]} />
            <meshStandardMaterial color="#64748B" />
          </mesh>
          <mesh position={[-0.9, 1.45, 0]}>
            <cylinderGeometry args={[0.32, 0.32, 0.5, 16]} />
            <meshStandardMaterial color="#1F6FD1" />
          </mesh>
        </group>
        {/* status light on a pole */}
        <mesh position={[2.1, 0.9, 1.5]}>
          <cylinderGeometry args={[0.05, 0.05, 1.8, 8]} />
          <meshStandardMaterial color="#64748B" />
        </mesh>
        <mesh position={[2.1, 1.9, 1.5]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial ref={light} color={status} emissive={status} emissiveIntensity={0.9} />
        </mesh>
      </Selectable>
    </group>
  );
}

export function Junction({ pos }: { pos: [number, number] }) {
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "junction" }} radius={1.6} height={1.6}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.95, 1.05, 0.6, 24]} />
          <meshStandardMaterial color="#94A3B8" />
        </mesh>
        <mesh position={[0, 0.65, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.5, 8]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
        <mesh position={[0, 0.95, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.38, 0.06, 8, 24]} />
          <meshStandardMaterial color="#C2410C" />
        </mesh>
      </Selectable>
    </group>
  );
}
