# BlueSense submission form draft

Track: **Idea to Unicorn**. Draft only; missing fields and eligibility remain unresolved. Structured values come from submission_form.json.

Text length does not establish implementation points or organizer acceptance.

## Project Title

BlueSense

Character count: **9**; no numeric minimum stated.

Evidence: [README.md](../../../README.md)

## Tagline / Elevator Pitch

Predict water risk, protect every drop: BlueSense helps Bangladesh water planners and agricultural advisers inspect public data, compare simulated scenarios and understand climatic water-balance predictions.

Character count: **207**; no numeric minimum stated.

Evidence: [README.md](../../../README.md)

## YouTube Video URL

Missing — supply actual evidence.

Evidence: [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md)

## GitHub Repository URL

https://github.com/tabassumfahima59/BlueSense

Character count: **45**; no numeric minimum stated.

Evidence: [evidence_snapshot.json](evidence_snapshot.json)

## Live Demo URL

Missing — supply actual evidence.

## Figma / Design Link

Missing — supply actual evidence.

Evidence: [ARCHITECTURE_DIAGRAM.mmd](ARCHITECTURE_DIAGRAM.mmd), [ARCHITECTURE.md](../ARCHITECTURE.md)

## Other Links

No values supplied.

## Access Note

The current application uses guest browsing and has no end-user accounts. A working public demo URL and deployment access instructions still need verification. Copilot requires a configured server-side provider key; judges should never be asked to enter a private API key in the browser.

Character count: **287**; no numeric minimum stated.

Evidence: [ProfileMenu.tsx](../../frontend/components/layout/ProfileMenu.tsx)

## Team Composition

No values supplied.

## NRB Member Bonus

Missing — supply actual evidence.

## Female Member Bonus

Missing — supply actual evidence.

## Prompt Strategy Text

BlueSense uses a source-grounded Copilot system prompt, validated read-only tools and explicit distinctions between historical data, predictions and simulated scenarios. The original build transcript is unavailable. We provide a retrospective master-prompt reconstruction and Git-backed development record, which do not prove one-prompt compliance. We do not present hidden reasoning traces as submission evidence.

Character count: **414**; no numeric minimum stated.

Evidence: [COPILOT_SYSTEM_PROMPT.txt](COPILOT_SYSTEM_PROMPT.txt), [MASTER_PROMPT_RECONSTRUCTED.md](MASTER_PROMPT_RECONSTRUCTED.md), [DEVELOPMENT_RECORD.md](DEVELOPMENT_RECORD.md)

## Token Optimization Notes

The backend retains at most six history turns, truncates history content to 4,000 characters per turn and rejects tool results above 24,000 characters. Default limits allow four model calls per question and 4,096 output tokens per call. Bounded retries and request deadlines control further usage. These are configured limits, not measured token savings or a verified prompt-cache hit rate.

Character count: **390**; stated minimum: **50**.

Evidence: [copilot.py](../../backend/app/services/copilot.py), [settings.py](../../backend/app/settings.py)

## AI-DLC Process Notes

Development records include an implementation plan, source-controlled modules, API contracts, an ML model card, assumptions, a progress log and a current technical audit. Tests cover calculation engines, data adapters, API behavior, provider errors and frontend behavior. This documents the process actually used; it does not establish adoption of Kiro, BMAD, Spec-Kit or another named AI-DLC framework.

Character count: **403**; stated minimum: **100**.

Evidence: [aquaguard-plan.md](../aquaguard-plan.md), [SUBMISSION_AUDIT.md](../SUBMISSION_AUDIT.md), [MODEL_CARD.md](../MODEL_CARD.md)

## Agent / Orchestration Notes

The Copilot uses a custom provider-independent tool loop: it validates model-requested tool arguments, invokes 15 allowlisted read-only tools and streams the answer within configured call/deadline limits. One tool, search_docs, is hybrid RAG (Gemini embeddings plus BM25) over five project documents. The same tools are exposed by a stdio MCP server. This is tool orchestration, not multi-agent execution or a named agent framework.

Character count: **432**; stated minimum: **80**.

