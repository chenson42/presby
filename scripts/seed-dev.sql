-- Synthetic development seed. NOT production data.
--
-- Every name here is invented. No real congregation, presbytery, or person
-- appears in this file: this repo is public, and westervillelions'
-- docs/reviews/2026-08-12-pii-scrub.md is the cautionary tale for what it costs
-- to remove real names after the fact.
--
-- The fixture is deliberately shaped to exercise the cases that review found by
-- reasoning rather than by running anything:
--
--   D1  a pastor whose MEMBERSHIP is at the presbytery and whose SERVICE is at
--       a congregation - the case org-scoped people could not represent
--   D9  an unmanaged congregation the presbytery holds records about
--   F16 derived groups seeded at org creation, so the officer_terms trigger
--       has somewhere to project into
--   F22 an elder with two NON-CONSECUTIVE session terms, which is what the old
--       trigger silently collapsed
--   plus the one-active-roll constraint and the other-participants roll
--
-- The last section adds the post-login router fixture (P0): the destination
-- matrix has nine rows and the fixture above can reach two of them, so it seeds
-- the zero-org, unmanaged-only, invited-only, mixed, ended, and duplicate-person
-- users that the rest are unverifiable without.

begin;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
insert into organizations (id, parent_id, organization_type, name, slug, path, platform_status) values
  ('11111111-1111-1111-1111-111111111111', null,
   'presbytery', 'Presbytery of the Northern Reach', 'northern-reach',
   'northern_reach', 'managed'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'congregation', 'Alder Creek Presbyterian Church', 'alder-creek',
   'northern_reach.alder_creek', 'managed'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'congregation', 'Bramblewood Presbyterian Church', 'bramblewood',
   'northern_reach.bramblewood', 'managed'),
  -- D9: in the hierarchy, not a tenant. The presbytery stewards its records.
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'congregation', 'Quillhaven Presbyterian Church', 'quillhaven',
   'northern_reach.quillhaven', 'unmanaged');

-- require_two_factor differs between the two congregations on purpose: the
-- isolation suite asserts that presby_two_factor_required() reads the policy
-- at sign-in with no org GUC set (the F26 shape), and it can only prove that
-- if one church requires 2FA and another does not.
insert into organization_settings (organization_id, require_two_factor, settings) values
  ('22222222-2222-2222-2222-222222222222', true,  '{"hasDeacons": true, "sessionServesAsTrustees": false}'),
  ('33333333-3333-3333-3333-333333333333', false, '{"hasDeacons": false, "sessionServesAsTrustees": true}');

-- ---------------------------------------------------------------------------
-- F16: derived groups must exist before any officer term is recorded, or the
-- sync trigger raises. Seeding them at org creation is the real fix.
-- ---------------------------------------------------------------------------
insert into group_types (id, organization_id, key, name) values
  ('a0000000-0000-0000-0000-000000000001', null, 'court', 'Court'),
  ('a0000000-0000-0000-0000-000000000002', null, 'committee', 'Committee');

