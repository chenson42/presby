"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/auth";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { isLocalLoginEnabled } from "@/lib/auth/local-login";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/request-ip";
import { acceptInvitation, type AcceptResult } from "@/lib/onboarding/accept";
import { isWellFormedInvitationToken } from "@/lib/onboarding/invitation-token";
import {
  INVITE_PAGE_PATH,
  inviteCookieOptions,
  inviteTokenCookieName,
} from "@/lib/onboarding/invite-cookie";
import {
  INVITATION_DEAD_LINK_COPY,
  inviteeBlockedCopy,
} from "@/lib/onboarding/labels";

/**
 * `(invite)`'s Server Actions: the public, token-consuming account-invitation
 * flow (DECISION-183/185, docs/work-log/2026-10-21-invitations.md Phase 3
 * section 3). The token is the credential, so most of these are DELIBERATELY
 * anonymous - there is no `FEATURES.*` key for acceptance (the third access
 * mechanism, DECISION-147). The two that accept authority differ:
 *   - `acceptNewAccountAction`: no `auth()` for the new account itself, but it
 *     REFUSES if a session exists (a signed-in visitor must accept as that
 *     account instead);
 *   - `acceptSignedInAction`: `auth()` required, and G9 - an account that must
 *     use 2FA must be 2FA-verified in THIS session before it can accept
 *     authority (the page is public, so the page itself cannot enforce it).
 *
 * THIS FILE NEVER IMPORTS `getPlatformDb()` (S4, source-scan test): the only
 * database access is through `@/lib/onboarding/accept`, i.e. presby_app and
 * the two definer functions. It holds no `db.*` call of its own and writes no
 * audit row of its own - `acceptInvitation()` writes every audit row in the
 * acceptance transaction - so `check:audit` has nothing to see here, and the
 * per-outcome audit tests live in `src/lib/onboarding/accept.db.test.ts`.
 *
 * `userId` for the existing-account path comes ONLY from `auth()` (D-3); form
 * data supplies the token and the new-account fields, never an identity.
 *
 * The token never appears in `callbackUrl`, a redirect URL, audit metadata or
 * a log; the cookie actions below are how it crosses sign-in (R6).
 */

export type AcceptErrorCode =
  | "rate_limited"
  | "signed_in"
  | "not_signed_in"
  | "two_factor_required"
  | "local_login_disabled"
  | "dead"
  | "account_exists"
  | "email_mismatch"
  | "account_inactive"
  | "blocked"
  | "invalid_input"
  | "password_mismatch"
  | "db_error";

/** What `useActionState` holds. `idle` is the initial state the form passes in. */
export type AcceptFormState =
  | { status: "idle" }
  | {
      status: "error";
      code: AcceptErrorCode;
      /** The user-facing sentence, ready to render in a role="alert" region. */
      message: string;
      /** The field a validation message belongs to, for aria-describedby and focus. */
      field?: "firstName" | "lastName" | "password" | "confirm";
    };

