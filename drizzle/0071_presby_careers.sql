-- drizzle/0071_presby_careers.sql
--
-- Careers, Increment 1: job postings and the public read
-- (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Data Model" and "API
-- Contract"; parent docs/work-log/2026-10-25-careers.md Phase 2;
-- DECISION-264/265/266 and the implementation entry DECISION-278; findings
-- F311-F320).
--
-- Eight things, in dependency order. The whole file is idempotent: every
-- statement is `if not exists`, `on conflict do nothing`, `where not exists`,
-- drop-then-add, `create or replace` (or drop-then-create), or
-- revoke-then-grant, so it replays cleanly, including as an in-place
-- correction while this migration is unreleased (CLAUDE.md -> Project Layout
-- -> drizzle/). Proven by applying the whole file twice (work-log, Phase 4
-- Batch 1).
--
--   1. permission catalog     careers.manage (tier 1), careers.applicants
--                             (tier 3), module `careers`
--   2. founding bundle        presby_founding_administrator_permission_keys()
--                             re-created with both keys after domains.manage
--                             (order = the TypeScript foundingAdministratorPlan()
--                             array), plus the 0057-style backfill onto every
--                             org-owned founding_administrator role (F292)
--   3. hiring_committee       a universal `custom` template carrying both keys,
--                             inserted BY KEY (no fixed id: D7)
--   4. job_postings           table, CHECKs, indexes
--   5. guards                 BEFORE INSERT / UPDATE / DELETE, all SECURITY
--                             INVOKER, all binding the OWNER too (F44)
--   6. RLS + grants           FORCE, tenant_isolation, column-limited
--                             presby_app grants, no DELETE anywhere
--   7. functions              presby_careers_org_today (helper),
--                             presby_public_careers (the one anonymous read),
--                             presby_careers_sweep (owner-only auto-close, v1)
--   8. comments
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored. Drizzle mirror: src/lib/db/domain/careers.ts.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No audit row: a migration is provisioning. Publish, close and reopen
--     write their audit rows in src/lib/careers/postings.ts, the sweep's in
--     src/lib/careers/sweep.ts (Batch 2).
--   * No applications, files or email objects: Increment 2, migration 0075.
--   * No org toggle row. org_portal.careers is toggle-only, provisioned OFF,
--     and a missing row means off; the toggle catalog is TypeScript
--     (ORG_FEATURE_CATALOG) and organization_feature_toggles.feature_key has
--     no CHECK (0026).
--   * No blob_assets use.
--   * Residual, `paper`: RLS enforces tenancy, not authorization, so a bug in
--     the app could show a DRAFT to any member of the same organization.
--     careers.manage is checked in the app, and drafts are tier-1 content.
--
-- DEVIATIONS FROM THE PHASE 3 TEXT (work-log Phase 4 Batch 1 records both):
--   * job_postings_complete_when_live tests `status <> 'published'`, not
--     `status = 'draft'`. The design's form refused the draft -> closed
--     "discard" edge for any draft with an empty summary, location or
--     description, which is exactly the draft somebody wants to throw away.
--     What the public can read is what must be complete, and only a
--     published row exposes those fields (a closed row projects slug and
--     title only).
--   * created_by / updated_by reference users(id) with NO ACTION, not
--     ON DELETE SET NULL. A set-null cascade is an UPDATE, which the update
--     guard refuses for created_by (immutable), so a user delete would fail
--     anyway; there is no orphan-recovery surface; and every comparable
--     provenance column (events.created_by, giving_gifts.recorded_by,
--     organization_domains.created_by_user_id) is plain NO ACTION.

