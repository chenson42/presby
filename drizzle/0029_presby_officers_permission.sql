-- Officer-terms administration (docs/work-log/2026-08-26-groups-and-officers.md)
-- Phase 4 commit 1 (database-admin): the officers.manage permission-catalog
-- row.
--
-- DECISION-078's test, applied per Phase 3's own wording: does this belong to
-- the Clerk of Session's actual constitutional duty (G-3.0204(b), the
-- register of who serves and when), or is stated_clerk just the only
-- administratively-empowered office that happens to exist? Officer-term
-- recording IS the register itself, a tighter fit than roll.propose already
-- passed. No new role is minted; this migration seeds only the global,
-- non-tenant permission-catalog row, parallel to how
-- drizzle/0017_presby_membership_roster.sql seeded directory.view and
-- drizzle/0018_presby_role_administration.sql seeded role_grants.manage here
-- rather than in scripts/seed.ts (DECISION-063: `permissions` carries no
-- organization_id and needs no org to exist first, unlike `app_roles`/
-- `role_grants`). The stated_clerk binding (app_role_permissions) is a
-- fixture insert in scripts/seed-dev.sql, not this migration — Tobias
-- Renwick's existing direct stated_clerk grant already carries the new
-- permission for free, the same "no new role_grants row" outcome
-- roll.propose/people.manage/org_features.manage/directory.view_hidden's
-- bindings already established.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

insert into permissions (key, module, description, sensitivity_tier)
values ('officers.manage', 'officers',
        'Record and end Session/Diaconate/administrative officer terms', 1)
on conflict (key) do nothing;
