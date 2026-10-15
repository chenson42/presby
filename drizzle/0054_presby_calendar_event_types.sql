-- drizzle/0054_presby_calendar_event_types.sql
--
-- Member calendar with event types (docs/work-log/2026-10-14-member-calendar.md,
-- Phase 3 / DECISION-160 / DECISION-161; findings F132, F133, F135).
--
-- Eight things, in dependency order. The whole file is idempotent: every
-- statement is `if not exists`, `on conflict do nothing`, drop-then-add, or
-- guarded by `where not exists`, so it replays cleanly (including as an
-- in-place correction while this migration is unreleased, CLAUDE.md ->
-- Project Layout -> drizzle/).
--
--   1. event_types            the per-org taxonomy (D8-compatible, tag-shaped)
--   2. events.event_type_id   composite FK, NO ACTION (DECISION-161)
--   3. organization_settings.time_zone   the zone in which "now" is read
--   4. settings-row backfill  (F132: 13 of 15 dev orgs had no row)
--   5. permission catalog     events.view, event_types.manage (DECISION-063)
--   6. events.view backfill   every org-owned `member` role (operator ruling 3)
--   7. calendar toggle rows   ON for every existing org (DECISION-160)
--   8. event_types backfill   mirrors eventTypeSeedPlan() per organization type
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * It writes no audit row. A migration backfill is provisioning, like every
--     other provisioning seed (DECISION-161, R7).
--   * It does not touch the six columns DECISION-113 froze on `events`.
--   * It does not convert any stored `starts_at`. `time_zone` is the zone in
--     which NOW is read, never a conversion of event times (DECISION-160).
--   * It cannot reach an org that has no `member` role (F133) or any org
--     created after this file runs; createOrganization() covers the latter.
--
-- scripts/seed-dev.sql runs AFTER migrations on a fresh database (CI), when no
-- organization exists yet, so every backfill below is a no-op there and the
-- seed file carries a mirror block. Keep the two in step.

-- ---------------------------------------------------------------------------
-- 1. event_types
-- ---------------------------------------------------------------------------
create table if not exists event_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  color text not null,
  icon text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  -- Exactly one per org (partial unique index below). The type an untyped
  -- event renders and filters as. "At least one" cannot be a constraint, so it
  -- is `paper` in /developer; the calendar must render with zero types.
  is_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  -- Composite Tenant Keys (F2): the target of events_event_type_fk.
  constraint event_types_id_org_key unique (id, organization_id)
);

-- CHECKs are drop-then-add (the drizzle/0048 idiom), not inline, so an
-- in-place correction of an unreleased migration actually changes them.
alter table event_types drop constraint if exists event_types_name_shape;
alter table event_types add constraint event_types_name_shape
  check (name = btrim(name) and char_length(name) between 1 and 60);

-- The closed palette: the nine keys of CATEGORY_KEYS in
-- src/lib/brand/contract.ts. Widening it takes a migration AND a contract
-- change; src/lib/events/type-palette.test.ts pins this list to the
-- TypeScript one by reading this very line.
alter table event_types drop constraint if exists event_types_color_allowed;
alter table event_types add constraint event_types_color_allowed
  check (color in ('rose','orange','amber','lime','teal','sky','violet','fuchsia','neutral'));

-- The closed icon list: EVENT_TYPE_ICONS in src/lib/events/type-palette.ts,
-- every name verified present in the installed lucide-react (1.16.0).
alter table event_types drop constraint if exists event_types_icon_allowed;
alter table event_types add constraint event_types_icon_allowed
  check (icon in ('Church','Sparkles','Music','BookOpen','Backpack','Utensils','HeartHandshake','Gavel','CalendarDays','HandHeart','HandHelping','Users','Coffee','Baby','Mic'));

alter table event_types drop constraint if exists event_types_fallback_active;
alter table event_types add constraint event_types_fallback_active
  check (not is_fallback or is_active);

