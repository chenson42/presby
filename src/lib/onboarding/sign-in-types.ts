/**
 * The vocabularies, limits and pure derivations of the congregation's
 * sign-in invitation (Community Increment 2b, Batch B2; Phase 3 "Pure shared
 * modules" and amendment 2 section 7.7). PURE and client-safe: no database, no
 * `server-only`, no import from the library, so a client component can read
 * the types and the derivations and nothing here can reach a connection.
 *
 * Every closed list below is pinned to the SQL `outcome := '...'` literals of
 * drizzle/0065 section 12 by `sign-in-types.test.ts` (the `ROLL_DECISION_
 * REFUSALS` pattern): a literal added to the migration and not here, or the
 * reverse, fails the build.
 *
 * Nothing here decides anything. Who may be invited, who connects and who needs
 * a second factor are decided in SQL (the standing core and the callables);
 * `connectOutlook()` is DISPLAY ONLY, a hedged sentence for an administrator,
 * and says so (R46: own-organization facts only; a global decline is invisible
 * to this screen by design).
 */
import type { DeliveryState } from "./status";

/**
 * Durable limits (G9, R32), counted over `origin = 'org'` rows in a rolling 24
 * hours. The SQL carries the same literals (30 / 30 / 3, 5 minutes, 5); a test
 * reads the migration and holds them equal, and `expiryDays` equal to
 * `issue.ts`'s `INVITATION_EXPIRY_DAYS`.
 */
export const SIGN_IN_INVITATION_LIMITS = {
  perOrganizationPer24h: 30,
  perInviterPer24h: 30,
  perAddressPer24h: 3,
  resendCooldownMinutes: 5,
  maxResendsPerChain: 5,
  expiryDays: 7,
} as const;

/** Refusals issue and resend both return (the shared check, plus the limits and `already_pending`). */
export const SIGN_IN_ISSUE_REFUSALS = [
  "not_found",
  "already_signs_in",
  "person_merged",
  "person_deceased",
  "membership_ended",
  "needs_support",
  "needs_officers_permission",
  "exceeds_your_access",
  "no_email_on_file",
  "address_changed",
  "address_is_yours",
  "address_shared",
  "needs_acknowledgement",
  "already_pending",
  "rate_limited",
] as const;

/** Refusals only resend returns. */
export const SIGN_IN_RESEND_ONLY_REFUSALS = ["not_open", "cooldown", "chain_cap"] as const;

export const SIGN_IN_REFUSALS = [...SIGN_IN_ISSUE_REFUSALS, ...SIGN_IN_RESEND_ONLY_REFUSALS] as const;
export type SignInRefusal = (typeof SIGN_IN_REFUSALS)[number];

/** The revoke definer's outcomes. (The library also answers `not_found` for a malformed id.) */
export const SIGN_IN_REVOKE_OUTCOMES = ["ok", "not_open"] as const;
export type SignInRevokeOutcome = (typeof SIGN_IN_REVOKE_OUTCOMES)[number];

/** Why a send needs the sender's acknowledgement (F177 Option 3, condition 1: the database asks). */
export const SIGN_IN_ACK_REASONS = ["do_not_contact", "visitor"] as const;
export type SignInAckReason = (typeof SIGN_IN_ACK_REASONS)[number];

/** The reader's state column. `signs_in` is `people.user_id is not null` and takes precedence. */
export const SIGN_IN_STATES = ["signs_in", "pending", "expired", "blocked", "revoked", "none"] as const;
export type SignInState = (typeof SIGN_IN_STATES)[number];

/** The reader's outcome column, set only for `blocked`: the three own-organization reasons and the collapse. */
export const SIGN_IN_BLOCK_OUTCOMES = [
  "membership_ended",
  "person_merged",
  "person_deceased",
  "needs_support",
] as const;
export type SignInBlockOutcome = (typeof SIGN_IN_BLOCK_OUTCOMES)[number];

/** Where a connection came from, as the reader derives it from this organization's own rows. */
export const SIGN_IN_CONNECTED_VIA = ["sign_in", "invitation"] as const;
export type SignInConnectedVia = (typeof SIGN_IN_CONNECTED_VIA)[number];

/** `presby_membership_standing()`'s closed result (S13/R50). Only `visitor` is tested in 2b. */
export const MEMBERSHIP_STANDINGS = ["listed", "staff_anchor", "visitor", "inactive", "unclassified"] as const;
export type MembershipStanding = (typeof MEMBERSHIP_STANDINGS)[number];

