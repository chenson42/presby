-- ---------------------------------------------------------------------------
-- 47. Custom domains (drizzle/0057_presby_org_domains.sql; DECISION-176/178/
--     180, F150/F152; docs/work-log/2026-10-19-custom-domains.md Phase 3
--     "Data Model" item 5).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner:
--
--         \ir domains/test-rls-47.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/domains/test-rls-47.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs only the stock
--     scripts/seed-dev.sql fixture (Alder Creek, Bramblewood, the elder
--     fixture user); it does NOT need scripts/domains/seed-dev-domains.sql,
--     and every block ends in rollback, so it writes nothing durable.
--
--     Sections (a)-(o), the Phase 3 list. What presby_app CANNOT reach is
--     proven on the owner connection in Vitest instead
--     (src/lib/db/domain/domains.db.test.ts):
--       - the guards firing on the OWNER path (illegal edges, immutables,
--         trigger-owned columns, terminal freeze, the delete guard, the cap
--         including a concurrent claim);
--       - every positive path that needs a past clock or a closed org
--         (pending -> expired, lapsed -> release_pending by grace with
--         lapsed_grace, parked -> release_pending carrying its cause,
--         org_closed) and the force-release causes (force_release_reason is
--         owner-only);
--       - lapsed -> parked KEEPING the running grace deadline (inside one
--         transaction now() is constant, so this suite cannot tell "kept"
--         from "re-stamped");
--       - (e)/(f)'s POSITIVE control and its one-condition-at-a-time flips.
--         presby_app holds NO grant on organization_sites (DECISION-081,
--         section 16's own NOTE), and the only seeded site, Alder Creek's, is
--         `provisioning`, so every zero-row result in (e)/(f) below is also
--         explained by the site alone. They still prove what only presby_app
--         can: the anonymous path calls both functions and is handed no row
--         in any state. The differential (one serving row, then each single
--         condition flipped to zero) is domains.db.test.ts "serving matrix",
--         read back through the presby_app connection.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set BRAMBLE   '\'33333333-3333-3333-3333-333333333333\''
\set ELDERUSER '\'e0000000-0000-0000-0000-0000000000f2\''

\echo '======================================================'
\echo ' Section 47 (custom domains, drizzle/0057) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '47: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: FORCE RLS, the one policy, the composite key, the FKs, the
--     three guards.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'organization_domains' and relkind = 'r'
        and relrowsecurity and relforcerowsecurity),
    1, '47a: organization_domains has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'organization_domains' and policyname = 'tenant_isolation'
        and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    1, '47a: tenant_isolation carries BOTH using and with check on presby_current_org()');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'organization_domains'),
    1, '47a: and no other policy');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'organization_domains'::regclass and c.contype = 'u'
        and c.conname = 'organization_domains_id_org_key'
        and (select array_agg(a.attname::text order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
            = array['id', 'organization_id']),
    1, '47a: unique (id, organization_id) - Composite Tenant Keys (F2), the target of 0058''s mail FK');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'organization_domains'::regclass and c.contype = 'f'
        and c.confrelid = 'organizations'::regclass and c.confdeltype = 'c'),
    1, '47a: organization_id cascades from organizations (reachable only via the guarded fixture teardown)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'organization_domains'::regclass and c.contype = 'f'
        and c.confrelid = 'users'::regclass and c.confdeltype = 'a'),
    1, '47a: created_by_user_id -> users is NO ACTION (no set null without a recovery path)');
  select assert_eq(
    (select count(*) from pg_constraint c where c.conrelid = 'organization_domains'::regclass and c.contype = 'f'),
    2, '47a: and exactly those two foreign keys');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'organization_domains'::regclass and not t.tgisinternal and t.tgenabled = 'O'
        and (t.tgname, p.proname) in (('organization_domains_guard_insert', 'presby_org_domains_guard_insert'),
                                      ('organization_domains_guard_update', 'presby_org_domains_guard_update'),
                                      ('organization_domains_guard_delete', 'presby_org_domains_guard_delete'))
        -- tgtype bit 1 = row, bit 2 = before
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2),
    3, '47a: the three BEFORE ROW guards exist and are ENABLED (origin) - they bind the owner too (F44)');
  select assert_eq(
    (select count(*) from pg_trigger where tgrelid = 'organization_domains'::regclass and not tgisinternal),
    3, '47a: and no other trigger');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not p.prosecdef
        and p.proname in ('presby_org_domains_guard_insert', 'presby_org_domains_guard_update', 'presby_org_domains_guard_delete')
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[]))),
    3, '47a: the guards are SECURITY INVOKER with search_path pinned (they lend no owner privilege)');
rollback;

-- ===========================================================================
-- (b) Tenancy: reads.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'alder-creek.invalid', 'alder-creek.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as alder_dom \gset
  select assert_eq((select count(*) from organization_domains), 1, '47b: alder sees its own claim');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from organization_domains), 0, '47b: bramblewood sees no alder claim');
  select assert_eq((select count(*) from organization_domains where id = :'alder_dom'), 0,
                   '47b: bramblewood cross-org read of an alder claim by known id returns zero');
  select set_config('rls_test.alder_dom', :'alder_dom', true);
  do $$
  declare n integer;
  begin
    update organization_domains set observation = '{"hijacked": true}'::jsonb
     where id = current_setting('rls_test.alder_dom')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL - bramblewood updated an alder claim (% rows)', n; end if;
    raise notice 'pass  47b: a bramblewood UPDATE of an alder claim by known id touches zero rows';
  end $$;
  select set_config('app.current_org_id', '', true);
  select assert_eq((select count(*) from organization_domains), 0, '47b: with no org GUC (the anonymous path) every claim is invisible');
