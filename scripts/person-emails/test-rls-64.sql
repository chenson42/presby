-- ---------------------------------------------------------------------------
-- 64. Person emails (drizzle/0064_presby_person_emails.sql; DECISION-215,
--     DECISION-216, F210, F211, F213, F214; docs/work-log/2026-10-23-person-
--     emails.md Phase 3 "Test plan" Batch 1 and "Staged integration files").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains its section-64 banner
--     and ONE include at its end (staged as
--     scripts/person-emails/test-rls.sql.integration.patch):
--
--         \ir person-emails/test-rls-64.sql
--
--     Standalone (MUST be presby_app - the owner bypasses RLS and holds
--     DELETE by ownership, so as the owner most of this proves nothing):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/person-emails/test-rls-64.sql
--
--     after scripts/install-test-helpers.sql (owner), scripts/seed-dev.sql and
--     scripts/person-emails/seed-dev-person-emails.sql (owner). It uses that
--     fixture's Alder Creek rows (Marisol Windham: ended + Personal main +
--     Work; Tobias Renwick and Priya Balakrishnan: one shared main; Desmond
--     Okonkwo: a do_not_contact main) and scripts/invitations/seed-dev-
--     invitations.sql's open Quillhaven founding-administrator invitation
--     (token qh-fa). Every block that writes ends in rollback, so it writes
--     nothing durable.
--
--     What presby_app CANNOT reach (the guard binding the owner too, the
--     stop-block, the whole file re-applied, the accept-side ended-address
--     sites, a real commit-time refusal) is proven in Vitest:
--     src/lib/db/domain/contact-methods.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P64_ALDER      '\'22222222-2222-2222-2222-222222222222\''
\set P64_BRAMBLE    '\'33333333-3333-3333-3333-333333333333\''
\set P64_QUILL      '\'44444444-4444-4444-4444-444444444444\''
\set P64_MARISOL    '\'c0000000-0000-0000-0000-000000000009\''
\set P64_TOBIAS     '\'c0000000-0000-0000-0000-000000000002\''
\set P64_PRIYA      '\'c0000000-0000-0000-0000-000000000003\''
\set P64_DESMOND    '\'c0000000-0000-0000-0000-000000000004\''
\set P64_ODALYS     '\'c1000000-0000-0000-0000-000000000001\''
\set P64_M_OLD      '\'a6400000-0000-4000-8000-000000000001\''
\set P64_M_MAIN     '\'a6400000-0000-4000-8000-000000000002\''
\set P64_M_WORK     '\'a6400000-0000-4000-8000-000000000003\''

