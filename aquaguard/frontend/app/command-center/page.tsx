"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CloudRain, Download, Droplets, Gauge, Layers, TrendingDown, Waves } from "lucide-react";
import { Plot } from "@/components/charts/Plot";
import { Sparkline } from "@/components/charts/Sparkline";
import { axisTitle, baseLayout, NEUTRAL, SECTOR_COLOR, SERIES } from "@/components/charts/theme";
import { MODULES } from "@/components/layout/nav";
import { useShareQuery } from "@/components/layout/UrlSync";
import { DEFAULT_LAYERS } from "@/components/maps/layers";
import { Card, PageHeader } from "@/components/ui/Card";
import { KpiCard, MeasureText } from "@/components/ui/MeasureView";
import { MeasureBadge } from "@/components/ui/Provenance";
import { RiskLegend, RiskPill, RiskRule } from "@/components/ui/Risk";
import { Async, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { downloadText, fmtMeasure, MONTHS, toCsv } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useRegionScenario } from "@/lib/store/hooks";
import type { Alert, OverviewResponse } from "@/lib/types/contract";

const BangladeshMap = dynamic(() => import("@/components/maps/BangladeshMap").then((m) => m.BangladeshMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[340px] w-full" />,
});

const SEV_STYLE: Record<Alert["severity"], string> = {
  critical: "border-l-risk",
  warning: "border-l-warning",
  info: "border-l-secondary",
};

function Kpis({ o }: { o: OverviewResponse }) {
  const k = o.kpis;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Total water availability (annual)" m={k.availability} icon={<Droplets size={16} />}
        hint={<span>usable after env. reserve {fmtMeasure(k.usableAvailability)}</span>} />
      <KpiCard label="Total consumptive demand (annual)" m={k.demand} icon={<Layers size={16} />}
        hint={<span>dry season {fmtMeasure(k.dryDemand)}</span>} />
      <KpiCard label="Scarcity risk" icon={<TrendingDown size={16} />}>
        <div className="py-1"><RiskPill label={k.scarcityRisk.label} level={k.scarcityRisk.level} /></div>
        <RiskRule risk={k.scarcityRisk} />
      </KpiCard>
      <KpiCard label="Regional water stress (dry season, Dec–Apr)" m={k.dryStressRatio}
        hint={<span>{k.dryStressClass} · annual {fmtMeasure(k.stressRatio)} ({k.stressClass})</span>} />
      <KpiCard label="Groundwater storage trend (GRACE)" m={k.groundwaterTrend} digits={2} intervalLabel="95% CI" icon={<Waves size={16} />}
        hint={<span>regional, ~300 km; not well depth</span>} />
      <KpiCard label="Rainfall, last 30 days" m={k.rainfall30d?.total} icon={<CloudRain size={16} />}
        hint={k.rainfall30d ? <span>normal {fmtMeasure(k.rainfall30d.normal)} · {fmtMeasure(k.rainfall30d.anomalyPct, { signed: true })} · {k.rainfall30d.window}</span> : <span>No recent data</span>} />
      <KpiCard label="Distribution efficiency (1 − loss rate)" m={k.distributionEfficiency} icon={<Gauge size={16} />}
        hint={<span>piped domestic + industrial</span>} />
      <KpiCard label="Unmet demand (dry season)" m={k.unmetDry} hint={<span>pro-rata allocation proxy</span>} />
    </div>
  );
}

function BalanceChart({ o }: { o: OverviewResponse }) {
  const x = o.monthly.map((p) => MONTHS[p.month - 1]);
  return (
    <Plot
      filename="availability-vs-demand"
      ariaLabel="Monthly usable supply versus consumptive demand"
      height={300}
      data={[
        { type: "scatter", mode: "lines+markers", name: "Usable supply (after env. reserve)", x, y: o.monthly.map((p) => p.usableSupply.value), line: { color: SERIES[2], width: 2 }, marker: { size: 8 }, hovertemplate: "%{y:,.0f} MCM" },
        { type: "scatter", mode: "lines+markers", name: "Consumptive demand", x, y: o.monthly.map((p) => p.consumptiveDemand.value), line: { color: SERIES[1], width: 2 }, marker: { size: 8 }, hovertemplate: "%{y:,.0f} MCM" },
        { type: "bar", name: "Unmet demand", x, y: o.monthly.map((p) => p.unmet.value), marker: { color: SERIES[4] }, hovertemplate: "%{y:,.0f} MCM" },
      ]}
      layout={baseLayout({ yaxis: { ...(baseLayout().yaxis as object), type: "log", title: axisTitle("MCM per month (log scale)") }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("Month (1991–2020 climate normal)") }, bargap: 0.35 })}
    />
  );
}