Evidence: [copilot.py](../../backend/app/services/copilot.py), [rag](../../backend/app/rag/), [server.py](../../bluesense_mcp/server.py)

## Fine-Tuning / Adaptation Notes

Adaptation consists of explicit BlueSense system instructions, structured tool schemas and curated public-source inputs. We have no verified LoRA or LLM weight fine-tuning. Separately, Random Forest and XGBoost are trained on chronological climatic water-balance data; that conventional ML training is not LLM fine-tuning.

Character count: **322**; stated minimum: **80**.

Evidence: [COPILOT_SYSTEM_PROMPT.txt](COPILOT_SYSTEM_PROMPT.txt), [MODEL_CARD.md](../MODEL_CARD.md)

## Evaluation & Quality Methods

The stored ML evaluation uses target-date train/validation/test splits, climatology and persistence baselines, MAE/RMSE/R-squared, dryness-class macro-F1 and interval coverage. Automated tests also cover tool validation, provider failures and UI behavior. The current audit still records source-dependent failures and incomplete browser validation; historical passing reports are not final verification.

Character count: **403**; stated minimum: **80**.

Evidence: [MODEL_CARD.md](../MODEL_CARD.md), [SUBMISSION_AUDIT.md](../SUBMISSION_AUDIT.md)

## Guardrails / Safety / Privacy

Tool arguments are schema-validated, extra fields are forbidden and Copilot data access is read-only with no arbitrary SQL tool. The system treats user text and tool results as untrusted, flags unmatched answer numbers, applies usage limits and identifies the configured provider in the Status panel. A missing provider key yields no generated answer. These controls do not guarantee factual correctness or establish a PII-redaction pipeline.

Character count: **442**; stated minimum: **80**.

Evidence: [copilot.py](../../backend/app/services/copilot.py), [ChatUI.tsx](../../frontend/components/copilot/ChatUI.tsx)

## Tunneling Usage Notes

No Cloudflare Tunnel, ngrok or equivalent local-to-public tunnel has been verified for this submission. The repository contains ordinary frontend/backend hosting configuration. We do not claim tunneling points from that configuration or from using an external hosted MCP endpoint.

Character count: **280**; stated minimum: **80**.

Evidence: [render.yaml](../../../render.yaml)

## Data Quality Measures

Source adapters validate formats and values, use idempotent upserts and preserve existing valid data when incoming values are null. Monthly weather aggregation requires complete inputs. Source IDs, retrieval dates, reference years and data kinds distinguish observations from estimates. Genuine national history and GRACE grid-cell coverage remain incomplete in the audited local database.

Character count: **389**; stated minimum: **80**.

Evidence: [DATA_SOURCES.md](../DATA_SOURCES.md), [SUBMISSION_AUDIT.md](../SUBMISSION_AUDIT.md), [sync](../../backend/app/sync/)

## Privacy & Compliance Notes

Provider credentials stay server-side. The configured external AI provider receives submitted questions and looked-up data, as documented in the limitations guide. Tool logs use a hashed client identifier and do not intentionally record raw questions or keys. Source-specific licences apply. Full retention/deletion procedures, identity/RBAC and independent compliance certification are not established by this draft.

Character count: **417**; stated minimum: **80**.

Evidence: [copilot.py](../../backend/app/services/copilot.py), [LIMITATIONS.md](../LIMITATIONS.md)

## Lineage & Observability Notes

Data responses retain source identifiers, observation or reference dates, retrieval times, spatial scope and freshness where applicable. Ingestion runs are logged; Copilot tool events include validated arguments, outcome and duration. We do not claim LangSmith/Phoenix integration or complete provider-token accounting. In-memory usage counters reset when the service restarts.

Character count: **377**; stated minimum: **80**.

Evidence: [copilot.py](../../backend/app/services/copilot.py), [copilot_limits.py](../../backend/app/services/copilot_limits.py), [ARCHITECTURE.md](../ARCHITECTURE.md)

## Technology disclosures