\echo '======================================================'
\echo ' Section 64 (person emails, drizzle/0064) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '64: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: columns, CHECKs, indexes, triggers, functions, grants, RLS.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'contact_methods'
        and ((column_name = 'created_at' and is_nullable = 'NO' and column_default = 'clock_timestamp()')
          or (column_name = 'ended_at' and is_nullable = 'YES' and column_default is null))),
    2, '64a (F210, ER1, D2): created_at NOT NULL default clock_timestamp(); ended_at nullable');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'contact_methods'::regclass and contype = 'c' and convalidated
        and conname in ('contact_methods_kind_check', 'contact_methods_subtype_check',
                        'contact_methods_value_shape', 'contact_methods_ended_not_primary')),
    4, '64a (F213): the four CHECKs exist and are VALIDATED');
  select assert_eq(
    (select count(*) from pg_indexes where tablename = 'contact_methods' and (
          (indexname = 'contact_methods_one_primary_uq' and indexdef like 'CREATE UNIQUE INDEX%(person_id, kind) WHERE (is_primary AND (ended_at IS NULL))')
       or (indexname = 'contact_methods_person_email_uq' and indexdef like 'CREATE UNIQUE INDEX%(person_id, lower(btrim(value))) WHERE ((kind = ''email''::text) AND (ended_at IS NULL))')
       or (indexname = 'contact_methods_email_norm_idx' and indexdef like 'CREATE INDEX%(lower(btrim(value))) WHERE ((kind = ''email''::text) AND (ended_at IS NULL))'))),
    3, '64a (ER15, ER17, S9): the three partial indexes with their predicates');
  select assert_eq(
    (select count(*) from pg_indexes where indexname = 'contact_methods_value_idx'),
    0, '64a (S2): the unused lower(value) index is gone');
  select assert_eq(
    (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'contact_methods'::regclass and t.tgenabled = 'O' and (
            (t.tgname = 'contact_methods_guard_write' and not p.prosecdef and t.tgconstraint = 0
               and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0)
         or (t.tgname = 'contact_methods_primary_required' and p.prosecdef and t.tgdeferrable and t.tginitdeferred
               and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'))),
    2, '64a (ER1c, ER15): the invoker BEFORE INSERT OR UPDATE guard, and the DEFERRABLE INITIALLY DEFERRED definer check (F26)');
  select assert_eq(
    (select count(*) from pg_proc p where p.proname = 'presby_person_email' and not p.prosecdef
        and p.provolatile = 's' and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
        and has_function_privilege('presby_app', p.oid, 'execute')
        and not has_function_privilege('presby_platform', p.oid, 'execute')),
    1, '64a (ER11): the reader is a stable INVOKER with search_path pinned, executable by presby_app, not presby_platform');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_contact_methods_guard_write', 'presby_contact_methods_primary_check')
        and not has_function_privilege('presby_app', p.oid, 'execute')),
    2, '64a: the two trigger functions are not executable by presby_app');
  select assert_eq(
    (select count(*) from unnest(array['presby_app', 'presby_platform']) r
      where has_table_privilege(r, 'contact_methods', 'DELETE')),
    0, '64a (ER1b): neither presby_app nor presby_platform holds DELETE on contact_methods');
  select assert_eq(
    (select count(*) from unnest(array['presby_app', 'presby_platform']) r
      where has_table_privilege(r, 'contact_methods', 'SELECT,INSERT,UPDATE')),
    2, '64a: SELECT, INSERT and UPDATE remain (positive control)');
  select assert_eq(
    (select count(*) from pg_class where relname = 'contact_methods' and relrowsecurity and relforcerowsecurity),
    1, '64a: contact_methods has row level security ENABLED and FORCED (F1), unchanged');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'contact_methods'),
    4, '64a: the same four person-level policies');
  select assert_eq(
    (select sum((length(p.prosrc) - length(replace(p.prosrc, 'ended_at is null', ''))) / length('ended_at is null'))
       from pg_proc p where p.proname in ('presby_preview_invitation', 'presby_accept_invitation')
        and p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'),
    4, '64a (ER3, F211): preview and accept are still pinned definers and carry ended_at at exactly four sites');
  select assert_eq(
    (select count(*) from pg_proc
      where prosrc ilike '%contact_methods%' and prosrc not ilike '%ended_at%'
        and proname <> 'presby_guard_people_delete'),
    0, '64a (ER3b): no function body names contact_methods without naming ended_at');
rollback;

-- ===========================================================================
-- (b) The guard (ER1c, ER1e, F214), as presby_app.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  do $$
  begin
    update contact_methods set value = 'marisol.typo@example.invalid' where id = 'a6400000-0000-4000-8000-000000000002';
    raise exception 'FAIL 64b - presby_app changed an address in place';
  exception when insufficient_privilege then
    raise notice 'pass  64b (ER1c): an in-place value change is refused - an edit ends the row and inserts a replacement';
  end $$;
  do $$
  begin
    update contact_methods set kind = 'phone', value = '555-0164' where id = 'a6400000-0000-4000-8000-000000000003';
    raise exception 'FAIL 64b - presby_app changed kind';
  exception when insufficient_privilege then
    raise notice 'pass  64b (ER1c): kind is immutable';
  end $$;
  do $$
  begin
    update contact_methods set person_id = 'c0000000-0000-0000-0000-000000000004' where id = 'a6400000-0000-4000-8000-000000000003';
    raise exception 'FAIL 64b - presby_app moved an address to another person';
  exception when insufficient_privilege then
    raise notice 'pass  64b (ER1c): person_id is immutable';
  end $$;
  do $$
  begin
    update contact_methods set created_at = '2000-01-01' where id = 'a6400000-0000-4000-8000-000000000003';
    raise exception 'FAIL 64b - presby_app re-dated an address';
  exception when insufficient_privilege then
    raise notice 'pass  64b (D2): created_at is immutable';
  end $$;
  do $$
  begin
    update contact_methods set verified_at = now() where id = 'a6400000-0000-4000-8000-000000000002';
    raise exception 'FAIL 64b - presby_app stamped verified_at';
  exception when insufficient_privilege then
    raise notice 'pass  64b (F214): presby_app cannot set verified_at - only the acceptance definer proves an address';
  end $$;
  do $$
  begin
    insert into contact_methods (person_id, kind, value, verified_at)
    values ('c0000000-0000-0000-0000-000000000009', 'email', 'pre.verified@example.invalid', now());
    raise exception 'FAIL 64b - presby_app inserted a verified address';
  exception when insufficient_privilege then
    raise notice 'pass  64b (F214): nor insert one already verified';
  end $$;
  do $$
  begin
    insert into contact_methods (person_id, kind, value, ended_at)
    values ('c0000000-0000-0000-0000-000000000009', 'email', 'born.ended@example.invalid', now());
    raise exception 'FAIL 64b - presby_app inserted an ended row';
  exception when insufficient_privilege then
    raise notice 'pass  64b (ER1c): a new address starts active';
  end $$;
  do $$
  begin
    update contact_methods set subtype = 'work' where id = 'a6400000-0000-4000-8000-000000000001';
    raise exception 'FAIL 64b - presby_app relabelled an ended row';
  exception when insufficient_privilege then
    raise notice 'pass  64b (ER1c): an ended row is frozen';
  end $$;
  do $$
  begin
    update contact_methods set ended_at = null where id = 'a6400000-0000-4000-8000-000000000001';
    raise exception 'FAIL 64b - presby_app un-ended a row';
  exception when insufficient_privilege then
    raise notice 'pass  64b (ER1c): an ended row cannot be un-ended';
  end $$;

  -- D2: a backdated created_at is overwritten with clock_timestamp().
  insert into contact_methods (person_id, kind, value, created_at)
  values (:P64_MARISOL, 'email', 'backdated.p64@example.invalid', '2000-01-01');
  select assert_eq(
    (select count(*) from contact_methods where value = 'backdated.p64@example.invalid' and created_at >= now()),
    1, '64b (D2): presby_app cannot backdate created_at to win "promote the oldest"');

  -- Positive control: the legal in-place changes.
  update contact_methods set subtype = 'other', do_not_contact = true where id = :P64_M_WORK;
  select assert_eq(
    (select count(*) from contact_methods where id = :P64_M_WORK and subtype = 'other' and do_not_contact),
    1, '64b (ER1e): label and do_not_contact change in place (positive control)');
rollback;

-- ===========================================================================
-- (c) DELETE is revoked (ER1b).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  select assert_eq((select count(*) from contact_methods where id = :P64_M_WORK), 1,
    '64c: the row is visible to presby_app at Alder Creek (so a refusal is the grant, not RLS)');
  do $$
  begin
    delete from contact_methods where id = 'a6400000-0000-4000-8000-000000000003';
    raise exception 'FAIL 64c - presby_app deleted a contact row';
  exception when insufficient_privilege then
    raise notice 'pass  64c (ER1b): delete is refused - removal is ended_at';
  end $$;
rollback;

-- ===========================================================================
-- (d) Exactly one active main (ER1d, ER15) and one row per address (ER17).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  do $$
  begin
    insert into contact_methods (person_id, kind, value, is_primary)
    values ('c0000000-0000-0000-0000-000000000009', 'email', 'second.main@example.invalid', true);
    raise exception 'FAIL 64d - a second active main email was accepted';
  exception when unique_violation then
    raise notice 'pass  64d (ER15): a second active main email is refused (contact_methods_one_primary_uq)';
  end $$;
  insert into contact_methods (person_id, kind, value, is_primary) values (:P64_MARISOL, 'phone', '555-0164', true);
  do $$
  begin
    insert into contact_methods (person_id, kind, value, is_primary)
    values ('c0000000-0000-0000-0000-000000000009', 'phone', '555-0165', true);
    raise exception 'FAIL 64d - a second active main phone was accepted';
  exception when unique_violation then
    raise notice 'pass  64d (ER15): and a second active main phone';
  end $$;
  do $$
  begin
    update contact_methods set ended_at = now() where id = 'a6400000-0000-4000-8000-000000000002';
    raise exception 'FAIL 64d - an ended row stayed the main address';
  exception when check_violation then
    raise notice 'pass  64d (ER1d): an ended row cannot be primary (contact_methods_ended_not_primary)';
  end $$;
  do $$
  begin
    insert into contact_methods (person_id, kind, value)
    values ('c0000000-0000-0000-0000-000000000009', 'email', 'marisol.windham@example.invalid');
    raise exception 'FAIL 64d - the same active address twice for one person was accepted';
  exception when unique_violation then
    raise notice 'pass  64d (ER17): one active row per (person, address)';
  end $$;
  -- Re-adding an ENDED address is a new row (resurrection starts unverified).
  insert into contact_methods (person_id, kind, value) values (:P64_MARISOL, 'email', 'marisol.windham.old@example.invalid');
  select assert_eq(
    (select count(*) from contact_methods where person_id = :P64_MARISOL
        and value = 'marisol.windham.old@example.invalid' and ended_at is null and verified_at is null),
    1, '64d (ER17): an ended address may be re-added, as a new unverified row');
  select assert_eq(
    (select count(distinct person_id) from contact_methods
      where value = 'renwick.balakrishnan@example.invalid' and ended_at is null and is_primary),
    2, '64d (ER17): two people may share an address (the household pair), each as their main');
rollback;

-- The deferred "at least one main" check, forced with SET CONSTRAINTS.
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  update contact_methods set is_primary = false where id = :P64_M_MAIN;
  do $$
  begin
    set constraints contact_methods_primary_required immediate;
    raise exception 'FAIL 64d - a person was left with active emails and no main';
  exception when check_violation then
    raise notice 'pass  64d (ER15): active emails with no main are refused (deferred check)';
  end $$;
rollback;
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  -- The legal order: demote (or end) first, then promote; one main at commit.
  update contact_methods set is_primary = false, ended_at = now() where id = :P64_M_MAIN;
  update contact_methods set is_primary = true where id = :P64_M_WORK;
  set constraints contact_methods_primary_required immediate;
  select assert_eq(
    (select count(*) from contact_methods where person_id = :P64_MARISOL and kind = 'email'
        and ended_at is null and is_primary),
    1, '64d (ER15, ER19a): end-the-main-then-promote passes the deferred check (positive control)');
rollback;
-- F26: the check must count rows presby_app cannot see. A person with no
-- membership anywhere (createPerson's pre-membership window, D11): the insert
-- policy admits their contact row, the read policy shows none.
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  insert into people (id, first_name, last_name) values ('a6400000-0000-4000-8000-0000000000f1', 'Unclaimed', 'Probe');
  insert into contact_methods (person_id, kind, value, is_primary)
  values ('a6400000-0000-4000-8000-0000000000f1', 'email', 'unclaimed.probe@example.invalid', false);
  select assert_eq(
    (select count(*) from contact_methods where person_id = 'a6400000-0000-4000-8000-0000000000f1'),
    0, '64d (F26): presby_app cannot see the row it just wrote (no membership yet)');
  do $$
  begin
    set constraints contact_methods_primary_required immediate;
    raise exception 'FAIL 64d - the deferred check missed a row RLS hides (it must be SECURITY DEFINER, F26)';
  exception when check_violation then
    raise notice 'pass  64d (F26): the definer check still counts it and refuses a non-main first address';
  end $$;
rollback;

-- ===========================================================================
-- (e) The reader presby_person_email (ER11, ER12).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P64_ALDER, true);
  select assert_eq(
    (select count(*) from presby_person_email(:P64_MARISOL, 'credential')
      where contact_method_id = :P64_M_MAIN and address = 'marisol.windham@example.invalid'),
    1, '64e (ER12): credential is the active main');
  select assert_eq(
    (select count(*) from presby_person_email(:P64_MARISOL, 'role')
      where contact_method_id = :P64_M_WORK and subtype = 'work'),
    1, '64e (ER12): role prefers the active Work address');
  select assert_eq(
    (select count(*) from presby_person_email(:P64_MARISOL, 'personal')
      where contact_method_id = :P64_M_MAIN),
    1, '64e (ER12): personal never takes a Work address');
  select assert_eq(
    (select count(*) from unnest(array['credential', 'role', 'personal']) p, presby_person_email(:P64_MARISOL, p) r
      where r.contact_method_id = :P64_M_OLD),
    0, '64e: the ended address is never returned');
  select assert_eq(
    (select count(*) from presby_person_email(:P64_DESMOND, 'credential') where do_not_contact),
    1, '64e (ER12): credential RETURNS a do_not_contact main (the caller acknowledges)');
  select assert_eq(
    (select count(*) from presby_person_email(:P64_DESMOND, 'role'))
      + (select count(*) from presby_person_email(:P64_DESMOND, 'personal')),
    0, '64e (ER12): role and personal skip it');
  do $$
  begin
    perform * from presby_person_email('c0000000-0000-0000-0000-000000000009', 'newsletter');
    raise exception 'FAIL 64e - an unknown purpose was accepted';
  exception when internal_error then
    raise notice 'pass  64e (R35): an unknown purpose raises internal_error';
  end $$;

  -- Invoker: authority comes from RLS, not the function.
  select set_config('app.current_org_id', :P64_BRAMBLE, true);
  select assert_eq(
    (select count(*) from presby_person_email(:P64_MARISOL, 'credential')),
    0, '64e (ER11): under another organization''s context the reader sees nothing (invoker, no authority added)');
rollback;

-- ===========================================================================
-- (f) An ended address is not on file: the preview site (F211). The accept
--     sites need an account and a person write; they are proven in Vitest.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P64_QUILL, true);
  insert into contact_methods (person_id, kind, value)
  values (:P64_ODALYS, 'email', 'invite.founding.quillhaven@example.invalid');
  select assert_eq(
    (select count(*) from presby_preview_invitation('seed-dev-invitation-qh-fa-00000000000000000')
      where person_display_name = 'Odalys Winterbourne'),
    1, '64f: an ACTIVE matching address names the roster person in the preview (positive control)');
  update contact_methods set ended_at = now()
   where person_id = :P64_ODALYS and value = 'invite.founding.quillhaven@example.invalid';
  select assert_eq(
    (select count(*) from presby_preview_invitation('seed-dev-invitation-qh-fa-00000000000000000')
      where person_display_name = 'Wilhelmina Thorncastle'),
    1, '64f (F211): once ENDED it does not - the preview falls back to the invitee''s own name');
rollback;

\echo '======================================================'
\echo ' Section 64 (person emails) complete.'
\echo '======================================================'