rollback;

-- ===========================================================================
-- (c) Tenancy: writes.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'web', 'hijack.invalid', 'hijack.invalid', 'canonical', repeat('a', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - bramblewood wrote a claim into alder';
  exception when insufficient_privilege then
    raise notice 'pass  47c: tenant_isolation WITH CHECK refuses a cross-org claim insert';
  end $$;
  select set_config('app.current_org_id', '', true);
  do $$
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'web', 'hijack.invalid', 'hijack.invalid', 'canonical', repeat('a', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - an insert with no org GUC was accepted';
  exception when insufficient_privilege then
    raise notice 'pass  47c: with no org GUC no claim can be inserted at all';
  end $$;
rollback;

-- ===========================================================================
-- (d) The cross-org holding index: first to VERIFY wins (DECISION-180, G3,
--     A12). Pending claims never conflict.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'contested.invalid', 'contested.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as alder_hold \gset
  update organization_domains set state = 'verified' where id = :'alder_hold';
  select set_config('app.current_org_id', :BRAMBLE, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:BRAMBLE, 'web', 'contested.invalid', 'contested.invalid', 'canonical', repeat('b', 32), 'tenant', :ELDERUSER)
  returning id as bramble_claim \gset
  select assert_eq((select count(*) from organization_domains where hostname = 'contested.invalid' and state = 'pending'),
                   1, '47d: bramblewood records a pending claim on a name alder already holds - a pending claim never conflicts and reveals nothing');
  select set_config('rls_test.bramble_claim', :'bramble_claim', true);
  do $$
  declare v_con text;
  begin
    update organization_domains set state = 'verified' where id = current_setting('rls_test.bramble_claim')::uuid;
    raise exception 'FAIL - two organizations both hold contested.invalid';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'organization_domains_hostname_holding_uq' then
      raise exception 'FAIL - the wrong index refused the second verify: %', v_con;
    end if;
    raise notice 'pass  47d: the loser''s pending -> verified raises 23505 on organization_domains_hostname_holding_uq, though RLS hides the holder';
  end $$;
  -- A mail claim on the same name is a different purpose (the T3 residual).
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:BRAMBLE, 'mail', 'contested.invalid', 'contested.invalid', null, repeat('b', 32), 'tenant', :ELDERUSER)
  returning id as bramble_mail \gset
  update organization_domains set state = 'verified' where id = :'bramble_mail';
  select assert_eq((select count(*) from organization_domains where id = :'bramble_mail' and state = 'verified'),
                   1, '47d: holding uniqueness is per purpose - bramblewood may hold contested.invalid for MAIL while alder holds it for web (T3 residual, accepted)');
  -- The holder releases; the name is free to verify.
  select set_config('app.current_org_id', :ALDER, true);
  update organization_domains set state = 'released', release_cause = 'removed' where id = :'alder_hold';
  select set_config('app.current_org_id', :BRAMBLE, true);
  update organization_domains set state = 'verified' where id = :'bramble_claim';
  select assert_eq((select count(*) from organization_domains where id = :'bramble_claim' and state = 'verified'),
                   1, '47d: once the holder is released, the waiting claim verifies');
rollback;

-- ===========================================================================
-- (e) + (f) The anonymous host and slug reads hand presby_app no row in any
--     non-serving state. See the header: the positive control and the
--     single-condition flips are domains.db.test.ts "serving matrix".
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from (select presby_current_org_site_status() as s) x where s = 'provisioning'),
                   1, '47e: PRECONDITION stated, not hidden - alder''s only site is provisioning, so every zero below is also the site''s');
  -- Upsert, not a bare insert: scripts/domains/seed-dev-domains.sql seeds this
  -- exact (organization_id, feature_key) row, and the section must run with or
  -- without it (section 18's ON CONFLICT discipline).
  insert into organization_feature_toggles (organization_id, feature_key, enabled) values (:ALDER, 'org_portal.domains', true)
  on conflict (organization_id, feature_key) do update set enabled = excluded.enabled;
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'alder-creek.invalid', 'alder-creek.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as canon \gset
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'www.alder-creek.invalid', 'alder-creek.invalid', 'alias', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as alias \gset
  select set_config('rls_test.canon', :'canon', true);
  select set_config('rls_test.alias', :'alias', true);
  -- Walk the canonical through every web state and the alias to live; after
  -- each step, the anonymous path (no GUC) sees nothing by host or by slug.
  do $$
  declare
    v_state text;
    v_n bigint;
  begin
    foreach v_state in array array['pending', 'verified', 'attach_pending', 'attached', 'live', 'lapsed', 'verified',
                                   'attach_pending', 'attached', 'live', 'parked'] loop
      perform set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
      if v_state <> 'pending' then
        update organization_domains
           set state = v_state,
               release_cause = case when v_state = 'parked' then 'removed' else release_cause end
         where id = current_setting('rls_test.canon')::uuid;
      end if;
      if v_state = 'live' then
        update organization_domains set state = 'verified' where id = current_setting('rls_test.alias')::uuid and state = 'pending';
        update organization_domains set state = 'attach_pending' where id = current_setting('rls_test.alias')::uuid and state = 'verified';
        update organization_domains set state = 'attached' where id = current_setting('rls_test.alias')::uuid and state = 'attach_pending';
        update organization_domains set state = 'live' where id = current_setting('rls_test.alias')::uuid and state = 'attached';
      end if;
      perform set_config('app.current_org_id', '', true);
      select count(*) into v_n from presby_published_site_by_host('alder-creek.invalid');
      if v_n <> 0 then raise exception 'FAIL 47e: by_host(canonical) returned % rows with the canonical %', v_n, v_state; end if;
      select count(*) into v_n from presby_published_site_by_host('www.alder-creek.invalid');
      if v_n <> 0 then raise exception 'FAIL 47f: by_host(alias) returned % rows with the canonical %', v_n, v_state; end if;
      select count(*) into v_n from presby_published_site('alder-creek');
      if v_n <> 0 then raise exception 'FAIL 47e: published_site(slug) returned % rows with the canonical %', v_n, v_state; end if;
      raise notice 'pass  47e: canonical %: the anonymous path gets zero rows by host (canonical and alias) and by slug', v_state;
    end loop;
  end $$;
  select set_config('app.current_org_id', '', true);
  select assert_eq((select count(*) from presby_published_site_by_host('never-claimed.invalid')), 0,
                   '47e: an unknown host is the same zero-row result');
  select assert_eq((select count(*) from presby_published_site_by_host('ALDER-CREEK.INVALID')), 0,
                   '47e: a non-normalized host simply misses (stored hosts are lowercase punycode by CHECK)');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from presby_published_site_by_host('alder-creek.invalid')), 0,
                   '47e: a tenant connection with its own GUC set is handed nothing more than the anonymous path');
