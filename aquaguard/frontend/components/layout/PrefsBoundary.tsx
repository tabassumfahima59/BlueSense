"use client";
/** Applies display preferences before the page renders and re-renders the page when they change. */
import { Fragment, type ReactNode } from "react";
import { setVolumeDisplay } from "@/lib/format";
import { useAppStore } from "@/lib/store";

export function PrefsBoundary({ children }: { children: ReactNode }) {
  const unit = useAppStore((s) => s.prefs.volumeUnit);
  setVolumeDisplay(unit);
  return <Fragment key={unit}>{children}</Fragment>;
}
