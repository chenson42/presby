-- ---------------------------------------------------------------------------
-- 62. Session approval, withdrawal and pastors as members of the Session
--     (drizzle/0062_presby_session_approval.sql and
--     drizzle/0063_presby_roll_decide_lockdown.sql; DECISION-202/203/205/206,
--     F180, F181, F184, F188, F189, F191; docs/work-log/2026-10-22-founding-
--     admin-directory.md, Increment 2 Phase 3 "Staged SQL suite").
--
--     INTEGRATION (Rule 16): apply scripts/session-approval/test-rls.sql.integration.patch
--     to scripts/test-rls.sql. It rewrites the existing assertions 0062/0063
--     change (section 5, section 20d) and appends ONE line at the end:
--
--         \ir session-approval/test-rls-62.sql
--
--     REQUIRES BOTH 0062 AND 0063 APPLIED (the lockdown state). Against the
--     0062-only state, section 62a's privilege and policy assertions fail by
--     design: they are what 0063 adds.
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/session-approval/test-rls-62.sql
--
--     after scripts/install-test-helpers.sql (owner) and scripts/seed-dev.sql.
--     No seed change is needed. It uses Alder Creek's existing fixture:
--       * Marguerite Ashcombe (elder.fixture) holds an open ruling_elder term,
--         so she is seated on the derived Session group, which carries the
--         fixture session_member role (roll.approve). She lacks roll.propose.
--       * Tobias Renwick (clerk.fixture) holds roll.propose through
--         stated_clerk (which also carries roll.approve: fixture drift F190;
--         this suite never relies on him lacking it).
--       * Desmond Okonkwo is an other participant with the seed's one pending
--         profession_of_faith.
--       * Rowan Thistlewood is the seeded installed pastor with no roll.
--       * Hallie Vandermeer is on the baptized roll and has nothing pending.
--     Every block that writes ends in rollback, so it writes nothing durable.
--
--     What presby_app CANNOT reach (the freeze trigger on the owner path,
--     every outcome against purpose-built fixtures, not_approvable_kind on a
--     legacy row, the backfill and group seed, concurrency) is proven on the
--     owner connection in Vitest: src/lib/db/domain/session-approval.db.test.ts
--     and src/lib/db/domain/roll-decide-lockdown.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P62_ALDER      '\'22222222-2222-2222-2222-222222222222\''
\set P62_BRAMBLE    '\'33333333-3333-3333-3333-333333333333\''
\set P62_CLERKUSER  '\'e0000000-0000-0000-0000-0000000000f3\''
\set P62_ELDERUSER  '\'e0000000-0000-0000-0000-0000000000f2\''
\set P62_ELDER      '\'c0000000-0000-0000-0000-000000000001\''
\set P62_DESMOND    '\'c0000000-0000-0000-0000-000000000004\''
\set P62_HALLIE     '\'c0000000-0000-0000-0000-000000000005\''
\set P62_ROWAN      '\'c0000000-0000-0000-0000-000000000006\''