rollback;

-- ===========================================================================
-- (g) Function ACLs and pins (R10, F152).
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.proname in ('presby_org_serving_canonical_host', 'presby_published_site',
                          'presby_published_site_by_host', 'presby_current_org_site_status')
        and p.proacl is not null
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[]))),
    4, '47g: all four are SECURITY DEFINER, pin search_path = public, pg_temp, and carry an EXPLICIT acl (a NULL acl means PUBLIC execute)');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
      where n.nspname = 'public'
        and p.proname in ('presby_org_serving_canonical_host', 'presby_published_site',
                          'presby_published_site_by_host', 'presby_current_org_site_status')
        and a.grantee = 0),
    0, '47g: no PUBLIC entry in any of the four acls');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('presby_published_site', 'presby_published_site_by_host', 'presby_current_org_site_status')
        and (select array_agg(distinct a.grantee::regrole::text order by a.grantee::regrole::text) from aclexplode(p.proacl) a)
            = (select array_agg(r order by r) from unnest(array[pg_get_userbyid(p.proowner)::text, 'presby_app']) r)),
    3, '47g: published_site, by_host and current_org_site_status are executable by exactly the owner and presby_app (F152: the re-create re-applied it)');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'presby_org_serving_canonical_host'
        and (select array_agg(distinct a.grantee::regrole::text) from aclexplode(p.proacl) a)
            = array[pg_get_userbyid(p.proowner)::text]),
    1, '47g: the serving predicate is executable by its owner ALONE');
  select assert_eq(
    (select (case when has_function_privilege('presby_app', 'presby_org_serving_canonical_host(uuid)', 'execute') then 1 else 0 end)
          + (case when has_function_privilege('presby_platform', 'presby_org_serving_canonical_host(uuid)', 'execute') then 1 else 0 end))::bigint,
    0, '47g: neither presby_app nor presby_platform may execute presby_org_serving_canonical_host (R10)');
  select assert_eq(
    (select (case when has_function_privilege('presby_app', 'presby_published_site(text)', 'execute') then 1 else 0 end)
          + (case when has_function_privilege('presby_app', 'presby_published_site_by_host(text)', 'execute') then 1 else 0 end)
          + (case when has_function_privilege('presby_app', 'presby_current_org_site_status()', 'execute') then 1 else 0 end))::bigint,
    3, '47g: presby_app may execute the three public-facing functions');
  do $$
  begin
    perform presby_org_serving_canonical_host('22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL - presby_app called the owner-only serving predicate';
  exception when insufficient_privilege then
    raise notice 'pass  47g: calling presby_org_serving_canonical_host as presby_app is permission denied';
  end $$;
rollback;

-- ===========================================================================
-- (h) Column grants (T4 as amended by A1 + suggestion 1). 33 columns.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'organization_domains'),
    33, '47h: organization_domains has 33 columns (so the three counts below are exhaustive)');
  select assert_eq(
    (select count(*) from unnest(array[
        'id', 'organization_id', 'purpose', 'hostname', 'claim_name', 'proof_token', 'expires_at',
        'created_at', 'created_by_user_id', 'created_via',
        'platform_hold', 'hold_reason', 'force_release_reason',
        'grace_ends_at', 'state_changed_at', 'proof_verified_at', 'attached_at', 'live_at', 'released_at']) c
      where has_column_privilege('presby_app', 'organization_domains', c, 'UPDATE')),
    0, '47h: presby_app may UPDATE none of the 10 immutable, 3 owner-only (T2) or 6 trigger-owned columns, grace_ends_at included (A1)');
  select assert_eq(
    (select count(*) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'organization_domains'
        and has_column_privilege('presby_app', 'organization_domains', c.column_name, 'UPDATE')
        and c.column_name in ('web_role', 'state', 'proof_last_ok_at', 'proof_miss_count', 'probe_miss_count', 'release_cause',
                              'next_check_at', 'last_checked_at', 'last_check_class', 'observation', 'provider_challenge',
                              'ns_fingerprint', 'notify_state', 'updated_at')),
    14, '47h: presby_app may UPDATE exactly the 14 state and observation columns');
  select assert_eq(
    (select count(*) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'organization_domains'
        and has_column_privilege('presby_app', 'organization_domains', c.column_name, 'UPDATE')),
    14, '47h: and no other column');
  select assert_eq(
    (select count(*) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'organization_domains'
        and has_column_privilege('presby_app', 'organization_domains', c.column_name, 'INSERT')),
    8, '47h: presby_app may INSERT exactly 8 columns ...');
  select assert_eq(
    (select count(*) from unnest(array['organization_id', 'purpose', 'hostname', 'claim_name', 'web_role', 'proof_token',
                                       'created_via', 'created_by_user_id']) c
      where has_column_privilege('presby_app', 'organization_domains', c, 'INSERT')),
    8, '47h: ... the tenant-intent ones (state, holds, timestamps and expires_at are never inserted by the tenant)');
  select assert_eq(
    (select (case when has_table_privilege('presby_app', 'organization_domains', 'SELECT') then 1 else 0 end))::bigint,
    1, '47h: presby_app may SELECT (RLS scopes it)');
  select assert_eq(
    (select (case when has_table_privilege('presby_app', 'organization_domains', 'DELETE') then 1 else 0 end)
          + (case when has_table_privilege('presby_app', 'organization_domains', 'TRUNCATE') then 1 else 0 end)
          + (case when has_table_privilege('presby_platform', 'organization_domains', 'DELETE') then 1 else 0 end)
          + (case when has_table_privilege('presby_platform', 'organization_domains', 'TRUNCATE') then 1 else 0 end))::bigint,
    0, '47h: no DELETE or TRUNCATE for presby_app or presby_platform (Never Hard-Delete)');
