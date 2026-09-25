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
-- Staff and personnel (section 31). scripts/seed-dev.sql's two fixture
-- staff_positions rows: Marisol Windham's (:ROLE_ADMIN_PERSON) Church
-- Secretary position at Alder Creek, and Idris Calloway's (:CREDENTIALS_CLERK)
-- second, unrelated Part-Time Bookkeeper position at Northern Reach.
\set STAFF_SECRETARY  '\'a7000000-0000-0000-0000-000000000001\''
\set STAFF_BOOKKEEPER '\'a7000000-0000-0000-0000-000000000002\''
-- Organization lifecycle + council affiliation (section 32, drizzle/0044).
-- Four councils that exist only as cross-council fixtures. They were minted
-- inline by sections 28/29 until drizzle/0044 revoked INSERT on
-- `organizations` from presby_app (F38); they now live in
-- scripts/seed-dev.sql, the owner-run setup this suite already depends on.
--   SOUTHERN_FIELDS  the presbytery that held Quillhaven until 1995 — the
--                    closed historical affiliation, i.e. the 1990 case
--   WESTERN_BASIN    a presbytery with no rows of its own (isolation probe)
--   COASTAL_SYNOD    a synod, and TIDEWATER the presbytery under it
\set SOUTHERN_FIELDS '\'f6000000-0000-0000-0000-000000000001\''
\set WESTERN_BASIN   '\'f7000000-0000-0000-0000-000000000001\''
\set COASTAL_SYNOD   '\'f8000000-0000-0000-0000-000000000001\''
\set TIDEWATER       '\'f8000000-0000-0000-0000-000000000002\''
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

  -- REMOVED 2026-09-25 (C-4 / drizzle/0048 section 6). The assertion that
  -- used to sit here called presby_roll_cache_drift(); presby_app no longer
  -- holds EXECUTE on it, so the call would raise and ON_ERROR_STOP would
  -- abandon every assertion below. See section 39.8 for what replaced it.

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

-- (d) FORCE RLS + tenant isolation, proven against a SECOND real presbytery.
--     That presbytery used to be minted inline here, inside this rolled-back
--     transaction, on the reasoning that "organizations carries no RLS of its
--     own (schema-design.md section 17), so this insert is legal." It was
--     legal only because of the drift F38 names: drizzle/0044 revokes INSERT
--     on organizations from presby_app, and this suite runs as presby_app
--     (line 1). The Southern Fields is now a permanent fixture in
--     scripts/seed-dev.sql — the owner-run setup this suite already depends
--     on — and this section only sets the context to it.
begin;
  select set_config('app.current_org_id', :SOUTHERN_FIELDS, true);
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
-- appointments proof) — 4 tables x 4 privileges, MINUS the one table-level
-- UPDATE that drizzle/0047 section 10 replaced with a column list.
--
-- NARROWED 2026-09-25 (QA-2): congregation_statistics' table-level UPDATE was
-- revoked and re-granted per column, excluding withdrawn_at and
-- publication_id. NARROWED AGAIN THE SAME DAY (F61, eleventh Phase 3
-- loop-back): its table-level INSERT went the same way, excluding those two
-- plus published_at. So this count is 14 rather than 16, and BOTH missing
-- entries are named below rather than absorbed into a smaller number. The
-- column-level shapes that replaced them are asserted in sections 35(d) and
-- 37(d); keeping both halves means a revert in either direction fails the
-- suite.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name in ('congregation_oversight', 'congregation_statistics',
                            'per_capita_rates', 'per_capita_records')
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    14, 'presbytery program: presby_app has full select/insert/update/delete on all four new tables, EXCEPT congregation_statistics'' table-level UPDATE and INSERT — both column-scoped (see 35(d) and 37(d))');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'congregation_statistics'
        and grantee = 'presby_app'
        and privilege_type = 'UPDATE'),
    0, 'QA-2: and the first missing entry is exactly that — congregation_statistics carries no table-level UPDATE for presby_app');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'congregation_statistics'
        and grantee = 'presby_app'
        and privilege_type = 'INSERT'),
    0, 'F61: and the second is its table-level INSERT — a forged published_by_congregation projection is now refused by a privilege, not only by a marker');
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
--     real presbytery. Same move as section 28(d): the Western Basin used to
--     be minted inline here and is now a permanent scripts/seed-dev.sql
--     fixture, because drizzle/0044 revokes INSERT on organizations from
--     presby_app and this suite runs as presby_app (F38).
begin;
  select set_config('app.current_org_id', :WESTERN_BASIN, true);

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
--     two-real-orgs discipline) lands the new row at its ACTUAL current
--     council (northern reach) and about itself; there is no parameter
--     through which it could target anywhere else.
--
--     REWRITTEN BY drizzle/0047. Two things this block used to assert have
--     moved and are now asserted in SECTION 34, where the publication
--     mechanism they belong to lives: the function now returns the
--     statistical_returns id rather than the congregation_statistics id, and
--     the republish chain is publications.supersedes_id (between EVENT rows)
--     rather than congregation_statistics.supersedes_publication_id (between
--     projection rows, a column 0047 drops). What stays here is the property
--     THIS section exists for — the confused-deputy shape — checked against
--     the projection exactly as before.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    v_return_id uuid;
    v_org_id    uuid;
    v_about_id  uuid;
  begin
    v_return_id := presby_publish_sasr_snapshot(
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
    -- this reason. The join key is the PUBLICATION now, since the function's
    -- return value is the artifact's id.
    select s.organization_id, s.about_org_id into v_org_id, v_about_id
      from presby_list_own_congregation_publications(2026) s
      join publications p on p.id = s.publication_id
     where p.artifact_id = v_return_id;

    if v_org_id is distinct from '11111111-1111-1111-1111-111111111111' -- :PRESBY, the ACTUAL current council
       or v_about_id is distinct from '22222222-2222-2222-2222-222222222222' -- :ALDER, the caller
    then
      raise exception 'FAIL — Alder Creek''s publication did not land at its actual current council (found organization_id=%, about_org_id=%)', v_org_id, v_about_id;
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: publication lands at the actual current council (northern reach), about the calling congregation — no parameter exists to redirect it';
  end $$;
rollback;

-- (f) presby_publish_sasr_snapshot() rejects an org with no CURRENT
--     AFFILIATION at all — northern reach itself (a real seeded presbytery
--     and a root council). Since drizzle/0047 the recipient is resolved by
--     presby_affiliation_parent_as_of(), never by organizations.parent_id;
--     the rejection text moved with it, the errcode did not.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2026, 'n/a');
    raise exception 'FAIL — an organization with no current affiliation was allowed to publish';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: an organization with no current affiliation is rejected';
  end $$;
rollback;

-- (g) presby_publish_sasr_snapshot() rejects a body whose parent exists but
--     is not a presbytery. The fixture CHANGED SHAPE at drizzle/0044: it was
--     an "Orphan Chapel", a congregation minted inline under a synod, and
--     that row is now unwritable on purpose — presby_assert_council_
--     authority() permits a synod to receive presbyteries only (G-3.0403(c)),
--     and presby_app can no longer insert into organizations at all (F38).
--     The Tidewater presbytery under the Coastal Plain synod
--     (scripts/seed-dev.sql) exercises the identical rejection branch with a
--     shape the polity allows.
begin;
  select set_config('app.current_org_id', :TIDEWATER, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2026, 'n/a');
    raise exception 'FAIL — a body whose current council is a synod, not a presbytery, was allowed to publish';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: a current-council organization_type other than presbytery is rejected';
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
--     for the same (organization, congregation, year). The "republish chain"
--     half of this proof moved to section 34(h) with drizzle/0047, where the
--     chain now lives (publications.supersedes_id).
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

-- ---------------------------------------------------------------------------
-- 31. Staff and personnel, database-admin schema layer (docs/work-log/
--     2026-08-27-staff-and-personnel.md, Phase 4 commit 1 (database-admin) /
--     Phase 5 QA loop-back fix / DECISION-128 (architect) / DECISION-129
--     (tech-lead)). drizzle/0039_presby_staff_and_personnel.sql; fixture rows
--     in scripts/seed-dev.sql (Marisol Windham's Church Secretary position at
--     Alder Creek, Idris Calloway's second, unrelated Part-Time Bookkeeper
--     position at Northern Reach). QA's Phase 5 pass confirmed this table had
--     zero coverage in this file despite two closer precedents
--     (officer_terms §7, appointments §28) both carrying full sections. Four
--     things:
--
--       (a) FORCE RLS tenant isolation — a congregation sees only its own
--           staff_positions row, a second congregation that employs no staff
--           (Bramblewood) sees zero, a cross-org read by known id returns
--           zero rather than a permission error, and a cross-org write
--           (naming a foreign organization_id while the session's own GUC
--           points elsewhere) is rejected by the WITH CHECK half — same
--           F21-shaped guarantee sections 19/27/28 already prove for their
--           own tables. Plus the FORCE RLS pg_class check and the
--           presby_app grant-shape check, same two proofs section 19/27/28
--           each run for their own sibling table.
--
--       (b) staff_positions_person_fk — the composite FK (F2): Tobias
--           Renwick (:CLERK) holds a membership at Alder Creek, NONE at the
--           presbytery — a staff position naming him at organization_id =
--           the presbytery must be rejected, the same F2 shape
--           appointments_person_fk already proved (section 28(e)) for the
--           identical composite-key pattern.
--
--       (c) staff_positions_no_overlap (F22) actually firing: a same-person/
--           org/title overlapping insert against Marisol Windham's existing
--           open-ended Church Secretary row is rejected with
--           exclusion_violation (same minimal do $$ ... exception when
--           exclusion_violation ... end $$; rollback; shape section 7's own
--           officer_terms_no_overlap proof uses), and a genuinely different
--           title for the same person/org/dates is NOT blocked — the
--           exclusion only guards a same-title double-open (Phase 1's own
--           "part-time secretary and part-time custodian" scenario), never
--           same-person/different-title overlap.
--
--       (d) KNOWN, ACCEPTED GAP — not a bug, not silently papered over.
--           position_key normalization (position.trim().toLowerCase()) is
--           computed by startStaffPosition() in application code
--           (src/lib/staff.ts), never DB-enforced. A raw-SQL insert that
--           bypasses startStaffPosition() and writes a position_key that was
--           never folded to lowercase does NOT trip the exclusion against an
--           existing lowercase row for what a human would call "the same
--           title" — proven here directly, confirming the exact residual
--           risk the architect's own Phase 2 review named ("a future
--           raw-SQL import bypassing startStaffPosition() could still write
--           two differently-cased colliding titles"), which both
--           api-developer's and ux-developer's Phase 4 slices carried
--           forward unchanged as accepted: no import surface exists yet for
--           this table, the same reasoning officer_terms.office's own
--           equality column has always relied on. If a raw-SQL import
--           surface is ever built for staff_positions, closing this gap
--           (e.g. a generated lower(position) column, or a BEFORE INSERT
--           trigger) should be reconsidered — not required today.
-- ---------------------------------------------------------------------------

-- (a) FORCE RLS tenant isolation, read side — the two real fixture rows,
--     each visible only from its own organization.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from staff_positions), 1,
                   'alder: sees its own staff_positions row (Marisol Windham, Church Secretary)');
  select assert_eq((select count(*) from staff_positions where organization_id <> :ALDER), 0,
                   'alder: sees NO foreign staff_positions rows');
commit;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq((select count(*) from staff_positions), 1,
                   'northern reach (presbytery): sees its own staff_positions row (Idris Calloway, Part-Time Bookkeeper)');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from staff_positions), 0,
                   'bramblewood: employs no staff, sees zero staff_positions rows');
  -- Known-id cross-org read, same discipline as sections 14/19/27/28's own
  -- known-id checks: naming another org's exact row id from bramblewood's
  -- own session returns zero, not a permission error that would confirm the
  -- row exists.
  select assert_eq((select count(*) from staff_positions where id = :STAFF_SECRETARY),
                   0, 'bramblewood: known-id cross-org read of alder''s staff position returns zero');
  select assert_eq((select count(*) from staff_positions where id = :STAFF_BOOKKEEPER),
                   0, 'bramblewood: known-id cross-org read of northern reach''s staff position returns zero');
commit;

-- The write side of tenant isolation: bramblewood cannot plant a
-- staff_positions row into alder's organization by naming alder's
-- organization_id in the INSERT, even while its own GUC is set to
-- bramblewood — the WITH CHECK clause on tenant_isolation rejects it, same
-- F21-shaped guarantee sections 4/19/27 already proved.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
    values ('22222222-2222-2222-2222-222222222222', -- alder creek, literal (dollar-quoted body)
            'c0000000-0000-0000-0000-000000000009', -- Marisol Windham
            'Hijacked Position', 'hijacked position', '2026-01-01');
    raise exception 'FAIL — bramblewood wrote a staff_positions row into alder''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  staff_positions tenant_isolation: cross-org write rejected';
  end $$;
rollback;

-- FORCE RLS specifically (F1).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'staff_positions' and relforcerowsecurity),
    1, 'staff_positions: FORCE row level security is set');
commit;

-- The presby_app grant shape, proven directly — full select/insert/update/
-- delete, same discipline as sections 19/27/28's own checks.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'staff_positions'
        and grantee = 'presby_app'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'staff_positions: presby_app has full select/insert/update/delete');
commit;

-- (b) staff_positions_person_fk — the composite FK (F2): Tobias Renwick
--     (:CLERK) holds a membership at Alder Creek, NONE at the presbytery — a
--     staff position naming him at organization_id = the presbytery must be
--     rejected, the same F2 shape appointments_person_fk already proved
--     (section 28(e)) for the identical composite-key pattern.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
    values ('11111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-000000000002', -- Tobias Renwick — no presbytery membership
            'Facilities Assistant', 'facilities assistant', '2026-01-01');
    raise exception 'FAIL F2 — a staff position referenced a person with no membership at the stated organization';
  exception when foreign_key_violation then
    raise notice 'pass  staff_positions_person_fk: person with no membership at the stated org rejected (F2)';
  end $$;
rollback;

-- (c) staff_positions_no_overlap (F22): same-person/org/title overlap fires;
--     a genuinely different title for the same person/org/dates does not.
--     Same minimal do $$ ... exception when exclusion_violation ... end $$;
--     rollback; shape section 7's own officer_terms_no_overlap proof uses.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
    values ('22222222-2222-2222-2222-222222222222',
            'c0000000-0000-0000-0000-000000000009', -- Marisol Windham, already Church Secretary since 2022-09-01, open-ended
            'Church Secretary', 'church secretary', '2026-01-01');
    raise exception 'FAIL — a same-title overlapping staff position was accepted';
  exception when exclusion_violation then
    raise notice 'pass  staff_positions_no_overlap: same-person/org/title overlap rejected';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
  values ('22222222-2222-2222-2222-222222222222',
          'c0000000-0000-0000-0000-000000000009', 'Custodian', 'custodian', '2026-01-01');
  select assert_eq(
    (select count(*) from staff_positions
      where organization_id = :ALDER and person_id = :ROLE_ADMIN_PERSON and position_key = 'custodian'),
    1, 'alder: a different concurrent title for the same person is NOT blocked by the exclusion');
rollback;

-- (d) KNOWN, ACCEPTED GAP: position_key folding is application-computed, not
--     DB-enforced (see the section header above). A raw-SQL insert with an
--     un-folded position_key does not collide with an existing lowercase row
--     for what a human would call "the same title" — proven, not assumed.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
  values ('22222222-2222-2222-2222-222222222222',
          'c0000000-0000-0000-0000-000000000009', 'CHURCH SECRETARY', 'CHURCH SECRETARY', '2026-01-01');
  select assert_eq(
    (select count(*) from staff_positions
      where organization_id = :ALDER and person_id = :ROLE_ADMIN_PERSON
        and position_key = 'CHURCH SECRETARY'),
    1, 'KNOWN GAP, accepted: a raw-SQL insert with an un-folded position_key (''CHURCH SECRETARY'') does not trip staff_positions_no_overlap against the existing lowercase ''church secretary'' row for the same person/org/dates — normalization is application-computed, not DB-enforced (no import surface exists yet for this table)');
rollback;

-- ---------------------------------------------------------------------------
-- 32. Organization lifecycle + council affiliation, database-admin schema
--     layer (docs/work-log/2026-09-24-lifecycle-affiliation-returns.md,
--     Phase 3 increments 1-2 / DECISION-135 through DECISION-139;
--     drizzle/0043_presby_org_identifiers.sql,
--     drizzle/0044_presby_org_lifecycle.sql).
--
-- Same discipline as every section since 2026-08-25: every mutating block
-- runs inside `begin; ... rollback;`, and every "expected rejection" wraps a
-- manual `raise exception 'FAIL — ...'` (default SQLSTATE P0001) in a handler
-- narrower than P0001, so a broken protection halts the whole script under
-- ON_ERROR_STOP instead of being swallowed as a NOTICE.
--
-- WHY SO MANY LITERAL UUIDS BELOW: psql does not interpolate :VARIABLES
-- inside dollar-quoted strings, so every id used inside a `do $$ ... $$`
-- block has to be written out. The \set names at the top of this file and
-- these literals are the same values.
-- ---------------------------------------------------------------------------

-- (a) FORCE RLS on both new tenant tables (F1).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('organization_lifecycle_events', 'organization_affiliations')
        and relforcerowsecurity),
    2, 'lifecycle: FORCE row level security is set on organization_lifecycle_events and organization_affiliations');
commit;

-- (b) F38 — THE GRANT SHAPE ON `organizations`, asserted directly.
--     Before drizzle/0044 the live database gave presby_app INSERT, UPDATE,
--     DELETE and SELECT on an un-RLS'd, un-triggered table, contradicting
--     drizzle/0009:93 and the premise this whole design rests on. The
--     four-privilege proof style of section 29, inverted: exactly ONE
--     privilege, and it is SELECT.
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organizations' and grantee = 'presby_app'),
    1, 'F38: presby_app holds exactly ONE privilege on organizations');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organizations' and grantee = 'presby_app'
        and privilege_type = 'SELECT'),
    1, 'F38: that one privilege is SELECT — insert/update/delete are revoked');
commit;

-- (c) F40 — the same proof for organization_affiliations (SELECT only: the
--     DEFINER function is the sole writer), and the append-only shape of
--     organization_lifecycle_events (SELECT + INSERT, never UPDATE/DELETE).
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_affiliations' and grantee = 'presby_app'),
    1, 'F40: presby_app holds exactly ONE privilege on organization_affiliations');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_affiliations' and grantee = 'presby_app'
        and privilege_type = 'SELECT'),
    1, 'F40: that one privilege is SELECT — presby_transfer_affiliation() is the only write path');
  -- NARROWED 2026-09-25: select, insert -> SELECT only. The INSERT grant was
  -- written when this table's INSERT was policy-mediated; F54/DECISION-141
  -- made it function-mediated (presby.lifecycle_write_active), the future
  -- presby_record_lifecycle_event() is SECURITY DEFINER and gains nothing
  -- from a tenant grant, and no application path inserts here. 32(k) below
  -- carries the behavioural half and the pointer to where the table's
  -- trigger/CHECK proofs moved.
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_lifecycle_events' and grantee = 'presby_app'
        and privilege_type = 'SELECT'),
    1, 'organization_lifecycle_events: presby_app has SELECT');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_lifecycle_events' and grantee = 'presby_app'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
    0, 'organization_lifecycle_events: and no INSERT, UPDATE or DELETE — append-only was already the rule (the roll_actions precedent); as of 2026-09-25 appending is function-mediated too');
commit;

-- (d) The three organizations guards, from the tenant connection. The
--     revoke in (b) already stops presby_app, so these prove the TRIGGER
--     layer is armed too — the owner path is what the triggers exist for,
--     and its half is proven in src/lib/org-provisioning.test.ts (that suite
--     runs on PLATFORM_DATABASE_URL, which is BYPASSRLS; BYPASSRLS exempts a
--     role from POLICIES, never from TRIGGERS).
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into organizations (organization_type, name, slug, path, platform_status)
    values ('congregation', 'Should Never Exist', 'guard-probe-insert', 'guard_probe_insert', 'unmanaged');
    raise exception 'FAIL — presby_app inserted into organizations';
  exception when insufficient_privilege then
    raise notice 'pass  organizations: presby_app cannot INSERT (F38 revoke)';
  end $$;

  do $$
  begin
    update organizations set parent_id = null
     where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL — presby_app updated organizations.parent_id';
  exception when insufficient_privilege then
    raise notice 'pass  organizations: presby_app cannot UPDATE parent_id (F38 revoke + reparent guard)';
  end $$;

  do $$
  begin
    delete from organizations where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL — presby_app deleted an organization';
  exception when insufficient_privilege then
    raise notice 'pass  organizations: presby_app cannot DELETE — an organization is permanent (the people-permanence twin)';
  end $$;
rollback;

-- (e) The affiliation table itself is unwritable from a tenant connection,
--     even by the council that owns the row.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from organization_affiliations
      where subject_org_id = '22222222-2222-2222-2222-222222222222'),
    1, 'northern reach: reads its own affiliation row for Alder Creek');
  select assert_eq(
    (select count(*) from organization_affiliations
      where organization_id = 'f6000000-0000-0000-0000-000000000001'),
    0, 'northern reach: cannot read the Southern Fields'' own affiliation row for Quillhaven (tenant_isolation)');
  do $$
  begin
    insert into organization_affiliations
      (organization_id, subject_org_id, parent_org_id, relationship_type,
       effective_from, authority, minute_reference)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'member_congregation',
            current_date, 'recorded', 'probe');
    raise exception 'FAIL — presby_app inserted directly into organization_affiliations';
  exception when insufficient_privilege then
    raise notice 'pass  organization_affiliations: direct INSERT is revoked (F40 — the EXCLUDE constraint would otherwise be a cross-tenant existence oracle)';
  end $$;
rollback;

--     The public projection deliberately reaches past tenant_isolation (who
--     belongs to which council is public, the same call `organizations`
--     itself makes) — but its COLUMN LIST is the enforcement point, so the
--     acting council's own record of WHY never rides along.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from organization_affiliations_public
      where subject_org_id = '44444444-4444-4444-4444-444444444444'),
    2, 'organization_affiliations_public: the projection shows BOTH of Quillhaven''s rows, including the Southern Fields'' own closed one, from the Northern Reach''s context');
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'organization_affiliations_public'
        and column_name in ('reason', 'minute_reference', 'concurrence_reference',
                            'closed_by_org_id', 'closed_by', 'closed_minute_reference',
                            'organization_id', 'recorded_by')),
    0, 'organization_affiliations_public: carries NONE of the acting council''s own record — no reason, no minute, no attribution, not even the owning org id');
commit;

-- (f) F40 — THE UNIFORM REJECTION MESSAGE. Every cause of a refused
--     transfer raises the same literal string and the same SQLSTATE, so a
--     probing caller cannot tell "you are not authorized" from "that
--     organization has no open affiliation" from "that id does not exist".
--     DECISION-040's byte-identical discipline, applied to a function.
--
--     Three causes, from Alder Creek's own context (a congregation, which
--     has standing over nothing):
--       1. an unauthorized actor, real subject, real new parent
--       2. a subject uuid that exists nowhere
--       3. a real subject with NO open affiliation (northern reach, a root)
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    m1 text; m2 text; m3 text;
    s1 text; s2 text; s3 text;
  begin
    begin
      perform presby_transfer_affiliation(
        '33333333-3333-3333-3333-333333333333',   -- bramblewood
        'f6000000-0000-0000-0000-000000000001',   -- southern fields
        'member_congregation', current_date, 'Some minute');
      raise exception 'FAIL — an unauthorized actor transferred an affiliation';
    exception when insufficient_privilege then
      m1 := sqlerrm; s1 := sqlstate;
    end;

    begin
      perform presby_transfer_affiliation(
        'dddddddd-dddd-dddd-dddd-dddddddddddd',   -- no such organization
        'f6000000-0000-0000-0000-000000000001',
        'member_congregation', current_date, 'Some minute');
      raise exception 'FAIL — a transfer naming a nonexistent subject was accepted';
    exception when insufficient_privilege then
      m2 := sqlerrm; s2 := sqlstate;
    end;

    begin
      perform presby_transfer_affiliation(
        '11111111-1111-1111-1111-111111111111',   -- northern reach: a root, no open affiliation
        'f6000000-0000-0000-0000-000000000001',
        'member_presbytery', current_date, 'Some minute');
      raise exception 'FAIL — a transfer of a subject with no open affiliation was accepted';
    exception when insufficient_privilege then
      m3 := sqlerrm; s3 := sqlstate;
    end;

    if m1 is distinct from 'organization_affiliations: this change is not permitted' then
      raise exception 'FAIL — unexpected rejection text: %', m1;
    end if;
    if m1 is distinct from m2 or m2 is distinct from m3 then
      raise exception 'FAIL — the rejection text VARIES by cause (% / % / %)', m1, m2, m3;
    end if;
    if s1 is distinct from s2 or s2 is distinct from s3 then
      raise exception 'FAIL — the SQLSTATE varies by cause (% / % / %)', s1, s2, s3;
    end if;
    raise notice 'pass  presby_transfer_affiliation: all three rejection causes raise the byte-identical string % with SQLSTATE % (F40)', m1, s1;
  end $$;
