# AquaGuard — Final Report (P5)

Date: 2026-11-14 · Branch `develop` · Scope: the approved Final Implementation Scope (P1–P4, M1–M8) and the
master prompt's §7 verification checklist. Evidence for every phase is in `aquaguard-progress.md`.

## 1. What changed, by module

| Module | Before | Now |
|---|---|---|
| Data layer (P1–P2) | Static CSV import, no history of runs | SQLite in WAL mode, own migration runner (0001–0008), verified backups before every DB change. Scheduled sync of Open-Meteo forecast (hourly) and archive (daily), FAO AQUASTAT (weekly) and GRACE CSR (daily check) with retries, validation, `sync_runs`, a DB lease lock, and `fresh / stale / unavailable / not_configured` status per source. No sample or mock mode at runtime |
| API (P3) | Module endpoints only | `{data, meta}` envelope (source, data kind, observed / retrieved time, spatial level, status, attribution), alert rules engine (6 rules in YAML), search, data-source status, last-updated, throttled manual refresh, admin sync behind `ADMIN_TOKEN` |
| Design + shell (P4) | Mixed styling | Blue & White glass design tokens, sidebar with collapse and mobile drawer, Ctrl+K search, region selector (Bangladesh + 8 divisions; districts are a map reference layer only), date filter, notifications, refresh and stale banner, settings, a data-status badge on every value, "View as table" on every chart, axe-clean |
| M1 Command Center | Engine estimates | Live KPIs with data kind and date, KPI drawers (chart, formula, sources), insights, division choropleth of weather indicators with their published class sources, AQUASTAT history by genuine reference year, stored alerts with filters and read marks |
| M2 Smart Irrigation | Climatology weather | The stored 7-day forecast of the nearest divisional point, no zero-filling of missing days, a "why" list with the source and age of every input |
| M3 What-if | 1991–2020 normal only | Latest 12 complete months (or the normal), agricultural consumption lever, national model only, every output labelled, state in the URL |
| M4 Water Budget | One engine Sankey | National AQUASTAT Sankey (default) with reference years, mixed-year warning, "No data" parts, genuine-year comparison and node details; monthly model as a separate derived tab; source colours fixed |
| M5 Prediction Lab | Training-time file only | Inference with the stored models after every archive sync into `predictions_v2` with the exact inputs; DB-first serving; full model card (incl. that the model has not yet flagged a dry month correctly); input viewer |
| M6 Water Explorer | One national GRACE colour | GRACE grid cells (~300 km), the eight weather points, backend info panel, 2D fallback without WebGL / on small screens, lazy layers |
| M7 Water Flow | "Simulated" network | Labelled conceptual illustration (data kind `conceptual`), real AQUASTAT magnitudes marked and kept separate, play / pause, speed and layer controls |
| M8 Copilot | Rule-based fallback answers | Claude (`claude-opus-5-5`) with 11 read-only tools over the backend, streamed answers, validated inputs, logged tool calls, per-client rate limit, unmatched numbers flagged; **no answers without a server-side key** |

## 2. Data sources

Live run on the real database on 2026-11-14 at 08:15 UTC (after a verified backup).

| Source | Status | Cadence | Spatial level | Latest observation | Rows |
|---|---|---|---|---|---|
| Open-Meteo Forecast API | fresh | 1 h | 8 divisional points; national = area-weighted mean | 2026-11-14 14:15 (Asia/Dhaka) | 23,760 values |
| Open-Meteo Historical (ERA5 / ERA5-Land) | fresh | 1 day | 8 divisional points | 2026-11-13 | 628,848 values; 104,808 daily, 3,440 monthly rows |
| FAO AQUASTAT | fresh | 7 days | national | reference year 2023 (SDG 6.4.2; withdrawals 2008) | 424 statistics |
| GRACE CSR RL06.3 mascons | fresh | 1 day (file check) | national series + 0.25° grid (~300 km effective) | 2026-09 | 259 national + 53,354 grid-cell months |
| GRACE JPL | not_configured | 1 day | — | — | 0 (needs `EARTHDATA_TOKEN`, Deviation D1) |
| AquaGuard ML (stored predictions) | fresh | after each archive sync | division; national = area-weighted | issued 2026-10 for 2026-11 / 2027-01 / 2027-04 | 24 predictions |
| AquaGuard engine | fresh | on request | national (divisions computed, national reported) | — | — |
| geoBoundaries, HDX COD-PS, JRC Global Surface Water | fresh (static reference) | static | divisions / districts; 30 m tiles (JRC) | — | reference files |
| World Bank population projection | fresh | yearly | national | — | 51 rows |
| BWDB groundwater importer | not_configured | manual | — | — | 0 (no measured well data supplied) |
| Open-Meteo Flood API (GloFAS) | fresh (static import) | irregular | national inflow | — | 12 rows: only the monthly inflow shape of the derived national model |