-- ---------------------------------------------------------------------------
-- 1. permission catalog
-- ---------------------------------------------------------------------------
-- careers.manage is tier 1 (postings are public content). careers.applicants
-- is tier 3 (operator-confirmed, Q3): non-members' employment records,
-- contact details and third-party references, the pastoral/medical tier.
-- Neither implies the other. requires_two_factor stays at its default (false)
-- on both, matching the four existing tier-3 keys; it joins the tracked S2
-- follow-up as a member of that class. careers.applicants is checked by no
-- code until Increment 2 (0075). The 0030 `on conflict do nothing` form.
insert into permissions (key, module, description, sensitivity_tier)
values
  ('careers.manage', 'careers',
   'Create, edit, publish and close this organization''s job openings', 1),
  ('careers.applicants', 'careers',
   'Read and remove job applications, and download applicants'' resumes', 3)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. the founding-administrator bundle (F292, DECISION-265, operator Q4)
-- ---------------------------------------------------------------------------
-- 2a. The SQL authority. Same signature, return type, volatility, security
-- and search_path as drizzle/0059 section 5c; only the array grows. The
-- TypeScript foundingAdministratorPlan() is pinned EQUAL to this, in order,
-- for every organization_type (src/lib/db/domain/invitations.db.test.ts), and
-- the designation golden (designation-parity.golden.json) is regenerated in
-- the same batch. INTEGRATION HAZARD: two `create or replace`s of this
-- function with different arrays silently drop the first one's keys; the
-- second pipeline to merge must re-read the live body.
--
-- careers.applicants is the first key above tier 1 in this bundle. Accepted
-- `paper` residual (operator ruling Q4): the founding administrator can read
-- applications once Increment 2 ships, detected by the resume-download audit
-- row. Without the bundle, assertPermissionSubset() (F111) makes a key nobody
-- at an organization holds ungrantable there, so the hiring_committee
-- template below could never be adopted or granted.
create or replace function presby_founding_administrator_permission_keys(p_org_type text)
returns text[]
language sql
immutable
security definer
set search_path = public, pg_temp
as $function$
  select array['people.manage', 'roles.manage', 'role_grants.manage', 'groups.manage',
               'officers.manage', 'org_features.manage', 'tickets.file', 'staff.manage',
               'domains.manage', 'careers.manage', 'careers.applicants']::text[]
         || case when p_org_type = 'presbytery'
                 then array['congregation_oversight.manage']::text[]
                 else array[]::text[] end;
$function$;

revoke all on function presby_founding_administrator_permission_keys(text) from public, presby_app, presby_platform;

-- 2b. The 0057-style backfill: every founding_administrator role designated
-- before this file runs is topped up with both keys. Production and
-- development both hold zero such roles today; it exists for whatever is
-- designated before deploy. Residual, as 0057: a re-apply re-adds a key a
-- tenant removed from a designation-minted role. app_role_permissions'
-- giving guard ignores a non-giving key.
insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('careers.manage'), ('careers.applicants')) as k(key)
 where r.key = 'founding_administrator'
   and r.organization_id is not null
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. the hiring_committee template
-- ---------------------------------------------------------------------------
-- `custom`, not `constitutional`: it fails DECISION-078's test (no PC(USA)
-- office's duty is hiring), the giving_recorder precedent. Universal scope
-- (organization_type_scope null): presbyteries and synods hire too. Not
-- protected. Inserted by KEY with no fixed id (D7): template ids 1-6 are taken
-- and other pipelines are writing migrations, so a fixed id 7 would collide
-- at the second merge. app_roles_org_key (organization_id, key) does not
-- cover NULL organization_id, so `where not exists` is the idempotence guard.
insert into app_roles (organization_id, organization_type_scope, key, name, role_kind, is_protected)
select null, null, 'hiring_committee', 'Hiring Committee', 'custom', false
 where not exists (select 1 from app_roles where organization_id is null and key = 'hiring_committee');

insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('careers.manage'), ('careers.applicants')) as k(key)
 where r.organization_id is null
   and r.key = 'hiring_committee'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. job_postings
