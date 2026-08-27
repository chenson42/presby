-- Presbytery Increment 0 (docs/work-log/2026-08-26-presbytery-functionality.md,
-- Phase 4 "Increment 0" section): copy-only fix found during the first
-- hand-walk of the generic org portal as a presbytery-type organization.
--
-- `permissions.description` for `directory.view` read "Browse the
-- congregation directory" — every organization type (congregation,
-- presbytery, synod) grants this permission and the description surfaces
-- verbatim in the role-catalog and create-role UI (Tier 1 checklist) for
-- ALL org types, so a presbytery admin building a custom role saw
-- congregation-flavored copy describing their own presbytery's directory.
-- "the directory" is neutral and correct for every org type; no other
-- rewrite needed.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent. A plain UPDATE run twice is a no-op
-- the second time (same target value), so no guard clause is needed beyond
-- matching on the primary key.

update permissions
   set description = 'Browse the directory'
 where key = 'directory.view'
   and description = 'Browse the congregation directory';
