"use client";
/** Terrain, a lake, roads with lane markings and instanced trees. Low-poly and instanced for ordinary laptops. */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/** Deterministic pseudo-random numbers (same layout on every load). */
export function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const ROADS: { x: number; z: number; w: number; d: number }[] = [
  { x: 0, z: 2.6, w: 64, d: 1.5 },     // east-west main road
  { x: 10.2, z: -6, w: 1.3, d: 15 },   // to the residential zone
  { x: 8, z: 9, w: 1.3, d: 12 },       // to the industrial zone
  { x: -6, z: 7.5, w: 1.3, d: 9 },     // to the commercial & public zone
  { x: -14, z: -1.5, w: 1.2, d: 6.5 }, // to the treatment plant
];

/** Areas kept free of trees (zones, roads, facilities): [x, z, half-width, half-depth]. */
const KEEP_CLEAR: [number, number, number, number][] = [
  [-22, -6, 4.5, 4.5], [-14, -7, 4, 5], [-6, -6, 4, 4], [3, -1, 2.5, 2.5], [17, -12, 7.5, 6], [19, 7, 7.5, 5.5],
  [4, 15, 6.5, 5], [-11, 11, 5.5, 4.5], [-27, 9, 7, 7], [0, 2.6, 34, 1.4], [10.2, -6, 1.2, 8], [8, 9, 1.2, 6.5],
  [-6, 7.5, 1.2, 5], [-14, -1.5, 1.2, 3.5], [0, -3, 9, 4.5],
];

function treePositions(n: number): [number, number, number][] {
  const rnd = seeded(42);
  const out: [number, number, number][] = [];
  let guard = 0;
  while (out.length < n && guard++ < 4000) {
    const x = -34 + rnd() * 68;
    const z = -22 + rnd() * 44;
    if (KEEP_CLEAR.some(([cx, cz, hw, hd]) => Math.abs(x - cx) < hw && Math.abs(z - cz) < hd)) continue;
    out.push([x, z, 0.7 + rnd() * 0.6]);
  }
  return out;
}

function Trees({ count }: { count: number }) {
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const pos = useMemo(() => treePositions(count), [count]);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    pos.forEach(([x, z, s], i) => {
      m.position.set(x, 0.55 * s, z);
      m.scale.set(s, s, s);
      m.updateMatrix();
      trunks.current?.setMatrixAt(i, m.matrix);
      m.position.set(x, 1.55 * s, z);
      m.updateMatrix();
      crowns.current?.setMatrixAt(i, m.matrix);
    });
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
    if (crowns.current) crowns.current.instanceMatrix.needsUpdate = true;
  }, [pos]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, pos.length]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1.1, 6]} />
        <meshStandardMaterial color="#8A6A4A" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, pos.length]} castShadow>
        <coneGeometry args={[0.85, 1.9, 7]} />
        <meshStandardMaterial color="#4E9A5B" roughness={0.85} />
      </instancedMesh>
    </group>
  );
}

function Roads() {
  const dashes = useRef<THREE.InstancedMesh>(null);
  const dashPos = useMemo(() => {
    const out: [number, number][] = [];
    for (let x = -31; x <= 31; x += 2.4) out.push([x, 2.6]);
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    dashPos.forEach(([x, z], i) => {
      m.position.set(x, 0.035, z);
      m.updateMatrix();
      dashes.current?.setMatrixAt(i, m.matrix);
    });
    if (dashes.current) dashes.current.instanceMatrix.needsUpdate = true;
  }, [dashPos]);
  return (
    <group>
      {ROADS.map((r, i) => (
        <mesh key={i} position={[r.x, 0.02, r.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[r.w, r.d]} />
          <meshStandardMaterial color="#6B7480" roughness={0.95} />
        </mesh>
      ))}
      <instancedMesh ref={dashes} args={[undefined, undefined, dashPos.length]}>
        <boxGeometry args={[1.1, 0.01, 0.12]} />
        <meshBasicMaterial color="#F3F6F9" />
      </instancedMesh>
    </group>
  );
}

function Lake({ running }: { running: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!mat.current || !running) return;
    const t = clock.getElapsedTime();
    mat.current.color.setHSL(0.57, 0.62, 0.52 + Math.sin(t * 0.8) * 0.02);
  });
  return (
    <group position={[-27, 0, 9]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <circleGeometry args={[6.2, 40]} />
        <meshStandardMaterial ref={mat} color="#3E8FD8" roughness={0.12} metalness={0.15} transparent opacity={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[6.2, 7, 40]} />
        <meshStandardMaterial color="#C8D9B4" roughness={1} />
      </mesh>
    </group>
  );
}

export function Environment({ terrain, roads, running, lowPower }: { terrain: boolean; roads: boolean; running: boolean; lowPower: boolean }) {
  return (
    <group>
      {terrain && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[96, 70]} />
            <meshStandardMaterial color="#DDEBD6" roughness={1} />
          </mesh>
          <Lake running={running} />
        </>
      )}
      {roads && (
        <>
          <Roads />
          <Trees count={lowPower ? 40 : 85} />
        </>
      )}
    </group>
  );
}
