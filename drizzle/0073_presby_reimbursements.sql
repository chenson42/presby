-- drizzle/0073_presby_reimbursements.sql
--
-- Reimbursements, request through paid (Treasury Increment 1): six tables,
-- the triggers that enforce the state machine, separation of duties, history
-- and the no-delete rule on EVERY connection (the owner path included, F44),
-- the downward-role guards for the reimbursement module (F301), and the
-- closed family of SECURITY DEFINER functions that is the ONLY door presby_app
-- has to the request, attachment, payment and event tables.
--
-- docs/work-log/2026-10-25-treasury-inc1.md -> Phase 3 (Data Model, API
-- Contract Layer 1, rulings P3-5..P3-8, P3-10, P3-17, P3-18, P3-21, P3-22),
-- and the parent log's Phase 2 (DECISION-267, DECISION-268, DECISION-269,
-- DECISION-270; F299, F300, F301). Permissions, template bindings and the
-- backfill are drizzle/0074_presby_reimbursement_permissions.sql.
--
-- APPLY (owner, direct/unpooled endpoint - db:generate emits none of this):
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0073_presby_reimbursements.sql
--
-- IDEMPOTENT, WHOLE FILE: `create table if not exists`, drop-then-add for
-- every CHECK and FK, `if not exists` for every index, `create or replace`
-- for every function, drop-then-create for every trigger, and
-- revoke-then-grant. Proven by applying the whole file twice (work-log,
-- Phase 4 Batch 1a). Unreleased until shipped, so it may be corrected in
-- place until then (CLAUDE.md -> Project Layout -> drizzle/).
--
-- DEPENDENCY ON drizzle/0072 (F289, DECISION-277) - BATCH 1b.
--   The receipt FK (reimbursement_attachments.blob_key, organization_id,
--   asset_audience) -> blob_assets (id, organization_id, audience) targets a
--   unique key that only 0072 creates. Batch 1a (this text) creates the
--   attachments table with the asset_audience column and its `= 'private'`
--   CHECK but WITHOUT that FK; section 1d carries the marked TODO where Batch
--   1b adds the FK and the guard that raises
--     'reimbursement 0073: apply 0072 (blob_assets audience) first'
--   when blob_assets_id_org_audience_key is absent. Until then
--   presby_reimbursement_attach_receipt() checks that the blob exists at the
--   acting organization with the stated content type and size (D7).
--
-- Sections, in dependency order:
--    1. tables (1a chargeable groups, 1b categories, 1c requests,
--       1d attachments, 1e payments, 1f events)
--    2. RLS (ENABLE + FORCE + tenant_isolation), grants, comments
--    3. internal helpers (EXECUTE revoked from everyone)
--    4. triggers (delete, insert, transition/freeze, attachments, payments,
--       events, config, the two deferred constraint triggers)
--    5. F301: reimbursement keys never travel a commission or delegation
--    6. the identity literal (presby_deny_reimbursement)
--    7. write definers
--    8. read definers
--    9. EXECUTE grants
--
-- GRANTS (DECISION-267). presby_app holds SELECT on the two configuration
-- tables and NOTHING on requests, attachments, payments or events; every read
-- and write of those goes through a presby_reimbursement_* definer that
-- derives the organization from presby_current_org() and carries an explicit
-- organization_id predicate (the owner bypasses RLS, so the predicate IS the
-- isolation). presby_platform holds nothing. No role holds DELETE.
--
-- DEVIATIONS FROM THE PHASE 3 TEXT (named; each within the design's intent;
-- recorded in the work-log's Phase 4 Batch 1a notes):
--   (D1) A WITHDRAWN request may be incomplete. "A discarded draft is
--        withdrawn" (Phase 2), so the completeness CHECK and the vendor-name
--        rule admit status in ('draft', 'withdrawn'), not 'draft' alone; a
--        request that was ever submitted was complete when it was.
--   (D2) An eligible approver and an effective key holder must have an
--        ACTIVE user account (people.user_id set, users.is_active). A chair
--        or treasurer who cannot sign in can never act; counting them would
--        route a request to a seat nobody can fill and would block the
--        override path forever (residual 5 made worse).
--   (D3) A payment row admits a null payer only for an origin = 'import'
--        request (the R13 import door, enforced in the payment trigger
--        because a CHECK cannot read the request).
--   (D4) Outcome additions beyond the Phase 3 lists, each the honest answer
--        to a case the list did not name: submit `not_editable` (withdrawn
--        or voided); withdraw, void and reverse `reason_too_long`; waive,
--        record and note `note_too_long`; attach `invalid_shape`. Extra
--        return COLUMNS (never fewer): submit `missing`; approve and return
--        `current_status` (so "already approved" and "already sent back"
--        can be told apart); return `decided_on` and the requester id for
--        the notice; record_payment `payment_id` and `self_paid`.
--   (D5) A pay holder cannot waive the receipt on, or send back / mark not
--        approved, a request they created or are paid by (`not_waivable`,
--        `not_returnable`). Same separation-of-duties reasoning as approval.
--   (D6) "Another payer" (record_payment's needs_another_payer) is a pay
--        holder who could actually pay THIS request: not the actor, not the
--        approver in force, not the creator, not the beneficiary. "A second
--        payer" (override's needs_second_payer) is a pay holder who is not
--        the actor (Q6 as written).
--   (D7) See DEPENDENCY above: the blob check in attach_receipt stands in for
--        the FK until Batch 1b.
--   (D8) (0074) the closing assertion's scope; see that file.
--   (D9) reimbursement_events.seq (identity): events written in one
--        transaction share created_at = now(), so history is ordered by
--        (created_at, seq), not (created_at, id); the index is
--        (request_id, created_at, seq).
--
-- CONVENTIONS FOR EVERY DEFINER (0055/0062 shape): security definer,
-- search_path = public, pg_temp (DECISION-148); p_actor is a users.id bound
-- server-side from the session, LAST in the list; an identity refusal (no
-- live unmerged person with an active membership at the org, or a missing
-- required key) raises insufficient_privilege with the ONE literal
-- 'reimbursement: not permitted'; a state refusal is an `outcome` from a
-- closed list; a missing request and a forbidden one are both `not_found`
-- (same path, same reads); every write locks the request row FOR UPDATE
-- first. Free text goes through presby_reimbursement__clean_text and an
-- over-length value is a named outcome, never a truncation.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- 1a. Groups a request may be charged to (R9: an explicit list, never
-- inferred). Ended, never deleted; re-adding a group inserts a new row.
create table if not exists reimbursement_chargeable_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null,
  created_by_user uuid not null references users(id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_user uuid references users(id),
  constraint reimbursement_chargeable_groups_id_org_key unique (id, organization_id),
  constraint reimbursement_chargeable_groups_group_fk foreign key (group_id, organization_id)
    references groups (id, organization_id)
);

alter table reimbursement_chargeable_groups drop constraint if exists reimbursement_chargeable_groups_end_shape;
alter table reimbursement_chargeable_groups add constraint reimbursement_chargeable_groups_end_shape
  check ((ended_at is null) = (ended_by_user is null));

create unique index if not exists reimbursement_chargeable_groups_one_active_idx
  on reimbursement_chargeable_groups (organization_id, group_id) where ended_at is null;

-- 1b. One category list per organization (P3-4). A retired category stays
-- on the requests that carry it.
create table if not exists reimbursement_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_by_user uuid not null references users(id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_user uuid references users(id),
  constraint reimbursement_categories_id_org_key unique (id, organization_id)
);

alter table reimbursement_categories drop constraint if exists reimbursement_categories_name_shape;
alter table reimbursement_categories add constraint reimbursement_categories_name_shape
  check (char_length(name) between 1 and 60 and name = btrim(name));
alter table reimbursement_categories drop constraint if exists reimbursement_categories_end_shape;
alter table reimbursement_categories add constraint reimbursement_categories_end_shape
  check ((ended_at is null) = (ended_by_user is null));

create unique index if not exists reimbursement_categories_active_name_idx
  on reimbursement_categories (organization_id, lower(name)) where ended_at is null;

-- 1c. Requests. Money is integer cents (P3-10). The transition table, the
-- freeze rules and the revision counter are the trigger in section 4.
create table if not exists reimbursement_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  origin text not null default 'app',
  kind text not null,
  status text not null default 'draft',
  client_key text,
  created_by_user uuid references users(id),
  created_by_person_id uuid,
  group_id uuid not null,
  category_id uuid,
  beneficiary_person_id uuid,
  vendor_name text,
  amount_cents integer,
  currency text not null default 'usd',
  expense_date date,
  purpose text,
  pre_approved_by_name text,
  no_receipt_claimed boolean not null default false,
  revision integer not null default 1,
  first_submitted_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by_user uuid references users(id),
  approved_by_person_id uuid,
  approval_path text,
  approved_revision integer,
  receipt_waived_at timestamptz,
  receipt_waived_by_user uuid references users(id),
  receipt_waived_by_person_id uuid,
  receipt_waiver_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reimbursement_requests_id_org_key unique (id, organization_id),
  constraint reimbursement_requests_client_key_key unique (organization_id, created_by_user, client_key),
  constraint reimbursement_requests_group_fk foreign key (group_id, organization_id)
    references groups (id, organization_id),
  constraint reimbursement_requests_category_fk foreign key (category_id, organization_id)
    references reimbursement_categories (id, organization_id),
  constraint reimbursement_requests_creator_fk foreign key (created_by_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint reimbursement_requests_beneficiary_fk foreign key (beneficiary_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint reimbursement_requests_approver_fk foreign key (approved_by_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint reimbursement_requests_waiver_person_fk foreign key (receipt_waived_by_person_id, organization_id)
    references memberships (person_id, organization_id)
);

alter table reimbursement_requests drop constraint if exists reimbursement_requests_origin_allowed;
alter table reimbursement_requests add constraint reimbursement_requests_origin_allowed
  check (origin in ('app', 'import'));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_kind_allowed;
alter table reimbursement_requests add constraint reimbursement_requests_kind_allowed
  check (kind in ('reimburse', 'vendor'));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_status_allowed;
alter table reimbursement_requests add constraint reimbursement_requests_status_allowed
  check (status in ('draft', 'submitted', 'returned', 'not_approved', 'approved', 'paid', 'withdrawn', 'voided'));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_client_key_shape;
alter table reimbursement_requests add constraint reimbursement_requests_client_key_shape
  check ((client_key is null or client_key ~ '^[A-Za-z0-9_-]{8,64}$')
         and (origin = 'import' or client_key is not null));
-- The import door (R13): only an imported row may have no creator.
alter table reimbursement_requests drop constraint if exists reimbursement_requests_creator_shape;
alter table reimbursement_requests add constraint reimbursement_requests_creator_shape
  check (origin = 'import' or (created_by_user is not null and created_by_person_id is not null));
-- Laundering is unrepresentable (DECISION-268): reimburse has exactly one
-- person payee; vendor has no person payee.
alter table reimbursement_requests drop constraint if exists reimbursement_requests_kind_shape;
alter table reimbursement_requests add constraint reimbursement_requests_kind_shape
  check ((kind = 'reimburse' and beneficiary_person_id is not null and vendor_name is null)
         or (kind = 'vendor' and beneficiary_person_id is null
             and (vendor_name is not null or status in ('draft', 'withdrawn'))));
-- D1: a draft, or a discarded draft, may be incomplete.
alter table reimbursement_requests drop constraint if exists reimbursement_requests_complete_shape;
alter table reimbursement_requests add constraint reimbursement_requests_complete_shape
  check (status in ('draft', 'withdrawn')
         or (amount_cents is not null and expense_date is not null and purpose is not null));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_amount_range;
alter table reimbursement_requests add constraint reimbursement_requests_amount_range
  check (amount_cents is null or amount_cents between 1 and 10000000);
alter table reimbursement_requests drop constraint if exists reimbursement_requests_currency_usd;
alter table reimbursement_requests add constraint reimbursement_requests_currency_usd
  check (currency = 'usd');
alter table reimbursement_requests drop constraint if exists reimbursement_requests_expense_date_floor;
alter table reimbursement_requests add constraint reimbursement_requests_expense_date_floor
  check (expense_date is null or expense_date >= date '2000-01-01');
alter table reimbursement_requests drop constraint if exists reimbursement_requests_text_bounds;
alter table reimbursement_requests add constraint reimbursement_requests_text_bounds
  check ((vendor_name is null or char_length(vendor_name) between 1 and 120)
         and (purpose is null or char_length(purpose) between 1 and 500)
         and (pre_approved_by_name is null or char_length(pre_approved_by_name) between 1 and 80)
         and (receipt_waiver_note is null or char_length(receipt_waiver_note) between 1 and 300));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_revision_positive;
alter table reimbursement_requests add constraint reimbursement_requests_revision_positive
  check (revision >= 1 and (approved_revision is null or approved_revision >= 1));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_submission_shape;
alter table reimbursement_requests add constraint reimbursement_requests_submission_shape
  check ((first_submitted_at is null) = (submitted_at is null)
         and (status <> 'draft' or first_submitted_at is null)
         and (origin = 'import' or status in ('draft', 'withdrawn') or first_submitted_at is not null));
-- The approval in force: all or nothing, and present exactly while approved
-- or paid. An imported row may carry an approval with no known actor.
alter table reimbursement_requests drop constraint if exists reimbursement_requests_approval_shape;
alter table reimbursement_requests add constraint reimbursement_requests_approval_shape
  check (((approved_at is null and approved_by_user is null and approved_by_person_id is null
           and approval_path is null and approved_revision is null)
          or (approved_at is not null and approved_revision is not null
              and (origin = 'import'
                   or (approved_by_user is not null and approved_by_person_id is not null
                       and approval_path is not null))))
         and (approval_path is null or approval_path in ('seat', 'override'))
         and ((approved_at is not null) = (status in ('approved', 'paid'))));
alter table reimbursement_requests drop constraint if exists reimbursement_requests_waiver_shape;
alter table reimbursement_requests add constraint reimbursement_requests_waiver_shape
  check (((receipt_waived_at is null and receipt_waived_by_user is null
           and receipt_waived_by_person_id is null and receipt_waiver_note is null)
          or (receipt_waived_at is not null
              and (origin = 'import'
                   or (receipt_waived_by_user is not null and receipt_waived_by_person_id is not null))))
         and (receipt_waived_at is null or status in ('submitted', 'approved', 'paid')));

create index if not exists reimbursement_requests_approved_idx
  on reimbursement_requests (organization_id, status, approved_at) where status = 'approved';
create index if not exists reimbursement_requests_status_idx
  on reimbursement_requests (organization_id, status, submitted_at);
create index if not exists reimbursement_requests_creator_idx
  on reimbursement_requests (organization_id, created_by_user, created_at desc);
create index if not exists reimbursement_requests_beneficiary_idx
  on reimbursement_requests (organization_id, beneficiary_person_id) where beneficiary_person_id is not null;
create index if not exists reimbursement_requests_group_idx
  on reimbursement_requests (organization_id, group_id, status);

-- 1d. Receipts. blob_key names a PRIVATE blob (DECISION-270/277): the
-- asset_audience column is a constant 'private', carried so the composite FK
-- below can only ever point at a private blob_assets row.
create table if not exists reimbursement_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null,
  blob_key uuid not null,
  asset_audience text not null default 'private',
  content_sha256 text not null,
  content_type text not null,
  byte_size integer not null,
  display_name text not null,
  created_by_user uuid not null references users(id),
  created_at timestamptz not null default now(),
  detached_at timestamptz,
  detached_by_user uuid references users(id),
  constraint reimbursement_attachments_id_org_key unique (id, organization_id),
  constraint reimbursement_attachments_request_fk foreign key (request_id, organization_id)
    references reimbursement_requests (id, organization_id)
);

alter table reimbursement_attachments drop constraint if exists reimbursement_attachments_asset_audience_private;
alter table reimbursement_attachments add constraint reimbursement_attachments_asset_audience_private
  check (asset_audience = 'private');
alter table reimbursement_attachments drop constraint if exists reimbursement_attachments_sha_shape;
alter table reimbursement_attachments add constraint reimbursement_attachments_sha_shape
  check (content_sha256 ~ '^[0-9a-f]{64}$');
alter table reimbursement_attachments drop constraint if exists reimbursement_attachments_content_type_allowed;
alter table reimbursement_attachments add constraint reimbursement_attachments_content_type_allowed
  check (content_type in ('image/jpeg', 'application/pdf'));
alter table reimbursement_attachments drop constraint if exists reimbursement_attachments_byte_size_range;
alter table reimbursement_attachments add constraint reimbursement_attachments_byte_size_range
  check (byte_size between 1 and 4000000);
alter table reimbursement_attachments drop constraint if exists reimbursement_attachments_display_name_shape;
alter table reimbursement_attachments add constraint reimbursement_attachments_display_name_shape
  check (char_length(display_name) between 1 and 80 and display_name = btrim(display_name)
         and display_name !~ '[/\\[:cntrl:]]');
alter table reimbursement_attachments drop constraint if exists reimbursement_attachments_detach_shape;
alter table reimbursement_attachments add constraint reimbursement_attachments_detach_shape
  check ((detached_at is null) = (detached_by_user is null));

-- TODO(Batch 1b, F289 / drizzle/0072, DECISION-277): add here, in this order,
--   (1) the dependency guard - a DO block that raises
--       'reimbursement 0073: apply 0072 (blob_assets audience) first'
--       unless pg_constraint has blob_assets_id_org_audience_key;
--   (2) the composite FK reimbursement_attachments_blob_fk
--         (blob_key, organization_id, asset_audience)
--         -> blob_assets (id, organization_id, audience),
--       NO ACTION on delete and update, as the usual drop-if-exists /
--       add-constraint pair (so a referenced receipt is undeletable on every
--       connection, F44);
--   and the catalog assertions (constraint name, the three columns,
--   confdeltype = 'a') in reimbursement.db.test.ts and test-rls-73.sql.
--   Until then presby_reimbursement_attach_receipt() checks the blob exists
--   at the acting organization (D7). The Drizzle mirror's foreignKey() lands
--   with the FK (it needs F289's blob_assets.audience column in assets.ts).

create unique index if not exists reimbursement_attachments_live_sha_idx
  on reimbursement_attachments (request_id, content_sha256) where detached_at is null;
create index if not exists reimbursement_attachments_org_sha_idx
  on reimbursement_attachments (organization_id, content_sha256) where detached_at is null;
create index if not exists reimbursement_attachments_request_idx
  on reimbursement_attachments (request_id) where detached_at is null;

-- 1e. Payments: insert-only, one row per payment and one per reversal, so a
-- later ledger journal entry can composite-FK to (id, organization_id) (R8).
-- No fund or account column until Increment 5.
create table if not exists reimbursement_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null,
  kind text not null,
  method text,
  reference text,
  paid_on date,
  amount_cents integer not null,
  paid_by_user uuid references users(id),
  paid_by_person_id uuid,
  self_paid boolean not null default false,
  note text,
  offsets_payment_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  constraint reimbursement_payments_id_org_key unique (id, organization_id),
  constraint reimbursement_payments_request_fk foreign key (request_id, organization_id)
    references reimbursement_requests (id, organization_id),
  constraint reimbursement_payments_payer_fk foreign key (paid_by_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint reimbursement_payments_offsets_fk foreign key (offsets_payment_id, organization_id)
    references reimbursement_payments (id, organization_id)
);

alter table reimbursement_payments drop constraint if exists reimbursement_payments_kind_allowed;
alter table reimbursement_payments add constraint reimbursement_payments_kind_allowed
  check (kind in ('payment', 'reversal'));
alter table reimbursement_payments drop constraint if exists reimbursement_payments_method_allowed;
alter table reimbursement_payments add constraint reimbursement_payments_method_allowed
  check (method is null or method in ('check', 'ach', 'cash', 'other'));
alter table reimbursement_payments drop constraint if exists reimbursement_payments_shape;
alter table reimbursement_payments add constraint reimbursement_payments_shape
  check ((kind = 'payment' and method is not null and paid_on is not null
          and offsets_payment_id is null and reason is null)
         or (kind = 'reversal' and offsets_payment_id is not null and reason is not null
             and method is null and reference is null and paid_on is null));
-- The Lions lesson: an unmatchable check payment is refused.
alter table reimbursement_payments drop constraint if exists reimbursement_payments_check_reference;
alter table reimbursement_payments add constraint reimbursement_payments_check_reference
  check (method is distinct from 'check' or reference is not null);
alter table reimbursement_payments drop constraint if exists reimbursement_payments_amount_positive;
alter table reimbursement_payments add constraint reimbursement_payments_amount_positive
  check (amount_cents > 0);
alter table reimbursement_payments drop constraint if exists reimbursement_payments_paid_on_floor;
alter table reimbursement_payments add constraint reimbursement_payments_paid_on_floor
  check (paid_on is null or paid_on >= date '2000-01-01');
alter table reimbursement_payments drop constraint if exists reimbursement_payments_text_bounds;
alter table reimbursement_payments add constraint reimbursement_payments_text_bounds
  check ((reference is null or char_length(reference) between 1 and 40)
         and (note is null or char_length(note) between 1 and 300)
         and (reason is null or char_length(reason) between 1 and 300));
alter table reimbursement_payments drop constraint if exists reimbursement_payments_payer_shape;
alter table reimbursement_payments add constraint reimbursement_payments_payer_shape
  check ((paid_by_user is null) = (paid_by_person_id is null));

create unique index if not exists reimbursement_payments_one_reversal_idx
  on reimbursement_payments (offsets_payment_id) where kind = 'reversal';
create index if not exists reimbursement_payments_request_idx
  on reimbursement_payments (organization_id, request_id);

-- 1f. History: insert-only.
create table if not exists reimbursement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null,
  kind text not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid references users(id),
  actor_person_id uuid,
  note text,
  request_revision integer not null,
  payment_id uuid,
  created_at timestamptz not null default now(),
  -- Write order. created_at is the transaction's now() (the deferred event
  -- check matches on it), so several events of one transaction tie on it;
  -- seq orders them (D9).
  seq bigint generated always as identity,
  constraint reimbursement_events_id_org_key unique (id, organization_id),
  constraint reimbursement_events_request_fk foreign key (request_id, organization_id)
    references reimbursement_requests (id, organization_id),
  constraint reimbursement_events_actor_fk foreign key (actor_person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint reimbursement_events_payment_fk foreign key (payment_id, organization_id)
    references reimbursement_payments (id, organization_id)
);

alter table reimbursement_events drop constraint if exists reimbursement_events_kind_allowed;
alter table reimbursement_events add constraint reimbursement_events_kind_allowed
  check (kind in ('created', 'submitted', 'resubmitted', 'approved', 'override_approved', 'returned',
                  'not_approved', 'withdrawn', 'voided', 'receipt_waived', 'payment_recorded',
                  'payment_reversed', 'note', 'imported'));
alter table reimbursement_events drop constraint if exists reimbursement_events_status_allowed;
alter table reimbursement_events add constraint reimbursement_events_status_allowed
  check ((from_status is null or from_status in ('draft', 'submitted', 'returned', 'not_approved',
                                                 'approved', 'paid', 'withdrawn', 'voided'))
         and to_status in ('draft', 'submitted', 'returned', 'not_approved',
                           'approved', 'paid', 'withdrawn', 'voided'));
alter table reimbursement_events drop constraint if exists reimbursement_events_actor_shape;
alter table reimbursement_events add constraint reimbursement_events_actor_shape
  check (kind = 'imported' or (actor_user_id is not null and actor_person_id is not null));
alter table reimbursement_events drop constraint if exists reimbursement_events_note_bounds;
alter table reimbursement_events add constraint reimbursement_events_note_bounds
  check (note is null or char_length(note) between 1 and 500);
alter table reimbursement_events drop constraint if exists reimbursement_events_revision_positive;
alter table reimbursement_events add constraint reimbursement_events_revision_positive
  check (request_revision >= 1);

-- Idempotent restatement: keeps a database that applied an earlier in-place
-- draft of this unreleased file (to_status nullable) in step.
alter table reimbursement_events alter column to_status set not null;
alter table reimbursement_events add column if not exists seq bigint generated always as identity;

drop index if exists reimbursement_events_request_idx;
create index if not exists reimbursement_events_request_seq_idx
  on reimbursement_events (request_id, created_at, seq);

-- ---------------------------------------------------------------------------
-- 2. RLS, grants, comments
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  reimbursement_tables text[] := array[
    'reimbursement_chargeable_groups', 'reimbursement_categories', 'reimbursement_requests',
    'reimbursement_attachments', 'reimbursement_payments', 'reimbursement_events'];
begin
  foreach t in array reimbursement_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
    -- Revoke-then-grant (F38: assert, do not assume). REVOKE ALL also
    -- revokes column-level privileges. No DELETE for anyone: the org-teardown
    -- cascade runs as the table owner and needs no grant.
    execute format('revoke all on %I from presby_app, presby_platform, public', t);
  end loop;
end $$;

grant select on reimbursement_chargeable_groups to presby_app;
grant select on reimbursement_categories to presby_app;
-- reimbursement_requests, _attachments, _payments, _events: NOTHING
-- (DECISION-267; Phase 2 "return to Phase 2 if presby_app needs a privilege").

comment on table reimbursement_chargeable_groups is
  'drizzle/0073: groups a reimbursement request may be charged to (R9: an explicit list, never inferred from group type or privacy). Ended (ended_at/ended_by_user), never deleted; re-adding a group inserts a new row (one active row per group). presby_app holds SELECT; writes go through presby_reimbursement_set_chargeable() (reimbursement.manage).';
comment on table reimbursement_categories is
  'drizzle/0073: one category list per organization (P3-4); required at submit while the organization has any active category. Retired (ended_at), never deleted; a retired category stays on the requests that carry it. presby_app holds SELECT; writes through presby_reimbursement_save_category()/_end_category() (reimbursement.manage).';
comment on table reimbursement_requests is
  'drizzle/0073: a reimbursement or vendor-payment request (DECISION-267). presby_app holds NO privilege: every read and write is a presby_reimbursement_* SECURITY DEFINER function. The transition table, freeze rules, revision counter and the approver separation of duties are reimbursement_requests_update_guard, on every connection (F44). origin = ''import'' is the R13 door (null actors, born in any status); the importer is not built. amount_cents is integer cents, 1..10,000,000.';
comment on column reimbursement_requests.revision is
  'Starts at 1; incremented by trigger on any change to an editable column and on every receipt attach or detach, only while draft or returned (P3-8). Approve carries the revision the approver saw (approved_revision).';
comment on column reimbursement_requests.beneficiary_person_id is
  'The payee when kind = reimburse (exactly one person; laundering has nowhere to hide, DECISION-268). Null when kind = vendor.';
comment on table reimbursement_attachments is
  'drizzle/0073: a receipt on a request. blob_key names a PRIVATE blob_assets row (asset_audience is the constant ''private''; the composite FK into blob_assets(id, organization_id, audience) is added in Batch 1b once drizzle/0072 exists). content_sha256 is the hash of the bytes as RECEIVED (before re-encoding), for the duplicate flag (P3-21); never joined through blob_assets (DECISION-030). Detached (detached_at), never deleted; insert and detach only while the request is draft or returned (reimbursement_attachments_write_guard). presby_app holds NO privilege.';
comment on table reimbursement_payments is
  'drizzle/0073: insert-only payments and reversals (one reversal per payment). self_paid is DERIVED by reimbursement_payments_write_guard (payer is the creator or beneficiary, merge-resolved); the caller never supplies it. The trigger refuses a payment by the approver in force. UPDATE always raises. presby_app holds NO privilege.';
comment on table reimbursement_events is
  'drizzle/0073: insert-only request history. Every status change has an event in the same transaction (deferred constraint trigger reimbursement_requests_status_has_event). Actors are null only for kind = imported. UPDATE always raises. presby_app holds NO privilege.';

-- ---------------------------------------------------------------------------
-- 3. Internal helpers. Called only from the definers and triggers below:
--    EXECUTE is revoked from everyone (drizzle/0044 B-M1). Each is SECURITY
--    DEFINER with search_path pinned, so it reads the whole truth (F26).
-- ---------------------------------------------------------------------------

-- 3a. Free text: NFC; tab, newline and other line breaks become spaces;
-- every other control character, bidi control and zero-width character is
-- removed; runs of whitespace collapse to one space; trimmed; empty is null.
-- The TypeScript twin (src/lib/reimbursement/text.ts, Batch 2a) must do
-- exactly this, in this order.
create or replace function presby_reimbursement__clean_text(p_value text)
returns text language sql immutable security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(normalize(coalesce(p_value, ''), NFC),
                              '[\u0009-\u000D\u0085  ]', ' ', 'g'),
               '[\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F​-‏‪-‮⁠-⁩﻿]',
               '', 'g'),
             '\s+', ' ', 'g')), '');
