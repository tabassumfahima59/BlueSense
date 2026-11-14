/** Table view of chart data ("View as table", master prompt §5): one row per x (or category), one column per trace. */

export interface ChartTable {
  head: string[];
  rows: (string | number | null)[][];
}

type Trace = {
  name?: string;
  type?: string;
  orientation?: string;
  x?: unknown[];
  y?: unknown[];
  labels?: unknown[];
  values?: unknown[];
};

const cell = (v: unknown): string | number | null =>
  v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null
    : typeof v === "number" ? v : String(v);

/** Build a table from Plotly traces; null when the traces have no tabular x/y (e.g. heatmaps). */
export function tracesToTable(data: unknown[], keyLabel = "x"): ChartTable | null {
  const traces = (data as Trace[]).filter((t) => t && ((Array.isArray(t.x) && Array.isArray(t.y))
    || (Array.isArray(t.labels) && Array.isArray(t.values))));
  if (!traces.length) return null;
  const keys: string[] = [];
  const cols: Map<string, unknown>[] = [];
  const head = [keyLabel];
  traces.forEach((t, i) => {
    const horizontal = t.orientation === "h";
    const k = (t.labels ?? (horizontal ? t.y : t.x)) as unknown[];
    const v = (t.values ?? (horizontal ? t.x : t.y)) as unknown[];
    const col = new Map<string, unknown>();
    k.forEach((key, j) => {
      const ks = String(key);
      if (!keys.includes(ks)) keys.push(ks);
      col.set(ks, v[j]);
    });
    cols.push(col);
    head.push(t.name || `Series ${i + 1}`);
  });
  return { head, rows: keys.map((k) => [k, ...cols.map((c) => cell(c.get(k)))]) };
}
