import { Check } from "lucide-react";
import type { ChecklistGroup } from "@/lib/domains/checklist";
import { cn } from "@/lib/utils";

/**
 * The four steps of connecting a domain: 1 Prove you own it, 2 Connect it,
 * 3 Secure it (HTTPS), 4 Live. A numbered `<ol>`; the current step carries
 * `aria-current="step"` and every step says its state in words, so it is never
 * colour alone. Wraps to two columns at 360px.
 */
export function DomainStepList({ steps }: { steps: ChecklistGroup["steps"] }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Progress">
      {steps.map((s) => (
        <li
          key={s.n}
          aria-current={s.state === "current" ? "step" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm",
            s.state === "current" ? "border-foreground font-medium" : "border-border",
            s.state === "todo" && "text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
              s.state === "done" ? "border-foreground bg-foreground text-background" : "border-border",
            )}
          >
            {s.state === "done" ? <Check className="size-3.5" /> : s.n}
          </span>
          <span>
            {s.label}
            <span className="sr-only">
              {s.state === "done" ? " (done)" : s.state === "current" ? " (current step)" : " (not yet)"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
