-- drizzle/0062_presby_session_approval.sql
--
-- Session approval, withdrawal, and installed pastors as members of the
-- Session (docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2,
-- Phase 2 R1-R18, Phase 3 "Data Model"; DECISION-202, DECISION-203,
-- DECISION-205, DECISION-206; findings F180, F181, F184, F188, F189).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0062_presby_session_approval.sql
--
-- STRICT ORDER: 0061 < 0062 < 0063, never reordered. 0061 also drops and
-- re-adds roll_actions_approval_status_allowed, so applying 0061 after this
-- file would clobber the 'withdrawn' vocabulary.
--
-- DEPLOY ORDER (R16, deliberately the reverse of 0061): apply THIS file
-- FIRST, then deploy the code, then apply 0063. This file is additive: the
-- pre-Increment-2 application keeps working against it (its pending->approved
-- and pending->denied UPDATEs still pass; the new columns are nullable; the
-- two new reason CHECKs are satisfied by what old code writes). The one
-- visible change for old code is that a second pending proposal for the same
-- person now fails (section 4).
--
-- Production measurement (orchestrator, read-only, 2026-10-22, before
-- deploy; counts only, no slug): 1 congregation and 1 non-congregation;
-- 0 congregations without a session or diaconate group; 0 org-owned
-- session_member roles; 0 role grants bound to a session or diaconate group;
-- 0 officer_terms rows (so the distinct office set is empty); 0 roll_actions
-- rows (so 0 pending duplicates). Re-measure before the production apply.
--
-- The whole file is idempotent: every statement is `if not exists`,
-- `on conflict do nothing`, drop-then-add, `create or replace`,
-- revoke-then-grant, or an insert whose predicate no longer matches once
-- applied. Proven by applying the whole file twice (work-log, Increment 2
-- Phase 4 Batch A). Unreleased until shipped, so it may be corrected in place
-- until then (CLAUDE.md -> Project Layout -> drizzle/); never edit 0061.
--
--   1. preconditions           stop on duplicate pending rows or an office
--                              outside the new vocabulary (counts only)
--   2. columns                 decided_by, decided_at, withdrawal_reason
--   3. vocabulary and reasons  'withdrawn'; reason-only-in-its-state CHECKs;
--                              the one-live-void index re-predicated
--   4. one pending per person  R7
--   5. terminal rows           denied and withdrawn rows freeze too (R8)
--   6. missing court groups    Session and Board of Deacons for every
--                              congregation (F189)
--   7. session_member backfill DECISION-202
--   8. pastors                 DECISION-206: the derived-group CASE, the
--                              office vocabulary CHECK, re-materialising
--                              existing pastor terms, the no-roll guard (S1)
--   9. functions               presby_deny_roll_decision,
--                              presby_roll__actor_holds,
--                              presby_decide_roll_action,
--                              presby_withdraw_roll_action
--  10. comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No delete anywhere (operator ruling: all deletes are soft).
--   * No backfill of decided_by / decided_at onto existing approved rows
--     (Phase 3 refinement 1): approved rows are frozen by
--     roll_actions_freeze and a migration must not disable an append-only
--     trigger to write metadata. Readers coalesce with approved_by /
--     approved_on.
--   * No roll_actions_terminal_decision_stamps CHECK (Phase 3 refinement 2):
--     old code's deny UPDATE sets neither stamp, so the CHECK lands in 0063,
--     after the code deploy.
--   * No privilege change on roll_actions: 0063 revokes presby_app's UPDATE
--     and DELETE once the code no longer needs them.
--   * No audit row. A migration backfill has no actor; the two decision
--     functions write none either (R13 puts the audit row in TypeScript,
--     insertAuditRow() in the same transaction, in src/lib/roll.ts). Residual,
--     paper: a direct SQL caller skips it; a source-scan test pins that only
--     src/lib/roll.ts names these functions.
--   * grant_reason on the backfilled role grant is informational text and
--     must never be used as a discriminator (the 2026-10-22 purge's lesson);
--     the role KEY is the discriminator.
--   * appointments (presbytery-owned) is NOT read: a presbytery row writing
--     a congregation's Session roster would be authority flowing down by
--     inheritance (Two Hierarchies; DECISION-112, DECISION-206).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md). Drizzle mirrors: src/lib/db/domain/
-- roll.ts and src/lib/db/domain/officers.ts. The journal entry is added at
-- integration (Rule 16); 0064 belongs to another pipeline.

