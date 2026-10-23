-- db-baseline.sql - state the DB-backed vitest suite assumes exists, which a
-- database built from empty (migrate + seed + seed-dev.sql) does not have.
--
-- One active platform admin. src/lib/domains/notify.ts adds every active
-- platform admin to a domain notification's recipients, and
-- src/lib/domains/sweep.db.test.ts asserts "recipients.size > 0" while its
-- fixture people have no linked account, so the assertion has only ever held
-- on the long-lived development branch, where an operator exists. On CI's
-- fresh database it failed (first sharded run, 2026-10-23).
--
-- Applied by db.yml's shard jobs only, on the throwaway branch, as the owner.
-- Deliberately NOT applied to the isolation-suite job: scripts/test-rls.sql
-- asserts exact counts against migrate + seed + fixture alone.
-- example.invalid is the house convention (No Real Data); no password, so the
-- row cannot sign in.
insert into users (email, name, is_platform_admin, is_active, two_factor_required)
values ('ci-platform-admin@example.invalid', 'CI Platform Admin', true, true, false)
on conflict (email) do nothing;
