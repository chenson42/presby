/**
 * Integration tests for src/lib/role-grants.ts — run against a REAL Postgres
 * connection, not mocked. Follows src/lib/directory.test.ts's exact harness:
 * the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./role-grants` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file rather than
 * mutating `scripts/seed-dev.sql`'s fixture ids.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/role-grants.test.ts
 *
 * FOUR SEPARATE ORGANIZATIONS, deliberately, not one shared fixture:
 *   orgA  — the general-purpose fixture: two roles (`clerk`, carrying
 *           `role_grants.manage`; `viewer`, carrying only `directory.view`),
 *           people holding each (including a "bare clerk" who holds ONLY
 *           `role_grants.manage`, for the true escalation test), a group,
 *           and the arm-1 cascade-gap person. Used for listGrants,
 *           getGrantFormOptions, and most of grantRole/revokeRole's
 *           ordinary paths.
 *   orgB  — exists ONLY to prove enumeration doesn't leak across orgs and to
 *           give the cross-org test a real "no membership at orgA" person.
 *   orgC  — EXACTLY ONE currently-effective `role_grants.manage` holder.
 *           Isolated from orgA so inserting/revoking grants in orgA's tests
 *           can never accidentally change orgC's holder count.
 *   orgD  — EXACTLY TWO currently-effective `role_grants.manage` holders,
 *           for the "revoke one, then the survivor is blocked" sequence.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("role-grants.ts (Postgres-backed, real dev database)", () => {
  let listGrants: typeof import("./role-grants").listGrants;
  let getGrantFormOptions: typeof import("./role-grants").getGrantFormOptions;
  let grantRole: typeof import("./role-grants").grantRole;
  let revokeRole: typeof import("./role-grants").revokeRole;
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
  let users: typeof import("@/lib/db/schema").users;

  let orgA: string;
  let orgB: string;
  let orgC: string;
  let orgD: string;

  let clerkRoleA: string; // carries role_grants.manage
  let viewerRoleA: string; // carries only directory.view
  let clerkRoleC: string; // orgC's own role_grants.manage role — for the
  // invalid_role cross-org test, a real role id that belongs to orgC

  let clerkPerson: string; // orgA — holds clerkRoleA directly
  let narrowPerson: string; // orgA — holds ONLY viewerRoleA (directory.view)
  let bareClerkPerson: string; // orgA — holds ONLY clerkRoleA (role_grants.manage), nothing else
  let targetPerson: string; // orgA — current membership, no grant, grant target
  let lapsedPerson: string; // orgA — holds viewerRoleA, membership later ended
  let groupA: string; // orgA — a managed group, valid grant target

  let outsidePerson: string; // orgB only — used for cross-org / enumeration
  let noMembershipPerson: string; // no membership ANYWHERE — cross-org throw

  let soleHolderPerson: string; // orgC — the only role_grants.manage holder
  let soleHolderGrantId: string;

  let twoHolderA: string; // orgD — holder #1
  let twoHolderB: string; // orgD — holder #2
  let twoHolderGrantIdA: string;
  let twoHolderGrantIdB: string;

  let grantingUserId: string; // a users.id row for the granted_by FK

  beforeAll(async () => {
    ({ listGrants, getGrantFormOptions, grantRole, revokeRole } =
      await import("./role-grants"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();
    const stamp = Date.now();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for role-grants.test.ts`,
          slug: `role-grants-test-${label.toLowerCase()}-${stamp}`,
          path: `role_grants_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }

    orgA = await makeOrg("A");
    orgB = await makeOrg("B");
    orgC = await makeOrg("C");
    orgD = await makeOrg("D");

    // drizzle/0017's sync trigger fails loudly if the org has no
    // active_membership derived group yet — must exist before ANY
    // memberships insert at any of the four orgs.
    const [gt] = await platform
      .insert(groupTypes)
      .values({ organizationId: null, key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    let groupTypeId = gt?.id;
    if (!groupTypeId) {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, "roster"))
        .limit(1);
      groupTypeId = existing!.id;
    }

    async function activeMembershipGroup(organizationId: string) {
      const [row] = await platform
        .insert(groups)
        .values({
          organizationId,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        })
        .returning({ id: groups.id });
      return row!.id;
    }

    await activeMembershipGroup(orgA);
    await activeMembershipGroup(orgB);
    await activeMembershipGroup(orgC);
    await activeMembershipGroup(orgD);

    // Permission catalog — already seeded by migrations 0017/0018 in a real
    // dev database, but onConflictDoNothing keeps this file self-sufficient
    // against a database that hasn't run them.
    await platform
      .insert(permissions)
      .values([
        {
          key: "directory.view",
          module: "directory",
          description: "Browse the congregation directory",
          sensitivityTier: 1,
        },
        {
          key: "role_grants.manage",
          module: "authz",
          description: "Grant and revoke role_grants rows",
          sensitivityTier: 1,
        },
      ])
      .onConflictDoNothing();

    // A users.id row for the granted_by FK (P0.5's read-org-brand.ts lesson:
    // this is NOT a people.id).
    const [userRow] = await platform
      .insert(users)
      .values({
        email: `role-grants-test-granter-${stamp}@example.invalid`,
        name: "Role Grants Test Granter",
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
      .values({ roleId: clerkRoleA, permissionKey: "role_grants.manage" });

    const [viewerRoleRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "viewer",
        name: "Viewer (test)",
        roleKind: "custom",
        isProtected: false,
      })
      .returning({ id: appRoles.id });
    viewerRoleA = viewerRoleRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: viewerRoleA, permissionKey: "directory.view" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }

    clerkPerson = await person("Iolanthe", "Braithwaite");
    narrowPerson = await person("Peregrine", "Oduya");
    bareClerkPerson = await person("Wilhelmina", "Astrakhan");
    targetPerson = await person("Saoirse", "Kalantzis");
    lapsedPerson = await person("Bartholomew", "Nakashima");

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
    await membership(orgA, bareClerkPerson);
    await membership(orgA, targetPerson);
    await membership(orgA, lapsedPerson);

    const [groupARow] = await platform
      .insert(groups)
      .values({
        organizationId: orgA,
        groupTypeId,
        name: "Property Committee (test)",
        membershipSource: "managed",
      })
      .returning({ id: groups.id });
    groupA = groupARow!.id;

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: clerkRoleA,
      personId: clerkPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });
    // clerkPerson ALSO directly holds viewerRoleA (directory.view), so their
    // combined effective permissions are {role_grants.manage, directory.view}
    // — otherwise the "a role_grants.manage holder can grant a subset of
    // their own permissions" test below would itself trip the escalation
    // check, since holding role_grants.manage alone does not imply holding
    // directory.view.
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: viewerRoleA,
      personId: clerkPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: viewerRoleA,
      personId: narrowPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });
    // bareClerkPerson holds role_grants.manage and NOTHING else — the
    // fixture the true escalation test needs: a legitimate gate-holder
    // attempting to grant a role that requires a permission they don't
    // personally have (directory.view).
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: clerkRoleA,
      personId: bareClerkPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: viewerRoleA,
      personId: lapsedPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });

    // Finding 4's fixture: end lapsedPerson's MEMBERSHIP without touching
    // their role_grants row at all — the cascade gap, reproduced live.
    //
    // GENUINE DISCOVERY, surfaced by writing this fixture and watching it
    // fail before writing the assertion: `drizzle/0014_presby_org_router.sql`
    // already installs `memberships_guard_end` — a BEFORE UPDATE OF ended_on
    // trigger that raises `check_violation` if a `role_grants` row (or an
    // `officer_terms` row) is still open for that person at that org. It
    // fires for exactly this UPDATE and rejects it: "cannot end this
    // relationship on 2021-06-15 - a role grant beginning 2020-01-01 is
    // still open at this organization." DECISION-062/066 and this
    // pipeline's Phase 1-3 design all describe the arm-1 cascade gap as
    // "real and unfixed" and ask for it to be surfaced, not closed — but
    // `0014` (which predates this pipeline's own migration `0018`) already
    // closes it for every ordinary application mutation path. Reported
    // back to the orchestrator as a finding; `listGrants()`'s
    // `membershipEnded` join stays in this commit regardless — it is
    // correct, harmless defensive code for the one path that CAN still
    // produce this state (a direct historical-data import that bypasses
    // the guard, which is exactly what this fixture now simulates, on
    // purpose, via a narrowly-scoped, try/finally-guarded trigger disable —
    // never done in application code, only here to construct a state the
    // app itself now refuses to create).
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

    // --- orgB: cross-org / enumeration boundary -------------------------

    outsidePerson = await person("Zinaida", "Prowse");
    await membership(orgB, outsidePerson);

    noMembershipPerson = await person("Cosima", "Adeyemi");
    // Deliberately no membership row anywhere for noMembershipPerson.

    // --- orgC: exactly one role_grants.manage holder --------------------

    const [clerkRoleCRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgC,
        key: "clerk",
        name: "Clerk (test, orgC)",
        roleKind: "constitutional",
        isProtected: true,
      })
      .returning({ id: appRoles.id });
    clerkRoleC = clerkRoleCRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: clerkRoleC, permissionKey: "role_grants.manage" });

    soleHolderPerson = await person("Ottoline", "Vasquez-Reyes");
    await membership(orgC, soleHolderPerson);
    const [soleGrantRow] = await platform
      .insert(roleGrants)
      .values({
        organizationId: orgC,
        roleId: clerkRoleC,
        personId: soleHolderPerson,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      })
      .returning({ id: roleGrants.id });
    soleHolderGrantId = soleGrantRow!.id;

    // --- orgD: exactly two role_grants.manage holders --------------------

    const [clerkRoleDRow] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgD,
        key: "clerk",
        name: "Clerk (test, orgD)",
        roleKind: "constitutional",
        isProtected: true,
      })
      .returning({ id: appRoles.id });
    const clerkRoleD = clerkRoleDRow!.id;
    await platform
      .insert(appRolePermissions)
      .values({ roleId: clerkRoleD, permissionKey: "role_grants.manage" });

    twoHolderA = await person("Ferdinand", "Achterberg");
    twoHolderB = await person("Marisol", "Enweazu");
    await membership(orgD, twoHolderA);
    await membership(orgD, twoHolderB);
    const [twoGrantA] = await platform
      .insert(roleGrants)
      .values({
        organizationId: orgD,
        roleId: clerkRoleD,
        personId: twoHolderA,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      })
      .returning({ id: roleGrants.id });
    twoHolderGrantIdA = twoGrantA!.id;
    const [twoGrantB] = await platform
      .insert(roleGrants)
      .values({
        organizationId: orgD,
        roleId: clerkRoleD,
        personId: twoHolderB,
        startsOn: "2020-01-01",
        grantedBy: grantingUserId,
      })
      .returning({ id: roleGrants.id });
    twoHolderGrantIdB = twoGrantB!.id;
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    const allPeople = [
      clerkPerson,
      narrowPerson,
      bareClerkPerson,
      targetPerson,
      lapsedPerson,
      outsidePerson,
      noMembershipPerson,
      soleHolderPerson,
      twoHolderA,
      twoHolderB,
    ].filter(Boolean);

    await platform
      .delete(organizations)
      .where(eq(organizations.id, orgA));
    await platform
      .delete(organizations)
      .where(eq(organizations.id, orgB));
    await platform
      .delete(organizations)
      .where(eq(organizations.id, orgC));
    await platform
      .delete(organizations)
      .where(eq(organizations.id, orgD));
    for (const id of allPeople) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, grantingUserId));
  });

  // ---------------------------------------------------------------------
  // listGrants
  // ---------------------------------------------------------------------

  describe("listGrants", () => {
    it("returns forbidden for a viewer with no role_grants.manage", async () => {
      const result = await listGrants(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("finding 4: surfaces a grant on a lapsed membership, not filtered, with membershipEnded set", async () => {
      const result = await listGrants(clerkPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const lapsedEntry = result.grants.find(
        (g) => g.grantee.kind === "person" && g.grantee.personId === lapsedPerson,
      );
      expect(lapsedEntry).toBeDefined();
      expect(lapsedEntry?.grantee.kind).toBe("person");
      if (lapsedEntry?.grantee.kind === "person") {
        expect(lapsedEntry.grantee.membershipEnded).toBe("2021-06-15");
      }
    });

    it("a current grantee's membershipEnded is null", async () => {
      const result = await listGrants(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const clerkEntry = result.grants.find(
        (g) => g.grantee.kind === "person" && g.grantee.personId === clerkPerson,
      );
      expect(clerkEntry?.grantee.kind).toBe("person");
      if (clerkEntry?.grantee.kind === "person") {
        expect(clerkEntry.grantee.membershipEnded).toBeNull();
      }
    });
  });

  // ---------------------------------------------------------------------
  // getGrantFormOptions
  // ---------------------------------------------------------------------

  describe("getGrantFormOptions", () => {
    it("returns forbidden for a viewer with no role_grants.manage", async () => {
      const result = await getGrantFormOptions(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("finding 5: a person who is only a member at another org is absent, even though people has more rows than are offered", async () => {
      const result = await getGrantFormOptions(clerkPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const offeredIds = result.options.people.map((p) => p.personId);
      expect(offeredIds).not.toContain(outsidePerson);

      const platform = getPlatformDb();
      const allPeopleRows = await platform.select({ id: people.id }).from(people);
      expect(allPeopleRows.length).toBeGreaterThan(offeredIds.length);
    });

    it("a lapsed membership is also excluded from the people list (not just directory-scoped)", async () => {
      const result = await getGrantFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const offeredIds = result.options.people.map((p) => p.personId);
      expect(offeredIds).not.toContain(lapsedPerson);
    });

    it("offers exactly the seeded roles at this org, no wildcard entries", async () => {
      const result = await getGrantFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const roleKeys = result.options.roles.map((r) => r.key).sort();
      expect(roleKeys).toEqual(["clerk", "viewer"]);
    });

    it("offers the managed group", async () => {
      const result = await getGrantFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const group = result.options.groups.find((g) => g.groupId === groupA);
      expect(group).toBeDefined();
      expect(group?.derived).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // grantRole
  // ---------------------------------------------------------------------

  describe("grantRole", () => {
    it("returns forbidden for a person with no role_grants.manage at all, even for a role within their own permission subset", async () => {
      // narrowPerson holds ONLY directory.view — the ordinary member
      // baseline. Attempting to grant viewerRoleA (itself bound only to
      // directory.view, which narrowPerson already holds) must still be
      // forbidden: the primary gate blocks non-holders from using this
      // feature AT ALL, regardless of what the subset check alone would
      // allow. This is the regression test for the real vulnerability the
      // gate exists to close — without it, any current member could grant
      // low-tier roles to anyone with zero administrative standing.
      const result = await grantRole(narrowPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: targetPerson },
      });
      expect(result).toEqual({ kind: "forbidden" });

      const after = await listGrants(clerkPerson, orgA);
      if (after.kind !== "ok") throw new Error("expected ok");
      const targetEntry = after.grants.find(
        (g) => g.grantee.kind === "person" && g.grantee.personId === targetPerson,
      );
      expect(targetEntry).toBeUndefined();
    });

    it("finding 1 — flagship self/other-escalation: a legitimate role_grants.manage holder cannot grant a role that requires a permission they don't personally hold", async () => {
      // bareClerkPerson holds role_grants.manage and NOTHING else — passes
      // the gate, then must be stopped by the subset check when attempting
      // to grant viewerRoleA (requires directory.view, which they lack).
      const result = await grantRole(bareClerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: targetPerson },
      });
      expect(result.kind).toBe("escalation_denied");
      if (result.kind !== "escalation_denied") return;
      expect(result.missingPermissions).toContain("directory.view");

      // No new row — the follow-up read (by someone WHO can read) shows
      // nothing changed.
      const after = await listGrants(clerkPerson, orgA);
      if (after.kind !== "ok") throw new Error("expected ok");
      const targetEntry = after.grants.find(
        (g) => g.grantee.kind === "person" && g.grantee.personId === targetPerson,
      );
      expect(targetEntry).toBeUndefined();
    });

    it("a role_grants.manage holder CAN grant a role that is a subset of their own permissions", async () => {
      const result = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: targetPerson },
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.roleKey).toBe("viewer");

      const after = await listGrants(clerkPerson, orgA);
      if (after.kind !== "ok") throw new Error("expected ok");
      const targetEntry = after.grants.find((g) => g.grantId === result.grantId);
      expect(targetEntry).toBeDefined();

      // Clean up so later tests in this describe block see a stable fixture.
      await revokeRole(clerkPerson, orgA, result.grantId);
    });

    it("finding 2, cross-org: a granter with no active membership at the target org throws OrgAccessError, not a GrantResult", async () => {
      await expect(
        grantRole(noMembershipPerson, orgA, grantingUserId, {
          roleId: viewerRoleA,
          target: { kind: "person", personId: targetPerson },
        }),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });

    it("finding 2, cross-org variant: a person with a membership only at orgB cannot be granted a role at orgA", async () => {
      const result = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: outsidePerson },
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_role: a roleId from another org is rejected distinctly, not thrown and not escalation_denied", async () => {
      // clerkRoleC is a real, existing app_roles row — just at orgC, not orgA.
      const result = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: clerkRoleC,
        target: { kind: "person", personId: targetPerson },
      });
      expect(result).toEqual({ kind: "invalid_role" });
    });

    it("invalid_target: a person with no current membership at this org is rejected distinctly", async () => {
      const result = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: lapsedPerson },
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_target: a nonexistent group is rejected distinctly", async () => {
      const result = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "group", groupId: randomUUID() },
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });
  });

  // ---------------------------------------------------------------------
  // revokeRole — self-lockout (finding 6)
  // ---------------------------------------------------------------------

  describe("revokeRole — self-lockout", () => {
    it("blocks the sole role_grants.manage holder's own revoke, and ends_on stays null", async () => {
      const result = await revokeRole(soleHolderPerson, orgC, soleHolderGrantId);
      expect(result).toEqual({ kind: "self_lockout_blocked" });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ endsOn: roleGrants.endsOn })
        .from(roleGrants)
        .where(eq(roleGrants.id, soleHolderGrantId))
        .limit(1);
      expect(row?.endsOn).toBeNull();
    });

    it("with two holders, revoking one succeeds, then the survivor's own revoke is blocked", async () => {
      const first = await revokeRole(twoHolderA, orgD, twoHolderGrantIdA);
      expect(first).toEqual({ kind: "ok" });

      const second = await revokeRole(twoHolderB, orgD, twoHolderGrantIdB);
      expect(second).toEqual({ kind: "self_lockout_blocked" });

      const platform = getPlatformDb();
      const [survivorRow] = await platform
        .select({ endsOn: roleGrants.endsOn })
        .from(roleGrants)
        .where(eq(roleGrants.id, twoHolderGrantIdB))
        .limit(1);
      expect(survivorRow?.endsOn).toBeNull();
    });

    it("a grant whose role does NOT carry role_grants.manage skips the lockout check entirely", async () => {
      const granted = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: targetPerson },
      });
      if (granted.kind !== "ok") throw new Error("expected ok");

      const revoked = await revokeRole(clerkPerson, orgA, granted.grantId);
      expect(revoked).toEqual({ kind: "ok" });
    });
  });

  describe("revokeRole — other results", () => {
    it("returns forbidden for a viewer with no role_grants.manage", async () => {
      const result = await revokeRole(narrowPerson, orgA, randomUUID());
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("returns not_found for a grant id that doesn't exist", async () => {
      const result = await revokeRole(clerkPerson, orgA, randomUUID());
      expect(result).toEqual({ kind: "not_found" });
    });

    it("ends via ends_on, never deletes the row", async () => {
      const granted = await grantRole(clerkPerson, orgA, grantingUserId, {
        roleId: viewerRoleA,
        target: { kind: "person", personId: targetPerson },
      });
      if (granted.kind !== "ok") throw new Error("expected ok");

      const revoked = await revokeRole(clerkPerson, orgA, granted.grantId);
      expect(revoked).toEqual({ kind: "ok" });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ id: roleGrants.id, endsOn: roleGrants.endsOn })
        .from(roleGrants)
        .where(eq(roleGrants.id, granted.grantId))
        .limit(1);
      expect(row).toBeDefined();
      expect(row?.endsOn).not.toBeNull();

      // Now-ended grant is no longer "currently effective" in listGrants.
      const after = await listGrants(clerkPerson, orgA);
      if (after.kind !== "ok") throw new Error("expected ok");
      expect(after.grants.some((g) => g.grantId === granted.grantId)).toBe(
        false,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Genuine failure propagation (not swallowed into a result variant)
  // ---------------------------------------------------------------------

  describe("genuine failures propagate as thrown exceptions", () => {
    it("listGrants: not a well-formed uuid throws, not { kind: 'forbidden' }", async () => {
      await expect(listGrants("not-a-uuid", orgA)).rejects.toThrow();
    });

    it("listGrants: a person with no relationship at all throws OrgAccessError", async () => {
      await expect(listGrants(randomUUID(), orgA)).rejects.toMatchObject({
        name: "OrgAccessError",
      });
    });

    it("grantRole: a malformed startsOn throws synchronously, not returned as a result", async () => {
      await expect(
        grantRole(clerkPerson, orgA, grantingUserId, {
          roleId: viewerRoleA,
          target: { kind: "person", personId: targetPerson },
          startsOn: "not-a-date",
        }),
      ).rejects.toThrow(/startsOn/);
    });
  });
});
