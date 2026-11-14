"use client";
/**
 * Details of the selected map feature. Divisions: geography, current weather at the representative point, the last
 * 12 complete months vs normal, the estimated scarcity risk and what sets it, the stored next-month prediction,
 * national GRACE context and the JRC note. Districts: geography only (reference boundary) and the parent division.
 * Weather points, GRACE cells, rivers and water bodies: what is (and is not) known about them.
 */
import { Bot, Droplets, Layers3, MapPin, Sparkles, Waves, X } from "lucide-react";
import type { ReactNode } from "react";
import { DataStatusBadge, fromMeasure, fromMeta } from "@/components/ui/DataStatus";
import { RiskPill } from "@/components/ui/Risk";
import { Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { num, signed } from "@/lib/explorer/analysis";
import { KIND_LABEL, type MapSelection } from "@/lib/explorer/store";
import { fmtMeasure } from "@/lib/format";
import type { MapLayersResponse } from "@/lib/types/contract";

const DRIVER: Record<string, string> = {
  stress: "set by the dry-season stress class (engine estimate)",
  dryness: "set by the predicted dryness class (ML)",
  both: "stress and dryness classes are equal",
  none: "both components are in their lowest class",
};

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="border-t border-border/70 pt-2">
      <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  );
}

function CurrentWeather({ division, point = false }: { division: string; point?: boolean }) {
  const cur = useApi(`weather-current|${division}`, () => api.weatherCurrent(division));
  const cv = cur.data?.data.values ?? {};
  return (
    <Section label="Current weather">
      {cur.error ? <p className="text-muted">Unavailable: {cur.error.message}</p> : !cur.data ? <Skeleton className="h-10 w-full" /> : (
        <>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
            {([["temperature_2m", "Temperature"], ["precipitation", "Rain (now)"], ["relative_humidity_2m", "Humidity"], ["wind_speed_10m", "Wind"]] as const).map(([k, label]) => (
              <Row key={k} k={label} v={cv[k] ? fmtMeasure(cv[k]) : "—"} />
            ))}
          </dl>
          <div className="mt-1 flex flex-wrap items-center gap-1.5"><DataStatusBadge info={fromMeta(cur.data.meta)} compact /></div>
          <p className="mt-1 text-[11.5px] text-muted">{point ? "This point" : "The division's representative Open-Meteo point"} — a model estimate, not a weather station.</p>
        </>
      )}
    </Section>
  );
}

function DivisionBody({ id, onIntel }: { id: string; onIntel: () => void }) {
  const intel = useApi(`intel|${id}`, () => api.intelligence(id));
  const pred = useApi(`predictions|${id}|1|water_balance`, () => api.predictions(id, 1));
  const d = intel.data?.data;
  const fc = pred.data?.data.forecast;
  const grace = d?.findings.find((f) => f.id === "grace");
  return (
    <>
      {intel.error ? <p className="text-muted">Regional analysis unavailable: {intel.error.message}</p> : !d ? <Skeleton className="h-14 w-full" /> : (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
          <Row k="Area" v={fmtMeasure(d.profile.area)} />
          <Row k="Districts" v={d.profile.districts} />
          <Row k="Population (2022)" v={fmtMeasure(d.profile.population)} />
        </dl>
      )}
      <CurrentWeather division={id} />
      {d && (
        <Section label="Last 12 complete months">
          {d.last12 ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
              <Row k="Rainfall" v={`${num(d.last12.rain)} mm`} />
              <Row k="vs 1991–2020 normal" v={signed(d.last12.rainDeparturePct, 0, "%")} />
              <Row k="Mean temperature" v={`${num(d.last12.tmean, 1)} °C (${signed(d.last12.tmeanAnomaly, 1, " °C")})`} />
              <Row k="Period" v={`${d.last12.start} – ${d.last12.end}`} />
            </dl>
          ) : <p className="text-muted">Twelve complete months are not available.</p>}
          <p className="mt-1 text-[11.5px] text-muted">ERA5 reanalysis at the representative point.</p>
        </Section>
      )}
      {d && (
        <Section label="Scarcity risk (estimated)">
          <RiskPill label={d.risk.label} level={d.risk.level} />
          <p className="mt-1 text-[12px] text-muted">
            {DRIVER[d.risk.driver]}. Dry-season stress ratio {num(d.risk.dryStressRatio, 3)} ({d.risk.stressClass});
            dryness {d.risk.drynessClass ?? "not classified"}. Division estimate, not a measurement.
          </p>
        </Section>
      )}
      <Section label="Prediction">
        <h4 className="sr-only">Predicted P − ET0, next month</h4>
        {pred.error ? <p className="text-muted">Unavailable.</p> : !pred.data ? <Skeleton className="h-8 w-full" /> : fc ? (
          <div className="space-y-0.5">
            <div className="tabular-nums">P − ET0 {fmtMeasure(fc.value)} for {fc.targetMonth}</div>
            <div className="text-[12px] text-muted">90% interval {fc.value.uncertainty ? `${fc.value.uncertainty.low} to ${fc.value.uncertainty.high} mm` : "—"} · {fc.drynessClass}</div>
            {fromMeasure(fc.value) && <DataStatusBadge info={fromMeasure(fc.value)} compact />}
          </div>
        ) : <p className="text-muted">No prediction available.</p>}
      </Section>
      {d && (
        <Section label="Water storage (GRACE)">
          {grace ? (
            <>
              <p className="tabular-nums">Bangladesh: {fmtMeasure(grace.evidence[0]?.measure, { signed: true })} ({grace.evidence[0]?.measure.observedAt})</p>
              <p className="text-[11.5px] text-muted">National context only: GRACE resolves about 300 km, not a single division; total water storage, not a groundwater level.</p>
            </>
          ) : <p className="text-muted">No GRACE data stored.</p>}
        </Section>
      )}
      <Section label="Surface water (JRC)">
        <p className="text-[12px] text-muted">Historical occurrence 1984–2021 is a map layer; no per-division statistic is stored, so no percentage is shown.</p>
      </Section>
      <button type="button" onClick={onIntel}
              className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-dark">
        <Sparkles size={14} aria-hidden /> Open spatial intelligence
      </button>
    </>
  );
}

