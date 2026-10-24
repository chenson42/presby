/**
 * community-fixture.ts - setup and teardown for the Community specs
 * (2026-10-22-founding-admin-directory, Batch D; DECISION-157: a spec creates
 * only its own rows and removes them itself).
 *
 * Everything lives at the e2e-alpha congregation (Wrenfield Presbyterian
 * Church) and is written on the owner connection (`platformSql`), which is
 * fixture plumbing, never application code.
 *
 * WHO CAN DO WHAT. The existing `congregation-clerk` fixture (Ottoline
 * Fairweather) holds `statistics.publish` only, and widening that role would
 * change what every other spec sees. So this adds ONE new role,
 * `e2e_community_clerk` (people.manage, roll.propose, directory.view), and
 * grants it to her. Nothing existing is widened, so no existing spec can break.
 * The limited-state spec temporarily removes `directory.view` from THIS role
 * only, and restores it.
 *
 * WHAT IT CAPTURES AND RESTORES. The `org_portal.members_create` and
 * `org_portal.members_roll_action_edit` platform flags, and alpha's
 * `org_portal.members_create` toggle row (all three are what a real congregation
 * flips on), each restored by SELECT-verified writes.
 *
 * NAMES. Every person the specs add is named `E2ECommunity <tag>` /
 * `Spec<tag>`; the sweep deletes by that first name only (guarded), and the
 * person ids a spec created through SQL carry the `e2ce1000-` prefix.
 *
 * DELETION. People are never hard-deleted by the application. The fixture
 * exemption is the `deletable_until` window (drizzle/0048), opened here
 * narrowly against the same predicate the delete uses, because the rows were
 * made by production code through the UI and so were not stamped at insert.
 * Approved roll rows are frozen, and a membership's derived group row rejects a
 * direct delete, so both triggers are disabled around the delete exactly as
 * every other fixture teardown does, inside a try/finally that re-enables them.
 */

import type { Sql } from "./db";
import { E2E_ORGS } from "./seed-orgs";
import { E2E_USERS } from "./users";

export const COMMUNITY_ORG = E2E_ORGS.alpha;
export const MEMBERS_CREATE = "org_portal.members_create";
export const ROLL_ACTION_EDIT = "org_portal.members_roll_action_edit";

export const FIXTURE_FIRST_NAME = "E2ECommunity";
const ROLE_ID = "e2ce1000-0000-4000-8000-000000000001";
const ROLE_KEY = "e2e_community_clerk";
const SQL_PERSON_PREFIX = "e2ce1000-0000-4000-8000-";

/** The clerk fixture person (Ottoline Fairweather) and her platform user. */
export const CLERK_PERSON_ID = "e2e00000-0000-0000-0000-0000000000a7";
export const CLERK_EMAIL = E2E_USERS["congregation-clerk"].email;

export interface CommunityFixtureState {
  priorFlags: Record<string, boolean>;
  priorToggle: boolean | null;
}

async function adminUserId(sql: Sql): Promise<string> {
  const rows = (await sql`select id from users where email = ${E2E_USERS.admin.email}`) as { id: string }[];
  if (!rows[0]) throw new Error("[community-fixture] the admin fixture user does not exist");
  return rows[0].id;
}

function assertSqlPersonId(value: string) {
  if (!value.startsWith(SQL_PERSON_PREFIX)) {
    throw new Error(`[community-fixture] refusing to touch non-fixture person id "${value}"`);
  }
}

