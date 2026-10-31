/**
 * Integration tests for getPortalHomeData() (portal-home alignment: the
 * household count is the DIRECTORY's count, F136; a household below two
 * eligible people is not shown; `canViewDirectory` is read once here) — run against a REAL Postgres
 * connection, not mocked. Same rationale and skip discipline as
 * `directory.test.ts`. SKIPPED (not failed) when DATABASE_URL/
 * PLATFORM_DATABASE_URL are unset. Run for real with `dotenv -e .env.local
 * -- vitest run src/lib/org-portal/home-data.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "getPortalHomeData (Postgres-backed, real dev database)",
  () => {
    let getPortalHomeData: typeof import("./home-data").getPortalHomeData;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let households: typeof import("@/lib/db/domain/people").households;
    let personPrivacy: typeof import("@/lib/db/domain/privacy").personPrivacy;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let getHouseholdDetail: typeof import("@/lib/directory").getHouseholdDetail;

    let org: string;
    let orgB: string; // no directory.view binding at all

    let noHousehold: string; // no household_id at all
    let withPreferred: string; // preferred_name set — must win over first_name
    let householdId: string;
    let householdMemberOne: string;
    let householdMemberTwo: string; // ended_on set — must NOT count
    let deceasedMember: string; // in H1 — must NOT count
    let hiddenMember: string; // in H1, directory_hidden — must NOT count
    let offRollVisitor: string; // in H1, visitor with no roll — must NOT count
    let soloWidow: string; // H2: alone after a death
    let widowSpouse: string; // H2, deceased
    let widowHouseholdId: string;
    let hiddenViewer: string; // H3: directory_hidden, with a visible spouse
    let visibleSpouse: string;
    let hiddenViewerHouseholdId: string;
    // H4: not eligible themself, two eligible housemates. A STAFF ANCHOR since
    // drizzle/0066 (Increment 3a): a visitor no longer holds directory.view
    // (F177 Option 1), and a staff anchor is the standing that holds it while
    // never being directory content (DECISION-129, DECISION-207).
    let visitorViewer: string;
    let visitorHouseholdMateOne: string;
    let visitorHouseholdMateTwo: string;
    let visitorHouseholdId: string;
    let viewerB: string; // org B, no directory.view
    let viewerBMateOne: string;
    let viewerBMateTwo: string;

    beforeAll(async () => {
      ({ getPortalHomeData } = await import("./home-data"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, households } = await import(
        "@/lib/db/domain/people"
      ));
      ({ personPrivacy } = await import("@/lib/db/domain/privacy"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));
      ({ getHouseholdDetail } = await import("@/lib/directory"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      const [o] = await platform
        .insert(organizations)
        .values({
          // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: "Fixture Congregation for home-data.test.ts",
          slug: `home-data-test-${stamp}`,
          path: `home_data_test_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      org = o!.id;

      const [ob] = await platform
        .insert(organizations)
        .values({
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: "Fixture Congregation B for home-data.test.ts",
          slug: `home-data-test-b-${stamp}`,
          path: `home_data_test_b_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      orgB = ob!.id;

      const [gt] = await platform
        .insert(groupTypes)
        .values({ key: "roster", name: "Roster" })
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

      // The memberships trigger (drizzle/0017) requires an active_membership
      // derived group to exist before any membership row lands.
      const [activeGroup] = await platform
        .insert(groups)
        .values({
          organizationId: org,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        })
        .returning({ id: groups.id });
      // Org B has its own active_membership group and NO directory.view binding.
      await platform.insert(groups).values({
        organizationId: orgB,
        groupTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });

      // directory.view bound to org A's baseline member role (the shape
      // directory.test.ts builds).
      await platform
        .insert(permissions)
        .values({
          key: "directory.view",
          module: "directory",
          description: "Browse the congregation directory",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();
      const [role] = await platform
        .insert(appRoles)
        .values({
          organizationId: org,
          key: "member",
          name: "Member",
          roleKind: "constitutional",
          isProtected: true,
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: role!.id, permissionKey: "directory.view" });
      await platform.insert(roleGrants).values({
        organizationId: org,
        roleId: role!.id,
        groupId: activeGroup!.id,
        startsOn: "2000-01-01",
      });

      async function household(organizationId: string, name: string) {
        const [h] = await platform
          .insert(households)
          .values({ organizationId, name })
          .returning({ id: households.id });
        return h!.id;
      }
      householdId = await household(org, "The Marchbanks Family");
      widowHouseholdId = await household(org, "The Lindqvist Household");
      hiddenViewerHouseholdId = await household(org, "The Ostrander Household");
      visitorHouseholdId = await household(org, "The Pemberton Household");
      const householdB = await household(orgB, "The Quillfeather Household");

      async function person(
        first: string,
        last: string,
        preferred?: string,
        dateOfDeath?: string,
      ) {
        const [p] = await platform
          .insert(people)
          .values({
            firstName: first,
            lastName: last,
            preferredName: preferred ?? null,
            dateOfDeath: dateOfDeath ?? null,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        return p!.id;
      }

      noHousehold = await person("Ophelia", "Marchbanks");
      withPreferred = await person("Bartholomew", "Fenwright", "Bart");
      householdMemberOne = await person("Devika", "Marchbanks");
      householdMemberTwo = await person("Marcus", "Marchbanks");
      deceasedMember = await person("Winifred", "Marchbanks", undefined, "2024-02-01");
      hiddenMember = await person("Hollis", "Marchbanks");
      offRollVisitor = await person("Vesper", "Marchbanks");
      soloWidow = await person("Ingrid", "Lindqvist");
      widowSpouse = await person("Anders", "Lindqvist", undefined, "2025-06-01");
      hiddenViewer = await person("Odalys", "Ostrander");
      visibleSpouse = await person("Tobiah", "Ostrander");
      visitorViewer = await person("Percival", "Pemberton");
      visitorHouseholdMateOne = await person("Rosalind", "Pemberton");
      visitorHouseholdMateTwo = await person("Casimir", "Pemberton");
      viewerB = await person("Quentin", "Quillfeather");
      viewerBMateOne = await person("Perpetua", "Quillfeather");
      viewerBMateTwo = await person("Lucan", "Quillfeather");

      const regular = { engagementStatus: "regular", currentRoll: "active" };
      await platform.insert(memberships).values([
        { organizationId: org, personId: noHousehold, ...regular },
        { organizationId: org, personId: withPreferred, ...regular, householdId },
        { organizationId: org, personId: householdMemberOne, ...regular, householdId },
        {
          organizationId: org,
          personId: householdMemberTwo,
          ...regular,
          householdId,
          endedOn: "2020-01-01",
        },
        { organizationId: org, personId: deceasedMember, ...regular, householdId },
        { organizationId: org, personId: hiddenMember, ...regular, householdId },
        {
          organizationId: org,
          personId: offRollVisitor,
          engagementStatus: "visitor",
          currentRoll: null,
          householdId,
        },
        { organizationId: org, personId: soloWidow, ...regular, householdId: widowHouseholdId },
        { organizationId: org, personId: widowSpouse, ...regular, householdId: widowHouseholdId },
        {
          organizationId: org,
          personId: hiddenViewer,
          ...regular,
          householdId: hiddenViewerHouseholdId,
        },
        {
          organizationId: org,
          personId: visibleSpouse,
          ...regular,
          householdId: hiddenViewerHouseholdId,
        },
        {
          organizationId: org,
          personId: visitorViewer,
          engagementStatus: "staff",
          currentRoll: null,
          householdId: visitorHouseholdId,
        },
        {
          organizationId: org,
          personId: visitorHouseholdMateOne,
          ...regular,
          householdId: visitorHouseholdId,
        },
        {
          organizationId: org,
          personId: visitorHouseholdMateTwo,
          ...regular,
          householdId: visitorHouseholdId,
        },
        { organizationId: orgB, personId: viewerB, ...regular, householdId: householdB },
        { organizationId: orgB, personId: viewerBMateOne, ...regular, householdId: householdB },
        { organizationId: orgB, personId: viewerBMateTwo, ...regular, householdId: householdB },
      ]);

      await platform.insert(personPrivacy).values([
        { personId: hiddenMember, organizationId: org, directoryHidden: true },
        { personId: hiddenViewer, organizationId: org, directoryHidden: true },
      ]);
    });

    function everyone() {
      return [
        noHousehold,
        withPreferred,
        householdMemberOne,
        householdMemberTwo,
        deceasedMember,
        hiddenMember,
        offRollVisitor,
        soloWidow,
        widowSpouse,
        hiddenViewer,
        visibleSpouse,
        visitorViewer,
        visitorHouseholdMateOne,
        visitorHouseholdMateTwo,
        viewerB,
        viewerBMateOne,
        viewerBMateTwo,
      ].filter(Boolean);
    }

    afterAll(async () => {
      const platform = getPlatformDb();
      for (const id of everyone()) {
        await platform.delete(personPrivacy).where(eq(personPrivacy.personId, id));
      }
      // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
      // 110) also rejects the DELETE that cascading `organizations` fires
      // against this fixture's own active_membership-derived group_memberships
      // rows — disable it around the cascade, same as roll.test.ts's own
      // teardown does for roll_actions_freeze.
      await platform.execute(
        sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
      );
      try {
        await platform.delete(organizations).where(eq(organizations.id, org));
        await platform.delete(organizations).where(eq(organizations.id, orgB));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      for (const id of everyone()) {
        await platform.delete(people).where(eq(people.id, id));
      }
    });

    it("returns household: null for a person with no household_id", async () => {
      const result = await getPortalHomeData(noHousehold, org);
      expect(result.household).toBeNull();
      expect(result.canViewDirectory).toBe(true);
      expect(result.displayName).toBe("Ophelia");
    });

    it("prefers preferred_name over first_name for the display name", async () => {
      const result = await getPortalHomeData(withPreferred, org);
      expect(result.displayName).toBe("Bart");
    });

    it("counts the DIRECTORY's members: ended, deceased, hidden and off-roll people are all excluded (F136)", async () => {
      const result = await getPortalHomeData(withPreferred, org);
      expect(result.household).toEqual({
        id: householdId,
        name: "The Marchbanks Family",
        // withPreferred + householdMemberOne only. householdMemberTwo is ended,
        // deceasedMember is deceased, hiddenMember is directory_hidden and
        // offRollVisitor has no roll status.
        memberCount: 2,
      });
    });

    it("agrees with the household page for the same viewer (F136 equivalence guard)", async () => {
      const home = await getPortalHomeData(withPreferred, org);
      const page = await getHouseholdDetail(withPreferred, org, householdId);
      if (page.kind !== "ok") throw new Error("expected ok");
      expect(home.household?.memberCount).toBe(page.household.memberCount);
      expect(page.household.memberCount).toBe(2);
    });

    it("suppresses a household of one — a widow whose spouse has died sees no household card", async () => {
      const result = await getPortalHomeData(soloWidow, org);
      expect(result.household).toBeNull();
      expect(result.displayName).toBe("Ingrid");
    });

    it("a directory-hidden viewer with one visible housemate sees no card (the count they are not in is one)", async () => {
      const result = await getPortalHomeData(hiddenViewer, org);
      expect(result.household).toBeNull();
      expect(result.displayName).toBe("Odalys");
      // The household page, for the same viewer, shows only the spouse — so
      // the suppressed count of one is the same number it would show.
      const page = await getHouseholdDetail(hiddenViewer, org, hiddenViewerHouseholdId);
      if (page.kind !== "ok") throw new Error("expected ok");
      expect(page.household.memberCount).toBe(1);
    });

    it("a viewer who is not themself eligible still sees the directory's count of their household", async () => {
      const result = await getPortalHomeData(visitorViewer, org);
      expect(result.household).toEqual({
        id: visitorHouseholdId,
        name: "The Pemberton Household",
        memberCount: 2,
      });
    });

    it("a visitor viewer holds no directory.view since 0066, so no household card (F177 Option 1)", async () => {
      const result = await getPortalHomeData(offRollVisitor, org);
      expect(result.canViewDirectory).toBe(false);
      expect(result.household).toBeNull();
    });

    it("a viewer without directory.view gets canViewDirectory false, no household, and still a display name", async () => {
      const result = await getPortalHomeData(viewerB, orgB);
      // Org B's household has two eligible members, and the result is still
      // null: the household read is GATED, not merely filtered.
      expect(result.canViewDirectory).toBe(false);
      expect(result.household).toBeNull();
      expect(result.displayName).toBe("Quentin");
    });

    it("a genuine DB failure propagates as a thrown exception", async () => {
      await expect(getPortalHomeData("not-a-uuid", org)).rejects.toThrow();
    });

    it("does not swallow OrgAccessError into a result variant", async () => {
      const { randomUUID } = await import("node:crypto");
      await expect(
        getPortalHomeData(randomUUID(), org),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });
  },
);
