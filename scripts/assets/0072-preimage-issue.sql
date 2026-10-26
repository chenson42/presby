-- scripts/assets/0072-preimage-issue.sql - D5 step 2, second half
-- (docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3 "Test Plan"
-- D5). Runs on a presby_app LOGIN to the scratch database (the owner holds
-- presby_app membership without the SET option, so `set role` is refused, and
-- a real login is the honest application path anyway), after
-- 0072-preimage.sql. Driven by scripts/assets/test-0072-migration.sh.
--
-- Issues ONE contribution statement through the section-46 harness
-- (scripts/giving/test-rls-46-issue.sql), exactly as test-rls-46.sql 46p does:
-- the PDF stored as store() writes it, the header and lines in one
-- statement, the deferred consistency checks forced, and then COMMITTED, so
-- 0072 meets a real issued statement.
\set ON_ERROR_STOP on
\set ALDER          '\'22222222-2222-2222-2222-222222222222\''
\set PRIYA          '\'c0000000-0000-0000-0000-000000000003\''
\set U_FOUNDING     '\'e0000000-0000-0000-0000-0000000000f5\''
\set G_DONOR_LINDEN '\'d9100000-0000-0000-0000-000000000040\''

select assert_eq((select count(*) from pg_roles where rolname = current_user and current_user = 'presby_app'),
  1, 'p72: (preimage) the statement is issued on a presby_app login');

begin;
select set_config('app.current_org_id', :ALDER, true);
update people set user_id = :U_FOUNDING where id = :PRIYA;
select set_config('rls_test.s_org', :ALDER, true);
select set_config('rls_test.s_issuer', :U_FOUNDING, true);
select set_config('rls_test.s_year', '2025', true);
select set_config('rls_test.s_donor', :G_DONOR_LINDEN, true);
select set_config('rls_test.s_label', 'p72: (preimage) the treasurer issues Linden Marsh''s 2025 statement', true);
\ir ../giving/test-rls-46-issue.sql
commit;
