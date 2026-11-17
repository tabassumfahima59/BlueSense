/** Pure helpers of the conceptual flow scene (no three.js import, so they are unit-testable). */
export interface FlowLayers {
  pipes: boolean;
  particles: boolean;
  leaks: boolean;
  labels: boolean;
}
export const ALL_FLOW_LAYERS: FlowLayers = { pipes: true, particles: true, leaks: true, labels: true };

/**
 * Particle progress along a pipe for one frame (0..1, wraps). Visual units per second are proportional to the
 * computed velocity and the speed multiplier; nothing moves while paused.
 */
export function particleStep(offset: number, velocityMs: number, speed: number, dt: number, lengthUnits: number, running: boolean): number {
  if (!running || speed <= 0 || lengthUnits <= 0) return offset;
  const unitsPerSecond = Math.max(0.02, velocityMs * 0.25) * speed;
  return (offset + (unitsPerSecond * dt) / (lengthUnits / 10)) % 1;
}