-- ---------------------------------------------------------------------------
-- 1. preconditions (stop-blocks; counts and office strings only, never a
--    person)
-- ---------------------------------------------------------------------------
-- (a) R7's unique index (section 4) cannot be built over duplicates, and
-- which of two pending proposals to keep is a human decision (withdraw one
-- once Increment 2 ships). Measured 0 on the branch and in production.
-- (b) officer_terms_office_allowed (section 8) is added VALIDATED; an office
-- outside the vocabulary needs a human correction first. The message lists
-- the distinct office strings, which carry no personal data.
do $$
declare
  v_dups bigint;
  v_bad text;
begin
  select count(*) into v_dups
    from (select 1 from roll_actions
           where approval_status = 'pending'
           group by organization_id, person_id
          having count(*) > 1) d;
  if v_dups > 0 then
    raise exception
      '0062: % person(s) have more than one pending roll action at one organization; withdraw or deny the extras before this migration can apply',
      v_dups
      using errcode = 'check_violation';
  end if;

  select string_agg(distinct office, ', ' order by office) into v_bad
    from officer_terms
   where office not in ('ruling_elder', 'installed_pastor', 'co_pastor',
                        'associate_pastor', 'deacon', 'clerk_of_session',
                        'moderator', 'treasurer', 'trustee');
  if v_bad is not null then
    raise exception
      '0062: officer_terms carries office value(s) outside the vocabulary: %; correct them before this migration can apply',
      v_bad
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. columns (R5), all nullable
-- ---------------------------------------------------------------------------
-- One generic actor pair for every terminal transition (approved, denied,
-- withdrawn), not denied_by plus withdrawn_by. approved_by / approved_on are
-- kept: replay, seeds and tests read them, and the approve path still sets
-- them.
alter table roll_actions add column if not exists decided_by uuid;
alter table roll_actions add column if not exists decided_at timestamptz;
alter table roll_actions add column if not exists withdrawal_reason text;

-- The same single-column shape as approved_by and proposed_by (a non-tenant
-- table, so no composite key). Drop-then-add so replay is clean; the name is
-- Drizzle's default for src/lib/db/domain/roll.ts decidedBy, so
-- check:schema-parity sees one FK.
alter table roll_actions drop constraint if exists roll_actions_decided_by_users_id_fk;
alter table roll_actions add constraint roll_actions_decided_by_users_id_fk
  foreign key (decided_by) references users(id);

-- ---------------------------------------------------------------------------
-- 3. vocabulary and reasons (R1d, R5), drop-then-add so replay is clean
-- ---------------------------------------------------------------------------
-- 'withdrawn' is its own status (operator Q3): a proposer taking back a
-- mistake is not the Session refusing it.
alter table roll_actions drop constraint if exists roll_actions_approval_status_allowed;
alter table roll_actions add constraint roll_actions_approval_status_allowed
  check (approval_status in ('pending', 'approved', 'denied', 'withdrawn'));

-- Old code satisfies both: its deny sets denial_reason only on the row it
-- moves to 'denied'. Measured 0 violators of each on the branch, 0 rows in
-- production.
alter table roll_actions drop constraint if exists roll_actions_denial_reason_only_when_denied;
alter table roll_actions add constraint roll_actions_denial_reason_only_when_denied
  check (denial_reason is null or approval_status = 'denied');

alter table roll_actions drop constraint if exists roll_actions_withdrawal_reason_only_when_withdrawn;
alter table roll_actions add constraint roll_actions_withdrawal_reason_only_when_withdrawn
  check (withdrawal_reason is null or approval_status = 'withdrawn');

-- 0061's S3 index read `approval_status <> 'denied'`, which would count a
-- WITHDRAWN void as live. Re-created with the positive list, guarded on its
-- own definition so a second apply leaves it alone.
do $$
begin
  if exists (select 1 from pg_indexes
              where schemaname = 'public'
                and indexname = 'roll_actions_one_live_void_idx'
                and indexdef not like '%''pending''::text, ''approved''::text%') then
    drop index roll_actions_one_live_void_idx;
  end if;
end $$;
create unique index if not exists roll_actions_one_live_void_idx
  on roll_actions (voids_action_id)
  where kind = 'void' and approval_status in ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- 4. one pending proposal per person (R7)
-- ---------------------------------------------------------------------------
-- Closes the duplicate-pending half of F181 structurally; withdrawal is now
-- the remedy for a mistake. Covers every pending kind, so a pending void
-- (which the application cannot insert after 0063) also blocks a second.
create unique index if not exists roll_actions_one_pending_per_person_idx
  on roll_actions (organization_id, person_id)
  where approval_status = 'pending';

