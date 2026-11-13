# AquaGuard — Implementation Plan (Main Rebuild)

Status: **P2 Sources + scheduler implemented and verified — awaiting review before P3.** Evidence:
`aquaguard-progress.md`.
This plan implements the approved *Final Implementation Scope* and *Final Master Implementation Prompt*. It is an
evolution of the existing repository, not a rebuild: working features, routes, tables and records are preserved.

---

## 1. Project overview

**AquaGuard — AI-Powered Water Intelligence, Prediction & Resource Optimization Platform** for Bangladesh (national
view plus 8 divisions). It turns weather, hydrological, agricultural, satellite and geographic data into water
decision support. It does **not** replace field monitoring, laboratory testing, government infrastructure or
measurements.

### The eight modules (all already implemented; preserved and improved)

| # | Module | Route | Current core |
|---|---|---|---|
| 1 | Command Center | `/command-center` | KPIs, risk map, alerts, regional table, CSV export |
| 2 | 3D Water Explorer | `/explorer` | MapLibre 3D terrain, layers, region panel |
| 3 | AI Water Prediction Lab | `/prediction-lab` | P − ET0 forecasts (1/3/6 mo), metrics vs baselines, SHAP, GRACE trend |
| 4 | 3D Water Flow Visualization | `/water-flow` | R3F network, Hazen–Williams + leakage, pressure optimisation (conceptual) |
| 5 | Water Budget Sankey | `/water-budget` | D3 Sankey, balance check, LP optimiser |
| 6 | What-if Scenario Simulator | `/what-if` | Six levers, baseline vs scenario |
| 7 | Smart Irrigation Advisor | `/irrigation` | FAO-56 with Open-Meteo forecast |
| 8 | AquaGuard AI Copilot | `/copilot` + panel | Anthropic SDK (to be reworked to tool calling, no fallback) |

## 2. Architecture

Modular monolith (no microservices):

```
Open-Meteo / AQUASTAT / GRACE CSR  ──►  backend/app/sync/* adapters (P2)  ──►  SQLite (WAL)
                                                                                 │  versioned SQL migrations
FastAPI (backend/app): routers ─► services ─► engines (water_balance, fao56, flow_sim, optimizer, risk)
                                     └─► ML artifacts / predictions_v2 (P2/M5)
Next.js (frontend): lib/api (typed client) ─► Zustand + URL state ─► Plotly · D3 · MapLibre · R3F
```

| Layer | Technology (pinned in requirements / package.json) |
|---|---|
| Frontend | Next.js 15.5.4, React 19.1, TypeScript, Tailwind CSS 4, Zustand 5, lucide-react |
| Visualisation | Plotly 4.3 (react-plotly.js), d3 7.9 + d3-sankey, MapLibre GL 6.18, three 0.187 + R3F 9.8 + drei 10.7 |
| Backend | Python 3.14, FastAPI 0.162.5, Pydantic 2.14.3, uvicorn 0.54.0 |
| Data | SQLite 3.50 (WAL), raw `sqlite3` + pandas, custom versioned SQL migrations |
| AI/ML | pandas, NumPy, scikit-learn 1.9.1, XGBoost 3.4.1, SHAP 0.54.1 (offline), joblib |
| HTTP | httpx 0.28.1 (`backend/app/sync/http.py`) |
| Scheduling | APScheduler 3.11.3 (P2) |
| Copilot | Anthropic Python SDK 2.8.0 (M8) |
| Tests | pytest, vitest, Playwright 1.64.1, axe-core 4.14 (`@axe-core/playwright`) |

## 3. Data sources

| Source | Provides | Spatial level | Time step and lag | data_kind | Status |
|---|---|---|---|---|---|
| Open-Meteo Forecast | current, hourly, daily weather; ET0 | 8 division representative points | model runs every 1–6 h | `model_current`, `forecast` | synced hourly (P2) |
| Open-Meteo Archive (ERA5/ERA5-Land) | daily history 1991-01-01 → (D3) | same points | daily, lags several days | `reanalysis` | in DB; daily top-up of the last 14 days (P2) |
| GRACE/GRACE-FO **CSR** RL06.3 mascons (D1) | TWS anomaly | 0.25° grid of 1° equal-area mascons, ~300 km native | monthly, ~2+ months behind | `satellite_monthly` | national + 206 grid-cell series; daily change check (P2) |
| FAO AQUASTAT | renewable resources, withdrawals, EFR, irrigated area, SDG 6.4.2 | country only | annual / irregular, years behind | `statistic` | 399 reference-year rows; weekly check (P2) |
| JRC Global Surface Water | occurrence 1984–2021 | 30 m tiles | historical | `satellite_historical` | map tiles only |
| geoBoundaries, HDX COD-PS, World Bank PEP | boundaries, population, projections | ADM0/1/2, country | static / annual | reference / `statistic` | in DB |
| GloFAS (Open-Meteo Flood API) | discharge (inflow shape for the derived model) | river cells | daily | `reanalysis` | in DB (`inflow_shape`) |

