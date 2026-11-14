/** Status shown as icon + text (never colour alone). */
import { AlertTriangle, CheckCircle2, CircleOff, XCircle } from "lucide-react";
import type { Tone } from "@/lib/flow/derive";

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-[#166534]", warn: "text-[#92400e]", bad: "text-[#b42318]", off: "text-[#475569]",
};
export const TONE_BG: Record<Tone, string> = {
  good: "bg-[#ecfdf3] border-[#abefc6]", warn: "bg-[#fffaeb] border-[#fedf89]", bad: "bg-[#fef3f2] border-[#fecdca]",
  off: "bg-[#f2f4f7] border-[#d0d5dd]",
};

export function ToneIcon({ tone, size = 13 }: { tone: Tone; size?: number }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "bad" ? XCircle : CircleOff;
  return <Icon size={size} aria-hidden className={`shrink-0 ${TONE_TEXT[tone]}`} />;
}

export function StatusText({ status, className = "" }: { status: { label: string; tone: Tone }; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${TONE_TEXT[status.tone]} ${className}`}>
      <ToneIcon tone={status.tone} /> {status.label}
    </span>
  );
}

export function StatusPill({ status }: { status: { label: string; tone: Tone } }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${TONE_BG[status.tone]} ${TONE_TEXT[status.tone]}`}>
      <ToneIcon tone={status.tone} size={12} /> {status.label}
    </span>
  );
}
