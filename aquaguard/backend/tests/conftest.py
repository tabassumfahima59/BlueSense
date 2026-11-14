import atexit
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
REAL_DB = ROOT / "data" / "aquaguard.db"

# Tests never touch the network or an LLM.
os.environ.setdefault("AQUAGUARD_OFFLINE", "1")
for _secret in ("LLM_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "ADMIN_TOKEN", "EARTHDATA_TOKEN",
                "OPENMETEO_API_KEY"):
    os.environ.pop(_secret, None)
os.environ.setdefault("AQUAGUARD_MIGRATE_ON_STARTUP", "0")

# Tests never write to the real database: they run against a private copy made with the SQLite backup API
# (consistent even in WAL mode). Some API tests write (e.g. POST /scenario/run logs a scenario row).
if "AQUAGUARD_DB_PATH" not in os.environ and REAL_DB.exists():
    _tmpdir = Path(tempfile.mkdtemp(prefix="aquaguard-tests-"))
    _copy = _tmpdir / "aquaguard.db"
    _src = sqlite3.connect(REAL_DB)
    _dst = sqlite3.connect(_copy)
    _src.backup(_dst)
    _dst.close()
    _src.close()
    os.environ["AQUAGUARD_DB_PATH"] = str(_copy)
    os.environ.setdefault("AQUAGUARD_BACKUP_DIR", str(_tmpdir / "backups"))
    atexit.register(shutil.rmtree, _tmpdir, ignore_errors=True)

    # Bring the copy to the current schema and store the recorded Dhaka and Rangpur forecasts (tests/fixtures, real
    # Open-Meteo responses) through the adapter, so offline API tests read a stored forecast (no sample snapshot).
    import json

    from app.db import connection, migrate
    from app.sync import openmeteo
    from app.sync.runs import RunStats

    migrate.migrate(_copy, backup=False)
    _conn = connection.connect(_copy)
    try:
        _conn.execute("BEGIN IMMEDIATE")
        for _point in ("dhaka", "rangpur"):
            _fc = json.loads((Path(__file__).parent / "fixtures" / f"openmeteo_forecast_{_point}.json")
                             .read_text(encoding="utf-8"))
            openmeteo._upsert(_conn, openmeteo.parse_forecast(_point, _fc, "2026-11-13T17:02:00Z", RunStats()),
                              RunStats())
        _conn.execute("COMMIT")
    finally:
        _conn.close()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