```json
{
  "llm_adapters": [
    "Gemini",
    "Anthropic"
  ],
  "configured_live_provider_verified": true,
  "custom_tool_loop": true,
  "document_rag_verified": true,
  "document_rag": "Copilot tool search_docs (backend/app/rag/). Knowledge base: METHODS, DATA_SOURCES, MODEL_CARD, LIMITATIONS, ASSUMPTIONS. Section-based chunks split at markdown headings (over 1,800 characters split into numbered parts), each prefixed with document title and section path; 32 chunks. Embeddings: gemini-embedding-2, 768 dimensions, built offline with one batchEmbedContents call and committed as docs_index.json plus docs_embeddings.npy; only the query is embedded at run time. Retrieval: hybrid 0.6 x cosine + 0.4 x BM25, top 4; keyword-only BM25 fallback when query embedding fails. No vector database. Verified by backend tests (test_rag.py), a local Copilot run that called search_docs and cited METHODS.md, and live on the shared link's backend (blue-sense-32jw-oidp8i5d3), where answers called search_docs in hybrid mode and cited MODEL_CARD.md and LIMITATIONS.md. On the shared website the Copilot answered \"How is the forecast made?\" citing MODEL_CARD.md > Models (evidence/rag_live.png).",
  "custom_mcp_server_verified": true,
  "custom_mcp_server": "bluesense-mcp (bluesense_mcp/server.py), official MCP Python SDK mcp==2.3.0, stdio transport, 15 read-only tools (the 14 Copilot data tools plus search_docs) that reuse copilot.TOOLS, tool_specs() and run_tool(). Local only; not deployed. Verified by test_mcp_server.py (in-memory client) and a local stdio session that listed 15 tools and called search_docs and get_dashboard_kpis. Not used by the product runtime.",
  "custom_mcp_server_clients_verified": "Used from two MCP clients: Claude Code in VS Code called search_docs and get_dashboard_kpis (evidence/mcp_vscode.png), and the Claude Desktop app (Code mode) called search_docs and answered from MODEL_CARD.md (evidence/mcp_claude_desktop.png).",
  "development_mcp_resource_used": "cloudcamp-bd / cloudcamp://knowledge-base",
  "development_usage_tracking": "CodeBurn MCP (local stdio) used during development to track Claude Code token usage and cost for this project (evidence/codeburn.png). Development tooling only; not product-runtime Gemini accounting.",
  "product_runtime_external_mcp_verified": false,
  "named_agent_frameworks_verified": [],
  "named_ai_dlc_frameworks_verified": [],
  "automation_verified": true,
  "automation": "n8n Cloud workflow \"BlueSense daily water-risk digest\" (aquaguard/deploy/n8n/bluesense_daily_digest.json): Schedule Trigger 08:00 Asia/Dhaka, HTTP Request GET /api/dashboard/summary, HTTP Request POST /api/copilot/stream, Code (joins the streamed answer and key KPIs), Gmail send. A test run on 2026-11-20 succeeded and sent the email (evidence/n8n_run.png, n8n_gmail_node.png, n8n_email.png with the sender redacted); the workflow is published to run daily (evidence/n8n_published.png). Backend data ingestion is scheduled separately with APScheduler.",
  "local_llm_runtimes_verified": [],
  "local_llm_models_run_verified": [],
  "tunneling_verified": false,
  "live_backend_deployment": "The shared frontend calls the alias bluesense-api-preview-ca2-2uju3.vercel.app, which points to a Vercel Preview CLI upload of the backend, currently blue-sense-32jw-oidp8i5d3 (rollback target: blue-sense-32jw-ivg6xhk8g, the previous bundle without RAG): a bundle with the backend code, ML artifacts, a packaged read-only SQLite seed database (about 108 MB) and preview_runtime.py, which verifies the seed and runs the API read-only. The seed is not in the repository; a reference copy of the wrapper is in aquaguard/deploy/vercel-preview/ (used by no build). Builds from main have no database, and Git is disconnected from the Vercel projects. Details: EVIDENCE_MATRIX.md, section Live backend deployment."
}
```

Use only demonstrated selections. Proposed supporting links include the published model card, architecture and final evaluation report, once verified at the submitted revision.
