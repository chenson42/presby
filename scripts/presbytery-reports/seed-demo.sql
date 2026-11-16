-- ---------------------------------------------------------------------------
-- Demo data for the presbytery reports (docs/work-log/2026-11-15-presbytery-reports.md,
-- Phase 3 "Dev fixture", P3-7). A SEPARATE script, applied AFTER scripts/seed-dev.sql
-- to a dev or pipeline Neon branch, never merged into seed-dev.sql (scripts/test-rls.sql
-- carries count assertions an enlargement there would move) and NEVER applied to
-- production: the operator's production demo uses the real forms.
--
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/presbytery-reports/seed-demo.sql
--
-- Everything is invented: congregation and minister names are made up, there are no
-- addresses, and the one sign-in the walk uses is the existing fixture
-- presbytery.clerk.fixture@example.invalid (holds all four report keys at the Northern
-- Reach; password in docs/testing.md). Appointment dates are relative to current_date so
-- the vacancy rules stay true next month; statistics and bills use fixed calendar years.
--
-- It adds six congregations to the Northern Reach (affiliations inserted through the real
-- table, so parent_id is DERIVED, never written), three ministers with presbytery
-- memberships, appointments covering every vacancy rule, three years of statistics with
-- the gaps a trend must show, oversight rows, and 2024 and 2025 per-capita bills.
--
-- Safe to run twice: the second run sees its own marker row and does nothing. It refuses
-- (by dividing by zero) to run on a database that does not hold the seed-dev fixture.
-- ---------------------------------------------------------------------------

select exists (select 1 from organizations where id = '11111111-1111-1111-1111-111111111111' and slug = 'northern-reach') as has_fixture \gset
\if :has_fixture
\else
  \echo 'seed-demo.sql: the seed-dev.sql fixture (Presbytery of the Northern Reach) is not here. Refusing.'
  select 1 / 0;
\endif

select exists (select 1 from organizations where id = 'd4000000-0000-0000-0000-000000000001') as applied \gset
\if :applied
  \echo 'seed-demo.sql: already applied; nothing to do.'
  \quit
\endif

begin;

-- ---------------------------------------------------------------------------
-- Six congregations, written as roots; the affiliation rows below derive parent_id and path.
-- ---------------------------------------------------------------------------
insert into organizations (id, organization_type, name, slug, path, platform_status) values
  ('d4000000-0000-0000-0000-000000000001', 'congregation', 'Cedar Hollow Presbyterian Church', 'cedar-hollow', 'cedar_hollow', 'unmanaged'),
  ('d4000000-0000-0000-0000-000000000002', 'congregation', 'Dunmore Ridge Presbyterian Church', 'dunmore-ridge', 'dunmore_ridge', 'unmanaged'),
  ('d4000000-0000-0000-0000-000000000003', 'congregation', 'Elkhorn Crossing Presbyterian Church', 'elkhorn-crossing', 'elkhorn_crossing', 'unmanaged'),
  ('d4000000-0000-0000-0000-000000000004', 'congregation', 'Fairlawn Heights Presbyterian Church', 'fairlawn-heights', 'fairlawn_heights', 'unmanaged'),
  ('d4000000-0000-0000-0000-000000000005', 'congregation', 'Glenmoor Presbyterian Church', 'glenmoor', 'glenmoor', 'unmanaged'),
  ('d4000000-0000-0000-0000-000000000006', 'congregation', 'Hollis Bend Presbyterian Church', 'hollis-bend', 'hollis_bend', 'unmanaged'),
  -- One long invented name (over 60 characters) for the 360px wrap check.
  ('d4000000-0000-0000-0000-000000000007', 'congregation', 'The First Presbyterian Church of the Upper Meadowbrook Crossing and Greater Riverbend Township', 'upper-meadowbrook', 'upper_meadowbrook', 'unmanaged');

insert into organization_affiliations
  (organization_id, subject_org_id, parent_org_id, relationship_type,
   effective_from, effective_to, authority, minute_reference, reason,
   closed_by_org_id, closed_on, closed_minute_reference)
