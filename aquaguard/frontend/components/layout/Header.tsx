"use client";
import { usePathname } from "next/navigation";
import { Bot, FlaskConical, Menu, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline } from "@/lib/store/scenario";
import { ProvenanceLegend } from "../ui/Provenance";
import { titleFor } from "./nav";
import { RegionSelector } from "./RegionSelector";
import { MobileDrawer } from "./Sidebar";

export function ScenarioChip() {
  const scenario = useAppStore((s) => s.activeScenario);
  const reset = useAppStore((s) => s.resetScenario);
  if (isBaseline(scenario)) {
    return <span className="hidden rounded-full border border-border px-2.5 py-1 text-[12px] text-muted sm:inline">Baseline</span>;
  }
  return (
    <span className="inline-flex max-w-[230px] items-center gap-1.5 rounded-full border border-dashed border-primary bg-primary-soft px-2.5 py-1 text-[12px] text-primary">
      <FlaskConical size={13} aria-hidden />
      <span className="truncate" title={describeScenario(scenario)}>
        Scenario active: {describeScenario(scenario)}
      </span>
      <button onClick={reset} className="ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 hover:bg-white" aria-label="Reset scenario to baseline">
        <RotateCcw size={12} aria-hidden /> Reset
      </button>
    </span>
  );
}

export function Header() {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const setCopilotOpen = useAppStore((s) => s.setCopilotOpen);
  const title = titleFor(pathname);
  return (
    <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-white/95 px-4 py-2 backdrop-blur sm:px-6">
      <button className="rounded-md p-1.5 text-muted hover:bg-bg md:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}>
        <Menu size={20} />
      </button>
      <div className="mr-auto text-[16px] font-semibold text-ink">{title}</div>
      <ProvenanceLegend />
      <RegionSelector />
      <ScenarioChip />
      {!pathname.startsWith("/copilot") && (
        <button
          onClick={() => setCopilotOpen(true)}
          aria-label="Open AquaGuard Copilot"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-dark"
        >
          <Bot size={15} aria-hidden /> <span className="hidden 2xl:inline">Copilot</span>
        </button>
      )}
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
    </header>
  );
}
