-- scripts/giving/seed-dev-giving.sql — the online-giving fixture block
-- (docs/work-log/2026-10-15-online-giving.md, Phase 3 "Integration drafts";
-- drizzle/0055_presby_giving.sql).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE line, placed AFTER
-- its final `commit;`:
--
--     \ir giving/seed-dev-giving.sql
--
-- After, not before: this block is its own transaction, because the gift and
-- reversal rows need the transaction-local write marker
-- `presby.giving_write_active` (drizzle/0055 header, P3-7) and a nested
-- `begin` inside seed-dev.sql's transaction would commit it early.
-- Standalone:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/giving/seed-dev-giving.sql
--
-- Runs as the OWNER (like seed-dev.sql). Idempotent: every insert is
-- `on conflict do nothing` on a fixed id (or a natural key), and the S3
-- reconciliation is a delete of one binding.
--
-- No Real Data: invented names, example.invalid addresses, and provider ids
-- that are obviously fake (`acct_fixture...`, `cus_fixture...`) - no Stripe
-- key shape anywhere. Fixture ids use the `d9100000-` prefix.
--
-- WHAT IS HERE, AND WHICH ASSERTION READS IT (scripts/giving/test-rls-46.sql):
--   Alder Creek (2222...): the org_portal.giving toggle ON; the fixture
--     `treasurer` role (f...0007) bound to the three giving keys and NO LONGER
--     to ledger.approve (S3 / P3-3 - the permissions('ledger.approve') row
--     itself stays: role-definitions.test.ts, authz.test.ts and test-rls.sql
--     use it as "a key nobody holds"); an org-owned `giving_recorder` role
--     granted to Desmond Okonkwo; two connections - the CURRENT one is
--     test-mode (livemode = false), active, attested and public, and an
--     earlier live-mode one is disconnected (it carries the live online
--     gifts, so statements have online money to count while the active
--     connection proves test-mode exclusion); giving_settings; three funds
--     (General online, Building restricted, Missions RETIRED with an
--     in-flight intent); seven donors (Stripe identity, recorder-confirmed
--     link, email-proposal, shared-email no-proposal, merged, unidentified
--     plate cash, no-contact); eleven gifts and one refund; two inbox rows
--     (one parked, one dead letter); intents (one open, one completed
--     member-path subscription, and the ones behind the online gifts).
--   Bramblewood (3333...): a connection, a fund, a donor, an intent with a
--     Checkout session and an offline gift - isolation fixtures only. Its
--     toggle is NOT turned on.
--   No presbytery gets any giving row.
--
-- Nobody given a giving key here has a linked user: Priya Balakrishnan
-- (treasurer) and Desmond Okonkwo (recorder) are password-less fixture
-- people, so arm B of presby_two_factor_required() changes no fixture
-- sign-in (elder.fixture / clerk.fixture / presbytery.clerk.fixture stay
-- exactly as they were).

begin;

-- Arm the marker for the whole fixture transaction (gifts and reversals, and
-- the connections that are born active rather than onboarding - D1).
select set_config('presby.giving_write_active', 'true', true);

-- ---------------------------------------------------------------------------
-- Alder Creek: toggle, roles, grants (S3 reconciliation)
-- ---------------------------------------------------------------------------
insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
values ('22222222-2222-2222-2222-222222222222', 'org_portal.giving', true, null)
on conflict (organization_id, feature_key) do nothing;

-- S3 / P3-3: the fixture treasurer carries the giving keys, not ledger.approve.
delete from app_role_permissions
 where role_id = 'f0000000-0000-0000-0000-000000000007' and permission_key = 'ledger.approve';
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000007', 'giving.view'),
  ('f0000000-0000-0000-0000-000000000007', 'giving.record'),
  ('f0000000-0000-0000-0000-000000000007', 'giving.manage')
on conflict (role_id, permission_key) do nothing;

-- The org-owned recorder role (custom, unprotected - what the designation
-- mints from the template), granted person-arm to a non-treasurer.
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('d9100000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', null,
        'giving_recorder', 'Giving Recorder', 'custom', false)
on conflict (id) do nothing;
insert into app_role_permissions (role_id, permission_key)
values ('d9100000-0000-0000-0000-000000000001', 'giving.record')
on conflict (role_id, permission_key) do nothing;
insert into role_grants (id, organization_id, role_id, person_id, starts_on, grant_reason)
values ('d9100000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
        'd9100000-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000004', -- Desmond Okonkwo
        '2026-01-01', 'giving team (fixture)')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------
