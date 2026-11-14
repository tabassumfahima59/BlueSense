"use client";
/**
 * Notifications: open stored alerts from the rule engine (GET /api/alerts `data`) with an unread count. Read marks
 * are kept per browser (anonymous client id; there is no login). Prediction-based alerts are labelled as such.
 */
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Popover } from "@/components/ui/Popover";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { clientId } from "@/lib/store";
import { BASELINE, type StoredAlert } from "@/lib/types/contract";
import { monthLabel } from "@/lib/format/time";

const SEVERITY: Record<StoredAlert["severity"], { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-[#fdecea] text-risk border-risk/40" },
  high: { label: "High", cls: "bg-[#fdeee6] text-orange border-orange/40" },
  medium: { label: "Medium", cls: "bg-[#fff6e6] text-warning border-warning/40" },
  low: { label: "Low", cls: "bg-light text-primary-dark border-primary/30" },
  info: { label: "Info", cls: "bg-light text-muted border-control/40" },
};

export function SeverityPill({ s }: { s: StoredAlert["severity"] }) {
  const v = SEVERITY[s];
  return <span className={`inline-flex rounded-full border px-1.5 text-[10.5px] font-semibold ${v.cls}`}>{v.label}</span>;
}

export function Notifications() {
  const [cid, setCid] = useState<string | null>(null);
  useEffect(() => setCid(clientId()), []);
  const res = useApi(cid ? `notifications|${cid}` : null, () => api.alerts("bd", BASELINE, cid ?? undefined));
  const [readLocal, setReadLocal] = useState<Set<number>>(new Set());
  const alerts = (res.data?.data.alerts ?? []).map((a) => (readLocal.has(a.id) ? { ...a, read: true } : a));
  const unread = alerts.filter((a) => !a.read).length;

  const mark = async (ids: number[]) => {
    if (!cid || !ids.length) return;
    try {
      await Promise.all(ids.map((id) => api.markRead(id, cid)));
      setReadLocal((s) => new Set([...s, ...ids]));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Popover label={unread ? `Notifications, ${unread} unread` : "Notifications"} panelLabel="Alerts" width="w-[380px]"
             trigger={
               <span className="relative inline-flex">
                 <Bell size={18} aria-hidden />
                 {unread > 0 && (
                   <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-risk px-1 text-[10px] font-semibold text-white" aria-hidden>
                     {unread > 99 ? "99+" : unread}
                   </span>
                 )}
               </span>
             }>
      {(close) => (
        <div>
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
            <span className="text-[13.5px] font-semibold text-ink">Alerts</span>
            <button type="button" disabled={!unread} onClick={() => mark(alerts.filter((a) => !a.read).map((a) => a.id))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary transition hover:bg-light disabled:text-muted disabled:hover:bg-transparent">
              <CheckCheck size={14} aria-hidden /> Mark all read
            </button>
          </div>
          {res.error && <p className="px-2 py-3 text-[12.5px] text-muted">Alerts could not be loaded: {res.error.message}</p>}
          {!res.data && !res.error && <p className="px-2 py-3 text-[12.5px] text-muted">Loading alerts…</p>}
          {res.data && !alerts.length && <p className="px-2 py-3 text-[12.5px] text-muted">No open alerts.</p>}
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.id} className={`rounded-lg border p-2.5 ${a.read ? "border-transparent" : "border-primary/25 bg-light/60"}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityPill s={a.severity} />
                  {a.isPrediction && <span className="rounded-full border border-control/50 px-1.5 text-[10.5px] font-medium text-muted">Prediction</span>}
                  <span className="text-[11.5px] text-muted">{a.regionName} · {a.observedAt ? (a.observedAt.length === 7 ? monthLabel(a.observedAt) : a.observedAt) : "—"}</span>
                  {!a.read && <span className="sr-only">Unread.</span>}
                </div>
                <p className="mt-1 text-[13px] font-semibold text-ink">{a.title}</p>
                <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted">{a.message}</p>
                <div className="mt-1.5 flex gap-3 text-[12px]">
                  <Link href={`/command-center?region=${a.regionId}`} onClick={close} className="font-medium text-primary hover:underline">
                    Open {a.regionName}
                  </Link>
                  {!a.read && (
                    <button type="button" onClick={() => mark([a.id])} className="font-medium text-primary hover:underline">
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}
