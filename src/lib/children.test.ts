/**
 * Integration tests for `src/lib/children.ts` — Children's ministry,
 * Increment A (docs/work-log/2026-08-26-childrens-ministry.md,
 * DECISION-111/114). Same harness as `person-sensitive.test.ts`: real
 * Postgres, `hasDb` skip-guard, self-contained fixture, INCLUDING its
 * trigger-disable teardown wrap for the derived "Active Membership" group
 * this fixture creates. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/children.test.ts
 *
 * `recordAudit()` is mocked at the module boundary, same posture and same
 * reason as `person-sensitive.test.ts` — `@/lib/audit` transitively imports
 * `@/auth` (next-auth), which this test environment cannot resolve.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TENANT_PERSON_RELATIONSHIP_ADDED: "tenant.person_relationship.added",
    TENANT_PERSON_RELATIONSHIP_UPDATED: "tenant.person_relationship.updated",
    TENANT_PERSON_RELATIONSHIP_REMOVED: "tenant.person_relationship.removed",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "children.ts (Postgres-backed, real dev database)",
  () => {
    let getChildrenRoster: typeof import("./children").getChildrenRoster;
    let getGuardianLinksForEdit: typeof import("./children").getGuardianLinksForEdit;
    let addGuardianLink: typeof import("./children").addGuardianLink;
    let updateGuardianLink: typeof import("./children").updateGuardianLink;
    let removeGuardianLink: typeof import("./children").removeGuardianLink;
    let searchLinkablePeople: typeof import("./children").searchLinkablePeople;

    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let households: typeof import("@/lib/db/domain/people").households;
    let personRelationships: typeof import("@/lib/db/domain/people").personRelationships;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;

    const stamp = Date.now();

    let orgA: string;
    let orgB: string; // cross-org checks

    let householdId: string;
    let childWithGuardian: string; // orgA, under 18, has a guardian link
    let childNoGuardian: string; // orgA, under 18, no guardian link
    let adultPerson: string; // orgA, over 18 — never on the roster
    let noDobPerson: string; // orgA, under 18 in real life but no DOB on file

    let rosterHolder: string; // orgA — holds children.roster
    let grantlessPerson: string; // orgA — membership, no grants
    let orgBActor: string; // orgB — holds children.roster, at orgB

    const trackedPeopleIds: string[] = [];

    beforeAll(async () => {
      ({
        getChildrenRoster,
        getGuardianLinksForEdit,
        addGuardianLink,
        updateGuardianLink,
        removeGuardianLink,
        searchLinkablePeople,
      } = await import("./children"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, households, personRelationships } = await import(
        "@/lib/db/domain/people"
      ));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));

      const platform = getPlatformDb();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for children.test.ts`,
            slug: `children-test-${label.toLowerCase()}-${stamp}`,
            path: `children_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }
      orgA = await makeOrg("A");
      orgB = await makeOrg("B");

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

      async function activeMembershipGroup(organizationId: string) {
        await platform.insert(groups).values({
          organizationId,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        });
      }
      await activeMembershipGroup(orgA);
      await activeMembershipGroup(orgB);

      await platform
        .insert(permissions)
        .values([
          {
            key: "children.roster",
            module: "children",
            description: "View the children's roster and manage guardian links for a child",
            sensitivityTier: 2,
          },
        ])
        .onConflictDoNothing();

      async function person(
        first: string,
        last: string,
        dateOfBirth: string | null,
      ) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last, dateOfBirth })
          .returning({ id: people.id });
        trackedPeopleIds.push(p!.id);
        return p!.id;
      }

      const [h] = await platform
        .insert(households)
        .values({ organizationId: orgA, name: "The Fixture Family" })
        .returning({ id: households.id });
      householdId = h!.id;

      // Under 18 relative to any date this fixture is plausibly read.
      childWithGuardian = await person("Elowen", `Sparrowbrook${stamp}`, "2015-04-01");
      childNoGuardian = await person("Bram", `Sparrowbrook${stamp}`, "2016-09-10");
      adultPerson = await person("Isolde", `Sparrowbrook${stamp}`, "1980-01-01");
      noDobPerson = await person("Fennick", `Sparrowbrook${stamp}`, null);
      rosterHolder = await person("Odile", `Marrowgate${stamp}`, "1975-05-05");
      grantlessPerson = await person("Cassian", `Marrowgate${stamp}`, "1978-02-02");
      orgBActor = await person("Thora", `Marrowgate${stamp}`, "1982-03-03");

      await platform.insert(memberships).values([
        {
          organizationId: orgA,
          personId: childWithGuardian,
          householdId,
          engagementStatus: "regular",
        },
        {
          organizationId: orgA,
          personId: childNoGuardian,
          householdId,
          engagementStatus: "regular",
        },
        { organizationId: orgA, personId: adultPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: noDobPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: rosterHolder, engagementStatus: "regular" },
        { organizationId: orgA, personId: grantlessPerson, engagementStatus: "regular" },
        { organizationId: orgB, personId: orgBActor, engagementStatus: "regular" },
      ]);

      await platform.insert(personRelationships).values({
        personId: childWithGuardian,
        relatedPersonId: adultPerson,
        relationship: "parent",
        isEmergencyContact: true,
      });

      async function roleWithPermission(
        organizationId: string,
        key: string,
        personId: string,
      ) {
        const [role] = await platform
          .insert(appRoles)
          .values({ organizationId, key, name: key, roleKind: "custom" })
          .returning({ id: appRoles.id });
        await platform.insert(appRolePermissions).values({
          roleId: role!.id,
          permissionKey: "children.roster",
        });
        await platform.insert(roleGrants).values({
          organizationId,
          roleId: role!.id,
          personId,
          startsOn: "2020-01-01",
        });
      }

      await roleWithPermission(orgA, `children_roster_${stamp}`, rosterHolder);
      await roleWithPermission(orgB, `org_b_roster_${stamp}`, orgBActor);
    });

    afterEach(() => {
      mockRecordAudit.mockClear();
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // Same trigger-disable teardown convention as person-sensitive.test.ts/
      // roll.test.ts — this fixture creates an "Active Membership" derived
      // group, and presby_reject_derived_group_write() correctly refuses to
      // let any connection delete rows in a derived group by cascade.
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
      for (const id of trackedPeopleIds) {
        await platform.delete(people).where(eq(people.id, id));
      }
    });

    describe("getChildrenRoster — permission gate + enumeration safety", () => {
      it("forbidden for a viewer holding no children.roster grant", async () => {
        const result = await getChildrenRoster(grantlessPerson, orgA);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("ok for a children.roster holder", async () => {
        const result = await getChildrenRoster(rosterHolder, orgA);
        expect(result.kind).toBe("ok");
      });
    });

    describe("getChildrenRoster — age-cutoff logic", () => {
      it("includes under-18 people with a DOB, excludes adults and no-DOB people", async () => {
        const result = await getChildrenRoster(rosterHolder, orgA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        const ids = result.children.map((c) => c.personId);
        expect(ids).toContain(childWithGuardian);
        expect(ids).toContain(childNoGuardian);
        expect(ids).not.toContain(adultPerson);
        expect(ids).not.toContain(noDobPerson);
      });

      it("computes guardianCount from person_relationships, and flags zero-guardian children", async () => {
        const result = await getChildrenRoster(rosterHolder, orgA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;

        const withGuardian = result.children.find(
          (c) => c.personId === childWithGuardian,
        );
        const withoutGuardian = result.children.find(
          (c) => c.personId === childNoGuardian,
        );
        expect(withGuardian?.guardianCount).toBe(1);
        expect(withoutGuardian?.guardianCount).toBe(0);
      });

      it("resolves household name via memberships.household_id", async () => {
        const result = await getChildrenRoster(rosterHolder, orgA);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        const child = result.children.find((c) => c.personId === childWithGuardian);
        expect(child?.householdName).toBe("The Fixture Family");
      });
    });

    describe("getGuardianLinksForEdit — enumeration safety", () => {
      it("forbidden for a viewer holding no children.roster grant", async () => {
        const result = await getGuardianLinksForEdit(
          grantlessPerson,
          orgA,
          childWithGuardian,
        );
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found for a person with no membership in this org (cross-org)", async () => {
        const result = await getGuardianLinksForEdit(
          orgBActor,
          orgB,
          childWithGuardian,
        );
        expect(result).toEqual({ kind: "not_found" });
      });

      it("resolves the linked person's display name for an existing-person link", async () => {
        const result = await getGuardianLinksForEdit(
          rosterHolder,
          orgA,
          childWithGuardian,
        );
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.links).toHaveLength(1);
        expect(result.links[0]!.relatedPersonId).toBe(adultPerson);
        expect(result.links[0]!.relatedPersonName).toContain("Isolde");
      });
    });

    describe("addGuardianLink — XOR validation (regression for the missing DB CHECK)", () => {
      it("invalid_input when both relatedPersonId and relatedName are given", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relatedPersonId: adultPerson,
          relatedName: "Someone Else",
          relationship: "parent",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "invalid_input", field: "relatedPersonId" });
        expect(mockRecordAudit).not.toHaveBeenCalled();
      });

      it("invalid_input when neither relatedPersonId nor relatedName is given", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relationship: "parent",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "invalid_input", field: "relatedName" });
      });

      it("invalid_input for a relationship outside the four-value allow-list", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relatedName: "Someone",
          // @ts-expect-error — deliberately outside the allow-list
          relationship: "spouse",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "invalid_input", field: "relationship" });
      });
    });

    describe("addGuardianLink — server-side length validation", () => {
      it("invalid_input over the relatedName length limit, writes nothing", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relatedName: "a".repeat(2001),
          relationship: "guardian",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "invalid_input", field: "relatedName" });
        expect(mockRecordAudit).not.toHaveBeenCalled();
      });

      it("invalid_input over the notes length limit, writes nothing", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relatedName: "Someone",
          relationship: "guardian",
          isEmergencyContact: false,
          notes: "a".repeat(4001),
        });
        expect(result).toEqual({ kind: "invalid_input", field: "notes" });
      });
    });

    describe("addGuardianLink — permission gate + not_found + existence-oracle narrowing", () => {
      it("forbidden without children.roster", async () => {
        const result = await addGuardianLink(grantlessPerson, orgA, childNoGuardian, {
          relatedName: "Someone",
          relationship: "guardian",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "forbidden" });
        expect(mockRecordAudit).not.toHaveBeenCalled();
      });

      it("not_found when the child has no membership in this org", async () => {
        const result = await addGuardianLink(orgBActor, orgB, childNoGuardian, {
          relatedName: "Someone",
          relationship: "guardian",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "not_found" });
      });

      it("invalid_input on relatedPersonId when that person is not visible in this org (existence-oracle narrowing)", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relatedPersonId: orgBActor, // a real person, but not a member of orgA
          relationship: "guardian",
          isEmergencyContact: false,
        });
        expect(result).toEqual({ kind: "invalid_input", field: "relatedPersonId" });
      });

      it("ok inserts a free-text guardian link, fires TENANT_PERSON_RELATIONSHIP_ADDED, and is readable back", async () => {
        const result = await addGuardianLink(rosterHolder, orgA, childNoGuardian, {
          relatedName: "Aunt Wilhelmina",
          relationship: "caregiver",
          isEmergencyContact: true,
          notes: "Picks up on Wednesdays.",
        });
        expect(result.kind).toBe("ok");
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "tenant.person_relationship.added",
            resourceType: "person_relationship",
          }),
        );

        const read = await getGuardianLinksForEdit(rosterHolder, orgA, childNoGuardian);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        const link = read.links.find((l) => l.relatedName === "Aunt Wilhelmina");
        expect(link).toBeTruthy();
        expect(link?.relationship).toBe("caregiver");
        expect(link?.isEmergencyContact).toBe(true);

        // updateGuardianLink / removeGuardianLink exercised against this row.
        const updated = await updateGuardianLink(
          rosterHolder,
          orgA,
          childNoGuardian,
          link!.id,
          {
            relatedName: "Aunt Wilhelmina",
            relationship: "guardian",
            isEmergencyContact: false,
          },
        );
        expect(updated.kind).toBe("ok");
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({ action: "tenant.person_relationship.updated" }),
        );

        const removed = await removeGuardianLink(
          rosterHolder,
          orgA,
          childNoGuardian,
          link!.id,
        );
        expect(removed).toEqual({ kind: "ok" });
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({ action: "tenant.person_relationship.removed" }),
        );

        const afterRemove = await getGuardianLinksForEdit(
          rosterHolder,
          orgA,
          childNoGuardian,
        );
        expect(afterRemove.kind).toBe("ok");
        if (afterRemove.kind !== "ok") return;
        expect(afterRemove.links.some((l) => l.id === link!.id)).toBe(false);
      });
    });

    describe("updateGuardianLink / removeGuardianLink — not_found for an unknown link id", () => {
      it("updateGuardianLink not_found for a link id that doesn't belong to this child", async () => {
        const result = await updateGuardianLink(
          rosterHolder,
          orgA,
          childNoGuardian,
          "00000000-0000-0000-0000-000000000000",
          { relatedName: "X", relationship: "guardian", isEmergencyContact: false },
        );
        expect(result).toEqual({ kind: "not_found" });
      });

      it("removeGuardianLink not_found for a link id that doesn't belong to this child", async () => {
        const result = await removeGuardianLink(
          rosterHolder,
          orgA,
          childNoGuardian,
          "00000000-0000-0000-0000-000000000000",
        );
        expect(result).toEqual({ kind: "not_found" });
      });
    });

    describe("searchLinkablePeople", () => {
      it("forbidden without children.roster", async () => {
        const result = await searchLinkablePeople(grantlessPerson, orgA, "Isolde");
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("returns matches scoped to this org only", async () => {
        const result = await searchLinkablePeople(rosterHolder, orgA, "Sparrowbrook");
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        const ids = result.people.map((p) => p.personId);
        expect(ids).toContain(adultPerson);
        expect(ids).not.toContain(orgBActor);
      });

      it("empty query returns no matches", async () => {
        const result = await searchLinkablePeople(rosterHolder, orgA, "   ");
        expect(result).toEqual({ kind: "ok", people: [] });
      });
    });

    describe("cross-org isolation", () => {
      it("an orgB actor with children.roster at orgB cannot read orgA's roster — withOrgContext rejects (no membership at orgA)", async () => {
        await expect(getChildrenRoster(orgBActor, orgA)).rejects.toThrow(
          /no active membership/,
        );
      });
    });
  },
);
