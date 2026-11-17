# BlueSense — CloudCamp BD submission alignment

Status: **eligibility and completeness unresolved; no full-mark certification**.

## Official source and connection result

Read in full on **17 November 2026**, from the `cloudcamp-bd` MCP resource `cloudcamp://knowledge-base`, named `get_knowledge_base`, titled *International AI Builders Congress 2026: Master Knowledge Base & Submission Guide*. This document is the rule source for the plan below. Implementation decisions and gap assessments are identified separately.

A fresh direct MCP initialization succeeded over HTTP POST with `Accept: application/json, text/event-stream`. The server identified itself as `cloudcamp-mcp` version `1.29.0`, negotiated protocol `2024-11-05`, returned no tools, one knowledge-base resource and no prompts. The built-in MCP client's resource calls still timed out. This establishes direct resource access; it does not claim that the app-managed connection was restarted or repaired.

The complete resource payload is retained locally under the Git-ignored `.cache/` directory as JSON, HTML and extracted text. Source text: 32,022 characters; SHA-256 `c54e4789a320ef8380b4cac1fcf73403edd8bd359baeb5e995e8ff792b2fec20`. No HTML scripts were executed.

## Eligibility gates — resolve before further implementation

1. **Deadline:** the resource states **31 October 2026, 11:59 PM GMT+6**, with submission through `cloudcampbd.com`. This precedes the retrieval date. An extension or later round is not established by this resource; obtain the applicable organizer announcement.
2. **Track:** the project owner confirmed **Idea to Unicorn**. The resource applies the one-prompt constraint to this track. The applicable current round and deadline remain unconfirmed.
3. **Original execution evidence:** one comprehensive master prompt must generate or initialize architecture, modules, documentation and deployment. Subsequent interaction is limited to approval/continuation/deployment triggers. The present conversation includes substantive development requests; it cannot be represented as an approval-only execution record. A newly written prompt cannot retroactively establish compliant history. Preserve the actual original prompt/transcript and ask the organizer how subsequent development affects eligibility.
4. **Team:** supply actual registered members and any eligible diversity markers. Do not invent members or demographic status to obtain points.

These are event/eligibility questions, not requests for permission to perform routine repository maintenance. Code verification resumed after source retrieval; see [the current technical audit](SUBMISSION_AUDIT.md) for final results.

The owner supplied `https://github.com/tabassumfahima59/BlueSense` and stated that the original transcript is not saved in the repository. Anonymous access to the repository returned HTTP 200 with a Public marker on 17 November 2026; its public About description still needs BlueSense correction. A [submission package](submission/README.md) now contains all 22 form-field drafts, a clearly labelled reconstructed master prompt, the code-derived runtime prompt, an evidence record, transcript-recovery guidance, a pitch outline and video script. These prepared artifacts are local and do not prove original execution or public publication.

## All eight required master-prompt sections

| Required section | BlueSense evidence / current gap | Required work if applicable |
|---|---|---|
| Core product and AI instructions | Modules and scientific limits documented; original master prompt and demo persona unverified | Recover original prompt; name target users and one precise end-to-end user journey |
| Data architecture | SQLite schemas, source ingestion, provenance and ML artifacts exist; no vector store/RAG verified | Document current schemas; implement and demonstrate retrieval only if pursuing the corresponding rubric criteria |
| Admin module | Admin-token protected sync exists; UI is guest mode, with no verified user-management/RBAC module | Build actual admin/user/role workflows if required by the registered track; an admin token alone is not RBAC |
| Security module | Validation, rate limits and server-side secrets exist; no verified full user-authentication/encryption design | Specify authentication, authorization, transport/storage protection and vulnerability boundaries with evidence |
| Documentation module | Root README, architecture, methods, API, model card and setup exist | Keep instructions reproducible and cross-check live behavior |
| Audit reporting | Sync logs and Copilot tool events exist; complete token-accounting/compliance evidence unverified | Add or verify request-level usage accounting, audit retention and an evidence report |
| Presentation and pitch deck | Technical demo script exists; actual pitch deck/market evidence unverified | Prepare problem, user, value proposition, market assumptions, architecture, demo and limitations slides |
| Deployment requirements | Docker and Render blueprint exist; public deployment and active CI/CD unverified | Verify live frontend/API, CORS, secrets, persistence, CI and judge access |

The original-prompt requirement concerns what actually happened, not merely whether these sections appear in a new file.

## Complete submission-field checklist

The following points and minima are copied in substance from the knowledge base. A blank status means evidence is still needed; length alone does not establish truthful completion.

