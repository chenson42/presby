-- scripts/worship/seed-dev-worship.sql - the worship fixture block
-- (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 Implementation Order,
-- Batch 1; drizzle/0085_presby_worship.sql).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE line, placed AFTER
-- its final `commit;` and after the other pipelines' `\ir` lines
-- (scripts/worship/seed-dev.sql.integration.patch):
--
--     \ir worship/seed-dev-worship.sql
--
-- Standalone:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/worship/seed-dev-worship.sql
--
-- Runs as the OWNER (like seed-dev.sql), in its own transaction, AFTER
-- seed-dev.sql (it uses Alder Creek's people). The owner meets every worship
-- guard (F44), so the rows are built along legal edges exactly as the store
-- will build them, and the block sets app.current_org_id to Alder Creek
-- because the guards' actor check calls the resolver, which answers only for
-- the current organization (0010).
--
-- Idempotent: every insert is `where not exists` on a fixed id (or the
-- natural key), so a re-run attempts no insert and no guard fires; every
-- status walk is an UPDATE guarded by the row's current status. A re-run
-- after the seeded services have started changes nothing and does not fail.
--
-- WHAT IS HERE (Alder Creek, 2222...):
--   Two worship teams on new MANAGED groups: "Sunday Band" (type team; Tobias
--   Renwick its `leader`, so he schedules it through the SEAT, holding no
--   worship key) and "Chancel Choir" (type choir; Aldous Fennimore its
--   `chair`). Positions from the design's starter sets. Who can fill what.
--   A service type "Sunday worship" (10:00, 75 minutes, Sanctuary, both
--   teams). Two services on the next two Sundays at 10:00 in the
--   organization's zone (events rows typed with the organization's "Worship"
--   event type if it has one, members-only on the calendar, not listed on the
--   website), dated when this file first runs; a re-run does not move them.
--   On the first Sunday, one assignment in each state a browser walk needs:
--     Wren Thackeray, Vocals    - requested (emailed); Wren can sign in and answer
--     Marisol Windham, Keys     - confirmed, recorded on her behalf by the leader
--     Priya Balakrishnan, Bass  - draft (not sent yet)
--     Marguerite Ashcombe, Alto - declined by herself, reason "family"
--     Hallie Vandermeer, Soprano - requested, outcome "guardian" (presumed
--                                  minor: no email of any kind)
--     a guest, "Visiting Guitarist", Acoustic guitar - confirmed at placement
--   On the second Sunday, Wren's Vocals draft. One blockout for Wren, the
--   third and fourth Sundays out, reason "away".
--
-- WHAT IS NOT HERE, ON PURPOSE:
--   * The org_portal.worship toggle stays OFF (provisioned off, as in
--     production). Turn it on under Administration -> Features, or:
--       insert into organization_feature_toggles (organization_id, feature_key, enabled)
--       values ('22222222-2222-2222-2222-222222222222', 'org_portal.worship', true)
--       on conflict (organization_id, feature_key) do update set enabled = true;
--     scripts/worship/test-rls-85.sql reads none of these rows and clears
--     the toggle inside its own rolled-back blocks.
--   * No worship key is granted to anyone: the founding_administrator bundle
--     (and its backfill) is the only key path, and Alder Creek's fixture has
--     no founding_administrator role. The seat is the authority here.
--   * Nothing at Bramblewood (section 27 of test-rls.sql asserts it has no
--     events) and nothing at Fernwood or Marrowbone.
--   * No audit row (fixture provisioning) and no email_queue row.
--
-- Fixed ids use the prefix a8500000-0000-4000-8000- (0085). The e2e fixture
-- (e2e/support/worship-fixture.ts, Batch 6) uses its own person-id range,
-- 00000000-0000-4085-.
--
-- No Real Data: the people are seed-dev.sql's invented congregation; the
-- guest is a role, not a name; no address anywhere.

begin;

