"use client";
/** Global state (Zustand): selected region + active scenario, mirrored in the URL by <UrlSync/>. */
import { create } from "zustand";
import { BASELINE, type Scenario } from "../types/contract";

interface AppState {
  selectedRegion: string;
  activeScenario: Scenario;
  lastUpdated: string | null;
  copilotOpen: boolean;
  setRegion: (id: string) => void;
  setScenario: (s: Scenario) => void;
  resetScenario: () => void;
  touch: () => void;
  setCopilotOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedRegion: "bd",
  activeScenario: { ...BASELINE },
  lastUpdated: null,
  copilotOpen: false,
  setRegion: (id) => set({ selectedRegion: id, lastUpdated: new Date().toISOString() }),
  setScenario: (s) => set({ activeScenario: { ...s }, lastUpdated: new Date().toISOString() }),
  resetScenario: () => set({ activeScenario: { ...BASELINE }, lastUpdated: new Date().toISOString() }),
  touch: () => set({ lastUpdated: new Date().toISOString() }),
  setCopilotOpen: (open) => set({ copilotOpen: open }),
}));
