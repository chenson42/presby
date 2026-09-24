-- Statistical returns: the SASR ARTIFACT and the form versions that give its
-- payload a schema — increment 4 of the lifecycle/affiliation/returns
-- pipeline (docs/work-log/2026-09-24-lifecycle-affiliation-returns.md, Phase
-- 3 Data Model "Increment 4"; D12/D25/F31; DECISION-137/138;
-- docs/schema-design-2.md sec 2b and sec 5).
--
-- TWO TABLES, AND THE TRIGGER THAT MAKES THE JSONB LEGAL.
--
--   sasr_form_versions   platform-wide reference data. NO RLS, same class as
--                        `permissions` and `feature_flags`: a form revision
--                        is not any council's property. Seeded here.
--   statistical_returns  the as-reported artifact, IMMUTABLE and append-only,
--                        FORCE RLS, owned by the CONGREGATION for
--                        provenance = 'submitted' and by the PRESBYTERY for
--                        provenance = 'imported'.
--
-- WHY payload jsonb IS NOT A CUSTOM-FIELDS ESCAPE HATCH. D8 refuses custom
-- fields outright; sec 9.5 grants `statistical_returns.payload` the single
-- exception, and it is ONLY an exception if `sasr_form_versions.field_spec`
-- is trigger-enforced. `presby_enforce_sasr_field_spec()` below is that gate:
-- every payload key must exist in the named form version's spec, every value
-- must match its declared type, and every number must sit inside its declared
-- bounds. Without it, DECISION-118's allow-list property ("a field with no
-- slot cannot smuggle through") is lost the moment the first caller passes a
-- jsonb literal. It is a GATE, not documentation — Phase 2's Invariants
-- section says so in as many words.
--
-- WHY THE FORM VERSION IS A TABLE AND THE ARCHIVE IS ONE TABLE. F31: the SASR
-- form drifts between revisions, so a wide typed table cannot hold a
-- 1984-to-present archive without growing a column per generation. The typed
-- keyspace (`congregation_statistics`, drizzle/0038) stays exactly as it is —
-- it is the presbytery's working surface for the CURRENT generation — and
-- this table is the as-reported record in the field names the reporting
-- congregation actually used.
--
-- THE 2024 SPEC IS COMPLETE; 1984/2014/2022 ARE DELIBERATE PLACEHOLDERS.
-- '2024' carries one entry per SASR aggregate that `congregation_statistics`
-- types today (60 fields, the exact allow-list `presby_publish_sasr_
-- snapshot()`'s parameter list already is), because increment 5's rewritten
-- publish function maps that parameter list onto this spec. The three older
-- revisions are seeded with `{"fields": {}}` — key, label and year range
-- only. An EMPTY spec validates NOTHING, which is the correct fail-closed
-- default: no payload can be written against a generation whose per-tab
-- column order has not been mapped yet (F31/F32). Filling them in is owed to
-- increment 7's D13 import pipeline, and it is a data edit against this
-- table, not a schema change.
--
-- NO UNIQUE ON (about_org_id, report_year), deliberately (R3.8): a corrected
-- submission is a NEW row, and `publications.supersedes_id` (increment 5)
-- says which one is current. A merge year can legitimately carry two rows
-- about the same congregation from two predecessors.
--
-- IMMUTABILITY IS BELT AND BRACES, and the belt is not enough on its own.
-- `presby_app` gets `select, insert` and nothing else, and `presby_platform`
-- the same — but Ruling A5's own finding from batch B applies here in full:
-- PLATFORM_DATABASE_URL connects as `neondb_owner`, which is a MEMBER of
-- both roles and holds every privilege by ownership regardless, so no grant
-- binds it. `presby_freeze_statistical_return()` does, because BYPASSRLS
-- exempts a role from RLS POLICIES, never from TRIGGERS. Same split
-- drizzle/0044 settled for organization_lifecycle_events.
--
-- Migration-numbering note: `ls drizzle/` was run immediately before this
-- file was written and found 0045_presby_about_org_affiliation.sql as the
-- highest number on disk, with no gap and no second pipeline's file present;
-- docs/TODO.md's In Flight list was re-read for a concurrent schema pipeline
-- (none). This migration claims 0046.
--
-- Hand-written per CLAUDE.md: Drizzle Kit emits none of this (RLS, FORCE RLS,
-- three triggers, a GIST exclusion constraint, a seeded reference table), so
-- `npm run db:generate` was never run against it. Every statement is
-- idempotent and the whole file is safe to re-apply.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. sasr_form_versions — platform-wide reference data, no RLS
-- ---------------------------------------------------------------------------
create table if not exists sasr_form_versions (
  key                  text primary key,
  label                text not null,
  effective_first_year integer not null,
  -- null = still in effect.
  effective_last_year  integer,
  -- { "fields": { "<key>": { "type": "integer"|"numeric"|"text"|"boolean",
  --                          "min": <number>, "max": <number>,
  --                          "sasr_line": <text|null>,
  --                          "comparable_to": [<key>, ...] } } }
  -- `sasr_line` and `comparable_to` are the F34 cross-generation machinery
  -- and are deliberately EMPTY on every row today: the normalising view that
  -- consumes them is not built, and a half-invented mapping would be worse
  -- than an absent one. The shape is present so filling them in later is a
  -- data edit.
  field_spec           jsonb not null,
  constraint sasr_form_versions_year_order
    check (effective_last_year is null or effective_last_year >= effective_first_year),
  constraint sasr_form_versions_field_spec_shape
    check (jsonb_typeof(field_spec -> 'fields') = 'object')
);

-- sec 5: "ranges may not overlap". A form generation is a partition of the
-- timeline, so two versions claiming 2015 would make "which spec validates
-- this payload" ambiguous. btree_gist is already installed (drizzle/0009:471
-- for officer_terms_no_overlap) but is not needed here — int4range && int4range
-- is a native GiST operator.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sasr_form_versions_no_overlap'
  ) then
    alter table sasr_form_versions
      add constraint sasr_form_versions_no_overlap
      exclude using gist (
        int4range(effective_first_year, coalesce(effective_last_year, 9999), '[]') with &&
      );
  end if;
