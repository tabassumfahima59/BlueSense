"use client";
/**
 * National indicators under the map. Each card states what it is: the 8-point national weather estimate, the
 * national GRACE anomaly, FAO SDG 6.4.2 water stress (AQUASTAT, national), the estimated scarcity risk (engine +
 * ML) and the JRC surface-water layer (no statistic stored). The SDG value and the estimated risk are different
 * measures and are kept apart.
 */
import { AlertTriangle, CloudRain, Droplets, Layers3, Thermometer } from "lucide-react";
import type { ReactNode } from "react";
import { DataStatusBadge, fromMeasure } from "@/components/ui/DataStatus";
import { RiskPill } from "@/components/ui/Risk";
import { Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { num, signed } from "@/lib/explorer/analysis";
import { fmtMeasure } from "@/lib/format";
import type { Measure } from "@/lib/types/contract";

function Tile({ icon, label, sub, children, testId }: { icon: ReactNode; label: string; sub: string; children: ReactNode; testId: string }) {
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-3" data-testid={testId}>
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">{icon}</span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink">{label}</div>
          <div className="text-[11.5px] text-muted">{sub}</div>
        </div>
      </div>
      <div className="min-w-0 text-[12.5px]">{children}</div>
    </div>
  );
}

const badge = (m?: Measure | null) => (m && fromMeasure(m) ? <div className="max-w-full overflow-hidden"><DataStatusBadge info={fromMeasure(m)} compact /></div> : null);

export function KpiStrip() {
  const intel = useApi("intel|bd", () => api.intelligence("bd"));
  const dash = useApi("dashboard|bd", () => api.dashboard("bd"));
  const d = intel.data?.data;
  const temp = d?.current.temperature_2m;
  const rain = d?.current.precipitation;
  const grace = d?.findings.find((f) => f.id === "grace");
  const graceM = grace?.evidence[0]?.measure;
  const graceTr = grace?.evidence[1]?.measure;
  const sdg = dash.data?.data.kpis.find((k) => k.key === "utilization");
  const loading = <Skeleton className="h-8 w-full" />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" role="group" aria-label="National indicators">
      <Tile icon={<Thermometer size={16} aria-hidden />} label="Weather now (national)" sub="Area-weighted mean of 8 representative points" testId="kpi-weather">
        {intel.error ? <p className="text-muted">Unavailable</p> : !d ? loading : (
          <>
            <div className="text-[18px] font-semibold tabular-nums text-ink">{fmtMeasure(temp)}</div>
            <div className="text-muted">Rain now {fmtMeasure(rain)}</div>
            {badge(temp)}
          </>
        )}
      </Tile>
      <Tile icon={<CloudRain size={16} aria-hidden />} label="Rainfall, last 12 months" sub="vs 1991–2020 normal (national)" testId="kpi-rain">
        {intel.error ? <p className="text-muted">Unavailable</p> : !d ? loading : d.last12 ? (
          <>
            <div className="text-[18px] font-semibold tabular-nums text-ink">{signed(d.last12.rainDeparturePct, 0, "%")}</div>
            <div className="text-muted">{num(d.last12.rain)} mm · {d.last12.start} – {d.last12.end}</div>
            <div className="text-[11px] text-muted">ERA5 reanalysis</div>
          </>
        ) : <p className="text-muted">Not available</p>}
      </Tile>
      <Tile icon={<Layers3 size={16} aria-hidden />} label="GRACE TWS anomaly" sub="Latest month, national (vs 2004–2009)" testId="kpi-grace">
        {intel.error ? <p className="text-muted">Unavailable</p> : !d ? loading : graceM ? (
          <>
            <div className="text-[18px] font-semibold tabular-nums text-ink">{fmtMeasure(graceM, { signed: true })}</div>
            <div className="text-muted">{graceM.observedAt}{graceTr ? ` · trend ${fmtMeasure(graceTr, { signed: true })}` : ""}</div>
            {badge(graceM)}
          </>
        ) : <p className="text-muted">No GRACE data stored</p>}
      </Tile>
      <Tile icon={<Droplets size={16} aria-hidden />} label="Water stress (SDG 6.4.2)" sub="FAO AQUASTAT, national statistic" testId="kpi-sdg">
        {dash.error ? <p className="text-muted">Unavailable</p> : !dash.data ? loading : sdg ? (
          <>
            <div className="text-[18px] font-semibold tabular-nums text-ink">{fmtMeasure(sdg.value)}</div>
            <div className="text-muted">Reference year {sdg.value.referenceYear ?? "—"} · withdrawal ÷ renewable resources</div>
            {badge(sdg.value)}
          </>
        ) : <p className="text-muted">Not available</p>}
      </Tile>
      <Tile icon={<AlertTriangle size={16} aria-hidden />} label="Scarcity risk (estimated)" sub="National engine run + ML dryness" testId="kpi-risk">
        {intel.error ? <p className="text-muted">Unavailable</p> : !d ? loading : (
          <>
            <RiskPill label={d.risk.label} level={d.risk.level} />
            <div className="mt-0.5 text-[11.5px] text-muted">An estimate, separate from SDG 6.4.2 (a measured withdrawal ratio).</div>
          </>
        )}
      </Tile>
    </div>
  );
}
