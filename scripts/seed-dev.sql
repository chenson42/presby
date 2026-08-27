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
-- trackDisabilityPerPerson is true only at Alder Creek — "prove the
-- mechanism once" (member edit: tiered sensitive information, DECISION-108),
-- so member_care_admin's disabilities.manage grant (Aldous Fennimore, below)
-- has a real fixture to exercise the disabilities section end-to-end, while
-- Bramblewood stays a clean "tracking off, section absent regardless of
-- grant" case for free.
insert into organization_settings (organization_id, require_two_factor, settings) values
  ('22222222-2222-2222-2222-222222222222', true,  '{"hasDeacons": true, "sessionServesAsTrustees": false, "trackDisabilityPerPerson": true}'),
  ('33333333-3333-3333-3333-333333333333', false, '{"hasDeacons": false, "sessionServesAsTrustees": true}');

-- ---------------------------------------------------------------------------
-- F16: derived groups must exist before any officer term is recorded, or the
-- sync trigger raises. Seeding them at org creation is the real fix.
-- ---------------------------------------------------------------------------
insert into group_types (id, organization_id, key, name) values
  ('a0000000-0000-0000-0000-000000000001', null, 'court', 'Court'),
  ('a0000000-0000-0000-0000-000000000002', null, 'committee', 'Committee'),
  -- P1 / DECISION-060: the active_membership derived group's type, parallel
  -- to court/committee — a platform-wide template, not owned by any one org.
  ('a0000000-0000-0000-0000-000000000004', null, 'roster', 'Roster');

insert into groups (id, organization_id, group_type_id, name, membership_source, derived_from, is_protected) values
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000001', 'Session', 'derived', 'session', true),
  ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000001', 'Board of Deacons', 'derived', 'diaconate', true),
  ('b0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'a0000000-0000-0000-0000-000000000001', 'Session', 'derived', 'session', true),
  -- A managed group, for contrast: staff edit this roster freely.
  ('b0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002', 'Property Committee', 'managed', null, false),
  -- P1 / DECISION-060/063: drizzle/0017's memberships_sync_derived_group
  -- trigger fails loudly on ANY memberships insert at an org with no
  -- active_membership group yet — so this has to exist at every fixture org
  -- a membership can target, not only the two this block already covers.
  -- Named 'Active Membership' verbatim: presby_effective_permissions()'s
  -- group arm surfaces this as source_name, and scripts/test-rls.sql section
  -- 9 asserts on that exact string.
  ('b0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000004', 'Active Membership', 'derived', 'active_membership', true),
  ('b0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000004', 'Active Membership', 'derived', 'active_membership', true),
  ('b0000000-0000-0000-0000-000000000008', '33333333-3333-3333-3333-333333333333',
   'a0000000-0000-0000-0000-000000000004', 'Active Membership', 'derived', 'active_membership', true),
  ('b0000000-0000-0000-0000-000000000009', '44444444-4444-4444-4444-444444444444',
   'a0000000-0000-0000-0000-000000000004', 'Active Membership', 'derived', 'active_membership', true);

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
-- P1: ELDER's row is inserted SEPARATELY from the block below, with an
-- explicit created_at, because drizzle/0017's derived-group sync trigger
-- stamps group_memberships.starts_on from `new.created_at::date` (memberships
-- has no starts_on column of its own — DECISION-060/0017's own comment). Left
-- at the column default (now()), ELDER's Active Membership grant would only
-- be visible as of TODAY, and scripts/test-rls.sql's as-of-2015-06-01
-- assertion — written on the premise that ELDER's is "a long-standing,
-- always-active Alder Creek membership" — would see nothing. Backdating to
-- current_roll_since (the date the relationship actually began) makes the
-- trigger's stamp match the story the fixture already tells, rather than the
-- day this script happened to run.
insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since, created_at) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'head', 'regular', 'active', '1996-05-12', '1996-05-12T00:00:00Z');

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
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

-- P9-role-catalog / DECISION-080: two more open-ended offices the schema
-- already anticipated (src/lib/db/domain/officers.ts:84,96 lists 'treasurer'
-- alongside 'clerk_of_session' as an open-ended office; 'installed_pastor' is
-- lifted from docs/schema-design.md §8's own phrase, per DECISION-079).
-- starts_on picks up the day after Priya's diaconate term ended (below) and
-- Rowan's presbytery current_roll_since respectively — the software grant
-- begins when the office did, matching stated_clerk's own precedent.
insert into officer_terms (id, organization_id, person_id, office, class_year, starts_on, ends_on, end_reason, recorded_by) values
  ('e0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000003', -- Priya Balakrishnan
   'treasurer', null, '2025-01-13', null, null, null),
  ('e0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000006', -- Rowan Thistlewood
   'installed_pastor', null, '2015-08-01', null, null, null);

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
  -- P9 / DECISION-066: duplicates drizzle/0018_presby_role_administration.sql's
  -- own insert, same "both use on conflict do nothing" pattern directory.view
  -- already established between 0017 and this file.
  ('role_grants.manage','authz','Grant or revoke a role at this organization',1),
  -- Portal home + directory v2, Increment 4: duplicates
  -- drizzle/0025_presby_deacon_linkage.sql's own insert, same pattern.
  ('directory.view_hidden','directory','See directory-hidden rows and the deacon roster',1),
  -- Member management (docs/work-log/2026-08-25-member-management.md):
  -- duplicates drizzle/0026_presby_org_feature_toggles.sql's and
  -- drizzle/0027_presby_member_management.sql's own inserts, same pattern.
  ('org_features.manage','org_features','Turn optional portal features on or off for this organization',1),
  ('people.manage','people','Create and edit people, households, and contact/address detail',1),
  -- Member edit: tiered sensitive information (docs/work-log/
  -- 2026-08-26-member-sensitive-info.md, DECISION-108): duplicates
  -- drizzle/0031_presby_sensitive_info_permissions.sql's own insert, same
  -- pattern. That same migration retires 'pastoral.notes.view' (removed
  -- above, superseded by pastoral_notes.manage on the same office,
  -- installed_pastor) — never re-inserted here.
  ('pastoral_notes.manage','pastoral','Manage pastoral care notes for a person',3),
  ('demographics.manage','demographics','Manage SASR demographic data for a person',3),
  ('medical.manage','medical','Manage children''s-safety medical info for a person',3),
  ('disabilities.manage','disabilities','Manage per-person disability records',3),
  -- Children's ministry, Increment A (docs/work-log/
  -- 2026-08-26-childrens-ministry.md) / DECISION-111/114: duplicates
  -- drizzle/0035_presby_children_ministry_permission.sql's own insert, same
  -- pattern as every other permission-catalog migration this session.
  ('children.roster','children','View the children''s roster and manage guardian links for a child',2)
on conflict (key) do nothing;

insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
   'session_member','Session Member','constitutional',true),
  ('f0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
   'property_chair','Property Committee Chair','custom',false),
  -- P1 / G-A / DECISION-060/063: the baseline-grant role, bound to the
  -- active_membership derived group below. Constitutional and protected —
  -- every congregation gets this role once real org provisioning exists
  -- (G-B, still unbuilt); it is not a staff-created custom role.
  ('f0000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222',
   'member','Member','constitutional',true),
  -- P9 / DECISION-066: the bootstrap role for role_grants.manage. G-3.0104's
  -- Stated Clerk maps onto "who clicks grant/revoke" - a designated office,
  -- not a wildcard bound to the whole Session. Direct-granted only, never to
  -- a group (see the role_grants row below).
  ('f0000000-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222',
   'stated_clerk','Stated Clerk','constitutional',true),
  -- P9-role-catalog / DECISION-080: tickets.file's own role — property_chair's
  -- shape (custom, unprotected), NOT a repurposed constitutional office. No
  -- PC(USA) office corresponds to "point of contact with outside software
  -- support" (Phase 1's own reasoning); minting one would repeat the
  -- "churchy name for a software convenience" DECISION-066's bar rules out.
  ('f0000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222',
   'support_contact','Support Contact','custom',false),
  -- P9-role-catalog / DECISION-080: Treasurer — constitutional, protected.
  -- G-3.0205 assumes a Treasurer at every congregation; officers.ts:84,96
  -- already anticipated the office key.
  ('f0000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222',
   'treasurer','Treasurer','constitutional',true),
  -- P9-role-catalog / DECISION-079/080: Installed Pastor — constitutional,
  -- protected. Key names the pastoral relationship, never the presiding
  -- (Moderator) function, per DECISION-079's tier-3 constraint.
  ('f0000000-0000-0000-0000-000000000008','22222222-2222-2222-2222-222222222222',
   'installed_pastor','Installed Pastor','constitutional',true),
  -- Portal home + directory v2, Increment 4 / DECISION-095: the honest
  -- Session/Diaconate mirror of session_member (f...0001) — constitutional,
  -- protected, bound to the DERIVED Board of Deacons group below, never to a
  -- person. Carries directory.view_hidden (elevated visibility + the
  -- parishes roster), not a wildcard.
  ('f0000000-0000-0000-0000-000000000009','22222222-2222-2222-2222-222222222222',
   'diaconate_member','Diaconate Member','constitutional',true),
  -- Tenant branding permission (docs/work-log/2026-08-26-tenant-branding-
  -- permission.md) / DECISION-101 (architect) / DECISION-103 (tech-lead): a
  -- NEW role, deliberately not bound to stated_clerk — piling a seventh
  -- permission onto that office (which already carries role_grants.manage,
  -- roll.propose, roll.approve, directory.view_hidden, org_features.manage,
  -- people.manage, officers.manage) would recreate exactly the "one office,
  -- every capability" wildcard concentration DECISION-080/DECISION-101 exist
  -- to interrupt. Constitutional and protected, mirroring member's shape
  -- (f...0004) — every organization should end up with this role available,
  -- not a staff-invented custom one, even though no production
  -- role-auto-provisioning surface creates it yet (same bootstrap-gap
  -- posture as stated_clerk/officers.manage, tracked in docs/TODO.md).
  ('f0000000-0000-0000-0000-00000000000a','22222222-2222-2222-2222-222222222222',
   'brand_admin','Brand Administrator','constitutional',true),
  -- Member edit: tiered sensitive information (docs/work-log/
  -- 2026-08-26-member-sensitive-info.md) / DECISION-108: medical.manage and
  -- disabilities.manage have no constitutional analog — person_medical is
  -- children's-check-in safety data with no PC(USA) office correlate, and
  -- person_disabilities is staff-observed, non-consensual, per-person data
  -- distinct from the aggregate SASR disability line stated_clerk already
  -- touches via demographics.manage. Bundling exactly these two (not four)
  -- onto one new role is not a wildcard: both share one coherent purpose
  -- (accountability for vulnerable-person safety/accommodation records), and
  -- no role in the catalog holds more than two of the four new keys.
  -- Constitutional and protected, mirroring brand_admin's shape (f...000a) —
  -- a baseline role every congregation should have available, not a
  -- staff-invented committee role.
  ('f0000000-0000-0000-0000-00000000000c','22222222-2222-2222-2222-222222222222',
   'member_care_admin','Member Care Administrator','constitutional',true);

insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000001','roll.approve'),
  ('f0000000-0000-0000-0000-000000000001','directory.view'),
  ('f0000000-0000-0000-0000-000000000002','directory.view'),
  ('f0000000-0000-0000-0000-000000000004','directory.view'),
  ('f0000000-0000-0000-0000-000000000005','role_grants.manage'),
  -- P9-role-catalog / DECISION-078: roll.propose completes the clean
  -- propose/approve separation of duties against roll.approve's existing
  -- binding to the collective session_member group — register-keeping is
  -- the Clerk of Session's own constitutional duty. Tobias Renwick's
  -- existing stated_clerk grant already carries this once this lands; no
  -- new role_grants row needed.
  ('f0000000-0000-0000-0000-000000000005','roll.propose'),
  ('f0000000-0000-0000-0000-000000000006','tickets.file'),
  ('f0000000-0000-0000-0000-000000000007','ledger.approve'),
  -- Member edit: tiered sensitive information (docs/work-log/
  -- 2026-08-26-member-sensitive-info.md) / DECISION-108: supersedes the
  -- orphaned pastoral.notes.view (retired by
  -- drizzle/0031_presby_sensitive_info_permissions.sql, and no longer
  -- inserted above) on the same office. Clergy confidentiality
  -- (person_notes.visibility = 'clergy_only') IS the pastoral relationship
  -- this office already names (DECISION-079's own reasoning, applied to the
  -- same table).
  ('f0000000-0000-0000-0000-000000000008','pastoral_notes.manage'),
  ('f0000000-0000-0000-0000-000000000009','directory.view_hidden'),
  -- Portal home + directory v2, Increment 4 / DECISION-095: the "Church
  -- Administrator" half of Phase 1's recommended binding — no such role
  -- exists in the catalog (authz.ts's comment names it aspirationally;
  -- src/lib/db/domain/authz.ts:31). stated_clerk (f...0005) is the closest
  -- existing office, already holding role_grants.manage, and gets
  -- directory.view_hidden directly. Tobias Renwick's existing stated_clerk
  -- grant (below) already carries this — no new role_grants row needed, same
  -- reasoning as roll.propose's own comment two lines above.
  ('f0000000-0000-0000-0000-000000000005','directory.view_hidden'),
  -- Member management, Deliverable A / DECISION-097: the fixture binding the
  -- architect's ruling named directly ("stated_clerk (f0000000-...-0005),
  -- which already holds role_grants.manage — no new app_role_permissions/
  -- role_grants row is invented for a role that doesn't exist"). Tobias
  -- Renwick's existing stated_clerk grant already carries this — no new
  -- role_grants row needed, same reasoning as roll.propose's own comment
  -- above.
  ('f0000000-0000-0000-0000-000000000005','org_features.manage'),
  -- Member management, Deliverable B: "people.manage added to stated_clerk's
  -- existing grant (already holds roll.propose) — creating a person and
  -- proposing their first roll action is one wizard submit, so the same
  -- office holds both permissions in the fixture" (Phase 3). Same
  -- no-new-role_grants-row reasoning as the two bindings immediately above.
  ('f0000000-0000-0000-0000-000000000005','people.manage'),
  -- docs/TODO.md follow-up (Phase 5 QA, 2026-08-25-member-management.md):
  -- roll.approve was only ever bound to session_member (f...0001), a
  -- GROUP-bound role with no loginable fixture person behind it — the
  -- pending-approval worklist had no fixture account that could exercise it
  -- end-to-end (temporarily hand-granted to stated_clerk during Phase 4
  -- browser verification, then removed). Bound here permanently, same
  -- direct-to-Tobias-Renwick pattern as roll.propose/people.manage/
  -- org_features.manage above — the one office now holds every permission
  -- Increment 1's own wizard (propose+approve folded together) needs.
  ('f0000000-0000-0000-0000-000000000005','roll.approve'),
  -- Officer-terms administration (docs/work-log/2026-08-26-groups-and-
  -- officers.md) Phase 4 commit 1 / DECISION-078's test, applied per Phase
  -- 3's own words: officer-term recording IS the register G-3.0204(b)
  -- requires the Clerk of Session to keep, a tighter fit than roll.propose
  -- already passed. No new role minted, no new role_grants row needed —
  -- Tobias Renwick's existing direct stated_clerk grant already carries
  -- officers.manage for free, same "no new grant row" outcome as
  -- roll.propose/people.manage/org_features.manage/directory.view_hidden
  -- immediately above.
  ('f0000000-0000-0000-0000-000000000005','officers.manage'),
  -- Tenant branding permission, Phase 4 commit 1: brand_admin ->
  -- branding.manage. The ONLY permission this role carries — a
  -- single-purpose office, not a wildcard.
  ('f0000000-0000-0000-0000-00000000000a','branding.manage'),
  -- Member edit: tiered sensitive information, DECISION-108: demographics
  -- compilation is a direct extension of the SASR duty
  -- roll.propose/officers.manage already sit on — docs/schema-design.md ties
  -- SASR demographic/disability compilation directly to "clerks." Tobias
  -- Renwick's existing stated_clerk grant already carries this for free — no
  -- new role_grants row needed, same reasoning as this office's other
  -- bindings above.
  ('f0000000-0000-0000-0000-000000000005','demographics.manage'),
  -- member_care_admin's two permissions — the only role in the catalog that
  -- carries more than one of the four new keys, and the only two with no
  -- constitutional analog at all (see the app_roles comment above).
  ('f0000000-0000-0000-0000-00000000000c','medical.manage'),
  ('f0000000-0000-0000-0000-00000000000c','disabilities.manage'),
  -- Groups administration (docs/work-log/2026-08-26-groups-admin.md), Phase 4
  -- commit 1 / DECISION-110 ruling 2: groups.manage mints NO new role and
  -- gets NO default binding recommendation — DECISION-078's test fails every
  -- existing office (no PC(USA) office is the constitutional keeper of
  -- committee rosters), and Phase 3 explicitly rejected both property_chair
  -- (Tobias Renwick already, over-concentration) and support_contact
  -- (Marguerite Ashcombe already, same reasoning). This grant to stated_clerk
  -- is a TEST-REACHABILITY CONVENIENCE ONLY, per Phase 3's own wording — it
  -- gives scripts/test-rls.sql a real holder to exercise the new triggers'
  -- regression tests against, not a recommended production default. Any
  -- organization is free to bind groups.manage to whichever role it actually
  -- uses for committee administration via its own roles.manage holder.
  ('f0000000-0000-0000-0000-000000000005','groups.manage');

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

-- P1 / DECISION-063: the ONE real binding proving the baseline grant end to
-- end. The active_membership derived group exists at every fixture org
-- (F16-style seeding above and after Fernwood/Marrowbone's creation), but the
-- role_grants row that actually turns it into directory.view stays scoped to
-- Alder Creek alone — proving the mechanism once, not seeding a permission
-- with nothing behind it everywhere (Phase 1's "built-and-unwired" warning).
-- starts_on predates every as-of date scripts/test-rls.sql section 9 checks
-- against (2015-06-01, current date, 2027-06-01) — this is the FLOOR of the
-- grant, not a term with its own boundary to prove.
insert into role_grants (organization_id, role_id, group_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000004',
   'b0000000-0000-0000-0000-000000000007','2000-01-01');

-- P9 / DECISION-066: stated_clerk, direct-granted to Tobias Renwick, the same
-- person already holding the open clerk_of_session officer term
-- (e0000000-0000-0000-0000-000000000005). starts_on matches that term's
-- starts_on (2023-01-08) - the software capability begins when the office
-- did. Deliberately NOT granted at Bramblewood or Quillhaven - "prove the
-- mechanism once" (DECISION-063's reasoning for directory.view), which also
-- leaves both orgs as a clean "no grant, forbidden" fixture for free.
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000005',
   'c0000000-0000-0000-0000-000000000002','2023-01-08');

-- P9-role-catalog / DECISION-080: support_contact, direct-granted to
-- Marguerite Ashcombe — deliberately NOT Tobias Renwick, who already holds
-- property_chair and stated_clerk; a third grant to him would recreate the
-- "one person, every capability" concentration this pipeline exists to
-- interrupt. starts_on is the date this pipeline's grant lands, not an
-- office date — there is no term to match (no officer_terms row for this
-- role, by design: no PC(USA) office corresponds to it).
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000006',
   'c0000000-0000-0000-0000-000000000001', -- Marguerite Ashcombe
   '2026-08-20');

-- P9-role-catalog / DECISION-080: treasurer, direct-granted to Priya
-- Balakrishnan, matching the officer_terms row above (starts the day after
-- her diaconate term ended with no successor recorded).
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000007',
   'c0000000-0000-0000-0000-000000000003', -- Priya Balakrishnan
   '2025-01-13');

-- P9-role-catalog / DECISION-080: installed_pastor, direct-granted to Rowan
-- Thistlewood — the fixture's own pastor, D1's whole justification, holding
-- no other role today. starts_on matches his presbytery membership's
-- current_roll_since.
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000008',
   'c0000000-0000-0000-0000-000000000006', -- Rowan Thistlewood
   '2015-08-01');

-- Portal home + directory v2, Increment 4 / DECISION-095: diaconate_member,
-- granted to the DERIVED Board of Deacons group (b...0002), not to a person —
-- the same F3 shape as session_member's own grant above (line ~314): if the
-- roster were a view rather than materialized officer_terms rows, the
-- resolver would find nobody here. starts_on matches session_member's own
-- floor (2020-01-01) — the mechanism's floor, not a term boundary.
insert into role_grants (organization_id, role_id, group_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000009',
   'b0000000-0000-0000-0000-000000000002','2020-01-01');

