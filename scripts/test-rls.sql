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
\set ELDERUSER '\'e0000000-0000-0000-0000-0000000000f2\''
-- The post-login router fixture (section 12).
--   555... Fernwood (managed)   666... Marrowbone (invited)
\set FERNWOOD '\'55555555-5555-5555-5555-555555555555\''
\set CLERK    '\'c0000000-0000-0000-0000-000000000002\''
\set OTHERPART '\'c0000000-0000-0000-0000-000000000004\''
\set GRANTEE  '\'c1000000-0000-0000-0000-000000000003\''
\set DEPARTED '\'c1000000-0000-0000-0000-000000000004\''
\set U_NONE      '\'e0000000-0000-0000-0000-0000000000a1\''
\set U_UNMANAGED '\'e0000000-0000-0000-0000-0000000000a2\''
\set U_MIXED     '\'e0000000-0000-0000-0000-0000000000a4\''
\set U_ENDED     '\'e0000000-0000-0000-0000-0000000000a5\''
\set U_DUP       '\'e0000000-0000-0000-0000-0000000000a6\''
-- Support-ticket fixture (section 14). scripts/seed-dev.sql's sample rows.
\set TICKET   '\'90000000-0000-0000-0000-000000000001\''
\set FEEDBACK '\'92000000-0000-0000-0000-000000000001\''

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
  -- because the resolver reads dates, not row existence — this is proved by
  -- the SESSION-sourced grant specifically, not by the total row count.
  --
  -- P1 / DECISION-060: ELDER holds a long-standing, always-active Alder Creek
  -- membership, so once the active_membership derived group AND its
  -- directory.view role binding are seeded (scripts/seed-dev.sql, commit 2 of
  -- 2026-08-19-tenant-permissions-portal — DECISION-063), a SECOND row
  -- appears here even during the officer-term gap: the baseline grant, which
  -- has nothing to do with the term boundary this assertion exists to prove.
  -- Split so each half still proves what it originally proved: the term
  -- boundary (session-sourced count, unaffected) and the baseline grant's own
  -- presence. ELDER's membership row is seeded with a backdated created_at
  -- (matching current_roll_since, 1996-05-12) precisely so this as-of query,
  -- run against a date well before this fixture was ever loaded, still finds
  -- the derived group_memberships row the sync trigger produced.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:ELDER, :ALDER, '2015-06-01')
      where source_kind = 'group' and source_name = 'Session'),
    0, 'resolver: no SESSION permissions during the gap between terms');
  select assert_eq(
    (select count(*) from presby_effective_permissions(:ELDER, :ALDER, '2015-06-01')
      where permission_key = 'directory.view' and source_name = 'Active Membership'),
    1, 'resolver: active_membership baseline grant resolves during the officer-term gap');

  -- F11: an administrative commission granted nothing until arm 3 existed.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:PASTOR, :ALDER)
      where source_kind = 'commission'),
    2, 'resolver: administrative commission grants inside the congregation');

  -- ...and stops the day it expires. Same split as the ELDER gap test above,
  -- and for the same reason: PASTOR also holds a long-standing, always-active
  -- Alder Creek membership, so the baseline grant (once seeded) survives a
  -- commission's expiry even though the commission-sourced grants do not.
  select assert_eq(
    (select count(*) from presby_effective_permissions(:PASTOR, :ALDER, '2027-06-01')
      where source_kind = 'commission'),
    0, 'resolver: commission-sourced permissions lapse when the commission ends');
  select assert_eq(
    (select count(*) from presby_effective_permissions(:PASTOR, :ALDER, '2027-06-01')
      where permission_key = 'directory.view' and source_name = 'Active Membership'),
    1, 'resolver: active_membership baseline grant survives the commission''s expiry');

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

-- ---------------------------------------------------------------------------
-- 11. The per-congregation 2FA policy is readable at sign-in
-- ---------------------------------------------------------------------------
-- presby_two_factor_required() answers "does any church this user belongs to
-- require 2FA?" during authentication — when NO org GUC is set and none can be,
-- because picking an organization happens after you sign in.
--
-- This is finding F26 wearing a different hat. A plain join here is filtered to
-- zero rows by the very policies it complements, so it would return false for
-- exactly the users the policy protects: failing silently, looking like it
-- worked, and disabling the feature. The function must be SECURITY DEFINER, and
-- the pair of assertions below is what proves it — the function sees the
-- fixture's requirement, a naive join sees nothing at all.
--
-- The fixture seeds require_two_factor = true on Alder and false on Bramble.
-- Nothing here writes: presby_app cannot write organization_settings without an
-- org context, which is itself the point.
--
-- NOTE: deliberately NOT inside an org context. Setting one would hide the bug.
begin;
  select assert_eq(
    (select presby_two_factor_required(:ELDERUSER)::int),
    1, '2fa policy: definer function sees the requirement with no org GUC set');

  -- The same question asked the naive way. If this ever stops returning 0, RLS
  -- has been weakened and the definer function is no longer load-bearing.
  select assert_eq(
    (select count(*) from memberships m
       join organization_settings s on s.organization_id = m.organization_id
      where s.require_two_factor),
    0, '2fa policy: a naive join sees nothing — this is why F26 needs DEFINER');

  -- A user with no linked person is nobody's member and is never required.
  select assert_eq(
    (select presby_two_factor_required('00000000-0000-0000-0000-0000000000ff')::int),
    0, '2fa policy: an unlinked user is not required by any congregation');
