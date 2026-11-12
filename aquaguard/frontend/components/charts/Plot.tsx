"use client";
/** react-plotly.js wrapper: client-only, responsive, PNG download via the mode bar, accessible label. */
import dynamic from "next/dynamic";
import { Skeleton } from "../ui/States";

const Plotly = dynamic(
  async () => {
    const [{ default: factory }, plotly] = await Promise.all([import("react-plotly.js/factory"), import("plotly.js-dist-min")]);
    return factory(plotly.default ?? plotly);
  },
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

export function Plot({ data, layout, height = 300, filename, ariaLabel }: {
  data: unknown[];
  layout: Record<string, unknown>;
  height?: number;
  filename: string;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
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
  );
}
