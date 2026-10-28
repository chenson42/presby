"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { NO_ORG_INVITATION_COPY } from "@/lib/onboarding/no-organization-copy";
import { acceptInPlaceAction, type NoOrgActionState } from "./actions";
import { SecondFactorNotice } from "./second-factor-notice";

const IDLE: NoOrgActionState = { status: "idle" };

/**
 * "Accept the invitation", in place (no emailed link). One small
 * `useActionState` island per card; the only thing the form carries is the
 * invitation id, a selection and not an identity (the action takes identity and
 * the second-factor flag from `auth()`). No `useForm`, so the guard is
 * `disabled={!useHydrated()}`, proved by the hydration spec.
 *
 * When the card already knows two-factor sign-in is needed (`secondFactorNeeded`)
 * the Accept button is not offered at all: the notice and its one link take its
 * place. The same notice appears when the action answers `needs_second_factor`
 * after the click (an authority-bearing `sign_in` invitation). A dead or blocked
 * invitation is finished: its sentence is the end of the road, so the button goes
 * away; a database error, a rate limit and a lapsed session keep it.
 */
export function AcceptInPlaceForm({
  invitationId,
  secondFactorNeeded,
  enrolled,
}: {
  invitationId: string;
  secondFactorNeeded: boolean;
  enrolled: boolean;
}) {
  const [state, formAction, pending] = useActionState(acceptInPlaceAction, IDLE);
  const hydrated = useHydrated();

  const needsSecondFactor = secondFactorNeeded || state.status === "needs_second_factor";
  const finished = state.status === "error" && (state.code === "dead" || state.code === "blocked");
  const variant = enrolled
    ? NO_ORG_INVITATION_COPY.secondFactor.enrolled
    : NO_ORG_INVITATION_COPY.secondFactor.notEnrolled;

  if (needsSecondFactor) {
    return <SecondFactorNotice body={variant.body} button={variant.button} enrolled={enrolled} />;
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
          {state.message}
        </p>
      )}
      {!finished && (
        <Button
          type="submit"
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated || pending}
          aria-busy={pending || undefined}
        >
          {NO_ORG_INVITATION_COPY.accept}
        </Button>
      )}
    </form>
  );
}
