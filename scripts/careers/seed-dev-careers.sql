-- scripts/careers/seed-dev-careers.sql - the careers fixture block
-- (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 Component plan;
-- drizzle/0071_presby_careers.sql).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE line, placed AFTER
-- its final `commit;` and after the other pipelines' `\ir` lines
-- (scripts/careers/seed-dev.sql.integration.patch):
--
--     \ir careers/seed-dev-careers.sql
--
-- Standalone:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/careers/seed-dev-careers.sql
--
-- Runs as the OWNER (like seed-dev.sql), in its own transaction. Idempotent:
-- every insert is `on conflict do nothing` on a fixed id or natural key, and
-- every status walk is guarded by the row's current state, so a re-run
-- changes nothing.
--
-- WHAT IS HERE
--   Fernwood (5555...) and Marrowbone (6666...): a `live` site row (repo
--     only, no bundle) and the org_portal.careers toggle ON, so
--     presby_public_careers() answers past its gate. presby_app holds no grant
--     on organization_sites (DECISION-081), so scripts/careers/test-rls-71.sql
--     cannot build a live site itself; that is the one thing it needs from
--     this file. Everything else that suite asserts it builds in a
--     rolled-back transaction of its own.
--     NOT Bramblewood: scripts/giving/test-rls-46.sql (46l, the public giving
--     config's byte-identical `absent` row) and scripts/domains/test-rls-47.sql
--     (47m, presby_current_org_site_status() reads NULL) both assume
--     Bramblewood has no site row.
--   Alder Creek (2222...): the toggle ON, its site left `provisioning`
--     (seed-dev.sql), so the gate's "site not live" branch has a fixture.
--   Postings, for the browser walk (Phase 4 Batch 3) and a fresh dev
--     database: at Fernwood one in every state - a draft, a discarded
--     draft (draft -> closed, never public), an open posting with no closing
--     date, an open posting closing on 2099-12-31, a published posting whose
--     closing date (2026-01-15) has passed (closed to the public at read
--     time; the first sweep run closes it), and a closed posting. At
--     Marrowbone one open posting whose slug equals one of Fernwood's, so
--     "organization A's posting never appears under B's slug" has a
--     same-slug fixture.
--
-- The posting walk uses the owner connection through the same guard every
-- connection meets: insert as a draft, then publish (and close) along legal
-- edges. Nothing here writes an audit row (fixture provisioning).
--
-- No Real Data: invented titles, no names, no addresses.

begin;

insert into organization_sites (organization_id, repo, status, updated_by) values
  ('55555555-5555-5555-5555-555555555555', 'presby-churches/site-fernwood', 'live', null),
  ('66666666-6666-6666-6666-666666666666', 'presby-churches/site-marrowbone',    'live', null)
on conflict (organization_id) do nothing;

insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by) values
  ('22222222-2222-2222-2222-222222222222', 'org_portal.careers', true, null),
  ('55555555-5555-5555-5555-555555555555', 'org_portal.careers', true, null),
  ('66666666-6666-6666-6666-666666666666', 'org_portal.careers', true, null)
on conflict (organization_id, feature_key) do nothing;

insert into job_postings (id, organization_id, slug, title, summary, location, employment_type,
                          pay_min_cents, pay_max_cents, pay_unit, description_md, closing_date)
values
  ('c7100000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'youth-ministry-coordinator', 'Youth Ministry Coordinator',
   'Plan and lead weekly youth gatherings and the summer mission trip.', 'Fernwood campus',
   'part_time', 1800, 2400, 'hour',
   E'## About the role\n\nWe are looking for someone to walk alongside our middle and high school students.\n\n## What you will do\n\n- Lead Sunday evening youth group\n- Plan the summer mission trip\n- Recruit and support adult volunteers\n\nQuestions? Write to [the office](mailto:office@example.invalid).',
   null),
  ('c7100000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
   'music-director', 'Music Director',
   'Direct the chancel choir and coordinate music for Sunday worship.', 'Fernwood sanctuary',
   'part_time', 2500000, 3200000, 'year',
   E'## About the role\n\nThe Music Director leads the **chancel choir** and plans music for worship with the pastor.\n\n## Requirements\n\n1. Choral conducting experience\n2. Keyboard skills\n3. A collaborative spirit',
   date '2099-12-31'),
  ('c7100000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555',
   'office-assistant', 'Office Assistant',
   'Answer the phone, keep the calendar and prepare the weekly bulletin.', 'Church office',
   'part_time', null, null, null,
   E'## About the role\n\nA friendly first point of contact for the congregation and visitors.',
   null),
  ('c7100000-0000-0000-0000-000000000004', '55555555-5555-5555-5555-555555555555',
   'summer-intern', 'Summer Intern',
   'Ten weeks helping with vacation Bible school and community meals.', 'Fernwood campus',
   'intern', 1500, 1500, 'hour',
   E'## About the role\n\nA summer of service for a college student.',
   null),
  ('c7100000-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555',
   'custodian', 'Custodian',
   'Care for the building and grounds.', 'Fernwood campus',
   'full_time', null, null, null,
   E'## About the role\n\nKeep our building clean, safe and welcoming.',
   null),
  ('c7100000-0000-0000-0000-000000000006', '55555555-5555-5555-5555-555555555555',
   'nursery-attendant', 'Nursery Attendant (draft)',
   '', '', 'part_time', null, null, null, '', null),
  ('c7100000-0000-0000-0000-000000000007', '55555555-5555-5555-5555-555555555555',
   'bookkeeper', 'Bookkeeper (discarded draft)',
   '', '', 'part_time', null, null, null, '', null),
  ('c7100000-0000-0000-0000-000000000008', '66666666-6666-6666-6666-666666666666',
   'music-director', 'Music Director',
   'Lead music for Sunday worship at Marrowbone.', 'Marrowbone sanctuary',
   'part_time', null, null, null,
   E'## About the role\n\nMarrowbone is looking for a part-time music director.',
   null)
on conflict (id) do nothing;

-- Publish (draft -> published): the guard stamps first_published_at,
-- posted_on and the top-of-list sort_order.
update job_postings set status = 'published'
 where id in ('c7100000-0000-0000-0000-000000000001', 'c7100000-0000-0000-0000-000000000002',
              'c7100000-0000-0000-0000-000000000003', 'c7100000-0000-0000-0000-000000000004',
              'c7100000-0000-0000-0000-000000000005', 'c7100000-0000-0000-0000-000000000008')
   and status = 'draft';

-- A published posting whose closing date has passed: publishing with a past
-- date is refused, so the date is set after publishing (a legal edit). Only
-- while it is still unset, so a re-run (or a sweep that already closed it)
-- changes nothing.
update job_postings set closing_date = date '2026-01-15'
 where id = 'c7100000-0000-0000-0000-000000000003' and closing_date is null;

-- Closed (published -> closed) and discarded (draft -> closed).
update job_postings set status = 'closed'
 where id = 'c7100000-0000-0000-0000-000000000004' and status = 'published';
update job_postings set status = 'closed'
 where id = 'c7100000-0000-0000-0000-000000000007' and status = 'draft';

commit;
