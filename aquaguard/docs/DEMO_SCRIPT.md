# BlueSense extended demo rehearsal (about 7 minutes)

**Predict water risk, protect every drop**

The retrieved CloudCamp checklist calls for a **2-3 minute YouTube video**. Use the [2:45 submission-video plan](CLOUDCAMP_SUBMISSION.md#two-to-three-minute-submission-video). This longer walkthrough is for rehearsal and deeper technical discussion.

Before recording or presenting, open the backend health endpoint, confirm source freshness and load the frontend. Inspect which national statistics and GRACE cells are available. A clean processed-data bootstrap lacks some genuine source-history records; sync and verify them before promising those views. Configure a server-side provider key only if showing generated Copilot answers. Use displayed dates and values rather than memorized figures.

| Time | Screen | Demonstration |
|---|---|---|
| 0:00 | Command Center | Introduce decision support for Bangladesh. Inspect a KPI's sources and dates. Select a division and explain which values remain national and which use representative point weather. |
| 0:45 | Water Rhythm | Switch rainfall anomaly, raw P − ET0 and three-month dryness. Scrub a month, demonstrate playback and explain missing-data gaps. This timeline shows stored history, not forecasts. |
| 1:25 | What-if | Select the dry-year preset. Compare baseline and simulated demand/stress; explain assumptions and seven levers. Applying a scenario affects supported derived modules, not historical records or national reference-year statistics. |
| 2:10 | Water Budget | Show the national view only when genuine AQUASTAT records are available. Explain reference years and unavailable flows. Switch to the derived/model view, demonstrate balance closure and allocation optimization. |
| 3:00 | Prediction Lab | Show one-, three- and six-month climatic water-balance forecasts. Compare held-out metrics against climatology and persistence; show uncertainty and SHAP. State that dry-class detection is weak and intervals under-cover. |
| 3:55 | Water Explorer | Inspect a divisional weather point, switch to history/table and explain district reference boundaries. If GRACE cells are ingested, explain their ~300 km effective resolution. Terrain height is exaggerated and labelled. |
| 4:45 | Water Flow | State that this is a hypothetical conceptual network. Add a leak, change operating controls, optimize pressure and compare delivered flow/leakage. Do not describe it as a real leak detector or infrastructure controller. |
| 5:35 | Irrigation | Select a supported crop, region, soil, area and planting date within the stored forecast's useful range. Explain ET0, Kc, effective rainfall and gross irrigation requirement. Show unavailable inputs when data are missing; advice needs local validation. |
| 6:15 | Copilot | With a configured provider, ask it to explain available data or the scenario; show the tools used. Ask for groundwater depth in a particular well and explain that the dataset cannot answer it. Without credentials, demonstrate the honest not-configured state. |
| 6:50 | Close | Reset the scenario. Point to repository Data Sources, Model Card and Limitations documents. Close with the tagline. |

The former `/data-sources` screen is disabled. Use [DATA_SOURCES.md](DATA_SOURCES.md), [MODEL_CARD.md](MODEL_CARD.md) and [LIMITATIONS.md](LIMITATIONS.md) for supporting evidence. Existing screenshots are historical captures and should be refreshed after final validation if included in a submission.

This extended rehearsal is not the submission video. The complete official knowledge base was read on 17 November 2026; its two-to-three-minute video checklist, original-prompt constraint and eligibility questions are documented in [CLOUDCAMP_SUBMISSION.md](CLOUDCAMP_SUBMISSION.md).
