# AquaGuard — Implementation Plan (Main Rebuild)

Status: **M1–M8 implemented and verified; P5 (final verification) in progress.** Evidence:
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
| Frontend | Next.js 15.5.28, React 19.1, TypeScript, Tailwind CSS 4, Zustand 5, lucide-react |
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
* **Missing rainfall (fixed in M2):** `fao56.advise` refuses a day without ET0 or rainfall; the irrigation route
  stops the 7-day window before the first incomplete day, reports the missing dates and never assumes 0 mm.
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
/copilot/chat`); the current UI keeps working on them until P4/M1–M8 move it to the new contract.

### 7.1 P3 endpoints (implemented)

All take `region` = `bd` or a division id. Districts → 422 `unsupported_region` (decision 6); unknown → 404
`unknown_region`. Files: `routers/data_api.py`, `routers/platform_api.py`, readers in `services/store.py`.

| Endpoint | Data | data_kind / level |
|---|---|---|
| `GET /api/weather/current` | latest model_current per variable; national = area-weighted mean of the 8 points (only when all have it) | model_current; point / national |
| `GET /api/weather/forecast?days=1..16&step=daily\|hourly` | stored forecast (hourly ≤ 7 days) | forecast |
| `GET /api/weather/history?start&end&step=daily\|monthly` | `weather_daily` / `weather_monthly` (daily ≤ 10 years) | reanalysis (+ derived P − ET0) |
| `GET /api/water/availability` | AQUASTAT TRWR, renewable surface/groundwater, external inflow, EFR (each with reference year and change vs the previous reference year) + GRACE context | statistic (national only), satellite_monthly |
| `GET /api/water/scarcity` | `statistics`: SDG 6.4.2 with FAO class (national); `weather`: 30-day rainfall vs 1991–2020 and vs last year, 30-day and next-7-day P − ET0, reference-crop need (Kc = 1), 3-month dryness z with SPI class | statistic; reanalysis/derived/forecast |
| `GET /api/groundwater/trends?start&end&cells=true` | national GRACE series, latest vs same month last year, trend (artifact), optional 206 grid cells | satellite_monthly; regional |
| `GET /api/dashboard/summary?targetEfficiency` | the five §6.1 KPIs (availability, demand, utilization, water storage, potential saving) + open alert count | mixed |
| `GET /api/predictions?category=water_balance&horizon=1\|3\|6` | ML P − ET0 forecasts with interval, 36-month history, model card | prediction (artifacts until M5 fills `predictions_v2`) |
| `GET /api/water-budget?mode=national\|derived` | national AQUASTAT Sankey (reference years, mixed-year flag, "no data" parts, derived remainder) or the existing monthly model (national) | statistic / derived |
| `POST /api/whatif` | existing scenario engine, national only (division request → national with note) | scenario |
| `GET /api/irrigation/recommendations` | GET wrapper of `POST /api/irrigation/estimate` | forecast + derived |
| `GET /api/alerts` | legacy computed alerts (unchanged) **plus** `data` (stored rule-engine alerts, filters `severity`, `status=open\|all`, `clientId` for read marks) and `meta` | per alert |
| `POST /api/alerts/{id}/read` | body `{clientId}` (8–64 chars `[A-Za-z0-9_-]`, per browser; no login) | — |
| `GET /api/search?q&limit` | regions (districts link to their division), modules, indicators, sources, open alerts | reference |
| `GET /api/data/sources`, `/api/data/last-updated` | registry + computed status, last success, last error, latest observation | reference |
| `POST /api/refresh` | public; re-runs only the Open-Meteo forecast/archive jobs that are not fresh; "Already up to date" when fresh; throttled to one run per 10 min (DB lease, 429 + `Retry-After`); 503 `offline` when outbound access is disabled; never the GRACE download | — |
| `POST /api/sync/{source}?force` | admin only (`ADMIN_TOKEN`); job name or source id | — |

**Envelope (D4):** `{ data, meta }`, `meta = {source[], data_kind[], observed_at, retrieved_at, unit, spatial_level,
status, attribution[], note}`. `source`, `data_kind` and `attribution` are lists because one response can combine
sources; `status` is the least current of them. Every new numeric value is a `Measure` with `dataKind`, `status`,
`observedAt`, `retrievedAt`, `spatialLevel`, `referenceYear` and `note` (legacy `provenance` kept for the old UI;
`isSample` always false). Compact series (`t[]`, `v[]`) are labelled by `meta`.

**Errors:** `{detail, code}` for every error (`invalid_request`, `invalid_parameter`, `invalid_date`, `invalid_range`,
`unknown_region`, `unsupported_region`, `unsupported_category`, `not_found`, `unauthorized`, `forbidden`,
`refresh_throttled`, `offline`, `unavailable`, `internal_error`); unhandled exceptions return a generic 500 and are
logged by type only. **Caching:** `no-store` for alerts, data status, health and search; 60 s for current/forecast
weather and the dashboard; 300 s otherwise.

**Alerts engine (`services/alert_engine.py`, `config/alert_rules.yaml`):** six rules — SDG 6.4.2 classes (national),
30-day rainfall deficit (divisions, assumption threshold), BMD heavy/very heavy rain in the 7-day forecast,
3-month dryness (SPI classes), ML-predicted dryness (labelled prediction) and GRACE storage decline (assumption
threshold, CI below zero). One open alert per rule and location (unique partial index); firing → open/update,
not firing → resolve, no data → untouched. Runs after every sync job and via `python -m app.sync.run alerts`.
Engine-based division stress (national statistics distributed to divisions) is not used for stored alerts.

**Security:** privileged endpoints use `require_admin` (`backend/app/security.py`): `Authorization: Bearer
<ADMIN_TOKEN>`, constant-time comparison, 401 when missing, 403 when invalid, 503 when the server has no token
configured; tokens are never logged or echoed. CORS allows only the frontend origin and only `Content-Type`, so the
browser cannot send privileged headers cross-origin. Secrets live only in backend environment variables; nothing
secret uses a `NEXT_PUBLIC_` name.

### 7.2 Frontend design system and shell (P4, implemented)

**Tokens** (`frontend/app/globals.css`, Tailwind 4 `@theme`): background `#F4F9FF`, surface `#FFFFFF`, light blue
`#EAF5FF`, ink `#102B50`, muted `#536C8A`, primary (buttons/links) `#0868CC`, deep blue `#0755B8`, accent `#0878E8`
(large text, icons, fills only), sky `#55B8FF` (decoration and chart accents only), form-control borders `#7A94B0`
(3.1:1), status text green `#1B7F4C` / amber `#A15C00` / orange `#B4410F` / red `#C62828` (always with a label or icon).
WCAG ratios are asserted in `frontend/tests/design.test.ts`.

