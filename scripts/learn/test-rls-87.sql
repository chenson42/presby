-- ---------------------------------------------------------------------------
-- 87. Learn, Increment 1a: Spot the scam - the anonymous toggle read
--     (drizzle/0087_presby_learn.sql; DECISION-330/331;
--     docs/work-log/2026-11-10-learn-inc1a.md Phase 3 "Data Model" and the
--     integration list item 3).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE appended section
--     banner and line at its end (scripts/learn/test-rls.sql.integration.patch):
--
--         \ir learn/test-rls-87.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/learn/test-rls-87.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs the stock
--     scripts/seed-dev.sql fixture (Alder Creek's `provisioning` site) AND
--     scripts/careers/seed-dev-careers.sql for ONE thing only: Fernwood's
--     `live` site row (presby_app holds no grant on organization_sites,
--     DECISION-081, so it cannot build a serving site itself). Section 71
--     already has the same dependency. Every toggle, category and axis state
--     asserted below is built inside its own block, and every block ends in
--     rollback, so the section writes nothing durable.
--
--     Sections:
--       (a) presby_learn_enabled: invoker, stable, search_path pinned, NO
--           EXECUTE for presby_app, presby_platform or PUBLIC (owner only),
--           and a direct call from presby_app is refused
--       (b) presby_public_learn: SECURITY DEFINER, stable, search_path pinned,
--           EXECUTE for exactly the owner and presby_app
--       (c) presby_public_learn's answers: exactly one row always; available
--           only for a live site with the toggle on; every other cause is
--           the same byte-identical `unavailable` row
--       (d) the category CHECK admits `learn` and still refuses
--           `administration` and a garbage value
--
--     What presby_app CANNOT reach is proven on the owner connection in
--     Vitest instead (src/lib/learn/public.db.test.ts): the predicate equal
--     to orgFeatureEnabledInTx over type x axis (on, off, MISSING) x category
--     x toggle, every organization type, an organization that is not active,
--     a suspended site (presby_app cannot write organizations or
--     organization_sites, and cannot delete a feature_flags row).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set FERN      '\'55555555-5555-5555-5555-555555555555\''

\echo '======================================================'
\echo ' Section 87 (learn, drizzle/0087) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '87: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) presby_learn_enabled is owner-only
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_learn_enabled(uuid,text)'::regprocedure
        and not p.prosecdef and p.provolatile = 's'
        and p.proconfig = array['search_path=public, pg_temp']),
    1, '87a: presby_learn_enabled is SECURITY INVOKER, stable, search_path pinned');
  -- The full ACL, any connection: exactly one EXECUTE grantee, the owner.
  -- PUBLIC shows as grantee 0 in aclexplode, so it is counted here too.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_learn_enabled(uuid,text)'::regprocedure
        and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
               from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = array[pg_get_userbyid(p.proowner)::text]),
    1, '87a: presby_learn_enabled is executable by exactly the owner (no presby_app, no presby_platform, no PUBLIC)');
  select assert_eq(
    (select count(*) from (values ('presby_app'), ('presby_platform')) r(role)
      where has_function_privilege(r.role, 'presby_learn_enabled(uuid,text)', 'EXECUTE')),
    0, '87a: has_function_privilege agrees - neither presby_app nor presby_platform may execute it');
rollback;

-- A direct call from presby_app is refused by the grant, with the toggle ON
-- (so a refusal is not just a false answer in disguise).
begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:FERN, 'org_portal.spot_the_scam', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  do $$
  begin
    perform presby_learn_enabled('55555555-5555-5555-5555-555555555555'::uuid, 'org_portal.spot_the_scam');
    raise exception 'FAIL 87a: presby_app called presby_learn_enabled directly';
  exception when insufficient_privilege then
    raise notice 'pass  87a: presby_app calling presby_learn_enabled directly is insufficient_privilege';
  end $$;
rollback;

-- ===========================================================================
-- (b) presby_public_learn is the definer, presby_app only
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_learn(text,text)'::regprocedure
        and p.prosecdef and p.provolatile = 's'
        and p.proconfig = array['search_path=public, pg_temp']
        and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
               from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = (select array_agg(r order by r) from unnest(array[pg_get_userbyid(p.proowner)::text, 'presby_app']) r)),
    1, '87b: presby_public_learn is SECURITY DEFINER, stable, search_path pinned, executable by exactly the owner and presby_app (no PUBLIC, no presby_platform)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_learn(text,text)'::regprocedure
        and pg_get_function_result(p.oid) = 'TABLE(state text)'),
    1, '87b: presby_public_learn returns one column, state, and nothing else (no name, no id)');
rollback;