insert into groups (id, organization_id, group_type_id, name, membership_source, derived_from, is_protected) values
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000001', 'Session', 'derived', 'session', true),
  ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000001', 'Board of Deacons', 'derived', 'diaconate', true),
  ('b0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'a0000000-0000-0000-0000-000000000001', 'Session', 'derived', 'session', true),
  -- A managed group, for contrast: staff edit this roster freely.
  ('b0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002', 'Property Committee', 'managed', null, false);

-- ---------------------------------------------------------------------------
-- People (global) - invented names
-- ---------------------------------------------------------------------------
insert into people (id, first_name, last_name, date_of_birth) values
  ('c0000000-0000-0000-0000-000000000001', 'Marguerite', 'Ashcombe',  '1958-04-11'),
  ('c0000000-0000-0000-0000-000000000002', 'Tobias',     'Renwick',   '1971-09-02'),
  ('c0000000-0000-0000-0000-000000000003', 'Priya',      'Balakrishnan','1984-01-27'),
  ('c0000000-0000-0000-0000-000000000004', 'Desmond',    'Okonkwo',   '1992-06-15'),
  ('c0000000-0000-0000-0000-000000000005', 'Hallie',     'Vandermeer','2011-03-08'),
  -- The pastor. D1's whole justification.
  ('c0000000-0000-0000-0000-000000000006', 'Rowan',      'Thistlewood','1969-11-30');

insert into person_identifiers (person_id, kind, value_normalized, is_verified, is_shared, source) values
  ('c0000000-0000-0000-0000-000000000001', 'email', 'm.ashcombe@example.invalid',  true,  false, 'self_service'),
  ('c0000000-0000-0000-0000-000000000006', 'email', 'r.thistlewood@example.invalid', true, false, 'self_service'),
  -- The shared household address every church has. is_shared opts out of the
  -- partial unique index; without it these two rows would collide.
  ('c0000000-0000-0000-0000-000000000002', 'email', 'renwick.house@example.invalid', true, true, 'import'),
  ('c0000000-0000-0000-0000-000000000003', 'email', 'renwick.house@example.invalid', true, true, 'import');

insert into households (id, organization_id, name, is_giving_unit) values
  ('d0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'The Renwick Family', true),
  ('d0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Marguerite Ashcombe', true);

-- ---------------------------------------------------------------------------
-- Memberships. The pastor holds TWO: membership at the presbytery
-- (G-2.0502) and service at the congregation.
-- ---------------------------------------------------------------------------
insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'head', 'regular', 'active', '1996-05-12'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'head', 'regular', 'active', '2004-10-03'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'spouse', 'regular', 'active', '2004-10-03'),
  -- Not a member. On the other-participants roll, and fully in the directory.
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000004', null, null, 'regular', 'other_participant', '2023-02-19'),
  -- A baptized member: baptized, enrolled, has not professed faith.
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'child', 'regular', 'baptized', '2011-06-05'),
  -- The pastor: membership at the PRESBYTERY (G-2.0502).
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000006', null, null, 'regular', 'active', '2015-08-01');

-- The pastor also serves a congregation. This is a SECOND membership for a
-- person who already exists elsewhere, so the F21 guard blocks it unless a link
-- is authorized. In the app that authorization is presby_link_person() with
-- reason 'installation'; a seed runs as owner and sets the flag directly.
--
-- F23 was found exactly here: the guard originally accepted only transfer
-- certificates, which made the minister case - the one D1 exists to support -
-- impossible to represent.
select set_config('app.person_claim_authorized', 'c0000000-0000-0000-0000-000000000006', true);

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
  -- Service at the congregation. NO active roll here: their membership is at
  -- the presbytery, which is also why the one-active-roll index is satisfied.
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000006', null, null, 'regular', null, null);

-- ---------------------------------------------------------------------------
-- Ordinations and officer terms
-- ---------------------------------------------------------------------------
insert into ordinations (organization_id, person_id, ministry, ordained_on) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001', 'ruling_elder', '2005-01-09'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002', 'ruling_elder', '2016-01-10'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000003', 'deacon',       '2019-01-13'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000006', 'minister_of_word_and_sacrament', '1998-06-21');

-- F22: two NON-CONSECUTIVE session terms for one person. The old trigger
-- collapsed these, rewriting the 2005 term's end date and destroying the
-- record of who served when.
insert into officer_terms (id, organization_id, person_id, office, class_year, starts_on, ends_on, end_reason, recorded_by) values
  ('e0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000001', 'ruling_elder', 2008, '2005-01-09', '2008-01-13', 'completed', null),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000001', 'ruling_elder', 2027, '2024-01-14', '2027-01-10', null, null),
  ('e0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000002', 'ruling_elder', 2026, '2023-01-08', '2026-01-11', null, null),
  ('e0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000003', 'deacon',       2025, '2022-01-09', '2025-01-12', null, null),
  -- Open-ended office: no class, no end date.
  ('e0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000002', 'clerk_of_session', null, '2023-01-08', null, null, null);