## 3. Control inventory (final status)

Status: **working** (with the test that shows it), **disabled with the reason shown**, or **not re-tested in P5**.

| Area | Controls | Final status | Evidence |
|---|---|---|---|
| Shell | 10 sidebar links, collapse / expand, mobile drawer (Escape), skip link | working | `shell.spec` (4 tests), `a11y.spec` visits every page |
| Shell | Search button and Ctrl+K palette with keyboard selection | working | `shell.spec` |
| Shell | Region selector (Bangladesh + 8 divisions, kept in the URL; district links fall back to the division) | working | `shell.spec` (2), `command-center.spec` region refetch |
| Shell | Date filter (only on pages with dates, kept in the URL, changes chart ranges) | working | `shell.spec`, `command-center.spec` |
| Shell | Refresh weather (header and banner), throttled; notifications with unread count and mark read; profile menu; settings | working | `shell.spec` (4) |
| Shell | Data-label help, floating Copilot panel open / close | working | `controls.spec` |
| Shell | Stale banner "Dismiss" | not re-tested in P5 | the banner is absent while every source is fresh (all 30 P5 screenshots) |
| Shell | Header scenario chip "Reset" | not re-tested in P5 | shown only while a scenario is active; same store reset as What-if "Reset to baseline" (tested) |
| Charts | "View as table" on every chart, PNG export | working | `shell.spec` (table view), `controls.spec` (Sankey PNG download) |
| Command Center | KPI drawers (chart, formula, sources, focus return), efficiency slider, map category filter and legend, regional table, alerts filter / detail / mark read, insights and trends with the date filter | working | `command-center.spec` (7) |
| Water Explorer | layer toggles, opacity, extrusion, boundary level, 2D / 3D switch, reset view, lite mode, division buttons, map / point / district click → info panel | working | `explorer.spec` (6), `controls.spec` |
| Water Explorer | "Show 3D map" without WebGL; 3D-only layers in the 2D map | disabled with the reason shown | `explorer.spec` |
| Prediction Lab | sections (forecast / demand / GRACE, URL), horizon (URL), category, "View model inputs" | working | `prediction-lab.spec` (4), `controls.spec` |
| Prediction Lab | categories without a model (rainfall, groundwater storage) | disabled with the reason shown | `prediction-lab.spec` |
| Water Flow | pump and set-point sliders, leak switches and severity, play / pause, speed, layer switches, optimise, current / optimised view, reset, lite mode | working | `water-flow.spec` (3), `controls.spec` |
| Water Budget | view tabs (URL), node hover / click, legend chips, comparison year, period and month, optimiser, custom shares, PNG | working | `water-budget.spec` (4), `controls.spec` |
| What-if | levers (URL), presets, reset, baseline basis | working | `what-if.spec` (4) |
| What-if | "Apply across platform" | not re-tested in P5 | disabled at baseline; enabled after a lever change (M3) |
| Smart Irrigation | crop, growth stage, division (select and map), soil, area, planting date, estimate | working | `irrigation.spec` (3), `controls.spec` |
| Smart Irrigation | optional overrides (efficiency, temperature, rainfall) | working (API) | backend `test_irrigation_m2.py` overrides → scenario; no UI test |
| Copilot | question box, send, stop, suggestions | disabled with the reason shown (no server key) | `copilot.spec` (keyless server); configured behaviour with recorded streams |

