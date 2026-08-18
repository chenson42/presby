"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { completeEnrollment } from "./actions";

interface TotpEnrollFormProps {
  uri: string;
  secret: string;
  pendingTtlMinutes: number;
  callbackUrl?: string;
}

export function TotpEnrollForm({
  uri,
  secret,
  pendingTtlMinutes,
  callbackUrl,
}: TotpEnrollFormProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    const result = await completeEnrollment({ code });
    setPending(false);
    if (result.ok && result.data) {
      setEnrolled(true);
      setRecoveryCodes(result.data.recoveryCodes);
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  if (enrolled) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Two-factor authentication enabled</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your authenticator app is now linked. Save your recovery codes below —
          this is the only time they will be shown in plaintext.
        </p>
        <div className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Recovery codes — save these now
          </h2>
          <p className="mt-1 text-xs">
            Each code lets you sign in once if you lose your authenticator.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <li key={c} className="rounded bg-background px-2 py-1">
                {c}
              </li>
            ))}
          </ul>
        </div>
        <a
          href={callbackUrl ?? "/home"}
          className="mt-6 inline-block text-sm underline underline-offset-2"
        >
          Continue
        </a>
      </div>
    );
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

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <label className="block text-sm font-medium">
          Enter the 6-digit code from your app
        </label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base tracking-widest"
          placeholder="123456"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Confirm enrollment"}
        </button>
      </form>
    </div>
  );
}
