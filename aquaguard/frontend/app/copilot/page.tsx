"use client";
import { ChatUI } from "@/components/copilot/ChatUI";
import { Card, Note, PageHeader } from "@/components/ui/Card";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";
import { describeScenario, isBaseline } from "@/lib/store/scenario";

export default function CopilotPage() {
  const h = useApi("health", api.health);
  const region = useAppStore((s) => s.selectedRegion);
  const scenario = useAppStore((s) => s.activeScenario);
  return (
    <div className="space-y-5">
      <PageHeader title="AquaGuard AI Copilot" description="Ask about scarcity, forecasts, the water budget, scenarios and irrigation. Answers use only platform data for the current region and scenario, and name the module behind each number." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card flex h-[min(680px,calc(100vh-230px))] min-h-[420px] flex-col overflow-hidden p-0">
          <ChatUI />
        </div>
        <div className="space-y-4">
          <Card title="Context">
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">Region</dt><dd className="font-medium">{region}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Scenario</dt><dd className="text-right font-medium">{isBaseline(scenario) ? "Baseline" : describeScenario(scenario)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Mode</dt><dd className="font-medium">{h.data ? (h.data.llmEnabled ? "LLM (grounded)" : "Rule-based fallback") : "…"}</dd></div>
            </dl>
          </Card>
          <Note>
            The Copilot reads overview totals, risk, forecasts, the water budget, scenario results, GRACE and alerts from the backend. In LLM mode
            every number in an answer is checked against that context; an answer with an unknown number is replaced by the rule-based answer. It
            has no real-time sensors, well depths or water-quality data and says so. Bangla questions are answered in Bangla in LLM mode.
          </Note>
        </div>
      </div>
    </div>
  );
}
