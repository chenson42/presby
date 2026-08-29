/**
 * Integration tests for src/lib/groups.ts — run against a REAL Postgres
 * connection, not mocked. Follows `src/lib/officers.test.ts`'s exact harness:
 * the `hasDb` skip-guard, dynamic imports inside `beforeAll` (this file's own
 * top-level import of `./groups` would otherwise reach `@/lib/db`'s
 * module-scope pool construction before DATABASE_URL is confirmed set), and
 * a self-contained fixture created and torn down per file.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is SKIPPED
 * there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/groups.test.ts
 *
 * THE DERIVED-GROUP-GUARD REGRESSION SUITE (`describe("derived-group guard
 * ...")` below) IS THE SINGLE MOST IMPORTANT BLOCK IN THIS FILE — the
 * application-layer half of Phase 3's named, load-bearing acceptance
 * criterion (Edge Cases & Risks): `getGroup()`, `updateGroup()`, and
 * `addGroupMember()`/`endGroupMembership()` must all treat a DERIVED group
 * (Session, Board of Deacons, Active Membership) exactly as if it did not
 * exist — `invalid_target`, never a successful read or write — proving the
 * new UI's own reachable surface cannot touch one even before the
 * database's own trigger (`drizzle/0033_presby_groups_administration.sql`)
 * is consulted at all.
 *
 * THE OVERLAP REGRESSION (`describe("addGroupMember — overlap ...")`) proves
 * `addGroupMember()`'s app-level pre-check (DECISION-110 ruling 4) returns
 * `{ kind: "overlap" }` naming both the person and the group, and inserts
 * NOTHING — never a duplicate active `group_memberships` row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

// `recordAudit()` is mocked at the module boundary — same posture and same
// reason `staff.test.ts`/`officers.test.ts` document: `@/lib/audit`
// transitively imports `@/auth` (next-auth), which this test environment
// cannot resolve. `setGroupMembershipPublicListed()` (docs/work-log/
// 2026-08-28-public-directory-primitives.md) is the FIRST audited call this
// module has ever had — every other describe block in this file never
// touches an audited code path.
const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    GROUP_MEMBERSHIP_LISTED_PUBLICLY: "group_membership.listed_publicly",
    GROUP_MEMBERSHIP_UNLISTED_PUBLICLY: "group_membership.unlisted_publicly",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("groups.ts (Postgres-backed, real dev database)", () => {
  let listGroups: typeof import("./groups").listGroups;
  let listDerivedGroups: typeof import("./groups").listDerivedGroups;
  let getGroup: typeof import("./groups").getGroup;
  let getGroupFormOptions: typeof import("./groups").getGroupFormOptions;
  let createGroup: typeof import("./groups").createGroup;
  let updateGroup: typeof import("./groups").updateGroup;
  let addGroupMember: typeof import("./groups").addGroupMember;
  let endGroupMembership: typeof import("./groups").endGroupMembership;
  let setGroupMembershipPublicListed: typeof import("./groups").setGroupMembershipPublicListed;
  let setGroupMembershipPublicDisplayOrder: typeof import("./groups").setGroupMembershipPublicDisplayOrder;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let groupMemberships: typeof import("@/lib/db/domain/groups").groupMemberships;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;

  let orgA: string;
  let orgB: string;

  let clerkRoleA: string; // carries groups.manage

  let clerkPerson: string; // orgA — holds groups.manage
  let narrowPerson: string; // orgA — holds nothing
  let targetPerson: string; // orgA — current membership, no grant
  let lapsedPerson: string; // orgA — membership ended
  let overlapPerson: string; // orgA — dedicated to the overlap regression only

  let outsidePerson: string; // orgB only — cross-org invalid_target
  let noMembershipPerson: string; // no membership ANYWHERE

  let grantingUserId: string;

  let committeeTypeId: string;
  let courtTypeId: string;
  let rosterTypeId: string;

  let managedGroupA: string; // orgA — a real managed group to test against
  let sessionGroupA: string; // orgA — DERIVED, must never be touched
  let activeMembershipGroupA: string; // orgA — DERIVED, must never be touched

  beforeAll(async () => {
    ({
      listGroups,
      listDerivedGroups,
      getGroup,
      getGroupFormOptions,
      createGroup,
      updateGroup,
      addGroupMember,
      endGroupMembership,
      setGroupMembershipPublicListed,
      setGroupMembershipPublicDisplayOrder,
    } = await import("./groups"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups, groupMemberships } = await import(
      "@/lib/db/domain/groups"
    ));
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
          name: `Fixture Congregation ${label} for groups.test.ts`,
          slug: `groups-test-${label.toLowerCase()}-${stamp}`,
          path: `groups_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }

    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

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
    rosterTypeId = await findOrCreateGroupType("roster");
    courtTypeId = await findOrCreateGroupType("court");
    committeeTypeId = await findOrCreateGroupType("committee");

    async function derivedGroup(
      organizationId: string,
      groupTypeId: string,
      derivedFrom: string,
      name: string,
    ) {
      const [row] = await platform
        .insert(groups)
        .values({
          organizationId,
          groupTypeId,
          name,
          membershipSource: "derived",
          derivedFrom,
          isProtected: true,
        })
        .returning({ id: groups.id });
      return row!.id;
    }

    activeMembershipGroupA = await derivedGroup(
      orgA,
      rosterTypeId,
      "active_membership",
      "Active Membership",
    );
    sessionGroupA = await derivedGroup(orgA, courtTypeId, "session", "Session");
    await derivedGroup(orgB, rosterTypeId, "active_membership", "Active Membership");

    await platform
      .insert(permissions)
      .values({
        key: "groups.manage",
        module: "groups",
        description: "Create and edit managed groups and manage their rosters",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [userRow] = await platform
      .insert(users)
      .values({
        email: `groups-test-granter-${stamp}@example.invalid`,
        name: "Groups Test Granter",
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
      .values({ roleId: clerkRoleA, permissionKey: "groups.manage" });

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last })
        .returning({ id: people.id });
      return p!.id;
    }

    clerkPerson = await person("Ottoline", "Beaumont-Idris");
    narrowPerson = await person("Casimir", "Achterberg");
    targetPerson = await person("Genevre", "Solano-Whitfield");
    lapsedPerson = await person("Ferdinand", "Okwuosa");
    overlapPerson = await person("Marisol", "Dvorak-Achebe");

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
    await membership(orgA, overlapPerson);

    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: clerkRoleA,
      personId: clerkPerson,
      startsOn: "2020-01-01",
      grantedBy: grantingUserId,
    });

    await platform.execute(
      sql`alter table memberships disable trigger memberships_guard_end`,
    );
    try {
      await platform
        .update(memberships)
        .set({ endedOn: "2021-06-15" })
        .where(eq(memberships.personId, lapsedPerson));
    } finally {
      await platform.execute(
        sql`alter table memberships enable trigger memberships_guard_end`,
      );
    }

    // A real managed group to test reads/writes against.
    const [managedRow] = await platform
      .insert(groups)
      .values({
        organizationId: orgA,
        groupTypeId: committeeTypeId,
        name: "Property Committee (fixture)",
        membershipSource: "managed",
        derivedFrom: null,
        isProtected: false,
      })
      .returning({ id: groups.id });
    managedGroupA = managedRow!.id;

    // --- orgB: cross-org isolation fixture ------------------------------

    outsidePerson = await person("Zosima", "Krupinski");
    await membership(orgB, outsidePerson);

    noMembershipPerson = await person("Halcyon", "Petrakis");
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    const allPeople = [
      clerkPerson,
      narrowPerson,
      targetPerson,
      lapsedPerson,
      overlapPerson,
      outsidePerson,
      noMembershipPerson,
    ].filter(Boolean);

    // TEARDOWN-ONLY, NOT APPLICATION CODE: deleting an organization cascades
    // (organizations -> group_memberships, a direct onDelete: "cascade" FK,
    // src/lib/db/domain/groups.ts) through every `active_membership`-derived
    // group_memberships row this fixture's own `memberships` inserts created
    // via `presby_sync_derived_membership_group()` (drizzle/0017) — real,
    // still-open derived rows, which is EXACTLY what `drizzle/
    // 0033_presby_groups_administration.sql`'s widened DELETE-branch trigger
    // now correctly rejects (discovered here by running this suite's own
    // teardown against a real database, not by reading the SQL — the same
    // "caught by running it" discipline database-admin's own Phase 4 commit
    // 1 notes). This is a genuine cross-cutting regression the migration
    // introduces for ANY fixture that deletes an org with live memberships
    // (officers.test.ts's own afterAll hits the identical failure — verified
    // by running it), flagged in this pipeline's work-log for database-admin
    // follow-up; this file's own teardown works around it narrowly, the same
    // `alter table ... disable trigger` technique used above and in
    // `officers.test.ts`'s lapsed-membership fixture — never done in
    // application code.
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
  // Permission gate
  // ---------------------------------------------------------------------

  describe("permission gate — groups.manage checked before any read or write", () => {
    it("listGroups: forbidden for a person holding no groups.manage", async () => {
      const result = await listGroups(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getGroup: forbidden for a person holding no groups.manage", async () => {
      const result = await getGroup(narrowPerson, orgA, managedGroupA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("getGroupFormOptions: forbidden for a person holding no groups.manage", async () => {
      const result = await getGroupFormOptions(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("createGroup: forbidden for a person holding no groups.manage, AND NOTHING IS WRITTEN", async () => {
      const result = await createGroup(narrowPerson, orgA, {
        groupTypeId: committeeTypeId,
        name: "Should never be created",
      });
      expect(result).toEqual({ kind: "forbidden" });

      const after = await listGroups(clerkPerson, orgA);
      if (after.kind !== "ok") throw new Error("expected ok");
      expect(
        after.data.some((g) => g.name === "Should never be created"),
      ).toBe(false);
    });

    it("addGroupMember: forbidden for a person holding no groups.manage", async () => {
      const result = await addGroupMember(narrowPerson, orgA, {
        groupId: managedGroupA,
        personId: targetPerson,
        groupRole: "member",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("endGroupMembership: forbidden for a person holding no groups.manage", async () => {
      const result = await endGroupMembership(narrowPerson, orgA, {
        groupMembershipId: randomUUID(),
        endsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("setGroupMembershipPublicListed: forbidden for a person holding no groups.manage, and NO AUDIT FIRES", async () => {
      mockRecordAudit.mockClear();
      const result = await setGroupMembershipPublicListed(
        narrowPerson,
        orgA,
        grantingUserId,
        { groupMembershipId: randomUUID(), publicListed: true },
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("setGroupMembershipPublicDisplayOrder: forbidden for a person holding no groups.manage", async () => {
      const result = await setGroupMembershipPublicDisplayOrder(narrowPerson, orgA, {
        groupMembershipId: randomUUID(),
        publicDisplayOrder: 1,
      });
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  // ---------------------------------------------------------------------
  // createGroup — manageable-subset re-validation
  // ---------------------------------------------------------------------

  describe("createGroup — server-side group-type re-validation (Phase 3's load-bearing rule)", () => {
    it("creates a managed group for a valid manageable-subset type", async () => {
      const result = await createGroup(clerkPerson, orgA, {
        groupTypeId: committeeTypeId,
        name: "Worship Committee (fixture)",
        description: "Plans worship services",
        meetsWhen: "First Monday",
      });
      expect(result.kind).toBe("ok");
    });

    it("rejects a court-type id even if handed directly (never trusts the caller's own filtering)", async () => {
      const result = await createGroup(clerkPerson, orgA, {
        groupTypeId: courtTypeId,
        name: "Should never be created — court",
      });
      expect(result.kind).toBe("invalid_input");
      if (result.kind !== "invalid_input") return;
      expect(result.message).toMatch(/committee|small group|choir|team/i);
    });

    it("rejects a roster-type id the same way", async () => {
      const result = await createGroup(clerkPerson, orgA, {
        groupTypeId: rosterTypeId,
        name: "Should never be created — roster",
      });
      expect(result.kind).toBe("invalid_input");
    });

    it("rejects an empty name", async () => {
      const result = await createGroup(clerkPerson, orgA, {
        groupTypeId: committeeTypeId,
        name: "   ",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        message: "Name is required.",
      });
    });
  });

  // ---------------------------------------------------------------------
  // Cross-org isolation
  // ---------------------------------------------------------------------

  describe("cross-org isolation", () => {
    it("getGroup: orgB's group id is invalid_target at orgA", async () => {
      const result = await getGroup(clerkPerson, orgA, activeMembershipGroupA);
      // Reused deliberately: even orgA's OWN derived group id is
      // invalid_target here — see the dedicated derived-group-guard suite
      // below for the full assertion; this test only pins cross-org shape.
      expect(result.kind).toBe("invalid_target");
    });

    it("addGroupMember: a person with a membership only at orgB is invalid_target at orgA", async () => {
      const result = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: outsidePerson,
        groupRole: "member",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("getGroupFormOptions: orgB's person never appears in orgA's options", async () => {
      const result = await getGroupFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.data.people.some((p) => p.personId === outsidePerson),
      ).toBe(false);
    });

    it("excludes a lapsed membership from the people list (F21 shape)", async () => {
      const result = await getGroupFormOptions(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.data.people.some((p) => p.personId === lapsedPerson),
      ).toBe(false);
    });

    it("a viewer with no relationship anywhere throws OrgAccessError, not a result", async () => {
      await expect(listGroups(noMembershipPerson, orgA)).rejects.toMatchObject(
        { name: "OrgAccessError" },
      );
    });
  });

  // ---------------------------------------------------------------------
  // DERIVED-GROUP GUARD REGRESSION — the single most important block here
  // ---------------------------------------------------------------------

  describe("derived-group guard — application-layer half of Flow 2/4's load-bearing protection", () => {
    it("getGroup: a derived group's id (Session) resolves invalid_target, exactly like a nonexistent one", async () => {
      const result = await getGroup(clerkPerson, orgA, sessionGroupA);
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("getGroup: the Active Membership derived group is also invalid_target", async () => {
      const result = await getGroup(clerkPerson, orgA, activeMembershipGroupA);
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("listGroups: never returns a derived group, even though one exists at this org", async () => {
      const result = await listGroups(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.data.some((g) => g.groupId === sessionGroupA)).toBe(false);
      expect(
        result.data.some((g) => g.groupId === activeMembershipGroupA),
      ).toBe(false);
    });

    it("updateGroup: attempting to edit a derived group's name is invalid_target, and the name is UNCHANGED", async () => {
      const result = await updateGroup(clerkPerson, orgA, {
        groupId: sessionGroupA,
        name: "Hijacked Session Name",
      });
      expect(result).toEqual({ kind: "invalid_target" });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ name: groups.name })
        .from(groups)
        .where(eq(groups.id, sessionGroupA))
        .limit(1);
      expect(row?.name).toBe("Session");
    });

    it("addGroupMember: attempting to add a member to a derived group is invalid_target, and NOTHING is inserted", async () => {
      const result = await addGroupMember(clerkPerson, orgA, {
        groupId: sessionGroupA,
        personId: targetPerson,
        groupRole: "member",
        startsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "invalid_target" });

      const platform = getPlatformDb();
      const rows = await platform
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, sessionGroupA),
            eq(groupMemberships.personId, targetPerson),
          ),
        );
      expect(rows.length).toBe(0);
    });

    it("endGroupMembership: cannot end a derived (source='derived') group_memberships row — invalid_target, even for a real row id", async () => {
      // Insert a derived row directly via the platform connection, the same
      // way officer_terms_sync_derived would (bypassing this module's own
      // write path entirely, so this test proves the READ-SIDE filter, not
      // just "this module never writes one").
      const platform = getPlatformDb();
      const [derivedRow] = await platform
        .insert(groupMemberships)
        .values({
          organizationId: orgA,
          groupId: sessionGroupA,
          personId: targetPerson,
          groupRole: "member",
          source: "derived",
          startsOn: "2020-01-01",
        })
        .returning({ id: groupMemberships.id });

      try {
        const result = await endGroupMembership(clerkPerson, orgA, {
          groupMembershipId: derivedRow!.id,
          endsOn: "2026-01-01",
        });
        expect(result).toEqual({ kind: "invalid_target" });

        const [row] = await platform
          .select({ endsOn: groupMemberships.endsOn })
          .from(groupMemberships)
          .where(eq(groupMemberships.id, derivedRow!.id))
          .limit(1);
        expect(row?.endsOn).toBeNull();
      } finally {
        // Cleanup only — the trigger correctly rejects deleting an
        // already-derived row directly (that IS the invariant this pipeline
        // exists to enforce, per `drizzle/0033_presby_groups_administration.
        // sql`'s own regression suite), so this test's own teardown must
        // disable it narrowly, the same `alter table ... disable trigger`
        // technique `officers.test.ts`'s lapsed-membership fixture uses —
        // never done in application code.
        await platform.execute(
          sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
        );
        try {
          await platform
            .delete(groupMemberships)
            .where(eq(groupMemberships.id, derivedRow!.id));
        } finally {
          await platform.execute(
            sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
          );
        }
      }
    });

    it("setGroupMembershipPublicListed: cannot list a derived (source='derived') group_memberships row publicly — invalid_target, NO AUDIT FIRES, and NOTHING is written (docs/work-log/2026-08-28-public-directory-primitives.md, Phase 1 Flow 2's load-bearing guard)", async () => {
      const platform = getPlatformDb();
      const [derivedRow] = await platform
        .insert(groupMemberships)
        .values({
          organizationId: orgA,
          groupId: sessionGroupA,
          personId: targetPerson,
          groupRole: "member",
          source: "derived",
          startsOn: "2020-01-01",
        })
        .returning({ id: groupMemberships.id });

      try {
        mockRecordAudit.mockClear();
        const result = await setGroupMembershipPublicListed(
          clerkPerson,
          orgA,
          grantingUserId,
          { groupMembershipId: derivedRow!.id, publicListed: true },
        );
        expect(result).toEqual({ kind: "invalid_target" });
        expect(mockRecordAudit).not.toHaveBeenCalled();

        const [row] = await platform
          .select({ publicListed: groupMemberships.publicListed })
          .from(groupMemberships)
          .where(eq(groupMemberships.id, derivedRow!.id))
          .limit(1);
        expect(row?.publicListed).toBe(false);
      } finally {
        await platform.execute(
          sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
        );
        try {
          await platform
            .delete(groupMemberships)
            .where(eq(groupMemberships.id, derivedRow!.id));
        } finally {
          await platform.execute(
            sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
          );
        }
      }
    });

    it("setGroupMembershipPublicDisplayOrder: cannot set a curation order on a derived group_memberships row — invalid_target", async () => {
      const platform = getPlatformDb();
      const [derivedRow] = await platform
        .insert(groupMemberships)
        .values({
          organizationId: orgA,
          groupId: sessionGroupA,
          personId: targetPerson,
          groupRole: "member",
          source: "derived",
          startsOn: "2020-01-01",
        })
        .returning({ id: groupMemberships.id });

      try {
        const result = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
          groupMembershipId: derivedRow!.id,
          publicDisplayOrder: 1,
        });
        expect(result).toEqual({ kind: "invalid_target" });
      } finally {
        await platform.execute(
          sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
        );
        try {
          await platform
            .delete(groupMemberships)
            .where(eq(groupMemberships.id, derivedRow!.id));
        } finally {
          await platform.execute(
            sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
          );
        }
      }
    });
  });

  // ---------------------------------------------------------------------
  // listDerivedGroups — docs/work-log/2026-08-26-groups-show-derived.md
  // ---------------------------------------------------------------------

  describe("listDerivedGroups — read-only visibility of Session/Board of Deacons/Active Membership", () => {
    it("forbidden for a person holding no groups.manage", async () => {
      const result = await listDerivedGroups(narrowPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("returns this org's derived groups, each with its derivedFrom key, group-type name, and a member count — and never the managed fixture group", async () => {
      const result = await listDerivedGroups(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");

      expect(result.data.some((g) => g.groupId === managedGroupA)).toBe(false);

      const session = result.data.find((g) => g.groupId === sessionGroupA);
      expect(session).toEqual({
        groupId: sessionGroupA,
        name: "Session",
        groupTypeName: "court",
        memberCount: 0,
        derivedFrom: "session",
      });

      const activeMembership = result.data.find(
        (g) => g.groupId === activeMembershipGroupA,
      );
      // memberCount is NOT 0 here, unlike Session — this fixture's own
      // `membership()` inserts (clerkPerson/narrowPerson/targetPerson/
      // overlapPerson, all still open; lapsedPerson excluded) each fire
      // `presby_sync_derived_membership_group()` (drizzle/0017), which adds
      // a real `group_memberships` row to Active Membership as a SIDE
      // EFFECT of creating an ordinary membership — this is the trigger
      // this whole feature exists to surface, so asserting a real count
      // here (not asserting it away as 0) is the point.
      expect(activeMembership).toEqual({
        groupId: activeMembershipGroupA,
        name: "Active Membership",
        groupTypeName: "roster",
        memberCount: 4,
        derivedFrom: "active_membership",
      });
    });

    it("cross-org isolation: never returns another org's derived group, even one with the identical name", async () => {
      const result = await listDerivedGroups(clerkPerson, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");

      // orgB was seeded with its own "Active Membership" derived group
      // (same name, different row) in this file's own beforeAll — confirm
      // only orgA's own row (by id) comes back.
      const activeMembershipRows = result.data.filter(
        (g) => g.name === "Active Membership",
      );
      expect(activeMembershipRows).toHaveLength(1);
      expect(activeMembershipRows[0]!.groupId).toBe(activeMembershipGroupA);
    });
  });

  // ---------------------------------------------------------------------
  // addGroupMember — overlap regression
  // ---------------------------------------------------------------------

  describe("addGroupMember — overlap regression (DECISION-110 ruling 4)", () => {
    it("a second open membership for the same (group, person) is 'overlap', naming both, and inserts nothing", async () => {
      const first = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: overlapPerson,
        groupRole: "member",
        startsOn: "2026-01-01",
      });
      expect(first.kind).toBe("ok");
      if (first.kind !== "ok") return;

      const second = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: overlapPerson,
        groupRole: "chair",
        startsOn: "2026-02-01",
      });
      expect(second.kind).toBe("overlap");
      if (second.kind !== "overlap") return;
      expect(second.personName).toMatch(/Marisol|Dvorak-Achebe/);
      expect(second.groupName).toBe("Property Committee (fixture)");

      // Exactly one row exists — the failed insert left nothing behind.
      const platform = getPlatformDb();
      const rows = await platform
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, managedGroupA),
            eq(groupMemberships.personId, overlapPerson),
          ),
        );
      expect(rows.length).toBe(1);
      expect(rows[0]!.id).toBe(first.data.groupMembershipId);

      // Clean up so later tests see a stable fixture.
      await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: first.data.groupMembershipId,
        endsOn: "2026-03-01",
      });
    });

    it("re-adding the SAME person after their prior membership ended is allowed (not an overlap)", async () => {
      // overlapPerson's prior stint above was ended 2026-03-01 in the test
      // just above — a fresh, non-overlapping stint should succeed.
      const result = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: overlapPerson,
        groupRole: "member",
        startsOn: "2026-04-01",
      });
      expect(result.kind).toBe("ok");
    });
  });

  // ---------------------------------------------------------------------
  // endGroupMembership — validation and no-delete discipline
  // ---------------------------------------------------------------------

  describe("endGroupMembership", () => {
    it("invalid_target for an id that doesn't exist", async () => {
      const result = await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: randomUUID(),
        endsOn: "2026-01-01",
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("invalid_input when endsOn is before startsOn", async () => {
      const added = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: targetPerson,
        groupRole: "member",
        startsOn: "2026-05-01",
      });
      if (added.kind !== "ok") throw new Error("expected ok");

      const result = await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        endsOn: "2026-04-01",
      });
      expect(result).toEqual({
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      });

      await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        endsOn: "2026-06-01",
      });
    });

    it("ends via ends_on on the SAME row — never deletes", async () => {
      const added = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: clerkPerson,
        groupRole: "leader",
        startsOn: "2026-07-01",
      });
      if (added.kind !== "ok") throw new Error("expected ok");

      const ended = await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        endsOn: "2026-08-01",
      });
      expect(ended).toEqual({
        kind: "ok",
        data: { groupMembershipId: added.data.groupMembershipId },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ id: groupMemberships.id, endsOn: groupMemberships.endsOn })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, added.data.groupMembershipId))
        .limit(1);
      expect(row).toBeDefined();
      expect(row?.endsOn).toBe("2026-08-01");
    });
  });

  // ---------------------------------------------------------------------
  // setGroupMembershipPublicListed / setGroupMembershipPublicDisplayOrder —
  // public committee-directory primitives (docs/work-log/
  // 2026-08-28-public-directory-primitives.md, Phase 3)
  // ---------------------------------------------------------------------

  describe("setGroupMembershipPublicListed", () => {
    afterAll(() => {
      mockRecordAudit.mockClear();
    });

    it("invalid_target for a groupMembershipId that doesn't exist", async () => {
      const result = await setGroupMembershipPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { groupMembershipId: randomUUID(), publicListed: true },
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("invalid_target for a membership belonging to a DIFFERENT org", async () => {
      const platform = getPlatformDb();
      const [orgBGroup] = await platform
        .insert(groups)
        .values({
          organizationId: orgB,
          groupTypeId: committeeTypeId,
          name: "Cross-Org Committee (fixture)",
          membershipSource: "managed",
          derivedFrom: null,
          isProtected: false,
        })
        .returning({ id: groups.id });
      const [crossOrgMembership] = await platform
        .insert(groupMemberships)
        .values({
          organizationId: orgB,
          groupId: orgBGroup!.id,
          personId: outsidePerson,
          groupRole: "member",
          source: "managed",
          startsOn: "2020-01-01",
        })
        .returning({ id: groupMemberships.id });

      const result = await setGroupMembershipPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { groupMembershipId: crossOrgMembership!.id, publicListed: true },
      );
      expect(result).toEqual({ kind: "invalid_target" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    // Explicit timeout: ~8 sequential real-Postgres round trips (add, ON
    // toggle, read, OFF toggle, read, end) — this repo's own shared-dev-DB
    // contention has been observed to push this past the default 5000ms.
    it(
      "ON: sets publicListed/publicListedBy/publicListedAt and records GROUP_MEMBERSHIP_LISTED_PUBLICLY, then OFF the same way",
      async () => {
      const added = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: targetPerson,
        groupRole: "member",
        startsOn: "2026-09-01",
      });
      expect(added.kind).toBe("ok");
      if (added.kind !== "ok") return;

      mockRecordAudit.mockClear();
      const result = await setGroupMembershipPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { groupMembershipId: added.data.groupMembershipId, publicListed: true },
      );
      expect(result).toEqual({
        kind: "ok",
        data: {
          groupMembershipId: added.data.groupMembershipId,
          publicListed: true,
        },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith({
        action: "group_membership.listed_publicly",
        resourceType: "group_membership",
        resourceId: added.data.groupMembershipId,
        metadata: { organizationId: orgA, publicListed: true },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({
          publicListed: groupMemberships.publicListed,
          publicListedBy: groupMemberships.publicListedBy,
          publicListedAt: groupMemberships.publicListedAt,
        })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, added.data.groupMembershipId));
      expect(row?.publicListed).toBe(true);
      expect(row?.publicListedBy).toBe(grantingUserId);
      expect(row?.publicListedAt).not.toBeNull();

      // OFF direction: every call writes publicListedBy/At — including
      // turning it back off — never leaves a stale "last listed" trail
      // (matching setStaffPositionPublicListed's own departure from
      // recordedBy's "set once" precedent).
      mockRecordAudit.mockClear();
      const off = await setGroupMembershipPublicListed(
        clerkPerson,
        orgA,
        grantingUserId,
        { groupMembershipId: added.data.groupMembershipId, publicListed: false },
      );
      expect(off).toEqual({
        kind: "ok",
        data: {
          groupMembershipId: added.data.groupMembershipId,
          publicListed: false,
        },
      });
      expect(mockRecordAudit).toHaveBeenCalledWith({
        action: "group_membership.unlisted_publicly",
        resourceType: "group_membership",
        resourceId: added.data.groupMembershipId,
        metadata: { organizationId: orgA, publicListed: false },
      });

      const [offRow] = await platform
        .select({ publicListed: groupMemberships.publicListed })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, added.data.groupMembershipId));
      expect(offRow?.publicListed).toBe(false);

      // Clean up so later tests see a stable fixture (targetPerson holds no
      // open managedGroupA row afterward) — matching the addGroupMember
      // overlap regression's own "clean up" precedent.
      await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        endsOn: "2026-09-02",
      });
      },
      15000,
    );
  });

  describe("setGroupMembershipPublicDisplayOrder", () => {
    it("invalid_target for a groupMembershipId that doesn't exist", async () => {
      const result = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
        groupMembershipId: randomUUID(),
        publicDisplayOrder: 1,
      });
      expect(result).toEqual({ kind: "invalid_target" });
    });

    // Explicit timeout: this test makes ~10 sequential real-Postgres round
    // trips (add, three invalid-input attempts, set, read, clear, read, end)
    // — comfortably under the default 5000ms in isolation, but the combined
    // margin has been observed to exceed it under this repo's own documented
    // shared-dev-DB contention, not a regression this test introduces.
    it(
      "validates bounds, sets a valid integer, clears it back to null, and never calls recordAudit",
      async () => {
      // targetPerson's prior managedGroupA stint (setGroupMembershipPublic
      // Listed's own ON/OFF test) was ended 2026-09-02 above — a fresh,
      // non-overlapping stint here reuses the same, already-available
      // fixture person rather than reaching for a dedicated one.
      const added = await addGroupMember(clerkPerson, orgA, {
        groupId: managedGroupA,
        personId: targetPerson,
        groupRole: "member",
        startsOn: "2026-09-03",
      });
      expect(added.kind).toBe("ok");
      if (added.kind !== "ok") return;

      mockRecordAudit.mockClear();

      const negative = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        publicDisplayOrder: -1,
      });
      expect(negative.kind).toBe("invalid_input");

      const nonInteger = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        publicDisplayOrder: 1.5,
      });
      expect(nonInteger.kind).toBe("invalid_input");

      const overflow = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        publicDisplayOrder: 2147483648,
      });
      expect(overflow.kind).toBe("invalid_input");

      const set = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        publicDisplayOrder: 5,
      });
      expect(set).toEqual({
        kind: "ok",
        data: {
          groupMembershipId: added.data.groupMembershipId,
          publicDisplayOrder: 5,
        },
      });

      const platform = getPlatformDb();
      const [row] = await platform
        .select({ publicDisplayOrder: groupMemberships.publicDisplayOrder })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, added.data.groupMembershipId));
      expect(row?.publicDisplayOrder).toBe(5);

      const cleared = await setGroupMembershipPublicDisplayOrder(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        publicDisplayOrder: null,
      });
      expect(cleared).toEqual({
        kind: "ok",
        data: {
          groupMembershipId: added.data.groupMembershipId,
          publicDisplayOrder: null,
        },
      });

      // None of the calls above — valid or invalid — ever call recordAudit:
      // presentation-order only, not a disclosure fact (unlike this
      // describe's setGroupMembershipPublicListed sibling above).
      expect(mockRecordAudit).not.toHaveBeenCalled();

      const [clearedRow] = await platform
        .select({ publicDisplayOrder: groupMemberships.publicDisplayOrder })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, added.data.groupMembershipId));
      expect(clearedRow?.publicDisplayOrder).toBeNull();

      await endGroupMembership(clerkPerson, orgA, {
        groupMembershipId: added.data.groupMembershipId,
        endsOn: "2026-09-04",
      });
      },
      20000,
    );
  });

  // ---------------------------------------------------------------------
  // Genuine failure propagation
  // ---------------------------------------------------------------------

  describe("genuine failures propagate as thrown exceptions", () => {
    it("addGroupMember: a malformed startsOn throws synchronously, not returned as a result", async () => {
      await expect(
        addGroupMember(clerkPerson, orgA, {
          groupId: managedGroupA,
          personId: targetPerson,
          groupRole: "member",
          startsOn: "not-a-date",
        }),
      ).rejects.toThrow(/startsOn/);
    });

    it("addGroupMember: an unrecognized groupRole throws", async () => {
      await expect(
        addGroupMember(clerkPerson, orgA, {
          groupId: managedGroupA,
          personId: targetPerson,
          // @ts-expect-error — deliberately invalid for this test
          groupRole: "president",
          startsOn: "2026-01-01",
        }),
      ).rejects.toThrow(/groupRole/);
    });

    it("endGroupMembership: a malformed endsOn throws synchronously", async () => {
      await expect(
        endGroupMembership(clerkPerson, orgA, {
          groupMembershipId: randomUUID(),
          endsOn: "not-a-date",
        }),
      ).rejects.toThrow(/endsOn/);
    });

    it("listGroups: a person with no relationship at all throws OrgAccessError", async () => {
      await expect(listGroups(randomUUID(), orgA)).rejects.toMatchObject({
        name: "OrgAccessError",
      });
    });
  });
});
