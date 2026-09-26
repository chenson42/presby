-- drizzle/0051_presby_group_types_catalog.sql
--
-- DECISION-151 / F84-F86 (docs/work-log/2026-09-26-group-types-catalog.md).
-- Reclassifies group_types from a drizzle/0009 tenant_tables member to a
-- global catalog — the permissions/features/roles/sasr_form_versions shape.
-- Fixes forward in drizzle/0048's idempotent single-table-override style.
-- 0009's shared tenant_tables array is NOT edited (drizzle/0048:258's own
-- rule) — a from-scratch replay is 0009 (enable+force+tenant_isolation) ->
-- 0048 (four-policy split) -> 0051 (drop, disable, revoke), landing on the
-- same terminal state DECISION-150's from-empty rehearsal checks.
--
-- *** MUST BE REPLAYED AFTER 0048 in any drift-remediation re-run, same
-- *** ordering rule 0048 itself states at its own header. 0051 defines no
-- *** function, so it does not reopen 0048's proconfig-stripping hazard.
-- ***
-- *** SUPERSEDES: 0048 section 2's paired 25-name C-3 allow-list text (now
-- *** 26 — group_types joins it; the "kept in sync" pact from section 2's
-- *** own comment now means scripts/test-rls.sql's copy is 26, 0048's is
-- *** historical); section 5's four-policy split (dropped below); section
-- *** 7's "DELIBERATELY EXCLUDED... cannot be composite" comment on
-- *** groups.group_type_id (now simply inapplicable — no org axis on the
-- *** parent to be composite against, same footing as
-- *** app_role_permissions.permission_key -> permissions.key).
--
-- Whole-file idempotent; no statement widens a privilege on re-run.

-- 1. Pre-flight guard. Phase 1 demonstrated a tenant can mint a non-NULL
--    organization_id row TODAY under the shipped 0048 policies; a shipped
--    environment or a contributor's branch may carry one. Dropping the
--    column would silently promote a smuggled row to global, and if two
--    orgs independently minted the same key, the unique (key) add below
--    would fail mid-migration with a confusing constraint-violation error
--    instead of a diagnosable one. Refuse instead of masking.
--
--    Guarded on the column's own existence so the whole file stays
--    idempotent: on a second run the column is already gone and there is
--    nothing left to check.
do $$
declare
  smuggled_count int;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'group_types'
       and column_name = 'organization_id'
  ) then
    execute 'select count(*) from group_types where organization_id is not null'
      into smuggled_count;
    if smuggled_count > 0 then
      raise exception 'drizzle/0051: % org-scoped group_types row(s) found (organization_id is not null). '
        'DECISION-110 ruling 1 permits no per-org group type. Before re-running this migration: '
        'inspect these rows, repoint any groups.group_type_id referencing them to the matching '
        'platform-wide (organization_id is null) row by key, then delete the org-scoped row(s).',
        smuggled_count;
    end if;
  end if;
end $$;

-- 2. Drop the four 0048 policies and the original tenant_isolation policy,
--    all if exists (0009 created tenant_isolation; 0048 replaced it).
drop policy if exists tenant_isolation on group_types;
drop policy if exists group_types_select on group_types;
drop policy if exists group_types_insert on group_types;
drop policy if exists group_types_update on group_types;
drop policy if exists group_types_delete on group_types;

-- 3. Remove RLS entirely — both statements, so the catalog tuple matches
--    permissions/features/roles/sasr_form_versions exactly. `no force`
--    alone would satisfy the C-3 catch-all but leave a half-state nothing
--    else in the schema has.
alter table group_types no force row level security;
alter table group_types disable row level security;

-- 4. Drop the old composite unique, then the column. The column drop takes
--    its own FK (group_types_organization_id_organizations_id_fk) with it —
--    no separate `drop constraint` for that FK is needed or issued.
alter table group_types drop constraint if exists group_types_org_key;
alter table group_types drop column if exists organization_id;

-- 5. The new key-only uniqueness. Plain `unique`, no NULLS NOT DISTINCT:
--    `key` is NOT NULL, so the clause would be noise and would misleadingly
--    imply a nullable column. `group_types_key_key` is both Postgres's own
--    default name for this constraint and the house `<table>_<cols>_key`
--    pattern — keeping the old name would make the constraint lie about its
--    columns.
alter table group_types drop constraint if exists group_types_key_key;
alter table group_types add constraint group_types_key_key unique (key);

-- 6. Narrow presby_app to SELECT-only, matching every other global catalog.
--    presby_platform is untouched — it retains 0009's blanket CRUD grant on
--    every table (verified live on `permissions`); narrowing it here would
--    smuggle an unrelated second decision into this diff (that role's
--    login-or-drop question is Security §B follow-up 7, tracked separately).
revoke insert, update, delete on group_types from presby_app;
grant select on group_types to presby_app;
