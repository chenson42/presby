-- drizzle/0067_presby_public_events_calendar.sql
--
-- The public events calendar (events Increment 4): a per-event, default-off
-- website switch tied to is_public, and the one anonymous SECURITY DEFINER
-- read that a congregation's public site calls to render its calendar
-- (docs/work-log/2026-10-25-public-events-calendar.md, Phase 2 R1/R2/R3,
-- Phase 3 "Data Model" and "API Contract"; DECISION-238, DECISION-241;
-- findings F250-F256).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0067_presby_public_events_calendar.sql
--
-- DEPLOY ORDER: apply this file FIRST, then deploy the application code. The
-- new code selects events.website_listed and calls the new function. The OLD
-- code against the NEW schema is unaffected: it never names the column, the
-- column defaults to false, and the CHECK only binds a row whose
-- website_listed is true, which old code cannot write.
--
-- Additive only. No new table, no new RLS policy, no new table grant: the
-- column is covered by events' existing grants and its existing FORCE RLS
-- tenant_isolation policy. No backfill statement: `add column ... not null
-- default false` puts every existing row at "not on the website" as a
-- metadata-only change. No _by/_at columns and no partial index
-- (DECISION-241: the audit row is authoritative; the window is a bounded
-- range scan on events_org_starts_idx).
--
-- The whole file is idempotent: `add column if not exists`, drop-then-add
-- for the constraint (NOT VALID then VALIDATE), drop-then-create for the
-- function, revoke-then-grant, and `comment on` (which overwrites). Proven by
-- applying the whole file twice (work-log, Phase 4 Batch 1). Unreleased until
-- applied to a shipped environment, so it may be corrected in place until
-- then (CLAUDE.md -> Project Layout -> drizzle/).
--
--   1. column       events.website_listed boolean not null default false
--   2. CHECK        events_website_requires_public: not website_listed or
--                   is_public (the database-level members-only veto)
--   3. definer      presby_public_events_calendar(p_slug text), always one
--                   row; revoke from public/presby_app/presby_platform, grant
--                   execute to presby_app only
--   4. comments

-- ---------------------------------------------------------------------------
-- 1. column (R1, G1)
-- ---------------------------------------------------------------------------
alter table events add column if not exists website_listed boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. CHECK (R1): an event on the website must be open to everyone. In
--    English: "if website_listed is true, is_public must be true"; equivalently
--    "a members-only event is never listed". A listed event made members-only
--    must clear website_listed in the SAME update (F251), or this refuses it.
--    NOT VALID then VALIDATE so the scan holds SHARE UPDATE EXCLUSIVE, not
--    ACCESS EXCLUSIVE (the 0064 ER19 pattern). Every existing row is false
--    on first apply, so validation cannot fail.
-- ---------------------------------------------------------------------------
alter table events drop constraint if exists events_website_requires_public;
alter table events add constraint events_website_requires_public
  check (not website_listed or is_public) not valid;
alter table events validate constraint events_website_requires_public;

