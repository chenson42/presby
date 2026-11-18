-- scripts/oversight/seed-dev-oversight.sql - the congregation-records fixture
-- block (docs/work-log/2026-11-17-congregation-profile-inc1.md, Batch B1;
-- drizzle/0089_presby_oversight_records.sql; parent work-log Phase 3 "Seed
-- and test files").
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE line, placed AFTER
-- its final `commit;` and after the other pipelines' `\ir` lines
-- (scripts/oversight/seed-dev.sql.integration.patch):
--
--     \ir oversight/seed-dev-oversight.sql
--
-- Standalone:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/oversight/seed-dev-oversight.sql
--
-- Runs as the OWNER (like seed-dev.sql), in its own transaction, AFTER
-- seed-dev.sql (it uses the Northern Reach, Alder Creek and Bramblewood and
-- their open affiliations). The owner meets every 0089 guard (F44); the
-- about-org trigger accepts these rows because both congregations are
-- affiliated with the Northern Reach today.
--
-- Idempotent: every insert is `where not exists` on a fixed id (or `on
-- conflict do nothing`), so a re-run inserts nothing and no guard fires.
--
-- Invented values only (No Real Data): example.invalid, 555 numbers, made-up
-- names and places. The two photo rows are GENERATED solid-colour images
-- (Increment 2), never a real photograph.
--
-- WHAT IS HERE (all organization_id = the Northern Reach, 1111...):
--   Alder Creek (2222...): a profile; two buildings ("Sanctuary", primary,
--     and "Education Wing"); a 2024 appraisal on the Sanctuary; a 2026
--     insurance year.
--   Alder Creek's Sanctuary also has two photos (Increment 2): generated
--     solid-colour pictures, the first its cover (blobs bb890000-...-0001 to
--     -0004, photos b0890000-...-0007 and -0008).
--   Bramblewood (3333...): one presbytery program loan.
--   A NEW finance holder, so the tier-2 half is walkable in a browser:
--     Linnea Harrowgate (person c0890000-...-0001), account
--     finance.fixture@example.invalid (user e0890000-...-0001, the shared
--     fixture password in docs/testing.md), a staff membership at the
--     Northern Reach, and an adopted custom role "Oversight Finance"
--     (f0890000-...-0001) carrying ONLY congregation_oversight.finance.
--     Because the key is flagged (requires_two_factor), she is asked to
--     enrol two-factor at her first sign-in (presby_two_factor_required arm
--     B) - the walk the help page describes.
--
-- WHAT IS NOT HERE, ON PURPOSE:
--   * The finance key is NOT given to the existing presbytery stated clerk
--     role (f...00e, Idris Calloway): a flagged key would force TOTP on the
--     dev clerk walk (the seed's own DECISION-291 caveat), and the clerk is
--     the manage-only viewer the Locked sections need.
--   * No row about a Western Basin congregation: the Western Basin has no
--     member congregation in seed-dev.sql, and adding an organization moves
--     several test-rls.sql invariants (one canonical name row per
--     organization, the backfill completeness counts). The cross-presbytery
--     checks build their own world: scripts/oversight/test-rls-89.sql uses
--     the Western Basin, the Southern Fields and the Synod as they are;
--     oversight.db.test.ts and the B4 e2e fixture mint throwaway councils.
--   * org_portal.oversight is a global flag (seeded off by scripts/seed.ts);
--     turn it on at /admin/flags for a browser walk.
--   * Nothing about Quillhaven, Fernwood or Marrowbone.

begin;

-- ---------------------------------------------------------------------------
-- The finance holder: person, account, staff membership, role, grant.
-- ---------------------------------------------------------------------------
insert into people (id, first_name, last_name)
select 'c0890000-0000-4000-8000-000000000001', 'Linnea', 'Harrowgate'
 where not exists (select 1 from people where id = 'c0890000-0000-4000-8000-000000000001');

insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values ('e0890000-0000-4000-8000-000000000001', 'finance.fixture@example.invalid',
        'Fixture Finance Holder', now(),
        '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2',
        true, false)
on conflict (id) do nothing;

update people
   set user_id = 'e0890000-0000-4000-8000-000000000001'
 where id = 'c0890000-0000-4000-8000-000000000001'
   and user_id is null;

-- Staff, no roll (the founding-administrator shape): no roll_actions row is
-- owed, so presby_roll_cache_drift() has nothing to find.
insert into memberships (organization_id, person_id, engagement_status, current_roll)
select '11111111-1111-1111-1111-111111111111', 'c0890000-0000-4000-8000-000000000001', 'staff', null
 where not exists (select 1 from memberships
                    where organization_id = '11111111-1111-1111-1111-111111111111'
                      and person_id = 'c0890000-0000-4000-8000-000000000001');

insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
select 'f0890000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
       'oversight_finance', 'Oversight Finance', 'custom', false
 where not exists (select 1 from app_roles where id = 'f0890000-0000-4000-8000-000000000001');

insert into app_role_permissions (role_id, permission_key)
values ('f0890000-0000-4000-8000-000000000001', 'congregation_oversight.finance')
on conflict (role_id, permission_key) do nothing;

insert into role_grants (organization_id, role_id, person_id, starts_on)
select '11111111-1111-1111-1111-111111111111', 'f0890000-0000-4000-8000-000000000001',
       'c0890000-0000-4000-8000-000000000001', '2026-01-01'
 where not exists (select 1 from role_grants
                    where role_id = 'f0890000-0000-4000-8000-000000000001'
                      and person_id = 'c0890000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- The records. created_by / updated_by: the clerk fixture account
-- (clerk.fixture@example.invalid), as if Idris Calloway's office entered them.
-- ---------------------------------------------------------------------------
insert into oversight_profiles (id, organization_id, about_org_id, street_address, city, county,
                                year_organized, phone, created_by, updated_by)
select 'b0890000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', E'100 Fixture Lane\nSuite 2', 'Aldermoor', 'Reach County',
       1962, '555-0189', 'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_profiles where id = 'b0890000-0000-4000-8000-000000000001');

insert into oversight_buildings (id, organization_id, about_org_id, name, building_type, year_built,
                                 first_addition_year, square_feet, roof_condition, plumbing_condition,
                                 hvac_condition, boiler_condition, has_sprinklers, has_fire_alarm,
                                 has_security_system, is_primary, notes, created_by, updated_by)
select 'b0890000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', 'Sanctuary', 'sanctuary', 1962, 1988, 9200,
       'fair', 'good', 'poor', null, false, true, null, true,
       'Fixture note: the roof over the narthex was patched after a storm.',
       'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_buildings where id = 'b0890000-0000-4000-8000-000000000002');

insert into oversight_buildings (id, organization_id, about_org_id, name, building_type, year_built,
                                 square_feet, roof_condition, created_by, updated_by)
select 'b0890000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', 'Education Wing', 'education_building', 1975, 4100, 'good',
       'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_buildings where id = 'b0890000-0000-4000-8000-000000000003');

insert into oversight_building_appraisals (id, organization_id, about_org_id, building_id, assessed_year,
                                           amount_cents, created_by)
select 'b0890000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', 'b0890000-0000-4000-8000-000000000002', 2024,
       185000000, 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_building_appraisals where id = 'b0890000-0000-4000-8000-000000000004');

insert into oversight_insurance_years (id, organization_id, about_org_id, policy_year, carrier, policy_number,
                                       policy_expires_on, recent_claims, pool_interest, created_by, updated_by)
select 'b0890000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222', 2026, 'Fixture Mutual Insurance', 'FX-0089-0001',
       '2026-12-31', false, true,
       'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_insurance_years where id = 'b0890000-0000-4000-8000-000000000005');

insert into oversight_loans (id, organization_id, about_org_id, kind, original_amount_cents,
                             current_balance_cents, balance_as_of, grants_amount_cents, guarantee_note,
                             created_by, updated_by)
select 'b0890000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111',
       '33333333-3333-3333-3333-333333333333', 'presbytery_program', 12000000, 4350000, '2026-06-30',
       1500000, 'Fixture note: guaranteed by the presbytery''s revolving fund.',
       'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_loans where id = 'b0890000-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- Two photos of the Sanctuary (Increment 2). GENERATED solid-colour pictures,
-- never a real photograph: a 320x240 JPEG master and a 160x160 WebP thumbnail
-- per photo, as `src/lib/oversight/photo-store.ts` would store them (private
-- audience, so no public door serves them). The first is the cover and has a
-- caption; the second has none. The Education Wing has no photo, so its building
-- page shows "Add a photo".
-- ---------------------------------------------------------------------------
insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
select 'bb890000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', encode(sha256(d.bytes), 'hex'), 'image/jpeg', length(d.bytes), d.bytes, 'private'
  from (select decode('ffd8ffdb00430006040506050406060506070706080a100a0a09090a140e0f0c1017141818171416161a1d251f1a1b231c1616202c20232627292a29191f2d302d283025282928ffdb0043010707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828ffc000110800f0014003012200021101031101ffc4001500010100000000000000000000000000000004ffc40014100100000000000000000000000000000000ffc4001501010100000000000000000000000000000005ffc40014110100000000000000000000000000000000ffda000c03010002110311003f008005b4a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007fffd9', 'hex') as bytes) d
 where not exists (select 1 from blob_assets where id = 'bb890000-0000-4000-8000-000000000001');

insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
select 'bb890000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', encode(sha256(d.bytes), 'hex'), 'image/webp', length(d.bytes), d.bytes, 'private'
  from (select decode('5249464672000000574542505650382066000000b008009d012aa000a0003e6d369a49a42322a1206800800d89696ee175f97000010f650435549b2621d5526c98875549b2621d5526c98875549b2621d5526c98875549b2621d5526c98875547e0000fefe0ff3ff8a0148e1cefff5f0053c4800000000000000', 'hex') as bytes) d
 where not exists (select 1 from blob_assets where id = 'bb890000-0000-4000-8000-000000000002');

insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
select 'bb890000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', encode(sha256(d.bytes), 'hex'), 'image/jpeg', length(d.bytes), d.bytes, 'private'
  from (select decode('ffd8ffdb00430006040506050406060506070706080a100a0a09090a140e0f0c1017141818171416161a1d251f1a1b231c1616202c20232627292a29191f2d302d283025282928ffdb0043010707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828ffc000110800f0014003012200021101031101ffc4001500010100000000000000000000000000000005ffc40014100100000000000000000000000000000000ffc400160101010100000000000000000000000000000405ffc40014110100000000000000000000000000000000ffda000c03010002110311003f00ae032508000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003fffd9', 'hex') as bytes) d
 where not exists (select 1 from blob_assets where id = 'bb890000-0000-4000-8000-000000000003');

insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
select 'bb890000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', encode(sha256(d.bytes), 'hex'), 'image/webp', length(d.bytes), d.bytes, 'private'
  from (select decode('52494646740000005745425056503820680000007008009d012aa000a0003e6d369a49a42322a1206800800d89696ee175f00040e35549b2621d5526c98875549b2621d5526c98875549b2621d5526c98875549b2621d5526c98875549b25a0000fefe44cfff0eee6ebd6b7f49c414798558e878a210000000000000', 'hex') as bytes) d
 where not exists (select 1 from blob_assets where id = 'bb890000-0000-4000-8000-000000000004');

insert into oversight_building_photos (id, organization_id, about_org_id, building_id, image_asset_key,
                                       thumb_asset_key, width, height, caption, is_cover, created_by)
select 'b0890000-0000-4000-8000-000000000007', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'b0890000-0000-4000-8000-000000000002',
       'bb890000-0000-4000-8000-000000000001', 'bb890000-0000-4000-8000-000000000002', 320, 240,
       'Fixture caption: a generated blue square.', true, 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_building_photos where id = 'b0890000-0000-4000-8000-000000000007');

insert into oversight_building_photos (id, organization_id, about_org_id, building_id, image_asset_key,
                                       thumb_asset_key, width, height, caption, is_cover, created_by)
select 'b0890000-0000-4000-8000-000000000008', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'b0890000-0000-4000-8000-000000000002',
       'bb890000-0000-4000-8000-000000000003', 'bb890000-0000-4000-8000-000000000004', 320, 240,
       null, false, 'e0000000-0000-0000-0000-0000000000f3'
 where not exists (select 1 from oversight_building_photos where id = 'b0890000-0000-4000-8000-000000000008');

commit;
