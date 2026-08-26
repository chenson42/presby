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
-- Role-catalog fixture (section 15). scripts/seed-dev.sql's Alder-Creek-only
-- new roles.
\set TREASURER_ROLE '\'f0000000-0000-0000-0000-000000000007\''
\set INSTALLED_PASTOR_ROLE '\'f0000000-0000-0000-0000-000000000008\''
\set SUPPORT_CONTACT_ROLE '\'f0000000-0000-0000-0000-000000000006\''
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
  -- Portal home + directory v2, Increment 4: +2 memberships (Aldous
  -- Fennimore, Wren Thackeray — the two new district households' heads) = 8.
  select assert_eq((select count(*) from memberships), 8, 'alder: sees own memberships');
  select assert_eq((select count(*) from memberships where organization_id <> :ALDER), 0,
                   'alder: sees NO foreign memberships');
  -- P9-role-catalog: 5 base + treasurer + installed_pastor = 7. support_contact
  -- carries no officer_terms row by design (no PC(USA) office corresponds to it).
  -- Portal home + directory v2, Increment 4: +2 district-scoped deacon terms
  -- for Priya Balakrishnan (one ended/South, one active/North) = 9.
  select assert_eq((select count(*) from officer_terms), 9, 'alder: sees own officer terms');
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
  -- Portal home + directory v2, Increment 4: +2 people (Aldous Fennimore,
  -- Wren Thackeray) = 8.
  select assert_eq((select count(*) from people), 8, 'alder: sees people it holds memberships for');
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

-- ---------------------------------------------------------------------------
-- 15. Role catalog expansion (P9-role-catalog / DECISION-080). treasurer,
--     installed_pastor, and support_contact are new app_roles rows seeded
--     ONLY at Alder Creek — same shape as section 2's tenant isolation, proved
--     directly against a foreign org rather than assumed from FORCE RLS alone.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from app_roles
      where key in ('treasurer', 'installed_pastor', 'support_contact')),
    3, 'alder: sees its own three new roles');
  select assert_eq(
    (select count(*) from role_grants
      where role_id in (:TREASURER_ROLE, :INSTALLED_PASTOR_ROLE, :SUPPORT_CONTACT_ROLE)),
    3, 'alder: sees its own three new role grants');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from app_roles
      where key in ('treasurer', 'installed_pastor', 'support_contact')),
    0, 'bramblewood: sees no alder treasurer/installed_pastor/support_contact roles');
  select assert_eq(
    (select count(*) from role_grants
      where role_id in (:TREASURER_ROLE, :INSTALLED_PASTOR_ROLE, :SUPPORT_CONTACT_ROLE)),
    0, 'bramblewood: sees no alder role grants for the new roles');
  -- Known-id cross-org read, same discipline as section 14's ticket check:
  -- querying by the KNOWN role id from a foreign org returns zero, not a
  -- 403 that would confirm the id is real.
  select assert_eq(
    (select count(*) from app_roles where id = :TREASURER_ROLE),
    0, 'bramblewood: cross-org read of alder''s treasurer role by known id returns zero');
commit;

-- ---------------------------------------------------------------------------
-- 16. Public sites. organization_sites (DECISION-081) and
--     site_contact_messages (DECISION-083) — drizzle/0020_presby_public_sites.sql.
--
--     The two tables are asymmetric by design (Phase 3 of
--     docs/work-log/2026-08-20-public-sites.md), so they need DIFFERENT
--     tests, not one loop:
--
--       organization_sites      presby_app has NO table grant at all — the
--                                only presby_app access is through
--                                presby_published_site()'s EXECUTE grant.
--                                A direct SELECT must fail with
--                                insufficient_privilege, a STRONGER property
--                                than "zero rows"; proven the same way F21
--                                (section 4) proves an unauthorized INSERT is
--                                rejected, not by attempting a row count.
--       site_contact_messages   ordinary FORCE-RLS tenant table with a real
--                                presby_app grant — same shape as section
--                                14's tickets/congregation_feedback. Creates
--                                its own row inside a rolled-back
--                                transaction rather than depending on
--                                scripts/seed-dev.sql carrying one (Phase 3
--                                deliberately seeds no sample
--                                site_contact_messages row — an anonymous
--                                contact-form message is a strange thing to
--                                fabricate as fixture data).
-- ---------------------------------------------------------------------------

