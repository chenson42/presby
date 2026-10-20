-- drizzle/0056_presby_giving_statements.sql
--
-- Online giving, Batch 5a: year-end contribution statements. Three tables
-- (giving_statements, giving_statement_lines, giving_statement_deliveries),
-- their tenant RLS and grants, the insert guards, the deferred consistency
-- constraint triggers, the freeze/delete guards, and a guard that keeps a
-- statement's stored PDF bytes immutable.
--
-- docs/work-log/2026-10-15-online-giving.md -> Phase 3 "0056" (Data Model)
-- and "Statements (Batch 5)" (API contract); Phase 2 R12; DECISION-173
-- (a statement is a frozen snapshot plus PDF bytes, never a re-render;
-- staleness is derived, never stored; a correction is version n+1),
-- DECISION-174 (pdfkit), DECISION-175 (5) (the delete guard), P3-1, P3-8.
--
-- APPLY (owner, direct/unpooled endpoint - db:generate emits none of this),
-- AFTER drizzle/0055_presby_giving.sql:
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0056_presby_giving_statements.sql
--
-- IDEMPOTENT, WHOLE FILE: `create ... if not exists`, drop-then-add for every
-- CHECK and trigger, `create or replace function`, revoke-then-grant. Proven
-- by applying the whole file twice (work-log "Batch 5a").
--
-- Sections:
--   1. giving_statements            the frozen header + snapshots
--   2. giving_statement_lines       the frozen gift lines
--   3. giving_statement_deliveries  insert-only delivery log (print, notice)
--   4. RLS (ENABLE + FORCE + tenant_isolation), grants, comments
--   5. internal helpers (ungranted)
--   6. triggers - every one fires on the owner path too (F44)
--   7. EXECUTE: the new functions are granted to nobody
--
-- WHAT presby_app CAN DO: SELECT and INSERT on the three tables (issuing is a
-- tenant act through withOrgContext(), Phase 3). No UPDATE, no DELETE, for
-- anyone. Creation is guarded as strongly as mutation (F54-F58): the INSERT
-- grant is bounded by giving_statements_insert_guard (who may issue, for
-- which donor, which predecessor, which bytes) and by the DEFERRED
-- consistency triggers, which refuse at COMMIT any statement whose header
-- disagrees with its lines or whose lines disagree with the gift rows.
--
-- DEVIATIONS FROM THE PHASE 3 DDL TEXT (named; each strictly tighter or a
-- completion of the design's stated intent):
--   (S1) The issuer is checked. giving_statements_insert_guard requires
--        presby_current_org() = organization_id and that issued_by is the user
--        of a live person with an ACTIVE membership there who holds BOTH
--        giving.manage and giving.view (the Phase 3 issue gate: "manage and
--        view"). The same shape as 0055 D2 for offline recording: the
--        database refuses a caller the app forgot to gate.
--        giving_statement_deliveries_insert_guard requires giving.manage.
--   (S2) issued_at (and a delivery's occurred_at) is stamped by the insert
--        guard with now(); a caller cannot supply it. Staleness is derived
--        from issued_at (DECISION-173), so a forward-dated issued_at would
--        make a statement that never goes stale.
--   (S3) The blob is checked, not just referenced: the referenced
--        blob_assets row must be application/pdf and its content_hash (the
--        sha256 store() computed over the bytes) must equal pdf_sha256. And
--        blob_assets_giving_statement_guard (a trigger on blob_assets, the
--        one table outside the giving_* set this file touches) refuses an
--        UPDATE of any blob a statement references. The composite FK keeps
--        the PDF undeletable; this keeps it unchanged. Both bind the owner.
--   (S4) The consistency check is COMPLETE as well as consistent: at commit,
--        every line must equal its gift row as it stands (donor-root group,
--        succeeded, livemode, occurred_on in the period, gross/covered fee/
--        net reversed, cash vs non-cash), the header totals must equal the
--        lines, line_no must run 1..n, AND no counting gift of the donor-root
--        group in the period may be missing. "Counting" is fixed here, once:
--        remaining = gross - reversed - (covered fee unless
--        covered_fee_counted); a gift with remaining <= 0 is excluded; a
--        `stock` gift is non_cash (its amount is never printed); every other
--        method is cash. The design's clause "the totals can't disagree with
--        the lines" alone would let a statement silently omit a gift.
--   (S5) A delivery_country column on the header snapshot (nullable, ISO
--        alpha-2, like giving_donors.country): a mailed statement to a
--        non-US address must print the country.
--   (S6) Version uniqueness is (organization_id, donor_id, tax_year,
--        version) - the design's (donor_id, tax_year, version) with the
--        tenant column leading; donor ids are global uuids, so the two are
--        equivalent, and the org-leading key also serves the per-org reads.
--   (S7) email_notice deliveries must carry email_queue_id and print_mailed
--        deliveries must not (CHECK) - the bounce join depends on it.
--   (S8) Lines and deliveries have no deletable_until of their own; their
--        delete guard reads the PARENT statement's deletable_until, so a
--        test-stamped statement can be removed (lines and deliveries first,
--        then the statement) on the owner path.
--
-- RESIDUALS (accepted, the 0055 class): TRUNCATE fires no row trigger and is
-- not guarded (the owner can also ALTER TABLE ... DISABLE TRIGGER); the
-- consistency check reads gift rows as of COMMIT, so a gift committed by a
-- concurrent transaction between the check and the commit is neither on the
-- statement nor (since its created_at precedes issued_at) detected as stale -
-- a window of microseconds, not a design path; email_queue_id is a plain
-- uuid (email_queue is a platform table with no tenant key, and no FK runs
-- from a tenant table to it anywhere in the schema).

-- ---------------------------------------------------------------------------
-- 1. giving_statements
-- ---------------------------------------------------------------------------
create table if not exists giving_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null,
  tax_year smallint not null,
  version smallint not null default 1,
  supersedes_id uuid,
  -- snapshots (G6/G12): the donee identity AS ISSUED (from giving_settings)
  donee_legal_name text not null,
  donee_address_line1 text not null,
  donee_address_line2 text,
  donee_city text not null,
  donee_region text not null,
  donee_postal_code text not null,
  donee_ein text,
  signatory_name text,
  signatory_title text,
  greeting_text text not null,
  closing_text text not null,
  -- the code-generated IRS wording's version (statement-policy.ts)
  wording_version smallint not null,
  -- the donor and the delivery address AS ISSUED
  donor_name text not null,
  delivery_line1 text,
  delivery_line2 text,
  delivery_city text,
  delivery_region text,
  delivery_postal_code text,
  delivery_country text,
  delivery_email text,
  period_start date not null,
  period_end date not null,
  cash_total_cents bigint not null,
  gift_count integer not null,
  non_cash_count integer not null default 0,
  -- the policy constant in force when issued (G10, statement-policy.ts)
  covered_fee_counted boolean not null,
  blob_asset_id uuid not null,
  pdf_sha256 text not null,
  issued_by uuid not null references users(id),
  issued_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_statements_id_org_key unique (id, organization_id),
  constraint giving_statements_version_key unique (organization_id, donor_id, tax_year, version),
  constraint giving_statements_donor_fk foreign key (donor_id, organization_id)
    references giving_donors (id, organization_id),
  constraint giving_statements_supersedes_fk foreign key (supersedes_id, organization_id)
    references giving_statements (id, organization_id),
  -- NO ACTION: a referenced blob cannot be deleted, on any connection (an FK
  -- binds the owner where a grant cannot, F44). DDL-only: not declared in
  -- giving.ts (assets.ts is imported by the storage adapter alone,
  -- DECISION-058); scripts/check-schema-parity.ts allowlists it.
  constraint giving_statements_blob_fk foreign key (blob_asset_id, organization_id)
    references blob_assets (id, organization_id)
);

alter table giving_statements drop constraint if exists giving_statements_tax_year_range;
alter table giving_statements add constraint giving_statements_tax_year_range
  check (tax_year between 2000 and 2100);
alter table giving_statements drop constraint if exists giving_statements_version_chain;
alter table giving_statements add constraint giving_statements_version_chain
  check (version between 1 and 1000
         and (version = 1) = (supersedes_id is null)
         and supersedes_id is distinct from id);
alter table giving_statements drop constraint if exists giving_statements_period_shape;
alter table giving_statements add constraint giving_statements_period_shape
  check (period_start = make_date(tax_year, 1, 1) and period_end = make_date(tax_year, 12, 31));
alter table giving_statements drop constraint if exists giving_statements_totals_shape;
alter table giving_statements add constraint giving_statements_totals_shape
  check (cash_total_cents >= 0 and gift_count >= 1
         and non_cash_count between 0 and gift_count
         and (cash_total_cents = 0) = (non_cash_count = gift_count));
alter table giving_statements drop constraint if exists giving_statements_wording_version_positive;
alter table giving_statements add constraint giving_statements_wording_version_positive
  check (wording_version >= 1);
alter table giving_statements drop constraint if exists giving_statements_pdf_sha256_shape;
alter table giving_statements add constraint giving_statements_pdf_sha256_shape
  check (pdf_sha256 ~ '^[0-9a-f]{64}$');
-- The donee snapshot mirrors giving_settings' shape CHECKs, and is NON-EMPTY:
-- a statement cannot be issued without a donee name and address (the Phase 3
-- run blockers `donee_name` / `donee_address`).
alter table giving_statements drop constraint if exists giving_statements_donee_name_shape;
alter table giving_statements add constraint giving_statements_donee_name_shape
  check (donee_legal_name = btrim(donee_legal_name) and char_length(donee_legal_name) between 1 and 200);
alter table giving_statements drop constraint if exists giving_statements_donee_address_shape;
alter table giving_statements add constraint giving_statements_donee_address_shape
  check (donee_address_line1 = btrim(donee_address_line1) and char_length(donee_address_line1) between 1 and 120
         and donee_city = btrim(donee_city) and char_length(donee_city) between 1 and 120
         and coalesce(char_length(donee_address_line2), 0) <= 120
         and donee_region ~ '^[A-Z]{2}$'
         and donee_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$');
alter table giving_statements drop constraint if exists giving_statements_donee_ein_shape;
alter table giving_statements add constraint giving_statements_donee_ein_shape
  check (donee_ein is null or donee_ein ~ '^[0-9]{2}-[0-9]{7}$');
alter table giving_statements drop constraint if exists giving_statements_text_bounds;
alter table giving_statements add constraint giving_statements_text_bounds
  check (coalesce(char_length(signatory_name), 0) <= 120
         and coalesce(char_length(signatory_title), 0) <= 120
         and char_length(btrim(greeting_text)) between 1 and 500
         and char_length(btrim(closing_text)) between 1 and 500);
alter table giving_statements drop constraint if exists giving_statements_donor_name_shape;
alter table giving_statements add constraint giving_statements_donor_name_shape
  check (donor_name = btrim(donor_name) and char_length(donor_name) between 1 and 120);
alter table giving_statements drop constraint if exists giving_statements_delivery_shape;
alter table giving_statements add constraint giving_statements_delivery_shape
  check (coalesce(char_length(delivery_line1), 0) <= 120
         and coalesce(char_length(delivery_line2), 0) <= 120
         and coalesce(char_length(delivery_city), 0) <= 120
         and coalesce(char_length(delivery_region), 0) <= 120
         and coalesce(char_length(delivery_postal_code), 0) <= 120
         and (delivery_country is null or delivery_country ~ '^[A-Z]{2}$')
         and (delivery_email is null
              or (delivery_email = lower(btrim(delivery_email)) and char_length(delivery_email) <= 254
                  and delivery_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')));

-- The chain cannot fork: a statement is superseded at most once. With
-- giving_statements_version_key this is what makes two concurrent re-issues
-- resolve to one winner (the insert guard's own check is not race-safe).
create unique index if not exists giving_statements_supersedes_once_idx
  on giving_statements (supersedes_id) where supersedes_id is not null;
create index if not exists giving_statements_org_year_idx
  on giving_statements (organization_id, tax_year);
-- Serves the NO ACTION check when a blob_assets row is deleted.
create index if not exists giving_statements_blob_idx
  on giving_statements (organization_id, blob_asset_id);

-- ---------------------------------------------------------------------------
-- 2. giving_statement_lines - one per counted gift, frozen with the header
-- ---------------------------------------------------------------------------
create table if not exists giving_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  statement_id uuid not null,
  gift_id uuid not null,
  line_no smallint not null,
  occurred_on date not null,
  fund_label text not null,
  description text not null,
  -- 'cash' | 'non_cash' (non_cash = a stock gift; its value is never printed)
  kind text not null,
  -- the COUNTED amount (gross - reversed - covered fee unless counted); null for non_cash
  amount_cents integer,
  gross_cents integer not null,
  reversed_cents integer not null default 0,
  covered_fee_cents integer not null default 0,
  constraint giving_statement_lines_id_org_key unique (id, organization_id),
  constraint giving_statement_lines_gift_key unique (statement_id, gift_id),
  constraint giving_statement_lines_no_key unique (statement_id, line_no),
  constraint giving_statement_lines_statement_fk foreign key (statement_id, organization_id)
    references giving_statements (id, organization_id),
  constraint giving_statement_lines_gift_fk foreign key (gift_id, organization_id)
    references giving_gifts (id, organization_id)
);

alter table giving_statement_lines drop constraint if exists giving_statement_lines_kind_allowed;
alter table giving_statement_lines add constraint giving_statement_lines_kind_allowed
  check (kind in ('cash', 'non_cash'));
alter table giving_statement_lines drop constraint if exists giving_statement_lines_amount_shape;
alter table giving_statement_lines add constraint giving_statement_lines_amount_shape
  check ((kind = 'cash') = (amount_cents is not null and amount_cents > 0));
alter table giving_statement_lines drop constraint if exists giving_statement_lines_money_shape;
alter table giving_statement_lines add constraint giving_statement_lines_money_shape
  check (gross_cents between 1 and 100000000
         and reversed_cents between 0 and gross_cents
         and covered_fee_cents >= 0 and covered_fee_cents < gross_cents
         and (amount_cents is null or amount_cents <= gross_cents - reversed_cents));
alter table giving_statement_lines drop constraint if exists giving_statement_lines_line_no_positive;
alter table giving_statement_lines add constraint giving_statement_lines_line_no_positive
  check (line_no >= 1);
alter table giving_statement_lines drop constraint if exists giving_statement_lines_text_shape;
alter table giving_statement_lines add constraint giving_statement_lines_text_shape
  check (char_length(fund_label) between 1 and 80 and char_length(description) between 1 and 300);
alter table giving_statement_lines drop constraint if exists giving_statement_lines_occurred_on_floor;
alter table giving_statement_lines add constraint giving_statement_lines_occurred_on_floor
  check (occurred_on >= date '2000-01-01');

create index if not exists giving_statement_lines_gift_idx
  on giving_statement_lines (organization_id, gift_id);

-- ---------------------------------------------------------------------------
-- 3. giving_statement_deliveries - insert-only (print run, portal notice)
-- ---------------------------------------------------------------------------
create table if not exists giving_statement_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  statement_id uuid not null,
  -- 'print_mailed' | 'email_notice'
  channel text not null,
  recorded_by uuid not null references users(id),
  occurred_at timestamptz not null default now(),
  -- plain reference: email_queue is a platform table with no tenant key
  email_queue_id uuid,
  constraint giving_statement_deliveries_id_org_key unique (id, organization_id),
  constraint giving_statement_deliveries_statement_fk foreign key (statement_id, organization_id)
    references giving_statements (id, organization_id)
);

alter table giving_statement_deliveries drop constraint if exists giving_statement_deliveries_channel_allowed;
alter table giving_statement_deliveries add constraint giving_statement_deliveries_channel_allowed
  check (channel in ('print_mailed', 'email_notice'));
alter table giving_statement_deliveries drop constraint if exists giving_statement_deliveries_email_shape;
alter table giving_statement_deliveries add constraint giving_statement_deliveries_email_shape
  check ((channel = 'email_notice') = (email_queue_id is not null));

create index if not exists giving_statement_deliveries_statement_idx
  on giving_statement_deliveries (organization_id, statement_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 4. RLS, grants, comments (0055 section 13's shape)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['giving_statements', 'giving_statement_lines', 'giving_statement_deliveries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
    -- Revoke-then-grant (F38): a re-apply corrects a hand-added grant.
    -- presby_platform receives nothing. NO UPDATE, NO DELETE for anyone.
    execute format('revoke all on %I from presby_app, presby_platform, public', t);
    execute format('grant select, insert on %I to presby_app', t);
  end loop;
end $$;

comment on table giving_statements is
  'An issued year-end contribution statement (DECISION-173): a FROZEN snapshot (donee identity, donor name and delivery address, totals split cash vs non-cash, the code wording version, the covered-fee policy in force) plus the PDF rendered once at issue (DECISION-174), stored through the blob adapter and referenced by a composite NO ACTION FK. presby_app: SELECT, INSERT only. giving_statements_insert_guard checks the issuer (giving.manage AND giving.view), the donor (identified, unmerged - plate cash never receives a statement), the predecessor (same donor and year, version n+1) and the bytes (application/pdf, sha256 = pdf_sha256), and stamps issued_at. The DEFERRED giving_statements_consistency trigger refuses at commit a header that disagrees with its lines or lines that disagree with, or omit, the gift rows. UPDATE always raises; DELETE only within deletable_until or an org teardown (P3-8). Staleness is DERIVED (src/lib/giving/statement-staleness.ts), never stored. Retained at least seven years.';
comment on column giving_statements.version is
  'Version n of this donor''s statement for tax_year. A correction is version n+1 with supersedes_id naming version n (giving_statements_version_key, giving_statements_supersedes_once_idx: the chain never forks). The latest version is the one nothing supersedes.';
comment on column giving_statements.issued_at is
  'Stamped with now() by giving_statements_insert_guard; a caller cannot supply it. A latest statement is stale when a counting gift of its donor-root group in its period was created, became succeeded, gained a reversal, or joined the group by merge after this instant.';
comment on column giving_statements.covered_fee_counted is
  'The COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION constant (src/lib/giving/statement-policy.ts) in force at issue (G10). The consistency check counts each line as gross - reversed - (covered fee unless this is true).';
comment on column giving_statements.blob_asset_id is
  'The stored PDF (blob_assets, through store()). Composite NO ACTION FK: undeletable while referenced; blob_assets_giving_statement_guard refuses any UPDATE of it.';
comment on column giving_statements.deletable_until is
  'Test/fixture exemption only (stamped at insert): the delete guard permits deleting this statement, and its lines and deliveries, while this is in the future.';
comment on table giving_statement_lines is
  'The gifts a statement counts, frozen with it. Each line must equal its gift row at commit (donor-root group, succeeded, livemode, occurred_on in the period, gross/covered fee/net reversed) and the set must be complete (giving_statement_lines_consistency, deferred). kind non_cash is a stock gift: amount_cents null, its value never printed. UPDATE always raises; DELETE only within the parent statement''s deletable_until or an org teardown.';
comment on table giving_statement_deliveries is
  'Insert-only log of how a statement reached the donor: print_mailed (recorded by a giving.manage holder after a print run) or email_notice (a no-amounts portal notice, P3-1; email_queue_id joins email_queue for bounces - statement contents never enter email_queue). occurred_at is stamped by the insert guard.';

-- ---------------------------------------------------------------------------
-- 5. Internal helpers - EXECUTE granted to nobody (section 7)
-- ---------------------------------------------------------------------------

-- Is p_user_id the user of a live person with an ACTIVE membership at p_org
-- who holds EVERY key in p_keys there? presby_has_permission() runs the
-- resolver, which refuses unless presby_current_org() = p_org - callers check
-- the org context first so the refusal is uniform.
create or replace function presby_giving__actor_holds(p_org uuid, p_user_id uuid, p_keys text[])
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from people pe
     where pe.user_id = p_user_id and pe.merged_into_id is null
       and presby_membership_is_active(pe.id, p_org)
       and (select bool_and(presby_has_permission(pe.id, p_org, k)) from unnest(p_keys) k));
$$;

-- The consistency check (deviation S4). Raises check_violation with
-- CONSTRAINT = 'giving_statements_consistency' and one of the reason codes
-- totals_mismatch | line_mismatch | incomplete. Reads every row as the owner
-- (SECURITY DEFINER), so RLS never hides a gift from it (F26).
--
-- It runs once per inserted header and once per inserted line (deferred), and
-- would repeat the same work N+1 times at commit. A transaction-local marker
-- records `<statement id>:<line count>;` for each statement already proven;
-- lines are insert-only, so an unchanged count is an unchanged statement, and
-- a later line (even after SET CONSTRAINTS ... IMMEDIATE) changes the count
-- and is re-checked.
create or replace function presby_giving__check_statement(p_statement uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_donor uuid;
  v_start date;
  v_end date;
  v_counted_fee boolean;
  v_cash_total bigint;
  v_gift_count integer;
  v_non_cash_count integer;
  v_lines integer;
  v_lines_non_cash integer;
  v_lines_cash bigint;
  v_max_no integer;
  v_key text;
  v_seen text;
  v_mismatch integer;
  v_missing integer;
begin
  select s.organization_id, s.donor_id, s.period_start, s.period_end, s.covered_fee_counted,
         s.cash_total_cents, s.gift_count, s.non_cash_count
    into v_org, v_donor, v_start, v_end, v_counted_fee, v_cash_total, v_gift_count, v_non_cash_count
    from giving_statements s
   where s.id = p_statement;
  if not found then
    return;
  end if;

  select count(*), count(*) filter (where l.kind = 'non_cash'),
         coalesce(sum(l.amount_cents) filter (where l.kind = 'cash'), 0), coalesce(max(l.line_no), 0)
    into v_lines, v_lines_non_cash, v_lines_cash, v_max_no
    from giving_statement_lines l
   where l.statement_id = p_statement and l.organization_id = v_org;

  v_key := p_statement::text || ':' || v_lines::text || ';';
  v_seen := coalesce(current_setting('presby.giving_statement_checked', true), '');
  if position(v_key in v_seen) > 0 then
    return;
  end if;

  if v_lines <> v_gift_count or v_lines_non_cash <> v_non_cash_count
     or v_lines_cash <> v_cash_total or v_max_no <> v_lines then
    raise exception 'giving_statement %: inconsistent: totals_mismatch (header % lines / % non-cash / % cents; lines % / % / %)',
      p_statement, v_gift_count, v_non_cash_count, v_cash_total, v_lines, v_lines_non_cash, v_lines_cash
      using errcode = 'check_violation', constraint = 'giving_statements_consistency';
  end if;

  with grp as (
    select d.id from giving_donors d
     where d.organization_id = v_org and (d.id = v_donor or d.merged_into_id = v_donor)),
  truth as (
    select g.id as gift_id, g.occurred_on, g.amount_cents as gross, g.donor_covered_fee_cents as covered,
           case when g.method = 'stock' then 'non_cash' else 'cash' end as kind,
           coalesce((select sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end)
                       from giving_gift_reversals r
                      where r.organization_id = g.organization_id and r.gift_id = g.id), 0) as reversed
      from giving_gifts g
     where g.organization_id = v_org
       and g.donor_id in (select grp.id from grp)
       and g.livemode and g.status = 'succeeded'
       and g.occurred_on between v_start and v_end),
  counted as (
    select t.*, t.gross - t.reversed - case when v_counted_fee then 0 else t.covered end as remaining
      from truth t),
  stmt_lines as (
    select l.* from giving_statement_lines l
     where l.statement_id = p_statement and l.organization_id = v_org)
  select
    (select count(*) from stmt_lines l left join counted c on c.gift_id = l.gift_id
      where c.gift_id is null or c.remaining <= 0
         or l.occurred_on <> c.occurred_on or l.gross_cents <> c.gross
         or l.reversed_cents <> c.reversed or l.covered_fee_cents <> c.covered
         or l.kind <> c.kind
         or (l.kind = 'cash' and l.amount_cents is distinct from c.remaining)),
    (select count(*) from counted c
      where c.remaining > 0 and not exists (select 1 from stmt_lines l where l.gift_id = c.gift_id))
    into v_mismatch, v_missing;

  if v_mismatch > 0 then
    raise exception 'giving_statement %: inconsistent: line_mismatch (% line(s) disagree with their gift rows)',
      p_statement, v_mismatch
      using errcode = 'check_violation', constraint = 'giving_statements_consistency';
  end if;
  if v_missing > 0 then
    raise exception 'giving_statement %: inconsistent: incomplete (% counting gift(s) of the donor in the period are missing)',
      p_statement, v_missing
      using errcode = 'check_violation', constraint = 'giving_statements_consistency';
  end if;

  perform set_config('presby.giving_statement_checked', v_seen || v_key, true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Triggers. SECURITY DEFINER, search_path pinned (DECISION-148); they fire
--    on EVERY connection, the getPlatformDb() owner path included (F44).
-- ---------------------------------------------------------------------------

-- (6a) giving_statements_insert_guard (BEFORE INSERT). Deviations S1-S3.
-- Refusals, in this order (the issuer first, so a caller who may not issue
-- learns nothing about donors):
--   insufficient_privilege 'giving_statement: not permitted'
--   check_violation        'giving_statement: donor_unavailable'   (absent, or merged)
--   check_violation        'giving_statement: donor_unidentified'  (plate cash)
--   check_violation        'giving_statement: supersedes_invalid'  (other donor/year, or version <> n+1)
--   check_violation        'giving_statement: already_superseded'  (the chain would fork)
--   check_violation        'giving_statement: blob_invalid'        (absent, not a PDF, or hash mismatch)
-- A duplicate (donor, year, version) is unique_violation on
-- giving_statements_version_key - the app maps it to `already_issued`.
create or replace function presby_giving_guard_statement_insert()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text;
  v_merged uuid;
  v_prev_donor uuid;
  v_prev_year smallint;
  v_prev_version smallint;
begin
  new.issued_at := now();

  if presby_current_org() is distinct from new.organization_id
     or new.issued_by is null
     or not presby_giving__actor_holds(new.organization_id, new.issued_by, array['giving.manage', 'giving.view']) then
    raise exception 'giving_statement: not permitted' using errcode = 'insufficient_privilege';
  end if;

  select d.kind, d.merged_into_id into v_kind, v_merged
    from giving_donors d
   where d.id = new.donor_id and d.organization_id = new.organization_id;
  if not found or v_merged is not null then
    raise exception 'giving_statement: donor_unavailable' using errcode = 'check_violation';
  end if;
  if v_kind <> 'identified' then
    raise exception 'giving_statement: donor_unidentified' using errcode = 'check_violation';
  end if;

  if new.supersedes_id is not null then
    select s.donor_id, s.tax_year, s.version into v_prev_donor, v_prev_year, v_prev_version
      from giving_statements s
     where s.id = new.supersedes_id and s.organization_id = new.organization_id;
    if not found or v_prev_donor <> new.donor_id or v_prev_year <> new.tax_year
       or new.version <> v_prev_version + 1 then
      raise exception 'giving_statement: supersedes_invalid' using errcode = 'check_violation';
    end if;
    if exists (select 1 from giving_statements s
                where s.supersedes_id = new.supersedes_id and s.organization_id = new.organization_id) then
      raise exception 'giving_statement: already_superseded' using errcode = 'check_violation';
    end if;
  end if;

  if not exists (select 1 from blob_assets b
                  where b.id = new.blob_asset_id and b.organization_id = new.organization_id
                    and b.content_type = 'application/pdf' and b.content_hash = new.pdf_sha256) then
    raise exception 'giving_statement: blob_invalid' using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists giving_statements_insert_guard on giving_statements;
create trigger giving_statements_insert_guard
  before insert on giving_statements
  for each row execute function presby_giving_guard_statement_insert();

-- (6b) The freeze, one body for all three tables. UPDATE always raises. DELETE
-- passes only when (A) the statement's deletable_until (for a line or a
-- delivery: its parent statement's) is in the future, or (B) the parent
-- organizations row is already gone - the sanctioned teardown cascade (P3-8,
-- the same arm as 0055's presby_giving_guard_delete()).
create or replace function presby_giving_guard_statement_freeze()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_until timestamptz;
begin
  if tg_op = 'UPDATE' then
    raise exception '%: an issued statement is frozen; issue a corrected version instead', tg_table_name
      using errcode = 'check_violation';
  end if;
  if tg_table_name = 'giving_statements' then
    v_until := (to_jsonb(old) ->> 'deletable_until')::timestamptz;
  else
    select s.deletable_until into v_until
      from giving_statements s
     where s.id = (to_jsonb(old) ->> 'statement_id')::uuid and s.organization_id = old.organization_id;
  end if;
  if v_until is not null and v_until > now() then
    return old;
  end if;
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception '%: contribution statements are permanent; issue a corrected version instead of deleting', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists giving_statements_freeze on giving_statements;
create trigger giving_statements_freeze
  before update or delete on giving_statements
  for each row execute function presby_giving_guard_statement_freeze();
drop trigger if exists giving_statement_lines_freeze on giving_statement_lines;
create trigger giving_statement_lines_freeze
  before update or delete on giving_statement_lines
  for each row execute function presby_giving_guard_statement_freeze();
drop trigger if exists giving_statement_deliveries_freeze on giving_statement_deliveries;
create trigger giving_statement_deliveries_freeze
  before update or delete on giving_statement_deliveries
  for each row execute function presby_giving_guard_statement_freeze();

-- (6c) The consistency constraint triggers - DEFERRABLE INITIALLY DEFERRED,
-- so a header and its lines are written in any order inside one transaction
-- and checked together at COMMIT (or at SET CONSTRAINTS ... IMMEDIATE). On the
-- header, so a statement with no lines is refused; on each line, so a line
-- added to an existing statement in a later transaction is refused.
create or replace function presby_giving_check_statement_consistency()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'giving_statements' then
    perform presby_giving__check_statement(new.id);
  else
    perform presby_giving__check_statement((to_jsonb(new) ->> 'statement_id')::uuid);
  end if;
  return null;
end $$;

drop trigger if exists giving_statements_consistency on giving_statements;
create constraint trigger giving_statements_consistency
  after insert on giving_statements
  deferrable initially deferred
  for each row execute function presby_giving_check_statement_consistency();
drop trigger if exists giving_statement_lines_consistency on giving_statement_lines;
create constraint trigger giving_statement_lines_consistency
  after insert on giving_statement_lines
  deferrable initially deferred
  for each row execute function presby_giving_check_statement_consistency();

-- (6d) giving_statement_deliveries_insert_guard (BEFORE INSERT): the recorder
-- holds giving.manage at the acting org (deviation S1); occurred_at is
-- stamped (S2).
create or replace function presby_giving_guard_statement_delivery()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  new.occurred_at := now();
  if presby_current_org() is distinct from new.organization_id
     or new.recorded_by is null
     or not presby_giving__actor_holds(new.organization_id, new.recorded_by, array['giving.manage']) then
    raise exception 'giving_statement_delivery: not permitted' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists giving_statement_deliveries_insert_guard on giving_statement_deliveries;
create trigger giving_statement_deliveries_insert_guard
  before insert on giving_statement_deliveries
  for each row execute function presby_giving_guard_statement_delivery();

-- (6e) blob_assets_giving_statement_guard (deviation S3): the bytes of a PDF a
-- statement references are immutable. blob_assets grants presby_app SELECT and
-- INSERT only (drizzle/0016), but the owner - and presby_platform - hold
-- UPDATE; only a trigger binds them. Rows no statement references are
-- untouched by this guard.
create or replace function presby_giving_guard_statement_blob()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from giving_statements s
              where s.blob_asset_id = old.id and s.organization_id = old.organization_id) then
    raise exception 'blob_assets %: the PDF of an issued contribution statement is immutable', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists blob_assets_giving_statement_guard on blob_assets;
create trigger blob_assets_giving_statement_guard
  before update on blob_assets
  for each row execute function presby_giving_guard_statement_blob();

-- ---------------------------------------------------------------------------
-- 7. EXECUTE. Every function this file creates is a trigger function or an
--    internal helper: granted to nobody, PUBLIC's default revoked (0055
--    section 17bb's rule; test-rls-46.sql 46i inventories every
--    presby_giving_* function). Named explicitly - a blanket loop over
--    presby_giving_% here would strip 0055's grants to presby_app.
-- ---------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('presby_giving__actor_holds', 'presby_giving__check_statement',
                         'presby_giving_guard_statement_insert', 'presby_giving_guard_statement_freeze',
                         'presby_giving_check_statement_consistency', 'presby_giving_guard_statement_delivery',
                         'presby_giving_guard_statement_blob')
  loop
    execute format('revoke all on function %s from public, presby_app, presby_platform', f);
  end loop;
end $$;

comment on function presby_giving__check_statement(uuid) is
  'Internal (0056 S4): refuses (check_violation, constraint giving_statements_consistency) a statement whose header disagrees with its lines (totals_mismatch), whose lines disagree with their gift rows (line_mismatch), or which omits a counting gift of its donor-root group in its period (incomplete). Counting: remaining = gross - net reversed - (covered fee unless covered_fee_counted); remaining <= 0 is excluded; method stock is non_cash.';
comment on function presby_giving_guard_statement_insert() is
  'BEFORE INSERT on giving_statements (0056 S1-S3): issuer holds giving.manage AND giving.view at presby_current_org(); donor identified and unmerged; supersedes_id names the same donor and year at version n-1 and has no successor; the blob is this org''s application/pdf whose content_hash equals pdf_sha256. Stamps issued_at.';
comment on function presby_giving_guard_statement_blob() is
  'BEFORE UPDATE on blob_assets (0056 S3): refuses any update of a blob an issued statement references, on every connection.';
