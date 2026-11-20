import { NextResponse } from "next/server";
import { clientIp, isSameOrigin, resetLoginThrottle, sessionCookie, throttleLogin } from "@/lib/docs/auth";
import { readAdminSecrets, roleForPassword } from "@/lib/docs/session";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const secrets = readAdminSecrets();
  if (!secrets) return NextResponse.json({ error: "The docs admin is not configured on this deployment." }, { status: 503, headers: noStore });
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403, headers: noStore });
  const ip = clientIp(req);
  const wait = throttleLogin(ip);
  if (wait > 0) {
    return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` },
      { status: 429, headers: { ...noStore, "Retry-After": String(wait) } });
  }
  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  }
  const role = roleForPassword(password, secrets);
  if (!role) return NextResponse.json({ error: "Wrong password." }, { status: 401, headers: noStore });
  resetLoginThrottle(ip);
  const res = NextResponse.json({ role }, { headers: noStore });
  res.cookies.set(sessionCookie(role, secrets.sessionSecret));
  return res;
}
