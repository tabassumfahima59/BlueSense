import { describe, expect, it } from "vitest";
import { buildSearchIndex, markdownToText, searchDocs, toMarkdown } from "../lib/docs/markdown";
import { SEED_CONTENT } from "../lib/docs/seed";
import { hasRole, readAdminSecrets, roleForPassword, safeEqual, signSession, verifySession } from "../lib/docs/session";
import type { DocsConfig, DocsContent } from "../lib/docs/types";
import { validateConfig, validateContent } from "../lib/docs/validate";
import { DEFAULT_CONFIG, dhakaLocalToUtc, isDocsVisible, utcToDhakaLocal } from "../lib/docs/visibility";

const cfg = (p: Partial<DocsConfig>): DocsConfig => ({ ...DEFAULT_CONFIG, ...p });
const at = (iso: string) => new Date(iso);

describe("docs visibility", () => {
  it("OFF is closed, ON without a window is public", () => {
    expect(isDocsVisible(cfg({ enabled: false }))).toMatchObject({ visible: false, reason: "disabled" });
    expect(isDocsVisible(cfg({ enabled: true, mode: "always" }))).toMatchObject({ visible: true, reason: "always" });
  });

  it("a window is public only between start and end (both inclusive)", () => {
    const c = cfg({ mode: "window", startUtc: "2026-11-21T00:00:00.000Z", endUtc: "2026-11-25T17:59:00.000Z" });
    expect(isDocsVisible(c, at("2026-11-20T23:59:59Z"))).toMatchObject({ visible: false, reason: "before-window", opensAt: "2026-11-21T00:00:00.000Z" });
    expect(isDocsVisible(c, at("2026-11-21T00:00:00Z")).visible).toBe(true);
    expect(isDocsVisible(c, at("2026-11-25T17:59:00Z")).visible).toBe(true);
    expect(isDocsVisible(c, at("2026-11-25T17:59:01Z"))).toMatchObject({ visible: false, reason: "after-window" });
  });

  it("duration counts from the start", () => {
    const c = cfg({ mode: "duration", startUtc: "2026-11-21T00:00:00.000Z", durationHours: 48 });
    expect(isDocsVisible(c, at("2026-11-22T23:00:00Z")).visible).toBe(true);
    expect(isDocsVisible(c, at("2026-11-23T00:00:01Z")).visible).toBe(false);
  });

  it("an incomplete or reversed schedule closes the page", () => {
    expect(isDocsVisible(cfg({ mode: "window", startUtc: null, endUtc: null })).reason).toBe("invalid");
    expect(isDocsVisible(cfg({ mode: "window", startUtc: "2026-11-25T00:00:00Z", endUtc: "2026-11-21T00:00:00Z" })).visible).toBe(false);
    expect(isDocsVisible(cfg({ mode: "duration", startUtc: "2026-11-21T00:00:00Z", durationHours: -1 })).reason).toBe("invalid");
    expect(isDocsVisible(cfg({ mode: "window", startUtc: "not a date", endUtc: "2026-11-21T00:00:00Z" })).reason).toBe("invalid");
  });

  it("converts Dhaka local time (UTC+6) both ways", () => {
    expect(dhakaLocalToUtc("2026-06-10T00:00")).toBe("2026-06-09T18:00:00.000Z");
    expect(utcToDhakaLocal("2026-06-09T18:00:00.000Z")).toBe("2026-06-10T00:00");
    expect(dhakaLocalToUtc("10/06/2026")).toBeNull();
  });
});

describe("docs content", () => {
  it("the seed content is valid and covers every organiser section", () => {
    const v = validateContent(SEED_CONTENT);
    expect(v.ok).toBe(true);
    const slugs = SEED_CONTENT.sections.map((s) => s.slug);
    for (const s of ["problem", "solution", "why-now", "demo", "market", "business-model", "traction", "competition",
      "advantage", "go-to-market", "team", "vision", "overview", "features", "architecture", "data-flow", "stack", "api",
      "data-layer", "ai-layer", "roadmap", "performance", "security", "analytics", "contributors", "changelog"]) {
      expect(slugs).toContain(s);
    }
    expect(SEED_CONTENT.team.members).toEqual([]); // no invented team members
    expect(JSON.stringify(SEED_CONTENT)).not.toMatch(/eleven read-only tools/i);
  });

  it("rejects bad slugs, duplicate ids, bad emails and non-https links", () => {
    const bad = structuredClone(SEED_CONTENT) as DocsContent;
    bad.sections[1].slug = "Not A Slug";
    bad.sections[2].id = bad.sections[0].id;
    bad.team.members = [{ id: "m1", fullName: "A", role: "", email: "not-an-email", showEmail: true }];
    bad.links.repo = "javascript:alert(1)";
    const v = validateContent(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const all = v.errors.join(" | ");
      expect(all).toMatch(/slug/);
      expect(all).toMatch(/duplicate section id/);
      expect(all).toMatch(/email/);
      expect(all).toMatch(/links.repo/);
    }
  });

  it("validates the visibility config", () => {
    expect(validateConfig({ enabled: true, mode: "window", startUtc: "2026-11-21T00:00:00Z" }).ok).toBe(false);
    expect(validateConfig({ enabled: true, mode: "duration", startUtc: "2026-11-21T00:00:00Z", durationHours: 120 }).ok).toBe(true);
    expect(validateConfig({ enabled: false, mode: "always" }).ok).toBe(true);
  });

  it("exports Markdown and searches section text", () => {
    const md = toMarkdown(SEED_CONTENT, new Date("2026-11-20T00:00:00Z"));
    expect(md).toMatch(/^# BlueSense/);
    expect(md).toContain("### Problem");
    expect(md).toContain("```mermaid");
    expect(markdownToText("**Bold** and [a link](https://x.y) `code`")).toBe("Bold and a link code");
    const hits = searchDocs(buildSearchIndex(SEED_CONTENT), "random forest");
    expect(hits.length).toBeGreaterThan(0);
    expect(searchDocs(buildSearchIndex(SEED_CONTENT), "x")).toEqual([]);
  });
});

describe("docs admin session", () => {
  const secret = "s".repeat(40);

  it("signs and verifies a session, and rejects tampering and expiry", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const token = signSession("admin", secret, now);
    expect(verifySession(token, secret, now + 1000)).toBe("admin");
    expect(verifySession(token, "x".repeat(40), now)).toBeNull();
    expect(verifySession(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), secret, now)).toBeNull();
    expect(verifySession(token, secret, now + 9 * 3600 * 1000)).toBeNull();
    expect(verifySession("garbage", secret, now)).toBeNull();
  });

  it("maps passwords to roles and requires strong secrets", () => {
    expect(readAdminSecrets({ DOCS_SESSION_SECRET: "short", DOCS_SUPERADMIN_PASSWORD: "p".repeat(16) })).toBeNull();
    const s = readAdminSecrets({ DOCS_SESSION_SECRET: secret, DOCS_SUPERADMIN_PASSWORD: "super-password-123", DOCS_ADMIN_PASSWORD: "admin-password-1234" });
    expect(s).not.toBeNull();
    if (!s) return;
    expect(roleForPassword("super-password-123", s)).toBe("superadmin");
    expect(roleForPassword("admin-password-1234", s)).toBe("admin");
    expect(roleForPassword("wrong", s)).toBeNull();
    expect(hasRole("superadmin", "admin")).toBe(true);
    expect(hasRole("admin", "superadmin")).toBe(false);
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
  });
});
