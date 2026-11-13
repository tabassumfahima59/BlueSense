"""P1: ml/build_db.py is an idempotent bootstrap importer that never replaces or shrinks the database."""
import sqlite3
import sys
from pathlib import Path

import pytest

from app.db import connection, migrate

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

if not (ROOT / "data" / "processed" / "weather_daily.csv").exists():
    pytest.skip("processed data not available", allow_module_level=True)

import build_db  # noqa: E402


def test_fresh_import_then_rerun_changes_nothing(tmp_path):
    db = tmp_path / "boot.db"
    first = build_db.build(db, backup_dir=tmp_path / "bk")
    assert first["migrations_applied"] == [m.version for m in migrate.discover()]
    assert first["after"]["weather_daily"] > 0 and first["after"]["weather_values"] > 0
    inode_before = db.stat().st_ino
    second = build_db.build(db, backup_dir=tmp_path / "bk")
    assert second["migrations_applied"] == []
    assert second["after"] == first["after"]
    for name, value in second["stats"].items():
        assert value in (0, (0, 0)), f"{name} changed on an identical re-import: {value}"
    assert db.stat().st_ino == inode_before, "database file must not be replaced"
    assert second["backup"], "a verified backup is taken before importing into a non-empty database"


def test_import_preserves_existing_rows_and_never_writes_null(tmp_path):
    db = tmp_path / "keep.db"
    build_db.build(db, backup=False)
    conn = connection.connect(db)
    conn.execute("INSERT INTO scenarios (created_at, region, params_json) VALUES ('t', 'bd', '{}')")
    # a value the processed files do not contain (NULL in the file must not erase it)
    conn.execute("UPDATE weather_daily SET soil_moisture_m3m3 = 0.4242 WHERE soil_moisture_m3m3 IS NULL "
                 "AND rowid = (SELECT MIN(rowid) FROM weather_daily WHERE soil_moisture_m3m3 IS NULL)")
    kept = conn.total_changes
    conn.close()
    result = build_db.build(db, backup=False)
    conn = connection.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM scenarios").fetchone()[0] == 1
    if kept > 1:
        assert conn.execute("SELECT COUNT(*) FROM weather_daily WHERE soil_moisture_m3m3 = 0.4242").fetchone()[0] == 1
    conn.close()
    assert all(result["after"][t] >= n for t, n in result["before"].items())


def test_aquastat_history_contains_only_genuine_years():
    rows = build_db.aquastat_history_rows()
    if not rows:
        pytest.skip("raw AQUASTAT CSV not present")
    assert all(r["symbol"] != "I" and r["imputed"] == 0 for r in rows)
    withdrawal_years = {r["reference_year"] for r in rows if r["indicator_code"] == "4253"}
    assert withdrawal_years == {2008}, "AQUASTAT reports total withdrawal for 2008 only"


def test_import_into_existing_data_copy(tmp_path):
    backups = sorted((ROOT / "data" / "backups").glob("aquaguard-pre-p1-*.db"))
    if not backups:
        pytest.skip("no pre-P1 backup")
    src = sqlite3.connect(f"file:{backups[-1]}?mode=ro", uri=True)
    db = tmp_path / "existing.db"
    dst = sqlite3.connect(db)
    src.backup(dst)
    dst.close()
    before = {t: src.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in ("scenarios", "weather_daily")}
    src.close()
    result = build_db.build(db, backup_dir=tmp_path / "bk")
    assert result["after"]["scenarios"] == before["scenarios"]
    assert result["after"]["weather_daily"] == before["weather_daily"]
    assert result["backup"] and Path(result["backup"]).exists()
