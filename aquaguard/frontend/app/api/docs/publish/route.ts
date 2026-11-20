import { NextResponse } from "next/server";
import { requireRole } from "@/lib/docs/auth";
import { publish } from "@/lib/docs/store";
import { parseContent } from "@/lib/docs/request";

export const dynamic = "force-dynamic";

/** Saves the posted content as the draft and the published version, and keeps a snapshot in the version history. */
export async function POST(req: Request) {
  const role = await requireRole(req, "admin");
  if (role instanceof NextResponse) return role;
  const content = await parseContent(req, role);
  if (content instanceof NextResponse) return content;
  try {
    const version = await publish(content);
    return NextResponse.json({ ok: true, version }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not publish. Check the Blob store connection." }, { status: 502 });
  }
}
