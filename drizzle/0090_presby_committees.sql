-- drizzle/0090_presby_committees.sql
--
-- Presbytery committees and administrative commission records, BOTH
-- increments' schema (docs/work-log/2026-11-19-presbytery-committees-inc1.md
-- Batch B1; parent docs/work-log/2026-11-19-presbytery-committees.md Phase 2
-- R1 to R6 and "Migration 0090, structure", Phase 3 "Data Model" sections 0
-- to 7; DECISION-352 to 359; F456 to F460).
--
-- Every row in the three new tables is THE PRESBYTERY'S OWN RECORD
-- (organization_id is the presbytery), never a congregation's:
--   committee_details           1:1 with a managed `committee` group at a
--                               presbytery: its Required / Standing / Ad hoc
--                               label and its one-way dissolved state
--                               (DECISION-353). No row, or kind null, is
--                               "Not yet labelled"; there is no backfill.
--   commission_records          the presbytery's record of an administrative
--   commission_record_members   commission and who serves on it
--                               (DECISION-355). NOT A GRANT: no role_id, no
--                               group_id, no public_listed column, so nothing
--                               can grant through a commission record and
--                               nothing can list its members publicly, by
--                               construction. Written from Increment 2;
--                               created here because this file cannot be
--                               corrected once Increment 1 ships
--                               (DECISION-298).
-- The key (groups.manage, tier 1) is checked by the application inside each
-- reader's and writer's own withOrgContext() transaction
-- (src/lib/committees/); RLS stays tenancy-only.
--
-- Apply (owner, direct endpoint; DDL needs it). `-1` is MANDATORY: this file
-- has no transaction of its own, and -1 is what makes it atomic:
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0090_presby_committees.sql
--
-- ORDER AND DEPENDENCIES. Requires 0045 (presby_check_about_org_affiliated),
-- 0072 (the committee roster's grants and the asset door that calls it) and
-- 0078 (presby_person_public_photo, which the re-created roster calls);
-- section 0 refuses without them. Independent of 0088 (Learn 1b): either
-- order applies. Journal order is the orchestrator's at integration
-- (scripts/committees/_journal.json.integration.patch).
--
-- DEPLOY ORDER: this file BEFORE the 0.63.0 code. Old code against the new
-- schema is harmless: it only ever writes group_role chair, leader or member,
-- and nothing old names the new tables. If section 0 refuses on a
-- group_role outside the seven, stop and tell the operator; nothing is
-- applied.
--
-- Idempotent: `create table if not exists`, drop-then-add for every CHECK
-- and named constraint added after creation, `create [unique] index if not
-- exists`, `create or replace` for every function, drop-then-create for
-- triggers and policies, revoke-then-grant. Proven by applying the whole
-- file twice (scripts/committees/test-0090-migration.sh, D6). Unreleased
-- until applied to production, so it may be corrected in place until then
-- (CLAUDE.md -> Project Layout -> drizzle/).
--
--   0. guards                 refuse without 0045, 0078 and the three FK
--                             target constraints; refuse (naming the
--                             values) if any group_role is outside the seven
--   1. group_role CHECK       the closed seven-value vocabulary (DECISION-354)
--   2. committee_details      table, keys, presby_committee_details_guard
--   3. commission tables      commission_records, commission_record_members,
--                             keys, CHECKs, indexes; the 0045 about-org
--                             trigger under WHEN (about_org_id is not null);
--                             presby_commission_guard_write (one-way end and
--                             removal, immutables); presby_commission_live_guard
--                             (FOR SHARE, no member of a removed record, nor
--                             of an ended one off the owner path)
--   4. RLS + grants           ENABLE + FORCE, tenant_isolation (organization
--                             only), presby_app SELECT + INSERT + column-
--                             limited UPDATE, NO DELETE, presby_platform
--                             nothing
--   5. public roster          presby_public_committee_roster re-created with
--                             the 0078 signature, projection and photo
--                             lateral, plus the start, end, membership,
--                             death, merge and dissolution predicates
--                             (DECISION-356, F457)
--   6. comments
--   7. closing assertions     a `do` block that raises
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored. Drizzle mirror: src/lib/db/domain/committees.ts and the
-- group_role CHECK in src/lib/db/domain/groups.ts.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No permission row, no change to the founding-administrator bundle
--     function and no backfill: groups.manage already covers committees and
--     commission records (Q2). The bundle function is deliberately not named
--     anywhere in this file (the F362 integration hazard; a source scan in
--     src/lib/committees/contract.test.ts pins it).
--   * No audit row, no organization_feature_toggles row, no feature_flags
--     row: the surface rides the existing global org_portal.committees.
--   * Does NOT touch administrative_commissions, org_delegations, role_grants
--     or any role_id: nothing in this pipeline writes the downward tables
--     (DECISION-355; R3.3). The dev seed's administrative_commissions row and
--     its committee-type group are left exactly as they are (46k, 68e and
--     73f write those tables as presby_app; F456, F460).
--   * No existing table is dropped or re-shaped: group_memberships gains one
--     CHECK; groups is unchanged (DECISION-353 keeps the label off the shared
--     table).
--   * No DELETE grant and no DELETE guard trigger (the 0049 / 0064 / 0078 /
--     0089 reasoning): presby_app holds no DELETE on the new tables, and a
--     guard would block the owner-path fixture teardown.
--   * Residuals, `paper`:
--       - F456: presby_app and presby_platform hold DELETE on the downward
--         tables (grant drift) and the downward policies have no WITH CHECK.
--         Tracked, not fixed here.
--       - F459: presby_app and presby_platform hold DELETE on groups and
--         group_memberships; committee seat history is soft by convention
--         (src/lib/groups.ts never deletes), not by grant. Tracked.
--       - F460: a committee group can be the roster of an
--         administrative_commissions row; ending its seats ends that
--         commission arm's access. Inert (no writer, production 0 rows).
--       - The public roster uses current_date, the UTC day: a listing can
--         flip up to a day early or late around local midnight (R4.6).
--       - Committee name uniqueness is the application's (advisory lock and
--         case-insensitive check); no index can express it, because the
--         predicate needs the group type from another table (R5.4).
--       - A commission record's organization is not checked to be a
--         presbytery here; the store refuses any other organization type
--         (src/lib/committees/store.ts, DECISION-352).
--       - Adding a member to a dissolved committee is refused by the store
--         alone (R2.4); the public roster excludes a dissolved committee at
--         the database either way (section 5).