\echo '======================================================'
\echo ' Section 62 (Session approval, drizzle/0062 + 0063) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '62: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: FORCE RLS, privileges, the narrowed policy, the CHECKs, the
--     function surface and its grants.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'roll_actions' and relrowsecurity and relforcerowsecurity),
    1, '62a: roll_actions has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from (values (1)) v
      where has_table_privilege('presby_app', 'roll_actions', 'SELECT')
        and has_table_privilege('presby_app', 'roll_actions', 'INSERT')),
    1, '62a (R16): presby_app keeps SELECT and INSERT on roll_actions (the pending proposal path)');
  select assert_eq(
    (select count(*) from (values (1)) v
      where has_table_privilege('presby_app', 'roll_actions', 'UPDATE')
         or has_table_privilege('presby_app', 'roll_actions', 'DELETE')),
    0, '62a (R16, 0063): presby_app holds NEITHER UPDATE NOR DELETE on roll_actions - leaving pending is function-mediated');
  select assert_eq(
    (select count(*) from (values (1)) v
      where has_table_privilege('presby_platform', 'roll_actions', 'UPDATE')
         or has_table_privilege('presby_platform', 'roll_actions', 'DELETE')),
    0, '62a (0063): presby_platform holds neither either (it cannot log in; the grant documents intent)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'roll_actions' and policyname = 'roll_actions_insert_pending_only'
        and permissive = 'RESTRICTIVE' and cmd = 'INSERT' and roles = '{presby_app}'
        and with_check = '((approval_status = ''pending''::text) AND (kind = ANY (ARRAY[''profession_of_faith''::roll_action_kind, ''reaffirmation''::roll_action_kind, ''restoration''::roll_action_kind, ''certificate_received''::roll_action_kind, ''other_gain''::roll_action_kind, ''baptized_member_enrolled''::roll_action_kind, ''affiliate_received''::roll_action_kind])))'),
    1, '62a (F191): the insert policy is RESTRICTIVE, FOR INSERT, TO presby_app: pending AND one of the seven approvable kinds');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'roll_actions'),
    2, '62a: and the only other policy is tenant_isolation');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'roll_actions'::regclass and contype = 'c' and convalidated
        and conname in ('roll_actions_approval_status_allowed', 'roll_actions_denial_reason_only_when_denied',
                        'roll_actions_withdrawal_reason_only_when_withdrawn', 'roll_actions_terminal_decision_stamps')),
    4, '62a (R5): the vocabulary, both reason CHECKs and the terminal-stamps CHECK exist and are VALIDATED');
  select assert_eq(
    (select count(*) from pg_constraint where conname = 'roll_actions_approval_status_allowed'
        and pg_get_constraintdef(oid) like '%''withdrawn''::text%'),
    1, '62a (operator Q3): withdrawn is its own status');
  select assert_eq(
    (select count(*) from pg_indexes where indexname = 'roll_actions_one_pending_per_person_idx'
        and indexdef like 'CREATE UNIQUE INDEX%(organization_id, person_id) WHERE (approval_status = ''pending''::text)'),
    1, '62a (R7): one pending proposal per person per organization, a unique partial index');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'officer_terms'::regclass and conname = 'officer_terms_office_allowed'
        and convalidated),
    1, '62a (F188): officer_terms_office_allowed exists and is VALIDATED');
  select assert_eq(
    (select count(*) from pg_proc where prosecdef
        and proname in ('presby_decide_roll_action', 'presby_withdraw_roll_action')
        and array_to_string(proconfig, ',') = 'search_path=public, pg_temp'),
    2, '62a (R1): both decision functions are SECURITY DEFINER with search_path pinned, pg_temp last');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_decide_roll_action', 'presby_withdraw_roll_action')
        and has_function_privilege('presby_app', p.oid, 'execute')
        and not has_function_privilege('presby_platform', p.oid, 'execute')),
    2, '62a (R1): execute is granted to presby_app only');
  select assert_eq(
    (select count(*) from pg_proc p where p.proname in ('presby_roll__actor_holds', 'presby_guard_pastor_no_roll')
        and not has_function_privilege('presby_app', p.oid, 'execute')),
    2, '62a (R1, S1): the actor helper and the pastor guard are owner-only');
rollback;

-- The actor helper refuses presby_app outright (a probe for "who holds roll.approve").
begin;
  do $$
  begin
    perform presby_roll__actor_holds('22222222-2222-2222-2222-222222222222',
                                     'e0000000-0000-0000-0000-0000000000f2', 'roll.approve');
    raise exception 'FAIL 62a - presby_app executed the owner-only actor helper';
  exception when insufficient_privilege then
    raise notice 'pass  62a: presby_app cannot execute presby_roll__actor_holds';
  end $$;
rollback;

