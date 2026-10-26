"use server";

import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/auth";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { checkRateLimit } from "@/lib/rate-limit";
import { acceptInvitationInPlace } from "@/lib/onboarding/accept";
import { connectSignedInAccount } from "@/lib/onboarding/connect";
import { UUID_RE } from "@/lib/onboarding/input";
import { INVITATION_DEAD_IN_PLACE_COPY, inviteeBlockedCopy } from "@/lib/onboarding/labels";
import { NO_ORG_COPY, NO_ORG_INVITATION_COPY } from "@/lib/onboarding/no-organization-copy";

/**
 * `/no-organization`'s Server Actions (Community Increment 2b, Batch B2;
 * amendment 2 section 7.3): "Check again", "Accept the invitation" (in place)
 * and "Sign in with a different account".
 *
 * `no-organization` is a route directly under `app/`, not a route group: the
 * platform palette, `db` definers only (never `getPlatformDb()`), and it keeps
 * its own `loading.tsx` (the page always renders). These actions hold no `db.*`
 * call and write no audit row of their own: `connectSignedInAccount()` writes
 * `tenant.person.sign_in_connected` and `acceptInvitationInPlace()` writes the
 * acceptance rows, each in the transaction that made the change, so
 * `check:audit` passes vacuously, as it does for `(invite)/actions.ts`.
 *
 * IDENTITY AND FACTOR COME FROM `auth()` ONLY (E-30, DECISION-230). The user id
 * is `session.user.id`, the second-factor flag is `session.user.twoFactorVerified
 * === true`, and the only thing a form supplies is an invitation ID, which is a
 * selection, not an identity (a foreign id is the same `dead` as an unknown one,
 * and the definer re-derives everything from the invitation row and the proven
 * account). Neither action takes a redirect target.
 *
 * THE SESSION IS REFRESHED WITH AN EMPTY PAYLOAD. After a connection or an
 * acceptance the cookie's claims may be stale (a congregation's two-factor
 * requirement now applies, or a held permission does), so the action calls
 * `unstable_update({})`: the `jwt` callback recomputes every claim from the
 * database and reads NOTHING from the payload (DECISION-230). No file under
 * this directory imports the verification grant or passes data to the update; a
 * source scan holds both lines.
 *
 * The connection is committed before the refresh, so a failed refresh must not
 * turn success into an error: it is swallowed, and `/launch` and the pages
 * gate two-factor from a fresh `auth()` regardless.
 */

export type NoOrgActionState =
  | { status: "idle" }
  | { status: "nothing_new" }
  | { status: "needs_second_factor" }
  | {
      status: "error";
      code: "not_signed_in" | "rate_limited" | "dead" | "blocked" | "invalid_input" | "db_error";
      message: string;
    };

function failure(code: Extract<NoOrgActionState, { status: "error" }>["code"], message: string): NoOrgActionState {
  return { status: "error", code, message };
}

async function refreshSession(): Promise<void> {
  try {
    await unstable_update({});
  } catch {
    console.error("[no-organization] session refresh failed");
  }
}

// ---------------------------------------------------------------------------
// checkAgainAction
// ---------------------------------------------------------------------------

export async function checkAgainAction(
  _prev: NoOrgActionState,
  _formData: FormData,
): Promise<NoOrgActionState> {
  const session = await auth();
  // The page itself redirects a signed-out visitor; an action reached after the
  // session lapsed does the same rather than invent a sentence.
  if (!session?.user?.id) redirect("/signin?callbackUrl=%2Fno-organization");

  const limited = await checkRateLimit(
    `no_org_check:${session.user.id}`,
    { max: 30, windowSeconds: 3600 },
    { userId: session.user.id, actor: session.user.id, reason: "no_organization_check" },
  );
  if (!limited.allowed) {
    return failure("rate_limited", NO_ORG_INVITATION_COPY.rateLimited(Math.ceil(limited.retryAfterSeconds / 60)));
  }

  const result = await connectSignedInAccount({
    userId: session.user.id,
    via: "check_again",
    secondFactorVerified: session.user.twoFactorVerified === true,
    actorEmail: session.user.email ?? null,
  });

  switch (result.kind) {
    case "connected":
    case "already_connected":
      await refreshSession();
      redirect("/launch");
    case "needs_second_factor":
      return { status: "needs_second_factor" };
    case "declined":
      return { status: "nothing_new" };
    case "error":
      return failure("db_error", NO_ORG_COPY.checkFailed);
  }
}

// ---------------------------------------------------------------------------
// acceptInPlaceAction - field: invitationId. Identity from auth() ONLY.
// ---------------------------------------------------------------------------

export async function acceptInPlaceAction(
  _prev: NoOrgActionState,
  formData: FormData,
): Promise<NoOrgActionState> {
  const session = await auth();
  if (!session?.user?.id) return failure("not_signed_in", NO_ORG_INVITATION_COPY.signedOut);

  const limited = await checkRateLimit(
    `no_org_accept:${session.user.id}`,
    { max: 20, windowSeconds: 3600 },
    { userId: session.user.id, actor: session.user.id, reason: "no_organization_accept" },
  );
  if (!limited.allowed) {
    return failure("rate_limited", NO_ORG_INVITATION_COPY.rateLimited(Math.ceil(limited.retryAfterSeconds / 60)));
  }

  const raw = formData.get("invitationId");
  const invitationId = typeof raw === "string" && UUID_RE.test(raw) ? raw : null;
  // A malformed id is the dead bucket, like an unknown one.
  if (!invitationId) return failure("dead", INVITATION_DEAD_IN_PLACE_COPY);

  // G9 parity with the emailed-link path: an account that must use two-factor
  // sign-in must be verified in THIS session before it can accept authority.
  // Answered before the database, so it is never a database oracle.
  if (session.user.twoFactorRequired && !session.user.twoFactorVerified) {
    return { status: "needs_second_factor" };
  }

  const result = await acceptInvitationInPlace({
    invitationId,
    userId: session.user.id,
    email: session.user.email ?? null,
    secondFactorVerified: session.user.twoFactorVerified === true,
  });

  switch (result.kind) {
    case "accepted":
      await refreshSession();
      // The slug comes from the definer function's row, never from the request.
      redirect(`/launch?next=${encodeURIComponent(`/o/${result.organizationSlug}`)}`);
    case "needs_second_factor":
      return { status: "needs_second_factor" };
    case "blocked":
      return failure("blocked", inviteeBlockedCopy(result.purpose, result.reason, result.organizationName));
    case "db_error":
      return failure("db_error", NO_ORG_INVITATION_COPY.dbError);
    // The token path's outcomes cannot come back from the in-place definer
    // (every identity miss is `dead`); mapped, never invented, so the switch
    // stays exhaustive and a surprise is the dead bucket.
    case "dead":
    case "account_exists":
    case "email_mismatch":
    case "account_inactive":
    case "invalid_input":
      return failure("dead", INVITATION_DEAD_IN_PLACE_COPY);
  }
}

// ---------------------------------------------------------------------------
// switchAccountAction
// ---------------------------------------------------------------------------

/** "Sign in with a different account": sign out, then back to the sign-in page, returning to /launch. */
export async function switchAccountAction(): Promise<void> {
  await signOutAction("/signin?callbackUrl=%2Flaunch");
}
