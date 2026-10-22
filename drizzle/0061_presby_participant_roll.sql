-- drizzle/0061_presby_participant_roll.sql
--
-- Participant roll on record, roll permissions in the catalog, and the clerk
-- template binding (docs/work-log/2026-10-22-founding-admin-directory.md,
-- Phase 2 R1-R14, Phase 3 "Data Model"; DECISION-198, DECISION-199;
-- findings F173, F174, F175).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0061_presby_participant_roll.sql
--
-- DEPLOY ORDER: deploy the application code FIRST, then apply this file.
-- Section 5's roll_actions_resulting_roll_matches_kind rejects the pre-0061
-- createPerson() insert (a null resulting_roll for a mapped kind, F173), so in
-- the other order every "Add person" with a roll action fails until the
-- deploy lands.
--
-- Production measurement (read-only, 2026-10-22, before deploy): designation-
-- minted congregation_stated_clerk copies = 1 (all org-owned clerk copies = 1);
-- roll_actions rows = 0. A count only, no slug.
--
-- The whole file is idempotent: every statement is `on conflict do nothing`,
-- an update whose predicate no longer matches once applied, drop-then-add,
-- `if not exists`, `create or replace`, or revoke-then-grant. Proven by
-- applying the whole file twice (work-log, Phase 4 Batch A). Unreleased until
-- shipped, so it may be corrected in place until then (CLAUDE.md -> Project
-- Layout -> drizzle/).
--
--   1. permission catalog      roll.propose, roll.approve (F174)
--   2. clerk template binding  roll.propose + directory.view onto the
--                              congregation_stated_clerk TEMPLATE
--   3. narrowed backfill       the same keys onto org-owned clerk copies, ONLY
--                              at organizations holding an org-owned
--                              founding_administrator role (0057 precedent;
--                              0052 note 5 respected)
--   4. F173 repair             pending rows get their resulting_roll (and age);
--                              an approved violator STOPS the migration
--   5. constraints             resulting_roll matches kind, void shape,
--                              approval_status vocabulary, one live void
--   6. restrictive policy      presby_app may insert PENDING rows only (R5)
--   7. functions               presby_deny_participant_action,
--                              presby_participant__actor_may_propose,
--                              presby_record_participant_action,
--                              presby_void_participant_action
--   8. comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No delete anywhere (R14, operator ruling: all deletes are soft).
--   * No audit row. A migration backfill has no actor. The two functions do
--     not write audit rows either: R8 puts the audit row in TypeScript
--     (src/lib/roll.ts, insertAuditRow() in the same transaction). Residual,
--     paper: a direct SQL caller skips it; a source-scan test pins that only
--     src/lib/roll.ts names these functions.
--   * The founding-administrator bundle is unchanged (DECISION-155, F118).
--     presby_founding_administrator_permission_keys is not re-created.
--   * roll.approve is bound to nothing (Increment 2). The approval UPDATE path
--     stays application-gated on roll.approve in decideRollAction().
--   * No engagement_status write. The roll functions never touch the pastoral
--     axis (DECISION-200).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md). Drizzle mirror: src/lib/db/domain/roll.ts.
-- The journal entry is added at integration (Rule 16); 0060 belongs to the
-- parallel pipeline and 0058 is reserved.

-- ---------------------------------------------------------------------------
-- 1. permission catalog (F174)
-- ---------------------------------------------------------------------------
-- Before this file only scripts/seed-dev.sql inserted these two keys, so a
-- fresh install (migrations plus `npm run db:seed`) could bind neither. The
-- seed's own texts, and its own `on conflict (key) do nothing`, so the two
-- inserts never collide. ledger.approve has the same gap and is out of scope.
insert into permissions (key, module, description, sensitivity_tier)
values ('roll.propose', 'roll', 'Propose a roll action', 1),
       ('roll.approve', 'roll', 'Approve a roll action', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. clerk template binding (DECISION-199)
-- ---------------------------------------------------------------------------
-- DECISION-078's test: keeping the rolls is the Clerk of Session's
-- constitutional duty, and so is reading them. The template becomes
-- statistics.publish + roll.propose + directory.view. Never roll.approve: the
-- Session decides collectively, and no role carries both keys.
insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('roll.propose'), ('directory.view')) as k(key)
 where r.organization_id is null
   and r.key = 'congregation_stated_clerk'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. narrowed backfill (DECISION-199, 0057 precedent, 0052 note 5)
