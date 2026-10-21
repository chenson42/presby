-- ---------------------------------------------------------------------------
-- 59. Account invitations (drizzle/0059_presby_account_invitations.sql;
--     DECISION-183/184/188, F153-F159; docs/work-log/2026-10-21-invitations.md
--     Phase 3 "Staged test assets").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner:
--
--         \ir invitations/test-rls-59.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/invitations/test-rls-59.sql
--
--     after scripts/install-test-helpers.sql (owner) and
--     scripts/invitations/seed-dev-invitations.sql (owner; merged into
--     scripts/seed-dev.sql at integration). presby_app holds NO privilege on
--     account_invitations, so the seeded rows (known tokens) are the only
--     invitations this suite can name. Every block that could write ends in
--     rollback, so it writes nothing durable.
--
--     Sections (a)-(g). What presby_app CANNOT reach is proven on the owner
--     connection in Vitest instead (src/lib/db/domain/invitations.db.test.ts):
--       - the guards on the OWNER path (rows born open; the marker-less
--         accept and blocked transitions refused for neondb_owner; identity
--         immutable; terminal one-way; the delete guard and its cascade; the
--         resend chain, D-1);
--       - every accept outcome and blocked reason, the late trigger refusals
--         through the real guards (D-5), concurrency, and the parity with the
--         TypeScript designation (src/lib/onboarding/designation-parity.db.test.ts).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set QH_FA      '\'seed-dev-invitation-qh-fa-00000000000000000\''
\set QH_TR      '\'seed-dev-invitation-qh-tr-00000000000000000\''
\set MB_EXPIRED '\'seed-dev-invitation-mb-fa-expired-000000000\''
\set FW_REVOKED '\'seed-dev-invitation-fw-fa-revoked-000000000\''
\set FW_SUPER   '\'seed-dev-invitation-fw-fa-superseded-000000\''
\set FW_RESENT  '\'seed-dev-invitation-fw-fa-resent-0000000000\''
\set BCRYPT     '\'$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\''

\echo '======================================================'
\echo ' Section 59 (account invitations, drizzle/0059) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '59: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: FORCE RLS, the one policy, the composite keys, the guards,
--     the function surface.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'account_invitations' and relkind = 'r'
        and relrowsecurity and relforcerowsecurity),
    1, '59a: account_invitations has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'account_invitations' and policyname = 'tenant_isolation'
        and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    1, '59a: tenant_isolation carries BOTH using and with check on presby_current_org()');
  select assert_eq((select count(*) from pg_policies where tablename = 'account_invitations'),
    1, '59a: and no other policy');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'account_invitations'::regclass and c.contype = 'u'
        and c.conname = 'account_invitations_id_org_key'),
    1, '59a: unique (id, organization_id) - Composite Tenant Keys (F2)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'account_invitations'::regclass and c.contype = 'f'
        and c.conname in ('account_invitations_person_membership_fk', 'account_invitations_resent_from_fk')
        and array_length(c.conkey, 1) = 2),
    2, '59a: the person key (-> memberships) and the resend self-key are COMPOSITE (F2)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'account_invitations'::regclass and c.contype = 'f' and array_length(c.conkey, 1) = 1
        and c.confrelid <> 'users'::regclass and c.confrelid <> 'organizations'::regclass),
    0, '59a: every single-column FK targets users or organizations only (no plain tenant-to-tenant FK)');
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid = 'account_invitations'::regclass and not t.tgisinternal and t.tgenabled = 'O'
        and t.tgname in ('account_invitations_guard_insert', 'account_invitations_guard_update',
                         'account_invitations_guard_delete')
        and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2),
    3, '59a: the three BEFORE ROW guards exist and are ENABLED - they bind the owner too (F44)');
  select assert_eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) = 'neondb_owner'
        and p.proname in ('presby_founding_administrator_holder_count', 'presby_giving_manage_holder_count',
                          'presby_founding_administrator_permission_keys', 'presby_apply_founding_administrator',
                          'presby_apply_treasurer', 'presby_preview_invitation', 'presby_accept_invitation')
        and p.proconfig = array['search_path=public, pg_temp']),
    7, '59a: all seven functions are SECURITY DEFINER, owned by neondb_owner, search_path pinned (DECISION-148)');
rollback;

-- ===========================================================================
-- (b) presby_app holds NO table privilege: it cannot read, write or delete.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES')) v(p)
      where has_table_privilege('account_invitations', v.p)),
    0, '59b: presby_app holds no privilege of any kind on account_invitations (DECISION-171 inbox posture)');
rollback;

