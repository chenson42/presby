import type { ConnectionStatusInput } from "../../types";

/**
 * Turns what Stripe says about a connected account into the neutral
 * `ConnectionStatusInput` that `presby_giving_apply_connection_status()` and
 * `presby_giving_refresh_my_connection()` consume. PURE; handwritten structural
 * input types (not the SDK's), so a fixture or a recorded response with extra
 * or missing fields maps the same way and the module needs no `stripe` import.
 *
 * TWO MAPPERS, ONE ANSWER. Presby creates the account through Accounts v2, but
 * the status events it receives are the v1 `account.updated` snapshot (Phase 3
 * "Stripe confirmations" 1: v2 objects emit v1 snapshot events on the Connect
 * endpoint), while the "Refresh status" button and the return page retrieve the
 * v2 object. The same account must read the same either way, so both mappers
 * are fixture-tested against ONE expected table (`status.test.ts`).
 *
 * WHAT IS CONFIRMED vs NOT (docs/work-log, Stripe confirmation 1). The v2
 * response's merchant capability statuses and `stripe_balance.payouts.status`
 * are in the SDK's own typings (so the paths below are real); what a v2 account
 * does with `requirements.entries` for a never-onboarded account is the part the
 * operator smoke records against a test-mode response. `detailsSubmitted` has no
 * v2 field, so it is inferred (see below) - the SQL only uses it to tell
 * "restricted" from "onboarding".
 *
 * `disabledReason` is a short machine code, lower-case `[a-z0-9_.]`, <= 60 chars
 * (the SQL stores <= 120). It is set only for states that are NOT merely "a
 * requirement is outstanding" - rejection, an unsupported business, a hard
 * restriction - because outstanding requirements already surface as
 * `requirementsDue`, and the SQL treats any disabled reason as "not active".
 */

// ---------------------------------------------------------------------------
// v1: the `account.updated` snapshot (data.object)
// ---------------------------------------------------------------------------

export interface V1AccountSnapshot {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  capabilities?: Record<string, string | undefined>;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
}

export function mapAccountSnapshotToStatus(account: V1AccountSnapshot): ConnectionStatusInput {
  const caps = account.capabilities ?? {};
  const req = account.requirements ?? {};
  return {
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    cardEnabled: caps.card_payments === "active",
    achEnabled: caps.us_bank_account_ach_payments === "active",
    requirementsDue: nonEmpty(req.currently_due) || nonEmpty(req.past_due),
    // `requirements.past_due` / `requirements.pending_verification` are
    // Stripe saying a requirement is outstanding - already `requirementsDue`.
    // Only the reasons that are NOT a requirement survive as a disabled reason.
    disabledReason: v1DisabledReason(req.disabled_reason),
  };
}

function v1DisabledReason(value: string | null | undefined): string | null {
  if (typeof value === "string" && value.startsWith("requirements.")) return null;
  return cleanReason(value);
}

// ---------------------------------------------------------------------------
// v2: GET /v2/core/accounts/{id} (include configuration.merchant, requirements)
// ---------------------------------------------------------------------------

type V2CapabilityStatus =
  | "active"
  | "pending"
  | "restricted"
  | "rejected"
  | "unsupported"
  | (string & {});

interface V2Capability {
  status?: V2CapabilityStatus;
  status_details?: Array<{ code?: string; resolution?: string }> | null;
}

export interface V2AccountSnapshot {
  closed?: boolean;
  configuration?: {
    merchant?: {
      capabilities?: {
        card_payments?: V2Capability | null;
        ach_debit_payments?: V2Capability | null;
        stripe_balance?: { payouts?: V2Capability | null } | null;
      } | null;
    } | null;
  } | null;
  requirements?: {
    entries?: Array<{
      awaiting_action_from?: string;
      minimum_deadline?: { status?: string } | null;
    }> | null;
    summary?: { minimum_deadline?: { status?: string } | null } | null;
  } | null;
}

/** Status-detail codes that are an outstanding REQUIREMENT, not a disabling reason. */
const REQUIREMENT_CODES = new Set([
  "determining_status",
  "requirements_past_due",
  "requirements_pending_verification",
]);

const OVERDUE = new Set(["currently_due", "past_due"]);

export function mapV2AccountToStatus(account: V2AccountSnapshot): ConnectionStatusInput {
  const merchantCaps = account.configuration?.merchant?.capabilities ?? {};
  const card = merchantCaps.card_payments ?? null;
  const ach = merchantCaps.ach_debit_payments ?? null;
  const payouts = merchantCaps.stripe_balance?.payouts ?? null;

  const cardEnabled = card?.status === "active";
  const achEnabled = ach?.status === "active";
  const payoutsEnabled = payouts?.status === "active";

  // Requirements that are due NOW (not "eventually") and are the account
  // holder's to supply. Entries are authoritative; the summary is the fallback
  // when a response carries no entry list.
  const entries = account.requirements?.entries ?? null;
  const dueByEntries = (entries ?? []).filter(
    (e) => e.awaiting_action_from === "user" && OVERDUE.has(e.minimum_deadline?.status ?? ""),
  );
  const requirementsDue =
    entries !== null
      ? dueByEntries.length > 0
      : OVERDUE.has(account.requirements?.summary?.minimum_deadline?.status ?? "");

  // v2 has no `details_submitted`. The account holder has finished their part
  // when nothing is due from them and Stripe is the one holding the ball: a
  // capability exists in a non-initial state, or no entry is awaiting the user.
  const detailsSubmitted = !requirementsDue && (card !== null || ach !== null || payouts !== null);

  return {
    chargesEnabled: cardEnabled || achEnabled,
    payoutsEnabled,
    detailsSubmitted,
    cardEnabled,
    achEnabled,
    requirementsDue,
    disabledReason: v2DisabledReason([card, ach, payouts]),
  };
}

function v2DisabledReason(capabilities: Array<V2Capability | null>): string | null {
  for (const cap of capabilities) {
    if (!cap) continue;
    if (cap.status !== "rejected" && cap.status !== "restricted" && cap.status !== "unsupported") continue;
    const code = (cap.status_details ?? [])
      .map((d) => d.code)
      .find((c): c is string => typeof c === "string" && !REQUIREMENT_CODES.has(c));
    if (code) return cleanReason(code);
    if (cap.status === "rejected" || cap.status === "unsupported") return cleanReason(cap.status);
  }
  return null;
}

// ---------------------------------------------------------------------------

function nonEmpty(list: string[] | null | undefined): boolean {
  return Array.isArray(list) && list.length > 0;
}

/** Lower-case, `[a-z0-9_.]` only, <= 60 chars; null for anything empty. */
function cleanReason(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned === "" ? null : cleaned;
}