insert into giving_provider_connections (id, organization_id, provider, external_account_id, livemode,
       status, charges_enabled, payouts_enabled, details_submitted, card_enabled, ach_enabled,
       requirements_due, payouts_attested_at, public_enabled_at, disconnected_at, disconnected_reason,
       last_status_at, created_at)
values
  -- Alder, CURRENT: test-mode, active, attested, public.
  ('d9100000-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222', 'stripe',
   'acct_fixture000000000001', false, 'active', true, true, true, true, true, false,
   now() - interval '30 days', now() - interval '29 days', null, null, now() - interval '1 day',
   now() - interval '60 days'),
  -- Alder, EARLIER: live-mode, disconnected by the treasurer. Carries the live online gifts.
  ('d9100000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'stripe',
   'acct_fixture000000000003', true, 'disconnected', true, true, true, true, true, false,
   now() - interval '700 days', null, now() - interval '61 days', 'treasurer', now() - interval '61 days',
   now() - interval '720 days'),
  -- Bramblewood: test-mode, active, NOT public (its toggle is off anyway).
  ('d9100000-0000-0000-0000-000000000012', '33333333-3333-3333-3333-333333333333', 'stripe',
   'acct_fixture000000000002', false, 'active', true, true, true, true, false, false,
   null, null, null, null, now() - interval '1 day', now() - interval '20 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Donee identity (R5) - invented, with a placeholder EIN
-- ---------------------------------------------------------------------------
insert into giving_settings (organization_id, donee_legal_name, donee_address_line1, donee_city,
       donee_region, donee_postal_code, donee_ein, signatory_name, signatory_title,
       greeting_text, closing_text)
values ('22222222-2222-2222-2222-222222222222', 'Alder Creek Presbyterian Church', '1 Fixture Way',
        'Aldertown', 'OH', '00000', '00-0000000', 'Priya Balakrishnan', 'Treasurer',
        'Thank you for your faithful giving to Alder Creek this year.',
        'With gratitude, the Session of Alder Creek Presbyterian Church')
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- Funds
-- ---------------------------------------------------------------------------
insert into giving_funds (id, organization_id, name, online_display_name, description, restriction_class,
       offered_online, is_active, retired_at, sort_order)
values
  ('d9100000-0000-0000-0000-000000000020', '22222222-2222-2222-2222-222222222222', 'General Fund',
   'General Fund', 'The congregation''s operating budget.', 'unrestricted', true, true, null, 10),
  ('d9100000-0000-0000-0000-000000000021', '22222222-2222-2222-2222-222222222222', 'Building Fund',
   null, 'Roof and boiler replacement.', 'temporarily_restricted', false, true, null, 20),
  -- Retired: offered online until it was retired, so an intent opened before
  -- retirement is still in flight against it (Edge Cases: retired fund in flight).
  ('d9100000-0000-0000-0000-000000000022', '22222222-2222-2222-2222-222222222222', 'Missions',
   'Missions', null, 'unrestricted', false, false, now() - interval '2 days', 30),
  ('d9100000-0000-0000-0000-000000000030', '33333333-3333-3333-3333-333333333333', 'General Fund',
   'General Fund', null, 'unrestricted', true, true, null, 10)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Donors (merge target before the merged donor)
-- ---------------------------------------------------------------------------
insert into giving_donors (id, organization_id, kind, display_name, email, address_line1, city, region,
       postal_code, country, linked_membership_id, link_source, linked_at)
values
  -- D1: identified, with a Stripe identity (below) on the earlier live connection.
  ('d9100000-0000-0000-0000-000000000040', '22222222-2222-2222-2222-222222222222', 'identified',
   'Linden Marsh', 'linden.marsh@example.invalid', '12 Fixture Lane', 'Aldertown', 'OH', '00000', 'US',
   null, null, null),
  -- D2: recorder-confirmed link to Hallie Vandermeer's membership.
  ('d9100000-0000-0000-0000-000000000041', '22222222-2222-2222-2222-222222222222', 'identified',
   'Hallie Vandermeer', 'hallie.v@example.invalid', '14 Fixture Lane', 'Aldertown', 'OH', '00000', 'US',
   (select m.id from memberships m
     where m.person_id = 'c0000000-0000-0000-0000-000000000005'
       and m.organization_id = '22222222-2222-2222-2222-222222222222'),
   'recorder_confirmed', now() - interval '10 days'),
  -- D3: email equal to Rowan Thistlewood's person_identifiers email (not
  -- shared) -> a link PROPOSAL for the recorder.
  ('d9100000-0000-0000-0000-000000000042', '22222222-2222-2222-2222-222222222222', 'identified',
   'R. Thistlewood', 'r.thistlewood@example.invalid', null, null, null, null, 'US', null, null, null),
  -- D4: the Renwick household's SHARED address (is_shared) -> no proposal.
  ('d9100000-0000-0000-0000-000000000043', '22222222-2222-2222-2222-222222222222', 'identified',
   'Renwick Household', 'renwick.house@example.invalid', null, null, null, null, 'US', null, null, null),
  -- D7: no email and no address (a statement delivery exception, Batch 5).
  ('d9100000-0000-0000-0000-000000000046', '22222222-2222-2222-2222-222222222222', 'identified',
   'Odette Brask', null, null, null, null, null, 'US', null, null, null),
  -- Bramblewood's own donor (isolation).
  ('d9100000-0000-0000-0000-000000000050', '33333333-3333-3333-3333-333333333333', 'identified',
   'Bramble Fixture Donor', 'bramble.donor@example.invalid', null, null, null, null, 'US', null, null, null)
