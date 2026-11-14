import { AlertTriangle, DatabaseZap, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function LoadingCard({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="card space-y-3 p-5" role="status" aria-label={label}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function ErrorCard({ error, onRetry, title = "Could not load data" }: { error: Error; onRetry?: () => void; title?: string }) {
  return (
    <div className="card flex flex-col items-start gap-2 border-risk/40 p-5" role="alert">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <AlertTriangle size={18} className="text-risk" aria-hidden /> {title}
      </div>
      <p className="text-[13px] text-muted">{error.message}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-control bg-white px-3 py-1.5 text-[13px] font-medium transition hover:bg-light">
          <RefreshCw size={14} aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

/** Shared name from the design system (master prompt §5). */
export const ErrorState = ErrorCard;

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-control/60 bg-light/60 p-5">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <DatabaseZap size={18} className="text-muted" aria-hidden /> {title}
      </div>
      <div className="text-[13px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** Renders loading / error / content for an ApiState. */
export function Async<T>({ state, children, rows, label }: {
  state: { data?: T; error?: Error; loading: boolean; retry: () => void };
  children: (data: T) => ReactNode;
  rows?: number;
  label?: string;
}) {
  if (state.error && !state.data) return <ErrorCard error={state.error} onRetry={state.retry} />;
  if (!state.data) return <LoadingCard rows={rows} label={label} />;
  return <>{children(state.data)}</>;
}
