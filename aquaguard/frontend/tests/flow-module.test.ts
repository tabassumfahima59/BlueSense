/**
 * Water Flow module logic: request building, scenarios, the shared store and the derived values every view shows.
 * FlowState fixtures in tests/fixtures/flow are real engine output (backend flow_sim + the router's to_state).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { accounting, balanceStatus, delta, nodeInfo, nodeSummary, pipeFlow, pipeInfo, tableRows } from "../lib/flow/derive";
import { DEST_PIPE, DESTS, NODES, PIPE_DEFS, PIPE_DEST, PIPES, nodeById } from "../lib/flow/network";
import { DEFAULT_INPUTS, SCENARIOS, toRequest } from "../lib/flow/scenarios";
import { sameSel, useFlowStore } from "../lib/flow/store";
import type { FlowState } from "../lib/types/contract";
import highDemand from "./fixtures/flow/high-demand.json";
import leakClosed from "./fixtures/flow/leak-closed.json";
import normal from "./fixtures/flow/normal.json";
import pumpOff from "./fixtures/flow/pump-off.json";

const N = normal as unknown as FlowState;
const L = leakClosed as unknown as FlowState;
const OFF = pumpOff as unknown as FlowState;
const HD = highDemand as unknown as FlowState;
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("network layout", () => {
  it("every pipe joins two known nodes and every zone has exactly one feeding branch", () => {
    for (const p of PIPE_DEFS) {
      expect(nodeById(p.from)).toBeTruthy();
      expect(nodeById(p.to)).toBeTruthy();
      expect(p.path.length).toBeGreaterThanOrEqual(2);
    }
    for (const d of DESTS) expect(PIPE_DEST[DEST_PIPE[d]]).toBe(d);
    expect(new Set(NODES.map((n) => n.id)).size).toBe(NODES.length);
  });

  it("the engine's pipe and destination ids match the layout", () => {
    expect(N.pipes.map((p) => p.id).sort()).toEqual([...PIPES].sort());
    expect(N.destinations.map((d) => d.id).sort()).toEqual([...DESTS].sort());
  });
});

describe("request and scenarios", () => {
  it("toRequest drops zero leaks and neutral demand factors", () => {
    const r = toRequest({ ...DEFAULT_INPUTS, leaks: { ...DEFAULT_INPUTS.leaks, res: 1.5 } }, { lossPct: 20 });
    expect(r.leaks).toEqual({ res: 1.5 });
    expect(r.demandFactors).toBeNull();
    expect(r.lossPct).toBe(20);
    expect(r.allocationPct).toEqual(DEFAULT_INPUTS.allocation);
    expect(toRequest({ ...DEFAULT_INPUTS, demandFactors: { ...DEFAULT_INPUTS.demandFactors, industrial: 1.8 } }).demandFactors)
      .toEqual({ industrial: 1.8 });
  });

  it("there are eight distinct scenarios and each one yields valid inputs", () => {
    expect(SCENARIOS).toHaveLength(8);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(8);
    for (const s of SCENARIOS) {
      const i = s.apply(DEFAULT_INPUTS);
      expect(sum(i.allocation)).toBeCloseTo(100, 6);
      expect(i.pumpCapacity).toBeGreaterThan(0);
      expect(Object.values(i.leaks).every((v) => v >= 0 && v <= 3)).toBe(true);
      expect(s.why.length).toBeGreaterThan(20);
    }
    const byId = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.apply(DEFAULT_INPUTS)]));
    expect(byId["pump-failure"].pumpOn).toBe(false);
    expect(byId.shortage.sourceLimit).toBe(0.3);
    expect(byId["pump-capacity"].pumpCapacity).toBeLessThan(DEFAULT_INPUTS.pumpFlow);
    expect(byId.leakage.leaks.trunk).toBeGreaterThan(0);
    expect(byId.normal).toEqual(DEFAULT_INPUTS);
    // applying a scenario never mutates the defaults
    expect(DEFAULT_INPUTS.leaks.trunk).toBe(0);
  });
});

describe("shared store", () => {
  beforeEach(() => useFlowStore.getState().resetSimulation());

  it("allocation always adds up to 100 % and a manual change marks the scenario custom", () => {
    const s = useFlowStore.getState();
    s.setAllocation("residential", 70);
    const a = useFlowStore.getState().inputs.allocation;
    expect(a.residential).toBe(70);
    expect(sum(a)).toBeCloseTo(100, 6);
    expect(useFlowStore.getState().scenarioId).toBe("custom");
  });

  it("valves toggle, scenarios apply and reset restores everything", () => {
    const s = useFlowStore.getState();
    s.toggleValve("agr");
    expect(useFlowStore.getState().inputs.closed).toEqual(["agr"]);
    s.toggleValve("agr");
    expect(useFlowStore.getState().inputs.closed).toEqual([]);
    s.applyScenario("pump-failure");
    expect(useFlowStore.getState().scenarioId).toBe("pump-failure");
    expect(useFlowStore.getState().inputs.pumpOn).toBe(false);
    s.select({ kind: "node", id: "pump" });
    s.setRunning(false);
    s.resetSimulation();
    const r = useFlowStore.getState();
    expect(r.inputs).toEqual(DEFAULT_INPUTS);
    expect(r.scenarioId).toBe("normal");
    expect(r.selection).toBeNull();
    expect(r.running).toBe(true);
    expect(r.camera?.type).toBe("reset");
  });

  it("one selection is shared by every view", () => {
    useFlowStore.getState().select({ kind: "pipe", id: "res" });
    expect(sameSel(useFlowStore.getState().selection, { kind: "pipe", id: "res" })).toBe(true);
    expect(sameSel(useFlowStore.getState().selection, { kind: "node", id: "residential" })).toBe(false);
    useFlowStore.getState().toggleLayer("labels");
    expect(useFlowStore.getState().layers.labels).toBe(false);
  });
});

describe("derived values", () => {
  it("the water balance identity closes on engine output", () => {
    for (const s of [N, L, OFF, HD]) {
      const a = accounting(s);
      expect(a.valid).toBe(true);
      expect(Math.abs(a.residual ?? 1)).toBeLessThan(1);
      expect(a.storageChange).toBeNull();
    }
    expect(balanceStatus(N).label).toBe("Balanced");
    expect(balanceStatus(HD).label).toBe("Deficit");
  });

  it("a broken identity is reported as invalid, never as balanced", () => {
    const broken = { ...N, deliveredDaily: { ...N.deliveredDaily, value: (N.deliveredDaily.value ?? 0) + 5000 } };
    expect(balanceStatus(broken).key).toBe("invalid");
  });

  it("pump off: no flow anywhere, so particles stop and zones show no supply", () => {
    for (const def of PIPE_DEFS) expect(pipeFlow(def.id, OFF).flow).toBe(0);
    expect(OFF.destinations.every((d) => d.status === "no_supply")).toBe(true);
    expect(nodeInfo("pump", OFF, null).status?.label).toBe("Off");
  });

  it("closed and leaking pipes are described as such in every view", () => {
    expect(pipeFlow("ind", L).closed).toBe(true);
    expect(pipeInfo("ind", L).status?.label).toBe("Valve closed");
    expect(pipeInfo("trunk", L).status?.label).toMatch(/^Leaking/);
    expect(pipeFlow("trunk", L).leak).toBeGreaterThan(0);
    const rows = tableRows(L);
    expect(rows).toHaveLength(NODES.length + PIPE_DEFS.length);
    expect(rows.find((r) => r.id === "ind" && r.kind === "pipe")?.status.label).toBe("Valve closed");
    expect(rows.find((r) => r.id === "industrial")?.status.label).toBe("Valve closed");
  });

  it("labels, info panel and table agree on the same numbers", () => {
    const d = N.destinations.find((x) => x.id === "residential")!;
    const row = tableRows(N).find((r) => r.id === "residential")!;
    expect(row.flowDaily).toBe(d.deliveredDaily.value);
    expect(nodeSummary("residential", N)).toContain(Math.round(d.deliveredDaily.value ?? 0).toLocaleString("en-US"));
    const info = nodeInfo("residential", N, null);
    expect(info.rows.find((r) => r.label === "Delivered")?.value).toContain(Math.round(d.deliveredDaily.value ?? 0).toLocaleString("en-US"));
    // illustrative facilities are never presented as modelled
    expect(nodeInfo("reservoir", N, null).modelled).toBe(false);
    expect(tableRows(N).find((r) => r.id === "treatment")?.modelled).toBe(false);
  });

  it("delta reports direction in words and numbers", () => {
    expect(delta(10, 4)).toEqual({ text: "+6", dir: "up" });
    expect(delta(4, 10)).toEqual({ text: "−6", dir: "down" });
    expect(delta(4, 4).dir).toBe("same");
    expect(delta(null, 4).text).toBe("—");
  });
});