rollback;

--     And the function cannot be called with no org context at all — the
--     confused-deputy floor every DEFINER function in this codebase shares.
begin;
  do $$
  begin
    perform presby_transfer_affiliation(
      '22222222-2222-2222-2222-222222222222',
      'f6000000-0000-0000-0000-000000000001',
      'member_congregation', current_date, 'Some minute');
    raise exception 'FAIL — presby_transfer_affiliation ran with no org context';
  exception when insufficient_privilege then
    raise notice 'pass  presby_transfer_affiliation: no org context is refused with the same uniform message';
  end $$;
rollback;

-- (g) presby_org_affiliated() ACROSS A CLOSED HISTORICAL RANGE — the 1990
--     case, and the reason affiliation has history at all. Quillhaven was
--     the Southern Fields'' congregation until the 1995 boundary change and
--     has been the Northern Reach''s since (scripts/seed-dev.sql). A 1990
--     statistical return was received by the Southern Fields, and no amount
--     of reading organizations.parent_id can say so.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from (select presby_org_affiliated(
      '44444444-4444-4444-4444-444444444444',
      'f6000000-0000-0000-0000-000000000001', date '1990-01-01') as v) t where v),
    1, 'presby_org_affiliated: Quillhaven WAS affiliated with the Southern Fields in 1990');
  select assert_eq(
    (select count(*) from (select presby_org_affiliated(
      '44444444-4444-4444-4444-444444444444',
      '11111111-1111-1111-1111-111111111111', date '1990-01-01') as v) t where v),
    0, 'presby_org_affiliated: Quillhaven was NOT affiliated with the Northern Reach in 1990');
  select assert_eq(
    (select count(*) from (select presby_org_affiliated(
      '44444444-4444-4444-4444-444444444444',
      '11111111-1111-1111-1111-111111111111', current_date) as v) t where v),
    1, 'presby_org_affiliated: Quillhaven IS affiliated with the Northern Reach today');
  select assert_eq(
    (select count(*) from (select presby_org_affiliated(
      '44444444-4444-4444-4444-444444444444',
      'f6000000-0000-0000-0000-000000000001', current_date) as v) t where v),
    0, 'presby_org_affiliated: Quillhaven is NOT affiliated with the Southern Fields today');
  -- The closed row''s lower bound is NULL = unbounded below (F41). Without
  -- that, the whole pre-1901 archive would answer false.
  select assert_eq(
    (select count(*) from (select presby_org_affiliated(
      '44444444-4444-4444-4444-444444444444',
      'f6000000-0000-0000-0000-000000000001', date '1899-01-01') as v) t where v),
    1, 'F41: a null effective_from is UNBOUNDED BELOW — the Southern Fields answers true for 1899, not false');
  -- The recursive arm: a synod-level question three levels down.
  select assert_eq(
    (select count(*) from (select presby_org_affiliated(
      'f8000000-0000-0000-0000-000000000002',
      'f8000000-0000-0000-0000-000000000001', current_date) as v) t where v),
    1, 'presby_org_affiliated: the Tidewater presbytery resolves up to the Coastal Plain synod');
  -- presby_affiliation_parent_as_of(), the companion read.
  select assert_eq(
    (select count(*) from organizations
      where id = presby_affiliation_parent_as_of(
        '44444444-4444-4444-4444-444444444444', date '1990-01-01')
        and slug = 'southern-fields'),
    1, 'presby_affiliation_parent_as_of: Quillhaven''s 1990 parent is the Southern Fields');
  select assert_eq(
    (select count(*) from organizations
      where id = presby_affiliation_parent_as_of(
        '44444444-4444-4444-4444-444444444444', current_date)
        and slug = 'northern-reach'),
    1, 'presby_affiliation_parent_as_of: Quillhaven''s parent today is the Northern Reach');
commit;

-- (h) parent_id/path really are a CACHE of the open row, derived by the one
--     function — not a second, independently-written source of truth.
begin;
  select assert_eq(
    (select count(*) from organizations o
      join organization_affiliations a
        on a.subject_org_id = o.id and a.effective_to is null
     where o.parent_id is distinct from a.parent_org_id),
    0, 'derivation: every open affiliation''s parent_org_id equals its subject''s cached organizations.parent_id');
  select assert_eq(
    (select count(*) from organizations child
      join organizations parent on parent.id = child.parent_id
     where child.path <> parent.path || '.' || replace(child.slug, '-', '_')),
    0, 'derivation: every child''s path is its parent''s path plus its own label');
commit;

-- (i) The backfill-completeness assertion, re-run as a standalone proof
--     rather than trusted from drizzle/0044''s own DO block. Scoped to the
--     Northern Reach, because presby_app reads organization_affiliations
--     through tenant_isolation and cannot count another council''s rows —
--     the GLOBAL form of this assertion is the migration''s, and it is
--     re-proven on the owner connection in src/lib/org-provisioning.test.ts.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from organizations
      where parent_id = '11111111-1111-1111-1111-111111111111'),
    (select count(*) from organization_affiliations
      where parent_org_id = '11111111-1111-1111-1111-111111111111'
        and effective_to is null),
    'backfill completeness (northern reach): every org cached as its child has exactly one open affiliation row to it');
commit;

-- (j) organization_successions: THE GRANT SHAPE, pinned — Phase 5 Finding 1.
--
--     WHAT THIS BLOCK CAN AND CANNOT PROVE, stated up front so nobody reads
--     more into it than it earns. Until this fix, `presby_app` held SELECT,
--     INSERT and DELETE on a table with no RLS and no organization_id, and
--     QA reproduced the consequence: a council inserted a succession row
--     naming a lifecycle event it could not read. The defence is now TWO
--     layers, and a tenant connection only ever meets the first:
--
--       layer 1, THE GRANT — no INSERT/UPDATE/DELETE for presby_app at all.
--                Provable here, and proven below.
--       layer 2, THE TRIGGER — presby_check_succession_event() refuses an
--                event id the current org does not own, with the uniform
--                lifecycle literal. NOT provable from this suite: the grant
--                check fires first, so `presby_app` is refused before the
--                trigger runs. Its behavioural proof (a foreign event and a
--                nonexistent event raising byte-identically, from an owner
--                connection with app.current_org_id set to a foreign
--                council) lives in src/lib/db/domain/lifecycle.test.ts,
--                which is the only place the future DEFINER writer's
--                privilege level can be simulated. What IS proven here is
--                that the trigger EXISTS, is enabled, and is SECURITY
--                DEFINER — so a later migration silently dropping it trips
--                this suite.
--
--     Grant half, the 32(b)/(c)/(m) proof style: exactly ONE privilege for
--     presby_app, and it is SELECT (topology is public; the org tree already
--     publishes it).
begin;
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_successions' and grantee = 'presby_app'),
    1, 'Finding 1: presby_app holds exactly ONE privilege on organization_successions');
  select assert_eq(
    (select count(*) from information_schema.role_table_grants
      where table_name = 'organization_successions' and grantee = 'presby_app'
        and privilege_type = 'SELECT'),
    1, 'Finding 1: that one privilege is SELECT — the future presby_record_lifecycle_event() DEFINER function is the only tenant-side writer');
  -- presby_platform's half is read from pg_class.relacl rather than
  -- information_schema, which only shows grants involving the CURRENT role.
  -- Batch B's finding 5: it held UPDATE, which nothing ever asked for.
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'organization_successions'
        and a.grantee = 'presby_platform'::regrole
        and a.privilege_type in ('UPDATE', 'DELETE')),
    0, 'batch B finding 5: presby_platform has NO update and NO delete on organization_successions');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'organization_successions'
        and a.grantee = 'presby_platform'::regrole
        and a.privilege_type in ('SELECT', 'INSERT')),
    2, 'organization_successions: presby_platform is narrowed to select + insert');
commit;

--     ...and the grant is not theoretical: the tenant connection is refused
--     the INSERT that QA's repro used. This is LAYER 1 and says nothing
--     about the trigger — the message is Postgres'' own `permission denied`,
--     not the uniform lifecycle literal, precisely because the grant check
--     fires first.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into organization_successions (event_id, predecessor_org_id, successor_org_id)
    values ('fb000000-0000-0000-0000-000000000001',
            '44444444-4444-4444-4444-444444444444',
            '33333333-3333-3333-3333-333333333333');
    raise exception 'FAIL — presby_app inserted into organization_successions';
  exception when insufficient_privilege then
    raise notice 'pass  organization_successions: presby_app cannot INSERT at all (Phase 5 Finding 1, layer 1 — the grant, which fires BEFORE the event-scope trigger)';
  end $$;

  do $$
  begin
    delete from organization_successions where true;
    raise exception 'FAIL — presby_app deleted from organization_successions';
  exception when insufficient_privilege then
    raise notice 'pass  organization_successions: presby_app cannot DELETE either — the integrity half of Finding 1';
  end $$;
rollback;

--     Layer 2's STRUCTURE (not its behaviour): the three triggers exist and
--     are enabled, and the event-scope check is SECURITY DEFINER — it must
--     see past organization_lifecycle_events'' FORCE RLS, or it would read
--     zero rows for exactly the case it guards (F26).
begin;
  select assert_eq(
    (select count(*) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'organization_successions'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgname in ('organization_successions_event_scope',
                        'organization_successions_cardinality',
                        'organization_successions_freeze',
                        'organization_successions_guard')),
    4, 'organization_successions: all four triggers are present and enabled — event scope, deferred cardinality, freeze, and (2026-09-24, F54) the creation guard');
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_check_succession_event' and prosecdef),
    1, 'presby_check_succession_event is SECURITY DEFINER — it reads organization_lifecycle_events past that table''s FORCE RLS (F26)');
  select assert_eq(
    (select count(*) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'organization_successions'
       and t.tgname = 'organization_successions_cardinality'
       and t.tgdeferrable and t.tginitdeferred),
    1, 'succession cardinality is DEFERRABLE INITIALLY DEFERRED — a merged event''s second predecessor cannot exist when the first row is inserted, so an immediate check would make the legal case unwritable');
commit;

--     THE CARDINALITY BEHAVIOUR ITSELF MOVED, and here is why, so a reader
--     does not think it was dropped. It used to live in this block, inserting
--     succession rows as presby_app — which the Finding 1 revoke now forbids,
--     and no amount of rewriting makes a SELECT-only role insert. Both halves
--     (one predecessor fails at `set constraints all immediate`; two
--     predecessors and one successor pass) now run on the owner connection in
--     src/lib/db/domain/lifecycle.test.ts, alongside the event-scope and
--     freeze behaviour, for the same reason presby_freeze_lifecycle_event()'s
--     proof lives there.

-- (k) The lifecycle event's own rules — MOVED, and the move is the point.
--     presby_app held `select, insert` on organization_lifecycle_events until
--     2026-09-25; this block used that INSERT to reach the table's authority
--     trigger, its external-body CHECK and presby_apply_lifecycle_event()'s
--     cache maintenance. drizzle/0044 now grants presby_app SELECT ONLY (the
--     Phase 2 Ruling 1 shape organization_successions has carried since Phase
--     5 Finding 1), so the grant refuses before any trigger or CHECK can fire
--     and every one of those probes would pass, or fail, for the wrong reason.
--
--     They now run on the owner connection in
--     src/lib/db/domain/lifecycle.test.ts, under "the lifecycle event's own
--     rules (moved from test-rls.sql 32(k), 2026-09-25)": a council acting on
--     itself, a presbytery acting on a presbytery, the received/dismissed
--     external-body CHECK, and the whole dissolution path (the
--     lifecycle_status cache moves and is dated, the affiliation closes, the
--     derived parent_id follows it to null, and presby_org_affiliated() still
--     answers true for a date BEFORE the closure and false after — the
--     property that lets a dissolved congregation's 1990 return stay
--     attributable). Exactly the split 32(j) above already records for the
--     succession cardinality proofs, for exactly the same reason.
--
--     What stays here is the half only a tenant connection can show: that the
--     grant is the first thing a tenant meets, and that it is SELECT.
begin;
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('organization_lifecycle_events', 'organization_successions')
        and a.grantee = 'presby_app'::regrole),
    2, 'lifecycle tables: presby_app holds exactly TWO privileges in total across both — one each');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('organization_lifecycle_events', 'organization_successions')
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'SELECT'),
    2, 'lifecycle tables: and both of them are SELECT — organization_lifecycle_events lost its INSERT on 2026-09-25, so the two halves of the one immutable aggregate are finally consistent (Phase 2 Ruling 1: function-mediated, never policy-mediated)');
  -- presby_platform is UNCHANGED on both, and that is deliberate: it is the
  -- statement of intent for the day a real non-owner platform login exists,
  -- inert today because PLATFORM_DATABASE_URL authenticates as neondb_owner
  -- (F44).
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('organization_lifecycle_events', 'organization_successions')
        and a.grantee = 'presby_platform'::regrole
        and a.privilege_type in ('SELECT', 'INSERT')),
    4, 'lifecycle tables: presby_platform keeps select + insert on both, unchanged');
commit;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into organization_lifecycle_events
      (organization_id, subject_org_id, event, effective_on, minute_reference, recorded_by)
    values ('11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333',
            'organized', current_date, 'minute', 'e0000000-0000-0000-0000-0000000000f4');
    raise exception 'FAIL — presby_app inserted into organization_lifecycle_events';
  exception when insufficient_privilege then
    raise notice 'pass  organization_lifecycle_events: presby_app cannot INSERT at all — the grant fires BEFORE the authority trigger, the GUC guard and the CHECKs, which is why 32(k) behaviour moved to the owner connection';
  end $$;
rollback;

-- (l) organization_identifiers (D24, drizzle/0043): readable with NO org
--     context, the same visibility class as organizations itself — which is
--     the entire reason pcusa_pin moved off the tenant-isolated
--     organization_settings, where a presbytery running an import could not
--     read a member congregation's own PIN.
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'organization_identifiers' and (relrowsecurity or relforcerowsecurity)),
    0, 'organization_identifiers: deliberately NOT row-level secured (public org-tree identity data)');
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'organization_settings' and column_name = 'pcusa_pin'),
    0, 'D24: organization_settings.pcusa_pin is gone — it lives in organization_identifiers now');
commit;

-- (m) RULING A5 (the 2026-09-24 tech-lead amendment's correction to
--     drizzle/0044, applied to the same file and the same migration number).
--     Batch A resolved organization_lifecycle_events' immutability as
--     APPEND-ONLY BY GRANT and granted presby_platform full DML on both
--     lifecycle tables. A grant binds the two application roles; it does not
--     bind the OWNER, which holds every privilege by ownership and is the
--     role getPlatformDb()/MIGRATE_DATABASE_URL actually connect as. So the
--     grant is narrowed AND a freeze trigger fires on every connection.
begin;
  -- The narrowed grant: presby_platform keeps select + insert on both
  -- tables (createOrganization() writes the initial affiliation row) and
  -- loses update + delete on both.
  -- Read from pg_class.relacl, NOT information_schema.role_table_grants:
  -- that view shows only grants the CURRENT user is party to, so from the
  -- presby_app connection this suite runs as it returns nothing at all about
  -- presby_platform. aclexplode() over the catalog is role-neutral.
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('organization_lifecycle_events', 'organization_affiliations')
        and a.grantee = 'presby_platform'::regrole
        and a.privilege_type in ('UPDATE', 'DELETE')),
    0, 'A5: presby_platform holds NO update/delete on organization_lifecycle_events or organization_affiliations');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('organization_lifecycle_events', 'organization_affiliations')
        and a.grantee = 'presby_platform'::regrole
        and a.privilege_type in ('SELECT', 'INSERT')),
    4, 'A5: presby_platform keeps select + insert on both — createOrganization()''s affiliation INSERT is the whole reason it exists');
  -- The freeze trigger is present, ENABLED, row-level, BEFORE, and armed on
  -- both UPDATE and DELETE (tgtype bits: 1 row, 2 before, 8 delete, 16
  -- update). This suite runs as presby_app and therefore cannot execute the
  -- owner-path rejection itself — the behavioural half (an UPDATE and a
  -- DELETE by neondb_owner both raising) is proven in
  -- src/lib/db/domain/lifecycle.test.ts, which runs on PLATFORM_DATABASE_URL.
  -- Same split drizzle/0044's delete guard already uses (block (d) above).
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'organization_lifecycle_events'
        and t.tgname = 'organization_lifecycle_events_freeze'
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16),
    1, 'A5: organization_lifecycle_events_freeze is a row-level BEFORE UPDATE OR DELETE trigger and is enabled (the roll_actions_freeze standard)');
  -- RULING A5.3 IS SUPERSEDED IN PART (F49 / DECISION-140, 2026-09-24). A5.3
  -- said organization_affiliations needs no trigger because closing a row is
  -- a legitimate UPDATE and the narrowed grant stops everyone else. F44 —
  -- found later in this same pipeline — says the grant stops nobody who can
  -- actually reach the database, because PLATFORM_DATABASE_URL connects as
  -- neondb_owner. So there is still no FREEZE (a close remains legitimate)
  -- but there is now a GUARD, which is the distinction the names carry.
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'organization_affiliations' and t.tgname like '%freeze%'),
    0, 'A5.3 still holds in part: organization_affiliations has NO unconditional FREEZE — closing a row is a legitimate act, unlike a lifecycle event');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'organization_affiliations'
        and t.tgname = 'organization_affiliations_guard'
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16),
    1, 'F49: organization_affiliations_guard IS a row-level BEFORE UPDATE OR DELETE trigger and is enabled — the grant narrowing never bound neondb_owner (F44), so the owner path needed a mechanism of its own');
commit;

-- (n) F47 — organization_identifiers gains a write-authority model
--     (DECISION-140, 2026-09-24). It shipped in drizzle/0043 with
--     `select, insert, update, delete` to presby_app and no RLS, which meant
--     a tenant connection could rewrite or erase ANOTHER organization's
--     identifier — including flipping is_verified, the column the partial
--     unique index makes globally significant.
begin;
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'organization_identifiers'
        and a.grantee = 'presby_app'::regrole),
    1, 'F47: presby_app holds exactly ONE privilege on organization_identifiers');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'organization_identifiers'
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'SELECT'),
    1, 'F47: that one privilege is SELECT — presby_set_organization_identifier() is the only tenant-side write path');
  -- presby_platform keeps its DML, unchanged: the same accepted-risk class as
  -- its grants on organization_affiliations and organization_successions —
  -- intent for the day a real non-owner presby_platform login exists.
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'organization_identifiers'
        and a.grantee = 'presby_platform'::regrole
        and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
    4, 'F47: presby_platform keeps select/insert/update/delete — documented intent, inert today, and never the thing that closes the hole');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'organization_identifiers'
        and t.tgname = 'organization_identifiers_guard'
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 4) = 4
        and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16),
    1, 'F58: organization_identifiers_guard is an enabled row-level BEFORE INSERT OR UPDATE OR DELETE trigger — widened from UPDATE/DELETE on 2026-09-24 (DECISION-141), because creation of an identifier claim is as much an authorized act as changing one, and the revoke does not bind the owner (F44)');
  -- A NEW GUC, not a reuse of presby.affiliation_trigger_active: unrelated
  -- table, unrelated subsystem, no shared transaction in practice.
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_set_organization_identifier'
        and prosecdef
        and pg_get_functiondef(oid) like '%presby.identifier_trigger_active%'),
    1, 'F47: presby_set_organization_identifier() is SECURITY DEFINER and arms its OWN guard flag, not the affiliation one');
commit;

--     The tenant half, behaviourally.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    update organization_identifiers set is_verified = true;
    raise exception 'FAIL — presby_app updated an organization_identifiers row directly';
  exception when insufficient_privilege then
    raise notice 'pass  F47: presby_app cannot UPDATE an identifier directly — not even its own, and certainly not another congregation''s is_verified';
  end $$;

  do $$
  begin
    delete from organization_identifiers;
    raise exception 'FAIL — presby_app deleted organization_identifiers rows directly';
  exception when insufficient_privilege then
    raise notice 'pass  F47: presby_app cannot DELETE an identifier directly';
  end $$;
rollback;

