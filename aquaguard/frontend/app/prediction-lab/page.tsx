"use client";
/**
 * M5 Prediction Lab. The forecast section reads /api/predictions: the stored predictions (predictions_v2, issued
 * after each weather-archive sync by the stored models) or, before the first stored run, the training-time artifact.
 * Region comes from the header, category and horizon are selectable, and the section and horizon live in the URL.
 */
import { Database, FileJson, ListTree } from "lucide-react";
import { useEffect, useState } from "react";
import { DataTable, Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SECTOR_COLOR, SERIES } from "@/components/charts/theme";
import { Button, Card, Note, PageHeader, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, fromMeta } from "@/components/ui/DataStatus";
import { KpiCard, MeasureText } from "@/components/ui/MeasureView";
import { DetailDrawer } from "@/components/ui/Overlay";
import { MeasureBadge, ProvenanceBadge } from "@/components/ui/Provenance";
import { Async, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { fmtDateTime } from "@/lib/format/time";
import { featureRows } from "@/lib/ml/features";
import { useAppStore } from "@/lib/store";
import { useRegionScenario } from "@/lib/store/hooks";
import {
  BASELINE, type DemandResponse, type GroundwaterResponse, type Meta, type MetricsResponse, type PredictionPoint,
  type Predictions, type ScarcityResponse, type ShapResponse,
} from "@/lib/types/contract";

const MODEL_LABEL: Record<string, string> = { climatology: "Climatology (baseline)", persistence: "Persistence (baseline)", random_forest: "Random Forest", xgboost: "XGBoost" };

function TestPeriodChart({ s }: { s: ScarcityResponse }) {
  const tx = s.test.map((p) => p.t);
  if (!tx.length) return null;
  return (
    <Card title="Actual vs predicted on the held-out test period" subtitle={`${tx[0]} to ${tx.at(-1)} · ${s.horizon}-month horizon · never seen in training`}
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
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Model comparison table">
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
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Confusion matrix">
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
            <p className="text-[12px] text-muted">Base value {local.baseValue.toFixed(1)} mm + contributions = prediction {local.prediction.toFixed(1)} mm (training-time forecast). Blue pushes wetter, orange drier.</p>
          </>
        ) : (
          <EmptyState title="Select a division">{sh.localNote}</EmptyState>
        )}
      </Card>
    </div>
  );
}

const num = (v: unknown, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");

function ForecastChart({ d }: { d: Predictions }) {
  const ht = d.history.t;
  const hv = d.history.v;
  const lastT = ht.at(-1);
  const lastV = hv.at(-1) ?? null;
  const pts = d.allHorizons;
  const fx = [lastT, ...pts.map((p) => p.targetMonth)];
  const anchor = (k: (p: PredictionPoint) => number | null | undefined) => [lastV, ...pts.map(k)];
  return (
    <Plot filename={`water-balance-forecast-${d.region.id}`} height={320} tableKeyLabel="Month"
      ariaLabel={`Climatic water balance for ${d.region.name}: the last three years of ERA5 history and the 1, 3 and 6-month predictions with 90% intervals`}
      data={[
        { type: "scatter", mode: "lines", name: "History (ERA5)", x: ht, y: hv, line: { color: NEUTRAL.reference, width: 2 }, hovertemplate: "%{y:.0f} mm" },
        { type: "scatter", mode: "lines", name: "Upper 90%", x: fx, y: anchor((p) => p.value.uncertainty?.high), line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
        { type: "scatter", mode: "lines", name: "90% interval", x: fx, y: anchor((p) => p.value.uncertainty?.low), fill: "tonexty", fillcolor: NEUTRAL.band, line: { width: 0 }, hoverinfo: "skip" },
        // normals first, so the predicted markers are drawn on top of them
        { type: "scatter", mode: "markers", name: "Normal for that month", x: pts.map((p) => p.targetMonth), y: pts.map((p) => p.normal.value),
          marker: { color: "#fff", size: 9, line: { color: NEUTRAL.reference, width: 2 } }, hovertemplate: "%{y:.0f} mm" },
        { type: "scatter", mode: "lines+markers", name: "Predicted", x: fx, y: anchor((p) => p.value.value), line: { color: SERIES[0], width: 2, dash: "dot" },
          marker: { color: SERIES[0], size: [0, ...pts.map((p) => (p.horizon === d.horizon ? 12 : 9))], line: { color: "#fff", width: 2 } }, hovertemplate: "%{y:.0f} mm" },
      ]}
      layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("P − ET0 (mm/month)") }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("Month") } })} />
  );
}