-- ---------------------------------------------------------------------------
create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  -- The cascade is reachable only through D10's guarded fixture teardown
  -- (organizations_guard_delete + deletable_until), exactly as
  -- organization_domains.
  organization_id uuid not null references organizations(id) on delete cascade,
  slug text not null,
  title text not null,
  summary text not null default '',
  location text not null default '',
  employment_type text not null default 'full_time',
  pay_min_cents integer,
  pay_max_cents integer,
  pay_unit text,
  description_md text not null default '',
  closing_date date,
  status text not null default 'draft',
  sort_order integer not null default 0,
  version integer not null default 1,
  posted_on date,
  first_published_at timestamptz,
  closed_at timestamptz,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite Tenant Keys (F2): the target of Increment 2's
  -- job_applications (posting_id, organization_id) FK.
  constraint job_postings_id_org_key unique (id, organization_id),
  constraint job_postings_org_slug_key unique (organization_id, slug)
);

-- CHECKs are drop-then-add (the drizzle/0048 idiom), not inline, so an
-- in-place correction of this unreleased migration actually changes them.

-- The public URL segment: lowercase alphanumerics and single hyphens, 1-80.
alter table job_postings drop constraint if exists job_postings_slug_shape;
alter table job_postings add constraint job_postings_slug_shape
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 80);

alter table job_postings drop constraint if exists job_postings_title_length;
alter table job_postings add constraint job_postings_title_length
  check (char_length(btrim(title)) between 1 and 150);

alter table job_postings drop constraint if exists job_postings_summary_length;
alter table job_postings add constraint job_postings_summary_length
  check (char_length(summary) <= 300);

alter table job_postings drop constraint if exists job_postings_location_length;
alter table job_postings add constraint job_postings_location_length
  check (char_length(location) <= 200);

alter table job_postings drop constraint if exists job_postings_description_length;
alter table job_postings add constraint job_postings_description_length
  check (char_length(description_md) <= 20000);

-- fpcw's three types; widening is a one-line drop-then-add.
alter table job_postings drop constraint if exists job_postings_employment_type_allowed;
alter table job_postings add constraint job_postings_employment_type_allowed
  check (employment_type in ('full_time', 'part_time', 'intern'));

alter table job_postings drop constraint if exists job_postings_pay_range;
alter table job_postings add constraint job_postings_pay_range
  check ((pay_min_cents is null or pay_min_cents between 0 and 100000000)
     and (pay_max_cents is null or pay_max_cents between 0 and 100000000)
     and (pay_min_cents is null or pay_max_cents is null or pay_min_cents <= pay_max_cents));

-- A unit exactly when at least one amount is given.
alter table job_postings drop constraint if exists job_postings_pay_unit_shape;
alter table job_postings add constraint job_postings_pay_unit_shape
  check ((pay_unit is null or pay_unit in ('hour', 'year'))
     and ((pay_unit is null) = (pay_min_cents is null and pay_max_cents is null)));

-- The last day applications are accepted, in the organization's zone.
alter table job_postings drop constraint if exists job_postings_closing_date_range;
alter table job_postings add constraint job_postings_closing_date_range
  check (closing_date is null or closing_date between date '2000-01-01' and date '2100-01-01');

alter table job_postings drop constraint if exists job_postings_status_allowed;
alter table job_postings add constraint job_postings_status_allowed
  check (status in ('draft', 'published', 'closed'));

-- What the public can read must be complete. Only a published row exposes
-- summary, location and description (a closed row projects slug and title
-- only), so a draft and a discarded draft may be incomplete. Deviation from
-- the Phase 3 text (`status = 'draft' or ...`), header note.
alter table job_postings drop constraint if exists job_postings_complete_when_live;
alter table job_postings add constraint job_postings_complete_when_live
  check (status <> 'published'
      or (btrim(summary) <> '' and btrim(location) <> '' and btrim(description_md) <> ''));

alter table job_postings drop constraint if exists job_postings_published_stamped;
alter table job_postings add constraint job_postings_published_stamped
  check (status <> 'published' or first_published_at is not null);

alter table job_postings drop constraint if exists job_postings_closed_stamped;
alter table job_postings add constraint job_postings_closed_stamped
  check ((status = 'closed') = (closed_at is not null));

