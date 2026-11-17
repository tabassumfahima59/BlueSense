# BlueSense pitch deck outline

Track: Idea to Unicorn. Nine-slide content draft with presenter notes, not a rendered or published slide deck. **Predict water risk, protect every drop.**

## Slide 1 - BlueSense

Water intelligence for Bangladesh: bring public data, climatic water-balance forecasts and scenario exploration into one decision-support workspace.

Presenter: Introduce the product and its scope. It is software decision support, not infrastructure control or a water-safety certification system.

## Slide 2 - The user problem

An agricultural extension adviser needs to compare historical weather, crop-water estimates and uncertain future conditions. Working across separate datasets makes it harder to understand dates, spatial resolution and modelling assumptions.

Presenter: This is a proposed user problem and hypothetical demo persona. Do not describe it as validated customer research or quantify prevalence without evidence.

## Slide 3 - One useful workflow

Choose Rajshahi, inspect rainfall/water balance, compare a dry-year scenario, inspect forecast uncertainty and estimate irrigation needs. Keep the source and date beside the conclusion.

Presenter: Show one functioning flow from the actual demo environment. Report unavailable inputs honestly.

## Slide 4 - Product demonstration

Command Center and Water Rhythm explain history. What-if and Water Budget compare derived scenarios. Prediction Lab shows baselines and uncertainty. Copilot looks up backend evidence with read-only tools. Irrigation converts assumptions into an estimated requirement.

Presenter: Keep the conceptual Water Flow clearly labelled if shown. Do not imply physical leak detection.

## Slide 5 - AI and data architecture

Next.js -> FastAPI -> SQLite and shared engines, fed by validated public-source ingestion and stored ML artifacts. Cloud LLM adapters support the grounded Copilot tool loop. See ARCHITECTURE_DIAGRAM.mmd and the source-level architecture document.

Presenter: Document-RAG, a product MCP server, local LLMs and named agent frameworks are not verified components. Include them in a future-work slide only until implemented.

## Slide 6 - Evidence and limits

The stored one-month selected-model RMSE is 118.542 mm versus climatology 125.791 mm. Improvement is modest, dry-class detection is weak and nominal 90% intervals under-cover. GRACE is regional total storage, not well depth; weather uses representative points. Current source-data/test blockers are disclosed in the audit.

Presenter: Cite ../MODEL_CARD.md. These are committed evaluation results, not a new run or proof of operational drought accuracy.

## Slide 7 - Market and business-model hypotheses

Initial pilot candidates: agricultural advisory teams, water-planning groups and educational institutions. Test whether source transparency and scenario comparisons improve the planning workflow. Explore institutional support/training and hosted-service models only within source/provider licence terms.

Presenter: No revenue, customer count, TAM or procurement approval is established. Gather interviews and pilot consent before making commercial claims; some inputs have non-commercial restrictions.

## Slide 8 - Pilot plan and alternatives

Proposed pilot: observe one current planning workflow, identify a supported decision, run a side-by-side prototype exercise and gather usability/source-comprehension feedback. Compare against separate source portals, spreadsheets and specialist tools without unverified competitive claims.

Presenter: Proposed measures include task completion, time to find the relevant source/date, understanding of uncertainty and error reports. These are proposed measurements, not results already achieved.

## Slide 9 - Readiness and ask

Ask for a small, supervised pilot and feedback on decision usefulness. Before competition submission: resolve original-prompt/deadline eligibility, complete applicable admin/security/audit requirements, repair source coverage and verification, then publish the exact evaluated revision and demo.

Presenter: Share the actual public repository. Add verified live/video/design links only when available. Close with the tagline.
