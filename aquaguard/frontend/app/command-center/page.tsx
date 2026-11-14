"use client";
/**
 * M1 Command Center (master prompt §6.1): five KPIs with detail drawers, key insights, stored alerts, the
 * weather-derived scarcity map and regional table, availability vs demand by reference year, weather trends that
 * follow the date filter, and model checks. Every value comes from the P3 endpoints with its source, date and status;
 * national statistics are labelled "National data" when a division is selected and are never split.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { MODULES } from "@/components/layout/nav";
import { useShareQuery } from "@/components/layout/UrlSync";
import { PageHeader } from "@/components/ui/Card";
import { DataStatusBadge, fromMeta } from "@/components/ui/DataStatus";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";
import type { Kpi } from "@/lib/types/contract";
import { AlertsPanel, Insights } from "./alerts";
import { DivisionTable, ScarcityMap } from "./divisions";
import { KpiDrawer, KpiGrid } from "./kpis";
import { AvailabilityDemand, ModelChecks, WeatherTrends } from "./trends";

export default function CommandCenter() {
  const region = useAppStore((s) => s.selectedRegion);
  const setRegion = useAppStore((s) => s.setRegion);
  const qs = useShareQuery();
  const regions = useApi("regions", api.regions);
  // the new API serves the country and the eight divisions; wait until a district id has been mapped to its division
  const valid = region === "bd" || Boolean(regions.data?.divisions.some((d) => d.id === region));
  const [target, setTarget] = useState(0.85);
  const [targetQ, setTargetQ] = useState(0.85); // debounced: one request after the slider stops
  useEffect(() => {
    const t = setTimeout(() => setTargetQ(target), 250);
    return () => clearTimeout(t);
  }, [target]);
  const summary = useApi(valid ? `dashboard|${region}|${targetQ}` : null, () => api.dashboard(region, targetQ));
  const divisions = useApi("divisions", api.divisions);
  const [drawer, setDrawer] = useState<string | null>(null);
  const kpi: Kpi | null = summary.data?.data.kpis.find((k) => k.key === drawer) ?? null;
  const name = summary.data?.data.region.name;
  const national = region === "bd";

  return (
    <div className="space-y-5">
      <PageHeader title="Command Center"
                  description="Water availability, demand, stress and storage for Bangladesh, with weather-based conditions per division. Every value shows what it is, its source, its date and whether it is current.">
        {summary.data && <DataStatusBadge info={fromMeta(summary.data.meta)} />}
      </PageHeader>
      {!national && name && (
        <p className="-mt-2 rounded-lg border border-primary/20 bg-light/70 px-3 py-2 text-[12.5px] text-ink">
          <strong className="font-semibold">{name}:</strong> availability, water stress, storage and saving are <strong>national data</strong>
          {" "}(AQUASTAT and GRACE have no division values); demand and the weather indicators are for {name}&apos;s representative point.
        </p>
      )}

      {summary.error && <ErrorCard error={summary.error} onRetry={summary.retry} />}
      {!summary.data && !summary.error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" role="status" aria-label="Loading key figures">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[150px] w-full" />)}
        </div>
      )}
      {summary.data && <KpiGrid data={summary.data.data} onOpen={(k) => setDrawer(k.key)} />}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          {summary.data ? <Insights items={summary.data.data.insights ?? []} /> : <Skeleton className="h-64 w-full" />}
        </div>
        <div className="lg:col-span-3"><AlertsPanel region={valid ? region : "bd"} /></div>
      </div>

      {divisions.error && <ErrorCard error={divisions.error} onRetry={divisions.retry} />}
      {!divisions.data && !divisions.error && <Skeleton className="h-[420px] w-full" />}
      {divisions.data && (
        <>
          <div className="grid gap-5 xl:grid-cols-5">
            <div className="xl:col-span-2"><ScarcityMap data={divisions.data.data} selected={region} onSelect={setRegion} /></div>
            <div className="xl:col-span-3"><AvailabilityDemand national={national} /></div>
          </div>
          <DivisionTable data={divisions.data.data} selected={region} onSelect={setRegion} />
        </>
      )}

      {valid && <WeatherTrends region={region} />}
      {national && <ModelChecks />}

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
      <p className="text-[11.5px] text-muted">Decision support only — does not replace field monitoring, laboratory testing or government water systems.</p>

      <KpiDrawer kpi={kpi} region={region} onClose={() => setDrawer(null)} target={target} onTarget={setTarget} />
    </div>
  );
}
