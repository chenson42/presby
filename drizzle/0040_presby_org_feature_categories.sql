-- Org feature categories (docs/work-log/2026-08-27-feature-categories.md,
-- Phase 3 "Data Model" / DECISION-130). The fourth gating axis, sitting
-- between the global feature_flags kill switch and the existing per-feature
-- organization_feature_toggles axis:
--
--   feature_flags                     does it exist anywhere, regardless of org
--   organization_feature_categories   does this ministry AREA apply to this org (NEW, here)
--   organization_feature_toggles      does this individual feature exist for this org
--   permissions                       who within an entitled org may use it
--
-- One new table (organization_feature_categories). No new permission-catalog
-- row — this axis reuses org_features.manage (drizzle/0026), the same admin,
-- same page, same job as the existing per-feature toggle; see DECISION-130's
-- "Second, the CHECK constraint" and the architect's Phase 2 re-run ruling
-- for why reuse (not a dedicated org_categories.manage key) is correct here.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. organization_feature_categories
-- ---------------------------------------------------------------------------
-- GENUINELY composite PK (organization_id, category) — same shape as
-- organization_feature_toggles: many rows per org, one per category, no
-- degenerate single-column PK to fall back to. See
-- src/lib/db/domain/org-feature-categories.ts's header comment.
--
-- DEFAULT-ON: `enabled` defaults to true, and (load-bearing, see the app
-- layer) a MISSING row also means enabled. This is a deliberate departure
-- from organization_feature_toggles' own "missing row -> false" convention —
-- this axis lands on top of already-live per-org toggle state for real orgs,
-- so a false default would be silent retroactive removal, not a neutral
-- default. Do not "fix" this back to default(false) — see
-- src/lib/org-feature-categories.ts's categoryEnabledInTx() for the full
-- reasoning (architect Phase 2 re-run ruling, docs/work-log/
-- 2026-08-27-feature-categories.md).
--
-- CHECK CONSTRAINT, unlike organization_feature_toggles.feature_key (which is
-- deliberately left unconstrained at the schema layer, validated only at the
-- resolver): category is a genuinely closed, six-value business taxonomy
-- (PortalDomain minus "administration"), not an open catalog mirroring
-- external flag-key strings. Defense-in-depth against Phase 1 Gap 2
-- ("administration" must never become a selectable category), on top of the
-- resolver-layer isCategoryKey() guard — DECISION-130.
create table if not exists organization_feature_categories (
  organization_id uuid not null references organizations(id) on delete cascade,
  category        text not null
    check (category in ('people','worship','giving','governance','reports','communications')),
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id),
  primary key (organization_id, category)
);

comment on table organization_feature_categories is
  'Org-chosen ministry-area gating (DECISION-130), the fourth composed axis alongside feature_flags, organization_feature_toggles, and permissions. DEFAULT-ON: a missing row means the category is enabled -- deliberate departure from organization_feature_toggles convention, see src/lib/org-feature-categories.ts. Written through presby_app from /o/[slug]/admin/features, never getPlatformDb().';

create index if not exists organization_feature_categories_org_idx
  on organization_feature_categories (organization_id);

-- ---------------------------------------------------------------------------
-- 2. Row-level security
-- ---------------------------------------------------------------------------
-- F1: FORCE, not just ENABLE — without it the table owner (and any role that
-- shares the owner's privileges) bypasses every policy and RLS is silently
-- inert while every naive test still passes. Standard tenant_isolation
-- policy, verbatim shape of drizzle/0026_presby_org_feature_toggles.sql's.
alter table organization_feature_categories enable row level security;
alter table organization_feature_categories force  row level security;
drop policy if exists tenant_isolation on organization_feature_categories;
create policy tenant_isolation on organization_feature_categories
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
-- admin surface, same as organization_feature_toggles.
grant select, insert, update, delete on organization_feature_categories
  to presby_app, presby_platform;

-- No permission-catalog insert here — org_features.manage already exists
-- (drizzle/0026_presby_org_feature_toggles.sql) and is reused unchanged, per
-- DECISION-130 and Phase 3's Data Model section. No app_roles/
-- app_role_permissions/role_grants row either — same as 0026's own
-- precedent, org-scoped role tables have no production seeding surface here.
-- The new org_portal.feature_categories flag row is seeded from
-- scripts/seed.ts, not this migration, matching org_portal.features' own
-- precedent (flags live in TS seed data, not SQL).