values
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'member_congregation', '1971-04-10', null, 'recorded', 'Northern Reach stated meeting, 1971-04-10, item 2', 'Organized', null, null, null),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'member_congregation', '1955-09-18', null, 'recorded', 'Northern Reach stated meeting, 1955-09-18, item 5', 'Organized', null, null, null),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'member_congregation', '1962-02-03', null, 'recorded', 'Northern Reach stated meeting, 1962-02-03, item 1', 'Organized', null, null, null),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'member_congregation', '1990-11-11', null, 'recorded', 'Northern Reach stated meeting, 1990-11-11, item 3', 'Organized', null, null, null),
  -- Glenmoor joined in March 2024, so 2022 and 2023 read as a dash in the trend.
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'member_congregation', '2024-03-01', null, 'recorded', 'Northern Reach stated meeting, 2024-03-01, item 6', 'Received', null, null, null),
  -- Hollis Bend left at the end of June 2025: off the roster, but its bill stays on the per-capita report.
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'member_congregation', '1968-06-02', '2025-06-30', 'recorded', 'Northern Reach stated meeting, 1968-06-02, item 4', 'Organized', '11111111-1111-1111-1111-111111111111', '2025-06-30', 'Northern Reach stated meeting, 2025-06-30, item 8'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'member_congregation', '1949-05-22', null, 'recorded', 'Northern Reach stated meeting, 1949-05-22, item 2', 'Organized', null, null, null);

-- ---------------------------------------------------------------------------
-- Three invented ministers, each a presbytery member (appointments_person_fk needs it).
-- ---------------------------------------------------------------------------
insert into people (id, first_name, last_name, date_of_birth) values
  ('d4100000-0000-0000-0000-000000000001', 'Evander', 'Pruitt', '1971-02-14'),
  ('d4100000-0000-0000-0000-000000000002', 'Odessa', 'Rainwater', '1966-08-30'),
  ('d4100000-0000-0000-0000-000000000003', 'Tobiah', 'Larkspur', '1980-12-05');

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since) values
  ('11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000001', null, null, 'regular', 'active', '2019-01-01'),
  ('11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000002', null, null, 'regular', 'active', '2014-01-01'),
  ('11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000003', null, null, 'regular', 'active', '2021-01-01');

insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, age_at_action, approval_status, minute_reference, approved_on) values
  ('11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000001', 'opening_balance', '2019-01-01', 'active', 47, 'approved', 'Imported baseline', '2019-01-01'),
  ('11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000002', 'opening_balance', '2014-01-01', 'active', 47, 'approved', 'Imported baseline', '2014-01-01'),
  ('11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000003', 'opening_balance', '2021-01-01', 'active', 40, 'approved', 'Imported baseline', '2021-01-01');

-- ---------------------------------------------------------------------------
-- Appointments: one congregation for each vacancy rule. Alder Creek keeps seed-dev's installed call.
--   Cedar Hollow     designated call in force            -> filled
--   Dunmore Ridge    installed call ended 27 months ago, interim in force -> vacant, with supply
--   Elkhorn Crossing stated supply only, never an installed call           -> vacant, "no earlier pastor"
--   Fairlawn Heights nothing at all                                        -> vacant, "no earlier pastor"
--   Bramblewood      installed call ended 14 months ago, nothing since     -> vacant
--   Glenmoor         installed call that starts in 30 days                 -> vacant today
--   Quillhaven       designated call ending in 45 days                     -> still filled
--   Upper Meadowbrook installed call in force                              -> filled
--   Fernwood         installed call in force                               -> filled
--   Marrowbone       nothing                                               -> vacant
-- ---------------------------------------------------------------------------
insert into appointments (id, organization_id, person_id, serving_org_id, call_type, starts_on, ends_on, end_reason, minute_reference, recorded_at) values
  ('d4200000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'designated_pastor', current_date - interval '3 years', null, null, 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002', 'installed_pastor', date '2012-05-01', (current_date - interval '27 months')::date, 'Retired', 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000002', 'interim_pastor', (current_date - interval '8 months')::date, null, null, 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003', 'stated_supply', (current_date - interval '5 months')::date, null, null, 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'installed_pastor', date '2009-01-01', (current_date - interval '14 months')::date, 'Called elsewhere', 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000005', 'installed_pastor', (current_date + interval '30 days')::date, null, null, 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'designated_pastor', date '2021-01-01', (current_date + interval '45 days')::date, null, 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000007', 'installed_pastor', date '2016-09-01', null, null, 'Demo data', now()),
  ('d4200000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'd4100000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'installed_pastor', date '2018-03-01', null, null, 'Demo data', now());