-- ===========================================================================
-- (c) presby_public_learn's answers
-- ===========================================================================
-- Every cause of unavailable is built on its own inside this block (the toggle
-- and the category through presby_app's own grants under the org GUC, the
-- axis flag through its UPDATE on feature_flags), and the whole row is
-- captured as text with the number of rows the call returned.
begin;
  create temp table t87_unavailable (cause text, n integer, r text) on commit drop;
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';

  -- The toggle is the ONLY thing that turns it on: Fernwood is live (seed)
  -- with no Spot the scam toggle row - missing is OFF.
  select set_config('app.current_org_id', :FERN, true);
  delete from organization_feature_toggles where organization_id = :FERN and feature_key = 'org_portal.spot_the_scam';
  insert into t87_unavailable select 'toggle row missing', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', 'org_portal.spot_the_scam') x;

  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:FERN, 'org_portal.spot_the_scam', false);
  insert into t87_unavailable select 'toggle off', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', 'org_portal.spot_the_scam') x;

  update organization_feature_toggles set enabled = true
   where organization_id = :FERN and feature_key = 'org_portal.spot_the_scam';
  select assert_eq(
    (select count(*) from presby_public_learn('fernwood', 'org_portal.spot_the_scam') where state = 'available'),
    1, '87c: baseline - Fernwood (live site, toggle on) is available');
  select assert_eq(
    (select count(*) from presby_public_learn('fernwood', 'org_portal.spot_the_scam')),
    1, '87c: and available is exactly one row');

  -- The definer does not depend on the caller's GUC: with no org context at
  -- all (the anonymous route's shape) Fernwood is still available.
  select set_config('app.current_org_id', '', true);
  select assert_eq(
    (select count(*) from presby_public_learn('fernwood', 'org_portal.spot_the_scam') where state = 'available'),
    1, '87c: with NO org GUC (the anonymous request) the answer is the same available row');
  select set_config('app.current_org_id', :FERN, true);

  -- Not a Learn key: careers is ON at Fernwood (seed), and Fernwood's
  -- giving toggle is turned on here; neither may be asked about through
  -- this function. Nor may an unknown or null key.
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:FERN, 'org_portal.careers', true), (:FERN, 'org_portal.giving', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  insert into t87_unavailable select 'non-Learn key org_portal.careers (its toggle on)', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', 'org_portal.careers') x;
  insert into t87_unavailable select 'non-Learn key org_portal.giving (its toggle on)', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', 'org_portal.giving') x;
  insert into t87_unavailable select 'unknown key', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', 'org_portal.no_such_learn_page') x;
  insert into t87_unavailable select 'null key', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', null) x;

  -- Unknown and null slugs.
  insert into t87_unavailable select 'unknown slug', count(*) over (), (x.*)::text
    from presby_public_learn('t87-no-such-org', 'org_portal.spot_the_scam') x;
  insert into t87_unavailable select 'null slug', count(*) over (), (x.*)::text
    from presby_public_learn(null, 'org_portal.spot_the_scam') x;

  -- Site not live: Alder Creek's site is `provisioning` (stock seed), toggle on.
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:ALDER, 'org_portal.spot_the_scam', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  insert into t87_unavailable select 'site not live (Alder Creek is provisioning)', count(*) over (), (x.*)::text
    from presby_public_learn('alder-creek', 'org_portal.spot_the_scam') x;

  -- The category axis. A `learn` OFF row is inert while the axis is off,
  -- refuses while it is on, and a MISSING row is on.
  select set_config('app.current_org_id', :FERN, true);
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:FERN, 'learn', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq(
    (select count(*) from presby_public_learn('fernwood', 'org_portal.spot_the_scam') where state = 'available'),
    1, '87c: with the category axis OFF, a learn-off category row is inert (available)');
  update feature_flags set enabled = true where key = 'org_portal.feature_categories';
  insert into t87_unavailable select 'learn category off, axis on', count(*) over (), (x.*)::text
    from presby_public_learn('fernwood', 'org_portal.spot_the_scam') x;
  -- Another category off is irrelevant to a Learn key.
  delete from organization_feature_categories where organization_id = :FERN and category = 'learn';
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:FERN, 'people', false), (:FERN, 'communications', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq(
    (select count(*) from presby_public_learn('fernwood', 'org_portal.spot_the_scam') where state = 'available'),
    1, '87c: with the axis ON and NO learn category row (people and communications off), the learn category is on (available)');
  update organization_feature_categories set enabled = true where organization_id = :FERN;
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:FERN, 'learn', true);
  select assert_eq(
    (select count(*) from presby_public_learn('fernwood', 'org_portal.spot_the_scam') where state = 'available'),
    1, '87c: with the axis ON and an explicit learn ON row, available');

  select assert_eq((select count(*) from t87_unavailable), 10, '87c: ten unavailable causes captured');
  select assert_eq((select count(*) from t87_unavailable where n <> 1), 0, '87c: every cause returned exactly ONE row');
  select assert_eq((select count(distinct r) from t87_unavailable), 1, '87c: and the row is byte-identical for every cause');
  -- A one-column function's alias is the scalar, so the captured text is the
  -- bare state; a second output column would make it a composite and fail here.
  select assert_eq((select count(*) from t87_unavailable where r = 'unavailable'), 10, '87c: and that row is the bare state unavailable, nothing else');
rollback;

-- ===========================================================================
-- (d) The category CHECK admits `learn` and still refuses the rest
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:ALDER, 'learn', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq(
    (select count(*) from organization_feature_categories where organization_id = :ALDER and category = 'learn'),
    1, '87d: organization_feature_categories_category_check admits learn (DECISION-330)');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into organization_feature_categories (organization_id, category, enabled)
    values ('22222222-2222-2222-2222-222222222222', 'administration', true);
    raise exception 'FAIL 87d: a row with category = ''administration'' was accepted';
  exception when check_violation then
    raise notice 'pass  87d: the widened CHECK still refuses administration';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into organization_feature_categories (organization_id, category, enabled)
    values ('22222222-2222-2222-2222-222222222222', 'learning', true);
    raise exception 'FAIL 87d: a row with a near-miss category (learning) was accepted';
  exception when check_violation then
    raise notice 'pass  87d: the widened CHECK still refuses a garbage value (learning)';
  end $$;
rollback;

\echo '======================================================'
\echo ' Section 87 (learn, drizzle/0087) passed.'
\echo '======================================================'
