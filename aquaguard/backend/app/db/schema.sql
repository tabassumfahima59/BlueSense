-- SUPERSEDED (P1): kept for reference only. The schema is now defined by versioned migrations in
-- backend/app/db/migrations/ (0001_baseline records these tables); PRAGMAs are set in backend/app/db/connection.py.
-- Do not execute this file against a database.
-- AquaGuard SQLite schema. Every data record carries source_id, retrieved_at, provenance, is_sample.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_bn TEXT, level TEXT NOT NULL,
  lon REAL NOT NULL, lat REAL NOT NULL, parent_id TEXT, area_km2 REAL, population INTEGER,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, retrieved_at TEXT, details_json TEXT
);

CREATE TABLE IF NOT EXISTS weather_daily (
  division TEXT NOT NULL, date TEXT NOT NULL,
  precip_mm REAL, tmax_c REAL, tmin_c REAL, tmean_c REAL, et0_mm REAL, soil_moisture_m3m3 REAL,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (division, date)
);

CREATE TABLE IF NOT EXISTS weather_monthly (
  division TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
  precip_mm REAL, et0_mm REAL, d_mm REAL, tmean_c REAL, tmax_c REAL, tmin_c REAL,
  soil_moisture_m3m3 REAL, n_days INTEGER,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (division, year, month)
);

CREATE TABLE IF NOT EXISTS climatology (
  division TEXT NOT NULL, month INTEGER NOT NULL,
  precip_mm REAL, precip_sd REAL, et0_mm REAL, tmean_c REAL, tmax_c REAL, tmin_c REAL,
  soil_moisture_m3m3 REAL, d_mm REAL, d_sd REAL, n_years INTEGER,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (division, month)
);

CREATE TABLE IF NOT EXISTS water_resources (
  key TEXT PRIMARY KEY, value REAL NOT NULL, unit TEXT, year INTEGER, reference_year INTEGER,
  symbol TEXT, variable TEXT, variable_code INTEGER,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inflow_shape (
  month INTEGER PRIMARY KEY, share REAL NOT NULL, mean_flow_m3s REAL,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS population_projection (
  year INTEGER PRIMARY KEY, population REAL NOT NULL,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS storage_anomaly (
  date TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, tws_cm REAL NOT NULL,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS station_observations (
  station_id TEXT NOT NULL, station_name TEXT, division TEXT, lon REAL, lat REAL,
  variable TEXT NOT NULL, date TEXT NOT NULL, value REAL, unit TEXT NOT NULL,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, variable, date)
);

CREATE TABLE IF NOT EXISTS predictions (
  division TEXT NOT NULL, horizon INTEGER NOT NULL, issued_month TEXT NOT NULL, target_month TEXT NOT NULL,
  value_mm REAL, low_mm REAL, high_mm REAL, model TEXT,
  source_id TEXT NOT NULL, retrieved_at TEXT, provenance TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (division, horizon, target_month)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, region TEXT NOT NULL,
  params_json TEXT NOT NULL, summary_json TEXT
);

CREATE TABLE IF NOT EXISTS alerts_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, region TEXT NOT NULL,
  scenario_json TEXT, alert_id TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL
);
