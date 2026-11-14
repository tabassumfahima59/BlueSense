"use client";
/** The four consumer zones, each with its own visual identity. Repeated pieces are instanced. */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { seeded } from "./Environment";
import { Selectable } from "./Selectable";

type Tone = "good" | "warn" | "bad" | "off";
const TONE_GROUND: Record<Tone, string> = { good: "#E3EDF5", warn: "#F6E7C8", bad: "#F5D3D3", off: "#E2E5E9" };

function Ground({ w, d, tone, color }: { w: number; d: number; tone: Tone; color?: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color={color ?? TONE_GROUND[tone]} roughness={1} />
    </mesh>
  );
}

/** Instanced boxes with per-instance colour (buildings, crop rows). */
function Boxes({ items, castShadow = true }: {
  items: { p: [number, number, number]; s: [number, number, number]; c: string }[];
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      m.position.set(...it.p);
      m.scale.set(...it.s);
      m.updateMatrix();
      ref.current?.setMatrixAt(i, m.matrix);
      ref.current?.setColorAt(i, col.set(it.c));
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.75} />
    </instancedMesh>
  );
}

export function Residential({ pos, tone, buildings }: { pos: [number, number]; tone: Tone; buildings: boolean }) {
  const items = useMemo(() => {
    const rnd = seeded(7);
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const colours = ["#F8FAFC", "#E0EEFB", "#CFE3F7", "#F1F5F9"];
    for (let ix = 0; ix < 4; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        const h = 1.4 + rnd() * 4.2;
        const w = 1.3 + rnd() * 0.5;
        out.push({ p: [-4.2 + ix * 2.8, h / 2, -2.6 + iz * 2.6], s: [w, h, w], c: colours[(ix + iz) % 4] });
      }
    }
    return out;
  }, []);
  const roofs = useMemo(() => items.map((b) => ({
    p: [b.p[0], b.s[1] + 0.05, b.p[2]] as [number, number, number],
    s: [b.s[0] * 1.04, 0.1, b.s[2] * 1.04] as [number, number, number], c: "#7FA7D1" })), [items]);
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "residential" }} radius={6.4} height={5}>
        <Ground w={13} d={9.5} tone={tone} />
        {buildings && (
          <>
            <Boxes items={items} />
            <Boxes items={roofs} castShadow={false} />
            {/* rooftop water tanks on the taller blocks */}
            {items.filter((b) => b.s[1] > 3.6).map((b, i) => (
              <mesh key={i} position={[b.p[0], b.s[1] + 0.4, b.p[2]]}>
                <cylinderGeometry args={[0.28, 0.28, 0.6, 12]} />
                <meshStandardMaterial color="#1E40AF" />
              </mesh>
            ))}
          </>
        )}
      </Selectable>
    </group>
  );
}

export function Agricultural({ pos, tone }: { pos: [number, number]; tone: Tone }) {
  const fields = useMemo(() => [
    { x: -3.2, z: -2.2, c: "#86B86A" }, { x: 2.6, z: -2.2, c: "#A7C77F" },
    { x: -3.2, z: 2.2, c: "#6FA55B" }, { x: 2.6, z: 2.2, c: "#B9CF8C" },
  ], []);
  const rows = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    fields.forEach((f) => {
      for (let r = 0; r < 7; r++) out.push({ p: [f.x, 0.12, f.z - 1.5 + r * 0.5], s: [4.6, 0.18, 0.18], c: "#3F7D3A" });
    });
    return out;
  }, [fields]);
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "agricultural" }} radius={6.6} height={1.6}>
        <Ground w={13.6} d={10} tone={tone} color={tone === "good" ? "#D9E6C7" : undefined} />
        {fields.map((f, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[f.x, 0.05, f.z]} receiveShadow>
            <planeGeometry args={[5.2, 3.8]} />
            <meshStandardMaterial color={f.c} roughness={1} />
          </mesh>
        ))}
        <Boxes items={rows} castShadow={false} />
        {/* irrigation channels fed from the branch */}
        {[[-0.3, 0, 0.35, 9.4], [0, 0, 12.4, 0.35]].map(([x, z, w, d], i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.07, z]}>
            <planeGeometry args={[w, d]} />
            <meshStandardMaterial color="#3E8FD8" emissive="#1D6FC0" emissiveIntensity={0.2} roughness={0.2} />
          </mesh>
        ))}
        {/* farm shed */}
        <mesh position={[-6, 0.6, -4.2]} castShadow>
          <boxGeometry args={[1.4, 1.2, 1]} />
          <meshStandardMaterial color="#B45309" />
        </mesh>
      </Selectable>
    </group>
  );
}