-- ===========================================================================
-- (b) The narrowed insert policy (F191) and one pending per person (R7).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  do $$
  declare v_status text;
  begin
    foreach v_status in array array['approved', 'denied', 'withdrawn'] loop
      begin
        insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
        values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
                'other_gain', '2025-01-01', 'active', v_status);
        raise exception 'FAIL 62b - presby_app inserted a % roll row directly', v_status;
      exception when insufficient_privilege then
        raise notice 'pass  62b (R5): presby_app cannot insert a % roll row', v_status;
      end;
    end loop;
  end $$;
  -- F191: a pending row of a kind no definer will ever approve.
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
            'death', '2025-01-01', 'pending');
    raise exception 'FAIL 62b - presby_app inserted a pending LOSS row (F191)';
  exception when insufficient_privilege then
    raise notice 'pass  62b (F191): a pending loss kind is refused at insert';
  end $$;
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
            'other_participant_enrolled', '2025-01-01', 'other_participant', 'pending');
    raise exception 'FAIL 62b - presby_app inserted a pending other_participant_enrolled row (F191)';
  exception when insufficient_privilege then
    raise notice 'pass  62b (F191): a pending participant enrolment is refused at insert (participants are on record)';
  end $$;
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
            'opening_balance', '2025-01-01', 'active', 'pending');
    raise exception 'FAIL 62b - presby_app inserted a pending opening_balance row (F191)';
  exception when insufficient_privilege then
    raise notice 'pass  62b (F191): a pending opening balance is refused at insert';
  end $$;
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status, voids_action_id)
    select '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
           'void', '2025-01-01', 'pending', ra.id
      from roll_actions ra
     where ra.person_id = 'c0000000-0000-0000-0000-000000000005' and ra.approval_status = 'approved'
     limit 1;
    raise exception 'FAIL 62b - presby_app inserted a pending void (F191)';
  exception when insufficient_privilege then
    raise notice 'pass  62b (F191): a pending void is refused at insert';
  end $$;
  -- Positive control: a pending gain is allowed.
  insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
  values (:P62_ALDER, :P62_HALLIE, 'profession_of_faith', '2025-01-01', 'active', 'pending', :P62_CLERKUSER);
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P62_HALLIE and approval_status = 'pending'),
    1, '62b: a pending GAIN still succeeds (positive control - the policy is not a blanket refusal)');
  -- R7: a second pending row for the same person.
  do $$
  begin
    insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
            'reaffirmation', '2025-02-01', 'active', 'pending');
    raise exception 'FAIL 62b - a second pending roll action for one person was accepted (R7)';
  exception when unique_violation then
    raise notice 'pass  62b (R7): a second pending proposal for one person is refused by roll_actions_one_pending_per_person_idx';
  end $$;
rollback;

-- ===========================================================================
-- (c) Plain UPDATE and DELETE of a pending row are refused (0063): the only
--     way out of pending is a definer.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  do $$
  begin
    update roll_actions set approval_status = 'approved', approved_on = current_date
     where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending';
    raise exception 'FAIL 62c - presby_app approved a roll action by plain UPDATE (F180)';
  exception when insufficient_privilege then
    raise notice 'pass  62c (F180): presby_app cannot approve by plain UPDATE';
  end $$;
  do $$
  begin
    update roll_actions set denial_reason = 'editable'
     where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending';
    raise exception 'FAIL 62c - presby_app edited a pending roll action by plain UPDATE';
  exception when insufficient_privilege then
    raise notice 'pass  62c: presby_app cannot edit a pending row either';
  end $$;
  do $$
  begin
    delete from roll_actions
     where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending';
    raise exception 'FAIL 62c - presby_app deleted a roll action (all deletes are soft)';
  exception when insufficient_privilege then
    raise notice 'pass  62c (F176): presby_app cannot delete a roll action; withdrawal replaces deletion';
  end $$;
rollback;

