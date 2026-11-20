/**
 * Shared request parsing for the /docs admin routes (server only). Kept outside app/api because route files may
 * only export HTTP handlers and route options.
 */
import { NextResponse } from "next/server";
import { readDraft } from "./store";
import type { DocsContent, Role } from "./types";
import { validateContent } from "./validate";

const noStore = { "Cache-Control": "no-store" };

/** Admins may edit text; only a Super Admin may change the team (names, emails, photos). */
export function teamChanged(a: DocsContent, b: DocsContent): boolean {
  return JSON.stringify(a.team) !== JSON.stringify(b.team);
}

/** Reads `{ content }` from the request and validates it; returns the content or an error response. */
export async function parseContent(req: Request, role: Role): Promise<DocsContent | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: noStore });
  }
  const v = validateContent((body as { content?: unknown } | null)?.content);
  if (!v.ok) return NextResponse.json({ error: v.errors.slice(0, 8).join("; ") }, { status: 422, headers: noStore });
  if (role !== "superadmin") {
    const current = await readDraft();
    if (teamChanged(current, v.value)) {
      return NextResponse.json({ error: "Only a Super Admin can change the team." }, { status: 403, headers: noStore });
    }
  }
  return v.value;
}
