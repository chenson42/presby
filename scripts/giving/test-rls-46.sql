-- ---------------------------------------------------------------------------
-- 46. Online giving (drizzle/0055_presby_giving.sql; DECISION-168..175,
--     F138-F141; scripts/giving/seed-dev-giving.sql supplies every fixture
--     row read here).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after section 45's closing banner:
--
--         \ir giving/test-rls-46.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/giving/test-rls-46.sql
--
--     after scripts/install-test-helpers.sql (owner) and the seed draft.
--
--     Fourteen things, (a)-(n), the Phase 3 table. What presby_app CANNOT
--     reach is proven on the owner connection in Vitest instead, exactly as
--     section 45 did for its cascade:
--       src/lib/db/domain/giving.db.test.ts - the freeze/write/delete guards
--         firing on the OWNER path (46h), the P3-8 org-teardown cascade
--         premise, the owner-path composite-FK refusal (46c), the
--         `unavailable` and `onboarding` public states (46l), and the
--         whole-database "no other role carries a giving key" (46m);
--       src/lib/giving/two-factor-agreement.test.ts - the 2FA agreement
--         matrix over all four resolver arms with scenario-built users (46j);
--         arms 3 and 4 need a non-giving requires_two_factor key, because
--         DECISION-175's triggers forbid giving keys on those arms.
--
--     No block below writes durably: every one ends in rollback.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set ALDER   '\'22222222-2222-2222-2222-222222222222\''
\set BRAMBLE '\'33333333-3333-3333-3333-333333333333\''
\set PRESBY  '\'11111111-1111-1111-1111-111111111111\''
\set ELDERUSER '\'e0000000-0000-0000-0000-0000000000f2\''
\set G_TEST_CONN    '\'d9100000-0000-0000-0000-000000000010\''
\set G_LIVE_CONN    '\'d9100000-0000-0000-0000-000000000011\''
\set G_BRAMBLE_CONN '\'d9100000-0000-0000-0000-000000000012\''
\set G_GENERAL      '\'d9100000-0000-0000-0000-000000000020\''
\set G_BUILDING     '\'d9100000-0000-0000-0000-000000000021\''
\set G_MISSIONS     '\'d9100000-0000-0000-0000-000000000022\''
\set G_BRAMBLE_FUND '\'d9100000-0000-0000-0000-000000000030\''
\set G_DONOR_LINDEN '\'d9100000-0000-0000-0000-000000000040\''
\set G_DONOR_PLATE  '\'d9100000-0000-0000-0000-000000000045\''
\set G_DONOR_PROPOSAL '\'d9100000-0000-0000-0000-000000000042\''
\set G_GIFT_ONLINE  '\'d9100000-0000-0000-0000-000000000083\''
\set G_RECORDER_ROLE '\'d9100000-0000-0000-0000-000000000001\''
\set TREASURER_ROLE '\'f0000000-0000-0000-0000-000000000007\''
\set TREASURER_TEMPLATE '\'00000000-0000-0000-0000-000000000005\''
\set RECORDER_TEMPLATE  '\'00000000-0000-0000-0000-000000000006\''
\set SESSION_MEMBER_ROLE '\'f0000000-0000-0000-0000-000000000001\''
\set PRIYA    '\'c0000000-0000-0000-0000-000000000003\''
\set DESMOND  '\'c0000000-0000-0000-0000-000000000004\''
\set IDRIS    '\'c0000000-0000-0000-0000-00000000000a\''
\set U_FOUNDING '\'e0000000-0000-0000-0000-0000000000f5\''
\set ALDER_SESSION_GROUP '\'b0000000-0000-0000-0000-000000000001\''
-- The statement fixture's tax years. FIXED, never derived from current_date:
-- the seed's gift dates are fixed in these two years (seed-dev-giving.sql
-- header), so "last year" / "this year" in the 46p-46t labels mean these, and
-- the suite reads the same on any day (Phase 5 loop-back, 2026-10-19).
\set G_YEAR_PRIOR   2025
\set G_YEAR_CURRENT 2026

-- ===========================================================================
-- (a) Structure: FORCE RLS, tenant_isolation, composite keys, NO ACTION FKs.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('giving_settings','giving_provider_connections','giving_funds','giving_donors',
                        'giving_donor_identities','giving_donor_link_decisions','giving_checkout_intents',
                        'giving_provider_events','giving_gifts','giving_gift_reversals',
                        'giving_settlements','giving_settlement_lines')
        and relkind = 'r' and relrowsecurity and relforcerowsecurity),
    12, '46a: all twelve giving tables have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename like 'giving\_%' and policyname = 'tenant_isolation'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    15, '46a: every giving table (twelve from 0055, three statement tables from 0056) carries tenant_isolation with BOTH using and with check');
  select assert_eq(
    (select count(*) from pg_policies where tablename like 'giving\_%'),
    15, '46a: and no other policy on any giving table');
  select assert_eq(
    (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname like 'giving\_%' and c.contype = 'u'
        and c.conname like '%\_id\_org\_key'
        and (select array_agg(a.attname::text order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
            = array['id','organization_id']),
    14, '46a: unique (id, organization_id) on every giving table but giving_settings (F2; 0055 eleven + 0056 three)');
  -- Every FK from a giving table to another giving table or to memberships.
  select assert_eq(
    (select count(*) from pg_constraint c
       join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid
      where c.contype = 'f' and t.relname like 'giving\_%'
        and (r.relname like 'giving\_%' or r.relname = 'memberships')),
    28, '46a: 28 foreign keys between giving tables and to memberships (0055: 23; 0056: statement->donor, statement->predecessor, line->statement, line->gift, delivery->statement)');
  select assert_eq(
    (select count(*) from pg_constraint c
       join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid
      where c.contype = 'f' and t.relname like 'giving\_%'
        and (r.relname like 'giving\_%' or r.relname = 'memberships')
        and array_length(c.conkey, 1) = 2
        and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[2]) = 'organization_id'
        and (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[2]) = 'organization_id'
        and (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) = 'id'
        and c.confdeltype = 'a'),
    28, '46a: every one of them is COMPOSITE (x_id, organization_id) -> (id, organization_id) and NO ACTION (F2, DECISION-161)');
  select assert_eq(
    (select count(*) from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where c.contype = 'f' and t.relname like 'giving\_%'
        and c.confrelid = 'organizations'::regclass and c.confdeltype = 'c'),
    15, '46a: every giving table''s organization_id FK cascades from organizations');
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name like 'giving\_%' and column_name in ('person_id', 'about_org_id')),
    0, '46a/46d: no giving table has a person_id (schema-design section 7) or an about_org_id column');
rollback;

-- ===========================================================================
-- (b) The grant matrix. No DELETE for anyone; presby_platform holds NOTHING;
--     presby_app exactly the design's table.
-- ===========================================================================
begin;
  with expected(tbl, priv) as (values
    ('giving_settings','SELECT'), ('giving_settings','INSERT'), ('giving_settings','UPDATE'),
    ('giving_provider_connections','SELECT'), ('giving_provider_connections','INSERT'),
    ('giving_funds','SELECT'), ('giving_funds','INSERT'), ('giving_funds','UPDATE'),
    ('giving_donors','SELECT'), ('giving_donors','INSERT'), ('giving_donors','UPDATE'),
    ('giving_donor_identities','SELECT'),
    ('giving_donor_link_decisions','SELECT'), ('giving_donor_link_decisions','INSERT'),
    ('giving_checkout_intents','SELECT'),
    ('giving_gifts','SELECT'), ('giving_gift_reversals','SELECT'),
    ('giving_settlements','SELECT'), ('giving_settlement_lines','SELECT'),
    -- drizzle/0056: issuing is a tenant act, bounded by the insert guards and
    -- the deferred consistency triggers; never UPDATE, never DELETE.
    ('giving_statements','SELECT'), ('giving_statements','INSERT'),
    ('giving_statement_lines','SELECT'), ('giving_statement_lines','INSERT'),
    ('giving_statement_deliveries','SELECT'), ('giving_statement_deliveries','INSERT')),
  actual as (
    select c.relname::text as tbl, a.privilege_type::text as priv, a.grantee
      from pg_class c, aclexplode(c.relacl) a
     where c.relname like 'giving\_%' and c.relkind = 'r'
       and a.grantee <> c.relowner)
  select assert_eq(
    (select count(*) from (
       (select tbl, priv from actual where grantee = 'presby_app'::regrole except select tbl, priv from expected)
       union all
       (select tbl, priv from expected except select tbl, priv from actual where grantee = 'presby_app'::regrole)) d),
    0, '46b: presby_app''s table privileges on the giving tables equal the design''s grant matrix exactly');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname like 'giving\_%' and c.relkind = 'r' and a.grantee <> c.relowner
        and a.grantee <> 'presby_app'::regrole),
    0, '46b: nobody but presby_app holds any table privilege - presby_platform and PUBLIC hold nothing');
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname like 'giving\_%' and c.relkind = 'r'
        and (has_table_privilege('presby_app', c.oid, 'DELETE')
             or has_table_privilege('presby_platform', c.oid, 'DELETE')
             or has_table_privilege('presby_app', c.oid, 'TRUNCATE'))),
    0, '46b: NO DELETE (or TRUNCATE) on any giving table for presby_app or presby_platform');
  select assert_eq(
    (select count(*) from (values ('giving_gifts'), ('giving_gift_reversals'), ('giving_checkout_intents'),
                                  ('giving_donor_identities'), ('giving_settlements'), ('giving_settlement_lines')) v(t)
      where has_table_privilege('presby_app', v.t, 'INSERT') or has_table_privilege('presby_app', v.t, 'UPDATE')
         or has_any_column_privilege('presby_app', v.t, 'UPDATE')),
    0, '46b: presby_app holds no INSERT/UPDATE on gifts, reversals, intents, identities, settlements or lines (P3-7)');
  select assert_eq(
    (select count(*) from pg_attribute a, aclexplode(a.attacl) x
      where a.attrelid = 'giving_provider_connections'::regclass and x.grantee = 'presby_app'::regrole
        and x.privilege_type = 'UPDATE'
        and a.attname in ('public_enabled_at','public_enabled_by','payouts_attested_at','payouts_attested_by',
                          'card_fee_bps','card_fee_fixed_cents','ach_fee_bps','ach_fee_cap_cents','updated_at')),
    9, '46b: connections - the nine go-live/attestation/fee-rate columns carry presby_app UPDATE');
  select assert_eq(
    (select count(*) from pg_attribute a, aclexplode(a.attacl) x
      where a.attrelid = 'giving_provider_connections'::regclass and x.privilege_type = 'UPDATE'),
    9, '46b: ... and ONLY those nine: status and the capability flags move through DEFINER functions');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    delete from giving_funds where name = 'Building Fund';
    raise exception 'FAIL - presby_app deleted a fund';
  exception when insufficient_privilege then
    raise notice 'pass  46b: presby_app DELETE on giving_funds refused';
  end $$;
  do $$
  begin
    update giving_provider_connections set status = 'active' where status = 'active';
    raise exception 'FAIL - presby_app updated a connection''s status column';
  exception when insufficient_privilege then
    raise notice 'pass  46b: presby_app UPDATE of connections.status refused (column grant)';
  end $$;
  update giving_provider_connections set card_fee_bps = card_fee_bps where status = 'active';
  select assert_eq(1, 1, '46b: presby_app UPDATE of a granted column (card_fee_bps) is accepted');
rollback;

-- ===========================================================================
-- (c) Tenancy.
-- ===========================================================================
begin;
  select assert_eq((select count(*) from giving_gifts) + (select count(*) from giving_donors)
                   + (select count(*) from giving_funds) + (select count(*) from giving_provider_connections),
                   0, '46c: unset GUC - every giving table is invisible');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_gifts), 12, '46c: alder sees its own twelve gifts (G12/G13 added for statements, Batch 5a)');
  select assert_eq((select count(*) from giving_donors), 7, '46c: alder sees its own seven donors');
  select assert_eq((select count(*) from giving_funds), 3, '46c: alder sees its own three funds');
  select assert_eq((select count(*) from giving_provider_connections), 2, '46c: alder sees its two connections');
  select assert_eq((select count(*) from giving_checkout_intents), 7, '46c: alder sees its seven intents');
  select assert_eq((select count(*) from giving_gifts where organization_id <> :ALDER)
                   + (select count(*) from giving_donors where organization_id <> :ALDER)
                   + (select count(*) from giving_checkout_intents where organization_id <> :ALDER),
                   0, '46c: alder sees NO foreign giving rows');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from giving_gifts), 1, '46c: bramblewood sees only its own gift');
  select assert_eq((select count(*) from giving_gifts where id = :G_GIFT_ONLINE), 0,
                   '46c: bramblewood cross-org read of an alder gift by known id returns zero');
  select assert_eq((select count(*) from giving_donors where id = :G_DONOR_LINDEN), 0,
                   '46c: bramblewood cross-org read of an alder donor by known id returns zero');
  select assert_eq((select count(*) from giving_settings), 0, '46c: bramblewood sees no giving_settings row (alder''s is invisible)');
  select assert_eq((select count(*) from giving_donor_identities) + (select count(*) from giving_gift_reversals),
                   0, '46c: bramblewood sees no identities and no reversals');
