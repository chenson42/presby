/**
 * calendar-fixture.ts - setup and teardown for the member-calendar specs
 * (2026-10-14-member-calendar; DECISION-157: a spec creates only its own rows
 * and removes them itself).
 *
 * Everything lives at the e2e-alpha congregation (Wrenfield Presbyterian
 * Church) and is identified by a prefix the guards below enforce: event and
 * type ids start `e2ca`, role keys start `e2e_calendar_`, titles start
 * `E2E `. The owner connection (`platformSql`) writes it - it is fixture
 * plumbing, never application code - and `removeCalendarFixture` deletes by
 * those ids only. Idempotent: every insert is `on conflict do nothing`/guarded,
 * so a crashed prior run is repaired by the next `setup`.
 *
 * Dates are relative to the ORGANIZATION'S month (America/New_York, the
 * default zone: e2e-alpha has no organization_settings row), not the
 * database's UTC `current_date`, so the fixtures cannot land in the wrong month
 * on the last evening of one.
 */

import { withDbRetry, type Sql } from "./db";
import { E2E_ORGS } from "./seed-orgs";
import { E2E_USERS } from "./users";

export const CAL_ORG = E2E_ORGS.alpha;
export const CAL_FEATURE_KEY = "org_portal.calendar";

const ID_PREFIX = "e2ca0000-0000-4000-8000-";
const id = (n: number) => `${ID_PREFIX}${String(n).padStart(12, "0")}`;

export const CAL_IDS = {
  typeWorship: id(1),
  typeStudy: id(2),
  typeFallback: id(3),
  roleViewer: id(10),
  roleManager: id(11),
  eventTyped: id(101),
  eventUntyped: id(102),
  eventMembersOnly: id(103),
  eventCancelled: id(104),
  eventSeriesParent: id(110),
  eventSeriesChild1: id(111),
  eventSeriesChild2: id(112),
  otherOrgEvent: id(198),
  missingEvent: id(199),
} as const;

export const CAL_TITLES = {
  typed: "E2E Worship service",
  untyped: "E2E Untyped gathering",
  membersOnly: "E2E Members-only meeting",
  cancelled: "E2E Cancelled supper",
  series: "E2E Weekly study",
} as const;

export const CAL_PEOPLE = {
  /** org-single (Marguerite Ashcombe) and congregation-clerk (Ottoline Fairweather). */
  orgSingle: "e2e00000-0000-0000-0000-0000000000a1",
  congregationClerk: "e2e00000-0000-0000-0000-0000000000a7",
} as const;

function assertFixtureId(value: string) {
  if (!value.startsWith(ID_PREFIX)) {
    throw new Error(`[calendar-fixture] refusing to touch non-fixture id "${value}"`);
  }
}

export interface CalendarFixtureState {
  /** Whether this run created the fallback type (so teardown removes only what it made). */
  createdFallback: boolean;
  /** The toggle row's prior value, or null if there was none. */
  priorToggle: boolean | null;
}

async function adminUserId(sql: Sql): Promise<string> {
  const rows = (await withDbRetry("calendar admin user id", () => sql`select id from users where email = ${E2E_USERS.admin.email}`)) as { id: string }[];
  if (!rows[0]) throw new Error("[calendar-fixture] the admin fixture user does not exist");
  return rows[0].id;
}