rollback;

-- ===========================================================================
-- (h2) Ungranted columns are refused; the trigger still stamps them under
--      presby_app (A1, suggestion 1).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'stamp.invalid', 'stamp.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as stamp \gset
  select set_config('rls_test.stamp', :'stamp', true);
  do $$
  declare
    v_col text;
    v_refused integer := 0;
  begin
    foreach v_col in array array[
        'id', 'organization_id', 'purpose', 'hostname', 'claim_name', 'proof_token', 'expires_at',
        'created_at', 'created_by_user_id', 'created_via',
        'platform_hold', 'hold_reason', 'force_release_reason',
        'grace_ends_at', 'state_changed_at', 'proof_verified_at', 'attached_at', 'live_at', 'released_at'] loop
      begin
        execute format('update organization_domains set %I = %I where id = $1', v_col, v_col)
          using current_setting('rls_test.stamp')::uuid;
        raise exception 'FAIL - presby_app wrote organization_domains.%', v_col;
      exception when insufficient_privilege then
        v_refused := v_refused + 1;
      end;
    end loop;
    if v_refused <> 19 then raise exception 'FAIL 47h2: % of 19 refused', v_refused; end if;
    raise notice 'pass  47h2: all 19 ungranted columns are refused to presby_app at the grant (permission denied), grace_ends_at included';
  end $$;
  do $$
  begin
    update organization_domains set grace_ends_at = now() - interval '1 day' where id = current_setting('rls_test.stamp')::uuid;
    raise exception 'FAIL - a tenant backdated its own grace deadline';
  exception when insufficient_privilege then
    raise notice 'pass  47h2: UPDATE ... SET grace_ends_at = <past> is permission denied (A1: only the clock or the owner-only reason skips the grace)';
  end $$;
  select assert_eq((select count(*) from organization_domains where id = :'stamp' and state_changed_at = now()
                      and proof_verified_at is null and grace_ends_at is null and expires_at = now() + interval '7 days'),
                   1, '47h2: insert stamps state_changed_at and the 7-day expiry, and leaves every edge stamp null');
  update organization_domains set state = 'verified' where id = :'stamp';
  select assert_eq((select count(*) from organization_domains where id = :'stamp' and proof_verified_at = now() and state_changed_at = now()),
                   1, '47h2: entering verified stamps proof_verified_at and state_changed_at under presby_app');
  update organization_domains set state = 'attach_pending' where id = :'stamp';
  update organization_domains set state = 'attached' where id = :'stamp';
  select assert_eq((select count(*) from organization_domains where id = :'stamp' and attached_at = now()),
                   1, '47h2: attach_pending -> attached stamps attached_at');
  update organization_domains set state = 'live' where id = :'stamp';
  select assert_eq((select count(*) from organization_domains where id = :'stamp' and live_at = now()),
                   1, '47h2: entering live stamps live_at');
  update organization_domains set state = 'lapsed' where id = :'stamp';
  select assert_eq((select count(*) from organization_domains where id = :'stamp'
                      and abs(extract(epoch from grace_ends_at - (now() + interval '30 days'))) < 1),
                   1, '47h2: a legal edge into lapsed stamps grace_ends_at within a second of now() + 30 days (A1)');
  update organization_domains set state = 'verified' where id = :'stamp';
  select assert_eq((select count(*) from organization_domains where id = :'stamp' and grace_ends_at is null and release_cause is null),
                   1, '47h2: lapsed -> verified clears the grace deadline and the cause');
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'gone.invalid', 'gone.invalid', 'alias', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as gone \gset
  update organization_domains set state = 'released', release_cause = 'removed' where id = :'gone';
  select assert_eq((select count(*) from organization_domains where id = :'gone' and released_at = now() and release_cause = 'removed'),
                   1, '47h2: entering released stamps released_at');
rollback;

