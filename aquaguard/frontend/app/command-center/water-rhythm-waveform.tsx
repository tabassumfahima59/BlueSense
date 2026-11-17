"use client";
import { useEffect, useId, useRef, useState } from "react";
import { fmtNumber } from "@/lib/format";
import { monthLabel } from "@/lib/format/time";
import { rhythmValue, waveformPaths, type RhythmMode, type RhythmPoint } from "@/lib/weather/rhythm";
import styles from "./water-rhythm.module.css";

export function RhythmWaveform({ points, mode, index, unit, title, onSelect, onStep }: {
  points: RhythmPoint[]; mode: RhythmMode; index: number; unit: string; title: string;
  onSelect: (index: number) => void; onStep: (direction: -1 | 1) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const values = points.map((p) => rhythmValue(p, mode));
  const extent = Math.max(1, ...values.map((v) => Math.abs(v ?? 0))) * 1.12;
  const left = 54, right = width - 20, top = 22, bottom = 234, zero = (top + bottom) / 2;
  const x = (i: number) => points.length < 2 ? (left + right) / 2 : left + i / (points.length - 1) * (right - left);
  const y = (v: number) => zero - v / extent * (bottom - top) / 2;
  const paths = waveformPaths(values, x, y).join("");
  const selected = values[index];
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  const hovered = hover === null ? null : points[hover];
  const hoveredValue = hovered ? rhythmValue(hovered, mode) : null;
  const nearest = (clientX: number) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.max(0, Math.min(points.length - 1,
      Math.round(((clientX - box.left) / box.width * width - left) / (right - left) * (points.length - 1))));
  };
  return (
    <div ref={root} className={styles.waveform} role="group" aria-label={`${title} waveform. Use left and right arrows to select observations.`}
      tabIndex={0} onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onStep(e.key === "ArrowLeft" ? -1 : 1); }
      }}>
      <svg viewBox={`0 0 ${width} 280`} role="img" aria-label={`${title}, ${unit}. Gaps indicate missing observations.`}
        onPointerMove={(e) => setHover(nearest(e.clientX))} onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => onSelect(nearest(e.clientX))}>
        <defs>
          <clipPath id={`${id}-positive`}><rect x={left} y={top - 8} width={right - left} height={zero - top + 8} /></clipPath>
          <clipPath id={`${id}-negative`}><rect x={left} y={zero} width={right - left} height={bottom - zero + 8} /></clipPath>
          <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#54dcff" stopOpacity="0" /><stop offset="0.5" stopColor="#54dcff" stopOpacity="0.12" />
            <stop offset="1" stopColor="#54dcff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((n) => <line key={n} x1={left} x2={right} y1={top + n * (bottom - top) / 4}
          y2={top + n * (bottom - top) / 4} stroke="#badcff" strokeOpacity={n === 2 ? 0.38 : 0.09} strokeDasharray={n === 2 ? "4 4" : undefined} />)}
        {ticks.map((i) => <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={top} y2={bottom} stroke="#badcff" strokeOpacity="0.08" />
          <text x={x(i)} y={261} fill="#b5cde6" fontSize="11" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
            {monthLabel(points[i]?.month)}
          </text>
        </g>)}
        {[extent, 0, -extent].map((v) => <text key={v} x={left - 9} y={y(v) + 4} fill="#b5cde6" fontSize="11" textAnchor="end">
          {v > 0 ? "+" : ""}{fmtNumber(v, mode === "dryness" ? 1 : 0)}
        </text>)}
        <g key={mode} className={styles.curveEnter}>
          <path d={paths} fill="none" stroke="#54dcff" strokeWidth="8" opacity="0.08" clipPath={`url(#${id}-positive)`} />
          <path d={paths} fill="none" stroke="#d6a2ff" strokeWidth="8" opacity="0.08" clipPath={`url(#${id}-negative)`} />
          <path d={paths} fill="none" stroke="#54dcff" strokeWidth="2.5" strokeLinejoin="round" clipPath={`url(#${id}-positive)`} />
          <path d={paths} fill="none" stroke="#d6a2ff" strokeWidth="2.5" strokeLinejoin="round" clipPath={`url(#${id}-negative)`} />
          {values.map((v, i) => v === null ? (
            <g key={points[i].month} aria-label={`${monthLabel(points[i].month)}: no observation`}>
              <line x1={x(i) - 2} x2={x(i) + 2} y1={zero - 2} y2={zero + 2} stroke="#8da0b6" />
              <line x1={x(i) - 2} x2={x(i) + 2} y1={zero + 2} y2={zero - 2} stroke="#8da0b6" />
            </g>
          ) : <circle key={points[i].month} cx={x(i)} cy={y(v)} r={points.length > 100 ? 1.5 : 3}
            fill={v >= 0 ? "#54dcff" : "#d6a2ff"} opacity={i === index ? 1 : 0.75}>
            <title>{monthLabel(points[i].month)}: {fmtNumber(v, 2)} {unit}</title>
          </circle>)}
        </g>
        {index >= 0 && <g className={styles.cursor} style={{ transform: `translateX(${x(index)}px)` }}>
          <rect x="-18" y={top} width="36" height={bottom - top} fill={`url(#${id}-beam)`} />
          <line x1="0" x2="0" y1={top} y2={bottom} stroke="#e2f6ff" strokeOpacity="0.6" strokeDasharray="3 5" />
          {selected !== null && selected !== undefined && <g style={{ transform: `translateY(${y(selected)}px)` }}>
            <circle r="12" fill={selected >= 0 ? "#54dcff" : "#d6a2ff"} opacity="0.2" className={styles.pointGlow} />
            <circle r="5" fill={selected >= 0 ? "#54dcff" : "#d6a2ff"} stroke="#ffffff" strokeWidth="2" />
          </g>}
        </g>}
      </svg>
      {hovered && <div role="tooltip" className={styles.tooltip}
        style={{ left: `clamp(8px, ${hover === null ? 0 : x(hover) / width * 100}%, calc(100% - 232px))` }}>
        <strong>{monthLabel(hovered.month)}</strong><span>{title}</span>
        <b>{hoveredValue === null ? "No supported observation" : `${fmtNumber(hoveredValue, 2)} ${unit}`}</b>
        <span>Click to inspect values, source and status</span>
      </div>}
    </div>
  );
}
