"use client";
/**
 * Top bar (glass): welcome + page title, search (Ctrl/Cmd+K), date filter (only on pages that use dates), region
 * selector, scenario chip, manual refresh, notifications, data-label legend, Copilot and the profile menu.
 */
import { usePathname } from "next/navigation";
import { Bot, FlaskConical, Info, Menu, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DATA_KIND_LABEL } from "@/components/ui/DataStatus";
import { Popover } from "@/components/ui/Popover";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline } from "@/lib/store/scenario";
import type { DataKind } from "@/lib/types/contract";
import { ProvenanceLegend } from "../ui/Provenance";
import { SearchButton } from "./CommandPalette";
import { DateFilter } from "./DateFilter";
import { titleFor } from "./nav";
import { Notifications } from "./Notifications";
import { ProfileMenu } from "./ProfileMenu";
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

const KIND_HELP: [DataKind, string][] = [
  ["model_current", "Open-Meteo weather-model estimate of current conditions (not a station reading)"],
  ["forecast", "Open-Meteo forecast"],
  ["reanalysis", "ERA5 / ERA5-Land archive via Open-Meteo"],
  ["satellite_monthly", "GRACE/GRACE-FO total water storage anomaly (~300 km)"],
  ["statistic", "FAO AQUASTAT national statistic with its reference year"],
  ["derived", "AquaGuard calculation from the above"],
  ["prediction", "Machine-learning output"],
  ["scenario", "What-if result"],
  ["conceptual", "Illustration without measured values"],
];

function DataLabels() {
  return (
    <Popover label="What the data labels mean" panelLabel="Data labels" width="w-[340px]" trigger={<Info size={18} aria-hidden />}>
      {() => (
        <div className="space-y-3 p-2 text-[12.5px]">
          <div>
            <p className="mb-1.5 font-semibold text-ink">Data kinds</p>
            <dl className="space-y-1">
              {KIND_HELP.map(([k, v]) => (
                <div key={k}><dt className="inline font-medium text-ink">{DATA_KIND_LABEL[k]}: </dt><dd className="inline text-muted">{v}</dd></div>
              ))}
            </dl>
          </div>
          <div>
            <p className="mb-1.5 font-semibold text-ink">Legacy labels (modules not yet migrated)</p>
            <ProvenanceLegend inline />
          </div>
          <p className="text-muted">Status: Fresh · Stale (older than its update cycle) · Unavailable · Not configured.</p>
        </div>
      )}
    </Popover>
  );
}

export function Header() {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const setCopilotOpen = useAppStore((s) => s.setCopilotOpen);
  const title = titleFor(pathname);
  return (
    <header className="glass-bar top-0 z-30 flex md:sticky min-h-16 flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2 sm:px-6">
      <button className="rounded-md p-1.5 text-muted hover:bg-light md:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}>
        <Menu size={20} aria-hidden />
      </button>
      <div className="mr-auto min-w-0 leading-tight">
        <p className="text-[11.5px] font-medium text-muted">Welcome to AquaGuard</p>
        <p className="truncate text-[16px] font-semibold text-ink">{title}</p>
      </div>
      <SearchButton />
      <DateFilter />
      <RegionSelector />
      <ScenarioChip />
      <div className="flex items-center gap-0.5">
        <RefreshButton />
        <Notifications />
        <DataLabels />
      </div>
      {!pathname.startsWith("/copilot") && (
        <button
          onClick={() => setCopilotOpen(true)}
          aria-label="Open AquaGuard Copilot"
          className="hidden items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-primary-dark sm:inline-flex"
        >
          <Bot size={15} aria-hidden /> <span className="hidden 2xl:inline">Copilot</span>
        </button>
      )}
      <ProfileMenu />
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
    </header>
  );
}