/**
 * What a revoke-all revokes (F198, one lever per origin, never a mixed one).
 * `designations`: the platform's own founding-administrator and treasurer
 * invitations. `org_sent`: the congregation's sign-in invitations, the kill
 * lever for an organization that abuses them. The platform action requires one
 * and refuses a missing or unknown value, so a caller can never fall into
 * revoking the other origin by omission.
 */
export const REVOKE_ALL_SCOPES = ["designations", "org_sent"] as const;
export type RevokeAllScope = (typeof REVOKE_ALL_SCOPES)[number];

/** Exhaustiveness helper: a `never` default turns a new member into a type error. */
export function assertNever(value: never, context = "value"): never {
  throw new Error(`Unhandled ${context}: ${String(value)}`);
}

// ---------------------------------------------------------------------------
// The server action result (shared by the three community edit actions and the
// card/dialog that consume them)
// ---------------------------------------------------------------------------

export type SignInActionResult =
  | { ok: true; data: { address: string; expiresAt: string; delivery: "sent" | "queued" } }
  | {
      ok: false;
      /** User-facing. Empty when `needsAcknowledgement` is set: the dialog shows its acknowledgement paragraphs, never this. */
      error: string;
      /** Present when the server asks the sender to acknowledge (F177). The dialog re-opens with these. */
      needsAcknowledgement?: SignInAckReason[];
      /** Present for a cooldown: whole minutes, rounded up. */
      retryAfterMinutes?: number;
    };

// ---------------------------------------------------------------------------
// The card (edit page), the markers (lists) and the Session hand-off rows
// ---------------------------------------------------------------------------

/**
 * The connect line's closed result (R46, amendment 2 section 7.7). DISPLAY
 * ONLY. `connected` is the person's own link; the others are hedged claims
 * about what signing in will do, built from own-organization facts.
 */
export const CONNECT_OUTLOOKS = [
  "connected",
  "by_sign_in",
  "by_sign_in_second_factor",
  "visitor",
  "shared_address",
  "turned_off",
  "none",
] as const;
export type ConnectOutlook = (typeof CONNECT_OUTLOOKS)[number];

export interface ConnectOutlookInput {
  state: SignInState;
  hasAddress: boolean;
  standing: MembershipStanding | null;
  authorityBearing: boolean;
  addressShared: boolean;
  /** The organization's `org_portal.sign_in_connect` toggle (an absent row is off). */
  selfConnectEnabled: boolean;
  connectedVia: SignInConnectedVia | null;
}

/**
 * What an administrator is told will happen when the person signs in with the
 * address on their record. Precedence, first match wins:
 *
 *   1. linked                                  -> connected
 *   2. an open invitation (pending), a blocked
 *      one, or no address on file              -> none (the card's own state
 *                                                 copy says why; the pending
 *                                                 and no-address lines are the
 *                                                 card's, not this function's)
 *   3. the organization's toggle is off        -> turned_off
 *   4. another live person holds the address   -> shared_address
 *   5. the person is a visitor                 -> visitor
 *   6. the record bears authority              -> by_sign_in_second_factor
 *   7. otherwise                               -> by_sign_in
 *
 * Why the toggle comes before the others: with it off nothing connects, so the
 * lines about visitors or shared addresses would describe a distinction that
 * does not matter. `by_sign_in*` are hedged in the copy ("if it can", "once
 * they have confirmed") because a global decline (the address shared in another
 * congregation, the account already linked elsewhere, an unproven account) is
 * invisible here by design. No branch claims prevention (F232).
 */
export function connectOutlook(input: ConnectOutlookInput): ConnectOutlook {
  if (input.state === "signs_in") return "connected";
  if (input.state === "pending" || input.state === "blocked") return "none";
  if (!input.hasAddress) return "none";
  if (!input.selfConnectEnabled) return "turned_off";
  if (input.addressShared) return "shared_address";
  if (input.standing === "visitor") return "visitor";
  if (input.authorityBearing) return "by_sign_in_second_factor";
  return "by_sign_in";
}