do $$
declare
  c_org     constant uuid := '22222222-2222-2222-2222-222222222222';
  -- people (scripts/seed-dev.sql)
  c_tobias  constant uuid := 'c0000000-0000-0000-0000-000000000002';
  c_aldous  constant uuid := 'c0000000-0000-0000-0000-000000000007';
  c_marg    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  c_priya   constant uuid := 'c0000000-0000-0000-0000-000000000003';
  c_hallie  constant uuid := 'c0000000-0000-0000-0000-000000000005';
  c_wren    constant uuid := 'c0000000-0000-0000-0000-000000000008';
  c_marisol constant uuid := 'c0000000-0000-0000-0000-000000000009';
  -- groups / teams
  c_band    constant uuid := 'a8500000-0000-4000-8000-000000000001';
  c_choir   constant uuid := 'a8500000-0000-4000-8000-000000000002';
  -- service type, services
  c_type    constant uuid := 'a8500000-0000-4000-8000-000000000003';
  c_sun1    constant uuid := 'a8500000-0000-4000-8000-000000000004';
  c_sun2    constant uuid := 'a8500000-0000-4000-8000-000000000005';
  c_block   constant uuid := 'a8500000-0000-4000-8000-000000000006';
  v_today date;
  v_first timestamp;
  v_type_id uuid;
  r record;