-- Tenant branding permission (docs/work-log/2026-08-26-tenant-branding-
-- permission.md) / Phase 3 DECISION-103: brand_admin, direct-granted to
-- Marguerite Ashcombe (c0000000-...-0001) — deliberately NOT Tobias Renwick,
-- who already holds property_chair + stated_clerk; a third role on the same
-- fixture person would recreate the "one person, every capability"
-- concentration support_contact's own binding (DECISION-080) was written to
-- interrupt. Marguerite already holds support_contact (the external-facing
-- point of contact with outside software support) — a second, distinct,
-- administrative role on the same person is a reasonable single-office
-- pairing, not a wildcard accretion onto one already-overloaded office
-- (Phase 3's own reasoning). Person-arm, direct-granted (not group-arm): an
-- ordinary single-accountable-office action — one person picks a colour and
-- uploads a file — with no polity body whose vote approves a brand change,
-- so there is nothing for a group grant to represent that a direct grant
-- doesn't already cover. starts_on is the date this pipeline's grant lands,
-- not an office date — there is no officer_terms row behind this role, by
-- design (no PC(USA) office corresponds to it), same shape as
-- support_contact's own grant above.
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-000000000001', -- Marguerite Ashcombe
   '2026-08-26');

-- An administrative commission: the one case where a council reaches DOWN into
-- a congregation. Its members are a group AT THE PRESBYTERY, which is why the
-- resolver's third arm needs SECURITY DEFINER to see them (F26/F27).
--
-- DECISION-110 ruling 1 (groups-admin pipeline, docs/work-log/2026-08-26-
-- groups-admin.md): this used to insert its OWN org-scoped 'committee'
-- group_types row (a0000000-...-0003) duplicating the platform-wide template
-- (a0000000-...-0002) already seeded above. `git log -S` traced that
-- duplication to an unrelated commit with no comment justifying it, and D8
-- (no tenant-extensible custom fields/types) argues against a real per-org
-- custom-group-types feature. Every groups.group_type_id write now resolves
-- against the platform template row directly, matching how court/roster
-- already worked — so this group references a0000000-...-0002, not a
-- second, org-scoped row.
insert into groups (id, organization_id, group_type_id, name, membership_source) values
  ('b0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000002','Commission on Alder Creek','managed');
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
-- Originally synthetic and password-less (cannot sign in). UPGRADED to
-- sign-in-capable by the support-tickets pipeline's ux-developer Phase 4
-- commit 3/3 (2026-08-20): Marguerite Ashcombe (this person row) is the one
-- fixture holding `support_contact` / `tickets.file` (DECISION-080, the
-- role_grants row below), and there was no way to walk `/o/alder-creek/
-- tickets` and `/o/alder-creek/feedback` through a real browser session as
-- the person they were built for — the exact gap `clerk.fixture` closed for
-- P9's `stated_clerk`. `people.user_id` is a single 1:1 column, so this is
-- an UPGRADE of the existing linked row, not a second one: same reserved
-- .invalid domain, same shared fixture password documented in
-- docs/testing.md, is_active so it can sign in, two_factor_required
-- explicitly false so a manual walkthrough isn't gated behind a separate
-- TOTP enrolment detour (mirrors clerk.fixture's own reasoning exactly).
-- Nothing in scripts/test-rls.sql depends on this row being password-less —
-- confirmed by reading that file before making this change; its `:ELDER`/
-- `:ELDERUSER` assertions (presby_two_factor_required()) test the 2FA
-- POLICY resolution, not sign-in capability.
-- ---------------------------------------------------------------------------
insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values ('e0000000-0000-0000-0000-0000000000f2', 'elder.fixture@example.invalid',
        'Fixture Elder', now(),
        '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2',
        true, false)
on conflict (id) do nothing;

update people
   set user_id = 'e0000000-0000-0000-0000-0000000000f2'
 where id = 'c0000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- P9: a SIGN-IN-CAPABLE platform user linked to Tobias Renwick.
--
-- elder.fixture@example.invalid above is deliberately password-less — it
-- exists only for scripts/test-rls.sql's SQL-level assertions and cannot
-- authenticate through /signin. Tobias Renwick is the one fixture person
-- holding stated_clerk (DECISION-066, role_grants row above), and no
-- existing platform user was linked to him — there was no way to walk the
-- P9 role-administration UI through a real browser session as the person it
-- was built for. This user closes that gap: same reserved .invalid domain,
-- same shared fixture password documented in docs/testing.md
-- ('e2e-fixture-only-not-a-secret', bcrypt-hashed below), is_active so it can
-- sign in, and two_factor_required explicitly false so a manual walkthrough
-- of /o/alder-creek/admin/roles is not gated behind a separate TOTP
-- enrolment detour. Password-bearing (unlike elder.fixture above) on
-- purpose — the point of this row is that it CAN sign in.
-- ---------------------------------------------------------------------------
insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values ('e0000000-0000-0000-0000-0000000000f3', 'clerk.fixture@example.invalid',
        'Fixture Stated Clerk', now(),
        '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2',
        true, false)
on conflict (id) do nothing;

update people
   set user_id = 'e0000000-0000-0000-0000-0000000000f3'
 where id = 'c0000000-0000-0000-0000-000000000002';

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

-- P1 / DECISION-063: these two orgs are created here, well after the F16
-- block near the top of this file, so their active_membership derived groups
-- have to be seeded here too — BEFORE the memberships insert below that
-- targets them, or drizzle/0017's sync trigger raises on the first row.
insert into groups (id, organization_id, group_type_id, name, membership_source, derived_from, is_protected) values
  ('b0000000-0000-0000-0000-00000000000a', '55555555-5555-5555-5555-555555555555',
   'a0000000-0000-0000-0000-000000000004', 'Active Membership', 'derived', 'active_membership', true),
  ('b0000000-0000-0000-0000-00000000000b', '66666666-6666-6666-6666-666666666666',
   'a0000000-0000-0000-0000-000000000004', 'Active Membership', 'derived', 'active_membership', true);

-- Six users, one per row of the destination matrix that the existing fixture
-- cannot reach. All password-less (elder.fixture itself was upgraded to
-- sign-in-capable above, 2026-08-20 — these six are unrelated to that
-- change and stay as originally built): they cannot sign in, and they exist
-- for scripts/test-rls.sql and for manual browser verification with a dev
-- session. Reserved example.invalid domain, invented names.
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

-- ---------------------------------------------------------------------------
-- Support tickets — sample fixture rows (2026-08-20-support-tickets, Phase 4
-- commit 1 of 3, database-admin).
--
-- Deliberately raw INSERTs, NOT routed through fileTicket()/submitFeedback():
-- those query-layer functions gate on hasTicketsFile()/withOrgContext(), and
-- a seed script inserting as the table owner never passes through either —
-- so these two rows need no tickets.file role-holder to exist at insert
-- time. No app_roles/app_role_permissions/role_grants row for tickets.file
-- is written here — that binding belongs entirely to the sibling
-- `2026-08-20-role-catalog` pipeline's own Phase 4 (see the work-log's
-- Permissions & Flags / Implementation Order). Until that binding lands,
-- /o/alder-creek/tickets renders TicketsForbidden for every fixture person,
-- including Desmond below — the sample data sits correctly isolated and
-- correctly invisible in the meantime, which is the expected interim state,
-- not a defect (see the work-log's Implementation Order note 1).
--
-- submitter_person_id on both rows is an ordinary existing Alder Creek
-- member/participant, not Marguerite Ashcombe specifically — the sample
-- data represents a member's report, not a demonstration of who holds the
-- role (that demonstration is the role-catalog pipeline's own fixture).
-- ---------------------------------------------------------------------------
insert into tickets (id, organization_id, submitter_person_id, subject, change_class, area, priority, status, created_at) values
  ('90000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000004', -- Desmond Okonkwo, other_participant
   'Directory search does not find members by maiden name',
   'bug', 'directory', 'normal', 'new', '2026-08-15T14:22:00Z');

-- Row 1 of the thread — the filing body itself. Schema note: tickets carries
-- no description column; the filing body IS ticket_messages row 1
-- (authorKind = 'submitter'), matching what fileTicket() would have written.
insert into ticket_messages (id, organization_id, ticket_id, author_kind, author_person_id, body, created_at) values
  ('91000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '90000000-0000-0000-0000-000000000001', 'submitter',
   'c0000000-0000-0000-0000-000000000004',
   'When I search for Mrs. Renwick under her maiden name Balakrishnan, nothing comes up in the directory. Is that expected?',
   '2026-08-15T14:22:00Z');

insert into congregation_feedback (id, organization_id, person_id, body, status, created_at) values
  ('92000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000003', -- Priya Balakrishnan
   'It would help if the events calendar showed which Sunday school class meets when — right now I have to ask at the welcome desk every week.',
   'new', '2026-08-17T09:05:00Z');

-- ---------------------------------------------------------------------------
-- Public sites — sample fixture row (2026-08-20-public-sites, Phase 4
-- commit 1 of 3, database-admin).
--
-- Alder Creek only, status 'provisioning': the ingest endpoint doesn't exist
-- until commit 2, so there is nothing that could have promoted this row to
-- 'live' yet — last_ingested_commit_sha/last_ingested_at/content_bundle_key
-- all stay null, matching what provisionSite() would have written for a
-- freshly-provisioned org that has never received a push. updated_by is
-- null: no platform-admin user is seeded in this file (INITIAL_ADMIN_EMAILS
-- assigns that role dynamically on first real sign-in), so there is no
-- users.id fixture to attribute a provisioning write to — same "raw INSERT,
-- not routed through the real action" posture the support-tickets fixture
-- above already uses, and updated_by is nullable for exactly this reason
-- (DECISION-081).
--
-- No site_contact_messages sample row: an anonymous contact-form message is
-- a strange thing to fabricate as fixture data, and there's no live site yet
-- for a visitor to have plausibly reached (see the work-log's Phase 3 "Edge
-- Cases" — the ContactForm write path only exists once a site is 'live').
insert into organization_sites (organization_id, repo, status, updated_by) values
  ('22222222-2222-2222-2222-222222222222', 'presby-churches/site-alder-creek',
   'provisioning', null);

-- ---------------------------------------------------------------------------
-- Portal home + directory v2, Increment 3 (2026-08-24-portal-home-directory,
-- Phase 4, full-stack-developer) — a mailing address for one of the two
-- households the roll fixture already wires up (`households` and
-- `memberships.household_id`/`household_role` were seeded well before this
-- pipeline, as part of the roll/household fixture above — Increment 3 needed
-- no new households or membership wiring, only something for the
-- households-view card's city/state line and the household-detail page's
-- address block to show).
--
-- Reuses Tobias Renwick's own existing person (household head of "The
-- Renwick Family") rather than inventing a new one. "Marguerite Ashcombe"'s
-- one-member household deliberately gets NO mailing address, so a fresh dev
-- database still exercises the "omitted when null" rendering path on both
-- the households grid and the household-detail page.
-- ---------------------------------------------------------------------------
insert into addresses (id, person_id, address_type, line1, city, region, postal_code, is_primary) values
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
   'home', '142 Maple Ridge Lane', 'Alder Creek', 'OH', '44201', true);

update households
   set mailing_address_id = 'a1000000-0000-0000-0000-000000000001'
 where id = 'd0000000-0000-0000-0000-000000000001'; -- The Renwick Family

-- ---------------------------------------------------------------------------
-- Portal home + directory v2, Increment 4 (2026-08-24-portal-home-directory,
-- Phase 4, database-admin) — deacon districts, and the officer_terms rows
-- that make one active and one vacant.
--
-- Two org_units (unit_type = 'district'), the first rows in this table in the
-- fixture. Two new households, one per district, so a fresh dev database
-- exercises both the "active deacon" and "vacant district" render paths
-- Increment 4b needs, alongside the two PRE-EXISTING households (The Renwick
-- Family, Marguerite Ashcombe) which stay org_unit_id NULL — the "no district
-- assigned at all" case, unchanged, no edit needed to get it for free.
--
-- Both deacon terms reuse Priya Balakrishnan (c0000000-...-0003) rather than
-- inventing a new deacon-ordained person: she is the fixture's only person
-- with a 'deacon' ordination row, and the story reads naturally as F22's own
-- non-consecutive-terms pattern applied to the diaconate instead of session —
-- a second, district-scoped deacon term at South District that ended, then a
-- third at North District that is still open. Neither new term overlaps her
-- PRE-EXISTING, undistricted deacon term (e0000000-...-0004, 2022-01-09 to
-- 2025-01-12) or each other — officer_terms_no_overlap
-- (drizzle/0009_presby_rls.sql) would reject any date range that did.
-- ---------------------------------------------------------------------------
insert into org_units (id, organization_id, unit_type, name) values
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'district', 'North District'),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'district', 'South District');