-- ===========================================================================
-- (d) Identity refusals: ONE literal, insufficient_privilege, nothing written.
-- ===========================================================================
begin;
  -- No org context.
  do $$
  begin
    perform * from presby_decide_roll_action(
      (select id from roll_actions where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending'),
      'approve', null, null, 'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 62d - decided with no organization context';
  exception when insufficient_privilege then
    if sqlerrm <> 'roll_actions: this roll decision is not permitted' then
      raise exception 'FAIL 62d - wrong literal: %', sqlerrm;
    end if;
    raise notice 'pass  62d (R1): no organization context is refused with the uniform literal';
  end $$;

  select set_config('app.current_org_id', :P62_ALDER, true);
  -- A user with no person at this organization.
  do $$
  begin
    perform * from presby_decide_roll_action(
      (select id from roll_actions where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending'),
      'approve', null, null, '00000000-0000-4000-8000-000000000062');
    raise exception 'FAIL 62d - a user with no person here decided a roll action';
  exception when insufficient_privilege then
    if sqlerrm <> 'roll_actions: this roll decision is not permitted' then
      raise exception 'FAIL 62d - wrong literal: %', sqlerrm;
    end if;
    raise notice 'pass  62d (R1): a user without roll.approve here is refused with the same literal';
  end $$;
  -- A null actor.
  do $$
  begin
    perform * from presby_decide_roll_action(
      (select id from roll_actions where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending'),
      'deny', null, 'no', null);
    raise exception 'FAIL 62d - decided with a null actor';
  exception when insufficient_privilege then
    raise notice 'pass  62d (R1): a null actor is refused';
  end $$;
  -- Withdraw needs roll.propose: the elder (approve-only) is refused.
  do $$
  begin
    perform * from presby_withdraw_roll_action(
      (select id from roll_actions where person_id = 'c0000000-0000-0000-0000-000000000004' and approval_status = 'pending'),
      'why', 'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 62d - an elder without roll.propose withdrew a proposal';
  exception when insufficient_privilege then
    if sqlerrm <> 'roll_actions: this roll decision is not permitted' then
      raise exception 'FAIL 62d - wrong literal: %', sqlerrm;
    end if;
    raise notice 'pass  62d (R1): withdraw refuses an actor without roll.propose with the same literal';
  end $$;

  -- The org is presby_current_org(), never the row's: Alder Creek's elder
  -- under Bramblewood's context is not a member there, so is refused.
  select set_config('app.current_org_id', :P62_BRAMBLE, true);
  do $$
  begin
    perform * from presby_decide_roll_action('00000000-0000-4000-8000-000000000062', 'approve', null, null,
                                             'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 62d - an Alder Creek elder decided under Bramblewood''s context';
  exception when insufficient_privilege then
    raise notice 'pass  62d (R1): authority does not travel with the actor - another organization''s context refuses them';
  end $$;

  select set_config('app.current_org_id', :P62_ALDER, true);
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P62_DESMOND and approval_status = 'pending'),
    1, '62d: none of the refusals above moved the pending row');
rollback;

-- ===========================================================================
-- (e) The sanctioned path, end to end, as the seeded elder and clerk
--     (each block rolled back).
-- ===========================================================================
-- Approve: the elder approves Desmond's pending profession; the roll is
-- projected; a second approve is already_decided.
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  create temp table p62_target on commit drop as
    select id from roll_actions where person_id = :P62_DESMOND and approval_status = 'pending';
  create temp table p62_r on commit drop as
    select * from presby_decide_roll_action((select id from p62_target), 'approve', 'Session 2026-10', null, :P62_ELDERUSER);
  select assert_eq((select count(*) from p62_r), 1, '62e: the decide function returns exactly one row');
  select assert_eq((select count(*) from p62_r where outcome = 'ok' and subject_person_id = :P62_DESMOND
                       and action_kind = 'profession_of_faith' and not self_approved and not self_target),
                   1, '62e (R3): the elder approves the pending profession of faith');
  select assert_eq(
    (select count(*) from roll_actions ra join p62_target t on t.id = ra.id
      where ra.approval_status = 'approved' and ra.approved_by = :P62_ELDERUSER and ra.decided_by = :P62_ELDERUSER
        and ra.decided_at is not null and ra.minute_reference = 'Session 2026-10'),
    1, '62e (R5): approved_by, decided_by, decided_at and the minute reference are stamped');
  select assert_eq(
    (select count(*) from memberships where person_id = :P62_DESMOND and organization_id = :P62_ALDER and current_roll = 'active'),
    1, '62e: approval projects current_roll (participant to member)');
  select assert_eq(
    (select count(*) from presby_decide_roll_action((select id from p62_target), 'approve', null, null, :P62_ELDERUSER)
      where outcome = 'already_decided'),
    1, '62e (R2): a second approve is already_decided');
rollback;

-- Deny: the reason is required and stored; the row leaves pending.
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  select assert_eq(
    (select count(*) from presby_decide_roll_action(
        (select id from roll_actions where person_id = :P62_DESMOND and approval_status = 'pending'),
        'deny', null, '   ', :P62_ELDERUSER) where outcome = 'reason_required'),
    1, '62e (R4): a deny without a reason is reason_required');
  select assert_eq(
    (select count(*) from presby_decide_roll_action(
        (select id from roll_actions where person_id = :P62_DESMOND and approval_status = 'pending'),
        'deny', null, 'No Session minute yet.', :P62_ELDERUSER) where outcome = 'ok'),
    1, '62e: the elder denies with a reason');
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P62_DESMOND and approval_status = 'denied'
        and denial_reason = 'No Session minute yet.' and decided_by = :P62_ELDERUSER and approved_by is null),
    1, '62e (R5): the denial reason and decided_by are stored; approved_by stays null');
  select assert_eq(
    (select count(*) from memberships where person_id = :P62_DESMOND and organization_id = :P62_ALDER and current_roll = 'other_participant'),
    1, '62e: a denial leaves the roll untouched');
rollback;

-- Withdraw: the clerk withdraws; the person is released for a new proposal.
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  select assert_eq(
    (select count(*) from presby_withdraw_roll_action(
        (select id from roll_actions where person_id = :P62_DESMOND and approval_status = 'pending'),
        'Entered on the wrong person.', :P62_CLERKUSER) where outcome = 'ok'),
    1, '62e (Q3): the clerk withdraws the proposal');
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P62_DESMOND and approval_status = 'withdrawn'
        and withdrawal_reason = 'Entered on the wrong person.' and decided_by = :P62_CLERKUSER),
    1, '62e: withdrawal_reason and decided_by are stored');
  insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
  values (:P62_ALDER, :P62_DESMOND, 'profession_of_faith', '2026-09-20', 'active', 'pending', :P62_CLERKUSER);
  select assert_eq(
    (select count(*) from roll_actions where person_id = :P62_DESMOND and approval_status = 'pending'),
    1, '62e (R7): a withdrawn row releases the person - a new proposal is accepted');
  select assert_eq(
    (select count(*) from presby_effective_roll_actions where person_id = :P62_DESMOND and kind = 'profession_of_faith'),
    0, '62e: withdrawn and pending rows never enter the replay');
