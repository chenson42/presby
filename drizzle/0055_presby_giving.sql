-- drizzle/0055_presby_giving.sql
--
-- Online giving (Stripe), foundation: every giving table except statements
-- (those are drizzle/0056, Batch 5), the SECURITY DEFINER family that is the
-- ONLY writer of gifts, reversals, intents and the provider-events inbox, the
-- freeze/delete guards, the giving 2FA arm, the three giving keys, the two
-- template roles, and the retirement of the `org_portal.giving` platform flag.
--
-- docs/work-log/2026-10-15-online-giving.md -> Phase 3 (Data Model, rulings
-- P3-1..P3-18) and Phase 2 (R2-R6, R10, R11). DECISION-168..175, F138-F141.
--
-- APPLY (owner, direct/unpooled endpoint - db:generate emits none of this):
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0055_presby_giving.sql
--
-- IDEMPOTENT, WHOLE FILE: `create ... if not exists`, drop-then-add for every
-- CHECK and trigger, `create or replace function`, revoke-then-grant, and
-- `on conflict` for every seed row, so it replays cleanly - including as an
-- in-place correction while this migration is unreleased (CLAUDE.md ->
-- Project Layout -> drizzle/). Proven by applying the whole file twice.
--
-- Sections, in dependency order:
--    1. giving_provider enum
--    2. permissions.requires_two_factor + the three giving keys
--    3-12. the twelve tables (settings, connections, funds, donors,
--          identities, link decisions, checkout intents, provider events,
--          gifts, reversals, settlements, settlement lines)
--   13. RLS (ENABLE + FORCE + tenant_isolation on all twelve), grants, comments
--   14. triggers on the giving tables (freeze, guards, delete guards)
--   15. DECISION-175 (1): giving roles never travel a commission/delegation
--   16. internal helpers (ungranted)
--   17. the SECURITY DEFINER family
--   18. presby_two_factor_required(): arm B (R4, DECISION-170/175, F140)
--   19. template roles, their bindings, and the flag retirement
--
-- THE WRITE MARKER `presby.giving_write_active` (P3-7, DECISION-141's shape).
-- Gifts and reversals have NO INSERT/UPDATE grant for any role. The DEFINER
-- functions below write them as the owner, and the owner holds every privilege
-- by ownership (F44) - so the grant cannot be what stops a raw write on the
-- getPlatformDb() connection. giving_gifts_write_guard and
-- giving_reversals_write_guard refuse any INSERT/UPDATE unless this
-- transaction-local GUC is 'true'. It is armed immediately before each gift or
-- reversal write inside the writer functions and disarmed immediately after.
-- The GUC is a workflow marker any role can set; the missing GRANT is the
-- privilege. Fixtures (scripts/giving/seed-dev-giving.sql,
-- src/lib/testing/giving-fixture.ts armGivingWrite()) arm it explicitly.
--
-- DEVIATIONS FROM THE PHASE 3 DDL TEXT (named, each within the design's
-- intent; recorded in the work-log's Batch 1a notes):
--   (D1) giving_connections_insert_guard (section 14): a NEW connection row
--        must be born `onboarding` with every capability flag false and no
--        attestation / go-live / disconnect fields, unless the write marker is
--        armed. The design grants presby_app table-level INSERT on
--        connections and says "Status/flags move only through DEFINER
--        functions" - without this guard an INSERT could create a row that
--        is already `active` and public, bypassing exactly that rule
--        (creation guarded as strongly as mutation, F54-F58).
--   (D2) presby_giving_record_offline_gift() / presby_giving_void_gift()
--        require the claimed actor to hold `giving.record` at the acting org
--        (presby_has_permission), not only to be an active member (0052
--        note 3's bounded claim). Strictly tighter: the database refuses an
--        offline write by a member the app forgot to gate.
--   (D3) Apply functions act only on an inbox row in status `processing`
--        (i.e. claimed through presby_giving_claim_event()); otherwise they
--        return `ignored:not_claimed` and write nothing.
--   (D4) A merge target must be an `identified`, unmerged donor
--        (giving_donors_guard). Merging into the plate-cash donor would move
--        identified giving onto a donor that can never receive a statement.
--   (D5) giving_gifts_failure_code_shape: failure_code only on a failed
--        gift; giving_checkout_intents_covered_shape: no covered fee unless
--        cover_fees. Both follow from the design's state rules.

-- ---------------------------------------------------------------------------
-- 1. The provider enum - one value; Vanco arrives as `alter type ... add value`
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'giving_provider') then
    create type giving_provider as enum ('stripe');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Permission catalog (DECISION-063: permissions carry no org)
-- ---------------------------------------------------------------------------
-- requires_two_factor is read by presby_two_factor_required()'s arm B
-- (section 18). Adding a column is inert for presby_effective_permissions(),
-- which selects pm.key and pm.sensitivity_tier by name.
alter table permissions add column if not exists requires_two_factor boolean not null default false;

comment on column permissions.requires_two_factor is
  'When true, holding this key at any active membership requires 2FA at sign-in (read by presby_two_factor_required(); DECISION-170/175). Only the three giving keys set it in 0055; extending it to tier-3 keys is a tracked follow-up (S2).';

-- `do update`, not `do nothing`: an in-place correction of a description or
-- of the tier must take effect on replay.
insert into permissions (key, module, description, sensitivity_tier, requires_two_factor) values
  ('giving.view',   'giving', 'View gifts, donors, settlements and statements, and export gifts', 2, true),
  ('giving.record', 'giving', 'Record and void offline gifts, create donors, and confirm donor-to-member links', 2, true),
  ('giving.manage', 'giving', 'Connect the congregation''s Stripe account; manage funds, giving settings, statements and the giving team', 2, true)
on conflict (key) do update set module = excluded.module, description = excluded.description,
  sensitivity_tier = excluded.sensitivity_tier, requires_two_factor = excluded.requires_two_factor;

-- ---------------------------------------------------------------------------
-- 3. giving_settings - the donee identity (R5, DECISION-172)
-- ---------------------------------------------------------------------------
-- PK is organization_id, like organization_settings. Nothing references it
-- (statements SNAPSHOT it, 0056), so it carries no (id, organization_id) key.
create table if not exists giving_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  donee_legal_name text,
  donee_address_line1 text,
  donee_address_line2 text,
  donee_city text,
  donee_region text,
  donee_postal_code text,
  donee_ein text,
  signatory_name text,
  signatory_title text,
  greeting_text text,
  closing_text text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

alter table giving_settings drop constraint if exists giving_settings_legal_name_shape;
alter table giving_settings add constraint giving_settings_legal_name_shape
  check (donee_legal_name is null
         or (donee_legal_name = btrim(donee_legal_name) and char_length(donee_legal_name) between 1 and 200));
alter table giving_settings drop constraint if exists giving_settings_address_bounds;
alter table giving_settings add constraint giving_settings_address_bounds
  check (coalesce(char_length(donee_address_line1), 0) <= 120
         and coalesce(char_length(donee_address_line2), 0) <= 120
         and coalesce(char_length(donee_city), 0) <= 120);
alter table giving_settings drop constraint if exists giving_settings_region_shape;
alter table giving_settings add constraint giving_settings_region_shape
  check (donee_region is null or donee_region ~ '^[A-Z]{2}$');
alter table giving_settings drop constraint if exists giving_settings_postal_shape;
alter table giving_settings add constraint giving_settings_postal_shape
  check (donee_postal_code is null or donee_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$');
alter table giving_settings drop constraint if exists giving_settings_ein_shape;
alter table giving_settings add constraint giving_settings_ein_shape
  check (donee_ein is null or donee_ein ~ '^[0-9]{2}-[0-9]{7}$');
alter table giving_settings drop constraint if exists giving_settings_signatory_bounds;
alter table giving_settings add constraint giving_settings_signatory_bounds
  check (coalesce(char_length(signatory_name), 0) <= 120
         and coalesce(char_length(signatory_title), 0) <= 120);
alter table giving_settings drop constraint if exists giving_settings_text_bounds;
alter table giving_settings add constraint giving_settings_text_bounds
  check (coalesce(char_length(greeting_text), 0) <= 500
         and coalesce(char_length(closing_text), 0) <= 500);

-- ---------------------------------------------------------------------------
-- 4. giving_provider_connections
-- ---------------------------------------------------------------------------
create table if not exists giving_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider giving_provider not null,
  external_account_id text not null,
  livemode boolean not null,
  status text not null default 'onboarding',
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  card_enabled boolean not null default false,
  ach_enabled boolean not null default false,
  requirements_due boolean not null default false,
  disabled_reason text,
  card_fee_bps integer not null default 290,
  card_fee_fixed_cents integer not null default 30,
  ach_fee_bps integer not null default 80,
  ach_fee_cap_cents integer not null default 500,
  payouts_attested_at timestamptz,
  payouts_attested_by uuid references users(id),
  public_enabled_at timestamptz,
  public_enabled_by uuid references users(id),
  disconnected_at timestamptz,
  disconnected_reason text,
  last_status_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint giving_connections_id_org_key unique (id, organization_id),
  -- Global: the key is minted by Stripe, never tenant-supplied, so it is not
  -- an F103-style existence oracle (R10).
  constraint giving_connections_provider_account_key unique (provider, external_account_id)
);

alter table giving_provider_connections drop constraint if exists giving_connections_account_shape;
alter table giving_provider_connections add constraint giving_connections_account_shape
  check (external_account_id ~ '^acct_[A-Za-z0-9]{8,64}$');
alter table giving_provider_connections drop constraint if exists giving_connections_status_allowed;
alter table giving_provider_connections add constraint giving_connections_status_allowed
  check (status in ('onboarding', 'active', 'restricted', 'disconnected'));
alter table giving_provider_connections drop constraint if exists giving_connections_fee_bounds;
alter table giving_provider_connections add constraint giving_connections_fee_bounds
  check (card_fee_bps between 0 and 1000 and ach_fee_bps between 0 and 500
         and card_fee_fixed_cents between 0 and 100 and ach_fee_cap_cents between 0 and 2000);
alter table giving_provider_connections drop constraint if exists giving_connections_disabled_reason_bounds;
alter table giving_provider_connections add constraint giving_connections_disabled_reason_bounds
  check (disabled_reason is null or char_length(disabled_reason) <= 120);
alter table giving_provider_connections drop constraint if exists giving_connections_disconnect_shape;
alter table giving_provider_connections add constraint giving_connections_disconnect_shape
  check ((status = 'disconnected') = (disconnected_at is not null)
         and (status = 'disconnected') = (disconnected_reason is not null)
         and (disconnected_reason is null or disconnected_reason in ('treasurer', 'deauthorized')));
alter table giving_provider_connections drop constraint if exists giving_connections_public_needs_attestation;
alter table giving_provider_connections add constraint giving_connections_public_needs_attestation
  check (public_enabled_at is null or payouts_attested_at is not null);

-- At most one non-disconnected connection per org (R10). This index - not the
-- TS pre-check - is what makes startConnect idempotent.
create unique index if not exists giving_connections_one_open_idx
  on giving_provider_connections (organization_id) where status <> 'disconnected';

-- ---------------------------------------------------------------------------
-- 5. giving_funds
-- ---------------------------------------------------------------------------
create table if not exists giving_funds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  online_display_name text,
  description text,
  restriction_class text not null default 'unrestricted',
  offered_online boolean not null default false,
  is_active boolean not null default true,
  retired_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  constraint giving_funds_id_org_key unique (id, organization_id)
);

alter table giving_funds drop constraint if exists giving_funds_name_shape;
alter table giving_funds add constraint giving_funds_name_shape
  check (name = btrim(name) and char_length(name) between 1 and 80);
alter table giving_funds drop constraint if exists giving_funds_online_name_shape;
alter table giving_funds add constraint giving_funds_online_name_shape
  check (online_display_name is null
         or (online_display_name = btrim(online_display_name) and char_length(online_display_name) between 1 and 80));
alter table giving_funds drop constraint if exists giving_funds_description_bounds;
alter table giving_funds add constraint giving_funds_description_bounds
  check (description is null or char_length(description) <= 500);
alter table giving_funds drop constraint if exists giving_funds_restriction_allowed;
alter table giving_funds add constraint giving_funds_restriction_allowed
  check (restriction_class in ('unrestricted', 'temporarily_restricted', 'permanently_restricted'));
-- G23: nothing public by default - an online fund is active and named for the public.
alter table giving_funds drop constraint if exists giving_funds_online_shape;
alter table giving_funds add constraint giving_funds_online_shape
  check (not offered_online or (is_active and online_display_name is not null));
alter table giving_funds drop constraint if exists giving_funds_retired_shape;
alter table giving_funds add constraint giving_funds_retired_shape
  check (is_active = (retired_at is null));

-- Covers retired rows: a retired "Missions" keeps its name reserved.
create unique index if not exists giving_funds_org_lower_name_idx on giving_funds (organization_id, lower(name));

-- ---------------------------------------------------------------------------
-- 6. giving_donors - no person_id (schema-design section 7). The link is a
--    composite reference to memberships, never a bare person.
-- ---------------------------------------------------------------------------
create table if not exists giving_donors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null default 'identified',
  display_name text not null,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text not null default 'US',
  linked_membership_id uuid,
  link_source text,
  linked_at timestamptz,
  linked_by uuid references users(id),
  merged_into_id uuid,
  merged_at timestamptz,
  merged_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_donors_id_org_key unique (id, organization_id),
  constraint giving_donors_link_fk foreign key (linked_membership_id, organization_id)
    references memberships (id, organization_id),
  constraint giving_donors_merge_fk foreign key (merged_into_id, organization_id)
    references giving_donors (id, organization_id)
);

alter table giving_donors drop constraint if exists giving_donors_kind_allowed;
alter table giving_donors add constraint giving_donors_kind_allowed
  check (kind in ('identified', 'unidentified'));
alter table giving_donors drop constraint if exists giving_donors_display_name_shape;
alter table giving_donors add constraint giving_donors_display_name_shape
  check (display_name = btrim(display_name) and char_length(display_name) between 1 and 120);
