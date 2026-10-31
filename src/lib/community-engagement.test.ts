/**
 * `community-engagement.ts` with the database mocked (Community Increment 3a,
 * Batch B; Phase 3 section 5, section 9, EC-8 to EC-10, EC-16, EC-26). What
 * this file pins is what the TypeScript decides: the order of the checks, what
 * it writes and audits, and what it will not do. The SQL it calls, the row lock
 * and the triggers that back every rule are proven against a real Postgres in
 * `community-engagement.db.test.ts`, where a rolled-back transaction is a fact
 * and not a mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  withOrgContext: vi.fn(),
  insertAuditRow: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/authz", () => ({
  withOrgContext: (...a: unknown[]) => h.withOrgContext(...a),
}));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return { ...actual, insertAuditRow: h.insertAuditRow };
});

const lib = await import("./community-engagement");

const ORG = "10000000-0000-4000-8000-000000000001";
const VIEWER = "20000000-0000-4000-8000-000000000002";
const PERSON = "40000000-0000-4000-8000-000000000004";
const MEMBERSHIP = "60000000-0000-4000-8000-000000000006";
const ACTOR = { userId: "30000000-0000-4000-8000-000000000003", email: "admin@example.invalid" };
const tx = { execute: h.execute };

interface Script {
  allowed: boolean;
  /** The row `lockMembership` returns; null is "no such person here". */
  row: Record<string, unknown> | null;
  /** Rows an UPDATE ... RETURNING answers. */
  updated: Record<string, unknown>[];
  /** archive: the pending/holds flags row. */
  blockers: Record<string, unknown>;
  /** restore: the probe row after zero updated rows. */
  probe: Record<string, unknown> | null;
  /** Throw this from the first UPDATE. */
  updateThrows: Error | null;
}
let script: Script;

const baseRow = (over: Record<string, unknown> = {}) => ({
  membership_id: MEMBERSHIP,
  engagement_status: "visitor",
  current_roll: null,
  ended_on: null,
  ended_reason: null,
  standing: "visitor",
  sign_in_connected: false,
  first_visit_date: null,
  how_heard: null,
  ...over,
});

const sqlOf = (q: unknown) => new PgDialect().sqlToQuery(q as never);
const textOf = (call: unknown[]) => sqlOf(call[0]).sql;
const callsMatching = (re: RegExp) => h.execute.mock.calls.filter((c) => re.test(textOf(c)));
const updates = () => callsMatching(/^\s*update memberships/i);

function install() {
  h.execute.mockImplementation(async (q: unknown) => {
    const text = sqlOf(q).sql;
    if (/presby_has_permission/.test(text)) return { rows: [{ allowed: script.allowed }] };
    if (/for update of m/.test(text)) return { rows: script.row ? [script.row] : [] };
    if (/pending_action/.test(text)) return { rows: [script.blockers] };
    if (/^\s*update memberships/i.test(text)) {
      if (script.updateThrows) throw script.updateThrows;
      return { rows: script.updated };
    }
    if (/from memberships m\s+join people p/.test(text)) return { rows: script.probe ? [script.probe] : [] };
    throw new Error(`unscripted query: ${text}`);
  });
}

function pgError(message: string, code = "23514"): Error {
  return Object.assign(new Error(message), { code });
}

beforeEach(() => {
  h.execute.mockReset();
  h.insertAuditRow.mockReset().mockResolvedValue(undefined);
  h.withOrgContext.mockReset().mockImplementation(async (_p: string, _o: string, fn: (t: unknown) => unknown) => fn(tx));
  script = {
    allowed: true,
    row: baseRow(),
    updated: [{ standing_to: "listed", engagement: "visitor", sign_in_connected: false }],
    blockers: { pending_action: false, holds_position: false },
    probe: null,
    updateThrows: null,
  };
  install();
});

const auditCall = () => h.insertAuditRow.mock.calls[0]![1] as {
  action: string;
  actor: unknown;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
};

