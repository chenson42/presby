-- Public-site organization profile data — database-admin's commit (1 of 2)
-- of docs/work-log/2026-08-21-public-site-org-profile.md Phase 4.
--
-- DECISION-090: `organization_profiles` is a new table (not a widened
-- `organization_sites`), shaped like `organization_brands` — degenerate PK
-- (organization_id itself), FORCE RLS, and a full standard `presby_app`
-- grant declared NOW, forward-looking, ahead of the deferred tenant-editor
-- follow-up (docs/TODO.md) — NOT `organization_sites`' "no grant, ever."
-- DECISION-091: structured service times land in a genuine child table
-- (`organization_service_times`, typed day_of_week/start_time/end_time/
-- label columns, composite tenant key), not a JSONB array column.
-- DECISION-092: `presby_published_site()` returns service times and office
-- hours as two separately-aggregated jsonb arrays (two correlated
-- `jsonb_agg` subqueries filtered by `kind`), not one kind-tagged array;
-- the admin editor (next commit) replaces a kind's entire row set on save.
--
-- Two new tables, their own FORCE-RLS/grant block (mirrors
-- 0016_presby_brand_storage.sql's brand_tables loop and
-- 0020_presby_public_sites.sql's site_tables loop exactly), and
-- `presby_published_site()` widened via drop-and-recreate (CREATE OR
-- REPLACE cannot append columns to an existing RETURNS TABLE signature).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. organization_profiles (DECISION-090)
-- ---------------------------------------------------------------------------
create table if not exists organization_profiles (
  -- Degenerate PK — one row per org, matching organization_brands.
  organization_id  uuid primary key references organizations(id) on delete cascade,
  -- Single free-text line (Phase 1 Q4) — URL-encoded into a maps deep link
  -- by the reading component; no structured/geocoded shape.
  address          text,
  -- Free text — no format CHECK (international formats vary; app-level
  -- max-length only, per site_contact_messages.body's own precedent).
  phone            text,
  -- Five fixed nullable columns (Phase 1 Q3 / D8) — no open key-value
  -- social-links store.
  facebook_url     text,
  instagram_url    text,
  x_twitter_url    text,
  youtube_url      text,
  other_url        text,
  -- Always human-attributed — no machine writer exists for this table
  -- (unlike organization_sites.updated_by, nullable for ingest).
  updated_by       uuid not null references users(id),
  updated_at       timestamptz not null default now()
  -- No created_at column — matches organization_brands' own precedent
  -- exactly (first updated_at IS the creation event). No history table
  -- (resolved Q6).
);

comment on table organization_profiles is
  'Public-site profile data (DECISION-090): address/phone/social links a church-website template needs. PK is organization_id itself — a DEGENERATE composite key, one row per org, matching organization_brands. FORCE RLS, and unlike organization_sites, presby_app DOES get a full standard grant here, declared now, forward-looking: the user resolved Phase 1''s Open Question 1 by naming a tenant-admin self-edit surface "deferred as its own future follow-up, same pattern as the brand editor''s own deferred slice d" (docs/work-log/2026-08-21-public-site-org-profile.md), the same already-scoped-but-deferred shape that earned organization_brands its own forward-looking grant. Written today exclusively through getPlatformDb() by the platform operator at /admin/organizations/[id] (FEATURES.ADMIN_ORGANIZATIONS) — no tenant self-serve editor exists yet. Read anonymously only through presby_published_site()''s SECURITY DEFINER collapse.';

-- ---------------------------------------------------------------------------
-- 2. organization_service_times (DECISION-091)
-- ---------------------------------------------------------------------------
create table if not exists organization_service_times (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  -- 'service' | 'office_hours' — one child table for both, per the user's
  -- own resolution of the architect's open question (Phase 2).
  kind             text not null,
  -- 0=Sunday..6=Saturday, matching JS Date.getDay() — stated here so
  -- presby-site-kit never has to guess the convention.
  day_of_week      smallint not null,
  -- No time zone — a congregation's own wall-clock time, not a UTC
  -- instant; there is no date component, so no DST math applies.
  start_time       time not null,
  end_time         time not null,
  -- Nullable — e.g. "Traditional", "Contemporary (Spanish)", "Front
  -- office". App-level max length only.
  label            text,
  -- Per-row attribution — cheap to keep even under whole-list replace
  -- (DECISION-092), and answers "who set the 10:15 service" without a
  -- join to organization_profiles, which may never have been touched if
  -- only service times were ever edited.
  updated_by       uuid not null references users(id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_service_times_kind_allowed'
  ) then
    alter table organization_service_times add constraint organization_service_times_kind_allowed
      check (kind in ('service', 'office_hours'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_service_times_day_of_week_bounds'
  ) then
    alter table organization_service_times add constraint organization_service_times_day_of_week_bounds
      check (day_of_week between 0 and 6);
  end if;
end $$;

-- Per-row ordering only — cross-row overlap is deliberately NOT validated
-- (Phase 3 Edge Cases: a congregation may legitimately run two simultaneous
-- services, e.g. Spanish-language chapel alongside the main sanctuary
-- service, and rejecting that as "invalid" would be wrong, not merely
-- permissive). No overnight/cross-midnight rows in v1 — `time` has no date
-- component, so this CHECK also rejects a service spanning midnight; an
-- admin works around it with two rows and a label.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_service_times_end_after_start'
  ) then
    alter table organization_service_times add constraint organization_service_times_end_after_start
      check (end_time > start_time);
  end if;
end $$;

-- Composite-tenant-key convention (docs/schema-design.md sec 3), kept for
-- consistency even though nothing composite-FKs into this table today —
-- site_contact_messages' own precedent is the exact shape to follow.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_service_times_id_org_key'
  ) then
    alter table organization_service_times
      add constraint organization_service_times_id_org_key unique (id, organization_id);
  end if;
end $$;

-- Backs both the admin list read (listOrganizationServiceTimes) and the
-- jsonb_agg subquery's ORDER BY inside presby_published_site() below.
create index if not exists organization_service_times_org_kind_idx
  on organization_service_times (organization_id, kind, day_of_week, start_time);

comment on table organization_service_times is
  'Structured, publish-facing regular service times AND office hours for one org, distinguished by kind (DECISION-091). Genuine child table, not a JSONB column, specifically so day_of_week/start_time/end_time carry real CHECK constraints and planner visibility. FORCE RLS, unique(id, organization_id) kept for consistency even with no current composite-FK consumer (site_contact_messages precedent). Cross-row overlap within a kind/day is deliberately unvalidated — a congregation may run two simultaneous services. Read anonymously only through presby_published_site()''s two correlated jsonb_agg subqueries (DECISION-092); written today exclusively through getPlatformDb(), whole-list replace per (organization_id, kind) — no per-row diffed CRUD, no history table.';

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
-- F1: FORCE, not just ENABLE — without it the table owner (and any role
-- that shares the owner's privileges) bypasses every policy, and RLS is
-- silently inert while every naive test still passes. These two tables
-- postdate 0009's original tenant_tables loop, so they get their own
-- block, mirroring 0016/0019/0020's own loops exactly.
do $$
declare
  t text;
  profile_tables text[] := array[
    'organization_profiles', 'organization_service_times'
  ];
begin
  foreach t in array profile_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants — symmetric full CRUD, unlike 0020's asymmetric pair
--    (DECISION-090 — a deliberate exception to "grant only when a consumer
--    exists," already argued and settled in Phase 2).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on organization_profiles, organization_service_times
  to presby_platform;

grant select, insert, update, delete
  on organization_profiles, organization_service_times
  to presby_app;

-- ---------------------------------------------------------------------------
-- 5. presby_published_site(text) — widened, drop-and-recreate
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE cannot change a RETURNS TABLE(...) signature by
-- appending columns — Postgres errors on the attempt. Must drop first.
drop function if exists presby_published_site(text);

create function presby_published_site(p_slug text)
returns table (
  organization_id           uuid,
  organization_name         text,
  organization_type         text,
  content_bundle_key        uuid,
  brand_seed_hex            text,
  brand_type_pairing        text,
  brand_token_version       integer,
  profile_address           text,
  profile_phone             text,
  profile_facebook_url      text,
  profile_instagram_url     text,
  profile_x_twitter_url     text,
  profile_youtube_url       text,
  profile_other_url         text,
  service_times             jsonb,
  office_hours              jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.organization_type::text,
         s.content_bundle_key,
         b.seed_hex, b.type_pairing, b.brand_token_version,
         p.address, p.phone, p.facebook_url, p.instagram_url,
         p.x_twitter_url, p.youtube_url, p.other_url,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'service') as service_times,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'office_hours') as office_hours
    from organizations o
    join organization_sites s on s.organization_id = o.id
    left join organization_brands b on b.organization_id = o.id
    left join organization_profiles p on p.organization_id = o.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live';
$$;

comment on function presby_published_site(text) is
  'The ONLY presby_app-reachable read of organization_sites, and now also of organization_profiles/organization_service_times (docs/work-log/2026-08-21-public-site-org-profile.md, DECISION-092). Collapses never-provisioned / suspended / nonexistent-slug / org-not-active into the same zero-row result (enumeration-safety, unchanged from 0020). Profile scalar columns LEFT JOIN in exactly like organization_brands already does (nullable — a live site with no profile row set yet returns NULL/NULL/... for every profile_* column, not a missing row). service_times/office_hours are two independently correlated jsonb_agg subqueries, one per kind, so the caller (getPublishedSite()) gets two arrays it never has to partition itself; jsonb_agg over zero matching rows returns SQL NULL, which the query layer maps to []. SECURITY DEFINER for the identical F26 reason as before: the anonymous (public)/site/[slug] page reads through presby_app with NO org GUC set.';

revoke all on function presby_published_site(text) from public;
grant execute on function presby_published_site(text) to presby_app;
