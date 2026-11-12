"use client";
import { Info } from "lucide-react";
import { api, API_MODE } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";

/** Shown when the backend serves the frozen sample snapshot (database/live APIs unavailable) or in mock mode. */
export function SampleBanner() {
  const h = useApi("health", api.health);
  const sample = API_MODE === "mock" || h.data?.sampleMode;
  if (!sample) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning/40 bg-[#fdf6e7] px-4 py-1.5 text-[12.5px] text-[#6b4a07] sm:px-6">
      <Info size={14} aria-hidden />
      {API_MODE === "mock"
        ? "Mock mode: showing captured sample responses (NEXT_PUBLIC_API_MODE=mock). Values are tagged 'Sample'."
        : "Sample data: live data or the database is unavailable, so a frozen snapshot of the real datasets is shown. Values are tagged 'Sample'."}
    </div>
  );
}
