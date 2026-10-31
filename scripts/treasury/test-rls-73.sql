-- ---------------------------------------------------------------------------
-- 73. Reimbursements (drizzle/0073_presby_reimbursements.sql and
--     drizzle/0074_presby_reimbursement_permissions.sql; DECISION-267..270,
--     F301; docs/work-log/2026-10-25-treasury-inc1.md, Phase 4 Batch 1a).
--
--     INTEGRATION (Rule 16): docs/work-log/treasury-inc1.integration.patch
--     appends ONE line to scripts/test-rls.sql:
--
--         \ir treasury/test-rls-73.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/treasury/test-rls-73.sql
--
--     after scripts/install-test-helpers.sql (owner), scripts/seed-dev.sql and
--     scripts/treasury/seed-dev-treasury.sql. It uses Alder Creek's fixture:
--       * Marguerite Ashcombe (c...0001, elder.fixture e...00f2): regular,
--         active roll - may file; holds no reimbursement key.
--       * Tobias Renwick (c...0002, clerk.fixture e...00f3): chair of the
--         managed Property Committee (b...0004, chargeable) - the seat.
--       * Alder's treasurer role (f...0007) carries the four reimbursement
--         keys (0074 backfill / seed-dev-treasury.sql); its seeded holder,
--         Priya, has no login, so she is NOT an effective holder (D2).
--       * Rowan Thistlewood (c...0006) holds memberships at Alder Creek AND
--         the Presbytery of the Northern Reach (1111...): the isolation actor.
--     Every block that writes ends in rollback, so it writes nothing durable.
--     Blocks that must see the DEFERRED constraint triggers fire run
--     `set constraints all immediate` (then `deferred` again) before the
--     rollback.
--
--     What presby_app cannot reach (the owner path of every trigger, the
--     generated transition matrix, the import door, concurrency, the 0074
--     replay) is proven on the owner connection in Vitest:
--     src/lib/db/domain/reimbursement.db.test.ts and
--     src/lib/db/domain/reimbursement-permissions.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P73_ALDER       '\'22222222-2222-2222-2222-222222222222\''
\set P73_BRAMBLE     '\'33333333-3333-3333-3333-333333333333\''
\set P73_PRESBYTERY  '\'11111111-1111-1111-1111-111111111111\''
\set P73_MARGUERITE_USER '\'e0000000-0000-0000-0000-0000000000f2\''
\set P73_TOBIAS_USER '\'e0000000-0000-0000-0000-0000000000f3\''
\set P73_MARGUERITE  '\'c0000000-0000-0000-0000-000000000001\''
\set P73_TOBIAS      '\'c0000000-0000-0000-0000-000000000002\''
\set P73_ROWAN       '\'c0000000-0000-0000-0000-000000000006\''
\set P73_PROPERTY    '\'b0000000-0000-0000-0000-000000000004\''
\set P73_SESSION     '\'b0000000-0000-0000-0000-000000000001\''
\set P73_TREASURER_ROLE '\'f0000000-0000-0000-0000-000000000007\''
\set P73_CATEGORY    '\'a7300000-0000-4000-8000-000000000021\''

