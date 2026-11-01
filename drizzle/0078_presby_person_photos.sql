-- drizzle/0078_presby_person_photos.sql
--
-- Person photos, Increment 1: staff-managed photos for adults
-- (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "Data Model";
-- parent docs/work-log/2026-10-26-person-photos.md, Phase 2 R1-R5, R8, R12;
-- DECISION-285, 286, 289; findings F331, F333, F334, F335).
--
-- A photo belongs to the MEMBERSHIP (the congregation's relationship with
-- the person), never to the global people row (D1). Two org-scoped tables:
-- person_photos (the set; stored 'private', pinned by composite FK) and
-- person_photo_designations (end-dated history: at most one active
-- 'directory' and one active 'website' designation per person per org; a
-- website designation is attested). Five SQL functions decide, on every
-- surface, whether a photo shows (DECISION-289). The two public roster
-- functions and F289's asset door (0072) switch from people.photo_key to the
-- new tables, and people.photo_key is RETIRED: held null by CHECK here,
-- dropped in 0079 a release later.
--
-- Apply (owner, direct endpoint; DDL needs it). `-1` is MANDATORY: this file
-- has no transaction of its own, and -1 is what makes it atomic:
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0078_presby_person_photos.sql
--
-- ORDER AND DEPENDENCIES. Requires 0072 (blob_assets_id_org_audience_key, the
-- FK target; the first statement refuses otherwise). Written against 0072 as
-- MERGED on main (1f61f62, v0.46.1): section 6 replaces 0072 section 10's two
-- roster bodies and section 12's door, and nothing else of 0072.
--
-- NEVER RE-APPLY 0072 AFTER THIS FILE WITHOUT RE-APPLYING THIS FILE STRAIGHT
-- AFTER (F335). 0072's `create or replace` of the two roster functions and
-- presby_public_site_asset() would silently put back their people.photo_key
-- bodies: every person photo would vanish from the public site (fail closed,
-- but wrong). scripts/person-photos/test-0078-migration.sh (D4) proves the
-- sequence 0072, 0078, 0072, 0078 ends with this file's bodies.
--
-- DEPLOY ORDER (runbook: docs/deployment.md "Pre-deploy runbook: 0078"):
-- 0072 and its code first; then this file, BEFORE promoting the Increment 1
-- code. Old code against the new schema is harmless: it never writes a photo,
-- its directory still selects people.photo_key (present, null), the roster
-- functions return no photo, the door's person_photos test matches nothing,
-- and org_portal.person_photos is off everywhere (no row is backfilled).
--
-- Idempotent: `create table if not exists`, `create [unique] index if not
-- exists`, drop-then-add for the people CHECK, drop-then-create for policies
-- and triggers, `create or replace` for every function, revoke-then-grant.
-- Proven by applying the whole file twice (work-log Phase 4 Batch 1, and D4).
-- Unreleased until applied to production, so it may be corrected in place
-- until then (CLAUDE.md -> Project Layout -> drizzle/).
--
--   0. guard                 refuse without 0072
--   1. person_photos         the set; composite FKs to memberships and to
--                            blob_assets pinned 'private'
--   2. person_photo_designations
--                            end-dated; one active per purpose; website attested
--   3. RLS, grants, guards   FORCE RLS + tenant_isolation; presby_app SELECT,
--                            INSERT, UPDATE of the removal/end pair only, no
--                            DELETE; presby_platform nothing; BEFORE INSERT OR
--                            UPDATE guards bind every connection (F44)
--   4. retire photo_key      people_photo_key_retired (validated)
--   5. five functions        enabled, is_minor, public core (definer, owner
--                            only), public status wrapper, directory
--   6. roster + door         0072's bodies, switched to section 5
--   7. comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No DELETE guard trigger on either table (the 0049 / 0064 residual):
--     presby_app holds no DELETE at all, and a guard would also block the
--     owner-path fixture teardown (organization delete cascades here).
--   * No row in organization_feature_toggles: a missing row is OFF.
--   * Bytes are never erased: blob_assets has no delete path (DECISION-263,
--     F289). Removal stops serving; the bytes persist (accepted residual).
--   * people.photo_key, photo_updated_at and people_photo_key_lower_idx are
--     not dropped (0079, the release after Increment 1 is live).
--   * A future person-merge writer must move photo rows explicitly: the
--     membership FK is NO ACTION both ways, so a merge that re-points or
--     deletes a membership holding photos fails loudly (G10).

