/**
 * Integration tests for getDirectory() — run against a REAL Postgres
 * connection, not mocked.
 *
 * Follows src/lib/storage/blob-store.test.ts's precedent: the behavior under
 * test is genuine SQL (a WHERE-clause exclusion, five independent CASE WHEN
 * projections, a LEFT JOIN default). Mocking `@/lib/db` at the tx.execute
 * boundary would only prove that this file's own canned rows round-trip
 * through the mapping code — it could never catch a WHERE clause that
 * silently stopped excluding hidden rows, or a CASE WHEN that nulled the
 * wrong column. `npm test` in CI does not set DATABASE_URL, so this whole
 * suite is SKIPPED there, not failed. Run it for real with
 * `dotenv -e .env.local -- vitest run src/lib/directory.test.ts`.
 *
 * Every import of `./directory`, `@/lib/db`, and `@/lib/authz` is dynamic,
 * inside `beforeAll`, reached only when `hasDb` is true — same reason as
 * blob-store.test.ts: `@/lib/db`'s `db` export opens a real pool at
 * module-import time and throws if DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import {
  removeSeededPersonPhoto,
  seedPersonPhoto,
  setPersonPhotosToggle,
  type SeededPersonPhoto,
} from "@/lib/testing/person-photo-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("getDirectory (Postgres-backed, real dev database)", () => {
  let getDirectory: typeof import("./directory").getDirectory;
  let getHouseholds: typeof import("./directory").getHouseholds;
  let getHouseholdDetail: typeof import("./directory").getHouseholdDetail;
  let getPersonDetail: typeof import("./directory").getPersonDetail;
  let deriveDeaconsByOrgUnit: typeof import("./directory").deriveDeaconsByOrgUnit;
  let orgUnitFutureEnd: string; // F265: district whose deacon term has a FUTURE end date
  let orgUnitNotStarted: string; // F265: district whose deacon term has not STARTED yet
  let countHouseholdDirectoryMembers: typeof import("./directory").countHouseholdDirectoryMembers;
  let withOrgContext: typeof import("@/lib/authz").withOrgContext;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let orgUnits: typeof import("@/lib/db/domain/org").orgUnits;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
  let addresses: typeof import("@/lib/db/domain/people").addresses;
  let households: typeof import("@/lib/db/domain/people").households;
  let personPrivacy: typeof import("@/lib/db/domain/privacy").personPrivacy;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;
  let officerTerms: typeof import("@/lib/db/domain/officers").officerTerms;

  // orgA: has the baseline directory.view binding — the grantee/content/
  // privacy fixture. orgB: has an active_membership group (required for the
  // memberships trigger to succeed at all — drizzle/0017) but NO role bound
  // to directory.view, so a member there is the "no grant" case.
  let orgA: string;
  let orgB: string;

  let control: string; // no person_privacy row — DECISION-064
  let visitorPerson: string; // grantee, not content — DECISION-065
  let hiddenPerson: string; // directory_hidden — excluded entirely
  let fieldEmail: string;
  let fieldPhone: string;
  let fieldAddress: string;
  let fieldBirthday: string;
  let fieldPhoto: string;
  let forbiddenPerson: string; // orgB — no directory.view grant

  // Increment 3 fixture — households.
  let householdVisible: string; // orgA, 2 eligible members
  let householdHiddenOnly: string; // orgA, 1 member, directory_hidden -> 0 visible
  let householdOrgB: string; // orgB, 1 eligible member — cross-org isolation
  let hhPerson1: string;
  let hhPerson2: string;
  let hhHiddenPerson: string;
  let hhOrgBPerson: string;

  // F136 fixture — a relationship that ENDED but whose engagement_status
  // stayed 'regular', placed in householdVisible; and a same-shaped member
  // with no end date (the over-exclusion control).
  let endedMember: string;
  let currentSameShape: string;

  // Increment 4 fixture — deacon linkage / directory.view_hidden.
  let elevatedPerson: string; // orgA, holds directory.view AND directory.view_hidden
  let orgUnitActive: string; // orgA district, one active deacon term
  let orgUnitVacant: string; // orgA district, only an ENDED deacon term
  let orgUnitOrgB: string; // orgB district, its own active deacon
  let deaconActive1: string; // active at orgUnitActive
  let deaconActive2: string; // ALSO active at orgUnitActive — tie-break fixture
  let deaconEnded: string; // ended-only term at orgUnitVacant
  let deaconOrgB: string; // active at orgUnitOrgB
  let householdWithDeacon: string; // orgA, org_unit_id = orgUnitActive
  let householdVacantDistrict: string; // orgA, org_unit_id = orgUnitVacant
  let householdOrgBWithDeacon: string; // orgB, org_unit_id = orgUnitOrgB
  let revokedGrantPerson: string; // orgA — a directory.view_hidden grant that has ENDED
  // The three eligible household-head persons created alongside the three
  // households above — collected here so `afterAll` can clean them up
  // without a separate `let` per person.
  const directory4ExtraPeople: string[] = [];

  beforeAll(async () => {
    ({
      getDirectory,
      getHouseholds,
      getHouseholdDetail,
      getPersonDetail,
      deriveDeaconsByOrgUnit,
      countHouseholdDirectoryMembers,
    } = await import("./directory"));
    ({ withOrgContext } = await import("@/lib/authz"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations, orgUnits } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships, contactMethods, addresses, households } =
      await import("@/lib/db/domain/people"));
    ({ personPrivacy } = await import("@/lib/db/domain/privacy"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));
    ({ officerTerms } = await import("@/lib/db/domain/officers"));

    const platform = getPlatformDb();
    const stamp = Date.now();

    const [a] = await platform
      .insert(organizations)
      .values({
        // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
        deletableUntil: fixtureDeletableUntil(),
        organizationType: "congregation",
        name: "Fixture Congregation A for directory.test.ts",
        slug: `directory-test-a-${stamp}`,
        path: `directory_test_a_${stamp}`,
        platformStatus: "unmanaged",
      })
      .returning({ id: organizations.id });
    orgA = a!.id;

    const [b] = await platform
      .insert(organizations)
      .values({
        // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
        deletableUntil: fixtureDeletableUntil(),
        organizationType: "congregation",
        name: "Fixture Congregation B for directory.test.ts",
        slug: `directory-test-b-${stamp}`,
        path: `directory_test_b_${stamp}`,
        platformStatus: "unmanaged",
      })
      .returning({ id: organizations.id });
    orgB = b!.id;

    // drizzle/0017's sync trigger fails loudly if the org has no
    // active_membership derived group yet — must exist before ANY
    // memberships insert at either org.
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
    // orgB deliberately gets NO app_roles/role_grants at all — that absence
    // is the fixture for the "no grant" case.

    async function person(first: string, last: string, dob: string | null) {
      const [p] = await platform
        .insert(people)
        .values({
          firstName: first,
          lastName: last,
          dateOfBirth: dob,
          deletableUntil: fixtureDeletableUntil(),
        })
        .returning({ id: people.id });
      return p!.id;
    }

    control = await person("Ophelia", "Marchbanks", "1980-04-02");
    visitorPerson = await person("Callum", "Petrakis", null);
    hiddenPerson = await person("Blythe", "Osei", "1975-11-19");
    fieldEmail = await person("Devika", "Fenwright", "1990-01-15");
    fieldPhone = await person("Marcus", "Isherwood", "1990-01-15");
    fieldAddress = await person("Yusra", "Baptiste", "1990-01-15");
    fieldBirthday = await person("Corin", "Wathen", "1990-01-15");
    fieldPhoto = await person("Nadia", "Okafor", "1990-01-15");
    forbiddenPerson = await person("Elian", "Tarrow", "1990-01-15");

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

    await membership(orgA, control, "regular", "active");
    await membership(orgA, visitorPerson, "visitor", null);
    await membership(orgA, hiddenPerson, "regular", "active");
    await membership(orgA, fieldEmail, "regular", "active");
    await membership(orgA, fieldPhone, "regular", "active");
    await membership(orgA, fieldAddress, "regular", "active");
    await membership(orgA, fieldBirthday, "regular", "active");
    await membership(orgA, fieldPhoto, "regular", "active");
    await membership(orgB, forbiddenPerson, "regular", "active");

    await platform
      .insert(personPrivacy)
      .values({ personId: hiddenPerson, organizationId: orgA, directoryHidden: true });

    async function fieldPrivacy(
      personId: string,
      over: Partial<{
        hideEmail: boolean;
        hidePhone: boolean;
        hideAddress: boolean;
        hideBirthday: boolean;
        hidePhoto: boolean;
      }>,
    ) {
      await platform.insert(personPrivacy).values({
        personId,
        organizationId: orgA,
        hideEmail: false,
        hidePhone: false,
        hideAddress: false,
        hideBirthday: false,
        hidePhoto: false,
        ...over,
      });
      await platform.insert(contactMethods).values([
        { personId, kind: "email", value: `${personId}@example.invalid`, isPrimary: true },
        { personId, kind: "phone", value: "555-0100", isPrimary: true },
      ]);
      await platform.insert(addresses).values({
        personId,
        addressType: "home",
        line1: "1 Fixture Way",
        city: "Fixtureville",
        region: "OH",
        postalCode: "00000",
        isPrimary: true,
      });
    }

    await fieldPrivacy(fieldEmail, { hideEmail: true });
    await fieldPrivacy(fieldPhone, { hidePhone: true });
    await fieldPrivacy(fieldAddress, { hideAddress: true });
    await fieldPrivacy(fieldBirthday, { hideBirthday: true });
    await fieldPrivacy(fieldPhoto, { hidePhoto: true });

    // The control person gets contact detail too, but explicitly NO
    // person_privacy row — DECISION-064's fixture.
    await platform.insert(contactMethods).values([
      { personId: control, kind: "email", value: "control@example.invalid", isPrimary: true },
      { personId: control, kind: "phone", value: "555-0199", isPrimary: true },
    ]);
    await platform.insert(addresses).values({
      personId: control,
      addressType: "home",
      line1: "9 Control St",
      city: "Fixtureville",
      region: "OH",
      postalCode: "00000",
      isPrimary: true,
    });

    // ------------------------------------------------------------------
    // Increment 3 fixture — households, for getHouseholds()/
    // getHouseholdDetail()/getPersonDetail().
    // ------------------------------------------------------------------
    hhPerson1 = await person("Odalys", "Winterbourne", null);
    hhPerson2 = await person("Ptolemy", "Winterbourne", null);
    hhHiddenPerson = await person("Ines", "Kirkbride", null);
    hhOrgBPerson = await person("Emeric", "Ravensworth", null);

    const [hhVisible] = await platform
      .insert(households)
      .values({
        organizationId: orgA,
        name: "The Winterbourne Family",
        isGivingUnit: true,
      })
      .returning({ id: households.id });
    householdVisible = hhVisible!.id;

    const [hhHidden] = await platform
      .insert(households)
      .values({
        organizationId: orgA,
        name: "The Kirkbride Household",
        isGivingUnit: true,
      })
      .returning({ id: households.id });
    householdHiddenOnly = hhHidden!.id;

    const [hhB] = await platform
      .insert(households)
      .values({
        organizationId: orgB,
        name: "The Ravensworth Household",
        isGivingUnit: true,
      })
      .returning({ id: households.id });
    householdOrgB = hhB!.id;

    await platform.insert(memberships).values([
      {
        organizationId: orgA,
        personId: hhPerson1,
        householdId: householdVisible,
        householdRole: "head",
        engagementStatus: "regular",
        currentRoll: "active",
      },
      {
        organizationId: orgA,
        personId: hhPerson2,
        householdId: householdVisible,
        householdRole: "spouse",
        engagementStatus: "regular",
        currentRoll: "active",
      },
      // directory_hidden: an eligible membership, but the household it
      // belongs to has ZERO VISIBLE members once the privacy row below
      // excludes this one — getHouseholds() must drop it entirely, and
      // getHouseholdDetail()/getPersonDetail() must both return "not-found".
      {
        organizationId: orgA,
        personId: hhHiddenPerson,
        householdId: householdHiddenOnly,
        householdRole: "head",
        engagementStatus: "regular",
        currentRoll: "active",
      },
      // orgB's household — proves cross-org isolation: orgA's context must
      // never surface this household or this person, even by id.
      {
        organizationId: orgB,
        personId: hhOrgBPerson,
        householdId: householdOrgB,
        householdRole: "head",
        engagementStatus: "regular",
        currentRoll: "active",
      },
    ]);

    await platform.insert(personPrivacy).values({
      personId: hhHiddenPerson,
      organizationId: orgA,
      directoryHidden: true,
    });

    // F136 — the exact shape of the two measured rows on the shared dev
    // branch (engagement 'regular', current_roll null, ended_on set), put in
    // the visible household so the household assertions are built-in proof.
    // memberships_one_active_roll_idx is partial on current_roll = 'active'
    // and ended_on is null, so this row is legal.
    endedMember = await person("Rowan", "Ashgrove-Pell", null);
    currentSameShape = await person("Wren", "Ashgrove-Vale", null);
    await platform.insert(memberships).values([
      {
        organizationId: orgA,
        personId: endedMember,
        householdId: householdVisible,
        householdRole: "other",
        engagementStatus: "regular",
        currentRoll: null,
        endedOn: "2026-03-31",
      },
      // Identical except no end date, and no household.
      {
        organizationId: orgA,
        personId: currentSameShape,
        engagementStatus: "regular",
        currentRoll: null,
      },
    ]);

    // ------------------------------------------------------------------
    // Increment 4 fixture — deacon linkage / directory.view_hidden.
    // ------------------------------------------------------------------
    elevatedPerson = await person("Esperanza", "Villareal", null);
    deaconActive1 = await person("Rosalind", "Fairweather", null);
    deaconActive2 = await person("Thaddeus", "Okonkwo", null);
    deaconEnded = await person("Marisol", "Bellweather", null);
    deaconOrgB = await person("Cassius", "Duvernay", null);
    const hhDeaconHead = await person("Ottoline", "Marchetti", null);
    const hhVacantHead = await person("Silas", "Prendergast", null);
    const hhOrgBDeaconHead = await person("Ines", "Thackeray-Voss", null);

    await membership(orgA, elevatedPerson, "regular", "active");
    await membership(orgA, deaconActive1, "regular", "active");
    await membership(orgA, deaconActive2, "regular", "active");
    await membership(orgA, deaconEnded, "regular", "active");
    await membership(orgB, deaconOrgB, "regular", "active");

    // `presby_sync_derived_group()` (drizzle/0009_presby_rls.sql) requires a
    // `derived_from = 'diaconate'` group to exist BEFORE any `office =
    // 'deacon'` officer_terms row can be inserted, at BOTH orgs — F16, fails
    // loudly rather than silently dropping the roster projection.
    await platform.insert(groups).values({
      organizationId: orgA,
      groupTypeId,
      name: "Board of Deacons",
      membershipSource: "derived",
      derivedFrom: "diaconate",
      isProtected: true,
    });
    await platform.insert(groups).values({
      organizationId: orgB,
      groupTypeId,
      name: "Board of Deacons",
      membershipSource: "derived",
      derivedFrom: "diaconate",
      isProtected: true,
    });

    const [unitActive] = await platform
      .insert(orgUnits)
      .values({
        organizationId: orgA,
        unitType: "district",
        name: "Fixture North District",
      })
      .returning({ id: orgUnits.id });
    orgUnitActive = unitActive!.id;

    const [unitVacant] = await platform
      .insert(orgUnits)
      .values({
        organizationId: orgA,
        unitType: "district",
        name: "Fixture South District",
      })
      .returning({ id: orgUnits.id });
    orgUnitVacant = unitVacant!.id;

    const [unitOrgB] = await platform
      .insert(orgUnits)
      .values({
        organizationId: orgB,
        unitType: "district",
        name: "Fixture Other-Org District",
      })
      .returning({ id: orgUnits.id });
    orgUnitOrgB = unitOrgB!.id;

    // F265 fixtures: two districts, each with ONE deacon term whose dates make
    // the old `ends_on is null` test wrong in opposite directions. The people
    // are existing fixture people (endedMember's membership has ended, so they
    // add no directory row); the terms are inserted with the others below.
    const [unitFutureEnd] = await platform
      .insert(orgUnits)
      .values({ organizationId: orgA, unitType: "district", name: "Fixture F265 Future-End District" })
      .returning({ id: orgUnits.id });
    orgUnitFutureEnd = unitFutureEnd!.id;
    const [unitNotStarted] = await platform
      .insert(orgUnits)
      .values({ organizationId: orgA, unitType: "district", name: "Fixture F265 Not-Started District" })
      .returning({ id: orgUnits.id });
    orgUnitNotStarted = unitNotStarted!.id;

    const [hhDeacon] = await platform
      .insert(households)
      .values({
        organizationId: orgA,
        name: "The Fixture-Active Household",
        isGivingUnit: true,
        orgUnitId: orgUnitActive,
      })
      .returning({ id: households.id });
    householdWithDeacon = hhDeacon!.id;

    const [hhVacant] = await platform
      .insert(households)
      .values({
        organizationId: orgA,
        name: "The Fixture-Vacant Household",
        isGivingUnit: true,
        orgUnitId: orgUnitVacant,
      })
      .returning({ id: households.id });
    householdVacantDistrict = hhVacant!.id;

    const [hhOrgBDeacon] = await platform
      .insert(households)
      .values({
        organizationId: orgB,
        name: "The Fixture OrgB Household",
        isGivingUnit: true,
        orgUnitId: orgUnitOrgB,
      })
      .returning({ id: households.id });
    householdOrgBWithDeacon = hhOrgBDeacon!.id;

    // Each new household needs ONE eligible member to be surfaced at all by
    // getHouseholds()/getHouseholdDetail() — reuse the "head" shape the
    // Increment 3 fixture above already established.
    await platform.insert(memberships).values([
      {
        organizationId: orgA,
        personId: hhDeaconHead,
        householdId: householdWithDeacon,
        householdRole: "head",
        engagementStatus: "regular",
        currentRoll: "active",
      },
      {
        organizationId: orgA,
        personId: hhVacantHead,
        householdId: householdVacantDistrict,
        householdRole: "head",
        engagementStatus: "regular",
        currentRoll: "active",
      },
      {
        organizationId: orgB,
        personId: hhOrgBDeaconHead,
        householdId: householdOrgBWithDeacon,
        householdRole: "head",
        engagementStatus: "regular",
        currentRoll: "active",
      },
    ]);

    await platform.insert(officerTerms).values([
      // orgUnitActive: TWO active terms for DIFFERENT people — the
      // deterministic tie-break fixture. deaconActive2 starts LATER, so
      // `starts_on desc` must pick it.
      {
        organizationId: orgA,
        personId: deaconActive1,
        office: "deacon",
        orgUnitId: orgUnitActive,
        startsOn: "2020-01-01",
        endsOn: null,
      },
      {
        organizationId: orgA,
        personId: deaconActive2,
        office: "deacon",
        orgUnitId: orgUnitActive,
        startsOn: "2022-06-01",
        endsOn: null,
      },
      // orgUnitVacant: an ENDED-only term — the vacant-district fixture.
      {
        organizationId: orgA,
        personId: deaconEnded,
        office: "deacon",
        orgUnitId: orgUnitVacant,
        startsOn: "2015-01-01",
        endsOn: "2019-12-31",
        endReason: "completed",
      },
      // F265: a term that is OPEN today but has a future end date (the old
      // `ends_on is null` test dropped this deacon) ...
      {
        organizationId: orgA,
        personId: elevatedPerson,
        office: "deacon",
        orgUnitId: orgUnitFutureEnd,
        startsOn: "2020-01-01",
        endsOn: "2099-12-31",
      },
      // ... and a term that has NOT STARTED yet (the old test counted it).
      {
        organizationId: orgA,
        personId: deaconEnded,
        office: "deacon",
        orgUnitId: orgUnitNotStarted,
        startsOn: "2099-01-01",
        endsOn: null,
      },
      // orgUnitOrgB: its own active deacon, in a DIFFERENT organization —
      // the cross-org-isolation fixture.
      {
        organizationId: orgB,
        personId: deaconOrgB,
        office: "deacon",
        orgUnitId: orgUnitOrgB,
        startsOn: "2021-01-01",
        endsOn: null,
      },
    ]);

    await platform
      .insert(permissions)
      .values({
        key: "directory.view_hidden",
        module: "directory",
        description: "See directory-hidden rows and the deacon roster",
        sensitivityTier: 1,
      })
      .onConflictDoNothing();

    const [hiddenRole] = await platform
      .insert(appRoles)
      .values({
        organizationId: orgA,
        key: "diaconate_fixture",
        name: "Diaconate (fixture)",
        roleKind: "custom",
        isProtected: false,
      })
      .returning({ id: appRoles.id });

    await platform
      .insert(appRolePermissions)
      .values({ roleId: hiddenRole!.id, permissionKey: "directory.view_hidden" });

    // A direct grant to elevatedPerson (not a group) — simplest fixture
    // shape for a single elevated viewer; the F3 "granted to a derived
    // group, never a person" discipline governs the REAL diaconate_member
    // role (scripts/seed-dev.sql), not this test's own throwaway role.
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: hiddenRole!.id,
      personId: elevatedPerson,
      startsOn: "2000-01-01",
    });

    // A grant that has ENDED — the permission resolver reads dates, so this
    // is functionally identical to a grant revoked mid-session (Phase 3's
    // own edge case) without needing to mutate a shared row mid-test-run.
    revokedGrantPerson = await person("Fenwick", "Delacroix-Muir", null);
    await membership(orgA, revokedGrantPerson, "regular", "active");
    await platform.insert(roleGrants).values({
      organizationId: orgA,
      roleId: hiddenRole!.id,
      personId: revokedGrantPerson,
      startsOn: "2000-01-01",
      endsOn: "2001-01-01",
    });

    directory4ExtraPeople.push(hhDeaconHead, hhVacantHead, hhOrgBDeaconHead);
  });

  afterAll(async () => {
    // person_privacy FIRST, then organizations, then people — order is load-
    // bearing. person_privacy.person_fk and group_memberships.person_fk are
    // both composite FKs onto `memberships` declared NO ACTION, not cascade
    // (see src/lib/db/domain/privacy.ts and groups.ts). Deleting the org
    // cascades `memberships` away; if a person_privacy row still points at
    // one of those rows, the cascade is rejected — person_privacy has no
    // organization-owned cascade path at all and must be removed explicitly
    // first. `people` last, since organizations no longer references it once
    // its memberships are gone.
    //
    // group_memberships DOES cascade from organizations (same statement, same
    // cascade fan-out) but drizzle/0033's group_memberships_reject_derived
    // trigger now (DECISION-110) rejects that cascade DELETE outright for
    // this fixture's own active_membership/diaconate-derived rows — disable
    // it around the cascade, same as roll.test.ts's own teardown does for
    // roll_actions_freeze.
    const platform = getPlatformDb();
    const allPeople = [
      control,
      visitorPerson,
      hiddenPerson,
      fieldEmail,
      fieldPhone,
      fieldAddress,
      fieldBirthday,
      fieldPhoto,
      forbiddenPerson,
      hhPerson1,
      hhPerson2,
      hhHiddenPerson,
      hhOrgBPerson,
      endedMember,
      currentSameShape,
      elevatedPerson,
      deaconActive1,
      deaconActive2,
      deaconEnded,
      deaconOrgB,
      revokedGrantPerson,
      ...directory4ExtraPeople,
    ].filter(Boolean);

    for (const id of allPeople) {
      await platform.delete(personPrivacy).where(eq(personPrivacy.personId, id));
    }
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

  it("a visitor with no roll status is a grantee but not content", async () => {
    const result = await getDirectory(visitorPerson, orgA);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.entries.map((e) => e.personId)).not.toContain(visitorPerson);
  });

  it("a directory_hidden row is fully excluded, not just its fields nulled", async () => {
    const result = await getDirectory(control, orgA);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.entries.map((e) => e.personId)).not.toContain(hiddenPerson);
  });

  it("hide_email nulls only email", async () => {
    const result = await getDirectory(control, orgA);
    if (result.kind !== "ok") throw new Error("expected ok");
    const entry = result.entries.find((e) => e.personId === fieldEmail);
    expect(entry?.email).toBeNull();
    expect(entry?.phone).not.toBeNull();
    expect(entry?.address).not.toBeNull();
    expect(entry?.photoThumbKey).toBeDefined();
  });

  it("hide_phone nulls only phone", async () => {
    const result = await getDirectory(control, orgA);
    if (result.kind !== "ok") throw new Error("expected ok");
    const entry = result.entries.find((e) => e.personId === fieldPhone);
    expect(entry?.phone).toBeNull();
    expect(entry?.email).not.toBeNull();
    expect(entry?.address).not.toBeNull();
  });

  it("hide_address nulls only address", async () => {
    const result = await getDirectory(control, orgA);
    if (result.kind !== "ok") throw new Error("expected ok");
    const entry = result.entries.find((e) => e.personId === fieldAddress);
    expect(entry?.address).toBeNull();
    expect(entry?.email).not.toBeNull();
    expect(entry?.phone).not.toBeNull();
  });

  it("hide_birthday nulls only date of birth", async () => {
    const result = await getDirectory(control, orgA);
    if (result.kind !== "ok") throw new Error("expected ok");
    const entry = result.entries.find((e) => e.personId === fieldBirthday);
    expect(entry?.dateOfBirth).toBeNull();
    expect(entry?.email).not.toBeNull();
    expect(entry?.address).not.toBeNull();
  });

  // 0078: the photo column is a THUMBNAIL KEY from presby_person_directory_photo(), which owns
  // the toggle, the minor test and hide_photo. Every test below seeds a real directory photo first
  // (the pre-0078 version of the hide_photo test was vacuous: nobody had a photo, so null proved nothing).
  describe("directory photos (0078, presby_person_directory_photo)", () => {
    let platformDb: ReturnType<typeof import("@/lib/db").getPlatformDb>;
    let userId: string;
    let controlPhoto: SeededPersonPhoto;
    let hiddenPhoto: SeededPersonPhoto;
    let websiteOnly: SeededPersonPhoto;
    let removedPhoto: SeededPersonPhoto;
    let endedPhoto: SeededPersonPhoto;
    let minorPhoto: SeededPersonPhoto;
    let minorOriginalDob: string | null;

    const rowsOf = <T,>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
    const entryOf = async (personId: string) => {
      const result = await getDirectory(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      return result.entries.find((e) => e.personId === personId);
    };

    beforeAll(async () => {
      platformDb = getPlatformDb();
      const [u] = rowsOf<{ id: string }>(
        await platformDb.execute(sql`
          insert into users (email, name) values (${`dirphoto-${Date.now()}@example.invalid`}, 'Directory Photo Fixture')
          returning id`),
      );
      userId = u!.id;
      await setPersonPhotosToggle(platformDb, orgA, true);
      const seed = (personId: string, purposes: Array<"directory" | "website">) =>
        seedPersonPhoto(platformDb, { organizationId: orgA, personId, userId, purposes });
      controlPhoto = await seed(control, ["directory"]);
      hiddenPhoto = await seed(fieldPhoto, ["directory"]); // fieldPhoto has hide_photo set
      websiteOnly = await seed(hhPerson1, ["website"]);
      removedPhoto = await seed(hhPerson2, ["directory"]);
      await removeSeededPersonPhoto(platformDb, removedPhoto.photoId, userId);
      endedPhoto = await seed(fieldEmail, ["directory"]);
      await platformDb.execute(sql`
        update person_photo_designations set ended_at = now(), ended_by = ${userId}
         where photo_id = ${endedPhoto.photoId} and ended_at is null`);
      minorPhoto = await seed(fieldPhone, ["directory"]);
      const [dob] = rowsOf<{ d: string | null }>(
        await platformDb.execute(sql`select date_of_birth::text as d from people where id = ${fieldPhone}`),
      );
      minorOriginalDob = dob?.d ?? null;
    }, 60_000);

    afterAll(async () => {
      if (!platformDb) return;
      await platformDb.execute(sql`update people set date_of_birth = ${minorOriginalDob}::date where id = ${fieldPhone}`);
      // Photo rows reference the user (NO ACTION), and the org's cascade runs later: clear them here, by id.
      await platformDb.execute(sql`delete from person_photo_designations where organization_id = ${orgA}`);
      await platformDb.execute(sql`delete from person_photos where organization_id = ${orgA}`);
      await platformDb.execute(sql`delete from blob_assets where organization_id = ${orgA}`);
      await platformDb.execute(sql`delete from organization_feature_toggles where organization_id = ${orgA} and feature_key = 'org_portal.person_photos'`);
      await platformDb.execute(sql`delete from users where id = ${userId}`);
      const left = rowsOf<{ n: number }>(
        await platformDb.execute(sql`
          select (select count(*) from person_photos where organization_id = ${orgA})::int
               + (select count(*) from blob_assets where organization_id = ${orgA})::int as n`),
      );
      expect(left[0]!.n, "the directory photo fixtures are gone").toBe(0);
    }, 60_000);

    it("a directory designation returns its THUMBNAIL key (never the master's)", async () => {
      const entry = await entryOf(control);
      expect(entry?.photoThumbKey).toBe(controlPhoto.thumbKey);
      expect(entry?.photoThumbKey).not.toBe(controlPhoto.imageKey);
    });

    it("hide_photo withholds the key (scoped to this org) and nulls ONLY the photo", async () => {
      const entry = await entryOf(fieldPhoto);
      expect(hiddenPhoto.thumbKey).toBeTruthy();
      expect(entry?.photoThumbKey).toBeNull();
      expect(entry?.email).not.toBeNull();
      expect(entry?.phone).not.toBeNull();
      expect(entry?.address).not.toBeNull();
    });

    it("a person with only a WEBSITE photo shows none in the directory (the fallback is one-way)", async () => {
      expect(websiteOnly.thumbKey).toBeTruthy();
      expect((await entryOf(hhPerson1))?.photoThumbKey).toBeNull();
    });

    it("a removed photo and an ended designation each return null", async () => {
      expect((await entryOf(hhPerson2))?.photoThumbKey).toBeNull();
      expect((await entryOf(fieldEmail))?.photoThumbKey).toBeNull();
    });

    it("a person who appears to be under 18 returns null with nobody acting, and the photo returns when the date of birth says adult again", async () => {
      expect((await entryOf(fieldPhone))?.photoThumbKey).toBe(minorPhoto.thumbKey);
      await platformDb.execute(sql`update people set date_of_birth = (current_date - interval '9 years')::date where id = ${fieldPhone}`);
      expect((await entryOf(fieldPhone))?.photoThumbKey).toBeNull();
      await platformDb.execute(sql`update people set date_of_birth = ${minorOriginalDob}::date where id = ${fieldPhone}`);
      expect((await entryOf(fieldPhone))?.photoThumbKey).toBe(minorPhoto.thumbKey);
    });

    it("the org's photos toggle off returns null for everyone, and on restores it", async () => {
      await setPersonPhotosToggle(platformDb, orgA, false);
      try {
        expect((await entryOf(control))?.photoThumbKey).toBeNull();
      } finally {
        await setPersonPhotosToggle(platformDb, orgA, true);
      }
      expect((await entryOf(control))?.photoThumbKey).toBe(controlPhoto.thumbKey);
    });

    it("across the whole directory, only the two eligible directory designations yield a key (nothing leaks from the website-only, removed, ended or hidden photos)", async () => {
      const result = await getDirectory(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const keys = result.entries.map((e) => e.photoThumbKey).filter(Boolean);
      expect(keys.sort()).toEqual([controlPhoto.thumbKey, minorPhoto.thumbKey].sort());
    });

    it("the detail reads (household and person) carry the same thumbnail key through the one shared query", async () => {
      const detail = await getPersonDetail(control, orgA, control);
      if (detail.kind !== "ok") throw new Error("expected ok");
      expect(detail.entry.photoThumbKey).toBe(controlPhoto.thumbKey);
    });
  });

  it("a missing person_privacy row defaults to the column's own declared defaults (DECISION-064) — visible except birthday", async () => {
    const result = await getDirectory(control, orgA);
    if (result.kind !== "ok") throw new Error("expected ok");
    const entry = result.entries.find((e) => e.personId === control);
    expect(entry).toBeDefined();
    expect(entry?.email).toBe("control@example.invalid");
    expect(entry?.phone).toBe("555-0199");
    expect(entry?.address).toEqual({
      line1: "9 Control St",
      city: "Fixtureville",
      region: "OH",
      postalCode: "00000",
    });
    // hide_birthday's declared default is TRUE, unlike every other flag.
    expect(entry?.dateOfBirth).toBeNull();
  });

  it("someone with no directory.view grant gets forbidden, not an empty list", async () => {
    const result = await getDirectory(forbiddenPerson, orgB);
    expect(result).toEqual({ kind: "forbidden" });
  });

  it("a genuine DB failure propagates as a thrown exception, never a result variant", async () => {
    // Not a well-formed UUID: the membership probe's `${personId}::uuid` cast
    // inside withOrgContext() fails at the DATABASE, before any permission
    // logic runs — a real, non-application error (22P02), not OrgAccessError
    // and not {kind: "forbidden"}.
    await expect(
      getDirectory("not-a-uuid", orgA),
    ).rejects.toThrow();
  });

  it("does not swallow OrgAccessError into a result variant either", async () => {
    // A person with no relationship to orgA at all.
    await expect(getDirectory(randomUUID(), orgA)).rejects.toMatchObject({
      name: "OrgAccessError",
    });
  });

  describe("opts.search (Increment 2)", () => {
    it("matches by first name, case-insensitive", async () => {
      const result = await getDirectory(control, orgA, { search: "ophel" });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).toEqual([control]);
    });

    it("matches by last name, case-insensitive", async () => {
      const result = await getDirectory(control, orgA, {
        search: "MARCHBANKS",
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).toContain(control);
    });

    it("matches by (primary) email", async () => {
      const result = await getDirectory(control, orgA, {
        search: "control@example",
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).toEqual([control]);
    });

    it("matches by (primary) phone", async () => {
      const result = await getDirectory(control, orgA, { search: "0199" });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).toEqual([control]);
    });

    it("trims surrounding whitespace before matching", async () => {
      const result = await getDirectory(control, orgA, {
        search: "  ophel  ",
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).toContain(control);
    });

    it("empty/whitespace-only search behaves exactly like omitting opts entirely", async () => {
      const withOpts = await getDirectory(control, orgA, { search: "   " });
      const withoutOpts = await getDirectory(control, orgA);
      if (withOpts.kind !== "ok" || withoutOpts.kind !== "ok") {
        throw new Error("expected ok");
      }
      expect(withOpts.entries.map((e) => e.personId).sort()).toEqual(
        withoutOpts.entries.map((e) => e.personId).sort(),
      );
    });

    it("a directory_hidden row is never returned, regardless of a matching search", async () => {
      const result = await getDirectory(control, orgA, { search: "Blythe" });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).not.toContain(
        hiddenPerson,
      );
      expect(result.entries).toHaveLength(0);
    });

    it("a hidden field's raw stored value matches NOTHING — the oracle is closed (F212, ER23a)", async () => {
      // fieldEmail's own fixture email is `${fieldEmail}@example.invalid`, so
      // searching the person's own id could only ever match via the RAW
      // (hidden) email. Before F212 that returned the row (with `email: null`),
      // which confirmed by trial that the hidden address existed. The search now
      // matches only what the card shows, so a hidden email finds no one.
      const result = await getDirectory(control, orgA, { search: fieldEmail });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.find((e) => e.personId === fieldEmail)).toBeUndefined();
      expect(result.entries).toHaveLength(0);
    });

    it("a hidden phone matches nothing either, while the same number on a person who shows it still matches", async () => {
      // Every field-privacy fixture person carries phone 555-0100; only fieldPhone hides it.
      const result = await getDirectory(control, orgA, { search: "555-0100" });
      if (result.kind !== "ok") throw new Error("expected ok");
      const ids = result.entries.map((e) => e.personId);
      expect(ids).not.toContain(fieldPhone);
      expect(ids).toContain(fieldEmail);
      expect(ids).toContain(fieldAddress);
    });

    it("someone with no directory.view grant still gets forbidden, search or not", async () => {
      const result = await getDirectory(forbiddenPerson, orgB, {
        search: "anything",
      });
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  describe("getHouseholds (Increment 3)", () => {
    it("lists a household with visible members, with the correct memberCount", async () => {
      const result = await getHouseholds(control, orgA);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const winterbourne = result.households.find(
        (h) => h.householdId === householdVisible,
      );
      expect(winterbourne).toBeDefined();
      expect(winterbourne?.name).toBe("The Winterbourne Family");
      expect(winterbourne?.memberCount).toBe(2);
      // Increment 4 not built yet — always null.
      expect(winterbourne?.deaconName).toBeNull();
    });

    it("drops a household whose only member is directory_hidden — zero visible members, not a household with a note", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.households.some((h) => h.householdId === householdHiddenOnly),
      ).toBe(false);
    });

    it("never surfaces another organization's household", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.households.some((h) => h.householdId === householdOrgB),
      ).toBe(false);
    });

    it("matches by household name, case-insensitive, trimmed", async () => {
      const result = await getHouseholds(control, orgA, {
        search: "  WINTERBOURNE  ",
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.households.map((h) => h.householdId)).toEqual([
        householdVisible,
      ]);
    });

    it("someone with no directory.view grant gets forbidden, not an empty list", async () => {
      const result = await getHouseholds(forbiddenPerson, orgB);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("does not swallow OrgAccessError into a result variant", async () => {
      await expect(
        getHouseholds(randomUUID(), orgA),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });
  });

  describe("getHouseholdDetail (Increment 3)", () => {
    it("returns the household's name and its visible members", async () => {
      const result = await getHouseholdDetail(control, orgA, householdVisible);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.household.name).toBe("The Winterbourne Family");
      expect(result.household.memberCount).toBe(2);
      expect(result.household.deaconName).toBeNull();
      expect(
        result.household.members.map((m) => m.personId).sort(),
      ).toEqual([hhPerson1, hhPerson2].sort());
    });

    it("returns not-found for a household whose only member is directory_hidden — indistinguishable from nonexistent", async () => {
      const result = await getHouseholdDetail(
        control,
        orgA,
        householdHiddenOnly,
      );
      expect(result).toEqual({ kind: "not-found" });
    });

    it("returns not-found for a genuinely nonexistent household id", async () => {
      const result = await getHouseholdDetail(control, orgA, randomUUID());
      expect(result).toEqual({ kind: "not-found" });
    });

    it("returns not-found (never forbidden, never a thrown error) for another organization's household id — cross-org isolation", async () => {
      const result = await getHouseholdDetail(control, orgA, householdOrgB);
      expect(result).toEqual({ kind: "not-found" });
    });

    it("returns not-found for a malformed id, rather than throwing a Postgres cast error", async () => {
      const result = await getHouseholdDetail(control, orgA, "not-a-uuid");
      expect(result).toEqual({ kind: "not-found" });
    });

    it("a directory_hidden household member never appears in another household's member list either — the shared predicate applies uniformly", async () => {
      const result = await getHouseholdDetail(control, orgA, householdVisible);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.household.members.map((m) => m.personId),
      ).not.toContain(hhHiddenPerson);
    });

    it("someone with no directory.view grant gets forbidden, not not-found", async () => {
      const result = await getHouseholdDetail(
        forbiddenPerson,
        orgB,
        householdOrgB,
      );
      expect(result).toEqual({ kind: "forbidden" });
    });
  });

  describe("getPersonDetail (Increment 3)", () => {
    it("returns the person's entry, including household linkage", async () => {
      const result = await getPersonDetail(control, orgA, hhPerson1);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.entry.firstName).toBe("Odalys");
      expect(result.entry.householdId).toBe(householdVisible);
      expect(result.entry.householdRole).toBe("head");
    });

    it("a directory_hidden person appears in NEITHER the members list, NOR any household's member list, NOR person detail", async () => {
      const directoryResult = await getDirectory(control, orgA);
      if (directoryResult.kind !== "ok") throw new Error("expected ok");
      expect(
        directoryResult.entries.map((e) => e.personId),
      ).not.toContain(hhHiddenPerson);

      const personResult = await getPersonDetail(control, orgA, hhHiddenPerson);
      expect(personResult).toEqual({ kind: "not-found" });

      const householdResult = await getHouseholdDetail(
        control,
        orgA,
        householdHiddenOnly,
      );
      expect(householdResult).toEqual({ kind: "not-found" });
    });

    it("returns not-found for a visitor with no roll status — a grantee, but not content, same as getDirectory()", async () => {
      const result = await getPersonDetail(control, orgA, visitorPerson);
      expect(result).toEqual({ kind: "not-found" });
    });

    it("returns not-found for a genuinely nonexistent person id", async () => {
      const result = await getPersonDetail(control, orgA, randomUUID());
      expect(result).toEqual({ kind: "not-found" });
    });

    it("returns not-found (never forbidden, never a thrown error) for another organization's person id — cross-org isolation", async () => {
      const result = await getPersonDetail(control, orgA, hhOrgBPerson);
      expect(result).toEqual({ kind: "not-found" });
    });

    it("returns not-found for a malformed id, rather than throwing a Postgres cast error", async () => {
      const result = await getPersonDetail(control, orgA, "not-a-uuid");
      expect(result).toEqual({ kind: "not-found" });
    });

    it("hidden fields stay hidden in getPersonDetail() too — a hidden email is never returned", async () => {
      const result = await getPersonDetail(control, orgA, fieldEmail);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entry.email).toBeNull();
      expect(result.entry.phone).not.toBeNull();
    });

    it("someone with no directory.view grant gets forbidden, not not-found", async () => {
      const result = await getPersonDetail(forbiddenPerson, orgB, hhOrgBPerson);
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("does not swallow OrgAccessError into a result variant", async () => {
      await expect(
        getPersonDetail(randomUUID(), orgA, control),
      ).rejects.toMatchObject({ name: "OrgAccessError" });
    });
  });

  describe("includeHidden re-verification (Increment 4)", () => {
    it("getDirectory(): an ordinary caller's includeHidden:true request is silently ignored", async () => {
      const result = await getDirectory(control, orgA, { includeHidden: true });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).not.toContain(hiddenPerson);
    });

    it("getDirectory(): a grant that has ENDED is treated identically to never having been granted", async () => {
      const result = await getDirectory(revokedGrantPerson, orgA, {
        includeHidden: true,
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).not.toContain(hiddenPerson);
    });

    it("getDirectory(): an elevated caller's includeHidden:true surfaces a directory_hidden row, with isHidden true", async () => {
      const result = await getDirectory(elevatedPerson, orgA, {
        includeHidden: true,
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      const entry = result.entries.find((e) => e.personId === hiddenPerson);
      expect(entry).toBeDefined();
      expect(entry?.isHidden).toBe(true);
    });

    it("getDirectory(): the SAME elevated caller omitting includeHidden sees exactly the ordinary result — the request, not just the grant, decides", async () => {
      const withOptIn = await getDirectory(elevatedPerson, orgA, {
        includeHidden: true,
      });
      const withoutOptIn = await getDirectory(elevatedPerson, orgA);
      if (withOptIn.kind !== "ok" || withoutOptIn.kind !== "ok") {
        throw new Error("expected ok");
      }
      expect(withoutOptIn.entries.map((e) => e.personId)).not.toContain(
        hiddenPerson,
      );
      expect(withOptIn.entries.map((e) => e.personId)).toContain(hiddenPerson);
    });

    it("getDirectory(): field-level hides are UNCHANGED for an elevated caller — includeHidden only lifts the row-level (directory_hidden) exclusion", async () => {
      const result = await getDirectory(elevatedPerson, orgA, {
        includeHidden: true,
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      const entry = result.entries.find((e) => e.personId === fieldEmail);
      expect(entry?.email).toBeNull();
    });

    it("an ordinary entry's isHidden is always false, never undefined-as-truthy", async () => {
      const result = await getDirectory(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const entry = result.entries.find((e) => e.personId === control);
      expect(entry?.isHidden).toBe(false);
    });

    it("getHouseholds(): an ordinary caller's includeHidden:true is ignored — a hidden-only household stays dropped", async () => {
      const result = await getHouseholds(control, orgA, {
        includeHidden: true,
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(
        result.households.some((h) => h.householdId === householdHiddenOnly),
      ).toBe(false);
    });

    it("getHouseholds(): an elevated caller's includeHidden:true surfaces the previously-dropped household", async () => {
      const result = await getHouseholds(elevatedPerson, orgA, {
        includeHidden: true,
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      const hh = result.households.find(
        (h) => h.householdId === householdHiddenOnly,
      );
      expect(hh).toBeDefined();
      expect(hh?.memberCount).toBe(1);
    });

    it("getHouseholdDetail(): an ordinary caller's includeHidden:true is ignored — stays not-found", async () => {
      const result = await getHouseholdDetail(
        control,
        orgA,
        householdHiddenOnly,
        { includeHidden: true },
      );
      expect(result).toEqual({ kind: "not-found" });
    });

    it("getHouseholdDetail(): an elevated caller's includeHidden:true reveals the household, with the member's isHidden true", async () => {
      const result = await getHouseholdDetail(
        elevatedPerson,
        orgA,
        householdHiddenOnly,
        { includeHidden: true },
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.household.memberCount).toBe(1);
      expect(result.household.members[0]?.isHidden).toBe(true);
    });

    it("getPersonDetail(): an ordinary caller's includeHidden:true is ignored — stays not-found", async () => {
      const result = await getPersonDetail(control, orgA, hhHiddenPerson, {
        includeHidden: true,
      });
      expect(result).toEqual({ kind: "not-found" });
    });

    it("getPersonDetail(): an elevated caller's includeHidden:true reveals the person, with isHidden true", async () => {
      const result = await getPersonDetail(
        elevatedPerson,
        orgA,
        hhHiddenPerson,
        { includeHidden: true },
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.entry.isHidden).toBe(true);
    });
  });

  describe("deacon derivation (Increment 4)", () => {
    it("getHouseholds(): an active district's household shows its deacon", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const hh = result.households.find(
        (h) => h.householdId === householdWithDeacon,
      );
      expect(hh?.deaconName).toBe("Thaddeus Okonkwo");
    });

    it("getHouseholds(): two active deacon terms on one district are resolved by the deterministic tie-break (starts_on desc), not by returning both", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const hh = result.households.find(
        (h) => h.householdId === householdWithDeacon,
      );
      // deaconActive2 (Thaddeus, starts 2022-06-01) beats deaconActive1
      // (Rosalind, starts 2020-01-01) — the later starts_on wins.
      expect(hh?.deaconName).not.toBe("Rosalind Fairweather");
      expect(hh?.deaconName).toBe("Thaddeus Okonkwo");
    });

    it("getHouseholds(): a vacant district (ended term, no successor) derives deaconName null, never a stale name", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const hh = result.households.find(
        (h) => h.householdId === householdVacantDistrict,
      );
      expect(hh?.deaconName).toBeNull();
    });

    it("getHouseholds(): a household with no district assigned renders the same null as a vacant one", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const hh = result.households.find(
        (h) => h.householdId === householdVisible,
      );
      expect(hh?.deaconName).toBeNull();
    });

    it("getHouseholds(): never surfaces another organization's deacon", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.households.map((h) => h.deaconName)).not.toContain(
        "Cassius Duvernay",
      );
    });

    it("getHouseholdDetail() matches getHouseholds()'s own deaconName for the same household — no drift between the two surfaces", async () => {
      const listResult = await getHouseholds(control, orgA);
      const detailResult = await getHouseholdDetail(
        control,
        orgA,
        householdWithDeacon,
      );
      if (listResult.kind !== "ok" || detailResult.kind !== "ok") {
        throw new Error("expected ok");
      }
      const fromList = listResult.households.find(
        (h) => h.householdId === householdWithDeacon,
      )?.deaconName;
      expect(detailResult.household.deaconName).toBe(fromList);
      expect(detailResult.household.deaconName).toBe("Thaddeus Okonkwo");
    });

    it("getHouseholdDetail(): an ended term with no successor derives null (vacant)", async () => {
      const result = await getHouseholdDetail(
        control,
        orgA,
        householdVacantDistrict,
      );
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.household.deaconName).toBeNull();
    });

    it("cross-org isolation: an orgA context can never reach orgB's deacon-bearing household by id, even requesting includeHidden", async () => {
      const result = await getHouseholdDetail(
        elevatedPerson,
        orgA,
        householdOrgBWithDeacon,
        { includeHidden: true },
      );
      expect(result).toEqual({ kind: "not-found" });
    });
  });

  describe("an ended relationship is not in the directory (F136)", () => {
    it("getDirectory omits an ended member, with and without a search", async () => {
      const all = await getDirectory(control, orgA);
      const searched = await getDirectory(control, orgA, { search: "Ashgrove" });
      if (all.kind !== "ok" || searched.kind !== "ok") {
        throw new Error("expected ok");
      }
      expect(all.entries.map((e) => e.personId)).not.toContain(endedMember);
      expect(searched.entries.map((e) => e.personId)).not.toContain(
        endedMember,
      );
    });

    it("getPersonDetail returns not-found for an ended member", async () => {
      const result = await getPersonDetail(control, orgA, endedMember);
      expect(result).toEqual({ kind: "not-found" });
    });

    it("getHouseholdDetail does not count or list an ended member", async () => {
      const result = await getHouseholdDetail(control, orgA, householdVisible);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.household.memberCount).toBe(2);
      expect(result.household.members.map((m) => m.personId).sort()).toEqual(
        [hhPerson1, hhPerson2].sort(),
      );
    });

    it("getHouseholds does not count an ended member", async () => {
      const result = await getHouseholds(control, orgA);
      if (result.kind !== "ok") throw new Error("expected ok");
      const winterbourne = result.households.find(
        (h) => h.householdId === householdVisible,
      );
      expect(winterbourne?.memberCount).toBe(2);
    });

    it("includeHidden does not resurrect an ended member", async () => {
      // The id-level check is getDirectory; the household-level one is
      // getHouseholds.
      const directory = await getDirectory(elevatedPerson, orgA, {
        includeHidden: true,
      });
      const households = await getHouseholds(elevatedPerson, orgA, {
        includeHidden: true,
      });
      if (directory.kind !== "ok" || households.kind !== "ok") {
        throw new Error("expected ok");
      }
      expect(directory.entries.map((e) => e.personId)).not.toContain(
        endedMember,
      );
      expect(
        households.households.find((h) => h.householdId === householdVisible)
          ?.memberCount,
      ).toBe(2);
    });

    it("an otherwise identical member with no end date is still listed", async () => {
      const result = await getDirectory(control, orgA, { search: "Ashgrove" });
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.entries.map((e) => e.personId)).toContain(currentSameShape);
    });
  });

  describe("countHouseholdDirectoryMembers (portal home)", () => {
    it("counts the ordinary directory's members of a household, excluding the ended one", async () => {
      const count = await withOrgContext(control, orgA, (tx) =>
        countHouseholdDirectoryMembers(tx, orgA, householdVisible),
      );
      // hhPerson1 + hhPerson2; endedMember (F136) is in the household but ended.
      expect(count).toBe(2);
    });

    it("agrees with the household page's own memberCount", async () => {
      const count = await withOrgContext(control, orgA, (tx) =>
        countHouseholdDirectoryMembers(tx, orgA, householdVisible),
      );
      const detail = await getHouseholdDetail(control, orgA, householdVisible);
      if (detail.kind !== "ok") throw new Error("expected ok");
      expect(count).toBe(detail.household.memberCount);
    });

    it("is 0 for a household whose only member is directory-hidden", async () => {
      const count = await withOrgContext(control, orgA, (tx) =>
        countHouseholdDirectoryMembers(tx, orgA, householdHiddenOnly),
      );
      expect(count).toBe(0);
    });

    it("never counts a directory-hidden member, even for a viewer who holds directory.view_hidden", async () => {
      // includeHidden is not a parameter: an elevated viewer gets the ordinary count.
      const count = await withOrgContext(elevatedPerson, orgA, (tx) =>
        countHouseholdDirectoryMembers(tx, orgA, householdHiddenOnly),
      );
      expect(count).toBe(0);
    });

    it("cannot see another org's household from this org's context", async () => {
      const count = await withOrgContext(control, orgA, (tx) =>
        countHouseholdDirectoryMembers(tx, orgA, householdOrgB),
      );
      expect(count).toBe(0);
    });

    it("counts a household in its own org", async () => {
      const count = await withOrgContext(forbiddenPerson, orgB, (tx) =>
        countHouseholdDirectoryMembers(tx, orgB, householdOrgB),
      );
      expect(count).toBe(1);
    });
  });

  // The roster read moved to src/lib/parishes.ts (`getParishesOverview`,
  // parishes.test.ts); the deacon derivation it shares stays here, exported.
  describe("deriveDeaconsByOrgUnit - the half-open rule (F265)", () => {
    async function derive(unitIds: string[]) {
      return withOrgContext(elevatedPerson, orgA, (tx) =>
        deriveDeaconsByOrgUnit(tx, orgA, unitIds),
      );
    }

    it("a deacon whose term is open today but has a FUTURE end date IS the district's deacon - regression for F265 (the old `ends_on is null` dropped them)", async () => {
      const map = await derive([orgUnitFutureEnd]);
      expect(map.get(orgUnitFutureEnd)).toBe("Esperanza Villareal");
    });

    it("a term that has NOT STARTED yet is not the district's deacon - regression for F265 (the old test counted it)", async () => {
      const map = await derive([orgUnitNotStarted]);
      expect(map.has(orgUnitNotStarted)).toBe(false);
    });

    it("an open-ended current term still resolves, and an ended-only district is vacant (unchanged)", async () => {
      const map = await derive([orgUnitActive, orgUnitVacant]);
      expect(map.get(orgUnitActive)).toBe("Thaddeus Okonkwo");
      expect(map.has(orgUnitVacant)).toBe(false);
    });

    it("never resolves another organization's district", async () => {
      const map = await derive([orgUnitOrgB]);
      expect(map.size).toBe(0);
    });

    it("an empty id list is an empty map, not an error", async () => {
      expect((await derive([])).size).toBe(0);
    });
  });
});

/**
 * Increment 5 (`2026-08-26-members-directory-pagination-search.md`) —
 * status filter, pagination, and the two regressions that matter most: the
 * RLS boundary must still hold under a filtered/paginated query, and the
 * three narrower `queryDirectoryRows()` callers (`getHouseholdDetail`,
 * `getPersonDetail`) must be completely unaffected when
 * they don't ask for either option. A SEPARATE, self-contained fixture
 * (own org, own people) rather than extending the shared one above —
 * `org-features.test.ts`'s own precedent for exactly this reason: isolating
 * a new increment's fixture avoids any risk of silently perturbing the
 * existing suite's row counts.
 */
