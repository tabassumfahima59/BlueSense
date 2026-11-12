"use client";
import { Bot, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { ChatUI } from "./ChatUI";

/** Floating Copilot available on every page (except the full Copilot page). */
export function CopilotPanel() {
  const open = useAppStore((s) => s.copilotOpen);
  const setOpen = useAppStore((s) => s.setCopilotOpen);
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (pathname.startsWith("/copilot")) return null;
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open AquaGuard Copilot"
        className="fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full bg-primary text-white shadow-lg hover:bg-primary-dark"
      >
        <Bot size={22} />
      </button>
    );
  }
  return (
    <div role="dialog" aria-label="AquaGuard Copilot" className="card fixed bottom-4 right-4 z-40 flex h-[min(560px,80vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <Bot size={17} className="text-primary" aria-hidden /> AquaGuard Copilot
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close Copilot" className="rounded-md p-1 text-muted hover:bg-bg">
          <X size={17} />
        </button>
      </div>
      <ChatUI compact />
    </div>
  );
}