end $$;

revoke all on sasr_form_versions from presby_app, presby_platform;
grant select on sasr_form_versions to presby_app, presby_platform;

comment on table sasr_form_versions is
  'The SASR form generations and, per generation, the field_spec that makes statistical_returns.payload a CLOSED allow-list rather than a custom-fields escape hatch (D8/D12/DECISION-118). Platform-wide reference data: no RLS, no organization_id, written only by migration. field_spec.fields is enforced by presby_enforce_sasr_field_spec() on every statistical_returns INSERT.';
comment on column sasr_form_versions.field_spec is
  'Per field: type (integer|numeric|text|boolean), min/max bounds for numbers, sasr_line and comparable_to (F34, deliberately empty everywhere today). An EMPTY fields object validates nothing and therefore accepts no payload key at all — the correct fail-closed default for a generation whose per-tab column order has not been mapped yet (F31/F32).';

-- ---------------------------------------------------------------------------
-- 2. Seed the four form generations
-- ---------------------------------------------------------------------------
-- DO UPDATE, not DO NOTHING: this migration is the source of truth for the
-- 2024 spec, so re-applying the file must CONVERGE the row rather than leave
-- a stale spec in place. The year ranges are the four revisions sec 5 names.
insert into sasr_form_versions (key, label, effective_first_year, effective_last_year, field_spec) values
  ('1984', 'SASR 1984 revision (placeholder — field mapping pending)', 1984, 2013, '{"fields": {}}'::jsonb),
  ('2014', 'SASR 2014 revision (placeholder — field mapping pending)', 2014, 2021, '{"fields": {}}'::jsonb),
  ('2022', 'SASR 2022 revision (placeholder — field mapping pending)', 2022, 2023, '{"fields": {}}'::jsonb)
on conflict (key) do update set
  label = excluded.label,
  effective_first_year = excluded.effective_first_year,
  effective_last_year = excluded.effective_last_year,
  field_spec = excluded.field_spec;

