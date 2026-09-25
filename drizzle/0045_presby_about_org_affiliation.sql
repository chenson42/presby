-- The about-org enforcing trigger (R3.14) — increment 3 of the lifecycle/
-- affiliation/returns pipeline (docs/work-log/2026-09-24-lifecycle-
-- affiliation-returns.md, Phase 3 Data Model "Increment 3"; DECISION-135
-- through DECISION-139; docs/schema-design-2.md sec 2b).
--
-- This migration ships ONLY the enforcing trigger. Its two read functions,
-- presby_org_affiliated() and presby_affiliation_parent_as_of(), already
-- shipped in drizzle/0044 (DECISION-139's deliberate sequencing deviation:
-- the affiliation write path's own standing check depends on the second of
-- them, so neither could ship later than 0044).
--
-- WHAT IT ENFORCES. Four shipped tables carry a row ABOUT another
-- organization — a presbytery's record concerning one of its member
-- congregations. Until now the only thing standing between "the presbytery's
-- own rows" and "a row about an organization that was never its member" was
-- an application-layer parent_id check in two TypeScript modules
-- (src/lib/presbytery.ts:143,169 and src/lib/credentials.ts:522,710). This
-- migration makes it a database property, answered from the affiliation
-- history rather than from the derived parent_id cache — which is what makes
-- a 1990 statistical return resolvable to the council that actually received
-- it in 1990 (F30/F31), not to whoever holds the congregation today.
--
-- THE FOUR TABLES, AND THE FIFTH THAT IS NOT ONE:
--
--   congregation_oversight   about_org_id     as of current_date
--   congregation_statistics  about_org_id     as of the row's `year`
--   per_capita_records       about_org_id     as of the row's `billing_year`
--   appointments             serving_org_id   as of current_date
--
--   per_capita_rates is NAMED by Phase 3's Data Model as one of the five
--   tables and CANNOT carry this trigger: it has no about-org column at all
--   (id, organization_id, billing_year, basis_year, rate_per_member,
--   updated_by, updated_at — verified against both src/lib/db/domain/
--   presbytery.ts:343 and the live information_schema). A rate is one row
--   per presbytery per billing year, not a row about a congregation; there
--   is no about-org to check. Recorded as a Phase 3 spec defect in the
--   work-log rather than silently dropped. The fifth table that DOES carry
--   the pattern is `appointments` (serving_org_id) — Phase 2 named it only
--   as "whichever officer/credentials table already uses the pattern" and
--   required a re-grep at implementation time; this is that re-grep's
--   answer (`grep -rn "aboutOrgId\|servingOrgId" src/lib/db/domain/`).
--
-- THE as_of RULE, and the one place it is wider than "a date":
--
--   For congregation_oversight and appointments the question is a PRESENT
--   one ("is this congregation mine?"), so as_of is current_date. This is
--   also the value that keeps the trigger in exact agreement with the four
--   shipped parent_id call sites named above, which is Phase 2 Notes item
--   3's whole concern: parent_id IS the currently-open affiliation's
--   parent_org_id (drizzle/0044 asserts it, scripts/test-rls.sql section
--   32(h) re-proves it), so at current_date the two answers cannot differ.
--
--   For congregation_statistics and per_capita_records the question is a
--   HISTORICAL one and Phase 3 specifies "the row's year". A year is not a
--   date, so this migration reads it as the WHOLE year: the row is accepted
--   if the about-org was affiliated with the council at ANY of the year's
--   endpoints (Jan 1 or Dec 31). Taking a single instant instead would
--   refuse two legitimate, foreseeable rows: a congregation dissolved in
--   June whose final-year return is filed afterwards (Dec 31 fails), and a
--   congregation received in June whose first-year return is filed for that
--   same year (Jan 1 fails). ACCEPTED GAP, named rather than hidden: an
--   affiliation that both opens AND closes inside one calendar year is not
--   detected by an endpoint test, so a row for that year is refused. A true
--   range-overlap test against a recursive ancestry walk is materially more
--   machinery than that case is worth today.
--
-- WHY THE UPDATE ARM ONLY FIRES WHEN THE KEYS MOVE. A BEFORE INSERT OR
-- UPDATE trigger that re-checked every UPDATE would refuse an ordinary
-- per_capita_records payment posting (paid_status/paid_amount) on a bill
-- issued to a congregation that has since been redistricted — punishing a
-- routine bookkeeping write for a fact about the past. The trigger therefore
-- returns early on an UPDATE that leaves both the about-org column and the
-- year column untouched. Re-POINTING a row at a different organization, or
-- moving its reporting year, is re-checked in full.
--
-- WHY SECURITY DEFINER. presby_org_affiliated() reads
-- organization_affiliations, which is FORCE RLS and tenant-isolated to the
-- RECORDING council — the trigger must see a row another council wrote
-- (F26). presby_org_affiliated() is itself SECURITY DEFINER, so the read
-- would succeed either way; DEFINER here is belt-and-braces for the same
-- reason drizzle/0044's guards are, and is stated rather than cargo-culted
-- per DECISION-121's warning.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0. THE BACKFILL-COMPLETENESS PROOF, RE-RUN STANDALONE (Phase 2 Notes 3)
-- ---------------------------------------------------------------------------
-- drizzle/0044 asserted this at the moment it backfilled. Phase 2 requires
-- it proven again HERE, immediately before the trigger that depends on it is
-- created, because anything that wrote organizations.parent_id between the
-- two migrations would put the shipped UI's answer and this trigger's answer
-- out of step — and that defect surfaces as a user-facing error on a shipped
-- page, not as a failing test.
do $$
declare
  v_orgs_with_parent  integer;
  v_open_affiliations integer;
