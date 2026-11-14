/**
 * Readable names for the model's input features (ml/features.py). Used by the Prediction Lab input viewer, which
 * shows the exact values stored with each prediction (predictions_v2.input_snapshot).
 */
const VAR: Record<string, [string, string]> = {
  d: ["P − ET0", "mm"],
  p: ["Rainfall", "mm"],
  et0: ["Reference ET0", "mm"],
  tmean: ["Mean temperature", "°C"],
};

function ago(k: number): string {
  return k === 0 ? "issue month" : `${k} month${k === 1 ? "" : "s"} before`;
}

export interface FeatureInfo {
  label: string;
  unit: string;
  group: "Recent months" | "Rolling means" | "Anomalies" | "Target month" | "Other";
}

export function featureInfo(name: string): FeatureInfo {
  let m = /^(d|p|et0|tmean)_lag(\d+)$/.exec(name);
  if (m) return { label: `${VAR[m[1]][0]} · ${ago(Number(m[2]))}`, unit: VAR[m[1]][1], group: "Recent months" };
  m = /^(d|p)_roll(\d+)$/.exec(name);
  if (m) return { label: `${VAR[m[1]][0]} · ${m[2]}-month mean`, unit: VAR[m[1]][1], group: "Rolling means" };
  m = /^d_anom_lag(\d+)$/.exec(name);
  if (m) return { label: `P − ET0 anomaly vs training normal · ${ago(Number(m[1]))}`, unit: "mm", group: "Anomalies" };
  switch (name) {
    case "sm_lag0": return { label: "Soil moisture (ERA5-Land model) · issue month", unit: "m³/m³", group: "Recent months" };
    case "target_month_sin": return { label: "Target month (sine of season)", unit: "", group: "Target month" };
    case "target_month_cos": return { label: "Target month (cosine of season)", unit: "", group: "Target month" };
    case "clim_d_target": return { label: "Training-period normal P − ET0 for the target month", unit: "mm", group: "Target month" };
    case "clim_sd_target": return { label: "Training-period spread (SD) for the target month", unit: "mm", group: "Target month" };
    case "division_id": return { label: "Division index", unit: "", group: "Other" };
    default: return { label: name, unit: "", group: "Other" };
  }
}

const ORDER: FeatureInfo["group"][] = ["Recent months", "Rolling means", "Anomalies", "Target month", "Other"];

/** Snapshot features as sorted table rows: group order, then lag order. */
export function featureRows(features: Record<string, number | null>): { name: string; info: FeatureInfo; value: number | null }[] {
  const lag = (n: string) => Number(/(\d+)$/.exec(n)?.[1] ?? 0);
  return Object.entries(features)
    .map(([name, value]) => ({ name, info: featureInfo(name), value }))
    .sort((a, b) => ORDER.indexOf(a.info.group) - ORDER.indexOf(b.info.group)
      || a.name.replace(/\d+$/, "").localeCompare(b.name.replace(/\d+$/, "")) || lag(a.name) - lag(b.name));
}