rollback;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into giving_donors (organization_id, display_name) values ('22222222-2222-2222-2222-222222222222', 'Hijacked Donor');
    raise exception 'FAIL - bramblewood wrote a donor into alder';
  exception when insufficient_privilege then
    raise notice 'pass  46c: tenant_isolation WITH CHECK refuses a cross-org donor insert';
  end $$;
  do $$
  begin
    insert into giving_funds (organization_id, name) values ('22222222-2222-2222-2222-222222222222', 'Hijacked Fund');
    raise exception 'FAIL - bramblewood wrote a fund into alder';
  exception when insufficient_privilege then
    raise notice 'pass  46c: tenant_isolation WITH CHECK refuses a cross-org fund insert';
  end $$;
  do $$
  begin
    insert into giving_donor_link_decisions (organization_id, donor_id, membership_id, decision)
    values ('22222222-2222-2222-2222-222222222222', 'd9100000-0000-0000-0000-000000000042',
            gen_random_uuid(), 'dismissed');
    raise exception 'FAIL - bramblewood wrote a link decision into alder';
  exception when insufficient_privilege then
    raise notice 'pass  46c: tenant_isolation WITH CHECK refuses a cross-org link-decision insert';
  end $$;
rollback;

-- The composite FK refuses a same-org row pointing at ANOTHER org's membership
-- (RLS hides it; the RI check ignores RLS - it is the composite key that refuses).
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  select m.id::text as presby_membership from memberships m where m.person_id = :IDRIS \gset
  select set_config('rls_test.presby_membership', :'presby_membership', true);
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into giving_donors (organization_id, display_name, linked_membership_id, link_source, linked_at)
    values ('22222222-2222-2222-2222-222222222222', 'Cross Link',
            current_setting('rls_test.presby_membership')::uuid, 'recorder_confirmed', now());
    raise exception 'FAIL - a donor was linked to another organization''s membership';
  exception when foreign_key_violation then
    raise notice 'pass  46c: giving_donors_link_fk is composite - a cross-org membership link is refused (F2)';
  end $$;
  do $$
  begin
    insert into giving_donor_link_decisions (organization_id, donor_id, membership_id, decision)
    values ('22222222-2222-2222-2222-222222222222', 'd9100000-0000-0000-0000-000000000042',
            current_setting('rls_test.presby_membership')::uuid, 'dismissed');
    raise exception 'FAIL - a link decision named another organization''s membership';
  exception when foreign_key_violation then
    raise notice 'pass  46c: giving_link_decisions_member_fk is composite (F2)';
  end $$;
rollback;

-- ===========================================================================
-- (d) The presbytery invariant (analyst tests 1-3, 7): per-member giving is
--     never visible to a parent council.
-- ===========================================================================
begin;
  -- (1) A presbytery person holds giving.view AT THE PRESBYTERY and still sees
  --     nothing of a member congregation's giving.
  select set_config('app.current_org_id', :PRESBY, true);
  insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
  values ('d9100000-0000-0000-0000-0000000000f1', :PRESBY, 'rls46_presby_giving', 'RLS46 Presbytery Giving', 'custom', false);
  insert into app_role_permissions (role_id, permission_key)
  values ('d9100000-0000-0000-0000-0000000000f1', 'giving.view');
  insert into role_grants (organization_id, role_id, person_id, starts_on)
  values (:PRESBY, 'd9100000-0000-0000-0000-0000000000f1', :IDRIS, current_date - 1);
  select assert_eq((select count(*) where presby_has_permission(:IDRIS, :PRESBY, 'giving.view')), 1,
                   '46d(1): the presbytery person DOES hold giving.view at the presbytery');
  select assert_eq(
    (select count(*) from giving_settings) + (select count(*) from giving_provider_connections)
    + (select count(*) from giving_funds) + (select count(*) from giving_donors)
    + (select count(*) from giving_donor_identities) + (select count(*) from giving_donor_link_decisions)
    + (select count(*) from giving_checkout_intents) + (select count(*) from giving_gifts)
    + (select count(*) from giving_gift_reversals) + (select count(*) from giving_settlements)
    + (select count(*) from giving_settlement_lines)
    + (select count(*) from giving_statements) + (select count(*) from giving_statement_lines)
    + (select count(*) from giving_statement_deliveries),
    0, '46d(1): ...and reads ZERO rows of any giving table (statements included) - no member congregation''s giving');
  do $$
  begin
    perform presby_has_permission('c0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'giving.view');
    raise exception 'FAIL - the resolver answered for a member congregation from presbytery context';
  exception when insufficient_privilege then
    raise notice 'pass  46d(1): the resolver refuses to answer for a member congregation from presbytery context';
  end $$;
rollback;

begin;
  -- (2) No giving policy, trigger or function references the cross-council machinery.
  select assert_eq(
    (select count(*) from pg_proc p
      where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
        and (p.prosrc ~ 'presby_org_affiliated|presby_transfer_affiliation|presby_publish_sasr_snapshot|presby_list_published_returns_to_me|publications')),
    0, '46d(2): no giving function or trigger body mentions affiliation, publication or SASR machinery');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename like 'giving\_%' and coalesce(qual, '') || coalesce(with_check, '') ~ 'affiliat|publication'),
    0, '46d(2): no giving policy mentions affiliation or publication');
  -- (3) None of the cross-council functions mentions any giving relation.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_org_affiliated','presby_transfer_affiliation','presby_publish_sasr_snapshot',
                          'presby_list_published_returns_to_me','presby_effective_permissions')
        and p.prosrc ~ '\mgiving_(settings|provider_connections|funds|donors|donor_identities|donor_link_decisions|checkout_intents|provider_events|gifts|gift_reversals|settlements|settlement_lines|statements|statement_lines|statement_deliveries)\M'),
    0, '46d(3): no cross-council function (nor the resolver) reads a giving relation (by relation name: the SASR''s p_potential_giving_units is not one)');
rollback;

-- ===========================================================================
-- (e) The inbox is unreachable except through functions; the three
--     owner-only functions are owner-only.
--     Correction C1/C2 (0055 header, 2026-10-16): presby_giving_dead_letters()
--     is the third, and its result shape is pinned here from the catalog.
--     Running it against a dead-lettered fixture event is the OWNER's act, so
--     src/lib/db/domain/giving.db.test.ts proves that it returns the row and
--     never a body. The claim's two new columns (C1) ARE reachable as
--     presby_app, and are proven in the block after this one.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    perform count(*) from giving_provider_events;
    raise exception 'FAIL - presby_app read the provider-events inbox';
  exception when insufficient_privilege then
    raise notice 'pass  46e: presby_app SELECT on giving_provider_events is permission denied (R6)';
  end $$;
  select assert_eq(
    (select count(*) from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(p)
      where has_table_privilege('presby_app', 'giving_provider_events', v.p)),
    0, '46e: presby_app holds NO privilege of any kind on giving_provider_events');
  select assert_eq(
    (select count(*) from (values ('presby_giving_ingest_health()'), ('presby_giving_dead_letters(integer)'),
                                  ('presby_giving_requeue_event(uuid)')) v(f)
      where has_function_privilege('presby_app', v.f, 'EXECUTE')
         or has_function_privilege('presby_platform', v.f, 'EXECUTE')),
    0, '46e: presby_giving_ingest_health / dead_letters / requeue_event are NOT executable by presby_app or presby_platform (P3-6, C2)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_giving_ingest_health', 'presby_giving_dead_letters', 'presby_giving_requeue_event')
        and has_function_privilege(p.proowner, p.oid, 'EXECUTE')),
    3, '46e: ...and are executable by their owner');
  select assert_eq(
    (select count(*) from presby_giving_attention_events() where parked_count = 1 and dead_letter_count = 1),
    1, '46e: the tenant slice of the inbox is counts only - alder: one parked, one dead letter');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from presby_giving_attention_events() where parked_count = 0 and dead_letter_count = 0),
    1, '46e: bramblewood''s counts do not include alder''s inbox');
rollback;

-- C2: the dead-letter list is owner-only and its shape carries no body.
begin;
  do $$
  begin
    perform * from presby_giving_dead_letters(1);
    raise exception 'FAIL - presby_app executed presby_giving_dead_letters()';
  exception when insufficient_privilege then
    raise notice 'pass  46e: presby_app calling presby_giving_dead_letters() is permission denied (C2)';
  end $$;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_giving_dead_letters(integer)'::regprocedure
        and pg_get_function_result(p.oid) = 'TABLE(event_id uuid, connection_id uuid, organization_id uuid, external_event_id text, event_type text, received_at timestamp with time zone, attempts integer, last_error_class text)'),
    1, '46e: presby_giving_dead_letters() returns exactly (event_id, connection_id, organization_id, external_event_id, event_type, received_at, attempts, last_error_class) (C2)');
  select assert_eq(
    (select count(*) from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) a(n, m)
      where p.oid = 'presby_giving_dead_letters(integer)'::regprocedure
        and m = 't' and n ~ '(body|amount|cents|name|email|address|payload)'),
    0, '46e: ...and no result column is a body, an amount or a donor field');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_giving_dead_letters(integer)'::regprocedure
        and p.prosrc ~ 'raw_body'),
    0, '46e: ...and its body never reads raw_body');
rollback;

begin;
  do $$
  begin
    perform presby_giving_attention_events();
    raise exception 'FAIL - attention counts answered with no org context';
  exception when insufficient_privilege then
    raise notice 'pass  46e: tenant-path functions refuse with no org context (uniform insufficient_privilege)';
  end $$;
rollback;

-- C1: the claim returns the provider's event id and the organization, both
-- from the inbox row the event was resolved to (never a parameter).
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_giving_claim_event(uuid)'::regprocedure
        and pg_get_function_result(p.oid) = 'TABLE(raw_body text, event_type text, attempts integer, body_purged boolean, connection_id uuid, external_account_id text, livemode boolean, external_event_id text, organization_id uuid)'),
    1, '46e: presby_giving_claim_event() keeps its seven columns in order and appends external_event_id, organization_id (C1)');
  select inbox_id::text as ev from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
         'evt_rls46_claimcols1', false, 'charge.refunded', '{"rls":"46e"}') \gset
  select assert_eq(
    (select count(*) from presby_giving_claim_event(:'ev')
      where external_event_id = 'evt_rls46_claimcols1' and organization_id = :ALDER
        and connection_id = :G_TEST_CONN and raw_body = '{"rls":"46e"}'),
    1, '46e: a claim as presby_app returns the event id and alder as the organization (C1)');
rollback;

-- ===========================================================================
-- (f) Ingest (analyst test 4). No org parameter; org from the connection.
-- ===========================================================================
begin;
  select assert_eq((select count(*) from presby_giving_ingest_event('stripe', 'acct_unknown0000000001',
                      'evt_rls46_unknown01', false, 'checkout.session.completed', '{}') where outcome = 'ignored' and inbox_id is null),
                   1, '46f: an unknown account is ignored and returns no inbox id');
  select assert_eq((select count(*) from presby_giving_ingest_event('stripe', 'not-an-account',
                      'evt_rls46_malformed1', false, 'charge.refunded', '{}') where outcome = 'ignored'),
                   1, '46f: a malformed account id is ignored');
  select assert_eq((select count(*) from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
                      'evt_rls46_mode00001', true, 'charge.refunded', '{}') where outcome = 'ignored'),
                   1, '46f: a livemode mismatch (live event, test-mode connection) is ignored');
  -- ...and wrote nothing: the same event id is accepted (not duplicate) when it does match.
  select assert_eq((select count(*) from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
                      'evt_rls46_mode00001', false, 'charge.refunded', '{}') where outcome = 'accepted'),
                   1, '46f: ...and wrote nothing - the matching delivery of that event id is ACCEPTED, not duplicate');
  select assert_eq((select count(*) from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
                      'evt_rls46_mode00001', false, 'charge.refunded', '{}') where outcome = 'duplicate' and inbox_id is not null),
                   1, '46f: a replay of the same event id is a duplicate, pointing at the one row');
  select assert_eq((select count(*) from pg_proc p, unnest(p.proargnames) n
                     where p.proname = 'presby_giving_ingest_event' and n ilike '%org%'),
                   0, '46f: presby_giving_ingest_event has no parameter naming an organization');
  select assert_eq((select count(*) from pg_proc p, unnest(p.proargnames) n
                     where p.proname = 'presby_giving_apply_gift' and n ilike '%fund%'),
                   0, '46f: presby_giving_apply_gift has no fund parameter - the fund comes from the intent, never Stripe metadata');
