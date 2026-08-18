-- RLS isolation suite. MUST be run as presby_app, never as the owner.
--
-- That instruction is the whole point of F1: `neondb_owner` on this Neon
-- project has rolbypassrls = t, so every assertion below passes vacuously if
-- you run it as the owner. A suite that cannot fail proves nothing.
--
--   psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
--
-- Org ids come from scripts/seed-dev.sql:
--   111... Presbytery of the Northern Reach
--   222... Alder Creek        333... Bramblewood        444... Quillhaven (unmanaged)

\set ON_ERROR_STOP on
\set ALDER   '\'22222222-2222-2222-2222-222222222222\''
\set BRAMBLE '\'33333333-3333-3333-3333-333333333333\''
\set PRESBY  '\'11111111-1111-1111-1111-111111111111\''
\set PASTOR  '\'c0000000-0000-0000-0000-000000000006\''
\set ELDER   '\'c0000000-0000-0000-0000-000000000001\''

-- assert_eq() is installed by the owner (see scripts/install-test-helpers.sql);
-- presby_app only calls it.

-- ---------------------------------------------------------------------------
-- 1. Fail closed. An unset org context must return nothing, not everything.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq((select count(*) from memberships), 0, 'unset GUC: memberships invisible');
  select assert_eq((select count(*) from people),      0, 'unset GUC: people invisible');
  select assert_eq((select count(*) from roll_actions),0, 'unset GUC: roll_actions invisible');
commit;

-- ---------------------------------------------------------------------------
-- 2. Tenant isolation. Alder Creek sees its own rows and no others.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from memberships), 6, 'alder: sees own memberships');
  select assert_eq((select count(*) from memberships where organization_id <> :ALDER), 0,
                   'alder: sees NO foreign memberships');
  select assert_eq((select count(*) from officer_terms), 5, 'alder: sees own officer terms');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  -- Bramblewood was seeded with an org and a Session group but no people.
  select assert_eq((select count(*) from memberships), 0, 'bramblewood: sees no alder memberships');
  select assert_eq((select count(*) from people),      0, 'bramblewood: sees no alder people');
  select assert_eq((select count(*) from officer_terms),0,'bramblewood: sees no alder officer terms');
commit;

-- ---------------------------------------------------------------------------
-- 3. Global person tables are gated by membership, not by a column compare.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from people), 6, 'alder: sees people it holds memberships for');
  -- The pastor holds memberships at BOTH the presbytery and Alder Creek.
  select assert_eq((select count(*) from people where id = :PASTOR), 1, 'alder: sees its pastor');
commit;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  -- The presbytery holds ONLY the pastor. It must not see Alder Creek's roll,
  -- which is invariant 2: access flows up by publication, never by inheritance.
  select assert_eq((select count(*) from people), 1, 'presbytery: sees only its own member');
  select assert_eq((select count(*) from people where id = :ELDER), 0,
                   'presbytery: CANNOT see a congregation''s elder');
  select assert_eq((select count(*) from memberships), 1, 'presbytery: sees only its own membership');
  select assert_eq((select count(*) from roll_actions), 0,
                   'presbytery: CANNOT read a congregation''s roll actions');
commit;

-- ---------------------------------------------------------------------------
-- 4. F21. The visibility rule is "you hold a membership", so creating one must
--    not be a plain INSERT — otherwise any org self-grants by writing a row.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into memberships (organization_id, person_id, engagement_status)
    values ('33333333-3333-3333-3333-333333333333',
            'c0000000-0000-0000-0000-000000000001', 'visitor');
    raise exception 'FAIL F21 — unauthorized link succeeded; identity is enumerable';
  exception when insufficient_privilege then
    raise notice 'pass  F21: unauthorized link to an existing person rejected';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 5. Invariant 4. An approved roll action is immutable.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update roll_actions set effective_date = '1999-01-01' where approval_status = 'approved';
    raise exception 'FAIL invariant 4 — an approved roll action was mutated';
  exception when check_violation then
    raise notice 'pass  invariant 4: approved roll action frozen';
  end $$;
rollback;

-- Pending rows are working state and must stay editable.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  update roll_actions set denial_reason = 'test' where approval_status = 'pending';
  select assert_eq((select count(*) from roll_actions where denial_reason = 'test'), 1,
                   'pending roll action still editable');
rollback;

-- ---------------------------------------------------------------------------
-- 6. Invariant 5. The session roster is derived, not edited.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into group_memberships (organization_id, group_id, person_id, source)
    values ('22222222-2222-2222-2222-222222222222',
            'b0000000-0000-0000-0000-000000000001',
            'c0000000-0000-0000-0000-000000000004', 'managed');
    raise exception 'FAIL invariant 5 — someone was hand-added to the Session';
  exception when check_violation then
    raise notice 'pass  invariant 5: direct write to a derived group rejected';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 7. Constitutional constraints.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- Overlapping terms in the same office are a data error; gaps are not.
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
    values ('22222222-2222-2222-2222-222222222222',
            'c0000000-0000-0000-0000-000000000001', 'ruling_elder', '2025-01-01', '2026-01-01');
    raise exception 'FAIL — overlapping officer terms accepted';
  exception when exclusion_violation then
    raise notice 'pass  overlapping officer terms rejected';
  end $$;
rollback;

-- One ACTIVE roll per person, denomination-wide.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select set_config('app.person_claim_authorized', :ELDER, true);
  do $$
  begin
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    values ('33333333-3333-3333-3333-333333333333',
            'c0000000-0000-0000-0000-000000000001', 'regular', 'active');
    raise exception 'FAIL — a person holds two active-roll memberships';
  exception when unique_violation then
    raise notice 'pass  one active-roll membership per person enforced';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 8. Identity. Verified+unshared is unique; shared household emails are not.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from person_identifiers
      where value_normalized = 'renwick.house@example.invalid'),
    2, 'shared household email held by two people');

  do $$
  begin
    insert into person_identifiers (person_id, kind, value_normalized, is_verified, is_shared)
    values ('c0000000-0000-0000-0000-000000000004', 'email',
            'm.ashcombe@example.invalid', true, false);
    raise exception 'FAIL — a verified unshared identifier was duplicated';
  exception when unique_violation then
    raise notice 'pass  verified unshared identifier is globally unique';
  end $$;
rollback;

\echo ''
\echo '======================================================'
\echo ' RLS suite complete. Every assertion above must say'
\echo ' "pass" — and must have been run as presby_app.'
\echo '======================================================'