rollback;

-- already_on_roll (R6) and holds_pastoral_office (R12).
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
  values (:P62_ALDER, :P62_ELDER, 'reaffirmation', '2026-09-01', 'active', 'pending', :P62_CLERKUSER);
  select assert_eq(
    (select count(*) from presby_decide_roll_action(
        (select id from roll_actions where person_id = :P62_ELDER and approval_status = 'pending'),
        'approve', null, null, :P62_ELDERUSER) where outcome = 'already_on_roll'),
    1, '62e (R6, F181): a gain for someone already on that roll is already_on_roll - it would count twice');
  insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
  values (:P62_ALDER, :P62_ROWAN, 'profession_of_faith', '2026-09-01', 'active', 'pending', :P62_CLERKUSER);
  select assert_eq(
    (select count(*) from presby_decide_roll_action(
        (select id from roll_actions where person_id = :P62_ROWAN and approval_status = 'pending'),
        'approve', null, null, :P62_ELDERUSER) where outcome = 'holds_pastoral_office'),
    1, '62e (R12, DECISION-206): the installed pastor is not received onto the congregation''s roll');
rollback;

-- ===========================================================================
-- (f) Pastors as members of the Session (DECISION-206, F188, S1).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P62_ALDER, true);
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :P62_ROWAN and g.organization_id = :P62_ALDER and g.derived_from = 'session'
        and gm.source = 'derived' and gm.ends_on is null),
    1, '62f (DECISION-206): the seeded installed pastor is seated on Alder Creek''s derived Session group');
  select assert_eq(
    (select count(*) from groups where organization_id = :P62_ALDER and derived_from in ('session', 'diaconate')),
    2, '62f (F189): the congregation has its Session and Board of Deacons groups');
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, starts_on)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
            'installed_pastor', '2026-01-01');
    raise exception 'FAIL 62f - an open pastor term was recorded for a person on the roll (S1)';
  exception when check_violation then
    if sqlerrm not like 'officer_terms: an open pastor-office term cannot be recorded%' then
      raise exception 'FAIL 62f - wrong check: %', sqlerrm;
    end if;
    raise notice 'pass  62f (S1): an open pastor-office term is refused for a person on the roll';
  end $$;
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, starts_on)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
            'bishop', '2026-01-01');
    raise exception 'FAIL 62f - an office outside the vocabulary was accepted (F188)';
  exception when check_violation then
    raise notice 'pass  62f (F188): officer_terms_office_allowed refuses an office outside the vocabulary';
  end $$;
  select assert_eq(
    (select count(*) from app_roles r
      where r.organization_id is null
        and exists (select 1 from app_role_permissions p where p.role_id = r.id and p.permission_key = 'roll.approve')
        and exists (select 1 from app_role_permissions p where p.role_id = r.id and p.permission_key = 'roll.propose')),
    0, '62f (DECISION-202): no TEMPLATE role holds both roll keys');
rollback;

\echo '======================================================'
\echo ' Section 62 finished.'
\echo '======================================================'