alter table job_postings drop constraint if exists job_postings_posted_stamped;
alter table job_postings add constraint job_postings_posted_stamped
  check ((posted_on is null) = (first_published_at is null));

alter table job_postings drop constraint if exists job_postings_version_positive;
alter table job_postings add constraint job_postings_version_positive
  check (version >= 1);

-- The staff list and the public list both filter by (organization, status)
-- and order by sort_order.
create index if not exists job_postings_org_status_sort_ix
  on job_postings (organization_id, status, sort_order);

-- The sweep's scan: published rows that have a closing date.
create index if not exists job_postings_closing_due_ix
  on job_postings (closing_date)
  where status = 'published' and closing_date is not null;

-- ---------------------------------------------------------------------------
-- 5. guards
-- ---------------------------------------------------------------------------
-- All three are SECURITY INVOKER with search_path pinned: they lend no owner
-- privilege, and they bind EVERY connection, the owner's included (F44:
-- getPlatformDb() is neondb_owner, which no grant binds - only triggers do).
-- Error codes: every refusal by the insert and update guards is
-- check_violation (23514) with a `job_postings:` message prefix, so a caller
-- and the tests can tell a trigger refusal from a grant refusal
-- (insufficient_privilege, 42501). The delete guard raises
-- insufficient_privilege, the house idiom for "this record is permanent".
--
-- 5a needs presby_careers_org_today() (section 7) at FIRE time, not at
-- CREATE time: plpgsql bodies are not name-resolved when created.

-- 5a. BEFORE INSERT ----------------------------------------------------------
-- A posting is born a draft. version and the four trigger-owned stamps are
-- forced (presby_app holds no INSERT privilege on them in any case).
create or replace function presby_job_postings_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.status is distinct from 'draft' then
    raise exception 'job_postings: a posting is created as a draft (got %)', new.status
      using errcode = 'check_violation';
  end if;
  new.version := 1;
  new.first_published_at := null;
  new.posted_on := null;
  new.closed_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end
$function$;