alter table giving_donors drop constraint if exists giving_donors_email_shape;
alter table giving_donors add constraint giving_donors_email_shape
  check (email is null
         or (email = lower(btrim(email)) and char_length(email) <= 254
             and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
alter table giving_donors drop constraint if exists giving_donors_address_bounds;
alter table giving_donors add constraint giving_donors_address_bounds
  check (coalesce(char_length(address_line1), 0) <= 120
         and coalesce(char_length(address_line2), 0) <= 120
         and coalesce(char_length(city), 0) <= 120
         and coalesce(char_length(region), 0) <= 120
         and coalesce(char_length(postal_code), 0) <= 120);
alter table giving_donors drop constraint if exists giving_donors_country_shape;
alter table giving_donors add constraint giving_donors_country_shape
  check (country ~ '^[A-Z]{2}$');
alter table giving_donors drop constraint if exists giving_donors_link_shape;
alter table giving_donors add constraint giving_donors_link_shape
  check ((link_source is null or link_source in ('self_online', 'recorder_confirmed'))
         and (linked_membership_id is null) = (link_source is null)
         and (link_source is null) = (linked_at is null));
alter table giving_donors drop constraint if exists giving_donors_merge_shape;
alter table giving_donors add constraint giving_donors_merge_shape
  check ((merged_into_id is null) = (merged_at is null)
         and merged_into_id is distinct from id);
-- Plate cash carries no contact, no link and no merge - it can never receive
-- a statement (enforced again in 0056's insert guard).
alter table giving_donors drop constraint if exists giving_donors_unidentified_shape;
alter table giving_donors add constraint giving_donors_unidentified_shape
  check (kind = 'identified'
         or (email is null and address_line1 is null and address_line2 is null and city is null
             and region is null and postal_code is null
             and linked_membership_id is null and merged_into_id is null));

create unique index if not exists giving_donors_one_unidentified_idx
  on giving_donors (organization_id) where kind = 'unidentified';
create index if not exists giving_donors_org_name_idx
  on giving_donors (organization_id, lower(display_name));
create index if not exists giving_donors_org_email_idx
  on giving_donors (organization_id, email) where email is not null;
create index if not exists giving_donors_org_link_idx
  on giving_donors (organization_id, linked_membership_id) where linked_membership_id is not null;
create index if not exists giving_donors_org_merged_idx
  on giving_donors (organization_id, merged_into_id) where merged_into_id is not null;

-- ---------------------------------------------------------------------------
-- 7. Provider identities and dismissed link proposals
-- ---------------------------------------------------------------------------
create table if not exists giving_donor_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null,
  connection_id uuid not null,
  external_customer_id text not null,
  created_at timestamptz not null default now(),
  constraint giving_identities_id_org_key unique (id, organization_id),
  constraint giving_identities_customer_key unique (connection_id, external_customer_id),
  constraint giving_identities_donor_fk foreign key (donor_id, organization_id)
    references giving_donors (id, organization_id),
  constraint giving_identities_conn_fk foreign key (connection_id, organization_id)
    references giving_provider_connections (id, organization_id)
);

alter table giving_donor_identities drop constraint if exists giving_identities_customer_shape;
alter table giving_donor_identities add constraint giving_identities_customer_shape
  check (external_customer_id ~ '^cus_[A-Za-z0-9]{8,64}$');

create index if not exists giving_identities_donor_idx on giving_donor_identities (organization_id, donor_id);

create table if not exists giving_donor_link_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null,
  membership_id uuid not null,
  decision text not null,
  decided_by uuid references users(id),
  decided_at timestamptz not null default now(),
  constraint giving_link_decisions_id_org_key unique (id, organization_id),
  constraint giving_link_decisions_once_key unique (donor_id, membership_id),
  constraint giving_link_decisions_donor_fk foreign key (donor_id, organization_id)
    references giving_donors (id, organization_id),
  constraint giving_link_decisions_member_fk foreign key (membership_id, organization_id)
    references memberships (id, organization_id)
);

alter table giving_donor_link_decisions drop constraint if exists giving_link_decisions_decision_allowed;
alter table giving_donor_link_decisions add constraint giving_link_decisions_decision_allowed
  check (decision = 'dismissed');

-- ---------------------------------------------------------------------------
-- 8. giving_checkout_intents - the ONLY path from a Stripe payment to a gift
--    (R9). Carries no donor PII.
-- ---------------------------------------------------------------------------
create table if not exists giving_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null,
  fund_id uuid not null,
  -- null on the public page; set ONLY by presby_giving_create_intent_member()
  membership_id uuid,
  -- set when the donor is first resolved
  donor_id uuid,
  frequency text not null,
  method_choice text not null,
  cover_fees boolean not null default false,
  -- the gift itself; the gift row's amount_cents is the TOTAL charged
  gift_amount_cents integer not null,
  donor_covered_fee_cents integer not null default 0,
  total_cents integer not null,
  currency text not null default 'usd',
  livemode boolean not null,
  idempotency_key text not null,
  status text not null default 'created',
  checkout_session_id text,
  payment_intent_id text,
  subscription_id text,
  customer_id text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  subscription_ended_at timestamptz,
  last_payment_failed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint giving_intents_id_org_key unique (id, organization_id),
  constraint giving_intents_idem_key unique (organization_id, idempotency_key),
  constraint giving_intents_conn_fk foreign key (connection_id, organization_id)
    references giving_provider_connections (id, organization_id),
  constraint giving_intents_fund_fk foreign key (fund_id, organization_id)
    references giving_funds (id, organization_id),
  constraint giving_intents_member_fk foreign key (membership_id, organization_id)
    references memberships (id, organization_id),
  constraint giving_intents_donor_fk foreign key (donor_id, organization_id)
    references giving_donors (id, organization_id)
);

alter table giving_checkout_intents drop constraint if exists giving_intents_frequency_allowed;
alter table giving_checkout_intents add constraint giving_intents_frequency_allowed
  check (frequency in ('once', 'monthly'));
alter table giving_checkout_intents drop constraint if exists giving_intents_method_allowed;
alter table giving_checkout_intents add constraint giving_intents_method_allowed
  check (method_choice in ('card', 'bank', 'either')
         and (not cover_fees or method_choice <> 'either'));
alter table giving_checkout_intents drop constraint if exists giving_intents_amount_shape;
alter table giving_checkout_intents add constraint giving_intents_amount_shape
  check (gift_amount_cents between 100 and 2500000
         and donor_covered_fee_cents >= 0
         and total_cents = gift_amount_cents + donor_covered_fee_cents);
alter table giving_checkout_intents drop constraint if exists giving_intents_covered_shape;
alter table giving_checkout_intents add constraint giving_intents_covered_shape
  check (cover_fees or donor_covered_fee_cents = 0);
alter table giving_checkout_intents drop constraint if exists giving_intents_currency_usd;
alter table giving_checkout_intents add constraint giving_intents_currency_usd
  check (currency = 'usd');
alter table giving_checkout_intents drop constraint if exists giving_intents_idem_shape;
alter table giving_checkout_intents add constraint giving_intents_idem_shape
  check (idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table giving_checkout_intents drop constraint if exists giving_intents_status_allowed;
alter table giving_checkout_intents add constraint giving_intents_status_allowed
  check (status in ('created', 'open', 'completed', 'expired', 'failed'));
alter table giving_checkout_intents drop constraint if exists giving_intents_external_ids_shape;
alter table giving_checkout_intents add constraint giving_intents_external_ids_shape
  check ((checkout_session_id is null or checkout_session_id ~ '^cs_[A-Za-z0-9_]{8,255}$')
         and (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]{8,64}$')
         and (subscription_id is null or subscription_id ~ '^sub_[A-Za-z0-9_]{8,64}$')
         and (customer_id is null or customer_id ~ '^cus_[A-Za-z0-9]{8,64}$'));

create unique index if not exists giving_intents_session_idx
  on giving_checkout_intents (connection_id, checkout_session_id) where checkout_session_id is not null;
create unique index if not exists giving_intents_subscription_idx
  on giving_checkout_intents (connection_id, subscription_id) where subscription_id is not null;
create index if not exists giving_intents_org_status_idx
  on giving_checkout_intents (organization_id, status, created_at);

-- ---------------------------------------------------------------------------
-- 9. giving_provider_events - the inbox (R6). presby_app holds NO privilege
--    here; only the DEFINER functions touch it.
-- ---------------------------------------------------------------------------
create table if not exists giving_provider_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null,
  provider giving_provider not null,
  external_event_id text not null,
  event_type text not null,
  livemode boolean not null,
  -- the exact signed bytes (text, not jsonb: schema-design section 9 rule 5);
  -- nulled 90 days after a terminal status by presby_giving_purge_bodies()
  raw_body text,
  body_purged_at timestamptz,
  status text not null default 'received',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  -- a short code only, never a payload fragment
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint giving_events_id_org_key unique (id, organization_id),
  constraint giving_events_once_key unique (connection_id, external_event_id),
  constraint giving_events_conn_fk foreign key (connection_id, organization_id)
    references giving_provider_connections (id, organization_id)
);

alter table giving_provider_events drop constraint if exists giving_events_status_allowed;
alter table giving_provider_events add constraint giving_events_status_allowed
  check (status in ('received', 'processing', 'applied', 'ignored', 'parked', 'dead_letter'));
alter table giving_provider_events drop constraint if exists giving_events_attempts_nonneg;
alter table giving_provider_events add constraint giving_events_attempts_nonneg
  check (attempts >= 0);
alter table giving_provider_events drop constraint if exists giving_events_external_id_shape;
alter table giving_provider_events add constraint giving_events_external_id_shape
  check (external_event_id ~ '^evt_[A-Za-z0-9_]{8,64}$');
alter table giving_provider_events drop constraint if exists giving_events_type_shape;
alter table giving_provider_events add constraint giving_events_type_shape
  check (char_length(event_type) between 1 and 100 and event_type ~ '^[a-z0-9_.]+$');
alter table giving_provider_events drop constraint if exists giving_events_last_error_shape;
alter table giving_provider_events add constraint giving_events_last_error_shape
  check (last_error is null or (char_length(last_error) <= 60 and last_error ~ '^[a-z0-9_:]*$'));
alter table giving_provider_events drop constraint if exists giving_events_body_bounds;
alter table giving_provider_events add constraint giving_events_body_bounds
  check (raw_body is null or octet_length(raw_body) <= 1000000);
alter table giving_provider_events drop constraint if exists giving_events_purge_shape;
alter table giving_provider_events add constraint giving_events_purge_shape
  check ((body_purged_at is null) = (raw_body is not null));

create index if not exists giving_events_due_idx
  on giving_provider_events (next_attempt_at) where status in ('received', 'parked', 'processing');
create index if not exists giving_events_org_status_idx
  on giving_provider_events (organization_id, status);

-- ---------------------------------------------------------------------------
-- 10. giving_gifts. Writes ONLY through the DEFINER functions (P3-7).
--     amount_cents is the TOTAL charged; donor_covered_fee_cents is the part
--     the donor added to cover fees (its own column: the statement policy is
--     one constant, G10). For stock, amount_cents is the recorded value for
--     the congregation's books and is never printed on a statement.
-- ---------------------------------------------------------------------------
create table if not exists giving_gifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null,
  fund_id uuid not null,
  source text not null,
  provider giving_provider,
  connection_id uuid,
  intent_id uuid,
  external_transaction_id text,
  method text,
  check_number text,
  stock_description text,
  stock_quantity numeric(18,6),
  memo text,
  amount_cents integer not null,
  donor_covered_fee_cents integer not null default 0,
  fee_cents integer,
  net_cents integer,
  currency text not null default 'usd',
  status text not null,
  failure_code text,
  -- the ORG-LOCAL date of authorization; the statement year derives from this alone
  occurred_on date not null,
  -- null for offline gifts
  occurred_at timestamptz,
  livemode boolean not null,
  -- offline only
  recorded_by uuid references users(id),
  source_event_id uuid,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_gifts_id_org_key unique (id, organization_id),
  constraint giving_gifts_donor_fk foreign key (donor_id, organization_id)
    references giving_donors (id, organization_id),
  constraint giving_gifts_fund_fk foreign key (fund_id, organization_id)
    references giving_funds (id, organization_id),
  constraint giving_gifts_conn_fk foreign key (connection_id, organization_id)
    references giving_provider_connections (id, organization_id),
  constraint giving_gifts_intent_fk foreign key (intent_id, organization_id)
    references giving_checkout_intents (id, organization_id),
  constraint giving_gifts_event_fk foreign key (source_event_id, organization_id)
    references giving_provider_events (id, organization_id)
);

alter table giving_gifts drop constraint if exists giving_gifts_source_allowed;
alter table giving_gifts add constraint giving_gifts_source_allowed
  check (source in ('online', 'offline'));
alter table giving_gifts drop constraint if exists giving_gifts_status_allowed;
alter table giving_gifts add constraint giving_gifts_status_allowed
  check (status in ('pending', 'succeeded', 'failed'));
alter table giving_gifts drop constraint if exists giving_gifts_currency_usd;
alter table giving_gifts add constraint giving_gifts_currency_usd
  check (currency = 'usd');
alter table giving_gifts drop constraint if exists giving_gifts_amount_range;
alter table giving_gifts add constraint giving_gifts_amount_range
  check (amount_cents between 1 and 100000000);
alter table giving_gifts drop constraint if exists giving_gifts_covered_fee_range;
alter table giving_gifts add constraint giving_gifts_covered_fee_range
  check (donor_covered_fee_cents >= 0 and donor_covered_fee_cents < amount_cents);
alter table giving_gifts drop constraint if exists giving_gifts_occurred_on_floor;
alter table giving_gifts add constraint giving_gifts_occurred_on_floor
  check (occurred_on >= date '2000-01-01');
alter table giving_gifts drop constraint if exists giving_gifts_text_bounds;
alter table giving_gifts add constraint giving_gifts_text_bounds
  check (coalesce(char_length(check_number), 0) <= 30
         and coalesce(char_length(stock_description), 0) <= 200
         and coalesce(char_length(memo), 0) <= 500
         and coalesce(char_length(external_transaction_id), 0) <= 255);
alter table giving_gifts drop constraint if exists giving_gifts_failure_code_shape;
alter table giving_gifts add constraint giving_gifts_failure_code_shape
  check (failure_code is null
         or (status = 'failed' and char_length(failure_code) <= 60 and failure_code ~ '^[a-z0-9_]+$'));
alter table giving_gifts drop constraint if exists giving_gifts_method_allowed;
alter table giving_gifts add constraint giving_gifts_method_allowed
  check (method is null or method in ('card', 'us_bank_account', 'wallet', 'cash', 'check', 'stock', 'other'));
alter table giving_gifts drop constraint if exists giving_gifts_online_shape;
alter table giving_gifts add constraint giving_gifts_online_shape
  check (source <> 'online'
         or (provider is not null and connection_id is not null and intent_id is not null
             and external_transaction_id is not null and occurred_at is not null
             and recorded_by is null
             and (method is null or method in ('card', 'us_bank_account', 'wallet'))));
alter table giving_gifts drop constraint if exists giving_gifts_offline_shape;
alter table giving_gifts add constraint giving_gifts_offline_shape
  check (source <> 'offline'
         or (provider is null and connection_id is null and intent_id is null
             and external_transaction_id is null and occurred_at is null and fee_cents is null
             and recorded_by is not null and livemode and status = 'succeeded'
             and method in ('cash', 'check', 'stock', 'other')
             and donor_covered_fee_cents = 0));
alter table giving_gifts drop constraint if exists giving_gifts_check_number_shape;
alter table giving_gifts add constraint giving_gifts_check_number_shape
  check (check_number is null or method = 'check');
alter table giving_gifts drop constraint if exists giving_gifts_stock_shape;
alter table giving_gifts add constraint giving_gifts_stock_shape
  check ((method is not distinct from 'stock') = (stock_description is not null)
         and (stock_quantity is null or (method = 'stock' and stock_quantity > 0)));
alter table giving_gifts drop constraint if exists giving_gifts_fee_shape;
alter table giving_gifts add constraint giving_gifts_fee_shape
  check ((fee_cents is null) = (net_cents is null)
         and (fee_cents is null or (fee_cents >= 0 and net_cents = amount_cents - fee_cents)));

