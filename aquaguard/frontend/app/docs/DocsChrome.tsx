"use client";
import { Download, FileText, Link2, Printer, Search, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { searchDocs, type SearchEntry } from "@/lib/docs/markdown";

function highlight(text: string, q: string): ReactNode {
  const query = q.trim();
  if (!query) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const j = lower.indexOf(needle, i);
    if (j < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (j > i) parts.push(text.slice(i, j));
    parts.push(<mark key={k++}>{text.slice(j, j + needle.length)}</mark>);
    i = j + needle.length;
  }
  return parts;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copies the URL of one section (#anchor). */
export function CopyLink({ slug, title }: { slug: string; title: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="docs-no-print inline-grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-light hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      aria-label={`Copy link to ${title}`}
      title={done ? "Link copied" : "Copy link to this section"}
      onClick={async () => {
        const ok = await copy(`${window.location.origin}/docs#${slug}`);
        setDone(ok);
        if (ok) setTimeout(() => setDone(false), 1500);
      }}
    >
      <Link2 size={15} aria-hidden />
    </button>
  );
}

interface NavItem { slug: string; title: string; group: "pitch" | "technical" }

/**
 * Page chrome for /docs: sticky section navigation with the active section, a search box ("/" focuses it) that
 * filters sections and lists highlighted matches, and the share / Markdown / PDF actions.
 */
export function DocsChrome({ nav, index, isAdmin, children }: {
  nav: NavItem[];
  index: SearchEntry[];
  isAdmin: boolean;
  children: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string>(nav[0]?.slug ?? "");
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchDocs(index, q), [index, q]);
  const searching = q.trim().length >= 2;

  // Hide sections that do not match while searching.
  useEffect(() => {
    const match = new Set(results.map((r) => r.slug));
    for (const item of nav) {
      const el = document.getElementById(item.slug);
      if (el) el.hidden = searching && !match.has(item.slug);
    }
  }, [results, searching, nav]);

  // "/" focuses the search box (the global Ctrl/Cmd+K palette is left alone).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === input.current) setQ("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Highlight the section currently in view.
  useEffect(() => {
    const els = nav.map((n) => document.getElementById(n.slug)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [nav]);

  const share = useCallback(async () => {
    const ok = await copy(`${window.location.origin}/docs`);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1500);
  }, []);

  const groups: { name: string; items: NavItem[] }[] = [
    { name: "Pitch deck", items: nav.filter((n) => n.group === "pitch") },
    { name: "Technical", items: nav.filter((n) => n.group === "technical") },
  ];
  const matched = new Set(results.map((r) => r.slug));

  return (
    <div className="docs-layout grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="docs-no-print lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <div className="card p-3">
          <label className="relative block">
            <span className="sr-only">Search the docs</span>
            <Search size={15} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search  ( / )"
              className="w-full rounded-lg border border-control bg-white py-1.5 pl-8 pr-8 text-[14px] focus:outline focus:outline-2 focus:outline-primary"
            />
            {q && (
              <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                <X size={15} aria-hidden />
              </button>
            )}
          </label>
          {searching && (
            <div className="docs-search-hit mt-2 max-h-72 overflow-y-auto" aria-live="polite">
              <p className="mb-1 text-[12px] text-muted">{results.length} section{results.length === 1 ? "" : "s"} match</p>
              <ul className="space-y-1.5">
                {results.map((r) => (
                  <li key={r.slug}>
                    <a href={`#${r.slug}`} className="block rounded-lg px-2 py-1.5 hover:bg-light">
                      <span className="block text-[13px] font-semibold text-ink">{highlight(r.title, q)}</span>
                      <span className="block text-[12px] leading-snug text-muted">{highlight(r.snippet, q)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <nav aria-label="Docs sections" className="mt-3 space-y-3">
            {groups.map((g) => (
              <div key={g.name}>
                <p className="px-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{g.name}</p>
                <ul className="mt-1 space-y-0.5">
                  {g.items.map((n) => (
                    <li key={n.slug}>
                      <a
                        href={`#${n.slug}`}
                        aria-current={active === n.slug ? "true" : undefined}
                        className={`block rounded-lg px-2 py-1 text-[13.5px] ${active === n.slug ? "bg-primary-soft font-semibold text-primary" : "text-ink hover:bg-light"} ${searching && !matched.has(n.slug) ? "opacity-40" : ""}`}
                      >
                        {n.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-border pt-3 text-[13px]">
            <button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ink hover:bg-light">
              <Link2 size={15} aria-hidden /> {copied ? "Link copied" : "Copy shareable link"}
            </button>
            <a href="/api/docs/export" className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-ink hover:bg-light">
              <Download size={15} aria-hidden /> Download Markdown
            </a>
            <button type="button" onClick={() => window.print()} title="Opens the print dialog: choose “Save as PDF”" className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ink hover:bg-light">
              <Printer size={15} aria-hidden /> Download PDF (via Save as PDF)
            </button>
            <Link href="/command-center" className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-ink hover:bg-light">
              <FileText size={15} aria-hidden /> Open the app
            </Link>
            {isAdmin && (
              <Link href="/docs/admin" className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 font-semibold text-primary hover:bg-light">
                <Settings2 size={15} aria-hidden /> Admin panel
              </Link>
            )}
          </div>
        </div>
      </aside>
      <div className="min-w-0 space-y-5">{children}</div>
    </div>
  );
}