export function RegionPanel({ sel, values, cellsPeriod, onClose, onIntel, onAsk, onSelectDivision, className = "", headingId }: {
  sel: MapSelection;
  values: MapLayersResponse["values"] | undefined;
  cellsPeriod?: string | null;
  onClose: () => void;
  onIntel: () => void;
  onAsk: () => void;
  onSelectDivision: (id: string) => void;
  className?: string;
  headingId: string;
}) {
  const divName = sel.divisionId ? values?.[sel.divisionId]?.name ?? sel.divisionId : null;
  const Icon = sel.kind === "river" || sel.kind === "water" ? Waves : sel.kind === "grace_cell" ? Layers3 : sel.kind === "weather_point" ? MapPin : Droplets;
  const district = sel.kind === "district" ? values?.[sel.id] : undefined;
  return (
    <section aria-labelledby={headingId} data-testid="region-panel"
             className={`flex-col overflow-hidden border border-border bg-white/95 shadow-lg backdrop-blur ${className}`}>
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icon size={15} aria-hidden /></span>
          <div className="min-w-0">
            <h2 id={headingId} className="text-[15px] font-semibold text-ink">{sel.name}</h2>
            <p className="text-[12px] text-muted">
              {sel.kind === "district" ? `${sel.name} district (reference boundary) · data for ${divName} division` : KIND_LABEL[sel.kind]}
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close region panel" className="rounded p-1 text-muted hover:bg-bg"><X size={15} aria-hidden /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-[12.5px]">
        {sel.kind === "division" && <DivisionBody id={sel.id} onIntel={onIntel} />}
        {sel.kind === "district" && (
          <>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
              <Row k="Area" v={district ? fmtMeasure(district.area) : "—"} />
              <Row k="Population (2022)" v={district ? fmtMeasure(district.population) : "—"} />
              <Row k="Division" v={divName ?? "—"} />
            </dl>
            <p className="rounded-lg bg-[#fffaeb] px-2 py-1.5 text-[12px] text-[#6b4a07]">
              No district-level water data exists in AquaGuard. Weather, risk and analysis are available for {divName} division.
            </p>
            {sel.divisionId && (
              <button type="button" onClick={() => onSelectDivision(sel.divisionId!)} className="w-full rounded-lg border border-control px-3 py-1.5 text-[12.5px] hover:bg-light">
                Show {divName} division
              </button>
            )}
          </>
        )}
        {sel.kind === "weather_point" && sel.divisionId && (
          <>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
              <Row k="Coordinates" v={sel.props?.lat !== undefined ? `${Number(sel.props.lat).toFixed(3)}°N ${Number(sel.props.lon).toFixed(3)}°E` : "—"} />
              <Row k="Represents" v={`${divName} division`} />
            </dl>
            <CurrentWeather division={sel.divisionId} point />
            <button type="button" onClick={() => onSelectDivision(sel.divisionId!)} className="w-full rounded-lg border border-control px-3 py-1.5 text-[12.5px] hover:bg-light">
              Show {divName} division
            </button>
          </>
        )}
        {sel.kind === "grace_cell" && (
          <>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
              <Row k="Centre" v={`${Number(sel.props?.lat).toFixed(3)}°N ${Number(sel.props?.lon).toFixed(3)}°E`} />
              <Row k={`TWS anomaly${cellsPeriod ? ` (${cellsPeriod})` : ""}`} v={
                <span className="inline-flex items-center gap-1">{signed(Number(sel.props?.v), 1, " cm")}</span>} />
              <Row k="Baseline" v="2004–2009 mean" />
              <Row k="Uncertainty" v="Not in the stored product" />
            </dl>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted">
              <li>0.25° display grid; effective resolution about 300 km: neighbouring cells are not independent.</li>
              <li>Total water storage anomaly (cm water height), not a groundwater level.</li>
              <li>Source: GRACE / GRACE-FO, CSR RL06.3 mascons.</li>
            </ul>
          </>
        )}
        {(sel.kind === "river" || sel.kind === "water") && (
          <>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
              <Row k="Type" v={String(sel.props?.waterKind ?? "—").replace(/_/g, " ")} />
              <Row k="Source" v="OpenStreetMap (CARTO basemap)" />
            </dl>
            <p className="text-[12px] text-muted">
              Geography only: AquaGuard has no discharge, water level or flow data for {sel.kind === "river" ? "rivers" : "water bodies"}.
              Historical water presence is shown by the JRC surface-water layer (1984–2021).
            </p>
          </>
        )}
        <button type="button" onClick={onAsk}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-3 py-1.5 text-[12.5px] font-medium text-primary hover:bg-primary-soft">
          <Bot size={14} aria-hidden /> Ask the map assistant
        </button>
        <p className="flex items-center gap-1 text-[11px] text-muted"><span className="h-2 w-2 rounded-full bg-[#F59E0B]" aria-hidden />Selected on the map (amber outline)</p>
      </div>
    </section>
  );
}