$$;

-- 3b. The organization-local date of an instant (F132: a missing settings
-- row means America/New_York).
create or replace function presby_reimbursement__local_date(p_org uuid, p_at timestamptz)
returns date language sql stable security definer
set search_path = public, pg_temp
as $$
  select (p_at at time zone coalesce(
            (select s.time_zone from organization_settings s where s.organization_id = p_org),
            'America/New_York'))::date;
$$;

-- 3c. Follow merged_into_id to the surviving person (bounded depth).
create or replace function presby_reimbursement__resolve_person(p_person uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  with recursive chain (id, next_id, depth) as (
    select pe.id, pe.merged_into_id, 0 from people pe where pe.id = p_person
    union all
    select pe.id, pe.merged_into_id, c.depth + 1
      from chain c join people pe on pe.id = c.next_id
     where c.depth < 32
  )
  select c.id from chain c order by c.depth desc limit 1;
$$;

-- 3d. Are (person a, user a) and (person b, user b) the same party for
-- separation of duties (EC13)? Yes when the merge-resolved persons are equal,
-- or when any login on one side (the given user, or the resolved person's
-- user) equals any login on the other. Null on both sides is never "same".
create or replace function presby_reimbursement__same_party(
  p_person_a uuid, p_user_a uuid, p_person_b uuid, p_user_b uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  with a as (select presby_reimbursement__resolve_person(p_person_a) as root),
       b as (select presby_reimbursement__resolve_person(p_person_b) as root),
       ua as (select p_user_a as u union select pe.user_id from people pe, a where pe.id = a.root),
       ub as (select p_user_b as u union select pe.user_id from people pe, b where pe.id = b.root)
  select coalesce((select a.root = b.root from a, b), false)
      or exists (select 1 from ua join ub on ua.u = ub.u);
$$;

-- 3e. A person's display name, merge-resolved.
create or replace function presby_reimbursement__person_name(p_person uuid)
returns text language sql stable security definer
set search_path = public, pg_temp
as $$
  select btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name)
    from people pe where pe.id = presby_reimbursement__resolve_person(p_person);
$$;

-- 3f. The acting user's live person at the organization: unmerged, with an
-- active membership. people.user_id is not unique; the lowest id wins, and
-- every separation-of-duties test compares the USER too (3d), so a second
-- person on one login is never a second party.
create or replace function presby_reimbursement__actor_person(p_org uuid, p_user uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select pe.id from people pe
   where p_user is not null and pe.user_id = p_user and pe.merged_into_id is null
     and presby_membership_is_active(pe.id, p_org)
   order by pe.id
   limit 1;
$$;

-- 3g. The bounded actor claim holds a key (the 0062 presby_roll__actor_holds
-- shape; presby_has_permission requires presby_current_org() = p_org).
create or replace function presby_reimbursement__actor_holds(p_org uuid, p_user uuid, p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from people pe
     where p_user is not null and pe.user_id = p_user and pe.merged_into_id is null
       and presby_membership_is_active(pe.id, p_org)
       and presby_has_permission(pe.id, p_org, p_key));
$$;

-- 3h. May this person file (DECISION-269)? An active membership, unmerged,
-- and on a roll or engaged as regular or staff. Visitors are excluded.
create or replace function presby_reimbursement__is_eligible_requester(p_org uuid, p_person uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from memberships m join people pe on pe.id = m.person_id
     where m.person_id = p_person and m.organization_id = p_org and m.ended_on is null
       and pe.merged_into_id is null
       and (m.current_roll is not null or m.engagement_status in ('regular', 'staff')));
$$;

-- 3i. The seat (DECISION-268): a chair or leader row, in date, on a MANAGED
-- group, held by an unmerged person with an active membership and an active
-- login (D2). Exact-match, fail-closed vocabulary (F300).
create or replace function presby_reimbursement__is_seat(p_org uuid, p_person uuid, p_group uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from groups g
      join group_memberships gm on gm.group_id = g.id and gm.organization_id = g.organization_id
      join people pe on pe.id = gm.person_id
      join users u on u.id = pe.user_id and u.is_active
     where g.id = p_group and g.organization_id = p_org and g.membership_source = 'managed'
       and gm.person_id = p_person
       and gm.group_role in ('chair', 'leader')
       and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
       and pe.merged_into_id is null
       and presby_membership_is_active(pe.id, p_org));
$$;

-- 3j. Effective holders of a key at the organization: the 0060 holder-grants
-- CTE, arms 1 (person) and 2 (group), parameterized by key. The commission
-- and delegation arms are absent by construction: a reimbursement key cannot
-- travel them (section 5, F301). Membership-aware, unmerged, active login (D2).
create or replace function presby_reimbursement__key_holders(p_org uuid, p_key text)
returns table (person_id uuid, user_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with key_grants as (
    select rg.person_id, rg.group_id
      from role_grants rg
     where rg.organization_id = p_org
       and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
       and exists (select 1 from app_role_permissions arp
                    where arp.role_id = rg.role_id and arp.permission_key = p_key)
  ),
  holder_people as (
    select kg.person_id as pid from key_grants kg where kg.person_id is not null
    union
    select gm.person_id from key_grants kg
      join group_memberships gm on gm.group_id = kg.group_id and gm.organization_id = p_org
     where kg.group_id is not null
       and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
  )
  select pe.id, pe.user_id
    from holder_people hp
    join people pe on pe.id = hp.pid
    join users u on u.id = pe.user_id and u.is_active
   where pe.merged_into_id is null
     and presby_membership_is_active(pe.id, p_org);
$$;

-- 3k. Eligible approvers of one request, live: seats on the request's group
-- who are not the creator or the beneficiary (merge-resolved, and by login).
create or replace function presby_reimbursement__eligible_approvers(p_org uuid, p_request uuid)
returns table (person_id uuid, user_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select distinct pe.id, pe.user_id
    from reimbursement_requests r
    join group_memberships gm on gm.group_id = r.group_id and gm.organization_id = r.organization_id
    join people pe on pe.id = gm.person_id
   where r.id = p_request and r.organization_id = p_org
     and presby_reimbursement__is_seat(p_org, pe.id, r.group_id)
     and not presby_reimbursement__same_party(pe.id, pe.user_id, r.created_by_person_id, r.created_by_user)
     and (r.beneficiary_person_id is null
          or not presby_reimbursement__same_party(pe.id, pe.user_id, r.beneficiary_person_id, null));
$$;

-- 3l. Where a submitted request waits, computed live: 'seat' when an eligible
-- approver exists; 'treasurer' when a pay holder who is neither the creator
-- nor the beneficiary exists; otherwise 'nobody'.
create or replace function presby_reimbursement__route(p_org uuid, p_request uuid)
returns text language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from presby_reimbursement__eligible_approvers(p_org, p_request)) then 'seat'
    when exists (
      select 1 from reimbursement_requests r, presby_reimbursement__key_holders(p_org, 'reimbursement.pay') h
       where r.id = p_request and r.organization_id = p_org
         and not presby_reimbursement__same_party(h.person_id, h.user_id, r.created_by_person_id, r.created_by_user)
         and (r.beneficiary_person_id is null
              or not presby_reimbursement__same_party(h.person_id, h.user_id, r.beneficiary_person_id, null)))
      then 'treasurer'
    else 'nobody' end;
$$;

-- 3m. The one viewer rule (DECISION-267). A draft: its creator only. From
-- submitted on: the creator; the beneficiary (with an account); a currently
-- eligible approver of the group (live); a holder of reimbursement.view.
-- Returns 'creator' | 'beneficiary' | 'seat' | 'treasury' | null.
create or replace function presby_reimbursement__viewer_relation(
  p_org uuid, p_user uuid, p_person uuid, p_request uuid)
returns text language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when r.created_by_user is not null and r.created_by_user = p_user then 'creator'
    when r.status = 'draft' then null
    when r.beneficiary_person_id is not null
         and presby_reimbursement__same_party(p_person, p_user, r.beneficiary_person_id, null) then 'beneficiary'
    when exists (select 1 from presby_reimbursement__eligible_approvers(p_org, r.id) a where a.user_id = p_user)
      then 'seat'
    when presby_reimbursement__actor_holds(p_org, p_user, 'reimbursement.view') then 'treasury'
    else null end
    from reimbursement_requests r
   where r.id = p_request and r.organization_id = p_org;
$$;

-- 3n. A live payment: kind = payment and not offset by a reversal.
create or replace function presby_reimbursement__live_payment(p_org uuid, p_request uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id from reimbursement_payments p
   where p.request_id = p_request and p.organization_id = p_org and p.kind = 'payment'
     and not exists (select 1 from reimbursement_payments rv
                      where rv.offsets_payment_id = p.id and rv.kind = 'reversal')
   order by p.created_at desc, p.id
   limit 1;
$$;

-- 3o. Does the request have a live (not detached) receipt?
create or replace function presby_reimbursement__has_receipt(p_org uuid, p_request uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from reimbursement_attachments a
                  where a.request_id = p_request and a.organization_id = p_org and a.detached_at is null);
$$;

-- 3p. Write one history row at the request's current revision.
create or replace function presby_reimbursement__log_event(
  p_org uuid, p_request uuid, p_kind text, p_from text, p_to text,
  p_actor_user uuid, p_actor_person uuid, p_note text, p_payment uuid)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into reimbursement_events (organization_id, request_id, kind, from_status, to_status,
                                    actor_user_id, actor_person_id, note, request_revision, payment_id)
  select p_org, r.id, p_kind, p_from, p_to, p_actor_user, p_actor_person, p_note, r.revision, p_payment
    from reimbursement_requests r where r.id = p_request and r.organization_id = p_org
  returning id into v_id;
  return v_id;
end $$;

-- 3q. The org-local date of the event that put the request in its current
-- decided state: the latest approval for approved/paid, otherwise the latest
-- event whose to_status is the current status.
create or replace function presby_reimbursement__decided_on(p_org uuid, p_request uuid)
returns date language sql stable security definer
set search_path = public, pg_temp
as $$
  select presby_reimbursement__local_date(p_org, e.created_at)
    from reimbursement_requests r
    join reimbursement_events e on e.request_id = r.id and e.organization_id = r.organization_id
   where r.id = p_request and r.organization_id = p_org
     and (case when r.status in ('approved', 'paid') then e.kind in ('approved', 'override_approved')
               else e.to_status = r.status and e.kind not in ('note', 'receipt_waived') end)
   order by e.created_at desc, e.seq desc
   limit 1;
$$;

-- 3r. The shared field validation for save_draft and update_request. Returns
-- the first failing outcome (or 'ok') and the cleaned values. A *_changed
-- flag false skips the "as of now" checks for a value that is not being set
-- (P3-18: the date window applies when a date is set or edited; a group or
-- category that has since been retired stays on a draft that already holds
-- it until submit decides).
create or replace function presby_reimbursement__check_fields(
  p_org uuid, p_actor uuid, p_actor_person uuid,
  p_kind text, p_group_id uuid, p_group_changed boolean,
  p_beneficiary uuid, p_beneficiary_changed boolean,
  p_vendor_name text, p_amount_cents integer,
  p_expense_date date, p_date_changed boolean,
  p_purpose text, p_category_id uuid, p_category_changed boolean,
  p_pre_approved_by text,
  out outcome text, out beneficiary_person_id uuid, out vendor_name text,
  out purpose text, out pre_approved_by_name text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := presby_reimbursement__local_date(p_org, now());
begin
  outcome := 'ok';
  beneficiary_person_id := null;
  vendor_name := presby_reimbursement__clean_text(p_vendor_name);
  purpose := presby_reimbursement__clean_text(p_purpose);
  pre_approved_by_name := presby_reimbursement__clean_text(p_pre_approved_by);

  if p_kind is null or p_kind not in ('reimburse', 'vendor') then
    outcome := 'kind_invalid'; return;
  end if;

  if p_group_id is null
     or not exists (select 1 from groups g where g.id = p_group_id and g.organization_id = p_org)
     or (p_group_changed and not exists (
           select 1 from reimbursement_chargeable_groups c
            where c.organization_id = p_org and c.group_id = p_group_id and c.ended_at is null)) then
    outcome := 'group_not_chargeable'; return;
  end if;

  if p_kind = 'reimburse' then
    if vendor_name is not null then
      outcome := 'invalid_shape'; return;
    end if;
    beneficiary_person_id := coalesce(p_beneficiary, p_actor_person);
    if p_beneficiary_changed
       and not presby_reimbursement__same_party(beneficiary_person_id, null, p_actor_person, p_actor) then
      -- The key first: a caller without it learns nothing about the person.
      if not presby_reimbursement__actor_holds(p_org, p_actor, 'reimbursement.request_for_others') then
        outcome := 'not_allowed_for_others'; return;
      end if;
      if not exists (select 1 from people pe
                      where pe.id = beneficiary_person_id and pe.merged_into_id is null
                        and presby_membership_is_active(pe.id, p_org)) then
        outcome := 'beneficiary_unavailable'; return;
      end if;
    end if;
  else
    if p_beneficiary is not null then
      outcome := 'invalid_shape'; return;
    end if;
    if vendor_name is not null and char_length(vendor_name) > 120 then
      outcome := 'vendor_too_long'; return;
    end if;
  end if;

  if p_amount_cents is not null and (p_amount_cents < 1 or p_amount_cents > 10000000) then
    outcome := 'amount_out_of_range'; return;
  end if;

  if p_expense_date is not null and p_date_changed
     and (p_expense_date > v_today or p_expense_date < v_today - 365) then
    outcome := 'date_out_of_range'; return;
  end if;

  if purpose is not null and char_length(purpose) > 500 then
    outcome := 'purpose_too_long'; return;
  end if;

  if pre_approved_by_name is not null and char_length(pre_approved_by_name) > 80 then
    outcome := 'pre_approved_too_long'; return;
  end if;

  if p_category_id is not null
     and (not exists (select 1 from reimbursement_categories c
                       where c.id = p_category_id and c.organization_id = p_org)
          or (p_category_changed and not exists (
                select 1 from reimbursement_categories c
                 where c.id = p_category_id and c.organization_id = p_org and c.ended_at is null))) then
    outcome := 'category_unavailable'; return;
  end if;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'presby_reimbursement__clean_text(text)',
    'presby_reimbursement__local_date(uuid, timestamptz)',
    'presby_reimbursement__resolve_person(uuid)',
    'presby_reimbursement__same_party(uuid, uuid, uuid, uuid)',
    'presby_reimbursement__person_name(uuid)',
    'presby_reimbursement__actor_person(uuid, uuid)',
    'presby_reimbursement__actor_holds(uuid, uuid, text)',
    'presby_reimbursement__is_eligible_requester(uuid, uuid)',
    'presby_reimbursement__is_seat(uuid, uuid, uuid)',
    'presby_reimbursement__key_holders(uuid, text)',
    'presby_reimbursement__eligible_approvers(uuid, uuid)',
    'presby_reimbursement__route(uuid, uuid)',
    'presby_reimbursement__viewer_relation(uuid, uuid, uuid, uuid)',
    'presby_reimbursement__live_payment(uuid, uuid)',
    'presby_reimbursement__has_receipt(uuid, uuid)',
    'presby_reimbursement__log_event(uuid, uuid, text, text, text, uuid, uuid, text, uuid)',
    'presby_reimbursement__decided_on(uuid, uuid)',
    'presby_reimbursement__check_fields(uuid, uuid, uuid, text, uuid, boolean, uuid, boolean, text, integer, date, boolean, text, uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, presby_app, presby_platform', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Triggers. They fire on EVERY connection: BYPASSRLS and ownership exempt
--    a role from policies and grants, never from triggers (F44). Every
--    function is SECURITY DEFINER with search_path = public, pg_temp.
-- ---------------------------------------------------------------------------

-- 4a. No delete on any of the six tables, owner included, except the
-- organization-teardown cascade: presby_guard_organizations_delete()
-- (drizzle/0044) has already validated the organization's own
-- deletable_until, and the RI cascade fires after the organization row is
-- gone. No deletable_until column is needed here (the e2e fixture
-- organization is removed with one delete from organizations).
create or replace function presby_reimbursement_guard_delete()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception '%: reimbursement records are permanent; withdraw, void, detach, end or reverse instead of deleting', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'reimbursement_chargeable_groups', 'reimbursement_categories', 'reimbursement_requests',
    'reimbursement_attachments', 'reimbursement_payments', 'reimbursement_events'] loop
    execute format('drop trigger if exists %I on %I', t || '_delete_guard', t);
    execute format('create trigger %I before delete on %I for each row execute function presby_reimbursement_guard_delete()',
                   t || '_delete_guard', t);
  end loop;
end $$;

-- 4b. A request is born a draft at revision 1 with no submission, approval
-- or waiver, except an origin = 'import' row (R13), which may be born in any
-- status (its CHECKs still hold).
create or replace function presby_reimbursement_request_insert_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if new.origin = 'import' then
    return new;
  end if;
  if new.status <> 'draft' or new.revision <> 1
     or new.first_submitted_at is not null or new.submitted_at is not null
     or new.approved_at is not null or new.approved_by_user is not null or new.approved_by_person_id is not null
     or new.approval_path is not null or new.approved_revision is not null
     or new.receipt_waived_at is not null or new.receipt_waived_by_user is not null
     or new.receipt_waived_by_person_id is not null or new.receipt_waiver_note is not null then
    raise exception 'reimbursement_requests: a request is born a draft at revision 1 with no submission, approval or waiver'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists reimbursement_requests_insert_guard on reimbursement_requests;
create trigger reimbursement_requests_insert_guard
  before insert on reimbursement_requests
  for each row execute function presby_reimbursement_request_insert_guard();

-- 4c. THE TRANSITION TABLE (DECISION-267), the freeze rules and the revision
-- counter (P3-8), on every connection.
--   draft        -> submitted | withdrawn
--   submitted    -> approved | returned | not_approved | withdrawn | voided
--   returned     -> submitted | withdrawn | voided
--   not_approved -> withdrawn
--   approved     -> paid | returned | withdrawn | voided
--   paid         -> approved            (a payment reversal only)
--   withdrawn, voided: terminal
-- src/lib/reimbursement/states.ts mirrors this list and a test parses it from
-- THIS comment block's arrows; keep the two in step.
create or replace function presby_reimbursement_request_update_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_editable_changed boolean;
  v_live_payment uuid;
begin
  -- Identity never changes.
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.origin is distinct from old.origin or new.client_key is distinct from old.client_key
     or new.created_by_user is distinct from old.created_by_user
     or new.created_by_person_id is distinct from old.created_by_person_id
     or new.currency is distinct from old.currency or new.created_at is distinct from old.created_at then
    raise exception 'reimbursement_requests: identity columns never change'
      using errcode = 'check_violation';
  end if;

  -- Kind, group and payee freeze at the first submission.
  if old.first_submitted_at is not null
     and (new.kind is distinct from old.kind or new.group_id is distinct from old.group_id
          or new.beneficiary_person_id is distinct from old.beneficiary_person_id
          or new.vendor_name is distinct from old.vendor_name) then
    raise exception 'reimbursement_requests: kind, group and payee are frozen once a request has been submitted'
      using errcode = 'check_violation';
  end if;

  v_editable_changed :=
       new.kind is distinct from old.kind or new.group_id is distinct from old.group_id
    or new.beneficiary_person_id is distinct from old.beneficiary_person_id
    or new.vendor_name is distinct from old.vendor_name
    or new.amount_cents is distinct from old.amount_cents
    or new.expense_date is distinct from old.expense_date
    or new.purpose is distinct from old.purpose
    or new.category_id is distinct from old.category_id
    or new.pre_approved_by_name is distinct from old.pre_approved_by_name
    or new.no_receipt_claimed is distinct from old.no_receipt_claimed;

  if v_editable_changed then
    if old.status not in ('draft', 'returned') or new.status is distinct from old.status then
      raise exception 'reimbursement_requests: a request is edited only while draft or returned, and never in the same write as a status change'
        using errcode = 'check_violation';
    end if;
    new.revision := old.revision + 1;
  elsif new.revision is distinct from old.revision then
    -- A receipt attach or detach bumps the revision (4d); nothing else may.
    if old.status not in ('draft', 'returned') or new.status is distinct from old.status
       or new.revision <> old.revision + 1 then
      raise exception 'reimbursement_requests: the revision moves by one, only while draft or returned'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('submitted', 'withdrawn'))
         or (old.status = 'submitted' and new.status in ('approved', 'returned', 'not_approved', 'withdrawn', 'voided'))
         or (old.status = 'returned' and new.status in ('submitted', 'withdrawn', 'voided'))
         or (old.status = 'not_approved' and new.status = 'withdrawn')
         or (old.status = 'approved' and new.status in ('paid', 'returned', 'withdrawn', 'voided'))
         or (old.status = 'paid' and new.status = 'approved')) then
      raise exception 'reimbursement_requests: % -> % is not a permitted transition', old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- The submission stamps are the trigger's, not the caller's.
    if new.status = 'submitted' then
      if not new.no_receipt_claimed and not presby_reimbursement__has_receipt(new.organization_id, new.id) then
        raise exception 'reimbursement_requests: a request is submitted with a receipt or with no_receipt_claimed'
          using errcode = 'check_violation';
      end if;
      new.submitted_at := now();
      new.first_submitted_at := coalesce(old.first_submitted_at, now());
    elsif new.first_submitted_at is distinct from old.first_submitted_at
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'reimbursement_requests: submission stamps change only on submit'
        using errcode = 'check_violation';
    end if;

    if old.status = 'submitted' and new.status = 'approved' then
      -- Separation of duties (DECISION-268), on every connection: the
      -- approver is not the creator or the beneficiary, and approves the
      -- revision in force.
      if new.approved_at is null or new.approved_by_user is null or new.approved_by_person_id is null
         or new.approval_path is null or new.approved_revision is distinct from new.revision then
        raise exception 'reimbursement_requests: an approval names its approver, path and the revision it approves'
          using errcode = 'check_violation';
      end if;
      if presby_reimbursement__same_party(new.approved_by_person_id, new.approved_by_user,
                                          new.created_by_person_id, new.created_by_user)
         or (new.beneficiary_person_id is not null
             and presby_reimbursement__same_party(new.approved_by_person_id, new.approved_by_user,
                                                  new.beneficiary_person_id, null)) then
        raise exception 'reimbursement_requests: no one approves a request they created or are paid by'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.approved_at is distinct from old.approved_at
       or new.approved_by_user is distinct from old.approved_by_user
       or new.approved_by_person_id is distinct from old.approved_by_person_id
       or new.approval_path is distinct from old.approval_path
       or new.approved_revision is distinct from old.approved_revision then
      if new.status in ('approved', 'paid') then
        raise exception 'reimbursement_requests: the approval in force changes only on approve'
          using errcode = 'check_violation';
      end if;
    end if;

    v_live_payment := presby_reimbursement__live_payment(new.organization_id, new.id);
    if new.status = 'paid' and v_live_payment is null then
      raise exception 'reimbursement_requests: a request is paid only with a live payment row'
        using errcode = 'check_violation';
    end if;
    if old.status = 'paid' and v_live_payment is not null then
      raise exception 'reimbursement_requests: a paid request leaves paid only through a payment reversal'
        using errcode = 'check_violation';
    end if;

    -- Leaving approved/paid other than between them clears the approval in
    -- force; leaving submitted/approved/paid for anything else clears the
    -- waiver. The event rows keep the history.
    if new.status not in ('approved', 'paid') then
      new.approved_at := null; new.approved_by_user := null; new.approved_by_person_id := null;
      new.approval_path := null; new.approved_revision := null;
    end if;
    if new.status not in ('submitted', 'approved', 'paid') then
      new.receipt_waived_at := null; new.receipt_waived_by_user := null;
      new.receipt_waived_by_person_id := null; new.receipt_waiver_note := null;
    end if;
  else
    if new.first_submitted_at is distinct from old.first_submitted_at
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at is distinct from old.approved_at
       or new.approved_by_user is distinct from old.approved_by_user
       or new.approved_by_person_id is distinct from old.approved_by_person_id
       or new.approval_path is distinct from old.approval_path
       or new.approved_revision is distinct from old.approved_revision then
      raise exception 'reimbursement_requests: submission and approval stamps change only with a transition'
        using errcode = 'check_violation';
    end if;
  end if;

  -- The waiver is set once, only while submitted or approved, and only by a
  -- write that does not also move the status.
  if old.receipt_waived_at is null and new.receipt_waived_at is not null then
    if new.status is distinct from old.status or new.status not in ('submitted', 'approved') then
      raise exception 'reimbursement_requests: a receipt is waived only while submitted or approved'
        using errcode = 'check_violation';
    end if;
  elsif old.receipt_waived_at is not null and new.receipt_waived_at is not null
     and (new.receipt_waived_at is distinct from old.receipt_waived_at
          or new.receipt_waived_by_user is distinct from old.receipt_waived_by_user
          or new.receipt_waived_by_person_id is distinct from old.receipt_waived_by_person_id
          or new.receipt_waiver_note is distinct from old.receipt_waiver_note) then
    raise exception 'reimbursement_requests: a waiver is set once'
      using errcode = 'check_violation';
  elsif old.receipt_waived_at is not null and new.receipt_waived_at is null
     and new.status in ('submitted', 'approved', 'paid') then
    raise exception 'reimbursement_requests: a waiver is cleared only by leaving submitted, approved and paid'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists reimbursement_requests_update_guard on reimbursement_requests;
create trigger reimbursement_requests_update_guard
  before update on reimbursement_requests
  for each row execute function presby_reimbursement_request_update_guard();

-- 4d. Receipts: attached and detached only while the request is draft or
-- returned, at most 5 live per request (P3-17); a detach sets detached_*
-- once and changes nothing else. Either bumps the request's revision.
create or replace function presby_reimbursement_attachment_write_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select r.status into v_status from reimbursement_requests r
   where r.id = new.request_id and r.organization_id = new.organization_id
   for update;

  if tg_op = 'INSERT' then
    if new.detached_at is not null or new.detached_by_user is not null then
      raise exception 'reimbursement_attachments: a receipt is attached live'
        using errcode = 'check_violation';
    end if;
    if v_status not in ('draft', 'returned') then
      raise exception 'reimbursement_attachments: receipts change only while the request is draft or returned'
        using errcode = 'check_violation';
    end if;
    if (select count(*) from reimbursement_attachments a
         where a.request_id = new.request_id and a.organization_id = new.organization_id
           and a.detached_at is null) >= 5 then
      raise exception 'reimbursement_attachments: at most 5 live receipts per request'
        using errcode = 'check_violation';
    end if;
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.request_id is distinct from old.request_id or new.blob_key is distinct from old.blob_key
       or new.asset_audience is distinct from old.asset_audience
       or new.content_sha256 is distinct from old.content_sha256
       or new.content_type is distinct from old.content_type or new.byte_size is distinct from old.byte_size
       or new.display_name is distinct from old.display_name
       or new.created_by_user is distinct from old.created_by_user
       or new.created_at is distinct from old.created_at
       or old.detached_at is not null or new.detached_at is null then
      raise exception 'reimbursement_attachments: the only change is a one-time detach'
        using errcode = 'check_violation';
    end if;
    if v_status not in ('draft', 'returned') then
      raise exception 'reimbursement_attachments: receipts change only while the request is draft or returned'
        using errcode = 'check_violation';
    end if;
  end if;

  update reimbursement_requests set revision = revision + 1
   where id = new.request_id and organization_id = new.organization_id;
  return new;
end $$;

drop trigger if exists reimbursement_attachments_write_guard on reimbursement_attachments;
create trigger reimbursement_attachments_write_guard
  before insert or update on reimbursement_attachments
  for each row execute function presby_reimbursement_attachment_write_guard();

-- 4e. Payments and reversals: insert-only. A payment needs an approved
-- request, a receipt or a waiver, no live payment already, the request's
-- amount, a date not in the future (org-local) and not before the expense,
-- and a payer who is NOT the approver in force (DECISION-268). self_paid is
-- derived here. A reversal needs a paid request and an un-reversed payment,
-- and carries that payment's amount. An origin = 'import' request may take
-- its payment while already paid, with no receipt and no payer (D3).
create or replace function presby_reimbursement_payment_write_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_r reimbursement_requests%rowtype;
  v_offset reimbursement_payments%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'reimbursement_payments: payments are insert-only; record a reversal instead'
      using errcode = 'check_violation';
  end if;

  select * into v_r from reimbursement_requests r
   where r.id = new.request_id and r.organization_id = new.organization_id
   for update;

  if new.kind = 'payment' then
    if presby_reimbursement__live_payment(new.organization_id, new.request_id) is not null then
      raise exception 'reimbursement_payments: this request already has a live payment'
        using errcode = 'check_violation';
    end if;
    if v_r.origin = 'import' then
      if v_r.status not in ('approved', 'paid') then
        raise exception 'reimbursement_payments: an imported payment needs an approved or paid request'
          using errcode = 'check_violation';
      end if;
    else
      if v_r.status <> 'approved' then
        raise exception 'reimbursement_payments: only an approved request is paid'
          using errcode = 'check_violation';
      end if;
      if new.paid_by_user is null then
        raise exception 'reimbursement_payments: a payment names who recorded it'
          using errcode = 'check_violation';
      end if;
      if v_r.receipt_waived_at is null and not presby_reimbursement__has_receipt(new.organization_id, new.request_id) then
        raise exception 'reimbursement_payments: a payment needs a receipt or a waiver'
          using errcode = 'check_violation';
      end if;
    end if;
    if new.paid_by_user is not null and v_r.approved_by_user is not null
       and presby_reimbursement__same_party(new.paid_by_person_id, new.paid_by_user,
                                            v_r.approved_by_person_id, v_r.approved_by_user) then
      raise exception 'reimbursement_payments: the person who approved a request does not record its payment'
        using errcode = 'insufficient_privilege';
    end if;
    if new.amount_cents is distinct from v_r.amount_cents then
      raise exception 'reimbursement_payments: a payment is the request amount'
        using errcode = 'check_violation';
    end if;
    if new.paid_on > presby_reimbursement__local_date(new.organization_id, now())
       or (v_r.expense_date is not null and new.paid_on < v_r.expense_date) then
      raise exception 'reimbursement_payments: paid_on is not in the future and not before the expense'
        using errcode = 'check_violation';
    end if;
    new.self_paid := new.paid_by_user is not null and (
        presby_reimbursement__same_party(new.paid_by_person_id, new.paid_by_user,
                                         v_r.created_by_person_id, v_r.created_by_user)
        or (v_r.beneficiary_person_id is not null
            and presby_reimbursement__same_party(new.paid_by_person_id, new.paid_by_user,
                                                 v_r.beneficiary_person_id, null)));
  else
    if v_r.status <> 'paid' then
      raise exception 'reimbursement_payments: only a paid request is reversed'
        using errcode = 'check_violation';
    end if;
    if v_r.origin <> 'import' and new.paid_by_user is null then
      raise exception 'reimbursement_payments: a reversal names who recorded it'
        using errcode = 'check_violation';
    end if;
    select * into v_offset from reimbursement_payments p
     where p.id = new.offsets_payment_id and p.organization_id = new.organization_id;
    if not found or v_offset.request_id <> new.request_id or v_offset.kind <> 'payment'
       or exists (select 1 from reimbursement_payments rv
                   where rv.offsets_payment_id = v_offset.id and rv.kind = 'reversal') then
      raise exception 'reimbursement_payments: a reversal offsets one un-reversed payment of the same request'
        using errcode = 'check_violation';
    end if;
    if new.amount_cents is distinct from v_offset.amount_cents then
      raise exception 'reimbursement_payments: a reversal carries the amount of the payment it offsets'
        using errcode = 'check_violation';
    end if;
    new.self_paid := false;
  end if;
  return new;
end $$;

drop trigger if exists reimbursement_payments_write_guard on reimbursement_payments;
create trigger reimbursement_payments_write_guard
  before insert or update on reimbursement_payments
  for each row execute function presby_reimbursement_payment_write_guard();

-- 4f. History is insert-only.
create or replace function presby_reimbursement_event_write_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'reimbursement_events: history is insert-only'
    using errcode = 'check_violation';
end $$;

drop trigger if exists reimbursement_events_write_guard on reimbursement_events;
create trigger reimbursement_events_write_guard
  before update on reimbursement_events
  for each row execute function presby_reimbursement_event_write_guard();

-- 4g. Configuration rows: born live; a chargeable row may only be ended
-- (once); a category may be renamed, reordered, or ended (once), and an
-- ended category changes no more.
create or replace function presby_reimbursement_config_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.ended_at is not null or new.ended_by_user is not null then
      raise exception '%: a configuration row is born live', tg_table_name
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.ended_at is not null then
    raise exception '%: an ended row changes no more', tg_table_name
      using errcode = 'check_violation';
  end if;
  if tg_table_name = 'reimbursement_chargeable_groups' then
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.group_id is distinct from old.group_id or new.created_by_user is distinct from old.created_by_user
       or new.created_at is distinct from old.created_at then
      raise exception 'reimbursement_chargeable_groups: only ended_at and ended_by_user change'
        using errcode = 'check_violation';
    end if;
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.created_by_user is distinct from old.created_by_user
       or new.created_at is distinct from old.created_at then
      raise exception 'reimbursement_categories: only name, sort_order, ended_at and ended_by_user change'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reimbursement_chargeable_groups_config_guard on reimbursement_chargeable_groups;
create trigger reimbursement_chargeable_groups_config_guard
  before insert or update on reimbursement_chargeable_groups
  for each row execute function presby_reimbursement_config_guard();
drop trigger if exists reimbursement_categories_config_guard on reimbursement_categories;
create trigger reimbursement_categories_config_guard
  before insert or update on reimbursement_categories
  for each row execute function presby_reimbursement_config_guard();

-- 4h. DEFERRED: a request is paid if and only if it has a live payment (P3-6).
-- Re-reads the CURRENT row at commit, so the definers' insert-then-flip and
-- reverse-then-flip sequences pass and a lone half fails.
create or replace function presby_reimbursement_status_payment_consistent()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_request uuid;
begin
  -- Separate statements: NEW has no request_id on the requests table, and a
  -- plpgsql expression naming a missing record field fails when planned.
  if tg_table_name = 'reimbursement_requests' then
    v_request := new.id;
  else
    v_request := new.request_id;
  end if;
  select r.status into v_status from reimbursement_requests r
   where r.id = v_request and r.organization_id = new.organization_id;
  if v_status is null then
    return null;
  end if;
  if (v_status = 'paid')
     is distinct from (presby_reimbursement__live_payment(new.organization_id, v_request) is not null) then
    raise exception 'reimbursement: a request is paid if and only if it has a live payment (status %)', v_status
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

drop trigger if exists reimbursement_requests_status_payment_consistent on reimbursement_requests;
create constraint trigger reimbursement_requests_status_payment_consistent
  after insert or update of status on reimbursement_requests
  deferrable initially deferred
  for each row execute function presby_reimbursement_status_payment_consistent();
drop trigger if exists reimbursement_payments_status_payment_consistent on reimbursement_payments;
create constraint trigger reimbursement_payments_status_payment_consistent
  after insert on reimbursement_payments
  deferrable initially deferred
  for each row execute function presby_reimbursement_status_payment_consistent();

-- 4i. DEFERRED: every inserted request, and every status change, has a
-- history event written in the same transaction (created_at = now()) whose
-- to_status is the status that write set (P3-6). Uses NEW, so each step of
-- a multi-step transaction is checked on its own.
create or replace function presby_reimbursement_status_has_event()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from organizations o where o.id = new.organization_id) then
    return null;
  end if;
  if not exists (select 1 from reimbursement_events e
                  where e.request_id = new.id and e.organization_id = new.organization_id
                    and e.to_status = new.status and e.created_at = now()) then
    raise exception 'reimbursement_requests: the move to % has no history event in the same transaction', new.status
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

-- Two triggers: a WHEN clause on an INSERT trigger cannot name OLD.
drop trigger if exists reimbursement_requests_status_has_event on reimbursement_requests;
drop trigger if exists reimbursement_requests_insert_has_event on reimbursement_requests;
create constraint trigger reimbursement_requests_insert_has_event
  after insert on reimbursement_requests
  deferrable initially deferred
  for each row execute function presby_reimbursement_status_has_event();
drop trigger if exists reimbursement_requests_status_has_event_upd on reimbursement_requests;
create constraint trigger reimbursement_requests_status_has_event_upd
  after update of status on reimbursement_requests
  deferrable initially deferred
  for each row
  when (old.status is distinct from new.status)
  execute function presby_reimbursement_status_has_event();

-- ---------------------------------------------------------------------------
-- 5. F301: reimbursement keys never travel the commission or delegation arms
--    (the 0055 section 15 shape for module = 'reimbursement'). SECURITY
--    DEFINER is load-bearing: the role belongs to a different org than the
--    row being written, and app_role_permissions is tenant-RLS'd (F26).
--    Placed before any reimbursement key exists (0074 adds them).
-- ---------------------------------------------------------------------------
create or replace function presby_reimbursement_guard_downward_role()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.role_id is not null and exists (
       select 1 from app_role_permissions rp
         join permissions pm on pm.key = rp.permission_key
        where rp.role_id = new.role_id and pm.module = 'reimbursement') then
    raise exception '%: a role carrying a reimbursement key cannot be granted through an administrative commission or delegation (F301, DECISION-269)', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists administrative_commissions_reimbursement_guard on administrative_commissions;
create trigger administrative_commissions_reimbursement_guard
  before insert or update of role_id on administrative_commissions
  for each row execute function presby_reimbursement_guard_downward_role();
drop trigger if exists org_delegations_reimbursement_guard on org_delegations;
create trigger org_delegations_reimbursement_guard
  before insert or update of role_id on org_delegations
  for each row execute function presby_reimbursement_guard_downward_role();

-- Any reference, not only a current one: re-opening an ended commission by
-- moving its ends_on would not fire the role_id trigger above.
create or replace function presby_reimbursement_guard_role_binding()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from permissions pm where pm.key = new.permission_key and pm.module = 'reimbursement')
     and (exists (select 1 from administrative_commissions ac where ac.role_id = new.role_id)
          or exists (select 1 from org_delegations od where od.role_id = new.role_id)) then
    raise exception 'app_role_permissions: a reimbursement key cannot be bound to a role used by an administrative commission or delegation (F301, DECISION-269)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists app_role_permissions_reimbursement_guard on app_role_permissions;