-- organization_sites: no grant at all, proven directly rather than assumed
-- from the migration's own comment. Deliberately NOT inside an org context —
-- the point is that presby_app cannot reach this table by ANY org id.
begin;
  do $$
  begin
    perform count(*) from organization_sites;
    raise exception 'FAIL organization_sites — presby_app read succeeded; the "no direct grant" design is not enforced';
  exception when insufficient_privilege then
    raise notice 'pass  organization_sites: presby_app has no direct table grant (permission denied)';
  end $$;
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    perform count(*) from organization_sites;
    raise exception 'FAIL organization_sites — presby_app read succeeded even with an org GUC set';
  exception when insufficient_privilege then
    raise notice 'pass  organization_sites: presby_app has no direct table grant even inside alder''s own org context';
  end $$;
commit;

-- FORCE RLS specifically (F1) on both new tables — declared even though
-- organization_sites' real defense is the missing grant above; RLS is
-- defense-in-depth per the design, not the load-bearing mechanism for that
-- one table.
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('organization_sites', 'site_contact_messages')
        and relforcerowsecurity),
    2, 'public-sites tables: FORCE row level security is set on both');
commit;

-- site_contact_messages: ordinary FORCE-RLS tenant table, same discipline as
-- section 14. Creates its own row (Phase 3 seeds none) inside a
-- rolled-back transaction.
begin;
  select assert_eq((select count(*) from site_contact_messages), 0,
                   'unset GUC: site_contact_messages invisible');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into site_contact_messages (id, organization_id, name, email, body)
  values ('93000000-0000-0000-0000-000000000001', :ALDER,
          'Fixture Visitor', 'visitor@example.invalid',
          'What time is the Sunday service?');
  select assert_eq((select count(*) from site_contact_messages), 1,
                   'alder: sees its own contact message');

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from site_contact_messages), 0,
                   'bramblewood: sees no alder contact messages');
  -- The specific cross-org read: a foreign org querying by the KNOWN id of
  -- alder's message must return zero rows, not merely "the table looks
  -- empty from here" — same enumeration discipline as section 14's ticket
  -- check.
  select assert_eq(
    (select count(*) from site_contact_messages where id = '93000000-0000-0000-0000-000000000001'),
    0, 'bramblewood: cross-org read of alder''s contact message by known id returns zero');
rollback;

-- presby_published_site(): the enumeration-safety property the whole design
-- depends on. Called with NO org GUC set, matching how the anonymous
-- (public)/site/[slug] page actually reaches it. scripts/seed-dev.sql seeds
-- Alder Creek's organization_sites row with status = 'provisioning' (the
-- ingest endpoint doesn't exist until commit 2 of this pipeline), so
-- 'alder-creek' itself is one of the not-live cases this function must
-- collapse into zero rows — proven here alongside a slug that was never
-- provisioned at all, and the two must be indistinguishable from the
-- caller's side.
begin;
  select assert_eq(
    (select count(*) from presby_published_site('alder-creek')),
    0, 'presby_published_site: provisioning (not yet live) alder-creek returns zero rows');
  select assert_eq(
    (select count(*) from presby_published_site('never-provisioned-church')),
    0, 'presby_published_site: a slug with no organization_sites row at all returns zero rows, indistinguishable from provisioning');
commit;

-- ---------------------------------------------------------------------------
-- 17. Public-site org profile data. organization_profiles (DECISION-090)
--     and organization_service_times (DECISION-091) —
--     drizzle/0021_presby_site_profile.sql.
--
--     Unlike section 16's asymmetric pair, BOTH tables here get a real
--     presby_app grant (DECISION-090 — forward-looking, ahead of the
--     deferred tenant-editor), so the shape is section 14's ordinary
--     FORCE-RLS tenant-isolation test for both, not the "no grant at all"
--     insufficient_privilege test section 16 needed for organization_sites.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq((select count(*) from organization_profiles), 0,
                   'unset GUC: organization_profiles invisible');
  select assert_eq((select count(*) from organization_service_times), 0,
                   'unset GUC: organization_service_times invisible');
commit;

