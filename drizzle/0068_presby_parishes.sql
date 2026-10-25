-- drizzle/0068_presby_parishes.sql
--
-- Parish (deacon-district) management, fpcw Track C
-- (docs/work-log/2026-10-25-parish-management.md, Phase 2 R1/R2, Phase 3
-- "Data Model"; DECISION-242, DECISION-243; findings F258, F259, F260, F262,
-- F263).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0068_presby_parishes.sql
--
-- ORDER AND DEPENDENCIES. Written against main at ce661d7 (newest applied
-- migration 0064). It depends on nothing in 0065-0067 (other pipelines' numbers,
-- not on main when this was written). It REPLACES two objects whose newest
-- definition is in 0062: presby_sync_derived_group() and the
-- officer_terms_office_allowed CHECK. If any migration that lands before this
-- one redefines either, rebase sections 8a and 8b on that newer body first
-- (Phase 3 Risks, item 1). The orchestrator may renumber this file at
-- integration; officer-offices.test.ts finds it by name, not by number.
--
-- DEPLOY ORDER: this file is additive for the pre-feature application. The
-- old code never deletes org_units, never writes archived_at, never records
-- the new office, and only ever writes active, non-campus districts. Apply it
-- first, then deploy the code.
--
-- The whole file is idempotent: every statement is `if not exists`,
-- `on conflict do nothing`, drop-then-add, `create or replace`, a revoke, or
-- a loop whose predicate no longer matches once applied. Proven by applying
-- the whole file twice (work-log, Phase 4 Batch A). Unreleased until shipped,
-- so it may be corrected in place until then (CLAUDE.md -> Project Layout ->
-- drizzle/).
--
--   1. preconditions           stop-blocks, counts only, never a name
--   2. org_units               archived_at, unit_type CHECK (F259), name
--                              shape CHECK, active-name unique index
--   3. households index        (organization_id, org_unit_id) (F263)
--   4. permission catalog      parishes.assign
--   5. seat-key map            presby_seat_key_group(text)
--   6. org-unit target guard   archived / campus / missing district refused
--                              on households and open officer_terms
--                              (DECISION-243), FOR SHARE
--   7. seat-only guards        R1, F260: binding, role shape, group-arm-only
--                              grant, no commission or delegation
--   8. vocabulary              derived-group CASE arm, office CHECK, the
--                              derived group backfill (DECISION-242)
--   9. seat role backfill      DO loop, separate statements (P3-7)
--  10. privileges              revoke DELETE on org_units (R2, F258) and the
--                              owner-path delete guard
--  11. comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No delete anywhere (operator ruling: all deletes are soft).
--   * No audit row: a migration backfill has no actor. Moves and district
--     lifecycle write their audit rows in TypeScript (src/lib/parishes.ts,
--     insertAuditRow in the same transaction; DECISION-245).
--   * No SECURITY DEFINER move function (DECISION-243): a move never leaves
--     one organization, RLS enforces tenancy, the target guard enforces the
--     archive and campus rules, and authorization is checked in the
--     application inside the same transaction.
--   * No change to `moderator` (DECISION-079) and no re-materialising touch:
--     no existing term holds the new office, so no existing row gains
--     authority from this file. An empty derived group grants nothing, so
--     sections 8 and 9 provision and do not grant (0052 note 5, 0062 s.7).
--   * presby_founding_administrator_permission_keys is untouched.
--   * The F260 hole for session_member / roll.approve is NOT closed here
--     (P3-8): existing templates and the dev fixture put roll.approve on other
--     roles. presby_seat_key_group() is where that one row would go.
--   * grant_reason on the backfilled grant is informational text and never a
--     discriminator; the role KEY is.
--
-- ROLLBACK (rehearsed on the pipeline branch inside a rolled-back
-- transaction, Phase 4 Batch A). Data (archived_at values, the seat groups,
-- roles, grants and any recorded seat terms) is left in place: nothing is
-- deleted, and without the application the parishes.assign key is inert.
-- Step 4's CHECK is narrowed back to 0062's list ONLY when no
-- deacons_moderator term exists; otherwise the widened CHECK stays (terms are
-- never deleted).
--   1. drop trigger if exists households_org_unit_target_guard on households;
--      drop trigger if exists officer_terms_org_unit_target_guard on officer_terms;
--      drop trigger if exists app_role_permissions_seat_key_guard on app_role_permissions;
--      drop trigger if exists app_roles_seat_role_guard on app_roles;
--      drop trigger if exists role_grants_seat_key_guard on role_grants;
--      drop trigger if exists administrative_commissions_seat_key_guard on administrative_commissions;
--      drop trigger if exists org_delegations_seat_key_guard on org_delegations;
--      drop trigger if exists org_units_guard_delete on org_units;
--   2. drop function if exists presby_guard_org_unit_target(),
--        presby_guard_seat_key_binding(), presby_guard_seat_role_shape(),
--        presby_guard_seat_key_grant(), presby_guard_seat_key_downward(),
--        presby_org_units_guard_delete(), presby_seat_key_group(text);
--   3. alter table org_units drop constraint if exists org_units_unit_type_check;
--      alter table org_units drop constraint if exists org_units_name_shape;
--      drop index if exists org_units_active_name_idx;
--      (households_org_unit_idx and archived_at may stay; both are inert)
--   4. the 0062 section 8a presby_sync_derived_group() body; then, only if
--      not exists (select 1 from officer_terms where office = 'deacons_moderator'):
--      alter table officer_terms drop constraint if exists officer_terms_office_allowed;
--      + the 0062 section 8b CHECK.
--   5. grant delete on org_units to presby_app, presby_platform;
--   6. the parishes.assign permission row stays (app_role_permissions rows
--      name it, and all deletes are soft).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md). Drizzle mirrors: src/lib/db/domain/
-- org.ts (orgUnits), people.ts (households index), officers.ts (office CHECK).

