/**
 * A throwaway-tenant harness for the DB-backed calendar suites
 * (`src/lib/calendar.test.ts`, `src/lib/event-types.test.ts`). TEST SUPPORT
 * ONLY - never imported by application code.
 *
 * It exists because both suites need the same ceremony - organizations stamped
 * `deletable_until`, each with the derived "Active Membership" group a
 * `memberships` insert requires (drizzle/0017), roles holding a permission,
 * people, grants, a user for `updated_by` - and the repo's per-file copies of
 * that ceremony are what the `fixture-deletable` tripwire exists to police.
 *
 * Every database module is imported INSIDE the functions, never at module
 * scope: `@/lib/db` constructs its connection pool at import time and throws
 * when DATABASE_URL is unset, so a top-level import would break the `hasDb`
 * skip in CI. The calling test file must `vi.mock("server-only")` itself.
 *
 * Names are synthetic (`example.invalid` addresses, invented names): No Real
 * Data.
 */
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

type OrgType =
  | "congregation"
  | "presbytery"
  | "synod"
  | "general_assembly"
  | "new_worshiping_community";

export interface FixtureOrgOptions {
  organizationType?: OrgType;
  /** An IANA zone for an `organization_settings` row, or `null` for NO settings row (the F132 case). Default: no row. */
  timeZone?: string | null;
  /** `true`/`false` writes a calendar toggle row with that value; `null` writes none. Default: null. */
  calendarToggle?: boolean | null;
}

export async function createCalendarFixture(label: string) {
  const { getPlatformDb } = await import("@/lib/db");
  const { organizations, organizationSettings } = await import(
    "@/lib/db/domain/org"
  );
  const { people, memberships } = await import("@/lib/db/domain/people");
  const { groupTypes, groups } = await import("@/lib/db/domain/groups");
  const { appRoles, appRolePermissions, roleGrants } = await import(
    "@/lib/db/domain/authz"
  );
  const { organizationFeatureToggles } = await import(
    "@/lib/db/domain/org-features"
  );
  const { users } = await import("@/lib/db/schema");

  const platform = getPlatformDb();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  let counter = 0;

  const [actor] = await platform
    .insert(users)
    .values({
      email: `${label}-actor-${stamp}@example.invalid`,
      name: "Calendar Fixture Actor",
    })
    .returning({ id: users.id });
  const actingUserId = actor!.id;

  let rosterTypeId: string;
  {
    const [inserted] = await platform
      .insert(groupTypes)
      .values({ key: "roster", name: "Roster" })
      .onConflictDoNothing()
      .returning({ id: groupTypes.id });
    if (inserted) {
      rosterTypeId = inserted.id;
    } else {
      const [existing] = await platform
        .select({ id: groupTypes.id })
        .from(groupTypes)
        .where(eq(groupTypes.key, "roster"))
        .limit(1);
      rosterTypeId = existing!.id;
    }
  }

  async function makeOrg(
    name: string,
    options: FixtureOrgOptions = {},
  ): Promise<string> {
    counter += 1;
    const slug = `${label}-${name}-${stamp}-${counter}`.toLowerCase();
    const [org] = await platform
      .insert(organizations)
      .values({
        deletableUntil: fixtureDeletableUntil(),
        organizationType: options.organizationType ?? "congregation",
        name: `Fixture ${name} for ${label}`,
        slug,
        path: slug.replace(/-/g, "_"),
        platformStatus: "unmanaged",
      })
      .returning({ id: organizations.id });
    const organizationId = org!.id;
    orgIds.push(organizationId);

    await platform.insert(groups).values({
      organizationId,
      groupTypeId: rosterTypeId,
      name: "Active Membership",
      membershipSource: "derived",
      derivedFrom: "active_membership",
      isProtected: true,
    });

    if (options.timeZone) {
      await platform
        .insert(organizationSettings)
        .values({ organizationId, timeZone: options.timeZone });
    }
    if (options.calendarToggle !== null && options.calendarToggle !== undefined) {
      await platform.insert(organizationFeatureToggles).values({
        organizationId,
        featureKey: "org_portal.calendar",
        enabled: options.calendarToggle,
        updatedBy: null,
      });
    }
    return organizationId;
  }

  async function makePerson(first: string, last: string): Promise<string> {
    const [p] = await platform
      .insert(people)
      .values({
        firstName: first,
        lastName: last,
        deletableUntil: fixtureDeletableUntil(),
      })
      .returning({ id: people.id });
    personIds.push(p!.id);
    return p!.id;
  }

  async function addMember(organizationId: string, personId: string) {
    await platform.insert(memberships).values({
      organizationId,
      personId,
      engagementStatus: "regular",
      currentRoll: "active",
    });
  }

  /** A custom role at `organizationId` holding exactly `permissionKeys`. */
  async function makeRole(
    organizationId: string,
    key: string,
    permissionKeys: readonly string[],
  ): Promise<string> {
    const [role] = await platform
      .insert(appRoles)
      .values({ organizationId, key, name: key, roleKind: "custom" })
      .returning({ id: appRoles.id });
    await platform
      .insert(appRolePermissions)
      .values(
        permissionKeys.map((permissionKey) => ({
          roleId: role!.id,
          permissionKey,
        })),
      );
    return role!.id;
  }

  async function grant(
    organizationId: string,
    roleId: string,
    personId: string,
  ) {
    await platform.insert(roleGrants).values({
      organizationId,
      roleId,
      personId,
      startsOn: "2020-01-01",
      grantedBy: actingUserId,
    });
  }

  /** Member + a role holding `permissionKeys` + the grant, in one call. */
  async function enroll(
    organizationId: string,
    personId: string,
    permissionKeys: readonly string[],
  ) {
    await addMember(organizationId, personId);
    if (permissionKeys.length === 0) return;
    const roleKey = `fx_${permissionKeys.join("_").replace(/\./g, "_")}`;
    const [existing] = await platform
      .select({ id: appRoles.id })
      .from(appRoles)
      .where(
        sql`${appRoles.organizationId} = ${organizationId} and ${appRoles.key} = ${roleKey}`,
      )
      .limit(1);
    const roleId =
      existing?.id ?? (await makeRole(organizationId, roleKey, permissionKeys));
    await grant(organizationId, roleId, personId);
  }

  async function cleanup() {
    // drizzle/0033's group_memberships_reject_derived trigger refuses the
    // cascade that deleting a fixture org fires against its derived rows -
    // disabled around the delete, as every other DB-backed suite does.
    await platform.execute(
      sql`alter table group_memberships disable trigger group_memberships_reject_derived`,
    );
    try {
      for (const id of orgIds) {
        await platform.delete(organizations).where(eq(organizations.id, id));
      }
    } finally {
      await platform.execute(
        sql`alter table group_memberships enable trigger group_memberships_reject_derived`,
      );
    }
    for (const id of personIds) {
      await platform.delete(people).where(eq(people.id, id));
    }
    await platform.delete(users).where(eq(users.id, actingUserId));
  }

  return {
    platform,
    actingUserId,
    makeOrg,
    makePerson,
    addMember,
    makeRole,
    grant,
    enroll,
    cleanup,
  };
}

export type CalendarFixture = Awaited<ReturnType<typeof createCalendarFixture>>;
