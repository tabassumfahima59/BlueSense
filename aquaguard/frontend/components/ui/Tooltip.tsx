"use client";
/** Tooltip on hover and keyboard focus; dismissible with Escape (WCAG 1.4.13); content stays hoverable. */
import { type ReactElement, type ReactNode, cloneElement, useId, useRef, useState } from "react";

export function Tooltip({ content, children, side = "top" }: {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      {cloneElement(children, { "aria-describedby": open ? id : undefined })}
      {open && (
        <span role="tooltip" id={id}
              className={`glass animate-fade-in absolute left-1/2 z-50 w-max max-w-[280px] -translate-x-1/2 px-3 py-2 text-left text-[12px] leading-relaxed text-ink ${side === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}>
          {content}
        </span>
      )}
    </span>
  );
}