## 4. Verification results (§7)

| # | Check | Result |
|---|---|---|
| 1 | Parser / validator unit tests on recorded real responses | **pass**: `test_sync.py` (27) with fixtures recorded once (Open-Meteo forecast and archive, AQUASTAT subset, GRACE subset) |
| 2 | Live run per source with row counts and sample rows | **pass**: real DB after verified backup `aquaguard-pre-p5-20261114T081540Z.db`; forecast +376 / 15,368 updated, archive +48 days, AQUASTAT 0 new (706 unchanged), GRACE unchanged; samples show observed and retrieved times (§2) |
| 3 | Scheduler at 1-minute intervals for about 3 minutes | **pass** (scratch copy): 4 jobs × 4 runs, `sync_runs` 27 → 43, every re-run inserted 0 rows, 0 duplicate keys in 5 tables |
| 4 | Failure and recovery | **pass** (scratch copy): forecast pointed at a dead host, 5 attempts per point with backoff (32 retry log lines), job `failed`, 23,384 rows kept and no nulls written, status `stale`; restored, job `success`, status `fresh`. UI: the stale banner was shown before the live run and is absent on all pages after it |
| 5 | Row counts never go down; no null overwrites a valid value | **pass**: no table decreased in the live run; null-overwrite protection covered by `test_archive_sync_updates_legacy_daily_without_overwriting_with_null` and the failure run above |
| 6 | Stored prediction snapshot references rows the scheduler created | **pass with a note**: on the real DB the snapshot equals the stored October 2026 row, but that row came from the bootstrap import (the scheduler re-validated it); on a scratch copy the archive sync re-created October from Open-Meteo and the new inference snapshot equals the rows the sync wrote. The first month the scheduler creates on its own is November 2026 (early December) |
| 7 | Region change and date filter drive requests, KPIs, charts and the map | **pass**: `command-center.spec`, `shell.spec` |
| 8 | Map click, sidebar, drawer, search, alerts read / filter, what-if sliders and reset, irrigation crop and stage | **pass**: `explorer.spec`, `shell.spec`, `command-center.spec`, `what-if.spec`, `irrigation.spec` |
| 9 | Control inventory | **pass with notes**: §3; three controls not re-tested in P5 are listed as such |
| 10 | Accessibility and keyboard | **pass**: axe WCAG 2.1 A/AA on every page and on open drawers / panels (no violations); skip link, palette, menus and drawers by keyboard |
| 11 | Screenshots at 375 / 768 / 1440 px, build, 3D code not in the main bundle | **pass after fixes**: 30 screenshots; What-if, Irrigation (375 and 768 px) and Data Sources (375 px) scrolled sideways, fixed and now guarded by `responsive.spec`. `npm run build` passes (first load 104–139 kB); MapLibre and three.js only in lazily loaded chunks |
| 12 | Static-data sweep | **pass**: no mock / dummy / fake / sample data, JSON data imports or large literal arrays in runtime frontend code; mock JSON only under `tests/fixtures`; backend hits are legacy flags that are always false and ML sample counts |
| 13 | Existing tests and features | **pass**: backend **327 passed**, vitest 38, Playwright **65 passed**, tsc, ESLint, ruff; legacy endpoints still served (`test_api.py`) |
| — | Dependencies | runtime npm tree 0 vulnerabilities; 6 moderate dev-only (minimatch chain); OSV: 54 Python packages, only local `pip` flagged |

## 5. Remaining limitations and what is needed from you

* **LLM key (Copilot).** Since the Gemini update: set `GEMINI_API_KEY` on the server (never in the frontend); `ANTHROPIC_API_KEY` remains supported with `LLM_PROVIDER=anthropic`. Without a key the Copilot says
  "not configured" and answers nothing. The configured path is verified with a fake client and recorded streams; no
  real Claude request has been made yet.
* **Earthdata credentials** (`EARTHDATA_TOKEN`) only if you want the JPL GRACE adapter (Deviation D1); CSR works
  without them.
