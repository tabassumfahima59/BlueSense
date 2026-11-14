"use client";
/**
 * DataStatusBadge: source, data kind, observed and retrieved times and status for a value or a response.
 * Honest time labels (master prompt rule 3): "Live" only for fresh Open-Meteo data; "Latest: <month>" for GRACE;
 * "Reference year <yyyy>" for AQUASTAT; reanalysis shows its last date. Status is always shown in words + icon.
 */
import { CheckCircle2, Clock3, PlugZap, XCircle } from "lucide-react";
import { fmtDateTime, monthLabel } from "@/lib/format/time";
import type { DataKind, DataStatus, Measure, Meta } from "@/lib/types/contract";
import { Tooltip } from "./Tooltip";

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  observed: "Observed (station)",
  model_current: "Model estimate (current)",
  forecast: "Forecast",
  reanalysis: "Reanalysis",
  satellite_monthly: "Satellite (monthly)",
  satellite_historical: "Satellite (historical)",
  statistic: "Statistic",
  derived: "Derived",
  prediction: "Prediction",
  scenario: "Scenario",
  conceptual: "Conceptual",
  reference: "Reference data",
};

export const STATUS_LABEL: Record<DataStatus, string> = {
  fresh: "Fresh",
  stale: "Stale",
  unavailable: "Unavailable",
  not_configured: "Not configured",
};

const STATUS_STYLE: Record<DataStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
  fresh: { cls: "border-success/40 bg-[#ecf8f1] text-success", Icon: CheckCircle2 },
  stale: { cls: "border-warning/40 bg-[#fff6e6] text-warning", Icon: Clock3 },
  unavailable: { cls: "border-risk/40 bg-[#fdecea] text-risk", Icon: XCircle },
  not_configured: { cls: "border-control/60 bg-light text-muted", Icon: PlugZap },
};

export interface StatusInfo {
  status: DataStatus;
  kind?: DataKind;
  observedAt?: string | null;
  retrievedAt?: string | null;
  referenceYear?: number | null;
  sources?: string[];
  attribution?: string[];
  spatialLevel?: string | null;
  note?: string | null;
}

export function fromMeta(meta: Meta): StatusInfo {
  return { status: meta.status, kind: meta.data_kind[0], observedAt: meta.observed_at, retrievedAt: meta.retrieved_at,
           sources: meta.source, attribution: meta.attribution, spatialLevel: meta.spatial_level, note: meta.note };
}

export function fromMeasure(m: Measure): StatusInfo | null {
  if (!m.dataKind || !m.status) return null;
  return { status: m.status, kind: m.dataKind, observedAt: m.observedAt, retrievedAt: m.retrievedAt,
           referenceYear: m.referenceYear, sources: m.sourceId ? [m.sourceId] : [], spatialLevel: m.spatialLevel,
           note: m.note };
}

/** The short time label shown on the badge. */
export function timeLabel(i: StatusInfo): string {
  if (i.status === "not_configured") return "Not configured";
  if (i.status === "unavailable") return "Unavailable";
  const prefix = i.status === "stale" ? "Stale · " : "";
  switch (i.kind) {
    case "model_current":
    case "forecast":
      return i.status === "fresh" ? "Live" : `${prefix}updated ${fmtDateTime(i.retrievedAt)}`;
    case "satellite_monthly":
      return `${prefix}Latest: ${monthLabel(i.observedAt)}`;
    case "statistic": {
      const year = i.referenceYear ?? ((i.observedAt ?? "").slice(0, 4) || null);
      return year ? `${prefix}Reference year ${year}` : `${prefix}Statistic`;
    }
    case "reanalysis":
      return `${prefix}Through ${i.observedAt ?? "—"}`;
    case "prediction":
      return `${prefix}Predicted${i.observedAt ? ` for ${monthLabel(i.observedAt)}` : ""}`;
    default:
      return `${prefix}${DATA_KIND_LABEL[i.kind ?? "derived"]}`;
  }
}

export function DataStatusBadge({ info, compact = false }: { info: StatusInfo | null; compact?: boolean }) {
  if (!info) return null;
  const { cls, Icon } = STATUS_STYLE[info.status];
  const label = timeLabel(info);
  const details = (
    <span className="block space-y-0.5">
      <span className="block font-semibold">{STATUS_LABEL[info.status]}{info.kind ? ` · ${DATA_KIND_LABEL[info.kind]}` : ""}</span>
      {info.attribution?.length ? <span className="block">Source: {info.attribution.join("; ")}</span>
        : info.sources?.length ? <span className="block">Source: {info.sources.join(", ")}</span> : null}
      {info.observedAt && <span className="block">Observed: {info.observedAt}</span>}
      {info.retrievedAt && <span className="block">Retrieved: {fmtDateTime(info.retrievedAt)}</span>}
      {info.spatialLevel && <span className="block">Spatial level: {info.spatialLevel}</span>}
      {info.note && <span className="block text-muted">{info.note}</span>}
    </span>
  );
  return (
    <Tooltip content={details}>
      <button type="button" aria-label={`Data status: ${STATUS_LABEL[info.status]}, ${label}`}
              className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 ${compact ? "py-0 text-[10.5px]" : "py-0.5 text-[11.5px]"} font-medium ${cls}`}>
        <Icon size={compact ? 11 : 12} aria-hidden className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  );
}