-- 5b. BEFORE UPDATE ----------------------------------------------------------
-- In English, the rules this function enforces:
--   * id, organization_id, created_at and created_by never change.
--   * The status moves only along four edges: draft -> published (publish),
--     draft -> closed (discard), published -> closed (close),
--     closed -> published (reopen). Nothing ever returns to draft. An update
--     that leaves the status alone is not an edge.
--   * Entering published (publish or reopen), under a per-organization
--     transaction lock: refused when 100 OTHER published postings already
--     exist at the organization (D13), refused when the closing date is
--     before the organization's today; first_published_at is set once and
--     kept forever; posted_on is set once (the owner may supply it on that
--     first publish, for the Track K import; presby_app cannot name the
--     column); closed_at is cleared; the posting goes to the top of the
--     published order.
--   * Entering closed: closed_at is stamped now.
--   * Otherwise first_published_at, posted_on and closed_at keep their old
--     values, whatever the statement said.
--   * The slug may change only while the posting has never been published.
--   * version goes up by one and updated_at becomes now() exactly when a
--     content field or the status changed; a sort_order change alone (or an
--     updated_by change alone) bumps neither.
create or replace function presby_job_postings_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  -- D13: THE one definition of the per-organization published cap.
  -- src/lib/careers/contract.ts MAX_PUBLISHED_PER_ORG mirrors it.
  c_published_cap constant integer := 100;
  v_today date;
  v_count integer;
  v_top integer;
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'job_postings: id, organization_id, created_at and created_by are immutable'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status
     and not ((old.status = 'draft'     and new.status in ('published', 'closed'))
           or (old.status = 'published' and new.status = 'closed')
           or (old.status = 'closed'    and new.status = 'published')) then
    raise exception 'job_postings: % -> % is not a legal status change', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.slug is distinct from old.slug and old.first_published_at is not null then
    raise exception 'job_postings: the slug is fixed once a posting has been published'
      using errcode = 'check_violation';
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    -- Serialize every publish at this organization, then count in a snapshot
    -- taken after the lock is held (READ COMMITTED), so two concurrent
    -- publishes cannot both take the 100th place. The 0057 idiom: presby_app
    -- cannot take FOR UPDATE on organizations.
    perform pg_advisory_xact_lock(hashtextextended('job_postings:' || new.organization_id::text, 0));
    select count(*) into v_count
      from job_postings jp
     where jp.organization_id = new.organization_id
       and jp.status = 'published'
       and jp.id <> new.id;
    if v_count >= c_published_cap then
      raise exception 'job_postings: cap - at most % published postings per organization', c_published_cap
        using errcode = 'check_violation';
    end if;

    v_today := presby_careers_org_today(new.organization_id);
    if new.closing_date is not null and new.closing_date < v_today then
      raise exception 'job_postings: the closing date % has passed (today is %)', new.closing_date, v_today
        using errcode = 'check_violation';
    end if;

    new.first_published_at := coalesce(old.first_published_at, now());
    if old.posted_on is not null then
      new.posted_on := old.posted_on;
    else
      new.posted_on := coalesce(new.posted_on, v_today);
    end if;
    new.closed_at := null;

    select min(jp.sort_order) into v_top
      from job_postings jp
     where jp.organization_id = new.organization_id
       and jp.status = 'published'
       and jp.id <> new.id;
    new.sort_order := coalesce(v_top, 1) - 1;
  else
    new.first_published_at := old.first_published_at;
    new.posted_on := old.posted_on;
    if new.status = 'closed' and old.status is distinct from 'closed' then
      new.closed_at := now();
    else
      new.closed_at := old.closed_at;
    end if;
  end if;

  if (new.title, new.summary, new.description_md, new.location, new.employment_type,
      new.pay_min_cents, new.pay_max_cents, new.pay_unit, new.closing_date, new.slug, new.status)
     is distinct from
     (old.title, old.summary, old.description_md, old.location, old.employment_type,
      old.pay_min_cents, old.pay_max_cents, old.pay_unit, old.closing_date, old.slug, old.status) then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version;
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$function$;

