"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { acceptSignedInAction, type AcceptFormState } from "../actions";

const IDLE: AcceptFormState = { status: "idle" };

/**
 * The one-click Accept for a signed-in visitor whose account owns the invited
 * address. A plain `<form action>` over `useActionState`: the action takes the
 * identity from `auth()` only (the form carries just the token), and a refusal
 * (a gate conflict, a lapsed 2FA, a rate limit) renders inline in a
 * `role="alert"` region that takes focus. Works before hydration (a native
 * server-action POST), so no `HydrationGate` is needed: there is no controlled
 * input here to lose.
 */
export function AcceptSignedInForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptSignedInAction, IDLE);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);

  // A blocked or dead invitation is finished (the token is spent or gone): the
  // message is the end of the road, so no button is left to click into it again.
  const finished = state.status === "error" && (state.code === "blocked" || state.code === "dead");

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-destructive p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {state.message}
        </div>
      )}
      {!finished && (
        <Button type="submit" className="min-h-11 w-full" disabled={pending} aria-busy={pending || undefined}>
          {pending ? "Accepting…" : "Accept invitation"}
        </Button>
      )}
    </form>
  );
}
