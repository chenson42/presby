/**
 * Integration tests for the four in-transaction primitives extracted from
 * `src/lib/groups.ts` (worship Increment 1, Batch 0; DECISION-326, R6):
 * `insertManagedGroupInTx`, `updateManagedGroupInTx`, `addManagedGroupMemberInTx`
 * and `endManagedGroupMemberInTx`.
 *
 * Run against a REAL Postgres connection (same harness and skip-guard as
 * `groups.test.ts`, whose assertions on the public exports are the other half
 * of the "behaviour unchanged" proof). The viewer here holds NO `groups.manage`:
 * the primitives check no permission - the caller (the worship store) gates on
 * its own key - so a successful call by a grantless viewer is itself the
 * assertion that nothing in the primitive gates.
 *
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/groups.primitives.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {},
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("groups.ts in-transaction primitives (Postgres-backed)", () => {
  let insertManagedGroupInTx: typeof import("./groups").insertManagedGroupInTx;
  let updateManagedGroupInTx: typeof import("./groups").updateManagedGroupInTx;
  let addManagedGroupMemberInTx: typeof import("./groups").addManagedGroupMemberInTx;
  let endManagedGroupMemberInTx: typeof import("./groups").endManagedGroupMemberInTx;
  let createGroup: typeof import("./groups").createGroup;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let groupMemberships: typeof import("@/lib/db/domain/groups").groupMemberships;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;

  const stamp = Date.now();
  let orgA: string;
  let orgB: string;
  let viewer: string; // orgA, holds no permission at all
  let target: string; // orgA, current membership
  let target2: string; // orgA, current membership
  let lapsed: string; // orgA, membership ended
  let outsider: string; // orgB only

  let choirTypeId: string;
  let courtTypeId: string;
  let committeeTypeId: string;
  let rosterTypeId: string;

  let managedGroupA: string;
  let managedGroupB: string;
  let derivedGroupA: string; // Active Membership, derived

  beforeAll(async () => {
    ({
      insertManagedGroupInTx,
      updateManagedGroupInTx,
      addManagedGroupMemberInTx,
      endManagedGroupMemberInTx,
      createGroup,
    } = await import("./groups"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ withOrgContext } = await import("@/lib/authz"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups, groupMemberships } = await import("@/lib/db/domain/groups"));
    ({ people, memberships } = await import("@/lib/db/domain/people"));

    const platform = getPlatformDb();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for groups.primitives.db.test.ts`,
          slug: `groups-prim-${label.toLowerCase()}-${stamp}`,
          path: `groups_prim_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }
    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    const CATALOG_NAMES: Record<string, string> = {
      court: "Court",
      roster: "Roster",
      committee: "Committee",
      choir: "Choir",
    };
    async function findOrCreateGroupType(key: string) {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, key))
        .limit(1);
      if (existing?.id) return existing.id;
      const [gt] = await platform
        .insert(groupTypes)
        .values({ key, name: CATALOG_NAMES[key] ?? key })
        .returning({ id: groupTypes.id });
      return gt!.id;
    }
    rosterTypeId = await findOrCreateGroupType("roster");
    courtTypeId = await findOrCreateGroupType("court");
    committeeTypeId = await findOrCreateGroupType("committee");
    choirTypeId = await findOrCreateGroupType("choir");

    // The derived "Active Membership" group every membership insert syncs into.
    for (const org of [orgA, orgB]) {
      const [row] = await platform
        .insert(groups)
        .values({
          organizationId: org,
          groupTypeId: rosterTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        })
        .returning({ id: groups.id });
      if (org === orgA) derivedGroupA = row!.id;
    }

    async function person(first: string, last: string) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last, deletableUntil: fixtureDeletableUntil() })
        .returning({ id: people.id });
      return p!.id;
    }
    viewer = await person("Prudence", "Wolcott-Ng");
    target = await person("Leopold", "Adeyemi-Roth");
    target2 = await person("Winifred", "Castellanos");
    lapsed = await person("Cornelius", "Vanterpool");
    outsider = await person("Esperanza", "Lindqvist");

    async function membership(org: string, personId: string) {
      await platform.insert(memberships).values({
        organizationId: org,
        personId,
        engagementStatus: "regular",
        currentRoll: "active",
      });
    }
    await membership(orgA, viewer);
    await membership(orgA, target);
    await membership(orgA, target2);
    await membership(orgA, lapsed);
    await membership(orgB, outsider);

    await platform.execute(sql`alter table memberships disable trigger memberships_guard_end`);
    try {
      await platform
        .update(memberships)
        .set({ endedOn: "2021-06-15" })
        .where(eq(memberships.personId, lapsed));
    } finally {
      await platform.execute(sql`alter table memberships enable trigger memberships_guard_end`);
    }

    const [mA] = await platform
      .insert(groups)
      .values({
        organizationId: orgA,
        groupTypeId: committeeTypeId,
        name: "Primitive fixture committee A",
        membershipSource: "managed",
        derivedFrom: null,
        isProtected: false,
      })
      .returning({ id: groups.id });
    managedGroupA = mA!.id;
    const [mB] = await platform
      .insert(groups)
      .values({
        organizationId: orgB,
        groupTypeId: committeeTypeId,
        name: "Primitive fixture committee B",
        membershipSource: "managed",
        derivedFrom: null,
        isProtected: false,
      })
      .returning({ id: groups.id });
    managedGroupB = mB!.id;
  });

  afterAll(async () => {
    const platform = getPlatformDb();
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
    for (const id of [viewer, target, target2, lapsed, outsider]) {
      await platform.delete(people).where(eq(people.id, id));
    }
  });

  const inTx = <T>(fn: (tx: import("@/lib/authz").OrgTx) => Promise<T>) =>
    withOrgContext(viewer, orgA, fn);

  // -------------------------------------------------------------------
  // insertManagedGroupInTx
  // -------------------------------------------------------------------

  describe("insertManagedGroupInTx", () => {
    it("creates a managed, unprotected group for a viewer holding no groups.manage (no permission check)", async () => {
      const result = await inTx((tx) =>
        insertManagedGroupInTx(tx, orgA, {
          groupTypeId: choirTypeId,
          name: "  Sanctuary Choir (primitive)  ",
          description: " Thursday evenings ",
          meetsWhen: "",
        }),
      );
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);

      const [row] = await getPlatformDb()
        .select()
        .from(groups)
        .where(eq(groups.id, result.data.groupId));
      expect(row).toMatchObject({
        organizationId: orgA,
        groupTypeId: choirTypeId,
        name: "Sanctuary Choir (primitive)",
        description: "Thursday evenings",
        meetsWhen: null,
        membershipSource: "managed",
        derivedFrom: null,
        isProtected: false,
      });
    });

    it("refuses a type outside the manageable subset (court) and writes nothing", async () => {
      const before = await getPlatformDb()
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.organizationId, orgA));
      const result = await inTx((tx) =>
        insertManagedGroupInTx(tx, orgA, { groupTypeId: courtTypeId, name: "Not a team" }),
      );
      expect(result.kind).toBe("invalid_input");
      const after = await getPlatformDb()
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.organizationId, orgA));
      expect(after.length).toBe(before.length);
    });

    it("refuses an unknown group type id", async () => {
      const result = await inTx((tx) =>
        insertManagedGroupInTx(tx, orgA, {
          groupTypeId: "00000000-0000-4000-8000-000000000000",
          name: "Ghost type",
        }),
      );
      expect(result.kind).toBe("invalid_input");
    });

    it("refuses a blank name and a name over 200 characters", async () => {
      const blank = await inTx((tx) =>
        insertManagedGroupInTx(tx, orgA, { groupTypeId: choirTypeId, name: "   " }),
      );
      expect(blank).toEqual({ kind: "invalid_input", message: "Name is required." });
      const long = await inTx((tx) =>
        insertManagedGroupInTx(tx, orgA, { groupTypeId: choirTypeId, name: "x".repeat(201) }),
      );
      expect(long).toEqual({
        kind: "invalid_input",
        message: "Name must be 200 characters or fewer.",
      });
    });

    it("createGroup still gates: a viewer with no groups.manage is forbidden and the primitive is not reached", async () => {
      const result = await createGroup(viewer, orgA, {
        groupTypeId: choirTypeId,
        name: "Should never exist (primitive suite)",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  // -------------------------------------------------------------------
  // updateManagedGroupInTx
  // -------------------------------------------------------------------

  describe("updateManagedGroupInTx", () => {
    it("renames a managed group and trims its fields", async () => {
      const result = await inTx((tx) =>
        updateManagedGroupInTx(tx, orgA, {
          groupId: managedGroupA,
          name: "  Renamed committee  ",
          description: "  New description ",
        }),
      );
      expect(result).toEqual({ kind: "ok", data: { groupId: managedGroupA } });
      const [row] = await getPlatformDb()
        .select({ name: groups.name, description: groups.description })
        .from(groups)
        .where(eq(groups.id, managedGroupA));
      expect(row).toEqual({ name: "Renamed committee", description: "New description" });
    });

    it("treats a derived group as invalid_target and leaves its name alone", async () => {
      const result = await inTx((tx) =>
        updateManagedGroupInTx(tx, orgA, { groupId: derivedGroupA, name: "Hijacked" }),
      );
      expect(result).toEqual({ kind: "invalid_target" });
      const [row] = await getPlatformDb()
        .select({ name: groups.name })
        .from(groups)
        .where(eq(groups.id, derivedGroupA));
      expect(row!.name).toBe("Active Membership");
    });

    it("treats another organization's group as invalid_target", async () => {
      const result = await inTx((tx) =>
        updateManagedGroupInTx(tx, orgA, { groupId: managedGroupB, name: "Cross-org edit" }),
      );
      expect(result).toEqual({ kind: "invalid_target" });
    });

    it("refuses a blank name and a name over 200 characters", async () => {
      const blank = await inTx((tx) =>
        updateManagedGroupInTx(tx, orgA, { groupId: managedGroupA, name: " " }),
      );
      expect(blank.kind).toBe("invalid_input");
      const long = await inTx((tx) =>
        updateManagedGroupInTx(tx, orgA, { groupId: managedGroupA, name: "y".repeat(201) }),
      );
      expect(long.kind).toBe("invalid_input");
    });
  });

  // -------------------------------------------------------------------
  // addManagedGroupMemberInTx
  // -------------------------------------------------------------------

  describe("addManagedGroupMemberInTx", () => {
    it("adds a current member as a `member` row with source managed, whatever the viewer holds", async () => {
      const result = await inTx((tx) =>
        addManagedGroupMemberInTx(tx, orgA, {
          groupId: managedGroupA,
          personId: target,
          startsOn: "2026-01-04",
        }),
      );
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      const [row] = await getPlatformDb()
        .select()
        .from(groupMemberships)
        .where(eq(groupMemberships.id, result.data.groupMembershipId));
      expect(row).toMatchObject({
        organizationId: orgA,
        groupId: managedGroupA,
        personId: target,
        groupRole: "member",
        source: "managed",
        startsOn: "2026-01-04",
        endsOn: null,
      });
    });

    it("returns overlap, naming both, for a person already open on the group, and inserts nothing", async () => {
      const result = await inTx((tx) =>
        addManagedGroupMemberInTx(tx, orgA, {
          groupId: managedGroupA,
          personId: target,
          startsOn: "2026-02-01",
        }),
      );
      expect(result.kind).toBe("overlap");
      if (result.kind === "overlap") {
        expect(result.personName).toContain("Adeyemi-Roth");
        expect(result.groupName).toBe("Renamed committee");
      }
      const rows = await getPlatformDb()
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(eq(groupMemberships.groupId, managedGroupA), eq(groupMemberships.personId, target)),
        );
      expect(rows).toHaveLength(1);
    });

    it("refuses a derived group, a person whose membership ended, another org's person and another org's group", async () => {
      const derived = await inTx((tx) =>
        addManagedGroupMemberInTx(tx, orgA, {
          groupId: derivedGroupA,
          personId: target2,
          startsOn: "2026-01-04",
        }),
      );
      expect(derived).toEqual({ kind: "invalid_target" });

      const ended = await inTx((tx) =>
        addManagedGroupMemberInTx(tx, orgA, {
          groupId: managedGroupA,
          personId: lapsed,
          startsOn: "2026-01-04",
        }),
      );
      expect(ended).toEqual({ kind: "invalid_target" });

      const outside = await inTx((tx) =>
        addManagedGroupMemberInTx(tx, orgA, {
          groupId: managedGroupA,
          personId: outsider,
          startsOn: "2026-01-04",
        }),
      );
      expect(outside).toEqual({ kind: "invalid_target" });

      const otherGroup = await inTx((tx) =>
        addManagedGroupMemberInTx(tx, orgA, {
          groupId: managedGroupB,
          personId: target2,
          startsOn: "2026-01-04",
        }),
      );
      expect(otherGroup).toEqual({ kind: "invalid_target" });
    });

    it("throws on a malformed start date (a call-shape defect, as addGroupMember does)", async () => {
      await expect(
        inTx((tx) =>
          addManagedGroupMemberInTx(tx, orgA, {
            groupId: managedGroupA,
            personId: target2,
            startsOn: "01/04/2026",
          }),
        ),
      ).rejects.toThrow(/startsOn must be 'YYYY-MM-DD'/);
    });

    it("has no role parameter: a role smuggled in on the input is ignored and the row is `member`", async () => {
      const input = {
        groupId: managedGroupA,
        personId: target2,
        startsOn: "2026-03-01",
        groupRole: "chair",
      } as unknown as Parameters<typeof addManagedGroupMemberInTx>[2];
      const result = await inTx((tx) => addManagedGroupMemberInTx(tx, orgA, input));
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      const [row] = await getPlatformDb()
        .select({ groupRole: groupMemberships.groupRole })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, result.data.groupMembershipId));
      expect(row!.groupRole).toBe("member");
    });
  });

  // -------------------------------------------------------------------
  // endManagedGroupMemberInTx
  // -------------------------------------------------------------------

  describe("endManagedGroupMemberInTx", () => {
    async function openRow(personId: string): Promise<string> {
      const [row] = await getPlatformDb()
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, managedGroupA),
            eq(groupMemberships.personId, personId),
          ),
        )
        .limit(1);
      return row!.id;
    }

    it("sets ends_on on the existing row (never a delete)", async () => {
      const id = await openRow(target);
      const result = await inTx((tx) =>
        endManagedGroupMemberInTx(tx, orgA, { groupMembershipId: id, endsOn: "2026-06-01" }),
      );
      expect(result).toEqual({ kind: "ok", data: { groupMembershipId: id } });
      const [row] = await getPlatformDb()
        .select({ endsOn: groupMemberships.endsOn })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, id));
      expect(row!.endsOn).toBe("2026-06-01");
    });

    it("refuses an end date before the start date and leaves the row open", async () => {
      const id = await openRow(target2);
      const result = await inTx((tx) =>
        endManagedGroupMemberInTx(tx, orgA, { groupMembershipId: id, endsOn: "2020-01-01" }),
      );
      expect(result).toEqual({
        kind: "invalid_input",
        message: "The end date can't be before the start date.",
      });
      const [row] = await getPlatformDb()
        .select({ endsOn: groupMemberships.endsOn })
        .from(groupMemberships)
        .where(eq(groupMemberships.id, id));
      expect(row!.endsOn).toBeNull();
    });

    it("treats a derived row and an unknown id as invalid_target", async () => {
      const [derivedRow] = await getPlatformDb()
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, derivedGroupA),
            eq(groupMemberships.personId, target2),
          ),
        )
        .limit(1);
      expect(derivedRow).toBeDefined();
      const derived = await inTx((tx) =>
        endManagedGroupMemberInTx(tx, orgA, {
          groupMembershipId: derivedRow!.id,
          endsOn: "2026-06-01",
        }),
      );
      expect(derived).toEqual({ kind: "invalid_target" });

      const unknown = await inTx((tx) =>
        endManagedGroupMemberInTx(tx, orgA, {
          groupMembershipId: "00000000-0000-4000-8000-000000000000",
          endsOn: "2026-06-01",
        }),
      );
      expect(unknown).toEqual({ kind: "invalid_target" });
    });

    it("throws on a malformed end date", async () => {
      const id = await openRow(target2);
      await expect(
        inTx((tx) =>
          endManagedGroupMemberInTx(tx, orgA, { groupMembershipId: id, endsOn: "June 1" }),
        ),
      ).rejects.toThrow(/endsOn must be 'YYYY-MM-DD'/);
    });
  });
});
