-- ---------------------------------------------------------------------------
-- 83. User help Increment 2: the /help/contact drop box
--     (drizzle/0083_presby_help_contact.sql; DECISION-300/301/303, CA1;
--     docs/work-log/2026-10-31-help-contact.md, Phase 3 "Database tests").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner
--     (docs/work-log/help-contact.integration.patch):
--
--         \ir help-contact/test-rls-83.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/help-contact/test-rls-83.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs NO seed fixture:
--     the table has no organization and no person. Every block ends in
--     rollback, so the suite writes nothing durable (a message presby_app
--     stores through the definer is rolled back with its block).
--
--     Sections:
--       (a) structure: FORCE RLS with ZERO policies (the deliberate deny-all),
--           no table privilege for presby_app, presby_platform or PUBLIC, the
--           two guards (enabled, invoker, search_path pinned), the definer
--           (SECURITY DEFINER, search_path pinned, EXECUTE to exactly the
--           owner and presby_app)
--       (b) every table verb is permission denied (42501) for presby_app
--       (c) the definer: presby_app can call it, gets a closed token and no
--           id, still cannot read the row back, and the CHECKs bind through it
--
--     What presby_app CANNOT reach is proven on the owner connection in
--     Vitest instead (src/lib/db/domain/help-contact.db.test.ts): the delete
--     and update guards on the OWNER path, every CHECK, the coalescing claim
--     (first, second, aged window, two concurrent connections), the hourly
--     and daily ceilings, and the EXECUTE-revoke kill switch (the revoke is an
--     owner statement, and presby_app cannot SET ROLE).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

\echo '======================================================'
\echo ' Section 83 (help contact, drizzle/0083) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '83: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'help_contact_messages' and relkind = 'r'
        and relrowsecurity and relforcerowsecurity),
    1, '83a: help_contact_messages has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'help_contact_messages'),
    0, '83a: and ZERO policies - a deliberate deny-all for every role without BYPASSRLS (DECISION-300)');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'help_contact_messages'
        and (a.grantee = 0 or a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole))),
    0, '83a: PUBLIC, presby_app and presby_platform hold NOTHING on help_contact_messages (CA1)');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'help_contact_messages' and a.grantee <> c.relowner),
    0, '83a: no role but the table owner appears in its ACL at all');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'help_contact_messages'::regclass and not t.tgisinternal
        and t.tgenabled = 'O' and not p.prosecdef
        and p.proconfig = array['search_path=public, pg_temp']
        and (t.tgname, p.proname) in (('help_contact_guard_delete', 'presby_help_contact_guard_delete'),
                                      ('help_contact_guard_update', 'presby_help_contact_guard_update'))),
    2, '83a: both guards exist, are ENABLED, SECURITY INVOKER and pin search_path = public, pg_temp');
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid = 'help_contact_messages'::regclass and not t.tgisinternal),
    2, '83a: and there is no other trigger on the table');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_submit_help_contact(text, text, text, text, text)'::regprocedure
        and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
        and pg_get_function_result(p.oid) = 'text'
        and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
               from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = (select array_agg(r order by r) from unnest(array[pg_get_userbyid(p.proowner)::text, 'presby_app']) r)),
    1, '83a: presby_submit_help_contact is SECURITY DEFINER, search_path pinned, returns text, EXECUTE to exactly the owner and presby_app');
  select assert_eq(
    (select count(*) where has_function_privilege('public', 'presby_submit_help_contact(text, text, text, text, text)', 'execute')),
    0, '83a: PUBLIC cannot execute the definer');
  select assert_eq(
    (select count(*) where has_function_privilege('presby_platform', 'presby_submit_help_contact(text, text, text, text, text)', 'execute')),
    0, '83a: presby_platform cannot execute the definer');
  select assert_eq(
    (select count(*) from unnest(array['presby_help_contact_guard_delete()', 'presby_help_contact_guard_update()']) f
      where has_function_privilege('presby_app', f, 'execute') or has_function_privilege('public', f, 'execute')),
    0, '83a: neither guard function is executable by presby_app or PUBLIC');
rollback;

