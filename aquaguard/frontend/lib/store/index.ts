"use client";
/**
 * Global state (Zustand): region, date range and scenario (mirrored in the URL by <UrlSync/>), shell state and
 * saved preferences (localStorage, read/write wrapped so a blocked storage never breaks the page).
 */
import { create } from "zustand";
import { BASELINE, type Scenario } from "../types/contract";

export type VolumeUnit = "native" | "MCM" | "km3";
export type MotionPref = "system" | "reduce" | "allow";

export interface Prefs {
  defaultRegion: string;
  volumeUnit: VolumeUnit;
  motion: MotionPref;
  reduceTransparency: boolean;
}

export const DEFAULT_PREFS: Prefs = { defaultRegion: "bd", volumeUnit: "native", motion: "system", reduceTransparency: false };
const PREFS_KEY = "aquaguard.prefs.v1";
const SIDEBAR_KEY = "aquaguard.sidebar.collapsed";
const CLIENT_KEY = "aquaguard.clientId";

export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting lasts for this visit only */
  }
}

export function loadPrefs(): Prefs {
  const raw = storageGet(PREFS_KEY);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      defaultRegion: typeof p.defaultRegion === "string" ? p.defaultRegion : DEFAULT_PREFS.defaultRegion,
      volumeUnit: p.volumeUnit === "MCM" || p.volumeUnit === "km3" ? p.volumeUnit : "native",
      motion: p.motion === "reduce" || p.motion === "allow" ? p.motion : "system",
      reduceTransparency: p.reduceTransparency === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Anonymous per-browser id for alert read marks (no login exists). */
export function clientId(): string {
  const have = storageGet(CLIENT_KEY);
  if (have && /^[A-Za-z0-9_-]{8,64}$/.test(have)) return have;
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  storageSet(CLIENT_KEY, id);
  return id;
}

export interface DateRange {
  from: string | null; // YYYY-MM
  to: string | null; // YYYY-MM
}

/** Months a page has data for; a page that uses dates registers it, which shows the date filter (see DateFilter). */
export interface DateBounds {
  min: string; // YYYY-MM
  max: string; // YYYY-MM
  label: string; // what the range applies to
  defaultFrom?: string; // the window the page shows when no range is chosen (defaults to min..max)
  defaultTo?: string;
}

interface AppState {
  selectedRegion: string;
  activeScenario: Scenario;
  dateRange: DateRange;
  dateBounds: DateBounds | null;
  lastUpdated: string | null;
  copilotOpen: boolean;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  prefs: Prefs;
  dataVersion: number;
  setRegion: (id: string) => void;
  setScenario: (s: Scenario) => void;
  resetScenario: () => void;
  setDateRange: (r: DateRange) => void;
  setDateBounds: (b: DateBounds | null) => void;
  touch: () => void;
  setCopilotOpen: (open: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  bumpData: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  selectedRegion: "bd",
  activeScenario: { ...BASELINE },
  dateRange: { from: null, to: null },
  dateBounds: null,
  lastUpdated: null,
  copilotOpen: false,
  sidebarCollapsed: false,
  paletteOpen: false,
  prefs: { ...DEFAULT_PREFS },
  dataVersion: 0,
  setRegion: (id) => set({ selectedRegion: id, lastUpdated: new Date().toISOString() }),
  setScenario: (s) => set({ activeScenario: { ...s }, lastUpdated: new Date().toISOString() }),
  resetScenario: () => set({ activeScenario: { ...BASELINE }, lastUpdated: new Date().toISOString() }),
  setDateRange: (r) => set({ dateRange: { ...r } }),
  setDateBounds: (b) => set({ dateBounds: b }),
  touch: () => set({ lastUpdated: new Date().toISOString() }),
  setCopilotOpen: (open) => set({ copilotOpen: open }),
  setSidebarCollapsed: (v) => {
    storageSet(SIDEBAR_KEY, v ? "1" : "0");
    set({ sidebarCollapsed: v });
  },
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    storageSet(PREFS_KEY, JSON.stringify(prefs));
    set({ prefs });
  },
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));

/** Read saved shell state once on the client (called from <UrlSync/>). */
export function hydrateSaved(): void {
  useAppStore.setState({ prefs: loadPrefs(), sidebarCollapsed: storageGet(SIDEBAR_KEY) === "1" });
}
