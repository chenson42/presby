-- Organization name history (D14/F37) and the D13 import quarantine
-- (`import_batches` / `import_rows`) — increment 7 of the lifecycle /
-- affiliation / returns line of work.
--
--   docs/work-log/2026-09-26-name-history-import-staging.md, Phase 3
--   "Data Model" (this file's section order 1-10 IS that section's outline)
--   DECISION-153; findings F100-F104
--   docs/schema-design-2.md D13, D14, F33, F37, R3.16, sec 3, sec 5
--
-- WHAT THIS MIGRATION DOES
--
--   1. `presby_normalize_org_match_text()` — ONE immutable normalization
--      expression, shared by the two generated columns and by the matcher, so
--      F101 ("the index says one thing and the comparison says another")
--      cannot recur.
--   2. `organization_name_history` — dated, TYPED, city-qualified names in the
--      D26 about-org shape (`organization_id` = the acting council,
--      `subject_org_id` = the body named). FORCE RLS, and DML REVOKED from
--      `presby_app`.
--   3. `organization_name_history_public` — the bounded projection the matcher
--      reads, mirroring `organization_affiliations_public` (drizzle/0044:525).
--   4. The backfill: one OPEN `canonical` row per existing organization,
--      `authority = 'backfill'`, `city = null`.
--   5. `import_batches` / `import_rows` — D13's durable quarantine.
--      Presbytery-owned, FORCE RLS, ORDINARY tenant DML minus DELETE.
--   6. `statistical_returns` additive changes only: the composite FK on
--      `staging_row_id` that drizzle/0046 deliberately left for this
--      increment, one additive provenance CHECK, and the about-org unique
--      `(id, about_org_id, report_year)` that `import_rows`' own FK needs
--      (F104, as revised by the Phase 2 addendum).
--   7. `presby_match_organization()` — a bounded, minimal-disclosure candidate
--      search. STABLE, SECURITY INVOKER, over the view.
--   8. A backfill-completeness assertion that must hold before commit.
--
-- WHY THE TWO TABLE FAMILIES GET OPPOSITE DML TREATMENT (F103 / DECISION-153)
--
-- One test, not two policies: *a unique or EXCLUDE constraint on a FORCE-RLS
-- table is an enumeration oracle exactly when its key is learnable from public
-- data.*
--
--   `organization_name_history` keys its EXCLUDE on `subject_org_id`, and
--   organization ids are PUBLIC (`organizations` has no RLS and `presby_app`
--   holds SELECT on it — DECISION-040). With ordinary tenant DML any
--   presbytery could probe `insert (subject_org_id => <any org id>, name_type
--   => 'canonical', 1985..1995)` and learn from the constraint-violation error
--   whether SOME council it cannot see has recorded a canonical name for that
--   body in that window. That is F40 / DECISION-047's enumeration-oracle class
--   arriving through a constraint, identically to `organization_affiliations`.
--   So: SELECT only for `presby_app`; writes are function-mediated.
--
--   `import_rows` keys `unique (batch_id, row_index)` on a random uuid a
--   non-owner cannot guess, and `resolved_org_id` deliberately carries NO
--   unique and NO exclusion constraint (adding one would manufacture the very
--   oracle the other table refuses). So: ordinary tenant DML, minus DELETE.
--
-- Neither ruling generalizes to "all new tenant tables." The test does.
--
-- NOTHING IN THIS FILE IS `SECURITY DEFINER`, and that is a ruling rather than
-- an omission (Phase 2 Ruling 2). The matcher is an INVOKER function over a
-- view whose projection physically excludes the columns a DEFINER function
-- would have had to be trusted not to return; the normalization helper touches
-- no table; and the two freeze triggers only ever compare OLD/NEW of their own
-- row, so the F26 cross-tenant-read shape never arises. DECISION-148's
-- `search_path = public, pg_temp` pin is therefore INAPPLICABLE BY ABSENCE —
-- stated explicitly so a reviewer does not go hunting for a definer function
-- this migration does not have. (Both new functions carry the pin anyway:
-- harmless, and consistent.)
--
-- Hand-written per CLAUDE.md: Drizzle Kit emits no RLS, no trigger, no
-- generated column backed by a user-defined function, no EXCLUDE constraint,
-- no view, no revoke. Every statement is idempotent and the whole file has
-- been applied twice in succession with no unexpected row-count change.
--
-- APPLY AS THE OWNER, ON THE DIRECT ENDPOINT, IN ONE TRANSACTION:
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
--     -f drizzle/0053_presby_name_history_import_staging.sql
--
-- `-1` rather than a literal `begin;`/`commit;` in the file: every other
-- hand-written presby migration omits them, because `drizzle-kit migrate`
-- sends a breakpoint-free file as ONE statement inside its own transaction and
-- an embedded `commit;` would close that transaction out from under the
-- runner. The one-transaction property Phase 3 requires (the backfill
-- assertion in section 10 must be able to abort the whole thing) is supplied
-- by the flag on the psql path and by the runner on the db:migrate path.

create extension if not exists btree_gist;  -- idempotent; already installed
                                            -- (drizzle/0009:471, 0039:120,
                                            -- 0044:100)

