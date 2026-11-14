"use client";
/**
 * Profile menu with working items only. AquaGuard has no accounts, so there is no login and no fake profile:
 * the menu says so and links to Settings, the data-source status page and the keyboard shortcuts.
 */
import { Database, Keyboard, Settings, UserRound } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/Overlay";
import { Dropdown } from "@/components/ui/Popover";
import { useShareQuery } from "./UrlSync";

const SHORTCUTS: [string, string][] = [
  ["Ctrl / ⌘ + K", "Open search"],
  ["↑ ↓ then Enter", "Move through and open search results or menu items"],
  ["Esc", "Close a dialog, menu, drawer or tooltip"],
  ["Tab / Shift + Tab", "Move between controls (focus stays inside open dialogs)"],
];

export function ProfileMenu() {
  const [keys, setKeys] = useState(false);
  const qs = useShareQuery();
  return (
    <>
      <Dropdown label="Profile and settings menu"
                trigger={<span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-white"><UserRound size={15} aria-hidden /></span>}
                header={<div><p className="text-[13px] font-semibold text-ink">Guest</p>
                  <p className="text-[12px] text-muted">AquaGuard has no user accounts; settings are saved in this browser.</p></div>}
                items={[
                  { id: "settings", label: "Settings", description: "Units, default region, motion", icon: <Settings size={15} />, href: `/settings${qs}` },
                  { id: "sources", label: "Data sources & status", description: "Freshness of every source", icon: <Database size={15} />, href: `/data-sources${qs}` },
                  { id: "keys", label: "Keyboard shortcuts", icon: <Keyboard size={15} />, onSelect: () => setKeys(true) },
                ]} />
      <Modal open={keys} onClose={() => setKeys(false)} title="Keyboard shortcuts" size="sm">
        <dl className="space-y-2 text-[13px]">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3">
              <dt><kbd className="rounded border border-control/60 bg-white px-1.5 py-0.5 text-[12px] font-medium text-ink">{k}</kbd></dt>
              <dd className="text-right text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}
