"use client";
import dynamic from "next/dynamic";
import { CalendarClock, Droplet, Sprout } from "lucide-react";
import { useEffect, useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { axisTitle, baseLayout, NEUTRAL, SERIES } from "@/components/charts/theme";
import { DEFAULT_LAYERS } from "@/components/maps/layers";
import { Button, Card, Note, PageHeader } from "@/components/ui/Card";
import { KpiCard, MeasureText } from "@/components/ui/MeasureView";
import { ErrorCard, LoadingCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { IrrigationRequest, IrrigationResponse } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), { ssr: false, loading: () => <Skeleton className="h-[260px] w-full" /> });

const CROPS = [
  { value: "boro_rice", label: "Rice — Boro (dry season)" }, { value: "aman_rice", label: "Rice — Aman (monsoon)" }, { value: "aus_rice", label: "Rice — Aus" },
  { value: "wheat", label: "Wheat" }, { value: "maize", label: "Maize" }, { value: "potato", label: "Potato" },
];
const SOILS = [
  ["sand", "Sand"], ["loamy_sand", "Loamy sand"], ["sandy_loam", "Sandy loam"], ["loam", "Loam"], ["silt_loam", "Silt loam"],
  ["silt", "Silt"], ["silty_clay_loam", "Silty clay loam"], ["silty_clay", "Silty clay"], ["clay", "Clay"],
];

const field = "w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px]";

