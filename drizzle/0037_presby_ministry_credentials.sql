-- Ministry credentials & pastoral appointments (docs/work-log/
-- 2026-08-26-presbytery-functionality.md, Increment 2, Phase 4 commit 1
-- (database-admin) / DECISION-112 (architect) / DECISION-116 (tech-lead)).
--
-- Four schema changes, landing together since they're one increment's
-- schema surface (Phase 3 Data Model):
--
--   1. credential_status enum + ordinations.status column — nullable-in-
--      spirit-but-NOT-NULL-with-a-default column distinct from endedOn/
--      endedReason (those model TRUE removal from ordered ministry; status
--      models everything short of that — honorably retired, on leave,
--      etc.). Values adapted verbatim from psvonline-portal's
--      credentialStatusEnum (proven prior art).
--   2. appointment_call_type enum + new `appointments` table — the third
--      "who serves in what capacity" shape in src/lib/db/domain/officers.ts,
--      OWNED BY THE PRESBYTERY (the composite person FK can only resolve
--      there, D1/F2, exactly like ordinations' own FK). servingOrgId is a
--      plain FK to organizations (legal — organizations is the one
--      cross-tenant-readable structural table, schema-design.md section
--      17). FORCE ROW LEVEL SECURITY + the standard tenant_isolation policy
--      shape, matching every tenant table added since the 0009 loop was
--      frozen (drizzle/0026, drizzle/0036 are the two most recent examples
--      of this same single-table hand-written shape).
--   3. credentials.manage permission-catalog row (module officers, tier 1) —
--      gates BOTH the ordination-status UI and the appointments UI
--      (DECISION-116 ruling 1: one key, not a split — both are the same
--      constitutional register-keeping duty, G-3.0304, performed by the
--      same office on the same page).
--   4. presbytery_stated_clerk TEMPLATE role row (organization_id IS NULL,
--      organization_type_scope = 'presbytery') + its app_role_permissions
--      binding to credentials.manage — the first
--      organization_type_scope = 'presbytery' template this codebase has
--      shipped, seeded via the already-wired listTemplateRoles/adoptTemplate
--      machinery (DECISION-109), so no new admin UI is needed to grant it.
--      Deliberately a DIFFERENT key from the congregation-scoped
--      `stated_clerk` (DECISION-116 ruling 2) — `app_roles`' unique
--      (organization_id, key) doesn't deduplicate two NULL-org rows sharing
--      a literal key, so a distinct key removes any doubt for the next
--      reader of app_roles rather than relying on that non-enforcement.
--      Seeded directly here (global catalog data, needs no organization to
--      exist first), with a fixed id so this insert is idempotent without
--      relying on that same non-unique-across-NULL constraint — same
--      precedent as drizzle/0032_presby_role_definitions.sql's
--      committee_chair template row.
--
-- Migration-numbering note: Phase 3 penciled this as
-- 0035_presby_ministry_credentials.sql. A fresh `ls drizzle/` immediately
-- before this file was written found BOTH 0035 and 0036 already claimed on
-- disk — 0035_presby_children_ministry_permission.sql (children's ministry's
-- own database-admin commit) and 0036_presby_events.sql (the events
-- pipeline's) — neither reflected in this pipeline's own Phase 3 read. This
-- file claims 0037, the next actually-free number, and is authored as 0037
-- from the start rather than renumbered after the fact, matching
-- drizzle/0036_presby_events.sql's own precedent for the identical situation
-- one collision earlier — itself following the "sequence explicitly, don't
-- let two pipelines guess the same number" discipline
-- drizzle/0032_presby_role_definitions.sql's header first documented for the
-- 0031 collision.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent. This is the FIRST hand-written
-- migration in this session to introduce a new enum type (every prior
-- hand-written table addition — officer_terms' `office`,
-- drizzle/0036_presby_events.sql's `recurrence_pattern` — used plain text
-- columns instead); Postgres has no `CREATE TYPE IF NOT EXISTS`, so the
-- idempotent idiom below is the standard `DO $$ ... EXCEPTION WHEN
-- duplicate_object THEN null; END $$;` guard.

-- ---------------------------------------------------------------------------
-- 1. credential_status enum + ordinations.status column.
-- ---------------------------------------------------------------------------
do $$ begin
  create type credential_status as enum (
    'active',
    'honorably_retired',
    'on_leave',
    'exempt_from_active_service',
    'disciplined',
    'removed',
    'deceased'
  );
exception
  when duplicate_object then null;
end $$;

alter table ordinations
  add column if not exists status credential_status not null default 'active';

-- ---------------------------------------------------------------------------
-- 2. appointment_call_type enum + the appointments table.
-- ---------------------------------------------------------------------------
do $$ begin
  create type appointment_call_type as enum (
    'installed_pastor',
    'designated_pastor',
    'stated_supply',
    'interim_pastor',
    'temporary_supply',
    'parish_associate'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  -- The PRESBYTERY, forced (D1/F2) — never the serving congregation.
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null,
  -- Plain FK — organizations is the one cross-tenant-readable structural
  -- table (section 17). The application layer validates this is an actual
  -- member congregation of the recording presbytery (parent_id +
  -- organization_type check) before insert; the DB does not enforce that
  -- relationship itself.
  serving_org_id uuid not null references organizations(id),
  call_type appointment_call_type not null,
  starts_on date not null,
  -- null = current/open-ended appointment.
  ends_on date,
  end_reason text,
  minute_reference text,
  -- Nullable: same F24 reasoning as officer_terms.recorded_by — an imported
  -- historical appointment has no acting user to attribute it to.
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  constraint appointments_id_org_key unique (id, organization_id),
  constraint appointments_person_fk
    foreign key (person_id, organization_id)
    references memberships (person_id, organization_id)
);

create index if not exists appointments_org_person_idx
  on appointments (organization_id, person_id);
create index if not exists appointments_serving_org_idx
  on appointments (serving_org_id, starts_on, ends_on);

alter table appointments enable row level security;
alter table appointments force row level security;

drop policy if exists tenant_isolation on appointments;
create policy tenant_isolation on appointments
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on appointments to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. credentials.manage permission-catalog row.
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier)
values ('credentials.manage', 'officers',
        'Record ordination status changes and pastoral appointments for this presbytery',
        1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. presbytery_stated_clerk TEMPLATE role row + its permission binding.
--    organization_id IS NULL, organization_type_scope = 'presbytery' — the
--    first presbytery-scoped template this codebase has shipped. Readable by
--    every tenant via the widened app_roles SELECT policy
--    (drizzle/0032_presby_role_definitions.sql), adopted through the
--    already-wired listTemplateRoles/adoptTemplate UI at
--    /admin/roles/new — no new backend or admin surface needed.
-- ---------------------------------------------------------------------------
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000002', null, 'presbytery',
        'presbytery_stated_clerk', 'Stated Clerk', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000002', 'credentials.manage')
on conflict (role_id, permission_key) do nothing;
