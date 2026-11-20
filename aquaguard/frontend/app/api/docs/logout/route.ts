import { NextResponse } from "next/server";
import { clearedSessionCookie, isSameOrigin } from "@/lib/docs/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(clearedSessionCookie());
  return res;
}
