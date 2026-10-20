import { describe, expect, it } from "vitest";
import { stepProbeStreak, stepProofStreak, type ProofObservation, type ProofStreak } from "./debounce";
import { DOMAIN_POLICY } from "./policy";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
const none: ProofStreak = { count: 0, since: null };

/** Feeds a sequence of observations, `everyHours` apart, returning the state after each. */
function run(observations: ProofObservation[], everyHours: number, start: ProofStreak = none) {
  let streak = start;
  const out: Array<{ streak: ProofStreak; lost: boolean; firstMiss: boolean; recovered: boolean }> = [];
  observations.forEach((o, i) => {
    const step = stepProofStreak(streak, o, at(i * everyHours));
    streak = step.next;
    out.push({ streak, lost: step.lost, firstMiss: step.firstMiss, recovered: step.recovered });
  });
  return out;
}

describe("the policy this arithmetic is built on", () => {
  it("is 6 consecutive misses spanning at least 10 hours; 2 scheduled or 1 forced probe miss", () => {
    expect(DOMAIN_POLICY.proofLostMisses).toBe(6);
    expect(DOMAIN_POLICY.proofLostMinSpanMs).toBe(10 * 3_600_000);
    expect(DOMAIN_POLICY.liveLostScheduledMisses).toBe(2);
    expect(DOMAIN_POLICY.liveLostForcedMisses).toBe(1);
  });
});

describe("stepProofStreak (G9: a single failed check does not flip a live site)", () => {
  it("a single definitive miss never concludes a loss, and is flagged as the first miss", () => {
    const [only] = run(["absent"], 2);
    expect(only!.lost).toBe(false);
    expect(only!.firstMiss).toBe(true);
    expect(only!.streak.count).toBe(1);
    expect(only!.streak.since).toBe(T0.toISOString());
  });

  it("five misses never conclude a loss however long they span (6 are required)", () => {
    const steps = run(["absent", "absent", "absent", "absent", "absent"], 100);
    expect(steps.every((s) => !s.lost)).toBe(true);
    expect(steps[4]!.streak.count).toBe(5);
  });

  it("six misses at the live cadence (2 h apart) span exactly 10 h: the sixth concludes the loss", () => {
    const steps = run(Array(6).fill("absent"), 2);
    expect(steps.map((s) => s.lost)).toEqual([false, false, false, false, false, true]);
  });

  it("six misses inside the minimum span do NOT conclude a loss (a burst of checks is not independent evidence)", () => {
    const steps = run(Array(6).fill("absent"), 0.1); // 6 misses over 30 minutes
    expect(steps.every((s) => !s.lost)).toBe(true);
    // ...and the loss lands on the first miss after the span has elapsed.
    const later = stepProofStreak(steps[5]!.streak, "absent", at(10));
    expect(later.lost).toBe(true);
    const justShort = stepProofStreak(steps[5]!.streak, "absent", new Date(T0.getTime() + 10 * 3_600_000 - 1));
    expect(justShort.lost).toBe(false);
  });

  it("wrong_value counts exactly as absent (both resolvers answered and our token is not there)", () => {
    const steps = run(Array(6).fill("wrong_value"), 2);
    expect(steps[5]!.lost).toBe(true);
  });

  it("UNKNOWN never counts: it neither advances nor resets the streak", () => {
    const steps = run(["absent", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown"], 2);
    for (const s of steps) expect(s.lost).toBe(false);
    expect(steps[7]!.streak).toEqual(steps[0]!.streak); // still exactly one miss, same start
    expect(steps.slice(1).every((s) => !s.firstMiss)).toBe(true);
  });

  it("an unknown from nothing is still nothing (no streak is started by a resolver error)", () => {
    const [step] = run(["unknown"], 2);
    expect(step!.streak).toEqual(none);
    expect(step!.firstMiss).toBe(false);
    expect(step!.lost).toBe(false);
  });

  it("a flapping resolver (absent / present / absent / present ...) never concludes a loss", () => {
    const flapping: ProofObservation[] = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "absent" : "present"));
    const steps = run(flapping, 2);
    expect(steps.some((s) => s.lost)).toBe(false);
    expect(Math.max(...steps.map((s) => s.streak.count))).toBe(1);
  });

  it("absent / unknown alternating still cannot lose, but also cannot be reset: only a real 'present' resets", () => {
    const seq: ProofObservation[] = [];
    for (let i = 0; i < 6; i += 1) seq.push("absent", "unknown");
    const steps = run(seq, 1);
    // 6 absents, spanning 10 h of wall clock: the unknowns did not reset the streak, so the 6th absent concludes.
    const lostAt = steps.findIndex((s) => s.lost);
    expect(lostAt).toBe(10); // the sixth 'absent' is observation index 10, at hour 10
  });

  it("a positive observation resets the streak and the span, and reports the recovery", () => {
    const miss = run(["absent", "absent", "absent"], 2);
    const back = stepProofStreak(miss[2]!.streak, "present", at(7));
    expect(back.next).toEqual(none);
    expect(back.recovered).toBe(true);
    expect(back.lost).toBe(false);
    // The span restarts: another long gap of misses must again build 6 over 10 h.
    const after = run(["absent", "absent", "absent", "absent", "absent", "absent"], 1, back.next);
    expect(after[5]!.lost).toBe(false);
  });

  it("'present' with nothing to reset reports no recovery", () => {
    expect(stepProofStreak(none, "present", T0)).toMatchObject({ recovered: false, lost: false, firstMiss: false });
  });

  it("the first miss is flagged exactly once per streak", () => {
    const steps = run(["absent", "absent", "absent"], 1);
    expect(steps.map((s) => s.firstMiss)).toEqual([true, false, false]);
    const reset = stepProofStreak(steps[2]!.streak, "present", at(3));
    const again = stepProofStreak(reset.next, "absent", at(4));
    expect(again.firstMiss).toBe(true);
  });

  it("the span is measured from the first miss of the streak, not from the last positive", () => {
    // Present at hour 0 (long ago), first miss at hour 100: six misses need 10 h from hour 100.
    const start = stepProofStreak(none, "absent", at(100));
    expect(start.next.since).toBe(at(100).toISOString());
    const sixthTooSoon = stepProofStreak({ count: 5, since: at(100).toISOString() }, "absent", at(105));
    expect(sixthTooSoon.lost).toBe(false);
    const sixthInTime = stepProofStreak({ count: 5, since: at(100).toISOString() }, "absent", at(110));
    expect(sixthInTime.lost).toBe(true);
  });
});

