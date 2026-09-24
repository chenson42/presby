-- Organization identifiers (D24) — increment 1 of the lifecycle/affiliation/
-- returns pipeline (docs/work-log/2026-09-24-lifecycle-affiliation-returns.md,
-- Phase 3 Data Model "Increment 1"; DECISION-135 through DECISION-139;
-- docs/schema-design-2.md sec 2b).
--
-- Two changes, both low risk and with no trigger or grant dependencies:
--
--   1. `organization_identifiers` — the one place an organization's EXTERNAL
--      identifiers live (OGA church PIN, psvonline congregation id, legacy
--      import keys). Identity data about a public org-tree entry, so it
--      carries NO RLS, exactly like `organizations` itself
--      (docs/schema-design.md sec 17). This is deliberate and is the reason
--      the table exists at all: `pcusa_pin` was on `organization_settings`,
--      which IS tenant-isolated, so the presbytery running an import could
--      not read a congregation's own PIN — the identifier a cross-council
--      importer needs most.
--   2. `organization_settings.pcusa_pin` is moved into it and dropped.
--
-- NOT DONE HERE, deliberately — `alter table organizations drop column
-- status` (F35). Phase 3's Data Model calls the column "the unused
-- pre-provisioning status column". It is NOT unused: five shipped
-- SECURITY DEFINER functions gate an ANONYMOUS public read on
-- `o.status = 'active'` —
--   drizzle/0020_presby_public_sites.sql:160      presby_published_site()
--   drizzle/0021_presby_site_profile.sql:233      presby_published_site()
--   drizzle/0024_presby_published_site_light_only.sql:62  presby_published_site()
--   drizzle/0041_presby_public_staff_directory.sql:70,83  presby_public_staff_directory()
--   drizzle/0042_presby_public_directory_primitives.sql:83,96,146
-- Postgres does not record column dependencies inside function bodies, so
-- the DROP would SUCCEED and every public site would start failing at
-- request time, not at migration time. The column's real successor is
-- `organizations.lifecycle_status` (increment 2 below), so the drop is a
-- rewrite of those five functions, not a one-line DDL — flagged as a
-- loop-back to Phase 3 in the work-log's Implementer Notes rather than
-- silently taken or silently skipped.
--
-- Hand-written per CLAUDE.md: Drizzle Kit emits no RLS, no partial index of
-- this shape and no data move, so every migration past 0012 is hand-authored
-- and must be idempotent.
--
-- Migration-numbering note: `ls drizzle/` was run immediately before this
-- file was written and found 0042_presby_public_directory_primitives.sql as
-- the highest claimed number, with no gap and no second pipeline's file on
-- disk. This migration claims 0043; increment 2 claims 0044 in the same pass
-- (both journal entries added together, so the 0039/0040 near-collision
-- cannot repeat inside this pipeline).

-- ---------------------------------------------------------------------------
-- 1. organization_identifiers
-- ---------------------------------------------------------------------------
create table if not exists organization_identifiers (
  id uuid primary key default gen_random_uuid(),
  -- PLAIN FK by design, and NOT a tenant scope. This column is the "which
  -- organization is this identifier for" column, the same structural
  -- exception congregation_oversight.about_org_id already takes
  -- (docs/schema-design.md sec 17 / F2). Do not "fix" it into a composite
  -- tenant FK: this table has no tenant column to compose against.
  organization_id uuid not null references organizations(id) on delete cascade,
  -- pcusa_pin | psvonline_congregation_id | church360 | legacy_import
  kind text not null,
  value_normalized text not null,
  is_verified boolean not null default false,
  source text,
  created_at timestamptz not null default now()
);

-- Only VERIFIED identifiers are globally unique. An unverified import
-- candidate may legitimately collide with a verified row (that is the
-- collision the resolution step exists to settle); a verified one may not.
create unique index if not exists organization_identifiers_kind_value_verified_idx
  on organization_identifiers (kind, value_normalized) where is_verified;
create index if not exists organization_identifiers_org_idx
  on organization_identifiers (organization_id);

-- No RLS: same visibility class as `organizations` itself.
grant select, insert, update, delete on organization_identifiers
  to presby_app, presby_platform;

comment on table organization_identifiers is
  'External identifiers for an organization (OGA church PIN, psvonline congregation id, legacy import keys). D24. Deliberately NOT tenant-isolated — identity data about a public org-tree entry, same class as organizations. pcusa_pin lived on organization_settings (tenant-isolated) until drizzle/0043, where a cross-council importer running as the presbytery could not read it.';

-- ---------------------------------------------------------------------------
-- 2. Move pcusa_pin off organization_settings
-- ---------------------------------------------------------------------------
-- Guarded so a re-run after the column is gone is a no-op rather than an
-- error. `is_verified = true`: a PIN already hand-entered into a
-- congregation's own settings row is an asserted fact about itself, not an
-- import candidate.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'organization_settings' and column_name = 'pcusa_pin'
  ) then
    execute $move$
      insert into organization_identifiers
        (organization_id, kind, value_normalized, is_verified, source)
      select s.organization_id, 'pcusa_pin', s.pcusa_pin, true,
             'migrated from organization_settings.pcusa_pin (drizzle/0043)'
        from organization_settings s
       where s.pcusa_pin is not null
         and not exists (
           select 1 from organization_identifiers i
            where i.organization_id = s.organization_id
              and i.kind = 'pcusa_pin'
              and i.value_normalized = s.pcusa_pin
         )
    $move$;
  end if;
end $$;

alter table organization_settings drop column if exists pcusa_pin;
