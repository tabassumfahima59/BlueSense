"use client";
/**
 * M2 Smart Irrigation Advisor (master prompt §6.2): crop (FAO-56 Kc table), growth stage or planting date, division
 * (D5: weather is stored at the eight divisional points; the map selects a division) and soil. Output per day and for
 * the 7-day window, timing, a plain-language "why" listing every input with its age, recent conditions and data badges.
 * Missing forecast days are reported, never assumed dry. Estimates re-run when an input changes.
 */
import dynamic from "next/dynamic";
import { CalendarClock, Droplet, Gauge, Sprout } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SERIES } from "@/components/charts/theme";
import { DEFAULT_LAYERS } from "@/components/maps/layers";
import { Button, Card, Note, PageHeader } from "@/components/ui/Card";
import { DataStatusBadge, DATA_KIND_LABEL } from "@/components/ui/DataStatus";
import { KpiCard, MeasureText } from "@/components/ui/MeasureView";
import { ErrorCard, LoadingCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { IrrigationRequest, IrrigationResponse } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> });
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const CROPS = [
  { value: "boro_rice", label: "Rice — Boro (dry season)" }, { value: "aman_rice", label: "Rice — Aman (monsoon)" }, { value: "aus_rice", label: "Rice — Aus" },
  { value: "wheat", label: "Wheat" }, { value: "maize", label: "Maize" }, { value: "potato", label: "Potato" },
];
const SOILS = [
  ["sand", "Sand"], ["loamy_sand", "Loamy sand"], ["sandy_loam", "Sandy loam"], ["loam", "Loam"], ["silt_loam", "Silt loam"],
  ["silt", "Silt"], ["silty_clay_loam", "Silty clay loam"], ["silty_clay", "Silty clay"], ["clay", "Clay"],
];
const field = "w-full rounded-lg border bg-white px-2.5 py-1.5 text-[13px]";

