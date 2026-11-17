"""P2: source adapters, validation, idempotent storage, locking, scheduling, status and the stored-data read path.

Provider responses are real recorded fixtures (tests/fixtures/README.md) served through httpx.MockTransport; no test
touches the network. Each test uses a small, freshly migrated database (migrations 0001-0008).
"""
from __future__ import annotations

import copy
import csv
import io
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from app.db import connection, migrate
from app.settings import get_settings
from app.sync import aquastat, grace, jobs, openmeteo, scheduler, status
from app.sync.http import HttpClient, HttpError, RetryPolicy
from app.sync.runs import RunStats, acquire_lock, get_state, new_owner, release_lock
from app.sync.validate import OpenMeteoResponse, TimeBlock, in_range

FIX = Path(__file__).parent / "fixtures"
ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 13, 17, 0, tzinfo=timezone.utc)
FORECAST = json.loads((FIX / "openmeteo_forecast_dhaka.json").read_text(encoding="utf-8"))
ARCHIVE = json.loads((FIX / "openmeteo_archive_dhaka.json").read_text(encoding="utf-8"))
AQUASTAT_CSV = (FIX / "aquastat_bgd_subset.csv").read_text(encoding="utf-8")
GRACE_BYTES = (FIX / "grace_csr_bgd_subset.h5").read_bytes()


# ------------------------------------------------------------------ helpers

@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "sync.db"
    migrate.migrate(path, backup=False)
    conn = connection.connect(path)
    conn.execute("INSERT INTO locations (id, name, level, parent_id, lat, lon, point_kind, is_weather_point, "
                 "is_selectable) VALUES ('bd', 'Bangladesh', 'country', NULL, 23.68, 90.35, 'geometry_centroid', 0, 1)")
    conn.execute("INSERT INTO locations (id, name, level, parent_id, lat, lon, point_kind, is_weather_point, "
                 "is_selectable) VALUES ('dhaka', 'Dhaka', 'division', 'bd', 23.8103, 90.4125, "
                 "'representative_point', 1, 1)")
    conn.close()
    (tmp_path / "geo").mkdir()
    (tmp_path / "geo" / "bgd_adm0.geojson").write_bytes((ROOT / "data" / "geo" / "bgd_adm0.geojson").read_bytes())
    return path


def settings_for(db_path: Path, **kw):
    base = {"db_path": db_path, "data_dir": db_path.parent, "backup_dir": db_path.parent / "backups",
            "offline": False, "scheduler_enabled": False, "sync_interval_override_s": None}
    return get_settings().model_copy(update={**base, **kw})


