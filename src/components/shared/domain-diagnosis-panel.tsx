"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIAGNOSIS_CAUSES, type DiagnosisCause } from "@/lib/domains/hints";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

/**
 * "Why isn't it working?" - the first-line diagnosis (G31). A BUTTON controlling
 * a region (`aria-expanded` / `aria-controls`), deliberately NOT
 * `<details>`/`<summary>`: a `display` rule on a `<summary>` broke the
 * disclosure on iOS before (CLAUDE.md -> Verify in a Browser). Collapsed it
 * renders nothing but the button; the causes the checks actually detected are
 * flagged "We see this".
 */
export function DomainDiagnosisPanel({
  detected = [],
  startOpen = false,
  supportHref,
}: {
  detected?: readonly DiagnosisCause["key"][];
  startOpen?: boolean;
  /** Where "Contact support" goes (the tenant's ticket form); omitted on the platform page. */
  supportHref?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const hydrated = useHydrated();
  const regionId = useId();
  return (
    <section aria-label="Troubleshooting">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={regionId}
        disabled={!hydrated}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 w-full justify-between text-left text-base"
      >
        Why isn&apos;t it working?
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </Button>
      <div id={regionId} role="region" aria-label="Common causes" hidden={!open} className="mt-3">
        <ul className="space-y-3">
          {DIAGNOSIS_CAUSES.map((cause) => (
            <li key={cause.key} data-cause={cause.key} className="rounded-md border border-border p-3">
              <h4 className="flex flex-col items-start gap-1 text-base font-medium">
                {cause.title}
                {detected.includes(cause.key) && (
                  <span className="whitespace-nowrap rounded-full border border-foreground px-2 py-0.5 text-sm font-normal">
                    We see this
                  </span>
                )}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">{cause.body}</p>
            </li>
          ))}
        </ul>
        {supportHref && (
          <p className="mt-3 text-sm text-muted-foreground">
            Still stuck?{" "}
            <Link href={supportHref} className="underline underline-offset-4">
              Contact support
            </Link>
            . We can see what you see here.
          </p>
        )}
      </div>
    </section>
  );
}
