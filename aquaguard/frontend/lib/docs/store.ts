/**
 * Storage for /docs (server only).
 *
 * - "blob": a private Vercel Blob store connected to the frontend project (production). The SDK authenticates with
 *   the project's OIDC token or BLOB_READ_WRITE_TOKEN.
 * - "local": JSON files in aquaguard/frontend/.docs-data/ (development; git-ignored).
 *
 * DOCS_STORAGE=blob|local chooses explicitly; otherwise Vercel deployments use "blob" and everything else "local".
 *
 * Objects: docs/config.json, docs/draft.json, docs/published.json, docs/versions/<time>.json (last 30 kept) and
 * docs/team/<member-id>.webp.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { SEED_CONTENT } from "./seed";
import type { DocsConfig, DocsContent, VersionInfo } from "./types";
import { validateConfig, validateContent } from "./validate";
import { DEFAULT_CONFIG } from "./visibility";

export const DOCS_TAG = "bluesense-docs";
const CONFIG = "docs/config.json";
const DRAFT = "docs/draft.json";
const PUBLISHED = "docs/published.json";
const VERSIONS = "docs/versions/";
const KEEP_VERSIONS = 30;

export type StorageMode = "blob" | "local";

export function storageMode(): StorageMode {
  const m = process.env.DOCS_STORAGE;
  if (m === "blob" || m === "local") return m;
  return process.env.VERCEL ? "blob" : "local";
}

const LOCAL_DIR = path.join(process.cwd(), ".docs-data");

function localPath(pathname: string): string {
  const p = path.resolve(LOCAL_DIR, pathname);
  if (!p.startsWith(LOCAL_DIR + path.sep)) throw new Error("Invalid storage path");
  return p;
}

function isNotFound(e: unknown, blobModule?: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; status?: number; message?: string };
  if (err.code === "ENOENT" || err.status === 404) return true;
  const cls = (blobModule as Record<string, unknown> | undefined)?.BlobNotFoundError;
  if (typeof cls === "function" && e instanceof (cls as new (...args: never[]) => Error)) return true;
  // A missing blob, never a missing or misconfigured store (that must surface as an error).
  const msg = err.message ?? "";
  return /requested blob does not exist|blob not found/i.test(msg) && !/store/i.test(msg);
}

async function readBytes(pathname: string): Promise<{ bytes: ArrayBuffer; contentType: string | null } | null> {
  if (storageMode() === "local") {
    try {
      const buf = await fs.readFile(localPath(pathname));
      return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType: null };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  const blob = await import("@vercel/blob");
  try {
    const res = await blob.get(pathname, { access: "private", useCache: false });
    if (!res || !res.stream) return null;
    const bytes = await new Response(res.stream as ReadableStream).arrayBuffer();
    return { bytes, contentType: res.blob?.contentType ?? null };
  } catch (e) {
    if (isNotFound(e, blob)) return null;
    throw e;
  }
}

async function readJson(pathname: string): Promise<unknown | null> {
  const r = await readBytes(pathname);
  if (!r) return null;
  return JSON.parse(new TextDecoder().decode(r.bytes));
}

async function write(pathname: string, body: string | Buffer, contentType: string): Promise<void> {
  if (storageMode() === "local") {
    const p = localPath(pathname);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    return;
  }
  const { put } = await import("@vercel/blob");
  await put(pathname, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
}

const writeJson = (pathname: string, data: unknown) =>
  write(pathname, JSON.stringify(data, null, 1), "application/json; charset=utf-8");

async function listVersionPaths(): Promise<{ pathname: string; url?: string }[]> {
  if (storageMode() === "local") {
    try {
      const names = await fs.readdir(path.join(LOCAL_DIR, "docs", "versions"));
      return names.filter((n) => n.endsWith(".json")).map((n) => ({ pathname: VERSIONS + n }));
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }
  const { list } = await import("@vercel/blob");
  const out: { pathname: string; url?: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: VERSIONS, limit: 1000, cursor });
    out.push(...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function remove(entry: { pathname: string; url?: string }): Promise<void> {
  if (storageMode() === "local") {
    await fs.rm(localPath(entry.pathname), { force: true });
    return;
  }
  const { del } = await import("@vercel/blob");
  await del(entry.url ?? entry.pathname);
}

// ------------------------------------------------------------------ reads (uncached, for admins)

export async function readConfig(): Promise<DocsConfig> {
  const raw = await readJson(CONFIG);
  if (raw === null) return DEFAULT_CONFIG;
  const v = validateConfig(raw);
  return v.ok ? v.value : { ...DEFAULT_CONFIG, enabled: false, updatedBy: "invalid-stored-config" };
}

export async function readPublished(): Promise<DocsContent | null> {
  const raw = await readJson(PUBLISHED);
  if (raw === null) return null;
  const v = validateContent(raw);
  return v.ok ? v.value : null;
}

export async function readDraft(): Promise<DocsContent> {
  const raw = await readJson(DRAFT);
  if (raw !== null) {
    const v = validateContent(raw);
    if (v.ok) return v.value;
  }
  return (await readPublished()) ?? SEED_CONTENT;
}

// ------------------------------------------------------------------ cached reads (public page)

/** Config for the public page. A stored config that cannot be read closes the page rather than opening it. */
export const getPublicConfig = unstable_cache(
  async (): Promise<DocsConfig> => {
    try {
      return await readConfig();
    } catch {
      return { ...DEFAULT_CONFIG, enabled: false, updatedBy: "storage-unavailable" };
    }
  },
  ["bluesense-docs-config"],
  { tags: [DOCS_TAG], revalidate: 60 },
);

