/**
 * Regression test for QA's Phase 5 loop-back finding
 * (`docs/work-log/2026-08-27-staff-and-personnel.md`): `createStaffPersonAction`
 * previously relied ONLY on `createPerson()`'s internal `people.manage` check
 * and never verified `staff.manage` anywhere in its own call path — a session
 * holding `people.manage` alone (no `staff.manage` grant, no `personnel_admin`
 * role) could invoke this staff-specific Server Action directly (a Server
 * Action's parameter type is not a runtime trust boundary — the UI hiding the
 * affordance is not the enforcement) and create a new `people`/`memberships`
 * row anchored `engagementStatus: "staff"`.
 *
 * Per the architect's Phase 2 ruling (DECISION-128, `docs/decisions.md`),
 * creating a brand-new person from the staff-hiring surface requires BOTH
 * `staff.manage` AND `people.manage` — a `staff.manage`-only holder may still
 * attach a position to an EXISTING matched person via
 * `startStaffPositionAction`, but a `people.manage`-only holder (no
 * `staff.manage` grant at all) must NOT be able to use THIS action to anchor
 * a new person as staff.
 *
 * Run against a REAL Postgres connection, not mocked — same `hasDb`
 * skip-guard, dynamic-imports-inside-`beforeAll`, self-contained
 * fixture-created-and-torn-down-per-file harness `src/lib/staff.test.ts`/
 * `src/lib/people.test.ts` use. `@/auth`'s `auth()` and `@/lib/authz`'s
 * `resolveOrgContext` are the only two things mocked — matching
 * `admin/officers/actions.test.ts`'s own boundary (a Server Action's identity
 * resolution needs a real `users` row wired all the way through
 * `presby_user_organizations()`, which no test in this codebase fabricates).
 * Everything downstream of that — `hasPermission()` (this fix's own new call),
 * `createPerson()`, and real `permissions`/`app_roles`/`role_grants` rows — is
 * the REAL, unmocked implementation, so this test proves the actual
 * `staff.manage` gate fires, not a mock standing in for it.
 *
 * `npm test` in CI does not set DATABASE_URL, so this suite is SKIPPED there,
 * not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run "src/app/(org)/o/[slug]/admin/staff/actions.test.ts"
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

// Partial mock: override ONLY `resolveOrgContext` (identity resolution needs
// a real `users` row wired through `presby_user_organizations()`, which no
// fixture in this codebase builds) while keeping `hasPermission()` — the
// function this fix actually adds a call to — REAL and unmocked.
const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, resolveOrgContext: mockResolveOrgContext };
});

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "admin/staff/actions.ts createStaffPersonAction (Postgres-backed, real dev database)",
  () => {
    let createStaffPersonAction: typeof import("./actions").createStaffPersonAction;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let rollActions: typeof import("@/lib/db/domain/roll").rollActions;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let users: typeof import("@/lib/db/schema").users;

    const stamp = Date.now();
    const SLUG = "staff-actions-test-org";

    let orgA: string;
    let peopleManageOnlyPerson: string; // people.manage ONLY — NO staff.manage
    let bothPermissionsPerson: string; // people.manage AND staff.manage
    let grantingUserId: string;

    const trackedPeopleIds: string[] = [];

    beforeAll(async () => {
      ({ createStaffPersonAction } = await import("./actions"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ rollActions } = await import("@/lib/db/domain/roll"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();

      const [orgRow] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: "Fixture Congregation for admin/staff/actions.test.ts",
          slug: `staff-actions-test-${stamp}`,
          path: `staff_actions_test_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      orgA = orgRow!.id;

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
      await platform.insert(groups).values({
        organizationId: orgA,
        groupTypeId: rosterTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });

      // Permission catalog — already seeded by drizzle/0039 (staff.manage)
      // and the platform seed (people.manage) in a real dev database, but
      // onConflictDoNothing keeps this file self-sufficient.
      await platform
        .insert(permissions)
        .values([
          {
            key: "people.manage",
            module: "people",
            description:
              "Create and edit people, households, and contact/address detail",
            sensitivityTier: 1,
          },
          {
            key: "staff.manage",
            module: "staff",
            description:
              "Record and end paid, non-ordained staff positions for this organization",
            sensitivityTier: 1,
          },
        ])
        .onConflictDoNothing();

      const [peopleOnlyRole] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "people_manage_only_action_test",
          name: "People Manager Only (action test)",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: peopleOnlyRole!.id, permissionKey: "people.manage" });

      const [bothRole] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "staff_and_people_manage_action_test",
          name: "Personnel Administrator + People Manager (action test)",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform.insert(appRolePermissions).values([
        { roleId: bothRole!.id, permissionKey: "people.manage" },
        { roleId: bothRole!.id, permissionKey: "staff.manage" },
      ]);

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        trackedPeopleIds.push(p!.id);
        return p!.id;
      }
      peopleManageOnlyPerson = await person("Fenwick", `PeopleOnlyAction${stamp}`);
      bothPermissionsPerson = await person("Griselda", `BothGrantsAction${stamp}`);

      await platform.insert(memberships).values([
        {
          organizationId: orgA,
          personId: peopleManageOnlyPerson,
          engagementStatus: "regular",
        },
        {
          organizationId: orgA,
          personId: bothPermissionsPerson,
          engagementStatus: "regular",
        },
      ]);

      const [u] = await platform
        .insert(users)
        .values({
          email: `staff-actions-test-${stamp}@example.invalid`,
          name: "Fixture Granter",
        })
        .returning({ id: users.id });
      grantingUserId = u!.id;

      await platform.insert(roleGrants).values([
        {
          organizationId: orgA,
          roleId: peopleOnlyRole!.id,
          personId: peopleManageOnlyPerson,
          startsOn: "2020-01-01",
          grantedBy: grantingUserId,
        },
        {
          organizationId: orgA,
          roleId: bothRole!.id,
          personId: bothPermissionsPerson,
          startsOn: "2020-01-01",
          grantedBy: grantingUserId,
        },
      ]);
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // Same ordering hazard `people.test.ts`'s own afterAll documents:
      // group_memberships_reject_derived would otherwise block the cascading
      // delete of this fixture's own Active Membership derived group row.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        await platform.delete(organizations).where(eq(organizations.id, orgA));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      for (const id of trackedPeopleIds) {
        await platform.delete(people).where(eq(people.id, id));
      }
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    function sessionFor(personId: string) {
      mockAuth.mockResolvedValueOnce({
        user: { id: grantingUserId, email: "fixture@example.invalid" },
      });
      mockResolveOrgContext.mockResolvedValueOnce({
        kind: "ok",
        org: {
          organizationId: orgA,
          personId,
          name: "Fixture Congregation",
          organizationType: "congregation" as const,
          slug: SLUG,
          platformStatus: "managed" as const,
        },
      });
    }

    it("forbidden for a session holding people.manage ONLY (no staff.manage) — regression for the missing staff.manage gate", async () => {
      sessionFor(peopleManageOnlyPerson);

      const result = await createStaffPersonAction(SLUG, {
        identity: {
          mode: "new",
          firstName: "Should",
          lastName: `NeverExistStaffAction${stamp}`,
        },
        contact: {},
        household: { mode: "none" },
        rollAction: { kind: "none" },
      });

      expect(result).toEqual({
        ok: false,
        error: "You don't have permission to manage staff here.",
      });

      // Nothing written — the gate fires BEFORE createPerson() is ever
      // called, so no orphaned `people` row exists either.
      const platform = getPlatformDb();
      const [orphan] = await platform
        .select({ id: people.id })
        .from(people)
        .where(eq(people.lastName, `NeverExistStaffAction${stamp}`))
        .limit(1);
      expect(orphan).toBeUndefined();
    });

    it("succeeds for a session holding BOTH staff.manage AND people.manage", async () => {
      sessionFor(bothPermissionsPerson);

      const result = await createStaffPersonAction(SLUG, {
        identity: {
          mode: "new",
          firstName: "Marisol",
          lastName: `StaffHireAction${stamp}`,
        },
        contact: { email: `staff-hire-action-${stamp}@example.invalid` },
        household: { mode: "none" },
        rollAction: { kind: "none" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      const personId = result.data.personId;
      trackedPeopleIds.push(personId);

      const platform = getPlatformDb();

      // Anchored as staff (DECISION-129), not a fabricated roll event.
      const [membershipRow] = await platform
        .select({
          engagementStatus: memberships.engagementStatus,
          currentRoll: memberships.currentRoll,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, personId),
            eq(memberships.organizationId, orgA),
          ),
        );
      expect(membershipRow).toEqual({ engagementStatus: "staff", currentRoll: null });

      const rollActionRows = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.personId, personId));
      expect(rollActionRows).toHaveLength(0);
    });
  },
);