rollback;

begin;
  select inbox_id::text as ev from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
         'evt_rls46_crossorg1', false, 'checkout.session.completed', '{"rls":46}') \gset
  select assert_eq((select count(*) from presby_giving_claim_event(:'ev') where connection_id = :G_TEST_CONN),
                   1, '46f: the claim returns the connection the event was resolved to (alder''s)');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_provider_connections where id = :G_TEST_CONN and organization_id = :ALDER),
                   1, '46f: inbox org = connection org - the connection is alder''s, read under alder''s policy');
  select set_config('app.current_org_id', '', true);
  select assert_eq(
    (select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_fixturebramble001', null, null,
       'pi_rls46crossorg01', 2500, now(), null, null, 'Cross Org', null, null, null, null, null, null, null, 'card')
       = 'ignored:no_intent'),
    1, '46f: an alder event naming BRAMBLEWOOD''s checkout session is ignored:no_intent');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46crossorg01')
                   + (select count(*) from giving_checkout_intents where status = 'completed'),
                   0, '46f: ...and nothing was written to bramblewood');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46crossorg01'),
                   0, '46f: ...nor to alder');
  select assert_eq(
    (select count(*) where presby_giving_apply_gift(gen_random_uuid(), 'succeeded', 'cs_test_fixture0000000006', null, null,
       'pi_rls46unclaimed1', 4000, now(), null, null, null, null, null, null, null, null, null, null, null)
       = 'ignored:no_event'),
    1, '46f: an apply naming an unknown inbox id writes nothing');
rollback;

-- ===========================================================================
-- (g) Apply semantics, end to end through the public create path.
-- ===========================================================================
begin;
  select intent_id::text as i1, total_cents as t1
    from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, false, 'card', 'once',
                                            '46000000-0000-4000-8000-000000000001') \gset
  select assert_eq((select count(*) where presby_giving_attach_session(:'i1', 'cs_test_rls46session0001')), 1,
                   '46g: attach_session sets the Checkout session once');
  select assert_eq((select count(*) where presby_giving_attach_session(:'i1', 'cs_test_rls46session0002')), 0,
                   '46g: ...and is set-once (a second attach is refused)');
  select inbox_id::text as ev from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
         'evt_rls46_apply0001', false, 'checkout.session.completed', '{"rls":46}') \gset
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0001', null, null,
       'pi_rls46apply00001', 2500, now(), null, 'cus_rls46cust0001', 'Tessaly Grove', 'tessaly.grove@example.invalid',
       '9 Fixture Court', null, 'Aldertown', 'OH', '00000', 'US', 'card') = 'ignored:not_claimed'), 1,
       '46g: an unclaimed inbox row is not applied (D3)');
  select count(*) from presby_giving_claim_event(:'ev') \gset claimed_
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0001', null, null,
       'pi_rls46apply00001', 2500, now(), null, 'cus_rls46cust0001', 'Tessaly Grove', 'tessaly.grove@example.invalid',
       '9 Fixture Court', null, 'Aldertown', 'OH', '00000', 'US', 'card') = 'applied'), 1,
       '46g: a claimed payment-mode event applies the gift');
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0001', null, null,
       'pi_rls46apply00001', 2500, now(), null, 'cus_rls46cust0001', 'Tessaly Grove', 'tessaly.grove@example.invalid',
       '9 Fixture Court', null, 'Aldertown', 'OH', '00000', 'US', 'card') = 'noop'), 1,
       '46g: applying the same event twice is a noop');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_gifts g join giving_checkout_intents i on i.id = g.intent_id
                     where g.external_transaction_id = 'pi_rls46apply00001' and g.status = 'succeeded'
                       and g.fund_id = :G_GENERAL and i.status = 'completed' and not g.livemode),
                   1, '46g: exactly ONE gift, in the intent''s fund, intent completed, test-mode like its connection');
  select assert_eq((select count(*) from giving_donors where email = 'tessaly.grove@example.invalid' and kind = 'identified'),
                   1, '46g: the donor was created from the payment''s billing details');
  select assert_eq((select count(*) from giving_donor_identities where external_customer_id = 'cus_rls46cust0001'),
                   1, '46g: ...with the customer recorded as a provider identity');
  select set_config('app.current_org_id', '', true);
  -- Out-of-order and illegal transitions through the function.
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'pending', 'cs_test_rls46session0001', null, null,
       'pi_rls46apply00001', 2500, now(), null, null, null, null, null, null, null, null, null, null, null) = 'noop'), 1,
       '46g: a late `pending` after `succeeded` is a noop, not a regression');
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'failed', 'cs_test_rls46session0001', null, null,
       'pi_rls46apply00001', 2500, now(), 'card_declined', null, null, null, null, null, null, null, null, null, null)
       = 'dead:illegal_transition'), 1,
       '46g: succeeded -> failed is refused (dead:illegal_transition)');
  -- fee/net set once
  select assert_eq((select count(*) where presby_giving_apply_gift_fee(:'ev', 'pi_rls46apply00001', 103, 2397, 'card') = 'applied'), 1,
                   '46g: fee and net apply once');
  select assert_eq((select count(*) where presby_giving_apply_gift_fee(:'ev', 'pi_rls46apply00001', 103, 2397, 'card') = 'noop'), 1,
                   '46g: ...the same fee again is a noop');
  select assert_eq((select count(*) where presby_giving_apply_gift_fee(:'ev', 'pi_rls46apply00001', 104, 2396, 'card') = 'dead:fee_conflict'), 1,
                   '46g: ...a different fee is refused (set-once)');
  select assert_eq((select count(*) where presby_giving_apply_gift_fee(:'ev', 'pi_rls46apply00001', 100, 9999, 'card') = 'dead:fee_mismatch'), 1,
                   '46g: ...a net that is not amount - fee is refused');
  -- reversals
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46noGift0001', 'refund', 're_rls46_nogift',
                     500, now(), null) = 'parked:no_gift'), 1, '46g: a reversal before its gift is parked:no_gift');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46apply00001', 'dispute', 'dp_rls46_0001',
                     1000, now(), null) = 'applied'), 1, '46g: a dispute reverses part of the gift');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46apply00001', 'dispute', 'dp_rls46_0001',
                     1000, now(), null) = 'noop'), 1, '46g: ...idempotent on (connection, external_reversal_id)');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46apply00001', 'reinstatement', 'dpw_rls46_0001',
                     1000, now(), 'dp_rls46_0001') = 'applied'), 1, '46g: a won dispute reinstates what it took');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46apply00001', 'reinstatement', 'dpw_rls46_0002',
                     1, now(), 'dp_rls46_0001') = 'dead:over_reversal'), 1,
                   '46g: a reinstatement beyond what the dispute took is dead:over_reversal');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46apply00001', 'refund', 're_rls46_0001',
                     2500, now(), null) = 'applied'), 1, '46g: a full refund applies');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46apply00001', 'refund', 're_rls46_0002',
                     1, now(), null) = 'dead:over_reversal'), 1, '46g: one cent more is dead:over_reversal (never silently clamped)');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_gift_reversals r join giving_gifts g on g.id = r.gift_id
                     where g.external_transaction_id = 'pi_rls46apply00001'),
                   3, '46g: ...and the refused reversals wrote no row (dispute, reinstatement, refund)');
rollback;

-- pending -> succeeded is legal; failed -> succeeded is not.
begin;
  select intent_id::text as i2 from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 5000, false, 'bank', 'once',
         '46000000-0000-4000-8000-000000000002') \gset
  select presby_giving_attach_session(:'i2', 'cs_test_rls46session0003');
  select intent_id::text as i3 from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 6000, false, 'bank', 'once',
         '46000000-0000-4000-8000-000000000003') \gset
  select presby_giving_attach_session(:'i3', 'cs_test_rls46session0004');
  select inbox_id::text as ev from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
         'evt_rls46_apply0002', false, 'checkout.session.completed', '{"rls":46}') \gset
  select count(*) from presby_giving_claim_event(:'ev') \gset claimed_
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'pending', 'cs_test_rls46session0003', null, null,
       'pi_rls46pending001', 5000, now(), null, null, 'Pending Giver', null, null, null, null, null, null, null, 'us_bank_account')
       = 'applied'), 1, '46g: an ACH gift lands pending');
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0003', null, null,
       'pi_rls46pending001', 5000, now(), null, null, null, null, null, null, null, null, null, null, null)
       = 'applied'), 1, '46g: pending -> succeeded is legal');
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'failed', 'cs_test_rls46session0004', null, null,
       'pi_rls46failed0001', 6000, now(), 'insufficient_funds', null, 'Failing Giver', null, null, null, null, null, null, null, null)
       = 'applied'), 1, '46g: a failed first ACH payment is a failed gift (P3-16)');
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0004', null, null,
       'pi_rls46failed0001', 6000, now(), null, null, null, null, null, null, null, null, null, null, null)
       = 'dead:illegal_transition'), 1, '46g: failed -> succeeded is refused');
  select assert_eq((select count(*) where presby_giving_apply_reversal(:'ev', 'pi_rls46failed0001', 'refund', 're_rls46_failed',
                     100, now(), null) = 'ignored:gift_failed'), 1, '46g: a reversal of a failed gift is ignored');
  select assert_eq((select count(*) where presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_fixture0000000006', null, null,
       'pi_rls46amount0001', 3999, now(), null, null, null, null, null, null, null, null, null, null, null)
       = 'dead:amount_mismatch'), 1, '46g: a first payment whose amount differs from the intent is dead:amount_mismatch (tamper signal)');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46pending001' and status = 'succeeded'),
                   1, '46g: the pending gift is now succeeded');
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46failed0001'
                       and status = 'failed' and failure_code = 'insufficient_funds'),
                   1, '46g: the failed gift carries its failure code');
rollback;

-- occurred_on: org-local, F132 fallback when the org has NO settings row.
begin;
  select intent_id::text as i4 from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 1500, false, 'card', 'once',
         '46000000-0000-4000-8000-000000000004') \gset
  select presby_giving_attach_session(:'i4', 'cs_test_rls46session0005');
  select intent_id::text as i5 from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 1600, false, 'card', 'once',
         '46000000-0000-4000-8000-000000000005') \gset
  select presby_giving_attach_session(:'i5', 'cs_test_rls46session0006');
  select intent_id::text as i6 from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 1700, false, 'card', 'once',
         '46000000-0000-4000-8000-000000000006') \gset
  select presby_giving_attach_session(:'i6', 'cs_test_rls46session0007');
  select inbox_id::text as ev from presby_giving_ingest_event('stripe', 'acct_fixture000000000001',
         'evt_rls46_apply0003', false, 'checkout.session.completed', '{"rls":46}') \gset
  select count(*) from presby_giving_claim_event(:'ev') \gset claimed_
  select set_config('app.current_org_id', :ALDER, true);
  update organization_settings set time_zone = 'America/New_York';
  select presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0005', null, null, 'pi_rls46date00001', 1500,
         '2027-01-01T03:00:00Z', null, null, null, null, null, null, null, null, null, null, null);
  update organization_settings set time_zone = 'Asia/Tokyo';
  select presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0006', null, null, 'pi_rls46date00002', 1600,
         '2027-01-01T03:00:00Z', null, null, null, null, null, null, null, null, null, null, null);
  delete from organization_settings;
  select presby_giving_apply_gift(:'ev', 'succeeded', 'cs_test_rls46session0007', null, null, 'pi_rls46date00003', 1700,
         '2027-01-01T03:00:00Z', null, null, null, null, null, null, null, null, null, null, null);
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46date00001' and occurred_on = '2026-12-31'),
                   1, '46g: 2027-01-01T03:00Z is 2026-12-31 in America/New_York (G9, statement year from occurred_on)');
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46date00002' and occurred_on = '2027-01-01'),
                   1, '46g: ...and 2027-01-01 when the org''s zone is Asia/Tokyo - the zone is read, not assumed');
  select assert_eq((select count(*) from giving_gifts where external_transaction_id = 'pi_rls46date00003' and occurred_on = '2026-12-31'),
                   1, '46g: ...and falls back to America/New_York for an org with NO organization_settings row (F132)');
rollback;

