"use client";
import { useEffect, useId, useState } from "react";

/**
 * Renders a Mermaid diagram in the browser. Mermaid is loaded only when a diagram is on screen, with
 * securityLevel "strict" (labels are sanitised). If rendering fails, the diagram source is shown instead.
 */
export function Mermaid({ code, label }: { code: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const rawId = useId();
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setFailed(false);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#eaf5ff",
            primaryBorderColor: "#0868cc",
            primaryTextColor: "#102b50",
            lineColor: "#536c8a",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "14px",
          },
        });
        const { svg: out } = await mermaid.render(`${id}-${Date.now()}`, code);
        if (alive) setSvg(out);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, id]);

  if (failed) {
    return (
      <div>
        <p className="mb-2 text-[13px] text-muted">The diagram could not be drawn; its source is shown below.</p>
        <pre className="overflow-x-auto rounded-lg bg-light p-3 text-[12.5px]">{code}</pre>
      </div>
    );
  }
  if (!svg) {
    return <div className="grid h-48 place-items-center rounded-xl bg-light text-[13px] text-muted">Drawing diagram…</div>;
  }
  // The SVG comes from Mermaid in strict mode, which sanitises labels.
  return <div className="docs-mermaid overflow-x-auto" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
