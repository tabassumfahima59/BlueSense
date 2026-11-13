# Test fixtures (real recorded data — tests only, never served by the API)

| File | Origin | Licence / attribution |
|---|---|---|
| `openmeteo_forecast_dhaka.json` | Open-Meteo Forecast API response for the Dhaka weather point (23.8103, 90.4125), recorded 2026-11-13 with the exact parameters of `app/sync/openmeteo.py` (current, hourly, daily; `timezone=auto`; 16 days) | CC BY 4.0 — Weather data by Open-Meteo.com |
| `openmeteo_forecast_rangpur.json` | Same request for the Rangpur weather point (25.7439, 89.2752), recorded 2026-11-13 | CC BY 4.0 — Weather data by Open-Meteo.com |
| `openmeteo_archive_dhaka.json` | Open-Meteo Historical Weather API response, same point, 2026-10-30 → 2026-11-12 (14 days), recorded 2026-11-13 | CC BY 4.0 — Weather data by Open-Meteo.com; contains modified Copernicus C3S information |
| `aquastat_bgd_subset.csv` | Rows of the AQUASTAT download for Bangladesh (`data/raw/aquastat/aquastat_bgd.csv`, retrieved 2026-11-12) for variables 4188 (TRWR), 4253 (total withdrawal) and 4550 (SDG 6.4.2), unmodified, including imputed (`I`) rows | CC BY-NC-SA 4.0 — Source: FAO AQUASTAT |
| `grace_csr_bgd_subset.h5` | Subset of `CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc` (retrieved 2026-11-12): lat 20–27°N, lon 87.5–93°E, the first three and last three solutions, with the original `Units`, `product_version` and `time_mean_removed` attributes | Save, H., Bettadpur, S., Tapley, B.D. (2016), CSR RL06.3 mascons |

Tests that need a changed provider value (revisions, newest-run-replaces, NULL never overwrites) copy one of these
files in memory and alter a single value; such altered copies exist only inside the test.