rollback;

-- ---------------------------------------------------------------------------
-- 12. The org list, and the guard that keeps a position anchored (P0)
-- ---------------------------------------------------------------------------
-- presby_user_organizations() answers "where does this user belong" and filters
-- NOTHING. That is the point: policy lives in the TypeScript wrappers
-- (availableOrganizations / userOrganizations), where it is unit-testable and
-- shows up in a diff. These assertions exist so that "filters nothing" is a
-- property of the database rather than a claim in a comment - the moment
-- someone "helpfully" restores `ended_on is null` to the WHERE clause, the
-- "your access ended" message loses its data source silently.
--
-- Deliberately NOT inside an org context, because that is how the router calls
-- it: choosing an organization happens after the list is read.
begin;
  -- Renamed, not aliased. A surviving presby_available_organizations() would
  -- mean two functions with the same job drifting apart.
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_available_organizations'),
    0, 'org list: the pre-P0 function name is gone, not shadowed');

  -- An unmanaged-only relationship is RETURNED, not hidden. It yields no card,
  -- but /no-organization needs it to say something truer than "you are not
  -- connected to a congregation".
  select assert_eq(
    (select count(*) from presby_user_organizations(:U_UNMANAGED)
      where platform_status = 'unmanaged'),
    1, 'org list: an unmanaged relationship is returned, not filtered');

  -- An ENDED relationship is returned WITH its date. This is what makes
  -- "your access to Fernwood ended on 31 March 2026" possible in one query.
  select assert_eq(
    (select count(*) from presby_user_organizations(:U_ENDED)
      where ended_on is not null),
    1, 'org list: an ended relationship is returned with its ended_on');

  -- Mixed: both rows come back and exactly one is enterable. The filtering is
  -- the wrapper's job, and this assertion is what proves it is not free.
  select assert_eq((select count(*) from presby_user_organizations(:U_MIXED)),
                   2, 'org list: mixed user gets both relationships');
  select assert_eq(
    (select count(*) from presby_user_organizations(:U_MIXED)
      where platform_status = 'managed' and ended_on is null),
    1, 'org list: exactly one of the mixed user''s relationships is enterable');

  -- TWO rows for one organization, because two non-tombstoned people rows share
  -- the user_id. De-duplication is genuinely the wrapper's job.
  select assert_eq(
    (select count(*) from presby_user_organizations(:U_DUP) where slug = 'fernwood'),
    2, 'org list: duplicate person rows produce two rows for one organization');

  -- ...and the ORDER BY is a contract: the wrapper de-dups by taking the FIRST
  -- row per organization_id, so a current relationship must never sort behind
  -- an ended one.
  select assert_eq(
    (select count(*) from (
       select ended_on, row_number() over () as rn
         from presby_user_organizations(:U_MIXED)) o
      where o.rn = 1 and o.ended_on is null),
    1, 'org list: current relationships sort first');

  -- A user with no people row is nobody's member. The zero-org page is a
  -- funnel, not an error.
  select assert_eq((select count(*) from presby_user_organizations(:U_NONE)),
                   0, 'org list: a user with no person row gets nothing');

  -- The public-tree read the humane 403 depends on. organizations is
  -- deliberately not tenant-isolated, so it must resolve with NO org context -
  -- and it must resolve managed, unmanaged, and invited orgs identically, which
  -- is the whole of DECISION-040's indistinguishability property.
  select assert_eq(
    (select count(*) from organizations
      where slug in ('alder-creek', 'quillhaven', 'marrowbone')),
    3, 'public tree: every platform_status is readable with no org GUC set');
rollback;

-- DECISION-039, direction 1: a membership cannot end under an open position.
-- The failure is LOUD and names the term. It never auto-ends it - ending a term
-- is a minuted act with an end_reason, and a platform that quietly ends one to
-- satisfy a cache is doing the exact class of silent correction the roll
-- invariant forbids.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update memberships set ended_on = current_date
     where person_id = 'c0000000-0000-0000-0000-000000000002'
       and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL DECISION-039 — a membership ended under an open officer term';
  exception when check_violation then
    raise notice 'pass  DECISION-039: ending a membership under an open officer term rejected';
  end $$;
