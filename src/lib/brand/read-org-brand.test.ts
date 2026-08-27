/**
 * Integration tests for `getOrgMarkForLayout()` — run against a REAL
 * Postgres connection, not mocked. Same posture as `src/lib/directory.test.ts`
 * and `src/lib/storage/blob-store.test.ts`: the behavior under test is
 * `withOrgContext()`'s real membership-gated RLS read plus a real blob
 * resolve, and mocking the connection would only prove this file's own
 * canned rows round-trip through the mapping code — it could never catch a
 * membership check that silently admitted the wrong person, or a stale blob
 * key that should have resolved to `null` but didn't.
 *
 * `npm test` in CI does not set DATABASE_URL, so this whole suite is
 * SKIPPED there, not failed. Run it for real with
 * `dotenv -e .env.local -- vitest run src/lib/brand/read-org-brand.test.ts`.
 *
 * `getOrgBrandForLayout()` (the sibling function in this module) is left
 * untested here — it shipped with zero coverage in the brand-foundation
 * pipeline and widening that gap is out of scope for portal-chrome. Only
 * `getOrgMarkForLayout()`, this pipeline's new read, is pinned.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

// `read-org-brand.ts` imports `./fonts.ts`, which calls `next/font/google` at
// MODULE SCOPE — populated only by Next's SWC compiler plugin at build time,
// a blank file outside that transform. Same mock `fonts.test.ts` uses, one
// level closer to the boundary than mocking `./fonts` itself, so the real
// `getOrgMarkForLayout` code path (which never touches fonts) still loads
// through its real module graph rather than a stubbed sibling.
vi.mock("next/font/google", () => {
  const fakeLoader = (name: string) => (opts: { variable: string }) => ({
    className: `mock-${name}-${opts.variable}`,
    variable: opts.variable,
  });
  return {
    Lora: fakeLoader("lora"),
    Source_Sans_3: fakeLoader("source-sans-3"),
    Libre_Franklin: fakeLoader("libre-franklin"),
    Public_Sans: fakeLoader("public-sans"),
    Bitter: fakeLoader("bitter"),
    Karla: fakeLoader("karla"),
    Montserrat: fakeLoader("montserrat"),
    Open_Sans: fakeLoader("open-sans"),
  };
});

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "getOrgMarkForLayout (Postgres-backed, real dev database)",
  () => {
    let getOrgMarkForLayout: typeof import("./read-org-brand").getOrgMarkForLayout;
    let getBlobStore: typeof import("@/lib/storage/blob-store").getBlobStore;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let organizationBrands: typeof import("@/lib/db/domain/org").organizationBrands;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let users: typeof import("@/lib/db/schema").users;

    let fixtureUserId: string; // organization_brands.updated_by FK target

    let orgBranded: string; // has a markAssetKey
    let orgNoBrandRow: string; // no organization_brands row at all
    let orgBrandRowNoKey: string; // organization_brands row, markAssetKey null
    let orgOutsider: string; // a second org whose person holds no membership at orgBranded

    // ONE PERSON PER ORG, DELIBERATELY. `presby_guard_membership_insert`
    // (drizzle/0009_presby_rls.sql) rejects a second `memberships` row for a
    // person who already has one elsewhere unless linked through
    // `presby_claim_person()` — the global-person model's guard against a
    // duplicate identity. This fixture doesn't need cross-org identity, so
    // it sidesteps that guard with four distinct people instead of reusing
    // one across orgs.
    let memberBranded: string; // active membership at orgBranded ONLY
    let memberNoBrandRow: string; // active membership at orgNoBrandRow ONLY
    let memberBrandRowNoKey: string; // active membership at orgBrandRowNoKey ONLY
    let outsiderPerson: string; // active membership at orgOutsider ONLY

    let markKey: string;

    beforeAll(async () => {
      ({ getOrgMarkForLayout } = await import("./read-org-brand"));
      ({ getBlobStore } = await import("@/lib/storage/blob-store"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations, organizationBrands } = await import(
        "@/lib/db/domain/org"
      ));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ users } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      const [user] = await platform
        .insert(users)
        .values({
          email: `read-org-brand-test-${stamp}@example.invalid`,
          name: "Fixture Operator",
        })
        .returning({ id: users.id });
      fixtureUserId = user!.id;

      async function makeOrg(label: string) {
        const [org] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture ${label} for read-org-brand.test.ts`,
            slug: `read-org-brand-test-${label}-${stamp}`,
            path: `read_org_brand_test_${label}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return org!.id;
      }

      orgBranded = await makeOrg("branded");
      orgNoBrandRow = await makeOrg("no-brand-row");
      orgBrandRowNoKey = await makeOrg("brand-row-no-key");
      orgOutsider = await makeOrg("outsider");

      // drizzle/0017's sync trigger requires the active_membership derived
      // group to exist before ANY memberships insert — same fixture shape
      // directory.test.ts uses.
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

      for (const orgId of [orgBranded, orgNoBrandRow, orgBrandRowNoKey, orgOutsider]) {
        await platform.insert(groups).values({
          organizationId: orgId,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        });
      }

      async function personActiveAt(label: string, organizationId: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: "Fixture", lastName: label })
          .returning({ id: people.id });
        // ended_on defaults to null — that null IS "active" per
        // presby_membership_is_active() (drizzle/0015).
        await platform
          .insert(memberships)
          .values({ personId: p!.id, organizationId });
        return p!.id;
      }

      memberBranded = await personActiveAt("MemberBranded", orgBranded);
      memberNoBrandRow = await personActiveAt("MemberNoBrandRow", orgNoBrandRow);
      memberBrandRowNoKey = await personActiveAt(
        "MemberBrandRowNoKey",
        orgBrandRowNoKey,
      );
      outsiderPerson = await personActiveAt("Outsider", orgOutsider);

      // orgBranded: a real stored logo, resolved through the SAME blob store
      // the admin write path uses.
      const stored = await getBlobStore().store({
        organizationId: orgBranded,
        bytes: Buffer.from("fixture-logo-bytes-not-a-real-image"),
        contentType: "image/png",
      });
      markKey = stored.key;

      await platform.insert(organizationBrands).values({
        organizationId: orgBranded,
        seedHex: "#336699",
        typePairing: "classic",
        markAssetKey: markKey,
        brandTokenVersion: 1,
        updatedBy: fixtureUserId,
      });

      // orgBrandRowNoKey: a brand row exists (colours configured) but no
      // logo was ever uploaded.
      await platform.insert(organizationBrands).values({
        organizationId: orgBrandRowNoKey,
        seedHex: "#996633",
        typePairing: "classic",
        brandTokenVersion: 1,
        updatedBy: fixtureUserId,
      });

      // orgNoBrandRow: deliberately no organization_brands row at all.
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
      // 110) also rejects the DELETE that cascading `organizations` fires
      // against this fixture's own active_membership-derived group_memberships
      // rows — disable it around the cascade, same as roll.test.ts's own
      // teardown does for roll_actions_freeze.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        for (const orgId of [orgBranded, orgNoBrandRow, orgBrandRowNoKey, orgOutsider]) {
          // ON DELETE CASCADE on organization_brands/memberships/groups takes
          // every fixture row with it.
          await platform.delete(organizations).where(eq(organizations.id, orgId));
        }
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      for (const personId of [
        memberBranded,
        memberNoBrandRow,
        memberBrandRowNoKey,
        outsiderPerson,
      ]) {
        await platform.delete(people).where(eq(people.id, personId));
      }
      // organization_brands.updated_by has no cascade (it's a reference
      // FK, not an ownership FK) — deleted last, after the rows that
      // referenced it are already gone via the organizations cascade above.
      await platform.delete(users).where(eq(users.id, fixtureUserId));
    });

    it("returns a data: URI for a real logo, resolved through the same blob store the admin write path uses", async () => {
      const result = await getOrgMarkForLayout(orgBranded, memberBranded);
      expect(result).not.toBeNull();
      expect(result!.markSrc).toMatch(/^data:image\/png;base64,/);
    });

    it("returns null when there is no organization_brands row at all", async () => {
      const result = await getOrgMarkForLayout(orgNoBrandRow, memberNoBrandRow);
      expect(result).toBeNull();
    });

    it("returns null when a brand row exists but carries no markAssetKey", async () => {
      const result = await getOrgMarkForLayout(
        orgBrandRowNoKey,
        memberBrandRowNoKey,
      );
      expect(result).toBeNull();
    });

    it("returns null for a person with no active membership at the organization (RLS, not just a WHERE clause)", async () => {
      // outsiderPerson has never had a membership row at orgBranded at all —
      // this exercises withOrgContext()'s OrgAccessError path, not a stale one.
      const result = await getOrgMarkForLayout(orgBranded, outsiderPerson);
      expect(result).toBeNull();
    });

    it("is NOT gated on ui.brand_theming — no flag row exists in this fixture and the mark still resolves", async () => {
      // DECISION-047 "un-brandable does not mean logo-free": unlike
      // getOrgBrandForLayout, this function never checks ui.brand_theming.
      // isFlagEnabled() returns false on a missing row, so if this function
      // DID gate on the flag it would return null here — it doesn't.
      const result = await getOrgMarkForLayout(orgBranded, memberBranded);
      expect(result).not.toBeNull();
    });
  },
);
