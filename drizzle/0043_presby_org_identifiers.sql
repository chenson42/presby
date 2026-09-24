-- Organization identifiers (D24) — increment 1 of the lifecycle/affiliation/
-- returns pipeline (docs/work-log/2026-09-24-lifecycle-affiliation-returns.md,
-- Phase 3 Data Model "Increment 1"; DECISION-135 through DECISION-139;
-- docs/schema-design-2.md sec 2b).
--
-- Two changes, both low risk and with no trigger or grant dependencies:
--
--   1. `organization_identifiers` — the one place an organization's EXTERNAL
--      identifiers live (OGA church PIN, psvonline congregation id, legacy
--      import keys). Identity data about a public org-tree entry, so it
--      carries NO RLS, exactly like `organizations` itself
--      (docs/schema-design.md sec 17). This is deliberate and is the reason
--      the table exists at all: `pcusa_pin` was on `organization_settings`,
--      which IS tenant-isolated, so the presbytery running an import could
--      not read a congregation's own PIN — the identifier a cross-council
--      importer needs most.
--   2. `organization_settings.pcusa_pin` is moved into it and dropped.
--
-- NOT DONE HERE, deliberately — `alter table organizations drop column
-- status` (F35). Phase 3's Data Model calls the column "the unused
-- pre-provisioning status column". It is NOT unused: five shipped
-- SECURITY DEFINER functions gate an ANONYMOUS public read on
-- `o.status = 'active'` —
--   drizzle/0020_presby_public_sites.sql:160      presby_published_site()
--   drizzle/0021_presby_site_profile.sql:233      presby_published_site()
--   drizzle/0024_presby_published_site_light_only.sql:62  presby_published_site()
--   drizzle/0041_presby_public_staff_directory.sql:70,83  presby_public_staff_directory()
--   drizzle/0042_presby_public_directory_primitives.sql:83,96,146
-- Postgres does not record column dependencies inside function bodies, so
-- the DROP would SUCCEED and every public site would start failing at
-- request time, not at migration time. The column's real successor is
-- `organizations.lifecycle_status` (increment 2 below), so the drop is a
-- rewrite of those five functions, not a one-line DDL — flagged as a
-- loop-back to Phase 3 in the work-log's Implementer Notes rather than
-- silently taken or silently skipped.
--
-- Hand-written per CLAUDE.md: Drizzle Kit emits no RLS, no partial index of
-- this shape and no data move, so every migration past 0012 is hand-authored
-- and must be idempotent.
--
-- Migration-numbering note: `ls drizzle/` was run immediately before this
-- file was written and found 0042_presby_public_directory_primitives.sql as
-- the highest claimed number, with no gap and no second pipeline's file on
-- disk. This migration claims 0043; increment 2 claims 0044 in the same pass
-- (both journal entries added together, so the 0039/0040 near-collision
-- cannot repeat inside this pipeline).

-- ---------------------------------------------------------------------------
-- 1. organization_identifiers
-- ---------------------------------------------------------------------------
create table if not exists organization_identifiers (
  id uuid primary key default gen_random_uuid(),
  -- PLAIN FK by design, and NOT a tenant scope. This column is the "which
  -- organization is this identifier for" column, the same structural
  -- exception congregation_oversight.about_org_id already takes
  -- (docs/schema-design.md sec 17 / F2). Do not "fix" it into a composite
  -- tenant FK: this table has no tenant column to compose against.
  organization_id uuid not null references organizations(id) on delete cascade,
  -- pcusa_pin | psvonline_congregation_id | church360 | legacy_import
  kind text not null,
  value_normalized text not null,
  is_verified boolean not null default false,
  source text,
  created_at timestamptz not null default now()
);

-- Only VERIFIED identifiers are globally unique. An unverified import
-- candidate may legitimately collide with a verified row (that is the
-- collision the resolution step exists to settle); a verified one may not.
create unique index if not exists organization_identifiers_kind_value_verified_idx
  on organization_identifiers (kind, value_normalized) where is_verified;
create index if not exists organization_identifiers_org_idx
  on organization_identifiers (organization_id);

-- No RLS: same visibility class as `organizations` itself.
--
-- CORRECTED 2026-09-24 (F47 / DECISION-140, fourth Phase 3 loop-back). The
-- first build granted `select, insert, update, delete` to presby_app with no
-- RLS at all, which meant any tenant connection could rewrite or erase ANOTHER
-- organization's identifier row — including flipping `is_verified`, the column
-- the partial unique index above makes globally significant. presby_app is
-- narrowed to SELECT; the sole tenant-side writer is
-- presby_set_organization_identifier() (section 3 below).
--
-- presby_platform KEEPS select, insert, update, delete, unchanged. Same
-- accepted-risk class as its DML grants on organization_affiliations and
-- organization_successions: a statement of intent for the day a real,
-- non-owner presby_platform login role exists, inert today because
-- PLATFORM_DATABASE_URL authenticates as neondb_owner, which owns the table
-- and holds every privilege independent of any grant (F44 / Ruling B3). That
-- is also why the grant narrowing below is the BELT and the trigger in
-- section 4 is the BUCKLE.
revoke insert, update, delete on organization_identifiers from presby_app;
grant select on organization_identifiers to presby_app;
grant select, insert, update, delete on organization_identifiers
  to presby_platform;