-- ===========================================================================
-- (b) Every table verb is permission denied for presby_app (CA1)
-- ===========================================================================
begin;
  do $$
  declare v_stmt text; v_n integer := 0;
  begin
    foreach v_stmt in array array[
      $q$select count(*) from help_contact_messages$q$,
      $q$select id from help_contact_messages limit 1$q$,
      $q$insert into help_contact_messages (topic, email, message) values ('something_else', 't83@example.invalid', 'A direct insert probe')$q$,
      $q$update help_contact_messages set status = 'spam'$q$,
      $q$delete from help_contact_messages$q$,
      $q$truncate help_contact_messages$q$
    ] loop
      begin
        execute v_stmt;
        raise exception 'FAIL 83b: presby_app ran: %', v_stmt;
      exception when insufficient_privilege then
        v_n := v_n + 1;
      end;
    end loop;
    if v_n <> 6 then raise exception 'FAIL 83b: expected 6 refusals, saw %', v_n; end if;
    raise notice 'pass  83b: SELECT (x2), INSERT, UPDATE, DELETE and TRUNCATE on help_contact_messages are each permission denied (42501) for presby_app';
  end $$;
rollback;

-- ===========================================================================
-- (c) The definer (CA1, CA3)
-- ===========================================================================
begin;
  -- presby_app can call it; it answers with one of the closed tokens. Which
  -- one depends on committed rows from earlier runs (the window may already
  -- be claimed); 'ceiling' would mean the branch holds 90 rows from the last
  -- hour, which no test here creates.
  select set_config('t83.outcome',
    presby_submit_help_contact('something_else', 'Probe Sender', 't83-probe@example.invalid',
                               'Probe Congregation', 'A message from section 83, rolled back.'),
    true);
  select assert_eq(
    (select count(*) where current_setting('t83.outcome') in ('stored', 'stored_notify')),
    1, '83c: presby_app stores a message through the definer and gets stored or stored_notify');
  select assert_eq(
    (select count(*) where current_setting('t83.outcome') !~ '[0-9a-f]{8}-'),
    1, '83c: the answer carries no id');
  do $$
  begin
    perform 1 from help_contact_messages where email = 't83-probe@example.invalid';
    raise exception 'FAIL 83c: presby_app read a stored message back';
  exception when insufficient_privilege then
    raise notice 'pass  83c: presby_app still cannot read the message it just stored (%)', sqlerrm;
  end $$;
rollback;

-- The CHECKs bind through the definer: a bad value presby_app passes is a
-- check_violation (23514), which src/lib/help-contact/submit.ts maps to
-- "not sent". Each probe is its own subtransaction.
begin;
  do $$
  declare v_case record; v_n integer := 0;
  begin
    for v_case in
      select * from (values
        ('an unknown topic',          'billing',        't83@example.invalid', 'A long enough message body.'),
        ('a nine-character message',  'something_else', 't83@example.invalid', '123456789'),
        ('a whitespace-only message', 'something_else', 't83@example.invalid', E'          \n\n   '),
        ('an email with no dot',      'something_else', 't83@example',         'A long enough message body.'),
        ('an email with a space',     'something_else', 't83 x@example.invalid','A long enough message body.'),
        ('a control character',       'something_else', 't83@example.invalid', 'A long enough' || chr(1) || ' message body.'),
        ('a 2,001-character message', 'something_else', 't83@example.invalid', repeat('m', 2001)),
        ('no email',                  'something_else', null,                  'A long enough message body.'),
        ('no message',                'something_else', 't83@example.invalid', null)
      ) as t(label, topic, email, message)
    loop
      begin
        perform presby_submit_help_contact(v_case.topic, null, v_case.email, null, v_case.message);
        raise exception 'FAIL 83c: the definer stored %', v_case.label;
      exception when check_violation then
        v_n := v_n + 1;
      end;
    end loop;
    if v_n <> 9 then raise exception 'FAIL 83c: expected 9 check violations, saw %', v_n; end if;
    raise notice 'pass  83c: the definer refuses 9 bad inputs with check_violation (topic, short, blank, email shape x2, control, long, no email, no message)';
  end $$;
rollback;

\echo '======================================================'
\echo ' Section 83 (help contact) complete.'
\echo '======================================================'