function SectorChart({ o }: { o: OverviewResponse }) {
  const keys = ["agriculture", "domestic", "industry"] as const;
  return (
    <>
      <Plot
        filename="sector-demand"
        ariaLabel="Annual consumptive demand by sector"
        height={220}
        data={[{
          type: "bar", orientation: "h", y: keys.map((k) => k[0].toUpperCase() + k.slice(1)), x: keys.map((k) => o.sectors[k].value),
          marker: { color: keys.map((k) => SECTOR_COLOR[k]) }, text: keys.map((k) => fmtMeasure(o.sectors[k])), textposition: "outside", cliponaxis: false,
          hovertemplate: "%{y}: %{x:,.0f} MCM<extra></extra>",
        }]}
        layout={baseLayout({ showlegend: false, hovermode: "closest", margin: { l: 90, r: 70, t: 4, b: 40 }, xaxis: { ...(baseLayout().xaxis as object), title: axisTitle("MCM per year") } })}
      />
      <p className="mt-1 text-[12px] text-muted">
        Environmental reserve (in-stream, not withdrawn): <MeasureText m={o.sectors.environment} />
      </p>
    </>
  );
}

function RegionalTable({ o, onSelect }: { o: OverviewResponse; onSelect: (id: string) => void }) {
  const exportCsv = () => {
    const rows = [["Division", "Availability (MCM/yr)", "Demand (MCM/yr)", "Annual stress ratio", "Dry-season stress ratio", "Risk", "Provenance", "Sample"],
      ...o.regional.map((r) => [r.name, r.availability.value, r.demand.value, r.stressRatio.value, r.dryStressRatio.value, r.risk, r.availability.provenance, r.availability.isSample ? "yes" : "no"])];
    downloadText(`aquaguard-regional-comparison${o.context.scenarioActive ? "-scenario" : ""}.csv`, toCsv(rows));
  };
  return (
    <Card title="Regional comparison — 8 divisions" subtitle="Click a row to focus that division"
      actions={<button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] hover:bg-bg"><Download size={13} aria-hidden /> CSV</button>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Division</th>
              <th className="py-2 pr-3 text-right font-medium">Availability (MCM/yr)</th>
              <th className="py-2 pr-3 text-right font-medium">Demand (MCM/yr)</th>
              <th className="py-2 pr-3 text-right font-medium">Stress (annual)</th>
              <th className="py-2 pr-3 text-right font-medium">Stress (dry season)</th>
              <th className="py-2 font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {o.regional.map((r) => (
              <tr key={r.regionId} onClick={() => onSelect(r.regionId)} className={`cursor-pointer border-b border-border/70 hover:bg-bg ${o.context.region.id === r.regionId ? "bg-primary-soft" : ""}`}>
                <td className="py-2 pr-3 font-medium">
                  <button className="text-left" onClick={() => onSelect(r.regionId)}>{r.name}</button>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMeasure(r.availability).replace(" MCM", "")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMeasure(r.demand).replace(" MCM", "")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMeasure(r.stressRatio)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtMeasure(r.dryStressRatio)}</td>
                <td className="py-2"><RiskPill label={r.risk} level={r.riskLevel} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
        Values: <MeasureBadge m={o.regional[0]?.availability} small /> (division splits of national AQUASTAT totals)
      </div>
    </Card>
  );
}

