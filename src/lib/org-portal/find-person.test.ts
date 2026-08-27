/**
 * Integration tests for findPersonMatches() — run against a REAL Postgres
 * connection, not mocked. Same rationale and same skip discipline as
 * `directory.test.ts`: the behavior under test is genuine SQL (a permission
 * gate, an eligibility WHERE clause, an ILIKE match), and mocking
 * `@/lib/db` would only prove the mapping code round-trips canned rows.
 * SKIPPED (not failed) when DATABASE_URL/PLATFORM_DATABASE_URL are unset.
 * Run for real with `dotenv -e .env.local -- vitest run
 * src/lib/org-portal/find-person.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "findPersonMatches (Postgres-backed, real dev database)",
  () => {
    let findPersonMatches: typeof import("./find-person").findPersonMatches;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
    let personPrivacy: typeof import("@/lib/db/domain/privacy").personPrivacy;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;

    let orgA: string; // has the directory.view binding
    let orgB: string; // no role bound to directory.view — the forbidden case

    let seeker: string; // the person doing the searching, at orgA
    let seekerB: string; // the person doing the searching, at orgB (no grant)
    let unique: string; // "Zinnia Okonkwo-Vance" — one unambiguous match
    let dupeOne: string; // "Frankie Alderton" — shares a last name with dupeTwo
    let dupeTwo: string; // "Priya Alderton"
    let hidden: string; // directory_hidden — must never match
    let visitor: string; // no roll status — must never match (DECISION-065)
    let byEmail: string; // matched only via contact_methods

    beforeAll(async () => {
      ({ findPersonMatches } = await import("./find-person"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, contactMethods } = await import(
        "@/lib/db/domain/people"
      ));
      ({ personPrivacy } = await import("@/lib/db/domain/privacy"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      const [a] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: "Fixture Congregation A for find-person.test.ts",
          slug: `find-person-test-a-${stamp}`,
          path: `find_person_test_a_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      orgA = a!.id;

      const [b] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: "Fixture Congregation B for find-person.test.ts",
          slug: `find-person-test-b-${stamp}`,
          path: `find_person_test_b_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      orgB = b!.id;

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

      const [groupA] = await platform
        .insert(groups)
        .values({
          organizationId: orgA,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        })
        .returning({ id: groups.id });

      await platform.insert(groups).values({
        organizationId: orgB,
        groupTypeId,
        name: "Active Membership",
        membershipSource: "derived",
        derivedFrom: "active_membership",
        isProtected: true,
      });

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
          organizationId: orgA,
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
        organizationId: orgA,
        roleId: role!.id,
        groupId: groupA!.id,
        startsOn: "2000-01-01",
      });
      // orgB gets no app_roles/role_grants at all — the "no grant" fixture.

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        return p!.id;
      }

      seeker = await person("Ophelia", "Marchbanks");
      seekerB = await person("Bram", "Fenwright");
      unique = await person("Zinnia", "Okonkwo-Vance");
      dupeOne = await person("Frankie", "Alderton");
      dupeTwo = await person("Priya", "Alderton");
      hidden = await person("Blythe", "Osei");
      visitor = await person("Callum", "Petrakis");
      byEmail = await person("Noor", "Whitcombe");

      async function membership(
        organizationId: string,
        personId: string,
        engagementStatus: string,
        currentRoll: string | null,
      ) {
        await platform.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus,
          currentRoll,
        });
      }

      await membership(orgA, seeker, "regular", "active");
      await membership(orgB, seekerB, "regular", "active");
      await membership(orgA, unique, "regular", "active");
      await membership(orgA, dupeOne, "regular", "active");
      await membership(orgA, dupeTwo, "regular", "active");
      await membership(orgA, hidden, "regular", "active");
      await membership(orgA, visitor, "visitor", null);
      await membership(orgA, byEmail, "regular", "active");

      await platform
        .insert(personPrivacy)
        .values({ personId: hidden, organizationId: orgA, directoryHidden: true });

      await platform.insert(contactMethods).values({
        personId: byEmail,
        kind: "email",
        value: "noor.whitcombe@example.invalid",
        isPrimary: true,
      });
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      const allPeople = [
        seeker,
        seekerB,
        unique,
        dupeOne,
        dupeTwo,
        hidden,
        visitor,
        byEmail,
      ].filter(Boolean);

      for (const id of allPeople) {
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
        await platform.delete(organizations).where(eq(organizations.id, orgA));
        await platform.delete(organizations).where(eq(organizations.id, orgB));
      } finally {
        await platform.execute(
          sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
        );
      }
      for (const id of allPeople) {
        await platform.delete(people).where(eq(people.id, id));
      }
    });

    it("zero matches returns an empty, ok result", async () => {
      const result = await findPersonMatches(seeker, orgA, "nobody-like-this");
      expect(result).toEqual({ kind: "ok", personIds: [] });
    });

    it("exactly one match returns a single id", async () => {
      const result = await findPersonMatches(seeker, orgA, "Zinnia");
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.personIds).toEqual([unique]);
    });

    it("more than one match returns at least two ids, capped at two", async () => {
      const result = await findPersonMatches(seeker, orgA, "Alderton");
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.personIds.length).toBe(2);
      expect(result.personIds.sort()).toEqual([dupeOne, dupeTwo].sort());
    });

    it("matches by email, not just by name", async () => {
      const result = await findPersonMatches(seeker, orgA, "noor.whitcombe");
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.personIds).toEqual([byEmail]);
    });

    it("a directory_hidden person never matches, even by exact name", async () => {
      const result = await findPersonMatches(seeker, orgA, "Blythe");
      expect(result).toEqual({ kind: "ok", personIds: [] });
    });

    it("a visitor with no roll status never matches (DECISION-065)", async () => {
      const result = await findPersonMatches(seeker, orgA, "Callum");
      expect(result).toEqual({ kind: "ok", personIds: [] });
    });

    it("someone with no directory.view grant gets forbidden, not an empty list", async () => {
      const result = await findPersonMatches(seekerB, orgB, "anything");
      expect(result).toEqual({ kind: "forbidden" });
    });
  },
);
