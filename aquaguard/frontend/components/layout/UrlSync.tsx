"use client";
/**
 * Mirrors the global store in the URL (?region=dhaka&from=2025-01&to=2026-10&rain=-20...) so any view can be shared
 * and reloaded. On first load it also restores saved preferences (default region when the URL has none) and applies
 * the motion / transparency preferences to <html>.
 */
import { useEffect, useRef } from "react";
import { hydrateSaved, loadPrefs, PREFS_KEY, useAppStore } from "@/lib/store";
import { scenarioFromParams, scenarioToParams } from "@/lib/store/scenario";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseRange(p: URLSearchParams): { from: string | null; to: string | null } {
  const from = p.get("from");
  const to = p.get("to");
  const f = from && MONTH.test(from) ? from : null;
  const t = to && MONTH.test(to) ? to : null;
  return f && t && f > t ? { from: t, to: f } : { from: f, to: t };
}

export function UrlSync() {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  const range = useAppStore((s) => s.dateRange);
  const motion = useAppStore((s) => s.prefs.motion);
  const reduceTransparency = useAppStore((s) => s.prefs.reduceTransparency);
  const hydrated = useRef(false);

  useEffect(() => {
    hydrateSaved();
    const p = new URLSearchParams(window.location.search);
    const st = useAppStore.getState();
    st.setRegion(p.get("region") || st.prefs.defaultRegion || "bd");
    st.setScenario(scenarioFromParams(p));
    st.setDateRange(parseRange(p));
    hydrated.current = true;
    const onStorage = (event: StorageEvent) => {
      if (event.key === PREFS_KEY || event.key === null) useAppStore.getState().setPrefs(loadPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (motion === "system") el.removeAttribute("data-motion");
    else el.setAttribute("data-motion", motion);
    if (reduceTransparency) el.setAttribute("data-transparency", "reduce");
    else el.removeAttribute("data-transparency");
  }, [motion, reduceTransparency]);

  useEffect(() => {
    if (!hydrated.current) return;
    // Initial hydration updates the store before this effect's first captured render has caught up.
    const current = useAppStore.getState();
    const p = scenarioToParams(current.activeScenario, new URLSearchParams(window.location.search));
    if (current.selectedRegion && current.selectedRegion !== "bd") p.set("region", current.selectedRegion);
    else p.delete("region");
    for (const k of ["from", "to"] as const) {
      if (current.dateRange[k]) p.set(k, current.dateRange[k] as string);
      else p.delete(k);
    }
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [region, scenario, range]);

  return null;
}

/** Current shareable query string (for links between modules). */
export function useShareQuery(): string {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  const range = useAppStore((s) => s.dateRange);
  const p = scenarioToParams(scenario);
  if (region !== "bd") p.set("region", region);
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}
