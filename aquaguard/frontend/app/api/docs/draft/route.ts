import { NextResponse } from "next/server";
import { requireRole } from "@/lib/docs/auth";
import { readDraft, saveDraft } from "@/lib/docs/store";
import { parseContent } from "@/lib/docs/request";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const role = await requireRole(req, "admin");
  if (role instanceof NextResponse) return role;
  return NextResponse.json({ draft: await readDraft() }, { headers: noStore });
}

export async function POST(req: Request) {
  const role = await requireRole(req, "admin");
  if (role instanceof NextResponse) return role;
  const content = await parseContent(req, role);
  if (content instanceof NextResponse) return content;
  try {
    await saveDraft(content);
  } catch {
    return NextResponse.json({ error: "Could not save to storage. Check the Blob store connection." }, { status: 502, headers: noStore });
  }
  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() }, { headers: noStore });
}
