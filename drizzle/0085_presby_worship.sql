-- drizzle/0085_presby_worship.sql
--
-- Worship, Increment 1: teams, positions and the Sunday schedule
-- (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Data Model" and
-- "Permissions & Flags"; parent docs/work-log/2026-11-04-worship.md Phase 2
-- R2, R5 to R9, R12; DECISION-317 to 327; findings F421 to F432).
--
-- Nine things, in dependency order. The whole file is idempotent: every
-- statement is `if not exists`, `on conflict`, `where not exists`,
-- drop-then-add, `create or replace`, drop-then-create (triggers, policies)
-- or revoke-then-grant, so it replays cleanly, including as an in-place
-- correction while this migration is unreleased (CLAUDE.md -> Project Layout
-- -> drizzle/). Proven by applying the whole file twice (work-log, Phase 4
-- Batch 1).
--
--   1. permission catalog     worship.manage, worship.plan, worship.schedule
--                             (tier 1, no 2FA, module `worship`)
--   2. founding bundle        presby_founding_administrator_permission_keys()
--                             re-created from the LIVE body (re-read
--                             2026-11-04 on pipeline-worship-inc1: the 0071
--                             body, eleven base keys) with the three worship
--                             keys for congregation and
--                             new_worshiping_community only; order base,
--                             worship, oversight
--   3. backfill               the three keys onto every org-owned
--                             founding_administrator role of those two types
--   4. worship_leader         a universal `custom` template carrying the
--                             three keys, inserted BY KEY (no fixed id: D7)
--   5. global flag            delete the feature_flags row
--                             org_portal.worship (the 0055 precedent); the
--                             per-org toggle is the only switch
--   6. the nine tables        CHECKs, indexes
--   7. functions + triggers   helpers, the guards (SECURITY INVOKER, binding
--                             the OWNER too: F44), the owner-only reminder
--                             claim
--   8. RLS + grants           ENABLE + FORCE, tenant_isolation, column-limited
--                             presby_app grants, NO DELETE anywhere,
--                             presby_platform nothing
--   9. comments, then the closing assertions (a `do` block that raises)
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored. Drizzle mirror: src/lib/db/domain/worship.ts.
--
-- INTEGRATION HAZARD (F362): F362 also re-creates
-- presby_founding_administrator_permission_keys(). Two `create or replace`s
-- with different arrays silently drop the first one's keys. Whichever of the
-- two pipelines merges SECOND must re-read the live body and carry the other's
-- keys; invitations.db.test.ts (equality with foundingAdministratorPlan() for
-- every organization_type) is what catches a miss.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No audit row: a migration is provisioning (the 0071 precedent). The
--     store writes its audit rows (Batches 2 and 3).
--   * No org toggle row. org_portal.worship is toggle-only, provisioned OFF;
--     a missing row means off.
--   * events, groups and group_memberships are NOT altered (R2, R5). No
--     existing table gains a column, CHECK or trigger.
--   * No email-response credential: Increment 1b (0086). response_source
--     'link' is in the vocabulary from day one and refused by the guard.
--   * Residual, `paper` (R7, DECISION-318): the actor ids on an assignment
--     come from the application. The guards check that the NAMED person may
--     do the act, not that the caller is that person; the mitigations are
--     the sole-writer scan and the session-derived actor.
--   * Residual, `paper` (S2, DECISION-317): nothing here stops a
--     worship_services row being attached to an existing event.
--
-- OWNER-PATH CONTRACT (found in Phase 4 Batch 1): the assignment guards'
-- actor check calls presby_has_permission(), whose resolver
-- (presby_effective_permissions, drizzle/0010) refuses any organization but
-- presby_current_org() - its anti-fishing guard. The tenant path always
-- satisfies that (withOrgContext()). An OWNER-path writer that places, sends,
-- records an on-behalf answer or removes (the dev seed, the e2e fixture, any
-- script) must set app.current_org_id to the row's organization in its
-- transaction, or the guard fails CLOSED with insufficient_privilege from the
-- resolver. Fail-closed is deliberate and is not relaxed here. The paths that
-- name no actor need no context: the reminder claim (stamps only), the
-- service_cancelled withdrawal, a self answer, and the generic guards.
--
-- DEVIATIONS FROM THE PHASE 3 TEXT (work-log Phase 4 Batch 1 records each):
--   * worship_position_qualifications and worship_blockouts also declare
--     unique (id, organization_id) (Composite Tenant Keys: every tenant table
--     with an id carries it).
--   * worship_service_type_teams carries created_at (house style).
--   * worship_assignments carries three CHECKs beyond the design's list:
--     worship_assignments_sent_shape (sent_by, requested_at and
--     notice_outcome are set together, and a requested row has them),
--     worship_assignments_decline_reason_shape (a reason only on a declined
--     or withdrawn row) and worship_assignments_withdrawn_actor_shape (an
--     actor exactly when the reason is `removed`).
--   * The guest-name CHECK refuses every control character, not only line
--     breaks (validateGuestName's rule).
--   * The send transition (draft -> requested) is also refused on a
--     cancelled or started service, and re-adding a removed serving team
--     (removed_at cleared) passes the same guard as an insert.
--   * worship_service_teams carries an index on (organization_id, group_id)
--     for "the services this team serves" (team page, retire check).

-- ---------------------------------------------------------------------------
-- 1. permission catalog
-- ---------------------------------------------------------------------------
-- All tier 1 (a schedule is directory-tier information), requires_two_factor
-- false. `on conflict do update` so an in-place description fix replays.
-- worship.view, worship.library and worship.bulletin arrive with the
-- increments that use them (R8).
insert into permissions (key, module, description, sensitivity_tier, requires_two_factor)
values
  ('worship.manage', 'worship',
   'Set up worship teams, their positions and who can fill them, and save service types', 1, false),
  ('worship.plan', 'worship',
   'Add, change and cancel worship services and choose which teams serve', 1, false),
  ('worship.schedule', 'worship',
   'Schedule people into worship positions, send requests, and record answers for them', 1, false)
on conflict (key) do update
  set module = excluded.module,
      description = excluded.description,
      sensitivity_tier = excluded.sensitivity_tier,
      requires_two_factor = excluded.requires_two_factor;

-- ---------------------------------------------------------------------------
-- 2. the founding-administrator bundle (F421, DECISION-319)
-- ---------------------------------------------------------------------------
-- Same signature, return type, volatility, security and search_path as 0071
-- section 2a; the eleven base keys are byte-for-byte the live text (so the
-- substring "'domains.manage', 'careers.manage', 'careers.applicants'" that
-- test-rls section 71b greps for survives). The worship keys go to the two
-- organization types the org_portal.worship toggle serves, and nowhere else:
-- a presbytery or synod has no worship page. Order is base, worship,
-- oversight; the TypeScript foundingAdministratorPlan() uses the same order
-- (Batch 2) and invitations.db.test.ts pins the two equal. Sole definer
-- caller: presby_apply_founding_administrator (0059), by name.
create or replace function presby_founding_administrator_permission_keys(p_org_type text)
returns text[]
language sql
immutable
security definer
set search_path = public, pg_temp
as $function$
  select array['people.manage', 'roles.manage', 'role_grants.manage', 'groups.manage',
               'officers.manage', 'org_features.manage', 'tickets.file', 'staff.manage',
               'domains.manage', 'careers.manage', 'careers.applicants']::text[]
         || case when p_org_type in ('congregation', 'new_worshiping_community')
                 then array['worship.manage', 'worship.plan', 'worship.schedule']::text[]
                 else array[]::text[] end
         || case when p_org_type = 'presbytery'
                 then array['congregation_oversight.manage']::text[]
                 else array[]::text[] end;
$function$;

revoke all on function presby_founding_administrator_permission_keys(text) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. backfill (the 0057 / 0071 idiom, scoped to the two types)
-- ---------------------------------------------------------------------------
-- Every org-owned founding_administrator role at a congregation or new
-- worshiping community, designated before this file runs, is topped up with
-- the three keys. The notice reports how many roles gained at least one key
-- (the orchestrator records it at apply; a re-apply reports 0). Residual, as
-- 0057 and 0071: a re-apply re-adds a key a tenant removed from a
-- designation-minted role. The app_role_permissions guards (giving,
-- reimbursement, seat key) ignore a worship key.
do $$
declare
  v_roles integer;
begin
  with added as (
    insert into app_role_permissions (role_id, permission_key)
    select r.id, k.key
      from app_roles r
      join organizations o on o.id = r.organization_id
     cross join (values ('worship.manage'), ('worship.plan'), ('worship.schedule')) as k(key)
     where r.key = 'founding_administrator'
       and r.organization_id is not null
       and o.organization_type in ('congregation', 'new_worshiping_community')
    on conflict (role_id, permission_key) do nothing
    returning role_id
  )
  select count(distinct role_id) into v_roles from added;
  raise notice 'worship 0085: % founding_administrator role(s) topped up with the worship keys', v_roles;
end $$;

-- ---------------------------------------------------------------------------
-- 4. the worship_leader template
-- ---------------------------------------------------------------------------
-- `custom` (DECISION-078: no PC(USA) office's duty is scheduling a band),
-- not protected, organization_type_scope null so both a congregation and a
-- new worshiping community can adopt it (a presbytery could adopt it too, but
-- nobody there holds the keys to grant it: F111). Inserted by KEY with no
-- fixed id (D7); app_roles_org_key does not cover a NULL organization_id, so
-- `where not exists` is the idempotence guard.
insert into app_roles (organization_id, organization_type_scope, key, name, role_kind, is_protected)
select null, null, 'worship_leader', 'Worship Leader', 'custom', false
 where not exists (select 1 from app_roles where organization_id is null and key = 'worship_leader');

insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('worship.manage'), ('worship.plan'), ('worship.schedule')) as k(key)
 where r.organization_id is null
   and r.key = 'worship_leader'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. the global flag row
-- ---------------------------------------------------------------------------
-- The old stub tile's flag. org_portal.worship is now a per-org toggle
-- (provisioned off); scripts/seed.ts and scripts/ci/e2e-reset-flags.sql stop
-- seeding the row in Batch 2. Nothing references feature_flags by FK and no
-- drizzle/ function body names this key (grepped 2026-11-04).
delete from feature_flags where key = 'org_portal.worship';

-- ---------------------------------------------------------------------------
-- 6. the nine tables
-- ---------------------------------------------------------------------------
-- Every tenant column is organization_id uuid not null references
-- organizations(id) on delete cascade: reachable only through D10's guarded
-- fixture teardown (organizations_guard_delete + deletable_until). Every FK
-- between tenant tables is COMPOSITE on (..., organization_id) (F2). FKs to
-- events and groups are NO ACTION, never cascade or restrict (the
-- events_event_type_fk precedent): a hard delete of a service or a team that
-- carries worship rows fails, which narrows F253 for those rows. NO ACTION is
-- checked at the end of the statement, so the org-teardown cascade (which
-- removes both sides in one statement) still passes. created_by and
-- updated_by reference users(id), NO ACTION (the 0071 header's reasoning).
-- Person references are composite to memberships_person_org_key.
--
-- Uniques and FKs are inline (new tables); CHECKs are drop-then-add (the
-- drizzle/0048 idiom) so an in-place correction actually changes them.

-- 6a. worship_teams: a 1:1 extension of a MANAGED choir or team group (R5).
create table if not exists worship_teams (
  group_id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint worship_teams_group_org_key unique (group_id, organization_id),
  constraint worship_teams_group_fk foreign key (group_id, organization_id)
    references groups (id, organization_id)
);

create index if not exists worship_teams_org_live_ix
  on worship_teams (organization_id) where retired_at is null;

-- 6b. worship_positions: a slot kind on one team.
create table if not exists worship_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null,
  name text not null,
  slots smallint not null default 1,
  sort_order integer not null default 0,
  retired_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint worship_positions_id_org_key unique (id, organization_id),
  -- The three-column target (R5): an assignment's position must belong to
  -- the assignment's team.
  constraint worship_positions_id_team_org_key unique (id, group_id, organization_id),
  constraint worship_positions_team_fk foreign key (group_id, organization_id)
    references worship_teams (group_id, organization_id)
);

alter table worship_positions drop constraint if exists worship_positions_name_shape;
alter table worship_positions add constraint worship_positions_name_shape
  check (name = btrim(name) and char_length(name) between 1 and 60);

alter table worship_positions drop constraint if exists worship_positions_slots_range;
alter table worship_positions add constraint worship_positions_slots_range
  check (slots between 1 and 20);

create unique index if not exists worship_positions_live_name_idx
  on worship_positions (organization_id, group_id, lower(name)) where retired_at is null;
create index if not exists worship_positions_team_sort_ix
  on worship_positions (organization_id, group_id, sort_order);

-- 6c. worship_position_qualifications: who can fill which position. Roster
-- presence is NOT a constraint: the picker joins group_memberships live, so
-- someone who leaves the team drops out with no write.
create table if not exists worship_position_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null,
  position_id uuid not null,
  person_id uuid not null,
  ended_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint worship_position_qualifications_id_org_key unique (id, organization_id),
  constraint worship_position_qualifications_position_fk foreign key (position_id, group_id, organization_id)
    references worship_positions (id, group_id, organization_id),
  constraint worship_position_qualifications_person_fk foreign key (person_id, organization_id)
    references memberships (person_id, organization_id)
);

