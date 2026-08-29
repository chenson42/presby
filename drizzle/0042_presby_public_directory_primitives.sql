-- Public directory primitives — staff/officer filter widening + committees
-- (docs/work-log/2026-08-28-public-directory-primitives.md, Phase 3 "Data
-- Model", Phase 4 step 1 / database-admin). Adds an admin-set
-- public_display_order curation column to the two tables that already
-- shipped opt-in public listing (staff_positions, officer_terms), extends
-- the same opt-in-public-listing shape from scratch to group_memberships
-- (committees), and widens presby_public_staff_roster() with optional
-- kind/hasPriority filter parameters while adding a new, sibling
-- presby_public_committee_roster() SECURITY DEFINER function.
--
-- Hand-authored per CLAUDE.md / docs/TODO.md: `npm run db:generate` is
-- broken repo-wide on the drizzle/meta/0008-0012 snapshot collision, so
-- every migration past 0012 is hand-authored and manually registered in
-- drizzle/meta/_journal.json, matching the house style set by 0013-0041.
--
-- No new RLS policy needed: staff_positions/officer_terms are unchanged by
-- this migration's RLS surface (only a new nullable column), and
-- group_memberships already carries FORCE ROW LEVEL SECURITY +
-- tenant_isolation from migration 0009's tenant_tables loop (confirmed by
-- direct read — it is already in that array). Four new columns on an
-- already-force-RLS'd table need nothing further. No new grant: presby_app
-- already holds full CRUD on all three tables; a new column is covered by
-- the existing table-level grant.

alter table staff_positions
  add column if not exists public_display_order integer;

alter table officer_terms
  add column if not exists public_display_order integer;

alter table group_memberships
  add column if not exists public_listed boolean not null default false,
  add column if not exists public_listed_by uuid references users(id),
  add column if not exists public_listed_at timestamptz,
  add column if not exists public_display_order integer;

-- Backs presby_public_committee_roster()'s WHERE clause, matching
-- staff_positions_public_listed_idx / officer_terms_public_listed_idx's own
-- shape exactly (drizzle/0041).
create index if not exists group_memberships_public_listed_idx
  on group_memberships (organization_id)
  where public_listed and ends_on is null;

-- Widen presby_public_staff_roster() with p_kind/p_has_priority. Adding
-- parameters changes the function's arity — CREATE OR REPLACE cannot reuse
-- the existing single-argument overload in place (Postgres treats a
-- different parameter list as a distinct function identity even when the
-- new trailing parameters carry DEFAULTs); a bare CREATE OR REPLACE here
-- would create a SECOND, overloaded function, and every existing
-- 1-argument call (select * from presby_public_staff_roster($1)) becomes
-- ambiguous ("function is not unique") — a production-breaking defect that
-- would not surface until the very first anonymous page view after deploy.
-- The old signature must be dropped first.
drop function if exists presby_public_staff_roster(text);

create or replace function presby_public_staff_roster(
  p_slug text,
  p_kind text default null,
  p_has_priority boolean default null
)
returns table (
  kind         text,
  role_raw     text,
  department   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select u.kind, u.role_raw, u.department, u.display_name, u.photo_key
    from (
      select 'staff' as kind, sp.position as role_raw, sp.department,
             coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
             p.photo_key, sp.public_display_order
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
             p.photo_key, ot.public_display_order
        from officer_terms ot
        join organizations o on o.id = ot.organization_id
        join organization_sites s on s.organization_id = o.id
        join people p on p.id = ot.person_id
       where o.slug = p_slug
         and o.status = 'active'
         and s.status = 'live'
         and ot.public_listed
         and ot.ends_on is null
    ) u
   where (p_kind is null or u.kind = p_kind)
     and (p_has_priority is not true or u.public_display_order is not null)
   order by coalesce(u.public_display_order, 2147483647), u.display_name;
$$;

comment on function presby_public_staff_roster(text, text, boolean) is
  'Widened (docs/work-log/2026-08-28-public-directory-primitives.md) with optional p_kind/p_has_priority filter parameters -- department/office matching stays in TypeScript (getPublicStaffRoster()), never duplicated here, because office LABELS live in exactly one place (OFFICE_LABELS, DECISION-131) and this function must not grow a second copy. Ordering is always coalesce(public_display_order, 2147483647), display_name so an org that never curates gets alphabetical for free.';

revoke all on function presby_public_staff_roster(text, text, boolean) from public;
grant execute on function presby_public_staff_roster(text, text, boolean) to presby_app;

-- presby_public_committee_roster(text, text, boolean) -- NEW, anonymous,
-- unauthenticated read backing (public)/site/[slug]'s committeeDirectory
-- liveSlot. Mirrors presby_public_staff_roster()'s SECURITY DEFINER/grant
-- shape; a SEPARATE function from the staff/officer union, not a widening
-- of it (Phase 2's own ruling -- committees are a structurally different
-- read over a different table). g.name is the ONLY grouping identifier
-- ever projected -- g.id is never selected, matching the "no id in the
-- anonymous projection" rule the staff/officer function already
-- established for person ids.
create or replace function presby_public_committee_roster(
  p_slug text,
  p_committee text default null,
  p_has_priority boolean default null
)
returns table (
  group_name   text,
  group_role   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.name as group_name, gm.group_role,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         p.photo_key
    from group_memberships gm
    join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
    join organizations o on o.id = gm.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = gm.person_id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.ends_on is null
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;

comment on function presby_public_committee_roster(text, text, boolean) is
  'Anonymous, unauthenticated read backing the (public)/site/[slug] committeeDirectory liveSlot (docs/work-log/2026-08-28-public-directory-primitives.md). g.membership_source = ''managed'' is defense-in-depth: a derived Session/Diaconate group_memberships row can never surface here even under a future application-layer bug, mirroring groups.ts''s own two-layer discipline. group_name is the only grouping identifier ever projected -- group_id is never selected.';

revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;
