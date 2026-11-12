"use client";
/** D3 Sankey (d3-sankey) with hover tooltips, % shares and PNG export. Values in MCM. */
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import { Download } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { fmtNumber } from "@/lib/format";
import type { BudgetState } from "@/lib/types/contract";
import { NEUTRAL, SECTOR_COLOR, SERIES } from "./theme";

type N = { id: string; label: string; kind: string };
type L = { source: string; target: string; value: number };

const NODE_COLOR: Record<string, string> = {
  surface: SERIES[2],
  groundwater: SERIES[4],
  available: NEUTRAL.reference,
  storage: "#94A3B8",
  ...SECTOR_COLOR,
};

export function SankeyChart({ state, height = 380, filename }: { state: BudgetState; height?: number; filename: string }) {
  const width = 1040;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const total = state.supply.value ?? 0;

  const graph = useMemo(() => {
    const links: L[] = state.links
      .map((l) => ({ source: l.source, target: l.target, value: Math.max(0, l.value.value ?? 0) }))
      .filter((l) => l.value > 0);
    const used = new Set(links.flatMap((l) => [l.source, l.target]));
    const nodes: N[] = state.nodes.filter((n) => used.has(n.id)).map((n) => ({ ...n }));
    const gen = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(14)
      .nodePadding(18)
      .nodeSort(null)
      .extent([[8, 8], [width - 340, height - 8]]);
    return gen({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) } as SankeyGraph<N, L>);
  }, [state, height]);

  function downloadPng() {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const scale = 2;
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = width * scale;
      c.height = height * scale;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      const a = document.createElement("a");
      a.download = `aquaguard-${filename}.png`;
      a.href = c.toDataURL("image/png");
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  }

  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");

  return (
    <div className="relative">
      <div className="mb-1 flex justify-end">
        <button onClick={downloadPng} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-bg" aria-label="Download Sankey as PNG">
          <Download size={13} aria-hidden /> PNG
        </button>
      </div>
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: 560 }}
          role="img"
          aria-label="Water budget Sankey diagram: sources to total available to sectors, losses and storage"
          xmlns="http://www.w3.org/2000/svg"
          fontFamily="Inter, system-ui, sans-serif"
        >
          <g fill="none">
            {graph.links.map((l, i) => {
              const s = l.source as unknown as N;
              const t = l.target as unknown as N;
              const color = NODE_COLOR[t.id === "available" ? s.id : t.id] ?? NEUTRAL.reference;
              return (
                <path
                  key={i}
                  d={sankeyLinkHorizontal()(l as never) ?? undefined}
                  stroke={color}
                  strokeOpacity={hover?.text.startsWith(`${s.label} → ${t.label}`) ? 0.55 : 0.3}
                  strokeWidth={Math.max(1, l.width ?? 1)}
                  onMouseMove={(e) => {
                    const r = svgRef.current!.getBoundingClientRect();
                    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: `${s.label} → ${t.label}: ${fmtNumber(l.value)} MCM (${pct(l.value)} of supply)` });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </g>
          {graph.nodes.map((n) => {
            const nd = n as unknown as N & { x0: number; x1: number; y0: number; y1: number; value: number };
            return (
              <g key={nd.id}>
                <rect x={nd.x0} y={nd.y0} width={nd.x1 - nd.x0} height={Math.max(2, nd.y1 - nd.y0)} rx={3} fill={NODE_COLOR[nd.id] ?? NEUTRAL.reference} />
                <text x={nd.x1 + 6} y={(nd.y0 + nd.y1) / 2} dy="0.35em" fontSize={12} fill={NEUTRAL.ink}>
                  {nd.label}
                  <tspan fill={NEUTRAL.muted}> {fmtNumber(nd.value)} MCM · {pct(nd.value)}</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-border bg-white px-2 py-1 text-[12px] shadow" style={{ left: hover.x + 12, top: hover.y + 8 }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}