describe.skipIf(!hasDb)(
  "getDirectory — Increment 5: status filter + pagination (Postgres-backed, real dev database)",
  () => {
    let getDirectory: typeof import("./directory").getDirectory;
    let getHouseholdDetail: typeof import("./directory").getHouseholdDetail;
    let getPersonDetail: typeof import("./directory").getPersonDetail;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let organizations: typeof import("@/lib/db/domain/org").organizations;
    let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
    let groups: typeof import("@/lib/db/domain/groups").groups;
    let people: typeof import("@/lib/db/domain/people").people;
    let memberships: typeof import("@/lib/db/domain/people").memberships;
    let households: typeof import("@/lib/db/domain/people").households;
    let permissions: typeof import("@/lib/db/domain/authz").permissions;
    let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
    let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
    let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;

    let orgA: string;
    let orgB: string;
    let viewerA: string; // orgA — holds directory.view via the derived group
    let viewerB: string; // orgB — same, isolated fixture for the RLS test
    let household: string; // orgA — for the narrower-caller regression

    // 5 orgA people: 2 active, 1 baptized, 1 affiliate, 1 other_participant
    // — enough to prove status narrows correctly AND to paginate with a
    // small pageSize without a huge fixture.
    let active1: string;
    let active2: string;
    let baptized1: string;
    let affiliate1: string;
    let otherParticipant1: string;
    let orgBPerson: string; // orgB — the RLS-isolation proof

    const allPeople: string[] = [];

    beforeAll(async () => {
      ({ getDirectory, getHouseholdDetail, getPersonDetail } =
        await import("./directory"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ organizations } = await import("@/lib/db/domain/org"));
      ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
      ({ people, memberships, households } = await import(
        "@/lib/db/domain/people"
      ));
      ({ permissions, appRoles, appRolePermissions, roleGrants } =
        await import("@/lib/db/domain/authz"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      async function makeOrg(label: string) {
        const [row] = await platform
          .insert(organizations)
          .values({
            // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
            deletableUntil: fixtureDeletableUntil(),
            organizationType: "congregation",
            name: `Fixture Congregation ${label} for directory.test.ts Increment 5`,
            slug: `directory-inc5-${label.toLowerCase()}-${stamp}`,
            path: `directory_inc5_${label.toLowerCase()}_${stamp}`,
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
      const groupA = await activeMembershipGroup(orgA);
      const groupB = await activeMembershipGroup(orgB);

      await platform
        .insert(permissions)
        .values({
          key: "directory.view",
          module: "directory",
          description: "Browse the congregation directory",
          sensitivityTier: 1,
        })
        .onConflictDoNothing();

      async function grantDirectoryView(organizationId: string, groupId: string) {
        const [role] = await platform
          .insert(appRoles)
          .values({
            organizationId,
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
          organizationId,
          roleId: role!.id,
          groupId,
          startsOn: "2000-01-01",
        });
      }
      await grantDirectoryView(orgA, groupA);
      await grantDirectoryView(orgB, groupB);

      async function person(first: string, last: string) {
        const [p] = await platform
          .insert(people)
          .values({
            firstName: first,
            lastName: last,
            deletableUntil: fixtureDeletableUntil(),
          })
          .returning({ id: people.id });
        allPeople.push(p!.id);
        return p!.id;
      }

      viewerA = await person("Wren", "Castellane");
      viewerB = await person("Idris", "Fennimore");
      active1 = await person("Aldric", "Bramwell");
      active2 = await person("Beatrix", "Coldharbor");
      baptized1 = await person("Corvina", "Delacroix");
      affiliate1 = await person("Dashiell", "Everhart");
      otherParticipant1 = await person("Fenwick", "Goodwin");
      orgBPerson = await person("Griselda", "Haverford");

      const [hh] = await platform
        .insert(households)
        .values({ organizationId: orgA, name: "Bramwell Household" })
        .returning({ id: households.id });
      household = hh!.id;

      async function membership(
        organizationId: string,
        personId: string,
        currentRoll: string,
        householdId?: string,
      ) {
        await platform.insert(memberships).values({
          organizationId,
          personId,
          engagementStatus: "regular",
          currentRoll,
          ...(householdId ? { householdId } : {}),
        });
      }

      await membership(orgA, viewerA, "active");
      await membership(orgA, active1, "active", household);
      await membership(orgA, active2, "active");
      await membership(orgA, baptized1, "baptized");
      await membership(orgA, affiliate1, "affiliate");
      await membership(orgA, otherParticipant1, "other_participant");
      await membership(orgB, viewerB, "active");
      await membership(orgB, orgBPerson, "active");
    });

    afterAll(async () => {
      const platform = getPlatformDb();
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

    describe("status filter", () => {
      it("narrows to exactly the matching current_roll value", async () => {
        const result = await getDirectory(viewerA, orgA, { status: "baptized" });
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.entries.map((e) => e.personId).sort()).toEqual(
          [baptized1].sort(),
        );
      });

      it("each of the four statuses returns exactly its own fixture person", async () => {
        const affiliateResult = await getDirectory(viewerA, orgA, {
          status: "affiliate",
        });
        const otherResult = await getDirectory(viewerA, orgA, {
          status: "other_participant",
        });
        if (affiliateResult.kind !== "ok" || otherResult.kind !== "ok") {
          throw new Error("expected ok");
        }
        expect(affiliateResult.entries.map((e) => e.personId)).toEqual([
          affiliate1,
        ]);
        expect(otherResult.entries.map((e) => e.personId)).toEqual([
          otherParticipant1,
        ]);
      });

      it("status='active' returns both active fixture people, never the other statuses", async () => {
        const result = await getDirectory(viewerA, orgA, { status: "active" });
        if (result.kind !== "ok") throw new Error("expected ok");
        const ids = result.entries.map((e) => e.personId);
        expect(ids).toEqual(expect.arrayContaining([viewerA, active1, active2]));
        expect(ids).not.toContain(baptized1);
        expect(ids).not.toContain(affiliate1);
        expect(ids).not.toContain(otherParticipant1);
      });

      it("omitting status returns every eligible row regardless of current_roll (today's unfiltered behavior, unchanged)", async () => {
        const result = await getDirectory(viewerA, orgA);
        if (result.kind !== "ok") throw new Error("expected ok");
        const ids = result.entries.map((e) => e.personId);
        expect(ids).toEqual(
          expect.arrayContaining([
            viewerA,
            active1,
            active2,
            baptized1,
            affiliate1,
            otherParticipant1,
          ]),
        );
      });
    });

    describe("rollStatuses filter (Community Members view, DECISION-197/201)", () => {
      it("narrows to a SET of roll values: the Members view is active, baptized and affiliate, never a participant", async () => {
        const result = await getDirectory(viewerA, orgA, {
          rollStatuses: ["active", "baptized", "affiliate"],
        });
        if (result.kind !== "ok") throw new Error("expected ok");
        const ids = result.entries.map((e) => e.personId).sort();
        expect(ids).toEqual([viewerA, active1, active2, baptized1, affiliate1].sort());
        expect(ids).not.toContain(otherParticipant1);
      });

      it("replaces the default branch: a 'regular' person with no roll yet is NOT admitted by it (a proposal waiting for the Session is not a member)", async () => {
        const platform = getPlatformDb();
        const [p] = await platform
          .insert(people)
          .values({ firstName: "Waiting", lastName: "ForSession", deletableUntil: fixtureDeletableUntil() })
          .returning({ id: people.id });
        allPeople.push(p!.id);
        try {
          await platform.insert(memberships).values({
            organizationId: orgA,
            personId: p!.id,
            engagementStatus: "regular",
          });
          const unfiltered = await getDirectory(viewerA, orgA);
          const filtered = await getDirectory(viewerA, orgA, {
            rollStatuses: ["active", "baptized", "affiliate"],
          });
          if (unfiltered.kind !== "ok" || filtered.kind !== "ok") throw new Error("expected ok");
          expect(unfiltered.entries.map((e) => e.personId)).toContain(p!.id);
          expect(filtered.entries.map((e) => e.personId)).not.toContain(p!.id);
        } finally {
          // This fixture is shared with the pagination tests below (their row
          // counts are exact), so the extra person LEAVES the live roll with
          // the test: ended, never deleted (a derived group row references
          // the membership, and ending is the soft path anyway). The fixture
          // teardown removes the rows.
          await platform.execute(
            sql`update memberships set ended_on = current_date where person_id = ${p!.id}::uuid`,
          );
        }
      });

      it("an EMPTY set matches nothing (never 'no filter', never an `in ()` syntax error); unknown values are dropped", async () => {
        const empty = await getDirectory(viewerA, orgA, { rollStatuses: [] });
        if (empty.kind !== "ok") throw new Error("expected ok");
        expect(empty.entries).toEqual([]);
        const emptyPaged = await getDirectory(viewerA, orgA, { rollStatuses: [], page: 1, pageSize: 10 });
        expect(emptyPaged.kind === "ok" && emptyPaged.pagination).toMatchObject({ total: 0, totalPages: 1 });

        const junk = await getDirectory(viewerA, orgA, {
          rollStatuses: ["visitor", "staff", "'; drop table memberships; --"] as never,
        });
        if (junk.kind !== "ok") throw new Error("expected ok");
        expect(junk.entries).toEqual([]);

        const mixed = await getDirectory(viewerA, orgA, {
          rollStatuses: ["baptized", "visitor"] as never,
        });
        expect(mixed.kind === "ok" && mixed.entries.map((e) => e.personId)).toEqual([baptized1]);
      });

      it("with status as well, the two intersect (status keeps its meaning)", async () => {
        const both = await getDirectory(viewerA, orgA, {
          status: "baptized",
          rollStatuses: ["active", "baptized"],
        });
        expect(both.kind === "ok" && both.entries.map((e) => e.personId)).toEqual([baptized1]);
        const disjoint = await getDirectory(viewerA, orgA, {
          status: "other_participant",
          rollStatuses: ["active", "baptized", "affiliate"],
        });
        expect(disjoint.kind === "ok" && disjoint.entries).toEqual([]);
      });

      it("the paginated count agrees with the rows, and another organization's people never appear", async () => {
        const result = await getDirectory(viewerA, orgA, {
          rollStatuses: ["active", "baptized", "affiliate"],
          page: 1,
          pageSize: 2,
        });
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.pagination).toMatchObject({ total: 5, totalPages: 3 });
        expect(result.entries).toHaveLength(2);
        const all = await getDirectory(viewerA, orgA, {
          rollStatuses: ["active", "baptized", "affiliate"],
        });
        expect(all.kind === "ok" && all.entries.map((e) => e.personId)).not.toContain(orgBPerson);
      });
    });

    describe("pagination", () => {
      it("returns the correct slice and pagination metadata for page 1", async () => {
        const result = await getDirectory(viewerA, orgA, {
          page: 1,
          pageSize: 2,
        });
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.entries).toHaveLength(2);
        expect(result.pagination).toEqual({
          page: 1,
          pageSize: 2,
          total: 6,
          totalPages: 3,
        });
      });

      it("returns a different, non-overlapping slice for page 2", async () => {
        const page1 = await getDirectory(viewerA, orgA, { page: 1, pageSize: 2 });
        const page2 = await getDirectory(viewerA, orgA, { page: 2, pageSize: 2 });
        if (page1.kind !== "ok" || page2.kind !== "ok") {
          throw new Error("expected ok");
        }
        const page1Ids = page1.entries.map((e) => e.personId);
        const page2Ids = page2.entries.map((e) => e.personId);
        expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
      });

      it("clamps an out-of-range page to the last valid page rather than erroring or returning empty", async () => {
        const result = await getDirectory(viewerA, orgA, {
          page: 99,
          pageSize: 2,
        });
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.pagination?.page).toBe(3); // 6 rows / pageSize 2 = 3 pages
        expect(result.entries.length).toBeGreaterThan(0);
      });

      it("search + status + pagination compose together correctly", async () => {
        const result = await getDirectory(viewerA, orgA, {
          search: "Bramwell",
          status: "active",
          page: 1,
          pageSize: 10,
        });
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.entries.map((e) => e.personId)).toEqual([active1]);
        expect(result.pagination?.total).toBe(1);
      });

      it("omitting page/pageSize returns no pagination field at all and every row, byte-identical to pre-Increment-5 behavior", async () => {
        const result = await getDirectory(viewerA, orgA);
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.pagination).toBeUndefined();
        expect(result.entries.length).toBeGreaterThanOrEqual(6);
      });
    });

    describe("RLS regression — a filtered, paginated, searched query never leaks another org's rows", () => {
      it("orgA's paginated+filtered+searched call returns zero orgB rows", async () => {
        const result = await getDirectory(viewerA, orgA, {
          search: "",
          status: "active",
          page: 1,
          pageSize: 50,
        });
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.entries.map((e) => e.personId)).not.toContain(orgBPerson);
        expect(result.entries.map((e) => e.personId)).not.toContain(viewerB);
      });

      it("orgB's own paginated call returns only orgB's own people", async () => {
        const result = await getDirectory(viewerB, orgB, { page: 1, pageSize: 50 });
        if (result.kind !== "ok") throw new Error("expected ok");
        const ids = result.entries.map((e) => e.personId);
        expect(ids).toEqual(expect.arrayContaining([viewerB, orgBPerson]));
        expect(ids).not.toContain(active1);
        expect(ids).not.toContain(baptized1);
      });
    });

    describe("narrower-caller regression — getHouseholdDetail/getPersonDetail unaffected by the new options they never pass", () => {
      it("getHouseholdDetail() still returns every eligible household member with no truncation", async () => {
        const result = await getHouseholdDetail(viewerA, orgA, household);
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.household.members.map((m) => m.personId)).toContain(
          active1,
        );
      });

      it("getPersonDetail() is unaffected by the status filter's existence — a baptized person's own detail still resolves with no status option passed", async () => {
        const result = await getPersonDetail(viewerA, orgA, baptized1);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.entry.personId).toBe(baptized1);
      });
    });
  },
);
