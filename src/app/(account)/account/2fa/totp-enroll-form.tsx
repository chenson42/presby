"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { OneTimeCodeInput } from "@/components/shared/one-time-code-input";
import { completeEnrollment } from "./actions";
import { useRecoveryCodesHandoff } from "./enrolment-handoff";

interface TotpEnrollFormProps {
  uri: string;
  secret: string;
  pendingTtlMinutes: number;
}

export function TotpEnrollForm({
  uri,
  secret,
  pendingTtlMinutes,
}: TotpEnrollFormProps) {
  const present = useRecoveryCodesHandoff();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  // Bumped after a failed attempt; remounts the boxes so they come back cleared
  // and focused (the disabled-while-pending boxes dropped focus).
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const submitted = useRef<string | null>(null);

  // Generate QR code client-side from the otpauth URI
  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(uri).then((url) => {
        if (!cancelled) setQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  /**
   * The one way a code reaches the server, from the button or from the sixth
   * digit (DECISION-257). Takes the code it was handed, so it needs no committed
   * state; one call in flight at a time, and never the same code twice in a row.
   */
  async function confirm(c: string) {
    if (inFlight.current || submitted.current === c) return;
    inFlight.current = true;
    submitted.current = c;
    setPending(true);
    try {
      const result = await completeEnrollment({ code: c });
      if (result.ok && result.data) {
        // The holder at the root of the page shows the codes and Continue (it
        // outlives the re-render that follows enrolment; this form does not).
        present({
          codes: result.data.recoveryCodes,
          sessionVerified: result.data.sessionVerified,
        });
      } else if (!result.ok) {
        toast.error(result.error);
        submitted.current = null;
        setCode("");
        setAttempt((a) => a + 1);
      }
    } catch {
      // A rejected call (network, server error) must not strand the guard or
      // become an unhandled rejection from the fire-and-forget auto path. The
      // boxes re-enable and the same code can be sent again with the button; the
      // message says to reload, because the action may have finished and only the
      // reply been lost (DECISION-292 residual d).
      submitted.current = null;
      toast.error(
        "Something went wrong and we could not confirm your code. Reload this page to see whether setup finished.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    void confirm(code);
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Enroll in two-factor authentication</h1>
      <ol className="mt-4 space-y-2 text-sm">
        <li>1. Install an authenticator app (Google Authenticator, 1Password, Authy).</li>
        <li>2. Scan this QR code:</li>
      </ol>

      {qrDataUrl ? (
        <Image
          src={qrDataUrl}
          alt="TOTP QR code — scan with your authenticator app"
          width={192}
          height={192}
          className="mt-4 rounded border border-border bg-white p-2"
          unoptimized
        />
      ) : (
        <div className="mt-4 h-48 w-48 rounded border border-border bg-muted" />
      )}

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Can&apos;t scan? Enter manually
        </summary>
        <pre className="mt-2 rounded bg-muted p-2 font-mono">{secret}</pre>
      </details>
      <p className="mt-2 text-xs text-muted-foreground">
        This QR code expires in {pendingTtlMinutes} minutes. Reload the page for
        a fresh one.
      </p>

      <HydrationGate>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          {/* autoFocus stays off here: the box sits below the QR instructions, and
              grabbing focus on a phone would scroll past them and put the keyboard
              over the QR code (Phase 2 R2.2). */}
          <OneTimeCodeInput
            key={attempt}
            name="code"
            label="Enter the 6-digit code from your app"
            value={code}
            onValueChange={setCode}
            // Only the remount after a failure takes focus; the first mount
            // must not (see above).
            autoFocus={attempt > 0}
            disabled={pending}
            onComplete={(c, { exact }) => {
              if (exact) void confirm(c);
            }}
          />
          <p role="status" className="sr-only">
            {pending ? "Verifying your code." : ""}
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Confirm enrollment"}
          </Button>
        </form>
      </HydrationGate>
    </div>
  );
}
