"use client";
/**
 * Popover (button + panel) and Dropdown (menu) with keyboard support: the trigger exposes aria-expanded, Escape and
 * an outside click close the panel and return focus to the trigger; Dropdown items use role="menuitem" with
 * Arrow Up/Down, Home/End navigation.
 */
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export function Popover({ trigger, label, children, align = "right", width = "w-80", panelLabel, onOpenChange }: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: string;
  panelLabel?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const set = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) set(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        set(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => {
    set(false);
    btn.current?.focus();
  };
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
              onClick={() => set(!open)}
              className="inline-flex items-center gap-1.5 rounded-lg p-1.5 text-muted transition hover:bg-light hover:text-ink">
        {trigger}
      </button>
      {open && (
        <div ref={panel} id={id} role="region" aria-label={panelLabel ?? label}
             className={`glass animate-fade-in absolute top-full z-50 mt-2 ${width} max-w-[calc(100vw-2rem)] p-2 ${align === "right" ? "right-0" : "left-0"}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
}

export function Dropdown({ trigger, label, items, header, align = "right" }: {
  trigger: ReactNode;
  label: string;
  items: MenuItem[];
  header?: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    }
  };
  const itemCls = "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-light focus:bg-light focus:outline-none";
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
              aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)}
              onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
              className="inline-flex items-center gap-1.5 rounded-lg p-1.5 text-muted transition hover:bg-light hover:text-ink">
        {trigger}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} onKeyDown={onKey}
             className={`glass animate-fade-in absolute top-full z-50 mt-2 w-64 p-1.5 ${align === "right" ? "right-0" : "left-0"}`}>
          {header && <div className="border-b border-border px-2.5 pb-2 pt-1">{header}</div>}
          {items.map((it) => {
            const body = (
              <>
                {it.icon && <span className="mt-0.5 text-muted" aria-hidden>{it.icon}</span>}
                <span className="min-w-0">
                  <span className="block font-medium">{it.label}</span>
                  {it.description && <span className="block text-[12px] text-muted">{it.description}</span>}
                </span>
              </>
            );
            return it.href ? (
              <Link key={it.id} href={it.href} role="menuitem" tabIndex={-1} className={itemCls} onClick={() => setOpen(false)}>
                {body}
              </Link>
            ) : (
              <button key={it.id} type="button" role="menuitem" tabIndex={-1} className={itemCls}
                      onClick={() => { setOpen(false); it.onSelect?.(); }}>
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