describe("stepProbeStreak (live -> attached)", () => {
  it("one scheduled negative does not demote; two consecutive scheduled negatives do", () => {
    const first = stepProbeStreak(0, "negative", false);
    expect(first).toEqual({ count: 1, lost: false });
    expect(stepProbeStreak(first.count, "negative", false)).toEqual({ count: 2, lost: true });
  });

  it("a FORCED check demotes on one negative", () => {
    expect(stepProbeStreak(0, "negative", true)).toEqual({ count: 1, lost: true });
  });

  it("an ack resets the streak", () => {
    expect(stepProbeStreak(1, "ack", false)).toEqual({ count: 0, lost: false });
  });

  it("unknown (a timeout, a TLS failure, no secret) neither counts nor resets", () => {
    expect(stepProbeStreak(1, "unknown", false)).toEqual({ count: 1, lost: false });
    expect(stepProbeStreak(0, "unknown", true)).toEqual({ count: 0, lost: false });
  });

  it("negative / unknown / negative still demotes (unknown does not reset), negative / ack / negative never does", () => {
    let c = stepProbeStreak(0, "negative", false);
    c = stepProbeStreak(c.count, "unknown", false);
    expect(stepProbeStreak(c.count, "negative", false).lost).toBe(true);

    let d = stepProbeStreak(0, "negative", false);
    d = stepProbeStreak(d.count, "ack", false);
    expect(stepProbeStreak(d.count, "negative", false).lost).toBe(false);
  });
});
