-- P1 commit 1 (tenant permissions + org portal): the baseline-grant mechanism.
--
-- G-A (docs/work-log/2026-08-19-tenant-permissions-portal.md, Phase 1):
-- role_grants requires an explicit person_id/group_id row per grantee, which
-- does not scale to "every active member can view the directory." DECISION-060
-- resolves this with a new derived group, `active_membership`, materialized
-- from `memberships` by trigger — parallel to Session/Diaconate, routing
-- through the resolver's existing arm 2 (drizzle/0010) completely unmodified.
--
-- Unlike `officer_term_id` (drizzle/0009) — a pre-existing, unconstrained gap,
-- flagged for a future database-admin review, not fixed here — the new
-- `membership_id` column gets a real composite FK to
-- memberships(id, organization_id). DECISION-060 names this explicitly as the
-- gap not to repeat.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md), so every migration past 0012 is hand-authored and
-- must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. group_memberships.membership_id
-- ---------------------------------------------------------------------------
alter table group_memberships add column if not exists membership_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'group_memberships_membership_key'
  ) then
    alter table group_memberships
      add constraint group_memberships_membership_key unique (membership_id);
  end if;
end $$;

-- The composite FK officer_term_id never got (DECISION-060). memberships
-- already carries unique (id, organization_id) — memberships_id_org_key
-- (src/lib/db/domain/people.ts) — as the target.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'group_memberships_membership_fk'
  ) then
    alter table group_memberships
      add constraint group_memberships_membership_fk
      foreign key (membership_id, organization_id)
      references memberships (id, organization_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The permission catalog row
-- ---------------------------------------------------------------------------
-- `permissions` carries no organization_id — global, code-seeded, never
-- tenant-writable (src/lib/db/domain/authz.ts:24). `directory.view` was
-- previously fixture-only (scripts/seed-dev.sql); this migration makes it real
-- in every environment db:migrate reaches, matching how 0009/0010 already
-- treat "global catalog, seeded by migration" as the migration's job.
insert into permissions (key, module, description, sensitivity_tier)
values ('directory.view', 'directory', 'Browse the congregation directory', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. presby_sync_derived_membership_group()
-- ---------------------------------------------------------------------------
-- Mirrors presby_sync_derived_group() (drizzle/0009_presby_rls.sql) exactly:
-- fails loudly if the org's active_membership derived group is missing (F16 —
-- the same discipline, deliberately not softened) rather than silently
-- skipping, which would leave a baseline grant silently absent and no error.
--
-- `ended_on is null` is the sole "is this current" predicate (DECISION-065) —
-- no new, competing definition of "current" invented here. `starts_on` uses
-- `new.created_at::date`, `ends_on` uses `new.ended_on` verbatim; memberships
-- has no starts_on column of its own to mirror officer_terms' starts_on with.
--
-- presby_reject_derived_group_write() (drizzle/0009) needs no change — it
-- already guards on membership_source = 'derived' regardless of which
-- derived_from kind produced the row.
create or replace function presby_sync_derived_membership_group()
returns trigger language plpgsql as $$
declare
  target_group uuid;
begin
  select id into target_group from groups
   where organization_id = new.organization_id and derived_from = 'active_membership';

  if target_group is null then
    raise exception
      'organization % has no derived group active_membership; seed derived groups at org creation',
      new.organization_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into group_memberships
    (organization_id, group_id, person_id, group_role, source,
     membership_id, starts_on, ends_on)
  values
    (new.organization_id, target_group, new.person_id, 'member', 'derived',
     new.id, new.created_at::date, new.ended_on)
  on conflict (membership_id) do update
    set ends_on = excluded.ends_on;

  return new;
end $$;

drop trigger if exists memberships_sync_derived_group on memberships;
create trigger memberships_sync_derived_group
  after insert or update on memberships
  for each row execute function presby_sync_derived_membership_group();