-- ---------------------------------------------------------------------------
-- 1. preconditions (stop-blocks; counts only, never a name)
-- ---------------------------------------------------------------------------
-- Each one is a row the constraints below cannot be built over, or a row the
-- new guard would make un-editable. Which row to correct is a human decision.
-- Measured 0 on every count on the pipeline branch (2026-10-25); the
-- orchestrator re-measures read-only in production before the apply (Phase 3
-- "Pre-ship items", query 2).
do $$
declare
  v_bad_type    bigint;
  v_bad_name    bigint;
  v_dup_names   bigint;
  v_hh_campus   bigint;
  v_term_campus bigint;
  v_bad_office  bigint;
begin
  select count(*) into v_bad_type
    from org_units where unit_type not in ('parish', 'campus', 'district');
  if v_bad_type > 0 then
    raise exception
      '0068: % org_units row(s) carry a unit_type outside (parish, campus, district); correct them before this migration can apply',
      v_bad_type
      using errcode = 'check_violation';
  end if;

  select count(*) into v_bad_name
    from org_units
   where name <> btrim(name)
      or name is not nfc normalized
      or char_length(name) not between 1 and 80;
  if v_bad_name > 0 then
    raise exception
      '0068: % org_units name(s) are untrimmed, not NFC-normalized, or outside 1 to 80 characters; correct them before this migration can apply',
      v_bad_name
      using errcode = 'check_violation';
  end if;

  -- Before this file, every row is active (archived_at does not exist yet).
  -- On a RE-apply, an archived district may legitimately share a name with an
  -- active one (org_units_active_name_idx is partial), so only active rows
  -- count; the column is read dynamically because it may not exist yet.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'org_units'
                and column_name = 'archived_at') then
    execute 'select count(*) from (select 1 from org_units where archived_at is null
                                    group by organization_id, lower(name)
                                   having count(*) > 1) d'
       into v_dup_names;
  else
    select count(*) into v_dup_names
      from (select 1 from org_units
             group by organization_id, lower(name)
            having count(*) > 1) d;
  end if;
  if v_dup_names > 0 then
    raise exception
      '0068: % organization(s) have two org_units whose names differ only in case; rename one before this migration can apply',
      v_dup_names
      using errcode = 'check_violation';
  end if;

  select count(*) into v_hh_campus
    from households h
    join org_units u on u.id = h.org_unit_id and u.organization_id = h.organization_id
   where u.unit_type = 'campus';
  if v_hh_campus > 0 then
    raise exception
      '0068: % household(s) point at a campus; households.org_unit_id now means deacon district only (DECISION-243). Clear them before this migration can apply',
      v_hh_campus
      using errcode = 'check_violation';
  end if;

  select count(*) into v_term_campus
    from officer_terms ot
    join org_units u on u.id = ot.org_unit_id and u.organization_id = ot.organization_id
   where u.unit_type = 'campus'
     and (ot.ends_on is null or ot.ends_on > current_date);
  if v_term_campus > 0 then
    raise exception
      '0068: % open deacon term(s) point at a campus; correct them before this migration can apply',
      v_term_campus
      using errcode = 'check_violation';
  end if;

  -- officer_terms_office_allowed is re-added VALIDATED in section 8b. 0062
  -- already enforces the old vocabulary, so this can only fire on a database
  -- that skipped 0062.
  select count(*) into v_bad_office
    from officer_terms
   where office not in ('ruling_elder', 'installed_pastor', 'co_pastor',
                        'associate_pastor', 'deacon', 'deacons_moderator',
                        'clerk_of_session', 'moderator', 'treasurer', 'trustee');
  if v_bad_office > 0 then
    raise exception
      '0068: % officer_terms row(s) carry an office outside the vocabulary; correct them before this migration can apply',
      v_bad_office
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from organizations where organization_type = 'congregation')
     and not exists (select 1 from group_types where key = 'roster') then
    raise exception
      '0068: the global group type ''roster'' is missing; congregations cannot be given their Board of Deacons Moderator group'
      using errcode = 'foreign_key_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. org_units (G2, F259, P3-6)