insert into people (id, first_name, last_name, date_of_birth) values
  ('c0000000-0000-0000-0000-000000000007', 'Aldous', 'Fennimore', '1979-05-14'),
  ('c0000000-0000-0000-0000-000000000008', 'Wren',   'Thackeray', '1988-11-02');

insert into households (id, organization_id, name, is_giving_unit, org_unit_id) values
  ('d0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'The Fennimore Family', true, 'a2000000-0000-0000-0000-000000000001'), -- North District
  ('d0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'The Thackeray Family', true, 'a2000000-0000-0000-0000-000000000002'); -- South District (vacant)

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000007',
   'd0000000-0000-0000-0000-000000000003', 'head', 'regular', 'active', '2010-03-01'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000008',
   'd0000000-0000-0000-0000-000000000004', 'head', 'regular', 'active', '2015-07-20');

insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, age_at_action, approval_status, minute_reference, approved_on) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000007',
   'opening_balance', '2010-03-01', 'active', 30, 'approved', 'Imported baseline', '2010-03-01'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000008',
   'opening_balance', '2015-07-20', 'active', 26, 'approved', 'Imported baseline', '2015-07-20');

-- South District: an ended term, no successor recorded -> the derivation
-- (office = 'deacon', org_unit_id = ..., ends_on is null) finds nothing, so
-- Increment 4b's DeaconCard renders the "vacant" state for The Thackeray
-- Family.
-- North District: still open -> The Fennimore Family's DeaconCard shows Priya.
insert into officer_terms (id, organization_id, person_id, office, class_year, org_unit_id, starts_on, ends_on, end_reason, recorded_by) values
  ('e0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000003', -- Priya Balakrishnan
   'deacon', null, 'a2000000-0000-0000-0000-000000000002', -- South District
   '2025-02-01', '2025-08-31', 'completed', null),
  ('e0000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000003', -- Priya Balakrishnan
   'deacon', null, 'a2000000-0000-0000-0000-000000000001', -- North District
   '2025-09-01', null, null, null);

