"""Keep the P1 tables in step with the legacy tables during bootstrap imports (``ml/build_db.py``).

The SQL mirrors the data-copy statements in migrations 0002–0005 (which run once per database), but as upserts so
a later import of newer processed files also reaches the new tables. All functions expect an open transaction on a
connection from :mod:`app.db.connection` and return the number of rows changed. Nothing is deleted; NULL
measurements are never written; values change only when the incoming value differs.
"""
from __future__ import annotations

import sqlite3
from collections.abc import Iterable

WEATHER_COLUMNS = [
    # legacy column, Open-Meteo variable, unit
    ("precip_mm", "precipitation_sum", "mm"),
    ("tmax_c", "temperature_2m_max", "°C"),
    ("tmin_c", "temperature_2m_min", "°C"),
    ("tmean_c", "temperature_2m_mean", "°C"),
    ("et0_mm", "et0_fao_evapotranspiration", "mm"),
    ("soil_moisture_m3m3", "soil_moisture_0_to_7cm_mean", "m³/m³"),
]


def _changes(conn: sqlite3.Connection, sql: str, params: Iterable = ()) -> int:
    before = conn.total_changes
    conn.execute(sql, tuple(params))
    return conn.total_changes - before


def locations_from_regions(conn: sqlite3.Connection) -> int:
    return _changes(conn, """
        INSERT INTO locations (id, name, name_bn, level, parent_id, lat, lon, point_kind, iso3, boundary_ref, area_km2,
                               is_weather_point, is_selectable)
        SELECT id, name, name_bn, level, parent_id, lat, lon,
               CASE level WHEN 'division' THEN 'representative_point' ELSE 'geometry_centroid' END, 'BGD',
               CASE level WHEN 'country' THEN 'geoBoundaries-BGD-ADM0' WHEN 'division' THEN 'geoBoundaries-BGD-ADM1'
                          ELSE 'geoBoundaries-BGD-ADM2' END,
               area_km2, CASE WHEN level = 'division' THEN 1 ELSE 0 END,
               CASE WHEN level IN ('country', 'division') THEN 1 ELSE 0 END
        FROM regions
        WHERE level IN ('country', 'division', 'district')
        ORDER BY CASE level WHEN 'country' THEN 0 WHEN 'division' THEN 1 ELSE 2 END
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, name_bn = COALESCE(excluded.name_bn, locations.name_bn),
          lat = COALESCE(excluded.lat, locations.lat), lon = COALESCE(excluded.lon, locations.lon),
          area_km2 = COALESCE(excluded.area_km2, locations.area_km2)
        WHERE locations.name IS NOT excluded.name OR locations.lat IS NOT COALESCE(excluded.lat, locations.lat)
           OR locations.lon IS NOT COALESCE(excluded.lon, locations.lon)
           OR locations.area_km2 IS NOT COALESCE(excluded.area_km2, locations.area_km2)
           OR locations.name_bn IS NOT COALESCE(excluded.name_bn, locations.name_bn)
    """)


def weather_values_from_daily(conn: sqlite3.Connection) -> int:
    """Archive (reanalysis) values: the latest archive retrieval replaces an older value for the same day."""
    total = 0
    for column, variable, unit in WEATHER_COLUMNS:
        total += _changes(conn, f"""
            INSERT INTO weather_values (location_id, variable, data_kind, time_step, valid_time, value, unit,
                                        source_id, retrieved_at)
            SELECT division, ?, 'reanalysis', 'daily', date, {column}, ?, 'openmeteo_archive', retrieved_at
            FROM weather_daily
            WHERE {column} IS NOT NULL AND retrieved_at IS NOT NULL AND is_sample = 0
              AND division IN (SELECT id FROM locations)
            ON CONFLICT(location_id, variable, data_kind, time_step, valid_time) DO UPDATE SET
              value = excluded.value, unit = excluded.unit, retrieved_at = excluded.retrieved_at
            WHERE weather_values.value IS NOT excluded.value
        """, (variable, unit))
    return total


def water_statistics_from_legacy(conn: sqlite3.Connection) -> int:
    """Latest AQUASTAT values as published for their year (symbols and imputation preserved). Existing rows are
    never overwritten; revisions are handled by the P2 adapter with ``superseded_at``."""
    return _changes(conn, """
        INSERT OR IGNORE INTO water_statistics (iso3, source_id, indicator_code, indicator_key, indicator_name,
                                                reference_year, value, unit, symbol, imputed, last_non_imputed_year,
                                                retrieved_at)
        SELECT 'BGD', 'fao_aquastat', CAST(variable_code AS TEXT), key, COALESCE(variable, key), year, value,
               COALESCE(unit, ''), symbol, CASE WHEN symbol = 'I' THEN 1 ELSE 0 END, reference_year, retrieved_at
        FROM water_resources
        WHERE source_id = 'fao_aquastat' AND year IS NOT NULL AND variable_code IS NOT NULL
          AND retrieved_at IS NOT NULL AND is_sample = 0
    """)


def insert_water_statistics(conn: sqlite3.Connection, rows: list[dict]) -> int:
    """Insert genuine AQUASTAT records (one per indicator and reference year). Existing rows are kept."""
    before = conn.total_changes
    conn.executemany("""
        INSERT OR IGNORE INTO water_statistics (iso3, source_id, indicator_code, indicator_key, indicator_name,
                                                reference_year, value, unit, symbol, symbol_description, imputed,
                                                last_non_imputed_year, retrieved_at)
        VALUES (:iso3, :source_id, :indicator_code, :indicator_key, :indicator_name, :reference_year, :value, :unit,
                :symbol, :symbol_description, :imputed, :last_non_imputed_year, :retrieved_at)
    """, rows)
    return conn.total_changes - before


def water_storage_from_legacy(conn: sqlite3.Connection) -> int:
    """National CSR RL06.3 series. Existing monthly records are kept (revisions are a P2 adapter concern)."""
    return _changes(conn, """
        INSERT OR IGNORE INTO water_storage (scope, location_id, cell_id, aggregation, period_start, period_end,
                                             period_basis, tws_anomaly_cm, uncertainty_cm, baseline, release_version,
                                             product, source_id, retrieved_at)
        SELECT 'national', 'bd', '',
               'cos(lat)-weighted mean of CSR 0.25 deg grid cells inside the geoBoundaries ADM0 outline',
               printf('%04d-%02d-01', year, month), date(printf('%04d-%02d-01', year, month), '+1 month', '-1 day'),
               'calendar_month', tws_cm, NULL, '2004.000-2009.999 time mean removed', 'CSR RL06.3',
               'CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections', 'grace_csr', retrieved_at
        FROM storage_anomaly
        WHERE retrieved_at IS NOT NULL AND is_sample = 0 AND EXISTS (SELECT 1 FROM locations WHERE id = 'bd')
    """)


def all_from_legacy(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        "locations": locations_from_regions(conn),
        "weather_values": weather_values_from_daily(conn),
        "water_statistics": water_statistics_from_legacy(conn),
        "water_storage": water_storage_from_legacy(conn),
    }
