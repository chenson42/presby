/**
 * Integration tests for getPortalHomeData() — run against a REAL Postgres
 * connection, not mocked. Same rationale and skip discipline as
 * `directory.test.ts`. SKIPPED (not failed) when DATABASE_URL/
 * PLATFORM_DATABASE_URL are unset. Run for real with `dotenv -e .env.local
 * -- vitest run src/lib/org-portal/home-data.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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

    let org: string;

    let noHousehold: string; // no household_id at all
    let withPreferred: string; // preferred_name set — must win over first_name
    let householdId: string;
    let householdMemberOne: string;
    let householdMemberTwo: string; // ended_on set — must NOT count

    beforeAll(async () => {
      ({ getPortalHomeData } = await import("./home-data"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, households } = await import(
        "@/lib/db/domain/people"
      ));

      const platform = getPlatformDb();
      const stamp = Date.now();

      const [o] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: "Fixture Congregation for home-data.test.ts",
          slug: `home-data-test-${stamp}`,
          path: `home_data_test_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      org = o!.id;

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

      // The memberships trigger (drizzle/0017) requires an active_membership
      // derived group to exist before any membership row lands.
      await platform.insert(groups).values({
        organizationId: org,
        groupTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });

      const [household] = await platform
        .insert(households)
        .values({ organizationId: org, name: "The Marchbanks Family" })
        .returning({ id: households.id });
      householdId = household!.id;

      async function person(first: string, last: string, preferred?: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last, preferredName: preferred ?? null })
          .returning({ id: people.id });
        return p!.id;
      }

      noHousehold = await person("Ophelia", "Marchbanks");
      withPreferred = await person("Bartholomew", "Fenwright", "Bart");
      householdMemberOne = await person("Devika", "Marchbanks");
      householdMemberTwo = await person("Marcus", "Marchbanks");

      await platform.insert(memberships).values([
        {
          organizationId: org,
          personId: noHousehold,
          engagementStatus: "regular",
          currentRoll: "active",
        },
        {
          organizationId: org,
          personId: withPreferred,
          engagementStatus: "regular",
          currentRoll: "active",
          householdId,
        },
        {
          organizationId: org,
          personId: householdMemberOne,
          engagementStatus: "regular",
          currentRoll: "active",
          householdId,
        },
        {
          organizationId: org,
          personId: householdMemberTwo,
          engagementStatus: "regular",
          currentRoll: "active",
          householdId,
          endedOn: "2020-01-01",
        },
      ]);
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      await platform.delete(organizations).where(eq(organizations.id, org));
      for (const id of [
        noHousehold,
        withPreferred,
        householdMemberOne,
        householdMemberTwo,
      ].filter(Boolean)) {
        await platform.delete(people).where(eq(people.id, id));
      }
    });

    it("returns household: null for a person with no household_id", async () => {
      const result = await getPortalHomeData(noHousehold, org);
      expect(result.household).toBeNull();
      expect(result.displayName).toBe("Ophelia");
    });

    it("prefers preferred_name over first_name for the display name", async () => {
      const result = await getPortalHomeData(withPreferred, org);
      expect(result.displayName).toBe("Bart");
    });

    it("counts only CURRENT household members — an ended membership is excluded", async () => {
      const result = await getPortalHomeData(withPreferred, org);
      expect(result.household).toEqual({
        id: householdId,
        name: "The Marchbanks Family",
        // withPreferred + householdMemberOne are current; householdMemberTwo
        // is ended and must not count.
        memberCount: 2,
      });
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