-- ---------------------------------------------------------------------------
-- Nullable: null is active. The actor goes in the audit row, not a column.
alter table org_units add column if not exists archived_at timestamptz;

-- The vocabulary existed only as a comment (F259). Validated: section 1
-- stopped on a violator.
alter table org_units drop constraint if exists org_units_unit_type_check;
alter table org_units add constraint org_units_unit_type_check
  check (unit_type in ('parish', 'campus', 'district'));

-- The library normalizes (trim, NFC, strip control and zero-width characters,
-- collapse whitespace; src/lib/parishes-pure.ts normalizeDistrictName); the
-- database keeps what the unique index below relies on. Control and
-- zero-width stripping stays application-level (P3-6).
alter table org_units drop constraint if exists org_units_name_shape;
alter table org_units add constraint org_units_name_shape
  check (name = btrim(name)
         and name is nfc normalized
         and char_length(name) between 1 and 80);

-- Unique among ACTIVE districts, case-insensitively. An archived district
-- keeps its name; a restore that collides raises unique_violation on this
-- index, which src/lib/parishes.ts maps to `name_taken`.
create unique index if not exists org_units_active_name_idx
  on org_units (organization_id, lower(name))
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- 3. households index (F263)
-- ---------------------------------------------------------------------------
-- Serves countHouseholdsByUnit(), the district page and the Unassigned query
-- (org_unit_id is null). None existed.
create index if not exists households_org_unit_idx
  on households (organization_id, org_unit_id);

