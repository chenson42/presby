/**
 * home-cards-fixture.ts - setup and teardown for portal-home-cards.spec.ts
 * (2026-10-14-portal-home-alignment; DECISION-157: a spec creates only its own
 * rows and removes them itself).
 *
 * Everything lives at the e2e-alpha congregation (Wrenfield Presbyterian
 * Church), written on the owner connection (`platformSql`) - fixture plumbing,
 * never application code. Every id starts `e2ce`, every role key
 * `e2e_home_`, every title/name `E2E `; the guards below refuse to touch
 * anything else, and teardown deletes by those ids only and then verifies
 * nothing is left. Idempotent: a crashed prior run is repaired by the next
 * `setup`.
 *
 * Reuses the existing fixture people (seed-orgs.ts) rather than creating new
 * ones: Marguerite Ashcombe (org-single) and Ottoline Fairweather
 * (congregation-clerk) share a spec-owned household; Tobias Fennimore
 * (org-multi) has neither household nor groups.
 *
 * Dates are relative to the ORGANIZATION'S today (America/New_York, the
 * default zone - e2e-alpha has no organization_settings row), never the
 * database's UTC `current_date`.
 */

import { withDbRetry, type Sql } from "./db";
import { E2E_ORGS } from "./seed-orgs";
import { E2E_USERS } from "./users";

export const HOME_ORG = E2E_ORGS.alpha;
export const CALENDAR_TOGGLE_KEY = "org_portal.calendar";

const ID_PREFIX = "e2ce0000-0000-4000-8000-";
const id = (n: number) => `${ID_PREFIX}${String(n).padStart(12, "0")}`;

export const HOME_IDS = {
  typeWorship: id(1),
  typeStudy: id(2),
  typeFallback: id(3),
  roleDirectory: id(10),
  roleEvents: id(11),
  household: id(20),
  groupAltar: id(30),
  groupLong: id(31),
  eventWorship: id(101),
  eventCancelled: id(102),
  eventLongTitle: id(103),
  eventUntyped: id(104),
  eventBeyondLimit: id(105),
  seriesParent: id(110),
  seriesPassed: id(111),
  seriesNext: id(112),
  seriesLater: id(113),
} as const;

export const HOME_PEOPLE = {
  /** org-single - Marguerite Ashcombe: household, groups, directory.view, events.view. */
  both: "e2e00000-0000-0000-0000-0000000000a1",
  /** congregation-clerk - Ottoline Fairweather: the household's second member. */
  housemate: "e2e00000-0000-0000-0000-0000000000a7",
  /** org-multi - Tobias Fennimore: events.view only; no household, no groups. */
  eventsOnly: "e2e00000-0000-0000-0000-0000000000a2",
} as const;

export const LONG_GROUP_NAME = `E2E-${"g".repeat(56)}`;
export const LONG_EVENT_TITLE = `E2E-${"t".repeat(56)}`;

export const HOME_TITLES = {
  worship: "E2E Home worship service",
  cancelled: "E2E Home cancelled supper",
  untyped: "E2E Home untyped gathering",
  beyondLimit: "E2E Home beyond the limit",
  series: "E2E Home weekly study",
  household: "E2E Home Household",
  groupAltar: "E2E Altar Guild",
} as const;

function assertFixtureId(value: string) {
  if (!value.startsWith(ID_PREFIX)) {
    throw new Error(`[home-cards-fixture] refusing to touch non-fixture id "${value}"`);
  }
}

export interface HomeFixtureState {
  priorToggle: boolean | null;
  createdFallback: boolean;
  priorHouseholds: Array<{ personId: string; householdId: string | null }>;
  /** The org-zone date the events were laid out from. */
  today: string;
  /** "Sun, Oct 18"-style label of the series' next occurrence. */
  seriesNextLabel: string;
}

