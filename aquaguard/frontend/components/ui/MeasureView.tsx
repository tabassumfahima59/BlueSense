import type { ReactNode } from "react";
import { displayUnit, fmtInterval, fmtMeasure } from "@/lib/format";
import type { Measure } from "@/lib/types/contract";
import { DataStatusBadge, fromMeasure } from "./DataStatus";
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

export function KpiCard({ label, m, hint, digits, children, accent, icon, intervalLabel = "Interval", onOpen }: {
  label: string;
  m?: Measure | null;
  hint?: ReactNode;
  digits?: number;
  children?: ReactNode;
  accent?: string;
  icon?: ReactNode;
  intervalLabel?: string;
  /** Opens the KPI's DetailDrawer (chart, formula, sources). */
  onOpen?: () => void;
}) {
  const interval = fmtInterval(m, digits);
  const status = m ? fromMeasure(m) : null;
  return (
    <div className={`card relative flex min-h-[132px] flex-col gap-1.5 p-4 ${onOpen ? "transition hover:shadow-lg" : ""}`}>
      {onOpen && (
        <button type="button" onClick={onOpen} aria-label={`${label}: show details`}
                className="absolute inset-0 rounded-[var(--radius-card)]" />
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {icon && <span className="text-muted" aria-hidden>{icon}</span>}
      </div>
      {children ?? (
        <div className="text-[28px] font-semibold leading-tight tabular-nums" style={accent ? { color: accent } : undefined}>
          {fmtMeasure(m, { digits })}
        </div>
      )}
      {interval && <div className="text-[12px] text-muted">{intervalLabel} {interval} {m ? displayUnit(m.unit) : ""}</div>}
      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        {status ? <DataStatusBadge info={status} compact /> : m && <MeasureBadge m={m} small />}
        {hint}
      </div>
    </div>
  );
}
