/**
 * `community-engagement.ts` on a REAL Postgres, through the presby_app `db`
 * exactly as the Server Actions call it (T-W; Community Increment 3a, Batch B;
 * docs/work-log/2026-10-22-founding-admin-directory-inc3.md, Phase 3 sections 5
 * and 10: EC-6 to EC-10, EC-16, EC-26, EC-31). The unit file
 * (`community-engagement.test.ts`) pins what the TypeScript decides with the
 * database mocked; this file proves the parts a mock cannot:
 *
 *   - every outcome of every write, with a before/after digest of the
 *     membership row, its derived rows and the audit rows, so a refusal is shown
 *     to have written NOTHING;
 *   - the derived rows follow (member row opens and closes, the all row
 *     tracks `ended_on`, restore reopens exactly the right ones);
 *   - the audit rows: the closed key list, the actor, one row per ok write,
 *     none for a refusal or `unchanged`, and the free-text how_heard never
 *     inside one;
 *   - a forced throw from the audit insert rolls the change back (EC-16);
 *   - two connections acting on one membership are SERIALIZED by the row lock,
 *     never a silent overwrite (EC-8);
 *   - the G2 detection chain: the address added, the engagement changed, the
 *     sign-in connected, three audit rows joined on the person (EC-31).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/community-engagement.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { MembershipStandingFixture } from "@/lib/testing/membership-standing-fixture";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this environment cannot load. The
// REAL audit modules run: the library writes its rows with insertAuditRow() in
// the change's own transaction, so the tests read them back.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

// Lets a test force the in-transaction audit insert to throw, to prove the
// whole change rolls back with it (EC-16).
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

describe.skipIf(!hasDb)("community-engagement.ts (Postgres-backed)", () => {
  let fx: MembershipStandingFixture;
  let lib: typeof import("./community-engagement");
  let orgA: string; // the viewer's congregation, with the Session and Board of Deacons groups
  let orgB: string; // another congregation
  let viewer: string; // holds people.manage at orgA; a visitor, so self-targeting is exercisable
  let outsider: string; // a listed member of orgA with no grants at all
  let actorUserId: string;
  let ACTOR: { userId: string; email: string | null };
  let today: string;
  let customRoleId: string;

  async function setup() {
    const mod = await import("@/lib/testing/membership-standing-fixture");
    fx = await mod.createMembershipStandingFixture("tw66");
    lib = await import("./community-engagement");
    today = await fx.today();

    orgA = await fx.org("a", { courts: true });
    orgB = await fx.org("b");

    viewer = await fx.person("Viewer");
    await fx.membership(orgA, viewer, null, "visitor");
    outsider = await fx.person("Outsider");
    await fx.membership(orgA, outsider, null, "regular");

    const [manageRole] = await fx.q(sql`
      insert into app_roles (organization_id, key, name, role_kind)
      values (${orgA}, 'tw66_manager', 'Engagement fixture manager', 'custom') returning id`);
    await fx.q(sql`insert into app_role_permissions (role_id, permission_key) values (${String(manageRole!.id)}, 'people.manage')`);
    await fx.q(sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on)
      values (${orgA}, ${String(manageRole!.id)}, ${viewer}, date '2020-01-01')`);
    // A role with no real reach, for the "holds a role grant" refusal.
    const [plain] = await fx.q(sql`
      insert into app_roles (organization_id, key, name, role_kind)
      values (${orgA}, 'tw66_plain', 'Engagement fixture plain role', 'custom') returning id`);
    await fx.q(sql`insert into app_role_permissions (role_id, permission_key) values (${String(plain!.id)}, 'events.view')`);
    customRoleId = String(plain!.id);

    actorUserId = await fx.user(`tw66-actor-${fx.stamp}@example.invalid`);
    ACTOR = { userId: actorUserId, email: `tw66-actor-${fx.stamp}@example.invalid` };
  }

  beforeAll(async () => {
    await setup();
  });

  afterAll(async () => {
    if (!fx) return;
    // Audit rows reference people that are about to go; remove ours.
    await fx.q(sql`
      delete from audit_events
       where metadata->>'organizationId' in (${orgA}, ${orgB})
          or resource_id in (select id::text from people where last_name like ${`Standing${fx.stamp}%`})`);
    await fx.cleanup();
  });

  beforeEach(() => {
    auditControl.fail = false;
  });

  /** A person with a membership at `org` (owner path, so any roll or engagement can be fixtured). */
  async function make(roll: string | null, engagement: string, org = orgA, first = "Fixture") {
    const personId = await fx.person(first);
    const membershipId = await fx.membership(org, personId, roll, engagement);
    return { personId, membershipId };
  }

  const auditsFor = (personId: string) =>
    fx.q(sql`
      select action, actor_user_id::text as actor_user_id, actor_email, resource_type, resource_id, metadata
        from audit_events where resource_id = ${personId} order by created_at, id`);

  /** Everything a refusal must leave alone: the membership row, its derived rows, the audit rows. */
  async function digest(personId: string, membershipId: string) {
    const [row] = await fx.q(sql`select to_jsonb(m) as row from memberships m where m.id = ${membershipId}`);
    const derived = await fx.q(sql`
      select g.derived_from, gm.starts_on::text as s, gm.ends_on::text as e
        from group_memberships gm join groups g on g.id = gm.group_id
       where gm.membership_id = ${membershipId} order by g.derived_from`);
    const audits = await auditsFor(personId);
    return JSON.stringify({ row: row!.row, derived, audits: audits.length });
  }

  const keysOf = (r: Record<string, unknown>) => Object.keys(r.metadata as object).sort();

  // ---------------------------------------------------------------------------
  describe("changeEngagement", () => {
    it("visitor -> regular: the row, the derived rows and the audit row all move together", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      expect((await fx.derivedRows(membershipId)).active_membership).toBeUndefined();

      const result = await lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR);
      expect(result).toEqual({ kind: "ok", from: "visitor", to: "regular", standingFrom: "visitor", standingTo: "listed", signInConnected: false });

      const [row] = await fx.q(sql`select engagement_status from memberships where id = ${membershipId}`);
      expect(row!.engagement_status).toBe("regular");
      expect((await fx.derivedRows(membershipId)).active_membership).toEqual({ startsOn: today, endsOn: null });

      const audits = await auditsFor(personId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "tenant.person.engagement_changed",
        actor_user_id: actorUserId,
        actor_email: ACTOR.email,
        resource_type: "person",
        resource_id: personId,
      });
      expect(keysOf(audits[0]!)).toEqual(["from", "organizationId", "personId", "signInConnected", "standingFrom", "standingTo", "to"]);
      expect(audits[0]!.metadata).toEqual({
        organizationId: orgA, personId, from: "visitor", to: "regular", standingFrom: "visitor", standingTo: "listed", signInConnected: false,
      });
    });

    it("regular -> inactive closes the member row at today and leaves the all row open; inactive -> regular reopens", async () => {
      const { personId, membershipId } = await make(null, "regular");
      expect((await fx.derivedRows(membershipId)).active_membership).toEqual({ startsOn: today, endsOn: null });

      expect(await lib.changeEngagement(viewer, orgA, { personId, to: "inactive" }, ACTOR)).toMatchObject({ kind: "ok", standingTo: "inactive" });
      let rows = await fx.derivedRows(membershipId);
      expect(rows.active_membership).toEqual({ startsOn: today, endsOn: today });
      expect(rows.all_memberships!.endsOn).toBeNull();

      expect(await lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR)).toMatchObject({ kind: "ok", standingTo: "listed" });
      rows = await fx.derivedRows(membershipId);
      expect(rows.active_membership!.endsOn).toBeNull();
      expect((await auditsFor(personId)).map((a) => (a.metadata as { to: string }).to)).toEqual(["inactive", "regular"]);
    });

    it("a rolled person may be marked inactive or moved away: the standing stays listed and the roll keeps them in", async () => {
      const { personId, membershipId } = await make("active", "regular");
      expect(await lib.changeEngagement(viewer, orgA, { personId, to: "moved_away" }, ACTOR)).toEqual({
        kind: "ok", from: "regular", to: "moved_away", standingFrom: "listed", standingTo: "listed", signInConnected: false,
      });
      expect((await fx.derivedRows(membershipId)).active_membership!.endsOn).toBeNull();
    });

    it("reports signInConnected from people.user_id (never users) in the result and the audit row", async () => {
      const { personId } = await make(null, "visitor");
      await fx.q(sql`update people set user_id = ${actorUserId} where id = ${personId}`);
      const result = await lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR);
      expect(result).toMatchObject({ kind: "ok", signInConnected: true });
      expect((await auditsFor(personId))[0]!.metadata).toMatchObject({ signInConnected: true });
      await fx.q(sql`update people set user_id = null where id = ${personId}`);
    });

    it("every refusal writes nothing: no row change, no derived-row change, no audit row", async () => {
      const visitor = await make(null, "visitor");
      const staff = await make(null, "staff");
      const rolled = await make("active", "regular");
      const archived = await make(null, "visitor");
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'community_archived' where id = ${archived.membershipId}`);
      const regular = await make(null, "regular");

      const cases: Array<[string, { personId: string; membershipId: string }, Parameters<typeof lib.changeEngagement>[2], unknown]> = [
        ["staff record", staff, { personId: staff.personId, to: "regular" }, { kind: "staff_record" }],
        ["ended", archived, { personId: archived.personId, to: "regular" }, { kind: "ended" }],
        ["visitor on the roll", rolled, { personId: rolled.personId, to: "visitor" }, { kind: "needs_no_roll" }],
        ["unchanged", regular, { personId: regular.personId, to: "regular" }, { kind: "unchanged" }],
        ["stale expectedFrom", visitor, { personId: visitor.personId, to: "regular", expectedFrom: "regular" }, { kind: "changed_meanwhile" }],
      ];
      for (const [label, who, input, expected] of cases) {
        const before = await digest(who.personId, who.membershipId);
        expect(await lib.changeEngagement(viewer, orgA, input, ACTOR), label).toEqual(expected);
        expect(await digest(who.personId, who.membershipId), `${label}: nothing written`).toBe(before);
      }
    });

    it("forbidden without people.manage; a person of another organization, a missing id, a merged and a deceased person are all the same not_found", async () => {
      const target = await make(null, "visitor");
      const before = await digest(target.personId, target.membershipId);
      expect(await lib.changeEngagement(outsider, orgA, { personId: target.personId, to: "regular" }, ACTOR)).toEqual({ kind: "forbidden" });
      expect(await digest(target.personId, target.membershipId)).toBe(before);

      const elsewhere = await make(null, "visitor", orgB);
      const merged = await make(null, "visitor");
      const survivor = await make(null, "regular");
      await fx.q(sql`update people set merged_into_id = ${survivor.personId} where id = ${merged.personId}`);
      const deceased = await fx.person("Deceased", { deceased: true });
      await fx.membership(orgA, deceased, null, "visitor");

      for (const personId of [elsewhere.personId, "00000000-0000-4000-8000-000000000000", merged.personId, deceased]) {
        expect(await lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR)).toEqual({ kind: "not_found" });
      }
      const [stillVisitor] = await fx.q(sql`select engagement_status from memberships where id = ${elsewhere.membershipId}`);
      expect(stillVisitor!.engagement_status).toBe("visitor");
    });

    it("self-targeting is allowed and audited", async () => {
      const [m] = await fx.q(sql`select id from memberships where person_id = ${viewer} and organization_id = ${orgA}`);
      const result = await lib.changeEngagement(viewer, orgA, { personId: viewer, to: "regular" }, ACTOR);
      expect(result.kind).toBe("ok");
      expect((await auditsFor(viewer))[0]).toMatchObject({ action: "tenant.person.engagement_changed", resource_id: viewer });
      // Put it back for the archive tests, which need the viewer to be a visitor.
      await fx.q(sql`update memberships set engagement_status = 'visitor' where id = ${String(m!.id)}`);
      await fx.q(sql`delete from audit_events where resource_id = ${viewer}`);
    });

    it("a forged extra input (organizationId, from) is ignored: the write lands in the viewer's own organization with the true from", async () => {
      const target = await make(null, "inactive");
      const elsewhere = await make(null, "inactive", orgB);
      const forged = { personId: target.personId, to: "regular", organizationId: orgB, from: "staff" } as never;
      expect(await lib.changeEngagement(viewer, orgA, forged, ACTOR)).toMatchObject({ kind: "ok", from: "inactive" });
      const [other] = await fx.q(sql`select engagement_status from memberships where id = ${elsewhere.membershipId}`);
      expect(other!.engagement_status).toBe("inactive");
    });
  });

  // ---------------------------------------------------------------------------
  describe("archivePerson and restorePerson", () => {
    it("archives a visitor: ended with the marker, both derived rows end, one audit row; the person is in Former and out of Visitors", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const result = await lib.archivePerson(viewer, orgA, { personId }, ACTOR);
      expect(result).toEqual({ kind: "ok", engagement: "visitor", signInConnected: false });

      const [row] = await fx.q(sql`select ended_on::text as ended_on, ended_reason, engagement_status from memberships where id = ${membershipId}`);
      expect(row).toEqual({ ended_on: today, ended_reason: "community_archived", engagement_status: "visitor" });
      const rows = await fx.derivedRows(membershipId);
      expect(rows.all_memberships!.endsOn).toBe(today);

      const audits = await auditsFor(personId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "tenant.person.archived", resource_type: "person", actor_user_id: actorUserId });
      expect(keysOf(audits[0]!)).toEqual(["engagement", "organizationId", "personId", "signInConnected"]);
      expect(audits[0]!.metadata).toEqual({ organizationId: orgA, personId, engagement: "visitor", signInConnected: false });

      const community = await import("./community");
      const former = await community.listFormer(viewer, orgA, { page: 1, pageSize: 500 });
      const visitors = await community.listVisitors(viewer, orgA, { page: 1, pageSize: 500 });
      expect(former.kind === "ok" && former.rows.some((r) => r.personId === personId)).toBe(true);
      expect(visitors.kind === "ok" && visitors.rows.some((r) => r.personId === personId)).toBe(false);
    });

    it("archives an inactive and a moved-away person", async () => {
      for (const engagement of ["inactive", "moved_away"]) {
        const { personId } = await make(null, engagement);
        expect(await lib.archivePerson(viewer, orgA, { personId }, ACTOR)).toMatchObject({ kind: "ok", engagement });
      }
    });

    it("refuses, writing nothing, for a listed member, a participant, a staff anchor and a regular attender (not_eligible)", async () => {
      const cases = [await make("active", "regular"), await make("other_participant", "regular"), await make(null, "staff"), await make(null, "regular"), await make("active", "inactive")];
      for (const who of cases) {
        const before = await digest(who.personId, who.membershipId);
        expect(await lib.archivePerson(viewer, orgA, { personId: who.personId }, ACTOR)).toEqual({ kind: "not_eligible" });
        expect(await digest(who.personId, who.membershipId)).toBe(before);
      }
    });

    it("refuses the viewer's own record (self_target), ahead of everything else", async () => {
      const [m] = await fx.q(sql`select id from memberships where person_id = ${viewer} and organization_id = ${orgA}`);
      const before = await digest(viewer, String(m!.id));
      expect(await lib.archivePerson(viewer, orgA, { personId: viewer }, ACTOR)).toEqual({ kind: "self_target" });
      expect(await digest(viewer, String(m!.id))).toBe(before);
    });

    it("refuses an open officer term, an open role grant, an open staff position and a pending roll action, each writing nothing (EC-6)", async () => {
      const termHolder = await make(null, "visitor");
      await fx.q(sql`
        insert into officer_terms (organization_id, person_id, office, starts_on)
        values (${orgA}, ${termHolder.personId}, 'ruling_elder', date '2020-01-01')`);

      const grantHolder = await make(null, "visitor");
      await fx.q(sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on)
        values (${orgA}, ${customRoleId}, ${grantHolder.personId}, date '2020-01-01')`);

      const staffHolder = await make(null, "inactive");
      await fx.q(sql`
        insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
        values (${orgA}, ${staffHolder.personId}, 'Organist', 'organist', date '2020-01-01')`);

      const pending = await make(null, "visitor");
      await fx.q(sql`
        insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
        values (${orgA}, ${pending.personId}, 'profession_of_faith', current_date, 'active', 'pending', ${actorUserId})`);

      const cases: Array<[typeof termHolder, string]> = [
        [termHolder, "holds_position"],
        [grantHolder, "holds_position"],
        [staffHolder, "holds_position"],
        [pending, "pending_action"],
      ];
      for (const [who, kind] of cases) {
        const before = await digest(who.personId, who.membershipId);
        expect(await lib.archivePerson(viewer, orgA, { personId: who.personId }, ACTOR), kind).toEqual({ kind });
        expect(await digest(who.personId, who.membershipId), `${kind}: nothing written`).toBe(before);
      }

      // Ending the position first makes the archive go through (the sentence says "End that first").
      await fx.q(sql`update staff_positions set ends_on = current_date - 1 where person_id = ${staffHolder.personId}`);
      expect(await lib.archivePerson(viewer, orgA, { personId: staffHolder.personId }, ACTOR)).toMatchObject({ kind: "ok" });
    });

    it("a seat that has not started yet also holds the archive: the pre-check is stricter than memberships_guard_end, by design (the guard itself is mapped in the unit file)", async () => {
      const who = await make(null, "visitor");
      await fx.q(sql`
        insert into officer_terms (organization_id, person_id, office, starts_on)
        values (${orgA}, ${who.personId}, 'ruling_elder', date '2999-01-01')`);
      const before = await digest(who.personId, who.membershipId);
      expect(await lib.archivePerson(viewer, orgA, { personId: who.personId }, ACTOR)).toEqual({ kind: "holds_position" });
      expect(await digest(who.personId, who.membershipId)).toBe(before);
    });

    it("already_ended on a second archive; not_found for another organization, a merged and a deceased person", async () => {
      const { personId } = await make(null, "visitor");
      expect((await lib.archivePerson(viewer, orgA, { personId }, ACTOR)).kind).toBe("ok");
      expect(await lib.archivePerson(viewer, orgA, { personId }, ACTOR)).toEqual({ kind: "already_ended" });

      const elsewhere = await make(null, "visitor", orgB);
      const deceased = await fx.person("Deceased", { deceased: true });
      await fx.membership(orgA, deceased, null, "visitor");
      for (const id of [elsewhere.personId, deceased]) {
        expect(await lib.archivePerson(viewer, orgA, { personId: id }, ACTOR)).toEqual({ kind: "not_found" });
      }
      expect(await lib.archivePerson(outsider, orgA, { personId }, ACTOR)).toEqual({ kind: "forbidden" });
    });

    it("restore reopens the all row and, for a visitor, leaves the member row closed (EC-7); an archived inactive person returns inactive", async () => {
      const visitor = await make(null, "visitor");
      await lib.archivePerson(viewer, orgA, { personId: visitor.personId }, ACTOR);
      const restored = await lib.restorePerson(viewer, orgA, { personId: visitor.personId }, ACTOR);
      expect(restored).toEqual({ kind: "ok", engagement: "visitor", signInConnected: false });

      const [row] = await fx.q(sql`select ended_on, ended_reason from memberships where id = ${visitor.membershipId}`);
      expect(row).toEqual({ ended_on: null, ended_reason: null });
      const rows = await fx.derivedRows(visitor.membershipId);
      expect(rows.all_memberships!.endsOn).toBeNull();
      expect(rows.active_membership).toBeUndefined();

      const audits = await auditsFor(visitor.personId);
      expect(audits.map((a) => a.action)).toEqual(["tenant.person.archived", "tenant.person.restored"]);
      expect(keysOf(audits[1]!)).toEqual(["engagement", "organizationId", "personId", "signInConnected"]);

      const inactive = await make(null, "inactive");
      await lib.archivePerson(viewer, orgA, { personId: inactive.personId }, ACTOR);
      expect(await lib.restorePerson(viewer, orgA, { personId: inactive.personId }, ACTOR)).toMatchObject({ kind: "ok", engagement: "inactive" });
    });

    it("restore refuses a participant removal, a never-archived person and any other end reason (not_archived), writing nothing", async () => {
      const removed = await make("other_participant", "regular");
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'other_participant_removed' where id = ${removed.membershipId}`);
      const live = await make(null, "visitor");
      const other = await make(null, "regular");
      await fx.q(sql`update memberships set ended_on = current_date, ended_reason = 'transferred' where id = ${other.membershipId}`);
      for (const who of [removed, live, other]) {
        const before = await digest(who.personId, who.membershipId);
        expect(await lib.restorePerson(viewer, orgA, { personId: who.personId }, ACTOR)).toEqual({ kind: "not_archived" });
        expect(await digest(who.personId, who.membershipId)).toBe(before);
      }
    });

    it("restore refuses an archived person who is now deceased or merged (person_unavailable); another organization's person is not_found; forbidden without people.manage", async () => {
      const deceased = await make(null, "visitor");
      await lib.archivePerson(viewer, orgA, { personId: deceased.personId }, ACTOR);
      await fx.q(sql`update people set date_of_death = date '2026-01-01' where id = ${deceased.personId}`);
      const before = await digest(deceased.personId, deceased.membershipId);
      expect(await lib.restorePerson(viewer, orgA, { personId: deceased.personId }, ACTOR)).toEqual({ kind: "person_unavailable" });
      expect(await digest(deceased.personId, deceased.membershipId)).toBe(before);

      const merged = await make(null, "visitor");
      const survivor = await make(null, "regular");
      await lib.archivePerson(viewer, orgA, { personId: merged.personId }, ACTOR);
      await fx.q(sql`update people set merged_into_id = ${survivor.personId} where id = ${merged.personId}`);
      expect(await lib.restorePerson(viewer, orgA, { personId: merged.personId }, ACTOR)).toEqual({ kind: "person_unavailable" });

      const elsewhere = await make(null, "visitor", orgB);
      expect(await lib.restorePerson(viewer, orgA, { personId: elsewhere.personId }, ACTOR)).toEqual({ kind: "not_found" });
      const archived = await make(null, "visitor");
      await lib.archivePerson(viewer, orgA, { personId: archived.personId }, ACTOR);
      expect(await lib.restorePerson(outsider, orgA, { personId: archived.personId }, ACTOR)).toEqual({ kind: "forbidden" });
    });

    it("engagement cannot change while archived (ended), and visit details cannot either", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      await lib.archivePerson(viewer, orgA, { personId }, ACTOR);
      const before = await digest(personId, membershipId);
      expect(await lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR)).toEqual({ kind: "ended" });
      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: "2026-03-01", howHeard: "x" }, ACTOR)).toEqual({ kind: "ended" });
      expect(await digest(personId, membershipId)).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  describe("updateVisitDetails", () => {
    it("writes the two columns and audits booleans only; the free text never reaches the audit row (EC-16, EC-26)", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const heard = "a neighbour mentioned the choir";
      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: "2026-03-01", howHeard: `  ${heard}  ` }, ACTOR)).toEqual({ kind: "ok" });
      const [row] = await fx.q(sql`select first_visit_date::text as d, how_heard, engagement_status from memberships where id = ${membershipId}`);
      expect(row).toEqual({ d: "2026-03-01", how_heard: heard, engagement_status: "visitor" });

      const audits = await auditsFor(personId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "tenant.person.visit_details_updated", actor_user_id: actorUserId });
      expect(keysOf(audits[0]!)).toEqual(["firstVisitDateChanged", "howHeardChanged", "organizationId", "personId"]);
      expect(audits[0]!.metadata).toEqual({ organizationId: orgA, personId, firstVisitDateChanged: true, howHeardChanged: true });
      expect(JSON.stringify(audits)).not.toContain("choir");
      expect(JSON.stringify(audits)).not.toContain("2026-03-01");
    });

    it("unchanged writes nothing; blank clears; one field changed audits only that field", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      await fx.q(sql`update memberships set first_visit_date = date '2026-03-01', how_heard = 'a friend' where id = ${membershipId}`);

      const before = await digest(personId, membershipId);
      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: "2026-03-01", howHeard: " a friend " }, ACTOR)).toEqual({ kind: "unchanged" });
      expect(await digest(personId, membershipId)).toBe(before);

      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: "2026-03-01", howHeard: "a neighbour" }, ACTOR)).toEqual({ kind: "ok" });
      expect((await auditsFor(personId))[0]!.metadata).toMatchObject({ firstVisitDateChanged: false, howHeardChanged: true });

      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: null, howHeard: "   " }, ACTOR)).toEqual({ kind: "ok" });
      const [row] = await fx.q(sql`select first_visit_date, how_heard from memberships where id = ${membershipId}`);
      expect(row).toEqual({ first_visit_date: null, how_heard: null });
    });

    it("refuses a bad date (impossible, before 1900, after today) and over-long text, writing nothing", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const before = await digest(personId, membershipId);
      for (const firstVisitDate of ["2026-02-30", "1899-12-31", "2999-01-01", "yesterday"]) {
        expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate, howHeard: null }, ACTOR), firstVisitDate).toEqual({ kind: "bad_date" });
      }
      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: null, howHeard: "h".repeat(201) }, ACTOR)).toEqual({ kind: "bad_text" });
      expect(await digest(personId, membershipId)).toBe(before);

      // The bounds themselves are accepted.
      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: "1900-01-01", howHeard: "h".repeat(200) }, ACTOR)).toEqual({ kind: "ok" });
      expect(await lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: today, howHeard: null }, ACTOR)).toEqual({ kind: "ok" });
    });

    it("forbidden without people.manage; not_found for another organization's person", async () => {
      const { personId } = await make(null, "visitor");
      expect(await lib.updateVisitDetails(outsider, orgA, { personId, firstVisitDate: null, howHeard: "x" }, ACTOR)).toEqual({ kind: "forbidden" });
      const elsewhere = await make(null, "visitor", orgB);
      expect(await lib.updateVisitDetails(viewer, orgA, { personId: elsewhere.personId, firstVisitDate: null, howHeard: "x" }, ACTOR)).toEqual({ kind: "not_found" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("a forced throw from the audit insert rolls the whole change back (EC-16)", () => {
    it("changeEngagement: the engagement and the derived rows are unchanged", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const before = await digest(personId, membershipId);
      auditControl.fail = true;
      await expect(lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR)).rejects.toThrow("audit insert failed");
      auditControl.fail = false;
      expect(await digest(personId, membershipId)).toBe(before);
    });

    it("archivePerson: still live, no end date, derived rows open", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const before = await digest(personId, membershipId);
      auditControl.fail = true;
      await expect(lib.archivePerson(viewer, orgA, { personId }, ACTOR)).rejects.toThrow("audit insert failed");
      auditControl.fail = false;
      expect(await digest(personId, membershipId)).toBe(before);
      const [row] = await fx.q(sql`select ended_on from memberships where id = ${membershipId}`);
      expect(row!.ended_on).toBeNull();
    });

    it("restorePerson: still archived", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      await lib.archivePerson(viewer, orgA, { personId }, ACTOR);
      const before = await digest(personId, membershipId);
      auditControl.fail = true;
      await expect(lib.restorePerson(viewer, orgA, { personId }, ACTOR)).rejects.toThrow("audit insert failed");
      auditControl.fail = false;
      expect(await digest(personId, membershipId)).toBe(before);
      const [row] = await fx.q(sql`select ended_reason from memberships where id = ${membershipId}`);
      expect(row!.ended_reason).toBe("community_archived");
    });

    it("updateVisitDetails: the stored values are unchanged", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const before = await digest(personId, membershipId);
      auditControl.fail = true;
      await expect(lib.updateVisitDetails(viewer, orgA, { personId, firstVisitDate: "2026-03-01", howHeard: "x" }, ACTOR)).rejects.toThrow("audit insert failed");
      auditControl.fail = false;
      expect(await digest(personId, membershipId)).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  // Two connections, one membership (EC-8). The owner connection holds the row
  // lock while the library call (a second connection, presby_app) is started
  // and has demonstrably queued behind it; the owner then acts and commits, and
  // the library call resumes against what it left. The row lock is what
  // serializes them, so the second writer reads the first's result instead of
  // overwriting it blind.
  describe("two connections acting on one membership are serialized, never a silent overwrite (EC-8)", () => {
    async function waitForQueuedLock(): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await fx.q(sql`
          select count(*)::int as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
        if (Number(row!.n) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("the library call never queued behind the row lock");
    }

    /** Hold the membership's row lock on the owner connection, start `call`, wait until it queues, run `act`, commit, then await `call`. */
    async function raceWith<T>(membershipId: string, call: () => Promise<T>, act: (tx: Parameters<Parameters<typeof fx.platform.transaction>[0]>[0]) => Promise<void>): Promise<T> {
      let pending!: Promise<T>;
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select 1 from memberships where id = ${membershipId} for update`);
        pending = call();
        // Attach a handler now so a rejection during the wait is not unhandled.
        pending.catch(() => {});
        await waitForQueuedLock();
        await act(tx);
      });
      return pending;
    }

    it("engagement against archive: the archive that arrives second sees the new standing and is refused (not_eligible), the engagement change stands", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const result = await raceWith(
        membershipId,
        () => lib.archivePerson(viewer, orgA, { personId }, ACTOR),
        async (tx) => {
          await tx.execute(sql`update memberships set engagement_status = 'regular' where id = ${membershipId}`);
        },
      );
      expect(result).toEqual({ kind: "not_eligible" });
      const [row] = await fx.q(sql`select engagement_status, ended_on from memberships where id = ${membershipId}`);
      expect(row).toEqual({ engagement_status: "regular", ended_on: null });
      expect((await auditsFor(personId)).filter((a) => a.action === "tenant.person.archived")).toHaveLength(0);
    });

    it("archive against engagement: the engagement change that arrives second is `ended`, and the archive stands", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const result = await raceWith(
        membershipId,
        () => lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR),
        async (tx) => {
          await tx.execute(sql`update memberships set ended_on = current_date, ended_reason = 'community_archived' where id = ${membershipId}`);
        },
      );
      expect(result).toEqual({ kind: "ended" });
      const [row] = await fx.q(sql`select engagement_status, ended_reason from memberships where id = ${membershipId}`);
      expect(row).toEqual({ engagement_status: "visitor", ended_reason: "community_archived" });
    });

    it("two engagement changes: with the stale-guard the second is changed_meanwhile and the first stands untouched", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const result = await raceWith(
        membershipId,
        () => lib.changeEngagement(viewer, orgA, { personId, to: "inactive", expectedFrom: "visitor" }, ACTOR),
        async (tx) => {
          await tx.execute(sql`update memberships set engagement_status = 'regular' where id = ${membershipId}`);
        },
      );
      expect(result).toEqual({ kind: "changed_meanwhile" });
      const [row] = await fx.q(sql`select engagement_status from memberships where id = ${membershipId}`);
      expect(row!.engagement_status).toBe("regular");
      expect(await auditsFor(personId)).toHaveLength(0);
    });

    it("two engagement changes with no stale-guard are serialized: the second reads the first's value as its `from`, so the audit chain is true", async () => {
      const { personId, membershipId } = await make(null, "visitor");
      const result = await raceWith(
        membershipId,
        () => lib.changeEngagement(viewer, orgA, { personId, to: "inactive" }, ACTOR),
        async (tx) => {
          await tx.execute(sql`update memberships set engagement_status = 'regular' where id = ${membershipId}`);
        },
      );
      expect(result).toMatchObject({ kind: "ok", from: "regular", to: "inactive" });
      const audits = await auditsFor(personId);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.metadata).toMatchObject({ from: "regular", to: "inactive", standingFrom: "listed", standingTo: "inactive" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("the G2 detection chain joins on the person (EC-31)", () => {
    it("address added, then engagement changed, then sign-in connected: three audit rows, one personId", async () => {
      const { updatePerson } = await import("./people");
      const { connectSignedInAccount } = await import("./onboarding/connect");

      const { personId } = await make(null, "visitor");
      await fx.enableConnect(orgA);
      const address = `tw66-chain-${fx.stamp}@example.invalid`;
      const [name] = await fx.q(sql`select last_name from people where id = ${personId}`);

      // 1. The address is put on the record (the v0.42.0 audit row).
      const saved = await updatePerson(
        viewer,
        orgA,
        {
          personId,
          identity: { firstName: "Fixture", lastName: String(name!.last_name) },
          contact: { emails: { rows: [{ value: address, subtype: null, isPrimary: true, doNotContact: false }], knownIds: [] } },
          household: { mode: "none" },
        },
        ACTOR,
      );
      expect(saved.kind).toBe("ok");

      // 2. The administrator lists the person.
      expect(await lib.changeEngagement(viewer, orgA, { personId, to: "regular" }, ACTOR)).toMatchObject({ kind: "ok" });

      // 3. The proven account signs in and is connected to the record.
      const userId = await fx.user(address);
      expect(await connectSignedInAccount({ userId, via: "sign_in", proof: "account" })).toEqual({ kind: "connected", organizationSlug: expect.any(String) });

      const chain = await fx.q(sql`
        select action, resource_id, metadata->>'personId' as person_id
          from audit_events
         where resource_id = ${personId}
           and action in ('tenant.person_email.added', 'tenant.person.engagement_changed', 'tenant.person.sign_in_connected')
         order by created_at, id`);
      expect(chain.map((r) => r.action)).toEqual([
        "tenant.person_email.added",
        "tenant.person.engagement_changed",
        "tenant.person.sign_in_connected",
      ]);
      // Joined on the person: every row names the same one (the email row by resource, the others by metadata too).
      for (const r of chain) expect(r.resource_id).toBe(personId);
      expect(chain.filter((r) => r.person_id !== null).every((r) => r.person_id === personId)).toBe(true);
    });
  });
});
