import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  userTotp,
  userTotpRecoveryCodes,
} from "@/lib/db/schema";
import { FRESH_RECOVERY_CODES_COOKIE } from "@/lib/two-factor";
import {
  getOrCreatePendingEnrollment,
  PENDING_TTL_MINUTES,
} from "@/lib/totp-pending";
import {
  clearFreshCodesCookieAction,
  confirmEnrollmentAction,
  regenerateRecoveryCodesAction,
  resetEnrollmentAction,
} from "./actions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { FreshRecoveryCodes } from "@/components/shared/fresh-recovery-codes";

export default async function TwoFactorPage() {
  const session = await auth();
  if (!session?.user) return null;

  const existing = await db.query.userTotp.findFirst({
    where: eq(userTotp.userId, session.user.id),
  });

  if (existing) {
    const recoveryRows = await db.query.userTotpRecoveryCodes.findMany({
      where: eq(userTotpRecoveryCodes.userId, session.user.id),
    });
    const totalCodes = recoveryRows.length;
    const unusedCount = recoveryRows.filter((c) => !c.usedAt).length;

    const jar = await cookies();
    const rawFreshCodes = jar.get(FRESH_RECOVERY_CODES_COOKIE)?.value ?? null;
    let freshCodes: string[] | null = null;
    if (rawFreshCodes) {
      try {
        const parsed = JSON.parse(rawFreshCodes);
        freshCodes = Array.isArray(parsed)
          ? parsed.filter((s): s is string => typeof s === "string")
          : null;
      } catch {
        freshCodes = null;
      }
    }

    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You enrolled on{" "}
          <FormattedDate value={existing.enrolledAt} mode="date" />.
          {existing.lastUsedAt && (
            <> Last used: <FormattedDate value={existing.lastUsedAt} mode="datetime" />.</>
          )}
        </p>

        {freshCodes && (
          <FreshRecoveryCodes
            codes={freshCodes}
            onDisplayed={clearFreshCodesCookieAction}
          />
        )}

        <div className="mt-6 rounded-md border border-border p-4">
          <h2 className="text-sm font-semibold">Recovery codes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {unusedCount} unused code{unusedCount === 1 ? "" : "s"} remaining
            (of {totalCodes} total). Each code can be used once if you lose
            your authenticator.
          </p>
          <form action={regenerateRecoveryCodesAction} className="mt-3">
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Regenerate recovery codes
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Replaces every existing code. The new set is shown once — save
              them before leaving the page.
            </p>
          </form>
        </div>

        <form action={resetEnrollmentAction} className="mt-6">
          <button
            type="submit"
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10"
          >
            Reset 2FA enrollment
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Deletes your TOTP secret and recovery codes. You&apos;ll re-scan
            the QR code on your next visit.
          </p>
        </form>
      </div>
    );
  }

  // Not enrolled — reuse the pending row if it's still valid, otherwise mint
  // a new one.  Reusing the row means the QR code stays stable across page
  // reloads within the TTL window, so the secret the user scanned matches the
  // one the confirm action will verify.
  const { secret, uri: otpUrl } = await getOrCreatePendingEnrollment(
    session.user.id,
    session.user.email ?? "user@example.com",
  );
  const qrDataUrl = await QRCode.toDataURL(otpUrl);

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Enroll in 2FA</h1>
      <ol className="mt-4 space-y-2 text-sm">
        <li>1. Install an authenticator app (Google Authenticator, 1Password, Authy).</li>
        <li>2. Scan this QR code:</li>
      </ol>
      {/* QR code is a data: URL generated server-side; `next/image` would add */}
      {/* a remote-loader round-trip and a layout-shift placeholder for no win. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt="TOTP QR code"
        className="mt-4 h-48 w-48 rounded border border-border bg-white p-2"
      />
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Can&apos;t scan? Enter manually</summary>
        <pre className="mt-2 rounded bg-muted p-2 font-mono">{secret}</pre>
      </details>
      <p className="mt-3 text-xs text-muted-foreground">
        This QR code expires in {PENDING_TTL_MINUTES} minutes. Reload the page
        for a fresh one.
      </p>
      <form action={confirmEnrollmentAction} className="mt-6 space-y-3">
        <label className="block text-sm font-medium">
          Enter the 6-digit code from your app
        </label>
        <input
          name="token"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base tracking-widest"
          placeholder="123456"
        />
        <button
          type="submit"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Confirm enrollment
        </button>
      </form>
    </div>
  );
}
