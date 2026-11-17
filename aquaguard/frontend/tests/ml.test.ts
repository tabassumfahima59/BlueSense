import { describe, expect, it } from "vitest";
import { featureInfo, featureRows } from "../lib/ml/features";

// The 53 model inputs of ml/features.py (feature_columns()).
const COLUMNS = [
  ...["d", "p", "et0"].flatMap((v) => Array.from({ length: 12 }, (_, k) => `${v}_lag${k}`)),
  "tmean_lag0", "tmean_lag1", "tmean_lag2",
  "sm_lag0", "d_roll3", "d_roll6", "d_roll12", "p_roll3", "p_roll6",
  "d_anom_lag0", "d_anom_lag1", "d_anom_lag2",
  "target_month_sin", "target_month_cos", "clim_d_target", "clim_sd_target", "division_id",
];

describe("model input labels", () => {
  it("names every model feature (no raw column names left)", () => {
    expect(COLUMNS).toHaveLength(53);
    for (const c of COLUMNS) expect(featureInfo(c).label).not.toBe(c);
  });

  it("gives units and lag wording", () => {
    expect(featureInfo("p_lag0")).toMatchObject({ label: "Rainfall · issue month", unit: "mm" });
    expect(featureInfo("tmean_lag2")).toMatchObject({ label: "Mean temperature · 2 months before", unit: "°C" });
    expect(featureInfo("d_roll12").label).toBe("P − ET0 · 12-month mean");
    expect(featureInfo("sm_lag0").unit).toBe("m³/m³");
  });

  it("sorts rows by group, then variable, then lag", () => {
    const rows = featureRows({ division_id: 2, d_lag10: 1, d_lag2: 3, d_roll3: 4, clim_d_target: 5 });
    expect(rows.map((r) => r.name)).toEqual(["d_lag2", "d_lag10", "d_roll3", "clim_d_target", "division_id"]);
  });
});
