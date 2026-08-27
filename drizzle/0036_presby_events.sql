-- Events model, Increment 1 (docs/work-log/2026-08-26-events-model.md, Phase
-- 4 commit 1 / DECISION-113 / DECISION-115). New table + permission-catalog
-- row only — no trigger, no data migration. `events` becomes presby's first
-- real calendar table: one flat row per discrete occurrence, FORCE RLS
-- tenant-isolated, matching every other tenant table's standard policy shape.
--
-- Migration-numbering note: Phase 3 penciled this as 0035_presby_events.sql,
-- but a fresh `ls drizzle/` at the moment this file was written found
-- 0035_presby_children_ministry_permission.sql already on disk (that
-- pipeline's own database-admin commit, landed concurrently and not
-- reflected in Phase 3's own read). This file was authored as 0036 from the
-- start rather than being renumbered after the fact — same "sequence
-- explicitly, don't let two pipelines guess the same number" discipline
-- drizzle/0032_presby_role_definitions.sql's own header documents for the
-- 0031 collision.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. events table.
-- ---------------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  description text,
  location text,
  -- Wall-clock local time, no tz (DECISION-113 ruling 3).
  starts_at timestamp not null,
  ends_at timestamp,
  is_public boolean not null default true,
  -- FROZEN check-in contract column (DECISION-113 ruling 4). Children's-
  -- ministry Increment C's FK must be the composite (event_id,
  -- organization_id) against events_id_org_key below.
  allows_checkin boolean not null default false,
  -- The one legitimate timestamptz column here (an instant, not a schedule
  -- fact) — DECISION-113 ruling 3's own carve-out.
  cancelled_at timestamptz,
  -- Plain (non-composite) self-referential FK (DECISION-115 ruling 3) — the
  -- same-org property is enforced entirely at the application layer, an
  -- accepted narrow deviation from Composite Tenant Keys (same class as
  -- group_memberships.officer_term_id, DECISION-060).
  parent_event_id uuid references events(id),
  -- Convenience generation string only, never parsed at read time
  -- (DECISION-113 ruling 1). Set only on a series' first (parent) row.
  recurrence_pattern text,
  recurrence_count integer,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_id_org_key unique (id, organization_id)
);

create index if not exists events_org_starts_idx on events (organization_id, starts_at);
create index if not exists events_org_parent_idx on events (organization_id, parent_event_id);

-- ---------------------------------------------------------------------------
-- 2. FORCE RLS, standard tenant-isolation policy (matching drizzle/
--    0026_presby_org_feature_toggles.sql's own hand-written single-table
--    shape — 0009's loop-generated array is frozen to its original table
--    list; every table added since gets its own migration block).
-- ---------------------------------------------------------------------------
alter table events enable row level security;
alter table events force row level security;

drop policy if exists tenant_isolation on events;
create policy tenant_isolation on events
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on events to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. events.manage permission-catalog row.
-- ---------------------------------------------------------------------------
-- `permissions` carries no organization_id (DECISION-063) and needs no org to
-- exist first, so it is seeded once, globally, here — parallel to
-- drizzle/0029_presby_officers_permission.sql's officers.manage row and
-- drizzle/0033_presby_groups_administration.sql's groups.manage row.
--
-- Tier 1, NOT Rule-7 audited (DECISION-113 ruling 5 — content configuration,
-- matching the replaceOrganizationServiceTimes/setOrganizationProfile
-- precedent). No default role binding (DECISION-115 — DECISION-078's test:
-- no PC(USA) office is the constitutional keeper of the congregation's
-- calendar, same reasoning DECISION-110 used for groups.manage). Fixture-only
-- grant to stated_clerk lives in scripts/seed-dev.sql (full-stack-developer's
-- own commit), commented there as a test-reachability convenience only, not
-- a production default.
insert into permissions (key, module, description, sensitivity_tier)
values ('events.manage', 'events',
        'Create, edit, and cancel calendar events, including repeating series',
        1)
on conflict (key) do nothing;
