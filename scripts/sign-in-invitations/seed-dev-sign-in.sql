-- ---------------------------------------------------------------------------
-- Sign-in invitations and auto-connect dev fixture (drizzle/0065_presby_sign_
-- in_and_connect.sql; docs/work-log/2026-10-22-founding-admin-directory.md,
-- "Phase 3 amendment 2" sections 5.12 and 8.2; Community Increment 2b).
--
-- INTEGRATION (Rule 16): this block is appended to scripts/seed-dev.sql,
-- after every organization it references exists (i.e. at the end of the
-- file, after scripts/invitations/seed-dev-invitations.sql). Until then,
-- standalone, AS THE OWNER:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sign-in-invitations/seed-dev-sign-in.sql
--
-- scripts/sign-in-invitations/test-rls-65.sql NEEDS this fixture. Idempotent:
-- every insert is `on conflict do nothing` or `where not exists`, so a re-run
-- changes nothing.
--
-- Synthetic data only (No Real Data): invented names, example.invalid
-- addresses, obviously-fixture tokens. Every account below is PASSWORD-LESS:
-- none can sign in, so none can auto-connect outside a test that calls the
-- definer directly. They exist for test-rls-65.sql and for manual checks with
-- a dev session.
--
-- What it adds:
--   1. THE TOGGLE ROWS (section 5.12): org_portal.sign_in_connect, enabled,
--      for EVERY organization. seed-dev.sql creates its organizations after
--      the migration has run on an empty database, so 0065 section 8 seeded
--      nothing for them; without this block every seeded congregation would
--      have auto-connect off (an absent row is off, DECISION-097). `do
--      nothing`: a row an operator turned off stays off.
--   2. Hollinbrook Presbyterian Church, a managed congregation of its own (so
--      no existing section's counts at Alder Creek or elsewhere move), with
--      the three derived groups and a sender holding people.manage and
--      officers.manage (Hollis Wardlaw, account ...a0); and Saltmarsh
--      Presbyterian Church, UNMANAGED, the second organization the decline
--      cases need. Both are new so that no existing section's counts move
--      (scripts/test-rls.sql asserts, for example, that Bramblewood has no
--      people).
--   3. People at Hollinbrook, each with a main address, and an unlinked,
--      proven (owner-stamped), password-less account at that address:
--        ...01 Rosalind Quarrington   ruling elder (authority-bearing)
--        ...02 Benedikt Ollerenshaw   member (authority-free: connects)
--        ...03 Clementine Ashby       visitor, no roll (declined)
--        ...04 Thaddeus Pembrook      member, OPEN sign_in invitation
--                                     (token seed-dev-sign-in-thaddeus-open-000000000)
--        ...05 Honoria Fitzcrane      ruling elder, OPEN sign_in invitation
--                                     (token seed-dev-sign-in-honoria-open-0000000000),
--                                     account enrolled in TOTP (a fixture
--                                     ciphertext, not a secret)
--        ...06 Augustin Merriweather  member; ...07 Perpetua Merriweather holds
--                                     the SAME address (declined: shared)
--        ...08 Wilfred Tamsworth      member at Saltmarsh (unmanaged: declined)
--        ...09 Isolde Brackenridge    member at Hollinbrook AND Saltmarsh
--                                     (two organizations: declined)
--      The two invitations are dated 2099 (created 2099-01-01, expiring
--      2099-01-30), the seed-dev-invitations.sql convention, so they never
--      expire on a long-lived branch and never count toward a rolling limit
--      (every limit is bounded created_at <= now()).
-- ---------------------------------------------------------------------------

-- One transaction: app.person_claim_authorized below is transaction-local
-- (set_config(..., true)), so under psql autocommit it would be gone before
-- the second-membership insert (CI applies seed-dev.sql without -1).
begin;

-- 1. The toggle rows for every organization.
insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
select o.id, 'org_portal.sign_in_connect', true, null
  from organizations o
on conflict (organization_id, feature_key) do nothing;

-- 2. Hollinbrook: organization, derived groups, toggle, the sender.
insert into organizations (id, organization_type, name, slug, path, platform_status) values
  ('65000000-0000-4000-8000-000000000001', 'congregation', 'Hollinbrook Presbyterian Church',
   'hollinbrook', 'hollinbrook', 'managed'),
  ('65000000-0000-4000-8000-000000000002', 'congregation', 'Saltmarsh Presbyterian Church',
   'saltmarsh', 'saltmarsh', 'unmanaged')
on conflict (id) do nothing;

-- Each fixture organization carries its one open canonical name row, in the
-- shape seed-dev.sql section (0) writes for its own organizations (the
-- migration's backfill shape; scripts/test-rls.sql section 42(k) pins "one open
-- canonical row per organization" on a freshly seeded database).
insert into organization_name_history
  (organization_id, subject_org_id, name_type, name, city, state,
   effective_from, effective_to, authority, minute_reference, recorded_at)
select o.id, o.id, 'canonical', o.name, null, null, null, null, 'backfill', null, now()
  from organizations o
 where o.id in ('65000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000002')
   and not exists (select 1 from organization_name_history h
                    where h.subject_org_id = o.id and h.name_type = 'canonical' and h.effective_to is null);

insert into groups (id, organization_id, group_type_id, name, membership_source, derived_from, is_protected)
select v.id, '65000000-0000-4000-8000-000000000001', (select id from group_types where key = v.gtype),
       v.name, 'derived', v.derived_from, true
  from (values ('65000000-0000-4000-8000-0000000000b1'::uuid, 'roster', 'Active Membership', 'active_membership'),
               ('65000000-0000-4000-8000-0000000000b2'::uuid, 'court', 'Session', 'session'),
               ('65000000-0000-4000-8000-0000000000b3'::uuid, 'court', 'Board of Deacons', 'diaconate')) v(id, gtype, name, derived_from)
on conflict (id) do nothing;
insert into groups (id, organization_id, group_type_id, name, membership_source, derived_from, is_protected)
values ('65000000-0000-4000-8000-0000000000b4', '65000000-0000-4000-8000-000000000002',
        (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true)
on conflict (id) do nothing;

insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
values ('65000000-0000-4000-8000-000000000001', 'org_portal.sign_in_connect', true, null),
       ('65000000-0000-4000-8000-000000000002', 'org_portal.sign_in_connect', true, null)
on conflict (organization_id, feature_key) do nothing;

insert into users (id, email, name, email_verified, is_active, two_factor_required) values
  ('e6500000-0000-4000-8000-0000000000a0', 'hollis.wardlaw.signin65@example.invalid', 'Fixture Hollinbrook Sender', now(), true, false),
  ('e6500000-0000-4000-8000-000000000001', 'rosalind.quarrington.signin65@example.invalid', 'Fixture Rosalind', now(), true, false),
  ('e6500000-0000-4000-8000-000000000002', 'benedikt.ollerenshaw.signin65@example.invalid', 'Fixture Benedikt', now(), true, false),
  ('e6500000-0000-4000-8000-000000000003', 'clementine.ashby.signin65@example.invalid', 'Fixture Clementine', now(), true, false),
  ('e6500000-0000-4000-8000-000000000004', 'thaddeus.pembrook.signin65@example.invalid', 'Fixture Thaddeus', now(), true, false),
  ('e6500000-0000-4000-8000-000000000005', 'honoria.fitzcrane.signin65@example.invalid', 'Fixture Honoria', now(), true, false),
  ('e6500000-0000-4000-8000-000000000006', 'merriweather.household.signin65@example.invalid', 'Fixture Augustin', now(), true, false),
  ('e6500000-0000-4000-8000-000000000008', 'wilfred.tamsworth.signin65@example.invalid', 'Fixture Wilfred', now(), true, false),
  ('e6500000-0000-4000-8000-000000000009', 'isolde.brackenridge.signin65@example.invalid', 'Fixture Isolde', now(), true, false)
on conflict (id) do nothing;

insert into user_totp (user_id, secret_ciphertext, enrolled_at)
values ('e6500000-0000-4000-8000-000000000005', 'seed-dev-fixture-ciphertext-not-a-secret', now())
on conflict (user_id) do nothing;

-- The sender is LINKED (owner path: the people_guard_user_link trigger binds
-- every non-owner role, never the owner). Everyone else is unlinked.
insert into people (id, first_name, last_name, user_id) values
  ('c6500000-0000-4000-8000-0000000000a0', 'Hollis', 'Wardlaw', 'e6500000-0000-4000-8000-0000000000a0'),
  ('c6500000-0000-4000-8000-000000000001', 'Rosalind', 'Quarrington', null),
  ('c6500000-0000-4000-8000-000000000002', 'Benedikt', 'Ollerenshaw', null),
  ('c6500000-0000-4000-8000-000000000003', 'Clementine', 'Ashby', null),
  ('c6500000-0000-4000-8000-000000000004', 'Thaddeus', 'Pembrook', null),
  ('c6500000-0000-4000-8000-000000000005', 'Honoria', 'Fitzcrane', null),
  ('c6500000-0000-4000-8000-000000000006', 'Augustin', 'Merriweather', null),
  ('c6500000-0000-4000-8000-000000000007', 'Perpetua', 'Merriweather', null),
  ('c6500000-0000-4000-8000-000000000008', 'Wilfred', 'Tamsworth', null),
  ('c6500000-0000-4000-8000-000000000009', 'Isolde', 'Brackenridge', null)
on conflict (id) do nothing;

insert into memberships (organization_id, person_id, engagement_status, current_roll)
select v.org, v.person, v.engagement, v.roll
  from (values
    ('65000000-0000-4000-8000-000000000001'::uuid, 'c6500000-0000-4000-8000-0000000000a0'::uuid, 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000001', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000002', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000003', 'visitor', null),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000004', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000005', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000006', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000007', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000002', 'c6500000-0000-4000-8000-000000000008', 'regular', 'active'),
    ('65000000-0000-4000-8000-000000000001', 'c6500000-0000-4000-8000-000000000009', 'regular', 'active')
  ) v(org, person, engagement, roll)
 where not exists (select 1 from memberships m where m.person_id = v.person and m.organization_id = v.org);

-- Isolde's SECOND membership (R31). The person already exists elsewhere, so
-- the F21 guard blocks a plain insert; a seed running as owner sets the claim
-- flag directly, as seed-dev.sql does for the mixed user.
select set_config('app.person_claim_authorized', 'c6500000-0000-4000-8000-000000000009', true);
insert into memberships (organization_id, person_id, engagement_status, current_roll)
select '65000000-0000-4000-8000-000000000002', 'c6500000-0000-4000-8000-000000000009', 'regular', null
 where not exists (select 1 from memberships m
                    where m.person_id = 'c6500000-0000-4000-8000-000000000009'
                      and m.organization_id = '65000000-0000-4000-8000-000000000002');
select set_config('app.person_claim_authorized', '', true);

-- Main addresses (normalized; 0064's value CHECK refuses anything else).
insert into contact_methods (person_id, kind, value, is_primary)
select v.person, 'email', v.address, true
  from (values
    ('c6500000-0000-4000-8000-0000000000a0'::uuid, 'hollis.wardlaw.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000001', 'rosalind.quarrington.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000002', 'benedikt.ollerenshaw.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000003', 'clementine.ashby.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000004', 'thaddeus.pembrook.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000005', 'honoria.fitzcrane.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000006', 'merriweather.household.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000007', 'merriweather.household.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000008', 'wilfred.tamsworth.signin65@example.invalid'),
    ('c6500000-0000-4000-8000-000000000009', 'isolde.brackenridge.signin65@example.invalid')
  ) v(person, address)
 where not exists (select 1 from contact_methods c
                    where c.person_id = v.person and c.kind = 'email' and c.ended_at is null);

-- The sender's role: a custom role with exactly the keys the send needs.
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('65000000-0000-4000-8000-0000000000c1', '65000000-0000-4000-8000-000000000001',
   'hollinbrook_sender', 'Hollinbrook Sender (fixture)', 'custom', false)
on conflict (id) do nothing;
insert into app_role_permissions (role_id, permission_key)
select '65000000-0000-4000-8000-0000000000c1', k
  from unnest(array['people.manage', 'officers.manage', 'directory.view', 'events.view']) k
 where not exists (select 1 from app_role_permissions p
                    where p.role_id = '65000000-0000-4000-8000-0000000000c1' and p.permission_key = k);
insert into role_grants (organization_id, role_id, person_id, starts_on)
select '65000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-0000000000c1',
       'c6500000-0000-4000-8000-0000000000a0', '2020-01-01'
 where not exists (select 1 from role_grants g
                    where g.role_id = '65000000-0000-4000-8000-0000000000c1'
                      and g.person_id = 'c6500000-0000-4000-8000-0000000000a0');

-- Two ruling elders (the derived Session roster materializes by trigger).
insert into officer_terms (organization_id, person_id, office, starts_on)
select '65000000-0000-4000-8000-000000000001', v.person, 'ruling_elder', '2020-01-01'
  from (values ('c6500000-0000-4000-8000-000000000001'::uuid), ('c6500000-0000-4000-8000-000000000005')) v(person)
 where not exists (select 1 from officer_terms t
                    where t.person_id = v.person and t.organization_id = '65000000-0000-4000-8000-000000000001');

-- 3. The two open sign_in invitations (2099-dated), sent by the fixture sender.
insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id,
       token_hash, created_by_user_id, created_at, expires_at)
select '65000000-0000-4000-8000-000000000001', 'sign_in', 'org', v.address, v.person,
       encode(sha256(convert_to(v.token, 'UTF8')), 'hex'),
       'e6500000-0000-4000-8000-0000000000a0', '2099-01-01T00:00:00Z', '2099-01-30T00:00:00Z'
  from (values
    ('c6500000-0000-4000-8000-000000000004'::uuid, 'thaddeus.pembrook.signin65@example.invalid',
     'seed-dev-sign-in-thaddeus-open-000000000'),
    ('c6500000-0000-4000-8000-000000000005', 'honoria.fitzcrane.signin65@example.invalid',
     'seed-dev-sign-in-honoria-open-0000000000')
  ) v(person, address, token)
 where not exists (select 1 from account_invitations i
                    where i.token_hash = encode(sha256(convert_to(v.token, 'UTF8')), 'hex'));

commit;
