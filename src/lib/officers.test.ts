/**
 * Integration tests for src/lib/officers.ts — run against a REAL Postgres
 * connection, not mocked. Follows `src/lib/role-grants.test.ts`'s exact
 * harness: the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this
 * file's own top-level import of `./officers` would otherwise reach
 * `@/lib/db`'s module-scope pool construction before DATABASE_URL is
 * confirmed set), and a self-contained fixture created and torn down per
 * file rather than mutating `scripts/seed-dev.sql`'s fixture ids.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/officers.test.ts
 *
 * TWO ORGANIZATIONS:
 *   orgA — the general-purpose fixture: `officers.manage` bound to a test
 *          role, people holding it and not holding it, a current member
 *          (grant target), a lapsed member, and a district (org_unit).
 *   orgB — exists ONLY to prove cross-org isolation: a person and an
 *          org_unit that exist, but only at orgB, never at orgA.
 *
 * THE F22 REGRESSION SUITE (`describe("F22 regression...")` below) IS THE
 * SINGLE MOST IMPORTANT BLOCK IN THIS FILE — Phase 3's own named acceptance
 * criterion: same person, same office, two non-consecutive terms, recorded
 * through `startOfficerTerm()`/`endOfficerTerm()` (never a raw SQL insert),
 * asserting both terms retain independent `endsOn` values AND that
 * `group_memberships` carries two independent rows, each keyed to its own
 * `officer_term_id` — proving the new application write path doesn't
 * reintroduce F22's bug class (a second non-consecutive term silently
 * rewriting the first term's end date) through a different door.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("officers.ts (Postgres-backed, real dev database)", () => {
  let listOfficerRoster: typeof import("./officers").listOfficerRoster;
  let getOfficerHistory: typeof import("./officers").getOfficerHistory;
  let getOfficerFormOptions: typeof import("./officers").getOfficerFormOptions;
  let startOfficerTerm: typeof import("./officers").startOfficerTerm;
  let endOfficerTerm: typeof import("./officers").endOfficerTerm;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let orgUnits: typeof import("@/lib/db/domain/org").orgUnits;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let groupMemberships: typeof import("@/lib/db/domain/groups").groupMemberships;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let officerTerms: typeof import("@/lib/db/domain/officers").officerTerms;
  let users: typeof import("@/lib/db/schema").users;

  let orgA: string;
  let orgB: string;

  let clerkRoleA: string; // carries officers.manage

  let clerkPerson: string; // orgA — holds officers.manage
  let narrowPerson: string; // orgA — holds nothing
  let targetPerson: string; // orgA — current membership, no grant, term target
  let lapsedPerson: string; // orgA — membership ended
  let orgUnitA: string; // orgA — a district, valid for a deacon term
  let f22Person: string; // orgA — dedicated to the F22 regression test ONLY,
  // so no other describe block's ruling_elder terms for this person can
  // collide with the open-ended [2020-01-01, infinity) range that test
  // starts with

  let outsidePerson: string; // orgB only — cross-org invalid_target
  let outsideOrgUnit: string; // orgB only — cross-org invalid_target
  let noMembershipPerson: string; // no membership ANYWHERE — cross-org throw

  let grantingUserId: string; // a users.id row for recorded_by / grantedBy

  beforeAll(async () => {
    ({
      listOfficerRoster,
      getOfficerHistory,
      getOfficerFormOptions,
      startOfficerTerm,
      endOfficerTerm,
    } = await import("./officers"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations, orgUnits } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups, groupMemberships } = await import(
      "@/lib/db/domain/groups"
    ));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ officerTerms } = await import("@/lib/db/domain/officers"));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();
    const stamp = Date.now();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for officers.test.ts`,
          slug: `officers-test-${label.toLowerCase()}-${stamp}`,
          path: `officers_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }

    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    // Both derived-group templates this fixture needs. `roster` backs
    // `active_membership` (required before ANY memberships insert, F16);
    // `court` backs `session`/`diaconate` (required before any ruling_elder/
    // deacon officer_terms insert, same F16 mechanism, drizzle/0009).
    async function findOrCreateGroupType(key: string) {
      const [gt] = await platform
        .insert(groupTypes)
        .values({ organizationId: null, key, name: key })
        .onConflictDoNothing()
        .returning({ id: groupTypes.id });
      if (gt?.id) return gt.id;
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, key))
        .limit(1);
      return existing!.id;
    }
    const rosterTypeId = await findOrCreateGroupType("roster");
    const courtTypeId = await findOrCreateGroupType("court");

    async function derivedGroup(
      organizationId: string,
      groupTypeId: string,
      derivedFrom: string,
      name: string,
    ) {
      await platform.insert(groups).values({
        organizationId,
        groupTypeId,
        name,
        membershipSource: "derived",
        derivedFrom,
        isProtected: true,
      });
    }

    await derivedGroup(orgA, rosterTypeId, "active_membership", "Active Membership");
    await derivedGroup(orgA, courtTypeId, "session", "Session");
    await derivedGroup(orgA, courtTypeId, "diaconate", "Board of Deacons");
    await derivedGroup(orgB, rosterTypeId, "active_membership", "Active Membership");

    // Permission catalog — already seeded by drizzle/0029 in a real dev
    // database, but onConflictDoNothing keeps this file self-sufficient.
    await platform
      .insert(permissions)
      .values({
        key: "officers.manage",
        module: "officers",
        description: "Start/end officer terms; read the roster and history",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [userRow] = await platform
      .insert(users)
      .values({
        email: `officers-test-granter-${stamp}@example.invalid`,
        name: "Officers Test Granter",
      })
      .returning({ id: users.id });
    grantingUserId = userRow!.id;

    // --- orgA: the general-purpose fixture -----------------------------

    const [clerkRoleRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "clerk",
        name: "Clerk (test)",
        roleKind: "constitutional",
        isProtected: true,
      })
      .returning({ id: appRoles.id });
    clerkRoleA = clerkRoleRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: clerkRoleA, permissionKey: "officers.manage" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }

    clerkPerson = await person("Iolanthe", "Braithwaite");
    narrowPerson = await person("Peregrine", "Oduya");
    targetPerson = await person("Saoirse", "Kalantzis");
    lapsedPerson = await person("Bartholomew", "Nakashima");
    f22Person = await person("Thaddeus", "Okonkwo-Reyes");

    async function membership(
      organizationId: string,
      personId: string,
      endedOn: string | null = null,
    ) {
      await platform.insert(memberships).values({
        organizationId,
        personId,
        engagementStatus: "regular",
        currentRoll: "active",
        endedOn,
      });
    }

    await membership(orgA, clerkPerson);
    await membership(orgA, narrowPerson);
    await membership(orgA, targetPerson);
    await membership(orgA, lapsedPerson);
    await membership(orgA, f22Person);

    const [orgUnitRow] = await platform
      .insert(orgUnits)
      .values({ organizationId: orgA, unitType: "district", name: "North District" })
      .returning({ id: orgUnits.id });
    orgUnitA = orgUnitRow!.id;

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: clerkRoleA,
      personId: clerkPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });

    // Finding-4-shaped fixture: end lapsedPerson's MEMBERSHIP without
    // touching anything else, the same narrowly-scoped, try/finally-guarded
    // trigger disable role-grants.test.ts uses for its own lapsed-member
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

    outsidePerson = await person("Zinaida", "Prowse");
    await membership(orgB, outsidePerson);

    const [outsideOrgUnitRow] = await platform
      .insert(orgUnits)
      .values({ organizationId: orgB, unitType: "district", name: "orgB District" })
      .returning({ id: orgUnits.id });
    outsideOrgUnit = outsideOrgUnitRow!.id;

    noMembershipPerson = await person("Cosima", "Adeyemi");
    // Deliberately no membership row anywhere for noMembershipPerson.
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    const allPeople = [
      clerkPerson,
      narrowPerson,
      targetPerson,
      lapsedPerson,
      f22Person,
      outsidePerson,
      noMembershipPerson,
    ].filter(Boolean);

    await platform.delete(organizations).where(eq(organizations.id, orgA));
    await platform.delete(organizations).where(eq(organizations.id, orgB));
    for (const id of allPeople) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, grantingUserId));
  });

  // ---------------------------------------------------------------------
  // Permission gate — every exported function, checked first
  // ---------------------------------------------------------------------

  describe("permission gate — officers.manage checked before any read or write", () => {
    it("listOfficerRoster: forbidden for a person holding no officers.manage", async () => {
      const result = await listOfficerRoster(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getOfficerHistory: forbidden for a person holding no officers.manage", async () => {
      const result = await getOfficerHistory(narrowPerson, orgA, targetPerson);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getOfficerFormOptions: forbidden for a person holding no officers.manage", async () => {
      const result = await getOfficerFormOptions(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("startOfficerTerm: forbidden for a person holding no officers.manage, AND NOTHING IS WRITTEN", async () => {
      const result = await startOfficerTerm(narrowPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "trustee",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "forbidden" });

      // Prove the gate ran BEFORE the write, not just that a later step also
      // happened to fail — read as clerkPerson (who legitimately holds the
      // permission) and confirm no row exists at all.
      const after = await listOfficerRoster(clerkPerson, orgA, "trustee");
      if (after.kind !== "ok") throw new Error("expected ok");
      expect(
        after.data.some((entry) => entry.personId === targetPerson),
      ).toBe(false);
    });

    it("endOfficerTerm: forbidden for a person holding no officers.manage", async () => {
      const result = await endOfficerTerm(narrowPerson, orgA, {
        termId: randomUUID(),
        endsOn: "2026-01-01",
        endReason: "resigned",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  // ---------------------------------------------------------------------
  // org_unit / deacon "iff" validation
  // ---------------------------------------------------------------------

  describe("org_unit validation — deacon requires it, every other office rejects it", () => {
    it("deacon term WITHOUT an org_unit is invalid_input, names the district rule", async () => {
      const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "deacon",
        startsOn: "2026-01-01",
      });
      expect(result.kind).toBe("invalid_input");
      if (result.kind !== "invalid_input") return;
      expect(result.message).toMatch(/district/i);
    });

    it("deacon term WITH a valid org_unit succeeds", async () => {
      const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "deacon",
        startsOn: "2026-01-01",
        orgUnitId: orgUnitA,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      // Clean up so later tests see a stable fixture.
      await endOfficerTerm(clerkPerson, orgA, {
        termId: result.data.termId,
        endsOn: "2026-01-02",
        endReason: "resigned",
      });
    });

    it("a non-deacon office WITH an org_unit is invalid_input, names the rule", async () => {
      const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "moderator",
        startsOn: "2026-01-01",
        orgUnitId: orgUnitA,
      });
      expect(result.kind).toBe("invalid_input");
      if (result.kind !== "invalid_input") return;
      expect(result.message).toMatch(/district/i);
    });

    it("ruling_elder term WITHOUT an org_unit succeeds (only deacon needs one)", async () => {
      const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "ruling_elder",
        startsOn: "2027-01-01",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      await endOfficerTerm(clerkPerson, orgA, {
        termId: result.data.termId,
        endsOn: "2027-01-02",
        endReason: "resigned",
      });
    });
  });

  // ---------------------------------------------------------------------
  // Cross-org isolation (F21/composite-key shape)
  // ---------------------------------------------------------------------

  describe("cross-org isolation", () => {
    it("a person with a membership only at orgB cannot be the target of a term at orgA", async () => {
      const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: outsidePerson,
        office: "trustee",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("an org_unit that exists only at orgB cannot be attached to a deacon term at orgA", async () => {
      const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "deacon",
        startsOn: "2026-02-01",
        orgUnitId: outsideOrgUnit,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("getOfficerHistory: a person with no membership at orgA at all is invalid_target", async () => {
      const result = await getOfficerHistory(clerkPerson, orgA, outsidePerson);
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("getOfficerFormOptions: orgB's person and org_unit never appear in orgA's options", async () => {
      const result = await getOfficerFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.data.people.some((p) => p.personId === outsidePerson),
      ).toBe(false);
      expect(
        result.data.orgUnits.some((u) => u.orgUnitId === outsideOrgUnit),
      ).toBe(false);
    });

    it("a viewer with no relationship anywhere throws OrgAccessError, not a result", async () => {
      await expect(
        listOfficerRoster(noMembershipPerson, orgA),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });
  });

  // ---------------------------------------------------------------------
  // getOfficerFormOptions — F21 shape
  // ---------------------------------------------------------------------

  describe("getOfficerFormOptions", () => {
    it("excludes a lapsed membership from the people list", async () => {
      const result = await getOfficerFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.data.people.some((p) => p.personId === lapsedPerson),
      ).toBe(false);
    });

    it("offers the org's own district", async () => {
      const result = await getOfficerFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.data.orgUnits.some((u) => u.orgUnitId === orgUnitA),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Exclusion-violation copy-mapping (officer_terms_no_overlap)
  // ---------------------------------------------------------------------

  describe("exclusion-violation copy-mapping", () => {
    it("a second open term in the same office for the same person is 'overlap', naming the person and office, and inserts nothing", async () => {
      const first = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "treasurer",
        startsOn: "2026-03-01",
      });
      expect(first.kind).toBe("ok");
      if (first.kind !== "ok") return;

      const second = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "treasurer",
        startsOn: "2026-03-15",
      });
      expect(second.kind).toBe("overlap");
      if (second.kind !== "overlap") return;
      expect(second.personName).toMatch(/Saoirse|Kalantzis/);
      expect(second.officeLabel).toBe("Treasurer");

      // Exactly one row exists — the failed insert left nothing behind.
      const roster = await listOfficerRoster(clerkPerson, orgA, "treasurer");
      if (roster.kind !== "ok") throw new Error("expected ok");
      const matching = roster.data.filter(
        (entry) => entry.personId === targetPerson,
      );
      expect(matching.length).toBe(1);
      expect(matching[0]!.termId).toBe(first.data.termId);

      // Clean up.
      await endOfficerTerm(clerkPerson, orgA, {
        termId: first.data.termId,
        endsOn: "2026-04-01",
        endReason: "resigned",
      });
    });
  });

  // ---------------------------------------------------------------------
  // endOfficerTerm — validation and no-delete discipline
  // ---------------------------------------------------------------------

  describe("endOfficerTerm", () => {
    it("invalid_target for a term id that doesn't exist", async () => {
      const result = await endOfficerTerm(clerkPerson, orgA, {
        termId: randomUUID(),
        endsOn: "2026-01-01",
        endReason: "resigned",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_input when endsOn is before startsOn", async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "moderator",
        startsOn: "2026-05-01",
      });
      if (started.kind !== "ok") throw new Error("expected ok");

      const result = await endOfficerTerm(clerkPerson, orgA, {
        termId: started.data.termId,
        endsOn: "2026-04-01",
        endReason: "resigned",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      });

      // Clean up with a valid end.
      await endOfficerTerm(clerkPerson, orgA, {
        termId: started.data.termId,
        endsOn: "2026-06-01",
        endReason: "resigned",
      });
    });

    it("ends via ends_on/end_reason on the SAME row — never deletes", async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "clerk_of_session",
        startsOn: "2026-07-01",
      });
      if (started.kind !== "ok") throw new Error("expected ok");

      const ended = await endOfficerTerm(clerkPerson, orgA, {
        termId: started.data.termId,
        endsOn: "2026-08-01",
        endReason: "resigned",
      });
      expect(ended).toEqual({ kind: "ok", data: { termId: started.data.termId } });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ id: officerTerms.id, endsOn: officerTerms.endsOn })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId))
        .limit(1);
      expect(row).toBeDefined();
      expect(row?.endsOn).toBe("2026-08-01");
    });
  });

  // ---------------------------------------------------------------------
  // F22 REGRESSION — the single most important test in this file
  // ---------------------------------------------------------------------

  describe("F22 regression at the application layer (Phase 3's named acceptance criterion)", () => {
    it("same person, same office, two non-consecutive terms via startOfficerTerm()/endOfficerTerm(): independent ends_on AND independent group_memberships rows", async () => {
      const platform = getPlatformDb();

      // Term 1: 2020-01-01 to (initially open-ended).
      const term1 = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: f22Person,
        office: "ruling_elder",
        startsOn: "2020-01-01",
      });
      expect(term1.kind).toBe("ok");
      if (term1.kind !== "ok") return;

      // End term 1.
      const endedTerm1 = await endOfficerTerm(clerkPerson, orgA, {
        termId: term1.data.termId,
        endsOn: "2021-01-01",
        endReason: "completed",
      });
      expect(endedTerm1).toEqual({ kind: "ok", data: { termId: term1.data.termId } });

      // Term 2: a SECOND, non-consecutive term — same person, same office,
      // a gap of two years after term 1 ended. No overlap, so this must
      // succeed as a brand-new row, not silently update term 1.
      const term2 = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: f22Person,
        office: "ruling_elder",
        startsOn: "2023-01-01",
      });
      expect(term2.kind).toBe("ok");
      if (term2.kind !== "ok") return;

      expect(term2.data.termId).not.toBe(term1.data.termId);

      // --- Assertion 1: officer_terms — independent ends_on values -------

      const termRows = await platform
        .select({ id: officerTerms.id, endsOn: officerTerms.endsOn })
        .from(officerTerms)
        .where(eq(officerTerms.organizationId, orgA));
      const term1Row = termRows.find((r) => r.id === term1.data.termId);
      const term2Row = termRows.find((r) => r.id === term2.data.termId);
      expect(term1Row?.endsOn).toBe("2021-01-01");
      expect(term2Row?.endsOn).toBeNull(); // still open

      // --- Assertion 2: group_memberships — TWO independent rows, each   --
      // --- keyed to its own officer_term_id, neither overwritten by the  --
      // --- other. This is F22's exact failure mode: the earlier bug     --
      // --- matched on (org, group, person) alone and rewrote term 1's   --
      // --- end date when term 2 was inserted.                           --

      const gmRows = await platform
        .select({
          officerTermId: groupMemberships.officerTermId,
          personId: groupMemberships.personId,
          endsOn: groupMemberships.endsOn,
        })
        .from(groupMemberships)
        .where(eq(groupMemberships.personId, f22Person));

      const gmForTerm1 = gmRows.find((r) => r.officerTermId === term1.data.termId);
      const gmForTerm2 = gmRows.find((r) => r.officerTermId === term2.data.termId);

      expect(gmForTerm1).toBeDefined();
      expect(gmForTerm2).toBeDefined();
      expect(gmForTerm1!.officerTermId).not.toBe(gmForTerm2!.officerTermId);
      // Term 1's derived row still carries term 1's own end date — NOT
      // overwritten by term 2's insert.
      expect(gmForTerm1?.endsOn).toBe("2021-01-01");
      // Term 2's derived row is still open.
      expect(gmForTerm2?.endsOn).toBeNull();

      // --- Assertion 3: the roster shows only the CURRENT term ----------

      const roster = await listOfficerRoster(clerkPerson, orgA, "ruling_elder");
      if (roster.kind !== "ok") throw new Error("expected ok");
      const currentEntries = roster.data.filter(
        (entry) => entry.personId === f22Person,
      );
      expect(currentEntries.length).toBe(1);
      expect(currentEntries[0]!.termId).toBe(term2.data.termId);

      // --- Assertion 4: history shows BOTH terms, correctly ordered ------

      const history = await getOfficerHistory(clerkPerson, orgA, f22Person);
      if (history.kind !== "ok") throw new Error("expected ok");
      const relevant = history.data.filter((h) => h.office === "ruling_elder");
      expect(relevant.length).toBe(2);
      const historyTerm1 = relevant.find((h) => h.termId === term1.data.termId);
      const historyTerm2 = relevant.find((h) => h.termId === term2.data.termId);
      expect(historyTerm1?.endsOn).toBe("2021-01-01");
      expect(historyTerm1?.endReason).toBe("completed");
      expect(historyTerm2?.endsOn).toBeNull();
      expect(historyTerm2?.endReason).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Genuine failure propagation (not swallowed into a result variant)
  // ---------------------------------------------------------------------

  describe("genuine failures propagate as thrown exceptions", () => {
    it("startOfficerTerm: a malformed startsOn throws synchronously, not returned as a result", async () => {
      await expect(
        startOfficerTerm(clerkPerson, orgA, grantingUserId, {
          personId: targetPerson,
          office: "trustee",
          startsOn: "not-a-date",
        }),
      ).rejects.toThrow(/startsOn/);
    });

    it("startOfficerTerm: an unrecognized office throws", async () => {
      await expect(
        startOfficerTerm(clerkPerson, orgA, grantingUserId, {
          personId: targetPerson,
          // @ts-expect-error — deliberately invalid for this test
          office: "bishop",
          startsOn: "2026-01-01",
        }),
      ).rejects.toThrow(/office/);
    });

    it("endOfficerTerm: a malformed endsOn throws synchronously", async () => {
      await expect(
        endOfficerTerm(clerkPerson, orgA, {
          termId: randomUUID(),
          endsOn: "not-a-date",
          endReason: "resigned",
        }),
      ).rejects.toThrow(/endsOn/);
    });

    it("listOfficerRoster: a person with no relationship at all throws OrgAccessError", async () => {
      await expect(
        listOfficerRoster(randomUUID(), orgA),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });
  });
});
