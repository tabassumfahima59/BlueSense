"""Export the OpenAPI spec (docs/openapi.json) used to generate the frontend TypeScript types.

    python backend/scripts/export_openapi_and_mocks.py

P2 (decision 5): the backend no longer has a sample/mock mode, so this script no longer captures mock JSON.
The existing files in frontend/public/mocks are frozen and are removed together with the frontend mock mode (P4).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ["AQUAGUARD_OFFLINE"] = "1"
os.environ["AQUAGUARD_MIGRATE_ON_STARTUP"] = "0"
os.environ["AQUAGUARD_BOOTSTRAP_ON_STARTUP"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "openapi.json").write_text(json.dumps(app.openapi(), indent=1), encoding="utf-8")
    print("openapi -> docs/openapi.json")


if __name__ == "__main__":
    main()