/** One person's card, as `getSignInCard` returns it (own-organization facts only). */
export interface SignInCardState {
  personId: string;
  state: SignInState;
  /** `people.user_id is not null`. Never read from `users` (DECISION-189). */
  linked: boolean;
  connectedVia: SignInConnectedVia | null;
  /** 'YYYY-MM-DD', or null. */
  connectedOn: string | null;
  /** The credential address on file (the address a send would go to), or null. */
  address: string | null;
  /** The address a pending/expired invitation went to, only while it is still on the record. */
  invitedAddress: string | null;
  /** False when the invited address has left the record (the earlier link no longer works). */
  addressCurrent: boolean | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  resendCount: number;
  nextResendAt: Date | null;
  /** Whole minutes until Send again is allowed (0 when it is), for an open row. */
  cooldownMinutes: number;
  chainCapReached: boolean;
  delivery: DeliveryState;
  blockedOutcome: SignInBlockOutcome | null;
  /** The person is a visitor: the send dialog shows the acknowledgement paragraph up front. */
  isVisitor: boolean;
  /** The address is marked do-not-contact: the dialog asks once the server says so. */
  addressDoNotContact: boolean;
  authorityBearing: boolean;
  addressShared: boolean;
  /** `org_portal.sign_in_connect` for this organization. */
  selfConnectEnabled: boolean;
  outlook: ConnectOutlook;
}

/** The markers on the Community lists and the Officers roster. Icon and word, never colour alone. */
export type SignInMarker =
  | { kind: "pending"; sentAt: Date }
  | { kind: "expired" }
  | { kind: "bounced" }
  | { kind: "not_connected"; noEmail: boolean };

export const SESSION_ROW_STATES = ["no_email", "not_invited", "sent", "expired", "bounced"] as const;
export type SessionRowState = (typeof SESSION_ROW_STATES)[number];

/** One Session seat without a connected sign-in, for the hand-off under the banner. */
export interface SessionSignInRow {
  personId: string;
  /** `preferred or first, last`. */
  name: string;
  state: SessionRowState;
  sentAt: Date | null;
  /** "Invite" when nothing is out and there is an address; "Open" otherwise. */
  action: "invite" | "open";
}

/** The inputs the marker and Session-row derivations read from the reader row. */
export interface SignInStateFacts {
  linked: boolean;
  state: SignInState;
  sentAt: Date | null;
  delivery: DeliveryState;
}

const BOUNCED_DELIVERIES: ReadonlySet<DeliveryState> = new Set(["bounced", "failed"]);

/**
 * The marker for one person, or null for none. Shown when the invitation is
 * pending, expired or blocked, or when the state is none or revoked and the
 * person holds authority that is inert while unconnected (Phase 3; a marker on
 * every ordinary member of a 400-person congregation is noise). Never for a
 * person who is connected. A blocked invitation reads as "Not connected yet":
 * the person is unconnected and the card says why.
 */
export function deriveSignInMarker(
  facts: SignInStateFacts,
  extras: { holdsInertAuthority: boolean; hasAddress: boolean },
): SignInMarker | null {
  if (facts.linked || facts.state === "signs_in") return null;
  switch (facts.state) {
    case "pending":
      if (BOUNCED_DELIVERIES.has(facts.delivery)) return { kind: "bounced" };
      return facts.sentAt ? { kind: "pending", sentAt: facts.sentAt } : { kind: "not_connected", noEmail: !extras.hasAddress };
    case "expired":
      return { kind: "expired" };
    case "blocked":
      return { kind: "not_connected", noEmail: !extras.hasAddress };
    case "none":
    case "revoked":
      return extras.holdsInertAuthority ? { kind: "not_connected", noEmail: !extras.hasAddress } : null;
    default:
      return assertNever(facts.state, "sign-in state");
  }
}

/** The row state for a Session seat: "No email on file · Not invited yet · Invitation sent · expired · bounced". */
export function deriveSessionRowState(facts: SignInStateFacts, extras: { hasAddress: boolean }): SessionRowState {
  switch (facts.state) {
    case "pending":
      return BOUNCED_DELIVERIES.has(facts.delivery) ? "bounced" : "sent";
    case "expired":
      return "expired";
    case "signs_in":
    case "blocked":
    case "revoked":
    case "none":
      return extras.hasAddress ? "not_invited" : "no_email";
    default:
      return assertNever(facts.state, "sign-in state");
  }
}

/** "Invite" only when there is an address and nothing is out; "Open" everywhere else (the card has Send again). */
export function sessionRowAction(state: SessionRowState): "invite" | "open" {
  return state === "not_invited" ? "invite" : "open";
}