-- Offline record and void (deviation D2: the actor must hold giving.record).
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- Desmond (the fixture recorder) has no user; link founding.fixture's user to him for this block
  -- (through presby_connect_signed_in_account: scripts/giving/test-rls-46-link.sql).
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :DESMOND, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  -- current_date - 1: the guard compares with ORG-LOCAL today (America/New_York),
  -- which trails the session's UTC current_date for several hours a day.
  select presby_giving_record_offline_gift(:G_DONOR_PLATE, :G_GENERAL, current_date - 1, 'cash', 1234, null, null, null,
         'RLS46 plate', :U_FOUNDING)::text as og \gset
  select assert_eq((select count(*) from giving_gifts where id = :'og' and source = 'offline' and recorded_by = :U_FOUNDING
                       and livemode and status = 'succeeded'),
                   1, '46g: a giving.record holder records an offline cash gift');
  do $$
  begin
    perform presby_giving_record_offline_gift('d9100000-0000-0000-0000-000000000045', 'd9100000-0000-0000-0000-000000000020',
            current_date - 1, 'check', 500, '77', null, null, null, 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - an unidentified donor took a check';
  exception when check_violation then
    if sqlerrm <> 'giving_offline_gift: method_not_allowed' then raise; end if;
    raise notice 'pass  46g: unidentified plate cash accepts cash only';
  end $$;
  do $$
  begin
    perform presby_giving_record_offline_gift('d9100000-0000-0000-0000-000000000040', 'd9100000-0000-0000-0000-000000000022',
            current_date - 1, 'cash', 500, null, null, null, null, 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - an offline gift went into a retired fund';
  exception when check_violation then
    if sqlerrm <> 'giving_offline_gift: fund_unavailable' then raise; end if;
    raise notice 'pass  46g: offline recording rejects a retired fund';
  end $$;
  do $$
  begin
    perform presby_giving_record_offline_gift('d9100000-0000-0000-0000-000000000040', 'd9100000-0000-0000-0000-000000000020',
            current_date + 2, 'cash', 500, null, null, null, null, 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - a future-dated offline gift was accepted';
  exception when check_violation then
    if sqlerrm <> 'giving_offline_gift: date_out_of_range' then raise; end if;
    raise notice 'pass  46g: offline recording rejects a date after org-local today';
  end $$;
  do $$
  begin
    perform presby_giving_record_offline_gift('d9100000-0000-0000-0000-000000000040', 'd9100000-0000-0000-0000-000000000020',
            current_date - 1, 'cash', 500, null, null, null, null, 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL - a member WITHOUT giving.record recorded a gift';
  exception when insufficient_privilege then
    raise notice 'pass  46g: an active member without giving.record (clerk.fixture) is refused - D2';
  end $$;
  do $$
  begin
    perform presby_giving_record_offline_gift('d9100000-0000-0000-0000-000000000050', 'd9100000-0000-0000-0000-000000000020',
            current_date - 1, 'cash', 500, null, null, null, null, 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - an offline gift was recorded against another org''s donor';
  exception when check_violation then
    if sqlerrm <> 'giving_offline_gift: donor_unavailable' then raise; end if;
    raise notice 'pass  46g: another org''s donor is donor_unavailable';
  end $$;
  select assert_eq((select count(*) from presby_giving_void_gift(:'og', 'Entered twice', :U_FOUNDING) v where v is not null),
                   1, '46g: an offline gift is voided with a reason');
  select assert_eq((select count(*) from giving_gift_reversals where gift_id = :'og' and kind = 'void' and amount_cents = 1234),
                   1, '46g: ...as a void reversal for the full amount');
  select set_config('rls_test.og', :'og', true);
  do $$
  begin
    perform presby_giving_void_gift(current_setting('rls_test.og')::uuid, 'Again', 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - a gift was voided twice';
  exception when check_violation then
    if sqlerrm <> 'giving_void: already_voided' then raise; end if;
    raise notice 'pass  46g: void is once only';
  end $$;
  do $$
  begin
    perform presby_giving_void_gift('d9100000-0000-0000-0000-000000000083', 'Not offline', 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - an online gift was voided';
  exception when check_violation then
    if sqlerrm <> 'giving_void: not_offline' then raise; end if;
    raise notice 'pass  46g: void applies to offline gifts only';
  end $$;
rollback;

-- ===========================================================================
-- (h) Freeze and guards. The OWNER-path proofs (marker armed + illegal
--     update raises, any update without the marker raises, delete raises,
--     deletable_until permits, the org-teardown cascade) are in
--     src/lib/db/domain/giving.db.test.ts. Here: presby_app cannot even try,
--     and every guard is installed and enabled.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update giving_gifts set amount_cents = amount_cents + 1;
    raise exception 'FAIL - presby_app updated a gift';
  exception when insufficient_privilege then
    raise notice 'pass  46h: presby_app UPDATE on giving_gifts refused';
  end $$;
  do $$
  begin
    perform set_config('presby.giving_write_active', 'true', true);
    insert into giving_gift_reversals (organization_id, gift_id, kind, amount_cents, reason, occurred_on, recorded_by, livemode)
    values ('22222222-2222-2222-2222-222222222222', 'd9100000-0000-0000-0000-000000000080', 'void', 2500, 'x',
            current_date, 'e0000000-0000-0000-0000-0000000000f3', true);
    raise exception 'FAIL - presby_app inserted a reversal by arming the marker itself';
  exception when insufficient_privilege then
    raise notice 'pass  46h: arming the marker grants nothing - presby_app INSERT on reversals is still refused (the grant is the privilege, DECISION-141)';
  end $$;
  do $$
  begin
    delete from giving_donors where id = 'd9100000-0000-0000-0000-000000000046';
    raise exception 'FAIL - presby_app deleted a donor';
  exception when insufficient_privilege then
    raise notice 'pass  46h: presby_app DELETE on giving_donors refused';
  end $$;
  select assert_eq(
    (select count(*) from pg_trigger
      where not tgisinternal and tgenabled = 'O'
        and tgname in ('giving_donors_delete_guard','giving_gifts_delete_guard','giving_reversals_delete_guard',
                       'giving_events_delete_guard','giving_gifts_write_guard','giving_reversals_write_guard',
                       'giving_reversals_bound','giving_donors_guard','giving_connections_status_guard',
                       'giving_connections_insert_guard','administrative_commissions_giving_guard',
                       'org_delegations_giving_guard','app_role_permissions_giving_guard')),
    13, '46h: all thirteen giving guards are installed and ENABLED (origin mode)');
rollback;

-- Donor guard, reachable by presby_app (it holds UPDATE on donors).
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    -- unidentified -> identified: no CHECK or index objects, so only the guard can refuse it.
    update giving_donors set kind = 'identified' where id = 'd9100000-0000-0000-0000-000000000045';
    raise exception 'FAIL - a donor changed kind';
  exception when check_violation then
    raise notice 'pass  46h: giving_donors.kind is immutable';
  end $$;
  do $$
  begin
    update giving_donors set merged_into_id = 'd9100000-0000-0000-0000-000000000044', merged_at = now()
     where id = 'd9100000-0000-0000-0000-000000000046';
    raise exception 'FAIL - a donor was merged into a merged donor (depth 2)';
  exception when check_violation then
    raise notice 'pass  46h: a merge target must itself be unmerged (depth <= 1)';
  end $$;
  do $$
  begin
    update giving_donors set merged_into_id = 'd9100000-0000-0000-0000-000000000046', merged_at = now()
     where id = 'd9100000-0000-0000-0000-000000000040';
    raise exception 'FAIL - a donor others point at was merged';
  exception when check_violation then
    raise notice 'pass  46h: a donor others are merged into cannot itself be merged until they are repointed';
  end $$;
  do $$
  begin
    update giving_donors set display_name = 'Renamed' where id = 'd9100000-0000-0000-0000-000000000044';
    raise exception 'FAIL - a merged donor was edited';
  exception when check_violation then
    raise notice 'pass  46h: a merged donor is frozen';
  end $$;
  do $$
  begin
    update giving_donors set merged_into_id = 'd9100000-0000-0000-0000-000000000045', merged_at = now()
     where id = 'd9100000-0000-0000-0000-000000000046';
    raise exception 'FAIL - a donor was merged into plate cash';
  exception when check_violation then
    raise notice 'pass  46h: a donor cannot be merged into the unidentified donor (D4)';
  end $$;
  do $$
  begin
    insert into giving_donors (organization_id, kind, display_name) values ('22222222-2222-2222-2222-222222222222', 'unidentified', 'Second plate');
    raise exception 'FAIL - a second unidentified donor';
  exception when unique_violation then
    raise notice 'pass  46h: one unidentified donor per org';
  end $$;

  do $$
  begin
    insert into giving_provider_connections (organization_id, provider, external_account_id, livemode)
    values ('22222222-2222-2222-2222-222222222222', 'stripe', 'acct_rls46second0001', false);
    raise exception 'FAIL - a second open connection';
  exception when unique_violation then
    raise notice 'pass  46h: at most one non-disconnected connection per org (giving_connections_one_open_idx)';
  end $$;
rollback;

-- D1: a connection is born onboarding. Fernwood has NO connection, so the
-- one-open index cannot be what refuses - only the insert guard can.
begin;
  select set_config('app.current_org_id', '55555555-5555-5555-5555-555555555555', true);
  do $$
  begin
    insert into giving_provider_connections (organization_id, provider, external_account_id, livemode, status,
           charges_enabled, payouts_enabled, card_enabled)
    values ('55555555-5555-5555-5555-555555555555', 'stripe', 'acct_rls46hijack0001', false, 'active', true, true, true);
    raise exception 'FAIL - presby_app created a connection already active';
  exception when insufficient_privilege then
    raise notice 'pass  46h: a new connection is born onboarding (D1, giving_connections_insert_guard)';
  end $$;
  insert into giving_provider_connections (organization_id, provider, external_account_id, livemode)
  values ('55555555-5555-5555-5555-555555555555', 'stripe', 'acct_rls46fernwood01', false);
  select assert_eq((select count(*) from giving_provider_connections where status = 'onboarding' and not charges_enabled),
                   1, '46h: ...an onboarding connection with nothing enabled is accepted');
rollback;

-- ===========================================================================
-- (i) Inventory of the DEFINER family.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
        and p.proname <> 'presby_giving_gross_up' and not p.prosecdef),
    0, '46i: every presby_giving_* function (and presby_public_giving_config) is SECURITY DEFINER, except the pure gross-up');
  select assert_eq(
    (select count(*) from pg_proc p
      where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
        and not coalesce(p.proconfig @> array['search_path=public, pg_temp'], false)),
    0, '46i: every one pins search_path = public, pg_temp (DECISION-148)');
  -- A NULL proacl is the implicit default - EXECUTE to PUBLIC - so it counts.
  select assert_eq(
    (select count(*) from pg_proc p
      where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
        and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
    0, '46i: no giving function grants EXECUTE to PUBLIC (explicitly or by a NULL default ACL)');
  select assert_eq(
    (select count(*) from pg_proc p
      where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
        and has_function_privilege('presby_platform', p.oid, 'EXECUTE')),
    0, '46i: presby_platform executes no giving function');
  with granted as (
    select p.proname::text as f from pg_proc p
     where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
       and has_function_privilege('presby_app', p.oid, 'EXECUTE')),
  expected(f) as (values
    ('presby_giving_gross_up'), ('presby_giving_ingest_event'), ('presby_giving_claim_event'),
    ('presby_giving_finish_event'), ('presby_giving_due_events'), ('presby_giving_apply_gift'),
    ('presby_giving_apply_gift_fee'), ('presby_giving_apply_reversal'), ('presby_giving_apply_subscription'),
    ('presby_giving_apply_intent_expired'), ('presby_giving_apply_settlement'),
    ('presby_giving_apply_settlement_lines'), ('presby_giving_apply_connection_status'),
    ('presby_giving_refresh_my_connection'), ('presby_giving_disconnect_my_connection'),
    ('presby_giving_record_offline_gift'), ('presby_giving_void_gift'), ('presby_giving_create_intent_public'),
    ('presby_giving_create_intent_member'), ('presby_giving_attach_session'), ('presby_giving_fail_intent'),
    ('presby_public_giving_config'), ('presby_giving_return_state'), ('presby_giving_attention_events'),
    ('presby_giving_active_schedule_count'), ('presby_giving_purge_bodies'), ('presby_giving_expire_intents'))
  select assert_eq(
    (select count(*) from ((select f from granted except select f from expected)
                           union all (select f from expected except select f from granted)) d),
    0, '46i: presby_app''s EXECUTE list equals the design''s grant table exactly (27 functions; internals and triggers ungranted)');
  -- The write marker is armed only by the writer functions.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.prosrc like '%presby.giving_write_active'', ''true''%'),
    5, '46i: exactly five functions arm presby.giving_write_active (apply_gift, apply_gift_fee, apply_reversal, record_offline_gift, void_gift - and no other)');
rollback;

-- Correction C1/C2: the arming set and the owner-only set, BY NAME. Their own
-- transaction, so a failure above cannot mask them.
begin;
  -- The arming set by name, so a changed or added function that starts arming it is
  -- named in the diff (C1 changed claim_event; C2 added dead_letters, and
  -- neither may arm it).
  with arming as (
    select p.proname::text as f from pg_proc p
     where p.prosrc like '%presby.giving_write_active'', ''true''%'),
  expected(f) as (values
    ('presby_giving_apply_gift'), ('presby_giving_apply_gift_fee'), ('presby_giving_apply_reversal'),
    ('presby_giving_record_offline_gift'), ('presby_giving_void_gift'))
  select assert_eq(
    (select count(*) from ((select f from arming except select f from expected)
                           union all (select f from expected except select f from arming)) d),
    0, '46i: the arming set is exactly those five by name - presby_giving_claim_event and presby_giving_dead_letters are not in it');
  -- The OWNER-ONLY callable surface, by name: every giving function that is
  -- neither an internal helper (presby_giving__*) nor a trigger function and
  -- that presby_app cannot execute.
  with owner_only as (
    select p.proname::text as f from pg_proc p
     where (p.proname like 'presby\_giving%' or p.proname = 'presby_public_giving_config')
       and p.proname not like 'presby\_giving\_\_%'
       and p.prorettype <> 'trigger'::regtype
       and not has_function_privilege('presby_app', p.oid, 'EXECUTE')),
  -- drizzle/0059 (invitations) adds presby_giving_manage_holder_count, the
  -- treasurer-designation holder count, owner-only by design (DECISION-183, migration 0059):
  -- presby_accept_invitation() calls it as definer; presby_app never does.
  -- drizzle/0060 (designation revoke) adds presby_giving_manage_holder_grants on the
  -- same terms (revoked from public, presby_app, presby_platform).
  expected(f) as (values
    ('presby_giving_ingest_health'), ('presby_giving_dead_letters'), ('presby_giving_requeue_event'),
    ('presby_giving_manage_holder_count'), ('presby_giving_manage_holder_grants'))
  select assert_eq(
    (select count(*) from ((select f from owner_only except select f from expected)
                           union all (select f from expected except select f from owner_only)) d),
    0, '46i: the owner-only callable set is exactly ingest_health, dead_letters, requeue_event, manage_holder_count, manage_holder_grants (P3-6, C2, 0059, 0060)');
rollback;

-- ===========================================================================
-- (j) 2FA: requires_two_factor, arm B on the direct and group arms (arms 3/4
--     are in Vitest), the fixture-wide agreement, and the resolver pin.
-- ===========================================================================
begin;
  -- Six since drizzle/0080 (F343, DECISION-291): the three giving keys (0055)
  -- and the three administration keys. A pipeline that flags another key
  -- (treasury's 0074 reimbursement keys) updates this count when it merges.
  select assert_eq((select count(*) from permissions where requires_two_factor), 6,
                   '46j: requires_two_factor is true for exactly six keys (0055 giving, 0080 administration; DECISION-291)');
  select assert_eq((select count(*) from permissions where requires_two_factor
                     and key in ('giving.view','giving.record','giving.manage') and module = 'giving' and sensitivity_tier = 2),
                   3, '46j: ...the three giving keys, module giving, tier 2');
  select assert_eq((select count(*) from permissions where requires_two_factor and sensitivity_tier = 1
                     and ((key in ('roles.manage','role_grants.manage') and module = 'authz')
                       or (key = 'domains.manage' and module = 'domains'))),
                   3, '46j: ...and roles.manage, role_grants.manage (module authz) and domains.manage (module domains), tier 1 (0080)');
  -- F140 drift tripwire. If this fails, presby_effective_permissions() changed:
  -- re-check arm B of presby_two_factor_required() (drizzle/0055 section 18)
  -- against every resolver arm, then update this hash.
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_effective_permissions'
        and md5(prosrc) = '4c79e30535229f6fd44730c38add28d0'),
    1, '46j: presby_effective_permissions() is byte-identical to the version arm B mirrors (F140 md5 pin)');
rollback;

begin;
  -- Isolate arm B: alder's org-wide 2FA policy OFF for this transaction.
  select set_config('app.current_org_id', :ALDER, true);
  update organization_settings set require_two_factor = false;
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :PRIYA, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  select assert_eq((select presby_two_factor_required(:U_FOUNDING)::int), 1,
                   '46j: arm B - the treasurer (giving keys, direct grant) is required to use 2FA with the org policy off');
  update role_grants set ends_on = current_date where role_id = :TREASURER_ROLE and person_id = :PRIYA;
  select assert_eq((select presby_two_factor_required(:U_FOUNDING)::int), 0,
                   '46j: ...and not once that grant has ended (ends_on is exclusive)');
  update role_grants set ends_on = null, starts_on = current_date + 1 where role_id = :TREASURER_ROLE and person_id = :PRIYA;
  select assert_eq((select presby_two_factor_required(:U_FOUNDING)::int), 0,
                   '46j: ...nor while it is future-dated');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  update organization_settings set require_two_factor = false;
  -- Baseline, computed rather than assumed (F343 P3-8). seed-dev.sql alone
  -- gives elder.fixture no flagged key, so the expectation is 0 (CI). Where
  -- scripts/domains/seed-dev-domains.sql is also applied, Alder's brand_admin
  -- role carries domains.manage (flagged by 0080) and she holds it, so the
  -- expectation is 1. The expected value comes from the REAL resolver plus the
  -- org policy (the agreement loop's method below), never from the definer
  -- under test. On such a database the group-arm assertion that follows
  -- proves no 0 -> 1 transition; CI's seed-dev-only database still does.
  do $$
  declare
    r record;
    v_flagged text := null;
    v_policy boolean := false;
  begin
    for r in select * from presby_user_organizations('e0000000-0000-0000-0000-0000000000f2') where ended_on is null loop
      perform set_config('app.current_org_id', r.organization_id::text, true);
      v_flagged := coalesce(v_flagged,
        (select min(e.permission_key) from presby_effective_permissions(r.person_id, r.organization_id) e
           join permissions pm on pm.key = e.permission_key and pm.requires_two_factor));
      v_policy := v_policy or coalesce((select s.require_two_factor from organization_settings s
                                         where s.organization_id = r.organization_id), false);
    end loop;
    perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
    perform set_config('presby.t46j_elder_expected', ((v_flagged is not null) or v_policy)::int::text, true);
    perform set_config('presby.t46j_elder_reason',
      case when v_flagged is not null then 'holds flagged key ' || v_flagged
           when v_policy then 'a congregation policy is on'
           else 'holds no flagged key and no policy applies' end, true);
  end $$;
  select assert_eq((select presby_two_factor_required(:ELDERUSER)::int),
                   current_setting('presby.t46j_elder_expected')::int,
                   '46j: baseline - with the org policy off, elder.fixture is required exactly when the resolver says she holds a flagged key ('
                   || current_setting('presby.t46j_elder_reason') || ')');
  -- Group arm: the recorder role granted to the Session group (Marguerite is an elder).
  insert into role_grants (organization_id, role_id, group_id, starts_on)
  values (:ALDER, :G_RECORDER_ROLE, :ALDER_SESSION_GROUP, current_date - 1);
  select assert_eq((select presby_two_factor_required(:ELDERUSER)::int), 1,
                   '46j: arm B via the GROUP arm - a giving role granted to her group requires 2FA');
  update organization_settings set require_two_factor = true;
  select assert_eq((select presby_two_factor_required(:ELDERUSER)::int), 1,
                   '46j: arm A still answers on its own (org policy on)');
rollback;

-- Agreement with the REAL resolver for every fixture user that has a person,
-- plus the in-transaction treasurer and group-arm cases above re-checked by
-- the same loop.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  update organization_settings set require_two_factor = false;
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', 'c0000000-0000-0000-0000-000000000003', true);
  select set_config('rls_test.link_user', 'e0000000-0000-0000-0000-0000000000f5', true);
\ir test-rls-46-link.sql
  insert into role_grants (organization_id, role_id, group_id, starts_on)
  values (:ALDER, :G_RECORDER_ROLE, :ALDER_SESSION_GROUP, current_date - 1);
  select set_config('app.current_org_id', '', true);
  do $$
  declare
    u uuid;
    r record;
    v_expected boolean;
    v_actual boolean;
    v_checked integer := 0;
  begin
    foreach u in array array['e0000000-0000-0000-0000-0000000000f2','e0000000-0000-0000-0000-0000000000f3',
                             'e0000000-0000-0000-0000-0000000000f4','e0000000-0000-0000-0000-0000000000f5']::uuid[] loop
      v_expected := false;
      for r in select * from presby_user_organizations(u) where ended_on is null loop
        perform set_config('app.current_org_id', r.organization_id::text, true);
        v_expected := v_expected
          or exists (select 1 from presby_effective_permissions(r.person_id, r.organization_id) e
                       join permissions pm on pm.key = e.permission_key and pm.requires_two_factor)
          or coalesce((select s.require_two_factor from organization_settings s
                        where s.organization_id = r.organization_id), false);
      end loop;
      perform set_config('app.current_org_id', '', true);
      v_actual := presby_two_factor_required(u);
      if v_actual is distinct from v_expected then
        raise exception 'FAIL 46j agreement: user % - presby_two_factor_required = %, resolver says %', u, v_actual, v_expected;
      end if;
      v_checked := v_checked + 1;
    end loop;
    raise notice 'pass  46j: presby_two_factor_required agrees with presby_effective_permissions() + the org policy for all % fixture users (%)', v_checked, v_checked;
  end $$;
rollback;

-- ===========================================================================
-- (k) DECISION-175 (1), F139: giving roles never travel the downward paths.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :PRESBY, true);
  do $$
  begin
    insert into administrative_commissions (parent_org_id, target_org_id, scope, role_id, starts_on, group_id)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'full',
            '00000000-0000-0000-0000-000000000005', current_date, 'b0000000-0000-0000-0000-000000000005');
    raise exception 'FAIL - an administrative commission carried the treasurer role';
  exception when insufficient_privilege then
    if sqlerrm not like '%DECISION-175%' then raise; end if;
    raise notice 'pass  46k: a commission whose role carries a giving key is refused (by the guard, not RLS)';
  end $$;
  do $$
  begin
    update administrative_commissions set role_id = '00000000-0000-0000-0000-000000000006'
     where role_id = 'f0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL - an existing commission was re-pointed at a giving role';
  exception when insufficient_privilege then
    if sqlerrm not like '%DECISION-175%' then raise; end if;
    raise notice 'pass  46k: re-pointing an existing commission at a giving role is refused';
  end $$;
  select assert_eq((select count(*) from administrative_commissions where role_id = :SESSION_MEMBER_ROLE), 1,
                   '46k: the seeded session_member commission is unaffected');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into org_delegations (grantor_org_id, grantee_org_id, role_id, starts_on, group_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
            'f0000000-0000-0000-0000-000000000007', current_date, 'b0000000-0000-0000-0000-000000000005');
    raise exception 'FAIL - a delegation carried the treasurer role';
  exception when insufficient_privilege then
    if sqlerrm not like '%DECISION-175%' then raise; end if;
    raise notice 'pass  46k: a delegation whose role carries a giving key is refused';
  end $$;
  do $$
  begin
    insert into app_role_permissions (role_id, permission_key)
    values ('f0000000-0000-0000-0000-000000000001', 'giving.view');
    raise exception 'FAIL - a giving key was bound to a role a commission uses';
  exception when insufficient_privilege then
    if sqlerrm not like '%DECISION-175%' then raise; end if;
    raise notice 'pass  46k: binding a giving key to a role a commission already uses is refused';
  end $$;
  insert into app_role_permissions (role_id, permission_key) values (:SESSION_MEMBER_ROLE, 'events.view')
  on conflict do nothing;
  select assert_eq(1, 1, '46k: a NON-giving key still binds to that role (the guard is giving-only)');
rollback;

-- ===========================================================================
-- (l) The public functions.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from presby_public_giving_config('alder-creek') c
      where c.state = 'live' and c.organization_name = 'Alder Creek Presbyterian Church'
        and c.fund_ids = array[:G_GENERAL::uuid] and c.livemode = false
        and c.min_amount_cents = 100 and c.max_amount_cents = 2500000),
    1, '46l: alder is LIVE - toggle on, test-mode connection active and public, one online fund (General)');
  select assert_eq(
    (select count(*) from presby_public_giving_config('alder-creek') c where c::text like '%acct\_%'),
    0, '46l: the public config never contains an acct_ id');
  select assert_eq(
    (select count(*) from presby_public_giving_config('alder-creek') c
      where c::text like '%22222222-2222-2222-2222-222222222222%'),
    0, '46l: ...nor the organization id');
  select (c)::text as absent_unknown from presby_public_giving_config('no-such-congregation') c \gset
  select assert_eq((select count(*) where :'absent_unknown' like '(absent,%'), 1, '46l: an unknown slug is absent');
  select assert_eq((select count(*) from presby_public_giving_config('quillhaven') c where (c)::text = :'absent_unknown'),
                   1, '46l: a NON-TENANT slug (quillhaven, unmanaged) is byte-identical to the unknown slug');
  select assert_eq((select count(*) from presby_public_giving_config('bramblewood') c where (c)::text = :'absent_unknown'),
                   1, '46l: a congregation with the toggle OFF (no row) is byte-identical too');
  select assert_eq((select count(*) from presby_public_giving_config('northern-reach') c where (c)::text = :'absent_unknown'),
                   1, '46l: a presbytery is byte-identical too');
  select set_config('app.current_org_id', :ALDER, true);
  update organization_feature_toggles set enabled = false where feature_key = 'org_portal.giving';
  select assert_eq((select count(*) from presby_public_giving_config('alder-creek') c where (c)::text = :'absent_unknown'),
                   1, '46l: alder with its toggle turned OFF (no live site) is byte-identical to absent');
