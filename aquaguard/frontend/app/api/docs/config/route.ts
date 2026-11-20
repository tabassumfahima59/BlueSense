import { NextResponse } from "next/server";
import { requireRole } from "@/lib/docs/auth";
import { readConfig, saveConfig } from "@/lib/docs/store";
import { validateConfig } from "@/lib/docs/validate";
import { isDocsVisible } from "@/lib/docs/visibility";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const role = await requireRole(req, "admin");
  if (role instanceof NextResponse) return role;
  const config = await readConfig();
  return NextResponse.json({ config, visibility: isDocsVisible(config) }, { headers: noStore });
}

/** Visibility and schedule: Super Admin only. */
export async function POST(req: Request) {
  const role = await requireRole(req, "superadmin");
  if (role instanceof NextResponse) return role;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: noStore });
  }
  const input = typeof body === "object" && body !== null ? body : {};
  const v = validateConfig({ ...input, updatedAt: new Date().toISOString(), updatedBy: role });
  if (!v.ok) return NextResponse.json({ error: v.errors.join("; ") }, { status: 422, headers: noStore });
  try {
    await saveConfig(v.value);
  } catch {
    return NextResponse.json({ error: "Could not save to storage. Check the Blob store connection." }, { status: 502, headers: noStore });
  }
  return NextResponse.json({ config: v.value, visibility: isDocsVisible(v.value) }, { headers: noStore });
}
