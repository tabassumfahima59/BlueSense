"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Droplets, X } from "lucide-react";
import { DATA_SOURCES, MODULES } from "./nav";
import { useShareQuery } from "./UrlSync";

function NavItem({ href, label, Icon, active, compact, onNavigate }: {
  href: string; label: string; Icon: typeof Droplets; active: boolean; compact: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={compact ? label : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition ${
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-bg hover:text-ink"
      } ${compact ? "md:justify-center md:px-0 lg:justify-start lg:px-3" : ""}`}
    >
      <Icon size={18} aria-hidden className="shrink-0" />
      <span className={compact ? "md:sr-only lg:not-sr-only" : ""}>{label}</span>
    </Link>
  );
}

export function SidebarContent({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const qs = useShareQuery();
  return (
    <div className="flex h-full flex-col">
      <Link href={`/command-center${qs}`} onClick={onNavigate} className={`flex items-center gap-2 px-4 py-4 ${compact ? "md:justify-center md:px-0 lg:justify-start lg:px-4" : ""}`}>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-white">
          <Droplets size={18} aria-hidden />
        </span>
        <span className={`leading-tight ${compact ? "md:sr-only lg:not-sr-only" : ""}`}>
          <span className="block text-[15px] font-semibold text-ink">AquaGuard</span>
          <span className="block text-[11px] text-muted">Water intelligence · Bangladesh</span>
        </span>
      </Link>
      <nav aria-label="Modules" className="flex-1 space-y-0.5 px-2">
        {MODULES.map((m) => (
          <NavItem key={m.href} href={`${m.href}${qs}`} label={m.label} Icon={m.icon} active={pathname.startsWith(m.href)} compact={compact} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="border-t border-border px-2 py-3">
        <NavItem href={`${DATA_SOURCES.href}${qs}`} label={DATA_SOURCES.label} Icon={DATA_SOURCES.icon} active={pathname.startsWith(DATA_SOURCES.href)} compact={compact} onNavigate={onNavigate} />
        <p className={`px-3 pt-2 text-[11px] leading-snug text-muted ${compact ? "md:hidden lg:block" : ""}`}>
          Decision support prototype. Not a replacement for field monitoring, lab testing or government systems.
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen shrink-0 border-r border-border bg-sidebar md:block md:w-[72px] lg:w-[240px]">
      <SidebarContent compact />
    </aside>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button className="absolute inset-0 bg-ink/30" aria-label="Close navigation" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 w-[260px] bg-sidebar shadow-xl">
        <button onClick={onClose} aria-label="Close navigation" className="absolute right-2 top-3 rounded-md p-1.5 text-muted hover:bg-bg">
          <X size={18} />
        </button>
        <SidebarContent compact={false} onNavigate={onClose} />
      </div>
    </div>
  );
}