rollback;

begin;
  -- create_intent_public refusals.
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_MISSIONS, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'invalid'), 1, '46l: a retired fund is refused');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_BUILDING, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'invalid'), 1, '46l: a fund not offered online is refused');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_BRAMBLE_FUND, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'invalid'), 1, '46l: ANOTHER ORG''S fund is refused (the org comes from the slug)');
  select assert_eq((select count(*) from unnest(array[99, 2500001, 0, -5]) a,
                      presby_giving_create_intent_public('alder-creek', :G_GENERAL, a, false, 'card', 'once', gen_random_uuid()::text) x
                     where x.outcome = 'invalid'), 4, '46l: amounts 99, 2,500,001, 0 and -5 are all refused');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, true, 'either', 'once',
                      gen_random_uuid()::text) where outcome = 'invalid'), 1, '46l: cover_fees with method `either` is refused');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, false, 'card', 'weekly',
                      gen_random_uuid()::text) where outcome = 'invalid'), 1, '46l: an unknown frequency is refused');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, false, 'card', 'once',
                      'not-a-uuid') where outcome = 'invalid'), 1, '46l: a malformed idempotency key is refused');
  select assert_eq((select count(*) from presby_giving_create_intent_public('bramblewood', :G_BRAMBLE_FUND, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'unavailable'), 1, '46l: toggle off -> unavailable');
  select assert_eq((select count(*) from presby_giving_create_intent_public('no-such-congregation', :G_GENERAL, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'unavailable'), 1, '46l: unknown slug -> unavailable');
  -- The SQL gross-up (the TS grid in src/lib/giving/money.ts must agree - Batch 1b).
  select assert_eq(presby_giving_gross_up(5000, 'card', 290, 30, 80, 500), 5181, '46l: gross-up card $50.00 -> 5181');
  select assert_eq(presby_giving_gross_up(10000, 'bank', 290, 30, 80, 500), 10081, '46l: gross-up bank $100.00 -> 10081');
  select assert_eq(presby_giving_gross_up(100000, 'bank', 290, 30, 80, 500), 100500, '46l: gross-up bank $1000.00 hits the $5 cap -> 100500');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 5000, true, 'card', 'once',
                      '46000000-0000-4000-8000-0000000000aa')
                     where outcome = 'created' and total_cents = 5181 and covered_cents = 181 and gift_amount_cents = 5000
                       and external_account_id = 'acct_fixture000000000001' and methods = array['card','bank']),
                   1, '46l: a valid public intent is created with the SQL-computed total');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 5000, true, 'card', 'once',
                      '46000000-0000-4000-8000-0000000000aa') where outcome = 'existing' and not already_attached),
                   1, '46l: the same idempotency key returns the existing intent');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_checkout_intents where idempotency_key = '46000000-0000-4000-8000-0000000000aa'
                      and membership_id is null), 1, '46l: a public intent never carries a membership');