-- ---------------------------------------------------------------------------
-- 4. permission catalog
-- ---------------------------------------------------------------------------
-- Tier 1. Seat-only (sections 5 and 7): it can sit only on the protected
-- constitutional role deacons_moderator, granted only through the group arm to
-- the derived deacons_moderator group. src/lib/permissions.ts (frozen) is not
-- touched; the tenant catalog is this table.
insert into permissions (key, module, description, sensitivity_tier)
values ('parishes.assign', 'parishes',
        'Assign households to deacon districts (held through the Moderator of the Board of Deacons seat)',
        1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. seat-key map (P3-8)
-- ---------------------------------------------------------------------------
-- The ONE list of seat-only permission keys and the derived group each may be
-- carried through. Pinned equal to SEAT_ONLY_PERMISSION_KEYS
-- (src/lib/parishes-pure.ts) by a source-scan test. Called only from the
-- guards in section 7, which run as the owner: no grant.
create or replace function presby_seat_key_group(p_key text)
returns text language sql immutable security definer
set search_path = public, pg_temp
as $$
  select case p_key
    when 'parishes.assign' then 'deacons_moderator'
    else null end;
$$;
revoke all on function presby_seat_key_group(text) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 6. org-unit target guard (G2, DECISION-243)
-- ---------------------------------------------------------------------------
-- Refuses a NEWLY set district that is archived, a campus, or missing:
--   * households: on INSERT with a district, or an UPDATE that changes it.
--     Clearing (null) and leaving it unchanged always pass, so archiving a
--     district never makes its households un-editable.
--   * officer_terms: only for a term that is open after the write
--     (ends_on is null or ends_on > current_date). An UPDATE of a term that
--     was already open and keeps its district passes, so ending, shortening
--     or leaving a term alone in an archived district never fails; a new,
--     re-opened or re-pointed open term is checked. (Only deacon terms carry
--     a district: officer_terms_org_unit_deacon_check.)
-- FOR SHARE is the point: the composite FK check takes only FOR KEY SHARE,
-- which an archive's UPDATE of archived_at does not conflict with, so without
-- it a move and a concurrent archive could both commit. With it, whichever
-- transaction locks the district row first wins and the other waits.
-- INVOKER, on purpose: everything it reads is in new.organization_id, which
-- RLS already confines to the caller's org. presby_app needs UPDATE on
-- org_units for FOR SHARE, which it holds. search_path pinned.
-- Raised with a named constraint so src/lib/parishes.ts and officers.ts can
-- tell the three cases apart.
create or replace function presby_guard_org_unit_target()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unit_type   text;
  v_archived_at timestamptz;
  v_found       boolean;
begin
  if new.org_unit_id is null then
    return new;
  end if;

  if tg_table_name = 'officer_terms' then
    if not (new.ends_on is null or new.ends_on > current_date) then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and (old.ends_on is null or old.ends_on > current_date)
       and old.org_unit_id is not distinct from new.org_unit_id then
      return new;
    end if;
  elsif tg_op = 'UPDATE' and old.org_unit_id is not distinct from new.org_unit_id then
    return new;
  end if;

  select u.unit_type, u.archived_at, true
    into v_unit_type, v_archived_at, v_found
    from org_units u
   where u.id = new.org_unit_id
     and u.organization_id = new.organization_id
     for share;

  if v_found is null then
    raise exception '%: that district does not exist at this organization', tg_table_name
      using errcode = 'foreign_key_violation',
            constraint = 'org_unit_target_missing';
  end if;
  if v_archived_at is not null then
    raise exception '%: that district is archived; nothing can be moved into it', tg_table_name
      using errcode = 'check_violation',
            constraint = 'org_unit_target_archived';
  end if;
  if v_unit_type = 'campus' then
    raise exception '%: a campus is not a deacon district', tg_table_name
      using errcode = 'check_violation',
            constraint = 'org_unit_target_campus';
  end if;
  return new;
end $$;
revoke all on function presby_guard_org_unit_target() from public, presby_app, presby_platform;

drop trigger if exists households_org_unit_target_guard on households;
create trigger households_org_unit_target_guard
  before insert or update of org_unit_id on households
  for each row execute function presby_guard_org_unit_target();

drop trigger if exists officer_terms_org_unit_target_guard on officer_terms;
create trigger officer_terms_org_unit_target_guard
  before insert or update of org_unit_id, ends_on on officer_terms
  for each row execute function presby_guard_org_unit_target();

-- ---------------------------------------------------------------------------
-- 7. seat-only guards (R1, F260; DECISION-242)
-- ---------------------------------------------------------------------------
-- Without these, a person holding role_grants.manage and roles.manage could
-- put parishes.assign on a custom role, or grant the seat role to a person,
-- and the seat would become a grant to a named person. Every arm of
-- presby_effective_permissions() is closed: direct (person) grants, group
-- grants to any group but the seat group, commissions and delegations.
-- Modelled on 0055 section 15 (presby_giving_guard_downward_role,
-- presby_giving_guard_role_binding); 0055 is not edited.
-- All SECURITY DEFINER with search_path pinned: app_role_permissions, groups
-- and role_grants are tenant-RLS'd, and a commission or delegation row names
-- a role owned by a different organization than the GUC's (F26). They fire on
-- every connection, the owner's included (a trigger binds neondb_owner; a
-- grant does not, F44). Refusals are insufficient_privilege with a named
-- constraint the TypeScript can map (role-grants.ts, role-definitions.ts
-- return typed refusals before reaching these).