**Glass:** `.card` / `.glass` = `rgba(255,255,255,0.72)`, 1 px `rgba(120,180,235,0.25)` border, 14 px blur, soft blue
shadow; the top bar uses a stronger glass. Overlay backdrops have no blur, so at most two blur layers stack.
`@supports` fallback to near-opaque white; `prefers-reduced-transparency` and the Settings switch give solid white.
**Motion:** 150–250 ms ease-out; `prefers-reduced-motion` and the Settings choice (system / reduce / allow) disable
transitions and animations; nothing pulses or streams.

**Shared components** (`frontend/components/ui`): `GlassCard` (`Card`), `KpiCard` (status badge, optional
`onOpen` for the M1 DetailDrawer), `DataStatusBadge` (source, data kind, observed and retrieved times, status;
"Live" only for fresh Open-Meteo data, "Latest: <month>" for GRACE, "Reference year <yyyy>" for AQUASTAT),
`Skeleton`, `EmptyState`, `ErrorState`, `StaleBanner`, `Toast`, `Modal`, `ConfirmDialog`, `DetailDrawer`, `Dropdown`,
`Popover`, `Tooltip`. Dialogs trap focus, close on Escape/backdrop and return focus; menus support arrow keys.
Every Plotly chart, the Sankey and the trend sparklines have a "View as table" toggle; sparklines draw gaps as gaps.
**Chart palette:** `#0868CC, #C2410C, #0D9488, #6250D6, #D55181` (fixed order, validated with the dataviz validator on
white: adjacent CVD ΔE ≥ 13.7, normal-vision ΔE ≥ 24.7, all ≥ 3:1).

**Shell:** blue-gradient sidebar (`#0868CC → #0755B8`, white labels) with the eight modules, Settings and Data Sources;
collapsible on desktop (saved), drawer on mobile. Top bar: welcome + page title, search (Ctrl/Cmd+K command palette
over `/api/search` and the module list; combobox/listbox, arrows + Enter), date filter (only on pages that register
their data range with `useDateBounds`; kept in `?from=&to=`), region selector (national + 8 divisions; district ids
from old links fall back to their division with a notice), scenario chip, manual refresh (`POST /api/refresh`,
toast; 429/offline handled), notifications (stored alerts, unread count, per-browser read marks), data-label legend,
Copilot and a profile menu with working items only (no accounts exist: Settings, Data sources & status, Keyboard
shortcuts). Global state (Zustand) holds region, date range and scenario (all in the URL) plus saved preferences.

**Settings** (`/settings`): water-volume units (as published / MCM / km³; applied to every formatted value and KPI,
charts keep their axis unit), default region, motion, transparency, reset (confirm dialog) and the data-source status
list. **Mock mode removed** (decision 5): the API client is live-only; `frontend/public/mocks` moved to
`frontend/tests/fixtures/mocks` (test fixtures only); the sample banner and "Sample" tags are gone.

