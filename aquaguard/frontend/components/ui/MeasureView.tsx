import type { ReactNode } from "react";
import { fmtInterval, fmtMeasure } from "@/lib/format";
import type { Measure } from "@/lib/types/contract";
import { MeasureBadge } from "./Provenance";

/** Inline value with its provenance badge. */
export function MeasureText({ m, digits, signed, badge = true }: { m: Measure | null | undefined; digits?: number; signed?: boolean; badge?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium tabular-nums">{fmtMeasure(m, { digits, signed })}</span>
      {badge && <MeasureBadge m={m} small />}
    </span>
  );
}

export function KpiCard({ label, m, hint, digits, children, accent, icon, intervalLabel = "Interval" }: {
  label: string;
  m?: Measure | null;
  hint?: ReactNode;
  digits?: number;
  children?: ReactNode;
  accent?: string;
  icon?: ReactNode;
  intervalLabel?: string;
}) {
  const interval = fmtInterval(m, digits);
  return (
    <div className="card flex min-h-[132px] flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {icon && <span className="text-muted" aria-hidden>{icon}</span>}
      </div>
      {children ?? (
        <div className="text-[28px] font-semibold leading-tight tabular-nums" style={accent ? { color: accent } : undefined}>
          {fmtMeasure(m, { digits })}
        </div>
      )}
      {interval && <div className="text-[12px] text-muted">{intervalLabel} {interval} {m?.unit}</div>}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        {m && <MeasureBadge m={m} small />}
        {hint}
      </div>
    </div>
  );
}
