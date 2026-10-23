-- ---------------------------------------------------------------------------
-- 60. Designation-holder revoke (drizzle/0060_presby_designation_revoke.sql;
--     DECISION-194/195/196, F169-F171; docs/work-log/2026-10-22-designation-revoke.md
--     Phase 3 Test Plan, Batch A).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner:
--
--         \ir designation-revoke/test-rls-60.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/designation-revoke/test-rls-60.sql
--
--     after scripts/install-test-helpers.sql (owner) and scripts/seed-dev.sql.
--     It names only the synthetic seed-dev organizations (Alder Creek
--     22222222-..., Northern Reach 11111111-...). Every block ends in
--     rollback, so it writes nothing durable. No seed change is needed: 0060
--     adds functions only.
--
--     Sections (a)-(c). What presby_app CANNOT reach (every revoke outcome,
--     the list = count equality, the membership-end clamp, the two-connection
--     races, and the revoke body's write surface) is proven on the owner
--     connection in Vitest instead: src/lib/db/domain/designation-revoke.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

\echo '======================================================'
\echo ' Section 60 (designation-holder revoke, drizzle/0060) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '60: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Shape and ACL: the four new functions and the two redefined counts are
--     SECURITY DEFINER, owned by neondb_owner, search_path pinned, and
--     executable by neither presby_app nor PUBLIC (a cross-org holder list is
--     an oracle; the revoke is the platform's alone).
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) = 'neondb_owner'
        and p.proconfig = array['search_path=public, pg_temp']
        and p.oid in ('presby_founding_administrator_holder_grants(uuid)'::regprocedure,
                      'presby_giving_manage_holder_grants(uuid)'::regprocedure,
                      'presby_founding_administrator_companion_grants(uuid,uuid)'::regprocedure,
                      'presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])'::regprocedure,
                      'presby_founding_administrator_holder_count(uuid)'::regprocedure,
                      'presby_giving_manage_holder_count(uuid)'::regprocedure)),
    6, '60a: all six 0060 functions are SECURITY DEFINER, owned by neondb_owner, search_path = public, pg_temp (DECISION-148)');
  select assert_eq(
    (select count(*) from (values ('presby_founding_administrator_holder_grants(uuid)'),
                                  ('presby_giving_manage_holder_grants(uuid)'),
                                  ('presby_founding_administrator_companion_grants(uuid,uuid)'),
                                  ('presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])'),
                                  ('presby_founding_administrator_holder_count(uuid)'),
                                  ('presby_giving_manage_holder_count(uuid)')) v(f)
      where has_function_privilege(v.f::regprocedure, 'EXECUTE')),
    0, '60a: presby_app may EXECUTE none of the six (owner only)');
  select assert_eq(
    (select count(*) from (values ('presby_founding_administrator_holder_grants(uuid)'),
                                  ('presby_giving_manage_holder_grants(uuid)'),
                                  ('presby_founding_administrator_companion_grants(uuid,uuid)'),
                                  ('presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])'),
                                  ('presby_founding_administrator_holder_count(uuid)'),
                                  ('presby_giving_manage_holder_count(uuid)')) v(f)
      where has_function_privilege('presby_platform', v.f::regprocedure, 'EXECUTE')),
    0, '60a: nor may presby_platform');
  select assert_eq(
    (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid in ('presby_founding_administrator_holder_grants(uuid)'::regprocedure,
                      'presby_giving_manage_holder_grants(uuid)'::regprocedure,
                      'presby_founding_administrator_companion_grants(uuid,uuid)'::regprocedure,
                      'presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])'::regprocedure,
                      'presby_founding_administrator_holder_count(uuid)'::regprocedure,
                      'presby_giving_manage_holder_count(uuid)'::regprocedure)
        and a.grantee = 0),
    0, '60a: PUBLIC executes none of the six');
rollback;

