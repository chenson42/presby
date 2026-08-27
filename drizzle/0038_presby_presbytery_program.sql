-- Presbytery program: congregation oversight, statistics, and per-capita
-- (docs/work-log/2026-08-27-presbytery-program.md, Phase 3 / DECISION-118
-- through DECISION-121; database-admin schema commit, Increments 3+3b, work-
-- log docs/work-log/2026-08-27-presbytery-oversight-statistics.md).
--
-- Four schema changes, landing together since they're one schema commit's
-- surface (Phase 3 Data Model):
--
--   1. Four new tables in src/lib/db/domain/presbytery.ts:
--      congregation_oversight, congregation_statistics, per_capita_rates,
--      per_capita_records. FORCE ROW LEVEL SECURITY + the standard
--      tenant_isolation policy on all four, matching every tenant table
--      added since the 0009 loop was frozen.
--   2. presby_reject_published_statistics_write() trigger — dormant until
--      Increment 4a's UI ships (nothing writes provenance =
--      'published_by_congregation' yet, but the freeze rule is enforced from
--      day one so 4a needs no schema migration of its own beyond the two
--      functions below).
--   3. presby_publish_sasr_snapshot() / presby_list_own_congregation_
--      publications() — the SECURITY DEFINER function pair (DECISION-118).
--      Shipped now, alongside the schema, rather than deferred to Increment
--      4a's own migration: the freeze trigger and the partial unique index
--      are only correctly testable against a real publish path, and
--      test-rls.sql's confused-deputy assertions (Phase 3 Edge Cases,
--      "Two-real-orgs e2e/RLS discipline") need the function to exist.
--   4. Four new permission-catalog rows (congregation_oversight.manage,
--      statistics.manage, per_capita.manage, statistics.publish) +
--      presbytery_stated_clerk TEMPLATE bindings for statistics.manage and
--      per_capita.manage (DECISION-119). congregation_oversight.manage gets
--      NO binding here — no PC(USA) office is the constitutional keeper of
--      "our opinion of this congregation" (DECISION-119, following
--      groups.manage/events.manage's no-default precedent); its
--      fixture-only dev-reachability grant lives in scripts/seed-dev.sql,
--      same seam events.manage's own fixture grant uses.
--      statistics.publish binds to the CONGREGATION's stated_clerk
--      (architect Ruling 2) — but `stated_clerk` has no global template row
--      (every prior binding to it — officers.manage, groups.manage,
--      events.manage — was a direct grant to Alder Creek's org-scoped
--      f0000000-...-0005 row in scripts/seed-dev.sql, never a migration
--      insert, because no production role-auto-provisioning surface creates
--      stated_clerk yet). Following that exact precedent: statistics.
--      publish's binding also lives in scripts/seed-dev.sql, NOT here.
--
-- Migration-numbering note: `ls drizzle/` was run immediately before this
-- file was written (see the tool-call preceding this file's creation) and
-- found 0037_presby_ministry_credentials.sql as the highest claimed number,
-- with no gap and no second pipeline's file on disk. This migration claims
-- 0038, the next free number — following 0036/0037's own "claim the number
-- actually free on disk, don't trust Phase 3's pencilled guess" discipline.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. congregation_oversight
-- ---------------------------------------------------------------------------
create table if not exists congregation_oversight (
  id uuid primary key default gen_random_uuid(),
  -- The PRESBYTERY, forced (D1/F2 shape) — never the congregation assessed.
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Plain FK — organizations is the one cross-tenant-readable structural
  -- table (schema-design.md section 17). The application layer validates
  -- this is an actual member congregation of the recording presbytery
  -- (parent_id + organization_type check) before insert; the DB does not
  -- enforce that relationship itself.
  about_org_id uuid not null references organizations(id),
  viability_score smallint,
  redevelopment_notes text,
  buildings_notes text,
  insurance_carrier text,
  insurance_expires_on date,
  latitude numeric,
  longitude numeric,
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default now(),
  constraint congregation_oversight_org_about_key unique (organization_id, about_org_id),
  constraint congregation_oversight_id_org_key unique (id, organization_id),
  constraint congregation_oversight_viability_score_range
    check (viability_score is null or viability_score between 1 and 3)
);

-- Phase 3's own Data Model lists this index alongside the identically-shaped
-- unique constraint above — a duplicate on the same two leading columns (the
-- unique constraint already serves every lookup this index would). Kept as
-- specified rather than silently dropped; harmless index bloat, flagged
-- honestly here and in the work-log rather than papered over.
create index if not exists congregation_oversight_org_about_idx
  on congregation_oversight (organization_id, about_org_id);

alter table congregation_oversight enable row level security;
alter table congregation_oversight force row level security;

drop policy if exists tenant_isolation on congregation_oversight;
create policy tenant_isolation on congregation_oversight
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on congregation_oversight to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 2. congregation_statistics
-- ---------------------------------------------------------------------------
-- ONE table with a provenance column, not two coalesced tables (DECISION-120):
-- every consumer needs the same (about_org_id, year) keyspace regardless of
-- who wrote a given row. organization_id is the presbytery for EVERY
-- provenance, including published rows.
create table if not exists congregation_statistics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  about_org_id uuid not null references organizations(id),
  year integer not null,
  provenance text not null,
  -- Self-FK, AnyPgColumn-in-Drizzle idiom (organizations.parent_id /
  -- events.parent_event_id precedent). Only meaningful for provenance =
  -- 'published_by_congregation'.
  supersedes_publication_id uuid references congregation_statistics(id),
  published_at timestamptz,
  -- Phase 3's own API Contract names p_minute_reference as
  -- presby_publish_sasr_snapshot()'s second parameter, but the Data Model
  -- table listing has no column for it to land in — an omission, not a
  -- deliberate no-column decision (nothing else in the design explains
  -- discarding it). Added here, nullable, same shape as
  -- appointments.minute_reference. Named as a Phase 3 deviation in the
  -- work-log.
  minute_reference text,
  entered_by uuid references users(id),

  -- Gains (SASR)
  gains_professions_under18 integer,
  gains_professions_18plus integer,
  gains_certificate integer,
  gains_other integer,
  -- Losses
  losses_certificate integer,
  losses_deaths integer,
  losses_other integer,
  -- Ending rolls
  ending_active integer,
  ending_baptized integer,
  ending_affiliate integer,
  ending_other_participants integer,
  -- Gender
  gender_woman integer,
  gender_man integer,
  gender_nonbinary integer,
  -- Age brackets
  age_17_under integer,
  age_18_25 integer,
  age_26_40 integer,
  age_41_55 integer,
  age_56_70 integer,
  age_71_over integer,
  age_unknown integer,
  -- Racial-ethnic (9 SASR categories, active-membership aggregate only, v1)
  race_asian integer,
  race_african integer,
  race_african_american integer,
  race_black integer,
  race_hispanic integer,
  race_middle_eastern integer,
  race_native_american integer,
  race_white integer,
  race_other integer,
  -- Disabilities (aggregate)
  disability_hearing integer,
  disability_mobility integer,
  disability_sight integer,
  disability_other integer,
  -- Officers (total counts only, v1)
  officers_ruling_elder_count integer,
  officers_deacon_count integer,
  -- Baptisms, youth
  baptisms_children integer,
  baptisms_adults integer,
  youth_4_under integer,
  youth_k_5 integer,
  youth_6_8 integer,
  youth_9_12 integer,
  -- Worship / giving-unit counts
  avg_weekly_worship_attendance integer,
  potential_giving_units integer,
  -- Financial (14 SASR lines + budgeted income/expense)
  receipts_contributions numeric,
  receipts_capital_building_funds numeric,
  receipts_investment_endowment_income numeric,
  receipts_bequests numeric,
  receipts_other_income numeric,
  receipts_subsidy_or_aid numeric,
  exp_local_program numeric,
  exp_local_mission numeric,
  exp_capital numeric,
  exp_investment numeric,
  exp_per_capita_apportionment numeric,
  exp_validated_mission_pcusa numeric,
  exp_ga_theological_education_fund numeric,
  exp_other_mission numeric,
  budgeted_income numeric,
  budgeted_expense numeric,

  created_at timestamptz not null default now(),

  constraint congregation_statistics_id_org_key unique (id, organization_id),
  constraint congregation_statistics_provenance_allowed
    check (provenance in ('presbytery_entered', 'published_by_congregation', 'imported')),
  -- Boundary validation belt-and-suspenders (F26: the SECURITY DEFINER
  -- function below is the primary gate for published rows; this also covers
  -- presbytery_entered/imported rows, which have no function in front of
  -- them at all). NULL passes (an unreported field); only a negative value
  -- is rejected.
  constraint congregation_statistics_nonneg_check check (
    (gains_professions_under18 is null or gains_professions_under18 >= 0) and
    (gains_professions_18plus is null or gains_professions_18plus >= 0) and
    (gains_certificate is null or gains_certificate >= 0) and
    (gains_other is null or gains_other >= 0) and
    (losses_certificate is null or losses_certificate >= 0) and
    (losses_deaths is null or losses_deaths >= 0) and
    (losses_other is null or losses_other >= 0) and
    (ending_active is null or ending_active >= 0) and
    (ending_baptized is null or ending_baptized >= 0) and
    (ending_affiliate is null or ending_affiliate >= 0) and
    (ending_other_participants is null or ending_other_participants >= 0) and
    (gender_woman is null or gender_woman >= 0) and
    (gender_man is null or gender_man >= 0) and
    (gender_nonbinary is null or gender_nonbinary >= 0) and
    (age_17_under is null or age_17_under >= 0) and
    (age_18_25 is null or age_18_25 >= 0) and
    (age_26_40 is null or age_26_40 >= 0) and
    (age_41_55 is null or age_41_55 >= 0) and
    (age_56_70 is null or age_56_70 >= 0) and
    (age_71_over is null or age_71_over >= 0) and
    (age_unknown is null or age_unknown >= 0) and
    (race_asian is null or race_asian >= 0) and
    (race_african is null or race_african >= 0) and
    (race_african_american is null or race_african_american >= 0) and
    (race_black is null or race_black >= 0) and
    (race_hispanic is null or race_hispanic >= 0) and
    (race_middle_eastern is null or race_middle_eastern >= 0) and
    (race_native_american is null or race_native_american >= 0) and
    (race_white is null or race_white >= 0) and
    (race_other is null or race_other >= 0) and
    (disability_hearing is null or disability_hearing >= 0) and
    (disability_mobility is null or disability_mobility >= 0) and
    (disability_sight is null or disability_sight >= 0) and
    (disability_other is null or disability_other >= 0) and
    (officers_ruling_elder_count is null or officers_ruling_elder_count >= 0) and
    (officers_deacon_count is null or officers_deacon_count >= 0) and
    (baptisms_children is null or baptisms_children >= 0) and
    (baptisms_adults is null or baptisms_adults >= 0) and
    (youth_4_under is null or youth_4_under >= 0) and
    (youth_k_5 is null or youth_k_5 >= 0) and
    (youth_6_8 is null or youth_6_8 >= 0) and
    (youth_9_12 is null or youth_9_12 >= 0) and
    (avg_weekly_worship_attendance is null or avg_weekly_worship_attendance >= 0) and
    (potential_giving_units is null or potential_giving_units >= 0)
  )
);

-- Partial: deliberately excludes 'published_by_congregation' — a republish is
-- a new frozen row chained by supersedes_publication_id, never an UPDATE, so
-- it must never collide with this constraint.
create unique index if not exists congregation_statistics_entered_unique_idx
  on congregation_statistics (organization_id, about_org_id, year, provenance)
  where provenance in ('presbytery_entered', 'imported');

-- NOT partial — every consumer's rollup/basis-year read needs to find a row
-- regardless of provenance, including published ones the unique index above
-- deliberately excludes.
create index if not exists congregation_statistics_org_about_year_idx
  on congregation_statistics (organization_id, about_org_id, year);

alter table congregation_statistics enable row level security;
alter table congregation_statistics force row level security;

drop policy if exists tenant_isolation on congregation_statistics;
create policy tenant_isolation on congregation_statistics
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on congregation_statistics to presby_app, presby_platform;

-- Invariant: an approved publication is immutable. Corrections are a new
-- INSERT with supersedes_publication_id set (via presby_publish_sasr_
-- snapshot() below), never an UPDATE — the roll_actions/void precedent,
-- applied to a column instead of a second table.
create or replace function presby_reject_published_statistics_write()
returns trigger language plpgsql as $$
begin
  raise exception
    'congregation_statistics %: published rows are immutable; republish via presby_publish_sasr_snapshot(), which supersedes automatically',
    old.id
    using errcode = 'check_violation';
end $$;

drop trigger if exists congregation_statistics_freeze on congregation_statistics;
create trigger congregation_statistics_freeze
  before update or delete on congregation_statistics
  for each row
  when (old.provenance = 'published_by_congregation')
  execute function presby_reject_published_statistics_write();

-- ---------------------------------------------------------------------------
-- 3. per_capita_rates
-- ---------------------------------------------------------------------------
create table if not exists per_capita_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  billing_year integer not null,
  -- Explicit, presbytery-set; defaults to billing_year - 2 at the ACTION
  -- layer (Operator Answer 1: arrears on a two-year lag is the dominant real
  -- PC(USA) practice), not a generated column — a presbytery may
  -- legitimately override it.
  basis_year integer not null,
  -- ONE combined rate, not three GA/synod/presbytery components. LEAN CALL:
  -- no consumer in this design needs the component breakdown.
  rate_per_member numeric not null,
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default now(),
  constraint per_capita_rates_org_billing_year_key unique (organization_id, billing_year),
  constraint per_capita_rates_id_org_key unique (id, organization_id)
);