-- ---------------------------------------------------------------------------
-- 5. terminal rows (R8)
-- ---------------------------------------------------------------------------
-- Same signature, language and security mode (invoker) as before. The
-- approved branch and its message are unchanged (existing tests match it). A
-- new branch freezes denied and withdrawn rows. A pending row's DELETE stays
-- allowed here for the owner (fixtures, cascades); presby_app loses DELETE in
-- 0063. A trigger, so it binds the owner connection too (F44).
create or replace function presby_freeze_approved_roll_action()
returns trigger language plpgsql
as $$
begin
  if old.approval_status = 'approved' then
    raise exception
      'roll_actions %: approved actions are immutable; record a void action instead',
      old.id
      using errcode = 'check_violation';
  end if;
  if old.approval_status in ('denied', 'withdrawn') then
    raise exception
      'roll_actions %: decided actions are immutable (%); propose a new action instead',
      old.id, old.approval_status
      using errcode = 'check_violation';
  end if;
  -- TG_OP is always UPPERCASE ('INSERT'/'UPDATE'/'DELETE'/'TRUNCATE') —
  -- caught live: an earlier `tg_op = 'delete'` (lowercase) never matched,
  -- so a PENDING row's DELETE silently fell through to `return new` (NULL
  -- on DELETE) exactly like the original bug, while an APPROVED row's
  -- DELETE still correctly raised because that check runs first and never
  -- reaches this branch. Both paths are re-verified live below.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. missing court groups (F189)
-- ---------------------------------------------------------------------------
-- Every congregation gets its Session and Board of Deacons derived groups in
-- the groupSeedPlan() shape (src/lib/org-provisioning.ts): court group type,
-- membership_source 'derived', protected. An empty derived group grants
-- nothing until the congregation's own officer records fill it, so this is
-- provisioning, not authority. Non-congregations get nothing (F185).
do $$
begin
  if exists (select 1 from organizations where organization_type = 'congregation')
     and not exists (select 1 from group_types where key = 'court') then
    raise exception
      '0062: the global group type ''court'' is missing; congregations cannot be given their Session and Board of Deacons groups'
      using errcode = 'foreign_key_violation';
  end if;
end $$;

insert into groups (organization_id, group_type_id, name, membership_source,
                    derived_from, is_protected)
select o.id, gt.id, v.name, 'derived', v.derived_from, true
  from organizations o
  cross join (values ('session', 'Session'),
                     ('diaconate', 'Board of Deacons')) as v(derived_from, name)
  join group_types gt on gt.key = 'court'
 where o.organization_type = 'congregation'
on conflict (organization_id, derived_from) do nothing;

-- ---------------------------------------------------------------------------
-- 7. session_member backfill (DECISION-202)
-- ---------------------------------------------------------------------------
-- For each congregation that has a Session group and NO org-owned
-- session_member role: the role (constitutional, protected), its single
-- roll.approve permission, and a group-arm grant to the Session group, all
-- driven by the CTE's RETURNING so a second run inserts nothing. An existing
-- org-owned session_member is never modified, whatever it holds (0052 note
-- 5: a migration that adds authority to a tenant-held role would be the
-- platform granting ecclesiastical authority). The role KEY is the
-- discriminator, never grant_reason.
-- app_role_permissions_giving_guard ignores non-giving keys;
-- role_grants_needs_membership ignores group-arm grants.
with targets as (
  select o.id as organization_id, g.id as group_id
    from organizations o
    join groups g on g.organization_id = o.id and g.derived_from = 'session'
   where o.organization_type = 'congregation'
     and not exists (select 1 from app_roles r
                      where r.organization_id = o.id and r.key = 'session_member')
), new_roles as (
  insert into app_roles (organization_id, key, name, role_kind, is_protected)
  select t.organization_id, 'session_member', 'Session member', 'constitutional', true
    from targets t
  on conflict (organization_id, key) do nothing
  returning id, organization_id
), new_permissions as (
  insert into app_role_permissions (role_id, permission_key)
  select nr.id, 'roll.approve' from new_roles nr
  on conflict (role_id, permission_key) do nothing
  returning role_id
)
insert into role_grants (organization_id, role_id, group_id, starts_on,
                         granted_by, grant_reason)
select nr.organization_id, nr.id, t.group_id, current_date, null,
       'Baseline Session member role: roll.approve for the members of the Session (drizzle/0062, DECISION-202)'
  from new_roles nr
  join targets t on t.organization_id = nr.organization_id
 where exists (select 1 from new_permissions np where np.role_id = nr.id);

-- ---------------------------------------------------------------------------
-- 8. pastors (DECISION-206; R10-R12, S1). One delimited block: if the
--    decision were ever reversed, this section and the holds_pastoral_office
--    check in section 9 are what strip.
-- ---------------------------------------------------------------------------
-- (a) G-3.0201: the session is the ruling elders in active service together
-- with all installed pastors and associate pastors. Co-pastors are installed
-- pastors. moderator stays unmapped (a moderator who is not a pastor has no
-- vote), as do temporary relationships, which are not officer_terms offices.
-- Same signature, language and security mode (invoker) as before; the
-- missing-group error text is unchanged.
-- The CASE arms are pinned to SESSION_OFFICES by a source-scan test.
create or replace function presby_sync_derived_group()
returns trigger language plpgsql
as $$
declare
  target_group uuid;
  derived_key  text;
