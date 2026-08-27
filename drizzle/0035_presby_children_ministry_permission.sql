-- Children's ministry, Increment A (docs/work-log/2026-08-26-childrens-ministry.md,
-- Phase 3 / DECISION-111 / DECISION-114). Permission-catalog row only — no
-- table/trigger/index change (Phase 3's own "Data Model" section: children
-- stay ordinary people/memberships rows, guardian linking reuses the
-- existing global person_relationships table).
--
-- Number re-verified against `ls drizzle/` immediately before this file was
-- written (Phase 3's own instruction — concurrent pipelines have collided on
-- the next-free number repeatedly this session, e.g. docs/TODO.md's 0031
-- collision entry). 0034_presby_directory_permission_copy.sql was the latest
-- on disk at that check; this file claims 0035.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent — `on conflict (key) do nothing`,
-- same pattern as every other permission-catalog migration this session
-- (0029/0030/0031/0032/0033).
--
-- children.roster (tier 2): binds to a NEW constitutional, protected role,
-- children_ministry_admin (scripts/seed-dev.sql fixture, not this migration —
-- DECISION-063's established split), deliberately separate from
-- member_care_admin so a Sunday-school coordinator can see the roster
-- without also getting medical.manage's allergy data (Phase 1's own
-- requirement, DECISION-111 ruling 2). Same permission gates both reads and
-- writes of person_relationships guardian-link rows for this increment
-- (DECISION-111 ruling 2 / DECISION-114) — the first application-level
-- gating this global table has ever had.

-- Description discloses the DECISION-114 DOB-unmasking scope at grant time
-- (Phase 6 finding): an org admin assigning this permission should know it
-- shows each child's full birthdate even where hide_birthday is set, without
-- having to read source to find out.
insert into permissions (key, module, description, sensitivity_tier)
values ('children.roster', 'children',
        'View the children''s roster (including each child''s full birthdate, even when hidden from the directory) and manage guardian links', 2)
on conflict (key) do nothing;