on conflict (id) do nothing;

-- D6: the one unidentified plate-cash donor (no contact, never a statement).
insert into giving_donors (id, organization_id, kind, display_name)
values ('d9100000-0000-0000-0000-000000000045', '22222222-2222-2222-2222-222222222222', 'unidentified',
        'Plate offering (unidentified)')
on conflict (id) do nothing;

-- D5: merged into D1 (a duplicate created by a second Stripe customer).
insert into giving_donors (id, organization_id, kind, display_name, email, merged_into_id, merged_at)
values ('d9100000-0000-0000-0000-000000000044', '22222222-2222-2222-2222-222222222222', 'identified',
        'L. Marsh', 'l.marsh@example.invalid', 'd9100000-0000-0000-0000-000000000040', now() - interval '5 days')
on conflict (id) do nothing;

insert into giving_donor_identities (id, organization_id, donor_id, connection_id, external_customer_id)
values
  ('d9100000-0000-0000-0000-000000000048', '22222222-2222-2222-2222-222222222222',
   'd9100000-0000-0000-0000-000000000040', 'd9100000-0000-0000-0000-000000000011', 'cus_fixture00000001'),
  ('d9100000-0000-0000-0000-000000000049', '22222222-2222-2222-2222-222222222222',
   'd9100000-0000-0000-0000-000000000041', 'd9100000-0000-0000-0000-000000000010', 'cus_fixture00000002')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Checkout intents (I1-I7 Alder, I8 Bramblewood). Covered fees are computed
-- by the same SQL gross-up the create functions use.
-- ---------------------------------------------------------------------------
insert into giving_checkout_intents (id, organization_id, connection_id, fund_id, membership_id, donor_id,
       frequency, method_choice, cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents,
       livemode, idempotency_key, status, checkout_session_id, payment_intent_id, subscription_id,
       customer_id, expires_at, completed_at, created_at)
