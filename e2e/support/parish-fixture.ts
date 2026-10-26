/**
 * parish-fixture.ts - a throwaway congregation for the parish-management e2e
 * specs (docs/work-log/2026-10-25-parish-management.md, Phase 3 "E2E blast
 * radius" and "Fixture shape"; follows `domains-ui-fixture.ts` and
 * `giving-fixture.ts`).
 *
 * The acting person is the `mfa-enrolled` fixture user - the one e2e user with a
 * computable TOTP secret, so a real 2FA challenge is completed first (the `/o/*`
 * Edge gate requires it) - a member of THIS congregation only. That user also
 * carries the platform `admin` role, which is exactly the point of the
 * "platform role confers nothing" spec: with no seat and no tenant key the user
 * is refused; recording the seat (a real `officer_terms` row) allows the very
 * next request. Authority is read live per request, so a spec swaps what the
 * user may do with `setActorRole` without logging in again:
 *
 *   "none"   - a member holding nothing                       (refused)
 *   "seat"   - an open `deacons_moderator` term; NO admin keys (the Moderator)
 *   "admin"  - `people.manage` + `officers.manage`             (the administrator)
 *
 * The seat is the production shape (drizzle/0068): a derived `roster` group
 * `deacons_moderator`, a protected constitutional role `deacons_moderator`
 * carrying `parishes.assign`, bound to that group (never to a person), and a
 * real term that the officer-sync trigger materialises into the group.
 *
 * Districts and households (all synthetic; no Real Data):
 *   North District, South District       active
 *   East District                        ARCHIVED, holding two households
 *   North holds one household with a directory-hidden member, one with no people
 *   unassigned: a member, a participant, a visitor, a listed household, a
 *               household whose only member is directory-hidden, and an empty one
 *
 * PERSON IDS live in one fixed range, `00000000-0000-4068-8000-0000000000NN`
 * (allocated by the orchestrator, Workflow Rule 16), so `sweepStaleParishFixtures`
 * can find them. The organization is `deletable_until`-stamped and removed with
 * one `delete from organizations`, retried on a Neon connection drop; its slug
 * prefix `e2e-parish-` is its own. `sweepStaleParishFixtures` is also called by
 * globalSetup (staged as scripts/parishes/global-setup.integration.patch):
 * without it a lost teardown leaves a membership for the `mfa-enrolled` user and
 * changes its post-login landing for every later spec (the custom-domains
 * lesson).
 */
import { generateSync } from "otplib";
import type { Browser, BrowserContext } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { E2E_TOTP_TEST_SECRET } from "./totp-fixture";
import { enterTotpCode, waitForTotpVerified } from "./totp-page";
import { E2E_USERS, storageStatePath } from "./users";

/** The fixed person-id range (the orchestrator's allocation for this pipeline). */
export const PARISH_PERSON_PREFIX = "00000000-0000-4068-8000-";
const personId = (n: number): string => `${PARISH_PERSON_PREFIX}${String(n).padStart(12, "0")}`;

export const PARISH_NAMES = {
  org: "E2E Parish Church",
  actorFirst: "Marguerite",
  actorLast: "Oakhollow",
} as const;

/** Upper bound for an expectation that waits on a server-action POST. */
export const ACTION_MS = 20_000;

export type ParishRole = "none" | "seat" | "admin";

export interface ParishFixture {
  orgId: string;
  slug: string;
  name: string;
  actorPersonId: string;
  actorUserId: string;
  /** The one seat term the fixture toggles (never deleted, only ended/re-opened). */
  seatTermId: string;
  districts: { north: string; south: string; east: string };
  households: {
    eastOne: string;
    eastTwo: string;
    northVisible: string;
    northHidden: string;
    unMember: string;
    unParticipant: string;
    unVisitor: string;
    unListed: string;
    unHidden: string;
  };
  /** The people whose names appear in assertions. */
  names: { unMember: string; unHiddenFirst: string };
}

const ACTOR = personId(1);
const ADMIN_ROLE = "00000000-0000-4068-9000-000000000001";
const SEAT_ROLE = "00000000-0000-4068-9000-000000000002";
const MEMBER_ROLE = "00000000-0000-4068-9000-000000000003";

