"use client";
/**
 * Settings: only working preferences, saved in this browser (there are no accounts):
 * units (water volume display), default region, motion and transparency, plus the data-source status overview.
 */
import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataStatusBadge } from "@/components/ui/DataStatus";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Async } from "@/components/ui/States";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { DEFAULT_PREFS, type MotionPref, type VolumeUnit, useAppStore } from "@/lib/store";

function Radio<T extends string>({ name, value, current, label, help, onChange }: {
  name: string; value: T; current: T; label: string; help?: string; onChange: (v: T) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 transition hover:bg-light">
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)}
             className="mt-1 accent-[var(--color-primary)]" />
      <span>
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        {help && <span className="block text-[12.5px] text-muted">{help}</span>}
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const prefs = useAppStore((s) => s.prefs);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const region = useAppStore((s) => s.selectedRegion);
  const regions = useApi("regions", api.regions);
  const sources = useApi("data-sources", api.dataSources);
  const [confirm, setConfirm] = useState(false);
  const saved = (msg: string) => toast(`${msg} Saved in this browser.`, "success", 3500);

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Preferences are saved in this browser only. AquaGuard has no user accounts." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Units" subtitle="How water volumes are shown in values and tables (charts keep the unit on their axis)">
          <fieldset>
            <legend className="sr-only">Water volume unit</legend>
            {([
              ["native", "As published", "Each source's own unit: AQUASTAT km³/yr, model results in MCM"],
              ["MCM", "MCM (million m³)", "1 km³ = 1,000 MCM"],
              ["km3", "km³ (billion m³)", "1,000 MCM = 1 km³"],
            ] as [VolumeUnit, string, string][]).map(([v, l, h]) => (
              <Radio key={v} name="volume" value={v} current={prefs.volumeUnit} label={l} help={h}
                     onChange={(x) => { setPrefs({ volumeUnit: x }); saved(`Volumes are now shown as ${l}.`); }} />
            ))}
          </fieldset>
        </Card>

        <Card title="Default region" subtitle="Used when a page is opened without a region in its link">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="default-region" className="text-[13px] text-muted">Default region</label>
            <select id="default-region" value={prefs.defaultRegion} disabled={!regions.data}
                    onChange={(e) => { setPrefs({ defaultRegion: e.target.value }); saved("Default region updated."); }}
                    className="rounded-lg border bg-white px-2 py-1.5 text-[13px] text-ink">
              {regions.data ? (
                <>
                  <option value={regions.data.country.id}>Bangladesh (national)</option>
                  {regions.data.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </>
              ) : <option value={prefs.defaultRegion}>Loading…</option>}
            </select>
            <button type="button" disabled={region === prefs.defaultRegion}
                    onClick={() => { setPrefs({ defaultRegion: region }); saved("Default region set to the current region."); }}
                    className="rounded-lg border border-control bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-light disabled:opacity-50">
              Use current region
            </button>
          </div>
        </Card>

        <Card title="Motion and transparency" subtitle="Accessibility preferences for this browser">
          <fieldset>
            <legend className="mb-1 text-[12.5px] font-medium text-muted">Animations</legend>
            {([
              ["system", "Follow the system setting", "Uses your operating system's reduce-motion preference"],
              ["reduce", "Reduce motion", "Turns off transitions and animations"],
              ["allow", "Allow motion", "Short (150-250 ms) transitions"],
            ] as [MotionPref, string, string][]).map(([v, l, h]) => (
              <Radio key={v} name="motion" value={v} current={prefs.motion} label={l} help={h}
                     onChange={(x) => { setPrefs({ motion: x }); saved("Motion preference updated."); }} />
            ))}
          </fieldset>
          <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-lg p-2 transition hover:bg-light">
            <input type="checkbox" checked={prefs.reduceTransparency} className="mt-1 accent-[var(--color-primary)]"
                   onChange={(e) => { setPrefs({ reduceTransparency: e.target.checked }); saved("Transparency preference updated."); }} />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">Reduce transparency</span>
              <span className="block text-[12.5px] text-muted">Solid white surfaces instead of frosted glass</span>
            </span>
          </label>
        </Card>

        <Card title="Reset" subtitle="Restore the default preferences">
          <p className="mb-3 text-[13px] text-muted">Units, default region, motion and transparency go back to their defaults. Data is not affected.</p>
          <button type="button" onClick={() => setConfirm(true)}
                  className="rounded-lg border border-control bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-light">
            Reset preferences…
          </button>
        </Card>
      </div>

      <Card title="Data sources status" subtitle="Computed from each source's last successful sync and its update cycle"
            actions={<Link href="/data-sources" className="text-[13px] font-medium text-primary hover:underline">All sources and limitations</Link>}>
        <Async state={sources} rows={2} label="Loading data source status">
          {(d) => (
            <ul className="divide-y divide-border">
              {d.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink">{s.name}</span>
                    <span className="block text-[12px] text-muted">{s.scheduled ? `Checked every ${s.cadence}` : s.note ?? s.cadence}{s.lastError && s.lastAttemptStatus !== "success" ? ` · last error: ${s.lastError}` : ""}</span>
                  </span>
                  <DataStatusBadge info={{ status: s.status, kind: s.dataKind, observedAt: s.latestObservation,
                                           retrievedAt: s.lastSuccessAt ?? s.retrievedAt, sources: [s.id],
                                           attribution: [s.attribution], spatialLevel: s.spatialLevel, note: s.note }} />
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>

      <ConfirmDialog open={confirm} title="Reset preferences?" confirmLabel="Reset"
                     message="Units, default region, motion and transparency return to their defaults in this browser."
                     onCancel={() => setConfirm(false)}
                     onConfirm={() => { setPrefs({ ...DEFAULT_PREFS }); setConfirm(false); saved("Preferences reset."); }} />
    </div>
  );
}