-- ---------------------------------------------------------------------------
-- 0. Guards.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad   text;
  v_count bigint;
begin
  if to_regprocedure('presby_person_public_photo(uuid, uuid)') is null then
    raise exception '0090 requires 0078: presby_person_public_photo(uuid, uuid) is missing; apply drizzle/0078_presby_person_photos.sql first'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if to_regprocedure('presby_check_about_org_affiliated()') is null then
    raise exception '0090 requires 0045: presby_check_about_org_affiliated() is missing; apply drizzle/0045_presby_about_org_affiliation.sql first'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groups_id_org_key' and conrelid = 'groups'::regclass) then
    raise exception '0090 requires the constraint groups_id_org_key on groups (the committee_details FK target)'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memberships_person_org_key' and conrelid = 'memberships'::regclass) then
    raise exception '0090 requires the constraint memberships_person_org_key on memberships (the commission member FK target)'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memberships_id_org_key' and conrelid = 'memberships'::regclass) then
    raise exception '0090 requires the constraint memberships_id_org_key on memberships'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Role values are a closed vocabulary, not personal data: naming them is
  -- safe and tells the operator exactly what to correct.
  select string_agg(distinct quote_literal(group_role), ', ' order by quote_literal(group_role)), count(*)
    into v_bad, v_count
    from group_memberships
   where group_role not in ('chair', 'leader', 'member', 'vice_chair', 'clerk', 'secretary', 'ex_officio');
  if v_count > 0 then
    raise exception '0090: % group_memberships row(s) hold a group_role outside the seven allowed values (%); correct them before applying', v_count, v_bad
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The group_role CHECK (DECISION-354). chair and leader are the seat
--    words 0073 (presby_reimbursement__is_seat) and 0085
--    (presby_worship_leads_team) match exactly; the four new values are
--    titles that carry no authority. Those two functions are unchanged.
-- ---------------------------------------------------------------------------
alter table group_memberships drop constraint if exists group_memberships_group_role_check;
alter table group_memberships add constraint group_memberships_group_role_check
  check (group_role in ('chair', 'leader', 'member', 'vice_chair', 'clerk', 'secretary', 'ex_officio'));

