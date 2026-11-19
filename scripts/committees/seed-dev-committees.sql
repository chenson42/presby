-- scripts/committees/seed-dev-committees.sql - the presbytery committees
-- fixture block (docs/work-log/2026-11-19-presbytery-committees-inc1.md,
-- Batch B1; drizzle/0090_presby_committees.sql; parent work-log Phase 3
-- "Seed and test files", T16).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE line, placed AFTER
-- its final `commit;` and after the other pipelines' `\ir` lines
-- (scripts/committees/seed-dev.sql.integration.patch):
--
--     \ir committees/seed-dev-committees.sql
--
-- Standalone:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/committees/seed-dev-committees.sql
--
-- Runs as the OWNER (like seed-dev.sql), in its own transaction, AFTER
-- seed-dev.sql and after 0090 (it uses the Northern Reach and Alder Creek and
-- their open affiliation). The owner meets every 0090 guard (F44): it may
-- insert a dissolved committee and an ended commission record with its
-- members (history), which a tenant connection may not.
--
-- Idempotent: every insert is `where not exists` on a fixed id (or `on
-- conflict do nothing`), so a re-run inserts nothing and no guard fires.
-- Dates that must stay "planned" (a future start, a planned end) are written
-- relative to the day the seed first runs; a re-run does not move them.
--
-- Invented values only (No Real Data): example.invalid addresses, made-up
-- names. Ids: groups and their details b0900000-..., people c0900000-...,
-- users and the role e0900000-..., commission rows d0900000-... (grepped
-- free in scripts/, src/, e2e/ and drizzle/ on 2026-11-19).
--
-- WHAT IS HERE (all organization_id = the Northern Reach, 1111...):
--   Committees (managed `committee` groups with a committee_details row):
--     Required  "Committee on Ministry"     chair, vice chair, clerk, two
--                                           members, ex officio; the chair
--                                           is opted into public listing
--               "Nominating Committee"      chair, member
--     Standing  "Finance Committee"         chair with a PLANNED end, a
--                                           member with a PLANNED start, an
--                                           ENDED seat (every roster section)
--               "Mission Committee"         chair, a member whose presbytery
--                                           membership has ENDED, a member
--                                           recorded as DECEASED (the two
--                                           status badges, Gap 14)
--     Ad hoc    "Camp Property Study Group"
--     Dissolved "Spring Retreat Planning Group" (ad hoc, dissolved
--                                           2025-05-01, past seats ended on
--                                           that date)
--   The existing "Commission on Alder Creek" committee group (b...0005) is
--   LEFT UNLABELLED (no committee_details row): it shows the "Not yet
--   labelled" state, and its administrative_commissions row and seats are
--   untouched (46k, 68e and 73f rely on them; F460).
--   Commission records (Increment 2 shows them; the rows exist from 0090):
--     an active commission about Alder Creek (chair, clerk, member, a
--     minute reference) and an ENDED commission about no congregation with
--     an ending minute reference and its members' seats ended.
--   Accounts (the shared fixture password in docs/testing.md):
--     committees.clerk@example.invalid - Odette Brackwater, a staff member of
--       the Northern Reach holding an adopted custom role "Committees Clerk"
--       (e0900000-...-0101) carrying ONLY groups.manage. groups.manage is not
--       a two-factor key, so the walk never forces TOTP. (No seeded fixture
--       account held groups.manage at the Northern Reach before this file;
--       checked 2026-11-19.)
--     committees.plain@example.invalid - Fenwick Ashgrove, a staff member
--       with no role: the denied state.
--
-- WHAT IS NOT HERE, ON PURPOSE:
--   * No group_memberships row on b...0005 and no administrative_commissions,
--     org_delegations or role_grants row naming a committee group: nothing in
--     this pipeline writes the downward tables or binds a role to a committee
--     (DECISION-355). The one role_grants row below is a PERSON grant of the
--     clerk's role.
--   * org_portal.committees is a global flag (seeded on by scripts/seed.ts);
--     nothing here touches feature_flags.
--   * The Northern Reach has no live public site in the stock seed, so the
--     opted-in chair is listed nowhere public; the public roster is proven
--     in test-rls-90 (h) and committees.db.test.ts.

begin;

