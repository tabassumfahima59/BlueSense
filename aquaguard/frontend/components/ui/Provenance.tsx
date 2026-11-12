import { Activity, Archive, Calculator, Cpu, FlaskConical } from "lucide-react";
import { PROVENANCE_HELP, PROVENANCE_LABEL } from "@/lib/format";
import type { Measure, Provenance } from "@/lib/types/contract";

const STYLE: Record<Provenance, string> = {
  observed: "text-prov-observed bg-[#e8f6ee] border-[#bfe5cf]",
  historical: "text-prov-historical bg-[#eef2f6] border-[#d6dee8]",
  predicted: "text-prov-predicted bg-[#e6f5fd] border-[#b9e3f8]",
  estimated: "text-prov-estimated bg-[#fdf4e2] border-[#f2dca8]",
  simulated: "text-prov-simulated bg-[#e9f7f5] border-primary border-dashed",
};
const ICON: Record<Provenance, typeof Activity> = {
  observed: Activity,
  historical: Archive,
  predicted: Cpu,
  estimated: Calculator,
  simulated: FlaskConical,
};

/** Icon + word, never colour alone. */
export function ProvenanceBadge({ p, sample, small }: { p: Provenance; sample?: boolean; small?: boolean }) {
  const Icon = ICON[p];
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span
        title={PROVENANCE_HELP[p]}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 ${small ? "py-0 text-[10.5px]" : "py-0.5 text-[11px]"} font-medium ${STYLE[p]}`}
      >
        <Icon aria-hidden size={small ? 10 : 11} />
        {PROVENANCE_LABEL[p]}
      </span>
      {sample && <SampleTag small={small} />}
    </span>
  );
}

export function SampleTag({ small }: { small?: boolean }) {
  return (
    <span
      title="From the frozen sample snapshot (live data or database unavailable)"
      className={`rounded-full border border-[#d6dee8] bg-[#f1f4f8] px-1.5 ${small ? "text-[10px]" : "text-[10.5px]"} font-medium text-muted`}
    >
      Sample
    </span>
  );
}

export function MeasureBadge({ m, small }: { m: Measure | null | undefined; small?: boolean }) {
  if (!m) return null;
  return <ProvenanceBadge p={m.provenance} sample={m.isSample} small={small} />;
}

export function ProvenanceLegend() {
  return (
    <div className="hidden items-center gap-1.5 xl:flex" aria-label="Provenance legend">
      {(Object.keys(PROVENANCE_LABEL) as Provenance[]).map((p) => (
        <ProvenanceBadge key={p} p={p} small />
      ))}
      <SampleTag small />
    </div>
  );
}