select v.id::uuid, v.org::uuid, v.conn::uuid, v.fund::uuid, v.membership, v.donor::uuid,
       v.frequency, v.method, v.cover, v.gift,
       case when v.cover then presby_giving_gross_up(v.gift, v.method, 290, 30, 80, 500) - v.gift else 0 end,
       case when v.cover then presby_giving_gross_up(v.gift, v.method, 290, 30, 80, 500) else v.gift end,
       v.livemode, v.idem, v.status, v.session, v.pi, v.sub, v.cus,
       v.created + interval '24 hours',
       case when v.status = 'completed' then v.created + interval '5 minutes' end, v.created
  from (values
    -- I1: the live, card, fee-covered gift (G4).
    ('d9100000-0000-0000-0000-000000000060', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000011', 'd9100000-0000-0000-0000-000000000020', null::uuid,
     'd9100000-0000-0000-0000-000000000040', 'once', 'card', true, 5000, true,
     'd9100000-0000-4000-8000-000000000060', 'completed', 'cs_live_fixture0000000001',
     'pi_fixture0000000001', null, 'cus_fixture00000001', now() - interval '90 days'),
    -- I2: test-mode bank, still pending (G5).
    ('d9100000-0000-0000-0000-000000000061', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000010', 'd9100000-0000-0000-0000-000000000020', null,
     'd9100000-0000-0000-0000-000000000042', 'once', 'bank', false, 7500, false,
     'd9100000-0000-4000-8000-000000000061', 'completed', 'cs_test_fixture0000000002',
     'pi_fixture0000000002', null, null, now() - interval '3 days'),
    -- I3: test-mode bank, failed first ACH (G6).
    ('d9100000-0000-0000-0000-000000000062', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000010', 'd9100000-0000-0000-0000-000000000020', null,
     'd9100000-0000-0000-0000-000000000043', 'once', 'bank', false, 2000, false,
     'd9100000-0000-4000-8000-000000000062', 'completed', 'cs_test_fixture0000000003',
     'pi_fixture0000000003', null, null, now() - interval '9 days'),
    -- I4: the live card gift that was refunded (G7).
    ('d9100000-0000-0000-0000-000000000063', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000011', 'd9100000-0000-0000-0000-000000000020', null,
     'd9100000-0000-0000-0000-000000000041', 'once', 'card', false, 3000, true,
     'd9100000-0000-4000-8000-000000000063', 'completed', 'cs_live_fixture0000000004',
     'pi_fixture0000000004', null, null, now() - interval '80 days'),
    -- I5: the test-mode succeeded gift (G9) - excluded from every total.
    ('d9100000-0000-0000-0000-000000000064', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000010', 'd9100000-0000-0000-0000-000000000020', null,
     'd9100000-0000-0000-0000-000000000040', 'once', 'card', false, 1000, false,
     'd9100000-0000-4000-8000-000000000064', 'completed', 'cs_test_fixture0000000005',
     'pi_fixture0000000005', null, null, now() - interval '2 days'),
    -- I6: OPEN, against the now-retired Missions fund (in flight).
    ('d9100000-0000-0000-0000-000000000065', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000010', 'd9100000-0000-0000-0000-000000000022', null,
     null, 'once', 'card', false, 4000, false,
     'd9100000-0000-4000-8000-000000000065', 'open', 'cs_test_fixture0000000006',
     null, null, null, now() - interval '10 minutes'),
    -- I8: Bramblewood's intent with a Checkout session (the cross-org session id 46f uses).
    ('d9100000-0000-0000-0000-000000000067', '33333333-3333-3333-3333-333333333333',
     'd9100000-0000-0000-0000-000000000012', 'd9100000-0000-0000-0000-000000000030', null,
     null, 'once', 'card', false, 2500, false,
     'd9100000-0000-4000-8000-000000000067', 'open', 'cs_test_fixturebramble001',
     null, null, null, now() - interval '5 minutes')
  ) as v(id, org, conn, fund, membership, donor, frequency, method, cover, gift, livemode, idem, status,
         session, pi, sub, cus, created)
on conflict (id) do nothing;

-- I7: a completed MEMBER-PATH monthly subscription (Hallie Vandermeer), test-mode.
insert into giving_checkout_intents (id, organization_id, connection_id, fund_id, membership_id, donor_id,
       frequency, method_choice, cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents,
       livemode, idempotency_key, status, checkout_session_id, subscription_id, customer_id,
       expires_at, completed_at, created_at)
values ('d9100000-0000-0000-0000-000000000066', '22222222-2222-2222-2222-222222222222',
        'd9100000-0000-0000-0000-000000000010', 'd9100000-0000-0000-0000-000000000020',
        (select m.id from memberships m
          where m.person_id = 'c0000000-0000-0000-0000-000000000005'
            and m.organization_id = '22222222-2222-2222-2222-222222222222'),
        'd9100000-0000-0000-0000-000000000041', 'monthly', 'card', false, 10000, 0, 10000, false,
        'd9100000-0000-4000-8000-000000000066', 'completed', 'cs_test_fixture0000000007',
        'sub_fixture0000000001', 'cus_fixture00000002',
        now() - interval '40 days' + interval '24 hours', now() - interval '40 days', now() - interval '40 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Inbox rows: one parked (an early refund with no gift yet), one dead letter
--
-- The parked row is parked BY DESIGN: next_attempt_at is a century away, so no
-- giving cron (the e2e spec's, a deployment's) can ever sweep it, claim it and
-- walk it to a dead letter. test-rls-46.sql 46e asserts "one parked, one dead
-- letter" as a fixture fact, not a liveness claim (orchestrator ruling on the
-- 3a-fix seed question, docs/work-log/2026-10-15-online-giving.md).
-- ---------------------------------------------------------------------------
insert into giving_provider_events (id, organization_id, connection_id, provider, external_event_id,
       event_type, livemode, raw_body, status, attempts, next_attempt_at, last_error, received_at, processed_at)
