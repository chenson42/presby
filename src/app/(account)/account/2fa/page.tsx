import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  userTotp,
  userTotpRecoveryCodes,
} from "@/lib/db/schema";
import { isTotpConfigured } from "@/lib/two-factor";
import {
  getOrCreatePendingEnrollment,
  PENDING_TTL_MINUTES,
} from "@/lib/totp-pending";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
import { TotpEnrollForm } from "./totp-enroll-form";
import { RegenerateCodesForm } from "./regenerate-codes-form";
import { FormattedDate } from "@/components/shared/formatted-date";
import { ConfirmItsYou } from "./confirm-its-you";
import { ContinueButton } from "./continue-button";
import { EnrolmentHandoff } from "./enrolment-handoff";

/**
 * Every `return (` below opens with <EnrolmentHandoff callbackUrl={callbackUrl}>:
 * the same component, in the same place, with no key, in every branch. That is
 * what lets the one-time recovery codes survive the re-render that follows
 * enrolment (a cookie write in a server action re-renders the route in Next 16,
 * and enrolment marks the session verified). A branch added without it, or a
 * `key` on it, breaks the codes in a way only a browser would show; page.test.tsx
 * P1 and P4 pin it. `callbackUrl` is the sanitized value; hostile input is /launch.
 */
export default async function AccountTwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/account/2fa");

  const sp = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl);
  const hasCallback =
    typeof sp.callbackUrl === "string" && sp.callbackUrl.length > 0;

  const existing = await db.query.userTotp.findFirst({
    where: eq(userTotp.userId, session.user.id),
  });

  // Already enrolled — show management view
  if (existing) {
    const recoveryRows = await db.query.userTotpRecoveryCodes.findMany({
      where: eq(userTotpRecoveryCodes.userId, session.user.id),
    });
    const totalCodes = recoveryRows.length;
    const unusedCount = recoveryRows.filter((c) => !c.usedAt).length;

    return (
      <EnrolmentHandoff callbackUrl={callbackUrl}>
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You enrolled on{" "}
            <FormattedDate value={existing.enrolledAt} mode="date" />.
            {existing.lastUsedAt && (
              <> Last used: <FormattedDate value={existing.lastUsedAt} mode="datetime" />.</>
            )}
          </p>

          {/* Reload, back or a second tab after enrolling: the way onward, when the
              request carried a destination. Never the raw query string. */}
          {hasCallback && <ContinueButton href={callbackUrl} />}

          <div className="mt-6 rounded-md border border-border p-4">
            <h2 className="text-sm font-semibold">Recovery codes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {unusedCount} unused code{unusedCount === 1 ? "" : "s"} remaining
              (of {totalCodes} total).
            </p>
            {session.user.twoFactorVerified ? (
              <RegenerateCodesForm />
            ) : (
              <ConfirmItsYou callbackUrl={callbackUrl} hasCallback={hasCallback} />
            )}
          </div>
        </div>
      </EnrolmentHandoff>
    );
  }

  // Enrolment needs the encryption key. Without it, getOrCreatePendingEnrollment
  // throws out of key() mid-render and the page dies with an unhandled runtime
  // error that tells the member nothing. Say what is wrong instead.
  if (!isTotpConfigured()) {
    return (
      <EnrolmentHandoff callbackUrl={callbackUrl}>
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium">Not available right now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Two-factor enrolment isn&apos;t configured on this deployment.
              Please contact an administrator — no action is needed from you.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Administrators: set <code>AUTH_TOTP_ENCRYPTION_KEY</code> (32 bytes,
              base64) and restart. Rotating it invalidates every existing
              enrolment.
            </p>
          </div>
        </div>
      </EnrolmentHandoff>
    );
  }

  // Not enrolled — reuse the pending row if it's still valid, otherwise mint
  // a new one.  Reusing the row keeps the QR code stable across page reloads
  // within the TTL window so the user's authenticator app stays in sync. The
  // page shows what the database holds (F342): the helper never returns a secret
  // it did not see stored.
  const enrollData = await getOrCreatePendingEnrollment(
    session.user.id,
    session.user.email ?? "user@example.com",
  );

  return (
    <EnrolmentHandoff callbackUrl={callbackUrl}>
      <TotpEnrollForm
        uri={enrollData.uri}
        secret={enrollData.secret}
        pendingTtlMinutes={PENDING_TTL_MINUTES}
      />
    </EnrolmentHandoff>
  );
}