-- ---------------------------------------------------------------------------
-- 3. definer: presby_public_events_calendar (R2, R3, DECISION-238)
--
--    Called by src/lib/public-calendar.ts on the anonymous `db` (presby_app)
--    connection with NO org GUC. Every table it reads is FORCE RLS, so it
--    must be SECURITY DEFINER or it reads nothing (F26).
--
--    ALWAYS EXACTLY ONE ROW. state = 'unavailable' with every other column
--    null for: unknown slug, org not active, site not live, the category
--    axis on with the worship category off, the toggle row off or missing,
--    or a row cap that leaves not even one complete month. Every one of
--    these is the same row, byte for byte (enumeration, DECISION-040/154).
--
--    The toggle is composed EXACTLY as orgFeatureEnabledInTx
--    (src/lib/org-features.ts) composes it:
--      orgTypes allow-list   - none: both catalog entries carry orgTypes null
--                              (pinned by a test; an allow-list added later
--                              must be added here too);
--      category axis         - only when feature_flags
--                              'org_portal.feature_categories' is enabled (a
--                              missing flag row is OFF, as isFlagEnabled
--                              reads it); then the org's 'worship' category
--                              row must not be disabled (a missing row is ON,
--                              categoryEnabledInTx);
--      toggle row            - a missing row is OFF (DECISION-097).
--    The flag is read HERE, not passed in: a parameter from isFlagEnabled()
--    would turn a DB error into "axis off", i.e. "serve" (Phase 2 R2).
--
--    Per-event predicate, three independent conditions: website_listed AND
--    is_public (re-checked here even though the CHECK forbids the
--    combination, so a dropped CHECK still cannot publish a members-only
--    row) AND not cancelled.
--
--    Window: the month before the org's current month through 12 months
--    after it (14 months), "today" read in the org's zone
--    (organization_settings.time_zone, America/New_York when the org has no
--    settings row - DEFAULT_ORG_TIME_ZONE, pinned by a test). Stored times
--    are wall-clock digits and are never converted.
--    Row cap 400 (PUBLIC_CALENDAR_ROW_CAP): when more than 400 listed rows
--    fall in the window, the window shrinks to the last COMPLETE month before
--    the month holding row 401, and truncated is true. If that leaves no
--    month at all, the read is unavailable.
--
--    events_json is a jsonb array ordered by (starts_at, id). Each element
--    has EXACTLY these keys, built by name so a future events column can
--    never appear by default (G5): title, starts_at, ends_at, location,
--    description, type_name, type_color. No id (there is no public
--    per-event URL), no allows_checkin, created_by, series fields,
--    is_public or website_listed. Times are 'YYYY-MM-DDTHH:MI' text
--    (check:sql-date). Title and location are clipped to 200 characters and
--    description to 2000 (F256: the table has no length CHECK, so a direct
--    writer cannot inflate the public payload). An untyped event shows as
--    the org's is_fallback type, as in the member calendar.
-- ---------------------------------------------------------------------------
drop function if exists presby_public_events_calendar(text);
create function presby_public_events_calendar(p_slug text)
returns table (state text, org_today text, first_month text, last_month text, truncated boolean,
               member_calendar_on boolean, contact_phone text, events_json jsonb)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  c_cap  constant integer := 400;                   -- PUBLIC_CALENDAR_ROW_CAP
  c_zone constant text    := 'America/New_York';    -- DEFAULT_ORG_TIME_ZONE (pinned by test)
  v_org record;
  v_zone text;
  v_today date;
  v_first date;
  v_after date;
  v_last date;
  v_cut date;
  v_axis_on boolean;
  v_cat_ok boolean;
  v_public_on boolean;
  v_member_on boolean;
  v_events jsonb;
