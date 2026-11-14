"use client";
/**
 * Makes a 3D object selectable: a generous invisible hit volume (no tiny click targets), a hover ring and a
 * selected ring with a soft pulse. Selection lives in the module store, so every view shares it.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { type ReactNode, useRef } from "react";
import type * as THREE from "three";
import { sameSel, type Selection, useFlowStore } from "@/lib/flow/store";

export const SELECT_COLOR = "#F59E0B";
export const HOVER_COLOR = "#38BDF8";

export function Selectable({ sel, radius, height = 3, children }: {
  sel: NonNullable<Selection>;
  radius: number;
  height?: number;
  children: ReactNode;
}) {
  const select = useFlowStore((s) => s.select);
  const setHover = useFlowStore((s) => s.setHover);
  const selected = useFlowStore((s) => sameSel(s.selection, sel));
  const hovered = useFlowStore((s) => sameSel(s.hover, sel));
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current && selected) ring.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 3) * 0.04);
  });
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(sel);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(sel);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    setHover(null);
    document.body.style.cursor = "";
  };
  return (
    <group onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
      {children}
      {/* invisible hit volume: easy to click */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius, radius, height, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {(selected || hovered) && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[radius + 0.15, radius + 0.55, 56]} />
          <meshBasicMaterial color={selected ? SELECT_COLOR : HOVER_COLOR} transparent opacity={selected ? 0.95 : 0.7} />
        </mesh>
      )}
    </group>
  );
}
