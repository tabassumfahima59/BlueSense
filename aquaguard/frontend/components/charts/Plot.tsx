"use client";
/**
 * react-plotly.js wrapper: client-only, responsive, PNG download via the mode bar, accessible label, and a
 * "View as table" toggle built from the chart's own traces (master prompt §5).
 */
import dynamic from "next/dynamic";
import { BarChart3, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtNumber } from "@/lib/format";
import { tracesToTable } from "@/lib/charts/table";
import { Skeleton } from "../ui/States";

const Plotly = dynamic(
  async () => {
    const [{ default: factory }, plotly] = await Promise.all([import("react-plotly.js/factory"), import("plotly.js-dist-min")]);
    return factory(plotly.default ?? plotly);
  },
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

export function DataTable({ head, rows, caption, maxHeight = 320 }: {
  head: string[];
  rows: (string | number | null)[][];
  caption: string;
  maxHeight?: number;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-border bg-white" style={{ maxHeight }} tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-[12.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-light text-left text-ink">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-2.5 py-1.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/70">
              {r.map((c, j) => j === 0
                ? <th key={j} scope="row" className="px-2.5 py-1 text-left font-medium text-ink">{c ?? "—"}</th>
                : <td key={j} className="px-2.5 py-1 text-right tabular-nums text-ink">{c === null ? "—" : typeof c === "number" ? fmtNumber(c) : c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Plot({ data, layout, height = 300, filename, ariaLabel, tableKeyLabel }: {
  data: unknown[];
  layout: Record<string, unknown>;
  height?: number;
  filename: string;
  ariaLabel: string;
  tableKeyLabel?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const table = useMemo(() => tracesToTable(data, tableKeyLabel), [data, tableKeyLabel]);
  return (
    <div className="w-full">
      {table && (
        <div className="mb-1 flex justify-end">
          <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted transition hover:bg-light hover:text-ink">
            {asTable ? <BarChart3 size={13} aria-hidden /> : <Table2 size={13} aria-hidden />}
            {asTable ? "View as chart" : "View as table"}
          </button>
        </div>
      )}
      {asTable && table ? (
        <DataTable head={table.head} rows={table.rows} caption={ariaLabel} maxHeight={Math.max(height, 240)} />
      ) : (
        <div role="figure" aria-label={ariaLabel} style={{ height }} className="w-full">
          <Plotly
            data={data as never}
            layout={{ ...layout, height } as never}
            useResizeHandler
            style={{ width: "100%", height: "100%" }}
            config={{
              displaylogo: false,
              responsive: true,
              modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"],
              toImageButtonOptions: { format: "png", filename: `aquaguard-${filename}`, scale: 2 },
            }}
          />
        </div>
      )}
    </div>
  );
}
