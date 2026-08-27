/**
 * Integration tests for src/lib/org-features.ts — run against a REAL
 * Postgres connection, not mocked (`role-grants.test.ts`'s own harness:
 * `hasDb` skip-guard, dynamic imports inside `beforeAll`, a self-contained
 * fixture created and torn down per file). `npm test` in CI does not set
 * DATABASE_URL, so this whole suite is SKIPPED there, not failed. Run for
 * real with:
 *   dotenv -e .env.local -- vitest run src/lib/org-features.test.ts
 *
 * `recordAudit()` is mocked at the module boundary — org-features.ts calls
 * it directly (this pipeline's Phase 4 note explains the divergence from
 * role-grants.ts's split), and mocking it here is the same "prove the call,
 * not the side effect" posture actions.test.ts files across this tree
 * already use for the same function. Same reason those files hardcode the
 * `AUDIT_ACTIONS` literal rather than `importOriginal`-ing the real module:
 * `@/lib/audit` transitively imports `@/auth` (next-auth), which this test
 * environment cannot resolve (`next/server` vs `next/server.js`) —
 * `admin/roles/actions.test.ts` hit the identical constraint first.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "org-features.ts (Postgres-backed, real dev database)",
  () => {
    let isOrgFeatureEnabled: typeof import("./org-features").isOrgFeatureEnabled;
    let listFeatureToggles: typeof import("./org-features").listFeatureToggles;
    let toggleOrgFeature: typeof import("./org-features").toggleOrgFeature;
    let AUDIT_ACTIONS: typeof import("@/lib/audit").AUDIT_ACTIONS;
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
    let organizationFeatureToggles: typeof import("@/lib/db/domain/org-features").organizationFeatureToggles;
    let users: typeof import("@/lib/db/schema").users;

    const KEY = "org_portal.members_create";

    let orgA: string;
    let orgB: string;
    let managerPerson: string; // orgA — holds org_features.manage
    let outsiderPerson: string; // orgA — no grant at all
    let orgBPerson: string; // orgB — holds org_features.manage at orgB only
    let grantingUserId: string;

    beforeAll(async () => {
      ({ isOrgFeatureEnabled, listFeatureToggles, toggleOrgFeature } =
        await import("./org-features"));
      ({ AUDIT_ACTIONS } = await import("@/lib/audit"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));
      ({ organizationFeatureToggles } = await import(
        "@/lib/db/domain/org-features"
      ));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for org-features.test.ts`,
            slug: `org-features-test-${label.toLowerCase()}-${stamp}`,
            path: `org_features_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }
      orgA = await makeOrg("A");
      orgB = await makeOrg("B");

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

      await platform
        .insert(permissions)
        .values({
          key: "org_features.manage",
          module: "org_features",
          description: "Turn optional portal features on or off",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();

      const [managerRoleA] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "features_manager",
          name: "Features Manager",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: managerRoleA!.id, permissionKey: "org_features.manage" });

      const [managerRoleB] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgB,
          key: "features_manager",
          name: "Features Manager",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: managerRoleB!.id, permissionKey: "org_features.manage" });

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        return p!.id;
      }
      managerPerson = await person("Marisol", "Okafor");
      outsiderPerson = await person("Talbot", "Wrenfield");
      orgBPerson = await person("Idris", "Fennimore");

      await platform.insert(memberships).values([
        { organizationId: orgA, personId: managerPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: outsiderPerson, engagementStatus: "regular" },
        { organizationId: orgB, personId: orgBPerson, engagementStatus: "regular" },
      ]);

      await platform.insert(roleGrants).values([
        {
          organizationId: orgA,
          roleId: managerRoleA!.id,
          personId: managerPerson,
          startsOn: "2020-01-01",
        },
        {
          organizationId: orgB,
          roleId: managerRoleB!.id,
          personId: orgBPerson,
          startsOn: "2020-01-01",
        },
      ]);

      const [u] = await platform
        .insert(users)
        .values({
          email: `org-features-test-${stamp}@example.invalid`,
          name: "Fixture Manager",
        })
        .returning({ id: users.id });
      grantingUserId = u!.id;
    });

    afterEach(() => {
      mockRecordAudit.mockClear();
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      await platform
        .delete(organizationFeatureToggles)
        .where(eq(organizationFeatureToggles.organizationId, orgA));
      await platform
        .delete(organizationFeatureToggles)
        .where(eq(organizationFeatureToggles.organizationId, orgB));
      // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
      // 110) also rejects the DELETE that cascading `organizations` fires
      // against this fixture's own active_membership-derived group_memberships
      // rows — disable it around the cascade, same as roll.test.ts's own
      // teardown does for roll_actions_freeze.
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
      await platform
        .delete(people)
        .where(eq(people.id, managerPerson));
      await platform.delete(people).where(eq(people.id, outsiderPerson));
      await platform.delete(people).where(eq(people.id, orgBPerson));
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    it("isOrgFeatureEnabled: false on a missing row", async () => {
      const enabled = await isOrgFeatureEnabled(managerPerson, orgA, KEY);
      expect(enabled).toBe(false);
    });

    it("toggleOrgFeature: forbidden without org_features.manage", async () => {
      const result = await toggleOrgFeature(
        outsiderPerson,
        orgA,
        grantingUserId,
        KEY,
        true,
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("toggleOrgFeature: invalid_key on an unlisted key", async () => {
      const result = await toggleOrgFeature(
        managerPerson,
        orgA,
        grantingUserId,
        "not_a_real_feature_key",
        true,
      );
      expect(result).toEqual({ kind: "invalid_key" });
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("toggleOrgFeature: turns a feature on, audits, and isOrgFeatureEnabled reflects it", async () => {
      const result = await toggleOrgFeature(
        managerPerson,
        orgA,
        grantingUserId,
        KEY,
        true,
      );
      expect(result).toEqual({ kind: "ok" });
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.ORG_FEATURE_TOGGLED,
          resourceId: KEY,
          metadata: { organizationId: orgA, featureKey: KEY, enabled: true },
        }),
      );

      const enabled = await isOrgFeatureEnabled(managerPerson, orgA, KEY);
      expect(enabled).toBe(true);
    });

    it("toggleOrgFeature: upsert is idempotent and untoggling flips isOrgFeatureEnabled back", async () => {
      await toggleOrgFeature(managerPerson, orgA, grantingUserId, KEY, true);
      await toggleOrgFeature(managerPerson, orgA, grantingUserId, KEY, true);
      expect(await isOrgFeatureEnabled(managerPerson, orgA, KEY)).toBe(true);

      const result = await toggleOrgFeature(
        managerPerson,
        orgA,
        grantingUserId,
        KEY,
        false,
      );
      expect(result).toEqual({ kind: "ok" });
      expect(await isOrgFeatureEnabled(managerPerson, orgA, KEY)).toBe(false);
    });

    it("isOrgFeatureEnabled: cross-org isolation — orgB's toggle never leaks into orgA's answer", async () => {
      await toggleOrgFeature(managerPerson, orgA, grantingUserId, KEY, false);
      const [orgBManagerRow] = await getPlatformDb()
        .select({ id: appRoles.id })
        .from(appRoles)
        .where(eq(appRoles.organizationId, orgB));
      await toggleOrgFeature(orgBPerson, orgB, grantingUserId, KEY, true);

      expect(await isOrgFeatureEnabled(managerPerson, orgA, KEY)).toBe(false);
      expect(await isOrgFeatureEnabled(orgBPerson, orgB, KEY)).toBe(true);
      void orgBManagerRow;
    });

    it("listFeatureToggles: forbidden without org_features.manage", async () => {
      const result = await listFeatureToggles(outsiderPerson, orgA);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("listFeatureToggles: every catalog entry present, missing rows default to disabled", async () => {
      const result = await listFeatureToggles(managerPerson, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const entry = result.toggles.find((t) => t.key === KEY);
      expect(entry).toBeDefined();
      expect(typeof entry!.enabled).toBe("boolean");
    });
  },
);
