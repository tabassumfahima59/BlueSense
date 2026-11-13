"""Runtime settings from environment variables (secrets never live in code or git).

Secrets are ``SecretStr``: they are masked in ``repr``/logs and must be read with ``.get_secret_value()`` at the
single point of use. Every variable is documented in ``aquaguard/.env.example``.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, SecretStr

ROOT = Path(__file__).resolve().parents[2]  # aquaguard/


class Settings(BaseModel):
    # paths
    root: Path = ROOT
    data_dir: Path = ROOT / "data"
    db_path: Path = ROOT / "data" / "aquaguard.db"
    backup_dir: Path = ROOT / "data" / "backups"
    artifacts_dir: Path = ROOT / "ml" / "artifacts"
    config_dir: Path = Path(__file__).resolve().parent / "config"

    # web
    cors_origins: list[str] = ["http://localhost:3000"]
    offline: bool = False          # block all outbound HTTP (tests / demo resilience)

    # database
    migrate_on_startup: bool = True
    bootstrap_on_startup: bool = True   # build the DB from data/processed when it is missing (original dates kept)

    # data sources (P2 adapters)
    openmeteo_forecast_url: str = "https://api.open-meteo.com/v1/forecast"
    openmeteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    openmeteo_api_key: SecretStr | None = None      # optional paid plan
    aquastat_api_url: str = "https://api.data.apps.fao.org/api/v2/bigquery"
    grace_csr_url: str = ("https://download.csr.utexas.edu/outgoing/grace/RL0603_mascons/"
                          "CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc")
    earthdata_token: SecretStr | None = None        # future JPL adapter (Deviation D1)

    # scheduler (P2)
    scheduler_enabled: bool = False
    sync_forecast_minutes: int = 60
    sync_archive_hours: int = 24
    sync_aquastat_days: int = 7
    sync_grace_hours: int = 24
    sync_interval_override_s: int | None = None  # verification only: run every job at this interval (seconds)
    stale_factor: float = 2.0                    # stale when the last success is older than factor x cadence
    grace_max_download_bytes: int = 600 * 1024 * 1024

    # HTTP client
    http_connect_timeout_s: float = 10.0
    http_read_timeout_s: float = 60.0
    http_max_retries: int = 4
    http_backoff_base_s: float = 1.0
    http_backoff_max_s: float = 60.0
    http_retry_after_max_s: float = 300.0

    # security
    admin_token: SecretStr | None = None

    # copilot
    llm_api_key: SecretStr | None = None            # ANTHROPIC_API_KEY (or legacy LLM_API_KEY)
    llm_model: str | None = None
    llm_provider: str = "anthropic"
    copilot_rate_per_min: int = 20
    forecast_ttl_s: int = 3 * 3600


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _secret(*names: str) -> SecretStr | None:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return SecretStr(value.strip())
    return None


def _num(name: str, default: float, cast=float):
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return cast(raw)
    except ValueError as exc:
        raise ValueError(f"environment variable {name} must be a number") from exc


@lru_cache
def get_settings() -> Settings:
    origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    s = Settings(
        cors_origins=origins,
        offline=_bool("AQUAGUARD_OFFLINE"),
        migrate_on_startup=_bool("AQUAGUARD_MIGRATE_ON_STARTUP", True),
        bootstrap_on_startup=_bool("AQUAGUARD_BOOTSTRAP_ON_STARTUP", True),
        openmeteo_api_key=_secret("OPENMETEO_API_KEY"),
        earthdata_token=_secret("EARTHDATA_TOKEN"),
        scheduler_enabled=_bool("AQUAGUARD_SCHEDULER_ENABLED"),
        sync_forecast_minutes=_num("SYNC_FORECAST_MINUTES", 60, int),
        sync_archive_hours=_num("SYNC_ARCHIVE_HOURS", 24, int),
        sync_aquastat_days=_num("SYNC_AQUASTAT_DAYS", 7, int),
        sync_grace_hours=_num("SYNC_GRACE_HOURS", 24, int),
        sync_interval_override_s=_num("SYNC_INTERVAL_OVERRIDE_S", None, int),
        stale_factor=_num("SYNC_STALE_FACTOR", 2.0),
        grace_max_download_bytes=_num("GRACE_MAX_DOWNLOAD_BYTES", 600 * 1024 * 1024, int),
        http_connect_timeout_s=_num("HTTP_CONNECT_TIMEOUT_S", 10.0),
        http_read_timeout_s=_num("HTTP_READ_TIMEOUT_S", 60.0),
        http_max_retries=_num("HTTP_MAX_RETRIES", 4, int),
        http_backoff_base_s=_num("HTTP_BACKOFF_BASE_S", 1.0),
        http_backoff_max_s=_num("HTTP_BACKOFF_MAX_S", 60.0),
        http_retry_after_max_s=_num("HTTP_RETRY_AFTER_MAX_S", 300.0),
        admin_token=_secret("ADMIN_TOKEN"),
        llm_api_key=_secret("ANTHROPIC_API_KEY", "LLM_API_KEY"),
        llm_model=os.getenv("LLM_MODEL") or None,
        llm_provider=os.getenv("LLM_PROVIDER", "anthropic"),
        copilot_rate_per_min=_num("COPILOT_RATE_PER_MIN", 20, int),
    )
    for env, attr in (("OPENMETEO_FORECAST_URL", "openmeteo_forecast_url"),
                      ("OPENMETEO_ARCHIVE_URL", "openmeteo_archive_url"),
                      ("AQUASTAT_API_URL", "aquastat_api_url"), ("GRACE_CSR_URL", "grace_csr_url")):
        if os.getenv(env):
            setattr(s, attr, os.environ[env])
    if os.getenv("AQUAGUARD_DB_PATH"):
        s.db_path = Path(os.environ["AQUAGUARD_DB_PATH"])
    if os.getenv("AQUAGUARD_BACKUP_DIR"):
        s.backup_dir = Path(os.environ["AQUAGUARD_BACKUP_DIR"])
    return s