-- Creates its own rows (Phase 4 seeds none for this fixture yet) inside a
-- rolled-back transaction, same discipline as section 16's
-- site_contact_messages block.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_profiles (organization_id, address, phone, updated_by)
  values (:ALDER, '123 Fixture Lane, Example, ST 00000', '555-0100',
          (select id from users limit 1));
  select assert_eq((select count(*) from organization_profiles), 1,
                   'alder: sees its own profile row');

  insert into organization_service_times
    (organization_id, kind, day_of_week, start_time, end_time, label, updated_by)
  values (:ALDER, 'service', 0, '10:15', '11:15', 'Fixture Service',
          (select id from users limit 1));
  select assert_eq((select count(*) from organization_service_times), 1,
                   'alder: sees its own service-time row');

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from organization_profiles), 0,
                   'bramblewood: sees no alder profile row');
  select assert_eq((select count(*) from organization_service_times), 0,
                   'bramblewood: sees no alder service-time rows');
rollback;

-- FORCE RLS specifically (F1) on both new tables.
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('organization_profiles', 'organization_service_times')
        and relforcerowsecurity),
    2, 'public-site profile tables: FORCE row level security is set on both');
commit;

-- The presby_app grant shape, proven directly rather than assumed from the
-- migration's own comment — same discipline that verified organization_sites'
-- asymmetric NO grant in section 16, applied here to prove the opposite:
-- full select/insert/update/delete IS granted.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_profiles'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'organization_profiles: presby_app has full select/insert/update/delete');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_service_times'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'organization_service_times: presby_app has full select/insert/update/delete');
commit;

-- ---------------------------------------------------------------------------
-- 18. Deacon linkage (Portal home + directory v2, Increment 4 / DECISION-095).
--     officer_terms.org_unit_id — drizzle/0025_presby_deacon_linkage.sql.
--
--     org_units is already in the standard tenant_isolation table list
--     (drizzle/0009_presby_rls.sql), so its own isolation is covered by the
--     generic mechanism proven in section 2 — asserted directly here anyway,
--     since this is the first time the fixture has any org_units rows to
--     prove it against. officer_terms' own tenant isolation is ALREADY
--     re-proven every run by section 2's count (7 -> 9 above); this section
--     adds what's genuinely NEW: the CHECK and the composite FK this
--     migration introduced, plus the derivation query Increment 4b's
--     DeaconCard and getParishRoster() will both depend on.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from org_units), 2,
                   'alder: sees its own two districts');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from org_units), 0,
                   'bramblewood: sees no alder districts');
commit;

-- CHECK: a term for any office other than 'deacon' must not carry district
-- scoping (officer_terms_org_unit_deacon_check). Uses Hallie Vandermeer, who
-- holds NO existing officer_terms row of any office at Alder Creek — picked
-- specifically so officer_terms_no_overlap (section 7) cannot also fire and
-- make which constraint actually rejected the row ambiguous.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, org_unit_id, starts_on)
    values ('22222222-2222-2222-2222-222222222222',
            'c0000000-0000-0000-0000-000000000005', -- Hallie Vandermeer
            'trustee', 'a2000000-0000-0000-0000-000000000001', -- North District
            '2026-01-01');
    raise exception 'FAIL — a non-deacon office accepted a district assignment';
  exception when check_violation then
    raise notice 'pass  officer_terms_org_unit_deacon_check: non-deacon office with org_unit_id rejected';
  end $$;
rollback;

-- Composite FK (F2): a deacon term at Alder Creek must not reference a
-- district that belongs to another org, even one that genuinely exists.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  insert into org_units (id, organization_id, unit_type, name)
  values ('a2000000-0000-0000-0000-0000000000ff', '33333333-3333-3333-3333-333333333333',
          'district', 'Bramblewood Fixture District');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, org_unit_id, starts_on)
    values ('22222222-2222-2222-2222-222222222222',
            'c0000000-0000-0000-0000-000000000002', -- Tobias Renwick
            'deacon', 'a2000000-0000-0000-0000-0000000000ff', -- Bramblewood's district
            '2026-01-01');
    raise exception 'FAIL F2 — an alder-creek officer term referenced another org''s district';
  exception when foreign_key_violation then
    raise notice 'pass  officer_terms_org_unit_fk: cross-org district reference rejected (F2)';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  delete from org_units where id = 'a2000000-0000-0000-0000-0000000000ff';
commit;

