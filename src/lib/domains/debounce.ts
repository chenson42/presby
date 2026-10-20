import { DOMAIN_POLICY } from "./policy";

/**
 * debounce.ts - the counter arithmetic behind "a single failed check does not
 * flip a live site" (Phase 1 G9; Phase 3 rulings table, G9). PURE, so the rules
 * that decide whether a church's site goes dark are unit-tested without a
 * database, a clock or a network.
 *
 * THE RULES.
 *   - `unknown` NEVER counts, in either direction. A resolver that timed out, a
 *     disagreement between the two resolvers, a probe that could not connect:
 *     none of it is evidence the church lost anything, so the streak neither
 *     advances nor resets. (A flapping resolver cannot demote a site by
 *     alternating "absent" with "unknown": the streak stays where it was, and a
 *     real "present" resets it.)
 *   - A POSITIVE observation resets the streak to zero.
 *   - A lapse (`proof_lost`) needs `proofLostMisses` CONSECUTIVE definitive
 *     misses AND the first of them at least `proofLostMinSpanMs` ago. The span
 *     is what makes the count meaningful: six misses in thirty minutes (a
 *     group-mate's fast cadence, a burst of forced checks) is not six
 *     independent days of evidence. The span is measured on the application
 *     clock, from the ISO timestamp of the first miss of the streak.
 *   - `live -> attached` needs `liveLostScheduledMisses` consecutive definitive
 *     negative probes, or `liveLostForcedMisses` when a person forced the check.
 */

export type ProofObservation = "present" | "absent" | "wrong_value" | "unknown";
export type ProbeObservation = "ack" | "negative" | "unknown";

export interface ProofStreak {
  count: number;
  /** ISO time of the first miss of the current streak; null when there is none. */
  since: string | null;
}

export interface ProofStep {
  next: ProofStreak;
  /** Enough evidence to conclude the proof is gone. */
  lost: boolean;
  /** This observation started a streak (count went 0 -> 1): the "first miss" notice. */
  firstMiss: boolean;
  /** A positive observation ended a streak that had begun. */
  recovered: boolean;
}

export function stepProofStreak(prev: ProofStreak, observed: ProofObservation, now: Date): ProofStep {
  if (observed === "present") {
    return { next: { count: 0, since: null }, lost: false, firstMiss: false, recovered: prev.count > 0 };
  }
  if (observed === "unknown") {
    return { next: prev, lost: false, firstMiss: false, recovered: false };
  }
  // absent | wrong_value: both resolvers answered and our token is not there.
  const count = prev.count + 1;
  const since = prev.since ?? now.toISOString();
  const spanMs = now.getTime() - new Date(since).getTime();
  return {
    next: { count, since },
    lost: count >= DOMAIN_POLICY.proofLostMisses && spanMs >= DOMAIN_POLICY.proofLostMinSpanMs,
    firstMiss: prev.count === 0,
    recovered: false,
  };
}

export interface ProbeStep {
  count: number;
  lost: boolean;
}

export function stepProbeStreak(prevCount: number, observed: ProbeObservation, forced: boolean): ProbeStep {
  if (observed === "ack") return { count: 0, lost: false };
  if (observed === "unknown") return { count: prevCount, lost: false };
  const count = prevCount + 1;
  const needed = forced ? DOMAIN_POLICY.liveLostForcedMisses : DOMAIN_POLICY.liveLostScheduledMisses;
  return { count, lost: count >= needed };
}