-- Member edit: tiered sensitive information (docs/work-log/
-- 2026-08-26-member-sensitive-info.md) / DECISION-108: member_care_admin,
-- direct-granted to Aldous Fennimore — an active household head holding no
-- other role today, avoiding a fifth capability stacked onto Tobias Renwick,
-- Marguerite Ashcombe, Priya Balakrishnan, or Rowan Thistlewood, all already
-- loaded office-holders. Person-arm, direct-granted (mirrors
-- brand_admin/support_contact): an ordinary single-accountable-office
-- action, nothing for a group grant to represent. starts_on is the date
-- this pipeline's grant lands, not an office date — there is no
-- officer_terms row behind this role, by design (no PC(USA) office
-- corresponds to it), same shape as brand_admin's/support_contact's own
-- grants.
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-00000000000c',
   'c0000000-0000-0000-0000-000000000007', -- Aldous Fennimore
   '2026-08-26');

-- ---------------------------------------------------------------------------
-- Portal home + directory v2, Increment 4b (2026-08-24-portal-home-directory,
-- Phase 4, full-stack-developer) — one `directory_hidden = true` fixture
-- person, so the elevated (`directory.view_hidden`) path is exercisable
-- through a real browser session. None of the increment 1-3 fixture rows
-- carried this before now (confirmed by query before writing this block).
-- Desmond Okonkwo (c0000000-...-0004): an existing "other_participant"
-- person with no household — marking him hidden has no narrative
-- side-effects on any other increment's fixture story or tests.
-- `on conflict (person_id) do update` makes this idempotent against a
-- database that already has a person_privacy row for him.
-- ---------------------------------------------------------------------------
insert into person_privacy (person_id, organization_id, directory_hidden)
values ('c0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', true)
on conflict (person_id) do update set directory_hidden = true;

-- ---------------------------------------------------------------------------
-- Role & permissions administration (docs/work-log/2026-08-26-role-
-- permissions-admin.md), Phase 4 commit 1 (database-admin) / DECISION-106
-- (Phase 2) / DECISION-109 (Phase 3): role_admin, the new constitutional,
-- protected role that carries roles.manage (drizzle/0031_presby_role_
-- definitions.sql seeds the global permission-catalog row; this file mints
-- the org-scoped role and its fixture binding — app_roles/role_grants have
-- no production seeding surface yet, same posture as every other role in
-- this catalog).
--
-- roles.manage does NOT bind to stated_clerk (Tobias Renwick) — DECISION-
-- 106's third ruling: role/permission-structure definition is not the Clerk
-- of Session's constitutional office, and stated_clerk already carries seven
-- accumulated permissions, the exact drift DECISION-101 refused to extend
-- further for branding.manage. It also does NOT go to Marguerite Ashcombe
-- (already support_contact + brand_admin) — a third role on either already-
-- multi-role fixture person would recreate the "one person, every
-- capability" concentration DECISION-103 flagged and declined to repeat for
-- brand_admin alone. DECISION-109 calls for a FRESH fixture person instead.
--
-- Marisol Windham: an invented, otherwise-unburdened Alder Creek member —
-- house style per this file's own header (no real name, example.invalid
-- email). No household (mirrors Desmond Okonkwo's shape, c0000000-...-0004):
-- role_admin is an ordinary single-accountable-office action with no polity
-- vote behind it (same reasoning as support_contact/brand_admin), so a
-- household/family narrative adds nothing this fixture needs. current_roll
-- is 'active' (a real congregation member, not merely a person record) so
-- role_grants_person_fk (personId, organizationId) has a memberships row to
-- reference at Alder Creek.
-- ---------------------------------------------------------------------------
insert into people (id, first_name, last_name, date_of_birth) values
  ('c0000000-0000-0000-0000-000000000009', 'Marisol', 'Windham', '1982-02-14');

insert into person_identifiers (person_id, kind, value_normalized, is_verified, is_shared, source) values
  ('c0000000-0000-0000-0000-000000000009', 'email', 'm.windham@example.invalid', true, false, 'self_service');

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000009',
   null, null, 'regular', 'active', '2018-09-01');

-- The Roll Is the System of Record (CLAUDE.md): memberships.current_roll is a
-- CACHE, never set on its own authority. presby_roll_cache_drift() (caught
-- LIVE while verifying this commit against the shared dev database, not
-- reasoned about in advance) compares the cache against a replay of
-- roll_actions and flags any membership whose current_roll has no action
-- behind it — same 'opening_balance' pattern as Aldous Fennimore/Wren
-- Thackeray's own rows above, so Marisol Windham's 'active' cache value
-- agrees with the replay from the moment she exists.
insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, age_at_action, approval_status, minute_reference, approved_on) values
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000009',
   'opening_balance', '2018-09-01', 'active', 36, 'approved', 'Imported baseline', '2018-09-01');

insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222',
   'role_admin','Role Administrator','constitutional',true);

insert into app_role_permissions (role_id, permission_key) values
  -- The ONLY permission this role carries — a single-purpose office, not a
  -- wildcard, same discipline as brand_admin's own binding comment.
  ('f0000000-0000-0000-0000-00000000000b','roles.manage');

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-00000000000b',
   'c0000000-0000-0000-0000-000000000009', -- Marisol Windham
   '2026-08-26');

