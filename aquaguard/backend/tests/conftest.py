import atexit
import os
import shutil
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# Tests never touch the network or an LLM.
os.environ["AQUAGUARD_OFFLINE"] = "1"
os.environ["AQUAGUARD_SCHEDULER_ENABLED"] = "0"
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
for _secret in ("LLM_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "ADMIN_TOKEN", "EARTHDATA_TOKEN",
                "OPENMETEO_API_KEY"):
    # Empty environment values take precedence over any developer credentials in backend/.env.
    os.environ[_secret] = ""
# Provider defaults in tests must not depend on a developer's local Copilot model selection.
os.environ["LLM_MODEL"] = ""
os.environ["LLM_PROVIDER"] = "gemini"
os.environ["GEMINI_THINKING_LEVEL"] = "low"
os.environ.setdefault("AQUAGUARD_MIGRATE_ON_STARTUP", "0")

# Always create a private reproducible DB, regardless of the shell's DB path or developer data.
from bluesense_test_db import build_test_database  # noqa: E402

_tmpdir = Path(tempfile.mkdtemp(prefix="bluesense-tests-"))
_copy = _tmpdir / "aquaguard.db"
os.environ["AQUAGUARD_DB_PATH"] = str(_copy)
os.environ["AQUAGUARD_BACKUP_DIR"] = str(_tmpdir / "backups")
atexit.register(shutil.rmtree, _tmpdir, ignore_errors=True)
build_test_database(_copy)


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