-- ===========================================================================
-- (h3) release_cause is tied to evidence the tenant cannot write (A2).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'cause.invalid', 'cause.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as cause_live \gset
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'cause-pending.invalid', 'cause-pending.invalid', 'alias', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as cause_pending \gset
  update organization_domains set state = 'verified' where id = :'cause_live';
  update organization_domains set state = 'attach_pending' where id = :'cause_live';
  update organization_domains set state = 'attached' where id = :'cause_live';
  update organization_domains set state = 'live' where id = :'cause_live';
  select set_config('rls_test.cause_live', :'cause_live', true);
  select set_config('rls_test.cause_pending', :'cause_pending', true);
  do $$
  declare
    v_case record;
    v_ok integer := 0;
  begin
    for v_case in
      select * from (values
        ('cause_live',    'parked',          'evicted',        'a tenant remove recording evicted'),
        ('cause_live',    'parked',          'force_released', 'a tenant remove recording force_released'),
        ('cause_pending', 'released',        'force_released', 'a tenant release of a pending claim recording force_released'),
        ('cause_pending', 'released',        'evicted',        'a tenant release of a pending claim recording evicted'),
        ('cause_live',    'parked',          'org_closed',     'org_closed while the organization is active'),
        ('cause_live',    'parked',          'lapsed_grace',   'lapsed_grace on a remove edge'),
        ('cause_live',    'parked',          null,             'a remove with a null cause'),
        ('cause_pending', 'released',        null,             'a release with a null cause'),
        ('cause_live',    'release_pending', 'removed',        'live -> release_pending without the owner-only reason'),
        ('cause_live',    'release_pending', 'force_released', 'live -> release_pending recording force_released without the reason')
      ) as t(row_var, to_state, cause, label)
    loop
      begin
        update organization_domains set state = v_case.to_state, release_cause = v_case.cause
         where id = current_setting('rls_test.' || v_case.row_var)::uuid;
        raise exception 'FAIL 47h3 - accepted: %', v_case.label;
      exception when check_violation then
        v_ok := v_ok + 1;
        raise notice 'pass  47h3: refused - %', v_case.label;
      end;
    end loop;
    if v_ok <> 10 then raise exception 'FAIL 47h3: % of 10 refused', v_ok; end if;
  end $$;
  do $$
  begin
    update organization_domains set release_cause = 'removed' where id = current_setting('rls_test.cause_live')::uuid;
    raise exception 'FAIL - release_cause changed with no state change';
  exception when check_violation then
    raise notice 'pass  47h3: release_cause cannot change outside an exit edge';
  end $$;
  -- lapsed_grace before the grace has run.
  update organization_domains set state = 'lapsed' where id = :'cause_live';
  do $$
  begin
    update organization_domains set state = 'release_pending', release_cause = 'lapsed_grace'
     where id = current_setting('rls_test.cause_live')::uuid;
    raise exception 'FAIL - lapsed_grace recorded before the grace deadline';
  exception when check_violation then
    raise notice 'pass  47h3: lapsed -> release_pending with lapsed_grace is refused before grace_ends_at';
  end $$;
  -- The legal tenant removal.
  update organization_domains set state = 'parked', release_cause = 'removed' where id = :'cause_live';
  select assert_eq((select count(*) from organization_domains where id = :'cause_live' and state = 'parked' and release_cause = 'removed'),
                   1, '47h3: the tenant''s own lapsed -> parked removal with cause removed is accepted');
  do $$
  begin
    update organization_domains set state = 'release_pending' where id = current_setting('rls_test.cause_live')::uuid;
    raise exception 'FAIL - a parked row skipped its grace';
  exception when check_violation then
    raise notice 'pass  47h3: parked -> release_pending is refused before the grace deadline (no reason, no clock)';
  end $$;
rollback;

-- ===========================================================================
-- (h4) The next_check_at cap (suggestion 2, state-aware).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'cap-check.invalid', 'cap-check.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as nc \gset
  select set_config('rls_test.nc', :'nc', true);
  update organization_domains set next_check_at = now() + interval '5 hours 59 minutes' where id = :'nc';
  select assert_eq((select count(*) from organization_domains where id = :'nc' and next_check_at = now() + interval '5 hours 59 minutes'),
                   1, '47h4: a pending row accepts next_check_at just under 6 hours ahead');
  do $$
  begin
    update organization_domains set next_check_at = now() + interval '6 hours 1 minute' where id = current_setting('rls_test.nc')::uuid;
    raise exception 'FAIL - next_check_at past the 6 h cap';
  exception when check_violation then
    raise notice 'pass  47h4: next_check_at more than 6 hours ahead is refused outside parked';
  end $$;
  do $$
  begin
    update organization_domains set next_check_at = now() + interval '23 hours' where id = current_setting('rls_test.nc')::uuid;
    raise exception 'FAIL - next_check_at 23 h ahead on a pending row';
  exception when check_violation then
    raise notice 'pass  47h4: the 24 h allowance belongs to parked only';
  end $$;
  update organization_domains set state = 'verified' where id = :'nc';
  update organization_domains set state = 'attach_pending' where id = :'nc';
  update organization_domains set state = 'parked', release_cause = 'removed' where id = :'nc';
  update organization_domains set next_check_at = now() + interval '23 hours 59 minutes' where id = :'nc';
  select assert_eq((select count(*) from organization_domains where id = :'nc' and next_check_at = now() + interval '23 hours 59 minutes'),
                   1, '47h4: a parked row accepts next_check_at just under 24 hours ahead');
  do $$
  begin
    update organization_domains set next_check_at = now() + interval '24 hours 1 minute' where id = current_setting('rls_test.nc')::uuid;
    raise exception 'FAIL - next_check_at past the 24 h parked cap';
  exception when check_violation then
    raise notice 'pass  47h4: a parked row''s next_check_at more than 24 hours ahead is refused';
  end $$;
rollback;

