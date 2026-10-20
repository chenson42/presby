/**
 * policy.ts pinned to drizzle/0057 (A1, suggestion 2, R10; Batch 1a-ii gate).
 * The migration is the authority for the grace, the next_check_at caps, the
 * claim caps and the pending expiry; this file fails if policy.ts drifts from
 * any of them, and if any cadence exceeds the cap the trigger enforces for its
 * state (which would make the service's own scheduling write fail).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_CADENCES_MS_BY_STATE,
  DOMAIN_POLICY,
  NEXT_CHECK_CAP_MS,
  cadenceMs,
  nextCheckCapMs,
} from "./policy";
import { DOMAIN_STATES } from "./state";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0057_presby_org_domains.sql", import.meta.url)),
  "utf8",
);

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
};

function intervalMs(literal: RegExp): number {
  const m = MIGRATION.match(literal);
  if (!m) throw new Error(`migration has no ${literal}`);
  const [, n, unit] = m;
  return Number(n) * UNIT_MS[unit];
}

describe("policy.ts is pinned to the trigger's literals", () => {
  it("the 30-day grace: lapsed and parked both quote the trigger's c_grace_period", () => {
    const trigger = intervalMs(/c_grace_period constant interval := interval '(\d+) (\w+)';/);
    expect(DOMAIN_POLICY.lapsedGraceMs).toBe(trigger);
    expect(DOMAIN_POLICY.parkedGraceMs).toBe(trigger);
  });

  it("the next_check_at caps: 6 hours, and 24 hours while parked", () => {
    expect(NEXT_CHECK_CAP_MS.default).toBe(
      intervalMs(/c_next_check_cap\s+constant interval := interval '(\d+) (\w+)';/),
    );
    expect(NEXT_CHECK_CAP_MS.parked).toBe(
      intervalMs(/c_next_check_cap_parked constant interval := interval '(\d+) (\w+)';/),
    );
    expect(nextCheckCapMs("parked")).toBe(NEXT_CHECK_CAP_MS.parked);
    expect(nextCheckCapMs("live")).toBe(NEXT_CHECK_CAP_MS.default);
  });

  it("the claim caps: 3 web and 1 mail", () => {
    expect(DOMAIN_POLICY.webCap).toBe(Number(MIGRATION.match(/c_web_cap\s+constant integer := (\d+);/)![1]));
    expect(DOMAIN_POLICY.mailCap).toBe(Number(MIGRATION.match(/c_mail_cap constant integer := (\d+);/)![1]));
  });

  it("the 7-day pending expiry is the expires_at column default", () => {
    const m = MIGRATION.match(/expires_at\s+timestamptz not null default \(?now\(\) \+ interval '(\d+) (\w+)'\)?/);
    expect(m, "expires_at default not found in 0057").not.toBeNull();
    expect(DOMAIN_POLICY.pendingExpiryMs).toBe(Number(m![1]) * UNIT_MS[m![2]]);
  });
});

describe("no cadence exceeds the cap the trigger enforces for its state", () => {
  it.each(DOMAIN_STATES.map((s) => [s]))("%s", (state) => {
    const cap = nextCheckCapMs(state);
    for (const ms of ALL_CADENCES_MS_BY_STATE[state]) {
      expect(ms, `${state} cadence ${ms}ms`).toBeLessThanOrEqual(cap);
    }
  });

  it("the cadence table and cadenceMs() agree", () => {
    for (const state of DOMAIN_STATES) {
      const table = ALL_CADENCES_MS_BY_STATE[state];
      if (table.length === 0) {
        expect(cadenceMs(state)).toBeNull();
        continue;
      }
      for (const attempt of [0, 1, 2, 3, 4, 5, 50]) {
        for (const since of [0, 3 * 3_600_000, 8 * 86_400_000]) {
          const got = cadenceMs(state, { attempt, sinceStateChangedMs: since });
          expect(table, `${state} attempt=${attempt}`).toContain(got);
        }
      }
    }
  });
});

describe("cadence (Phase 3 policy.ts defaults)", () => {
  it("pending is 5 minutes; live 2 hours; lapsed 6 hours; parked 24 hours", () => {
    expect(cadenceMs("pending")).toBe(5 * 60_000);
    expect(cadenceMs("live")).toBe(2 * 3_600_000);
    expect(cadenceMs("lapsed")).toBe(6 * 3_600_000);
    expect(cadenceMs("parked")).toBe(24 * 3_600_000);
  });

  it("attach_pending backs off 1/2/5/15/60 minutes and holds at the last step", () => {
    expect([0, 1, 2, 3, 4, 9].map((a) => cadenceMs("attach_pending", { attempt: a }))).toEqual(
      [1, 2, 5, 15, 60, 60].map((m) => m * 60_000),
    );
  });

  it("attached is 5 min for 2 hours, then 30 min for 7 days, then 6 hours", () => {
    const at = (since: number) => cadenceMs("attached", { sinceStateChangedMs: since });
    expect(at(0)).toBe(5 * 60_000);
    expect(at(2 * 3_600_000 - 1)).toBe(5 * 60_000);
    expect(at(2 * 3_600_000)).toBe(30 * 60_000);
    expect(at(7 * 86_400_000 - 1)).toBe(30 * 60_000);
    expect(at(7 * 86_400_000)).toBe(6 * 3_600_000);
  });

  it("terminal states are never scheduled", () => {
    expect(cadenceMs("released")).toBeNull();
    expect(cadenceMs("expired")).toBeNull();
  });

  it("the limits are the design's", () => {
    expect(DOMAIN_POLICY.checkNowPerClaim).toEqual({ max: 6, windowSeconds: 600 });
    expect(DOMAIN_POLICY.checkNowPerOrg).toEqual({ max: 30, windowSeconds: 3600 });
    expect(DOMAIN_POLICY.claimsPerOrg).toEqual({ max: 5, windowSeconds: 86_400 });
    expect(DOMAIN_POLICY.proofLostMisses).toBe(6);
    expect(DOMAIN_POLICY.proofLostMinSpanMs).toBe(10 * 3_600_000);
  });
});
