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
-- Org-provisioning baseline-role fixture (section 21). The `member` role and
-- its group-arm grant to Alder Creek's own active_membership group
-- (b0000000-...-007) — this is the exact shape createOrganization() now
-- seeds for every future org (docs/work-log/2026-08-26-org-provisioning-
-- baseline-roles.md).
\set MEMBER_ROLE '\'f0000000-0000-0000-0000-000000000004\''
\set ALDER_ACTIVE_MEMBERSHIP_GROUP '\'b0000000-0000-0000-0000-000000000007\''
-- Role & permissions administration (section 24). Marisol Windham, the fresh
-- fixture person role_admin binds to (DECISION-109), the role_admin role
-- itself, and the global committee_chair template row drizzle/
-- 0032_presby_role_definitions.sql seeds directly (organization_id IS NULL).
\set ROLE_ADMIN_PERSON '\'c0000000-0000-0000-0000-000000000009\''
\set ROLE_ADMIN_ROLE '\'f0000000-0000-0000-0000-00000000000b\''
\set COMMITTEE_CHAIR_TEMPLATE_ROLE '\'00000000-0000-0000-0000-000000000001\''
-- Groups administration (sections 25/26). :CLERK (Tobias Renwick) is the
-- stated_clerk fixture holder groups.manage is bound to (test-reachability
-- convenience only, DECISION-110 / Phase 3). Marguerite Ashcombe's (:ELDER)
-- current officer_terms row at Alder Creek (e0000000-...-0002, ruling_elder)
-- is the derived group_memberships row section 25 attempts to DELETE.
\set SESSION_DERIVED_TERM '\'e0000000-0000-0000-0000-000000000002\''
\set ALDER_SESSION_GROUP '\'b0000000-0000-0000-0000-000000000001\''
\set ALDER_MANAGED_GROUP '\'b0000000-0000-0000-0000-000000000004\''
-- Ministry credentials & pastoral appointments (section 28). Idris Calloway,
-- the fresh fixture person the presbytery_stated_clerk ADOPTED copy binds to
-- (DECISION-112/DECISION-116); the global TEMPLATE row (drizzle/
-- 0037_presby_ministry_credentials.sql, organization_id IS NULL); the
-- org-scoped adopted copy at northern reach; and the one real appointments
-- row (Rowan Thistlewood/:PASTOR, serving Alder Creek, recorded by the
-- presbytery).
\set CREDENTIALS_CLERK '\'c0000000-0000-0000-0000-00000000000a\''
\set PRESBYTERY_STATED_CLERK_TEMPLATE_ROLE '\'00000000-0000-0000-0000-000000000002\''
\set PRESBYTERY_STATED_CLERK_ROLE '\'f0000000-0000-0000-0000-00000000000e\''
\set APPOINTMENT '\'e2000000-0000-0000-0000-000000000001\''
-- Presbytery program (section 29). QUILLHAVEN (unmanaged, D9) had no \set
-- before this section; the fixture rows scripts/seed-dev.sql adds for
-- congregation_oversight/congregation_statistics/per_capita_rates; the
-- presbytery's own sign-in-capable clerk user (Idris Calloway's linked
-- account).
\set QUILLHAVEN '\'44444444-4444-4444-4444-444444444444\''
\set OVERSIGHT_ALDER '\'a3000000-0000-0000-0000-000000000001\''
\set OVERSIGHT_BRAMBLE '\'a3000000-0000-0000-0000-000000000002\''
\set STAT_QUILLHAVEN '\'a4000000-0000-0000-0000-000000000001\''
\set STAT_ALDER_PUBLISHED '\'a4000000-0000-0000-0000-000000000002\''
\set PER_CAPITA_RATE '\'a5000000-0000-0000-0000-000000000001\''
\set PER_CAPITA_RECORD '\'a6000000-0000-0000-0000-000000000001\''
\set PRESBYTERY_CLERK_USER '\'e0000000-0000-0000-0000-0000000000f4\''
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
  -- Role & permissions administration (docs/work-log/2026-08-26-role-
  -- permissions-admin.md): +1 membership (Marisol Windham, the fresh fixture
  -- person role_admin binds to, DECISION-109) = 9.
  select assert_eq((select count(*) from memberships), 9, 'alder: sees own memberships');
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
  -- Wren Thackeray) = 8. Role & permissions administration: +1 person
  -- (Marisol Windham, role_admin's fresh fixture binding, DECISION-109) = 9.
  select assert_eq((select count(*) from people), 9, 'alder: sees people it holds memberships for');
  -- The pastor holds memberships at BOTH the presbytery and Alder Creek.
  select assert_eq((select count(*) from people where id = :PASTOR), 1, 'alder: sees its pastor');
commit;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  -- The presbytery holds ONLY its own members. It must not see Alder Creek's
  -- roll, which is invariant 2: access flows up by publication, never by
  -- inheritance.
  --
  -- Ministry credentials & pastoral appointments (docs/work-log/
  -- 2026-08-26-presbytery-functionality.md, Increment 2): +1 member (Idris
  -- Calloway, the presbytery_stated_clerk fixture holder, scripts/
  -- seed-dev.sql) = 2, mechanically bumped up from 1 the same way every
  -- earlier increment's own person additions bumped section 3's ALDER count
  -- above (see its own comment). This bump is committed-fixture-derived and
  -- holds on any FRESH database seeded from scripts/seed-dev.sql alone.
  --
  -- NOT fixed here: this assertion was already reported broken against
  -- TODAY'S shared/live dev database specifically, independent of this
  -- commit — an earlier session (the presbytery-portal walk, Increment 0)
  -- added a THIRD, untracked membership row at this org for
  -- admin@presby.invalid, live-DB-only and deliberately never carried into
  -- scripts/seed-dev.sql (see that Phase 4 entry's own note: "left in place
  -- ... nothing was added to seed-dev.sql"). Against that specific polluted
  -- database, the true count is 3, not the 2 asserted here — but 2 is the
  -- value scripts/seed-dev.sql's own committed state actually produces, and
  -- hardcoding 3 to match one session's live drift would be wrong on the
  -- next fresh seed. Flagged, not reconciled, per that same walk's own
  -- explicit instruction not to touch this file for that drift.
  select assert_eq((select count(*) from people), 2, 'presbytery: sees only its own members');
  select assert_eq((select count(*) from people where id = :ELDER), 0,
                   'presbytery: CANNOT see a congregation''s elder');
  select assert_eq((select count(*) from memberships), 2, 'presbytery: sees only its own memberships');
  -- The presbytery has roll actions of its OWN - a minister's membership sits
  -- there (G-2.0502). What it must never see is a congregation's. +1 (Idris
  -- Calloway's own opening_balance row, same reasoning as above) — unaffected
  -- by the live-drift caveat above, since that drift adds no roll_actions row
  -- (admin@presby.invalid's fixture membership carries current_roll = NULL,
  -- i.e. never enters the roll at all).
  select assert_eq(
    (select count(*) from roll_actions where organization_id <> :PRESBY), 0,
    'presbytery: CANNOT read a congregation''s roll actions');
  select assert_eq((select count(*) from roll_actions), 2,
                   'presbytery: sees its own ministers'' roll actions');
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
-- 21. Org-provisioning baseline roles (docs/work-log/2026-08-26-org-
--     provisioning-baseline-roles.md / DECISION-100). createOrganization()
--     now seeds a constitutional `member` app_roles row bound to
--     `directory.view`, granted via role_grants' GROUP arm to the org's own
--     active_membership group, for every future org. That exact shape has
--     existed in the Alder Creek fixture since P1/G-A (DECISION-060/063) but
--     never had its own isolation assertion — same shape as section 15's
--     proof for treasurer/installed_pastor/support_contact, applied here.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from app_roles where key = 'member'),
    1, 'alder: sees its own member role');
  select assert_eq(
    (select count(*) from role_grants
      where role_id = :MEMBER_ROLE and group_id = :ALDER_ACTIVE_MEMBERSHIP_GROUP
        and person_id is null),
    1, 'alder: sees its own member role''s group-arm grant, person_id null');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from app_roles where key = 'member' and id = :MEMBER_ROLE),
    0, 'bramblewood: does not see alder''s member role');
  select assert_eq(
    (select count(*) from role_grants where role_id = :MEMBER_ROLE),
    0, 'bramblewood: sees no grants for alder''s member role');
  -- Known-id cross-org read, same discipline as sections 14 and 15: querying
  -- by the KNOWN role/group ids from a foreign org returns zero, not a 403
  -- that would confirm the ids are real.
  select assert_eq(
    (select count(*) from app_roles where id = :MEMBER_ROLE),
    0, 'bramblewood: cross-org read of alder''s member role by known id returns zero');
  select assert_eq(
    (select count(*) from groups where id = :ALDER_ACTIVE_MEMBERSHIP_GROUP),
    0, 'bramblewood: cross-org read of alder''s active_membership group by known id returns zero');
