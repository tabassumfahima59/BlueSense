/**
 * Plain-text helpers for /docs: the Markdown export and the client-side search index. Pure functions.
 */
import type { DocsContent, DocSection } from "./types";

export function visibleSections(content: DocsContent): DocSection[] {
  return content.sections.filter((s) => s.visible).sort((a, b) => a.order - b.order);
}

export function sectionsByGroup(content: DocsContent): { pitch: DocSection[]; technical: DocSection[] } {
  const all = visibleSections(content);
  return { pitch: all.filter((s) => s.group === "pitch"), technical: all.filter((s) => s.group === "technical") };
}

/** Markdown → readable plain text (for search snippets). Good enough for headings, lists, links, tables and code. */
export function markdownToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SearchEntry {
  slug: string;
  title: string;
  group: DocSection["group"];
  text: string;
}

/** One entry per visible section; the team section also indexes member names and roles. */
export function buildSearchIndex(content: DocsContent): SearchEntry[] {
  return visibleSections(content).map((s) => {
    let text = markdownToText(s.body);
    if (s.kind === "team") text += " " + content.team.members.map((m) => `${m.fullName} ${m.role}`).join(" ");
    if (s.kind === "features") text += " " + content.features.map((f) => `${f.name} ${f.status} ${f.area}`).join(" ");
    if (s.kind === "changelog") text += " " + content.changelog.map((c) => `${c.version} ${c.notes}`).join(" ");
    return { slug: s.slug, title: s.title, group: s.group, text: text.trim() };
  });
}

/** Case-insensitive search; returns matches with a short snippet around the first hit. */
export function searchDocs(index: SearchEntry[], query: string, snippet = 70): (SearchEntry & { snippet: string })[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const out: (SearchEntry & { snippet: string })[] = [];
  for (const e of index) {
    const title = e.title.toLowerCase();
    const text = e.text.toLowerCase();
    // A section matches when every word of the query appears in its title or its text.
    if (!words.every((w) => title.includes(w) || text.includes(w))) continue;
    // Snippet around the exact phrase if present, else around the first query word found in the text.
    let pos = text.indexOf(q);
    let len = q.length;
    if (pos < 0) {
      const first = words.find((w) => text.includes(w));
      pos = first ? text.indexOf(first) : -1;
      len = first ? first.length : 0;
    }
    let snip = e.text.slice(0, snippet * 2);
    if (pos >= 0) {
      const from = Math.max(0, pos - snippet);
      snip = (from > 0 ? "… " : "") + e.text.slice(from, pos + len + snippet) + (pos + len + snippet < e.text.length ? " …" : "");
    }
    out.push({ ...e, snippet: snip });
  }
  return out;
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The published content as one Markdown document (the "Markdown export"). */
export function toMarkdown(content: DocsContent, generatedAt = new Date()): string {
  const lines: string[] = [];
  lines.push(`# ${content.title}`, "");
  if (content.tagline) lines.push(`**${content.tagline}**`, "");
  if (content.summary) lines.push(content.summary, "");
  const labels: Record<keyof DocsContent["links"], string> = { liveApp: "Live app", video: "Pitch video", repo: "Repository", design: "Design" };
  const links = (Object.keys(labels) as (keyof DocsContent["links"])[]).filter((k) => content.links[k]);
  if (links.length) {
    lines.push(links.map((k) => `- ${labels[k]}: ${content.links[k]}`).join("\n"), "");
  }
  const groups = sectionsByGroup(content);
  for (const [name, list] of [["Pitch deck", groups.pitch], ["Technical documentation", groups.technical]] as const) {
    if (!list.length) continue;
    lines.push(`## ${name}`, "");
    for (const s of list) {
      lines.push(`### ${s.title}`, "", s.body.trim(), "");
      if (s.kind === "team") {
        if (content.team.name) lines.push(`Team: ${content.team.name}`, "");
        for (const m of content.team.members) {
          lines.push(`- **${m.fullName}**${m.role ? ` — ${m.role}` : ""}${m.showEmail && m.email ? ` (${m.email})` : ""}`);
        }
        if (content.team.members.length) lines.push("");
      }
      if (s.kind === "features" && content.features.length) {
        lines.push("| Feature | Status | Area | Evidence |", "|---|---|---|---|");
        for (const f of content.features) lines.push(`| ${esc(f.name)} | ${f.status} | ${esc(f.area)} | ${esc(f.evidence)} |`);
        lines.push("");
      }
      if (s.kind === "architecture" && content.diagrams.architecture) lines.push("```mermaid", content.diagrams.architecture, "```", "");
      if (s.kind === "dataflow" && content.diagrams.dataflow) lines.push("```mermaid", content.diagrams.dataflow, "```", "");
      if (s.kind === "changelog") {
        for (const c of content.changelog) lines.push(`- **${c.version}** (${c.date}): ${c.notes}`);
        if (content.changelog.length) lines.push("");
      }
    }
  }
  lines.push("---", `Exported ${generatedAt.toISOString()} from the BlueSense /docs page. Live values are not included.`, "");
  return lines.join("\n");
}
