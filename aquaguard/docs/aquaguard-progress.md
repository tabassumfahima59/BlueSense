# AquaGuard — Progress Log

Updated after every verified phase or module. A task is **done** only when a check was run and passed.

## Current phase: P2 Sources + scheduler — implemented and verified, awaiting review (P3 not started)

| Phase | Task | Status | Evidence (2026-11-13) |
|---|---|---|---|
| P2 | Security upgrades (approved) | done | next + eslint-config-next 15.5.28, vitest 4.1.12, postcss override 8.5.32, sharp 0.35.5 → `npm audit`: 0 critical, 0 high, 6 moderate dev-only (P1: 12 advisories incl. critical); vitest 8 passed, tsc OK, eslint 0 problems, `next build` OK (14 routes) |
| P2 | Verified backup before DB changes | done | `data/backups/aquaguard-pre-p2-20261113T171221768770Z.db` (integrity ok, row counts verified by `backup_database`) |
| P2 | Migration 0008 `sync_state` | done | applied to the real DB; fresh-DB, existing-copy, concurrency and FK tests pass (`test_migrations.py` 19) |
| P2 | Open-Meteo adapters | done | live forecast: 8/8 points, 22,296 rows (current 32, hourly 21,368, daily 896), 136 null/out-of-range values skipped; live archive: 8/8 points, 336 new daily values, `weather_daily` now to 2026-11-12 for all divisions |
| P2 | AQUASTAT adapter | done | live: 399 genuine reference-year rows inserted, 307 imputed/unchanged skipped; SDG 6.4.2 = 5.723339482 % (symbol E, 2021–2023); total withdrawal genuine year 2008 only |
| P2 | GRACE CSR adapter | done | live: HEAD → 110 MB streamed download (Last-Modified 2026-11-09, ETag stored) → 206 cells × 259 months = 53,354 grid rows; national series re-derived (16 values differ by ≤ 0.0001 cm rounding); temp file deleted; uncertainty NULL |
| P2 | Scheduler | done | API with `SYNC_INTERVAL_OVERRIDE_S=60` for ~4 min: 15 new `sync_runs`, all success; re-runs inserted 0 / updated 0; GRACE re-checks were HEAD-only; first GRACE tick skipped by the min-interval rule (CLI run 48 s earlier) |
| P2 | Failure and recovery | done | forecast URL → `http://127.0.0.1:9`: each point retried twice (jittered backoff), run `failed`, 22,296 rows kept, status `stale` with error summary (1-min cadence, factor 1); default URL restored → `success`, 0 duplicates, status `fresh` |
| P2 | Status | done | all 13 sources: scheduled four `fresh`; `grace_jpl`, `bwdb_import` `not_configured`; static references `fresh` with note |
| P2 | Bootstrap seed | done | API started against a missing DB: built from `data/processed` in 4.1 s, schema 0001–0008, health `ok`, overview 200; archive/AQUASTAT/GRACE `stale` (original dates 2026-11-05 / 2023 / 2026-09), forecast `unavailable` |
| P2 | Backend sample fallback removed | done | `data_access` reads the DB only; `force_sample` removed; point forecast falls back to the stored forecast (`mode = "stored"`); test `test_missing_database_has_no_sample_fallback` |
| P2 | Security review of the sync path | done | httpx/httpcore URL logging capped at WARNING (an API key in a query string would otherwise be logged); stored error summaries carry status + `scheme://host:port/path` only; tests `test_secrets_never_reach_sync_runs`, `test_library_request_logs_never_contain_query_secrets` |
| P2 | Row counts never decrease | done | every table ≥ its pre-P2 count (see "Database after P2"); integrity ok; FK check clean |
| P2 | Regression | done | backend **221 passed** (new: `test_sync.py` 27, HTTP +1); ruff OK; vitest 8; tsc OK; eslint OK; `next build` OK; OSV 54 packages: only `pip` 26.1.2 (installer tool, not an app dependency) |

## P1 Foundation — verified