values
  ('d9100000-0000-0000-0000-000000000070', '22222222-2222-2222-2222-222222222222',
   'd9100000-0000-0000-0000-000000000010', 'stripe', 'evt_fixture0000000001', 'charge.refunded', false,
   '{"id":"evt_fixture0000000001","object":"event","type":"charge.refunded"}', 'parked', 1,
   now() + interval '100 years', 'no_gift', now() - interval '10 minutes', null),
  ('d9100000-0000-0000-0000-000000000071', '22222222-2222-2222-2222-222222222222',
   'd9100000-0000-0000-0000-000000000010', 'stripe', 'evt_fixture0000000002', 'checkout.session.completed', false,
   '{"id":"evt_fixture0000000002","object":"event","type":"checkout.session.completed"}', 'dead_letter', 8,
   now() - interval '1 day', 'amount_mismatch', now() - interval '3 days', now() - interval '1 day')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Gifts (marker armed above). Dates are relative to today, clipped to the
-- current calendar year where they must stay in it; G8/G10 are LAST year.
-- recorded_by is clerk.fixture's user (seed-dev.sql e...f3).
-- ---------------------------------------------------------------------------
insert into giving_gifts (id, organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
       external_transaction_id, method, check_number, stock_description, stock_quantity, memo, amount_cents,
       donor_covered_fee_cents, fee_cents, net_cents, status, failure_code, occurred_on, occurred_at, livemode,
       recorded_by)