function assertSlug(slug: string) {
  if (!/^e2e-parish-\d+$/.test(slug)) {
    throw new Error(`[parish-fixture] refusing to touch non-fixture slug "${slug}"`);
  }
}

async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await sql`select id from users where email = ${email}`) as { id: string }[];
  if (!rows[0]) throw new Error(`[parish-fixture] no user row for ${email}; globalSetup must run first`);
  return rows[0].id;
}

async function removeById(sql: Sql, orgId: string): Promise<void> {
  // The derived-roster trigger refuses the cascade a fixture org's delete fires against its
  // group_memberships; disabled around the delete, the whole unit retried so a drop between the
  // statements can never leave the trigger off. person_privacy has a NO ACTION composite FK onto
  // memberships, so it goes first. org_units are removed by the cascade (the owner-path delete guard
  // allows it once the parent organization is going).
  try {
    await withDbRetry(`delete org ${orgId}`, async () => {
      await sql`delete from person_privacy where organization_id = ${orgId}::uuid`;
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organizations where id = ${orgId}::uuid`;
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    });
  } finally {
    await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
  }
}

async function deleteFixturePeople(sql: Sql): Promise<void> {
  await withDbRetry("delete fixture people", () => sql`delete from people where id::text like ${`${PARISH_PERSON_PREFIX}%`}`);
}

/**
 * Removes any fixture org a crashed or dropped run left, and its fixed-range people. Safe to call at any
 * time and from globalSetup: it touches only `e2e-parish-<digits>` orgs and people in the fixture's range.
 */
export async function sweepStaleParishFixtures(sql: Sql): Promise<number> {
  const stale = await withDbRetry("list stale orgs", async () => (await sql`select id from organizations where slug ~ '^e2e-parish-[0-9]+$'`) as { id: string }[]);
  for (const { id } of stale) await removeById(sql, id);
  await deleteFixturePeople(sql);
  return stale.length;
}

async function addPerson(
  sql: Sql,
  orgId: string,
  n: number,
  first: string,
  last: string,
  opts: { roll?: string | null; engagement?: string; householdId?: string; userId?: string; hidden?: boolean } = {},
): Promise<string> {
  const id = personId(n);
  await sql`
    insert into people (id, user_id, first_name, last_name, deletable_until)
    values (${id}::uuid, ${opts.userId ?? null}::uuid, ${first}, ${last}, now() + interval '3 hours')`;
  await sql`
    insert into memberships (organization_id, person_id, household_id, engagement_status, current_roll)
    values (${orgId}::uuid, ${id}::uuid, ${opts.householdId ?? null}, ${opts.engagement ?? "regular"}, ${opts.roll === undefined ? "active" : opts.roll})`;
  if (opts.hidden) {
    await sql`insert into person_privacy (person_id, organization_id, directory_hidden) values (${id}::uuid, ${orgId}::uuid, true)`;
  }
  return id;
}

async function addHousehold(sql: Sql, orgId: string, name: string, orgUnitId: string | null = null): Promise<string> {
  const rows = (await sql`
    insert into households (organization_id, name, org_unit_id)
    values (${orgId}::uuid, ${name}, ${orgUnitId}::uuid) returning id`) as { id: string }[];
  return rows[0]!.id;
}

async function addUnit(sql: Sql, orgId: string, name: string): Promise<string> {
  const rows = (await sql`
    insert into org_units (organization_id, unit_type, name) values (${orgId}::uuid, 'district', ${name}) returning id`) as { id: string }[];
  return rows[0]!.id;
}

/**
 * Creates the congregation, the `org_portal.parishes` toggle ON (pass `{ toggle: false }` for OFF), the
 * acting user as a "none"-role member, districts, households and people.
 */
export async function setupParishFixture(sql: Sql, opts: { toggle?: boolean; stamp?: number } = {}): Promise<ParishFixture> {
  const stamp = opts.stamp ?? Date.now();
  const slug = `e2e-parish-${stamp}`;
  assertSlug(slug);
  // Unique per run: audit_events is append-only and keeps a run's rows forever.
  const orgId = `00000000-0000-4068-a000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  const userId = await userIdByEmail(sql, E2E_USERS["mfa-enrolled"].email);

  await sweepStaleParishFixtures(sql);

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${PARISH_NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  // The derived groups a congregation is provisioned with (src/lib/org-provisioning.ts).
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'court'), 'Board of Deacons', 'derived', 'diaconate', true`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Board of Deacons Moderator', 'derived', 'deacons_moderator', true`;

  // The baseline `member` role (directory.view) so the Directory page renders and offers its Parishes tab.
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${MEMBER_ROLE}::uuid, ${orgId}::uuid, 'member', 'Member', 'constitutional', true)`;
  await sql`insert into app_role_permissions (role_id, permission_key) values (${MEMBER_ROLE}::uuid, 'directory.view')`;
  await sql`
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    select ${orgId}::uuid, ${MEMBER_ROLE}::uuid, g.id, date '2020-01-01'
      from groups g where g.organization_id = ${orgId}::uuid and g.derived_from = 'active_membership'`;

  // The seat role, group-arm only (a person grant of it is refused by the database).
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${SEAT_ROLE}::uuid, ${orgId}::uuid, 'deacons_moderator', 'Moderator of the Board of Deacons', 'constitutional', true)`;
  await sql`insert into app_role_permissions (role_id, permission_key) values (${SEAT_ROLE}::uuid, 'parishes.assign')`;
  await sql`
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    select ${orgId}::uuid, ${SEAT_ROLE}::uuid, g.id, date '2020-01-01'
      from groups g where g.organization_id = ${orgId}::uuid and g.derived_from = 'deacons_moderator'`;

  // The administrator role (custom), granted to the actor only while the role is "admin".
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${ADMIN_ROLE}::uuid, ${orgId}::uuid, 'e2e_parish_admin', 'E2E Parish Admin', 'custom', false)`;
  await sql`insert into app_role_permissions (role_id, permission_key) values (${ADMIN_ROLE}::uuid, 'people.manage'), (${ADMIN_ROLE}::uuid, 'officers.manage')`;

  const north = await addUnit(sql, orgId, "North District");
  const south = await addUnit(sql, orgId, "South District");
  const east = await addUnit(sql, orgId, "East District");

  await addPerson(sql, orgId, 1, PARISH_NAMES.actorFirst, PARISH_NAMES.actorLast, { userId });

  // North: one visible household, one whose only member is directory-hidden.
  const northVisible = await addHousehold(sql, orgId, "Northwell Household", north);
  await addPerson(sql, orgId, 10, "Nadine", "Northwell", { householdId: northVisible });
  const northHidden = await addHousehold(sql, orgId, "Hollowmere Household", north);
  await addPerson(sql, orgId, 11, "Hollis", "Hollowmere", { householdId: northHidden, hidden: true });

  // East: assigned BEFORE it is archived (the database refuses assigning into an archived district).
  const eastOne = await addHousehold(sql, orgId, "Eastgate Household", east);
  await addPerson(sql, orgId, 12, "Edda", "Eastgate", { householdId: eastOne });
  const eastTwo = await addHousehold(sql, orgId, "Eastbrook Household", east);
  await addPerson(sql, orgId, 13, "Ewan", "Eastbrook", { householdId: eastTwo });
  await sql`update org_units set archived_at = now() where id = ${east}::uuid`;

  // Unassigned: one household per bucket, one directory-hidden, one with no people.
  const unMember = await addHousehold(sql, orgId, "Ashgrove Household");
  await addPerson(sql, orgId, 20, "Aldous", "Ashgrove", { householdId: unMember });
  const unParticipant = await addHousehold(sql, orgId, "Birchwood Household");
  await addPerson(sql, orgId, 21, "Bryony", "Birchwood", { householdId: unParticipant, roll: "other_participant" });
  const unVisitor = await addHousehold(sql, orgId, "Cedarview Household");
  await addPerson(sql, orgId, 22, "Corwin", "Cedarview", { householdId: unVisitor, roll: null, engagement: "visitor" });
  const unListed = await addHousehold(sql, orgId, "Dunmore Household");
  await addPerson(sql, orgId, 23, "Delphine", "Dunmore", { householdId: unListed, roll: null, engagement: "regular" });
  const unHidden = await addHousehold(sql, orgId, "Fernhollow Household");
  await addPerson(sql, orgId, 24, "Fenwick", "Fernhollow", { householdId: unHidden, hidden: true });
  await addHousehold(sql, orgId, "Gladewater Household (empty)");

  // The seat term exists from the start, ended (so "none" is the starting role). A seat is turned on by
  // re-opening this one row, never by deleting and re-inserting (terms are never deleted).
  const seatTerm = (await sql`
    insert into officer_terms (organization_id, person_id, office, starts_on, ends_on, end_reason)
    values (${orgId}::uuid, ${ACTOR}::uuid, 'deacons_moderator', date '2020-01-01', date '2021-01-01', 'completed')
    returning id`) as { id: string }[];

  if (opts.toggle !== false) await setToggle(sql, orgId, true);

  return {
    orgId,
    slug,
    name: PARISH_NAMES.org,
    actorPersonId: ACTOR,
    actorUserId: userId,
    seatTermId: seatTerm[0]!.id,
    districts: { north, south, east },
    households: { eastOne, eastTwo, northVisible, northHidden, unMember, unParticipant, unVisitor, unListed, unHidden },
    names: { unMember: "Aldous Ashgrove", unHiddenFirst: "Fenwick" },
  };
}

export async function setToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = 'org_portal.parishes'`;
    return;
  }
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, 'org_portal.parishes', ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}`;
}

/** What the acting user may do (authority is read live per request: no re-login). */
export async function setActorRole(sql: Sql, fx: ParishFixture, role: ParishRole): Promise<void> {
  await sql`delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.actorPersonId}::uuid`;
  if (role === "admin") {
    await sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${fx.orgId}::uuid, ${ADMIN_ROLE}::uuid, ${fx.actorPersonId}::uuid, date '2020-01-01', ${fx.actorUserId}::uuid)`;
  }
  if (role === "seat") {
    // Re-open the one seat term (open-ended, starting in the past).
    await sql`update officer_terms set ends_on = null, end_reason = null where id = ${fx.seatTermId}::uuid`;
  } else {
    await sql`update officer_terms set ends_on = date '2021-01-01', end_reason = 'completed' where id = ${fx.seatTermId}::uuid`;
  }
}