| Phase | Task | Status | Evidence (2026-11-13) |
|---|---|---|---|
| P1 | Repository audit | done | see "P1 audit" |
| P1 | Baseline tests | done | pytest 128 passed; vitest 8 passed; tsc OK; eslint OK (run on a DB copy) |
| P1 | Database backup | done | `data/backups/aquaguard-pre-p1-20261113T160144Z.db` — integrity ok; schema hash and all 13 row counts identical to source |
| P1 | Documentation | done | `docs/aquaguard-plan.md`, this file |
| P1 | Migration runner | done | `backend/app/db/migrate.py`; tests in `test_migrations.py` (19 passed) |
| P1 | Migrations 0001–0007 | done | fresh DB: 7 applied; existing copy: 7 applied, legacy schema/rows identical; re-run applies 0 |
| P1 | Real development DB migrated | done | automatic backup `aquaguard-pre-migration-20261113T161804688479Z.db`; 13 legacy tables: counts, definitions and SHA-256 of all rows identical; integrity ok; FK check clean |
| P1 | SQLite configuration | done | WAL, foreign_keys=1, busy_timeout=5000 (`test_db_config.py`, 11 passed) |
| P1 | Settings + `.env.example` | done | `backend/app/settings.py` (SecretStr), `.env.example` (secrets empty; tested) |
| P1 | HTTP client | done | `backend/app/sync/http.py`; `test_http_client.py` 16 passed |
| P1 | ADMIN_TOKEN protection | done | `backend/app/security.py`; `test_security.py` 15 passed (test-only route; real admin endpoints arrive in P3) |
| P1 | Dependencies + security review | done | see "Dependencies" |
| P1 | Copilot SDK preparation | done | `anthropic==2.8.0` runtime pin; `ANTHROPIC_API_KEY` (legacy `LLM_API_KEY`) read server-side as SecretStr |
| P1 | Bootstrap importer | done | `ml/build_db.py` idempotent; `test_bootstrap_importer.py` 4 passed (fresh + existing copy; re-run changes 0 rows; file never replaced) |
| P1 | Regression | done | full backend suite **193 passed**; vitest 8 passed; tsc OK; eslint OK; `next build` OK; ruff OK |

## P1 audit (2026-11-13)

* Branch `develop` @ `4637cc5`; only pre-existing uncommitted change: root `README.md` line endings (no content diff).
* Runtimes: Python 3.14.6, SQLite 3.50.4, Node 24.22.0, npm 11.19.1. Single uvicorn worker.
* DB before P1: `data/aquaguard.db` 18,026,496 bytes, journal mode `delete`, no migration history. Row counts:
  alerts_log 0 · climatology 96 · inflow_shape 12 · population_projection 51 · predictions 0 · regions 73 ·
  scenarios 27 · sources 8 · station_observations 0 · storage_anomaly 259 · water_resources 25 ·
  weather_daily 104,744 · weather_monthly 3,440.
* Env files: `.env.example` (tracked, no secrets), `frontend/.env.local` (untracked, API URL only). No secrets in git
  history.
* GRACE: CSR RL06.3, baseline 2004.000–2009.999, 0.25° grid / 1° mascons / ~300 km native (file attributes).

## Database after P1 (real development DB)

* Size 101,146,624 bytes (was 18 MB): `weather_values` holds 628,464 long-format rows (6 variables × 104,744 days),
  stored `WITHOUT ROWID` with the natural key as clustered primary key (an earlier design with separate indexes
  measured 198 MB and was replaced before use).
* New tables: locations 73 · data_sources 13 · weather_values 628,464 · water_statistics 25 · water_storage 259 ·
  predictions_v2 0 · alerts 0 · alert_reads 0 · sync_runs 0 · scheduler_lock 0 · schema_migrations 7.
* The bootstrap importer (not yet run on the real DB) additionally loads 399 genuine AQUASTAT reference-year rows
  from the raw CSV and the 24 legacy forecast rows from `ml/artifacts/predictions.json` (verified on copies).

## Database after P2 (real development DB)

