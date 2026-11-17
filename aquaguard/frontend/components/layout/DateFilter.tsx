"use client";
/**
 * Global date filter (months). It appears only on pages that use dates: such a page registers the months it has
 * data for with `useDateBounds`; the filter then snaps to that range and the selection is kept in the URL
 * (?from=YYYY-MM&to=YYYY-MM) so the view can be shared.
 */
import { CalendarRange, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { type DateBounds, useAppStore } from "@/lib/store";
import { monthLabel } from "@/lib/format/time";

/** Pages that use dates call this with their data range (null while loading). */
export function useDateBounds(bounds: DateBounds | null): void {
  const setBounds = useAppStore((s) => s.setDateBounds);
  const key = bounds ? `${bounds.min}|${bounds.max}|${bounds.label}|${bounds.defaultFrom}|${bounds.defaultTo}` : "";
  useEffect(() => {
    setBounds(bounds);
    return () => setBounds(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setBounds]);
}

/** Clamp the selected range to the page's bounds; an unset end falls back to the page's default window. */
export function effectiveRange(range: { from: string | null; to: string | null }, b: DateBounds | null) {
  if (!b) return { from: null, to: null };
  const from = range.from && range.from >= b.min && range.from <= b.max ? range.from : b.defaultFrom ?? b.min;
  const to = range.to && range.to <= b.max && range.to >= b.min ? range.to : b.defaultTo ?? b.max;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Keep points whose t (YYYY-MM or YYYY-MM-DD) falls inside the range. */
export function inRange(t: string, r: { from: string | null; to: string | null }): boolean {
  const m = t.slice(0, 7);
  return (!r.from || m >= r.from) && (!r.to || m <= r.to);
}

export function DateFilter() {
  const bounds = useAppStore((s) => s.dateBounds);
  const range = useAppStore((s) => s.dateRange);
  const setRange = useAppStore((s) => s.setDateRange);
  if (!bounds) return null;
  const eff = effectiveRange(range, bounds);
  const changed = Boolean(range.from || range.to);
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <legend className="sr-only">Date range ({bounds.label})</legend>
      <CalendarRange size={15} className="text-primary" aria-hidden />
      <label className="sr-only" htmlFor="date-from">From month</label>
      <input id="date-from" type="month" value={eff.from ?? ""} min={bounds.min} max={eff.to ?? bounds.max}
             onChange={(e) => setRange({ from: e.target.value || null, to: range.to })}
             className="w-[152px] rounded-lg border bg-white px-2 py-1 text-[13px] text-ink" />
      <span className="text-muted" aria-hidden>–</span>
      <label className="sr-only" htmlFor="date-to">To month</label>
      <input id="date-to" type="month" value={eff.to ?? ""} min={eff.from ?? bounds.min} max={bounds.max}
             onChange={(e) => setRange({ from: range.from, to: e.target.value || null })}
             className="w-[152px] rounded-lg border bg-white px-2 py-1 text-[13px] text-ink" />
      {changed && (
        <button type="button" onClick={() => setRange({ from: null, to: null })} aria-label="Reset date range"
                className="rounded-md p-1 text-muted transition hover:bg-light hover:text-ink">
          <RotateCcw size={14} aria-hidden />
        </button>
      )}
      <span className="hidden text-[11.5px] text-muted 2xl:inline">
        {bounds.label}: {monthLabel(bounds.min)} – {monthLabel(bounds.max)}
      </span>
    </fieldset>
  );
}
