# Limitations

1. **Not real-time, no sensors.** No IoT sensors, no real-time pipe pressure, no pump or valve control. Pipeline pressure, flow and leakage are simulated on a hypothetical network. AquaGuard does not detect physical leaks.
2. **Decision support only.** It does not replace field monitoring, laboratory testing or government water systems.
3. **Weather inputs** are ERA5 reanalysis (Historical) at one point per division, not station observations or division averages.
4. **Old national statistics.** Bangladesh withdrawals and irrigated areas in AQUASTAT are 2008 figures carried forward; resources are 2018. The Command Center shows the model–AQUASTAT gap for agricultural demand (the FAO-56 estimate is ~49% above the reported 2008 withdrawal).
5. **Spatial splits are estimates.** Inflow, groundwater, crop area and industry are split to divisions by area or population; real access to river water differs strongly (e.g. Barind tract of Rajshahi). Division stress ratios are therefore similar to each other.
6. **No district hydrology.** Districts show their parent division's values.
7. **Forecast skill is modest.** The model beats climatology by ~6% RMSE at 1 month and roughly matches it at 3–6 months; it rarely predicts dry classes (macro-F1 ≈ climatology). Interval coverage on the test years is 82–84% for nominal 90%.
8. **GRACE** resolves ~300 km: one Bangladesh-wide storage signal, not groundwater depth or well level. The trend CI ignores autocorrelation.
9. **No observed groundwater levels.** The BWDB importer is ready but no station data are bundled.
10. **Demand projection** is not an ML forecast and holds irrigated area, climate and industry constant.
11. **Irrigation advice** uses forecast weather, FAO-56 table values and model soil moisture: estimate only — validate locally.
12. **Copilot** needs a server-side key for the configured provider (`GEMINI_API_KEY` by default); without one it gives no answers. On Gemini's free tier, Google may use questions and looked-up data to improve its products and human reviewers may read them (shown to users before they ask); the free tier is for users aged 18+ and may not be offered in the EEA, the UK or Switzerland. Usage counters are in memory and reset when free hosting restarts; Google's own quota is the hard limit and is reported as an error when used up. The number check flags unmatched numbers but cannot prove an answer correct.
13. **Licences.** AQUASTAT data are CC BY-NC-SA 4.0 (non-commercial); CARTO basemaps are free for non-commercial use. Commercial use would need other sources.