def client_for(handler, calls: list | None = None) -> HttpClient:
    def wrapped(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append((request.method, request.url.host, request.url.path))
        return handler(request)

    return HttpClient(transport=httpx.MockTransport(wrapped), sleep=lambda s: None, rng=lambda: 0.0,
                      policy=RetryPolicy(max_retries=2, backoff_base=0.0, backoff_max=0.0))


def provider(forecast=FORECAST, archive=ARCHIVE, csv_text=AQUASTAT_CSV, grace_bytes=GRACE_BYTES,
             last_modified="Mon, 12 Oct 2026 10:00:00 GMT", etag='"v1"'):
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "api.open-meteo.com":
            return httpx.Response(200, json=forecast)
        if host == "archive-api.open-meteo.com":
            return httpx.Response(200, json=archive)
        if host == "api.data.apps.fao.org":
            return httpx.Response(200, text=csv_text)
        if host == "download.csr.utexas.edu":
            headers = {"Last-Modified": last_modified, "ETag": etag, "Content-Length": str(len(grace_bytes))}
            return httpx.Response(200, headers=headers, content=b"" if request.method == "HEAD" else grace_bytes)
        return httpx.Response(404)

    return handler


def count(path: Path, sql: str, params=()) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def valid_values(block: dict, variables: list[str]) -> int:
    return sum(in_range(v, x) for v in variables for x in block[v])


# ------------------------------------------------------------------ validation

def test_range_validation_rejects_missing_out_of_range_and_unknown():
    assert in_range("temperature_2m", 23.8) and in_range("soil_moisture_3_to_9cm", 0.42)
    assert not in_range("temperature_2m", None)
    assert not in_range("temperature_2m", float("nan"))
    assert not in_range("relative_humidity_2m", 101)
    assert not in_range("precipitation_sum", -0.1)
    assert not in_range("soil_moisture_0_to_7cm_mean", 1.5)
    assert not in_range("cloud_cover", 50)  # unknown variables are never stored
    assert not in_range("temperature_2m", True)


def test_time_block_rejects_misaligned_arrays():
    with pytest.raises(ValueError):
        TimeBlock(time=["2026-11-13", "2026-11-14"], precipitation_sum=[1.0])
    with pytest.raises(ValueError):
        OpenMeteoResponse.model_validate({**FORECAST, "latitude": 123.0})


# ------------------------------------------------------------------ Open-Meteo

def test_parse_forecast_labels_current_hourly_and_daily():
    stats = RunStats()
    rows = openmeteo.parse_forecast("dhaka", FORECAST, "2026-11-13T17:00:00Z", stats)
    kinds = {(r[2], r[3]) for r in rows}
    assert kinds == {("model_current", "current"), ("forecast", "hourly"), ("forecast", "daily")}
    expected = (sum(in_range(v, FORECAST["current"][v]) for v in openmeteo.CURRENT_VARS)
                + valid_values(FORECAST["hourly"], openmeteo.HOURLY_VARS)
                + valid_values(FORECAST["daily"], openmeteo.DAILY_FORECAST_VARS))
    assert len(rows) == expected
    temp = next(r for r in rows if r[1] == "temperature_2m" and r[3] == "current")
    assert temp[4] == FORECAST["current"]["time"] and temp[5] == FORECAST["current"]["temperature_2m"]
    assert temp[6] == FORECAST["current_units"]["temperature_2m"]  # provider unit kept


def test_forecast_sync_is_idempotent_and_newest_run_replaces(db):
    s = settings_for(db)
    conn = connection.connect(db)
    first = openmeteo.sync_forecast(conn, client_for(provider()), s, now=NOW)
    assert first.errors == [] and first.ok == 1 and first.inserted == len(
        openmeteo.parse_forecast("dhaka", FORECAST, "x", RunStats()))
    n = count(db, "SELECT COUNT(*) FROM weather_values")
    assert n == first.inserted

    again = openmeteo.sync_forecast(conn, client_for(provider()), s, now=NOW + timedelta(hours=1))
    assert (again.inserted, again.updated) == (0, 0)  # identical run: no duplicates, no rewrites
    assert count(db, "SELECT COUNT(*) FROM weather_values") == n

    newer = copy.deepcopy(FORECAST)
    day = newer["daily"]["time"][3]
    newer["daily"]["precipitation_sum"][3] = 12.3          # provider revised this value
    newer["daily"]["temperature_2m_max"][4] = None         # provider dropped this one
    old_tmax = count(db, "SELECT value FROM weather_values WHERE variable='temperature_2m_max' AND valid_time=?",
                     (newer["daily"]["time"][4],))
    third = openmeteo.sync_forecast(conn, client_for(provider(forecast=newer)), s, now=NOW + timedelta(hours=2))
    conn.close()
    assert third.updated == 1 and third.inserted == 0
    assert count(db, "SELECT value FROM weather_values WHERE variable='precipitation_sum' AND time_step='daily' "
                     "AND valid_time=?", (day,)) == 12.3
    assert count(db, "SELECT value FROM weather_values WHERE variable='temperature_2m_max' AND valid_time=?",
                 (newer["daily"]["time"][4],)) == old_tmax  # NULL never overwrites
    assert count(db, "SELECT COUNT(*) FROM weather_values") == n


def test_archive_sync_updates_legacy_daily_without_overwriting_with_null(db):
    s = settings_for(db)
    conn = connection.connect(db)
    stats = openmeteo.sync_archive(conn, client_for(provider()), s, now=NOW)
    days = len(ARCHIVE["daily"]["time"])
    assert stats.errors == [] and stats.ok == 1
    assert count(db, "SELECT COUNT(*) FROM weather_daily WHERE division='dhaka'") == days
    assert count(db, "SELECT COUNT(*) FROM weather_values WHERE data_kind='reanalysis'") == stats.inserted
    first_day = ARCHIVE["daily"]["time"][0]
    rain = ARCHIVE["daily"]["precipitation_sum"][0]

    gap = copy.deepcopy(ARCHIVE)
    gap["daily"]["precipitation_sum"][0] = None
    again = openmeteo.sync_archive(conn, client_for(provider(archive=gap)), s, now=NOW + timedelta(days=1))
    conn.close()
    assert again.inserted == 0
    assert count(db, "SELECT precip_mm FROM weather_daily WHERE division='dhaka' AND date=?", (first_day,)) == rain
    # 14 days never complete a calendar month here, so no monthly aggregate may appear
    assert count(db, "SELECT COUNT(*) FROM weather_monthly") == 0


def test_monthly_recompute_stores_complete_months_only(db):
    conn = connection.connect(db)
    for d in range(1, 31):  # November 2025: 30 days stored, so the month is complete
        conn.execute("INSERT INTO weather_daily (division, date, precip_mm, et0_mm, tmean_c, source_id, retrieved_at, "
                     "provenance, is_sample) VALUES ('dhaka', ?, 1.0, 3.0, 25.0, 'openmeteo_archive', 'x', 'historical', 0)",
                     (f"2025-11-{d:02d}",))
    for d in range(1, 10):  # December 2025: incomplete
        conn.execute("INSERT INTO weather_daily (division, date, precip_mm, et0_mm, source_id, retrieved_at, provenance, "
                     "is_sample) VALUES ('dhaka', ?, 1.0, 3.0, 'openmeteo_archive', 'x', 'historical', 0)",
                     (f"2025-12-{d:02d}",))
    openmeteo.recompute_monthly(conn, {("dhaka", 2025, 11), ("dhaka", 2025, 12)}, "2026-11-13T17:00:00Z")
    rows = conn.execute("SELECT year, month, precip_mm, et0_mm, d_mm, n_days FROM weather_monthly").fetchall()
    conn.close()
    assert rows == [(2025, 11, 30.0, 90.0, -60.0, 30)]


def test_failed_location_keeps_other_data_and_reports_error(db):
    s = settings_for(db)
    conn = connection.connect(db)
    openmeteo.sync_forecast(conn, client_for(provider()), s, now=NOW)
    n = count(db, "SELECT COUNT(*) FROM weather_values")
    stats = openmeteo.sync_forecast(conn, client_for(lambda r: httpx.Response(503)), s, now=NOW + timedelta(hours=1))
    conn.close()
    assert stats.ok == 0 and stats.outcome() == "failed" and "dhaka" in stats.errors[0]
    assert count(db, "SELECT COUNT(*) FROM weather_values") == n  # nothing deleted


# ------------------------------------------------------------------ AQUASTAT

def test_aquastat_variables_match_bootstrap_importer():
    sys.path.insert(0, str(ROOT / "ml"))
    try:
        from fetch_static import AQUASTAT_VARS
    finally:
        sys.path.remove(str(ROOT / "ml"))
    assert aquastat.VARIABLES == AQUASTAT_VARS


def test_aquastat_stores_reference_years_only_and_tracks_revisions(db):
    s = settings_for(db)
    rows = aquastat.parse_csv(AQUASTAT_CSV, RunStats())
    genuine = [r for r in rows if r["symbol"] != "I"]
    conn = connection.connect(db)
    first = aquastat.sync_aquastat(conn, client_for(provider()), s, now=NOW)
    assert first.errors == [] and first.inserted == len(genuine)
    assert count(db, "SELECT COUNT(*) FROM water_statistics WHERE symbol = 'I'") == 0  # imputed never stored
    assert count(db, "SELECT COUNT(*) FROM water_statistics WHERE imputed = 0") == len(genuine)

    again = aquastat.sync_aquastat(conn, client_for(provider()), s, now=NOW + timedelta(days=7))
    assert (again.inserted, again.updated) == (0, 0)

    sdg = next(r for r in genuine if r["code"] == 4550)
    table = list(csv.reader(io.StringIO(AQUASTAT_CSV)))
    vi, yi, ci = (table[0].index(c) for c in ("Value", "Year", "VariableCode"))
    for row in table[1:]:
        if row[ci] == "4550" and int(row[yi]) == sdg["year"]:
            row[vi] = f"{sdg['value'] + 0.5:.9f}"  # the provider revises one published value
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(table)
    third = aquastat.sync_aquastat(conn, client_for(provider(csv_text=buf.getvalue())), s,
                                   now=NOW + timedelta(days=14))
    conn.close()
    assert third.updated == 1 and third.inserted == 0
    hist = sqlite3.connect(db).execute(
        "SELECT value, superseded_at IS NOT NULL FROM water_statistics WHERE indicator_code='4550' AND reference_year=? "
        "ORDER BY id", (sdg["year"],)).fetchall()
    assert hist == [(sdg["value"], 1), (pytest.approx(sdg["value"] + 0.5), 0)]  # old value kept, marked superseded


def test_aquastat_legacy_row_keeps_reference_year(db):
    s = settings_for(db)
    conn = connection.connect(db)
    aquastat.sync_aquastat(conn, client_for(provider()), s, now=NOW)
    conn.close()
    rows = aquastat.parse_csv(AQUASTAT_CSV, RunStats())
    w = [r for r in rows if r["code"] == 4253]
    latest = max(w, key=lambda r: r["year"])
    ref = max(r["year"] for r in w if r["symbol"] != "I")
    got = sqlite3.connect(db).execute(
        "SELECT value, year, reference_year, symbol FROM water_resources WHERE key='withdrawal_total_km3'").fetchone()
    assert got == (latest["value"], latest["year"], ref, latest["symbol"])
    assert ref == 2008  # AQUASTAT withdrawals: only 2008 is a genuine reference year


def test_aquastat_rejects_unexpected_format(db):
    s = settings_for(db)
    conn = connection.connect(db)
    stats = aquastat.sync_aquastat(conn, client_for(provider(csv_text="a,b\n1,2\n")), s, now=NOW)
    conn.close()
    assert stats.ok == 0 and "missing columns" in stats.errors[0]
    assert count(db, "SELECT COUNT(*) FROM water_statistics") == 0


# ------------------------------------------------------------------ GRACE

def test_grace_extract_reads_verified_metadata():
    data = grace.extract(FIX / "grace_csr_bgd_subset.h5", ROOT / "data" / "geo" / "bgd_adm0.geojson")
    assert data["release"] == "CSR RL06.3"
    assert data["baseline"] == "2004.000-2009.999 time mean removed"
    assert data["n_cells"] == 206  # same cell selection as the stored national series
    assert [(y, m) for y, m, _v, _n in data["national"]] == [(2002, 4), (2002, 5), (2002, 8), (2026, 7), (2026, 8),
                                                             (2026, 9)]
    assert len(data["cells"]) == 206 * 6


def test_grace_sync_downloads_only_when_the_file_changes(db):
    s = settings_for(db)
    conn = connection.connect(db)
    calls: list = []
    first = grace.sync_grace(conn, client_for(provider(), calls), s, now=NOW)
    assert first.errors == [] and first.inserted == 6 + 206 * 6
    assert [c[0] for c in calls] == ["HEAD", "GET"]
    assert get_state(conn, "grace_csr", "last_modified") == "Mon, 12 Oct 2026 10:00:00 GMT"
    assert count(db, "SELECT COUNT(*) FROM water_storage WHERE uncertainty_cm IS NOT NULL") == 0  # never invented
    assert count(db, "SELECT COUNT(*) FROM storage_anomaly") == 6
    assert not list((db.parent / "raw" / "grace").glob("*.nc"))  # temporary download removed

    calls.clear()
    same = grace.sync_grace(conn, client_for(provider(), calls), s, now=NOW + timedelta(days=1))
    assert [c[0] for c in calls] == ["HEAD"] and same.ok == 1 and same.inserted == 0

    calls.clear()
    changed = grace.sync_grace(conn, client_for(provider(last_modified="Tue, 10 Nov 2026 10:00:00 GMT", etag='"v2"'),
                                                calls), s, now=NOW + timedelta(days=2))
    conn.close()
    assert [c[0] for c in calls] == ["HEAD", "GET"]
    assert (changed.inserted, changed.updated) == (0, 0)  # same values: no duplicates
    assert count(db, "SELECT COUNT(*) FROM water_storage") == 6 + 206 * 6


def test_grace_rejects_wrong_units_and_keeps_existing_data(db, tmp_path):
    import h5py

    s = settings_for(db)
    conn = connection.connect(db)
    grace.sync_grace(conn, client_for(provider()), s, now=NOW)
    bad = tmp_path / "bad.h5"
    bad.write_bytes(GRACE_BYTES)
    with h5py.File(bad, "r+") as f:
        f["lwe_thickness"].attrs["Units"] = "mm"
    stats = grace.sync_grace(conn, client_for(provider(grace_bytes=bad.read_bytes(), etag='"v3"')), s,
                             now=NOW + timedelta(days=1))
    conn.close()
    assert stats.ok == 0 and "units" in stats.errors[0]
    assert count(db, "SELECT COUNT(*) FROM water_storage") == 6 + 206 * 6


def test_download_limit_and_partial_file_cleanup(tmp_path):
    client = client_for(lambda r: httpx.Response(200, content=b"x" * 2048))
    dest = tmp_path / "f.bin"
    with pytest.raises(HttpError):
        client.download("https://example.org/f", dest, max_bytes=1024)
    assert not dest.exists()
    assert client.download("https://example.org/f", dest, max_bytes=4096) == 2048


# ------------------------------------------------------------------ jobs, locking, failure and recovery

def test_job_records_runs_and_skips_within_min_interval(db):
    s = settings_for(db)
    r1 = jobs.run_job("forecast", settings=s, client=client_for(provider()), now=NOW)
    assert r1.status == "success" and r1.stats.inserted > 0
    r2 = jobs.run_job("forecast", settings=s, client=client_for(provider()), now=NOW + timedelta(minutes=10))
    assert r2.status == "skipped"
    r3 = jobs.run_job("forecast", settings=s, client=client_for(provider()), now=NOW + timedelta(minutes=10),
                      force=True)
    assert r3.status == "success" and (r3.stats.inserted, r3.stats.updated) == (0, 0)
    runs = sqlite3.connect(db).execute("SELECT job, status, inserted FROM sync_runs ORDER BY id").fetchall()
    assert runs == [("forecast", "success", r1.stats.inserted), ("forecast", "success", 0)]
    assert count(db, "SELECT retrieved_at FROM sources WHERE id='openmeteo_forecast'") == "2026-11-13T17:10:00Z"


def test_job_lease_blocks_a_second_worker_and_expires(db):
    s = settings_for(db)
    conn = connection.connect(db)
    other = new_owner()
    assert acquire_lock(conn, "job:forecast", other, ttl_s=600, now=NOW)
    r = jobs.run_job("forecast", settings=s, client=client_for(provider()), now=NOW + timedelta(minutes=1))
    assert r.status == "locked"
    r = jobs.run_job("forecast", settings=s, client=client_for(provider()), now=NOW + timedelta(minutes=11))
    assert r.status == "success"  # crashed holder's lease expired and was taken over
    assert acquire_lock(conn, "job:forecast", other, ttl_s=600, now=NOW + timedelta(minutes=12))
    release_lock(conn, "job:forecast", other, now=NOW + timedelta(minutes=12))
    conn.close()


def test_failure_keeps_data_then_recovery(db):
    s = settings_for(db)
    ok = jobs.run_job("aquastat", settings=s, client=client_for(provider()), now=NOW)
    n = count(db, "SELECT COUNT(*) FROM water_statistics")
    broken = jobs.run_job("aquastat", settings=s, client=client_for(lambda r: httpx.Response(500)),
                          now=NOW + timedelta(days=8))
    assert ok.status == "success" and broken.status == "failed"
    assert count(db, "SELECT COUNT(*) FROM water_statistics") == n
    err = sqlite3.connect(db).execute("SELECT error_summary FROM sync_runs WHERE status='failed'").fetchone()[0]
    assert "HTTP 500" in err and "api.data.apps.fao.org" in err
    fixed = jobs.run_job("aquastat", settings=s, client=client_for(provider()), now=NOW + timedelta(days=8, hours=1))
    assert fixed.status == "success" and (fixed.stats.inserted, fixed.stats.updated) == (0, 0)


def test_unexpected_exception_is_recorded_not_raised(db, monkeypatch):
    s = settings_for(db)

    def boom(conn, client, settings, now=None):
        conn.execute("BEGIN IMMEDIATE")
        raise RuntimeError("disk full")

    monkeypatch.setitem(jobs.JOBS, "aquastat", jobs.Job("aquastat", "fao_aquastat", boom, lambda x: 60, 60))
    r = jobs.run_job("aquastat", settings=s, client=client_for(provider()), now=NOW)
    assert r.status == "failed" and "disk full" in r.stats.errors[0]
    assert count(db, "SELECT status FROM sync_runs") == "failed"


def test_offline_mode_never_calls_out(db):
    calls: list = []
    r = jobs.run_job("forecast", settings=settings_for(db, offline=True), client=client_for(provider(), calls))
    assert r.status == "skipped" and calls == []


def test_secrets_never_reach_sync_runs(db):
    from pydantic import SecretStr

    s = settings_for(db, openmeteo_api_key=SecretStr("sk-test-secret-123"))
    seen: list = []

    def handler(request):
        seen.append(request.url.params.get("apikey"))
        return httpx.Response(500)

    r = jobs.run_job("forecast", settings=s, client=client_for(handler), now=NOW)
    assert r.status == "failed" and seen and seen[0] == "sk-test-secret-123"
    err = sqlite3.connect(db).execute("SELECT error_summary FROM sync_runs").fetchone()[0]
    assert "sk-test-secret-123" not in err and "HTTP 500 from GET https://api.open-meteo.com/v1/forecast" in err


# ------------------------------------------------------------------ status

def _status(db, source_id, now, **kw):
    conn = connection.connect(db, read_only=True)
    try:
        return next(x for x in status.all_statuses(conn, settings_for(db, **kw), now) if x["source_id"] == source_id)
    finally:
        conn.close()


def test_status_unavailable_fresh_stale_and_not_configured(db):
    assert _status(db, "fao_aquastat", NOW)["status"] == "unavailable"
    jobs.run_job("aquastat", settings=settings_for(db), client=client_for(provider()), now=NOW)
    st = _status(db, "fao_aquastat", NOW + timedelta(days=1))
    newest = max(r["year"] for r in aquastat.parse_csv(AQUASTAT_CSV, RunStats()) if r["symbol"] != "I")
    assert st["status"] == "fresh" and st["latest_observation"] == newest and st["last_success_at"]
    assert _status(db, "fao_aquastat", NOW + timedelta(days=15))["status"] == "stale"  # > 2 x 7 days
    jobs.run_job("aquastat", settings=settings_for(db), client=client_for(lambda r: httpx.Response(500)),
                 now=NOW + timedelta(days=8))
    st = _status(db, "fao_aquastat", NOW + timedelta(days=9))
    assert st["status"] == "fresh" and st["last_attempt_status"] == "failed" and "HTTP 500" in st["last_error"]
    assert _status(db, "grace_jpl", NOW)["status"] == "not_configured"
    assert _status(db, "bwdb_import", NOW)["status"] == "not_configured"


def test_bootstrap_data_without_sync_is_stale(db):
    conn = connection.connect(db)
    conn.execute("INSERT INTO weather_daily (division, date, precip_mm, source_id, retrieved_at, provenance, is_sample) "
                 "VALUES ('dhaka', '2026-11-01', 0.0, 'openmeteo_archive', '2026-11-12T16:34:26+00:00', 'historical', 0)")
    conn.close()
    st = _status(db, "openmeteo_archive", NOW)
    assert st["status"] == "stale" and st["latest_observation"] == "2026-11-01"


# ------------------------------------------------------------------ scheduler

def test_scheduler_configuration(db):
    s = settings_for(db)
    sched = scheduler.build_scheduler(s, runner=lambda *a, **k: None, start_at=NOW)
    got = {j.id: j for j in sched.get_jobs()}
    assert set(got) == {"sync:forecast", "sync:archive", "sync:aquastat", "sync:grace"}
    assert got["sync:forecast"].trigger.interval == timedelta(minutes=60)
    assert got["sync:archive"].trigger.interval == timedelta(hours=24)
    assert got["sync:aquastat"].trigger.interval == timedelta(days=7)
    assert got["sync:grace"].trigger.interval == timedelta(hours=24)
    assert sched._job_defaults["max_instances"] == 1 and sched._job_defaults["coalesce"] is True
    fast = scheduler.build_scheduler(settings_for(db, sync_interval_override_s=60), runner=lambda *a, **k: None)
    assert {j.trigger.interval for j in fast.get_jobs()} == {timedelta(seconds=60)}


def test_scheduler_not_started_when_disabled_or_offline(db):
    assert scheduler.start(settings_for(db, scheduler_enabled=False)) is None
    assert scheduler.start(settings_for(db, scheduler_enabled=True, offline=True)) is None


# ------------------------------------------------------------------ read path (no sample fallback)

def test_no_sample_fallback_and_stored_forecast(db, monkeypatch):
    from app.services import data_access as da

    s = get_settings()
    monkeypatch.setattr(s, "db_path", db.parent / "missing.db")
    da.clear_cache()
    try:
        t = da.table("weather_monthly")
        assert t.df.empty and t.is_sample is False and da.sample_tables() == []
        assert da.stored_forecast(23.8, 90.4).mode == "unavailable"

        monkeypatch.setattr(s, "db_path", db)
        da.clear_cache()
        jobs.run_job("forecast", settings=settings_for(db), client=client_for(provider()))
        fc = da.stored_forecast(23.9, 90.3)
        assert fc.mode == "stored" and fc.point_id == "dhaka" and not fc.is_sample
        assert len(fc.daily) >= 1 and set(fc.daily["kind"]) <= {"past", "forecast"}
        assert fc.retrieved_at is not None
    finally:
        monkeypatch.undo()
        da.clear_cache()


def test_seed_does_nothing_for_an_existing_database(db):
    from app.db import seed

    assert seed.bootstrap_if_missing(settings_for(db)) is None
