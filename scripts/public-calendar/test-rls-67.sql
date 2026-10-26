-- ---------------------------------------------------------------------------
-- 67. Public events calendar (drizzle/0067_presby_public_events_calendar.sql;
--     DECISION-238, DECISION-241; F251, F254, F256; docs/work-log/
--     2026-10-25-public-events-calendar.md Phase 2 R1/R2, Phase 3 T1).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains its section-67 banner
--     and ONE include at its end (staged as
--     scripts/public-calendar/test-rls.sql.integration.patch):
--
--         \ir public-calendar/test-rls-67.sql
--
--     Standalone (MUST be presby_app - the owner bypasses RLS and holds every
--     privilege by ownership, so as the owner most of this proves nothing):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/public-calendar/test-rls-67.sql
--
--     after scripts/install-test-helpers.sql (owner), scripts/seed-dev.sql and
--     scripts/public-calendar/seed-dev-public-calendar.sql (owner): Fernwood
--     with a LIVE site and the toggle on; Alder Creek with the toggle on and
--     its `provisioning` site. Every block that writes ends in rollback, so it
--     writes nothing durable. Positive and window-edge cases use rows inserted
--     here, dated from the clock at run time; the fixture's own events are
--     only asserted ABSENT (true on any date).
--
--     What presby_app CANNOT reach is proven in Vitest,
--     src/lib/public-calendar.db.test.ts: an inactive organization (no
--     UPDATE on organizations), both cross-tenant directions with two LIVE
--     sites (no grant on organization_sites), the read-time is_public veto
--     with the CHECK dropped (DDL), the 400-row truncation, the org zone,
--     contact_phone (organization_profiles.updated_by needs a users row) and
--     the driver returning events_json as an array.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P67_ALDER      '\'22222222-2222-2222-2222-222222222222\''
\set P67_FERN       '\'55555555-5555-5555-5555-555555555555\''
\set P67_KEYS       '\'{description,ends_at,location,starts_at,title,type_color,type_name}\''

\echo '======================================================'
\echo ' Section 67 (public events calendar, drizzle/0067) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '67: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- The fixture this section depends on, stated rather than assumed.
select assert_eq((select count(*) from presby_published_site('fernwood')), 1,
  '67: fixture - Fernwood has a live site (scripts/public-calendar/seed-dev-public-calendar.sql)');
select assert_eq((select count(*) from presby_published_site('alder-creek')), 0,
  '67: fixture - Alder Creek''s site is still provisioning');
begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  select assert_eq((select count(*) from organization_feature_toggles
                     where feature_key = 'org_portal.public_calendar' and enabled), 1,
    '67: fixture - Fernwood''s org_portal.public_calendar toggle is on');
  select assert_eq((select count(*) from organization_feature_toggles
                     where feature_key = 'org_portal.calendar' and enabled), 1,
    '67: fixture - Fernwood''s org_portal.calendar toggle is on (0054 provisioned it)');
  select set_config('app.current_org_id', :P67_ALDER, true);
  select assert_eq((select count(*) from organization_feature_toggles
                     where feature_key = 'org_portal.public_calendar' and enabled), 1,
    '67: fixture - Alder Creek''s org_portal.public_calendar toggle is on');
rollback;
select assert_eq((select count(*) from feature_flags where key = 'org_portal.feature_categories' and not enabled), 1,
  '67: precondition - the category axis flag is off at rest (blocks below turn it on inside a rollback)');

