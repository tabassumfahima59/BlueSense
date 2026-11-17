"use client";
import { createContext, createElement, useCallback, useContext, useState, type ReactNode } from "react";
import { effectiveRange, useDateBounds } from "@/components/layout/DateFilter";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";

/** One weather source for Water Rhythm and both existing monthly charts. */
export function useCommandWeather(region: string) {
  const probe = useApi(`wh-rhythm-probe|${region}`, () => api.weatherHistory(region, { normals: true, dryness: true }));
  const currentProbe = probe.data?.data.region.id === region ? probe.data : undefined;
  const times = currentProbe?.data.series.flatMap((s) => s.t).sort() ?? [];
  const first = times[0] ?? null, latest = times.at(-1) ?? null;
  const bounds = latest ? { min: "1991-01", max: latest.slice(0, 7), label: "Weather trends",
    defaultFrom: first?.slice(0, 7), defaultTo: latest.slice(0, 7) } : null;
  useDateBounds(bounds);
  const dateRange = useAppStore((s) => s.dateRange);
  const custom = Boolean(dateRange.from || dateRange.to);
  const eff = effectiveRange(dateRange, bounds);
  const ranged = useApi(custom && eff.from ? `wh-rhythm-range|${region}|${eff.from}|${eff.to}` : null,
    () => api.weatherHistory(region, { start: eff.from!, end: eff.to!, normals: true, dryness: true }));
  const useRanged = custom && Boolean(eff.from);
  const src = useRanged ? ranged : probe;
  // useApi retains its previous value while fetching; never display that old region/range as this selection.
  const matches = src.data?.data.region.id === region && (!useRanged ||
    (src.data?.data.start === eff.from && src.data?.data.end === eff.to));
  return { ...src, data: matches ? src.data : undefined,
    loading: src.loading || (!matches && !src.error), scope: `${region}|${eff.from}|${eff.to}` };
}

type WeatherState = ReturnType<typeof useCommandWeather>;
const CommandWeatherContext = createContext<{
  weather: WeatherState;
  selectedMonth: string | null;
  onMonth: (month: string | null) => void;
} | null>(null);

/** Page-local provider keeps the top timeline and lower charts on one request and selection. */
export function CommandWeatherProvider({ region, children }: { region: string; children: ReactNode }) {
  const weather = useCommandWeather(region);
  const [selection, setSelection] = useState<{ scope: string; month: string | null } | null>(null);
  const onMonth = useCallback((month: string | null) => {
    setSelection((current) => current?.scope === weather.scope && current.month === month
      ? current : { scope: weather.scope, month });
  }, [weather.scope]);
  const selectedMonth = !weather.loading && !weather.error && selection?.scope === weather.scope ? selection.month : null;
  return createElement(CommandWeatherContext.Provider, { value: { weather, selectedMonth, onMonth } }, children);
}

export function useCommandWeatherState() {
  const context = useContext(CommandWeatherContext);
  if (!context) throw new Error("Command Center weather must be inside CommandWeatherProvider");
  return context;
}
