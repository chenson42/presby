-- Groups administration (docs/work-log/2026-08-26-groups-admin.md)
-- Phase 4 commit 1 (database-admin): closes both trigger gaps DECISION-110
-- (Phase 2, ruling 3) found by direct read of drizzle/0009_presby_rls.sql,
-- and seeds the groups.manage permission-catalog row.
--
-- This is the first pipeline to give application code an arbitrary-user-input
-- path into groups/group_memberships. "The Court Is Not a Group" is a
-- `trigger`-class invariant at /developer, not `paper` — so both gaps found
-- during Phase 2's read are fixed here, in the database, not left to the
-- application layer alone (which stays as defense-in-depth in
-- src/lib/groups.ts, not a substitute).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- Gap 1: DELETE of an already-derived group_memberships row was unguarded.
-- ---------------------------------------------------------------------------
-- The original guard (drizzle/0009_presby_rls.sql) is:
--   if src = 'derived' and coalesce(new.source, old.source) <> 'derived' then
--     raise ...
--   end if;
-- For a DELETE, `new` is null, so `coalesce(new.source, old.source)` reads
-- back `old.source`. On an already-derived row that is 'derived', so
-- 'derived' <> 'derived' is false and the row deletes unblocked — the guard
-- only ever caught an UPDATE converting `source` AWAY from 'derived', never a
-- DELETE of a row that was already derived. Confirmed by direct read before
-- writing this fix (Phase 3's own instruction).
--
-- Fixed by special-casing tg_op = 'delete' first: if the row being deleted was
-- already derived, reject unconditionally, before ever falling through to the
-- original (still-needed, unchanged) INSERT/UPDATE branch below.
create or replace function presby_reject_derived_group_write()
returns trigger language plpgsql as $$
declare src text;
begin
  -- TG_OP is uppercase ('INSERT'/'UPDATE'/'DELETE'/'TRUNCATE'), not lowercase
  -- — caught by running this migration's own regression test (scripts/
  -- test-rls.sql section 25) against a live database before this comment was
  -- written; the lowercase-literal version silently never matched and the
  -- DELETE fell through unrejected. Same "caught by running it, not by
  -- reading a raw SQL predicate" discipline F26/DECISION-109's own findings
  -- already established.
  if tg_op = 'DELETE' and old.source = 'derived' then
    raise exception
      'group_memberships: % is a derived-group membership row; it projects from officer_terms and cannot be deleted directly',
      old.id
      using errcode = 'check_violation';
  end if;

  select membership_source into src from groups
   where id = coalesce(new.group_id, old.group_id);
  if src = 'derived' and coalesce(new.source, old.source) <> 'derived' then
    raise exception
      'group_memberships: % is a derived group; its roster projects from officer_terms',
      coalesce(new.group_id, old.group_id)
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

-- The trigger itself is unchanged (still before insert or update or delete);
-- only the function body above changed. Re-declared for clarity and to keep
-- this migration self-contained and idempotent on a re-run.
drop trigger if exists group_memberships_reject_derived on group_memberships;
create trigger group_memberships_reject_derived
  before insert or update or delete on group_memberships
  for each row execute function presby_reject_derived_group_write();

-- ---------------------------------------------------------------------------
-- Gap 2: nothing guarded a direct UPDATE of a derived groups row's own
-- name/description/meets_when. No trigger of any kind existed on `groups`
-- before this migration.
-- ---------------------------------------------------------------------------
create or replace function presby_reject_derived_group_edit()
returns trigger language plpgsql as $$
begin
  if old.membership_source = 'derived'
     and (new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.meets_when is distinct from old.meets_when) then
    raise exception
      'groups: % is a derived group (Session/Board of Deacons/Active Membership); its name, description, and meeting schedule are not editable directly',
      old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists groups_reject_derived_edit on groups;
create trigger groups_reject_derived_edit
  before update on groups
  for each row execute function presby_reject_derived_group_edit();

-- ---------------------------------------------------------------------------
-- groups.manage permission-catalog row.
-- ---------------------------------------------------------------------------
-- `permissions` carries no organization_id (DECISION-063) and needs no org to
-- exist first, so it is seeded once, globally, here — parallel to
-- drizzle/0029_presby_officers_permission.sql's officers.manage row and
-- drizzle/0030_presby_branding_permission.sql's branding.manage row.
--
-- DECISION-110 ruling 2: single permission (no definition/assignment split —
-- group_role grants nothing, group_types isn't tenant-extensible), tier 1
-- (committee membership is public-register-adjacent, not tier 2/3), no
-- default role binding (DECISION-078's test fails every existing PC(USA)
-- office). scripts/seed-dev.sql's fixture grant of this key to stated_clerk
-- is a test-reachability convenience only, commented there as such — not a
-- recommended production default.
insert into permissions (key, module, description, sensitivity_tier)
values ('groups.manage', 'groups',
        'Create and edit managed groups (committees, small groups, choirs, teams) and manage their rosters',
        1)
on conflict (key) do nothing;