create unique index if not exists giving_gifts_txn_idx
  on giving_gifts (connection_id, external_transaction_id) where external_transaction_id is not null;
create index if not exists giving_gifts_org_date_idx   on giving_gifts (organization_id, occurred_on desc, id desc);
create index if not exists giving_gifts_org_donor_idx  on giving_gifts (organization_id, donor_id, occurred_on);
create index if not exists giving_gifts_org_fund_idx   on giving_gifts (organization_id, fund_id);
create index if not exists giving_gifts_org_status_idx
  on giving_gifts (organization_id, status, status_changed_at) where status <> 'succeeded';
create index if not exists giving_gifts_org_rec_idx
  on giving_gifts (organization_id, recorded_by, created_at) where recorded_by is not null;
create index if not exists giving_gifts_org_intent_idx
  on giving_gifts (organization_id, intent_id) where intent_id is not null;

-- ---------------------------------------------------------------------------
-- 11. giving_gift_reversals - insert-only (P3-12)
-- ---------------------------------------------------------------------------
create table if not exists giving_gift_reversals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  gift_id uuid not null,
  connection_id uuid,
  kind text not null,
  amount_cents integer not null,
  external_reversal_id text,
  offsets_reversal_id uuid,
  reason text,
  occurred_on date not null,
  occurred_at timestamptz,
  -- void only
  recorded_by uuid references users(id),
  livemode boolean not null,
  source_event_id uuid,
  created_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_reversals_id_org_key unique (id, organization_id),
  constraint giving_reversals_gift_fk foreign key (gift_id, organization_id)
    references giving_gifts (id, organization_id),
  constraint giving_reversals_conn_fk foreign key (connection_id, organization_id)
    references giving_provider_connections (id, organization_id),
  constraint giving_reversals_offsets_fk foreign key (offsets_reversal_id, organization_id)
    references giving_gift_reversals (id, organization_id),
  constraint giving_reversals_event_fk foreign key (source_event_id, organization_id)
    references giving_provider_events (id, organization_id)
);

alter table giving_gift_reversals drop constraint if exists giving_reversals_kind_allowed;
alter table giving_gift_reversals add constraint giving_reversals_kind_allowed
  check (kind in ('refund', 'dispute', 'ach_return', 'void', 'reinstatement'));
alter table giving_gift_reversals drop constraint if exists giving_reversals_amount_positive;
alter table giving_gift_reversals add constraint giving_reversals_amount_positive
  check (amount_cents > 0);
alter table giving_gift_reversals drop constraint if exists giving_reversals_text_bounds;
alter table giving_gift_reversals add constraint giving_reversals_text_bounds
  check (coalesce(char_length(reason), 0) <= 200
         and coalesce(char_length(external_reversal_id), 0) <= 255);
alter table giving_gift_reversals drop constraint if exists giving_reversals_occurred_on_floor;
alter table giving_gift_reversals add constraint giving_reversals_occurred_on_floor
  check (occurred_on >= date '2000-01-01');
alter table giving_gift_reversals drop constraint if exists giving_reversals_void_shape;
alter table giving_gift_reversals add constraint giving_reversals_void_shape
  check (kind <> 'void'
         or (reason is not null and recorded_by is not null and connection_id is null
             and external_reversal_id is null and offsets_reversal_id is null));
alter table giving_gift_reversals drop constraint if exists giving_reversals_provider_shape;
alter table giving_gift_reversals add constraint giving_reversals_provider_shape
  check (kind not in ('refund', 'dispute', 'ach_return')
         or (connection_id is not null and external_reversal_id is not null
             and offsets_reversal_id is null and recorded_by is null));
alter table giving_gift_reversals drop constraint if exists giving_reversals_reinstatement_shape;
alter table giving_gift_reversals add constraint giving_reversals_reinstatement_shape
  check (kind <> 'reinstatement'
         or (connection_id is not null and external_reversal_id is not null
             and offsets_reversal_id is not null and recorded_by is null));

create unique index if not exists giving_reversals_ext_idx
  on giving_gift_reversals (connection_id, external_reversal_id) where external_reversal_id is not null;
create unique index if not exists giving_reversals_void_idx
  on giving_gift_reversals (gift_id) where kind = 'void';
create index if not exists giving_reversals_gift_idx on giving_gift_reversals (organization_id, gift_id);

-- ---------------------------------------------------------------------------
-- 12. Settlements (read-only; Batch 6 is the droppable reader). bigint
--     aggregates; lines are SIGNED (P3-13).
-- ---------------------------------------------------------------------------
create table if not exists giving_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null,
  external_settlement_id text not null,
  arrival_date date,
  status text not null,
  automatic boolean not null default true,
  gross_cents bigint not null,
  livemode boolean not null,
  lines_loaded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint giving_settlements_id_org_key unique (id, organization_id),
  constraint giving_settlements_ext_key unique (connection_id, external_settlement_id),
  constraint giving_settlements_conn_fk foreign key (connection_id, organization_id)
    references giving_provider_connections (id, organization_id)
);

alter table giving_settlements drop constraint if exists giving_settlements_status_allowed;
alter table giving_settlements add constraint giving_settlements_status_allowed
  check (status in ('paid', 'failed'));
alter table giving_settlements drop constraint if exists giving_settlements_gross_nonneg;
alter table giving_settlements add constraint giving_settlements_gross_nonneg
  check (gross_cents >= 0);
alter table giving_settlements drop constraint if exists giving_settlements_external_id_shape;
alter table giving_settlements add constraint giving_settlements_external_id_shape
  check (external_settlement_id ~ '^po_[A-Za-z0-9_]{8,64}$');

create table if not exists giving_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  settlement_id uuid not null,
  gift_id uuid,
  external_balance_transaction_id text not null,
  payment_intent_id text,
  kind text not null,
  gross_cents bigint not null,
  fee_cents bigint not null,
  net_cents bigint not null,
  constraint giving_settlement_lines_id_org_key unique (id, organization_id),
  constraint giving_settlement_lines_txn_key unique (settlement_id, external_balance_transaction_id),
  constraint giving_settlement_lines_settlement_fk foreign key (settlement_id, organization_id)
    references giving_settlements (id, organization_id),
  constraint giving_settlement_lines_gift_fk foreign key (gift_id, organization_id)
    references giving_gifts (id, organization_id)
);

alter table giving_settlement_lines drop constraint if exists giving_settlement_lines_kind_allowed;
alter table giving_settlement_lines add constraint giving_settlement_lines_kind_allowed
  check (kind in ('charge', 'refund', 'dispute', 'fee', 'adjustment', 'other'));
alter table giving_settlement_lines drop constraint if exists giving_settlement_lines_net_shape;
alter table giving_settlement_lines add constraint giving_settlement_lines_net_shape
  check (net_cents = gross_cents - fee_cents);
alter table giving_settlement_lines drop constraint if exists giving_settlement_lines_ids_shape;
alter table giving_settlement_lines add constraint giving_settlement_lines_ids_shape
  check (char_length(external_balance_transaction_id) between 1 and 255
         and (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]{8,64}$'));

create index if not exists giving_settlement_lines_gift_idx
  on giving_settlement_lines (organization_id, gift_id) where gift_id is not null;

-- ---------------------------------------------------------------------------
-- 13. RLS, grants, comments
-- ---------------------------------------------------------------------------
-- ENABLE + FORCE + tenant_isolation on all twelve (drizzle/0020's shape).
-- giving_provider_events carries the policy too, although no tenant role can
-- reach it: if a grant is ever added by mistake, tenancy still holds.
do $$
declare
  t text;
  giving_tables text[] := array[
    'giving_settings', 'giving_provider_connections', 'giving_funds', 'giving_donors',
    'giving_donor_identities', 'giving_donor_link_decisions', 'giving_checkout_intents',
    'giving_provider_events', 'giving_gifts', 'giving_gift_reversals',
    'giving_settlements', 'giving_settlement_lines'];
begin
  foreach t in array giving_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
    -- Revoke-then-grant: an in-place re-apply corrects a hand-added grant
    -- (F38 - assert, do not assume). REVOKE ALL on a table also revokes its
    -- column-level privileges. presby_platform receives NOTHING on any giving
    -- table: nobody logs in as it, and platform reach is the owner
    -- connection's. NO DELETE for anyone: FK cascades from organizations run
    -- as the table owner and need no grant.
    execute format('revoke all on %I from presby_app, presby_platform, public', t);
  end loop;
end $$;

grant select, insert, update on giving_settings to presby_app;
grant select, insert on giving_provider_connections to presby_app;
-- Column-level: the go-live / attestation / fee-rate edits only. Status and
-- capability flags move only through the DEFINER functions.
grant update (public_enabled_at, public_enabled_by, payouts_attested_at, payouts_attested_by,
              card_fee_bps, card_fee_fixed_cents, ach_fee_bps, ach_fee_cap_cents, updated_at)
  on giving_provider_connections to presby_app;
grant select, insert, update on giving_funds to presby_app;
grant select, insert, update on giving_donors to presby_app;
grant select on giving_donor_identities to presby_app;
grant select, insert on giving_donor_link_decisions to presby_app;
grant select on giving_checkout_intents to presby_app;
-- giving_provider_events: NOTHING (R6). The body is reachable only through
-- presby_giving_claim_event().
grant select on giving_gifts to presby_app;
grant select on giving_gift_reversals to presby_app;
grant select on giving_settlements to presby_app;
grant select on giving_settlement_lines to presby_app;

comment on table giving_settings is
  'The donee identity printed on contribution statements (R5, DECISION-172): legal name, mailing address, optional EIN, signatory, greeting and closing. One row per org (PK organization_id). Edited by giving.manage holders; snapshotted onto every issued statement (0056). Not organization_identifiers (no tenant RLS, cross-council writer) and not organization_profiles (public-site content).';
comment on table giving_provider_connections is
  'A congregation''s payment-provider account (Stripe Connect, direct charges, congregation-owned; DECISION-168). Only the acct_ id is stored. At most one non-disconnected row per org (giving_connections_one_open_idx); disconnected is terminal (giving_connections_status_guard) and local - the Stripe account is neither closed nor deauthorized. A new row is born onboarding with every flag false (giving_connections_insert_guard); status and capability flags move only through the presby_giving_* DEFINER functions. presby_app holds a column-level UPDATE on the nine go-live/attestation/fee-rate columns only.';
comment on column giving_provider_connections.public_enabled_at is
  'presby''s explicit go-live (P3-11, R11 "mode live"), not Stripe livemode. Requires payouts_attested_at. presby_public_giving_config() returns live only while status = active and this is set.';
comment on table giving_funds is
  'Designations a gift is given to. Retired (is_active = false, retired_at), never deleted (no DELETE grant). offered_online defaults false (G23); an online fund must be active and carry online_display_name. No General Fund is auto-seeded (R10).';
comment on table giving_donors is
  'A giver as the congregation''s books know them. Deliberately NO person_id (schema-design section 7): the optional link is a composite reference to memberships (linked_membership_id), proposed by email match and confirmed by a recorder, or set automatically from a signed-in member''s own checkout intent (Q10). Merges flatten (merged_into_id depth <= 1, giving_donors_guard). kind = unidentified is plate cash: one per org, no contact, never a statement. No DELETE grant; owner-path delete refused unless deletable_until is in the future or the organization is being torn down (P3-8).';
comment on table giving_donor_identities is
  'A provider customer (cus_) attached to a donor. Written only by the DEFINER apply functions; presby_app reads it.';
comment on table giving_donor_link_decisions is
  'A dismissed donor-to-membership link proposal, so it is not proposed again. Insert-only for presby_app.';
comment on table giving_checkout_intents is
  'Presby''s own record of a give attempt, written before the redirect to Stripe Checkout. The ONLY path from a Stripe payment to a gift (R9): fund and membership come from here, never from Stripe metadata, and a payment with no intent is ignored. Written only by DEFINER functions; carries no donor PII. gift_amount_cents is the gift; total_cents = gift + donor_covered_fee_cents is what Stripe charges, computed in SQL by presby_giving_gross_up().';
comment on table giving_provider_events is
  'The webhook inbox (R6, DECISION-171). presby_app holds NO privilege on this table; ingest, claim, finish, purge and replay are SECURITY DEFINER functions that derive the organization from the connection, never from a parameter. raw_body is the exact signed bytes as text and is nulled 90 days after a terminal status (body_purged_at). Tenant-RLS''d anyway, so an accidental grant would still be tenancy-bound.';
comment on table giving_gifts is
  'One gift: an online gift is one PaymentIntent (exactly one presby checkout intent behind it); an offline gift is recorded by a giving.record holder. NO INSERT/UPDATE grant for any role (P3-7): written only by the presby_giving_* DEFINER functions, and giving_gifts_write_guard refuses any write unless the transaction-local marker presby.giving_write_active is armed - on every connection, the owner path included (F44). Status moves pending -> succeeded|failed only; fee/net are set once; everything else is frozen. Corrected by an insert-only reversal row, never by update. No DELETE (P3-8 guard).';
comment on column giving_gifts.amount_cents is
  'The TOTAL charged/received in cents, including any donor_covered_fee_cents. For stock, the recorded value for the congregation''s books; never printed on a statement.';
comment on column giving_gifts.occurred_on is
  'The organization-LOCAL date of authorization, computed in SQL from occurred_at in organization_settings.time_zone (America/New_York when the org has no settings row, F132). For offline gifts, the date the recorder entered. The statement year derives from this column alone.';
comment on column giving_gifts.livemode is
  'false for a Stripe test-mode gift. Every total, export and statement filters livemode = true through one shared predicate (P3-17). Offline gifts are always true.';
comment on table giving_gift_reversals is
  'Insert-only corrections to a gift (P3-12): refund, dispute, ach_return (from provider events), void (an offline gift, with a reason, by a giving.record holder), reinstatement (offsets an earlier reversal). Written only by DEFINER functions under presby.giving_write_active; UPDATE always raises. giving_reversals_bound keeps the net reversed within 0..gift.amount_cents.';
comment on table giving_settlements is
  'Payouts (po_) from the connected account, read-only reconciliation (Batch 6, droppable). Gifts are the truth; settlements reconcile to them.';
comment on table giving_settlement_lines is
  'Balance-transaction lines of a payout. Signed bigint amounts (P3-13): net = gross - fee.';

-- ---------------------------------------------------------------------------
-- 14. Triggers on the giving tables. They fire on EVERY connection - BYPASSRLS
--     and ownership exempt a role from policies and grants, never from
--     triggers (F44). Every function is SECURITY DEFINER with
--     search_path = public, pg_temp (DECISION-148): where a guard reads a
--     table it must see the whole truth, not an RLS-filtered slice (F26).
-- ---------------------------------------------------------------------------

-- (14a) The delete guard (P3-8), one body for every guarded table. Passes when
-- (A) the row's own deletable_until is in the future, or (B) the parent
-- organizations row no longer exists - the sanctioned org-teardown cascade:
-- presby_guard_organizations_delete() (drizzle/0044) has already validated
-- the org's own deletable_until, and the RI cascade fires after the org row is
-- gone. deletable_until is read through to_jsonb(old) so tables without the
-- column (giving_provider_events) take arm B only.
create or replace function presby_giving_guard_delete()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_until timestamptz := (to_jsonb(old) ->> 'deletable_until')::timestamptz;
begin
  if v_until is not null and v_until > now() then
    return old;
  end if;
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception
    '%: giving records are permanent; record a reversal or retire instead of deleting', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists giving_donors_delete_guard on giving_donors;
create trigger giving_donors_delete_guard
  before delete on giving_donors
  for each row execute function presby_giving_guard_delete();
drop trigger if exists giving_gifts_delete_guard on giving_gifts;
create trigger giving_gifts_delete_guard
  before delete on giving_gifts
  for each row execute function presby_giving_guard_delete();
drop trigger if exists giving_reversals_delete_guard on giving_gift_reversals;
create trigger giving_reversals_delete_guard
  before delete on giving_gift_reversals
  for each row execute function presby_giving_guard_delete();
drop trigger if exists giving_events_delete_guard on giving_provider_events;
create trigger giving_events_delete_guard
  before delete on giving_provider_events
  for each row execute function presby_giving_guard_delete();

-- (14b) giving_gifts_write_guard. INSERT and UPDATE need the marker. UPDATE
-- may change ONLY: status pending -> succeeded|failed (status_changed_at is
-- stamped here), failure_code null -> value on that -> failed transition,
-- fee_cents + net_cents null -> value together (set once), and method
-- null -> value on an online gift. Everything else is compared with
-- to_jsonb(old) - cols = to_jsonb(new) - cols (the drizzle/0047 idiom).
create or replace function presby_giving_guard_gift_write()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_mutable text[] := array['status', 'status_changed_at', 'failure_code', 'fee_cents', 'net_cents', 'method'];
begin
  if coalesce(current_setting('presby.giving_write_active', true), '') <> 'true' then
    raise exception 'giving_gifts: gifts are written only by the giving functions'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;

  if (to_jsonb(old) - v_mutable) <> (to_jsonb(new) - v_mutable) then
    raise exception 'giving_gifts %: a gift is frozen; record a reversal instead', old.id
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status not in ('succeeded', 'failed') then
      raise exception 'giving_gifts %: status may only move pending -> succeeded or failed (% -> %)',
        old.id, old.status, new.status
        using errcode = 'check_violation';
    end if;
    new.status_changed_at := now();
  elsif new.status_changed_at is distinct from old.status_changed_at then
    raise exception 'giving_gifts %: status_changed_at moves only with status', old.id
      using errcode = 'check_violation';
  end if;

  if new.failure_code is distinct from old.failure_code
     and not (old.failure_code is null and old.status = 'pending' and new.status = 'failed') then
    raise exception 'giving_gifts %: failure_code is set once, on the transition to failed', old.id
      using errcode = 'check_violation';
  end if;

  if (new.fee_cents is distinct from old.fee_cents or new.net_cents is distinct from old.net_cents)
     and not (old.fee_cents is null and old.net_cents is null
              and new.fee_cents is not null and new.net_cents is not null) then
    raise exception 'giving_gifts %: fee and net are set once, together', old.id
      using errcode = 'check_violation';
  end if;

  if new.method is distinct from old.method
     and not (old.method is null and old.source = 'online') then
    raise exception 'giving_gifts %: method is set once, on an online gift', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists giving_gifts_write_guard on giving_gifts;
create trigger giving_gifts_write_guard
  before insert or update on giving_gifts
  for each row execute function presby_giving_guard_gift_write();

-- (14c) giving_reversals_write_guard: INSERT needs the marker; UPDATE always raises.
create or replace function presby_giving_guard_reversal_write()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'giving_gift_reversals %: a reversal is immutable; record an offsetting reversal', old.id
      using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('presby.giving_write_active', true), '') <> 'true' then
    raise exception 'giving_gift_reversals: reversals are written only by the giving functions'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists giving_reversals_write_guard on giving_gift_reversals;
create trigger giving_reversals_write_guard
  before insert or update on giving_gift_reversals
  for each row execute function presby_giving_guard_reversal_write();

-- (14d) giving_reversals_bound. The gift must be succeeded; void only on an
-- offline gift; a reinstatement offsets a non-reinstatement reversal of the
-- same gift and never exceeds what that reversal took minus what has already
-- been reinstated against it; the net reversed stays within 0..amount. The
-- gift row is locked so two concurrent reversals cannot both pass. Raised
-- with CONSTRAINT = 'giving_reversals_bound' so presby_giving_apply_reversal()
-- can dead-letter it as over_reversal (reality is never silently clamped).
create or replace function presby_giving_check_reversal_bound()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_gift_status text;
  v_gift_source text;
  v_gift_amount integer;
  v_offset_kind text;
  v_offset_amount integer;
  v_already_reinstated bigint;
  v_net bigint;
begin
  select g.status, g.source, g.amount_cents
    into v_gift_status, v_gift_source, v_gift_amount
    from giving_gifts g
   where g.id = new.gift_id and g.organization_id = new.organization_id
   for update;

  if v_gift_status is distinct from 'succeeded' then
    raise exception 'giving_gift_reversals: only a succeeded gift can be reversed'
      using errcode = 'check_violation', constraint = 'giving_reversals_bound';
  end if;

  if new.kind = 'void' and v_gift_source <> 'offline' then
    raise exception 'giving_gift_reversals: only an offline gift can be voided'
      using errcode = 'check_violation', constraint = 'giving_reversals_bound';
  end if;

  if new.kind = 'reinstatement' then
    select r.kind, r.amount_cents into v_offset_kind, v_offset_amount
      from giving_gift_reversals r
     where r.id = new.offsets_reversal_id and r.gift_id = new.gift_id
       and r.organization_id = new.organization_id;
    if v_offset_kind is null or v_offset_kind = 'reinstatement' then
      raise exception 'giving_gift_reversals: a reinstatement must offset a reversal of the same gift'
        using errcode = 'check_violation', constraint = 'giving_reversals_bound';
    end if;
    select coalesce(sum(r.amount_cents), 0) into v_already_reinstated
      from giving_gift_reversals r
     where r.offsets_reversal_id = new.offsets_reversal_id and r.kind = 'reinstatement';
    if new.amount_cents > v_offset_amount - v_already_reinstated then
      raise exception 'giving_gift_reversals: a reinstatement exceeds the reversal it offsets'
        using errcode = 'check_violation', constraint = 'giving_reversals_bound';
    end if;
  end if;

  select coalesce(sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end), 0)
    into v_net
    from giving_gift_reversals r
   where r.gift_id = new.gift_id and r.organization_id = new.organization_id;
  v_net := v_net + case when new.kind = 'reinstatement' then -new.amount_cents else new.amount_cents end;

  if v_net < 0 or v_net > v_gift_amount then
    raise exception 'giving_gift_reversals: the net reversed (%) would leave 0..% for gift %',
      v_net, v_gift_amount, new.gift_id
      using errcode = 'check_violation', constraint = 'giving_reversals_bound';
  end if;
  return new;
