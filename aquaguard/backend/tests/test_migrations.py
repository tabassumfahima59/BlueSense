"""P1: versioned migration runner — fresh DB, existing DB copy, idempotency, rollback, recovery, integrity."""
import shutil
import sqlite3
import threading
from pathlib import Path

import pytest

from app.db import connection, migrate

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_VERSIONS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]
LEGACY = ["regions", "sources", "weather_daily", "weather_monthly", "climatology", "water_resources", "inflow_shape",
          "population_projection", "storage_anomaly", "station_observations", "predictions", "scenarios", "alerts_log"]
NEW = ["locations", "data_sources", "sync_runs", "scheduler_lock", "weather_values", "water_statistics",
       "water_storage", "predictions_v2", "alerts", "alert_reads", "schema_migrations"]


def _copy(src: Path, dest: Path) -> Path:
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dest)
    s.backup(d)
    d.close()
    s.close()
    return dest


def _existing_source() -> Path | None:
    backups = sorted((ROOT / "data" / "backups").glob("aquaguard-pre-p1-*.db"))
    if backups:
        return backups[-1]  # unmigrated snapshot of the real data
    real = ROOT / "data" / "aquaguard.db"
    return real if real.exists() else None


def _schema(conn, tables):
    return {t: conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0]
            for t in tables}


def test_fresh_database_gets_all_migrations(tmp_path):
    db = tmp_path / "fresh.db"
    rep = migrate.migrate(db, backup_dir=tmp_path / "bk")
    assert rep.applied == EXPECTED_VERSIONS
    assert rep.backup_path is None  # nothing to back up in an empty database
    assert rep.journal_mode == "wal"
    conn = connection.connect(db)
    counts = migrate.table_counts(conn)
    for t in LEGACY + NEW:
        assert t in counts, t
    assert counts["data_sources"] >= 10  # reference registry seeded
    history = conn.execute("SELECT version, checksum FROM schema_migrations ORDER BY version").fetchall()
    assert [v for v, _ in history] == EXPECTED_VERSIONS
    files = {m.version: m.checksum for m in migrate.discover()}
    assert all(files[v] == c for v, c in history)
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()


def test_repeated_execution_is_idempotent(tmp_path):
    db = tmp_path / "fresh.db"
    migrate.migrate(db, backup=False)
    conn = connection.connect(db)
    before = migrate.table_counts(conn)
    conn.close()
    rep = migrate.migrate(db, backup=False)
    assert rep.applied == [] and rep.skipped == EXPECTED_VERSIONS
    conn = connection.connect(db)
    assert migrate.table_counts(conn) == before
    conn.close()


def test_existing_database_is_preserved(tmp_path):
    src = _existing_source()
    if src is None:
        pytest.skip("no existing database or pre-P1 backup available")
    db = _copy(src, tmp_path / "existing.db")
    conn = connection.connect(db)
    applied_before = set()
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone():
        applied_before = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
    legacy = [t for t in LEGACY if conn.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone()]
    schema_before = _schema(conn, legacy)
    counts_before = {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in legacy}
    conn.close()

    rep = migrate.migrate(db, backup_dir=tmp_path / "bk")
    if not applied_before:
        assert rep.applied == EXPECTED_VERSIONS
        assert rep.backup_path and Path(rep.backup_path).exists()

    conn = connection.connect(db)
    assert _schema(conn, legacy) == schema_before, "legacy table definitions must not change"
    assert {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in legacy} == counts_before
    # data carried into the new tables
    assert conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0] == counts_before["regions"]
    non_null = sum(conn.execute(f"SELECT COUNT({c}) FROM weather_daily WHERE is_sample = 0").fetchone()[0]
                   for c in ("precip_mm", "tmax_c", "tmin_c", "tmean_c", "et0_mm", "soil_moisture_m3m3"))
    assert conn.execute("SELECT COUNT(*) FROM weather_values WHERE data_kind='reanalysis'").fetchone()[0] == non_null
    assert conn.execute("SELECT COUNT(*) FROM water_storage WHERE scope='national'").fetchone()[0] == \
        counts_before["storage_anomaly"]
    assert conn.execute("SELECT COUNT(*) FROM water_statistics").fetchone()[0] >= counts_before["water_resources"]
    # values identical to the legacy source (spot check: sums)
    s_legacy = conn.execute("SELECT ROUND(SUM(precip_mm), 3) FROM weather_daily").fetchone()[0]
    s_new = conn.execute("SELECT ROUND(SUM(value), 3) FROM weather_values WHERE variable='precipitation_sum'").fetchone()[0]
    assert s_legacy == s_new
    assert conn.execute("SELECT COUNT(*) FROM water_storage WHERE uncertainty_cm IS NOT NULL").fetchone()[0] == 0
    imputed = conn.execute("SELECT COUNT(*) FROM water_statistics WHERE symbol='I' AND imputed=0").fetchone()[0]
    assert imputed == 0, "AQUASTAT 'I' rows must be flagged imputed"
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()