alter table per_capita_rates enable row level security;
alter table per_capita_rates force row level security;

drop policy if exists tenant_isolation on per_capita_rates;
create policy tenant_isolation on per_capita_rates
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on per_capita_rates to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 4. per_capita_records
-- ---------------------------------------------------------------------------
-- ending_active_basis/rate_applied/amount_owed are SNAPSHOTS, frozen at
-- generation time (psvonline-portal's own documented practice: "snapshot at
-- calculation time") — amount_owed is STORED, not generated, so a later rate
-- correction or republished statistic cannot silently move a bill already
-- issued (Phase 3 Edge Cases: "republish-after-billing").
create table if not exists per_capita_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  about_org_id uuid not null references organizations(id),
  billing_year integer not null,
  basis_year integer not null,
  ending_active_basis integer not null,
  rate_applied numeric not null,
  amount_owed numeric not null,
  paid_status text not null default 'unpaid',
  paid_amount numeric,
  paid_at timestamptz,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  constraint per_capita_records_org_about_billing_year_key
    unique (organization_id, about_org_id, billing_year),
  constraint per_capita_records_id_org_key unique (id, organization_id),
  constraint per_capita_records_paid_status_allowed
    check (paid_status in ('unpaid', 'partial', 'paid'))
);

alter table per_capita_records enable row level security;
alter table per_capita_records force row level security;