-- ===========================================================================
-- (i) Illegal edges, the terminal freeze, purpose-scoped edges, and the
--     insert shape.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'edge.invalid', 'edge.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as e_web \gset
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'mail', 'edge.invalid', 'edge.invalid', null, repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as e_mail \gset
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'edge-gone.invalid', 'edge-gone.invalid', 'alias', repeat('a', 32), 'tenant', :ELDERUSER)
  returning id as e_gone \gset
  update organization_domains set state = 'released', release_cause = 'removed' where id = :'e_gone';
  select set_config('rls_test.e_web', :'e_web', true);
  select set_config('rls_test.e_mail', :'e_mail', true);
  select set_config('rls_test.e_gone', :'e_gone', true);
  do $$
  declare
    v_case record;
    v_ok integer := 0;
  begin
    for v_case in
      select * from (values
        ('e_web',  null,       'live',           'pending -> live'),
        ('e_web',  null,       'attached',       'pending -> attached'),
        ('e_web',  null,       'lapsed',         'pending -> lapsed'),
        ('e_web',  null,       'expired',        'pending -> expired before expires_at'),
        ('e_web',  'verified', 'live',           'verified -> live'),
        ('e_web',  'verified', 'parked',         'verified -> parked'),
        ('e_mail', 'verified', 'attach_pending', 'a mail row -> attach_pending'),
        ('e_gone', null,       'pending',        'released -> pending (terminal)'),
        ('e_gone', null,       'verified',       'released -> verified (terminal)')
      ) as t(row_var, first_state, to_state, label)
    loop
      begin
        if v_case.first_state is not null then
          update organization_domains set state = v_case.first_state
           where id = current_setting('rls_test.' || v_case.row_var)::uuid and state = 'pending';
        end if;
        update organization_domains set state = v_case.to_state
         where id = current_setting('rls_test.' || v_case.row_var)::uuid;
        raise exception 'FAIL 47i - accepted: %', v_case.label;
      exception when check_violation then
        v_ok := v_ok + 1;
        raise notice 'pass  47i: refused - %', v_case.label;
      end;
    end loop;
    if v_ok <> 9 then raise exception 'FAIL 47i: % of 9 refused', v_ok; end if;
  end $$;
  -- The mail row's own exits: verified -> lapsed -> released (the 25th edge);
  -- the web row may NOT take lapsed -> released.
  update organization_domains set state = 'verified' where id = :'e_mail';
  update organization_domains set state = 'lapsed' where id = :'e_mail';
  do $$
  begin
    update organization_domains set state = 'parked', release_cause = 'removed' where id = current_setting('rls_test.e_mail')::uuid;
    raise exception 'FAIL - a mail row parked';
  exception when check_violation then
    raise notice 'pass  47i: a mail row can never enter parked';
  end $$;
  update organization_domains set state = 'released', release_cause = 'removed' where id = :'e_mail';
  select assert_eq((select count(*) from organization_domains where id = :'e_mail' and state = 'released'),
                   1, '47i: a lapsed mail row is removed straight to released (the mail-only edge)');
  update organization_domains set state = 'verified' where id = :'e_web';
  update organization_domains set state = 'lapsed' where id = :'e_web';
  do $$
  begin
    update organization_domains set state = 'released', release_cause = 'removed' where id = current_setting('rls_test.e_web')::uuid;
    raise exception 'FAIL - a lapsed web row skipped parked';
  exception when check_violation then
    raise notice 'pass  47i: a lapsed WEB row may not take the mail-only lapsed -> released edge';
  end $$;
  do $$
  begin
    update organization_domains set observation = '{"x": 1}'::jsonb where id = current_setting('rls_test.e_gone')::uuid;
    raise exception 'FAIL - a released row was written';
  exception when check_violation then
    raise notice 'pass  47i: a terminal row is frozen even for an observation write';
  end $$;
  do $$
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id, state)
    values ('22222222-2222-2222-2222-222222222222', 'web', 'born-live.invalid', 'born-live.invalid', 'alias', repeat('a', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2', 'live');
    raise exception 'FAIL - presby_app inserted a row born live';
  exception when insufficient_privilege then
    raise notice 'pass  47i: an insert naming state (born verified/live) is permission denied - state is not an insert column';
  end $$;
rollback;

-- ===========================================================================
-- (j) The caps: 3 non-terminal web hosts, 1 mail row, per org (R10).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'cap-one.invalid', 'cap-one.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER),
         (:ALDER, 'web', 'www.cap-one.invalid', 'cap-one.invalid', 'alias', repeat('a', 32), 'tenant', :ELDERUSER),
         (:ALDER, 'web', 'cap-two.invalid', 'cap-two.invalid', 'alias', repeat('c', 32), 'tenant', :ELDERUSER);
  do $$
  declare v_msg text;
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'web', 'www.cap-two.invalid', 'cap-two.invalid', 'alias', repeat('c', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - a 4th web host was accepted';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'organization_domains: cap%' then raise exception 'FAIL - refused for the wrong reason: %', v_msg; end if;
    raise notice 'pass  47j: the 4th non-terminal web host is refused by the cap';
  end $$;
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'mail', 'cap-one.invalid', 'cap-one.invalid', null, repeat('a', 32), 'tenant', :ELDERUSER);
  do $$
  declare v_msg text;
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'mail', 'cap-two.invalid', 'cap-two.invalid', null, repeat('c', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - a 2nd mail row was accepted';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'organization_domains: cap%' then raise exception 'FAIL - refused for the wrong reason: %', v_msg; end if;
    raise notice 'pass  47j: the 2nd non-terminal mail row is refused by the cap';
  end $$;
  -- A terminal row frees its slot.
  update organization_domains set state = 'released', release_cause = 'removed' where hostname = 'cap-two.invalid' and purpose = 'web';
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'cap-three.invalid', 'cap-three.invalid', 'alias', repeat('d', 32), 'tenant', :ELDERUSER);
  select assert_eq((select count(*) from organization_domains where purpose = 'web' and state not in ('expired', 'released')),
                   3, '47j: a released row frees its slot - the cap counts non-terminal rows only');
  -- The cap is per org: bramblewood is unaffected.
  select set_config('app.current_org_id', :BRAMBLE, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:BRAMBLE, 'web', 'bramble-one.invalid', 'bramble-one.invalid', 'canonical', repeat('b', 32), 'tenant', :ELDERUSER);
  select assert_eq((select count(*) from organization_domains), 1, '47j: the cap is per organization - bramblewood claims freely');
rollback;

-- ===========================================================================
-- (k) Duplicate host and second canonical.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'dup.invalid', 'dup.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER);
  do $$
  declare v_con text;
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'web', 'dup.invalid', 'dup.invalid', 'alias', repeat('a', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - the same host twice in one org';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'organization_domains_org_host_uq' then raise exception 'FAIL - wrong index: %', v_con; end if;
    raise notice 'pass  47k: a duplicate non-terminal host in one org is refused (organization_domains_org_host_uq)';
  end $$;
  do $$
  declare v_con text;
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'web', 'second.invalid', 'second.invalid', 'canonical', repeat('e', 32), 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - two canonical hosts in one org';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'organization_domains_one_canonical_uq' then raise exception 'FAIL - wrong index: %', v_con; end if;
    raise notice 'pass  47k: a second non-terminal canonical host is refused (organization_domains_one_canonical_uq)';
  end $$;
  do $$
  declare v_con text;
  begin
    update organization_domains set web_role = null where hostname = 'dup.invalid';
    raise exception 'FAIL - a web row lost its role';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'organization_domains_web_role_iff_web' then raise exception 'FAIL - wrong constraint: %', v_con; end if;
    raise notice 'pass  47k: a web row always carries a web_role (organization_domains_web_role_iff_web)';
  end $$;
rollback;

-- ===========================================================================
-- (l) The hostname shape CHECKs (the A13 table's database backstop).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    v_case record;
    v_con text;
    v_ok integer := 0;
  begin
    for v_case in
      select * from (values
        ('Upper.invalid',                         'Upper.invalid',      'shape', 'uppercase'),
        (repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 62),
         repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 62),
                                                                        'shape', '254 characters'),
        (repeat('a', 64) || '.invalid',           repeat('a', 64) || '.invalid', 'shape', 'a 64-character label'),
        ('a..b',                                  'a..b',               'shape', 'an empty label (a..b)'),
        ('trailing.invalid.',                     'trailing.invalid.',  'shape', 'a trailing dot'),
        ('192.0.2.1',                             '192.0.2.1',          'shape', 'an IPv4 literal'),
        ('[2001:db8::1]',                         '[2001:db8::1]',      'shape', 'an IPv6 literal'),
        ('church.vercel.app',                     'church.vercel.app',  'shape', 'a *.vercel.app host'),
        ('vercel.app',                            'vercel.app',         'shape', 'vercel.app itself'),
        ('localhost',                             'localhost',          'shape', 'localhost'),
        ('church.localhost',                      'church.localhost',   'shape', 'a *.localhost host'),
        ('single',                                'single',             'shape', 'a single label'),
        ('-lead.invalid',                         '-lead.invalid',      'shape', 'a leading hyphen'),
        ('trail-.invalid',                        'trail-.invalid',     'shape', 'a trailing hyphen'),
        ('*.wild.invalid',                        '*.wild.invalid',     'shape', 'a wildcard'),
        ('port.invalid:443',                      'port.invalid:443',   'shape', 'a port'),
        ('https://scheme.invalid',                'https://scheme.invalid', 'shape', 'a scheme'),
        (' space.invalid',                        ' space.invalid',     'shape', 'a leading space'),
        ('sub.claim.invalid',                     'claim.invalid',      'organization_domains_host_in_claim',  'a host that is neither the claim nor its www'),
        ('www.Claim.invalid',                     'Claim.invalid',      'shape', 'an uppercase claim'),
        ('www.' || repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 58),
         repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 58),
                                                                        'organization_domains_hostname_shape', 'a 254-character www host over a valid 250-character claim (hostname_shape alone)'),
        ('www.invalid',                           'invalid',            'organization_domains_claim_name_shape', 'a single-label claim under a two-label host (claim_name_shape alone)')
      ) as t(host, claim, expected, label)
    loop
      begin
        insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
        values ('22222222-2222-2222-2222-222222222222', 'mail', v_case.host, v_case.claim, null, repeat('a', 32), 'tenant',
                'e0000000-0000-0000-0000-0000000000f2');
        raise exception 'FAIL 47l - accepted: %', v_case.label;
      exception when check_violation then
        get stacked diagnostics v_con = constraint_name;
        -- CHECKs fire in constraint-name order, so where host = claim the
        -- claim_name_shape twin can fire first: 'shape' accepts either.
        if not (v_con = v_case.expected
                or (v_case.expected = 'shape'
                    and v_con in ('organization_domains_hostname_shape', 'organization_domains_claim_name_shape'))) then
          raise exception 'FAIL 47l - % refused by % (expected %)', v_case.label, coalesce(nullif(v_con, ''), 'a non-constraint check'), v_case.expected;
        end if;
        v_ok := v_ok + 1;
      end;
    end loop;
    if v_ok <> 22 then raise exception 'FAIL 47l: % of 22 refused', v_ok; end if;
    raise notice 'pass  47l: all 22 malformed hosts/claims are refused by the named shape CHECK';
  end $$;
  do $$
  declare v_con text;
  begin
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'mail', 'token.invalid', 'token.invalid', null, 'short', 'tenant',
            'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL - a short proof token was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'organization_domains_proof_token_shape' then raise exception 'FAIL - wrong constraint: %', v_con; end if;
    raise notice 'pass  47l: a proof token shorter than 32 url-safe characters is refused';
  end $$;
  -- Positive controls, so the table is not refusing everything.
  insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
  values (:ALDER, 'web', 'xn--bcher-kva.invalid', 'xn--bcher-kva.invalid', 'canonical', repeat('a', 32), 'tenant', :ELDERUSER),
         (:ALDER, 'web', 'www.xn--bcher-kva.invalid', 'xn--bcher-kva.invalid', 'alias', repeat('a', 32), 'tenant', :ELDERUSER),
         (:ALDER, 'web', repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 61),
                         repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 61),
                         'alias', repeat('a', 32), 'tenant', :ELDERUSER);
  select assert_eq((select count(*) from organization_domains), 3,
                   '47l: positive controls accepted - a punycode label, its www, and a 253-character host');
