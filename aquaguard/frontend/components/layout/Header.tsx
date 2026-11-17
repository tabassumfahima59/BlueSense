"use client";
/**
 * Top bar (glass): welcome + page title, search (Ctrl/Cmd+K), date filter (only on pages that use dates), region
 * selector, scenario chip, and right-aligned refresh and notifications.
 */
import { usePathname } from "next/navigation";
import { FlaskConical, Menu, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline } from "@/lib/store/scenario";
import { SearchButton } from "./CommandPalette";
import { DateFilter } from "./DateFilter";
import { titleFor } from "./nav";
import { Notifications } from "./Notifications";
import { RefreshButton } from "./Refresh";
import { RegionSelector } from "./RegionSelector";
import { MobileDrawer } from "./Sidebar";

export function ScenarioChip() {
  const scenario = useAppStore((s) => s.activeScenario);
  const reset = useAppStore((s) => s.resetScenario);
  if (isBaseline(scenario)) {
    return <span className="hidden rounded-full border border-control/50 px-2.5 py-1 text-[12px] text-muted sm:inline">Baseline</span>;
  }
  return (
    <span className="inline-flex max-w-[230px] items-center gap-1.5 rounded-full border border-dashed border-primary bg-primary-soft px-2.5 py-1 text-[12px] text-primary-dark">
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
  const title = titleFor(pathname);
  return (
    <header className="glass-bar top-0 z-30 flex md:sticky min-h-16 flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2 sm:px-6">
      <button className="rounded-md p-1.5 text-muted hover:bg-light md:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}>
        <Menu size={20} aria-hidden />
      </button>
      <div className="mr-auto min-w-0 leading-tight">
        <p className="text-[11.5px] font-medium text-muted">Welcome to BlueSense</p>
        <p className="truncate text-[16px] font-semibold text-ink">{title}</p>
      </div>
      <SearchButton />
      <DateFilter />
      <RegionSelector />
      <ScenarioChip />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <RefreshButton />
        <Notifications />
      </div>
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
    </header>
  );
}
