import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateOutcomes, finishCode, planAudits, type PartResult } from "./outcome";

describe("aggregateOutcomes - many parts, one verdict", () => {
  it.each<[string[], { outcome: string; code: string | null }]>([
    [["applied"], { outcome: "applied", code: null }],
    [["applied:autolinked"], { outcome: "applied", code: null }],
    [["noop"], { outcome: "applied", code: null }],
    [["noop", "applied"], { outcome: "applied", code: null }],
    [["ignored:no_intent"], { outcome: "ignored", code: "no_intent" }],
    [["ignored:no_intent", "ignored:not_usd"], { outcome: "ignored", code: "no_intent" }],
    [["ignored:no_intent", "applied"], { outcome: "applied", code: null }],
    [["parked:no_gift"], { outcome: "parked", code: "no_gift" }],
    [["failed:stripe_rate_limited"], { outcome: "failed", code: "stripe_rate_limited" }],
    [["dead:over_reversal"], { outcome: "dead", code: "over_reversal" }],
  ])("%j", (parts, expected) => {
    expect(aggregateOutcomes(parts)).toEqual(expected);
  });

  it("dead beats parked beats failed beats applied (the Phase 3 precedence)", () => {
    expect(aggregateOutcomes(["applied", "failed:x", "parked:no_gift", "dead:bad_amount"])).toEqual({ outcome: "dead", code: "bad_amount" });
    expect(aggregateOutcomes(["applied", "failed:x", "parked:no_gift"])).toEqual({ outcome: "parked", code: "no_gift" });
    expect(aggregateOutcomes(["applied", "failed:exception"])).toEqual({ outcome: "failed", code: "exception" });
  });

  it("an empty set is applied (the processor handles 'no events' as ignored before it gets here)", () => {
    expect(aggregateOutcomes([])).toEqual({ outcome: "applied", code: null });
  });
});

describe("finishCode - a code finish_event will accept", () => {
  it("passes a clean code through", () => {
    expect(finishCode("no_gift")).toBe("no_gift");
    expect(finishCode("normalize_api_version")).toBe("normalize_api_version");
    expect(finishCode("a:b_c9")).toBe("a:b_c9");
  });

  it("cleans anything else to [a-z0-9_:], bounded to 60", () => {
    expect(finishCode("Over Reversal!")).toBe("over_reversal_");
    expect(finishCode("x".repeat(200))).toHaveLength(60);
    expect(finishCode("<script>")).toMatch(/^[a-z0-9_:]+$/);
  });

  it("null / empty / nothing usable is null", () => {
    expect(finishCode(null)).toBeNull();
    expect(finishCode(undefined)).toBeNull();
    expect(finishCode("")).toBeNull();
  });
});

describe("planAudits - what an outcome earns, after finish_event", () => {
  const part = (kind: PartResult["kind"], outcome: string, extra: Partial<PartResult> = {}): PartResult => ({ kind, outcome, ...extra });

  it("an applied reversal earns GIVING_REVERSAL_RECORDED with its kind and amount only", () => {
    expect(planAudits([part("reversal", "applied", { reversalKind: "refund", amountCents: 5000 })], "applied", null)).toEqual([
      { key: "GIVING_REVERSAL_RECORDED", metadata: { reversalKind: "refund", amountCents: 5000 } },
    ]);
  });

  it("a replayed reversal (noop) earns nothing: a duplicate delivery is audit-silent", () => {
    expect(planAudits([part("reversal", "noop", { reversalKind: "refund", amountCents: 5000 })], "applied", null)).toEqual([]);
  });

  it("a parked reversal earns nothing yet", () => {
    expect(planAudits([part("reversal", "parked:no_gift")], "parked", "no_gift")).toEqual([]);
  });

  it("a status change and a deauthorization earn their own rows; a no-change refresh earns none", () => {
    expect(planAudits([part("connection_status", "applied:status_changed")], "applied", null).map((a) => a.key)).toEqual([
      "GIVING_CONNECTION_STATUS_CHANGED",
    ]);
    expect(planAudits([part("connection_status", "applied:disconnected")], "applied", null)).toEqual([
      { key: "GIVING_CONNECTION_DISCONNECTED", metadata: { reason: "deauthorized" } },
    ]);
    expect(planAudits([part("connection_status", "applied")], "applied", null)).toEqual([]);
    expect(planAudits([part("connection_status", "noop")], "applied", null)).toEqual([]);
  });

  it("auto-link and link conflict come only from a gift or subscription outcome suffix", () => {
    expect(planAudits([part("gift", "applied:autolinked")], "applied", null).map((a) => a.key)).toEqual(["GIVING_DONOR_AUTOLINKED"]);
    expect(planAudits([part("subscription", "applied:link_conflict")], "applied", null).map((a) => a.key)).toEqual(["GIVING_DONOR_LINK_CONFLICT"]);
    expect(planAudits([part("gift", "applied")], "applied", null)).toEqual([]);
    expect(planAudits([part("reversal", "applied:autolinked")], "applied", null).map((a) => a.key)).not.toContain("GIVING_DONOR_AUTOLINKED");
  });

  it("a dead-lettered event earns GIVING_EVENT_DEAD_LETTERED with the last error code, however it got there", () => {
    expect(planAudits([part("reversal", "dead:over_reversal")], "dead_letter", "over_reversal")).toEqual([
      { key: "GIVING_EVENT_DEAD_LETTERED", metadata: { lastError: "over_reversal" } },
    ]);
    expect(planAudits([part("gift", "failed:exception")], "dead_letter", "exception").map((a) => a.key)).toEqual([
      "GIVING_EVENT_DEAD_LETTERED",
    ]);
    expect(planAudits([], "dead_letter", "normalize_api_version").map((a) => a.key)).toEqual(["GIVING_EVENT_DEAD_LETTERED"]);
  });

  it("a parked, applied or ignored final status earns no dead-letter row", () => {
    for (const status of ["parked", "applied", "ignored"]) {
      expect(planAudits([], status, null)).toEqual([]);
    }
  });

  it("metadata is ids, kinds and counts only: no name, email, address or body can be planned", () => {
    const all = planAudits(
      [
        part("reversal", "applied", { reversalKind: "dispute", amountCents: 100 }),
        part("gift", "applied:autolinked"),
        part("connection_status", "applied:status_changed"),
      ],
      "dead_letter",
      "x",
    );
    expect(JSON.stringify(all)).not.toMatch(/@|name|address|email|body/i);
  });
});

describe("planAudits only emits keys that exist in AUDIT_ACTIONS", () => {
  it("every PlannedAudit key is declared in src/lib/audit.ts (no key is added by this batch)", () => {
    const audit = readFileSync(path.join(process.cwd(), "src/lib/audit.ts"), "utf8");
    const outcome = readFileSync(path.join(__dirname, "outcome.ts"), "utf8");
    const keys = [...outcome.matchAll(/key: "(GIVING_[A-Z_]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of new Set(keys)) {
      expect(audit, `AUDIT_ACTIONS.${key}`).toMatch(new RegExp(`\\b${key}:\\s*"tenant\\.giving_`));
    }
  });
});
