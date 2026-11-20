import { redirect } from "next/navigation";
import { currentRole } from "@/lib/docs/auth";
import { readAdminSecrets } from "@/lib/docs/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "BlueSense Docs — admin sign-in", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await currentRole()) redirect("/docs/admin");
  const configured = readAdminSecrets() !== null;
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="card p-6">
        <h1 className="text-[20px] font-semibold text-ink">Docs admin</h1>
        <p className="mt-1 text-[13.5px] text-muted">Sign in with the Super Admin or Admin password.</p>
        {configured ? (
          <LoginForm />
        ) : (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-[13.5px] text-warning">
            The admin is not configured on this deployment. Set DOCS_SESSION_SECRET and DOCS_SUPERADMIN_PASSWORD (and
            optionally DOCS_ADMIN_PASSWORD) in the project&apos;s environment variables.
          </p>
        )}
      </div>
    </div>
  );
}
