/**
 * Integration tests for src/lib/people.ts — run against a REAL Postgres
 * connection, not mocked. Same harness as `role-grants.test.ts`/`directory.
 * test.ts`: the `hasDb` skip-guard, dynamic imports inside `beforeAll`, a
 * self-contained fixture created and torn down per file. `npm test` in CI
 * does not set DATABASE_URL, so this whole suite is SKIPPED there, not
 * failed. Run for real with:
 *   dotenv -e .env.local -- vitest run src/lib/people.test.ts
 *
 * TWO ORGANIZATIONS, deliberately:
 *   orgA  the fixture under test — matchPerson/createPerson run here.
 *   orgB  exists ONLY to give `elsewherePerson` a real membership somewhere
 *         other than orgA (the `existing_member_elsewhere` case) and to
 *         hold a real household `createPerson`'s own `invalid_household`
 *         case can point at cross-org.
 *
 * `recordAudit()` is mocked at the module boundary (Increment 2's
 * `updatePerson()` made `people.ts` import `@/lib/audit` for the first
 * time) — same posture and same reason as `roll.test.ts`/
 * `org-features.test.ts`: `@/lib/audit` transitively imports `@/auth`
 * (next-auth), which this test environment cannot resolve.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, and, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { PERSON_UPDATED: "tenant.person.updated" },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("people.ts (Postgres-backed, real dev database)", () => {
  let matchPerson: typeof import("./people").matchPerson;
  let createPerson: typeof import("./people").createPerson;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let households: typeof import("@/lib/db/domain/people").households;
  let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
  let addresses: typeof import("@/lib/db/domain/people").addresses;
  let personIdentifiers: typeof import("@/lib/db/domain/people").personIdentifiers;
  let rollActions: typeof import("@/lib/db/domain/roll").rollActions;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let users: typeof import("@/lib/db/schema").users;

  const stamp = Date.now();

  let orgA: string;
  let orgB: string;

  let managerPerson: string; // orgA — holds BOTH people.manage and roll.propose
  let onlyPeopleManagePerson: string; // orgA — people.manage ONLY, no roll.propose
  let grantingUserId: string; // a users.id for proposedBy/actingUserId

  // DECISION-128/129 (rollAction.kind "none") fixture.
  let directoryViewerPerson: string; // orgA — holds directory.view ONLY, used to
  // read getDirectory()/findPersonMatches() in the DECISION-129 regression
  // tests below — deliberately NOT people.manage/roll.propose, so these
  // tests exercise the SAME two eligibility predicates a real congregation
  // member browsing the directory would.

  let elsewherePerson: string; // GLOBAL — has a membership at orgB, none at orgA
  let freeAgentPerson: string; // GLOBAL — no membership anywhere
  let freeAgentPerson2: string; // GLOBAL — no membership anywhere (invalid_household case)
  let freeAgentPerson3: string; // GLOBAL — no membership anywhere (rollback case)

  let householdOrgB: string; // for the cross-org invalid_household case

  // matchPerson fixture
  let exactMatchPerson: string; // has a verified, unshared email identifier
  let multiA: string; // shares a name with multiB, no identifiers, no DOB
  let multiB: string;

  const trackedPeopleIds: string[] = [];

  beforeAll(async () => {
    ({ matchPerson, createPerson } = await import("./people"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({
      people,
      memberships,
      households,
      contactMethods,
      addresses,
      personIdentifiers,
    } = await import("@/lib/db/domain/people"));
    ({ rollActions } = await import("@/lib/db/domain/roll"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ users } = await import("@/lib/db/schema"));

    const platform = getPlatformDb();

    async function makeOrg(label: string) {
      const [row] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for people.test.ts`,
          slug: `people-test-${label.toLowerCase()}-${stamp}`,
          path: `people_test_${label.toLowerCase()}_${stamp}`,
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
      const [row] = await platform
        .insert(groups)
        .values({
          organizationId,
          groupTypeId,
          name: "Active Membership",
          membershipSource: "derived",
          derivedFrom: "active_membership",
          isProtected: true,
        })
        .returning({ id: groups.id });
      return row!.id;
    }
    await activeMembershipGroup(orgA);
    await activeMembershipGroup(orgB);

    await platform
      .insert(permissions)
      .values([
        {
          key: "people.manage",
          module: "people",
          description: "Create and edit people, households, and contact/address detail",
          sensitivityTier: 1,
        },
        {
          key: "roll.propose",
          module: "roll",
          description: "Propose a roll action",
          sensitivityTier: 1,
        },
      ])
      .onConflictDoNothing();

    const [fullRole] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "member_manager",
        name: "Member Manager",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform.insert(appRolePermissions).values([
      { roleId: fullRole!.id, permissionKey: "people.manage" },
      { roleId: fullRole!.id, permissionKey: "roll.propose" },
    ]);

    const [narrowRole] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "people_manager_only",
        name: "People Manager (no roll.propose)",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: narrowRole!.id, permissionKey: "people.manage" });

    // DECISION-128/129 fixture: directory.view, and a role/grant holding it
    // ONLY — used by the "rollAction.kind 'none'" regression tests below to
    // read getDirectory()/findPersonMatches() the same way an ordinary
    // congregation member would.
    await platform
      .insert(permissions)
      .values({
        key: "directory.view",
        module: "directory",
        description: "Browse the congregation directory",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();
    const [directoryViewerRole] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "directory_viewer_test",
        name: "Directory Viewer (test)",
        roleKind: "custom",
      })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values({ roleId: directoryViewerRole!.id, permissionKey: "directory.view" });

    async function person(first: string, last: string, dob: string | null = null) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last, dateOfBirth: dob })
        .returning({ id: people.id });
      trackedPeopleIds.push(p!.id);
      return p!.id;
    }

    managerPerson = await person("Wilhelmina", `Castellan${stamp}`);
    onlyPeopleManagePerson = await person("Barnaby", `Ferrers${stamp}`);
    directoryViewerPerson = await person("Perpetua", `Underhill${stamp}`);
    elsewherePerson = await person("Guinevere", `Applewhite${stamp}`);
    freeAgentPerson = await person("Ottoline", `Brackenridge${stamp}`);
    freeAgentPerson2 = await person("Percival", `Ashworth${stamp}`);
    freeAgentPerson3 = await person("Rosalind", `Thistlewaite${stamp}`);
    exactMatchPerson = await person("Peregrine", `Vantongeren${stamp}`);
    multiA = await person(`SharedName${stamp}`, "Thorncastle");
    multiB = await person(`SharedName${stamp}`, "Thorncastle");

    await platform.insert(memberships).values([
      { organizationId: orgA, personId: managerPerson, engagementStatus: "regular" },
      { organizationId: orgA, personId: onlyPeopleManagePerson, engagementStatus: "regular" },
      { organizationId: orgA, personId: directoryViewerPerson, engagementStatus: "regular" },
      { organizationId: orgB, personId: elsewherePerson, engagementStatus: "regular" },
    ]);

    await platform.insert(roleGrants).values([
      {
        organizationId: orgA,
        roleId: fullRole!.id,
        personId: managerPerson,
        startsOn: "2020-01-01",
      },
      {
        organizationId: orgA,
        roleId: narrowRole!.id,
        personId: onlyPeopleManagePerson,
        startsOn: "2020-01-01",
      },
      {
        organizationId: orgA,
        roleId: directoryViewerRole!.id,
        personId: directoryViewerPerson,
        startsOn: "2020-01-01",
      },
    ]);

    const [u] = await platform
      .insert(users)
      .values({
        email: `people-test-${stamp}@example.invalid`,
        name: "Fixture Proposer",
      })
      .returning({ id: users.id });
    grantingUserId = u!.id;

    const [hhB] = await platform
      .insert(households)
      .values({ organizationId: orgB, name: `Fixture Household B ${stamp}` })
      .returning({ id: households.id });
    householdOrgB = hhB!.id;

    await platform.insert(personIdentifiers).values({
      personId: exactMatchPerson,
      kind: "email",
      valueNormalized: `exact-${stamp}@example.invalid`,
      isVerified: true,
      isShared: false,
    });
  });

  afterAll(async () => {
    const platform = getPlatformDb();
    // roll_actions FIRST, explicitly — `roll_actions_person_fk` composite-
    // FKs onto `memberships(personId, organizationId)` with NO onDelete
    // cascade (it is a real per-row FK, not just "belongs to this org"),
    // so cascading `organizations` can delete a `memberships` row before
    // its `roll_actions` row in the same statement and hit that FK's
    // RESTRICT — exactly the ordering hazard `directory.test.ts`'s own
    // `afterAll` comment documents for `person_privacy`. households and
    // memberships DO cascade cleanly from `organizations`. people last,
    // since nothing above references it once its org-scoped rows are gone;
    // contact_methods/addresses/person_identifiers cascade from people.id
    // directly.
    //
    // SECOND, INDEPENDENT SCHEMA DEFECT — FIXED, see `drizzle/
    // 0028_presby_people_write_rls_fix.sql`. `roll_actions_freeze`
    // (`presby_freeze_approved_roll_action`) used to unconditionally
    // `return new` on its `BEFORE DELETE` path — always NULL on a DELETE —
    // so `DELETE` silently no-op'd regardless of `approval_status`,
    // including a `pending` row (invariant 4's own text calls those
    // "mutable working state"). Every `roll_actions` row THIS file creates
    // stays `pending` (createPerson() never approves/denies), so a plain
    // DELETE would now succeed with the trigger left enabled — the
    // disable/enable wrapper below is kept only as defensive belt-and-
    // braces in case a future test in this file approves a row, matching
    // `roll.test.ts`'s own teardown, which genuinely still needs it.
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      await platform.delete(rollActions).where(eq(rollActions.organizationId, orgA));
      await platform.delete(rollActions).where(eq(rollActions.organizationId, orgB));
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
    }
    // drizzle/0033's group_memberships_reject_derived trigger now (DECISION-
    // 110) also rejects the DELETE that cascading `organizations` fires
    // against this fixture's own active_membership-derived group_memberships
    // rows — disable it around the cascade, same pattern as roll_actions_freeze
    // above.
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
    // createPerson's own "new identity" tests insert additional people rows
    // this array never tracked — sweep by the stamped surname instead.
    await platform.delete(people).where(eq(people.lastName, `NewPerson${stamp}`));
    // rollAction.kind "none" (DECISION-128/129) tests' own "new identity"
    // people rows — same sweep-by-surname reasoning as NewPerson above.
    await platform.delete(people).where(eq(people.lastName, `StaffOnly${stamp}`));
    await platform.delete(people).where(eq(people.lastName, `StaffDirectoryLeak${stamp}`));
    await platform.delete(people).where(eq(people.lastName, `StaffFindPersonLeak${stamp}`));
    await platform.delete(users).where(eq(users.id, grantingUserId));
  });

  // ---------------------------------------------------------------------
  // matchPerson
  // ---------------------------------------------------------------------

  describe("matchPerson", () => {
    it("forbidden without people.manage", async () => {
      // freeAgentPerson holds no grant at all, but withOrgContext requires
      // an active membership at the org being queried — use onlyPeopleManagePerson
      // instead? No: that person DOES hold people.manage. Use a person with
      // a membership but zero grants: reuse elsewherePerson is wrong (no
      // orgA membership). Insert a bare membership for this one check.
      const platform = getPlatformDb();
      const [bare] = await platform
        .insert(people)
        .values({ firstName: "Bare", lastName: `Grantless${stamp}` })
        .returning({ id: people.id });
      trackedPeopleIds.push(bare!.id);
      await platform
        .insert(memberships)
        .values({ organizationId: orgA, personId: bare!.id, engagementStatus: "regular" });

      const result = await matchPerson(bare!.id, orgA, {
        lastName: "Vantongeren",
        firstName: "Peregrine",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("no match returns an empty candidate list", async () => {
      const result = await matchPerson(managerPerson, orgA, {
        lastName: `NoSuchSurname${stamp}`,
        firstName: `NoSuchFirst${stamp}`,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.candidates).toEqual([]);
    });

    it("an exact, verified identifier match returns 'exact' confidence, minimal disclosure", async () => {
      const result = await matchPerson(managerPerson, orgA, {
        lastName: "someone-else-entirely",
        firstName: "someone-else-entirely",
        identifiers: [{ kind: "email", value: `EXACT-${stamp}@example.invalid` }],
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.candidates).toHaveLength(1);
      const candidate = result.candidates[0]!;
      expect(candidate.personId).toBe(exactMatchPerson);
      expect(candidate.confidence).toBe("exact");
      expect(candidate.displayName).toBe(`P. Vantongeren${stamp}`);
      // Minimal disclosure — no other keys on the candidate.
      expect(Object.keys(candidate).sort()).toEqual(
        ["confidence", "displayName", "personId"].sort(),
      );
    });

    it("a shared name with no distinguishing identifier returns multiple low-confidence candidates", async () => {
      const result = await matchPerson(managerPerson, orgA, {
        lastName: "Thorncastle",
        firstName: `SharedName${stamp}`,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const ids = result.candidates.map((c) => c.personId).sort();
      expect(ids).toEqual([multiA, multiB].sort());
      for (const candidate of result.candidates) {
        expect(candidate.confidence).toBe("low");
      }
    });
  });

  // ---------------------------------------------------------------------
  // createPerson
  // ---------------------------------------------------------------------

  describe("createPerson", () => {
    it("forbidden without people.manage AND roll.propose (holds only people.manage)", async () => {
      const result = await createPerson(
        onlyPeopleManagePerson,
        orgA,
        grantingUserId,
        {
          identity: {
            mode: "new",
            firstName: "Should",
            lastName: `NeverExist${stamp}`,
          },
          contact: {},
          household: { mode: "none" },
          rollAction: { kind: "profession_of_faith", effectiveDate: "2026-01-01" },
        },
      );
      expect(result).toEqual({ kind: "forbidden" });

      const platform = getPlatformDb();
      const [orphan] = await platform
        .select({ id: people.id })
        .from(people)
        .where(eq(people.lastName, `NeverExist${stamp}`))
        .limit(1);
      expect(orphan).toBeUndefined();
    });

    /**
     * RESTORED — was pinned as a real (not skipped) BLOCKED test asserting
     * the broken behavior, because the schema had a genuine defect (see
     * `drizzle/0028_presby_people_write_rls_fix.sql` and this pipeline's
     * Phase 4 "Two schema-layer findings" work-log entry for the full
     * writeup): `people`'s RLS policy had no explicit WITH CHECK, so it
     * defaulted to reusing the USING clause for writes — which requires an
     * EXISTING membership referencing the row, impossible by construction
     * for a brand-new person. Fixed by splitting the policy into
     * command-scoped policies with a SECURITY DEFINER-backed INSERT check.
     *
     * `createPerson()` ALSO changed shape here, not just the schema: the
     * `people` insert no longer uses `.returning({ id: people.id })`. A
     * freshly-inserted, not-yet-linked person is (correctly) invisible
     * under the fixed SELECT policy too, and Postgres enforces the SELECT
     * policy on the rows an `INSERT ... RETURNING` clause hands back — so
     * RETURNING itself failed even once the WITH CHECK was fixed. The id
     * is generated client-side (`randomUUID()`) instead and passed
     * explicitly, sidestepping the need to read the row back at all. This
     * test's assertions below prove the full happy path against THAT
     * shape: all four rows land, in FK order (people/addresses/
     * contact_methods → households → memberships → roll_actions), and the
     * new person is visible (via `getPlatformDb()`, an independent
     * connection) once written.
     */
    it("identity.mode 'new' happy path creates the person, contact detail, address, household, membership, and pending roll action", async () => {
      const result = await createPerson(managerPerson, orgA, grantingUserId, {
        identity: {
          mode: "new",
          firstName: "Fresh",
          lastName: `NewPerson${stamp}`,
          dateOfBirth: "1990-06-15",
        },
        contact: { email: `fresh-${stamp}@example.invalid`, phone: "555-0142" },
        address: { line1: "1 Fixture Way", city: "Fixtureville", region: "OH", postalCode: "00000" },
        household: { mode: "new", name: `The Fresh Household ${stamp}` },
        rollAction: {
          kind: "profession_of_faith",
          effectiveDate: "2026-01-01",
          minuteReference: "Session 2026-01-01, item 3",
        },
      });
      expect(result).toEqual({
        kind: "ok",
        personId: expect.any(String),
        rollActionId: expect.any(String),
      });
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();

      const [personRow] = await platform
        .select()
        .from(people)
        .where(eq(people.id, result.personId));
      expect(personRow).toMatchObject({
        firstName: "Fresh",
        lastName: `NewPerson${stamp}`,
        dateOfBirth: "1990-06-15",
      });

      const contactRows = await platform
        .select({ kind: contactMethods.kind, value: contactMethods.value })
        .from(contactMethods)
        .where(eq(contactMethods.personId, result.personId));
      expect(contactRows.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
        { kind: "email", value: `fresh-${stamp}@example.invalid` },
        { kind: "phone", value: "555-0142" },
      ]);

      const [addressRow] = await platform
        .select({ line1: addresses.line1, city: addresses.city })
        .from(addresses)
        .where(eq(addresses.personId, result.personId));
      expect(addressRow).toEqual({ line1: "1 Fixture Way", city: "Fixtureville" });

      const [membershipRow] = await platform
        .select({ householdId: memberships.householdId })
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, result.personId),
            eq(memberships.organizationId, orgA),
          ),
        );
      expect(membershipRow?.householdId).toEqual(expect.any(String));

      const [householdRow] = await platform
        .select({ name: households.name })
        .from(households)
        .where(eq(households.id, membershipRow!.householdId!));
      expect(householdRow?.name).toBe(`The Fresh Household ${stamp}`);

      // Non-null by construction for this rollAction kind — proven by the
      // `toEqual({ ..., rollActionId: expect.any(String) })` assertion
      // above. `CreatePersonResult["ok"].rollActionId` is `string | null` on
      // the type itself because the SAME field also serves the
      // `rollAction.kind === "none"` staff-hiring caller (DECISION-128/129),
      // which returns `null`.
      const [rollActionRow] = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.id, result.rollActionId!));
      expect(rollActionRow).toMatchObject({
        organizationId: orgA,
        personId: result.personId,
        kind: "profession_of_faith",
        approvalStatus: "pending",
        minuteReference: "Session 2026-01-01, item 3",
        proposedBy: grantingUserId,
      });
    });

    /**
     * REGRESSION PIN — the exact vandalism shape a naive (non-SECURITY-
     * DEFINER) first draft of the RLS fix above silently allowed, caught
     * only by running it (see `drizzle/0028_presby_people_write_rls_fix.
     * sql`'s own comment and `scripts/test-rls.sql` section 20b). Proven
     * here at the RAW SQL layer, through the SAME RLS-enforced connection
     * `createPerson()` itself writes through (`withOrgContext`, not
     * `getPlatformDb()`) — an org with NO relationship to `elsewherePerson`
     * (who holds a real membership at orgB) must not be able to attach an
     * address to them. `createPerson()` itself has no call shape that could
     * even attempt this (identity.mode 'existing' never inserts sibling
     * rows), so this is a schema-floor guarantee, not a path this module's
     * own tests otherwise exercise.
     */
    it("RLS still rejects an address insert scoped to a person with no relationship to the acting org", async () => {
      const { withOrgContext } = await import("@/lib/authz");

      let caught: unknown;
      try {
        await withOrgContext(managerPerson, orgA, async (tx) => {
          await tx.execute(sql`
            insert into addresses (person_id, address_type, line1)
            values (${elsewherePerson}::uuid, 'home', 'Should Never Be Written')
          `);
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const chain =
        caught instanceof Error
          ? [caught.message, (caught.cause as Error | undefined)?.message]
              .filter(Boolean)
              .join(" :: ")
          : String(caught);
      expect(chain).toMatch(/row-level security policy for table "addresses"/);

      const platform = getPlatformDb();
      const rows = await platform
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.personId, elsewherePerson));
      expect(rows).toEqual([]);
    });

    it("existing-identity-clear happy path attaches a globally unaffiliated person", async () => {
      const result = await createPerson(managerPerson, orgA, grantingUserId, {
        identity: { mode: "existing", matchedPersonId: freeAgentPerson },
        contact: {},
        household: { mode: "none" },
        rollAction: { kind: "other_participant_enrolled", effectiveDate: "2026-02-01" },
      });
      expect(result).toEqual({
        kind: "ok",
        personId: freeAgentPerson,
        rollActionId: expect.any(String),
      });

      const platform = getPlatformDb();
      const [membershipRow] = await platform
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, freeAgentPerson),
            eq(memberships.organizationId, orgA),
          ),
        );
      expect(membershipRow).toBeDefined();
    });

    it("existing-identity-elsewhere returns existing_member_elsewhere and writes nothing", async () => {
      const result = await createPerson(managerPerson, orgA, grantingUserId, {
        identity: { mode: "existing", matchedPersonId: elsewherePerson },
        contact: {},
        household: { mode: "none" },
        rollAction: { kind: "other_participant_enrolled", effectiveDate: "2026-02-01" },
      });
      expect(result).toEqual({ kind: "existing_member_elsewhere" });

      const platform = getPlatformDb();
      const membershipRows = await platform
        .select()
        .from(memberships)
        .where(eq(memberships.personId, elsewherePerson));
      // Still exactly the one, pre-existing orgB membership — none at orgA.
      expect(membershipRows).toHaveLength(1);
      expect(membershipRows[0]?.organizationId).toBe(orgB);
    });

    /**
     * Uses `identity.mode: "existing"` (freeAgentPerson2), NOT "new" — the
     * "new" branch is the pinned schema defect above (people-table RLS);
     * this is the household-validation logic itself, which is unaffected
     * and does not need the blocked path to prove.
     */
    it("invalid_household on a cross-org household id, with no membership written", async () => {
      const result = await createPerson(managerPerson, orgA, grantingUserId, {
        identity: { mode: "existing", matchedPersonId: freeAgentPerson2 },
        contact: {},
        household: { mode: "existing", householdId: householdOrgB },
        rollAction: { kind: "profession_of_faith", effectiveDate: "2026-01-01" },
      });
      expect(result).toEqual({ kind: "invalid_household" });

      const platform = getPlatformDb();
      const membershipRows = await platform
        .select()
        .from(memberships)
        .where(eq(memberships.personId, freeAgentPerson2));
      expect(membershipRows).toHaveLength(0);
    });

    /**
     * Same reason as above — `identity.mode: "existing"` (freeAgentPerson3)
     * sidesteps the pinned people-table RLS defect, isolating the actual
     * behavior under test: a genuine, unmodeled DB error (a NOT NULL
     * violation on `households.name`, forced past TypeScript via `as any`)
     * partway through the transaction must roll back EVERYTHING already
     * written in it — proven here by asserting `freeAgentPerson3` still has
     * ZERO memberships anywhere after the throw, even though the
     * transaction reached (and would otherwise have completed) the
     * membership-insert step.
     */
    it("a forced mid-transaction failure (NOT NULL violation on households.name) rolls back the whole transaction", async () => {
      await expect(
        createPerson(managerPerson, orgA, grantingUserId, {
          identity: { mode: "existing", matchedPersonId: freeAgentPerson3 },
          contact: {},
          household: { mode: "new", name: null as unknown as string },
          rollAction: { kind: "profession_of_faith", effectiveDate: "2026-01-01" },
        }),
      ).rejects.toThrow();

      const platform = getPlatformDb();
      const membershipRows = await platform
        .select()
        .from(memberships)
        .where(eq(memberships.personId, freeAgentPerson3));
      expect(membershipRows).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // createPerson — rollAction.kind "none" (DECISION-128/129,
  // docs/work-log/2026-08-27-staff-and-personnel.md)
  // ---------------------------------------------------------------------

  describe('createPerson — rollAction.kind "none" (DECISION-128/129)', () => {
    it("forbidden without people.manage, even for a holder of directory.view (roll.propose is irrelevant to this kind)", async () => {
      const result = await createPerson(directoryViewerPerson, orgA, grantingUserId, {
        identity: { mode: "new", firstName: "Should", lastName: `NeverExistStaff${stamp}` },
        contact: {},
        household: { mode: "none" },
        rollAction: { kind: "none" },
      });
      expect(result).toEqual({ kind: "forbidden" });

      const platform = getPlatformDb();
      const [orphan] = await platform
        .select({ id: people.id })
        .from(people)
        .where(eq(people.lastName, `NeverExistStaff${stamp}`))
        .limit(1);
      expect(orphan).toBeUndefined();
    });

    /**
     * THE gating split DECISION-128 ruling 1 exists to prove:
     * `onlyPeopleManagePerson` holds `people.manage` but explicitly NOT
     * `roll.propose` (see this file's own fixture comment) — the exact
     * combination `createPerson()`'s two ROLL-BEARING kinds forbid (see the
     * "forbidden without people.manage AND roll.propose" test above, same
     * person). For `rollAction.kind: "none"` it must succeed instead.
     */
    it("succeeds for a holder of people.manage ONLY (no roll.propose) — proves the DECISION-128 gating split", async () => {
      const result = await createPerson(onlyPeopleManagePerson, orgA, grantingUserId, {
        identity: {
          mode: "new",
          firstName: "Marisol",
          lastName: `StaffOnly${stamp}`,
        },
        contact: { email: `staffonly-${stamp}@example.invalid` },
        household: { mode: "none" },
        rollAction: { kind: "none" },
      });
      expect(result).toEqual({
        kind: "ok",
        personId: expect.any(String),
        rollActionId: null,
      });
      if (result.kind !== "ok") return;

      const platform = getPlatformDb();

      // DECISION-129, the load-bearing fix: engagementStatus is "staff", NOT
      // "regular" — and current_roll stays null, exactly like an
      // as-yet-undecided visitor.
      const [membershipRow] = await platform
        .select({
          engagementStatus: memberships.engagementStatus,
          currentRoll: memberships.currentRoll,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, result.personId),
            eq(memberships.organizationId, orgA),
          ),
        );
      expect(membershipRow).toEqual({ engagementStatus: "staff", currentRoll: null });

      // Step 4 is skipped entirely — no roll_actions row of any kind.
      const rollActionRows = await platform
        .select()
        .from(rollActions)
        .where(eq(rollActions.personId, result.personId));
      expect(rollActionRows).toHaveLength(0);
    });

    /**
     * REGRESSION for DECISION-129 — the actual leak this design catches
     * before it ships. Reads through the SAME two surfaces the work-log
     * names: `getDirectory()`'s default (unfiltered) result set and
     * `findPersonMatches()`. Both admit any row with `engagement_status =
     * 'regular'`; if `createPerson()`'s `rollAction: { kind: "none" }` arm
     * ever regresses back to that hardcoded value, this test starts failing.
     */
    it("REGRESSION for DECISION-129: a staff-only-anchored person does NOT appear in getDirectory()'s default result set", async () => {
      const { getDirectory } = await import("./directory");

      const created = await createPerson(onlyPeopleManagePerson, orgA, grantingUserId, {
        identity: {
          mode: "new",
          firstName: "Idris",
          lastName: `StaffDirectoryLeak${stamp}`,
        },
        contact: {},
        household: { mode: "none" },
        rollAction: { kind: "none" },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const directoryResult = await getDirectory(directoryViewerPerson, orgA);
      expect(directoryResult.kind).toBe("ok");
      if (directoryResult.kind !== "ok") return;
      const directoryPersonIds = directoryResult.entries.map((entry) => entry.personId);
      expect(directoryPersonIds).not.toContain(created.personId);

      // Sanity check the harness itself is capable of finding a "regular"
      // row at all — a person created via the pre-existing rollAction kinds
      // (Increment 1's own happy-path fixture, created earlier in this file)
      // DOES appear, proving the assertion above is a real exclusion, not an
      // artifact of getDirectory() returning nothing for this viewer.
      expect(directoryPersonIds.length).toBeGreaterThan(0);
    });

    it("REGRESSION for DECISION-129: findPersonMatches() does NOT surface a staff-only-anchored person", async () => {
      const { findPersonMatches } = await import("./org-portal/find-person");

      const created = await createPerson(onlyPeopleManagePerson, orgA, grantingUserId, {
        identity: {
          mode: "new",
          firstName: "Rowan",
          lastName: `StaffFindPersonLeak${stamp}`,
        },
        contact: {},
        household: { mode: "none" },
        rollAction: { kind: "none" },
      });
      expect(created.kind).toBe("ok");
      if (created.kind !== "ok") return;

      const matchResult = await findPersonMatches(
        directoryViewerPerson,
        orgA,
        `StaffFindPersonLeak${stamp}`,
      );
      expect(matchResult.kind).toBe("ok");
      if (matchResult.kind !== "ok") return;
      expect(matchResult.personIds).not.toContain(created.personId);
    });
  });
});