-- ===========================================================================
-- (b) A call through presby_app is refused (permission denied), even with an
--     org context set: the GUC confers nothing on an owner-only function.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  do $$
  begin
    perform * from presby_founding_administrator_holder_grants('22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL 60b - presby_app listed founding-administrator holders';
  exception when insufficient_privilege then
    raise notice 'pass  60b: presby_founding_administrator_holder_grants refused (permission denied)';
  end $$;
  do $$
  begin
    perform * from presby_giving_manage_holder_grants('22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL 60b - presby_app listed treasurer holders';
  exception when insufficient_privilege then
    raise notice 'pass  60b: presby_giving_manage_holder_grants refused (permission denied)';
  end $$;
  do $$
  begin
    perform * from presby_founding_administrator_companion_grants('22222222-2222-2222-2222-222222222222',
                                                                  '22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL 60b - presby_app read companion grants';
  exception when insufficient_privilege then
    raise notice 'pass  60b: presby_founding_administrator_companion_grants refused (permission denied)';
  end $$;
  do $$
  begin
    perform * from presby_revoke_designation_holder('22222222-2222-2222-2222-222222222222', 'founding_administrator',
                                                    'person', '22222222-2222-2222-2222-222222222222',
                                                    array['22222222-2222-2222-2222-222222222222']::uuid[]);
    raise exception 'FAIL 60b - presby_app called the platform revoke';
  exception when insufficient_privilege then
    raise notice 'pass  60b: presby_revoke_designation_holder refused (permission denied)';
  end $$;
  do $$
  begin
    perform presby_founding_administrator_holder_count('22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL 60b - presby_app called the redefined founding-administrator count';
  exception when insufficient_privilege then
    raise notice 'pass  60b: presby_founding_administrator_holder_count (redefined over the list) still refused';
  end $$;
  do $$
  begin
    perform presby_giving_manage_holder_count('22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL 60b - presby_app called the redefined giving count';
  exception when insufficient_privilege then
    raise notice 'pass  60b: presby_giving_manage_holder_count (redefined over the list) still refused';
  end $$;
rollback;

-- ===========================================================================
-- (c) role_grants still isolates by organization for presby_app: 0060 changed
--     no policy, but it is the table the revoke writes, so the tenant side's
--     view of it is re-pinned here. Positive control first, so the zeros
--     cannot be vacuous.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'role_grants' and relrowsecurity and relforcerowsecurity),
    1, '60c: role_grants has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from role_grants),
    0, '60c: with no org context presby_app sees no role_grants row');
rollback;

begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  select assert_eq(
    (select (count(*) > 0)::int from role_grants where organization_id = '22222222-2222-2222-2222-222222222222'),
    1, '60c: POSITIVE CONTROL - Alder Creek''s own grants are visible in its context');
  select assert_eq(
    (select count(*) from role_grants where organization_id <> '22222222-2222-2222-2222-222222222222'),
    0, '60c: and no other organization''s grant is visible from it');
  select assert_eq(
    (select count(*) from role_grants where organization_id = '11111111-1111-1111-1111-111111111111'),
    0, '60c: Northern Reach''s grants (which exist) are invisible from Alder Creek''s context');
  -- A tenant-side end of another org's grant touches nothing (RLS filters the
  -- write's target, not only reads).
  with ended as (
    update role_grants set ends_on = current_date
     where organization_id = '11111111-1111-1111-1111-111111111111'
    returning 1)
  select assert_eq((select count(*) from ended),
    0, '60c: presby_app cannot end another organization''s grant from this context');
rollback;

begin;
  select set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true);
  select assert_eq(
    (select (count(*) > 0)::int from role_grants),
    1, '60c: POSITIVE CONTROL - Northern Reach''s grants are visible in its own context');
  select assert_eq(
    (select count(*) from role_grants where organization_id <> '11111111-1111-1111-1111-111111111111'),
    0, '60c: and only its own');
rollback;

\echo '======================================================'
\echo ' Section 60 complete.'
\echo '======================================================'