comment on table organization_identifiers is
  'External identifiers for an organization (OGA church PIN, psvonline congregation id, legacy import keys). D24. Deliberately NOT tenant-isolated — identity data about a public org-tree entry, same class as organizations. pcusa_pin lived on organization_settings (tenant-isolated) until drizzle/0043, where a cross-council importer running as the presbytery could not read it. presby_app holds SELECT ONLY (F47/DECISION-140): presby_set_organization_identifier() is the sole tenant-side writer and organization_identifiers_guard refuses every UPDATE and DELETE outside it, on EVERY connection including the owner.';

-- ---------------------------------------------------------------------------
-- 2. Move pcusa_pin off organization_settings
-- ---------------------------------------------------------------------------
-- Guarded so a re-run after the column is gone is a no-op rather than an
-- error. `is_verified = true`: a PIN already hand-entered into a
-- congregation's own settings row is an asserted fact about itself, not an
-- import candidate.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'organization_settings' and column_name = 'pcusa_pin'
  ) then
    execute $move$
      insert into organization_identifiers
        (organization_id, kind, value_normalized, is_verified, source)
      select s.organization_id, 'pcusa_pin', s.pcusa_pin, true,
             'migrated from organization_settings.pcusa_pin (drizzle/0043)'
        from organization_settings s
       where s.pcusa_pin is not null
         and not exists (
           select 1 from organization_identifiers i
            where i.organization_id = s.organization_id
              and i.kind = 'pcusa_pin'
              and i.value_normalized = s.pcusa_pin
         )
    $move$;
  end if;
end $$;

alter table organization_settings drop column if exists pcusa_pin;

-- ---------------------------------------------------------------------------
-- 3. presby_set_organization_identifier() — the ONLY tenant-side writer (F47)
-- ---------------------------------------------------------------------------
-- ADDED 2026-09-24 as a migration correction in place (F47 / DECISION-140,
-- same file and same number per this pipeline's own precedent, Ruling A5.1 /
-- F46 — drizzle/0043 is on main but has never been applied to production).
--
-- The confused-deputy shape every write path in this pipeline uses
-- (presby_transfer_affiliation(), presby_publish_sasr_snapshot()): the
-- function accepts NO acting-council id. The actor is presby_current_org(),
-- already membership-verified by withOrgContext() before this function is
-- reachable, and there is nothing in the signature a caller could spoof.
--
-- STANDING, two cases and no more:
--   * the actor IS the subject — an organization may assert and verify its
--     own external identifiers; or
--   * the actor has affiliation standing OVER the subject as of today
--     (presby_org_affiliated) — the onboarding case a presbytery performs
--     when it records a member congregation's OGA PIN. `presby_org_affiliated`
--     walks the whole ancestry, so a synod over a presbytery over a
--     congregation also qualifies, which is the polity.
-- Anything else raises the TABLE'S OWN literal through
-- presby_deny_identifier_change() — one literal per table, DECISION-139's
-- discipline. It is deliberately NOT presby_deny_affiliation_change()'s
-- string: this table carries no EXCLUDE constraint, so F40's specific
-- cross-tenant existence-oracle risk does not transfer, but sharing a literal
-- would still invite a reader to assume the two tables' rejection surfaces are
-- interchangeable when they are not.
--
-- `is_verified` has no separate mechanism because it needs none: this
-- function is the only sanctioned writer, so "settable only here" is a
-- consequence of the grant plus the guard rather than a third rule.
--
-- FORWARD REFERENCE, DELIBERATE AND SAFE. presby_org_affiliated() ships in
-- drizzle/0044, one migration LATER than this file. plpgsql resolves function
-- names at EXECUTION time, not at CREATE FUNCTION time, so this definition is
-- accepted on a fresh database applying 0043 before 0044 and the call
-- resolves the first time the function actually runs — by which point 0044
-- has been applied. (A `language sql` body would NOT be safe this way; that
-- is why this is plpgsql.) Anything that tried to CALL this function between
-- 0043 and 0044 on a fresh apply would fail, and nothing does: there is no
-- application caller, and neither scripts/seed-dev.sql nor
-- src/lib/org-provisioning.ts writes an identifier row.
create or replace function presby_deny_identifier_change()
returns void language plpgsql as $$
begin
  raise exception 'organization_identifiers: this change is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

