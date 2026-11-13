"""Run sync jobs from the command line (from backend/):

    python -m app.sync.run forecast            # one job (skipped when it ran recently)
    python -m app.sync.run all --force         # every job, ignoring the min-interval check
    python -m app.sync.run status              # data-source status (fresh / stale / unavailable / not_configured)
    python -m app.sync.run forecast --db PATH  # another database

Pending migrations are applied first (with a verified backup). Exit code 1 when a job failed.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from ..db import connection, migrate
from ..settings import get_settings
from . import status as status_mod
from .jobs import JOBS, run_job


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.sync.run", description="AquaGuard data sync")
    parser.add_argument("job", choices=[*JOBS, "all", "status"])
    parser.add_argument("--db", type=Path, help="database path (default: AQUAGUARD_DB_PATH or data/aquaguard.db)")
    parser.add_argument("--force", action="store_true", help="ignore the min-interval check")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    settings = get_settings()
    if args.db:
        settings = settings.model_copy(update={"db_path": args.db})
    if not settings.db_path.exists():
        print(f"database not found: {settings.db_path}", file=sys.stderr)
        return 2
    migrate.migrate(settings.db_path, backup=True, backup_dir=settings.backup_dir)

    if args.job == "status":
        conn = connection.connect(settings.db_path, read_only=True)
        try:
            print(json.dumps(status_mod.all_statuses(conn, settings), indent=1))
        finally:
            conn.close()
        return 0

    names = list(JOBS) if args.job == "all" else [args.job]
    results = [run_job(name, settings=settings, force=args.force) for name in names]
    print(json.dumps([r.as_dict() for r in results], indent=1))
    return 1 if any(r.status == "failed" for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
