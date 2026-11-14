import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tracesToTable } from "../lib/charts/table";
import { convertVolume, displayUnit, fmtMeasure, setVolumeDisplay } from "../lib/format";
import { fmtAgo, monthLabel } from "../lib/format/time";
import { effectiveRange, inRange } from "../components/layout/DateFilter";
import { parseRange } from "../components/layout/UrlSync";
import { matchLocal } from "../components/layout/CommandPalette";
import { timeLabel } from "../components/ui/DataStatus";
import type { Measure } from "../lib/types/contract";

// ---------------------------------------------------------------- WCAG contrast of the design tokens
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} missing`);
  return m[1];
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("design tokens meet WCAG 2.1 AA", () => {
  const surfaces = ["bg", "card", "light"];
  it.each(surfaces)("ink and muted text are >= 4.5:1 on %s", (s) => {
    expect(ratio(token("ink"), token(s))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("muted"), token(s))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("primary"), token(s))).toBeGreaterThanOrEqual(4.5); // links
  });
  it("white text on primary and deep blue (buttons, sidebar)", () => {
    expect(ratio("#ffffff", token("primary"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", token("primary-dark"))).toBeGreaterThanOrEqual(4.5);
  });
  it("status text colours are >= 4.5:1 on white", () => {
    for (const t of ["success", "warning", "orange", "risk"]) expect(ratio(token(t), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
  it("form-control borders are >= 3:1 (WCAG 1.4.11)", () => {
    expect(ratio(token("control"), "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  it("sky blue is decoration only (below text contrast) and accent only for large text (>= 3:1)", () => {
    expect(ratio(token("sky"), "#ffffff")).toBeLessThan(3);
    expect(ratio(token("accent"), "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- chart table view
describe("tracesToTable", () => {
  it("joins traces on x and keeps gaps", () => {
    const t = tracesToTable([
      { name: "Supply", x: ["Jan", "Feb"], y: [10, 12] },
      { name: "Demand", x: ["Feb", "Mar"], y: [5, null] },
    ], "Month");
    expect(t).toEqual({ head: ["Month", "Supply", "Demand"], rows: [["Jan", 10, null], ["Feb", 12, 5], ["Mar", null, null]] });
  });
  it("uses categories of horizontal bars and returns null without tabular data", () => {
    expect(tracesToTable([{ orientation: "h", y: ["a", "b"], x: [1, 2] }])?.rows).toEqual([["a", 1], ["b", 2]]);
    expect(tracesToTable([{ type: "heatmap", z: [[1]] }])).toBeNull();
  });
});

// ---------------------------------------------------------------- units preference
describe("volume units", () => {
  const m = (value: number, unit: string): Measure => ({ value, unit, provenance: "historical", isSample: false });
  it("converts km³ and MCM both ways and leaves other units alone", () => {
    expect(convertVolume(1.5, "km³/yr", "MCM")).toEqual({ v: 1500, unit: "MCM/yr" });
    expect(convertVolume(2500, "MCM", "km3")).toEqual({ v: 2.5, unit: "km³" });
    expect(convertVolume(3, "mm", "km3")).toEqual({ v: 3, unit: "mm" });
    expect(convertVolume(3, "km³", "native")).toEqual({ v: 3, unit: "km³" });
  });
  it("fmtMeasure follows the preference", () => {
    setVolumeDisplay("MCM");
    expect(fmtMeasure(m(1.227, "km³/yr"))).toBe("1,227 MCM/yr");
    expect(displayUnit("km³/yr")).toBe("MCM/yr");
    setVolumeDisplay("native");
    expect(fmtMeasure(m(1227.032, "km³/yr"))).toBe("1,227 km³/yr");
  });
});

// ---------------------------------------------------------------- date filter and URL
describe("date range", () => {
  const b = { min: "2024-11", max: "2026-10", label: "Monthly trends" };
  it("clamps to the page's bounds and swaps reversed ends", () => {
    expect(effectiveRange({ from: null, to: null }, b)).toEqual({ from: "2024-11", to: "2026-10" });
    expect(effectiveRange({ from: "2020-01", to: "2025-06" }, b)).toEqual({ from: "2024-11", to: "2025-06" });
    expect(effectiveRange({ from: "2026-01", to: null }, null)).toEqual({ from: null, to: null });
  });
  it("filters monthly and daily points", () => {
    expect(inRange("2025-03", { from: "2025-01", to: "2025-06" })).toBe(true);
    expect(inRange("2025-07-02", { from: "2025-01", to: "2025-06" })).toBe(false);
  });
  it("parses ?from/?to and ignores invalid values", () => {
    expect(parseRange(new URLSearchParams("from=2026-05&to=2025-01"))).toEqual({ from: "2025-01", to: "2026-05" });
    expect(parseRange(new URLSearchParams("from=2026-13&to=abc"))).toEqual({ from: null, to: null });
  });
});

// ---------------------------------------------------------------- search and status labels
describe("palette and status", () => {
  it("matches modules locally", () => {
    expect(matchLocal("irrig").map((i) => i.href)).toEqual(["/irrigation"]);
    expect(matchLocal("").length).toBeGreaterThanOrEqual(10);
  });
  it("labels time honestly per data kind", () => {
    expect(timeLabel({ status: "fresh", kind: "forecast" })).toBe("Live");
    expect(timeLabel({ status: "stale", kind: "forecast", retrievedAt: "2026-11-13T17:21:28Z" })).toMatch(/^Stale · updated/);
    expect(timeLabel({ status: "fresh", kind: "satellite_monthly", observedAt: "2026-09-01" })).toBe("Latest: Sep 2026");
    expect(timeLabel({ status: "fresh", kind: "statistic", referenceYear: 2008 })).toBe("Reference year 2008");
    expect(timeLabel({ status: "fresh", kind: "statistic" })).toBe("Statistic");
    expect(timeLabel({ status: "not_configured", kind: "satellite_monthly" })).toBe("Not configured");
    expect(monthLabel("2026-09")).toBe("Sep 2026");
    expect(fmtAgo("2026-11-13T10:00:00Z", new Date("2026-11-13T13:00:00Z"))).toBe("3 h ago");
  });
});