create trigger app_role_permissions_reimbursement_guard
  before insert or update on app_role_permissions
  for each row execute function presby_reimbursement_guard_role_binding();

-- ---------------------------------------------------------------------------
-- 6. The ONE identity-refusal literal (the 0062 presby_deny_roll_decision
--    shape). Invoker, no search_path pin (it touches no table). presby_app
--    keeps EXECUTE so a non-owner caller sees this literal and never a second
--    "permission denied for function" string.
-- ---------------------------------------------------------------------------
create or replace function presby_deny_reimbursement()
returns void language plpgsql
as $$
begin
  raise exception 'reimbursement: not permitted'
    using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Write definers. Organization from presby_current_org() (verified by
--    withOrgContext); explicit organization_id predicate everywhere (the
--    owner bypasses RLS); request row FOR UPDATE first.
-- ---------------------------------------------------------------------------

-- 7a. Create-or-find a draft by (org, actor, client_key) (P3-5). A found row
-- is returned untouched, so a double tap or a lost reply never creates a
-- second request. Outcomes: ok, invalid_shape, not_eligible, too_many_drafts,
-- then the field outcomes of 3r.
create or replace function presby_reimbursement_save_draft(
  p_client_key text, p_kind text, p_group_id uuid, p_beneficiary_person_id uuid,
  p_vendor_name text, p_amount_cents integer, p_expense_date date, p_purpose text,
  p_category_id uuid, p_pre_approved_by text, p_no_receipt boolean, p_actor uuid)
