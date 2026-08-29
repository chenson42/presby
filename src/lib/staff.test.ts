/**
 * Integration tests for src/lib/staff.ts — run against a REAL Postgres
 * connection, not mocked. Follows `src/lib/officers.test.ts`'s exact harness:
 * the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./staff` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file rather than
 * mutating `scripts/seed-dev.sql`'s fixture ids.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/staff.test.ts
 *
 * TWO ORGANIZATIONS:
 *   orgA — the general-purpose fixture: `staff.manage` bound to a test role,
 *          people holding it and not holding it, a current member (position
 *          target), a lapsed member, and a dedicated F22-regression person.
 *   orgB — exists ONLY to prove cross-org isolation: a person and a
 *          `staff_positions` row that exist, but only at orgB, never at
 *          orgA.
 *
 * THE F22-SHAPED REGRESSION BLOCK (`describe("F22-shaped overlap...")`
 * below) IS THE MOST IMPORTANT BLOCK IN THIS FILE — direct port of
 * `officers.test.ts`'s own top-priority assertion, applied to
 * `staff_positions_no_overlap`: same person/org/`positionKey`, two
 * non-consecutive open-then-ended-then-reopened positions stay independent
 * rows, a case-only title variant DOES collide (positionKey normalization),
 * and a genuinely different title does NOT collide even with fully
 * overlapping dates.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, and, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

// `recordAudit()` is mocked at the module boundary — same posture and same
// reason `children.test.ts`/`person-sensitive.test.ts` document: `@/lib/audit`
// transitively imports `@/auth` (next-auth), which this test environment
// cannot resolve. Only exercised by the `setStaffPositionPublicListed`
// describe block below; every other describe block in this file never
// touches an audited code path.
const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    STAFF_POSITION_LISTED_PUBLICLY: "staff_position.listed_publicly",
    STAFF_POSITION_UNLISTED_PUBLICLY: "staff_position.unlisted_publicly",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("staff.ts (Postgres-backed, real dev database)", () => {
  let listStaffRoster: typeof import("./staff").listStaffRoster;
  let getStaffHistory: typeof import("./staff").getStaffHistory;
  let getStaffFormOptions: typeof import("./staff").getStaffFormOptions;
  let startStaffPosition: typeof import("./staff").startStaffPosition;
  let endStaffPosition: typeof import("./staff").endStaffPosition;
  let setStaffPositionPublicListed: typeof import("./staff").setStaffPositionPublicListed;
  let setStaffPositionPublicDisplayOrder: typeof import("./staff").setStaffPositionPublicDisplayOrder;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let staffPositions: typeof import("@/lib/db/domain/staff").staffPositions;
  let users: typeof import("@/lib/db/schema").users;

  const stamp = Date.now();

  let orgA: string;
  let orgB: string;

  let staffAdminRoleA: string; // carries staff.manage

  let staffAdminPerson: string; // orgA — holds staff.manage
  let narrowPerson: string; // orgA — holds nothing
  let targetPerson: string; // orgA — current membership, no grant, position target
  let lapsedPerson: string; // orgA — membership ended
  let f22Person: string; // orgA — dedicated to the F22-shaped regression block ONLY

  let outsidePerson: string; // orgB only — cross-org invalid_target
  let noMembershipPerson: string; // no membership ANYWHERE — cross-org throw

  let grantingUserId: string; // a users.id row for recordedBy

  beforeAll(async () => {
    ({
      listStaffRoster,
      getStaffHistory,
      getStaffFormOptions,
      startStaffPosition,
      endStaffPosition,
      setStaffPositionPublicListed,
      setStaffPositionPublicDisplayOrder,
    } = await import("./staff"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ staffPositions } = await import("@/lib/db/domain/staff"));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for staff.test.ts`,
          slug: `staff-test-${label.toLowerCase()}-${stamp}`,
          path: `staff_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }
    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    // F16: any `memberships` insert requires an active_membership derived
    // group to already exist for the org.
    const [gt] = await platform
      .insert(groupTypes)
      .values({ organizationId: null, key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    let rosterTypeId = gt?.id;
    if (!rosterTypeId) {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, "roster"))
        .limit(1);
      rosterTypeId = existing!.id;
    }
    async function activeMembershipGroup(organizationId: string) {
      await platform.insert(groups).values({
        organizationId,
        groupTypeId: rosterTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });
    }
    await activeMembershipGroup(orgA);
    await activeMembershipGroup(orgB);

    // Permission catalog — already seeded by drizzle/0039 in a real dev
    // database, but onConflictDoNothing keeps this file self-sufficient.
    await platform
      .insert(permissions)
      .values({
        key: "staff.manage",
        module: "staff",
        description:
          "Record and end paid, non-ordained staff positions for this organization",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [userRow] = await platform
      .insert(users)
      .values({
        email: `staff-test-granter-${stamp}@example.invalid`,
        name: "Staff Test Granter",
      })
      .returning({ id: users.id });
    grantingUserId = userRow!.id;

    // --- orgA: the general-purpose fixture -----------------------------

    const [roleRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "staff_admin_test",
        name: "Personnel Administrator (test)",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    staffAdminRoleA = roleRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: staffAdminRoleA, permissionKey: "staff.manage" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }

    staffAdminPerson = await person("Marisol", "Windham");
    narrowPerson = await person("Idris", "Calloway");
    targetPerson = await person("Saoirse", "Delacroix-Nwosu");
    lapsedPerson = await person("Bartholomew", "Achterberg");
    f22Person = await person("Thaddeus", "Vantongeren-Whitlock");

    async function membership(
      organizationId: string,
      personId: string,
      endedOn: string | null = null,
    ) {
      await platform.insert(memberships).values({
        organizationId,
        personId,
        engagementStatus: "regular",
        endedOn,
      });
    }

    await membership(orgA, staffAdminPerson);
    await membership(orgA, narrowPerson);
    await membership(orgA, targetPerson);
    await membership(orgA, lapsedPerson);
    await membership(orgA, f22Person);

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: staffAdminRoleA,
      personId: staffAdminPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });

    // Same narrowly-scoped, try/finally-guarded trigger disable
    // role-grants.test.ts/officers.test.ts use for their own lapsed-member
    // fixture — never done in application code.
    await platform.execute(sql`
      alter table memberships disable trigger memberships_guard_end
    `);
    try {
      await platform
        .update(memberships)
        .set({ endedOn: "2021-06-15" })
        .where(eq(memberships.personId, lapsedPerson));
    } finally {
      await platform.execute(sql`
        alter table memberships enable trigger memberships_guard_end
      `);
    }

    // --- orgB: cross-org isolation fixture ------------------------------

    outsidePerson = await person("Zinaida", "Okonkwo-Reyes");
    await membership(orgB, outsidePerson);

    noMembershipPerson = await person("Cosima", "Braithwaite-Ashworth");
    // Deliberately no membership row anywhere for noMembershipPerson.
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    const allPeople = [
      staffAdminPerson,
      narrowPerson,
      targetPerson,
      lapsedPerson,
      f22Person,
      outsidePerson,
      noMembershipPerson,
    ].filter(Boolean);

    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      await platform.delete(organizations).where(eq(organizations.id, orgA));
      await platform.delete(organizations).where(eq(organizations.id, orgB));
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    for (const id of allPeople) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, grantingUserId));
  });

  // ---------------------------------------------------------------------
  // Permission gate — every exported function, checked first
  // ---------------------------------------------------------------------

  describe("permission gate — staff.manage checked before any read or write", () => {
    it("listStaffRoster: forbidden for a person holding no staff.manage", async () => {
      const result = await listStaffRoster(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getStaffHistory: forbidden for a person holding no staff.manage", async () => {
      const result = await getStaffHistory(narrowPerson, orgA, targetPerson);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getStaffFormOptions: forbidden for a person holding no staff.manage", async () => {
      const result = await getStaffFormOptions(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("startStaffPosition: forbidden for a person holding no staff.manage, AND NOTHING IS WRITTEN", async () => {
      const result = await startStaffPosition(
        narrowPerson,
        orgA,
        grantingUserId,
        {
          personId: targetPerson,
          position: `Should Never Exist ${stamp}`,
          startsOn: "2026-01-01",
        },
      );
      expect(result).toEqual({ kind: "forbidden" });

      const platform = getPlatformDb();
      const rows = await platform
        .select({ id: staffPositions.id })
        .from(staffPositions)
        .where(eq(staffPositions.position, `Should Never Exist ${stamp}`));
      expect(rows).toHaveLength(0);
    });

    it("endStaffPosition: forbidden for a person holding no staff.manage", async () => {
      const result = await endStaffPosition(narrowPerson, orgA, {
        positionId: "00000000-0000-0000-0000-000000000000",
        endsOn: "2026-01-01",
        endReason: "Should never run",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("setStaffPositionPublicListed: forbidden for a person holding no staff.manage, AND NO AUDIT FIRES", async () => {
      const result = await setStaffPositionPublicListed(
        narrowPerson,
        orgA,
        grantingUserId,
        { positionId: "00000000-0000-0000-0000-000000000000", publicListed: true },
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // getStaffFormOptions — F21 shape
  // ---------------------------------------------------------------------

  describe("getStaffFormOptions", () => {
    it("lists only CURRENT members of THIS org — excludes a lapsed member and a cross-org person", async () => {
      const result = await getStaffFormOptions(staffAdminPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const ids = result.data.people.map((p) => p.personId);
      expect(ids).toEqual(
        expect.arrayContaining([staffAdminPerson, narrowPerson, targetPerson, f22Person]),
      );
      expect(ids).not.toContain(lapsedPerson);
      expect(ids).not.toContain(outsidePerson);
    });
  });

  // ---------------------------------------------------------------------
  // startStaffPosition
  // ---------------------------------------------------------------------

  describe("startStaffPosition", () => {
    it("happy path creates an open-ended position", async () => {
      const result = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Church Secretary ${stamp}`,
        department: "Administration",
        startsOn: "2020-01-01",
        minuteReference: "Session 2020-01-01, item 4",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(staffPositions)
        .where(eq(staffPositions.id, result.data.positionId));
      expect(row).toMatchObject({
        organizationId: orgA,
        personId: targetPerson,
        position: `Church Secretary ${stamp}`,
        positionKey: `church secretary ${stamp}`.toLowerCase(),
        department: "Administration",
        startsOn: "2020-01-01",
        endsOn: null,
        minuteReference: "Session 2020-01-01, item 4",
        recordedBy: grantingUserId,
      });
    });

    it("invalid_target for a person with no CURRENT membership at this org (lapsed member)", async () => {
      const result = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: lapsedPerson,
        position: "Bookkeeper",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target for a person who belongs only to a DIFFERENT org", async () => {
      const result = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: outsidePerson,
        position: "Bookkeeper",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_input for a blank position", async () => {
      const result = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: "   ",
        startsOn: "2026-01-01",
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("throws on a malformed startsOn shape", async () => {
      await expect(
        startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
          personId: targetPerson,
          position: "Custodian",
          startsOn: "01/01/2026",
        }),
      ).rejects.toThrow(/startsOn must be 'YYYY-MM-DD'/);
    });
  });

  // ---------------------------------------------------------------------
  // endStaffPosition
  // ---------------------------------------------------------------------

  describe("endStaffPosition", () => {
    it("happy path sets endsOn/endReason on the EXISTING row — never a delete", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Part-Time Custodian ${stamp}`,
        startsOn: "2022-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await endStaffPosition(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        endsOn: "2023-06-30",
        endReason: "Position eliminated in budget cut",
      });
      expect(result).toEqual({
        kind: "ok",
        data: { positionId: started.data.positionId },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select()
        .from(staffPositions)
        .where(eq(staffPositions.id, started.data.positionId));
      expect(row).toMatchObject({
        endsOn: "2023-06-30",
        endReason: "Position eliminated in budget cut",
      });
    });

    it("invalid_target for a positionId that doesn't exist", async () => {
      const result = await endStaffPosition(staffAdminPerson, orgA, {
        positionId: "00000000-0000-0000-0000-000000000000",
        endsOn: "2026-01-01",
        endReason: "n/a",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_input when endsOn precedes startsOn", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Nursery Attendant ${stamp}`,
        startsOn: "2024-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await endStaffPosition(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        endsOn: "2023-01-01",
        endReason: "n/a",
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("throws on a malformed endsOn shape", async () => {
      await expect(
        endStaffPosition(staffAdminPerson, orgA, {
          positionId: "00000000-0000-0000-0000-000000000000",
          endsOn: "not-a-date",
          endReason: "n/a",
        }),
      ).rejects.toThrow(/endsOn must be 'YYYY-MM-DD'/);
    });
  });

  // ---------------------------------------------------------------------
  // F22-shaped overlap regression — the highest-priority block in this file
  // ---------------------------------------------------------------------

  describe("F22-shaped overlap regression (staff_positions_no_overlap)", () => {
    it("same person/org/title, overlapping open range: rejected as `overlap`, nothing written twice", async () => {
      const first = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: f22Person,
        position: `Secretary ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(first.kind).toBe("ok");

      const second = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: f22Person,
        position: `Secretary ${stamp}`,
        startsOn: "2021-01-01",
      });
      expect(second.kind).toBe("overlap");
    });

    it("a CASE-ONLY title variant collides too — positionKey normalization", async () => {
      const result = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: f22Person,
        position: `SECRETARY ${stamp}`,
        startsOn: "2021-06-01",
      });
      expect(result.kind).toBe("overlap");
    });

    it("a genuinely DIFFERENT title for the SAME person, fully overlapping dates: succeeds", async () => {
      const result = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: f22Person,
        position: `Choir Director ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(result.kind).toBe("ok");
    });

    it("ending the open Secretary position, then starting a NEW non-consecutive Secretary term: two independent rows", async () => {
      const platform = getPlatformDb();
      const [openRow] = await platform
        .select({ id: staffPositions.id })
        .from(staffPositions)
        .where(
          and(
            eq(staffPositions.organizationId, orgA),
            eq(staffPositions.personId, f22Person),
            eq(staffPositions.positionKey, `secretary ${stamp}`.toLowerCase()),
          ),
        )
        .limit(1);
      expect(openRow).toBeDefined();

      const ended = await endStaffPosition(staffAdminPerson, orgA, {
        positionId: openRow!.id,
        endsOn: "2022-12-31",
        endReason: "Retired",
      });
      expect(ended.kind).toBe("ok");

      const reopened = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: f22Person,
        position: `Secretary ${stamp}`,
        startsOn: "2023-01-01",
      });
      expect(reopened.kind).toBe("ok");
      if (reopened.kind !== "ok") return;
      expect(reopened.data.positionId).not.toBe(openRow!.id);

      const rows = await platform
        .select({ id: staffPositions.id, startsOn: staffPositions.startsOn, endsOn: staffPositions.endsOn })
        .from(staffPositions)
        .where(
          and(
            eq(staffPositions.organizationId, orgA),
            eq(staffPositions.personId, f22Person),
            eq(staffPositions.positionKey, `secretary ${stamp}`.toLowerCase()),
          ),
        );
      // The original (now ended) + the case-only-variant rejection wrote
      // nothing extra + the reopened row = exactly TWO rows for this key.
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === openRow!.id)?.endsOn).toBe("2022-12-31");
      expect(rows.find((r) => r.id === reopened.data.positionId)?.endsOn).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // listStaffRoster — includeEnded toggle
  // ---------------------------------------------------------------------

  describe("listStaffRoster", () => {
    /**
     * Uses `targetPerson`, NOT `f22Person` — by this point in the file,
     * `f22Person`'s own "Secretary" position has been ended and REOPENED by
     * the F22-shaped regression block above (a legitimate, expected mutation
     * for that block's own purpose), so it is no longer a clean fixture for
     * "one ended, one open" in isolation. `targetPerson`'s own three
     * positions from the `startStaffPosition`/`endStaffPosition` describe
     * blocks above give exactly that shape without depending on cross-
     * describe-block execution order: "Church Secretary" (open, from the
     * `startStaffPosition` happy-path test), "Part-Time Custodian" (ended,
     * from the `endStaffPosition` happy-path test), and "Nursery Attendant"
     * (open — its own `endStaffPosition` call was REJECTED as
     * `invalid_input`, so the row was never actually ended).
     */
    it("excludes ended positions by default; includes them with includeEnded: true", async () => {
      const defaultResult = await listStaffRoster(staffAdminPerson, orgA);
      expect(defaultResult.kind).toBe("ok");
      if (defaultResult.kind !== "ok") return;
      const defaultPositions = defaultResult.data
        .filter((entry) => entry.personId === targetPerson)
        .map((entry) => entry.position);
      expect(defaultPositions).toEqual(
        expect.arrayContaining([`Church Secretary ${stamp}`, `Nursery Attendant ${stamp}`]),
      );
      expect(defaultPositions).not.toContain(`Part-Time Custodian ${stamp}`);

      const allResult = await listStaffRoster(staffAdminPerson, orgA, {
        includeEnded: true,
      });
      expect(allResult.kind).toBe("ok");
      if (allResult.kind !== "ok") return;
      const allPositions = allResult.data
        .filter((entry) => entry.personId === targetPerson)
        .map((entry) => entry.position);
      expect(allPositions).toEqual(
        expect.arrayContaining([
          `Church Secretary ${stamp}`,
          `Part-Time Custodian ${stamp}`,
          `Nursery Attendant ${stamp}`,
        ]),
      );
    });
  });

  // ---------------------------------------------------------------------
  // getStaffHistory
  // ---------------------------------------------------------------------

  describe("getStaffHistory", () => {
    it("invalid_target for a person who never held a membership at this org", async () => {
      const result = await getStaffHistory(staffAdminPerson, orgA, noMembershipPerson);
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("returns every position (open and ended) for a person who has multiple", async () => {
      const result = await getStaffHistory(staffAdminPerson, orgA, f22Person);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const positions = result.data.map((entry) => entry.position);
      expect(positions).toEqual(
        expect.arrayContaining([`Secretary ${stamp}`, `Choir Director ${stamp}`]),
      );
      // Exactly two Secretary rows (the ended original + the reopened one) —
      // the case-only-variant attempt was rejected and wrote nothing.
      expect(positions.filter((p) => p === `Secretary ${stamp}`)).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------
  // setStaffPositionPublicListed — public staff directory opt-in/opt-out
  // (docs/work-log/2026-08-27-public-staff-directory.md, Phase 3)
  // ---------------------------------------------------------------------

  describe("setStaffPositionPublicListed", () => {
    afterAll(() => {
      mockRecordAudit.mockClear();
    });

    it("invalid_target for a positionId that doesn't exist", async () => {
      const result = await setStaffPositionPublicListed(
        staffAdminPerson,
        orgA,
        grantingUserId,
        { positionId: "00000000-0000-0000-0000-000000000000", publicListed: true },
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("invalid_target for a position belonging to a DIFFERENT org", async () => {
      const platform = getPlatformDb();
      const [crossOrgPosition] = await platform
        .insert(staffPositions)
        .values({
          organizationId: orgB,
          personId: outsidePerson,
          position: `Cross-Org Position ${stamp}`,
          positionKey: `cross-org position ${stamp}`.toLowerCase(),
          startsOn: "2020-01-01",
          recordedBy: grantingUserId,
        })
        .returning({ id: staffPositions.id });

      const result = await setStaffPositionPublicListed(
        staffAdminPerson,
        orgA,
        grantingUserId,
        { positionId: crossOrgPosition!.id, publicListed: true },
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("ON: sets publicListed/publicListedBy/publicListedAt and records STAFF_POSITION_LISTED_PUBLICLY", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Public Listing Test ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      mockRecordAudit.mockClear();
      const result = await setStaffPositionPublicListed(
        staffAdminPerson,
        orgA,
        grantingUserId,
        { positionId: started.data.positionId, publicListed: true },
      );
      expect(result).toEqual({
        kind: "ok",
        data: { positionId: started.data.positionId, publicListed: true },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith({
        action: "staff_position.listed_publicly",
        resourceType: "staff_position",
        resourceId: started.data.positionId,
        metadata: { organizationId: orgA, publicListed: true },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({
          publicListed: staffPositions.publicListed,
          publicListedBy: staffPositions.publicListedBy,
          publicListedAt: staffPositions.publicListedAt,
        })
        .from(staffPositions)
        .where(eq(staffPositions.id, started.data.positionId));
      expect(row?.publicListed).toBe(true);
      expect(row?.publicListedBy).toBe(grantingUserId);
      expect(row?.publicListedAt).not.toBeNull();

      // OFF direction: every call writes publicListedBy/At — including
      // turning it back off — never leaves a stale "last listed" trail
      // (Phase 3 Edge Cases: this departs from recordedBy's "set once"
      // precedent on purpose).
      mockRecordAudit.mockClear();
      const off = await setStaffPositionPublicListed(
        staffAdminPerson,
        orgA,
        grantingUserId,
        { positionId: started.data.positionId, publicListed: false },
      );
      expect(off).toEqual({
        kind: "ok",
        data: { positionId: started.data.positionId, publicListed: false },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith({
        action: "staff_position.unlisted_publicly",
        resourceType: "staff_position",
        resourceId: started.data.positionId,
        metadata: { organizationId: orgA, publicListed: false },
      });

      const [offRow] = await platform
        .select({ publicListed: staffPositions.publicListed })
        .from(staffPositions)
        .where(eq(staffPositions.id, started.data.positionId));
      expect(offRow?.publicListed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // setStaffPositionPublicDisplayOrder — public-directory curation order
  // (docs/work-log/2026-08-28-public-directory-primitives.md, Phase 3)
  // ---------------------------------------------------------------------

  describe("setStaffPositionPublicDisplayOrder", () => {
    afterAll(() => {
      mockRecordAudit.mockClear();
    });

    it("invalid_target for a positionId that doesn't exist", async () => {
      const result = await setStaffPositionPublicDisplayOrder(
        staffAdminPerson,
        orgA,
        { positionId: "00000000-0000-0000-0000-000000000000", publicDisplayOrder: 1 },
      );
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target for a position belonging to a DIFFERENT org", async () => {
      const platform = getPlatformDb();
      const [crossOrgPosition] = await platform
        .insert(staffPositions)
        .values({
          organizationId: orgB,
          personId: outsidePerson,
          position: `Cross-Org Display Order ${stamp}`,
          positionKey: `cross-org display order ${stamp}`.toLowerCase(),
          startsOn: "2020-01-01",
          recordedBy: grantingUserId,
        })
        .returning({ id: staffPositions.id });

      const result = await setStaffPositionPublicDisplayOrder(
        staffAdminPerson,
        orgA,
        { positionId: crossOrgPosition!.id, publicDisplayOrder: 1 },
      );
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("forbidden for a person holding no staff.manage, and NOTHING is written", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Display Order Forbidden Test ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await setStaffPositionPublicDisplayOrder(narrowPerson, orgA, {
        positionId: started.data.positionId,
        publicDisplayOrder: 1,
      });
      expect(result).toEqual({ kind: "forbidden" });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ publicDisplayOrder: staffPositions.publicDisplayOrder })
        .from(staffPositions)
        .where(eq(staffPositions.id, started.data.positionId));
      expect(row?.publicDisplayOrder).toBeNull();
    });

    it("invalid_input for a negative value", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Display Order Negative Test ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await setStaffPositionPublicDisplayOrder(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        publicDisplayOrder: -1,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("invalid_input for a non-integer value", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Display Order Fraction Test ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await setStaffPositionPublicDisplayOrder(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        publicDisplayOrder: 1.5,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("invalid_input for a value beyond the int4 bound", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Display Order Overflow Test ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await setStaffPositionPublicDisplayOrder(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        publicDisplayOrder: 2147483648,
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("sets a valid integer, clears it back to null with an explicit null, and never calls recordAudit", async () => {
      const started = await startStaffPosition(staffAdminPerson, orgA, grantingUserId, {
        personId: targetPerson,
        position: `Display Order Happy Path ${stamp}`,
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      mockRecordAudit.mockClear();
      const set = await setStaffPositionPublicDisplayOrder(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        publicDisplayOrder: 3,
      });
      expect(set).toEqual({
        kind: "ok",
        data: { positionId: started.data.positionId, publicDisplayOrder: 3 },
      });
      expect(mockRecordAudit).not.toHaveBeenCalled();

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ publicDisplayOrder: staffPositions.publicDisplayOrder })
        .from(staffPositions)
        .where(eq(staffPositions.id, started.data.positionId));
      expect(row?.publicDisplayOrder).toBe(3);

      const cleared = await setStaffPositionPublicDisplayOrder(staffAdminPerson, orgA, {
        positionId: started.data.positionId,
        publicDisplayOrder: null,
      });
      expect(cleared).toEqual({
        kind: "ok",
        data: { positionId: started.data.positionId, publicDisplayOrder: null },
      });
      expect(mockRecordAudit).not.toHaveBeenCalled();

      const [clearedRow] = await platform
        .select({ publicDisplayOrder: staffPositions.publicDisplayOrder })
        .from(staffPositions)
        .where(eq(staffPositions.id, started.data.positionId));
      expect(clearedRow?.publicDisplayOrder).toBeNull();
    });
  });
});
