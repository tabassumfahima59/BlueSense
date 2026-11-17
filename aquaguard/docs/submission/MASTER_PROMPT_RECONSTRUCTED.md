# BlueSense reconstructed master prompt

**Status: retrospective preparation draft, 17 November 2026. This is not the original prompt, has not been executed as a fresh competition run, and is not proof of one-prompt compliance.**

The eight sections below follow the fetched CloudCamp BD guide. They combine the existing BlueSense design with explicitly requested completion work. Inclusion here does not mean a feature exists. Use this only as reconstruction documentation, or for a fresh run if the organizer explicitly accepts one. Preserve any accepted run's real input, events, approvals and outputs.

## Master prompt begins

Build BlueSense, an AI-powered water decision-support product for Bangladesh, with the tagline **Predict water risk, protect every drop**. Work from the supplied repository and preserve its existing data, working features and compatibility identifiers. Inspect repository instructions before editing. Execute the entire approved specification autonomously, verify real behavior, and produce reviewable artifacts. Never fabricate source observations, performance, user research, execution history, credentials, team facts or integration claims.

This specification is a product/completion brief. Before treating execution as a competition attempt, establish the accepted starting revision and organizer-approved rules. Do not claim that an existing development session used only this prompt. If the event requires a new project from an empty starting state, use an explicitly selected separate directory and preserve the existing repository.

### 1. Core product and AI instructions

Target users are agricultural extension advisers, regional water planners and educators in Bangladesh. The demo persona is a hypothetical extension adviser in Rajshahi comparing rainfall history with crop-water requirements; this is a product-design persona, not an interviewed or paying customer.

Deliver Command Center, Water Rhythm, Water Explorer, Prediction Lab, conceptual Water Flow, Water Budget, What-if, Smart Irrigation, a grounded AI Copilot and settings. Preserve national/eight-division scope. The 64 districts are geographic reference boundaries, not independent hydrological observations. Keep the user journey coherent: choose region, inspect source/date, compare baseline with a simulated dry year, inspect forecast uncertainty, estimate an irrigation requirement and explain the result through grounded tools.

Use Next.js/TypeScript and FastAPI/Pydantic with SQLite and the existing offline ML pipeline unless evidence justifies a migration. Keep Gemini and Anthropic behind the existing provider interface. The Copilot must query validated read-only tools, identify missing data and distinguish historical, predicted, estimated and simulated values. A missing provider key produces an explicit unavailable/configuration state; never substitute canned answers. Offer concise explanations and evidence summaries, not hidden reasoning traces.

### 2. Data architecture

Document schemas, primary keys, units, provenance and retention. Preserve versioned migrations and verified backups; never replace an existing database or overwrite valid source values with nulls. Ingest Open-Meteo, FAO AQUASTAT and CSR GRACE with validation, retry/backoff, idempotency and run logs. Preserve genuine AQUASTAT reference years and distinguish imputation. GRACE is regional terrestrial water storage, not a measured well depth. Source absence must remain unavailable.

Keep water-balance, FAO-56 irrigation, scenario, hydraulic and allocation maths in shared engines. Check mass balance, units and baseline equivalence. Evaluate climatic water-balance forecasts with chronological train/validation/test splits, climatology and persistence baselines, uncertainty coverage and SHAP; publish modest skill and weak dry-class detection honestly.

Completion work: add a useful document-retrieval path over approved methods, model card and source documentation. Define semantic chunk boundaries, chunk-specific context, document/version/source IDs, embedding model, vector-store schema, access controls, rebuild workflow and cited retrieval results. Evaluate relevance, citation correctness and unavailable answers before calling it contextual or semantic RAG. Do not claim Graph RAG unless an actual entity/relation store and retrieval use case are implemented and evaluated. This retrieval system is requested work, not a description of the starting repository.

### 3. Admin module

Completion work: implement administrator and viewer roles with authenticated identity, server-side authorization and least privilege. Provide user management, account disablement, source-sync administration, usage/health analytics and non-secret configuration controls. Prevent public registration from granting administrator privileges. Existing admin-token protected sync alone does not satisfy this module. Keep public decision-support browsing available only where explicitly intended; protect audit and account data.

