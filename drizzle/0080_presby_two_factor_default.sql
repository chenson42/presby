-- drizzle/0080_presby_two_factor_default.sql
--
-- Two-factor is role-based (F343; DECISION-291). A new account is no longer
-- required to use two-factor just for existing: users.two_factor_required
-- defaults to false, and the requirement comes from a role, a congregation or
-- the person's own setting. Three changes, no function body touched:
--   1. users.two_factor_required defaults to false. NO existing row is
--      updated (operator ruling 2026-10-26: existing accounts keep their
--      value). A constant default is metadata-only: no table rewrite.
--   2. roles.manage, role_grants.manage and domains.manage carry
--      permissions.requires_two_factor, so arm B of presby_two_factor_required()
--      (drizzle/0055 section 18), which reads the flag live, covers founding
--      administrators and anyone else granted them. Six flagged keys in all.
--      No DECISION-175-style commission/delegation trigger: that guard exists
--      for giving privacy; a 2FA flag only ADDS a challenge (Phase 2 R1(d);
--      supersedes the 0057 "T7 / TODO S3" deferral).
--   3. The column comments on users.two_factor_required (none existed) and
--      permissions.requires_two_factor, and the function comment on
--      presby_two_factor_required(uuid), restated to match. The function body,
--      its grants, and the F140 md5 pin on presby_effective_permissions() are
--      untouched.
-- The platform-administrator half (the grant points switching a person's own
-- column on, audited) is application code: src/lib/auth/platform-role-two-factor.ts.
-- (docs/work-log/2026-10-26-2fa-default.md: Phase 2 R1, Phase 3 "Data Model".)
--
-- Apply (owner, direct endpoint; DDL needs it). `-1` makes the count guard's
-- refusal roll everything back; the file has no transaction of its own:
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0080_presby_two_factor_default.sql
--
-- Idempotent: `set default` and `comment on` restate the same value; the
-- update is guarded by `and not requires_two_factor`, so a replay writes no
-- row; both guards only read. Proven by applying the whole file twice
-- (work-log, Phase 4 database section). Unreleased until applied to
-- production, so it may be corrected in place until then (CLAUDE.md ->
-- Project Layout -> drizzle/).
--
-- Production counts (read-only, orchestrator, 2026-10-26; Phase 2 R8): one
-- active holder of the three keys, none newly required by flagging them
-- (0 not enrolled); one platform-role holder, already required. Re-run both
-- R8 queries on deploy day and record only the numbers.
--
-- DEPLOY ORDER: apply this file, then promote the code in the same sitting.
-- Between the two steps the old code runs against the new default, so a
-- platform role granted (or an INITIAL_ADMIN_EMAILS first sign-in) in that
-- window would not switch the person's own setting on. Grant no platform role
-- between the two steps.
--
-- ROLLBACK is a forward migration, never an edit of this file once shipped:
--   alter table users alter column two_factor_required set default true;
--   update permissions set requires_two_factor = false
--    where key in ('roles.manage','role_grants.manage','domains.manage');
-- Accounts created after 0080 keep false, so a rollback also needs a decision
-- about those rows.

-- ---------------------------------------------------------------------------
-- 1. The column default (no row is touched)
-- ---------------------------------------------------------------------------
alter table users alter column two_factor_required set default false;

comment on column users.two_factor_required is
  'Two-factor requirement set on this account itself. Defaults to false (DECISION-291): a new account is required only through a role or a congregation, which presby_two_factor_required() evaluates separately. The platform-role grant points (src/lib/auth/platform-role-two-factor.ts) set it true and audit it; an administrator can switch it off on the user page, which does not release a role or congregation requirement. Migration 0080 changed the default only, never an existing row.';

-- ---------------------------------------------------------------------------
-- 2. The catalog: guard, flag, post-check
-- ---------------------------------------------------------------------------
-- A database missing 0018 (role_grants.manage), 0032 (roles.manage) or 0057
-- (domains.manage) must fail loudly here, not flag two keys and succeed.
do $$
declare
  n int;
begin
  select count(*) into n from permissions
   where key in ('roles.manage','role_grants.manage','domains.manage');
  if n <> 3 then
    raise exception '0080: expected 3 catalog rows (0018, 0032, 0057), found %', n;
  end if;
end $$;

update permissions set requires_two_factor = true
 where key in ('roles.manage','role_grants.manage','domains.manage') and not requires_two_factor;

do $$
declare
  n int;
begin
  select count(*) into n from permissions
   where requires_two_factor and key in ('roles.manage','role_grants.manage','domains.manage');
  if n <> 3 then
    raise exception '0080: the three keys are not all flagged (%)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Comment refreshes (no body change)
-- ---------------------------------------------------------------------------
comment on column permissions.requires_two_factor is
  'When true, holding this key at any active membership requires 2FA at sign-in (read by presby_two_factor_required(); DECISION-170/175). Six keys set it: giving.view, giving.record, giving.manage (0055) and roles.manage, role_grants.manage, domains.manage (0080; DECISION-291). Extending it further is a tracked follow-up (S2).';

comment on function presby_two_factor_required(uuid) is
  'True when (A) any organization the user holds an active membership in requires two-factor authentication, or (B) the user''s live person effectively holds, at any active membership, a key with permissions.requires_two_factor (any flagged key: the three giving keys and roles.manage, role_grants.manage, domains.manage; DECISION-170/175/291). Arm B mirrors presby_effective_permissions()''s four arms inline (F140; agreement and md5 drift pin in scripts/giving/test-rls-46.sql). SECURITY DEFINER: runs at sign-in with no org GUC set (F26).';
