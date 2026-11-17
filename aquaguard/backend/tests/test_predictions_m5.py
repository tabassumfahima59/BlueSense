"""M5 Prediction Lab: event-driven inference with the stored models into predictions_v2 (exact inputs kept,
idempotent, never issued from an older month), sync hook, DB-first serving with artifact fallback, model card and
category handling."""
from __future__ import annotations

import json
import os
import sqlite3
from functools import lru_cache
from pathlib import Path

import pytest

from app.db import connection
from app.services import inference
from app.services import ml_artifacts as mla
from app.sync import jobs
from app.sync.runs import RunStats

pytestmark = pytest.mark.skipif(not mla.available(), reason="model artifacts are not present")


@pytest.fixture()
def dbcopy(tmp_path) -> Path:
    """A private copy of the session test database (itself a copy of the real one)."""
    path = tmp_path / "m5.db"
    src = sqlite3.connect(os.environ["AQUAGUARD_DB_PATH"])
    dst = sqlite3.connect(path)
    src.backup(dst)
    src.close()
    dst.execute("DELETE FROM predictions_v2")  # private copy: start every inference test from an empty table
    dst.commit()
    dst.close()
    return path


def newest_month(conn) -> str:
    return conn.execute("SELECT MAX(printf('%04d-%02d', year, month)) FROM weather_monthly").fetchone()[0]


def test_inference_stores_every_division_and_horizon_with_inputs_and_is_idempotent(dbcopy):
    conn = connection.connect(dbcopy)
    divisions = [r[0] for r in conn.execute("SELECT DISTINCT division FROM weather_monthly")]
    before = conn.execute("SELECT COUNT(*) FROM predictions_v2").fetchone()[0]
    out = inference.run(conn)
    assert out["status"] == "success" and out["errors"] == []
    assert out["inserted"] == len(divisions) * len(mla.HORIZONS)
    assert out["issued"] == [newest_month(conn)]
    again = inference.run(conn)
    assert again["inserted"] == 0 and again["skipped"] == out["inserted"]  # nothing overwritten
    assert conn.execute("SELECT COUNT(*) FROM predictions_v2").fetchone()[0] == before + out["inserted"]
    row = conn.execute("SELECT model, model_version, data_kind, interval_level, input_snapshot, lower, value, upper "
                       "FROM predictions_v2 WHERE location_id = 'dhaka' AND horizon = 1").fetchone()
    model, version, kind, level, snap, lo, val, hi = row
    assert model == mla.model_meta()["horizons"]["1"]["selected"] and version == mla.model_meta()["trainedAt"]
    assert kind == "prediction" and level == pytest.approx(0.9) and lo <= val <= hi
    s = json.loads(snap)
    feats = mla._features_module().feature_columns()
    assert set(s["features"]) == set(feats)
    assert s["issuedFrom"] == newest_month(conn) and s["featureCode"].startswith("ml/features.py")
    conn.close()


def test_inference_reproduces_the_artifact_for_the_same_month(dbcopy):
    conn = connection.connect(dbcopy)
    inference.run(conn)
    stored = inference.stored(conn)
    conn.close()
    art = mla.predictions()["forecasts"]
    compared = 0
    for div, hs in stored.items():
        for h, f in hs.items():
            a = art.get(div, {}).get(str(h))
            if a and a["issuedMonth"] == f["issuedMonth"]:  # only meaningful for the month the artifact used
                assert f["value"] == pytest.approx(a["value"], abs=0.01)
                assert f["low"] == pytest.approx(a["low"], abs=0.01) and f["high"] == pytest.approx(a["high"], abs=0.01)
                compared += 1
    if not compared:
        pytest.skip("the stored weather has moved past the artifact's issue month")


def test_inference_never_issues_from_an_older_month(dbcopy):
    conn = connection.connect(dbcopy)
    last = newest_month(conn)
    y, m = int(last[:4]), int(last[5:7])
    conn.execute("UPDATE weather_monthly SET tmean_c = NULL WHERE division = 'sylhet' AND year = ? AND month = ?",
                 (y, m))  # test-only gap in the newest month
    out = inference.run(conn)
    assert out["status"] == "partial"
    assert any(e.startswith("sylhet h1: features incomplete") for e in out["errors"])
    issued = {r[0] for r in conn.execute("SELECT issued_period FROM predictions_v2 WHERE location_id = 'sylhet'")}
    assert issued == set()  # nothing issued for sylhet from an older month
    assert conn.execute("SELECT COUNT(*) FROM predictions_v2 WHERE location_id = 'dhaka'").fetchone()[0] == 3
    conn.close()


