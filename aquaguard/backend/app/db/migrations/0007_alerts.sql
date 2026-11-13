-- 0007_alerts: stored alerts (one open alert per rule and location) and per-client read marks.
-- The legacy `alerts_log` table is kept unchanged.

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  indicator TEXT NOT NULL,
  value REAL,
  threshold REAL,
  unit TEXT,
  basis TEXT,
  data_kind TEXT NOT NULL CHECK (data_kind IN ('observed', 'model_current', 'forecast', 'reanalysis',
    'satellite_monthly', 'satellite_historical', 'statistic', 'derived', 'prediction', 'scenario', 'conceptual')),
  source_id TEXT REFERENCES data_sources(id),
  message TEXT NOT NULL,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerts_open ON alerts(rule_id, location_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_alerts_location ON alerts(location_id, severity, created_at);

CREATE TABLE IF NOT EXISTS alert_reads (
  alert_id INTEGER NOT NULL REFERENCES alerts(id),
  client_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (alert_id, client_id)
);
