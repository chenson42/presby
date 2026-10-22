/**
 * src/lib/onboarding/designation-holders.ts on a REAL Postgres connection
 * (docs/work-log/2026-10-22-designation-revoke.md, Phase 3 Test Plan, Batch B;
 * DECISION-194/195/196, F169). Batch A's designation-revoke.db.test.ts proves
 * the SQL functions themselves; this proves the library on top of them:
 *
 *   - THE LIST: a person row (designation provenance, companion role, the grant
 *     ids the dialog expects), a person who also holds through a managed group
 *     (`alsoThroughGroupNames`, `leavesNoHolders: false`), a managed group row
 *     with a people count, a derived group row (`revocable: false`); the
 *     treasurer slot; and NO name or email of a group member anywhere in what is
 *     returned.
 *   - RULE 7, AUDIT IN THE SAME TRANSACTION: `revoked` writes exactly one row of
 *     the right key per slot, ids/counts/dates/reason only (no name, no email);
 *     a FAILED audit insert rolls the `ends_on` back; a double submit writes one
 *     row; every refusal and idempotent outcome writes none.
 *   - `selfRevoke` is true exactly when the actor is the revoked person.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/designation-holders.db.test.ts
 *
 * Names are synthetic and every address is example.invalid (No Real Data).
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const GOOD_REASON = "Fixture grant left over from the first test setup.";

describe.skipIf(!hasDb)("src/lib/onboarding/designation-holders.ts (Postgres-backed)", { timeout: 60_000 }, () => {
  let fx: InvitationFixture;
  let lib: typeof import("./designation-holders");
  let platformDb: ReturnType<typeof import("@/lib/db").getPlatformDb>;
  let FAKE_BCRYPT: string;
  let operator: string;
  let rosterTypeId: string;
  let today: string;
  const orgIds: string[] = [];
  let roleCounter = 0;

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  async function org(type: "congregation" | "presbytery" = "congregation"): Promise<string> {
    const id = await fx.makeOrg("dh", { organizationType: type });
    orgIds.push(id);
    return id;
  }

  async function role(orgId: string, keys: readonly string[]): Promise<string> {
    roleCounter += 1;
    return fx.makeRole(orgId, `dh_role_${roleCounter}`, keys);
  }

  async function member(orgId: string, first: string, last: string): Promise<string> {
    const p = await fx.makePerson(first, last);
    await fx.addMember(orgId, p);
    return p;
  }

  async function grant(
    orgId: string,
    roleId: string,
    subject: { personId?: string; groupId?: string },
    reason: string | null = null,
  ): Promise<string> {
    const [g] = await q(sql`
      insert into role_grants (organization_id, role_id, person_id, group_id, starts_on, granted_by, grant_reason)
      values (${orgId}, ${roleId}, ${subject.personId ?? null}, ${subject.groupId ?? null},
              '2020-01-01'::date, ${operator}, ${reason})
      returning id`);
    return String(g!.id);
  }

  async function makeGroup(orgId: string, name: string, derivedFrom?: "session"): Promise<string> {
    const [g] = await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${orgId}, ${rosterTypeId}, ${name}, ${derivedFrom ? "derived" : "managed"}, ${derivedFrom ?? null}, ${Boolean(derivedFrom)})
      returning id`);
    return String(g!.id);
  }

  async function addToGroup(orgId: string, groupId: string, personId: string, source: "managed" | "derived" = "managed") {
    await q(sql`
      insert into group_memberships (organization_id, group_id, person_id, source, starts_on)
      values (${orgId}, ${groupId}, ${personId}, ${source}, current_date)`);
  }

  /** A real founding-administrator designation through presby_accept_invitation (bundle + companion). */
  async function designate(orgId: string) {
    const address = fx.email("fa");
    const inv = await fx.insertInvitation({
      organizationId: orgId, purpose: "founding_administrator", email: address,
      createdByUserId: operator, firstName: "Perpetua", lastName: "Ashgrove",
    });
    const r = await fx.accept(inv.token, { passwordHash: FAKE_BCRYPT, firstName: "Perpetua", lastName: "Ashgrove" });
    expect(r.outcome).toBe("accepted");
    return { person: String(r.person_id), user: String(r.user_id), address };
  }

  async function auditRows(action: string, orgId: string): Promise<Row[]> {
    return q(sql`select * from audit_events where action = ${action} and metadata->>'organizationId' = ${orgId} order by created_at`);
  }

  async function endsOn(grantId: string): Promise<string | null> {
    const [r] = await q(sql`select ends_on::text as e from role_grants where id = ${grantId}`);
    return (r!.e as string | null) ?? null;
  }

  const actor = () => ({ userId: operator, email: "operator@example.invalid" as string | null });

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    FAKE_BCRYPT = mod.FAKE_BCRYPT;
    fx = await mod.createInvitationFixture("dh-db");
    operator = fx.actingUserId;
    lib = await import("./designation-holders");
    platformDb = (await import("@/lib/db")).getPlatformDb();
    const [t] = await q(sql`select id from group_types where key = 'roster'`);
    rosterTypeId = String(t!.id);
    const [d] = await q(sql`select current_date::text as d`);
    today = String(d!.d);
  });

  afterEach(() => {
    auditControl.fail = false;
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      for (const id of orgIds) {
        await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
      }
    } finally {
      await fx.cleanup();
    }
  });

  // =========================================================================
  // THE LIST
  // =========================================================================
  describe("listDesignationHolders", () => {
    it("an empty org is zero people and no rows", async () => {
      const id = await org();
      expect(await lib.listDesignationHolders(platformDb, id, "founding_administrator")).toEqual({ holderPeopleCount: 0, rows: [] });
      expect(await lib.listDesignationHolders(platformDb, id, "treasurer")).toEqual({ holderPeopleCount: 0, rows: [] });
    });

    it("a real designation is ONE person row: name, provenance, the companion role, the dialog's expected ids and what the roles carry", async () => {
      const id = await org();
      const d = await designate(id);
      const { holderPeopleCount, rows } = await lib.listDesignationHolders(platformDb, id, "founding_administrator");
      expect(holderPeopleCount).toBe(1);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({
        key: `person:${d.person}`,
        subjectKind: "person",
        subjectId: d.person,
        displayName: "Perpetua Ashgrove",
        holderPeopleCount: 1,
        provenance: "designation",
        companionRoleNames: ["Stated Clerk"],
        alsoThroughGroupNames: [],
        leavesNoHolders: true,
        revocable: true,
        derivedGroupName: null,
      });
      expect(row.since).toBe(today);
      expect(row.roleNames).toHaveLength(1);
      // Bundle + companion = the dialog's expected set, and it is exactly what the function ends.
      expect(row.grantIds).toHaveLength(2);
      const open = await q(sql`
        select id::text from role_grants where organization_id = ${id} and person_id = ${d.person}
           and starts_on <= current_date and (ends_on is null or ends_on > current_date) order by id`);
      expect(row.grantIds).toEqual(open.map((r) => String(r.id)));
      expect(row.permissions.map((p) => p.key)).toContain("roles.manage");
      expect(row.permissions.every((p) => p.description.length > 0)).toBe(true);
      // No email anywhere.
      expect(JSON.stringify(rows)).not.toContain(d.address);
      expect(JSON.stringify(rows)).not.toMatch(/@/);
    });

    it("a dev-seed-style grant is a person row with 'other' provenance (Option A)", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      await grant(id, await role(id, ["roles.manage"]), { personId: p }, "dev-seed: admin grant");
      const { rows } = await lib.listDesignationHolders(platformDb, id, "founding_administrator");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ displayName: "Petroc Vosper", provenance: "other", companionRoleNames: [] });
    });

    it("a person who also holds through a managed group lists the group and does not leave the slot empty; the group is one row with a count and no member names", async () => {
      const id = await org();
      const alice = await member(id, "Quenella", "Rosewarne");
      const bob = await member(id, "Sennen", "Udyvale");
      const carol = await member(id, "Rozenn", "Tregarthen");
      const manage = await role(id, ["roles.manage"]);
      const gp = await grant(id, manage, { personId: alice });
      const volunteers = await makeGroup(id, "Office Volunteers");
      for (const p of [alice, bob, carol]) await addToGroup(id, volunteers, p);
      const gg = await grant(id, manage, { groupId: volunteers });

      const { holderPeopleCount, rows } = await lib.listDesignationHolders(platformDb, id, "founding_administrator");
      expect(holderPeopleCount).toBe(3);
      expect(rows).toHaveLength(2);
      const person = rows.find((r) => r.subjectKind === "person")!;
      expect(person).toMatchObject({ displayName: "Quenella Rosewarne", alsoThroughGroupNames: ["Office Volunteers"], leavesNoHolders: false, grantIds: [gp] });
      const group = rows.find((r) => r.subjectKind === "group")!;
      expect(group).toMatchObject({
        key: `group:${volunteers}`,
        displayName: "Office Volunteers",
        holderPeopleCount: 3,
        revocable: true,
        derivedGroupName: null,
        grantIds: [gg],
        leavesNoHolders: false,
      });
      // The members of a group are never name-resolved: no name and no id in the returned object.
      const serialized = JSON.stringify(group);
      for (const needle of ["Sennen", "Udyvale", "Rozenn", "Tregarthen", bob, carol]) {
        expect(serialized).not.toContain(needle);
      }
      expect(serialized).not.toContain("Rosewarne");
    });

    it("a derived group (active_membership) is listed with revocable:false and no button data", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      void p;
      const [active] = await q(sql`select id from groups where organization_id = ${id} and derived_from = 'active_membership'`);
      const g = await grant(id, await role(id, ["giving.manage"]), { groupId: String(active!.id) });
      const { holderPeopleCount, rows } = await lib.listDesignationHolders(platformDb, id, "treasurer");
      expect(holderPeopleCount).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        subjectKind: "group",
        revocable: false,
        derivedGroupName: rows[0]!.displayName,
        grantIds: [g],
        holderPeopleCount: 1,
      });
      expect(JSON.stringify(rows)).not.toContain("Vosper");
    });

    it("the treasurer slot lists giving.manage holders, and the count IS the SQL count (F169)", async () => {
      const id = await org();
      const p = await member(id, "Ottoline", "Fairweather");
      await grant(id, await role(id, ["giving.manage"]), { personId: p }, "treasurer designation");
      const list = await lib.listDesignationHolders(platformDb, id, "treasurer");
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]).toMatchObject({ displayName: "Ottoline Fairweather", provenance: "designation", companionRoleNames: [] });
      const [counts] = await q(sql`select presby_giving_manage_holder_count(${id}) as gm,
                                         presby_founding_administrator_holder_count(${id}) as fa`);
      expect(list.holderPeopleCount).toBe(Number(counts!.gm));
      expect((await lib.listDesignationHolders(platformDb, id, "founding_administrator")).holderPeopleCount).toBe(Number(counts!.fa));
    });
  });

  // =========================================================================
  // THE REVOKE, AND ITS AUDIT ROW
  // =========================================================================
  describe("revokeDesignationHolder", () => {
    it("revoked: ends the bundle AND the companion, writes exactly one org.founding_administrator.revoked row, ids and reason only", async () => {
      const id = await org();
      const d = await designate(id);
      const { rows } = await lib.listDesignationHolders(platformDb, id, "founding_administrator");
      const row = rows[0]!;
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "person", subjectId: d.person,
        expectedGrantIds: row.grantIds, reason: `  ${GOOD_REASON}  `, actor: actor(),
      });
      expect(result).toEqual({ kind: "revoked", reachedZero: true });
      for (const g of row.grantIds) expect(await endsOn(g)).toBe(today);

      const audits = await auditRows("org.founding_administrator.revoked", id);
      expect(audits).toHaveLength(1);
      const a = audits[0]!;
      expect(a.resource_type).toBe("organization");
      expect(a.resource_id).toBe(id);
      expect(a.actor_user_id).toBe(operator);
      const m = a.metadata as Record<string, unknown>;
      expect(m).toMatchObject({
        organizationId: id,
        slot: "founding_administrator",
        arm: "person",
        personId: d.person,
        clampedToMembershipEnd: false,
        reason: GOOD_REASON,
        holderCountBefore: 1,
        holderCountAfter: 0,
        reachedZero: true,
        selfRevoke: false,
        openInvitationIds: [],
      });
      expect([...(m.grantIds as string[])].sort()).toEqual([...row.grantIds].sort());
      expect((m.roleKeys as string[]).sort()).toEqual(["congregation_stated_clerk", "founding_administrator"].sort());
      expect(m.appliedEndsOn).toEqual([today, today]);
      expect(m.companionGrantIds).toHaveLength(1);
      expect(m).not.toHaveProperty("groupId");
      // ABSENCE of name and email: ids, counts, dates and the reason only.
      const serialized = JSON.stringify(m);
      expect(serialized).not.toContain("Perpetua");
      expect(serialized).not.toContain("Ashgrove");
      expect(serialized).not.toContain(d.address);
      expect(serialized).not.toMatch(/@/);

      // Zero holders now: the list is empty and the designation gate has reopened.
      expect((await lib.listDesignationHolders(platformDb, id, "founding_administrator")).holderPeopleCount).toBe(0);
    });

    it("the treasurer slot writes org.treasurer.revoked, not the founding-administrator key", async () => {
      const id = await org();
      const p = await member(id, "Ottoline", "Fairweather");
      const g = await grant(id, await role(id, ["giving.manage"]), { personId: p }, "treasurer designation");
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "treasurer", subjectKind: "person", subjectId: p,
        expectedGrantIds: [g], reason: GOOD_REASON, actor: actor(),
      });
      expect(result).toEqual({ kind: "revoked", reachedZero: true });
      expect(await endsOn(g)).toBe(today);
      expect(await auditRows("org.treasurer.revoked", id)).toHaveLength(1);
      expect(await auditRows("org.founding_administrator.revoked", id)).toHaveLength(0);
      const m = (await auditRows("org.treasurer.revoked", id))[0]!.metadata as Record<string, unknown>;
      expect(m.slot).toBe("treasurer");
      expect(JSON.stringify(m)).not.toContain("Fairweather");
    });

    it("a group revoke records the group arm and groupId, and reachedZero is false while another holder remains", async () => {
      const id = await org();
      const alice = await member(id, "Quenella", "Rosewarne");
      const bob = await member(id, "Sennen", "Udyvale");
      const manage = await role(id, ["roles.manage"]);
      await grant(id, manage, { personId: alice });
      const volunteers = await makeGroup(id, "Office Volunteers");
      await addToGroup(id, volunteers, bob);
      const gg = await grant(id, manage, { groupId: volunteers });
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "group", subjectId: volunteers,
        expectedGrantIds: [gg], reason: GOOD_REASON, actor: actor(),
      });
      expect(result).toEqual({ kind: "revoked", reachedZero: false });
      const m = (await auditRows("org.founding_administrator.revoked", id))[0]!.metadata as Record<string, unknown>;
      expect(m).toMatchObject({ arm: "group", groupId: volunteers, holderCountBefore: 2, holderCountAfter: 1, reachedZero: false });
      expect(m).not.toHaveProperty("personId");
      expect(JSON.stringify(m)).not.toContain("Udyvale");
    });

    it("an open invitation is left open and its id is reported in the audit row", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      const g = await grant(id, await role(id, ["roles.manage"]), { personId: p });
      const open = await fx.insertInvitation({
        organizationId: id, purpose: "founding_administrator", email: fx.email("open"), createdByUserId: operator,
      });
      await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "person", subjectId: p,
        expectedGrantIds: [g], reason: GOOD_REASON, actor: actor(),
      });
      const m = (await auditRows("org.founding_administrator.revoked", id))[0]!.metadata as Record<string, unknown>;
      expect(m.openInvitationIds).toEqual([open.id]);
      expect((await fx.invitation(open.id)).revoked_at).toBeNull();
    });

    it("selfRevoke is true exactly when the actor is the revoked person", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      const user = await fx.makeUser(fx.email("self"));
      await fx.linkUser(p, user);
      const g = await grant(id, await role(id, ["roles.manage"]), { personId: p });
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "person", subjectId: p,
        expectedGrantIds: [g], reason: GOOD_REASON, actor: { userId: user, email: null },
      });
      expect(result.kind).toBe("revoked");
      const m = (await auditRows("org.founding_administrator.revoked", id))[0]!.metadata as Record<string, unknown>;
      expect(m.selfRevoke).toBe(true);
    });

    it("RULE 7: a FAILED audit insert rolls the revoke back (the grants stay effective, no audit row)", async () => {
      const id = await org();
      const d = await designate(id);
      const { rows } = await lib.listDesignationHolders(platformDb, id, "founding_administrator");
      auditControl.fail = true;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "person", subjectId: d.person,
        expectedGrantIds: rows[0]!.grantIds, reason: GOOD_REASON, actor: actor(),
      });
      spy.mockRestore();
      expect(result).toEqual({ kind: "db_error" });
      for (const g of rows[0]!.grantIds) expect(await endsOn(g)).toBeNull();
      expect(await auditRows("org.founding_administrator.revoked", id)).toHaveLength(0);
      expect((await lib.listDesignationHolders(platformDb, id, "founding_administrator")).holderPeopleCount).toBe(1);
    });

    it("a double submit writes exactly one audit row; the second call is already_removed", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      const g = await grant(id, await role(id, ["roles.manage"]), { personId: p });
      const input = {
        organizationId: id, slot: "founding_administrator" as const, subjectKind: "person" as const, subjectId: p,
        expectedGrantIds: [g], reason: GOOD_REASON, actor: actor(),
      };
      expect(await lib.revokeDesignationHolder(input)).toEqual({ kind: "revoked", reachedZero: true });
      expect(await lib.revokeDesignationHolder(input)).toEqual({ kind: "already_removed" });
      expect(await auditRows("org.founding_administrator.revoked", id)).toHaveLength(1);
    });

    it("changed, not_a_holder, derived_group_refused, not_applicable and no_organization write nothing and no audit row", async () => {
      const id = await org();
      const alice = await member(id, "Petroc", "Vosper");
      const bob = await member(id, "Quenella", "Rosewarne");
      const manage = await role(id, ["roles.manage"]);
      const ga = await grant(id, manage, { personId: alice });
      const base = { organizationId: id, slot: "founding_administrator" as const, subjectKind: "person" as const, reason: GOOD_REASON, actor: actor() };

      // changed: the dialog's set no longer matches (a stale expected id).
      expect(await lib.revokeDesignationHolder({ ...base, subjectId: alice, expectedGrantIds: [ga, randomUUID()] })).toEqual({ kind: "changed" });
      // not_a_holder: a person who holds nothing; a grant id that is not theirs.
      expect(await lib.revokeDesignationHolder({ ...base, subjectId: bob, expectedGrantIds: [ga] })).toEqual({ kind: "not_a_holder" });
      // derived_group_refused: the database refuses the roster of a derived group.
      const [active] = await q(sql`select id from groups where organization_id = ${id} and derived_from = 'active_membership'`);
      const gActive = await grant(id, manage, { groupId: String(active!.id) });
      expect(
        await lib.revokeDesignationHolder({ ...base, subjectKind: "group", subjectId: String(active!.id), expectedGrantIds: [gActive] }),
      ).toEqual({ kind: "derived_group_refused" });
      // no_organization
      expect(await lib.revokeDesignationHolder({ ...base, organizationId: randomUUID(), subjectId: alice, expectedGrantIds: [ga] })).toEqual({ kind: "no_organization" });
      // not_applicable: treasurer at a presbytery.
      const pres = await org("presbytery");
      const pp = await member(pres, "Rozenn", "Tregarthen");
      const gp = await grant(pres, await role(pres, ["giving.manage"]), { personId: pp });
      expect(
        await lib.revokeDesignationHolder({ ...base, organizationId: pres, slot: "treasurer", subjectId: pp, expectedGrantIds: [gp] }),
      ).toEqual({ kind: "not_applicable" });

      expect(await endsOn(ga)).toBeNull();
      expect(await endsOn(gActive)).toBeNull();
      expect(await endsOn(gp)).toBeNull();
      expect(await auditRows("org.founding_administrator.revoked", id)).toHaveLength(0);
      expect(await auditRows("org.treasurer.revoked", pres)).toHaveLength(0);
    });

    it("a reason that fails validation is refused before the database and writes nothing", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      const g = await grant(id, await role(id, ["roles.manage"]), { personId: p });
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "person", subjectId: p,
        expectedGrantIds: [g], reason: "short", actor: actor(),
      });
      expect(result).toMatchObject({ kind: "invalid_input", field: "reason" });
      expect(await endsOn(g)).toBeNull();
      expect(await auditRows("org.founding_administrator.revoked", id)).toHaveLength(0);
    });

    it("a malformed grant id never reaches SQL as text: it is a db_error, not an injection", async () => {
      const id = await org();
      const p = await member(id, "Petroc", "Vosper");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await lib.revokeDesignationHolder({
        organizationId: id, slot: "founding_administrator", subjectKind: "person", subjectId: p,
        expectedGrantIds: ["x}'; drop table role_grants; --"], reason: GOOD_REASON, actor: actor(),
      });
      spy.mockRestore();
      expect(result).toEqual({ kind: "db_error" });
      const [t] = await q(sql`select to_regclass('public.role_grants') as r`);
      expect(t!.r).not.toBeNull();
    });
  });
});
