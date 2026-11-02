/**
 * `createOrganization()`'s group and baseline-role wiring with the database
 * faked (Community Increment 3a, arch-A3 (iii); docs/work-log/2026-10-22-
 * founding-admin-directory-inc3.md, T-G test 3). The real-database half is
 * `org-provisioning.test.ts`, which proves what lands in Postgres; this file
 * proves the one thing a real database cannot show without editing production
 * code: that `createOrganization()` THROWS when the group a baseline role binds
 * to is not among the rows its own insert returned.
 *
 * Why that matters. drizzle/0066's `groups_pair_derived` trigger inserts All
 * Current Records whenever Active Membership is inserted, but a `RETURNING`
 * clause does not return a row a trigger inserted. So the `calendar_viewer`
 * binding finds its group only because the plan lists `all_memberships`
 * explicitly. Remove the plan entry and the lookup misses; the existing
 * throw-if-missing must then fail the whole transaction loudly rather than ship
 * an organization with no calendar role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

const h = vi.hoisted(() => ({
  /** Tables, by identity, filled in below once the schema modules load. */
  tables: {} as Record<string, unknown>,
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  /** Rows the groups insert's RETURNING hands back; the test may drop some. */
  dropFromReturning: new Set<string>(),
}));

vi.mock("@/lib/db", () => ({
  db: {},
  getPlatformDb: () => fakePlatform(),
}));

// The schema barrel is circular; the real `@/lib/db` loads it first (it is
// mocked here), so load it first too.
await import("@/lib/db/schema");
const { organizations } = await import("@/lib/db/domain/org");
const { groups, groupTypes } = await import("@/lib/db/domain/groups");
const { appRoles } = await import("@/lib/db/domain/authz");
h.tables = { groups, groupTypes, organizations, appRoles };

function fakePlatform() {
  const templates = [
    { id: "t-court", key: "court" },
    { id: "t-roster", key: "roster" },
  ];
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === h.tables.groupTypes) return Promise.resolve(templates);
        return { where: () => ({ limit: async () => [] }) };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx()),
  };
}

function fakeTx() {
  let groupCounter = 0;
  let roleCounter = 0;
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        h.inserts.push({ table, values });
        const done = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<unknown[]>;
        };
        done.returning = async () => {
          if (table === h.tables.organizations) return [{ id: "org-1" }];
          if (table === h.tables.groups) {
            return (values as Array<{ derivedFrom: string }>)
              .filter((g) => !h.dropFromReturning.has(g.derivedFrom))
              .map((g) => ({ id: `group-${(groupCounter += 1)}-${g.derivedFrom}`, derivedFrom: g.derivedFrom }));
          }
          if (table === h.tables.appRoles) {
            return [{ id: `role-${(roleCounter += 1)}-${(values as { key: string }).key}` }];
          }
          return [];
        };
        return done;
      },
    }),
  };
}

const { createOrganization } = await import("./org-provisioning");

const TYPES = ["congregation", "presbytery", "synod", "general_assembly", "new_worshiping_community"] as const;

const input = (organizationType: (typeof TYPES)[number]) => ({
  name: "Fixture Plan Org",
  slug: `plan-test-${organizationType.replace(/_/g, "-")}`,
  organizationType,
  platformStatus: "managed" as const,
});

beforeEach(() => {
  h.inserts.length = 0;
  h.dropFromReturning.clear();
});

const insertsInto = (table: unknown) => h.inserts.filter((i) => i.table === table);

describe("createOrganization: the all_memberships group and the calendar_viewer binding", () => {
  it.each(TYPES)("%s: inserts Active Membership and All Current Records explicitly, protected and derived", async (type) => {
    const result = await createOrganization(input(type));
    expect(result).toEqual({ kind: "ok", organizationId: "org-1" });

    const groupInsert = insertsInto(h.tables.groups)[0]!.values as Array<Record<string, unknown>>;
    for (const kind of ["active_membership", "all_memberships"]) {
      const row = groupInsert.find((g) => g.derivedFrom === kind);
      expect(row, `${type}/${kind}`).toBeDefined();
      expect(row).toMatchObject({
        organizationId: "org-1",
        groupTypeId: "t-roster",
        membershipSource: "derived",
        isProtected: true,
      });
    }
    expect(groupInsert.find((g) => g.derivedFrom === "all_memberships")!.name).toBe("All Current Records");
  });

  it.each(TYPES)("%s: binds calendar_viewer to the all_memberships group the plan inserted, and member to active_membership", async (type) => {
    await createOrganization(input(type));

    const roleKeys = insertsInto(h.tables.appRoles).map((i) => (i.values as { key: string }).key);
    expect(roleKeys).toContain("calendar_viewer");
    expect(roleKeys).toContain("member");

    // Grants are inserted in role order, each straight after its role.
    const grants = h.inserts.filter((i) => i.table !== h.tables.appRoles && i.table !== h.tables.groups && i.table !== h.tables.organizations);
    const grantRows = grants
      .map((g) => g.values as Record<string, unknown>)
      .filter((v) => typeof v === "object" && v !== null && "roleId" in v && "groupId" in v);
    const grantOf = (key: string) => grantRows.find((g) => String(g.roleId).endsWith(`-${key}`));
    expect(grantOf("calendar_viewer")!.groupId).toMatch(/-all_memberships$/);
    expect(grantOf("member")!.groupId).toMatch(/-active_membership$/);
    for (const g of grantRows) expect(g.personId, "group arm only").toBeUndefined();
  });

  it.each(TYPES)("%s: THROWS when the all_memberships row is not among the returned rows (a trigger-only insert), naming the group and the role", async (type) => {
    h.dropFromReturning.add("all_memberships");
    await expect(createOrganization(input(type))).rejects.toThrow(
      'no "all_memberships" group was seeded; cannot bind the "calendar_viewer" baseline role',
    );
  });

  it("still throws, naming member, when Active Membership is the one missing", async () => {
    h.dropFromReturning.add("active_membership");
    await expect(createOrganization(input("presbytery"))).rejects.toThrow(
      'no "active_membership" group was seeded; cannot bind the "member" baseline role',
    );
  });
});