describe("every write is scoped and gated the same way", () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["changeEngagement", () => lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)],
    ["archivePerson", () => lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)],
    ["restorePerson", () => lib.restorePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)],
    [
      "updateVisitDetails",
      () => lib.updateVisitDetails(VIEWER, ORG, { personId: PERSON, firstVisitDate: null, howHeard: "x" }, ACTOR),
    ],
  ];

  it.each(calls)("%s runs in the viewer's own org context and checks people.manage first", async (_name, call) => {
    await call();
    expect(h.withOrgContext).toHaveBeenCalledTimes(1);
    expect(h.withOrgContext.mock.calls[0]!.slice(0, 2)).toEqual([VIEWER, ORG]);
    const first = h.execute.mock.calls[0]!;
    expect(textOf(first)).toMatch(/presby_has_permission/);
    expect(sqlOf(first[0]).params).toEqual([VIEWER, ORG, "people.manage"]);
  });

  it.each(calls)("%s without people.manage is forbidden, reads nothing else and writes nothing", async (_name, call) => {
    script.allowed = false;
    expect(await call()).toEqual({ kind: "forbidden" });
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it.each(calls)("%s answers a non-UUID id as not_found before any lookup", async (name, _call) => {
    const fns: Record<string, (id: string) => Promise<unknown>> = {
      changeEngagement: (id) => lib.changeEngagement(VIEWER, ORG, { personId: id, to: "regular" }, ACTOR),
      archivePerson: (id) => lib.archivePerson(VIEWER, ORG, { personId: id }, ACTOR),
      restorePerson: (id) => lib.restorePerson(VIEWER, ORG, { personId: id }, ACTOR),
      updateVisitDetails: (id) =>
        lib.updateVisitDetails(VIEWER, ORG, { personId: id, firstVisitDate: null, howHeard: null }, ACTOR),
    };
    expect(await fns[name]!("not-a-uuid; drop table people")).toEqual({ kind: "not_found" });
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it.each(calls)("%s answers a person who is not here (another org, merged, deceased, missing) as not_found", async (name, _call) => {
    script.row = null;
    script.updated = [];
    script.probe = null;
    const result = (await calls.find(([n]) => n === name)![1]()) as { kind: string };
    expect(result).toEqual({ kind: "not_found" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("the membership lookup is org-scoped, excludes merged and deceased people, and locks the row", async () => {
    await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR);
    const lookup = callsMatching(/for update of m/)[0]!;
    const { sql: text, params } = sqlOf(lookup[0]);
    expect(params).toEqual([ORG, PERSON]);
    expect(text).toMatch(/m\.organization_id = \$1::uuid/);
    expect(text).toMatch(/p\.merged_into_id is null/);
    expect(text).toMatch(/p\.date_of_death is null/);
    expect(text).toMatch(/presby_membership_standing\(m\.current_roll, m\.engagement_status\)/);
  });
});

describe("changeEngagement", () => {
  it("writes the new value, audits the closed key list, and returns from, to and both standings", async () => {
    script.row = baseRow({ sign_in_connected: true });
    script.updated = [{ standing_to: "listed" }];
    const result = await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR);

    expect(result).toEqual({
      kind: "ok",
      from: "visitor",
      to: "regular",
      standingFrom: "visitor",
      standingTo: "listed",
      signInConnected: true,
    });
    expect(updates()).toHaveLength(1);
    const write = sqlOf(updates()[0]![0]);
    expect(write.sql).toMatch(/engagement_status = \$1/);
    expect(write.sql).toMatch(/and ended_on is null/);
    expect(write.sql).toMatch(/and engagement_status = \$4/);
    expect(write.params).toEqual(["regular", MEMBERSHIP, ORG, "visitor"]);

    const audit = auditCall();
    expect(audit.action).toBe("tenant.person.engagement_changed");
    expect(audit.actor).toEqual(ACTOR);
    expect(audit.resourceType).toBe("person");
    expect(audit.resourceId).toBe(PERSON);
    expect(Object.keys(audit.metadata).sort()).toEqual(
      ["from", "organizationId", "personId", "signInConnected", "standingFrom", "standingTo", "to"].sort(),
    );
    expect(audit.metadata).toEqual({
      organizationId: ORG,
      personId: PERSON,
      from: "visitor",
      to: "regular",
      standingFrom: "visitor",
      standingTo: "listed",
      signInConnected: true,
    });
  });

  it("the organization written is the one the context was opened for, never anything from the input", async () => {
    const forged = { personId: PERSON, to: "regular", organizationId: "99999999-0000-4000-8000-000000000009", from: "staff" };
    await lib.changeEngagement(VIEWER, ORG, forged as never, ACTOR);
    expect(sqlOf(updates()[0]![0]).params).toEqual(["regular", MEMBERSHIP, ORG, "visitor"]);
    expect(auditCall().metadata.organizationId).toBe(ORG);
    expect(auditCall().metadata.from).toBe("visitor");
  });

  it("an ended membership is `ended` (an archived person must be restored first)", async () => {
    script.row = baseRow({ ended_on: "2026-01-02", ended_reason: "community_archived" });
    expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)).toEqual({ kind: "ended" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("a staff record is `staff_record`, ahead of every other rule", async () => {
    script.row = baseRow({ engagement_status: "staff", standing: "staff_anchor" });
    for (const to of ["visitor", "regular", "inactive", "moved_away"] as const) {
      expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to }, ACTOR)).toEqual({ kind: "staff_record" });
    }
    expect(updates()).toHaveLength(0);
  });

  it("`ended` is reported ahead of `staff_record`", async () => {
    script.row = baseRow({ engagement_status: "staff", ended_on: "2026-01-02" });
    expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)).toEqual({ kind: "ended" });
  });

  it("the same value is `unchanged`: no write and no audit row", async () => {
    script.row = baseRow({ engagement_status: "inactive", standing: "inactive" });
    expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "inactive" }, ACTOR)).toEqual({ kind: "unchanged" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("Visitor for a person with any roll is `needs_no_roll`", async () => {
    for (const roll of ["active", "other_participant", "zzz"]) {
      script.row = baseRow({ engagement_status: "regular", current_roll: roll, standing: "listed" });
      expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "visitor" }, ACTOR)).toEqual({ kind: "needs_no_roll" });
    }
    expect(updates()).toHaveLength(0);
  });

  it("a rolled person may still be marked Inactive or Moved away (the roll keeps them listed)", async () => {
    script.row = baseRow({ engagement_status: "regular", current_roll: "active", standing: "listed" });
    script.updated = [{ standing_to: "listed" }];
    const result = await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "inactive" }, ACTOR);
    expect(result).toMatchObject({ kind: "ok", standingFrom: "listed", standingTo: "listed" });
  });

  it("a stale expectedFrom is `changed_meanwhile`; a matching one proceeds", async () => {
    expect(
      await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular", expectedFrom: "regular" }, ACTOR),
    ).toEqual({ kind: "changed_meanwhile" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();

    const ok = await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular", expectedFrom: "visitor" }, ACTOR);
    expect(ok.kind).toBe("ok");
  });

  it("zero rows from the conditional update is `changed_meanwhile` and writes no audit row", async () => {
    script.updated = [];
    expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)).toEqual({ kind: "changed_meanwhile" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("refuses a value it may not write by throwing (the action parses against the closed list first)", async () => {
    for (const to of ["staff", "unknown", "", undefined, 3]) {
      await expect(lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to } as never, ACTOR)).rejects.toThrow(/`to` must be/);
    }
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("self-targeting is allowed and audited", async () => {
    const result = await lib.changeEngagement(VIEWER, ORG, { personId: VIEWER, to: "regular" }, ACTOR);
    expect(result.kind).toBe("ok");
    expect(auditCall().resourceId).toBe(VIEWER);
  });

  it("a throw from the audit insert propagates: the transaction (and the change) is not committed (EC-16)", async () => {
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed"));
    await expect(
      lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR),
    ).rejects.toThrow("audit insert failed");
  });

  it.each([
    ["memberships: this membership has ended; its engagement can no longer change", "ended"],
    ["memberships: staff is set only when a staff record is created; engagement cannot change into or out of staff", "staff_record"],
    ["memberships: a person on the roll cannot be marked as a visitor", "needs_no_roll"],
  ])("maps the engagement guard's refusal %j to `%s` (the backstop answers like the pre-check)", async (message, kind) => {
    script.updateThrows = pgError(message);
    expect(await lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)).toEqual({ kind });
  });

  it("any other database error is rethrown for the caller to log and show as the one fixed string", async () => {
    script.updateThrows = pgError('new row for relation "memberships" violates check constraint "memberships_engagement_status_allowed"');
    await expect(lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)).rejects.toThrow(/violates check/);
    script.updateThrows = pgError("deadlock detected", "40P01");
    await expect(lib.changeEngagement(VIEWER, ORG, { personId: PERSON, to: "regular" }, ACTOR)).rejects.toThrow(/deadlock/);
  });
});

