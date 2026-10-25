"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { OneTimeCodeInput } from "@/components/shared/one-time-code-input";
import { verifyTotpAction } from "./actions";

/**
 * The /totp challenge (Phase 2 R4/R6, DECISION-192). A native server-action
 * form, posting the same two fields as before (`token`, `callbackUrl`) to the
 * unchanged `verifyTotpAction`.
 *
 *  - HydrationGate wraps the form from the outside: a Verify pressed before
 *    hydration would post an empty `token`, which the action counts as a failed
 *    attempt (an audit row and one of the 10-per-minute slots).
 *  - Digit mode and recovery mode render MUTUALLY EXCLUSIVE `token` fields,
 *    swapped in and out, never hidden with CSS: `FormData.get("token")` returns
 *    the first match, so two fields would silently send the wrong one.
 *  - Authenticator and recovery failures share one message (no enumeration).
 *  - The error copy already names the recovery option.
 *
 * The sixth digit submits the code (DECISION-257; amends DECISION-193(a)). The
 * client only TRIGGERS the existing form action with `requestSubmit()`: it never
 * calls `verifyTotpAction` itself, `unstable_update` or `@/auth`, because the
 * 0.42.3 session grant must open only inside the action (pinned by a source scan
 * in the test). Recovery codes never auto-submit.
 */
interface TotpChallengeFormProps {
  /** Already sanitised by page.tsx; echoed in a hidden field and re-sanitised by the action. */
  callbackUrl: string;
  /** Allow-listed by page.tsx, never the raw query string. */
  error?: "invalid" | "rate_limited";
}

const ERROR_COPY = {
  invalid: "That code didn't match. Try again, or use a recovery code.",
  rate_limited: "Too many attempts. Please wait a moment before trying again.",
} as const;

const CODE_LENGTH = 6;

function VerifyButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full min-h-11" disabled={disabled || pending}>
      {pending ? "Verifying…" : "Verify"}
    </Button>
  );
}

/**
 * Lives inside the form because `useFormStatus` reads only the form above it.
 * Mirrors `pending` into a ref the parent's submit effect reads, reports the
 * moment an attempt settles (pending true, then false), and renders the
 * screen-reader status. The region is always mounted and holds text only while
 * pending: a live region has to exist before its text changes to be announced.
 */
function FormStatusProbe({
  pendingRef,
  onSettled,
}: {
  pendingRef: React.MutableRefObject<boolean>;
  onSettled: () => void;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
    if (wasPending.current && !pending) onSettled();
    wasPending.current = pending;
  }, [pending, pendingRef, onSettled]);
  return (
    <p role="status" className="sr-only">
      {pending ? "Verifying your code." : ""}
    </p>
  );
}

/** Disabled while a submission is pending so the mutually exclusive `token` field cannot flip mid-flight. */
function ModeToggle({ mode, onSwitch }: { mode: "digits" | "recovery"; onSwitch: () => void }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="button"
      variant="link"
      className="min-h-11 w-full"
      disabled={pending}
      onClick={onSwitch}
    >
      {mode === "digits" ? "Use a recovery code instead" : "Use my authenticator app instead"}
    </Button>
  );
}

export function TotpChallengeForm({ callbackUrl, error }: TotpChallengeFormProps) {
  const [mode, setMode] = useState<"digits" | "recovery">("digits");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  // Bumped when an attempt settles; remounts the digit boxes so they come back
  // cleared and focused (F282: keyed on completion, not on the URL, because two
  // wrong codes in a row redirect to an identical URL).
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  // The complete code `onComplete` said may be submitted, until the effect uses it.
  const armed = useRef<string | null>(null);
  // The complete code already sent; one submission per distinct complete code.
  const submitted = useRef<string | null>(null);
  const pendingRef = useRef(false);

  const complete = code.length === CODE_LENGTH;
  const canSubmit = mode === "digits" ? complete : recovery.trim().length > 0;
  const errorId = error ? "totp-error" : undefined;

  // Submit when the sixth digit lands (DECISION-257). This is an effect, not
  // the change handler: the handler runs before React commits the hidden
  // `token` input, so a `requestSubmit()` there would post the previous value.
  // By the time this runs the hidden input carries all six digits and the form
  // posts its own `FormData` (`token`, `callbackUrl`) to the unchanged action.
  // A mistyped last digit is therefore submitted at once and costs one of the
  // ten attempts a minute; the code expires in about 30 seconds, and Verify
  // stays as the fallback.
  useEffect(() => {
    if (code.length !== CODE_LENGTH) {
      // A hole re-arms: the same digits typed again are a new completion.
      submitted.current = null;
      return;
    }
    if (mode !== "digits" || armed.current !== code) return;
    armed.current = null;
    if (submitted.current === code || pendingRef.current) return;
    submitted.current = code;
    formRef.current?.requestSubmit();
  }, [code, mode]);

  const handleSettled = useCallback(() => {
    submitted.current = null;
    armed.current = null;
    setCode("");
    setAttempt((a) => a + 1);
  }, []);

  function switchMode() {
    setMode((m) => (m === "digits" ? "recovery" : "digits"));
    setCode("");
    setRecovery("");
    armed.current = null;
    submitted.current = null;
  }

  return (
    <HydrationGate>
      <form ref={formRef} action={verifyTotpAction} className="mt-6 space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {mode === "digits" ? (
          <OneTimeCodeInput
            key={attempt}
            name="token"
            label="6-digit code from your authenticator app"
            value={code}
            onValueChange={setCode}
            length={CODE_LENGTH}
            autoFocus
            invalid={Boolean(error)}
            describedBy={errorId}
            onComplete={(c, { exact }) => {
              // Arms only. An over-long paste fills the boxes and waits for Verify.
              armed.current = exact ? c : null;
            }}
          />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="totp-recovery">Recovery code</Label>
            <Input
              id="totp-recovery"
              name="token"
              type="text"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              className="min-h-11 tracking-widest"
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              // Mounted by a click, after hydration, so the attribute is safe
              // here: it is the recovery field's own focus-on-open.
              autoFocus
            />
          </div>
        )}

        {error && (
          <p id="totp-error" role="alert" className="text-sm text-destructive">
            {ERROR_COPY[error]}
          </p>
        )}

        <FormStatusProbe pendingRef={pendingRef} onSettled={handleSettled} />

        <VerifyButton disabled={!canSubmit} />

        <ModeToggle mode={mode} onSwitch={switchMode} />
      </form>
    </HydrationGate>
  );
}