Licences and attribution are recorded in `data_sources` (migration 0002) and on the Data Sources page. Open-Meteo
free tier and AQUASTAT (CC BY-NC-SA 4.0) are **non-commercial**.

## 4. Data classification and status

`data_kind` values (database CHECK constraints):

| data_kind | Meaning |
|---|---|
| `observed` | field or station measurement (BWDB importer; none bundled) |
| `model_current` | Open-Meteo current conditions (weather-model output, not a station reading) |
| `forecast` | Open-Meteo forecast |
| `reanalysis` | Open-Meteo archive (ERA5/ERA5-Land), GloFAS |
| `satellite_monthly` | GRACE/GRACE-FO |
| `satellite_historical` | JRC Global Surface Water |
| `statistic` | AQUASTAT, census, World Bank |
| `derived` | AquaGuard calculations from the above |
| `prediction` | ML output |
| `scenario` | What-if results |
| `conceptual` | illustrative visuals with no measured values (Water Flow) |

The Final Master Prompt §4.6 lists eight kinds; `model_current`, `forecast` and `satellite_historical` from the
original master prompt are kept so forecast and JRC values are not mislabelled (Deviation **D8**).

**Status** is computed when data is read, from the age of the last successful retrieval against the source cadence:
`fresh` · `stale` · `unavailable` · `not_configured` (`backend/app/sync/status.py`). Scheduled sources: no stored data
→ `unavailable`; data but no successful sync yet (bootstrap snapshot) → `stale`; last success older than
`SYNC_STALE_FACTOR` (default 2) × cadence → `stale`; otherwise `fresh`. A failed attempt never deletes data: the status
ages from the last success and the error is reported. Credential-gated sources without credentials (`grace_jpl`,
`bwdb_import`) → `not_configured`. Observation dates are always shown separately from retrieval
dates ("Live" only for fresh Open-Meteo data; "Latest: <month>" for GRACE; "Reference year <yyyy>" for AQUASTAT).

## 5. Scientific assumptions and verified facts

### 5.1 GRACE = Total Water Storage (TWS) anomaly
* Verified from the NetCDF global attributes of `CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc`:
  `product_version = RL06.3`; `geospatial_lat_resolution = "0.25 degree grid; however the mascons are estimated on a
  1-degree equal area mascons and the native resolution of the GRACE/GRACE-FO data is roughly 300km"`;
  `time_mean_removed = 2004.000 to 2009.999`; variable `lwe_thickness` in cm. No per-month uncertainty variable is
  present in this file, so `uncertainty_cm` stays NULL (never invented).
* TWS integrates groundwater, soil moisture, surface water, snow and other storage. It is **never** shown as
  groundwater level or well depth. The Command Center KPI is renamed **"Total Water Storage (TWS) Anomaly"** (M1).
* Gaps (including mid-2017 → mid-2018 between missions) stay gaps.

### 5.2 AQUASTAT historical availability (verified from the source CSV, 2026-11-13)
Years whose AQUASTAT symbol is not `I` (imputed) in `data/raw/aquastat/aquastat_bgd.csv`:

| Variable | Code | Non-imputed reference years |
|---|---|---|
| Total renewable water resources (TRWR) | 4188 | 1990–2018 (long-term average, constant) |
| Environmental flow requirements | 4549 | 1990–2018 |
| Total freshwater withdrawal | 4253 | **2008 only** |
| Agricultural withdrawal | 4250 | **2008 only** |
| SDG 6.4.2 water stress | 4550 | 2008–2023 (FAO estimates, symbol `E`) |
| Area equipped for irrigation | 4313 | 1990, 1991, 1992, 1995, 2008 |

Rules: original reference years, symbols, units and indicator definitions are preserved; imputed rows are flagged
(`imputed = 1`) with `last_non_imputed_year`; no historical record is manufactured; year comparisons are offered only
between genuine reference years (withdrawals therefore have **no** comparison).