commit;

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

-- ---------------------------------------------------------------------------
-- 23. Tenant branding permission, database-admin schema layer (docs/work-log/
--     2026-08-26-tenant-branding-permission.md, Phase 4 commit 1).
--     drizzle/0030_presby_branding_permission.sql seeds the branding.manage
--     permission-catalog row; scripts/seed-dev.sql mints a NEW role,
--     brand_admin (f0000000-...-000a, Alder Creek only), binds it to
--     branding.manage, and direct-grants it to Marguerite Ashcombe (:ELDER —
--     the same person id every earlier section already uses for her) —
--     deliberately NOT stated_clerk/Tobias Renwick (DECISION-101/DECISION-103:
--     branding has no defensible fit in stated_clerk's constitutional duty,
--     and piling a seventh permission onto that office would recreate the
--     "one office, every capability" concentration DECISION-080/DECISION-101
--     exist to interrupt).
--
--     `permissions` carries no organization_id and no RLS (src/lib/db/domain/
--     authz.ts) — this migration introduces no NEW row-level isolation
--     surface of its own; the catalog row itself is queryable with no GUC
--     set, same as sections 19/22's own Deliverable-B-shaped assertion. What
--     this section proves is the SAME shape sections 19/22 already
--     established: the permission resolves through brand_admin at Alder
--     Creek and resolves to nothing for the same person at Bramblewood,
--     where Marguerite Ashcombe holds no role_grants row at all (deliberately
--     — DECISION-063's "prove the mechanism once" reasoning, restated at
--     every new-role fixture grant comment in this file).
--
--     NOT covered here, and not closeable until commit 2 lands: an assertion
--     that branding.manage actually GATES a `src/lib/tenant-branding.ts`
--     mutation end to end — that belongs in vitest against the query/
--     mutation module once it exists, matching every other permission-gated
--     module in this codebase (same posture section 22's own closing note
--     states for officers.manage/src/lib/officers.ts).
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'branding.manage'),
    1, 'permissions: branding.manage catalog row exists');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:ELDER, :ALDER, 'branding.manage')),
    1, 'presby_has_permission: brand_admin holder (Marguerite Ashcombe) holds branding.manage at alder');
  -- Re-proven alongside, same discipline as section 22's role_grants.manage
  -- re-check: pin that this migration didn't disturb Marguerite's existing
  -- support_contact / tickets.file grant.
  select assert_eq(
    (select count(*) where presby_has_permission(:ELDER, :ALDER, 'tickets.file')),
    1, 'presby_has_permission: Marguerite Ashcombe still holds tickets.file (support_contact, unchanged)');
commit;

-- Cross-org: the SAME person, at an org where they hold no grant at all,
-- must not read as having the permission — Marguerite Ashcombe has no
-- role_grants row at bramblewood (seed-dev.sql's brand_admin grant is
-- deliberately Alder-Creek-only, same "prove the mechanism once" posture as
-- every other new-role fixture grant in this file).
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:ELDER, :BRAMBLE, 'branding.manage')),
    0, 'presby_has_permission: brand_admin holder holds NOTHING at bramblewood (no grant there)');
commit;