function Outputs({ r }: { r: IrrigationResponse }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Next irrigation" icon={<CalendarClock size={16} />} m={r.interval}
          hint={<span>{r.nextIrrigationDate ? `around ${r.nextIrrigationDate}` : "no trigger in forecast window"} · interval shown</span>}>
          <div className="text-[24px] font-semibold">{r.nextIrrigationDate ?? "Not needed yet"}</div>
          <div className="text-[12.5px] text-muted">interval ≈ {fmtMeasure(r.interval)}</div>
        </KpiCard>
        <KpiCard label="Quantity per irrigation (gross)" m={r.perIrrigationGrossM3} icon={<Droplet size={16} />} hint={<span>{fmtMeasure(r.perIrrigationGrossMm)} depth</span>} />
        <KpiCard label={`Gross requirement · ${r.period}`} m={r.grossRequirementM3} hint={<span>{fmtMeasure(r.grossRequirementMm)} · net {fmtMeasure(r.netRequirementMm)}</span>} />
        <KpiCard label="Crop stage" icon={<Sprout size={16} />} hint={<span>{r.daysSincePlanting} days since planting</span>}>
          <div className="text-[24px] font-semibold capitalize">{r.stage}</div>
          <div className="text-[12.5px] text-muted">Kc today {fmtMeasure(r.kc, { digits: 2 })}</div>
        </KpiCard>
      </div>
      <Card title="Crop water balance" subtitle={`${r.cropLabel} · ${r.location.name} · weather: ${r.weatherMode}${r.weatherRetrievedAt ? `, retrieved ${r.weatherRetrievedAt.slice(0, 16).replace("T", " ")} UTC` : ""}`}>
        <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {([
            ["Reference ET0 (mean)", r.et0], ["Crop coefficient Kc (today)", r.kc], ["Crop ET (ETc = Kc × ET0, mean)", r.etc],
            ["Forecast rainfall (period)", r.rainfall], ["Effective rainfall (USDA-SCS)", r.effectiveRainfall], ["Rice land prep + percolation", r.riceExtra],
            ["Net irrigation requirement", r.netRequirementMm], ["Gross irrigation requirement", r.grossRequirementMm],
            ["Net requirement (volume)", r.netRequirementM3], ["Gross requirement (volume)", r.grossRequirementM3],
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
      {r.daily.length > 0 && (
        <Card title="Root-zone depletion over the forecast window" subtitle="Irrigate when depletion reaches the trigger (RAW, or the AWD ponding depth for rice)">
          <Plot filename="irrigation-depletion" ariaLabel="Daily root-zone depletion versus irrigation trigger" height={260}
            data={[
              { type: "scatter", mode: "lines+markers", name: "Depletion", x: r.daily.map((d) => d.date), y: r.daily.map((d) => d.depletion_mm), line: { color: SERIES[0], width: 2 }, marker: { size: 8 }, hovertemplate: "%{y:.1f} mm" },
              { type: "scatter", mode: "lines", name: "Irrigation trigger", x: r.daily.map((d) => d.date), y: r.daily.map(() => r.trigger.value), line: { color: NEUTRAL.reference, width: 2, dash: "dash" }, hovertemplate: "%{y:.0f} mm" },
            ]}
            layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), title: axisTitle("Depletion (mm)") }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("Date") } })} />
        </Card>
      )}
      <Card title="Recommendations">
        <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{r.recommendations.map((x) => <li key={x}>{x}</li>)}</ul>
      </Card>
      <Card title="Assumptions" subtitle="Every parameter and its source (parameters.yaml)">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
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
  const map = useApi("map|", () => api.mapLayers("bd", { rainfallChangePct: 0, temperatureChangeC: 0, demandChangePct: 0, groundwaterAvailabilityPct: 0, irrigationEfficiency: null, pipelineLossPct: null }));

  useEffect(() => {
    if (region !== "bd") setForm((f) => ({ ...f, region }));
  }, [region]);

  const run = async () => {
    setBusy(true);
    try {
      const body: IrrigationRequest = { ...form, plantingDate: dateMode === "date" ? form.plantingDate : null, stage: dateMode === "stage" ? form.stage : null };
      setRes(await api.irrigation(body));
      setErr(null);
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { run(); /* initial estimate */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader title="Smart Irrigation Advisor" description="FAO-56 crop water requirement with Open-Meteo ET0, rainfall and model soil moisture for the next 16 days. Estimate — validate locally; not a field prescription." />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Inputs">
            <form className="space-y-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); run(); }}>
              <label className="block"><span className="mb-1 block font-medium">Crop</span>
                <select className={field} value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })}>{CROPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              </label>
              <label className="block"><span className="mb-1 block font-medium">Location (division or district)</span>
                <select className={field} value={form.region ?? ""} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                  {regions.data?.divisions.map((d) => (
                    <optgroup key={d.id} label={d.name}>
                      <option value={d.id}>{d.name} (division HQ)</option>
                      {regions.data!.districts.filter((x) => x.parentId === d.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-[12px] text-muted">…or click a district on the map</span>
                {map.data ? (
                  <BangladeshMap divisions={map.data.divisions as unknown as GeoJSON.FeatureCollection} districts={map.data.districts as unknown as GeoJSON.FeatureCollection}
                    values={map.data.values} layers={{ ...DEFAULT_LAYERS, level: "district", scarcity: false, terrain: false, extrude: false, rivers: false }} flat height={220}
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
                {dateMode === "date" && <input type="date" aria-label="Planting date" className={`${field} mt-2`} value={form.plantingDate ?? ""} onChange={(e) => setForm({ ...form, plantingDate: e.target.value })} />}
                {dateMode === "stage" && (
                  <select aria-label="Growth stage" className={`${field} mt-2`} value={form.stage ?? "initial"} onChange={(e) => setForm({ ...form, stage: e.target.value as IrrigationRequest["stage"] })}>
                    {["initial", "development", "mid-season", "late season"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </fieldset>
              <label className="block"><span className="mb-1 block font-medium">Area (ha)</span>
                <input type="number" min={0.01} step={0.01} className={field} value={form.areaHa} onChange={(e) => setForm({ ...form, areaHa: Number(e.target.value) })} />
              </label>
              <details>
                <summary className="cursor-pointer text-primary">Optional overrides</summary>
                <div className="mt-2 space-y-2">
                  <label className="block"><span className="mb-1 block">Irrigation efficiency (default 0.78)</span>
                    <input type="number" min={0.3} max={0.95} step={0.01} className={field} value={form.efficiency ?? ""} placeholder="0.78" onChange={(e) => setForm({ ...form, efficiency: e.target.value ? Number(e.target.value) : null })} /></label>
                  <label className="block"><span className="mb-1 block">Temperature change (°C, scales ET0)</span>
                    <input type="number" min={-5} max={5} step={0.1} className={field} value={form.temperatureOverrideC ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, temperatureOverrideC: e.target.value ? Number(e.target.value) : null })} /></label>
                  <label className="block"><span className="mb-1 block">Rainfall over the next 16 days (mm)</span>
                    <input type="number" min={0} max={2000} step={1} className={field} value={form.rainfallOverrideMm ?? ""} placeholder="forecast" onChange={(e) => setForm({ ...form, rainfallOverrideMm: e.target.value ? Number(e.target.value) : null })} /></label>
                </div>
              </details>
              <Button type="submit" disabled={busy} className="w-full justify-center">{busy ? "Estimating…" : "Estimate irrigation"}</Button>
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Note tone="warn">Estimate — validate locally. Uses forecast weather and FAO-56 table values; soil moisture is model data, not a field measurement.</Note>
          {err && <ErrorCard error={err} onRetry={run} />}
          {!res && !err && <LoadingCard rows={3} label="Estimating irrigation" />}
          {res && <Outputs r={res} />}
          {res?.weatherMode === "stored" && <Note>Weather comes from the forecast stored by the last scheduled sync (live request unavailable); see the retrieval time above.</Note>}
          {res?.weatherMode === "unavailable" && <Note tone="warn">No weather forecast is available, so no estimate can be made.</Note>}
        </div>
      </div>
    </div>
  );
}