### 5.3 National weather estimate (D2)
National weather indicators = area-weighted aggregation of the eight divisional representative points. Label:
**"National estimate based on eight representative divisional weather points."** It is not a measured nationwide
average; each division value is the value at its representative point (divisional HQ).

### 5.4 National water stress — FAO SDG 6.4.2
* Indicator mapping verified: AQUASTAT variable **4550 = "SDG 6.4.2. Water Stress"** (%), Bangladesh 2023 = 5.72.
* Formula (SDG metadata): `stress % = TFWW / (TRWR − EFR) × 100`. Check with AQUASTAT values:
  35.87 / (1227.03 − 600.3) × 100 = 5.72 % ✓.
* Classes (UN-Water SDG 6 Data Portal, sdg6data.org/en/indicator/6.4.2): 0–25 % no stress; >25–50 low;
  >50–75 medium; >75–100 high; >100 critical.
* Seasonal (meteorological) dryness is a separate weather-derived indicator. No division-level stress ratio is
  produced by distributing national statistics.

### 5.5 Effective rainfall (Pe) — method used by the FAO-56 engine
* **Method:** USDA Soil Conservation Service monthly method (as used in FAO CROPWAT):
  `Pe = P × (125 − 0.2 P) / 125` for `P ≤ 250 mm`; `Pe = 125 + 0.1 P` for `P > 250 mm`.
* **Inputs:** precipitation total `P` (mm) for the period (Open-Meteo `precipitation_sum`).
* **Time period:** the formula is defined for monthly totals. For a period of `n` days the total is scaled to a
  30.4-day equivalent, the rule applied, and the result scaled back (`effective_rainfall_period`).
* **Units:** mm per period.
* **Assumptions:** rainfall falls on bare/cropped soil without surface storage; no runoff/percolation modelling beyond
  the empirical rule; daily distribution within the period follows the period ratio Pe/P.
* **Limitations:** empirical and monthly by design; less reliable for single heavy events, ponded rice and very short
  windows.
* **Missing rainfall (current behaviour):** the advisor treats a missing daily value as 0 mm
  (`backend/app/engine/fao56.py`, `advise`). This violates the "no silent fill" rule and is scheduled for M2:
  missing rainfall must make the estimate `unavailable` (or report the missing days) instead of assuming 0.
* **Reference crop:** with `Kc = 1`, `ETc = ET0`; results are labelled **reference-crop estimate**, not a
  crop-specific recommendation.

## 6. Database structure

* SQLite file `data/aquaguard.db`; PRAGMAs per connection: `foreign_keys = ON`, `busy_timeout = 5000`; database-level
  `journal_mode = WAL` (set outside any transaction, before migrations).
* Versioned SQL migrations: `backend/app/db/migrations/NNNN_name.sql`, applied by `backend/app/db/migrate.py`,
  history in `schema_migrations` (version, name, checksum, applied_at). Each migration runs in one transaction;
  checksums of applied migrations are verified; destructive statements (`DROP`, `DELETE`, `ALTER … DROP`, `PRAGMA
  journal_mode`) are rejected before execution; a verified backup is taken before pending migrations run on a
  non-empty database.

| Migration | Tables | Data preserved/copied |
|---|---|---|
| 0001_baseline | legacy tables (`regions`, `sources`, `weather_daily`, `weather_monthly`, `climatology`, `water_resources`, `inflow_shape`, `population_projection`, `storage_anomaly`, `station_observations`, `predictions`, `scenarios`, `alerts_log`) — `CREATE TABLE IF NOT EXISTS` only | existing tables and rows untouched |
| 0002_core | `locations`, `data_sources`, `sync_runs`, `scheduler_lock` | locations from `regions`; data_sources seeded (reference) |
| 0003_weather_values | `weather_values` (unique on location, valid_time, time_step, variable, data_kind) | non-null `weather_daily` values as `reanalysis` |
| 0004_water_statistics | `water_statistics` (revisions via `superseded_at`) | `water_resources` latest rows with symbols/imputation flags |
| 0005_water_storage | `water_storage` (national + grid-cell rows) | `storage_anomaly` as national CSR RL06.3 series |
| 0006_predictions_v2 | `predictions_v2` (model, version, horizon, input_snapshot JSON) | legacy `predictions` kept (0 rows) |
| 0007_alerts | `alerts` (one open alert per rule+location), `alert_reads` | legacy `alerts_log` kept |
| 0008_sync_state | `sync_state` (per-source markers, e.g. GRACE `Last-Modified`/`ETag`) | — |