-- ---------------------------------------------------------------------------
-- Statistics for 2023 to 2025 (presbytery_entered; the row seed-dev made for Alder Creek 2025
-- is a congregation-published row and stays). Gaps on purpose: Dunmore Ridge has no 2024 row
-- ("No data"); Fairlawn Heights has a 2024 row with no figure ("Not reported") and no 2023 row;
-- Glenmoor and Marrowbone joined in 2024 (a dash before).
-- ---------------------------------------------------------------------------
insert into congregation_statistics (organization_id, about_org_id, year, provenance, entered_by, ending_active) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 205),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 209),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 96),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 88),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 81),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 140),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 138),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 133),
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 22),
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 25),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 44),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 41),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000001', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 310),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000001', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 305),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000001', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 298),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 61),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 58),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 77),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 75),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 72),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000004', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', null),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000004', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 19),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000005', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 150),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000005', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 148),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000006', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 52),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000006', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 49),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000007', 2023, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 88),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000007', 2024, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 90),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000007', 2025, 'presbytery_entered', 'e0000000-0000-0000-0000-0000000000f4', 91);

-- ---------------------------------------------------------------------------
-- Oversight (viability: 1 at risk, 2 fair, 3 healthy). seed-dev has Alder Creek 3 and Bramblewood 2.
-- Notes include a comma, a double quote and a line break so the CSV quoting is exercised.
-- ---------------------------------------------------------------------------
insert into congregation_oversight (organization_id, about_org_id, viability_score, redevelopment_notes, updated_by) values
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002', 1, E'Sanctuary closed for a structural review, "worship in the hall" until spring.\nCommittee on Ministry to report in the fall.', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000005', 1, 'Membership has fallen by half since the 2024 reception; considering a shared ministry with a neighbouring church.', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000001', 2, null, 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000007', 3, 'Strong attendance; hosts the presbytery''s stated meeting each spring.', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', null, 'Awaiting assessment once the supply arrangement settles.', 'e0000000-0000-0000-0000-0000000000f4');

-- ---------------------------------------------------------------------------
-- Per capita. A 2024 rate and bill (for the "all years" file), and the 2025 rate on the 2023 basis with
-- bills in each state: paid in full, partly paid, unpaid, overpaid (a credit), a sub-cent payment
-- (100.005, rounded to the cent on screen and in the file), and a congregation that has left (Hollis Bend).
-- Fairlawn Heights, Glenmoor and Marrowbone have no 2023 figure (no statistics on file for 2023);
-- Elkhorn Crossing has a figure and no bill yet (not generated yet).
-- ---------------------------------------------------------------------------
insert into per_capita_rates (organization_id, billing_year, basis_year, rate_per_member, updated_by) values
  ('11111111-1111-1111-1111-111111111111', 2024, 2022, 25.00, 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 2025, 2023, 26.25, 'e0000000-0000-0000-0000-0000000000f4');

insert into per_capita_records
  (organization_id, about_org_id, billing_year, basis_year, ending_active_basis, rate_applied, amount_owed, paid_status, paid_amount, paid_at, updated_by)
values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2024, 2022, 200, 25.00, 5000.00, 'paid', 5000.00, '2024-04-12T00:00:00Z', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2025, 2023, 205, 26.25, 5381.25, 'paid', 5381.25, '2025-03-20T00:00:00Z', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 2025, 2023, 96, 26.25, 2520.00, 'partial', 1000.00, '2025-05-02T00:00:00Z', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000001', 2025, 2023, 310, 26.25, 8137.50, 'unpaid', null, null, 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 2025, 2023, 140, 26.25, 3675.00, 'paid', 3687.50, '2025-06-10T00:00:00Z', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 2025, 2023, 44, 26.25, 1155.00, 'partial', 100.005, '2025-07-01T00:00:00Z', 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002', 2025, 2023, 61, 26.25, 1601.25, 'unpaid', null, null, 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000007', 2025, 2023, 88, 26.25, 2310.00, 'unpaid', null, null, 'e0000000-0000-0000-0000-0000000000f4'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000006', 2025, 2023, 52, 26.25, 1365.00, 'unpaid', null, null, 'e0000000-0000-0000-0000-0000000000f4');

commit;