-- ---------------------------------------------------------------------------
-- Copies of the template are made at designation and never topped up, so a
-- designation-minted copy needs this. ONLY at organizations that also hold an
-- org-owned founding_administrator role: those are the copies the platform's
-- designation minted or reconciled (presby_apply_founding_administrator).
-- A copy a tenant adopted on its own is NOT touched: a migration that adds
-- authority to a tenant-adopted role would be the platform granting
-- ecclesiastical authority (0052 note 5). The discriminator is the role key,
-- never a grant_reason prefix (the 2026-10-22 purge's lesson).
-- Residual, as 0057: this re-adds a key a tenant removed from a
-- designation-minted copy. app_role_permissions_giving_guard ignores
-- non-giving keys.
insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('roll.propose'), ('directory.view')) as k(key)
 where r.organization_id is not null
   and r.key = 'congregation_stated_clerk'
   and exists (select 1 from app_roles fa
                where fa.organization_id = r.organization_id
                  and fa.key = 'founding_administrator')
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. F173 repair, then the approved-violator stop
-- ---------------------------------------------------------------------------
-- (a) createPerson() wrote pending rows with no resulting_roll and no
-- age_at_action, so presby_sync_current_roll would write current_roll = null
-- on approval and every profession of faith read as "18 and older"
-- (coalesce(age_at_action, 99)). Pending rows are mutable working state
-- (roll_actions_freeze allows the update), so repair them. Measured 0 such
-- rows on the pipeline branch and 0 roll rows in production: proven with
-- fixtures (src/lib/db/domain/participant-roll.db.test.ts).
-- The mapping is src/lib/roll-action-kinds.ts ROLL_ACTION_KIND_TO_ROLL; the
-- same CASE appears in section 5's CHECK, and a DB test pins all three equal.
update roll_actions ra
   set resulting_roll = case ra.kind
         when 'profession_of_faith' then 'active'
         when 'reaffirmation' then 'active'
         when 'restoration' then 'active'
         when 'certificate_received' then 'active'
         when 'other_gain' then 'active'
         when 'baptized_member_enrolled' then 'baptized'
         when 'affiliate_received' then 'affiliate'
         when 'other_participant_enrolled' then 'other_participant'
       end,
       age_at_action = coalesce(
         ra.age_at_action,
         (select date_part('year', age(ra.effective_date, pe.date_of_birth))::int
            from people pe
           where pe.id = ra.person_id and pe.date_of_birth is not null))
 where ra.approval_status = 'pending'
   and ra.resulting_roll is null
   and ra.kind in ('profession_of_faith', 'reaffirmation', 'restoration',
                   'certificate_received', 'other_gain', 'baptized_member_enrolled',
                   'affiliate_received', 'other_participant_enrolled');

