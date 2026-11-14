"use client";
/**
 * Sidebar: blue gradient (#0868CC -> #0755B8) with white labels (5.4:1 and 7.0:1), active highlight and hover.
 * Desktop: collapsible (state saved in localStorage). Mobile: a drawer opened from the top bar.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Droplets, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { focusables } from "@/components/ui/Overlay";
import { useAppStore } from "@/lib/store";
import { DATA_SOURCES, MODULES, SETTINGS } from "./nav";
import { useShareQuery } from "./UrlSync";

function NavItem({ href, label, Icon, active, collapsed, onNavigate }: {
  href: string; label: string; Icon: typeof Droplets; active: boolean; collapsed: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition ${
        active ? "bg-white text-primary-dark shadow-sm" : "text-white hover:bg-white/15"
      } ${collapsed ? "justify-center px-0" : ""}`}
    >
      {active && !collapsed && <span className="absolute -left-2 top-1.5 bottom-1.5 w-1 rounded-r bg-white" aria-hidden />}
      <Icon size={18} aria-hidden className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

export function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const qs = useShareQuery();
  return (
    <div className="on-blue flex h-full flex-col">
      <Link href={`/command-center${qs}`} onClick={onNavigate}
            className={`flex items-center gap-2.5 px-4 py-4 ${collapsed ? "justify-center px-0" : ""}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm">
          <Droplets size={19} aria-hidden />
        </span>
        {collapsed && <span className="sr-only">AquaGuard</span>}
        {!collapsed && (
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold text-white">AquaGuard</span>
            <span className="block text-[11.5px] text-white/90">Water intelligence · Bangladesh</span>
          </span>
        )}
      </Link>
      <nav aria-label="Modules" className="flex-1 space-y-1 overflow-y-auto px-2.5">
        {MODULES.map((m) => (
          <NavItem key={m.href} href={`${m.href}${qs}`} label={m.label} Icon={m.icon} active={pathname.startsWith(m.href)}
                   collapsed={collapsed} onNavigate={onNavigate} />
        ))}
        <div className="my-2 border-t border-white/20" />
        <NavItem href={`${SETTINGS.href}${qs}`} label={SETTINGS.label} Icon={SETTINGS.icon} active={pathname.startsWith(SETTINGS.href)}
                 collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem href={`${DATA_SOURCES.href}${qs}`} label={DATA_SOURCES.label} Icon={DATA_SOURCES.icon}
                 active={pathname.startsWith(DATA_SOURCES.href)} collapsed={collapsed} onNavigate={onNavigate} />
      </nav>
      {!collapsed && (
        <p className="px-4 pb-4 pt-3 text-[11.5px] leading-snug text-white/90">
          Decision support prototype. Not a replacement for field monitoring, lab testing or government systems.
        </p>
      )}
    </div>
  );
}

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  return (
    <aside className={`sidebar-blue sticky top-0 hidden h-screen shrink-0 transition-[width] md:flex md:flex-col ${collapsed ? "w-[76px]" : "w-[244px]"}`}>
      <div className="min-h-0 flex-1">
        <SidebarContent collapsed={collapsed} />
      </div>
      <button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="on-blue m-2.5 flex items-center justify-center gap-2 rounded-xl border border-white/30 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-white/15">
        {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden /> Collapse</>}
      </button>
    </aside>
  );
}

/** Rendered in a portal: the glass top bar (backdrop-filter) would otherwise become the containing block of this
 * fixed-position drawer and confine it to the bar's height. */
export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    focusables(ref.current)[0]?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button className="absolute inset-0 bg-ink/35" aria-label="Close navigation" onClick={onClose} />
      <div ref={ref} className="sidebar-blue animate-slide-in absolute inset-y-0 left-0 w-[270px] shadow-xl">
        <button onClick={onClose} aria-label="Close navigation" className="on-blue absolute right-2 top-4 rounded-md p-1.5 text-white hover:bg-white/15">
          <X size={18} aria-hidden />
        </button>
        <SidebarContent collapsed={false} onNavigate={onClose} />
      </div>
    </div>,
    document.body,
  );
}
