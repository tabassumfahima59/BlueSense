/**
 * Types for the live /docs module: the published content (pitch deck + technical docs), its visibility schedule
 * and the admin roles. Content and config are stored as JSON (Vercel Blob in production, local files in dev).
 */

export type Role = "superadmin" | "admin";

export type SectionGroup = "pitch" | "technical";

/** "markdown" sections render only their body; the other kinds add a live or structured block under the body. */
export type SectionKind =
  | "markdown"
  | "team"
  | "live"
  | "features"
  | "architecture"
  | "dataflow"
  | "api"
  | "analytics"
  | "changelog";

export interface DocSection {
  id: string;
  slug: string;
  title: string;
  group: SectionGroup;
  kind: SectionKind;
  order: number;
  visible: boolean;
  body: string; // Markdown (rendered without raw HTML)
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  fullName: string;
  role: string;
  email: string;
  showEmail: boolean;
  /** Set when a photo has been uploaded; changes on every upload so browsers fetch the new image. */
  photoVersion?: string;
}

export type FeatureStatus = "current" | "upcoming" | "planned";

/** Which live backend response proves a feature is running. */
export type LiveCheck = "health" | "copilot" | "rag" | "metrics" | "sources";

export interface Feature {
  name: string;
  status: FeatureStatus;
  area: string;
  evidence: string;
  liveCheck: LiveCheck | null;
}

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  notes: string;
}

export interface DocsLinks {
  liveApp: string;
  repo: string;
  video: string;
  design: string;
}

export interface DocsContent {
  schemaVersion: 1;
  title: string;
  tagline: string;
  summary: string;
  links: DocsLinks;
  sections: DocSection[];
  team: { name: string; members: TeamMember[] };
  diagrams: { architecture: string; dataflow: string };
  features: Feature[];
  changelog: ChangelogEntry[];
  updatedAt: string;
}

export type VisibilityMode = "always" | "window" | "duration";

export interface DocsConfig {
  enabled: boolean;
  mode: VisibilityMode;
  startUtc: string | null;
  endUtc: string | null;
  durationHours: number | null;
  timezone: "Asia/Dhaka";
  updatedAt: string;
  updatedBy: string;
}

export type VisibilityReason = "disabled" | "always" | "before-window" | "in-window" | "after-window" | "invalid";

export interface Visibility {
  visible: boolean;
  reason: VisibilityReason;
  opensAt?: string;
  closesAt?: string;
}

export interface VersionInfo {
  id: string; // file name without extension, e.g. 2026-11-20T08-15-00-000Z
  savedAt: string;
}
