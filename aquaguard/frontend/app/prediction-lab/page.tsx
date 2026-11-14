"use client";
import { useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SECTOR_COLOR, SERIES } from "@/components/charts/theme";
import { Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { KpiCard, MeasureText } from "@/components/ui/MeasureView";
import { MeasureBadge, ProvenanceBadge } from "@/components/ui/Provenance";
import { RiskPill, RiskRule } from "@/components/ui/Risk";
import { Async, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { useRegionScenario } from "@/lib/store/hooks";
import type { DemandResponse, GroundwaterResponse, MetricsResponse, ScarcityResponse, ShapResponse } from "@/lib/types/contract";

const MODEL_LABEL: Record<string, string> = { climatology: "Climatology (baseline)", persistence: "Persistence (baseline)", random_forest: "Random Forest", xgboost: "XGBoost" };

function ScarcityCharts({ s }: { s: ScarcityResponse }) {
  const hx = s.history.points.map((p) => p.t);
  const fc = s.forecast;
  const tx = s.test.map((p) => p.t);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Climatic water balance: history + forecast" subtitle={`P − ET0, mm/month · forecast ${fc ? `for ${fc.targetMonth}` : "unavailable"} with 90% interval`}
        actions={<span className="flex gap-1"><ProvenanceBadge p="historical" small /><ProvenanceBadge p={fc?.value.provenance ?? "predicted"} small /></span>}>
        <Plot filename="scarcity-forecast" ariaLabel="Historical climatic water balance and forecast with interval" height={300}
          data={[
            { type: "scatter", mode: "lines", name: "Historical (ERA5)", x: hx, y: s.history.points.map((p) => p.v.value), line: { color: NEUTRAL.reference, width: 2 }, hovertemplate: "%{y:.0f} mm" },
            ...(fc ? [{
              type: "scatter", mode: "markers", name: fc.value.provenance === "simulated" ? "Simulated forecast" : `Forecast (${s.horizon}-month)`,
              x: [fc.targetMonth], y: [fc.value.value],
              error_y: { type: "data", symmetric: false, array: [(fc.value.uncertainty?.high ?? 0) - (fc.value.value ?? 0)], arrayminus: [(fc.value.value ?? 0) - (fc.value.uncertainty?.low ?? 0)], color: SERIES[0], thickness: 2, width: 6 },
              marker: { color: SERIES[0], size: 11, line: { color: "#fff", width: 2 } }, hovertemplate: "%{y:.0f} mm",
            }, {
              type: "scatter", mode: "markers", name: "Normal for that month", x: [fc.targetMonth], y: [fc.normal.value],
              marker: { color: "#fff", size: 9, line: { color: NEUTRAL.reference, width: 2 } }, hovertemplate: "%{y:.0f} mm",
            }] : []),
          ]}
          layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("P − ET0 (mm/month)") }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("Month") } })} />
      </Card>
      <Card title="Actual vs predicted on the held-out test period" subtitle={`${tx[0] ?? ""} to ${tx.at(-1) ?? ""} · ${s.horizon}-month horizon · never seen in training`}
        actions={<span className="flex gap-1"><ProvenanceBadge p="historical" small /><ProvenanceBadge p="predicted" small /></span>}>
        <Plot filename="actual-vs-predicted" ariaLabel="Actual versus predicted climatic water balance on the test period" height={300}
          data={[
            { type: "scatter", mode: "lines", x: tx, y: s.test.map((p) => p.predicted.uncertainty?.high), line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
            { type: "scatter", mode: "lines", name: "90% interval", x: tx, y: s.test.map((p) => p.predicted.uncertainty?.low), fill: "tonexty", fillcolor: NEUTRAL.band, line: { width: 0 }, hoverinfo: "skip" },
            { type: "scatter", mode: "lines", name: "Actual (ERA5)", x: tx, y: s.test.map((p) => p.actual.value), line: { color: NEUTRAL.reference, width: 2 }, hovertemplate: "%{y:.0f} mm" },
            { type: "scatter", mode: "lines", name: "Predicted", x: tx, y: s.test.map((p) => p.predicted.value), line: { color: SERIES[0], width: 2 }, hovertemplate: "%{y:.0f} mm" },
          ]}
          layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("P − ET0 (mm/month)") } })} />
      </Card>
    </div>
  );
}