-- ---------------------------------------------------------------------------
-- People and their Northern Reach memberships.
-- ---------------------------------------------------------------------------
insert into people (id, first_name, last_name)
select v.id::uuid, v.first_name, v.last_name
  from (values
    ('c0900000-0000-4000-8000-000000000001', 'Odette',      'Brackwater'),
    ('c0900000-0000-4000-8000-000000000002', 'Fenwick',     'Ashgrove'),
    ('c0900000-0000-4000-8000-000000000003', 'Corwin',      'Haldane'),
    ('c0900000-0000-4000-8000-000000000004', 'Imogen',      'Vatterly'),
    ('c0900000-0000-4000-8000-000000000005', 'Rosalind',    'Quarles'),
    ('c0900000-0000-4000-8000-000000000006', 'Bartholomew', 'Stanage'),
    ('c0900000-0000-4000-8000-000000000007', 'Lucinda',     'Merrow'),
    ('c0900000-0000-4000-8000-000000000008', 'Ambrose',     'Pellingham'),
    ('c0900000-0000-4000-8000-000000000009', 'Wilhelmina',  'Strade'),
    ('c0900000-0000-4000-8000-000000000010', 'Jasper',      'Thornbury'),
    ('c0900000-0000-4000-8000-000000000011', 'Henrietta',   'Colquist'),
    ('c0900000-0000-4000-8000-000000000012', 'Peregrine',   'Ashdown'),
    ('c0900000-0000-4000-8000-000000000013', 'Mirabel',     'Fanshaw'),
    ('c0900000-0000-4000-8000-000000000014', 'Tobiah',      'Varden'),
    ('c0900000-0000-4000-8000-000000000015', 'Constance',   'Hollowell'),
    ('c0900000-0000-4000-8000-000000000016', 'Everard',     'Lisle')
  ) v(id, first_name, last_name)
 where not exists (select 1 from people p where p.id = v.id::uuid);

-- Recorded as deceased (the "Recorded as deceased" badge; the public roster
-- excludes him).
update people set date_of_death = '2026-08-02'
 where id = 'c0900000-0000-4000-8000-000000000016' and date_of_death is null;

-- Staff with no roll for the two accounts (the founding-administrator shape:
-- no roll_actions row is owed); regular with no roll for everyone else.
insert into memberships (organization_id, person_id, engagement_status, current_roll)
select '11111111-1111-1111-1111-111111111111', v.id::uuid, v.engagement, null
  from (values
    ('c0900000-0000-4000-8000-000000000001', 'staff'),
    ('c0900000-0000-4000-8000-000000000002', 'staff'),
    ('c0900000-0000-4000-8000-000000000003', 'regular'),
    ('c0900000-0000-4000-8000-000000000004', 'regular'),
    ('c0900000-0000-4000-8000-000000000005', 'regular'),
    ('c0900000-0000-4000-8000-000000000006', 'regular'),
    ('c0900000-0000-4000-8000-000000000007', 'regular'),
    ('c0900000-0000-4000-8000-000000000008', 'regular'),
    ('c0900000-0000-4000-8000-000000000009', 'regular'),
    ('c0900000-0000-4000-8000-000000000010', 'regular'),
    ('c0900000-0000-4000-8000-000000000011', 'regular'),
    ('c0900000-0000-4000-8000-000000000012', 'regular'),
    ('c0900000-0000-4000-8000-000000000013', 'regular'),
    ('c0900000-0000-4000-8000-000000000014', 'regular'),
    ('c0900000-0000-4000-8000-000000000015', 'regular'),
    ('c0900000-0000-4000-8000-000000000016', 'regular')
  ) v(id, engagement)
 where not exists (select 1 from memberships m
                    where m.organization_id = '11111111-1111-1111-1111-111111111111'
                      and m.person_id = v.id::uuid);

-- No longer connected to the presbytery (Gap 14): her seat stays, with the
-- badge; the public roster excludes her.
update memberships set ended_on = '2026-06-30', ended_reason = 'community_archived'
 where organization_id = '11111111-1111-1111-1111-111111111111'
   and person_id = 'c0900000-0000-4000-8000-000000000015'
   and ended_on is null;

