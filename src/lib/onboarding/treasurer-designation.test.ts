/**
 * Tests for src/lib/onboarding/treasurer-designation.ts — docs/work-log/
 * 2026-10-15-online-giving.md, Phase 2 R2 / Phase 3 "Designation", as reshaped
 * by docs/work-log/2026-10-21-invitations.md (Batch 2d).
 *
 * The TypeScript `designateTreasurer()` transaction was DELETED in Batch 2d
 * (the invitation model moved its effect into `presby_apply_treasurer`, pinned
 * by designation-parity.db.test.ts's golden snapshot, and every refusal it had
 * is now a `createInvitation()` / `presby_accept_invitation` outcome proven in
 * issue.db.test.ts, accept.db.test.ts and invitations.db.test.ts). What this
 * file still pins is what the module still is:
 *
 *   1. The DECISION-155 boundary, always run, no database: a static assertion,
 *      reading the module's source, that it imports none of the resolver-side
 *      TypeScript files (`src/lib/authz.ts`, `role-definitions.ts`,
 *      `role-grants.ts`), no giving table, and holds no connection of its own.
 *      There is deliberately NO content-hash pin of those files: F131 retired
 *      the earlier "byte-identical to main" check because a pin that breaks on
 *      every legitimate edit gets updated blindly and protects nothing. The
 *      durable form is this import boundary plus the behavioural §44/§46
 *      assertions in test-rls.sql.
 *   2. The Postgres-backed suite (`describe.skipIf(!hasDb)`): the allow-list,
 *      and `countGivingManageHolders()` - a thin wrapper over the owner-only
 *      `presby_giving_manage_holder_count()` - across the holder shapes the
 *      gate must (and must not) count. Run for real with:
 *        npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/treasurer-designation.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));
// org-features.ts (imported only to compare its catalog) reaches @/lib/audit ->
// @/auth -> next-auth, which this test environment cannot resolve
// (`next/server` vs `next/server.js`); org-features.test.ts mocks it the same way.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));

const ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// 1. The DECISION-155 import boundary (no database)
// ---------------------------------------------------------------------------

describe("treasurer designation — the DECISION-155 import boundary", () => {
  const SOURCE = readFileSync(
    path.join(ROOT, "src/lib/onboarding/treasurer-designation.ts"),
    "utf8",
  );
  // Strip comments so the header's prose naming the files is not an import.
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports none of authz.ts, role-definitions.ts, role-grants.ts — no subset check, no adoptTemplate, no grantRole", () => {
    expect(CODE).not.toMatch(/from\s+["']@\/lib\/authz["']/);
    expect(CODE).not.toMatch(/from\s+["']@\/lib\/role-definitions["']/);
    expect(CODE).not.toMatch(/from\s+["']@\/lib\/role-grants["']/);
    expect(CODE).not.toMatch(/assertPermissionSubset|adoptTemplate|grantRole\(/);
  });

  it("imports no giving table and never calls presby_effective_permissions() (F107) or withOrgContext()", () => {
    expect(CODE).not.toMatch(/@\/lib\/db\/domain\/giving/);
    expect(CODE).not.toMatch(/presby_effective_permissions/);
    expect(CODE).not.toMatch(/withOrgContext/);
  });

  it("holds no database connection of its own: only a TYPE comes from @/lib/db, and the TypeScript designation transaction is gone", () => {
    expect(CODE).not.toMatch(/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/);
    expect(CODE).not.toMatch(/import\s*\{[^}]*\bgetPlatformDb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/);
    expect(CODE).toMatch(/import\s+type\s*\{\s*getPlatformDb\s*\}\s*from\s*["']@\/lib\/db["']/);
    expect(CODE).not.toMatch(/designateTreasurer|\.transaction\(|for update/i);
  });

  it("reads the holder gate from the single SQL source", () => {
    expect(CODE).toMatch(/presby_giving_manage_holder_count/);
  });
});

// ---------------------------------------------------------------------------
// 2. Postgres-backed suite
// ---------------------------------------------------------------------------

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "treasurer-designation.ts (Postgres-backed, real dev database)",
  () => {
    let countGivingManageHolders: typeof import("./treasurer-designation").countGivingManageHolders;
    let treasurerDesignationApplies: typeof import("./treasurer-designation").treasurerDesignationApplies;
    let TREASURER_DESIGNATION_ORG_TYPES: typeof import("./treasurer-designation").TREASURER_DESIGNATION_ORG_TYPES;
    let ORG_FEATURE_CATALOG: typeof import("../org-features").ORG_FEATURE_CATALOG;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let groupMemberships: typeof import("@/lib/db/domain/groups").groupMemberships;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let fx: Awaited<ReturnType<typeof import("@/lib/testing/giving-fixture").createGivingFixture>>;

    let operatorUserId: string;
    let n = 0;

    beforeAll(async () => {
      ({ countGivingManageHolders, treasurerDesignationApplies, TREASURER_DESIGNATION_ORG_TYPES } =
        await import("./treasurer-designation"));
      ({ ORG_FEATURE_CATALOG } = await import("../org-features"));
      ({ roleGrants } = await import("@/lib/db/domain/authz"));
      ({ groups, groupMemberships, groupTypes } = await import("@/lib/db/domain/groups"));
      const { createGivingFixture } = await import("@/lib/testing/giving-fixture");
      fx = await createGivingFixture("treasurer-designation");
      operatorUserId = fx.actingUserId;
    });

    afterAll(async () => {
      await fx.cleanup();
    });

    async function sqlCount(organizationId: string): Promise<number> {
      const r = await fx.platform.execute(
        sql`select presby_giving_manage_holder_count(${organizationId}::uuid) as n`,
      );
      return Number(fx.rowsOf(r)[0]!.n);
    }

    it("applies to exactly the org types the org_portal.giving toggle applies to (set-equality with the catalog)", () => {
      const giving = ORG_FEATURE_CATALOG.find((e) => e.key === "org_portal.giving");
      expect([...TREASURER_DESIGNATION_ORG_TYPES].sort()).toEqual(
        [...(giving?.orgTypes ?? [])].sort(),
      );
    });

    it("treasurerDesignationApplies is an ALLOW-LIST: congregation and new worshiping community only", () => {
      expect(treasurerDesignationApplies("congregation")).toBe(true);
      expect(treasurerDesignationApplies("new_worshiping_community")).toBe(true);
      for (const type of ["presbytery", "synod", "general_assembly", "", "Congregation", "something_new"]) {
        expect(treasurerDesignationApplies(type), type).toBe(false);
      }
    });

    it("counts a PERSON-arm holder, and the wrapper equals the SQL single source", async () => {
      n += 1;
      const organizationId = await fx.makeOrg(`count${n}`, { organizationType: "congregation" });
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(0);
      const holder = await fx.makePerson("Marisol", `Holder${n}`);
      await fx.enroll(organizationId, holder, ["giving.manage"]);
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(1);
      expect(await sqlCount(organizationId)).toBe(1);
    });

    it("counts a holder by a live GROUP-arm grant, and does NOT count a group whose membership has ended", async () => {
      n += 1;
      const organizationId = await fx.makeOrg(`group${n}`, { organizationType: "congregation" });
      const member = await fx.makePerson("Talbot", `Group${n}`);
      await fx.addMember(organizationId, member);
      const [gt] = await fx.platform.select({ id: groupTypes.id }).from(groupTypes).limit(1);
      const [g] = await fx.platform
        .insert(groups)
        .values({ organizationId, groupTypeId: gt!.id, name: "Treasury team", membershipSource: "managed" })
        .returning({ id: groups.id });
      await fx.platform.insert(groupMemberships).values({
        organizationId, groupId: g!.id, personId: member, startsOn: "2020-01-01",
      });
      const roleId = await fx.makeRole(organizationId, "fx_group_manage", ["giving.manage"]);
      await fx.platform.insert(roleGrants).values({
        organizationId, roleId, groupId: g!.id, startsOn: "2020-01-01", grantedBy: operatorUserId,
      });
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(1);

      // End the group membership: the resolver no longer sees a holder, so neither does the gate
      // (lockout recovery reopens).
      await fx.platform
        .update(groupMemberships)
        .set({ endsOn: "2024-01-01" })
        .where(eq(groupMemberships.groupId, g!.id));
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(0);
      expect(await sqlCount(organizationId)).toBe(0);
    });

    it("does not count an expired or a future-dated person-arm grant (the resolver would not)", async () => {
      n += 1;
      const organizationId = await fx.makeOrg(`expired${n}`, { organizationType: "congregation" });
      const expired = await fx.makePerson("Pia", `Expired${n}`);
      await fx.enroll(organizationId, expired, ["giving.manage"]);
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(1);
      await fx.platform
        .update(roleGrants)
        .set({ endsOn: "2024-01-01" })
        .where(and(eq(roleGrants.organizationId, organizationId), eq(roleGrants.personId, expired)));
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(0);
      const future = await fx.makePerson("Wren", `Future${n}`);
      await fx.enroll(organizationId, future, ["giving.manage"]);
      await fx.platform
        .update(roleGrants)
        .set({ startsOn: "2999-01-01" })
        .where(and(eq(roleGrants.organizationId, organizationId), eq(roleGrants.personId, future)));
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(0);
    });

    it("does not count giving.record / giving.view holders as managers", async () => {
      n += 1;
      const organizationId = await fx.makeOrg(`viewer${n}`, { organizationType: "congregation" });
      const viewer = await fx.makePerson("Wren", `Viewer${n}`);
      await fx.enroll(organizationId, viewer, ["giving.view", "giving.record"]);
      expect(await countGivingManageHolders(fx.platform, organizationId)).toBe(0);
    });

    it("counts per organization: a holder at another organization is not counted here", async () => {
      n += 1;
      const here = await fx.makeOrg(`here${n}`, { organizationType: "congregation" });
      const there = await fx.makeOrg(`there${n}`, { organizationType: "congregation" });
      const holder = await fx.makePerson("Odell", `Elsewhere${n}`);
      await fx.enroll(there, holder, ["giving.manage"]);
      expect(await countGivingManageHolders(fx.platform, here)).toBe(0);
      expect(await countGivingManageHolders(fx.platform, there)).toBe(1);
    });
  },
);