end $$;

drop trigger if exists giving_reversals_bound on giving_gift_reversals;
create trigger giving_reversals_bound
  before insert on giving_gift_reversals
  for each row execute function presby_giving_check_reversal_bound();

-- (14e) giving_donors_guard. kind is immutable; a merge target must be an
-- identified, unmerged donor of the same org (depth <= 1); a donor others
-- point at cannot itself be merged until they are repointed; a merged donor
-- takes no update except a repoint of its merge (the flatten step) and
-- updated_*. Unidentified donors' contact/link/merge fields are a CHECK.
-- Concurrent merges of A->B and B->C could still produce depth 2; the merge
-- action serializes through one transaction per org in the app (accepted
-- residual, the same class as every other app-serialized write).
create or replace function presby_giving_guard_donor()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_merge_cols text[] := array['merged_into_id', 'merged_at', 'merged_by', 'updated_by', 'updated_at'];
begin
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind then
      raise exception 'giving_donors %: kind is immutable', old.id using errcode = 'check_violation';
    end if;
    if old.merged_into_id is not null
       and (to_jsonb(old) - v_merge_cols) <> (to_jsonb(new) - v_merge_cols) then
      raise exception 'giving_donors %: a merged donor is frozen; edit the donor it was merged into', old.id
        using errcode = 'check_violation';
    end if;
    if old.merged_into_id is not null and new.merged_into_id is null then
      raise exception 'giving_donors %: a merge cannot be undone', old.id using errcode = 'check_violation';
    end if;
  end if;

  if new.merged_into_id is not null
     and (tg_op = 'INSERT' or new.merged_into_id is distinct from old.merged_into_id) then
    if not exists (select 1 from giving_donors d
                    where d.id = new.merged_into_id and d.organization_id = new.organization_id
                      and d.kind = 'identified' and d.merged_into_id is null) then
      raise exception 'giving_donors: a donor can only be merged into an identified, unmerged donor'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from giving_donors d
                where d.merged_into_id = new.id and d.organization_id = new.organization_id) then
      raise exception 'giving_donors %: repoint the donors merged into this one before merging it', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists giving_donors_guard on giving_donors;
create trigger giving_donors_guard
  before insert or update on giving_donors
  for each row execute function presby_giving_guard_donor();

-- (14f) giving_connections_status_guard: disconnected is terminal.
create or replace function presby_giving_guard_connection_status()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'disconnected' and new.status is distinct from 'disconnected' then
    raise exception 'giving_provider_connections %: a disconnected connection is terminal; connect anew', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists giving_connections_status_guard on giving_provider_connections;
create trigger giving_connections_status_guard
  before update of status on giving_provider_connections
  for each row execute function presby_giving_guard_connection_status();

-- (14g) giving_connections_insert_guard (deviation D1 in the header). A
-- connection is born onboarding with nothing enabled, attested, public or
-- disconnected, unless the write marker is armed (fixtures only).
create or replace function presby_giving_guard_connection_insert()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('presby.giving_write_active', true), '') = 'true' then
    return new;
  end if;
  if new.status <> 'onboarding'
     or new.charges_enabled or new.payouts_enabled or new.details_submitted
     or new.card_enabled or new.ach_enabled or new.requirements_due
     or new.disabled_reason is not null
     or new.payouts_attested_at is not null or new.payouts_attested_by is not null
     or new.public_enabled_at is not null or new.public_enabled_by is not null
     or new.disconnected_at is not null or new.disconnected_reason is not null
     or new.last_status_at is not null then
    raise exception 'giving_provider_connections: a new connection starts onboarding; status moves only through the giving functions'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists giving_connections_insert_guard on giving_provider_connections;
create trigger giving_connections_insert_guard
  before insert on giving_provider_connections
  for each row execute function presby_giving_guard_connection_insert();

-- ---------------------------------------------------------------------------
-- 15. DECISION-175 (1), F139: giving keys never travel the commission or
--     delegation arms. presby_effective_permissions() accepts ANY role as a
--     commission/delegation role, which would let a parent council's
--     commission read a congregation's per-member giving. Refused here, on
--     every connection. SECURITY DEFINER is load-bearing: the role belongs to
--     a different org than the row being written, and app_role_permissions is
--     tenant-RLS'd (F26).
-- ---------------------------------------------------------------------------
create or replace function presby_giving_guard_downward_role()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.role_id is not null and exists (
       select 1 from app_role_permissions rp
         join permissions pm on pm.key = rp.permission_key
        where rp.role_id = new.role_id and pm.module = 'giving') then
    raise exception '%: a role carrying a giving key cannot be granted through an administrative commission or delegation (DECISION-175)', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists administrative_commissions_giving_guard on administrative_commissions;
create trigger administrative_commissions_giving_guard
  before insert or update of role_id on administrative_commissions
  for each row execute function presby_giving_guard_downward_role();
drop trigger if exists org_delegations_giving_guard on org_delegations;
create trigger org_delegations_giving_guard
  before insert or update of role_id on org_delegations
  for each row execute function presby_giving_guard_downward_role();

-- Any reference, not only a current one: re-opening an ended commission by
-- moving its ends_on would not fire the role_id trigger above.
create or replace function presby_giving_guard_role_binding()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from permissions pm where pm.key = new.permission_key and pm.module = 'giving')
     and (exists (select 1 from administrative_commissions ac where ac.role_id = new.role_id)
          or exists (select 1 from org_delegations od where od.role_id = new.role_id)) then
    raise exception 'app_role_permissions: a giving key cannot be bound to a role used by an administrative commission or delegation (DECISION-175)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists app_role_permissions_giving_guard on app_role_permissions;
create trigger app_role_permissions_giving_guard
  before insert or update on app_role_permissions
  for each row execute function presby_giving_guard_role_binding();

-- ---------------------------------------------------------------------------
-- 16. Internal helpers - called only from the functions below. EXECUTE is
--     revoked from everyone (a function that only ever runs inside another
--     function needs no grant, drizzle/0044 B-M1).
-- ---------------------------------------------------------------------------

