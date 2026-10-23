/**
 * Integration tests for src/lib/community.ts - run against a REAL Postgres
 * connection, not mocked (same harness as `people.test.ts`/`roll.test.ts`:
 * the `hasDb` skip-guard, dynamic imports in `beforeAll`, a self-contained
 * fixture created and torn down per file). Run for real, serially, with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/community.db.test.ts
 *
 * docs/work-log/2026-10-22-founding-admin-directory.md, Phase 3 Test Plan 1.8
 * and 1.11; DECISION-197 (the lists work for a people.manage holder WITHOUT
 * directory.view), DECISION-200 (visitors, staff, former participants).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("community.ts (Postgres-backed, real dev database)", () => {
  let listVisitors: typeof import("./community").listVisitors;
  let listStaff: typeof import("./community").listStaff;
  let listFormerParticipants: typeof import("./community").listFormerParticipants;
  let getCommunityBadges: typeof import("./community").getCommunityBadges;
  let getCommunityStatus: typeof import("./community").getCommunityStatus;
  let getDirectory: typeof import("./directory").getDirectory;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
  let rollActions: typeof import("@/lib/db/domain/roll").rollActions;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;

  const stamp = Date.now();
  const surname = `Comm${stamp}`;

  let orgA: string;
  let orgB: string;
  let managerOnly: string; // people.manage ONLY: no directory.view (DECISION-197)
  let directoryOnly: string; // directory.view ONLY: no people.manage
  let viewerBoth: string; // people.manage AND directory.view: sees every view
  let proposerUserId: string;

  // fixture people
  let visitorA: string; // visitor with an email and a first-visit date
  let visitorB: string; // visitor, nothing else
  let visitorEnrolled: string; // engagement visitor, but on the participant roll
  let visitorEnded: string; // ended visitor
  let visitorMerged: string; // merged into visitorA
  let visitorPending: string; // visitor with a pending proposal
  let memberActive: string;
  let participant: string;
  let staffRegular: string; // engagement regular, one open position
  let staffAnchorWithPosition: string; // engagement staff, an open + an ended position
  let staffAnchorNoPosition: string; // engagement staff, none
  let staffFutureEnd: string; // position that ends in the future
  let staffEndedOnly: string; // only an ended position
  let staffAnchorEnded: string; // engagement staff, membership ended
  let staffAnchorMerged: string; // engagement staff, merged into staffAnchorNoPosition
  let formerA: string; // ended by a participant removal
  let formerB: string;
  let endedOther: string; // ended for another reason
  let elsewhereVisitor: string; // a visitor at orgB

  const people_: string[] = [];

  beforeAll(async () => {
    ({
      listVisitors,
      listStaff,
      listFormerParticipants,
      getCommunityBadges,
      getCommunityStatus,
    } = await import("./community"));
    ({ getDirectory } = await import("./directory"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships, contactMethods } = await import("@/lib/db/domain/people"));
    ({ rollActions } = await import("@/lib/db/domain/roll"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import("@/lib/db/domain/authz"));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for community.db.test.ts`,
          slug: `community-test-${label.toLowerCase()}-${stamp}`,
          path: `community_test_${label.toLowerCase()}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    }
    orgA = await makeOrg("A");
    orgB = await makeOrg("B");

    const [gt] = await platform
      .insert(groupTypes)
      .values({ key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    let groupTypeId = gt?.id;
    if (!groupTypeId) {
      const [existing] = await platform.select({ id: groupTypes.id }).from(groupTypes).where(eq(groupTypes.key, "roster")).limit(1);
      groupTypeId = existing!.id;
    }
    for (const organizationId of [orgA, orgB]) {
      await platform.insert(groups).values({
        organizationId,
        groupTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });
    }

    await platform
      .insert(permissions)
      .values([
        { key: "people.manage", module: "people", description: "Create and edit people", sensitivityTier: 1 },
        { key: "directory.view", module: "directory", description: "Browse the directory", sensitivityTier: 1 },
      ])
      .onConflictDoNothing();
    const [manageRole] = await platform
      .insert(appRoles)
      .values({ organizationId: orgA, key: "community_manager", name: "Community Manager", roleKind: "custom" })
      .returning({ id: appRoles.id });
    await platform.insert(appRolePermissions).values({ roleId: manageRole!.id, permissionKey: "people.manage" });
    const [dirRole] = await platform
      .insert(appRoles)
      .values({ organizationId: orgA, key: "community_dir_viewer", name: "Community Directory Viewer", roleKind: "custom" })
      .returning({ id: appRoles.id });
    await platform.insert(appRolePermissions).values({ roleId: dirRole!.id, permissionKey: "directory.view" });

    async function person(first: string, dob: string | null = null) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: surname, dateOfBirth: dob, deletableUntil: fixtureDeletableUntil() })
        .returning({ id: people.id });
      people_.push(p!.id);
      return p!.id;
    }
    async function member(
      personId: string,
      org: string,
      engagementStatus: string,
      extra: Partial<typeof memberships.$inferInsert> = {},
    ) {
      await platform.insert(memberships).values({ organizationId: org, personId, engagementStatus, ...extra });
    }
    async function position(personId: string, title: string, startsOn: string, endsOn: string | null) {
      await platform.execute(sql`
        insert into staff_positions (organization_id, person_id, position, position_key, starts_on, ends_on)
        values (${orgA}::uuid, ${personId}::uuid, ${title}, ${title.toLowerCase()}, ${startsOn}::date, ${endsOn}::date)
      `);
    }

    managerOnly = await person("Mgr");
    directoryOnly = await person("Dir");
    await member(managerOnly, orgA, "regular");
    await member(directoryOnly, orgA, "regular");
    viewerBoth = await person("Both");
    await member(viewerBoth, orgA, "regular");
    await platform.insert(roleGrants).values([
      { organizationId: orgA, roleId: manageRole!.id, personId: viewerBoth, startsOn: "2020-01-01" },
      { organizationId: orgA, roleId: dirRole!.id, personId: viewerBoth, startsOn: "2020-01-01" },
      { organizationId: orgA, roleId: manageRole!.id, personId: managerOnly, startsOn: "2020-01-01" },
      { organizationId: orgA, roleId: dirRole!.id, personId: directoryOnly, startsOn: "2020-01-01" },
    ]);
    const [u] = await platform
      .insert(users)
      .values({ email: `community-test-${stamp}@example.invalid`, name: "Fixture Proposer" })
      .returning({ id: users.id });
    proposerUserId = u!.id;

    visitorA = await person("Alba");
    visitorB = await person("Bryn");
    visitorEnrolled = await person("Cade");
    visitorEnded = await person("Dara");
    visitorMerged = await person("Elio");
    visitorPending = await person("Fern");
    memberActive = await person("Gwen");
    participant = await person("Hale");
    staffRegular = await person("Ines");
    staffAnchorWithPosition = await person("Jory");
    staffAnchorNoPosition = await person("Kit");
    staffFutureEnd = await person("Lark");
    staffEndedOnly = await person("Moss");
    staffAnchorEnded = await person("Nan");
    staffAnchorMerged = await person("Opal");
    formerA = await person("Nell");
    formerB = await person("Orla");
    endedOther = await person("Pia");
    elsewhereVisitor = await person("Quin");

    await member(visitorA, orgA, "visitor", { firstVisitDate: "2026-09-13" });
    await member(visitorB, orgA, "visitor");
    await member(visitorEnrolled, orgA, "visitor", { currentRoll: "other_participant", currentRollSince: "2026-01-01" });
    await member(visitorEnded, orgA, "visitor", { endedOn: "2026-02-01", endedReason: "moved away" });
    await member(visitorMerged, orgA, "visitor");
    await platform.update(people).set({ mergedIntoId: visitorA }).where(eq(people.id, visitorMerged));
    await member(visitorPending, orgA, "visitor");
    await member(memberActive, orgA, "regular", { currentRoll: "active", currentRollSince: "2020-01-01" });
    await member(participant, orgA, "regular", { currentRoll: "other_participant", currentRollSince: "2024-01-01" });
    await member(staffRegular, orgA, "regular");
    await member(staffAnchorWithPosition, orgA, "staff");
    await member(staffAnchorNoPosition, orgA, "staff");
    await member(staffFutureEnd, orgA, "regular");
    await member(staffEndedOnly, orgA, "regular");
    await member(staffAnchorEnded, orgA, "staff", { endedOn: "2026-02-01", endedReason: "left" });
    await member(staffAnchorMerged, orgA, "staff");
    await platform.update(people).set({ mergedIntoId: staffAnchorNoPosition }).where(eq(people.id, staffAnchorMerged));
    await member(formerA, orgA, "regular", { endedOn: "2026-04-01", endedReason: "other_participant_removed" });
    await member(formerB, orgA, "visitor", { endedOn: "2026-05-01", endedReason: "other_participant_removed" });
    await member(endedOther, orgA, "regular", { endedOn: "2026-03-01", endedReason: "moved away" });
    await member(elsewhereVisitor, orgB, "visitor");

    await platform.insert(contactMethods).values({ personId: visitorA, kind: "email", value: `alba-${stamp}@example.invalid`, isPrimary: true });

    await position(staffRegular, "Organist", "2025-01-01", null);
    await position(staffAnchorWithPosition, "Sexton", "2024-01-01", null);
    await position(staffAnchorWithPosition, "Bookkeeper", "2020-01-01", "2021-01-01");
    await position(staffFutureEnd, "Choir Director", "2025-01-01", "2999-01-01");
    await position(staffEndedOnly, "Nursery Aide", "2020-01-01", "2021-06-01");

    await platform.insert(rollActions).values({
      organizationId: orgA,
      personId: visitorPending,
      kind: "profession_of_faith",
      effectiveDate: "2026-06-01",
      resultingRoll: "active",
      approvalStatus: "pending",
      proposedBy: proposerUserId,
    });
    await platform.insert(rollActions).values({
      organizationId: orgA,
      personId: participant,
      kind: "other_participant_enrolled",
      effectiveDate: "2024-01-01",
      resultingRoll: "other_participant",
      approvalStatus: "approved",
      approvedBy: proposerUserId,
      proposedBy: proposerUserId,
    });
  }, 120_000);

  afterAll(async () => {
    if (!hasDb || !getPlatformDb) return;
    const platform = getPlatformDb();
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      await platform.delete(rollActions).where(eq(rollActions.organizationId, orgA));
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
    }
    await platform.execute(sql`delete from staff_positions where organization_id = ${orgA}::uuid`);
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      await platform.delete(organizations).where(eq(organizations.id, orgA));
      await platform.delete(organizations).where(eq(organizations.id, orgB));
    } finally {
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    // Self-referencing merge pointer first, then the rows.
    await platform.update(people).set({ mergedIntoId: null }).where(eq(people.id, visitorMerged));
    await platform.update(people).set({ mergedIntoId: null }).where(eq(people.id, staffAnchorMerged));
    for (const id of people_) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, proposerUserId));
  }, 120_000);

  const ALL = { page: 1, pageSize: 50 };
  const idsOf = (rows: Array<{ personId: string }>) => rows.map((r) => r.personId).sort();

  // ---------------------------------------------------------------------------
  describe("the people.manage gate (DECISION-197)", () => {
    it("every reader is forbidden without people.manage, even for a directory.view holder", async () => {
      expect(await listVisitors(directoryOnly, orgA, ALL)).toEqual({ kind: "forbidden" });
      expect(await listStaff(directoryOnly, orgA, ALL)).toEqual({ kind: "forbidden" });
      expect(await listFormerParticipants(directoryOnly, orgA, ALL)).toEqual({ kind: "forbidden" });
      expect(await getCommunityStatus(directoryOnly, orgA, visitorA)).toEqual({ kind: "forbidden" });
      expect(await getCommunityBadges(directoryOnly, orgA, [visitorA, memberActive])).toEqual({});
    });

    it("a people.manage holder WITHOUT directory.view still gets all three lists while the Directory is forbidden — the Community page's degrade", async () => {
      expect((await getDirectory(managerOnly, orgA)).kind).toBe("forbidden");
      for (const reader of [listVisitors, listStaff, listFormerParticipants]) {
        expect((await reader(managerOnly, orgA, ALL)).kind).toBe("ok");
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("listVisitors", () => {
    it("lists live visitors with no roll: not the enrolled, ended, merged, member, participant, staff or former", async () => {
      const result = await listVisitors(managerOnly, orgA, ALL);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      // visitorPending stays a visitor while its proposal waits.
      expect(idsOf(result.rows)).toEqual([visitorA, visitorB, visitorPending].sort());
      const a = result.rows.find((r) => r.personId === visitorA)!;
      expect(a).toMatchObject({
        displayName: `Alba ${surname}`,
        email: `alba-${stamp}@example.invalid`,
        firstVisitDate: "2026-09-13",
        positions: [],
        endedOn: null,
      });
      expect(result.rows.find((r) => r.personId === visitorB)).toMatchObject({ email: null, firstVisitDate: null });
    });

    it("another organization's visitor is never visible (RLS)", async () => {
      const result = await listVisitors(managerOnly, orgA, ALL);
      expect(result.kind === "ok" && idsOf(result.rows)).not.toContain(elsewhereVisitor);
    });

    it("orders by surname, first name, id and paginates with a clamped page", async () => {
      const page1 = await listVisitors(managerOnly, orgA, { page: 1, pageSize: 2 });
      expect(page1).toMatchObject({ kind: "ok", pagination: { page: 1, pageSize: 2, total: 3, totalPages: 2 } });
      if (page1.kind !== "ok") return;
      expect(page1.rows.map((r) => r.displayName)).toEqual([`Alba ${surname}`, `Bryn ${surname}`]);

      const clamped = await listVisitors(managerOnly, orgA, { page: 99, pageSize: 2 });
      expect(clamped).toMatchObject({ kind: "ok", pagination: { page: 2, totalPages: 2 } });
      if (clamped.kind !== "ok") return;
      expect(clamped.rows.map((r) => r.displayName)).toEqual([`Fern ${surname}`]);

      const low = await listVisitors(managerOnly, orgA, { page: -4, pageSize: 2 });
      expect(low.kind === "ok" && low.pagination.page).toBe(1);
    });

    it("searches first, last, preferred name and primary email; wildcard characters are literal", async () => {
      const byFirst = await listVisitors(managerOnly, orgA, { ...ALL, search: "alb" });
      expect(byFirst.kind === "ok" && idsOf(byFirst.rows)).toEqual([visitorA]);
      const byEmail = await listVisitors(managerOnly, orgA, { ...ALL, search: `alba-${stamp}@` });
      expect(byEmail.kind === "ok" && idsOf(byEmail.rows)).toEqual([visitorA]);
      const byLast = await listVisitors(managerOnly, orgA, { ...ALL, search: surname.toUpperCase() });
      expect(byLast.kind === "ok" && byLast.rows.length).toBe(3);
      for (const wildcard of ["%", "_", "\\", "%b%", "a_a"]) {
        const result = await listVisitors(managerOnly, orgA, { ...ALL, search: wildcard });
        expect(result.kind === "ok" && result.rows.length, wildcard).toBe(0);
      }
      const blank = await listVisitors(managerOnly, orgA, { ...ALL, search: "   " });
      expect(blank.kind === "ok" && blank.rows.length).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  describe("listStaff", () => {
    it("lists everyone with an OPEN position or a live staff anchor, whatever the engagement, with their open titles only", async () => {
      const result = await listStaff(managerOnly, orgA, ALL);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(idsOf(result.rows)).toEqual(
        [staffRegular, staffAnchorWithPosition, staffAnchorNoPosition, staffFutureEnd].sort(),
      );
      expect(result.rows.find((r) => r.personId === staffRegular)?.positions).toEqual(["Organist"]);
      // The ended Bookkeeper position is not listed; the open Sexton is.
      expect(result.rows.find((r) => r.personId === staffAnchorWithPosition)?.positions).toEqual(["Sexton"]);
      // A position that ends in the future is still open.
      expect(result.rows.find((r) => r.personId === staffFutureEnd)?.positions).toEqual(["Choir Director"]);
    });

    it("a live engagement-'staff' anchor with NO position lists too, with no positions; an ended position alone still does not", async () => {
      const result = await listStaff(managerOnly, orgA, ALL);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const ids = idsOf(result.rows);
      expect(ids).toContain(staffAnchorNoPosition);
      expect(result.rows.find((r) => r.personId === staffAnchorNoPosition)?.positions).toEqual([]);
      expect(ids).not.toContain(staffEndedOnly);
    });

    it("an ENDED or merged anchor does not list", async () => {
      const result = await listStaff(managerOnly, orgA, ALL);
      const ids = result.kind === "ok" ? idsOf(result.rows) : [];
      expect(ids).not.toContain(staffAnchorEnded);
      expect(ids).not.toContain(staffAnchorMerged);
    });

    it("counts, search and order stay coherent with the anchor in the list", async () => {
      const result = await listStaff(managerOnly, orgA, ALL);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.pagination.total).toBe(result.rows.length);
      // One shared surname, so the (last, first) order is the first-name order.
      const names = result.rows.map((r) => r.displayName);
      expect(names).toEqual([...names].sort());
      const searched = await listStaff(managerOnly, orgA, { ...ALL, search: "Kit" });
      expect(searched.kind === "ok" && idsOf(searched.rows)).toEqual([staffAnchorNoPosition]);
      const paged = await listStaff(managerOnly, orgA, { page: 1, pageSize: 2 });
      expect(paged.kind === "ok" && paged.pagination.total).toBe(result.rows.length);
    });
  });

  // ---------------------------------------------------------------------------
  describe("listFormerParticipants", () => {
    it("lists exactly the memberships ended by a participant removal, with the end date", async () => {
      const result = await listFormerParticipants(managerOnly, orgA, ALL);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(idsOf(result.rows)).toEqual([formerA, formerB].sort());
      expect(result.rows.find((r) => r.personId === formerA)?.endedOn).toBe("2026-04-01");
      expect(result.rows.find((r) => r.personId === formerB)?.endedOn).toBe("2026-05-01");
      expect(idsOf(result.rows)).not.toContain(endedOther);
      expect(idsOf(result.rows)).not.toContain(visitorEnded);
    });
  });

  // ---------------------------------------------------------------------------
  describe("getCommunityBadges", () => {
    it("derives one badge per person: the roll first, then waiting, then visitor; omits those with none", async () => {
      const badges = await getCommunityBadges(managerOnly, orgA, [
        memberActive,
        participant,
        visitorPending,
        visitorA,
        staffAnchorNoPosition,
        formerA,
        visitorEnded,
        visitorEnrolled,
      ]);
      expect(badges).toEqual({
        [memberActive]: "active",
        [participant]: "participant",
        [visitorPending]: "waiting",
        [visitorA]: "visitor",
        [visitorEnrolled]: "participant",
        // staff anchor, ended people: no badge
      });
    });

    it("drops non-UUID ids, tolerates duplicates and an empty list, and never reads another organization's people", async () => {
      expect(await getCommunityBadges(managerOnly, orgA, [])).toEqual({});
      expect(await getCommunityBadges(managerOnly, orgA, ["nope", "1; drop table people"])).toEqual({});
      expect(await getCommunityBadges(managerOnly, orgA, [visitorA, visitorA, "nope"])).toEqual({ [visitorA]: "visitor" });
      expect(await getCommunityBadges(managerOnly, orgA, [elsewhereVisitor])).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  describe("getCommunityStatus", () => {
    it("reports the connection, the roll, the latest on-record entry and the pending count", async () => {
      const result = await getCommunityStatus(managerOnly, orgA, participant);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.status).toMatchObject({
        personId: participant,
        connection: "participant",
        currentRoll: "other_participant",
        currentRollSince: "2024-01-01",
        endedOn: null,
        hasOpenStaffPosition: false,
        pendingCount: 0,
        latestAction: { kind: "other_participant_enrolled", effectiveDate: "2024-01-01", onRecordKind: true },
      });
    });

    it("a visitor with a pending proposal: connection visitor, pendingCount 1, no latest effective action", async () => {
      const result = await getCommunityStatus(managerOnly, orgA, visitorPending);
      expect(result.kind === "ok" && result.status).toMatchObject({
        connection: "visitor",
        currentRoll: null,
        pendingCount: 1,
        latestAction: null,
      });
    });

    it("staff, former participant, other ended, and member connections", async () => {
      const staff = await getCommunityStatus(managerOnly, orgA, staffRegular);
      expect(staff.kind === "ok" && staff.status).toMatchObject({ connection: "listed", hasOpenStaffPosition: true });
      const anchor = await getCommunityStatus(managerOnly, orgA, staffAnchorNoPosition);
      expect(anchor.kind === "ok" && anchor.status).toMatchObject({ connection: "staff", hasOpenStaffPosition: false });
      const former = await getCommunityStatus(managerOnly, orgA, formerA);
      expect(former.kind === "ok" && former.status).toMatchObject({ connection: "former_participant", endedOn: "2026-04-01" });
      const ended = await getCommunityStatus(managerOnly, orgA, endedOther);
      expect(ended.kind === "ok" && ended.status).toMatchObject({ connection: "ended", endedOn: "2026-03-01" });
      const member = await getCommunityStatus(managerOnly, orgA, memberActive);
      expect(member.kind === "ok" && member.status).toMatchObject({ connection: "member", currentRoll: "active" });
    });

    it("not_found for a non-UUID, an unknown id, and a person who belongs only to another organization", async () => {
      expect(await getCommunityStatus(managerOnly, orgA, "nope")).toEqual({ kind: "not_found" });
      expect(await getCommunityStatus(managerOnly, orgA, "00000000-0000-0000-0000-000000000000")).toEqual({ kind: "not_found" });
      expect(await getCommunityStatus(managerOnly, orgA, elsewhereVisitor)).toEqual({ kind: "not_found" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("every live-membership shape is findable in Community", () => {
    it("each person lands in at least one of the six views, and the ended one in Former — regression for staff-anchor people missing from Community", async () => {
      const all = { page: 1, pageSize: 200 };
      const directoryIds = async (extra: Record<string, unknown> = {}) => {
        const result = await getDirectory(viewerBoth, orgA, { ...all, ...extra });
        if (result.kind !== "ok") throw new Error("directory not ok");
        return result.entries.map((e) => e.personId);
      };
      const adminIds = async (reader: typeof listVisitors) => {
        const result = await reader(viewerBoth, orgA, all);
        if (result.kind !== "ok") throw new Error("list not ok");
        return result.rows.map((r) => r.personId);
      };

      const views: Record<string, string[]> = {
        everyone: await directoryIds(),
        members: await directoryIds({ rollStatuses: ["active", "baptized", "affiliate"] }),
        participants: await directoryIds({ status: "other_participant" }),
        visitors: await adminIds(listVisitors),
        staff: await adminIds(listStaff),
        former: await adminIds(listFormerParticipants),
      };
      const viewsOf = (id: string) =>
        Object.entries(views)
          .filter(([, ids]) => ids.includes(id))
          .map(([name]) => name);

      const liveShapes: Record<string, string> = {
        "roll member": memberActive,
        participant,
        visitor: visitorA,
        "staff with a position": staffRegular,
        "staff anchor without a position": staffAnchorNoPosition,
      };
      for (const [shape, id] of Object.entries(liveShapes)) {
        expect(viewsOf(id), shape).not.toEqual([]);
      }
      expect(viewsOf(formerA), "ended membership").toContain("former");

      // DECISION-129 is untouched: the anchor is Staff-only, never in the Directory.
      expect(viewsOf(staffAnchorNoPosition)).toEqual(["staff"]);
    });
  });
});
