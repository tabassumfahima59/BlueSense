"use client";
/** Mirrors the global store in the URL (?region=dhaka&rain=-20...) so any view can be shared and reloaded. */
import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { scenarioFromParams, scenarioToParams } from "@/lib/store/scenario";

export function UrlSync() {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  const hydrated = useRef(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const st = useAppStore.getState();
    const r = p.get("region");
    if (r) st.setRegion(r);
    st.setScenario(scenarioFromParams(p));
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const p = scenarioToParams(scenario, new URLSearchParams(window.location.search));
    if (region && region !== "bd") p.set("region", region);
    else p.delete("region");
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [region, scenario]);

  return null;
}

/** Current shareable query string (for links between modules). */
export function useShareQuery(): string {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  const p = scenarioToParams(scenario);
  if (region !== "bd") p.set("region", region);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}