-- 7a. Binding: a seat-only key may sit only on an org-owned, protected,
-- constitutional role whose key equals the key's group, and only on a role
-- that has never been granted on any other arm. "Never", not "currently":
-- re-opening an ended person grant by moving its ends_on does not fire the
-- role_id trigger in 7c (the 0055 "any reference" reasoning).
create or replace function presby_guard_seat_key_binding()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_group text;
  v_ok    boolean;
begin
  v_group := presby_seat_key_group(new.permission_key);
  if v_group is null then
    return new;
  end if;

  select (r.organization_id is not null
          and r.is_protected
          and r.role_kind = 'constitutional'
          and r.key = v_group)
    into v_ok
    from app_roles r
   where r.id = new.role_id;

  if not coalesce(v_ok, false) then
    raise exception 'app_role_permissions: % is held only through a recorded seat and cannot be added to this role (DECISION-242)', new.permission_key
      using errcode = 'insufficient_privilege',
            constraint = 'seat_key_binding';
  end if;

  if exists (select 1 from role_grants rg
              where rg.role_id = new.role_id
                and not exists (select 1 from groups g
                                 where g.id = rg.group_id
                                   and g.organization_id = rg.organization_id
                                   and g.membership_source = 'derived'
                                   and g.derived_from = v_group))
     or exists (select 1 from administrative_commissions ac where ac.role_id = new.role_id)
     or exists (select 1 from org_delegations od where od.role_id = new.role_id) then
    raise exception 'app_role_permissions: % cannot be added to a role that has been granted other than through its seat (DECISION-242)', new.permission_key
      using errcode = 'insufficient_privilege',
            constraint = 'seat_key_binding';
  end if;
  return new;
end $$;
revoke all on function presby_guard_seat_key_binding() from public, presby_app, presby_platform;

drop trigger if exists app_role_permissions_seat_key_guard on app_role_permissions;
create trigger app_role_permissions_seat_key_guard
  before insert or update on app_role_permissions
  for each row execute function presby_guard_seat_key_binding();

-- 7b. Role shape: the same predicate as 7a, held from the other side. A role
-- that carries a seat-only key cannot be moved to another org, re-keyed,
-- unprotected or made custom (which would open it to the custom-role editor).
-- The application only ever updates app_roles.deactivated_at, which this
-- trigger does not watch.
create or replace function presby_guard_seat_role_shape()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from app_role_permissions rp
              where rp.role_id = new.id
                and presby_seat_key_group(rp.permission_key) is not null
                and not (new.organization_id is not null
                         and new.is_protected
                         and new.role_kind = 'constitutional'
                         and new.key = presby_seat_key_group(rp.permission_key))) then
    raise exception 'app_roles: this role carries a seat-only permission; its key, organization, kind and protection are fixed (DECISION-242)'
      using errcode = 'insufficient_privilege',
            constraint = 'seat_role_shape';
  end if;
  return new;
end $$;
revoke all on function presby_guard_seat_role_shape() from public, presby_app, presby_platform;

drop trigger if exists app_roles_seat_role_guard on app_roles;
create trigger app_roles_seat_role_guard
  before update of key, organization_id, role_kind, is_protected on app_roles
  for each row execute function presby_guard_seat_role_shape();

-- 7c. Grant: a role carrying a seat-only key may be granted only through the
-- group arm, to this organization's derived group of that key's name. A
-- person-arm grant, or a group arm to any other group (including a managed
-- group that happens to carry derived_from), is refused. Ending a grant
-- (ends_on) does not fire this trigger and is never blocked.
create or replace function presby_guard_seat_key_grant()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_group text;
begin
  select presby_seat_key_group(rp.permission_key)
    into v_group
    from app_role_permissions rp
   where rp.role_id = new.role_id
     and presby_seat_key_group(rp.permission_key) is not null
   order by rp.permission_key
   limit 1;
  if v_group is null then
    return new;
  end if;

  if new.group_id is null
     or not exists (select 1 from groups g
                     where g.id = new.group_id
                       and g.organization_id = new.organization_id
                       and g.membership_source = 'derived'
                       and g.derived_from = v_group) then
    raise exception 'role_grants: this role is held through a recorded seat and can be granted only to that seat''s group (DECISION-242)'
      using errcode = 'insufficient_privilege',
            constraint = 'seat_key_grant';
  end if;
  return new;
end $$;
revoke all on function presby_guard_seat_key_grant() from public, presby_app, presby_platform;

