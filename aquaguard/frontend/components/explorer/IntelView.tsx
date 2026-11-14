"use client";
/**
 * Spatial Intelligence: the evidence-based report for the selected division (or Bangladesh): summary, findings with
 * their values, risk analysis, data quality and coverage, suggested next investigation, limitations, and the map
 * assistant for follow-up questions. Everything comes from /api/explorer/intelligence.
 */
import { CheckCircle2, CircleAlert, CircleHelp, Info, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { DATA_KIND_LABEL, DataStatusBadge, fromMeasure, fromMeta } from "@/components/ui/DataStatus";
import { RiskPill } from "@/components/ui/Risk";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { num } from "@/lib/explorer/analysis";
import type { MapSelection } from "@/lib/explorer/store";
import { fmtMeasure } from "@/lib/format";
import type { RegionIntel } from "@/lib/types/contract";
import { MapAssistant } from "./MapAssistant";

const TONE = {
  good: { Icon: CheckCircle2, cls: "text-[#166534]", label: "favourable" },
  neutral: { Icon: Info, cls: "text-[#36506E]", label: "context" },
  warn: { Icon: TriangleAlert, cls: "text-[#92400e]", label: "attention" },
  bad: { Icon: CircleAlert, cls: "text-[#b42318]", label: "high" },
} as const;

const SOURCE_NAME: Record<string, string> = {
  openmeteo_archive: "Open-Meteo Historical (ERA5)", openmeteo_forecast: "Open-Meteo Forecast", grace_csr: "GRACE CSR RL06.3",
  fao_aquastat: "FAO AQUASTAT", jrc_gsw: "JRC Global Surface Water", aquaguard_engine: "AquaGuard engine", aquaguard_ml: "AquaGuard ML",
};

function kindLabel(k: string) {
  return (DATA_KIND_LABEL as Record<string, string>)[k] ?? k;
}

function Findings({ d }: { d: RegionIntel }) {
  return (
    <ul className="space-y-3" data-testid="findings">
      {d.findings.map((f) => {
        const t = TONE[f.tone];
        return (
          <li key={f.id} className="rounded-lg border border-border bg-white p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px]">
              <t.Icon size={14} className={t.cls} aria-hidden />
              <span className="font-semibold uppercase tracking-wide text-muted">{f.topic}</span>
              <span className="rounded-full border border-border px-1.5 py-px text-muted">{kindLabel(f.kind)}</span>
              <span className={`sr-only`}>{t.label}</span>
            </div>
            <p className="text-[13px] leading-relaxed text-ink">{f.text}</p>
            {f.evidence.length > 0 && (
              <details className="mt-1.5 text-[12px]">
                <summary className="cursor-pointer select-none text-primary">Evidence ({f.evidence.length})</summary>
                <ul className="mt-1 space-y-1">
                  {f.evidence.map((e) => (
                    <li key={e.label} className="flex flex-wrap items-center justify-between gap-x-2 border-b border-border/60 pb-1">
                      <span className="text-muted">{e.label}</span>
                      <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
                        {fmtMeasure(e.measure, { signed: e.measure.unit !== "mm" && e.measure.unit !== "°C" && e.measure.unit !== "ratio" })}
                        {e.measure.uncertainty && <span className="text-muted">(95%: {e.measure.uncertainty.low} to {e.measure.uncertainty.high})</span>}
                        {fromMeasure(e.measure) && <DataStatusBadge info={fromMeasure(e.measure)} compact />}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function IntelView({ region, regionName, sel, divisionName }: { region: string; regionName: string; sel: MapSelection | null; divisionName: string | null }) {
  const intel = useApi(`intel|${region}`, () => api.intelligence(region));
  if (intel.error) return <ErrorCard error={intel.error} onRetry={intel.retry} title="Spatial intelligence unavailable" />;
  if (!intel.data) return <Skeleton className="h-[520px] w-full" />;
  const d = intel.data.data;
  const q = d.quality;
  return (
    <div className="space-y-4" data-testid="intel-view">
      {sel?.kind === "district" && (
        <p className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-[12.5px] text-[#6b4a07]">
          {sel.name} is a district (reference boundary). No district-level water data exists, so this analysis is for {divisionName} division.
        </p>
      )}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card title={`Regional overview — ${regionName}`} subtitle="Evidence-based summary; every statement below lists its values"
                actions={<DataStatusBadge info={fromMeta(intel.data.meta)} compact />}>
            <p className="text-[13.5px] leading-relaxed text-ink" data-testid="intel-summary">{d.summary}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
              <div><dt className="text-muted">Area</dt><dd className="tabular-nums">{fmtMeasure(d.profile.area)}</dd></div>
              <div><dt className="text-muted">Districts</dt><dd className="tabular-nums">{d.profile.districts}</dd></div>
              <div><dt className="text-muted">Population (2022)</dt><dd className="tabular-nums">{fmtMeasure(d.profile.population)}</dd></div>
              <div><dt className="text-muted">Weather record</dt><dd className="tabular-nums">{q.weatherFirst} – {q.weatherLast}</dd></div>
            </dl>
          </Card>
          <Card title="Water intelligence" subtitle="Rainfall, temperature, dryness, trends, estimated risk, GRACE and surface water">
            <Findings d={d} />
          </Card>
          <Card title="Risk analysis" subtitle="Estimated scarcity risk (division level) — methodology unchanged">
            <div className="flex flex-wrap items-center gap-2"><RiskPill label={d.risk.label} level={d.risk.level} />
              <span className="text-[12.5px] text-muted">{d.region.level === "national" ? "National engine run" : "Division estimate"}{d.risk.targetMonth ? ` · dryness predicted for ${d.risk.targetMonth}` : ""}</span></div>
            <table className="mt-3 w-full text-[12.5px]">
              <tbody>
                <tr className="border-b border-border/60"><th scope="row" className="py-1 text-left font-normal text-muted">Stress component (engine, dry season)</th>
                  <td className="text-right">{d.risk.stressClass} (level {d.risk.stressLevel}) · ratio {num(d.risk.dryStressRatio, 3)}</td></tr>
                <tr className="border-b border-border/60"><th scope="row" className="py-1 text-left font-normal text-muted">Dryness component (ML prediction)</th>
                  <td className="text-right">{d.risk.drynessClass ?? "not classified"} (level {d.risk.drynessLevel}) · z {d.risk.z === null ? "—" : num(d.risk.z, 2)}</td></tr>
                <tr><th scope="row" className="py-1 text-left font-normal text-muted">Set by</th>
                  <td className="text-right">{{ stress: "the stress component", dryness: "the dryness component", both: "both components equally", none: "neither (lowest class)" }[d.risk.driver]}</td></tr>
              </tbody>
            </table>
            <details className="mt-2 text-[12px] text-muted"><summary className="cursor-pointer select-none text-primary">Method</summary>
              <p className="mt-1 leading-relaxed">{d.risk.rule}</p>
              <p className="mt-1">This estimate is separate from FAO SDG 6.4.2 water stress (a national withdrawal ratio, AQUASTAT). The engine splits national supply and demand to divisions by area and population, so division values are estimates.</p>
            </details>
          </Card>
          <Card title="Data quality" subtitle="Status, resolution, coverage and gaps of the sources used">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12.5px]" aria-label="Spatial and temporal resolution">
                <thead className="text-left text-muted"><tr className="border-b border-border"><th className="py-1 font-medium">Layer</th>
                  <th className="font-medium">Spatial</th><th className="font-medium">Temporal</th><th className="font-medium">Status</th></tr></thead>
                <tbody>{q.resolution.map((r) => (
                  <tr key={r.layer} className="border-b border-border/60"><th scope="row" className="py-1 text-left font-normal">{r.layer}</th>
                    <td>{r.spatial}</td><td>{r.temporal}</td><td className="capitalize">{r.status.replace("_", " ")}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <ul className="mt-2 space-y-0.5 text-[12.5px]">
              <li>Weather: {q.weatherMonths} months stored ({q.weatherFirst} – {q.weatherLast}); {q.weatherIncompleteMonths} incomplete month(s) carry no value; {q.completeYears} complete years.</li>
              <li>GRACE: {q.grace.months ?? 0} months ({q.grace.first} – {q.grace.last}); {q.grace.missingMonths ?? 0} missing months
                {q.grace.longestGap ? `, longest gap ${q.grace.longestGap[0]} – ${q.grace.longestGap[1]} (${q.grace.longestGap[2]} months)` : ""}; baseline {q.grace.baseline}; uncertainty {q.grace.uncertaintyStored ? "stored" : "not in the stored product"}.</li>
              <li>Sources: {Object.entries(q.sources).map(([k, v]) => `${SOURCE_NAME[k] ?? k} ${v.replace("_", " ")}`).join(" · ")}.</li>
            </ul>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card title="Suggested next investigation" subtitle="Rule-based from the findings; suggestions, not conclusions">
            <ul className="list-disc space-y-1 pl-4 text-[12.5px]" data-testid="suggestions">{d.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
          </Card>
          <Card title="AI insights" subtitle="Ask follow-up questions; answers are grounded in AquaGuard's read-only tools">
            <MapAssistant sel={sel} region={region} regionName={regionName} divisionName={divisionName} idPrefix="intel-assistant" />
          </Card>
          <Card title="Limitations">
            <ul className="space-y-1 text-[12px] text-muted">{d.limitations.map((l) => <li key={l} className="flex gap-1.5"><CircleHelp size={13} className="mt-0.5 shrink-0" aria-hidden />{l}</li>)}</ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
