-- Member edit: tiered sensitive information (docs/work-log/
-- 2026-08-26-member-sensitive-info.md) Phase 4 commit 1 (database-admin
-- style permission-catalog change, folded into this pipeline's
-- full-stack-developer commit per the Phase 3 Implementation Order): the four
-- new tier-3 permission-catalog rows, plus retirement of the orphaned
-- `pastoral.notes.view` key.
--
-- DECISION-108 (tech-lead, Phase 3): four fixed, already-modeled tables --
-- person_notes, person_demographics, person_medical, person_disabilities --
-- have carried zero read/write path since the original domain design. Each
-- gets its own table-level permission key rather than one blanket
-- "view_sensitive" wildcard (architect's Phase 2 ruling): pastoral_notes.manage
-- gates person_notes, demographics.manage gates person_demographics,
-- medical.manage gates person_medical, disabilities.manage gates
-- person_disabilities. All four sensitivity_tier = 3 -- pastoral/demographic/
-- medical sits ABOVE financial data per the schema's own tiering.
--
-- Running DECISION-078's constitutional-duty test surfaced a real,
-- previously undetected duplicate: `pastoral.notes.view` -- a tier-3
-- permission seeded ONLY in scripts/seed-dev.sql, bound to installed_pastor,
-- and never wired to any read/write path in the app -- already existed for
-- this exact table. Rather than run two overlapping keys for the same data,
-- this migration retires it and supersedes it with pastoral_notes.manage on
-- the same office. Never migration-seeded before now, so no production data
-- depends on it -- both deletes are idempotent no-ops if the row is already
-- gone (a fresh database that never ran scripts/seed-dev.sql has nothing to
-- delete here).
--
-- `permissions` carries no organization_id -- global, code-seeded, never
-- tenant-writable (src/lib/db/domain/authz.ts) -- matching how
-- drizzle/0029_presby_officers_permission.sql and
-- drizzle/0030_presby_branding_permission.sql seeded their own single rows
-- here rather than in scripts/seed.ts (DECISION-063). The app_roles/
-- app_role_permissions/role_grants fixture bindings (installed_pastor,
-- stated_clerk, and the new member_care_admin role direct-granted to Aldous
-- Fennimore) are fixture inserts in scripts/seed-dev.sql, not this migration.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

insert into permissions (key, module, description, sensitivity_tier)
values
  ('pastoral_notes.manage', 'pastoral',
   'Read and add pastoral care notes for a person', 3),
  ('demographics.manage', 'demographics',
   'Enter and edit SASR demographic data for a person', 3),
  ('medical.manage', 'medical',
   'Enter and edit children''s-safety medical info for a person', 3),
  ('disabilities.manage', 'disabilities',
   'Enter and edit per-person disability records', 3)
on conflict (key) do nothing;

-- Retire the orphaned, never-wired key -- superseded by pastoral_notes.manage
-- on the same office (installed_pastor), not run alongside it.
delete from app_role_permissions where permission_key = 'pastoral.notes.view';
delete from permissions where key = 'pastoral.notes.view';
