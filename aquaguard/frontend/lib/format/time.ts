/** Time helpers for status labels. Weather valid times carry their +06:00 offset; retrieval times are UTC (Z). */

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(ym: string | null | undefined): string {
  if (!ym || !/^\d{4}-\d{2}/.test(ym)) return ym ?? "—";
  return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

export function parseTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5 min ago", "3 h ago", "2 days ago" (never negative). */
export function fmtAgo(s: string | null | undefined, now: Date = new Date()): string {
  const d = parseTime(s);
  if (!d) return "never";
  const sec = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (sec < 90) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 48 * 3600) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} days ago`;
}

export function fmtDateTime(s: string | null | undefined): string {
  const d = parseTime(s);
  if (!d) return s ?? "—";
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) + " (UTC+6)";
}
