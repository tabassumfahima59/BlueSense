-- 0004_water_statistics: national statistics with original reference years, symbols and imputation flags.
-- Revisions are kept: an older row gets `superseded_at`, it is never overwritten or deleted.

CREATE TABLE IF NOT EXISTS water_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iso3 TEXT NOT NULL DEFAULT 'BGD',
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  indicator_code TEXT NOT NULL,
  indicator_key TEXT,
  indicator_name TEXT NOT NULL,
  reference_year INTEGER NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  symbol TEXT,
  symbol_description TEXT,
  imputed INTEGER NOT NULL CHECK (imputed IN (0, 1)),
  last_non_imputed_year INTEGER,
  data_kind TEXT NOT NULL DEFAULT 'statistic' CHECK (data_kind = 'statistic'),
  source_last_updated TEXT,
  retrieved_at TEXT NOT NULL,
  superseded_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_water_statistics_current
  ON water_statistics(source_id, iso3, indicator_code, reference_year) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_water_statistics_key ON water_statistics(indicator_key, reference_year);

-- Preserve the legacy latest values exactly as AQUASTAT published them for their year. AQUASTAT symbol 'I' means
-- imputed (carried forward/interpolated by AQUASTAT); the legacy `reference_year` column holds the last
-- non-imputed year, which is kept as `last_non_imputed_year`.
INSERT OR IGNORE INTO water_statistics (iso3, source_id, indicator_code, indicator_key, indicator_name, reference_year,
                                        value, unit, symbol, imputed, last_non_imputed_year, retrieved_at)
SELECT 'BGD', 'fao_aquastat', CAST(variable_code AS TEXT), key, COALESCE(variable, key), year, value, COALESCE(unit, ''),
       symbol,
       CASE WHEN symbol = 'I' THEN 1 ELSE 0 END,
       reference_year,
       retrieved_at
FROM water_resources
WHERE source_id = 'fao_aquastat' AND year IS NOT NULL AND variable_code IS NOT NULL AND retrieved_at IS NOT NULL
  AND is_sample = 0;
