import "server-only";
import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import {
  assertGivingSession,
  givingTotpRedirectUrl,
  loadGivingContext,
} from "./access";
import { zodFieldErrors, type FieldErrors } from "./field-errors";

/**
 * The gate every `admin/giving/**` server action runs first - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Gate order on every surface" and the
 * API contract's conventions ("start with auth() -> resolveOrgContext() ->
 * Node 2FA check -> toggle -> permission").
 *
 * `organizationId` NEVER comes from the client: the action takes the URL slug
 * and re-resolves it through `resolveOrgContext()` inside THIS user's own
 * memberships, exactly as every other `actions.ts` in the tree does. `auth()`
 * is used directly (never `cachedAuth()`): a server action is its own
 * invocation, where `cache()` is a no-op.
 *
 * Every failure is a plain `{ ok: false, error }` the form can toast, except
 * the 2FA refusal, which also carries `kind: "two_factor_required"` and a
 * `redirectTo` so the client can send the user to the challenge instead of
 * leaving them with a toast and no way forward. The database blip is its own
 * honest message - never a silent "not allowed".
 */

export type GivingNeed = "view" | "record" | "manage";

/**
 * Why an action failed, when the form needs to react differently than "toast
 * the message". Absent for an ordinary refusal. `two_factor_required` is the
 * shared gate's; the rest are the Stripe connection actions' (Batch 3):
 *   stripe_unconfigured  the installation has no Stripe key / webhook secret / origin
 *   already_connected    the congregation already has an open connection
 *   provider_error       Stripe could not be reached or refused the request
 *   no_connection        there is no open connection to act on
 *   not_ready            go-live refused; `missing` names what is outstanding
 */
export type GivingFailureKind =
  | "two_factor_required"
  | "stripe_unconfigured"
  | "already_connected"
  | "provider_error"
  | "no_connection"
  | "not_ready";

export interface GivingActionFailure {
  ok: false;
  error: string;
  kind?: GivingFailureKind;
  /** For `not_ready`: the go-live blockers still outstanding (`connection_active`, `online_fund`, `payouts_attested`). */
  missing?: string[];
  /** Where to send the user (the /totp challenge) when `kind` is `two_factor_required`. */
  redirectTo?: string;
  /** Inline, per-field messages (dotted form paths) for `invalid` outcomes. */
  fieldErrors?: FieldErrors;
}

/** The result shape of every giving action: `ActionResult` plus the optional extras above. */
export type GivingActionResult<T = void> = { ok: true; data?: T } | GivingActionFailure;

export interface GivingActionIdentity {
  ok: true;
  userId: string;
  /** The signed-in user's email, for the one action that sends it onward (the connect action's Stripe contact). */
  email: string | null;
  personId: string;
  organizationId: string;
  has: { view: boolean; record: boolean; manage: boolean };
}

export async function gateGivingAction(
  slug: string,
  anyOf: readonly GivingNeed[],
): Promise<GivingActionIdentity | GivingActionFailure> {
  const session = await auth();
  const check = assertGivingSession(session);
  if (check.kind === "unauthenticated") {
    return { ok: false, error: "You must be signed in to do that." };
  }
  if (check.kind === "two_factor_required") {
    return {
      ok: false,
      kind: "two_factor_required",
      error: "Please confirm your two-factor code to continue.",
      redirectTo: givingTotpRedirectUrl(`/o/${slug}/admin/giving`),
    };
  }

  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  let context: Awaited<ReturnType<typeof loadGivingContext>>;
  try {
    context = await loadGivingContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
  } catch (err) {
    if (err instanceof OrgAccessError) {
      return { ok: false, error: "You don't have access to that organization." };
    }
    return { ok: false, error: "We couldn't check your access just now. Try again in a moment." };
  }

  switch (context.kind) {
    case "not_applicable":
      return { ok: false, error: "Giving isn't available for this organization." };
    case "toggle_off":
      return { ok: false, error: "Giving isn't turned on for this organization." };
    case "forbidden":
      return { ok: false, error: "You don't have permission to do that." };
    case "ok":
      break;
  }
  if (!anyOf.some((key) => context.has[key])) {
    return { ok: false, error: "You don't have permission to do that." };
  }

  return {
    ok: true,
    userId: check.userId,
    email: session?.user?.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    has: context.has,
  };
}

/** A zod failure as the action result every giving form understands. */
export function invalidInput(error: import("zod").ZodError): GivingActionFailure {
  return {
    ok: false,
    error: "Check the highlighted fields and try again.",
    fieldErrors: zodFieldErrors(error),
  };
}
