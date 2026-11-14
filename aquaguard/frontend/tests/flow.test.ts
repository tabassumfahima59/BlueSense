import { describe, expect, it } from "vitest";
import { particleStep } from "../components/three/flow";

describe("flow animation controls", () => {
  it("nothing moves while paused or at zero speed", () => {
    expect(particleStep(0.3, 1.2, 1, 0.016, 10, false)).toBe(0.3);
    expect(particleStep(0.3, 1.2, 0, 0.016, 10, true)).toBe(0.3);
  });

  it("the speed setting scales the movement linearly", () => {
    const one = particleStep(0, 1.2, 1, 0.016, 10, true);
    const two = particleStep(0, 1.2, 2, 0.016, 10, true);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeCloseTo(2 * one, 10);
  });

  it("faster computed flow moves faster and progress wraps around", () => {
    expect(particleStep(0, 2, 1, 0.016, 10, true)).toBeGreaterThan(particleStep(0, 1, 1, 0.016, 10, true));
    const p = particleStep(0.99, 2, 3, 1, 10, true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  });
});