const MESSAGES = {
  rate_limited: (mins: number) =>
    `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
  signed_in: "You're signed in. Sign out first, or sign in to accept this invitation.",
  not_signed_in: "Sign in to accept this invitation.",
  two_factor_required:
    "Your account uses two-factor sign-in. Finish the verification step, then accept the invitation.",
  local_login_disabled:
    "Password sign-in is turned off right now, so an account can't be created from this link.",
  account_exists: "An account already exists for this address. Sign in to accept.",
  email_mismatch:
    "You're signed in as another account. Sign out to accept this invitation.",
  account_inactive: "This account has been deactivated, so it can't accept this invitation.",
  password_mismatch: "The two passwords don't match.",
  password_short: "Use at least 8 characters.",
  password_long: "Use at most 72 bytes. Shorten the password, or use fewer accented or emoji characters.",
  first_name: "Enter your first name (up to 100 characters).",
  last_name: "Enter your last name (up to 100 characters).",
  db_error: "We can't finish setting up your account right now. Your link is still good.",
} as const;

function failure(
  code: AcceptErrorCode,
  message: string,
  field?: "firstName" | "lastName" | "password" | "confirm",
): AcceptFormState {
  return { status: "error", code, message, ...(field ? { field } : {}) };
}

function tokenFrom(formData: FormData): string | null {
  const raw = formData.get("token");
  return typeof raw === "string" && isWellFormedInvitationToken(raw) ? raw : null;
}

async function clearHandoffCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(inviteTokenCookieName(), "", {
    ...inviteCookieOptions(),
    maxAge: 0,
  });
}

/** The IP-keyed second layer (never token-keyed: a token-keyed limit would let anyone holding a link lock the invitee out). */
async function limitByIp(): Promise<AcceptFormState | null> {
  const hdrs = await headers();
  const ip = getRequestIp(hdrs);
  const limited = await checkRateLimit(
    `invite_accept:${ip ?? "unknown"}`,
    { max: 10, windowSeconds: 3600 },
    { userId: null, actor: ip ?? "unknown", reason: "invitation_accept" },
  );
  if (limited.allowed) return null;
  return failure("rate_limited", MESSAGES.rate_limited(Math.ceil(limited.retryAfterSeconds / 60)));
}

/** Map every non-accepted result to the inline-error state. Only reached after the call returned. */
function errorFor(result: Exclude<AcceptResult, { kind: "accepted" }>): AcceptFormState {
  switch (result.kind) {
    case "dead":
      return failure("dead", INVITATION_DEAD_LINK_COPY);
    case "account_exists":
      return failure("account_exists", MESSAGES.account_exists);
    case "email_mismatch":
      return failure("email_mismatch", MESSAGES.email_mismatch);
    case "account_inactive":
      return failure("account_inactive", MESSAGES.account_inactive);
    case "blocked":
      return failure("blocked", inviteeBlockedCopy(result.purpose, result.reason, result.organizationName));
    case "needs_second_factor":
      // Only the in-place presentation returns this; the token wrapper never
      // does. Mapped (not left to fall through) so the switch stays exhaustive.
      return failure("two_factor_required", MESSAGES.two_factor_required);
    case "invalid_input":
      if (result.field === "firstName") return failure("invalid_input", MESSAGES.first_name, "firstName");
      if (result.field === "lastName") return failure("invalid_input", MESSAGES.last_name, "lastName");
      return failure("invalid_input", "Choose a password of 8 to 72 bytes.", "password");
    case "db_error":
      return failure("db_error", MESSAGES.db_error);
  }
}

// ---------------------------------------------------------------------------
// acceptNewAccountAction - fields: token, firstName, lastName, password, confirm
// ---------------------------------------------------------------------------

export async function acceptNewAccountAction(
  _prev: AcceptFormState,
  formData: FormData,
): Promise<AcceptFormState> {
  const limited = await limitByIp();
  if (limited) return limited;

  // A signed-in visitor accepts AS that account (acceptSignedInAction), never by minting a second one.
  const session = await auth();
  if (session?.user) return failure("signed_in", MESSAGES.signed_in);

  const token = tokenFrom(formData);
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    return failure("password_mismatch", MESSAGES.password_mismatch, "confirm");
  }

  // No password is offered while local login is off (G8); refuse it server-side too.
  if (!(await isLocalLoginEnabled())) {
    return failure("local_login_disabled", MESSAGES.local_login_disabled);
  }

  // A malformed token still does the new-account work inside acceptInvitation
  // (bcrypt before the token lookup) - the dead bucket costs what a live one does.
  const result = await acceptInvitation({
    token: token ?? "",
    mode: {
      kind: "new_account",
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      password,
    },
  });

  if (result.kind === "accepted") {
    await clearHandoffCookie();
    redirect("/invite/accepted");
  }
  if (result.kind === "invalid_input" && result.field === "password") {
    // Distinguish too short from too long for the inline hint.
    const bytes = Buffer.byteLength(password, "utf8");
    return failure(
      "invalid_input",
      bytes > 72 ? MESSAGES.password_long : MESSAGES.password_short,
      "password",
    );
  }
  return errorFor(result);
}

// ---------------------------------------------------------------------------
// acceptSignedInAction - fields: token. Identity from auth() ONLY.
// ---------------------------------------------------------------------------

export async function acceptSignedInAction(
  _prev: AcceptFormState,
  formData: FormData,
): Promise<AcceptFormState> {
  const limited = await limitByIp();
  if (limited) return limited;

  const session = await auth();
  if (!session?.user?.id) return failure("not_signed_in", MESSAGES.not_signed_in);

  // G9: this authority is granted to an account, so an account that requires
  // 2FA must be 2FA-verified in this session. /invite is public, so the proxy
  // does not enforce it for us.
  if (session.user.twoFactorRequired && !session.user.twoFactorVerified) {
    return failure("two_factor_required", MESSAGES.two_factor_required);
  }

  const token = tokenFrom(formData);
  if (!token) return failure("dead", INVITATION_DEAD_LINK_COPY);

  const result = await acceptInvitation({
    token,
    mode: {
      kind: "existing_account",
      userId: session.user.id,
      email: session.user.email ?? null,
    },
  });

  if (result.kind === "accepted") {
    await clearHandoffCookie();
    // Re-sign the session cookie. The proxy decides the /o/* 2FA wall from the
    // COOKIE's `twoFactorRequired` claim (it never reaches the database), and
    // accepting can ADD a reason to require 2FA (a treasurer holds giving keys,
    // arm B of presby_two_factor_required) for an account whose cookie says it
    // is not required. jwt() recomputes the claim from the database on every
    // run, but only an update re-issues the cookie. The invitation is already
    // committed, so a failed refresh must not turn success into an error: the
    // pages that hold tier-2 data gate 2FA themselves from a fresh auth().
    try {
      await unstable_update({});
    } catch {
      console.error("[invite] session refresh after accept failed");
    }
    // The slug comes from the definer function's row, never from the request.
    redirect(`/launch?next=${encodeURIComponent(`/o/${result.organizationSlug}`)}`);
  }
  return errorFor(result as Exclude<AcceptResult, { kind: "accepted" }>);
}

// ---------------------------------------------------------------------------
// The cookie hand-off (R6): store the token, then continue without it in a URL.
// Anonymous by design: they write only a cookie holding the visitor's own token.
// ---------------------------------------------------------------------------

async function stashToken(formData: FormData): Promise<boolean> {
  const token = tokenFrom(formData);
  if (!token) return false;
  const jar = await cookies();
  jar.set(inviteTokenCookieName(), token, inviteCookieOptions());
  return true;
}

/** "Sign in to accept" -> `/signin?callbackUrl=/invite` (the token rides the cookie). */
export async function startSignInToAcceptAction(formData: FormData): Promise<void> {
  if (!(await stashToken(formData))) redirect(INVITE_PAGE_PATH);
  redirect(`/signin?callbackUrl=${encodeURIComponent(INVITE_PAGE_PATH)}`);
}

/** A signed-in visitor who still has to pass the 2FA challenge: `/totp?callbackUrl=/invite`. */
export async function continueToVerifyAction(formData: FormData): Promise<void> {
  if (!(await stashToken(formData))) redirect(INVITE_PAGE_PATH);
  redirect(`/totp?callbackUrl=${encodeURIComponent(INVITE_PAGE_PATH)}`);
}

/** "Sign out to accept": store the token, sign out, land back on `/invite`. */
export async function switchAccountAction(formData: FormData): Promise<void> {
  await stashToken(formData);
  await signOutAction(INVITE_PAGE_PATH);
}
