/**
 * The conceptual distribution network shared by the 3D scene, the schematic and the data table.
 * Ids of modelled pipes and destinations match the backend engine (engine/flow_sim.py, parameters.yaml flow_sim).
 * The reservoir intake and the treatment plant are illustrative: the engine starts at the pump, so their values
 * are shown as "not modelled" (they carry the pump flow; treatment losses are not simulated).
 */

export type DestId = "residential" | "agricultural" | "industrial" | "other";
export type PipeId = "trunk" | "res" | "agr" | "ind" | "oth";
export type IntakeId = "intake" | "treated";
export type NodeId = "reservoir" | "treatment" | "pump" | "junction" | DestId;
export type AnyPipeId = PipeId | IntakeId;

export const DESTS: DestId[] = ["residential", "agricultural", "industrial", "other"];
export const PIPES: PipeId[] = ["trunk", "res", "agr", "ind", "oth"];

export interface NodeDef {
  id: NodeId;
  label: string;
  category: string;
  /** engine-modelled (values come from the simulation) or illustrative only */
  modelled: boolean;
  /** 3D ground position [x, z] */
  pos: [number, number];
  /** label height above the ground */
  labelY: number;
  /** 3D label anchor when it must sit beside the object to avoid overlapping a neighbour's label */
  labelPos?: [number, number, number];
  /** schematic position [x, y] in a 1000 x 620 box */
  sch: [number, number];
}

export interface PipeDef {
  id: AnyPipeId;
  label: string;
  kind: "intake" | "main" | "branch";
  from: NodeId;
  to: NodeId;
  modelled: boolean;
  /** 3D path [x, z] points */
  path: [number, number][];
}

export const NODES: NodeDef[] = [
  { id: "reservoir", label: "Reservoir", category: "Water source (storage)", modelled: false, pos: [-22, -6], labelY: 4.6, labelPos: [-22, 1.2, -0.4], sch: [66, 310] },
  { id: "treatment", label: "Treatment plant", category: "Water treatment (illustrative)", modelled: false, pos: [-14, -6], labelY: 4.2, labelPos: [-15.5, 4.2, -9], sch: [200, 310] },
  { id: "pump", label: "Pump station", category: "Pumping", modelled: true, pos: [-6, -6], labelY: 4.4, labelPos: [-4.6, 4.4, -6.5], sch: [350, 310] },
  { id: "junction", label: "Junction J1", category: "Distribution junction", modelled: true, pos: [3, -1], labelY: 2.8, sch: [555, 310] },
  { id: "residential", label: "Residential zone", category: "Consumer: households", modelled: true, pos: [17, -12], labelY: 6.4, sch: [880, 70] },
  { id: "agricultural", label: "Agricultural zone", category: "Consumer: irrigation", modelled: true, pos: [19, 7], labelY: 3.2, sch: [880, 230] },
  { id: "industrial", label: "Industrial zone", category: "Consumer: industry", modelled: true, pos: [4, 15], labelY: 7.4, sch: [880, 390] },
  { id: "other", label: "Commercial & public", category: "Consumer: other (commercial / public)", modelled: true, pos: [-11, 11], labelY: 5.2, sch: [880, 550] },
];

export const PIPE_DEFS: PipeDef[] = [
  { id: "intake", label: "Raw-water intake", kind: "intake", from: "reservoir", to: "treatment", modelled: false, path: [[-18.6, -6], [-16.6, -6]] },
  { id: "treated", label: "Treated-water main", kind: "intake", from: "treatment", to: "pump", modelled: false, path: [[-11.4, -6], [-8.4, -6]] },
  { id: "trunk", label: "Trunk main", kind: "main", from: "pump", to: "junction", modelled: true, path: [[-3.6, -6], [-1, -5.6], [1.2, -3.2], [3, -1]] },
  { id: "res", label: "Residential branch", kind: "branch", from: "junction", to: "residential", modelled: true, path: [[3, -1], [8, -1.5], [10, -6], [11.5, -9.5], [13.2, -10.6]] },
  { id: "agr", label: "Agricultural branch", kind: "branch", from: "junction", to: "agricultural", modelled: true, path: [[3, -1], [7.5, 1.2], [10.5, 4.4], [12.6, 5.6]] },
  { id: "ind", label: "Industrial branch", kind: "branch", from: "junction", to: "industrial", modelled: true, path: [[3, -1], [3.6, 4], [3.6, 8.6], [3.8, 10.8]] },
  { id: "oth", label: "Commercial & public branch", kind: "branch", from: "junction", to: "other", modelled: true, path: [[3, -1], [-1.5, 3], [-5.4, 6.4], [-7.6, 8.2]] },
];

export const DEST_PIPE: Record<DestId, PipeId> = { residential: "res", agricultural: "agr", industrial: "ind", other: "oth" };
export const PIPE_DEST: Record<PipeId, DestId | null> = { trunk: null, res: "residential", agr: "agricultural", ind: "industrial", oth: "other" };

export const nodeById = (id: string) => NODES.find((n) => n.id === id);
export const pipeById = (id: string) => PIPE_DEFS.find((p) => p.id === id);
export const isPipeId = (id: string): id is PipeId => (PIPES as string[]).includes(id);
export const isDestId = (id: string): id is DestId => (DESTS as string[]).includes(id);

export const DEST_LABEL: Record<DestId, string> = {
  residential: "Residential", agricultural: "Agricultural", industrial: "Industrial", other: "Commercial & public",
};
