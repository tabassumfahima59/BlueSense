"""Shared helpers for the offline ingestion + ML pipeline.

Every adapter records its provenance in data/processed/sources_retrieved.json
(source id -> retrievedAt, details) so the API can publish real retrieval times.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
SAMPLE = DATA / "sample"
GEO = DATA / "geo"
ARTIFACTS = ROOT / "ml" / "artifacts"
RETRIEVED_FILE = PROCESSED / "sources_retrieved.json"

USER_AGENT = "AquaGuard-prototype/0.1 (research prototype)"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_divisions() -> list[dict]:
    return json.loads((GEO / "divisions.json").read_text(encoding="utf-8"))["divisions"]


def load_geo_registry() -> dict:
    return json.loads((GEO / "divisions.json").read_text(encoding="utf-8"))


def http_get(url: str, timeout: int = 120, retries: int = 4, backoff: float = 20.0) -> bytes:
    """GET with retry/backoff. Raises the last error when all retries fail."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:  # 429 = rate limited
            last = e
            wait = backoff * (attempt + 1) * (3 if e.code == 429 else 1)
            print(f"  HTTP {e.code} on attempt {attempt + 1}; waiting {wait:.0f}s")
            time.sleep(wait)
        except Exception as e:  # network errors
            last = e
            print(f"  error {e!r} on attempt {attempt + 1}; waiting {backoff:.0f}s")
            time.sleep(backoff)
    assert last is not None
    raise last


def record_retrieval(source_id: str, details: dict | None = None) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    data = {}
    if RETRIEVED_FILE.exists():
        data = json.loads(RETRIEVED_FILE.read_text(encoding="utf-8"))
    data[source_id] = {"retrievedAt": now_iso(), **(details or {})}
    RETRIEVED_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
