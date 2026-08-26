/**
 * Integration tests for `updatePerson()`/`getPersonForEdit()` in
 * src/lib/people.ts — Increment 2 (docs/work-log/2026-08-26-member-
 * management-edit-person.md). Same harness as `people.test.ts`: real
 * Postgres, `hasDb` skip-guard, self-contained fixture. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/people-update.test.ts
 *
 * `recordAudit()` is mocked at the module boundary, same posture and same
 * reason as `roll.test.ts`/`org-features.test.ts` — `@/lib/audit`
 * transitively imports `@/auth` (next-auth), which this test environment
 * cannot resolve.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { PERSON_UPDATED: "tenant.person.updated" },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "people.ts updatePerson/getPersonForEdit (Postgres-backed, real dev database)",
  () => {
    let updatePerson: typeof import("./people").updatePerson;
    let getPersonForEdit: typeof import("./people").getPersonForEdit;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let households: typeof import("@/lib/db/domain/people").households;
    let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
    let addresses: typeof import("@/lib/db/domain/people").addresses;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;

    const stamp = Date.now();

    let orgA: string;
    let orgB: string;

    let editorPerson: string; // orgA — holds people.manage
    let grantlessPerson: string; // orgA — membership, no grants at all

    let targetPerson: string; // orgA — the person being edited
    let householdA1: string;
    let householdA2: string; // a second orgA household, for the "existing" reassignment case
    let householdOrgB: string; // cross-org, for invalid_household

    const trackedPeopleIds: string[] = [];

    beforeAll(async () => {
      ({ updatePerson, getPersonForEdit } = await import("./people"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, households, contactMethods, addresses } =
        await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));

      const platform = getPlatformDb();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for people-update.test.ts`,
            slug: `people-update-test-${label.toLowerCase()}-${stamp}`,
            path: `people_update_test_${label.toLowerCase()}_${stamp}`,
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
        .values({
          key: "people.manage",
          module: "people",
          description:
            "Create and edit people, households, and contact/address detail",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();

      const [editorRole] = await platform
        .insert(appRoles)
        .values({
          organizationId: orgA,
          key: "member_editor",
          name: "Member Editor",
          roleKind: "custom",
        })
        .returning({ id: appRoles.id });
      await platform
        .insert(appRolePermissions)
        .values({ roleId: editorRole!.id, permissionKey: "people.manage" });

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        trackedPeopleIds.push(p!.id);
        return p!.id;
      }

      editorPerson = await person("Cassandra", `Wrenfield${stamp}`);
      grantlessPerson = await person("Dorian", `Ashcombe${stamp}`);
      targetPerson = await person("Eulalia", `Marchbanks${stamp}`);

      const [hh1] = await platform
        .insert(households)
        .values({ organizationId: orgA, name: `Fixture Household A1 ${stamp}` })
        .returning({ id: households.id });
      householdA1 = hh1!.id;
      const [hh2] = await platform
        .insert(households)
        .values({ organizationId: orgA, name: `Fixture Household A2 ${stamp}` })
        .returning({ id: households.id });
      householdA2 = hh2!.id;
      const [hhB] = await platform
        .insert(households)
        .values({ organizationId: orgB, name: `Fixture Household B ${stamp}` })
        .returning({ id: households.id });
      householdOrgB = hhB!.id;

      await platform.insert(memberships).values([
        { organizationId: orgA, personId: editorPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: grantlessPerson, engagementStatus: "regular" },
        {
          organizationId: orgA,
          personId: targetPerson,
          engagementStatus: "regular",
          householdId: householdA1,
        },
      ]);

      await platform.insert(roleGrants).values({
        organizationId: orgA,
        roleId: editorRole!.id,
        personId: editorPerson,
        startsOn: "2020-01-01",
      });

      await platform.insert(contactMethods).values({
        personId: targetPerson,
        kind: "email",
        value: `eulalia-original-${stamp}@example.invalid`,
        isPrimary: true,
      });
      await platform.insert(addresses).values({
        personId: targetPerson,
        addressType: "home",
        line1: "1 Original Lane",
        city: "Original City",
        isPrimary: true,
      });
    });

    afterEach(() => {
      mockRecordAudit.mockClear();
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      await platform.delete(organizations).where(eq(organizations.id, orgA));
      await platform.delete(organizations).where(eq(organizations.id, orgB));
      for (const id of trackedPeopleIds) {
        await platform.delete(people).where(eq(people.id, id));
      }
    });

    describe("getPersonForEdit", () => {
      it("forbidden without people.manage", async () => {
        const result = await getPersonForEdit(grantlessPerson, orgA, targetPerson);
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found for a person with no membership in this org", async () => {
        const platform = getPlatformDb();
        const [stranger] = await platform
          .insert(people)
          .values({ firstName: "Stray", lastName: `Elsewhere${stamp}` })
          .returning({ id: people.id });
        trackedPeopleIds.push(stranger!.id);

        const result = await getPersonForEdit(editorPerson, orgA, stranger!.id);
        expect(result).toEqual({ kind: "not_found" });
      });

      it("returns the person's current identity, contact, address, and household", async () => {
        const result = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.person.firstName).toBe("Eulalia");
        expect(result.person.lastName).toBe(`Marchbanks${stamp}`);
        expect(result.person.email).toBe(`eulalia-original-${stamp}@example.invalid`);
        expect(result.person.address?.line1).toBe("1 Original Lane");
        expect(result.person.householdId).toBe(householdA1);
      });
    });

    describe("updatePerson", () => {
      it("forbidden without people.manage", async () => {
        const result = await updatePerson(grantlessPerson, orgA, {
          personId: targetPerson,
          identity: { firstName: "X", lastName: "Y" },
          contact: {},
          household: { mode: "none" },
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found for a person with no membership in this org", async () => {
        const platform = getPlatformDb();
        const [stranger] = await platform
          .insert(people)
          .values({ firstName: "Stray2", lastName: `Elsewhere2${stamp}` })
          .returning({ id: people.id });
        trackedPeopleIds.push(stranger!.id);

        const result = await updatePerson(editorPerson, orgA, {
          personId: stranger!.id,
          identity: { firstName: "X", lastName: "Y" },
          contact: {},
          household: { mode: "none" },
        });
        expect(result).toEqual({ kind: "not_found" });
      });

      it("invalid_household for a household belonging to another org", async () => {
        const result = await updatePerson(editorPerson, orgA, {
          personId: targetPerson,
          identity: { firstName: "Eulalia", lastName: `Marchbanks${stamp}` },
          contact: {},
          household: { mode: "existing", householdId: householdOrgB },
        });
        expect(result).toEqual({ kind: "invalid_household" });
      });

      it("updates identity, contact, address, and reassigns the household — read back correctly, and writes an audit event", async () => {
        const result = await updatePerson(editorPerson, orgA, {
          personId: targetPerson,
          identity: {
            firstName: "Eulalia",
            lastName: `Marchbanks${stamp}`,
            preferredName: "Lali",
          },
          contact: {
            email: `eulalia-updated-${stamp}@example.invalid`,
            phone: "555-0100",
          },
          address: { line1: "2 Updated Way", city: "Updated City" },
          household: { mode: "existing", householdId: householdA2 },
        });
        expect(result).toEqual({ kind: "ok" });

        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.preferredName).toBe("Lali");
        expect(read.person.email).toBe(`eulalia-updated-${stamp}@example.invalid`);
        expect(read.person.phone).toBe("555-0100");
        expect(read.person.address?.line1).toBe("2 Updated Way");
        expect(read.person.householdId).toBe(householdA2);

        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "tenant.person.updated",
            resourceId: targetPerson,
          }),
        );
      });

      it("clearing contact fields deletes the primary contact method rows rather than leaving stale values", async () => {
        await updatePerson(editorPerson, orgA, {
          personId: targetPerson,
          identity: { firstName: "Eulalia", lastName: `Marchbanks${stamp}` },
          contact: {},
          household: { mode: "none" },
        });

        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.email).toBeNull();
        expect(read.person.phone).toBeNull();
        expect(read.person.householdId).toBeNull();

        const platform = getPlatformDb();
        const remaining = await platform
          .select({ id: contactMethods.id })
          .from(contactMethods)
          .where(eq(contactMethods.personId, targetPerson));
        expect(remaining).toHaveLength(0);
      });

      it("household mode 'new' creates a household in this org and attaches it", async () => {
        const result = await updatePerson(editorPerson, orgA, {
          personId: targetPerson,
          identity: { firstName: "Eulalia", lastName: `Marchbanks${stamp}` },
          contact: {},
          household: { mode: "new", name: `Fixture Household A3 ${stamp}` },
        });
        expect(result).toEqual({ kind: "ok" });

        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.householdId).not.toBeNull();
        expect(read.person.householdId).not.toBe(householdA1);

        const platform = getPlatformDb();
        const [newHousehold] = await platform
          .select({ organizationId: households.organizationId })
          .from(households)
          .where(eq(households.id, read.person.householdId!))
          .limit(1);
        expect(newHousehold?.organizationId).toBe(orgA);
        // No manual cleanup needed: this household cascades away with orgA
        // in afterAll, same as householdA1/A2 — deleting it here first would
        // hit memberships_household_fk while targetPerson's membership still
        // points at it.
      });

      it("a person edited from orgB's own context is not_found (RLS-scoped, not app-level trust)", async () => {
        const platform = getPlatformDb();
        const [orgBEditor] = await platform
          .insert(people)
          .values({ firstName: "OrgB", lastName: `Editor${stamp}` })
          .returning({ id: people.id });
        trackedPeopleIds.push(orgBEditor!.id);
        const [orgBRole] = await platform
          .insert(appRoles)
          .values({
            organizationId: orgB,
            key: "member_editor_b",
            name: "Member Editor B",
            roleKind: "custom",
          })
          .returning({ id: appRoles.id });
        await platform
          .insert(appRolePermissions)
          .values({ roleId: orgBRole!.id, permissionKey: "people.manage" });
        await platform.insert(memberships).values({
          organizationId: orgB,
          personId: orgBEditor!.id,
          engagementStatus: "regular",
        });
        await platform.insert(roleGrants).values({
          organizationId: orgB,
          roleId: orgBRole!.id,
          personId: orgBEditor!.id,
          startsOn: "2020-01-01",
        });

        const result = await updatePerson(orgBEditor!.id, orgB, {
          personId: targetPerson,
          identity: { firstName: "Hijacked", lastName: "Name" },
          contact: {},
          household: { mode: "none" },
        });
        expect(result).toEqual({ kind: "not_found" });

        // Confirm the cross-org attempt genuinely wrote nothing.
        const read = await getPersonForEdit(editorPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.person.firstName).toBe("Eulalia");
      });
    });
  },
);
