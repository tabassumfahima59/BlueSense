/**
 * Initial /docs content, written from facts in this repository (model card, AQUASTAT and GRACE data, the evidence
 * matrix and the git log). It is shown until an admin publishes edited content, and whenever storage cannot be read.
 */
import seedJson from "./seed.json";
import type { DocsContent } from "./types";

export const SEED_CONTENT = seedJson as unknown as DocsContent;
