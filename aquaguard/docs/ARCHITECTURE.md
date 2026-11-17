# BlueSense architecture

BlueSense uses a modular monolith: Next.js frontend, FastAPI backend, SQLite storage and an offline Python ML pipeline. The application remains in `aquaguard/`; internal source IDs and `AQUAGUARD_*` settings retain their existing names for compatibility.

## Runtime data flow

```text
Committed data/processed + geographic reference files
                       ↓ bootstrap import and migrations
External sources → sync adapters → SQLite ← stored ML predictions
                                      ↓
                          services + shared calculation engines
                                      ↓
                        FastAPI /api/* and read-only Copilot tools
                                      ↓
                         Next.js typed API client → module views
```

The browser calls the API only. There is no runtime mock or sample fallback. `data/sample/` and `frontend/tests/fixtures/mocks/` are legacy/test artifacts. When the database is missing, startup can build it from `data/processed`; missing records remain unavailable and original observation/reference dates are preserved.

## Layers

| Layer | Paths | Responsibility |
|---|---|---|
| Offline ingestion | `ml/fetch_*.py`, `ml/process_weather.py`, `ml/build_geo.py`, `ml/grace_trend.py` | Download and clean datasets, record source metadata, compute complete months and climatology |
| Bootstrap | `ml/build_db.py`, `backend/app/db/backfill.py` | Idempotent import from processed data and available raw history; no row-count reductions |
| Database | `backend/app/db/` | SQLite WAL, foreign keys, versioned migrations and verified backups |
| Scheduled ingestion | `backend/app/sync/` | Open-Meteo forecast/current/archive, AQUASTAT and CSR GRACE; validation, retries, run logs and DB lease locking |
| Engines | `backend/app/engine/` | Water balance, scenarios, FAO-56, flow simulation, risk and allocation optimization |
| Services | `backend/app/services/` | Database access, provenance, indicators, predictions, regional computations, spatial intelligence and Copilot |
| API | `backend/app/routers/`, `backend/app/schemas/` | Validated requests, typed responses and documented errors |
| Frontend | `frontend/app/`, `frontend/components/`, `frontend/lib/` | Module pages, typed API calls, URL state, preferences and client-only chart/map/3D components |

## Storage and freshness

SQLite defaults to `data/aquaguard.db`, with `foreign_keys=ON`, WAL and a busy timeout. Migrations and imports take verified backups before changing existing data. The scheduler is disabled by default; enable `AQUAGUARD_SCHEDULER_ENABLED=1` on the intended host. Concurrent workers use a database lease to avoid running the same ingestion job twice.

Values distinguish source, data kind, spatial level, observation/reference date, retrieval date and freshness where applicable. National AQUASTAT statistics stay national. Weather uses eight representative divisional points; national weather aggregates those points. District boundaries do not supply district water measurements. GRACE cells have approximately 300 km effective resolution.

A clean processed-data bootstrap does not contain every record obtainable through source sync. Genuine AQUASTAT history and GRACE grid cells depend on ingestion; the API must show missing values honestly. Free hosting without a persistent disk loses synced additions on redeployment.

## Shared calculations and scenario boundaries

Water mathematics lives in the engine layer, with parameters in `backend/app/config/parameters.yaml`. Regional services reuse the engine for derived balances, scenario comparisons and related tools. Consistency tests check equivalent calculations and water-balance closure.

Zustand stores selected geography, date range, scenario, shell state and preferences. Header and Settings region changes atomically update both the active selection and persisted region preference; storage events synchronize other open tabs. Explicit URL geography takes precedence on first load. Geography, dates and scenario parameters are mirrored in URLs. Applying a scenario affects endpoints/modules that accept scenario inputs; historical weather, reference-year statistics and current source records remain unchanged. The Command Center's newer summary endpoint reports stored statistics and indicators rather than turning those records into simulated data.

Volume formatting reads the same persisted unit preference. Module subscriptions update values without remounting page controls. Plotly traces, uncertainty bands, axes, tooltips and chart tables convert together; Sankey labels/tables and daily-volume metrics use the same conversion. API/cache values and calculation inputs remain in source units. Rainfall, pressure, temperature, ratios and native hydraulic input controls retain their own physical units. Regional API requests are keyed by geography, and an old region's cached response is not displayed under a newly selected region.

Water Rhythm shares one page-local weather request and month selection with the monthly charts. Its dryness series is read-only: three consecutive stored months, at least 25 complete reference windows, and no gap filling. Reduced-motion preferences and offscreen state pause decorative animation.

## API contract

Pydantic models define the API. Platform endpoints use `{data, meta}` envelopes; legacy module routes retain their existing response models. Numeric measures carry units and provenance, with additional status/source metadata where applicable. Interactive documentation is at `/api/docs`; the live schema is `/api/openapi.json`.

`make mocks` exports the schema to `docs/openapi.json` and regenerates `frontend/lib/types/api.d.ts`. Its historical name does not enable mock serving. The frontend client is `frontend/lib/api/client.ts`.

## Prediction and Copilot boundaries

Training runs offline. Random Forest and XGBoost forecast climatic water balance at one, three and six months. Runtime services load stored artifacts and predictions; they do not train models per request. Evaluation and uncertainty limits are documented in [MODEL_CARD.md](MODEL_CARD.md).

Copilot defaults to Gemini and optionally supports Anthropic. Credentials load from server environment or `backend/.env`, never public browser variables. The selected provider uses validated read-only tools; missing credentials produce `not_configured`, not fabricated fallback answers. Bounded Gemini retries occur before output; SSE comments keep the browser stream alive during synchronous provider I/O. Usage counters are in memory and reset on process restart.

## Deployment and verification

The root `render.yaml` builds the backend Docker image with `aquaguard/` as context. The frontend deploys separately with its backend URL set at build time. The blueprint needs actual CORS origins, server-side provider secrets and a persistence strategy if synced data must survive restarts.

Backend and browser tests build isolated temporary databases from committed processed data and recorded AQUASTAT, GRACE and weather fixtures. They do not read the local application database or local `.env`; browser tests use a separate offline backend and `.next-e2e`. See the [repository README](../../README.md) for setup, verification commands and current submission status; historical phase reports are not proof that the current working tree passes.