returns table (outcome text, request_id uuid, revision integer, created boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_existing record;
  v_check record;
  v_id uuid;
begin
  outcome := null; request_id := null; revision := null; created := false;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;

  if p_client_key is null or p_client_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    outcome := 'invalid_shape'; return next; return;
  end if;

  select r.id, r.revision into v_existing from reimbursement_requests r
   where r.organization_id = v_org and r.created_by_user = p_actor and r.client_key = p_client_key;
  if found then
    outcome := 'ok'; request_id := v_existing.id; revision := v_existing.revision;
    return next; return;
  end if;

  if not presby_reimbursement__is_eligible_requester(v_org, v_person) then
    outcome := 'not_eligible'; return next; return;
  end if;

  if (select count(*) from reimbursement_requests r
       where r.organization_id = v_org and r.created_by_user = p_actor and r.status = 'draft') >= 20 then
    outcome := 'too_many_drafts'; return next; return;
  end if;

  select * into v_check from presby_reimbursement__check_fields(
    v_org, p_actor, v_person, p_kind, p_group_id, true, p_beneficiary_person_id, true,
    p_vendor_name, p_amount_cents, p_expense_date, true, p_purpose, p_category_id, true, p_pre_approved_by);
  if v_check.outcome <> 'ok' then
    outcome := v_check.outcome; return next; return;
  end if;

  insert into reimbursement_requests (organization_id, origin, kind, status, client_key,
         created_by_user, created_by_person_id, group_id, category_id, beneficiary_person_id,
         vendor_name, amount_cents, expense_date, purpose, pre_approved_by_name, no_receipt_claimed)
  values (v_org, 'app', p_kind, 'draft', p_client_key, p_actor, v_person, p_group_id, p_category_id,
          v_check.beneficiary_person_id, v_check.vendor_name, p_amount_cents, p_expense_date,
          v_check.purpose, v_check.pre_approved_by_name, coalesce(p_no_receipt, false))
  on conflict (organization_id, created_by_user, client_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- A concurrent save with the same key won the race: report its row.
    select r.id, r.revision into v_existing from reimbursement_requests r
     where r.organization_id = v_org and r.created_by_user = p_actor and r.client_key = p_client_key;
    outcome := 'ok'; request_id := v_existing.id; revision := v_existing.revision;
    return next; return;
  end if;

  perform presby_reimbursement__log_event(v_org, v_id, 'created', null, 'draft', p_actor, v_person, null, null);
  outcome := 'ok'; request_id := v_id; revision := 1; created := true;
  return next;
end $$;

-- 7b. Edit a draft or returned request by id, carrying the revision the
-- creator saw (P3-5, P3-8). Kind, group and payee are frozen once submitted
-- (a change is invalid_shape). Outcomes: ok, not_found, not_editable,
-- changed_since_viewed, then the field outcomes.
create or replace function presby_reimbursement_update_request(
  p_request_id uuid, p_expected_revision integer, p_kind text, p_group_id uuid,
  p_beneficiary_person_id uuid, p_vendor_name text, p_amount_cents integer, p_expense_date date,
  p_purpose text, p_category_id uuid, p_pre_approved_by text, p_no_receipt boolean, p_actor uuid)
returns table (outcome text, revision integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_check record;
  v_ben_given uuid;
  v_rev integer;
begin
  outcome := null; revision := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;

  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.created_by_user is distinct from p_actor then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status not in ('draft', 'returned') then
    outcome := 'not_editable'; revision := v_r.revision; return next; return;
  end if;
  if p_expected_revision is distinct from v_r.revision then
    outcome := 'changed_since_viewed'; revision := v_r.revision; return next; return;
  end if;

  v_ben_given := case when p_kind = 'reimburse' then coalesce(p_beneficiary_person_id, v_person) end;
  if v_r.first_submitted_at is not null
     and (p_kind is distinct from v_r.kind or p_group_id is distinct from v_r.group_id
          or v_ben_given is distinct from v_r.beneficiary_person_id
          or presby_reimbursement__clean_text(p_vendor_name) is distinct from v_r.vendor_name) then
    outcome := 'invalid_shape'; revision := v_r.revision; return next; return;
  end if;

  select * into v_check from presby_reimbursement__check_fields(
    v_org, p_actor, v_person, p_kind,
    p_group_id, p_group_id is distinct from v_r.group_id,
    p_beneficiary_person_id, v_ben_given is distinct from v_r.beneficiary_person_id,
    p_vendor_name, p_amount_cents,
    p_expense_date, p_expense_date is distinct from v_r.expense_date,
    p_purpose, p_category_id, p_category_id is distinct from v_r.category_id,
    p_pre_approved_by);
  if v_check.outcome <> 'ok' then
    outcome := v_check.outcome; revision := v_r.revision; return next; return;
  end if;

  update reimbursement_requests r
     set kind = p_kind, group_id = p_group_id, beneficiary_person_id = v_check.beneficiary_person_id,
         vendor_name = v_check.vendor_name, amount_cents = p_amount_cents, expense_date = p_expense_date,
         purpose = v_check.purpose, category_id = p_category_id,
         pre_approved_by_name = v_check.pre_approved_by_name,
         no_receipt_claimed = coalesce(p_no_receipt, false)
   where r.id = v_r.id and r.organization_id = v_org
  returning r.revision into v_rev;

  outcome := 'ok'; revision := v_rev;
  return next;
end $$;

-- 7c. Submit (or resubmit) by id. Idempotent: a submitted or later request
-- answers already_submitted (TypeScript treats it as success). The route is
-- computed live after the move. Outcomes: ok, already_submitted, not_found,
-- not_editable (withdrawn/voided, D4), changed_since_viewed, not_eligible,
-- incomplete (+ missing), group_not_chargeable (first submission only).
create or replace function presby_reimbursement_submit(
  p_request_id uuid, p_expected_revision integer, p_actor uuid)
returns table (outcome text, route text, notify_person_ids uuid[], group_name text,
               revision integer, missing text[])
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_missing text[] := array[]::text[];
  v_first boolean;
  v_route text;
begin
  outcome := null; route := null; notify_person_ids := array[]::uuid[]; group_name := null;
  revision := null; missing := array[]::text[];
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;

  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.created_by_user is distinct from p_actor then
    outcome := 'not_found'; return next; return;
  end if;
  select g.name into group_name from groups g where g.id = v_r.group_id and g.organization_id = v_org;
  revision := v_r.revision;
  if v_r.status in ('submitted', 'approved', 'paid', 'not_approved') then
    outcome := 'already_submitted'; return next; return;
  end if;
  if v_r.status in ('withdrawn', 'voided') then
    outcome := 'not_editable'; return next; return;
  end if;
  if p_expected_revision is distinct from v_r.revision then
    outcome := 'changed_since_viewed'; return next; return;
  end if;
  if not presby_reimbursement__is_eligible_requester(v_org, v_person) then
    outcome := 'not_eligible'; return next; return;
  end if;

  v_first := v_r.first_submitted_at is null;
  if v_r.amount_cents is null then v_missing := array_append(v_missing, 'amount'); end if;
  if v_r.expense_date is null then v_missing := array_append(v_missing, 'date'); end if;
  if v_r.purpose is null then v_missing := array_append(v_missing, 'purpose'); end if;
  if v_r.kind = 'vendor' and v_r.vendor_name is null then v_missing := array_append(v_missing, 'payee'); end if;
  if exists (select 1 from reimbursement_categories c where c.organization_id = v_org and c.ended_at is null)
     and (v_r.category_id is null
          or (v_first and not exists (select 1 from reimbursement_categories c
                                       where c.id = v_r.category_id and c.organization_id = v_org
                                         and c.ended_at is null))) then
    v_missing := array_append(v_missing, 'category');
  end if;
  if not v_r.no_receipt_claimed and not presby_reimbursement__has_receipt(v_org, v_r.id) then
    v_missing := array_append(v_missing, 'receipt');
  end if;
  if cardinality(v_missing) > 0 then
    outcome := 'incomplete'; missing := v_missing; return next; return;
  end if;

  if v_first and not exists (select 1 from reimbursement_chargeable_groups c
                              where c.organization_id = v_org and c.group_id = v_r.group_id
                                and c.ended_at is null) then
    outcome := 'group_not_chargeable'; return next; return;
  end if;

  update reimbursement_requests r set status = 'submitted'
   where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, case when v_first then 'submitted' else 'resubmitted' end,
                                          v_r.status, 'submitted', p_actor, v_person, null, null);

  v_route := presby_reimbursement__route(v_org, v_r.id);
  route := v_route;
  if v_route = 'seat' then
    select coalesce(array_agg(a.person_id order by a.person_id), array[]::uuid[]) into notify_person_ids
      from presby_reimbursement__eligible_approvers(v_org, v_r.id) a;
  elsif v_route = 'treasurer' then
    select coalesce(array_agg(distinct h.person_id), array[]::uuid[]) into notify_person_ids
      from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h
     where not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.created_by_person_id, v_r.created_by_user)
       and (v_r.beneficiary_person_id is null
            or not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.beneficiary_person_id, null));
  end if;
  outcome := 'ok';
  return next;
