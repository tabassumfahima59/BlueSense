-- 0005_water_storage: GRACE terrestrial water storage (TWS) anomaly — national series and grid cells.
-- TWS integrates groundwater, soil moisture, surface water and snow; it is not a groundwater level.

CREATE TABLE IF NOT EXISTS water_storage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('national', 'grid_cell')),
  location_id TEXT NOT NULL REFERENCES locations(id),
  cell_id TEXT NOT NULL DEFAULT '',
  cell_lat REAL,
  cell_lon REAL,
  cell_size_deg REAL,
  aggregation TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_basis TEXT NOT NULL CHECK (period_basis IN ('solution_bounds', 'calendar_month')),
  tws_anomaly_cm REAL NOT NULL,
  uncertainty_cm REAL,
  baseline TEXT NOT NULL,
  release_version TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT 'TWS anomaly, cm equivalent water height (not groundwater level)',
  data_kind TEXT NOT NULL DEFAULT 'satellite_monthly' CHECK (data_kind = 'satellite_monthly'),
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  retrieved_at TEXT NOT NULL,
  CHECK ((scope = 'national' AND cell_id = '') OR (scope = 'grid_cell' AND cell_id <> ''))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_water_storage_record
  ON water_storage(source_id, release_version, scope, location_id, cell_id, period_start);
CREATE INDEX IF NOT EXISTS ix_water_storage_location_period ON water_storage(location_id, period_start);

-- The legacy series is the cos(latitude)-weighted mean of CSR 0.25 deg cells inside the Bangladesh outline, one
-- value per calendar month (solutions in the same month were averaged). Baseline and release verified from the
-- NetCDF attributes (time_mean_removed, product_version). No uncertainty is present in that file.
INSERT OR IGNORE INTO water_storage (scope, location_id, cell_id, aggregation, period_start, period_end, period_basis,
                                     tws_anomaly_cm, uncertainty_cm, baseline, release_version, product, source_id,
                                     retrieved_at)
SELECT 'national', 'bd', '',
       'cos(lat)-weighted mean of CSR 0.25 deg grid cells inside the geoBoundaries ADM0 outline',
       printf('%04d-%02d-01', year, month),
       date(printf('%04d-%02d-01', year, month), '+1 month', '-1 day'),
       'calendar_month', tws_cm, NULL, '2004.000-2009.999 time mean removed', 'CSR RL06.3',
       'CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections', 'grace_csr', retrieved_at
FROM storage_anomaly
WHERE retrieved_at IS NOT NULL AND is_sample = 0 AND EXISTS (SELECT 1 FROM locations WHERE id = 'bd');
