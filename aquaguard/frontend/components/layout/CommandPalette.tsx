"use client";
/**
 * Command palette (Ctrl/Cmd+K): regions, modules, indicators, data sources and open alerts from GET /api/search,
 * plus the module list instantly. ARIA combobox + listbox; Arrow Up/Down move, Enter opens, Escape closes.
 * Choosing a region (or any result that carries ?region=) sets the global region and navigates.
 */
import { useRouter } from "next/navigation";
import { Bell, Database, Gauge, MapPin, Search, SquareStack } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Overlay";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store";
import type { SearchItem } from "@/lib/types/contract";
import { DATA_SOURCES, MODULES, SETTINGS } from "./nav";

const ICONS: Record<SearchItem["type"], typeof Search> = {
  region: MapPin, module: SquareStack, indicator: Gauge, source: Database, alert: Bell,
};
const LOCAL: SearchItem[] = [...MODULES, SETTINGS, DATA_SOURCES].map((m) => ({
  type: "module", id: m.href.slice(1), label: m.label, description: "desc" in m ? String(m.desc) : "", href: m.href,
}));

export function matchLocal(q: string, items: SearchItem[] = LOCAL): SearchItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter((i) => i.label.toLowerCase().includes(s) || i.description.toLowerCase().includes(s));
}

export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const setRegion = useAppStore((s) => s.setRegion);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<SearchItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useAppStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setRemote([]);
      setActive(0);
      return;
    }
    const term = q.trim();
    if (!term) {
      setRemote([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const t = setTimeout(() => {
      api.search(term, 12)
        .then((r) => { setRemote(r.data.items); setStatus("idle"); })
        .catch(() => { setRemote([]); setStatus("error"); });
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const items = useMemo(() => {
    const local = matchLocal(q);
    const seen = new Set(remote.map((i) => `${i.type}:${i.href}`));
    return [...remote, ...local.filter((i) => !seen.has(`${i.type}:${i.href}`))].slice(0, 15);
  }, [q, remote]);
  useEffect(() => setActive(0), [items.length]);

  const choose = (item: SearchItem) => {
    const url = new URL(item.href, window.location.origin);
    const region = url.searchParams.get("region"); // districts already link to their division
    if (region) setRegion(region);
    setOpen(false);
    router.push(`${url.pathname}${url.search}${url.hash}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    }
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Search AquaGuard" size="lg" initialFocus={input}
           description="Regions, modules, indicators, data sources and alerts. Use the arrow keys and Enter.">
      <div className="flex items-center gap-2 rounded-lg border border-control bg-white px-3 py-2">
        <Search size={16} aria-hidden className="text-muted" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
               role="combobox" aria-expanded={items.length > 0} aria-controls={listId} aria-autocomplete="list"
               aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
               aria-label="Search" placeholder="Search regions, modules, indicators…"
               className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" />
      </div>
      <p className="sr-only" aria-live="polite">
        {status === "loading" ? "Searching" : `${items.length} results`}
      </p>
      <ul id={listId} role="listbox" aria-label="Search results" className="mt-2 max-h-[50vh] overflow-y-auto">
        {items.map((it, i) => {
          const Icon = ICONS[it.type];
          return (
            <li key={`${it.type}-${it.id}-${it.href}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 ${i === active ? "bg-light" : ""}`}>
              <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-ink">{it.label}</span>
                <span className="block truncate text-[12px] text-muted">{it.type} · {it.description}</span>
              </span>
            </li>
          );
        })}
        {status === "error" && <li className="px-3 py-2 text-[12.5px] text-muted">Search is unavailable; modules are listed instead.</li>}
        {q.trim() && status === "idle" && !items.length && <li className="px-3 py-2 text-[12.5px] text-muted">No results for “{q}”.</li>}
      </ul>
    </Modal>
  );
}

export function SearchButton() {
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  return (
    <button type="button" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K" title="Search (Ctrl+K)"
            className="inline-flex items-center gap-2 rounded-lg border border-control/60 bg-white/80 px-2.5 py-1.5 text-[13px] text-muted transition hover:border-primary hover:text-ink">
      <Search size={15} aria-hidden />
      <span className="sr-only lg:not-sr-only">Search</span>
      <kbd aria-hidden className="hidden rounded border border-border px-1 text-[10.5px] font-medium lg:inline">Ctrl K</kbd>
    </button>
  );
}