end $$;

-- 7d. Withdraw: the creator, or the beneficiary when that person has an
-- account (a draft is the creator's alone). From draft, submitted,
-- returned, not_approved or approved (P3-22). Outcomes: ok, not_found,
-- not_withdrawable, reason_too_long.
create or replace function presby_reimbursement_withdraw(
  p_request_id uuid, p_reason text, p_actor uuid)
returns table (outcome text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_rel text;
  v_reason text := presby_reimbursement__clean_text(p_reason);
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if found then
    v_rel := presby_reimbursement__viewer_relation(v_org, p_actor, v_person, v_r.id);
  end if;
  if v_rel is null or v_rel not in ('creator', 'beneficiary') then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status not in ('draft', 'submitted', 'returned', 'not_approved', 'approved') then
    outcome := 'not_withdrawable'; return next; return;
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    outcome := 'reason_too_long'; return next; return;
  end if;
  update reimbursement_requests r set status = 'withdrawn' where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, 'withdrawn', v_r.status, 'withdrawn',
                                          p_actor, v_person, v_reason, null);
  outcome := 'ok';
  return next;
end $$;

-- 7e. Approve (DECISION-268), on the revision the approver saw.
--   path 'seat': the actor is an eligible approver of the group, now.
--   path 'override': the actor holds reimbursement.pay (identity), no
--   eligible approver exists (seat_holder_exists), the actor is not the
--   creator or beneficiary (not_approvable), and another pay holder exists
--   (needs_second_payer, Q6).
-- Outcomes: ok, not_found, already_decided, not_approvable,
-- changed_since_viewed, seat_holder_exists, needs_second_payer.
create or replace function presby_reimbursement_approve(
  p_request_id uuid, p_expected_revision integer, p_path text, p_actor uuid)
returns table (outcome text, decided_on date, current_status text,
               notify_requester_person_id uuid, notify_pay_person_ids uuid[])
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_found boolean;
  v_rel text;
begin
  outcome := null; decided_on := null; current_status := null;
  notify_requester_person_id := null; notify_pay_person_ids := array[]::uuid[];
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  if p_path = 'override' and not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay') then
    perform presby_deny_reimbursement();
  end if;

  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  v_found := found;
  if v_found then
    v_rel := presby_reimbursement__viewer_relation(v_org, p_actor, v_person, v_r.id);
  end if;
  -- A pay holder on the override path may act without reimbursement.view;
  -- a draft is its creator's alone.
  if not v_found or (v_rel is null and not (p_path = 'override' and v_r.status <> 'draft')) then
    outcome := 'not_found'; return next; return;
  end if;
  current_status := v_r.status;
  if v_r.status in ('approved', 'paid', 'returned', 'not_approved') then
    outcome := 'already_decided'; decided_on := presby_reimbursement__decided_on(v_org, v_r.id);
    return next; return;
  end if;
  if v_r.status <> 'submitted' or p_path is null or p_path not in ('seat', 'override') then
    outcome := 'not_approvable'; return next; return;
  end if;
  if p_expected_revision is distinct from v_r.revision then
    outcome := 'changed_since_viewed'; return next; return;
  end if;

  if p_path = 'seat' then
    if not exists (select 1 from presby_reimbursement__eligible_approvers(v_org, v_r.id) a
                    where a.user_id = p_actor) then
      outcome := 'not_approvable'; return next; return;
    end if;
  else
    if exists (select 1 from presby_reimbursement__eligible_approvers(v_org, v_r.id)) then
      outcome := 'seat_holder_exists'; return next; return;
    end if;
    if presby_reimbursement__same_party(v_person, p_actor, v_r.created_by_person_id, v_r.created_by_user)
       or (v_r.beneficiary_person_id is not null
           and presby_reimbursement__same_party(v_person, p_actor, v_r.beneficiary_person_id, null)) then
      outcome := 'not_approvable'; return next; return;
    end if;
    if not exists (select 1 from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h
                    where not presby_reimbursement__same_party(h.person_id, h.user_id, v_person, p_actor)) then
      outcome := 'needs_second_payer'; return next; return;
    end if;
  end if;

  update reimbursement_requests r
     set status = 'approved', approved_at = now(), approved_by_user = p_actor,
         approved_by_person_id = v_person, approval_path = p_path, approved_revision = v_r.revision
   where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id,
            case when p_path = 'override' then 'override_approved' else 'approved' end,
            'submitted', 'approved', p_actor, v_person, null, null);

  outcome := 'ok';
  current_status := 'approved';
  decided_on := presby_reimbursement__local_date(v_org, now());
  notify_requester_person_id := v_r.created_by_person_id;
  select coalesce(array_agg(distinct h.person_id), array[]::uuid[]) into notify_pay_person_ids
    from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h
   where not presby_reimbursement__same_party(h.person_id, h.user_id, v_person, p_actor);
  return next;
