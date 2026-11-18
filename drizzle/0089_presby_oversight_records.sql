-- drizzle/0089_presby_oversight_records.sql
--
-- Congregation profile, Increment 1: the presbytery's own records about each
-- member congregation - profile, buildings (and, from Increment 2, building
-- photos), appraisals, insurance by year and loans
-- (docs/work-log/2026-11-17-congregation-profile-inc1.md Batch B1; parent
-- docs/work-log/2026-11-17-congregation-profile.md Phase 2 R1, R2, R5, R8, R9
-- and Phase 3 "Data Model"; DECISION-344, 345, 347, 349, 351; F450, F451).
--
-- Every row here is THE PRESBYTERY'S OWN RECORD (organization_id is the
-- presbytery), never the congregation's (DECISION-119/120/344). Tiered by
-- table, never by column (R1):
--   tier 1, congregation_oversight.manage:  oversight_profiles,
--     oversight_buildings, oversight_building_photos
--   tier 2, congregation_oversight.finance: oversight_building_appraisals,
--     oversight_insurance_years, oversight_loans
-- The key is checked by the application inside each reader's and writer's own
-- withOrgContext() transaction (src/lib/oversight/); RLS stays tenancy-only.
--
-- Apply (owner, direct endpoint; DDL needs it). `-1` is MANDATORY: this file
-- has no transaction of its own, and -1 is what makes it atomic:
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0089_presby_oversight_records.sql
--
-- ORDER AND DEPENDENCIES. Requires 0072 (blob_assets_id_org_audience_key, the
-- photo FK target; section 0 refuses otherwise, as 0078 does), 0045
-- (presby_check_about_org_affiliated) and 0085 (the live bundle body this file
-- re-creates). Independent of 0088. Journal order is the orchestrator's at
-- integration (scripts/oversight/_journal.json.integration.patch).
--
-- DEPLOY ORDER (DECISION-351; runbook docs/deployment.md "Pre-deploy runbook:
-- 0089"): this file BEFORE the 0.61.0 code. Old code against the new schema
-- is harmless: nothing old names these tables, and the old assessment form
-- still writes its two dormant columns.
--
-- Idempotent: `create table if not exists`, drop-then-add for every CHECK,
-- `create [unique] index if not exists`, `create or replace` for every
-- function, drop-then-create for triggers and policies, revoke-then-grant,
-- `on conflict` for the permission and the backfill. Proven by applying the
-- whole file twice (scripts/oversight/test-0089-migration.sh, D6). Unreleased
-- until applied to production, so it may be corrected in place until then
-- (CLAUDE.md -> Project Layout -> drizzle/).
--
-- INTEGRATION HAZARD (F362): F362 also re-creates
-- presby_founding_administrator_permission_keys(). Two `create or replace`s
-- with different arrays silently drop the first one's keys. Whichever of the
-- two pipelines merges SECOND must re-read the live body and carry the other's
-- keys; invitations.db.test.ts (equality with foundingAdministratorPlan() for
-- every organization_type) is what catches a miss. The same holds for any
-- later migration that re-creates the function: carry
-- 'congregation_oversight.finance' in the presbytery arm.
--
--   0. guard                  refuse without 0072
--   1. permission catalog     congregation_oversight.finance (tier 2, 2FA,
--                             module presbytery)
--   2. founding bundle        presby_founding_administrator_permission_keys()
--                             re-created from the LIVE body (re-read
--                             2026-11-17 on pipeline-congregation-profile:
--                             the 0085 body) with the finance key after
--                             congregation_oversight.manage in the presbytery
--                             arm; base and worship arms byte-for-byte
--   3. backfill               the finance key onto every org-owned
--                             founding_administrator role at a presbytery
--   4. the six tables         columns, keys, composite FKs, CHECKs
--   5. indexes                the partial uniques ("live" = removed_at is null)
--   6. functions + triggers   the 0045 about-org trigger on the four top-level
--                             tables; presby_oversight_guard_write (removal is
--                             one-way, immutable columns) on the five with the
--                             removal pair; presby_oversight_building_live_guard
--                             (no new child of a removed building, FOR SHARE)
--                             on photos, appraisals and loans;
--                             presby_oversight_guard_provenance ('imported'
--                             is the owner-run import's alone) on the five
--                             tables with provenance. All SECURITY INVOKER;
--                             the first two bind the OWNER too (F44)
--   7. RLS + grants           ENABLE + FORCE, tenant_isolation, presby_app
--                             SELECT + INSERT + column-limited UPDATE, NO
--                             DELETE, presby_platform nothing
--   8. comments               incl. the superseded congregation_oversight
--                             columns (R8) and the two 2FA comments restated
--                             from the live pg_description
--   9. closing assertions     a `do` block that raises
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored. Drizzle mirror: src/lib/db/domain/oversight.ts.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No audit row: a migration is provisioning (the 0071/0085 precedent).
--     src/lib/oversight/store.ts audits every write in its own transaction.
--   * No organization_feature_toggles row and no feature_flags row: the
--     surface rides the existing global org_portal.oversight (DECISION-347).
--   * No existing table is altered: congregation_oversight keeps
--     insurance_carrier and insurance_expires_on (dormant, comment-only
--     restatement, R8); legacy values convert only in the operator's import
--     session (DECISION-351), never here. 0089 depends on no data.
--   * No DELETE guard trigger (the 0049 / 0064 / 0078 reasoning): presby_app
--     holds no DELETE at all, and a guard would also block the owner-path
--     fixture teardown.
--   * No permission predicate in any policy (RLS enforces tenancy only).
--   * Residual, `paper` (R2, DECISION-345): the presbytery founding
--     administrator holds the tier-2 finance key; writes are audited, reads
--     are not. CLAUDE.md records it as a known violation.
--   * Residual (the 0057 / 0071 / 0085 idiom): a re-apply of section 3
--     re-adds the finance key to a designation-minted founding role a tenant
--     later edited it off.
--   * Residual (R9, F453): a congregation that departed the presbytery keeps
--     its rows; the about-org trigger refuses NEW rows about it and allows an
--     edit that does not move about_org_id.

-- ---------------------------------------------------------------------------
-- 0. Guard.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blob_assets_id_org_audience_key') then
    raise exception '0089 requires 0072: blob_assets_id_org_audience_key is missing; apply drizzle/0072_presby_blob_audience.sql first'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The permission (R2, DECISION-345). Tier 2, requires_two_factor true, so
--    holding it at any active membership requires 2FA at sign-in (arm B of
--    presby_two_factor_required reads the column live). `on conflict do
--    update` so an in-place description fix replays (the 0074/0085 idiom).
--    Never mapped into FEATURES.* (src/lib/permissions.ts is frozen).
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier, requires_two_factor)
values
  ('congregation_oversight.finance', 'presbytery',
   'See and record a member congregation''s appraisals, insurance and loans (the presbytery''s own record)', 2, true)
on conflict (key) do update
  set module = excluded.module,
      description = excluded.description,
      sensitivity_tier = excluded.sensitivity_tier,
      requires_two_factor = excluded.requires_two_factor;

-- ---------------------------------------------------------------------------
-- 2. The founding-administrator bundle (R2, DECISION-345, F450).
-- ---------------------------------------------------------------------------
-- Same signature, return type, volatility, security and search_path as 0085
-- section 2; the eleven base keys and the worship arm are byte-for-byte the
-- live text (test-rls 71b and 85b grep them). Under assertPermissionSubset() a
-- key nobody at an organization holds can never be granted there (F450, the
-- F150/F292 precedent), so the finance key reaches a presbytery only through
-- this bundle; the founding administrator delegates it through a custom role.
-- Order is base, worship, oversight; foundingAdministratorPlan() uses the same
-- order and invitations.db.test.ts pins the two equal. Sole definer caller:
-- presby_apply_founding_administrator (0059), by name.
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
         || case when p_org_type in ('congregation', 'new_worshiping_community')
                 then array['worship.manage', 'worship.plan', 'worship.schedule']::text[]
                 else array[]::text[] end
         || case when p_org_type = 'presbytery'
                 then array['congregation_oversight.manage', 'congregation_oversight.finance']::text[]
                 else array[]::text[] end;
$function$;

revoke all on function presby_founding_administrator_permission_keys(text) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. Backfill (the 0057 / 0071 / 0085 idiom, presbyteries only).
-- ---------------------------------------------------------------------------
-- Every org-owned founding_administrator role at a presbytery, designated
-- before this file runs, is topped up with the finance key. The notice
-- reports how many roles gained it (the orchestrator records it at apply; a
-- re-apply reports 0). The 2FA consequence strands nobody: such a role already
-- carries the flagged roles.manage (0080).
do $$
declare
  v_roles integer;
begin
  with added as (
    insert into app_role_permissions (role_id, permission_key)
    select r.id, 'congregation_oversight.finance'
      from app_roles r
      join organizations o on o.id = r.organization_id
     where r.key = 'founding_administrator'
       and r.organization_id is not null
       and o.organization_type = 'presbytery'
    on conflict (role_id, permission_key) do nothing
    returning role_id
  )
  select count(distinct role_id) into v_roles from added;
  raise notice 'oversight 0089: % founding_administrator role(s) at a presbytery topped up with the finance key', v_roles;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The six tables.
--    organization_id is the presbytery (on delete cascade: reachable only
--    through D10's guarded fixture teardown). about_org_id is the congregation,
--    a plain FK to organizations under the section-17 structural exception, as
--    on congregation_oversight, and present on every table (children too, for
--    reporting and for the three-column FK). Every fact column is nullable for
--    the one-time import, bar the four identity columns T3 names
--    (appraisal assessed_year and amount_cents, insurance policy_year, loan
--    kind and status). Money is bigint integer cents, 0 to 100,000,000,000
--    ($1,000,000,000; DECISION-349). provenance is immutable after insert.
-- ---------------------------------------------------------------------------

-- 4a. oversight_profiles (tier 1). One row per (presbytery, congregation). No
--     removal pair: a profile is cleared by saving empty fields; no guard
--     trigger: the column-limited grant is its immutability for presby_app.
create table if not exists oversight_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  about_org_id    uuid not null references organizations (id),
  street_address  text,
  city            text,
  county          text,
  year_organized  smallint,
  phone           text,
  provenance      text not null default 'presbytery_entered',
  row_version     integer not null default 1,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references users (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid not null references users (id),
  constraint oversight_profiles_id_org_key unique (id, organization_id),
  constraint oversight_profiles_org_about_key unique (organization_id, about_org_id)
);

alter table oversight_profiles drop constraint if exists oversight_profiles_provenance;
alter table oversight_profiles add constraint oversight_profiles_provenance
  check (provenance in ('presbytery_entered', 'imported'));
alter table oversight_profiles drop constraint if exists oversight_profiles_street_address_length;
alter table oversight_profiles add constraint oversight_profiles_street_address_length
  check (street_address is null or char_length(street_address) <= 500);
alter table oversight_profiles drop constraint if exists oversight_profiles_city_length;
alter table oversight_profiles add constraint oversight_profiles_city_length
  check (city is null or char_length(city) <= 100);
alter table oversight_profiles drop constraint if exists oversight_profiles_county_length;
alter table oversight_profiles add constraint oversight_profiles_county_length
  check (county is null or char_length(county) <= 100);
alter table oversight_profiles drop constraint if exists oversight_profiles_phone_length;
alter table oversight_profiles add constraint oversight_profiles_phone_length
  check (phone is null or char_length(phone) <= 40);
alter table oversight_profiles drop constraint if exists oversight_profiles_year_organized_range;
alter table oversight_profiles add constraint oversight_profiles_year_organized_range
  check (year_organized is null or year_organized between 1600 and 2100);
alter table oversight_profiles drop constraint if exists oversight_profiles_row_version_positive;
alter table oversight_profiles add constraint oversight_profiles_row_version_positive
  check (row_version >= 1);

-- 4b. oversight_buildings (tier 1). The three-column key is the target every
--     child FK uses, so a child cannot name another congregation's building
--     (Gap 12). Retire is a reversible status (T6), removal is one-way.
create table if not exists oversight_buildings (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations (id) on delete cascade,
  about_org_id         uuid not null references organizations (id),
  name                 text not null,
  building_type        text not null,
  year_built           smallint,
  first_addition_year  smallint,
  second_addition_year smallint,
  square_feet          integer,
  roof_condition       text,
  plumbing_condition   text,
  hvac_condition       text,
  boiler_condition     text,
  has_sprinklers       boolean,
  has_fire_alarm       boolean,
  has_security_system  boolean,
  is_primary           boolean not null default false,
  notes                text,
  retired_on           date,
  retired_reason       text,
  provenance           text not null default 'presbytery_entered',
  row_version          integer not null default 1,
  created_at           timestamptz not null default now(),
  created_by           uuid not null references users (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid not null references users (id),
  removed_at           timestamptz,
  removed_by           uuid references users (id),
  constraint oversight_buildings_id_org_key unique (id, organization_id),
  constraint oversight_buildings_id_org_about_key unique (id, organization_id, about_org_id)
);

alter table oversight_buildings drop constraint if exists oversight_buildings_provenance;
alter table oversight_buildings add constraint oversight_buildings_provenance
  check (provenance in ('presbytery_entered', 'imported'));
alter table oversight_buildings drop constraint if exists oversight_buildings_name_length;
alter table oversight_buildings add constraint oversight_buildings_name_length
  check (char_length(name) between 1 and 120);
alter table oversight_buildings drop constraint if exists oversight_buildings_building_type;
alter table oversight_buildings add constraint oversight_buildings_building_type
  check (building_type in ('sanctuary', 'education_building', 'fellowship_hall', 'manse', 'parsonage',
                           'office', 'vacant_land', 'annex', 'gymnasium', 'other'));
alter table oversight_buildings drop constraint if exists oversight_buildings_year_built_range;
alter table oversight_buildings add constraint oversight_buildings_year_built_range
  check (year_built is null or year_built between 1600 and 2100);
alter table oversight_buildings drop constraint if exists oversight_buildings_first_addition_year_range;
alter table oversight_buildings add constraint oversight_buildings_first_addition_year_range
  check (first_addition_year is null or first_addition_year between 1600 and 2100);
alter table oversight_buildings drop constraint if exists oversight_buildings_second_addition_year_range;
alter table oversight_buildings add constraint oversight_buildings_second_addition_year_range
  check (second_addition_year is null or second_addition_year between 1600 and 2100);
-- An addition is not before what it adds to. A second addition WITHOUT a first
-- is refused by the application, not here, so a messy import row is never
-- blocked (Phase 3 Data Model).
alter table oversight_buildings drop constraint if exists oversight_buildings_first_addition_order;
alter table oversight_buildings add constraint oversight_buildings_first_addition_order
  check (first_addition_year is null or year_built is null or first_addition_year >= year_built);
alter table oversight_buildings drop constraint if exists oversight_buildings_second_addition_order;
alter table oversight_buildings add constraint oversight_buildings_second_addition_order
  check (second_addition_year is null or first_addition_year is null or second_addition_year >= first_addition_year);
alter table oversight_buildings drop constraint if exists oversight_buildings_second_addition_after_built;
alter table oversight_buildings add constraint oversight_buildings_second_addition_after_built
  check (second_addition_year is null or year_built is null or second_addition_year >= year_built);
alter table oversight_buildings drop constraint if exists oversight_buildings_square_feet_range;
alter table oversight_buildings add constraint oversight_buildings_square_feet_range
  check (square_feet is null or square_feet between 1 and 5000000);
alter table oversight_buildings drop constraint if exists oversight_buildings_roof_condition;
alter table oversight_buildings add constraint oversight_buildings_roof_condition
  check (roof_condition is null or roof_condition in ('good', 'fair', 'poor'));
alter table oversight_buildings drop constraint if exists oversight_buildings_plumbing_condition;
alter table oversight_buildings add constraint oversight_buildings_plumbing_condition
  check (plumbing_condition is null or plumbing_condition in ('good', 'fair', 'poor'));
alter table oversight_buildings drop constraint if exists oversight_buildings_hvac_condition;
alter table oversight_buildings add constraint oversight_buildings_hvac_condition
  check (hvac_condition is null or hvac_condition in ('good', 'fair', 'poor'));
alter table oversight_buildings drop constraint if exists oversight_buildings_boiler_condition;
alter table oversight_buildings add constraint oversight_buildings_boiler_condition
  check (boiler_condition is null or boiler_condition in ('good', 'fair', 'poor'));
alter table oversight_buildings drop constraint if exists oversight_buildings_notes_length;
alter table oversight_buildings add constraint oversight_buildings_notes_length
  check (notes is null or char_length(notes) <= 4000);
alter table oversight_buildings drop constraint if exists oversight_buildings_retired_reason;
alter table oversight_buildings add constraint oversight_buildings_retired_reason
  check (retired_reason is null or retired_reason in ('sold', 'demolished', 'closed', 'other'));
alter table oversight_buildings drop constraint if exists oversight_buildings_retired_pair;
alter table oversight_buildings add constraint oversight_buildings_retired_pair
  check ((retired_on is null) = (retired_reason is null));
alter table oversight_buildings drop constraint if exists oversight_buildings_primary_not_retired;
alter table oversight_buildings add constraint oversight_buildings_primary_not_retired
  check (not (is_primary and retired_on is not null));
alter table oversight_buildings drop constraint if exists oversight_buildings_removal_pair;
alter table oversight_buildings add constraint oversight_buildings_removal_pair
  check ((removed_at is null) = (removed_by is null));
alter table oversight_buildings drop constraint if exists oversight_buildings_row_version_positive;
alter table oversight_buildings add constraint oversight_buildings_row_version_positive
  check (row_version >= 1);

-- 4c. oversight_building_photos (tier 1; written from Increment 2, the table
--     ships now). Both blobs are pinned 'private' by the constant
--     asset_audience in a three-column FK each (the 0078 shape), so a
--     building photo can never be a public_site blob, and
--     presby_public_site_asset() never serves one. NO ACTION everywhere.
create table if not exists oversight_building_photos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  about_org_id    uuid not null references organizations (id),
  building_id     uuid not null,
  image_asset_key uuid not null,
  thumb_asset_key uuid not null,
  asset_audience  text not null default 'private',
  width           integer not null,
  height          integer not null,
  caption         text,
  is_cover        boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references users (id),
  removed_at      timestamptz,
  removed_by      uuid references users (id),
  constraint oversight_building_photos_id_org_key unique (id, organization_id),
  constraint oversight_building_photos_building_fk foreign key (building_id, organization_id, about_org_id)
    references oversight_buildings (id, organization_id, about_org_id),
  constraint oversight_building_photos_image_fk foreign key (image_asset_key, organization_id, asset_audience)
    references blob_assets (id, organization_id, audience),
  constraint oversight_building_photos_thumb_fk foreign key (thumb_asset_key, organization_id, asset_audience)
    references blob_assets (id, organization_id, audience)
);

alter table oversight_building_photos drop constraint if exists oversight_building_photos_audience_private;
alter table oversight_building_photos add constraint oversight_building_photos_audience_private
  check (asset_audience = 'private');
alter table oversight_building_photos drop constraint if exists oversight_building_photos_distinct_assets;
alter table oversight_building_photos add constraint oversight_building_photos_distinct_assets
  check (image_asset_key <> thumb_asset_key);
alter table oversight_building_photos drop constraint if exists oversight_building_photos_dimensions;
alter table oversight_building_photos add constraint oversight_building_photos_dimensions
  check (width between 1 and 2000 and height between 1 and 2000);
alter table oversight_building_photos drop constraint if exists oversight_building_photos_caption_length;
alter table oversight_building_photos add constraint oversight_building_photos_caption_length
  check (caption is null or char_length(caption) <= 200);
alter table oversight_building_photos drop constraint if exists oversight_building_photos_removal_pair;
alter table oversight_building_photos add constraint oversight_building_photos_removal_pair
  check ((removed_at is null) = (removed_by is null));

-- 4d. oversight_building_appraisals (tier 2). Never edited (T4): record and
--     remove only, so no updated_* and no row_version.
create table if not exists oversight_building_appraisals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  about_org_id    uuid not null references organizations (id),
  building_id     uuid not null,
  assessed_year   smallint not null,
  amount_cents    bigint not null,
  notes           text,
  provenance      text not null default 'presbytery_entered',
  created_at      timestamptz not null default now(),
  created_by      uuid not null references users (id),
  removed_at      timestamptz,
  removed_by      uuid references users (id),
  constraint oversight_building_appraisals_id_org_key unique (id, organization_id),
  constraint oversight_building_appraisals_building_fk foreign key (building_id, organization_id, about_org_id)
    references oversight_buildings (id, organization_id, about_org_id)
);

alter table oversight_building_appraisals drop constraint if exists oversight_building_appraisals_provenance;
alter table oversight_building_appraisals add constraint oversight_building_appraisals_provenance
  check (provenance in ('presbytery_entered', 'imported'));
alter table oversight_building_appraisals drop constraint if exists oversight_building_appraisals_assessed_year_range;
alter table oversight_building_appraisals add constraint oversight_building_appraisals_assessed_year_range
  check (assessed_year between 1600 and 2100);
alter table oversight_building_appraisals drop constraint if exists oversight_building_appraisals_amount_range;
alter table oversight_building_appraisals add constraint oversight_building_appraisals_amount_range
  check (amount_cents between 0 and 100000000000);
alter table oversight_building_appraisals drop constraint if exists oversight_building_appraisals_notes_length;
alter table oversight_building_appraisals add constraint oversight_building_appraisals_notes_length
  check (notes is null or char_length(notes) <= 1000);
alter table oversight_building_appraisals drop constraint if exists oversight_building_appraisals_removal_pair;
alter table oversight_building_appraisals add constraint oversight_building_appraisals_removal_pair
  check ((removed_at is null) = (removed_by is null));

-- 4e. oversight_insurance_years (tier 2). One live record per congregation
--     per policy year (section 5); the year is not editable (remove and
--     re-record).
create table if not exists oversight_insurance_years (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  about_org_id      uuid not null references organizations (id),
  policy_year       smallint not null,
  carrier           text,
  policy_number     text,
  policy_expires_on date,
  recent_claims     boolean,
  pool_interest     boolean,
  notes             text,
  provenance        text not null default 'presbytery_entered',
  row_version       integer not null default 1,
  created_at        timestamptz not null default now(),
  created_by        uuid not null references users (id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid not null references users (id),
  removed_at        timestamptz,
  removed_by        uuid references users (id),
  constraint oversight_insurance_years_id_org_key unique (id, organization_id)
);

alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_provenance;
alter table oversight_insurance_years add constraint oversight_insurance_years_provenance
  check (provenance in ('presbytery_entered', 'imported'));
alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_policy_year_range;
alter table oversight_insurance_years add constraint oversight_insurance_years_policy_year_range
  check (policy_year between 1900 and 2100);
alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_carrier_length;
alter table oversight_insurance_years add constraint oversight_insurance_years_carrier_length
  check (carrier is null or char_length(carrier) <= 200);
alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_policy_number_length;
alter table oversight_insurance_years add constraint oversight_insurance_years_policy_number_length
  check (policy_number is null or char_length(policy_number) <= 100);
alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_notes_length;
alter table oversight_insurance_years add constraint oversight_insurance_years_notes_length
  check (notes is null or char_length(notes) <= 2000);
alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_removal_pair;
alter table oversight_insurance_years add constraint oversight_insurance_years_removal_pair
  check ((removed_at is null) = (removed_by is null));
alter table oversight_insurance_years drop constraint if exists oversight_insurance_years_row_version_positive;
alter table oversight_insurance_years add constraint oversight_insurance_years_row_version_positive
  check (row_version >= 1);

-- 4f. oversight_loans (tier 2). building_id is optional (T9: no UI in v1);
--     the three-column FK is MATCH SIMPLE, so it is not enforced while
--     building_id is null. One balance plus its as-of date (Gap 6).
create table if not exists oversight_loans (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  about_org_id          uuid not null references organizations (id),
  building_id           uuid,
  kind                  text not null,
  lender                text,
  original_amount_cents bigint,
  current_balance_cents bigint,
  balance_as_of         date,
  grants_amount_cents   bigint,
  guarantee_note        text,
  notes                 text,
  status                text not null default 'open',
  paid_off_on           date,
  provenance            text not null default 'presbytery_entered',
  row_version           integer not null default 1,
  created_at            timestamptz not null default now(),
  created_by            uuid not null references users (id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid not null references users (id),
  removed_at            timestamptz,
  removed_by            uuid references users (id),
  constraint oversight_loans_id_org_key unique (id, organization_id),
  constraint oversight_loans_building_fk foreign key (building_id, organization_id, about_org_id)
    references oversight_buildings (id, organization_id, about_org_id)
);

alter table oversight_loans drop constraint if exists oversight_loans_provenance;
alter table oversight_loans add constraint oversight_loans_provenance
  check (provenance in ('presbytery_entered', 'imported'));
alter table oversight_loans drop constraint if exists oversight_loans_kind;
alter table oversight_loans add constraint oversight_loans_kind
  check (kind in ('presbytery_program', 'guaranteed_outside', 'other'));
alter table oversight_loans drop constraint if exists oversight_loans_lender_length;
alter table oversight_loans add constraint oversight_loans_lender_length
  check (lender is null or char_length(lender) <= 200);
alter table oversight_loans drop constraint if exists oversight_loans_original_amount_range;
alter table oversight_loans add constraint oversight_loans_original_amount_range
  check (original_amount_cents is null or original_amount_cents between 0 and 100000000000);
alter table oversight_loans drop constraint if exists oversight_loans_current_balance_range;
alter table oversight_loans add constraint oversight_loans_current_balance_range
  check (current_balance_cents is null or current_balance_cents between 0 and 100000000000);
alter table oversight_loans drop constraint if exists oversight_loans_grants_amount_range;
alter table oversight_loans add constraint oversight_loans_grants_amount_range
  check (grants_amount_cents is null or grants_amount_cents between 0 and 100000000000);
alter table oversight_loans drop constraint if exists oversight_loans_balance_pair;
alter table oversight_loans add constraint oversight_loans_balance_pair
  check ((current_balance_cents is null) = (balance_as_of is null));
alter table oversight_loans drop constraint if exists oversight_loans_guarantee_note_length;
alter table oversight_loans add constraint oversight_loans_guarantee_note_length
  check (guarantee_note is null or char_length(guarantee_note) <= 1000);
alter table oversight_loans drop constraint if exists oversight_loans_notes_length;
alter table oversight_loans add constraint oversight_loans_notes_length
  check (notes is null or char_length(notes) <= 2000);
alter table oversight_loans drop constraint if exists oversight_loans_status;
alter table oversight_loans add constraint oversight_loans_status
  check (status in ('open', 'paid_off'));
alter table oversight_loans drop constraint if exists oversight_loans_paid_off_pair;
alter table oversight_loans add constraint oversight_loans_paid_off_pair
  check ((status = 'paid_off') = (paid_off_on is not null));
alter table oversight_loans drop constraint if exists oversight_loans_removal_pair;
alter table oversight_loans add constraint oversight_loans_removal_pair
  check ((removed_at is null) = (removed_by is null));
alter table oversight_loans drop constraint if exists oversight_loans_row_version_positive;
alter table oversight_loans add constraint oversight_loans_row_version_positive
  check (row_version >= 1);

-- ---------------------------------------------------------------------------
-- 5. Indexes ("live" means removed_at is null). A removed name or year is
--    reusable; a second live one is refused at the database, so two clerks
--    acting at once cannot both win.
-- ---------------------------------------------------------------------------
create unique index if not exists oversight_buildings_live_name_idx
  on oversight_buildings (organization_id, about_org_id, lower(name)) where removed_at is null;
create unique index if not exists oversight_buildings_one_primary_idx
  on oversight_buildings (organization_id, about_org_id) where is_primary and removed_at is null;
create unique index if not exists oversight_building_photos_live_image_idx
  on oversight_building_photos (organization_id, building_id, image_asset_key) where removed_at is null;
create unique index if not exists oversight_building_photos_one_cover_idx
  on oversight_building_photos (organization_id, building_id) where is_cover and removed_at is null;
create index if not exists oversight_building_photos_building_idx
  on oversight_building_photos (organization_id, building_id) where removed_at is null;
create unique index if not exists oversight_building_appraisals_live_year_idx
  on oversight_building_appraisals (organization_id, building_id, assessed_year) where removed_at is null;
create unique index if not exists oversight_insurance_years_live_year_idx
  on oversight_insurance_years (organization_id, about_org_id, policy_year) where removed_at is null;
create index if not exists oversight_loans_about_idx
  on oversight_loans (organization_id, about_org_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- 6. Functions and triggers. Refusals are check_violation with a CONSTRAINT
--    name (oversight_guard_*), distinct from a column grant's
--    insufficient_privilege and from the about-org trigger's
--    insufficient_privilege, so a test can tell which mechanism fired.
-- ---------------------------------------------------------------------------

-- 6a. The about-org check (0045, reused). As of the current date: the
--     present-tense question 0045's header assigns to oversight. An insert
--     about a never-affiliated or departed congregation is refused; an update
--     that does not move about_org_id passes (R9). Not on photos or
--     appraisals: the three-column FK pins them to a building this trigger
--     already checked (Gap 12).
drop trigger if exists oversight_profiles_about_org on oversight_profiles;
create trigger oversight_profiles_about_org
  before insert or update on oversight_profiles
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

drop trigger if exists oversight_buildings_about_org on oversight_buildings;
create trigger oversight_buildings_about_org
  before insert or update on oversight_buildings
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

drop trigger if exists oversight_insurance_years_about_org on oversight_insurance_years;
create trigger oversight_insurance_years_about_org
  before insert or update on oversight_insurance_years
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

drop trigger if exists oversight_loans_about_org on oversight_loans;
create trigger oversight_loans_about_org
  before insert or update on oversight_loans
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

-- 6b. presby_oversight_guard_write(): removal is one-way and the named
--     columns are immutable, on EVERY connection including the owner (F44:
--     getPlatformDb() is neondb_owner, which no grant binds; a trigger does).
--     TG_ARGV[0] is a comma list of the immutable columns, read through
--     to_jsonb (the 0045 idiom). On a non-owner INSERT a new row starts
--     unremoved and created_at is the server's clock. The owner may insert a
--     removed row and keep its own created_at (the operator's import session
--     and fixtures); the owner test is copied from 0078. Plain plpgsql,
--     SECURITY INVOKER: it reads no other relation.
create or replace function presby_oversight_guard_write()
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

  if tg_op = 'INSERT' then
    if not v_owner then
      if new.removed_at is not null or new.removed_by is not null then
        raise exception '%: a new row starts unremoved; remove it with a later update', tg_table_name
          using errcode = 'check_violation', constraint = 'oversight_guard_insert_removed';
      end if;
      new.created_at := clock_timestamp();
    end if;
    return new;
  end if;

  -- UPDATE: a removed row never changes again (removal is one-way).
  if old.removed_at is not null then
    raise exception '%: row % is removed and cannot change (removal is one-way)', tg_table_name, old.id
      using errcode = 'check_violation', constraint = 'oversight_guard_removal_final';
  end if;

  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach v_col in array string_to_array(tg_argv[0], ',') loop
    if (v_new -> btrim(v_col)) is distinct from (v_old -> btrim(v_col)) then
      raise exception '%: column % cannot change after the row is recorded', tg_table_name, btrim(v_col)
        using errcode = 'check_violation', constraint = 'oversight_guard_immutable';
    end if;
  end loop;
  return new;
end $$;

revoke all on function presby_oversight_guard_write() from public, presby_app, presby_platform;

drop trigger if exists oversight_buildings_guard_write on oversight_buildings;
create trigger oversight_buildings_guard_write
  before insert or update on oversight_buildings
  for each row execute function presby_oversight_guard_write('id,organization_id,about_org_id,provenance,created_at,created_by');

drop trigger if exists oversight_insurance_years_guard_write on oversight_insurance_years;
create trigger oversight_insurance_years_guard_write
  before insert or update on oversight_insurance_years
  for each row execute function presby_oversight_guard_write('id,organization_id,about_org_id,provenance,created_at,created_by,policy_year');

-- building_id stays changeable on a loan (T9).
drop trigger if exists oversight_loans_guard_write on oversight_loans;
create trigger oversight_loans_guard_write
  before insert or update on oversight_loans
  for each row execute function presby_oversight_guard_write('id,organization_id,about_org_id,provenance,created_at,created_by');

-- Appraisals are never updated except to remove (T4).
drop trigger if exists oversight_building_appraisals_guard_write on oversight_building_appraisals;
create trigger oversight_building_appraisals_guard_write
  before insert or update on oversight_building_appraisals
  for each row execute function presby_oversight_guard_write('id,organization_id,about_org_id,provenance,created_at,created_by,building_id,assessed_year,amount_cents,notes');

-- Photos: only caption, cover and the removal pair change (no provenance column).
drop trigger if exists oversight_building_photos_guard_write on oversight_building_photos;
create trigger oversight_building_photos_guard_write
  before insert or update on oversight_building_photos
  for each row execute function presby_oversight_guard_write('id,organization_id,about_org_id,building_id,image_asset_key,thumb_asset_key,asset_audience,width,height,created_at,created_by');

-- 6c. presby_oversight_building_live_guard(): no new child of a removed
--     building, on every connection. FOR SHARE conflicts with the removal
--     UPDATE's row lock, so a child insert and a building removal serialize:
--     whichever commits second sees the other (the 0078 designation-guard
--     precedent). A missing building is left to the composite FK to report.
--     Invoker: on presby_app the read is RLS-scoped to the current org, which
--     is the row's own org whenever the insert could pass WITH CHECK at all.
create or replace function presby_oversight_building_live_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_removed timestamptz;
begin
  if new.building_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.building_id is not distinct from old.building_id then
    return new;
  end if;
  select b.removed_at into v_removed
    from oversight_buildings b
   where b.id = new.building_id
     and b.organization_id = new.organization_id
     for share;
  if found and v_removed is not null then
    raise exception '%: building % is removed; nothing new may be added to it', tg_table_name, new.building_id
      using errcode = 'check_violation', constraint = 'oversight_guard_building_removed';
  end if;
  return new;
end $$;

revoke all on function presby_oversight_building_live_guard() from public, presby_app, presby_platform;

drop trigger if exists oversight_building_photos_building_live on oversight_building_photos;
create trigger oversight_building_photos_building_live
  before insert or update of building_id on oversight_building_photos
  for each row execute function presby_oversight_building_live_guard();

drop trigger if exists oversight_building_appraisals_building_live on oversight_building_appraisals;
create trigger oversight_building_appraisals_building_live
  before insert or update of building_id on oversight_building_appraisals
  for each row execute function presby_oversight_building_live_guard();

drop trigger if exists oversight_loans_building_live on oversight_loans;
create trigger oversight_loans_building_live
  before insert or update of building_id on oversight_loans
  for each row execute function presby_oversight_building_live_guard();

-- 6d. presby_oversight_guard_provenance(): 'imported' is reserved for the
--     operator's owner-run import session (DECISION-351; orchestrator ruling
--     on the B1 report, 2026-11-18). A non-owner connection (presby_app, and
--     presby_platform should it ever gain a grant) may not INSERT a row with
--     any provenance but 'presbytery_entered', and may not UPDATE a row's
--     provenance to anything else. An UPDATE that leaves an imported row's
--     provenance unchanged passes: an imported row stays imported after an
--     edit. On presby_app the column grant already refuses any UPDATE of
--     provenance (42501), so the UPDATE arm is defence in depth; the owner's
--     UPDATE of provenance is refused by presby_oversight_guard_write on four
--     tables (the profile has no removal pair and no write guard, and the
--     owner may correct it). Owner test copied from 0078. Plain plpgsql,
--     SECURITY INVOKER: it reads no other relation.
create or replace function presby_oversight_guard_provenance()
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
  if coalesce(v_owner, false) then
    return new;
  end if;
  if new.provenance is distinct from 'presbytery_entered'
     and (tg_op = 'INSERT' or new.provenance is distinct from old.provenance) then
    raise exception '%: provenance % is reserved for the operator''s import; a tenant write is presbytery_entered', tg_table_name, new.provenance
      using errcode = 'check_violation', constraint = 'oversight_guard_provenance';
  end if;
  return new;
end $$;

revoke all on function presby_oversight_guard_provenance() from public, presby_app, presby_platform;

drop trigger if exists oversight_profiles_guard_provenance on oversight_profiles;
create trigger oversight_profiles_guard_provenance
  before insert or update on oversight_profiles
  for each row execute function presby_oversight_guard_provenance();

drop trigger if exists oversight_buildings_guard_provenance on oversight_buildings;
create trigger oversight_buildings_guard_provenance
  before insert or update on oversight_buildings
  for each row execute function presby_oversight_guard_provenance();

drop trigger if exists oversight_building_appraisals_guard_provenance on oversight_building_appraisals;
create trigger oversight_building_appraisals_guard_provenance
  before insert or update on oversight_building_appraisals
  for each row execute function presby_oversight_guard_provenance();

drop trigger if exists oversight_insurance_years_guard_provenance on oversight_insurance_years;
create trigger oversight_insurance_years_guard_provenance
  before insert or update on oversight_insurance_years
  for each row execute function presby_oversight_guard_provenance();

drop trigger if exists oversight_loans_guard_provenance on oversight_loans;
create trigger oversight_loans_guard_provenance
  before insert or update on oversight_loans
  for each row execute function presby_oversight_guard_provenance();

-- ---------------------------------------------------------------------------
-- 7. RLS and grants. Without FORCE the owner bypasses every policy and RLS is
--    silently inert (F1). presby_platform gets nothing: no platform page reads
--    these tables, and the platform connection is the owner anyway (F44),
--    which only the triggers above bind. presby_app: SELECT, INSERT and a
--    column-limited UPDATE, never DELETE (all deletes are soft).
-- ---------------------------------------------------------------------------
alter table oversight_profiles enable row level security;
alter table oversight_profiles force row level security;
drop policy if exists tenant_isolation on oversight_profiles;
create policy tenant_isolation on oversight_profiles
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table oversight_buildings enable row level security;
alter table oversight_buildings force row level security;
drop policy if exists tenant_isolation on oversight_buildings;
create policy tenant_isolation on oversight_buildings
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table oversight_building_photos enable row level security;
alter table oversight_building_photos force row level security;
drop policy if exists tenant_isolation on oversight_building_photos;
create policy tenant_isolation on oversight_building_photos
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table oversight_building_appraisals enable row level security;
alter table oversight_building_appraisals force row level security;
drop policy if exists tenant_isolation on oversight_building_appraisals;
create policy tenant_isolation on oversight_building_appraisals
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table oversight_insurance_years enable row level security;
alter table oversight_insurance_years force row level security;
drop policy if exists tenant_isolation on oversight_insurance_years;
create policy tenant_isolation on oversight_insurance_years
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

alter table oversight_loans enable row level security;
alter table oversight_loans force row level security;
drop policy if exists tenant_isolation on oversight_loans;
create policy tenant_isolation on oversight_loans
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

revoke all on oversight_profiles, oversight_buildings, oversight_building_photos,
              oversight_building_appraisals, oversight_insurance_years, oversight_loans
  from presby_app, presby_platform;

grant select, insert on oversight_profiles, oversight_buildings, oversight_building_photos,
                        oversight_building_appraisals, oversight_insurance_years, oversight_loans
  to presby_app;

grant update (street_address, city, county, year_organized, phone, row_version, updated_at, updated_by)
  on oversight_profiles to presby_app;
grant update (name, building_type, year_built, first_addition_year, second_addition_year, square_feet,
              roof_condition, plumbing_condition, hvac_condition, boiler_condition,
              has_sprinklers, has_fire_alarm, has_security_system, is_primary, notes,
              retired_on, retired_reason, row_version, updated_at, updated_by, removed_at, removed_by)
  on oversight_buildings to presby_app;
grant update (caption, is_cover, removed_at, removed_by)
  on oversight_building_photos to presby_app;
grant update (removed_at, removed_by)
  on oversight_building_appraisals to presby_app;
grant update (carrier, policy_number, policy_expires_on, recent_claims, pool_interest, notes,
              row_version, updated_at, updated_by, removed_at, removed_by)
  on oversight_insurance_years to presby_app;
grant update (building_id, kind, lender, original_amount_cents, current_balance_cents, balance_as_of,
              grants_amount_cents, guarantee_note, notes, status, paid_off_on,
              row_version, updated_at, updated_by, removed_at, removed_by)
  on oversight_loans to presby_app;

-- ---------------------------------------------------------------------------
-- 8. Comments.
-- ---------------------------------------------------------------------------
comment on table oversight_profiles is
  'The presbytery''s own record of a member congregation''s address, city, county, year organized and phone, never the congregation''s (DECISION-119/120/344). Tier 1: congregation_oversight.manage. One row per (organization_id, about_org_id); no removal (cleared by saving empty fields). Writer: src/lib/oversight/store.ts.';
comment on table oversight_buildings is
  'The presbytery''s own record of a member congregation''s buildings, never the congregation''s (DECISION-119/120/344). Tier 1: congregation_oversight.manage. Retire is reversible (retired_on/retired_reason); removal is one-way (presby_oversight_guard_write). (id, organization_id, about_org_id) is the target of every child FK, so a child cannot name another congregation''s building. Writer: src/lib/oversight/store.ts.';
comment on table oversight_building_photos is
  'The presbytery''s own photos of a member congregation''s building, never the congregation''s (DECISION-344/346). Tier 1: congregation_oversight.manage. Both blobs are private by a three-column FK; only caption, is_cover and the removal pair change. Written from Increment 2 by src/lib/oversight/photo-store.ts only.';
comment on table oversight_building_appraisals is
  'The presbytery''s own dated appraisals of a member congregation''s building, never the congregation''s (DECISION-344). Tier 2: congregation_oversight.finance. Never edited (T4): recorded and removed only. Writer: src/lib/oversight/store.ts.';
comment on table oversight_insurance_years is
  'The presbytery''s own record of a member congregation''s insurance, one live row per policy year, never the congregation''s (DECISION-344). Tier 2: congregation_oversight.finance. Writer: src/lib/oversight/store.ts.';
comment on table oversight_loans is
  'The presbytery''s own record of a member congregation''s loans (program loans, guarantees), never the congregation''s (DECISION-344). Tier 2: congregation_oversight.finance. One balance plus its as-of date. Writer: src/lib/oversight/store.ts.';

comment on column oversight_profiles.street_address is
  'Line-feed separated lines as normalizeAddress (src/lib/site-address.ts) writes them; never parsed.';
comment on column oversight_buildings.has_sprinklers is
  'Tri-state: true yes, false no, null not recorded (T2). Likewise has_fire_alarm and has_security_system.';
comment on column oversight_buildings.is_primary is
  'At most one live primary per congregation (oversight_buildings_one_primary_idx); a retired building is never primary (oversight_buildings_primary_not_retired).';
comment on column oversight_building_photos.asset_audience is
  'Constant ''private'' (oversight_building_photos_audience_private): the third column of both blob FKs, so presby_public_site_asset() never serves a building photo.';
comment on column oversight_loans.building_id is
  'Optional link to a building of the same congregation (three-column FK, MATCH SIMPLE: not enforced while null). No UI in v1 (T9).';

comment on column oversight_profiles.provenance is
  '''presbytery_entered'' or ''imported'' (the operator''s one-time import session, DECISION-351). A tenant write is always presbytery_entered (presby_oversight_guard_provenance); an imported row stays imported after an edit.';
comment on column oversight_buildings.provenance is
  '''presbytery_entered'' or ''imported''. Immutable after insert (presby_oversight_guard_write); a tenant write is always presbytery_entered (presby_oversight_guard_provenance).';
comment on column oversight_building_appraisals.provenance is
  '''presbytery_entered'' or ''imported''. Immutable after insert (presby_oversight_guard_write); a tenant write is always presbytery_entered (presby_oversight_guard_provenance).';
comment on column oversight_insurance_years.provenance is
  '''presbytery_entered'' or ''imported''. Immutable after insert (presby_oversight_guard_write); a tenant write is always presbytery_entered (presby_oversight_guard_provenance).';
comment on column oversight_loans.provenance is
  '''presbytery_entered'' or ''imported''. Immutable after insert (presby_oversight_guard_write); a tenant write is always presbytery_entered (presby_oversight_guard_provenance).';

comment on column oversight_profiles.row_version is
  'Optimistic concurrency (T5, DECISION-349): the writer compares it in the UPDATE''s WHERE and increments it. Likewise on buildings, insurance years and loans.';

comment on function presby_oversight_guard_write() is
  'BEFORE INSERT OR UPDATE on the five oversight tables with a removal pair. Removal is one-way; TG_ARGV[0] names the immutable columns; a non-owner insert starts unremoved with created_at = clock_timestamp(). SECURITY INVOKER, binds the owner too (F44). drizzle/0089 section 6b.';
comment on function presby_oversight_guard_provenance() is
  'BEFORE INSERT OR UPDATE on the five oversight tables with provenance: a non-owner connection may write only ''presbytery_entered'' (''imported'' is the owner-run import''s alone, DECISION-351); an edit that leaves an imported row imported passes. SECURITY INVOKER. drizzle/0089 section 6d.';
comment on function presby_oversight_building_live_guard() is
  'BEFORE INSERT OR UPDATE OF building_id on oversight_building_photos, _appraisals and oversight_loans: refuses a new child of a removed building. FOR SHARE serializes with a concurrent removal. SECURITY INVOKER. drizzle/0089 section 6c.';

-- R8 (DECISION-347, F451): the superseded congregation_oversight fields. The
-- columns stay (no drop); no reader or writer touches them from 0.61.0.
comment on column congregation_oversight.insurance_carrier is
  'SUPERSEDED by oversight_insurance_years (0089, DECISION-347): no longer read or written; legacy values convert only in the operator''s import session.';
comment on column congregation_oversight.insurance_expires_on is
  'SUPERSEDED by oversight_insurance_years (0089, DECISION-347): no longer read or written; legacy values convert only in the operator''s import session.';
comment on column congregation_oversight.buildings_notes is
  'Shown as "Property notes" on the assessment form (DECISION-347). Buildings themselves are oversight_buildings (0089).';

-- The two 2FA comments, restated from the LIVE pg_description (re-read
-- 2026-11-17; 0080's "Six keys" was stale from 0074 on).
comment on column permissions.requires_two_factor is
  'When true, holding this key at any active membership requires 2FA at sign-in (read by presby_two_factor_required(); DECISION-170/175). Ten keys set it: giving.view, giving.record, giving.manage (0055); reimbursement.view, reimbursement.pay, reimbursement.manage (0074); roles.manage, role_grants.manage, domains.manage (0080; DECISION-291); and congregation_oversight.finance (0089; DECISION-345). Extending it further is a tracked follow-up (S2).';
comment on function presby_two_factor_required(uuid) is
  'True when (A) any organization the user holds an active membership in requires two-factor authentication, or (B) the user''s live person effectively holds, at any active membership, a key with permissions.requires_two_factor (any flagged key: the three giving keys, the three reimbursement keys, roles.manage, role_grants.manage, domains.manage and congregation_oversight.finance; DECISION-170/175/291/345). Arm B mirrors presby_effective_permissions()''s four arms inline (F140; agreement and md5 drift pin in scripts/giving/test-rls-46.sql). SECURITY DEFINER: runs at sign-in with no org GUC set (F26).';

-- ---------------------------------------------------------------------------
-- 9. Closing assertions. A miss raises, and `psql -1` rolls the whole file
--    back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables constant text[] := array['oversight_profiles', 'oversight_buildings', 'oversight_building_photos',
                                    'oversight_building_appraisals', 'oversight_insurance_years', 'oversight_loans'];
  v_n integer;
begin
  select count(*) into v_n from pg_class
   where relname = any (v_tables) and relkind = 'r' and relrowsecurity and relforcerowsecurity;
  if v_n <> 6 then
    raise exception '0089: expected FORCE ROW LEVEL SECURITY on all six oversight tables, found %', v_n;
  end if;

  select count(*) into v_n from pg_policies
   where tablename = any (v_tables) and policyname = 'tenant_isolation';
  if v_n <> 6 then
    raise exception '0089: expected one tenant_isolation policy on each of the six tables, found %', v_n;
  end if;

  select count(*) into v_n
    from pg_class c, lateral aclexplode(c.relacl) a
   where c.relname = any (v_tables) and c.relkind = 'r'
     and a.grantee = 'presby_app'::regrole and a.privilege_type in ('DELETE', 'TRUNCATE');
  if v_n <> 0 then
    raise exception '0089: presby_app holds DELETE or TRUNCATE on an oversight table (all deletes are soft)';
  end if;

  select count(*) into v_n
    from pg_class c
   where c.relname = any (v_tables) and c.relkind = 'r'
     and (exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'presby_platform'::regrole)
          or exists (select 1 from pg_attribute att, lateral aclexplode(att.attacl) x
                      where att.attrelid = c.oid and x.grantee = 'presby_platform'::regrole));
  if v_n <> 0 then
    raise exception '0089: presby_platform holds a privilege on an oversight table';
  end if;

  if not exists (select 1 from permissions
                  where key = 'congregation_oversight.finance' and module = 'presbytery'
                    and sensitivity_tier = 2 and requires_two_factor) then
    raise exception '0089: congregation_oversight.finance is not tier 2, module presbytery, requires_two_factor';
  end if;

  if not ('congregation_oversight.finance' = any (presby_founding_administrator_permission_keys('presbytery'))) then
    raise exception '0089: the presbytery founding bundle lacks congregation_oversight.finance';
  end if;
  if exists (select 1 from unnest(array['congregation', 'new_worshiping_community', 'synod', 'general_assembly']) t
              where 'congregation_oversight.finance' = any (presby_founding_administrator_permission_keys(t))) then
    raise exception '0089: a non-presbytery founding bundle carries congregation_oversight.finance';
  end if;

  if exists (select 1 from app_roles r join organizations o on o.id = r.organization_id
              where r.key = 'founding_administrator' and o.organization_type = 'presbytery'
                and not exists (select 1 from app_role_permissions rp
                                 where rp.role_id = r.id and rp.permission_key = 'congregation_oversight.finance')) then
    raise exception '0089: a presbytery founding_administrator role lacks the finance key after the backfill';
  end if;

  select count(*) into v_n from pg_proc p
   where p.proname in ('presby_oversight_guard_write', 'presby_oversight_building_live_guard',
                       'presby_oversight_guard_provenance')
     and not p.prosecdef and p.proconfig = array['search_path=public, pg_temp'];
  if v_n <> 3 then
    raise exception '0089: the three oversight guard functions are not all SECURITY INVOKER with search_path pinned';
  end if;

  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal and t.tgenabled = 'O'
     and (t.tgrelid::regclass::text, t.tgname) in (
       ('oversight_profiles', 'oversight_profiles_about_org'),
       ('oversight_buildings', 'oversight_buildings_about_org'),
       ('oversight_insurance_years', 'oversight_insurance_years_about_org'),
       ('oversight_loans', 'oversight_loans_about_org'),
       ('oversight_buildings', 'oversight_buildings_guard_write'),
       ('oversight_insurance_years', 'oversight_insurance_years_guard_write'),
       ('oversight_loans', 'oversight_loans_guard_write'),
       ('oversight_building_appraisals', 'oversight_building_appraisals_guard_write'),
       ('oversight_building_photos', 'oversight_building_photos_guard_write'),
       ('oversight_building_photos', 'oversight_building_photos_building_live'),
       ('oversight_building_appraisals', 'oversight_building_appraisals_building_live'),
       ('oversight_loans', 'oversight_loans_building_live'),
       ('oversight_profiles', 'oversight_profiles_guard_provenance'),
       ('oversight_buildings', 'oversight_buildings_guard_provenance'),
       ('oversight_building_appraisals', 'oversight_building_appraisals_guard_provenance'),
       ('oversight_insurance_years', 'oversight_insurance_years_guard_provenance'),
       ('oversight_loans', 'oversight_loans_guard_provenance'));
  if v_n <> 17 then
    raise exception '0089: expected the 17 oversight triggers enabled, found %', v_n;
  end if;
end $$;
