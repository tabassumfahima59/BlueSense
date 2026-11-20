import { CheckCircle2, CircleDashed, Clock, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { horizonSkill, liveCheckPasses, type Live, type LiveData } from "@/lib/docs/live";
import type { ChangelogEntry, Feature } from "@/lib/docs/types";
import { formatDhaka } from "@/lib/docs/visibility";

function AsOf({ live }: { live: Live<unknown> }) {
  return <p className="mt-2 text-[12px] text-muted">As of {formatDhaka(live.asOf)}</p>;
}

function Unavailable({ live }: { live: Live<unknown> }) {
  return (
    <p className="text-[13.5px] text-muted">
      Unavailable right now{!live.ok ? ` (${live.error})` : ""}. No value is shown instead of a guess.
    </p>
  );
}

function Tile({ title, children, live }: { title: string; children: ReactNode; live: Live<unknown> }) {
  return (
    <div className="rounded-xl border border-border bg-white/80 p-4">
      <p className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="mt-1.5">{live.ok ? children : <Unavailable live={live} />}</div>
      <AsOf live={live} />
    </div>
  );
}

const fmt = (n: number | null | undefined, digits = 1) => (typeof n === "number" ? n.toFixed(digits) : "—");

export function LiveStatus({ live }: { live: LiveData }) {
  const h = live.health;
  const c = live.copilot;
  const lu = live.lastUpdated;
  const m = live.metrics;
  const a = live.alerts;
  const skill = m.ok ? horizonSkill(m.data, "1") : null;
  const counts = a.ok ? (a.data.data?.counts ?? {}) : {};
  const openAlerts = a.ok ? (a.data.data?.alerts?.length ?? 0) : 0;
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile title="Backend" live={h}>
          {h.ok && (
            <>
              <p className="text-[20px] font-semibold text-ink">{h.data.status === "ok" ? "Operational" : "Degraded"}</p>
              <p className="text-[13px] text-muted">API v{h.data.version} · weather archive to {String(h.data.dataFreshness?.weatherArchiveTo ?? "—")}</p>
            </>
          )}
        </Tile>
        <Tile title="AI Copilot" live={c}>
          {c.ok && (
            <>
              <p className="text-[20px] font-semibold text-ink">{c.data.status === "ready" ? "Ready" : "Not configured"}</p>
              <p className="text-[13px] text-muted">
                {c.data.providerLabel} · {c.data.model} · {c.data.tools.length} read-only tools
                {c.data.tools.some((t) => t.name === "search_docs") ? " (incl. documentation RAG)" : ""}
              </p>
            </>
          )}
        </Tile>
        <Tile title="Data freshness" live={lu}>
          {lu.ok && (
            <>
              <p className="text-[20px] font-semibold capitalize text-ink">{lu.data.data.overallStatus.replace(/_/g, " ")}</p>
              <p className="text-[13px] text-muted">Latest retrieval {formatDhaka(lu.data.data.latestRetrievedAt)}</p>
            </>
          )}
        </Tile>
        <Tile title="Forecast skill (1 month, test 2021+)" live={m}>
          {m.ok && skill && (
            <>
              <p className="text-[20px] font-semibold text-ink">RMSE {fmt(skill.rmse)} mm</p>
              <p className="text-[13px] text-muted">
                Climatology {fmt(skill.climatology)} · persistence {fmt(skill.persistence)} · 90% interval coverage{" "}
                {skill.coverage !== null ? `${(skill.coverage * 100).toFixed(0)}%` : "—"}
              </p>
            </>
          )}
          {m.ok && !skill && <p className="text-[13.5px] text-muted">Models not evaluated yet.</p>}
        </Tile>
        <Tile title="Open alerts (Bangladesh)" live={a}>
          {a.ok && (
            <>
              <p className="text-[20px] font-semibold text-ink">{openAlerts}</p>
              <p className="text-[13px] text-muted">
                {Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(" · ") || "No open alerts"}
              </p>
            </>
          )}
        </Tile>
        <Tile title="Copilot usage today" live={c}>
          {c.ok && (
            <>
              <p className="text-[20px] font-semibold text-ink">
                {c.data.limits.siteModelCallsUsedToday} / {c.data.limits.siteModelCallsPerDay}
              </p>
              <p className="text-[13px] text-muted">Model calls used today (site-wide limit) · resets {c.data.limits.resetsAt}</p>
            </>
          )}
        </Tile>
      </div>
      <p className="mt-3 text-[12.5px] text-muted">
        Source: <code>{live.apiBase}</code>. The live backend is a read-only snapshot, so its data does not refresh on its own.
      </p>
    </div>
  );
}