-- '2024' — the ONLY complete spec, and complete by construction: one entry
-- per typed SASR column congregation_statistics carries today, which is the
-- same set as presby_publish_sasr_snapshot()'s allow-list parameter list.
-- Increment 5's rewritten publish function maps that list onto these keys, so
-- a field missing here would make the publish path fail at the trigger. The
-- bounds are drizzle/0038's own v_count_max (1,000,000) and v_money_max
-- (100,000,000) — the same numbers the function already range-validates
-- against, stated once more here so the SECOND, independent check agrees with
-- the first rather than quietly disagreeing.
insert into sasr_form_versions (key, label, effective_first_year, effective_last_year, field_spec) values
  ('2024', 'SASR 2024 revision', 2024, null, '{
    "fields": {
      "gains_professions_under18": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "gains_professions_18plus": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "gains_certificate": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "gains_other": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "losses_certificate": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "losses_deaths": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "losses_other": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "ending_active": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "ending_baptized": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "ending_affiliate": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "ending_other_participants": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "gender_woman": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "gender_man": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "gender_nonbinary": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_17_under": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_18_25": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_26_40": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_41_55": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_56_70": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_71_over": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "age_unknown": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_asian": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_african": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_african_american": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_black": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_hispanic": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_middle_eastern": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_native_american": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_white": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "race_other": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "disability_hearing": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "disability_mobility": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "disability_sight": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "disability_other": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "officers_ruling_elder_count": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "officers_deacon_count": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "baptisms_children": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "baptisms_adults": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "youth_4_under": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "youth_k_5": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "youth_6_8": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "youth_9_12": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "avg_weekly_worship_attendance": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "potential_giving_units": {"type": "integer", "min": 0, "max": 1000000, "sasr_line": null, "comparable_to": []},
      "receipts_contributions": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "receipts_capital_building_funds": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "receipts_investment_endowment_income": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "receipts_bequests": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "receipts_other_income": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "receipts_subsidy_or_aid": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_local_program": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_local_mission": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_capital": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_investment": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_per_capita_apportionment": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_validated_mission_pcusa": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_ga_theological_education_fund": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "exp_other_mission": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "budgeted_income": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []},
      "budgeted_expense": {"type": "numeric", "min": 0, "max": 100000000, "sasr_line": null, "comparable_to": []}
    }
  }'::jsonb)
on conflict (key) do update set
  label = excluded.label,
  effective_first_year = excluded.effective_first_year,
  effective_last_year = excluded.effective_last_year,
  field_spec = excluded.field_spec;

-- The 2024 spec must stay 1:1 with the typed columns, or increment 5's
-- publish path silently loses a field. Proven here rather than trusted: the
-- SASR aggregate columns of congregation_statistics (everything that is not
-- identity, provenance or publication bookkeeping) must be exactly the key
-- set of the 2024 field_spec.
do $$
declare
  v_missing text;
  v_extra   text;
begin
  select string_agg(c.column_name, ', ' order by c.column_name) into v_missing
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'congregation_statistics'
     and c.column_name not in ('id','organization_id','about_org_id','year','provenance',
                               'supersedes_publication_id','published_at','minute_reference',
                               'entered_by','created_at','publication_id')
     and not exists (
       select 1 from sasr_form_versions v,
                     jsonb_object_keys(v.field_spec -> 'fields') k
        where v.key = '2024' and k = c.column_name);

  select string_agg(k, ', ' order by k) into v_extra
    from sasr_form_versions v, jsonb_object_keys(v.field_spec -> 'fields') k
   where v.key = '2024'
     and not exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'congregation_statistics'
          and c.column_name = k);

  if v_missing is not null or v_extra is not null then
    raise exception
      'sasr_form_versions 2024 field_spec is out of step with congregation_statistics: missing [%], extra [%]',
      coalesce(v_missing, '-'), coalesce(v_extra, '-');
  end if;
  raise notice 'sasr_form_versions: the 2024 field_spec covers every typed SASR column congregation_statistics carries (% fields)',
    (select count(*) from sasr_form_versions v, jsonb_object_keys(v.field_spec -> 'fields') k where v.key = '2024');
end $$;