describe("archivePerson", () => {
  const archivable = () => {
    script.row = baseRow();
    script.updated = [{ engagement_status: "visitor" }];
  };

  it("ends the membership with the fixed archive marker, audits, and returns the kept engagement", async () => {
    archivable();
    script.row = baseRow({ sign_in_connected: true });
    const result = await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR);
    expect(result).toEqual({ kind: "ok", engagement: "visitor", signInConnected: true });

    const write = sqlOf(updates()[0]![0]);
    expect(write.sql).toMatch(/ended_on = current_date/);
    expect(write.sql).toMatch(/ended_reason = \$1/);
    expect(write.sql).toMatch(/and ended_on is null/);
    expect(write.sql).toMatch(/in \('visitor', 'inactive', 'unclassified'\)/);
    expect(write.params).toEqual(["community_archived", MEMBERSHIP, ORG]);

    const audit = auditCall();
    expect(audit.action).toBe("tenant.person.archived");
    expect(Object.keys(audit.metadata).sort()).toEqual(["engagement", "organizationId", "personId", "signInConnected"]);
    expect(audit.metadata).toEqual({ organizationId: ORG, personId: PERSON, engagement: "visitor", signInConnected: true });
  });

  it.each([
    ["visitor", "visitor"],
    ["inactive", "inactive"],
    ["unclassified", "visitor"],
  ])("a %s standing is eligible", async (standing, engagement) => {
    script.row = baseRow({ standing, engagement_status: engagement });
    script.updated = [{ engagement_status: engagement }];
    expect((await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).kind).toBe("ok");
  });

  it.each(["listed", "staff_anchor"])("a %s standing is `not_eligible` and nothing is written", async (standing) => {
    script.row = baseRow({ standing, engagement_status: "regular" });
    expect(await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "not_eligible" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("the viewer's own record is `self_target`, ahead of every state refusal", async () => {
    script.row = baseRow({ ended_on: "2026-01-02" });
    expect(await lib.archivePerson(VIEWER, ORG, { personId: VIEWER }, ACTOR)).toEqual({ kind: "self_target" });
    expect(updates()).toHaveLength(0);
  });

  it("an already-ended membership is `already_ended`", async () => {
    script.row = baseRow({ ended_on: "2026-01-02", ended_reason: "community_archived" });
    expect(await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "already_ended" });
  });

  it("a pending roll action is `pending_action`; it is reported ahead of holds_position", async () => {
    archivable();
    script.blockers = { pending_action: true, holds_position: true };
    expect(await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "pending_action" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("an open officer term, role grant or staff position is `holds_position`", async () => {
    archivable();
    script.blockers = { pending_action: false, holds_position: true };
    expect(await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "holds_position" });
    expect(updates()).toHaveLength(0);
  });

  it("the blocker query is scoped to this person at this organization and names all four conditions", async () => {
    archivable();
    await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR);
    const q = sqlOf(callsMatching(/pending_action/)[0]![0]);
    for (const table of ["roll_actions", "officer_terms", "role_grants", "staff_positions"]) {
      expect(q.sql).toContain(`from ${table}`);
    }
    expect(q.sql).toMatch(/approval_status = 'pending'/);
    expect(new Set(q.params)).toEqual(new Set([PERSON, ORG]));
  });

  it("memberships_guard_end's refusal is the backstop and maps to `holds_position`", async () => {
    archivable();
    script.updateThrows = pgError(
      "memberships: cannot end this relationship on 2026-10-31 - the ruling_elder term beginning 2024-01-01 is still open at this organization",
    );
    expect(await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "holds_position" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("an unrelated database error is rethrown", async () => {
    archivable();
    script.updateThrows = pgError("connection terminated", "57P01");
    await expect(lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).rejects.toThrow("connection terminated");
  });

  it("zero rows from the conditional update is `not_eligible`, with no audit row", async () => {
    archivable();
    script.updated = [];
    expect(await lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "not_eligible" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("a throw from the audit insert propagates (EC-16)", async () => {
    archivable();
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed"));
    await expect(lib.archivePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).rejects.toThrow("audit insert failed");
  });
});

describe("restorePerson", () => {
  it("reopens only the archive marker, audits, and returns the kept engagement and the connected flag", async () => {
    script.updated = [{ engagement: "inactive", sign_in_connected: true }];
    expect(await lib.restorePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({
      kind: "ok",
      engagement: "inactive",
      signInConnected: true,
    });
    const write = sqlOf(updates()[0]![0]);
    expect(write.sql).toMatch(/ended_on = null/);
    expect(write.sql).toMatch(/ended_reason = null/);
    expect(write.sql).toMatch(/m\.ended_reason = \$3/);
    expect(write.sql).toMatch(/p\.merged_into_id is null/);
    expect(write.sql).toMatch(/p\.date_of_death is null/);
    expect(write.params).toEqual([ORG, PERSON, "community_archived"]);

    const audit = auditCall();
    expect(audit.action).toBe("tenant.person.restored");
    expect(Object.keys(audit.metadata).sort()).toEqual(["engagement", "organizationId", "personId", "signInConnected"]);
    expect(audit.metadata).toEqual({ organizationId: ORG, personId: PERSON, engagement: "inactive", signInConnected: true });
  });

  it("zero rows: an archived person who is now merged or deceased is `person_unavailable`", async () => {
    script.updated = [];
    script.probe = { ended_on: "2026-02-03", ended_reason: "community_archived", unavailable: true };
    expect(await lib.restorePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "person_unavailable" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it.each([
    ["a live membership", { ended_on: null, ended_reason: null, unavailable: false }],
    ["a participant removal", { ended_on: "2026-02-03", ended_reason: "other_participant_removed", unavailable: false }],
    ["any other end reason", { ended_on: "2026-02-03", ended_reason: "moved to another church", unavailable: false }],
    ["a lookalike marker", { ended_on: "2026-02-03", ended_reason: "community_archived_x", unavailable: false }],
  ])("zero rows: %s is `not_archived`", async (_label, probe) => {
    script.updated = [];
    script.probe = probe;
    expect(await lib.restorePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "not_archived" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("zero rows for a merged or deceased person who was never archived is not told apart from a missing one", async () => {
    script.updated = [];
    script.probe = { ended_on: null, ended_reason: null, unavailable: true };
    expect(await lib.restorePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).toEqual({ kind: "not_found" });
  });

  it("a throw from the audit insert propagates (EC-16)", async () => {
    script.updated = [{ engagement: "visitor", sign_in_connected: false }];
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed"));
    await expect(lib.restorePerson(VIEWER, ORG, { personId: PERSON }, ACTOR)).rejects.toThrow("audit insert failed");
  });
});

describe("updateVisitDetails", () => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const run = (firstVisitDate: string | null, howHeard: string | null, personId = PERSON) =>
    lib.updateVisitDetails(VIEWER, ORG, { personId, firstVisitDate, howHeard }, ACTOR);

  it("writes only the two columns and audits booleans, never the values", async () => {
    const heard = "a neighbour mentioned the choir";
    expect(await run("2026-03-01", heard)).toEqual({ kind: "ok" });
    const write = sqlOf(updates()[0]![0]);
    expect(write.sql).toMatch(/set first_visit_date = \$1::date,\s+how_heard = \$2::text,\s+updated_at = now\(\)/);
    expect(write.sql).not.toMatch(/engagement_status|ended_on =|ended_reason/);
    expect(write.params).toEqual(["2026-03-01", heard, MEMBERSHIP, ORG]);

    const audit = auditCall();
    expect(audit.action).toBe("tenant.person.visit_details_updated");
    expect(Object.keys(audit.metadata).sort()).toEqual(["firstVisitDateChanged", "howHeardChanged", "organizationId", "personId"]);
    expect(audit.metadata).toEqual({ organizationId: ORG, personId: PERSON, firstVisitDateChanged: true, howHeardChanged: true });
    expect(JSON.stringify(h.insertAuditRow.mock.calls)).not.toContain(heard);
  });

  it("reports which field changed", async () => {
    script.row = baseRow({ first_visit_date: "2026-03-01", how_heard: "a neighbour" });
    await run("2026-03-01", "a friend");
    expect(auditCall().metadata).toMatchObject({ firstVisitDateChanged: false, howHeardChanged: true });
    h.insertAuditRow.mockClear();
    await run("2026-03-02", "a neighbour");
    expect(auditCall().metadata).toMatchObject({ firstVisitDateChanged: true, howHeardChanged: false });
  });

  it("trims, and a blank or null clears the field", async () => {
    script.row = baseRow({ first_visit_date: "2026-03-01", how_heard: "a neighbour" });
    expect(await run("   ", "   ")).toEqual({ kind: "ok" });
    expect(sqlOf(updates()[0]![0]).params.slice(0, 2)).toEqual([null, null]);
    expect(auditCall().metadata).toMatchObject({ firstVisitDateChanged: true, howHeardChanged: true });
    expect(await run(null, null)).toEqual({ kind: "ok" });
    expect(sqlOf(updates()[1]![0]).params.slice(0, 2)).toEqual([null, null]);
  });

  it("trims the text it stores", async () => {
    await run(null, "  a neighbour  ");
    expect(sqlOf(updates()[0]![0]).params[1]).toBe("a neighbour");
  });

  it("the same values are `unchanged`: no write and no audit row", async () => {
    script.row = baseRow({ first_visit_date: "2026-03-01", how_heard: "a neighbour" });
    expect(await run("2026-03-01", " a neighbour ")).toEqual({ kind: "unchanged" });
    script.row = baseRow();
    expect(await run(null, "")).toEqual({ kind: "unchanged" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-date", "yesterday"],
    ["an impossible date", "2026-02-30"],
    ["a month 13", "2026-13-01"],
    ["a US-style date", "03/01/2026"],
    ["a date before the 1900 floor", "1899-12-31"],
    ["a date after today", tomorrow],
    ["a far-future date", "2999-01-01"],
  ])("%s is `bad_date`", async (_label, value) => {
    expect(await run(value, null)).toEqual({ kind: "bad_date" });
    expect(updates()).toHaveLength(0);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("accepts the floor (1900-01-01) and today (UTC) exactly", async () => {
    expect(await run("1900-01-01", null)).toEqual({ kind: "ok" });
    expect(await run(today, null)).toEqual({ kind: "ok" });
  });

  it("200 characters pass and 201 are `bad_text` (counted after trimming)", async () => {
    expect(await run(null, "h".repeat(200))).toEqual({ kind: "ok" });
    expect(await run(null, `  ${"h".repeat(200)}  `)).toEqual({ kind: "ok" });
    expect(await run(null, "h".repeat(201))).toEqual({ kind: "bad_text" });
  });

  it("an ended membership is `ended`", async () => {
    script.row = baseRow({ ended_on: "2026-01-02", ended_reason: "community_archived" });
    expect(await run("2026-03-01", "x")).toEqual({ kind: "ended" });
    expect(updates()).toHaveLength(0);
  });

  it("a throw from the audit insert propagates (EC-16)", async () => {
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed"));
    await expect(run("2026-03-01", "x")).rejects.toThrow("audit insert failed");
  });
});
