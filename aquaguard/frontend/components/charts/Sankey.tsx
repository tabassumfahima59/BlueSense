"use client";
/**
 * D3 Sankey (d3-sankey): hover tooltips with quantities, direct labels, a legend that doubles as the keyboard path
 * to node details, "View as table" and PNG export. Generic over units so the national AQUASTAT budget (km³/yr) and
 * the monthly model (MCM) share one component.
 */
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import { BarChart3, Download, Table2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { fmtNumber } from "@/lib/format";
import type { BudgetState } from "@/lib/types/contract";
import { DataTable } from "./Plot";
import { FLOW_COLOR, NEUTRAL, SECTOR_COLOR } from "./theme";

export type FlowNode = {
  id: string;
  label: string;
  color: string;
  /** Pools pass their colour to nothing: links into a pool take the source colour, links out take the target's. */
  pool?: boolean;
  /** Short qualifier after the value, e.g. "ref. 2008" or "derived". */
  detail?: string;
};
export type FlowLink = { source: string; target: string; value: number | null };

type N = FlowNode & { x0?: number; x1?: number; y0?: number; y1?: number; value?: number; depth?: number };
type L = { source: string; target: string; value: number };

export function Sankey({ nodes, links, unit, total, totalLabel, height = 380, filename, ariaLabel, caption, onNodeClick, labelSpace = 360, leftSpace = 210 }: {
  nodes: FlowNode[];
  links: FlowLink[];
  unit: string;
  /** Base for the % shares. */
  total: number | null;
  totalLabel: string;
  height?: number;
  filename: string;
  ariaLabel: string;
  caption: string;
  onNodeClick?: (id: string) => void;
  /** Room for the first column's labels (drawn left of the nodes). */
  labelSpace?: number;
  leftSpace?: number;
}) {
  const width = 1040;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; key: string } | null>(null);
  const [asTable, setAsTable] = useState(false);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const graph = useMemo(() => {
    const ls: L[] = links
      .map((l) => ({ source: l.source, target: l.target, value: Math.max(0, l.value ?? 0) }))
      .filter((l) => l.value > 0);
    const used = new Set(ls.flatMap((l) => [l.source, l.target]));
    const ns: N[] = nodes.filter((n) => used.has(n.id)).map((n) => ({ ...n }));
    // Labels: first column on the left of its nodes, last column on the right, middle columns above the node.
    const gen = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(14)
      .nodePadding(22)
      .nodeSort(null)
      .extent([[leftSpace, 40], [width - labelSpace, height - 16]]);
    return gen({ nodes: ns, links: ls.map((d) => ({ ...d })) } as SankeyGraph<N, L>);
  }, [nodes, links, height, labelSpace, leftSpace]);

  const pct = (v: number) => (total && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");
  const qty = (v: number) => `${fmtNumber(v)} ${unit}`;
  const linkColor = (s: FlowNode, t: FlowNode) => (t.pool ? s.color : t.color);
  const shown = graph.nodes as unknown as Required<N>[];
  const lastDepth = Math.max(0, ...shown.map((n) => n.depth));

  function place(e: React.MouseEvent, text: string, key: string) {
    const r = svgRef.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text, key });
  }

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

  const hasDetail = nodes.some((n) => n.detail);
  const lab = (id: string) => byId.get(id)?.label ?? id;

  return (
    <div className="relative">
      <div className="mb-1 flex justify-end gap-1">
        <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted transition hover:bg-light hover:text-ink">
          {asTable ? <BarChart3 size={13} aria-hidden /> : <Table2 size={13} aria-hidden />}
          {asTable ? "View as chart" : "View as table"}
        </button>
        {!asTable && (
          <button type="button" onClick={downloadPng} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted transition hover:bg-light" aria-label="Download Sankey as PNG">
            <Download size={13} aria-hidden /> PNG
          </button>
        )}
      </div>
      {asTable ? (
        <DataTable caption={caption} head={["From", "To", unit, `Share of ${totalLabel}`, ...(hasDetail ? ["Reference"] : [])]}
                   rows={links.map((l) => {
                     const v = l.value ?? null;
                     return [lab(l.source), lab(l.target), v, v === null ? null : pct(v), ...(hasDetail ? [byId.get(l.target)?.detail ?? null] : [])];
                   })} />
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${caption} (scrollable)`}>
          <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: 560 }} role="img" aria-label={ariaLabel}
               xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, system-ui, sans-serif">
            <g fill="none">
              {graph.links.map((l, i) => {
                const s = l.source as unknown as FlowNode;
                const t = l.target as unknown as FlowNode;
                const key = `link:${s.id}>${t.id}`;
                return (
                  <path key={i} d={sankeyLinkHorizontal()(l as never) ?? undefined} stroke={linkColor(s, t)}
                        strokeOpacity={hover?.key === key ? 0.6 : 0.32} strokeWidth={Math.max(1, l.width ?? 1)}
                        onMouseMove={(e) => place(e, `${s.label} → ${t.label}: ${qty(l.value)} (${pct(l.value)} of ${totalLabel})${t.detail ? ` · ${t.detail}` : ""}`, key)}
                        onMouseLeave={() => setHover(null)} />
                );
              })}
            </g>
            {shown.map((nd) => {
              const key = `node:${nd.id}`;
              const text = `${nd.label}: ${qty(nd.value)} (${pct(nd.value)} of ${totalLabel})${nd.detail ? ` · ${nd.detail}` : ""}${onNodeClick ? " · click for details" : ""}`;
              return (
                <g key={nd.id} data-node={nd.id} onClick={onNodeClick ? () => onNodeClick(nd.id) : undefined}
                   style={onNodeClick ? { cursor: "pointer" } : undefined}
                   onMouseMove={(e) => place(e, text, key)} onMouseLeave={() => setHover(null)}>
                  <rect x={nd.x0} y={nd.y0} width={nd.x1 - nd.x0} height={Math.max(2, nd.y1 - nd.y0)} rx={3} fill={nd.color}
                        stroke={hover?.key === key ? NEUTRAL.ink : "none"} strokeWidth={1.5} />
                  <NodeLabel nd={nd} side={nd.depth === lastDepth && lastDepth > 0 ? "right" : nd.depth === 0 ? "left" : "top"}
                             value={`${qty(nd.value)} · ${pct(nd.value)}${nd.detail ? ` · ${nd.detail}` : ""}`} />
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {hover && !asTable && (
        <div role="tooltip" className="pointer-events-none absolute z-10 max-w-[360px] rounded-md border border-border bg-white px-2 py-1 text-[12px] shadow"
             style={{ left: Math.min(hover.x + 12, width - 200), top: hover.y + 8 }}>
          {hover.text}
        </div>
      )}
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={onNodeClick ? "Budget parts (open details)" : "Legend"}>
        {nodes.map((n) => {
          const swatch = <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: n.color }} aria-hidden />;
          return (
            <li key={n.id}>
              {onNodeClick ? (
                <button type="button" onClick={() => onNodeClick(n.id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[12px] text-ink transition hover:border-primary hover:bg-primary-soft">
                  {swatch}{n.label}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-1 text-[12px] text-muted">{swatch}{n.label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const HALO = { stroke: "#FFFFFF", strokeWidth: 3, strokeLinejoin: "round" as const, paintOrder: "stroke" };

function NodeLabel({ nd, side, value }: { nd: Required<N>; side: "left" | "right" | "top"; value: string }) {
  const cy = (nd.y0 + nd.y1) / 2;
  if (side === "right") {
    return (
      <text x={nd.x1 + 6} y={cy} dy="0.35em" fontSize={12} fill={NEUTRAL.ink} {...HALO}>
        {nd.label}<tspan fill={NEUTRAL.muted}> {value}</tspan>
      </text>
    );
  }
  const x = side === "left" ? nd.x0 - 6 : (nd.x0 + nd.x1) / 2;
  const y = side === "left" ? cy - 7 : nd.y0 - 22;
  return (
    <text x={x} y={y} dy="0.35em" fontSize={12} fill={NEUTRAL.ink} textAnchor={side === "left" ? "end" : "middle"} {...HALO}>
      <tspan x={x}>{nd.label}</tspan>
      <tspan x={x} dy={15} fill={NEUTRAL.muted}>{value}</tspan>
    </text>
  );
}

/** Monthly-model budget (MCM) in the generic Sankey. */
export function SankeyChart({ state, height = 380, filename, onNodeClick }: { state: BudgetState; height?: number; filename: string; onNodeClick?: (id: string) => void }) {
  const nodes: FlowNode[] = state.nodes.map((n) => ({
    id: n.id, label: n.label, pool: n.kind === "pool",
    color: FLOW_COLOR[n.id] ?? SECTOR_COLOR[n.id] ?? NEUTRAL.reference,
  }));
  const links: FlowLink[] = state.links.map((l) => ({ source: l.source, target: l.target, value: l.value.value ?? null }));
  return (
    <Sankey nodes={nodes} links={links} unit="MCM" total={state.supply.value ?? null} totalLabel="total available" height={height}
            filename={filename} caption="Water budget flows (monthly model)" onNodeClick={onNodeClick} labelSpace={330} leftSpace={170}
            ariaLabel="Water budget Sankey diagram: surface water and groundwater to total available, then to sectors, distribution losses and storage" />
  );
}
