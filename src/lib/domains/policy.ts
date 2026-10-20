import type { DomainState } from "./state";

/**
 * policy.ts - the operator-reviewable thresholds, cadences, limits and caps
 * for custom domains (Phase 3 API Contract section 1, "policy.ts defaults";
 * T11). PURE constants.
 *
 * SOME OF THESE ARE NOT FREE TO CHANGE HERE ALONE. Four numbers have a second,
 * authoritative home in drizzle/0057's triggers, because the database must not
 * trust the application to keep them (A1, suggestion 2, R10):
 *
 *   - the 30-day grace (`c_grace_period`): the trigger stamps `grace_ends_at`;
 *     the values here are what the UI and emails QUOTE.
 *   - the `next_check_at` caps (6 hours; 24 hours while `parked`): the longest
 *     cadence assigned to any state may not exceed its cap, or the trigger
 *     would refuse the service's own scheduling write.
 *   - the claim caps (3 web hosts, 1 mail domain per organization).
 *   - the 7-day pending expiry (the `expires_at` column default).
 *
 * `policy.test.ts` reads the migration and fails if any of the four drifts
 * from this file, in either direction. Change the migration (an unreleased one
 * may be corrected in place; a shipped one needs a new migration) and this file
 * together, or CI will say which half you forgot.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DOMAIN_POLICY = {
  /** A pending claim that never proves control expires (`pending -> expired`). */
  pendingExpiryMs: 7 * DAY,
  /** The grace a lapsed row is held in before release; pinned to the trigger's `c_grace_period`. */
  lapsedGraceMs: 30 * DAY,
  /** The grace a parked (removed) row is held in before release; pinned to the same literal. */
  parkedGraceMs: 30 * DAY,

  /** Caps per organization, non-terminal rows; pinned to the insert trigger. */
  webCap: 3,
  mailCap: 1,

  /**
   * Debounce (G9): a lapse needs this many CONSECUTIVE definitive-absent
   * observations spanning at least `proofLostMinSpanMs`. A DNS error or a
   * resolver disagreement is `unknown` and never counts.
   */
  proofLostMisses: 6,
  proofLostMinSpanMs: 10 * HOUR,
  /** `live -> attached` needs 2 consecutive scheduled definitive-negative probes, 1 when forced. */
  liveLostScheduledMisses: 2,
  liveLostForcedMisses: 1,

  /** "Check now": 6 per 10 minutes per claim, and 30 per hour per organization. */
  checkNowPerClaim: { max: 6, windowSeconds: 10 * 60 },
  checkNowPerOrg: { max: 30, windowSeconds: 60 * 60 },
  /** New claims: 5 per 24 hours per organization. */
  claimsPerOrg: { max: 5, windowSeconds: 24 * 60 * 60 },

  /** An operator alert for the same row and kind repeats no sooner than this. */
  operatorAlertRepeatMs: 24 * HOUR,
  /** An attach or detach that has failed continuously this long escalates to the operator. */
  providerFailingAlertMs: 24 * HOUR,
  /** The "records still point at us" reminder for a parked domain repeats no sooner than this. */
  parkedReminderMs: 7 * DAY,

  /**
   * The cron sweep (T11). A row is leased by pushing its `next_check_at` out
   * `leaseMs` at pick time, so a second sweep (or a retried invocation) cannot
   * take it; if the sweep dies mid-row the lease simply expires and the row is
   * due again. The default batch is what one 60 second invocation can chew.
   */
  sweep: { leaseMs: 10 * MINUTE, defaultLimit: 50, maxLimit: 200, concurrency: 5 },
} as const;

/**
 * The longest `next_check_at` the update trigger accepts ahead of now, by state
 * (suggestion 2, adopted state-aware): 6 hours everywhere except `parked`.
 */
export const NEXT_CHECK_CAP_MS = {
  default: 6 * HOUR,
  parked: 24 * HOUR,
} as const;

export function nextCheckCapMs(state: DomainState): number {
  return state === "parked" ? NEXT_CHECK_CAP_MS.parked : NEXT_CHECK_CAP_MS.default;
}

/** `attach_pending` backoff by consecutive failed attempts: 1, 2, 5, 15, 60 minutes. */
const ATTACH_BACKOFF_MS = [1, 2, 5, 15, 60].map((m) => m * MINUTE);
/** `release_pending` backoff: 5 minutes, 15 minutes, 1 hour, 6 hours. */
const RELEASE_BACKOFF_MS = [5 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR];

export interface CadenceInput {
  /** Milliseconds since the row entered its current state (for `attached`). */
  sinceStateChangedMs?: number;
  /** Consecutive failed attempts so far (for the backoff states). */
  attempt?: number;
}

/**
 * How long until the next scheduled check of a row in `state`:
 *   pending 5 min; attach_pending backoff 1/2/5/15/60 min; attached 5 min for
 *   its first 2 hours, then 30 min for 7 days, then 6 hours; live 2 hours;
 *   lapsed 6 hours; parked 24 hours; release_pending backoff 5 min/15 min/1 h/
 *   6 h; verified immediately-ish (5 min); terminal states are never checked
 *   (`null`).
 */
export function cadenceMs(state: DomainState, input: CadenceInput = {}): number | null {
  const attempt = Math.max(0, input.attempt ?? 0);
  switch (state) {
    case "pending":
    case "verified":
      return 5 * MINUTE;
    case "attach_pending":
      return ATTACH_BACKOFF_MS[Math.min(attempt, ATTACH_BACKOFF_MS.length - 1)];
    case "attached": {
      const since = input.sinceStateChangedMs ?? 0;
      if (since < 2 * HOUR) return 5 * MINUTE;
      if (since < 7 * DAY) return 30 * MINUTE;
      return 6 * HOUR;
    }
    case "live":
      return 2 * HOUR;
    case "lapsed":
      return 6 * HOUR;
    case "parked":
      return 24 * HOUR;
    case "release_pending":
      return RELEASE_BACKOFF_MS[Math.min(attempt, RELEASE_BACKOFF_MS.length - 1)];
    case "released":
    case "expired":
      return null;
  }
}

/** Every cadence the table can return, for the cap test. */
export const ALL_CADENCES_MS_BY_STATE: Readonly<Record<DomainState, readonly number[]>> = {
  pending: [5 * MINUTE],
  verified: [5 * MINUTE],
  attach_pending: ATTACH_BACKOFF_MS,
  attached: [5 * MINUTE, 30 * MINUTE, 6 * HOUR],
  live: [2 * HOUR],
  lapsed: [6 * HOUR],
  parked: [24 * HOUR],
  release_pending: RELEASE_BACKOFF_MS,
  released: [],
  expired: [],
};
