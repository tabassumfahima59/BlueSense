"use client";
import { useAppStore } from ".";
import { scenarioQuery } from "./scenario";

/** Region + scenario with a stable cache key for API hooks. */
export function useRegionScenario() {
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  return { region, scenario, key: `${region}|${scenarioQuery(scenario)}` };
}
