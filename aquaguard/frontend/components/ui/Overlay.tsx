"use client";
/**
 * Accessible overlays: Modal, DetailDrawer and ConfirmDialog.
 * role="dialog" + aria-modal, labelled by the title, focus moves inside on open and is trapped (Tab / Shift+Tab),
 * Escape and the backdrop close it, focus returns to the opener on close, page scroll is locked meanwhile.
 * The backdrop has no blur, so at most two blur layers stack (the dialog's glass over a card).
 */
import { X } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("hidden")) : [];
}

function useDialogBehaviour(open: boolean, ref: RefObject<HTMLDivElement | null>, onClose: () => void,
                            initialFocus?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (initialFocus?.current ?? focusables(el)[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab" && el) {
        const f = focusables(el);
        if (!f.length) {
          e.preventDefault();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open, ref, initialFocus]);
}

export function Modal({ open, onClose, title, description, children, footer, size = "md", initialFocus }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialogBehaviour(open, ref, onClose, initialFocus);
  if (!open || typeof document === "undefined") return null;
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <div className="fixed inset-0 bg-ink/35" aria-hidden onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
           aria-describedby={description ? descId : undefined} tabIndex={-1}
           className={`glass animate-fade-in relative w-full ${width} p-5 shadow-xl`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-ink">{title}</h2>
            {description && <p id={descId} className="mt-1 text-[13px] text-muted">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted transition hover:bg-light hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
        {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function DetailDrawer({ open, onClose, title, subtitle, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehaviour(open, ref, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="fixed inset-0 bg-ink/30" aria-hidden onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
           className="glass animate-slide-in fixed inset-y-0 right-0 flex w-full max-w-md flex-col rounded-none rounded-l-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close details" className="rounded-md p-1.5 text-muted transition hover:bg-light hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary",
                                onConfirm, onCancel }: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmCls = tone === "danger" ? "bg-risk text-white hover:opacity-90" : "bg-primary text-white hover:bg-primary-dark";
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm" initialFocus={cancelRef}
           footer={<>
             <button ref={cancelRef} onClick={onCancel} className="rounded-lg border border-control bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-light">{cancelLabel}</button>
             <button onClick={onConfirm} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${confirmCls}`}>{confirmLabel}</button>
           </>}>
      <div className="text-[13.5px] leading-relaxed text-ink">{message}</div>
    </Modal>
  );
}
