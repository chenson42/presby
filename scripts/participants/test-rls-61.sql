-- ---------------------------------------------------------------------------
-- 61. Participant roll on record (drizzle/0061_presby_participant_roll.sql;
--     DECISION-198/199, F173-F175; docs/work-log/2026-10-22-founding-admin-
--     directory.md Phase 3 "Staged assets").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner:
--
--         \ir participants/test-rls-61.sql
--
--     and the orchestrator applies scripts/participants/test-rls.sql.integration.patch
--     (the existing assertions 0061 changes: section 20d, the clerk template
--     count, the 44a office copy and the F118 roll-key split).
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/participants/test-rls-61.sql
--
--     after scripts/install-test-helpers.sql (owner) and scripts/seed-dev.sql.
--     No seed change is needed: it uses Alder Creek's existing fixture (the
--     clerk Tobias Renwick holds roll.propose through stated_clerk; Rowan
--     Thistlewood has no roll and one open role grant). Every block that
--     writes ends in rollback, so it writes nothing durable.
--
--     What presby_app CANNOT reach (every outcome of both functions, the
--     owner-path constraints, the migration's own sections against fixtures,
--     concurrency) is proven on the owner connection in Vitest:
--     src/lib/db/domain/participant-roll.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P61_ALDER      '\'22222222-2222-2222-2222-222222222222\''
\set P61_BRAMBLE    '\'33333333-3333-3333-3333-333333333333\''
\set P61_CLERKUSER  '\'e0000000-0000-0000-0000-0000000000f3\''
\set P61_ELDERUSER  '\'e0000000-0000-0000-0000-0000000000f2\''
\set P61_ROWAN      '\'c0000000-0000-0000-0000-000000000006\''
\set P61_DESMOND    '\'c0000000-0000-0000-0000-000000000004\''
\set P61_ELDER      '\'c0000000-0000-0000-0000-000000000001\''

\echo '======================================================'
\echo ' Section 61 (participant roll on record, drizzle/0061) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '61: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: FORCE RLS, the restrictive policy, the constraints, the
--     function surface and its grants.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'roll_actions' and relrowsecurity and relforcerowsecurity),
    1, '61a: roll_actions has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'roll_actions' and policyname = 'roll_actions_insert_pending_only'
        and permissive = 'RESTRICTIVE' and cmd = 'INSERT' and roles = '{presby_app}'
        -- drizzle/0063 narrows the same policy to pending AND an approvable
        -- kind (F191; exact text pinned in section 62a). 0061's half holds in
        -- both states.
        and with_check like '%(approval_status = ''pending''::text)%'),
    1, '61a (R5): roll_actions_insert_pending_only is RESTRICTIVE, FOR INSERT, TO presby_app, WITH CHECK requires approval_status = pending');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'roll_actions'),
    2, '61a: and the only other policy is tenant_isolation');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'roll_actions'::regclass and contype = 'c' and convalidated
        and conname in ('roll_actions_resulting_roll_matches_kind', 'roll_actions_void_shape',
                        'roll_actions_approval_status_allowed')),
    3, '61a (S2): the three CHECKs exist and are VALIDATED (F173 is a database property)');
  select assert_eq(
    (select count(*) from pg_indexes where indexname = 'roll_actions_one_live_void_idx'
        and indexdef like 'CREATE UNIQUE INDEX%'),
    1, '61a (S3): one live void per action, a unique partial index');
  select assert_eq(
    (select count(*) from pg_proc where prosecdef
        and proname in ('presby_record_participant_action', 'presby_void_participant_action')
        and array_to_string(proconfig, ',') = 'search_path=public, pg_temp'),
    2, '61a (R1): both writers are SECURITY DEFINER with search_path pinned, pg_temp last');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_record_participant_action', 'presby_void_participant_action')
        and has_function_privilege('presby_app', p.oid, 'execute')
        and not has_function_privilege('presby_platform', p.oid, 'execute')),
    2, '61a (R1): execute is granted to presby_app only');
  select assert_eq(
    (select count(*) from pg_proc p where p.proname = 'presby_participant__actor_may_propose'
        and not has_function_privilege('presby_app', p.oid, 'execute')),
    1, '61a (R3): the actor helper is owner-only - presby_app cannot probe who holds roll.propose');
rollback;

