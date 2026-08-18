"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a mermaid ER diagram.
 *
 * Mermaid is imported dynamically so no other route pays for a large
 * dependency that only this one needs.
 *
 * The source stays available underneath: a reviewer copying it into a doc or a
 * PR comment is a real use, and it is the fallback if rendering fails.
 */
export function Erd({ chart, id }: { chart: string; id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "ready" | "error">("idle");

  useEffect(() => {
    if (state !== "idle") return;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          // Tuned to the page rather than mermaid's defaults, so a diagram does
          // not arrive looking like it came from somewhere else.
          themeVariables: dark
            ? {
                background: "#1a1d22",
                primaryColor: "#1a1d22",
                primaryTextColor: "#e8e6e1",
                primaryBorderColor: "#6fb3a3",
                lineColor: "#9aa0a8",
                fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                fontSize: "13px",
              }
            : {
                background: "#f3f1ec",
                primaryColor: "#fbfaf7",
                primaryTextColor: "#17191c",
                primaryBorderColor: "#2f5d54",
                lineColor: "#5c6169",
                fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                fontSize: "13px",
              },
        });

        const { svg } = await mermaid.render(`erd-${id}`, chart);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state, chart, id]);

  return (
    <div>
      <div className="reg__erd" ref={hostRef} data-state={state} />
      {state === "error" && (
        <p className="reg__note">
          The diagram could not be rendered. The source below is the same graph.
        </p>
      )}
      <pre className="reg__diagram">
        <code>{chart}</code>
      </pre>
    </div>
  );
}