rollback;

begin;
  -- Connection state gates.
  select set_config('app.current_org_id', :ALDER, true);
  update giving_provider_connections set public_enabled_at = null, public_enabled_by = null where status = 'active';
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'unavailable'), 1, '46l: public_enabled_at null -> unavailable');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) where presby_giving_refresh_my_connection(true, true, true, true, true, true, null)
                     = 'applied:status_changed'), 1, '46l: requirements due -> the connection becomes restricted');
  select assert_eq((select count(*) from giving_provider_connections where status = 'restricted'), 1, '46l: ...restricted');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'unavailable'), 1, '46l: restricted -> unavailable');
  select assert_eq((select count(*) where presby_giving_disconnect_my_connection() = 'applied:disconnected'), 1,
                   '46l: the treasurer disconnects (local)');
  select assert_eq((select count(*) from giving_provider_connections where status <> 'disconnected'), 0, '46l: ...disconnected');
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'unavailable'), 1, '46l: disconnected -> unavailable');
  select assert_eq((select count(*) where presby_giving_refresh_my_connection(true, true, true, true, true, false, null) = 'none'), 1,
                   '46l: a disconnected connection is terminal - refresh finds no open connection');
rollback;

begin;
  -- The flood cap: 200 `created` intents in the hour, then the 201st is refused.
  do $$
  declare i integer;
  begin
    for i in 1..200 loop
      perform presby_giving_create_intent_public('alder-creek', 'd9100000-0000-0000-0000-000000000020', 100, false, 'card', 'once',
                                                 gen_random_uuid()::text);
    end loop;
  end $$;
  select assert_eq((select count(*) from presby_giving_create_intent_public('alder-creek', :G_GENERAL, 100, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'rate_limited'), 1, '46l: the 201st created intent in an hour is rate_limited');
rollback;

begin;
  -- return_state: identical for unknown, malformed and other-org session ids.
  select (r)::text as unknown_row from presby_giving_return_state('alder-creek', 'cs_test_doesnotexist0001') r \gset
  select assert_eq((select count(*) where :'unknown_row' like '(unknown,%'), 1, '46l: an unknown session id is unknown');
  select assert_eq((select count(*) from presby_giving_return_state('alder-creek', 'garbage') r where (r)::text = :'unknown_row'),
                   1, '46l: a malformed session id is byte-identical');
  select assert_eq((select count(*) from presby_giving_return_state('alder-creek', 'cs_test_fixturebramble001') r where (r)::text = :'unknown_row'),
                   1, '46l: ANOTHER ORG''S session id is byte-identical');
  select assert_eq((select count(*) from presby_giving_return_state('alder-creek', 'cs_test_fixture0000000002') r
                     where r.state = 'bank_pending' and r.gift_amount_cents = 7500), 1, '46l: alder''s own pending ACH session reads bank_pending');
  -- The in-flight intent against a RETIRED fund is built HERE, inside this
  -- rolled-back block, never read from the seed: a seeded `open` intent lapses
  -- after its 24-hour expires_at and the giving cron's
  -- presby_giving_expire_intents() turns it `expired` (QA run 1 FAIL, seeded
  -- I6). The production order: Missions is offered online, a gift is started
  -- against it, the treasurer retires the fund (the UPDATE retireFund() in
  -- src/lib/giving/funds.ts issues), and a cron sweep runs.
  select set_config('app.current_org_id', :ALDER, true);
  update giving_funds set is_active = true, retired_at = null, offered_online = true where id = :G_MISSIONS;
  select intent_id::text as inflight
    from presby_giving_create_intent_public('alder-creek', :G_MISSIONS, 4000, false, 'card', 'once',
                                            '46000000-0000-4000-8000-0000000000cc')
   where outcome = 'created' \gset
  select assert_eq((select count(*) where presby_giving_attach_session(:'inflight', 'cs_test_rls46inflight001')), 1,
                   '46l: (setup) a gift is started against Missions while it is offered online - the intent is open');
  update giving_funds set is_active = false, retired_at = now(), offered_online = false where id = :G_MISSIONS;
  select presby_giving_expire_intents() as swept \gset
  select assert_eq((select count(*) from giving_checkout_intents i join giving_funds f on f.id = i.fund_id
                     where i.id = :'inflight' and i.status = 'open' and not f.is_active and f.retired_at is not null),
                   1, '46l: ...the fund is then retired and a giving-cron sweep runs - the intent is still open (inside its 24 hours)');
  select assert_eq((select count(*) from presby_giving_return_state('alder-creek', 'cs_test_rls46inflight001') r
                     where r.state = 'confirming' and r.fund_name = 'Missions'), 1,
                   '46l: the in-flight intent against the retired fund still resolves (confirming)');
rollback;

begin;
  -- The member variant: the only path that sets membership_id.
  do $$
  begin
    perform presby_giving_create_intent_member(gen_random_uuid(), 'd9100000-0000-0000-0000-000000000020', 2500, false, 'card',
                                               'once', gen_random_uuid()::text);
    raise exception 'FAIL - the member variant answered with no org context';
  exception when insufficient_privilege then
    raise notice 'pass  46l: create_intent_member refuses with no org context';
  end $$;
  select set_config('app.current_org_id', :ALDER, true);
  select m.id::text as hallie from memberships m where m.person_id = 'c0000000-0000-0000-0000-000000000005' \gset
  select assert_eq((select count(*) from presby_giving_create_intent_member(:'hallie', :G_GENERAL, 2500, false, 'card', 'monthly',
                      '46000000-0000-4000-8000-0000000000bb') where outcome = 'created'), 1, '46l: a member creates a monthly intent');
  select assert_eq((select count(*) from giving_checkout_intents where idempotency_key = '46000000-0000-4000-8000-0000000000bb'
                      and membership_id = :'hallie'), 1, '46l: ...carrying their membership');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from presby_giving_create_intent_member(:'hallie', :G_GENERAL, 2500, false, 'card', 'once',
                      gen_random_uuid()::text) where outcome = 'invalid'), 1, '46l: an alder membership from bramblewood''s context is refused');
rollback;

-- ===========================================================================
-- (m) Catalog: templates, flag retirement, toggles.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from app_roles r
      where r.id = :TREASURER_TEMPLATE and r.organization_id is null and r.organization_type_scope is null
        and r.key = 'treasurer' and r.role_kind = 'constitutional' and r.is_protected),
    1, '46m: the treasurer TEMPLATE exists (constitutional, protected, unscoped)');
  select assert_eq(
    (select count(*) from app_roles r
      where r.id = :RECORDER_TEMPLATE and r.organization_id is null and r.organization_type_scope is null
        and r.key = 'giving_recorder' and r.role_kind = 'custom' and not r.is_protected),
    1, '46m: the giving_recorder TEMPLATE exists (custom, unprotected, unscoped)');
  select assert_eq(
    (select count(*) from (select permission_key from app_role_permissions where role_id = :TREASURER_TEMPLATE
                           except select unnest(array['giving.view','giving.record','giving.manage'])) d)
    + (select abs(count(*) - 3) from app_role_permissions where role_id = :TREASURER_TEMPLATE),
    0, '46m: the treasurer template carries exactly giving.view, giving.record, giving.manage');
  select assert_eq(
    (select count(*) from app_role_permissions where role_id = :RECORDER_TEMPLATE and permission_key = 'giving.record')
    * 10 + (select count(*) from app_role_permissions where role_id = :RECORDER_TEMPLATE),
    11, '46m: the giving_recorder template carries exactly giving.record');
  select assert_eq((select count(*) from feature_flags where key = 'org_portal.giving'), 0,
                   '46m: the org_portal.giving platform flag is retired (R11)');
  select assert_eq((select count(*) from permissions where key = 'ledger.approve'), 1,
                   '46m: the ledger.approve permission row stays (S3 keeps it as "a key nobody holds")');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(distinct rp.role_id) from app_role_permissions rp join permissions pm on pm.key = rp.permission_key
      where pm.module = 'giving'),
    4, '46m: alder''s view - giving keys sit on the two templates and the two fixture roles only');
  select assert_eq((select count(*) from app_role_permissions where role_id = :TREASURER_ROLE and permission_key = 'ledger.approve'),
                   0, '46m: the fixture treasurer no longer carries ledger.approve (S3 / P3-3)');
  select assert_eq((select count(*) from organization_feature_toggles where feature_key = 'org_portal.giving' and enabled),
                   1, '46m: alder''s giving toggle is the fixture''s one ON row');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from organization_feature_toggles where feature_key = 'org_portal.giving'), 0,
                   '46m: bramblewood has no giving toggle row (OFF by default, Q3)');
  select set_config('app.current_org_id', :PRESBY, true);
  select assert_eq(
    (select count(distinct rp.role_id) from app_role_permissions rp join permissions pm on pm.key = rp.permission_key
      where pm.module = 'giving'),
    2, '46m: the presbytery''s view - only the two templates carry giving keys');
