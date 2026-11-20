/**
 * Admin sessions for /docs: an HMAC-SHA256 signed token in an HttpOnly cookie. There are no user accounts in
 * BlueSense, so each role has one password held in a server environment variable.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "./types";

export const SESSION_COOKIE = "bs_docs_admin";
export const SESSION_TTL_S = 8 * 60 * 60;
export const MIN_PASSWORD_LENGTH = 16;
export const MIN_SECRET_LENGTH = 32;

const ROLES: readonly Role[] = ["superadmin", "admin"];

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** Constant-time string comparison (both sides hashed first, so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function signSession(role: Role, secret: string, nowMs = Date.now()): string {
  const payload = b64url(JSON.stringify({ v: 1, r: role, exp: Math.floor(nowMs / 1000) + SESSION_TTL_S }));
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** The role in a valid, unexpired token, else null. Never throws. */
export function verifySession(token: string | undefined | null, secret: string, nowMs = Date.now()): Role | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: number; r?: string; exp?: number };
    if (data.v !== 1 || typeof data.exp !== "number" || data.exp * 1000 <= nowMs) return null;
    return (ROLES as readonly string[]).includes(data.r ?? "") ? (data.r as Role) : null;
  } catch {
    return null;
  }
}

export interface AdminSecrets {
  sessionSecret: string;
  superadminPassword: string;
  adminPassword: string | null;
}

/** Reads and checks the admin secrets. Returns null when the admin area is not configured. */
export function readAdminSecrets(env: Record<string, string | undefined> = process.env): AdminSecrets | null {
  const sessionSecret = env.DOCS_SESSION_SECRET ?? "";
  const superadminPassword = env.DOCS_SUPERADMIN_PASSWORD ?? "";
  const admin = env.DOCS_ADMIN_PASSWORD ?? "";
  if (sessionSecret.length < MIN_SECRET_LENGTH || superadminPassword.length < MIN_PASSWORD_LENGTH) return null;
  return {
    sessionSecret,
    superadminPassword,
    adminPassword: admin.length >= MIN_PASSWORD_LENGTH && admin !== superadminPassword ? admin : null,
  };
}

/** Which role a password unlocks. Both passwords are always compared, so timing does not reveal which matched. */
export function roleForPassword(password: string, secrets: AdminSecrets): Role | null {
  const isSuper = safeEqual(password, secrets.superadminPassword);
  const isAdmin = secrets.adminPassword !== null && safeEqual(password, secrets.adminPassword);
  if (isSuper) return "superadmin";
  if (isAdmin) return "admin";
  return null;
}

export function hasRole(actual: Role | null, needed: Role): boolean {
  if (!actual) return false;
  return needed === "admin" ? true : actual === "superadmin";
}
