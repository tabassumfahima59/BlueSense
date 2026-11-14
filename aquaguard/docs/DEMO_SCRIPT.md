# Demo script (5–7 minutes)

**Before the demo (10 min ahead):** open `<backend>/api/health` to wake the API (or rely on the keep-warm job), then open the frontend once so tiles cache. If a source is down, the app keeps the last valid data with its original dates and a "Some data is not current" banner (there is no sample or mock mode since P4); the refresh button in the top bar re-checks the Open-Meteo data.

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | **Command Center** (national) | "AquaGuard predicts, analyses, visualises, optimises and recommends — and every number carries its provenance." Point at the legend, then KPIs: availability vs demand, dry-season stress ~50% (High), GRACE −0.53 cm/yr (regional, not well depth), 30-day rainfall vs normal. Show the model checks against FAO AQUASTAT. |
| 0:50 | Command Center → click **Rajshahi** in the table | Region selector and URL update; KPIs re-compute for the division. |
| 1:15 | **What-if** | Click preset "Dry year: rainfall −20%". Baseline vs Simulated cards update (dry-season supply ↓, irrigation need ↑, unmet ↑, stress ↑). Click **Apply across platform** — the header chip shows "Scenario active". |
| 2:00 | **Command Center** | Same page now Simulated (teal dashed badges); alerts re-evaluated. |
| 2:20 | **Water Budget Sankey** | Dry season Sankey under the scenario; balance indicator green (input = output within 0.01 MCM). Click **Optimize allocation**: domestic first, environment protected, savings shown. |
| 3:10 | **Prediction Lab** | Forecast with 90% interval; actual vs predicted on 2021–2026 (never seen in training); metrics table with climatology and persistence beside the model — honest about modest skill. SHAP global + select Dhaka for a local explanation. Switch to Groundwater: GRACE series + trend. |
| 4:20 | **3D Water Explorer** | Tilt the map: terrain (×25, labelled), divisions extruded by risk; toggle surface water (JRC) and GRACE; click a district → info panel (values from its division, stated). |
| 5:00 | **3D Water Flow** | "SIMULATED" banner. Add a leak on the residential branch (severity 2) — red marker, loss % rises. Click **Optimize**: leak isolated, set-point lowered to the minimum service pressure; before/after chart shows leakage avoided. |
| 5:45 | **Smart Irrigation** | Potato, Rangpur, sandy loam, planting 2026-11-15, 1.5 ha → ET0, Kc, ETc, effective rain, net/gross mm and m³, next irrigation date, AWD/efficiency advice; assumptions table; "Estimate — validate locally". |
| 6:20 | **Copilot** (floating) | Ask "Explain the active scenario" → grounded answer naming modules; ask "What is the groundwater depth in my well?" → "I don't have that data". Ask in Bangla. |
| 6:50 | Reset scenario | Close: limitations page, data sources with licences and retrieval times. |
