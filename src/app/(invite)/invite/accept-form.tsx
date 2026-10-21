"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { RequiredMark } from "@/components/shared/required-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptNewAccountAction, type AcceptFormState } from "../actions";

const IDLE: AcceptFormState = { status: "idle" };

const FIELD_IDS = {
  firstName: "invite-first-name",
  lastName: "invite-last-name",
  password: "invite-password",
  confirm: "invite-confirm",
} as const;

/**
 * The create-account form on `/invite`: a plain `<form action>` over
 * `useActionState` (not react-hook-form), with the server action doing all the
 * validation and returning an inline, `role="alert"` message (the reset page's
 * toast-only errors are not announced). The visitor's own entries are held in
 * state so a refused submit does not wipe them (React 19 resets a form after
 * its action); the whole form sits under `<HydrationGate>` because controlled
 * inputs are overwritten by hydration (DECISION-159) - nothing typed
 * before the page's JavaScript runs can be lost.
 *
 * On every error the focus moves to the offending field, else the alert, so a
 * keyboard or screen-reader user lands on the explanation. Password rules are
 * stated BEFORE the field, `autoComplete="new-password"`, a show/hide toggle
 * with a 44px target, and no colour-only status.
 */
export function AcceptNewAccountForm({
  token,
  defaultFirstName,
  defaultLastName,
}: {
  token: string;
  defaultFirstName: string;
  defaultLastName: string;
}) {
  const [state, formAction, pending] = useActionState(acceptNewAccountAction, IDLE);
  const [firstName, setFirstName] = useState(defaultFirstName);
  const [lastName, setLastName] = useState(defaultLastName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "error") return;
    const field = state.field ? document.getElementById(FIELD_IDS[state.field]) : null;
    (field ?? alertRef.current)?.focus();
  }, [state]);

  const error = state.status === "error" ? state : null;
  // A blocked or dead invitation is finished: the message ends it, no button to retry.
  const finished = error?.code === "blocked" || error?.code === "dead";
  const invalid = (field: keyof typeof FIELD_IDS) =>
    error?.field === field ? true : undefined;
  const describedBy = (field: keyof typeof FIELD_IDS) =>
    error?.field === field ? "invite-error" : undefined;

  return (
    <HydrationGate>
      <form action={formAction} className="mt-3 space-y-4" noValidate>
        <input type="hidden" name="token" value={token} />

        <div>
          <Label htmlFor={FIELD_IDS.firstName}>
            First name
            <RequiredMark />
          </Label>
          <Input
            id={FIELD_IDS.firstName}
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            required
            aria-required="true"
            aria-invalid={invalid("firstName")}
            aria-describedby={describedBy("firstName")}
            disabled={pending}
            className="mt-1 h-11"
          />
        </div>
        <div>
          <Label htmlFor={FIELD_IDS.lastName}>
            Last name
            <RequiredMark />
          </Label>
          <Input
            id={FIELD_IDS.lastName}
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            required
            aria-required="true"
            aria-invalid={invalid("lastName")}
            aria-describedby={describedBy("lastName")}
            disabled={pending}
            className="mt-1 h-11"
          />
        </div>

        <p id="invite-password-rules" className="text-sm text-muted-foreground">
          Choose a password of at least 8 characters (no more than 72 bytes: about 72 letters).
          Use one you don&apos;t use anywhere else.
        </p>
        <div>
          <Label htmlFor={FIELD_IDS.password}>
            Password
            <RequiredMark />
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              id={FIELD_IDS.password}
              name="password"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              aria-required="true"
              aria-invalid={invalid("password")}
              aria-describedby={
                [describedBy("password"), "invite-password-rules"].filter(Boolean).join(" ")
              }
              disabled={pending}
              className="h-11"
            />
            <Button
              type="button"
              variant="outline"
              className="size-11 shrink-0 p-0"
              onClick={() => setShow((v) => !v)}
              aria-pressed={show}
              aria-label={show ? "Hide passwords" : "Show passwords"}
              disabled={pending}
            >
              {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor={FIELD_IDS.confirm}>
            Confirm password
            <RequiredMark />
          </Label>
          <Input
            id={FIELD_IDS.confirm}
            name="confirm"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            aria-required="true"
            aria-invalid={invalid("confirm")}
            aria-describedby={describedBy("confirm")}
            disabled={pending}
            className="mt-1 h-11"
          />
        </div>

        {error && (
          <div
            id="invite-error"
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-destructive p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {error.message}
          </div>
        )}

        {!finished && (
          <Button type="submit" className="min-h-11 w-full" disabled={pending} aria-busy={pending || undefined}>
            {pending ? "Creating your account…" : "Create account"}
          </Button>
        )}
      </form>
    </HydrationGate>
  );
}
