"use client";
/**
 * Recent alerts (stored rule-engine alerts, GET /api/alerts `data`): filter by severity, mark read per browser,
 * and a detail dialog with value, threshold (and its source), data source and observation date. Prediction-based
 * alerts are labelled. Key insights: rule-based sentences from stored values, each with its status and date.
 */
import { CheckCheck, Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { SeverityPill } from "@/components/layout/Notifications";
import { Card, Segmented } from "@/components/ui/Card";
import { DataStatusBadge, DATA_KIND_LABEL } from "@/components/ui/DataStatus";
import { Modal } from "@/components/ui/Overlay";
import { ErrorCard, Skeleton } from "@/components/ui/States";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { fmtMeasure } from "@/lib/format";
import { fmtDateTime, monthLabel } from "@/lib/format/time";
import { clientId } from "@/lib/store";
import { BASELINE, type Insight, type StoredAlert } from "@/lib/types/contract";

type Filter = "all" | "high" | "medium" | "low";
const FILTER: Record<Filter, StoredAlert["severity"][]> = {
  all: ["critical", "high", "medium", "low", "info"], high: ["critical", "high"], medium: ["medium"], low: ["low", "info"],
};

const when = (s: string | null | undefined) => (!s ? "—" : s.length === 7 ? monthLabel(s) : s);

export function AlertsPanel({ region }: { region: string }) {
  const [cid, setCid] = useState<string | null>(null);
  useEffect(() => setCid(clientId()), []);
  const res = useApi(cid ? `cc-alerts|${region}|${cid}` : null, () => api.alerts(region, BASELINE, cid ?? undefined));
  const [filter, setFilter] = useState<Filter>("all");
  const [read, setRead] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<StoredAlert | null>(null);

  const all = (res.data?.data.alerts ?? []).map((a) => (read.has(a.id) ? { ...a, read: true } : a));
  const shown = all.filter((a) => FILTER[filter].includes(a.severity));
  const mark = async (a: StoredAlert) => {
    if (!cid) return;
    try {
      await api.markRead(a.id, cid);
      setRead((s) => new Set([...s, a.id]));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Card title="Recent alerts" subtitle="Rule engine on stored data; national alerts are included for every division"
          actions={<Segmented label="Filter alerts by severity" value={filter} onChange={setFilter}
                              options={[{ value: "all", label: "All" }, { value: "high", label: "High+" },
                                        { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />}>
      {res.error && <ErrorCard error={res.error} onRetry={res.retry} />}
      {!res.data && !res.error && <Skeleton className="h-40 w-full" />}
      {res.data && !shown.length && <p className="text-[13px] text-muted">No open alerts with this severity for this region.</p>}
      <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1" aria-label="Alerts">
        {shown.map((a) => (
          <li key={a.id} className={`rounded-lg border p-3 ${a.read ? "border-border bg-white/60" : "border-primary/25 bg-light/70"}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <SeverityPill s={a.severity} />
              {a.isPrediction && <span className="rounded-full border border-control/50 px-1.5 text-[10.5px] font-medium text-muted">Prediction</span>}
              <span className="text-[12px] text-muted">{a.regionName} · {when(a.observedAt)}</span>
              {!a.read && <span className="text-[11px] font-semibold text-primary">Unread</span>}
            </div>
            <p className="mt-1 text-[13.5px] font-semibold text-ink">{a.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{a.message}</p>
            <div className="mt-1.5 flex gap-3 text-[12.5px]">
              <button type="button" onClick={() => setOpen(a)} className="font-medium text-primary hover:underline">Details</button>
              {!a.read && <button type="button" onClick={() => mark(a)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><CheckCheck size={13} aria-hidden /> Mark read</button>}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.title ?? ""}
             description={open ? `${open.regionName} · ${open.isPrediction ? "prediction-based alert" : DATA_KIND_LABEL[open.dataKind]}` : undefined}>
        {open && (
          <div className="space-y-3 text-[13px]">
            <p className="leading-relaxed text-ink">{open.message}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Severity</dt><dd><SeverityPill s={open.severity} /> {open.basis}</dd>
              <dt className="text-muted">Value</dt><dd className="tabular-nums">{fmtMeasure(open.value)}</dd>
              <dt className="text-muted">Threshold</dt><dd className="tabular-nums">{fmtMeasure(open.threshold)}</dd>
              <dt className="text-muted">Threshold source</dt><dd>{open.thresholdSource ?? "—"}</dd>
              <dt className="text-muted">Data source</dt><dd>{open.sourceId ?? "—"} · {DATA_KIND_LABEL[open.dataKind]}</dd>
              <dt className="text-muted">Observed</dt><dd>{when(open.observedAt)}</dd>
              <dt className="text-muted">Opened / updated</dt><dd>{fmtDateTime(open.createdAt)}{open.updatedAt ? ` / ${fmtDateTime(open.updatedAt)}` : ""}</dd>
            </dl>
            {!open.read && (
              <button type="button" onClick={() => { mark(open); setOpen({ ...open, read: true }); }}
                      className="rounded-lg border border-control bg-white px-3 py-1.5 text-[13px] font-medium transition hover:bg-light">Mark read</button>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export function Insights({ items }: { items: Insight[] }) {
  return (
    <Card title="Key insights" subtitle="Rule-based sentences from stored values; each shows its source status and date">
      {!items.length && <p className="text-[13px] text-muted">No insight can be formed: the underlying data is unavailable.</p>}
      <ul className="space-y-2.5">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-2.5">
            <Lightbulb size={16} aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-[13px] leading-relaxed text-ink">{i.text}</p>
              <div className="mt-1">
                <DataStatusBadge compact info={{ status: i.status, kind: i.dataKind, observedAt: i.observedAt, sources: i.sources }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
