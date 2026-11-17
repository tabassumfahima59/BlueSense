-- 0002_core: locations, data_sources (reference registry), sync_runs, scheduler_lock.

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_bn TEXT,
  level TEXT NOT NULL CHECK (level IN ('country', 'division', 'district')),
  parent_id TEXT REFERENCES locations(id) DEFERRABLE INITIALLY DEFERRED,
  lat REAL,
  lon REAL,
  point_kind TEXT NOT NULL CHECK (point_kind IN ('representative_point', 'geometry_centroid')),
  iso3 TEXT NOT NULL DEFAULT 'BGD',
  boundary_ref TEXT,
  area_km2 REAL,
  is_weather_point INTEGER NOT NULL DEFAULT 0 CHECK (is_weather_point IN (0, 1)),
  is_selectable INTEGER NOT NULL DEFAULT 0 CHECK (is_selectable IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_locations_level ON locations(level);
CREATE INDEX IF NOT EXISTS ix_locations_parent ON locations(parent_id);

-- Copy existing geography. Division coordinates in `regions` are the divisional HQ points used for weather;
-- country and district coordinates are polygon centroids. Districts are reference geography only.
INSERT OR IGNORE INTO locations (id, name, name_bn, level, parent_id, lat, lon, point_kind, iso3, boundary_ref,
                                 area_km2, is_weather_point, is_selectable)
SELECT id, name, name_bn, level, parent_id, lat, lon,
       CASE level WHEN 'division' THEN 'representative_point' ELSE 'geometry_centroid' END,
       'BGD',
       CASE level WHEN 'country' THEN 'geoBoundaries-BGD-ADM0' WHEN 'division' THEN 'geoBoundaries-BGD-ADM1'
                  ELSE 'geoBoundaries-BGD-ADM2' END,
       area_km2,
       CASE WHEN level = 'division' THEN 1 ELSE 0 END,
       CASE WHEN level IN ('country', 'division') THEN 1 ELSE 0 END
FROM regions
WHERE level IN ('country', 'division', 'district')
ORDER BY CASE level WHEN 'country' THEN 0 WHEN 'division' THEN 1 ELSE 2 END;

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  licence TEXT NOT NULL,
  attribution TEXT NOT NULL,
  cadence TEXT NOT NULL,
  cadence_seconds INTEGER,
  data_kind TEXT NOT NULL CHECK (data_kind IN ('observed', 'model_current', 'forecast', 'reanalysis',
    'satellite_monthly', 'satellite_historical', 'statistic', 'derived', 'prediction', 'scenario', 'conceptual',
    'reference')),
  spatial_level TEXT NOT NULL,
  requires_credentials INTEGER NOT NULL DEFAULT 0 CHECK (requires_credentials IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Reference registry (not measurements). `cadence` is how often AquaGuard checks the source.
INSERT OR IGNORE INTO data_sources (id, name, url, licence, attribution, cadence, cadence_seconds, data_kind,
                                    spatial_level, requires_credentials, notes) VALUES
  ('openmeteo_forecast', 'Open-Meteo Forecast API', 'https://open-meteo.com/en/docs', 'CC BY 4.0 (free tier: non-commercial)',
   'Weather data by Open-Meteo.com', 'PT1H', 3600, 'forecast', 'point', 0,
   'Current conditions (model_current) and forecasts; weather-model output, not station readings.'),
  ('openmeteo_archive', 'Open-Meteo Historical Weather API (ERA5/ERA5-Land)', 'https://open-meteo.com/en/docs/historical-weather-api',
   'CC BY 4.0 (free tier: non-commercial); contains modified Copernicus C3S information',
   'Weather data by Open-Meteo.com', 'P1D', 86400, 'reanalysis', 'point', 0, 'Daily history from 1991-01-01 (Deviation D3).'),
  ('openmeteo_glofas', 'Open-Meteo Flood API (GloFAS)', 'https://open-meteo.com/en/docs/flood-api',
   'CC BY 4.0; GloFAS (c) Copernicus Emergency Management Service', 'Flood data by Open-Meteo.com / GloFAS',
   'irregular', NULL, 'reanalysis', 'point', 0, 'Used only for the monthly inflow shape of the derived national model.'),
  ('fao_aquastat', 'FAO AQUASTAT Dissemination System', 'https://data.apps.fao.org/aquastat/', 'CC BY-NC-SA 4.0',
   'Source: FAO AQUASTAT', 'P7D', 604800, 'statistic', 'country', 0, 'National statistics only; reference years preserved.'),
  ('grace_csr', 'CSR GRACE/GRACE-FO RL06.3 Mascon Solutions', 'https://www2.csr.utexas.edu/grace/RL0603_mascons.html',
   'Free use with citation', 'Save, H., Bettadpur, S., Tapley, B.D. (2016) JGR Solid Earth; CSR RL06.3 mascons',
   'P1D', 86400, 'satellite_monthly', 'grid', 0,
   'TWS anomaly (cm EWH), 0.25 deg grid of 1 deg mascons, ~300 km native; baseline 2004.000-2009.999. Not groundwater level.'),
  ('grace_jpl', 'JPL GRACE/GRACE-FO Mascon (TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4)', 'https://podaac.jpl.nasa.gov/',
   'NASA open data', 'NASA JPL / PO.DAAC', 'P1D', 86400, 'satellite_monthly', 'grid', 1,
   'Future adapter (Deviation D1). Requires EARTHDATA_TOKEN; not_configured until provided.'),
  ('geoboundaries', 'geoBoundaries gbOpen BGD', 'https://www.geoboundaries.org/', 'ADM1 CC0 1.0; ADM2 CC BY 3.0 IGO',
   'geoBoundaries (Runfola et al. 2020)', 'static', NULL, 'reference', 'ADM0/ADM1/ADM2', 0, 'Boundaries and areas.'),
  ('hdx_cod_ps', 'HDX COD-PS Bangladesh 2022', 'https://data.humdata.org/dataset/cod-ps-bgd', 'CC BY-IGO',
   'UNFPA, US Census Bureau via HDX', 'static', NULL, 'statistic', 'division/district', 0, 'Population 2022.'),
  ('worldbank_pep', 'World Bank Population Estimates and Projections', 'https://databank.worldbank.org/source/population-estimates-and-projections',
   'CC BY 4.0', 'World Bank', 'P1Y', 31536000, 'statistic', 'country', 0, 'National population 2000-2050.'),
  ('jrc_gsw', 'JRC Global Surface Water', 'https://global-surface-water.appspot.com/', 'Free with attribution',
   'Source: EC JRC/Google (Pekel et al. 2016)', 'static', NULL, 'satellite_historical', 'tiles 30 m', 0,
   'Historical occurrence 1984-2021, displayed as map tiles.'),
  ('bwdb_import', 'BWDB station data (CSV importer)', 'https://www.hydrology.bwdb.gov.bd/', 'Subject to BWDB terms',
   'Bangladesh Water Development Board', 'manual', NULL, 'observed', 'station', 1, 'No data bundled.'),
  ('aquaguard_engine', 'AquaGuard engines', 'docs/METHODS.md', 'Project code', 'AquaGuard', 'on_demand', NULL,
   'derived', 'country', 0, 'Water balance (national only), FAO-56, flow simulation (conceptual).'),
  ('aquaguard_ml', 'AquaGuard ML pipeline', 'docs/MODEL_CARD.md', 'Project code', 'AquaGuard', 'on_demand', NULL,
   'prediction', 'division', 0, 'Climatic water balance forecasts.');

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  location_id TEXT REFERENCES locations(id),
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);
CREATE INDEX IF NOT EXISTS ix_sync_runs_source_time ON sync_runs(source_id, started_at);

-- Lease lock so scheduled jobs run once even with several uvicorn workers (P2).
CREATE TABLE IF NOT EXISTS scheduler_lock (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
