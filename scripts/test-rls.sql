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
  -- The presbytery has roll actions of its OWN - a minister's membership sits
  -- there (G-2.0502). What it must never see is a congregation's.
  select assert_eq(
    (select count(*) from roll_actions where organization_id <> :PRESBY), 0,
    'presbytery: CANNOT read a congregation''s roll actions');
  select assert_eq((select count(*) from roll_actions), 1,
                   'presbytery: sees its own minister''s roll action');
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

-- Pending rows are working state and must stay editable. Creates its own row:
-- a test that depends on seed state breaks the moment anyone works with the
-- fixture by hand.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into roll_actions (organization_id, person_id, kind, effective_date,
                            resulting_roll, approval_status)
  values (:ALDER, :ELDER, 'other_gain', current_date, 'active', 'pending');
  -- Targets only the row this test created; the seed carries its own pending
  -- action and the assertion must not depend on how many exist.
  update roll_actions set denial_reason = 'editable'
   where approval_status = 'pending' and kind = 'other_gain';
  select assert_eq((select count(*) from roll_actions where denial_reason = 'editable'), 1,
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

-- ---------------------------------------------------------------------------
-- 9. The resolver. Four arms, provenance, and time.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);

  -- F3's whole point: a role granted to the DERIVED Session group must resolve.
  -- A view would be invisible to this join and the elder would get nothing.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:ELDER, :ALDER)
      where source_kind = 'group' and source_name = 'Session'),
    2, 'resolver: derived Session group grant resolves');

  -- The gap between her two terms. Term boundaries drop access on their own
  -- because the resolver reads dates, not row existence.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:ELDER, :ALDER, '2015-06-01')),
    0, 'resolver: no permissions during the gap between terms');

  -- F11: an administrative commission granted nothing until arm 3 existed.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:PASTOR, :ALDER)
      where source_kind = 'commission'),
    2, 'resolver: administrative commission grants inside the congregation');

  -- ...and stops the day it expires.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:PASTOR, :ALDER, '2027-06-01')),
    0, 'resolver: commission access lapses when the commission ends');

  -- Provenance is part of the answer, not an afterthought.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:ELDER, :ALDER)
      where source_name is null or role_name is null),
    0, 'resolver: every row carries provenance');

  -- Tiering is exposed so a caller can refuse tier 2/3 without a second lookup.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:ELDER, :ALDER)
      where sensitivity_tier > 1),
    0, 'resolver: a session member gets no tier 2 or 3 permission by default');
commit;

-- SECURITY DEFINER makes arms 3 and 4 work (F26's lesson), so it must not
-- become a fishing tool for another council's role structure.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    perform * from presby_effective_permissions(
      'c0000000-0000-0000-0000-000000000006',
      '33333333-3333-3333-3333-333333333333');
    raise exception 'FAIL — resolver answered for a foreign org';
  exception when insufficient_privilege then
    raise notice 'pass  resolver refuses to answer outside the current org context';
  end $$;
rollback;

\echo ''
\echo '======================================================'
\echo ' RLS suite complete. Every assertion above must say'
\echo ' "pass" — and must have been run as presby_app.'
\echo '======================================================'

-- ---------------------------------------------------------------------------
-- 10. The roll read path
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);

  -- The cache and the replay must agree for today, or one of them is lying.
  select assert_eq(
    (select count(*) from presby_roll_cache_drift()),
    0, 'roll: cache agrees with replay');

  -- The replay answers "then", which the cache cannot. 2010 predates every
  -- action in the fixture, including the 2011 baptism.
  select assert_eq(
    (select count(*) from memberships m
      where presby_roll_as_of(m.person_id, :ALDER, '2010-01-01') is not null),
    0, 'roll: nobody on the roll before the first recorded action');

  -- ...and the baptized member WAS on the roll in 2015, years before the
  -- imported opening balance, because her enrolment is its own action.
  select assert_eq(
    (select count(*) from memberships m
      where presby_roll_as_of(m.person_id, :ALDER, '2015-01-01') = 'baptized'),
    1, 'roll: replay finds the baptized member in 2015');

  -- Voided actions must not count. A dismissal recorded in error and voided
  -- leaves the member active and leaves the report line at zero.
  select assert_eq(
    (select count from presby_roll_changes(:ALDER, '2026-01-01', '2026-12-31')
      where line = 'loss_certificate'),
    0, 'roll: a voided dismissal does not appear in losses');

  -- Total adherents is active + baptized + other participants. Affiliate is
  -- reported separately and is deliberately not in that sum.
  select assert_eq(
    (select total_adherents from presby_roll_counts_as_of(:ALDER)),
    (select active + baptized + other_participant
       from presby_roll_counts_as_of(:ALDER)),
    'roll: total adherents excludes affiliate members');
commit;