| Form field | Required format / minimum | Points stated | BlueSense action |
|---|---|---|---|
| Project Title | Required string | — | `BlueSense` |
| Tagline / Elevator Pitch | Required concise sentence | — | Brand tagline: `Predict water risk, protect every drop`; describe water decision support in the elevator pitch |
| YouTube Video URL | Valid YouTube URL | 10 | Record and upload the **2–3 minute** working-software demo |
| GitHub Repository URL | Valid public GitHub URL | 2 | Verify public access and the exact submitted source revision |
| Live Demo URL | Public URL | 1 | Verify unauthenticated judge access or supply appropriate access instructions |
| Figma / Design Link | URL to mockups, wireframes or architecture diagrams | 1 | Publish a real design/architecture artifact and verify viewing access |
| Other Links | Up to three URLs | 1 each, max 3 | Provide useful evidence, e.g. model card, architecture and evaluation report |
| Access Note | Optional text | — | Explain actual judge access; do not publish private credentials |
| Team Composition | One to five registered members | 1 each, max 5 | Confirm real registration |
| NRB Member Bonus | At least one actual NRB member | 1 | Claim only if true |
| Female Member Bonus | At least one actual female member | 1 | Claim only if true |
| Prompt Strategy Text | Tiered description; no numeric minimum specified | 5 | Describe actual prompts, tool selection, constraints and concise decision summaries; attach original-prompt evidence |
| Token Optimization Notes | At least 50 characters | 3 | Describe implemented history pruning, output/tool caps and retry budgets; do not claim unimplemented caching/routing |
| AI-DLC Process Notes | At least 100 characters | 3–4 | Document the actual specification/implementation/evaluation process and tools used |
| Agent / Orchestration Notes | At least 80 characters | 2 | Explain existing tool loop accurately; do not call it multi-agent orchestration without implementation evidence |
| Fine-Tuning / Adaptation Notes | At least 80 characters | 2 | Explain actual system instructions or dataset curation; do not claim LoRA or LLM fine-tuning |
| Evaluation & Quality Methods | At least 80 characters | 3 | Cite held-out ML metrics, baselines, grounding/contract tests and current failures |
| Guardrails / Safety / Privacy | At least 80 characters | 3 | Describe validation, tool permissions, unavailable-data behavior and provider disclosure; distinguish missing PII filtering |
| Tunneling Usage Notes | At least 80 characters | 2 | Supply an actual tunnel, transport, duration and access boundary if used; otherwise state not used |
| Data Quality Measures | At least 80 characters | 2 | Explain validated schemas, null handling, idempotent upserts and complete-month requirements |
| Privacy & Compliance Notes | At least 80 characters | 2–3 | Explain external processing, secrets, logs, retention and dataset licences without unsupported certification claims |
| Lineage & Observability Notes | At least 80 characters | 2 | Describe source IDs/dates, sync-run logs and Copilot tool events; do not claim telemetry products not used |

Minimum lengths apply to the actual portal text values. The guide gives ranges rather than exact criteria for some text-field maxima; ask the organizer for the live evaluator rules before assigning an exact score.

## Complete detailed scoring inventory

| Scoring item | Points/cap stated by source | Current evidence and gap |
|---|---|---|
| At least one listed LLM | 5 | Gemini and Anthropic adapters exist; verify the configured provider actually works |
| RAG selections: Naive, vector DB, contextual, semantic chunking, late interaction, Graph RAG | 1 each, max 5 | No implemented document-RAG pipeline verified. Backend tool lookups are not automatically these techniques |
| Contextual RAG bonus | 5 | Not verified; requires chunk-specific context prepended before embedding |
| Variable/semantic chunking bonus | 3 | Not verified; requires semantic-boundary chunking |
| Contextual + variable-chunking combination | 3 | Requires both real implementations |
| Graph RAG / knowledge graph bonus | 5 | Not verified; requires actual entity/relation retrieval and multi-hop use |
| Frontend AI tools | 1 each, max 5 | Eligible list: Lovable, v0, Bolt.new, Cursor, Claude Artifacts, Gemini Canvas, ChatGPT Canvas. Actual usage evidence needed; Codex alone is not explicitly listed |
| Automation tools | 1 each, max 4 | Eligible list: n8n, Zapier, Make, Airflow, Temporal, Dagster, Prefect, LangGraph, Windmill, Activepieces. Existing APScheduler does not establish a named-tool selection |
| n8n bonus | 2 | No verified n8n workflow |
| Local LLM runtimes | 1 each, max 3 | Eligible list: Ollama, LM Studio, vLLM, llama.cpp, Apple MLX, GPT4All, TGI, TensorRT-LLM. None verified |
| Ollama bonus | 2 | No verified local runtime |
| Local models run | 2 each, max 8 | Actual local inference evidence required; cloud model calls and Random Forest/XGBoost do not count as local LLM runs |
| Agent frameworks | 1 each, max 5 | Eligible list: Hermes, OpenClaw, LangGraph, CrewAI, AutoGen, OpenAI Swarm, OpenAI Agents SDK, Letta. Custom Copilot tool loop alone does not establish framework usage |
| AI-DLC frameworks | 1 each, max 3 | Eligible list: AWS Kiro, AWS AI-DLC, BMAD-METHOD, Spec-Kit, Cursor Rules, Cline Memory Bank. Actual adoption unverified |
| Team-built MCP servers | 1 each, max 3 | BlueSense REST API is not an MCP server; no team-built MCP server verified |
| External MCP servers integrated | 1 each, max 3 | CloudCamp resource was accessed for planning. Ask whether development-time use qualifies; it is not a BlueSense runtime integration |
| MCP transports, client/host disclosure and reuse notes | 6 | Document an actual implementation and its permission boundaries; SSE used by Copilot chat alone is not MCP |
| Publishing local environment via tunnel | 4 | No real Cloudflare/ngrok tunnel evidence verified; ordinary Render/Vercel hosting is not tunneling |

