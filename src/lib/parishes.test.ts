/**
 * Integration tests for src/lib/parishes.ts - run against a REAL Postgres
 * connection, not mocked (docs/work-log/2026-10-25-parish-management.md, Phase 3
 * "Edge Cases & Risks"; tag LIB). Same harness as `officers.test.ts`: the
 * `hasDb` skip-guard, dynamic imports in `beforeAll`, self-contained fixtures.
 *
 * `npm test` in CI does not set DATABASE_URL, so this suite is SKIPPED there.
 * Run it for real with:
 *   dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/parishes.test.ts
 *
 * THE FIXTURE congregations come out of the real `createOrganization()`, so
 * the seat group, the seat role, its `parishes.assign` key and the group grant
 * are the production provisioning, not a test copy of it:
 *   orgM - mutations (define, rename, archive, restore, move, bulk)
 *   orgU - read-only Unassigned / district-page / overview shapes
 *   orgL - 600 unassigned households (shape and paging; no timing assertion)
 *   orgB - another congregation: a district and a household that orgM must
 *          never reach
 * Every org has the same six actors (admin, seat holder, plain member,
 * directory.view_hidden viewer, definer-only, and a person holding only a
 * future/ended/moderator/deacon officer record).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 300_000 });

// `@/lib/audit` transitively imports `@/auth` (next-auth), which this test
// environment cannot resolve; the literal keys parishes.ts and org-features.ts
// read are restated here and pinned to audit.ts by audit.test.ts.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled",
    DISTRICT_CREATED: "tenant.district.created",
    DISTRICT_RENAMED: "tenant.district.renamed",
    DISTRICT_ARCHIVED: "tenant.district.archived",
    DISTRICT_RESTORED: "tenant.district.restored",
    HOUSEHOLD_DISTRICT_CHANGED: "tenant.household.district_changed",
    HOUSEHOLD_DISTRICT_BULK_MOVED: "tenant.household.district_bulk_moved",
  },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// The audit rows are written by the REAL insertAuditRow(s) in the same
// transaction as the change; this wrapper only lets a test force that insert
// to throw, to prove the change rolls back with it.
const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
    insertAuditRows: async (...args: Parameters<typeof actual.insertAuditRows>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRows(...args);
    },
  };
});

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

type Actors = {
  admin: string; // people.manage + officers.manage (a custom role)
  seat: string; // an open deacons_moderator term; NO admin key, NO view_hidden
  plain: string; // a current member holding nothing
  hiddenViewer: string; // directory.view_hidden only
  definer: string; // officers.manage only
  futureSeat: string; // a deacons_moderator term that starts in the future
  endedSeat: string; // a deacons_moderator term that has ended
  modOnly: string; // an open `moderator` term (Session presiding label)
  deaconOnly: string; // an open `deacon` term
};

describe.skipIf(!hasDb)("parishes.ts (Postgres-backed, real dev database)", () => {
  let P: typeof import("./parishes");
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let createOrganization: typeof import("./org-provisioning").createOrganization;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let orgUnits: typeof import("@/lib/db/domain/org").orgUnits;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let households: typeof import("@/lib/db/domain/people").households;
  let personPrivacy: typeof import("@/lib/db/domain/privacy").personPrivacy;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let officerTerms: typeof import("@/lib/db/domain/officers").officerTerms;
  let organizationFeatureToggles: typeof import("@/lib/db/domain/org-features").organizationFeatureToggles;
  let users: typeof import("@/lib/db/schema").users;
  let OrgAccessError: typeof import("@/lib/authz").OrgAccessError;

  const stamp = Date.now();
  const orgIds: string[] = [];
  const peopleIds: string[] = [];
  let orgM: string;
  let orgU: string;
  let orgL: string;
  let orgB: string;
  let M: Actors;
  let U: Actors;
  let B: Actors;
  let actorUserId: string;
  let actor: { userId: string; email: string | null };
  let today: string;

  // orgM fixture districts
  let dNorth: string;
  let dSouth: string;
  let dCampus: string;
  let dForeign: string; // orgB's

  // ------------------------------------------------------------------
  // Fixture helpers
  // ------------------------------------------------------------------

  async function mkPerson(first: string, last = "Parishfix"): Promise<string> {
    const platform = getPlatformDb();
    const [p] = await platform
      .insert(people)
      .values({ firstName: first, lastName: last, deletableUntil: fixtureDeletableUntil() })
      .returning({ id: people.id });
    peopleIds.push(p!.id);
    return p!.id;
  }

  async function mkMember(
    orgId: string,
    personId: string,
    opts: {
      roll?: string | null;
      engagement?: string;
      householdId?: string | null;
      endedOn?: string | null;
    } = {},
  ): Promise<void> {
    const platform = getPlatformDb();
    await platform.insert(memberships).values({
      organizationId: orgId,
      personId,
      householdId: opts.householdId ?? null,
      engagementStatus: opts.engagement ?? "regular",
      currentRoll: opts.roll === undefined ? "active" : opts.roll,
      endedOn: opts.endedOn ?? null,
    });
  }

  async function mkHousehold(
    orgId: string,
    name: string,
    orgUnitId: string | null = null,
  ): Promise<string> {
    const platform = getPlatformDb();
    const [h] = await platform
      .insert(households)
      .values({ organizationId: orgId, name, isGivingUnit: true, orgUnitId })
      .returning({ id: households.id });
    return h!.id;
  }

  /** A household with one current person (by default a member). */
  async function mkHouseholdWithPerson(
    orgId: string,
    name: string,
    opts: { orgUnitId?: string | null; roll?: string | null; engagement?: string; first?: string } = {},
  ): Promise<{ householdId: string; personId: string }> {
    const householdId = await mkHousehold(orgId, name, opts.orgUnitId ?? null);
    const personId = await mkPerson(opts.first ?? "Pat", name.replace(/\W/g, ""));
    await mkMember(orgId, personId, {
      householdId,
      roll: opts.roll,
      engagement: opts.engagement,
    });
    return { householdId, personId };
  }

  async function mkUnit(
    orgId: string,
    name: string,
    unitType: "district" | "parish" | "campus" = "district",
    archived = false,
  ): Promise<string> {
    const platform = getPlatformDb();
    const [u] = await platform
      .insert(orgUnits)
      .values({ organizationId: orgId, unitType, name })
      .returning({ id: orgUnits.id });
    if (archived) {
      await platform.execute(sql`update org_units set archived_at = now() where id = ${u!.id}::uuid`);
    }
    return u!.id;
  }

  async function archiveUnit(unitId: string): Promise<void> {
    await getPlatformDb().execute(sql`update org_units set archived_at = now() where id = ${unitId}::uuid`);
  }

  async function dbToday(): Promise<string> {
    const r = await getPlatformDb().execute(sql`select current_date::text as d`);
    return (r as unknown as { rows: Array<{ d: string }> }).rows[0]!.d;
  }

  async function dateOffset(days: number): Promise<string> {
    const r = await getPlatformDb().execute(
      sql`select (current_date + ${days}::int)::text as d`,
    );
    return (r as unknown as { rows: Array<{ d: string }> }).rows[0]!.d;
  }

  async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const r = await getPlatformDb().execute(query);
    return (r as unknown as { rows: T[] }).rows;
  }

  async function unitIdOfHousehold(householdId: string): Promise<string | null> {
    const rows = await rowsOf<{ org_unit_id: string | null }>(
      sql`select org_unit_id::text as org_unit_id from households where id = ${householdId}::uuid`,
    );
    return rows[0]?.org_unit_id ?? null;
  }

  async function auditFor(
    action: string,
    resourceId: string,
  ): Promise<Array<{ metadata: Record<string, unknown>; actor_user_id: string | null }>> {
    return rowsOf(
      sql`select metadata, actor_user_id::text as actor_user_id from audit_events
           where action = ${action} and resource_id = ${resourceId}
           order by created_at`,
    );
  }

  async function auditCountForOrg(orgId: string): Promise<number> {
    const rows = await rowsOf<{ n: number }>(
      sql`select count(*)::int as n from audit_events
           where (action like 'tenant.district.%' or action like 'tenant.household.district_%')
             and metadata->>'organizationId' = ${orgId}`,
    );
    return rows[0]!.n;
  }

  async function setToggle(orgId: string, enabled: boolean): Promise<void> {
    const platform = getPlatformDb();
    await platform
      .insert(organizationFeatureToggles)
      .values({ organizationId: orgId, featureKey: "org_portal.parishes", enabled })
      .onConflictDoUpdate({
        target: [organizationFeatureToggles.organizationId, organizationFeatureToggles.featureKey],
        set: { enabled },
      });
  }

  async function customRole(orgId: string, key: string, perms: string[], personId: string): Promise<void> {
    const platform = getPlatformDb();
    const [role] = await platform
      .insert(appRoles)
      .values({ organizationId: orgId, key, name: `Fixture ${key}`, roleKind: "custom", isProtected: false })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values(perms.map((permissionKey) => ({ roleId: role!.id, permissionKey })));
    await platform.insert(roleGrants).values({
      organizationId: orgId,
      roleId: role!.id,
      personId,
      startsOn: "2020-01-01",
      grantedBy: actorUserId,
    });
  }

  async function mkOrg(label: string): Promise<{ orgId: string; actors: Actors }> {
    const result = await createOrganization({
      name: `Fixture Congregation ${label} for parishes.test.ts`,
      slug: `parishes-test-${label.toLowerCase()}-${stamp}`,
      organizationType: "congregation",
      platformStatus: "managed",
    });
    if (result.kind !== "ok") throw new Error(`createOrganization failed: ${result.kind}`);
    const orgId = result.organizationId;
    orgIds.push(orgId);
    await setToggle(orgId, true);

    const platform = getPlatformDb();
    const actors = {} as Actors;
    for (const key of [
      "admin",
      "seat",
      "plain",
      "hiddenViewer",
      "definer",
      "futureSeat",
      "endedSeat",
      "modOnly",
      "deaconOnly",
    ] as const) {
      const id = await mkPerson(key, `Actor${label}`);
      await mkMember(orgId, id);
      actors[key] = id;
    }
    await customRole(orgId, "fx_admin", ["people.manage", "officers.manage"], actors.admin);
    await customRole(orgId, "fx_hidden", ["directory.view_hidden"], actors.hiddenViewer);
    await customRole(orgId, "fx_definer", ["officers.manage"], actors.definer);

    const district = await mkUnit(orgId, `Actor district ${label}`);
    const past = "2020-01-01";
    const future = await dateOffset(400);
    const endedOn = "2021-01-01";
    await platform.insert(officerTerms).values([
      { organizationId: orgId, personId: actors.seat, office: "deacons_moderator", startsOn: past },
      { organizationId: orgId, personId: actors.futureSeat, office: "deacons_moderator", startsOn: future },
      { organizationId: orgId, personId: actors.endedSeat, office: "deacons_moderator", startsOn: past, endsOn: endedOn, endReason: "completed" },
      { organizationId: orgId, personId: actors.modOnly, office: "moderator", startsOn: past },
      { organizationId: orgId, personId: actors.deaconOnly, office: "deacon", startsOn: past, orgUnitId: district },
    ]);
    return { orgId, actors };
  }

  beforeAll(async () => {
    P = await import("./parishes");
    ({ withOrgContext, OrgAccessError } = await import("@/lib/authz"));
    ({ createOrganization } = await import("./org-provisioning"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations, orgUnits } = await import("@/lib/db/domain/org"));
    ({ people, memberships, households } = await import("@/lib/db/domain/people"));
    ({ personPrivacy } = await import("@/lib/db/domain/privacy"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import("@/lib/db/domain/authz"));
    ({ officerTerms } = await import("@/lib/db/domain/officers"));
    ({ organizationFeatureToggles } = await import("@/lib/db/domain/org-features"));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();
    today = await dbToday();

    for (const key of ["people.manage", "officers.manage", "directory.view_hidden"]) {
      await platform
        .insert(permissions)
        .values({ key, module: key.split(".")[0]!, description: `${key} (fixture)`, sensitivityTier: 1 })
        .onConflictDoNothing();
    }
    const [userRow] = await platform
      .insert(users)
      .values({ email: `parishes-test-actor-${stamp}@example.invalid`, name: "Parishes Test Actor" })
      .returning({ id: users.id });
    actorUserId = userRow!.id;
    actor = { userId: actorUserId, email: "actor@example.invalid" };

    ({ orgId: orgM, actors: M } = await mkOrg("M"));
    ({ orgId: orgU, actors: U } = await mkOrg("U"));
    ({ orgId: orgB, actors: B } = await mkOrg("B"));

    dNorth = await mkUnit(orgM, "North District");
    dSouth = await mkUnit(orgM, "South District");
    dCampus = await mkUnit(orgM, "Hillside Campus", "campus");
    dForeign = await mkUnit(orgB, "Foreign District");
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    await platform.execute(
      sql`delete from audit_events where metadata->>'organizationId' in (${sql.join(
        orgIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
    // person_privacy has a NO ACTION composite FK onto memberships: remove it
    // first. The derived-roster trigger rejects the cascade DELETE of its own
    // rows (drizzle/0033), so it is disabled around the org cascade.
    for (const id of orgIds) {
      await platform.delete(personPrivacy).where(eq(personPrivacy.organizationId, id));
    }
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const id of [...orgIds].reverse()) {
        await platform
          .update(organizations)
          .set({ deletableUntil: fixtureDeletableUntil() })
          .where(eq(organizations.id, id));
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    } finally {
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    for (const id of peopleIds) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, actorUserId));
  });

  // ---------------------------------------------------------------------
  // Provisioning: the seat is the production seed, not a test copy
  // ---------------------------------------------------------------------

  describe("createOrganization provisions the seat (DECISION-242)", () => {
    it("a new congregation has the Board of Deacons Moderator roster group, a protected constitutional deacons_moderator role carrying parishes.assign ONLY, and a group-arm grant (never a person grant)", async () => {
      const group = await rowsOf<{ name: string; type_key: string; membership_source: string; is_protected: boolean }>(sql`
        select g.name, gt.key as type_key, g.membership_source, g.is_protected
          from groups g join group_types gt on gt.id = g.group_type_id
         where g.organization_id = ${orgM}::uuid and g.derived_from = 'deacons_moderator'
      `);
      expect(group).toEqual([
        { name: "Board of Deacons Moderator", type_key: "roster", membership_source: "derived", is_protected: true },
      ]);
      const role = await rowsOf<{ key: string; role_kind: string; is_protected: boolean; keys: string[] }>(sql`
        select r.key, r.role_kind, r.is_protected,
               array(select permission_key from app_role_permissions where role_id = r.id) as keys
          from app_roles r where r.organization_id = ${orgM}::uuid and r.key = 'deacons_moderator'
      `);
      expect(role).toEqual([
        { key: "deacons_moderator", role_kind: "constitutional", is_protected: true, keys: ["parishes.assign"] },
      ]);
      const grants = await rowsOf<{ person_id: string | null; group_derived: string | null }>(sql`
        select rg.person_id::text as person_id, g.derived_from as group_derived
          from role_grants rg join app_roles r on r.id = rg.role_id
          left join groups g on g.id = rg.group_id
         where rg.organization_id = ${orgM}::uuid and r.key = 'deacons_moderator'
      `);
      expect(grants).toEqual([{ person_id: null, group_derived: "deacons_moderator" }]);
    });
  });

  // ---------------------------------------------------------------------
  // Authority: one query, four keys, read live
  // ---------------------------------------------------------------------

  describe("getParishAuthority", () => {
    async function authorityOf(personId: string, orgId = orgM, managed = true) {
      return withOrgContext(personId, orgId, (tx) => P.getParishAuthority(tx, personId, orgId, managed));
    }

    it("an administrator (people.manage + officers.manage): defines, moves, lists, reads, sees hidden names - and does not hold the seat key", async () => {
      expect(await authorityOf(M.admin)).toEqual({
        canDefine: true,
        canMove: true,
        canListHouseholds: true,
        canReadRoster: true,
        seesHiddenNames: true,
        holdsSeatKey: false,
      });
    });

    it("the seat holder: moves and lists and reads, but does NOT define, and does not see hidden names", async () => {
      expect(await authorityOf(M.seat)).toEqual({
        canDefine: false,
        canMove: true,
        canListHouseholds: true,
        canReadRoster: true,
        seesHiddenNames: false,
        holdsSeatKey: true,
      });
    });

    it("a directory.view_hidden viewer lists and reads and sees hidden names but cannot move or define; a definer-only reads the roster but does not list households (least privilege, P3-3)", async () => {
      expect(await authorityOf(M.hiddenViewer)).toMatchObject({
        canDefine: false,
        canMove: false,
        canListHouseholds: true,
        canReadRoster: true,
        seesHiddenNames: true,
      });
      expect(await authorityOf(M.definer)).toMatchObject({
        canDefine: true,
        canMove: false,
        canListHouseholds: false,
        canReadRoster: true,
        seesHiddenNames: false,
      });
    });

    it("a plain member has nothing", async () => {
      expect(await authorityOf(M.plain)).toEqual({
        canDefine: false,
        canMove: false,
        canListHouseholds: false,
        canReadRoster: false,
        seesHiddenNames: false,
        holdsSeatKey: false,
      });
    });

    it("a pre-existing moderator term, a deacon term, a future seat and an ended seat each confer nothing - no existing row gains authority (G3)", async () => {
      for (const who of [M.modOnly, M.deaconOnly, M.futureSeat, M.endedSeat]) {
        expect(await authorityOf(who), who).toMatchObject({ canMove: false, holdsSeatKey: false, canReadRoster: false });
      }
    });

    it("the seat's dates are the resolver's half-open rule: a seat starting TODAY holds the key, a seat ending TODAY does not", async () => {
      const platform = getPlatformDb();
      const startsToday = await mkPerson("startstoday", "Boundary");
      const endsToday = await mkPerson("endstoday", "Boundary");
      await mkMember(orgM, startsToday);
      await mkMember(orgM, endsToday);
      await platform.insert(officerTerms).values([
        { organizationId: orgM, personId: startsToday, office: "deacons_moderator", startsOn: today },
        { organizationId: orgM, personId: endsToday, office: "deacons_moderator", startsOn: "2020-01-01", endsOn: today, endReason: "completed" },
      ]);
      expect((await authorityOf(startsToday)).holdsSeatKey).toBe(true);
      expect((await authorityOf(endsToday)).holdsSeatKey).toBe(false);
    });

    it("a seat at org A grants nothing at org B (a cross-org seat)", async () => {
      // M.seat has no membership at orgB at all, so the call is refused outright.
      await expect(authorityOf(M.seat, orgB)).rejects.toBeInstanceOf(OrgAccessError);
      // And B's own seat holder is not a seat holder at M.
      await expect(authorityOf(B.seat, orgM)).rejects.toBeInstanceOf(OrgAccessError);
    });

    it("managed=false (the toggle off) is today's behaviour: directory.view_hidden alone reads, nothing else is held", async () => {
      expect(await authorityOf(M.hiddenViewer, orgM, false)).toEqual({
        canDefine: false,
        canMove: false,
        canListHouseholds: false,
        canReadRoster: true,
        seesHiddenNames: true,
        holdsSeatKey: false,
      });
      expect(await authorityOf(M.admin, orgM, false)).toMatchObject({ canReadRoster: false, canMove: false });
    });
  });

  // ---------------------------------------------------------------------
  // The toggle gates every function; "off" is not "forbidden"
  // ---------------------------------------------------------------------

  describe("the per-org toggle", () => {
    it("with the toggle OFF every mutator and reader answers off, and nothing is written", async () => {
      await setToggle(orgM, false);
      try {
        const before = await auditCountForOrg(orgM);
        expect(await P.defineDistrict(M.admin, orgM, actor, { name: "Toggle Off" })).toEqual({ kind: "off" });
        expect(await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: dNorth, name: "X" })).toEqual({ kind: "off" });
        expect(await P.archiveDistrict(M.admin, orgM, actor, { orgUnitId: dNorth })).toEqual({ kind: "off" });
        expect(await P.restoreDistrict(M.admin, orgM, actor, { orgUnitId: dNorth })).toEqual({ kind: "off" });
        expect(
          await P.moveHousehold(M.admin, orgM, actor, { householdId: randomUUID(), expectedOrgUnitId: null, targetOrgUnitId: dNorth }),
        ).toEqual({ kind: "off" });
        expect(
          await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: dNorth, targetOrgUnitId: dSouth, expectedCount: 1 }),
        ).toEqual({ kind: "off" });
        expect(await P.getDistrictPage(M.admin, orgM, dNorth)).toEqual({ kind: "off" });
        expect(await P.getUnassignedPage(M.admin, orgM)).toEqual({ kind: "off" });
        expect(await rowsOf(sql`select 1 from org_units where organization_id = ${orgM}::uuid and name = 'Toggle Off'`)).toHaveLength(0);
        expect(await auditCountForOrg(orgM)).toBe(before);
        expect(await P.canReadParishRoster(M.admin, orgM)).toBe(false);
        expect(await P.canReadParishRoster(M.hiddenViewer, orgM)).toBe(true);
      } finally {
        await setToggle(orgM, true);
      }
    });

    it("the overview with the toggle off is the legacy read: gated on directory.view_hidden alone, active units only, managed false, no unassigned count", async () => {
      await setToggle(orgM, false);
      try {
        const denied = await P.getParishesOverview(M.admin, orgM);
        expect(denied).toEqual({ kind: "forbidden" });
        const ok = await P.getParishesOverview(M.hiddenViewer, orgM);
        if (ok.kind !== "ok") throw new Error("expected ok");
        expect(ok.managed).toBe(false);
        expect(ok.unassignedCount).toBeNull();
        expect(ok.seatFilled).toBeNull();
        expect(ok.districts.map((d) => d.name)).toContain("North District");
      } finally {
        await setToggle(orgM, true);
      }
    });

    it("a congregation-only toggle: orgFeatureEnabledInTx is false for a presbytery even with a stray row", async () => {
      const presb = await createOrganization({
        name: `Fixture Presbytery for parishes.test.ts`,
        slug: `parishes-test-presb-${stamp}`,
        organizationType: "presbytery",
        platformStatus: "unmanaged",
      });
      if (presb.kind !== "ok") throw new Error("expected ok");
      orgIds.push(presb.organizationId);
      const person = await mkPerson("presb", "Actor");
      await mkMember(presb.organizationId, person);
      await setToggle(presb.organizationId, true);
      const categoryAxis = false;
      const { orgFeatureEnabledInTx } = await import("./org-features");
      const on = await withOrgContext(person, presb.organizationId, (tx) =>
        orgFeatureEnabledInTx(tx, presb.organizationId, "org_portal.parishes", categoryAxis),
      );
      expect(on).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // District lifecycle
  // ---------------------------------------------------------------------

  describe("define, rename, archive, restore", () => {
    it("defineDistrict creates a `district`, audits it with names only, and refuses a seat holder (canMove is not canDefine)", async () => {
      const result = await P.defineDistrict(M.admin, orgM, actor, { name: "  West   District " });
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      expect(result.name).toBe("West District");
      const rows = await rowsOf<{ unit_type: string; archived_at: string | null }>(
        sql`select unit_type, archived_at::text as archived_at from org_units where id = ${result.orgUnitId}::uuid`,
      );
      expect(rows).toEqual([{ unit_type: "district", archived_at: null }]);
      const audits = await auditFor("tenant.district.created", result.orgUnitId);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actor_user_id).toBe(actorUserId);
      expect(audits[0]!.metadata).toEqual({ organizationId: orgM, name: "West District" });

      const before = await auditCountForOrg(orgM);
      expect(await P.defineDistrict(M.seat, orgM, actor, { name: "Seat Made This" })).toEqual({ kind: "forbidden" });
      expect(await P.defineDistrict(M.plain, orgM, actor, { name: "Plain Made This" })).toEqual({ kind: "forbidden" });
      expect(await rowsOf(sql`select 1 from org_units where organization_id = ${orgM}::uuid and name in ('Seat Made This','Plain Made This')`)).toHaveLength(0);
      expect(await auditCountForOrg(orgM)).toBe(before);
    });

    it("a definer-only (officers.manage) can define", async () => {
      const result = await P.defineDistrict(M.definer, orgM, actor, { name: "Definer District" });
      expect(result.kind).toBe("ok");
    });

    it("refuses an empty name, a 5,000-character name and a name over 80 characters before the database; strips zero-width and control characters", async () => {
      expect(await P.defineDistrict(M.admin, orgM, actor, { name: "   " })).toEqual({ kind: "invalid_input", reason: "empty" });
      expect(await P.defineDistrict(M.admin, orgM, actor, { name: "\u200B\u0007" })).toEqual({ kind: "invalid_input", reason: "empty" });
      expect(await P.defineDistrict(M.admin, orgM, actor, { name: "x".repeat(5000) })).toEqual({ kind: "invalid_input", reason: "too_long" });
      expect(await P.defineDistrict(M.admin, orgM, actor, { name: "y".repeat(81) })).toEqual({ kind: "invalid_input", reason: "too_long" });
      const ok = await P.defineDistrict(M.admin, orgM, actor, { name: `Zero\u200BWidth ${"z".repeat(70)}` });
      if (ok.kind !== "ok") throw new Error("expected ok");
      expect(ok.name).toBe(`ZeroWidth ${"z".repeat(70)}`);
    });

    it("a duplicate among ACTIVE names is name_taken, case-insensitively, and writes no audit row", async () => {
      const before = await auditCountForOrg(orgM);
      expect(await P.defineDistrict(M.admin, orgM, actor, { name: "north district" })).toEqual({ kind: "name_taken" });
      expect(await P.defineDistrict(M.admin, orgM, actor, { name: "NORTH  DISTRICT" })).toEqual({ kind: "name_taken" });
      expect(await auditCountForOrg(orgM)).toBe(before);
    });

    it("the same name in another congregation is fine (uniqueness is per organization)", async () => {
      const result = await P.defineDistrict(B.admin, orgB, actor, { name: "North District" });
      expect(result.kind).toBe("ok");
    });

    it("renameDistrict renames, audits {from,to}, treats an unchanged name as a quiet no-op (no audit), and maps a collision to name_taken", async () => {
      const u = await mkUnit(orgM, "Rename Me");
      const renamed = await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: u, name: "Renamed District" });
      expect(renamed).toEqual({ kind: "ok", changed: true, name: "Renamed District" });
      const audits = await auditFor("tenant.district.renamed", u);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.metadata).toEqual({ organizationId: orgM, from: "Rename Me", to: "Renamed District" });

      expect(await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: u, name: "Renamed District" })).toEqual({
        kind: "ok",
        changed: false,
        name: "Renamed District",
      });
      expect(await auditFor("tenant.district.renamed", u)).toHaveLength(1);

      expect(await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: u, name: "south district" })).toEqual({ kind: "name_taken" });
      // A case-only change of its OWN name is allowed (the index excludes the row itself).
      expect(await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: u, name: "RENAMED district" })).toMatchObject({ kind: "ok", changed: true });
    });

    it("rename, archive and restore refuse a campus, a foreign id, a malformed id and a nonexistent id with the same not_found", async () => {
      for (const id of [dCampus, dForeign, "not-a-uuid", randomUUID()]) {
        expect(await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: id, name: "Nope" }), id).toEqual({ kind: "not_found" });
        expect(await P.archiveDistrict(M.admin, orgM, actor, { orgUnitId: id }), id).toEqual({ kind: "not_found" });
        expect(await P.restoreDistrict(M.admin, orgM, actor, { orgUnitId: id }), id).toEqual({ kind: "not_found" });
      }
    });

    it("archiveDistrict returns the count and the open deacon, audits once, leaves its households in place, and a second archive is wrong_state", async () => {
      const u = await mkUnit(orgM, "Archive Me");
      const h1 = await mkHouseholdWithPerson(orgM, "Arch One", { orgUnitId: u });
      await mkHouseholdWithPerson(orgM, "Arch Two", { orgUnitId: u });
      const deacon = await mkPerson("Dee", "Deaconson");
      await mkMember(orgM, deacon);
      await getPlatformDb().insert(officerTerms).values({
        organizationId: orgM,
        personId: deacon,
        office: "deacon",
        orgUnitId: u,
        startsOn: "2020-01-01",
      });

      const result = await P.archiveDistrict(M.admin, orgM, actor, { orgUnitId: u });
      expect(result).toEqual({ kind: "ok", name: "Archive Me", householdCount: 2, openDeaconName: "Dee Deaconson" });
      const audits = await auditFor("tenant.district.archived", u);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.metadata).toEqual({ organizationId: orgM, householdCount: 2, hadOpenDeacon: true });
      // Archiving moves nothing.
      expect(await unitIdOfHousehold(h1.householdId)).toBe(u);
      expect(await P.archiveDistrict(M.admin, orgM, actor, { orgUnitId: u })).toEqual({ kind: "wrong_state" });
      expect(await auditFor("tenant.district.archived", u)).toHaveLength(1);
      // Rename of an archived district is wrong_state too.
      expect(await P.renameDistrict(M.admin, orgM, actor, { orgUnitId: u, name: "Anything" })).toEqual({ kind: "wrong_state" });
    });

    it("archive and restore refuse a seat holder, a plain member and a hidden-viewer", async () => {
      const u = await mkUnit(orgM, "Guarded");
      for (const who of [M.seat, M.plain, M.hiddenViewer]) {
        expect(await P.archiveDistrict(who, orgM, actor, { orgUnitId: u }), who).toEqual({ kind: "forbidden" });
        expect(await P.restoreDistrict(who, orgM, actor, { orgUnitId: u }), who).toEqual({ kind: "forbidden" });
      }
    });

    it("restoreDistrict restores an archived district (audited), wrong_state for an active one, and name_taken when an active district has since taken the name", async () => {
      const u = await mkUnit(orgM, "Restore Me", "district", true);
      expect(await P.restoreDistrict(M.admin, orgM, actor, { orgUnitId: u })).toEqual({ kind: "ok", name: "Restore Me" });
      expect(await auditFor("tenant.district.restored", u)).toHaveLength(1);
      expect(await P.restoreDistrict(M.admin, orgM, actor, { orgUnitId: u })).toEqual({ kind: "wrong_state" });

      const old = await mkUnit(orgM, "Collide", "district", true);
      await mkUnit(orgM, "Collide");
      expect(await P.restoreDistrict(M.admin, orgM, actor, { orgUnitId: old })).toEqual({ kind: "name_taken" });
      expect(await auditFor("tenant.district.restored", old)).toHaveLength(0);
    });

    it("a failed audit insert fails the change: the district is not created, renamed, archived or restored", async () => {
      const u = await mkUnit(orgM, "Audit Fails");
      const archived = await mkUnit(orgM, "Audit Fails Archived", "district", true);
      auditControl.fail = true;
      try {
        await expect(P.defineDistrict(M.admin, orgM, actor, { name: "Never Created" })).rejects.toThrow(/audit insert failed/);
        await expect(P.renameDistrict(M.admin, orgM, actor, { orgUnitId: u, name: "Never Renamed" })).rejects.toThrow(/audit insert failed/);
        await expect(P.archiveDistrict(M.admin, orgM, actor, { orgUnitId: u })).rejects.toThrow(/audit insert failed/);
        await expect(P.restoreDistrict(M.admin, orgM, actor, { orgUnitId: archived })).rejects.toThrow(/audit insert failed/);
      } finally {
        auditControl.fail = false;
      }
      expect(await rowsOf(sql`select 1 from org_units where organization_id = ${orgM}::uuid and name = 'Never Created'`)).toHaveLength(0);
      const rows = await rowsOf<{ name: string; archived: boolean }>(
        sql`select name, archived_at is not null as archived from org_units where id in (${u}::uuid, ${archived}::uuid) order by name`,
      );
      expect(rows).toEqual([
        { name: "Audit Fails", archived: false },
        { name: "Audit Fails Archived", archived: true },
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // Moves
  // ---------------------------------------------------------------------

  describe("moveHousehold", () => {
    it("the seat holder assigns an unassigned household, the audit row carries viaSeat, and the result names both districts", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Move One");
      const result = await P.moveHousehold(M.seat, orgM, actor, {
        householdId,
        expectedOrgUnitId: null,
        targetOrgUnitId: dNorth,
      });
      expect(result).toEqual({
        kind: "ok",
        changed: true,
        fromOrgUnitId: null,
        toOrgUnitId: dNorth,
        fromName: null,
        toName: "North District",
      });
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
      const audits = await auditFor("tenant.household.district_changed", householdId);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.metadata).toEqual({
        organizationId: orgM,
        fromOrgUnitId: null,
        toOrgUnitId: dNorth,
        viaSeat: true,
      });
    });

    it("an administrator moves between districts with viaSeat false; no household or person name is ever in the audit metadata", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Secret Surname Household", { orgUnitId: dNorth });
      const result = await P.moveHousehold(M.admin, orgM, actor, {
        householdId,
        expectedOrgUnitId: dNorth,
        targetOrgUnitId: dSouth,
      });
      expect(result).toMatchObject({ kind: "ok", changed: true, fromName: "North District", toName: "South District" });
      const [audit] = await auditFor("tenant.household.district_changed", householdId);
      expect(audit!.metadata).toEqual({
        organizationId: orgM,
        fromOrgUnitId: dNorth,
        toOrgUnitId: dSouth,
        viaSeat: false,
      });
      expect(JSON.stringify(audit!.metadata)).not.toMatch(/Secret|Surname|Parishfix/);
    });

    it("authority is checked BEFORE the household's state: a plain member, a hidden-viewer and a definer get the same forbidden whether the household exists, is assigned, or is not real", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Probe Target", { orgUnitId: dNorth });
      const ids = [householdId, randomUUID(), "not-a-uuid"];
      for (const who of [M.plain, M.hiddenViewer, M.definer, M.deaconOnly, M.futureSeat, M.endedSeat, M.modOnly]) {
        for (const id of ids) {
          expect(
            await P.moveHousehold(who, orgM, actor, { householdId: id, expectedOrgUnitId: dNorth, targetOrgUnitId: dSouth }),
            `${who} ${id}`,
          ).toEqual({ kind: "forbidden" });
        }
      }
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
    });

    it("a platform admin who holds no seat and no tenant key is refused (the platform role confers nothing)", async () => {
      // A person with is_platform_admin but no seat/keys is exactly a `plain`
      // member as far as the resolver is concerned; asserted through the user flag.
      const platform = getPlatformDb();
      const [pa] = await platform
        .insert(users)
        .values({ email: `parishes-test-platformadmin-${stamp}@example.invalid`, name: "Platform Admin", isPlatformAdmin: true })
        .returning({ id: users.id });
      try {
        await platform.execute(sql`update people set user_id = ${pa!.id}::uuid where id = ${M.plain}::uuid`);
        const { householdId } = await mkHouseholdWithPerson(orgM, "Platform Probe");
        expect(
          await P.moveHousehold(M.plain, orgM, actor, { householdId, expectedOrgUnitId: null, targetOrgUnitId: dNorth }),
        ).toEqual({ kind: "forbidden" });
      } finally {
        await platform.execute(sql`update people set user_id = null where id = ${M.plain}::uuid`);
        await platform.delete(users).where(eq(users.id, pa!.id));
      }
    });

    it("a seat that has ended is refused with the same forbidden as any missing authority (read live on the next call)", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Ends Mid Session");
      const holder = await mkPerson("Midsession", "Holder");
      await mkMember(orgM, holder);
      const platform = getPlatformDb();
      const [term] = await platform
        .insert(officerTerms)
        .values({ organizationId: orgM, personId: holder, office: "deacons_moderator", startsOn: "2020-01-01" })
        .returning({ id: officerTerms.id });
      expect(
        (await P.moveHousehold(holder, orgM, actor, { householdId, expectedOrgUnitId: null, targetOrgUnitId: dNorth })).kind,
      ).toBe("ok");
      await platform.execute(
        sql`update officer_terms set ends_on = current_date, end_reason = 'completed' where id = ${term!.id}::uuid`,
      );
      expect(
        await P.moveHousehold(holder, orgM, actor, { householdId, expectedOrgUnitId: dNorth, targetOrgUnitId: dSouth }),
      ).toEqual({ kind: "forbidden" });
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
    });

    it("moving to the district it is already in is a quiet no-op: no write, no audit row; a stale expected value for a DIFFERENT target is a conflict", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Quiet", { orgUnitId: dNorth });
      const noop = await P.moveHousehold(M.seat, orgM, actor, {
        householdId,
        expectedOrgUnitId: dNorth,
        targetOrgUnitId: dNorth,
      });
      expect(noop).toMatchObject({ kind: "ok", changed: false });
      expect(await auditFor("tenant.household.district_changed", householdId)).toHaveLength(0);

      // The household is in North; the viewer thinks it is in South.
      const other = await mkUnit(orgM, "Third District");
      expect(
        await P.moveHousehold(M.seat, orgM, actor, { householdId, expectedOrgUnitId: dSouth, targetOrgUnitId: other }),
      ).toEqual({ kind: "conflict" });
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
      // "I think it has none" against an assigned household is a conflict too.
      expect(
        await P.moveHousehold(M.seat, orgM, actor, { householdId, expectedOrgUnitId: null, targetOrgUnitId: other }),
      ).toEqual({ kind: "conflict" });
      expect(await auditFor("tenant.household.district_changed", householdId)).toHaveLength(0);
    });

    it("a double submit (two concurrent identical calls) writes exactly ONE audit row", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Double Click");
      const input = { householdId, expectedOrgUnitId: null, targetOrgUnitId: dNorth };
      const [a, b] = await Promise.all([
        P.moveHousehold(M.seat, orgM, actor, input),
        P.moveHousehold(M.seat, orgM, actor, input),
      ]);
      expect([a.kind, b.kind]).toEqual(["ok", "ok"]);
      expect([a, b].filter((r) => r.kind === "ok" && r.changed)).toHaveLength(1);
      expect(await auditFor("tenant.household.district_changed", householdId)).toHaveLength(1);
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
    });

    it("clearing is a write, not a delete: target null returns the household to unassigned, audited, and Undo of an assignment is the same call swapped", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Clear Me", { orgUnitId: dNorth });
      const cleared = await P.moveHousehold(M.admin, orgM, actor, { householdId, expectedOrgUnitId: dNorth, targetOrgUnitId: null });
      expect(cleared).toMatchObject({ kind: "ok", changed: true, toOrgUnitId: null, toName: null, fromName: "North District" });
      expect(await unitIdOfHousehold(householdId)).toBeNull();
      // Undo of the clear: expected = null (what it is now), target = previous.
      const undone = await P.moveHousehold(M.admin, orgM, actor, { householdId, expectedOrgUnitId: null, targetOrgUnitId: dNorth, undo: true });
      expect(undone).toMatchObject({ kind: "ok", changed: true });
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
      const audits = await auditFor("tenant.household.district_changed", householdId);
      expect(audits.map((a) => a.metadata.undo ?? false)).toEqual([false, true]);
    });

    it("Undo when the previous district has since been archived is refused by the target rule (target_unavailable archived), and the household stays where it is", async () => {
      const prev = await mkUnit(orgM, "Soon Archived");
      const { householdId } = await mkHouseholdWithPerson(orgM, "Undo Blocked", { orgUnitId: prev });
      await P.moveHousehold(M.seat, orgM, actor, { householdId, expectedOrgUnitId: prev, targetOrgUnitId: dNorth });
      await archiveUnit(prev);
      expect(
        await P.moveHousehold(M.seat, orgM, actor, { householdId, expectedOrgUnitId: dNorth, targetOrgUnitId: prev, undo: true }),
      ).toMatchObject({ kind: "target_unavailable", reason: "archived" });
      expect(await unitIdOfHousehold(householdId)).toBe(dNorth);
    });

    it("an archived target, a campus target, another organization's district and a nonexistent one are refused - archived and campus by name, the other two as the same not_found", async () => {
      const archived = await mkUnit(orgM, "Closed", "district", true);
      const { householdId } = await mkHouseholdWithPerson(orgM, "Targets");
      const base = { householdId, expectedOrgUnitId: null };
      expect(await P.moveHousehold(M.seat, orgM, actor, { ...base, targetOrgUnitId: archived })).toMatchObject({ kind: "target_unavailable", reason: "archived" });
      expect(await P.moveHousehold(M.seat, orgM, actor, { ...base, targetOrgUnitId: dCampus })).toMatchObject({ kind: "target_unavailable", reason: "campus" });
      expect(await P.moveHousehold(M.seat, orgM, actor, { ...base, targetOrgUnitId: dForeign })).toEqual({ kind: "not_found" });
      expect(await P.moveHousehold(M.seat, orgM, actor, { ...base, targetOrgUnitId: randomUUID() })).toEqual({ kind: "not_found" });
      expect(await P.moveHousehold(M.seat, orgM, actor, { ...base, targetOrgUnitId: "nope" })).toEqual({ kind: "not_found" });
      expect(await unitIdOfHousehold(householdId)).toBeNull();
    });

    it("another organization's household and a nonexistent household are the same not_found, and nothing in orgB changes", async () => {
      const foreign = await mkHouseholdWithPerson(orgB, "Foreign Household");
      const r1 = await P.moveHousehold(M.seat, orgM, actor, { householdId: foreign.householdId, expectedOrgUnitId: null, targetOrgUnitId: dNorth });
      const r2 = await P.moveHousehold(M.seat, orgM, actor, { householdId: randomUUID(), expectedOrgUnitId: null, targetOrgUnitId: dNorth });
      expect(r1).toEqual({ kind: "not_found" });
      expect(r2).toEqual({ kind: "not_found" });
      expect(await unitIdOfHousehold(foreign.householdId)).toBeNull();
    });

    it("a failed audit insert rolls the move back: org_unit_id is unchanged", async () => {
      const { householdId } = await mkHouseholdWithPerson(orgM, "Audit Fail Move");
      auditControl.fail = true;
      try {
        await expect(
          P.moveHousehold(M.seat, orgM, actor, { householdId, expectedOrgUnitId: null, targetOrgUnitId: dNorth }),
        ).rejects.toThrow(/audit insert failed/);
      } finally {
        auditControl.fail = false;
      }
      expect(await unitIdOfHousehold(householdId)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Bulk move
  // ---------------------------------------------------------------------

  describe("bulkMoveHouseholds", () => {
    async function archivedWith(name: string, count: number): Promise<{ unit: string; ids: string[] }> {
      const unit = await mkUnit(orgM, name);
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        ids.push((await mkHouseholdWithPerson(orgM, `${name} H${i}`, { orgUnitId: unit })).householdId);
      }
      await archiveUnit(unit);
      return { unit, ids };
    }

    it("empties an archived district into an active one: counts only, one audit row per household plus one batch row sharing a batchId", async () => {
      const { unit, ids } = await archivedWith("Bulk Source A", 3);
      const result = await P.bulkMoveHouseholds(M.seat, orgM, actor, {
        sourceOrgUnitId: unit,
        targetOrgUnitId: dNorth,
        expectedCount: 3,
      });
      expect(result).toEqual({ kind: "ok", moved: 3, skipped: 0, toName: "North District" });
      // The response carries counts and a name only - never an id.
      expect(Object.keys(result).sort()).toEqual(["kind", "moved", "skipped", "toName"]);
      for (const id of ids) expect(await unitIdOfHousehold(id)).toBe(dNorth);

      const batch = await auditFor("tenant.household.district_bulk_moved", unit);
      expect(batch).toHaveLength(1);
      const batchId = batch[0]!.metadata.batchId as string;
      expect(batch[0]!.metadata).toEqual({
        organizationId: orgM,
        batchId,
        toOrgUnitId: dNorth,
        movedCount: 3,
        skippedCount: 0,
      });
      for (const id of ids) {
        const rows = await auditFor("tenant.household.district_changed", id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.metadata).toEqual({
          organizationId: orgM,
          fromOrgUnitId: unit,
          toOrgUnitId: dNorth,
          viaSeat: true,
          batchId,
        });
      }
    });

    it("reports `skipped` when the district shrank since the dialog (moved < expectedCount), and a zero-row bulk writes no audit at all", async () => {
      const { unit, ids } = await archivedWith("Bulk Source B", 3);
      await P.moveHousehold(M.admin, orgM, actor, { householdId: ids[0]!, expectedOrgUnitId: unit, targetOrgUnitId: dSouth });
      const result = await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: 3 });
      expect(result).toEqual({ kind: "ok", moved: 2, skipped: 1, toName: "North District" });

      const before = await auditCountForOrg(orgM);
      const empty = await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: 2 });
      expect(empty).toEqual({ kind: "ok", moved: 0, skipped: 2, toName: "North District" });
      expect(await auditCountForOrg(orgM)).toBe(before);
    });

    it("more than expectedCount (a restore and re-archive in between) is count_changed and moves nothing", async () => {
      const { unit, ids } = await archivedWith("Bulk Source C", 3);
      const result = await P.bulkMoveHouseholds(M.seat, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: 2 });
      expect(result).toEqual({ kind: "count_changed" });
      for (const id of ids) expect(await unitIdOfHousehold(id)).toBe(unit);
    });

    it("refuses an ACTIVE source (no tier is exempt, administrators included), the same unit, an archived or campus target, a foreign or malformed id", async () => {
      const { unit } = await archivedWith("Bulk Source D", 1);
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: dNorth, targetOrgUnitId: dSouth, expectedCount: 1 })).toEqual({ kind: "source_not_archived" });
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: unit, expectedCount: 1 })).toEqual({ kind: "same_unit" });
      const closed = await mkUnit(orgM, "Closed Target", "district", true);
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: closed, expectedCount: 1 })).toMatchObject({ kind: "target_unavailable", reason: "archived" });
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dCampus, expectedCount: 1 })).toMatchObject({ kind: "target_unavailable", reason: "campus" });
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dForeign, expectedCount: 1 })).toEqual({ kind: "not_found" });
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: "nope", expectedCount: 1 })).toEqual({ kind: "not_found" });
    });

    it("refuses a plain member, a hidden-viewer and a definer-only before reading anything", async () => {
      const { unit, ids } = await archivedWith("Bulk Source E", 1);
      for (const who of [M.plain, M.hiddenViewer, M.definer]) {
        expect(await P.bulkMoveHouseholds(who, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: 1 }), who).toEqual({ kind: "forbidden" });
      }
      expect(await unitIdOfHousehold(ids[0]!)).toBe(unit);
    });

    it("over 100 is too_many with no write and no truncation (101 households); exactly 100 moves", async () => {
      const platform = getPlatformDb();
      const big = await mkUnit(orgM, "Bulk Big");
      await platform.execute(sql`
        insert into households (organization_id, name, org_unit_id)
        select ${orgM}::uuid, 'Bulk Big ' || g, ${big}::uuid from generate_series(1, 101) g
      `);
      await archiveUnit(big);
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: big, targetOrgUnitId: dNorth, expectedCount: 101 })).toEqual({ kind: "too_many" });
      // The viewer saw 100 but there are 101 now: still too_many, never a partial move.
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: big, targetOrgUnitId: dNorth, expectedCount: 100 })).toEqual({ kind: "too_many" });
      expect((await rowsOf<{ n: number }>(sql`select count(*)::int as n from households where org_unit_id = ${big}::uuid`))[0]!.n).toBe(101);

      await platform.execute(sql`delete from households where id in (
        select id from households where org_unit_id = ${big}::uuid order by id limit 1)`);
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: big, targetOrgUnitId: dNorth, expectedCount: 100 })).toEqual({
        kind: "ok",
        moved: 100,
        skipped: 0,
        toName: "North District",
      });
    });

    it("an out-of-range expectedCount is refused (0, negative, fractional) or too_many (>100)", async () => {
      const { unit } = await archivedWith("Bulk Source F", 1);
      for (const bad of [0, -3, 1.5, Number.NaN]) {
        expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: bad }), String(bad)).toEqual({ kind: "count_changed" });
      }
      expect(await P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: 10_000 })).toEqual({ kind: "too_many" });
    });

    it("a failed audit insert rolls the whole bulk move back", async () => {
      const { unit, ids } = await archivedWith("Bulk Source G", 2);
      auditControl.fail = true;
      try {
        await expect(
          P.bulkMoveHouseholds(M.admin, orgM, actor, { sourceOrgUnitId: unit, targetOrgUnitId: dNorth, expectedCount: 2 }),
        ).rejects.toThrow(/audit insert failed/);
      } finally {
        auditControl.fail = false;
      }
      for (const id of ids) expect(await unitIdOfHousehold(id)).toBe(unit);
    });
  });

  // ---------------------------------------------------------------------
  // Reads: overview, district page, Unassigned
  // ---------------------------------------------------------------------

  describe("reads", () => {
    let uNorth: string;
    let uArchived: string;
    let hhMember: string;
    let hhMemberAndVisitor: string;
    let hhParticipant: string;
    let hhVisitor: string;
    let hhListed: string;
    let hhStaff: string;
    let hhHiddenOnly: string;
    let hiddenPersonId: string;
    let hhDeceased: string;
    let hhMerged: string;
    let hhEnded: string;
    let hhEmpty: string;
    let hhNorthHiddenOnly: string;

    beforeAll(async () => {
      const platform = getPlatformDb();
      uNorth = await mkUnit(orgU, "U North");
      uArchived = await mkUnit(orgU, "U East");

      // Assigned households (district page and the single count).
      await mkHouseholdWithPerson(orgU, "Assigned Visible", { orgUnitId: uNorth, first: "Visi" });
      const hidNorth = await mkHouseholdWithPerson(orgU, "Assigned Hidden Only", { orgUnitId: uNorth, first: "Hida" });
      hhNorthHiddenOnly = hidNorth.householdId;
      await platform.insert(personPrivacy).values({ personId: hidNorth.personId, organizationId: orgU, directoryHidden: true });
      await mkHousehold(orgU, "Assigned No People", uNorth);
      await mkHouseholdWithPerson(orgU, "East One", { orgUnitId: uArchived });
      await mkHouseholdWithPerson(orgU, "East Two", { orgUnitId: uArchived });
      await archiveUnit(uArchived);
      // An open deacon for U North.
      const dn = await mkPerson("Dorothea", "Deaconess");
      await mkMember(orgU, dn);
      await platform.insert(officerTerms).values({ organizationId: orgU, personId: dn, office: "deacon", orgUnitId: uNorth, startsOn: "2020-01-01" });

      // Unassigned households, one per bucket rule.
      hhMember = (await mkHouseholdWithPerson(orgU, "Unas Member", { roll: "active", first: "Mem" })).householdId;
      const mv = await mkHousehold(orgU, "Unas Member And Visitor");
      hhMemberAndVisitor = mv;
      const mvA = await mkPerson("Both", "Visitorpart");
      const mvB = await mkPerson("Both", "Memberpart");
      await mkMember(orgU, mvA, { householdId: mv, roll: null, engagement: "visitor" });
      await mkMember(orgU, mvB, { householdId: mv, roll: "baptized" });
      hhParticipant = (await mkHouseholdWithPerson(orgU, "Unas Participant", { roll: "other_participant", first: "Par" })).householdId;
      hhVisitor = (await mkHouseholdWithPerson(orgU, "Unas Visitor", { roll: null, engagement: "visitor", first: "Vis" })).householdId;
      hhListed = (await mkHouseholdWithPerson(orgU, "Unas Listed", { roll: null, engagement: "regular", first: "Lis" })).householdId;
      hhStaff = (await mkHouseholdWithPerson(orgU, "Unas Staff", { roll: null, engagement: "staff", first: "Sta" })).householdId;
      const hidden = await mkHouseholdWithPerson(orgU, "Unas Hidden Person", { roll: "active", first: "Secretive" });
      hhHiddenOnly = hidden.householdId;
      hiddenPersonId = hidden.personId;
      await platform.insert(personPrivacy).values({ personId: hidden.personId, organizationId: orgU, directoryHidden: true });
      const dead = await mkHouseholdWithPerson(orgU, "Unas Deceased", { roll: "active", first: "Gone" });
      hhDeceased = dead.householdId;
      await platform.execute(sql`update people set date_of_death = '2020-02-02' where id = ${dead.personId}::uuid`);
      const merged = await mkHouseholdWithPerson(orgU, "Unas Merged", { roll: "active", first: "Dup" });
      hhMerged = merged.householdId;
      const survivor = await mkPerson("Survivor", "Merged");
      await platform.execute(sql`update people set merged_into_id = ${survivor}::uuid where id = ${merged.personId}::uuid`);
      const ended = await mkHousehold(orgU, "Unas Ended");
      hhEnded = ended;
      const endedPerson = await mkPerson("Left", "Ended");
      await mkMember(orgU, endedPerson, { householdId: ended, roll: "active", endedOn: "2022-02-02" });
      hhEmpty = await mkHousehold(orgU, "Unas Empty");
    });

    it("the Unassigned page buckets each household once - member over participant over visitor over other - and drops the deceased, the merged, the ended-membership and the person-less", async () => {
      const result = await P.getUnassignedPage(U.admin, orgU);
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      const byId = new Map(result.households.map((h) => [h.householdId, h.group]));
      expect(byId.get(hhMember)).toBe("members");
      expect(byId.get(hhMemberAndVisitor)).toBe("members");
      expect(byId.get(hhParticipant)).toBe("participants");
      expect(byId.get(hhVisitor)).toBe("visitors");
      expect(byId.get(hhListed)).toBe("others");
      expect(byId.get(hhStaff)).toBe("others");
      expect(byId.get(hhHiddenOnly)).toBe("members");
      for (const absent of [hhDeceased, hhMerged, hhEnded, hhEmpty, hhNorthHiddenOnly]) {
        expect(byId.has(absent), absent).toBe(false);
      }
      // 4 exclusive buckets: members(3: member, mixed, hidden), participants 1, visitors 1, others 2.
      expect(result.counts).toEqual({ members: 3, participants: 1, visitors: 1, others: 2 });
      expect(result.totalShown).toBe(7);
    });

    it("`hide` filters the page but never the counts; every group hidden shows no households but keeps every count", async () => {
      const result = await P.getUnassignedPage(U.admin, orgU, { hide: new Set(["members", "visitors"] as const) });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.counts).toEqual({ members: 3, participants: 1, visitors: 1, others: 2 });
      expect(new Set(result.households.map((h) => h.group))).toEqual(new Set(["participants", "others"]));
      expect(result.totalShown).toBe(3);
      const none = await P.getUnassignedPage(U.admin, orgU, { hide: new Set(["members", "participants", "visitors", "others"] as const) });
      if (none.kind !== "ok") throw new Error("expected ok");
      expect(none.households).toEqual([]);
      expect(none.counts.members).toBe(3);
    });

    it("masks a directory-hidden person as `Private` for a seat holder (no people.manage, no view_hidden), keeps the connection badge, and names them for people.manage and for view_hidden - server-side", async () => {
      const seat = await P.getUnassignedPage(U.seat, orgU);
      if (seat.kind !== "ok") throw new Error("expected ok");
      const asSeat = seat.households.find((h) => h.householdId === hhHiddenOnly)!;
      expect(asSeat.people).toEqual([{ name: "Private", masked: true, connection: "member" }]);
      expect(JSON.stringify(seat)).not.toContain("Secretive");

      for (const who of [U.admin, U.hiddenViewer]) {
        const r = await P.getUnassignedPage(who, orgU);
        if (r.kind !== "ok") throw new Error("expected ok");
        const row = r.households.find((h) => h.householdId === hhHiddenOnly)!;
        expect(row.people[0]).toMatchObject({ masked: false, connection: "member" });
        expect(row.people[0]!.name).toContain("Secretive");
      }
      expect(hiddenPersonId).toBeTruthy();
    });

    it("no row carries a person id, an email, a phone, a birthday, a photo or an address", async () => {
      const result = await P.getUnassignedPage(U.admin, orgU);
      if (result.kind !== "ok") throw new Error("expected ok");
      const keys = new Set<string>();
      const walk = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          for (const [k, v] of Object.entries(value)) {
            keys.add(k);
            walk(v);
          }
        }
      };
      walk(result.households);
      expect([...keys].sort()).toEqual(["connection", "group", "householdId", "masked", "name", "people"]);
    });

    it("the Unassigned page refuses a plain member and a definer-only (forbidden) and a seat holder is allowed", async () => {
      expect(await P.getUnassignedPage(U.plain, orgU)).toEqual({ kind: "forbidden" });
      expect(await P.getUnassignedPage(U.definer, orgU)).toEqual({ kind: "forbidden" });
      expect((await P.getUnassignedPage(U.seat, orgU)).kind).toBe("ok");
    });

    it("activeTargets lists active districts only for someone who can move (empty for a view-hidden viewer)", async () => {
      const mover = await P.getUnassignedPage(U.seat, orgU);
      if (mover.kind !== "ok") throw new Error("expected ok");
      const names = mover.activeTargets.map((t) => t.name);
      expect(names).toContain("U North");
      expect(names).not.toContain("U East");
      const viewer = await P.getUnassignedPage(U.hiddenViewer, orgU);
      if (viewer.kind !== "ok") throw new Error("expected ok");
      expect(viewer.activeTargets).toEqual([]);
    });

    it("the district page counts EVERY household (the single count) and lists them, with an archived flag, the open deacon and masked people", async () => {
      const result = await P.getDistrictPage(U.seat, orgU, uNorth);
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      expect(result.total).toBe(3);
      expect(result.district).toMatchObject({ name: "U North", archived: false, deaconName: "Dorothea Deaconess", householdCount: 3 });
      expect(result.households.map((h) => h.name)).toEqual(["Assigned Hidden Only", "Assigned No People", "Assigned Visible"]);
      const hidden = result.households.find((h) => h.householdId === hhNorthHiddenOnly)!;
      expect(hidden.people).toEqual([{ name: "Private", masked: true, connection: "member" }]);
      expect(result.households.find((h) => h.name === "Assigned No People")!.people).toEqual([]);
      expect(result.activeTargets.map((t) => t.name)).not.toContain("U North");

      const archived = await P.getDistrictPage(U.admin, orgU, uArchived);
      if (archived.kind !== "ok") throw new Error("expected ok");
      expect(archived.district.archived).toBe(true);
      expect(archived.total).toBe(2);
    });

    it("the district page: not_found for a malformed id, a nonexistent id, another organization's district and a campus alike; forbidden for a plain member and for a definer-only", async () => {
      const campus = await mkUnit(orgU, "U Campus", "campus");
      for (const id of ["nope", randomUUID(), dForeign, campus]) {
        expect(await P.getDistrictPage(U.admin, orgU, id), id).toEqual({ kind: "not_found" });
      }
      expect(await P.getDistrictPage(U.plain, orgU, uNorth)).toEqual({ kind: "forbidden" });
      expect(await P.getDistrictPage(U.definer, orgU, uNorth)).toEqual({ kind: "forbidden" });
    });

    it("the overview lists active and archived districts apart, every unit with one household count, the unassigned count, and whether the seat is filled (definers only)", async () => {
      const result = await P.getParishesOverview(U.admin, orgU);
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      expect(result.managed).toBe(true);
      const north = result.districts.find((d) => d.name === "U North")!;
      expect(north).toMatchObject({ householdCount: 3, deaconName: "Dorothea Deaconess", archived: false });
      expect(result.archived.map((d) => d.name)).toEqual(["U East"]);
      expect(result.archived[0]).toMatchObject({ householdCount: 2, archived: true });
      expect(result.unassignedCount).toBe(7);
      expect(result.seatFilled).toBe(true);

      const asSeat = await P.getParishesOverview(U.seat, orgU);
      if (asSeat.kind !== "ok") throw new Error("expected ok");
      expect(asSeat.seatFilled).toBeNull();
      expect(asSeat.unassignedCount).toBe(7);

      const asDefiner = await P.getParishesOverview(U.definer, orgU);
      if (asDefiner.kind !== "ok") throw new Error("expected ok");
      // A definer-only reads the roster (counts) but is told nothing about households.
      expect(asDefiner.unassignedCount).toBeNull();

      expect(await P.getParishesOverview(U.plain, orgU)).toEqual({ kind: "forbidden" });
    });

    it("the overview's household count equals the number of rows the district page lists and a bulk move would write (one definition, DECISION-244)", async () => {
      const overview = await P.getParishesOverview(U.admin, orgU);
      const page = await P.getDistrictPage(U.admin, orgU, uArchived);
      if (overview.kind !== "ok" || page.kind !== "ok") throw new Error("expected ok");
      expect(overview.archived[0]!.householdCount).toBe(page.total);
      expect(page.households).toHaveLength(page.total);
    });

    it("seatFilled is false when no seat term is open, and false when its holder's membership has ended", async () => {
      const result = await P.getParishesOverview(M.admin, orgM);
      if (result.kind !== "ok") throw new Error("expected ok");
      // orgM's actors include an open seat held by a current member.
      expect(result.seatFilled).toBe(true);

      const org = await createOrganization({
        name: `Fixture Congregation Seatless for parishes.test.ts`,
        slug: `parishes-test-seatless-${stamp}`,
        organizationType: "congregation",
        platformStatus: "managed",
      });
      if (org.kind !== "ok") throw new Error("expected ok");
      orgIds.push(org.organizationId);
      await setToggle(org.organizationId, true);
      const admin = await mkPerson("seatless", "Admin");
      await mkMember(org.organizationId, admin);
      await customRole(org.organizationId, "fx_definer", ["officers.manage"], admin);
      const before = await P.getParishesOverview(admin, org.organizationId);
      if (before.kind !== "ok") throw new Error("expected ok");
      expect(before.seatFilled).toBe(false);

      const holder = await mkPerson("lapsing", "Holder");
      await mkMember(org.organizationId, holder);
      const platform = getPlatformDb();
      await platform.insert(officerTerms).values({ organizationId: org.organizationId, personId: holder, office: "deacons_moderator", startsOn: "2020-01-01" });
      const filled = await P.getParishesOverview(admin, org.organizationId);
      if (filled.kind !== "ok") throw new Error("expected ok");
      expect(filled.seatFilled).toBe(true);

      await platform.execute(sql`alter table memberships disable trigger memberships_guard_end`);
      try {
        await platform.execute(
          sql`update memberships set ended_on = '2022-02-02' where person_id = ${holder}::uuid and organization_id = ${org.organizationId}::uuid`,
        );
      } finally {
        await platform.execute(sql`alter table memberships enable trigger memberships_guard_end`);
      }
      const lapsed = await P.getParishesOverview(admin, org.organizationId);
      if (lapsed.kind !== "ok") throw new Error("expected ok");
      expect(lapsed.seatFilled).toBe(false);
      // And the lapsed holder is refused outright (no active membership), not given a result.
      await expect(P.getParishesOverview(holder, org.organizationId)).rejects.toBeInstanceOf(OrgAccessError);
      await expect(
        P.moveHousehold(holder, org.organizationId, actor, { householdId: randomUUID(), expectedOrgUnitId: null, targetOrgUnitId: null }),
      ).rejects.toBeInstanceOf(OrgAccessError);
    });

    it("a genuine database failure is thrown, never read as `no districts`: an unknown organization throws OrgAccessError", async () => {
      await expect(P.getParishesOverview(randomUUID(), orgU)).rejects.toBeInstanceOf(OrgAccessError);
      await expect(P.getUnassignedPage(randomUUID(), orgU)).rejects.toBeInstanceOf(OrgAccessError);
    });
  });

  // ---------------------------------------------------------------------
  // Scale: ~600 unassigned households, paged (no timing assertion)
  // ---------------------------------------------------------------------

  describe("a 600-household congregation", () => {
    it("pages the Unassigned list at 25 per page and clamps an out-of-range page (shape only; unverified under production load)", async () => {
      const made = await mkOrg("L");
      orgL = made.orgId;
      const platform = getPlatformDb();
      const hhRows = await platform
        .insert(households)
        .values(Array.from({ length: 600 }, (_, i) => ({ organizationId: orgL, name: `Large ${String(i).padStart(4, "0")}`, isGivingUnit: true })))
        .returning({ id: households.id });
      const peopleRows = await platform
        .insert(people)
        .values(Array.from({ length: 600 }, (_, i) => ({ firstName: `L${i}`, lastName: "Largefix", deletableUntil: fixtureDeletableUntil() })))
        .returning({ id: people.id });
      peopleIds.push(...peopleRows.map((p) => p.id));
      await platform.insert(memberships).values(
        peopleRows.map((p, i) => ({
          organizationId: orgL,
          personId: p.id,
          householdId: hhRows[i]!.id,
          engagementStatus: "regular",
          currentRoll: i % 2 === 0 ? "active" : null,
        })),
      );

      const first = await P.getUnassignedPage(made.actors.admin, orgL);
      if (first.kind !== "ok") throw new Error("expected ok");
      expect(first.totalShown).toBe(600);
      expect(first.households).toHaveLength(25);
      expect(first.counts.members + first.counts.others).toBe(600);
      const last = await P.getUnassignedPage(made.actors.admin, orgL, { page: 24 });
      if (last.kind !== "ok") throw new Error("expected ok");
      expect(last.households).toHaveLength(25);
      expect(last.page).toBe(24);
      const clamped = await P.getUnassignedPage(made.actors.admin, orgL, { page: 9999 });
      if (clamped.kind !== "ok") throw new Error("expected ok");
      expect(clamped.page).toBe(24);
      const page1 = await P.getUnassignedPage(made.actors.admin, orgL, { page: -4 });
      if (page1.kind !== "ok") throw new Error("expected ok");
      expect(page1.page).toBe(1);
    });
  });
});
