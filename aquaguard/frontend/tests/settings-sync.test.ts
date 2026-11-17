import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { volumePlot } from "../lib/charts/volume";
import { convertVolume, fmtVolume } from "../lib/format";
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, useAppStore } from "../lib/store";

beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  } });
  useAppStore.setState({ prefs: { ...DEFAULT_PREFS }, selectedRegion: "bd" });
});

afterEach(() => {
  useAppStore.setState({ prefs: { ...DEFAULT_PREFS }, selectedRegion: "bd" });
  vi.unstubAllGlobals();
});

describe("one persisted region and unit preference", () => {
  it("header selection updates the settings region and saved preference", () => {
    useAppStore.getState().setRegion("dhaka");
    expect(useAppStore.getState().selectedRegion).toBe("dhaka");
    expect(useAppStore.getState().prefs.defaultRegion).toBe("dhaka");
    expect(loadPrefs().defaultRegion).toBe("dhaka");
  });

  it("settings changes publish one consistent active region and unit snapshot", () => {
    const changes: string[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      changes.push(`${state.selectedRegion}/${state.prefs.defaultRegion}/${state.prefs.volumeUnit}`);
    });
    useAppStore.getState().setPrefs({ defaultRegion: "sylhet", volumeUnit: "km3" });
    unsubscribe();
    expect(changes).toEqual(["sylhet/sylhet/km3"]);
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!)).toMatchObject({ defaultRegion: "sylhet", volumeUnit: "km3" });
  });

  it("unit changes preserve the selected region and active scenario", () => {
    useAppStore.getState().setRegion("rangpur");
    const scenario = useAppStore.getState().activeScenario;
    useAppStore.getState().setPrefs({ volumeUnit: "MCM" });
    expect(useAppStore.getState().selectedRegion).toBe("rangpur");
    expect(useAppStore.getState().activeScenario).toBe(scenario);
    expect(loadPrefs()).toMatchObject({ defaultRegion: "rangpur", volumeUnit: "MCM" });
  });
});

describe("volume conversion across displays and plots", () => {
  it("converts daily cubic-metre volumes without losing small nonzero results", () => {
    useAppStore.getState().setPrefs({ volumeUnit: "km3" });
    expect(convertVolume(43200, "m³/day").v).toBeCloseTo(0.0000432, 12);
    expect(convertVolume(43200, "m³/day").unit).toBe("km³/day");
    expect(fmtVolume(43200, "m³/day")).toBe("0.0000432 km³/day");
    expect(convertVolume(12, "mm")).toEqual({ v: 12, unit: "mm" });
    expect(convertVolume(30, "m")).toEqual({ v: 30, unit: "m" });
  });

  it("scales volume traces, uncertainty, table inputs and axis labels without mutating source data", () => {
    const data = [{ x: [2025, 2026], y: [1000, null], error_y: { type: "data", array: [100, null] },
      hovertemplate: "%{y:,.0f} MCM" }];
    const layout = { yaxis: { title: { text: "Delivered (MCM)" } }, xaxis: { title: { text: "Year" } } };
    const result = volumePlot(data, layout, "MCM", "km3");
    expect(result.data[0]).toMatchObject({ x: [2025, 2026], y: [1, null], error_y: { array: [0.1, null] } });
    expect(result.layout).toMatchObject({ yaxis: { title: { text: "Delivered (km³)" } } });
    expect(result.data[0].hovertemplate).toContain("km³");
    expect(data[0].y).toEqual([1000, null]);
    expect(layout.yaxis.title.text).toBe("Delivered (MCM)");
  });

  it("converts horizontal values while retaining categories and published units when requested", () => {
    const source = [{ orientation: "h", x: [2, 3], y: ["Domestic", "Industry"] }];
    expect(volumePlot(source, {}, "km³/yr", "MCM").data[0]).toMatchObject({ x: [2000, 3000], y: source[0].y });
    expect(volumePlot(source, {}, "km³/yr", "native").data[0].x).toEqual([2, 3]);
  });
});
