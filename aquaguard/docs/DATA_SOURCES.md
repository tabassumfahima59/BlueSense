# Data sources

The live registry (with retrieval times read from `data/processed/sources_retrieved.json`) is served at `GET /api/sources` and shown on the Data Sources page. Times below are from the build of 12 Nov 2026.

| Source | Used for | URL | Licence | Resolution | Period | Retrieved (UTC) | Label |
|---|---|---|---|---|---|---|---|
| Open-Meteo Historical Weather API (ERA5/ERA5-Land) | Daily precipitation, Tmax/Tmin/Tmean, FAO-56 ET0, 0–7 cm soil moisture → monthly aggregates, climatology, ML target | https://open-meteo.com/en/docs/historical-weather-api | CC BY 4.0; contains modified Copernicus C3S information | ERA5 ~25 km / ERA5-Land ~9 km; one point per division | 1991-01-01 → 2026-11-05 | 2026-11-12 16:34 | Historical |
| Open-Meteo Forecast API | 7 past + 16 forecast days for the Irrigation Advisor; hourly soil moisture 3–9 cm | https://open-meteo.com/en/docs | CC BY 4.0 | best-match models | rolling | live (cached 3 h); snapshot 2026-11-12 16:23 | Predicted |
| Open-Meteo Flood API (GloFAS v4) | Monthly shape of transboundary inflow (Ganges, Brahmaputra-Jamuna, Upper Meghna cells) | https://open-meteo.com/en/docs/flood-api | CC BY 4.0; GloFAS © Copernicus EMS | 0.05° cells | 1991–2026 (shape from 1991–2020) | 2026-11-12 16:24 | Historical |
| FAO AQUASTAT Dissemination System | Renewable resources, withdrawals by sector, irrigated crop areas, environmental flow requirement, SDG 6.4.2 | https://data.apps.fao.org/aquastat/ | CC BY-NC-SA 4.0 | national | values 2008/2018 carried forward to 2023 | 2026-11-12 16:25 | Historical (division splits Estimated) |
| CSR GRACE/GRACE-FO RL06.3 mascons | Terrestrial water storage anomaly over Bangladesh, trend | https://www2.csr.utexas.edu/grace/RL0603_mascons.html | free with citation (Save et al. 2016; Save 2020) | 0.25° grid, ~300 km effective | 2002-04 → 2026-09 (gap 2017–18) | 2026-11-12 16:35 | Historical; projection Predicted |
| geoBoundaries gbOpen BGD | Division (ADM1) and district (ADM2) polygons, areas | https://www.geoboundaries.org/ | ADM1 CC0 1.0; ADM2 CC BY 3.0 IGO (BBS, OCHA ROAP) | simplified polygons | ADM1 2015, ADM2 2020 | 2026-11-12 16:24 | reference (areas Estimated) |
| HDX COD-PS Bangladesh | 2022 population by division and district | https://data.humdata.org/dataset/cod-ps-bgd | CC BY-IGO (UNFPA, US Census Bureau) | ADM1/ADM2 | 2022 | 2026-11-12 16:24 | Historical |
| World Bank Population Estimates & Projections | National population 2000–2050 for the demand projection | https://databank.worldbank.org/source/population-estimates-and-projections | CC BY 4.0 | national | 2000–2050 | 2026-11-12 16:30 | Historical (projection Estimated) |
| JRC Global Surface Water | Surface-water occurrence map layer (browser tiles) | https://global-surface-water.appspot.com/ | free, attribution (Pekel et al. 2016) | 30 m | 1984–2021 | tiles loaded live | Historical |
| AWS Terrain Tiles (Terrarium) | 3D terrain + hillshade | https://registry.opendata.aws/terrain-tiles/ | open; attribution per tilezen/joerd | zoom-dependent | static | tiles loaded live | reference |
| CARTO Positron (OpenStreetMap) | Basemap, rivers and canals | https://carto.com/basemaps/ | © OpenStreetMap contributors (ODbL), © CARTO; non-commercial | vector tiles | continuous | loaded live | reference |
| BWDB station data (importer) | Observed water level, discharge, groundwater depth, rainfall | https://www.hydrology.bwdb.gov.bd/ | BWDB terms; request/registration | station | — | not bundled | Observed |

## Storage and fallback

- Raw responses: `data/raw/` (git-ignored; re-download with `make fetch`).
- Cleaned tables: `data/processed/` → SQLite `data/aquaguard.db` (tables: regions, sources, weather_daily, weather_monthly, climatology, water_resources, inflow_shape, population_projection, storage_anomaly, station_observations, predictions, scenarios, alerts_log). Every record carries `source_id`, `retrieved_at`, `provenance`, `is_sample`.
- Offline fallback: `data/sample/*.csv` is a frozen snapshot of the same tables (daily weather: last 400 days) plus forecast snapshots. When the database is missing (or `AQUAGUARD_FORCE_SAMPLE=1`) these are served with `isSample = true` and a "Sample data" banner. Live forecasts fall back to the 3-hour cache, then to the snapshot.

## BWDB CSV schema {#bwdb}

Place files in `data/raw/bwdb/` and run `python ml/import_bwdb.py`:

```
station_id,station_name,division,lon,lat,variable,date,value,unit
SW46.9L,Bahadurabad,mymensingh,89.70,25.15,water_level_m,2024-07-01,19.42,m
```

`variable` ∈ `water_level_m` (m), `discharge_m3s` (m3/s), `groundwater_depth_m` (m), `rainfall_mm` (mm); `division` is an AquaGuard division id. Rows are validated (columns, ids, units) and stored with provenance **Observed**. (The example row illustrates the format only; it is not data.)