-- The actor helper refuses presby_app outright (a probe for "who may propose").
begin;
  do $$
  begin
    perform presby_participant__actor_may_propose('22222222-2222-2222-2222-222222222222',
                                                  'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 61a - presby_app executed the owner-only actor helper';
  exception when insufficient_privilege then
    raise notice 'pass  61a: presby_app cannot execute presby_participant__actor_may_propose';
  end $$;
rollback;

-- ===========================================================================
-- (b) R5: presby_app may insert only PENDING roll rows.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P61_ALDER, true);
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000006',
            'other_participant_enrolled', '2025-01-01', 'other_participant', 'approved');
    raise exception 'FAIL 61b - presby_app inserted an APPROVED roll row directly';
  exception when insufficient_privilege then
    raise notice 'pass  61b (R5): presby_app cannot insert an approved roll row - approved-at-insert is function-mediated';
  end $$;
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000006',
            'other_participant_enrolled', '2025-01-01', 'other_participant', 'denied');
    raise exception 'FAIL 61b - presby_app inserted a DENIED roll row directly';
  exception when insufficient_privilege then
    raise notice 'pass  61b (R5): nor a denied one - pending only';
  end $$;
  -- A gain kind: drizzle/0063 refuses a pending participant enrolment at
  -- insert (F191; section 62b), and participants are on record anyway.
  insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
  values (:P61_ALDER, :P61_ROWAN, 'profession_of_faith', '2025-01-01', 'active', 'pending');
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P61_ROWAN and approval_status = 'pending'),
    1, '61b (R5): a PENDING insert still succeeds (positive control - the policy is not a blanket refusal)');
  -- F173 at the tenant connection: a pending row with a null resulting_roll
  -- for a mapped kind is refused by the CHECK (createPerson()'s old shape).
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000006',
            'profession_of_faith', '2025-01-01', 'pending');
    raise exception 'FAIL 61b - a pending profession_of_faith with a null resulting_roll was accepted (F173)';
  exception when check_violation then
    raise notice 'pass  61b (F173): a null resulting_roll for a mapped kind is refused by roll_actions_resulting_roll_matches_kind';
  end $$;
rollback;

