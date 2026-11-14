"use client";
/** Results tab, the KPI bar under the scene and the legend. All values are the engine's (conceptual) answer. */
import type { ReactNode } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, SERIES } from "@/components/charts/theme";
import { fmtMeasure } from "@/lib/format";
import { accounting, balanceStatus, DEST_STATUS, fmt, LIMIT_TEXT, num } from "@/lib/flow/derive";
import { DEST_LABEL, type DestId } from "@/lib/flow/network";
import type { FlowResponse, FlowState } from "@/lib/types/contract";
import { StatusPill, StatusText } from "./Status";

const SAVING_LABEL: Record<string, string> = {
  leakReduction: "Leakage avoided", lossPctReduction: "Loss reduction", deliveredGain: "Extra delivered",
  setpointReduction: "Set-point lowered by",
};

function Kpi({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-white px-3 py-2" data-testid={testId}>
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-[17px] font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

export function KpiBar({ state }: { state: FlowState }) {
  const a = accounting(state);
  const bal = balanceStatus(state);
  const leakPct = a.inflow && a.leakage !== null ? (a.leakage / a.inflow) * 100 : null;
  const gap = num(state.supplyBalanceDaily);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Key results (conceptual simulation)" role="group">
      <Kpi label="Total inflow" value={`${fmt(a.inflow)} m³/day`} sub="pumped into the network" testId="kpi-inflow" />
      <Kpi label="Delivered (outflow)" value={`${fmt(a.delivered)} m³/day`} sub="reaching the four zones" testId="kpi-delivered" />
      <Kpi label="Leakage" value={`${fmt(a.leakage)} m³/day`} sub={leakPct === null ? "no flow" : `${fmt(leakPct, 1)} % of inflow`} testId="kpi-leakage" />
      <Kpi label="Water balance" value={<StatusText status={bal} />} testId="kpi-balance"
           sub={gap === null ? "supply vs demand" : `${gap >= 0 ? "+" : "−"}${fmt(Math.abs(gap))} m³/day vs demand`} />
      <Kpi label="Efficiency" value={num(state.efficiency) === null ? "—" : `${fmt(num(state.efficiency), 1)} %`} sub="delivered ÷ inflow" testId="kpi-efficiency" />
      <Kpi label="Pump utilization" value={`${fmt(num(state.pumpUtilization), 1)} %`} sub="flow ÷ capacity" testId="kpi-pump" />
      <p className="col-span-full text-[11.5px] text-muted">
        Supply vs demand: {gap === null ? "—" : gap >= 0 ? `${fmt(gap)} m³/day above` : `${fmt(-gap)} m³/day below`} the
        hypothetical demand of {fmt(num(state.demandDaily))} m³/day. {state.limitingFactor ? LIMIT_TEXT[state.limitingFactor] : ""}
        {" "}All values: conceptual simulation (data kind “conceptual”), not measurements.
      </p>
    </div>
  );
}

export function Legend() {
  const line = (color: string, dashed = false) => (
    <svg width="26" height="10" aria-hidden className="shrink-0"><line x1="1" y1="5" x2="25" y2="5" stroke={color} strokeWidth="4"
      strokeLinecap="round" strokeDasharray={dashed ? "4 4" : undefined} /></svg>
  );
  const items: [ReactNode, string][] = [
    [line("#1E40AF"), "Main pipeline (trunk)"],
    [line("#0284C7"), "Branch pipeline"],
    [line("#64748B"), "Intake (illustrative)"],
    [line("#9CA3AF", true), "Closed valve (grey, no flow)"],
    [<span key="p" className="h-2.5 w-2.5 shrink-0 rounded-full border border-[#0284C7] bg-[#E0F7FF]" aria-hidden />, "Flow particles (speed ∝ velocity)"],
    [<span key="a" aria-hidden className="text-[12px] leading-none text-[#1E3A8A]">▲</span>, "Flow direction"],
    [<span key="l" aria-hidden className="h-3 w-3 shrink-0 rounded-full border-2 border-[#DC2626]" />, "⚠ Leak (red ring + value)"],
    [<span key="s" aria-hidden className="h-3 w-3 shrink-0 rounded-full border-2 border-[#F59E0B]" />, "Selected (amber ring)"],
    [<span key="h" aria-hidden className="h-3 w-3 shrink-0 rounded-full border-2 border-[#38BDF8]" />, "Hovered (sky ring)"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted" aria-label="Legend" role="group">
      {items.map(([icon, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">{icon}{label}</span>
      ))}
      <span className="inline-flex items-center gap-1.5">Zone status: <StatusText status={DEST_STATUS.served} /> ·
        <StatusText status={DEST_STATUS.under_supplied} /> · <StatusText status={DEST_STATUS.no_supply} /></span>
    </div>
  );
}

function CompareTable({ before, after }: { before: FlowState; after?: FlowState | null }) {
  const rows: [string, (s: FlowState) => Parameters<typeof fmtMeasure>[0]][] = [
    ["Pump set-point", (s) => s.setpoint],
    ["Pump flow", (s) => s.pumpFlow],
    ["Delivered (total)", (s) => s.deliveredTotal],
    ["Leakage (total)", (s) => s.leakTotal],
    ["Water loss", (s) => s.lossPct],
    ["Mass-balance error", (s) => s.massBalanceError],
  ];
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-muted"><tr className="border-b border-border"><th className="py-1 font-medium">Result</th>
        <th className="text-right font-medium">Current</th>{after && <th className="text-right font-medium">Optimized</th>}</tr></thead>
      <tbody>
        {rows.map(([label, f]) => (
          <tr key={label} className="border-b border-border/60">
            <td className="py-1">{label}</td>
            <td className="text-right tabular-nums">{fmtMeasure(f(before))}</td>
            {after && <td className="text-right font-medium tabular-nums text-primary">{fmtMeasure(f(after))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResultsPanel({ state, res }: { state: FlowState; res: FlowResponse | null }) {
  const a = accounting(state);
  const bal = balanceStatus(state);
  const ids = state.destinations.map((d) => d.id as DestId);
  return (
    <div className="space-y-4">
      <section aria-labelledby="flow-identity">
        <h3 id="flow-identity" className="mb-1.5 text-[13px] font-semibold text-ink">Water balance (network boundary)</h3>
        <table className="w-full text-[12.5px]">
          <tbody>
            <tr className="border-b border-border/60"><th scope="row" className="py-1 text-left font-medium">Total inflow (pump)</th><td className="text-right tabular-nums">{fmt(a.inflow)} m³/day</td></tr>
            <tr className="border-b border-border/60"><th scope="row" className="py-1 text-left font-normal">= Delivered to zones</th><td className="text-right tabular-nums">{fmt(a.delivered)} m³/day</td></tr>
            <tr className="border-b border-border/60"><th scope="row" className="py-1 text-left font-normal">+ Leakage</th><td className="text-right tabular-nums">{fmt(a.leakage)} m³/day</td></tr>
            <tr className="border-b border-border/60"><th scope="row" className="py-1 text-left font-normal">+ Storage change</th><td className="text-right text-muted">Not modelled (steady state)</td></tr>
            <tr><th scope="row" className="py-1 text-left font-normal">+ Other / unaccounted</th><td className="text-right tabular-nums">{a.residual === null ? "—" : `${fmt(Math.abs(a.residual) < 0.5 ? 0 : a.residual)} m³/day`}</td></tr>
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <StatusPill status={bal} />
          <span className="text-muted">{a.valid ? "The identity closes; status compares supply with the hypothetical demand." : "The identity does not close: results are not valid."}</span>
        </div>
      </section>

      <section aria-labelledby="flow-zones">
        <h3 id="flow-zones" className="mb-1.5 text-[13px] font-semibold text-ink">Allocation and delivery by zone</h3>
        <ul className="divide-y divide-border/70 text-[12.5px]" data-testid="zone-results">
          {state.destinations.map((d) => (
            <li key={d.id} className="py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="font-medium text-ink">{DEST_LABEL[d.id as DestId] ?? d.id}</span>
                <StatusText status={DEST_STATUS[d.status] ?? { label: d.status, tone: "off" }} className="text-[12px]" />
              </div>
              <div className="text-[12px] text-muted">
                Delivered <span className="tabular-nums text-ink">{fmt(num(d.deliveredDaily))}</span> of{" "}
                <span className="tabular-nums">{fmt(num(d.demandDaily))}</span> m³/day demand
                {num(d.supply) !== null && <> ({fmt(num(d.supply), 1)} %)</>} · share {fmt(num(d.share), 1)} %
                (<span className="tabular-nums">{fmt(num(d.allocatedDaily))}</span> m³/day allocated)
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11.5px] text-muted">Demand is hypothetical; supply = delivered ÷ demand.</p>
      </section>

      <Plot filename="flow-zones" ariaLabel="Hypothetical demand and simulated delivery per zone" height={230}
        data={[
          { type: "bar", name: "Demand (hypothetical)", x: ids.map((i) => DEST_LABEL[i]), y: state.destinations.map((d) => num(d.demandDaily)), marker: { color: SERIES[1] }, hovertemplate: "%{y:,.0f} m³/day<extra>Demand</extra>" },
          { type: "bar", name: "Delivered (simulated)", x: ids.map((i) => DEST_LABEL[i]), y: state.destinations.map((d) => num(d.deliveredDaily)), marker: { color: SERIES[0] }, hovertemplate: "%{y:,.0f} m³/day<extra>Delivered</extra>" },
        ]}
        layout={baseLayout({ barmode: "group", bargap: 0.3, bargroupgap: 0.08, margin: { l: 52, r: 8, t: 8, b: 40 },
          legend: { orientation: "h", y: -0.25 }, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("m³/day") } })} />

      {res && (
        <section aria-labelledby="flow-compare">
          <h3 id="flow-compare" className="mb-1.5 text-[13px] font-semibold text-ink">Current{res.optimized ? " vs optimized" : ""}</h3>
          <p className="mb-1 text-[11.5px] text-muted">{res.optimizationNote ?? "Steady-state solution"}</p>
          <CompareTable before={res.state} after={res.optimized} />
          {res.savings && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
              {Object.entries(res.savings).map(([k, m]) => (
                <div key={k} className="rounded-lg bg-primary-soft p-2">
                  <div className="text-muted">{SAVING_LABEL[k] ?? k}</div>
                  <div className="font-semibold text-ink">{fmtMeasure(m)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