export function Industrial({ pos, tone, buildings }: { pos: [number, number]; tone: Tone; buildings: boolean }) {
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "industrial" }} radius={6} height={6}>
        <Ground w={12.5} d={9} tone={tone} color={tone === "good" ? "#D6DCE2" : undefined} />
        {buildings && (
          <>
            {/* factory hall with a sawtooth roof */}
            <mesh position={[-1.2, 1.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[6, 2.6, 4]} />
              <meshStandardMaterial color="#5B6775" roughness={0.6} />
            </mesh>
            {[-3, -1.2, 0.6].map((x) => (
              <mesh key={x} position={[x, 2.9, 0]} rotation={[0, 0, 0]} castShadow>
                <cylinderGeometry args={[0.95, 0.95, 4, 3, 1]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
            ))}
            {/* banded chimneys */}
            {[2.6, 3.6].map((x) => (
              <group key={x} position={[x, 0, -1.6]}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <mesh key={i} position={[0, 0.55 + i * 1.1, 0]} castShadow>
                    <cylinderGeometry args={[0.3, 0.36, 1.1, 14]} />
                    <meshStandardMaterial color={i % 2 ? "#F1F5F9" : "#B91C1C"} />
                  </mesh>
                ))}
              </group>
            ))}
            {/* storage tanks */}
            {[[3.2, 2], [4.9, 2]].map(([x, z]) => (
              <group key={x} position={[x, 0, z]}>
                <mesh position={[0, 1, 0]} castShadow>
                  <cylinderGeometry args={[0.8, 0.8, 2, 24]} />
                  <meshStandardMaterial color="#AEB8C2" metalness={0.3} roughness={0.5} />
                </mesh>
                <mesh position={[0, 2, 0]}>
                  <sphereGeometry args={[0.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
                  <meshStandardMaterial color="#9AA6B2" metalness={0.3} />
                </mesh>
              </group>
            ))}
          </>
        )}
      </Selectable>
    </group>
  );
}

export function OtherZone({ pos, tone, buildings }: { pos: [number, number]; tone: Tone; buildings: boolean }) {
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Selectable sel={{ kind: "node", id: "other" }} radius={5.2} height={3.4}>
        <Ground w={10.5} d={8.5} tone={tone} />
        {buildings && (
          <>
            {/* hospital: white block with a red cross */}
            <mesh position={[-2.6, 1.3, -1.6]} castShadow>
              <boxGeometry args={[3, 2.6, 2.2]} />
              <meshStandardMaterial color="#FFFFFF" />
            </mesh>
            {[[0.9, 0.25], [0.25, 0.9]].map(([w, d], i) => (
              <mesh key={i} position={[-2.6, 2.63, -1.6]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[w, d]} />
                <meshBasicMaterial color="#DC2626" />
              </mesh>
            ))}
            {/* school: pitched roof */}
            <mesh position={[2.2, 0.8, -1.6]} castShadow>
              <boxGeometry args={[3.2, 1.6, 2]} />
              <meshStandardMaterial color="#F3DFA8" />
            </mesh>
            <mesh position={[2.2, 1.95, -1.6]} rotation={[0, 0, 0]} castShadow>
              <cylinderGeometry args={[1.15, 1.15, 3.3, 3, 1]} />
              <meshStandardMaterial color="#B45309" />
            </mesh>
            {/* market canopy */}
            <mesh position={[0, 1.2, 2.2]} castShadow>
              <boxGeometry args={[4.4, 0.18, 2]} />
              <meshStandardMaterial color="#F59E0B" />
            </mesh>
            {[[-2, 1.4], [2, 1.4], [-2, 3], [2, 3]].map(([x, z], i) => (
              <mesh key={i} position={[x, 0.6, z]}>
                <cylinderGeometry args={[0.07, 0.07, 1.2, 6]} />
                <meshStandardMaterial color="#78716C" />
              </mesh>
            ))}
          </>
        )}
      </Selectable>
    </group>
  );
}