rollback;

-- ===========================================================================
-- (m) presby_current_org_site_status() answers only for the caller's org.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from (select presby_current_org_site_status() as s) x where s = 'provisioning'),
                   1, '47m: alder reads its own site status (provisioning)');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from (select presby_current_org_site_status() as s) x where s is null),
                   1, '47m: bramblewood (no site) reads NULL - never another org''s status');
  select set_config('app.current_org_id', '', true);
  select assert_eq((select count(*) from (select presby_current_org_site_status() as s) x where s is null),
                   1, '47m: with no GUC it reads NULL');
  select assert_eq((select pronargs from pg_proc where proname = 'presby_current_org_site_status')::bigint,
                   0, '47m: it takes no argument, so it is not an oracle (T12)');
rollback;

-- ===========================================================================
-- (n) domains.manage: the catalog row and the F150 backfill.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'domains.manage' and module = 'domains'
        and sensitivity_tier = 1 and requires_two_factor),
    1, '47n: domains.manage is a tier-1 key in module domains, requires_two_factor true (0080; DECISION-291 supersedes T7 / TODO S3)');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and rp.permission_key = 'domains.manage'),
    0, '47n: no template role delivers domains.manage (DECISION-155 criterion (i): only the founding bundle can)');
  do $$
  declare
    v_org uuid;
    v_missing bigint := 0;
    v_roles bigint := 0;
    v_n bigint;
  begin
    for v_org in select id from organizations loop
      perform set_config('app.current_org_id', v_org::text, true);
      select count(*) into v_n from app_roles r where r.organization_id = v_org and r.key = 'founding_administrator';
      v_roles := v_roles + v_n;
      select count(*) into v_n from app_roles r
       where r.organization_id = v_org and r.key = 'founding_administrator'
         and not exists (select 1 from app_role_permissions rp where rp.role_id = r.id and rp.permission_key = 'domains.manage');
      v_missing := v_missing + v_n;
    end loop;
    if v_missing <> 0 then
      raise exception 'FAIL 47n: % of % founding_administrator roles lack domains.manage (F150 backfill)', v_missing, v_roles;
    end if;
    raise notice 'pass  47n: every founding_administrator role, at every organization (% found), holds domains.manage', v_roles;
  end $$;