def _settings(path: Path):
    from app.settings import get_settings

    return get_settings().model_copy(update={"db_path": path, "data_dir": path.parent, "offline": False,
                                             "backup_dir": path.parent / "backups", "scheduler_enabled": False})


def test_archive_sync_triggers_inference_and_an_inference_error_never_fails_the_sync(dbcopy, monkeypatch):
    def fake_archive(conn, client, settings, now=None):
        return RunStats(ok=1, retrieved=1)

    monkeypatch.setitem(jobs.JOBS, "archive", jobs.Job("archive", "openmeteo_archive", fake_archive,
                                                       lambda s: 3600, 60))
    r = jobs.run_job("archive", settings=_settings(dbcopy), force=True)
    assert r.status == "success"
    conn = connection.connect(dbcopy)
    n = conn.execute("SELECT COUNT(*) FROM predictions_v2").fetchone()[0]
    assert n >= len(mla.HORIZONS)

    def boom(conn, now=None):
        raise RuntimeError("model file unreadable")

    monkeypatch.setattr(inference, "run", boom)
    r2 = jobs.run_job("archive", settings=_settings(dbcopy), force=True)
    assert r2.status == "success"  # the sync itself is unaffected
    assert conn.execute("SELECT COUNT(*) FROM predictions_v2").fetchone()[0] == n
    # other jobs never run inference
    monkeypatch.setitem(jobs.JOBS, "aquastat", jobs.Job("aquastat", "fao_aquastat", fake_archive, lambda s: 3600, 60))
    called = []
    monkeypatch.setattr(inference, "run", lambda conn, now=None: called.append(1) or {})
    jobs.run_job("aquastat", settings=_settings(dbcopy), force=True)
    assert called == []
    conn.close()


def test_api_serves_stored_predictions_first(client, dbcopy, monkeypatch):
    conn = connection.connect(dbcopy)
    inference.run(conn)
    stored = inference.stored(conn)
    conn.close()
    monkeypatch.setattr(mla, "stored_forecasts", lru_cache(lambda: stored))  # keeps cache_clear()
    d = client.get("/api/predictions?region=dhaka&horizon=3").json()
    fc = d["data"]["forecast"]
    assert d["data"]["storage"] == "database" and fc["storage"] == "database"
    assert fc["predictionIds"] == [stored["dhaka"][3]["predictionId"]]
    assert fc["inputSnapshot"]["issuedFrom"] == fc["issuedMonth"]
    assert d["meta"]["retrieved_at"] == fc["generatedAt"]
    nat = client.get("/api/predictions?region=bd").json()["data"]
    assert nat["aggregation"] and nat["forecast"]["inputSnapshot"] is None
    assert len(nat["forecast"]["predictionIds"]) == 8


def test_api_falls_back_to_the_artifact(client, monkeypatch):
    monkeypatch.setattr(mla, "stored_forecasts", lru_cache(lambda: {}))
    d = client.get("/api/predictions?region=dhaka").json()["data"]
    assert d["storage"] == "artifact" and d["forecast"]["storage"] == "artifact"
    assert d["forecast"]["predictionIds"] == [] and d["forecast"]["inputSnapshot"] is None


def test_model_card_and_categories(client):
    d = client.get("/api/predictions?horizon=1").json()["data"]
    card = d["model"]
    for k in ("name", "version", "trainingData", "dataPeriod", "split", "testRmse", "climatologyRmse",
              "intervalCoverage", "macroF1", "experimental"):
        assert card.get(k) is not None, k
    assert card["experimental"] == "no" and "real data" in card["trainingData"]
    cats = {c["id"]: c for c in d["categories"]}
    assert cats["water_balance"]["available"] and not cats["rainfall"]["available"] and cats["rainfall"]["reason"]
    r = client.get("/api/predictions?category=groundwater")
    assert r.status_code == 422 and r.json()["code"] == "unsupported_category"