### 4. Security module

Validate inputs, restrict uploads if introduced, apply rate/concurrency limits, protect state-changing requests appropriately for the chosen authentication mechanism and enforce authorization on the server. Store password hashes if passwords are used, or use a documented identity provider. Do not expose secrets through source, logs or public browser environment variables. Use TLS in hosted deployment and document actual at-rest storage protection and backup handling; do not claim encryption or compliance certification without evidence.

Treat user text, retrieved passages and tool outputs as untrusted data. Keep Copilot tools read-only and allowlisted; prohibit arbitrary SQL and arbitrary network destinations. Retain provider processing disclosures. Identify personal-data boundaries and retention/deletion procedures. Test unauthenticated access, cross-role access, injection attempts, missing credentials, quotas and disconnects.

### 5. Documentation module

Provide the root BlueSense README, architecture/data-flow diagrams, schema guide, API/OpenAPI references, environment template, Windows and Unix setup, migration and backup procedures, source licences, equations, assumptions, limitations, model card and reproducible evaluation instructions. Keep internal compatibility paths documented without presenting an old product identity. Record implemented, unavailable and planned features distinctly. Verify local links and instructions against the final source revision.

### 6. Audit reporting

Record ingestion results and request/tool outcomes with timestamps, source/version, duration and stable error codes. Completion work: collect provider-reported input/output token usage where available and explicitly mark missing usage, rather than inferring exact tokens from characters. Report costs only with a stated price source/date and actual usage. Preserve privacy: no raw keys and no unnecessary sensitive conversation content in logs. Document retention, access and restart behavior of counters.

Produce a requirement-to-evidence report with current test results, source coverage, secret exclusions, accessibility checks, unresolved failures and deployment revision. Build a real read-only MCP server only if included in the accepted scope; document its transport, tools/resources, client/host, permission boundary and reuse. Integrate external MCPs only for useful tasks and retain a real trace. Ordinary REST endpoints or SSE chat alone are not MCP integration.

### 7. Presentation and pitch deck

Prepare a pitch covering the water-planning problem, target user, value proposition, demonstrated workflow, data/AI architecture, limitations, alternatives, pilot plan and a sustainable business-model hypothesis. Do not invent customer counts, market size, revenue, accuracy or impact. Distinguish hypotheses from measured results. Prepare an architecture/design artifact, a two-to-three-minute working-software video script and supporting evidence links. Do not claim that a script is an uploaded video.

Prepare every official form field with truthful text meeting its stated minimum. Use only actual team members and accurate NRB/gender indicators. Do not select tools, frameworks, local models, tunneling or RAG techniques that were not used. Flag conflicting point totals instead of declaring a guaranteed score.

### 8. Deployment requirements

Provide Docker configuration, a reproducible frontend/backend build, actual host environment settings, CORS, health checks, a documented persistence strategy and CI checks for the final revision. Keep secrets server-side. Verify publicly accessible application/repository/design URLs and judge access. Treat keep-warm YAML outside the active workflow directory as a template. If a tunnel is used, document the real host, transport, access boundary and lifetime; ordinary hosting does not establish tunnel usage.

Run backend tests/lint and frontend unit/lint/type/build checks, then appropriate browser/accessibility checks against an isolated database. Investigate missing AQUASTAT history and GRACE grid data without inventing observations or concealing failed checks. Save exact command outcomes and distinguish infrastructure failures from product failures.

Keep execution evidence as it occurs: exact master-prompt bytes/hash, starting revision, actual tool/model information, user approval events, changes and final artifacts. If a dependency or external action needs approval, show the concrete action and wait for the permitted approval. Do not manufacture missing events, change event timestamps or claim a new run repairs past eligibility. At completion, deliver the source, docs, form draft, pitch outline, demo script, evidence manifest and unresolved blockers.

## Master prompt ends

The source guide limits follow-up interactions for its prompt challenge to approval/continuation/deployment triggers. Whether an organizer accepts this reconstruction or a fresh run is still unresolved. This file should remain labelled reconstructed in any submission.