export default function CommandCenter() {
  const { region, scenario, key } = useRegionScenario();
  const setRegion = useAppStore((s) => s.setRegion);
  const qs = useShareQuery();
  const ov = useApi(`overview|${key}`, () => api.overview(region, scenario));
  const al = useApi(`alerts|${key}`, () => api.alerts(region, scenario));
  const map = useApi(`map|${key.split("|")[1]}`, () => api.mapLayers("bd", scenario));

  return (
    <div className="space-y-5">
      <PageHeader title="Command Center" description="National and divisional summary. Every number comes from the water-balance engine, the ML forecasts or the datasets listed on the Data Sources page, and shows its provenance." />
      <Async state={ov} rows={2} label="Loading overview">
        {(o) => (
          <>
            {o.context.scopeNote && o.context.region.level !== "country" && (
              <p className="-mt-2 text-[12.5px] text-muted">{o.context.region.name}: {o.context.scopeNote}</p>
            )}
            <Kpis o={o} />
            <div className="grid gap-5 lg:grid-cols-5">
              <Card className="lg:col-span-2" title="Bangladesh risk map" subtitle="Combined scarcity risk by division — click to select" actions={<MeasureBadge m={o.kpis.dryStressRatio} small />}>
                {map.data ? (
                  <BangladeshMap divisions={map.data.divisions as unknown as GeoJSON.FeatureCollection} districts={map.data.districts as unknown as GeoJSON.FeatureCollection}
                    values={map.data.values} layers={{ ...DEFAULT_LAYERS, terrain: false, extrude: false, rivers: false }} flat height={340}
                    selected={region} onSelect={setRegion} />
                ) : (
                  <Skeleton className="h-[340px] w-full" />
                )}
                <div className="mt-3"><RiskLegend /></div>
              </Card>
              <Card className="lg:col-span-3" title="Availability vs demand by month" subtitle="Climatological year; usable supply excludes the environmental reserve" actions={<MeasureBadge m={o.monthly[0]?.supply} small />}>
                <BalanceChart o={o} />
              </Card>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              <Card title="Sector-wise use" subtitle="Annual demand (MCM)" actions={<MeasureBadge m={o.sectors.agriculture} small />}>
                <SectorChart o={o} />
              </Card>
              <Card className="lg:col-span-2" title="Recent alerts & recommendations" subtitle="Rule-based; each shows the rule and the data that fired it">
                <Async state={al} rows={2} label="Loading alerts">
                  {(a) =>
                    a.alerts.length === 0 ? (
                      <p className="text-[13px] text-muted">No alert thresholds are crossed for this region and scenario.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {a.alerts.map((x) => (
                          <li key={x.id} className={`rounded-lg border border-border border-l-4 bg-white p-3 ${SEV_STYLE[x.severity]}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[13.5px] font-semibold">{x.title}</span>
                              <span className="text-[11px] uppercase tracking-wide text-muted">{x.severity}</span>
                            </div>
                            <p className="mt-0.5 text-[13px]">{x.message}</p>
                            <p className="mt-1 text-[12.5px] text-primary">{x.recommendation}</p>
                            <details className="mt-1 text-[12px] text-muted">
                              <summary className="cursor-pointer">Rule & data</summary>
                              <p>{x.rule}</p>
                              {Object.entries(x.inputs).map(([k, m]) => (
                                <div key={k} className="flex items-center gap-1.5">{k}: <MeasureText m={m} digits={2} /></div>
                              ))}
                              <Link href={`/${x.module}${qs}`} className="text-primary hover:underline">Open module →</Link>
                            </details>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Async>
              </Card>
            </div>
            <RegionalTable o={o} onSelect={setRegion} />
            <div className="grid gap-5 lg:grid-cols-2">
              {o.trends.map((t) => (
                <Card key={t.id} title={t.label} subtitle={`Last ${t.points.length} months · ${t.points[0]?.t} to ${t.points.at(-1)?.t} · teal = above normal, orange = below`} actions={<MeasureBadge m={t.points[0]?.v} small />}>
                  <Sparkline series={t} />
                </Card>
              ))}
            </div>
            {o.validation.length > 0 && (
              <Card title="Model checks against official statistics" subtitle="AquaGuard engine outputs compared with FAO AQUASTAT">
                <ul className="space-y-2 text-[13px]">
                  {o.validation.map((v) => (
                    <li key={v.label}>
                      <div className="font-medium">{v.label}</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>AquaGuard: <MeasureText m={v.model} /></span>
                        <span>Reference: <MeasureText m={v.reference} /></span>
                      </div>
                      <p className="text-[12px] text-muted">{v.note}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </Async>
      <div>
        <h2 className="mb-2 text-[15px] font-semibold">Modules</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <Link key={m.href} href={`${m.href}${qs}`} className="card flex items-start gap-3 p-3.5 transition hover:border-primary">
              <m.icon size={18} className="mt-0.5 text-primary" aria-hidden />
              <span>
                <span className="block text-[13.5px] font-semibold">{m.label}</span>
                <span className="block text-[12px] text-muted">{m.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
      <p className="text-[11.5px] text-muted" style={{ color: NEUTRAL.muted }}>
        Decision support only — does not replace field monitoring, laboratory testing or government water systems.
      </p>
    </div>
  );
}