export async function setupCommunityFixture(sql: Sql): Promise<CommunityFixtureState> {
  const priorFlags: Record<string, boolean> = {};
  for (const key of [MEMBERS_CREATE, ROLL_ACTION_EDIT]) {
    const rows = (await sql`select enabled from feature_flags where key = ${key}`) as { enabled: boolean }[];
    if (!rows[0]) throw new Error(`[community-fixture] no feature_flags row for ${key}`);
    priorFlags[key] = rows[0].enabled;
    await sql`update feature_flags set enabled = true where key = ${key}`;
  }

  const toggle = (await sql`
    select enabled from organization_feature_toggles
     where organization_id = ${COMMUNITY_ORG.id}::uuid and feature_key = ${MEMBERS_CREATE}
  `) as { enabled: boolean }[];
  const priorToggle = toggle[0]?.enabled ?? null;
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${COMMUNITY_ORG.id}::uuid, ${MEMBERS_CREATE}, true)
    on conflict (organization_id, feature_key) do update set enabled = true
  `;

  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${ROLE_ID}::uuid, ${COMMUNITY_ORG.id}::uuid, ${ROLE_KEY}, 'E2E Community Clerk', 'custom', false)
    on conflict (id) do nothing
  `;
  for (const key of ["people.manage", "roll.propose", "directory.view"]) {
    await sql`
      insert into app_role_permissions (role_id, permission_key)
      values (${ROLE_ID}::uuid, ${key})
      on conflict do nothing
    `;
  }
  const admin = await adminUserId(sql);
  await sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    select ${COMMUNITY_ORG.id}::uuid, ${ROLE_ID}::uuid, ${CLERK_PERSON_ID}::uuid, date '2020-01-01', ${admin}::uuid
     where not exists (
       select 1 from role_grants
        where person_id = ${CLERK_PERSON_ID}::uuid
          and organization_id = ${COMMUNITY_ORG.id}::uuid
          and role_id = ${ROLE_ID}::uuid
     )
  `;

  return { priorFlags, priorToggle };
}

/** Removes or restores the one permission the limited-state spec toggles. */
export async function setDirectoryView(sql: Sql, granted: boolean): Promise<void> {
  if (granted) {
    await sql`
      insert into app_role_permissions (role_id, permission_key)
      values (${ROLE_ID}::uuid, 'directory.view')
      on conflict do nothing
    `;
  } else {
    await sql`delete from app_role_permissions where role_id = ${ROLE_ID}::uuid and permission_key = 'directory.view'`;
  }
}

export interface SqlParticipant {
  personId: string;
  firstName: string;
  lastName: string;
}

/**
 * A current participant written on the owner connection (an approved
 * enrolment, with the cache the sync trigger writes), for specs that need one
 * without walking the wizard. The id carries the fixture prefix.
 */
export async function createParticipantViaSql(sql: Sql, n: number, lastName: string): Promise<SqlParticipant> {
  const personId = `${SQL_PERSON_PREFIX}${String(100 + n).padStart(12, "0")}`;
  assertSqlPersonId(personId);
  const firstName = FIXTURE_FIRST_NAME;
  await sql`
    insert into people (id, first_name, last_name, deletable_until)
    values (${personId}::uuid, ${firstName}, ${lastName}, now() + interval '2 hours')
    on conflict (id) do nothing
  `;
  await sql`
    insert into memberships (person_id, organization_id, engagement_status)
    select ${personId}::uuid, ${COMMUNITY_ORG.id}::uuid, 'regular'
     where not exists (
       select 1 from memberships where person_id = ${personId}::uuid and organization_id = ${COMMUNITY_ORG.id}::uuid
     )
  `;
  await sql`
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                              approval_status, approved_on, recorded_at)
    select ${COMMUNITY_ORG.id}::uuid, ${personId}::uuid, 'other_participant_enrolled', date '2026-01-15',
           'other_participant', 'approved', date '2026-01-15', now()
     where not exists (select 1 from roll_actions where person_id = ${personId}::uuid)
  `;
  return { personId, firstName, lastName };
}

/**
 * A staff anchor written on the owner connection: a live membership with
 * engagement 'staff', no roll and no staff position, the exact shape
 * `presby_accept_invitation` writes for an invited administrator or treasurer.
 * The id carries the fixture prefix, so the sweep removes it.
 */
export async function createStaffAnchorViaSql(sql: Sql, n: number, lastName: string): Promise<SqlParticipant> {
  const personId = `${SQL_PERSON_PREFIX}${String(200 + n).padStart(12, "0")}`;
  assertSqlPersonId(personId);
  const firstName = FIXTURE_FIRST_NAME;
  await sql`
    insert into people (id, first_name, last_name, deletable_until)
    values (${personId}::uuid, ${firstName}, ${lastName}, now() + interval '2 hours')
    on conflict (id) do nothing
  `;
  await sql`
    insert into memberships (person_id, organization_id, engagement_status)
    select ${personId}::uuid, ${COMMUNITY_ORG.id}::uuid, 'staff'
     where not exists (
       select 1 from memberships where person_id = ${personId}::uuid and organization_id = ${COMMUNITY_ORG.id}::uuid
     )
  `;
  return { personId, firstName, lastName };
}

/** Deletes every person this fixture's specs created, by the guarded first name. */
export async function sweepCommunityPeople(sql: Sql): Promise<number> {
  const rows = (await sql`
    select id from people
     where first_name = ${FIXTURE_FIRST_NAME}
       and exists (select 1 from memberships m where m.person_id = people.id and m.organization_id = ${COMMUNITY_ORG.id}::uuid)
  `) as { id: string }[];
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await sql`update people set deletable_until = now() + interval '1 hour' where id = any(${ids}::uuid[])`;
  try {
    await sql`alter table roll_actions disable trigger roll_actions_freeze`;
    await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
    await sql`delete from audit_events where action in ('tenant.roll_action.recorded', 'tenant.roll_action.voided')
                 and resource_id in (select id::text from roll_actions where person_id = any(${ids}::uuid[]))`;
    // A void references its target: voids first.
    await sql`delete from roll_actions where person_id = any(${ids}::uuid[]) and kind = 'void'`;
    await sql`delete from roll_actions where person_id = any(${ids}::uuid[])`;
    await sql`delete from group_memberships where person_id = any(${ids}::uuid[])`;
    await sql`delete from memberships where person_id = any(${ids}::uuid[])`;
    await sql`delete from contact_methods where person_id = any(${ids}::uuid[])`;
    await sql`delete from people where id = any(${ids}::uuid[])`;
  } finally {
    await sql`alter table roll_actions enable trigger roll_actions_freeze`;
    await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
  }
  const left = (await sql`select 1 from people where id = any(${ids}::uuid[])`) as unknown[];
  if (left.length > 0) throw new Error("[community-fixture] fixture people survived the sweep");
  return ids.length;
}

/** Restores the flags and the toggle, verifying by SELECT. The role and its grant stay (idempotent, org-scoped, fixture-only). */
export async function removeCommunityFixture(sql: Sql, state: CommunityFixtureState | undefined): Promise<void> {
  await sweepCommunityPeople(sql);
  await setDirectoryView(sql, true);
  if (!state) return;
  for (const [key, enabled] of Object.entries(state.priorFlags)) {
    await sql`update feature_flags set enabled = ${enabled} where key = ${key}`;
    const rows = (await sql`select enabled from feature_flags where key = ${key}`) as { enabled: boolean }[];
    if (rows[0]?.enabled !== enabled) throw new Error(`[community-fixture] ${key} was not restored`);
  }
  if (state.priorToggle === null) {
    await sql`
      delete from organization_feature_toggles
       where organization_id = ${COMMUNITY_ORG.id}::uuid and feature_key = ${MEMBERS_CREATE}
    `;
  } else {
    await sql`
      update organization_feature_toggles set enabled = ${state.priorToggle}
       where organization_id = ${COMMUNITY_ORG.id}::uuid and feature_key = ${MEMBERS_CREATE}
    `;
  }
}