--     THE AUTHORIZATION MATRIX of the one sanctioned writer. Rolled back, so
--     nothing durable is written — an identifier row is guarded against
--     DELETE on every connection, so a row committed here could not be
--     cleaned up without disarming a global trigger.
begin;
  -- 1. An organization writing its OWN identifier: permitted.
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare v_id uuid;
  begin
    v_id := presby_set_organization_identifier(
      '22222222-2222-2222-2222-222222222222', 'pcusa_pin', '10000001', false,
      'test-rls.sql fixture');
    if v_id is null then
      raise exception 'FAIL — a congregation could not write its own identifier';
    end if;
    raise notice 'pass  F47: an organization may assert its own external identifier through presby_set_organization_identifier()';
  end $$;

  -- 2. The SAME function is the only path that may flip is_verified, and it
  --    reaches an existing row through the guard it armed itself.
  do $$
  declare v_id uuid;
  begin
    v_id := presby_set_organization_identifier(
      '22222222-2222-2222-2222-222222222222', 'pcusa_pin', '10000001', true, null);
    if not exists (select 1 from organization_identifiers
                    where id = v_id and is_verified) then
      raise exception 'FAIL — the sanctioned writer could not set is_verified';
    end if;
    raise notice 'pass  F47: is_verified is settable ONLY through the sanctioned writer, whose own UPDATE passes the guard it arms';
  end $$;

  -- 3. A COUNCIL WITH STANDING over the subject: permitted (the onboarding
  --    case — a presbytery recording a member congregation's OGA PIN).
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  declare v_id uuid;
  begin
    v_id := presby_set_organization_identifier(
      '22222222-2222-2222-2222-222222222222', 'psvonline_congregation_id', '4242', true,
      'test-rls.sql fixture');
    if v_id is null then
      raise exception 'FAIL — a council with affiliation standing could not verify a member congregation''s identifier';
    end if;
    raise notice 'pass  F47: a council with presby_org_affiliated() standing over the subject may write and verify its identifier — the onboarding case';
  end $$;

  -- 4. A PEER congregation: refused, with the table's own uniform literal.
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  declare m text;
  begin
    begin
      perform presby_set_organization_identifier(
        '22222222-2222-2222-2222-222222222222', 'pcusa_pin', '99999999', true, null);
      raise exception 'FAIL — a peer congregation wrote another congregation''s identifier';
    exception when insufficient_privilege then
      get stacked diagnostics m = message_text;
    end;
    if m <> 'organization_identifiers: this change is not permitted' then
      raise exception 'FAIL — the rejection did not use organization_identifiers'' own uniform literal: %', m;
    end if;
    raise notice 'pass  F47: a peer organization is refused, with ONE literal per table (DECISION-139) — not the affiliation table''s string, which would invite a reader to treat the two rejection surfaces as interchangeable';
  end $$;

  -- 5. No org context at all: the same literal, so an unauthenticated probe
  --    learns nothing a peer would not.
  select set_config('app.current_org_id', '', true);
  do $$
  begin
    perform presby_set_organization_identifier(
      '22222222-2222-2222-2222-222222222222', 'pcusa_pin', '99999999', true, null);
    raise exception 'FAIL — presby_set_organization_identifier ran with no org context';
  exception when insufficient_privilege then
    raise notice 'pass  F47: no org context is refused with the same uniform message';
  end $$;
rollback;

-- (o) F48/F49 — the succession edge UNIQUE and the affiliation row-shape
--     CHECKs, in the catalog. Their BEHAVIOUR is proven on the owner
--     connection (src/lib/db/domain/lifecycle.test.ts): presby_app holds no
--     INSERT on either table, so every attempted violation from here would be
--     refused by the permission check before the constraint could fire.
begin;
  select assert_eq(
    (select count(*) from pg_constraint
      where conname = 'organization_successions_edge_unique' and contype = 'u'),
    1, 'F48: organization_successions carries UNIQUE (event_id, predecessor_org_id, successor_org_id) — one edge recorded twice is one fact written twice');
  select assert_eq(
    (select count(*) from pg_constraint
      where conname in ('organization_affiliations_range_order',
                        'organization_affiliations_closed_shape',
                        'organization_affiliations_not_self')
        and contype = 'c'),
    3, 'F49: the three affiliation row-shape CHECKs exist — empty range, unattributed close, and a body that is its own council');
  -- The FOURTH check F49 named (authority = recorded => effective_from not
  -- null) is DELIBERATELY ABSENT, and this assertion pins that so its absence
  -- reads as a decision rather than as a missed line. Its premise is false in
  -- this repository: the Quillhaven fixture is a MINUTED historical row whose
  -- start predates the records, and section 32(g) above asserts exactly that
  -- unbounded-below behaviour (F41). See the note in drizzle/0044 and the
  -- loop-back candidate in the work-log.
  select assert_eq(
    (select count(*) from pg_constraint
      where conname = 'organization_affiliations_recorded_has_from'),
    0, 'F49 (partial, deliberate): organization_affiliations_recorded_has_from is NOT added — it contradicts F41''s unbounded-below rule, which section 32(g) asserts on a real minuted fixture row');
  -- Read from the SOUTHERN FIELDS' own context: it is that council's row, and
  -- tenant_isolation would hide it from anyone else.
  select set_config('app.current_org_id', :SOUTHERN_FIELDS, true);
  select assert_eq(
    (select count(*) from organization_affiliations
      where authority = 'recorded' and effective_from is null),
    1, 'F41/F49: a MINUTED affiliation whose start predates the records really exists in the fixture — the shape the fourth CHECK would have outlawed');
commit;

--     The tenant half, behaviourally: presby_app cannot reach either verb on
--     organization_affiliations either, so the guard trigger is belt-and-
--     braces from this side and load-bearing only on the owner path.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    update organization_affiliations set minute_reference = 'tamper'
     where organization_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL — presby_app updated an organization_affiliations row';
  exception when insufficient_privilege then
    raise notice 'pass  F49: presby_app cannot UPDATE an affiliation row (the belt) — the guard trigger is what binds the owner (the buckle)';
  end $$;

  do $$
  begin
    delete from organization_affiliations
     where organization_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL — presby_app deleted an organization_affiliations row';
  exception when insufficient_privilege then
    raise notice 'pass  F49: presby_app cannot DELETE an affiliation row';
  end $$;
rollback;

--     THE REGRESSION THAT MATTERS: the GUC moved to the top of
--     presby_transfer_affiliation(), and the new guard now gates the close
--     that function performs BEFORE it reaches the derivation call that used
--     to arm the flag. If the move were wrong, the sanctioned path would
--     refuse itself. Exercised through the CORRECTION branch (same parent,
--     actor = that parent), which is the one positive path this fixture's
--     two rootless presbyteries can reach.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  declare v_new uuid;
  begin
    v_new := presby_transfer_affiliation(
      '22222222-2222-2222-2222-222222222222',   -- alder creek
      '11111111-1111-1111-1111-111111111111',   -- the same parent: a CORRECTION
      'member_congregation',
      current_date,
      'Northern Reach stated meeting, fixture, item 11',
      'F49 regression: the sanctioned path still closes and reopens');
    if v_new is null then
      raise exception 'FAIL — presby_transfer_affiliation returned null';
    end if;
    raise notice 'pass  F49 regression: presby_transfer_affiliation() still closes the old row and opens the new one with organization_affiliations_guard in place — it arms the GUC at its own entry, ahead of its own UPDATE';
  end $$;
  select assert_eq(
    (select count(*) from organization_affiliations
      where subject_org_id = :ALDER
        and effective_to = current_date
        and closed_by_org_id is not null
        and closed_on is not null
        and closed_minute_reference is not null),
    1, 'F49: the close the sanctioned path writes satisfies organization_affiliations_closed_shape — closed_by_org_id, closed_on and closed_minute_reference together (closed_by excluded, Ruling A4)');
  select assert_eq(
    (select count(*) from organization_affiliations
      where subject_org_id = :ALDER and effective_to is null
        and closed_by_org_id is null and closed_on is null
        and closed_minute_reference is null),
    1, 'F49: the OPEN row carries no close attribution at all — the other arm of the same CHECK');
rollback;

--     ...and the same-day close the range-order CHECK forbids is refused
--     EARLY, with the uniform literal, rather than late with a raw
--     constraint name (the `>=` tightening in presby_transfer_affiliation()).
--     Alder Creek's open row starts 1962-05-01, so closing it ON that date is
--     the empty-range case: daterange('1962-05-01','1962-05-01','[)') is
--     valid, EMPTY, overlaps nothing, and so violates no EXCLUDE constraint.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  declare m text;
  begin
    begin
      perform presby_transfer_affiliation(
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'member_congregation',
        date '1962-05-01',
        'Northern Reach stated meeting, fixture, item 12');
      raise exception 'FAIL — a same-day open-and-close was accepted, producing an EMPTY daterange the EXCLUDE constraint cannot see';
    exception when insufficient_privilege then
      get stacked diagnostics m = message_text;
    end;
    if m <> 'organization_affiliations: this change is not permitted' then
      raise exception 'FAIL — the same-day close leaked a constraint name instead of the uniform literal: %', m;
    end if;
    raise notice 'pass  F49: a close falling ON the row''s own opening is refused with the UNIFORM literal — the CHECK is the backstop, the function is what keeps F40''s one-message-per-table discipline';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 33. The about-org enforcing trigger — increment 3 (docs/work-log/
--     2026-09-24-lifecycle-affiliation-returns.md, Phase 3 Data Model
--     "Increment 3" / R3.14; drizzle/0045_presby_about_org_affiliation.sql).
--
--     Four shipped tables carry a row ABOUT another organization. Until this
--     migration the only thing standing between "the presbytery's own rows"
--     and "a row about an organization that was never its member" was an
--     application-layer parent_id check in two TypeScript modules. Now it is
--     a database property, answered from the AFFILIATION HISTORY — which is
--     what lets a 1990 return resolve to the council that received it in
--     1990 rather than to whoever holds the congregation today.
-- ---------------------------------------------------------------------------

-- (a) All four triggers exist and are enabled. per_capita_rates is NOT among
--     them and cannot be: Phase 3's Data Model names it as one of the five
--     tables, but it has no about-org column at all (one row per presbytery
--     per billing year — there is nothing to check). Asserted by name so the
--     absence reads as a finding, not an oversight.
begin;
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname in ('congregation_oversight_about_org',
                         'congregation_statistics_about_org',
                         'per_capita_records_about_org',
                         'appointments_about_org')
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16),
    4, 'about-org: four enabled row-level BEFORE INSERT OR UPDATE triggers (congregation_oversight, congregation_statistics, per_capita_records, appointments)');
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'per_capita_rates' and column_name = 'about_org_id'),
    0, 'about-org: per_capita_rates carries NO about_org_id — Phase 3 named it as a fifth table in error; a rate is per presbytery per billing year');
commit;

-- (b) A row about an organization this council was NEVER affiliated with is
--     rejected. Tidewater is a presbytery under the Coastal Plain synod and
--     has never had anything to do with the Northern Reach.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into congregation_statistics
      (organization_id, about_org_id, year, provenance, ending_active)
    values ('11111111-1111-1111-1111-111111111111',
            'f8000000-0000-0000-0000-000000000002', 2025, 'presbytery_entered', 10);
    raise exception 'FAIL — a statistics row was written about a never-affiliated organization';
  exception when insufficient_privilege then
    raise notice 'pass  congregation_statistics: a row about a never-affiliated organization is refused';
  end $$;

  do $$
  begin
    insert into congregation_oversight
      (organization_id, about_org_id, viability_score, updated_by)
    values ('11111111-1111-1111-1111-111111111111',
            'f8000000-0000-0000-0000-000000000002', 3,
            'e0000000-0000-0000-0000-0000000000f4');
    raise exception 'FAIL — an oversight row was written about a never-affiliated organization';
  exception when insufficient_privilege then
    raise notice 'pass  congregation_oversight: a row about a never-affiliated organization is refused (as of current_date)';
  end $$;

  do $$
  begin
    insert into appointments
      (organization_id, person_id, serving_org_id, call_type, starts_on, minute_reference)
    values ('11111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-000000000006',
            'f8000000-0000-0000-0000-000000000002',
            'stated_supply', current_date, 'probe');
    raise exception 'FAIL — an appointment was recorded at a never-affiliated organization';
  exception when insufficient_privilege then
    raise notice 'pass  appointments: serving_org_id must be a current member congregation/NWC of the recording presbytery';
  end $$;
rollback;

-- (c) THE 1990 CASE, APPLIED TO THE ABOUT-ORG TABLES — the whole reason the
--     statistics arm asks the question AS OF THE ROW'S YEAR rather than
--     today. Quillhaven was the Southern Fields' congregation until the 1995
--     boundary change and has been the Northern Reach's since.
begin;
  select set_config('app.current_org_id', :SOUTHERN_FIELDS, true);
  -- Inside the historical range: ACCEPTED, even though organizations.
  -- parent_id says the Northern Reach holds Quillhaven today.
  insert into congregation_statistics
    (organization_id, about_org_id, year, provenance, ending_active)
  values ('f6000000-0000-0000-0000-000000000001',
          '44444444-4444-4444-4444-444444444444', 1990, 'imported', 118);
  select assert_eq(
    (select count(*) from congregation_statistics
      where organization_id = :SOUTHERN_FIELDS and about_org_id = :QUILLHAVEN and year = 1990),
    1, 'about-org (the 1990 case): the Southern Fields MAY record Quillhaven''s 1990 statistics — the council that received the return keeps it');

  -- After the affiliation closed: REFUSED.
  do $$
  begin
    insert into congregation_statistics
      (organization_id, about_org_id, year, provenance, ending_active)
    values ('f6000000-0000-0000-0000-000000000001',
            '44444444-4444-4444-4444-444444444444', 2020, 'imported', 40);
    raise exception 'FAIL — the Southern Fields recorded 2020 statistics for a congregation it lost in 1995';
  exception when insufficient_privilege then
    raise notice 'pass  about-org: an affiliation that closed BEFORE the row''s year refuses the row (Southern Fields, Quillhaven, 2020)';
  end $$;

  -- And a per-capita bill for a billing year after the transfer, likewise.
  do $$
  begin
    insert into per_capita_records
      (organization_id, about_org_id, billing_year, basis_year,
       ending_active_basis, rate_applied, amount_owed)
    values ('f6000000-0000-0000-0000-000000000001',
            '44444444-4444-4444-4444-444444444444', 2026, 2024, 40, 12.50, 500.00);
    raise exception 'FAIL — the Southern Fields billed a congregation it lost in 1995';
  exception when insufficient_privilege then
    raise notice 'pass  per_capita_records: billing_year is the as_of — a bill cannot be issued to a congregation that had left by then';
  end $$;
rollback;

-- (d) The present-tense arm accepts a real member congregation. Fernwood is
--     the Northern Reach's and has no oversight row of its own yet.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  insert into congregation_oversight
    (organization_id, about_org_id, viability_score, updated_by)
  values ('11111111-1111-1111-1111-111111111111',
          '55555555-5555-5555-5555-555555555555', 3,
          'e0000000-0000-0000-0000-0000000000f4');
  select assert_eq(
    (select count(*) from congregation_oversight
      where organization_id = :PRESBY and about_org_id = :FERNWOOD),
    1, 'about-org: an oversight row about a CURRENT member congregation is accepted');
rollback;

-- (e) UNIFORM ACROSS CAUSES (F40's discipline, applied to this trigger). "No
--     such organization", "never affiliated" and "the affiliation closed
--     before this year" are one message. Deliberately NOT opaque the way
--     presby_deny_affiliation_change() is: `organizations` (parent_id
--     included) and organization_affiliations_public are readable by any
--     tenant connection, so there is no fact here a caller could not already
--     SELECT — see drizzle/0045's own note.
begin;
  select set_config('app.current_org_id', :SOUTHERN_FIELDS, true);
  do $$
  declare
    m1 text; m2 text; m3 text;
    s1 text; s2 text; s3 text;
  begin
    begin
      insert into congregation_statistics
        (organization_id, about_org_id, year, provenance, ending_active)
      values ('f6000000-0000-0000-0000-000000000001',
              'dddddddd-dddd-dddd-dddd-dddddddddddd', 2020, 'imported', 1);
      raise exception 'FAIL — a statistics row named a nonexistent organization';
    exception when insufficient_privilege then
      m1 := sqlerrm; s1 := sqlstate;
    end;

    begin
      insert into congregation_statistics
        (organization_id, about_org_id, year, provenance, ending_active)
      values ('f6000000-0000-0000-0000-000000000001',
              'f8000000-0000-0000-0000-000000000002', 2020, 'imported', 1);
      raise exception 'FAIL — a statistics row named a never-affiliated organization';
    exception when insufficient_privilege then
      m2 := sqlerrm; s2 := sqlstate;
    end;

    begin
      insert into congregation_statistics
        (organization_id, about_org_id, year, provenance, ending_active)
      values ('f6000000-0000-0000-0000-000000000001',
              '44444444-4444-4444-4444-444444444444', 2020, 'imported', 1);
      raise exception 'FAIL — a statistics row named a congregation whose affiliation had closed';
    exception when insufficient_privilege then
      m3 := sqlerrm; s3 := sqlstate;
    end;

    if m1 is distinct from m2 or m2 is distinct from m3 then
      raise exception 'FAIL — the about-org rejection text VARIES by cause (% / % / %)', m1, m2, m3;
    end if;
    if s1 is distinct from s2 or s2 is distinct from s3 then
      raise exception 'FAIL — the about-org SQLSTATE varies by cause (% / % / %)', s1, s2, s3;
    end if;
    raise notice 'pass  about-org: all three rejection causes raise the byte-identical string % with SQLSTATE %', m1, s1;
  end $$;
rollback;

-- (f) The UPDATE arm. A payment posting on an existing bill is NOT re-checked
--     (it moves neither the about-org nor the year), but RE-POINTING a row at
--     another organization is.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  update per_capita_records set paid_status = 'partial', paid_amount = 100.00
   where id = :PER_CAPITA_RECORD;
  select assert_eq(
    (select count(*) from per_capita_records
      where id = :PER_CAPITA_RECORD and paid_status = 'partial'),
    1, 'about-org (UPDATE arm): posting a payment on an existing bill is not re-checked — the about-org and billing_year did not move');

  do $$
  begin
    update per_capita_records
       set about_org_id = 'f8000000-0000-0000-0000-000000000002'
     where id = 'a6000000-0000-0000-0000-000000000001';
    raise exception 'FAIL — a bill was re-pointed at a never-affiliated organization';
  exception when insufficient_privilege then
    raise notice 'pass  about-org (UPDATE arm): re-pointing about_org_id IS re-checked and refused';
  end $$;
rollback;

-- (g) THE COUPLING PHASE 2 CALLED THIS PIPELINE'S RISKIEST (Notes item 3),
--     proven at the database rather than argued. src/lib/presbytery.ts:143,
--     169 and src/lib/credentials.ts:522,710 answer "is X my member
--     congregation?" with `organizations.parent_id = organizationId`; this
--     trigger answers it with presby_org_affiliated(). At current_date the
--     two answers MUST be identical for every row, or a presbytery's own UI
--     offers a congregation the database then refuses. Scoped to the
--     Northern Reach here (presby_app reads organizations globally, but the
--     global form is re-proven on the owner connection in
--     src/lib/db/domain/lifecycle.test.ts).
begin;
  select assert_eq(
    (select count(*) from organizations o
      where o.parent_id = '11111111-1111-1111-1111-111111111111'
        and not presby_org_affiliated(o.id, o.parent_id, current_date)),
    0, 'coupling: every org the parent_id cache calls a child of the Northern Reach is affiliated with it TODAY (the UI and the trigger agree)');
  select assert_eq(
    (select count(*) from organizations o
      where o.parent_id is distinct from '11111111-1111-1111-1111-111111111111'
        and presby_org_affiliated(o.id, '11111111-1111-1111-1111-111111111111', current_date)
        and o.parent_id is null),
    0, 'coupling: no ROOT organization answers affiliated-today to the Northern Reach (the cache is not missing a row)');
commit;

-- ---------------------------------------------------------------------------
-- 34. Statistical returns and publication — increments 4 and 5 (docs/
--     work-log/2026-09-24-lifecycle-affiliation-returns.md, Phase 3 Data
--     Model "Increment 4"/"Increment 5"; D12/D20/D25/F36/F39;
--     DECISION-135/137/138; drizzle/0046_presby_statistical_returns.sql and
--     drizzle/0047_presby_publications.sql).
--
--     Publication is now THREE rows written by one DEFINER function in one
--     transaction: the artifact (statistical_returns, owned by the
--     congregation), the event (publications, owned by the congregation,
--     addressed to the recipient council), and the projection
--     (congregation_statistics, owned by the recipient). This section proves
--     the properties that only exist BETWEEN them — the recipient can read
--     what was published TO IT and nothing else, the projection's copy of the
--     event's facts is exact, and the payload is a closed allow-list rather
--     than a jsonb column with a nice comment.
--
--     WHAT IS DELIBERATELY NOT HERE, and where it lives instead. Two
--     protections cannot be demonstrated from this connection at all, for the
--     same reason batch A's deviation 14 and batch B's deviation 10 record:
--     presby_app holds no UPDATE/DELETE on either new table, so its rejection
--     arrives from the PERMISSION CHECK before the freeze trigger ever fires,
--     and withdrawal (the one legitimate UPDATE) has no tenant-side path at
--     all. This section therefore asserts the grant shape and the triggers'
--     catalog shape; src/lib/db/domain/publication.test.ts proves the
--     behaviour on PLATFORM_DATABASE_URL.
-- ---------------------------------------------------------------------------

-- (a) The isolation and grant shape of all three new tables. sasr_form_versions
--     is deliberately the odd one out: platform-wide reference data in the
--     class of `permissions`, so no RLS and SELECT only.
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('statistical_returns', 'publications')
        and relrowsecurity and relforcerowsecurity),
    2, 'returns/publications: FORCE row level security is set on both new tenant tables (F1)');
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'sasr_form_versions' and (relrowsecurity or relforcerowsecurity)),
    0, 'sasr_form_versions: NO row level security — a form revision is platform-wide reference data, not a council''s property');

  -- READ-ONLY BY GRANT: SELECT and nothing else, on both tables and both
  -- application roles. A second privilege appearing here is the F38
  -- additive-grant mechanism re-widening something, and this assertion is
  -- what catches it.
  --
  -- TIGHTENED 2026-09-24 (F50/F51/DECISION-140): INSERT was revoked from both
  -- roles on both tables. The submitted path is presby_publish_sasr_
  -- snapshot() (SECURITY DEFINER, so the revoke cannot reach it); the
  -- imported path has no application writer until D13's import function
  -- ships, and that one is DEFINER too. Leaving INSERT granted alongside a
  -- DEFINER writer was the half-applied function-mediation DECISION-135
  -- already corrected on organization_affiliations.
  --
  -- Read from pg_class.relacl, NOT information_schema.role_table_grants:
  -- that view shows only grants the CURRENT user is party to, so from the
  -- presby_app connection this suite runs as it says nothing at all about
  -- presby_platform. Same catalog read section 32(m) uses.
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('statistical_returns', 'publications')
        and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
        and a.privilege_type = 'SELECT'),
    4, 'returns/publications: presby_app and presby_platform each hold SELECT on both tables');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('statistical_returns', 'publications')
        and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
        and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
    0, 'F50/F51: NEITHER role holds INSERT, UPDATE or DELETE on either table — every write is function-mediated, and withdrawal has no tenant-side path at all');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'sasr_form_versions'
        and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
        and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
    0, 'sasr_form_versions: written only by migration — neither application role may insert, update or delete a form revision');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'sasr_form_versions'
        and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
        and a.privilege_type = 'SELECT'),
    2, 'sasr_form_versions: both application roles may READ the form catalog — the field_spec is reference data, not a secret');

  -- The freeze triggers' catalog shape, since their behaviour on the owner
  -- path is unprovable from here (see this section's header).
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname in ('statistical_returns_freeze', 'publications_freeze')
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16),
    2, 'returns/publications: both freeze triggers are enabled, row-level, BEFORE, and armed on UPDATE and DELETE');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'statistical_returns'
        and t.tgname in ('statistical_returns_field_spec', 'statistical_returns_about_org')
        and t.tgenabled = 'O'),
    2, 'statistical_returns: the field-spec gate and the imported-row about-org check are both enabled');

  -- sasr_reports is gone (Ruling 6 / DECISION-137).
  select assert_eq(
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'sasr_reports'),
    0, 'sasr_reports: dropped — zero rows, zero consumers, a shape stale under D25');
  -- ...and so is the projection self-chain it used to pair with.
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'congregation_statistics' and column_name = 'supersedes_publication_id'),
    0, 'congregation_statistics: supersedes_publication_id is dropped — the chain is between EVENTS now (publications.supersedes_id)');
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'congregation_statistics' and column_name in ('published_at', 'minute_reference')),
    2, 'congregation_statistics: published_at and minute_reference STAY (F39) — round 3 was wrong to move them into a table the presbytery cannot read');

  -- WITHDRAWAL CARRIES PROVENANCE (spec addition, external design review
  -- 2026-09-24). Three columns, not one: a withdrawal is itself a minuted act,
  -- so it records who and under which minute — DECISION-135's
  -- affiliation-close shape (closed_by_org_id / closed_by / closed_on /
  -- closed_minute_reference) applied to a publication, for the same reason.
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'publications'
        and column_name in ('withdrawn_at', 'withdrawn_by', 'withdrawn_minute_reference')),
    3, 'publications: withdrawal is a minuted ACT — withdrawn_at, withdrawn_by and withdrawn_minute_reference, not a bare timestamp');
  select assert_eq(
    (select count(*) from pg_constraint where conname = 'publications_withdrawal_shape'),
    1, 'publications_withdrawal_shape: a withdrawer or a withdrawal minute cannot exist on a row that is not actually withdrawn');
  -- The read-back returns all three, so that surfacing withdrawn rows later is
  -- a WHERE-clause change rather than a signature change every caller follows.
  -- Read from pg_proc.proargnames: a set-returning function's OUT parameters
  -- are not information_schema.columns rows.
  select assert_eq(
    (select count(*) from pg_proc p, unnest(p.proargnames) n
      where p.proname = 'presby_list_published_returns_to_me'
        and n in ('withdrawn_at', 'withdrawn_by', 'withdrawn_minute_reference')),
    3, 'presby_list_published_returns_to_me: the return signature carries the whole withdrawal triple, not just the timestamp');
commit;

-- (b) The 2024 field_spec is complete and the three older generations are
--     deliberate, fail-closed placeholders. An empty spec accepts NO key,
--     which is asserted behaviourally in (f) below, not just structurally.
begin;
  select assert_eq(
    (select count(*) from sasr_form_versions), 4,
    'sasr_form_versions: four generations seeded (1984, 2014, 2022, 2024)');
  select assert_eq(
    (select count(*) from sasr_form_versions v, jsonb_object_keys(v.field_spec -> 'fields') k
      where v.key = '2024'),
    60, 'sasr_form_versions: the 2024 spec declares all 60 typed SASR fields — the same set presby_publish_sasr_snapshot()''s parameter list is');
  select assert_eq(
    (select count(*) from sasr_form_versions
      where key <> '2024' and field_spec -> 'fields' <> '{}'::jsonb),
    0, 'sasr_form_versions: 1984/2014/2022 carry EMPTY specs — fail-closed until F31/F32''s per-tab column mapping exists');
commit;

-- (c) THE RECIPIENT READ-BACK (Ruling 5 / DECISION-135). The whole reason
--     this function exists: statistical_returns is owned by the SUBMITTING
--     CONGREGATION, so the presbytery's tenant policy filters it to zero rows.
--     The publication EVENT is what grants the read, not the policy.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  -- The direct read the policy refuses...
  select assert_eq(
    (select count(*) from statistical_returns),
    0, 'presby_list_published_returns_to_me: the recipient presbytery reads ZERO statistical_returns rows directly — the artifact lives in the congregation''s tenant space');
  -- ...and the controlled read that works.
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me()
      where about_org_id = :ALDER and report_year = 2025),
    1, 'presby_list_published_returns_to_me: the northern reach reads back the return Alder Creek published TO IT');
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me()
      where payload ? 'ending_active'),
    1, 'presby_list_published_returns_to_me: the recipient sees the AS-REPORTED payload, not just the typed projection — which is the half D20 had no mechanism for');
  -- The narrowing parameters are filters over what the caller may already
  -- see, never a way to name another council.
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me(:BRAMBLE, null)),
    0, 'presby_list_published_returns_to_me: narrowing by a congregation that published nothing returns zero, not someone else''s rows');
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me(null, 1900)),
    0, 'presby_list_published_returns_to_me: narrowing by a year with no publication returns zero');
commit;

-- A SIBLING PRESBYTERY SEES NOTHING. The function takes no council id at all,
-- so there is no parameter through which the Western Basin could read the
-- northern reach's inbox — and its own inbox is empty.
begin;
  select set_config('app.current_org_id', :WESTERN_BASIN, true);
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me()),
    0, 'presby_list_published_returns_to_me: a SIBLING presbytery (western basin) sees none of the northern reach''s publications');
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me(:ALDER, 2025)),
    0, 'presby_list_published_returns_to_me: naming Alder Creek and the right year from the wrong council still returns zero — the caller is the GUC, never a parameter');
commit;

-- The PUBLISHING congregation reads its own event row directly (it owns it),
-- and a third congregation does not.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from publications where recipient_org_id = :PRESBY),
    1, 'publications: the publishing congregation owns and reads its own publication event');
  select assert_eq(
    (select count(*) from statistical_returns where about_org_id = :ALDER),
    1, 'statistical_returns: the publishing congregation owns and reads its own artifact');
commit;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from publications), 0,
    'publications: a third congregation (bramblewood) sees none of Alder Creek''s publication events');
  select assert_eq(
    (select count(*) from statistical_returns), 0,
    'statistical_returns: a third congregation sees none of Alder Creek''s artifacts');
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me()), 0,
    'presby_list_published_returns_to_me: a congregation is never a recipient, so it reads zero');
commit;