-- ---------------------------------------------------------------------------
-- 1. presby_normalize_org_match_text() — the ONE normalization expression
-- ---------------------------------------------------------------------------
-- F101: F37 specified the index as `(lower(name), lower(city))`. That cannot
-- serve a matcher which also collapses internal whitespace and strips trailing
-- punctuation — the index expression and the comparison would differ, so the
-- planner would sequential-scan AND, worse, compare something other than what
-- it indexed. The fix is not a cleverer index; it is to have exactly one
-- expression, named, and to use it in both places.
--
-- IMMUTABLE is load-bearing twice over: a generated column and an index
-- expression both require it. Every function inside is immutable — which is
-- precisely why `unaccent()` is NOT here (it is not immutable, and installing
-- it would be a dependency change requiring a fresh Phase 2; `pg_trgm`,
-- `unaccent` and `fuzzystrmatch` are all absent from this branch and stay
-- absent).
--
-- NOT SECURITY DEFINER — it touches no table. It carries the search_path pin
-- anyway (harmless, and consistent with DECISION-148's habit).
create or replace function presby_normalize_org_match_text(p_text text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select lower(
    regexp_replace(
      regexp_replace(btrim(p_text), '\s+', ' ', 'g'),
      '[.,;:]+$', ''
    )
  );
$$;

revoke all on function presby_normalize_org_match_text(text) from public;
-- Required, not decorative: `presby_match_organization()` is an INVOKER
-- function and calls this under the CALLER's privileges, and a generated
-- column evaluates it under whichever role performs the write.
grant execute on function presby_normalize_org_match_text(text)
  to presby_app, presby_platform;

comment on function presby_normalize_org_match_text(text) is
  'The single normalization expression for organization-name matching (F101). Used by organization_name_history''s two generated columns AND by presby_match_organization()''s inputs — one expression in one place, so the index and the comparison cannot silently diverge. IMMUTABLE by necessity (generated columns and index expressions both require it), which is why unaccent() is excluded.';

-- ---------------------------------------------------------------------------
-- 2. organization_name_history (D14 / F37 / F33)
-- ---------------------------------------------------------------------------
create table if not exists organization_name_history (
  id uuid primary key default gen_random_uuid(),
  -- The ACTING council. Tenant scope for tenant_isolation below. SELF (=
  -- subject) on every backfill row; a future presbytery act for everything
  -- else. There is deliberately NO `not_self` CHECK here — see section 4.
  organization_id uuid not null references organizations(id),
  -- The body the name describes. PLAIN FK, the about-org structural exception
  -- (docs/schema-design.md sec 17) — organization ids are public. Same shape
  -- organization_identifiers.organization_id and
  -- organization_lifecycle_events.subject_org_id already take.
  subject_org_id uuid not null references organizations(id),
  -- canonical | former_name | historical_name | abbreviation |
  -- legacy_import_name. See the column comment below for what each one MEANS
  -- and for the `legacy_import` cross-reference.
  name_type text not null,
  name text not null,
  city text,
  state text,
  -- GENERATED, never hand-set. F101: this MUST be the same expression the
  -- matcher applies to its inputs.
  name_normalized text generated always as
    (presby_normalize_org_match_text(name)) stored,
  city_normalized text generated always as
    (presby_normalize_org_match_text(city)) stored,
  -- NULL = unbounded ("predates our records"), the F41 convention
  -- organization_affiliations already uses.
  effective_from date,
  effective_to date,
  -- recorded | backfill. A minute-less row can only ever be an inferred one,
  -- so an inferred name can never be mistaken for a minuted act
  -- (organization_affiliations' own comment, drizzle/0044:371).
  authority text not null default 'recorded',
  minute_reference text,
  notes text,
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  constraint organization_name_history_id_org_key unique (id, organization_id),
  constraint organization_name_history_name_type_allowed
    check (name_type in ('canonical', 'former_name', 'historical_name',
                         'abbreviation', 'legacy_import_name')),
  constraint organization_name_history_authority_allowed
    check (authority in ('recorded', 'backfill')),
  -- Ruling 8: a CLAIM OF OFFICIALITY requires a minute unless the row is
  -- honestly marked as an inference. The three matching aids require nothing —
  -- demanding a minute for them would either block the import this pipeline
  -- exists to enable, or produce invented minute strings (0044's "minting
  -- minute-less rows" failure, inverted). This is what gives the type
  -- vocabulary teeth: if you cannot cite a minute, the type you want is
  -- `historical_name` or `legacy_import_name`, not `former_name`.
  constraint organization_name_history_minute_shape
    check (name_type not in ('canonical', 'former_name')
           or authority = 'backfill'
           or minute_reference is not null),
  -- The empty-range loophole, closed the same way F49 closed it one table
  -- over: daterange(d, d, '[)') is a VALID, EMPTY range that overlaps nothing,
  -- so the EXCLUDE below would accept any number of them.
  constraint organization_name_history_range_order
    check (effective_to is null
           or effective_from is null
           or effective_to > effective_from),
  -- Length sanity, following statistics_submission_grants_name_shape
  -- (drizzle/0049:141-142). An upper bound matters more here than on
  -- organizations.name (which has none) precisely because this table exists to
  -- absorb messy spreadsheet input.
  constraint organization_name_history_name_shape
    check (char_length(btrim(name)) between 1 and 255),
  constraint organization_name_history_city_shape
    check (city is null or char_length(btrim(city)) between 1 and 120),
  -- NOT a validated code set. Historical and non-US forms exist; do not "fix"
  -- this to char(2).
  constraint organization_name_history_state_shape
    check (state is null or char_length(btrim(state)) <= 64),
  -- Ruling 3: a rename CLOSES the canonical row and OPENS a new one; the old
  -- name is never additionally duplicated as a `former_name`, so "what was
  -- this body called in 1987?" has exactly one answer. PARTIAL — only
  -- 'canonical' rows are mutually exclusive in time; the other four types are
  -- assertions ABOUT the body and may overlap each other and the canonical
  -- succession freely.
  constraint organization_name_history_canonical_no_overlap
    exclude using gist (
      subject_org_id with =,
      daterange(effective_from, effective_to, '[)') with &&
    ) where (name_type = 'canonical')
);

-- The matcher's index. On the GENERATED columns, not on `lower(name)` — F101.
create index if not exists organization_name_history_normalized_idx
  on organization_name_history (name_normalized, city_normalized);
-- "The name in force for this body, in this year."
create index if not exists organization_name_history_subject_type_idx
  on organization_name_history (subject_org_id, name_type, effective_from);
-- The tenant policy's own predicate.
create index if not exists organization_name_history_org_idx
  on organization_name_history (organization_id);

alter table organization_name_history enable row level security;
alter table organization_name_history force row level security;

drop policy if exists tenant_isolation on organization_name_history;
create policy tenant_isolation on organization_name_history
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Ruling 1 / F103 / F40 — see this file's header for the whole argument. DML
-- is function-mediated, not policy-mediated.
--
-- THIS INCREMENT'S ONLY WRITER IS THE BACKFILL IN SECTION 4, running as the
-- owner, whom no grant binds (F44). There is deliberately no owner-path guard
-- trigger here yet, because there is no live writer for such a trigger to
-- distinguish a sanctioned write from an unsanctioned one — the future
-- `presby_record_org_name()` (deferred to the lifecycle-UI pipeline alongside
-- `presby_organize_congregation()`) is what earns one, the same day it earns
-- the transaction-local GUC pattern `organization_affiliations_guard` already
-- established. Stated rather than left silent so the absence reads as a dated
-- decision and not as an oversight.
revoke insert, update, delete on organization_name_history from presby_app;
grant select on organization_name_history to presby_app;
-- The 0044 narrowing (Ruling A5): select + insert, no update/delete. Mirrors
-- organization_affiliations exactly and for the same reason — a future
-- platform-provisioning path may need to seed a canonical row the way
-- createOrganization() seeds an affiliation row.
revoke update, delete on organization_name_history from presby_platform;
grant select, insert on organization_name_history to presby_platform;

comment on table organization_name_history is
  'Dated, typed, city-qualified names for an organization (D14/F37). A name AT A PLACE is the matching unit (F33). presby_app holds SELECT only: organization_name_history_canonical_no_overlap keys on the PUBLIC subject_org_id, so an EXCLUDE constraint on this table is a cross-tenant existence oracle under ordinary tenant DML (F40/F103) exactly as it is on organization_affiliations. The future presby_record_org_name() SECURITY DEFINER function is the sole tenant-side writer; this increment''s only writer is the migration backfill.';

comment on column organization_name_history.name_type is
  'canonical = the name officially borne for this interval, exactly one per instant (enforced by the partial EXCLUDE). former_name = asserted to have been official, canonical interval unreconstructable. historical_name = known by, never official. abbreviation = a short form. legacy_import_name = a dirty matching string lifted from a source document, CARRYING NO CLAIM that it was ever used. NOT THE SAME THING as organization_identifiers.kind = ''legacy_import'' (D24, drizzle/0043), despite the near-identical name: that one is an external ID MAPPING (e.g. a psvonline congregation id), this one is a NAME STRING. Do not merge the two mechanisms.';

comment on column organization_name_history.organization_id is
  'The ACTING council, and the tenant scope. Deliberately MAY equal subject_org_id — unlike organization_lifecycle_events, where organization_id <> subject_org_id is polity. Here self-reference is the canonical-self case (every backfill row, and any future congregation self-attestation); <> is the about-org case (a presbytery recording a former/historical/legacy name). Hence no not_self CHECK.';

comment on column organization_name_history.city is
  'Null on every backfilled row, permanently and on purpose (Phase 1 Gap 1). organization_profiles.address is a single free-text line with no structured city, and city is exactly the disambiguator F33 relies on — a wrongly parsed city is worse than a missing one, because it silently DOWNRANKS the right candidate. There is deliberately no "canonical requires city" CHECK.';

comment on column organization_name_history.state is
  'NOT a validated code set, and not two characters. Historical and non-US forms exist in a 41-year archive. Do not "fix" this to char(2).';

comment on column organization_name_history.name_normalized is
  'GENERATED from presby_normalize_org_match_text(name) — the same expression presby_match_organization() applies to its input (F101). Never hand-set; never compared against anything computed a different way.';

-- The other half of Phase 1 Gap 5's conflation risk, recorded on the older
-- table too so a reader meets the warning from whichever side they arrive.
-- A COMMENT is additive and idempotent; drizzle/0043 itself is shipped and is
-- not edited.
comment on column organization_identifiers.kind is
  'pcusa_pin | psvonline_congregation_id | church360 | legacy_import (D24, drizzle/0043). NOT THE SAME THING as organization_name_history.name_type = ''legacy_import_name'' (D14, drizzle/0053): this column maps an external IDENTIFIER, that one records a NAME STRING seen in a source document. Do not merge the two mechanisms.';

-- ---------------------------------------------------------------------------
-- 3. organization_name_history_public — the bounded projection
-- ---------------------------------------------------------------------------
-- Ruling 2 (an OVERRIDE of the kickoff's "SECURITY DEFINER matcher"). A
-- DEFINER function is a privilege grant whose minimal disclosure rests on a
-- reviewed column list; a view makes the same guarantee STRUCTURAL — the
-- matcher physically cannot leak the recording council, its minute or its
-- notes, because its substrate does not contain them.
--
-- DELIBERATELY NOT `security_invoker`. A plain view runs with its OWNER's
-- privileges, so this one sees past the base table's tenant policy — which is
-- the point, and is the same call organization_affiliations_public already
-- makes (drizzle/0044:520-528): a legacy name must be searchable across the
-- WHOLE org tree, because a congregation may have changed presbyteries since
-- the year in question (D19).
--
-- `organization_id` (the recording council), `minute_reference`, `notes`,
-- `authority` and `recorded_by` are ABSENT and MUST STAY ABSENT. Widening this
-- column list is a policy change, not a convenience.
--
-- OPERATIONAL NOTE: the cross-tenant visibility depends on this view's owner
-- holding BYPASSRLS. If ownership ever moves to a non-bypassing role the view
-- returns zero rows SILENTLY — F26's failure mode. A DEFINER function would
-- fail identically, so this is not an argument against the view; it is an
-- argument for noticing.
create or replace view organization_name_history_public as
  select subject_org_id, name_type, name, city, state,
         name_normalized, city_normalized, effective_from, effective_to
    from organization_name_history;

grant select on organization_name_history_public to presby_app, presby_platform;

comment on view organization_name_history_public is
  'Ruling 2: a PLAIN (non-security_invoker) view, running with its owner''s privileges — the same call organization_affiliations_public already makes — so it sees past the base table''s tenant policy. organization_id (the recording council), minute_reference, notes and authority are ABSENT and must stay absent; widening this column list is a policy change, not a convenience. Operational note: this view''s cross-tenant visibility depends on its owner holding BYPASSRLS. If ownership ever moves to a non-bypassing role, the view returns zero rows silently (F26''s failure mode) — not a reason not to use a view, a reason to notice if it ever breaks.';

-- ---------------------------------------------------------------------------
-- 4. BACKFILL — one OPEN canonical row per existing organization
-- ---------------------------------------------------------------------------
-- `organization_id = subject_org_id` (SELF), Ruling 7. A body's own current
-- name is its own record; nobody minuted it, and self-attribution is the
-- truthful reading. 0044's affiliation backfill used `o.parent_id`, which is
-- unavailable here: a parentless organization (a synod, the GA) still needs a
-- canonical name, and section 10's assertion counts EVERY organization.
--
-- `city = null` always (Phase 1 Gap 1 — see the column comment above).
-- `authority = 'backfill'` with a null minute_reference says, in the schema
-- itself, that nobody claims a minute for it — and is what
-- organization_name_history_minute_shape accepts it under.
--
-- `where not exists` so re-application converges (0044's discipline). The
-- predicate is OPEN-canonical, not any-canonical: a closed predecessor row
-- added later by seed-dev.sql must not suppress the open one.
insert into organization_name_history
  (organization_id, subject_org_id, name_type, name, city, state,
   effective_from, effective_to, authority, minute_reference, recorded_at)
select o.id, o.id, 'canonical', o.name, null, null,
       null, null, 'backfill', null, now()
  from organizations o
 where not exists (
   select 1
     from organization_name_history h
    where h.subject_org_id = o.id
      and h.name_type = 'canonical'
      and h.effective_to is null
 );

-- ---------------------------------------------------------------------------
-- 5. import_batches (D13, R3.16)
-- ---------------------------------------------------------------------------
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  -- The presbytery running the import. Tenant scope.
  organization_id uuid not null references organizations(id),
  -- Free text: where the rows came from ('legacy binder scan', ...).
  source text not null,
  -- The worksheet/tab this batch decoded. F32: positional arrays only decode
  -- PER TAB — there is no single universal column order across a 41-year
  -- archive, which is why a batch is scoped to one worksheet and carries its
  -- own column map.
  worksheet text not null,
  -- REQUIRED, not nullable: column_map's TARGET keys are this generation's
  -- field_spec (sasr_form_versions.field_spec), so without a form version
  -- there is nothing for the map to map INTO. A genuinely pre-1984 batch needs
  -- its own seeded sasr_form_versions row, not a null here.
  form_version_key text not null references sasr_form_versions(key),
  -- {"source column header": "target field key", ...}
  column_map jsonb not null,
  -- A fact about the SOURCE FILE, and immutable. Deliberately NOT
  -- resolved_count / unresolved_count: those are derivable from import_rows
  -- and would drift, which is memberships.current_roll's F29 lesson arriving
  -- in a new table. Counts are computed, never cached.
  row_count integer not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint import_batches_id_org_key unique (id, organization_id),
  constraint import_batches_source_shape
    check (char_length(btrim(source)) between 1 and 120),
  constraint import_batches_worksheet_shape
    check (char_length(btrim(worksheet)) between 1 and 120),
  constraint import_batches_column_map_shape
    check (jsonb_typeof(column_map) = 'object'),
  constraint import_batches_row_count_nonneg check (row_count >= 0)
);

create index if not exists import_batches_org_idx
  on import_batches (organization_id, created_at);

alter table import_batches enable row level security;
alter table import_batches force row level security;

drop policy if exists tenant_isolation on import_batches;
create policy tenant_isolation on import_batches
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Ruling 5 / F103: ORDINARY tenant DML, minus DELETE. F40 does NOT fire here —
-- nothing on this table is keyed on a publicly learnable identifier; a batch id
-- is a random uuid a non-owner cannot guess. A quarantine worktable is also not
-- a minuted council record, so the function-mediation rule (scoped to the
-- three-axis governance tables) does not reach it, and putting the whole review
-- loop behind DEFINER functions would buy no authority while costing the
-- executor pipeline a function per verb.
revoke delete on import_batches from presby_app, presby_platform;
grant select, insert, update on import_batches to presby_app;
-- No present-day reason for the platform-shell connection to WRITE a
-- presbytery's import batch. SELECT only, for /developer-style debugging.
revoke insert, update on import_batches from presby_platform;
grant select on import_batches to presby_platform;

comment on table import_batches is
  'One row per uploaded spreadsheet worksheet, presbytery-owned (D13). Provenance columns are immutable after insert (import_batches_freeze); DELETE is refused on every connection including the owner''s, because D13''s durable quarantine is meaningless if the batch that contextualizes it can be dropped. No cached resolved/unresolved counts — they are derivable and would drift (F29).';

comment on column import_batches.row_count is
  'A fact about the SOURCE FILE — how many rows the worksheet had — not a progress counter. Immutable. resolved_count / unresolved_count deliberately do not exist: count import_rows.';

-- (5a) THE FREEZE — one trigger, firing on EVERY connection.
-- F44: the revoke above binds presby_app and presby_platform. It does NOT bind
-- neondb_owner, which owns this table and holds every privilege by ownership
-- and is the role PLATFORM_DATABASE_URL actually connects as. BYPASSRLS exempts
-- a role from RLS POLICIES, never from TRIGGERS — so the trigger is the only
-- layer that says anything at all on the connection that matters.
--
-- Single-literal rejection (DECISION-139 / DECISION-040's byte-identical
-- discipline): every refusal raises the same string through one helper, so no
-- cause is distinguishable from another.
create or replace function presby_deny_import_batch_change()
returns void language plpgsql as $$
begin
  raise exception 'import_batches: this change is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

-- B-M1 (security review 2026-09-25 sec B) — THIS HELPER KEEPS ITS GRANT, for
-- exactly the reason drizzle/0046_presby_statistical_returns.sql:469-476
-- states for presby_deny_publication_write(). presby_freeze_import_batch() is
-- SECURITY INVOKER, and import_batches is reachable by presby_app — Ruling 5
-- kept ordinary tenant DML (minus DELETE) on this table, which is the whole
-- point of the staging design. Revoking EXECUTE without re-granting it would
-- turn the guard's uniform literal into `permission denied for function
-- presby_deny_import_batch_change` on the tenant path: still SQLSTATE
-- 42501, still refused, but the message names an internal catalog
-- identifier instead of the designed single literal, and the refusal is
-- then enforced by a FUNCTION ACL rather than by the guard's own logic —
-- a gutted, no-op body would still appear to "pass". Found as Phase 5 FAIL-1
-- (docs/work-log/2026-09-26-name-history-import-staging.md); the tenant-path
-- assertions in scripts/test-rls.sql section 42(i)/(i2) now match on the
-- literal so the grant cannot silently go missing again.
revoke all on function presby_deny_import_batch_change() from public;
grant execute on function presby_deny_import_batch_change() to presby_app, presby_platform;

create or replace function presby_freeze_import_batch()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    perform presby_deny_import_batch_change();
    return old;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.source is distinct from old.source
     or new.worksheet is distinct from old.worksheet
     or new.form_version_key is distinct from old.form_version_key
     or new.column_map is distinct from old.column_map
     or new.row_count is distinct from old.row_count
     or new.created_by is distinct from old.created_by
  then
    perform presby_deny_import_batch_change();
  end if;

  return new;
end $$;

revoke all on function presby_freeze_import_batch() from public;

drop trigger if exists import_batches_freeze on import_batches;
create trigger import_batches_freeze
  before update or delete on import_batches
  for each row execute function presby_freeze_import_batch();

-- ---------------------------------------------------------------------------
-- 6. import_rows (D13's quarantine proper)
-- ---------------------------------------------------------------------------
create table if not exists import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  organization_id uuid not null references organizations(id),
  row_index integer not null,
  -- Stored AS-IS, with no shape validation. That is the point of a quarantine:
  -- a malformed worksheet gets a human-readable failure in the executor
  -- pipeline's own ingest step, never a dropped row here (D13:
  -- quarantine-never-drop).
  raw_payload jsonb not null,
  original_name text,
  original_city text,
  report_year integer not null,
  -- Snapshot of what the matcher returned AT RESOLUTION TIME. Frozen
  -- deliberately (Ruling 5c): a later, better matcher must not rewrite the
  -- audit trail of what the clerk actually saw.
  candidates jsonb not null default '[]'::jsonb,
  -- unresolved | matched_existing | matched_alias | created_dissolved |
  -- duplicate | rejected. text + CHECK rather than a pgEnum: every domain
  -- value added since drizzle/0044 is text+CHECK, this list WILL grow when
  -- presby_organize_congregation() lands, and a CHECK swap in a migration
  -- beats ALTER TYPE ordering.
  resolution_kind text not null default 'unresolved',
  -- PLAIN FK — organizations is public, sec 17's structural exception. NO
  -- unique and NO exclusion constraint on this column, ever (Ruling 5a): one
  -- here would manufacture the very enumeration oracle that
  -- organization_name_history refuses one table over.
  resolved_org_id uuid references organizations(id),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  rationale text,
  -- resulting_return_id is added in section 6a, after this table exists,
  -- because its FK shape was the one item still under review when the table
  -- was written. See there for F104's reasoning.
  created_at timestamptz not null default now(),
  constraint import_rows_id_org_key unique (id, organization_id),
  -- Keyed on a RANDOM UUID a non-owner cannot guess. This is exactly why F40
  -- does not fire on this table and ordinary tenant DML is safe here.
  constraint import_rows_batch_row_key unique (batch_id, row_index),
  constraint import_rows_batch_fk
    foreign key (batch_id, organization_id)
    references import_batches (id, organization_id),
  constraint import_rows_resolution_kind_allowed
    check (resolution_kind in ('unresolved', 'matched_existing', 'matched_alias',
                               'created_dissolved', 'duplicate', 'rejected')),
  constraint import_rows_row_index_nonneg check (row_index >= 0),
  constraint import_rows_report_year_range
    check (report_year between 1900 and 2100),
  constraint import_rows_raw_payload_shape
    check (jsonb_typeof(raw_payload) = 'object'),
  constraint import_rows_candidates_shape
    check (jsonb_typeof(candidates) = 'array')
);

create index if not exists import_rows_batch_idx on import_rows (batch_id);
create index if not exists import_rows_org_status_idx
  on import_rows (organization_id, resolution_kind);

alter table import_rows enable row level security;
alter table import_rows force row level security;

drop policy if exists tenant_isolation on import_rows;
create policy tenant_isolation on import_rows
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

revoke delete on import_rows from presby_app, presby_platform;
grant select, insert, update on import_rows to presby_app;
revoke insert, update on import_rows from presby_platform;
grant select on import_rows to presby_platform;

comment on table import_rows is
  'D13 quarantine: one row per source spreadsheet row, presbytery-owned. raw_payload and candidates are immutable after insert (import_rows_freeze); resolution is SET-ONCE per row (old.resolution_kind must be unresolved to resolve; resulting_return_id may then be stamped exactly once more, in a separate statement). DELETE is refused on every connection. created_dissolved is nameable but UNREACHABLE this increment — presby_organize_congregation() is deferred to the lifecycle-UI pipeline.';

comment on column import_rows.candidates is
  'What presby_match_organization() returned AT RESOLUTION TIME, frozen. Deliberately immutable: this is the record of what the clerk saw when they chose, and a later, better matcher must not retroactively improve the audit trail.';

comment on column import_rows.resolution_kind is
  'unresolved (the not-null default, so quarantine is a NAMED state and never a null) | matched_existing | matched_alias | created_dissolved | duplicate | rejected. created_dissolved is nameable but unreachable until presby_organize_congregation() ships (lifecycle-UI pipeline) — do not go hunting for its writer. Set-once: import_rows_freeze permits the unresolved -> resolved transition and nothing after it. That has NO correction path, and that is chosen, not overlooked (loosening later is cheap; tightening after the executor ships is not); the revision mechanism is an explicit open item owned by the executor pipeline.';

-- (6a) THE RESOLUTION SHAPE and resulting_return_id.
-- Added as guarded ALTERs rather than inline above so that a database which
-- already ran an earlier form of this migration converges — the same pattern
-- drizzle/0044 uses for organization_affiliations_range_order.
--
-- F104, AS REVISED BY THE PHASE 2 ADDENDUM (architect, 2026-09-26). The
-- diagnosis stands; the prescription changed, and this comment records the
-- reasoning because it is exactly the kind a later reviewer re-derives or
-- breaks.
--
-- NEITHER CANDIDATE PAIR INVOLVING organization_id WORKS, and they fail for
-- OPPOSITE dispositions:
--
--   (resulting_return_id, organization_id) -> (id, organization_id)
--     refuses `duplicate`. The target there is a congregation-owned
--     `submitted` return — reachable and legitimately known, because
--     presby_list_published_returns_to_me() (drizzle/0047:1569-1605) hands the
--     presbytery that return's id. Its organization_id is the CONGREGATION.
--
--   (resulting_return_id, resolved_org_id) -> (id, organization_id)
--     refuses `matched_existing` / `matched_alias` / `created_dissolved`,
--     where the minted return's organization_id is the PRESBYTERY while
--     resolved_org_id is the congregation.
--
-- The referent's owning org VARIES BY DISPOSITION, so no pair involving
-- organization_id can be true. The disposition-INDEPENDENT invariant is
-- `statistical_returns.about_org_id = import_rows.resolved_org_id`: true by
-- construction for every minted-import case, and true for the submitted case
-- by statistical_returns_submitted_is_self. That is the pair that actually
-- matches — the same "about_org_id is the column that matches" idiom
-- statistics_submission_grants (drizzle/0049:161-162) and
-- congregation_statistics -> publications already use. The year is pinned
-- alongside it, which no trigger was going to do cheaply and which a frozen,
-- set-once pointer can never be corrected for.
--
-- THIS IS NOT A sec 17 STRUCTURAL EXCEPTION and must not be described as one.
-- Sec 17's exception covers PLAIN references to `organizations` — a non-RLS,
-- publicly readable, non-tenant table — which is why resolved_org_id takes it.
-- Invoking sec 17 for a reference INTO a FORCE-RLS tenant table would
-- establish by precedent that any cross-tenant reference may go bare. The rule
-- here is the general one: a composite FK that is SEMANTICALLY FALSE is not a
-- security improvement, it is a correctness bug that silently refuses a legal
-- write; where the two sides do not share a tenant, the question is never
-- composite-versus-plain but WHICH COLUMN PAIR ACTUALLY MATCHES.
--
-- MATCH SIMPLE's null hole is closed by import_rows_resolution_shape, below,
-- and this is the interaction to preserve: the FK check is skipped when ANY of
-- its three columns is null; `report_year` is not null always; and every
-- branch of the shape CHECK that permits a non-null resulting_return_id
-- (matched_existing, matched_alias, created_dissolved, duplicate) also
-- requires resolved_org_id not null, while `unresolved` and `rejected` force
-- resulting_return_id null outright. So the FK is enforced EXACTLY when the
-- pointer exists. Weakening either constraint re-opens the other's hole.
--
-- NO CHECK, NO TRIGGER, NO DEFINER HELPER for this column, and one thing is
-- explicitly forbidden because it is the reflex build: do NOT validate this
-- pointer with a query inside presby_freeze_import_row(). That function runs
-- with INVOKER rights, and statistical_returns is FORCE RLS filtered to the
-- caller's own rows — its select would return ZERO ROWS for exactly the
-- cross-tenant `duplicate` case the whole ruling exists to permit, while
-- passing every same-tenant test. That is F26 verbatim.
--
-- ACCEPTED RESIDUAL, named rather than deferred: the FK constrains WHICH
-- congregation and year the pointer may name; it does not constrain whether
-- the presbytery was authorized to learn that the return exists. A presbytery
-- holding a uuid out of band could stamp an accurate pointer to an unpublished
-- filing. That grants no read and is arguably a true record, so no constraint
-- is warranted — the control point is the READ, and the executor pipeline's UI
-- must resolve this column through presby_list_published_returns_to_me() (or
-- the tenant's own RLS-filtered select), never a direct join and never a
-- DEFINER fetch by uuid.
--
-- CASE (c) — a duplicate of a `submitted` return that was never published, so
-- its uuid is unobtainable — is not stranded by any of this: the shape CHECK's
-- `duplicate` branch does not require resulting_return_id, so `duplicate` +
-- `rationale` + a permanently null pointer is a legal, meaningful state
-- ("known duplicate, target not readable by us").
do $$
begin
  -- The target-side unique this FK needs. Additive on statistical_returns
  -- (drizzle/0046/0047 are shipped and are not edited); the rest of this
  -- migration's statistical_returns changes are in section 7. It is NOT an
  -- oracle under F103's test: `id` is the primary key, so any collision on
  -- (id, about_org_id, report_year) implies an `id` collision the PK already
  -- reports — and presby_app holds no INSERT on that table at all.
  if not exists (
    select 1 from pg_constraint where conname = 'statistical_returns_id_about_year_key'
  ) then
    alter table statistical_returns
      add constraint statistical_returns_id_about_year_key
      unique (id, about_org_id, report_year);
  end if;

  if not exists (
    select 1 from pg_attribute
     where attrelid = 'import_rows'::regclass
       and attname = 'resulting_return_id'
       and not attisdropped
  ) then
    alter table import_rows add column resulting_return_id uuid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'import_rows_resulting_return_fk'
  ) then
    alter table import_rows
      add constraint import_rows_resulting_return_fk
      foreign key (resulting_return_id, resolved_org_id, report_year)
      references statistical_returns (id, about_org_id, report_year);
  end if;

  -- Shape CHECK, in statistical_returns_provenance_shape's idiom, and half of
  -- the MATCH SIMPLE argument above. Note what it does NOT do: it never
  -- asserts that resulting_return_id agrees with
  -- statistical_returns.staging_row_id (F102). Those are two different facts —
  -- "this artifact was created from that staging row" vs "this staging row's
  -- disposition POINTS AT that return, which may be one it did not create" —
  -- and they diverge precisely on `duplicate`.
  if not exists (
    select 1 from pg_constraint where conname = 'import_rows_resolution_shape'
  ) then
    alter table import_rows
      add constraint import_rows_resolution_shape check (
        (resolution_kind = 'unresolved'
           and resolved_org_id is null and resolved_by is null
           and resolved_at is null and resulting_return_id is null
           and rationale is null)
        or (resolution_kind in ('matched_existing', 'matched_alias', 'created_dissolved')
           and resolved_org_id is not null and resolved_by is not null
           and resolved_at is not null)
        or (resolution_kind = 'duplicate'
           and resolved_org_id is not null and resolved_by is not null
           and resolved_at is not null and rationale is not null)
        or (resolution_kind = 'rejected'
           and resolved_org_id is null and resolved_by is not null
           and resolved_at is not null and rationale is not null
           and resulting_return_id is null)
      );
  end if;
end $$;

comment on column import_rows.resulting_return_id is
  'THE DISPOSITION POINTER: the statistical_returns row this staging row''s resolution points at — one it created, OR a pre-existing one it was found to DUPLICATE. Distinct from statistical_returns.staging_row_id, which is the ARTIFACT''s provenance ("this return was created from that row"); at most one row can claim creation, and the two coincide for matched_*/created_dissolved and DIVERGE for duplicate (F102). They are deliberately NOT asserted to agree — a future reviewer who "simplifies" one away silently breaks dedup. THE FK IS ON THE ABOUT-ORG AXIS, not on organization_id (F104, as revised by the Phase 2 addendum): (resulting_return_id, resolved_org_id, report_year) -> statistical_returns (id, about_org_id, report_year). The referent''s OWNING org varies by disposition — presbytery for the minted-import cases, congregation for a duplicate of a submitted return — so no pair involving organization_id is true in both directions; about_org_id = resolved_org_id is the disposition-independent invariant, guaranteed by construction for imported returns and by statistical_returns_submitted_is_self for submitted ones. This is NOT a sec 17 structural exception (that covers plain references to the non-RLS organizations table only). MATCH SIMPLE skips the check when any of the three columns is null, and import_rows_resolution_shape is what makes that exact: report_year is always not null, every branch permitting a non-null pointer also requires resolved_org_id not null, and unresolved/rejected force the pointer null — so the FK is enforced exactly when the pointer exists. There is deliberately NO validating trigger: an invoker-rights read of FORCE-RLS statistical_returns from presby_freeze_import_row() would return zero rows for exactly the cross-tenant duplicate case (F26). Accepted residual: the FK says which congregation and year may be named, not whether the presbytery was authorized to learn the return exists — the control is the READ, and the executor pipeline must resolve this column through presby_list_published_returns_to_me(), never a direct join.';

comment on constraint import_rows_resulting_return_fk on import_rows is
  'F104 (Phase 2 addendum): the about-org composite, the statistics_submission_grants (drizzle/0049:161-162) and congregation_statistics -> publications idiom — "about_org_id is the column that matches." A composite FK that is semantically false is not a security improvement but a correctness bug that silently refuses a legal write; where the two sides do not share a tenant, ask which pair actually matches, not composite-versus-plain. Enforced exactly when resulting_return_id is non-null, because MATCH SIMPLE''s null skip is closed by import_rows_resolution_shape.';

-- (6b) THE FREEZE / RESOLUTION TRIGGER.
-- Two permitted paths and nothing else, on EVERY connection (F44 again).
--
-- Ruling 6.1's write order is what Path B exists for. resulting_return_id and
-- statistical_returns.staging_row_id are an FK CYCLE; both columns are
-- nullable, so no DEFERRABLE is needed, but the one legal write order inside a
-- future writer's single transaction is:
--
--     insert import_rows (resulting_return_id null)
--       -> insert statistical_returns (staging_row_id set)
--       -> update import_rows.resulting_return_id        <- Path B
--
-- If this trigger did not permit exactly that one update, the executor
-- pipeline's writer would deadlock against its own guard on day one.
create or replace function presby_deny_import_row_change()
returns void language plpgsql as $$
begin
  raise exception 'import_rows: this change is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

-- B-M1 (security review 2026-09-25 sec B) — THIS HELPER KEEPS ITS GRANT, for
-- exactly the reason drizzle/0046_presby_statistical_returns.sql:469-476
-- states for presby_deny_publication_write(). presby_freeze_import_row() is
-- SECURITY INVOKER, and import_rows is reachable by presby_app — Ruling 5
-- kept ordinary tenant DML (minus DELETE) on this table, which is the whole
-- point of the staging design. Revoking EXECUTE without re-granting it would
-- turn the guard's uniform literal into `permission denied for function
-- presby_deny_import_row_change` on the tenant path: still SQLSTATE
-- 42501, still refused, but the message names an internal catalog
-- identifier instead of the designed single literal, and the refusal is
-- then enforced by a FUNCTION ACL rather than by the guard's own logic —
-- a gutted, no-op body would still appear to "pass". Found as Phase 5 FAIL-1
-- (docs/work-log/2026-09-26-name-history-import-staging.md); the tenant-path
-- assertions in scripts/test-rls.sql section 42(i)/(i2) now match on the
-- literal so the grant cannot silently go missing again.
revoke all on function presby_deny_import_row_change() from public;
grant execute on function presby_deny_import_row_change() to presby_app, presby_platform;

create or replace function presby_freeze_import_row()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    perform presby_deny_import_row_change();
    return old;
  end if;

  -- The frozen set never changes on ANY update, regardless of path.
  if new.batch_id is distinct from old.batch_id
     or new.organization_id is distinct from old.organization_id
     or new.row_index is distinct from old.row_index
     or new.raw_payload is distinct from old.raw_payload
     or new.original_name is distinct from old.original_name
     or new.original_city is distinct from old.original_city
     or new.report_year is distinct from old.report_year
     or new.candidates is distinct from old.candidates
  then
    perform presby_deny_import_row_change();
  end if;

  if old.resolution_kind <> 'unresolved' then
    -- PATH B — THE STAMP. An already-resolved row may have
    -- resulting_return_id set FROM NULL, and nothing else, exactly once.
    if old.resulting_return_id is null
       and new.resulting_return_id is not null
       and new.resolution_kind = old.resolution_kind
       and new.resolved_org_id is not distinct from old.resolved_org_id
       and new.resolved_by is not distinct from old.resolved_by
       and new.resolved_at is not distinct from old.resolved_at
       and new.rationale is not distinct from old.rationale
    then
      return new;
    end if;
    -- Includes a SECOND attempt to change resulting_return_id once set.
    perform presby_deny_import_row_change();
  end if;

  -- PATH A — THE RESOLVE. old.resolution_kind = 'unresolved': may set
  -- resolution_kind / resolved_org_id / resolved_by / resolved_at / rationale
  -- together (import_rows_resolution_shape validates the combination), but
  -- NEVER resulting_return_id in the same step — that is Path B's job, always
  -- a separate statement.
  if new.resulting_return_id is not null then
    perform presby_deny_import_row_change();
  end if;

  return new;
end $$;

revoke all on function presby_freeze_import_row() from public;

drop trigger if exists import_rows_freeze on import_rows;
create trigger import_rows_freeze
  before update or delete on import_rows
  for each row execute function presby_freeze_import_row();

-- ---------------------------------------------------------------------------
-- 7. statistical_returns — ADDITIVE ONLY (drizzle/0046 is shipped, not edited)
-- ---------------------------------------------------------------------------
-- The third additive change to this table, `statistical_returns_id_about_year_
-- key`, is in section 6a rather than here: import_rows' about-org composite FK
-- references it, so it has to exist by the time that constraint is added.
--
-- Ruling 6. drizzle/0046:307-312 left `staging_row_id` a bare uuid on purpose,
-- awaiting this table. COMPOSITE, and required: an imported return's
-- organization_id IS the presbytery and the import row's is too, so
-- (staging_row_id, organization_id) -> import_rows (id, organization_id) pins
-- both sides to one tenant. That matters beyond tidiness — RI CHECKS BYPASS ROW
-- SECURITY BY DESIGN, so a plain FK to a FORCE-RLS table is a cross-tenant
-- existence oracle in F40's family; the composite confines the probe to the
-- prober's own org. Unreachable today regardless (presby_app holds no INSERT on
-- statistical_returns), but a constraint should be right on its own terms and
-- not by accident of a grant.
--
-- MATCH SIMPLE (Postgres's default) means a `submitted` row's null
-- staging_row_id skips the check entirely. No special-casing needed.
--
-- DDL-ONLY, by necessity: declaring this FK in src/lib/db/domain/returns.ts
-- would make returns.ts import imports.ts, while imports.ts already imports
-- returns.ts for statisticalReturns — the domain graph's second module cycle,
-- the blob_assets shape (assets.ts:63-78). scripts/check-schema-parity.ts
-- carries the matching `architectural` allowlist row.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'statistical_returns_staging_row_fk'
  ) then
    alter table statistical_returns
      add constraint statistical_returns_staging_row_fk
      foreign key (staging_row_id, organization_id)
      references import_rows (id, organization_id);
  end if;

  -- ADDITIVE, and suggested rather than required by Ruling 6.3: 0046's
  -- statistical_returns_provenance_shape does not constrain staging_row_id to
  -- imported rows at all, so a `submitted` row can carry one today (verified
  -- live). This says only "import staging provenance implies imported
  -- provenance" — the direction that matters, so a submitted row can never
  -- smuggle staging provenance onto itself. It deliberately does NOT require
  -- an imported row to carry the column (an imported row minted before
  -- import_rows existed would be legal; none exist, but the CHECK should not
  -- assume otherwise), matching 0046's own restraint.
  --
  -- NARROWED FROM RULING 6.3'S LITERAL TEXT, and this is a correction rather
  -- than a preference — proposed as a new finding for the orchestrator at
  -- integration. Ruling 6.3 wrote `(staging_row_id is null and source_ref is
  -- null)`. Applied as written, this migration ABORTED: drizzle/0047:683-691's
  -- backfill mints a `submitted` return carrying
  -- `source_ref = 'backfill: reconstructed from congregation_statistics <id>
  -- (drizzle/0047)'`, and drizzle/0047:789-799 then MATCHES ON that value to
  -- repair the row idempotently. `source_ref` is a general free-text
  -- provenance note, not a D13-only column (returns.ts:210's "D13 import
  -- provenance" docstring is what made it look like one), and the offending
  -- row cannot be corrected even in principle — statistical_returns_freeze
  -- refuses UPDATE and DELETE on every connection, owner included. So the
  -- CHECK is narrowed to `staging_row_id`, which IS D13-only, which is the
  -- column the composite FK above pins, and which nothing has ever written on
  -- a submitted row. A CHECK that a shipped, deliberate write path violates is
  -- not a tightening; it is a migration that cannot be applied.
  --
  -- Worth noting for DECISION-150's sake: this would have passed on a
  -- genuinely from-empty database (0047's backfill has no congregation_
  -- statistics rows to reconstruct there) and failed only on a database with
  -- history. The from-empty rehearsal is necessary, not sufficient.
  if not exists (
    select 1 from pg_constraint
     where conname = 'statistical_returns_import_provenance_shape'
  ) then
    alter table statistical_returns
      add constraint statistical_returns_import_provenance_shape
      check (provenance = 'imported' or staging_row_id is null);
  end if;
end $$;

comment on constraint statistical_returns_id_about_year_key on statistical_returns is
  'Added in section 6a of drizzle/0053 as the target side of import_rows_resulting_return_fk (F104, Phase 2 addendum). Not an oracle under F103''s test: `id` is the primary key, so any collision here implies an `id` collision the PK already reports, and presby_app holds no INSERT on this table. Declared in src/lib/db/domain/returns.ts as well — not for check:schema-parity (which ignores uniques) but as db:push protection, since an undeclared constraint on a table Drizzle DOES model is a drop candidate the first time someone runs the dev-only push.';

comment on column statistical_returns.staging_row_id is
  'D13 import provenance: the import_rows row this ARTIFACT was created from. COMPOSITE FK to import_rows(id, organization_id), enforced DDL-only in drizzle/0053 — see that file''s section 7 and scripts/check-schema-parity.ts''s allowlist row. Null on every submitted row, enforced by statistical_returns_import_provenance_shape (which constrains THIS column only — source_ref is a general provenance note that drizzle/0047''s backfill legitimately writes on a submitted row). Distinct from import_rows.resulting_return_id, which is the staging row''s DISPOSITION and may point at a return it did not create (F102).';

-- ---------------------------------------------------------------------------
-- 8. presby_match_organization() — the candidate search
-- ---------------------------------------------------------------------------
-- STABLE, SECURITY INVOKER, over the section-3 view plus `organizations`
-- (which has no RLS at all and is public). Ruling 2: the minimal-disclosure
-- guarantee is STRUCTURAL — the substrate does not contain the recording
-- council, the minute or the notes — rather than a reviewed column list.
--
-- THE RETURN COLUMN LIST IS THE REVIEW ARTIFACT. Never returned:
-- `platform_status` (D9's tenant axis; a branded-403-shaped leak by another
-- mechanism, DECISION-047), `slug`, `deletable_until`, `status`.
-- `lifecycle_status` and the current parent ARE returned deliberately: they
-- are the labels a clerk needs so as not to choose blind between two
-- same-named churches, and both are already public-tree facts.
--
-- F100, recorded so the rule is not mistaken for a closure: platform_status is
-- ALREADY readable on the tenant connection (`organizations` has
-- relrowsecurity = f and presby_app holds table-level SELECT). This is a
-- SURFACE rule — it stops a cross-council candidate list from RENDERING the
-- tenant axis to a clerk. The raw-grant reachability is pre-existing, relied on
-- deliberately in at least one shipped place, and a separate hardening
-- question. Do not widen; do not try to close it here.
--
-- THE YEAR RANKS; IT NEVER FILTERS (Ruling 4, Open Question 3). F30's lesson is
-- that half a 41-year archive failed on reference resolution — a matcher that
-- HIDES the right candidate because someone mis-recorded an effective_to
-- reproduces that failure with a clean conscience. Overlap semantics, not
-- containment (a mid-year rename means both names were in force during the
-- reporting year), and a null endpoint is unbounded.
--
-- EMPTY OR NULL INPUT RETURNS ZERO ROWS, NEVER AN EXCEPTION. The real caller
-- will be a loop over spreadsheet rows; raising kills the whole batch, and
-- D13's rule is quarantine-never-drop. A zero-candidate row is a legitimate
-- `unresolved` outcome, not an error.
--
-- BOUNDED `limit 20`, no `offset` — no pagination means no enumeration crawl.
--
-- check:sql-date IS DORMANT HERE, NOT CLOSED: effective_from / effective_to
-- come back from a FUNCTION, and the Neon driver returns computed date
-- expressions as STRINGS because there is no column OID to map against. No
-- TypeScript reads this function's output in this increment; the executor
-- pipeline's first TS caller must treat both as strings and annotate
-- accordingly, not assume a Date.
create or replace function presby_match_organization(
  p_name text,
  p_city text default null,
  p_year integer default null
)
returns table (
  organization_id     uuid,
  matched_name        text,
  name_type           text,
  city                text,
  state               text,
  organization_type   text,
  lifecycle_status    text,
  current_parent_id   uuid,
  current_parent_name text,
  effective_from      date,
  effective_to        date,
  rank                integer,
  confidence          text
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  -- Every reference below is table-qualified and every intermediate column is
  -- aliased away from an OUT-parameter name on purpose: in a SQL-language
  -- function the declared return columns are visible as identifiers, and an
  -- unqualified `city` or `rank` would be ambiguous.
  with q as (
    select nullif(presby_normalize_org_match_text(p_name), '') as name_norm,
           nullif(presby_normalize_org_match_text(p_city), '') as city_norm
  ),
  hit as (
    select h.subject_org_id as org_id,
           h.name           as row_name,
           h.name_type      as row_type,
           h.city           as row_city,
           h.state          as row_state,
           h.effective_from as row_from,
           h.effective_to   as row_to,
           -- F33's key is "a name AT A PLACE" — but a genuinely UNKNOWN city
           -- on either side must not silently exclude a real match, because
           -- every backfilled canonical row has city null (Phase 1 Gap 1). A
           -- KNOWN disagreement is downranked, never dropped: the clerk should
           -- be able to recognize "right church, historically misrecorded
           -- city" rather than have it vanish.
           (q.city_norm is null
            or h.city_normalized is null
            or h.city_normalized = q.city_norm) as city_ok,
           -- CASE, not OR, so make_date() is never evaluated on an
           -- out-of-range p_year fed in from a spreadsheet cell.
           (case
              when p_year is null or p_year < 1 or p_year > 9998 then true
              else daterange(h.effective_from, h.effective_to, '[)')
                   && daterange(make_date(p_year, 1, 1),
                                make_date(p_year + 1, 1, 1), '[)')
            end) as year_ok
      from organization_name_history_public h
      cross join q
     where q.name_norm is not null
       and h.name_normalized = q.name_norm
  ),
  ranked as (
    select hit.org_id, hit.row_name, hit.row_type, hit.row_city, hit.row_state,
           hit.row_from, hit.row_to,
           (case when hit.city_ok and hit.year_ok then 1
                 when hit.city_ok                 then 2
                 when hit.year_ok                 then 3
                 else 4
            end)::integer as row_rank
      from hit
  )
  select r.org_id,
         r.row_name,
         r.row_type,
         r.row_city,
         r.row_state,
         o.organization_type::text,
         o.lifecycle_status,
         o.parent_id,
         par.name,
         r.row_from,
         r.row_to,
         r.row_rank,
         -- Explicit rank, not an alphabetical accident, and a BAND rather than
         -- a float — presby_match_person()'s idiom (drizzle/0009:302-305). No
         -- false precision.
         (array['exact', 'high', 'medium', 'low'])[r.row_rank]
    from ranked r
    join organizations o on o.id = r.org_id
    left join organizations par on par.id = o.parent_id
   order by r.row_rank, r.row_from nulls last
   limit 20;
$$;

revoke all on function presby_match_organization(text, text, integer) from public;
grant execute on function presby_match_organization(text, text, integer)
  to presby_app, presby_platform;

comment on function presby_match_organization(text, text, integer) is
  'D13/D14/F33 candidate search: "who was called this, where, in what year". STABLE and SECURITY INVOKER over organization_name_history_public — minimal disclosure is structural, not a reviewed column list (Ruling 2). Never returns platform_status, slug, deletable_until or status; returns lifecycle_status and the current parent deliberately, so a clerk is not choosing blind between two same-named churches. The YEAR RANKS AND NEVER FILTERS (F30). Empty or null input returns zero rows rather than raising, because the caller is a loop over a spreadsheet and D13''s rule is quarantine-never-drop. Bounded at 20 rows with no offset.';

-- ---------------------------------------------------------------------------
-- 9. BACKFILL-COMPLETENESS ASSERTION — the last statement before commit
-- ---------------------------------------------------------------------------
-- 0044's discipline (Phase 2 Notes item 3, Ruling 7), and TWO assertions
-- rather than one.
--
-- The second is the one that matters operationally: "every organization has
-- exactly one OPEN canonical row" is what the matcher's name-in-force-today
-- path depends on, and a duplicate open row would satisfy a plain total count
-- while breaking that path. The EXCLUDE constraint already makes a second open
-- canonical row unwritable — so if this assertion ever fires, the EXCLUDE is
-- gone, which is worth failing the migration over.
do $$
declare
  v_orgs            integer;
  v_open_canonical  integer;
  v_orgs_with_open  integer;
begin
  select count(*) into v_orgs from organizations;
  select count(*) into v_open_canonical
    from organization_name_history
   where name_type = 'canonical' and effective_to is null;
  select count(distinct h.subject_org_id) into v_orgs_with_open
    from organization_name_history h
   where h.name_type = 'canonical' and h.effective_to is null;

  if v_orgs <> v_open_canonical then
    raise exception
      'name-history backfill incomplete: % organizations but % open canonical rows',
      v_orgs, v_open_canonical;
  end if;

  if v_orgs <> v_orgs_with_open then
    raise exception
      'name-history backfill malformed: % organizations but only % of them have an open canonical row (some org carries more than one)',
      v_orgs, v_orgs_with_open;
  end if;

  raise notice 'name-history backfill complete: % organizations, % open canonical rows, one each',
    v_orgs, v_open_canonical;
end $$;
