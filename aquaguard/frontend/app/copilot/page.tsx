"use client";
import { ChatUI, TOOL_LABEL } from "@/components/copilot/ChatUI";
import { Card, Note, PageHeader } from "@/components/ui/Card";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";

export default function CopilotPage() {
  const st = useApi("copilot-status", api.copilotStatus);
  const region = useAppStore((s) => s.selectedRegion) || "bd";
  const s = st.data;
  return (
    <div className="space-y-5">
      <PageHeader title="AquaGuard AI Copilot" description="Ask about water, weather, risk, statistics, predictions, irrigation and scenarios. The Copilot looks numbers up with read-only AquaGuard tools, streams its answer and shows which data it used." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card flex h-[min(680px,calc(100vh-230px))] min-h-[420px] flex-col overflow-hidden p-0">
          <ChatUI />
        </div>
        <div className="space-y-4">
          <Card title="Status">
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">Copilot</dt>
                <dd className="font-medium" data-testid="copilot-status">{s ? (s.status === "ready" ? "Ready" : "Not configured") : st.error ? "Unavailable" : "…"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Model</dt><dd className="font-medium">{s?.status === "ready" ? s.model : "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Selected region</dt><dd className="font-medium">{region}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Rate limit</dt><dd className="font-medium">{s ? `${s.rateLimitPerMin} questions / min` : "—"}</dd></div>
            </dl>
          </Card>
          {s && (
            <Card title="Read-only tools" subtitle="What the Copilot can look up">
              <ul className="space-y-1 text-[12.5px]">
                {s.tools.map((t) => (
                  <li key={t.name} title={t.description}><span className="font-medium">{TOOL_LABEL[t.name] ?? t.name}</span> <span className="text-muted">· {t.module}</span></li>
                ))}
              </ul>
            </Card>
          )}
          <Note>
            The Copilot can only read data: it has no SQL access and no tool that changes anything. Your questions and the looked-up data are treated
            as data, not instructions. Numbers in an answer that cannot be matched to the looked-up data are flagged. Without a server-side LLM key
            it gives no answers at all. AquaGuard has no real-time sensors, well depths or water-quality data.
          </Note>
        </div>
      </div>
    </div>
  );
}
