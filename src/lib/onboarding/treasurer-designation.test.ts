/**
 * Tests for src/lib/onboarding/treasurer-designation.ts — docs/work-log/
 * 2026-10-15-online-giving.md, Phase 2 R2 / Phase 3 "Designation".
 *
 * Two independent suites:
 *
 *   1. The DECISION-155 boundary, always run, no database: a static assertion,
 *      reading the module's source, that it imports none of the four
 *      resolver-side TypeScript files (`src/lib/authz.ts`,
 *      `role-definitions.ts`, `role-grants.ts`) and no giving table. There is deliberately NO content-hash pin of those files:
 *      F131 retired the earlier "byte-identical to main" check because a pin
 *      that breaks on every legitimate edit gets updated blindly and protects
 *      nothing. The durable form is this import boundary plus the behavioural
 *      §44/§46 assertions in test-rls.sql.
 *   2. The Postgres-backed integration suite (`describe.skipIf(!hasDb)`),
 *      following `founding-administrator.test.ts`'s harness: dynamic imports
 *      in `beforeAll`, self-contained throwaway orgs via
 *      `createGivingFixture()`, torn down in `afterAll`. Run for real with:
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

  it("uses getPlatformDb() and no other connection", () => {
    expect(CODE).toMatch(/getPlatformDb\(\)/);
    expect(CODE).not.toMatch(/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/);
  });
});

// ---------------------------------------------------------------------------
// 2. Postgres-backed integration suite
// ---------------------------------------------------------------------------

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "treasurer-designation.ts (Postgres-backed, real dev database)",
  () => {
    let designateTreasurer: typeof import("./treasurer-designation").designateTreasurer;
    let countGivingManageHolders: typeof import("./treasurer-designation").countGivingManageHolders;
    let TREASURER_DESIGNATION_ORG_TYPES: typeof import("./treasurer-designation").TREASURER_DESIGNATION_ORG_TYPES;
    let ORG_FEATURE_CATALOG: typeof import("../org-features").ORG_FEATURE_CATALOG;
    let withOrgContext: typeof import("@/lib/authz").withOrgContext;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let groupMemberships: typeof import("@/lib/db/domain/groups").groupMemberships;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let users: typeof import("@/lib/db/schema").users;
    let fx: Awaited<ReturnType<typeof import("@/lib/testing/giving-fixture").createGivingFixture>>;

    let operatorUserId: string;
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const extraUserIds: string[] = [];
    let n = 0;

    beforeAll(async () => {
      ({ designateTreasurer, countGivingManageHolders, TREASURER_DESIGNATION_ORG_TYPES } =
        await import("./treasurer-designation"));
      ({ ORG_FEATURE_CATALOG } = await import("../org-features"));
      ({ withOrgContext } = await import("@/lib/authz"));
      ({ appRoles, appRolePermissions, roleGrants } = await import(
        "@/lib/db/domain/authz"
      ));
      ({ memberships } = await import("@/lib/db/domain/people"));
      ({ groups, groupMemberships, groupTypes } = await import(
        "@/lib/db/domain/groups"
      ));
      ({ users } = await import("@/lib/db/schema"));
      const { createGivingFixture } = await import("@/lib/testing/giving-fixture");
      fx = await createGivingFixture("treasurer-designation");
      operatorUserId = fx.actingUserId;
    });

    afterAll(async () => {
      await fx.cleanup();
      for (const id of extraUserIds) {
        await fx.platform.delete(users).where(eq(users.id, id));
      }
    });

    /** A congregation (or other type) with one member whose person is linked to
     * a fresh active user. Returns the ids and the user's email. */
    async function scene(
      type: "congregation" | "new_worshiping_community" | "presbytery" = "congregation",
      options: { memberEnded?: boolean; noMembership?: boolean } = {},
    ) {
      n += 1;
      const organizationId = await fx.makeOrg(`scene${n}`, { organizationType: type });
      const personId = await fx.makePerson("Odalys", `Treasurer${n}`);
      if (!options.noMembership) await fx.addMember(organizationId, personId);
      if (options.memberEnded) {
        await fx.platform
          .update(memberships)
          .set({ endedOn: "2024-01-01" })
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.personId, personId),
            ),
          );
      }
      const userId = await fx.linkUser(personId, `t${n}`);
      const [u] = await fx.platform
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      return { organizationId, personId, userId, email: u!.email };
    }

    async function counts(organizationId: string) {
      const [p] = await fx.platform.execute(
        sql`select (select count(*) from people)::int as people,
                   (select count(*) from memberships where organization_id = ${organizationId}::uuid)::int as memberships`,
      ).then((r) => fx.rowsOf(r));
      return { people: Number(p!.people), memberships: Number(p!.memberships) };
    }

    async function rolesOf(organizationId: string) {
      return fx.platform
        .select()
        .from(appRoles)
        .where(eq(appRoles.organizationId, organizationId));
    }

    async function keysOf(roleId: string) {
      const rows = await fx.platform
        .select({ k: appRolePermissions.permissionKey })
        .from(appRolePermissions)
        .where(eq(appRolePermissions.roleId, roleId));
      return rows.map((r) => r.k).sort();
    }

    async function holds(personId: string, organizationId: string, key: string) {
      return withOrgContext(personId, organizationId, async (tx) => {
        const r = await tx.execute(
          sql`select presby_has_permission(${personId}::uuid, ${organizationId}::uuid, ${key}) as ok`,
        );
        return (r as unknown as { rows: Array<{ ok: boolean }> }).rows[0]!.ok;
      });
    }

    it("applies to exactly the org types the org_portal.giving toggle applies to (set-equality with the catalog)", () => {
      const giving = ORG_FEATURE_CATALOG.find((e) => e.key === "org_portal.giving");
      expect([...TREASURER_DESIGNATION_ORG_TYPES].sort()).toEqual(
        [...(giving?.orgTypes ?? [])].sort(),
      );
    });

    it("designates a congregation member: mints the treasurer role from the template, one person-arm grant, the recorder role UNGRANTED, and creates NO person and NO membership", async () => {
      const s = await scene();
      const before = await counts(s.organizationId);
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(0);

      const result = await designateTreasurer(s.organizationId, s.email, operatorUserId);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.personId).toBe(s.personId);
      expect(result.userId).toBe(s.userId);
      expect(result.priorHolderCount).toBe(0);
      expect(result.permissionKeys).toEqual([
        "giving.manage",
        "giving.record",
        "giving.view",
      ]);

      // No person, no membership created.
      expect(await counts(s.organizationId)).toEqual(before);

      const roles = await rolesOf(s.organizationId);
      const treasurer = roles.find((r) => r.key === "treasurer");
      const recorder = roles.find((r) => r.key === "giving_recorder");
      expect(treasurer?.id).toBe(result.treasurerRoleId);
      expect(recorder?.id).toBe(result.recorderRoleId);
      // Template kind/protected carried over; the recorder is custom + unprotected.
      expect(treasurer).toMatchObject({ roleKind: "constitutional", isProtected: true, deactivatedAt: null });
      expect(recorder).toMatchObject({ roleKind: "custom", isProtected: false });
      expect(await keysOf(treasurer!.id)).toEqual(["giving.manage", "giving.record", "giving.view"]);
      expect(await keysOf(recorder!.id)).toEqual(["giving.record"]);

      // Exactly one grant: the treasurer role, person-arm, granted_by = operator.
      const grants = await fx.platform
        .select()
        .from(roleGrants)
        .where(eq(roleGrants.organizationId, s.organizationId));
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        roleId: treasurer!.id,
        personId: s.personId,
        groupId: null,
        grantedBy: operatorUserId,
        grantReason: "treasurer designation",
      });
      expect(grants.some((g) => g.roleId === recorder!.id)).toBe(false);

      // The resolver agrees: the designee holds all three keys.
      for (const key of ["giving.view", "giving.record", "giving.manage"]) {
        expect(await holds(s.personId, s.organizationId, key), key).toBe(true);
      }
      // ...and nothing else came with it (no wildcard, no founding-admin bundle).
      for (const key of ["roles.manage", "role_grants.manage", "people.manage"]) {
        expect(await holds(s.personId, s.organizationId, key), key).toBe(false);
      }
    });

    it("designates at a new worshiping community too", async () => {
      const s = await scene("new_worshiping_community");
      const result = await designateTreasurer(s.organizationId, s.email, operatorUserId);
      expect(result.kind).toBe("ok");
    });

    it("normalizes the typed email (case and whitespace)", async () => {
      const s = await scene();
      const result = await designateTreasurer(
        s.organizationId,
        `  ${s.email.toUpperCase()}  `,
        operatorUserId,
      );
      expect(result.kind).toBe("ok");
    });

    it("flips the gate: once designated the holder count is 1 and a second designation is refused has_holders (the control disappears)", async () => {
      const s = await scene();
      const other = await fx.makePerson("Idris", `Second${n}`);
      await fx.addMember(s.organizationId, other);
      const otherUserId = await fx.linkUser(other, `second${n}`);
      const [ou] = await fx.platform.select({ email: users.email }).from(users).where(eq(users.id, otherUserId));

      expect((await designateTreasurer(s.organizationId, s.email, operatorUserId)).kind).toBe("ok");
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(1);
      const second = await designateTreasurer(s.organizationId, ou!.email, operatorUserId);
      expect(second).toEqual({ kind: "has_holders", holderCount: 1 });
    });

    it("reuse-and-reactivate (F109): an existing protected treasurer role is reused by id, reactivated, keeps its own extra keys, gains the giving keys additively, and no second role row appears", async () => {
      const s = await scene();
      // The fixture shape: an org-owned PROTECTED `treasurer` role with a key
      // nobody else carries, deactivated.
      const [existing] = await fx.platform
        .insert(appRoles)
        .values({
          organizationId: s.organizationId,
          key: "treasurer",
          name: "Treasurer (congregation's own name)",
          roleKind: "constitutional",
          isProtected: true,
          deactivatedAt: new Date(),
        })
        .returning({ id: appRoles.id });
      await fx.platform
        .insert(appRolePermissions)
        .values({ roleId: existing!.id, permissionKey: "ledger.approve" });

      const result = await designateTreasurer(s.organizationId, s.email, operatorUserId);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.treasurerRoleId).toBe(existing!.id);

      const roles = await rolesOf(s.organizationId);
      expect(roles.filter((r) => r.key === "treasurer")).toHaveLength(1);
      const treasurer = roles.find((r) => r.id === existing!.id)!;
      expect(treasurer.deactivatedAt).toBeNull();
      // Its own name is the congregation's now, not overwritten.
      expect(treasurer.name).toBe("Treasurer (congregation's own name)");
      // Additive: the pre-existing key survives, the giving keys arrive.
      expect(await keysOf(existing!.id)).toEqual([
        "giving.manage",
        "giving.record",
        "giving.view",
        "ledger.approve",
      ]);
    });

    it("reconciles the recorder role additively too: a congregation-added key on an existing giving_recorder survives, and the role stays ungranted", async () => {
      const s = await scene();
      const [recorder] = await fx.platform
        .insert(appRoles)
        .values({
          organizationId: s.organizationId,
          key: "giving_recorder",
          name: "Giving Recorder",
          roleKind: "custom",
          isProtected: false,
          deactivatedAt: new Date(),
        })
        .returning({ id: appRoles.id });
      await fx.platform
        .insert(appRolePermissions)
        .values({ roleId: recorder!.id, permissionKey: "tickets.file" });

      const result = await designateTreasurer(s.organizationId, s.email, operatorUserId);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.recorderRoleId).toBe(recorder!.id);
      expect(await keysOf(recorder!.id)).toEqual(["giving.record", "tickets.file"]);
      const [row] = await fx.platform.select().from(appRoles).where(eq(appRoles.id, recorder!.id));
      expect(row!.deactivatedAt).toBeNull();
      const grants = await fx.platform
        .select()
        .from(roleGrants)
        .where(eq(roleGrants.roleId, recorder!.id));
      expect(grants).toHaveLength(0);
    });

    // ----------------------------- refusals ------------------------------

    it("refuses not_applicable for a presbytery and writes nothing", async () => {
      const s = await scene("presbytery");
      const result = await designateTreasurer(s.organizationId, s.email, operatorUserId);
      expect(result).toEqual({ kind: "not_applicable" });
      expect(await rolesOf(s.organizationId)).toHaveLength(0);
    });

    it.each(["synod", "general_assembly"] as const)(
      "refuses not_applicable for a %s (allow-list, not exclusion)",
      async (type) => {
        n += 1;
        const organizationId = await fx.makeOrg(`typed${n}`, { organizationType: type });
        const result = await designateTreasurer(organizationId, "nobody@example.invalid", operatorUserId);
        expect(result).toEqual({ kind: "not_applicable" });
      },
    );

    it("refuses has_holders when a giving.manage holder exists by a PERSON-arm grant, and counts only effective holders", async () => {
      const s = await scene();
      const holder = await fx.makePerson("Marisol", `Holder${n}`);
      await fx.enroll(s.organizationId, holder, ["giving.manage"]);
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(1);
      expect(await designateTreasurer(s.organizationId, s.email, operatorUserId)).toEqual({
        kind: "has_holders",
        holderCount: 1,
      });
      // Nothing was written for the refused designee.
      const roles = await rolesOf(s.organizationId);
      expect(roles.some((r) => r.key === "giving_recorder")).toBe(false);
    });

    it("refuses has_holders when the holder is by a live GROUP-arm grant, and does NOT count a group whose membership has ended", async () => {
      const s = await scene();
      const member = await fx.makePerson("Talbot", `Group${n}`);
      await fx.addMember(s.organizationId, member);
      const [gt] = await fx.platform.select({ id: groupTypes.id }).from(groupTypes).limit(1);
      const [g] = await fx.platform
        .insert(groups)
        .values({
          organizationId: s.organizationId,
          groupTypeId: gt!.id,
          name: "Treasury team",
          membershipSource: "managed",
        })
        .returning({ id: groups.id });
      await fx.platform.insert(groupMemberships).values({
        organizationId: s.organizationId,
        groupId: g!.id,
        personId: member,
        startsOn: "2020-01-01",
      });
      const roleId = await fx.makeRole(s.organizationId, "fx_group_manage", ["giving.manage"]);
      await fx.platform.insert(roleGrants).values({
        organizationId: s.organizationId,
        roleId,
        groupId: g!.id,
        startsOn: "2020-01-01",
        grantedBy: operatorUserId,
      });
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(1);
      expect(await designateTreasurer(s.organizationId, s.email, operatorUserId)).toEqual({
        kind: "has_holders",
        holderCount: 1,
      });

      // End the group membership: the resolver no longer sees a holder, so
      // neither does the gate (lockout recovery reopens).
      await fx.platform
        .update(groupMemberships)
        .set({ endsOn: "2024-01-01" })
        .where(eq(groupMemberships.groupId, g!.id));
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(0);
      expect((await designateTreasurer(s.organizationId, s.email, operatorUserId)).kind).toBe("ok");
    });

    it("does not count an expired person-arm grant (the resolver would not). The 'membership ended under an open grant' state is unreachable: presby_guard_membership_end() refuses to end a membership while a grant is open, so the gate's membership condition is defence in depth", async () => {
      const s = await scene();
      const expired = await fx.makePerson("Pia", `Expired${n}`);
      await fx.enroll(s.organizationId, expired, ["giving.manage"]);
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(1);
      await fx.platform
        .update(roleGrants)
        .set({ endsOn: "2024-01-01" })
        .where(and(eq(roleGrants.organizationId, s.organizationId), eq(roleGrants.personId, expired)));
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(0);
      // A future-dated grant is not effective yet either.
      const future = await fx.makePerson("Wren", `Future${n}`);
      await fx.enroll(s.organizationId, future, ["giving.manage"]);
      await fx.platform
        .update(roleGrants)
        .set({ startsOn: "2999-01-01" })
        .where(and(eq(roleGrants.organizationId, s.organizationId), eq(roleGrants.personId, future)));
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(0);
    });

    it("does not count giving.record / giving.view holders as managers", async () => {
      const s = await scene();
      const viewer = await fx.makePerson("Wren", `Viewer${n}`);
      await fx.enroll(s.organizationId, viewer, ["giving.view", "giving.record"]);
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(0);
    });

    it("refuses no_such_user", async () => {
      const s = await scene();
      expect(
        await designateTreasurer(s.organizationId, `nobody-${stamp}@example.invalid`, operatorUserId),
      ).toEqual({ kind: "no_such_user" });
    });

    it("refuses user_inactive", async () => {
      const s = await scene();
      await fx.platform.update(users).set({ isActive: false }).where(eq(users.id, s.userId));
      expect(await designateTreasurer(s.organizationId, s.email, operatorUserId)).toEqual({
        kind: "user_inactive",
      });
    });

    it("refuses not_a_member for a user with no person, and for a person who belongs to a DIFFERENT organization — and creates no person or membership", async () => {
      const s = await scene();
      // A user with no person at all.
      const [bare] = await fx.platform
        .insert(users)
        .values({ email: `bare-${stamp}-${n}@example.invalid`, name: "Bare User" })
        .returning({ id: users.id, email: users.email });
      extraUserIds.push(bare!.id);
      // A member of another org.
      const elsewhere = await scene();
      const before = await counts(s.organizationId);
      expect(await designateTreasurer(s.organizationId, bare!.email, operatorUserId)).toEqual({
        kind: "not_a_member",
      });

      expect(await designateTreasurer(s.organizationId, elsewhere.email, operatorUserId)).toEqual({
        kind: "not_a_member",
      });
      expect(await counts(s.organizationId)).toEqual(before);
      expect(await rolesOf(s.organizationId)).toHaveLength(0);
    });

    it("refuses membership_ended with the real end date", async () => {
      const s = await scene("congregation", { memberEnded: true });
      expect(await designateTreasurer(s.organizationId, s.email, operatorUserId)).toEqual({
        kind: "membership_ended",
        endedOn: "2024-01-01",
      });
    });

    it("refuses provisioning_incomplete when the treasurer template is missing, and writes nothing (template renamed for the duration, restored in finally)", async () => {
      const s = await scene();
      const TEMPLATE_ID = "00000000-0000-0000-0000-000000000005";
      await fx.platform.execute(
        sql`update app_roles set key = 'treasurer_tmp_hidden' where id = ${TEMPLATE_ID}::uuid and key = 'treasurer'`,
      );
      try {
        expect(await designateTreasurer(s.organizationId, s.email, operatorUserId)).toEqual({
          kind: "provisioning_incomplete",
        });
        expect(await rolesOf(s.organizationId)).toHaveLength(0);
      } finally {
        await fx.platform.execute(
          sql`update app_roles set key = 'treasurer' where id = ${TEMPLATE_ID}::uuid`,
        );
      }
      const [restored] = await fx.platform
        .select({ key: appRoles.key })
        .from(appRoles)
        .where(eq(appRoles.id, TEMPLATE_ID));
      expect(restored?.key).toBe("treasurer");
    });

    it("serializes concurrent designations on the org-row lock: exactly one wins, the other is refused has_holders", async () => {
      const s = await scene();
      const other = await fx.makePerson("Odalys", `Racer${n}`);
      await fx.addMember(s.organizationId, other);
      const otherUserId = await fx.linkUser(other, `racer${n}`);
      const [ou] = await fx.platform.select({ email: users.email }).from(users).where(eq(users.id, otherUserId));

      const [a, b] = await Promise.all([
        designateTreasurer(s.organizationId, s.email, operatorUserId),
        designateTreasurer(s.organizationId, ou!.email, operatorUserId),
      ]);
      const kinds = [a.kind, b.kind].sort();
      expect(kinds).toEqual(["has_holders", "ok"]);
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(1);
    });

    it("returns db_error (typed, not thrown) and rolls everything back when a write fails mid-transaction (operator id that is not a user)", async () => {
      const s = await scene();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await designateTreasurer(
          s.organizationId,
          s.email,
          "00000000-0000-0000-0000-00000000dead",
        );
        expect(result).toEqual({ kind: "db_error" });
      } finally {
        consoleError.mockRestore();
      }
      // Rolled back: no roles were left behind by the failed attempt.
      expect(await rolesOf(s.organizationId)).toHaveLength(0);
      expect(await countGivingManageHolders(fx.platform, s.organizationId)).toBe(0);
    });
  },
);