-- The derivation itself: North District has an open ('vacant'-free) deacon
-- term; South District's term ENDED with no successor recorded, so the same
-- query returns nothing for it — the exact predicate DeaconCard and
-- getParishRoster() (Increment 4b) will both run.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from officer_terms
      where office = 'deacon' and ends_on is null
        and org_unit_id = 'a2000000-0000-0000-0000-000000000001'), -- North District
    1, 'North District: derivation finds one active deacon');
  select assert_eq(
    (select count(*) from officer_terms
      where office = 'deacon' and ends_on is null
        and org_unit_id = 'a2000000-0000-0000-0000-000000000002'), -- South District
    0, 'South District: derivation finds no active deacon (vacant)');
commit;

-- NOTE: this suite does NOT attempt to flip alder-creek's organization_sites
-- row to 'live' and re-check presby_published_site() here — presby_app has
-- NO grant at all on organization_sites (DECISION-081, section 16), so an
-- UPDATE from inside this presby_app-only suite would fail with
-- insufficient_privilege regardless of the widened function's correctness.
-- That check (a live site with no organization_profiles/
-- organization_service_times rows still returns exactly one row, with every
-- new column NULL) is instead run once, ad hoc, as the database owner
-- immediately after applying drizzle/0021_presby_site_profile.sql — see the
-- work-log's Phase 4 Implementer Notes.

-- ---------------------------------------------------------------------------
-- 19. Member management, database-admin schema layer (docs/work-log/
--     2026-08-25-member-management.md Phase 4, following section 18's own
--     precedent of a numbered section for schema-only verification before
--     the server/client layers land). Two things, neither with any fixture
--     rows to lean on:
--
--       Deliverable A  organization_feature_toggles — drizzle/
--                      0026_presby_org_feature_toggles.sql. Same shape as
--                      section 17's ordinary FORCE-RLS tenant-isolation
--                      test (a real presby_app grant, not section 16's
--                      "no grant at all" asymmetric case) — creates its own
--                      row inside a rolled-back transaction, same discipline.
--
--       Deliverable B  the org_features.manage / people.manage
--                      permission-catalog rows — drizzle/
--                      0026_presby_org_feature_toggles.sql and
--                      drizzle/0027_presby_member_management.sql — proven
--                      queryable through presby_has_permission() against the
--                      stated_clerk fixture binding scripts/seed-dev.sql
--                      adds to Tobias Renwick's existing grant (section 15's
--                      own stated_clerk/CLERK fixture).
-- ---------------------------------------------------------------------------
begin;
  select assert_eq((select count(*) from organization_feature_toggles), 0,
                   'unset GUC: organization_feature_toggles invisible');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- ON CONFLICT DO UPDATE, not a bare INSERT (docs/TODO.md follow-up, Phase 5
  -- QA, 2026-08-25-member-management.md): a prior manual/browser-walkthrough
  -- toggle write for this exact (organization_id, feature_key) composite PK
  -- would otherwise abort a re-run of this section with a duplicate-key
  -- error under ON_ERROR_STOP=1 — this section creates its own state and
  -- must be safe to run indefinitely, same discipline as every other
  -- section's rolled-back transaction.
  insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
  values (:ALDER, 'org_portal.members_create', true, (select id from users limit 1))
  on conflict (organization_id, feature_key) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by;
  select assert_eq((select count(*) from organization_feature_toggles), 1,
                   'alder: sees its own toggle row');
  -- assert_eq is bigint-only (no boolean overload) — every boolean check in
  -- this section goes through the FROM-less `count(*) WHERE <bool>` idiom
  -- (one virtual row; 1 if the predicate holds, 0 if not), same discipline
  -- the rest of this file already applies via row counts.
  select assert_eq(
    (select count(*) from organization_feature_toggles
      where organization_id = :ALDER and feature_key = 'org_portal.members_create'
        and enabled = true),
    1, 'alder: the toggle it just wrote reads back enabled');

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from organization_feature_toggles), 0,
                   'bramblewood: sees no alder toggle rows');
  -- Known cross-org read, same discipline as sections 14/15's known-id check
  -- (a composite PK here, not a surrogate id — same property either way): a
  -- foreign org querying by ALDER's exact org id + feature key returns zero,
  -- not a 403 that would confirm the row exists.
  select assert_eq(
    (select count(*) from organization_feature_toggles
      where organization_id = :ALDER and feature_key = 'org_portal.members_create'),
    0, 'bramblewood: cross-org read of alder''s toggle by known (org, key) returns zero');
