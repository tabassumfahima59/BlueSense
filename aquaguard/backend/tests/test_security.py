"""P1: ADMIN_TOKEN protection, secret handling and CORS."""
import logging
import re
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.security import require_admin
from app.settings import get_settings

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "test-admin-token-7f3c9a"


@pytest.fixture()
def admin_app():
    app = FastAPI()

    @app.post("/api/sync/{source}", dependencies=[Depends(require_admin)])
    def sync(source: str):
        return {"accepted": source}

    return TestClient(app)


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", SecretStr(TOKEN))


def test_missing_token_rejected(admin_app, configured):
    r = admin_app.post("/api/sync/openmeteo")
    assert r.status_code == 401 and r.headers.get("www-authenticate") == "Bearer"


@pytest.mark.parametrize("header", ["Bearer wrong", "Bearer " + TOKEN + "x", "Bearer " + TOKEN[:-1]])
def test_invalid_token_rejected(admin_app, configured, header):
    r = admin_app.post("/api/sync/openmeteo", headers={"Authorization": header})
    assert r.status_code == 403


@pytest.mark.parametrize("header", ["Basic " + TOKEN, TOKEN, "Bearer", "Bearer   "])
def test_malformed_header_rejected(admin_app, configured, header):
    assert admin_app.post("/api/sync/openmeteo", headers={"Authorization": header}).status_code == 401


def test_valid_token_accepted(admin_app, configured):
    r = admin_app.post("/api/sync/openmeteo", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200 and r.json() == {"accepted": "openmeteo"}


def test_unconfigured_server_accepts_nothing(admin_app, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", None)
    r = admin_app.post("/api/sync/openmeteo", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 503 and r.json()["detail"]["status"] == "not_configured"


def test_token_never_logged_or_echoed(admin_app, configured, caplog):
    with caplog.at_level(logging.DEBUG):
        r1 = admin_app.post("/api/sync/x", headers={"Authorization": "Bearer guess-" + TOKEN[:6]})
        r2 = admin_app.post("/api/sync/x", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r1.status_code == 403 and r2.status_code == 200
    assert TOKEN not in caplog.text and TOKEN[:6] not in caplog.text
    assert TOKEN not in r1.text


def test_settings_mask_secrets(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-secret-value")
    get_settings.cache_clear()
    try:
        s = get_settings()
        assert s.admin_token.get_secret_value() == TOKEN
        assert s.llm_api_key.get_secret_value() == "sk-test-secret-value"
        dumped = repr(s) + str(s.model_dump())
        assert TOKEN not in dumped and "sk-test-secret-value" not in dumped
    finally:
        monkeypatch.delenv("ADMIN_TOKEN")
        monkeypatch.delenv("ANTHROPIC_API_KEY")
        get_settings.cache_clear()


def test_cors_does_not_allow_authorization_header(client):
    r = client.options("/api/health", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "authorization"})
    allowed = r.headers.get("access-control-allow-headers", "").lower()
    assert "authorization" not in allowed


def test_frontend_never_references_server_secrets():
    names = ["ADMIN_TOKEN", "ANTHROPIC_API_KEY", "LLM_API_KEY", "EARTHDATA_TOKEN", "OPENMETEO_API_KEY"]
    frontend = ROOT / "frontend"
    offenders = []
    for path in frontend.rglob("*"):
        if any(p in path.parts for p in ("node_modules", ".next", "public")) or not path.is_file():
            continue
        if path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".json", ".css"} and not path.name.startswith(".env"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        offenders += [f"{path.name}: {n}" for n in names if n in text]
        offenders += [f"{path.name}: {m}" for m in re.findall(r"NEXT_PUBLIC_\w*(?:KEY|TOKEN|SECRET)\w*", text)]
    assert offenders == []


def test_env_example_contains_no_secret_values():
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    for name in ["ADMIN_TOKEN", "ANTHROPIC_API_KEY", "EARTHDATA_TOKEN", "OPENMETEO_API_KEY", "LLM_API_KEY"]:
        lines = [ln for ln in text.splitlines() if ln.startswith(name + "=")]
        assert lines, f"{name} must be documented"
        assert all(ln.split("=", 1)[1].split("#", 1)[0].strip() == "" for ln in lines), f"{name} must be empty"
