"use client";
import { MapPin } from "lucide-react";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";

export function RegionSelector({ id = "region-select", compact = false }: { id?: string; compact?: boolean }) {
  const region = useAppStore((s) => s.selectedRegion);
  const setRegion = useAppStore((s) => s.setRegion);
  const regions = useApi("regions", api.regions);
  const r = regions.data;
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[13px]">
      <MapPin size={15} className="text-muted" aria-hidden />
      <span className="sr-only">Region</span>
      <select
        id={id}
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        disabled={!r}
        className={`rounded-lg border border-border bg-white px-2 py-1.5 text-[13px] text-ink ${compact ? "max-w-[130px]" : "max-w-[220px]"}`}
      >
        {!r && <option value={region}>{regions.error ? "Regions unavailable" : "Loading regions…"}</option>}
        {r && (
          <>
            <option value={r.country.id}>Bangladesh (national)</option>
            <optgroup label="Divisions">
              {r.divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.nameBn ? ` · ${d.nameBn}` : ""}
                </option>
              ))}
            </optgroup>
            {r.divisions.map((d) => (
              <optgroup key={`g-${d.id}`} label={`${d.name} districts`}>
                {r.districts
                  .filter((x) => x.parentId === d.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </>
        )}
      </select>
    </label>
  );
}
