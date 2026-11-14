"use client";
/**
 * Map assistant: the existing Copilot (provider-independent, read-only tools, no canned answers) with the current
 * map selection sent as validated app context and region-specific suggested questions. Without a server key it
 * shows "not configured" like the Copilot page.
 */
import { ChatUI } from "@/components/copilot/ChatUI";
import type { MapSelection } from "@/lib/explorer/store";
import type { CopilotMapContext } from "@/lib/types/contract";

const SAFE = /[^A-Za-z0-9 .,'&()°/\-–]/g;

export function mapContext(sel: MapSelection | null, regionName: string): CopilotMapContext {
  if (!sel) return { page: "explorer", kind: "national", name: regionName.replace(SAFE, "").slice(0, 80) || "Bangladesh" };
  return { page: "explorer", kind: sel.kind, name: sel.name.replace(SAFE, "").slice(0, 80) || sel.kind };
}

export function suggestionsFor(sel: MapSelection | null, divisionName: string | null): string[] {
  const place = divisionName ?? "Bangladesh";
  if (sel?.kind === "district") {
    return [`What information is unavailable for ${sel.name} district?`, `What is the current data status of ${place} Division?`,
            `Why does ${place} have its estimated risk classification?`, "Which data sources support this analysis?"];
  }
  if (sel?.kind === "grace_cell") {
    return ["What does the latest GRACE anomaly indicate?", "Why can GRACE not show a single division?",
            "How has national water storage changed since 2002?", "Which data sources support this analysis?"];
  }
  if (sel?.kind === "river" || sel?.kind === "water") {
    return [`What data does AquaGuard have about ${sel.name}?`, "How has historical surface-water occurrence changed?",
            "Which division has the highest estimated scarcity risk?", "Which data sources support this analysis?"];
  }
  if (divisionName) {
    return [`What is the current data status of ${place} Division?`, `Why does ${place} have its estimated risk classification?`,
            `Explain the historical rainfall trend in ${place} in simple language.`, `Compare rainfall in ${place} and Rajshahi.`,
            "Which data sources support this analysis?"];
  }
  return ["Which division has the highest estimated scarcity risk?", "What does the latest GRACE anomaly indicate?",
          "Compare rainfall between Sylhet and Rajshahi.", "How did rainfall in 2016-2025 compare with 1991-2000?",
          "Which data sources support this analysis?"];
}

export function MapAssistant({ sel, region, regionName, divisionName, idPrefix }: {
  sel: MapSelection | null;
  region: string;
  regionName: string;
  divisionName: string | null;
  idPrefix: string;
}) {
  return (
    <div className="flex h-[440px] min-h-0 flex-col rounded-xl border border-border bg-white" data-testid="map-assistant">
      <div className="border-b border-border px-3 py-2 text-[12px] text-muted">
        Context sent with your question: <span className="font-medium text-ink">{sel ? sel.name : regionName}</span>.
        Answers use AquaGuard&apos;s read-only data tools; districts have no water data.
      </div>
      <div className="min-h-0 flex-1">
        <ChatUI compact idPrefix={idPrefix} region={region} context={mapContext(sel, regionName)}
                suggestions={suggestionsFor(sel, divisionName)}
                intro={`Ask about ${sel ? sel.name : regionName}: data status, rainfall and temperature history, estimated risk, GRACE, sources and limitations.`} />
      </div>
    </div>
  );
}