rollback;

-- The same guard's second arm. Without this the role_grants half of the trigger
-- would ship unverified, and a role grant strands a person just as quietly as a
-- term does.
begin;
  select set_config('app.current_org_id', :FERNWOOD, true);
  do $$
  begin
    update memberships set ended_on = current_date
     where person_id = 'c1000000-0000-0000-0000-000000000003'
       and organization_id = '55555555-5555-5555-5555-555555555555';
    raise exception 'FAIL DECISION-039 — a membership ended under an open role grant';
  exception when check_violation then
    raise notice 'pass  DECISION-039: ending a membership under an open role grant rejected';
  end $$;
rollback;

-- POSITIVE CONTROL. Without it the two assertions above would pass just as
-- happily against a trigger that rejects every ending, and a church could never
-- record a departure.
--
-- drizzle/0017 (P1, DECISION-060): every memberships insert/update now fires
-- presby_sync_derived_membership_group(), which fails loudly (F16) if the
-- org has no active_membership derived group yet. Alder Creek's real one is
-- seeded by scripts/seed-dev.sql in a later commit (DECISION-063) — not yet
-- when this suite runs standalone against 0017 alone. This block's own UPDATE
-- is a genuine write (unlike its sibling do-blocks above, which are expected
-- to abort before any AFTER trigger fires), so it needs a scratch group to
-- satisfy the new trigger. Rolled back with everything else in this
-- transaction; leaves no trace in the persistent fixture.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
  values (:ALDER, 'a0000000-0000-0000-0000-000000000002', -- global 'committee' template
          'Active Membership (scratch)', 'derived', 'active_membership')
  on conflict (organization_id, derived_from) do nothing;
  update memberships set ended_on = current_date, ended_reason = 'moved away'
   where person_id = :OTHERPART and organization_id = :ALDER;
  select assert_eq(
    (select count(*) from memberships
      where person_id = :OTHERPART and organization_id = :ALDER and ended_on is not null),
    1, 'DECISION-039: a membership with no open position still ends normally');
rollback;

-- Direction 2. A guard enforceable in one direction only is a paper invariant
-- in the other, and the hole is reached by simply reordering the two writes.
begin;
  select set_config('app.current_org_id', :FERNWOOD, true);
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
    values ('55555555-5555-5555-5555-555555555555',
            'c1000000-0000-0000-0000-000000000004', 'trustee', current_date, null);
    raise exception 'FAIL DECISION-039 — an open term was opened over an ended membership';
  exception when check_violation then
    raise notice 'pass  DECISION-039: opening a term where the membership ended rejected';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :FERNWOOD, true);
  do $$
  begin
    insert into role_grants (organization_id, role_id, person_id, starts_on)
    values ('55555555-5555-5555-5555-555555555555',
            'f0000000-0000-0000-0000-000000000003',
            'c1000000-0000-0000-0000-000000000004', current_date);
    raise exception 'FAIL DECISION-039 — an open role grant was opened over an ended membership';
  exception when check_violation then
    raise notice 'pass  DECISION-039: opening a role grant where the membership ended rejected';
  end $$;
rollback;

-- ...and the counterpart that must KEEP working: a term that closed before the
-- membership did is history, not access. A congregation arriving with twenty
-- years of session records for people who have since left must be able to
-- import them.
begin;
  select set_config('app.current_org_id', :FERNWOOD, true);
  insert into officer_terms (organization_id, person_id, office, starts_on, ends_on, end_reason)
  values (:FERNWOOD, :DEPARTED, 'trustee', '2018-01-01', '2020-01-01', 'completed');
  select assert_eq(
    (select count(*) from officer_terms
      where person_id = :DEPARTED and ends_on = '2020-01-01'),
    1, 'DECISION-039: a term that closed before the membership did still imports');
rollback;

