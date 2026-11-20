import { NextResponse } from "next/server";
import { requireRole } from "@/lib/docs/auth";
import { saveTeamPhoto } from "@/lib/docs/store";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const MAX_BYTES = 1024 * 1024; // the browser uploads a 512×512 WebP, normally well under 100 KB

function isWebp(b: Buffer): boolean {
  return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
}

/** Super Admin uploads a member photo (already cropped and resized to 512×512 WebP in the browser). */
export async function POST(req: Request) {
  const role = await requireRole(req, "superadmin");
  if (role instanceof NextResponse) return role;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a form upload." }, { status: 400, headers: noStore });
  }
  const memberId = String(form.get("memberId") ?? "");
  const file = form.get("file");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(memberId)) return NextResponse.json({ error: "Invalid member id." }, { status: 422, headers: noStore });
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No image received." }, { status: 422, headers: noStore });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The image is too large (max 1 MB after resizing)." }, { status: 413, headers: noStore });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isWebp(bytes)) return NextResponse.json({ error: "The image must be WebP (the admin panel converts it)." }, { status: 415, headers: noStore });
  try {
    await saveTeamPhoto(memberId, bytes);
  } catch {
    return NextResponse.json({ error: "Could not save the photo. Check the Blob store connection." }, { status: 502, headers: noStore });
  }
  return NextResponse.json({ ok: true, photoVersion: String(Date.now()) }, { headers: noStore });
}
