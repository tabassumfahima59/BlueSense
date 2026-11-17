import { describe, expect, it } from "vitest";
import { TONE_COLOR } from "../components/charts/theme";
import { cellsToGeoJSON, GRACE_CELL_DEG, graceColor, graceColorExpression, graceTone, pointsToGeoJSON } from "../components/maps/overlays";

/** Minimal evaluator for the MapLibre `case` expression produced by graceColorExpression(). */
function evalCase(expr: unknown[], v: number): string {
  for (let i = 1; i < expr.length - 1; i += 2) {
    const [op, , bound] = expr[i] as [string, unknown, number];
    if (op === "<=" ? v <= bound : v < bound) return expr[i + 1] as string;
  }
  return expr[expr.length - 1] as string;
}

describe("GRACE display bins", () => {
  it("a boundary value belongs to the class farther from neutral", () => {
    expect(graceTone(-20)).toBe(-3);
    expect(graceTone(-10)).toBe(-2);
    expect(graceTone(-3)).toBe(-1);
    expect(graceTone(-2.99)).toBe(0);
    expect(graceTone(0)).toBe(0);
    expect(graceTone(3)).toBe(1);
    expect(graceTone(10)).toBe(2);
    expect(graceTone(20)).toBe(3);
    expect(graceTone(null)).toBeNull();
  });

  it("the 3D (MapLibre) and 2D colours agree for every value", () => {
    const expr = graceColorExpression();
    for (let v = -40; v <= 40; v += 0.5) expect(evalCase(expr, v)).toBe(graceColor(v));
    expect(graceColor(-25)).toBe(TONE_COLOR[-3]);
  });
});

describe("map overlays", () => {
  it("draws each GRACE cell as a 0.25° square around its centre", () => {
    const fc = cellsToGeoJSON([{ id: "c", lat: 23.125, lon: 90.375, v: 1.5 }]);
    const ring = fc.features[0].geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[2][0] - ring[0][0]).toBeCloseTo(GRACE_CELL_DEG);
    expect(ring[2][1] - ring[0][1]).toBeCloseTo(GRACE_CELL_DEG);
    expect(fc.features[0].properties).toMatchObject({ id: "c", v: 1.5 });
  });

  it("weather points keep their division id and coordinates", () => {
    const fc = pointsToGeoJSON([{ id: "dhaka", name: "Dhaka", lat: 23.81, lon: 90.41, pointKind: "representative_point", validTime: null, temperature: null, precipitation: null }]);
    expect(fc.features[0].geometry.coordinates).toEqual([90.41, 23.81]);
    expect(fc.features[0].properties).toMatchObject({ id: "dhaka", name: "Dhaka" });
  });
});