drop trigger if exists role_grants_seat_key_guard on role_grants;
create trigger role_grants_seat_key_guard
  before insert or update of role_id, person_id, group_id on role_grants
  for each row execute function presby_guard_seat_key_grant();

-- 7d. Commission and delegation: a role carrying any seat-only key never
-- travels the downward arms. role_id is nullable on administrative_commissions.
create or replace function presby_guard_seat_key_downward()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.role_id is not null and exists (
       select 1 from app_role_permissions rp
        where rp.role_id = new.role_id
          and presby_seat_key_group(rp.permission_key) is not null) then
    raise exception '%: a role carrying a seat-only permission cannot be granted through an administrative commission or delegation (DECISION-242)', tg_table_name
      using errcode = 'insufficient_privilege',
            constraint = 'seat_key_downward';
  end if;
  return new;
end $$;
revoke all on function presby_guard_seat_key_downward() from public, presby_app, presby_platform;

drop trigger if exists administrative_commissions_seat_key_guard on administrative_commissions;
create trigger administrative_commissions_seat_key_guard
  before insert or update of role_id on administrative_commissions
  for each row execute function presby_guard_seat_key_downward();

drop trigger if exists org_delegations_seat_key_guard on org_delegations;
create trigger org_delegations_seat_key_guard
  before insert or update of role_id on org_delegations
  for each row execute function presby_guard_seat_key_downward();

-- ---------------------------------------------------------------------------
-- 8. vocabulary and the derived group (DECISION-242)
-- ---------------------------------------------------------------------------
-- (a) 0062 section 8a's body plus ONE arm: deacons_moderator materialises into
-- the derived deacons_moderator group. Same signature, language, security
-- mode (invoker) and missing-group error text; the '-> session' arms are
-- untouched (pinned to SESSION_OFFICES by officer-offices.test.ts, which reads
-- this file). moderator stays unmapped (DECISION-079). Only congregations
-- have the group; src/lib/officers.ts refuses the office elsewhere before
-- this error can fire.
create or replace function presby_sync_derived_group()
returns trigger language plpgsql
as $$
declare
  target_group uuid;
  derived_key  text;
begin
  derived_key := case new.office
    when 'ruling_elder'      then 'session'
    when 'installed_pastor'  then 'session'
    when 'co_pastor'         then 'session'
    when 'associate_pastor'  then 'session'
    when 'deacon'            then 'diaconate'
    when 'deacons_moderator' then 'deacons_moderator'
    else null end;
  if derived_key is null then return new; end if;

  select id into target_group from groups
   where organization_id = new.organization_id and derived_from = derived_key;

  if target_group is null then
    raise exception
      'organization % has no derived group %; seed derived groups at org creation',
      new.organization_id, derived_key
      using errcode = 'foreign_key_violation';
  end if;

  insert into group_memberships
    (organization_id, group_id, person_id, group_role, source,
     officer_term_id, starts_on, ends_on)
  values
    (new.organization_id, target_group, new.person_id, 'member', 'derived',
     new.id, new.starts_on, new.ends_on)
  on conflict (officer_term_id) do update
    set starts_on = excluded.starts_on,
        ends_on   = excluded.ends_on;

  return new;
end $$;

-- (b) The office vocabulary, validated. Pinned to OFFICER_OFFICES by
-- officer-offices.test.ts (keep this exact textual shape: one
-- `check (office in (...))`). Section 1 already stopped on a violator.
alter table officer_terms drop constraint if exists officer_terms_office_allowed;
alter table officer_terms add constraint officer_terms_office_allowed
  check (office in ('ruling_elder', 'installed_pastor', 'co_pastor', 'associate_pastor', 'deacon', 'deacons_moderator', 'clerk_of_session', 'moderator', 'treasurer', 'trustee'));

-- (c) The derived group for every congregation, in groupSeedPlan()'s shape:
-- group type roster (a seat, not a court), membership_source 'derived',
-- protected. Non-congregations get nothing: presbyteries and synods have no
-- Board of Deacons. Section 1 stopped if the roster type is missing.
insert into groups (organization_id, group_type_id, name, membership_source,
                    derived_from, is_protected)
select o.id, gt.id, 'Board of Deacons Moderator', 'derived', 'deacons_moderator', true
  from organizations o
  join group_types gt on gt.key = 'roster'
 where o.organization_type = 'congregation'
