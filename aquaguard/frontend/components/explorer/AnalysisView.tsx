"use client";
/**
 * Analysis: spatial patterns across the divisions, division-by-division charts and a side-by-side comparison of two
 * regions. Observed (reanalysis) patterns are kept apart from the estimated risk; nothing is presented as a cause.
 */
import { useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, SERIES } from "@/components/charts/theme";
import { Card } from "@/components/ui/Card";
import { RiskPill } from "@/components/ui/Risk";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { num, patterns, RISK_LABELS, signed } from "@/lib/explorer/analysis";
import { riskColor } from "@/lib/format";
import type { OverviewRow } from "@/lib/types/contract";

const BASIS_STYLE: Record<string, string> = {
  "observed (reanalysis)": "border-[#9CC5EE] bg-[#EEF6FD] text-[#0B4F8A]",
  "estimated (engine + ML)": "border-[#F5C27A] bg-[#FFF7EB] text-[#7A4A06]",
  derived: "border-[#B9CCE0] bg-[#F4F8FC] text-[#36506E]",
  coverage: "border-border bg-white text-muted",
};

function Side({ rows, a, b, setA, setB }: { rows: OverviewRow[]; a: string; b: string; setA: (v: string) => void; setB: (v: string) => void }) {
  const ra = rows.find((r) => r.id === a);
  const rb = rows.find((r) => r.id === b);
  const line: [string, (r: OverviewRow) => string, ((x: OverviewRow, y: OverviewRow) => string) | null][] = [
    ["Rainfall, last 12 months", (r) => (r.last12 ? `${num(r.last12.rain)} mm` : "—"),
     (x, y) => (x.last12 && y.last12 ? `${signed(y.last12.rain - x.last12.rain)} mm` : "—")],
    ["vs 1991–2020 normal", (r) => signed(r.last12?.rainDeparturePct, 0, "%"),
     (x, y) => (x.last12?.rainDeparturePct != null && y.last12?.rainDeparturePct != null ? `${signed(y.last12.rainDeparturePct - x.last12.rainDeparturePct, 0)} points` : "—")],
    ["Mean temperature, 12 months", (r) => (r.last12 ? `${num(r.last12.tmean, 1)} °C` : "—"),
     (x, y) => (x.last12 && y.last12 ? signed(y.last12.tmean - x.last12.tmean, 1, " °C") : "—")],
    ["Seasonal dryness (z)", (r) => (r.drynessZ !== null ? `${signed(r.drynessZ, 2)} (${r.drynessClass ?? "—"})` : "—"), null],
    ["Est. scarcity risk", (r) => r.risk.label, null],
    ["Dry-season stress ratio (est.)", (r) => num(r.risk.dryStressRatio, 3), (x, y) => signed(y.risk.dryStressRatio - x.risk.dryStressRatio, 3)],
    ["Population", (r) => num(r.population), null],
  ];
  const sel = (id: string, v: string, set: (v: string) => void) => (
    <select id={id} value={v} onChange={(e) => set(e.target.value)} className="rounded-lg border border-control bg-white px-2 py-1 text-[12.5px]">
      {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
  return (
    <Card title="Compare two regions" subtitle="Same indicators side by side; the difference is B − A">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
        <label htmlFor="cmp-a" className="text-muted">Region A</label>{sel("cmp-a", a, setA)}
        <label htmlFor="cmp-b" className="text-muted">Region B</label>{sel("cmp-b", b, setB)}
      </div>
      {ra && rb && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[12.5px]" data-testid="region-compare">
            <thead className="text-left text-muted"><tr className="border-b border-border">
              <th className="py-1 font-medium">Indicator</th><th className="text-right font-medium">{ra.name}</th>
              <th className="text-right font-medium">{rb.name}</th><th className="text-right font-medium">B − A</th></tr></thead>
            <tbody>
              {line.map(([label, f, diff]) => (
                <tr key={label} className="border-b border-border/60">
                  <th scope="row" className="py-1 text-left font-normal">{label}</th>
                  <td className="text-right tabular-nums">{f(ra)}</td><td className="text-right tabular-nums">{f(rb)}</td>
                  <td className="text-right tabular-nums">{diff ? diff(ra, rb) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11.5px] text-muted">A difference between regions describes them; it does not explain why they differ.</p>
        </div>
      )}
    </Card>
  );
}

export function AnalysisView({ selectedDivision }: { selectedDivision: string | null }) {
  const ov = useApi("explorer-overview", api.explorerOverview);
  const [a, setA] = useState(selectedDivision ?? "rajshahi");
  const [b, setB] = useState(selectedDivision === "sylhet" ? "dhaka" : "sylhet");
  if (ov.error) return <ErrorCard error={ov.error} onRetry={ov.retry} title="Analysis unavailable" />;
  if (!ov.data) return <Skeleton className="h-[420px] w-full" />;
  const rows = ov.data.data.rows;
  const div = rows.filter((r) => r.level === "division");
  const byRain = [...div].filter((r) => r.last12).sort((x, y) => x.last12!.rainDeparturePct! - y.last12!.rainDeparturePct!);
  const byRisk = [...div].sort((x, y) => y.risk.level - x.risk.level || y.risk.dryStressRatio - x.risk.dryStressRatio);
  const pats = patterns(rows);
  return (
    <div className="space-y-4" data-testid="analysis-view">
      <Card title="Spatial patterns" subtitle="Built from the division values below; each states its basis">
        <ul className="space-y-2" data-testid="patterns">
          {pats.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start gap-2 text-[13px]">
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${BASIS_STYLE[p.basis]}`}>{p.basis}</span>
              <span className="min-w-0 flex-1">{p.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11.5px] text-muted">Patterns describe differences between divisions; they do not establish causes. The risk is an estimate (engine stress ratio with area-based splits, combined with an ML dryness class).</p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Rainfall vs normal by division" subtitle="Last 12 complete months, % of the 1991–2020 normal (ERA5 reanalysis)">
          <Plot filename="rainfall-departure-divisions" ariaLabel="Rainfall departure from normal by division" height={300} tableKeyLabel="Division"
            data={[{ type: "bar", orientation: "h", x: byRain.map((r) => r.last12!.rainDeparturePct), y: byRain.map((r) => r.name),
                     marker: { color: byRain.map((r) => ((r.last12!.rainDeparturePct ?? 0) < 0 ? SERIES[1] : SERIES[0])) },
                     text: byRain.map((r) => signed(r.last12!.rainDeparturePct, 0, "%")), textposition: "inside", insidetextanchor: "end",
                     textfont: { color: "#FFFFFF" },
                     hovertemplate: "%{y}: %{x:.1f}%<extra></extra>", name: "Departure" }]}
            layout={baseLayout({ margin: { l: 96, r: 40, t: 8, b: 40 }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("% vs normal"), zeroline: true } })} />
        </Card>
        <Card title="Estimated scarcity risk by division" subtitle="Level 0–4 (Low → Extremely high); ordered by level, then dry-season stress ratio">
          <Plot filename="risk-divisions" ariaLabel="Estimated scarcity risk level by division" height={300} tableKeyLabel="Division"
            data={[{ type: "bar", orientation: "h", x: byRisk.map((r) => r.risk.level + 1), y: byRisk.map((r) => r.name),
                     marker: { color: byRisk.map((r) => riskColor(r.risk.level)) }, text: byRisk.map((r) => r.risk.label),
                     textposition: "inside", insidetextanchor: "start", hovertemplate: "%{y}: %{text}<extra></extra>", name: "Risk level" }]}
            layout={baseLayout({ margin: { l: 96, r: 16, t: 8, b: 40 }, xaxis: { ...(baseLayout().xaxis as object), range: [0, 5],
              tickvals: [1, 2, 3, 4, 5], ticktext: [...RISK_LABELS], title: axisTitle("estimated risk class") } })} />
          <div className="mt-1 flex flex-wrap gap-1.5">{byRisk.map((r) => <RiskPill key={r.id} label={`${r.name}: ${r.risk.label}`} level={r.risk.level} />)}</div>
        </Card>
      </div>
      <Side rows={rows} a={rows.some((r) => r.id === a) ? a : "rajshahi"} b={b} setA={setA} setB={setB} />
    </div>
  );
}