end $$;

-- 7f. Send back (needs_info -> returned) or mark not approved.
--   From submitted: an eligible approver; or a pay holder when no eligible
--   approver exists. From approved: a pay holder, needs_info only.
--   Never the creator or beneficiary (D5).
-- Outcomes: ok, not_found, already_decided, not_returnable,
-- changed_since_viewed, kind_invalid, reason_required, reason_too_long.
create or replace function presby_reimbursement_return(
  p_request_id uuid, p_expected_revision integer, p_kind text, p_reason text, p_actor uuid)
returns table (outcome text, decided_on date, current_status text, notify_requester_person_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_found boolean;
  v_rel text;
  v_pay boolean;
  v_seat boolean;
  v_reason text := presby_reimbursement__clean_text(p_reason);
  v_to text;
begin
  outcome := null; decided_on := null; current_status := null; notify_requester_person_id := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  v_pay := presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay');

  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  v_found := found;
  if v_found then
    v_rel := presby_reimbursement__viewer_relation(v_org, p_actor, v_person, v_r.id);
  end if;
  if not v_found or (v_rel is null and not (v_pay and v_r.status <> 'draft')) then
    outcome := 'not_found'; return next; return;
  end if;
  current_status := v_r.status;
  v_seat := exists (select 1 from presby_reimbursement__eligible_approvers(v_org, v_r.id) a
                     where a.user_id = p_actor);

  if v_r.status in ('returned', 'not_approved', 'paid') or (v_r.status = 'approved' and not v_pay) then
    outcome := 'already_decided'; decided_on := presby_reimbursement__decided_on(v_org, v_r.id);
    return next; return;
  end if;
  if v_r.status not in ('submitted', 'approved') then
    outcome := 'not_returnable'; return next; return;
  end if;
  if p_expected_revision is distinct from v_r.revision then
    outcome := 'changed_since_viewed'; return next; return;
  end if;
  if p_kind is null or p_kind not in ('needs_info', 'not_approved')
     or (v_r.status = 'approved' and p_kind <> 'needs_info') then
    outcome := 'kind_invalid'; return next; return;
  end if;
  if v_reason is null then
    outcome := 'reason_required'; return next; return;
  end if;
  if char_length(v_reason) > 300 then
    outcome := 'reason_too_long'; return next; return;
  end if;
  if presby_reimbursement__same_party(v_person, p_actor, v_r.created_by_person_id, v_r.created_by_user)
     or (v_r.beneficiary_person_id is not null
         and presby_reimbursement__same_party(v_person, p_actor, v_r.beneficiary_person_id, null)) then
    outcome := 'not_returnable'; return next; return;
  end if;
  if v_r.status = 'submitted' and not v_seat
     and not (v_pay and not exists (select 1 from presby_reimbursement__eligible_approvers(v_org, v_r.id))) then
    outcome := 'not_returnable'; return next; return;
  end if;

  v_to := case when p_kind = 'needs_info' then 'returned' else 'not_approved' end;
  update reimbursement_requests r set status = v_to where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, v_to, v_r.status, v_to, p_actor, v_person, v_reason, null);
  outcome := 'ok';
  current_status := v_to;
  decided_on := presby_reimbursement__local_date(v_org, now());
  notify_requester_person_id := v_r.created_by_person_id;
  return next;
end $$;

-- 7g. Void (reimbursement.pay): from submitted, returned or approved.
-- Outcomes: ok, not_found, not_voidable, reason_required, reason_too_long.
create or replace function presby_reimbursement_void(
  p_request_id uuid, p_reason text, p_actor uuid)
returns table (outcome text, notify_requester_person_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_reason text := presby_reimbursement__clean_text(p_reason);
begin
  outcome := null; notify_requester_person_id := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay') then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.status = 'draft' then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status not in ('submitted', 'returned', 'approved') then
    outcome := 'not_voidable'; return next; return;
  end if;
  if v_reason is null then
    outcome := 'reason_required'; return next; return;
  end if;
  if char_length(v_reason) > 300 then
    outcome := 'reason_too_long'; return next; return;
  end if;
  update reimbursement_requests r set status = 'voided' where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, 'voided', v_r.status, 'voided', p_actor, v_person, v_reason, null);
  outcome := 'ok'; notify_requester_person_id := v_r.created_by_person_id;
  return next;
end $$;

-- 7h. Waive the receipt (reimbursement.pay), once, while submitted or
-- approved, when no live receipt exists; never on one's own request (D5).
-- Outcomes: ok, not_found, not_waivable, receipt_present, note_too_long.
create or replace function presby_reimbursement_waive_receipt(
  p_request_id uuid, p_note text, p_actor uuid)
returns table (outcome text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_note text := presby_reimbursement__clean_text(p_note);
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay') then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.status = 'draft' then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status not in ('submitted', 'approved') or v_r.receipt_waived_at is not null
     or presby_reimbursement__same_party(v_person, p_actor, v_r.created_by_person_id, v_r.created_by_user)
     or (v_r.beneficiary_person_id is not null
         and presby_reimbursement__same_party(v_person, p_actor, v_r.beneficiary_person_id, null)) then
    outcome := 'not_waivable'; return next; return;
  end if;
  if presby_reimbursement__has_receipt(v_org, v_r.id) then
    outcome := 'receipt_present'; return next; return;
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    outcome := 'note_too_long'; return next; return;
  end if;
  update reimbursement_requests r
     set receipt_waived_at = now(), receipt_waived_by_user = p_actor,
         receipt_waived_by_person_id = v_person, receipt_waiver_note = v_note
   where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, 'receipt_waived', v_r.status, v_r.status,
                                          p_actor, v_person, v_note, null);
  outcome := 'ok';
  return next;
end $$;

-- 7i. Record the payment (reimbursement.pay; P3-7): insert the payment row,
-- then flip the request to paid, in one transaction. Never the approver in
-- force (payer_is_approver; the trigger refuses it too). The creator or
-- beneficiary may record it only when no other pay holder could (D6:
-- needs_another_payer); the trigger stamps self_paid.
-- Outcomes, in check order: ok, not_found, already_paid, not_payable,
-- method_invalid, reference_required, reference_too_long, date_out_of_range,
-- note_too_long, payer_is_approver, needs_another_payer, receipt_missing.
-- A sole pay holder paying their own request must ATTACH a receipt: nobody
-- else can waive it, and they may not waive their own (D5).
create or replace function presby_reimbursement_record_payment(
  p_request_id uuid, p_method text, p_reference text, p_paid_on date, p_note text, p_actor uuid)
returns table (outcome text, payment_id uuid, self_paid boolean, notify_requester_person_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_reference text := presby_reimbursement__clean_text(p_reference);
  v_note text := presby_reimbursement__clean_text(p_note);
  v_id uuid;
  v_self boolean;
begin
  outcome := null; payment_id := null; self_paid := false; notify_requester_person_id := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay') then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.status = 'draft' then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status = 'paid' then
    outcome := 'already_paid'; return next; return;
  end if;
  if v_r.status <> 'approved' then
    outcome := 'not_payable'; return next; return;
  end if;
  if p_method is null or p_method not in ('check', 'ach', 'cash', 'other') then
    outcome := 'method_invalid'; return next; return;
  end if;
  if p_method = 'check' and v_reference is null then
    outcome := 'reference_required'; return next; return;
  end if;
  if v_reference is not null and char_length(v_reference) > 40 then
    outcome := 'reference_too_long'; return next; return;
  end if;
  if p_paid_on is null or p_paid_on > presby_reimbursement__local_date(v_org, now())
     or p_paid_on < v_r.expense_date then
    outcome := 'date_out_of_range'; return next; return;
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    outcome := 'note_too_long'; return next; return;
  end if;
  -- Who may pay before what is missing: a person who can never record this
  -- payment is told so, not asked for a receipt.
  if presby_reimbursement__same_party(v_person, p_actor, v_r.approved_by_person_id, v_r.approved_by_user) then
    outcome := 'payer_is_approver'; return next; return;
  end if;
  v_self := presby_reimbursement__same_party(v_person, p_actor, v_r.created_by_person_id, v_r.created_by_user)
         or (v_r.beneficiary_person_id is not null
             and presby_reimbursement__same_party(v_person, p_actor, v_r.beneficiary_person_id, null));
  if v_self and exists (
       select 1 from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h
        where not presby_reimbursement__same_party(h.person_id, h.user_id, v_person, p_actor)
          and not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.approved_by_person_id, v_r.approved_by_user)
          and not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.created_by_person_id, v_r.created_by_user)
          and (v_r.beneficiary_person_id is null
               or not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.beneficiary_person_id, null))) then
    outcome := 'needs_another_payer'; return next; return;
  end if;
  if v_r.receipt_waived_at is null and not presby_reimbursement__has_receipt(v_org, v_r.id) then
    outcome := 'receipt_missing'; return next; return;
  end if;

  insert into reimbursement_payments (organization_id, request_id, kind, method, reference, paid_on,
                                      amount_cents, paid_by_user, paid_by_person_id, note)
  values (v_org, v_r.id, 'payment', p_method, v_reference, p_paid_on, v_r.amount_cents, p_actor, v_person, v_note)
  returning id, reimbursement_payments.self_paid into v_id, v_self;
  update reimbursement_requests r set status = 'paid' where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, 'payment_recorded', 'approved', 'paid',
                                          p_actor, v_person, null, v_id);
  outcome := 'ok'; payment_id := v_id; self_paid := v_self;
  notify_requester_person_id := v_r.created_by_person_id;
  return next;
end $$;

-- 7j. Reverse the live payment (reimbursement.pay): insert the reversal row,
-- then return the request to approved, in one transaction (P3-7). Both rows
-- stay on record. Outcomes: ok, not_found, not_reversible, reason_required,
-- reason_too_long.
create or replace function presby_reimbursement_reverse_payment(
  p_request_id uuid, p_reason text, p_actor uuid)
