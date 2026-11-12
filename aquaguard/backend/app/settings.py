"""Runtime settings from environment variables (secrets never live in code or git)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]  # aquaguard/


class Settings(BaseModel):
    root: Path = ROOT
    data_dir: Path = ROOT / "data"
    db_path: Path = ROOT / "data" / "aquaguard.db"
    artifacts_dir: Path = ROOT / "ml" / "artifacts"
    config_dir: Path = Path(__file__).resolve().parent / "config"
    cors_origins: list[str] = ["http://localhost:3000"]
    offline: bool = False          # block all outbound HTTP (tests / demo resilience)
    force_sample: bool = False     # ignore the database and serve data/sample snapshots
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_provider: str = "anthropic"
    copilot_rate_per_min: int = 20
    forecast_ttl_s: int = 3 * 3600


def _bool(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


@lru_cache
def get_settings() -> Settings:
    origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    s = Settings(
        cors_origins=origins,
        offline=_bool("AQUAGUARD_OFFLINE"),
        force_sample=_bool("AQUAGUARD_FORCE_SAMPLE"),
        llm_api_key=os.getenv("LLM_API_KEY") or None,
        llm_model=os.getenv("LLM_MODEL") or None,
        llm_provider=os.getenv("LLM_PROVIDER", "anthropic"),
        copilot_rate_per_min=int(os.getenv("COPILOT_RATE_PER_MIN", "20")),
    )
    if os.getenv("AQUAGUARD_DB_PATH"):
        s.db_path = Path(os.environ["AQUAGUARD_DB_PATH"])
    return s