-- 5c. BEFORE DELETE ----------------------------------------------------------
-- A posting is never deleted (D12, the operator's all-deletes-soft rule): a
-- draft nobody wants is discarded, which is a close. The one way out is the
-- sanctioned fixture teardown cascade: by the time the RI cascade fires, the
-- parent organizations row is already gone (and organizations_guard_delete
-- only lets that happen for a deletable_until fixture). The
-- presby_org_domains_guard_delete idiom, written out here.
create or replace function presby_job_postings_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception 'job_postings: postings are permanent; close them instead'
    using errcode = 'insufficient_privilege';
end
$function$;

revoke all on function presby_job_postings_guard_insert() from public, presby_app, presby_platform;
revoke all on function presby_job_postings_guard_update() from public, presby_app, presby_platform;
revoke all on function presby_job_postings_guard_delete() from public, presby_app, presby_platform;

drop trigger if exists job_postings_guard_insert on job_postings;
create trigger job_postings_guard_insert
  before insert on job_postings
  for each row execute function presby_job_postings_guard_insert();

drop trigger if exists job_postings_guard_update on job_postings;
create trigger job_postings_guard_update
  before update on job_postings
  for each row execute function presby_job_postings_guard_update();

drop trigger if exists job_postings_guard_delete on job_postings;
create trigger job_postings_guard_delete
  before delete on job_postings
  for each row execute function presby_job_postings_guard_delete();

-- ---------------------------------------------------------------------------
-- 6. RLS + grants
-- ---------------------------------------------------------------------------
alter table job_postings enable row level security;
alter table job_postings force row level security;

drop policy if exists tenant_isolation on job_postings;
create policy tenant_isolation on job_postings
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Revoke-then-grant (F38): a re-apply corrects a hand-added grant. REVOKE ALL
-- on a table also revokes every column-level privilege on it, so the column
-- lists below are re-established exactly.
revoke all on job_postings from public, presby_app, presby_platform;

-- presby_app: SELECT all; INSERT and UPDATE the staff-authored columns only.
-- Deliberately absent from both lists: the trigger-owned id, version,
-- posted_on, first_published_at, closed_at, created_at, updated_at; the
-- immutable created_by from UPDATE; sort_order from INSERT (a draft has no
-- place in the order; publishing assigns one). A
-- BEFORE trigger assigning NEW.x is not subject to the invoker's column
-- privileges (they are checked against the statement's target list), so the
-- stamps still land under presby_app: the organization_domains precedent.
-- No DELETE.
grant select on job_postings to presby_app;
grant insert (organization_id, slug, title, summary, location, employment_type,
              pay_min_cents, pay_max_cents, pay_unit, description_md, closing_date,
              created_by, updated_by)
  on job_postings to presby_app;
grant update (slug, title, summary, location, employment_type, pay_min_cents,
              pay_max_cents, pay_unit, description_md, closing_date, status,
              sort_order, updated_by)
  on job_postings to presby_app;

-- presby_platform: nothing (Two Hierarchies: no platform page reads careers
-- data). The sweep runs on the owner connection through an owner-only
-- definer, below.

-- ---------------------------------------------------------------------------
-- 7. functions
-- ---------------------------------------------------------------------------
-- 7a. The organization's calendar date. SECURITY DEFINER: organization_settings
-- is FORCE RLS and the anonymous path has no org GUC (F26). Falls back to the
-- literal 'America/New_York' for an organization with no settings row,
-- pinned equal to DEFAULT_ORG_TIME_ZONE (src/lib/shared/org-time.ts) by
-- src/lib/careers/public.db.test.ts (T6). EXECUTE to presby_app because the
-- update guard (invoker) and the staff lib call it. Accepted disclosure: it
-- answers a date derived from an organization's time zone, and the
-- default-zone date for an unknown id, so it is not an existence oracle.
create or replace function presby_careers_org_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select (now() at time zone coalesce(
            (select s.time_zone from organization_settings s where s.organization_id = p_org),
            'America/New_York'))::date;
$function$;

revoke all on function presby_careers_org_today(uuid) from public, presby_app, presby_platform;
grant execute on function presby_careers_org_today(uuid) to presby_app;

-- 7b. THE anonymous read (D5): the list (p_posting null) and one posting.
-- Always exactly one row. `state`:
--   unavailable  unknown slug, organization not active, site not live, the
--                toggle row missing or off, or the people category off while
--                the category axis is on. Byte-identical for every cause.
--   available    the list: at most 100 published postings that are open in
--                the organization's zone, named keys only.
--   open         one published, open posting: the 11 keys.
--   closed       an ever-published posting that is closed, or published past
--                its closing date: slug and title ONLY (D3).
--   not_found    the gate passed but p_posting is malformed, unknown, in
--                another organization, a draft or a discarded draft.
-- The toggle composition is exactly orgFeatureEnabledInTx's
-- (src/lib/org-features.ts): org_portal.careers has orgTypes null, so no
-- type allow-list; then the category axis (flag row missing = axis off;
-- category row missing = category on); then the toggle (row missing = off).
-- T6 pins the literals and the equivalence. Open is derived here, at read
-- time; the sweep's close is housekeeping, never the gate.
drop function if exists presby_public_careers(text, text);
create function presby_public_careers(p_slug text, p_posting text default null)
returns table (state text, organization_name text, contact_phone text, org_today text,
               postings_json jsonb, posting_json jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  c_cap constant integer := 100;                    -- PUBLIC_POSTINGS_CAP
  v_org record;
  v_today date;
  v_axis_on boolean;
  v_cat_ok boolean;
  v_on boolean;
  v_phone text;
  v_json jsonb;
  r record;
begin
  select o.id, o.name, o.status into v_org from organizations o where o.slug = p_slug;
  if not found or v_org.status is distinct from 'active'
     or not exists (select 1 from organization_sites s
                     where s.organization_id = v_org.id and s.status = 'live') then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  v_axis_on := coalesce((select f.enabled from feature_flags f
                          where f.key = 'org_portal.feature_categories'), false);
  v_cat_ok  := (not v_axis_on) or coalesce((select c.enabled from organization_feature_categories c
                          where c.organization_id = v_org.id and c.category = 'people'), true);
  v_on      := v_cat_ok and coalesce((select t.enabled from organization_feature_toggles t
                          where t.organization_id = v_org.id
                            and t.feature_key = 'org_portal.careers'), false);
  if not v_on then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  v_today := presby_careers_org_today(v_org.id);
  v_phone := (select p.phone from organization_profiles p where p.organization_id = v_org.id);

  if p_posting is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', x.slug, 'title', x.title, 'location', x.location,
             'employment_type', x.employment_type, 'pay_min_cents', x.pay_min_cents,
             'pay_max_cents', x.pay_max_cents, 'pay_unit', x.pay_unit, 'summary', x.summary,
             'posted_on', to_char(x.posted_on, 'YYYY-MM-DD'),
             'closing_date', to_char(x.closing_date, 'YYYY-MM-DD'))
           order by x.sort_order, x.posted_on desc, x.id), '[]'::jsonb)
      into v_json
      from (select jp.* from job_postings jp
             where jp.organization_id = v_org.id and jp.status = 'published'
               and (jp.closing_date is null or jp.closing_date >= v_today)
             order by jp.sort_order, jp.posted_on desc, jp.id
             limit c_cap) x;
    return query select 'available'::text, v_org.name::text, v_phone, to_char(v_today, 'YYYY-MM-DD'),
                        v_json, null::jsonb;
    return;
  end if;

  if char_length(p_posting) > 80 or p_posting !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return query select 'not_found'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  select jp.* into r from job_postings jp
   where jp.organization_id = v_org.id and jp.slug = p_posting and jp.first_published_at is not null;
  if not found then
    return query select 'not_found'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  if r.status = 'published' and (r.closing_date is null or r.closing_date >= v_today) then
    return query select 'open'::text, v_org.name::text, v_phone, to_char(v_today, 'YYYY-MM-DD'), null::jsonb,
      jsonb_build_object('slug', r.slug, 'title', r.title, 'location', r.location,
        'employment_type', r.employment_type, 'pay_min_cents', r.pay_min_cents,
        'pay_max_cents', r.pay_max_cents, 'pay_unit', r.pay_unit, 'summary', r.summary,
        'description_md', r.description_md,
        'posted_on', to_char(r.posted_on, 'YYYY-MM-DD'),
        'closing_date', to_char(r.closing_date, 'YYYY-MM-DD'));
  else
    return query select 'closed'::text, v_org.name::text, v_phone, to_char(v_today, 'YYYY-MM-DD'), null::jsonb,
      jsonb_build_object('slug', r.slug, 'title', r.title);
  end if;