The source recommends combining cloud LLMs, actual local execution, structured retrieval and agentic orchestration, with local hardware and quantization disclosures. It separately recommends building at least one custom MCP server, integrating at least one external MCP server, using Streamable HTTP/SSE or stdio and documenting host/client permissions.

### Scoring ambiguities to preserve

- The category summary says Links & Deliverables max **15**, while its field rows add to **17** (10 + 2 + 1 + 1 + 3). Do not silently choose one.
- Summary categories list AI stack **110+**, data lifecycle **25**, MCP **20+** and environment/tunneling **6**, without an exhaustive additive formula matching every detailed row.
- Some note fields use **3–4** or **2–3** points without defining the top tier.
- Tunneling appears as both a two-point notes field and a four-point scoring item; overlap is unspecified.
- Text/selection points are preliminary automated scoring. Despite the source's promotional wording, they do not establish a guaranteed final judging result.

Therefore there is no defensible single numeric maximum or verified current score from this resource alone. Track completion and evidence per criterion rather than inventing a total.

## Data-lifecycle evidence required

| Official stage | BlueSense evidence | Remaining work |
|---|---|---|
| Sources/acquisition | Public-source adapters and registry | Verify genuine national history and GRACE cells in the submitted deployment |
| Parsing/processing | JSON/CSV/NetCDF parsing, typed validation and monthly aggregation | Make the submitted environment reproducible without dependence on a developer's private database |
| Cleaning/enrichment | Null preservation, idempotency, complete-month checks and provenance | Document what is deliberately not imputed; add retrieval enrichment only when implemented |
| Storage | SQLite relational store and artifacts | Do not claim PostgreSQL, vector storage or S3. Implement needed stores for actual new features, with schema/migration evidence |
| Analytics/delivery | Dashboards, REST API and read-only Copilot tools | Verify demo paths; automated reports/webhooks are not yet established |

## Ordered implementation and submission plan

1. **Establish eligibility and original evidence.** Confirm track/round/deadline, original master prompt, allowed post-prompt work and actual registered team. This comes before adding rubric-driven features.
2. **Stabilize existing BlueSense.** Resolve unavailable AQUASTAT/GRACE data and reproducibility; keep estimates, reference years and missing-data behavior honest. Fix tests without inventing measurements or weakening assertions to hide gaps.
3. **Complete mandatory modules for the applicable track.** If the eight-module rule applies, implement missing authentication/RBAC/admin, auditable token accounting and the presentation/deployment artifacts. Document actual behavior.
4. **Build a useful retrieval path.** Proposed: retrieve cited Methods, Model Card and Data Sources passages using semantic chunks with chunk context and embeddings. Demonstrate retrieval relevance, citations and refusal on unsupported questions. This is a design proposal, not current functionality. Add Graph RAG only with a real entity/relation use case and evaluation.
5. **Expose real MCP capabilities.** Proposed: a read-only BlueSense MCP server for source status, regional indicators and scenario results, with validated arguments and documented transport/client/host boundaries. Integrate an external MCP only where its data/tool supports the user journey; capture a real trace.
6. **Add scored tools only through demonstrated work.** Candidate uses include one workflow for reproducible source QA/reporting, one agent framework for retrieve/check/respond and one local runtime for a bounded offline task. Claim each named runtime/tool/model only after actual execution. Maximum framework/tool counts are not themselves an architecture requirement.
7. **Prepare public artifacts.** Verify repository, live app, design/architecture URL and supporting links. Produce a 2–3 minute YouTube video with clear audio and actual working behavior. Keep the longer rehearsal separate.
8. **Audit portal fields and evidence.** Check character minima, actual selections, URLs/access and team facts against the live form. Record unresolved score ambiguities and organizer answers. Then resume technical checks and record the final source revision and test results.

## Two-to-three-minute submission video

Target **2 minutes 45 seconds**; this follows the resource's submission checklist. The seven-minute walkthrough is a rehearsal only.

| Time | Show | Message |
|---|---|---|
| 0:00–0:15 | BlueSense + Command Center | State the Bangladesh water-planning problem, target user and tagline |
| 0:15–0:45 | A region + Water Rhythm | Inspect real stored weather history, source/date and one risk indicator; explain the spatial scope |
| 0:45–1:15 | What-if + derived Water Budget | Change rainfall/efficiency and compare simulated results; demonstrate balance and allocation |
| 1:15–1:45 | Prediction Lab + Copilot | Compare the prediction with baseline/uncertainty and show a grounded answer with tools/citations only when configured |
| 1:45–2:10 | Irrigation or conceptual Water Flow | Complete one useful action and clearly label estimates/simulation |
| 2:10–2:35 | Architecture + evidence | Show the actual AI/data/MCP components, public repo and live app; include only implemented integrations |
| 2:35–2:45 | Limitations + value | State key scientific limits and close with the tagline |

No recording, upload, public publication, team registration or portal submission has been performed by this audit.
