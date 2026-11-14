"use client";
/**
 * Time Series: annual rainfall and temperature (complete years only) with their linear trends, the last 36 months
 * against the 1991–2020 normal, the national GRACE series with its gaps, and a two-period comparison. Missing values
 * stay missing (gaps in the charts, listed years in the comparison).
 */
import { useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SERIES } from "@/components/charts/theme";
import { Button, Card } from "@/components/ui/Card";
import { DataStatusBadge, fromMeta } from "@/components/ui/DataStatus";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { num, signed, validRange } from "@/lib/explorer/analysis";
import type { ExplorerSeries, PeriodComparison } from "@/lib/types/contract";

type Trend = ExplorerSeries["rainTrend"];

function trendLine(t: Trend, years: number[], values: (number | null)[]) {
  if (!t) return null;
  const pts = years.map((y, i) => [y, values[i]] as const).filter(([, v]) => v !== null) as [number, number][];
  if (pts.length < 2) return null;
  const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
  const my = pts.reduce((s, [, v]) => s + v, 0) / pts.length;
  const slope = t.slope / 10;
  return { x: [t.start, t.end], y: [my + slope * (t.start - mx), my + slope * (t.end - mx)] };
}

function trendText(t: Trend, unit: string, digits: number) {
  if (!t) return "Too few complete years for a trend.";
  return `${signed(t.slope, digits)} ${unit} per decade (95% interval ${num(t.low, digits)} to ${num(t.high, digits)}), ${t.start}–${t.end}, ${t.n} complete years — ${t.clear ? "the interval excludes zero" : "no clear trend: the interval includes zero"}. Describes change, not its cause.`;
}