returns table (outcome text, payment_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_reason text := presby_reimbursement__clean_text(p_reason);
  v_live uuid;
  v_amount integer;
  v_id uuid;
begin
  outcome := null; payment_id := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay') then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.status = 'draft' then
    outcome := 'not_found'; return next; return;
  end if;
  v_live := presby_reimbursement__live_payment(v_org, v_r.id);
  if v_r.status <> 'paid' or v_live is null then
    outcome := 'not_reversible'; return next; return;
  end if;
  if v_reason is null then
    outcome := 'reason_required'; return next; return;
  end if;
  if char_length(v_reason) > 300 then
    outcome := 'reason_too_long'; return next; return;
  end if;
  select p.amount_cents into v_amount from reimbursement_payments p where p.id = v_live and p.organization_id = v_org;
  insert into reimbursement_payments (organization_id, request_id, kind, amount_cents, paid_by_user,
                                      paid_by_person_id, offsets_payment_id, reason)
  values (v_org, v_r.id, 'reversal', v_amount, p_actor, v_person, v_live, v_reason)
  returning id into v_id;
  update reimbursement_requests r set status = 'approved' where r.id = v_r.id and r.organization_id = v_org;
  perform presby_reimbursement__log_event(v_org, v_r.id, 'payment_reversed', 'paid', 'approved',
                                          p_actor, v_person, v_reason, v_id);
  outcome := 'ok'; payment_id := v_id;
  return next;
end $$;

-- 7k. An internal treasury note (reimbursement.view; P3-23). Outcomes: ok,
-- not_found, note_required, note_too_long.
create or replace function presby_reimbursement_add_note(
  p_request_id uuid, p_note text, p_actor uuid)
returns table (outcome text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_note text := presby_reimbursement__clean_text(p_note);
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.view') then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.status = 'draft' then
    outcome := 'not_found'; return next; return;
  end if;
  if v_note is null then
    outcome := 'note_required'; return next; return;
  end if;
  if char_length(v_note) > 500 then
    outcome := 'note_too_long'; return next; return;
  end if;
  perform presby_reimbursement__log_event(v_org, v_r.id, 'note', v_r.status, v_r.status, p_actor, v_person, v_note, null);
  outcome := 'ok';
  return next;
end $$;

-- 7l. Before store(): may the creator add a receipt now? So a refused upload
-- never writes a blob. Outcomes: ok, not_found, not_editable,
-- too_many_receipts.
create or replace function presby_reimbursement_receipt_preflight(p_request_id uuid, p_actor uuid)
returns table (outcome text, live_count integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
begin
  outcome := null; live_count := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.created_by_user is distinct from p_actor then
    outcome := 'not_found'; return next; return;
  end if;
  select count(*)::integer into live_count from reimbursement_attachments a
   where a.request_id = v_r.id and a.organization_id = v_org and a.detached_at is null;
  if v_r.status not in ('draft', 'returned') then
    outcome := 'not_editable'; return next; return;
  end if;
  if live_count >= 5 then
    outcome := 'too_many_receipts'; return next; return;
  end if;
  outcome := 'ok';
  return next;
end $$;

-- 7m. Attach a stored receipt. Outcomes: ok, not_found, not_editable,
-- invalid_shape (D4, D7), duplicate_in_request, too_many_receipts.
create or replace function presby_reimbursement_attach_receipt(
  p_request_id uuid, p_blob_key uuid, p_content_sha256 text, p_content_type text,
  p_byte_size integer, p_display_name text, p_actor uuid)
returns table (outcome text, attachment_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_name text := presby_reimbursement__clean_text(p_display_name);
  v_id uuid;
begin
  outcome := null; attachment_id := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.created_by_user is distinct from p_actor then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status not in ('draft', 'returned') then
    outcome := 'not_editable'; return next; return;
  end if;
  if p_blob_key is null or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
     or p_content_type is null or p_content_type not in ('image/jpeg', 'application/pdf')
     or p_byte_size is null or p_byte_size < 1 or p_byte_size > 4000000
     or v_name is null or char_length(v_name) > 80 or v_name ~ '[/\\]'
     -- D7: until Batch 1b's FK, the blob must exist at THIS organization
     -- with the stated type and size.
     or not exists (select 1 from blob_assets b
                     where b.id = p_blob_key and b.organization_id = v_org
                       and b.content_type = p_content_type and b.byte_size = p_byte_size) then
    outcome := 'invalid_shape'; return next; return;
  end if;
  if exists (select 1 from reimbursement_attachments a
              where a.request_id = v_r.id and a.organization_id = v_org and a.detached_at is null
                and a.content_sha256 = p_content_sha256) then
    outcome := 'duplicate_in_request'; return next; return;
  end if;
  if (select count(*) from reimbursement_attachments a
       where a.request_id = v_r.id and a.organization_id = v_org and a.detached_at is null) >= 5 then
    outcome := 'too_many_receipts'; return next; return;
  end if;
  insert into reimbursement_attachments (organization_id, request_id, blob_key, content_sha256,
                                         content_type, byte_size, display_name, created_by_user)
  values (v_org, v_r.id, p_blob_key, p_content_sha256, p_content_type, p_byte_size, v_name, p_actor)
  returning id into v_id;
  outcome := 'ok'; attachment_id := v_id;
  return next;
end $$;

-- 7n. Detach a receipt (soft). Outcomes: ok, not_found, not_editable.
create or replace function presby_reimbursement_detach_receipt(
  p_request_id uuid, p_attachment_id uuid, p_actor uuid)
returns table (outcome text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  select * into v_r from reimbursement_requests r
   where r.id = p_request_id and r.organization_id = v_org
   for update;
  if not found or v_r.created_by_user is distinct from p_actor
     or not exists (select 1 from reimbursement_attachments a
                     where a.id = p_attachment_id and a.request_id = v_r.id
                       and a.organization_id = v_org and a.detached_at is null) then
    outcome := 'not_found'; return next; return;
  end if;
  if v_r.status not in ('draft', 'returned') then
    outcome := 'not_editable'; return next; return;
  end if;
  update reimbursement_attachments a set detached_at = now(), detached_by_user = p_actor
   where a.id = p_attachment_id and a.organization_id = v_org;
  outcome := 'ok';
  return next;
end $$;

-- 7o. Chargeable groups (reimbursement.manage). Outcomes: ok,
-- group_unavailable, unchanged.
create or replace function presby_reimbursement_set_chargeable(
  p_group_id uuid, p_chargeable boolean, p_actor uuid)
returns table (outcome text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_row uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.manage') then
    perform presby_deny_reimbursement();
  end if;
  if p_group_id is null or p_chargeable is null
     or not exists (select 1 from groups g where g.id = p_group_id and g.organization_id = v_org) then
    outcome := 'group_unavailable'; return next; return;
  end if;
  select c.id into v_row from reimbursement_chargeable_groups c
   where c.organization_id = v_org and c.group_id = p_group_id and c.ended_at is null
   for update;
  if p_chargeable and v_row is null then
    insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
    values (v_org, p_group_id, p_actor)
    on conflict do nothing;
    outcome := case when found then 'ok' else 'unchanged' end;
  elsif not p_chargeable and v_row is not null then
    update reimbursement_chargeable_groups c set ended_at = now(), ended_by_user = p_actor
     where c.id = v_row and c.organization_id = v_org;
    outcome := 'ok';
  else
    outcome := 'unchanged';
  end if;
  return next;
end $$;

-- 7p. Create (p_category_id null) or rename/reorder a live category
-- (reimbursement.manage). Outcomes: ok, not_found, name_invalid, name_taken.
create or replace function presby_reimbursement_save_category(
  p_category_id uuid, p_name text, p_sort_order integer, p_actor uuid)
returns table (outcome text, category_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_name text := presby_reimbursement__clean_text(p_name);
  v_id uuid;
begin
  outcome := null; category_id := null;
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.manage') then
    perform presby_deny_reimbursement();
  end if;
  if p_category_id is not null and not exists (
       select 1 from reimbursement_categories c
        where c.id = p_category_id and c.organization_id = v_org and c.ended_at is null) then
    outcome := 'not_found'; return next; return;
  end if;
  if v_name is null or char_length(v_name) > 60 then
    outcome := 'name_invalid'; return next; return;
  end if;
  if exists (select 1 from reimbursement_categories c
              where c.organization_id = v_org and c.ended_at is null and lower(c.name) = lower(v_name)
                and c.id is distinct from p_category_id) then
    outcome := 'name_taken'; return next; return;
  end if;
  if p_category_id is null then
    insert into reimbursement_categories (organization_id, name, sort_order, created_by_user)
    values (v_org, v_name, coalesce(p_sort_order, 0), p_actor)
    returning id into v_id;
  else
    update reimbursement_categories c set name = v_name, sort_order = coalesce(p_sort_order, c.sort_order)
     where c.id = p_category_id and c.organization_id = v_org
    returning c.id into v_id;
  end if;
  outcome := 'ok'; category_id := v_id;
  return next;
end $$;

-- 7q. Retire a category (reimbursement.manage). Outcomes: ok, not_found.
create or replace function presby_reimbursement_end_category(p_category_id uuid, p_actor uuid)
returns table (outcome text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.manage') then
    perform presby_deny_reimbursement();
  end if;
  update reimbursement_categories c set ended_at = now(), ended_by_user = p_actor
   where c.id = p_category_id and c.organization_id = v_org and c.ended_at is null;
  outcome := case when found then 'ok' else 'not_found' end;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Read definers. Same conventions; the viewer rule is 3m.
-- ---------------------------------------------------------------------------

-- 8a. May the actor file? False (never an error) when the actor has no live
-- person here or no organization context is set.
create or replace function presby_reimbursement_may_file(p_actor uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(presby_reimbursement__is_eligible_requester(
           presby_current_org(), presby_reimbursement__actor_person(presby_current_org(), p_actor)), false);
$$;

-- 8b. Today at the organization (org-local; America/New_York fallback).
create or replace function presby_reimbursement_org_today()
returns date language sql stable security definer
set search_path = public, pg_temp
as $$
  select presby_reimbursement__local_date(presby_current_org(), now());
$$;

-- 8c. The actor's own requests: those they created (drafts included) and
-- those that pay them (from submitted on). Newest first.
create or replace function presby_reimbursement_my_requests(p_actor uuid, p_limit integer, p_offset integer)
returns table (id uuid, status text, kind text, payee_label text, amount_cents integer,
               expense_date date, group_name text, purpose_excerpt text, revision integer,
               is_creator boolean, entered_on_behalf boolean, created_at timestamptz,
               submitted_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  return query
  select r.id, r.status, r.kind,
         case when r.kind = 'vendor' then r.vendor_name
              else presby_reimbursement__person_name(r.beneficiary_person_id) end,
         r.amount_cents, r.expense_date, g.name, left(r.purpose, 80), r.revision,
         r.created_by_user = p_actor,
         r.kind = 'reimburse' and r.created_by_person_id is not null
           and not presby_reimbursement__same_party(r.created_by_person_id, r.created_by_user,
                                                    r.beneficiary_person_id, null),
         r.created_at, r.submitted_at, r.updated_at
    from reimbursement_requests r
    join groups g on g.id = r.group_id and g.organization_id = r.organization_id
   where r.organization_id = v_org
     and (r.created_by_user = p_actor
          or (r.status <> 'draft' and r.beneficiary_person_id is not null
              and presby_reimbursement__same_party(v_person, p_actor, r.beneficiary_person_id, null)))
   order by r.created_at desc, r.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- 8d. Submitted requests the actor may approve now; oldest first.
create or replace function presby_reimbursement_waiting_for_me(p_actor uuid)
returns table (id uuid, kind text, payee_label text, amount_cents integer, expense_date date,
               group_name text, purpose_excerpt text, revision integer, entered_on_behalf boolean,
               submitted_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  return query
  select r.id, r.kind,
         case when r.kind = 'vendor' then r.vendor_name
              else presby_reimbursement__person_name(r.beneficiary_person_id) end,
         r.amount_cents, r.expense_date, g.name, left(r.purpose, 80), r.revision,
         r.kind = 'reimburse' and r.created_by_person_id is not null
           and not presby_reimbursement__same_party(r.created_by_person_id, r.created_by_user,
                                                    r.beneficiary_person_id, null),
         r.submitted_at
    from reimbursement_requests r
    join groups g on g.id = r.group_id and g.organization_id = r.organization_id
   where r.organization_id = v_org and r.status = 'submitted'
     and exists (select 1 from presby_reimbursement__eligible_approvers(v_org, r.id) a where a.user_id = p_actor)
   order by r.submitted_at, r.id
   limit 200;
end $$;

-- 8e. Counts for the page header and the treasurer tabs. The three treasury
-- counts are null unless the actor holds reimbursement.view.
--   needs_treasurer     submitted, no eligible approver (the override tab)
--   waiting_for_payment approved (the pay tab)
--   in_progress         submitted with an eligible approver, or returned
create or replace function presby_reimbursement_counts(p_actor uuid)
returns table (waiting_for_me integer, needs_treasurer integer, waiting_for_payment integer, in_progress integer)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  waiting_for_me := (select count(*)::integer from presby_reimbursement_waiting_for_me(p_actor));
  needs_treasurer := null; waiting_for_payment := null; in_progress := null;
  if presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.view') then
    select count(*) filter (where r.status = 'submitted' and not r.has_seat)::integer,
           count(*) filter (where r.status = 'approved')::integer,
           count(*) filter (where (r.status = 'submitted' and r.has_seat) or r.status = 'returned')::integer
      into needs_treasurer, waiting_for_payment, in_progress
      from (select r0.status,
                   r0.status = 'submitted'
                     and exists (select 1 from presby_reimbursement__eligible_approvers(v_org, r0.id)) as has_seat
              from reimbursement_requests r0
             where r0.organization_id = v_org and r0.status in ('submitted', 'approved', 'returned')) r;
  end if;
  return next;
end $$;

-- 8f. The treasurer list (reimbursement.view). p_tab in pay | override |
-- progress | paid | all (all = every non-draft). p_from/p_to filter on the
-- org-local date the request was last sent (or created, for an import).
-- total_count is the full filtered count for paging.
create or replace function presby_reimbursement_treasurer_list(
  p_actor uuid, p_tab text, p_group_id uuid, p_from date, p_to date, p_limit integer, p_offset integer)
returns table (id uuid, status text, kind text, payee_label text, amount_cents integer, expense_date date,
               group_id uuid, group_name text, category_name text, purpose_excerpt text,
               creator_name text, approver_name text, entered_on_behalf boolean, approval_path text,
               submitted_at timestamptz, approved_at timestamptz, paid_on date, revision integer,
               total_count bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.view') then
    perform presby_deny_reimbursement();
  end if;
  if p_tab is null or p_tab not in ('pay', 'override', 'progress', 'paid', 'all') then
    raise exception 'presby_reimbursement_treasurer_list: unknown tab %', p_tab
      using errcode = 'invalid_parameter_value';
  end if;
  return query
  with base as (
    select r.*,
           r.status = 'submitted'
             and exists (select 1 from presby_reimbursement__eligible_approvers(v_org, r.id)) as has_seat
      from reimbursement_requests r
     where r.organization_id = v_org and r.status <> 'draft'
       and (p_group_id is null or r.group_id = p_group_id)
       and (p_from is null or presby_reimbursement__local_date(v_org, coalesce(r.submitted_at, r.created_at)) >= p_from)
       and (p_to is null or presby_reimbursement__local_date(v_org, coalesce(r.submitted_at, r.created_at)) <= p_to)
  ), tabbed as (
    select b.* from base b
     where case p_tab
             when 'pay' then b.status = 'approved'
             when 'override' then b.status = 'submitted' and not b.has_seat
             when 'progress' then (b.status = 'submitted' and b.has_seat) or b.status = 'returned'
             when 'paid' then b.status = 'paid'
             else true end
  )
  select t.id, t.status, t.kind,
         case when t.kind = 'vendor' then t.vendor_name
              else presby_reimbursement__person_name(t.beneficiary_person_id) end,
         t.amount_cents, t.expense_date, t.group_id, g.name, c.name, left(t.purpose, 80),
         presby_reimbursement__person_name(t.created_by_person_id),
         presby_reimbursement__person_name(t.approved_by_person_id),
         t.kind = 'reimburse' and t.created_by_person_id is not null
           and not presby_reimbursement__same_party(t.created_by_person_id, t.created_by_user,
                                                    t.beneficiary_person_id, null),
         t.approval_path, t.submitted_at, t.approved_at,
         (select p.paid_on from reimbursement_payments p
           where p.id = presby_reimbursement__live_payment(v_org, t.id)),
         t.revision, count(*) over ()
    from tabbed t
    join groups g on g.id = t.group_id and g.organization_id = t.organization_id
    left join reimbursement_categories c on c.id = t.category_id and c.organization_id = t.organization_id
   order by case when p_tab in ('pay') then t.approved_at end asc nulls last,
            case when p_tab in ('override', 'progress') then t.submitted_at end asc nulls last,
            coalesce(t.submitted_at, t.created_at) desc, t.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- 8g. One request as jsonb, or NULL for a missing or forbidden id (the TS
-- maps null to the neutral not_found). p_level:
--   'member'   any viewer relation; the requester projection: no actor
--              names, no payments, no notes, no waiver detail; a seat also
--              gets the yes/no duplicate flag; the creator and beneficiary
--              never get it.
--   'treasury' requires reimbursement.view and a non-draft row: actor names,
--              payments and reversals, approval path, waiver, notes, the
--              duplicate request ids, and the verb pre-checks.
-- The shape is pinned by a zod schema and a golden test (Batch 2a).
create or replace function presby_reimbursement_detail(p_request_id uuid, p_actor uuid, p_level text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_r reimbursement_requests%rowtype;
  v_rel text;
  v_treasury boolean;
  v_live uuid;
  v_dups uuid[];
  v_seat_exists boolean;
  v_out jsonb;
  v_is_self boolean;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  if p_level is null or p_level not in ('member', 'treasury') then
    raise exception 'presby_reimbursement_detail: unknown level %', p_level
      using errcode = 'invalid_parameter_value';
  end if;
  select * into v_r from reimbursement_requests r where r.id = p_request_id and r.organization_id = v_org;
  if not found then
    return null;
  end if;
  v_rel := presby_reimbursement__viewer_relation(v_org, p_actor, v_person, v_r.id);
  if v_rel is null then
    return null;
  end if;
  v_treasury := p_level = 'treasury';
  if v_treasury and (v_r.status = 'draft'
                     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.view')) then
    return null;
  end if;

  v_live := presby_reimbursement__live_payment(v_org, v_r.id);
  v_seat_exists := exists (select 1 from presby_reimbursement__eligible_approvers(v_org, v_r.id));
  -- P3-21: the same as-received hash on a live attachment of a different,
  -- EARLIER, submitted request that is not withdrawn or voided.
  select coalesce(array_agg(distinct o.id), array[]::uuid[]) into v_dups
    from reimbursement_attachments a
    join reimbursement_attachments oa on oa.organization_id = a.organization_id
         and oa.content_sha256 = a.content_sha256 and oa.detached_at is null and oa.request_id <> a.request_id
    join reimbursement_requests o on o.id = oa.request_id and o.organization_id = oa.organization_id
   where a.request_id = v_r.id and a.organization_id = v_org and a.detached_at is null
     and o.first_submitted_at is not null and o.created_at < v_r.created_at
     and o.status not in ('withdrawn', 'voided');
  v_is_self := presby_reimbursement__same_party(v_person, p_actor, v_r.created_by_person_id, v_r.created_by_user)
            or (v_r.beneficiary_person_id is not null
                and presby_reimbursement__same_party(v_person, p_actor, v_r.beneficiary_person_id, null));

  v_out := jsonb_build_object(
    'id', v_r.id,
    'level', p_level,
    'status', v_r.status,
    'kind', v_r.kind,
    'origin', v_r.origin,
    'revision', v_r.revision,
    'amountCents', v_r.amount_cents,
    'currency', v_r.currency,
    'expenseDate', v_r.expense_date::text,
    'purpose', v_r.purpose,
    'preApprovedByName', v_r.pre_approved_by_name,
    'noReceiptClaimed', v_r.no_receipt_claimed,
    'createdAt', v_r.created_at,
    'firstSubmittedAt', v_r.first_submitted_at,
    'submittedAt', v_r.submitted_at,
    'updatedAt', v_r.updated_at,
    'group', (select jsonb_build_object('id', g.id, 'name', g.name)
                from groups g where g.id = v_r.group_id and g.organization_id = v_org),
    'category', (select jsonb_build_object('id', c.id, 'name', c.name, 'retired', c.ended_at is not null)
                   from reimbursement_categories c where c.id = v_r.category_id and c.organization_id = v_org),
    'payee', case when v_r.kind = 'vendor'
                  then jsonb_build_object('kind', 'vendor', 'name', v_r.vendor_name)
                  else jsonb_build_object('kind', 'person',
                         'name', presby_reimbursement__person_name(v_r.beneficiary_person_id),
                         'personId', case when v_rel = 'creator' or v_treasury
                                          then v_r.beneficiary_person_id end) end,
    'enteredOnBehalf', v_r.kind = 'reimburse' and v_r.created_by_person_id is not null
                         and not presby_reimbursement__same_party(v_r.created_by_person_id, v_r.created_by_user,
                                                                  v_r.beneficiary_person_id, null),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'displayName', a.display_name,
                                   'contentType', a.content_type, 'byteSize', a.byte_size, 'createdAt', a.created_at)
                                   order by a.created_at, a.id)
                            from reimbursement_attachments a
                           where a.request_id = v_r.id and a.organization_id = v_org and a.detached_at is null),
                         '[]'::jsonb),
    'receiptWaived', v_r.receipt_waived_at is not null,
    'approvedOn', case when v_r.approved_at is not null
                       then presby_reimbursement__local_date(v_org, v_r.approved_at)::text end,
    'decidedOn', presby_reimbursement__decided_on(v_org, v_r.id)::text,
    'latestReason', case when v_r.status in ('returned', 'not_approved') then
                      (select e.note from reimbursement_events e
                        where e.request_id = v_r.id and e.organization_id = v_org and e.to_status = v_r.status
                          and e.kind = v_r.status
                        order by e.created_at desc, e.seq desc limit 1) end,
    'route', case when v_r.status = 'submitted' then presby_reimbursement__route(v_org, v_r.id) end,
    'paidOn', (select p.paid_on::text from reimbursement_payments p where p.id = v_live),
    'duplicateReceipt', case when v_treasury or v_rel = 'seat' then cardinality(v_dups) > 0 end,
    'viewer', jsonb_build_object(
      'relation', v_rel,
      'canEdit', v_rel = 'creator' and v_r.status in ('draft', 'returned'),
      'canWithdraw', v_rel in ('creator', 'beneficiary')
                     and v_r.status in ('draft', 'submitted', 'returned', 'not_approved', 'approved'),
      'canDecide', v_r.status = 'submitted'
                   and exists (select 1 from presby_reimbursement__eligible_approvers(v_org, v_r.id) a
                                where a.user_id = p_actor)),
    'history', coalesce((select jsonb_agg(h.item order by h.created_at, h.seq) from (
        select e.created_at, e.seq,
               jsonb_strip_nulls(jsonb_build_object(
                 'kind', case when not v_treasury and e.kind = 'override_approved' then 'approved' else e.kind end,
                 'fromStatus', e.from_status,
                 'toStatus', e.to_status,
                 'on', presby_reimbursement__local_date(v_org, e.created_at)::text,
                 'at', e.created_at,
                 'note', case when v_treasury or e.kind in ('returned', 'not_approved') then e.note end,
                 'actorName', case when v_treasury then presby_reimbursement__person_name(e.actor_person_id) end,
                 'paymentId', case when v_treasury then e.payment_id end)) as item
          from reimbursement_events e
         where e.request_id = v_r.id and e.organization_id = v_org
           and (v_treasury or e.kind not in ('note', 'receipt_waived', 'imported'))) h),
      '[]'::jsonb));

  if v_treasury then
    v_out := v_out || jsonb_build_object(
      'creatorName', presby_reimbursement__person_name(v_r.created_by_person_id),
      'approval', case when v_r.approved_at is not null then jsonb_build_object(
                    'path', v_r.approval_path,
                    'byName', presby_reimbursement__person_name(v_r.approved_by_person_id),
                    'revision', v_r.approved_revision,
                    'at', v_r.approved_at) end,
      'waiver', case when v_r.receipt_waived_at is not null then jsonb_build_object(
                  'at', v_r.receipt_waived_at,
                  'byName', presby_reimbursement__person_name(v_r.receipt_waived_by_person_id),
                  'note', v_r.receipt_waiver_note) end,
      'duplicateRequestIds', to_jsonb(v_dups),
      'payments', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', p.id, 'kind', p.kind, 'method', p.method, 'reference', p.reference,
                     'paidOn', p.paid_on::text, 'amountCents', p.amount_cents,
                     'byName', presby_reimbursement__person_name(p.paid_by_person_id),
                     'selfPaid', p.self_paid, 'note', p.note, 'offsetsPaymentId', p.offsets_payment_id,
                     'reason', p.reason, 'createdAt', p.created_at,
                     'reversed', exists (select 1 from reimbursement_payments rv
                                          where rv.offsets_payment_id = p.id and rv.kind = 'reversal'))
                     -- a payment sorts before its reversal when one transaction wrote both
                     order by p.created_at, p.kind = 'reversal', p.id)
                     from reimbursement_payments p where p.request_id = v_r.id and p.organization_id = v_org),
                   '[]'::jsonb),
      'treasuryViewer', jsonb_build_object(
        'holdsPay', presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.pay'),
        'holdsManage', presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.manage'),
        'isApprover', v_r.approved_by_user is not null
                      and presby_reimbursement__same_party(v_person, p_actor, v_r.approved_by_person_id, v_r.approved_by_user),
        'isRequesterSide', v_is_self,
        'seatHolderExists', v_seat_exists,
        'secondPayerExists', exists (select 1 from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h
                                      where not presby_reimbursement__same_party(h.person_id, h.user_id, v_person, p_actor)),
        'anotherPayerExists', exists (
          select 1 from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h
           where not presby_reimbursement__same_party(h.person_id, h.user_id, v_person, p_actor)
             and (v_r.approved_by_user is null
                  or not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.approved_by_person_id, v_r.approved_by_user))
             and not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.created_by_person_id, v_r.created_by_user)
             and (v_r.beneficiary_person_id is null
                  or not presby_reimbursement__same_party(h.person_id, h.user_id, v_r.beneficiary_person_id, null)))));
  end if;
  return v_out;
end $$;

-- 8h. The blob behind one live receipt, for a viewer of its request; zero
-- rows otherwise (missing, detached, foreign and forbidden look the same).
create or replace function presby_reimbursement_attachment_lookup(
  p_request_id uuid, p_attachment_id uuid, p_actor uuid)
returns table (blob_key uuid, content_type text, display_name text, viewer_is_creator boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_rel text;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  v_rel := presby_reimbursement__viewer_relation(v_org, p_actor, v_person, p_request_id);
  if v_rel is null then
    return;
  end if;
  return query
  select a.blob_key, a.content_type, a.display_name, v_rel = 'creator'
    from reimbursement_attachments a
   where a.id = p_attachment_id and a.request_id = p_request_id and a.organization_id = v_org
     and a.detached_at is null;
end $$;

-- 8i. CSV rows (reimbursement.view): one row per non-draft request with its
-- live payment, oldest first. No pre-approver and no bank detail (P3-16).
-- The caller passes cap + 1 and answers 413 when it gets it (never a
-- truncated file); p_limit is clamped to 20,001.
create or replace function presby_reimbursement_export_rows(
  p_actor uuid, p_from date, p_to date, p_status text, p_limit integer)
returns table (id uuid, status text, kind text, submitted_on date, expense_date date, group_name text,
               category_name text, payee_name text, purpose text, amount_cents integer,
               approved_on date, approval_path text, paid_on date, payment_method text,
               payment_reference text, creator_name text, approver_name text, payer_name text,
               self_paid boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.view') then
    perform presby_deny_reimbursement();
  end if;
  return query
  select r.id, r.status, r.kind,
         presby_reimbursement__local_date(v_org, coalesce(r.submitted_at, r.created_at)),
         r.expense_date, g.name, c.name,
         case when r.kind = 'vendor' then r.vendor_name
              else presby_reimbursement__person_name(r.beneficiary_person_id) end,
         r.purpose, r.amount_cents,
         case when r.approved_at is not null then presby_reimbursement__local_date(v_org, r.approved_at) end,
         r.approval_path, p.paid_on, p.method, p.reference,
         presby_reimbursement__person_name(r.created_by_person_id),
         presby_reimbursement__person_name(r.approved_by_person_id),
         presby_reimbursement__person_name(p.paid_by_person_id),
         coalesce(p.self_paid, false)
    from reimbursement_requests r
    join groups g on g.id = r.group_id and g.organization_id = r.organization_id
    left join reimbursement_categories c on c.id = r.category_id and c.organization_id = r.organization_id
    left join reimbursement_payments p on p.id = presby_reimbursement__live_payment(v_org, r.id)
   where r.organization_id = v_org and r.status <> 'draft'
     and (p_status is null or r.status = p_status)
     and (p_from is null or presby_reimbursement__local_date(v_org, coalesce(r.submitted_at, r.created_at)) >= p_from)
     and (p_to is null or presby_reimbursement__local_date(v_org, coalesce(r.submitted_at, r.created_at)) <= p_to)
   order by coalesce(r.submitted_at, r.created_at), r.id
   limit least(greatest(coalesce(p_limit, 20001), 1), 20001);
end $$;

-- 8j. Settings (reimbursement.manage): every group with whether it is
-- chargeable and how many seats can approve now (managed groups only; a
-- derived group's count is 0), active categories, and the pay-holder count.
create or replace function presby_reimbursement_settings(p_actor uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_person uuid;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null
     or not presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.manage') then
    perform presby_deny_reimbursement();
  end if;
  return jsonb_build_object(
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', g.id, 'name', g.name, 'membershipSource', g.membership_source,
                 'chargeable', exists (select 1 from reimbursement_chargeable_groups c
                                        where c.organization_id = v_org and c.group_id = g.id and c.ended_at is null),
                 'approverCount', (select count(distinct gm.person_id) from group_memberships gm
                                    where gm.group_id = g.id and gm.organization_id = v_org
                                      and presby_reimbursement__is_seat(v_org, gm.person_id, g.id)))
                 order by g.name, g.id)
                 from groups g where g.organization_id = v_org), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'sortOrder', c.sort_order)
                 order by c.sort_order, lower(c.name), c.id)
                 from reimbursement_categories c where c.organization_id = v_org and c.ended_at is null), '[]'::jsonb),
    'payHolderCount', (select count(distinct h.person_id) from presby_reimbursement__key_holders(v_org, 'reimbursement.pay') h));
end $$;

-- 8k. What the request form offers (may-file): live chargeable groups and
-- categories, and whether the actor may enter for others. mayFile false
-- (with empty lists) for a member who may not file.
create or replace function presby_reimbursement_form_options(p_actor uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_person uuid;
  v_may boolean;
begin
  v_person := presby_reimbursement__actor_person(v_org, p_actor);
  if v_org is null or v_person is null then
    perform presby_deny_reimbursement();
  end if;
  v_may := presby_reimbursement__is_eligible_requester(v_org, v_person);
  return jsonb_build_object(
    'mayFile', v_may,
    'groups', case when v_may then coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name)
                 order by g.name, g.id)
                 from groups g
                 where g.organization_id = v_org
                   and exists (select 1 from reimbursement_chargeable_groups c
                                where c.organization_id = v_org and c.group_id = g.id and c.ended_at is null)),
                 '[]'::jsonb) else '[]'::jsonb end,
    'categories', case when v_may then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
                 order by c.sort_order, lower(c.name), c.id)
                 from reimbursement_categories c where c.organization_id = v_org and c.ended_at is null),
                 '[]'::jsonb) else '[]'::jsonb end,
    'canRequestForOthers', v_may and presby_reimbursement__actor_holds(v_org, p_actor, 'reimbursement.request_for_others'));
