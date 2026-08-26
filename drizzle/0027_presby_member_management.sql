-- Member management, Increment 1 (docs/work-log/2026-08-25-member-management.md,
-- Phase 3 Deliverable B): the people.manage permission-catalog row.
--
-- Permission-catalog-only. Phase 2's architectural ruling ("Composite tenant
-- keys / schema") found no schema change is needed for Increment 1:
-- `roll_actions_pending_idx (organization_id, effective_date) where
-- approval_status='pending'` already serves the approve/deny worklist, and
-- every target table already carries correct composite FKs (F2). `roll.propose`
-- and `roll.approve` already exist in the permission catalog (DECISION-078,
-- drizzle/0018_presby_role_administration.sql's era) — no new row for either.
--
-- No fixture binding here — matching drizzle/0025_presby_deacon_linkage.sql's
-- and drizzle/0026_presby_org_feature_toggles.sql's precedent: app_roles/
-- role_grants are org-scoped and have no production seeding surface yet. The
-- stated_clerk fixture binding (added to the existing grant that already
-- holds roll.propose) lives in scripts/seed-dev.sql.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md), so every migration past 0012 is hand-authored and
-- must be idempotent.

-- `permissions` carries no organization_id — global, code-seeded, never
-- tenant-writable (src/lib/db/domain/authz.ts) — matching how
-- drizzle/0017_presby_membership_roster.sql seeded directory.view,
-- drizzle/0018_presby_role_administration.sql seeded role_grants.manage,
-- drizzle/0025_presby_deacon_linkage.sql seeded directory.view_hidden, and
-- drizzle/0026_presby_org_feature_toggles.sql seeded org_features.manage
-- here rather than in scripts/seed.ts.
insert into permissions (key, module, description, sensitivity_tier)
values ('people.manage', 'people',
        'Create and edit people, households, and contact/address detail', 1)
on conflict (key) do nothing;
