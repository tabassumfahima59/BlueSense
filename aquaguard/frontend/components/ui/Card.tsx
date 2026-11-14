import type { ReactNode } from "react";

export function Card({ title, subtitle, actions, children, className = "", id }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`card p-4 sm:p-5 ${className}`} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Glass surface (master prompt §5). `Card` is kept as the name used across the existing pages. */
export const GlassCard = Card;

export function PageHeader({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-[14px] text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, type = "button", ariaLabel, className = "" }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
  className?: string;
}) {
  const v = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "border border-control bg-white text-ink hover:bg-light",
    ghost: "text-muted hover:bg-light hover:text-ink",
  }[variant];
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-control bg-white p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition ${o.value === value ? "bg-primary text-white" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const t = tone === "warn" ? "border-warning/50 bg-[#fff6e6] text-[#6b4a07]" : "border-border bg-light/70 text-muted";
  return <div className={`rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${t}`}>{children}</div>;
}