-- (d) F39 — THE PROJECTION EQUALS THE PUBLICATION. Round 3 wanted published_at
--     and minute_reference moved onto `publications`; Ruling 5 kept them on
--     the projection on the argument that the copy CANNOT drift, because one
--     DEFINER function writes both rows in one transaction with the same
--     instant and neither row is ever updated again. That argument is only
--     worth having if it is asserted. Joined through the read-back function,
--     because no single tenant context can see both tables directly.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*)
       from congregation_statistics cs
       join presby_list_published_returns_to_me() p on p.publication_id = cs.publication_id),
    1, 'F39: the northern reach can join its projection rows to their publications (the assertion below is not vacuous)');
  select assert_eq(
    (select count(*)
       from congregation_statistics cs
       join presby_list_published_returns_to_me() p on p.publication_id = cs.publication_id
      where cs.published_at is distinct from p.published_at
         or cs.minute_reference is distinct from p.minute_reference),
    0, 'F39: every published projection row''s published_at and minute_reference equal its publication''s — the copy Ruling 5 kept cannot drift');
  select assert_eq(
    (select count(*) from congregation_statistics
      where provenance = 'published_by_congregation' and publication_id is null),
    0, 'congregation_statistics_publication_shape: every published row carries a publication_id (the 0047 backfill, re-proven from the tenant side)');
  select assert_eq(
    (select count(*) from congregation_statistics
      where provenance <> 'published_by_congregation' and publication_id is not null),
    0, 'congregation_statistics_publication_shape: no presbytery_entered or imported row carries a publication_id');
commit;

-- (e) IMMUTABILITY from the tenant side. The rejection arrives from the
--     absent grant rather than from the trigger (see this section's header),
--     which is the stronger of the two for this connection — the trigger is
--     what binds the owner, and publication.test.ts proves that half.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update publications set minute_reference = 'tampered'
     where recipient_org_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL — a tenant connection updated a publication';
  exception when insufficient_privilege then
    raise notice 'pass  publications: a tenant connection cannot UPDATE a publication at all — there is no tenant-side withdrawal path in this pipeline';
  end $$;

  do $$
  begin
    update publications
       set withdrawn_at = now(),
           withdrawn_by = 'e0000000-0000-0000-0000-0000000000f4',
           withdrawn_minute_reference = 'probe'
     where recipient_org_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL — a tenant connection withdrew a publication';
  exception when insufficient_privilege then
    raise notice 'pass  publications: withdrawal is not a tenant act today — the triple is owner-only until presby_withdraw_publication() ships in the publish-UI pipeline';
  end $$;

  do $$
  begin
    delete from publications where recipient_org_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL — a tenant connection deleted a publication';
  exception when insufficient_privilege then
    raise notice 'pass  publications: a publication is an event and is never deleted';
  end $$;

  do $$
  begin
    update statistical_returns set payload = '{"ending_active": 1}'::jsonb
     where about_org_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL — a tenant connection updated a filed return';
  exception when insufficient_privilege then
    raise notice 'pass  statistical_returns: a filed return is immutable — file a correcting return and publish it';
  end $$;

  do $$
  begin
    delete from statistical_returns where about_org_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL — a tenant connection deleted a filed return';
  exception when insufficient_privilege then
    raise notice 'pass  statistical_returns: append-only — DELETE refused';
  end $$;
rollback;

-- (f) THE WRITE PATH IS FUNCTION-MEDIATED, PROVEN FROM THE TENANT SIDE
--     (F50 / F51 / DECISION-140, 2026-09-24).
--
--     MOVED, NOT DELETED. This block used to prove the field-spec gate
--     (D8 / sec 9.5 / DECISION-118), the placeholder generations'
--     fail-closed behaviour, the submitted-is-self CHECK and the imported-row
--     about-org rule (R3.14) by INSERTing directly into statistical_returns
--     as presby_app. INSERT is now revoked from both application roles, so
--     every one of those probes would be refused by the PERMISSION CHECK
--     before the trigger or CHECK under test could fire — which proves the
--     revoke, not the gate. All of them moved verbatim to
--     src/lib/db/domain/publication.test.ts, which runs on
--     PLATFORM_DATABASE_URL (neondb_owner) where the grant is irrelevant and
--     the triggers and CHECKs are the only thing standing. That is the same
--     split this section's header already records for UPDATE and DELETE, now
--     extended to INSERT.
--
--     What STAYS here is the half only a tenant connection can demonstrate:
--     that presby_app genuinely cannot write these two tables at all.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into statistical_returns
      (organization_id, about_org_id, report_year, form_version_key, provenance, payload, reconciled)
    values ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
            2027, '2024', 'submitted', '{"ending_active": 214}'::jsonb, true);
    raise exception 'FAIL — a tenant connection filed a return directly, around presby_publish_sasr_snapshot()';
  exception when insufficient_privilege then
    raise notice 'pass  F50: presby_app cannot INSERT a statistical_return — the artifact is minted by presby_publish_sasr_snapshot() (submitted) or by D13''s future import function (imported), both SECURITY DEFINER';
  end $$;

  do $$
  begin
    insert into publications
      (organization_id, recipient_org_id, record_class, artifact_id, minute_reference)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
            'statistical_return', '00000000-0000-0000-0000-000000000000', 'forged');
    raise exception 'FAIL — a tenant connection wrote a publication event directly';
  exception when insufficient_privilege then
    raise notice 'pass  F51: presby_app cannot INSERT a publication — "access flows up by publication" is an act performed by a function, not a row anyone may write';
  end $$;

  -- ...and the DEFINER writer is unaffected by the revoke, which is the whole
  -- point of function-mediation. A positive control, so the two rejections
  -- above cannot be passing because publishing is broken outright.
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare v_id uuid;
  begin
    v_id := presby_publish_sasr_snapshot(
      2087, 'Session stated meeting, fixture, item 9', p_ending_active => 214);
    if v_id is null then
      raise exception 'FAIL — presby_publish_sasr_snapshot returned null after the INSERT revoke';
    end if;
    raise notice 'pass  F50/F51: presby_publish_sasr_snapshot() still writes all three rows after INSERT is revoked from both roles — SECURITY DEFINER runs with its owner''s privileges';
  end $$;
rollback;

-- (g) THE NEW CONSTRAINT AND TRIGGER SURFACE, in the catalog (F47-F53 /
--     DECISION-140, 2026-09-24). The BEHAVIOUR of each of these is proven on
--     the owner connection in src/lib/db/domain/publication.test.ts and
--     src/lib/db/domain/lifecycle.test.ts, for the reason (f) states. What a
--     tenant connection can still prove is that the mechanisms EXIST and are
--     armed — which is what catches a future migration quietly dropping one.
begin;
  select assert_eq(
    (select count(*) from pg_constraint
      where conname in ('statistical_returns_provenance_shape',
                        'publications_id_recipient_key',
                        'congregation_statistics_publication_recipient_fk')),
    3, 'F50/F51: the provenance-shape CHECK, publications'' (id, recipient_org_id) key and the projection''s RECIPIENT-end composite FK all exist');
  -- Both FKs share publication_id and pin to the same publications row, so
  -- together they prove BOTH ends of the projection's relationship.
  select assert_eq(
    (select count(*) from pg_constraint
      where conrelid = 'congregation_statistics'::regclass
        and contype = 'f'
        and conname like 'congregation_statistics_publication%'),
    2, 'F51: congregation_statistics carries TWO composite FKs into publications — the source end (about_org_id -> organization_id) and the recipient end (organization_id -> recipient_org_id)');
  select assert_eq(
    (select count(*) from pg_indexes
      where tablename = 'publications' and indexname = 'publications_supersedes_once_idx'),
    1, 'F51: supersession cannot FORK — a partial unique index on supersedes_id forbids two publications naming the same predecessor');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'publications' and t.tgname = 'publications_supersession'
        and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 4) = 4),
    1, 'F51: publications_supersession is an enabled row-level BEFORE INSERT trigger — supersession is a chain, not a bare self-FK');
  -- SECURITY DEFINER on the two new cross-tenant checkers is load-bearing
  -- (F26): an invoker-mode version sees zero rows under RLS for exactly the
  -- tenant it should have protected. Asserted from the catalog because the
  -- consequence is invisible from a single tenant's context.
  select assert_eq(
    (select count(*) from pg_proc
      where proname in ('presby_check_publication_supersession', 'presby_freeze_used_field_spec')
        and prosecdef),
    2, 'F51/F53: both new cross-tenant checkers are SECURITY DEFINER — an invoker-mode reader of a FORCE-RLS table silently sees zero rows for the tenant it exists to protect');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'sasr_form_versions'
        and t.tgname = 'sasr_form_versions_field_spec_freeze'
        and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
        and (t.tgtype & 16) = 16),
    1, 'F53: sasr_form_versions_field_spec_freeze is an enabled row-level BEFORE UPDATE trigger — a generation''s spec stops moving once a filed return is read through it');
  -- F52, Option A: the projection carries its own withdrawal mark, and the
  -- recipient read-back no longer filters withdrawn rows out. The behavioural
  -- half is in publication.test.ts; this is the structural half.
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'congregation_statistics' and column_name = 'withdrawn_at'),
    1, 'F52 Option A: congregation_statistics carries its own withdrawn_at — the recipient RETAINS a withdrawn artifact, marked, rather than either losing it or silently counting it');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_list_published_returns_to_me'
        and pg_get_functiondef(oid) like '%withdrawn_at is null%'),
    0, 'F52 Option A: the recipient read-back no longer filters on withdrawn_at — withdrawn publications come back carrying the whole triple, and the caller decides');
commit;

-- (h) THE FULL PUBLISH PATH, END TO END, AND THE REPUBLISH CHAIN. Three rows,
--     one transaction, no organization id anywhere in the signature.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    v_return_1  uuid;
    v_return_2  uuid;
    v_pub_1     uuid;
    v_pub_2     uuid;
    v_recipient uuid;
    v_proj_1    uuid;
  begin
    v_return_1 := presby_publish_sasr_snapshot(
      2029, 'Session stated meeting, 2030-01-10, item 3',
      p_ending_active => 220, p_ending_baptized => 48,
      p_avg_weekly_worship_attendance => 170, p_baptisms_children => 5,
      p_receipts_contributions => 425000.00, p_exp_local_program => 280000.00
    );

    -- The RETURN VALUE is now the artifact's id, not the projection's — the
    -- one part of the 0038 contract this rewrite deliberately changes.
    if not exists (select 1 from statistical_returns where id = v_return_1) then
      raise exception 'FAIL — presby_publish_sasr_snapshot() did not return a statistical_returns id';
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: returns the ARTIFACT''s id (statistical_returns), the row the function now fundamentally produces';

    select id, recipient_org_id into v_pub_1, v_recipient
      from publications where artifact_id = v_return_1;

    -- The recipient is derived from the AFFILIATION HISTORY, and there is no
    -- parameter through which it could be redirected (F26 / D19).
    if v_recipient is distinct from '11111111-1111-1111-1111-111111111111' then
      raise exception 'FAIL — Alder Creek''s publication was addressed to % rather than to its current council', v_recipient;
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: the recipient is resolved from presby_affiliation_parent_as_of(), never from organizations.parent_id, and no parameter can redirect it';

    -- The payload really is the as-reported artifact, gated by the same spec.
    if (select payload -> 'ending_active' from statistical_returns where id = v_return_1) <> '220'::jsonb then
      raise exception 'FAIL — the artifact''s payload does not carry the reported value';
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: the artifact carries the as-reported payload under the 2024 field_spec';

    -- The projection, read through the congregation's own DEFINER read since
    -- it lives in the presbytery's tenant space.
    select id into v_proj_1
      from presby_list_own_congregation_publications(2029)
     where publication_id = v_pub_1;
    if v_proj_1 is null then
      raise exception 'FAIL — no congregation_statistics projection was written for the publication';
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: the projection is written at the recipient, carries publication_id, and presby_list_own_congregation_publications() still finds it (its contract survived the column change)';

    -- REPUBLISH: a second filing for the same year chains to the first
    -- through publications.supersedes_id, DERIVED and never caller-supplied.
    v_return_2 := presby_publish_sasr_snapshot(
      2029, 'Session stated meeting, 2030-02-14, item 2 (correction)',
      p_ending_active => 221
    );
    select id into v_pub_2 from publications where artifact_id = v_return_2;

    if (select supersedes_id from publications where id = v_pub_2) is distinct from v_pub_1 then
      raise exception 'FAIL — a same-year republish did not chain to the publication it corrects';
    end if;
    raise notice 'pass  publications.supersedes_id: a same-year republish chains to the prior NON-WITHDRAWN publication, derived from the caller''s own history rather than passed in';

    if (select supersedes_id from publications where id = v_pub_1) is not null then
      raise exception 'FAIL — the FIRST publication acquired a supersedes_id';
    end if;
    raise notice 'pass  publications.supersedes_id: the superseded publication itself is untouched — the chain points backwards, and a published event is never edited';
  end $$;

  -- ...and the OLD PROJECTION ROW STAYS FROZEN. Checked from the presbytery's
  -- context in the same transaction, because congregation_statistics lives in
  -- its tenant space and the congregation cannot even see the row.
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from congregation_statistics
      where about_org_id = :ALDER and year = 2029 and provenance = 'published_by_congregation'),
    2, 'republish: BOTH projection rows survive — a correction is a new frozen row, never an UPDATE of the old one');
  do $$
  begin
    update congregation_statistics set ending_active = 999
     where about_org_id = '22222222-2222-2222-2222-222222222222' and year = 2029;
    raise exception 'FAIL — a superseded published projection row was updated in place';
  exception when check_violation then
    raise notice 'pass  congregation_statistics_freeze: the superseded projection row is still frozen after the republish (the roll_actions/void precedent holds across the retrofit)';
  end $$;
rollback;

-- (i) The publish path's own rejections, with the recipient now resolved from
--     the affiliation history rather than from parent_id.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2029, 'n/a');
    raise exception 'FAIL — an organization with no current affiliation was allowed to publish';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: an organization with no current affiliation is rejected (the northern reach is a root council)';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :TIDEWATER, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(2029, 'n/a');
    raise exception 'FAIL — a body whose current council is a synod, not a presbytery, was allowed to publish';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: a current council whose organization_type is not presbytery is rejected';
  end $$;
rollback;

-- THE INCREMENT-3/INCREMENT-5 COLLISION, surfaced as a named error rather
-- than as an opaque about-org rejection two rows later. drizzle/0045 checks
-- the projection against the affiliation AS OF THE REPORT YEAR; D19 resolves
-- the recipient as of TODAY. Quillhaven is the fixture where those differ:
-- the northern reach holds it now, the Southern Fields held it in 1990.
begin;
  select set_config('app.current_org_id', :QUILLHAVEN, true);
  do $$
  begin
    perform presby_publish_sasr_snapshot(1990, 'n/a', p_ending_active => 40);
    raise exception 'FAIL — a return was published to a council the congregation did not belong to in the report year';
  exception when invalid_parameter_value then
    raise notice 'pass  presby_publish_sasr_snapshot: a report year predating the congregation''s affiliation to its CURRENT council is refused with a named, mappable error — not with drizzle/0045''s opaque about-org message after two rows are already written';
  end $$;

  -- And the same congregation CAN publish a current year to the same council.
  do $$
  declare v_id uuid;
  begin
    v_id := presby_publish_sasr_snapshot(2029, 'Quillhaven session, 2030-01-05, item 1', p_ending_active => 41);
    if v_id is null then
      raise exception 'FAIL — Quillhaven could not publish a current-year return to its current council';
    end if;
    raise notice 'pass  presby_publish_sasr_snapshot: the same congregation publishes a CURRENT year to the same council without complaint — the rejection above is about the year, not the relationship';
  end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 35. Creation guarded as strongly as mutation — F54-F58 / DECISION-141
--     (docs/work-log/2026-09-24-lifecycle-affiliation-returns.md, sixth Phase
--     3 loop-back; docs/schema-design-2.md sec 2g)
-- ---------------------------------------------------------------------------
-- The rule this section exists to prove: if an immutable record represents an
-- authorized act, its INSERT needs the same GUC-gated-trigger treatment its
-- UPDATE/DELETE already got. A revoked grant proves nothing on the connection
-- that matters (neondb_owner, F44) and a shape CHECK proves a row is
-- well-formed, never that it arrived through the sanctioned path.
--
-- WHAT THIS SUITE CAN AND CANNOT PROVE, stated once. Running as presby_app:
--   * organization_lifecycle_events, organization_successions,
--     statistical_returns, publications — presby_app holds no INSERT grant on
--     any of the four (the events table lost its INSERT on 2026-09-25), so
--     the permission check fires BEFORE the new guards and this suite can
--     only prove the GRANT, which it does at 32(j) and 32(k) and 34. The
--     guards themselves are proven on the owner connection in
--     src/lib/db/domain/lifecycle.test.ts and publication.test.ts, which is
--     the connection they exist for: no grant binds neondb_owner (F44).
--   * congregation_statistics — the one table in this family where presby_app
--     still holds INSERT, because the live tenant path writes it. So the
--     WHEN-scoped projection guard IS reachable and IS behaviourally proven
--     here, in (c), together with the regression proof that the two
--     non-published provenances never reach it.
-- (e) below pins the catalog shape of every mechanism only the other files
-- can exercise, so a dropped trigger fails this suite too.

-- (a) The lifecycle aggregate's creation guard (F54) — PROVEN ON THE OWNER
--     CONNECTION, not here, and the reason is the same one that emptied
--     32(k) above: as of 2026-09-25 presby_app holds SELECT only on BOTH
--     lifecycle tables, so the grant refuses every INSERT before
--     organization_lifecycle_events_guard or organization_successions_guard
--     can be reached. A tenant connection can no longer distinguish "the
--     guard refused me" from "the grant refused me", and a probe that cannot
--     tell those apart proves neither.
--
--     src/lib/db/domain/lifecycle.test.ts carries the behaviour, on
--     PLATFORM_DATABASE_URL (neondb_owner), which is the connection the guard
--     exists for in the first place (F44 — no grant binds it): an unarmed
--     INSERT into each table refused with the uniform literal, an armed
--     event + succession pair accepted in one transaction, the reviewer's
--     third-predecessor repro refused with its positive control, a
--     zero-succession merge and a zero-succession division refused at commit,
--     and a lawful dissolution accepted. What remains here is (e)'s catalog
--     assertions, which fail this suite if any of those mechanisms is dropped.
--
--     The grant-shape half is 32(k) above; the behavioural "presby_app cannot
--     INSERT at all" probe is there too, next to the grant it proves.


-- (c) The publication chain's projection guard, and the WHEN clause that keeps
--     the live tenant path out of it (F55).
--
--     THE REVIEWER'S "FALSE SUBMITTED ARTIFACT" REPRO, at the projection end:
--     a fabricated published_by_congregation row, satisfying congregation_
--     statistics_publication_shape and its composite FK by pointing at the
--     seeded publication, refused because the transaction is not a publish.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  declare
    -- The publication id is READ FROM THE PROJECTION, never hard-coded: on a
    -- freshly-seeded database it is scripts/seed-dev.sql's a9000000-...-0001,
    -- and on a database that was MIGRATED instead it is whatever drizzle/
    -- 0047's backfill minted. (Measured: this branch carries the backfilled
    -- one. A hard-coded id made this probe fail on the FK instead of on the
    -- guard, which would have proven nothing.) presby_app cannot SELECT the
    -- publication itself here — that row belongs to the congregation — but it
    -- owns the projection that names it, and a foreign-key check bypasses row
    -- security by design, so the reference resolves.
    v_pub uuid := (select publication_id from congregation_statistics
                    where id = 'a4000000-0000-0000-0000-000000000002');
  begin
    insert into congregation_statistics
      (organization_id, about_org_id, year, provenance, publication_id,
       published_at, minute_reference, ending_active)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            2027, 'published_by_congregation',
            v_pub,
            now(), 'Fabricated session minute', 999);
    raise exception 'FAIL — a published_by_congregation projection was fabricated outside presby_publish_sasr_snapshot()';
  exception when insufficient_privilege then
    raise notice 'pass  F55: congregation_statistics_publication_guard refuses a published_by_congregation INSERT with presby.publication_write_active unarmed — the projection is part of a publication, not a row anyone may write';
  -- Attribution, not defensiveness. From the RECIPIENT's context the
  -- composite FK to publications (id, organization_id) is itself unresolvable
  -- (that table is FORCE RLS and the publication belongs to the CONGREGATION),
  -- so with the guard dropped this insert fails on the FK instead — which is a
  -- failure, but of a different mechanism. Naming it keeps the failing-first
  -- proof honest: if this branch fires, the guard did NOT do the refusing.
  when foreign_key_violation then
    raise exception 'FAIL — congregation_statistics_publication_guard did not fire; the composite FK refused the row instead';
  end $$;
rollback;

--     THE REGRESSION THAT MATTERS MOST in this whole loop-back: the two
--     provenances the live tenant path writes never reach that trigger at all.
--     A table-wide guard would have broken setCongregationStatisticsAction
--     outright; the WHEN clause is what makes the fix surgical. Sections 29
--     and 33 already insert eight presbytery_entered/imported rows and are
--     UNCHANGED by this loop-back, which is the real proof — this is the
--     explicit, named restatement of it.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  insert into congregation_statistics
    (organization_id, about_org_id, year, provenance, ending_active)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          2028, 'presbytery_entered', 41);
  select assert_eq(
    (select count(*) from congregation_statistics
      where organization_id = :PRESBY and about_org_id = :ALDER and year = 2028),
    1, 'F55: a presbytery_entered row is written by an ordinary tenant connection with NO GUC armed — the WHEN clause keeps the live path out of the guard entirely');
rollback;

--     ...and the identical row USED TO BE accepted once the transaction said
--     it was a publish. THAT BLOCK IS RETIRED, 2026-09-25 (F61, eleventh
--     Phase 3 loop-back), and its removal is recorded here rather than done
--     quietly, because it asserted the exact behaviour F61 exists to close.
--
--     It armed presby.publication_write_active as presby_app and asserted the
--     forged published_by_congregation INSERT SUCCEEDED, as "this is how
--     presby_publish_sasr_snapshot() writes it" evidence. It was never that:
--     the snapshot function runs SECURITY DEFINER as the owner and is
--     grant-exempt (F44), so the tenant connection reproducing the write
--     proved only that the tenant connection could do it — which is F59's
--     residual, stated as a passing test. presby_app now holds no INSERT on
--     congregation_statistics.publication_id at all, so the same statement is
--     refused by the GRANT before any trigger is consulted; section 37(a)
--     asserts that refusal, and insists the grant (not the guard) is the layer
--     doing it.
--
--     The guard's own "gates the PATH, not the row" behaviour is unchanged and
--     is still proven — on the OWNER connection, in
--     src/lib/db/domain/publication.test.ts, which is the connection it exists
--     for. A tenant connection can no longer reach it on this branch, and a
--     probe that cannot reach a mechanism proves nothing about it.

-- (d) The withdrawal pair's projection half (F56), CORRECTED 2026-09-25 after
--     QA-2. The one permitted transition — withdrawn_at null -> not null,
--     nothing else moving — was independently reachable on each of the two
--     tables, so a raw connection could withdraw one half and leave the other
--     disagreeing. The sixth loop-back added a GUC-gated trigger conjunct to
--     each and this section then asserted the pair was "closed on both until
--     presby_withdraw_publication() exists". QA measured otherwise on THIS
--     connection: a GUC is a marker, not a privilege — set_config() has no
--     privilege check — and presby_app held whole-table UPDATE on
--     congregation_statistics, so it could arm the marker itself and write
--     withdrawn_at alone. The block below used to perform exactly that and
--     assert SUCCESS, three sections before another block asserted the
--     opposite.
--
--     What closes it is a COLUMN-LEVEL GRANT (drizzle/0047 section 10):
--     presby_app now holds UPDATE on every column of congregation_statistics
--     EXCEPT withdrawn_at and publication_id. The refusing layer on this
--     connection is therefore the GRANT, not the trigger, and it refuses
--     whether or not the marker is armed. The trigger's own branch — which
--     still matters, because it is the only layer binding neondb_owner (F44)
--     and the future presby_withdraw_publication() — is proven on the owner
--     connection in src/lib/db/domain/publication.test.ts.
--
--     UNARMED: the failure is now a privilege error, raised before the
--     trigger runs, so the old `when check_violation` handler would no longer
--     catch it. Expect insufficient_privilege and name check_violation
--     explicitly as a FAIL, so a reverted grant is reported as "the trigger
--     did the refusing" rather than passing quietly.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    update congregation_statistics
       set withdrawn_at = now()
     where id = 'a4000000-0000-0000-0000-000000000002';
    raise exception 'FAIL — half of a withdrawal pair was recorded with no sanctioned withdrawal writer';
  exception
    when insufficient_privilege then
      raise notice 'pass  F56/QA-2: the congregation_statistics withdrawal transition is refused for presby_app at the GRANT layer, unarmed — presby_app holds no UPDATE on withdrawn_at at all';
    when check_violation then
      raise exception 'FAIL — the column grant did not refuse; the trigger did. drizzle/0047 section 10''s revoke/grant pair has been reverted or never applied';
  end $$;
rollback;

