-- 0003_weather_values: long-format weather store for archive (reanalysis), current and forecast values.
-- NULL measurements are never stored. Existing weather_daily rows are copied as `reanalysis`; weather_daily itself
-- is kept unchanged (the ML pipeline and derived tables still read it).

-- WITHOUT ROWID + composite primary key: the key is the natural unique constraint
-- (location, valid_time, time_step, variable, data_kind) and also the clustered index, ordered for the typical
-- query "one location, one variable and kind, a time range". No secondary index is needed.
CREATE TABLE IF NOT EXISTS weather_values (
  location_id TEXT NOT NULL REFERENCES locations(id),
  variable TEXT NOT NULL,
  data_kind TEXT NOT NULL CHECK (data_kind IN ('model_current', 'forecast', 'reanalysis')),
  time_step TEXT NOT NULL CHECK (time_step IN ('current', 'hourly', 'daily')),
  valid_time TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  model_run TEXT,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (location_id, variable, data_kind, time_step, valid_time)
) WITHOUT ROWID;

-- valid_time for daily rows = local calendar date (Asia/Dhaka), as returned by Open-Meteo with timezone set.
INSERT OR IGNORE INTO weather_values (location_id, valid_time, time_step, variable, value, unit, data_kind, source_id, retrieved_at)
SELECT division, date, 'daily', 'precipitation_sum', precip_mm, 'mm', 'reanalysis', 'openmeteo_archive', retrieved_at
FROM weather_daily
WHERE precip_mm IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0 AND division IN (SELECT id FROM locations);

INSERT OR IGNORE INTO weather_values (location_id, valid_time, time_step, variable, value, unit, data_kind, source_id, retrieved_at)
SELECT division, date, 'daily', 'temperature_2m_max', tmax_c, '°C', 'reanalysis', 'openmeteo_archive', retrieved_at
FROM weather_daily
WHERE tmax_c IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0 AND division IN (SELECT id FROM locations);

INSERT OR IGNORE INTO weather_values (location_id, valid_time, time_step, variable, value, unit, data_kind, source_id, retrieved_at)
SELECT division, date, 'daily', 'temperature_2m_min', tmin_c, '°C', 'reanalysis', 'openmeteo_archive', retrieved_at
FROM weather_daily
WHERE tmin_c IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0 AND division IN (SELECT id FROM locations);

INSERT OR IGNORE INTO weather_values (location_id, valid_time, time_step, variable, value, unit, data_kind, source_id, retrieved_at)
SELECT division, date, 'daily', 'temperature_2m_mean', tmean_c, '°C', 'reanalysis', 'openmeteo_archive', retrieved_at
FROM weather_daily
WHERE tmean_c IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0 AND division IN (SELECT id FROM locations);

INSERT OR IGNORE INTO weather_values (location_id, valid_time, time_step, variable, value, unit, data_kind, source_id, retrieved_at)
SELECT division, date, 'daily', 'et0_fao_evapotranspiration', et0_mm, 'mm', 'reanalysis', 'openmeteo_archive', retrieved_at
FROM weather_daily
WHERE et0_mm IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0 AND division IN (SELECT id FROM locations);

INSERT OR IGNORE INTO weather_values (location_id, valid_time, time_step, variable, value, unit, data_kind, source_id, retrieved_at)
SELECT division, date, 'daily', 'soil_moisture_0_to_7cm_mean', soil_moisture_m3m3, 'm³/m³', 'reanalysis', 'openmeteo_archive', retrieved_at
FROM weather_daily
WHERE soil_moisture_m3m3 IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0 AND division IN (SELECT id FROM locations);