* **JRC surface water** is shown from the public Global Surface Water tiles; an Earth Engine account is only needed
  for statistics per division (not built).
* **Basemap**: the CARTO Positron style is used without a token; for production traffic or a different style, a
  basemap token / provider agreement is needed.
* **No measured groundwater levels, water quality or real-time sensors.** GRACE is a regional storage anomaly
  (~300 km), never a well level. The BWDB importer is ready for well data you provide.
* **ML dryness classes**: in the 2021–2026 test period the model predicted none of the 93 dry months as dry
  (macro-F1 equals climatology); use the predicted value and interval.
* **Scheduler** is off by default (`AQUAGUARD_SCHEDULER_ENABLED=0`); enable it on the host that should sync.
* **Dev-only advisory**: 6 moderate `npm audit` entries from one chain (minimatch via typescript-eslint); the runtime
  dependency tree has 0. Python: only the local `pip` tool (not deployed) is flagged by OSV.
* Docker image not built here (no Docker on this machine).

## 6. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000` | frontend origins allowed by CORS |
| `AQUAGUARD_DB_PATH` | `data/aquaguard.db` | database file |
| `AQUAGUARD_MIGRATE_ON_STARTUP` | 1 | apply pending migrations at startup (backup first) |
| `AQUAGUARD_BOOTSTRAP_ON_STARTUP` | 1 | build a missing DB from `data/processed` (original dates, shown stale) |
| `AQUAGUARD_OFFLINE` | 0 | 1 = never call external APIs |
| `AQUAGUARD_SCHEDULER_ENABLED` | 0 | run the sync scheduler inside the API process |
| `SYNC_FORECAST_MINUTES` / `SYNC_ARCHIVE_HOURS` / `SYNC_AQUASTAT_DAYS` / `SYNC_GRACE_HOURS` | 60 / 24 / 7 / 24 | sync cadences |
| `SYNC_STALE_FACTOR` | 2 | `stale` when the last success is older than factor x cadence |
| `SYNC_INTERVAL_OVERRIDE_S` | — | verification only: run every job at this interval |
| `HTTP_CONNECT_TIMEOUT_S`, `HTTP_READ_TIMEOUT_S`, `HTTP_MAX_RETRIES`, `HTTP_BACKOFF_BASE_S`, `HTTP_BACKOFF_MAX_S`, `HTTP_RETRY_AFTER_MAX_S` | 10, 60, 4, 1, 60, 300 | outbound HTTP behaviour |
| `OPENMETEO_API_KEY` | — | only for a paid Open-Meteo plan |
| `OPENMETEO_FORECAST_URL`, `OPENMETEO_ARCHIVE_URL`, `AQUASTAT_API_URL`, `GRACE_CSR_URL` | public endpoints | source endpoints (testing or mirrors) |
| `EARTHDATA_TOKEN` | — | future JPL GRACE adapter; empty = `not_configured` |
| `ADMIN_TOKEN` | — | protects `POST /api/sync/{source}`; empty = admin disabled. Server-side only |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` (legacy `LLM_API_KEY`) | — | Copilot key for the configured provider; empty = `not_configured`. Server-side only |
| `LLM_PROVIDER` / `LLM_MODEL` / `GEMINI_THINKING_LEVEL` / `LLM_CALL_TIMEOUT_S` | `gemini` / `gemini-3.6-flash` / `low` / 30 | Copilot provider (gemini or anthropic, never switched automatically), model, thinking level, per-call timeout |
| `COPILOT_RATE_PER_MIN`, `COPILOT_DAILY_PER_CLIENT`, `COPILOT_DAILY_MODEL_CALLS`, `COPILOT_MAX_CONCURRENT`, `COPILOT_MAX_MODEL_CALLS`, `COPILOT_MAX_OUTPUT_TOKENS`, `COPILOT_DEADLINE_S` | 5, 30, 200, 2, 4, 4096, 90 | Copilot usage limits that protect the free AI quota |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8001` | the only frontend variable: the API address (no secrets) |
