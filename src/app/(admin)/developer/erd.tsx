"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a mermaid ER diagram.
 *
 * Mermaid is imported dynamically and only when the diagram is actually opened.
 * It is a large dependency and this is a developer-only page — no other route
 * should pay for it, and most visits to this one never expand a diagram.
 *
 * The source stays available underneath: a reviewer copying it into a doc or a
 * PR comment is a real use, and it is also the fallback if rendering fails.
 */
export function Erd({ chart, id }: { chart: string; id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "ready" | "error">("idle");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || state !== "idle") return;
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
  }, [open, state, chart, id]);

  return (
    <details
      className="reg__body"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="reg__name">Entity diagram</span>
        <span className="reg__meta">
          {state === "error" ? "source only" : "relationships"}
        </span>
      </summary>

      <div className="reg__erd" ref={hostRef} aria-hidden={state !== "ready"} />

      <details className="reg__erdSource">
        <summary>
          <span className="reg__meta">mermaid source</span>
        </summary>
        <pre className="reg__diagram">
          <code>{chart}</code>
        </pre>
      </details>
    </details>
  );
}