begin
  -- The actor checks call the resolver, which answers only for the current
  -- organization (0010): transaction-local, like withOrgContext().
  perform set_config('app.current_org_id', c_org::text, true);

  -- 1. The two groups and their worship_teams rows.
  insert into groups (id, organization_id, group_type_id, name, description, meets_when)
  select c_band, c_org, gt.id, 'Sunday Band', 'Leads music at the Sunday service.', 'Thursdays, 7 PM'
    from group_types gt
   where gt.key = 'team'
     and not exists (select 1 from groups g where g.id = c_band);
  insert into groups (id, organization_id, group_type_id, name, description, meets_when)
  select c_choir, c_org, gt.id, 'Chancel Choir', 'Sings at the Sunday service.', 'Wednesdays, 7 PM'
    from group_types gt
   where gt.key = 'choir'
     and not exists (select 1 from groups g where g.id = c_choir);

  insert into worship_teams (group_id, organization_id)
  select t.id, c_org from (values (c_band), (c_choir)) t(id)
   where not exists (select 1 from worship_teams wt where wt.group_id = t.id);

  -- 2. Positions (fixed ids, the design's starter sets).
  for r in select * from (values
      ('a8500000-0000-4000-8000-000000000101'::uuid, c_band,  'Worship leader',  1, 10),
      ('a8500000-0000-4000-8000-000000000102'::uuid, c_band,  'Vocals',          2, 20),
      ('a8500000-0000-4000-8000-000000000103'::uuid, c_band,  'Acoustic guitar', 1, 30),
      ('a8500000-0000-4000-8000-000000000104'::uuid, c_band,  'Bass',            1, 40),
      ('a8500000-0000-4000-8000-000000000105'::uuid, c_band,  'Drums',           1, 50),
      ('a8500000-0000-4000-8000-000000000106'::uuid, c_band,  'Keys',            1, 60),
      ('a8500000-0000-4000-8000-000000000111'::uuid, c_choir, 'Director',        1, 10),
      ('a8500000-0000-4000-8000-000000000112'::uuid, c_choir, 'Accompanist',     1, 20),
      ('a8500000-0000-4000-8000-000000000113'::uuid, c_choir, 'Soprano',         4, 30),
      ('a8500000-0000-4000-8000-000000000114'::uuid, c_choir, 'Alto',            4, 40),
      ('a8500000-0000-4000-8000-000000000115'::uuid, c_choir, 'Tenor',           3, 50),
      ('a8500000-0000-4000-8000-000000000116'::uuid, c_choir, 'Bass',            3, 60)
    ) p(id, team, name, slots, sort) loop
    insert into worship_positions (id, organization_id, group_id, name, slots, sort_order)
    select r.id, c_org, r.team, r.name, r.slots, r.sort
     where not exists (select 1 from worship_positions wp where wp.id = r.id);
  end loop;

  -- 3. Rosters (open rows; the seat is a leader / chair row in date).
  for r in select * from (values
      (c_band,  c_tobias,  'leader'),
      (c_band,  c_wren,    'member'),
      (c_band,  c_marisol, 'member'),
      (c_band,  c_priya,   'member'),
      (c_choir, c_aldous,  'chair'),
      (c_choir, c_marg,    'member'),
      (c_choir, c_hallie,  'member')
    ) m(team, person, role) loop
    insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on)
    select c_org, r.team, r.person, r.role, date '2024-09-01'
     where not exists (select 1 from group_memberships gm
                        where gm.group_id = r.team and gm.person_id = r.person and gm.ends_on is null);
  end loop;

  -- 4. Who can fill what.
  for r in select * from (values
      (c_band,  'a8500000-0000-4000-8000-000000000101'::uuid, c_tobias),
      (c_band,  'a8500000-0000-4000-8000-000000000102'::uuid, c_wren),
      (c_band,  'a8500000-0000-4000-8000-000000000102'::uuid, c_marisol),
      (c_band,  'a8500000-0000-4000-8000-000000000106'::uuid, c_marisol),
      (c_band,  'a8500000-0000-4000-8000-000000000104'::uuid, c_priya),
      (c_choir, 'a8500000-0000-4000-8000-000000000111'::uuid, c_aldous),
      (c_choir, 'a8500000-0000-4000-8000-000000000114'::uuid, c_marg),
      (c_choir, 'a8500000-0000-4000-8000-000000000113'::uuid, c_hallie)
    ) qf(team, pos, person) loop
    insert into worship_position_qualifications (organization_id, group_id, position_id, person_id)
    select c_org, r.team, r.pos, r.person
     where not exists (select 1 from worship_position_qualifications q
                        where q.position_id = r.pos and q.person_id = r.person and q.ended_at is null);
  end loop;

  -- 5. The service type and its usual teams.
  insert into worship_service_types (id, organization_id, name, start_time, duration_minutes, location)
  select c_type, c_org, 'Sunday worship', time '10:00', 75, 'Sanctuary'
   where not exists (select 1 from worship_service_types st where st.id = c_type)
     and not exists (select 1 from worship_service_types st
                      where st.organization_id = c_org and lower(st.name) = 'sunday worship' and st.retired_at is null);
  if exists (select 1 from worship_service_types st where st.id = c_type) then
    insert into worship_service_type_teams (organization_id, service_type_id, group_id)
    select c_org, c_type, t.id from (values (c_band), (c_choir)) t(id)
     where not exists (select 1 from worship_service_type_teams x where x.service_type_id = c_type and x.group_id = t.id);
  end if;

  -- 6. Two services: the next two Sundays at 10:00, org-local, dated once.
  v_today := presby_worship_org_today(c_org);
  v_first := (v_today + ((7 - extract(isodow from v_today)::int) % 7))::timestamp + time '10:00';
  if v_first <= presby_worship_org_now(c_org) then
    v_first := v_first + interval '7 days';
  end if;
  select et.id into v_type_id from event_types et
   where et.organization_id = c_org and lower(et.name) = 'worship'
   order by et.id limit 1;

  insert into events (id, organization_id, title, location, starts_at, ends_at, is_public, website_listed,
                      allows_checkin, event_type_id)
  select x.id, c_org, 'Sunday worship', 'Sanctuary', x.starts, x.starts + interval '75 minutes', true, false,
         false, v_type_id
    from (values (c_sun1, v_first), (c_sun2, v_first + interval '7 days')) x(id, starts)
   where not exists (select 1 from events e where e.id = x.id);

  insert into worship_services (event_id, organization_id, service_type_id)
  select x.id, c_org, case when exists (select 1 from worship_service_types st where st.id = c_type) then c_type end
    from (values (c_sun1), (c_sun2)) x(id)
   where not exists (select 1 from worship_services ws where ws.event_id = x.id);

  insert into worship_service_teams (organization_id, event_id, group_id)
  select c_org, x.ev, x.team from (values (c_sun1, c_band), (c_sun1, c_choir), (c_sun2, c_band)) x(ev, team)
   where not exists (select 1 from worship_service_teams st where st.event_id = x.ev and st.group_id = x.team);

  -- 7. Assignments, each inserted as a draft (or a confirmed guest) by the
  --    team's seat holder, then walked along legal edges. Fixed ids.
  for r in select * from (values
      ('a8500000-0000-4000-8000-000000000201'::uuid, c_sun1, c_band,  'a8500000-0000-4000-8000-000000000102'::uuid, c_wren,    c_tobias),
      ('a8500000-0000-4000-8000-000000000202'::uuid, c_sun1, c_band,  'a8500000-0000-4000-8000-000000000106'::uuid, c_marisol, c_tobias),
      ('a8500000-0000-4000-8000-000000000203'::uuid, c_sun1, c_band,  'a8500000-0000-4000-8000-000000000104'::uuid, c_priya,   c_tobias),
      ('a8500000-0000-4000-8000-000000000204'::uuid, c_sun1, c_choir, 'a8500000-0000-4000-8000-000000000114'::uuid, c_marg,    c_aldous),
      ('a8500000-0000-4000-8000-000000000205'::uuid, c_sun1, c_choir, 'a8500000-0000-4000-8000-000000000113'::uuid, c_hallie,  c_aldous),
      ('a8500000-0000-4000-8000-000000000207'::uuid, c_sun2, c_band,  'a8500000-0000-4000-8000-000000000102'::uuid, c_wren,    c_tobias)
    ) a(id, ev, team, pos, person, placer) loop
    insert into worship_assignments (id, organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
    select r.id, c_org, r.ev, r.team, r.pos, r.person, r.placer
     where not exists (select 1 from worship_assignments wa where wa.id = r.id);
  end loop;

  insert into worship_assignments (id, organization_id, event_id, group_id, position_id, guest_name,
                                   assigned_by_person_id, status, response_source, responded_by_person_id)
  select 'a8500000-0000-4000-8000-000000000206'::uuid, c_org, c_sun1, c_band,
         'a8500000-0000-4000-8000-000000000103'::uuid, 'Visiting Guitarist', c_tobias, 'confirmed', 'on_behalf', c_tobias
   where not exists (select 1 from worship_assignments wa where wa.id = 'a8500000-0000-4000-8000-000000000206');

  -- Send (draft -> requested): Wren emailed, Hallie guardian, Marguerite emailed.
  update worship_assignments set status = 'requested', sent_by_person_id = c_tobias, notice_outcome = 'emailed'
   where id = 'a8500000-0000-4000-8000-000000000201' and status = 'draft';
  update worship_assignments set status = 'requested', sent_by_person_id = c_aldous, notice_outcome = 'guardian'
   where id = 'a8500000-0000-4000-8000-000000000205' and status = 'draft';
  update worship_assignments set status = 'requested', sent_by_person_id = c_aldous, notice_outcome = 'emailed'
   where id = 'a8500000-0000-4000-8000-000000000204' and status = 'draft';
  -- Marguerite declines for herself.
  update worship_assignments set status = 'declined', response_source = 'self', responded_by_person_id = c_marg,
                                 decline_reason = 'family'
   where id = 'a8500000-0000-4000-8000-000000000204' and status = 'requested';
  -- The leader records Marisol's yes on her behalf (straight from the draft).
  update worship_assignments set status = 'confirmed', response_source = 'on_behalf', responded_by_person_id = c_tobias
   where id = 'a8500000-0000-4000-8000-000000000202' and status = 'draft';

  -- 8. Wren's blockout: the third and fourth Sundays out.
  insert into worship_blockouts (id, organization_id, person_id, starts_on, ends_on, reason)
  select c_block, c_org, c_wren, (v_first + interval '14 days')::date, (v_first + interval '21 days')::date, 'away'
   where not exists (select 1 from worship_blockouts b where b.id = c_block);
end $$;

commit;