--     ARMED, and this is the block QA named: it used to arm the marker and
--     assert the UPDATE SUCCEEDED, as "future plumbing" proof. It now asserts
--     the opposite, which is the whole point of the correction — arming buys
--     the tenant nothing, because a marker is not a privilege. The future
--     presby_withdraw_publication() is unaffected: it is SECURITY DEFINER and
--     runs as the owner, where no grant applies.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select set_config('presby.withdrawal_write_active', 'true', true);
  do $$
  begin
    update congregation_statistics
       set withdrawn_at = now()
     where id = 'a4000000-0000-0000-0000-000000000002';
    raise exception 'FAIL — presby_app armed presby.withdrawal_write_active and wrote withdrawn_at; a GUC is being treated as a privilege (QA-2)';
  exception when insufficient_privilege then
    raise notice 'pass  F56/QA-2: ARMED makes no difference — presby_app still cannot write congregation_statistics.withdrawn_at, because the column grant refuses before any trigger is consulted';
  end $$;
rollback;

--     The grant shape itself, asserted directly rather than only through
--     behaviour, so a partial revert (one column re-granted, or the whole
--     table re-granted) fails here even if no probe above happens to reach it.
--     has_column_privilege() is the right instrument: it answers the question
--     Postgres actually asks at execution time, table-level and column-level
--     grants combined.
begin;
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'withdrawn_at', 'UPDATE')
                 then 1 else 0 end)::bigint,
    0, 'QA-2: presby_app holds no UPDATE on congregation_statistics.withdrawn_at — the withdrawal half of the pair is grant-closed on the tenant connection');
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'publication_id', 'UPDATE')
                 then 1 else 0 end)::bigint,
    0, 'QA-2: presby_app holds no UPDATE on congregation_statistics.publication_id — the projection''s link back to its publication is written by presby_publish_sasr_snapshot() alone');
  -- THE POSITIVE CONTROL, and it is not optional: without it a blanket
  -- `revoke update on congregation_statistics from presby_app` would satisfy
  -- both assertions above while silently breaking setCongregationStatistics().
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'minute_reference', 'UPDATE')
                 then 1 else 0 end)::bigint,
    1, 'QA-2: presby_app DOES hold UPDATE on congregation_statistics.minute_reference — the narrowing is two columns wide, not a table-wide revoke');
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'ending_active', 'UPDATE')
                 then 1 else 0 end)::bigint,
    1, 'QA-2: and on ending_active — a second live column of the setCongregationStatistics() upsert, so the positive control is not a single lucky pick');
  -- The table-level UPDATE is GONE, replaced by the column list. relacl, not
  -- has_column_privilege(), because this is the distinction the two disagree
  -- on: a table-level grant would make every has_column_privilege() true.
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'congregation_statistics'
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'UPDATE'),
    0, 'QA-2: presby_app holds no TABLE-level UPDATE on congregation_statistics — the privilege is column-scoped, which is the only shape that can exclude a column');
  -- ...and the column-level grants are really there, in pg_attribute.attacl,
  -- which is where a column grant lives and where a table-level grant does not
  -- appear at all.
  select assert_eq(
    (select count(distinct a.grantee) from pg_attribute att,
            aclexplode(att.attacl) a
      where att.attrelid = 'congregation_statistics'::regclass
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'UPDATE'),
    1, 'QA-2: the column-level UPDATE grants exist in pg_attribute.attacl — the revoke/grant pair ran, rather than the table simply losing UPDATE');
commit;

--     INSERT WAS DELIBERATELY NOT NARROWED HERE, and this suite used to assert
--     that residual positively (`presby_app DOES hold INSERT on
--     publication_id`). SUPERSEDED 2026-09-25 by F61, eleventh Phase 3
--     loop-back — the assertion is not merely deleted, it is INVERTED and
--     moved to section 37(d), so the inversion is visible rather than looking
--     like a dropped test.
--
--     The ninth pass's measurement still stands and is not being contradicted:
--     Postgres does require column-level INSERT privilege on every column in
--     the target list even when its value is DEFAULT, and Drizzle's insert
--     builder does emit every column. What changed is the OTHER half —
--     setCongregationStatistics() no longer uses that builder. See drizzle/
--     0047 section 10 and section 37 below.

--     The other half stays grant-closed from here: presby_app holds no UPDATE
--     on publications at all, so its withdrawal conjunct is proven on the
--     owner connection (src/lib/db/domain/publication.test.ts). Asserted so
--     the split is deliberate rather than an omission.
begin;
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'publications'
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'UPDATE'),
    0, 'F56: presby_app holds no UPDATE on publications — the publication half of the withdrawal pair is unreachable from a tenant connection before any trigger is consulted');
commit;