-- ---------------------------------------------------------------------------
-- 3. statistical_returns — the artifact
-- ---------------------------------------------------------------------------
create table if not exists statistical_returns (
  id uuid primary key default gen_random_uuid(),
  -- The OWNER: the congregation for provenance = 'submitted', the presbytery
  -- for 'imported'. PLAIN FK to organizations — `organizations` carries no
  -- organization_id of its own to be composite against; it is the one table
  -- F2's composite-key rule does not apply to (docs/schema-design.md sec 17),
  -- the same structural exception congregationOversight.aboutOrgId uses.
  -- Do not "fix" this into a composite FK.
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The congregation the return is ABOUT. PLAIN FK for the same reason, and
  -- it may legitimately reference a DISSOLVED organization — that is the
  -- concrete reason D10 exists (F30: roughly half of a 41-year archive names
  -- churches that closed, merged or moved presbyteries).
  about_org_id uuid not null references organizations(id),
  report_year integer not null,
  form_version_key text not null references sasr_form_versions(key),
  -- submitted | imported.
  provenance text not null,
  -- As-reported, in THAT generation's field names. Gated by
  -- presby_enforce_sasr_field_spec() below — see the header.
  payload jsonb not null,
  -- D11's reconciliation rule (official_beginning_balance + gains - losses =
  -- ending_active) applies at write time to 'submitted' only. An imported
  -- 1987 row is a historical assertion: if it does not balance, that is a
  -- fact about 1987, not an error to correct. This column records WHICH RULE
  -- WAS APPLIED, not whether the arithmetic happens to work.
  reconciled boolean not null,
  -- Attestation (submitted). Deliberately a NAME and a ROLE, not a user id:
  -- D16's grant path (increment 6) produces a return with no account behind
  -- it at all, and a nullable users FK would read as "we lost the id" rather
  -- than "there never was one".
  attested_by_name text,
  attested_role text,
  attested_at timestamptz,
  -- Provenance (imported, D13). staging_row_id is a plain uuid TODAY and
  -- gains its FK to import_rows(id) in increment 7, when that table exists —
  -- a forward-reference FK is not expressible and a placeholder table would
  -- be worse.
  source_ref text,
  staging_row_id uuid,
  created_at timestamptz not null default now(),
  constraint statistical_returns_id_org_key unique (id, organization_id),
  constraint statistical_returns_provenance_allowed
    check (provenance in ('submitted', 'imported')),
  constraint statistical_returns_report_year_range
    check (report_year between 1900 and 2100),
  -- STRENGTHENING BEYOND THE PHASE 3 DATA MODEL, named in the work-log as a
  -- deliberate deviation. sec 5 states the ownership rule in prose ("OWNER:
  -- the congregation for submitted ... about_org_id: the congregation"), so
  -- for a submitted return the owner and the subject are the same body by
  -- definition. Without this CHECK a congregation could submit — and then
  -- publish — a return ABOUT A DIFFERENT CONGREGATION, which is exactly the
  -- confused-deputy shape presby_publish_sasr_snapshot() is built to refuse
  -- one layer up. Imported rows are the cross-org case and are checked by
  -- affiliation instead (trigger below).
  constraint statistical_returns_submitted_is_self
    check (provenance <> 'submitted' or about_org_id = organization_id)
);

create index if not exists statistical_returns_org_about_year_idx
  on statistical_returns (organization_id, about_org_id, report_year);
create index if not exists statistical_returns_about_year_idx
  on statistical_returns (about_org_id, report_year);

alter table statistical_returns enable row level security;
alter table statistical_returns force row level security;

drop policy if exists tenant_isolation on statistical_returns;
create policy tenant_isolation on statistical_returns
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- APPEND-ONLY BY GRANT on both application roles. The recipient council reads
-- this table only through presby_list_published_returns_to_me() (increment 5,
-- SECURITY DEFINER): a return the congregation owns is invisible to the
-- presbytery under the policy above, which is the point — the publication
-- event, not the tenant policy, is what grants the read.
revoke all on statistical_returns from presby_app, presby_platform;
grant select, insert on statistical_returns to presby_app;
grant select, insert on statistical_returns to presby_platform;

comment on table statistical_returns is
  'The as-reported SASR artifact (D25), IMMUTABLE and append-only. One table, two provenances: submitted (owned by the congregation, D11 reconciliation applied at write time) and imported (owned by the presbytery, a historical assertion that is never reconciled). No unique on (about_org_id, report_year) — a correction is a new row and publications.supersedes_id says which is current (R3.8).';
comment on column statistical_returns.payload is
  'As-reported values in the named form generation''s own field names. NOT a custom-fields hatch: presby_enforce_sasr_field_spec() rejects any key absent from sasr_form_versions.field_spec, any value of the wrong JSON type, and any number outside its declared bounds (D8 / sec 9.5 / DECISION-118).';