rollback;

-- The write side of tenant isolation: bramblewood cannot plant a toggle row
-- for alder by naming alder's organization_id in the INSERT, even while its
-- own GUC is set to bramblewood — the WITH CHECK clause on tenant_isolation
-- rejects it, same F21-shaped guarantee section 4 proved for memberships.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values ('22222222-2222-2222-2222-222222222222', 'org_portal.members_create', true);
    raise exception 'FAIL — bramblewood wrote a toggle row into alder''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  organization_feature_toggles tenant_isolation: cross-org write rejected';
  end $$;
rollback;

-- FORCE RLS specifically (F1).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'organization_feature_toggles' and relforcerowsecurity),
    1, 'organization_feature_toggles: FORCE row level security is set');
commit;

-- The presby_app grant shape, proven directly — full select/insert/update/
-- delete, same discipline as section 17's organization_profiles check.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_feature_toggles'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'organization_feature_toggles: presby_app has full select/insert/update/delete');
commit;

-- Deliverable B: the permission-catalog rows exist. `permissions` carries no
-- organization_id and no RLS (src/lib/db/domain/authz.ts) — queryable with
-- no GUC set.
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'org_features.manage'),
    1, 'permissions: org_features.manage catalog row exists');
  select assert_eq(
    (select count(*) from permissions where key = 'people.manage'),
    1, 'permissions: people.manage catalog row exists');
commit;

-- And queryable through presby_has_permission() — not just present as a row.
-- Tobias Renwick (:CLERK) holds stated_clerk at Alder Creek, which
-- scripts/seed-dev.sql binds to both new keys alongside its existing
-- role_grants.manage/roll.propose/directory.view_hidden grant.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :ALDER, 'org_features.manage')),
    1, 'presby_has_permission: stated_clerk holds org_features.manage at alder');
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :ALDER, 'people.manage')),
    1, 'presby_has_permission: stated_clerk holds people.manage at alder');
  -- roll.propose/roll.approve already existed (DECISION-078) — re-proven here
  -- only to pin that this migration didn't disturb the existing split.
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :ALDER, 'roll.propose')),
    1, 'presby_has_permission: stated_clerk still holds roll.propose (DECISION-078, unchanged)');
commit;

-- Cross-org: the SAME person, at an org where they hold no grant at all,
-- must not read as having the permission. presby_effective_permissions()
-- joins through role_grants/group_memberships, which are FORCE RLS on
-- organization_id — Tobias has no role_grants row at bramblewood.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :BRAMBLE, 'org_features.manage')),
    0, 'presby_has_permission: stated_clerk holds NOTHING at bramblewood (no grant there)');
commit;