/** Published content for the public page; the seed when nothing is published yet or storage is unreachable. */
export const getPublicContent = unstable_cache(
  async (): Promise<{ content: DocsContent; source: "published" | "seed" }> => {
    try {
      const p = await readPublished();
      if (p) return { content: p, source: "published" };
    } catch {
      /* fall back to the seed */
    }
    return { content: SEED_CONTENT, source: "seed" };
  },
  ["bluesense-docs-published"],
  { tags: [DOCS_TAG], revalidate: 300 },
);

function refreshPublicPage(): void {
  revalidateTag(DOCS_TAG);
  revalidatePath("/docs");
}

// ------------------------------------------------------------------ writes (admins)

export async function saveConfig(config: DocsConfig): Promise<void> {
  await writeJson(CONFIG, config);
  refreshPublicPage();
}

export async function saveDraft(content: DocsContent): Promise<void> {
  await writeJson(DRAFT, content);
}

const versionId = (d: Date) => d.toISOString().replace(/[:.]/g, "-");
const VERSION_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export async function publish(content: DocsContent): Promise<VersionInfo> {
  const now = new Date();
  const stamped: DocsContent = { ...content, updatedAt: now.toISOString() };
  await writeJson(DRAFT, stamped);
  await writeJson(PUBLISHED, stamped);
  const id = versionId(now);
  await writeJson(`${VERSIONS}${id}.json`, stamped);
  refreshPublicPage();
  try {
    const all = (await listVersionPaths()).sort((a, b) => a.pathname.localeCompare(b.pathname));
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_VERSIONS))) await remove(old);
  } catch {
    /* pruning is best-effort */
  }
  return { id, savedAt: now.toISOString() };
}

export async function listVersions(): Promise<VersionInfo[]> {
  const all = await listVersionPaths();
  return all
    .map((e) => e.pathname.slice(VERSIONS.length).replace(/\.json$/, ""))
    .filter((id) => VERSION_ID.test(id))
    .sort()
    .reverse()
    .map((id) => {
      const iso = id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z");
      return { id, savedAt: iso };
    });
}

/** Loads a published version into the draft (it becomes public only after the next publish). */
export async function restoreVersionToDraft(id: string): Promise<DocsContent | null> {
  if (!VERSION_ID.test(id)) return null;
  const raw = await readJson(`${VERSIONS}${id}.json`);
  if (raw === null) return null;
  const v = validateContent(raw);
  if (!v.ok) return null;
  await writeJson(DRAFT, v.value);
  return v.value;
}

// ------------------------------------------------------------------ team photos

const MEMBER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function saveTeamPhoto(memberId: string, webp: Buffer): Promise<void> {
  if (!MEMBER_ID.test(memberId)) throw new Error("Invalid member id");
  await write(`docs/team/${memberId}.webp`, webp, "image/webp");
}

export async function readTeamPhoto(memberId: string): Promise<ArrayBuffer | null> {
  if (!MEMBER_ID.test(memberId)) return null;
  const r = await readBytes(`docs/team/${memberId}.webp`);
  return r ? r.bytes : null;
}
