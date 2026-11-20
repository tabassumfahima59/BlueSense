"use client";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, ImagePlus, LogOut, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ChangelogEntry, DocsConfig, DocsContent, DocSection, Feature, Role, SectionGroup, TeamMember, VersionInfo, VisibilityMode,
} from "@/lib/docs/types";
import { describeVisibility, dhakaLocalToUtc, formatDhaka, isDocsVisible, utcToDhakaLocal } from "@/lib/docs/visibility";
import { Markdown } from "../Markdown";
import { Mermaid } from "../Mermaid";
import { TeamGrid } from "../TeamGrid";

type Tab = "visibility" | "overview" | "sections" | "team" | "diagrams" | "features" | "changelog" | "versions";

const TABS: { id: Tab; label: string }[] = [
  { id: "visibility", label: "Visibility" },
  { id: "overview", label: "Overview & links" },
  { id: "sections", label: "Sections" },
  { id: "team", label: "Team" },
  { id: "diagrams", label: "Diagrams" },
  { id: "features", label: "Feature matrix" },
  { id: "changelog", label: "Changelog" },
  { id: "versions", label: "Versions" },
];

const input = "w-full rounded-lg border border-control bg-white px-3 py-1.5 text-[14px] focus:outline focus:outline-2 focus:outline-primary";
const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const primaryBtn = `${btn} bg-primary text-white hover:bg-primary-dark`;
const secondaryBtn = `${btn} border border-control bg-white text-ink hover:bg-light`;
const iconBtn = "grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-light hover:text-ink disabled:opacity-30";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-[13px] font-medium text-ink">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[12px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}`);
const today = () => new Date().toISOString().slice(0, 10);

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** Centre-crops an image to a square and resizes it to 512×512 WebP in the browser. */
async function toSquareWebp(file: File, size = 512): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("The image is larger than 5 MB.");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob || blob.type !== "image/webp") throw new Error("This browser cannot create WebP images. Use Chrome, Edge or Firefox.");
  return blob;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