rollback;

-- ===========================================================================
-- (n) Livemode: the shared live-gift predicate excludes test-mode gifts.
--     The fragment is `g.livemode` (P3-17); Batch 1b's
--     src/lib/giving/live-predicate.ts exports it and its test pins it to this
--     assertion's text.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from giving_gifts g where g.status = 'succeeded'), 10,
                   '46n: alder has ten succeeded gifts in all');
  select assert_eq((select count(*) from giving_gifts g where g.status = 'succeeded' and g.livemode), 9,
                   '46n: the live predicate excludes the one test-mode gift');
  select assert_eq((select count(*) from giving_gifts g where g.id = 'd9100000-0000-0000-0000-000000000088' and not g.livemode), 1,
                   '46n: ...which is the fixture''s test-mode gift (G9)');
rollback;

-- ===========================================================================
-- (o) Statements, structure (drizzle/0056_presby_giving_statements.sql).
--     FORCE RLS and the tenant policy, composite keys, the blob FK, the
--     version/chain keys, the grant matrix, and every 0056 guard installed.
--     The OWNER-path proofs (frozen rows refuse UPDATE/DELETE on
--     getPlatformDb(), deletable_until permits, the teardown cascade, the blob
--     FK and the blob guard binding the owner, concurrency) are in
--     src/lib/db/domain/giving-statements.db.test.ts - presby_app cannot even
--     attempt them.
-- ===========================================================================
\set G_DONOR_HALLIE '\'d9100000-0000-0000-0000-000000000041\''
\set G_DONOR_MERGED '\'d9100000-0000-0000-0000-000000000044\''
\set G_DONOR_ODETTE '\'d9100000-0000-0000-0000-000000000046\''
\set G_DONOR_BRAMBLE '\'d9100000-0000-0000-0000-000000000050\''
\set G_GIFT_HALLIE_PRIOR '\'d9100000-0000-0000-0000-000000000087\''
\set G_GIFT_TESTMODE '\'d9100000-0000-0000-0000-000000000088\''
\set G_GIFT_BRAMBLE '\'d9100000-0000-0000-0000-00000000008a\''
\set G_GIFT_MERGED_PRIOR '\'d9100000-0000-0000-0000-00000000008b\''
\set G_GIFT_LINDEN_PRIOR '\'d9100000-0000-0000-0000-00000000008c\''
\set U_CLERK '\'e0000000-0000-0000-0000-0000000000f3\''
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('giving_statements', 'giving_statement_lines', 'giving_statement_deliveries')
        and relkind = 'r' and relrowsecurity and relforcerowsecurity),
    3, '46o: the three statement tables have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename in ('giving_statements', 'giving_statement_lines', 'giving_statement_deliveries')
        and policyname = 'tenant_isolation' and cmd = 'ALL' and permissive = 'PERMISSIVE'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    3, '46o: each carries tenant_isolation (ALL, permissive) with BOTH using and with check');
  select assert_eq(
    (select count(*) from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where c.contype = 'f' and c.conname = 'giving_statements_blob_fk'
        and t.relname = 'giving_statements' and c.confrelid = 'blob_assets'::regclass
        and c.confdeltype = 'a' and c.confupdtype = 'a'
        and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = array['blob_asset_id', 'organization_id', 'asset_audience']
        and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = array['id', 'organization_id', 'audience']),
    1, '46o: the PDF is referenced by a three-column COMPOSITE, NO ACTION FK into blob_assets, pinned to audience private (undeletable while referenced, F44; drizzle/0072)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conname = 'giving_statements_version_key' and c.contype = 'u'
        and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
            = array['organization_id', 'donor_id', 'tax_year', 'version']),
    1, '46o: one statement per (organization, donor, tax year, version) - the race-safe already_issued');
  select assert_eq(
    (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relname = 'giving_statements_supersedes_once_idx' and i.indisunique
        and pg_get_expr(i.indpred, i.indrelid) = '(supersedes_id IS NOT NULL)'),
    1, '46o: a statement is superseded at most once - the chain cannot fork (unique partial index)');
  -- The grant matrix: presby_app SELECT + INSERT and nothing else; nobody else anything.
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('giving_statements', 'giving_statement_lines', 'giving_statement_deliveries')
        and a.grantee = 'presby_app'::regrole and a.privilege_type in ('SELECT', 'INSERT')),
    6, '46o: presby_app holds SELECT and INSERT on each statement table');
  select assert_eq(
    (select count(*) from (values ('giving_statements'), ('giving_statement_lines'), ('giving_statement_deliveries')) v(t),
            (values ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
      where has_table_privilege('presby_app', v.t, p.priv) or has_table_privilege('presby_platform', v.t, p.priv)
         or has_any_column_privilege('presby_app', v.t, 'UPDATE')),
    0, '46o: NO UPDATE (table or column), DELETE or TRUNCATE on any statement table, for presby_app or presby_platform');
  select assert_eq(
    (select count(*) from pg_trigger
      where not tgisinternal and tgenabled = 'O'
        and tgname in ('giving_statements_insert_guard', 'giving_statements_freeze', 'giving_statement_lines_freeze',
                       'giving_statement_deliveries_freeze', 'giving_statement_deliveries_insert_guard',
                       'blob_assets_giving_statement_guard')),
    6, '46o: the insert guards, the three freezes and the blob guard are installed and ENABLED');
  select assert_eq(
    (select count(*) from pg_trigger
      where not tgisinternal and tgenabled = 'O' and tgconstraint <> 0 and tgdeferrable and tginitdeferred
        and tgname in ('giving_statements_consistency', 'giving_statement_lines_consistency')),
    2, '46o: both consistency triggers are CONSTRAINT triggers, DEFERRABLE INITIALLY DEFERRED (checked at commit)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_giving__actor_holds', 'presby_giving__check_statement',
                          'presby_giving_guard_statement_insert', 'presby_giving_guard_statement_freeze',
                          'presby_giving_check_statement_consistency', 'presby_giving_guard_statement_delivery',
                          'presby_giving_guard_statement_blob')
        and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
        and p.proacl is not null
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)),
    7, '46o: the seven 0056 functions are SECURITY DEFINER, pin search_path, and are executable by their owner ALONE');
rollback;

-- ===========================================================================
-- (p) Issuing, as presby_app, through the harness (scripts/giving/
--     test-rls-46-issue.sql): the issuer is the fixture treasurer (Priya,
--     giving.view/record/manage) linked to founding.fixture's user for the
--     block. Tenancy and the composite FKs on the new tables.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :PRIYA, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  -- Premise: every fixture gift (and the refund) sits in its FIXED fixture
  -- year, so 46p-46t never depend on today's date or on the day the seed ran.
  select assert_eq(
    (select count(*) from giving_gifts g
      where g.id::text like 'd9100000-%'
        and extract(year from g.occurred_on)::int
            <> case when g.id in ('d9100000-0000-0000-0000-000000000087', 'd9100000-0000-0000-0000-000000000089',
                                  'd9100000-0000-0000-0000-00000000008b', 'd9100000-0000-0000-0000-00000000008c')
                    then :G_YEAR_PRIOR else :G_YEAR_CURRENT end)
    + (select count(*) from giving_gift_reversals r
        where r.id = 'd9100000-0000-0000-0000-000000000090' and extract(year from r.occurred_on)::int <> :G_YEAR_CURRENT)
    + abs((select count(*) from giving_gifts g where g.id::text like 'd9100000-%') - 12),
    0, '46p: (premise) alder''s twelve fixture gifts and the refund sit in the fixed fixture years 2025 / 2026, not relative to today');
  select set_config('rls_test.s_org', :ALDER, true);
  select set_config('rls_test.s_issuer', :U_FOUNDING, true);
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);
  select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
  select set_config('rls_test.s_label', '46p: the treasurer issues Linden Marsh''s statement for last year', true);
\ir test-rls-46-issue.sql
  select current_setting('rls_test.s_statement') as s_prior \gset
  select assert_eq(
    (select count(*) from giving_statements s
      where s.id = :'s_prior' and s.version = 1 and s.supersedes_id is null
        and s.gift_count = 2 and s.non_cash_count = 0 and s.cash_total_cents = 10500
        and s.issued_at = now() and s.donee_legal_name = 'Alder Creek Presbyterian Church'),
    1, '46p: ...version 1, two gifts, $105.00, issued_at STAMPED by the guard (the harness passed 2000-01-01; 0056 S2)');
  select assert_eq(
    (select count(*) from giving_statement_lines
      where statement_id = :'s_prior' and gift_id in (:G_GIFT_MERGED_PRIOR, :G_GIFT_LINDEN_PRIOR)),
    2, '46p: ...counting her own gift AND the gift recorded to the donor later merged into her (the donor-root group)');

  select set_config('rls_test.s_year', :'G_YEAR_CURRENT', true);
  select set_config('rls_test.s_label', '46p: ...and this year''s, with a stock gift, a covered fee and a test-mode gift', true);
\ir test-rls-46-issue.sql
  select current_setting('rls_test.s_statement') as s_current \gset
  select assert_eq(
    (select count(*) from giving_statements s
      where s.id = :'s_current' and s.gift_count = 2 and s.non_cash_count = 1 and s.cash_total_cents = 5181),
    1, '46p: ...this year: two lines, one NON-CASH (stock), cash $51.81 (the covered fee counted, G10 policy)');
  select assert_eq(
    (select count(*) from giving_statement_lines l
      where l.statement_id = :'s_current'
        and ((l.kind = 'non_cash' and l.amount_cents is null and l.gift_id = 'd9100000-0000-0000-0000-000000000082')
          or (l.kind = 'cash' and l.amount_cents = 5181 and l.covered_fee_cents = 181 and l.gift_id = :G_GIFT_ONLINE))),
    2, '46p: ...the stock line carries no amount; the online line carries its covered fee');
  select assert_eq((select count(*) from giving_statement_lines where gift_id = :G_GIFT_TESTMODE), 0,
                   '46p: ...and the test-mode gift (G9) is on no statement (P3-17)');

  -- Tenancy: bramblewood sees none of it, and cannot write into alder's.
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from giving_statements) + (select count(*) from giving_statement_lines)
                   + (select count(*) from giving_statement_deliveries), 0,
                   '46p: bramblewood sees no statement, line or delivery of alder''s');
  select assert_eq((select count(*) from giving_statements where id = :'s_prior'), 0,
                   '46p: ...not even by known id');
  select set_config('rls_test.s_prior', :'s_prior', true);
  do $$
  begin
    insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
           description, kind, amount_cents, gross_cents)
    values ('22222222-2222-2222-2222-222222222222', current_setting('rls_test.s_prior')::uuid,
            'd9100000-0000-0000-0000-000000000087', 3, current_date - 400, 'General Fund', 'Hijack', 'cash', 100, 100);
    raise exception 'FAIL - bramblewood wrote a line into alder''s statement';
  exception when insufficient_privilege then
    raise notice 'pass  46p: tenant_isolation WITH CHECK refuses a cross-org line insert';
  end $$;
  do $$
  begin
    insert into giving_statements (organization_id, donor_id, tax_year, donee_legal_name, donee_address_line1,
           donee_city, donee_region, donee_postal_code, greeting_text, closing_text, wording_version, donor_name,
           period_start, period_end, cash_total_cents, gift_count, covered_fee_counted, blob_asset_id, pdf_sha256,
           issued_by)
    values ('22222222-2222-2222-2222-222222222222', 'd9100000-0000-0000-0000-000000000040', 2024, 'X', 'X', 'X',
            'OH', '00000', 'X', 'X', 1, 'X', '2024-01-01', '2024-12-31', 1, 1, true, gen_random_uuid(),
            repeat('0', 64), 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - bramblewood wrote a statement for alder';
  exception when insufficient_privilege then
    raise notice 'pass  46p: a statement naming another org is refused from this org''s context';
  end $$;
  -- The composite FK, not RLS, is what refuses a same-org line naming ANOTHER org's gift.
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
           description, kind, amount_cents, gross_cents)
    values ('22222222-2222-2222-2222-222222222222', current_setting('rls_test.s_prior')::uuid,
            'd9100000-0000-0000-0000-00000000008a', 3, current_date - 400, 'General Fund', 'Cross org', 'cash', 3300, 3300);
    raise exception 'FAIL - an alder statement line named bramblewood''s gift';
  exception when foreign_key_violation then
    raise notice 'pass  46p: giving_statement_lines_gift_fk is composite - another org''s gift is refused (F2)';
  end $$;
  do $$
  begin
    insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
    values ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), 'print_mailed', 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - a delivery named a statement that is not this org''s';
  exception when foreign_key_violation then
    raise notice 'pass  46p: giving_statement_deliveries_statement_fk refuses a statement this org does not hold';
  end $$;