revoke all on function presby_deny_identifier_change() from public;
grant execute on function presby_deny_identifier_change() to presby_app;

create or replace function presby_set_organization_identifier(
  p_organization_id uuid,
  p_kind text,
  p_value_normalized text,
  p_is_verified boolean default false,
  p_source text default null
) returns uuid
language plpgsql security definer as $$
declare
  v_actor uuid := presby_current_org();
  v_id    uuid;
begin
  if v_actor is null
     or p_organization_id is null
     or p_kind is null
     or p_value_normalized is null
  then
    perform presby_deny_identifier_change();
  end if;

  if v_actor is distinct from p_organization_id
     and not presby_org_affiliated(p_organization_id, v_actor, current_date)
  then
    perform presby_deny_identifier_change();
  end if;

  -- Transaction-local, exactly like presby.affiliation_trigger_active. A
  -- session-scoped GUC would leave the guard DISARMED for the next unrelated
  -- request on a pooled neon-serverless connection.
  perform set_config('presby.identifier_trigger_active', 'true', true);

  -- UPSERT on (organization_id, kind, value_normalized) — the triple that
  -- identifies the CLAIM. Not (organization_id, kind): an organization may
  -- legitimately hold several identifiers of one kind (two legacy_import
  -- keys from two source systems), and keying on the pair would silently
  -- overwrite one claim with another rather than recording both.
  select i.id into v_id
    from organization_identifiers i
   where i.organization_id = p_organization_id
     and i.kind = p_kind
     and i.value_normalized = p_value_normalized;

  if v_id is null then
    insert into organization_identifiers
      (organization_id, kind, value_normalized, is_verified, source)
    values
      (p_organization_id, p_kind, p_value_normalized, p_is_verified, p_source)
    returning id into v_id;
  else
    update organization_identifiers
       set is_verified = p_is_verified,
           source = coalesce(p_source, source)
     where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function presby_set_organization_identifier(uuid, text, text, boolean, text) from public;
grant execute on function presby_set_organization_identifier(uuid, text, text, boolean, text) to presby_app;

comment on function presby_set_organization_identifier(uuid, text, text, boolean, text) is
  'The sole tenant-side writer for organization_identifiers (F47/DECISION-140). Takes no acting-council id: the actor is presby_current_org(). Permitted when the actor IS the subject organization or holds affiliation standing over it (presby_org_affiliated as of today). Upserts on (organization_id, kind, value_normalized) and is the only path through which is_verified may be set. Every rejection raises one uniform literal via presby_deny_identifier_change().';

-- ---------------------------------------------------------------------------
-- 4. organization_identifiers_guard — the buckle (F47 / F44)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER is NOT used here and does not need to be: the trigger
-- reads no table at all, only a GUC. (Every DEFINER function in this pipeline
-- that reads a FORCE-RLS table is DEFINER for F26 reasons — an invoker-mode
-- reader is filtered by the very RLS it exists to complement and silently
-- sees zero rows. This function reads nothing, so the F26 shape cannot
-- arise.) It fires on EVERY connection regardless: BYPASSRLS and table
-- OWNERSHIP both exempt a role from RLS policies and from grants, never from
-- triggers — which is the whole reason this exists rather than the revoke
-- above being treated as sufficient (F44 / Ruling B3 / DECISION-140).
--
-- SCOPE IS UPDATE AND DELETE ONLY, deliberately narrower than the external
-- review's prose. Those are the two operations its own example names ("change
-- or delete Congregation B's OGA PIN"). INSERT is left ungated beyond the
-- grant narrowing: a colliding `is_verified = true` INSERT is already refused
-- by organization_identifiers_kind_value_verified_idx, and an INSERT of a
-- FALSE, unverified claim about another org is the same bounded,
-- presby_platform-only residual this pipeline has accepted elsewhere.
-- Engineering a bootstrap-vs-tenant distinction into an INSERT guard is more
-- machinery than today's problem needs; named as an accepted residual in
-- docs/TODO.md rather than solved here.
--
-- NEW GUC, not a reuse of presby.affiliation_trigger_active: unrelated
-- subsystem, unrelated table, no shared transaction in practice. Reusing it
-- would make one flag mean two unrelated "am I inside a sanctioned path"
-- claims — a false economy, unlike the affiliation/organizations reuse in
-- 0044, where it is the SAME function, the SAME transaction and the same
-- actual claim.
create or replace function presby_guard_organization_identifiers()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('presby.identifier_trigger_active', true), '') <> 'true' then
    perform presby_deny_identifier_change();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists organization_identifiers_guard on organization_identifiers;
create trigger organization_identifiers_guard
  before update or delete on organization_identifiers
  for each row execute function presby_guard_organization_identifiers();
