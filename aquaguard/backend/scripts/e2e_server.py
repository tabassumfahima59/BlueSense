"""Backend for the Playwright end-to-end tests (frontend/e2e).

Copies the development database with the SQLite backup API into a temporary folder (the real database is never
written), disables outbound calls and the scheduler, allows the e2e frontend origin and serves on 127.0.0.1:8013.

    python backend/scripts/e2e_server.py [--port 8013] [--origin http://127.0.0.1:3100]
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8013)
    parser.add_argument("--origin", default="http://127.0.0.1:3100,http://localhost:3100")
    args = parser.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="aquaguard-e2e-"))
    db = tmp / "aquaguard.db"
    real = ROOT / "data" / "aquaguard.db"
    if real.exists():
        src, dst = sqlite3.connect(real), sqlite3.connect(db)
        src.backup(dst)
        dst.close()
        src.close()
    os.environ.update({
        "AQUAGUARD_DB_PATH": str(db), "AQUAGUARD_BACKUP_DIR": str(tmp / "backups"), "AQUAGUARD_OFFLINE": "1",
        "AQUAGUARD_SCHEDULER_ENABLED": "0", "AQUAGUARD_MIGRATE_ON_STARTUP": "1", "CORS_ORIGINS": args.origin,
    })
    for secret in ("ADMIN_TOKEN", "ANTHROPIC_API_KEY", "LLM_API_KEY", "GEMINI_API_KEY", "EARTHDATA_TOKEN",
                   "OPENMETEO_API_KEY"):
        os.environ.pop(secret, None)
    sys.path.insert(0, str(ROOT / "backend"))
    os.chdir(ROOT / "backend")
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