begin;
  select set_config('app.current_org_id', '44444444-4444-4444-4444-444444444444', true);
  do $$
  begin
    perform 1 from account_invitations;
    raise exception 'FAIL 59b - presby_app read account_invitations';
  exception when insufficient_privilege then
    raise notice 'pass  59b: presby_app SELECT refused even with an org context (permission denied)';
  end $$;
  do $$
  begin
    insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
           invitee_last_name, token_hash, created_by_user_id, expires_at)
    values ('44444444-4444-4444-4444-444444444444', 'founding_administrator', 'x@example.invalid', 'A', 'B',
            repeat('0', 64), 'e0000000-0000-0000-0000-0000000000f2', now() + interval '1 day');
    raise exception 'FAIL 59b - presby_app inserted an invitation';
  exception when insufficient_privilege then
    raise notice 'pass  59b: presby_app INSERT refused';
  end $$;
  do $$
  begin
    -- Arming the marker is not enough: the grant refuses first (grant plus marker, DECISION-141).
    perform set_config('presby.invitation_accept_active', 'true', true);
    update account_invitations set blocked_at = now(), blocked_reason = 'has_holders';
    raise exception 'FAIL 59b - presby_app updated an invitation';
  exception when insufficient_privilege then
    raise notice 'pass  59b: presby_app UPDATE refused, even with the accept marker self-armed';
  end $$;
  do $$
  begin
    delete from account_invitations;
    raise exception 'FAIL 59b - presby_app deleted invitations';
  exception when insufficient_privilege then
    raise notice 'pass  59b: presby_app DELETE refused';
  end $$;
rollback;

-- ===========================================================================
-- (c) presby_app EXECUTEs exactly preview and accept; the single sources, the
--     apply helpers and the guards are not executable by presby_app or PUBLIC.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from (values ('presby_preview_invitation(text,uuid)'),
                                  ('presby_accept_invitation(text,uuid,text,text,text)')) v(f)
      where has_function_privilege(v.f::regprocedure, 'EXECUTE')),
    2, '59c: presby_app may EXECUTE presby_preview_invitation and presby_accept_invitation');
  select assert_eq(
    (select count(*) from (values ('presby_founding_administrator_holder_count(uuid)'),
                                  ('presby_giving_manage_holder_count(uuid)'),
                                  ('presby_founding_administrator_permission_keys(text)'),
                                  ('presby_apply_founding_administrator(uuid,uuid,uuid)'),
                                  ('presby_apply_treasurer(uuid,uuid,uuid)'),
                                  ('presby_account_invitations_guard_insert()'),
                                  ('presby_account_invitations_guard_update()'),
                                  ('presby_account_invitations_guard_delete()')) v(f)
      where has_function_privilege(v.f::regprocedure, 'EXECUTE')),
    0, '59c: and nothing else (a cross-org holder count is an oracle; the apply helpers are internal)');
  select assert_eq(
    (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.proname in ('presby_founding_administrator_holder_count', 'presby_giving_manage_holder_count',
                          'presby_founding_administrator_permission_keys', 'presby_apply_founding_administrator',
                          'presby_apply_treasurer', 'presby_preview_invitation', 'presby_accept_invitation',
                          'presby_account_invitations_guard_insert', 'presby_account_invitations_guard_update',
                          'presby_account_invitations_guard_delete')
        and a.grantee = 0),
    0, '59c: PUBLIC executes none of the ten functions');
rollback;

begin;
  do $$
  begin
    perform presby_giving_manage_holder_count('44444444-4444-4444-4444-444444444444');
    raise exception 'FAIL 59c - presby_app called the owner-only holder count';
  exception when insufficient_privilege then
    raise notice 'pass  59c: presby_giving_manage_holder_count refused (permission denied)';
  end $$;
  do $$
  begin
    perform * from presby_apply_founding_administrator('44444444-4444-4444-4444-444444444444',
                                                       'c1000000-0000-0000-0000-000000000001',
                                                       'e0000000-0000-0000-0000-0000000000f2');
    raise exception 'FAIL 59c - presby_app called an apply helper directly';
  exception when insufficient_privilege then
    raise notice 'pass  59c: presby_apply_founding_administrator refused (permission denied)';
  end $$;
rollback;

-- ===========================================================================
-- (d) Positive control first, so (e)'s zero rows cannot be vacuous: a live
--     seeded token previews as one row, the address masked in SQL.
-- ===========================================================================
begin;
  select assert_eq((select count(*) from presby_preview_invitation(:QH_FA)),
    1, '59d: POSITIVE CONTROL - the live Quillhaven founding-administrator token previews as one row');
  select assert_eq(
    (select count(*) from presby_preview_invitation(:QH_FA)
      where masked_email = 'i***@example.invalid' and session_matches is null
        and purpose = 'founding_administrator' and organization_type = 'congregation'
        and person_display_name = 'Wilhelmina Thorncastle'),
    1, '59d: the address is masked in SQL (DECISION-153); session_matches is null with no session (S1)');
  select assert_eq((select count(*) from presby_preview_invitation(:QH_TR)),
    1, '59d: the live Quillhaven treasurer token previews as one row');
  select assert_eq((select count(*) from presby_preview_invitation(:FW_RESENT)),
    1, '59d: the live Fernwood resend previews as one row');
rollback;

