-- 0008_sync_state: per-source markers remembered between sync runs (e.g. GRACE file Last-Modified / ETag),
-- so large files are downloaded only when the provider publishes a new version.

CREATE TABLE IF NOT EXISTS sync_state (
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, key)
);
