"""Local configuration loads independently of cwd without overriding deployment secrets."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.settings import Settings, get_settings


@pytest.mark.parametrize("file_key, environment_key, expected", [
    ("local-test-key", None, "local-test-key"),
    ("local-test-key", "deployment-test-key", "deployment-test-key"),
    (None, None, None),
])
def test_backend_env_loading(tmp_path, file_key, environment_key, expected):
    backend = tmp_path / "backend"
    app = backend / "app"
    app.mkdir(parents=True)
    shutil.copyfile(Path(__file__).parents[1] / "app" / "settings.py", app / "settings.py")
    if file_key:
        (backend / ".env").write_text(
            f'GEMINI_API_KEY="{file_key}" # local credential\nLLM_PROVIDER=gemini\n', encoding="utf-8-sig")
    env = os.environ.copy()
    env.pop("GEMINI_API_KEY", None)
    env.pop("LLM_PROVIDER", None)
    env.pop("PYTHON_DOTENV_DISABLED", None)
    if environment_key is not None:
        env["GEMINI_API_KEY"] = environment_key
    # A fresh process reproduces server startup from outside backend/.
    script = """
import sys
sys.path.insert(0, sys.argv[1])
from app.settings import get_settings
s = get_settings()
expected = sys.argv[2] or None
assert (s.gemini_api_key.get_secret_value() if s.gemini_api_key else None) == expected
assert s.llm_provider == 'gemini'
assert expected is None or expected not in repr(s)
assert get_settings() is s
"""
    subprocess.run([sys.executable, "-c", script, str(backend), expected or ""],
                   cwd=tmp_path, env=env, check=True, capture_output=True, text=True)


def test_retry_environment_settings(monkeypatch):
    values = {"LLM_CALL_TIMEOUT_S": "25", "COPILOT_DEADLINE_S": "90", "LLM_MAX_RETRIES": "2",
              "LLM_RETRY_BACKOFF_S": "1.5", "LLM_RETRY_AFTER_MAX_S": "30"}
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    try:
        s = get_settings()
        assert (s.llm_call_timeout_s, s.copilot_deadline_s, s.llm_max_retries,
                s.llm_retry_backoff_s, s.llm_retry_after_max_s) == (25, 90, 2, 1.5, 30)
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("field,value", [
    ("llm_call_timeout_s", 0), ("llm_call_timeout_s", float("nan")),
    ("copilot_deadline_s", -1), ("copilot_deadline_s", float("inf")),
    ("llm_max_retries", -1), ("llm_max_retries", 4),
    ("llm_retry_backoff_s", 0), ("llm_retry_after_max_s", -1),
])
def test_invalid_timeouts_and_retry_configuration(field, value):
    with pytest.raises(ValidationError):
        Settings(**{field: value})