-- ===========================================================================
-- (a) Structure: the column, the CHECK, RLS on events, the definer's shape
--     and its ACL, read from the catalog (F38/F152: the branch, not the DDL).
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'events' and column_name = 'website_listed'
        and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    1, '67a (R1): events.website_listed is boolean NOT NULL default false');
  select assert_eq(
    (select count(*) from pg_constraint
      where conrelid = 'events'::regclass and conname = 'events_website_requires_public'
        and contype = 'c' and convalidated
        and pg_get_constraintdef(oid) = 'CHECK (((NOT website_listed) OR is_public))'),
    1, '67a (R1): events_website_requires_public is VALIDATED and reads "not website_listed or is_public"');
  select assert_eq(
    (select count(*) from pg_class where relname = 'events' and relrowsecurity and relforcerowsecurity),
    1, '67a (F1): events is still ENABLE + FORCE row level security');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'events'),
    1, '67a: events still carries exactly one policy (no policy added by 0067)');
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_public_events_calendar'),
    1, '67a: exactly one presby_public_events_calendar (no stray overload)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_events_calendar(text)'::regprocedure
        and p.prosecdef and p.provolatile = 's'
        and p.proconfig = array['search_path=public, pg_temp']
        and p.proowner = (select oid from pg_roles where rolname = 'neondb_owner')),
    1, '67a (F26, DECISION-148): SECURITY DEFINER, STABLE, search_path pinned to public, pg_temp, owned by the owner');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_events_calendar(text)'::regprocedure
        and pg_get_function_result(p.oid) = 'TABLE(state text, org_today text, first_month text, last_month text, truncated boolean, member_calendar_on boolean, contact_phone text, events_json jsonb)'),
    1, '67a (R2): the eight OUT columns, names and types, in order');
  -- A NULL proacl is the implicit default - EXECUTE to PUBLIC - so it fails here.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_events_calendar(text)'::regprocedure and p.proacl is not null
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
    1, '67a (R2): PUBLIC holds no EXECUTE (the ACL is explicit and has no PUBLIC entry)');
  select assert_eq(
    (select count(*) from pg_proc p, aclexplode(p.proacl) a
      where p.oid = 'presby_public_events_calendar(text)'::regprocedure),
    2, '67a (R2): the ACL has exactly two entries - the owner and presby_app');
  select assert_eq(
    (case when has_function_privilege('presby_app', 'presby_public_events_calendar(text)', 'execute') then 1 else 0 end)
    + (case when has_function_privilege('presby_platform', 'presby_public_events_calendar(text)', 'execute') then 10 else 0 end)
    + (case when has_function_privilege('public', 'presby_public_events_calendar(text)', 'execute') then 100 else 0 end),
    1, '67a (R2): EXECUTE - presby_app yes, presby_platform no, PUBLIC no');
rollback;

-- ===========================================================================
-- (b) The CHECK as presby_app (R1, F251).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  do $$
  begin
    insert into events (organization_id, title, starts_at, is_public, website_listed)
    values ('55555555-5555-5555-5555-555555555555', 'P67 listed members-only', now()::timestamp, false, true);
    raise exception 'FAIL 67b - presby_app inserted a listed members-only event';
  exception when check_violation then
    raise notice 'pass  67b (R1): INSERT of website_listed = true with is_public = false is refused (events_website_requires_public)';
  end $$;
  insert into events (id, organization_id, title, starts_at)
  values ('a6700000-0000-4000-8000-0000000000b1', :P67_FERN, 'P67 default', now()::timestamp);
  select assert_eq(
    (select count(*) from events where id = 'a6700000-0000-4000-8000-0000000000b1' and not website_listed and is_public),
    1, '67b (G1): an insert that does not name website_listed is NOT on the website (default false)');
  insert into events (id, organization_id, title, starts_at, is_public, website_listed)
  values ('a6700000-0000-4000-8000-0000000000b2', :P67_FERN, 'P67 listed', now()::timestamp, true, true);
  select assert_eq((select count(*) from events where id = 'a6700000-0000-4000-8000-0000000000b2' and website_listed), 1,
    '67b: a listed event open to everyone is accepted');
  do $$
  begin
    update events set is_public = false where id = 'a6700000-0000-4000-8000-0000000000b2';
    raise exception 'FAIL 67b - presby_app made a listed event members-only without clearing the listing';
  exception when check_violation then
    raise notice 'pass  67b (R1, F251): UPDATE making a listed event members-only, listing left on, is refused';
  end $$;
  insert into events (id, organization_id, title, starts_at, is_public)
  values ('a6700000-0000-4000-8000-0000000000b3', :P67_FERN, 'P67 members only', now()::timestamp, false);
  do $$
  begin
    update events set website_listed = true where id = 'a6700000-0000-4000-8000-0000000000b3';
    raise exception 'FAIL 67b - presby_app listed a members-only event by update';
  exception when check_violation then
    raise notice 'pass  67b (R1): UPDATE setting website_listed = true on a members-only row is refused';
  end $$;
  update events set is_public = false, website_listed = false where id = 'a6700000-0000-4000-8000-0000000000b2';
  select assert_eq(
    (select count(*) from events where id = 'a6700000-0000-4000-8000-0000000000b2' and not is_public and not website_listed),
    1, '67b (F251): making a listed event members-only AND clearing the listing in one UPDATE is accepted');