/** Operational signals only: BlueSense has no user tracking. */
export function Analytics({ live }: { live: LiveData }) {
  const c = live.copilot;
  const a = live.alerts;
  const s = live.sources;
  const counts = a.ok ? (a.data.data?.counts ?? {}) : {};
  const fresh = s.ok ? s.data.data.filter((r) => r.status === "fresh").length : 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile title="Copilot model calls today" live={c}>
        {c.ok && <p className="text-[20px] font-semibold text-ink">{c.data.limits.siteModelCallsUsedToday} / {c.data.limits.siteModelCallsPerDay}</p>}
      </Tile>
      <Tile title="Open alerts by severity" live={a}>
        {a.ok && (
          <p className="text-[14px] text-ink">
            {Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(" · ") || "None"}
          </p>
        )}
      </Tile>
      <Tile title="Sources fresh" live={s}>
        {s.ok && <p className="text-[20px] font-semibold text-ink">{fresh} / {s.data.data.length}</p>}
      </Tile>
    </div>
  );
}

export function SourceTable({ live }: { live: LiveData }) {
  const s = live.sources;
  if (!s.ok) return <Unavailable live={s} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-3 font-semibold">Source</th>
            <th className="py-2 pr-3 font-semibold">Kind</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 font-semibold">Last success</th>
          </tr>
        </thead>
        <tbody>
          {s.data.data.map((r) => (
            <tr key={r.id} className="border-b border-border/60">
              <td className="py-2 pr-3">{r.name}</td>
              <td className="py-2 pr-3 text-muted">{r.dataKind}</td>
              <td className="py-2 pr-3 capitalize">{r.status.replace(/_/g, " ")}</td>
              <td className="py-2 text-muted">{formatDhaka(r.lastSuccessAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <AsOf live={s} />
    </div>
  );
}

const STATUS_STYLE: Record<Feature["status"], string> = {
  current: "bg-green-50 text-success ring-green-200",
  upcoming: "bg-amber-50 text-warning ring-amber-200",
  planned: "bg-slate-50 text-muted ring-slate-200",
};

export function FeatureMatrix({ features, live }: { features: Feature[]; live: LiveData }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-3 font-semibold">Feature</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 pr-3 font-semibold">Live check</th>
            <th className="py-2 font-semibold">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {features.map((f) => {
            const pass = f.liveCheck ? liveCheckPasses(f.liveCheck, live) : null;
            return (
              <tr key={f.name} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium text-ink">{f.name}</span>
                  {f.area && <span className="block text-[12px] text-muted">{f.area}</span>}
                </td>
                <td className="py-2 pr-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize ring-1 ${STATUS_STYLE[f.status]}`}>{f.status}</span>
                </td>
                <td className="py-2 pr-3">
                  {!f.liveCheck ? (
                    <span className="inline-flex items-center gap-1 text-muted"><CircleDashed size={15} aria-hidden /> Not checked live</span>
                  ) : pass === null ? (
                    <span className="inline-flex items-center gap-1 text-muted"><Clock size={15} aria-hidden /> Backend unreachable</span>
                  ) : pass ? (
                    <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={15} aria-hidden /> Live</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-risk"><XCircle size={15} aria-hidden /> Not responding as expected</span>
                  )}
                </td>
                <td className="py-2 text-muted">{f.evidence}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ApiList({ live }: { live: LiveData }) {
  const a = live.api;
  if (!a.ok) return <Unavailable live={a} />;
  const groups = new Map<string, typeof a.data.operations>();
  for (const op of a.data.operations) groups.set(op.group, [...(groups.get(op.group) ?? []), op]);
  return (
    <div>
      <p className="mb-2 text-[13.5px] text-ink">
        <strong>{a.data.operations.length}</strong> operations in the live OpenAPI schema ({a.data.title}
        {a.data.version ? ` v${a.data.version}` : ""}). Interactive docs:{" "}
        <a className="text-primary underline" href={`${live.apiBase}/api/docs`} target="_blank" rel="noopener noreferrer">/api/docs</a>
      </p>
      <div className="space-y-2">
        {[...groups.entries()].map(([g, ops]) => (
          <details key={g} className="rounded-xl border border-border bg-white/70 px-3 py-2">
            <summary className="cursor-pointer text-[14px] font-semibold text-ink">{g} <span className="font-normal text-muted">({ops.length})</span></summary>
            <ul className="mt-2 space-y-1">
              {ops.map((op) => (
                <li key={`${op.method} ${op.path}`} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                  <span className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold ${op.method === "GET" ? "bg-primary-soft text-primary" : "bg-amber-50 text-warning"}`}>{op.method}</span>
                  <code className="break-all">{op.path}</code>
                  {op.summary && <span className="text-muted">— {op.summary}</span>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <AsOf live={a} />
    </div>
  );
}

export function Changelog({ entries }: { entries: ChangelogEntry[] }) {
  if (!entries.length) return null;
  return (
    <ol className="relative space-y-3 border-l-2 border-border pl-5">
      {entries.map((e) => (
        <li key={`${e.version}-${e.date}`}>
          <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-primary" aria-hidden />
          <p className="text-[14px] font-semibold text-ink">v{e.version} <span className="font-normal text-muted">· {e.date}</span></p>
          <p className="text-[13.5px] text-muted">{e.notes}</p>
        </li>
      ))}
    </ol>
  );
}