-- ---------------------------------------------------------------------------
-- 0. Guard.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blob_assets_id_org_audience_key') then
    raise exception '0078 requires 0072: blob_assets_id_org_audience_key is missing; apply drizzle/0072_presby_blob_audience.sql first'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. person_photos: the set. Never updated except to remove; no DELETE on the
--    tenant path. Every FK is composite and NO ACTION, so a photo pointing at
--    another org's blob, at a public_site blob, or at a person who is not a
--    member of this org is unrepresentable (R1). A referenced blob stays
--    undeletable on every connection (F44).
-- ---------------------------------------------------------------------------
create table if not exists person_photos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  person_id        uuid not null,
  image_asset_key  uuid not null,
  thumb_asset_key  uuid not null,
  asset_audience   text not null default 'private',
  width            integer not null,
  height           integer not null,
  created_at       timestamptz not null default now(),
  created_by       uuid not null references users (id),
  removed_at       timestamptz,
  removed_by       uuid references users (id),
  constraint person_photos_id_org_key        unique (id, organization_id),
  constraint person_photos_id_org_person_key unique (id, organization_id, person_id),
  constraint person_photos_audience_private  check (asset_audience = 'private'),
  constraint person_photos_distinct_assets   check (image_asset_key <> thumb_asset_key),
  constraint person_photos_dimensions        check (width between 1 and 2000 and height between 1 and 2000),
  constraint person_photos_removal_pair      check ((removed_at is null) = (removed_by is null)),
  constraint person_photos_person_fk foreign key (person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint person_photos_image_fk foreign key (image_asset_key, organization_id, asset_audience)
    references blob_assets (id, organization_id, audience),
  constraint person_photos_thumb_fk foreign key (thumb_asset_key, organization_id, asset_audience)
    references blob_assets (id, organization_id, audience)
);

-- A byte-identical re-upload for the same person is "already in their set".
-- Scoped to the person: it reveals nothing about anyone else (dedup oracle).
create unique index if not exists person_photos_active_image_idx
  on person_photos (organization_id, person_id, image_asset_key) where removed_at is null;
-- The door's "is this key a person photo" test (section 6), image and thumbnail.
create index if not exists person_photos_image_key_idx on person_photos (organization_id, image_asset_key);
create index if not exists person_photos_thumb_key_idx on person_photos (organization_id, thumb_asset_key);

-- ---------------------------------------------------------------------------
-- 2. person_photo_designations: end-dated history, not a pointer. Changing
--    the photo or the attestation for a purpose ends the active row and
--    inserts a new one. The FK carries person_id, so a designation cannot
--    point at another person's photo or another org's.
-- ---------------------------------------------------------------------------
create table if not exists person_photo_designations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  person_id          uuid not null,
  photo_id           uuid not null,
  purpose            text not null,
  public_attested_at timestamptz,
  public_attested_by uuid references users (id),
  designated_at      timestamptz not null default now(),
  designated_by      uuid not null references users (id),
  ended_at           timestamptz,
  ended_by           uuid references users (id),
  constraint person_photo_designations_id_org_key unique (id, organization_id),
  constraint person_photo_designations_purpose    check (purpose in ('directory','website')),
  constraint person_photo_designations_attest_pair check ((public_attested_at is null) = (public_attested_by is null)),
  constraint person_photo_designations_website_attested check (purpose <> 'website' or public_attested_at is not null),
  constraint person_photo_designations_end_pair   check ((ended_at is null) = (ended_by is null)),
  constraint person_photo_designations_photo_fk foreign key (photo_id, organization_id, person_id)
    references person_photos (id, organization_id, person_id)
);

-- The operator's "at most one active designation per purpose per person per
-- congregation", as a database property. The directory SQL cannot fan out.
create unique index if not exists person_photo_designations_active_idx
  on person_photo_designations (organization_id, person_id, purpose) where ended_at is null;
create index if not exists person_photo_designations_photo_idx
  on person_photo_designations (organization_id, photo_id);