function Compare({ region }: { region: string }) {
  const [a, setA] = useState("1991-2000");
  const [b, setB] = useState("2016-2025");
  const [q, setQ] = useState<{ a: string; b: string } | null>({ a: "1991-2000", b: "2016-2025" });
  const errA = validRange(a);
  const errB = validRange(b);
  const res = useApi(q ? `compare|${region}|${q.a}|${q.b}` : null, () => api.comparePeriods(region, q!.a, q!.b));
  const d: PeriodComparison | undefined = res.data?.data;
  const rows: [string, (p: PeriodComparison["a"]) => string, string][] = d ? [
    ["Mean annual rainfall", (p) => `${num(p.rain)} mm`, d.change.rain === null ? "—" : `${signed(d.change.rain)} mm (${signed(d.change.rainPct, 1, "%")})`],
    ["Mean temperature", (p) => `${num(p.tmean, 2)} °C`, signed(d.change.tmean, 2, " °C")],
    ["Annual P − ET0", (p) => `${num(p.pet)} mm`, d.change.pet === null ? "—" : `${signed(d.change.pet)} mm`],
    ["GRACE mean anomaly (national)", (p) => (p.grace === null ? `no data (${p.graceMonths} months)` : `${signed(p.grace, 1, " cm")} (${p.graceMonths}/${p.graceMonthsExpected} months)`),
     d.change.grace === null ? "—" : signed(d.change.grace, 1, " cm")],
    ["Complete years", (p) => `${p.yearsComplete} of ${p.yearsExpected}${p.missingYears.length ? ` (missing ${p.missingYears.join(", ")})` : ""}`, ""],
  ] : [];
  return (
    <Card title="Compare two periods" subtitle="Mean annual values; complete years only, nothing interpolated">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!errA && !errB) setQ({ a, b }); }}>
        <label className="flex flex-col text-[12px] text-muted">Period A
          <input value={a} onChange={(e) => setA(e.target.value)} aria-invalid={!!errA} className="mt-0.5 w-32 rounded-lg border border-control px-2 py-1 text-[13px] text-ink" />
        </label>
        <label className="flex flex-col text-[12px] text-muted">Period B
          <input value={b} onChange={(e) => setB(e.target.value)} aria-invalid={!!errB} className="mt-0.5 w-32 rounded-lg border border-control px-2 py-1 text-[13px] text-ink" />
        </label>
        <Button type="submit" disabled={!!errA || !!errB}>Compare</Button>
        {(errA || errB) && <p role="alert" className="w-full text-[12px] text-[#b42318]">{errA ? `Period A: ${errA}` : `Period B: ${errB}`}</p>}
      </form>
      {res.error && <p className="mt-2 text-[12.5px] text-[#b42318]">Comparison unavailable: {res.error.message}</p>}
      {res.loading && <Skeleton className="mt-3 h-24 w-full" />}
      {d && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]" data-testid="period-compare">
            <thead className="text-left text-muted"><tr className="border-b border-border">
              <th className="py-1 font-medium">Indicator ({d.region.name})</th><th className="text-right font-medium">{d.a.start}–{d.a.end}</th>
              <th className="text-right font-medium">{d.b.start}–{d.b.end}</th><th className="text-right font-medium">Change (B − A)</th></tr></thead>
            <tbody>
              {rows.map(([label, f, ch]) => (
                <tr key={label} className="border-b border-border/60">
                  <th scope="row" className="py-1 text-left font-normal">{label}</th>
                  <td className="text-right tabular-nums">{f(d.a)}</td><td className="text-right tabular-nums">{f(d.b)}</td>
                  <td className="text-right tabular-nums">{ch}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}

export function SeriesView({ region, regionName }: { region: string; regionName: string }) {
  const s = useApi(`explorer-series|${region}`, () => api.explorerSeries(region));
  if (s.error) return <ErrorCard error={s.error} onRetry={s.retry} title="Time series unavailable" />;
  if (!s.data) return <Skeleton className="h-[480px] w-full" />;
  const d = s.data.data;
  const full = d.annual.filter((y) => y.complete);
  const years = full.map((y) => y.year);
  const rainTl = trendLine(d.rainTrend, years, full.map((y) => y.rain));
  const tempTl = trendLine(d.tempTrend, years, full.map((y) => y.tmean));
  const recent = d.monthly.filter((m) => m.complete).slice(-36);
  const partial = d.annual.filter((y) => !y.complete).map((y) => y.year);
  const graceMissing = d.grace.filter((g) => g.v === null).length;
  return (
    <div className="space-y-4" data-testid="series-view">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <span>Weather series for <b className="text-ink">{regionName}</b>{region === "bd" ? " (area-weighted mean of 8 points)" : " (representative point)"} · GRACE always national.</span>
        <DataStatusBadge info={fromMeta(s.data.meta)} compact />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Annual rainfall" subtitle={trendText(d.rainTrend, "mm", 0)}>
          <Plot filename={`rainfall-annual-${region}`} ariaLabel={`Annual rainfall, ${regionName}`} height={260}
            data={[
              { type: "bar", name: "Annual rainfall", x: years, y: full.map((y) => y.rain), marker: { color: SERIES[0] }, hovertemplate: "%{x}: %{y:,.0f} mm<extra></extra>" },
              ...(rainTl ? [{ type: "scatter", mode: "lines", name: "Linear trend", x: rainTl.x, y: rainTl.y, line: { color: SERIES[1], width: 2, dash: "dash" }, hoverinfo: "skip" }] : []),
            ]}
            layout={baseLayout({ showlegend: true, legend: { orientation: "h", y: -0.2 }, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("mm") } })} />
          {partial.length > 0 && <p className="text-[11.5px] text-muted">Left out (incomplete): {partial.join(", ")}.</p>}
        </Card>
        <Card title="Annual mean temperature" subtitle={trendText(d.tempTrend, "°C", 2)}>
          <Plot filename={`temperature-annual-${region}`} ariaLabel={`Annual mean temperature, ${regionName}`} height={260}
            data={[
              { type: "scatter", mode: "lines+markers", name: "Annual mean", x: years, y: full.map((y) => y.tmean), line: { color: SERIES[2], width: 2 }, marker: { size: 5 }, hovertemplate: "%{x}: %{y:.2f} °C<extra></extra>" },
              ...(tempTl ? [{ type: "scatter", mode: "lines", name: "Linear trend", x: tempTl.x, y: tempTl.y, line: { color: SERIES[1], width: 2, dash: "dash" }, hoverinfo: "skip" }] : []),
            ]}
            layout={baseLayout({ showlegend: true, legend: { orientation: "h", y: -0.2 }, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("°C") } })} />
        </Card>
        <Card title="Monthly rainfall vs normal" subtitle="Last 36 complete months; normal = mean of the same month 1991–2020">
          <Plot filename={`rainfall-monthly-${region}`} ariaLabel={`Monthly rainfall and normal, ${regionName}`} height={260}
            data={[
              { type: "bar", name: "Rainfall", x: recent.map((m) => m.t), y: recent.map((m) => m.rain), marker: { color: SERIES[0] }, hovertemplate: "%{x}: %{y:,.0f} mm<extra></extra>" },
              { type: "scatter", mode: "lines", name: "1991–2020 normal", x: recent.map((m) => m.t), y: recent.map((m) => m.rainNormal), line: { color: NEUTRAL.reference, width: 2 }, hovertemplate: "%{x} normal: %{y:,.0f} mm<extra></extra>" },
            ]}
            layout={baseLayout({ showlegend: true, legend: { orientation: "h", y: -0.25 }, yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("mm") } })} />
        </Card>
        <Card title="GRACE water storage anomaly (national)"
              subtitle={`Monthly TWS anomaly vs 2004–2009; ${graceMissing} missing months shown as gaps (incl. the 2017–2018 mission gap). Trend ${d.graceTrendCmPerYr !== null ? `${signed(d.graceTrendCmPerYr, 2)} cm/yr` : "—"}.`}>
          {d.grace.length ? (
            <Plot filename="grace-national" ariaLabel="National GRACE terrestrial water storage anomaly" height={260}
              data={[{ type: "scatter", mode: "lines", name: "TWS anomaly", x: d.grace.map((g) => g.t), y: d.grace.map((g) => g.v), connectgaps: false,
                       line: { color: SERIES[3], width: 1.6 }, hovertemplate: "%{x}: %{y:.1f} cm<extra></extra>" }]}
              layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("cm water height") } })} />
          ) : <p className="text-[12.5px] text-muted">No GRACE data stored.</p>}
          <p className="text-[11.5px] text-muted">Regional (~300 km), total water storage, not a groundwater level. Uncertainty is not part of the stored product.</p>
        </Card>
      </div>
      <Compare region={region} />
    </div>
  );
}
