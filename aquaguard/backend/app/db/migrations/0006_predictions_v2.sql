-- 0006_predictions_v2: versioned model outputs with the exact inputs used (input_snapshot JSON).
-- The legacy `predictions` table is kept unchanged.

CREATE TABLE IF NOT EXISTS predictions_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  target TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  horizon INTEGER NOT NULL CHECK (horizon > 0),
  horizon_unit TEXT NOT NULL DEFAULT 'month' CHECK (horizon_unit IN ('day', 'month', 'year')),
  issued_period TEXT NOT NULL,
  target_period TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  lower REAL,
  upper REAL,
  interval_level REAL CHECK (interval_level IS NULL OR (interval_level > 0 AND interval_level < 1)),
  data_kind TEXT NOT NULL CHECK (data_kind IN ('prediction', 'scenario')),
  generated_at TEXT NOT NULL,
  input_snapshot TEXT NOT NULL CHECK (json_valid(input_snapshot)),
  source_id TEXT NOT NULL DEFAULT 'aquaguard_ml' REFERENCES data_sources(id),
  UNIQUE (model, model_version, location_id, target, horizon, issued_period)
);
CREATE INDEX IF NOT EXISTS ix_predictions_v2_lookup ON predictions_v2(location_id, target, target_period);
