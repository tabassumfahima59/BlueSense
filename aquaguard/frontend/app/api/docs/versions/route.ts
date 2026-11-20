import { NextResponse } from "next/server";
import { requireRole } from "@/lib/docs/auth";
import { listVersions, restoreVersionToDraft } from "@/lib/docs/store";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const role = await requireRole(req, "admin");
  if (role instanceof NextResponse) return role;
  try {
    return NextResponse.json({ versions: await listVersions() }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Could not list versions." }, { status: 502, headers: noStore });
  }
}

/** Restores a published version into the draft (Super Admin). It goes public only after the next publish. */
export async function POST(req: Request) {
  const role = await requireRole(req, "superadmin");
  if (role instanceof NextResponse) return role;
  let id = "";
  try {
    id = String(((await req.json()) as { id?: unknown }).id ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: noStore });
  }
  const draft = await restoreVersionToDraft(id);
  if (!draft) return NextResponse.json({ error: "Version not found." }, { status: 404, headers: noStore });
  return NextResponse.json({ draft }, { headers: noStore });
}