**Time convention (`weather_values.valid_time`):** the weather point's local time exactly as Open-Meteo returns it
with `timezone=auto`; all eight points are in Asia/Dhaka (UTC+06:00, no daylight saving). Daily values use the local
calendar date (same as `weather_daily`); hourly/current values use local `YYYY-MM-DDTHH:MM`. Retrieval times
(`retrieved_at`, `sync_runs`) are UTC with `Z`.

`weather_monthly` and `climatology` remain as derived tables (ML depends on them). `ml/build_db.py` is an idempotent
bootstrap importer: it runs migrations, upserts processed files (never replaces the database, never writes NULL over a
value), and backfills the new tables.

### 6.1 Sync architecture (P2)

| Part | File | Behaviour |
|---|---|---|
| Open-Meteo forecast | `backend/app/sync/openmeteo.py` | one request per weather point (current + hourly + 16-day daily); `model_current` / `forecast` rows; newest run replaces a changed value; missing/out-of-range values skipped (`validate.py`) |
| Open-Meteo archive | same | last 14 local days → `reanalysis` rows + legacy `weather_daily` (`COALESCE`, NULL never overwrites) → complete months recomputed in `weather_monthly` (partial months never stored) |
| AQUASTAT | `backend/app/sync/aquastat.py` | same query as `ml/fetch_static.py`; non-imputed rows only; a changed value supersedes the old row (`superseded_at`), identical rows skipped; legacy `water_resources` keeps latest value + last genuine reference year |
| GRACE CSR | `backend/app/sync/grace.py` | `HEAD` → download (streamed, size-limited, temporary file deleted) only when `Last-Modified`/`ETag` changed; units/version/baseline verified; national cos(lat)-weighted series + 206 grid cells; calendar-month periods (D9) |
| Jobs | `backend/app/sync/jobs.py` | offline → skipped; DB lease `job:<name>`; min-interval skip (0.9 × interval); `sync_runs` running → success/partial/failed; error summaries contain status + `scheme://host/path` only; legacy `sources.retrieved_at` updated when data was retrieved; API cache cleared |
| Scheduler | `backend/app/sync/scheduler.py` | APScheduler `BackgroundScheduler` (UTC) in the API process when `AQUAGUARD_SCHEDULER_ENABLED=1`; `max_instances=1`, `coalesce`, misfire grace 300 s; staggered first runs 5 s after startup |
| CLI | `python -m app.sync.run` with `forecast`, `archive`, `aquastat`, `grace`, `all` or `status` (`--force`, `--db`) | applies pending migrations first (verified backup) |
| Bootstrap seed | `backend/app/db/seed.py` | API startup with no database → `ml/build_db.py` from `data/processed`; original dates kept → `stale` until the first sync |
| Read path | `backend/app/services/data_access.py` | database only (no sample fallback); point forecast: live → cache → stored forecast of the nearest weather point → `unavailable`; table cache invalidated after local jobs and, within 30 s, after jobs in other processes |

## 7. API architecture

Current endpoints are preserved (`/api/health, /regions, /sources, /overview, /alerts, /map/layers, /weather,
/predictions/*, /models/*, /flow/simulate, /budget, /budget/optimize, /scenario/run, /irrigation/estimate,
/copilot/chat`). New endpoints (P3) are added alongside, with aliases for renamed paths:
`/api/weather/current|forecast|history`, `/api/water/availability|scarcity`, `/api/groundwater/trends`,
`/api/irrigation/recommendations`, `/api/dashboard/summary`, `/api/predictions`, `POST /api/whatif`,
`/api/water-budget`, `/api/alerts` (+ read), `/api/search`, `/api/data/sources|last-updated`, `POST /api/refresh`,
`POST /api/sync/{source}` (admin).

**Envelope (D4):** responses carry `meta {source, data_kind, observed_at, retrieved_at, unit, spatial_level, status,
attribution}` and every numeric value remains a measurement-level `Measure` (one response can mix sources).

**Security:** privileged endpoints use `require_admin` (`backend/app/security.py`): `Authorization: Bearer
<ADMIN_TOKEN>`, constant-time comparison, 401 when missing, 403 when invalid, 503 when the server has no token
configured; tokens are never logged or echoed. CORS allows only the frontend origin and only `Content-Type`, so the
browser cannot send privileged headers cross-origin. Secrets live only in backend environment variables; nothing
secret uses a `NEXT_PUBLIC_` name.

## 8. Dependency strategy

