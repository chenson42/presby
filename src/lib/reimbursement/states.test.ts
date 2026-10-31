import { describe, expect, it } from "vitest";
import { MIGRATION_0073, functionBody } from "./migration-text";
import {
  EVENT_KINDS,
  OPEN_STATUSES,
  REQUEST_STATUSES,
  TRANSITIONS,
  canTransition,
  historyLabel,
  isTerminal,
  statusLabel,
  type RequestStatus,
} from "./states";

/** The trigger's own permitted-transition expression, parsed from the migration text. */
function parseTriggerTransitions(): Record<string, string[]> {
  const body = functionBody(MIGRATION_0073, "presby_reimbursement_request_update_guard");
  const start = body.indexOf("if not ((old.status = ");
  expect(start, "the transition expression is in the update guard").toBeGreaterThan(0);
  const expression = body.slice(start, body.indexOf("then", start));
  const out: Record<string, string[]> = {};
  for (const clause of expression.matchAll(/old\.status = '([a-z_]+)' and new\.status (?:in \(([^)]*)\)|= '([a-z_]+)')/g)) {
    const to = clause[2] ? [...clause[2].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!) : [clause[3]!];
    out[clause[1]!] = to;
  }
  return out;
}

describe("states.ts mirrors drizzle/0073 (EC6)", () => {
  it("has exactly the eight statuses the CHECK allows", () => {
    const check = /status text not null default 'draft'[\s\S]{0,400}?check \(status in \(([^)]*)\)\)/.exec(MIGRATION_0073)
      ?? /check \(status in \(([^)]*'draft'[^)]*)\)\)/.exec(MIGRATION_0073);
    expect(check, "status CHECK found").not.toBeNull();
    const sqlStatuses = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(sqlStatuses).toEqual([...REQUEST_STATUSES].sort());
  });

  it("TRANSITIONS equals the permitted-transition expression in the update-guard trigger, in both directions", () => {
    const parsed = parseTriggerTransitions();
    // every status that has an outgoing move in the SQL has the same moves here...
    for (const [from, to] of Object.entries(parsed)) {
      expect([...TRANSITIONS[from as RequestStatus]].sort(), from).toEqual([...to].sort());
    }
    // ...and every status absent from the SQL expression is terminal here
    for (const status of REQUEST_STATUSES) {
      if (!(status in parsed)) expect(TRANSITIONS[status], status).toEqual([]);
    }
  });

  it("agrees with the comment block's arrows the migration says a test parses", () => {
    const block = /-- 4c\. THE TRANSITION TABLE[\s\S]*?-- src\/lib\/reimbursement\/states\.ts/.exec(MIGRATION_0073)![0];
    const arrows: Record<string, string[]> = {};
    for (const line of block.split("\n")) {
      const m = /^--\s+([a-z_]+)\s+->\s+([a-z_ |]+?)(?:\s{2,}\(|$)/.exec(line);
      if (m) arrows[m[1]!] = m[2]!.split("|").map((s) => s.trim());
    }
    expect(Object.keys(arrows).sort()).toEqual(["approved", "draft", "not_approved", "paid", "returned", "submitted"]);
    for (const [from, to] of Object.entries(arrows)) {
      expect([...TRANSITIONS[from as RequestStatus]].sort(), from).toEqual([...to].sort());
    }
  });

  it("every event kind is one the history table's CHECK allows", () => {
    const check = /kind text not null\s*check \(kind in \(([^)]*'created'[^)]*)\)\)/.exec(MIGRATION_0073)
      ?? /check \(kind in \(([^)]*'imported'[^)]*)\)\)/.exec(MIGRATION_0073);
    expect(check, "event kind CHECK found").not.toBeNull();
    const sqlKinds = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(sqlKinds).toEqual([...EVENT_KINDS].sort());
  });
});

describe("transition helpers", () => {
  it("canTransition and isTerminal follow the table", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("paid", "approved")).toBe(true);
    expect(canTransition("paid", "withdrawn")).toBe(false); // the only way back from paid is a reversal
    expect(canTransition("not_approved", "withdrawn")).toBe(true);
    expect(isTerminal("withdrawn")).toBe(true);
    expect(isTerminal("voided")).toBe(true);
    expect(isTerminal("paid")).toBe(false);
  });

  it("no status moves to itself", () => {
    for (const status of REQUEST_STATUSES) expect(canTransition(status, status), status).toBe(false);
  });

  it("OPEN_STATUSES is what presby_reimbursement_open_count counts (drafts excluded)", () => {
    const body = MIGRATION_0073.slice(MIGRATION_0073.indexOf("create or replace function presby_reimbursement_open_count"));
    const counted = [...body.slice(0, body.indexOf("$$;", body.indexOf("$$;") + 3)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...OPEN_STATUSES].sort()).toEqual([...new Set(counted)].sort());
  });
});

describe("labels (Copy C2, C5)", () => {
  it("labels every status for both audiences; staff drop 'to you'", () => {
    for (const status of REQUEST_STATUSES) {
      expect(statusLabel(status, "requester").length, status).toBeGreaterThan(0);
      expect(statusLabel(status, "staff").length, status).toBeGreaterThan(0);
    }
    expect(statusLabel("returned", "requester")).toBe("Sent back to you");
    expect(statusLabel("returned", "staff")).toBe("Sent back");
    expect(statusLabel("voided", "requester")).toBe("Closed");
    expect(statusLabel("approved", "staff")).toBe("Approved, waiting for payment");
  });

  it("labels every history event kind", () => {
    for (const kind of EVENT_KINDS) expect(historyLabel(kind).length, kind).toBeGreaterThan(0);
    expect(historyLabel("override_approved")).toBe("Approved by the treasurer");
    expect(historyLabel("payment_reversed")).toBe("Payment corrected");
  });
});