**Tests:** vitest (`tests/design.test.ts`: token contrast, table view, units, date range, search, status labels);
Playwright (`frontend/e2e`, `npm run e2e`): shell, drawer, palette, keyboard, date filter, notifications, refresh,
settings, table view, profile menu, and axe (WCAG 2.1 A/AA, no serious or critical violations) on all 11 routes.
The e2e run builds into `.next-e2e` (env `NEXT_DIST_DIR`) and uses `backend/scripts/e2e_server.py` (database copy,
offline, port 8013), so neither the regular build nor the real database is touched.

### 7.3 M1 Command Center (implemented)

**Backend:** `GET /api/water/scarcity/divisions` (weather-derived indicators for the eight divisions + the area-weighted
national row, with legend classes; `services/indicators.py`, cached 60 s), `GET /api/water/history?codes=` (AQUASTAT
genuine reference years only, never interpolated), `GET /api/weather/history?...&normals=true` (1991–2020 monthly
normals aligned to the months), `GET /api/geo/divisions|districts` (geoBoundaries reference geometry, cached 1 day)
and `insights` in `GET /api/dashboard/summary` (`services/insights.py`: sentences built only from stored values, each
with sources, data kind, observation date and status; left out when its data is unavailable).

**Legend classes and their sources:** dryness z (3-month P − ET0) — SPI classes (McKee et al. 1993; WMO-No. 1090);
30-day rainfall vs 1991–2020 — India Meteorological Department rainfall departure categories (not classified when the
normal is below 5 mm); next-7-day P − ET0 and 30-day reference-crop irrigation need — AquaGuard display bins, flagged
as an assumption. A value on a class boundary belongs to the class farther from neutral (SPI convention).

**Page** (`frontend/app/command-center`): five KPI cards (value, unit, date, data kind, status, comparison only with a
real earlier value of the same time step) each opening a DetailDrawer with its chart (reference-year chart, GRACE
months, last-30-day rain vs ET0 for a division), formula, sources and context; the saving KPI has a target-efficiency
slider (scenario, debounced request). Key insights; stored alerts with severity filter, per-browser read marks and a
detail dialog (value, threshold and its source, data source, observation date; predictions labelled). Weather-derived
choropleth with a category filter, legend (classes, thresholds, source), hover panel and click-to-select; regional
table (sortable, keyboard selectable, CSV). Availability vs demand by AQUASTAT reference year (log axis, markers only
at genuine years). Rainfall and P − ET0 anomalies against the 1991–2020 normal that follow the global date filter over
the whole archive (1991 → latest complete month; default the last ~24 months). Model checks (legacy national engine
vs AQUASTAT) load only when expanded. With a division selected, national statistics are labelled "National data".
The legacy engine KPIs, engine-based division stress, risk map and sector chart were removed from this page
(decision 1); the national engine stays in Water Budget and What-if.

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
| P2 Sources + scheduler | Open-Meteo, AQUASTAT, GRACE CSR adapters; APScheduler + DB lease lock; status; bootstrap seed; backend sample fallback removed; approved security upgrades | implemented and verified |
| P3 API | new endpoints, meta envelope, alerts engine, search, refresh, admin sync | implemented and verified |
| P4 Design + shell | Blue & White glass tokens, shared components, TopBar, Settings, mock mode removal | implemented and verified |
| M1 Command Center | KPIs + drawers, insights, stored alerts, weather choropleth + regional table, reference-year trend, weather anomalies with date filter | implemented and verified |
| M2 Smart Irrigation | stored 7-day forecast of the nearest divisional point, no zero-filled days, "why" list with ages, conditions context, data kinds | implemented and verified |
| M3 What-if | national deterministic model, latest-12-month baseline (or 1991-2020 normal), agricultural consumption lever, every output labelled, URL state, documented method | implemented and verified |
| M4 Water Budget | national AQUASTAT Sankey default (sources → total → uses, own reference years, mixed-year warning, no-data parts, genuine-year comparison, node details) + monthly model tab (derived/scenario, national) | implemented and verified |
| M5 Prediction Lab | event-driven inference after the archive sync into predictions_v2 with input snapshots, DB-first serving, model card, region/category/horizon, history + band, input viewer | implemented and verified |
| M6 Water Explorer | GRACE grid cells (~300 km), weather points, districts as reference layer, backend info panel, 2D fallback (no WebGL / small screen), lazy layers | implemented and verified |
| M7 Water Flow | conceptual illustration (data kind `conceptual`), real AQUASTAT magnitudes marked and kept separate, play/pause, speed, layer switches | implemented and verified |
| M8 Copilot | Claude with 11 read-only backend tools, streamed answers, validated inputs, logged tool calls, per-client rate limit, unmatched numbers flagged, `not_configured` without a key (no canned answers) | implemented and verified |
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
| D9 | GRACE stored per calendar month (solutions in the same month averaged), not per exact solution time bounds | **approved (2026-11-14)**: identical to the existing national series and `ml/grace_trend.py`; one row per month and cell |