-- ---------------------------------------------------------------------------
-- Roll actions. approval_status='approved' rows are frozen by trigger.
-- ---------------------------------------------------------------------------
insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, age_at_action, approval_status, minute_reference, approved_on, proposed_by) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001', 'opening_balance', '2020-01-01', 'active', 61, 'approved', 'Imported baseline', '2020-01-01', null),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002', 'opening_balance', '2020-01-01', 'active', 48, 'approved', 'Imported baseline', '2020-01-01', null),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000003', 'opening_balance', '2020-01-01', 'active', 35, 'approved', 'Imported baseline', '2020-01-01', null),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005', 'baptized_member_enrolled', '2011-06-05', 'baptized', 0, 'approved', 'Session 2011-06-05, item 4', '2011-06-05', null),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000004', 'other_participant_enrolled', '2023-02-19', 'other_participant', 30, 'approved', 'Ratified 2023 annual roll review', '2023-12-10', null),
  -- Still pending: this is the clerk's session-agenda worklist.
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000004', 'profession_of_faith', '2026-09-13', 'active', 34, 'pending', null, null, null);

-- The pastor's membership at the PRESBYTERY needs an action behind it like any
-- other. Caught by presby_roll_cache_drift(): the seed set a roll with no
-- action to derive it from, which is exactly the inconsistency the detector
-- exists to find.
insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                          age_at_action, approval_status, minute_reference, approved_on)
values ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000006',
        'opening_balance','2015-08-01','active', 45,'approved','Imported baseline','2015-08-01');

-- A dismissal recorded in error, then VOIDED. Invariant 4: corrections are new
-- actions, never updates - so the read path has to exclude both the void and
-- the action it cancels, and the report line must stay at zero.
insert into roll_actions (id, organization_id, person_id, kind, effective_date, resulting_roll,
                          age_at_action, approval_status, minute_reference, approved_on)
values ('f1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
        'c0000000-0000-0000-0000-000000000003','certificate_dismissed','2026-07-01', null,
        42,'approved','Session 2026-07-05, item 2','2026-07-05');

insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                          approval_status, minute_reference, approved_on, voids_action_id)
values ('22222222-2222-2222-2222-222222222222','c0000000-0000-0000-0000-000000000003',
        'void', '2026-08-09', null, 'approved',
        'Session 2026-08-09, item 6 - recorded in error','2026-08-09',
        'f1000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Authorization fixture
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier) values
  ('roll.propose','roll','Propose a roll action',1),
  ('roll.approve','roll','Approve a roll action',1),
  ('directory.view','directory','Browse the directory',1),
  ('ledger.approve','ledger','Approve a disbursement',2),
  ('pastoral.notes.view','pastoral','Read pastoral care notes',3)
on conflict (key) do nothing;

insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
   'session_member','Session Member','constitutional',true),
  ('f0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
   'property_chair','Property Committee Chair','custom',false);

insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000001','roll.approve'),
  ('f0000000-0000-0000-0000-000000000001','directory.view'),
  ('f0000000-0000-0000-0000-000000000002','directory.view');

-- Granted to the DERIVED Session group, not to a person. This is the F3 case:
-- if the roster were a view rather than materialized rows, the resolver would
-- find nobody here.
insert into role_grants (organization_id, role_id, group_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001','2020-01-01');

-- A direct grant, for contrast.
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000002','2024-01-01');

-- An administrative commission: the one case where a council reaches DOWN into
-- a congregation. Its members are a group AT THE PRESBYTERY, which is why the
-- resolver's third arm needs SECURITY DEFINER to see them (F26/F27).
insert into group_types (id, organization_id, key, name) values
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','committee','Committee');
insert into groups (id, organization_id, group_type_id, name, membership_source) values
  ('b0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000003','Commission on Alder Creek','managed');
insert into group_memberships (organization_id, group_id, person_id, starts_on) values
  ('11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-000000000005',
   'c0000000-0000-0000-0000-000000000006','2026-01-01');
insert into administrative_commissions
  (parent_org_id, target_org_id, scope, role_id, group_id, starts_on, ends_on, minute_reference)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
        'original_jurisdiction','f0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000005','2026-01-01','2026-12-31',
        'Presbytery 2026-01-15, item 9');