-- `neutral` is RESERVED for the fallback, in both directions: the fallback is
-- always neutral and nothing else may be, so "uncategorized" never consumes
-- one of the eight categorical colors (fpcw-directory's rule, made a CHECK).
alter table event_types drop constraint if exists event_types_neutral_is_fallback;
alter table event_types add constraint event_types_neutral_is_fallback
  check ((color = 'neutral') = is_fallback);

-- Names are unique per org case-insensitively, and the index covers RETIRED
-- rows too: a retired "Worship" keeps its name reserved, so reactivating it
-- can never produce a second "Worship".
create unique index if not exists event_types_org_lower_name_idx
  on event_types (organization_id, lower(name));

create unique index if not exists event_types_one_fallback_idx
  on event_types (organization_id) where is_fallback;

alter table event_types enable row level security;
alter table event_types force row level security;

drop policy if exists tenant_isolation on event_types;
create policy tenant_isolation on event_types
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- No DELETE, for either connection: a type is retired, never removed. FK
-- cascades from organizations run as the table owner and need no grant. The
-- explicit revoke makes an in-place re-apply correct a database where a
-- delete grant was ever added by hand.
grant select, insert, update on event_types to presby_app, presby_platform;
revoke delete on event_types from presby_app, presby_platform;

comment on table event_types is
  'Per-org event taxonomy (DECISION-161): an org''s own values for one platform-designed, tier-1 attribute of an event, with a closed palette (CATEGORY_KEYS) and closed icon list - the tags shape D8 already permits, not a custom field. Never hard-deleted (no DELETE grant): retire with is_active = false. Exactly one is_fallback row per org by partial unique index; "at least one" is paper (the calendar renders correctly with zero rows). neutral is reserved for the fallback by CHECK.';
comment on column event_types.is_fallback is
  'The type an untyped event renders and filters as. At most one per org (event_types_one_fallback_idx); must be active; must be neutral and nothing else may be (event_types_neutral_is_fallback).';

-- ---------------------------------------------------------------------------
-- 2. events.event_type_id
-- ---------------------------------------------------------------------------
-- Nullable: an untyped event is legal and renders as the fallback type.
-- Composite FK per Composite Tenant Keys (F2), default NO ACTION - NOT
-- `on delete set null` (which would null the NOT NULL organization_id half of
-- the key) and NOT RESTRICT (checked immediately, so it can fail the
-- deletable_until fixture cascade that removes events and event_types in one
-- statement). Nothing deletes an event_type; NO ACTION defers the check to the
-- end of the statement and the cascade passes. MATCH SIMPLE: a NULL
-- event_type_id is never checked.
alter table events add column if not exists event_type_id uuid;

alter table events drop constraint if exists events_event_type_fk;
alter table events add constraint events_event_type_fk
  foreign key (event_type_id, organization_id) references event_types (id, organization_id);

create index if not exists events_org_type_idx on events (organization_id, event_type_id);

comment on column events.event_type_id is
  'Optional event type (DECISION-161). NULL = untyped, rendered and filtered as the org''s is_fallback type. Composite FK (event_type_id, organization_id), NO ACTION.';

-- ---------------------------------------------------------------------------
-- 3. organization_settings.time_zone
-- ---------------------------------------------------------------------------
-- The zone in which "now" is read: today's highlight, the default month, the
-- Today link, and the home card's "upcoming" test. NEVER used to convert a
-- stored starts_at (those are wall-clock - DECISION-113 ruling 3).
alter table organization_settings
  add column if not exists time_zone text not null default 'America/New_York';

-- Two clauses, and the first is not optional: Postgres accepts POSIX strings
-- ('UTC+5', with the sign inverted) and bare abbreviations ('EST') that
-- Intl.DateTimeFormat reads differently or refuses. The second clause makes
-- Postgres refuse a name its own tzdata does not know (timezone(text,
-- timestamp) is IMMUTABLE on PG 18, so it is legal in a CHECK). AND does not
-- promise evaluation order, so an unknown name may surface as 22023
-- invalid_parameter_value rather than 23514 check_violation; both mean "no".
alter table organization_settings drop constraint if exists organization_settings_time_zone_valid;
alter table organization_settings add constraint organization_settings_time_zone_valid
  check (
    time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
    and (timestamp '2000-01-01' at time zone time_zone) is not null
  );

comment on column organization_settings.time_zone is
  'IANA zone in which "now" is read for this org (today, the default calendar month, "upcoming"). Never converts a stored event time. Default America/New_York (US-only scope, D6); set by a platform admin in v1, no org-admin UI. A missing settings row means the default (F132) - the reader falls back, the contract does not depend on the row existing.';

-- ---------------------------------------------------------------------------
-- 4. A default settings row for every organization (F132)
-- ---------------------------------------------------------------------------
-- 13 of the 15 organizations on the pipeline branch had NO row, so the column
-- default above is "missing", not "defaulted", for most orgs. The reader falls
-- back to the default regardless (that is the contract); this backfill and
-- createOrganization()'s insert make the common case a real row. Behaviour-
-- neutral for 2FA: presby_two_factor_required() inner-joins this table, and a
-- default row has require_two_factor = false, exactly what no row meant.
insert into organization_settings (organization_id)
select o.id from organizations o
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Permission catalog rows (DECISION-063: permissions carry no org)
-- ---------------------------------------------------------------------------
-- events.view: tier 1, read-only - the member-facing read path the events
-- module never had (every read required events.manage). event_types.manage:
-- tier 1, deliberately NO default binding (mirrors fpcw-directory; the
-- feature is inert until a stated clerk grants it; an unmanaged taxonomy is
-- how two real church calendars reached 16 and 25 categories). Neither is
-- Rule-7 audited (DECISION-113 ruling 5 extended by DECISION-161).
insert into permissions (key, module, description, sensitivity_tier)
values
  ('events.view', 'events',
   'View the member calendar and the details of upcoming events', 1),
  ('event_types.manage', 'events',
   'Create, rename, recolor, reorder and retire the event types that color-code the calendar', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. events.view on every org-owned baseline `member` role (operator ruling 3)
-- ---------------------------------------------------------------------------
-- A permission nobody holds is a dead tile: there is no "all members" arm in
-- the resolver. `member` is the baseline role createOrganization() seeds with
-- directory.view (DECISION-100). Org-owned rows only - a template role
-- (organization_id is null) would be cloned, not granted. Tier 1, read-only,
-- the same class as directory.view. Reaches only orgs that HAVE a member role
-- (F133: 2 of 15 on the pipeline branch); the rest see the calendar's
-- "not available to your account" state until a stated clerk grants it.
insert into app_role_permissions (role_id, permission_key)
select r.id, 'events.view'
  from app_roles r
 where r.key = 'member' and r.organization_id is not null
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. org_portal.calendar toggle rows, ON for every existing organization
-- ---------------------------------------------------------------------------
-- DECISION-160: the calendar has no platform flag; the per-org toggle is its
-- only on/off switch. Stored as explicit rows (not a code default) so
-- DECISION-097's "missing row = off" stays unconditional. updated_by is null
-- (a provisioning write, no acting user) - the column is nullable for this.
insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
select o.id, 'org_portal.calendar', true, null
  from organizations o
on conflict (organization_id, feature_key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. event_types backfill, mirroring eventTypeSeedPlan(organizationType)
-- ---------------------------------------------------------------------------
-- Congregations and new worshiping communities get the standard set (fpcw's
-- nine: five active including the neutral "General" fallback). Presbytery,
-- synod and general_assembly get the fallback ONLY - nobody there holds
-- event_types.manage to remove congregation-flavoured active types.
-- Guarded per org by `not exists`, so it never resurrects a type an org
-- removed or undoes a rename on replay. src/lib/events/type-seed-plan.ts is
-- the TypeScript twin; src/lib/events/type-palette.test.ts pins the VALUES
-- below to it, and src/lib/event-types.test.ts RE-EXECUTES the block between
-- the markers against fixture orgs of every type.
-- BEGIN backfill-event-types
insert into event_types (organization_id, name, color, icon, sort_order, is_active, is_fallback)
select o.id, v.name, v.color, v.icon, v.sort_order, v.is_active, v.is_fallback
  from organizations o
  join (values
    ('Worship',                       'teal',    'Church',         10, true,  false),
    ('Special Services and Holidays', 'violet',  'Sparkles',       20, false, false),
    ('Music',                         'fuchsia', 'Music',          30, false, false),
    ('Classes and Bible Study',       'sky',     'BookOpen',       40, true,  false),
    ('Youth and Children',            'lime',    'Backpack',       50, true,  false),
    ('Meals and Fellowship',          'amber',   'Utensils',       60, false, false),
    ('Mission and Outreach',          'rose',    'HeartHandshake', 70, false, false),
    ('Committees',                    'orange',  'Gavel',          80, true,  false),
    ('General',                       'neutral', 'CalendarDays',   99, true,  true)
  ) as v(name, color, icon, sort_order, is_active, is_fallback)
    on (v.is_fallback
        or o.organization_type in ('congregation', 'new_worshiping_community'))
 where not exists (select 1 from event_types et where et.organization_id = o.id)
on conflict do nothing;
-- END backfill-event-types
