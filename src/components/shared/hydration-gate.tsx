"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

/**
 * Makes everything inside inoperable until the page has hydrated
 * (DECISION-159, F116). react-hook-form's `register()` writes `defaultValues`
 * over the live DOM when it attaches during hydration, so anything a user
 * typed or picked before that is overwritten (a native <select> silently
 * falls back to a different valid option). Disabled controls cannot be
 * touched, and a pre-hydration Submit cannot do a native GET.
 *
 * Wrap the <form> element from the outside. Rules: never add a <legend>
 * (controls in a disabled fieldset's first legend are NOT disabled), never put
 * opacity on this element (it would dim labels below the contrast floor; the
 * controls' own `disabled:` styles do the dimming), and there is deliberately
 * no `disabled` override prop.
 */
export function HydrationGate({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const hydrated = useHydrated();
  return (
    <fieldset
      disabled={!hydrated}
      aria-busy={hydrated ? undefined : true}
      data-slot="hydration-gate"
      className={cn("m-0 min-w-0 border-0 p-0", className)}
    >
      {children}
    </fieldset>
  );
}
