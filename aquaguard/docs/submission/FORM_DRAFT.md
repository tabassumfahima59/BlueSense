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

The Copilot uses a custom provider-independent tool loop: it validates model-requested tool arguments, invokes allowlisted read-only backend functions, returns tool results and streams the answer within configured call/deadline limits. This is tool orchestration, not evidence of multi-agent execution or a named agent framework.

Character count: **329**; stated minimum: **80**.

Evidence: [copilot.py](../../backend/app/services/copilot.py)

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
  "document_rag_verified": false,
  "custom_mcp_server_verified": false,
  "development_mcp_resource_used": "cloudcamp-bd / cloudcamp://knowledge-base",
  "product_runtime_external_mcp_verified": false,
  "named_agent_frameworks_verified": [],
  "named_ai_dlc_frameworks_verified": [],
  "automation": "APScheduler; not evidence of a named scored automation tool",
  "local_llm_runtimes_verified": [],
  "local_llm_models_run_verified": [],
  "tunneling_verified": false
}
```

Use only demonstrated selections. Proposed supporting links include the published model card, architecture and final evaluation report, once verified at the submitted revision.
