/**
 * Tests for src/lib/org-provisioning.ts.
 *
 * `deriveOrgPath()` is pure but lives in the same module as
 * `createOrganization()`, which imports `@/lib/db` — and `@/lib/db`'s own
 * `db` export constructs its connection pool at MODULE SCOPE, throwing
 * immediately if `DATABASE_URL` is unset. So even the pure-function tests
 * below sit inside the same `hasDb`-gated `describe.skipIf` and dynamic
 * `beforeAll` import as the DB-backed tests, mirroring `sites.test.ts`'s
 * established harness exactly (same reasoning, same skip guard).
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with:
 *   dotenv -e .env.local -- vitest run src/lib/org-provisioning.test.ts
 *
 * Fixtures are self-contained (created and torn down per file, not mutating
 * scripts/seed-dev.sql's fixture ids) — same discipline as sites.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, isNull } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "org-provisioning.ts (Postgres-backed, real dev database)",
  () => {
    let deriveOrgPath: typeof import("./org-provisioning").deriveOrgPath;
    let createOrganization: typeof import("./org-provisioning").createOrganization;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;

    const stamp = Date.now();
    const createdOrgIds: string[] = [];

    beforeAll(async () => {
      ({ deriveOrgPath, createOrganization } = await import(
        "./org-provisioning"
      ));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));

      // This test's own precondition, exercised for real rather than
      // assumed: createOrganization() fails closed with
      // provisioning_incomplete unless the platform-wide court/roster
      // group_types templates already exist. scripts/seed.ts's
      // seedGroupTypes() addition (this same work-log's Implementation
      // Order step 1) is the real fix; this suite does not create them
      // itself, matching Phase 2's explicit rejection of "find-or-create
      // inline" as a shortcut for the production code path.
      const platform = getPlatformDb();
      const templates = await platform
        .select({ key: groupTypes.key })
        .from(groupTypes)
        .where(isNull(groupTypes.organizationId));
      const keys = new Set(templates.map((t) => t.key));
      if (!keys.has("court") || !keys.has("roster")) {
        throw new Error(
          "[org-provisioning.test] court/roster group_types templates are " +
            "missing from this database. Run `npm run db:seed` (with " +
            "scripts/seed.ts's seedGroupTypes() addition) before running " +
            "this suite.",
        );
      }
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      for (const id of createdOrgIds) {
        // groups.organizationId cascades on organizations delete (see
        // src/lib/db/domain/groups.ts), so this alone is sufficient cleanup.
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    });

    // -------------------------------------------------------------------
    // deriveOrgPath()
    // -------------------------------------------------------------------

    describe("deriveOrgPath", () => {
      it("replaces every hyphen with an underscore", () => {
        expect(deriveOrgPath("first-pres-anytown")).toBe(
          "first_pres_anytown",
        );
      });

      it("passes a slug with no hyphens through unchanged", () => {
        expect(deriveOrgPath("fpcw")).toBe("fpcw");
      });

      it("handles a slug that is all digits/letters with a single hyphen", () => {
        expect(deriveOrgPath("st-andrews")).toBe("st_andrews");
      });
    });

    // -------------------------------------------------------------------
    // createOrganization()
    // -------------------------------------------------------------------

    describe("createOrganization", () => {
      it("creates a congregation with Session, Board of Deacons, and Active Membership", async () => {
        const slug = `org-prov-test-cong-${stamp}`;
        const result = await createOrganization({
          name: "Fixture Congregation for org-provisioning.test.ts",
          slug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdOrgIds.push(result.organizationId);

        const platform = getPlatformDb();
        const [orgRow] = await platform
          .select({ path: organizations.path, slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, result.organizationId))
          .limit(1);
        expect(orgRow?.slug).toBe(slug);
        expect(orgRow?.path).toBe(deriveOrgPath(slug));

        const groupRows = await platform
          .select({
            name: groups.name,
            derivedFrom: groups.derivedFrom,
            membershipSource: groups.membershipSource,
            isProtected: groups.isProtected,
          })
          .from(groups)
          .where(eq(groups.organizationId, result.organizationId));

        expect(groupRows).toHaveLength(3);
        const byDerivedFrom = new Map(
          groupRows.map((g) => [g.derivedFrom, g]),
        );
        expect(byDerivedFrom.get("session")?.name).toBe("Session");
        expect(byDerivedFrom.get("diaconate")?.name).toBe("Board of Deacons");
        expect(byDerivedFrom.get("active_membership")?.name).toBe(
          "Active Membership",
        );
        for (const g of groupRows) {
          expect(g.membershipSource).toBe("derived");
          expect(g.isProtected).toBe(true);
        }
      });

      it("creates a presbytery with only Active Membership (no Session, no Board of Deacons)", async () => {
        const slug = `org-prov-test-presb-${stamp}`;
        const result = await createOrganization({
          name: "Fixture Presbytery for org-provisioning.test.ts",
          slug,
          organizationType: "presbytery",
          platformStatus: "unmanaged",
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        createdOrgIds.push(result.organizationId);

        const platform = getPlatformDb();
        const groupRows = await platform
          .select({ name: groups.name, derivedFrom: groups.derivedFrom })
          .from(groups)
          .where(eq(groups.organizationId, result.organizationId));

        expect(groupRows).toHaveLength(1);
        expect(groupRows[0].derivedFrom).toBe("active_membership");
        expect(groupRows[0].name).toBe("Active Membership");
      });

      it("rejects a slug that is already taken", async () => {
        const slug = `org-prov-test-dup-${stamp}`;
        const first = await createOrganization({
          name: "Fixture Original",
          slug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(first.kind).toBe("ok");
        if (first.kind === "ok") createdOrgIds.push(first.organizationId);

        const second = await createOrganization({
          name: "Fixture Duplicate",
          slug,
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(second).toEqual({ kind: "slug_taken" });
      });

      it("rejects a reserved slug without creating a row", async () => {
        const platform = getPlatformDb();
        const before = await platform
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, "admin"))
          .limit(1);
        expect(before).toHaveLength(0);

        const result = await createOrganization({
          name: "Should Never Be Created",
          slug: "admin",
          organizationType: "congregation",
          platformStatus: "managed",
        });
        expect(result).toEqual({ kind: "reserved_slug" });

        const after = await platform
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, "admin"))
          .limit(1);
        expect(after).toHaveLength(0);
      });
    });
  },
);