begin
  -- Gate 1 and 2: the org exists by slug and is active, and its site is live
  -- (the same two conditions presby_published_site() serves on).
  select o.id, o.status into v_org from organizations o where o.slug = p_slug;
  if not found or v_org.status <> 'active'
     or not exists (select 1 from organization_sites s
                     where s.organization_id = v_org.id and s.status = 'live') then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::boolean,
                        null::boolean, null::text, null::jsonb;
    return;
  end if;

  -- Gate 3: the toggle, composed exactly as orgFeatureEnabledInTx composes it.
  v_axis_on := coalesce((select f.enabled from feature_flags f
                          where f.key = 'org_portal.feature_categories'), false);
  v_cat_ok  := (not v_axis_on)
               or coalesce((select c.enabled from organization_feature_categories c
                             where c.organization_id = v_org.id and c.category = 'worship'), true);
  v_public_on := v_cat_ok
                 and coalesce((select t.enabled from organization_feature_toggles t
                                where t.organization_id = v_org.id
                                  and t.feature_key = 'org_portal.public_calendar'), false);
  if not v_public_on then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::boolean,
                        null::boolean, null::text, null::jsonb;
    return;
  end if;
  -- The member calendar (G7), composed the same way (same 'worship' category).
  v_member_on := v_cat_ok
                 and coalesce((select t.enabled from organization_feature_toggles t
                                where t.organization_id = v_org.id
                                  and t.feature_key = 'org_portal.calendar'), false);

  -- The window, in the org's own zone.
  v_zone  := coalesce((select st.time_zone from organization_settings st
                        where st.organization_id = v_org.id), c_zone);
  v_today := (now() at time zone v_zone)::date;
  v_first := (date_trunc('month', v_today::timestamp) - interval '1 month')::date;     -- 1 month before
  v_after := (date_trunc('month', v_today::timestamp) + interval '13 months')::date;   -- through +12 months

  -- One predicate, one scan. `listed` takes at most c_cap + 1 rows in order;
  -- row c_cap + 1, when it exists, names the cut month. Every row before the
  -- cut month ranks at or below c_cap (row c_cap + 1 is the first row in the
  -- cut month or later), so the date bound alone keeps the result <= c_cap.
  with listed as (
    select e.id, e.starts_at, e.ends_at, e.title, e.location, e.description,
           t.name as type_name, t.color as type_color
      from events e
      left join event_types fb on fb.organization_id = e.organization_id and fb.is_fallback
      left join event_types t  on t.id = coalesce(e.event_type_id, fb.id)
                              and t.organization_id = e.organization_id
     where e.organization_id = v_org.id
       and e.website_listed and e.is_public and e.cancelled_at is null     -- three independent conditions
       and e.starts_at >= v_first::timestamp and e.starts_at < v_after::timestamp
     order by e.starts_at, e.id
     limit c_cap + 1
  ), ranked as (
    select l.*, row_number() over (order by l.starts_at, l.id) as rn from listed l
  ), cut as (
    select date_trunc('month', r.starts_at)::date as m from ranked r where r.rn = c_cap + 1
  )
  select max(c.m),
         coalesce(jsonb_agg(jsonb_build_object(
             'title',       left(r.title, 200),
             'starts_at',   to_char(r.starts_at, 'YYYY-MM-DD"T"HH24:MI'),
             'ends_at',     to_char(r.ends_at, 'YYYY-MM-DD"T"HH24:MI'),
             'location',    left(r.location, 200),
             'description', left(r.description, 2000),
             'type_name',   r.type_name,
             'type_color',  r.type_color) order by r.rn)
           filter (where c.m is null or r.starts_at < c.m::timestamp),
           '[]'::jsonb)
    into v_cut, v_events
    from ranked r left join cut c on true;

  if v_cut is not null then                       -- truncated: shrink to the last COMPLETE month
    v_last := (v_cut::timestamp - interval '1 month')::date;
    if v_last < v_first then                      -- not even one complete month fits: fail closed
      return query select 'unavailable'::text, null::text, null::text, null::text, null::boolean,
                          null::boolean, null::text, null::jsonb;
      return;
    end if;
  else
    v_last := (v_after::timestamp - interval '1 month')::date;
  end if;

  return query select 'available'::text, to_char(v_today, 'YYYY-MM-DD'), to_char(v_first, 'YYYY-MM'),
         to_char(v_last, 'YYYY-MM'), v_cut is not null, v_member_on,
         (select p.phone from organization_profiles p where p.organization_id = v_org.id), v_events;
end $$;

-- The same ACL as every other public definer (presby_public_staff_roster,
-- presby_public_giving_config, presby_published_site): owner + presby_app,
-- no PUBLIC, no presby_platform.
revoke all on function presby_public_events_calendar(text) from public, presby_app, presby_platform;
grant execute on function presby_public_events_calendar(text) to presby_app;

-- ---------------------------------------------------------------------------
-- 4. comments
-- ---------------------------------------------------------------------------
comment on column events.website_listed is
  'Shown on the congregation''s public website calendar (drizzle/0067, DECISION-238). Set only by an editor holding events.manage, through src/lib/events.ts, which derives it as (wanted AND is_public) and writes one audit row whenever it changes (DECISION-240). NEVER inferred from is_public, which defaults to true and means only "not members-only". presby_public_events_calendar() re-filters is_public and cancelled_at regardless. Default false: every pre-existing event starts off the website.';
comment on constraint events_website_requires_public on events is
  'A members-only event (is_public = false) is never listed on the public website (drizzle/0067 section 2). An update that makes a listed event members-only must clear website_listed in the same statement (F251).';
comment on function presby_public_events_calendar(text) is
  'The public website''s events calendar (drizzle/0067 section 3, DECISION-238). SECURITY DEFINER (F26), anonymous, takes the DB-returned slug. Always one row: state unavailable (every other column null; identical for unknown slug, inactive org, site not live, category off, toggle off or missing, over-cap) or available, with org_today, first_month, last_month, truncated, member_calendar_on, contact_phone and events_json (named keys only, no ids). Toggle composed as orgFeatureEnabledInTx composes it, flag read inside. Window: previous month through 12 months ahead in the org zone; 400-row cap. EXECUTE: presby_app only.';