-- ===========================================================================
-- (e) The dead bucket (DECISION-147): every non-live state is ZERO preview
--     rows and ONE accept row 'dead' with every other column null - for an
--     unknown token, the empty string, an expired, a revoked and a superseded
--     row, and for a live row named by its stored HASH (R5: the hash confers
--     nothing).
-- ===========================================================================
begin;
  create temporary table t59_dead (label text, token text) on commit drop;
  insert into t59_dead values
    ('unknown', 'seed-dev-invitation-does-not-exist-0000000'),
    ('empty', ''),
    ('expired', :MB_EXPIRED),
    ('revoked', :FW_REVOKED),
    ('superseded', :FW_SUPER),
    ('the stored hash of a live token (R5)', encode(sha256(convert_to(:QH_FA, 'UTF8')), 'hex'));

  select assert_eq(
    (select count(*) from t59_dead d, lateral presby_preview_invitation(d.token) p),
    0, '59e: every dead state previews as ZERO rows (six tokens)');
  select assert_eq(
    (select count(*) from t59_dead d, lateral presby_accept_invitation(d.token, null, :BCRYPT, 'Dead', 'Link') a
      where a.outcome = 'dead'
        and num_nonnulls(a.blocked_reason, a.invitation_id, a.organization_id, a.organization_slug, a.purpose,
                         a.mode, a.user_id, a.person_id, a.person_mode, a.created_by_user_id,
                         a.inviter_is_invitee, a.administration_role_key, a.office_role_key,
                         a.permission_keys, a.treasurer_role_id) = 0),
    6, '59e: every dead state is ONE row, outcome dead, every other column null (new-account mode)');
  select assert_eq(
    (select count(*) from t59_dead d,
            lateral presby_accept_invitation(d.token, 'e0000000-0000-0000-0000-0000000000f2', null, null, null) a
      where a.outcome = 'dead'
        and num_nonnulls(a.blocked_reason, a.invitation_id, a.organization_id, a.user_id, a.person_id) = 0),
    6, '59e: and the same in existing-account mode (identity-uniform: no account is consulted for a dead token)');
  select assert_eq((select count(*) from presby_accept_invitation(null, null, :BCRYPT, 'A', 'B') where outcome = 'dead'),
    1, '59e: a null token is dead too');
rollback;

-- The dead states were not consumed or altered by being named.
begin;
  select assert_eq((select count(*) from presby_preview_invitation(:QH_FA)),
    1, '59e: the live token named by its hash above is still live');
rollback;

-- ===========================================================================
-- (f) The acceptance path works for presby_app with NO org GUC (positive
--     control for the function-mediated write; rolled back).
-- ===========================================================================
begin;
  select assert_eq((select count(*) from pg_settings where name = 'app.current_org_id' and coalesce(setting, '') <> ''),
    0, '59f: no org context is set for this block');
  select assert_eq(
    (select count(*) from presby_accept_invitation(:QH_FA, null, :BCRYPT, 'Wilhelmina', 'Thorncastle')
      where outcome = 'accepted' and mode = 'new_account' and person_mode = 'created_person'
        and organization_slug = 'quillhaven' and administration_role_key = 'founding_administrator'
        and office_role_key = 'congregation_stated_clerk' and inviter_is_invitee = false),
    1, '59f: presby_app accepts a live founding-administrator invitation through the definer, no GUC');
  select assert_eq((select count(*) from presby_preview_invitation(:QH_FA)),
    0, '59f: inside the same transaction the token is now consumed (single use)');
  select assert_eq(
    (select count(*) from presby_accept_invitation(:QH_FA, null, :BCRYPT, 'Wilhelmina', 'Thorncastle') where outcome = 'dead'),
    1, '59f: a second acceptance is dead');
rollback;

begin;
  -- Odalys Winterbourne already has a login at her on-file address, so a
  -- new-account acceptance is the non-terminal account_exists, writing nothing.
  select assert_eq(
    (select count(*) from presby_accept_invitation(:QH_TR, null, :BCRYPT, 'Odalys', 'Winterbourne')
      where outcome = 'account_exists' and invitation_id is null),
    1, '59f: treasurer token, new-account mode, existing login -> account_exists (non-terminal)');
  select assert_eq((select count(*) from presby_preview_invitation(:QH_TR)),
    1, '59f: and the token is still live');
rollback;

-- ===========================================================================
-- (g) The preview's session match never needs the full address: true for the
--     invited login (case-insensitive), false for any other.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from presby_preview_invitation(:QH_TR,
              (select p.user_id from people p where false)) where session_matches is null),
    1, '59g: a null session reads no users row and reports null');
  select assert_eq(
    (select count(*) from presby_preview_invitation(:QH_TR, 'e0000000-0000-0000-0000-0000000000f2')
      where session_matches = false),
    1, '59g: another login (the elder fixture) -> session_matches false');
rollback;

\echo '======================================================'
\echo ' Section 59 complete.'
\echo '======================================================'