-- (e) The catalog. Every mechanism this loop-back added, pinned by shape, so
--     a dropped trigger or an un-armed writer fails THIS suite as well as the
--     owner-connection ones.
begin;
  -- The two lifecycle guards, sharing one function and one GUC.
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname in ('organization_lifecycle_events_guard', 'organization_successions_guard')
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
        and t.tgfoid = 'presby_guard_lifecycle_write'::regproc),
    2, 'F54: both lifecycle tables carry an enabled row-level BEFORE INSERT guard, and both execute the SAME function — one aggregate, one claim, one flag');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_guard_lifecycle_write'
        and pg_get_functiondef(oid) like '%presby.lifecycle_write_active%'
        and pg_get_functiondef(oid) like '%presby_deny_lifecycle_change%'),
    1, 'F54: presby_guard_lifecycle_write() reads presby.lifecycle_write_active and raises the EXISTING per-table literal via presby_deny_lifecycle_change() — reuse, not a fresh string (DECISION-139)');
  -- QA-1 (2026-09-25, eighth Phase 3 loop-back): the marker carries an EVENT
  -- ID, not the boolean 'true', and the guard compares the row in front of it
  -- against that value — new.id on the events table, new.event_id on the
  -- successions table. A regression to the boolean sentinel is invisible to
  -- every behavioural probe a tenant connection can run (presby_app holds
  -- SELECT only on both tables, so the grant refuses long before the guard),
  -- which is why this is a structural assertion here and a behavioural one on
  -- the owner connection in src/lib/db/domain/lifecycle.test.ts.
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_guard_lifecycle_write'
        and pg_get_functiondef(oid) like '%tg_table_name%'
        and pg_get_functiondef(oid) like '%new.id::text%'
        and pg_get_functiondef(oid) like '%new.event_id::text%'),
    1, 'QA-1: presby_guard_lifecycle_write() binds each row to the act the transaction DECLARED — it branches on tg_table_name and compares new.id / new.event_id against the armed event id, rather than checking a self-armable boolean');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_guard_lifecycle_write'
        and pg_get_functiondef(oid) like '%<> ''true''%'),
    0, 'QA-1: the boolean sentinel is gone — the guard no longer compares presby.lifecycle_write_active against the literal ''true'', which named no act and which any later transaction could re-assert');
  -- The event-side cardinality half, and the shared body both ends call.
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'organization_lifecycle_events'
        and t.tgname = 'organization_lifecycle_events_cardinality'
        and t.tgenabled = 'O' and t.tgdeferrable and t.tginitdeferred
        and (t.tgtype & 4) = 4),
    1, 'F54: the event-side cardinality check is a DEFERRABLE INITIALLY DEFERRED AFTER INSERT constraint trigger — a merged event''s succession rows cannot exist when the event row is written, so an immediate check would make the legal case unwritable');
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_lifecycle_event_cardinality_check'),
    1, 'F54: the counting/raising body is extracted into ONE shared function, so the two ends cannot drift apart');
  select assert_eq(
    (select count(*) from pg_proc
      where proname in ('presby_check_succession_cardinality', 'presby_check_lifecycle_event_cardinality')
        and pg_get_functiondef(oid) like '%presby_lifecycle_event_cardinality_check%'),
    2, 'F54: both cardinality triggers call the shared function rather than carrying a copy');

  -- The publication chain: one function, one GUC, three tables.
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname in ('statistical_returns_guard', 'publications_guard',
                         'congregation_statistics_publication_guard')
        and t.tgenabled = 'O'
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
        and t.tgfoid = 'presby_guard_publication_write'::regproc),
    3, 'F55: all three tables in the return -> publication -> projection chain carry an enabled row-level BEFORE INSERT guard executing one shared function');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'congregation_statistics'
        and t.tgname = 'congregation_statistics_publication_guard'
        and pg_get_triggerdef(t.oid) like '%published_by_congregation%'),
    1, 'F55: and ONLY the projection guard carries a WHEN clause — presbytery_entered and imported rows never invoke it, which is how the live tenant write path is untouched');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_guard_publication_write'
        and pg_get_functiondef(oid) like '%presby.publication_write_active%'),
    1, 'F55: the chain guard reads presby.publication_write_active');
  -- The writer that arms it. A guard nobody arms is a table nobody can write;
  -- a writer that forgets to arm it is an outage. Both are pinned here.
  --
  -- MOVED BY drizzle/0049 (increment 6, docs/work-log/2026-09-25-submission-
  -- grants.md): the arming site is no longer inside presby_publish_sasr_
  -- snapshot(). That function is now a thin caller of the extracted
  -- presby_write_return_publication_chain(), which is the SINGLE site in the
  -- database that arms the chain GUC — a property this pair of assertions now
  -- states directly (exactly one function arms it, and it is the chain
  -- writer) rather than by naming whichever caller happened to hold it.
  -- Section 36(d) proves the disarmed direct-INSERT refusal still holds after
  -- the extraction.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%set_config(''presby.publication_write_active'', ''true'', true)%'),
    1, 'F55: EXACTLY ONE function in the database arms the chain GUC — the single-arming-site property, now a counted fact rather than a claim about one named caller');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_write_return_publication_chain'
        and prosecdef
        and pg_get_functiondef(oid) like '%set_config(''presby.publication_write_active'', ''true'', true)%'),
    1, 'F55: and that one function is presby_write_return_publication_chain() — the extracted chain writer both presby_publish_sasr_snapshot() and presby_submit_granted_return() go through (drizzle/0049)');

  -- B-M1 (security review 2026-09-25 sec B) — the trigger-only/internal
  -- helpers hold NO execute grant to the tenant role. A function that only
  -- ever runs inside a SECURITY DEFINER caller or inside the trigger
  -- machinery (whose EXECUTE check happens at CREATE TRIGGER time, not at
  -- fire time) needs none, and granting it widens what a tenant connection
  -- can call for nothing.
  -- The oid form of has_function_privilege(), not the signature-string form:
  -- presby_publish_sasr_snapshot() takes 64 parameters and the string form
  -- requires every one of them spelled out (measured — the string form raised
  -- `function … does not exist` on the first run).
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('presby_deny_identifier_change',
                         'presby_deny_affiliation_change',
                         'presby_deny_lifecycle_change',
                         'presby_assert_council_authority',
                         'presby_apply_affiliation_to_org_tree',
                         'presby_lifecycle_event_cardinality_check',
                         'presby_deny_about_org_write',
                         'presby_check_about_org_affiliated',
                         'presby_check_return_about_org')
       and has_function_privilege('presby_app', p.oid, 'execute')),
    0, 'B-M1: presby_app holds EXECUTE on NONE of the nine trigger-only/internal helpers in drizzle/0043-0047');
  -- ...and the ONE remaining exception still does. Two of the three original
  -- exceptions (presby_deny_lifecycle_change, presby_lifecycle_event_
  -- cardinality_check) became revocable on 2026-09-25 when presby_app lost
  -- INSERT on organization_lifecycle_events: with SELECT on both lifecycle
  -- tables, no tenant DML can reach either INVOKER caller.
  --
  -- THE THIRD, presby_deny_publication_write(), KEEPS ITS GRANT — but the
  -- REASON changed later the same day and is restated rather than left stale
  -- (F61, eleventh loop-back). It used to be "presby_guard_publication_write()
  -- is reachable, because presby_app holds table-level INSERT on
  -- congregation_statistics". It no longer holds that grant: the
  -- published_by_congregation branch is now refused by the column-level INSERT
  -- narrowing BEFORE the trigger is consulted (section 37), and the
  -- presbytery_entered branch never fires the guard at all (the WHEN clause).
  -- So the guard is, today, no more tenant-reachable than the other two.
  --
  -- The grant is kept anyway, deliberately, and this is a judgement rather
  -- than an oversight: revoking it belongs with B-M1's own reachability
  -- review in the security pipeline's drizzle/0048, not smuggled into a
  -- correction pass whose scope is F60-F64 — and the coupling that made it
  -- necessary is exactly the kind that comes back (re-grant table-level INSERT
  -- here and the chain's uniform rejection literal degrades to `permission
  -- denied for function …`). The assertion below therefore pins the CURRENT
  -- state and says plainly that the state is now conservative.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'presby_deny_publication_write'
       and has_function_privilege('presby_app', p.oid, 'execute')),
    1, 'B-M1: presby_deny_publication_write KEEPS execute — conservatively, since F61 closed the last tenant path to its INVOKER caller; revoking it is drizzle/0048''s call, not this pass''s');
  -- ...and the seven application-callable functions are untouched, so the
  -- narrowing above cannot have been done by over-revoking.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('presby_set_organization_identifier',
                         'presby_transfer_affiliation',
                         'presby_affiliation_parent_as_of',
                         'presby_org_affiliated',
                         'presby_publish_sasr_snapshot',
                         'presby_list_published_returns_to_me',
                         'presby_list_own_congregation_publications')
       and has_function_privilege('presby_app', p.oid, 'execute')),
    7, 'B-M1: every application-callable function keeps its grant');

  -- B-M2 (same review) — every SECURITY DEFINER function in drizzle/0043-0047
  -- pins a `search_path` that STARTS with `public`. It is asserted because the
  -- pin is invisible in the function body and a future `create or replace`
  -- that drops the clause would be silent.
  --
  -- CORRECTED 2026-09-25 (F60, eleventh Phase 3 loop-back). This assertion used
  -- to require the exact value `search_path=public` and to describe the pin as
  -- "standard hardening rather than a live fix". Both were wrong: the value is
  -- now `public, pg_temp`, and the missing pg_temp was a LIVE gap, reproduced
  -- on this very pipeline's presby_org_affiliated() (a temp table named
  -- organization_affiliations made it answer `true` where the truth is
  -- `false`). The predicate below is deliberately left as the weaker
  -- "starts with public" claim and the pg_temp requirement lives in section 36
  -- alone, so the two assertions cannot drift into disagreeing about what
  -- "compliant" means — section 36 is the one drizzle/0048 widens.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in (
         'presby_set_organization_identifier', 'presby_assert_council_authority',
         'presby_affiliation_parent_as_of', 'presby_org_affiliated',
         'presby_apply_affiliation_to_org_tree', 'presby_transfer_affiliation',
         'presby_check_affiliation_authority', 'presby_apply_affiliation_row',
         'presby_check_lifecycle_authority', 'presby_apply_lifecycle_event',
         'presby_check_succession_event', 'presby_guard_organizations_insert',
         'presby_guard_organizations_reparent', 'presby_guard_organizations_delete',
         'presby_check_about_org_affiliated', 'presby_check_return_about_org',
         'presby_freeze_used_field_spec', 'presby_check_publication_supersession',
         'presby_publish_sasr_snapshot', 'presby_list_own_congregation_publications',
         'presby_list_published_returns_to_me')
       -- MERGE NOTE (integration, 2026-09-25): drizzle/0049 re-creates
       -- presby_publish_sasr_snapshot(), which is in this list, with the
       -- pg_temp-last form. That needs no change here — the predicate below
       -- already accepts it, which is exactly the looseness main chose above
       -- so that this assertion and the catalog-wide one cannot drift into
       -- disagreeing about what "compliant" means. Section 36 is the
       -- catalog-wide pg_temp pin (and it covers 0049's functions too);
       -- section 40(h) pins the pg_temp-LAST spelling for 0049's own four.
       and exists (
         select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
          where cfg like 'search_path=public%')),
    21, 'B-M2: all 21 of the ORIGINAL SECURITY DEFINER functions in drizzle/0043-0047 pin a search_path starting with public (the pg_temp half is section 36)');
  -- The three new guards are deliberately INVOKER and are deliberately NOT in
  -- that list: they read a GUC and touch no table, so there is no search_path
  -- to poison and no owner privilege to escalate into.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and not p.prosecdef
       and p.proname in ('presby_guard_lifecycle_write',
                         'presby_guard_publication_write',
                         'presby_guard_organization_identifiers')),
    3, 'B-M2: the three GUC-only guards stay SECURITY INVOKER — they read no table, so DEFINER would be cargo cult (DECISION-121)');

  -- The withdrawal pair, both halves.
  select assert_eq(
    (select count(*) from pg_proc
      where proname in ('presby_freeze_publication', 'presby_reject_published_statistics_write')
        and pg_get_functiondef(oid) like '%presby.withdrawal_write_active%'),
    2, 'F56: BOTH withdrawal functions require presby.withdrawal_write_active — neither half of the pair is independently reachable');
  -- prokind/pronamespace are not decoration: pg_get_functiondef() raises on an
  -- aggregate, so an unrestricted scan of pg_proc errors out before it can
  -- answer anything (measured, 2026-09-24).
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%set_config(''presby.withdrawal_write_active''%'),
    0, 'F56: and NOTHING in the database arms it yet — deliberate: the transition is unreachable on every connection until presby_withdraw_publication() ships');
commit;
-- ---------------------------------------------------------------------------
-- 36. F60 — every SECURITY DEFINER function in drizzle/0043-0047 pins
--     `search_path = public, pg_temp`, with pg_temp EXPLICIT and LAST
--     (docs/schema-design-2.md sec 2h; DECISION-148; eleventh Phase 3
--     loop-back, Ruling 1)
-- ---------------------------------------------------------------------------
-- WHY THIS IS A SECURITY ASSERTION AND NOT A STYLE ASSERTION. `SET search_path
-- = public` alone does not keep a SECURITY DEFINER function out of its
-- CALLER's temp namespace: an unqualified search_path searches the unnamed
-- pg_temp schema FIRST, ahead of every named schema in the list. A caller
-- holding TEMP on the database (PUBLIC holds it by default here, and it has
-- never been revoked) can therefore `create temp table people (...)` and watch
-- a definer function's unqualified `people` reference resolve to the caller's
-- own table — running as the OWNER, against attacker-shaped rows. The
-- concurrent security pipeline reproduced exactly that against an older
-- function (presby_two_factor_required) on its own branch. Naming pg_temp
-- explicitly and LAST is the fix: the named schemas are searched first,
-- whatever the caller has created.
--
-- Every function in this pipeline reads at least one unqualified relation
-- (none writes `public.` prefixes), so the exposure is general, not
-- function-specific.
--
-- SCOPE, STATED PLAINLY: this assertion covers THIS PIPELINE'S 23 functions
-- (drizzle/0043-0047) and NOT the rest of the catalog. Older migrations carried
-- definer functions that did not comply; they are the concurrent security
-- pipeline's drizzle/0048 (item B-M2, widened).
--
-- UPDATED AT INTEGRATION (2026-09-25): 0048 has landed, as section 39. The
-- widening took the form of an ADDITIONAL catalog-wide assertion in 39.3
-- rather than a deletion of the name array here, and BOTH are kept. They
-- cannot disagree about what "compliant" means — both test the identical
-- predicate, `proconfig` contains `search_path=public, pg_temp` — and they
-- fail on different things: 39.3 catches a NEW definer function nobody named,
-- and the `= 23` count below catches one of THESE functions being dropped or
-- renamed, which a zero-count catch-all passes silently.
begin;
  -- The name array is the pipeline's whole DEFINER inventory: 21 from the
  -- original build plus the two deferred cardinality wrappers Ruling 3 (F62)
  -- converts in this same pass.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in (
         'presby_set_organization_identifier', 'presby_assert_council_authority',
         'presby_affiliation_parent_as_of', 'presby_org_affiliated',
         'presby_apply_affiliation_to_org_tree', 'presby_transfer_affiliation',
         'presby_check_affiliation_authority', 'presby_apply_affiliation_row',
         'presby_check_lifecycle_authority', 'presby_apply_lifecycle_event',
         'presby_check_succession_event', 'presby_guard_organizations_insert',
         'presby_guard_organizations_reparent', 'presby_guard_organizations_delete',
         'presby_check_about_org_affiliated', 'presby_check_return_about_org',
         'presby_freeze_used_field_spec', 'presby_check_publication_supersession',
         'presby_publish_sasr_snapshot', 'presby_list_own_congregation_publications',
         'presby_list_published_returns_to_me',
         'presby_check_succession_cardinality', 'presby_check_lifecycle_event_cardinality')),
    23, 'F60: drizzle/0043-0047 define exactly 23 SECURITY DEFINER functions (21 original + the two cardinality wrappers F62 converts)');

  -- The assertion itself. A proconfig entry is a literal `search_path=...`
  -- string, so `like '%, pg_temp'` is both the "pg_temp is present" and the
  -- "pg_temp is LAST" test in one predicate — a function pinned
  -- `pg_temp, public` would fail it, which is the point.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in (
         'presby_set_organization_identifier', 'presby_assert_council_authority',
         'presby_affiliation_parent_as_of', 'presby_org_affiliated',
         'presby_apply_affiliation_to_org_tree', 'presby_transfer_affiliation',
         'presby_check_affiliation_authority', 'presby_apply_affiliation_row',
         'presby_check_lifecycle_authority', 'presby_apply_lifecycle_event',
         'presby_check_succession_event', 'presby_guard_organizations_insert',
         'presby_guard_organizations_reparent', 'presby_guard_organizations_delete',
         'presby_check_about_org_affiliated', 'presby_check_return_about_org',
         'presby_freeze_used_field_spec', 'presby_check_publication_supersession',
         'presby_publish_sasr_snapshot', 'presby_list_own_congregation_publications',
         'presby_list_published_returns_to_me',
         'presby_check_succession_cardinality', 'presby_check_lifecycle_event_cardinality')
       and exists (
         select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
          where cfg like 'search_path=%' and cfg like '%, pg_temp')),
    23, 'F60: all 23 pin search_path with pg_temp explicit and LAST — a caller''s temp schema can no longer shadow an unqualified relation inside a definer function');

  -- The complement, so a future `create or replace` that drops the clause
  -- entirely from one function fails HERE rather than in a count that happens
  -- to stay right for the wrong reason.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in (
         'presby_set_organization_identifier', 'presby_assert_council_authority',
         'presby_affiliation_parent_as_of', 'presby_org_affiliated',
         'presby_apply_affiliation_to_org_tree', 'presby_transfer_affiliation',
         'presby_check_affiliation_authority', 'presby_apply_affiliation_row',
         'presby_check_lifecycle_authority', 'presby_apply_lifecycle_event',
         'presby_check_succession_event', 'presby_guard_organizations_insert',
         'presby_guard_organizations_reparent', 'presby_guard_organizations_delete',
         'presby_check_about_org_affiliated', 'presby_check_return_about_org',
         'presby_freeze_used_field_spec', 'presby_check_publication_supersession',
         'presby_publish_sasr_snapshot', 'presby_list_own_congregation_publications',
         'presby_list_published_returns_to_me',
         'presby_check_succession_cardinality', 'presby_check_lifecycle_event_cardinality')
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
          where cfg = 'search_path=public, pg_temp')),
    0, 'F60: and not one of them carries a different search_path pin — the value is exactly `public, pg_temp` on all 23');
commit;

-- ---------------------------------------------------------------------------
-- 37. F61 — the projection's CREATION closes at the grant, not at a marker
--     (docs/schema-design-2.md sec 2h; eleventh Phase 3 loop-back, Ruling 2).
--     This is F59/QA-Finding-1, reopened and closed rather than re-accepted.
-- ---------------------------------------------------------------------------
-- WHAT WAS OPEN. presby_app held TABLE-LEVEL INSERT on congregation_statistics,
-- because the live setCongregationStatistics() path writes the table. A GUC is
-- a marker, not a privilege (QA-2), so the tenant connection could arm
-- presby.publication_write_active itself, satisfy the projection guard, and
-- insert a PERMANENT published_by_congregation row claiming facts that were
-- never published — bounded only to publications actually addressed to it.
-- Section 35(c) proves the guard refuses the UNARMED case; nothing refused the
-- armed one.
--
-- WHY IT COULD NOT BE CLOSED BEFORE, and what changed. F59 measured that
-- Postgres requires column-level INSERT privilege on every column in the
-- INSERT TARGET LIST — including one supplied as the bare `DEFAULT` keyword —
-- and that drizzle-orm 0.45's insert() builder always emits every column of the
-- table. So a column-level INSERT grant and Drizzle's builder are mutually
-- exclusive on this table. The ninth pass narrowed the grant and left the call
-- site on the builder; it broke immediately and was reverted. This pass changes
-- BOTH halves at once: src/lib/presbytery.ts's write is now an explicit-column
-- raw-SQL upsert naming exactly the 23 columns it sets, so the excluded three
-- never appear in a target list at all.
--
-- THE REFUSING LAYER IS THE GRANT, and the probes below insist on it. A grant
-- refusal and a guard refusal both carry SQLSTATE 42501 (insufficient_
-- privilege) here, so errcode alone cannot tell them apart — each probe
-- inspects SQLERRM and FAILS LOUDLY if a trigger did the refusing, which would
-- mean drizzle/0047 section 10's narrowing has been reverted and only the
-- marker stands between the tenant and a forged projection.

-- (a) ARMED — the case nothing used to refuse. This is the exact insert
--     section 35(c) performs and ACCEPTS with the marker armed; the only
--     difference is that the row now names publication_id, which is what
--     makes it a forged projection rather than a well-formed one.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select set_config('presby.publication_write_active', 'true', true);
  do $$
  begin
    insert into congregation_statistics
      (organization_id, about_org_id, year, provenance, publication_id,
       published_at, minute_reference, ending_active)
    select '11111111-1111-1111-1111-111111111111',
           '22222222-2222-2222-2222-222222222222',
           2029, 'published_by_congregation', cs.publication_id,
           now(), 'Forged: facts never published', 4242
      from congregation_statistics cs
     where cs.id = 'a4000000-0000-0000-0000-000000000002';
    raise exception 'FAIL — presby_app armed presby.publication_write_active and INSERTED a published_by_congregation projection; F59''s residual is open again';
  exception when insufficient_privilege then
    if sqlerrm not like 'permission denied for%' then
      raise exception 'FAIL — a TRIGGER refused this insert, not the grant (%). drizzle/0047 section 10''s column-level INSERT narrowing has been reverted; the marker is doing work a privilege should be doing', sqlerrm;
    end if;
    raise notice 'pass  F61: the GRANT refuses an armed published_by_congregation INSERT — presby_app holds no INSERT on congregation_statistics.publication_id at all (%)', sqlerrm;
  end $$;
rollback;

-- (b) UNARMED — the same row, refused the same way and by the same layer. The
--     privilege check runs before any BEFORE trigger, so the guard proven in
--     section 35(c) is no longer even reached from this connection. Both
--     layers still stand; this records which one now answers first.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into congregation_statistics
      (organization_id, about_org_id, year, provenance, publication_id,
       published_at, minute_reference, ending_active)
    select '11111111-1111-1111-1111-111111111111',
           '22222222-2222-2222-2222-222222222222',
           2029, 'published_by_congregation', cs.publication_id,
           now(), 'Forged: facts never published', 4242
      from congregation_statistics cs
     where cs.id = 'a4000000-0000-0000-0000-000000000002';
    raise exception 'FAIL — an unarmed published_by_congregation projection was written by the tenant connection';
  exception when insufficient_privilege then
    if sqlerrm not like 'permission denied for%' then
      raise exception 'FAIL — the guard answered before the grant (%); that is the pre-F61 shape and means the column grant is gone', sqlerrm;
    end if;
    raise notice 'pass  F61: unarmed is refused by the same layer — the privilege check runs ahead of congregation_statistics_publication_guard entirely';
  end $$;
rollback;

-- (c) THE POSITIVE CONTROL, and it is the whole reason the ninth pass's
--     attempt was reverted: the live presbytery_entered path must still work.
--     This is byte-for-byte the column list src/lib/presbytery.ts's rewritten
--     setCongregationStatistics() emits — 4 identifying columns + 19 value
--     columns, and nothing else. If a future edit re-adds a column to that
--     function without adding it here, this probe is what notices.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  insert into congregation_statistics
    (organization_id, about_org_id, year, provenance,
     minute_reference, gains_professions_under18, gains_professions_18plus,
     gains_certificate, gains_other, losses_certificate, losses_deaths,
     losses_other, ending_active, ending_baptized, ending_affiliate,
     ending_other_participants, avg_weekly_worship_attendance,
     potential_giving_units, baptisms_children, baptisms_adults,
     officers_ruling_elder_count, officers_deacon_count, entered_by)
  values (:PRESBY, :ALDER, 2030, 'presbytery_entered',
          'Minute 2030-1', 1, 2, 3, 4, 5, 6, 7, 100, 110, 5, 9, 60, 55, 2, 1, 6, 3,
          :PRESBYTERY_CLERK_USER)
  on conflict (organization_id, about_org_id, year, provenance)
    where provenance in ('presbytery_entered', 'imported')
  do update set
    minute_reference = excluded.minute_reference,
    ending_active = excluded.ending_active;
  select assert_eq(
    (select count(*) from congregation_statistics
      where organization_id = :PRESBY and about_org_id = :ALDER and year = 2030),
    1, 'F61: the live presbytery_entered upsert shape still INSERTS cleanly under the 68-column grant — the narrowing did not break the shipped path');

  -- IDEMPOTENT ON A SECOND CALL WITH DIFFERENT VALUES: the conflict arm
  -- updates in place rather than duplicating, which is the semantics
  -- onConflictDoUpdate() had and the raw SQL must preserve exactly.
  insert into congregation_statistics
    (organization_id, about_org_id, year, provenance,
     minute_reference, gains_professions_under18, gains_professions_18plus,
     gains_certificate, gains_other, losses_certificate, losses_deaths,
     losses_other, ending_active, ending_baptized, ending_affiliate,
     ending_other_participants, avg_weekly_worship_attendance,
     potential_giving_units, baptisms_children, baptisms_adults,
     officers_ruling_elder_count, officers_deacon_count, entered_by)
  values (:PRESBY, :ALDER, 2030, 'presbytery_entered',
          'Minute 2030-2 (revised)', 1, 2, 3, 4, 5, 6, 7, 222, 110, 5, 9, 60, 55, 2, 1, 6, 3,
          :PRESBYTERY_CLERK_USER)
  on conflict (organization_id, about_org_id, year, provenance)
    where provenance in ('presbytery_entered', 'imported')
  do update set
    minute_reference = excluded.minute_reference,
    ending_active = excluded.ending_active;
  select assert_eq(
    (select count(*) from congregation_statistics
      where organization_id = :PRESBY and about_org_id = :ALDER and year = 2030),
    1, 'F61: a second call with changed values UPDATES in place — one row, not two');
  select assert_eq(
    (select ending_active from congregation_statistics
      where organization_id = :PRESBY and about_org_id = :ALDER and year = 2030
        and provenance = 'presbytery_entered')::bigint,
    222, 'F61: ...and the conflict arm actually wrote the new value');
rollback;

-- (d) THE GRANT SHAPE ITSELF, so a partial revert fails here even if no probe
--     above happens to reach it. has_column_privilege() answers the question
--     Postgres asks at execution time, table-level and column-level combined.
begin;
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'publication_id', 'INSERT')
                 then 1 else 0 end)::bigint,
    0, 'F61: presby_app holds no INSERT on congregation_statistics.publication_id — the column whose absence the publication_shape CHECK turns into a refusal for the whole published branch');
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'withdrawn_at', 'INSERT')
                 then 1 else 0 end)::bigint,
    0, 'F61: nor on withdrawn_at — a row cannot be born withdrawn any more than it can be withdrawn later (section 35(d) is the UPDATE half)');
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'published_at', 'INSERT')
                 then 1 else 0 end)::bigint,
    0, 'F61: nor on published_at — the CHECK is silent about this column, so nothing but the grant stops a presbytery_entered row carrying a fabricated publication timestamp the rollup then orders on');
  -- POSITIVE CONTROLS, not optional: without them a blanket `revoke insert`
  -- would satisfy all three assertions above while breaking the live path.
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'minute_reference', 'INSERT')
                 then 1 else 0 end)::bigint,
    1, 'F61: presby_app DOES hold INSERT on minute_reference — the narrowing is three columns wide, not a table-wide revoke');
  select assert_eq(
    (select case when has_column_privilege('presby_app', 'congregation_statistics', 'ending_active', 'INSERT')
                 then 1 else 0 end)::bigint,
    1, 'F61: ...and on ending_active, the column the live path writes most');
  -- No TABLE-LEVEL insert left in relacl. This is the assertion that would
  -- catch a well-meaning `grant insert on congregation_statistics to
  -- presby_app` added later "to fix" something: it would restore the hole
  -- without touching any column-level entry.
  select assert_eq(
    (select count(*) from pg_class c,
            lateral aclexplode(c.relacl) a
      where c.relname = 'congregation_statistics'
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'INSERT'),
    0, 'F61: and NO table-level INSERT survives in relacl — a table-level grant would silently cover every column again');
  -- Exactly 68 of the 71 columns carry a column-level INSERT entry for
  -- presby_app. Also the Finding-4 assertion: a whole-file re-apply that left
  -- stale attacl entries behind would push this number up.
  select assert_eq(
    (select count(*) from pg_attribute at,
            lateral aclexplode(at.attacl) a
      where at.attrelid = 'congregation_statistics'::regclass
        and at.attnum > 0 and not at.attisdropped
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type = 'INSERT'),
    68, 'F61: exactly 68 columns carry a column-level INSERT grant for presby_app (71 total minus publication_id, withdrawn_at, published_at) — and no stale attacl entries survive a re-apply (Finding 4, closed)');
commit;

-- ---------------------------------------------------------------------------
-- 38. F62 — the deferred lifecycle cardinality path, driven as presby_app all
--     the way through the commit-time check (docs/schema-design-2.md sec 2h;
--     eleventh Phase 3 loop-back, Ruling 3)
-- ---------------------------------------------------------------------------
-- The reviewer's ask: do not stop at the writer's function return. Drive
-- presby_app -> SECURITY DEFINER writer -> INSERT event + successions ->
-- deferred trigger, and see which role is actually active when the deferred
-- trigger finally runs.
--
-- THE INSTRUMENT is `set constraints all immediate` inside a rolled-back
-- transaction, not a real COMMIT, and that is a ruling rather than a
-- compromise: organization_lifecycle_events and organization_successions
-- refuse UPDATE and DELETE on every connection including the owner, so a
-- committed probe would leave a permanent, undeletable fixture behind.
--
-- WHAT WAS MEASURED HERE (2026-09-25, PostgreSQL 18.6), correcting the ruling's
-- premise: an after-trigger event carries the security context current when it
-- was QUEUED, not the ambient role when it fires. Queued inside the SECURITY
-- DEFINER writer, the deferred trigger runs as neondb_owner; queued by a direct
-- tenant INSERT, it runs as presby_app. The `permission denied for function
-- presby_lifecycle_event_cardinality_check` failure the ruling predicted is
-- therefore real on the DIRECT-INSERT path (reproduced before the fix, with
-- INSERT temporarily granted, and recorded in drizzle/0044 section 13b3), not
-- on the writer path. The DEFINER conversion is kept for the two reasons 13b3
-- states — it dissolves 13b's re-grant coupling, and it stops the helper's
-- `event not found -> return` no-op from swallowing the whole check under a
-- role that cannot SEE the event row.
--
-- The test double presby_test_only_lifecycle_writer_f62() is SCAFFOLDING, and
-- this section dies with it when presby_record_lifecycle_event() ships.
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  -- POSITIVE CONTROL: a well-formed `merged` aggregate — 2 distinct
  -- predecessors, 1 successor — written in one transaction, then forced
  -- through the deferred check. No exception means the deferred trigger
  -- reached presby_lifecycle_event_cardinality_check() and the check passed.
  select assert_eq(
    (select count(*) from (
       select presby_test_only_lifecycle_writer_f62(
                :FERNWOOD, 'merged', current_date,
                'F62 probe: rolled back, never committed',
                :PRESBYTERY_CLERK_USER,
                array[:ALDER::uuid, :BRAMBLE::uuid],
                array[:FERNWOOD::uuid])) s),
    1, 'F62: presby_app drives the SECURITY DEFINER lifecycle writer to completion — one merged event, two succession edges');
  set constraints all immediate;
  select assert_eq(
    (select count(*) from organization_successions s
      join organization_lifecycle_events e on e.id = s.event_id
     where e.minute_reference = 'F62 probe: rolled back, never committed'),
    2, 'F62: ...and the DEFERRED cardinality check ran at SET CONSTRAINTS ALL IMMEDIATE without a privilege error — the aggregate survives the commit-time check');
rollback;

begin;
  select set_config('app.current_org_id', :PRESBY, true);
  -- NEGATIVE CONTROL, identical transaction shape, one predecessor short. It
  -- proves the deferred trigger's LOGIC still runs — not merely that it no
  -- longer raises a privilege error, which is the failure mode a DEFINER
  -- conversion could otherwise hide.
  do $$
  begin
    perform presby_test_only_lifecycle_writer_f62(
      '55555555-5555-5555-5555-555555555555', 'merged', current_date,
      'F62 negative control: rolled back',
      'e0000000-0000-0000-0000-0000000000f4',
      array['22222222-2222-2222-2222-222222222222'::uuid],
      array['55555555-5555-5555-5555-555555555555'::uuid]);
    set constraints all immediate;
    raise exception 'FAIL — a merged event with ONE predecessor survived the deferred cardinality check';
  exception
    when check_violation then
      if sqlerrm not like 'organization_successions: a merged event needs at least 2 predecessors and exactly 1 successor (found 1 / 1)%' then
        raise exception 'FAIL — the deferred check raised the wrong literal: %', sqlerrm;
      end if;
      raise notice 'pass  F62: the deferred check still raises its own cardinality literal, byte-identical, under the DEFINER wrappers — the conversion changed the role, not the logic';
    when insufficient_privilege then
      raise exception 'FAIL — the deferred wrapper hit `permission denied` instead of running its check; presby_check_succession_cardinality/presby_check_lifecycle_event_cardinality are not SECURITY DEFINER (drizzle/0044 section 13b3)';
  end $$;
rollback;

-- CATALOG SHAPE. Both wrappers are DEFINER, the shared helper is NOT, and
-- presby_app still holds no EXECUTE on the helper — the revoke at drizzle/0044
-- section 13b keeps meaning what it says precisely because the wrappers no
-- longer need it.
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('presby_check_succession_cardinality',
                         'presby_check_lifecycle_event_cardinality')),
    2, 'F62: both deferred cardinality wrapper trigger functions are SECURITY DEFINER');
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname = 'presby_lifecycle_event_cardinality_check'),
    0, 'F62: the SHARED helper stays SECURITY INVOKER — it is reached only from the two wrappers, which now supply the owner context');
  select assert_eq(
    (select case when has_function_privilege('presby_app', p.oid, 'execute') then 1 else 0 end
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'presby_lifecycle_event_cardinality_check')::bigint,
    0, 'F62: and presby_app still holds NO execute on the helper — the DEFINER conversion replaced the grant coupling rather than re-opening it');
  -- The scaffolding itself, asserted so its eventual removal is a deliberate
  -- edit here rather than a silently-skipped section.
  select assert_eq(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'presby_test_only_lifecycle_writer_f62'
       and p.prosecdef
       and has_function_privilege('presby_app', p.oid, 'execute')),
    1, 'F62: the test-double writer exists, is SECURITY DEFINER and is executable by presby_app — SCAFFOLDING, dropped with this section when presby_record_lifecycle_event() ships');
commit;

-- ===========================================================================
-- BEGIN APPENDED SECTION — pipeline/security-schema-b (Workflow Rule 16).
-- One delimited block, appended at the END of the file. The ONE mid-file edit
-- this pipeline makes is at line ~414, where the presby_roll_cache_drift()
-- assertion was removed; it is pre-authorized (kickoff scope item 2) and is
-- flagged there and here so the integration merge stays mechanical.
--
-- RENUMBERED AT INTEGRATION (2026-09-25): this block was authored as section
-- 36 on its own branch. The lifecycle pipeline's third external review round
-- merged to main first and took 36/37/38, so this block is section 39. The
-- dated 0043-0047 allow-list 39.3 used to carry is gone with that same merge.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 39. Security review round B — the grant model, the search_path pin, the
--     app_role_permissions policy, the group_types split, the roll-function
--     revokes, the composite tenant FKs and the people delete guard.
--     docs/work-log/2026-09-25-security-schema-b.md;
--     drizzle/0048_presby_security_b.sql.
--
--     Runs as presby_app like the rest of the file (CLAUDE.md). That is not
--     incidental here: the whole point of 39.1-39.3 is what THIS role can and
--     cannot do, and every one of those assertions is vacuous on the owner
--     connection.
-- ---------------------------------------------------------------------------
begin;

  -- 39.1 F70 — the privilege facts the search_path pin sits on top of.
  --
  -- B-M2 rated the missing `SET search_path` on 28 SECURITY DEFINER functions
  -- as not-exploitable BECAUSE presby_app holds no CREATE on schema public or
  -- on the database. Both halves of that measurement are true and are
  -- asserted here — and they were NOT sufficient, which is why the next
  -- assertion exists.
  select assert_eq(
    (select count(*) from (values
       (has_schema_privilege('presby_app','public','CREATE')),
       (has_database_privilege('presby_app', current_database(), 'CREATE')),
       (has_schema_privilege('presby_platform','public','CREATE')),
       (has_database_privilege('presby_platform', current_database(), 'CREATE')),
       (has_schema_privilege('public','public','CREATE')),
       (has_database_privilege('public', current_database(), 'CREATE'))
     ) as t(v) where v),
    0, 'F70: presby_app, presby_platform and PUBLIC hold no CREATE on schema public or on the database');

  -- 39.2 ...and TEMP, which they DO hold, which is the hole the CREATE
  -- measurement above missed. Asserted as a KNOWN-TRUE FACT, deliberately not
  -- flipped to false: TEMP is granted to PUBLIC by default and nothing in
  -- drizzle/ revokes it. `revoke temporary on database ... from public` was
  -- specified at Phase 3 and dropped at Phase 4 with a measurement: it makes
  -- line 1292 of this very file (`create temporary table t20_fresh_person`)
  -- raise `permission denied to create temporary tables`, and under
  -- ON_ERROR_STOP that abandons every assertion after it. So the pg_temp-last
  -- clause asserted in 39.3 IS the control, not the absence of TEMP. If a
  -- later housekeeping pass removes that temp table and lands the revoke,
  -- this assertion flips to 0 and the accompanying comment goes with it.
  select assert_eq(
    (select count(*) from (values
       (has_database_privilege('presby_app', current_database(), 'TEMP'))
     ) as t(v) where v),
    1, 'F70: presby_app still inherits PUBLIC''s default TEMP — the pg_temp-last search_path clause is the control, NOT the absence of TEMP');

  -- 39.3 Every SECURITY DEFINER function in schema public pins
  -- `search_path = public, pg_temp`, pg_temp LAST.
  --
  -- WHY pg_temp MUST BE NAMED: when it is absent from search_path, PostgreSQL
  -- searches it FIRST — ahead of public and ahead of pg_catalog. Proven live
  -- on 2026-09-25 as presby_app, in a rolled-back transaction: with
  -- `SET search_path = public` (the pre-0048 clause),
  -- `create temp table people (id uuid, user_id uuid, merged_into_id uuid)`
  -- made presby_two_factor_required() answer FALSE for a user who genuinely
  -- requires 2FA. With `public, pg_temp` it answers TRUE with the identical
  -- decoy in place. That function is the 2FA enforcement predicate, so the
  -- attacker-chosen answer was "this user does not need 2FA."
  --
  -- The dated allow-list this assertion carried before integration is now
  -- EMPTY and gone: the lifecycle pipeline's eleventh loop-back (F60,
  -- drizzle/0043-0047) landed on main on 2026-09-25 and pinned all 23 of its
  -- own DEFINER functions, so the sweep below is CATALOG-WIDE with no
  -- exceptions. Section 36 above asserts the same property over that
  -- pipeline's 23 names specifically; both hold and both are kept — 36 is the
  -- narrower, name-pinned statement (it also catches one of those functions
  -- being DROPPED, which a zero-count catch-all cannot) and this is the
  -- catch-all that covers every function neither pipeline has named.
  select assert_eq(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not ('search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[])))),
    0, 'F70: every SECURITY DEFINER function in public pins search_path = public, pg_temp — catalog-wide, no allow-list, no exceptions');

  -- And the fourteen 0001-0042 functions 0048 altered are actually fourteen —
  -- a bare "0 non-compliant" would also pass if a CREATE OR REPLACE had
  -- deleted them all. This is the assertion that catches the drift-remediation
  -- trap 0048's own header warns about: re-running 0009/0010/0012/0013/0014/
  -- 0015/0020/0021/0024/0028/0041/0042 after 0048 silently strips the clause.
  select assert_eq(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.proname in (
          'presby_effective_permissions','presby_guard_membership_insert',
          'presby_link_person','presby_match_person',
          'presby_reconcile_current_roll','presby_roll_cache_drift',
          'presby_sync_current_roll','presby_membership_is_active',
          'presby_person_unclaimed_or_own_org','presby_public_committee_roster',
          'presby_public_staff_roster','presby_published_site',
          'presby_two_factor_required','presby_user_organizations')
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[]))),
    14, 'F70: all fourteen 0001-0042 SECURITY DEFINER functions still carry the clause 0048 installed (a re-applied earlier migration strips it)');

  -- presby_current_org() is NOT and must never be in that sweep: it is
  -- SECURITY INVOKER, so there is no definer privilege to escalate into.
  select assert_eq(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'presby_current_org' and p.prosecdef),
    0, 'F70: presby_current_org() stays SECURITY INVOKER — a name-based DEFINER sweep must not pull it in');

  -- 39.4 B-H3 — the grant model, one assertion per table class. Before 0048
  -- none of this was written down in drizzle/ at all, so a database rebuilt
  -- from the migration history failed at first sign-in; and four of the five
  -- classes were also WIDER than any call site needs.

  -- (a) Full CRUD: the fourteen tables with a measured INSERT/UPDATE/DELETE
  --     call site on this connection. 14 tables x 4 privileges.
  select assert_eq(
    (select count(*) from unnest(array[
       'users','accounts','sessions','verification_tokens',
       'user_totp','user_totp_recovery_codes','user_totp_pending_enrollments',
       'password_reset_tokens','email_verification_tokens',
       'user_roles','whats_new_entries','email_queue','feedback','feedback_prompt_state'
     ]) tbl
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv
     where has_table_privilege('presby_app', tbl, priv)),
    56, 'B-H3: presby_app holds full CRUD on all fourteen platform-shell tables the adapter and the (account)/(auth)/(admin) actions write');

  -- (b) audit_events is APPEND-ONLY, and now the grant says so.
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','audit_events','SELECT')),
       (has_table_privilege('presby_app','audit_events','INSERT'))
     ) as t(v) where v),
    2, 'B-H3: presby_app can read and append audit_events');
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','audit_events','UPDATE')),
       (has_table_privilege('presby_app','audit_events','DELETE'))
     ) as t(v) where v),
    0, 'B-H3: presby_app can NEITHER update NOR delete audit_events — append-only is a grant, not a convention');

  -- (c) feature_flags: UPDATE yes (the admin flags action), INSERT/DELETE no
  --     (only scripts/seed.ts creates a flag, and it does that as the owner).
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','feature_flags','SELECT')),
       (has_table_privilege('presby_app','feature_flags','UPDATE'))
     ) as t(v) where v),
    2, 'B-H3: presby_app can read and toggle feature_flags');
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','feature_flags','INSERT')),
       (has_table_privilege('presby_app','feature_flags','DELETE'))
     ) as t(v) where v),
    0, 'B-H3: presby_app can neither create nor drop a feature flag');

  -- (d) The global catalogs are SELECT-only. scripts/seed.ts's five catalog
  --     writers moved to the owner connection in the same commit as this
  --     revoke; landing one without the other breaks `npm run db:seed`.
  select assert_eq(
    (select count(*) from unnest(array['permissions','features','role_features','roles','migration_seeds']) tbl
     where has_table_privilege('presby_app', tbl, 'SELECT')),
    5, 'B-H3: presby_app reads every global catalog');
  select assert_eq(
    (select count(*) from unnest(array['permissions','features','role_features','roles','migration_seeds']) tbl
     cross join unnest(array['INSERT','UPDATE','DELETE']) priv
     where has_table_privilege('presby_app', tbl, priv)),
    0, 'B-H3: presby_app cannot write ANY global catalog — a tenant request can no longer invent a permission key or a platform role');

  -- (e) The org tree stays SELECT-only (already true; restated in 0048 so the
  --     file is a self-sufficient statement of the posture).
  select assert_eq(
    (select count(*) from unnest(array['organizations','organization_identifiers','organization_successions','sasr_form_versions']) tbl
     cross join unnest(array['INSERT','UPDATE','DELETE']) priv
     where has_table_privilege('presby_app', tbl, priv)),
    0, 'B-H3: the org tree and the SASR form catalog stay SELECT-only for presby_app');

  -- 39.5 C-3 — the INVERTED FORCE catch-all.
  --
  -- The obvious predicate — "every table WITH an organization_id column
  -- carries FORCE" — is the SAME predicate as drizzle/0009's tenant_tables
  -- array, and that predicate is exactly what missed app_role_permissions,
  -- the one table in this review with a demonstrated cross-tenant write. It
  -- would have passed green all year with the hole open. It is also blind in
  -- the other direction: eight FORCE tables (people, addresses,
  -- contact_methods, person_identifiers, person_relationships,
  -- administrative_commissions, org_delegations, transfer_certificates) carry
  -- no organization_id at all.
  --
  -- So: EVERY table in schema public carries FORCE, except the named 25.
  -- The 51st table fails closed whether or not it has an organization_id.
  -- This list is the same 25 names as the B-H3 grant model in
  -- drizzle/0048 section 2; keep the two in sync.
  select assert_eq(
    (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity
        and c.relname not in (
          -- NextAuth adapter + the platform auth shell.
          'users','accounts','sessions','verification_tokens',
          'user_totp','user_totp_recovery_codes','user_totp_pending_enrollments',
          'password_reset_tokens','email_verification_tokens',
          -- Platform-shell application tables (admin-only surfaces).
          'user_roles','whats_new_entries','email_queue','feedback','feedback_prompt_state',
          -- Append-only platform log, and the platform rollout switch.
          'audit_events','feature_flags',
          -- Global catalogs: code- or migration-seeded, no tenant axis.
          'permissions','features','role_features','roles','migration_seeds',
          -- The org tree is PUBLIC information by design (the four-way miss
          -- response in CLAUDE.md depends on it), so it is SELECT-only rather
          -- than RLS-filtered. organization_identifiers is the one
          -- tenant-shaped exemption and is documented in its own table
          -- comment; sasr_form_versions has no organization_id at all.
          'organizations','organization_successions','organization_identifiers','sasr_form_versions'
        )),
    0, 'C-3: every table in schema public carries FORCE ROW LEVEL SECURITY except the 25 named platform-shell / global-catalog / org-tree tables');

  -- The list is not allowed to rot in the other direction either: if a table
  -- on it GAINS force (or is dropped), this count moves and the reader is
  -- told to prune the list rather than discovering a silently stale one.
  select assert_eq(
    (select count(*) from unnest(array[
       'users','accounts','sessions','verification_tokens',
       'user_totp','user_totp_recovery_codes','user_totp_pending_enrollments',
       'password_reset_tokens','email_verification_tokens',
       'user_roles','whats_new_entries','email_queue','feedback','feedback_prompt_state',
       'audit_events','feature_flags',
       'permissions','features','role_features','roles','migration_seeds',
       'organizations','organization_successions','organization_identifiers','sasr_form_versions'
     ]) tbl
     join pg_class c on c.relname = tbl
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where not c.relforcerowsecurity),
    25, 'C-3: every one of the 25 allow-listed names still exists and still lacks FORCE — the allow-list has not gone stale');

commit;

-- ---------------------------------------------------------------------------
-- 39.6 B-H2 — app_role_permissions. It carried NO row-level security at all:
--      as presby_app under Alder Creek's context, app_roles correctly
--      filtered to 15 rows while app_role_permissions returned all 71, 43 of
--      them bound to role_ids this session could not see — and an INSERT
--      naming one of those invisible role_ids succeeded (reproduced live,
--      rolled back, 2026-09-25).
--
--      Tenancy is INDIRECT here: the table has no organization_id of its own,
--      so the policy reaches through role_id -> app_roles.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from (values
       ((select relrowsecurity from pg_class where oid = 'app_role_permissions'::regclass)),
       ((select relforcerowsecurity from pg_class where oid = 'app_role_permissions'::regclass))
     ) as t(v) where v),
    2, 'B-H2: app_role_permissions has RLS ENABLED and FORCED (F1 — without FORCE the policies are inert for the owner and every naive test still passes)');

  select assert_eq(
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'app_role_permissions'
        and policyname in ('app_role_permissions_select','app_role_permissions_insert',
                           'app_role_permissions_update','app_role_permissions_delete')),
    4, 'B-H2: the four-policy split is in place, not a single tenant_isolation catch-all');

  -- UPDATE is revoked, so the UPDATE policy above is deliberately inert until
  -- a future caller and a future review grant it.
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','app_role_permissions','SELECT')),
       (has_table_privilege('presby_app','app_role_permissions','INSERT')),
       (has_table_privilege('presby_app','app_role_permissions','DELETE'))
     ) as t(v) where v),
    3, 'B-H2: presby_app keeps select/insert/delete — setRolePermissions() needs all three');
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','app_role_permissions','UPDATE'))
     ) as t(v) where v),
    0, 'B-H2: UPDATE is revoked — there is no live UPDATE caller, so the grant does not exist either');
commit;

begin;
  select set_config('app.current_org_id', :ALDER, true);

  -- Every visible binding belongs either to one of THIS org's roles or to a
  -- global template. Not one belongs to another congregation.
  select assert_eq(
    (select count(*) from app_role_permissions arp
      where not exists (
        select 1 from app_roles r
         where r.id = arp.role_id
           and (r.organization_id = :ALDER::uuid or r.organization_id is null))),
    0, 'B-H2: alder sees no binding belonging to another organization''s role');

  -- The `or organization_id is null` arm of the SELECT policy is LOAD-BEARING,
  -- not decorative: src/lib/role-definitions.ts's adoptTemplateRole() reads a
  -- GLOBAL template's own bindings through this table on `tx` before cloning
  -- them into the new org-scoped role. Drop the arm and adoption silently
  -- clones an empty permission set.
  select assert_eq(
    (select count(*) from app_role_permissions arp
       join app_roles r on r.id = arp.role_id
      where r.organization_id is null
        and r.id = :COMMITTEE_CHAIR_TEMPLATE_ROLE::uuid),
    (select count(*) from app_role_permissions arp
       join app_roles r on r.id = arp.role_id
      where r.id = :COMMITTEE_CHAIR_TEMPLATE_ROLE::uuid),
    'B-H2: the committee_chair TEMPLATE''s own bindings stay readable — adoptTemplateRole() clones them through this path');
rollback;

-- The write half, which is what B-H2 actually was. Each arm is attempted
-- against a role this session cannot even see through app_roles.
do $$
declare
  foreign_role uuid;
begin
  perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  select r.id into foreign_role from app_roles r
   where r.organization_id is not null
     and r.organization_id <> '22222222-2222-2222-2222-222222222222'::uuid
   limit 1;
  if foreign_role is not null then
    raise exception 'FAIL B-H2: a foreign org''s app_roles row is VISIBLE under alder context';
  end if;
  -- f0000000-...-03 is a Southern Fields role (seed-dev.sql); invisible above.
  begin
    insert into app_role_permissions (role_id, permission_key)
    values ('f0000000-0000-0000-0000-000000000003', 'people.manage');
    raise exception 'FAIL B-H2: cross-tenant INSERT into app_role_permissions SUCCEEDED';
  exception when insufficient_privilege then
    raise notice 'pass  B-H2: cross-tenant INSERT into app_role_permissions is refused by app_role_permissions_insert';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 39.7 B-M4 + B-L1 — group_types. Its tenant_isolation policy was
--      `organization_id = presby_current_org()` with no NULL arm, and 1563 of
--      1563 rows are global (DECISION-110 ruling 1), so the entire catalog
--      was invisible to presby_app and three reads in src/lib/groups.ts
--      escaped to getPlatformDb() to see it. Those three are back on `tx`.
-- ---------------------------------------------------------------------------
begin;
  select set_config('app.current_org_id', :ALDER, true);

  select assert_eq(
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'group_types'
        and policyname in ('group_types_select','group_types_insert',
                           'group_types_update','group_types_delete')),
    4, 'B-M4: group_types carries the four-policy split (drizzle/0032''s app_roles_select model), not tenant_isolation');
  select assert_eq(
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'group_types' and policyname = 'tenant_isolation'),
    0, 'B-M4: the old NULL-false tenant_isolation policy is gone');

  -- The six platform templates are now readable from the tenant connection.
  select assert_eq(
    (select count(*) from group_types where organization_id is null),
    6, 'B-M4: all six platform-wide group_types templates are visible to presby_app (they were invisible, hence the getPlatformDb() escapes in src/lib/groups.ts)');

  -- B-L1: exactly one row per key. 1557 duplicates were removed by
  -- drizzle/0048 section 5, and the constraint is what keeps it that way.
  select assert_eq(
    (select count(*) from group_types where organization_id is null),
    (select count(distinct key) from group_types where organization_id is null),
    'B-L1: one platform-wide group_types row per key — 1557 duplicates removed and the constraint prevents their return');

  -- NULLS NOT DISTINCT is the whole point. A plain unique (organization_id,
  -- key) constrains NOTHING here, because every row's organization_id is
  -- NULL and NULLs are distinct by default — which is how the duplicates
  -- accumulated under an index that looked like it covered this.
  select assert_eq(
    (select count(*) from pg_constraint c
       join pg_index i on i.indexrelid = c.conindid
      where c.conname = 'group_types_org_key'
        and c.contype = 'u'
        and i.indnullsnotdistinct),
    1, 'B-L1: group_types_org_key is UNIQUE NULLS NOT DISTINCT — the default NULLS DISTINCT form would constrain nothing on a table whose every row is global');
rollback;

-- The INSERT arm stays own-org-only: a tenant may not mint a platform
-- template. This is what keeps DECISION-110 ruling 1 true at the database.
do $$ begin
  perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  begin
    insert into group_types (organization_id, key, name) values (null, 'smuggled', 'Smuggled');
    raise exception 'FAIL B-M4: a tenant minted a PLATFORM-WIDE group_type';
  exception when insufficient_privilege then
    raise notice 'pass  B-M4: the SELECT arm admits globals but the INSERT arm does not — a tenant cannot mint a platform template';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 39.8 C-4 + B-L3 — the two cross-org roll functions leave the tenant role's
--      surface. presby_roll_cache_drift() is a SECURITY DEFINER reader with
--      no org predicate; presby_reconcile_current_roll() is a parameterless
--      cross-org WRITER of memberships.current_roll. Neither is F26's case (a
--      trigger inside a guarded operation) and neither is DECISION-135's
--      shape (derive the actor from presby_current_org(), check standing,
--      then act). CREATE FUNCTION grants EXECUTE to PUBLIC by default, so
--      there was never a grant statement to delete — only an explicit revoke
--      closes it.
--
--      This replaces the `presby_roll_cache_drift() = 0` assertion deleted
--      from section 10. That was a DATA claim (is the cache in sync today?),
--      not an isolation claim; its ops home is the daily cron's existing
--      `rollCacheRolledForward` field, and an on-call engineer can still call
--      the function ad hoc as neondb_owner.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from (values
       (has_function_privilege('presby_app','presby_roll_cache_drift()','EXECUTE')),
       (has_function_privilege('presby_app','presby_reconcile_current_roll()','EXECUTE')),
       (has_function_privilege('public','presby_roll_cache_drift()','EXECUTE')),
       (has_function_privilege('public','presby_reconcile_current_roll()','EXECUTE'))
     ) as t(v) where v),
    0, 'C-4/B-L3: neither presby_app nor PUBLIC holds EXECUTE on presby_roll_cache_drift() or presby_reconcile_current_roll()');
commit;

do $$ begin
  perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  begin
    perform presby_roll_cache_drift();
    raise exception 'FAIL C-4: presby_app CALLED the cross-org drift reader';
  exception when insufficient_privilege then
    raise notice 'pass  C-4: presby_app is refused EXECUTE on presby_roll_cache_drift() at the call, not merely by catalog inspection';
  end;
  begin
    perform presby_reconcile_current_roll();
    raise exception 'FAIL B-L3: presby_app CALLED the cross-org reconcile writer';
  exception when insufficient_privilege then
    raise notice 'pass  B-L3: presby_app is refused EXECUTE on presby_reconcile_current_roll() — the daily cron now calls it on the owner connection';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 39.9 B-M3 + B-L6 — five single-column tenant->tenant FKs became composite
--      (F2), and the three FK columns with no index at all got one.
--
--      role_grants.role_id is the one that changes behaviour rather than just
--      shape: the composite FK makes "adopt a template by CLONING it, never
--      by granting it directly" (src/lib/role-definitions.ts:771-850) a
--      DATABASE property instead of a code convention.
--
--      groups.group_type_id is DELIBERATELY EXCLUDED and must stay so. Every
--      group_types row is global (organization_id IS NULL), so under MATCH
--      SIMPLE a composite FK from a NOT NULL groups.organization_id would
--      reject every row in the table; and the F2 hazard it would close cannot
--      arise, because no org-owned group type exists by design.
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from pg_constraint
      where contype = 'f'
        and conname in ('events_parent_fk','person_milestones_roll_action_fk',
                        'publications_supersedes_fk','roll_actions_voids_fk',
                        'role_grants_role_fk')
        and array_length(conkey, 1) = 2
        and array_length(confkey, 1) = 2),
    5, 'B-M3: all five tenant->tenant FKs are COMPOSITE — a two-column key on both ends');

  -- The single-column originals are gone, not merely shadowed.
  select assert_eq(
    (select count(*) from pg_constraint
      where conname in ('events_parent_event_id_fkey',
                        'person_milestones_roll_action_id_roll_actions_id_fk',
                        'publications_supersedes_id_fkey',
                        'roll_actions_voids_action_id_roll_actions_id_fk',
                        'role_grants_role_id_app_roles_id_fk')),
    0, 'B-M3: the five single-column originals are dropped, not left alongside');

  select assert_eq(
    (select count(*) from pg_constraint
      where conname = 'app_roles_id_org_key' and contype = 'u'
        and array_length(conkey, 1) = 2),
    1, 'B-M3: app_roles carries unique (id, organization_id) — the anchor role_grants_role_fk references');

  -- The cascade is preserved exactly. deactivateRole()'s append-only trail
  -- depends on it; turning it into RESTRICT here would be a second, unrelated
  -- risk decision smuggled into one diff.
  select assert_eq(
    (select count(*) from pg_constraint
      where conname = 'role_grants_role_fk' and confdeltype = 'c'),
    1, 'B-M3: role_grants_role_fk keeps ON DELETE CASCADE — a shape change, not a behaviour change');

  select assert_eq(
    (select count(*) from pg_indexes
      where schemaname = 'public'
        and indexname in ('person_milestones_roll_action_idx','roll_actions_voids_idx','role_grants_role_idx')),
    3, 'B-L6: the three FK columns that had no index at all now have one');

  -- The documented exclusion, asserted so a future F2 sweep does not "fix" it.
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = 'groups'::regclass
        and c.confrelid = 'group_types'::regclass
        and array_length(c.conkey, 1) = 2),
    0, 'B-M3: groups.group_type_id stays a PLAIN single-column FK — a composite one would reject every row in the table (DECISION-110 ruling 1)');
commit;

-- role_grants: the composite FK now refuses to grant a global template
-- directly. Attempted on the tenant connection under a real org context.
do $$ begin
  perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  begin
    insert into role_grants (organization_id, role_id, person_id, starts_on)
    values ('22222222-2222-2222-2222-222222222222',
            '00000000-0000-0000-0000-000000000001',
            'c0000000-0000-0000-0000-000000000001', current_date);
    raise exception 'FAIL B-M3: a GLOBAL template role was granted directly — clone-not-grant is not enforced';
  exception
    when foreign_key_violation then
      raise notice 'pass  B-M3: role_grants_role_fk refuses a direct grant of a global template — adoption must clone (src/lib/role-definitions.ts:771-850)';
    when insufficient_privilege then
      raise notice 'pass  B-M3: refused before the FK could even be evaluated (RLS), which is also a refusal';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 39.10 N-6 — people gets the owner-path BEFORE DELETE guard organizations
--       already had. people is presby_app = arw (drizzle/0009:376 clawed
--       DELETE back) and carried ZERO triggers, so "Never Hard-Delete a
--       Person" was enforced on the tenant connection by a grant and on the
--       owner connection by NOTHING — and getPlatformDb() connects as
--       neondb_owner, whom no grant binds (F44). Only a trigger reaches that
--       path: BYPASSRLS and ownership bypass RLS, never triggers.
--
--       The trigger's own behaviour cannot be exercised from THIS connection
--       (presby_app is refused at the grant first, asserted below), which is
--       the point — it is an owner-path control. Its behaviour is covered by
--       the DB-backed vitest suites, every one of which runs its teardown
--       through getPlatformDb().
-- ---------------------------------------------------------------------------
begin;
  select assert_eq(
    (select count(*) from pg_trigger
      where tgrelid = 'people'::regclass and tgname = 'people_guard_delete'
        and not tgisinternal and tgenabled = 'O'),
    1, 'N-6: people carries an ENABLED people_guard_delete trigger (a disabled one is the same as no trigger)');

  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid = 'people'::regclass and t.tgname = 'people_guard_delete'
        and (t.tgtype & 8) = 8     -- TRIGGER_TYPE_DELETE  (1<<3)
        and (t.tgtype & 2) = 2     -- TRIGGER_TYPE_BEFORE  (1<<1)
        and (t.tgtype & 1) = 1),   -- TRIGGER_TYPE_ROW     (1<<0)
    1, 'N-6: it is BEFORE DELETE FOR EACH ROW — an AFTER trigger cannot refuse the delete');

  select assert_eq(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'presby_guard_people_delete'
        and p.prosecdef
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[]))),
    1, 'N-6: presby_guard_people_delete() ships SECURITY DEFINER with the pg_temp-last pin already on it — never a 15th non-compliant function');

  -- The exemption column exists and is the SAME mechanism organizations uses
  -- (a persisted per-row claim stamped at fixture INSERT), not a GUC arm any
  -- owner-connection caller could set.
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'people'
        and column_name = 'deletable_until' and data_type = 'timestamp with time zone'),
    1, 'N-6: people.deletable_until exists, matching organizations.deletable_until exactly (D10, drizzle/0044)');

  -- THE FIXTURE-LEAK CANARY IS DELIBERATELY NOT HERE, AND MUST NOT BE PUT
  -- BACK. It shipped here on 2026-09-25 as
  --
  --   select assert_eq(
  --     (select count(*) from people where deletable_until is not null),
  --     0, 'N-6: no person row carries a deletion window right now');
  --
  -- and QA caught it as an assertion that CANNOT FAIL. This suite runs as
  -- presby_app, this block sets no org context, and `people` is FORCE ROW
  -- LEVEL SECURITY — so `select count(*) from people` returns 0 of 678 rows
  -- on this connection no matter what the table holds. It reported `pass` in
  -- a green 456-assertion run while three leaked stamped rows were sitting in
  -- `people`. That is B-H1's exact failure mode and the reason F1 exists: an
  -- assertion that agrees with itself proves nothing.
  --
  -- The claim is an OWNER-PATH claim about rows this connection is not
  -- allowed to see, so it cannot honestly be made from here at all — not with
  -- an org context either, since a leak can be in any org. It now lives where
  -- the owner connection is available:
  --
  --   src/lib/db/fixture-deletable.test.ts
  --
  -- a DB-backed vitest spec reading through getPlatformDb().

  -- The tenant connection is refused at the GRANT, before the trigger is
  -- reached. Both layers, stated separately.
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app','people','DELETE'))
     ) as t(v) where v),
    0, 'N-6: presby_app still holds no DELETE on people — the trigger is the OWNER-path layer, not a replacement for the revoke');
rollback;

do $$ begin
  perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  begin
    delete from people where id = 'c0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL N-6: presby_app DELETED a person row';
  exception when insufficient_privilege then
    raise notice 'pass  N-6: a person record is never hard-deleted from the tenant connection (merge via merged_into_id instead)';
  end;
end $$;

\echo ''
\echo '======================================================'
\echo ' Section 39 (security review round B) complete.'
\echo '======================================================'

-- ===========================================================================
-- END APPENDED SECTION — pipeline/security-schema-b.
-- ===========================================================================

-- ===========================================================================
-- APPENDED BLOCK — section 40 (increment 6, docs/work-log/2026-09-25-
-- submission-grants.md, Phase 4 batch A). Workflow Rule 16: ONE delimited
-- block at the END of this file, so integration merges are mechanical.
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 40. Submission grants — a third credential class, and the affiliation
--     instant it forces a ruling on (D16 / DECISION-147 / F80;
--     drizzle/0049_presby_submission_grants.sql).
--
--     A GRANT IS NOT A PERMISSION AND NOT A FLAG. It is a token-bearing
--     CREDENTIAL: one presbytery, one congregation, one report year, one
--     write, expiring. The whole point of this section is that the mechanism
--     is enforced in the DATABASE — the tenant connection cannot reach the
--     claim columns, the claim is not repeatable, the issuance relationship is
--     a trigger and not a UI filter, and every liveness failure is one
--     indistinguishable literal.
--
--     WHAT THIS SUITE CAN AND CANNOT PROVE, in section 34/35's own idiom.
--     presby_app holds SELECT, INSERT and a COLUMN-LEVEL UPDATE (revoked_at)
--     and nothing else on statistics_submission_grants, so the claim and the
--     stamp arms of the freeze trigger are refused here by the PERMISSION
--     CHECK before the trigger is ever consulted — which proves the grant, not
--     the guard. The owner-connection twin of every one of those,
--     src/lib/db/domain/grants.test.ts, runs on PLATFORM_DATABASE_URL
--     (neondb_owner, which no grant binds and which BYPASSRLS exempts from
--     every policy — F44) and is where the trigger itself is the only thing
--     standing. The stale-credential half of F80 lives there too, because a
--     grant whose issuing presbytery no longer holds the congregation cannot
--     be CREATED from a tenant connection at all (the issuance trigger refuses
--     it), which is itself the point.
-- ---------------------------------------------------------------------------

-- (a) THE GRANT SHAPE. Isolation, the policy, and the column-level UPDATE that
--     — independently of any GUC — is what closes the tenant path to the claim
--     (QA-2's correction to F56: a marker binds the OWNER path only, so a
--     marker alone would be a guard with a hole in it).
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname = 'statistics_submission_grants'
        and relrowsecurity and relforcerowsecurity),
    1, 'grants: FORCE row level security is set on the credential table (F1)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'statistics_submission_grants'),
    1, 'grants: exactly ONE policy — tenant_isolation, no second named policy (DECISION-112''s refusal still stands)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename = 'statistics_submission_grants' and policyname = 'tenant_isolation'
        and qual like '%presby_current_org()%' and with_check like '%presby_current_org()%'),
    1, 'grants: tenant_isolation scopes BOTH read and write to presby_current_org()');

  -- The column-level grant, read three ways so a future blanket grant cannot
  -- re-widen it silently (F38's additive-grant drift is the failure mode).
  select assert_eq(
    (select count(*) from (select 1) s
      where has_column_privilege('presby_app', 'statistics_submission_grants', 'revoked_at', 'UPDATE')),
    1, 'grants: presby_app CAN update revoked_at — a presbytery revokes its own outstanding grant by ordinary tenant DML');
  select assert_eq(
    (select count(*) from (select 1) s
      where has_column_privilege('presby_app', 'statistics_submission_grants', 'submitted_at', 'UPDATE')
         or has_column_privilege('presby_app', 'statistics_submission_grants', 'return_id', 'UPDATE')),
    0, 'grants: presby_app can update NEITHER submitted_at NOR return_id — the claim and the stamp are unreachable from the tenant connection by PRIVILEGE, before any GUC is considered');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'statistics_submission_grants'
        and a.grantee = 'presby_app'::regrole
        and a.privilege_type in ('UPDATE', 'DELETE')),
    0, 'grants: presby_app holds no TABLE-level UPDATE and no DELETE at all — the revoked_at privilege is column-scoped (the relacl half of the same fact)');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'statistics_submission_grants'
        and a.grantee = 'presby_platform'::regrole),
    1, 'grants: presby_platform holds exactly ONE privilege on the credential table');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'statistics_submission_grants'
        and a.grantee = 'presby_platform'::regrole and a.privilege_type = 'SELECT'),
    1, 'grants: and that one privilege is SELECT — a platform-shell connection reading across every tenant may never ISSUE an authorization event (the same narrowing publications got)');

  -- The function-side of the same shape.
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('presby_submit_granted_return', 'presby_preview_granted_return')
        and has_function_privilege('presby_app', p.oid, 'execute')),
    2, 'grants: presby_app CAN execute the two credential functions — the token, not a session, is what authorizes the act (DECISION-147)');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('presby_write_return_publication_chain',
                          'presby_check_grant_about_org_unmanaged',
                          'presby_freeze_statistics_submission_grant')
        and has_function_privilege('presby_app', p.oid, 'execute')),
    0, 'B-M1 extended: presby_app holds EXECUTE on NONE of drizzle/0049''s internal/trigger-only functions — the chain writer is reachable only through the two DEFINER wrappers');
commit;

-- (b) THE FREEZE, TENANT SIDE. Which arm refuses, and WHY it refuses, stated
--     explicitly per section 35(d)'s "unarmed vs. grant-closed" distinction.
begin;
  select set_config('app.current_org_id', :PRESBY, true);

  -- Transition 1, the ONE thing ordinary tenant DML may do.
  update statistics_submission_grants
     set revoked_at = now()
   where id = 'ab000000-0000-0000-0000-000000000002';
  select assert_eq(
    (select count(*) from statistics_submission_grants
      where id = 'ab000000-0000-0000-0000-000000000002' and revoked_at is not null),
    1, 'grants: the presbytery revokes its own outstanding grant — transition 1, no GUC, ordinary tenant DML');

  -- The claim, from the tenant side, ARMED. The GUC does not help, because the
  -- privilege check happens first: "a marker is not a privilege" in one probe.
  do $$
  declare m text; c text;
  begin
    perform set_config('presby.grant_claim_active', 'true', true);
    update statistics_submission_grants
       set submitted_at = now()
     where id = 'ab000000-0000-0000-0000-000000000001';
    raise exception 'FAIL — a tenant connection claimed a grant by direct UPDATE';
  exception when insufficient_privilege then
    get stacked diagnostics m = message_text, c = returned_sqlstate;
    if m not like 'permission denied%' then
      raise exception 'FAIL — the claim was refused by the TRIGGER (%), not by the column grant; the column-level privilege is the half that must hold with the GUC armed', m;
    end if;
    raise notice 'pass  grants: a tenant connection cannot claim a grant even with presby.grant_claim_active ARMED — the column-level UPDATE grant refuses before the trigger is consulted (a marker is not a privilege)';
  end $$;

  -- ...and the freeze trigger IS live on the tenant path, proven on the one
  -- transition the column grant lets through: a second revocation of an
  -- already-revoked row.
  do $$
  declare m text;
  begin
    update statistics_submission_grants
       set revoked_at = now()
     where id = 'ab000000-0000-0000-0000-000000000003';
    raise exception 'FAIL — an already-revoked grant was revoked again; the freeze trigger is not firing on the tenant path';
  exception when check_violation then
    get stacked diagnostics m = message_text;
    if m not like '%already revoked at%' then
      raise exception 'FAIL — the re-revocation raised the wrong refusal: %', m;
    end if;
    raise notice 'pass  grants: a revoked grant is TERMINAL — presby_freeze_statistics_submission_grant() fires on the tenant path and refuses the second revocation (issue a new grant instead)';
  end $$;

  do $$
  begin
    delete from statistics_submission_grants where id = 'ab000000-0000-0000-0000-000000000003';
    raise exception 'FAIL — a tenant connection deleted a credential row';
  exception when insufficient_privilege then
    raise notice 'pass  grants: presby_app cannot DELETE a grant — expiry and revocation are the only ways out, and an organization teardown reaches these rows by cascade';
  end $$;
rollback;

-- (c) THE CLAIM, END TO END, AS presby_app WITH NO ORG CONTEXT SET AT ALL.
--     This is the ACTUAL SHAPE OF THE ANONYMOUS REQUEST (DECISION-147): the
--     application sets no app.current_org_id before calling, because doing so
--     would be withOrgContext() with the membership check deleted. The
--     function derives both organization ids from the grant row it just
--     authenticated, and its SECURITY DEFINER owner is what lets it read a
--     FORCE-RLS table with no context at all (F26/F44).
begin;
  do $$
  declare
    v_return_id uuid;
    v_again     uuid;
  begin
    if presby_current_org() is not null then
      raise exception 'FAIL — this probe must run with NO org context; presby_current_org() returned %', presby_current_org();
    end if;

    v_return_id := presby_submit_granted_return(
      'a7f3b4eeb465002f791d57e294ab7224a57a6fffdd6d2708dd307c5adf8f7e0c',
      '{"ending_active": 39, "ending_baptized": 12, "receipts_contributions": 84000.00}'::jsonb,
      'Odalys Fenwick', 'clerk_of_session');
    if v_return_id is null then
      raise exception 'FAIL — presby_submit_granted_return() returned null for a live grant';
    end if;
    raise notice 'pass  grants: an ANONYMOUS caller with no org context files a return through presby_submit_granted_return() — the token is the credential, and the function accepts no organization id it could be lied to with';

    -- NON-REPEATABLE. The same token, the same transaction, immediately.
    begin
      v_again := presby_submit_granted_return(
        'a7f3b4eeb465002f791d57e294ab7224a57a6fffdd6d2708dd307c5adf8f7e0c',
        '{"ending_active": 999}'::jsonb, 'Someone Else', 'moderator');
      raise exception 'FAIL — a spent grant was claimed a SECOND time';
    exception when insufficient_privilege then
      raise notice 'pass  grants: the SECOND call with the same token is refused — one indexed UPDATE ... RETURNING is the concurrency control, and a double-click, a second tab and a back-button resubmit all lose it here';
    end;
  end $$;

  -- The grant row is claimed AND stamped, in the one transaction.
  --
  -- Asserted WITHOUT joining statistical_returns, and that is itself a fact
  -- worth stating: from the issuing presbytery's own context the artifact is
  -- INVISIBLE under the tenant policy — it is owned by the congregation. The
  -- recipient reaches it only through presby_list_published_returns_to_me(),
  -- which is the next assertion. The publication event grants the read, not
  -- the tenant policy (D20).
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(*) from statistics_submission_grants
      where id = 'ab000000-0000-0000-0000-000000000001'
        and submitted_at is not null and return_id is not null),
    1, 'grants: the claimed row carries BOTH submitted_at and return_id — the atomic claim and the stamp, two sanctioned UPDATEs inside the one transaction');
  select assert_eq(
    (select count(*) from statistical_returns where id =
       (select return_id from statistics_submission_grants
         where id = 'ab000000-0000-0000-0000-000000000001')),
    0, 'grants: ...and the artifact itself is INVISIBLE from the issuing presbytery''s context — the composite FK points at a row the congregation owns, and the tenant policy does not grant the recipient a read (that is what the publication event is for)');
  select assert_eq(
    (select count(*) from presby_list_published_returns_to_me(:QUILLHAVEN, 2026) v
      where v.return_id = (select return_id from statistics_submission_grants
                            where id = 'ab000000-0000-0000-0000-000000000001')
        and v.attested_by_name = 'Odalys Fenwick'
        and v.attested_role = 'clerk_of_session'),
    1, 'grants: the recipient DOES see the grant-filed return through presby_list_published_returns_to_me(), attestation and all — the same read-back drizzle/0047 built, now with a second producer');

  -- The projection landed at the presbytery, about the congregation.
  select assert_eq(
    (select count(*) from congregation_statistics
      where organization_id = :PRESBY and about_org_id = :QUILLHAVEN
        and year = 2026 and provenance = 'published_by_congregation'
        and ending_active = 39 and receipts_contributions = 84000.00),
    1, 'grants: the projection is written at the RECIPIENT with the payload''s own values — jsonb_to_record extracted them BY NAME, so a missing key would be a loud NULL rather than a shifted column');

  -- THE ATTESTATION (F57). The first non-null values these two columns have
  -- ever carried, read from the congregation's own tenant space — which no
  -- human can enter, because Quillhaven is unmanaged (D9, by design).
  select set_config('app.current_org_id', :QUILLHAVEN, true);
  select assert_eq(
    (select count(*) from statistical_returns
      where organization_id = :QUILLHAVEN and about_org_id = :QUILLHAVEN
        and report_year = 2026 and provenance = 'submitted' and reconciled
        and attested_by_name = 'Odalys Fenwick'
        and attested_role = 'clerk_of_session'
        and attested_at is not null),
    1, 'F57: the grant path records a NAMED attester — the first non-null attested_by_name/attested_role in this platform, and the reason the grant path could not simply delegate to presby_publish_sasr_snapshot() (which writes both as literal null, deliberately)');
rollback;

-- (d) THE UNIFORM LITERAL. Four causes, one byte-identical message and one
--     errcode, asserted by string equality rather than by "some error" — a
--     probe that merely caught an exception would pass while the function
--     leaked which cause applied, which is the whole enumeration surface.
begin;
  do $$
  declare
    v_msgs text[] := array[]::text[];
    v_codes text[] := array[]::text[];
    m text; c text;
    v_tokens text[] := array[
      -- nonexistent
      '0000000000000000000000000000000000000000000000000000000000000000',
      -- expired (scripts/seed-dev.sql, 2024)
      '66fe4afd3f4e7f8e78753707f799bc4b31934c40c83137471cff89f41196844d',
      -- revoked (scripts/seed-dev.sql, 2023)
      '429cf4fc640910801810f1326833bfbeb6f478966782dcc4b9b48ef5d6f00444',
      -- spent: the live grant, claimed immediately below
      'a7f3b4eeb465002f791d57e294ab7224a57a6fffdd6d2708dd307c5adf8f7e0c'
    ];
    t text;
  begin
    -- Spend the live one first, so the fourth probe is a genuinely spent grant
    -- rather than a fixture frozen into a half-claimed state nobody wrote.
    perform presby_submit_granted_return(
      'a7f3b4eeb465002f791d57e294ab7224a57a6fffdd6d2708dd307c5adf8f7e0c',
      '{"ending_active": 39}'::jsonb, 'Odalys Fenwick', 'clerk_of_session');

    foreach t in array v_tokens loop
      begin
        perform presby_submit_granted_return(t, '{"ending_active": 1}'::jsonb, 'Probe', 'moderator');
        raise exception 'FAIL — a dead credential (%) was accepted', t;
      exception when insufficient_privilege then
        get stacked diagnostics m = message_text, c = returned_sqlstate;
        v_msgs := v_msgs || m;
        v_codes := v_codes || c;
      end;
    end loop;

    if array_length(v_msgs, 1) <> 4 then
      raise exception 'FAIL — expected four refusals, got %', array_length(v_msgs, 1);
    end if;
    if exists (select 1 from unnest(v_msgs) x where x <> 'presby_submit_granted_return: grant not usable') then
      raise exception 'FAIL — the refusals are not byte-identical: %', v_msgs;
    end if;
    if exists (select 1 from unnest(v_codes) x where x <> '42501') then
      raise exception 'FAIL — the refusals do not share one errcode: %', v_codes;
    end if;
    raise notice 'pass  grants: nonexistent, expired, revoked and already-spent tokens all raise the IDENTICAL literal (presby_submit_granted_return: grant not usable) under the identical errcode — the caller cannot tell which, which is what DECISION-040''s enumeration rule requires of this page';
  end $$;
rollback;

-- (e) ISSUANCE IS GUARDED TOO (F55/DECISION-141: creation as strongly as
--     mutation, in the shape the act deserves). Issuance is ordinary tenant
--     DML — the row's organization_id is the caller's own presbytery — so the
--     guard is two BEFORE INSERT triggers rather than function mediation. The
--     UI picker's filter is a convenience; THESE are the authority.
begin;
  select set_config('app.current_org_id', :PRESBY, true);

  do $$
  begin
    insert into statistics_submission_grants
      (organization_id, about_org_id, report_year, token_hash,
       issued_to_name, issued_to_email, issued_by, expires_at)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222', 2026, repeat('c', 64),
            'Probe', 'probe@example.invalid',
            'e0000000-0000-0000-0000-0000000000f4', now() + interval '30 days');
    raise exception 'FAIL — a grant was issued to a MANAGED congregation, which has its own portal and self-files';
  exception when invalid_parameter_value then
    raise notice 'pass  grants: statistics_submission_grants_unmanaged refuses a grant about a MANAGED congregation — the exclusion is a database property, not a dropdown filter (Phase 3 ruling 3)';
  end $$;

  do $$
  begin
    insert into statistics_submission_grants
      (organization_id, about_org_id, report_year, token_hash,
       issued_to_name, issued_to_email, issued_by, expires_at)
    values ('11111111-1111-1111-1111-111111111111',
            'e2e00000-0000-0000-0000-000000000004', 2026, repeat('d', 64),
            'Probe', 'probe@example.invalid',
            'e0000000-0000-0000-0000-0000000000f4', now() + interval '30 days');
    raise exception 'FAIL — a presbytery issued a grant naming ANOTHER presbytery''s congregation';
  exception when insufficient_privilege then
    raise notice 'pass  grants: statistics_submission_grants_about_org (drizzle/0045''s shared checker, empty year arg -> current_date) refuses a grant about a congregation this council does not hold TODAY — a presbytery cannot fabricate a return for another presbytery''s church';
  end $$;

  -- The legitimate case, so the two refusals above cannot be passing because
  -- issuance is broken outright.
  insert into statistics_submission_grants
    (organization_id, about_org_id, report_year, token_hash,
     issued_to_name, issued_to_email, issued_by, expires_at)
  values (:PRESBY, :QUILLHAVEN, 2027, repeat('1', 64),
          'Odalys Fenwick', 'clerk@quillhaven.example.invalid',
          'e0000000-0000-0000-0000-0000000000f4', now() + interval '45 days');
  select assert_eq(
    (select count(*) from statistics_submission_grants
      where organization_id = :PRESBY and about_org_id = :QUILLHAVEN and report_year = 2027),
    1, 'grants: an UNMANAGED congregation this presbytery holds today IS grantable — the positive control for the two refusals above');

  -- One live grant per (presbytery, congregation, year). Not an F40 oracle: it
  -- can only collide with the caller's OWN presbytery's row.
  do $$
  begin
    insert into statistics_submission_grants
      (organization_id, about_org_id, report_year, token_hash,
       issued_to_name, issued_to_email, issued_by, expires_at)
    values ('11111111-1111-1111-1111-111111111111',
            '44444444-4444-4444-4444-444444444444', 2027, repeat('2', 64),
            'Odalys Fenwick', 'clerk@quillhaven.example.invalid',
            'e0000000-0000-0000-0000-0000000000f4', now() + interval '45 days');
    raise exception 'FAIL — a second LIVE grant was issued for the same congregation and year';
  exception when unique_violation then
    raise notice 'pass  grants: statistics_submission_grants_live_idx permits exactly ONE outstanding grant per (presbytery, congregation, year) — revoke before re-issuing; a revoked or spent grant does not block a re-issue';
  end $$;
rollback;

-- (f) F80 — THE TWO AFFILIATION INSTANTS, and the late-filing population that
--     hits the gap. drizzle/0049 moves the year-endpoint collision check into
--     the shared chain writer, so both callers get it from ONE piece of code.
--
--     (i) The STALE-CREDENTIAL half — a grant whose issuing presbytery no
--     longer holds the congregation — is asserted STRUCTURALLY here and
--     behaviourally in src/lib/db/domain/grants.test.ts. It cannot be staged
--     from a tenant connection: creating such a grant requires the issuance
--     trigger to be absent (it refuses any about-org not affiliated TODAY),
--     and staging it by transferring the congregation afterwards requires the
--     two presbyteries' COMMON SUPERIOR as actor, which this fixture's rootless
--     northern reach does not have (measured, 2026-09-25).
begin;
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_submit_granted_return'
        and pg_get_functiondef(oid) like '%presby_affiliation_parent_as_of(v_grant.about_org_id, current_date::date)%'
        and pg_get_functiondef(oid) like '%v_recipient is distinct from v_grant.organization_id%'),
    1, 'F80/Phase 3 ruling 2: the claim re-resolves the recipient FRESH from the affiliation history and uses the grant''s stored organization_id only as a staleness equality check — a stored id is never treated as standing (Two Hierarchies)');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_submit_granted_return'
        and pg_get_functiondef(oid) like '%presby_write_return_publication_chain(%'),
    1, 'F80: and the grant path reaches the artifact ONLY through the shared chain writer — it does not carry its own copy of the three inserts (F39''s one-function-one-transaction premise survives the second caller)');
rollback;

--     (ii) The LATE-FILER half, end to end. Quillhaven was the Southern
--     Fields' until 1995 and the northern reach's since; a grant for report
--     year 1990 is therefore a return the northern reach may not receive. The
--     refusal must come from the MOVED check — before any row is written — and
--     must be the SAME STRING the self-publish caller sees, which is the
--     observable form of "one shared code path".
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  insert into statistics_submission_grants
    (organization_id, about_org_id, report_year, token_hash,
     issued_to_name, issued_to_email, issued_by, expires_at)
  values (:PRESBY, :QUILLHAVEN, 1990, repeat('b', 64),
          'Odalys Fenwick', 'clerk@quillhaven.example.invalid',
          'e0000000-0000-0000-0000-0000000000f4', now() + interval '30 days');

  do $$
  declare
    m_grant text; m_pub text; c_grant text; c_pub text;
    v_returns_before bigint;
  begin
    select count(*) into v_returns_before from statistical_returns;

    perform set_config('app.current_org_id', '', true);
    begin
      perform presby_submit_granted_return(
        repeat('b', 64), '{"ending_active": 39}'::jsonb, 'Odalys Fenwick', 'clerk_of_session');
      raise exception 'FAIL — a 1990 return was filed to a council that did not hold the congregation in 1990';
    exception when invalid_parameter_value then
      get stacked diagnostics m_grant = message_text, c_grant = returned_sqlstate;
    end;

    perform set_config('app.current_org_id', '44444444-4444-4444-4444-444444444444', true);
    begin
      perform presby_publish_sasr_snapshot(1990, 'n/a', p_ending_active => 39);
      raise exception 'FAIL — the self-publish path accepted the same 1990 return';
    exception when invalid_parameter_value then
      get stacked diagnostics m_pub = message_text, c_pub = returned_sqlstate;
    end;

    if m_grant <> m_pub or c_grant <> c_pub then
      raise exception 'FAIL — the two callers see DIFFERENT refusals (% / %) vs (% / %); the collision check has been duplicated rather than shared',
        c_grant, m_grant, c_pub, m_pub;
    end if;
    if m_grant not like 'presby_write_return_publication_chain:%' then
      raise exception 'FAIL — the refusal did not come from the shared chain writer: %', m_grant;
    end if;

    -- NOTHING WAS WRITTEN. The check runs before the first insert and before
    -- the GUC is armed, which is the difference between a named refusal and
    -- drizzle/0045''s opaque about-org message two rows later.
    if (select count(*) from statistical_returns) <> v_returns_before then
      raise exception 'FAIL — a refused late filing still wrote an artifact';
    end if;
    raise notice 'pass  F80: a late filer whose council changed AFTER the report year is refused by ONE shared check, before any of the three rows is written, with a BYTE-IDENTICAL message on the grant path and the self-publish path';
  end $$;
rollback;

-- (g) NO DRIFT IN THE RE-CREATED presby_publish_sasr_snapshot(). Section 34(h)
--     already asserts this function's contract; this re-runs its own test
--     vector through the refactored body and re-runs F39's equality, because
--     the extraction in drizzle/0049 is the riskiest change in the pipeline and
--     it touches a function outside this feature's blast radius.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    v_return_1 uuid;
    v_return_2 uuid;
    v_pub_1    uuid;
    v_pub_2    uuid;
  begin
    v_return_1 := presby_publish_sasr_snapshot(
      2029, 'Session stated meeting, 2030-01-10, item 3',
      p_ending_active => 220, p_ending_baptized => 48,
      p_avg_weekly_worship_attendance => 170, p_baptisms_children => 5,
      p_receipts_contributions => 425000.00, p_exp_local_program => 280000.00
    );
    if v_return_1 is null or not exists (select 1 from statistical_returns where id = v_return_1) then
      raise exception 'FAIL — the re-created function no longer returns the ARTIFACT''s id';
    end if;
    select id into v_pub_1 from publications where artifact_id = v_return_1;
    if (select recipient_org_id from publications where id = v_pub_1)
       is distinct from '11111111-1111-1111-1111-111111111111' then
      raise exception 'FAIL — the recipient is no longer resolved from the affiliation history';
    end if;
    if (select payload -> 'ending_active' from statistical_returns where id = v_return_1) <> '220'::jsonb then
      raise exception 'FAIL — the artifact''s payload changed shape under the extraction';
    end if;
    raise notice 'pass  drizzle/0049: the re-created presby_publish_sasr_snapshot() still returns the artifact id, still resolves the recipient from the affiliation history, and still stores the as-reported payload';

    v_return_2 := presby_publish_sasr_snapshot(
      2029, 'Session stated meeting, 2030-02-14, item 2 (correction)', p_ending_active => 221);
    select id into v_pub_2 from publications where artifact_id = v_return_2;
    if (select supersedes_id from publications where id = v_pub_2) is distinct from v_pub_1 then
      raise exception 'FAIL — the supersession chain broke under the extraction';
    end if;
    raise notice 'pass  drizzle/0049: the DERIVED supersession chain survives the extraction — the helper derives supersedes_id from the source council''s own history, never from a parameter';
  end $$;

  -- The projection, and F39's equality, read from the recipient's context.
  select set_config('app.current_org_id', :PRESBY, true);
  -- Joined through the read-back function, exactly as section 34(d) does and
  -- for the same reason: no single tenant context can see both tables
  -- directly, because the projection is the presbytery's and the publication
  -- is the congregation's.
  select assert_eq(
    (select count(*) from congregation_statistics cs
      join presby_list_published_returns_to_me(:ALDER, 2029) p
        on p.publication_id = cs.publication_id
     where cs.published_at = p.published_at
       and cs.minute_reference is not distinct from p.minute_reference),
    2, 'F39 re-run after the extraction: BOTH projections still carry the EXACT instant and minute of their own publication — one function, one transaction, two rows, no drift');
  select assert_eq(
    (select count(*) from congregation_statistics
      where about_org_id = :ALDER and year = 2029
        and provenance = 'published_by_congregation'
        and ending_active = 220 and ending_baptized = 48
        and avg_weekly_worship_attendance = 170 and baptisms_children = 5
        and receipts_contributions = 425000.00 and exp_local_program = 280000.00),
    1, 'drizzle/0049: the jsonb_to_record projection reproduces the 60-column row BYTE FOR BYTE — the same integers and the same numeric scale the old 60-parameter INSERT wrote, counts and money alike');
  select assert_eq(
    (select count(*) from congregation_statistics
      where about_org_id = :ALDER and year = 2029
        and (gains_certificate is not null or race_white is not null or budgeted_income is not null)),
    0, 'drizzle/0049: an unreported field extracts as NULL rather than as a shifted neighbour — jsonb_strip_nulls dropped it and jsonb_to_record matched BY NAME');
rollback;

-- (h) CATALOG PINS. A dropped trigger, a lost search_path pin or a
--     re-widened grant fails this suite rather than surfacing months later.
begin;
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'statistics_submission_grants'
        and t.tgenabled = 'O'
        and t.tgname in ('statistics_submission_grants_about_org',
                         'statistics_submission_grants_unmanaged',
                         'statistics_submission_grants_freeze')),
    3, 'grants: all three triggers exist and are ENABLED — two on creation, one on mutation');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'statistics_submission_grants'
        and t.tgname = 'statistics_submission_grants_freeze'
        and t.tgfoid = 'presby_freeze_statistics_submission_grant'::regproc
        -- tgtype bits: 1 = FOR EACH ROW, 2 = BEFORE, 16 = UPDATE.
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16),
    1, 'grants: the freeze is a row-level BEFORE UPDATE trigger executing the named function — it fires on the OWNER path too, which is the only thing that guards the claim there (F44)');
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_freeze_statistics_submission_grant'
        and pg_get_functiondef(oid) like '%presby.grant_claim_active%'
        and pg_get_functiondef(oid) not like '%presby.publication_write_active%'),
    1, 'F56: the freeze reads its OWN unshared GUC (presby.grant_claim_active) and never presby.publication_write_active — claiming a credential and writing an artifact are two claims about two subsystems');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and pg_get_functiondef(p.oid) like '%set_config(''presby.grant_claim_active''%'),
    1, 'F56: exactly ONE function in the database arms the claim marker — presby_submit_granted_return(), the sanctioned claimant');

  -- F60 / DECISION-148: pg_temp LAST, on every SECURITY DEFINER function
  -- drizzle/0049 defines. Asserted by exact element match, so a future
  -- `create or replace` that drops or reorders the clause is caught.
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.proname in ('presby_write_return_publication_chain',
                          'presby_publish_sasr_snapshot',
                          'presby_submit_granted_return',
                          'presby_preview_granted_return')
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[]))),
    4, 'F60/DECISION-148: all four SECURITY DEFINER functions drizzle/0049 defines pin search_path = public, pg_temp — pg_temp named LAST so it cannot shadow public');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not p.prosecdef
        and p.proname in ('presby_check_grant_about_org_unmanaged',
                          'presby_freeze_statistics_submission_grant')),
    2, 'DECISION-121: the two new trigger functions stay SECURITY INVOKER — one reads `organizations` (no RLS at all) and the other reads OLD/NEW and a GUC, so DEFINER would be cargo cult');

  -- The read-only preview the public page resolves through: same liveness
  -- predicate, no mutation, no cross-tenant column in its return type.
  select assert_eq(
    (select count(*) from pg_proc
      where proname = 'presby_preview_granted_return'
        and provolatile = 's' and prosecdef),
    1, 'grants: presby_preview_granted_return() is STABLE and SECURITY DEFINER — the page resolves a token without writing anything, and a dead token returns NO ROW rather than a distinguishable error');
  select assert_eq(
    (select count(*) from presby_preview_granted_return('a7f3b4eeb465002f791d57e294ab7224a57a6fffdd6d2708dd307c5adf8f7e0c')),
    1, 'grants: the preview resolves a LIVE token to one row (the congregation''s own public name and the report year — nothing another organization owns)');
  select assert_eq(
    (select (select count(*) from presby_preview_granted_return('66fe4afd3f4e7f8e78753707f799bc4b31934c40c83137471cff89f41196844d'))
          + (select count(*) from presby_preview_granted_return('429cf4fc640910801810f1326833bfbeb6f478966782dcc4b9b48ef5d6f00444'))
          + (select count(*) from presby_preview_granted_return('0000000000000000000000000000000000000000000000000000000000000000'))),
    0, 'grants: expired, revoked and nonexistent tokens all preview to NO ROW — the page cannot tell them apart, so its copy cannot either');
commit;

\echo ''
\echo '======================================================'
\echo ' Section 40 (submission grants) complete.'
\echo '======================================================'

-- ===========================================================================
-- END APPENDED SECTION — pipeline/submission-grants.
-- ===========================================================================
