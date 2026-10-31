-- drizzle/0066_presby_membership_standing.sql
--
-- Community Increment 3a, visitor follow-ups: one definition of "listed",
-- the derived-row guards, and the vocabulary and cache guards on memberships
-- (docs/work-log/2026-10-22-founding-admin-directory-inc3.md, Phase 3 section
-- 4 as amended 2026-10-31, sections A3 to A6; DECISION-232 to DECISION-236;
-- findings F240, F243, F244, F245; F247 recorded, not fixed; F177 Option 1).
--
-- Apply (owner, DIRECT endpoint, one transaction):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0066_presby_membership_standing.sql
-- Never drizzle-kit migrate on an existing database: its ledger records only
-- the first ten migrations (docs/deployment.md).
--
-- CHAIN: 0064 < 0065 < 0066. The hard dependency is 0065 (the classifier
-- presby_membership_standing and the standing core), coded as the first
-- stop-block. 0066 applies AFTER 0067 to 0082 on every existing database
-- (development, production) and BEFORE them on a fresh `db:migrate`; both
-- orders end in the same state (amendment section A5): nothing numbered 0067
-- to 0082 reads anything this file creates, and every function this file
-- replaces is last defined before 0066. presby_sync_derived_group() (0068
-- re-creates it as a definer with the deacons_moderator arm) is ALTERED here,
-- never re-created, so either order keeps 0068's body.
--
-- DEPLOY ORDER: apply this file, THEN deploy the code. Old code survives it
-- (the guards refuse only what no old code path attempts). THE NARROWING
-- TAKES EFFECT WHEN THIS FILE IS APPLIED, not when the code deploys: tenant
-- permissions resolve per request. Between apply and deploy, an organization
-- created by the old code gets the pair (by trigger) but no calendar_viewer
-- role; create none in that window, or re-run the delimited
-- backfill-calendar-viewer block (P11 in the work-log shows it).
--
-- FORWARD ONLY. Once the all_memberships groups and rows exist, removing them
-- would strand grants and rows; nothing here is ever deleted.
--
-- Measured before writing (read-only, counts only, no slug; work-log Phase 4
-- Batch A1, 2026-10-31):
--   pipeline branch (today's copy of development): 20 organizations, 20
--     active_membership groups, 11 deacons_moderator; live memberships 83
--     listed (28 with a sign-in) and 3 visitor (0 with a sign-in); 0 bad
--     engagement values; 0 groups outside the derived shape; 0 calendar_viewer
--     roles; P5 = 2 organizations / 8 live memberships, BOTH deletable_until
--     test fixtures (0 real).
--   production: 2 organizations, 2 active_membership groups, 1
--     deacons_moderator; live memberships 1 listed and 1 staff anchor (both
--     with a sign-in); no visitor, inactive or unclassified; P5 = 0; 0 bad
--     engagement values; 0 groups outside the derived shape; 0 calendar_viewer.
--   Re-measure before the production apply (work-log section A6).
--
-- Three facts a reader must not miss:
--   * derived group_memberships rows, derived groups' identity, and
--     memberships.current_roll / current_roll_since are written ONLY on the
--     owner path (the table owner: neondb_owner, and every SECURITY DEFINER
--     function it owns). The owner test names no role, so a role added later
--     is refused by default.
--   * memberships.engagement_status has a closed vocabulary (CHECK) and a
--     guard that binds the owner too.
--   * presby_app still holds no privilege on account_invitations.
--
-- The whole file is idempotent: drop-then-add, create or replace, if not
-- exists, on conflict do nothing, a pg_constraint guard, or a predicate that
-- stops matching once applied. Proven by applying the whole file twice
-- (work-log, Phase 4 Batch A1). Unreleased until applied to production, so it
-- may be corrected in place until then (CLAUDE.md -> Project Layout ->
-- drizzle/); never edit 0059 to 0065.
--
--   1. preconditions            stop-blocks, counts only, never a value
--   2. classifier layer         presby_standing_is_member,
--                               presby_membership_is_member_standing
--   3. derived-row and          presby_reject_derived_group_write (F240),
--      derived-group guards     presby_reject_derived_group_edit (F245),
--                               presby_sync_derived_group ALTERED to definer
--   4. the pair and the shape   unique (membership_id, group_id); the
--      of groups                all_memberships sibling trigger and backfill;
--                               the pairing and five-kind CHECKs
--   5. the membership sync      presby_sync_derived_membership_group, definer,
--                               writes both rows
--   6. row backfill             BEGIN/END backfill-standing (re-executable)
--   7. baseline role            BEGIN/END backfill-calendar-viewer
--                               (re-executable)
--   8. vocabulary and guards    engagement CHECK (F243), engagement guard,
--                               roll-cache guard (F244)
--   9. the three 0065 bodies    the standing core's T list (+all_memberships),
--      re-created               check 10 (no visitor acknowledgement), connect
--                               step 10 (member standing)
--  10. ACLs and comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No delete anywhere (operator ruling: all deletes are soft).
--   * No role_grants row for a person; no rebinding of `member` or any
--     protected role; 0082's member roles, grants and groups are untouched; no
--     `member` grant is created anywhere (D12).
--   * No backfill that CREATES an active_membership row (it only ends them):
--     a member-standing person without one gets it at their next membership
--     write, exactly as before.
--   * No change to 0059 to 0065, and no follow_ups change (3b).

-- ---------------------------------------------------------------------------
-- 1. preconditions (counts only; the raise text names a count, never a value)
-- ---------------------------------------------------------------------------
-- BEGIN preconditions
do $$
declare
  v_count bigint;
begin
  if to_regprocedure('presby_membership_standing(text,text)') is null
     or to_regprocedure('presby__person_sign_in_standing(uuid,uuid)') is null then
    raise exception '0066: apply 0065 first';
  end if;

  select count(*) into v_count
    from memberships
   where engagement_status is null
      or engagement_status not in ('visitor', 'regular', 'inactive', 'moved_away', 'staff');
  if v_count > 0 then
    raise exception '0066: % membership(s) carry an engagement_status outside (visitor, regular, inactive, moved_away, staff); correct them before this migration can apply', v_count;
  end if;

  -- arch-A2 / D9: the derived-group shape, with the FIVE kinds.
  select count(*) into v_count
    from groups
   where (membership_source = 'derived') is distinct from (derived_from is not null)
      or (derived_from is not null
          and derived_from not in ('active_membership', 'all_memberships', 'session', 'diaconate', 'deacons_moderator'));
  if v_count > 0 then
    raise exception '0066: % group(s) fall outside the derived-group shape; correct them before this migration can apply', v_count;
  end if;
end $$;
-- END preconditions

do $$
declare
  v_no_row bigint;
  v_roles  bigint;
begin
  select count(*) into v_no_row
    from memberships m
   where m.ended_on is null
     and not exists (select 1 from group_memberships gm
                       join groups g on g.id = gm.group_id
                      where gm.membership_id = m.id and g.derived_from = 'active_membership');
  select count(*) into v_roles from app_roles where key = 'calendar_viewer';
  raise notice '0066: % live membership(s) have no active_membership derived row; % org-owned role(s) already keyed calendar_viewer (never modified)', v_no_row, v_roles;
end $$;

-- ---------------------------------------------------------------------------
-- 2. classifier layer (DECISION-233). Member standing is defined ONCE, in
--    presby_standing_is_member; 0065's presby_membership_standing stays the
--    one definition of the roll list and the first-match order and is not
--    re-created. Immutable SQL, no definer, no SET (so the planner inlines
--    them in a WHERE).
-- ---------------------------------------------------------------------------
create or replace function presby_standing_is_member(p_standing text)
returns boolean language sql immutable
as $$
  select p_standing in ('listed', 'staff_anchor')
$$;

create or replace function presby_membership_is_member_standing(p_current_roll text, p_engagement_status text)
returns boolean language sql immutable
as $$
  select presby_standing_is_member(presby_membership_standing(p_current_roll, p_engagement_status))
$$;

-- ---------------------------------------------------------------------------
-- 3. derived-row guard (F240), derived-group guard (F245), and the officer
--    sync's attributes (D10).
-- ---------------------------------------------------------------------------
-- (a) group_memberships. The live 0033 body is kept byte-for-byte as its
-- first two checks (the DELETE refusal and the source check bind every role,
-- the owner included). Added after them: a NON-OWNER may not insert a derived
-- row, may not insert into a derived group, and may not change any column of
-- a derived row (or of a row in a derived group) except the four public
-- listing columns. The allow-list is closed: a column added later is guarded
-- by default. The owner test names no role: the table owner and the SECURITY
-- DEFINER sync functions it owns pass; presby_app, presby_platform and any
-- role added later are refused.
create or replace function presby_reject_derived_group_write()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  src       text;
  v_owner   boolean;
  v_old_src text;
  v_allow   text[] := array['public_listed', 'public_listed_by', 'public_listed_at', 'public_display_order'];
begin
  -- TG_OP is uppercase ('INSERT'/'UPDATE'/'DELETE'/'TRUNCATE'), not lowercase
  -- — caught by running this migration's own regression test (scripts/
  -- test-rls.sql section 25) against a live database before this comment was
  -- written; the lowercase-literal version silently never matched and the
  -- DELETE fell through unrejected. Same "caught by running it, not by
  -- reading a raw SQL predicate" discipline F26/DECISION-109's own findings
  -- already established.
  if tg_op = 'DELETE' and old.source = 'derived' then
    raise exception
      'group_memberships: % is a derived-group membership row; it projects from officer_terms and cannot be deleted directly',
      old.id
      using errcode = 'check_violation';
  end if;

  select membership_source into src from groups
   where id = coalesce(new.group_id, old.group_id);
  if src = 'derived' and coalesce(new.source, old.source) <> 'derived' then
    raise exception
      'group_memberships: % is a derived group; its roster projects from officer_terms',
      coalesce(new.group_id, old.group_id)
      using errcode = 'check_violation';
  end if;

  -- F240 (0066): the owner path only. DELETE is fully handled above.
  if tg_op = 'DELETE' then
    return old;
  end if;

  select coalesce(c.relowner = r.oid, false) into v_owner
    from pg_class c, pg_roles r
   where c.oid = tg_relid and r.rolname = current_user;
  if coalesce(v_owner, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.source = 'derived' or src = 'derived' then
      raise exception
        'group_memberships: derived rows are written only by the officer and membership records (drizzle/0066, F240)'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  select membership_source into v_old_src from groups where id = old.group_id;
  if (old.source = 'derived' or new.source = 'derived'
      or src = 'derived' or v_old_src = 'derived')
     and (to_jsonb(new) - v_allow) is distinct from (to_jsonb(old) - v_allow) then
    raise exception
      'group_memberships: a derived row may change only its public listing; everything else follows the officer and membership records (drizzle/0066, F240)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- (b) groups (F245, arch-A1). The shipped 0033 refusal of name, description
-- and meets_when on a derived group binds every role and is kept
-- byte-for-byte. Added after it: a NON-OWNER may change no column of a group
-- that is derived before or after the update. That refuses a derived-to-
-- managed flip, a managed-to-derived flip, and any change to derived_from,
-- is_protected, group_type_id or organization_id on a derived group. A
-- managed-to-managed update (a rename) is untouched.
create or replace function presby_reject_derived_group_edit()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
begin
  if old.membership_source = 'derived'
     and (new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.meets_when is distinct from old.meets_when) then
    raise exception
      'groups: % is a derived group (Session/Board of Deacons/Active Membership); its name, description, and meeting schedule are not editable directly',
      old.id
      using errcode = 'check_violation';
  end if;

  if old.membership_source = 'derived' or new.membership_source = 'derived' then
    select coalesce(c.relowner = r.oid, false) into v_owner
      from pg_class c, pg_roles r
     where c.oid = tg_relid and r.rolname = current_user;
    if not coalesce(v_owner, false)
       and to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception
        'groups: a derived group''s identity is fixed; only the officer and membership records shape it (drizzle/0066, F245)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- (c) The officer sync (D10, amendment A4.3): attributes only, NEVER
-- `create or replace` (that would reset attributes and, from 0062's body,
-- drop 0068's deacons_moderator arm). After 0068 this changes nothing; before
-- 0068 (a fresh db:migrate) it makes 0062's invoker body a definer, and 0068
-- later replaces the body with the same attributes.
do $$ begin
  if to_regprocedure('presby_sync_derived_group()') is null then
    raise exception '0066: presby_sync_derived_group() is missing; apply 0062 first';
  end if;
end $$;
alter function presby_sync_derived_group() security definer set search_path = public, pg_temp;
revoke all on function presby_sync_derived_group() from public, presby_app, presby_platform;
do $$ declare v_def boolean; v_cfg text[]; begin
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p where p.oid = 'presby_sync_derived_group()'::regprocedure;
  if not v_def or v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception '0066: presby_sync_derived_group() is not security definer with a pinned search_path';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. the pair (D1, arch-A3), and the shape of groups (arch-A2, D9)
-- ---------------------------------------------------------------------------
-- (a) One derived row per (membership, group): a membership now holds a row in
-- each of the two membership-derived groups. Derived rows are a current-state
-- cache; history collapses to one row per (membership, group).
alter table group_memberships drop constraint if exists group_memberships_membership_key;
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'group_memberships'::regclass
                    and conname = 'group_memberships_membership_group_key') then
    alter table group_memberships
      add constraint group_memberships_membership_group_key unique (membership_id, group_id);
  end if;
end $$;

-- (b) The pair, by construction. Whenever a derived active_membership group is
-- inserted, its all_memberships sibling is inserted at the SAME organization
-- with fixed literals. Provisioning lists both groups explicitly (a RETURNING
-- clause does not return trigger-inserted rows), and a multi-row insert fires
-- this AFTER ROW trigger after the statement, so for provisioning the insert
-- below is the no-op. It changes no role, permission or grant.
create or replace function presby_pair_derived_groups()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
  values (new.organization_id, new.group_type_id, 'All Current Records', 'derived', 'all_memberships', true)
  on conflict (organization_id, derived_from) do nothing;
  return null;
end $$;

drop trigger if exists groups_pair_derived on groups;
create trigger groups_pair_derived
  after insert on groups
  for each row
  when (new.derived_from = 'active_membership' and new.membership_source = 'derived')
  execute function presby_pair_derived_groups();

-- (c) Sibling backfill for every existing active_membership group.
insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
select a.organization_id, a.group_type_id, 'All Current Records', 'derived', 'all_memberships', true
  from groups a
 where a.derived_from = 'active_membership' and a.membership_source = 'derived'
on conflict (organization_id, derived_from) do nothing;

-- (d) Post-check: no organization holds exactly one of the pair.
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from (select g.organization_id,
                 bool_or(g.derived_from = 'active_membership') as has_am,
                 bool_or(g.derived_from = 'all_memberships')   as has_all
            from groups g
           where g.derived_from in ('active_membership', 'all_memberships')
           group by g.organization_id) s
   where s.has_am is distinct from s.has_all;
  if v_count > 0 then
    raise exception '0066: % organization(s) hold exactly one of active_membership and all_memberships; correct them before this migration can apply', v_count;
  end if;
end $$;

-- (e) The shape of groups. The shipped groups_derived_check (managed, or
-- derived_from not null) is kept; the pairing CHECK is strictly stronger and
-- also refuses a managed group with a derived_from. The kind list is CLOSED,
-- in this order, and pinned to src/lib/db/domain/groups.ts, DerivedFromKey in
-- src/lib/groups.ts and src/lib/org-provisioning.ts by
-- src/lib/db/domain/derived-group-guard.db.test.ts: a sixth kind is a
-- migration. deacons_moderator is owned by 0068; session and diaconate by
-- 0009/0062; active_membership by 0017; all_memberships by this file.
alter table groups drop constraint if exists groups_derived_pairing_check;
alter table groups add constraint groups_derived_pairing_check
  check ((membership_source = 'derived') = (derived_from is not null)) not valid;
alter table groups validate constraint groups_derived_pairing_check;
alter table groups drop constraint if exists groups_derived_kind_check;
alter table groups add constraint groups_derived_kind_check
  check (derived_from is null or derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate', 'deacons_moderator')) not valid;
alter table groups validate constraint groups_derived_kind_check;

-- ---------------------------------------------------------------------------
-- 5. the membership sync (DECISION-232). SECURITY DEFINER, so its writes take
--    the owner path through the F240 guard. Both groups are read from
--    NEW.organization_id; active_membership is checked FIRST with the shipped
--    message, so the four handlers that match
--    '%has no derived group active_membership%' (presby__accept_invitation_core,
--    presby_record_participant_action, presby_void_participant_action,
--    presby_decide_roll_action) keep mapping the common state; a missing
--    all_memberships raises the same shape naming it, which nothing maps and
--    which therefore fails loudly.
-- ---------------------------------------------------------------------------
create or replace function presby_sync_derived_membership_group()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_am     uuid;
  v_all    uuid;
  v_member boolean;
begin
  select id into v_am from groups
   where organization_id = new.organization_id and derived_from = 'active_membership';
  if v_am is null then
    raise exception
      'organization % has no derived group active_membership; seed derived groups at org creation',
      new.organization_id
      using errcode = 'foreign_key_violation';
  end if;

  select id into v_all from groups
   where organization_id = new.organization_id and derived_from = 'all_memberships';
  if v_all is null then
    raise exception
      'organization % has no derived group all_memberships; seed derived groups at org creation',
      new.organization_id
      using errcode = 'foreign_key_violation';
  end if;

  v_member := presby_membership_is_member_standing(new.current_roll, new.engagement_status);

  -- The all-live row mirrors ended_on exactly (DECISION-065: current is
  -- ended_on is null), for every membership.
  insert into group_memberships
    (organization_id, group_id, person_id, group_role, source,
     membership_id, starts_on, ends_on)
  values
    (new.organization_id, v_all, new.person_id, 'member', 'derived',
     new.id, new.created_at::date, new.ended_on)
  on conflict (membership_id, group_id) do update
    set ends_on = excluded.ends_on
    where group_memberships.ends_on is distinct from excluded.ends_on;

  -- The member-standing row: opened (or reopened) while the membership has
  -- member standing; closed at current_date when it loses it. A row that is
  -- already closed keeps its end date, so an unrelated update rewrites nothing.
  if v_member then
    insert into group_memberships
      (organization_id, group_id, person_id, group_role, source,
       membership_id, starts_on, ends_on)
    values
      (new.organization_id, v_am, new.person_id, 'member', 'derived',
       new.id, case when tg_op = 'INSERT' then new.created_at::date else current_date end,
       new.ended_on)
    on conflict (membership_id, group_id) do update
      set ends_on = excluded.ends_on
      where group_memberships.ends_on is distinct from excluded.ends_on;
  else
    update group_memberships
       set ends_on = current_date
     where membership_id = new.id
       and group_id = v_am
       and ends_on is null;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. row backfill. Role-free; the classifier only; never keyed on a reason
--    text; never a delete; never CREATES an active_membership row. Delimited
--    so src/lib/membership-standing.db.test.ts can re-execute it.
-- ---------------------------------------------------------------------------
-- BEGIN backfill-standing
insert into group_memberships
  (organization_id, group_id, person_id, group_role, source,
   membership_id, starts_on, ends_on)
select m.organization_id, g.id, m.person_id, 'member', 'derived',
       m.id, m.created_at::date, m.ended_on
  from memberships m
  join groups g on g.organization_id = m.organization_id
               and g.derived_from = 'all_memberships'
               and g.membership_source = 'derived'
on conflict (membership_id, group_id) do update
  set ends_on = excluded.ends_on
  where group_memberships.ends_on is distinct from excluded.ends_on;

update group_memberships gm
   set ends_on = current_date
  from memberships m, groups g
 where gm.membership_id = m.id
   and gm.group_id = g.id
   and g.derived_from = 'active_membership'
   and gm.ends_on is null
   and m.ended_on is null
   and not presby_membership_is_member_standing(m.current_roll, m.engagement_status);
-- END backfill-standing

-- ---------------------------------------------------------------------------
-- 7. the baseline role (DECISION-232, D4/D12). For each organization that has
--    an all_memberships group and NO org-owned role keyed calendar_viewer: the
--    role (constitutional, protected), its single events.view permission, and
--    a group-arm grant to the all_memberships group, driven by RETURNING so a
--    second run inserts nothing. An existing org-owned calendar_viewer is never
--    modified, whatever it holds (0052 note 5). The role KEY is the only
--    discriminator. No `member` role, grant or group is created or touched.
--    The guards on app_role_permissions ignore events.view;
--    role_grants_needs_membership ignores group-arm grants.
-- ---------------------------------------------------------------------------
-- BEGIN backfill-calendar-viewer
with targets as (
  select g.organization_id, g.id as group_id
    from groups g
   where g.derived_from = 'all_memberships'
     and g.membership_source = 'derived'
     and not exists (select 1 from app_roles r
                      where r.organization_id = g.organization_id and r.key = 'calendar_viewer')
), new_roles as (
  insert into app_roles (organization_id, key, name, role_kind, is_protected)
  select t.organization_id, 'calendar_viewer', 'Calendar viewer', 'constitutional', true
    from targets t
  on conflict (organization_id, key) do nothing
  returning id, organization_id
), new_permissions as (
  insert into app_role_permissions (role_id, permission_key)
  select nr.id, 'events.view' from new_roles nr
  on conflict (role_id, permission_key) do nothing
  returning role_id
)
insert into role_grants (organization_id, role_id, group_id, starts_on,
                         granted_by, grant_reason)
select nr.organization_id, nr.id, t.group_id, current_date, null,
       'Baseline calendar role: events.view for everyone with a current record (drizzle/0066, DECISION-232)'
  from new_roles nr
  join targets t on t.organization_id = nr.organization_id
 where exists (select 1 from new_permissions np where np.role_id = nr.id);
-- END backfill-calendar-viewer

-- ---------------------------------------------------------------------------
-- 8. vocabulary and guards on memberships (F243, R53, F244/D5)
-- ---------------------------------------------------------------------------
-- (a) The engagement vocabulary. Section 1 already stopped on a violator.
-- Pinned to ENGAGEMENT_STATUSES (src/lib/membership-standing.ts, Batch B).
alter table memberships drop constraint if exists memberships_engagement_status_allowed;
alter table memberships add constraint memberships_engagement_status_allowed
  check (engagement_status in ('visitor', 'regular', 'inactive', 'moved_away', 'staff')) not valid;
alter table memberships validate constraint memberships_engagement_status_allowed;

-- (b) The engagement guard. For EVERY role, the owner included (so a fixture
-- cannot make a silent staff anchor). Recorded gaps (D6, paper): an INSERT
-- with engagement staff is indistinguishable from the sanctioned anchor path,
-- and ended_on / ended_reason stay writable by presby_app.
create or replace function presby_memberships_guard_engagement()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.ended_on is not null then
    raise exception
      'memberships: this membership has ended; its engagement can no longer change'
      using errcode = 'check_violation';
  end if;
  if new.engagement_status = 'staff' or old.engagement_status = 'staff' then
    raise exception
      'memberships: staff is set only when a staff record is created; engagement cannot change into or out of staff'
      using errcode = 'check_violation';
  end if;
  if new.engagement_status = 'visitor' and new.current_roll is not null then
    raise exception
      'memberships: a person on the roll cannot be marked as a visitor'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists memberships_guard_engagement on memberships;
create trigger memberships_guard_engagement
  before update of engagement_status on memberships
  for each row
  when (new.engagement_status is distinct from old.engagement_status)
  execute function presby_memberships_guard_engagement();

-- (c) The roll-cache guard. current_roll and current_roll_since are a cache of
-- the roll (The Roll Is the System of Record). Their writers are all on the
-- owner path: presby_sync_current_roll and presby_reconcile_current_roll
-- (0012, definers), the one-time 0012 backfill, and fixtures and seeds on the
-- owner connection (writer re-scan, work-log Phase 4 Batch A1). A non-owner is
-- refused; the owner test names no role.
create or replace function presby_memberships_guard_roll_cache()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
begin
  select coalesce(c.relowner = r.oid, false) into v_owner
    from pg_class c, pg_roles r
   where c.oid = tg_relid and r.rolname = current_user;
  if coalesce(v_owner, false) then
    return new;
  end if;
  raise exception
    'memberships: current_roll and current_roll_since are written only by the roll; record a roll action instead (drizzle/0066, F244)'
    using errcode = 'check_violation';
end $$;

drop trigger if exists memberships_guard_roll_cache_insert on memberships;
create trigger memberships_guard_roll_cache_insert
  before insert on memberships
  for each row
  when (new.current_roll is not null or new.current_roll_since is not null)
  execute function presby_memberships_guard_roll_cache();

drop trigger if exists memberships_guard_roll_cache_update on memberships;
create trigger memberships_guard_roll_cache_update
  before update of current_roll, current_roll_since on memberships
  for each row
  when (new.current_roll is distinct from old.current_roll
        or new.current_roll_since is distinct from old.current_roll_since)
  execute function presby_memberships_guard_roll_cache();

-- ---------------------------------------------------------------------------
-- 9. the three 0065 bodies re-created (Batch A2; Phase 3 section 4.10,
--    amendment A4.2, D10b; R49, R55). Each body is the LIVE post-2b body
--    (pg_proc.prosrc, verified equal to drizzle/0065's text before this
--    section was written) with exactly one change; signatures, return
--    shapes, volatility, SECURITY DEFINER and the pinned search_path are
--    unchanged, so `create or replace` keeps every caller and the ACLs
--    (restated in section 10 all the same). The recorded diffs are in the
--    work-log, Phase 4 Batch A2.
--
--    (a) presby__person_sign_in_standing, the standing core: the closed list
--        of derived kinds that do NOT count in the set T gains
--        all_memberships. Without it the calendar_viewer grant on All Current
--        Records counts in T, every person at a provisioned organization
--        becomes authority-bearing, and every auto-connect answers
--        needs_second_factor (fail closed, but a silent break of 2b; R49).
--        deacons_moderator is DELIBERATELY ABSENT (D10b): the Board of
--        Deacons Moderator seat carries parishes.assign, an authority, so it
--        stays in T and auto-connect still asks for a second factor. Its side
--        effect, which exists on main already, is F247 (no sender holds the
--        seat-only key, so an invitation to the Moderator is refused
--        exceeds_your_access). The list stays in this one body (S13); nothing
--        in TypeScript copies it. A sixth derived kind (a migration,
--        groups_derived_kind_check) counts in T until this list names it.
--    (b) presby_sign_in__check: check 10 no longer adds the `visitor`
--        acknowledgement reason (F177 condition 1 is retired: a visitor's
--        sign-in now carries no directory, Option 1). do_not_contact stays;
--        the order of every other check is unchanged.
--    (c) presby_connect_signed_in_account: step 10 "the standing is not
--        visitor" becomes "the standing is member standing"
--        (presby_standing_is_member, section 2), else declined (R55,
--        operator-approved): visitor, inactive, moved away and unclassified
--        are declined alike. The refusal arm and the `standing is null` arm
--        stay, so a null standing never reaches presby_standing_is_member
--        (which answers null for null).
--
--    After this section `standing = 'visitor'` appears in no function body
--    (live-catalog scan, membership-standing.db.test.ts).
-- ---------------------------------------------------------------------------
-- (a) the standing core (0065 section 11d; header comment there still
-- describes every column; the closed list is now four kinds).
create or replace function presby__person_sign_in_standing(p_person uuid, p_org uuid)
returns table (refusal text, standing text, authority_bearing boolean,
               session_seat boolean, diaconate_seat boolean,
               role_keys text[], permission_keys text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_merged uuid;
  v_death date;
  v_m memberships%rowtype;
  v_has_m boolean;
  v_elsewhere boolean;
begin
  select p.merged_into_id, p.date_of_death into v_merged, v_death
    from people p where p.id = p_person;

  select * into v_m from memberships m
   where m.person_id = p_person and m.organization_id = p_org;
  v_has_m := found;

  -- R31: any membership at another organization, live or ended.
  v_elsewhere := exists (select 1 from memberships m2
                          where m2.person_id = p_person and m2.organization_id <> p_org);

  refusal := case
               when v_merged is not null then 'person_merged'
               when v_death is not null then 'person_deceased'
               when not v_has_m or v_m.ended_on is not null then 'membership_ended'
               when v_elsewhere then 'person_elsewhere'
               else null
             end;

  standing := case when v_has_m and v_m.ended_on is null
                   then presby_membership_standing(v_m.current_roll, v_m.engagement_status)
              end;

  session_seat := exists (
    select 1 from group_memberships gm
      join groups g on g.id = gm.group_id
     where gm.person_id = p_person and g.organization_id = p_org
       and g.membership_source = 'derived' and g.derived_from = 'session'
       and (gm.ends_on is null or gm.ends_on > current_date));
  diaconate_seat := exists (
    select 1 from group_memberships gm
      join groups g on g.id = gm.group_id
     where gm.person_id = p_person and g.organization_id = p_org
       and g.membership_source = 'derived' and g.derived_from = 'diaconate'
       and (gm.ends_on is null or gm.ends_on > current_date));

  with t as (
    select rg.role_id
      from role_grants rg
     where rg.organization_id = p_org and rg.person_id = p_person
       and (rg.ends_on is null or rg.ends_on > current_date)
    union
    select rg.role_id
      from role_grants rg
      join groups g on g.id = rg.group_id
      join group_memberships gm on gm.group_id = g.id and gm.person_id = p_person
     where rg.organization_id = p_org
       and (rg.ends_on is null or rg.ends_on > current_date)
       and (gm.ends_on is null or gm.ends_on > current_date)
       and not (g.membership_source = 'derived'
                and coalesce(g.derived_from in ('active_membership', 'all_memberships', 'session', 'diaconate'), false))
  )
  select coalesce((select array_agg(distinct r.key order by r.key)
                     from t join app_roles r on r.id = t.role_id), array[]::text[]),
         coalesce((select array_agg(distinct rp.permission_key order by rp.permission_key)
                     from t join app_role_permissions rp on rp.role_id = t.role_id), array[]::text[])
    into role_keys, permission_keys;

  authority_bearing := session_seat or diaconate_seat or cardinality(role_keys) > 0;
  return next;
end $$;

-- (b) the shared issue/resend check (0065 section 12a). Check 10's
-- acknowledgements: do_not_contact only.
create or replace function presby_sign_in__check(
  p_org uuid, p_sender_person uuid, p_sender_user uuid, p_person_id uuid,
  p_confirmed_address text, p_acknowledged boolean)
returns table (outcome text, address text, recipient_first_name text, ack_reasons text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_st record;
  v_user_id uuid;
  v_first text;
  v_addr record;
  v_has_addr boolean;
  v_sender_email text;
  v_reasons text[] := array[]::text[];
begin
  -- 1. not_found: no membership of that person at this organization.
  if p_person_id is null
     or not exists (select 1 from memberships m
                     where m.person_id = p_person_id and m.organization_id = p_org) then
    outcome := 'not_found';
    return next;
    return;
  end if;

  select * into v_st from presby__person_sign_in_standing(p_person_id, p_org);

  -- 2. the core's own-organization refusals.
  if v_st.refusal in ('person_merged', 'person_deceased', 'membership_ended') then
    outcome := v_st.refusal;
    return next;
    return;
  end if;

  -- 3. already linked (this also covers the sender's own record).
  select p.user_id, coalesce(nullif(btrim(p.preferred_name), ''), p.first_name)
    into v_user_id, v_first
    from people p where p.id = p_person_id;
  if v_user_id is not null then
    outcome := 'already_signs_in';
    return next;
    return;
  end if;

  -- 4. R31, collapsed for the sender.
  if v_st.refusal = 'person_elsewhere' then
    outcome := 'needs_support';
    return next;
    return;
  end if;

  -- 5. a Session or diaconate seat needs officers.manage.
  if (v_st.session_seat or v_st.diaconate_seat)
     and not presby_has_permission(p_sender_person, p_org, 'officers.manage') then
    outcome := 'needs_officers_permission';
    return next;
    return;
  end if;

  -- 6. R21: T must be a subset of the sender's own effective permissions today.
  if exists (select 1 from unnest(v_st.permission_keys) k(key)
              where not exists (select 1 from presby_effective_permissions(p_sender_person, p_org, current_date) e
                                 where e.permission_key = k.key)) then
    outcome := 'exceeds_your_access';
    return next;
    return;
  end if;

  -- 7. the address.
  select * into v_addr from presby_person_email(p_person_id, 'credential');
  v_has_addr := found;
  if not v_has_addr then
    outcome := 'no_email_on_file';
    return next;
    return;
  end if;
  if lower(btrim(p_confirmed_address)) is distinct from lower(btrim(v_addr.address)) then
    outcome := 'address_changed';
    return next;
    return;
  end if;

  -- 8. the sender's own address on someone else's record.
  select lower(btrim(u.email)) into v_sender_email from users u where u.id = p_sender_user;
  if p_person_id is distinct from p_sender_person
     and v_sender_email = lower(btrim(v_addr.address)) then
    outcome := 'address_is_yours';
    return next;
    return;
  end if;

  -- 9. R29: another unmerged, living person with a live membership at THIS
  -- organization holds the address as an active email. Own rows only.
  if exists (select 1 from contact_methods cm
               join people p2 on p2.id = cm.person_id
               join memberships m2 on m2.person_id = p2.id and m2.organization_id = p_org
                                  and m2.ended_on is null
              where cm.kind = 'email' and cm.ended_at is null
                and lower(btrim(cm.value)) = lower(btrim(v_addr.address))
                and p2.id <> p_person_id
                and p2.merged_into_id is null and p2.date_of_death is null) then
    outcome := 'address_shared';
    return next;
    return;
  end if;

  -- 10. acknowledgements the DEFINER enforces (F177 condition 1).
  if v_addr.do_not_contact then
    v_reasons := v_reasons || 'do_not_contact'::text;
  end if;
  if cardinality(v_reasons) > 0 and not coalesce(p_acknowledged, false) then
    outcome := 'needs_acknowledgement';
    ack_reasons := v_reasons;
    return next;
    return;
  end if;

  outcome := 'ok';
  address := v_addr.address;
  recipient_first_name := v_first;
  ack_reasons := v_reasons;
  return next;
end $$;

-- (c) auto-connect (0065 section 14). Step 10: member standing, else
-- declined.
create or replace function presby_connect_signed_in_account(p_user_id uuid, p_second_factor_verified boolean)
returns table (outcome text, organization_id uuid, organization_slug text, person_id uuid,
               contact_method_id uuid, contact_method_created_at timestamptz,
               session_seat boolean, diaconate_seat boolean,
               role_keys text[], permission_keys text[])
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_factor_ok boolean;
  v_pass int;
  v_active boolean;
  v_proven boolean;
  v_addr text;
  v_cands uuid[];
  v_person uuid;
  v_org uuid;
  v_first_person uuid;
  v_first_org uuid;
  v_n int;
  v_slug text;
  v_st record;
  v_bind record;
begin
  session_seat := false;
  diaconate_seat := false;
  if p_user_id is null then
    outcome := 'declined';
    return next;
    return;
  end if;
  v_factor_ok := coalesce(p_second_factor_verified, false)
                 and exists (select 1 from user_totp t where t.user_id = p_user_id);

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform 1 from organizations o where o.id = v_first_org for update;
      perform 1 from users u where u.id = p_user_id for update;
      perform 1 from people p where p.id = v_first_person for update;
      perform 1 from contact_methods cm
       where cm.person_id = v_first_person and cm.kind = 'email' and cm.ended_at is null
         and lower(btrim(cm.value)) = v_addr
         for share;
    end if;

    -- 1, 2. active and proven.
    select u.is_active, u.email_verified is not null, lower(btrim(u.email))
      into v_active, v_proven, v_addr
      from users u where u.id = p_user_id;
    if not found or not coalesce(v_active, false) or not coalesce(v_proven, false) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 3. already linked.
    if exists (select 1 from people p where p.user_id = p_user_id and p.merged_into_id is null) then
      if exists (select 1 from people p
                   join memberships m on m.person_id = p.id and m.ended_on is null
                   join organizations o on o.id = m.organization_id and o.platform_status = 'managed'
                  where p.user_id = p_user_id and p.merged_into_id is null) then
        outcome := 'already_connected';
      else
        outcome := 'declined';
      end if;
      return next;
      return;
    end if;

    -- 4. an open invitation to the address holds auto-connect back (FB5).
    if exists (select 1 from account_invitations i
                where i.email_normalized = v_addr
                  and i.accepted_at is null and i.revoked_at is null and i.superseded_at is null
                  and i.blocked_at is null and i.redacted_at is null
                  and i.expires_at > now()) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 5. exactly one candidate, globally.
    select array_agg(distinct p.id) into v_cands
      from contact_methods cm
      join people p on p.id = cm.person_id and p.merged_into_id is null and p.date_of_death is null
     where cm.kind = 'email' and cm.ended_at is null
       and lower(btrim(cm.value)) = v_addr
       and exists (select 1 from memberships m where m.person_id = p.id and m.ended_on is null);
    if coalesce(cardinality(v_cands), 0) <> 1 then
      outcome := 'declined';
      return next;
      return;
    end if;
    v_person := v_cands[1];

    -- 6. the person is not linked to anyone.
    if exists (select 1 from people p where p.id = v_person and p.user_id is not null) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 7. exactly one live membership, at a managed organization.
    select count(*) into v_n from memberships m where m.person_id = v_person and m.ended_on is null;
    select m.organization_id into v_org from memberships m where m.person_id = v_person and m.ended_on is null limit 1;
    if v_n <> 1
       or not exists (select 1 from organizations o where o.id = v_org and o.platform_status = 'managed') then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- Under the locks, the candidate and its organization must be the ones
    -- that were locked.
    if v_pass = 2 and (v_person is distinct from v_first_person or v_org is distinct from v_first_org) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 8. the congregation's toggle (R47): an enabled row, or nothing.
    if not exists (select 1 from organization_feature_toggles t
                    where t.organization_id = v_org
                      and t.feature_key = 'org_portal.sign_in_connect' and t.enabled) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 9, 10. the standing core.
    select * into v_st from presby__person_sign_in_standing(v_person, v_org);
    if v_st.refusal is not null or v_st.standing is null or not presby_standing_is_member(v_st.standing) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 11. authority needs a second factor (R42).
    if v_st.authority_bearing and not v_factor_ok then
      outcome := 'needs_second_factor';
      return next;
      return;
    end if;

    v_first_person := v_person;
    v_first_org := v_org;
  end loop;

  select * into v_bind from presby__bind_person_account(v_person, p_user_id, v_addr);
  select o.slug into v_slug from organizations o where o.id = v_org;

  outcome := 'connected';
  organization_id := v_org;
  organization_slug := v_slug;
  person_id := v_person;
  contact_method_id := v_bind.contact_method_id;
  contact_method_created_at := v_bind.contact_method_created_at;
  session_seat := v_st.session_seat;
  diaconate_seat := v_st.diaconate_seat;
  role_keys := v_st.role_keys;
  permission_keys := v_st.permission_keys;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 10. ACLs and comments. Every ACL this file's objects carry is restated, so
--     the end state does not depend on history. Firing a trigger needs no
--     EXECUTE, so every trigger function is revoked from both application
--     roles.
-- ---------------------------------------------------------------------------
revoke all on function presby_standing_is_member(text) from public, presby_app, presby_platform;
grant execute on function presby_standing_is_member(text) to presby_app;
revoke all on function presby_membership_is_member_standing(text, text) from public, presby_app, presby_platform;
grant execute on function presby_membership_is_member_standing(text, text) to presby_app;

revoke all on function presby_pair_derived_groups() from public, presby_app, presby_platform;
revoke all on function presby_sync_derived_membership_group() from public, presby_app, presby_platform;
revoke all on function presby_reject_derived_group_write() from public, presby_app, presby_platform;
revoke all on function presby_reject_derived_group_edit() from public, presby_app, presby_platform;
revoke all on function presby_memberships_guard_engagement() from public, presby_app, presby_platform;
revoke all on function presby_memberships_guard_roll_cache() from public, presby_app, presby_platform;

-- Section 9's three re-created bodies: create or replace keeps their ACLs,
-- restated here anyway (the 0065 section 15 shape). The core and the check
-- are internal (no EXECUTE for any application role); connect is EXECUTE to
-- presby_app only, as 0065 left it.
revoke all on function presby__person_sign_in_standing(uuid, uuid) from public, presby_app, presby_platform;
revoke all on function presby_sign_in__check(uuid, uuid, uuid, uuid, text, boolean) from public, presby_app, presby_platform;
revoke all on function presby_connect_signed_in_account(uuid, boolean) from public, presby_app, presby_platform;
grant execute on function presby_connect_signed_in_account(uuid, boolean) to presby_app;

comment on function presby_standing_is_member(text) is
  'Member standing, defined ONCE (drizzle/0066 section 2, DECISION-233): listed or staff_anchor. Takes a standing from presby_membership_standing (0065). NULL in, NULL out. Mirrored by isMemberStanding (src/lib/membership-standing.ts); pinned by membership-standing.db.test.ts.';
comment on function presby_membership_is_member_standing(text, text) is
  'presby_standing_is_member(presby_membership_standing(current_roll, engagement_status)) (drizzle/0066 section 2). The membership sync, the archive writer, check and connect reach member standing through this or presby_standing_is_member; nothing re-codes it.';
comment on function presby_pair_derived_groups() is
  'AFTER INSERT on groups, for a derived active_membership group: inserts its all_memberships sibling ("All Current Records") at the SAME organization, on conflict do nothing. Changes no role, permission or grant. Owner only (drizzle/0066 section 4, D1, arch-A3).';
comment on function presby_sync_derived_membership_group() is
  'AFTER INSERT OR UPDATE on memberships. SECURITY DEFINER (owner path through the F240 guard). Writes the all_memberships row for every membership (mirrors ended_on) and the active_membership row only while the membership has member standing (closed at current_date on loss, reopened on regain). Raises if either group is missing, active_membership first (drizzle/0066 section 5, DECISION-232).';
comment on function presby_reject_derived_group_write() is
  'BEFORE INSERT/UPDATE/DELETE on group_memberships. Every role: no DELETE of a derived row; no non-derived row in a derived group. Non-owner (no role named): no derived INSERT, and no change to a derived row except public_listed, public_listed_by, public_listed_at, public_display_order (closed allow-list) (drizzle/0033; owner test drizzle/0066 section 3, F240).';
comment on function presby_reject_derived_group_edit() is
  'BEFORE UPDATE on groups. Every role: a derived group''s name, description and meets_when are fixed. Non-owner (no role named): no column of a group that is derived before or after the update may change (drizzle/0033; owner test drizzle/0066 section 3, F245).';
comment on function presby_memberships_guard_engagement() is
  'BEFORE UPDATE OF engagement_status on memberships, EVERY role (the owner too): refuses any change on an ended membership, a transition into or out of staff, and visitor while current_roll is set (drizzle/0066 section 8, R53, F243).';
comment on function presby_memberships_guard_roll_cache() is
  'BEFORE INSERT / UPDATE OF current_roll, current_roll_since on memberships: a non-owner (no role named) may not write the roll cache. The roll projection (presby_sync_current_roll, presby_reconcile_current_roll) runs as the owner (drizzle/0066 section 8, F244, D5).';

comment on function presby__person_sign_in_standing(uuid, uuid) is
  'THE STANDING CORE (R40; drizzle/0065 section 11d, re-created by drizzle/0066 section 9): refusal (person_merged > person_deceased > membership_ended > person_elsewhere), standing (presby_membership_standing), the Session/diaconate seats and the set T (role and permission keys outside the closed derived list active_membership, all_memberships, session, diaconate; deacons_moderator deliberately counts, D10b, F247), authority_bearing. Every sign-in caller maps its output through one fixed table; nothing re-codes it. Owner only.';
comment on function presby_sign_in__check(uuid, uuid, uuid, uuid, text, boolean) is
  'The shared issue/resend eligibility check (drizzle/0065 section 12a, re-created by drizzle/0066 section 9); first failure wins: not_found, the core''s own-organization refusals, already_signs_in, needs_support, needs_officers_permission, exceeds_your_access, no_email_on_file, address_changed, address_is_yours, address_shared, needs_acknowledgement (do_not_contact only since 0066; the visitor acknowledgement is retired). Owner only.';
comment on function presby_connect_signed_in_account(uuid, boolean) is
  'Auto-connect (R41, R42, R47; drizzle/0065 section 14, re-created by drizzle/0066 section 9; DECISION-226): link a proven account to the one eligible person carrying its address; since 0066 the person must have member standing (presby_standing_is_member; R55), so visitor, inactive, moved away and unclassified are declined. connected | already_connected | needs_second_factor | declined. Writes only through the bind helper; reads no platform predicate. Residual, paper: identity and factor are caller-asserted (E-30).';

comment on constraint group_memberships_membership_group_key on group_memberships is
  'One derived row per (membership, group): a membership holds one row in all_memberships and at most one in active_membership. Replaced unique (membership_id) (drizzle/0066 section 4).';
comment on constraint groups_derived_pairing_check on groups is
  'derived if and only if derived_from is set (drizzle/0066 section 4, arch-A2). Strictly stronger than groups_derived_check.';
comment on constraint groups_derived_kind_check on groups is
  'The closed derived-kind list, five kinds: active_membership, all_memberships, session, diaconate, deacons_moderator. A sixth kind is a migration (drizzle/0066 section 4, D9).';
comment on constraint memberships_engagement_status_allowed on memberships is
  'The engagement vocabulary: visitor, regular, inactive, moved_away, staff (drizzle/0066 section 8, F243).';

comment on column groups.derived_from is
  'For a derived group, the record it projects from: one of five kinds (groups_derived_kind_check). session, diaconate (0009/0062) and deacons_moderator (0068) from officer_terms; active_membership (0017; member standing) and all_memberships (0066; every live membership) from memberships. Null for a managed group.';
comment on column groups.membership_source is
  'managed (staff edit the roster) or derived (projected by trigger). Derived rows and derived groups'' identity are owner-path only (drizzle/0066 section 3, F240/F245).';
comment on table group_memberships is
  'Group rosters. Rows with source = derived are written only by the owner-path triggers (presby_sync_derived_group, presby_sync_derived_membership_group); a tenant may toggle only their four public-listing columns (drizzle/0066, F240).';
comment on column memberships.engagement_status is
  'How the person is doing, for the congregation''s own care: visitor, regular, inactive, moved_away, staff (CHECK). Decides member standing with current_roll (presby_membership_standing). staff is set only at INSERT (DECISION-129); every change is guarded for every role (memberships_guard_engagement, drizzle/0066).';
comment on column memberships.current_roll is
  'A CACHE of the roll (presby_roll_as_of is the authority). Written only on the owner path, by the roll projection (memberships_guard_roll_cache, drizzle/0066, F244).';
comment on column memberships.current_roll_since is
  'Cache companion of current_roll; owner path only (memberships_guard_roll_cache, drizzle/0066, F244).';
comment on column memberships.ended_reason is
  'Why a membership ended. Fixed markers are declared in src/lib/roll-action-kinds.ts (participant removal; the Community archive marker from Increment 3a). ended_on and ended_reason remain writable by presby_app (a recorded paper residual, DECISION-235).';
