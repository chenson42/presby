"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { NO_ORG_COPY, NO_ORG_SECOND_FACTOR_COPY } from "@/lib/onboarding/no-organization-copy";
import { checkAgainAction, type NoOrgActionState } from "./actions";
import { SecondFactorNotice } from "./second-factor-notice";

const IDLE: NoOrgActionState = { status: "idle" };

/**
 * "Check again" (N0): asks the connect definer once more, as an action and never
 * as a write during render (E-13). A small `useActionState` island over a plain
 * `<form action>`; it has no `useForm`, so `check:hydration-gate` does not apply
 * and the guard is `disabled={!useHydrated()}` (proved by
 * `e2e/hydration/no-organization-controls.spec.ts`).
 *
 * The outcomes are distinct on purpose: connected redirects to `/launch` from the
 * server; `nothing_new` is the one answer for every decline (it claims no more
 * than that); `needs_second_factor` is the Group B notice with its one link;
 * an error is the action's own sentence. The label does not change while the
 * action runs (the button is disabled and `aria-busy`), so no wording outside
 * the Copy is introduced.
 */
export function CheckAgainForm({ enrolled }: { enrolled: boolean }) {
  const [state, formAction, pending] = useActionState(checkAgainAction, IDLE);
  const hydrated = useHydrated();
  const variant = enrolled ? NO_ORG_SECOND_FACTOR_COPY.enrolled : NO_ORG_SECOND_FACTOR_COPY.notEnrolled;

  return (
    <div className="space-y-4">
      <form action={formAction}>
        <Button
          type="submit"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated || pending}
          aria-busy={pending || undefined}
        >
          {NO_ORG_COPY.buttons.checkAgain}
        </Button>
      </form>
      {state.status === "nothing_new" && (
        <p role="status" className="text-sm text-muted-foreground">
          {NO_ORG_COPY.nothingNew}
        </p>
      )}
      {state.status === "needs_second_factor" && (
        <SecondFactorNotice body={variant.body} button={variant.button} enrolled={enrolled} />
      )}
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