insert into sasr_reports (organization_id, report_year, official_beginning_balance, computed_beginning_balance, ending_active, status) values
  ('22222222-2222-2222-2222-222222222222', 2025, 118, 116, 115, 'submitted'),
  -- D9: unmanaged org has no roll, so computed_beginning_balance is NULL.
  -- The projection must render "not derived", never 0.
  ('44444444-4444-4444-4444-444444444444', 2025, 41, null, 39, 'submitted');

-- ---------------------------------------------------------------------------
-- A platform user linked to a fixture person.
--
-- Exists so the isolation suite can assert presby_two_factor_required(), which
-- resolves the per-congregation 2FA policy at SIGN-IN — with no org GUC set,
-- because choosing an organization happens after authentication. That is the
-- F26 shape exactly: without SECURITY DEFINER the function is filtered to zero
-- rows and quietly returns false for the users it protects. An assertion needs
-- a user_id link to catch that, so the fixture provides one.
--
-- Synthetic, inactive-by-omission (no password, so it cannot sign in) and on
-- the reserved example.invalid domain.
-- ---------------------------------------------------------------------------
insert into users (id, email, name, email_verified)
values ('e0000000-0000-0000-0000-0000000000f2', 'elder.fixture@example.invalid',
        'Fixture Elder', now())
on conflict (id) do nothing;

update people
   set user_id = 'e0000000-0000-0000-0000-0000000000f2'
 where id = 'c0000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- The post-login router fixture (P0)
-- ---------------------------------------------------------------------------
-- Deliberately NOT at Alder Creek or Bramblewood. scripts/test-rls.sql asserts
-- exact counts in both ('alder: sees own memberships' = 6, 'bramblewood: sees
-- no alder memberships' = 0, and the whole roll/SASR section), so a row added
-- there turns a fixture addition into a suite-wide count edit - which is how a
-- deliberate change becomes a green-tests chore. Two new congregations instead,
-- so every assertion that sets a specific org GUC is blind to them.
--
-- Neither gets an organization_settings row, so the 2FA-policy assertions in
-- section 11 are untouched (absent row = not required).
insert into organizations (id, parent_id, organization_type, name, slug, path, platform_status) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'congregation', 'Fernwood Presbyterian Church', 'fernwood',
   'northern_reach.fernwood', 'managed'),
  -- Onboarding: stewarded by the presbytery pending handover. A membership here
  -- yields no card and no portal — only different copy on /no-organization.
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   'congregation', 'Marrowbone Presbyterian Church', 'marrowbone',
   'northern_reach.marrowbone', 'invited');

-- Six users, one per row of the destination matrix that the existing fixture
-- cannot reach. All password-less like elder.fixture: they cannot sign in, and
-- they exist for scripts/test-rls.sql and for manual browser verification with
-- a dev session. Reserved example.invalid domain, invented names.
insert into users (id, email, name, email_verified) values
  ('e0000000-0000-0000-0000-0000000000a1', 'router.none@example.invalid',      'Fixture No-Org',    now()),
  ('e0000000-0000-0000-0000-0000000000a2', 'router.unmanaged@example.invalid', 'Fixture Unmanaged', now()),
  ('e0000000-0000-0000-0000-0000000000a3', 'router.invited@example.invalid',   'Fixture Invited',   now()),
  ('e0000000-0000-0000-0000-0000000000a4', 'router.mixed@example.invalid',     'Fixture Mixed',     now()),
  ('e0000000-0000-0000-0000-0000000000a5', 'router.ended@example.invalid',     'Fixture Ended',     now()),
  ('e0000000-0000-0000-0000-0000000000a6', 'router.dup@example.invalid',       'Fixture Duplicate', now())