begin
  derived_key := case new.office
    when 'ruling_elder'     then 'session'
    when 'installed_pastor' then 'session'
    when 'co_pastor'        then 'session'
    when 'associate_pastor' then 'session'
    when 'deacon'           then 'diaconate'
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

-- (b) The office vocabulary (F188), validated. Pinned to OFFICER_OFFICES by a
-- source-scan test. Section 1(b) already stopped on a violator.
alter table officer_terms drop constraint if exists officer_terms_office_allowed;
alter table officer_terms add constraint officer_terms_office_allowed
  check (office in ('ruling_elder', 'installed_pastor', 'co_pastor',
                    'associate_pastor', 'deacon', 'clerk_of_session',
                    'moderator', 'treasurer', 'trustee'));

-- (c) Re-materialise existing pastor-office terms through the trigger. A
-- pastor term at an organization with no Session group would make the touch
-- raise inside the trigger, so stop first with a count. Measured 0 on the
-- branch (its one pastor term is at a congregation) and 0 terms in
-- production.
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
    from officer_terms ot
   where ot.office in ('installed_pastor', 'co_pastor', 'associate_pastor')
     and not exists (select 1 from groups g
                      where g.organization_id = ot.organization_id
                        and g.derived_from = 'session');
  if v_bad > 0 then
    raise exception
      '0062: % pastor-office term(s) sit at an organization with no Session group (pastor offices are congregation-only); correct them before this migration can apply',
      v_bad
      using errcode = 'check_violation';
  end if;
end $$;

-- A no-op touch re-fires the AFTER UPDATE trigger, which upserts the derived
-- group row on officer_term_id. No direct group_memberships write. The
-- officer_terms_needs_membership guard fires on ends_on and raises only for
-- a term still open past a membership end (measured: none). Idempotent: the
-- second run upserts the same values.
update officer_terms
   set ends_on = ends_on
 where office in ('installed_pastor', 'co_pastor', 'associate_pastor');

-- (d) S1: an OPEN pastor-office term cannot be recorded for a person on this
-- organization's roll (R11 as a database property). A pastor's membership is
-- held by the presbytery; the congregation link carries no roll fact.
-- "On the roll" = the replay as of greatest(current_date, starts_on) is
-- non-null, or memberships.current_roll is non-null. Closed (historical)
-- terms are allowed: presby_guard_position_needs_membership already states
-- that importing history for someone who has since joined is legitimate.
-- Fires on person_id, office and ends_on, but an UPDATE refuses only when it
-- newly makes a pastor term open for this person (a new person or office, or
-- a closed term re-opened), so ending or shortening a term can never fail
-- because the person later acquired a roll.
-- SECURITY DEFINER with a pinned search_path (F26): it reads memberships and
-- roll_actions by new.organization_id, never the GUC. Raised with
-- constraint 'officer_terms_pastor_no_roll' so the caller can tell it apart
-- from the other check_violations on this table.
create or replace function presby_guard_pastor_no_roll()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_open_new boolean;
  v_open_old boolean;
begin
  if new.office not in ('installed_pastor', 'co_pastor', 'associate_pastor') then
    return new;
  end if;
  v_open_new := new.ends_on is null or new.ends_on > current_date;
  if not v_open_new then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_open_old := old.ends_on is null or old.ends_on > current_date;
    if v_open_old and old.person_id = new.person_id and old.office = new.office then
      return new;
    end if;
  end if;

  if presby_roll_as_of(new.person_id, new.organization_id,
                       greatest(current_date, new.starts_on)) is not null
     or exists (select 1 from memberships m
                 where m.person_id = new.person_id
                   and m.organization_id = new.organization_id
                   and m.current_roll is not null) then
    raise exception
      'officer_terms: an open pastor-office term cannot be recorded for a person on this organization''s roll; a pastor''s membership is held by the presbytery'
      using errcode = 'check_violation',
            constraint = 'officer_terms_pastor_no_roll';
  end if;
  return new;
end $$;
revoke all on function presby_guard_pastor_no_roll() from public;

drop trigger if exists officer_terms_pastor_no_roll on officer_terms;
create trigger officer_terms_pastor_no_roll
  before insert or update of person_id, office, ends_on on officer_terms
  for each row execute function presby_guard_pastor_no_roll();

-- ---------------------------------------------------------------------------
-- 9. functions (R1-R6, R12)
-- ---------------------------------------------------------------------------