def test_backup_is_taken_before_any_change(tmp_path):
    src = _existing_source()
    if src is None:
        pytest.skip("no existing database or pre-P1 backup available")
    db = _copy(src, tmp_path / "existing.db")
    probe = sqlite3.connect(db)
    unmigrated = probe.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone() is None
    tables_before = sorted(r[0] for r in probe.execute("SELECT name FROM sqlite_master WHERE type='table'"))
    probe.close()
    if not unmigrated:
        pytest.skip("source database is already migrated")
    rep = migrate.migrate(db, backup_dir=tmp_path / "bk")
    copy = sqlite3.connect(rep.backup_path)
    tables_in_backup = sorted(r[0] for r in copy.execute("SELECT name FROM sqlite_master WHERE type='table'"))
    copy.close()
    assert tables_in_backup == tables_before, "backup must equal the state before the runner changed anything"


def _write_migrations(folder: Path, files: dict[str, str]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    for name, sql in files.items():
        (folder / name).write_text(sql, encoding="utf-8")
    return folder


def test_failed_migration_rolls_back_and_recovers(tmp_path):
    mdir = _write_migrations(tmp_path / "m", {
        "0001_a.sql": "CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY, v TEXT);\nINSERT INTO a (v) VALUES ('x;y');\n",
        "0002_b.sql": "CREATE TABLE IF NOT EXISTS b (id INTEGER PRIMARY KEY);\nINSERT INTO a (missing_column) VALUES (1);\n",
    })
    db = tmp_path / "t.db"
    with pytest.raises(migrate.MigrationError):
        migrate.migrate(db, mdir, backup=False)
    conn = connection.connect(db)
    assert [r[0] for r in conn.execute("SELECT version FROM schema_migrations")] == ["0001"]
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE name='b'").fetchone() is None, "table b must be rolled back"
    assert conn.execute("SELECT v FROM a").fetchall() == [("x;y",)]
    conn.close()
    # fix the failed (never applied) migration and run again
    (mdir / "0002_b.sql").write_text("CREATE TABLE IF NOT EXISTS b (id INTEGER PRIMARY KEY);\n", encoding="utf-8")
    rep = migrate.migrate(db, mdir, backup=False)
    assert rep.applied == ["0002"]


def test_foreign_key_violation_rolls_back(tmp_path):
    db = tmp_path / "fk.db"
    migrate.migrate(db, backup=False)
    mdir = tmp_path / "m"
    shutil.copytree(migrate.MIGRATIONS_DIR, mdir)
    bad = f"{int(EXPECTED_VERSIONS[-1]) + 1:04d}"  # the version after the last real migration
    (mdir / f"{bad}_bad.sql").write_text(
        "INSERT INTO weather_values (location_id, variable, data_kind, time_step, valid_time, value, unit, source_id, "
        "retrieved_at) VALUES ('nowhere', 'x', 'reanalysis', 'daily', '2020-01-01', 1, 'mm', 'openmeteo_archive', 't');\n",
        encoding="utf-8")
    with pytest.raises(migrate.MigrationError):
        migrate.migrate(db, mdir, backup=False)
    conn = connection.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM weather_values").fetchone()[0] == 0
    assert conn.execute("SELECT 1 FROM schema_migrations WHERE version=?", (bad,)).fetchone() is None
    conn.close()


def test_edited_applied_migration_is_detected(tmp_path):
    mdir = _write_migrations(tmp_path / "m", {"0001_a.sql": "CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY);\n"})
    db = tmp_path / "t.db"
    migrate.migrate(db, mdir, backup=False)
    (mdir / "0001_a.sql").write_text("CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY, x TEXT);\n", encoding="utf-8")
    with pytest.raises(migrate.MigrationIntegrityError):
        migrate.migrate(db, mdir, backup=False)


@pytest.mark.parametrize("sql", [
    "DROP TABLE regions;", "DELETE FROM regions;", "ALTER TABLE regions DROP COLUMN name;",
    "ALTER TABLE regions RENAME TO r2;", "PRAGMA journal_mode = DELETE;", "VACUUM;",
])
def test_destructive_statements_are_rejected_before_execution(tmp_path, sql):
    mdir = _write_migrations(tmp_path / "m", {
        "0001_ok.sql": "CREATE TABLE IF NOT EXISTS keep (id INTEGER PRIMARY KEY);\n",
        "0002_bad.sql": sql + "\n",
    })
    db = tmp_path / "t.db"
    with pytest.raises(migrate.MigrationIntegrityError):
        migrate.migrate(db, mdir, backup=False)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE name='keep'").fetchone() is None, "nothing may run"
    conn.close()


def test_repository_migrations_are_clean():
    migrations = migrate.discover()
    assert [m.version for m in migrations] == EXPECTED_VERSIONS
    for m in migrations:
        migrate.check_forbidden(m)


def test_concurrent_migration_runs_are_safe(tmp_path):
    db = tmp_path / "c.db"
    errors: list[BaseException] = []

    def run():
        try:
            migrate.migrate(db, backup=False)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    conn = connection.connect(db)
    assert [r[0] for r in conn.execute("SELECT version FROM schema_migrations ORDER BY version")] == EXPECTED_VERSIONS
    conn.close()


def test_backup_is_verified(tmp_path):
    db = tmp_path / "b.db"
    migrate.migrate(db, backup=False)
    conn = connection.connect(db)
    conn.execute("INSERT INTO locations (id, name, level, point_kind) VALUES ('bd', 'Bangladesh', 'country', "
                 "'geometry_centroid')")
    conn.close()
    path = migrate.backup_database(db, tmp_path / "bk")
    copy = sqlite3.connect(path)
    assert copy.execute("SELECT name FROM locations WHERE id='bd'").fetchone() == ("Bangladesh",)
    assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    copy.close()


def test_application_startup_applies_pending_migrations(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.settings import get_settings

    db = tmp_path / "startup.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE keep_me (id INTEGER PRIMARY KEY)")  # an existing, unmigrated database
    conn.execute("INSERT INTO keep_me VALUES (1)")
    conn.commit()
    conn.close()
    s = get_settings()
    monkeypatch.setattr(s, "db_path", db)
    monkeypatch.setattr(s, "backup_dir", tmp_path / "bk")
    monkeypatch.setattr(s, "migrate_on_startup", True)
    with TestClient(app):
        pass  # lifespan runs on enter
    conn = connection.connect(db)
    assert [r[0] for r in conn.execute("SELECT version FROM schema_migrations ORDER BY version")] == EXPECTED_VERSIONS
    assert conn.execute("SELECT id FROM keep_me").fetchall() == [(1,)]
    conn.close()
    assert list((tmp_path / "bk").glob("*.db")), "startup migration must back up first"


def test_split_statements_handles_strings_and_comments():
    sql = "-- c; comment\nCREATE TABLE t (a TEXT);\nINSERT INTO t VALUES ('a;b');  -- trailing\n/* block; */\n"
    stmts = migrate.split_statements(sql)
    assert len(stmts) == 2 and "'a;b'" in stmts[1]


def test_cli_status(tmp_path, capsys):
    db = tmp_path / "s.db"
    migrate.migrate(db, backup=False)
    assert migrate.main(["--db", str(db), "--status"]) == 0
    out = capsys.readouterr().out
    assert out.count("applied") == len(EXPECTED_VERSIONS)
