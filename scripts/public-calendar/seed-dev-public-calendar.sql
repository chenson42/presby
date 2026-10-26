-- ---------------------------------------------------------------------------
-- Public events calendar dev fixture (drizzle/0067_presby_public_events_
-- calendar.sql; docs/work-log/2026-10-25-public-events-calendar.md, Phase 3
-- "Component / Page Plan", Phase 4 Batch 1).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE include at its end
-- (staged as scripts/public-calendar/seed-dev.sql.integration.patch):
--
--     \ir public-calendar/seed-dev-public-calendar.sql
--
-- Until then, standalone, AS THE OWNER (presby_app has no grant on
-- organization_sites, which is why this is a fixture and not a suite step),
-- after drizzle/0067:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/public-calendar/seed-dev-public-calendar.sql
--
-- scripts/public-calendar/test-rls-67.sql NEEDS this fixture.
--
-- WHY FERNWOOD ONLY (a Phase 4 deviation from the design's "Bramblewood and
-- Fernwood"): scripts/giving/test-rls-46.sql section 46l asserts that
-- presby_public_giving_config('bramblewood') is byte-identical to an unknown
-- slug's `absent` row. A live site turns that row into `unavailable`, so a
-- live Bramblewood site would break section 46. Fernwood carries no
-- site-state assertion anywhere (grepped scripts/ and e2e/), and Alder Creek
-- must stay `provisioning` (sections 16 and 47 assert it). The suite's second
-- live organization, for the both-directions cross-tenant case, lives in
-- src/lib/public-calendar.db.test.ts (throwaway orgs stamped
-- deletable_until), not here.
--
-- What it adds:
--   Fernwood (55555555-...): a `live` organization_sites row with no content
--     bundle; the org_portal.public_calendar toggle ON; six demo events, one
--     per case the definer must decide, dated RELATIVE TO THE DAY THIS FILE
--     RUNS (in Fernwood's zone) so the calendar has something to show in dev:
--       listed, this month         (appears)
--       listed, next month         (appears)
--       unlisted, open to everyone (never appears)
--       members-only, unlisted     (never appears; the CHECK forbids listed)
--       listed but cancelled       (never appears)
--       listed, 15 months ahead    (outside the window: never appears)
--     The suite asserts only that the four "never" rows stay out (true on
--     any date); its positive and edge cases use rows it inserts itself
--     inside rolled-back transactions, so fixture dates drifting with time
--     cannot move an assertion.
--   Alder Creek (22222222-...): the org_portal.public_calendar toggle ON, and
--     nothing else: its site stays `provisioning`, the "site not live" case.
--     No Alder events are added (sections 27 and 45 count Alder's events).
--
-- Idempotent: fixed ids and `on conflict do nothing`. Synthetic data only
-- (No Real Data): invented titles and places, no people.
-- ---------------------------------------------------------------------------
begin;

insert into organization_sites (organization_id, repo, status, updated_by)
values ('55555555-5555-5555-5555-555555555555', 'presby-churches/site-fernwood', 'live', null)
on conflict (organization_id) do nothing;

insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
values ('55555555-5555-5555-5555-555555555555', 'org_portal.public_calendar', true, null),
       ('22222222-2222-2222-2222-222222222222', 'org_portal.public_calendar', true, null)
on conflict (organization_id, feature_key) do nothing;

-- Fernwood's "this month" in its own zone (America/New_York when it has no
-- settings row, as the definer reads it).
with base as (
  select date_trunc('month',
           now() at time zone coalesce(
             (select st.time_zone from organization_settings st
               where st.organization_id = '55555555-5555-5555-5555-555555555555'),
             'America/New_York')) as m
)
insert into events (id, organization_id, title, description, location, starts_at, ends_at,
                    is_public, website_listed, cancelled_at)
select v.id, '55555555-5555-5555-5555-555555555555', v.title, v.description, v.location,
       base.m + v.starts, base.m + v.ends, v.is_public, v.listed,
       case when v.cancelled then now() end
  from base, (values
    ('a6700000-0000-4000-8000-000000000001'::uuid, 'Harvest supper',
     'A shared meal in the fellowship hall. Bring a dish if you can.', 'Fellowship Hall',
     interval '20 days 18 hours', interval '20 days 20 hours', true, true, false),
    ('a6700000-0000-4000-8000-000000000002'::uuid, 'Hymn sing',
     'An evening of favourite hymns with the choir.', 'Sanctuary',
     interval '1 month 9 days 19 hours', interval '1 month 9 days 20 hours 30 minutes', true, true, false),
    ('a6700000-0000-4000-8000-000000000003'::uuid, 'Building committee',
     null, 'Library',
     interval '12 days 19 hours', null, true, false, false),
    ('a6700000-0000-4000-8000-000000000004'::uuid, 'Session stated meeting (members only)',
     null, 'Library',
     interval '14 days 19 hours', null, false, false, false),
    ('a6700000-0000-4000-8000-000000000005'::uuid, 'Bake sale (cancelled)',
     null, 'Fellowship Hall',
     interval '16 days 9 hours', null, true, true, true),
    ('a6700000-0000-4000-8000-000000000006'::uuid, 'Anniversary service (far future)',
     null, 'Sanctuary',
     interval '15 months 10 hours', null, true, true, false)
  ) as v(id, title, description, location, starts, ends, is_public, listed, cancelled)
on conflict (id) do nothing;

commit;
