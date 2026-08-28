-- Public staff & leadership directory (docs/work-log/
-- 2026-08-27-public-staff-directory.md, Phase 3 "Data Model"/"API Contract",
-- Phase 4 step 1 / database-admin). Three columns on staff_positions and
-- officer_terms (opt-in public-listing bit + who/when), plus the anonymous
-- SECURITY DEFINER read function that unions both tables for one org's
-- published public site.
--
-- Hand-authored per CLAUDE.md / docs/TODO.md: `npm run db:generate` is
-- broken repo-wide on the drizzle/meta/0008-0012 snapshot collision, so
-- every migration past 0012 is hand-authored and manually registered in
-- drizzle/meta/_journal.json, matching the house style set by 0013-0040.
--
-- No new RLS policy needed: both tables already carry FORCE ROW LEVEL
-- SECURITY + tenant_isolation from their own original migrations (0009's
-- loop covers officer_terms; 0039 covers staff_positions) — three new
-- columns on an already-force-RLS'd table need nothing further, and the new
-- function bypasses RLS by virtue of SECURITY DEFINER, the identical
-- mechanism presby_published_site() already uses against these same two
-- FORCE-RLS tables' siblings. No new grant: presby_app already holds full
-- CRUD on both tables (established when each table shipped); a new column
-- is covered by the existing table-level grant.

alter table staff_positions
  add column if not exists public_listed boolean not null default false,
  add column if not exists public_listed_by uuid references users(id),
  add column if not exists public_listed_at timestamptz;

alter table officer_terms
  add column if not exists public_listed boolean not null default false,
  add column if not exists public_listed_by uuid references users(id),
  add column if not exists public_listed_at timestamptz;

-- Backs presby_public_staff_roster()'s per-table WHERE clauses.
create index if not exists staff_positions_public_listed_idx
  on staff_positions (organization_id)
  where public_listed and ends_on is null;

create index if not exists officer_terms_public_listed_idx
  on officer_terms (organization_id)
  where public_listed and ends_on is null;

-- presby_public_staff_roster(text) — anonymous, unauthenticated read for
-- (public)/site/[slug]'s staffDirectory liveSlot (src/lib/sites.ts,
-- getPublicStaffRoster()). Mirrors presby_published_site()'s SECURITY
-- DEFINER/grant/comment shape exactly (drizzle/0020, 0024): both tables are
-- FORCE ROW LEVEL SECURITY and presby_app is NOBYPASSRLS, so an anonymous
-- caller with no org GUC set needs this function, never getPlatformDb(),
-- never a general-purpose view.
create or replace function presby_public_staff_roster(p_slug text)
returns table (
  kind         text,   -- 'staff' | 'officer' — lets the TS caller pick the label map
  role_raw     text,   -- staff_positions.position, or officer_terms.office
  department   text,   -- staff only; null for officer rows
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select 'staff' as kind, sp.position as role_raw, sp.department,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from staff_positions sp
    join organizations o on o.id = sp.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = sp.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and sp.public_listed
     and sp.ends_on is null
  union all
  select 'officer' as kind, ot.office as role_raw, null as department,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from officer_terms ot
    join organizations o on o.id = ot.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = ot.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and ot.public_listed
     and ot.ends_on is null
   order by 4;
$$;

comment on function presby_public_staff_roster(text) is
  'Anonymous, unauthenticated read backing the (public)/site/[slug] staffDirectory liveSlot (docs/work-log/2026-08-27-public-staff-directory.md). Flat, alphabetized (order by display_name) union of currently-open, opt-in-public rows across staff_positions and officer_terms for one live, active org. Duplicates the organizations.status = ''active'' / organization_sites.status = ''live'' gate from presby_published_site() deliberately (defense in depth for an anonymous SECURITY DEFINER caller, not membership-gated like presby_officer_roster()/presby_officer_history()). Column projection is the field-scope enforcement point (name/role/title/department/photo_key only) — contact_methods is never joined here; widening this projection requires its own pass through the pipeline, not a quiet edit.';

revoke all on function presby_public_staff_roster(text) from public;
grant execute on function presby_public_staff_roster(text) to presby_app;
