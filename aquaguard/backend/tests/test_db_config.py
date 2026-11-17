"""P1: SQLite configuration (WAL, foreign keys, busy timeout, read-only) and schema constraints."""
import json
import sqlite3

import pytest

from app.db import connection, migrate


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "cfg.db"
    migrate.migrate(path, backup=False)
    conn = connection.connect(path)
    conn.execute("INSERT INTO locations (id, name, level, point_kind) VALUES ('bd','Bangladesh','country','geometry_centroid')")
    conn.execute("INSERT INTO locations (id, name, level, parent_id, point_kind, is_weather_point, is_selectable) "
                 "VALUES ('dhaka','Dhaka','division','bd','representative_point',1,1)")
    conn.close()
    return path


def test_pragmas(db):
    conn = connection.connect(db)
    state = connection.pragma_state(conn)
    assert state["journal_mode"] == "wal"
    assert state["foreign_keys"] == 1
    assert state["busy_timeout"] == connection.BUSY_TIMEOUT_MS == 5000
    assert state["query_only"] == 0
    conn.close()


def test_wal_is_set_outside_transactions(tmp_path):
    path = tmp_path / "w.db"
    assert connection.ensure_wal(path) == "wal"
    assert connection.ensure_wal(path) == "wal"  # idempotent


def test_foreign_keys_enforced(db):
    conn = connection.connect(db)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO weather_values (location_id, variable, data_kind, time_step, valid_time, value, unit, "
                     "source_id, retrieved_at) VALUES ('atlantis','precipitation_sum','reanalysis','daily','2020-01-01',"
                     "1,'mm','openmeteo_archive','2026-01-01T00:00:00Z')")
    conn.close()


def test_read_only_connection_blocks_writes(db):
    conn = connection.connect(db, read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0] == 2
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("INSERT INTO sync_runs (source_id, job, started_at, status) "
                     "VALUES ('openmeteo_archive','x','t','running')")
    conn.close()


def test_busy_timeout_waits_for_writer(db):
    writer = connection.connect(db)
    writer.execute("BEGIN IMMEDIATE")
    other = sqlite3.connect(str(db), timeout=0, isolation_level=None)
    other.execute("PRAGMA busy_timeout = 100")
    with pytest.raises(sqlite3.OperationalError, match="locked"):
        other.execute("BEGIN IMMEDIATE")
    writer.execute("ROLLBACK")
    other.execute("BEGIN IMMEDIATE")  # succeeds once the writer is done
    other.execute("ROLLBACK")
    writer.close()
    other.close()


def test_weather_values_rejects_null_and_unknown_kind(db):
    conn = connection.connect(db)
    base = ("INSERT INTO weather_values (location_id, variable, data_kind, time_step, valid_time, value, unit, "
            "source_id, retrieved_at) VALUES ('dhaka','precipitation_sum',?, 'daily','2020-01-01',?,'mm',"
            "'openmeteo_archive','2026-01-01T00:00:00Z')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(base, ("reanalysis", None))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(base, ("made_up", 1.0))
    conn.execute(base, ("reanalysis", 1.0))
    with pytest.raises(sqlite3.IntegrityError):  # unique natural key
        conn.execute(base, ("reanalysis", 2.0))
    conn.close()


def test_one_open_alert_per_rule_and_location(db):
    conn = connection.connect(db)
    ins = ("INSERT INTO alerts (rule_id, location_id, severity, indicator, data_kind, message, created_at) "
           "VALUES ('r1','dhaka','high','x','derived','m','2026-01-01T00:00:00Z')")
    conn.execute(ins)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(ins)
    conn.execute("UPDATE alerts SET resolved_at='2026-01-02T00:00:00Z' WHERE rule_id='r1'")
    conn.execute(ins)  # a new open alert is allowed once the previous one is resolved
    conn.close()


def test_water_statistics_revisions(db):
    conn = connection.connect(db)
    row = ("INSERT INTO water_statistics (source_id, indicator_code, indicator_name, reference_year, value, unit, imputed, "
           "retrieved_at, superseded_at) VALUES ('fao_aquastat','4550','SDG 6.4.2',2020,?, '%', 0, 't', ?)")
    conn.execute(row, (5.7, None))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(row, (5.8, None))  # only one current value per indicator and year
    conn.execute("UPDATE water_statistics SET superseded_at='2026-02-01' WHERE value=5.7")
    conn.execute(row, (5.8, None))      # revision kept alongside the superseded row
    assert conn.execute("SELECT COUNT(*) FROM water_statistics").fetchone()[0] == 2
    conn.close()


def test_predictions_v2_requires_valid_snapshot(db):
    conn = connection.connect(db)
    sql = ("INSERT INTO predictions_v2 (model, model_version, target, location_id, horizon, issued_period, target_period,"
           " value, unit, data_kind, generated_at, input_snapshot) VALUES ('rf','1','d','dhaka',1,'2026-10','2026-11',"
           "-70,'mm','prediction','t',?)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, ("not json",))
    conn.execute(sql, (json.dumps({"weather_values": ["dhaka|2026-10"]}),))
    conn.close()


def test_water_storage_scope_constraint(db):
    conn = connection.connect(db)
    sql = ("INSERT INTO water_storage (scope, location_id, cell_id, period_start, period_end, period_basis, "
           "tws_anomaly_cm, baseline, release_version, product, source_id, retrieved_at) VALUES "
           "(?, 'bd', ?, '2020-01-01','2020-01-31','calendar_month', 1.0, 'b', 'RL06.3', 'p', 'grace_csr', 't')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, ("grid_cell", ""))   # grid cells need a cell id
    conn.execute(sql, ("national", ""))
    conn.execute(sql, ("grid_cell", "23.875_90.125"))
    conn.close()


def test_api_reads_migrated_wal_database(client):
    """The running app reads the (migrated, WAL) test database through the read-only connection."""
    from app.services import data_access as da
    from app.settings import get_settings

    migrate.migrate(get_settings().db_path, backup=False)
    da.clear_cache()
    r = client.get("/api/regions")
    assert r.status_code == 200 and len(r.json()["divisions"]) == 8