function Why({ r }: { r: IrrigationResponse }) {
  return (
    <Card title="Why this estimate" subtitle="Every input, where it comes from and how old it is">
      <ul className="divide-y divide-border">
        {(r.why ?? []).map((w) => (
          <li key={w.label} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{w.label}</p>
              <p className="text-[13px] text-ink">{w.value}</p>
              <p className="text-[12px] text-muted">{w.source}{w.age ? ` · retrieved ${w.age}` : ""}</p>
            </div>
            {w.status ? (
              <DataStatusBadge compact info={{ status: w.status, kind: w.dataKind, observedAt: w.observedAt, retrievedAt: w.retrievedAt, sources: [w.source] }} />
            ) : <span className="text-[11.5px] text-muted">{DATA_KIND_LABEL[w.dataKind]}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Conditions({ r }: { r: IrrigationResponse }) {
  if (!r.context?.length) return null;
  return (
    <Card title="Recent conditions" subtitle="Context for the advice; it does not change the FAO-56 calculation">
      <ul className="space-y-2">
        {r.context.map((c) => (
          <li key={c.label} className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px]"><span className="text-muted">{c.label}: </span><span className="font-medium text-ink">{c.value}</span></span>
            {c.status && <DataStatusBadge compact info={{ status: c.status, kind: c.dataKind, observedAt: c.observedAt, sources: [c.source] }} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Outputs({ r }: { r: IrrigationResponse }) {
  const days = Number(r.period.match(/\((\d+) days\)/)?.[1] ?? 7);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Gross need · next ${days} days`} m={r.grossRequirementMm} icon={<Droplet size={16} />}
                 hint={<span>{fmtMeasure(r.grossRequirementM3)} · net {fmtMeasure(r.netRequirementMm)}</span>} />
        <KpiCard label="Crop water use ETc (mean per day)" m={r.etc} icon={<Gauge size={16} />} hint={<span>ET0 {fmtMeasure(r.et0)} × Kc {fmtMeasure(r.kc, { digits: 2 })}</span>} />
        <KpiCard label="Next irrigation" icon={<CalendarClock size={16} />} m={r.interval}
          hint={<span>{fmtMeasure(r.perIrrigationGrossMm)} gross per irrigation ({fmtMeasure(r.perIrrigationGrossM3)})</span>}>
          <div className="text-[22px] font-semibold">{r.nextIrrigationDate ?? "Not within the window"}</div>
          <div className="text-[12.5px] text-muted">interval ≈ {fmtMeasure(r.interval)}</div>
        </KpiCard>
        <KpiCard label="Crop stage" icon={<Sprout size={16} />} hint={<span>{r.daysSincePlanting} days since planting</span>}>
          <div className="text-[22px] font-semibold capitalize" data-testid="crop-stage">{r.stage}</div>
          <div className="text-[12.5px] text-muted">Kc today {fmtMeasure(r.kc, { digits: 2 })}</div>
        </KpiCard>
      </div>
      {r.windowNote && <Note tone="warn">{r.windowNote}</Note>}
      {(r.missingDays?.length ?? 0) > 0 && <Note tone="warn">No complete forecast for {r.missingDays!.join(", ")}: the estimate covers {r.period} only. Missing days are never assumed to be dry.</Note>}
      <Card title="Recommendations">
        <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{r.recommendations.map((x) => <li key={x}>{x}</li>)}</ul>
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Why r={r} />
        <div className="space-y-5">
          <Conditions r={r} />
          {r.daily.length > 0 && (
            <Card title="Root-zone depletion" subtitle="Irrigate when depletion reaches the trigger (RAW, or the AWD ponding depth for rice)">
              <Plot filename="irrigation-depletion" ariaLabel="Daily root-zone depletion versus irrigation trigger" height={240} tableKeyLabel="Date"
                data={[
                  { type: "scatter", mode: "lines+markers", name: "Depletion", x: r.daily.map((d) => d.date), y: r.daily.map((d) => d.depletion_mm), line: { color: SERIES[0], width: 2 }, marker: { size: 8 }, hovertemplate: "%{x}: %{y:.1f} mm<extra></extra>" },
                  { type: "scatter", mode: "lines", name: "Irrigation trigger", x: r.daily.map((d) => d.date), y: r.daily.map(() => r.trigger.value), line: { color: NEUTRAL.reference, width: 2, dash: "dash" }, hovertemplate: "%{y:.0f} mm<extra></extra>" },
                ]}
                layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("Depletion (mm)") } })} />
            </Card>
          )}
        </div>
      </div>
      <Card title="Water balance details" subtitle={`${r.cropLabel} · ${r.location.name} · ${r.period}`}>
        <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {([
            ["Reference ET0 (mean)", r.et0], ["Crop coefficient Kc (today)", r.kc], ["Crop ET (ETc = Kc × ET0, mean)", r.etc],
            ["Forecast rainfall (window)", r.rainfall], ["Effective rainfall (USDA-SCS)", r.effectiveRainfall], ["Rice land prep + percolation", r.riceExtra],
            ["Net irrigation requirement", r.netRequirementMm], ["Gross irrigation requirement", r.grossRequirementMm],
            ["Total available water TAW", r.taw], ["Readily available water RAW", r.raw], ["Starting depletion", r.startDepletion],
            ["Model soil moisture (3–9 cm)", r.soilMoisture],
          ] as const).map(([label, m]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1">
              <dt className="text-muted">{label}</dt><dd><MeasureText m={m} /></dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[12px] text-muted">Starting depletion basis: {r.startBasis}.</p>
      </Card>
      <Card title="Assumptions" subtitle="Every parameter and its source (parameters.yaml)">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Assumptions table (scrollable)">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="text-left text-muted"><tr className="border-b border-border"><th className="py-1 font-medium">Parameter</th><th className="font-medium">Value</th><th className="font-medium">Source</th><th className="font-medium">Type</th></tr></thead>
            <tbody>{r.assumptions.map((a) => (
              <tr key={a.key} className="border-b border-border/60 align-top"><td className="py-1 pr-2">{a.key}</td><td className="pr-2 tabular-nums">{a.value} {a.unit !== "-" ? a.unit : ""}</td><td className="pr-2 text-muted">{a.source}</td><td>{a.assumption ? "Assumption" : "Cited"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function Irrigation() {
  const region = useAppStore((s) => s.selectedRegion);
  const [form, setForm] = useState<IrrigationRequest>({ crop: "boro_rice", region: region === "bd" ? "rajshahi" : region, soil: "silty_clay_loam", areaHa: 1, plantingDate: null, stage: null, efficiency: null, temperatureOverrideC: null, rainfallOverrideMm: null });
  const [dateMode, setDateMode] = useState<"default" | "date" | "stage">("default");
  const [res, setRes] = useState<IrrigationResponse | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const regions = useApi("regions", api.regions);
  const geo = useApi("geo-divisions", () => api.geo("divisions"));
  const seq = useRef(0);

  useEffect(() => {
    if (region !== "bd" && regions.data?.divisions.some((d) => d.id === region)) setForm((f) => ({ ...f, region }));
  }, [region, regions.data]);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const body: IrrigationRequest = { ...form, plantingDate: dateMode === "date" ? form.plantingDate : null, stage: dateMode === "stage" ? (form.stage ?? "initial") : null };
      const r = await api.irrigation(body);
      if (mine === seq.current) { setRes(r); setErr(null); }
    } catch (e) {
      if (mine === seq.current) setErr(e as Error);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [form, dateMode]);
  useEffect(() => {
    const t = setTimeout(run, 350); // re-estimate when any input changes
    return () => clearTimeout(t);
  }, [run]);

  return (
    <div className="space-y-5">
      <PageHeader title="Smart Irrigation Advisor" description="FAO-56 crop water requirement for the next 7 days from the stored Open-Meteo forecast (ET0, rainfall, model soil moisture) at the division's weather point. Estimate — validate locally; not a field prescription.">
        {res && res.forecastStatus && <DataStatusBadge info={{ status: res.forecastStatus, kind: "forecast", retrievedAt: res.weatherRetrievedAt, sources: ["openmeteo_forecast"], note: `Weather: ${res.weatherMode}` }} />}
      </PageHeader>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Inputs">
            <form className="space-y-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); run(); }}>
              <label className="block"><span className="mb-1 block font-medium">Crop</span>
                <select className={field} value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })}>{CROPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              </label>
              <label className="block"><span className="mb-1 block font-medium">Division (weather point)</span>
                <select className={field} value={form.region ?? ""} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                  {regions.data?.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-[12px] text-muted">…or click a division on the map</span>
                {geo.data ? (
                  <BangladeshMap divisions={geo.data} districts={EMPTY} values={{}}
                    colors={Object.fromEntries((regions.data?.divisions ?? []).map((d) => [d.id, d.id === form.region ? "#9CC5EE" : "#EAF5FF"]))}
                    layers={{ ...DEFAULT_LAYERS, scarcity: true, terrain: false, extrude: false, rivers: false }} flat height={220}
                    selected={form.region ?? undefined} onSelect={(id) => setForm((f) => ({ ...f, region: id }))} />
                ) : <Skeleton className="h-[220px] w-full" />}
              </div>
              <label className="block"><span className="mb-1 block font-medium">Soil type</span>
                <select className={field} value={form.soil} onChange={(e) => setForm({ ...form, soil: e.target.value })}>{SOILS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <fieldset>
                <legend className="mb-1 font-medium">Planting</legend>
                <div className="flex flex-wrap gap-3 text-[12.5px]">
                  {(["default", "date", "stage"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1"><input type="radio" name="dateMode" checked={dateMode === m} onChange={() => setDateMode(m)} />{{ default: "Typical date", date: "Sowing/transplanting date", stage: "Growth stage" }[m]}</label>
                  ))}
                </div>
                {dateMode === "date" && <input type="date" aria-label="Planting date" className={`${field} mt-2`} value={form.plantingDate ?? ""} onChange={(e) => setForm({ ...form, plantingDate: e.target.value || null })} />}
                {dateMode === "stage" && (
                  <select aria-label="Growth stage" className={`${field} mt-2`} value={form.stage ?? "initial"} onChange={(e) => setForm({ ...form, stage: e.target.value as IrrigationRequest["stage"] })}>
                    {["initial", "development", "mid-season", "late season"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </fieldset>
              <label className="block"><span className="mb-1 block font-medium">Area (ha)</span>
                <input type="number" min={0.01} step={0.01} className={field} value={form.areaHa} onChange={(e) => setForm({ ...form, areaHa: Math.max(0.01, Number(e.target.value) || 0.01) })} />
              </label>
              <details>
                <summary className="cursor-pointer text-primary">Optional overrides (results become a scenario)</summary>
                <div className="mt-2 space-y-2">
                  <label className="block"><span className="mb-1 block">Irrigation efficiency (default 0.78)</span>
                    <input type="number" min={0.3} max={0.95} step={0.01} className={field} value={form.efficiency ?? ""} placeholder="0.78" onChange={(e) => setForm({ ...form, efficiency: e.target.value ? Number(e.target.value) : null })} /></label>
                  <label className="block"><span className="mb-1 block">Temperature change (°C, scales ET0)</span>
                    <input type="number" min={-5} max={5} step={0.1} className={field} value={form.temperatureOverrideC ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, temperatureOverrideC: e.target.value ? Number(e.target.value) : null })} /></label>
                  <label className="block"><span className="mb-1 block">Rainfall over the forecast window (mm)</span>
                    <input type="number" min={0} max={2000} step={1} className={field} value={form.rainfallOverrideMm ?? ""} placeholder="forecast" onChange={(e) => setForm({ ...form, rainfallOverrideMm: e.target.value ? Number(e.target.value) : null })} /></label>
                </div>
              </details>
              <Button type="submit" disabled={busy} className="w-full justify-center">{busy ? "Estimating…" : "Estimate now"}</Button>
            </form>
          </Card>
        </div>
        <div className="space-y-4" aria-live="polite" aria-busy={busy}>
          <Note tone="warn">Estimate — validate locally. Uses forecast weather and FAO-56 table values; soil moisture is a model estimate, not a field measurement.</Note>
          {err && <ErrorCard error={err} onRetry={run} />}
          {!res && !err && <LoadingCard rows={3} label="Estimating irrigation" />}
          {res && <Outputs r={res} />}
        </div>
      </div>
    </div>
  );
}