* Size 132,374,528 bytes. Row counts before → after: weather_values 628,464 → 651,096 · weather_daily 104,744 →
  104,800 · weather_monthly 3,440 → 3,440 · water_statistics 25 → 424 · water_storage 259 → 53,613 ·
  storage_anomaly 259 → 259 · water_resources 25 → 25 · sync_runs 0 → 21 · sync_state — → 2 · scheduler_lock 0 → 4 ·
  schema_migrations 7 → 8; all other tables unchanged.
* `water_statistics` keeps the 21 P1 bootstrap rows flagged `imputed = 1` (with `last_non_imputed_year`); the P2
  adapter never stores imputed (`I`) rows.

## Dependencies

| Package | Version | Released | Check |
|---|---|---|---|
| APScheduler (+ tzlocal 5.4.5, tzdata 2026.6) | 3.11.3 | 2026-06-28 | pip check clean; OSV clean |
| httpx | 0.28.1 | 2024-12 | OSV clean (moved from dev to runtime) |
| h5py | 3.16.0 | 2026-03-06 | OSV clean; reads the CSR NetCDF (verified) |
| anthropic | 2.8.0 | 2026-11-10 | OSV clean; **exception** to the two-week rule (already pinned and in use) |
| @playwright/test / playwright-core | 1.64.1 | 2026-10-14 | 1.65.0 skipped (< 2 weeks); core aligned; `npx playwright --version` OK |
| @axe-core/playwright (axe-core 4.14.0) | 4.14.0 | 2026-10-15 | loads (`AxeBuilder`) |

* P1: OSV batch query, 53 installed Python packages, 0 known vulnerabilities. P2 re-check (54 packages incl. the
  installer): only `pip` 26.1.2 (GHSA-qwm4-qh6w-59xr, fixed in 26.2.0) — local tooling, not pinned or deployed.
* P1 `npm audit`: 12 pre-existing advisories. P2 (approved upgrades): next/eslint-config-next 15.5.28 (15.5.29 skipped,
  < 2 weeks old; every Next.js advisory's affected range ends at 15.5.27), vitest 4.1.12 (fixes the vitest and tinypool
  criticals; 3.2.7 would keep tinypool 1.x), `overrides: {next: {postcss: 8.5.32}}` (Next pins 8.4.31, affected
  ≤ 8.5.22), sharp 0.35.5 → **0 critical, 0 high**. Remaining: 6 moderate entries from one dev-only chain
  (minimatch < 11.0.1 via typescript-eslint 8.72.2; the fix exists only in 8.72.3 alphas). `npm audit fix` tried to
  "fix" it by downgrading typescript-eslint to 6.15.0, which crashes ESLint 9 — reverted.
* vitest 4 on Windows fails every suite when started from a lower-case drive path (`c:\…`); `npm test` now runs
  `scripts/vitest.mjs`, which upper-cases the drive letter (no effect on other platforms).

## Remaining issues / open items

* D9 (GRACE per calendar month, not exact solution bounds) needs confirmation.
* Docker image not built locally (no Docker on this machine); the Dockerfile no longer copies `data/sample`.
* Frontend mock mode (`NEXT_PUBLIC_API_MODE=mock`, `frontend/public/mocks`) remains until P4; `data/sample/` is no
  longer read by the API and stays on disk untouched; `make mocks` now exports only the OpenAPI spec.
* The UI "stale" banner and the status/refresh endpoints are P3/P4; P2 provides `app.sync.status` and the CLI.
* The scheduler is off by default (`AQUAGUARD_SCHEDULER_ENABLED=0`); enable it on the host.
* Admin endpoints themselves are P3; P1 delivers and tests the `require_admin` dependency.
* Each importer run into a non-empty DB writes a ~100 MB backup to `data/backups/` (git-ignored); prune manually.

## Data limitations (running list)

* AQUASTAT withdrawals: 2008 only; no year comparison possible.
* GRACE: no uncertainty variable in the CSR all-corrections file; `uncertainty_cm` stays NULL.
* FAO-56 advisor treats missing daily rainfall as 0 mm — to be fixed in M2.
* GRACE series use calendar-month periods (`period_basis = calendar_month`) for both national and grid-cell rows (D9).
* Open-Meteo `valid_time` is Asia/Dhaka local time (UTC+06:00), stored without an offset (documented convention).