rollback;

-- ===========================================================================
-- (c) Every non-serving reason is the SAME single row (R2, DECISION-154).
--     The reference row is an unknown slug's.
-- ===========================================================================
select (c)::text as p67_unavail from presby_public_events_calendar('no-such-congregation') c \gset
select assert_eq((select count(*) where :'p67_unavail' = '(unavailable,,,,,,,)'), 1,
  '67c (R2): an unknown slug returns state unavailable with every other column null');
select assert_eq((select count(*) from presby_public_events_calendar('no-such-congregation')), 1,
  '67c (R2): ...as exactly one row');

begin;
  select assert_eq((select count(*) from presby_public_events_calendar('') c where (c)::text = :'p67_unavail'), 1,
    '67c: an empty slug is the same row');
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood'' or ''1''=''1') c where (c)::text = :'p67_unavail'), 1,
    '67c: a quote-bearing slug is the same row (a parameter, never interpolated)');
  select assert_eq((select count(*) from presby_public_events_calendar('FERNWOOD') c where (c)::text = :'p67_unavail'), 1,
    '67c: the slug is matched exactly (an upper-case variant is unknown)');
  select assert_eq((select count(*) from presby_public_events_calendar('quillhaven') c where (c)::text = :'p67_unavail'), 1,
    '67c: an unmanaged organization with no site is the same row');
  select assert_eq((select count(*) from presby_public_events_calendar('northern-reach') c where (c)::text = :'p67_unavail'), 1,
    '67c: a presbytery with no site is the same row');

  -- Site not live: Alder Creek has the toggle on and a listed event in the window.
  select set_config('app.current_org_id', :P67_ALDER, true);
  insert into events (organization_id, title, starts_at, website_listed)
  values (:P67_ALDER, 'P67 alder listed', (now() at time zone 'America/New_York')::timestamp, true);
  select assert_eq((select count(*) from presby_public_events_calendar('alder-creek') c where (c)::text = :'p67_unavail'), 1,
    '67c (R2 gate 2): a provisioning site, toggle on, listed event in window - the same row');
rollback;

begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') where state = 'available'), 1,
    '67c: control - Fernwood (live, toggle on) is available');
  update organization_feature_toggles set enabled = false where feature_key = 'org_portal.public_calendar';
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') c where (c)::text = :'p67_unavail'), 1,
    '67c (R2 gate 3): the toggle row OFF - the same row');
  delete from organization_feature_toggles where feature_key = 'org_portal.public_calendar';
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') c where (c)::text = :'p67_unavail'), 1,
    '67c (R2 gate 3, DECISION-097): the toggle row MISSING - the same row (missing is off)');
rollback;

-- The category axis, composed as orgFeatureEnabledInTx composes it.
begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:P67_FERN, 'worship', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') where state = 'available'), 1,
    '67c (axis): worship OFF while the axis flag is OFF - still available (the axis is inert)');
  update feature_flags set enabled = true where key = 'org_portal.feature_categories';
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') c where (c)::text = :'p67_unavail'), 1,
    '67c (axis, Phase 2 R2): axis ON and worship OFF - the same unavailable row');
  update organization_feature_categories set enabled = true where category = 'worship';
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') where state = 'available'), 1,
    '67c (axis): axis ON and worship ON - available');
  delete from organization_feature_categories where category = 'worship';
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') where state = 'available'), 1,
    '67c (axis): axis ON and the worship row MISSING - available (a missing category row is on)');
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:P67_FERN, 'giving', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') where state = 'available'), 1,
    '67c (axis): axis ON and a DIFFERENT category off - available (only worship gates it)');
rollback;
select assert_eq((select count(*) from feature_flags where key = 'org_portal.feature_categories' and not enabled), 1,
  '67c: the axis flag is back off after the rollback');

