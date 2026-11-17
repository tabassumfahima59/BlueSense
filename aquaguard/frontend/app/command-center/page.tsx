"use client";
/**
 * M1 Command Center (master prompt §6.1): five KPIs with detail drawers, key insights, stored alerts, the
 * weather-derived scarcity map and regional table, availability vs demand by reference year, weather trends that
 * follow the date filter, and model checks. Every value comes from the P3 endpoints with its source, date and status;
 * national statistics are labelled "National data" when a division is selected and are never split.
 */
import { useEffect, useState } from "react";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";
import { useVolumeUnit } from "@/lib/store/hooks";
import type { Kpi } from "@/lib/types/contract";
import { Insights } from "./alerts";
import { DivisionTable, ScarcityMap } from "./divisions";
import { KpiDrawer, KpiGrid } from "./kpis";
import { WeatherTrends } from "./trends";
import { WaterRhythm } from "./water-rhythm";
import { CommandWeatherProvider } from "./weather-history";

export default function CommandCenter() {
  useVolumeUnit();
  const region = useAppStore((s) => s.selectedRegion);
  const setRegion = useAppStore((s) => s.setRegion);
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

  return (
    <CommandWeatherProvider region={region}>
      <div className="space-y-5">
        <WaterRhythm />

        {summary.error && <ErrorCard error={summary.error} onRetry={summary.retry} />}
        {!summary.data && !summary.error && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4" role="status" aria-label="Loading key figures">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[150px] w-full" />)}
          </div>
        )}
        {summary.data && <KpiGrid data={summary.data.data} onOpen={(k) => setDrawer(k.key)} />}

        {summary.data ? <Insights items={summary.data.data.insights ?? []} /> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading key insights">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        )}

        {divisions.error && <ErrorCard error={divisions.error} onRetry={divisions.retry} />}
        {!divisions.data && !divisions.error && <Skeleton className="h-[420px] w-full" />}
        {divisions.data && (
          <ScarcityMap data={divisions.data.data} selected={region} onSelect={setRegion} />
        )}

        {valid && <WeatherTrends />}
        {divisions.data && <DivisionTable data={divisions.data.data} selected={region} onSelect={setRegion} />}

        <KpiDrawer kpi={kpi} region={region} onClose={() => setDrawer(null)} target={target} onTarget={setTarget} />
      </div>
    </CommandWeatherProvider>
  );
}
