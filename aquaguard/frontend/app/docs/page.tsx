import { ExternalLink, Lock } from "lucide-react";
import type { Metadata } from "next";
import { currentRole } from "@/lib/docs/auth";
import { loadLive, type LiveData } from "@/lib/docs/live";
import { buildSearchIndex, sectionsByGroup } from "@/lib/docs/markdown";
import { getPublicConfig, getPublicContent } from "@/lib/docs/store";
import type { DocsContent, DocSection, Visibility } from "@/lib/docs/types";
import { describeVisibility, formatDhaka, isDocsVisible } from "@/lib/docs/visibility";
import { CopyLink, DocsChrome } from "./DocsChrome";
import { Analytics, ApiList, Changelog, FeatureMatrix, LiveStatus, SourceTable } from "./LiveBlocks";
import { Markdown } from "./Markdown";
import { Mermaid } from "./Mermaid";
import { TeamGrid } from "./TeamGrid";

// Visibility depends on the time of each request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const vis = isDocsVisible(await getPublicConfig());
  return vis.visible ? {} : { robots: { index: false, follow: false } };
}

function Closed({ vis }: { vis: Visibility }) {
  return (
    <div className="mx-auto mt-16 max-w-xl">
      <div className="card p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Lock size={22} aria-hidden />
        </div>
        <h1 className="mt-4 text-[22px] font-semibold text-ink">BlueSense docs are not available right now</h1>
        <p className="mt-2 text-[14.5px] text-muted">
          {vis.reason === "before-window" && vis.opensAt
            ? `They open on ${formatDhaka(vis.opensAt)}.`
            : "The team has closed this page for now. Please check back later."}
        </p>
      </div>
    </div>
  );
}

function Special({ section, content, live }: { section: DocSection; content: DocsContent; live: LiveData }) {
  switch (section.kind) {
    case "team":
      return <TeamGrid name={content.team.name} members={content.team.members} />;
    case "live":
      return (
        <div className="space-y-4">
          <LiveStatus live={live} />
          <div>
            <p className="mb-2 text-[14px] font-semibold text-ink">Data sources</p>
            <SourceTable live={live} />
          </div>
        </div>
      );
    case "features":
      return <FeatureMatrix features={content.features} live={live} />;
    case "architecture":
      return content.diagrams.architecture ? <Mermaid code={content.diagrams.architecture} label="BlueSense architecture diagram" /> : null;
    case "dataflow":
      return content.diagrams.dataflow ? <Mermaid code={content.diagrams.dataflow} label="BlueSense data flow diagram" /> : null;
    case "api":
      return <ApiList live={live} />;
    case "analytics":
      return <Analytics live={live} />;
    case "changelog":
      return <Changelog entries={content.changelog} />;
    default:
      return null;
  }
}

export default async function DocsPage() {
  const [role, config] = await Promise.all([currentRole(), getPublicConfig()]);
  const vis = isDocsVisible(config);
  if (!vis.visible && !role) return <Closed vis={vis} />;

  const [{ content, source }, live] = await Promise.all([getPublicContent(), loadLive()]);
  const groups = sectionsByGroup(content);
  const all = [...groups.pitch, ...groups.technical];
  const nav = all.map((s) => ({ slug: s.slug, title: s.title, group: s.group }));
  const parts = [
    { key: "pitch", label: "Pitch deck", list: groups.pitch },
    { key: "technical", label: "Technical documentation", list: groups.technical },
  ].filter((p) => p.list.length > 0);
  const links = [
    { href: content.links.liveApp, label: "Live app" },
    { href: content.links.video, label: "Pitch video" },
    { href: content.links.repo, label: "GitHub" },
    { href: content.links.design, label: "Design" },
  ].filter((l) => l.href);

  return (
    <div className="space-y-5">
      {role && (
        <div className="docs-no-print rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13.5px] text-warning">
          Signed in as {role === "superadmin" ? "Super Admin" : "Admin"} · {vis.visible ? "Public now" : "Preview — not public"}:{" "}
          {describeVisibility(vis)}
          {source === "seed" ? " · showing the initial content (nothing published yet)" : ""}
        </div>
      )}

      <header className="card overflow-hidden p-6 sm:p-8">
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-primary">Pitch deck · Technical docs · Live system</p>
        <h1 className="mt-2 text-[30px] font-bold leading-tight text-ink sm:text-[38px]">{content.title}</h1>
        {content.tagline && <p className="mt-1 text-[18px] font-medium text-primary-dark">{content.tagline}</p>}
        <div className="mt-4 rounded-xl border border-border bg-white/70 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">The 2-minute summary</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{content.summary}</p>
        </div>
        {links.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {links.map((l, i) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                 className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] font-semibold ${i === 0 ? "bg-primary text-white hover:bg-primary-dark" : "border border-control bg-white text-ink hover:bg-light"}`}>
                {l.label} <ExternalLink size={13} aria-hidden />
              </a>
            ))}
          </div>
        )}
        <p className="mt-3 text-[12px] text-muted">Content updated {formatDhaka(content.updatedAt)}</p>
      </header>

      <DocsChrome nav={nav} index={buildSearchIndex(content)} isAdmin={!!role}>
        {parts.map((part) => (
          <div key={part.key} className="space-y-5">
            <h2 className="px-1 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">{part.label}</h2>
            {part.list.map((s) => (
              <section key={s.id} id={s.slug} aria-labelledby={`${s.slug}-title`} className="docs-section card scroll-mt-6 p-5 sm:p-6">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 id={`${s.slug}-title`} className="text-[19px] font-semibold text-ink">{s.title}</h3>
                  <CopyLink slug={s.slug} title={s.title} />
                </div>
                {s.body.trim() && <Markdown>{s.body}</Markdown>}
                {s.kind !== "markdown" && (
                  <div className={s.body.trim() ? "mt-4" : ""}>
                    <Special section={s} content={content} live={live} />
                  </div>
                )}
              </section>
            ))}
          </div>
        ))}
      </DocsChrome>
      {all.length === 0 && <p className="text-muted">No sections are published yet.</p>}
    </div>
  );
}