function MetricsPanel({ m, horizon }: { m: MetricsResponse; horizon: number }) {
  if (!m.evaluated || !m.metrics) {
    return <Card title="Model evaluation"><EmptyState title="Not evaluated yet">No metrics.json was found. Run <code>make ml</code> to train, evaluate and explain the models.</EmptyState></Card>;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = (m.metrics as any).horizons[String(horizon)];
  if (!h) return null;
  const reg = h.regression as Record<string, { mae: number; rmse: number; r2: number }>;
  const cls = h.classification;
  return (
    <Card title="Model evaluation (test period)" subtitle={`${h.testPeriod} · ${h.samples} samples · selected: ${MODEL_LABEL[h.selectedModel]} (lowest validation RMSE) · read from ml/artifacts/metrics.json`}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
        <table className="w-full min-w-[460px] text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr className="border-b border-border"><th className="py-1.5 font-medium">Model</th><th className="text-right font-medium">MAE (mm)</th><th className="text-right font-medium">RMSE (mm)</th><th className="text-right font-medium">R²</th></tr>
          </thead>
          <tbody>
            {Object.entries(reg).map(([k, v]) => (
              <tr key={k} className={`border-b border-border/60 ${k === h.selectedModel ? "bg-primary-soft font-medium" : ""}`}>
                <td className="py-1.5">{MODEL_LABEL[k] ?? k}</td>
                <td className="text-right tabular-nums">{v.mae.toFixed(1)}</td>
                <td className="text-right tabular-nums">{v.rmse.toFixed(1)}</td>
                <td className="text-right tabular-nums">{v.r2.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="text-[12.5px]">
          <div className="font-medium">Dryness classes</div>
          <div>Macro-F1: {cls.macroF1.toFixed(3)} (climatology baseline {cls.macroF1Climatology.toFixed(3)})</div>
          <div>90% interval test coverage: {(h.interval.testCoverage * 100).toFixed(1)}%</div>
          <p className="mt-1 text-muted">{cls.confusionAxes}</p>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="text-[11.5px]">
            <thead><tr><th />{cls.classes.map((c: string) => <th key={c} className="px-1 text-muted font-medium">{c.split(" ")[0]}</th>)}</tr></thead>
            <tbody>
              {cls.confusionMatrix.map((row: number[], i: number) => (
                <tr key={i}><th className="pr-1 text-left font-medium text-muted">{cls.classes[i].split(" ")[0]}</th>
                  {row.map((v, j) => <td key={j} className={`px-2 text-center tabular-nums ${i === j ? "font-semibold text-primary" : ""}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function ShapPanel({ sh }: { sh: ShapResponse }) {
  if (!sh.available) return <Card title="Explainability (SHAP)"><EmptyState title="SHAP not computed yet">{sh.localNote}</EmptyState></Card>;
  const g = [...sh.globalImportance].reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const local = sh.local as any;
  const contribs = local ? [...local.contributions].reverse() : [];
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Global feature importance" subtitle="Mean |SHAP value| on test-period rows (mm/month)" actions={<ProvenanceBadge p="predicted" small />}>
        <Plot filename="shap-global" ariaLabel="SHAP global feature importance" height={340}
          data={[{ type: "bar", orientation: "h", y: g.map((x) => x.label), x: g.map((x) => x.meanAbsShap), marker: { color: SERIES[0] }, hovertemplate: "%{x:.1f} mm<extra></extra>" }]}
          layout={baseLayout({ showlegend: false, hovermode: "closest", margin: { l: 210, r: 16, t: 4, b: 40 }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("mean |SHAP| (mm/month)") } })} />
      </Card>
      <Card title="Why this forecast? (local explanation)" subtitle={sh.localNote} actions={<ProvenanceBadge p="predicted" small />}>
        {local ? (
          <>
            <Plot filename="shap-local" ariaLabel="SHAP contributions for the selected division's latest forecast" height={300}
              data={[{ type: "bar", orientation: "h", y: contribs.map((c: { label: string }) => c.label), x: contribs.map((c: { shap: number }) => c.shap),
                marker: { color: contribs.map((c: { shap: number }) => (c.shap >= 0 ? SERIES[0] : SERIES[1])) }, hovertemplate: "%{x:+.1f} mm<extra></extra>" }]}
              layout={baseLayout({ showlegend: false, hovermode: "closest", margin: { l: 210, r: 16, t: 4, b: 40 }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("contribution to forecast (mm/month)") } })} />
            <p className="text-[12px] text-muted">Base value {local.baseValue.toFixed(1)} mm + contributions = prediction {local.prediction.toFixed(1)} mm (baseline forecast). Teal pushes wetter, orange drier.</p>
          </>
        ) : (
          <EmptyState title="Select a division">{sh.localNote}</EmptyState>
        )}
      </Card>
    </div>
  );
}

function Scarcity({ horizon }: { horizon: number }) {
  const { region, scenario, key } = useRegionScenario();
  const s = useApi(`scarcity|${horizon}|${key}`, () => api.scarcity(region, horizon, scenario));
  const met = useApi("metrics", api.metrics);
  const sh = useApi(`shap|${region}|${horizon}`, () => api.shap(region, horizon));
  return (
    <Async state={s} rows={3} label="Loading scarcity forecast">
      {(d) => !d.available ? <EmptyState title="Forecasts not available">{d.summary}</EmptyState> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.allHorizons.map((f) => (
              <KpiCard key={f.horizon} label={`${f.horizon}-month forecast · ${f.targetMonth}`} m={f.value} intervalLabel="90% interval"
                hint={<span>normal {fmtMeasure(f.normal)} · z {fmtMeasure(f.z)} · {f.drynessClass}</span>} />
            ))}
            <KpiCard label="Scarcity risk class">
              {d.risk && <><div className="py-1"><RiskPill label={d.risk.label} level={d.risk.level} /></div><RiskRule risk={d.risk} /></>}
            </KpiCard>
          </div>
          <Card title="Summary">
            <p className="text-[14px] leading-relaxed">{d.summary}</p>
            <p className="mt-2 text-[12px] text-muted">
              Model: {MODEL_LABEL[String(d.model.selected)] ?? "—"} · trained {String(d.model.trainedAt ?? "—").slice(0, 16).replace("T", " ")} UTC · data {String(d.model.dataPeriod)} ·
              train/validation/test samples {String(d.model.trainSamples)}/{String(d.model.validationSamples)}/{String(d.model.testSamples)} · split: {String(d.model.split)}
              {d.model.aggregation ? ` · ${String(d.model.aggregation)}` : ""}
            </p>
          </Card>
          <ScarcityCharts s={d} />
          <Async state={met} rows={2}>{(m) => <MetricsPanel m={m} horizon={horizon} />}</Async>
          <Async state={sh} rows={2}>{(x) => <ShapPanel sh={x} />}</Async>
          <Note>
            <strong>Limitations.</strong> {d.limitations.join(" ")}
          </Note>
        </div>
      )}
    </Async>
  );
}

function Demand() {
  const { region, scenario, key } = useRegionScenario();
  const s = useApi(`demand|${key}`, () => api.demand(region, scenario));
  return (
    <Async state={s} rows={2} label="Loading demand projection">
      {(d: DemandResponse) => {
        const yrs = d.years.map((y) => String(y.year));
        const sectors = ["agriculture", "domestic", "industry"] as const;
        return (
          <div className="space-y-5">
            <Card title="Water demand projection by sector" subtitle="Transparent projection, not an ML forecast" actions={<MeasureBadge m={d.years[0]?.total} small />}>
              <Plot filename="demand-projection" ariaLabel="Projected annual water demand by sector" height={320}
                data={sectors.map((k) => ({ type: "bar", name: k[0].toUpperCase() + k.slice(1), x: yrs, y: d.years.map((y) => y[k].value), marker: { color: SECTOR_COLOR[k], line: { color: "#fff", width: 2 } }, hovertemplate: "%{y:,.0f} MCM" }))}
                layout={baseLayout({ barmode: "stack", yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("MCM per year") }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("Year"), type: "category" } })} />
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
                <table className="mt-2 w-full min-w-[520px] text-[12.5px]">
                  <thead className="text-left text-muted"><tr className="border-b border-border"><th className="py-1 font-medium">Year</th><th className="text-right font-medium">Population</th><th className="text-right font-medium">Domestic</th><th className="text-right font-medium">Total (MCM)</th></tr></thead>
                  <tbody>{d.years.map((y) => (
                    <tr key={y.year} className="border-b border-border/60"><td className="py-1">{y.year}</td><td className="text-right tabular-nums">{fmtMeasure(y.population)}</td><td className="text-right tabular-nums">{fmtMeasure(y.domestic)}</td><td className="text-right tabular-nums">{fmtMeasure(y.total)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
            <Note><strong>Method.</strong> {d.method} {d.limitations.join(" ")}</Note>
          </div>
        );
      }}
    </Async>
  );
}

function Groundwater() {
  const { region } = useRegionScenario();
  const s = useApi(`gw|${region}`, () => api.groundwater(region));
  return (
    <Async state={s} rows={2} label="Loading GRACE series">
      {(g: GroundwaterResponse) => !g.available ? (
        <EmptyState title="GRACE data not loaded">{g.instructions}</EmptyState>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard label="Storage trend (seasonal cycle removed)" m={g.trend} digits={2} intervalLabel="95% CI" hint={<span>regional, not well depth</span>} />
            <KpiCard label="Latest monthly anomaly" m={g.series?.points.at(-1)?.v} hint={<span>{g.series?.points.at(-1)?.t}</span>} />
            <KpiCard label="Months of data" hint={<span>{g.series?.points[0]?.t} to {g.series?.points.at(-1)?.t}</span>}>
              <div className="text-[28px] font-semibold tabular-nums">{g.series?.points.length}</div>
            </KpiCard>
          </div>
          <Card title="Terrestrial water storage anomaly over Bangladesh" subtitle={g.note}
            actions={<span className="flex gap-1"><ProvenanceBadge p="historical" small /><ProvenanceBadge p="predicted" small /></span>}>
            <Plot filename="grace-storage" ariaLabel="GRACE terrestrial water storage anomaly with deseasonalised series and projection" height={340}
              data={[
                { type: "scatter", mode: "lines", name: "Monthly anomaly", x: g.series!.points.map((p) => p.t), y: g.series!.points.map((p) => p.v.value), line: { color: "#CBD5E1", width: 1.5 }, hovertemplate: "%{y:.1f} cm" },
                { type: "scatter", mode: "lines", name: "Seasonal cycle removed", x: g.deseasonalised!.points.map((p) => p.t), y: g.deseasonalised!.points.map((p) => p.v.value), line: { color: SERIES[0], width: 2 }, hovertemplate: "%{y:.1f} cm" },
                { type: "scatter", mode: "lines", x: g.projection!.points.map((p) => p.t), y: g.projection!.points.map((p) => p.v.uncertainty?.high), line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
                { type: "scatter", mode: "lines", name: "Projection 95% interval (Predicted)", x: g.projection!.points.map((p) => p.t), y: g.projection!.points.map((p) => p.v.uncertainty?.low), fill: "tonexty", fillcolor: "rgba(98,80,214,0.12)", line: { width: 0 }, hoverinfo: "skip" },
                { type: "scatter", mode: "lines", name: "12-month projection", x: g.projection!.points.map((p) => p.t), y: g.projection!.points.map((p) => p.v.value), line: { color: SERIES[4], width: 2, dash: "dash" }, hovertemplate: "%{y:.1f} cm" },
              ]}
              layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("Equivalent water height anomaly (cm)") }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("Month (gap 2017–2018 between missions)") } })} />
            <p className="mt-2 text-[12px] text-muted">{g.method}</p>
          </Card>
          <Note>Trend: <MeasureText m={g.trend} digits={3} />. {g.note}</Note>
        </div>
      )}
    </Async>
  );
}

export default function PredictionLab() {
  const [tab, setTab] = useState<"scarcity" | "demand" | "groundwater">("scarcity");
  const [horizon, setHorizon] = useState(1);
  return (
    <div className="space-y-5">
      <PageHeader title="AI Water Prediction Lab" description="Scarcity is forecast as the climatic water balance D = P − ET0 (a measurable quantity), tested on years the model never saw and shown beside simple baselines.">
        <div className="flex flex-wrap gap-2">
          <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "scarcity", label: "Scarcity" }, { value: "demand", label: "Demand" }, { value: "groundwater", label: "Groundwater" }]} />
          {tab === "scarcity" && <Segmented label="Forecast horizon" value={horizon} onChange={setHorizon} options={[{ value: 1, label: "1 mo" }, { value: 3, label: "3 mo" }, { value: 6, label: "6 mo" }]} />}
        </div>
      </PageHeader>
      {tab === "scarcity" && <Scarcity horizon={horizon} />}
      {tab === "demand" && <Demand />}
      {tab === "groundwater" && <Groundwater />}
    </div>
  );
}
