/**
 * Integration tests for src/lib/tenant-branding.ts — run against a REAL
 * Postgres connection, not mocked. Follows `src/lib/role-grants.test.ts`'s /
 * `src/lib/officers.test.ts`'s exact harness: the `hasDb` skip-guard, dynamic
 * imports inside `beforeAll` (this file's own top-level import of
 * `./tenant-branding` would otherwise reach `@/lib/db`'s module-scope pool
 * construction before DATABASE_URL is confirmed set), and a self-contained
 * fixture created and torn down per file rather than mutating
 * `scripts/seed-dev.sql`'s fixture ids (Marguerite Ashcombe / Alder Creek /
 * Bramblewood, granted in commit 1, are the PRODUCTION-SHAPED analogue this
 * fixture's `brandAdminPerson`/`orgA`/`orgB` reproduce at throwaway scale —
 * same discipline `role-grants.test.ts`'s own header names).
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/tenant-branding.test.ts
 *
 * TWO ORGANIZATIONS:
 *   orgA — the general-purpose fixture: `branding.manage` bound to a test
 *          role, a person holding it (`brandAdminPerson`) and a person who
 *          does not (`outsiderPerson`, current membership, no grant).
 *   orgB — exists ONLY to prove cross-org isolation: its own
 *          `branding.manage` holder (`orgBPerson`), who has zero standing at
 *          orgA — the Marguerite-Ashcombe/Alder-Creek/Bramblewood shape from
 *          the fixture, reproduced here so the isolation proof doesn't
 *          depend on `scripts/seed-dev.sql`'s shared, mutable dev-database
 *          state.
 *
 * `recordAudit()` is NOT mocked or asserted here — `tenant-branding.ts`
 * itself never calls it (Phase 3's own placement: the audit write lives in
 * `(org)/o/[slug]/admin/branding/actions.ts`, proven by
 * `actions.test.ts`'s mocked-boundary suite instead).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "tenant-branding.ts (Postgres-backed, real dev database)",
  () => {
    let getOrgBrandForEdit: typeof import("./tenant-branding").getOrgBrandForEdit;
    let setBrand: typeof import("./tenant-branding").setBrand;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let OrgAccessError: typeof import("@/lib/authz").OrgAccessError;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let organizationBrands: typeof import("@/lib/db/domain/org").organizationBrands;
    let organizationBrandHistory: typeof import("@/lib/db/domain/org").organizationBrandHistory;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let users: typeof import("@/lib/db/schema").users;
    let BRAND_TOKEN_VERSION: typeof import("@/lib/brand/contract").BRAND_TOKEN_VERSION;

    let orgA: string;
    let orgB: string;

    let brandAdminPerson: string; // orgA — holds branding.manage
    let outsiderPerson: string; // orgA — current membership, no grant at all
    let orgBPerson: string; // orgB — holds branding.manage at orgB ONLY

    let grantingUserId: string; // a users.id row for changedBy/updatedBy FKs

    beforeAll(async () => {
      ({ getOrgBrandForEdit, setBrand } = await import("./tenant-branding"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ OrgAccessError } = await import("@/lib/authz"));
      ({ organizations, organizationBrands, organizationBrandHistory } =
        await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ users } = await import("@/lib/db/schema"));
      ({ BRAND_TOKEN_VERSION } = await import("@/lib/brand/contract"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for tenant-branding.test.ts`,
            slug: `tenant-branding-test-${label.toLowerCase()}-${stamp}`,
            path: `tenant_branding_test_${label.toLowerCase()}_${stamp}`,
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

      // Idempotent — the permission-catalog row is a migration-owned artifact
      // (drizzle/0030_presby_branding_permission.sql, commit 1) that should
      // already exist; inserted defensively here the same way
      // org-features.test.ts guards against a test environment where the
      // migration hasn't been applied.
      await platform
        .insert(permissions)
        .values({
          key: "branding.manage",
          module: "branding",
          description:
            "Set this organization's brand colour, logo, type pairing, and light-only mode",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();

      const [brandRoleA] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "brand_admin_test",
          name: "Brand Administrator (test)",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: brandRoleA!.id, permissionKey: "branding.manage" });

      const [brandRoleB] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgB,
          key: "brand_admin_test",
          name: "Brand Administrator (test)",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: brandRoleB!.id, permissionKey: "branding.manage" });

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        return p!.id;
      }
      brandAdminPerson = await person("Odalys", "Fairweather");
      outsiderPerson = await person("Thaddeus", "Grislow");
      orgBPerson = await person("Wren", "Castellane");

      await platform.insert(memberships).values([
        { organizationId: orgA, personId: brandAdminPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: outsiderPerson, engagementStatus: "regular" },
        { organizationId: orgB, personId: orgBPerson, engagementStatus: "regular" },
      ]);

      await platform.insert(roleGrants).values([
        {
          organizationId: orgA,
          roleId: brandRoleA!.id,
          personId: brandAdminPerson,
          startsOn: "2020-01-01",
        },
        {
          organizationId: orgB,
          roleId: brandRoleB!.id,
          personId: orgBPerson,
          startsOn: "2020-01-01",
        },
      ]);

      const [u] = await platform
        .insert(users)
        .values({
          email: `tenant-branding-test-${stamp}@example.invalid`,
          name: "Fixture Brand Admin",
        })
        .returning({ id: users.id });
      grantingUserId = u!.id;
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // organization_brands / organization_brand_history / blob_assets all
      // cascade off organizations.id — deleting the orgs is sufficient.
      //
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
      await platform.delete(people).where(eq(people.id, brandAdminPerson));
      await platform.delete(people).where(eq(people.id, outsiderPerson));
      await platform.delete(people).where(eq(people.id, orgBPerson));
      await platform.delete(users).where(eq(users.id, grantingUserId));
    });

    // -------------------------------------------------------------------
    // The branding.manage permission gate — forbidden before any read/write
    // -------------------------------------------------------------------

    describe("the branding.manage gate", () => {
      it("getOrgBrandForEdit: forbidden without branding.manage", async () => {
        const result = await getOrgBrandForEdit(outsiderPerson, orgA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("setBrand: forbidden without branding.manage, and nothing is written", async () => {
        const result = await setBrand(outsiderPerson, orgA, grantingUserId, {
          seedHex: "#336699",
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        expect(result).toEqual({ kind: "forbidden" });

        const [row] = await getPlatformDb()
          .select({ organizationId: organizationBrands.organizationId })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));
        expect(row).toBeUndefined();
      });
    });

    // -------------------------------------------------------------------
    // Hex validation — matching the platform path's own SEED_HEX_RE
    // -------------------------------------------------------------------

    describe("hex validation", () => {
      it.each([
        "not-a-colour",
        "#12345", // too short
        "#1234567", // too long
        "#gghhii", // non-hex characters
        "336699", // missing '#'
      ])("setBrand: invalid_hex for %s, nothing written", async (badHex) => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: badHex,
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        expect(result).toEqual({ kind: "invalid_hex" });
      });

      it("setBrand: accepts an uppercase hex (lowercased internally, matching the platform action)", async () => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#7A1F2B",
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        expect(result.kind).toBe("ok");

        const [row] = await getPlatformDb()
          .select({ seedHex: organizationBrands.seedHex })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));
        expect(row?.seedHex).toBe("#7a1f2b");
      });

      it("setBrand: invalid_pairing for a key outside TYPE_PAIRINGS", async () => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#336699",
          typePairing: "not-a-real-pairing",
          lightOnly: false,
          logo: null,
        });
        expect(result).toEqual({ kind: "invalid_pairing" });
      });
    });

    // -------------------------------------------------------------------
    // The contrast-floor-enforcing generator call actually firing
    // -------------------------------------------------------------------

    describe("generateBrandTokens is actually called (contrast-floor enforcement)", () => {
      it("a saturated seed writes the current BRAND_TOKEN_VERSION and no near-grey adjustment", async () => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#2f6f4f",
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        expect(result.kind).toBe("ok");

        const [row] = await getPlatformDb()
          .select({ brandTokenVersion: organizationBrands.brandTokenVersion })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));
        expect(row?.brandTokenVersion).toBe(BRAND_TOKEN_VERSION);
      });

      it("a near-grey seed produces a non-zero adjustmentCount — proof the generator's contrast-floor logic actually ran, not a pass-through", async () => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#808080",
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.adjustmentCount).toBeGreaterThan(0);
      });
    });

    // -------------------------------------------------------------------
    // History row + upsert behavior
    // -------------------------------------------------------------------

    describe("history row on update", () => {
      it("a second setBrand call for the same org writes an organization_brand_history row capturing the prior values", async () => {
        await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#123456",
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#654321",
          typePairing: "modern",
          lightOnly: true,
          logo: null,
        });
        expect(result.kind).toBe("ok");

        const historyRows = await getPlatformDb()
          .select({
            seedHex: organizationBrandHistory.seedHex,
            typePairing: organizationBrandHistory.typePairing,
            action: organizationBrandHistory.action,
          })
          .from(organizationBrandHistory)
          .where(
            and(
              eq(organizationBrandHistory.organizationId, orgA),
              eq(organizationBrandHistory.seedHex, "#123456"),
            ),
          );
        expect(historyRows.length).toBeGreaterThanOrEqual(1);
        expect(historyRows[0]?.action).toBe("updated");
      });
    });

    // -------------------------------------------------------------------
    // Logo handling — E-c1 (sniff) / E-c2 (partial-save honesty)
    // -------------------------------------------------------------------

    describe("logo handling", () => {
      const PNG_MAGIC = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]);
      const NOT_AN_IMAGE = Buffer.from("this is not an image at all");

      it("a valid-magic-byte logo stores and sets markAssetKey", async () => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#445566",
          typePairing: "classic",
          lightOnly: false,
          logo: { bytes: PNG_MAGIC, declaredContentType: "image/png" },
        });
        expect(result).toEqual({
          kind: "ok",
          adjustmentCount: expect.any(Number),
          partialSaveLogoError: null,
        });

        const [row] = await getPlatformDb()
          .select({ markAssetKey: organizationBrands.markAssetKey })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));
        expect(row?.markAssetKey).not.toBeNull();
      });

      it("E-c2: a bad logo that is the ONLY change touches nothing — logo_rejected, existing brand row untouched", async () => {
        // Establish a known-good baseline first.
        await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#778899",
          typePairing: "warm",
          lightOnly: false,
          logo: null,
        });
        const [before] = await getPlatformDb()
          .select({
            seedHex: organizationBrands.seedHex,
            typePairing: organizationBrands.typePairing,
            markAssetKey: organizationBrands.markAssetKey,
          })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));

        // Same seedHex/typePairing/lightOnly, only a bad logo.
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#778899",
          typePairing: "warm",
          lightOnly: false,
          logo: { bytes: NOT_AN_IMAGE, declaredContentType: "image/png" },
        });
        expect(result).toEqual({
          kind: "logo_rejected",
          message:
            "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
        });

        const [after] = await getPlatformDb()
          .select({
            seedHex: organizationBrands.seedHex,
            typePairing: organizationBrands.typePairing,
            markAssetKey: organizationBrands.markAssetKey,
          })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));
        expect(after).toEqual(before);
      });

      it("a bad logo alongside a real colour change still commits the colour, naming the logo failure specifically (partial-save honesty)", async () => {
        const result = await setBrand(brandAdminPerson, orgA, grantingUserId, {
          seedHex: "#0f9d58",
          typePairing: "contemporary",
          lightOnly: false,
          logo: { bytes: NOT_AN_IMAGE, declaredContentType: "image/png" },
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.partialSaveLogoError).toMatch(/upload a PNG, JPEG, or WEBP/);

        const [row] = await getPlatformDb()
          .select({ seedHex: organizationBrands.seedHex })
          .from(organizationBrands)
          .where(eq(organizationBrands.organizationId, orgA));
        expect(row?.seedHex).toBe("#0f9d58");
      });
    });

    // -------------------------------------------------------------------
    // Cross-org isolation — a branding.manage holder at one org has ZERO
    // standing at another, the Marguerite-Ashcombe/Alder-Creek/Bramblewood
    // shape this fixture reproduces at throwaway scale.
    // -------------------------------------------------------------------

    describe("cross-org isolation", () => {
      it("orgA's branding.manage holder cannot set orgB's brand — no membership there at all", async () => {
        await expect(
          setBrand(brandAdminPerson, orgB, grantingUserId, {
            seedHex: "#336699",
            typePairing: "classic",
            lightOnly: false,
            logo: null,
          }),
        ).rejects.toThrow(OrgAccessError);
      });

      it("orgB's branding.manage holder cannot set orgA's brand — no membership there at all", async () => {
        await expect(
          setBrand(orgBPerson, orgA, grantingUserId, {
            seedHex: "#336699",
            typePairing: "classic",
            lightOnly: false,
            logo: null,
          }),
        ).rejects.toThrow(OrgAccessError);
      });

      it("orgA's branding.manage holder cannot even READ orgB's brand", async () => {
        await expect(getOrgBrandForEdit(brandAdminPerson, orgB)).rejects.toThrow(
          OrgAccessError,
        );
      });

      it("orgB's own branding.manage grant works fine at orgB (proves the isolation above is org-scoped, not a broken grant)", async () => {
        const result = await setBrand(orgBPerson, orgB, grantingUserId, {
          seedHex: "#336699",
          typePairing: "classic",
          lightOnly: false,
          logo: null,
        });
        expect(result.kind).toBe("ok");
      });
    });
  },
);