export function AdminPanel({ role, initialDraft, initialConfig, storage, storageError }: {
  role: Role;
  initialDraft: DocsContent;
  initialConfig: DocsConfig;
  storage: "blob" | "local";
  storageError: string | null;
}) {
  const router = useRouter();
  const isSuper = role === "superadmin";
  const [tab, setTab] = useState<Tab>("visibility");
  const [draft, setDraft] = useState<DocsContent>(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(storageError ? { kind: "error", text: storageError } : null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const update = useCallback((fn: (d: DocsContent) => DocsContent) => {
    setDraft((d) => fn(d));
    setDirty(true);
    setConfirmPublish(false);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await fn() });
    } catch (e) {
      setMessage({ kind: "error", text: `${label}: ${e instanceof Error ? e.message : "failed"}` });
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = () => run("Save draft", async () => {
    await postJson("/api/docs/draft", { content: draft });
    setDirty(false);
    return "Draft saved. It is not public until you publish.";
  });

  const publish = () => run("Publish", async () => {
    const r = await postJson<{ version: VersionInfo }>("/api/docs/publish", { content: draft });
    setDirty(false);
    setConfirmPublish(false);
    router.refresh();
    return `Published. /docs shows the new content now (version ${formatDhaka(r.version.savedAt)}).`;
  });

  const signOut = async () => {
    await fetch("/api/docs/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/docs/admin/login");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h1 className="text-[20px] font-semibold text-ink">Docs admin</h1>
          <p className="text-[13px] text-muted">
            Signed in as <strong>{isSuper ? "Super Admin" : "Admin"}</strong> · storage: {storage === "blob" ? "Vercel Blob" : "local files (development)"}
            {dirty && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-warning">Unsaved changes</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/docs" className={secondaryBtn} target="_blank">View /docs</Link>
          <button type="button" className={secondaryBtn} onClick={saveDraft} disabled={busy || !dirty}>Save draft</button>
          {confirmPublish ? (
            <>
              <button type="button" className={primaryBtn} onClick={publish} disabled={busy}>Confirm publish</button>
              <button type="button" className={secondaryBtn} onClick={() => setConfirmPublish(false)} disabled={busy}>Cancel</button>
            </>
          ) : (
            <button type="button" className={primaryBtn} onClick={() => setConfirmPublish(true)} disabled={busy}>
              <Upload size={14} aria-hidden /> Publish
            </button>
          )}
          <button type="button" className={secondaryBtn} onClick={signOut}><LogOut size={14} aria-hidden /> Sign out</button>
        </div>
      </div>

      {message && (
        <p role="status" className={`rounded-lg px-3 py-2 text-[13.5px] ${message.kind === "ok" ? "bg-green-50 text-success" : "bg-red-50 text-risk"}`}>
          {message.text}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Admin sections" className="card h-fit p-2">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {TABS.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                        className={`w-full rounded-lg px-3 py-1.5 text-left text-[13.5px] ${tab === t.id ? "bg-primary-soft font-semibold text-primary" : "text-ink hover:bg-light"}`}>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="card min-w-0 p-4 sm:p-5">
          {tab === "visibility" && <VisibilityTab initial={initialConfig} canEdit={isSuper} />}
          {tab === "overview" && <OverviewTab draft={draft} update={update} />}
          {tab === "sections" && <SectionsTab draft={draft} update={update} />}
          {tab === "team" && <TeamTab draft={draft} update={update} canEdit={isSuper} />}
          {tab === "diagrams" && <DiagramsTab draft={draft} update={update} />}
          {tab === "features" && <FeaturesTab draft={draft} update={update} />}
          {tab === "changelog" && <ChangelogTab draft={draft} update={update} />}
          {tab === "versions" && (
            <VersionsTab canRestore={isSuper} onRestored={(d) => { setDraft(d); setDirty(false); setMessage({ kind: "ok", text: "Version loaded into the draft. Publish to make it public." }); }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Visibility

function VisibilityTab({ initial, canEdit }: { initial: DocsConfig; canEdit: boolean }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<DocsConfig>(initial);
  const [start, setStart] = useState(utcToDhakaLocal(initial.startUtc));
  const [end, setEnd] = useState(utcToDhakaLocal(initial.endUtc));
  const [hours, setHours] = useState(initial.durationHours ? String(initial.durationHours) : "");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const candidate: DocsConfig = useMemo(() => ({
    ...cfg,
    startUtc: start ? dhakaLocalToUtc(start) : null,
    endUtc: end ? dhakaLocalToUtc(end) : null,
    durationHours: hours ? Number(hours) : null,
  }), [cfg, start, end, hours]);
  const preview = isDocsVisible(candidate);

  async function save(next: DocsConfig) {
    setBusy(true);
    setStatus(null);
    try {
      const r = await postJson<{ config: DocsConfig }>("/api/docs/config", next);
      setCfg(r.config);
      setStart(utcToDhakaLocal(r.config.startUtc));
      setEnd(utcToDhakaLocal(r.config.endUtc));
      setHours(r.config.durationHours ? String(r.config.durationHours) : "");
      setStatus({ kind: "ok", text: `Saved. ${describeVisibility(isDocsVisible(r.config))}.` });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[16px] font-semibold text-ink">Who can see /docs</h2>
        <p className="text-[13px] text-muted">Times are Asia/Dhaka (UTC+06:00). Changes apply within a minute.</p>
      </div>
      <p className={`rounded-lg px-3 py-2 text-[14px] font-medium ${preview.visible ? "bg-green-50 text-success" : "bg-amber-50 text-warning"}`}>
        With these settings: {describeVisibility(preview)}
      </p>
      {!canEdit && <p className="text-[13px] text-muted">Only a Super Admin can change visibility.</p>}
      <fieldset disabled={!canEdit || busy} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} onClick={() => save({ ...candidate, enabled: true, mode: "always" })}>Turn ON now (no time limit)</button>
          <button type="button" className={secondaryBtn}
                  onClick={() => save({ ...candidate, enabled: false, mode: isDocsVisible({ ...candidate, enabled: true }).reason === "invalid" ? "always" : candidate.mode })}>
            Turn OFF now
          </button>
        </div>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          Visibility is ON (the schedule below decides when)
        </label>
        <div role="radiogroup" aria-label="Schedule" className="flex flex-wrap gap-3 text-[14px]">
          {(["always", "window", "duration"] as VisibilityMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" name="mode" checked={cfg.mode === m} onChange={() => setCfg({ ...cfg, mode: m })} />
              {m === "always" ? "Always" : m === "window" ? "Start and end time" : "Start + duration"}
            </label>
          ))}
        </div>
        {cfg.mode !== "always" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Start (Dhaka)"><input type="datetime-local" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            {cfg.mode === "window" ? (
              <Field label="End (Dhaka)"><input type="datetime-local" className={input} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            ) : (
              <Field label="Duration (hours)" hint="For example 120 = five days"><input type="number" min={1} max={8784} className={input} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
            )}
          </div>
        )}
        <button type="button" className={primaryBtn} onClick={() => save(candidate)}>Save visibility</button>
      </fieldset>
      {status && <p role="status" className={`text-[13.5px] ${status.kind === "ok" ? "text-success" : "text-risk"}`}>{status.text}</p>}
      <p className="text-[12px] text-muted">Last changed {formatDhaka(cfg.updatedAt)} by {cfg.updatedBy}.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Overview

type Updater = (fn: (d: DocsContent) => DocsContent) => void;

function OverviewTab({ draft, update }: { draft: DocsContent; update: Updater }) {
  const link = (k: keyof DocsContent["links"], label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input type="url" className={input} value={draft.links[k]} placeholder="https://…"
             onChange={(e) => update((d) => ({ ...d, links: { ...d.links, [k]: e.target.value } }))} />
    </Field>
  );
  return (
    <div className="space-y-3">
      <Field label="Title"><input className={input} value={draft.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} /></Field>
      <Field label="Tagline"><input className={input} value={draft.tagline} onChange={(e) => update((d) => ({ ...d, tagline: e.target.value }))} /></Field>
      <Field label="2-minute summary" hint="Shown at the top for judges and investors.">
        <textarea rows={5} className={input} value={draft.summary} onChange={(e) => update((d) => ({ ...d, summary: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {link("liveApp", "Live app URL")}
        {link("video", "Pitch video URL", "YouTube link once uploaded")}
        {link("repo", "Repository URL")}
        {link("design", "Design URL", "Figma or architecture link (must be shareable)")}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Sections

function SectionsTab({ draft, update }: { draft: DocsContent; update: Updater }) {
  const [selected, setSelected] = useState<string>(draft.sections[0]?.id ?? "");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const sections = draft.sections;
  const current = sections.find((s) => s.id === selected) ?? sections[0];

  const setSections = (fn: (list: DocSection[]) => DocSection[]) =>
    update((d) => ({ ...d, sections: fn(d.sections).map((s, i) => ({ ...s, order: i + 1 })) }));
  const patch = (id: string, p: Partial<DocSection>) =>
    setSections((list) => list.map((s) => (s.id === id ? { ...s, ...p, updatedAt: new Date().toISOString() } : s)));

  const add = () => {
    const id = `custom-${Date.now()}`;
    const slugs = new Set(sections.map((s) => s.slug));
    let slug = "new-section";
    for (let i = 2; slugs.has(slug); i++) slug = `new-section-${i}`;
    setSections((list) => [...list, { id, slug, title: "New section", group: "technical", kind: "markdown", order: list.length + 1, visible: true, body: "", updatedAt: new Date().toISOString() }]);
    setSelected(id);
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-ink">Order (drag or use arrows)</p>
          <button type="button" className={secondaryBtn} onClick={add}><Plus size={14} aria-hidden /> Add</button>
        </div>
        <ul className="space-y-1">
          {sections.map((s, i) => (
            <li key={s.id}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragFrom !== null) setSections((l) => move(l, dragFrom, i)); setDragFrom(null); }}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 ${current?.id === s.id ? "border-primary bg-primary-soft" : "border-border bg-white"}`}>
              <GripVertical size={14} aria-hidden className="shrink-0 cursor-grab text-muted" />
              <button type="button" onClick={() => setSelected(s.id)} className={`min-w-0 flex-1 truncate text-left text-[13px] ${s.visible ? "text-ink" : "text-muted line-through"}`}>
                <span className="mr-1 text-[11px] uppercase text-muted">{s.group === "pitch" ? "P" : "T"}</span>{s.title}
              </button>
              <button type="button" className={iconBtn} aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => setSections((l) => move(l, i, i - 1))}><ArrowUp size={14} /></button>
              <button type="button" className={iconBtn} aria-label={`Move ${s.title} down`} disabled={i === sections.length - 1} onClick={() => setSections((l) => move(l, i, i + 1))}><ArrowDown size={14} /></button>
              <button type="button" className={iconBtn} aria-label={s.visible ? `Hide ${s.title}` : `Show ${s.title}`} onClick={() => patch(s.id, { visible: !s.visible })}>
                {s.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {current ? (
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_140px]">
            <Field label="Title"><input className={input} value={current.title} onChange={(e) => patch(current.id, { title: e.target.value })} /></Field>
            <Field label="Anchor (slug)"><input className={input} value={current.slug} onChange={(e) => patch(current.id, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").slice(0, 64) })} /></Field>
            <Field label="Group">
              <select className={input} value={current.group} onChange={(e) => patch(current.id, { group: e.target.value as SectionGroup })}>
                <option value="pitch">Pitch deck</option>
                <option value="technical">Technical</option>
              </select>
            </Field>
          </div>
          {current.kind !== "markdown" && (
            <p className="rounded-lg bg-light px-3 py-2 text-[12.5px] text-muted">
              This section also shows a live or structured block ({current.kind}) under the text. Edit that block in its own tab.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            <Field label="Text (Markdown)" hint="Headings (###), lists, **bold**, links, tables. HTML is not allowed.">
              <textarea rows={18} className={`${input} font-mono text-[13px]`} value={current.body} onChange={(e) => patch(current.id, { body: e.target.value })} />
            </Field>
            <div>
              <p className="text-[13px] font-medium text-ink">Live preview</p>
              <div className="mt-1 max-h-[480px] overflow-y-auto rounded-lg border border-border bg-white p-3">
                {current.body.trim() ? <Markdown>{current.body}</Markdown> : <p className="text-[13px] text-muted">Nothing written yet.</p>}
              </div>
            </div>
          </div>
          {current.kind === "markdown" && current.id.startsWith("custom-") && (
            <button type="button" className={`${secondaryBtn} text-risk`} onClick={() => { setSections((l) => l.filter((s) => s.id !== current.id)); setSelected(sections[0]?.id ?? ""); }}>
              <Trash2 size={14} aria-hidden /> Delete this section
            </button>
          )}
        </div>
      ) : (
        <p className="text-muted">No sections.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Team

function TeamTab({ draft, update, canEdit }: { draft: DocsContent; update: Updater; canEdit: boolean }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const members = draft.team.members;
  const setMembers = (fn: (m: TeamMember[]) => TeamMember[]) => update((d) => ({ ...d, team: { ...d.team, members: fn(d.team.members) } }));
  const patch = (id: string, p: Partial<TeamMember>) => setMembers((list) => list.map((m) => (m.id === id ? { ...m, ...p } : m)));

  async function upload(member: TeamMember, file: File | undefined) {
    if (!file) return;
    setUploading(member.id);
    setError(null);
    try {
      const webp = await toSquareWebp(file);
      const form = new FormData();
      form.append("memberId", member.id);
      form.append("file", webp, `${member.id}.webp`);
      const res = await fetch("/api/docs/team-photo", { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { photoVersion?: string; error?: string };
      if (!res.ok || !j.photoVersion) throw new Error(j.error ?? `Upload failed (${res.status})`);
      patch(member.id, { photoVersion: j.photoVersion });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit && <p className="rounded-lg bg-light px-3 py-2 text-[13px] text-muted">Only a Super Admin can change the team.</p>}
      <fieldset disabled={!canEdit} className="space-y-4">
        <Field label="Team name (optional)">
          <input className={input} value={draft.team.name} onChange={(e) => update((d) => ({ ...d, team: { ...d.team, name: e.target.value } }))} />
        </Field>
        <ul className="space-y-3">
          {members.map((m, i) => (
            <li key={m.id} className="rounded-xl border border-border bg-white p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr]">
                <div className="flex flex-col items-center gap-2">
                  {m.photoVersion ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin preview of our own 512×512 WebP
                    <img src={`/api/docs/media/${encodeURIComponent(m.id)}?v=${m.photoVersion}`} alt="" width={96} height={96} className="h-24 w-24 rounded-xl object-cover ring-1 ring-border" />
                  ) : (
                    <div className="grid h-24 w-24 place-items-center rounded-xl bg-light text-[12px] text-muted">No photo</div>
                  )}
                  <label className={`${secondaryBtn} cursor-pointer`}>
                    <ImagePlus size={14} aria-hidden /> {uploading === m.id ? "Uploading…" : "Photo"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(m, e.target.files?.[0])} />
                  </label>
                  {m.photoVersion && <button type="button" className="text-[12px] text-muted underline" onClick={() => patch(m.id, { photoVersion: undefined })}>Remove photo</button>}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="Full name"><input className={input} value={m.fullName} onChange={(e) => patch(m.id, { fullName: e.target.value })} /></Field>
                  <Field label="Role in BlueSense"><input className={input} value={m.role} onChange={(e) => patch(m.id, { role: e.target.value })} /></Field>
                  <Field label="Email"><input type="email" className={input} value={m.email} onChange={(e) => patch(m.id, { email: e.target.value })} /></Field>
                  <label className="mt-6 flex items-start gap-2 text-[13px] text-ink">
                    <input type="checkbox" checked={m.showEmail} onChange={(e) => patch(m.id, { showEmail: e.target.checked })} className="mt-0.5" />
                    Show email publicly (the member agreed)
                  </label>
                  <div className="flex gap-1 sm:col-span-2">
                    <button type="button" className={iconBtn} aria-label="Move up" disabled={i === 0} onClick={() => setMembers((l) => move(l, i, i - 1))}><ArrowUp size={14} /></button>
                    <button type="button" className={iconBtn} aria-label="Move down" disabled={i === members.length - 1} onClick={() => setMembers((l) => move(l, i, i + 1))}><ArrowDown size={14} /></button>
                    <button type="button" className={`${iconBtn} text-risk`} aria-label={`Remove ${m.fullName || "member"}`} onClick={() => setMembers((l) => l.filter((x) => x.id !== m.id))}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className={secondaryBtn} onClick={() => setMembers((l) => [...l, { id: newId(), fullName: "", role: "", email: "", showEmail: true }])}>
          <Plus size={14} aria-hidden /> Add member
        </button>
      </fieldset>
      {error && <p role="alert" className="text-[13px] text-risk">{error}</p>}
      <div>
        <p className="mb-2 text-[13px] font-semibold text-ink">Preview</p>
        <TeamGrid name={draft.team.name} members={members.filter((m) => m.fullName.trim())} />
      </div>
      <p className="text-[12px] text-muted">Photos are centre-cropped to a square and resized to 512×512 WebP in your browser before upload. Publish to make team changes public.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Diagrams

function DiagramsTab({ draft, update }: { draft: DocsContent; update: Updater }) {
  const [which, setWhich] = useState<"architecture" | "dataflow">("architecture");
  const code = draft.diagrams[which];
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["architecture", "dataflow"] as const).map((w) => (
          <button key={w} type="button" className={which === w ? primaryBtn : secondaryBtn} onClick={() => setWhich(w)}>
            {w === "architecture" ? "Architecture" : "Data flow"}
          </button>
        ))}
      </div>
      <Field label="Mermaid source" hint="See mermaid.js.org for syntax. The preview updates as you type.">
        <textarea rows={14} className={`${input} font-mono text-[13px]`} value={code}
                  onChange={(e) => update((d) => ({ ...d, diagrams: { ...d.diagrams, [which]: e.target.value } }))} />
      </Field>
      <div className="rounded-lg border border-border bg-white p-3">
        <Mermaid code={code} label={`${which} diagram preview`} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Features

function FeaturesTab({ draft, update }: { draft: DocsContent; update: Updater }) {
  const setFeatures = (fn: (f: Feature[]) => Feature[]) => update((d) => ({ ...d, features: fn(d.features) }));
  const patch = (i: number, p: Partial<Feature>) => setFeatures((l) => l.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">&ldquo;Live check&rdquo; ties a row to a backend response that proves the feature is running.</p>
      <ul className="space-y-2">
        {draft.features.map((f, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-white p-3 md:grid-cols-[2fr_120px_1fr_120px_auto]">
            <input aria-label="Feature" className={input} value={f.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <select aria-label="Status" className={input} value={f.status} onChange={(e) => patch(i, { status: e.target.value as Feature["status"] })}>
              <option value="current">current</option><option value="upcoming">upcoming</option><option value="planned">planned</option>
            </select>
            <input aria-label="Evidence" className={input} value={f.evidence} onChange={(e) => patch(i, { evidence: e.target.value })} />
            <select aria-label="Live check" className={input} value={f.liveCheck ?? ""} onChange={(e) => patch(i, { liveCheck: (e.target.value || null) as Feature["liveCheck"] })}>
              <option value="">none</option><option value="health">health</option><option value="copilot">copilot</option>
              <option value="rag">rag</option><option value="metrics">metrics</option><option value="sources">sources</option>
            </select>
            <div className="flex gap-1">
              <button type="button" className={iconBtn} aria-label="Move up" disabled={i === 0} onClick={() => setFeatures((l) => move(l, i, i - 1))}><ArrowUp size={14} /></button>
              <button type="button" className={`${iconBtn} text-risk`} aria-label="Remove" onClick={() => setFeatures((l) => l.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className={secondaryBtn} onClick={() => setFeatures((l) => [...l, { name: "New feature", status: "planned", area: "", evidence: "", liveCheck: null }])}>
        <Plus size={14} aria-hidden /> Add feature
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Changelog

function ChangelogTab({ draft, update }: { draft: DocsContent; update: Updater }) {
  const setLog = (fn: (c: ChangelogEntry[]) => ChangelogEntry[]) => update((d) => ({ ...d, changelog: fn(d.changelog) }));
  const patch = (i: number, p: Partial<ChangelogEntry>) => setLog((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div className="space-y-3">
      <button type="button" className={secondaryBtn} onClick={() => setLog((l) => [{ version: "", date: today(), notes: "" }, ...l])}>
        <Plus size={14} aria-hidden /> Add entry
      </button>
      <ul className="space-y-2">
        {draft.changelog.map((c, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-white p-3 md:grid-cols-[90px_150px_1fr_auto]">
            <input aria-label="Version" placeholder="0.7" className={input} value={c.version} onChange={(e) => patch(i, { version: e.target.value })} />
            <input aria-label="Date" type="date" className={input} value={c.date} onChange={(e) => patch(i, { date: e.target.value })} />
            <input aria-label="Notes" className={input} value={c.notes} onChange={(e) => patch(i, { notes: e.target.value })} />
            <button type="button" className={`${iconBtn} text-risk`} aria-label="Remove entry" onClick={() => setLog((l) => l.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ Versions

function VersionsTab({ canRestore, onRestored }: { canRestore: boolean; onRestored: (d: DocsContent) => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/docs/versions")
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { versions?: VersionInfo[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setVersions(j.versions ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load versions."));
  }, []);

  async function restore(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await postJson<{ draft: DocsContent }>("/api/docs/versions", { id });
      onRestored(r.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Every publish keeps a snapshot (the last 30). Restoring loads a snapshot into the draft; publish it to make it public.</p>
      {error && <p role="alert" className="text-[13px] text-risk">{error}</p>}
      {versions === null && !error && <p className="text-[13px] text-muted">Loading…</p>}
      {versions?.length === 0 && <p className="text-[13px] text-muted">Nothing published yet.</p>}
      <ul className="space-y-1.5">
        {versions?.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[13.5px]">
            <span>{formatDhaka(v.savedAt)}{i === 0 && <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[12px] text-success">current</span>}</span>
            {canRestore && <button type="button" className={secondaryBtn} disabled={busy !== null} onClick={() => restore(v.id)}>{busy === v.id ? "Loading…" : "Load into draft"}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