-- ---------------------------------------------------------------------------
-- 13. The gate itself: withOrgContext()'s membership probe (P0)
-- ---------------------------------------------------------------------------
-- withOrgContext() asks "does this person hold a current relationship with this
-- organization?" BEFORE it sets app.current_org_id — deliberately, so the check
-- cannot be satisfied by the very context it authorizes.
--
-- That ordering is correct and it is also why the question cannot be asked with
-- a plain query: `memberships` is FORCE RLS on
-- `organization_id = presby_current_org()`, so with no GUC set the query is
-- filtered to zero rows for EVERY person at EVERY organization and the gate
-- rejects the members it exists to admit. Measured, not theorised: every
-- authenticated visit to /o/<slug> landed on the error boundary until
-- drizzle/0015_presby_membership_probe.sql. F26 in its purest form, and the
-- third place this shape has appeared in this schema.
--
-- The pair below is what keeps the fix honest — the definer function sees the
-- relationship with no org GUC set, and the naive query sees nothing at all.
-- NOTE: deliberately NOT inside an org context. Setting one would hide the bug.
begin;
  select assert_eq(
    (select presby_membership_is_active(:CLERK, :ALDER)::int),
    1, 'gate: definer probe sees a current relationship with no org GUC set');

  -- The same question asked the way withOrgContext used to ask it. If this ever
  -- stops returning 0, RLS has been weakened and the definer function is no
  -- longer load-bearing.
  select assert_eq(
    (select count(*) from memberships
      where person_id = :CLERK and organization_id = :ALDER and ended_on is null),
    0, 'gate: the naive query sees nothing — this is why F26 needs DEFINER');

  -- A non-member is refused. Without this, a probe that returned true
  -- unconditionally would pass the assertion above and open every organization.
  select assert_eq(
    (select presby_membership_is_active(:CLERK, :FERNWOOD)::int),
    0, 'gate: a person with no relationship at that organization is refused');

  -- An ENDED relationship is not a current one. This is the revoked-access path
  -- and the reason the predicate says `ended_on is null` rather than `exists`.
  select assert_eq(
    (select presby_membership_is_active(:DEPARTED, :FERNWOOD)::int),
    0, 'gate: an ended relationship does not open the organization');

  -- ...while the same person IS returned by presby_user_organizations(), which
  -- filters nothing. The two functions must disagree in exactly this way: one
  -- says "you were related to Fernwood and it ended", the other says "you may
  -- not enter". That is what makes the named-and-dated page possible.
  select assert_eq(
    (select count(*) from presby_user_organizations(:U_ENDED)
      where organization_id = :FERNWOOD and ended_on is not null),
    1, 'gate: the ended relationship is still visible to the org list');
rollback;

-- ---------------------------------------------------------------------------
-- 14. Support tickets. Four new FORCE-RLS tables (DECISION-069/070,
--     drizzle/0019_presby_ticket_support.sql). Same shape as section 2 —
--     an org sees its own rows, and a foreign org's cross-org read of a
--     specific known row id returns zero, not a 403 that would confirm the
--     id is real (Flow 2's enumeration discipline, verified at the SQL
--     layer here and at the query-layer in src/lib/tickets.test.ts).
-- ---------------------------------------------------------------------------
begin;
  select assert_eq((select count(*) from tickets), 0,
                   'unset GUC: tickets invisible');
  select assert_eq((select count(*) from ticket_messages), 0,
                   'unset GUC: ticket_messages invisible');
  select assert_eq((select count(*) from ticket_actions), 0,
                   'unset GUC: ticket_actions invisible');
  select assert_eq((select count(*) from congregation_feedback), 0,
                   'unset GUC: congregation_feedback invisible');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from tickets), 1,
                   'alder: sees its own ticket');
  select assert_eq((select count(*) from ticket_messages where ticket_id = :TICKET), 1,
                   'alder: sees its own ticket''s thread');
  select assert_eq((select count(*) from congregation_feedback), 1,
                   'alder: sees its own pending feedback');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from tickets), 0,
                   'bramblewood: sees no alder tickets');
  select assert_eq((select count(*) from ticket_messages), 0,
                   'bramblewood: sees no alder ticket messages');
  select assert_eq((select count(*) from ticket_actions), 0,
                   'bramblewood: sees no alder ticket actions');
  select assert_eq((select count(*) from congregation_feedback), 0,
                   'bramblewood: sees no alder congregation feedback');

  -- The specific cross-org read: a foreign org querying by the KNOWN id of
  -- alder's ticket/feedback row must return zero rows, not merely "the
  -- table looks empty from here" — this is what getTicketThread()'s
  -- not_found (never a 403) actually rests on.
  select assert_eq((select count(*) from tickets where id = :TICKET), 0,
                   'bramblewood: cross-org read of alder''s ticket by known id returns zero');
  select assert_eq((select count(*) from ticket_messages where ticket_id = :TICKET), 0,
                   'bramblewood: cross-org read of alder''s ticket thread by known ticket id returns zero');
  select assert_eq((select count(*) from congregation_feedback where id = :FEEDBACK), 0,
                   'bramblewood: cross-org read of alder''s feedback by known id returns zero');
rollback;

-- FORCE RLS specifically (F1) — not merely ENABLE, which the table owner
-- (and any role sharing the owner's privileges) would bypass silently.
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('tickets', 'ticket_messages', 'ticket_actions', 'congregation_feedback')
        and relforcerowsecurity),
    4, 'support tables: FORCE row level security is set on all four');
commit;
