/**
 * Integration tests for `src/lib/person-sensitive.ts` — Member edit: tiered
 * sensitive information (docs/work-log/2026-08-26-member-sensitive-info.md,
 * DECISION-108). Same harness as `people-update.test.ts`/`org-features.test.ts`:
 * real Postgres, `hasDb` skip-guard, self-contained fixture. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/person-sensitive.test.ts
 *
 * `recordAudit()` is mocked at the module boundary, same posture and same
 * reason as `people-update.test.ts`/`roll.test.ts`/`org-features.test.ts` —
 * `@/lib/audit` transitively imports `@/auth` (next-auth), which this test
 * environment cannot resolve.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TENANT_PERSON_NOTE_ADDED: "tenant.person_note.added",
    TENANT_PERSON_DEMOGRAPHICS_UPDATED: "tenant.person_demographics.updated",
    TENANT_PERSON_MEDICAL_UPDATED: "tenant.person_medical.updated",
    TENANT_PERSON_DISABILITY_SET: "tenant.person_disability.set",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "person-sensitive.ts (Postgres-backed, real dev database)",
  () => {
    let getSensitiveInfoGrants: typeof import("./person-sensitive").getSensitiveInfoGrants;
    let getSensitiveInfoForEdit: typeof import("./person-sensitive").getSensitiveInfoForEdit;
    let addPersonNote: typeof import("./person-sensitive").addPersonNote;
    let setPersonDemographics: typeof import("./person-sensitive").setPersonDemographics;
    let setPersonMedical: typeof import("./person-sensitive").setPersonMedical;
    let setPersonDisabilities: typeof import("./person-sensitive").setPersonDisabilities;

    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let organizationSettings: typeof import("@/lib/db/domain/org").organizationSettings;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
    let ordinations: typeof import("@/lib/db/domain/officers").ordinations;
    let personDemographics: typeof import("@/lib/db/domain/privacy").personDemographics;
    let personDisabilities: typeof import("@/lib/db/domain/privacy").personDisabilities;
    let usersTable: typeof import("@/lib/db/schema").users;

    const stamp = Date.now();

    let orgA: string; // trackDisabilityPerPerson: true
    let orgB: string; // trackDisabilityPerPerson: false (also used for cross-org checks)

    let targetPerson: string; // orgA — the person whose sensitive info is read/written
    let authorUserId: string; // a `users` row for person_notes.authorUserId

    let grantlessPerson: string; // orgA — membership, no grants
    let pastoralClergyPerson: string; // orgA — pastoral_notes.manage + ordained
    let pastoralNonClergyPerson: string; // orgA — pastoral_notes.manage, not ordained
    let demographicsPerson: string; // orgA — demographics.manage only
    let medicalPerson: string; // orgA — medical.manage only
    let disabilitiesPerson: string; // orgA — disabilities.manage only
    let orgBActor: string; // orgB — holds all four keys, at orgB

    const trackedPeopleIds: string[] = [];

    beforeAll(async () => {
      ({
        getSensitiveInfoGrants,
        getSensitiveInfoForEdit,
        addPersonNote,
        setPersonDemographics,
        setPersonMedical,
        setPersonDisabilities,
      } = await import("./person-sensitive"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations, organizationSettings } = await import(
        "@/lib/db/domain/org"
      ));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships } = await import("@/lib/db/domain/people"));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));
      ({ ordinations } = await import("@/lib/db/domain/officers"));
      ({ personDemographics, personDisabilities } = await import(
        "@/lib/db/domain/privacy"
      ));
      ({ users: usersTable } = await import("@/lib/db/schema"));

      const platform = getPlatformDb();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for person-sensitive.test.ts`,
            slug: `person-sensitive-test-${label.toLowerCase()}-${stamp}`,
            path: `person_sensitive_test_${label.toLowerCase()}_${stamp}`,
            platformStatus: "unmanaged",
          })
          .returning({ id: organizations.id });
        return row!.id;
      }
      orgA = await makeOrg("A");
      orgB = await makeOrg("B");

      await platform.insert(organizationSettings).values([
        {
          organizationId: orgA,
          settings: { trackDisabilityPerPerson: true },
        },
        {
          organizationId: orgB,
          settings: { trackDisabilityPerPerson: false },
        },
      ]);

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
            key: "pastoral_notes.manage",
            module: "pastoral",
            description: "Manage pastoral care notes for a person",
            sensitivityTier: 3,
          },
          {
            key: "demographics.manage",
            module: "demographics",
            description: "Manage SASR demographic data for a person",
            sensitivityTier: 3,
          },
          {
            key: "medical.manage",
            module: "medical",
            description: "Manage children's-safety medical info for a person",
            sensitivityTier: 3,
          },
          {
            key: "disabilities.manage",
            module: "disabilities",
            description: "Manage per-person disability records",
            sensitivityTier: 3,
          },
        ])
        .onConflictDoNothing();

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({ firstName: first, lastName: last })
          .returning({ id: people.id });
        trackedPeopleIds.push(p!.id);
        return p!.id;
      }

      targetPerson = await person("Eulalia", `Marchbanks${stamp}`);
      grantlessPerson = await person("Dorian", `Ashcombe${stamp}`);
      pastoralClergyPerson = await person("Rowan", `Thistlewood${stamp}`);
      pastoralNonClergyPerson = await person("Priya", `Balakrishnan${stamp}`);
      demographicsPerson = await person("Tobias", `Renwick${stamp}`);
      medicalPerson = await person("Aldous", `Fennimore${stamp}`);
      disabilitiesPerson = await person("Wren", `Thackeray${stamp}`);
      orgBActor = await person("Hallie", `Vandermeer${stamp}`);

      await platform.insert(memberships).values([
        { organizationId: orgA, personId: targetPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: grantlessPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: pastoralClergyPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: pastoralNonClergyPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: demographicsPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: medicalPerson, engagementStatus: "regular" },
        { organizationId: orgA, personId: disabilitiesPerson, engagementStatus: "regular" },
        { organizationId: orgB, personId: orgBActor, engagementStatus: "regular" },
      ]);

      await platform.insert(ordinations).values({
        organizationId: orgA,
        personId: pastoralClergyPerson,
        ministry: "minister_of_word_and_sacrament",
        ordainedOn: "2000-01-01",
      });

      async function roleWithPermission(
        organizationId: string,
        key: string,
        permissionKeys: string[],
        personId: string,
      ) {
        const [role] = await platform
          .insert(appRoles)
          .values({
            organizationId,
            key,
            name: key,
            roleKind: "custom",
          })
          .returning({ id: appRoles.id });
        await platform.insert(appRolePermissions).values(
          permissionKeys.map((permissionKey) => ({
            roleId: role!.id,
            permissionKey,
          })),
        );
        await platform.insert(roleGrants).values({
          organizationId,
          roleId: role!.id,
          personId,
          startsOn: "2020-01-01",
        });
      }

      await roleWithPermission(
        orgA,
        `pastoral_clergy_${stamp}`,
        ["pastoral_notes.manage"],
        pastoralClergyPerson,
      );
      await roleWithPermission(
        orgA,
        `pastoral_non_clergy_${stamp}`,
        ["pastoral_notes.manage"],
        pastoralNonClergyPerson,
      );
      await roleWithPermission(
        orgA,
        `demographics_${stamp}`,
        ["demographics.manage"],
        demographicsPerson,
      );
      await roleWithPermission(
        orgA,
        `medical_${stamp}`,
        ["medical.manage"],
        medicalPerson,
      );
      await roleWithPermission(
        orgA,
        `disabilities_${stamp}`,
        ["disabilities.manage"],
        disabilitiesPerson,
      );
      await roleWithPermission(
        orgB,
        `org_b_all_${stamp}`,
        [
          "pastoral_notes.manage",
          "demographics.manage",
          "medical.manage",
          "disabilities.manage",
        ],
        orgBActor,
      );

      const [u] = await platform
        .insert(usersTable)
        .values({
          email: `person-sensitive-test-${stamp}@example.invalid`,
          name: "Fixture Author",
        })
        .returning({ id: usersTable.id });
      authorUserId = u!.id;
    });

    afterEach(() => {
      mockRecordAudit.mockClear();
    });

    afterAll(async () => {
      const platform = getPlatformDb();
      // This fixture creates an "Active Membership" derived group, and
      // presby_reject_derived_group_write() correctly refuses to let any
      // connection delete rows in a derived group by cascade. Teardown
      // disables the trigger for that reason only — see roll.test.ts's
      // afterAll for the identical convention against the analogous
      // roll_actions_freeze trigger.
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
      await platform.delete(usersTable).where(eq(usersTable.id, authorUserId));
    });

    describe("getSensitiveInfoGrants", () => {
      it("reflects exactly the permission the viewer holds", async () => {
        expect(await getSensitiveInfoGrants(grantlessPerson, orgA)).toEqual({
          pastoralNotes: false,
          demographics: false,
          medical: false,
          disabilities: false,
        });
        expect(
          await getSensitiveInfoGrants(pastoralClergyPerson, orgA),
        ).toEqual({
          pastoralNotes: true,
          demographics: false,
          medical: false,
          disabilities: false,
        });
        expect(await getSensitiveInfoGrants(medicalPerson, orgA)).toEqual({
          pastoralNotes: false,
          demographics: false,
          medical: true,
          disabilities: false,
        });
      });
    });

    describe("getSensitiveInfoForEdit — enumeration safety (Phase 2)", () => {
      it("forbidden for a viewer holding none of the four permissions", async () => {
        const result = await getSensitiveInfoForEdit(
          grantlessPerson,
          orgA,
          targetPerson,
        );
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found for a person with no membership in this org (cross-org)", async () => {
        const result = await getSensitiveInfoForEdit(
          orgBActor,
          orgB,
          targetPerson,
        );
        expect(result).toEqual({ kind: "not_found" });
      });

      it("an authorized viewer and a denied viewer produce byte-identical shapes for the same person with zero rows", async () => {
        const forbidden = await getSensitiveInfoForEdit(
          grantlessPerson,
          orgA,
          targetPerson,
        );
        // Before anything is written, demographicsPerson's own read is 'ok'
        // with a null section — proving "forbidden" and "authorized + empty"
        // are the only two shapes, never a third leaking existence.
        const authorizedEmpty = await getSensitiveInfoForEdit(
          demographicsPerson,
          orgA,
          targetPerson,
        );
        expect(forbidden).toEqual({ kind: "forbidden" });
        expect(authorizedEmpty.kind).toBe("ok");
        if (authorizedEmpty.kind !== "ok") return;
        expect(authorizedEmpty.data.demographics).toBeNull();
      });
    });

    describe("getSensitiveInfoForEdit — clergy_only visibility filter", () => {
      it("a clergy holder of pastoral_notes.manage sees a clergy_only note; a non-clergy holder does not (omitted, not nulled)", async () => {
        const added = await addPersonNote(
          pastoralClergyPerson,
          orgA,
          authorUserId,
          targetPerson,
          {
            noteType: "pastoral_care",
            visibility: "clergy_only",
            body: "Confidential clergy-only content.",
          },
        );
        expect(added.kind).toBe("ok");

        const clergyView = await getSensitiveInfoForEdit(
          pastoralClergyPerson,
          orgA,
          targetPerson,
        );
        expect(clergyView.kind).toBe("ok");
        if (clergyView.kind !== "ok") return;
        expect(
          clergyView.data.notes?.some((n) => n.visibility === "clergy_only"),
        ).toBe(true);

        const nonClergyView = await getSensitiveInfoForEdit(
          pastoralNonClergyPerson,
          orgA,
          targetPerson,
        );
        expect(nonClergyView.kind).toBe("ok");
        if (nonClergyView.kind !== "ok") return;
        expect(
          nonClergyView.data.notes?.some((n) => n.visibility === "clergy_only"),
        ).toBe(false);
      });
    });

    describe("addPersonNote — server-side length validation (regression for missing server-side length enforcement)", () => {
      it("ok at exactly the 4000-char limit", async () => {
        const body = "a".repeat(4000);
        const result = await addPersonNote(
          pastoralClergyPerson,
          orgA,
          authorUserId,
          targetPerson,
          { noteType: "general", visibility: "staff", body },
        );
        expect(result.kind).toBe("ok");
      });

      it("invalid_input over the 4000-char limit, and writes nothing", async () => {
        const beforeRead = await getSensitiveInfoForEdit(
          pastoralClergyPerson,
          orgA,
          targetPerson,
        );
        expect(beforeRead.kind).toBe("ok");
        if (beforeRead.kind !== "ok") return;
        const countBefore = beforeRead.data.notes?.length ?? 0;

        const body = "a".repeat(4001);
        const result = await addPersonNote(
          pastoralClergyPerson,
          orgA,
          authorUserId,
          targetPerson,
          { noteType: "general", visibility: "staff", body },
        );
        expect(result).toEqual({ kind: "invalid_input", field: "body" });
        expect(mockRecordAudit).not.toHaveBeenCalled();

        const afterRead = await getSensitiveInfoForEdit(
          pastoralClergyPerson,
          orgA,
          targetPerson,
        );
        expect(afterRead.kind).toBe("ok");
        if (afterRead.kind !== "ok") return;
        expect(afterRead.data.notes?.length ?? 0).toBe(countBefore);
      });
    });

    describe("addPersonNote — insert-only", () => {
      it("forbidden without pastoral_notes.manage", async () => {
        const result = await addPersonNote(
          grantlessPerson,
          orgA,
          authorUserId,
          targetPerson,
          { noteType: "general", visibility: "staff", body: "x" },
        );
        expect(result).toEqual({ kind: "forbidden" });
        expect(mockRecordAudit).not.toHaveBeenCalled();
      });

      it("not_found for a person with no membership in this org", async () => {
        const result = await addPersonNote(
          orgBActor,
          orgB,
          authorUserId,
          targetPerson,
          { noteType: "general", visibility: "staff", body: "x" },
        );
        expect(result).toEqual({ kind: "not_found" });
      });

      it("ok inserts a staff-visibility note and fires TENANT_PERSON_NOTE_ADDED", async () => {
        const result = await addPersonNote(
          pastoralClergyPerson,
          orgA,
          authorUserId,
          targetPerson,
          {
            noteType: "visit",
            visibility: "staff",
            body: "Visited on a Tuesday.",
            occurredOn: "2026-08-01",
          },
        );
        expect(result.kind).toBe("ok");
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "tenant.person_note.added",
            resourceType: "person_note",
          }),
        );

        const read = await getSensitiveInfoForEdit(
          pastoralClergyPerson,
          orgA,
          targetPerson,
        );
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(
          read.data.notes?.some((n) => n.body === "Visited on a Tuesday."),
        ).toBe(true);
      });
    });

    describe("setPersonDemographics — upsert", () => {
      it("forbidden without demographics.manage", async () => {
        const result = await setPersonDemographics(grantlessPerson, orgA, targetPerson, {
          gender: "woman",
          racialEthnic: null,
          source: "self",
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("not_found cross-org", async () => {
        const result = await setPersonDemographics(orgBActor, orgB, targetPerson, {
          gender: "woman",
          racialEthnic: null,
          source: "self",
        });
        expect(result).toEqual({ kind: "not_found" });
      });

      it("inserts then updates the same singleton row (upsert), and audits both times", async () => {
        const first = await setPersonDemographics(demographicsPerson, orgA, targetPerson, {
          gender: "woman",
          racialEthnic: ["asian"],
          source: "self",
        });
        expect(first).toEqual({ kind: "ok" });

        const afterFirst = await getSensitiveInfoForEdit(
          demographicsPerson,
          orgA,
          targetPerson,
        );
        expect(afterFirst.kind).toBe("ok");
        if (afterFirst.kind !== "ok") return;
        expect(afterFirst.data.demographics).toEqual({
          gender: "woman",
          racialEthnic: ["asian"],
          source: "self",
        });

        const second = await setPersonDemographics(demographicsPerson, orgA, targetPerson, {
          gender: "non_binary_genderqueer",
          racialEthnic: ["asian", "white"],
          source: "staff",
        });
        expect(second).toEqual({ kind: "ok" });
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "tenant.person_demographics.updated",
          }),
        );

        const afterSecond = await getSensitiveInfoForEdit(
          demographicsPerson,
          orgA,
          targetPerson,
        );
        expect(afterSecond.kind).toBe("ok");
        if (afterSecond.kind !== "ok") return;
        expect(afterSecond.data.demographics).toEqual({
          gender: "non_binary_genderqueer",
          racialEthnic: ["asian", "white"],
          source: "staff",
        });

        const platform = getPlatformDb();
        const rows = await platform
          .select({ personId: personDemographics.personId })
          .from(personDemographics)
          .where(
            and(
              eq(personDemographics.personId, targetPerson),
              eq(personDemographics.organizationId, orgA),
            ),
          );
        expect(rows).toHaveLength(1);
      });
    });

    describe("setPersonDemographics — server-side length validation (regression for missing server-side length enforcement)", () => {
      it("ok at exactly the 2000-char gender limit", async () => {
        const result = await setPersonDemographics(
          demographicsPerson,
          orgA,
          targetPerson,
          { gender: "g".repeat(2000), racialEthnic: null, source: "self" },
        );
        expect(result).toEqual({ kind: "ok" });
      });

      it("invalid_input over the 2000-char gender limit, and writes nothing", async () => {
        const beforeRead = await getSensitiveInfoForEdit(
          demographicsPerson,
          orgA,
          targetPerson,
        );
        expect(beforeRead.kind).toBe("ok");
        if (beforeRead.kind !== "ok") return;
        const genderBefore = beforeRead.data.demographics?.gender ?? null;

        const result = await setPersonDemographics(
          demographicsPerson,
          orgA,
          targetPerson,
          { gender: "g".repeat(2001), racialEthnic: null, source: "self" },
        );
        expect(result).toEqual({ kind: "invalid_input", field: "gender" });
        expect(mockRecordAudit).not.toHaveBeenCalled();

        const afterRead = await getSensitiveInfoForEdit(
          demographicsPerson,
          orgA,
          targetPerson,
        );
        expect(afterRead.kind).toBe("ok");
        if (afterRead.kind !== "ok") return;
        expect(afterRead.data.demographics?.gender ?? null).toBe(
          genderBefore,
        );
      });
    });

    describe("setPersonMedical — upsert", () => {
      it("forbidden without medical.manage", async () => {
        const result = await setPersonMedical(grantlessPerson, orgA, targetPerson, {
          allergies: "peanuts",
          medicalNotes: null,
          medications: null,
          authorizedPickup: null,
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("ok upserts and is readable back", async () => {
        const result = await setPersonMedical(medicalPerson, orgA, targetPerson, {
          allergies: "peanuts",
          medicalNotes: "carries an EpiPen",
          medications: null,
          authorizedPickup: "Grandmother only",
        });
        expect(result).toEqual({ kind: "ok" });
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({ action: "tenant.person_medical.updated" }),
        );

        const read = await getSensitiveInfoForEdit(medicalPerson, orgA, targetPerson);
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") return;
        expect(read.data.medical).toEqual({
          allergies: "peanuts",
          medicalNotes: "carries an EpiPen",
          medications: null,
          authorizedPickup: "Grandmother only",
        });
      });
    });

    describe("setPersonMedical — server-side length validation (regression for missing server-side length enforcement)", () => {
      it("ok at exactly the 4000-char limit on every free-text field", async () => {
        const result = await setPersonMedical(medicalPerson, orgA, targetPerson, {
          allergies: "a".repeat(4000),
          medicalNotes: "b".repeat(4000),
          medications: "c".repeat(4000),
          authorizedPickup: "d".repeat(4000),
        });
        expect(result).toEqual({ kind: "ok" });
      });

      it("invalid_input when a single field exceeds the 4000-char limit, and writes nothing", async () => {
        const beforeRead = await getSensitiveInfoForEdit(
          medicalPerson,
          orgA,
          targetPerson,
        );
        expect(beforeRead.kind).toBe("ok");
        if (beforeRead.kind !== "ok") return;
        const before = beforeRead.data.medical ?? null;

        const result = await setPersonMedical(medicalPerson, orgA, targetPerson, {
          allergies: "a".repeat(4000),
          medicalNotes: "b".repeat(4001), // over the limit
          medications: null,
          authorizedPickup: null,
        });
        expect(result).toEqual({ kind: "invalid_input", field: "medicalNotes" });
        expect(mockRecordAudit).not.toHaveBeenCalled();

        const afterRead = await getSensitiveInfoForEdit(
          medicalPerson,
          orgA,
          targetPerson,
        );
        expect(afterRead.kind).toBe("ok");
        if (afterRead.kind !== "ok") return;
        expect(afterRead.data.medical ?? null).toEqual(before);
      });
    });

    describe("setPersonDisabilities — set-replace", () => {
      it("forbidden without disabilities.manage", async () => {
        const result = await setPersonDisabilities(grantlessPerson, orgA, targetPerson, {
          categories: ["hearing"],
        });
        expect(result).toEqual({ kind: "forbidden" });
      });

      it("tracking_disabled when the org has trackDisabilityPerPerson off", async () => {
        const result = await setPersonDisabilities(orgBActor, orgB, orgBActor, {
          categories: ["hearing"],
        });
        expect(result).toEqual({ kind: "tracking_disabled" });
      });

      it("ok replaces the whole category set in one transaction", async () => {
        const first = await setPersonDisabilities(
          disabilitiesPerson,
          orgA,
          targetPerson,
          { categories: ["hearing", "mobility"] },
        );
        expect(first).toEqual({ kind: "ok" });
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({ action: "tenant.person_disability.set" }),
        );

        const afterFirst = await getSensitiveInfoForEdit(
          disabilitiesPerson,
          orgA,
          targetPerson,
        );
        expect(afterFirst.kind).toBe("ok");
        if (afterFirst.kind !== "ok") return;
        expect(afterFirst.data.disabilities?.sort()).toEqual([
          "hearing",
          "mobility",
        ]);

        const second = await setPersonDisabilities(
          disabilitiesPerson,
          orgA,
          targetPerson,
          { categories: ["sight"] },
        );
        expect(second).toEqual({ kind: "ok" });

        const afterSecond = await getSensitiveInfoForEdit(
          disabilitiesPerson,
          orgA,
          targetPerson,
        );
        expect(afterSecond.kind).toBe("ok");
        if (afterSecond.kind !== "ok") return;
        expect(afterSecond.data.disabilities).toEqual(["sight"]);

        const platform = getPlatformDb();
        const rows = await platform
          .select({ category: personDisabilities.category })
          .from(personDisabilities)
          .where(
            and(
              eq(personDisabilities.personId, targetPerson),
              eq(personDisabilities.organizationId, orgA),
            ),
          );
        expect(rows.map((r) => r.category)).toEqual(["sight"]);
      });
    });
  },
);