-- ---------------------------------------------------------------------------
-- 2. committee_details (DECISION-353). organization_id is the presbytery (on
--    delete cascade: reachable only through D10's guarded fixture teardown).
-- ---------------------------------------------------------------------------
create table if not exists committee_details (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  group_id        uuid not null,
  kind            text,
  dissolved_on    date,
  dissolved_by    uuid references users (id),
  dissolved_at    timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references users (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid not null references users (id),
  constraint committee_details_id_org_key unique (id, organization_id),
  constraint committee_details_group_key unique (group_id),
  constraint committee_details_group_fk foreign key (group_id, organization_id)
    references groups (id, organization_id)
);

alter table committee_details drop constraint if exists committee_details_kind_check;
alter table committee_details add constraint committee_details_kind_check
  check (kind is null or kind in ('required', 'standing', 'ad_hoc'));
alter table committee_details drop constraint if exists committee_details_dissolved_floor;
alter table committee_details add constraint committee_details_dissolved_floor
  check (dissolved_on is null or dissolved_on >= date '1900-01-01');
alter table committee_details drop constraint if exists committee_details_dissolved_trio;
alter table committee_details add constraint committee_details_dissolved_trio
  check ((dissolved_on is null) = (dissolved_by is null) and (dissolved_on is null) = (dissolved_at is null));

create index if not exists committee_details_org_idx on committee_details (organization_id);

-- presby_committee_details_guard(): the details row attaches only to a
-- managed `committee` group at a presbytery, its identity never moves, and
-- dissolution is one-way. Binds EVERY connection including the owner (F44:
-- getPlatformDb() is neondb_owner, which no grant binds; a trigger does).
-- Refusals are check_violation with a CONSTRAINT name (committee_details_*),
-- distinct from a column grant's insufficient_privilege, so a test can tell
-- which mechanism fired. SECURITY INVOKER: on presby_app the reads below are
-- RLS-safe (groups is tenant-scoped to the row's own organization whenever
-- the insert could pass WITH CHECK at all; group_types and organizations are
-- SELECT-granted and carry no policy). Owner test copied from 0078 / 0089.
create or replace function presby_committee_details_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
begin
  select c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
    into v_owner
    from pg_class c
   where c.oid = tg_relid;
  v_owner := coalesce(v_owner, false);

  if tg_op = 'INSERT' then
    if not exists (
      select 1
        from groups g
        join group_types gt on gt.id = g.group_type_id
        join organizations o on o.id = g.organization_id
       where g.id = new.group_id
         and g.organization_id = new.organization_id
         and g.membership_source = 'managed'
         and gt.key = 'committee'
         and o.organization_type = 'presbytery') then
      raise exception 'committee_details: group % is not a managed committee group of a presbytery in organization %', new.group_id, new.organization_id
        using errcode = 'check_violation', constraint = 'committee_details_target';
    end if;
    if not v_owner then
      if new.dissolved_on is not null or new.dissolved_by is not null or new.dissolved_at is not null then
        raise exception 'committee_details: a new committee starts active; dissolve it with a later update'
          using errcode = 'check_violation', constraint = 'committee_details_insert_dissolved';
      end if;
      new.created_at := clock_timestamp();
    end if;
    return new;
  end if;

  -- UPDATE: a dissolved committee's row never changes again (DECISION-353).
  if old.dissolved_on is not null then
    raise exception 'committee_details: committee % is dissolved and its details cannot change (dissolution is one-way)', old.group_id
      using errcode = 'check_violation', constraint = 'committee_details_dissolved_final';
  end if;
  if new.id is distinct from old.id
     or new.group_id is distinct from old.group_id
     or new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'committee_details: id, group_id, organization_id, created_at and created_by cannot change'
      using errcode = 'check_violation', constraint = 'committee_details_immutable';
  end if;
  return new;
end $$;

revoke all on function presby_committee_details_guard() from public, presby_app, presby_platform;

drop trigger if exists committee_details_guard on committee_details;
create trigger committee_details_guard
  before insert or update on committee_details
  for each row execute function presby_committee_details_guard();

-- ---------------------------------------------------------------------------
-- 3. commission_records and commission_record_members (DECISION-355, T6 to
--    T8). The presbytery's own record of an administrative commission. NO
--    role_id, NO group_id, NO public_listed on either table (section 7
--    asserts it). about_org_id is a plain FK to organizations under the
--    section-17 structural exception (as on congregation_oversight), fenced
--    by the 0045 trigger; it is optional.
-- ---------------------------------------------------------------------------
create table if not exists commission_records (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations (id) on delete cascade,
  about_org_id           uuid references organizations (id),
  title                  text not null,
  charge                 text,
  appointed_on           date not null,
  minute_reference       text,
  ended_on               date,
  ended_minute_reference text,
  ended_by               uuid references users (id),
  ended_at               timestamptz,
  removed_at             timestamptz,
  removed_by             uuid references users (id),
  row_version            integer not null default 1,
  created_at             timestamptz not null default now(),
  created_by             uuid not null references users (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid not null references users (id),
  constraint commission_records_id_org_key unique (id, organization_id)
);

alter table commission_records drop constraint if exists commission_records_title_length;
alter table commission_records add constraint commission_records_title_length
  check (char_length(btrim(title)) between 1 and 200);
alter table commission_records drop constraint if exists commission_records_charge_length;
alter table commission_records add constraint commission_records_charge_length
  check (charge is null or char_length(charge) <= 500);
alter table commission_records drop constraint if exists commission_records_appointed_floor;
alter table commission_records add constraint commission_records_appointed_floor
  check (appointed_on >= date '1900-01-01');
alter table commission_records drop constraint if exists commission_records_minute_length;
alter table commission_records add constraint commission_records_minute_length
  check (minute_reference is null or char_length(minute_reference) <= 200);
alter table commission_records drop constraint if exists commission_records_ended_after_appointed;
alter table commission_records add constraint commission_records_ended_after_appointed
  check (ended_on is null or ended_on >= appointed_on);
alter table commission_records drop constraint if exists commission_records_ended_minute_length;
alter table commission_records add constraint commission_records_ended_minute_length
  check (ended_minute_reference is null or char_length(ended_minute_reference) <= 200);
alter table commission_records drop constraint if exists commission_records_ended_minute_needs_end;
alter table commission_records add constraint commission_records_ended_minute_needs_end
  check (ended_minute_reference is null or ended_on is not null);
alter table commission_records drop constraint if exists commission_records_ended_trio;
alter table commission_records add constraint commission_records_ended_trio
  check ((ended_on is null) = (ended_by is null) and (ended_on is null) = (ended_at is null));
alter table commission_records drop constraint if exists commission_records_removed_pair;
alter table commission_records add constraint commission_records_removed_pair
  check ((removed_at is null) = (removed_by is null));

create index if not exists commission_records_org_idx
  on commission_records (organization_id, appointed_on desc) where removed_at is null;
create index if not exists commission_records_about_idx
  on commission_records (organization_id, about_org_id) where about_org_id is not null;

create table if not exists commission_record_members (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations (id) on delete cascade,
  commission_record_id uuid not null,
  person_id            uuid not null,
  role                 text not null default 'member',
  starts_on            date not null,
  ends_on              date,
  created_at           timestamptz not null default now(),
  created_by           uuid not null references users (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid not null references users (id),
  constraint commission_record_members_id_org_key unique (id, organization_id),
  constraint commission_record_members_record_fk foreign key (commission_record_id, organization_id)
    references commission_records (id, organization_id),
  constraint commission_record_members_person_fk foreign key (person_id, organization_id)
    references memberships (person_id, organization_id)
);

-- Six titles, no `leader` (T6): `leader` is the legacy seat word.
alter table commission_record_members drop constraint if exists commission_record_members_role_check;
alter table commission_record_members add constraint commission_record_members_role_check
  check (role in ('chair', 'vice_chair', 'clerk', 'secretary', 'ex_officio', 'member'));
alter table commission_record_members drop constraint if exists commission_record_members_starts_floor;
alter table commission_record_members add constraint commission_record_members_starts_floor
  check (starts_on >= date '1900-01-01');
alter table commission_record_members drop constraint if exists commission_record_members_end_after_start;
alter table commission_record_members add constraint commission_record_members_end_after_start
  check (ends_on is null or ends_on >= starts_on);

create index if not exists commission_record_members_record_idx
  on commission_record_members (organization_id, commission_record_id, starts_on);
-- T8: one OPEN seat per person per commission is a database fact; interval
-- overlap with a planned end is the application's.
create unique index if not exists commission_record_members_one_open_idx
  on commission_record_members (commission_record_id, person_id) where ends_on is null;
-- The person FK's column index (the B-L6 rule): a membership delete or
-- "where does this person serve" reads it.
create index if not exists commission_record_members_person_idx
  on commission_record_members (person_id, organization_id);

-- 3a. The about-org check (0045, reused), as of the current date. The WHEN is
--     MANDATORY: without it a record about no congregation is refused,
--     because the function passes the null to presby_org_affiliated. An
--     update that does not move about_org_id passes (R9, F453).
drop trigger if exists commission_records_about_org on commission_records;
create trigger commission_records_about_org
  before insert or update on commission_records
  for each row
  when (new.about_org_id is not null)
  execute function presby_check_about_org_affiliated('about_org_id', '');

-- 3b. presby_commission_guard_write(): one function for both tables (the
--     0089 presby_oversight_guard_write shape). TG_ARGV[0] is a comma list of
--     the immutable columns. The closed-state columns are read through
--     to_jsonb, never as new.removed_at, so the members table (which has no
--     end or removal pair) passes those checks. On a non-owner INSERT a new
--     row starts open and unremoved and created_at is the server's clock; the
--     owner may insert history (an ended or removed record, its own
--     created_at) for the one-time import and fixtures. UPDATE: a removed
--     record never changes again; an ended record's end trio never changes or
--     clears; the named columns are immutable. Binds the owner too (F44).
--     Plain plpgsql, SECURITY INVOKER: it reads no other relation.
create or replace function presby_commission_guard_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
  v_new   jsonb;
  v_old   jsonb;
  v_col   text;
begin
  select c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
    into v_owner
    from pg_class c
   where c.oid = tg_relid;
  v_owner := coalesce(v_owner, false);
  v_new := to_jsonb(new);

  if tg_op = 'INSERT' then
    if not v_owner then
      if (v_new ->> 'removed_at') is not null or (v_new ->> 'removed_by') is not null
         or (v_new ->> 'ended_on') is not null or (v_new ->> 'ended_by') is not null
         or (v_new ->> 'ended_at') is not null or (v_new ->> 'ended_minute_reference') is not null then
        raise exception '%: a new record starts open and unremoved; end or remove it with a later update', tg_table_name
          using errcode = 'check_violation', constraint = 'commission_guard_insert_closed';
      end if;
      new.created_at := clock_timestamp();
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);

  -- A removed record never changes again (removal is one-way, T8).
  if (v_old ->> 'removed_at') is not null then
    raise exception '%: row % is removed and cannot change (removal is one-way)', tg_table_name, old.id
      using errcode = 'check_violation', constraint = 'commission_removal_final';
  end if;

  -- An ended record stays ended, on the same date, by the same act.
  if (v_old ->> 'ended_on') is not null
     and ((v_new -> 'ended_on') is distinct from (v_old -> 'ended_on')
          or (v_new -> 'ended_by') is distinct from (v_old -> 'ended_by')
          or (v_new -> 'ended_at') is distinct from (v_old -> 'ended_at')) then
    raise exception '%: row % has ended; its end date cannot change or clear (ending is one-way)', tg_table_name, old.id
      using errcode = 'check_violation', constraint = 'commission_ended_final';
  end if;

  foreach v_col in array string_to_array(tg_argv[0], ',') loop
    if (v_new -> btrim(v_col)) is distinct from (v_old -> btrim(v_col)) then
      raise exception '%: column % cannot change after the row is recorded', tg_table_name, btrim(v_col)
        using errcode = 'check_violation', constraint = 'commission_guard_immutable';
    end if;
  end loop;
  return new;
end $$;

revoke all on function presby_commission_guard_write() from public, presby_app, presby_platform;

drop trigger if exists commission_records_guard_write on commission_records;
create trigger commission_records_guard_write
  before insert or update on commission_records
  for each row execute function presby_commission_guard_write('id,organization_id,created_at,created_by');

drop trigger if exists commission_record_members_guard_write on commission_record_members;
create trigger commission_record_members_guard_write
  before insert or update on commission_record_members
  for each row execute function presby_commission_guard_write('id,organization_id,commission_record_id,person_id,created_at,created_by');

-- 3c. presby_commission_live_guard(): no new member of a REMOVED record, on
--     every connection; no new member of an ENDED record off the owner path
--     (the owner may insert history). FOR SHARE conflicts with the end and
--     removal UPDATEs' row lock, so an add and an end serialize at the
--     database: whichever commits second sees the other (the 0089 building
--     guard). A missing record is left to the composite FK to report.
--     Invoker: on presby_app the read is RLS-scoped to the current org,
--     which is the row's own org whenever the insert could pass WITH CHECK.
create or replace function presby_commission_live_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner   boolean;
  v_removed timestamptz;
  v_ended   date;
begin
  select c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
    into v_owner
    from pg_class c
   where c.oid = tg_relid;
  v_owner := coalesce(v_owner, false);

  select r.removed_at, r.ended_on
    into v_removed, v_ended
    from commission_records r
   where r.id = new.commission_record_id
     and r.organization_id = new.organization_id
     for share;
  if not found then
    return new;
  end if;
  if v_removed is not null then
    raise exception 'commission_record_members: commission record % is removed; nothing new may be added to it', new.commission_record_id
      using errcode = 'check_violation', constraint = 'commission_record_closed';
  end if;
  if v_ended is not null and not v_owner then
    raise exception 'commission_record_members: commission record % has ended; no member may be added to it', new.commission_record_id
      using errcode = 'check_violation', constraint = 'commission_record_closed';
  end if;
  return new;
end $$;

revoke all on function presby_commission_live_guard() from public, presby_app, presby_platform;

drop trigger if exists commission_record_members_live_guard on commission_record_members;
create trigger commission_record_members_live_guard
  before insert on commission_record_members
  for each row execute function presby_commission_live_guard();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants. Without FORCE the owner bypasses every policy and RLS is
--    silently inert (F1). The policy is organization-only, NOT the "visible
--    to both" shape of administrative_commissions: the congregation a
--    commission record is about can never read it, by the database.
--    presby_platform gets nothing (no platform page reads these tables, and
--    the platform connection is the owner anyway, F44, which only the
--    triggers above bind). presby_app: SELECT, INSERT and a column-limited
--    UPDATE, never DELETE (all deletes are soft).
-- ---------------------------------------------------------------------------
alter table committee_details enable row level security;
alter table committee_details force row level security;
drop policy if exists tenant_isolation on committee_details;
create policy tenant_isolation on committee_details
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table commission_records enable row level security;
alter table commission_records force row level security;
drop policy if exists tenant_isolation on commission_records;
create policy tenant_isolation on commission_records
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table commission_record_members enable row level security;
alter table commission_record_members force row level security;
drop policy if exists tenant_isolation on commission_record_members;
create policy tenant_isolation on commission_record_members
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

revoke all on committee_details, commission_records, commission_record_members
  from presby_app, presby_platform;

grant select, insert on committee_details, commission_records, commission_record_members
  to presby_app;

grant update (kind, dissolved_on, dissolved_by, dissolved_at, updated_at, updated_by)
  on committee_details to presby_app;
grant update (about_org_id, title, charge, appointed_on, minute_reference, ended_on,
              ended_minute_reference, ended_by, ended_at, removed_at, removed_by,
              row_version, updated_at, updated_by)
  on commission_records to presby_app;
grant update (role, starts_on, ends_on, updated_at, updated_by)
  on commission_record_members to presby_app;

-- ---------------------------------------------------------------------------
-- 5. The public committee roster fix-forward (DECISION-356, F457). Same
--    signature, return columns, volatility, security and search_path as
--    0078; the 0078 body (md5 of the live prosrc 08030577..., re-read
--    2026-11-19 on pipeline/presbytery-committees) carried exactly, plus:
--      * the seat has started (starts_on <= current_date): a future-start,
--        opted-in member was listed early;
--      * the seat has not ended (ends_on null or after today): replaces
--        `ends_on is null`, which hid a planned end early;
--      * the person's membership at the organization is live;
--      * the person is not recorded as deceased and not merged;
--      * the group is not a dissolved committee.
--    No commission clause: commission members are not group rows, so they
--    are structurally absent. presby_public_site_asset() calls this function
--    by name and narrows with it (an unlisted member's photo stops being
--    served; the intended direction).
-- ---------------------------------------------------------------------------
create or replace function presby_public_committee_roster(
  p_slug text,
  p_committee text default null,
  p_has_priority boolean default null
)
returns table (
  group_name   text,
  group_role   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.name as group_name, gm.group_role,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         ph.image_key::text as photo_key
    from group_memberships gm
    join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
    join organizations o on o.id = gm.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = gm.person_id
    join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
    left join lateral presby_person_public_photo(o.id, p.id) ph on true
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.starts_on <= current_date
     and (gm.ends_on is null or gm.ends_on > current_date)
     and m.ended_on is null
     and p.date_of_death is null
     and p.merged_into_id is null
     and not exists (select 1 from committee_details cd
                      where cd.group_id = g.id and cd.organization_id = g.organization_id
                        and cd.dissolved_on is not null and cd.dissolved_on <= current_date)
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;

revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;

-- ---------------------------------------------------------------------------
-- 6. Comments.
-- ---------------------------------------------------------------------------
comment on table committee_details is
  'The presbytery''s own label and dissolved state for one of its committees, never a congregation''s (DECISION-353). 1:1 with a managed `committee` group at a presbytery (presby_committee_details_guard). Not columns on the shared groups table, so groups and its triggers are unchanged. Dissolution is one-way: a dissolved row never changes again. Writer: src/lib/committees/store.ts. drizzle/0090 section 2.';
comment on column committee_details.kind is
  '''required'', ''standing'' or ''ad_hoc''. Null (or no row at all) means "Not yet labelled"; there is no backfill (Gap 10, T14).';
comment on column committee_details.dissolved_on is
  'The first day the committee no longer exists (half-open, DECISION-357). Set once, with dissolved_by and dissolved_at, by the dissolve action, which ends every seat on the same date in the same transaction. A dissolved committee is excluded from presby_public_committee_roster().';

comment on table commission_records is
  'The presbytery''s own record of an administrative commission, never the congregation''s (DECISION-355). NOT a grant: no role_id, no group_id and no public_listed column exist on this table or on commission_record_members, so nothing can grant through it, the permission resolver cannot see it, and nothing can list it publicly. Visible to the presbytery only (tenant_isolation is organization-only; the congregation it concerns reads zero rows). Removal and ending are one-way (presby_commission_guard_write). Writer: src/lib/committees/store.ts (Increment 2). drizzle/0090 section 3.';
comment on column commission_records.about_org_id is
  'Optional: the member congregation the commission concerns. Fenced by presby_check_about_org_affiliated (0045) under WHEN (about_org_id is not null): affiliated with this presbytery on the day the row is written or the column moves.';
comment on column commission_records.charge is
  'The commission''s charge, in general terms (at most 500 characters). Readable by any groups.manage holder (tier 1, an accepted residual). Never copied into audit metadata, a CSV, a log, an error, the public site or /admin.';
comment on column commission_records.ended_on is
  'The first day the commission no longer serves (half-open). One-way with ended_by and ended_at; ending the record ends its open members in the same transaction (the store).';
comment on column commission_records.row_version is
  'Optimistic concurrency: the writer compares it in the UPDATE''s WHERE and increments it.';
comment on table commission_record_members is
  'Who serves on an administrative commission record (DECISION-355). NOT group_memberships: no group row exists, so role_grants, administrative_commissions, the permission resolver, presby_public_committee_roster and the seat predicates cannot see these rows. One open seat per person per record (commission_record_members_one_open_idx). Writer: src/lib/committees/store.ts (Increment 2).';
comment on column commission_record_members.role is
  'One of six titles (chair, vice_chair, clerk, secretary, ex_officio, member); no ''leader'' (T6). Titles carry no authority.';
comment on column commission_record_members.ends_on is
  'The first day the person no longer serves (half-open); null = serving with no planned end.';

comment on column group_memberships.group_role is
  'Closed vocabulary of seven (group_memberships_group_role_check, drizzle/0090, DECISION-354): chair, leader, member, vice_chair, clerk, secretary, ex_officio. vice_chair, clerk, secretary and ex_officio are titles that carry no authority; the seat predicates presby_reimbursement__is_seat (0073) and presby_worship_leads_team (0085) stay exact-match on (''chair'', ''leader''). /admin/groups offers chair, leader, member; the presbytery committees surface offers the six without leader.';

comment on function presby_committee_details_guard() is
  'BEFORE INSERT OR UPDATE on committee_details: the row attaches only to a managed committee group of a presbytery in its own organization (committee_details_target); a non-owner insert starts undissolved with created_at = clock_timestamp(); identity columns are immutable; a dissolved row never changes again. SECURITY INVOKER, binds the owner too (F44). drizzle/0090 section 2.';
comment on function presby_commission_guard_write() is
  'BEFORE INSERT OR UPDATE on commission_records and commission_record_members. A non-owner insert starts open and unremoved with created_at = clock_timestamp(); removal is one-way; an ended record''s end trio never changes or clears; TG_ARGV[0] names the immutable columns. SECURITY INVOKER, binds the owner too (F44). drizzle/0090 section 3b.';
comment on function presby_commission_live_guard() is
  'BEFORE INSERT on commission_record_members: refuses a member of a removed commission record on every connection, and of an ended one off the owner path. FOR SHARE serializes with a concurrent end or removal. SECURITY INVOKER. drizzle/0090 section 3c.';

comment on function presby_public_committee_roster(text, text, boolean) is
  'Anonymous, unauthenticated read backing the (public)/site/[slug] committeeDirectory liveSlot (docs/work-log/2026-08-28-public-directory-primitives.md). g.membership_source = ''managed'' is defense-in-depth: a derived Session/Diaconate group_memberships row can never surface here. group_name is the only grouping identifier ever projected; group_id is never selected. drizzle/0078 (DECISION-286): photo_key is presby_person_public_photo(org, person).image_key, withheld as that function says. drizzle/0090 (DECISION-356, F457): lists an opted-in seat only while it is serving (starts_on <= current_date, ends_on null or after it), the person''s membership is live, they are not recorded as deceased or merged, and the group is not a dissolved committee. current_date is the UTC day, so a listing can flip up to a day early or late around local midnight (accepted). A commission member can never appear here: commission_record_members rows are not group rows. The projection is exactly group_name, group_role, display_name, photo_key (pinned by test). presby_public_site_asset() calls this function, so the asset door serves exactly the photos this lists.';

-- ---------------------------------------------------------------------------
-- 7. Closing assertions. A miss raises, and `psql -1` rolls the whole file
--    back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables constant text[] := array['committee_details', 'commission_records', 'commission_record_members'];
  v_n integer;
begin
  select count(*) into v_n from pg_class
   where relname = any (v_tables) and relkind = 'r' and relrowsecurity and relforcerowsecurity;
  if v_n <> 3 then
    raise exception '0090: expected FORCE ROW LEVEL SECURITY on all three tables, found %', v_n;
  end if;

  select count(*) into v_n from pg_policies where tablename = any (v_tables);
  if v_n <> 3 or (select count(*) from pg_policies where tablename = any (v_tables) and policyname = 'tenant_isolation') <> 3 then
    raise exception '0090: expected exactly one policy, tenant_isolation, on each of the three tables, found % policies', v_n;
  end if;

  select count(*) into v_n
    from pg_class c, lateral aclexplode(c.relacl) a
   where c.relname = any (v_tables) and c.relkind = 'r'
     and a.grantee = 'presby_app'::regrole and a.privilege_type in ('DELETE', 'TRUNCATE');
  if v_n <> 0 then
    raise exception '0090: presby_app holds DELETE or TRUNCATE on a committees table (all deletes are soft)';
  end if;

  select count(*) into v_n
    from pg_class c
   where c.relname = any (v_tables) and c.relkind = 'r'
     and (exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'presby_platform'::regrole)
          or exists (select 1 from pg_attribute att, lateral aclexplode(att.attacl) x
                      where att.attrelid = c.oid and x.grantee = 'presby_platform'::regrole));
  if v_n <> 0 then
    raise exception '0090: presby_platform holds a privilege on a committees table';
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'group_memberships_group_role_check'
                    and conrelid = 'group_memberships'::regclass and contype = 'c' and convalidated) then
    raise exception '0090: group_memberships_group_role_check is missing or not validated';
  end if;

  -- "No grant, by construction" (DECISION-355): neither commission table
  -- may carry a column the resolver, a role grant or the public roster
  -- could follow.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public'
     and table_name in ('commission_records', 'commission_record_members')
     and column_name in ('role_id', 'group_id', 'public_listed');
  if v_n <> 0 then
    raise exception '0090: a commission table carries role_id, group_id or public_listed (it must not, DECISION-355)';
  end if;

  select count(*) into v_n from pg_proc p
   where p.proname in ('presby_committee_details_guard', 'presby_commission_guard_write', 'presby_commission_live_guard')
     and not p.prosecdef and p.proconfig = array['search_path=public, pg_temp'];
  if v_n <> 3 then
    raise exception '0090: the three guard functions are not all SECURITY INVOKER with search_path pinned';
  end if;

  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal and t.tgenabled = 'O'
     and (t.tgrelid::regclass::text, t.tgname) in (
       ('committee_details', 'committee_details_guard'),
       ('commission_records', 'commission_records_about_org'),
       ('commission_records', 'commission_records_guard_write'),
       ('commission_record_members', 'commission_record_members_guard_write'),
       ('commission_record_members', 'commission_record_members_live_guard'));
  if v_n <> 5 then
    raise exception '0090: expected the five committees triggers enabled, found %', v_n;
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = 'presby_public_committee_roster(text, text, boolean)'::regprocedure
       and p.prosecdef
       and p.proconfig = array['search_path=public, pg_temp']
       and pg_get_function_result(p.oid) = 'TABLE(group_name text, group_role text, display_name text, photo_key text)') then
    raise exception '0090: presby_public_committee_roster is not SECURITY DEFINER with search_path pinned, or its result columns are not exactly group_name, group_role, display_name, photo_key';
  end if;
end $$;