comment on column statistical_returns.about_org_id is
  'The congregation this return is ABOUT. Plain (non-composite) FK by the section-17 structural exception, and it MAY reference a dissolved organization — that is the concrete reason D10 exists. For provenance = ''imported'' it is enforced against the affiliation history as of the report year (statistical_returns_about_org, this migration); for ''submitted'' it must equal organization_id (CHECK).';
comment on column statistical_returns.reconciled is
  'WHICH RULE WAS APPLIED, not whether the arithmetic balances. D11 applies at write time to submitted returns; an imported return is never reconciled.';
comment on column statistical_returns.staging_row_id is
  'D13 import provenance. A plain uuid until increment 7 creates import_rows; the FK is added there, not forward-declared here.';

-- ---------------------------------------------------------------------------
-- 4. The freeze — immutability that a grant cannot deliver
-- ---------------------------------------------------------------------------
-- Same shape and same reasoning as presby_freeze_lifecycle_event()
-- (drizzle/0044, Ruling A5) and presby_freeze_approved_roll_action()
-- (drizzle/0009:358-373). The grant above binds presby_app and
-- presby_platform; it does not bind neondb_owner, which PLATFORM_DATABASE_URL
-- actually connects as and which holds every privilege by ownership. This
-- trigger does, because BYPASSRLS exempts a role from RLS POLICIES, never
-- from TRIGGERS. Correct a return by recording another return, and let the
-- publication's supersedes_id say which is current.
create or replace function presby_freeze_statistical_return()
returns trigger language plpgsql as $$
begin
  raise exception
    'statistical_returns %: a filed return is immutable; file a correcting return and publish it (publications.supersedes_id chains them)',
    old.id
    using errcode = 'check_violation';
end $$;

drop trigger if exists statistical_returns_freeze on statistical_returns;
create trigger statistical_returns_freeze
  before update or delete on statistical_returns
  for each row execute function presby_freeze_statistical_return();