drop policy if exists tenant_isolation on per_capita_records;
create policy tenant_isolation on per_capita_records
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on per_capita_records to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 5. presby_publish_sasr_snapshot() — the first cross-org WRITE in the
--    platform (DECISION-118).
-- ---------------------------------------------------------------------------
-- Confused-deputy invariant (F26), made STRONGER than "no caller-supplied
-- target": the function accepts NO organization id of any kind, source or
-- target. It reads presby_current_org() (already verified by
-- withOrgContext()'s membership check before this function is ever called)
-- to learn which congregation is publishing, walks exactly one parent_id
-- link, and raises on either a missing parent or a wrong type. There is
-- nothing in the signature a caller could spoof.
--
-- The parameter list IS the allow-list — every SASR aggregate is its own
-- named, typed parameter, matching congregation_statistics's column set 1:1.
-- sasr_reports.payload (jsonb) is never accepted or forwarded: a field with
-- no parameter slot cannot smuggle through. Every count is range-validated
-- INSIDE this function (the trust boundary, not the calling action — an
-- action-layer-only check would not survive a future second caller).
--
-- The correction/republish target (supersedes_publication_id) is DERIVED,
-- never passed: the function looks up the congregation's own most recent
-- published row for the same year and chains to it automatically, so there
-- is no id parameter here to spoof either.
--
-- SECURITY DEFINER is load-bearing, not decoration, same F26 reasoning as
-- presby_match_person()/presby_link_person() (drizzle/0009_presby_rls.sql):
-- without it, this function's own INSERT would run under the CALLING
-- congregation's RLS context, and the standard tenant_isolation policy's
-- WITH CHECK (organization_id = presby_current_org()) would reject an insert
-- whose organization_id is the PRESBYTERY while app.current_org_id is set to
-- the congregation — exactly the write this function exists to make. It
-- leaks nothing beyond what the congregation already legitimately submits
-- about itself.
create or replace function presby_publish_sasr_snapshot(
  p_report_year integer,
  p_minute_reference text,
  p_gains_professions_under18 integer default null,
  p_gains_professions_18plus integer default null,
  p_gains_certificate integer default null,
  p_gains_other integer default null,
  p_losses_certificate integer default null,
  p_losses_deaths integer default null,
  p_losses_other integer default null,
  p_ending_active integer default null,
  p_ending_baptized integer default null,
  p_ending_affiliate integer default null,
  p_ending_other_participants integer default null,
  p_gender_woman integer default null,
  p_gender_man integer default null,
  p_gender_nonbinary integer default null,
  p_age_17_under integer default null,
  p_age_18_25 integer default null,
  p_age_26_40 integer default null,
  p_age_41_55 integer default null,
  p_age_56_70 integer default null,
  p_age_71_over integer default null,
  p_age_unknown integer default null,
  p_race_asian integer default null,
  p_race_african integer default null,
  p_race_african_american integer default null,
  p_race_black integer default null,
  p_race_hispanic integer default null,
  p_race_middle_eastern integer default null,
  p_race_native_american integer default null,
  p_race_white integer default null,
  p_race_other integer default null,
  p_disability_hearing integer default null,
  p_disability_mobility integer default null,
  p_disability_sight integer default null,
  p_disability_other integer default null,
  p_officers_ruling_elder_count integer default null,
  p_officers_deacon_count integer default null,
  p_baptisms_children integer default null,
  p_baptisms_adults integer default null,
  p_youth_4_under integer default null,
  p_youth_k_5 integer default null,
  p_youth_6_8 integer default null,
  p_youth_9_12 integer default null,
  p_avg_weekly_worship_attendance integer default null,
  p_potential_giving_units integer default null,
  p_receipts_contributions numeric default null,
  p_receipts_capital_building_funds numeric default null,
  p_receipts_investment_endowment_income numeric default null,
  p_receipts_bequests numeric default null,
  p_receipts_other_income numeric default null,
  p_receipts_subsidy_or_aid numeric default null,
  p_exp_local_program numeric default null,
  p_exp_local_mission numeric default null,
  p_exp_capital numeric default null,
  p_exp_investment numeric default null,
  p_exp_per_capita_apportionment numeric default null,
  p_exp_validated_mission_pcusa numeric default null,
  p_exp_ga_theological_education_fund numeric default null,
  p_exp_other_mission numeric default null,
  p_budgeted_income numeric default null,
  p_budgeted_expense numeric default null
)
returns uuid
language plpgsql security definer as $$
declare
  v_org         uuid := presby_current_org();
  v_parent      uuid;
  v_parent_type organization_type;
  v_prev        uuid;
  v_id          uuid;
  -- Generous integer count bound: no congregation plausibly reports six
  -- figures on any single SASR line.
  v_count_max   constant integer := 1000000;
  -- Generous financial bound (Phase 3 Edge Cases: "bounded generously, e.g.
  -- < $100M").
  v_money_max   constant numeric := 100000000;
begin
  if v_org is null then
    raise exception 'presby_publish_sasr_snapshot: no org context'
      using errcode = 'insufficient_privilege';
  end if;

  select parent_id into v_parent from organizations where id = v_org;
  if v_parent is null then
    raise exception
      'presby_publish_sasr_snapshot: organization % has no parent organization to publish to',
      v_org
      using errcode = 'invalid_parameter_value';
  end if;

  select organization_type into v_parent_type from organizations where id = v_parent;
  if v_parent_type is distinct from 'presbytery' then
    raise exception
      'presby_publish_sasr_snapshot: parent of % is not a presbytery (found %)',
      v_org, v_parent_type
      using errcode = 'invalid_parameter_value';
  end if;

  if p_report_year is null or p_report_year < 1900 or p_report_year > 2100 then
    raise exception 'presby_publish_sasr_snapshot: report year % out of range', p_report_year
      using errcode = 'invalid_parameter_value';
  end if;

  if not (
    (p_gains_professions_under18 is null or p_gains_professions_under18 between 0 and v_count_max) and
    (p_gains_professions_18plus is null or p_gains_professions_18plus between 0 and v_count_max) and
    (p_gains_certificate is null or p_gains_certificate between 0 and v_count_max) and
    (p_gains_other is null or p_gains_other between 0 and v_count_max) and
    (p_losses_certificate is null or p_losses_certificate between 0 and v_count_max) and
    (p_losses_deaths is null or p_losses_deaths between 0 and v_count_max) and
    (p_losses_other is null or p_losses_other between 0 and v_count_max) and
    (p_ending_active is null or p_ending_active between 0 and v_count_max) and
    (p_ending_baptized is null or p_ending_baptized between 0 and v_count_max) and
    (p_ending_affiliate is null or p_ending_affiliate between 0 and v_count_max) and
    (p_ending_other_participants is null or p_ending_other_participants between 0 and v_count_max) and
    (p_gender_woman is null or p_gender_woman between 0 and v_count_max) and
    (p_gender_man is null or p_gender_man between 0 and v_count_max) and
    (p_gender_nonbinary is null or p_gender_nonbinary between 0 and v_count_max) and
    (p_age_17_under is null or p_age_17_under between 0 and v_count_max) and
    (p_age_18_25 is null or p_age_18_25 between 0 and v_count_max) and
    (p_age_26_40 is null or p_age_26_40 between 0 and v_count_max) and
    (p_age_41_55 is null or p_age_41_55 between 0 and v_count_max) and
    (p_age_56_70 is null or p_age_56_70 between 0 and v_count_max) and
    (p_age_71_over is null or p_age_71_over between 0 and v_count_max) and
    (p_age_unknown is null or p_age_unknown between 0 and v_count_max) and
    (p_race_asian is null or p_race_asian between 0 and v_count_max) and
    (p_race_african is null or p_race_african between 0 and v_count_max) and
    (p_race_african_american is null or p_race_african_american between 0 and v_count_max) and
    (p_race_black is null or p_race_black between 0 and v_count_max) and
    (p_race_hispanic is null or p_race_hispanic between 0 and v_count_max) and
    (p_race_middle_eastern is null or p_race_middle_eastern between 0 and v_count_max) and
    (p_race_native_american is null or p_race_native_american between 0 and v_count_max) and
    (p_race_white is null or p_race_white between 0 and v_count_max) and
    (p_race_other is null or p_race_other between 0 and v_count_max) and
    (p_disability_hearing is null or p_disability_hearing between 0 and v_count_max) and
    (p_disability_mobility is null or p_disability_mobility between 0 and v_count_max) and
    (p_disability_sight is null or p_disability_sight between 0 and v_count_max) and
    (p_disability_other is null or p_disability_other between 0 and v_count_max) and
    (p_officers_ruling_elder_count is null or p_officers_ruling_elder_count between 0 and v_count_max) and
    (p_officers_deacon_count is null or p_officers_deacon_count between 0 and v_count_max) and
    (p_baptisms_children is null or p_baptisms_children between 0 and v_count_max) and
    (p_baptisms_adults is null or p_baptisms_adults between 0 and v_count_max) and
    (p_youth_4_under is null or p_youth_4_under between 0 and v_count_max) and
    (p_youth_k_5 is null or p_youth_k_5 between 0 and v_count_max) and
    (p_youth_6_8 is null or p_youth_6_8 between 0 and v_count_max) and
    (p_youth_9_12 is null or p_youth_9_12 between 0 and v_count_max) and
    (p_avg_weekly_worship_attendance is null or p_avg_weekly_worship_attendance between 0 and v_count_max) and
    (p_potential_giving_units is null or p_potential_giving_units between 0 and v_count_max) and
    (p_receipts_contributions is null or p_receipts_contributions between 0 and v_money_max) and
    (p_receipts_capital_building_funds is null or p_receipts_capital_building_funds between 0 and v_money_max) and
    (p_receipts_investment_endowment_income is null or p_receipts_investment_endowment_income between 0 and v_money_max) and
    (p_receipts_bequests is null or p_receipts_bequests between 0 and v_money_max) and
    (p_receipts_other_income is null or p_receipts_other_income between 0 and v_money_max) and
    (p_receipts_subsidy_or_aid is null or p_receipts_subsidy_or_aid between 0 and v_money_max) and
    (p_exp_local_program is null or p_exp_local_program between 0 and v_money_max) and
    (p_exp_local_mission is null or p_exp_local_mission between 0 and v_money_max) and
    (p_exp_capital is null or p_exp_capital between 0 and v_money_max) and
    (p_exp_investment is null or p_exp_investment between 0 and v_money_max) and
    (p_exp_per_capita_apportionment is null or p_exp_per_capita_apportionment between 0 and v_money_max) and
    (p_exp_validated_mission_pcusa is null or p_exp_validated_mission_pcusa between 0 and v_money_max) and
    (p_exp_ga_theological_education_fund is null or p_exp_ga_theological_education_fund between 0 and v_money_max) and
    (p_exp_other_mission is null or p_exp_other_mission between 0 and v_money_max) and
    (p_budgeted_income is null or p_budgeted_income between 0 and v_money_max) and
    (p_budgeted_expense is null or p_budgeted_expense between 0 and v_money_max)
  ) then
    raise exception 'presby_publish_sasr_snapshot: a value is out of the allowed range'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Derive the correction target — never accepted as a parameter. The most
  -- recent existing published row for this congregation/year, if any.
  select id into v_prev
    from congregation_statistics
   where organization_id = v_parent
     and about_org_id = v_org
     and year = p_report_year
     and provenance = 'published_by_congregation'
   order by published_at desc nulls last, created_at desc
   limit 1;

  insert into congregation_statistics (
    organization_id, about_org_id, year, provenance, supersedes_publication_id,
    published_at, minute_reference,
    gains_professions_under18, gains_professions_18plus, gains_certificate, gains_other,
    losses_certificate, losses_deaths, losses_other,
    ending_active, ending_baptized, ending_affiliate, ending_other_participants,
    gender_woman, gender_man, gender_nonbinary,
    age_17_under, age_18_25, age_26_40, age_41_55, age_56_70, age_71_over, age_unknown,
    race_asian, race_african, race_african_american, race_black, race_hispanic,
    race_middle_eastern, race_native_american, race_white, race_other,
    disability_hearing, disability_mobility, disability_sight, disability_other,
    officers_ruling_elder_count, officers_deacon_count,
    baptisms_children, baptisms_adults,
    youth_4_under, youth_k_5, youth_6_8, youth_9_12,
    avg_weekly_worship_attendance, potential_giving_units,
    receipts_contributions, receipts_capital_building_funds,
    receipts_investment_endowment_income, receipts_bequests, receipts_other_income,
    receipts_subsidy_or_aid,
    exp_local_program, exp_local_mission, exp_capital, exp_investment,
    exp_per_capita_apportionment, exp_validated_mission_pcusa,
    exp_ga_theological_education_fund, exp_other_mission,
    budgeted_income, budgeted_expense
  ) values (
    v_parent, v_org, p_report_year, 'published_by_congregation', v_prev,
    now(), p_minute_reference,
    p_gains_professions_under18, p_gains_professions_18plus, p_gains_certificate, p_gains_other,
    p_losses_certificate, p_losses_deaths, p_losses_other,
    p_ending_active, p_ending_baptized, p_ending_affiliate, p_ending_other_participants,
    p_gender_woman, p_gender_man, p_gender_nonbinary,
    p_age_17_under, p_age_18_25, p_age_26_40, p_age_41_55, p_age_56_70, p_age_71_over, p_age_unknown,
    p_race_asian, p_race_african, p_race_african_american, p_race_black, p_race_hispanic,
    p_race_middle_eastern, p_race_native_american, p_race_white, p_race_other,
    p_disability_hearing, p_disability_mobility, p_disability_sight, p_disability_other,
    p_officers_ruling_elder_count, p_officers_deacon_count,
    p_baptisms_children, p_baptisms_adults,
    p_youth_4_under, p_youth_k_5, p_youth_6_8, p_youth_9_12,
    p_avg_weekly_worship_attendance, p_potential_giving_units,
    p_receipts_contributions, p_receipts_capital_building_funds,
    p_receipts_investment_endowment_income, p_receipts_bequests, p_receipts_other_income,
    p_receipts_subsidy_or_aid,
    p_exp_local_program, p_exp_local_mission, p_exp_capital, p_exp_investment,
    p_exp_per_capita_apportionment, p_exp_validated_mission_pcusa,
    p_exp_ga_theological_education_fund, p_exp_other_mission,
    p_budgeted_income, p_budgeted_expense
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function presby_publish_sasr_snapshot(
  integer, text,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric
) from public;
grant execute on function presby_publish_sasr_snapshot(
  integer, text,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric
) to presby_app;

-- ---------------------------------------------------------------------------
-- 6. presby_list_own_congregation_publications() — the read counterpart.
-- ---------------------------------------------------------------------------
-- Phase 1 asks for "publication history," and a congregation cannot
-- otherwise read a row that now lives in its parent presbytery's tenant
-- space (congregation_statistics.organization_id is the presbytery for
-- every provenance, including published ones) — the standard
-- tenant_isolation policy filters it to zero rows from the congregation's
-- own context. Rather than reopen a bespoke cross-org RLS policy (schema-
-- design.md section 17 reserves that shape for exactly two named cases, and
-- DECISION-112 already declined a third), this is a second narrow SECURITY
-- DEFINER function — the same "controlled read, not a policy" shape
-- presby_match_person() already established. Filters internally to
-- about_org_id = presby_current_org() AND provenance =
-- 'published_by_congregation': a congregation can read ONLY its own
-- published rows, never a sibling congregation's.
create or replace function presby_list_own_congregation_publications(
  p_year integer default null
)
returns setof congregation_statistics
language sql stable security definer as $$
  select *
    from congregation_statistics
   where about_org_id = presby_current_org()
     and provenance = 'published_by_congregation'
     and (p_year is null or year = p_year)
   order by year desc, published_at desc nulls last;
$$;

revoke all on function presby_list_own_congregation_publications(integer) from public;
grant execute on function presby_list_own_congregation_publications(integer) to presby_app;

-- ---------------------------------------------------------------------------
-- 7. Permission-catalog rows (DECISION-119).
-- ---------------------------------------------------------------------------
-- `permissions` carries no organization_id (DECISION-063) and needs no org to
-- exist first, so it is seeded once, globally, here — parallel to every
-- other permission-catalog migration this session (0029/0033/0036/0037).
insert into permissions (key, module, description, sensitivity_tier) values
  -- Tier 1: the presbytery's own judgment about a congregation (viability,
  -- buildings/insurance) — not a constitutional register-keeping duty, so NO
  -- default binding below (DECISION-119: fails DECISION-078's test the way
  -- groups.manage/events.manage did). Fixture-only grant to
  -- presbytery_stated_clerk lives in scripts/seed-dev.sql.
  ('congregation_oversight.manage', 'presbytery',
   'Record viability assessments and buildings/insurance notes for a member congregation',
   1),
  -- Tier 2 (financial: the aggregate carries receipts/expenditures, and
  -- "financial" is tier 2 by the schema's own definition regardless of
  -- aggregation level) — passes DECISION-078's test directly, same
  -- SASR-compilation duty demographics.manage already binds to stated_clerk
  -- for, one level up the hierarchy. Bound to presbytery_stated_clerk below.
  ('statistics.manage', 'presbytery',
   'Enter, import, and correct a member congregation''s annual statistical record (unmanaged/imported rows)',
   2),
  ('per_capita.manage', 'presbytery',
   'Set per-capita rates and generate/track per-capita billing for member congregations',
   2),
  -- Module named for the mechanism's home (matches credentials.manage's own
  -- module convention), not the acting org — the acting person and the
  -- effect land on opposite sides of the hierarchy. Bound to the
  -- CONGREGATION's stated_clerk in scripts/seed-dev.sql (see file header),
  -- never presbytery_stated_clerk.
  ('statistics.publish', 'presbytery',
   'Publish this congregation''s annual statistical snapshot to its presbytery',
   2)
on conflict (key) do nothing;

insert into app_role_permissions (role_id, permission_key) values
  ('00000000-0000-0000-0000-000000000002', 'statistics.manage'),
  ('00000000-0000-0000-0000-000000000002', 'per_capita.manage')
on conflict (role_id, permission_key) do nothing;
