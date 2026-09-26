-- install-test-helpers.sql — the assertion helper scripts/test-rls.sql calls.
--
-- WHY THIS FILE EXISTS NOW AND NOT BEFORE. `scripts/test-rls.sql:105` has
-- always said "assert_eq() is installed by the owner (see
-- scripts/install-test-helpers.sql); presby_app only calls it" — and that
-- file did not exist in the repository. `assert_eq()` was present on every
-- live Neon branch (owner `neondb_owner`, `presby_app=X` in its ACL) because
-- somebody created it by hand once, long ago, and every branch since has
-- inherited it by fork.
--
-- That is the SAME drift class `drizzle/0050_presby_schema_parity.sql` and
-- `npm run check:schema-parity` exist to close — a database object present on
-- every live branch and in no committed file — found on 2026-09-26 by the
-- from-scratch rehearsal this pipeline made its acceptance criterion
-- (docs/work-log/2026-09-26-ci-db-tests.md, Phase 4 Batch A). On a database
-- created from empty, `psql -f scripts/test-rls.sql` aborts at its FIRST
-- assertion with `function assert_eq(bigint, integer, unknown) does not
-- exist`, 0 of 520 assertions run, exit 3. The parity check could not have
-- caught this one: it compares tables and columns, not functions.
--
-- DELIBERATELY NOT A MIGRATION. This is test scaffolding, not schema. A
-- `drizzle/00XX_*.sql` file ships into production, and production has no
-- business carrying an assertion helper. It is applied by whoever is about to
-- run the isolation suite, exactly as test-rls.sql's own comment describes.
--
-- HOW TO APPLY (owner, direct/unpooled endpoint — the suite itself must then
-- run as presby_app, never the owner):
--
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql
--   psql "$APP_DATABASE_URL"     -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
--
-- Idempotent: `create or replace` throughout, and the grant is a no-op when
-- already held. Safe to run before every suite invocation, which is what CI
-- should do.

-- ---------------------------------------------------------------------------
-- assert_eq(actual, expected, label)
--
-- Raises on mismatch so that `psql -v ON_ERROR_STOP=1` aborts the run with a
-- non-zero exit code; emits `pass  <label> (<actual>)` otherwise, which is the
-- line the suite's own pass count is grepped from.
--
-- bigint-only on purpose — there is no boolean overload, and test-rls.sql:1159
-- already documents that every boolean check in the suite is written as a
-- count. Reproduced verbatim from the live `pg_get_functiondef()` output on
-- the development lineage (2026-09-26) so installing this file changes
-- nothing on a database that already had the hand-made copy.
-- ---------------------------------------------------------------------------
create or replace function public.assert_eq(actual bigint, expected bigint, label text)
returns void
language plpgsql
as $function$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'pass  % (%)', label, actual;
end $function$;

-- The suite runs as presby_app. EXECUTE is granted to PUBLIC by default for a
-- new function, but state it explicitly rather than rely on a default that a
-- future `revoke execute on all functions ... from public` would silently
-- remove.
grant execute on function public.assert_eq(bigint, bigint, text) to presby_app;
