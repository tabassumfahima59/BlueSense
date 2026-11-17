import { convertVolume, type VolumeDisplay } from "../format";

/** Replace only the declared volume dimension, leaving dates, percentages and physical units alone. */
export function volumeLabel(text: string, sourceUnit: string, preference: VolumeDisplay): string {
  const unit = convertVolume(1, sourceUnit, preference).unit;
  const from = sourceUnit.split("/")[0];
  const to = unit.split("/")[0];
  if (from === to) return text;
  return text.replace(new RegExp(`(?<![A-Za-z])${from}(?![A-Za-z0-9])`, "g"), to);
}

/** Immutable display conversion; API data and calculation inputs stay in source units. */
export function volumePlot(data: unknown[], layout: Record<string, unknown>, sourceUnit: string, preference: VolumeDisplay) {
  const factor = convertVolume(1, sourceUnit, preference).v;
  const values = (v: unknown) => Array.isArray(v) ? v.map((n) => typeof n === "number" ? n * factor : n) : v;
  const label = (v: unknown): unknown => {
    if (typeof v === "string") return volumeLabel(v, sourceUnit, preference);
    if (Array.isArray(v)) return v.map(label);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, n]) => [k, label(n)]));
    return v;
  };
  const traces = data.map((raw) => {
    const trace = raw as Record<string, unknown>;
    const axis = trace.orientation === "h" ? "x" : "y";
    const result = { ...trace, [axis]: values(trace[axis]) };
    if (trace.values) result.values = values(trace.values);
    if (typeof trace.base === "number") result.base = trace.base * factor;
    const errorKey = `error_${axis}`;
    const error = trace[errorKey] as Record<string, unknown> | undefined;
    if (error && error.type !== "percent" && error.type !== "sqrt") {
      result[errorKey] = { ...error, array: values(error.array), arrayminus: values(error.arrayminus),
        ...(typeof error.value === "number" ? { value: error.value * factor } : {}),
        ...(typeof error.valueminus === "number" ? { valueminus: error.valueminus * factor } : {}) };
    }
    if (typeof trace.hovertemplate === "string") {
      const template = volumeLabel(trace.hovertemplate, sourceUnit, preference);
      result.hovertemplate = factor === 1 ? template : template.replace(/%\{([xy]|value):[^}]+\}/g, "%{$1:,.4g}");
    }
    return result;
  });
  return { data: traces, layout: label(layout) as Record<string, unknown> };
}