-- ---------------------------------------------------------------------------
-- 24. Role & permissions administration, database-admin schema layer
--     (docs/work-log/2026-08-26-role-permissions-admin.md, Phase 4 commit 1
--     / DECISION-106 (Phase 2) / DECISION-109 (Phase 3)). Three things:
--
--       (a) roles.manage — the permission-catalog row (drizzle/
--           0032_presby_role_definitions.sql), proven queryable and bound to
--           the fresh role_admin fixture (Marisol Windham, deliberately NOT
--           Tobias Renwick or Marguerite Ashcombe — both already hold two
--           roles each, DECISION-109), same shape as sections 19/22/23's own
--           permission-catalog proofs.
--
--       (b) the app_roles RLS split — the single largest risk item in this
--           design (Phase 3 Edge Cases): a tenant must now see the GLOBAL
--           committee_chair template row (organization_id IS NULL) alongside
--           its own roles, but must NEVER be able to write one. Proven
--           directly, not assumed from FORCE RLS alone — the same discipline
--           section 20's F26 finding demands ("caught by running it, not by
--           reading a raw SQL predicate").
--
--       (c) app_roles.deactivated_at exists and is NULL for every fixture
--           role today — no role in this fixture has ever been deactivated,
--           so this is a shape check, not a behavior proof. deactivateRole()
--           itself (api-developer's Phase 4 commit) gets its own isolation
--           proof once it exists to write to this column.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'roles.manage'),
    1, 'permissions: roles.manage catalog row exists');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:ROLE_ADMIN_PERSON, :ALDER, 'roles.manage')),
    1, 'presby_has_permission: role_admin holder (Marisol Windham) holds roles.manage at alder');
  -- Confirm this fixture person holds NOTHING ELSE — role_admin is a
  -- single-purpose office, not a wildcard (same discipline as brand_admin's
  -- own re-check in section 23).
  select assert_eq(
    (select count(*) where presby_has_permission(:ROLE_ADMIN_PERSON, :ALDER, 'people.manage')),
    0, 'presby_has_permission: role_admin holder holds NOTHING beyond roles.manage');
commit;

-- Cross-org: the SAME person, at an org where they hold no grant at all,
-- must not read as having the permission — Marisol Windham has no
-- role_grants row at bramblewood (seed-dev.sql's role_admin grant is
-- deliberately Alder-Creek-only, same "prove the mechanism once" posture as
-- every other new-role fixture grant in this file).
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:ROLE_ADMIN_PERSON, :BRAMBLE, 'roles.manage')),
    0, 'presby_has_permission: role_admin holder holds NOTHING at bramblewood (no grant there)');
commit;

-- The app_roles RLS split (b) — proven at BOTH tenant orgs, since the
-- template row must read as visible from either, not just Alder Creek.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from app_roles where id = :COMMITTEE_CHAIR_TEMPLATE_ROLE),
    1, 'alder: sees the global committee_chair template row (organization_id IS NULL)');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from app_roles where id = :COMMITTEE_CHAIR_TEMPLATE_ROLE),
    1, 'bramblewood: ALSO sees the global committee_chair template row — this is the point of the widened SELECT policy, not a leak');
commit;

-- The write side stays own-org-only — a tenant can never plant a template
-- row (organization_id IS NULL) through presby_app, mirroring organizations'
-- "public tree, no tenant write" shape (DECISION-109's second finding).
-- CAUGHT BY RUNNING IT, same discipline as section 20's F26 finding — a
-- literal "organization_id is null" WITH CHECK clause would need this same
-- live proof to be trusted at all.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values ('00000000-0000-0000-0000-000000000099', null, 'rogue_template', 'Rogue Template', 'custom', false);
    raise exception 'FAIL — alder wrote a template row (organization_id IS NULL) through presby_app';
  exception when insufficient_privilege then
    raise notice 'pass  app_roles write policy: template-row insert rejected';
  end $$;
rollback;

-- (c) deactivated_at exists and is NULL for every fixture role today — a
-- shape check only, since nothing in this commit writes to the column yet.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from app_roles where id = :ROLE_ADMIN_ROLE and deactivated_at is null),
    1, 'app_roles: deactivated_at column exists and is NULL for the freshly-seeded role_admin row');
commit;

-- ---------------------------------------------------------------------------
-- 25. Groups administration, database-admin schema layer (docs/work-log/
--     2026-08-26-groups-admin.md, Phase 4 commit 1 / DECISION-110 ruling 3).
--     Two things:
--
--       (a) groups.manage — the permission-catalog row (drizzle/
--           0033_presby_groups_administration.sql), proven queryable and
--           bound to the existing stated_clerk fixture holder (Tobias
--           Renwick, :CLERK) — a test-reachability convenience only (Phase 3's
--           own wording), not a recommended production default, same shape
--           as sections 19/22/23/24's own permission-catalog proofs.
--
--       (b) presby_reject_derived_group_write()'s widened DELETE branch.
--           Confirmed by direct read (drizzle/0009_presby_rls.sql) before
--           this migration: the original guard is
--             if src = 'derived' and coalesce(new.source, old.source) <> 'derived'
--           which is false for a DELETE — `new` is null, so it reads back
--           old.source, which IS 'derived', so the condition never fires and
--           the row deleted unblocked. drizzle/
--           0033_presby_groups_administration.sql special-cases
--           tg_op = 'DELETE' first. Proven directly against Marguerite
--           Ashcombe's derived Session group_memberships row (projected from
--           officer_terms e...-0002 by officer_terms_sync_derived) — no new
--           fixture rows needed, same "prove it against real derived data"
--           discipline section 6 already established for the UPDATE half of
--           this same trigger.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'groups.manage'),
    1, 'permissions: groups.manage catalog row exists');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CLERK, :ALDER, 'groups.manage')),
    1, 'presby_has_permission: stated_clerk holder (Tobias Renwick) holds groups.manage at alder — test-reachability binding, not a recommended default');
commit;

-- Setup check: the derived row this section is about to attempt a DELETE
-- against actually exists, so a "pass" below is proof of the trigger firing,
-- not a false pass from an empty WHERE clause matching nothing.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from group_memberships
      where officer_term_id = :SESSION_DERIVED_TERM and source = 'derived'),
    1, 'setup: Marguerite Ashcombe''s derived Session group_memberships row exists before the delete attempt');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    delete from group_memberships where officer_term_id = 'e0000000-0000-0000-0000-000000000002';
    raise exception 'FAIL invariant 5 — an already-derived group_memberships row was deleted directly';
  exception when check_violation then
    raise notice 'pass  invariant 5: DELETE of an already-derived group_memberships row rejected';
  end $$;
rollback;

-- Belt-and-braces (section 20's "prove it stuck" discipline): the row must
-- still be there after the rolled-back attempt, at zero net risk since the
-- whole attempt above ran inside a transaction that was rolled back either way.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from group_memberships
      where officer_term_id = :SESSION_DERIVED_TERM and source = 'derived'),
    1, 'group_memberships: Marguerite Ashcombe''s derived Session row still exists after the rejected delete');
commit;

