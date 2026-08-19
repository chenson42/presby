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
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)("getDirectory (Postgres-backed, real dev database)", () => {
  let getDirectory: typeof import("./directory").getDirectory;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;
  let groupTypes: typeof import("@/lib/db/domain/groups").groupTypes;
  let groups: typeof import("@/lib/db/domain/groups").groups;
  let people: typeof import("@/lib/db/domain/people").people;
  let memberships: typeof import("@/lib/db/domain/people").memberships;
  let contactMethods: typeof import("@/lib/db/domain/people").contactMethods;
  let addresses: typeof import("@/lib/db/domain/people").addresses;
  let personPrivacy: typeof import("@/lib/db/domain/privacy").personPrivacy;
  let permissions: typeof import("@/lib/db/domain/authz").permissions;
  let appRoles: typeof import("@/lib/db/domain/authz").appRoles;
  let appRolePermissions: typeof import("@/lib/db/domain/authz").appRolePermissions;
  let roleGrants: typeof import("@/lib/db/domain/authz").roleGrants;

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

  beforeAll(async () => {
    ({ getDirectory } = await import("./directory"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));
    ({ groupTypes, groups } = await import("@/lib/db/domain/groups"));
    ({ people, memberships, contactMethods, addresses } = await import(
      "@/lib/db/domain/people"
    ));
    ({ personPrivacy } = await import("@/lib/db/domain/privacy"));
    ({ permissions, appRoles, appRolePermissions, roleGrants } = await import(
      "@/lib/db/domain/authz"
    ));

    const platform = getPlatformDb();
    const stamp = Date.now();

    const [a] = await platform
      .insert(organizations)
      .values({
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
    // orgB deliberately gets NO app_roles/role_grants at all — that absence
    // is the fixture for the "no grant" case.

    async function person(first: string, last: string, dob: string | null) {
      const [p] = await platform
        .insert(people)
        .values({ firstName: first, lastName: last, dateOfBirth: dob })
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
  });

  afterAll(async () => {
    // person_privacy FIRST, then organizations, then people — order is load-
    // bearing. person_privacy.person_fk and group_memberships.person_fk are
    // both composite FKs onto `memberships` declared NO ACTION, not cascade
    // (see src/lib/db/domain/privacy.ts and groups.ts). Deleting the org
    // cascades `memberships` away; if a person_privacy row still points at
    // one of those rows, the cascade is rejected — group_memberships is safe
    // because it cascades from organizations too (same statement, same
    // cascade fan-out), but person_privacy has no organization-owned cascade
    // path at all and must be removed explicitly first. `people` last, since
    // organizations no longer references it once its memberships are gone.
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
    ].filter(Boolean);

    for (const id of allPeople) {
      await platform.delete(personPrivacy).where(eq(personPrivacy.personId, id));
    }
    await platform.delete(organizations).where(eq(organizations.id, orgA));
    await platform.delete(organizations).where(eq(organizations.id, orgB));
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
    expect(entry?.photoKey).toBeDefined();
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

  it("hide_photo nulls only the photo key", async () => {
    const result = await getDirectory(control, orgA);
    if (result.kind !== "ok") throw new Error("expected ok");
    const entry = result.entries.find((e) => e.personId === fieldPhoto);
    expect(entry?.photoKey).toBeNull();
    expect(entry?.email).not.toBeNull();
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
});