-- ---------------------------------------------------------------------------
-- The two accounts, the clerk's role and its person grant.
-- ---------------------------------------------------------------------------
insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values
  ('e0900000-0000-4000-8000-000000000001', 'committees.clerk@example.invalid', 'Fixture Committees Clerk', now(),
   '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2', true, false),
  ('e0900000-0000-4000-8000-000000000002', 'committees.plain@example.invalid', 'Fixture Plain Presbytery Member', now(),
   '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2', true, false)
on conflict (id) do nothing;

update people set user_id = 'e0900000-0000-4000-8000-000000000001'
 where id = 'c0900000-0000-4000-8000-000000000001' and user_id is null;
update people set user_id = 'e0900000-0000-4000-8000-000000000002'
 where id = 'c0900000-0000-4000-8000-000000000002' and user_id is null;

insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
select 'e0900000-0000-4000-8000-000000000101', '11111111-1111-1111-1111-111111111111',
       'committees_clerk', 'Committees Clerk', 'custom', false
 where not exists (select 1 from app_roles where id = 'e0900000-0000-4000-8000-000000000101');

insert into app_role_permissions (role_id, permission_key)
values ('e0900000-0000-4000-8000-000000000101', 'groups.manage')
on conflict (role_id, permission_key) do nothing;

