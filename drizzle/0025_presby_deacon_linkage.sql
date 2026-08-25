-- Portal home + directory v2, Increment 4 (docs/work-log/
-- 2026-08-24-portal-home-directory.md, Phase 2/3): the deacon-linkage schema
-- change and the directory.view_hidden permission-catalog row.
--
-- Phase 2 (architect) rejected two shapes before landing on this one:
--   (a) a plain org_units.deacon_person_id — repeats exactly the F15 mistake
--       already reversed for shepherd_person_id: a hand-editable FK that can
--       point at a non-deacon, with no dates.
--   (b) a new care_assignments table — duplicates state officer_terms already
--       owns and creates a second place service-dates can drift from the
--       term.
-- Adopted instead: officer_terms.org_unit_id, nullable (only district-scoped
-- offices set it), composite FK to org_units(id, organization_id) mirroring
-- memberships.orgUnitId's existing pattern (F2 — Composite Tenant Keys). A
-- household's deacon becomes a pure DERIVATION —
--   households.org_unit_id -> officer_terms where office = 'deacon'
--     and org_unit_id = ... and ends_on is null
-- — dates authoritative, no new table, nothing to fall out of sync. The CHECK
-- below stops a term for another office from accidentally carrying district
-- scoping.
--
-- RLS: officer_terms already carries the standard tenant_isolation FORCE RLS
-- policy (drizzle/0009_presby_rls.sql), keyed on organization_id alone — a
-- new nullable column needs no policy change, and none is made here.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md), so every migration past 0012 is hand-authored and
-- must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. officer_terms.org_unit_id
-- ---------------------------------------------------------------------------
alter table officer_terms add column if not exists org_unit_id uuid;

comment on column officer_terms.org_unit_id is
  'Nullable; only district-scoped offices (today, only deacon) set it. A '
  'household''s deacon is DERIVED from this column (office = deacon, '
  'ends_on is null) -- never a hand-editable FK on households/org_units '
  '(F15). See officer_terms_org_unit_deacon_check.';

-- Composite FK, mirroring memberships.orgUnitId (F2 — a row in org B must not
-- reference an org_unit in org A). org_units already carries
-- unique (id, organization_id) as org_units_id_org_key
-- (src/lib/db/domain/org.ts).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'officer_terms_org_unit_fk'
  ) then
    alter table officer_terms
      add constraint officer_terms_org_unit_fk
      foreign key (org_unit_id, organization_id)
      references org_units (id, organization_id);
  end if;
end $$;

-- A term for any office other than deacon must not carry district scoping.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'officer_terms_org_unit_deacon_check'
  ) then
    alter table officer_terms
      add constraint officer_terms_org_unit_deacon_check
      check (org_unit_id is null or office = 'deacon');
  end if;
end $$;

-- Serves "the active deacon for org_unit X" — getParishRoster()'s and
-- DeaconCard's derivation query (Increment 4b, full-stack-developer).
create index if not exists officer_terms_org_unit_idx
  on officer_terms (organization_id, org_unit_id, office, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- 2. The permission catalog row
-- ---------------------------------------------------------------------------
-- `permissions` carries no organization_id — global, code-seeded, never
-- tenant-writable (src/lib/db/domain/authz.ts:24) — matching how
-- drizzle/0017_presby_membership_roster.sql seeded directory.view and
-- drizzle/0018_presby_role_administration.sql seeded role_grants.manage here
-- rather than in scripts/seed.ts.
insert into permissions (key, module, description, sensitivity_tier)
values ('directory.view_hidden', 'directory',
        'See directory-hidden rows and the deacon roster', 1)
on conflict (key) do nothing;

-- No app_roles/app_role_permissions/role_grants row is seeded here.
-- app_roles/role_grants are ORG-scoped (need an organization to exist first)
-- and have no production role-seeding surface yet (0018's own precedent:
-- stated_clerk is fixture-seeded, not migration-seeded, for the identical
-- reason). The diaconate_member role, its directory.view_hidden binding, and
-- the directory.view_hidden addition to stated_clerk's existing grant are
-- fixture-only, in scripts/seed-dev.sql.
