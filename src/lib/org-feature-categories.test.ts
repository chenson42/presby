/**
 * Tests for src/lib/org-feature-categories.ts (docs/work-log/
 * 2026-08-27-feature-categories.md, Phase 3/4; DECISION-130).
 *
 * EVERYTHING in this file, including `offeredCategories()` (which makes no
 * DB call itself), lives inside the single `hasDb`-gated suite below —
 * matching `org-features.ts`'s own test file, which likewise has no
 * separate "pure, no DB" test path for any of its exports. This is not a
 * missed opportunity: a static OR dynamic import of ANY export from
 * `./org-feature-categories` drags in `@/lib/db/domain/org-feature-categories`
 * (the schema file), which imports `../schema` (`db/schema.ts`) for `users`
 * — and `db/schema.ts` ends with `export * from "./domain"`, re-entering the
 * domain barrel mid-evaluation. Confirmed live (not assumed) that importing
 * EITHER this module OR its already-shipped sibling
 * `@/lib/db/domain/org-features.ts` in complete isolation (i.e. as the very
 * first import in a file, before `@/lib/db` has "primed" the module graph
 * the way every real request path does) throws `organizationType is not a
 * function` from `db/domain/authz.ts` — a pre-existing circular-import
 * fragility in the schema module graph, not something this pipeline's
 * schema file introduces, and out of this pipeline's scope to fix. Mocking
 * `@/lib/authz`/`@/lib/flags` to dodge it (as `org-portal/tiles.test.ts`
 * does for its own DB-adjacent import) does not help here, because THIS
 * module's schema import chain runs through `@/lib/db/schema` directly, not
 * through either of those two files.
 *
 * `hasDb` skip-guard, dynamic imports inside `beforeAll`, a self-contained
 * fixture created and torn down per file — same harness as
 * `org-features.test.ts`. `npm test` in CI does not set DATABASE_URL, so
 * this whole suite is SKIPPED there, not failed. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/org-feature-categories.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

// Vitest hoists vi.mock calls above the imports below, same shape as
// org-features.test.ts's own identical line.
vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "org-feature-categories.ts (Postgres-backed, real dev database)",
  () => {
    let categoryEnabledInTx: typeof import("./org-feature-categories").categoryEnabledInTx;
    let listFeatureCategories: typeof import("./org-feature-categories").listFeatureCategories;
    let toggleOrgFeatureCategory: typeof import("./org-feature-categories").toggleOrgFeatureCategory;
    let isOrgFeatureCategoryEnabled: typeof import("./org-feature-categories").isOrgFeatureCategoryEnabled;
    let offeredCategories: typeof import("./org-feature-categories").offeredCategories;
    let withOrgContext: typeof import("@/lib/authz").withOrgContext;
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
    let organizationFeatureCategories: typeof import("@/lib/db/domain/org-feature-categories").organizationFeatureCategories;
    let users: typeof import("@/lib/db/schema").users;

    let orgA: string;
    let orgB: string;
    let managerPerson: string; // orgA — holds org_features.manage
    let outsiderPerson: string; // orgA — no grant at all
    let orgBPerson: string; // orgB — holds org_features.manage at orgB only
    let grantingUserId: string;

    beforeAll(async () => {
      ({
        categoryEnabledInTx,
        listFeatureCategories,
        toggleOrgFeatureCategory,
        isOrgFeatureCategoryEnabled,
        offeredCategories,
      } = await import("./org-feature-categories"));
      ({ withOrgContext } = await import("@/lib/authz"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));
      ({ organizationFeatureCategories } = await import(
        "@/lib/db/domain/org-feature-categories"
      ));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for org-feature-categories.test.ts`,
            slug: `org-feature-categories-test-${label.toLowerCase()}-${stamp}`,
            path: `org_feature_categories_test_${label.toLowerCase()}_${stamp}`,
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
      managerPerson = await person("Ottoline", "Fairweather");
      outsiderPerson = await person("Bramwell", "Ashdown");
      orgBPerson = await person("Perpetua", "Nightingale");

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
          email: `org-feature-categories-test-${stamp}@example.invalid`,
          name: "Fixture Manager",
        })
        .returning({ id: users.id });
      grantingUserId = u!.id;
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      await platform
        .delete(organizationFeatureCategories)
        .where(eq(organizationFeatureCategories.organizationId, orgA));
      await platform
        .delete(organizationFeatureCategories)
        .where(eq(organizationFeatureCategories.organizationId, orgB));
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
      await platform.delete(people).where(eq(people.id, managerPerson));
      await platform.delete(people).where(eq(people.id, outsiderPerson));
      await platform.delete(people).where(eq(people.id, orgBPerson));
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    describe("offeredCategories() — derived from PORTAL_TILES, never a hand-maintained mapping (Phase 1/2 ruling)", () => {
      it("congregation: never includes administration, includes every universal domain", () => {
        const categories = offeredCategories("congregation");
        expect(categories).not.toContain("administration");
        expect(categories).toEqual(
          expect.arrayContaining([
            "people",
            "worship",
            "giving",
            "governance",
            "reports",
            "communications",
          ]),
        );
      });

      it("congregation: governance is offered even though credentials/committees/oversight are presbytery-only (Phase 1 Gap 3 — 'officers' alone makes the domain universal)", () => {
        expect(offeredCategories("congregation")).toContain("governance");
      });

      it("presbytery: also offers every domain (governance carries both universal and presbytery-only tiles)", () => {
        const categories = offeredCategories("presbytery");
        expect(categories).not.toContain("administration");
        expect(categories).toEqual(
          expect.arrayContaining([
            "people",
            "worship",
            "giving",
            "governance",
            "reports",
            "communications",
          ]),
        );
      });

      it("order follows DOMAIN_ORDER, not declaration order in PORTAL_TILES", () => {
        expect(offeredCategories("congregation")).toEqual([
          "people",
          "worship",
          "giving",
          "governance",
          "reports",
          "communications",
        ]);
      });

      it("is never empty for any organization type (Phase 3 Component Plan: no empty-state to design for)", () => {
        for (const type of [
          "congregation",
          "presbytery",
          "synod",
          "general_assembly",
          "new_worshiping_community",
        ] as const) {
          expect(offeredCategories(type).length).toBeGreaterThan(0);
        }
      });
    });

    it("categoryEnabledInTx: DEFAULT-ON — true on a missing row (the load-bearing deviation, DECISION-130)", async () => {
      const enabled = await withOrgContext(managerPerson, orgA, (tx) =>
        categoryEnabledInTx(tx, orgA, "worship"),
      );
      expect(enabled).toBe(true);
    });

    it("categoryEnabledInTx: an explicit enabled=false row restricts", async () => {
      await toggleOrgFeatureCategory(
        managerPerson,
        orgA,
        grantingUserId,
        "worship",
        false,
      );
      const enabled = await withOrgContext(managerPerson, orgA, (tx) =>
        categoryEnabledInTx(tx, orgA, "worship"),
      );
      expect(enabled).toBe(false);
    });

    it("categoryEnabledInTx: an explicit enabled=true row still reads true (not merely absence)", async () => {
      await toggleOrgFeatureCategory(
        managerPerson,
        orgA,
        grantingUserId,
        "worship",
        true,
      );
      const enabled = await withOrgContext(managerPerson, orgA, (tx) =>
        categoryEnabledInTx(tx, orgA, "worship"),
      );
      expect(enabled).toBe(true);
    });

    it("toggleOrgFeatureCategory: forbidden without org_features.manage", async () => {
      const result = await toggleOrgFeatureCategory(
        outsiderPerson,
        orgA,
        grantingUserId,
        "giving",
        false,
      );
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("toggleOrgFeatureCategory: invalid_category on 'administration' (Phase 1 Gap 2) and on garbage", async () => {
      const adminResult = await toggleOrgFeatureCategory(
        managerPerson,
        orgA,
        grantingUserId,
        "administration",
        false,
      );
      expect(adminResult).toEqual({ kind: "invalid_category" });

      const garbageResult = await toggleOrgFeatureCategory(
        managerPerson,
        orgA,
        grantingUserId,
        "not_a_real_category",
        false,
      );
      expect(garbageResult).toEqual({ kind: "invalid_category" });
    });

    it("toggleOrgFeatureCategory: the CHECK constraint independently rejects 'administration' if the resolver guard were ever bypassed (defense in depth, DECISION-130)", async () => {
      await expect(
        withOrgContext(managerPerson, orgA, async (tx) => {
          await tx.execute(sql`
            insert into organization_feature_categories (organization_id, category, enabled)
            values (${orgA}::uuid, 'administration', true)
          `);
        }),
      ).rejects.toThrow();
    });

    it("toggleOrgFeatureCategory: upsert is idempotent and untoggling flips categoryEnabledInTx back", async () => {
      await toggleOrgFeatureCategory(managerPerson, orgA, grantingUserId, "giving", false);
      await toggleOrgFeatureCategory(managerPerson, orgA, grantingUserId, "giving", false);
      expect(
        await withOrgContext(managerPerson, orgA, (tx) =>
          categoryEnabledInTx(tx, orgA, "giving"),
        ),
      ).toBe(false);

      const result = await toggleOrgFeatureCategory(
        managerPerson,
        orgA,
        grantingUserId,
        "giving",
        true,
      );
      expect(result).toEqual({ kind: "ok" });
      expect(
        await withOrgContext(managerPerson, orgA, (tx) =>
          categoryEnabledInTx(tx, orgA, "giving"),
        ),
      ).toBe(true);
    });

    it("cross-org isolation: orgB's category row never leaks into orgA's default-on answer", async () => {
      await toggleOrgFeatureCategory(
        orgBPerson,
        orgB,
        grantingUserId,
        "communications",
        false,
      );
      expect(
        await withOrgContext(managerPerson, orgA, (tx) =>
          categoryEnabledInTx(tx, orgA, "communications"),
        ),
      ).toBe(true);
      expect(
        await withOrgContext(orgBPerson, orgB, (tx) =>
          categoryEnabledInTx(tx, orgB, "communications"),
        ),
      ).toBe(false);
    });

    it("listFeatureCategories: forbidden without org_features.manage", async () => {
      const result = await listFeatureCategories(
        outsiderPerson,
        orgA,
        "congregation",
      );
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("listFeatureCategories: every offered category present, missing rows default to ENABLED (not disabled — the deviation)", async () => {
      const result = await listFeatureCategories(
        managerPerson,
        orgA,
        "congregation",
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.categories.map((c) => c.category)).not.toContain(
        "administration",
      );
      const reports = result.categories.find((c) => c.category === "reports");
      expect(reports).toBeDefined();
      expect(reports!.enabled).toBe(true);
      expect(reports!.updatedAt).toBeNull();
    });

    it("isOrgFeatureCategoryEnabled: false on an invalid category, never ambiguously enabled", async () => {
      const enabled = await isOrgFeatureCategoryEnabled(
        managerPerson,
        orgA,
        "not_a_real_category",
      );
      expect(enabled).toBe(false);
    });
  },
);
