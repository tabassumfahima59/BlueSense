"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/docs/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/docs/admin");
        router.refresh();
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `Sign-in failed (${res.status}).`);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <label className="block text-[13px] font-medium text-ink">
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-control bg-white px-3 py-2 text-[14px] focus:outline focus:outline-2 focus:outline-primary"
        />
      </label>
      {error && <p role="alert" className="text-[13px] text-risk">{error}</p>}
      <button type="submit" disabled={busy || !password}
              className="w-full rounded-lg bg-primary px-3 py-2 text-[14px] font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-[12px] text-muted">Repeated wrong passwords are slowed down (best effort on serverless hosting).</p>
    </form>
  );
}