-- (b) An APPROVED row that disagrees with the mapping cannot be updated (it
-- is frozen) and needs a void and a re-record by a human. Stop here, naming
-- the count, rather than adding a NOT VALID constraint over bad history.
-- Measured 0 on the pipeline branch and 0 rows in production.
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
    from roll_actions ra
   where ra.approval_status = 'approved'
     and ra.kind <> 'opening_balance'
     and ra.resulting_roll is distinct from case ra.kind
           when 'profession_of_faith' then 'active'
           when 'reaffirmation' then 'active'
           when 'restoration' then 'active'
           when 'certificate_received' then 'active'
           when 'other_gain' then 'active'
           when 'baptized_member_enrolled' then 'baptized'
           when 'affiliate_received' then 'affiliate'
           when 'other_participant_enrolled' then 'other_participant'
           else null end;
  if v_bad > 0 then
    raise exception
      '0061: % approved roll_actions row(s) carry a resulting_roll that disagrees with their kind; each needs a void and a re-record before this migration can apply',
      v_bad
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. constraints (S2, S3), drop-then-add so replay is clean
-- ---------------------------------------------------------------------------
-- Validated, not NOT VALID: measured 0 violators of each on the branch, 0 rows
-- in production. Together they make F173 hold for every future writer.
alter table roll_actions drop constraint if exists roll_actions_resulting_roll_matches_kind;
alter table roll_actions add constraint roll_actions_resulting_roll_matches_kind check (
  kind = 'opening_balance'
  or resulting_roll is not distinct from case kind
       when 'profession_of_faith' then 'active'
       when 'reaffirmation' then 'active'
       when 'restoration' then 'active'
       when 'certificate_received' then 'active'
       when 'other_gain' then 'active'
       when 'baptized_member_enrolled' then 'baptized'
       when 'affiliate_received' then 'affiliate'
       when 'other_participant_enrolled' then 'other_participant'
       else null end);

alter table roll_actions drop constraint if exists roll_actions_void_shape;
alter table roll_actions add constraint roll_actions_void_shape
  check ((kind = 'void') = (voids_action_id is not null));

alter table roll_actions drop constraint if exists roll_actions_approval_status_allowed;
alter table roll_actions add constraint roll_actions_approval_status_allowed
  check (approval_status in ('pending', 'approved', 'denied'));

-- One live void per action. A denied void does not block a later one; a
-- pending void does (it is live working state).
create unique index if not exists roll_actions_one_live_void_idx
  on roll_actions (voids_action_id)
  where kind = 'void' and approval_status <> 'denied';

-- ---------------------------------------------------------------------------
-- 6. restrictive insert policy (R5)
-- ---------------------------------------------------------------------------
-- Restrictive policies AND with the permissive tenant_isolation policy, so a
-- presby_app INSERT must satisfy both: the right organization AND pending.
-- "Approved at insert" is therefore reachable only through the definer
-- functions below (owner neondb_owner, rolbypassrls) or the owner itself
-- (fixtures, scripts/seed-dev.sql). The approval UPDATE stays
-- application-gated on roll.approve (Increment 2 owns closing it).
-- presby_platform cannot log in (rolcanlogin = false, measured), so targeting
-- presby_app alone is sufficient today.
drop policy if exists roll_actions_insert_pending_only on roll_actions;
create policy roll_actions_insert_pending_only on roll_actions
  as restrictive
  for insert
  to presby_app
  with check (approval_status = 'pending');

-- ---------------------------------------------------------------------------
-- 7. functions
-- ---------------------------------------------------------------------------

-- 7a. The ONE uniform identity-refusal literal (the 0052 shape). Invoker, no
-- search_path pin (it touches no table). presby_app keeps execute so a
-- non-owner caller sees this literal and never a second "permission denied
-- for function" string.
create or replace function presby_deny_participant_action()
returns void language plpgsql
as $$
begin
  raise exception 'roll_actions: this participant action is not permitted'
    using errcode = 'insufficient_privilege';
end $$;
revoke all on function presby_deny_participant_action() from public;
grant execute on function presby_deny_participant_action() to presby_app;

-- 7b. The bounded actor claim (R3): p_user_id is a users.id bound server-side
-- from the session. The user's live, unmerged person must be an active member
-- holding roll.propose at p_org. people.user_id is not unique, hence exists.
-- Same body shape as presby_giving__actor_may_record (drizzle/0055). Called
-- only from the definer functions below: no grant.
create or replace function presby_participant__actor_may_propose(p_org uuid, p_user_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from people pe
     where pe.user_id = p_user_id and pe.merged_into_id is null
       and presby_membership_is_active(pe.id, p_org)
       and presby_has_permission(pe.id, p_org, 'roll.propose'));
$$;
revoke all on function presby_participant__actor_may_propose(uuid, uuid) from public;