-- ---------------------------------------------------------------------------
-- Children's ministry, Increment A (docs/work-log/
-- 2026-08-26-childrens-ministry.md, Phase 3) / DECISION-111 (architect) /
-- DECISION-114 (tech-lead): children_ministry_admin, a new constitutional,
-- protected role carrying `children.roster` ALONE — deliberately separate
-- from member_care_admin (f...000c) so a Sunday-school coordinator can see
-- the roster without also getting medical.manage's allergy data (Phase 1's
-- own requirement).
--
-- Fixture-bound to Wren Thackeray (c0000000-...-0008) — an active household
-- head (household head of "The Thackeray Family", above) holding zero roles
-- today, confirmed by grep against this file before writing this block.
-- Avoids a repeat grant onto Tobias Renwick/Marguerite Ashcombe/Priya
-- Balakrishnan/Rowan Thistlewood/Aldous Fennimore/Marisol Windham, all
-- already carrying at least one role. Person-arm, direct-granted (mirrors
-- brand_admin/support_contact/member_care_admin/role_admin): an ordinary
-- single-accountable-office action with no polity vote behind it, so
-- nothing for a group grant to represent. starts_on is the date this
-- pipeline's grant lands, not an office date — no officer_terms row behind
-- this role, same shape as every other non-constitutional-office role above.
-- ---------------------------------------------------------------------------
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-00000000000d','22222222-2222-2222-2222-222222222222',
   'children_ministry_admin','Children''s Ministry Administrator','constitutional',true);

insert into app_role_permissions (role_id, permission_key) values
  -- The ONLY permission this role carries — a single-purpose office, not a
  -- wildcard, same discipline as brand_admin's/role_admin's own binding
  -- comments.
  ('f0000000-0000-0000-0000-00000000000d','children.roster');

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-00000000000d',
   'c0000000-0000-0000-0000-000000000008', -- Wren Thackeray
   '2026-08-26');

-- The first-ever fixture row in person_relationships (the table has shipped
-- with zero rows since 0008) — a guardian link exercising the roster's "N
-- guardian(s) on file" case end to end. Hallie Vandermeer (c0000000-...-0005,
-- born 2011-03-08, already a fixture child in the Renwick household, under
-- 18 relative to any date this fixture is read) linked to Tobias Renwick
-- (c0000000-...-0002, her household's head) as her parent and emergency
-- contact. Every other org's fixture children roster (none — Bramblewood/
-- Quillhaven have no under-18 fixture people) exercises the empty state for
-- free.
insert into person_relationships (person_id, related_person_id, relationship, is_emergency_contact) values
  ('c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000002',
   'parent', true);

-- ---------------------------------------------------------------------------
-- Ministry credentials & pastoral appointments (docs/work-log/
-- 2026-08-26-presbytery-functionality.md, Increment 2, Phase 4 commit 1
-- (database-admin)) / DECISION-112 (architect) / DECISION-116 (tech-lead).
--
-- CONCURRENCY NOTE: this is an append to the file's single trailing
-- transaction, added directly ahead of the final `commit;` — the same spot
-- the children's-ministry Increment A block above landed. A concurrent
-- events-model pipeline may ALSO be appending here; if a merge conflict
-- appears at this exact seam, resolve by keeping BOTH blocks (append-only,
-- neither depends on the other) rather than picking one.
--
-- A NEW fixture person, not a reuse of Rowan Thistlewood (the only other
-- person with a membership at the presbytery) — deliberately, mirroring the
-- children_ministry_admin block's own preference for a person holding zero
-- roles today: Rowan already carries installed_pastor, and granting the
-- Stated Clerk's register-keeping office to the same person the register is
-- ABOUT reads as a conflict the fixture shouldn't model as normal.
insert into people (id, first_name, last_name, date_of_birth) values
  ('c0000000-0000-0000-0000-00000000000a', 'Idris', 'Calloway', '1975-05-19');

insert into person_identifiers (person_id, kind, value_normalized, is_verified, is_shared, source) values
  ('c0000000-0000-0000-0000-00000000000a', 'email', 'i.calloway@example.invalid', true, false, 'self_service');

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a',
   null, null, 'regular', 'active', '2012-03-01');

-- Same presby_roll_cache_drift() discipline as every other membership row
-- added to this file since it was first caught live (Marisol Windham/Wren
-- Thackeray's own comments above) — a cache value needs an action behind it.
insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, age_at_action, approval_status, minute_reference, approved_on) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a',
   'opening_balance', '2012-03-01', 'active', 37, 'approved', 'Imported baseline', '2012-03-01');

-- The org-scoped ADOPTED copy of the presbytery_stated_clerk template
-- (drizzle/0037_presby_ministry_credentials.sql's global, organization_id
-- IS NULL row) — this is the seed-time equivalent of a presbytery admin
-- clicking "adopt template" at /admin/roles/new, so the feature is
-- hand-walkable in CI/fresh-DB dev, not just live-DB state. Distinct id from
-- the template row itself; same key is fine here since this row IS a real,
-- org-scoped copy, not a second template.
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
   'presbytery_stated_clerk', 'Stated Clerk', 'constitutional', true);

insert into app_role_permissions (role_id, permission_key) values
  -- The ONLY permission this role carries — single-purpose office, same
  -- discipline as every other new-role binding comment in this file.
  ('f0000000-0000-0000-0000-00000000000e', 'credentials.manage');

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000e',
   'c0000000-0000-0000-0000-00000000000a', -- Idris Calloway
   '2026-08-26');

-- One real appointments row, proving the mechanism end to end: Rowan
-- Thistlewood (c...0006) already serves Alder Creek per the D1 fixture's own
-- "second membership, no active roll" row above — this appointment is the
-- presbytery's OWN record of that same call, recorded by the presbytery
-- (organization_id = northern-reach), naming Alder Creek as the serving
-- congregation (servingOrgId), matching startsOn to his installed_pastor
-- role-grant's own starts_on above for internal consistency.
insert into appointments (id, organization_id, person_id, serving_org_id, call_type, starts_on, minute_reference, recorded_at) values
  ('e2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000006', -- Rowan Thistlewood
   '22222222-2222-2222-2222-222222222222', -- Alder Creek
   'installed_pastor', '2015-08-01', 'Presbytery stated meeting, 2015-08-01, item 3', now());

-- ---------------------------------------------------------------------------
-- Events model (docs/work-log/2026-08-26-events-model.md), Phase 4 commit 2
-- (full-stack-developer) / DECISION-115: `events.manage` gets NO default
-- role binding — DECISION-078's test fails every existing office, the
-- identical reasoning DECISION-110 used for `groups.manage` (no PC(USA)
-- office is the constitutional keeper of the congregation's calendar). This
-- grant to stated_clerk (f0000000-...-0005) is a TEST-REACHABILITY
-- CONVENIENCE ONLY, matching `groups.manage`'s own fixture comment — not a
-- recommended production default. Any organization is free to bind
-- events.manage to whichever role it actually uses for calendar
-- administration via its own roles.manage holder.
--
-- CONCURRENCY NOTE: appended directly ahead of the final `commit;`, same
-- seam the children's-ministry and presbytery-functionality blocks above
-- landed at concurrently today (each pipeline's own note applies here too —
-- if a merge conflict appears at this exact seam, keep ALL blocks;
-- append-only, none depends on another).
-- ---------------------------------------------------------------------------
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000005','events.manage');

-- ---------------------------------------------------------------------------
-- Presbytery program: congregation oversight, statistics, per-capita
-- (docs/work-log/2026-08-27-presbytery-program.md, Phase 3 / DECISION-118
-- through DECISION-121; database-admin schema commit, work-log
-- docs/work-log/2026-08-27-presbytery-oversight-statistics.md).
--
-- CONCURRENCY NOTE: appended directly ahead of the final `commit;`, the same
-- seam every recent pipeline's own fixture block has landed at (children's
-- ministry, events, ministry credentials, immediately above). If a merge
-- conflict appears at this exact seam, keep ALL blocks — append-only, none
-- depends on another.
-- ---------------------------------------------------------------------------

