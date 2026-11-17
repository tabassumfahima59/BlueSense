import { describe, expect, it } from "vitest";
import { availableIndices, drynessInterpretation, rhythmPoints, rhythmValue, shiftMonth, waveformPaths } from "../lib/weather/rhythm";
import type { WeatherSeries } from "../lib/types/contract";

const history: WeatherSeries = {
  region: { id: "dhaka", name: "Dhaka", level: "division" }, step: "monthly", timezone: "Asia/Dhaka",
  start: "2025-01", end: "2025-03", series: [
    { variable: "precip_mm", label: "Rain", unit: "mm", t: ["2025-01", "2025-03"], v: [70, 30] },
    { variable: "d_mm", label: "Balance", unit: "mm", t: ["2025-01", "2025-03"], v: [20, -10] },
    { variable: "et0_mm", label: "ET0", unit: "mm", t: ["2025-01", "2025-03"], v: [50, 40] },
    { variable: "dryness_3m", label: "Dryness", unit: "z-score", t: ["2025-01", "2025-03"], v: [null, -1.2] },
  ], normals: [{ variable: "precip_mm", label: "Normal", unit: "mm", t: ["2025-03", "2025-01"], v: [50, 40] }],
};

describe("Water Rhythm data integrity", () => {
  it("aligns normals by month and keeps missing calendar months null", () => {
    const points = rhythmPoints(history);
    expect(points.map((p) => p.month)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(points.map((p) => p.rainfallAnomaly)).toEqual([30, null, -20]);
    expect(points[1].balance).toBeNull();
    expect(points[1].dryness).toBeNull();
  });
  it("keeps raw water balance separate from rainfall anomaly and uses only backend dryness", () => {
    const points = rhythmPoints(history);
    expect(rhythmValue(points[0], "balance")).toBe(20);
    expect(rhythmValue(points[0], "rainfall")).toBe(30);
    expect(availableIndices(points, "dryness")).toEqual([2]);
    expect(rhythmValue(points[2], "dryness")).toBe(-1.2);
  });
  it("does not invent normals or replace an unavailable range", () => {
    expect(rhythmPoints({ ...history, normals: [] }).every((p) => p.rainfallAnomaly === null)).toBe(true);
    expect(rhythmPoints({ ...history, series: [] })).toEqual([]);
  });
  it("creates separate scientific paths across every gap, including a valid zero", () => {
    expect(waveformPaths([1, 0, null, -2], (i) => i, (v) => v)).toEqual(["M0.00,1.00L1.00,0.00", "M3.00,-2.00"]);
  });
  it("handles cross-year three-month windows and established dry/wet thresholds", () => {
    expect(shiftMonth("2026-01", -2)).toBe("2025-11");
    expect(drynessInterpretation(-1)).toBe("Moderately dry");
    expect(drynessInterpretation(1)).toBe("Moderately wet");
    expect(drynessInterpretation(0)).toBe("Near normal");
  });
});
