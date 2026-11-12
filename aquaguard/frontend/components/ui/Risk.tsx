import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { riskColor } from "@/lib/format";
import type { RiskClass } from "@/lib/types/contract";
import { MeasureText } from "./MeasureView";
import { ProvenanceBadge } from "./Provenance";

/** Risk label with colour swatch + icon + text (never colour alone). */
export function RiskPill({ label, level }: { label: string; level: number }) {
  const Icon = level >= 4 ? AlertOctagon : level >= 3 ? AlertTriangle : level >= 2 ? Info : CheckCircle2;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2 py-0.5 text-[12.5px] font-medium">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: riskColor(level) }} aria-hidden />
      <Icon size={13} aria-hidden className="text-muted" />
      {label}
    </span>
  );
}

export function RiskRule({ risk }: { risk: RiskClass }) {
  return (
    <details className="text-[12.5px] text-muted">
      <summary className="cursor-pointer select-none text-primary">How this class was set</summary>
      <p className="mt-1 leading-relaxed">{risk.rule.rule}</p>
      <ul className="mt-1 space-y-0.5">
        {Object.entries(risk.rule.inputs).map(([k, m]) => (
          <li key={k} className="flex flex-wrap items-center gap-1.5">
            <span>{k}:</span> <MeasureText m={m} digits={2} />
          </li>
        ))}
      </ul>
      <div className="mt-1">
        Classification: <ProvenanceBadge p={risk.provenance} small />
      </div>
    </details>
  );
}

export function RiskLegend() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Risk legend">
      {["Low", "Low-medium", "Medium-high", "High", "Extremely high"].map((l, i) => (
        <RiskPill key={l} label={l} level={i} />
      ))}
    </div>
  );
}