/** Events, types and the toggle. Roles are granted per test with `grantRole`. */
export async function setupCalendarFixture(sql: Sql): Promise<CalendarFixtureState> {
  const org = CAL_ORG.id;

  const prior = (await sql`
    select enabled from organization_feature_toggles
     where organization_id = ${org}::uuid and feature_key = ${CAL_FEATURE_KEY}
  `) as { enabled: boolean }[];
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${org}::uuid, ${CAL_FEATURE_KEY}, true)
    on conflict (organization_id, feature_key) do update set enabled = true
  `;

  const hasFallback = (await sql`
    select 1 from event_types where organization_id = ${org}::uuid and is_fallback
  `) as unknown[];
  let createdFallback = false;
  if (hasFallback.length === 0) {
    await sql`
      insert into event_types (id, organization_id, name, color, icon, sort_order, is_fallback)
      values (${CAL_IDS.typeFallback}::uuid, ${org}::uuid, 'General', 'neutral', 'CalendarDays', 0, true)
      on conflict (id) do nothing
    `;
    createdFallback = true;
  } else {
    // A crashed prior run may have left our own fallback behind; keep owning it.
    const own = (await sql`select 1 from event_types where id = ${CAL_IDS.typeFallback}::uuid`) as unknown[];
    createdFallback = own.length > 0;
  }
  await sql`
    insert into event_types (id, organization_id, name, color, icon, sort_order)
    values (${CAL_IDS.typeWorship}::uuid, ${org}::uuid, 'E2E Worship', 'teal', 'Church', 10),
           (${CAL_IDS.typeStudy}::uuid, ${org}::uuid, 'E2E Study', 'sky', 'BookOpen', 20)
    on conflict (id) do nothing
  `;

  // Days 2-16 of the organization's current month, 10:30-ish. A weekly series
  // from day 2 puts a child on day 9 and day 16.
  const monthRows = (await sql`
    select to_char(date_trunc('month', now() at time zone 'America/New_York'), 'YYYY-MM-DD') as m
  `) as { m: string }[];
  const month = monthRows[0].m;
  await sql`
    insert into events
      (id, organization_id, title, location, starts_at, ends_at, is_public,
       cancelled_at, event_type_id, parent_event_id, recurrence_pattern, recurrence_count)
    select v.id::uuid, ${org}::uuid, v.title, v.location,
           ${month}::timestamp + v.offset_, ${month}::timestamp + v.offset_ + interval '1 hour',
           v.is_public, case when v.cancelled then now() end, v.type_id::uuid,
           v.parent::uuid, v.pattern, v.count_::int
      from (values
             (${CAL_IDS.eventTyped}, ${CAL_TITLES.typed}, 'Sanctuary', interval '2 days 10 hours 30 minutes', true, false, ${CAL_IDS.typeWorship}, null, null, null),
             (${CAL_IDS.eventUntyped}, ${CAL_TITLES.untyped}, 'Fellowship Hall', interval '4 days 12 hours', true, false, null, null, null, null),
             (${CAL_IDS.eventMembersOnly}, ${CAL_TITLES.membersOnly}, 'Library', interval '5 days 19 hours', false, false, ${CAL_IDS.typeStudy}, null, null, null),
             (${CAL_IDS.eventCancelled}, ${CAL_TITLES.cancelled}, 'Fellowship Hall', interval '6 days 18 hours', true, true, ${CAL_IDS.typeWorship}, null, null, null),
             (${CAL_IDS.eventSeriesParent}, ${CAL_TITLES.series}, 'Library', interval '1 day 19 hours', true, false, ${CAL_IDS.typeStudy}, null, 'weekly', '3'),
             (${CAL_IDS.eventSeriesChild1}, ${CAL_TITLES.series}, 'Library', interval '8 days 19 hours', true, false, ${CAL_IDS.typeStudy}, ${CAL_IDS.eventSeriesParent}, null, null),
             (${CAL_IDS.eventSeriesChild2}, ${CAL_TITLES.series}, 'Library', interval '15 days 19 hours', true, false, ${CAL_IDS.typeStudy}, ${CAL_IDS.eventSeriesParent}, null, null)
           ) as v(id, title, location, offset_, is_public, cancelled, type_id, parent, pattern, count_)
    on conflict (id) do nothing
  `;
  // An event that belongs to ANOTHER fixture congregation, for the cross-org 404.
  await sql`
    insert into events (id, organization_id, title, starts_at)
    values (${CAL_IDS.otherOrgEvent}::uuid, ${E2E_ORGS.beta.id}::uuid, 'E2E Other congregation event',
            ${month}::timestamp + interval '3 days 10 hours')
    on conflict (id) do nothing
  `;

  return { createdFallback, priorToggle: prior[0]?.enabled ?? null };
}

async function ensureRole(sql: Sql, roleId: string, key: string, name: string, perms: string[]) {
  assertFixtureId(roleId);
  if (!key.startsWith("e2e_calendar_")) throw new Error(`[calendar-fixture] bad role key "${key}"`);
  // Every insert is `on conflict ... do nothing`: a repeat after a lost reply ends the same.
  await withDbRetry(`ensure role ${key}`, async () => {
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleId}::uuid, ${CAL_ORG.id}::uuid, ${key}, ${name}, 'custom', false)
      on conflict (id) do nothing
    `;
    for (const permission of perms) {
      await sql`
        insert into app_role_permissions (role_id, permission_key)
        values (${roleId}::uuid, ${permission})
        on conflict do nothing
      `;
    }
  });
}