-- ===========================================================================
-- (d) The available path: what appears, what never does, the window edges,
--     the row's other columns. Rows dated from the clock now, in Fernwood's
--     zone (America/New_York; asserted, not assumed).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  select assert_eq((select count(*) from organization_settings where time_zone <> 'America/New_York'), 0,
    '67d: precondition - Fernwood''s zone is America/New_York (its settings row, or the default without one)');
  with w as (
    select date_trunc('month', now() at time zone 'America/New_York') - interval '1 month'  as first_day,
           date_trunc('month', now() at time zone 'America/New_York') + interval '13 months' as after_day,
           date_trunc('month', now() at time zone 'America/New_York')                        as this_month
  )
  insert into events (organization_id, title, description, location, starts_at, ends_at,
                      is_public, website_listed, cancelled_at, event_type_id)
  select :P67_FERN, v.title, v.descr, v.loc, v.starts, v.ends, v.pub, v.listed, v.cancelled, v.type_id
    from w, lateral (values
      ('P67 listed',       e'Line one\nLine two', 'Hall', w.this_month + interval '10 days 10 hours',
                           w.this_month + interval '10 days 11 hours 30 minutes', true, true, null::timestamptz,
                           null::uuid),
      ('P67 typed',        null, null, w.this_month + interval '11 days 9 hours', null::timestamp, true, true, null,
                           (select t.id from event_types t where t.name = 'Music' and not t.is_fallback)),
      ('P67 first edge',   null, null, w.first_day, null, true, true, null, null),
      ('P67 last edge',    null, null, w.after_day - interval '1 minute', null, true, true, null, null),
      ('P67 before',       null, null, w.first_day - interval '1 minute', null, true, true, null, null),
      ('P67 after',        null, null, w.after_day, null, true, true, null, null),
      ('P67 unlisted',     null, null, w.this_month + interval '12 days', null, true, false, null, null),
      ('P67 members only', null, null, w.this_month + interval '13 days', null, false, false, null, null),
      ('P67 cancelled',    null, null, w.this_month + interval '14 days', null, true, true, now(), null)
    ) as v(title, descr, loc, starts, ends, pub, listed, cancelled, type_id);

  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood')),
    1, '67d (R2): exactly one row');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c
      where c.state = 'available'
        and c.org_today   = to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD')
        and c.first_month = to_char(date_trunc('month', now() at time zone 'America/New_York') - interval '1 month', 'YYYY-MM')
        and c.last_month  = to_char(date_trunc('month', now() at time zone 'America/New_York') + interval '12 months', 'YYYY-MM')
        and c.truncated = false and c.member_calendar_on = true and c.contact_phone is null
        and jsonb_typeof(c.events_json) = 'array'),
    1, '67d (R2, R3): available; org_today in the org zone; window previous month through +12; not truncated; member calendar on; no phone; events_json an array');

  -- What appears.
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' in ('P67 listed', 'P67 typed', 'P67 first edge', 'P67 last edge')),
    4, '67d: listed, open-to-everyone, uncancelled rows in the window appear - including both window edges');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c
      where c.events_json->0->>'title' = 'P67 first edge'
        and c.events_json->-1->>'title' = 'P67 last edge'),
    1, '67d (R3): the first instant of the window is the first element and the last minute the last (ordered by starts_at)');
  -- What never appears.
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' in ('P67 before', 'P67 after', 'P67 unlisted', 'P67 members only', 'P67 cancelled')),
    0, '67d (G1, G12, R3): outside the window, unlisted, members-only and cancelled rows never appear');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' in ('Building committee', 'Session stated meeting (members only)',
                            'Bake sale (cancelled)', 'Anniversary service (far future)')),
    0, '67d: the fixture''s unlisted, members-only, cancelled and far-future rows never appear');

  -- The projection: an allow-list of seven named keys, no ids (G5).
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where (select array_agg(k order by k) from jsonb_object_keys(e) k) <> (:P67_KEYS)::text[]),
    0, '67d (G5, R2): every element has EXACTLY title, starts_at, ends_at, location, description, type_name, type_color');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c
      where c.events_json::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
    0, '67d (G5): no uuid-shaped string anywhere in events_json (no event, type or org id)');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' = 'P67 listed'
        and e->>'starts_at' = to_char(date_trunc('month', now() at time zone 'America/New_York') + interval '10 days 10 hours', 'YYYY-MM-DD"T"HH24:MI')
        and e->>'ends_at'   = to_char(date_trunc('month', now() at time zone 'America/New_York') + interval '10 days 11 hours 30 minutes', 'YYYY-MM-DD"T"HH24:MI')
        and e->>'location' = 'Hall' and e->>'description' = e'Line one\nLine two'
        and e->>'type_name' = 'General' and e->>'type_color' = 'neutral'),
    1, '67d (check:sql-date, G13): wall-clock YYYY-MM-DDTHH:MI text, location and multi-line description verbatim, an untyped event shows as the fallback type');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' = 'P67 typed' and e->>'type_name' = 'Music' and e->>'type_color' = 'fuchsia'
        and jsonb_typeof(e->'ends_at') = 'null' and jsonb_typeof(e->'location') = 'null'
        and jsonb_typeof(e->'description') = 'null'),
    1, '67d: a typed event carries its own type''s name and colour; absent fields are JSON null, keys still present');

  -- The read ignores the caller's org GUC: the same answer under another org's
  -- GUC (it is keyed by slug alone, and the anonymous caller sets none).
  select (c)::text as p67_under_fern from presby_public_events_calendar('fernwood') c \gset
  select set_config('app.current_org_id', :P67_ALDER, true);
  select assert_eq((select count(*) from presby_public_events_calendar('fernwood') c where (c)::text = :'p67_under_fern'), 1,
    '67d: the answer does not depend on the caller''s org GUC');