end $$;

-- 8l. Bare counts of the current organization, no actor and no key: an
-- org_features.manage holder with no money key needs them (the Features page
-- and its off-warning); they reveal a number and nothing else. Zero with no
-- organization context.
create or replace function presby_reimbursement_pay_holder_count()
returns integer language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select count(distinct h.person_id)::integer
                     from presby_reimbursement__key_holders(presby_current_org(), 'reimbursement.pay') h), 0);
$$;

-- open = submitted, returned or approved (drafts excluded; Copy check C1).
create or replace function presby_reimbursement_open_count()
returns integer language sql stable security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from reimbursement_requests r
   where r.organization_id = presby_current_org() and r.status in ('submitted', 'returned', 'approved');
$$;

-- ---------------------------------------------------------------------------
-- 9. EXECUTE: revoke from everyone, grant to presby_app only. Trigger
--    functions are revoked from everyone too (a trigger needs no EXECUTE
--    grant to fire).
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'presby_reimbursement_guard_delete()',
    'presby_reimbursement_request_insert_guard()',
    'presby_reimbursement_request_update_guard()',
    'presby_reimbursement_attachment_write_guard()',
    'presby_reimbursement_payment_write_guard()',
    'presby_reimbursement_event_write_guard()',
    'presby_reimbursement_config_guard()',
    'presby_reimbursement_status_payment_consistent()',
    'presby_reimbursement_status_has_event()',
    'presby_reimbursement_guard_downward_role()',
    'presby_reimbursement_guard_role_binding()'
  ] loop
    execute format('revoke all on function %s from public, presby_app, presby_platform', f);
  end loop;

  foreach f in array array[
    'presby_reimbursement_save_draft(text, text, uuid, uuid, text, integer, date, text, uuid, text, boolean, uuid)',
    'presby_reimbursement_update_request(uuid, integer, text, uuid, uuid, text, integer, date, text, uuid, text, boolean, uuid)',
    'presby_reimbursement_submit(uuid, integer, uuid)',
    'presby_reimbursement_withdraw(uuid, text, uuid)',
    'presby_reimbursement_approve(uuid, integer, text, uuid)',
    'presby_reimbursement_return(uuid, integer, text, text, uuid)',
    'presby_reimbursement_void(uuid, text, uuid)',
    'presby_reimbursement_waive_receipt(uuid, text, uuid)',
    'presby_reimbursement_record_payment(uuid, text, text, date, text, uuid)',
    'presby_reimbursement_reverse_payment(uuid, text, uuid)',
    'presby_reimbursement_add_note(uuid, text, uuid)',
    'presby_reimbursement_receipt_preflight(uuid, uuid)',
    'presby_reimbursement_attach_receipt(uuid, uuid, text, text, integer, text, uuid)',
    'presby_reimbursement_detach_receipt(uuid, uuid, uuid)',
    'presby_reimbursement_set_chargeable(uuid, boolean, uuid)',
    'presby_reimbursement_save_category(uuid, text, integer, uuid)',
    'presby_reimbursement_end_category(uuid, uuid)',
    'presby_reimbursement_may_file(uuid)',
    'presby_reimbursement_org_today()',
    'presby_reimbursement_my_requests(uuid, integer, integer)',
    'presby_reimbursement_waiting_for_me(uuid)',
    'presby_reimbursement_counts(uuid)',
    'presby_reimbursement_treasurer_list(uuid, text, uuid, date, date, integer, integer)',
    'presby_reimbursement_detail(uuid, uuid, text)',
    'presby_reimbursement_attachment_lookup(uuid, uuid, uuid)',
    'presby_reimbursement_export_rows(uuid, date, date, text, integer)',
    'presby_reimbursement_settings(uuid)',
    'presby_reimbursement_form_options(uuid)',
    'presby_reimbursement_pay_holder_count()',
    'presby_reimbursement_open_count()',
    'presby_deny_reimbursement()'
  ] loop
    execute format('revoke all on function %s from public, presby_platform', f);
    execute format('grant execute on function %s to presby_app', f);
  end loop;
end $$;