export type CalendarRole = "viewer" | "manager";

/** Grants the viewer (events.view) or manager (events.manage + event_types.manage) role. */
export async function grantCalendarRole(sql: Sql, role: CalendarRole, personId: string) {
  const roleId = role === "viewer" ? CAL_IDS.roleViewer : CAL_IDS.roleManager;
  if (role === "viewer") {
    await ensureRole(sql, roleId, "e2e_calendar_viewer", "E2E Calendar Viewer", ["events.view"]);
  } else {
    await ensureRole(sql, roleId, "e2e_calendar_manager", "E2E Calendar Manager", [
      "events.manage",
      "event_types.manage",
    ]);
  }
  const admin = await adminUserId(sql);
  await withDbRetry("grant calendar role", () => sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    select ${CAL_ORG.id}::uuid, ${roleId}::uuid, ${personId}::uuid, date '2020-01-01', ${admin}::uuid
     where not exists (
       select 1 from role_grants
        where person_id = ${personId}::uuid and organization_id = ${CAL_ORG.id}::uuid
          and role_id = ${roleId}::uuid)
  `);
}

export async function revokeCalendarRole(sql: Sql, role: CalendarRole, personId: string) {
  const roleId = role === "viewer" ? CAL_IDS.roleViewer : CAL_IDS.roleManager;
  assertFixtureId(roleId);
  await withDbRetry("revoke calendar role", () => sql`
    delete from role_grants
     where organization_id = ${CAL_ORG.id}::uuid and role_id = ${roleId}::uuid
       and person_id = ${personId}::uuid
  `);
}

export async function setCalendarToggle(sql: Sql, enabled: boolean) {
  await withDbRetry("set calendar toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${CAL_ORG.id}::uuid, ${CAL_FEATURE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}
  `);
}

/** Removes exactly what `setup`/`grant` created, then verifies nothing is left. */
export async function removeCalendarFixture(sql: Sql, state: CalendarFixtureState | null) {
  const org = CAL_ORG.id;
  if (!org.startsWith("e2e00000-")) throw new Error("[calendar-fixture] refusing a non-fixture org");
  const roleIds = [CAL_IDS.roleViewer, CAL_IDS.roleManager];
  roleIds.forEach(assertFixtureId);

  // Deletes, a constant update/upsert and a confirming read: repeating the whole unit ends the same.
  await withDbRetry("remove calendar fixture", async () => {
    await sql`delete from role_grants where organization_id = ${org}::uuid and role_id = any(${roleIds}::uuid[])`;
    await sql`delete from app_role_permissions where role_id = any(${roleIds}::uuid[])`;
    await sql`delete from app_roles where id = any(${roleIds}::uuid[])`;
    await sql`delete from events where id::text like ${ID_PREFIX + "%"}`;
    // Types created by the manager spec through the UI carry the "E2E " prefix too.
    await sql`delete from event_types where organization_id = ${org}::uuid and (id::text like ${ID_PREFIX + "%"} or name like 'E2E %')`;
    if (state?.priorToggle === null) {
      await sql`delete from organization_feature_toggles where organization_id = ${org}::uuid and feature_key = ${CAL_FEATURE_KEY}`;
    } else if (state) {
      await setCalendarToggle(sql, state.priorToggle);
    }

    const left = (await sql`
      select (select count(*) from events where id::text like ${ID_PREFIX + "%"})
           + (select count(*) from event_types where id::text like ${ID_PREFIX + "%"} or name like 'E2E %')
           + (select count(*) from app_roles where key like 'e2e_calendar_%') as n
    `) as { n: string }[];
    if (Number(left[0].n) !== 0) {
      throw new Error(`[calendar-fixture] teardown left ${left[0].n} fixture rows behind`);
    }
  });
}