function ModelCard({ d }: { d: Predictions }) {
  const m = d.model;
  const exp = m.experimental === "yes";
  const cov = typeof m.intervalCoverage === "number" ? m.intervalCoverage * 100 : null;
  const rows: [string, string][] = [
    ["Model", `${m.name ?? "—"} (${m.algorithm ?? "—"})`],
    ["Version", m.version ? `trained ${fmtDateTime(String(m.version))}` : "—"],
    ["Target", String(m.target ?? d.target)],
    ["Training data", String(m.trainingData ?? "—")],
    ["Data period", String(m.dataPeriod ?? "—")],
    ["Split", String(m.split ?? "—")],
    ["Samples (train / validation / test)", `${m.trainSamples ?? "—"} / ${m.validationSamples ?? "—"} / ${m.testSamples ?? "—"}`],
    [`Test RMSE (${m.testPeriod ?? "test period"})`, `${num(m.testRmse)} mm · climatology ${num(m.climatologyRmse)} mm · persistence ${num(m.persistenceRmse)} mm`],
    ["Test MAE · R²", `${num(m.testMae)} mm · ${num(m.testR2, 3)}`],
    ["90% interval coverage (test)", cov === null ? "—" : `${cov.toFixed(1)}%${cov < 90 ? " — below 90%: intervals are too narrow" : ""}`],
    ["Dryness classes (macro-F1)", `${num(m.macroF1, 3)} · climatology ${num(m.macroF1Climatology, 3)}`],
    ["Retraining", String(m.retraining ?? "—")],
  ];
  const noDryHits = typeof m.dryMonthsPredicted === "number" && m.dryMonthsPredicted === 0 && typeof m.dryMonthsInTest === "number" && m.dryMonthsInTest > 0;
  return (
    <Card title="Model card" subtitle={`${d.horizon}-month horizon`}
          actions={exp ? <span className="rounded-full border border-warning/50 bg-[#fff6e5] px-2 py-0.5 text-[12px] font-medium text-[#8a4b00]">Experimental · synthetic training data</span>
            : <span className="rounded-full border border-success/50 bg-[#e8f8f2] px-2 py-0.5 text-[12px] font-medium text-[#0f7a55]">Trained on real data</span>}>
      <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[220px_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {noDryHits && (
        <div className="mt-3">
          <Note tone="warn">
            In the test period the model predicted none of the {String(m.dryMonthsInTest)} dry months as dry (its dryness-class skill equals
            climatology). Read the predicted value and its interval; do not rely on the dryness class alone.
          </Note>
        </div>
      )}
    </Card>
  );
}

type Snapshot = {
  features?: Record<string, number | null>;
  issuedFrom?: string;
  source?: string;
  featureCode?: string;
  intervalMethod?: string;
};

function InputsDrawer({ p, open, onClose }: { p: PredictionPoint; open: boolean; onClose: () => void }) {
  const snap = (p.inputSnapshot ?? {}) as Snapshot;
  const rows = featureRows(snap.features ?? {});
  return (
    <DetailDrawer open={open} onClose={onClose} title={`Model inputs · ${p.horizon}-month prediction`} subtitle={`Issued from ${snap.issuedFrom ?? p.issuedMonth} for ${p.targetMonth}`}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Exact values stored with prediction #{p.predictionIds.join(", ")} (generated {p.generatedAt ? fmtDateTime(p.generatedAt) : "—"}).</p>
        <p className="text-[12.5px] text-muted">{snap.source} · features from {snap.featureCode}</p>
        <DataTable caption="Model input values" head={["Input", "Value", "Unit"]} maxHeight={420}
                   rows={rows.map((r) => [r.info.label, r.value === null ? null : Number(r.value.toFixed(3)), r.info.unit])} />
        <p className="text-[12px] text-muted">{snap.intervalMethod}</p>
      </div>
    </DetailDrawer>
  );
}

function StorageLine({ d, meta }: { d: Predictions; meta: Meta }) {
  const p = d.forecast;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted" data-testid="prediction-storage">
      <DataStatusBadge info={fromMeta(meta)} />
      {d.storage === "database" ? (
        <span className="inline-flex items-center gap-1"><Database size={13} aria-hidden /> Stored prediction · generated {p?.generatedAt ? fmtDateTime(p.generatedAt) : "—"} from weather through {p?.issuedMonth}</span>
      ) : (
        <span className="inline-flex items-center gap-1"><FileJson size={13} aria-hidden /> Training-time prediction file (no stored run yet) · issued from {p?.issuedMonth}</span>
      )}
      {d.aggregation && <span>· {d.aggregation}</span>}
    </div>
  );
}