on conflict (id) do nothing;

-- router.none@ deliberately has NO people row. A person who signs up from the
-- backbone marketing page and has never been added to a congregation is the
-- zero-rows branch of /no-organization, and it is a funnel, not a bug.

insert into people (id, user_id, first_name, last_name) values
  ('c1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2', 'Odalys',  'Winterbourne'),
  ('c1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a3', 'Ptolemy', 'Gaddis'),
  ('c1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-0000000000a4', 'Ines',    'Kirkbride'),
  ('c1000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-0000000000a5', 'Emeric',  'Ravensworth'),
  -- TWO person rows sharing one user_id. memberships_person_org_key already
  -- makes two memberships for one person at one org impossible, so this is the
  -- ONLY reachable way a user gets two rows for one congregation - and it is
  -- why de-duplication is the TypeScript wrapper's job rather than a comment.
  ('c1000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-0000000000a6', 'Susanna', 'Delacroix-Peel'),
  ('c1000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-0000000000a6', 'Susanna', 'Peel');

-- current_roll is null on every row below on purpose. DECISION-039: memberships
-- is the universal relationship anchor and roll status is a COLUMN on it, not
-- its meaning. These six are relationships without a roll - which is exactly
-- what the presbytery-committee elder and the secretary who worships elsewhere
-- look like, and the router must return them.
insert into memberships (organization_id, person_id, engagement_status, current_roll, ended_on) values
  -- Only relationship is at an unmanaged org: no card, and /no-organization has
  -- to say something truer than "you are not connected to a congregation".
  ('44444444-4444-4444-4444-444444444444', 'c1000000-0000-0000-0000-000000000001', 'regular', null, null),
  -- Only relationship is at an org still being set up.
  ('66666666-6666-6666-6666-666666666666', 'c1000000-0000-0000-0000-000000000002', 'regular', null, null),
  -- Managed + unmanaged. ONE card, not two.
  ('55555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-000000000003', 'regular', null, null),
  -- The relationship ended. presby_user_organizations still returns it, which
  -- is what makes "your access to Fernwood ended on 31 March 2026" possible
  -- without a second query.
  ('55555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-000000000004', 'regular', null, '2026-03-31'),
  ('55555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-000000000005', 'regular', null, null),
  ('55555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-000000000006', 'regular', null, null);

-- The mixed user's SECOND membership. The person already exists elsewhere, so
-- the F21 guard blocks a plain insert; in the app that authorization is
-- presby_link_person(), and a seed running as owner sets the flag directly.
select set_config('app.person_claim_authorized', 'c1000000-0000-0000-0000-000000000003', true);

insert into memberships (organization_id, person_id, engagement_status, current_roll) values
  ('44444444-4444-4444-4444-444444444444', 'c1000000-0000-0000-0000-000000000003', 'regular', null);

-- An open ROLE GRANT at Fernwood, so the DECISION-039 guard can be exercised on
-- its second arm. The officer-term arm already has a precondition at Alder
-- Creek (the open clerk_of_session term at scripts/seed-dev.sql, person ...002);
-- without this one, half of each trigger would ship unverified.
--
-- The guarded state itself - an ended membership under an open position - is
-- deliberately NOT seedable: the triggers exist to make it unreachable. The
-- fixture is the PRECONDITION; scripts/test-rls.sql attempts the end and
-- catches the raise.
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555',
   'fernwood_directory','Fernwood Directory Reader','custom', false);

insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000003','directory.view');

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('55555555-5555-5555-5555-555555555555','f0000000-0000-0000-0000-000000000003',
   'c1000000-0000-0000-0000-000000000003','2026-01-01');

commit;