\echo '======================================================'
\echo ' Section 73 (Reimbursements, drizzle/0073 + 0074) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '73: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: FORCE RLS, the one policy, privileges, the definer surface
--     and its grants, the triggers.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('reimbursement_chargeable_groups', 'reimbursement_categories', 'reimbursement_requests',
                        'reimbursement_attachments', 'reimbursement_payments', 'reimbursement_events')
        and relkind = 'r' and relrowsecurity and relforcerowsecurity),
    6, '73a: all six reimbursement tables have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename like 'reimbursement\_%' and policyname = 'tenant_isolation' and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    6, '73a: each carries the standard tenant_isolation policy');
  select assert_eq(
    (select count(*) from pg_policies where tablename like 'reimbursement\_%'),
    6, '73a: and no other policy');
  select assert_eq(
    (select count(*) from unnest(array['reimbursement_chargeable_groups', 'reimbursement_categories']) t
      where has_table_privilege('presby_app', t, 'SELECT')
        and not has_table_privilege('presby_app', t, 'INSERT')
        and not has_table_privilege('presby_app', t, 'UPDATE')
        and not has_table_privilege('presby_app', t, 'DELETE')),
    2, '73a (DECISION-267): presby_app holds SELECT and nothing else on the two configuration tables');
  select assert_eq(
    (select count(*) from unnest(array['reimbursement_requests', 'reimbursement_attachments',
                                       'reimbursement_payments', 'reimbursement_events']) t
      where has_table_privilege('presby_app', t, 'SELECT') or has_table_privilege('presby_app', t, 'INSERT')
         or has_table_privilege('presby_app', t, 'UPDATE') or has_table_privilege('presby_app', t, 'DELETE')),
    0, '73a (DECISION-267): presby_app holds NO privilege on requests, attachments, payments or events');
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname like 'reimbursement\_%' and c.relkind = 'r'
        and (has_table_privilege('presby_platform', c.oid, 'SELECT') or has_table_privilege('presby_platform', c.oid, 'INSERT')
             or has_table_privilege('presby_platform', c.oid, 'UPDATE') or has_table_privilege('presby_platform', c.oid, 'DELETE'))),
    0, '73a: presby_platform holds nothing on any reimbursement table');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'presby\_reimbursement%'
        and p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'),
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'presby\_reimbursement%'),
    '73a (DECISION-148): every presby_reimbursement* function is SECURITY DEFINER with search_path pinned, pg_temp last');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'presby\_reimbursement\_%' and p.proname not like 'presby\_reimbursement\_\_%'
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('presby_app', p.oid, 'execute')
        and not has_function_privilege('presby_platform', p.oid, 'execute')
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
    30, '73a: the 30 public definers are EXECUTE-granted to presby_app only (not presby_platform, not PUBLIC)');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (p.proname like 'presby\_reimbursement\_\_%' or (p.proname like 'presby\_reimbursement%' and p.prorettype = 'trigger'::regtype))
        and has_function_privilege('presby_app', p.oid, 'execute')),
    0, '73a (0044 B-M1): no internal helper and no trigger function is executable by presby_app');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'presby\_reimbursement\_\_%'),
    18, '73a: the 18 internal helpers exist');
  select assert_eq(
    (select count(*) from pg_proc p where p.proname = 'presby_deny_reimbursement' and not p.prosecdef
        and has_function_privilege('presby_app', p.oid, 'execute')),
    1, '73a: the identity literal is an invoker function presby_app may execute (one literal, never "permission denied")');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and t.tgenabled = 'O'
        and c.relname like 'reimbursement\_%' and t.tgname like '%\_delete\_guard'),
    6, '73a: a delete guard on each of the six tables, enabled');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgenabled = 'O' and t.tgdeferrable and t.tginitdeferred
        and t.tgname in ('reimbursement_requests_status_payment_consistent',
                         'reimbursement_payments_status_payment_consistent',
                         'reimbursement_requests_insert_has_event',
                         'reimbursement_requests_status_has_event_upd')),
    4, '73a (P3-6): the four DEFERRED constraint triggers exist, deferrable initially deferred');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgenabled = 'O'
        and t.tgname in ('reimbursement_requests_insert_guard', 'reimbursement_requests_update_guard',
                         'reimbursement_attachments_write_guard', 'reimbursement_payments_write_guard',
                         'reimbursement_events_write_guard', 'reimbursement_chargeable_groups_config_guard',
                         'reimbursement_categories_config_guard', 'administrative_commissions_reimbursement_guard',
                         'org_delegations_reimbursement_guard', 'app_role_permissions_reimbursement_guard')),
    10, '73a: the write guards and the three F301 guards exist and are enabled');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'reimbursement_attachments'::regclass
        and conname = 'reimbursement_attachments_asset_audience_private' and convalidated),
    1, '73a (DECISION-277): asset_audience is pinned to private (the receipt FK carries it)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'reimbursement_attachments'::regclass and c.contype = 'f'
        and c.conname = 'reimbursement_attachments_blob_fk'
        and c.confrelid = 'blob_assets'::regclass
        and c.conindid = (select k.conindid from pg_constraint k where k.conname = 'blob_assets_id_org_audience_key')
        and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
        and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
            = array['blob_key', 'organization_id', 'asset_audience']
        and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
            = array['id', 'organization_id', 'audience']),
    1, '73a (F289, DECISION-277): reimbursement_attachments_blob_fk is (blob_key, organization_id, asset_audience) -> blob_assets_id_org_audience_key, NO ACTION both ways, validated');
  select assert_eq(
    (select count(*) from permissions where module = 'reimbursement' and sensitivity_tier = 2
        and requires_two_factor = (key <> 'reimbursement.request_for_others')),
    4, '73a (0074): four tier-2 keys; view, pay and manage require two-factor sign-in');