-- A sign-in-capable platform user for Idris Calloway (the presbytery's own
-- Stated Clerk, c...00a) — same P9 reasoning as clerk.fixture@...: there is
-- otherwise no way to walk /o/northern-reach/admin/oversight or .../reports
-- through a real browser session as the person these permissions are bound
-- to below (statistics.manage/per_capita.manage via the presbytery_stated_
-- clerk template binding, drizzle/0038_presby_presbytery_program.sql;
-- congregation_oversight.manage via the fixture grant immediately below).
-- Same reserved .invalid domain, same shared fixture password
-- (docs/testing.md), two_factor_required false for the same
-- no-TOTP-detour reasoning as clerk.fixture/elder.fixture above.
insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values ('e0000000-0000-0000-0000-0000000000f4', 'presbytery.clerk.fixture@example.invalid',
        'Fixture Presbytery Clerk', now(),
        '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2',
        true, false)
on conflict (id) do nothing;

update people
   set user_id = 'e0000000-0000-0000-0000-0000000000f4'
 where id = 'c0000000-0000-0000-0000-00000000000a';

-- congregation_oversight.manage gets NO default binding (DECISION-119: no
-- PC(USA) office is the constitutional keeper of "our opinion of this
-- congregation," same DECISION-078 test failure as groups.manage/
-- events.manage) — this grant to the presbytery's adopted presbytery_
-- stated_clerk copy (f...00e) is a dev-reachability CONVENIENCE ONLY,
-- matching events.manage's own fixture-grant comment, never a recommended
-- production default.
--
-- statistics.manage/per_capita.manage are bound to the presbytery_stated_
-- clerk TEMPLATE in drizzle/0038_presby_presbytery_program.sql; this
-- ADOPTED copy (f...00e) needs its own binding for presby_has_permission()
-- to resolve them for Idris Calloway — the same two-binding shape
-- credentials.manage already established (0037's template insert + this
-- file's own adopted-copy insert, above).
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-00000000000e', 'congregation_oversight.manage'),
  ('f0000000-0000-0000-0000-00000000000e', 'statistics.manage'),
  ('f0000000-0000-0000-0000-00000000000e', 'per_capita.manage');

-- statistics.publish binds to the CONGREGATION's stated_clerk (architect
-- Ruling 2 / DECISION-119) — Tobias Renwick's existing stated_clerk grant
-- (f0000000-...-0005) already carries this once this lands, same
-- no-new-role_grants-row reasoning as officers.manage/groups.manage/
-- events.manage above.
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000005', 'statistics.publish');

-- congregation_oversight: the presbytery's own opinion of two member
-- congregations. Alder Creek (healthy, managed) and Bramblewood (declining,
-- managed) — Quillhaven (unmanaged, D9) deliberately gets NO oversight row,
-- proving the "no data on file" empty state (Phase 3 Edge Cases) is
-- reachable without any special flag. Coordinates are invented, not
-- geocoded from any real address (DECISION-120).
insert into congregation_oversight
  (id, organization_id, about_org_id, viability_score, redevelopment_notes,
   buildings_notes, insurance_carrier, insurance_expires_on,
   latitude, longitude, updated_by)
values
  ('a3000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   3, null,
   'Roof replaced 2024; sanctuary HVAC original to 1987 construction.',
   'Fieldstone Mutual (example)', '2027-03-01',
   41.2033, -77.1945, 'e0000000-0000-0000-0000-0000000000f4'),
  ('a3000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
   2,
   'Attendance down roughly 30% over five years; Committee on Ministry to discuss redevelopment options at the 2026 fall stated meeting.',
   'Fellowship-hall roof leak reported spring 2026, awaiting contractor estimate.',
   'Fieldstone Mutual (example)', '2026-11-15',
   41.3512, -77.0209, 'e0000000-0000-0000-0000-0000000000f4');

-- congregation_statistics: mixed provenance, the same coalesce read every
-- consumer (3b's list, 4b's rollup, per-capita's basis-year lookup) needs to
-- exercise. Quillhaven (unmanaged) gets a presbytery_entered row — the D9
-- shape. Alder Creek (managed) gets a published_by_congregation row,
-- standing in for a real publish until Increment 4a's UI can produce one
-- live end to end (presby_publish_sasr_snapshot() itself is exercised
-- directly by scripts/test-rls.sql, not replayed here).
insert into congregation_statistics
  (id, organization_id, about_org_id, year, provenance, entered_by,
   ending_active, ending_baptized, avg_weekly_worship_attendance,
   baptisms_children, receipts_contributions, exp_local_program)
values
  ('a4000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
   2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4',
   38, 12, 30, 1, 84000.00, 61000.00);

insert into congregation_statistics
  (id, organization_id, about_org_id, year, provenance, published_at, minute_reference,
   ending_active, ending_baptized, avg_weekly_worship_attendance,
   baptisms_children, receipts_contributions, exp_local_program)
values
  ('a4000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   2025, 'published_by_congregation', '2026-01-12 15:00:00-05',
   'Session stated meeting, 2026-01-11, item 5',
   212, 45, 165, 6, 410000.00, 275000.00);

-- per_capita_rates: one billing year, basis year defaulted per Operator
-- Answer 1's own two-year-arrears practice (2026 billing off 2024 data).
insert into per_capita_rates (id, organization_id, billing_year, basis_year, rate_per_member, updated_by)
values
  ('a5000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 2026, 2024, 12.50,
   'e0000000-0000-0000-0000-0000000000f4');

-- per_capita_records: one generated (and part-paid) bill for Alder Creek,
-- snapshotting ending_active_basis/rate_applied/amount_owed at generation
-- time (psvonline-portal's own documented practice) rather than deriving
-- them live — proves the freeze-on-generation property has a real row to
-- exercise, not just an empty table.
insert into per_capita_records
  (id, organization_id, about_org_id, billing_year, basis_year,
   ending_active_basis, rate_applied, amount_owed, paid_status)
values
  ('a6000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   2026, 2024, 210, 12.50, 2625.00, 'unpaid');

commit;
