"""Build an isolated database from committed data and recorded provider fixtures; no network or local DB access."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / "fixtures"


def build_test_database(path: Path) -> None:
    sys.path.insert(0, str(ROOT / "ml"))
    try:
        import build_db

        # A developer's ignored raw download must not change the test seed.
        with patch.object(build_db, "aquastat_history_rows", return_value=[]):
            build_db.build(path, backup=False)
    finally:
        sys.path.remove(str(ROOT / "ml"))

    from app.db import connection
    from app.sync import aquastat, grace, openmeteo
    from app.sync.runs import RunStats

    conn = connection.connect(path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        rows = aquastat.parse_csv((FIXTURES / "aquastat_bgd_recorded.csv").read_text(encoding="utf-8"), RunStats())
        recorded = json.loads((FIXTURES / "aquastat_bgd_recorded.metadata.json").read_text(encoding="utf-8"))["recorded_at"]
        aquastat.store(conn, rows, recorded, RunStats())
        grid = grace.extract(FIXTURES / "grace_csr_bgd_subset.h5", ROOT / "data" / "geo" / "bgd_adm0.geojson")
        grace.store(conn, grid, "2026-11-12T16:35:00Z", RunStats())
        for point in ("dhaka", "rangpur"):
            forecast = json.loads((FIXTURES / f"openmeteo_forecast_{point}.json").read_text(encoding="utf-8"))
            openmeteo._upsert(conn, openmeteo.parse_forecast(point, forecast, "2026-11-13T17:02:00Z", RunStats()), RunStats())
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
