-- Per-org feature toggles (docs/work-log/2026-08-25-member-management.md,
-- "Per-Org Feature Enablement — Architectural Ruling" / DECISION-097, Phase 3
-- Deliverable A). The third gating axis, alongside the global feature_flags
-- kill switch and the per-user permissions catalog:
--
--   feature_flags     does it exist anywhere, regardless of org
--   org toggle (here) does it exist for THIS org
--   permissions       who within an entitled org may use it
--
-- One new table (organization_feature_toggles), plus the org_features.manage
-- permission-catalog row that gates the /o/[slug]/admin/features admin
-- surface itself. No fixture binding here — matching
-- drizzle/0025_presby_deacon_linkage.sql's precedent, app_roles/role_grants
-- are org-scoped and have no production seeding surface yet; the stated_clerk
-- fixture binding lives in scripts/seed-dev.sql.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md), so every migration past 0012 is hand-authored and
-- must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. organization_feature_toggles
-- ---------------------------------------------------------------------------
-- GENUINELY composite PK (organization_id, feature_key) — unlike
-- organization_brands/organization_settings, this table carries many rows
-- per org, one per feature key, so there is no degenerate single-column PK
-- to fall back to. See src/lib/db/domain/org-features.ts's header comment.
create table if not exists organization_feature_toggles (
  organization_id uuid not null references organizations(id) on delete cascade,
  feature_key     text not null,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id),
  primary key (organization_id, feature_key)
);

comment on table organization_feature_toggles is
  'Per-org feature enablement (DECISION-097). Composes with, never replaces, feature_flags (global kill switch) and permissions (who may act). Written through presby_app from /o/[slug]/admin/features, never getPlatformDb().';

create index if not exists organization_feature_toggles_org_idx
  on organization_feature_toggles (organization_id);

-- ---------------------------------------------------------------------------
-- 2. Row-level security
-- ---------------------------------------------------------------------------
-- F1: FORCE, not just ENABLE — without it the table owner (and any role that
-- shares the owner's privileges) bypasses every policy and RLS is silently
-- inert while every naive test still passes. Standard tenant_isolation
-- policy, verbatim shape of drizzle/0016_presby_brand_storage.sql's.
alter table organization_feature_toggles enable row level security;
alter table organization_feature_toggles force  row level security;
drop policy if exists tenant_isolation on organization_feature_toggles;
create policy tenant_isolation on organization_feature_toggles
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
-- presby_platform: 0009's "grant ... on ALL TABLES in schema public" only
-- covered tables that existed at that migration's execution time — every
-- table created since needs its own grant (0016's own precedent).
--
-- presby_app: the standard tenant grant, paired with the FORCE RLS policy
-- above — this table IS read/written through presby_app from (org)'s own
-- admin surface (unlike organization_brands, which is platform-operator-only
-- today), so the grant is declared now, not deferred to a future migration.
grant select, insert, update, delete on organization_feature_toggles
  to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 4. Permission catalog — org_features.manage
-- ---------------------------------------------------------------------------
-- `permissions` carries no organization_id — global, code-seeded, never
-- tenant-writable (src/lib/db/domain/authz.ts) — matching how
-- drizzle/0017_presby_membership_roster.sql seeded directory.view,
-- drizzle/0018_presby_role_administration.sql seeded role_grants.manage, and
-- drizzle/0025_presby_deacon_linkage.sql seeded directory.view_hidden here
-- rather than in scripts/seed.ts.
insert into permissions (key, module, description, sensitivity_tier)
values ('org_features.manage', 'org_features',
        'Turn optional portal features on or off for this organization', 1)
on conflict (key) do nothing;

-- No app_roles/app_role_permissions/role_grants row is seeded here — see the
-- file header comment. The stated_clerk fixture binding (DECISION-097's
-- named default) is fixture-only, in scripts/seed-dev.sql.
