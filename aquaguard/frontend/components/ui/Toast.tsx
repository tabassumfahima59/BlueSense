"use client";
/** Toasts: `toast("message", "success")` from anywhere; rendered by <Toaster/> in a polite live region. */
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { create } from "zustand";

type Tone = "info" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const useToasts = create<{ items: ToastItem[]; push: (t: ToastItem) => void; dismiss: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.slice(-3), t] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

let seq = 0;
export function toast(message: string, tone: Tone = "info", timeoutMs = 6000): void {
  const id = ++seq;
  useToasts.getState().push({ id, message, tone });
  if (timeoutMs > 0) setTimeout(() => useToasts.getState().dismiss(id), timeoutMs);
}

const ICON = { info: Info, success: CheckCircle2, error: AlertTriangle };
const TONE = { info: "text-primary", success: "text-success", error: "text-risk" };

export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div key={t.id} className="glass animate-fade-in pointer-events-auto flex items-start gap-2.5 p-3 text-[13px] text-ink">
            <Icon size={17} className={`mt-0.5 shrink-0 ${TONE[t.tone]}`} aria-hidden />
            <span className="flex-1 leading-relaxed">{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded p-0.5 text-muted transition hover:bg-light hover:text-ink">
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