async function adminUserId(sql: Sql): Promise<string> {
  const rows = (await withDbRetry("home admin user id", () => sql`select id from users where email = ${E2E_USERS.admin.email}`)) as { id: string }[];
  if (!rows[0]) throw new Error("[home-cards-fixture] the admin fixture user does not exist");
  return rows[0].id;
}

export async function setCalendarToggle(sql: Sql, enabled: boolean) {
  await withDbRetry("set calendar toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${HOME_ORG.id}::uuid, ${CALENDAR_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}
  `);
}

async function ensureRole(sql: Sql, roleId: string, key: string, name: string, permission: string) {
  assertFixtureId(roleId);
  if (!key.startsWith("e2e_home_")) throw new Error(`[home-cards-fixture] bad role key "${key}"`);
  // Both inserts are `on conflict ... do nothing`: a repeat after a lost reply ends the same.
  await withDbRetry(`ensure role ${key}`, async () => {
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleId}::uuid, ${HOME_ORG.id}::uuid, ${key}, ${name}, 'custom', false)
      on conflict (id) do nothing
    `;
    await sql`
      insert into app_role_permissions (role_id, permission_key)
      values (${roleId}::uuid, ${permission})
      on conflict do nothing
    `;
  });
}

async function grant(sql: Sql, roleId: string, personId: string, admin: string) {
  await withDbRetry("grant home role", () => sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    select ${HOME_ORG.id}::uuid, ${roleId}::uuid, ${personId}::uuid, date '2020-01-01', ${admin}::uuid
     where not exists (
       select 1 from role_grants
        where person_id = ${personId}::uuid and organization_id = ${HOME_ORG.id}::uuid
          and role_id = ${roleId}::uuid)
  `);
}

/** Toggle on, roles and grants, household, groups, event types and events. */
export async function setupHomeFixture(sql: Sql): Promise<HomeFixtureState> {
  const org = HOME_ORG.id;
  const admin = await adminUserId(sql);

  const prior = (await sql`
    select enabled from organization_feature_toggles
     where organization_id = ${org}::uuid and feature_key = ${CALENDAR_TOGGLE_KEY}
  `) as { enabled: boolean }[];
  await setCalendarToggle(sql, true);

  // Roles: directory.view and events.view, granted per person.
  await ensureRole(sql, HOME_IDS.roleDirectory, "e2e_home_directory", "E2E Home Directory", "directory.view");
  await ensureRole(sql, HOME_IDS.roleEvents, "e2e_home_events", "E2E Home Events", "events.view");
  await grant(sql, HOME_IDS.roleDirectory, HOME_PEOPLE.both, admin);
  await grant(sql, HOME_IDS.roleEvents, HOME_PEOPLE.both, admin);
  await grant(sql, HOME_IDS.roleEvents, HOME_PEOPLE.eventsOnly, admin);

  // A two-person household (both eligible: regular, not ended, not hidden).
  const people = [HOME_PEOPLE.both, HOME_PEOPLE.housemate];
  const priorHouseholds = (await sql`
    select person_id::text as "personId", household_id::text as "householdId"
      from memberships
     where organization_id = ${org}::uuid and person_id = any(${people}::uuid[])
  `) as HomeFixtureState["priorHouseholds"];
  await sql`
    insert into households (id, organization_id, name)
    values (${HOME_IDS.household}::uuid, ${org}::uuid, ${HOME_TITLES.household})
    on conflict (id) do nothing
  `;
  await sql`
    update memberships set household_id = ${HOME_IDS.household}::uuid
     where organization_id = ${org}::uuid and person_id = any(${people}::uuid[])
  `;

  // Two managed groups for the "both" person; the second has an unbroken name.
  for (const [groupId, name] of [
    [HOME_IDS.groupAltar, HOME_TITLES.groupAltar],
    [HOME_IDS.groupLong, LONG_GROUP_NAME],
  ] as const) {
    await sql`
      insert into groups (id, organization_id, group_type_id, name)
      select ${groupId}::uuid, ${org}::uuid, (select id from group_types where key = 'roster'), ${name}
      on conflict (id) do nothing
    `;
    await sql`
      insert into group_memberships (organization_id, group_id, person_id, starts_on)
      select ${org}::uuid, ${groupId}::uuid, ${HOME_PEOPLE.both}::uuid, date '2020-01-01'
       where not exists (
         select 1 from group_memberships
          where group_id = ${groupId}::uuid and person_id = ${HOME_PEOPLE.both}::uuid)
    `;
  }

  // Event types (the fallback only if the org has none, so teardown removes
  // only what this run made).
  const hasFallback = (await sql`
    select 1 from event_types where organization_id = ${org}::uuid and is_fallback
  `) as unknown[];
  let createdFallback = false;
  if (hasFallback.length === 0) {
    await sql`
      insert into event_types (id, organization_id, name, color, icon, sort_order, is_fallback)
      values (${HOME_IDS.typeFallback}::uuid, ${org}::uuid, 'General', 'neutral', 'CalendarDays', 0, true)
      on conflict (id) do nothing
    `;
    createdFallback = true;
  } else {
    const own = (await sql`select 1 from event_types where id = ${HOME_IDS.typeFallback}::uuid`) as unknown[];
    createdFallback = own.length > 0;
  }
  await sql`
    insert into event_types (id, organization_id, name, color, icon, sort_order)
    values (${HOME_IDS.typeWorship}::uuid, ${org}::uuid, 'E2E Home Worship', 'teal', 'Church', 10),
           (${HOME_IDS.typeStudy}::uuid, ${org}::uuid, 'E2E Home Study', 'sky', 'BookOpen', 20)
    on conflict (id) do nothing
  `;

  // Events, laid out from the org-zone today:
  //   +1 10:30  worship (typed)                       -> row 1
  //   +1 08:00  cancelled                              -> never shown
  //   +2 19:00  the SERIES - its parent (-14) and first child (-7) have passed
  //             -> row 2, once, with this date
  //   +3 09:00  60-char unbroken title                 -> row 3
  //   +4 12:00  untyped                                -> row 4
  //   +6 09:00  beyond the four-row limit              -> never shown
  const todayRows = (await sql`
    select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as today,
           to_char((now() at time zone 'America/New_York')::date + 2, 'FMDy, FMMon FMDD') as label
  `) as { today: string; label: string }[];
  const today = todayRows[0].today;
  const seriesNextLabel = todayRows[0].label;

  await sql`
    insert into events
      (id, organization_id, title, location, starts_at, ends_at, is_public,
       cancelled_at, event_type_id, parent_event_id, recurrence_pattern, recurrence_count)
    select v.id::uuid, ${org}::uuid, v.title, v.location,
           (${today}::date + v.day_::int) + v.at_::time,
           (${today}::date + v.day_::int) + v.at_::time + interval '1 hour',
           true, case when v.cancelled then now() end, v.type_id::uuid,
           v.parent::uuid, v.pattern, v.count_::int
      from (values
        (${HOME_IDS.eventWorship}, ${HOME_TITLES.worship}, 'Sanctuary', 1, '10:30', false, ${HOME_IDS.typeWorship}, null, null, null),
        (${HOME_IDS.eventCancelled}, ${HOME_TITLES.cancelled}, 'Fellowship Hall', 1, '08:00', true, ${HOME_IDS.typeWorship}, null, null, null),
        (${HOME_IDS.seriesParent}, ${HOME_TITLES.series}, 'Library', -14, '19:00', false, ${HOME_IDS.typeStudy}, null, 'weekly', '4'),
        (${HOME_IDS.seriesPassed}, ${HOME_TITLES.series}, 'Library', -7, '19:00', false, ${HOME_IDS.typeStudy}, ${HOME_IDS.seriesParent}, null, null),
        (${HOME_IDS.seriesNext}, ${HOME_TITLES.series}, 'Library', 2, '19:00', false, ${HOME_IDS.typeStudy}, ${HOME_IDS.seriesParent}, null, null),
        (${HOME_IDS.seriesLater}, ${HOME_TITLES.series}, 'Library', 9, '19:00', false, ${HOME_IDS.typeStudy}, ${HOME_IDS.seriesParent}, null, null),
        (${HOME_IDS.eventLongTitle}, ${LONG_EVENT_TITLE}, ${"L".repeat(60)}, 3, '09:00', false, ${HOME_IDS.typeWorship}, null, null, null),
        (${HOME_IDS.eventUntyped}, ${HOME_TITLES.untyped}, 'Fellowship Hall', 4, '12:00', false, null, null, null, null),
        (${HOME_IDS.eventBeyondLimit}, ${HOME_TITLES.beyondLimit}, 'Library', 6, '09:00', false, ${HOME_IDS.typeStudy}, null, null, null)
      ) as v(id, title, location, day_, at_, cancelled, type_id, parent, pattern, count_)
    on conflict (id) do nothing
  `;

  return {
    priorToggle: prior[0]?.enabled ?? null,
    createdFallback,
    priorHouseholds,
    today,
    seriesNextLabel,
  };
}

/** Removes exactly what `setup` created, restores the prior values, then verifies. */
export async function removeHomeFixture(sql: Sql, state: HomeFixtureState | null) {
  const org = HOME_ORG.id;
  if (!org.startsWith("e2e00000-")) throw new Error("[home-cards-fixture] refusing a non-fixture org");
  const roleIds = [HOME_IDS.roleDirectory, HOME_IDS.roleEvents];
  const groupIds = [HOME_IDS.groupAltar, HOME_IDS.groupLong];
  [...roleIds, ...groupIds, HOME_IDS.household].forEach(assertFixtureId);

  // Updates to captured constants, deletes, an upsert and a confirming read: repeating the whole unit ends the same.
  await withDbRetry("remove home fixture", async () => {
    // Restore the shared people's household links BEFORE the household goes.
    for (const p of state?.priorHouseholds ?? []) {
      await sql`
        update memberships set household_id = ${p.householdId}::uuid
         where organization_id = ${org}::uuid and person_id = ${p.personId}::uuid
      `;
    }
    await sql`
      update memberships set household_id = null
       where organization_id = ${org}::uuid and household_id = ${HOME_IDS.household}::uuid
    `;
    await sql`delete from households where id = ${HOME_IDS.household}::uuid`;
    await sql`delete from group_memberships where organization_id = ${org}::uuid and group_id = any(${groupIds}::uuid[])`;
    await sql`delete from groups where id = any(${groupIds}::uuid[])`;
    await sql`delete from role_grants where organization_id = ${org}::uuid and role_id = any(${roleIds}::uuid[])`;
    await sql`delete from app_role_permissions where role_id = any(${roleIds}::uuid[])`;
    await sql`delete from app_roles where id = any(${roleIds}::uuid[])`;
    await sql`delete from events where id::text like ${ID_PREFIX + "%"}`;
    await sql`delete from event_types where id::text like ${ID_PREFIX + "%"}`;
    if (state?.priorToggle === null) {
      await sql`delete from organization_feature_toggles where organization_id = ${org}::uuid and feature_key = ${CALENDAR_TOGGLE_KEY}`;
    } else if (state) {
      await setCalendarToggle(sql, state.priorToggle);
    }

    const left = (await sql`
      select (select count(*) from events where id::text like ${ID_PREFIX + "%"})
           + (select count(*) from event_types where id::text like ${ID_PREFIX + "%"})
           + (select count(*) from groups where id::text like ${ID_PREFIX + "%"})
           + (select count(*) from households where id::text like ${ID_PREFIX + "%"})
           + (select count(*) from app_roles where key like 'e2e_home_%') as n
    `) as { n: string }[];
    if (Number(left[0].n) !== 0) {
      throw new Error(`[home-cards-fixture] teardown left ${left[0].n} fixture rows behind`);
    }
  });
}