insert into role_grants (organization_id, role_id, person_id, starts_on)
select '11111111-1111-1111-1111-111111111111', 'e0900000-0000-4000-8000-000000000101',
       'c0900000-0000-4000-8000-000000000001', '2026-01-01'
 where not exists (select 1 from role_grants
                    where role_id = 'e0900000-0000-4000-8000-000000000101'
                      and person_id = 'c0900000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- The committees: managed `committee` groups and their details rows.
-- created_by / updated_by: the clerk fixture account (clerk.fixture), as if
-- the presbytery office entered them.
-- ---------------------------------------------------------------------------
insert into groups (id, organization_id, group_type_id, name, description, meets_when)
select v.id::uuid, '11111111-1111-1111-1111-111111111111',
       (select id from group_types where key = 'committee'), v.name, v.description, v.meets_when
  from (values
    ('b0900000-0000-4000-8000-000000000001', 'Committee on Ministry',
     'Fixture purpose: works with ministers and sessions on calls, examinations and pastoral care.', 'Second Tuesday, 7 pm'),
    ('b0900000-0000-4000-8000-000000000002', 'Nominating Committee',
     'Fixture purpose: proposes people to serve on the presbytery''s committees.', 'As needed'),
    ('b0900000-0000-4000-8000-000000000003', 'Finance Committee',
     'Fixture purpose: prepares the budget and watches the presbytery''s accounts.', 'Monthly'),
    ('b0900000-0000-4000-8000-000000000004', 'Mission Committee',
     'Fixture purpose: coordinates the presbytery''s shared mission work.', 'Quarterly'),
    ('b0900000-0000-4000-8000-000000000005', 'Camp Property Study Group',
     'Fixture purpose: studies the future of the presbytery''s camp property.', null),
    ('b0900000-0000-4000-8000-000000000006', 'Spring Retreat Planning Group',
     'Fixture purpose: planned the 2025 spring retreat.', null)
  ) v(id, name, description, meets_when)
 where not exists (select 1 from groups g where g.id = v.id::uuid);

-- Five active, one dissolved (the owner may insert a dissolved row; a tenant
-- may not - 0090 section 2).
insert into committee_details (id, organization_id, group_id, kind, dissolved_on, dissolved_by, dissolved_at,
                               created_by, updated_by)
select v.id::uuid, '11111111-1111-1111-1111-111111111111', v.group_id::uuid, v.kind,
       v.dissolved_on::date,
       case when v.dissolved_on is not null then 'e0000000-0000-0000-0000-0000000000f3'::uuid end,
       case when v.dissolved_on is not null then (v.dissolved_on || ' 12:00:00+00')::timestamptz end,
       'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
  from (values
    ('b0900000-0000-4000-8000-000000000101', 'b0900000-0000-4000-8000-000000000001', 'required', null),
    ('b0900000-0000-4000-8000-000000000102', 'b0900000-0000-4000-8000-000000000002', 'required', null),
    ('b0900000-0000-4000-8000-000000000103', 'b0900000-0000-4000-8000-000000000003', 'standing', null),
    ('b0900000-0000-4000-8000-000000000104', 'b0900000-0000-4000-8000-000000000004', 'standing', null),
    ('b0900000-0000-4000-8000-000000000105', 'b0900000-0000-4000-8000-000000000005', 'ad_hoc',   null),
    ('b0900000-0000-4000-8000-000000000106', 'b0900000-0000-4000-8000-000000000006', 'ad_hoc',   '2025-05-01')
  ) v(id, group_id, kind, dissolved_on)
 where not exists (select 1 from committee_details d where d.id = v.id::uuid);

-- ---------------------------------------------------------------------------
-- The seats (group_memberships, managed). Half-open dates: ends_on is the
-- first day the person no longer serves.
-- ---------------------------------------------------------------------------
insert into group_memberships (id, organization_id, group_id, person_id, group_role, source, starts_on, ends_on,
                               public_listed, public_listed_by, public_listed_at)
select v.id::uuid, '11111111-1111-1111-1111-111111111111', v.group_id::uuid, v.person_id::uuid, v.group_role,
       'managed', v.starts_on, v.ends_on, v.listed,
       case when v.listed then 'e0000000-0000-0000-0000-0000000000f3'::uuid end,
       case when v.listed then now() end
  from (values
    -- Committee on Ministry (Required).
    ('b0900000-0000-4000-8000-000000000201', 'b0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000003', 'chair',      date '2026-01-01', null::date, true),
    ('b0900000-0000-4000-8000-000000000202', 'b0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000004', 'vice_chair', date '2026-01-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000203', 'b0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000005', 'clerk',      date '2026-01-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000204', 'b0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000006', 'member',     date '2026-01-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000205', 'b0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000007', 'member',     date '2026-01-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000206', 'b0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000008', 'ex_officio', date '2026-01-01', null::date, false),
    -- Nominating Committee (Required).
    ('b0900000-0000-4000-8000-000000000211', 'b0900000-0000-4000-8000-000000000002', 'c0900000-0000-4000-8000-000000000009', 'chair',      date '2026-01-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000212', 'b0900000-0000-4000-8000-000000000002', 'c0900000-0000-4000-8000-000000000010', 'member',     date '2026-01-01', null::date, false),
    -- Finance Committee (Standing): a planned end, a planned start, an ended seat.
    ('b0900000-0000-4000-8000-000000000221', 'b0900000-0000-4000-8000-000000000003', 'c0900000-0000-4000-8000-000000000011', 'chair',      date '2025-01-01', current_date + 90, false),
    ('b0900000-0000-4000-8000-000000000222', 'b0900000-0000-4000-8000-000000000003', 'c0900000-0000-4000-8000-000000000012', 'member',     current_date + 30, null::date, false),
    ('b0900000-0000-4000-8000-000000000223', 'b0900000-0000-4000-8000-000000000003', 'c0900000-0000-4000-8000-000000000013', 'member',     date '2024-01-01', date '2025-06-01', false),
    ('b0900000-0000-4000-8000-000000000224', 'b0900000-0000-4000-8000-000000000003', 'c0900000-0000-4000-8000-000000000006', 'secretary',  date '2026-01-01', null::date, false),
    -- Mission Committee (Standing): an ended presbytery membership, a death.
    ('b0900000-0000-4000-8000-000000000231', 'b0900000-0000-4000-8000-000000000004', 'c0900000-0000-4000-8000-000000000014', 'chair',      date '2026-01-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000232', 'b0900000-0000-4000-8000-000000000004', 'c0900000-0000-4000-8000-000000000015', 'member',     date '2025-03-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000233', 'b0900000-0000-4000-8000-000000000004', 'c0900000-0000-4000-8000-000000000016', 'member',     date '2025-03-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000234', 'b0900000-0000-4000-8000-000000000004', 'c0900000-0000-4000-8000-000000000003', 'member',     date '2026-01-01', null::date, false),
    -- Camp Property Study Group (Ad hoc).
    ('b0900000-0000-4000-8000-000000000241', 'b0900000-0000-4000-8000-000000000005', 'c0900000-0000-4000-8000-000000000010', 'chair',      date '2026-03-01', null::date, false),
    ('b0900000-0000-4000-8000-000000000242', 'b0900000-0000-4000-8000-000000000005', 'c0900000-0000-4000-8000-000000000007', 'member',     date '2026-03-01', null::date, false),
    -- Spring Retreat Planning Group (dissolved 2025-05-01; its seats ended that day).
    ('b0900000-0000-4000-8000-000000000251', 'b0900000-0000-4000-8000-000000000006', 'c0900000-0000-4000-8000-000000000004', 'chair',      date '2025-01-15', date '2025-05-01', false),
    ('b0900000-0000-4000-8000-000000000252', 'b0900000-0000-4000-8000-000000000006', 'c0900000-0000-4000-8000-000000000009', 'member',     date '2025-01-15', date '2025-05-01', false)
  ) v(id, group_id, person_id, group_role, starts_on, ends_on, listed)
 where not exists (select 1 from group_memberships gm where gm.id = v.id::uuid);

-- ---------------------------------------------------------------------------
-- Commission records (Increment 2 shows them). The active one is about Alder
-- Creek (affiliated today, so the 0045 trigger accepts it); the ended one is
-- about no congregation, inserted already ended with its members' seats
-- ended (the owner may insert history; a tenant may not).
-- ---------------------------------------------------------------------------
insert into commission_records (id, organization_id, about_org_id, title, charge, appointed_on, minute_reference,
                                ended_on, ended_minute_reference, ended_by, ended_at, created_by, updated_by)
select v.id::uuid, '11111111-1111-1111-1111-111111111111', v.about_org_id::uuid, v.title, v.charge, v.appointed_on,
       v.minute_reference, v.ended_on, v.ended_minute,
       case when v.ended_on is not null then 'e0000000-0000-0000-0000-0000000000f3'::uuid end,
       case when v.ended_on is not null then (v.ended_on::text || ' 12:00:00+00')::timestamptz end,
       'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
  from (values
    ('d0900000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222',
     'Administrative Commission for Alder Creek',
     'Fixture charge: to work with the session on its governance and report to the presbytery.',
     date '2026-09-14', 'Fixture minute: Presbytery meeting 2026-09-14, item 7', null::date, null::text),
    ('d0900000-0000-4000-8000-000000000002', null,
     'Administrative Commission for the Spring Ordination Examinations',
     'Fixture charge: to examine candidates for ordination on the presbytery''s behalf.',
     date '2025-02-10', 'Fixture minute: Presbytery meeting 2025-02-10, item 4', date '2025-06-30',
     'Fixture minute: Presbytery meeting 2025-07-12, item 3')
  ) v(id, about_org_id, title, charge, appointed_on, minute_reference, ended_on, ended_minute)
 where not exists (select 1 from commission_records r where r.id = v.id::uuid);

insert into commission_record_members (id, organization_id, commission_record_id, person_id, role, starts_on, ends_on,
                                       created_by, updated_by)
select v.id::uuid, '11111111-1111-1111-1111-111111111111', v.record_id::uuid, v.person_id::uuid, v.role,
       v.starts_on, v.ends_on, 'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
  from (values
    ('d0900000-0000-4000-8000-000000000011', 'd0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000005', 'chair',  date '2026-09-14', null::date),
    ('d0900000-0000-4000-8000-000000000012', 'd0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000008', 'clerk',  date '2026-09-14', null::date),
    ('d0900000-0000-4000-8000-000000000013', 'd0900000-0000-4000-8000-000000000001', 'c0900000-0000-4000-8000-000000000014', 'member', date '2026-09-14', null::date),
    ('d0900000-0000-4000-8000-000000000021', 'd0900000-0000-4000-8000-000000000002', 'c0900000-0000-4000-8000-000000000009', 'chair',  date '2025-02-10', date '2025-06-30'),
    ('d0900000-0000-4000-8000-000000000022', 'd0900000-0000-4000-8000-000000000002', 'c0900000-0000-4000-8000-000000000006', 'member', date '2025-02-10', date '2025-06-30')
  ) v(id, record_id, person_id, role, starts_on, ends_on)
 where not exists (select 1 from commission_record_members m where m.id = v.id::uuid);

commit;