begin
  select count(*) into v_orgs_with_parent from organizations where parent_id is not null;
  select count(*) into v_open_affiliations from organization_affiliations where effective_to is null;
  if v_orgs_with_parent <> v_open_affiliations then
    raise exception
      'affiliation backfill incomplete: % orgs have parent_id set but % open affiliation rows exist — increment 3''s trigger must not be created over an inconsistent cache',
      v_orgs_with_parent, v_open_affiliations;
  end if;
  raise notice 'backfill completeness re-proven: % parented orgs, % open affiliation rows',
    v_orgs_with_parent, v_open_affiliations;
end $$;

-- And the same discipline applied to the data the trigger is about to guard:
-- a trigger does not validate rows that already exist, so any pre-existing
-- violation would sit in the database permanently, invisible until someone
-- tried to correct the row. Fail loudly here instead.
do $$
declare
  v_bad integer;
begin
  select
    (select count(*) from congregation_oversight c
      where not presby_org_affiliated(c.about_org_id, c.organization_id, current_date))
  + (select count(*) from congregation_statistics c
      where not (presby_org_affiliated(c.about_org_id, c.organization_id, make_date(c.year, 1, 1))
              or presby_org_affiliated(c.about_org_id, c.organization_id, make_date(c.year, 12, 31))))
  + (select count(*) from per_capita_records c
      where not (presby_org_affiliated(c.about_org_id, c.organization_id, make_date(c.billing_year, 1, 1))
              or presby_org_affiliated(c.about_org_id, c.organization_id, make_date(c.billing_year, 12, 31))))
  + (select count(*) from appointments a
      where not presby_org_affiliated(a.serving_org_id, a.organization_id, current_date))
  into v_bad;
  if v_bad > 0 then
    raise exception
      'about-org enforcement would be created over % pre-existing violating row(s); reconcile them (or their affiliation history) first',
      v_bad;
  end if;
  raise notice 'about-org pre-flight clean: 0 violating rows across congregation_oversight, congregation_statistics, per_capita_records, appointments';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The rejection helper — one string, one errcode, one place
-- ---------------------------------------------------------------------------
-- Uniform ACROSS CAUSES, which is what F40 actually asks for: "no such
-- organization", "never affiliated with this council" and "the affiliation
-- closed before this record's date" are indistinguishable from the message.
--
-- Deliberately NOT uniform across TABLES, and not opaque the way
-- presby_deny_affiliation_change() is. The oracle F40 closes needs a fact
-- the caller cannot otherwise obtain; here there is none —
-- `organizations` (including parent_id) and organization_affiliations_public
-- are readable by every tenant connection with no org context at all, so a
-- council can already answer "is this organization affiliated with me" by
-- SELECT. Naming the table and the as_of date therefore leaks nothing and
-- gives the future lifecycle/statistics UI something it can map to human
-- copy, exactly as setCongregationStatisticsAction already does for its own
-- rejections.
create or replace function presby_deny_about_org_write(p_table text, p_as_of text)
returns void language plpgsql as $$
begin
  raise exception
    '%: the organization this record is about was not affiliated with this council as of %',
    p_table, p_as_of
    using errcode = 'insufficient_privilege';
end $$;

