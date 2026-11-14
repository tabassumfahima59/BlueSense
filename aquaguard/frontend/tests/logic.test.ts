import { describe, expect, it } from "vitest";
import { fmtMeasure, toCsv } from "../lib/format";
import { rebalance } from "../lib/format/shares";
import { describeScenario, isBaseline, scenarioFromParams, scenarioQuery, scenarioToParams } from "../lib/store/scenario";
import { BASELINE, type Measure } from "../lib/types/contract";

const m = (value: number | null, unit: string): Measure => ({ value, unit, provenance: "estimated", isSample: false });

describe("scenario URL round trip", () => {
  it("baseline produces an empty query", () => {
    expect(scenarioToParams(BASELINE).toString()).toBe("");
    expect(scenarioQuery(BASELINE)).toBe("");
    expect(isBaseline(scenarioFromParams(new URLSearchParams("")))).toBe(true);
  });

  it("round-trips all seven levers", () => {
    const s = { rainfallChangePct: -20, temperatureChangeC: 1.5, demandChangePct: 10, agriculturalDemandChangePct: 15, groundwaterAvailabilityPct: -30, irrigationEfficiency: 0.75, pipelineLossPct: 30 };
    const p = scenarioToParams(s);
    expect(p.get("rain")).toBe("-20");
    expect(p.get("agri")).toBe("15");
    expect(describeScenario(s)).toContain("Agriculture +15%");
    expect(scenarioFromParams(p)).toEqual(s);
    expect(scenarioQuery(s)).toContain("rainfallChangePct=-20");
    expect(describeScenario(s)).toContain("Rain -20%");
  });

  it("clamps out-of-range and ignores garbage", () => {
    const s = scenarioFromParams(new URLSearchParams("rain=-90&temp=abc&eff=2"));
    expect(s.rainfallChangePct).toBe(-50);
    expect(s.temperatureChangeC).toBe(0);
    expect(s.irrigationEfficiency).toBe(0.9);
  });

  it("keeps unrelated params such as region", () => {
    const p = scenarioToParams({ ...BASELINE, rainfallChangePct: 10 }, new URLSearchParams("region=dhaka"));
    expect(p.get("region")).toBe("dhaka");
  });
});

describe("allocation shares always sum to 100", () => {
  it("rebalances the other sectors proportionally", () => {
    const s = rebalance({ agriculture: 40, domestic: 20, industry: 10, environment: 30 }, "agriculture", 70);
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(s.agriculture).toBe(70);
    expect(s.environment / s.domestic).toBeCloseTo(1.5, 1);
  });

  it("handles extremes", () => {
    for (const v of [0, 100, 33.3, 99.9]) {
      const s = rebalance({ a: 25, b: 25, c: 25, d: 25 }, "a", v);
      expect(Object.values(s).reduce((x, y) => x + y, 0)).toBeCloseTo(100, 6);
    }
    const z = rebalance({ a: 100, b: 0, c: 0 }, "a", 40);
    expect(z.b).toBe(30);
  });
});

describe("formatting", () => {
  it("renders ratios as percentages and keeps units", () => {
    expect(fmtMeasure(m(0.504, "ratio"))).toBe("50.4%");
    expect(fmtMeasure(m(1215195, "MCM"))).toBe("1,215,195 MCM");
    expect(fmtMeasure(m(null, "MCM"))).toBe("—");
    expect(fmtMeasure(m(5, "%"), { signed: true })).toBe("+5%");
  });

  it("escapes CSV fields", () => {
    expect(toCsv([["a,b", 'q"x', 1]])).toBe('"a,b","q""x",1');
  });
});