rollback;

-- ===========================================================================
-- (o) F152 column-list pins.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_published_site(text)'::regprocedure
        and (select array_agg(a.n order by a.i) from unnest(p.proargnames, p.proargmodes) with ordinality a(n, m, i) where a.m = 't')
            = array['organization_id', 'organization_name', 'organization_type', 'content_bundle_key',
                    'brand_seed_hex', 'brand_type_pairing', 'brand_token_version', 'brand_light_only',
                    'profile_address', 'profile_phone', 'profile_facebook_url', 'profile_instagram_url',
                    'profile_x_twitter_url', 'profile_youtube_url', 'profile_other_url',
                    'service_times', 'office_hours', 'serving_host']),
    1, '47o: presby_published_site keeps its 17 OUT columns in order and gains exactly serving_host at the end');
  select assert_eq(
    (select count(*)
       from (select array_agg(a.n order by a.i) as names,
                    array_agg(format_type(a.t, null) order by a.i) as types
               from pg_proc p, unnest(p.proargnames, p.proargmodes, p.proallargtypes) with ordinality a(n, m, t, i)
              where p.oid = 'presby_published_site(text)'::regprocedure and a.m = 't') ps,
            (select array_agg(a.n order by a.i) as names,
                    array_agg(format_type(a.t, null) order by a.i) as types
               from pg_proc p, unnest(p.proargnames, p.proargmodes, p.proallargtypes) with ordinality a(n, m, t, i)
              where p.oid = 'presby_published_site_by_host(text)'::regprocedure and a.m = 't') bh
      where bh.names = ps.names || array['slug', 'canonical_host', 'request_is_canonical']
        and bh.types = ps.types || array['text', 'text', 'boolean']),
    1, '47o: presby_published_site_by_host''s columns = presby_published_site''s (names AND types) + slug, canonical_host, request_is_canonical');
  select assert_eq(
    (select count(*) from pg_proc p, unnest(p.proargnames) n
      where p.proname in ('presby_published_site', 'presby_published_site_by_host')
        and n in ('platform_hold', 'hold_reason', 'force_release_reason', 'proof_token', 'office_email')),
    0, '47o: neither projection carries a hold, a reason, a proof token or an office address');
rollback;

\echo '======================================================'
\echo ' Section 47 (custom domains, drizzle/0057) complete.'
\echo '======================================================'