-- ---------------------------------------------------------------------------
-- 5. presby_enforce_sasr_field_spec() — THE GATE (D8 / sec 9.5)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, a deliberate departure from the DEFINER default
-- everywhere else in this pipeline, and stated rather than cargo-culted per
-- DECISION-121's warning: there is no cross-org read here. The trigger reads
-- NEW.payload and one sasr_form_versions row — a platform-wide reference
-- table with no RLS at all — so the invoking role's own privileges suffice.
-- Adding DEFINER would widen the function's reach for no reason.
--
-- The rules, in order:
--   1. the named form version must exist and carry a fields object;
--   2. payload must be a JSON object;
--   3. EVERY key in payload must appear in fields  <- the allow-list property
--   4. a JSON null is an UNREPORTED field and is always legal (matching
--      congregation_statistics's own nonneg CHECK, where NULL passes);
--   5. the value's JSON type must match the declared type;
--   6. an 'integer' field must hold a whole number;
--   7. a number must sit within [min, max], min defaulting to 0 — which is
--      what makes "non-negative counts" a property of the spec rather than a
--      separate rule that could drift away from it.
create or replace function presby_enforce_sasr_field_spec()
returns trigger language plpgsql security invoker as $$
declare
  v_fields jsonb;
  v_key    text;
  v_val    jsonb;
  v_spec   jsonb;
  v_type   text;
  v_min    numeric;
  v_max    numeric;
  v_num    numeric;
begin
  select field_spec -> 'fields' into v_fields
    from sasr_form_versions
   where key = new.form_version_key;

  if v_fields is null or jsonb_typeof(v_fields) <> 'object' then
    raise exception
      'statistical_returns: form version % has no field_spec.fields object; no payload can be validated against it',
      new.form_version_key
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(new.payload) <> 'object' then
    raise exception
      'statistical_returns: payload must be a JSON object, found %',
      jsonb_typeof(new.payload)
      using errcode = 'check_violation';
  end if;

  for v_key, v_val in select key, value from jsonb_each(new.payload) loop
    v_spec := v_fields -> v_key;

    if v_spec is null then
      raise exception
        'statistical_returns: payload key "%" is not declared by form version % — the field_spec is a CLOSED allow-list (D8 / DECISION-118): a field with no slot cannot smuggle through',
        v_key, new.form_version_key
        using errcode = 'check_violation';
    end if;

    -- An unreported field. congregation_statistics's own nonneg CHECK takes
    -- the same position: NULL passes, only a value is judged.
    continue when jsonb_typeof(v_val) = 'null';

    v_type := v_spec ->> 'type';

    if v_type in ('integer', 'numeric') then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception
          'statistical_returns: payload key "%" is declared % by form version % but carries a %',
          v_key, v_type, new.form_version_key, jsonb_typeof(v_val)
          using errcode = 'check_violation';
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_type = 'integer' and v_num <> trunc(v_num) then
        raise exception
          'statistical_returns: payload key "%" is declared integer by form version % but carries %',
          v_key, new.form_version_key, v_num
          using errcode = 'check_violation';
      end if;
      v_min := coalesce((v_spec ->> 'min')::numeric, 0);
      v_max := (v_spec ->> 'max')::numeric;
      if v_num < v_min then
        raise exception
          'statistical_returns: payload key "%" is % but form version % bounds it below at % (a count is never negative)',
          v_key, v_num, new.form_version_key, v_min
          using errcode = 'check_violation';
      end if;
      if v_max is not null and v_num > v_max then
        raise exception
          'statistical_returns: payload key "%" is % but form version % bounds it above at %',
          v_key, v_num, new.form_version_key, v_max
          using errcode = 'check_violation';
      end if;

    elsif v_type = 'text' then
      if jsonb_typeof(v_val) <> 'string' then
        raise exception
          'statistical_returns: payload key "%" is declared text by form version % but carries a %',
          v_key, new.form_version_key, jsonb_typeof(v_val)
          using errcode = 'check_violation';
      end if;

    elsif v_type = 'boolean' then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception
          'statistical_returns: payload key "%" is declared boolean by form version % but carries a %',
          v_key, new.form_version_key, jsonb_typeof(v_val)
          using errcode = 'check_violation';
      end if;

    else
      raise exception
        'statistical_returns: form version % declares key "%" with an unknown type % — the spec itself is malformed',
        new.form_version_key, v_key, coalesce(v_type, '<missing>')
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists statistical_returns_field_spec on statistical_returns;
create trigger statistical_returns_field_spec
  before insert on statistical_returns
  for each row execute function presby_enforce_sasr_field_spec();

-- ---------------------------------------------------------------------------
-- 6. The about-org rule for IMPORTED returns (R3.14)
-- ---------------------------------------------------------------------------
-- drizzle/0045's presby_check_about_org_affiliated() cannot be reused here:
-- it checks EVERY row, and a submitted return has about_org_id =
-- organization_id, which presby_org_affiliated() correctly answers false for
-- (an organization is not its own ancestor). Submitted rows are covered by
-- the statistical_returns_submitted_is_self CHECK instead; imported rows —
-- the genuine cross-org case, a presbytery archiving a return about one of
-- its congregations — get the affiliation test.
--
-- SAME YEAR-ENDPOINT SEMANTICS as drizzle/0045, deliberately: the row is
-- accepted if the about-org was affiliated with the recording council at
-- EITHER endpoint of the report year (Jan 1 or Dec 31). A single instant
-- refuses two foreseeable legitimate rows — a congregation dissolved in June
-- whose final-year return is imported afterwards, and one received in June
-- whose first-year return covers that same year. The same accepted gap
-- applies: an affiliation that both opens AND closes inside one calendar
-- year is not detected by an endpoint test.
--
-- SECURITY DEFINER for the same belt-and-braces reason 0045 states: the read
-- crosses into another council's FORCE-RLS affiliation rows (F26), and
-- presby_org_affiliated() is itself DEFINER so the read would succeed either
-- way.
create or replace function presby_check_return_about_org()
returns trigger language plpgsql security definer as $$
begin
  if new.provenance <> 'imported' then
    return new;
  end if;
  if presby_org_affiliated(new.about_org_id, new.organization_id, make_date(new.report_year, 1, 1))
     or presby_org_affiliated(new.about_org_id, new.organization_id, make_date(new.report_year, 12, 31))
  then
    return new;
  end if;
  perform presby_deny_about_org_write('statistical_returns', new.report_year::text);
  return new;
end $$;

revoke all on function presby_check_return_about_org() from public;
grant execute on function presby_check_return_about_org() to presby_app, presby_platform;

drop trigger if exists statistical_returns_about_org on statistical_returns;
create trigger statistical_returns_about_org
  before insert on statistical_returns
  for each row execute function presby_check_return_about_org();