-- ---------------------------------------------------------------------------
-- 26. Groups administration, database-admin schema layer (docs/work-log/
--     2026-08-26-groups-admin.md, Phase 4 commit 1 / DECISION-110 ruling 3).
--     No trigger of any kind existed on `groups` before this migration —
--     nothing stopped a direct UPDATE of a derived group's own name,
--     description, or meets_when. drizzle/
--     0033_presby_groups_administration.sql adds groups_reject_derived_edit
--     (before update on groups), which rejects the change when
--     old.membership_source = 'derived' and name/description/meets_when
--     `is distinct from` its old value. Proven against the Session fixture
--     row (:ALDER_SESSION_GROUP, derived) already seeded in section 6's own
--     transaction scope — no new fixture rows needed. The final block proves
--     the trigger is not overbroad: an ordinary MANAGED group's own edit
--     (Flow 2's whole point) must still succeed.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update groups set name = 'Hijacked Session' where id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL invariant 5 — a derived group''s name was edited directly';
  exception when check_violation then
    raise notice 'pass  invariant 5: UPDATE of a derived group''s name rejected';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update groups set description = 'hijacked' where id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL invariant 5 — a derived group''s description was edited directly';
  exception when check_violation then
    raise notice 'pass  invariant 5: UPDATE of a derived group''s description rejected';
  end $$;
rollback;

-- Not overbroad: an ordinary managed group (Property Committee) must still be
-- editable — this is Flow 2's whole point, and the trigger only special-cases
-- membership_source = 'derived'.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  update groups set name = 'Property Committee (Renamed)'
   where id = :ALDER_MANAGED_GROUP;
  select assert_eq(
    (select count(*) from groups
      where id = :ALDER_MANAGED_GROUP and name = 'Property Committee (Renamed)'),
    1, 'groups: an ordinary managed-group name edit still succeeds (trigger is not overbroad)');
rollback;

-- ---------------------------------------------------------------------------
-- 27. Events model, database-admin schema layer (docs/work-log/
--     2026-08-26-events-model.md, Phase 4 commit 1 / DECISION-113 /
--     DECISION-115). New table, no fixture rows to lean on — every insert
--     below happens inside its own rolled-back transaction, same discipline
--     as section 19's organization_feature_toggles proof. Three things:
--
--       (a) events.manage — the permission-catalog row (drizzle/
--           0036_presby_events.sql), tier 1, queryable with no GUC set
--           (permissions carries no organization_id / no RLS). No default
--           role binding exists (DECISION-115) — deliberately NOT re-proven
--           against stated_clerk here, since that binding is a
--           scripts/seed-dev.sql fixture-only convenience owned by the next
--           commit (full-stack-developer), not this migration.
--
--       (b) FORCE RLS tenant isolation — an event inserted at Alder Creek is
--           invisible at Bramblewood by both a blanket SELECT and a known-id
--           read, and Bramblewood cannot plant a row into Alder Creek's
--           organization_id from its own session (the WITH CHECK half),
--           same F21-shaped guarantee section 4/19 already established.
--
--       (c) The presby_app grant shape — full select/insert/update/delete,
--           same discipline as section 19's organization_feature_toggles
--           check.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'events.manage'),
    1, 'permissions: events.manage catalog row exists');
commit;

begin;
  select assert_eq((select count(*) from events), 0,
                   'unset GUC: events invisible');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into events (id, organization_id, title, starts_at, is_public, allows_checkin)
  values ('e9000000-0000-0000-0000-000000000001', :ALDER,
          'Session Stated Meeting', now(), false, false);
  select assert_eq(
    (select count(*) from events where organization_id = :ALDER),
    1, 'alder: sees its own newly-inserted event');

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from events), 0,
                   'bramblewood: sees no alder events at all');
  -- Known-id cross-org read, same discipline as sections 14/19's known-id
  -- check: naming Alder Creek's exact row id from Bramblewood's own session
  -- returns zero, not a permission error that would confirm the row exists.
  select assert_eq(
    (select count(*) from events where id = 'e9000000-0000-0000-0000-000000000001'),
    0, 'bramblewood: cross-org read of alder''s event by known id returns zero');
rollback;

-- The write side of tenant isolation: bramblewood cannot plant an event row
-- into alder's organization by naming alder's organization_id in the INSERT,
-- even while its own GUC is set to bramblewood — the WITH CHECK clause on
-- tenant_isolation rejects it, same F21-shaped guarantee section 4/19 proved.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into events (organization_id, title, starts_at)
    values ('22222222-2222-2222-2222-222222222222', 'Hijacked Event', now());
    raise exception 'FAIL — bramblewood wrote an event row into alder''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  events tenant_isolation: cross-org write rejected';
  end $$;
rollback;

-- FORCE RLS specifically (F1).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'events' and relforcerowsecurity),
    1, 'events: FORCE row level security is set');
commit;

-- The presby_app grant shape, proven directly — full select/insert/update/
-- delete, same discipline as section 19's organization_feature_toggles check.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'events'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'events: presby_app has full select/insert/update/delete');
commit;

-- ---------------------------------------------------------------------------
-- 28. Ministry credentials & pastoral appointments, database-admin schema
--     layer (docs/work-log/2026-08-26-presbytery-functionality.md, Increment
--     2, Phase 4 commit 1 / DECISION-112 (architect) / DECISION-116
--     (tech-lead)). drizzle/0037_presby_ministry_credentials.sql; fixture
--     rows in scripts/seed-dev.sql (Idris Calloway, the presbytery_stated_
--     clerk adopted copy + grant, and the one real appointments row: Rowan
--     Thistlewood/:PASTOR, recorded by the presbytery, serving Alder Creek).
--     Five things:
--
--       (a) credentials.manage — the permission-catalog row, tier 1,
--           queryable with no GUC set (permissions carries no
--           organization_id / no RLS), same shape as sections 19/22/23/24's
--           own catalog proofs.
--
--       (b) presbytery_stated_clerk — the GLOBAL template row (organization_
--           id IS NULL, organization_type_scope = 'presbytery'), the first
--           presbytery-scoped template this codebase has shipped. Visible
--           from BOTH a presbytery context (its natural home) and a
--           congregation context (the widened app_roles SELECT policy,
--           drizzle/0032, is type-scope-agnostic by design — section 24
--           already proved this generically for committee_chair; this just
--           confirms THIS row) — and bound to credentials.manage. The
--           ORG-SCOPED adopted copy at northern reach (a distinct row,
--           distinct id, same key — DECISION-116 ruling 2's own point that a
--           shared literal key across two organization_id IS NULL rows is
--           the thing to avoid, not across a template and its own adoption)
--           resolves the permission for Idris Calloway at the presbytery and
--           NOTHING at a congregation she holds no grant at — same
--           "prove the mechanism once" shape as every prior new-role section.
--
--       (c) ordinations.status — the new column exists, NOT NULL, defaults
--           to 'active' for every pre-existing ordinations row (none of
--           which named a status at insert time), and the credential_status
--           enum actually rejects a value outside its seven-member set.
--
--       (d) appointments — FORCE RLS tenant isolation, proven against a
--           SECOND, ad hoc presbytery (Phase 1's literal ask: "presbytery
--           A's appointment invisible to presbytery B"), not merely a
--           second congregation — the seeded fixture only has ONE
--           presbytery, so this section mints a second one inside its own
--           rolled-back transaction (organizations carries no RLS of its
--           own — schema-design.md section 17 — so this is a legal, side-
--           effect-free way to get a second real presbytery-type org for
--           the length of one transaction). Also proves the servingOrgId
--           cross-reference doesn't leak: querying by Alder Creek's own id
--           (the servingOrgId named in the fixture appointment) from a
--           session that is neither the recording presbytery NOR Alder
--           Creek itself still returns zero — isolation keys off
--           organization_id alone, never servingOrgId, so a join shape that
--           forgot the organization_id predicate would not "accidentally"
--           work either.
--
--       (e) appointments_person_fk — the composite FK (F2): an appointment
--           naming a real person who holds NO membership at the STATED
--           organization_id is rejected, mirroring officer_terms_org_unit_
--           fk's own F2 proof (section 18) for the identical composite-key
--           shape.
--
--     NOT covered here, same posture as sections 22/23's own closing notes:
--     an assertion that credentials.manage actually GATES a
--     src/lib/credentials.ts mutation end to end — that belongs in vitest
--     against the query/mutation module once it exists (full-stack-
--     developer's commit), not in this SQL suite.
-- ---------------------------------------------------------------------------

-- (a) permission-catalog row.
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'credentials.manage'),
    1, 'permissions: credentials.manage catalog row exists');