on conflict (organization_id, derived_from) do nothing;

-- ---------------------------------------------------------------------------
-- 9. seat role backfill (0062 section 7 idiom, rewritten as a loop; P3-7)
-- ---------------------------------------------------------------------------
-- For each congregation that has the seat group and NO org-owned
-- deacons_moderator role: the role (constitutional, protected), its single
-- parishes.assign permission, and a group-arm grant to the seat group.
-- SEPARATE statements, not 0062's data-modifying CTE: the 7a binding guard
-- reads the new app_roles row, and inside one CTE statement a sibling
-- insert's row is invisible to it, so the guard would refuse the backfill.
-- An existing org-owned deacons_moderator role is never modified, whatever it
-- holds (0052 note 5: a migration that adds authority to a tenant-held role
-- would be the platform granting ecclesiastical authority); such an org is
-- skipped and counted in a notice. The role KEY is the discriminator, never
-- grant_reason. starts_on = current_date: a seat recorded with an earlier
-- start gains authority from the day the grant exists, not before.
-- role_grants_needs_membership ignores group-arm grants.
do $$
declare
  v_org     record;
  v_role_id uuid;
  v_skipped bigint;
begin
  select count(*) into v_skipped
    from app_roles r
    join organizations o on o.id = r.organization_id
   where o.organization_type = 'congregation'
     and r.key = 'deacons_moderator'
     and not exists (select 1 from app_role_permissions rp
                      where rp.role_id = r.id and rp.permission_key = 'parishes.assign');
  if v_skipped > 0 then
    raise notice '0068: % congregation(s) already hold an org-owned deacons_moderator role without parishes.assign; left untouched, no seat role provisioned there',
      v_skipped;
  end if;

  for v_org in
    select o.id as organization_id, g.id as group_id
      from organizations o
      join groups g on g.organization_id = o.id
                   and g.derived_from = 'deacons_moderator'
                   and g.membership_source = 'derived'
     where o.organization_type = 'congregation'
       and not exists (select 1 from app_roles r
                        where r.organization_id = o.id and r.key = 'deacons_moderator')
     order by o.id
  loop
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (v_org.organization_id, 'deacons_moderator',
            'Moderator of the Board of Deacons', 'constitutional', true)
    returning id into v_role_id;

    insert into app_role_permissions (role_id, permission_key)
    values (v_role_id, 'parishes.assign');

    insert into role_grants (organization_id, role_id, group_id, starts_on,
                             granted_by, grant_reason)
    values (v_org.organization_id, v_role_id, v_org.group_id, current_date, null,
            'Baseline Moderator of the Board of Deacons role: parishes.assign for the recorded seat (drizzle/0068, DECISION-242)');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. privileges (R2, F258)
-- ---------------------------------------------------------------------------
-- A district is archived, never deleted. No application code deletes
-- org_units and no SECURITY DEFINER body does (Phase 3 feasibility check).
-- Narrowed for both roles even though presby_platform has no login today: a
-- grant documents intent and binds the day one exists (F44).
revoke delete on org_units from presby_app;
revoke delete on org_units from presby_platform;

-- The owner connection holds DELETE by ownership, which no revoke touches, so
-- the trigger is the backstop there. The one way out is the sanctioned
-- fixture-teardown cascade: by the time the RI cascade reaches org_units the
-- parent organizations row is already gone (and organizations_guard_delete
-- only lets that happen for a deletable_until fixture). The
-- presby_org_domains_guard_delete() idiom (0057 section 4c), written out here
-- so this file does not depend on it.
create or replace function presby_org_units_guard_delete()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception 'org_units: districts are permanent; archive them instead'
    using errcode = 'insufficient_privilege',
          constraint = 'org_units_permanent';
end $$;
revoke all on function presby_org_units_guard_delete() from public, presby_app, presby_platform;

drop trigger if exists org_units_guard_delete on org_units;
create trigger org_units_guard_delete
  before delete on org_units
  for each row execute function presby_org_units_guard_delete();

-- ---------------------------------------------------------------------------
-- 11. comments
-- ---------------------------------------------------------------------------
comment on column org_units.archived_at is
  'When the district was archived (null = active). Archived districts keep their households until they are moved, accept no new household or open deacon term (households_org_unit_target_guard / officer_terms_org_unit_target_guard), and free their name for reuse among active districts (org_units_active_name_idx). Restore sets it back to null. The actor is in audit_events, not here (drizzle/0068, DECISION-243).';