select v.id::uuid, v.org::uuid, v.donor::uuid, v.fund::uuid, v.source, v.provider::giving_provider,
       v.conn::uuid, v.intent::uuid, v.pi, v.method, v.check_number, v.stock, v.qty, v.memo, v.amount,
       v.covered, v.fee, v.net, v.status, v.failure, v.on_date,
       case when v.source = 'online' then (v.on_date + time '12:00') at time zone 'America/New_York' end,
       v.livemode, v.recorded_by::uuid
  from (values
    -- G1: offline cash, the plate.
    ('d9100000-0000-0000-0000-000000000080', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000045', 'd9100000-0000-0000-0000-000000000020', 'offline', null,
     null, null, null, 'cash', null, null, null::numeric, 'Sunday plate', 2500, 0, null::integer, null::integer,
     'succeeded', null, greatest(current_date - 7, date_trunc('year', current_date)::date), true,
     'e0000000-0000-0000-0000-0000000000f3'),
    -- G2: offline check, with a number.
    ('d9100000-0000-0000-0000-000000000081', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000046', 'd9100000-0000-0000-0000-000000000020', 'offline', null,
     null, null, null, 'check', '1042', null, null, null, 10000, 0, null, null,
     'succeeded', null, greatest(current_date - 14, date_trunc('year', current_date)::date), true,
     'e0000000-0000-0000-0000-0000000000f3'),
    -- G3: offline stock (non-cash; amount is the books value, never printed).
    ('d9100000-0000-0000-0000-000000000082', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000040', 'd9100000-0000-0000-0000-000000000021', 'offline', null,
     null, null, null, 'stock', null, '10 shares of an index fund', 10, null, 150000, 0, null, null,
     'succeeded', null, greatest(current_date - 21, date_trunc('year', current_date)::date), true,
     'e0000000-0000-0000-0000-0000000000f3'),
    -- G8: offline check dated LAST calendar year (statements).
    ('d9100000-0000-0000-0000-000000000087', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000041', 'd9100000-0000-0000-0000-000000000020', 'offline', null,
     null, null, null, 'check', '881', null, null, null, 20000, 0, null, null,
     'succeeded', null, make_date(extract(year from current_date)::int - 1, 12, 15), true,
     'e0000000-0000-0000-0000-0000000000f3'),
    -- G10: LATE-DATED - last year's date, but created now, after any fixture
    -- "issued" instant (Batch 5's staleness fixture).
    ('d9100000-0000-0000-0000-000000000089', '22222222-2222-2222-2222-222222222222',
     'd9100000-0000-0000-0000-000000000046', 'd9100000-0000-0000-0000-000000000020', 'offline', null,
     null, null, null, 'cash', null, null, null, 'Found in the office safe', 4000, 0, null, null,
     'succeeded', null, make_date(extract(year from current_date)::int - 1, 12, 30), true,
     'e0000000-0000-0000-0000-0000000000f3'),
    -- G11: Bramblewood's own offline gift (isolation).
    ('d9100000-0000-0000-0000-00000000008a', '33333333-3333-3333-3333-333333333333',
     'd9100000-0000-0000-0000-000000000050', 'd9100000-0000-0000-0000-000000000030', 'offline', null,
     null, null, null, 'cash', null, null, null, null, 3300, 0, null, null,
     'succeeded', null, greatest(current_date - 3, date_trunc('year', current_date)::date), true,
     'e0000000-0000-0000-0000-0000000000f3')
  ) as v(id, org, donor, fund, source, provider, conn, intent, pi, method, check_number, stock, qty, memo,
         amount, covered, fee, net, status, failure, on_date, livemode, recorded_by)
on conflict (id) do nothing;

-- Online gifts take their amounts from their intents (total charged, covered part).
insert into giving_gifts (id, organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
       external_transaction_id, method, amount_cents, donor_covered_fee_cents, fee_cents, net_cents, status,
       failure_code, occurred_on, occurred_at, livemode)
select v.id::uuid, i.organization_id, i.donor_id, i.fund_id, 'online', 'stripe', i.connection_id, i.id,
       i.payment_intent_id, v.method, i.total_cents, i.donor_covered_fee_cents,
       v.fee, case when v.fee is not null then i.total_cents - v.fee end,
       v.status, v.failure, (i.created_at at time zone 'America/New_York')::date, i.created_at,
       i.livemode
  from (values
    -- G4: live, card, succeeded, fee/net known, donor covered the fee.
    ('d9100000-0000-0000-0000-000000000083', 'd9100000-0000-0000-0000-000000000060', 'card', 'succeeded', null, 177),
    -- G5: test-mode ACH, pending.
    ('d9100000-0000-0000-0000-000000000084', 'd9100000-0000-0000-0000-000000000061', 'us_bank_account', 'pending', null, null),
    -- G6: test-mode ACH, failed first payment.
    ('d9100000-0000-0000-0000-000000000085', 'd9100000-0000-0000-0000-000000000062', 'us_bank_account', 'failed', 'insufficient_funds', null),
    -- G7: live, card, succeeded, then refunded (R1 below).
    ('d9100000-0000-0000-0000-000000000086', 'd9100000-0000-0000-0000-000000000063', 'card', 'succeeded', null, 117),
    -- G9: TEST-MODE succeeded - excluded from every total by the livemode predicate.
    ('d9100000-0000-0000-0000-000000000088', 'd9100000-0000-0000-0000-000000000064', 'card', 'succeeded', null, 59)
  ) as v(id, intent, method, status, failure, fee)
  join giving_checkout_intents i on i.id = v.intent::uuid
on conflict (id) do nothing;

-- R1: G7 refunded in full, from the earlier live connection.
-- `where not exists`, NOT `on conflict do nothing`: giving_reversals_bound is a
-- BEFORE INSERT trigger, and BEFORE triggers fire before the conflict check -
-- so on a re-run the duplicate row would be bound-checked (net 2x the gift)
-- and raise before ON CONFLICT could skip it.
insert into giving_gift_reversals (id, organization_id, gift_id, connection_id, kind, amount_cents,
       external_reversal_id, occurred_on, occurred_at, livemode)
select 'd9100000-0000-0000-0000-000000000090', g.organization_id, g.id, g.connection_id, 'refund',
       g.amount_cents, 're_fixture0000000001', g.occurred_on + 2, g.occurred_at + interval '2 days', g.livemode
  from giving_gifts g
 where g.id = 'd9100000-0000-0000-0000-000000000086'
   and not exists (select 1 from giving_gift_reversals r where r.id = 'd9100000-0000-0000-0000-000000000090');

select set_config('presby.giving_write_active', 'false', true);

commit;