-- 9a. The ONE uniform identity-refusal literal for the decision functions
-- (the 0052 / 0061 shape). A different literal from 0061's, so an audit
-- reader can tell an approval refusal from a participant refusal. Invoker, no
-- search_path pin (it touches no table). presby_app keeps execute so a
-- non-owner caller sees this literal and never a second "permission denied
-- for function" string.
create or replace function presby_deny_roll_decision()
returns void language plpgsql
as $$
begin
  raise exception 'roll_actions: this roll decision is not permitted'
    using errcode = 'insufficient_privilege';
end $$;
revoke all on function presby_deny_roll_decision() from public;
grant execute on function presby_deny_roll_decision() to presby_app;

-- 9b. The bounded actor claim, generalised (Phase 2 allowed it): p_user_id is
-- a users.id bound server-side from the session. The user's live, unmerged
-- person must be an active member of p_org holding p_key. people.user_id is
-- not unique, hence exists. 0061's presby_participant__actor_may_propose is
-- left as it is (never edit 0061). Called only from the definers below: no
-- grant.
create or replace function presby_roll__actor_holds(p_org uuid, p_user_id uuid, p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from people pe
     where pe.user_id = p_user_id and pe.merged_into_id is null
       and presby_membership_is_active(pe.id, p_org)
       and presby_has_permission(pe.id, p_org, p_key));
$$;
revoke all on function presby_roll__actor_holds(uuid, uuid, text) from public;

-- 9c. Approve or deny a pending roll action (R1-R6, R12).
-- Returns exactly ONE row. Identity refusals raise the uniform literal; state
-- refusals are returned as outcomes (closed list, pinned to the TypeScript
-- ROLL_DECISION_REFUSALS by a source-scan test), checked in this order, the
-- first failing wins:
--   ok, invalid_decision, reason_required, reason_too_long,
--   minute_reference_too_long, not_found, already_decided,
--   not_approvable_kind, person_deceased, person_merged, membership_ended,
--   holds_pastoral_office, already_on_roll, active_elsewhere,
--   provisioning_incomplete
-- A deny checks only identity, the decision, the reason bounds, not_found and
-- already_decided: a proposal for an ended, deceased or merged person can
-- always be denied, and a pending row of any kind can be denied (junk is
-- cleaned up softly).
create or replace function presby_decide_roll_action(
  p_roll_action_id uuid,
  p_decision text,
  p_minute_reference text,
  p_reason text,
  p_decided_by uuid)
