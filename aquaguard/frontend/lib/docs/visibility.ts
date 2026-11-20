/**
 * Visibility schedule for /docs. Pure functions (no I/O) so the rules are unit-tested.
 *
 * Times are stored in UTC. Admins enter and read them in Asia/Dhaka (UTC+06:00, no daylight saving), so the
 * conversion is a fixed offset.
 */
import type { DocsConfig, Visibility } from "./types";

export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
export const MAX_DURATION_HOURS = 24 * 366;

/** Default when nothing is stored yet: public, no window. Admins set the judging window in /docs/admin. */
export const DEFAULT_CONFIG: DocsConfig = {
  enabled: true,
  mode: "always",
  startUtc: null,
  endUtc: null,
  durationHours: null,
  timezone: "Asia/Dhaka",
  updatedAt: "1970-01-01T00:00:00.000Z",
  updatedBy: "default",
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

const iso = (t: number) => new Date(t).toISOString();

/** The end of the public window in ms, or null when the schedule is incomplete or invalid. */
export function windowEnd(config: DocsConfig, start: number): number | null {
  if (config.mode === "window") return parseTime(config.endUtc);
  if (config.mode === "duration") {
    const h = config.durationHours;
    if (typeof h !== "number" || !Number.isFinite(h) || h <= 0 || h > MAX_DURATION_HOURS) return null;
    return start + h * 60 * 60 * 1000;
  }
  return null;
}

/**
 * Whether /docs is public at `now`. Both ends are inclusive (open from the start instant up to and including the end
 * instant). An incomplete or reversed schedule closes the page (safe default) and reports "invalid".
 */
export function isDocsVisible(config: DocsConfig, now: Date = new Date()): Visibility {
  if (!config.enabled) return { visible: false, reason: "disabled" };
  if (config.mode === "always") return { visible: true, reason: "always" };
  const start = parseTime(config.startUtc);
  if (start === null) return { visible: false, reason: "invalid" };
  const end = windowEnd(config, start);
  if (end === null || end <= start) return { visible: false, reason: "invalid" };
  const t = now.getTime();
  if (t < start) return { visible: false, reason: "before-window", opensAt: iso(start), closesAt: iso(end) };
  if (t > end) return { visible: false, reason: "after-window", opensAt: iso(start), closesAt: iso(end) };
  return { visible: true, reason: "in-window", opensAt: iso(start), closesAt: iso(end) };
}

/** "2026-11-20T00:00" (an <input type="datetime-local"> value in Dhaka time) → UTC ISO string, or null. */
export function dhakaLocalToUtc(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const t = Date.parse(`${local}:00+06:00`);
  return Number.isFinite(t) ? iso(t) : null;
}

/** UTC ISO string → "YYYY-MM-DDTHH:mm" in Dhaka time, for an <input type="datetime-local">. */
export function utcToDhakaLocal(utc: string | null): string {
  const t = parseTime(utc);
  return t === null ? "" : new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}

/** Human-readable Dhaka time, e.g. "20 Nov 2026, 08:00 (Dhaka)". */
export function formatDhaka(utc: string | null | undefined): string {
  const t = parseTime(utc);
  if (t === null) return "—";
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
  return `${s} (Dhaka)`;
}

export function describeVisibility(v: Visibility): string {
  switch (v.reason) {
    case "always": return "Public (no time limit)";
    case "in-window": return `Public until ${formatDhaka(v.closesAt)}`;
    case "before-window": return `Opens ${formatDhaka(v.opensAt)}`;
    case "after-window": return `Closed since ${formatDhaka(v.closesAt)}`;
    case "disabled": return "Turned off by an admin";
    case "invalid": return "Closed: the schedule is incomplete";
  }
}