* Pin exact versions; prefer releases at least two weeks old; check OSV (Python) and `npm audit` (Node) before and
  after changes; avoid unrelated upgrades (security upgrades are proposed separately).
* Approved security upgrades (P2): `next` and `eslint-config-next` 15.5.4 → 15.5.28 (all Next.js advisories fixed;
  15.5.29 skipped, < 2 weeks old), `vitest` 3.2.4 → 4.1.12, npm `overrides` pinning Next's nested `postcss` to 8.5.32,
  `sharp` 0.34.5 → 0.35.5 (lockfile, within Next's range). `npm test` runs vitest through `scripts/vitest.mjs`, which
  normalises a lower-case Windows drive letter (vitest 4 otherwise loads its runner twice and every suite fails).
* Not added (not needed): Alembic, SQLAlchemy, pydantic-settings, earthaccess (only for a future JPL adapter).

| Package | Version | Where | Reason |
|---|---|---|---|
| APScheduler | 3.11.3 (2026-06-28) | backend runtime | scheduled sync (P2) |
| tzlocal / tzdata | 5.4.5 / 2026.6 | backend runtime (APScheduler deps) | time zones |
| httpx | 0.28.1 | backend runtime | HTTP client with timeouts/retries |
| h5py | 3.16.0 | backend runtime | GRACE CSR NetCDF/HDF5 reading |
| anthropic | 2.8.0 | backend runtime | Copilot (M8). Exception to the two-week rule: already pinned and in use; OSV clean |
| @playwright/test | 1.64.1 | frontend dev | e2e (1.65.0 skipped: < 2 weeks old); `playwright-core` aligned to 1.64.1 |
| @axe-core/playwright | 4.14.0 | frontend dev | accessibility checks |

## 9. Implementation phases

| Phase | Content | Status |
|---|---|---|
| P1 Foundation | audit, docs, backup, migration runner, migrations 0001–0007, SQLite config, settings, HTTP client, admin auth, dependencies | implemented and verified |
| P2 Sources + scheduler | Open-Meteo, AQUASTAT, GRACE CSR adapters; APScheduler + DB lease lock; status; bootstrap seed; backend sample fallback removed; approved security upgrades | implemented and verified; awaiting review |
| P3 API | new endpoints, meta envelope, alerts engine, search, refresh, admin sync | not started |
| P4 Design + shell | Blue & White glass tokens, shared components, TopBar, Settings, mock mode removal | not started |
| M1–M8 | Command Center → Irrigation → What-if → Water Budget → Prediction Lab → Explorer → Water Flow → Copilot | not started |
| P5 Verification | §7 checks of the master prompt, final report | not started |

## 10. Known limitations

* AQUASTAT withdrawals exist only for 2008; resources are long-term averages; national only.
* GRACE resolves ~300 km; Bangladesh spans only a few native mascons.
* One representative point per division for weather.
* Free hosting may sleep, stopping the scheduler; data then shows `stale` (and is refreshed on the next start).
* Open-Meteo free tier and AQUASTAT are non-commercial.
* GRACE grid-cell rows are 0.25° values of 1° mascons: map display only, never presented as independent local data.
* The GRACE trend artifact (`ml/artifacts`) is not recomputed by the sync; it is rebuilt with `make ml`.
* One moderate, dev-only npm advisory remains (minimatch via typescript-eslint; no stable fix released yet).

## 11. Approved deviations

| ID | Deviation | Reason |
|---|---|---|
| D1 | GRACE CSR RL06.3 retained instead of JPL | approved; no login needed; adapter interface keeps a future JPL adapter possible (`EARTHDATA_TOKEN`, `not_configured` until set) |
| D2 | National weather = area-weighted estimate of eight divisional points | one central point is not representative |
| D3 | Weather archive starts 1991-01-01 | history already present; ML needs it |
| D4 | API metadata envelope plus measurement-level metadata | responses mix sources |
| D5 | Irrigation uses the eight divisional weather points | weather is stored only there |
| D6 | What-if keeps temperature and pipeline-loss controls | preserve working features |
| D7 | Water Flow remains conceptual | no measured flow source exists |
| D8 | `data_kind` list keeps `model_current`, `forecast`, `satellite_historical` | needed to label forecast and JRC data correctly |
| D9 | GRACE stored per calendar month (solutions in the same month averaged), not per exact solution time bounds | **proposed in P2 — needs confirmation**: identical to the existing national series and `ml/grace_trend.py`; one row per month and cell keeps the unique key simple; the file's `time_bounds` are not stored yet |