commit;

-- ===========================================================================
-- (b) The tables themselves are closed to presby_app; the configuration
--     tables are readable and tenant-isolated.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P73_ALDER, true);
  do $$
  begin
    perform 1 from reimbursement_requests;
    raise exception 'FAIL 73b - presby_app read reimbursement_requests directly';
  exception when insufficient_privilege then
    raise notice 'pass  73b: presby_app cannot SELECT reimbursement_requests (definers only)';
  end $$;
  do $$
  begin
    insert into reimbursement_events (organization_id, request_id, kind, to_status, request_revision)
    values ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), 'note', 'draft', 1);
    raise exception 'FAIL 73b - presby_app inserted a history row';
  exception when insufficient_privilege then
    raise notice 'pass  73b: presby_app cannot INSERT reimbursement_events';
  end $$;
  do $$
  begin
    insert into reimbursement_categories (organization_id, name, created_by_user)
    values ('22222222-2222-2222-2222-222222222222', 'Raw insert', 'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 73b - presby_app inserted a category directly';
  exception when insufficient_privilege then
    raise notice 'pass  73b: presby_app cannot INSERT reimbursement_categories (manage goes through the definer)';
  end $$;
  select assert_eq((select count(*) from reimbursement_chargeable_groups where ended_at is null), 2,
                   '73b: alder sees its two chargeable groups');
  select assert_eq((select count(*) from reimbursement_categories where organization_id <> :P73_ALDER), 0,
                   '73b: alder sees no foreign category');
commit;
begin;
  select set_config('app.current_org_id', :P73_BRAMBLE, true);
  select assert_eq((select count(*) from reimbursement_chargeable_groups) + (select count(*) from reimbursement_categories),
                   0, '73b: bramblewood sees none of alder''s configuration');
commit;
begin;
  select assert_eq((select count(*) from reimbursement_categories), 0,
                   '73b: unset GUC - configuration invisible');
commit;

-- ===========================================================================
-- (c) The identity literal. Every definer that takes an actor refuses, with
--     the ONE literal (never "permission denied for function"), when there
--     is no organization context, when the actor has no live person with an
--     active membership there, or when a required key is missing. This is
--     also the proof that every ungranted helper a definer calls is reached
--     through the definer, not refused on its own grant (0046 B-M1).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P73_ALDER, true);
  do $$
  declare
    v_calls text[] := array[
      -- a user with no person at Alder (a fresh uuid)
      $q$select * from presby_reimbursement_save_draft('denied-key-01', 'reimburse', 'b0000000-0000-0000-0000-000000000004', null, null, 100, null, null, null, null, false, gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_update_request(gen_random_uuid(), 1, 'reimburse', 'b0000000-0000-0000-0000-000000000004', null, null, 100, null, null, null, null, false, gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_submit(gen_random_uuid(), 1, gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_withdraw(gen_random_uuid(), null, gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_approve(gen_random_uuid(), 1, 'seat', gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_return(gen_random_uuid(), 1, 'needs_info', 'x', gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_receipt_preflight(gen_random_uuid(), gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_attach_receipt(gen_random_uuid(), gen_random_uuid(), repeat('a', 64), 'image/jpeg', 1, 'r.jpg', gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_detach_receipt(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_my_requests(gen_random_uuid(), 10, 0)$q$,
      $q$select * from presby_reimbursement_waiting_for_me(gen_random_uuid())$q$,
      $q$select * from presby_reimbursement_counts(gen_random_uuid())$q$,
      $q$select presby_reimbursement_detail(gen_random_uuid(), gen_random_uuid(), 'member')$q$,
      $q$select * from presby_reimbursement_attachment_lookup(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$,
      $q$select presby_reimbursement_form_options(gen_random_uuid())$q$,
      -- Tobias: a live member who holds no reimbursement key
      $q$select * from presby_reimbursement_approve(gen_random_uuid(), 1, 'override', 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_void(gen_random_uuid(), 'x', 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_waive_receipt(gen_random_uuid(), null, 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_record_payment(gen_random_uuid(), 'cash', null, current_date, null, 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_reverse_payment(gen_random_uuid(), 'x', 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_add_note(gen_random_uuid(), 'x', 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_set_chargeable('b0000000-0000-0000-0000-000000000004', false, 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_save_category(null, 'Nope', 0, 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_end_category(gen_random_uuid(), 'e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select * from presby_reimbursement_treasurer_list('e0000000-0000-0000-0000-0000000000f3', 'all', null, null, null, 10, 0)$q$,
      $q$select * from presby_reimbursement_export_rows('e0000000-0000-0000-0000-0000000000f3', null, null, null, 10)$q$,
      $q$select presby_reimbursement_settings('e0000000-0000-0000-0000-0000000000f3')$q$,
      $q$select presby_deny_reimbursement()$q$];
    v_sql text;
    v_n integer := 0;
  begin
    foreach v_sql in array v_calls loop
      begin
        execute v_sql;
        raise exception 'FAIL 73c - no refusal for: %', v_sql;
      exception when insufficient_privilege then
        if sqlerrm <> 'reimbursement: not permitted' then
          raise exception 'FAIL 73c - wrong refusal "%" for: %', sqlerrm, v_sql;
        end if;
        v_n := v_n + 1;
      end;
    end loop;
    if v_n <> 28 then
      raise exception 'FAIL 73c - % of 28 refused', v_n;
    end if;
    raise notice 'pass  73c: 28 calls (every actor-taking definer, the key-gated ones as a keyless member, and the literal itself) refuse with exactly ''reimbursement: not permitted''';
  end $$;
commit;

begin;
  -- No organization context at all.
  do $$
  begin
    perform presby_reimbursement_my_requests('e0000000-0000-0000-0000-0000000000f2', 10, 0);
    raise exception 'FAIL 73c - a definer ran with no organization context';
  exception when insufficient_privilege then
    if sqlerrm <> 'reimbursement: not permitted' then raise exception 'FAIL 73c - wrong literal %', sqlerrm; end if;
    raise notice 'pass  73c: unset GUC - the identity literal';
  end $$;
  select assert_eq(
    (select (not presby_reimbursement_may_file('e0000000-0000-0000-0000-0000000000f2'))::int
            + (presby_reimbursement_pay_holder_count() = 0)::int + (presby_reimbursement_open_count() = 0)::int),
    3, '73c: the three actor-free reads answer false / 0 / 0 with no organization context (never an error)');
commit;

-- ===========================================================================
-- (d) The path, as presby_app: draft, receipt, submit (seat route), the
--     approver separation of duties, payment by a different person, the
--     payer-is-approver refusal, the deferred checks, reversal.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P73_ALDER, true);
  -- presby_app holds INSERT on blob_assets (the store adapter's path).
  insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
  values ('a7399999-0000-4000-8000-000000000001', :P73_ALDER, repeat('ab', 32), 'image/jpeg', 3, '\x010203');

  select * from presby_reimbursement_save_draft('p73-key-000001', 'reimburse', :P73_PROPERTY, null, null, 2500,
           presby_reimbursement_org_today() - 2, 'Paint for the hall', :P73_CATEGORY, null, false, :P73_MARGUERITE_USER) \gset p73d_
  select assert_eq((:'p73d_outcome' = 'ok' and :'p73d_created')::int, 1, '73d: a member who may file saves a draft');
  select assert_eq(
    (select count(*) from presby_reimbursement_save_draft('p73-key-000001', 'vendor', :P73_SESSION, null, 'Other', 1,
              null, null, null, null, true, :P73_MARGUERITE_USER) s
      where s.outcome = 'ok' and s.request_id = :'p73d_request_id' and not s.created and s.revision = 1),
    1, '73d (EC1, P3-5): the same client key returns the same request, untouched');
  select assert_eq(
    (select count(*) from presby_reimbursement_submit(:'p73d_request_id', 1, :P73_MARGUERITE_USER) s
      where s.outcome = 'incomplete' and s.missing = array['receipt']),
    1, '73d: submit without a receipt is incomplete, naming the receipt');
  select assert_eq(
    (select count(*) from presby_reimbursement_attach_receipt(:'p73d_request_id', 'a7399999-0000-4000-8000-000000000001',
              repeat('cd', 32), 'image/jpeg', 3, 'receipt.jpg', :P73_MARGUERITE_USER) s where s.outcome = 'ok'),
    1, '73d: the creator attaches a stored private receipt');
  select assert_eq(
    (select count(*) from presby_reimbursement_submit(:'p73d_request_id', 1, :P73_MARGUERITE_USER) s
      where s.outcome = 'changed_since_viewed' and s.revision = 2),
    1, '73d (P3-8): the attach bumped the revision; the stale submit says so');
  select assert_eq(
    (select count(*) from presby_reimbursement_submit(:'p73d_request_id', 2, :P73_MARGUERITE_USER) s
      where s.outcome = 'ok' and s.route = 'seat' and s.notify_person_ids = array[:P73_TOBIAS::uuid]
        and s.group_name = 'Property Committee'),
    1, '73d: submit routes to the seat and names the chair to notify');
  select assert_eq(
    (select count(*) from presby_reimbursement_submit(:'p73d_request_id', 2, :P73_MARGUERITE_USER) s
      where s.outcome = 'already_submitted'),
    1, '73d (EC2): a second submit answers already_submitted');
  select assert_eq(
    (select count(*) from presby_reimbursement_waiting_for_me(:P73_TOBIAS_USER) w where w.id = :'p73d_request_id'),
    1, '73d: the chair''s queue holds it');
  select assert_eq(
    (select count(*) from presby_reimbursement_approve(:'p73d_request_id', 2, 'seat', :P73_MARGUERITE_USER) a
      where a.outcome = 'not_approvable'),
    1, '73d (EC7): the requester cannot approve her own request');
  select assert_eq(
    (select count(*) from presby_reimbursement_approve(:'p73d_request_id', 2, 'seat', :P73_TOBIAS_USER) a
      where a.outcome = 'ok' and a.current_status = 'approved' and a.notify_requester_person_id = :P73_MARGUERITE::uuid),
    1, '73d: the chair approves');
  select assert_eq(
    (select count(*) from presby_reimbursement_approve(:'p73d_request_id', 2, 'seat', :P73_TOBIAS_USER) a
      where a.outcome = 'already_decided' and a.decided_on = presby_reimbursement_org_today()),
    1, '73d: approving twice answers already_decided with the org-local date');

  -- Give BOTH the requester and the approver the treasurer role (person arm).
  insert into role_grants (organization_id, role_id, person_id, starts_on)
  values (:P73_ALDER, :P73_TREASURER_ROLE, :P73_MARGUERITE, '2020-01-01'),
         (:P73_ALDER, :P73_TREASURER_ROLE, :P73_TOBIAS, '2020-01-01');
  select assert_eq(
    (select count(*) from presby_reimbursement_record_payment(:'p73d_request_id', 'check', '1001',
              presby_reimbursement_org_today(), null, :P73_TOBIAS_USER) p where p.outcome = 'payer_is_approver'),
    1, '73d (EC8, DECISION-268): the approver cannot record the payment');
  select assert_eq(
    (select count(*) from presby_reimbursement_record_payment(:'p73d_request_id', 'check', null,
              presby_reimbursement_org_today(), null, :P73_MARGUERITE_USER) p where p.outcome = 'reference_required'),
    1, '73d: a check payment needs a check number');
  select assert_eq(
    (select count(*) from presby_reimbursement_record_payment(:'p73d_request_id', 'check', '1001',
              presby_reimbursement_org_today(), null, :P73_MARGUERITE_USER) p where p.outcome = 'ok' and p.self_paid),
    1, '73d (EC9, D6): with the only other pay holder being the approver, the requester may pay, stamped self_paid');
  set constraints all immediate;
  set constraints all deferred;
  select assert_eq(
    (select count(*) from presby_reimbursement_detail(:'p73d_request_id', :P73_MARGUERITE_USER, 'member') d
      where d ->> 'status' = 'paid' and d ->> 'paidOn' is not null and not d ? 'payments'
        and d -> 'duplicateReceipt' = 'null'::jsonb),
    1, '73d: the requester projection shows paid, never the payments or the duplicate flag');
  select assert_eq(
    (select count(*) from presby_reimbursement_reverse_payment(:'p73d_request_id', 'Wrong check', :P73_TOBIAS_USER) r
      where r.outcome = 'ok'),
    1, '73d (EC32): a pay holder reverses the payment');
  set constraints all immediate;
  set constraints all deferred;
  select assert_eq(
    (select count(*) from presby_reimbursement_detail(:'p73d_request_id', :P73_TOBIAS_USER, 'treasury') d
      where d ->> 'status' = 'approved' and jsonb_array_length(d -> 'payments') = 2
        and d -> 'payments' @> '[{"kind": "payment", "reversed": true}, {"kind": "reversal", "reason": "Wrong check"}]'::jsonb),
    1, '73d: the reversal returns the request to approved; both rows stay on record');
rollback;

-- ===========================================================================
-- (e) Isolation is the definers' explicit organization predicate (the owner
--     bypasses RLS). Rowan is a live member of Alder Creek AND the
--     Presbytery of the Northern Reach; his Alder request is invisible and
--     untouchable from the presbytery context.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P73_ALDER, true);
  -- Rowan's account (a7399999-...e1) is linked by scripts/treasury/seed-dev-treasury.sql
  -- on the owner path: since drizzle/0065 (F186) presby_app may not write
  -- people.user_id. Pin the fixture so a missing seed fails here, by name.
  select assert_eq((select count(*) from people where id = :P73_ROWAN
                     and user_id = 'a7399999-0000-4000-8000-0000000000e1'),
                   1, '73e: the seed links Rowan to the p73.rowan@ account (owner path, F186)');
  select * from presby_reimbursement_save_draft('p73-key-000002', 'vendor', :P73_PROPERTY, null, 'Hardware Co', 900,
           presby_reimbursement_org_today(), 'Hinges', :P73_CATEGORY, null, true, 'a7399999-0000-4000-8000-0000000000e1') \gset p73e_
  select assert_eq((select count(*) from presby_reimbursement_submit(:'p73e_request_id', 1, 'a7399999-0000-4000-8000-0000000000e1') s
                     where s.outcome = 'ok'), 1, '73e: Rowan files and submits at Alder Creek');

  select set_config('app.current_org_id', :P73_PRESBYTERY, true);
  select assert_eq(
    (select (presby_reimbursement_detail(:'p73e_request_id', 'a7399999-0000-4000-8000-0000000000e1', 'member') is null)::int),
    1, '73e: from the presbytery, his own Alder request is not found');
  select assert_eq(
    (select count(*) from presby_reimbursement_my_requests('a7399999-0000-4000-8000-0000000000e1', 50, 0)),
    0, '73e: and is not in his list there');
  select assert_eq(
    (select count(*) from presby_reimbursement_withdraw(:'p73e_request_id', null, 'a7399999-0000-4000-8000-0000000000e1') w
      where w.outcome = 'not_found'),
    1, '73e: and cannot be withdrawn from there');
  select assert_eq(
    (select count(*) from presby_reimbursement_attachment_lookup(:'p73e_request_id', gen_random_uuid(),
              'a7399999-0000-4000-8000-0000000000e1')),
    0, '73e: and no receipt lookup reaches it');
  select assert_eq(presby_reimbursement_open_count(), 0, '73e: the presbytery''s open count does not count it');
rollback;

-- ===========================================================================
-- (f) F301: a role carrying a reimbursement key never travels a commission
--     or delegation, on the tenant connection too (and 0055's giving guard
--     is untouched: the role below carries no giving key).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P73_ALDER, true);
  insert into app_roles (id, organization_id, key, name, role_kind)
  values ('a7399999-0000-4000-8000-0000000000f1', :P73_ALDER, 'p73_viewer', 'P73 viewer', 'custom');
  insert into app_role_permissions (role_id, permission_key)
  values ('a7399999-0000-4000-8000-0000000000f1', 'reimbursement.view');
  do $$
  begin
    insert into org_delegations (grantor_org_id, grantee_org_id, role_id, starts_on)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
            'a7399999-0000-4000-8000-0000000000f1', current_date);
    raise exception 'FAIL 73f - a reimbursement role travelled a delegation';
  exception when insufficient_privilege then
    if sqlerrm not like 'org_delegations: a role carrying a reimbursement key cannot be granted%' then
      raise exception 'FAIL 73f - wrong refusal %', sqlerrm;
    end if;
    raise notice 'pass  73f (F301): a role carrying reimbursement.view cannot be delegated';
  end $$;
rollback;
begin;
  select set_config('app.current_org_id', :P73_ALDER, true);
  insert into app_roles (id, organization_id, key, name, role_kind)
  values ('a7399999-0000-4000-8000-0000000000f2', :P73_ALDER, 'p73_plain', 'P73 plain', 'custom');
  insert into org_delegations (grantor_org_id, grantee_org_id, role_id, starts_on)
  values (:P73_ALDER, :P73_PRESBYTERY, 'a7399999-0000-4000-8000-0000000000f2', current_date);
  do $$
  begin
    insert into app_role_permissions (role_id, permission_key)
    values ('a7399999-0000-4000-8000-0000000000f2', 'reimbursement.pay');
    raise exception 'FAIL 73f - a reimbursement key was bound to a delegated role';
  exception when insufficient_privilege then
    if sqlerrm not like 'app_role_permissions: a reimbursement key cannot be bound%' then
      raise exception 'FAIL 73f - wrong refusal %', sqlerrm;
    end if;
    raise notice 'pass  73f (F301): a reimbursement key cannot be bound to a role a delegation uses';
  end $$;
rollback;

-- ===========================================================================
-- (g) A receipt is this organization's PRIVATE blob (F289's catalog rule,
--     DECISION-277; drizzle/0073 section 1d). On the tenant path the refusal
--     is attach_receipt's `invalid_shape` (its D7 pre-check); the guarantee
--     on every connection is reimbursement_attachments_blob_fk, asserted in
--     (a) and proven on the owner path in reimbursement.db.test.ts.
--     presby_app holds INSERT on blob_assets (the store adapter's path), so it
--     can create both bad shapes itself: a public_site image of its own org,
--     and a private blob of Bramblewood (written under Bramblewood's context,
--     which RLS's with-check admits, then the context is switched back).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P73_BRAMBLE, true);
  insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
  values ('a7399999-0000-4000-8000-0000000000e1', :P73_BRAMBLE, repeat('71', 32), 'image/jpeg', 3, '\x010203');

  select set_config('app.current_org_id', :P73_ALDER, true);
  insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
  values ('a7399999-0000-4000-8000-0000000000e2', :P73_ALDER, repeat('72', 32), 'image/jpeg', 3, '\x010203', 'public_site');
  insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
  values ('a7399999-0000-4000-8000-0000000000e3', :P73_ALDER, repeat('73', 32), 'image/jpeg', 3, '\x010203');
  select assert_eq(
    (select count(*) from blob_assets
      where (id, organization_id, audience) in (('a7399999-0000-4000-8000-0000000000e2'::uuid, :P73_ALDER::uuid, 'public_site'),
                                                ('a7399999-0000-4000-8000-0000000000e3'::uuid, :P73_ALDER::uuid, 'private'))),
    2, '73g (not vacuous): Alder now holds one public_site and one private jpeg of the same size');

  select * from presby_reimbursement_save_draft('p73-key-00000g', 'reimburse', :P73_PROPERTY, null, null, 1200,
           presby_reimbursement_org_today() - 1, 'Bulbs for the hall', :P73_CATEGORY, null, false, :P73_MARGUERITE_USER) \gset p73g_
  select assert_eq((:'p73g_outcome' = 'ok')::int, 1, '73g: Marguerite saves a draft to attach receipts to');

  select assert_eq(
    (select count(*) from presby_reimbursement_attach_receipt(:'p73g_request_id', 'a7399999-0000-4000-8000-0000000000e2',
              repeat('e2', 32), 'image/jpeg', 3, 'public.jpg', :P73_MARGUERITE_USER) s
      where s.outcome = 'invalid_shape' and s.attachment_id is null),
    1, '73g (F289): a receipt cannot point at a public_site blob, even its own org''s');
  select assert_eq(
    (select count(*) from presby_reimbursement_attach_receipt(:'p73g_request_id', 'a7399999-0000-4000-8000-0000000000e1',
              repeat('e1', 32), 'image/jpeg', 3, 'foreign.jpg', :P73_MARGUERITE_USER) s
      where s.outcome = 'invalid_shape' and s.attachment_id is null),
    1, '73g (F2): a receipt cannot point at another organization''s private blob');
  select assert_eq(
    (select count(*) from presby_reimbursement_attach_receipt(:'p73g_request_id', gen_random_uuid(),
              repeat('e4', 32), 'image/jpeg', 3, 'missing.jpg', :P73_MARGUERITE_USER) s
      where s.outcome = 'invalid_shape'),
    1, '73g: nor at a key that names no blob');
  select assert_eq(
    (select count(*) from presby_reimbursement_receipt_preflight(:'p73g_request_id', :P73_MARGUERITE_USER) p
      where p.outcome = 'ok' and p.live_count = 0),
    1, '73g: the three refusals attached nothing');
  select assert_eq(
    (select count(*) from presby_reimbursement_attach_receipt(:'p73g_request_id', 'a7399999-0000-4000-8000-0000000000e3',
              repeat('e3', 32), 'image/jpeg', 3, 'private.jpg', :P73_MARGUERITE_USER) s
      where s.outcome = 'ok' and s.attachment_id is not null),
    1, '73g (not vacuous): the same request takes its own org''s private blob of the same type and size');
  select assert_eq(
    (select count(*) from presby_reimbursement_receipt_preflight(:'p73g_request_id', :P73_MARGUERITE_USER) p
      where p.outcome = 'ok' and p.live_count = 1),
    1, '73g: and holds exactly that one receipt');
  set constraints all immediate;
  set constraints all deferred;
rollback;

\echo ' Section 73 complete.'