commit;

-- (b) the global template + its binding, then the org-scoped adopted copy.
begin;
  select assert_eq(
    (select count(*) from app_roles
      where id = :PRESBYTERY_STATED_CLERK_TEMPLATE_ROLE
        and organization_id is null
        and organization_type_scope = 'presbytery'
        and key = 'presbytery_stated_clerk'),
    1, 'presbytery_stated_clerk: global template row exists (organization_id IS NULL, scope = presbytery)');
  select assert_eq(
    (select count(*) from app_role_permissions
      where role_id = :PRESBYTERY_STATED_CLERK_TEMPLATE_ROLE
        and permission_key = 'credentials.manage'),
    1, 'presbytery_stated_clerk template: bound to credentials.manage');
commit;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from app_roles where id = :PRESBYTERY_STATED_CLERK_TEMPLATE_ROLE),
    1, 'presbytery: sees the global presbytery_stated_clerk template row');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from app_roles where id = :PRESBYTERY_STATED_CLERK_TEMPLATE_ROLE),
    1, 'alder (a congregation): ALSO sees the global template row — the widened SELECT policy is type-scope-agnostic, not a leak');
commit;

-- The org-scoped ADOPTED copy resolves the permission for its holder at the
-- presbytery, and nothing at a congregation she holds no grant at.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CREDENTIALS_CLERK, :PRESBY, 'credentials.manage')),
    1, 'presby_has_permission: presbytery_stated_clerk holder (Idris Calloway) holds credentials.manage at the presbytery');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) where presby_has_permission(:CREDENTIALS_CLERK, :ALDER, 'credentials.manage')),
    0, 'presby_has_permission: Idris Calloway holds NOTHING at alder creek (no grant there)');
commit;

-- (c) ordinations.status: column exists, defaults 'active' for every
--     pre-existing row, and the enum genuinely rejects an out-of-set value.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from ordinations where person_id = :PASTOR and status = 'active'),
    1, 'ordinations.status: defaults to active for the pre-existing fixture row (no status named at insert time)');
commit;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into ordinations (organization_id, person_id, ministry, ordained_on, status)
    values ('11111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-000000000006',
            'minister_of_word_and_sacrament', '2026-01-01', 'not_a_real_status');
    raise exception 'FAIL — credential_status enum accepted an out-of-set value';
  exception when invalid_text_representation then
    raise notice 'pass  credential_status enum: out-of-set value rejected';
  end $$;
rollback;

-- (d) FORCE RLS + tenant isolation, proven against a SECOND real presbytery
--     minted for the life of this one rolled-back transaction — organizations
--     carries no RLS of its own (schema-design.md section 17), so this insert
--     is legal and leaves no trace once rolled back.
begin;
  insert into organizations (id, parent_id, organization_type, name, slug, path, platform_status)
  values ('f6000000-0000-0000-0000-000000000001', null, 'presbytery',
          'Presbytery of the Southern Fields', 'southern-fields', 'southern_fields', 'managed');

  select set_config('app.current_org_id', 'f6000000-0000-0000-0000-000000000001', true);
  select assert_eq((select count(*) from appointments), 0,
                   'presbytery B (southern fields): sees no appointments at all');
  -- Known-id cross-presbytery read, same discipline as sections 14/19/27's
  -- known-id checks: naming northern reach's exact appointment id from a
  -- different presbytery's own session returns zero, not a permission error
  -- that would confirm the row exists.
  select assert_eq(
    (select count(*) from appointments where id = :APPOINTMENT),
    0, 'presbytery B: known-id cross-presbytery read of northern reach''s appointment returns zero');
  -- The servingOrgId cross-reference doesn't leak: presbytery B has no
  -- relationship to Alder Creek either (the servingOrgId named in northern
  -- reach's appointment) — querying BY that known servingOrgId still returns
  -- zero, proving isolation keys off organization_id alone, never
  -- servingOrgId.
  select assert_eq(
    (select count(*) from appointments where serving_org_id = :ALDER),
    0, 'presbytery B: querying by the known servingOrgId (Alder Creek) still returns zero');

  do $$
  begin
    insert into appointments (organization_id, person_id, serving_org_id, call_type, starts_on)
    values ('11111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-000000000006',
            '22222222-2222-2222-2222-222222222222',
            'installed_pastor', '2026-01-01');
    raise exception 'FAIL — presbytery B wrote an appointment row into northern reach''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  appointments tenant_isolation: cross-presbytery write rejected';
  end $$;
rollback;

-- The non-goal, restated as a proof: Alder Creek itself (the congregation
-- named as servingOrgId) has NO read of the appointment recorded about it
-- either — the congregation-side read is deferred to a future publication
-- mechanism (DECISION-112), not built by this table alone.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from appointments where id = :APPOINTMENT),
    0, 'alder creek: cannot read the appointment recorded about it (no downward read this increment, by design)');
