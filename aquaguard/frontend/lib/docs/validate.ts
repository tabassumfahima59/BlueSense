/**
 * Server-side validation of everything an admin can save. Pure functions: they return a cleaned copy or a list of
 * errors, and never throw on bad input.
 */
import type {
  ChangelogEntry, DocsConfig, DocsContent, DocSection, Feature, FeatureStatus, LiveCheck, SectionGroup, SectionKind,
  TeamMember, VisibilityMode,
} from "./types";
import { MAX_DURATION_HOURS } from "./visibility";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const LIMITS = {
  sections: 60,
  title: 120,
  body: 50_000,
  summary: 2_000,
  tagline: 200,
  members: 24,
  memberText: 80,
  email: 254,
  diagram: 10_000,
  features: 60,
  featureText: 200,
  changelog: 100,
  changelogNotes: 1_000,
  url: 500,
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const GROUPS: readonly SectionGroup[] = ["pitch", "technical"];
const KINDS: readonly SectionKind[] = [
  "markdown", "team", "live", "features", "architecture", "dataflow", "api", "analytics", "changelog",
];
const STATUSES: readonly FeatureStatus[] = ["current", "upcoming", "planned"];
const CHECKS: readonly LiveCheck[] = ["health", "copilot", "rag", "metrics", "sources"];
const MODES: readonly VisibilityMode[] = ["always", "window", "duration"];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function str(x: unknown, field: string, max: number, errors: string[], { allowEmpty = true } = {}): string {
  if (typeof x !== "string") {
    errors.push(`${field} must be text`);
    return "";
  }
  const v = x.replace(/\r\n/g, "\n");
  if (v.length > max) errors.push(`${field} is too long (max ${max} characters)`);
  if (!allowEmpty && !v.trim()) errors.push(`${field} must not be empty`);
  return v;
}

function oneOf<T extends string>(x: unknown, allowed: readonly T[], field: string, errors: string[]): T {
  if (typeof x === "string" && (allowed as readonly string[]).includes(x)) return x as T;
  errors.push(`${field} must be one of: ${allowed.join(", ")}`);
  return allowed[0];
}

/** "" or an absolute https URL. */
export function isHttpsUrlOrEmpty(v: string): boolean {
  if (v === "") return true;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

export function isEmail(v: string): boolean {
  return v.length <= LIMITS.email && EMAIL.test(v);
}

function validSection(x: unknown, i: number, errors: string[]): DocSection {
  const f = `sections[${i}]`;
  const s = isObj(x) ? x : {};
  if (!isObj(x)) errors.push(`${f} must be an object`);
  const id = str(s.id, `${f}.id`, 64, errors);
  if (id && !ID.test(id)) errors.push(`${f}.id has invalid characters`);
  const slug = str(s.slug, `${f}.slug`, 64, errors);
  if (!SLUG.test(slug)) errors.push(`${f}.slug must be lowercase letters, digits and hyphens`);
  const order = typeof s.order === "number" && Number.isFinite(s.order) ? s.order : i + 1;
  return {
    id,
    slug,
    title: str(s.title, `${f}.title`, LIMITS.title, errors, { allowEmpty: false }),
    group: oneOf(s.group, GROUPS, `${f}.group`, errors),
    kind: oneOf(s.kind, KINDS, `${f}.kind`, errors),
    order,
    visible: s.visible !== false,
    body: str(s.body ?? "", `${f}.body`, LIMITS.body, errors),
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date(0).toISOString(),
  };
}

function validMember(x: unknown, i: number, errors: string[]): TeamMember {
  const f = `team.members[${i}]`;
  const m = isObj(x) ? x : {};
  if (!isObj(x)) errors.push(`${f} must be an object`);
  const id = str(m.id, `${f}.id`, 64, errors);
  if (!ID.test(id)) errors.push(`${f}.id has invalid characters`);
  const email = str(m.email ?? "", `${f}.email`, LIMITS.email, errors).trim();
  if (email && !isEmail(email)) errors.push(`${f}.email is not a valid email address`);
  const member: TeamMember = {
    id,
    fullName: str(m.fullName, `${f}.fullName`, LIMITS.memberText, errors, { allowEmpty: false }).trim(),
    role: str(m.role ?? "", `${f}.role`, LIMITS.memberText, errors).trim(),
    email,
    showEmail: m.showEmail === true,
  };
  if (typeof m.photoVersion === "string" && /^[0-9]{1,16}$/.test(m.photoVersion)) member.photoVersion = m.photoVersion;
  return member;
}

function validFeature(x: unknown, i: number, errors: string[]): Feature {
  const f = `features[${i}]`;
  const o = isObj(x) ? x : {};
  return {
    name: str(o.name, `${f}.name`, LIMITS.featureText, errors, { allowEmpty: false }),
    status: oneOf(o.status, STATUSES, `${f}.status`, errors),
    area: str(o.area ?? "", `${f}.area`, LIMITS.featureText, errors),
    evidence: str(o.evidence ?? "", `${f}.evidence`, LIMITS.featureText, errors),
    liveCheck: o.liveCheck === null || o.liveCheck === undefined ? null : oneOf(o.liveCheck, CHECKS, `${f}.liveCheck`, errors),
  };
}

function validChange(x: unknown, i: number, errors: string[]): ChangelogEntry {
  const f = `changelog[${i}]`;
  const o = isObj(x) ? x : {};
  const date = str(o.date, `${f}.date`, 10, errors);
  if (!DATE.test(date)) errors.push(`${f}.date must be YYYY-MM-DD`);
  return {
    version: str(o.version, `${f}.version`, 32, errors, { allowEmpty: false }),
    date,
    notes: str(o.notes, `${f}.notes`, LIMITS.changelogNotes, errors, { allowEmpty: false }),
  };
}

function arr(x: unknown, field: string, max: number, errors: string[]): unknown[] {
  if (!Array.isArray(x)) {
    errors.push(`${field} must be a list`);
    return [];
  }
  if (x.length > max) errors.push(`${field} has too many items (max ${max})`);
  return x.slice(0, max);
}

export function validateContent(input: unknown): Result<DocsContent> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["content must be an object"] };
  const links = isObj(input.links) ? input.links : {};
  const cleanLinks = {
    liveApp: str(links.liveApp ?? "", "links.liveApp", LIMITS.url, errors).trim(),
    repo: str(links.repo ?? "", "links.repo", LIMITS.url, errors).trim(),
    video: str(links.video ?? "", "links.video", LIMITS.url, errors).trim(),
    design: str(links.design ?? "", "links.design", LIMITS.url, errors).trim(),
  };
  for (const [k, v] of Object.entries(cleanLinks)) {
    if (!isHttpsUrlOrEmpty(v)) errors.push(`links.${k} must be an https:// URL or empty`);
  }
  const sections = arr(input.sections, "sections", LIMITS.sections, errors).map((s, i) => validSection(s, i, errors));
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const s of sections) {
    if (ids.has(s.id)) errors.push(`duplicate section id "${s.id}"`);
    if (slugs.has(s.slug)) errors.push(`duplicate section slug "${s.slug}"`);
    ids.add(s.id);
    slugs.add(s.slug);
  }
  const team = isObj(input.team) ? input.team : {};
  const members = arr(team.members ?? [], "team.members", LIMITS.members, errors).map((m, i) => validMember(m, i, errors));
  const memberIds = new Set<string>();
  for (const m of members) {
    if (memberIds.has(m.id)) errors.push(`duplicate team member id "${m.id}"`);
    memberIds.add(m.id);
  }
  const diagrams = isObj(input.diagrams) ? input.diagrams : {};
  const content: DocsContent = {
    schemaVersion: 1,
    title: str(input.title, "title", LIMITS.title, errors, { allowEmpty: false }),
    tagline: str(input.tagline ?? "", "tagline", LIMITS.tagline, errors),
    summary: str(input.summary ?? "", "summary", LIMITS.summary, errors),
    links: cleanLinks,
    sections: [...sections].sort((a, b) => a.order - b.order).map((s, i) => ({ ...s, order: i + 1 })),
    team: { name: str(team.name ?? "", "team.name", LIMITS.memberText, errors).trim(), members },
    diagrams: {
      architecture: str(diagrams.architecture ?? "", "diagrams.architecture", LIMITS.diagram, errors),
      dataflow: str(diagrams.dataflow ?? "", "diagrams.dataflow", LIMITS.diagram, errors),
    },
    features: arr(input.features ?? [], "features", LIMITS.features, errors).map((x, i) => validFeature(x, i, errors)),
    changelog: arr(input.changelog ?? [], "changelog", LIMITS.changelog, errors).map((x, i) => validChange(x, i, errors)),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString(),
  };
  if (input.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  return errors.length ? { ok: false, errors } : { ok: true, value: content };
}