function WaterBalanceForecast({ horizon }: { horizon: number }) {
  const region = useAppStore((s) => s.selectedRegion) || "bd";
  const [category, setCategory] = useState("water_balance");
  const [inputsOpen, setInputsOpen] = useState(false);
  const pr = useApi(`predictions|${region}|${horizon}|${category}`, () => api.predictions(region, horizon, category));
  const legacy = useApi(`scarcity|${horizon}|${region}|baseline`, () => api.scarcity(region, horizon, BASELINE));
  const met = useApi("metrics", api.metrics);
  const sh = useApi(`shap|${region}|${horizon}`, () => api.shap(region, horizon));
  return (
    <Async state={pr} rows={3} label="Loading predictions">
      {({ data: d, meta }) => (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="text-[12.5px]">
              <span className="mb-1 block font-medium">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-[13px]">
                {d.categories.map((c) => <option key={c.id} value={c.id} disabled={!c.available}>{c.label}{c.available ? "" : " — no model"}</option>)}
              </select>
            </label>
            <ul className="text-[12px] text-muted">
              {d.categories.filter((c) => !c.available).map((c) => <li key={c.id}>{c.label}: {c.reason}</li>)}
            </ul>
          </div>
          <StorageLine d={d} meta={meta} />
          {meta.note && <Note>{meta.note}</Note>}
          {!d.forecast ? <EmptyState title="No prediction available">No stored prediction or model artifact covers this region and horizon.</EmptyState> : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {d.allHorizons.map((f) => (
                  <KpiCard key={f.horizon} label={`${f.horizon}-month prediction · ${f.targetMonth}${f.horizon === d.horizon ? " (selected)" : ""}`} m={f.value} intervalLabel="90% interval"
                           accent={f.horizon === d.horizon ? SERIES[0] : undefined}
                           hint={<span>normal {fmtMeasure(f.normal)} · z {fmtMeasure(f.z)} · {f.drynessClass ?? "class unavailable"}</span>} />
                ))}
              </div>
              <Card title="History and prediction" subtitle={`${d.region.name} · P − ET0, mm/month · last three years of ERA5 and the 1, 3 and 6-month predictions with 90% intervals`}
                    actions={d.forecast.inputSnapshot ? <Button variant="secondary" onClick={() => setInputsOpen(true)}><ListTree size={14} aria-hidden /> View model inputs</Button> : undefined}>
                <ForecastChart d={d} />
                {!d.forecast.inputSnapshot && (
                  <p className="mt-2 text-[12px] text-muted">
                    {d.aggregation ? "Inputs are stored per division: select a division in the header to see the exact model inputs." : "Model inputs are shown for stored predictions only."}
                  </p>
                )}
              </Card>
              {d.forecast.inputSnapshot && <InputsDrawer p={d.forecast} open={inputsOpen} onClose={() => setInputsOpen(false)} />}
            </>
          )}
          <ModelCard d={d} />
          <Async state={legacy} rows={2}>{(x) => (x.available ? <TestPeriodChart s={x} /> : null)}</Async>
          <Async state={met} rows={2}>{(x) => <MetricsPanel m={x} horizon={horizon} />}</Async>
          <Async state={sh} rows={2}>{(x) => <ShapPanel sh={x} />}</Async>
          <Async state={legacy} rows={1}>{(x) => <Note><strong>Limitations.</strong> {x.limitations.join(" ")}</Note>}</Async>
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
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Demand projection table">
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

type Tab = "forecast" | "demand" | "groundwater";
const HORIZONS = [1, 3, 6] as const;

function readUrl(): { tab: Tab; horizon: number } {
  if (typeof window === "undefined") return { tab: "forecast", horizon: 1 };
  const p = new URLSearchParams(window.location.search);
  const t = p.get("tab");
  const h = Number(p.get("h"));
  return { tab: t === "demand" || t === "groundwater" ? t : "forecast", horizon: (HORIZONS as readonly number[]).includes(h) ? h : 1 };
}

function writeUrl(tab: Tab, horizon: number) {
  const p = new URLSearchParams(window.location.search);
  if (tab === "forecast") p.delete("tab"); else p.set("tab", tab);
  if (horizon === 1 || tab !== "forecast") p.delete("h"); else p.set("h", String(horizon));
  const qs = p.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}

export default function PredictionLab() {
  const [tab, setTabState] = useState<Tab>("forecast");
  const [horizon, setHorizonState] = useState(1);
  useEffect(() => {
    const u = readUrl();
    setTabState(u.tab);
    setHorizonState(u.horizon);
  }, []);
  const setTab = (t: Tab) => { setTabState(t); writeUrl(t, horizon); };
  const setHorizon = (h: number) => { setHorizonState(h); writeUrl(tab, h); };
  return (
    <div className="space-y-5">
      <PageHeader title="AI Water Prediction Lab" description="The climatic water balance D = P − ET0 (a measurable quantity) is predicted 1, 3 and 6 months ahead by models tested on years they never saw and shown beside simple baselines. Predictions are re-issued automatically when new reanalysis months arrive.">
        <div className="flex flex-wrap gap-2">
          <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "forecast", label: "Water balance forecast" }, { value: "demand", label: "Demand projection" }, { value: "groundwater", label: "Groundwater (GRACE)" }]} />
          {tab === "forecast" && <Segmented label="Forecast horizon" value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: `${h} mo` }))} />}
        </div>
      </PageHeader>
      {tab === "forecast" && <WaterBalanceForecast horizon={horizon} />}
      {tab === "demand" && <Demand />}
      {tab === "groundwater" && <Groundwater />}
    </div>
  );
}