commit;

-- FORCE RLS specifically (F1).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'appointments' and relforcerowsecurity),
    1, 'appointments: FORCE row level security is set');
commit;

-- The presby_app grant shape, proven directly.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'appointments'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'appointments: presby_app has full select/insert/update/delete');
commit;

-- (e) appointments_person_fk — the composite FK (F2): Tobias Renwick (:CLERK)
--     holds a membership at Alder Creek, NONE at the presbytery — an
--     appointment naming him at organization_id = the presbytery must be
--     rejected, the same F2 shape officer_terms_org_unit_fk already proved
--     (section 18) for a different composite pair.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into appointments (organization_id, person_id, serving_org_id, call_type, starts_on)
    values ('11111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-000000000002', -- Tobias Renwick — no presbytery membership
            '22222222-2222-2222-2222-222222222222',
            'installed_pastor', '2026-01-01');
    raise exception 'FAIL F2 — an appointment referenced a person with no membership at the stated organization';
  exception when foreign_key_violation then
    raise notice 'pass  appointments_person_fk: person with no membership at the stated org rejected (F2)';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 29. Presbytery program: congregation oversight, statistics, per-capita
--     (docs/work-log/2026-08-27-presbytery-program.md, Phase 3 / DECISION-118
--     through DECISION-121; database-admin schema commit, work-log
--     docs/work-log/2026-08-27-presbytery-oversight-statistics.md).
--
-- Full-suite-halt check (read, not papered over): this file sets
-- `\set ON_ERROR_STOP on` (line 13). Every "expected rejection" test below
-- (and throughout the file) wraps its manual `raise exception 'FAIL — ...'`
-- in a `do $$ ... exception when <specific errcode> then raise notice 'pass
-- ...' end $$;` block — a manually raised exception with no explicit errcode
-- carries the default SQLSTATE P0001, which the narrower `when <errcode>`
-- handler does NOT match, so if a protection is ever actually broken (the
-- operation unexpectedly succeeds and the FAIL branch fires), the error is
-- NOT swallowed — it propagates uncaught and ON_ERROR_STOP halts the whole
-- script with a hard, visible error, not a silent NOTICE. Confirmed by
-- direct read rather than assumed; no drift found. This section's own
-- "positive path" assertions (e) go further and use no exception handler at
-- all, so a regression there halts immediately too. Every mutating block in
-- this section runs inside `begin; ... rollback;`, so it is safe to re-run
-- indefinitely against the same seeded database, same discipline as every
-- other section since the 2026-08-25 member-management fix (docs/TODO.md).
-- ---------------------------------------------------------------------------

-- (a) FORCE RLS is set on all four new tables (F1).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('congregation_oversight', 'congregation_statistics',
                         'per_capita_rates', 'per_capita_records')
        and relforcerowsecurity),
    4, 'presbytery program: FORCE row level security is set on all four new tables');
commit;

-- The presby_app grant shape, proven directly (same style as section 28's
-- appointments proof) — 4 tables x 4 privileges.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name in ('congregation_oversight', 'congregation_statistics',
                            'per_capita_rates', 'per_capita_records')
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    16, 'presbytery program: presby_app has full select/insert/update/delete on all four new tables');
commit;

-- (b) Known-fixture sanity: the presbytery sees its own rows on all four
--     tables (scripts/seed-dev.sql's fixture).
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq((select count(*) from congregation_oversight where id = :OVERSIGHT_ALDER), 1,
    'northern reach: sees its own congregation_oversight row for Alder Creek');
  select assert_eq((select count(*) from congregation_oversight where id = :OVERSIGHT_BRAMBLE), 1,
    'northern reach: sees its own congregation_oversight row for Bramblewood');
  select assert_eq((select count(*) from congregation_oversight where about_org_id = :QUILLHAVEN), 0,
    'northern reach: no oversight row on file for Quillhaven (D9 unmanaged) — "no data on file" empty state');
  select assert_eq((select count(*) from congregation_statistics where id = :STAT_QUILLHAVEN), 1,
    'northern reach: sees its own presbytery_entered statistics row for Quillhaven');
  select assert_eq((select count(*) from congregation_statistics where id = :STAT_ALDER_PUBLISHED), 1,
    'northern reach: sees its own published_by_congregation statistics row for Alder Creek');
  select assert_eq((select count(*) from per_capita_rates where id = :PER_CAPITA_RATE), 1,
    'northern reach: sees its own per-capita rate row');
  select assert_eq((select count(*) from per_capita_records where id = :PER_CAPITA_RECORD), 1,
    'northern reach: sees its own per-capita record row');
commit;

-- (c) Cross-presbytery isolation on all four tables, proven against a SECOND
--     real presbytery minted for the life of this one rolled-back
--     transaction — organizations carries no RLS of its own (schema-
--     design.md section 17), so this insert is legal and leaves no trace
--     once rolled back. Same discipline as section 28(d)'s appointments
--     proof, extended to all four tables this section adds.
begin;
  insert into organizations (id, parent_id, organization_type, name, slug, path, platform_status)
  values ('f7000000-0000-0000-0000-000000000001', null, 'presbytery',
          'Presbytery of the Western Basin', 'western-basin', 'western_basin', 'managed');

  select set_config('app.current_org_id', 'f7000000-0000-0000-0000-000000000001', true);

  select assert_eq((select count(*) from congregation_oversight), 0,
    'presbytery B (western basin): sees no congregation_oversight rows at all');
  select assert_eq((select count(*) from congregation_oversight where id = :OVERSIGHT_ALDER), 0,
    'presbytery B: known-id cross-presbytery read of northern reach''s oversight row returns zero');

  select assert_eq((select count(*) from congregation_statistics), 0,
    'presbytery B: sees no congregation_statistics rows at all');
  select assert_eq((select count(*) from congregation_statistics where id = :STAT_ALDER_PUBLISHED), 0,
    'presbytery B: known-id cross-presbytery read of northern reach''s published statistics row returns zero');

  select assert_eq((select count(*) from per_capita_rates), 0,
    'presbytery B: sees no per_capita_rates rows at all');
  select assert_eq((select count(*) from per_capita_records), 0,
    'presbytery B: sees no per_capita_records rows at all');

  do $$
  begin
    insert into congregation_oversight (organization_id, about_org_id, viability_score, updated_by)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
            2, 'e0000000-0000-0000-0000-0000000000f4');
    raise exception 'FAIL — presbytery B wrote a congregation_oversight row into northern reach''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  congregation_oversight tenant_isolation: cross-presbytery write rejected';
  end $$;

  do $$
  begin
    insert into congregation_statistics (organization_id, about_org_id, year, provenance)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
            2030, 'presbytery_entered');
    raise exception 'FAIL — presbytery B wrote a congregation_statistics row into northern reach''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  congregation_statistics tenant_isolation: cross-presbytery write rejected';
  end $$;

  do $$
  begin
    insert into per_capita_rates (organization_id, billing_year, basis_year, rate_per_member, updated_by)
    values ('11111111-1111-1111-1111-111111111111', 2099, 2097, 1.00,
            'e0000000-0000-0000-0000-0000000000f4');
    raise exception 'FAIL — presbytery B wrote a per_capita_rates row into northern reach''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  per_capita_rates tenant_isolation: cross-presbytery write rejected';
  end $$;

  do $$
  begin
    insert into per_capita_records
      (organization_id, about_org_id, billing_year, basis_year, ending_active_basis, rate_applied, amount_owed)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
            2099, 2097, 1, 1.00, 1.00);
    raise exception 'FAIL — presbytery B wrote a per_capita_records row into northern reach''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  per_capita_records tenant_isolation: cross-presbytery write rejected';
  end $$;