end
$function$;

revoke all on function presby_public_careers(text, text) from public, presby_app, presby_platform;
grant execute on function presby_public_careers(text, text) to presby_app;

-- 7c. The sweep, v1: auto-close only. Owner-only (the
-- presby_reconcile_current_roll() precedent: a cross-org writer that takes
-- no organization, so EXECUTE is revoked from presby_app, presby_platform and
-- PUBLIC). Closes up to least(greatest(p_limit, 1), 1000) published postings
-- whose closing date is before the organization's today, oldest closing date
-- first, skipping rows another transaction holds, and returns one
-- ('posting_closed', organization, posting, null) row per posting closed.
-- The update guard stamps closed_at and bumps version. It ignores the
-- toggle: a retention clock must never depend on a switch a church can flip.
-- The return type is fixed now (D6): Increment 2 re-creates this with
-- `create or replace` and adds kind = 'application_redacted' rows.
create or replace function presby_careers_sweep(p_limit integer default 200)
returns table (kind text, organization_id uuid, posting_id uuid, application_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  return query
  with due as (
    select jp.id
      from job_postings jp
     where jp.status = 'published'
       and jp.closing_date is not null
       and jp.closing_date < presby_careers_org_today(jp.organization_id)
     order by jp.closing_date, jp.id
     limit v_limit
       for update skip locked
  ), closed as (
    update job_postings jp
       set status = 'closed'
      from due
     where jp.id = due.id
       and jp.status = 'published'
    returning jp.organization_id as org_id, jp.id as posting
  )
  select 'posting_closed'::text, c.org_id, c.posting, null::uuid
    from closed c
   order by c.org_id, c.posting;
end
$function$;

revoke all on function presby_careers_sweep(integer) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 8. comments
-- ---------------------------------------------------------------------------
comment on table job_postings is
  'An organization''s job openings (careers Increment 1, DECISION-264/265/278). Status draft -> published (publish), draft -> closed (discard), published -> closed (close), closed -> published (reopen); nothing returns to draft. Enforced with the trigger-owned stamps by job_postings_guard_update on EVERY connection (drizzle/0071 section 5b). At most 100 published per organization (D13, same trigger, advisory lock). Never deleted (no DELETE grant; job_postings_guard_delete passes only the fixture-teardown cascade). presby_app holds column-limited grants; presby_platform none. The public reads only through presby_public_careers(); "open" is derived at read time in the organization''s zone, and presby_careers_sweep() (owner-only, daily cron) closes past-date postings as housekeeping.';
comment on column job_postings.slug is
  'The public URL segment (/careers/<slug>). Unique per organization; editable only while first_published_at is null, then fixed for good, also for the owner (job_postings_guard_update), so a shared link keeps working.';
comment on column job_postings.version is
  'Trigger-owned compare-and-set counter. Bumped by one when a content field or the status changes; a sort_order change alone does not bump it. Not in any presby_app grant.';
comment on column job_postings.first_published_at is
  'Trigger-stamped once, at the first publish, and kept forever. The public-visibility gate for a closed posting: a closed row with no first_published_at is a discarded draft and is not_found to the public.';
comment on column job_postings.posted_on is
  'The "Posted" date. Trigger-stamped once at the first publish (the organization''s today); the owner connection may supply it on that first publish (the Track K import), never later. presby_app holds no privilege on it.';
comment on column job_postings.closing_date is
  'The last day applications are accepted, inclusive, in the organization''s zone (organization_settings.time_zone, default America/New_York). A posting past it is closed to the public at read time, before the sweep runs.';
comment on function presby_careers_org_today(uuid) is
  'The organization''s calendar date in organization_settings.time_zone, falling back to America/New_York (DEFAULT_ORG_TIME_ZONE). SECURITY DEFINER (F26). EXECUTE: owner and presby_app.';
comment on function presby_public_careers(text, text) is
  'The one anonymous careers read (careers Increment 1, D5). Always one row; state unavailable / available / open / closed / not_found; named keys only, no ids; a closed posting projects slug and title only (D3). Gate composed as orgFeatureEnabledInTx composes it (T6). EXECUTE: owner and presby_app only.';
comment on function presby_careers_sweep(integer) is
  'Owner-only daily housekeeping (careers Increment 1, v1): closes published postings past their closing date in the organization''s zone; returns (kind, organization_id, posting_id, application_id) per row changed. Ignores the toggle. Increment 2 re-creates it with the same return type and adds redaction rows.';
comment on function presby_founding_administrator_permission_keys(text) is
  'The founding-administrator ADMINISTRATION bundle (F111/F118/F150/F292). Pinned equal, in order, to foundingAdministratorPlan() for every organization_type (invitations.db.test.ts). careers.applicants (tier 3) is the first key above tier 1 here: accepted paper residual, DECISION-265. A new key edits this function, the TypeScript plan, the designation golden and a backfill together.';
