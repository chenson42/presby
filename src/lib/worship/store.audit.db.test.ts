/**
 * The audit rows `store.ts` and `event-hooks.ts` write - each with exactly the
 * documented metadata keys and no others, in the SAME transaction as the change
 * (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Audit actions added to
 * AUDIT_ACTIONS"; Tests, `store.audit.db.test.ts`). `check:audit` scans only
 * `actions.ts` for literal database writes and the actions call the store, so
 * it is blind to these; this file is what pins them (the groups precedent).
 *
 * Batch 2 pinned the team and roster rows and the unaudited configuration;
 * Batch 3 adds the response, send and service-cancel rows and the scheduling
 * actions that write NO row (placement, removal, a volunteer's own answer,
 * blockouts, services).
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/worship/store.audit.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { WorshipTestWorld, WorshipWorld } from "@/lib/testing/worship-world";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

// A switch in front of the real audit insert, to prove a failed audit insert fails the change.
const hooks = vi.hoisted(() => ({ auditFails: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: (...args: Parameters<typeof actual.insertAuditRow>) =>
      hooks.auditFails ? Promise.reject(new Error("audit store unavailable")) : actual.insertAuditRow(...args),
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("worship audit rows (Postgres-backed)", () => {
  let t: WorshipTestWorld;
  let store: typeof import("./store");
  let W: WorshipWorld;

  const v = (personId: string) => t.viewer(personId, W.org);

  const auditFor = (resourceId: string, prefix = "tenant.worship.") =>
    t.q(sql`select action, resource_type, resource_id, actor_user_id::text as actor_user_id, actor_email, metadata
              from audit_events where resource_id = ${resourceId} and action like ${`${prefix}%`} order by created_at, id`);

  beforeAll(async () => {
    await import("@/lib/db/schema");
    const world = await import("@/lib/testing/worship-world");
    t = await world.createWorshipWorld("waudit");
    store = await import("./store");
    W = await t.build("a");
  });
  afterAll(async () => {
    if (t) {
      // The Send tests below queue real rows to these addresses; a stray `queued` row with no
      // retry time is the oldest eligible row for any other suite's `processQueueBatch(1)`.
      await t.q(sql`delete from email_queue where to_email like '%@waudit.example.invalid'`).catch(() => undefined);
      await t.fx.cleanup();
    }
  });
  beforeEach(() => {
    hooks.auditFails = false;
  });

  describe("tenant.worship.team_created", () => {
    it("a new team writes one row: via 'new' and the group id, the actor, nothing else", async () => {
      const r = await store.createTeam(v(W.manager), { name: "Audit Band", kind: "team", starter: "praise_band", description: "Secret-ish description" });
      if (r.kind !== "ok") throw new Error("setup");
      const rows = await auditFor(r.data.groupId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "tenant.worship.team_created",
        resource_type: "worship_team",
        resource_id: r.data.groupId,
        actor_user_id: t.fx.actingUserId,
        actor_email: "actor@example.invalid",
      });
      expect(rows[0]!.metadata).toEqual({ via: "new", groupId: r.data.groupId });
      // Never a name or a description.
      expect(JSON.stringify(rows[0])).not.toMatch(/Audit Band|Secret-ish/);
    });

    it("adopting an existing group writes via 'existing'", async () => {
      const g = await t.group(W.org, "choir", "Audit Choir");
      const r = await store.adoptTeam(v(W.groupsManager), { groupId: g });
      expect(r.kind).toBe("ok");
      const rows = await auditFor(g);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toEqual({ via: "existing", groupId: g });
    });

    it("a refused create writes nothing, and a failed audit insert rolls the whole team back", async () => {
      const before = await t.one(sql`select count(*)::int as n from groups where organization_id = ${W.org}`);
      hooks.auditFails = true;
      await expect(store.createTeam(v(W.manager), { name: "Will Not Exist", kind: "team", starter: "ushers" })).rejects.toThrow("audit store unavailable");
      hooks.auditFails = false;
      const after = await t.one(sql`select count(*)::int as n from groups where organization_id = ${W.org}`);
      expect(after.n).toBe(before.n);
      expect(await t.q(sql`select 1 from groups where organization_id = ${W.org} and name = 'Will Not Exist'`)).toHaveLength(0);
      expect(await t.q(sql`select 1 from worship_positions p join groups g on g.id = p.group_id where g.organization_id = ${W.org} and g.name = 'Will Not Exist'`)).toHaveLength(0);
      const refused = await store.createTeam(v(W.planner), { name: "Refused", kind: "team" });
      expect(refused.kind).toBe("forbidden");
      expect(await t.q(sql`select 1 from groups where organization_id = ${W.org} and name = 'Refused'`)).toHaveLength(0);
    });
  });

  describe("tenant.worship.roster_changed", () => {
    it("adding a member writes change 'added' with the group and person ids; a no-op writes nothing", async () => {
      const g = W.choir;
      expect((await store.addTeamMember(v(W.manager), { groupId: g, personId: W.bob })).kind).toBe("ok");
      expect((await store.addTeamMember(v(W.manager), { groupId: g, personId: W.bob })).kind).toBe("ok");
      const rows = (await auditFor(g)).filter((r) => (r.metadata as { personId?: string }).personId === W.bob);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "tenant.worship.roster_changed", resource_type: "worship_team", resource_id: g });
      expect(rows[0]!.metadata).toEqual({ change: "added", groupId: g, personId: W.bob });
    });

    it("ending a member writes change 'ended'; a repeat writes nothing", async () => {
      const [row] = await t.q(sql`select id::text as id from group_memberships where group_id = ${W.choir} and person_id = ${W.bob}`);
      expect((await store.endTeamMember(v(W.manager), { groupId: W.choir, groupMembershipId: String(row!.id) })).kind).toBe("ok");
      expect((await store.endTeamMember(v(W.manager), { groupId: W.choir, groupMembershipId: String(row!.id) })).kind).toBe("ok");
      const rows = (await auditFor(W.choir)).filter((r) => (r.metadata as { change?: string }).change === "ended");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toEqual({ change: "ended", groupId: W.choir, personId: W.bob });
    });

    it("a failed audit insert leaves the roster unchanged", async () => {
      hooks.auditFails = true;
      await expect(store.addTeamMember(v(W.manager), { groupId: W.choir, personId: W.child })).rejects.toThrow("audit store unavailable");
      hooks.auditFails = false;
      expect(await t.q(sql`select 1 from group_memberships where group_id = ${W.choir} and person_id = ${W.child}`)).toHaveLength(0);
    });

    it("a refused add (role-bound, retired, not a member) writes nothing", async () => {
      const w = await t.build("b");
      const roleId = await t.fx.makeRole(w.org, "bound_role2", ["directory.view"]);
      await t.q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on) values (${w.org}, ${roleId}, ${w.band}, '2020-01-01')`);
      expect((await store.addTeamMember(t.viewer(w.manager, w.org), { groupId: w.band, personId: w.plain })).kind).toBe("conflict");
      expect(await auditFor(w.band)).toHaveLength(0);
    });
  });

  describe("configuration is unaudited, as groups are", () => {
    it("positions, qualifications, service types, update and retire write no tenant.worship row", async () => {
      const w = await t.build("c");
      const viewer = t.viewer(w.manager, w.org);
      const before = await t.one(sql`select count(*)::int as n from audit_events where action like 'tenant.worship.%' and actor_user_id = ${t.fx.actingUserId}`);
      const added = await store.addPosition(viewer, { groupId: w.band, name: "Banjo", slots: 1 });
      if (added.kind !== "ok") throw new Error("setup");
      await store.updatePosition(viewer, { positionId: added.data.positionId, name: "Banjo 2", slots: 2 });
      await store.setQualifications(viewer, { groupId: w.band, personId: w.alice, positionIds: [added.data.positionId] });
      await store.retirePosition(viewer, { positionId: added.data.positionId });
      const type = await store.createServiceType(viewer, { name: "Audit type", startTime: "09:00", groupIds: [w.band] });
      if (type.kind !== "ok") throw new Error("setup");
      await store.updateServiceType(viewer, { serviceTypeId: type.data.serviceTypeId, name: "Audit type 2", startTime: "09:15" });
      await store.setServiceTypeTeams(viewer, { serviceTypeId: type.data.serviceTypeId, groupIds: [] });
      await store.retireServiceType(viewer, { serviceTypeId: type.data.serviceTypeId });
      await store.updateTeam(viewer, { groupId: w.choir, name: "Renamed choir" });
      await store.retireTeam(viewer, { groupId: w.choir });
      const after = await t.one(sql`select count(*)::int as n from audit_events where action like 'tenant.worship.%' and actor_user_id = ${t.fx.actingUserId}`);
      expect(after.n).toBe(before.n);
    });
  });

  // ===========================================================================
  // Batch 3
  // ===========================================================================

  describe("tenant.worship.response_recorded", () => {
    async function placed(w: WorshipWorld, person = w.alice, position = w.drums): Promise<string> {
      const r = await store.placePerson(t.viewer(w.scheduler, w.org), { eventId: w.sunday, groupId: w.band, positionId: position, personId: person });
      if (r.kind !== "ok") throw new Error("setup");
      return r.data.assignmentId;
    }

    it("recording an answer for someone writes one row: the assignment, the service and the answer - never a name or a reason", async () => {
      const w = await t.build("r1");
      const id = await placed(w);
      expect((await store.recordResponse(t.viewer(w.leader, w.org), { assignmentId: id, answer: "declined", reason: "family" })).kind).toBe("ok");
      const rows = await auditFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "tenant.worship.response_recorded",
        resource_type: "worship_assignment",
        resource_id: id,
        actor_user_id: t.fx.actingUserId,
        actor_email: "actor@example.invalid",
      });
      expect(rows[0]!.metadata).toEqual({ assignmentId: id, eventId: w.sunday, answer: "declined" });
      expect(JSON.stringify(rows[0])).not.toMatch(/family|Alice|Worshiptest/);
    });

    it("the same answer again writes nothing; a different one writes a second row", async () => {
      const w = await t.build("r2");
      const id = await placed(w);
      await store.recordResponse(t.viewer(w.leader, w.org), { assignmentId: id, answer: "accepted" });
      await store.recordResponse(t.viewer(w.leader, w.org), { assignmentId: id, answer: "accepted" });
      expect(await auditFor(id)).toHaveLength(1);
      await store.recordResponse(t.viewer(w.leader, w.org), { assignmentId: id, answer: "declined" });
      expect(await auditFor(id)).toHaveLength(2);
    });

    it("a refused record writes nothing, and a failed audit insert leaves the answer unrecorded", async () => {
      const w = await t.build("r3");
      const id = await placed(w);
      expect((await store.recordResponse(t.viewer(w.plain, w.org), { assignmentId: id, answer: "accepted" })).kind).toBe("forbidden");
      expect(await auditFor(id)).toHaveLength(0);
      hooks.auditFails = true;
      await expect(store.recordResponse(t.viewer(w.leader, w.org), { assignmentId: id, answer: "accepted" })).rejects.toThrow("audit store unavailable");
      hooks.auditFails = false;
      expect((await t.one(sql`select status from worship_assignments where id = ${id}`)).status).toBe("draft");
    });
  });

  describe("tenant.worship.requests_sent", () => {
    it("a Send writes ONE row with counts only, on the organization; nothing identifies a person or a position", async () => {
      const w = await t.build("s1");
      await t.email(w.alice, `alice-s1-${Date.now()}@waudit.example.invalid`);
      for (const [person, position] of [[w.alice, w.drums], [w.alice, w.vocals], [w.child, w.vocals]] as Array<[string, string]>) {
        const r = await store.placePerson(t.viewer(w.scheduler, w.org), { eventId: w.sunday, groupId: w.band, positionId: position, personId: person });
        if (r.kind !== "ok") throw new Error("setup");
      }
      const noAddr = await t.person(w.org, "Audnoaddr");
      await t.onRoster(w.org, w.band, noAddr);
      await store.placePerson(t.viewer(w.scheduler, w.org), { eventId: w.midweek, groupId: w.band, positionId: w.drums, personId: noAddr });
      const sent = await store.sendRequests(t.viewer(w.scheduler, w.org), {});
      expect(sent.kind).toBe("ok");
      const rows = await t.q(sql`select action, resource_type, resource_id, actor_user_id::text as actor_user_id, metadata from audit_events
                                  where action = 'tenant.worship.requests_sent' and resource_id = ${w.org}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ resource_type: "organization", actor_user_id: t.fx.actingUserId });
      expect(rows[0]!.metadata).toEqual({ sent: 4, emailed: 1, guardian: 1, noAddress: 1, doNotContact: 0, services: 2 });
      expect(JSON.stringify(rows[0])).not.toMatch(/Alice|Worshiptest|Drums|Vocals|@/);
    });

    it("a refused Send (nothing to send, forbidden, no origin) writes no row; a failed audit insert rolls the Send back", async () => {
      const w = await t.build("s2");
      await t.email(w.alice, `alice-s2-${Date.now()}@waudit.example.invalid`);
      const mine = () => t.q(sql`select 1 from audit_events where action = 'tenant.worship.requests_sent' and resource_id = ${w.org}`);
      expect((await store.sendRequests(t.viewer(w.scheduler, w.org), {})).kind).toBe("invalid_input");
      expect((await store.sendRequests(t.viewer(w.plain, w.org), {})).kind).toBe("forbidden");
      const placedRow = await store.placePerson(t.viewer(w.scheduler, w.org), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (placedRow.kind !== "ok") throw new Error("setup");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
      try {
        expect((await store.sendRequests(t.viewer(w.scheduler, w.org), {})).kind).toBe("conflict");
      } finally {
        vi.unstubAllEnvs();
      }
      expect(await mine()).toHaveLength(0);
      hooks.auditFails = true;
      await expect(store.sendRequests(t.viewer(w.scheduler, w.org), {})).rejects.toThrow("audit store unavailable");
      hooks.auditFails = false;
      expect((await t.one(sql`select status from worship_assignments where id = ${placedRow.data.assignmentId}`)).status).toBe("draft");
      expect(await mine()).toHaveLength(0);
    });
  });

  describe("tenant.worship.service_cancelled", () => {
    it("a failed audit insert rolls the cancel back (the change and its record commit together)", async () => {
      const w = await t.build("c1");
      await store.placePerson(t.viewer(w.scheduler, w.org), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      hooks.auditFails = true;
      await expect(store.cancelService(t.viewer(w.planner, w.org), { eventId: w.sunday })).rejects.toThrow("audit store unavailable");
      hooks.auditFails = false;
      expect((await t.one(sql`select cancelled_at from events where id = ${w.sunday}`)).cancelled_at).toBeNull();
      expect((await t.one(sql`select status from worship_assignments where event_id = ${w.sunday}`)).status).toBe("draft");
    });

    it("the metadata keys are exactly eventId, withdrawn, notified", async () => {
      const w = await t.build("c2");
      await store.placePerson(t.viewer(w.scheduler, w.org), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      await store.cancelService(t.viewer(w.planner, w.org), { eventId: w.sunday });
      const rows = await auditFor(w.sunday);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!.metadata as object).sort()).toEqual(["eventId", "notified", "withdrawn"]);
    });
  });

  describe("everything else in scheduling is unaudited, as groups are", () => {
    it("placement, guests, removal, a volunteer's own answer, blockouts and service changes write no tenant.worship row", async () => {
      const w = await t.build("u1");
      const viewer = (p: string) => t.viewer(p, w.org);
      const count = async () =>
        (await t.one(sql`select count(*)::int as n from audit_events where action like 'tenant.worship.%' and actor_user_id = ${t.fx.actingUserId}
                          and created_at > ${startedAt}::timestamptz`)).n;
      const startedAt = String((await t.one(sql`select now()::text as n`)).n);
      const placed = await store.placePerson(viewer(w.scheduler), { eventId: w.sunday, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (placed.kind !== "ok") throw new Error("setup");
      await store.placeGuest(viewer(w.scheduler), { eventId: w.sunday, groupId: w.band, positionId: w.vocals, guestName: "Visitor" });
      const second = await store.placePerson(viewer(w.scheduler), { eventId: w.midweek, groupId: w.band, positionId: w.drums, personId: w.alice });
      if (second.kind !== "ok") throw new Error("setup");
      await store.removeAssignment(viewer(w.scheduler), { assignmentId: second.data.assignmentId });
      await t.inOrg(w.org, (tx) => tx.execute(sql`update worship_assignments set status = 'requested', sent_by_person_id = ${w.scheduler}, notice_outcome = 'emailed' where id = ${placed.data.assignmentId}`));
      await store.respondToAssignment(viewer(w.alice), { assignmentId: placed.data.assignmentId, answer: "declined", reason: "work" });
      const day = String((await t.one(sql`select (presby_worship_org_today(${w.org}) + 30)::text as d`)).d);
      const blockout = await store.addBlockout(viewer(w.alice), { startsOn: day, endsOn: day });
      if (blockout.kind === "ok") await store.endBlockout(viewer(w.alice), { blockoutId: blockout.data.blockoutId });
      await store.updateService(viewer(w.planner), { eventId: w.later, title: "Edited", startsAt: "2099-01-01T09:00" });
      await store.setServiceTeams(viewer(w.planner), { eventId: w.later, groupIds: [w.band] });
      expect(await count()).toBe(0);
    });
  });
});