-- ---------------------------------------------------------------------------
-- 20. Two schema-layer defects found while building member management's
--     server logic (docs/work-log/2026-08-25-member-management.md, "Two
--     schema-layer findings, verified live"), fixed by drizzle/
--     0028_presby_people_write_rls_fix.sql. Both were pre-existing gaps in
--     drizzle/0009_presby_rls.sql, unrelated to that pipeline's own code.
--
--     Finding 1 — `people`'s `visible_via_membership` policy had no WITH
--     CHECK, so it defaulted to reusing USING for writes: an INSERT of a
--     brand-new person required an EXISTING membership referencing a
--     `people.id` that, by construction, cannot exist yet. This blocked
--     `createPerson()`'s `identity.mode === "new"` branch categorically.
--     Fixed by splitting the single FOR ALL policy into command-scoped
--     policies, with INSERT gated by a NEW SECURITY DEFINER helper,
--     `presby_person_unclaimed_or_own_org()` — SECURITY DEFINER is
--     load-bearing here, not decoration: a first draft wrote the case
--     (a)/(b) check as a literal SQL predicate directly in the policy, and
--     it was silently wrong for the exact reason F26 already names — a
--     plain `select ... from memberships` evaluated as presby_app inside
--     the ACTING org's own context is RLS-blind to that person's
--     memberships at any OTHER org, so "not exists anywhere" always read as
--     "not exists AT THIS ORG" and let any org attach a child row
--     (address/contact_method/etc) to a person it had no relationship to
--     at all. Caught by running it, not by review — see this section's own
--     assertion 20b below, which is the regression pin.
--
--     Finding 2 — `presby_freeze_approved_roll_action()`'s BEFORE DELETE
--     path unconditionally `return new`ed, which is always NULL on DELETE
--     in Postgres and means "silently skip deleting this row" — no
--     exception, for a `pending` row exactly as much as an `approved` one.
--     Fixed by returning OLD on the DELETE path (after the existing
--     approved-row guard, which now genuinely runs for DELETE too, not
--     just UPDATE). A second live-caught bug surfaced fixing this one:
--     `TG_OP` is always UPPERCASE ('DELETE'), so an initial `tg_op =
--     'delete'` (lowercase) silently never matched and reproduced the
--     exact original bug for PENDING rows specifically — assertion 20d
--     below pins the fixed, case-correct behavior.
-- ---------------------------------------------------------------------------

-- 20a. Finding 1, happy path: a brand-new person, invisible until a
--      membership links it, matching the SAME "insert-permissive,
--      read-restrictive" shape this table's SELECT policy always had.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  create temporary table t20_fresh_person as select gen_random_uuid() as id;
  insert into people (id, first_name, last_name)
    select id, 'Fixture', 'FreshPersonT20' from t20_fresh_person;
  select assert_eq(
    (select count(*) from people where id = (select id from t20_fresh_person)),
    0, 'finding 1: a freshly-inserted person is invisible before any membership links it');
  insert into memberships (organization_id, person_id, engagement_status)
    select :ALDER, id, 'visitor' from t20_fresh_person;
  select assert_eq(
    (select count(*) from people where id = (select id from t20_fresh_person)),
    1, 'finding 1: the same person becomes visible once alder holds a membership for them');
  -- Case (b): a SECOND child row for a person this org already holds a
  -- membership for must also succeed (not just brand-new persons).
  insert into addresses (person_id, address_type, line1)
    select id, 'home', 'One Fixture Way' from t20_fresh_person;
  select assert_eq(
    (select count(*) from addresses where person_id = (select id from t20_fresh_person)),
    1, 'finding 1: an address insert for a person this org already holds a membership for succeeds');
rollback;

-- 20b. Finding 1, THE regression pin: an org with NO relationship to a real,
--      already-claimed person must not be able to attach a child row to
--      them — the exact vandalism shape the naive (non-SECURITY-DEFINER)
--      first draft of this fix silently allowed, caught only by running it.
--      :PASTOR holds real memberships at :ALDER and :PRESBY, none at
--      :BRAMBLE.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into addresses (person_id, address_type, line1)
    values ('c0000000-0000-0000-0000-000000000006', 'home', 'Should Never Be Written');
    raise exception 'FAIL finding 1 regression — bramblewood attached an address to a person it has no relationship with';
  exception when insufficient_privilege then
    raise notice 'pass  finding 1: cross-org child-row insert onto an unrelated, already-claimed person rejected';
  end $$;
rollback;

-- 20c. F21 itself, re-proven unaffected by the policy split above (same
--      assertion shape as section 4).
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into memberships (organization_id, person_id, engagement_status)
    values ('33333333-3333-3333-3333-333333333333',
            'c0000000-0000-0000-0000-000000000006', 'visitor');
    raise exception 'FAIL F21 regression (post finding-1 fix) — unauthorized link succeeded';
  exception when insufficient_privilege then
    raise notice 'pass  F21 unaffected: unauthorized link to an existing person still rejected';
  end $$;
rollback;

-- 20d. Finding 2: a PENDING roll_actions row can be DELETEd (working-state
--      cleanup, same latitude invariant 4's own text grants pending rows
--      for UPDATE); an APPROVED row's DELETE is still rejected, not
--      silently no-op'ed.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into roll_actions (id, organization_id, person_id, kind, effective_date,
                            resulting_roll, approval_status)
  values ('aaaaaaaa-0000-0000-0000-0000000000a2', :ALDER, :ELDER, 'other_gain',
          current_date, 'active', 'pending');
  delete from roll_actions where id = 'aaaaaaaa-0000-0000-0000-0000000000a2';
  select assert_eq(
    (select count(*) from roll_actions where id = 'aaaaaaaa-0000-0000-0000-0000000000a2'),
    0, 'finding 2: a pending roll_actions row can now be deleted (was silently no-op''d before the fix)');

  insert into roll_actions (id, organization_id, person_id, kind, effective_date,
                            resulting_roll, approval_status)
  values ('bbbbbbbb-0000-0000-0000-0000000000b2', :ALDER, :ELDER, 'other_gain',
          current_date, 'active', 'approved');
  do $$
  begin
    delete from roll_actions where id = 'bbbbbbbb-0000-0000-0000-0000000000b2';
    raise exception 'FAIL finding 2 — an approved roll_actions row was deleted';
  exception when check_violation then
    raise notice 'pass  finding 2: an approved roll_actions row DELETE is still rejected, not silently no-op''d';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 22. Officer-terms administration, database-admin schema layer