-- ---------------------------------------------------------------------------
-- 3. RLS, grants, guards.
--    Without FORCE the owner bypasses every policy and RLS is silently inert
--    (F1). presby_platform gets nothing: no platform page reads photos, and
--    the platform connection is the owner anyway (F44), which only the
--    triggers below bind.
-- ---------------------------------------------------------------------------
alter table person_photos enable row level security;
alter table person_photos force row level security;
drop policy if exists tenant_isolation on person_photos;
create policy tenant_isolation on person_photos
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table person_photo_designations enable row level security;
alter table person_photo_designations force row level security;
drop policy if exists tenant_isolation on person_photo_designations;
create policy tenant_isolation on person_photo_designations
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

revoke all on person_photos from presby_app, presby_platform;
grant select, insert on person_photos to presby_app;
grant update (removed_at, removed_by) on person_photos to presby_app;

revoke all on person_photo_designations from presby_app, presby_platform;
grant select, insert on person_photo_designations to presby_app;
grant update (ended_at, ended_by) on person_photo_designations to presby_app;

-- 3a. person_photos guard. Plain plpgsql (it reads no other relation), owner
--     test copied from 0064's presby_contact_methods_guard_write. Refusals
--     are check_violation, distinct from the column grant's
--     insufficient_privilege, so a test can tell which mechanism fired.
create or replace function presby_person_photos_guard_write()
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
    if not v_owner then
      if new.removed_at is not null or new.removed_by is not null then
        raise exception 'person_photos: a new photo starts unremoved; remove it with a later update'
          using errcode = 'check_violation';
      end if;
      new.created_at := clock_timestamp();
    end if;
    return new;
  end if;

  -- UPDATE: removal is one-way, and nothing else ever changes.
  if old.removed_at is not null then
    raise exception 'person_photos: photo % is removed and cannot change (removal is one-way)', old.id
      using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.person_id is distinct from old.person_id
     or new.image_asset_key is distinct from old.image_asset_key
     or new.thumb_asset_key is distinct from old.thumb_asset_key
     or new.asset_audience is distinct from old.asset_audience
     or new.width is distinct from old.width
     or new.height is distinct from old.height
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'person_photos: only removed_at and removed_by may change; add a new photo instead'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function presby_person_photos_guard_write() from public, presby_app, presby_platform;

drop trigger if exists person_photos_guard_write on person_photos;
create trigger person_photos_guard_write
  before insert or update on person_photos
  for each row execute function presby_person_photos_guard_write();

