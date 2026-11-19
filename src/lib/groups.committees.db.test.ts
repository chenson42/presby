/**
 * D5: the additive `groups.ts` changes for presbytery committees, on a REAL
 * Postgres connection (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3
 * "Test plan" D5; R1; DECISION-352, 357, 359).
 *
 * Pins, on throwaway fixtures:
 *   - the PRESBYTERY EXCLUSION in all nine gated functions (`listGroups`,
 *     `getGroup`, `getGroupFormOptions`, `createGroup`, `updateGroup`,
 *     `addGroupMember`, `endGroupMembership`, `setGroupMembershipPublicListed`,
 *     `setGroupMembershipPublicDisplayOrder`): a committee-type group at a
 *     presbytery is invisible and unwritable there, while a choir at the same
 *     presbytery is not, and a CONGREGATION'S committee behaves exactly as before;
 *   - `addManagedGroupSeatInTx`: a role outside `allowedRoles` throws,
 *     `endsOn` before `startsOn` is refused (equal is a zero-length row), a
 *     planned `endsOn` is stored, `overlap: "caller"` skips ONLY the open-row check
 *     and `"open_row"` is today's behaviour, the four new titles are accepted and
 *     the original three-role `addGroupMember` still refuses them;
 *   - `setManagedMembershipPublicListedInTx`: parity with the public wrapper
 *     (listed/by/at stamped, a derived row refused) with NO permission check and
 *     NO audit, while the wrapper still audits once;
 *   - `readGroupRoleGrantsInTx`: a group grant in date counts; an ended grant, a
 *     person grant, another group's grant and a grant that has not started do not;
 *     the boundary is half-open.
 *
 * The existing `groups.test.ts`, `groups.primitives.db.test.ts` and the worship
 * store tests are the other half of the pin: they run UNMODIFIED.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/groups.committees.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

// `recordAudit()` is mocked at the module boundary, as groups.test.ts does:
// `@/lib/audit` transitively imports `@/auth` (next-auth), which this test
// environment cannot resolve. The mock is also how the "InTx writes no audit"
// property is observed.
const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    GROUP_MEMBERSHIP_LISTED_PUBLICLY: "group_membership.listed_publicly",
    GROUP_MEMBERSHIP_UNLISTED_PUBLICLY: "group_membership.unlisted_publicly",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("groups.ts at a presbytery (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let groupsLib: typeof import("./groups");
  let roleGrantsLib: typeof import("./role-grants");
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let tables: typeof import("@/lib/db/domain/groups");

  let P: string; // a presbytery
  let C: string; // a congregation
  let clerkP: string; // groups.manage at P
  let clerkC: string; // groups.manage at C
  let member1: string; // a person with a membership at P (no key)
  let member2: string; // a person with a membership at P (no key)
  let memberC: string; // a person with a membership at C (no key)
  let committeeTypeId: string;
  let choirTypeId: string;
  let committeeP: string; // a committee group at the presbytery
  let choirP: string; // a choir at the presbytery
  let committeeC: string; // a committee group at the congregation
  let derivedP: string; // the presbytery's derived Active Membership group
  let seatP: string; // a group_memberships row on committeeP
  let seatC: string; // a group_memberships row on committeeC

  const platform = () => fx.platform;

  async function seat(org: string, groupId: string, personId: string, role = "member"): Promise<string> {
    const [row] = await platform()
      .insert(tables.groupMemberships)
      .values({ organizationId: org, groupId, personId, groupRole: role, source: "managed", startsOn: "2020-01-01" })
      .returning({ id: tables.groupMemberships.id });
    return row!.id;
  }

  async function newGroup(org: string, typeId: string, name: string): Promise<string> {
    const [row] = await platform()
      .insert(tables.groups)
      .values({
        organizationId: org,
        groupTypeId: typeId,
        name,
        membershipSource: "managed",
        derivedFrom: null,
        isProtected: false,
      })
      .returning({ id: tables.groups.id });
    return row!.id;
  }

  const rowsOfSeat = (id: string) =>
    platform().select().from(tables.groupMemberships).where(eq(tables.groupMemberships.id, id));

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    groupsLib = await import("./groups");
    roleGrantsLib = await import("./role-grants");
    ({ withOrgContext } = await import("@/lib/authz"));
    tables = await import("@/lib/db/domain/groups");

    fx = await createCalendarFixture("grpcmt");
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    C = await fx.makeOrg("Congregation");

    clerkP = await fx.makePerson("Cordelia", "Presbyterson");
    await fx.enroll(P, clerkP, ["groups.manage"]);
    clerkC = await fx.makePerson("Colm", "Congregationer");
    await fx.enroll(C, clerkC, ["groups.manage"]);
    member1 = await fx.makePerson("Marlow", "Memberly");
    await fx.addMember(P, member1, { roll: null });
    member2 = await fx.makePerson("Nell", "Memberly");
    await fx.addMember(P, member2, { roll: null });
    memberC = await fx.makePerson("Oriel", "Pewsitter");
    await fx.addMember(C, memberC);

    const types = await platform().select().from(tables.groupTypes);
    committeeTypeId = types.find((t) => t.key === "committee")!.id;
    choirTypeId = types.find((t) => t.key === "choir")!.id;

    committeeP = await newGroup(P, committeeTypeId, "Grp90 Presbytery Committee");
    choirP = await newGroup(P, choirTypeId, "Grp90 Presbytery Choir");
    committeeC = await newGroup(C, committeeTypeId, "Grp90 Congregation Committee");
    const [derived] = await platform()
      .select({ id: tables.groups.id })
      .from(tables.groups)
      .where(and(eq(tables.groups.organizationId, P), eq(tables.groups.derivedFrom, "active_membership")));
    derivedP = derived!.id;
    seatP = await seat(P, committeeP, member1);
    seatC = await seat(C, committeeC, memberC);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  beforeEach(() => {
    mockRecordAudit.mockClear();
  });

  // -------------------------------------------------------------------------
  describe("the presbytery exclusion in the nine gated functions", () => {
    it("listGroups: a presbytery's committee is not listed, its choir is; a congregation's committee still is", async () => {
      const atP = await groupsLib.listGroups(clerkP, P);
      if (atP.kind !== "ok") throw new Error(atP.kind);
      const idsP = atP.data.map((g) => g.groupId);
      expect(idsP).toContain(choirP);
      expect(idsP).not.toContain(committeeP);

      const atC = await groupsLib.listGroups(clerkC, C);
      if (atC.kind !== "ok") throw new Error(atC.kind);
      expect(atC.data.map((g) => g.groupId)).toContain(committeeC);
    });

    it("getGroup: a presbytery's committee id is invalid_target; its choir and a congregation's committee read as before", async () => {
      expect((await groupsLib.getGroup(clerkP, P, committeeP)).kind).toBe("invalid_target");
      expect((await groupsLib.getGroup(clerkP, P, choirP)).kind).toBe("ok");
      const c = await groupsLib.getGroup(clerkC, C, committeeC);
      if (c.kind !== "ok") throw new Error(c.kind);
      expect(c.data.roster.map((r) => r.groupMembershipId)).toContain(seatC);
    });

    it("getGroupFormOptions: no committee type at a presbytery; all four at a congregation", async () => {
      const atP = await groupsLib.getGroupFormOptions(clerkP, P);
      if (atP.kind !== "ok") throw new Error(atP.kind);
      expect(atP.data.groupTypes.map((t) => t.key).sort()).toEqual(["choir", "small_group", "team"]);
      expect(atP.data.people.length).toBeGreaterThan(0);

      const atC = await groupsLib.getGroupFormOptions(clerkC, C);
      if (atC.kind !== "ok") throw new Error(atC.kind);
      expect(atC.data.groupTypes.map((t) => t.key).sort()).toEqual(["choir", "committee", "small_group", "team"]);
    });

    it("createGroup: the committee type at a presbytery is invalid_input with the C10 sentence and writes nothing; a choir there and a committee at a congregation are created", async () => {
      const before = await platform().select({ id: tables.groups.id }).from(tables.groups).where(eq(tables.groups.organizationId, P));
      const refused = await groupsLib.createGroup(clerkP, P, { groupTypeId: committeeTypeId, name: "Grp90 Hand-built" });
      expect(refused).toEqual({
        kind: "invalid_input",
        message: "Committees at a presbytery are kept under Committees & Commissions.",
      });
      const after = await platform().select({ id: tables.groups.id }).from(tables.groups).where(eq(tables.groups.organizationId, P));
      expect(after).toHaveLength(before.length);

      expect((await groupsLib.createGroup(clerkP, P, { groupTypeId: choirTypeId, name: "Grp90 Second Choir" })).kind).toBe("ok");
      expect((await groupsLib.createGroup(clerkC, C, { groupTypeId: committeeTypeId, name: "Grp90 New Cong Committee" })).kind).toBe("ok");
    });

    it("updateGroup: a presbytery's committee is invalid_target and keeps its name; its choir and a congregation's committee are edited", async () => {
      expect((await groupsLib.updateGroup(clerkP, P, { groupId: committeeP, name: "Grp90 Renamed" })).kind).toBe("invalid_target");
      const [row] = await platform().select().from(tables.groups).where(eq(tables.groups.id, committeeP));
      expect(row!.name).toBe("Grp90 Presbytery Committee");

      expect((await groupsLib.updateGroup(clerkP, P, { groupId: choirP, name: "Grp90 Presbytery Choir" })).kind).toBe("ok");
      expect((await groupsLib.updateGroup(clerkC, C, { groupId: committeeC, name: "Grp90 Congregation Committee" })).kind).toBe("ok");
    });

    it("addGroupMember: a presbytery's committee is invalid_target and gains no row; its choir and a congregation's committee accept a member", async () => {
      const before = await platform().select({ id: tables.groupMemberships.id }).from(tables.groupMemberships).where(eq(tables.groupMemberships.groupId, committeeP));
      const refused = await groupsLib.addGroupMember(clerkP, P, {
        groupId: committeeP,
        personId: member2,
        groupRole: "member",
        startsOn: "2024-01-01",
      });
      expect(refused.kind).toBe("invalid_target");
      const after = await platform().select({ id: tables.groupMemberships.id }).from(tables.groupMemberships).where(eq(tables.groupMemberships.groupId, committeeP));
      expect(after).toHaveLength(before.length);

      const choirSeat = await groupsLib.addGroupMember(clerkP, P, { groupId: choirP, personId: member2, groupRole: "member", startsOn: "2024-01-01" });
      expect(choirSeat.kind).toBe("ok");
      const seatAtC = await groupsLib.addGroupMember(clerkC, C, { groupId: committeeC, personId: clerkC, groupRole: "chair", startsOn: "2024-01-01" });
      expect(seatAtC.kind).toBe("ok");
    });

    it("endGroupMembership: a seat of a presbytery's committee is invalid_target and stays open; a congregation's seat is ended", async () => {
      expect((await groupsLib.endGroupMembership(clerkP, P, { groupMembershipId: seatP, endsOn: "2024-06-01" })).kind).toBe("invalid_target");
      expect((await rowsOfSeat(seatP))[0]!.endsOn).toBeNull();

      const other = await seat(C, committeeC, clerkC);
      const ended = await groupsLib.endGroupMembership(clerkC, C, { groupMembershipId: other, endsOn: "2024-06-01" });
      expect(ended.kind).toBe("ok");
      expect((await rowsOfSeat(other))[0]!.endsOn).toBe("2024-06-01");
    });

    it("setGroupMembershipPublicListed: a presbytery committee seat is invalid_target, unchanged and unaudited; a congregation's seat lists and audits", async () => {
      const refused = await groupsLib.setGroupMembershipPublicListed(clerkP, P, fx.actingUserId, { groupMembershipId: seatP, publicListed: true });
      expect(refused.kind).toBe("invalid_target");
      expect((await rowsOfSeat(seatP))[0]!.publicListed).toBe(false);
      expect(mockRecordAudit).not.toHaveBeenCalled();

      const ok = await groupsLib.setGroupMembershipPublicListed(clerkC, C, fx.actingUserId, { groupMembershipId: seatC, publicListed: true });
      expect(ok.kind).toBe("ok");
      expect((await rowsOfSeat(seatC))[0]!.publicListed).toBe(true);
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    });

    it("setGroupMembershipPublicDisplayOrder: a presbytery committee seat is invalid_target; a congregation's seat takes an order", async () => {
      expect((await groupsLib.setGroupMembershipPublicDisplayOrder(clerkP, P, { groupMembershipId: seatP, publicDisplayOrder: 3 })).kind).toBe("invalid_target");
      expect((await rowsOfSeat(seatP))[0]!.publicDisplayOrder).toBeNull();
      expect((await groupsLib.setGroupMembershipPublicDisplayOrder(clerkC, C, { groupMembershipId: seatC, publicDisplayOrder: 3 })).kind).toBe("ok");
      expect((await rowsOfSeat(seatC))[0]!.publicDisplayOrder).toBe(3);
    });

    it("every gated function is still forbidden without groups.manage (the exclusion comes AFTER the key)", async () => {
      expect((await groupsLib.listGroups(member1, P)).kind).toBe("forbidden");
      expect((await groupsLib.getGroup(member1, P, committeeP)).kind).toBe("forbidden");
      expect((await groupsLib.getGroupFormOptions(member1, P)).kind).toBe("forbidden");
      expect((await groupsLib.createGroup(member1, P, { groupTypeId: committeeTypeId, name: "x" })).kind).toBe("forbidden");
      expect((await groupsLib.updateGroup(member1, P, { groupId: committeeP, name: "x" })).kind).toBe("forbidden");
      expect((await groupsLib.addGroupMember(member1, P, { groupId: committeeP, personId: member2, groupRole: "member", startsOn: "2024-01-01" })).kind).toBe("forbidden");
      expect((await groupsLib.endGroupMembership(member1, P, { groupMembershipId: seatP, endsOn: "2024-06-01" })).kind).toBe("forbidden");
    });

    it("the InTx primitives are NOT restricted: the committees store reaches a presbytery committee through them", async () => {
      const result = await withOrgContext(member1, P, (tx) =>
        groupsLib.addManagedGroupSeatInTx(
          tx,
          P,
          { groupId: committeeP, personId: member2, groupRole: "vice_chair", startsOn: "2024-02-01" },
          { allowedRoles: ["vice_chair"], overlap: "caller" },
        ),
      );
      expect(result.kind).toBe("ok");
      const ended = await withOrgContext(member1, P, (tx) =>
        groupsLib.endManagedGroupMemberInTx(tx, P, {
          groupMembershipId: (result as { data: { groupMembershipId: string } }).data.groupMembershipId,
          endsOn: "2024-03-01",
        }),
      );
      expect(ended.kind).toBe("ok");
    });
  });

  // -------------------------------------------------------------------------
  describe("addManagedGroupSeatInTx", () => {
    const add = (
      input: Partial<import("./groups").AddManagedGroupSeatInput> & { personId: string },
      options: import("./groups").AddManagedGroupSeatOptions = { allowedRoles: ["chair", "vice_chair", "clerk", "secretary", "ex_officio", "member"], overlap: "caller" },
    ) =>
      withOrgContext(clerkP, P, (tx) =>
        groupsLib.addManagedGroupSeatInTx(
          tx,
          P,
          { groupId: committeeP, groupRole: "member", startsOn: "2023-01-01", ...input },
          options,
        ),
      );

    it("a role outside allowedRoles THROWS (a call-shape defect), and writes nothing", async () => {
      await expect(add({ personId: member2, groupRole: "leader" })).rejects.toThrow(/not allowed/);
      await expect(
        add({ personId: member2, groupRole: "clerk" }, { allowedRoles: ["member"], overlap: "caller" }),
      ).rejects.toThrow(/not allowed/);
    });

    it("a malformed date throws; endsOn before startsOn is invalid_input; equal is a zero-length row", async () => {
      await expect(add({ personId: member2, startsOn: "01/01/2023" })).rejects.toThrow(/startsOn/);
      await expect(add({ personId: member2, endsOn: "soon" })).rejects.toThrow(/endsOn/);
      const refused = await add({ personId: member2, startsOn: "2023-05-01", endsOn: "2023-04-30" });
      expect(refused).toEqual({ kind: "invalid_input", message: "The end date can't be before the start date." });

      const zero = await add({ personId: member2, startsOn: "2023-05-01", endsOn: "2023-05-01" });
      if (zero.kind !== "ok") throw new Error(zero.kind);
      const [row] = await rowsOfSeat(zero.data.groupMembershipId);
      expect(row).toMatchObject({ startsOn: "2023-05-01", endsOn: "2023-05-01" });
    });

    it("stores a planned end, a title role and the managed source; a null or absent endsOn is open", async () => {
      const planned = await add({ personId: member2, groupRole: "secretary", startsOn: "2023-06-01", endsOn: "2030-06-01" });
      if (planned.kind !== "ok") throw new Error(planned.kind);
      expect((await rowsOfSeat(planned.data.groupMembershipId))[0]).toMatchObject({
        groupRole: "secretary",
        startsOn: "2023-06-01",
        endsOn: "2030-06-01",
        source: "managed",
      });
      const open = await add({ personId: member2, groupRole: "ex_officio", startsOn: "2023-07-01", endsOn: null });
      if (open.kind !== "ok") throw new Error(open.kind);
      expect((await rowsOfSeat(open.data.groupMembershipId))[0]!.endsOn).toBeNull();
    });

    it('overlap: "caller" skips ONLY the open-row check; "open_row" is today\'s behaviour and the default of the existing callers', async () => {
      const first = await add({ personId: member2, startsOn: "2022-01-01", endsOn: null });
      expect(first.kind).toBe("ok");
      // A second open row for the same person: "caller" lets the caller's own interval check decide ...
      const second = await add({ personId: member2, startsOn: "2022-02-01", endsOn: null });
      expect(second.kind).toBe("ok");
      // ... "open_row" refuses it, naming the person and the group.
      const refused = await add({ personId: member2, startsOn: "2022-03-01" }, { allowedRoles: ["member"], overlap: "open_row" });
      expect(refused).toMatchObject({ kind: "overlap", groupName: "Grp90 Presbytery Committee" });
      expect((refused as { personName: string }).personName).toContain("Nell");
      // "caller" still checks the group and the person: a person with no membership here is refused.
      expect((await add({ personId: memberC })).kind).toBe("invalid_target");
    });

    it("the original addGroupMember (three roles) still throws for a title it never offered, and its open-row check still holds", async () => {
      await expect(
        groupsLib.addGroupMember(clerkC, C, {
          groupId: committeeC,
          personId: memberC,
          groupRole: "clerk" as never,
          startsOn: "2024-01-01",
        }),
      ).rejects.toThrow(/unrecognized groupRole/);
      const repeat = await groupsLib.addGroupMember(clerkC, C, {
        groupId: committeeC,
        personId: memberC,
        groupRole: "member",
        startsOn: "2024-02-01",
      });
      expect(repeat.kind).toBe("overlap");
    });

    it("a derived group is invalid_target", async () => {
      const refused = await withOrgContext(clerkP, P, (tx) =>
        groupsLib.addManagedGroupSeatInTx(
          tx,
          P,
          { groupId: derivedP, personId: member1, groupRole: "member", startsOn: "2024-01-01" },
          { allowedRoles: ["member"], overlap: "caller" },
        ),
      );
      expect(refused.kind).toBe("invalid_target");
    });
  });

  // -------------------------------------------------------------------------
  describe("setManagedMembershipPublicListedInTx", () => {
    it("lists and unlists, stamping who and when on every call, with NO permission check and NO audit", async () => {
      const seatId = await seat(P, committeeP, member2);
      // member1 holds no groups.manage: the InTx primitive checks no key (its caller has).
      const on = await withOrgContext(member1, P, (tx) =>
        groupsLib.setManagedMembershipPublicListedInTx(tx, P, fx.actingUserId, { groupMembershipId: seatId, publicListed: true }),
      );
      expect(on).toEqual({ kind: "ok", data: { groupMembershipId: seatId, publicListed: true } });
      let [row] = await rowsOfSeat(seatId);
      expect(row).toMatchObject({ publicListed: true, publicListedBy: fx.actingUserId });
      expect(row!.publicListedAt).toBeInstanceOf(Date);

      const off = await withOrgContext(member1, P, (tx) =>
        groupsLib.setManagedMembershipPublicListedInTx(tx, P, fx.actingUserId, { groupMembershipId: seatId, publicListed: false }),
      );
      expect(off.kind).toBe("ok");
      [row] = await rowsOfSeat(seatId);
      expect(row!.publicListed).toBe(false);
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("parity with the public wrapper: the same write at a congregation, plus exactly one audit from the wrapper", async () => {
      const seatId = await seat(C, committeeC, clerkC);
      const wrapper = await groupsLib.setGroupMembershipPublicListed(clerkC, C, fx.actingUserId, { groupMembershipId: seatId, publicListed: true });
      expect(wrapper).toEqual({ kind: "ok", data: { groupMembershipId: seatId, publicListed: true } });
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      const viaWrapper = (await rowsOfSeat(seatId))[0]!;

      const seat2 = await seat(C, committeeC, memberC, "member");
      const inTx = await withOrgContext(clerkC, C, (tx) =>
        groupsLib.setManagedMembershipPublicListedInTx(tx, C, fx.actingUserId, { groupMembershipId: seat2, publicListed: true }),
      );
      expect(inTx.kind).toBe("ok");
      const viaInTx = (await rowsOfSeat(seat2))[0]!;
      expect({ listed: viaInTx.publicListed, by: viaInTx.publicListedBy }).toEqual({ listed: viaWrapper.publicListed, by: viaWrapper.publicListedBy });
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    });

    it("a derived row, another organization's row and a nonexistent id are invalid_target", async () => {
      const [derivedRow] = await platform().select({ id: tables.groupMemberships.id }).from(tables.groupMemberships).where(eq(tables.groupMemberships.groupId, derivedP)).limit(1);
      const cases = [derivedRow?.id, seatC, "00000000-0000-4000-8000-000000000000"].filter(Boolean) as string[];
      for (const id of cases) {
        const result = await withOrgContext(clerkP, P, (tx) =>
          groupsLib.setManagedMembershipPublicListedInTx(tx, P, fx.actingUserId, { groupMembershipId: id, publicListed: true }),
        );
        expect(result.kind, id).toBe("invalid_target");
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("readGroupRoleGrantsInTx", () => {
    let roleA: string;
    let roleB: string;
    let otherGroup: string;

    async function grantToGroup(roleId: string, groupId: string, startsOn: string, endsOn: string | null) {
      await platform().insert((await import("@/lib/db/domain/authz")).roleGrants).values({
        organizationId: P,
        roleId,
        groupId,
        startsOn,
        endsOn,
        grantedBy: fx.actingUserId,
      });
    }

    beforeAll(async () => {
      roleA = await fx.makeRole(P, "grp90_role_a", ["directory.view"]);
      roleB = await fx.makeRole(P, "grp90_role_b", ["tickets.file"]);
      otherGroup = await newGroup(P, committeeTypeId, "Grp90 Other Committee");
      await grantToGroup(roleA, committeeP, "2020-01-01", null); // in date
      await grantToGroup(roleB, committeeP, "2020-01-01", "2024-01-01"); // ended
      await grantToGroup(roleB, otherGroup, "2020-01-01", null); // another group's
      await fx.grant(P, roleB, member1); // a PERSON grant
    });

    const read = (groupId: string, asOf: string) =>
      withOrgContext(member1, P, (tx) => roleGrantsLib.readGroupRoleGrantsInTx(tx, P, groupId, asOf));

    it("returns the roles granted to THE GROUP in date, by name, and checks no permission", async () => {
      const result = await read(committeeP, "2026-01-01");
      expect(result.carriedRoles).toEqual([{ id: roleA, name: "grp90_role_a" }]);
    });

    it("excludes an ended grant, a person grant, another group's grant and a grant that has not started", async () => {
      expect((await read(committeeP, "2026-01-01")).carriedRoles.map((r) => r.id)).not.toContain(roleB);
      expect((await read(otherGroup, "2026-01-01")).carriedRoles.map((r) => r.id)).toEqual([roleB]);
      expect((await read(committeeP, "2019-12-31")).carriedRoles).toEqual([]);
    });

    it("the boundary is half-open: starts_on is in, ends_on is out", async () => {
      expect((await read(committeeP, "2020-01-01")).carriedRoles.map((r) => r.id)).toContain(roleA);
      // roleB on committeeP ends 2024-01-01: serving the day before, not on the day.
      expect((await read(committeeP, "2023-12-31")).carriedRoles.map((r) => r.id).sort()).toEqual([roleA, roleB].sort());
      expect((await read(committeeP, "2024-01-01")).carriedRoles.map((r) => r.id)).toEqual([roleA]);
    });

    it("a group with no grant carries nothing, and a malformed date throws", async () => {
      expect((await read(choirP, "2026-01-01")).carriedRoles).toEqual([]);
      await expect(read(committeeP, "01/01/2026")).rejects.toThrow(/asOf/);
    });

    it("never reads across organizations: the same group id asked from another organization is empty", async () => {
      const result = await withOrgContext(clerkC, C, (tx) => roleGrantsLib.readGroupRoleGrantsInTx(tx, C, committeeP, "2026-01-01"));
      expect(result.carriedRoles).toEqual([]);
    });
  });
});

// Keep the `sql` import used even if a refactor removes the last raw query.
void sql;
