# API

Interactive docs: `http://<backend>/api/docs` · OpenAPI JSON: `/api/openapi.json` (snapshot in `docs/openapi.json`).

Scenario-aware GET endpoints accept the `ScenarioParams` fields as query parameters (absent = baseline): `rainfallChangePct` (−50..50), `temperatureChangeC` (−2..4), `demandChangePct` (−30..50), `groundwaterAvailabilityPct` (−50..20), `irrigationEfficiency` (0.30..0.90), `pipelineLossPct` (0..50). Invalid input → `422 {"detail": "..."}`; unknown region → `404`.

Every numeric field is a `Measure`: `{value, unit, provenance, isSample, sourceId, asOf, uncertainty}` with provenance ∈ observed | historical | predicted | estimated | simulated.

| Method | Path | Returns | Module |
|---|---|---|---|
| GET | `/api/health` | status, sample mode, data freshness, LLM enabled | all |
| GET | `/api/regions` | country, 8 divisions, 64 districts (centroids, Bangla names) | all |
| GET | `/api/sources` | dataset registry (licence, resolution, retrievedAt) + every parameter with its source | Data Sources |
| GET | `/api/overview?region` | KPIs, monthly balance, sectors, 8-division comparison, anomaly trends, AQUASTAT checks | Command Center |
| GET | `/api/alerts?region` | rule-based alerts with rule text, inputs and recommendation | Command Center |
| GET | `/api/map/layers?region` | division/district GeoJSON + per-region values + layer metadata + GRACE trend | Explorer |
| GET | `/api/weather?region&start&end&agg=daily\|monthly` | rainfall, temperature, ET0, P − ET0, soil moisture series | several |
| GET | `/api/predictions/scarcity?region&horizon=1\|3\|6` | history, test actual vs predicted, forecasts with 90% interval, risk class, summary | Prediction Lab |
| GET | `/api/predictions/demand?region&horizon` | demand projection by sector and year (Estimated) | Prediction Lab |
| GET | `/api/predictions/groundwater?region` | GRACE series, deseasonalised, trend ± 95% CI, projection | Prediction Lab |
| GET | `/api/models/metrics` | contents of `ml/artifacts/metrics.json` or `evaluated: false` | Prediction Lab |
| GET | `/api/models/shap?region&horizon` | global importance + local explanation | Prediction Lab |
| POST | `/api/flow/simulate` | `{pumpFlowM3s, setpointM, leaks{pipe: severity}, lossPct?, leakageExponent?, optimize}` → state (+ optimized, savings) | Water Flow |
| GET | `/api/budget?region&period=annual\|dry\|1..12` | Sankey nodes/links, sector table, balance check | Water Budget |
| POST | `/api/budget/optimize` | `{region, period, scenario, mode: optimized\|shares, shares?}` → current vs proposed + savings | Water Budget |
| POST | `/api/scenario/run` | `{region, params}` → baseline vs simulated comparisons, risk, monthly series, summary | What-if |
| POST | `/api/irrigation/estimate` | `{crop, region\|lat+lon, soil, plantingDate\|stage, areaHa, efficiency?, overrides}` → requirement, timing, quantity, assumptions | Irrigation |
| GET | `/api/copilot/status` | `ready` / `not_configured` (reason), provider and label, model, data-use disclosure and terms link, read-only tool list, usage limits and today's site-wide model calls; never a key | Copilot |
| POST | `/api/copilot/stream` | `{message, region, history, clientId}` → server-sent events `tool`, `delta`, `done` (provider, model, tools used, unverified numbers) or `error` (`quota_exhausted`, `llm_unavailable`, `llm_timeout`, `llm_auth`, `llm_config`, `refusal`, `site_daily_limit`, ...); 503 `not_configured` without a key, 429 `rate_limited` / `daily_limit` / `site_daily_limit`, 503 `busy` | Copilot |
| POST | `/api/copilot/chat` | same as `/copilot/stream` as one JSON response; errors as HTTP status (429 quota and limits, 503 unavailable / not configured, 504 timeout, 502 other model errors) | Copilot |

Example:

```bash
curl "http://localhost:8001/api/overview?region=rajshahi&rainfallChangePct=-20"
curl -X POST http://localhost:8001/api/flow/simulate -H "Content-Type: application/json" \
     -d '{"pumpFlowM3s":0.5,"setpointM":45,"leaks":{"res":2},"optimize":true}'
```