-- 3b. person_photo_designations guard. On INSERT by ANY connection the photo
--     must be this person's, in this org, and not removed. FOR SHARE takes a
--     row lock that conflicts with the removal UPDATE, so a designation and
--     a removal of the same photo serialize: whichever commits second sees
--     the other (the design's remove-versus-designate race, closed at the
--     database; store.ts's advisory lock is the convenience on top). Invoker:
--     on presby_app the read is RLS-scoped to the current org, which is the
--     row's own org whenever the insert could pass WITH CHECK at all.
create or replace function presby_person_photo_designations_guard_write()
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
    if not v_owner then
      if new.ended_at is not null or new.ended_by is not null then
        raise exception 'person_photo_designations: a new designation starts active; end it with a later update'
          using errcode = 'check_violation';
      end if;
      new.designated_at := clock_timestamp();
    end if;
    perform 1
       from person_photos ph
      where ph.id = new.photo_id
        and ph.organization_id = new.organization_id
        and ph.person_id = new.person_id
        and ph.removed_at is null
        for share;
    if not found then
      raise exception 'person_photo_designations: photo % is removed, or is not this person''s photo in this organization', new.photo_id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: ending is one-way, and nothing else ever changes.
  if old.ended_at is not null then
    raise exception 'person_photo_designations: designation % is ended and cannot change (ending is one-way)', old.id
      using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.person_id is distinct from old.person_id
     or new.photo_id is distinct from old.photo_id
     or new.purpose is distinct from old.purpose
     or new.public_attested_at is distinct from old.public_attested_at
     or new.public_attested_by is distinct from old.public_attested_by
     or new.designated_at is distinct from old.designated_at
     or new.designated_by is distinct from old.designated_by then
    raise exception 'person_photo_designations: only ended_at and ended_by may change; end this designation and insert a new one'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function presby_person_photo_designations_guard_write() from public, presby_app, presby_platform;

drop trigger if exists person_photo_designations_guard_write on person_photo_designations;
create trigger person_photo_designations_guard_write
  before insert or update on person_photo_designations
  for each row execute function presby_person_photo_designations_guard_write();

-- ---------------------------------------------------------------------------
-- 4. people.photo_key is RETIRED (R2, DECISION-285). "Written by no one" now
--    holds on every connection. 0 rows carry either column in every
--    environment (R12, 2026-10-26), so VALIDATE succeeds immediately.
-- ---------------------------------------------------------------------------
alter table people drop constraint if exists people_photo_key_retired;
alter table people add constraint people_photo_key_retired check (photo_key is null and photo_updated_at is null) not valid;
alter table people validate constraint people_photo_key_retired;

-- ---------------------------------------------------------------------------
-- 5. The five functions (DECISION-289): one definition per question.
-- ---------------------------------------------------------------------------

-- 5a. The per-org toggle, composed exactly as orgFeatureEnabledInTx composes
--     it (0067's pattern): the category axis first, then the toggle row; a
--     missing toggle row is OFF, a missing category row is ON. orgTypes is
--     null in the catalog entry, so there is no organization-type allow-list.
--     Literals pinned to the catalog entry by person-photos-toggle.test.ts
--     (Batch 2) and person-photos.schema.test.ts.
create or replace function presby_person_photos_enabled(p_org uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((select t.enabled from organization_feature_toggles t
                    where t.organization_id = p_org and t.feature_key = 'org_portal.person_photos'), false)
     and (not coalesce((select f.enabled from feature_flags f where f.key = 'org_portal.feature_categories'), false)
          or coalesce((select c.enabled from organization_feature_categories c
                        where c.organization_id = p_org and c.category = 'people'), true));
$$;

-- 5b. R4's predicate. DOB arithmetic is children.ts's (date_of_birth >
--     current_date - 18 years); a birth-year-only value counts as a minor
--     while the person COULD be under 18; household_role 'child' in this org
--     counts. A null date of birth with no child marker is an adult
--     (operator ruling Q4; accepted residual).
create or replace function presby_photo_subject_is_minor(p_org uuid, p_person uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((select (not pe.birth_year_only and pe.date_of_birth is not null
                           and pe.date_of_birth > current_date - interval '18 years')
                        or (pe.birth_year_only and pe.date_of_birth is not null
                           and extract(year from pe.date_of_birth) > extract(year from current_date) - 19)
                     from people pe where pe.id = p_person), false)
      or coalesce((select m.household_role = 'child' from memberships m
                    where m.person_id = p_person and m.organization_id = p_org), false);
$$;

-- 5c. THE public photo (R3 as corrected by F333). The active, non-removed
--     WEBSITE designation, else the active, non-removed DIRECTORY designation
--     ONLY IF it is attested for the website (Q6). Zero rows when neither
--     exists. image_key is null, and withheld names why, in priority order:
--     toggle_off, minor, merged, hide_photo. SECURITY DEFINER, EXECUTE held
--     by the owner alone: person_privacy is joined on person_id ALONE (0072's
--     stricter cross-org rule), which presby_app's RLS view could not see.
create or replace function presby_person_public_photo(p_org uuid, p_person uuid)
returns table (image_key uuid, source text, withheld text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select ph.image_asset_key as image_key,
           case d.purpose when 'website' then 'website' else 'directory_attested' end as source
      from person_photo_designations d
      join person_photos ph on ph.id = d.photo_id and ph.organization_id = d.organization_id and ph.person_id = d.person_id
     where d.organization_id = p_org and d.person_id = p_person
       and d.ended_at is null and ph.removed_at is null
       and (d.purpose = 'website' or d.public_attested_at is not null)
     order by (d.purpose = 'website') desc
     limit 1)
  select case when w.withheld is null then c.image_key end, c.source, w.withheld
    from c
    left join lateral (select case
        when not presby_person_photos_enabled(p_org)             then 'toggle_off'
        when presby_photo_subject_is_minor(p_org, p_person)       then 'minor'
        when exists (select 1 from people pe where pe.id = p_person and pe.merged_into_id is not null) then 'merged'
        when exists (select 1 from person_privacy pp where pp.person_id = p_person and pp.hide_photo)    then 'hide_photo'
      end as withheld) w on true;
$$;

-- 5d. The photos page's door to 5c: the organization is presby_current_org(),
--     never a parameter, so it is no oracle for another org's photo; zero
--     rows with no org context. Only reader.ts calls it (Batch 2 scan).
create or replace function presby_person_public_photo_status(p_person uuid)
returns table (image_key uuid, source text, withheld text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.image_key, r.source, r.withheld
    from presby_person_public_photo(presby_current_org(), p_person) r
   where presby_current_org() is not null;
$$;

-- 5e. The directory photo: the active, non-removed DIRECTORY designation
--     only (never the website photo, and no attestation filter). Returns the
--     THUMBNAIL key for the directory surfaces and the image key for the
--     photos page. Keys are null when withheld (toggle_off, minor,
--     hide_photo); photo_id is kept so the page can mark the chip. Invoker
--     and RLS-scoped: hide_photo is scoped to (person_id AND this org),
--     exactly as directory.ts has always scoped it; no 'merged' reason (the
--     directory's eligibility already excludes tombstones).
create or replace function presby_person_directory_photo(p_org uuid, p_person uuid)
returns table (thumb_key uuid, image_key uuid, photo_id uuid, withheld text)
language sql
stable
set search_path = public, pg_temp
as $$
  with c as (
    select ph.thumb_asset_key, ph.image_asset_key, ph.id
      from person_photo_designations d
      join person_photos ph on ph.id = d.photo_id and ph.organization_id = d.organization_id and ph.person_id = d.person_id
     where d.organization_id = p_org and d.person_id = p_person
       and d.purpose = 'directory' and d.ended_at is null and ph.removed_at is null)
  select case when w.withheld is null then c.thumb_asset_key end,
         case when w.withheld is null then c.image_asset_key end,
         c.id,
         w.withheld
    from c
    cross join lateral (select case
        when not presby_person_photos_enabled(p_org)        then 'toggle_off'
        when presby_photo_subject_is_minor(p_org, p_person)  then 'minor'
        when exists (select 1 from person_privacy pp
                      where pp.person_id = p_person and pp.organization_id = p_org and pp.hide_photo) then 'hide_photo'
      end as withheld) w;
$$;

revoke all on function presby_person_photos_enabled(uuid) from public, presby_app, presby_platform;
grant execute on function presby_person_photos_enabled(uuid) to presby_app;
revoke all on function presby_photo_subject_is_minor(uuid, uuid) from public, presby_app, presby_platform;
grant execute on function presby_photo_subject_is_minor(uuid, uuid) to presby_app;
revoke all on function presby_person_public_photo(uuid, uuid) from public, presby_app, presby_platform;
revoke all on function presby_person_public_photo_status(uuid) from public, presby_app, presby_platform;
grant execute on function presby_person_public_photo_status(uuid) to presby_app;
revoke all on function presby_person_directory_photo(uuid, uuid) from public, presby_app, presby_platform;
grant execute on function presby_person_directory_photo(uuid, uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 6. The roster functions and the door (R5). 0072 sections 10 and 12 as
--    merged, changing ONLY:
--      roster (every branch): the photo column is
--        ph.image_key::text as photo_key  through
--        left join lateral presby_person_public_photo(o.id, p.id) ph on true
--      and the `left join person_privacy pp` is gone (5c owns hide_photo now;
--      Phase 3 correction 3). photo_key stays TEXT and the signatures are
--      unchanged, so create or replace is legal and no caller moves; uuid
--      text is canonical lowercase.
--      door: is_photo is "any person_photos key of this org, image or
--      thumbnail, removed or not" (a removed photo never falls into the site
--      branch; a thumbnail is never listed, so it is always the neutral
--      miss). The people.photo_key branch is deleted.
--    create or replace REPLACES proconfig, so the search_path pin is
--    restated, and the revoke and grant with it (0072's discipline).
-- ---------------------------------------------------------------------------
create or replace function presby_public_staff_roster(
  p_slug text,
  p_kind text default null,
  p_has_priority boolean default null
)
returns table (
  kind         text,
  role_raw     text,
  department   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.kind, u.role_raw, u.department, u.display_name, u.photo_key
    from (
      select 'staff' as kind, sp.position as role_raw, sp.department,
             coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
             ph.image_key::text as photo_key,
             sp.public_display_order
        from staff_positions sp
        join organizations o on o.id = sp.organization_id
        join organization_sites s on s.organization_id = o.id
        join people p on p.id = sp.person_id
        left join lateral presby_person_public_photo(o.id, p.id) ph on true
       where o.slug = p_slug
         and o.status = 'active'
         and s.status = 'live'
         and sp.public_listed
         and sp.ends_on is null
      union all
      select 'officer' as kind, ot.office as role_raw, null as department,
             coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
             ph.image_key::text as photo_key,
             ot.public_display_order
        from officer_terms ot
        join organizations o on o.id = ot.organization_id
        join organization_sites s on s.organization_id = o.id
        join people p on p.id = ot.person_id
        left join lateral presby_person_public_photo(o.id, p.id) ph on true
       where o.slug = p_slug
         and o.status = 'active'
         and s.status = 'live'
         and ot.public_listed
         and ot.ends_on is null
    ) u
   where (p_kind is null or u.kind = p_kind)
     and (p_has_priority is not true or u.public_display_order is not null)
   order by coalesce(u.public_display_order, 2147483647), u.display_name;
$$;

revoke all on function presby_public_staff_roster(text, text, boolean) from public;
grant execute on function presby_public_staff_roster(text, text, boolean) to presby_app;

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
    left join lateral presby_person_public_photo(o.id, p.id) ph on true
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.ends_on is null
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;

revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;

create or replace function presby_public_site_asset(p_org uuid, p_key uuid)
returns table (content_type text, bytes bytea, cache_class text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select b.content_type, b.bytes, case when ph.is_photo then 'roster' else 'site' end
    from organizations o
    join organization_sites s on s.organization_id = o.id
    join blob_assets b on b.organization_id = o.id and b.id = p_key
   cross join lateral (
         select exists (select 1 from person_photos pph
                         where pph.organization_id = p_org
                           and p_key in (pph.image_asset_key, pph.thumb_asset_key)) as is_photo) ph
   where o.id = p_org
     and o.status = 'active'
     and s.status = 'live'
     and b.content_type in ('image/png','image/jpeg','image/webp')
     and case
           when ph.is_photo then exists (
                  select 1
                    from (select r.photo_key from presby_public_staff_roster(o.slug) r
                          union all
                          select r.photo_key from presby_public_committee_roster(o.slug) r) x
                   where x.photo_key is not null
                     and lower(x.photo_key) = p_key::text)
           else b.audience = 'public_site'
         end;
$$;

revoke all on function presby_public_site_asset(uuid, uuid) from public;
grant execute on function presby_public_site_asset(uuid, uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 7. Comments.
-- ---------------------------------------------------------------------------
comment on table person_photos is
  'Photos of a person held by ONE organization (the membership, not the global person; D1, DECISION-285). Stored private (person_photos_audience_private + composite FKs into blob_assets_id_org_audience_key). Removal is one-way by trigger on every connection; no DELETE grant. Written only by src/lib/person-photos/store.ts (drizzle/0078).';
comment on column person_photos.asset_audience is
  'Constant private (CHECK). Part of person_photos_image_fk and person_photos_thumb_fk (x, organization_id, asset_audience) -> blob_assets (id, organization_id, audience): a person photo can never be a public_site blob (drizzle/0078, DECISION-285).';
comment on column person_photos.thumb_asset_key is
  '160 x 160 WebP thumbnail for the directory surfaces (inlined as a data: URI). Never served by presby_public_site_asset(): a roster function never lists it (drizzle/0078).';
comment on table person_photo_designations is
  'End-dated history of which photo an organization uses for a person''s directory card and public website (drizzle/0078, DECISION-285). At most one active row per purpose per person per org (person_photo_designations_active_idx); website rows are attested (CHECK); a directory row with public_attested_at may stand in on the website (DECISION-286, Q6). Ending is one-way by trigger; no DELETE grant.';
comment on column person_photo_designations.public_attested_at is
  'When the designating user attested the person''s permission to show this photo on the public website. Required for purpose website; optional for directory, where it is the condition for the website fallback (presby_person_public_photo).';
comment on function presby_person_photos_guard_write() is
  'Trigger function for person_photos_guard_write (drizzle/0078): on a non-owner insert, removed_* null and created_at stamped; on any update, removal is one-way and every other column immutable, on every connection including the owner (F44). EXECUTE held by its owner alone.';
comment on function presby_person_photo_designations_guard_write() is
  'Trigger function for person_photo_designations_guard_write (drizzle/0078): on a non-owner insert, ended_* null and designated_at stamped; on any insert, the photo must be this person''s in this org and not removed (FOR SHARE, so it serializes with a removal); on any update, ending is one-way and every other column immutable. EXECUTE held by its owner alone.';
comment on function presby_person_photos_enabled(uuid) is
  'The org_portal.person_photos toggle composed exactly as orgFeatureEnabledInTx composes it (category axis, then the toggle row; missing toggle row = off). Off withholds every photo on every surface (R8, DECISION-286). drizzle/0078.';
comment on function presby_photo_subject_is_minor(uuid, uuid) is
  'True when the person is or could be under 18 (date of birth, birth-year-only, or household_role child in this org). A null date of birth with no child marker is an adult (operator ruling Q4). Used at write (store.ts) and at read (5c, 5e), so a corrected date of birth withholds with no one acting (R4). drizzle/0078.';
comment on function presby_person_public_photo(uuid, uuid) is
  'THE public photo of a person at an org (DECISION-286/289, F333): website designation, else an attested directory designation; null image_key with a withheld reason for toggle_off, minor, merged, hide_photo (joined on person_id alone, the stricter cross-org rule of 0072). SECURITY DEFINER, EXECUTE held by the owner alone; the roster functions and presby_person_public_photo_status call it. drizzle/0078.';
comment on function presby_person_public_photo_status(uuid) is
  'presby_person_public_photo() for presby_current_org() only (zero rows without an org context), so the photos page reads the same definition the public site does. Called only by src/lib/person-photos/reader.ts. drizzle/0078.';
comment on function presby_person_directory_photo(uuid, uuid) is
  'The directory photo of a person at an org: the active directory designation only (never the website photo), thumbnail and image keys null when withheld (toggle_off, minor, hide_photo scoped to this org as directory.ts scopes it). Invoker, RLS-scoped. drizzle/0078.';
comment on function presby_public_staff_roster(text, text, boolean) is
  'Widened (docs/work-log/2026-08-28-public-directory-primitives.md) with optional p_kind/p_has_priority filter parameters. Department/office matching stays in TypeScript (getPublicStaffRoster()), never duplicated here, because office LABELS live in exactly one place (OFFICE_LABELS, DECISION-131) and this function must not grow a second copy. Ordering is always coalesce(public_display_order, 2147483647), display_name so an org that never curates gets alphabetical for free. drizzle/0078 (DECISION-286): photo_key is presby_person_public_photo(org, person).image_key - the website photo, else a directory photo attested for the website, withheld for toggle off, a minor, a merged record or hide_photo; the person stays listed. presby_public_site_asset() calls this function, so the asset door serves exactly the photos this lists.';
comment on function presby_public_committee_roster(text, text, boolean) is
  'Anonymous, unauthenticated read backing the (public)/site/[slug] committeeDirectory liveSlot (docs/work-log/2026-08-28-public-directory-primitives.md). g.membership_source = ''managed'' is defense-in-depth: a derived Session/Diaconate group_memberships row can never surface here even under a future application-layer bug, mirroring groups.ts''s own two-layer discipline. group_name is the only grouping identifier ever projected; group_id is never selected. drizzle/0078 (DECISION-286): photo_key is presby_person_public_photo(org, person).image_key, withheld as that function says; the member stays listed. presby_public_site_asset() calls this function, so the asset door serves exactly the photos this lists.';
comment on function presby_public_site_asset(uuid, uuid) is
  'The only door the public asset route (/site/<slug>/assets/<key> and /assets/<key> on a custom host) uses, through blob-store.ts resolvePublic() (drizzle/0072, F289, DECISION-277; photo test moved to person_photos by drizzle/0078). Zero rows for every miss. Serves a png/jpeg/webp blob of an active org with a live site when EITHER the key is one of this org''s person_photos keys (image or thumbnail, removed or not) AND presby_public_staff_roster()/presby_public_committee_roster() currently list it (cache_class roster; a thumbnail is never listed) OR, for any other key, the row is public_site (cache_class site). Tier 1: no takedown of a public_site image that dropped out of a bundle.';
comment on column people.photo_key is
  'RETIRED (drizzle/0078, DECISION-285): held null by people_photo_key_retired and read by no stored function; photos live in person_photos. Dropped, with photo_updated_at and people_photo_key_lower_idx, in 0079.';
comment on column people.photo_updated_at is
  'RETIRED with photo_key (drizzle/0078); dropped in 0079.';