comment on constraint org_units_unit_type_check on org_units is
  'The unit vocabulary (F259). parish and district are deacon districts and are manageable; campus is a multi-site location and can be the target of neither a household nor a deacon term (drizzle/0068).';
comment on constraint org_units_name_shape on org_units is
  'Names are stored normalized: trimmed, NFC, 1 to 80 characters. Control and zero-width stripping is done by src/lib/parishes-pure.ts normalizeDistrictName (drizzle/0068, P3-6).';
comment on index org_units_active_name_idx is
  'One active district per lower(name) per organization. A restore into a taken name raises unique_violation here; src/lib/parishes.ts maps it to name_taken (drizzle/0068).';
comment on index households_org_unit_idx is
  'Households per district and the Unassigned query (F263, drizzle/0068).';
comment on column households.org_unit_id is
  'The household''s deacon district (org_units.unit_type parish or district; never a campus, households_org_unit_target_guard). Overwritten on a move, with history in audit_events (DECISION-245). Accepted consequence of DECISION-243: this column means deacon district only, so a future campus dimension needs its own column. Written only by src/lib/parishes.ts.';
comment on function presby_seat_key_group(text) is
  'The seat-only permission keys and the derived group each may be carried through (DECISION-242, P3-8). Today only parishes.assign -> deacons_moderator. Pinned to SEAT_ONLY_PERMISSION_KEYS. Called only by the seat guards.';
comment on function presby_guard_org_unit_target() is
  'BEFORE INSERT/UPDATE guard on households and officer_terms: a newly set district must exist at this organization, be active and not a campus (constraints org_unit_target_missing / _archived / _campus). FOR SHARE closes the archive race the composite FK''s FOR KEY SHARE leaves open (drizzle/0068, DECISION-243).';
comment on function presby_guard_seat_key_binding() is
  'A seat-only key sits only on an org-owned, protected, constitutional role whose key equals the key''s group, and only on a role never granted on another arm (constraint seat_key_binding; R1, F260, DECISION-242).';
comment on function presby_guard_seat_role_shape() is
  'A role carrying a seat-only key keeps its organization, key, kind and protection (constraint seat_role_shape; DECISION-242).';
comment on function presby_guard_seat_key_grant() is
  'A role carrying a seat-only key is granted only through the group arm to this organization''s derived group of that key (constraint seat_key_grant; R1, F260, DECISION-242).';
comment on function presby_guard_seat_key_downward() is
  'A role carrying a seat-only key never travels an administrative commission or delegation (constraint seat_key_downward; DECISION-242).';
comment on function presby_org_units_guard_delete() is
  'Districts are permanent (archive instead); passes only the fixture-teardown cascade, when the parent organization is already gone (R2, F258, drizzle/0068).';
comment on trigger households_org_unit_target_guard on households is
  'presby_guard_org_unit_target(): no household moves into an archived, campus or missing district (drizzle/0068).';
comment on trigger officer_terms_org_unit_target_guard on officer_terms is
  'presby_guard_org_unit_target(): no new, re-opened or re-pointed open deacon term in an archived, campus or missing district; ending or shortening one always passes (drizzle/0068).';
comment on trigger app_role_permissions_seat_key_guard on app_role_permissions is
  'presby_guard_seat_key_binding() (drizzle/0068, DECISION-242).';
comment on trigger app_roles_seat_role_guard on app_roles is
  'presby_guard_seat_role_shape() (drizzle/0068, DECISION-242).';
comment on trigger role_grants_seat_key_guard on role_grants is
  'presby_guard_seat_key_grant() (drizzle/0068, DECISION-242).';
comment on trigger administrative_commissions_seat_key_guard on administrative_commissions is
  'presby_guard_seat_key_downward() (drizzle/0068, DECISION-242).';
comment on trigger org_delegations_seat_key_guard on org_delegations is
  'presby_guard_seat_key_downward() (drizzle/0068, DECISION-242).';
comment on trigger org_units_guard_delete on org_units is
  'presby_org_units_guard_delete(): districts are archived, never deleted (drizzle/0068, R2).';
