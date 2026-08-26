-- Tenant branding permission (docs/work-log/2026-08-26-tenant-branding-permission.md)
-- Phase 4 commit 1 (database-admin): the branding.manage permission-catalog
-- row.
--
-- DECISION-101 (architect, Phase 2) / DECISION-103 (tech-lead, Phase 3):
-- branding management is a congregation's own self-service capability over
-- its own organization_brands row (organization_id = presby_current_org(),
-- already FORCE RLS since drizzle/0016), not a fit for stated_clerk's
-- constitutional duty — G-3.0204(b) has no defensible analog for "who picks
-- the brand colour." Piling a seventh permission onto that office (which
-- already carries role_grants.manage, roll.propose, roll.approve,
-- directory.view_hidden, org_features.manage, people.manage,
-- officers.manage) would recreate exactly the "one office, every capability"
-- wildcard concentration DECISION-080/DECISION-101 exist to interrupt. So
-- this pipeline mints a NEW role, brand_admin, rather than extending
-- stated_clerk. This migration seeds only the global, non-tenant
-- permission-catalog row, parallel to how
-- drizzle/0029_presby_officers_permission.sql seeded officers.manage here
-- rather than in scripts/seed-dev.sql (DECISION-063: `permissions` carries no
-- organization_id and needs no org to exist first, unlike `app_roles`/
-- `role_grants`). The brand_admin role, its app_role_permissions binding, and
-- its role_grants row (direct-granted to Marguerite Ashcombe at Alder Creek,
-- not Tobias Renwick — see that file's own comment) are fixture inserts in
-- scripts/seed-dev.sql, not this migration.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

insert into permissions (key, module, description, sensitivity_tier)
values ('branding.manage', 'branding',
        'Set this organization''s brand colour, logo, type pairing, and light-only mode', 1)
on conflict (key) do nothing;