export async function removeParishFixture(sql: Sql, fx: ParishFixture | undefined): Promise<void> {
  if (!fx) return;
  assertSlug(fx.slug);
  await removeById(sql, fx.orgId);
  await deleteFixturePeople(sql);
  const left = await withDbRetry("confirm org gone", async () => (await sql`select 1 from organizations where id = ${fx.orgId}::uuid`) as unknown[]);
  if (left.length > 0) throw new Error(`[parish-fixture] ${fx.slug} was not removed`);
  const units = await withDbRetry("confirm districts gone", async () => (await sql`select 1 from org_units where organization_id = ${fx.orgId}::uuid`) as unknown[]);
  if (units.length > 0) throw new Error(`[parish-fixture] districts of ${fx.slug} survived its removal`);
}

/** The district a household is in now (null = none), straight from the database. */
export async function districtOf(sql: Sql, householdId: string): Promise<string | null> {
  const rows = (await sql`
    select u.name from households h left join org_units u on u.id = h.org_unit_id where h.id = ${householdId}::uuid`) as { name: string | null }[];
  return rows[0]?.name ?? null;
}

/** Audit rows for a household's district changes, oldest first. */
export async function districtAudit(sql: Sql, householdId: string): Promise<Array<{ metadata: Record<string, unknown>; actor_user_id: string | null }>> {
  return (await sql`
    select metadata, actor_user_id::text as actor_user_id from audit_events
     where action = 'tenant.household.district_changed' and resource_id = ${householdId}
     order by created_at`) as Array<{ metadata: Record<string, unknown>; actor_user_id: string | null }>;
}

/** One verified-TOTP session for the mfa-enrolled user, in a fresh browser context. */
export async function verifiedContext(browser: Browser, callbackPath = "/home"): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: storageStatePath("mfa-enrolled") });
  const page = await context.newPage();
  await page.goto(`/totp?callbackUrl=${encodeURIComponent(callbackPath)}`);
  // The sixth digit submits the code (DECISION-257); Verify is only the fallback, so it is not pressed.
  await enterTotpCode(page, generateSync({ secret: E2E_TOTP_TEST_SECRET }));
  await waitForTotpVerified(page);
  await page.close();
  return context;
}
