"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The /docs pages have their own full-width layout, so the app shell (sidebar, top bar, Copilot panel) is hidden there. */
export function HideOnDocs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/docs" || pathname?.startsWith("/docs/")) return null;
  return <>{children}</>;
}
