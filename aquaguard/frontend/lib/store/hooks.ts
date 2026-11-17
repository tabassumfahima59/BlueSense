"use client";
import { useAppStore } from ".";
import { scenarioQuery } from "./scenario";

/** Subscribe displays to the shared unit preference without resetting their local controls. */
export function useVolumeUnit() {
  return useAppStore((s) => s.prefs.volumeUnit);
}

/** Region + scenario with a stable cache key for API hooks. */
export function useRegionScenario() {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  return { region, scenario, key: `${region}|${scenarioQuery(scenario)}` };
}
