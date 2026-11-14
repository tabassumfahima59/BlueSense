"use client";
import { ExternalLink } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataStatusBadge } from "@/components/ui/DataStatus";
import { Async } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";

const LIMITATIONS = [
  "Weather inputs are ERA5 reanalysis at one representative point per division (divisional HQ), not station observations and not division averages.",
  "Many AQUASTAT values for Bangladesh are 2008 (withdrawals, irrigated areas) or 2018 (resources) figures carried forward; division splits by area or population are AquaGuard estimates.",
  "Transboundary inflow is split across divisions by area share and shaped monthly by GloFAS discharge; real access to river water differs strongly between divisions.",
  "The water balance uses the 1991–2020 climate normal year, not a specific year; 'current' allocation is a pro-rata proxy, not observed allocation.",
  "Scarcity forecasts predict the climatic water balance (P − ET0), which is only weakly predictable months ahead; compare with the climatology baseline in the Prediction Lab.",
  "GRACE is a ~300 km regional storage signal for all of Bangladesh. It is not groundwater depth or well level, and no such measurements are shown.",
  "District values are their parent division's values; district-level hydrology is not available in the bundled data.",
  "The water-flow network is hypothetical and Simulated. There are no IoT sensors, no real-time pressure and no pump/valve control; AquaGuard does not detect physical leaks.",
  "Irrigation outputs are FAO-56 estimates from forecast weather and table values — validate locally; they are not field prescriptions.",
  "AquaGuard supports decisions. It does not replace field monitoring, laboratory testing or government water systems.",
];

export default function DataSources() {
  const s = useApi("sources", api.sources);
  const st = useApi("data-sources", api.dataSources);
  const status = new Map((st.data?.data ?? []).map((x) => [x.id, x]));
  return (
    <div className="space-y-5">
      <PageHeader title="Data Sources & Limitations" description="Every dataset AquaGuard uses, with licence, resolution and the time it was retrieved, plus every model parameter and its source." />
      <Async state={s} rows={3} label="Loading sources">
        {(d) => (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {d.sources.map((x) => (
                <Card key={x.id} id={x.id} title={x.name} subtitle={<code className="text-[11.5px]">{x.id}</code>}
                      actions={status.get(x.id) && (() => { const v = status.get(x.id)!; return (
                        <DataStatusBadge info={{ status: v.status, kind: v.dataKind, observedAt: v.latestObservation,
                                                 retrievedAt: v.lastSuccessAt ?? v.retrievedAt, sources: [v.id],
                                                 attribution: [v.attribution], spatialLevel: v.spatialLevel, note: v.note }} />); })()}>
                  <dl className="space-y-1 text-[12.5px]">
                    <div className="[overflow-wrap:anywhere]"><dt className="inline text-muted">Licence: </dt><dd className="inline">{x.license}</dd></div>
                    <div><dt className="inline text-muted">Spatial: </dt><dd className="inline">{x.spatialResolution}</dd></div>
                    <div><dt className="inline text-muted">Temporal: </dt><dd className="inline">{x.temporalResolution}</dd></div>
                    <div><dt className="inline text-muted">Retrieved: </dt><dd className="inline tabular-nums">{x.retrievedAt}</dd></div>
                  </dl>
                  <p className="pt-1 text-[12.5px] text-muted">{x.notes}</p>
                  {x.url.startsWith("http") && (
                    <a href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[12.5px] text-primary underline-offset-2 hover:underline">
                      {x.url} <ExternalLink size={12} aria-hidden />
                    </a>
                  )}
                </Card>
              ))}
            </div>
            <Card title="Model parameters" subtitle="From backend/app/config/parameters.yaml — the single home of every assumption">
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead className="text-left text-muted"><tr className="border-b border-border"><th className="py-1 font-medium">Parameter</th><th className="font-medium">Value</th><th className="font-medium">Unit</th><th className="font-medium">Source</th><th className="font-medium">Type</th></tr></thead>
                  <tbody>
                    {d.parameters.map((p) => (
                      <tr key={p.key} className="border-b border-border/60 align-top">
                        <td className="py-1 pr-2 font-mono text-[11.5px]">{p.key}</td>
                        <td className="pr-2 tabular-nums">{p.value}</td>
                        <td className="pr-2">{p.unit}</td>
                        <td className="pr-2 text-muted">{p.source}{p.note ? ` — ${p.note}` : ""}</td>
                        <td>{p.assumption ? "Assumption" : "Cited"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </Async>
      <Card title="Limitations">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
      </Card>
      <Card title="Provenance labels">
        <ul className="space-y-1 text-[13px]">
          <li><b>Observed</b> — field or station measurements (e.g. BWDB stations, via the CSV importer). None are bundled.</li>
          <li><b>Historical</b> — archived or reanalysis datasets (ERA5 via Open-Meteo, AQUASTAT, GRACE, GloFAS, census).</li>
          <li><b>Predicted</b> — ML or third-party forecast output.</li>
          <li><b>Estimated</b> — calculated from formulas plus documented assumptions.</li>
          <li><b>Simulated</b> — output of a hypothetical scenario or simulation.</li>
        </ul>
      </Card>
    </div>
  );
}
