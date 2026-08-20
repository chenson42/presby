-- P9 commit 1 (tenant administration surface): the bootstrap permission.
--
-- DECISION-066 (docs/decisions.md): role_grants.manage cannot bootstrap onto
-- session_member (the derived Session group) without handing every sitting
-- elder simultaneous power to grant/revoke administrative access on no
-- individual act of designation. The new constitutional role that actually
-- carries this permission (`stated_clerk`) is fixture-seeded in
-- scripts/seed-dev.sql, same as DECISION-063 kept `directory.view`'s one real
-- binding fixture-only pending G-B (real org provisioning, still unbuilt).
-- This migration seeds only the global, non-tenant permission-catalog row
-- itself — parallel to how drizzle/0017_presby_membership_roster.sql seeded
-- `directory.view` here rather than in scripts/seed.ts (DECISION-063: `
-- permissions` carries no organization_id and needs no org to exist first,
-- unlike `app_roles`/`role_grants`).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md), so every migration past 0012 is hand-authored and
-- must be idempotent.

insert into permissions (key, module, description, sensitivity_tier)
values ('role_grants.manage', 'authz',
        'Grant or revoke a role at this organization', 1)
on conflict (key) do nothing;
