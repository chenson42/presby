-- Role & permissions administration (docs/work-log/2026-08-26-role-
-- permissions-admin.md), Phase 4 commit 1 (database-admin). Four schema
-- changes, all landing together since they're one feature's schema surface
-- (Phase 3 Data Model):
--
--   1. app_roles.deactivated_at   — soft-deactivation column. Role deletion
--      through the new admin UI is NEVER a hard DELETE: role_grants.role_id
--      -> app_roles.id is onDelete: cascade, and a hard delete would destroy
--      historical (ended) role_grants rows, contradicting revokeRole()'s own
--      append-only contract (DECISION-106 ruling 4). The FK's onDelete:
--      cascade itself is a standing latent risk, tracked in docs/TODO.md
--      (`onDelete: restrict` recommended for a future migration), not fixed
--      here.
--   2. permissions: roles.manage  — the new permission-catalog row (module
--      authz, tier 1), distinct from role_grants.manage (DECISION-106
--      ruling 2). Global, code-seeded, no organization_id — same pattern as
--      drizzle/0029_presby_officers_permission.sql /
--      drizzle/0030_presby_branding_permission.sql.
--   3. app_roles RLS split   — found during Phase 3 design, not Phase 1/2:
--      app_roles carries the standard loop-generated tenant_isolation policy
--      from drizzle/0009_presby_rls.sql (organization_id =
--      presby_current_org()). For a template row organization_id is NULL,
--      and `NULL = presby_current_org()` evaluates to NULL (falsy) under
--      every org context — the organization_type_scope/organization_id IS
--      NULL template columns are not merely unused, they are structurally
--      UNREADABLE by presby_app today, regardless of any application code.
--      Flow 5b (template adoption) is unimplementable without this fix. This
--      migration replaces the single policy on app_roles ONLY (following
--      drizzle/0028_presby_people_write_rls_fix.sql's exact idempotent
--      single-table-override pattern, not a rewrite of the 0009 shared loop)
--      with a widened SELECT (own org OR organization_id IS NULL) and
--      unchanged INSERT/UPDATE/DELETE (own org only — a tenant can never
--      write a template row through presby_app, mirroring organizations'
--      "public tree, no tenant write" shape).
--   4. committee_chair template row  — Flow 5b's actual catalog. One stock
--      role (organization_id IS NULL, organization_type_scope IS NULL —
--      applies to any org type), carrying directory.view only, the same
--      permission property_chair's existing fixture role already carries —
--      a genuine, safe, demonstrable template, not an invented placeholder.
--      Seeded directly here (global catalog data, like `permissions` rows —
--      needs no organization to exist first), with a fixed id so this
--      insert is idempotent without relying on the (organization_id, key)
--      unique constraint, which treats NULL organization_id as distinct on
--      every re-run and would not otherwise prevent a duplicate.
--
-- The new role_admin role (the fixture binding for roles.manage — DECISION-
-- 109), its app_role_permissions binding, its role_grants row, and the fresh
-- fixture person it binds to are scripts/seed-dev.sql inserts, not this
-- migration — app_roles/role_grants are org-scoped and have no production
-- seeding surface yet (same posture drizzle/0027_presby_member_management.sql's
-- own comment already states for people.manage).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.
--
-- Migration-numbering note: this is 0032, NOT 0031. 0031 looked free by
-- docs/TODO.md's In Flight list (which named no concurrent schema pipeline)
-- and by drizzle/meta/_journal.json (last entry 0030), but a live check of
-- the working tree at the moment this file was written found
-- drizzle/0031_presby_sensitive_info_permissions.sql already present on disk
-- — uncommitted, full-stack-developer's own Phase 4 schema commit for
-- docs/work-log/2026-08-26-member-sensitive-info.md, landed concurrently and
-- not yet reflected in any doc this pipeline read. This file was originally
-- authored as 0031 and renumbered to 0032 once the collision was found,
-- exactly the "sequence explicitly, don't let two pipelines guess the same
-- number" case CLAUDE.md's Common Commands section calls out (the v0.6-wave
-- near-collision). No content in this file otherwise changed.

-- ---------------------------------------------------------------------------
-- 1. Soft-deactivation column.
-- ---------------------------------------------------------------------------
alter table app_roles
  add column if not exists deactivated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Permission-catalog row.
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier)
values ('roles.manage', 'authz',
        'Create, edit the permission set of, and deactivate this organization''s custom roles',
        1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. app_roles RLS split — widen SELECT to include the global template
--    catalog (organization_id IS NULL); INSERT/UPDATE/DELETE stay own-org-only.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation on app_roles;
drop policy if exists app_roles_select on app_roles;
drop policy if exists app_roles_insert on app_roles;
drop policy if exists app_roles_update on app_roles;
drop policy if exists app_roles_delete on app_roles;

create policy app_roles_select on app_roles for select
  using (organization_id = presby_current_org() or organization_id is null);

create policy app_roles_insert on app_roles for insert
  with check (organization_id = presby_current_org());

create policy app_roles_update on app_roles for update
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

create policy app_roles_delete on app_roles for delete
  using (organization_id = presby_current_org());

-- grant unchanged (already select, insert, update, delete to presby_app from
-- the 0009 loop) — a policy split does not need a new grant statement.

-- ---------------------------------------------------------------------------
-- 4. committee_chair template row + its permission binding.
-- ---------------------------------------------------------------------------
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000001', null, null,
        'committee_chair', 'Committee Chair', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000001', 'directory.view')
on conflict (role_id, permission_key) do nothing;