--     (docs/work-log/2026-08-26-groups-and-officers.md, Phase 4 commit 1).
--     drizzle/0029_presby_officers_permission.sql seeds the officers.manage
--     permission-catalog row; scripts/seed-dev.sql binds it to stated_clerk
--     (f0000000-...-0005) alongside its existing role_grants.manage/
--     roll.propose/roll.approve/directory.view_hidden/org_features.manage/
--     people.manage grant — no new app_role_permissions/role_grants row for
--     a role that doesn't exist (DECISION-078's test, applied per Phase 3's
--     own wording; same "no new grant row" shape section 19's Deliverable B
--     proved for org_features.manage/people.manage).
--
--     `permissions` carries no organization_id and no RLS (src/lib/db/domain/
--     authz.ts) — this migration introduces no NEW row-level isolation
--     surface of its own; the catalog row itself is queryable with no GUC
--     set, same as section 19's Deliverable B assertion. What this section
--     proves is the SAME shape section 19 already established: the
--     permission resolves through stated_clerk at Alder Creek and resolves
--     to nothing for the same person at Bramblewood, where Tobias Renwick
--     holds no role_grants row at all (deliberately — DECISION-063's "prove
--     the mechanism once" reasoning, restated at seed-dev.sql's stated_clerk
--     grant comment).
--
--     NOT covered here, and not closeable until commit 2 lands: an
--     assertion that officers.manage actually GATES an `officer_terms`
--     mutation end to end (i.e. that stated_clerk at Bramblewood — who holds
--     no officers.manage grant there — is rejected by the application layer
--     when attempting to start/end a term at Alder Creek, or that a
--     cross-org `officer_terms` row is invisible the way section 2's count
--     and section 18's org_units/check-constraint tests already prove for
--     the table's OWN tenant isolation). `officer_terms`' table-level RLS is
--     unchanged by this migration and already exercised by sections 2/7/18 —
--     what's net-new here is a permission-catalog fact, not a new RLS
--     policy, so there is no new DB-level officer_terms isolation surface
--     for this section to add. The genuinely new thing to test once commit 2
--     lands is `src/lib/officers.ts`'s own `officers.manage` gate check
--     (mirroring `hasRoleGrantsManage`'s placement) — that belongs in
--     vitest against the query/mutation module, not in this SQL suite,
--     matching every other permission-gated module in this codebase (none of
--     role-grants.ts/roll.ts/people.ts's own permission checks are re-proven
--     here either). Flagged explicitly per this pipeline's Phase 3 Data
--     Model note rather than left as a silent gap.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'officers.manage'),
    1, 'permissions: officers.manage catalog row exists');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :ALDER, 'officers.manage')),
    1, 'presby_has_permission: stated_clerk holds officers.manage at alder');
  -- Re-proven alongside, same discipline as section 19's roll.propose
  -- re-check: pin that this migration didn't disturb the existing bindings.
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :ALDER, 'role_grants.manage')),
    1, 'presby_has_permission: stated_clerk still holds role_grants.manage (unchanged)');
commit;

-- Cross-org: the SAME person, at an org where they hold no grant at all,
-- must not read as having the permission — Tobias Renwick has no role_grants
-- row at bramblewood (seed-dev.sql's stated_clerk grant is deliberately
-- Alder-Creek-only).
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :BRAMBLE, 'officers.manage')),
    0, 'presby_has_permission: stated_clerk holds NOTHING at bramblewood (no grant there)');
commit;