returns table (outcome text, roll_action_id uuid, subject_person_id uuid,
               action_kind text, action_effective_date date,
               affects_filed_period boolean,
               shadowed_by_kind text, shadowed_by_date date,
               self_approved boolean, self_target boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_minute text := nullif(btrim(coalesce(p_minute_reference, '')), '');
  v_person uuid;
  v_m record;
  v_t record;
  v_p record;
  v_next record;
  v_shadow record;
  v_constraint text;
  v_outcome text;
begin
  outcome := null; roll_action_id := null; subject_person_id := null;
  action_kind := null; action_effective_date := null;
  affects_filed_period := false; shadowed_by_kind := null; shadowed_by_date := null;
  self_approved := false; self_target := false;

  -- Identity (uniform literal, reveals nothing).
  if v_org is null or p_decided_by is null
     or not presby_roll__actor_holds(v_org, p_decided_by, 'roll.approve') then
    perform presby_deny_roll_decision();
  end if;

  if p_decision is null or p_decision not in ('approve', 'deny') then
    outcome := 'invalid_decision'; return next; return;
  end if;

  -- R4: input bounds in the database too (F184).
  if p_decision = 'deny' then
    if v_reason = '' then
      outcome := 'reason_required'; return next; return;
    end if;
    if length(v_reason) > 500 then
      outcome := 'reason_too_long'; return next; return;
    end if;
  elsif length(coalesce(v_minute, '')) > 200 then
    outcome := 'minute_reference_too_long'; return next; return;
  end if;

  -- R2 step 1: learn the person. The definer bypasses RLS, so the explicit
  -- organization predicate is the whole isolation: another organization's id
  -- is indistinguishable from a missing one.
  select ra.person_id into v_person
    from roll_actions ra
   where ra.id = p_roll_action_id and ra.organization_id = v_org;
  if not found then
    outcome := 'not_found'; return next; return;
  end if;

  -- R2 step 2: lock the membership (the same lock order as 0061's R6, so
  -- decide, withdraw, record and void serialize per person).
  select m.id as membership_id, m.ended_on
    into v_m
    from memberships m
   where m.person_id = v_person and m.organization_id = v_org
     for update;

  -- R2 steps 3-4: re-read the roll action under its own lock and re-check
  -- that it is still pending (a concurrent decision may have committed while
  -- this call waited).
  select ra.id, ra.person_id, ra.kind, ra.effective_date, ra.resulting_roll,
         ra.approval_status, ra.proposed_by, ra.recorded_at
    into v_t
    from roll_actions ra
   where ra.id = p_roll_action_id and ra.organization_id = v_org
     for update;
  if v_t.approval_status <> 'pending' then
    outcome := 'already_decided'; return next; return;
  end if;

  if p_decision = 'deny' then
    update roll_actions
       set approval_status = 'denied',
           denial_reason = v_reason,
           decided_by = p_decided_by,
           decided_at = now()
     where id = v_t.id and organization_id = v_org;
    outcome := 'ok';
    roll_action_id := v_t.id;
    subject_person_id := v_t.person_id;
    action_kind := v_t.kind::text;
    action_effective_date := v_t.effective_date;
    return next; return;
  end if;

  -- Approve. Only the seven approvable gain kinds (Phase 3 refinement 3:
  -- the kinds with a mapped resulting_roll, minus on-record participant
  -- enrolment). Pinned to APPROVABLE_ROLL_ACTION_KINDS and to 0063's insert
  -- policy by a source-scan test.
  if v_t.kind not in ('profession_of_faith', 'reaffirmation', 'restoration',
                      'certificate_received', 'other_gain',
                      'baptized_member_enrolled', 'affiliate_received') then
    outcome := 'not_approvable_kind'; return next; return;
  end if;

  select pe.date_of_death, pe.merged_into_id, pe.user_id
    into v_p
    from people pe where pe.id = v_t.person_id;
  if v_p.date_of_death is not null then
    outcome := 'person_deceased'; return next; return;
  end if;
  if v_p.merged_into_id is not null then
    outcome := 'person_merged'; return next; return;
  end if;

  if v_m.ended_on is not null then
    outcome := 'membership_ended'; return next; return;
  end if;

  -- R12 (DECISION-206): a pastor's membership is held by the presbytery, so
  -- a member-roll gain for an open pastor-office holder is refused.
  if exists (select 1 from officer_terms ot
              where ot.organization_id = v_org and ot.person_id = v_t.person_id
                and ot.office in ('installed_pastor', 'co_pastor', 'associate_pastor')
                and (ot.ends_on is null or ot.ends_on > current_date)) then
    outcome := 'holds_pastoral_office'; return next; return;
  end if;

  -- R6 (F181), direction (a): the person is already on that roll as of the
  -- effective date (this row is pending, so it is not in the replay).
  if presby_roll_as_of(v_t.person_id, v_org, v_t.effective_date)
       is not distinct from v_t.resulting_roll then
    outcome := 'already_on_roll'; return next; return;
  end if;

  -- R6 direction (b): the next effective row after this one has the same
  -- resulting_roll and is a counted gain kind, so presby_roll_changes would
  -- count the person twice. The five kinds presby_roll_changes counts, pinned
  -- to COUNTED_GAIN_KINDS by a source-scan test. A following opening_balance
  -- is not counted and gives only the shadow warning below.
  select ra.kind, ra.resulting_roll
    into v_next
    from presby_effective_roll_actions ra
   where ra.person_id = v_t.person_id and ra.organization_id = v_org
     and (ra.effective_date, ra.recorded_at) > (v_t.effective_date, v_t.recorded_at)
   order by ra.effective_date asc, ra.recorded_at asc
   limit 1;
  if found and v_next.resulting_roll is not distinct from v_t.resulting_roll
     and v_next.kind in ('profession_of_faith', 'reaffirmation', 'restoration',
                         'certificate_received', 'other_gain') then
    outcome := 'already_on_roll'; return next; return;
  end if;

  -- The shadow warning (never a refusal, Increment 1 S1): the latest
  -- effective row sorting after this one, the one the cache will project.
  select ra.kind, ra.effective_date
    into v_shadow
    from presby_effective_roll_actions ra
   where ra.person_id = v_t.person_id and ra.organization_id = v_org
     and (ra.effective_date, ra.recorded_at) > (v_t.effective_date, v_t.recorded_at)
   order by ra.effective_date desc, ra.recorded_at desc
   limit 1;

  -- The write, in a sub-block (a savepoint), so a refusal caught here leaves
  -- nothing behind. presby_sync_current_roll (AFTER UPDATE) projects
  -- current_roll for a row dated on or before today; that UPDATE of
  -- memberships is where both caught errors arise.
  begin
    update roll_actions
       set approval_status = 'approved',
           approved_by = p_decided_by,
           approved_on = current_date,
           decided_by = p_decided_by,
           decided_at = now(),
           -- A supplied reference overwrites the proposer's; omitted leaves it.
           minute_reference = coalesce(v_minute, minute_reference)
     where id = v_t.id and organization_id = v_org;
  exception
    when unique_violation then
      -- memberships_one_active_roll_idx is global across organizations: the
      -- person is active elsewhere. Generic outcome; the other organization
      -- is never named.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'memberships_one_active_roll_idx' then
        v_outcome := 'active_elsewhere';
      else
        raise;
      end if;
    when foreign_key_violation then
      -- S4 (Increment 1): an organization with no active_membership group
      -- raises in memberships_sync_derived_group (F16).
      if sqlerrm like '%has no derived group active_membership%' then
        v_outcome := 'provisioning_incomplete';
      else
        raise;
      end if;
  end;

  if v_outcome is not null then
    outcome := v_outcome; return next; return;
  end if;

  outcome := 'ok';
  roll_action_id := v_t.id;
  subject_person_id := v_t.person_id;
  action_kind := v_t.kind::text;
  action_effective_date := v_t.effective_date;
  -- R14: a live filed return for a year on or after the pivot (0061's
  -- predicate).
  affects_filed_period := exists (
    select 1 from publications pb
      join statistical_returns sr
        on sr.id = pb.artifact_id and sr.organization_id = pb.organization_id
     where pb.organization_id = v_org and pb.record_class = 'statistical_return'
       and pb.withdrawn_at is null
       and sr.report_year >= extract(year from v_t.effective_date)::int);
  if v_shadow.kind is not null then
    shadowed_by_kind := v_shadow.kind::text;
    shadowed_by_date := v_shadow.effective_date;
  end if;
  self_approved := v_t.proposed_by is not null and v_t.proposed_by = p_decided_by;
  self_target := v_p.user_id is not null and v_p.user_id = p_decided_by;
  return next; return;
end $$;
revoke all on function presby_decide_roll_action(uuid, text, text, text, uuid) from public;
grant execute on function presby_decide_roll_action(uuid, text, text, text, uuid) to presby_app;

-- 9d. Withdraw a pending roll action (operator Q3, DECISION-203).
-- Returns exactly ONE row. Outcomes (closed list, pinned to the TypeScript
-- ROLL_WITHDRAW_REFUSALS by a source-scan test):
--   ok, reason_required, reason_too_long, not_found, already_decided
-- Any roll.propose holder may withdraw (the clerk keeps the register); no
-- state checks, so a proposal for an ended or deceased person can always be
-- withdrawn. The same lock order as the decide function.
create or replace function presby_withdraw_roll_action(
  p_roll_action_id uuid,
  p_reason text,
  p_withdrawn_by uuid)
returns table (outcome text, roll_action_id uuid, subject_person_id uuid,
               action_kind text, action_effective_date date, self_proposed boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_person uuid;
  v_t record;
begin
  outcome := null; roll_action_id := null; subject_person_id := null;
  action_kind := null; action_effective_date := null; self_proposed := false;

  if v_org is null or p_withdrawn_by is null
     or not presby_roll__actor_holds(v_org, p_withdrawn_by, 'roll.propose') then
    perform presby_deny_roll_decision();
  end if;

  if v_reason = '' then
    outcome := 'reason_required'; return next; return;
  end if;
  if length(v_reason) > 500 then
    outcome := 'reason_too_long'; return next; return;
  end if;

  select ra.person_id into v_person
    from roll_actions ra
   where ra.id = p_roll_action_id and ra.organization_id = v_org;
  if not found then
    outcome := 'not_found'; return next; return;
  end if;

  perform 1 from memberships m
   where m.person_id = v_person and m.organization_id = v_org
     for update;

  select ra.id, ra.person_id, ra.kind, ra.effective_date, ra.approval_status,
         ra.proposed_by
    into v_t
    from roll_actions ra
   where ra.id = p_roll_action_id and ra.organization_id = v_org
     for update;
  if v_t.approval_status <> 'pending' then
    outcome := 'already_decided'; return next; return;
  end if;

  update roll_actions
     set approval_status = 'withdrawn',
         withdrawal_reason = v_reason,
         decided_by = p_withdrawn_by,
         decided_at = now()
   where id = v_t.id and organization_id = v_org;

  outcome := 'ok';
  roll_action_id := v_t.id;
  subject_person_id := v_t.person_id;
  action_kind := v_t.kind::text;
  action_effective_date := v_t.effective_date;
  self_proposed := v_t.proposed_by is not null and v_t.proposed_by = p_withdrawn_by;
  return next; return;
end $$;
revoke all on function presby_withdraw_roll_action(uuid, text, uuid) from public;
grant execute on function presby_withdraw_roll_action(uuid, text, uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 10. comments
-- ---------------------------------------------------------------------------
comment on column roll_actions.decided_by is
  'drizzle/0062 (R5): the users.id that moved this row out of pending (approve, deny or withdraw), set by presby_decide_roll_action / presby_withdraw_roll_action. Null on rows decided before 0062; readers use coalesce(decided_by, approved_by).';

comment on column roll_actions.decided_at is
  'drizzle/0062 (R5): when this row left pending. Null on rows decided before 0062; readers use coalesce(decided_at, approved_on::timestamptz).';

comment on column roll_actions.withdrawal_reason is
  'drizzle/0062: why the proposer withdrew this action (required, 1-500 characters, set only by presby_withdraw_roll_action). Free text about a person: the library returns it only to holders of roll.propose or roll.approve (DECISION-204).';

comment on constraint roll_actions_approval_status_allowed on roll_actions is
  'drizzle/0062: approval_status is pending, approved, denied or withdrawn. Withdrawn is the proposer taking a mistake back; denied is the Session refusing it.';

comment on constraint roll_actions_denial_reason_only_when_denied on roll_actions is
  'drizzle/0062 (R5): a denial reason exists only on a denied row.';

comment on constraint roll_actions_withdrawal_reason_only_when_withdrawn on roll_actions is
  'drizzle/0062 (R5): a withdrawal reason exists only on a withdrawn row.';

comment on index roll_actions_one_live_void_idx is
  'S3 (drizzle/0061, re-predicated by drizzle/0062): one live (pending or approved) void per action; a denied or withdrawn void does not block a later one.';

comment on index roll_actions_one_pending_per_person_idx is
  'R7 (drizzle/0062): at most one pending roll action per person per organization. Closes the duplicate-pending half of F181; withdrawal is the remedy for a mistaken proposal.';

comment on function presby_freeze_approved_roll_action() is
  'roll_actions_freeze (BEFORE UPDATE OR DELETE): approved rows are immutable (record a void); denied and withdrawn rows are immutable too (drizzle/0062, R8). A trigger, so it binds the owner connection as well. Pending rows stay mutable for the owner; presby_app has no UPDATE or DELETE after drizzle/0063.';

comment on function presby_sync_derived_group() is
  'officer_terms_sync_derived (AFTER INSERT OR UPDATE): materialises the derived court rosters (The Court Is Not a Group, F3). drizzle/0062 (DECISION-206, G-3.0201): ruling_elder, installed_pastor, co_pastor and associate_pastor map to the session group; deacon to diaconate; moderator stays unmapped. Pinned to SESSION_OFFICES by a source-scan test.';

comment on constraint officer_terms_office_allowed on officer_terms is
  'drizzle/0062 (F188): the office vocabulary, pinned to OFFICER_OFFICES by a source-scan test.';

comment on function presby_guard_pastor_no_roll() is
  'officer_terms_pastor_no_roll (drizzle/0062, S1, DECISION-206): an OPEN installed_pastor / co_pastor / associate_pastor term cannot be recorded for a person on this organization''s roll (replay as of greatest(current_date, starts_on), or memberships.current_roll). A pastor''s membership is held by the presbytery. Closed historical terms are allowed; ending or shortening a term never fails. Raises check_violation with constraint officer_terms_pastor_no_roll.';

comment on function presby_deny_roll_decision() is
  'The ONE uniform identity-refusal literal for the roll decision functions (drizzle/0062, the 0052 shape): raises ''roll_actions: this roll decision is not permitted'' with insufficient_privilege. presby_app keeps execute so a non-owner caller never sees a second "permission denied for function" string.';

comment on function presby_roll__actor_holds(uuid, uuid, text) is
  'Bounded actor claim for drizzle/0062 (R1): p_user_id is a users.id bound server-side from the session; true when that user''s live, unmerged person is an active member of p_org holding p_key. people.user_id is not unique, hence exists. Owner-only: called from the definer functions, no grant.';

comment on function presby_decide_roll_action(uuid, text, text, text, uuid) is
  'Approves or denies a pending roll action (DECISION-203). Organization from presby_current_org() (no parameter); p_decided_by is a bounded users.id claim checked for roll.approve in the caller''s own transaction. Identity refusals raise one literal; state refusals return a closed outcome list. Lock order membership then roll action. Approval refuses a non-approvable kind, a deceased or merged person, an ended membership, a pastor-office holder, a gain the person already has (both directions, so presby_roll_changes cannot double-count), and maps the global active-roll collision to active_elsewhere without naming the other organization. Returns exactly one row. Writes no audit row: src/lib/roll.ts writes it in the same transaction (R13).';

comment on function presby_withdraw_roll_action(uuid, text, uuid) is
  'Withdraws a pending roll action (DECISION-203, operator Q3): any roll.propose holder; reason required (1-500 characters, stored in withdrawal_reason); no state checks. Organization from presby_current_org(). Returns exactly one row. Writes no audit row: src/lib/roll.ts writes it in the same transaction (R13).';