create unique index if not exists worship_position_qualifications_live_idx
  on worship_position_qualifications (position_id, person_id) where ended_at is null;
create index if not exists worship_position_qualifications_person_ix
  on worship_position_qualifications (organization_id, person_id) where ended_at is null;

-- 6d. worship_service_types: the recurring blueprint (time, place, teams).
create table if not exists worship_service_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  start_time time not null,
  duration_minutes integer,
  location text,
  retired_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint worship_service_types_id_org_key unique (id, organization_id)
);

alter table worship_service_types drop constraint if exists worship_service_types_name_shape;
alter table worship_service_types add constraint worship_service_types_name_shape
  check (name = btrim(name) and char_length(name) between 1 and 80);

alter table worship_service_types drop constraint if exists worship_service_types_duration_range;
alter table worship_service_types add constraint worship_service_types_duration_range
  check (duration_minutes is null or duration_minutes between 15 and 480);

alter table worship_service_types drop constraint if exists worship_service_types_location_length;
alter table worship_service_types add constraint worship_service_types_location_length
  check (location is null or char_length(location) <= 200);

create unique index if not exists worship_service_types_live_name_idx
  on worship_service_types (organization_id, lower(name)) where retired_at is null;

-- 6e. worship_service_type_teams: the teams that usually serve a type.
-- removed_at is settable AND clearable (re-adding a team).
create table if not exists worship_service_type_teams (
  service_type_id uuid not null,
  group_id uuid not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint worship_service_type_teams_pkey primary key (service_type_id, group_id),
  constraint worship_service_type_teams_type_fk foreign key (service_type_id, organization_id)
    references worship_service_types (id, organization_id),
  constraint worship_service_type_teams_team_fk foreign key (group_id, organization_id)
    references worship_teams (group_id, organization_id)
);

-- 6f. worship_services: a 1:1 extension of an events row (R2). A service's
-- identity is THIS row, not an event type. No state column yet (draft /
-- published arrives with Increment 2).
create table if not exists worship_services (
  event_id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  service_type_id uuid,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worship_services_event_org_key unique (event_id, organization_id),
  constraint worship_services_event_fk foreign key (event_id, organization_id)
    references events (id, organization_id),
  constraint worship_services_type_fk foreign key (service_type_id, organization_id)
    references worship_service_types (id, organization_id)
);

-- 6g. worship_service_teams: which teams serve a service. removed_at is
-- settable and clearable; clearing it passes the insert guard again.
create table if not exists worship_service_teams (
  event_id uuid not null,
  group_id uuid not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint worship_service_teams_pkey primary key (event_id, group_id),
  -- The three-column target (R5): an assignment's team must be serving the
  -- assignment's service.
  constraint worship_service_teams_event_team_org_key unique (event_id, group_id, organization_id),
  constraint worship_service_teams_service_fk foreign key (event_id, organization_id)
    references worship_services (event_id, organization_id),
  constraint worship_service_teams_team_fk foreign key (group_id, organization_id)
    references worship_teams (group_id, organization_id)
);

create index if not exists worship_service_teams_team_ix
  on worship_service_teams (organization_id, group_id);

