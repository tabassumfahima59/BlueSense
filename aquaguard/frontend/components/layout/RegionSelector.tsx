"use client";
/**
 * Global region selector: Bangladesh (national) and the eight divisions (decision 6: districts are not selectable;
 * district boundaries stay on the map as a reference layer). A district id arriving from an old link or a map click
 * is replaced by its division, with a notice.
 */
import { MapPin } from "lucide-react";
import { useEffect } from "react";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import { useAppStore } from "@/lib/store";

export function RegionSelector({ id = "region-select", compact = false }: { id?: string; compact?: boolean }) {
  const region = useAppStore((s) => s.selectedRegion);
  const setRegion = useAppStore((s) => s.setRegion);
  const regions = useApi("regions", api.regions);
  const r = regions.data;

  useEffect(() => {
    if (!r) return;
    const district = r.districts.find((d) => d.id === region);
    if (district?.parentId) {
      const division = r.divisions.find((d) => d.id === district.parentId);
      setRegion(district.parentId);
      toast(`District-level data is not available; showing ${division?.name ?? "its"} division instead of ${district.name}.`);
    } else if (region !== r.country.id && !r.divisions.some((d) => d.id === region) && !district) {
      setRegion(r.country.id);
    }
  }, [r, region, setRegion]);

  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[13px]">
      <MapPin size={15} className="text-primary" aria-hidden />
      <span className="sr-only">Region</span>
      <select
        id={id}
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        disabled={!r}
        className={`rounded-lg border bg-white px-2 py-1.5 text-[13px] text-ink ${compact ? "max-w-[140px]" : "max-w-[220px]"}`}
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
          </>
        )}
      </select>
    </label>
  );
}
