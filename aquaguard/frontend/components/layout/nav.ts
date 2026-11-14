import {
  Bot, BrainCircuit, Database, Globe2, LayoutDashboard, Settings, Sprout, Waves, Workflow, SlidersHorizontal,
} from "lucide-react";

export const MODULES = [
  { href: "/command-center", label: "Command Center", short: "Overview", icon: LayoutDashboard, desc: "KPIs, risk map, alerts and regional comparison" },
  { href: "/explorer", label: "3D Water Explorer", short: "Explorer", icon: Globe2, desc: "Bangladesh map with terrain, water and risk layers" },
  { href: "/prediction-lab", label: "AI Prediction Lab", short: "Predictions", icon: BrainCircuit, desc: "Scarcity forecasts, demand projection, GRACE trend, SHAP" },
  { href: "/water-flow", label: "3D Water Flow", short: "Flow", icon: Waves, desc: "Simulated distribution network and pressure management" },
  { href: "/water-budget", label: "Water Budget Sankey", short: "Budget", icon: Workflow, desc: "Supply-to-sector flows, losses and optimized allocation" },
  { href: "/what-if", label: "What-if Simulator", short: "What-if", icon: SlidersHorizontal, desc: "Six scenario levers, baseline vs simulated" },
  { href: "/irrigation", label: "Smart Irrigation", short: "Irrigation", icon: Sprout, desc: "FAO-56 crop water requirement and timing" },
  { href: "/copilot", label: "AI Copilot", short: "Copilot", icon: Bot, desc: "Questions answered from platform data" },
] as const;

export const DATA_SOURCES = { href: "/data-sources", label: "Data Sources", short: "Sources", icon: Database };
export const SETTINGS = { href: "/settings", label: "Settings", short: "Settings", icon: Settings };

export function titleFor(pathname: string): string {
  const m = MODULES.find((x) => pathname.startsWith(x.href));
  if (m) return m.label;
  if (pathname.startsWith("/data-sources")) return "Data Sources & Limitations";
  if (pathname.startsWith("/settings")) return "Settings";
  return "AquaGuard";
}