-- 6h. worship_assignments: a person (or a guest) in a position on a service.
create table if not exists worship_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null,
  group_id uuid not null,
  position_id uuid not null,
  person_id uuid,
  guest_name text,
  status text not null default 'draft',
  assigned_by_person_id uuid not null,
  sent_by_person_id uuid,
  requested_at timestamptz,
  notice_outcome text,
  responded_by_person_id uuid,
  response_source text,
  responded_at timestamptz,
  decline_reason text,
  withdrawn_by_person_id uuid,
  withdrawn_reason text,
  withdrawn_at timestamptz,
  unanswered_reminded_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worship_assignments_id_org_key unique (id, organization_id),
  -- R5's two three-column keys: a position from another team, or a team that
  -- is not serving this service, is refused by the database.
  constraint worship_assignments_service_team_fk foreign key (event_id, group_id, organization_id)
    references worship_service_teams (event_id, group_id, organization_id),
  constraint worship_assignments_position_fk foreign key (position_id, group_id, organization_id)
    references worship_positions (id, group_id, organization_id),
  constraint worship_assignments_person_fk foreign key (person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint worship_assignments_assigned_by_fk foreign key (assigned_by_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint worship_assignments_sent_by_fk foreign key (sent_by_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint worship_assignments_responded_by_fk foreign key (responded_by_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint worship_assignments_withdrawn_by_fk foreign key (withdrawn_by_person_id, organization_id)
    references memberships (person_id, organization_id)
);

-- Exactly one of a person and a guest.
alter table worship_assignments drop constraint if exists worship_assignments_one_assignee;
alter table worship_assignments add constraint worship_assignments_one_assignee
  check (num_nonnulls(person_id, guest_name) = 1);

-- A guest is a trimmed name of 1 to 80 characters with no control character
-- (no line break): display only, no contact columns (Q11).
alter table worship_assignments drop constraint if exists worship_assignments_guest_name_shape;
alter table worship_assignments add constraint worship_assignments_guest_name_shape
  check (guest_name is null
         or (guest_name = btrim(guest_name)
             and char_length(guest_name) between 1 and 80
             and guest_name !~ '[[:cntrl:]]'));

alter table worship_assignments drop constraint if exists worship_assignments_status_allowed;
alter table worship_assignments add constraint worship_assignments_status_allowed
  check (status in ('draft', 'requested', 'confirmed', 'declined', 'withdrawn'));

-- A guest has no one to ask: confirmed at placement, or withdrawn.
alter table worship_assignments drop constraint if exists worship_assignments_guest_status;
alter table worship_assignments add constraint worship_assignments_guest_status
  check (guest_name is null or status in ('confirmed', 'withdrawn'));

alter table worship_assignments drop constraint if exists worship_assignments_response_source_allowed;
alter table worship_assignments add constraint worship_assignments_response_source_allowed
  check (response_source is null or response_source in ('self', 'on_behalf', 'link'));

-- The three response columns are set together or not at all. (Written as two
-- equalities: SQL's a = b = c would compare a boolean with the third.)
alter table worship_assignments drop constraint if exists worship_assignments_response_shape;
alter table worship_assignments add constraint worship_assignments_response_shape
  check ((response_source is null) = (responded_at is null)
     and (responded_at is null) = (responded_by_person_id is null));

-- R12: closed choices only, never free text.
alter table worship_assignments drop constraint if exists worship_assignments_decline_reason_allowed;
alter table worship_assignments add constraint worship_assignments_decline_reason_allowed
  check (decline_reason is null or decline_reason in ('away', 'work', 'family', 'other'));

-- A decline reason only on a declined row (or one later withdrawn from it).
alter table worship_assignments drop constraint if exists worship_assignments_decline_reason_shape;
alter table worship_assignments add constraint worship_assignments_decline_reason_shape
  check (decline_reason is null or status in ('declined', 'withdrawn'));

alter table worship_assignments drop constraint if exists worship_assignments_notice_outcome_allowed;
alter table worship_assignments add constraint worship_assignments_notice_outcome_allowed
  check (notice_outcome is null or notice_outcome in ('emailed', 'guardian', 'no_address', 'do_not_contact'));

-- Send stamps sent_by, requested_at and notice_outcome together; a requested
-- row has been sent.
alter table worship_assignments drop constraint if exists worship_assignments_sent_shape;
alter table worship_assignments add constraint worship_assignments_sent_shape
  check ((sent_by_person_id is null) = (requested_at is null)
     and (requested_at is null) = (notice_outcome is null)
     and (status <> 'requested' or requested_at is not null));

alter table worship_assignments drop constraint if exists worship_assignments_withdrawn_reason_allowed;
alter table worship_assignments add constraint worship_assignments_withdrawn_reason_allowed
  check (withdrawn_reason is null or withdrawn_reason in ('removed', 'service_cancelled'));

-- Withdrawn exactly when stamped and given a reason.
alter table worship_assignments drop constraint if exists worship_assignments_withdrawn_shape;
alter table worship_assignments add constraint worship_assignments_withdrawn_shape
  check ((status = 'withdrawn') = (withdrawn_at is not null)
     and (withdrawn_at is null) = (withdrawn_reason is null));

-- An actor exactly when a person was removed; a cancellation has none.
alter table worship_assignments drop constraint if exists worship_assignments_withdrawn_actor_shape;
alter table worship_assignments add constraint worship_assignments_withdrawn_actor_shape
  check ((withdrawn_by_person_id is null and (withdrawn_reason is null or withdrawn_reason = 'service_cancelled'))
      or (withdrawn_by_person_id is not null and withdrawn_reason = 'removed'));

-- One live row per person per position per service.
create unique index if not exists worship_assignments_live_person_idx
  on worship_assignments (event_id, position_id, person_id)
  where person_id is not null and status <> 'withdrawn';
-- My schedule.
create index if not exists worship_assignments_person_ix
  on worship_assignments (organization_id, person_id, event_id)
  where person_id is not null and status <> 'withdrawn';
-- The board.
create index if not exists worship_assignments_board_ix
  on worship_assignments (organization_id, event_id, group_id);
-- The reminder claim and the open count.
create index if not exists worship_assignments_open_ix
  on worship_assignments (organization_id, status)
  where status in ('requested', 'confirmed') and person_id is not null;

-- 6i. worship_blockouts: a person's "dates I can't serve" (R12, DECISION-327).
-- NO free-text column.
create table if not exists worship_blockouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  reason text,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint worship_blockouts_id_org_key unique (id, organization_id),
  constraint worship_blockouts_person_fk foreign key (person_id, organization_id)
    references memberships (person_id, organization_id)
);

alter table worship_blockouts drop constraint if exists worship_blockouts_range_order;
alter table worship_blockouts add constraint worship_blockouts_range_order
  check (ends_on >= starts_on);

-- At most 366 days, inclusive of both ends.
alter table worship_blockouts drop constraint if exists worship_blockouts_range_length;
alter table worship_blockouts add constraint worship_blockouts_range_length
  check (ends_on - starts_on <= 365);

alter table worship_blockouts drop constraint if exists worship_blockouts_reason_allowed;
alter table worship_blockouts add constraint worship_blockouts_reason_allowed
  check (reason is null or reason in ('away', 'work', 'family', 'other'));

create index if not exists worship_blockouts_person_ix
  on worship_blockouts (organization_id, person_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- 7. functions and triggers
-- ---------------------------------------------------------------------------
-- No function here has a defaulted parameter. Every guard is SECURITY
-- INVOKER with search_path pinned: it lends no owner privilege and binds
-- EVERY connection, the owner's included (F44: getPlatformDb() is
-- neondb_owner, which no grant binds - only triggers do). Refusals are
-- check_violation (23514) with a `worship: ` message prefix and the
-- CONSTRAINT field set to a stable `worship_guard_<code>` the store can map;
-- delete refusals are insufficient_privilege (42501), the house idiom for
-- "this record is permanent". plpgsql bodies are not name-resolved at create
-- time, so the order of the helpers below does not matter at apply.

-- 7a. The organization's local date and wall-clock now. SECURITY DEFINER:
-- organization_settings is FORCE RLS and the reminder claim reads many orgs
-- (F26). Falls back to 'America/New_York' for an organization with no
-- settings row, pinned equal to DEFAULT_ORG_TIME_ZONE by a test. The wall
-- clock is compared with events.starts_at (timestamp without time zone,
-- DECISION-113 ruling 3). The careers helper is deliberately not reused.
create or replace function presby_worship_org_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select (now() at time zone coalesce(
            (select s.time_zone from organization_settings s where s.organization_id = p_org),
            'America/New_York'))::date;
$function$;

create or replace function presby_worship_org_now(p_org uuid)
returns timestamp
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select now() at time zone coalesce(
           (select s.time_zone from organization_settings s where s.organization_id = p_org),
           'America/New_York');
$function$;

-- 7b. The per-org toggle, composed in SQL exactly as orgFeatureEnabledInTx
-- composes it for the org_portal.worship catalog entry: the organization
-- type in the allow-list (congregation, new_worshiping_community), then the
-- category axis (flag row org_portal.feature_categories missing = axis off;
-- the `worship` category row missing = category on), then the toggle row
-- (missing = off). Invoker: on the tenant connection it can see only the
-- current organization's rows, so another organization reads as off.
-- Literals pinned to the catalog entry by worship-toggle.test.ts; the matrix
-- equivalence by enabled.db.test.ts (Batch 2). Increment 1b's definers
-- reuse it.
create or replace function presby_worship_enabled(p_org uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce((select o.organization_type::text in ('congregation', 'new_worshiping_community')
                     from organizations o where o.id = p_org), false)
     and (not coalesce((select f.enabled from feature_flags f
                         where f.key = 'org_portal.feature_categories'), false)
          or coalesce((select c.enabled from organization_feature_categories c
                        where c.organization_id = p_org and c.category = 'worship'), true))
     and coalesce((select t.enabled from organization_feature_toggles t
                    where t.organization_id = p_org and t.feature_key = 'org_portal.worship'), false);
$function$;

-- 7c. The leader seat (R7, DECISION-318). In English: true exactly when the
-- group carries a worship_teams row at this organization, is a MANAGED group,
-- and the person holds a `chair` or `leader` row on it that is in date on
-- p_as_of (started on or before, not ended on or before), and the person is
-- not merged, not deceased, and their relationship with the organization has
-- not ended. Roll membership is NOT required (a hired organist is `staff` or
-- `regular`). Per team: a seat on team A says nothing about team B. Callers
-- pass presby_worship_org_today(p_org). Never treasury's helper
-- (check:treasury-boundaries).
create or replace function presby_worship_leads_team(p_org uuid, p_person uuid, p_group uuid, p_as_of date)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
      from worship_teams wt
      join groups g
        on g.id = wt.group_id and g.organization_id = wt.organization_id
      join group_memberships gm
        on gm.group_id = g.id and gm.organization_id = g.organization_id
      join people pe
        on pe.id = gm.person_id
      join memberships m
        on m.person_id = gm.person_id and m.organization_id = gm.organization_id
     where wt.organization_id = p_org
       and wt.group_id = p_group
       and g.membership_source = 'managed'
       and gm.person_id = p_person
       and gm.group_role in ('chair', 'leader')
       and gm.starts_on <= p_as_of
       and (gm.ends_on is null or gm.ends_on > p_as_of)
       and pe.merged_into_id is null
       and pe.date_of_death is null
       and m.ended_on is null);
$function$;

-- 7d. Scheduling authority: the organization-wide key, or the seat on THIS
-- team. Used by the assignment guards for every actor column.
create or replace function presby_worship_may_schedule(p_org uuid, p_person uuid, p_group uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select p_person is not null
     and (presby_has_permission(p_person, p_org, 'worship.schedule', presby_worship_org_today(p_org))
          or presby_worship_leads_team(p_org, p_person, p_group, presby_worship_org_today(p_org)));
$function$;

-- 7e. The Features-page warning count: distinct PEOPLE (guests are not
-- people here) with a requested or confirmed assignment on an uncancelled
-- service that starts after the organization's wall-clock now, for
-- presby_current_org() only (zero with no context). SECURITY DEFINER so an
-- org_features.manage holder with no worship key reads a bare count (the
-- presby_reimbursement_open_count precedent); it returns nothing else.
create or replace function presby_worship_open_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select count(distinct a.person_id)::integer
    from worship_assignments a
    join events e
      on e.id = a.event_id and e.organization_id = a.organization_id
   where a.organization_id = presby_current_org()
     and a.person_id is not null
     and a.status in ('requested', 'confirmed')
     and e.cancelled_at is null
     and e.starts_at > presby_worship_org_now(a.organization_id);
$function$;

-- 7f. The reminder claim (DECISION-325). Owner-only, cross-organization
-- writer: EXECUTE is revoked from PUBLIC, presby_app and presby_platform;
-- src/lib/worship/sweep.ts calls it on getPlatformDb() inside the
-- transaction that also writes the queue rows, so a failed queue insert
-- un-claims. In English, an assignment is due when:
--   * it names a person (never a guest) who is not merged, not deceased,
--     whose relationship with the organization has not ended, who is not
--     presumed a minor (presby_photo_subject_is_minor, the one predicate:
--     DECISION-322), and who has a deliverable `role` address
--     (presby_person_email, which already skips do-not-contact);
--   * its organization has the toggle on (presby_worship_enabled);
--   * its service is not cancelled and starts after the organization's
--     wall-clock now;
--   * EITHER it is `requested`, was requested more than 24 hours ago, has
--     not had its unanswered reminder, and the service starts within 72
--     hours (kind 'unanswered');
--   * OR it is `confirmed`, has not had its confirmed reminder, and the
--     service starts within 48 hours (kind 'confirmed').
-- Declined and withdrawn rows are never due. At most p_batch rows (clamped
-- to 1..500), earliest service first, skipping rows another transaction
-- holds. Each claimed row's stamp (unanswered_reminded_at or reminded_at) is
-- set once, so each kind is sent at most once. Returns one row per claim with
-- the address resolved in SQL.
create or replace function presby_worship_claim_reminders(p_batch integer)
returns table (kind text, organization_id uuid, assignment_id uuid, event_id uuid,
               person_id uuid, address text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_batch integer := least(greatest(coalesce(p_batch, 500), 1), 500);
begin
  return query
  with due as (
    select a.id,
           case when a.status = 'requested' then 'unanswered' else 'confirmed' end as due_kind
      from worship_assignments a
      join events e
        on e.id = a.event_id and e.organization_id = a.organization_id
      join people pe
        on pe.id = a.person_id
      join memberships m
        on m.person_id = a.person_id and m.organization_id = a.organization_id
     where a.person_id is not null
       and a.status in ('requested', 'confirmed')
       and e.cancelled_at is null
       and e.starts_at > presby_worship_org_now(a.organization_id)
       and ((a.status = 'requested'
             and a.unanswered_reminded_at is null
             and a.requested_at < now() - interval '24 hours'
             and e.starts_at <= presby_worship_org_now(a.organization_id) + interval '72 hours')
         or (a.status = 'confirmed'
             and a.reminded_at is null
             and e.starts_at <= presby_worship_org_now(a.organization_id) + interval '48 hours'))
       and pe.merged_into_id is null
       and pe.date_of_death is null
       and m.ended_on is null
       and not presby_photo_subject_is_minor(a.organization_id, a.person_id)
       and presby_worship_enabled(a.organization_id)
       and exists (select 1 from presby_person_email(a.person_id, 'role'))
     order by e.starts_at, a.id
     limit v_batch
       for update of a skip locked
  ), stamped as (
    update worship_assignments w
       set unanswered_reminded_at = case when d.due_kind = 'unanswered' then now() else w.unanswered_reminded_at end,
           reminded_at            = case when d.due_kind = 'confirmed'  then now() else w.reminded_at end
      from due d
     where w.id = d.id
    returning d.due_kind as s_kind, w.organization_id as s_org, w.id as s_id,
              w.event_id as s_event, w.person_id as s_person
  )
  select s.s_kind, s.s_org, s.s_id, s.s_event, s.s_person,
         (select pm.address from presby_person_email(s.s_person, 'role') pm)
    from stamped s
   order by s.s_org, s.s_event, s.s_id;
end
$function$;

-- 7g. The generic BEFORE UPDATE guard for the eight tables other than
-- worship_assignments. In English: TG_ARGV[0] is a comma-separated list of
-- the columns that may change freely; TG_ARGV[1] the set-once columns, which
-- may go from null to a value and never change after (so they also cannot
-- be cleared). Every other column must equal its old value.
create or replace function presby_worship_guard_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_free text[] := coalesce(string_to_array(nullif(tg_argv[0], ''), ','), array[]::text[]);
  v_once text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), array[]::text[]);
  k text;
begin
  for k in select jsonb_object_keys(v_new) loop
    if k = any(v_free) then
      continue;
    end if;
    if k = any(v_once) then
      if (v_old -> k) is distinct from (v_new -> k) and (v_old ->> k) is not null then
        raise exception 'worship: %.% is set once and cannot change', tg_table_name, k
          using errcode = 'check_violation', constraint = 'worship_guard_set_once';
      end if;
      continue;
    end if;
    if (v_old -> k) is distinct from (v_new -> k) then
      raise exception 'worship: %.% cannot change', tg_table_name, k
        using errcode = 'check_violation', constraint = 'worship_guard_immutable';
    end if;
  end loop;
  return new;
end
$function$;

-- 7h. BEFORE DELETE on all nine. Worship rows are permanent (the operator's
-- all-deletes-soft rule: retire, end, remove, withdraw). The one way out is
-- the sanctioned fixture teardown: by the time the RI cascade fires, the
-- organizations row is already gone (and organizations_guard_delete lets that
-- happen only for a deletable_until fixture). The careers idiom.
create or replace function presby_worship_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception 'worship: % rows are permanent; retire, end or withdraw them instead', tg_table_name
    using errcode = 'insufficient_privilege';
end
$function$;

-- 7i. updated_at is trigger-owned (in no grant).
create or replace function presby_worship_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

-- 7j. worship_teams BEFORE INSERT. In English: the group must be a MANAGED
-- group whose type is `choir` or `team` (a derived group, and the `court`,
-- `roster`, `committee` and `small_group` types, are refused); and a team is
-- born live (retired_at forced null).
create or replace function presby_worship_teams_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if not exists (
    select 1
      from groups g
      join group_types gt on gt.id = g.group_type_id
     where g.id = new.group_id
       and g.organization_id = new.organization_id
       and g.membership_source = 'managed'
       and gt.key in ('choir', 'team')) then
    raise exception 'worship: only a managed choir or team group can be a worship team'
      using errcode = 'check_violation', constraint = 'worship_guard_team_not_eligible';
  end if;
  new.retired_at := null;
  return new;
end
$function$;

-- 7k. worship_positions BEFORE INSERT. In English: the team is not retired;
-- a position is born live.
create or replace function presby_worship_positions_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if exists (select 1 from worship_teams wt
              where wt.group_id = new.group_id and wt.organization_id = new.organization_id
                and wt.retired_at is not null) then
    raise exception 'worship: the team is retired'
      using errcode = 'check_violation', constraint = 'worship_guard_team_retired';
  end if;
  new.retired_at := null;
  return new;
end
$function$;

-- 7l. worship_service_teams BEFORE INSERT, and BEFORE UPDATE when removed_at
-- is cleared (a team re-added). In English: the team is not retired and the
-- service's event is not cancelled; an inserted row is born present.
create or replace function presby_worship_service_teams_guard_add()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' and not (old.removed_at is not null and new.removed_at is null) then
    return new;
  end if;
  if exists (select 1 from worship_teams wt
              where wt.group_id = new.group_id and wt.organization_id = new.organization_id
                and wt.retired_at is not null) then
    raise exception 'worship: the team is retired'
      using errcode = 'check_violation', constraint = 'worship_guard_team_retired';
  end if;
  if exists (select 1 from events e
              where e.id = new.event_id and e.organization_id = new.organization_id
                and e.cancelled_at is not null) then
    raise exception 'worship: the service was cancelled'
      using errcode = 'check_violation', constraint = 'worship_guard_service_cancelled';
  end if;
  if tg_op = 'INSERT' then
    new.removed_at := null;
  end if;
  return new;
end
$function$;

-- 7m. worship_blockouts BEFORE INSERT. In English: a range is born live
-- (ended_at forced null); it may not end before the organization's today;
-- and the person may hold at most 50 live ranges at the organization,
-- counted under a transaction advisory lock on (organization, person) so two
-- concurrent saves cannot both take the 50th place. (The other limits are
-- CHECKs: end not before start, at most 366 days, closed reason list.)
create or replace function presby_worship_blockouts_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  c_live_cap constant integer := 50;   -- src/lib/worship/plan.ts mirrors it
  v_count integer;
begin
  new.ended_at := null;
  if new.ends_on < presby_worship_org_today(new.organization_id) then
    raise exception 'worship: a blockout may not end before today'
      using errcode = 'check_violation', constraint = 'worship_guard_blockout_past';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('worship_blockouts:' || new.organization_id::text || ':' || new.person_id::text, 0));
  select count(*) into v_count
    from worship_blockouts b
   where b.organization_id = new.organization_id
     and b.person_id = new.person_id
     and b.ended_at is null;
  if v_count >= c_live_cap then
    raise exception 'worship: at most % live blockouts per person', c_live_cap
      using errcode = 'check_violation', constraint = 'worship_guard_blockout_cap';
  end if;
  return new;
end
$function$;

-- 7n. worship_assignments BEFORE INSERT (R7, DECISION-324). In English:
--   * The trigger-owned stamps are forced: requested_at, withdrawn_at and
--     both reminder stamps null; responded_at null except for a guest, where
--     it is now. The send and withdrawal columns (sent_by_person_id,
--     notice_outcome, withdrawn_by_person_id, withdrawn_reason) must be
--     null: a row is born a draft or a confirmed guest, never sent or
--     withdrawn.
--   * A PERSON row is born `draft` with no response columns and no decline
--     reason.
--   * A GUEST row is born `confirmed`, recorded on the leader's behalf:
--     response_source 'on_behalf' and responded_by_person_id equal to
--     assigned_by_person_id; no decline reason.
--   * assigned_by_person_id may schedule this team (the key or the seat).
--   * The service's event is not cancelled and starts after the
--     organization's wall-clock now.
--   * The team is not retired; the position is not retired (the FK already
--     ties it to the team); the team's serving row on this service is not
--     removed.
--   * A person is on the team's roster now (a group_memberships row in date
--     on the organization's today), not merged, not deceased, and their
--     relationship with the organization has not ended.
create or replace function presby_worship_assignments_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_today date := presby_worship_org_today(new.organization_id);
  v_event record;
begin
  new.requested_at := null;
  new.withdrawn_at := null;
  new.unanswered_reminded_at := null;
  new.reminded_at := null;

  if new.sent_by_person_id is not null or new.notice_outcome is not null
     or new.withdrawn_by_person_id is not null or new.withdrawn_reason is not null then
    raise exception 'worship: an assignment is born unsent and not withdrawn'
      using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
  end if;

  if new.person_id is not null then
    if new.status is distinct from 'draft' then
      raise exception 'worship: a person''s assignment is created as a draft (got %)', new.status
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    if new.response_source is not null or new.responded_by_person_id is not null
       or new.decline_reason is not null then
      raise exception 'worship: a draft carries no response'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    new.responded_at := null;
  else
    if new.status is distinct from 'confirmed'
       or new.response_source is distinct from 'on_behalf'
       or new.responded_by_person_id is distinct from new.assigned_by_person_id
       or new.decline_reason is not null then
      raise exception 'worship: a guest is created confirmed, recorded on the leader''s behalf'
        using errcode = 'check_violation', constraint = 'worship_guard_guest_shape';
    end if;
    new.responded_at := now();
  end if;

  if not presby_worship_may_schedule(new.organization_id, new.assigned_by_person_id, new.group_id) then
    raise exception 'worship: the person placing this assignment may not schedule this team'
      using errcode = 'check_violation', constraint = 'worship_guard_not_authorized';
  end if;

  select e.cancelled_at, e.starts_at into v_event
    from events e where e.id = new.event_id and e.organization_id = new.organization_id;
  if v_event.cancelled_at is not null then
    raise exception 'worship: the service was cancelled'
      using errcode = 'check_violation', constraint = 'worship_guard_service_cancelled';
  end if;
  if v_event.starts_at is not null and v_event.starts_at <= presby_worship_org_now(new.organization_id) then
    raise exception 'worship: the service has already started'
      using errcode = 'check_violation', constraint = 'worship_guard_service_started';
  end if;

  if exists (select 1 from worship_teams wt
              where wt.group_id = new.group_id and wt.organization_id = new.organization_id
                and wt.retired_at is not null) then
    raise exception 'worship: the team is retired'
      using errcode = 'check_violation', constraint = 'worship_guard_team_retired';
  end if;
  if exists (select 1 from worship_positions wp
              where wp.id = new.position_id and wp.organization_id = new.organization_id
                and wp.retired_at is not null) then
    raise exception 'worship: the position is retired'
      using errcode = 'check_violation', constraint = 'worship_guard_position_retired';
  end if;
  if exists (select 1 from worship_service_teams st
              where st.event_id = new.event_id and st.group_id = new.group_id
                and st.organization_id = new.organization_id and st.removed_at is not null) then
    raise exception 'worship: the team is no longer serving this service'
      using errcode = 'check_violation', constraint = 'worship_guard_service_team_removed';
  end if;

  if new.person_id is not null then
    if not exists (
      select 1
        from group_memberships gm
        join people pe on pe.id = gm.person_id
        join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
       where gm.organization_id = new.organization_id
         and gm.group_id = new.group_id
         and gm.person_id = new.person_id
         and gm.starts_on <= v_today
         and (gm.ends_on is null or gm.ends_on > v_today)
         and pe.merged_into_id is null
         and pe.date_of_death is null
         and m.ended_on is null) then
      raise exception 'worship: the person is not on this team now'
        using errcode = 'check_violation', constraint = 'worship_guard_not_on_roster';
    end if;
  end if;

  return new;
end
$function$;

-- 7o. worship_assignments BEFORE UPDATE (R7, DECISION-324). In English:
--   * id, organization_id, event_id, group_id, position_id, person_id,
--     guest_name, assigned_by_person_id and created_at never change.
--   * A withdrawn row never changes again (terminal).
--   * requested_at, responded_at and withdrawn_at are trigger-owned: kept
--     from the old row and stamped now() only by the transition that owns
--     them. unanswered_reminded_at and reminded_at are set once (null to
--     now(); the reminder claim is their only writer, on the owner path);
--     presby_app holds no privilege on any of these.
--   * Exactly one of these happens, else the update is refused:
--     SEND      draft -> requested. sent_by_person_id may schedule the team;
--               notice_outcome is given; the service is not cancelled and
--               has not started; the team's serving row is not removed.
--               requested_at := now(). No response or withdrawal column
--               changes.
--     RESPOND   to confirmed or declined, from draft, requested, confirmed
--               or declined, either changing the status or naming a new
--               responder, source or reason. Never on a guest.
--               response_source 'self' requires responded_by_person_id =
--               person_id; 'on_behalf' requires responded_by_person_id to
--               be allowed to schedule the team; 'link' is refused in
--               Increment 1 (1b replaces this body). The service is not
--               cancelled and has not started. decline_reason is kept only
--               on a decline, else cleared. responded_at := now(). No send or
--               withdrawal column changes.
--     WITHDRAW  any non-withdrawn status -> withdrawn, EITHER with reason
--               'removed' by a withdrawn_by_person_id allowed to schedule
--               the team, OR with reason 'service_cancelled', no actor, and
--               the event already cancelled. withdrawn_at := now(). No send
--               or response column changes.
--     NONE      the status is unchanged and no send, response or withdrawal
--               column changes (only the reminder stamps may be set).
--   * Nothing ever returns to draft or leaves withdrawn.
create or replace function presby_worship_assignments_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_event record;
  v_send_same boolean;
  v_resp_same boolean;
  v_wd_same boolean;
  v_kind text;
begin
  if (new.id, new.organization_id, new.event_id, new.group_id, new.position_id, new.person_id,
      new.guest_name, new.assigned_by_person_id, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.event_id, old.group_id, old.position_id, old.person_id,
      old.guest_name, old.assigned_by_person_id, old.created_at) then
    raise exception 'worship: an assignment''s service, team, position, assignee and placer cannot change'
      using errcode = 'check_violation', constraint = 'worship_guard_immutable';
  end if;

  if old.status = 'withdrawn' then
    raise exception 'worship: a withdrawn assignment cannot change'
      using errcode = 'check_violation', constraint = 'worship_guard_terminal';
  end if;

  -- Reminder stamps: set once, stamped now().
  if new.unanswered_reminded_at is distinct from old.unanswered_reminded_at then
    if old.unanswered_reminded_at is not null or new.unanswered_reminded_at is null then
      raise exception 'worship: unanswered_reminded_at is set once'
        using errcode = 'check_violation', constraint = 'worship_guard_set_once';
    end if;
    new.unanswered_reminded_at := now();
  end if;
  if new.reminded_at is distinct from old.reminded_at then
    if old.reminded_at is not null or new.reminded_at is null then
      raise exception 'worship: reminded_at is set once'
        using errcode = 'check_violation', constraint = 'worship_guard_set_once';
    end if;
    new.reminded_at := now();
  end if;

  -- Trigger-owned stamps: kept unless the owning transition re-stamps them.
  new.requested_at := old.requested_at;
  new.responded_at := old.responded_at;
  new.withdrawn_at := old.withdrawn_at;

  v_send_same := (new.sent_by_person_id, new.notice_outcome)
                 is not distinct from (old.sent_by_person_id, old.notice_outcome);
  v_resp_same := (new.responded_by_person_id, new.response_source, new.decline_reason)
                 is not distinct from (old.responded_by_person_id, old.response_source, old.decline_reason);
  v_wd_same   := (new.withdrawn_by_person_id, new.withdrawn_reason)
                 is not distinct from (old.withdrawn_by_person_id, old.withdrawn_reason);

  if old.status = 'draft' and new.status = 'requested' then
    v_kind := 'send';
  elsif new.status in ('confirmed', 'declined')
        and old.status in ('draft', 'requested', 'confirmed', 'declined')
        and (new.status is distinct from old.status or not v_resp_same) then
    v_kind := 'respond';
  elsif new.status = 'withdrawn' then
    v_kind := 'withdraw';
  elsif new.status = old.status and v_send_same and v_resp_same and v_wd_same then
    return new;
  else
    raise exception 'worship: % -> % is not a legal change', old.status, new.status
      using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
  end if;

  select e.cancelled_at, e.starts_at into v_event
    from events e where e.id = new.event_id and e.organization_id = new.organization_id;

  if v_kind = 'send' then
    if not (v_resp_same and v_wd_same) then
      raise exception 'worship: sending changes only the send columns'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    if not presby_worship_may_schedule(new.organization_id, new.sent_by_person_id, new.group_id) then
      raise exception 'worship: the sender may not schedule this team'
        using errcode = 'check_violation', constraint = 'worship_guard_not_authorized';
    end if;
    if new.notice_outcome is null then
      raise exception 'worship: a sent request records its notice outcome'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    if v_event.cancelled_at is not null then
      raise exception 'worship: the service was cancelled'
        using errcode = 'check_violation', constraint = 'worship_guard_service_cancelled';
    end if;
    if v_event.starts_at <= presby_worship_org_now(new.organization_id) then
      raise exception 'worship: the service has already started'
        using errcode = 'check_violation', constraint = 'worship_guard_service_started';
    end if;
    if exists (select 1 from worship_service_teams st
                where st.event_id = new.event_id and st.group_id = new.group_id
                  and st.organization_id = new.organization_id and st.removed_at is not null) then
      raise exception 'worship: the team is no longer serving this service'
        using errcode = 'check_violation', constraint = 'worship_guard_service_team_removed';
    end if;
    new.requested_at := now();

  elsif v_kind = 'respond' then
    if not (v_send_same and v_wd_same) then
      raise exception 'worship: answering changes only the response columns'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    if new.guest_name is not null then
      raise exception 'worship: a guest has no answer to record'
        using errcode = 'check_violation', constraint = 'worship_guard_guest_shape';
    end if;
    if new.response_source = 'self' then
      if new.responded_by_person_id is distinct from new.person_id then
        raise exception 'worship: a self answer comes from the person asked'
          using errcode = 'check_violation', constraint = 'worship_guard_not_authorized';
      end if;
    elsif new.response_source = 'on_behalf' then
      if not presby_worship_may_schedule(new.organization_id, new.responded_by_person_id, new.group_id) then
        raise exception 'worship: the person recording this answer may not schedule this team'
          using errcode = 'check_violation', constraint = 'worship_guard_not_authorized';
      end if;
    elsif new.response_source = 'link' then
      raise exception 'worship: answering from an emailed link is not available yet'
        using errcode = 'check_violation', constraint = 'worship_guard_link_not_accepted';
    else
      raise exception 'worship: an answer names its source'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    if v_event.cancelled_at is not null then
      raise exception 'worship: the service was cancelled'
        using errcode = 'check_violation', constraint = 'worship_guard_service_cancelled';
    end if;
    if v_event.starts_at <= presby_worship_org_now(new.organization_id) then
      raise exception 'worship: the service has already started'
        using errcode = 'check_violation', constraint = 'worship_guard_service_started';
    end if;
    if new.status <> 'declined' then
      new.decline_reason := null;
    end if;
    new.responded_at := now();

  else -- withdraw
    if not (v_send_same and v_resp_same) then
      raise exception 'worship: withdrawing changes only the withdrawal columns'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    if new.withdrawn_reason = 'removed' then
      if not presby_worship_may_schedule(new.organization_id, new.withdrawn_by_person_id, new.group_id) then
        raise exception 'worship: the person removing this assignment may not schedule this team'
          using errcode = 'check_violation', constraint = 'worship_guard_not_authorized';
      end if;
    elsif new.withdrawn_reason = 'service_cancelled' then
      if new.withdrawn_by_person_id is not null or v_event.cancelled_at is null then
        raise exception 'worship: only a cancelled service withdraws its requests, with no actor'
          using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
      end if;
    else
      raise exception 'worship: a withdrawal names its reason'
        using errcode = 'check_violation', constraint = 'worship_guard_illegal_transition';
    end if;
    new.withdrawn_at := now();
  end if;

  return new;
end
$function$;

-- 7p. The triggers. Generic guards first (drop-then-create, so a re-apply
-- replaces them). BEFORE triggers fire in name order: on worship_services and
-- worship_assignments the guard (`..._guard_update`) runs before the touch
-- (`..._touch_updated_at`), and the generic guard lists updated_at as free.
drop trigger if exists worship_teams_guard_insert on worship_teams;
create trigger worship_teams_guard_insert
  before insert on worship_teams
  for each row execute function presby_worship_teams_guard_insert();
drop trigger if exists worship_teams_guard_update on worship_teams;
create trigger worship_teams_guard_update
  before update on worship_teams
  for each row execute function presby_worship_guard_immutable('', 'retired_at');

drop trigger if exists worship_positions_guard_insert on worship_positions;
create trigger worship_positions_guard_insert
  before insert on worship_positions
  for each row execute function presby_worship_positions_guard_insert();
drop trigger if exists worship_positions_guard_update on worship_positions;
create trigger worship_positions_guard_update
  before update on worship_positions
  for each row execute function presby_worship_guard_immutable('name,slots,sort_order', 'retired_at');

drop trigger if exists worship_position_qualifications_guard_update on worship_position_qualifications;
create trigger worship_position_qualifications_guard_update
  before update on worship_position_qualifications
  for each row execute function presby_worship_guard_immutable('', 'ended_at');

drop trigger if exists worship_service_types_guard_update on worship_service_types;
create trigger worship_service_types_guard_update
  before update on worship_service_types
  for each row execute function presby_worship_guard_immutable('name,start_time,duration_minutes,location', 'retired_at');

drop trigger if exists worship_service_type_teams_guard_update on worship_service_type_teams;
create trigger worship_service_type_teams_guard_update
  before update on worship_service_type_teams
  for each row execute function presby_worship_guard_immutable('removed_at', '');

drop trigger if exists worship_services_guard_update on worship_services;
create trigger worship_services_guard_update
  before update on worship_services
  for each row execute function presby_worship_guard_immutable('updated_by,updated_at', '');
drop trigger if exists worship_services_touch_updated_at on worship_services;
create trigger worship_services_touch_updated_at
  before update on worship_services
  for each row execute function presby_worship_touch_updated_at();

drop trigger if exists worship_service_teams_guard_insert on worship_service_teams;
create trigger worship_service_teams_guard_insert
  before insert on worship_service_teams
  for each row execute function presby_worship_service_teams_guard_add();
drop trigger if exists worship_service_teams_guard_update on worship_service_teams;
create trigger worship_service_teams_guard_update
  before update on worship_service_teams
  for each row execute function presby_worship_guard_immutable('removed_at', '');
drop trigger if exists worship_service_teams_guard_readd on worship_service_teams;
create trigger worship_service_teams_guard_readd
  before update on worship_service_teams
  for each row execute function presby_worship_service_teams_guard_add();

drop trigger if exists worship_assignments_guard_insert on worship_assignments;
create trigger worship_assignments_guard_insert
  before insert on worship_assignments
  for each row execute function presby_worship_assignments_guard_insert();
drop trigger if exists worship_assignments_guard_update on worship_assignments;
create trigger worship_assignments_guard_update
  before update on worship_assignments
  for each row execute function presby_worship_assignments_guard_update();
drop trigger if exists worship_assignments_touch_updated_at on worship_assignments;
create trigger worship_assignments_touch_updated_at
  before update on worship_assignments
  for each row execute function presby_worship_touch_updated_at();

drop trigger if exists worship_blockouts_guard_insert on worship_blockouts;
create trigger worship_blockouts_guard_insert
  before insert on worship_blockouts
  for each row execute function presby_worship_blockouts_guard_insert();
drop trigger if exists worship_blockouts_guard_update on worship_blockouts;
create trigger worship_blockouts_guard_update
  before update on worship_blockouts
  for each row execute function presby_worship_guard_immutable('', 'ended_at');

-- The delete guard on all nine.
do $$
declare
  t text;
begin
  foreach t in array array['worship_teams', 'worship_positions', 'worship_position_qualifications',
                           'worship_service_types', 'worship_service_type_teams', 'worship_services',
                           'worship_service_teams', 'worship_assignments', 'worship_blockouts'] loop
    execute format('drop trigger if exists %I on %I', t || '_guard_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function presby_worship_guard_delete()',
                   t || '_guard_delete', t);
  end loop;
end $$;

-- 7q. EXECUTE. Revoke from everyone; grant to presby_app only what the
-- tenant path calls (directly or from an invoker trigger). Trigger functions
-- need no EXECUTE grant to fire. The reminder claim is owner-only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'presby_worship_guard_immutable()',
    'presby_worship_guard_delete()',
    'presby_worship_touch_updated_at()',
    'presby_worship_teams_guard_insert()',
    'presby_worship_positions_guard_insert()',
    'presby_worship_service_teams_guard_add()',
    'presby_worship_blockouts_guard_insert()',
    'presby_worship_assignments_guard_insert()',
    'presby_worship_assignments_guard_update()',
    'presby_worship_claim_reminders(integer)'
  ] loop
    execute format('revoke all on function %s from public, presby_app, presby_platform', f);
  end loop;

  foreach f in array array[
    'presby_worship_org_today(uuid)',
    'presby_worship_org_now(uuid)',
    'presby_worship_enabled(uuid)',
    'presby_worship_leads_team(uuid, uuid, uuid, date)',
    'presby_worship_may_schedule(uuid, uuid, uuid)',
    'presby_worship_open_count()'
  ] loop
    execute format('revoke all on function %s from public, presby_app, presby_platform', f);
    execute format('grant execute on function %s to presby_app', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. RLS + grants
-- ---------------------------------------------------------------------------
-- ENABLE + FORCE (F1) and the one tenant_isolation policy on all nine.
-- Revoke-then-grant (F38): REVOKE ALL on a table also revokes every
-- column-level privilege on it, so the column lists below are re-established
-- exactly on a re-apply. presby_app: SELECT on every column, column-limited
-- INSERT and UPDATE, NO DELETE anywhere. presby_platform: nothing (Two
-- Hierarchies: no platform page reads worship data). Trigger-owned and in no
-- grant: requested_at, responded_at, withdrawn_at, unanswered_reminded_at,
-- reminded_at, updated_at, created_at. A BEFORE trigger assigning NEW.x is
-- not subject to the invoker's column privileges (they are checked against
-- the statement's target list), so the stamps still land under presby_app.
do $$
declare
  t text;
begin
  foreach t in array array['worship_teams', 'worship_positions', 'worship_position_qualifications',
                           'worship_service_types', 'worship_service_type_teams', 'worship_services',
                           'worship_service_teams', 'worship_assignments', 'worship_blockouts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format('create policy tenant_isolation on %I using (organization_id = presby_current_org()) '
                   'with check (organization_id = presby_current_org())', t);
    execute format('revoke all on %I from public, presby_app, presby_platform', t);
    execute format('grant select on %I to presby_app', t);
  end loop;
end $$;

grant insert (group_id, organization_id, created_by)
  on worship_teams to presby_app;
grant update (retired_at)
  on worship_teams to presby_app;

grant insert (organization_id, group_id, name, slots, sort_order, created_by)
  on worship_positions to presby_app;
grant update (name, slots, sort_order, retired_at)
  on worship_positions to presby_app;

grant insert (organization_id, group_id, position_id, person_id, created_by)
  on worship_position_qualifications to presby_app;
grant update (ended_at)
  on worship_position_qualifications to presby_app;

grant insert (organization_id, name, start_time, duration_minutes, location, created_by)
  on worship_service_types to presby_app;
grant update (name, start_time, duration_minutes, location, retired_at)
  on worship_service_types to presby_app;

grant insert (organization_id, service_type_id, group_id)
  on worship_service_type_teams to presby_app;
grant update (removed_at)
  on worship_service_type_teams to presby_app;

grant insert (event_id, organization_id, service_type_id, updated_by)
  on worship_services to presby_app;
grant update (updated_by)
  on worship_services to presby_app;

grant insert (organization_id, event_id, group_id)
  on worship_service_teams to presby_app;
grant update (removed_at)
  on worship_service_teams to presby_app;

grant insert (organization_id, event_id, group_id, position_id, person_id, guest_name,
              assigned_by_person_id, status, responded_by_person_id, response_source, decline_reason)
  on worship_assignments to presby_app;
grant update (status, sent_by_person_id, notice_outcome, responded_by_person_id, response_source,
              decline_reason, withdrawn_by_person_id, withdrawn_reason)
  on worship_assignments to presby_app;

grant insert (organization_id, person_id, starts_on, ends_on, reason)
  on worship_blockouts to presby_app;
grant update (ended_at)
  on worship_blockouts to presby_app;

-- ---------------------------------------------------------------------------
-- 9. comments, then the closing assertions
-- ---------------------------------------------------------------------------
comment on table worship_teams is
  'A worship team: a 1:1 extension of a MANAGED choir or team group (R5, DECISION-317; drizzle/0085). The roster is the group''s group_memberships, written only through the groups.ts primitives; a chair or leader row in date is the scheduling seat (presby_worship_leads_team). retired_at is set once. FORCE RLS, no DELETE grant; written only by src/lib/worship/store.ts.';
comment on table worship_positions is
  'A position on a worship team (Drums, Soprano, Usher), with how many people fill it (slots 1-20). Name unique among the team''s live positions, case-insensitive. retired_at set once; a retired position is never offered and refuses new assignments (drizzle/0085).';
comment on table worship_position_qualifications is
  'Who can fill which position on a team. Ended, never deleted. Roster presence is a live join to group_memberships, not a constraint, so someone who leaves the team drops out of the picker with no write (drizzle/0085).';
comment on table worship_service_types is
  'A kind of service: the usual start time, length, place and serving teams, used to add several services at once through the events series math (R2). Renameable display defaults, never a service''s identity (drizzle/0085).';
comment on table worship_service_type_teams is
  'The teams that usually serve a service type. removed_at is settable and clearable (drizzle/0085).';
comment on table worship_services is
  'A worship service: a 1:1 extension of an events row (R2, DECISION-317). A service''s identity is this row, not an event type; a worship write to an event requires it (the C2 join-under-lock in store.ts). NO ACTION FK to events. Residual S2 (paper): the database does not stop a row being attached to an existing event; store.ts is the sole inserter (drizzle/0085).';
comment on table worship_service_teams is
  'The teams serving one service. The three-column target of worship_assignments_service_team_fk, so an assignment''s team must be serving its service. removed_at is settable and clearable; clearing it passes the insert guard again (drizzle/0085).';
comment on table worship_assignments is
  'A person (or a guest, by name only) in a position on a service (DECISION-324). draft -> requested (Send) -> confirmed / declined (re-answerable until the service starts) -> withdrawn (terminal; removed by a scheduler, or service_cancelled with no actor once the event is cancelled). A guest is born confirmed. Every transition and actor is checked by worship_assignments_guard_update on EVERY connection (F44); the actor ids come from the application (paper, R7). response_source link is refused until Increment 1b. Reminder stamps are written only by presby_worship_claim_reminders (drizzle/0085).';
comment on column worship_assignments.notice_outcome is
  'What happened at Send: emailed, guardian (presumed minor, no notice of any kind: DECISION-322), no_address, do_not_contact. A snapshot for the board''s reach note, not a delivery record.';
comment on column worship_assignments.response_source is
  'self (the assignee, signed in), on_behalf (a scheduler, attributed by responded_by_person_id) or link (Increment 1b; refused by the guard until then).';
comment on table worship_blockouts is
  'A person''s "dates I can''t serve" at one organization (DECISION-327, R12): an end-dated range with a closed reason (away, work, family, other) and NO free-text column. At most 366 days; may not end before the organization''s today; at most 50 live per person (trigger, advisory lock). Never deleted: ended (drizzle/0085).';
comment on function presby_worship_org_today(uuid) is
  'The organization''s calendar date in organization_settings.time_zone, falling back to America/New_York (DEFAULT_ORG_TIME_ZONE). SECURITY DEFINER (F26). EXECUTE: owner and presby_app (drizzle/0085).';
comment on function presby_worship_org_now(uuid) is
  'The organization''s wall-clock now (timestamp without time zone), compared with events.starts_at (DECISION-113 ruling 3). SECURITY DEFINER. EXECUTE: owner and presby_app (drizzle/0085).';
comment on function presby_worship_enabled(uuid) is
  'The org_portal.worship toggle composed exactly as orgFeatureEnabledInTx composes it: organization type in (congregation, new_worshiping_community), then the category axis (worship category; a missing row is on), then the toggle row (missing = off). Invoker. Increment 1b''s definers reuse it (drizzle/0085).';
comment on function presby_worship_leads_team(uuid, uuid, uuid, date) is
  'The worship scheduling seat (R7, DECISION-318): a chair or leader row in date on p_as_of, on a managed group carrying a worship_teams row, held by an unmerged, living person whose relationship has not ended. Per team. Invoker (drizzle/0085).';
comment on function presby_worship_may_schedule(uuid, uuid, uuid) is
  'worship.schedule (presby_has_permission on the organization''s today) OR the leader seat on that team. The authority every assignment guard checks for its actor column (drizzle/0085).';
comment on function presby_worship_open_count() is
  'A bare count of distinct people with a requested or confirmed assignment on an uncancelled service starting after the organization''s now, for presby_current_org() only (zero with no context). Behind the Features-page warning. SECURITY DEFINER, EXECUTE presby_app (drizzle/0085).';
comment on function presby_worship_claim_reminders(integer) is
  'Owner-only cross-organization reminder claim (DECISION-325): stamps due assignments (unanswered: requested over 24h ago, service within 72h; confirmed: service within 48h), at most once per kind, FOR UPDATE SKIP LOCKED, batch clamped to 1..500, and returns (kind, organization_id, assignment_id, event_id, person_id, address). Never declined, withdrawn, guests, cancelled or started services, merged, deceased, ended, presumed minors, no deliverable role address, or toggle off. Called only by src/lib/worship/sweep.ts in the transaction that writes the queue rows (drizzle/0085).';
comment on function presby_worship_guard_immutable() is
  'Generic BEFORE UPDATE guard on the worship tables other than assignments: TG_ARGV[0] free columns, TG_ARGV[1] set-once columns, every other column immutable. Binds every connection (F44). drizzle/0085.';
comment on function presby_worship_guard_delete() is
  'BEFORE DELETE on all nine worship tables: refused (insufficient_privilege) unless the organization row is already gone (the fixture-teardown cascade). drizzle/0085.';
comment on function presby_worship_assignments_guard_insert() is
  'worship_assignments BEFORE INSERT: a person is born draft, a guest confirmed on the placer''s behalf; the placer may schedule the team; service uncancelled and not started; team and position live; serving row present; the person on the roster now, unmerged, living, relationship not ended. Stamps forced. drizzle/0085 section 7n.';
comment on function presby_worship_assignments_guard_update() is
  'worship_assignments BEFORE UPDATE: identity immutable; withdrawn terminal; exactly one of send (draft -> requested), respond (to confirmed/declined; self, on_behalf; link refused until 1b), withdraw (removed by a scheduler, or service_cancelled with no actor), or no change; stamps trigger-owned. drizzle/0085 section 7o.';

do $$
declare
  v_n integer;
  t text;
  v_type text;
begin
  -- The three keys, tier 1, no 2FA, module worship.
  select count(*) into v_n from permissions where key like 'worship.%';
  if v_n <> 3 then
    raise exception 'worship 0085 assertion: expected 3 worship.%% permission rows, found %', v_n;
  end if;
  select count(*) into v_n from permissions
   where key in ('worship.manage', 'worship.plan', 'worship.schedule')
     and module = 'worship' and sensitivity_tier = 1 and not requires_two_factor;
  if v_n <> 3 then
    raise exception 'worship 0085 assertion: the worship keys are not all tier 1, module worship, without 2FA';
  end if;

  -- The bundle: in for the two types, out for the councils.
  foreach v_type in array array['congregation', 'new_worshiping_community'] loop
    if not (presby_founding_administrator_permission_keys(v_type)
            @> array['worship.manage', 'worship.plan', 'worship.schedule']) then
      raise exception 'worship 0085 assertion: the founding bundle for % lacks a worship key', v_type;
    end if;
  end loop;
  foreach v_type in array array['presbytery', 'synod', 'general_assembly'] loop
    if presby_founding_administrator_permission_keys(v_type)
       && array['worship.manage', 'worship.plan', 'worship.schedule'] then
      raise exception 'worship 0085 assertion: the founding bundle for % carries a worship key', v_type;
    end if;
  end loop;
  if not (presby_founding_administrator_permission_keys('congregation')
          @> array['careers.manage', 'careers.applicants', 'domains.manage']) then
    raise exception 'worship 0085 assertion: the re-created bundle lost a base key';
  end if;

  -- The template carries exactly the three.
  select count(*) into v_n
    from app_role_permissions rp join app_roles r on r.id = rp.role_id
   where r.organization_id is null and r.key = 'worship_leader';
  if v_n <> 3 then
    raise exception 'worship 0085 assertion: worship_leader carries % keys, expected 3', v_n;
  end if;
  select count(*) into v_n
    from app_role_permissions rp join app_roles r on r.id = rp.role_id
   where r.organization_id is null and r.key = 'worship_leader'
     and rp.permission_key not in ('worship.manage', 'worship.plan', 'worship.schedule');
  if v_n <> 0 then
    raise exception 'worship 0085 assertion: worship_leader carries a non-worship key';
  end if;

  -- No protected or constitutional role, and no clerk, Session, pastor or
  -- treasurer role, carries a worship key.
  select count(*) into v_n
    from app_role_permissions rp join app_roles r on r.id = rp.role_id
   where rp.permission_key like 'worship.%'
     and (r.is_protected or r.role_kind = 'constitutional'
          or r.key like '%stated_clerk%'
          or r.key in ('session_member', 'installed_pastor', 'treasurer'));
  if v_n <> 0 then
    raise exception 'worship 0085 assertion: % protected, constitutional, clerk, Session, pastor or treasurer binding(s) carry a worship key', v_n;
  end if;

  -- Every in-scope org-owned founding administrator holds all three; no
  -- out-of-scope one holds any.
  select count(*) into v_n
    from app_roles r join organizations o on o.id = r.organization_id
   where r.key = 'founding_administrator'
     and o.organization_type in ('congregation', 'new_worshiping_community')
     and (select count(*) from app_role_permissions rp
           where rp.role_id = r.id
             and rp.permission_key in ('worship.manage', 'worship.plan', 'worship.schedule')) <> 3;
  if v_n <> 0 then
    raise exception 'worship 0085 assertion: % in-scope founding_administrator role(s) lack a worship key', v_n;
  end if;
  select count(*) into v_n
    from app_roles r join organizations o on o.id = r.organization_id
    join app_role_permissions rp on rp.role_id = r.id
   where r.key = 'founding_administrator'
     and o.organization_type not in ('congregation', 'new_worshiping_community')
     and rp.permission_key like 'worship.%';
  if v_n <> 0 then
    raise exception 'worship 0085 assertion: % out-of-scope founding_administrator binding(s) carry a worship key', v_n;
  end if;

  -- The global flag is gone.
  if exists (select 1 from feature_flags where key = 'org_portal.worship') then
    raise exception 'worship 0085 assertion: the org_portal.worship feature_flags row still exists';
  end if;

  -- FORCE on all nine; no DELETE (or TRUNCATE) for either role, by ACL.
  foreach t in array array['worship_teams', 'worship_positions', 'worship_position_qualifications',
                           'worship_service_types', 'worship_service_type_teams', 'worship_services',
                           'worship_service_teams', 'worship_assignments', 'worship_blockouts'] loop
    if not exists (select 1 from pg_class c where c.oid = t::regclass
                    and c.relrowsecurity and c.relforcerowsecurity) then
      raise exception 'worship 0085 assertion: % is not FORCE ROW LEVEL SECURITY', t;
    end if;
    select count(*) into v_n
      from pg_class c, lateral aclexplode(c.relacl) a
     where c.oid = t::regclass
       and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
       and a.privilege_type in ('DELETE', 'TRUNCATE');
    if v_n <> 0 then
      raise exception 'worship 0085 assertion: presby_app or presby_platform holds DELETE or TRUNCATE on %', t;
    end if;
    select count(*) into v_n
      from pg_class c, lateral aclexplode(c.relacl) a
     where c.oid = t::regclass and a.grantee = 'presby_platform'::regrole;
    if v_n <> 0 then
      raise exception 'worship 0085 assertion: presby_platform holds a privilege on %', t;
    end if;
  end loop;

  -- The claim is owner-only.
  if has_function_privilege('presby_app', 'presby_worship_claim_reminders(integer)', 'execute')
     or has_function_privilege('presby_platform', 'presby_worship_claim_reminders(integer)', 'execute') then
    raise exception 'worship 0085 assertion: the reminder claim is executable by a non-owner role';
  end if;

  raise notice 'worship 0085: closing assertions passed';
end $$;