-- B-M1 (security review 2026-09-25 sec B, applied 2026-09-25): trigger-only.
-- Its single caller, presby_check_about_org_affiliated() below, is SECURITY
-- DEFINER and therefore runs as the owner even when a tenant INSERT fires it,
-- so the rejection literal is raised with the owner's privileges and the
-- tenant grant buys nothing.
revoke all on function presby_deny_about_org_write(text, text) from public;
revoke execute on function presby_deny_about_org_write(text, text) from presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 2. The enforcing trigger function — ONE function, four tables
-- ---------------------------------------------------------------------------
-- Parameterised through TG_ARGV rather than written out four times:
--   TG_ARGV[0] — the about-org column ('about_org_id' | 'serving_org_id')
--   TG_ARGV[1] — the year column, or '' for "as of current_date"
-- The row is read through to_jsonb(NEW) because the column NAME is dynamic;
-- NEW.organization_id is read the same way purely for symmetry.
create or replace function presby_check_about_org_affiliated()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_about_col text  := tg_argv[0];
  v_year_col  text  := nullif(tg_argv[1], '');
  v_new       jsonb := to_jsonb(new);
  v_old       jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_about     uuid;
  v_council   uuid;
  v_year      integer;
  v_ok        boolean;
  v_as_of     text;
begin
  -- An UPDATE that moves neither the about-org nor the reporting year is a
  -- payment posting, a note edit, a status change — not a re-pointing. See
  -- the header.
  if tg_op = 'UPDATE'
     and (v_new -> v_about_col) is not distinct from (v_old -> v_about_col)
     and (v_year_col is null
          or (v_new -> v_year_col) is not distinct from (v_old -> v_year_col))
  then
    return new;
  end if;

  v_about   := (v_new ->> v_about_col)::uuid;
  v_council := (v_new ->> 'organization_id')::uuid;

  if v_year_col is null then
    v_as_of := current_date::text;
    v_ok := presby_org_affiliated(v_about, v_council, current_date);
  else
    v_year  := (v_new ->> v_year_col)::integer;
    v_as_of := v_year::text;
    -- The whole year, not an instant — see the header's as_of note.
    v_ok := presby_org_affiliated(v_about, v_council, make_date(v_year, 1, 1));
    if not v_ok then
      v_ok := presby_org_affiliated(v_about, v_council, make_date(v_year, 12, 31));
    end if;
  end if;

  if not v_ok then
    perform presby_deny_about_org_write(tg_table_name, v_as_of);
  end if;

  return new;
end $$;

-- B-M1: this is a TRIGGER function and nothing else. EXECUTE on a trigger
-- function is checked when the trigger is CREATED (by the owner, here), never
-- when it fires, so revoking the application roles' grant does not touch the
-- live tenant write path — scripts/test-rls.sql sections 29 and 33 insert
-- congregation_statistics as presby_app and are the proof.
revoke all on function presby_check_about_org_affiliated() from public;
revoke execute on function presby_check_about_org_affiliated() from presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. The four triggers
-- ---------------------------------------------------------------------------
drop trigger if exists congregation_oversight_about_org on congregation_oversight;
create trigger congregation_oversight_about_org
  before insert or update on congregation_oversight
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

drop trigger if exists congregation_statistics_about_org on congregation_statistics;
create trigger congregation_statistics_about_org
  before insert or update on congregation_statistics
  for each row execute function presby_check_about_org_affiliated('about_org_id', 'year');

drop trigger if exists per_capita_records_about_org on per_capita_records;
create trigger per_capita_records_about_org
  before insert or update on per_capita_records
  for each row execute function presby_check_about_org_affiliated('about_org_id', 'billing_year');

drop trigger if exists appointments_about_org on appointments;
create trigger appointments_about_org
  before insert or update on appointments
  for each row execute function presby_check_about_org_affiliated('serving_org_id', '');

-- ---------------------------------------------------------------------------
-- 4. Column comments — the enforcement is invisible in the Drizzle schema
-- ---------------------------------------------------------------------------
comment on column congregation_oversight.about_org_id is
  'The member congregation this oversight record is ABOUT. Plain (non-composite) FK by the section-17 structural exception. Enforced by congregation_oversight_about_org (drizzle/0045): presby_org_affiliated(about_org_id, organization_id, current_date) must be true.';
comment on column congregation_statistics.about_org_id is
  'The congregation these statistics are ABOUT. Plain (non-composite) FK by the section-17 structural exception. Enforced by congregation_statistics_about_org (drizzle/0045) AS OF THE ROW''S YEAR, not today: a 1990 return belongs to the council that held the congregation in 1990 (F30/F31).';
comment on column per_capita_records.about_org_id is
  'The congregation this bill is ABOUT. Plain (non-composite) FK by the section-17 structural exception. Enforced by per_capita_records_about_org (drizzle/0045) as of the row''s billing_year. Payment postings (paid_status/paid_amount) are not re-checked — only a change to about_org_id or billing_year is.';
comment on column appointments.serving_org_id is
  'The member congregation or NWC the appointee serves. Plain (non-composite) FK by the section-17 structural exception. Enforced by appointments_about_org (drizzle/0045) as of current_date — the present-tense question the presbytery''s own UI asks (src/lib/credentials.ts:522,710), so the two answers cannot disagree.';
