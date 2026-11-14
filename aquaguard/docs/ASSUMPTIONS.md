# Assumptions

Every modelling assumption, with its ID. Parameter values and sources are in `backend/app/config/parameters.yaml` and on the Data Sources page.

| ID | Assumption | Why | How to replace |
|---|---|---|---|
| A-01 | One representative point per division (divisional HQ) for Open-Meteo weather | Specification default; limits API calls | Average several grid points per division in `ml/fetch_openmeteo.py` |
| A-02 | Climate normal = 1991–2020 (WMO standard) for the water balance and climatology | Engines describe a typical year, not a specific one | Change `CLIM_START/END` in `ml/process_weather.py` |
| A-03 | AQUASTAT values are used as published even when carried forward (withdrawals 2008, resources 2018) | Most recent available national values | Re-run `ml/fetch_static.py aquastat` when AQUASTAT updates |
| A-04 | Runoff coefficient 0.2133 = AQUASTAT internal surface water / precipitation volume, applied uniformly to all divisions | Calibrated to national totals; no division-level runoff data | Division coefficients from BWDB/hydrological models |
| A-05 | Transboundary inflow split across divisions by area share | No per-division access data | BWDB discharge via the importer, assigned to receiving divisions |
| A-06 | Industrial withdrawal split by 2022 population share | No division industrial-water data | BBS/industrial survey data |
| A-07 | Annual renewable groundwater usable in any month in proportion to monthly consumptive need (aquifer storage buffer) | Bangladesh's dry-season irrigation draws on storage recharged in the monsoon | Monthly groundwater model or BWDB well data |
| A-08 | AQUASTAT irrigated crop areas split to divisions by area share | No division irrigated-area data in sources | BBS Yearbook of Agricultural Statistics |
| A-09 | All AQUASTAT irrigated rice assigned to Boro; Aman/Aus treated as rain-fed in the budget | Boro is the dominant irrigated rice | Season-specific irrigated areas |
| A-10 | Stress ratio = consumptive demand / (supply − environmental reserve) (SDG 6.4.2 / Aqueduct form) instead of ΣDemand incl. environment / supply | Avoids double-counting the ~50% environmental reserve | — (documented deviation from the specification text) |
| A-11 | Distribution loss rate 20% applied to piped domestic and industrial conveyance only | No national statistic in sources; irrigation losses are inside irrigation efficiency | Utility non-revenue-water data |
| A-12 | Irrigation efficiency 0.78 = AQUASTAT irrigation requirement / agricultural withdrawal (2008) | Derived from cited figures | Scheme-level efficiencies |
| A-13 | Crop stage lengths and planting dates are typical values (flagged in config) | Varieties and dates vary | BRRI/BARI variety calendars |
| A-14 | Rice land preparation 200 mm, percolation 2 mm/day, AWD saving 15% | Indicative values within published ranges | Local field data |
| A-15 | 'Current' allocation = pro-rata rationing | No observed allocation data | Observed abstraction records |
| A-16 | Monthly inflow shape from summed GloFAS discharge at three river cells (Ganges, Brahmaputra-Jamuna, Upper Meghna), 1991–2020 | Real modelled discharge; only the shape is used, volumes come from AQUASTAT | BWDB gauged discharge |
| A-17 | District values = parent division values | No district hydrology in sources | District-level data adapters |
| A-18 | Scenario forecast = model re-run with last 3 months perturbed + direct effect on the target month (r × P_normal − (ratio − 1) × ET0_normal) | Model features are lagged, so a perturbation of only past months would ignore the scenario's own month | — (labelled Simulated) |
| A-19 | Prediction intervals = per-calendar-month validation residual quantiles | Errors are strongly seasonal | Quantile regression (computed coverage shown) |
| A-20 | National forecast = area-weighted mean of division forecasts | Model is per division | National model |
| A-21 | Irrigation advisor: if the configured season is over, sowing/transplanting today is assumed (stated in the output) | Gives a usable estimate any day of the year | Enter the real date |
| A-22 | Starting soil-water depletion = RAW/2 when soil moisture is unavailable; flooded field for rice | Neutral starting point | Field measurement |
| A-23 | Flow network geometry, demand split, minimum service pressures and leak coefficients are hypothetical | No real network data (and no sensors) by design | — (Simulated demonstration) |
| A-24 | Mode A architecture (Next.js + FastAPI + Python ML) | Python runtime available | — |
| A-25 | Development backend runs on port 8001 locally (a Windows socket on 8000 was held by a dead process); configurable via `NEXT_PUBLIC_API_URL` | Environment quirk | Any port |
| A-26 | Vitest pinned to 3.2.4 (Vitest 5 crashed on load in this Node 24 environment) | Tooling compatibility | Upgrade when fixed |
| A-27 | The Copilot uses Anthropic Claude (`LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, default `claude-opus-5-5`, effort `medium`, server-side refusal fallback) with eleven read-only tools over the backend; numbers in an answer that cannot be matched to the tool results are flagged, not rewritten. Without a key it is `not_configured` and answers nothing (decision 3) | Grounding and honesty | Another provider behind `services/copilot.py` |
