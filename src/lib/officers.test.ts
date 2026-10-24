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
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

// `recordAudit()` is mocked at the module boundary — same posture and same
// reason `children.test.ts`/`person-sensitive.test.ts` document: `@/lib/audit`
// transitively imports `@/auth` (next-auth), which this test environment
// cannot resolve. `recordAudit()` is exercised only by the
// `setOfficerTermPublicListed` describe block below (it still audits after
// commit); start and end audit in the term's own transaction, through the real
// `insertAuditRow()`, and `recordAudit()` must never be called for them.
const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    OFFICER_TERM_STARTED: "tenant.officer_term.started",
    OFFICER_TERM_ENDED: "tenant.officer_term.ended",
    OFFICER_TERM_LISTED_PUBLICLY: "officer_term.listed_publicly",
    OFFICER_TERM_UNLISTED_PUBLICLY: "officer_term.unlisted_publicly",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

// `startOfficerTerm()`/`endOfficerTerm()` write their audit row with the REAL
// `insertAuditRow()` in the SAME transaction as the term (Increment 2, R13);
// this wrapper only lets a test force that insert to throw, to prove the term
// rolls back with it.
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

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("officers.ts (Postgres-backed, real dev database)", () => {
  let listOfficerRoster: typeof import("./officers").listOfficerRoster;
  let getOfficerHistory: typeof import("./officers").getOfficerHistory;
  let getOfficerFormOptions: typeof import("./officers").getOfficerFormOptions;
  let startOfficerTerm: typeof import("./officers").startOfficerTerm;
  let endOfficerTerm: typeof import("./officers").endOfficerTerm;
  let setOfficerTermPublicListed: typeof import("./officers").setOfficerTermPublicListed;
  let setOfficerTermPublicDisplayOrder: typeof import("./officers").setOfficerTermPublicDisplayOrder;
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
  // People created by the Increment 2 describe; swept by the outer afterAll,
  // after the organizations (and so their memberships and terms) are gone.
  const extraPeopleForSweep: string[] = [];

  beforeAll(async () => {
    ({
      listOfficerRoster,
      getOfficerHistory,
      getOfficerFormOptions,
      startOfficerTerm,
      endOfficerTerm,
      setOfficerTermPublicListed,
      setOfficerTermPublicDisplayOrder,
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
          // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
          deletableUntil: fixtureDeletableUntil(),
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
        .values({ key, name: key })
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
        .values({
          firstName: first,
          lastName: last,
          deletableUntil: fixtureDeletableUntil(),
        })
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

    // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
    // 110) also rejects the DELETE that cascading `organizations` fires
    // against this fixture's own session/diaconate/active_membership-derived
    // group_memberships rows — disable it around the cascade, same as
    // roll.test.ts's own teardown does for roll_actions_freeze.
    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    // The Increment 2 describe seeds one approved roll row (the S1 replay
    // case), which roll_actions_freeze would refuse to cascade away.
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      await platform.delete(organizations).where(eq(organizations.id, orgA));
      await platform.delete(organizations).where(eq(organizations.id, orgB));
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    for (const id of [...allPeople, ...extraPeopleForSweep]) {
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
      const result = await endOfficerTerm(narrowPerson, orgA, grantingUserId, {
        termId: randomUUID(),
        endsOn: "2026-01-01",
        endReason: "resigned",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("setOfficerTermPublicListed: forbidden for a person holding no officers.manage, AND NO AUDIT FIRES", async () => {
      const result = await setOfficerTermPublicListed(
        narrowPerson,
        orgA,
        grantingUserId,
        { termId: randomUUID(), publicListed: true },
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
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
      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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

      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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
      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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
      const result = await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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

      const result = await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
        termId: started.data.termId,
        endsOn: "2026-04-01",
        endReason: "resigned",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      });

      // Clean up with a valid end.
      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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

      const ended = await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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
      const endedTerm1 = await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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
        endOfficerTerm(clerkPerson, orgA, grantingUserId, {
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

  // ---------------------------------------------------------------------
  // setOfficerTermPublicListed — public staff directory opt-in/opt-out
  // (docs/work-log/2026-08-27-public-staff-directory.md, Phase 3)
  // ---------------------------------------------------------------------

  describe("setOfficerTermPublicListed", () => {
    afterAll(() => {
      mockRecordAudit.mockClear();
    });

    it("invalid_target for a termId that doesn't exist", async () => {
      const result = await setOfficerTermPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { termId: randomUUID(), publicListed: true },
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("invalid_target for a term belonging to a DIFFERENT org", async () => {
      const platform = getPlatformDb();
      const [crossOrgTerm] = await platform
        .insert(officerTerms)
        .values({
          organizationId: orgB,
          personId: outsidePerson,
          office: "trustee",
          startsOn: "2020-01-01",
          recordedBy: grantingUserId,
        })
        .returning({ id: officerTerms.id });

      const result = await setOfficerTermPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { termId: crossOrgTerm!.id, publicListed: true },
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("ON: sets publicListed/publicListedBy/publicListedAt and records OFFICER_TERM_LISTED_PUBLICLY", async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "trustee",
        startsOn: "2020-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      mockRecordAudit.mockClear();
      const result = await setOfficerTermPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { termId: started.data.termId, publicListed: true },
      );
      expect(result).toEqual({
        kind: "ok",
        data: { termId: started.data.termId, publicListed: true },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith({
        action: "officer_term.listed_publicly",
        resourceType: "officer_term",
        resourceId: started.data.termId,
        metadata: { organizationId: orgA, publicListed: true },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({
          publicListed: officerTerms.publicListed,
          publicListedBy: officerTerms.publicListedBy,
          publicListedAt: officerTerms.publicListedAt,
        })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId));
      expect(row?.publicListed).toBe(true);
      expect(row?.publicListedBy).toBe(grantingUserId);
      expect(row?.publicListedAt).not.toBeNull();

      // OFF direction: every call writes publicListedBy/At — including
      // turning it back off — never leaves a stale "last listed" trail
      // (Phase 3 Edge Cases: departs from recordedBy's "set once" precedent
      // on purpose).
      mockRecordAudit.mockClear();
      const off = await setOfficerTermPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { termId: started.data.termId, publicListed: false },
      );
      expect(off).toEqual({
        kind: "ok",
        data: { termId: started.data.termId, publicListed: false },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith({
        action: "officer_term.unlisted_publicly",
        resourceType: "officer_term",
        resourceId: started.data.termId,
        metadata: { organizationId: orgA, publicListed: false },
      });

      const [offRow] = await platform
        .select({ publicListed: officerTerms.publicListed })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId));
      expect(offRow?.publicListed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // setOfficerTermPublicDisplayOrder — public-directory curation order
  // (docs/work-log/2026-08-28-public-directory-primitives.md, Phase 3)
  // ---------------------------------------------------------------------

  describe("setOfficerTermPublicDisplayOrder", () => {
    afterAll(() => {
      mockRecordAudit.mockClear();
    });

    it("invalid_target for a termId that doesn't exist", async () => {
      const result = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: randomUUID(),
        publicDisplayOrder: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target for a term belonging to a DIFFERENT org", async () => {
      // A distinct office/date pair from every other cross-org fixture this
      // file inserts directly (setOfficerTermPublicListed's own cross-org
      // test above already occupies trustee/2020-01-01 for orgB/
      // outsidePerson and is never ended) — colliding with that row would
      // trip officer_terms_no_overlap, an unrelated false failure.
      const platform = getPlatformDb();
      const [crossOrgTerm] = await platform
        .insert(officerTerms)
        .values({
          organizationId: orgB,
          personId: outsidePerson,
          office: "moderator",
          startsOn: "2019-01-01",
          recordedBy: grantingUserId,
        })
        .returning({ id: officerTerms.id });

      const result = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: crossOrgTerm!.id,
        publicDisplayOrder: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    // Every test below uses targetPerson/clerk_of_session at a dedicated,
    // sequentially-increasing 2030+ date range unused anywhere else in this
    // file, ending each term immediately after use (mirroring
    // groups.test.ts's identical fix for the same officer_terms_no_overlap/
    // group_memberships-overlap hazard) — targetPerson already holds several
    // OTHER open/ended terms across this file's other describe blocks, so
    // reusing office/date pairs those use would collide.

    it("forbidden for a person holding no officers.manage, and NOTHING is written", async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "clerk_of_session",
        startsOn: "2030-01-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const result = await setOfficerTermPublicDisplayOrder(narrowPerson, orgA, {
        termId: started.data.termId,
        publicDisplayOrder: 1,
      });
      expect(result).toEqual({ kind: "forbidden" });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ publicDisplayOrder: officerTerms.publicDisplayOrder })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId));
      expect(row?.publicDisplayOrder).toBeNull();

      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
        termId: started.data.termId,
        endsOn: "2030-01-02",
        endReason: "resigned",
      });
    });

    // Explicit timeout: this test makes ~10 sequential real-Postgres round
    // trips (start, three invalid-input attempts, set, read, clear, read,
    // end) — comfortably under the default 5000ms in isolation, but the
    // combined margin has been observed to exceed it under this repo's own
    // documented shared-dev-DB contention (docs/TODO.md's ongoing
    // concurrent-pipeline latency-variance entries), not a regression this
    // test introduces.
    it(
      "validates bounds, sets a valid integer, clears it back to null, and never calls recordAudit",
      async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "clerk_of_session",
        startsOn: "2030-02-01",
      });
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      mockRecordAudit.mockClear();

      const negative = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: started.data.termId,
        publicDisplayOrder: -1,
      });
      expect(negative.kind).toBe("invalid_input");

      const nonInteger = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: started.data.termId,
        publicDisplayOrder: 1.5,
      });
      expect(nonInteger.kind).toBe("invalid_input");

      const overflow = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: started.data.termId,
        publicDisplayOrder: 2147483648,
      });
      expect(overflow.kind).toBe("invalid_input");

      const set = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: started.data.termId,
        publicDisplayOrder: 2,
      });
      expect(set).toEqual({
        kind: "ok",
        data: { termId: started.data.termId, publicDisplayOrder: 2 },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ publicDisplayOrder: officerTerms.publicDisplayOrder })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId));
      expect(row?.publicDisplayOrder).toBe(2);

      const cleared = await setOfficerTermPublicDisplayOrder(clerkPerson, orgA, {
        termId: started.data.termId,
        publicDisplayOrder: null,
      });
      expect(cleared).toEqual({
        kind: "ok",
        data: { termId: started.data.termId, publicDisplayOrder: null },
      });

      // None of the calls above — valid or invalid — ever call recordAudit:
      // presentation-order only, not a disclosure fact (unlike this
      // describe's setOfficerTermPublicListed sibling above).
      expect(mockRecordAudit).not.toHaveBeenCalled();

      const [clearedRow] = await platform
        .select({ publicDisplayOrder: officerTerms.publicDisplayOrder })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId));
      expect(clearedRow?.publicDisplayOrder).toBeNull();

      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
        termId: started.data.termId,
        endsOn: "2030-02-02",
        endReason: "resigned",
      });
      },
      20000,
    );
  });

  // ---------------------------------------------------------------------
  // Increment 2 (docs/work-log/2026-10-22-founding-admin-directory.md):
  // in-transaction audit with selfRecorded (R13, DECISION-205), the pastor
  // offices (DECISION-206, S1) and the typed refusals that replaced raw
  // foreign-key errors (F189).
  // ---------------------------------------------------------------------

  describe("Increment 2: in-transaction audit, selfRecorded, pastor offices", () => {
    const extra: string[] = [];
    const extraOrgUsers: string[] = [];
    let selfPerson: string; // orgA; people.user_id = grantingUserId
    let pastorPerson: string; // orgA; no roll (a pastor's membership is the presbytery's)
    let bClerk: string; // orgB; holds officers.manage there

    async function mkPersonAt(
      organizationId: string,
      first: string,
      opts: { roll?: string | null; userId?: string | null } = {},
    ): Promise<string> {
      const platform = getPlatformDb();
      const [p] = await platform
        .insert(people)
        .values({
          firstName: first,
          lastName: `Inc2-${Date.now()}`,
          userId: opts.userId ?? null,
          deletableUntil: fixtureDeletableUntil(),
        })
        .returning({ id: people.id });
      extra.push(p!.id);
      await platform.insert(memberships).values({
        organizationId,
        personId: p!.id,
        engagementStatus: "regular",
        currentRoll: opts.roll === undefined ? null : opts.roll,
      });
      return p!.id;
    }

    async function auditRows(termId: string): Promise<Array<Record<string, unknown>>> {
      const platform = getPlatformDb();
      const result = await platform.execute(
        sql`select * from audit_events where resource_id = ${termId} order by created_at`,
      );
      return (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
    }

    async function termRowsFor(personId: string, office: string) {
      const platform = getPlatformDb();
      return platform
        .select()
        .from(officerTerms)
        .where(sql`${officerTerms.personId} = ${personId}::uuid and ${officerTerms.office} = ${office}`);
    }

    async function sessionRowsFor(personId: string) {
      const platform = getPlatformDb();
      const result = await platform.execute(sql`
        select gm.id from group_memberships gm
          join groups g on g.id = gm.group_id
         where gm.person_id = ${personId}::uuid and g.derived_from = 'session'
      `);
      return (result as unknown as { rows: unknown[] }).rows;
    }

    beforeAll(async () => {
      const platform = getPlatformDb();
      // A user whose person is selfPerson: the actor of the self-recording tests.
      selfPerson = await mkPersonAt(orgA, "Selfa", { userId: grantingUserId });
      pastorPerson = await mkPersonAt(orgA, "Pastora");
      bClerk = await mkPersonAt(orgB, "Bclerka");
      const [roleB] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgB,
          key: "clerk",
          name: "Clerk B (test)",
          roleKind: "constitutional",
          isProtected: true,
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: roleB!.id, permissionKey: "officers.manage" });
      await platform.insert(roleGrants).values({
        organizationId: orgB,
        roleId: roleB!.id,
        personId: bClerk,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      });
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      auditControl.fail = false;
      await platform.execute(
        sql`delete from audit_events where metadata->>'organizationId' in (${orgA}, ${orgB})`,
      );
      // The orgs are deleted by the outer afterAll (cascading the memberships
      // and terms); the people are removed here, after it has run is not
      // possible, so register them for the outer sweep instead.
      extraPeopleForSweep.push(...extra);
      for (const id of extraOrgUsers) {
        await platform.delete(users).where(eq(users.id, id));
      }
    });

    it("start writes tenant.officer_term.started in the SAME transaction, from the term's own values, with selfRecorded false for someone else's record", async () => {
      const someoneElse = await mkPersonAt(orgA, "Someone");
      const result = await startOfficerTerm(
        clerkPerson,
        orgA,
        grantingUserId,
        { personId: someoneElse, office: "treasurer", startsOn: "2025-01-01" },
        { actingUserEmail: "clerk@example.invalid" },
      );
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      const audits = await auditRows(result.data.termId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "tenant.officer_term.started",
        actor_user_id: grantingUserId,
        actor_email: "clerk@example.invalid",
        resource_type: "officer_term",
      });
      expect(audits[0]!.metadata).toEqual({
        organizationId: orgA,
        personId: someoneElse,
        office: "treasurer",
        startsOn: "2025-01-01",
        orgUnitId: null,
        selfRecorded: false,
      });
      // The audit never goes through the swallow-on-failure after-commit path.
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("selfRecorded is true when the person recorded is the actor (the founding administrator recording themselves as an elder), on start AND end", async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: selfPerson,
        office: "ruling_elder",
        startsOn: "2025-02-01",
      });
      if (started.kind !== "ok") throw new Error("expected ok");
      const [startAudit] = await auditRows(started.data.termId);
      expect(startAudit!.metadata).toMatchObject({ office: "ruling_elder", selfRecorded: true });

      const ended = await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
        termId: started.data.termId,
        endsOn: "2025-12-31",
        endReason: "completed",
      });
      expect(ended.kind).toBe("ok");
      const audits = await auditRows(started.data.termId);
      expect(audits.map((a) => a.action)).toEqual([
        "tenant.officer_term.started",
        "tenant.officer_term.ended",
      ]);
      // The end audit's person and office come from the TERM'S OWN ROW.
      expect(audits[1]!.metadata).toEqual({
        organizationId: orgA,
        personId: selfPerson,
        office: "ruling_elder",
        endsOn: "2025-12-31",
        endReason: "completed",
        selfRecorded: true,
      });
    });

    it("a failed audit insert rolls back the term and its derived Session row — a Session seat never commits without its audit row", async () => {
      const person = await mkPersonAt(orgA, "Doomed");
      auditControl.fail = true;
      try {
        await expect(
          startOfficerTerm(clerkPerson, orgA, grantingUserId, {
            personId: person,
            office: "ruling_elder",
            startsOn: "2025-03-01",
          }),
        ).rejects.toThrow(/audit insert failed/);
      } finally {
        auditControl.fail = false;
      }
      expect(await termRowsFor(person, "ruling_elder")).toHaveLength(0);
      expect(await sessionRowsFor(person)).toHaveLength(0);
    });

    it("a failed audit insert on END leaves the term open", async () => {
      const person = await mkPersonAt(orgA, "Enduring");
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: person,
        office: "trustee",
        startsOn: "2025-04-01",
      });
      if (started.kind !== "ok") throw new Error("expected ok");
      auditControl.fail = true;
      try {
        await expect(
          endOfficerTerm(clerkPerson, orgA, grantingUserId, {
            termId: started.data.termId,
            endsOn: "2025-12-01",
            endReason: "resigned",
          }),
        ).rejects.toThrow(/audit insert failed/);
      } finally {
        auditControl.fail = false;
      }
      const [row] = await getPlatformDb()
        .select({ endsOn: officerTerms.endsOn, endReason: officerTerms.endReason })
        .from(officerTerms)
        .where(eq(officerTerms.id, started.data.termId));
      expect(row).toEqual({ endsOn: null, endReason: null });
      expect((await auditRows(started.data.termId)).map((a) => a.action)).toEqual([
        "tenant.officer_term.started",
      ]);
    });

    it("a refused start (forbidden, invalid_target, overlap) writes no audit row", async () => {
      const platform = getPlatformDb();
      const countBefore = await platform.execute(
        sql`select count(*)::int as n from audit_events where metadata->>'organizationId' = ${orgA}`,
      );
      await startOfficerTerm(narrowPerson, orgA, grantingUserId, {
        personId: targetPerson,
        office: "trustee",
        startsOn: "2025-06-01",
      });
      await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: noMembershipPerson,
        office: "trustee",
        startsOn: "2025-06-01",
      });
      await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: "not-a-uuid",
        office: "trustee",
        startsOn: "2025-06-01",
      });
      const countAfter = await platform.execute(
        sql`select count(*)::int as n from audit_events where metadata->>'organizationId' = ${orgA}`,
      );
      expect((countAfter as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(
        (countBefore as unknown as { rows: Array<{ n: number }> }).rows[0]!.n,
      );
    });

    it("a malformed personId or termId is invalid_target, never a raw cast error", async () => {
      expect(
        await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
          personId: "nope",
          office: "trustee",
          startsOn: "2025-06-01",
        }),
      ).toEqual({ kind: "invalid_target" });
      expect(
        await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
          termId: "nope",
          endsOn: "2025-06-01",
          endReason: "resigned",
        }),
      ).toEqual({ kind: "invalid_target" });
    });

    it("an installed pastor, a co-pastor and an associate pastor are recorded and seated on the derived Session group (G-3.0201), and recorded with the person's own selfRecorded stamp", async () => {
      for (const office of ["installed_pastor", "co_pastor", "associate_pastor"] as const) {
        const person = await mkPersonAt(orgA, `Pastor-${office}`);
        const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
          personId: person,
          office,
          startsOn: "2024-01-01",
        });
        expect(result.kind, office).toBe("ok");
        expect(await sessionRowsFor(person), office).toHaveLength(1);
        if (result.kind !== "ok") continue;
        const [audit] = await auditRows(result.data.termId);
        expect(audit!.metadata, office).toMatchObject({ office, selfRecorded: false });
      }
      // A deacon seats on the diaconate, a moderator on neither.
      const moderator = await mkPersonAt(orgA, "Moderata");
      expect(
        (
          await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
            personId: moderator,
            office: "moderator",
            startsOn: "2024-01-01",
          })
        ).kind,
      ).toBe("ok");
      expect(await sessionRowsFor(moderator)).toHaveLength(0);
    });

    it("S1: a pastor office for a person on this congregation's roll is on_roll, naming them, and nothing is written", async () => {
      // A member whose membership carries current_roll = 'active'.
      const member = await mkPersonAt(orgA, "Rolled", { roll: "active" });
      for (const office of ["installed_pastor", "co_pastor", "associate_pastor"] as const) {
        const result = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
          personId: member,
          office,
          startsOn: "2025-05-01",
        });
        expect(result, office).toMatchObject({ kind: "on_roll", personName: expect.stringMatching(/^Rolled /) });
        expect(await termRowsFor(member, office), office).toHaveLength(0);
        expect(await sessionRowsFor(member), office).toHaveLength(0);
      }
      // A ruling elder on the roll is, of course, fine (elders are members).
      const elder = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: member,
        office: "ruling_elder",
        startsOn: "2030-01-01",
      });
      expect(elder.kind).toBe("ok");
    });

    it("S1 also counts a roll known only by replay (a future start date as of the term's start): on_roll when replay says so", async () => {
      const platform = getPlatformDb();
      const person = await mkPersonAt(orgA, "Replayed");
      // An approved baptized-member row dated today: the cache and the replay agree.
      await platform.insert((await import("@/lib/db/domain/roll")).rollActions).values({
        organizationId: orgA,
        personId: person,
        kind: "baptized_member_enrolled",
        effectiveDate: "2020-01-01",
        resultingRoll: "baptized",
        approvalStatus: "approved",
        approvedBy: grantingUserId,
        proposedBy: grantingUserId,
      });
      expect(
        await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
          personId: person,
          office: "installed_pastor",
          startsOn: "2024-01-01",
        }),
      ).toMatchObject({ kind: "on_roll" });
    });

    it("invalid_office_for_org: a Session, pastor or diaconate office at an organization with no matching group is typed, not a raw foreign-key error — a clerk office there is fine", async () => {
      const bTarget = outsidePerson; // orgB member
      for (const [office, label] of [
        ["ruling_elder", "Ruling Elder"],
        ["installed_pastor", "Installed Pastor"],
        ["co_pastor", "Co-Pastor"],
        ["associate_pastor", "Associate Pastor"],
      ] as const) {
        expect(
          await startOfficerTerm(bClerk, orgB, grantingUserId, {
            personId: bTarget,
            office,
            startsOn: "2024-01-01",
          }),
          office,
        ).toEqual({ kind: "invalid_office_for_org", officeLabel: label });
      }
      expect(
        await startOfficerTerm(bClerk, orgB, grantingUserId, {
          personId: bTarget,
          office: "deacon",
          startsOn: "2024-01-01",
          orgUnitId: outsideOrgUnit,
        }),
      ).toEqual({ kind: "invalid_office_for_org", officeLabel: "Deacon" });
      expect(
        (
          await startOfficerTerm(bClerk, orgB, grantingUserId, {
            personId: bTarget,
            office: "clerk_of_session",
            startsOn: "2024-01-01",
          })
        ).kind,
      ).toBe("ok");
      expect(await termRowsFor(bTarget, "ruling_elder")).toHaveLength(0);
    });

    it("listOfficerRoster returns the pastor offices, and selfRecorded only for a Session-bearing office recorded by the person themselves", async () => {
      const selfElder = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: selfPerson,
        office: "ruling_elder",
        startsOn: "2026-01-01",
      });
      if (selfElder.kind !== "ok") throw new Error("expected ok");
      const selfTreasurer = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: selfPerson,
        office: "treasurer",
        startsOn: "2026-01-01",
      });
      if (selfTreasurer.kind !== "ok") throw new Error("expected ok");
      const pastor = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: pastorPerson,
        office: "installed_pastor",
        startsOn: "2026-01-01",
      });
      if (pastor.kind !== "ok") throw new Error("expected ok");

      const roster = await listOfficerRoster(clerkPerson, orgA);
      if (roster.kind !== "ok") throw new Error("expected ok");
      const byTerm = new Map(roster.data.map((e) => [e.termId, e]));
      expect(byTerm.get(selfElder.data.termId)).toMatchObject({
        office: "ruling_elder",
        selfRecorded: true,
      });
      // recorded_by equals the person's user_id, but a treasurer is not a Session seat.
      expect(byTerm.get(selfTreasurer.data.termId)).toMatchObject({
        office: "treasurer",
        selfRecorded: false,
      });
      expect(byTerm.get(pastor.data.termId)).toMatchObject({
        office: "installed_pastor",
        selfRecorded: false,
      });
      // And the filter by a pastor office works.
      const onlyPastors = await listOfficerRoster(clerkPerson, orgA, "installed_pastor");
      if (onlyPastors.kind !== "ok") throw new Error("expected ok");
      expect(onlyPastors.data.every((e) => e.office === "installed_pastor")).toBe(true);
      expect(onlyPastors.data.some((e) => e.termId === pastor.data.termId)).toBe(true);
    });

    it("the term's own people-and-office are the audit source: ending someone else's term cannot be mislabelled by the caller", async () => {
      const started = await startOfficerTerm(clerkPerson, orgA, grantingUserId, {
        personId: pastorPerson,
        office: "co_pastor",
        startsOn: "2026-02-01",
      });
      if (started.kind !== "ok") throw new Error("expected ok");
      // The input type no longer has a personId or office; a forged one is ignored.
      await endOfficerTerm(clerkPerson, orgA, grantingUserId, {
        termId: started.data.termId,
        endsOn: "2026-06-01",
        endReason: "completed",
        ...({ personId: targetPerson, office: "trustee" } as object),
      } as never);
      const audits = await auditRows(started.data.termId);
      expect(audits[1]!.metadata).toMatchObject({
        personId: pastorPerson,
        office: "co_pastor",
      });
    });
  });
});