rollback;

-- (d) The freeze trigger: rejects UPDATE/DELETE on a published row, allows
--     UPDATE on a presbytery_entered row — the roll_actions/void precedent,
--     applied to a column instead of a second table.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    update congregation_statistics set ending_active = 999
     where id = 'a4000000-0000-0000-0000-000000000002'; -- :STAT_ALDER_PUBLISHED
    raise exception 'FAIL — updated a published_by_congregation row in place';
  exception when check_violation then
    raise notice 'pass  congregation_statistics_freeze: UPDATE on a published row rejected';
  end $$;

  do $$
  begin
    delete from congregation_statistics where id = 'a4000000-0000-0000-0000-000000000002'; -- :STAT_ALDER_PUBLISHED
    raise exception 'FAIL — deleted a published_by_congregation row';
  exception when check_violation then
    raise notice 'pass  congregation_statistics_freeze: DELETE on a published row rejected';
  end $$;

  -- A presbytery_entered row is ordinary mutable working state — the
  -- trigger's WHEN clause never fires for it.
  update congregation_statistics set ending_active = 40 where id = :STAT_QUILLHAVEN;
  select assert_eq(
    (select ending_active from congregation_statistics where id = :STAT_QUILLHAVEN),
    40, 'congregation_statistics_freeze: UPDATE on a presbytery_entered row is allowed (not frozen)');
rollback;

-- (e) Confused-deputy invariant (F26): presby_publish_sasr_snapshot() takes
--     NO organization id of any kind — calling it from Alder Creek's own
--     context (a REAL seeded congregation, not a synthetic pair — Phase 2's
--     two-real-orgs discipline) lands the new row at its ACTUAL parent
--     (northern reach) and about itself; there is no parameter through which
--     it could target anywhere else. The republish is exercised in the same
--     block: a second call for the same year chains to the first via a
--     DERIVED supersedes_publication_id, never a caller-supplied one — the
--     "republish chain" half of the partial-unique-index proof below.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    v_new       uuid;
    v_corrected uuid;
    v_org_id    uuid;
    v_about_id  uuid;
  begin
    v_new := presby_publish_sasr_snapshot(
      2026, 'Session stated meeting, 2027-01-10, item 3',
      p_ending_active => 220, p_ending_baptized => 48,
      p_avg_weekly_worship_attendance => 170, p_baptisms_children => 5,
      p_receipts_contributions => 425000.00, p_exp_local_program => 280000.00
    );

    -- Verified through presby_list_own_congregation_publications(), NOT a
    -- direct SELECT on congregation_statistics: this session's own
    -- app.current_org_id is still Alder Creek, and the standard
    -- tenant_isolation policy correctly filters the just-inserted row
    -- (organization_id = northern reach) out of any query run under that
    -- context — the row living outside the caller's own tenant space IS the
    -- point (F26). The read counterpart is SECURITY DEFINER for exactly
    -- this reason.
    select organization_id, about_org_id into v_org_id, v_about_id
      from presby_list_own_congregation_publications(2026)
     where id = v_new;

    if v_org_id is distinct from '11111111-1111-1111-1111-111111111111' -- :PRESBY, the ACTUAL parent
       or v_about_id is distinct from '22222222-2222-2222-2222-222222222222' -- :ALDER, the caller
    then
      raise exception 'FAIL — Alder Creek''s publication did not land at its actual parent (found organization_id=%, about_org_id=%)', v_org_id, v_about_id;
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: publication lands at the actual parent (northern reach), about the calling congregation — no parameter exists to redirect it';

    v_corrected := presby_publish_sasr_snapshot(
      2026, 'Session stated meeting, 2027-02-14, item 2 (correction)',
      p_ending_active => 221
    );

    if (select supersedes_publication_id from presby_list_own_congregation_publications(2026) where id = v_corrected)
       is distinct from v_new then
      raise exception 'FAIL — a same-year republish did not chain to the row it corrects';
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: a same-year republish chains via a DERIVED supersedes_publication_id (never caller-supplied) — the republish-chain half of the partial unique index proof';
  end $$;
rollback;

-- (f) presby_publish_sasr_snapshot() rejects an org with no parent at all —
--     northern reach itself (a real seeded presbytery, parent_id IS NULL).
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2026, 'n/a');
    raise exception 'FAIL — an organization with no parent_id was allowed to publish';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: an organization with no parent_id is rejected';
  end $$;
rollback;

-- (g) presby_publish_sasr_snapshot() rejects a congregation whose parent
--     exists but is not a presbytery (a synod, here) — minted inline for the
--     life of this rolled-back transaction, same discipline as (c) above.
begin;
  insert into organizations (id, parent_id, organization_type, name, slug, path, platform_status)
  values
    ('f8000000-0000-0000-0000-000000000001', null, 'synod',
     'Synod of the Coastal Plain', 'coastal-plain-synod', 'coastal_plain_synod', 'managed'),
    ('f8000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000001', 'congregation',
     'Orphan Chapel (fixture — parent is a synod, not a presbytery)', 'orphan-chapel',
     'coastal_plain_synod.orphan_chapel', 'managed');

  select set_config('app.current_org_id', 'f8000000-0000-0000-0000-000000000002', true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2026, 'n/a');
    raise exception 'FAIL — a congregation whose parent is a synod, not a presbytery, was allowed to publish';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: a parent organization_type other than presbytery is rejected';
  end $$;
