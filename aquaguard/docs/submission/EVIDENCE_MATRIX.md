# BlueSense submission evidence matrix

**Implemented evidence is distinct from compliance, execution proof and public delivery.** See ../CLOUDCAMP_SUBMISSION.md for the complete source rubric and ambiguous point totals.

| Requirement | Artifact/evidence | Status and next action |
|---|---|---|
| Idea to Unicorn track | Project-owner confirmation | Confirmed; current round/deadline still unresolved |
| Single original master prompt | No original supplied | Missing; reconstruction cannot certify compliance |
| Authentic transcript / approval-only history | TRANSCRIPT_GUIDE.md and empty execution index | Missing; recover genuine export or obtain organizer decision |
| Eight prompt sections | MASTER_PROMPT_RECONSTRUCTED.md | Draft covers all eight; newly written and not executed |
| Core product and user journey | Root README, VIDEO_SCRIPT.md, source modules | Local prototype verified; final public deployment remains unverified |
| Data schemas/pipelines | Migrations, sync adapters, ../DATA_SOURCES.md | Implemented; genuine AQUASTAT/GRACE source coverage incomplete |
| Vector store / contextual or semantic RAG | `backend/app/rag/` (chunking.py, embeddings.py, search.py, docs_index.json, docs_embeddings.npy), `backend/scripts/build_docs_index.py`, Copilot tool `search_docs`, `backend/tests/test_rag.py` | Implemented and tested locally: section-based contextual chunks (32) of METHODS, DATA_SOURCES, MODEL_CARD, LIMITATIONS, ASSUMPTIONS; `gemini-embedding-2` 768-dim index built offline (one batch call) and committed; hybrid cosine + BM25 retrieval with keyword-only fallback; no vector database (NumPy file). Local Copilot run called `search_docs` and cited METHODS.md. Live on the shared link's backend (`blue-sense-32jw-oidp8i5d3`): a methods question called `search_docs` in hybrid mode and cited MODEL_CARD.md sections, and a limitations question through the link's backend address cited LIMITATIONS.md; see "Live backend deployment" below |
| Admin/user management/RBAC | Current admin-token sync and guest interface | Full required admin module not established |
| Authentication/encryption/security | Validation, server-side secrets and rate limits | Partial; full identity, at-rest protection and authorization need evidence |
| Architecture/API/install docs | Root README, ../ARCHITECTURE.md, ../API.md | Prepared; publish final reviewed revision |
| Audit/token usage/compliance | Sync logs, Copilot tool events, ../SUBMISSION_AUDIT.md | Partial; usage limits are not exact provider-token accounting |
| Presentation and market analysis | PITCH_DECK.md | Content draft; market/pilot statements remain hypotheses |
| Deployment/CI/CD | Dockerfile, render.yaml and existing scripts | Config exists; live URL, persistence and active CI require verification |
| YouTube demo | VIDEO_SCRIPT.md | Script prepared; actual 2-3 minute upload missing |
| Public GitHub | Supplied URL, anonymous HTTP 200 and Public marker | Access verified; public About text is stale, local package unpublished |
| Live app | No verified URL supplied | Missing |
| Design/architecture link | ARCHITECTURE_DIAGRAM.mmd and architecture doc | Local design artifact prepared; public viewing URL missing |
| Three additional links | Model card, architecture, final evidence report candidates | Populate only after reviewed files are publicly accessible |
| Team/demographics | No registration facts supplied | Missing; no inference from owner name or username |
| Note-field minimum lengths | submission_form.json and validator | Check exact draft strings; length does not establish feature points |
| Cloud LLM | Gemini/Anthropic adapters, COPILOT_SYSTEM_PROMPT.txt | Configured Gemini completed a live frontend weather question; public deployment remains unverified |
| Agent frameworks/local runtimes/automation selections | Technology disclosures in form JSON | Do not claim absent named tools; custom loop/APScheduler are disclosed accurately |
| Custom/product MCP integration | `bluesense_mcp/` (server.py, requirements.txt), `backend/tests/test_mcp_server.py`, README section "MCP server" | Team-built `bluesense-mcp` implemented and tested locally: official MCP Python SDK (`mcp==2.3.0`), stdio transport, 15 read-only tools (14 Copilot data tools + `search_docs`) reusing `copilot.run_tool`. A local stdio session listed 15 tools and ran `search_docs` and `get_dashboard_kpis`. Runs locally only; not deployed and not called by the product runtime. Use from a named MCP client (Claude Desktop / VS Code) not yet recorded. Development-only CloudCamp resource use remains separate |
| Tunneling | No actual tunnel record | Not verified; ordinary hosting does not qualify as tunneling |

## Live backend deployment

The shared frontend is a Vercel Preview deployment whose build-time `NEXT_PUBLIC_API_URL` is the alias
`bluesense-api-preview-ca2-2uju3.vercel.app`. That alias points to a **Vercel Preview CLI upload** of the backend
(project `blue-sense-32jw`), not to a build from Git. Current deployment: `blue-sense-32jw-oidp8i5d3` (adds the
Phase 2 RAG files to the previous bundle). Rollback target: `blue-sense-32jw-ivg6xhk8g`, the previous working
bundle without RAG (`vercel alias set blue-sense-32jw-ivg6xhk8g-code-alchemist2.vercel.app
bluesense-api-preview-ca2-2uju3.vercel.app --scope code-alchemist2`). The upload is a staged bundle that contains the backend code,
the ML artifacts, a packaged read-only SQLite seed database (`data/preview-seed.db`, about 108 MB, with a SHA-256
file) and a wrapper, `preview_runtime.py`. At start-up the wrapper verifies the seed's checksum and integrity,
copies it to instance-local `/tmp`, and runs the API read-only with migrations, bootstrap and the scheduler
switched off. A copy of the wrapper, taken unchanged from the working deployment, is kept for reference in
`aquaguard/deploy/vercel-preview/preview_runtime.py`; no build uses that folder. The bundle's entry point imports it
before the API (`from preview_runtime import configure; configure()`). The seed database is not in this repository.
Production builds from `main` have no
database and report `degraded`; the alias was removed from the project's production domains, and Git is
disconnected from all three Vercel projects, so pushes to `main` neither deploy nor move it. Runtime settings: `CORS_ORIGINS` (the shared frontend origin, set per deployment), `GEMINI_API_KEY`,
`LLM_MODEL=gemini-3.5-flash-lite`, `LLM_MAX_RETRIES=3`, `LLM_RETRY_BACKOFF_S=2` (project Preview environment).
A new backend version reaches the shared link only by uploading a new bundle and re-pointing the alias.

## Final evidence to capture

For each implemented addition: exact submitted revision, configuration without secrets, real execution trace, expected versus observed behavior and test result. For public artifacts: URL, access mode, verification date and revision/version. Preserve current failure disclosures until a new run supersedes them. A validator or manifest proves local structure/integrity only, not truthful original execution or organizer acceptance.
