"use client";

import { useEffect, useRef, useState } from "react";
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
 *  - After a failed attempt the page reloads, so the form is back in digit mode.
 *    The error copy already names the recovery option.
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

function VerifyButton({
  disabled,
  buttonRef,
}: {
  disabled: boolean;
  buttonRef: React.Ref<HTMLButtonElement>;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      ref={buttonRef}
      type="submit"
      className="w-full min-h-11"
      disabled={disabled || pending}
    >
      {pending ? "Verifying…" : "Verify"}
    </Button>
  );
}

export function TotpChallengeForm({ callbackUrl, error }: TotpChallengeFormProps) {
  const [mode, setMode] = useState<"digits" | "recovery">("digits");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const verifyRef = useRef<HTMLButtonElement | null>(null);
  const focusVerifyWhenReady = useRef(false);

  const complete = code.length === CODE_LENGTH;
  const canSubmit = mode === "digits" ? complete : recovery.trim().length > 0;
  const errorId = error ? "totp-error" : undefined;

  // Completing the code moves focus to Verify (no auto-submit: a typo would
  // spend one of ten attempts). Verify only becomes enabled on the render that
  // follows the edit, so the move waits for that render.
  useEffect(() => {
    if (focusVerifyWhenReady.current && complete) {
      focusVerifyWhenReady.current = false;
      verifyRef.current?.focus();
    }
  }, [code, complete]);

  function switchMode(next: "digits" | "recovery") {
    setMode(next);
    setCode("");
    setRecovery("");
    focusVerifyWhenReady.current = false;
  }

  return (
    <HydrationGate>
      <form action={verifyTotpAction} className="mt-6 space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {mode === "digits" ? (
          <OneTimeCodeInput
            name="token"
            label="6-digit code from your authenticator app"
            value={code}
            onValueChange={setCode}
            length={CODE_LENGTH}
            autoFocus
            invalid={Boolean(error)}
            describedBy={errorId}
            onComplete={() => {
              focusVerifyWhenReady.current = true;
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

        <VerifyButton disabled={!canSubmit} buttonRef={verifyRef} />

        <Button
          type="button"
          variant="link"
          className="min-h-11 w-full"
          onClick={() => switchMode(mode === "digits" ? "recovery" : "digits")}
        >
          {mode === "digits"
            ? "Use a recovery code instead"
            : "Use my authenticator app instead"}
        </Button>
      </form>
    </HydrationGate>
  );
}