rollback;

-- ===========================================================================
-- (q) The insert guard (0056 section 6a; deviation S1 the issuer, S3 the bytes).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :PRIYA, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  select set_config('rls_test.s_org', :ALDER, true);
  select set_config('rls_test.s_issuer', :U_FOUNDING, true);
  select set_config('rls_test.s_year', :'G_YEAR_CURRENT', true);

  select set_config('rls_test.s_donor', :G_DONOR_PLATE, true);
  select set_config('rls_test.s_expect', 'giving_statement: donor_unidentified', true);
  select set_config('rls_test.s_label', '46q: plate cash (the unidentified donor) never receives a statement', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_donor', :G_DONOR_MERGED, true);
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);
  select set_config('rls_test.s_expect', 'giving_statement: donor_unavailable', true);
  select set_config('rls_test.s_label', '46q: a MERGED donor receives none - the statement goes to the root', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
  select set_config('rls_test.s_blob', 'badhash', true);
  select set_config('rls_test.s_expect', 'giving_statement: blob_invalid', true);
  select set_config('rls_test.s_label', '46q: pdf_sha256 must equal the stored blob''s content hash (S3)', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_blob', 'json', true);
  select set_config('rls_test.s_expect', 'giving_statement: blob_invalid', true);
  select set_config('rls_test.s_label', '46q: ...and the blob must be application/pdf (S3)', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_donor', :G_DONOR_HALLIE, true);
  select set_config('rls_test.s_year', :'G_YEAR_CURRENT', true);
  select set_config('rls_test.s_expect', 'giving_statements_totals_shape', true);
  select set_config('rls_test.s_label', '46q: a year with nothing to count (her one gift fully refunded) cannot be issued', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
  select set_config('rls_test.s_issuer', :U_CLERK, true);
  select set_config('rls_test.s_expect', 'giving_statement: not permitted', true);
  select set_config('rls_test.s_label', '46q: an active member without the giving keys (clerk.fixture) may not issue (S1)', true);
\ir test-rls-46-issue.sql
  select assert_eq((select count(*) from giving_statements), 0,
                   '46q: ...and none of the refused attempts left a statement behind');
rollback;

begin;
  -- giving.record alone is not enough: issuing needs giving.manage AND giving.view.
  select set_config('app.current_org_id', :ALDER, true);
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :DESMOND, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  select set_config('rls_test.s_org', :ALDER, true);
  select set_config('rls_test.s_issuer', :U_FOUNDING, true);
  select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);
  select set_config('rls_test.s_expect', 'giving_statement: not permitted', true);
  select set_config('rls_test.s_label', '46q: the giving recorder (giving.record only) may not issue (S1)', true);
\ir test-rls-46-issue.sql
rollback;

-- ===========================================================================
-- (r) The deferred consistency check (0056 section 6c; deviation S4): the
--     header equals its lines, the lines equal the gift rows, and none is
--     missing. Each refusal surfaces at SET CONSTRAINTS ... IMMEDIATE (at
--     COMMIT in the application).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :PRIYA, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  select set_config('rls_test.s_org', :ALDER, true);
  select set_config('rls_test.s_issuer', :U_FOUNDING, true);
  select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);

  select set_config('rls_test.s_total_delta', '1', true);
  select set_config('rls_test.s_expect', 'inconsistent: totals_mismatch', true);
  select set_config('rls_test.s_label', '46r: a TAMPERED total (one cent more than the lines) is refused', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_no_lines', 'true', true);
  select set_config('rls_test.s_expect', 'inconsistent: totals_mismatch', true);
  select set_config('rls_test.s_label', '46r: a header with no lines is refused (the header''s own deferred trigger)', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_skip_last', 'true', true);
  select set_config('rls_test.s_expect', 'inconsistent: incomplete', true);
  select set_config('rls_test.s_label', '46r: a statement that OMITS a counting gift is refused, even with self-consistent totals', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_gross_delta', '1', true);
  select set_config('rls_test.s_expect', 'inconsistent: line_mismatch', true);
  select set_config('rls_test.s_label', '46r: a line whose gross differs from its gift row is refused', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_extra_gift', :G_GIFT_HALLIE_PRIOR, true);
  select set_config('rls_test.s_expect', 'inconsistent: line_mismatch', true);
  select set_config('rls_test.s_label', '46r: another donor''s gift on the statement is refused (not in the donor-root group)', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_year', :'G_YEAR_CURRENT', true);
  select set_config('rls_test.s_extra_gift', :G_GIFT_TESTMODE, true);
  select set_config('rls_test.s_expect', 'inconsistent: line_mismatch', true);
  select set_config('rls_test.s_label', '46r: a Stripe TEST-MODE gift on the statement is refused (P3-17)', true);
\ir test-rls-46-issue.sql
  select assert_eq((select count(*) from giving_statements), 0,
                   '46r: ...and every refused statement was rolled back with its lines');

  -- A good statement, then a line added AFTER it was checked: re-checked and refused.
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);
  select set_config('rls_test.s_label', '46r: (setup) a consistent statement is issued', true);
\ir test-rls-46-issue.sql
  do $$
  declare
    v_constraint text;
  begin
    insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
           description, kind, amount_cents, gross_cents)
    select '22222222-2222-2222-2222-222222222222', current_setting('rls_test.s_statement')::uuid, g.id, 3,
           g.occurred_on, 'General Fund', 'Late addition', 'cash', g.amount_cents, g.amount_cents
      from giving_gifts g where g.id = 'd9100000-0000-0000-0000-000000000087';
    raise exception 'FAIL - a line was added to an already-checked statement';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'giving_statements_consistency' then raise; end if;
    raise notice 'pass  46r: a line added to an issued statement is re-checked and refused (%)', v_constraint;
  end $$;
rollback;

-- ===========================================================================
-- (s) The version chain: v2 supersedes v1 and v1 is retained; the chain
--     cannot fork, skip, or cross donors or years.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :PRIYA, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  select set_config('rls_test.s_org', :ALDER, true);
  select set_config('rls_test.s_issuer', :U_FOUNDING, true);
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);
  select set_config('rls_test.s_donor', :G_DONOR_HALLIE, true);
  select set_config('rls_test.s_label', '46s: (setup) Hallie''s v1 for last year', true);
\ir test-rls-46-issue.sql
  select current_setting('rls_test.s_statement') as s_hallie \gset
  select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
  select set_config('rls_test.s_label', '46s: (setup) Linden''s v1 for last year', true);
\ir test-rls-46-issue.sql
  select current_setting('rls_test.s_statement') as s_v1 \gset

  select set_config('rls_test.s_version', '1', true);
  select set_config('rls_test.s_expect', 'giving_statements_version_key', true);
  select set_config('rls_test.s_label', '46s: a second version 1 for the same donor and year is refused (the app''s already_issued)', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_version', '2', true);
  select set_config('rls_test.s_expect', 'giving_statements_version_chain', true);
  select set_config('rls_test.s_label', '46s: version 2 must name what it supersedes', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_version', '2', true);
  select set_config('rls_test.s_supersedes', :'s_hallie', true);
  select set_config('rls_test.s_expect', 'giving_statement: supersedes_invalid', true);
  select set_config('rls_test.s_label', '46s: a correction cannot supersede ANOTHER donor''s statement', true);
\ir test-rls-46-issue.sql
  select set_config('rls_test.s_version', '3', true);
  select set_config('rls_test.s_supersedes', :'s_v1', true);
  select set_config('rls_test.s_expect', 'giving_statement: supersedes_invalid', true);
  select set_config('rls_test.s_label', '46s: a correction cannot skip a version (v3 superseding v1)', true);
\ir test-rls-46-issue.sql

  select set_config('rls_test.s_version', '2', true);
  select set_config('rls_test.s_supersedes', :'s_v1', true);
  select set_config('rls_test.s_label', '46s: version 2 supersedes version 1', true);
\ir test-rls-46-issue.sql
  select current_setting('rls_test.s_statement') as s_v2 \gset
  select assert_eq(
    (select count(*) from giving_statements s
      where s.donor_id = :G_DONOR_LINDEN and s.tax_year = :G_YEAR_PRIOR
        and not exists (select 1 from giving_statements n where n.supersedes_id = s.id)),
    1, '46s: ...exactly one LATEST version remains');
  select assert_eq((select count(*) from giving_statements where id in (:'s_v1', :'s_v2')), 2,
                   '46s: ...and the original is retained, never replaced');

  select set_config('rls_test.s_version', '2', true);
  select set_config('rls_test.s_supersedes', :'s_v1', true);
  select set_config('rls_test.s_expect', 'giving_statement: already_superseded', true);
  select set_config('rls_test.s_label', '46s: a second version 2 superseding version 1 is refused - the chain cannot fork', true);
\ir test-rls-46-issue.sql
rollback;

-- ===========================================================================
-- (t) Frozen and insert-only, as presby_app; the delivery log.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  -- drizzle/0065 (F186): presby_app no longer writes people.user_id; link through connect.
  select set_config('rls_test.link_person', :PRIYA, true);
  select set_config('rls_test.link_user', :U_FOUNDING, true);
\ir test-rls-46-link.sql
  select set_config('rls_test.s_org', :ALDER, true);
  select set_config('rls_test.s_issuer', :U_FOUNDING, true);
  select set_config('rls_test.s_year', :'G_YEAR_PRIOR', true);
  select set_config('rls_test.s_donor', :G_DONOR_ODETTE, true);
  select set_config('rls_test.s_label', '46t: (setup) Odette Brask''s statement for last year (no address: a print exception)', true);
\ir test-rls-46-issue.sql
  do $$
  begin
    update giving_statements set cash_total_cents = cash_total_cents + 1;
    raise exception 'FAIL - presby_app updated a statement';
  exception when insufficient_privilege then
    raise notice 'pass  46t: presby_app UPDATE on giving_statements refused';
  end $$;
  do $$
  begin
    update giving_statement_lines set amount_cents = amount_cents;
    raise exception 'FAIL - presby_app updated a statement line';
  exception when insufficient_privilege then
    raise notice 'pass  46t: presby_app UPDATE on giving_statement_lines refused';
  end $$;
  do $$
  begin
    delete from giving_statements;
    raise exception 'FAIL - presby_app deleted a statement';
  exception when insufficient_privilege then
    raise notice 'pass  46t: presby_app DELETE on giving_statements refused';
  end $$;
  do $$
  begin
    delete from blob_assets b where b.id = (select s.blob_asset_id from giving_statements s
                                            where s.id = current_setting('rls_test.s_statement')::uuid);
    raise exception 'FAIL - presby_app deleted a statement''s PDF';
  exception when insufficient_privilege then
    raise notice 'pass  46t: presby_app DELETE on blob_assets refused (the FK binds the owner: giving-statements.db.test.ts)';
  end $$;

  insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by, occurred_at)
  values (:ALDER, current_setting('rls_test.s_statement')::uuid, 'print_mailed', :U_FOUNDING, '2000-01-01');
  select assert_eq((select count(*) from giving_statement_deliveries
                     where statement_id = current_setting('rls_test.s_statement')::uuid
                       and channel = 'print_mailed' and occurred_at = now()),
                   1, '46t: the treasurer records the print run (occurred_at stamped by the guard, S2)');
  do $$
  begin
    insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
    values ('22222222-2222-2222-2222-222222222222', current_setting('rls_test.s_statement')::uuid,
            'email_notice', 'e0000000-0000-0000-0000-0000000000f5');
    raise exception 'FAIL - an email notice without its queue row';
  exception when check_violation then
    raise notice 'pass  46t: an email_notice delivery must carry its email_queue_id (S7)';
  end $$;
  do $$
  begin
    insert into giving_statement_deliveries (organization_id, statement_id, channel, recorded_by)
    values ('22222222-2222-2222-2222-222222222222', current_setting('rls_test.s_statement')::uuid,
            'print_mailed', 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL - a member without giving.manage recorded a delivery';
  exception when insufficient_privilege then
    raise notice 'pass  46t: a member without giving.manage (clerk.fixture) may not record a delivery (S1)';
  end $$;
  do $$
  begin
    update giving_statement_deliveries set channel = 'print_mailed';
    raise exception 'FAIL - presby_app updated a delivery';
  exception when insufficient_privilege then
    raise notice 'pass  46t: presby_app UPDATE on giving_statement_deliveries refused (insert-only)';
  end $$;
rollback;

\echo ''
\echo '======================================================'
\echo ' Section 46 (online giving) complete.'
\echo '======================================================'