-- 7c. Record an on-record participant action (enrolment or removal).
-- Returns exactly ONE row. Identity refusals raise the uniform literal; state
-- refusals are returned as outcomes (closed list, pinned to the TypeScript
-- PARTICIPANT_RECORD_REFUSALS by a source-scan test):
--   ok, invalid_kind, date_out_of_range, person_not_found, person_deceased,
--   membership_ended, pending_action, already_participant, on_member_roll,
--   not_participant, date_before_latest_action, holds_position, self_target,
--   provisioning_incomplete
create or replace function presby_record_participant_action(
  p_person_id uuid,
  p_kind roll_action_kind,
  p_effective_date date,
  p_minute_reference text,
  p_recorded_by uuid)
returns table (outcome text, roll_action_id uuid, membership_ended boolean,
               affects_filed_period boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_m record;
  v_roll_today text;
  v_latest record;
  v_floor date;
  v_age integer;
  v_id uuid;
  v_outcome text;
begin
  outcome := null; roll_action_id := null;
  membership_ended := false; affects_filed_period := false;

  -- Identity (uniform literal, reveals nothing).
  if v_org is null or p_recorded_by is null
     or not presby_participant__actor_may_propose(v_org, p_recorded_by) then
    perform presby_deny_participant_action();
  end if;

  -- R4: the kind alone decides. Anything else goes down the pending path in
  -- TypeScript; this function refuses it.
  if p_kind is null or p_kind not in ('other_participant_enrolled', 'other_participant_removed') then
    outcome := 'invalid_kind'; return next; return;
  end if;

  -- R11 static bounds. current_date is the same UTC date the roll sync trigger
  -- uses, so nothing written here is ever future-dated and
  -- presby_roll_cache_drift() stays clean.
  if p_effective_date is null or p_effective_date > current_date
     or p_effective_date < date '1900-01-01' then
    outcome := 'date_out_of_range'; return next; return;
  end if;

  -- R6: lock the person's membership row. Serializes enrol, remove and void
  -- for one person at this organization.
  select m.id as membership_id, m.ended_on, pe.user_id, pe.date_of_birth,
         pe.birth_year_only, pe.date_of_death, pe.merged_into_id
    into v_m
    from memberships m
    join people pe on pe.id = m.person_id
   where m.person_id = p_person_id and m.organization_id = v_org
     for update of m;
  if not found or v_m.merged_into_id is not null then
    outcome := 'person_not_found'; return next; return;
  end if;

  if p_kind = 'other_participant_removed'
     and v_m.user_id is not null and v_m.user_id = p_recorded_by then
    outcome := 'self_target'; return next; return;
  end if;

  if v_m.date_of_death is not null then
    outcome := 'person_deceased'; return next; return;
  end if;

  if v_m.ended_on is not null then
    outcome := 'membership_ended'; return next; return;
  end if;

  -- A pending action would shadow (or be shadowed by) the new row (R9, R11).
  if exists (select 1 from roll_actions ra
              where ra.person_id = p_person_id and ra.organization_id = v_org
                and ra.approval_status = 'pending') then
    outcome := 'pending_action'; return next; return;
  end if;

  v_roll_today := presby_roll_as_of(p_person_id, v_org, current_date);

  -- The person's latest effective action (any date), the replay order.
  select ra.id, ra.kind, ra.effective_date
    into v_latest
    from presby_effective_roll_actions ra
   where ra.person_id = p_person_id and ra.organization_id = v_org
   order by ra.effective_date desc, ra.recorded_at desc
   limit 1;

  if p_kind = 'other_participant_enrolled' then
    if v_roll_today = 'other_participant' then
      outcome := 'already_participant'; return next; return;
    end if;
    if v_roll_today in ('active', 'baptized', 'affiliate') then
      -- That would be an active-roll loss with no Session act and no SASR
      -- loss line.
      outcome := 'on_member_roll'; return next; return;
    end if;
    -- Birth-date floor (a year-only birth date floors at 1 January).
    if v_m.date_of_birth is not null then
      v_floor := case when v_m.birth_year_only
                      then date_trunc('year', v_m.date_of_birth)::date
                      else v_m.date_of_birth end;
      if p_effective_date < v_floor then
        outcome := 'date_out_of_range'; return next; return;
      end if;
    end if;
    if v_latest.id is not null and p_effective_date < v_latest.effective_date then
      outcome := 'date_before_latest_action'; return next; return;
    end if;
  else
    -- Removal: the latest effective action must be an enrolment dated on or
    -- before today, and the replay as of today must agree.
    if v_latest.id is null or v_latest.kind <> 'other_participant_enrolled'
       or v_latest.effective_date > current_date
       or v_roll_today is distinct from 'other_participant' then
      outcome := 'not_participant'; return next; return;
    end if;
    if p_effective_date < v_latest.effective_date then
      outcome := 'date_before_latest_action'; return next; return;
    end if;
    -- S5: staff_positions has no needs-membership guard; ending the
    -- membership would orphan the position.
    if exists (select 1 from staff_positions sp
                where sp.person_id = p_person_id and sp.organization_id = v_org
                  and (sp.ends_on is null or sp.ends_on > p_effective_date)) then
      outcome := 'holds_position'; return next; return;
    end if;
  end if;

  if v_m.date_of_birth is not null then
    v_age := date_part('year', age(p_effective_date, v_m.date_of_birth))::int;
  end if;

  -- The writes. Each sub-block is a savepoint, so a refusal caught here
  -- leaves nothing behind.
  begin
    if p_kind = 'other_participant_removed' then
      -- F19 for this kind: the function ends the membership. Never
      -- future-dated (ended_on is null is the sole "current" predicate,
      -- DECISION-065). memberships_guard_end refuses when an officer term or a
      -- person-arm role grant is still open; caught as holds_position. A term
      -- is NEVER auto-ended (that guard's own hint).
      begin
        update memberships
           set ended_on = p_effective_date,
               ended_reason = 'other_participant_removed',
               updated_at = now()
         where id = v_m.membership_id;
      exception when check_violation then
        v_outcome := 'holds_position';
      end;
    end if;

    if v_outcome is null then
      insert into roll_actions
        (organization_id, person_id, kind, effective_date, resulting_roll,
         age_at_action, approval_status, minute_reference, approved_on,
         approved_by, proposed_by, recorded_at)
      values
        (v_org, p_person_id, p_kind, p_effective_date,
         case when p_kind = 'other_participant_enrolled' then 'other_participant' end,
         v_age, 'approved', nullif(btrim(p_minute_reference), ''), current_date,
         p_recorded_by, p_recorded_by,
         -- clock_timestamp(), not now(): replay breaks ties on recorded_at,
         -- and now() is constant inside a transaction.
         clock_timestamp())
      returning id into v_id;
    end if;
  exception when foreign_key_violation then
    -- S4: every approved insert fires presby_sync_current_roll, which updates
    -- memberships, which fires memberships_sync_derived_group; an
    -- organization with no active_membership group raises there (F16).
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
  roll_action_id := v_id;
  membership_ended := (p_kind = 'other_participant_removed');
  -- R12: a live filed return for a year on or after the pivot.
  affects_filed_period := exists (
    select 1 from publications pb
      join statistical_returns sr
        on sr.id = pb.artifact_id and sr.organization_id = pb.organization_id
     where pb.organization_id = v_org and pb.record_class = 'statistical_return'
       and pb.withdrawn_at is null
       and sr.report_year >= extract(year from p_effective_date)::int);
  return next; return;
end $$;
revoke all on function presby_record_participant_action(uuid, roll_action_kind, date, text, uuid) from public;
grant execute on function presby_record_participant_action(uuid, roll_action_kind, date, text, uuid) to presby_app;

-- 7d. Undo (void) an on-record participant action (F175, R10).
-- Returns exactly ONE row. Outcomes (closed list, pinned to the TypeScript
-- PARTICIPANT_VOID_REFUSALS by a source-scan test):
--   ok, reason_required, reason_too_long, action_not_found,
--   not_on_record_kind, already_voided, not_latest_action,
--   membership_changed, provisioning_incomplete
create or replace function presby_void_participant_action(
  p_roll_action_id uuid,
  p_reason text,
  p_recorded_by uuid)
returns table (outcome text, void_roll_action_id uuid, voided_action_id uuid,
               voided_kind text, membership_reopened boolean,
               affects_filed_period boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_t record;
  v_m record;
  v_latest_id uuid;
  v_id uuid;
  v_reopen boolean := false;
  v_outcome text;
begin
  outcome := null; void_roll_action_id := null; voided_action_id := null;
  voided_kind := null; membership_reopened := false; affects_filed_period := false;

  if v_org is null or p_recorded_by is null
     or not presby_participant__actor_may_propose(v_org, p_recorded_by) then
    perform presby_deny_participant_action();
  end if;

  if v_reason = '' then
    outcome := 'reason_required'; return next; return;
  end if;
  if length(v_reason) > 500 then
    outcome := 'reason_too_long'; return next; return;
  end if;

  select ra.id, ra.person_id, ra.kind, ra.effective_date, ra.approval_status
    into v_t
    from roll_actions ra
   where ra.id = p_roll_action_id and ra.organization_id = v_org;
  if not found then
    outcome := 'action_not_found'; return next; return;
  end if;

  if v_t.approval_status <> 'approved' or v_t.kind = 'void'
     or v_t.kind not in ('other_participant_enrolled', 'other_participant_removed') then
    outcome := 'not_on_record_kind'; return next; return;
  end if;

  if exists (select 1 from roll_actions v
              where v.voids_action_id = v_t.id and v.organization_id = v_org
                and v.approval_status = 'approved') then
    outcome := 'already_voided'; return next; return;
  end if;

  -- R6: lock the person, then re-evaluate under the lock (a concurrent undo
  -- or record may have committed while this call waited).
  select m.id as membership_id, m.ended_on, m.ended_reason
    into v_m
    from memberships m
   where m.person_id = v_t.person_id and m.organization_id = v_org
     for update;

  if exists (select 1 from roll_actions v
              where v.voids_action_id = v_t.id and v.organization_id = v_org
                and v.approval_status = 'approved') then
    outcome := 'already_voided'; return next; return;
  end if;

  select ra.id into v_latest_id
    from presby_effective_roll_actions ra
   where ra.person_id = v_t.person_id and ra.organization_id = v_org
   order by ra.effective_date desc, ra.recorded_at desc
   limit 1;
  if v_latest_id is distinct from v_t.id then
    outcome := 'not_latest_action'; return next; return;
  end if;

  if v_t.kind = 'other_participant_removed' then
    -- Reopen only on the removal's own marker and date.
    if v_m.ended_on is distinct from v_t.effective_date
       or v_m.ended_reason is distinct from 'other_participant_removed' then
      outcome := 'membership_changed'; return next; return;
    end if;
    v_reopen := true;
  end if;

  begin
    if v_reopen then
      -- memberships_guard_end does not fire on a transition to null; the
      -- derived-group sync re-opens the group row.
      update memberships
         set ended_on = null, ended_reason = null, updated_at = now()
       where id = v_m.membership_id;
    end if;

    insert into roll_actions
      (organization_id, person_id, kind, effective_date, resulting_roll,
       age_at_action, approval_status, approved_on, approved_by, proposed_by,
       voids_action_id, recorded_at)
    values
      -- person_id = the target's: roll_actions_voids_fk is only
      -- (voids_action_id, organization_id), and a mismatch would make
      -- presby_sync_current_roll recompute the wrong person.
      (v_org, v_t.person_id, 'void', current_date, null,
       null, 'approved', current_date, p_recorded_by, p_recorded_by,
       v_t.id, clock_timestamp())
    returning id into v_id;
  exception
    when foreign_key_violation then
      if sqlerrm like '%has no derived group active_membership%' then
        v_outcome := 'provisioning_incomplete';
      else
        raise;
      end if;
    when unique_violation then
      -- roll_actions_one_live_void_idx: a live (pending or approved) void
      -- already references this action.
      v_outcome := 'already_voided';
  end;

  if v_outcome is not null then
    outcome := v_outcome; return next; return;
  end if;

  outcome := 'ok';
  void_roll_action_id := v_id;
  voided_action_id := v_t.id;
  voided_kind := v_t.kind::text;
  membership_reopened := v_reopen;
  affects_filed_period := exists (
    select 1 from publications pb
      join statistical_returns sr
        on sr.id = pb.artifact_id and sr.organization_id = pb.organization_id
     where pb.organization_id = v_org and pb.record_class = 'statistical_return'
       and pb.withdrawn_at is null
       and sr.report_year >= extract(year from v_t.effective_date)::int);
  return next; return;
end $$;
revoke all on function presby_void_participant_action(uuid, text, uuid) from public;
grant execute on function presby_void_participant_action(uuid, text, uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 8. comments
-- ---------------------------------------------------------------------------
comment on function presby_deny_participant_action() is
  'The ONE uniform identity-refusal literal for the participant roll functions (drizzle/0061, the 0052 shape): raises ''roll_actions: this participant action is not permitted'' with insufficient_privilege. presby_app keeps execute so a non-owner caller never sees a second "permission denied for function" string.';

comment on function presby_participant__actor_may_propose(uuid, uuid) is
  'Bounded actor claim for drizzle/0061 (R3): p_user_id is a users.id bound server-side from the session; true when that user''s live, unmerged person is an active member of p_org holding roll.propose. people.user_id is not unique, hence exists. Owner-only: called from the definer functions, no grant.';

comment on function presby_record_participant_action(uuid, roll_action_kind, date, text, uuid) is
  'Records an other-participant enrolment or removal that takes effect on record, with no Session approval (DECISION-198). Organization from presby_current_org() (no parameter); p_recorded_by is a bounded users.id claim checked for roll.propose in the caller''s own transaction. Identity refusals raise one literal; state refusals return a closed outcome list. Removal ends the membership (ended_reason = ''other_participant_removed'') under memberships_guard_end and never ends a term. Dates: not after current_date, not before 1900-01-01 or the birth date, never before the person''s latest effective action. Returns exactly one row. Writes no audit row: src/lib/roll.ts writes it in the same transaction (R8).';

comment on function presby_void_participant_action(uuid, text, uuid) is
  'Undoes an on-record participant action by recording a void (F175, DECISION-198): only the person''s latest effective action, only of an on-record kind, one live void per action. The void row carries the target''s person_id. Voiding a removal reopens the membership only when ended_on and ended_reason still match the removal''s own. The reason is required (1-500 characters) and is stored in the audit row by src/lib/roll.ts, not on roll_actions. Returns exactly one row.';

comment on policy roll_actions_insert_pending_only on roll_actions is
  'R5 (drizzle/0061): restrictive, so it ANDs with tenant_isolation. presby_app may insert only pending rows; an approved-at-insert row is reachable only through presby_record_participant_action / presby_void_participant_action (owner, rolbypassrls) or the owner itself. The approval UPDATE stays application-gated on roll.approve (Increment 2).';

comment on constraint roll_actions_resulting_roll_matches_kind on roll_actions is
  'F173 as a database property (drizzle/0061): resulting_roll equals the kind''s mapping (src/lib/roll-action-kinds.ts ROLL_ACTION_KIND_TO_ROLL); opening_balance is caller-supplied and exempt.';

comment on constraint roll_actions_void_shape on roll_actions is
  'drizzle/0061: a void, and only a void, cites voids_action_id.';

comment on constraint roll_actions_approval_status_allowed on roll_actions is
  'drizzle/0061: approval_status is pending, approved or denied.';

comment on index roll_actions_one_live_void_idx is
  'S3 (drizzle/0061): one live (pending or approved) void per action; a denied void does not block a later one. Makes "already voided" a database property and settles a double-submit race to one winner.';

comment on column memberships.ended_reason is
  'Free text. The value ''other_participant_removed'' is a fixed marker written only by presby_record_participant_action (drizzle/0061) and read by presby_void_participant_action to decide whether an undo may reopen the membership; src/lib/roll-action-kinds.ts exports it as PARTICIPANT_REMOVAL_ENDED_REASON.';
