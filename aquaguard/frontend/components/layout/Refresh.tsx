"use client";
/**
 * Manual refresh (POST /api/refresh) and the stale-data banner. Refresh never replaces the scheduler: the server
 * re-runs only the Open-Meteo jobs whose data is not fresh, answers "Already up to date" otherwise and allows one run
 * per 10 minutes. After a run every mounted view refetches.
 */
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api/client";
import { clearApiCache, useApi } from "@/lib/api/useApi";
import { fmtAgo } from "@/lib/format/time";
import { useAppStore } from "@/lib/store";

export function useRefresh() {
  const [busy, setBusy] = useState(false);
  const bump = useAppStore((s) => s.bumpData);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.refresh();
      const tone = r.data.result === "failed" ? "error" : r.data.result === "partial" ? "info" : "success";
      toast(r.data.message, tone);
      if (r.data.result !== "up_to_date") {
        clearApiCache();
        bump();
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "refresh_throttled") {
        toast(`A refresh ran recently. Try again in about ${Math.max(1, Math.ceil((err.retryAfter ?? 600) / 60))} min.`, "info");
      } else {
        toast(err.message || "The refresh failed; the last valid data is kept.", "error");
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function RefreshButton() {
  const { busy, run } = useRefresh();
  return (
    <button type="button" onClick={run} disabled={busy} aria-busy={busy}
            aria-label={busy ? "Refreshing weather data" : "Refresh weather data"} title="Refresh weather data (Open-Meteo)"
            className="inline-flex items-center rounded-lg p-1.5 text-muted transition hover:bg-light hover:text-ink disabled:opacity-60">
      <RefreshCw size={17} aria-hidden className={busy ? "animate-spin" : ""} />
    </button>
  );
}

const SESSION_KEY = "aquaguard.staleBanner.dismissed";

export function StaleBanner() {
  const version = useAppStore((s) => s.dataVersion);
  const lu = useApi(`last-updated|${version}`, api.lastUpdated);
  const { busy, run } = useRefresh();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });
  const d = lu.data?.data;
  if (dismissed || !d || d.overallStatus === "fresh") return null;
  const behind = d.sources.filter((s) => s.status !== "fresh");
  const weatherBehind = behind.some((s) => s.id.startsWith("openmeteo"));
  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-[#fff6e6] px-4 py-2 text-[12.5px] text-[#5c3d00] sm:px-6">
      <AlertTriangle size={15} aria-hidden className="shrink-0 text-warning" />
      <span className="flex-1">
        <strong className="font-semibold">Some data is not current.</strong>{" "}
        {behind.map((s) => `${s.name}: ${s.status.replace("_", " ")} (last successful sync ${fmtAgo(s.lastSuccessAt ?? s.retrievedAt)})`).join(" · ")}.
        {" "}The last valid values are shown with their original dates.
      </span>
      {weatherBehind && (
        <button type="button" onClick={run} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-warning/60 bg-white px-2 py-1 font-medium text-[#5c3d00] transition hover:bg-[#fff1d6] disabled:opacity-60">
          <RefreshCw size={13} aria-hidden className={busy ? "animate-spin" : ""} /> Refresh weather
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss for this session" className="rounded p-1 transition hover:bg-[#fff1d6]">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