-- ===========================================================================
-- (c) Identity refusals: ONE literal, insufficient_privilege, nothing written.
-- ===========================================================================
begin;
  -- No org context.
  do $$
  begin
    perform * from presby_record_participant_action('c0000000-0000-0000-0000-000000000006',
      'other_participant_enrolled', '2025-01-01', null, 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 61c - recorded with no organization context';
  exception when insufficient_privilege then
    if sqlerrm <> 'roll_actions: this participant action is not permitted' then
      raise exception 'FAIL 61c - wrong literal: %', sqlerrm;
    end if;
    raise notice 'pass  61c (R2): no organization context is refused with the uniform literal';
  end $$;

  select set_config('app.current_org_id', :P61_ALDER, true);
  -- A member WITHOUT roll.propose (the elder).
  do $$
  begin
    perform * from presby_record_participant_action('c0000000-0000-0000-0000-000000000006',
      'other_participant_enrolled', '2025-01-01', null, 'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 61c - a member without roll.propose recorded a participant';
  exception when insufficient_privilege then
    if sqlerrm <> 'roll_actions: this participant action is not permitted' then
      raise exception 'FAIL 61c - wrong literal: %', sqlerrm;
    end if;
    raise notice 'pass  61c (R3): an actor without roll.propose is refused with the same literal';
  end $$;
  -- A null actor.
  do $$
  begin
    perform * from presby_record_participant_action('c0000000-0000-0000-0000-000000000006',
      'other_participant_enrolled', '2025-01-01', null, null);
    raise exception 'FAIL 61c - recorded with a null actor';
  exception when insufficient_privilege then
    raise notice 'pass  61c (R3): a null actor is refused';
  end $$;
  -- The void function, same literal.
  do $$
  begin
    perform * from presby_void_participant_action('00000000-0000-4000-8000-000000000061', 'why',
      'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 61c - the void function accepted an actor without roll.propose';
  exception when insufficient_privilege then
    if sqlerrm <> 'roll_actions: this participant action is not permitted' then
      raise exception 'FAIL 61c - wrong literal: %', sqlerrm;
    end if;
    raise notice 'pass  61c (R3): the void function refuses with the same literal, before looking anything up';
  end $$;

  -- The org is presby_current_org(), never the target's: Alder Creek's clerk
  -- under Bramblewood's context is not a member there, so is refused.
  select set_config('app.current_org_id', :P61_BRAMBLE, true);
  do $$
  begin
    perform * from presby_record_participant_action('c0000000-0000-0000-0000-000000000006',
      'other_participant_enrolled', '2025-01-01', null, 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 61c - an Alder Creek clerk recorded under Bramblewood''s context';
  exception when insufficient_privilege then
    raise notice 'pass  61c (R2): authority does not travel with the actor - another organization''s context refuses them';
  end $$;

  select set_config('app.current_org_id', :P61_ALDER, true);
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P61_ROWAN),
    0, '61c: none of the refusals above wrote a roll row');
rollback;

-- ===========================================================================
-- (d) The sanctioned path, end to end, as the clerk (rolled back).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P61_ALDER, true);
  create temp table p61_rec on commit drop as
    select * from presby_record_participant_action(:P61_ROWAN, 'other_participant_enrolled',
                                                   '2025-01-01', '  ', :P61_CLERKUSER);
  select assert_eq((select count(*) from p61_rec where outcome = 'ok' and roll_action_id is not null
                       and not membership_ended), 1,
    '61d: the clerk records a participant enrolment on record (outcome ok, one row)');
  select assert_eq(
    (select count(*) from roll_actions ra join p61_rec r on r.roll_action_id = ra.id
      where ra.approval_status = 'approved' and ra.kind = 'other_participant_enrolled'
        and ra.resulting_roll = 'other_participant' and ra.person_id = :P61_ROWAN
        and ra.organization_id = :P61_ALDER and ra.minute_reference is null
        and ra.approved_by = :P61_CLERKUSER and ra.proposed_by = :P61_CLERKUSER
        and ra.age_at_action = 55),
    1, '61d: the row is approved at insert with resulting_roll and age_at_action derived (F173), blank minute stored null');
  select assert_eq(
    (select count(*) from memberships where person_id = :P61_ROWAN and organization_id = :P61_ALDER
        and current_roll = 'other_participant' and current_roll_since = '2025-01-01'
        and engagement_status = 'regular'),
    1, '61d: the cache follows by the existing sync trigger; engagement (the pastoral axis) is untouched');

  -- State refusals are returned, not raised.
  select assert_eq(
    (select count(*) from presby_record_participant_action(:P61_ROWAN, 'other_participant_enrolled',
       '2025-02-01', null, :P61_CLERKUSER) where outcome = 'already_participant'),
    1, '61d: a second enrolment is already_participant');
  select assert_eq(
    (select count(*) from presby_record_participant_action(:P61_ELDER, 'other_participant_enrolled',
       '2025-02-01', null, :P61_CLERKUSER) where outcome = 'on_member_roll'),
    1, '61d: an active member cannot be enrolled as a participant on record (on_member_roll)');
  select assert_eq(
    (select count(*) from presby_record_participant_action(:P61_DESMOND, 'profession_of_faith',
       '2025-02-01', null, :P61_CLERKUSER) where outcome = 'invalid_kind'),
    1, '61d (R4): a membership-roll kind is refused by the function - it goes down the pending path');
  -- Rowan holds an open role grant at Alder Creek: memberships_guard_end
  -- refuses the end, the function reports holds_position, and ends nothing.
  select assert_eq(
    (select count(*) from presby_record_participant_action(:P61_ROWAN, 'other_participant_removed',
       current_date, null, :P61_CLERKUSER) where outcome = 'holds_position'),
    1, '61d (R9): removal of someone holding an open role grant is holds_position');
  select assert_eq(
    (select count(*) from memberships where person_id = :P61_ROWAN and organization_id = :P61_ALDER
        and ended_on is null),
    1, '61d (R9): and the membership is NOT ended - a term or grant is never auto-ended');
  select assert_eq(
    (select count(*) from role_grants where person_id = :P61_ROWAN and organization_id = :P61_ALDER
        and ends_on is null),
    1, '61d (R9): nor is the grant');

  -- Undo (F175): a void row for the same person, the cache recomputed.
  create temp table p61_void on commit drop as
    select v.* from p61_rec r,
      lateral presby_void_participant_action(r.roll_action_id, 'entered in error', :P61_CLERKUSER) v;
  select assert_eq((select count(*) from p61_void where outcome = 'ok' and not membership_reopened
                       and voided_kind = 'other_participant_enrolled'), 1,
    '61d (F175): the clerk undoes the enrolment');
  select assert_eq(
    (select count(*) from roll_actions ra join p61_void v on v.void_roll_action_id = ra.id
      where ra.kind = 'void' and ra.approval_status = 'approved' and ra.person_id = :P61_ROWAN
        and ra.voids_action_id = v.voided_action_id),
    1, '61d (R10): the void row carries the target''s person_id and cites it');
  select assert_eq(
    (select count(*) from memberships where person_id = :P61_ROWAN and organization_id = :P61_ALDER
        and current_roll is null),
    1, '61d: and the person is back to no roll');
  select assert_eq(
    (select count(*) from presby_void_participant_action(
       (select voided_action_id from p61_void), 'again', :P61_CLERKUSER) where outcome = 'already_voided'),
    1, '61d (S3): a second undo is already_voided');
  select assert_eq(
    (select count(*) from roll_actions ra join p61_rec r on r.roll_action_id = ra.id
      where ra.approval_status = 'approved'),
    1, '61d: the original entry stays in the record, approved and frozen');
rollback;

\echo '======================================================'
\echo ' Section 61 (participant roll on record) complete.'
\echo '======================================================'