rollback;

-- No GUC at all, exactly as the anonymous page calls it.
begin;
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') where state = 'available'),
    1, '67d: with NO org GUC set (the anonymous caller), Fernwood is available');
rollback;

-- ===========================================================================
-- (e) Clipping (F256): the table has no length CHECK, so the definer clips.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  insert into events (organization_id, title, description, location, starts_at, website_listed)
  values (:P67_FERN, 'P67clip' || repeat('T', 300), repeat('D', 2500), repeat('L', 300),
          date_trunc('month', now() at time zone 'America/New_York') + interval '5 days', true);
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' like 'P67clip%'
        and char_length(e->>'title') = 200 and char_length(e->>'location') = 200
        and char_length(e->>'description') = 2000),
    1, '67e (F256): title and location clipped to 200 characters, description to 2000');
rollback;

-- ===========================================================================
-- (f) Cross-tenant: Alder's listed rows never appear under Fernwood's slug.
--     (The other direction needs a second LIVE site - Vitest.)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P67_ALDER, true);
  insert into events (organization_id, title, starts_at, website_listed)
  values (:P67_ALDER, 'P67 alder listed', date_trunc('month', now() at time zone 'America/New_York') + interval '3 days', true);
  select set_config('app.current_org_id', :P67_FERN, true);
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' = 'P67 alder listed'),
    0, '67f (Composite Tenant Keys, R2): another organization''s listed event never appears under this slug');
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') c, jsonb_array_elements(c.events_json) e
      where e->>'title' in ('Fellowship supper', 'Session stated meeting', 'Congregational picnic')),
    0, '67f: none of Alder Creek''s seeded events appears under Fernwood either');
rollback;

-- ===========================================================================
-- (g) member_calendar_on follows org_portal.calendar (G7), composed the same
--     way; it never changes whether the calendar itself is available.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P67_FERN, true);
  update organization_feature_toggles set enabled = false where feature_key = 'org_portal.calendar';
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') where state = 'available' and member_calendar_on = false),
    1, '67g (G7): the member calendar toggle OFF - still available, member_calendar_on false');
  delete from organization_feature_toggles where feature_key = 'org_portal.calendar';
  select assert_eq(
    (select count(*) from presby_public_events_calendar('fernwood') where state = 'available' and member_calendar_on = false),
    1, '67g (G7): the member calendar toggle row MISSING - member_calendar_on false (missing is off)');
rollback;

\echo '======================================================'
\echo ' Section 67 (public events calendar) complete.'
\echo '======================================================'
