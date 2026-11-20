/**
 * Request-level admin checks for /docs (server only): session cookie, role, same-origin POSTs and a best-effort login
 * throttle. The throttle is in memory, so on serverless hosting it only limits attempts per running instance.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasRole, readAdminSecrets, SESSION_COOKIE, SESSION_TTL_S, signSession, verifySession } from "./session";
import type { Role } from "./types";

export async function currentRole(): Promise<Role | null> {
  const secrets = readAdminSecrets();
  if (!secrets) return null;
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, secrets.sessionSecret);
}

export function sessionCookie(role: Role, secret: string) {
  return {
    name: SESSION_COOKIE,
    value: signSession(role, secret),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_S,
  };
}

export function clearedSessionCookie() {
  return { name: SESSION_COOKIE, value: "", httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const, path: "/", maxAge: 0 };
}

/** Browsers send Origin on every POST from fetch(); it must match this site. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

const json = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Guard for admin route handlers. Returns the caller's role, or a ready error response:
 * 503 when admin secrets are not configured, 403 for a cross-site POST, 401 without a valid session, 403 when the
 * role is too low.
 */
export async function requireRole(req: Request, needed: Role): Promise<Role | NextResponse> {
  if (!readAdminSecrets()) return json(503, "The docs admin is not configured on this deployment.");
  if (req.method !== "GET" && !isSameOrigin(req)) return json(403, "Cross-site request refused.");
  const role = await currentRole();
  if (!role) return json(401, "Please sign in again.");
  if (!hasRole(role, needed)) return json(403, "This action needs the Super Admin role.");
  return role;
}

// ------------------------------------------------------------------ login throttle (best effort)

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Seconds to wait before the next attempt, or 0 when allowed. Counts the attempt. */
export function throttleLogin(ip: string, now = Date.now()): number {
  const a = attempts.get(ip);
  if (!a || a.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return 0;
  }
  if (a.count >= MAX_ATTEMPTS) return Math.ceil((a.resetAt - now) / 1000);
  a.count += 1;
  return 0;
}

export function resetLoginThrottle(ip: string): void {
  attempts.delete(ip);
}
