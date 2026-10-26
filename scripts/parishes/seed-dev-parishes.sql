-- ---------------------------------------------------------------------------
-- Parish management dev fixture (drizzle/0068_presby_parishes.sql;
-- docs/work-log/2026-10-25-parish-management.md Phase 3 "Staged for
-- integration", Phase 2 S3).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE include at its end,
-- after the person-emails include:
--
--     \ir parishes/seed-dev-parishes.sql
--
-- Until then, standalone, AS THE OWNER, after seed-dev.sql and 0068:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/parishes/seed-dev-parishes.sql
--
-- scripts/parishes/test-rls-68.sql NEEDS this fixture. Idempotent: every
-- insert is `where not exists` or `on conflict do nothing`, the archive is
-- guarded on `archived_at is null`, so a re-run changes nothing. (The
-- households are `where not exists`, never `on conflict`: a BEFORE INSERT
-- trigger fires before the conflict check, and households_org_unit_target_guard
-- would refuse a re-proposed row naming the now-archived East District.)
--
-- Synthetic data only (No Real Data): invented names, example.invalid
-- addresses, the shared fixture password documented in docs/testing.md.
--
-- What it adds:
--   1. The seat provisioning for EVERY congregation, in 0068 sections 8c and
--      9's exact shape: the derived `Board of Deacons Moderator` roster group,
--      the protected constitutional `deacons_moderator` role, its single
--      `parishes.assign` key and its group-arm grant (starts_on =
--      current_date, as the backfill). seed-dev.sql inserts its organizations
--      AFTER the migrations run, so on a database built from empty the 0068
--      backfill never reaches them; on development the backfill already did.
--      Replaying it here makes the two converge, so scripts/test-rls.sql
--      counts the same on both.
--   2. Alder Creek's seat holder: Wren Thackeray (c0000000-...-0008), an
--      active member who holds no administrator key and no
--      directory.view_hidden (only the Member role's directory.view and
--      events.view), recorded as Moderator of the Board of Deacons from
--      2026-09-01 and linked to a new sign-in fixture user
--      moderator.fixture@example.invalid (two_factor_required false, as
--      clerk.fixture: a manual walk is not gated behind TOTP enrolment; the
--      e2e signs in its own MFA-enrolled user, Phase 1 G15).
--   3. East District (a0680000-...-0001), with two member households
--      assigned to it and THEN archived (the target guard refuses assigning
--      into an archived district), so the archived-notice and "move all"
--      paths have data.
--   4. One unassigned visitor household (d0680000-...-0003), so the
--      Unassigned page has a Visitors row next to the two pre-existing
--      unassigned member households (The Renwick Family, Marguerite
--      Ashcombe).
--
-- Roll dates are recent (2021, 2023) on purpose: scripts/test-rls.sql
-- section 10 asserts nobody is on Alder Creek's roll before 2010 and pins
-- counts as of 2015.
--
-- Ids: people c0680000-..., households d0680000-..., the district
-- a0680000-..., the seat term e0680000-..., the user
-- e0000000-0000-0000-0000-0000000000f6 (after founding.fixture's f5).
-- ---------------------------------------------------------------------------

begin;

-- 1. Seat provisioning for every congregation (0068 sections 8c and 9).
insert into groups (organization_id, group_type_id, name, membership_source,
                    derived_from, is_protected)
select o.id, gt.id, 'Board of Deacons Moderator', 'derived', 'deacons_moderator', true
  from organizations o
  join group_types gt on gt.key = 'roster'
 where o.organization_type = 'congregation'
on conflict (organization_id, derived_from) do nothing;

-- Separate statements per row (0068 P3-7): the binding guard must see the
-- role row the previous statement inserted.
do $$
declare
  v_org     record;
  v_role_id uuid;
begin
  for v_org in
    select o.id as organization_id, g.id as group_id
      from organizations o
      join groups g on g.organization_id = o.id
                   and g.derived_from = 'deacons_moderator'
                   and g.membership_source = 'derived'
     where o.organization_type = 'congregation'
       and not exists (select 1 from app_roles r
                        where r.organization_id = o.id and r.key = 'deacons_moderator')
     order by o.id
  loop
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (v_org.organization_id, 'deacons_moderator',
            'Moderator of the Board of Deacons', 'constitutional', true)
    returning id into v_role_id;

    insert into app_role_permissions (role_id, permission_key)
    values (v_role_id, 'parishes.assign');

    insert into role_grants (organization_id, role_id, group_id, starts_on,
                             granted_by, grant_reason)
    values (v_org.organization_id, v_role_id, v_org.group_id, current_date, null,
            'Baseline Moderator of the Board of Deacons role: parishes.assign for the recorded seat (drizzle/0068, DECISION-242)');
  end loop;
end $$;

-- 2. Alder Creek's seat holder.
insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values ('e0000000-0000-0000-0000-0000000000f6', 'moderator.fixture@example.invalid',
        'Fixture Deacons Moderator', now(),
        '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2',
        true, false)
on conflict (id) do nothing;

update people
   set user_id = 'e0000000-0000-0000-0000-0000000000f6'
 where id = 'c0000000-0000-0000-0000-000000000008' -- Wren Thackeray
   and user_id is null;

-- The trigger materialises this into the seat group (0068 section 8a).
insert into officer_terms (id, organization_id, person_id, office, starts_on)
select 'e0680000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
       'c0000000-0000-0000-0000-000000000008', -- Wren Thackeray
       'deacons_moderator', '2026-09-01'
 where not exists (select 1 from officer_terms
                    where id = 'e0680000-0000-0000-0000-000000000001');

-- 3. East District, two member households, then archived.
insert into org_units (id, organization_id, unit_type, name)
values ('a0680000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        'district', 'East District')
on conflict (id) do nothing;

insert into people (id, first_name, last_name, date_of_birth) values
  ('c0680000-0000-0000-0000-000000000001', 'Isolde', 'Marchbank',  '1976-02-19'),
  ('c0680000-0000-0000-0000-000000000002', 'Corwin', 'Ashgrove',   '1963-07-08'),
  ('c0680000-0000-0000-0000-000000000003', 'Linnea', 'Brackwater', '1995-12-01')
on conflict (id) do nothing;

insert into households (id, organization_id, name, is_giving_unit, org_unit_id)
select v.id::uuid, '22222222-2222-2222-2222-222222222222', v.name, v.giving, v.unit::uuid
  from (values
    ('d0680000-0000-0000-0000-000000000001', 'The Marchbank Family',   true,  'a0680000-0000-0000-0000-000000000001'),
    ('d0680000-0000-0000-0000-000000000002', 'The Ashgrove Family',    true,  'a0680000-0000-0000-0000-000000000001'),
    ('d0680000-0000-0000-0000-000000000003', 'The Brackwater Household', false, null)
  ) as v(id, name, giving, unit)
 where not exists (select 1 from households h where h.id = v.id::uuid);

insert into memberships (organization_id, person_id, household_id, household_role, engagement_status, current_roll, current_roll_since)
select '22222222-2222-2222-2222-222222222222', v.person::uuid, v.household::uuid, 'head',
       v.engagement, v.roll, v.since::date
  from (values
    ('c0680000-0000-0000-0000-000000000001', 'd0680000-0000-0000-0000-000000000001', 'regular', 'active', '2021-04-11'),
    ('c0680000-0000-0000-0000-000000000002', 'd0680000-0000-0000-0000-000000000002', 'regular', 'active', '2023-10-01'),
    ('c0680000-0000-0000-0000-000000000003', 'd0680000-0000-0000-0000-000000000003', 'visitor', null,     null)
  ) as v(person, household, engagement, roll, since)
 where not exists (select 1 from memberships m
                    where m.person_id = v.person::uuid
                      and m.organization_id = '22222222-2222-2222-2222-222222222222');

insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, age_at_action, approval_status, minute_reference, approved_on)
select '22222222-2222-2222-2222-222222222222', v.person::uuid, 'opening_balance', v.since::date,
       'active', v.age, 'approved', 'Imported baseline', v.since::date
  from (values
    ('c0680000-0000-0000-0000-000000000001', '2021-04-11', 45),
    ('c0680000-0000-0000-0000-000000000002', '2023-10-01', 60)
  ) as v(person, since, age)
 where not exists (select 1 from roll_actions ra
                    where ra.person_id = v.person::uuid
                      and ra.organization_id = '22222222-2222-2222-2222-222222222222'
                      and ra.kind = 'opening_balance');

update org_units
   set archived_at = '2026-10-01 00:00:00+00'
 where id = 'a0680000-0000-0000-0000-000000000001'
   and archived_at is null;

commit;