export function validateConfig(input: unknown): Result<DocsConfig> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["config must be an object"] };
  const mode = oneOf(input.mode, MODES, "mode", errors);
  const time = (x: unknown, field: string): string | null => {
    if (x === null || x === undefined || x === "") return null;
    if (typeof x !== "string" || !Number.isFinite(Date.parse(x))) {
      errors.push(`${field} must be a date-time`);
      return null;
    }
    return new Date(Date.parse(x)).toISOString();
  };
  const startUtc = time(input.startUtc, "startUtc");
  const endUtc = time(input.endUtc, "endUtc");
  let durationHours: number | null = null;
  if (input.durationHours !== null && input.durationHours !== undefined && input.durationHours !== "") {
    const h = Number(input.durationHours);
    if (!Number.isFinite(h) || h <= 0 || h > MAX_DURATION_HOURS) errors.push(`durationHours must be between 0 and ${MAX_DURATION_HOURS}`);
    else durationHours = h;
  }
  if (mode === "window") {
    if (!startUtc || !endUtc) errors.push("A time window needs both a start and an end");
    else if (Date.parse(endUtc) <= Date.parse(startUtc)) errors.push("The end must be after the start");
  }
  if (mode === "duration" && (!startUtc || durationHours === null)) errors.push("Duration mode needs a start and a duration");
  const config: DocsConfig = {
    enabled: input.enabled === true,
    mode,
    startUtc,
    endUtc,
    durationHours,
    timezone: "Asia/Dhaka",
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString(),
    updatedBy: typeof input.updatedBy === "string" ? input.updatedBy.slice(0, 32) : "unknown",
  };
  return errors.length ? { ok: false, errors } : { ok: true, value: config };
}