-- Untrusted display text from a provider: control characters become spaces,
-- trimmed, bounded, empty becomes null.
create or replace function presby_giving__clean_text(p_value text, p_max integer)
returns text language sql immutable security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(left(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g')), p_max)), '');
$$;

create or replace function presby_giving__clean_email(p_value text)
returns text language sql immutable security definer
set search_path = public, pg_temp
as $$
  select case when v ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(v) <= 254 then v end
    from (select lower(btrim(coalesce(p_value, ''))) as v) s;
$$;

create or replace function presby_giving__clean_code(p_value text)
returns text language sql immutable security definer
set search_path = public, pg_temp
as $$
  select case when p_value ~ '^[a-z0-9_]{1,60}$' then p_value end;
$$;

-- The org-local date of an instant (F132: a missing settings row means the default zone).
create or replace function presby_giving__local_date(p_org uuid, p_at timestamptz)
returns date language sql stable security definer
set search_path = public, pg_temp
as $$
  select (p_at at time zone coalesce(
            (select s.time_zone from organization_settings s where s.organization_id = p_org),
            'America/New_York'))::date;
$$;

-- Is giving switched on and applicable for this org? (toggle row ON, org type
-- congregation or new worshiping community, org active.) Ingest never calls this.
create or replace function presby_giving__enabled(p_org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organizations o
      join organization_feature_toggles t
        on t.organization_id = o.id and t.feature_key = 'org_portal.giving' and t.enabled
     where o.id = p_org and o.status = 'active'
       and o.organization_type in ('congregation', 'new_worshiping_community'));
$$;

-- The org's live connection (active and gone public), or null.
create or replace function presby_giving__live_connection(p_org uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.id from giving_provider_connections c
   where c.organization_id = p_org and c.status = 'active' and c.public_enabled_at is not null
     and presby_giving__enabled(p_org)
   limit 1;
$$;

-- Resolve (or create) the donor for a provider payment and return the ROOT
-- donor id (merges are flattened, depth <= 1). P3-15: a new customer attaches
-- to an existing donor only when the normalized email AND case-folded name
-- both match exactly one identified, unmerged donor; otherwise a new donor.
create or replace function presby_giving__resolve_donor(
  p_org uuid, p_conn uuid, p_known_donor uuid, p_customer_id text,
  p_name text, p_email text, p_line1 text, p_line2 text, p_city text,
  p_region text, p_postal text, p_country text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_donor uuid := p_known_donor;
  v_customer text := case when p_customer_id ~ '^cus_[A-Za-z0-9]{8,64}$' then p_customer_id end;
  v_name text := presby_giving__clean_text(p_name, 120);
  v_email text := presby_giving__clean_email(p_email);
  v_country text := upper(coalesce(presby_giving__clean_text(p_country, 2), ''));
  v_matches uuid[];
begin
  if v_donor is null and v_customer is not null then
    select i.donor_id into v_donor from giving_donor_identities i
     where i.connection_id = p_conn and i.external_customer_id = v_customer;
  end if;

  if v_donor is null and v_name is not null and v_email is not null then
    select array_agg(d.id) into v_matches from giving_donors d
     where d.organization_id = p_org and d.kind = 'identified' and d.merged_into_id is null
       and d.email = v_email and lower(d.display_name) = lower(v_name);
    if coalesce(array_length(v_matches, 1), 0) = 1 then
      v_donor := v_matches[1];
    end if;
  end if;

  if v_donor is null then
    insert into giving_donors (organization_id, kind, display_name, email,
                               address_line1, address_line2, city, region, postal_code, country)
    values (p_org, 'identified', coalesce(v_name, 'Online donor'), v_email,
            presby_giving__clean_text(p_line1, 120), presby_giving__clean_text(p_line2, 120),
            presby_giving__clean_text(p_city, 120), presby_giving__clean_text(p_region, 120),
            presby_giving__clean_text(p_postal, 120),
            case when v_country ~ '^[A-Z]{2}$' then v_country else 'US' end)
    returning id into v_donor;
  end if;

  select coalesce(d.merged_into_id, d.id) into v_donor
    from giving_donors d where d.id = v_donor and d.organization_id = p_org;

  if v_customer is not null then
    insert into giving_donor_identities (organization_id, donor_id, connection_id, external_customer_id)
    values (p_org, v_donor, p_conn, v_customer)
    on conflict (connection_id, external_customer_id) do nothing;
  end if;
  return v_donor;
end $$;

-- Auto-link (Q10): a signed-in member's own intent links its donor when the
-- donor has no link yet. A different existing link is left alone and
-- surfaced. Returns '', ':autolinked' or ':link_conflict'.
create or replace function presby_giving__autolink(p_org uuid, p_donor uuid, p_membership uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_current uuid;
begin
  if p_membership is null or not exists (
       select 1 from memberships m
        where m.id = p_membership and m.organization_id = p_org and m.ended_on is null) then
    return '';
  end if;
  select d.linked_membership_id into v_current from giving_donors d
   where d.id = p_donor and d.organization_id = p_org and d.kind = 'identified';
  if not found then
    return '';
  end if;
  if v_current is null then
    update giving_donors
       set linked_membership_id = p_membership, link_source = 'self_online', linked_at = now(), linked_by = null
     where id = p_donor and organization_id = p_org;
    return ':autolinked';
  elsif v_current = p_membership then
    return '';
  end if;
  return ':link_conflict';
end $$;

-- The connection-status mapping (stored here; the pure TS twin is
-- providers/stripe/status.ts). active = charges AND payouts AND no
-- requirements due AND no disabled reason; restricted = was active/restricted,
-- or details submitted, but not active; otherwise onboarding.
-- Returns 'applied', 'applied:status_changed' or 'noop' (disconnected).
create or replace function presby_giving__set_connection_status(
  p_conn uuid, p_charges boolean, p_payouts boolean, p_details boolean,
  p_card boolean, p_ach boolean, p_requirements_due boolean, p_disabled_reason text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_new text;
  v_reason text := presby_giving__clean_text(p_disabled_reason, 120);
begin
  select c.status into v_old from giving_provider_connections c where c.id = p_conn for update;
  if v_old is null or v_old = 'disconnected' then
    return 'noop';
  end if;
  if coalesce(p_charges, false) and coalesce(p_payouts, false)
     and not coalesce(p_requirements_due, false) and v_reason is null then
    v_new := 'active';
  elsif v_old in ('active', 'restricted') or coalesce(p_details, false) then
    v_new := 'restricted';
  else
    v_new := 'onboarding';
  end if;
  update giving_provider_connections
     set status = v_new,
         charges_enabled = coalesce(p_charges, false), payouts_enabled = coalesce(p_payouts, false),
         details_submitted = coalesce(p_details, false), card_enabled = coalesce(p_card, false),
         ach_enabled = coalesce(p_ach, false), requirements_due = coalesce(p_requirements_due, false),
         disabled_reason = v_reason, last_status_at = now(), updated_at = now()
   where id = p_conn;
  return case when v_new = v_old then 'applied' else 'applied:status_changed' end;
end $$;

-- The disconnect write, shared by the treasurer path and the deauthorized event.
create or replace function presby_giving__disconnect(p_conn uuid, p_reason text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update giving_provider_connections
     set status = 'disconnected', disconnected_at = now(), disconnected_reason = p_reason,
         public_enabled_at = null, public_enabled_by = null, last_status_at = now(), updated_at = now()
   where id = p_conn and status <> 'disconnected';
  return case when found then 'applied:disconnected' else 'noop' end;
end $$;

-- The shared core of both create-intent variants. Ungranted: the public
-- variant has NO membership parameter at all, so it is structurally unable
-- to link; only presby_giving_create_intent_member() can pass one.
create or replace function presby_giving__create_intent(
  p_org uuid, p_membership_id uuid, p_fund_id uuid, p_gift_amount_cents integer,
  p_cover_fees boolean, p_method text, p_frequency text, p_idempotency_key text)
returns table (outcome text, intent_id uuid, external_account_id text, livemode boolean,
               fund_name text, gift_amount_cents integer, covered_cents integer,
               total_cents integer, methods text[], already_attached boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_conn record;
  v_fund_name text;
  v_existing record;
  v_methods text[];
  v_total integer;
  v_covered integer;
  v_id uuid;
begin
  if p_org is null then
    return query select 'unavailable'::text, null::uuid, null::text, null::boolean, null::text,
                        null::integer, null::integer, null::integer, null::text[], null::boolean;
    return;
  end if;

  -- Idempotency first: a repeated submit returns the intent it already made.
  select i.id, i.gift_amount_cents, i.donor_covered_fee_cents, i.total_cents, i.livemode,
         i.checkout_session_id, i.fund_id, c.external_account_id
    into v_existing
    from giving_checkout_intents i
    join giving_provider_connections c on c.id = i.connection_id
   where i.organization_id = p_org and i.idempotency_key = p_idempotency_key;
  if found then
    select coalesce(f.online_display_name, f.name) into v_fund_name from giving_funds f where f.id = v_existing.fund_id;
    return query select 'existing'::text, v_existing.id, v_existing.external_account_id, v_existing.livemode,
                        v_fund_name, v_existing.gift_amount_cents, v_existing.donor_covered_fee_cents,
                        v_existing.total_cents, null::text[], v_existing.checkout_session_id is not null;
    return;
  end if;

  select c.id, c.external_account_id, c.livemode, c.card_enabled, c.ach_enabled,
         c.card_fee_bps, c.card_fee_fixed_cents, c.ach_fee_bps, c.ach_fee_cap_cents
    into v_conn
    from giving_provider_connections c
   where c.id = presby_giving__live_connection(p_org);
  if not found then
    return query select 'unavailable'::text, null::uuid, null::text, null::boolean, null::text,
                        null::integer, null::integer, null::integer, null::text[], null::boolean;
    return;
  end if;

  v_methods := array_remove(array[case when v_conn.card_enabled then 'card' end,
                                  case when v_conn.ach_enabled then 'bank' end], null);

  select coalesce(f.online_display_name, f.name) into v_fund_name
    from giving_funds f
   where f.id = p_fund_id and f.organization_id = p_org and f.is_active and f.offered_online;

  if v_fund_name is null
     or p_gift_amount_cents is null or p_gift_amount_cents < 100 or p_gift_amount_cents > 2500000
     or p_frequency is null or p_frequency not in ('once', 'monthly')
     or p_method is null or p_method not in ('card', 'bank', 'either')
     or (coalesce(p_cover_fees, false) and p_method = 'either')
     or (p_method <> 'either' and not (p_method = any (v_methods)))
     or (p_method = 'either' and coalesce(array_length(v_methods, 1), 0) = 0)
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return query select 'invalid'::text, null::uuid, null::text, null::boolean, null::text,
                        null::integer, null::integer, null::integer, null::text[], null::boolean;
    return;
  end if;

  -- The DB flood cap: the 201st `created` intent for this org in an hour is refused.
  if (select count(*) from giving_checkout_intents i
       where i.organization_id = p_org and i.status = 'created'
         and i.created_at > now() - interval '1 hour') >= 200 then
    return query select 'rate_limited'::text, null::uuid, null::text, null::boolean, null::text,
                        null::integer, null::integer, null::integer, null::text[], null::boolean;
    return;
  end if;

  if coalesce(p_cover_fees, false) then
    v_total := presby_giving_gross_up(p_gift_amount_cents, p_method,
                 v_conn.card_fee_bps, v_conn.card_fee_fixed_cents, v_conn.ach_fee_bps, v_conn.ach_fee_cap_cents);
  else
    v_total := p_gift_amount_cents;
  end if;
  v_covered := v_total - p_gift_amount_cents;

  insert into giving_checkout_intents (organization_id, connection_id, fund_id, membership_id,
         frequency, method_choice, cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents,
         livemode, idempotency_key, status, expires_at)
  values (p_org, v_conn.id, p_fund_id, p_membership_id,
          p_frequency, p_method, coalesce(p_cover_fees, false), p_gift_amount_cents, v_covered, v_total,
          v_conn.livemode, p_idempotency_key, 'created', now() + interval '24 hours')
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- A concurrent submit with the same key won the race: report it as existing.
    return query select x.* from presby_giving__create_intent(p_org, p_membership_id, p_fund_id,
      p_gift_amount_cents, p_cover_fees, p_method, p_frequency, p_idempotency_key) x;
    return;
  end if;

  return query select 'created'::text, v_id, v_conn.external_account_id, v_conn.livemode, v_fund_name,
                      p_gift_amount_cents, v_covered, v_total, v_methods, false;
end $$;

-- ---------------------------------------------------------------------------
-- 17. The SECURITY DEFINER family. ORG-DERIVATION RULE, one per caller class:
--     webhook/cron path = inbox row -> connection row -> organization (never
--     a parameter); public path = p_slug -> organizations.slug; tenant path =
--     presby_current_org() (already verified by withOrgContext), with a
--     uniform insufficient_privilege when null; owner-only = no org needed.
--     Every function: security definer, search_path = public, pg_temp
--     (DECISION-148), revoke all from public, then an explicit grant.
-- ---------------------------------------------------------------------------

-- (17a) The gross-up, exact numeric math. IMMUTABLE and INVOKER: it reads
-- nothing. Returns the TOTAL to charge so that, after the fee, the
-- congregation receives p_amount_cents. card: ceil((G + fixed) * 10^4 /
-- (10^4 - bps)); bank: least(ceil(G * 10^4 / (10^4 - bps)), G + cap).
create or replace function presby_giving_gross_up(
  p_amount_cents integer, p_method text, p_card_fee_bps integer, p_card_fee_fixed_cents integer,
  p_ach_fee_bps integer, p_ach_fee_cap_cents integer)
returns integer language sql immutable
set search_path = public, pg_temp
as $$
  select case p_method
    when 'card' then ceil((p_amount_cents::numeric + p_card_fee_fixed_cents) * 10000
                          / (10000 - p_card_fee_bps))::integer
    when 'bank' then least(ceil(p_amount_cents::numeric * 10000 / (10000 - p_ach_fee_bps)),
                           p_amount_cents::numeric + p_ach_fee_cap_cents)::integer
  end;
$$;

-- (17b) Ingest. Takes NO org id: the connection is resolved by
-- (provider, external_account_id) regardless of its status (a disconnected
-- connection still ingests, G22). Unknown account, malformed ids or a
-- livemode mismatch -> ignored, nothing written. The route returns one
-- identical 200 for accepted, duplicate and ignored.
create or replace function presby_giving_ingest_event(
  p_provider giving_provider, p_account text, p_event_id text, p_livemode boolean,
  p_event_type text, p_raw_body text)
returns table (outcome text, inbox_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_conn record;
  v_id uuid;
begin
  if p_account is null or p_account !~ '^acct_[A-Za-z0-9]{8,64}$'
     or p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]{8,64}$'
     or p_event_type is null or char_length(p_event_type) > 100 or p_event_type !~ '^[a-z0-9_.]+$'
     or p_raw_body is null or octet_length(p_raw_body) > 1000000
     or p_livemode is null then
    return query select 'ignored'::text, null::uuid;
    return;
  end if;

  select c.id, c.organization_id, c.livemode into v_conn
    from giving_provider_connections c
   where c.provider = p_provider and c.external_account_id = p_account;
  if not found or v_conn.livemode is distinct from p_livemode then
    return query select 'ignored'::text, null::uuid;
    return;
  end if;

  insert into giving_provider_events (organization_id, connection_id, provider, external_event_id,
                                      event_type, livemode, raw_body)
  values (v_conn.organization_id, v_conn.id, p_provider, p_event_id, p_event_type, p_livemode, p_raw_body)
  on conflict (connection_id, external_event_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return query select 'accepted'::text, v_id;
    return;
  end if;
  select e.id into v_id from giving_provider_events e
   where e.connection_id = v_conn.id and e.external_event_id = p_event_id;
  return query select 'duplicate'::text, v_id;
end $$;

-- (17c) Claim: zero rows unless claimable (received/parked and due, or
-- processing with an expired lease). Sets processing, a 2-minute lease and
-- attempts + 1, and returns the body.
create or replace function presby_giving_claim_event(p_inbox_id uuid)
returns table (raw_body text, event_type text, attempts integer, body_purged boolean,
               connection_id uuid, external_account_id text, livemode boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update giving_provider_events e
       set status = 'processing', locked_until = now() + interval '2 minutes', attempts = e.attempts + 1
     where e.id = p_inbox_id
       and ((e.status in ('received', 'parked') and e.next_attempt_at <= now())
            or (e.status = 'processing' and (e.locked_until is null or e.locked_until < now())))
    returning e.raw_body, e.event_type, e.attempts, e.body_purged_at, e.connection_id, e.livemode
  )
  select cl.raw_body, cl.event_type, cl.attempts, cl.body_purged_at is not null,
         cl.connection_id, c.external_account_id, cl.livemode
    from claimed cl join giving_provider_connections c on c.id = cl.connection_id;
end $$;

-- (17d) Finish. p_outcome in applied | ignored | parked | failed | dead.
-- parked/failed back off (1, 5, 15, 60, 240, 720 min); failed or parked with
-- attempts >= 8 dead-letters; parked with no_gift/no_subscription ages out to
-- ignored 24 h after received_at (a foreign payment must not clutter dead
-- letters). Terminal states set processed_at. Returns the new status.
create or replace function presby_giving_finish_event(
  p_inbox_id uuid, p_outcome text, p_error_code text default null)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
  v_code text := case when p_error_code is null then null
                      when char_length(p_error_code) <= 60 and p_error_code ~ '^[a-z0-9_:]*$' then p_error_code
                      else 'invalid_code' end;
  v_status text;
  v_backoff interval;
begin
  select e.status, e.attempts, e.received_at into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_ev.status <> 'processing' then
    return 'not_processing';
  end if;

  v_backoff := case
    when v_ev.attempts <= 1 then interval '1 minute'
    when v_ev.attempts = 2 then interval '5 minutes'
    when v_ev.attempts = 3 then interval '15 minutes'
    when v_ev.attempts = 4 then interval '60 minutes'
    when v_ev.attempts = 5 then interval '240 minutes'
    else interval '720 minutes' end;

  if p_outcome in ('applied', 'ignored') then
    v_status := p_outcome;
  elsif p_outcome = 'dead' then
    v_status := 'dead_letter';
  elsif p_outcome = 'parked' and v_code in ('no_gift', 'no_subscription') then
    v_status := case when v_ev.received_at < now() - interval '24 hours' then 'ignored' else 'parked' end;
  elsif p_outcome in ('parked', 'failed') then
    v_status := case when v_ev.attempts >= 8 then 'dead_letter' else 'parked' end;
  else
    raise exception 'presby_giving_finish_event: unknown outcome %', p_outcome
      using errcode = 'invalid_parameter_value';
  end if;

  update giving_provider_events
     set status = v_status,
         last_error = v_code,
         locked_until = null,
         next_attempt_at = case when v_status = 'parked' then now() + v_backoff else next_attempt_at end,
         processed_at = case when v_status in ('applied', 'ignored', 'dead_letter') then now() else null end
   where id = p_inbox_id;
  return v_status;
end $$;

-- (17e) Due events: cross-org by nature; opaque ids only (residual accepted, DECISION-171).
create or replace function presby_giving_due_events(p_limit integer default 25)
returns table (inbox_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.id from giving_provider_events e
   where (e.status in ('received', 'parked') and e.next_attempt_at <= now())
      or (e.status = 'processing' and (e.locked_until is null or e.locked_until < now()))
   order by e.received_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

-- (17f) Apply a gift event. Fund and membership come from the INTENT ONLY.
-- Payment mode: intent by checkout session; subscription renewals: intent by
-- subscription. occurred_on is computed in SQL in the org's zone (F132).
-- Returns applied | applied:autolinked | applied:link_conflict | noop |
-- parked:<code> | ignored:<code> | dead:<code>.
create or replace function presby_giving_apply_gift(
  p_inbox_id uuid, p_status text, p_session_id text, p_subscription_id text, p_invoice_id text,
  p_payment_intent_id text, p_amount_cents integer, p_authorized_at timestamptz, p_failure_code text,
  p_customer_id text, p_donor_name text, p_donor_email text, p_addr_line1 text, p_addr_line2 text,
  p_addr_city text, p_addr_region text, p_addr_postal text, p_addr_country text, p_method text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
  v_intent record;
  v_gift record;
  v_first boolean;
  v_donor uuid;
  v_link text := '';
  v_method text := case when p_method in ('card', 'us_bank_account', 'wallet') then p_method end;
  v_covered integer;
begin
  select e.organization_id, e.connection_id, e.livemode, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;

  if p_status is null or p_status not in ('pending', 'succeeded', 'failed') then return 'dead:bad_status'; end if;
  if p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]{8,64}$' then
    return 'dead:bad_payment_intent';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then return 'dead:bad_amount'; end if;
  if p_authorized_at is null then return 'dead:bad_time'; end if;

  if p_session_id is not null then
    select i.* into v_intent from giving_checkout_intents i
     where i.connection_id = v_ev.connection_id and i.checkout_session_id = p_session_id;
    if not found then return 'ignored:no_intent'; end if;
    if v_intent.frequency <> 'once' then return 'dead:mode_mismatch'; end if;
  elsif p_subscription_id is not null then
    select i.* into v_intent from giving_checkout_intents i
     where i.connection_id = v_ev.connection_id and i.subscription_id = p_subscription_id;
    if not found then return 'parked:no_subscription'; end if;
  else
    return 'dead:no_reference';
  end if;

  -- An existing gift for this PaymentIntent: idempotent, or a legal transition.
  select g.id, g.status, g.intent_id into v_gift from giving_gifts g
   where g.connection_id = v_ev.connection_id and g.external_transaction_id = p_payment_intent_id;
  if found then
    if v_gift.intent_id is distinct from v_intent.id then return 'dead:intent_mismatch'; end if;
    if v_gift.status = p_status or p_status = 'pending' then
      return 'noop';   -- a duplicate, or an older state arriving late
    end if;
    if v_gift.status <> 'pending' then return 'dead:illegal_transition'; end if;
    perform set_config('presby.giving_write_active', 'true', true);
    update giving_gifts
       set status = p_status,
           failure_code = case when p_status = 'failed' then presby_giving__clean_code(p_failure_code) end,
           method = coalesce(method, v_method)
     where id = v_gift.id;
    perform set_config('presby.giving_write_active', 'false', true);
    return 'applied';
  end if;

  v_first := not exists (select 1 from giving_gifts g where g.intent_id = v_intent.id);

  -- P3-16: a failed renewal is a flag on the schedule, never a gift row.
  if p_status = 'failed' and v_intent.frequency = 'monthly' then
    update giving_checkout_intents set last_payment_failed_at = p_authorized_at where id = v_intent.id;
    return 'ignored:renewal_failed';
  end if;

  if v_first then
    if p_amount_cents <> v_intent.total_cents then return 'dead:amount_mismatch'; end if;
    v_covered := v_intent.donor_covered_fee_cents;
  elsif p_amount_cents = v_intent.total_cents then
    v_covered := v_intent.donor_covered_fee_cents;
  else
    v_covered := 0;   -- a schedule changed in the Stripe Dashboard: record what was collected
  end if;

  v_donor := presby_giving__resolve_donor(v_ev.organization_id, v_ev.connection_id, v_intent.donor_id,
               p_customer_id, p_donor_name, p_donor_email, p_addr_line1, p_addr_line2, p_addr_city,
               p_addr_region, p_addr_postal, p_addr_country);
  v_link := presby_giving__autolink(v_ev.organization_id, v_donor, v_intent.membership_id);

  perform set_config('presby.giving_write_active', 'true', true);
  insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
         external_transaction_id, method, amount_cents, donor_covered_fee_cents, status, failure_code,
         occurred_on, occurred_at, livemode, source_event_id)
  values (v_ev.organization_id, v_donor, v_intent.fund_id, 'online', 'stripe', v_ev.connection_id, v_intent.id,
          p_payment_intent_id, v_method, p_amount_cents, v_covered, p_status,
          case when p_status = 'failed' then presby_giving__clean_code(p_failure_code) end,
          presby_giving__local_date(v_ev.organization_id, p_authorized_at), p_authorized_at,
          v_ev.livemode, p_inbox_id);
  perform set_config('presby.giving_write_active', 'false', true);

  update giving_checkout_intents
     set donor_id = coalesce(donor_id, v_donor),
         payment_intent_id = case when frequency = 'once' then coalesce(payment_intent_id, p_payment_intent_id)
                                  else payment_intent_id end,
         status = case when status in ('created', 'open') then 'completed' else status end,
         completed_at = coalesce(completed_at, now())
   where id = v_intent.id;

  return 'applied' || v_link;
end $$;

-- (17g) Fee and net, set once (and method, if still null).
create or replace function presby_giving_apply_gift_fee(
  p_inbox_id uuid, p_payment_intent_id text, p_fee_cents integer, p_net_cents integer, p_method text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
  v_gift record;
  v_method text := case when p_method in ('card', 'us_bank_account', 'wallet') then p_method end;
begin
  select e.organization_id, e.connection_id, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;

  select g.id, g.amount_cents, g.fee_cents, g.net_cents, g.method into v_gift from giving_gifts g
   where g.connection_id = v_ev.connection_id and g.external_transaction_id = p_payment_intent_id;
  if not found then return 'parked:no_gift'; end if;

  if p_fee_cents is null or p_net_cents is null or p_fee_cents < 0
     or p_net_cents <> v_gift.amount_cents - p_fee_cents then
    return 'dead:fee_mismatch';
  end if;
  if v_gift.fee_cents is not null then
    return case when v_gift.fee_cents = p_fee_cents then 'noop' else 'dead:fee_conflict' end;
  end if;

  perform set_config('presby.giving_write_active', 'true', true);
  update giving_gifts
     set fee_cents = p_fee_cents, net_cents = p_net_cents, method = coalesce(method, v_method)
   where id = v_gift.id;
  perform set_config('presby.giving_write_active', 'false', true);
  return 'applied';
end $$;

-- (17h) Reversals from provider events (refund, dispute, ach_return,
-- reinstatement). Idempotent on (connection_id, external_reversal_id).
create or replace function presby_giving_apply_reversal(
  p_inbox_id uuid, p_payment_intent_id text, p_kind text, p_external_reversal_id text,
  p_amount_cents integer, p_occurred_at timestamptz, p_offsets_external_reversal_id text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
  v_gift record;
  v_offsets uuid;
  v_constraint text;
begin
  select e.organization_id, e.connection_id, e.livemode, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;

  if p_kind is null or p_kind not in ('refund', 'dispute', 'ach_return', 'reinstatement') then return 'dead:bad_kind'; end if;
  if p_external_reversal_id is null or char_length(p_external_reversal_id) not between 1 and 255 then
    return 'dead:bad_reference';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 then return 'dead:bad_amount'; end if;
  if p_occurred_at is null then return 'dead:bad_time'; end if;

  if exists (select 1 from giving_gift_reversals r
              where r.connection_id = v_ev.connection_id and r.external_reversal_id = p_external_reversal_id) then
    return 'noop';
  end if;

  select g.id, g.status into v_gift from giving_gifts g
   where g.connection_id = v_ev.connection_id and g.external_transaction_id = p_payment_intent_id;
  if not found then return 'parked:no_gift'; end if;
  if v_gift.status = 'pending' then return 'parked:gift_pending'; end if;
  if v_gift.status = 'failed' then return 'ignored:gift_failed'; end if;

  if p_kind = 'reinstatement' then
    select r.id into v_offsets from giving_gift_reversals r
     where r.connection_id = v_ev.connection_id and r.external_reversal_id = p_offsets_external_reversal_id
       and r.gift_id = v_gift.id;
    if v_offsets is null then return 'parked:no_reversal'; end if;
  end if;

  begin
    perform set_config('presby.giving_write_active', 'true', true);
    insert into giving_gift_reversals (organization_id, gift_id, connection_id, kind, amount_cents,
           external_reversal_id, offsets_reversal_id, occurred_on, occurred_at, livemode, source_event_id)
    values (v_ev.organization_id, v_gift.id, v_ev.connection_id, p_kind, p_amount_cents,
            p_external_reversal_id, v_offsets,
            presby_giving__local_date(v_ev.organization_id, p_occurred_at), p_occurred_at,
            v_ev.livemode, p_inbox_id);
    perform set_config('presby.giving_write_active', 'false', true);
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'giving_reversals_bound' then
      return 'dead:over_reversal';
    end if;
    raise;
  end;
  perform set_config('presby.giving_write_active', 'false', true);
  return 'applied';
end $$;

-- (17i) Subscriptions. started: record subscription/customer on the
-- (payment-session) intent, resolve the donor, auto-link; ended; payment_failed.
create or replace function presby_giving_apply_subscription(
  p_inbox_id uuid, p_kind text, p_session_id text, p_subscription_id text, p_customer_id text,
  p_donor_name text, p_donor_email text, p_addr_line1 text, p_addr_line2 text, p_addr_city text,
  p_addr_region text, p_addr_postal text, p_addr_country text, p_at timestamptz)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
  v_intent record;
  v_donor uuid;
  v_link text;
begin
  select e.organization_id, e.connection_id, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;
  if p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9_]{8,64}$' then
    return 'dead:bad_subscription';
  end if;

  if p_kind = 'started' then
    select i.* into v_intent from giving_checkout_intents i
     where i.connection_id = v_ev.connection_id and i.checkout_session_id = p_session_id;
    if not found then return 'ignored:no_intent'; end if;
    if v_intent.frequency <> 'monthly' then return 'dead:mode_mismatch'; end if;
    if v_intent.subscription_id is not null then
      return case when v_intent.subscription_id = p_subscription_id then 'noop' else 'dead:subscription_conflict' end;
    end if;
    v_donor := presby_giving__resolve_donor(v_ev.organization_id, v_ev.connection_id, v_intent.donor_id,
                 p_customer_id, p_donor_name, p_donor_email, p_addr_line1, p_addr_line2, p_addr_city,
                 p_addr_region, p_addr_postal, p_addr_country);
    v_link := presby_giving__autolink(v_ev.organization_id, v_donor, v_intent.membership_id);
    update giving_checkout_intents
       set subscription_id = p_subscription_id,
           customer_id = case when p_customer_id ~ '^cus_[A-Za-z0-9]{8,64}$' then p_customer_id end,
           donor_id = v_donor,
           status = case when status in ('created', 'open') then 'completed' else status end,
           completed_at = coalesce(completed_at, now())
     where id = v_intent.id;
    return 'applied' || v_link;
  elsif p_kind in ('ended', 'payment_failed') then
    select i.* into v_intent from giving_checkout_intents i
     where i.connection_id = v_ev.connection_id and i.subscription_id = p_subscription_id;
    if not found then return 'parked:no_subscription'; end if;
    if p_kind = 'ended' then
      if v_intent.subscription_ended_at is not null then return 'noop'; end if;
      update giving_checkout_intents set subscription_ended_at = coalesce(p_at, now()) where id = v_intent.id;
    else
      update giving_checkout_intents set last_payment_failed_at = coalesce(p_at, now()) where id = v_intent.id;
    end if;
    return 'applied';
  end if;
  return 'dead:bad_kind';
end $$;

-- (17j) A Checkout session expired: created/open -> expired.
create or replace function presby_giving_apply_intent_expired(p_inbox_id uuid, p_session_id text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
begin
  select e.connection_id, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;
  update giving_checkout_intents set status = 'expired'
   where connection_id = v_ev.connection_id and checkout_session_id = p_session_id
     and status in ('created', 'open');
  if found then return 'applied'; end if;
  if exists (select 1 from giving_checkout_intents i
              where i.connection_id = v_ev.connection_id and i.checkout_session_id = p_session_id) then
    return 'noop';
  end if;
  return 'ignored:no_intent';
end $$;

-- (17k) Settlement header (Batch 3).
create or replace function presby_giving_apply_settlement(
  p_inbox_id uuid, p_external_settlement_id text, p_status text, p_arrival_date date,
  p_gross_cents bigint, p_automatic boolean)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
begin
  select e.organization_id, e.connection_id, e.livemode, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;
  if p_external_settlement_id is null or p_external_settlement_id !~ '^po_[A-Za-z0-9_]{8,64}$' then
    return 'dead:bad_reference';
  end if;
  if p_status is null or p_status not in ('paid', 'failed') then return 'dead:bad_status'; end if;
  if p_gross_cents is null or p_gross_cents < 0 then return 'dead:bad_amount'; end if;

  insert into giving_settlements (organization_id, connection_id, external_settlement_id, arrival_date,
                                  status, automatic, gross_cents, livemode)
  values (v_ev.organization_id, v_ev.connection_id, p_external_settlement_id, p_arrival_date,
          p_status, coalesce(p_automatic, true), p_gross_cents, v_ev.livemode)
  on conflict (connection_id, external_settlement_id) do update
     set status = excluded.status, arrival_date = excluded.arrival_date, gross_cents = excluded.gross_cents;
  return 'applied';
end $$;

-- (17l) Settlement lines (Batch 6): typed parallel arrays, no jsonb.
create or replace function presby_giving_apply_settlement_lines(
  p_inbox_id uuid, p_external_settlement_id text, p_txn_ids text[], p_kinds text[],
  p_gross bigint[], p_fee bigint[], p_net bigint[], p_payment_intents text[])
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
  v_settlement uuid;
  v_n integer := coalesce(array_length(p_txn_ids, 1), 0);
begin
  select e.organization_id, e.connection_id, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;

  select s.id into v_settlement from giving_settlements s
   where s.connection_id = v_ev.connection_id and s.external_settlement_id = p_external_settlement_id;
  if v_settlement is null then return 'parked:no_settlement'; end if;

  if coalesce(array_length(p_kinds, 1), 0) <> v_n or coalesce(array_length(p_gross, 1), 0) <> v_n
     or coalesce(array_length(p_fee, 1), 0) <> v_n or coalesce(array_length(p_net, 1), 0) <> v_n
     or coalesce(array_length(p_payment_intents, 1), 0) <> v_n then
    return 'dead:bad_lines';
  end if;

  insert into giving_settlement_lines (organization_id, settlement_id, gift_id, external_balance_transaction_id,
                                       payment_intent_id, kind, gross_cents, fee_cents, net_cents)
  select v_ev.organization_id, v_settlement,
         (select g.id from giving_gifts g
           where g.connection_id = v_ev.connection_id and g.external_transaction_id = l.pi),
         l.txn, l.pi, l.kind, l.gross, l.fee, l.net
    from unnest(p_txn_ids, p_kinds, p_gross, p_fee, p_net, p_payment_intents)
         as l(txn, kind, gross, fee, net, pi)
  on conflict (settlement_id, external_balance_transaction_id) do nothing;

  update giving_settlements set lines_loaded_at = now() where id = v_settlement;
  return 'applied';
end $$;

-- (17m) Connection status from an account.updated / deauthorized event.
create or replace function presby_giving_apply_connection_status(
  p_inbox_id uuid, p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_card_enabled boolean, p_ach_enabled boolean, p_requirements_due boolean, p_disabled_reason text,
  p_deauthorized boolean)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ev record;
begin
  select e.connection_id, e.status into v_ev
    from giving_provider_events e where e.id = p_inbox_id for update;
  if not found then return 'ignored:no_event'; end if;
  if v_ev.status <> 'processing' then return 'ignored:not_claimed'; end if;
  if coalesce(p_deauthorized, false) then
    return presby_giving__disconnect(v_ev.connection_id, 'deauthorized');
  end if;
  return presby_giving__set_connection_status(v_ev.connection_id, p_charges_enabled, p_payouts_enabled,
           p_details_submitted, p_card_enabled, p_ach_enabled, p_requirements_due, p_disabled_reason);
end $$;

-- (17n) The return-page / "Refresh status" path (tenant).
create or replace function presby_giving_refresh_my_connection(
  p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_card_enabled boolean, p_ach_enabled boolean, p_requirements_due boolean, p_disabled_reason text)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_conn uuid;
begin
  if v_org is null then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;
  select c.id into v_conn from giving_provider_connections c
   where c.organization_id = v_org and c.status <> 'disconnected';
  if v_conn is null then return 'none'; end if;
  return presby_giving__set_connection_status(v_conn, p_charges_enabled, p_payouts_enabled,
           p_details_submitted, p_card_enabled, p_ach_enabled, p_requirements_due, p_disabled_reason);
end $$;

-- (17o) Local disconnect (tenant): the Stripe account is neither closed nor deauthorized.
create or replace function presby_giving_disconnect_my_connection()
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_conn uuid;
begin
  if v_org is null then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;
  select c.id into v_conn from giving_provider_connections c
   where c.organization_id = v_org and c.status <> 'disconnected';
  if v_conn is null then return 'none'; end if;
  return presby_giving__disconnect(v_conn, 'treasurer');
end $$;

-- (17p) Record an offline gift (tenant). p_recorded_by is a bounded identity
-- claim (drizzle/0052 note 3): the user's live person must be an active
-- member of the acting org AND hold giving.record there (deviation D2).
-- Refusals: insufficient_privilege 'giving: not permitted' for identity;
-- check_violation 'giving_offline_gift: <code>' for state, where code is
-- donor_unavailable | fund_unavailable | method_not_allowed |
-- date_out_of_range | amount_out_of_range | shape_invalid.
create or replace function presby_giving__actor_may_record(p_org uuid, p_user_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from people pe
     where pe.user_id = p_user_id and pe.merged_into_id is null
       and presby_membership_is_active(pe.id, p_org)
       and presby_has_permission(pe.id, p_org, 'giving.record'));
$$;

create or replace function presby_giving_record_offline_gift(
  p_donor_id uuid, p_fund_id uuid, p_occurred_on date, p_method text, p_amount_cents integer,
  p_check_number text, p_stock_description text, p_stock_quantity numeric, p_memo text,
  p_recorded_by uuid)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_donor record;
  v_id uuid;
  v_check text := presby_giving__clean_text(p_check_number, 30);
  v_stock text := presby_giving__clean_text(p_stock_description, 200);
  v_memo text := presby_giving__clean_text(p_memo, 500);
begin
  if v_org is null or p_recorded_by is null or not presby_giving__actor_may_record(v_org, p_recorded_by) then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;

  select d.kind, d.merged_into_id into v_donor from giving_donors d
   where d.id = p_donor_id and d.organization_id = v_org;
  if not found or v_donor.merged_into_id is not null then
    raise exception 'giving_offline_gift: donor_unavailable' using errcode = 'check_violation';
  end if;
  if p_method is null or p_method not in ('cash', 'check', 'stock', 'other')
     or (v_donor.kind = 'unidentified' and p_method <> 'cash') then
    raise exception 'giving_offline_gift: method_not_allowed' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from giving_funds f
                  where f.id = p_fund_id and f.organization_id = v_org and f.is_active) then
    raise exception 'giving_offline_gift: fund_unavailable' using errcode = 'check_violation';
  end if;
  if p_occurred_on is null or p_occurred_on < date '2000-01-01'
     or p_occurred_on > presby_giving__local_date(v_org, now()) then
    raise exception 'giving_offline_gift: date_out_of_range' using errcode = 'check_violation';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then
    raise exception 'giving_offline_gift: amount_out_of_range' using errcode = 'check_violation';
  end if;
  if (v_check is not null and p_method <> 'check')
     or ((p_method = 'stock') <> (v_stock is not null))
     or (p_stock_quantity is not null and (p_method <> 'stock' or p_stock_quantity <= 0)) then
    raise exception 'giving_offline_gift: shape_invalid' using errcode = 'check_violation';
  end if;

  perform set_config('presby.giving_write_active', 'true', true);
  insert into giving_gifts (organization_id, donor_id, fund_id, source, method, check_number,
         stock_description, stock_quantity, memo, amount_cents, status, occurred_on, livemode, recorded_by)
  values (v_org, p_donor_id, p_fund_id, 'offline', p_method, v_check, v_stock,
          case when p_method = 'stock' then p_stock_quantity end, v_memo, p_amount_cents, 'succeeded',
          p_occurred_on, true, p_recorded_by)
  returning id into v_id;
  perform set_config('presby.giving_write_active', 'false', true);
  return v_id;
end $$;

-- (17q) Void an offline gift (tenant): inserts the `void` reversal for the
-- full amount. Refusals: insufficient_privilege 'giving: not permitted';
-- check_violation 'giving_void: gift_unavailable | not_offline |
-- already_voided | reason_required'.
create or replace function presby_giving_void_gift(p_gift_id uuid, p_reason text, p_voided_by uuid)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
  v_gift record;
  v_reason text := presby_giving__clean_text(p_reason, 200);
  v_id uuid;
begin
  if v_org is null or p_voided_by is null or not presby_giving__actor_may_record(v_org, p_voided_by) then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;
  select g.id, g.source, g.status, g.amount_cents, g.livemode into v_gift from giving_gifts g
   where g.id = p_gift_id and g.organization_id = v_org;
  if not found or v_gift.status <> 'succeeded' then
    raise exception 'giving_void: gift_unavailable' using errcode = 'check_violation';
  end if;
  if v_gift.source <> 'offline' then
    raise exception 'giving_void: not_offline' using errcode = 'check_violation';
  end if;
  if exists (select 1 from giving_gift_reversals r where r.gift_id = p_gift_id and r.kind = 'void') then
    raise exception 'giving_void: already_voided' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'giving_void: reason_required' using errcode = 'check_violation';
  end if;

  perform set_config('presby.giving_write_active', 'true', true);
  insert into giving_gift_reversals (organization_id, gift_id, kind, amount_cents, reason, occurred_on,
                                     recorded_by, livemode)
  values (v_org, p_gift_id, 'void', v_gift.amount_cents, v_reason, presby_giving__local_date(v_org, now()),
          p_voided_by, v_gift.livemode)
  returning id into v_id;
  perform set_config('presby.giving_write_active', 'false', true);
  return v_id;
end $$;

-- (17r) Create an intent from the PUBLIC page: org from the slug only, and
-- NO membership parameter - structurally unable to link.
create or replace function presby_giving_create_intent_public(
  p_slug text, p_fund_id uuid, p_gift_amount_cents integer, p_cover_fees boolean, p_method text,
  p_frequency text, p_idempotency_key text)
returns table (outcome text, intent_id uuid, external_account_id text, livemode boolean,
               fund_name text, gift_amount_cents integer, covered_cents integer,
               total_cents integer, methods text[], already_attached boolean)
language sql security definer
set search_path = public, pg_temp
as $$
  select x.* from presby_giving__create_intent(
    (select o.id from organizations o where o.slug = p_slug),
    null, p_fund_id, p_gift_amount_cents, p_cover_fees, p_method, p_frequency, p_idempotency_key) x;
$$;

-- (17s) Create an intent as a signed-in member: org from presby_current_org();
-- the membership must be active in the acting org. The ONLY path that sets
-- membership_id.
create or replace function presby_giving_create_intent_member(
  p_membership_id uuid, p_fund_id uuid, p_gift_amount_cents integer, p_cover_fees boolean,
  p_method text, p_frequency text, p_idempotency_key text)
returns table (outcome text, intent_id uuid, external_account_id text, livemode boolean,
               fund_name text, gift_amount_cents integer, covered_cents integer,
               total_cents integer, methods text[], already_attached boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
begin
  if v_org is null then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;
  if p_membership_id is null or not exists (
       select 1 from memberships m
        where m.id = p_membership_id and m.organization_id = v_org and m.ended_on is null) then
    return query select 'invalid'::text, null::uuid, null::text, null::boolean, null::text,
                        null::integer, null::integer, null::integer, null::text[], null::boolean;
    return;
  end if;
  return query select x.* from presby_giving__create_intent(v_org, p_membership_id, p_fund_id,
    p_gift_amount_cents, p_cover_fees, p_method, p_frequency, p_idempotency_key) x;
end $$;

-- (17t) Attach the Checkout session id: set once, only while `created` and
-- under 15 minutes old -> open.
create or replace function presby_giving_attach_session(p_intent_id uuid, p_session_id text)
returns boolean language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_]{8,255}$' then
    return false;
  end if;
  update giving_checkout_intents
     set checkout_session_id = p_session_id, status = 'open'
   where id = p_intent_id and status = 'created' and checkout_session_id is null
     and created_at > now() - interval '15 minutes';
  return found;
end $$;

-- (17u) created -> failed (the Checkout session could not be created).
create or replace function presby_giving_fail_intent(p_intent_id uuid)
returns boolean language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update giving_checkout_intents set status = 'failed' where id = p_intent_id and status = 'created';
  return found;
end $$;

-- (17v) The public give surface's one read (R13). ALWAYS exactly one row; no
-- acct_ id and no org id ever. absent = no such org, or no live published
-- site and giving not live (unknown slug, non-tenant slug and toggle-off
-- org are byte-identical); unavailable = site live, giving not live (name and
-- the public contact phone only); live = the form's inputs.
create or replace function presby_public_giving_config(p_slug text)
returns table (state text, organization_name text, livemode boolean, contact_phone text,
               fund_ids uuid[], fund_names text[], card_enabled boolean, ach_enabled boolean,
               card_fee_bps integer, card_fee_fixed_cents integer, ach_fee_bps integer,
               ach_fee_cap_cents integer, min_amount_cents integer, max_amount_cents integer)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org record;
  v_conn record;
  v_ids uuid[];
  v_names text[];
  v_site boolean;
begin
  select o.id, o.name, o.status into v_org from organizations o where o.slug = p_slug;
  if found then
    select c.* into v_conn from giving_provider_connections c
     where c.id = presby_giving__live_connection(v_org.id);
    select array_agg(f.id order by f.sort_order, f.name), array_agg(f.online_display_name order by f.sort_order, f.name)
      into v_ids, v_names
      from giving_funds f
     where f.organization_id = v_org.id and f.is_active and f.offered_online;
    if v_conn.id is not null and v_ids is not null then
      return query select 'live'::text, v_org.name, v_conn.livemode,
             (select p.phone from organization_profiles p where p.organization_id = v_org.id),
             v_ids, v_names, v_conn.card_enabled, v_conn.ach_enabled, v_conn.card_fee_bps,
             v_conn.card_fee_fixed_cents, v_conn.ach_fee_bps, v_conn.ach_fee_cap_cents, 100, 2500000;
      return;
    end if;
    v_site := v_org.status = 'active' and exists (
      select 1 from organization_sites s where s.organization_id = v_org.id and s.status = 'live');
    if v_site then
      return query select 'unavailable'::text, v_org.name, null::boolean,
             (select p.phone from organization_profiles p where p.organization_id = v_org.id),
             null::uuid[], null::text[], null::boolean, null::boolean, null::integer, null::integer,
             null::integer, null::integer, null::integer, null::integer;
      return;
    end if;
  end if;
  return query select 'absent'::text, null::text, null::boolean, null::text, null::uuid[], null::text[],
         null::boolean, null::boolean, null::integer, null::integer, null::integer, null::integer,
         null::integer, null::integer;
end $$;

-- (17w) The return page's read: presby's own rows by Checkout session id.
-- No PII. Not-found, malformed and other-org ids return the identical row.
create or replace function presby_giving_return_state(p_slug text, p_session_id text)
returns table (state text, gift_amount_cents integer, covered_cents integer, fund_name text,
               frequency text, livemode boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_intent record;
  v_state text;
begin
  select i.id, i.status, i.frequency, i.subscription_id, i.gift_amount_cents, i.donor_covered_fee_cents,
         i.livemode, coalesce(f.online_display_name, f.name) as fund_name
    into v_intent
    from giving_checkout_intents i
    join organizations o on o.id = i.organization_id and o.slug = p_slug
    join giving_funds f on f.id = i.fund_id
   where p_session_id ~ '^cs_[A-Za-z0-9_]{8,255}$' and i.checkout_session_id = p_session_id;
  if not found then
    return query select 'unknown'::text, null::integer, null::integer, null::text, null::text, null::boolean;
    return;
  end if;

  if exists (select 1 from giving_gifts g where g.intent_id = v_intent.id and g.status = 'succeeded') then
    v_state := 'received';
  elsif exists (select 1 from giving_gifts g where g.intent_id = v_intent.id and g.status = 'pending') then
    v_state := 'bank_pending';
  elsif exists (select 1 from giving_gifts g where g.intent_id = v_intent.id and g.status = 'failed')
        or v_intent.status in ('failed', 'expired') then
    v_state := 'failed';
  elsif v_intent.frequency = 'monthly' and v_intent.subscription_id is not null then
    v_state := 'received';
  else
    v_state := 'confirming';
  end if;
  return query select v_state, v_intent.gift_amount_cents, v_intent.donor_covered_fee_cents,
                      v_intent.fund_name, v_intent.frequency, v_intent.livemode;
end $$;

-- (17x) The tenant-visible slice of the inbox: counts only (S5).
create or replace function presby_giving_attention_events()
returns table (parked_count bigint, dead_letter_count bigint, oldest_pending_seconds integer)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
begin
  if v_org is null then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;
  return query
  select count(*) filter (where e.status = 'parked'),
         count(*) filter (where e.status = 'dead_letter'),
         extract(epoch from now() - min(e.received_at) filter (where e.status in ('received', 'parked', 'processing')))::integer
    from giving_provider_events e
   where e.organization_id = v_org;
end $$;

-- (17y) Active monthly gifts - feeds the disconnect and toggle-off warnings.
create or replace function presby_giving_active_schedule_count()
returns integer language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := presby_current_org();
begin
  if v_org is null then
    raise exception 'giving: not permitted' using errcode = 'insufficient_privilege';
  end if;
  return (select count(*)::integer from giving_checkout_intents i
           where i.organization_id = v_org and i.frequency = 'monthly'
             and i.subscription_id is not null and i.subscription_ended_at is null);
end $$;

-- (17z) Cron maintenance. Monotone data minimisation: a rogue caller can only
-- do early what cron does.
create or replace function presby_giving_purge_bodies()
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update giving_provider_events
     set raw_body = null, body_purged_at = now()
   where raw_body is not null
     and status in ('applied', 'ignored', 'dead_letter')
     and processed_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function presby_giving_expire_intents()
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update giving_checkout_intents set status = 'expired'
   where status in ('created', 'open') and expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- (17aa) OWNER-ONLY (P3-6): platform ingest health and dead-letter replay,
-- called through getPlatformDb() from src/lib/admin/giving-ingest-health.ts.
-- No amounts, names, bodies or event ids.
create or replace function presby_giving_ingest_health()
returns table (organization_id uuid, connection_id uuid, provider text, livemode boolean, status text,
               received_count bigint, applied_count bigint, parked_count bigint, dead_letter_count bigint,
               last_received_at timestamptz, oldest_pending_seconds integer)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.organization_id, c.id, c.provider::text, c.livemode, c.status,
         count(e.id),
         count(e.id) filter (where e.status = 'applied'),
         count(e.id) filter (where e.status = 'parked'),
         count(e.id) filter (where e.status = 'dead_letter'),
         max(e.received_at),
         extract(epoch from now() - min(e.received_at) filter (where e.status in ('received', 'parked', 'processing')))::integer
    from giving_provider_connections c
    left join giving_provider_events e on e.connection_id = c.id
   group by c.organization_id, c.id, c.provider, c.livemode, c.status
   order by c.organization_id, c.created_at;
$$;

create or replace function presby_giving_requeue_event(p_inbox_id uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update giving_provider_events
     set status = 'received', attempts = 0, next_attempt_at = now(), locked_until = null,
         processed_at = null, last_error = null
   where id = p_inbox_id and status = 'dead_letter';
  if found then return 'requeued'; end if;
  if exists (select 1 from giving_provider_events e where e.id = p_inbox_id) then
    return 'not_dead_letter';
  end if;
  return 'not_found';
end $$;

-- (17bb) EXECUTE. Revoke from everyone first (an in-place re-apply corrects a
-- hand-added grant), then grant presby_app exactly the tenant/ingest/public
-- surface. Internal helpers, trigger functions and the two owner-only
-- functions get no grant at all. presby_platform gets nothing (0052's
-- precedent: a platform-shell role never performs a council's act).
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'presby\_giving\_%' or p.proname = 'presby_public_giving_config')
  loop
    execute format('revoke all on function %s from public, presby_app, presby_platform', f);
  end loop;
end $$;

grant execute on function presby_giving_gross_up(integer, text, integer, integer, integer, integer) to presby_app;
grant execute on function presby_giving_ingest_event(giving_provider, text, text, boolean, text, text) to presby_app;
grant execute on function presby_giving_claim_event(uuid) to presby_app;
grant execute on function presby_giving_finish_event(uuid, text, text) to presby_app;
grant execute on function presby_giving_due_events(integer) to presby_app;
grant execute on function presby_giving_apply_gift(uuid, text, text, text, text, text, integer, timestamptz, text, text, text, text, text, text, text, text, text, text, text) to presby_app;
grant execute on function presby_giving_apply_gift_fee(uuid, text, integer, integer, text) to presby_app;
grant execute on function presby_giving_apply_reversal(uuid, text, text, text, integer, timestamptz, text) to presby_app;
grant execute on function presby_giving_apply_subscription(uuid, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz) to presby_app;
grant execute on function presby_giving_apply_intent_expired(uuid, text) to presby_app;
grant execute on function presby_giving_apply_settlement(uuid, text, text, date, bigint, boolean) to presby_app;
grant execute on function presby_giving_apply_settlement_lines(uuid, text, text[], text[], bigint[], bigint[], bigint[], text[]) to presby_app;
grant execute on function presby_giving_apply_connection_status(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, boolean) to presby_app;
grant execute on function presby_giving_refresh_my_connection(boolean, boolean, boolean, boolean, boolean, boolean, text) to presby_app;
grant execute on function presby_giving_disconnect_my_connection() to presby_app;
grant execute on function presby_giving_record_offline_gift(uuid, uuid, date, text, integer, text, text, numeric, text, uuid) to presby_app;
grant execute on function presby_giving_void_gift(uuid, text, uuid) to presby_app;
grant execute on function presby_giving_create_intent_public(text, uuid, integer, boolean, text, text, text) to presby_app;
grant execute on function presby_giving_create_intent_member(uuid, uuid, integer, boolean, text, text, text) to presby_app;
grant execute on function presby_giving_attach_session(uuid, text) to presby_app;
grant execute on function presby_giving_fail_intent(uuid) to presby_app;
grant execute on function presby_public_giving_config(text) to presby_app;
grant execute on function presby_giving_return_state(text, text) to presby_app;
grant execute on function presby_giving_attention_events() to presby_app;
grant execute on function presby_giving_active_schedule_count() to presby_app;
grant execute on function presby_giving_purge_bodies() to presby_app;
grant execute on function presby_giving_expire_intents() to presby_app;
-- NOT granted (owner only, P3-6): presby_giving_ingest_health(), presby_giving_requeue_event(uuid).

comment on function presby_giving_ingest_event(giving_provider, text, text, boolean, text, text) is
  'Webhook ingest (R6). No org parameter: the connection is resolved by (provider, external_account_id), regardless of its status. accepted | duplicate | ignored (unknown account, malformed ids, livemode mismatch - writes nothing).';
comment on function presby_giving_apply_gift(uuid, text, text, text, text, text, integer, timestamptz, text, text, text, text, text, text, text, text, text, text, text) is
  'Applies a gift event to the inbox row''s connection. Fund and membership come from the checkout intent ONLY (R9). Arms presby.giving_write_active around the gift write. occurred_on is computed in SQL in the org''s zone (F132).';
comment on function presby_giving_record_offline_gift(uuid, uuid, date, text, integer, text, text, numeric, text, uuid) is
  'The only offline-gift writer. Actor = presby_current_org(); p_recorded_by must be an active member holding giving.record there (bounded identity claim, drizzle/0052 note 3, tightened). Arms presby.giving_write_active around the insert.';
comment on function presby_public_giving_config(text) is
  'The public give surface''s one read (R13): exactly one row, state live | unavailable | absent. Never an acct_ id or an org id; absent is byte-identical for an unknown slug, a non-tenant slug and a toggle-off org.';
comment on function presby_giving_ingest_health() is
  'OWNER ONLY (P3-6): per-connection inbox counts for the platform health page. EXECUTE granted to nobody; called through getPlatformDb() from src/lib/admin/giving-ingest-health.ts only.';
comment on function presby_giving_requeue_event(uuid) is
  'OWNER ONLY (P3-6): replays a dead letter (dead_letter -> received, attempts = 0). Audited ORG_GIVING_EVENT_REQUEUED by the caller.';

-- ---------------------------------------------------------------------------
-- 18. presby_two_factor_required(): arm A unchanged (drizzle/0013), arm B new
--     (R4, DECISION-170/175, F140). Arm B: the user's live person, at any
--     active membership, effectively holds a key with requires_two_factor -
--     an inline CTE reproducing presby_effective_permissions()'s four arms,
--     because the resolver needs an org context that sign-in does not have
--     (F26) and R2 pins drizzle/0010 unchanged. Agreement with the real
--     resolver is pinned by src/lib/giving/two-factor-agreement.test.ts and
--     scripts/giving/test-rls-46.sql (46j), and drift is tripwired by an
--     md5(prosrc) pin on presby_effective_permissions.
--     `create or replace` resets proconfig, so search_path is restated here
--     (drizzle/0048 had applied it with ALTER FUNCTION).
--
--     COST (the Phase 3 5 ms budget; this runs in the jwt callback on every
--     authenticated request). Measured on the pipeline branch, PG 18.6: the
--     body EXECUTES in ~1 ms but PLANS in 10-13 ms - a SECURITY DEFINER
--     `language sql` function is never inlined, so its four-arm union is
--     re-planned on every call (12-13 ms per call as first written). Pinning
--     join_collapse_limit / from_collapse_limit to 1 for this function makes
--     the planner take the written join order - every arm is written to start
--     from `me` (the user's own live person and active memberships, a handful
--     of rows) - and cut it to 2.5-3.4 ms per call, cold or warm. Chosen over
--     plpgsql + a cached generic plan (0.6-0.9 ms warm, ~17 ms on every new
--     pooled connection) because it meets the budget on EVERY call and keeps
--     the language the design chose. The explain output is in the work-log
--     (Batch 1a). Re-measure if an arm is added or reordered.
-- ---------------------------------------------------------------------------
create or replace function presby_two_factor_required(p_user_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
set join_collapse_limit = 1
set from_collapse_limit = 1
as $$
  select
    exists (  -- arm A (drizzle/0013, verbatim)
      select 1 from people p
        join memberships m on m.person_id = p.id and m.ended_on is null
        join organization_settings s on s.organization_id = m.organization_id
       where p.user_id = p_user_id and p.merged_into_id is null and s.require_two_factor)
    or exists (  -- arm B
      with me as (
        select p.id as person_id, m.organization_id as org_id
          from people p join memberships m on m.person_id = p.id and m.ended_on is null
         where p.user_id = p_user_id and p.merged_into_id is null),
      tfa as (select key from permissions where requires_two_factor)
      select 1 from me                                              -- resolver arm 1: direct
        join role_grants rg on rg.organization_id = me.org_id and rg.person_id = me.person_id
         and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
        join app_roles r on r.id = rg.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
      union all
      select 1 from me                                              -- arm 2: via group membership
        join role_grants rg on rg.organization_id = me.org_id and rg.group_id is not null
        join groups g on g.id = rg.group_id
        join group_memberships gm on gm.group_id = g.id and gm.person_id = me.person_id
        join app_roles r on r.id = rg.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
       where rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
         and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
      union all
      select 1 from me                                              -- arm 3: administrative commission
        join group_memberships gm on gm.person_id = me.person_id
        join groups g on g.id = gm.group_id
        join administrative_commissions ac on ac.group_id = g.id and ac.target_org_id = me.org_id
        join app_roles r on r.id = ac.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
       where ac.starts_on <= current_date and (ac.ends_on is null or ac.ends_on > current_date)
         and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
      union all
      select 1 from me                                              -- arm 4: delegation
        join org_delegations od on od.grantor_org_id = me.org_id and od.revoked_at is null
        join groups g on g.id = od.group_id
        join group_memberships gm on gm.group_id = g.id and gm.person_id = me.person_id
        join app_roles r on r.id = od.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
       where od.starts_on <= current_date and (od.ends_on is null or od.ends_on > current_date)
         and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date));
$$;

comment on function presby_two_factor_required(uuid) is
  'True when (A) any organization the user holds an active membership in requires two-factor authentication, or (B) the user''s live person effectively holds, at any active membership, a key with permissions.requires_two_factor (the giving keys; DECISION-170/175). Arm B mirrors presby_effective_permissions()''s four arms inline (F140; agreement and md5 drift pin in scripts/giving/test-rls-46.sql). SECURITY DEFINER: runs at sign-in with no org GUC set (F26).';

revoke all on function presby_two_factor_required(uuid) from public;
grant execute on function presby_two_factor_required(uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 19. Template roles, their bindings, and the flag retirement
-- ---------------------------------------------------------------------------
-- organization_id IS NULL and organization_type_scope IS NULL: new
-- worshiping communities are in scope and the scope column is single-valued.
-- Presbyteries cannot hold the keys in practice - the toggle and the
-- designation both refuse them, and adoptTemplate()'s subset check refuses
-- the adopt. Ids pre-assigned by the orchestrator (Rule 16). No backfill into
-- any tenant's roles (drizzle/0052 note 5: Two Hierarchies).
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values
  ('00000000-0000-0000-0000-000000000005', null, null, 'treasurer', 'Treasurer', 'constitutional', true),
  ('00000000-0000-0000-0000-000000000006', null, null, 'giving_recorder', 'Giving Recorder', 'custom', false)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values
  ('00000000-0000-0000-0000-000000000005', 'giving.view'),
  ('00000000-0000-0000-0000-000000000005', 'giving.record'),
  ('00000000-0000-0000-0000-000000000005', 'giving.manage'),
  ('00000000-0000-0000-0000-000000000006', 'giving.record')
on conflict (role_id, permission_key) do nothing;

-- R11: no platform flag. The per-org org_portal.giving toggle (provisioned
-- OFF; a missing row is off) is giving's only on/off switch. scripts/seed.ts
-- stops seeding this row in the same batch.
delete from feature_flags where key = 'org_portal.giving';