rollback;

-- (h) presby_publish_sasr_snapshot() range-validates every count at the
--     trust boundary (F26) — a negative count is rejected, never merely
--     clamped or silently accepted.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2026, 'n/a', p_ending_active => -5);
    raise exception 'FAIL — a negative count was accepted by presby_publish_sasr_snapshot()';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: a negative count is rejected (range validation at the trust boundary)';
  end $$;

  do $$
  begin
    perform presby_publish_sasr_snapshot(3050, 'n/a');
    raise exception 'FAIL — an out-of-range report year was accepted';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: an out-of-range report year is rejected';
  end $$;
rollback;

-- (i) presby_list_own_congregation_publications(): Alder Creek reads its own
--     published row back (the "publication history" requirement); a THIRD
--     seeded congregation (Bramblewood) never returns Alder Creek's rows,
--     by count or by known id.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from presby_list_own_congregation_publications() where id = :STAT_ALDER_PUBLISHED),
    1, 'presby_list_own_congregation_publications: Alder Creek reads its own published row back');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from presby_list_own_congregation_publications()),
    0, 'presby_list_own_congregation_publications: Bramblewood (a third congregation) sees none of Alder Creek''s publications');
  select assert_eq(
    (select count(*) from presby_list_own_congregation_publications() where id = :STAT_ALDER_PUBLISHED),
    0, 'presby_list_own_congregation_publications: Bramblewood cannot read Alder Creek''s known publication id either');
commit;

-- (j) The partial unique index: rejects a duplicate presbytery_entered row
--     for the same (organization, congregation, year) — the "republish
--     chain" half of this proof already ran in (e) above via two successful
--     presby_publish_sasr_snapshot() calls for the same year.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into congregation_statistics (organization_id, about_org_id, year, provenance)
    values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
            2025, 'presbytery_entered');
    raise exception 'FAIL — a second presbytery_entered row for the same (org, congregation, year) was accepted';
  exception when unique_violation then
    raise notice 'pass  congregation_statistics_entered_unique_idx: duplicate presbytery_entered row for the same year rejected';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 30. Org feature CATEGORIES — the fourth, coarser gating axis (docs/
--     work-log/2026-08-27-feature-categories.md, Phase 4; DECISION-130),
--     drizzle/0040_presby_org_feature_categories.sql. Same shape as section
--     19's organization_feature_toggles proof (a real presby_app grant, own
--     rolled-back-transaction fixture rows, no reliance on scripts/
--     seed-dev.sql). Three things this table's own schema layer must prove,
--     independent of the resolver's DEFAULT-ON application-layer semantics
--     (categoryEnabledInTx() in src/lib/org-feature-categories.ts — the
--     "missing row -> true" behavior is a TypeScript default, `?? true`,
--     over a SQL result set; it is not itself a thing SQL can assert, so
--     this section proves the schema-layer facts the resolver's guarantee
--     rests on, not the default-on behavior's own text):
--
--       (a) Standard FORCE-RLS tenant isolation, same discipline as section
--           19's organization_feature_toggles cross-org read/write proof.
--       (b) The CHECK constraint (DECISION-130's departure from
--           feature_key's own unconstrained precedent) rejects
--           'administration' AND an arbitrary garbage value — defense in
--           depth underneath src/lib/org-feature-categories.ts's own
--           isCategoryKey() resolver-layer guard (Phase 1 Gap 2).
--       (c) FORCE RLS specifically (F1) and the presby_app grant shape,
--           same two checks section 19 runs for its own sibling table.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq((select count(*) from organization_feature_categories), 0,
                   'unset GUC: organization_feature_categories invisible');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_feature_categories (organization_id, category, enabled, updated_by)
  values (:ALDER, 'worship', false, (select id from users limit 1))
  on conflict (organization_id, category) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by;
  select assert_eq((select count(*) from organization_feature_categories), 1,
                   'alder: sees its own category row');
  select assert_eq(
    (select count(*) from organization_feature_categories
      where organization_id = :ALDER and category = 'worship'
        and enabled = false),
    1, 'alder: the category row it just wrote reads back disabled (an explicit off row, not the default-on absence case)');

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from organization_feature_categories), 0,
                   'bramblewood: sees no alder category rows');
  select assert_eq(
    (select count(*) from organization_feature_categories
      where organization_id = :ALDER and category = 'worship'),
    0, 'bramblewood: cross-org read of alder''s category by known (org, category) returns zero');
rollback;

-- The write side of tenant isolation, same F21-shaped guarantee section 19's
-- own equivalent check proves for organization_feature_toggles.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into organization_feature_categories (organization_id, category, enabled)
    values ('22222222-2222-2222-2222-222222222222', 'people', false);
    raise exception 'FAIL — bramblewood wrote a category row into alder''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  organization_feature_categories tenant_isolation: cross-org write rejected';
  end $$;
rollback;

-- (b) The CHECK constraint: 'administration' must never become a selectable
--     category (Phase 1 Gap 2) — enforced here at the schema layer, not just
--     by src/lib/org-feature-categories.ts's own isCategoryKey() guard.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- Literal org id below, not :ALDER — psql variable substitution does not
  -- descend into a dollar-quoted PL/pgSQL body, same discipline every other
  -- exception-proof block in this file already follows.
  do $$
  begin
    insert into organization_feature_categories (organization_id, category, enabled)
    values ('22222222-2222-2222-2222-222222222222', 'administration', true);
    raise exception 'FAIL — a row with category = ''administration'' was accepted';
  exception when check_violation then
    raise notice 'pass  organization_feature_categories_category_check: administration is rejected';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into organization_feature_categories (organization_id, category, enabled)
    values ('22222222-2222-2222-2222-222222222222', 'not_a_real_category', true);
    raise exception 'FAIL — a row with an arbitrary garbage category was accepted';
  exception when check_violation then
    raise notice 'pass  organization_feature_categories_category_check: an arbitrary garbage category is rejected';
  end $$;
rollback;

-- (c) FORCE RLS specifically (F1), same check section 19 runs for
--     organization_feature_toggles.
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'organization_feature_categories' and relforcerowsecurity),
    1, 'organization_feature_categories: FORCE row level security is set');
commit;

-- The presby_app grant shape, proven directly — full select/insert/update/
-- delete, same discipline as section 19's own check.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_feature_categories'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'organization_feature_categories: presby_app has full select/insert/update/delete');
commit;

