-- ---------------------------------------------------------------------------
-- 65. Sign-in invitations, address proof, accept in place and auto-connect
--     (drizzle/0065_presby_sign_in_and_connect.sql; DECISION-207 and -208 as
--     amended, DECISION-225 to -228; F186, F187, F196, F197, F230, F232,
--     F233; docs/work-log/2026-10-22-founding-admin-directory.md, "Phase 3
--     amendment 2" section 8.2).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains its section-65 banner
--     and ONE include at its end (staged as
--     scripts/sign-in-invitations/test-rls.sql.integration.patch, which also
--     converts section 44's presby_app link writes that F186 now refuses):
--
--         \ir sign-in-invitations/test-rls-65.sql
--
--     Standalone (MUST be presby_app - the owner bypasses every guard this
--     proves, F44):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sign-in-invitations/test-rls-65.sql
--
--     after scripts/install-test-helpers.sql (owner), scripts/seed-dev.sql,
--     scripts/invitations/seed-dev-invitations.sql and
--     scripts/sign-in-invitations/seed-dev-sign-in.sql (owner). It uses that
--     fixture's Hollinbrook rows (a sender holding people.manage and
--     officers.manage; two elders; a member; a visitor; a shared address; two
--     open sign_in invitations with known tokens; people at an unmanaged and
--     at two organizations) and seed-dev-invitations.sql's open Quillhaven
--     founding-administrator invitation (token qh-fa). Every block that writes
--     ends in rollback, so it writes nothing durable.
--
--     What presby_app CANNOT reach (the second non-owner role, the owner-path
--     behaviour of both new triggers, the stop-blocks, the stale-proof
--     clean-up, concurrency and lock order, the whole-file re-apply, the
--     live-catalog scans) is proven in Vitest: email-proof, sign-in-
--     invitations, sign-in-accept, sign-in-standing, connect, accept-in-place
--     (src/lib/db/domain/*.db.test.ts) and designation-parity(-in-place).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set H65_ORG       '\'65000000-0000-4000-8000-000000000001\''
\set H65_ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set H65_SENDER    '\'e6500000-0000-4000-8000-0000000000a0\''
\set H65_ROSALIND  '\'c6500000-0000-4000-8000-000000000001\''
\set H65_BENEDIKT  '\'c6500000-0000-4000-8000-000000000002\''
\set H65_CLEM      '\'c6500000-0000-4000-8000-000000000003\''
\set H65_THADDEUS  '\'c6500000-0000-4000-8000-000000000004\''
\set H65_HONORIA   '\'c6500000-0000-4000-8000-000000000005\''
\set H65_AUGUSTIN  '\'c6500000-0000-4000-8000-000000000006\''
\set H65_WILFRED   '\'c6500000-0000-4000-8000-000000000008\''
\set H65_U1        '\'e6500000-0000-4000-8000-000000000001\''
\set H65_U2        '\'e6500000-0000-4000-8000-000000000002\''
\set H65_U3        '\'e6500000-0000-4000-8000-000000000003\''
\set H65_U4        '\'e6500000-0000-4000-8000-000000000004\''
\set H65_U5        '\'e6500000-0000-4000-8000-000000000005\''
\set H65_U6        '\'e6500000-0000-4000-8000-000000000006\''
\set H65_U8        '\'e6500000-0000-4000-8000-000000000008\''
\set H65_U9        '\'e6500000-0000-4000-8000-000000000009\''
\set H65_ELDER_F2  '\'e0000000-0000-0000-0000-0000000000f2\''
\set H65_CLERK_F3  '\'e0000000-0000-0000-0000-0000000000f3\''
\set H65_THADDEUS_TOKEN '\'seed-dev-sign-in-thaddeus-open-000000000\''
\set H65_FLOW_TOKEN     '\'seed-dev-sign-in-flow-rosalind-000000000\''

\echo '======================================================'
\echo ' Section 65 (sign-in invitations and connect, drizzle/0065) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '65: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (1) Structure and privileges (5.11).
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES')) v(p)
      where has_table_privilege('account_invitations', v.p)),
    0, '65.1: presby_app holds no privilege of any kind on account_invitations (unchanged since 0059)');
  select assert_eq(
    (select count(*) from (values
        ('presby_issue_sign_in_invitation(uuid,text,timestamptz,uuid,text,boolean,uuid)'),
        ('presby_resend_sign_in_invitation(uuid,text,timestamptz,uuid,text,boolean,uuid)'),
        ('presby_revoke_sign_in_invitation(uuid,uuid)'),
        ('presby_sign_in_invitation_states(uuid[],uuid)'),
        ('presby_sign_in_card_standing(uuid,uuid)'),
        ('presby_accept_invitation(text,uuid,text,text,text)'),
        ('presby_accept_in_place(uuid,uuid,boolean)'),
        ('presby_preview_invitation(text,uuid)'),
        ('presby_list_invitations_for_account(uuid)'),
        ('presby_connect_signed_in_account(uuid,boolean)'),
        ('presby_record_google_email_proof(uuid,text)'),
        ('presby_complete_email_change(text)'),
        ('presby_deny_sign_in_invitation()'),
        ('presby_membership_standing(text,text)'),
        ('presby_person_email(uuid,text)')) v(f)
      where has_function_privilege(v.f::regprocedure, 'EXECUTE')),
    15, '65.1 (5.11): presby_app may EXECUTE exactly the fifteen callables');
  select assert_eq(
    (select count(*) from (values
        ('presby__actor_person(uuid,uuid,text)'),
        ('presby__person_sign_in_standing(uuid,uuid)'),
        ('presby__bind_person_account(uuid,uuid,text)'),
        ('presby__accept_invitation_core(uuid,uuid,text,text,text,text,boolean)'),
        ('presby_sign_in__check(uuid,uuid,uuid,uuid,text,boolean)'),
        ('presby_users_guard_email_proof()'),
        ('presby_guard_people_user_link()')) v(f)
      where has_function_privilege(v.f::regprocedure, 'EXECUTE')),
    0, '65.1 (5.11): and none of the five internals or the two new trigger functions');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'account_invitations'::regclass and convalidated
        and conname in ('account_invitations_purpose_allowed', 'account_invitations_origin_allowed',
                        'account_invitations_purpose_origin_tie', 'account_invitations_names_by_purpose',
                        'account_invitations_sign_in_has_person', 'account_invitations_blocked_reason_allowed')),
    6, '65.1: the six sign-in CHECKs exist and are VALIDATED');
  select assert_eq(
    (select count(*) from pg_indexes where (tablename, indexname) in
        (('account_invitations', 'account_invitations_open_address_uq'),
         ('account_invitations', 'account_invitations_open_sign_in_person_uq'),
         ('account_invitations', 'account_invitations_person_created_ix'),
         ('users', 'users_email_lower_uq'),
         ('audit_events', 'audit_events_sign_in_connected_ix'))),
    5, '65.1: the five 0065 indexes, users_email_lower_uq among them (F187)');
  select assert_eq(
    (select count(*) from pg_trigger
      where tgenabled = 'O' and not tgisinternal and (tgrelid, tgname) in
        (('users'::regclass, 'users_guard_email_proof'), ('people'::regclass, 'people_guard_user_link'))),
    2, '65.1: users_guard_email_proof and people_guard_user_link exist and are ENABLED (they bind the owner path too, F44)');
rollback;

-- ===========================================================================
-- (2) F186: presby_app never writes people.user_id.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  do $$
  begin
    update people set user_id = 'e6500000-0000-4000-8000-000000000002' where id = 'c6500000-0000-4000-8000-000000000002';
    raise exception 'FAIL 65.2 - presby_app linked a person';
  exception when insufficient_privilege then
    if sqlerrm <> 'people: user_id is bound only on the owner path, by invitation acceptance or by sign-in connection' then
      raise exception 'FAIL 65.2 - wrong refusal: %', sqlerrm;
    end if;
    raise notice 'pass  65.2 (F186): presby_app UPDATE of people.user_id refused with the exact literal';
  end $$;
  do $$
  begin
    insert into people (first_name, last_name, user_id) values ('Forged', 'Link', 'e6500000-0000-4000-8000-000000000002');
    raise exception 'FAIL 65.2 - presby_app inserted a linked person';
  exception when insufficient_privilege then
    if sqlerrm <> 'people: user_id is bound only on the owner path, by invitation acceptance or by sign-in connection' then
      raise exception 'FAIL 65.2 - wrong refusal: %', sqlerrm;
    end if;
    raise notice 'pass  65.2 (F186): presby_app INSERT with a non-null user_id refused with the exact literal';
  end $$;
  -- Positive control. (The row has no membership yet, so RLS hides it from a
  -- read-back; the insert succeeding IS the assertion.)
  do $$
  begin
    insert into people (first_name, last_name) values ('Unlinked', 'Positive Control');
    raise notice 'pass  65.2: an insert with a null user_id passes (positive control)';
  end $$;
rollback;

-- ===========================================================================
-- (3) R37: email_verified is a fact about the CURRENT address, owner-recorded.
-- ===========================================================================
begin;
  do $$
  begin
    insert into users (email, name, email_verified) values ('forged.stamp.signin65@example.invalid', 'Forged', now());
    raise exception 'FAIL 65.3 - presby_app inserted a stamped user';
  exception when insufficient_privilege then
    raise notice 'pass  65.3 (R37): presby_app INSERT with email_verified refused';
  end $$;
  insert into users (id, email, name) values ('e6500000-0000-4000-8000-0000000000f1', 'unstamped.signin65@example.invalid', 'Unstamped');
  do $$
  begin
    update users set email_verified = now() where id = 'e6500000-0000-4000-8000-0000000000f1';
    raise exception 'FAIL 65.3 - presby_app stamped a user';
  exception when insufficient_privilege then
    raise notice 'pass  65.3 (R37): presby_app setting a stamp from null refused';
  end $$;
  update users set email = upper(email) where id = :H65_U2;
  select assert_eq((select count(*) from users where id = :H65_U2 and email_verified is not null),
    1, '65.3 (R37): a letter-case-only change keeps the stamp');
  update users set email = 'moved.away.signin65@example.invalid' where id = :H65_U2;
  select assert_eq((select count(*) from users where id = :H65_U2 and email_verified is null),
    1, '65.3 (R37, F230): an address change clears an unchanged stamp');
  update users set email_verified = null where id = :H65_U3;
  select assert_eq((select count(*) from users where id = :H65_U3 and email_verified is null),
    1, '65.3 (R37): clearing a stamp is allowed');
rollback;

-- ===========================================================================
-- (4) R38: the two owner-path proof writers.
-- ===========================================================================
begin;
  insert into users (id, email, name) values
    ('e6500000-0000-4000-8000-0000000000f2', 'google.claim.signin65@example.invalid', 'Google Fixture');
  insert into users (id, email, name, is_active) values
    ('e6500000-0000-4000-8000-0000000000f3', 'google.inactive.signin65@example.invalid', 'Inactive Fixture', false);
  select assert_eq((select presby_record_google_email_proof('e6500000-0000-4000-8000-0000000000f2', ' GOOGLE.Claim.signin65@example.invalid ')::int),
    1, '65.4 (R38): an active, unstamped account whose address matches is stamped (true)');
  select assert_eq((select count(*) from users where id = 'e6500000-0000-4000-8000-0000000000f2' and email_verified is not null),
    1, '65.4 (R38): ...and the stamp is recorded');
  select assert_eq((select presby_record_google_email_proof('e6500000-0000-4000-8000-0000000000f2', 'google.claim.signin65@example.invalid')::int),
    0, '65.4 (R38): a second call stamps nothing (false)');
  select assert_eq((select presby_record_google_email_proof(:H65_U2, 'someone.else.signin65@example.invalid')::int),
    0, '65.4 (R38): a different address stamps nothing (false)');
  select assert_eq((select presby_record_google_email_proof('e6500000-0000-4000-8000-0000000000f3', 'google.inactive.signin65@example.invalid')::int),
    0, '65.4 (R38): an inactive account is not stamped (false)');

  -- Email change. presby_app writes the token row itself (that is the F187
  -- residual DECISION-225 names); the definer writes address and stamp.
  insert into email_verification_tokens (user_id, token, new_email, expires_at)
  values (:H65_U2, repeat('a', 64), 'benedikt.new.signin65@example.invalid', now() + interval '1 hour'),
         (:H65_U6, repeat('b', 64), 'augustin.late.signin65@example.invalid', now() - interval '1 minute'),
         (:H65_U8, repeat('c', 64), upper('clementine.ashby.signin65@example.invalid'), now() + interval '1 hour');
  select assert_eq((select count(*) from presby_complete_email_change(repeat('b', 64)) where outcome = 'expired'),
    1, '65.4 (R38): an expired token is expired');
  select assert_eq((select count(*) from email_verification_tokens where token = repeat('b', 64)),
    0, '65.4 (R38): ...and its row is deleted (today''s behaviour)');
  select assert_eq((select count(*) from presby_complete_email_change(repeat('c', 64)) where outcome = 'email_taken'),
    1, '65.4 (R38, F187): an address another account holds in a different case is email_taken');
  select assert_eq((select count(*) from users where id = :H65_U8 and email = 'wilfred.tamsworth.signin65@example.invalid')
                 + (select count(*) from email_verification_tokens where token = repeat('c', 64)),
    2, '65.4 (R38): ...nothing written, and the token stays');
  select assert_eq((select count(*) from presby_complete_email_change(repeat('a', 64))
                     where outcome = 'ok' and new_email = 'benedikt.new.signin65@example.invalid'),
    1, '65.4 (R38): a valid token is ok');
  select assert_eq((select count(*) from users
                     where id = :H65_U2 and email = 'benedikt.new.signin65@example.invalid' and email_verified is not null)
                 + (select count(*) from email_verification_tokens where token = repeat('a', 64)),
    1, '65.4 (R38): ...the new address is written AND stamped in one statement, and the token is gone');
  select assert_eq((select count(*) from presby_complete_email_change(repeat('a', 64)) where outcome = 'invalid'),
    1, '65.4 (R38): a used token is invalid');
rollback;

-- ===========================================================================
-- (5) Identity refusals: the one literal, 42501, for every callable.
-- ===========================================================================
begin;
  create temporary table t65_cases (label text, org uuid, actor uuid);
  insert into t65_cases values
    ('no organization context', null, 'e6500000-0000-4000-8000-0000000000a0'),
    ('a null actor', '65000000-0000-4000-8000-000000000001', null),
    ('a user without people.manage (Alder Creek''s elder fixture)', '22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-0000000000f2'),
    ('another organization''s context (the Hollinbrook sender at Alder Creek)', '22222222-2222-2222-2222-222222222222', 'e6500000-0000-4000-8000-0000000000a0'),
    ('a member of another organization (the Alder Creek clerk at Hollinbrook)', '65000000-0000-4000-8000-000000000001', 'e0000000-0000-0000-0000-0000000000f3');
  do $$
  declare
    c record;
    fn text;
    n int := 0;
  begin
    for c in select * from t65_cases loop
      perform set_config('app.current_org_id', coalesce(c.org::text, ''), true);
      foreach fn in array array['issue', 'resend', 'revoke', 'states', 'card'] loop
        begin
          case fn
            when 'issue' then perform * from presby_issue_sign_in_invitation('c6500000-0000-4000-8000-000000000002',
                                repeat('d', 64), now() + interval '7 days', null, 'benedikt.ollerenshaw.signin65@example.invalid', false, c.actor);
            when 'resend' then perform * from presby_resend_sign_in_invitation('c6500000-0000-4000-8000-000000000004',
                                repeat('d', 64), now() + interval '7 days', null, 'thaddeus.pembrook.signin65@example.invalid', false, c.actor);
            when 'revoke' then perform * from presby_revoke_sign_in_invitation('c6500000-0000-4000-8000-000000000004', c.actor);
            when 'states' then perform * from presby_sign_in_invitation_states(array['c6500000-0000-4000-8000-000000000004'::uuid], c.actor);
            when 'card' then perform * from presby_sign_in_card_standing('c6500000-0000-4000-8000-000000000004', c.actor);
          end case;
          raise exception 'FAIL 65.5 - % allowed for %', fn, c.label;
        exception when insufficient_privilege then
          if sqlerrm <> 'account_invitations: this sign-in invitation action is not permitted' then
            raise exception 'FAIL 65.5 - % for %: wrong literal %', fn, c.label, sqlerrm;
          end if;
          n := n + 1;
        end;
      end loop;
    end loop;
    if n <> 25 then raise exception 'FAIL 65.5 - expected 25 refusals, got %', n; end if;
    raise notice 'pass  65.5: issue, resend, revoke, the reader and card standing refuse all five identity cases with the one literal (25)';
  end $$;
rollback;

-- ===========================================================================
-- (6) The sanctioned flow end to end (issue -> preview -> accept -> dead).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  select assert_eq(
    (select count(*) from presby_issue_sign_in_invitation(:H65_ROSALIND,
       encode(sha256(convert_to(:H65_FLOW_TOKEN, 'UTF8')), 'hex'), now() + interval '7 days', null,
       'rosalind.quarrington.signin65@example.invalid', false, :H65_SENDER)
      where outcome = 'ok' and address = 'rosalind.quarrington.signin65@example.invalid'
        and recipient_first_name = 'Rosalind' and sender_name = 'Hollis Wardlaw' and ack_reasons = '{}'),
    1, '65.6: the Hollinbrook sender (people.manage + officers.manage) invites an elder: ok');
  select assert_eq(
    (select count(*) from presby_issue_sign_in_invitation(:H65_ROSALIND, repeat('e', 64), now() + interval '7 days', null,
       'rosalind.quarrington.signin65@example.invalid', false, :H65_SENDER) where outcome = 'already_pending'),
    1, '65.6: a second send while one is open is already_pending');
  -- drizzle/0066 section 9 (Increment 3a) retired F177 condition 1: a
  -- visitor is no longer an acknowledgement reason (a visitor's sign-in
  -- carries no directory, F177 Option 1). The do_not_contact acknowledgement
  -- is unchanged and is asserted in sign-in-invitations.db.test.ts.
  select assert_eq(
    (select count(*) from presby_issue_sign_in_invitation(:H65_CLEM, repeat('f', 64), now() + interval '7 days', null,
       'clementine.ashby.signin65@example.invalid', false, :H65_SENDER)
      where outcome = 'ok' and ack_reasons = '{}' and invitation_id is not null),
    1, '65.6 (0066 section 9): a visitor is invited with no acknowledgement, and the definer reports no reason');
  select assert_eq(
    (select count(*) from presby_issue_sign_in_invitation(:H65_CLEM, repeat('f', 64), now() + interval '7 days', null,
       'clementine.ashby.signin65@example.invalid', true, :H65_SENDER)
      where outcome = 'already_pending'),
    1, '65.6: ...so a second send, acknowledged or not, is already_pending');
  select assert_eq(
    (select count(*) from presby_preview_invitation(:H65_FLOW_TOKEN, :H65_U1)
      where purpose = 'sign_in' and session_matches and person_display_name = 'Rosalind Quarrington'
        and invitee_first_name is null),
    1, '65.6 (G5): the preview names the person to the account the row is addressed to');
  select assert_eq(
    (select count(*) from presby_preview_invitation(:H65_FLOW_TOKEN, null) where person_display_name is null),
    1, '65.6 (G5): ...and to nobody else');
  select assert_eq(
    (select count(*) from presby_accept_invitation(:H65_FLOW_TOKEN, :H65_U1, null, null, null)
      where outcome = 'accepted' and purpose = 'sign_in' and person_mode = 'linked_person'
        and administration_role_key is null and permission_keys is null),
    1, '65.6: the seeded account accepts; nothing but the link is granted');
  select assert_eq((select count(*) from people where id = :H65_ROSALIND and user_id = :H65_U1),
    1, '65.6: people.user_id is linked');
  select assert_eq((select count(*) from presby_accept_invitation(:H65_FLOW_TOKEN, :H65_U1, null, null, null) where outcome = 'dead'),
    1, '65.6: a second acceptance is dead');
rollback;

-- ===========================================================================
-- (7) Connect: the G18 matrix at the SQL level (R41, R42, R47).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  select count(*) as c65_before_gm from group_memberships \gset
  select count(*) as c65_before_rg from role_grants \gset
  select count(*) as c65_before_ot from officer_terms \gset
  select count(*) as c65_before_m from memberships \gset
  select assert_eq(
    (select count(*) from presby_connect_signed_in_account(:H65_U2, false)
      where outcome = 'connected' and organization_id = :H65_ORG and organization_slug = 'hollinbrook'
        and person_id = :H65_BENEDIKT and not session_seat and role_keys = '{}'),
    1, '65.7 (R41): an authority-free member with a proven address connects');
  select assert_eq((select count(*) from people where id = :H65_BENEDIKT and user_id = :H65_U2),
    1, '65.7: ...people.user_id is set');
  select assert_eq((select count(*) from contact_methods where person_id = :H65_BENEDIKT and ended_at is null and verified_at is not null),
    1, '65.7: ...and the contact is stamped (an OUTPUT of linking, R43)');
  select assert_eq(
    (select count(*) from group_memberships) + (select count(*) from role_grants)
      + (select count(*) from officer_terms) + (select count(*) from memberships),
    :c65_before_gm + :c65_before_rg + :c65_before_ot + :c65_before_m,
    '65.7: nothing else is written (no membership, grant, group or officer row)');
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U2, false) where outcome = 'already_connected'),
    1, '65.7 (E-14): a second call is already_connected');
rollback;

begin;
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U3, true) where outcome = 'declined'),
    1, '65.7: a visitor without a roll is declined');
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U6, true) where outcome = 'declined'),
    1, '65.7 (R29, E-26): an address two live people share is declined');
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U8, true) where outcome = 'declined'),
    1, '65.7: a member of an unmanaged organization is declined');
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U9, true) where outcome = 'declined'),
    1, '65.7 (R31): a person at two organizations is declined');
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U4, true) where outcome = 'declined'),
    1, '65.7 (FB5): an open invitation to the address holds auto-connect back');
  select assert_eq((select count(*) from presby_connect_signed_in_account(null, true) where outcome = 'declined'),
    1, '65.7: a null account is declined');
  select assert_eq(
    (select count(*) from presby_connect_signed_in_account(:H65_U3, true)
      where organization_id is null and person_id is null and role_keys is null and not session_seat and not diaconate_seat),
    1, '65.7 (E-23): a decline says nothing else');
rollback;

begin;
  update users set email_verified = null where id = :H65_U2;
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U2, false) where outcome = 'declined'),
    1, '65.7 (R37, E-34): an unproven account is declined');
rollback;

begin;
  update users set is_active = false where id = :H65_U2;
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U2, false) where outcome = 'declined'),
    1, '65.7: an inactive account is declined');
rollback;

begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  update organization_feature_toggles set enabled = false
   where organization_id = :H65_ORG and feature_key = 'org_portal.sign_in_connect';
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U2, false) where outcome = 'declined'),
    1, '65.7 (R47): the congregation''s toggle OFF declines');
  delete from organization_feature_toggles
   where organization_id = :H65_ORG and feature_key = 'org_portal.sign_in_connect';
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U2, false) where outcome = 'declined'),
    1, '65.7 (R47, DECISION-097): an ABSENT toggle row declines');
rollback;

begin;
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U1, false) where outcome = 'needs_second_factor'),
    1, '65.7 (R42): an elder (authority-bearing) without a factor: needs_second_factor');
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U1, true) where outcome = 'needs_second_factor'),
    1, '65.7 (R42): a verified factor claimed with no user_totp row: still needs_second_factor');
  select assert_eq((select count(*) from people where id = :H65_ROSALIND and user_id is not null),
    0, '65.7 (R42): ...and nothing was linked');
  insert into user_totp (user_id, secret_ciphertext, enrolled_at)
  values (:H65_U1, 'test-rls-65-fixture-ciphertext', now());
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U1, false) where outcome = 'needs_second_factor'),
    1, '65.7 (R42): enrolled but the session is not verified: needs_second_factor (always so at sign-in)');
  select assert_eq(
    (select count(*) from presby_connect_signed_in_account(:H65_U1, true)
      where outcome = 'connected' and session_seat and permission_keys = '{}'),
    1, '65.7 (R42): enrolled AND verified: connected, the snapshot carrying the Session seat');
rollback;

-- ===========================================================================
-- (8) Accept in place and the listing (R45, Q2).
-- ===========================================================================
begin;
  select invitation_id as h65_thaddeus_inv from presby_list_invitations_for_account(:H65_U4) \gset
  select invitation_id as h65_honoria_inv from presby_list_invitations_for_account(:H65_U5) \gset
  select assert_eq(
    (select count(*) from presby_list_invitations_for_account(:H65_U4)
      where purpose = 'sign_in' and organization_name = 'Hollinbrook Presbyterian Church'
        and person_display_name = 'Thaddeus Pembrook'),
    1, '65.8: the listing shows the proven account''s one open invitation');
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_list_invitations_for_account'
        and array_to_string(proargnames, ',') = 'p_user_id,invitation_id,organization_name,purpose,expires_at,person_display_name'),
    1, '65.8 (E-20): the listing''s closed shape (no token hash, inviter, address or person id)');
  select assert_eq((select count(*) from presby_list_invitations_for_account(:H65_U2)),
    0, '65.8: an account with no invitation lists nothing');
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_honoria_inv', :H65_U4, true) where outcome = 'dead' and invitation_id is null),
    1, '65.8 (E-16, E-40): another account''s invitation (an address mismatch) is dead');
  select assert_eq(
    (select count(*) from presby_accept_in_place('00000000-0000-4000-8000-000000000065', :H65_U4, true) where outcome = 'dead'),
    1, '65.8 (E-16): an unknown id is dead');
rollback;

begin;
  select invitation_id as h65_thaddeus_inv from presby_list_invitations_for_account(:H65_U4) \gset
  update users set email_verified = null where id = :H65_U4;
  select assert_eq((select count(*) from presby_accept_in_place(:'h65_thaddeus_inv', :H65_U4, true) where outcome = 'dead'),
    1, '65.8 (E-16): an unproven account is dead');
  select assert_eq((select count(*) from presby_list_invitations_for_account(:H65_U4)), 0,
    '65.8: ...and lists nothing');
rollback;

begin;
  select invitation_id as h65_thaddeus_inv from presby_list_invitations_for_account(:H65_U4) \gset
  update users set is_active = false where id = :H65_U4;
  select assert_eq((select count(*) from presby_accept_in_place(:'h65_thaddeus_inv', :H65_U4, true) where outcome = 'dead'),
    1, '65.8 (E-16): an inactive account is dead');
rollback;

begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  select invitation_id as h65_thaddeus_inv from presby_list_invitations_for_account(:H65_U4) \gset
  select invitation_id as h65_honoria_inv from presby_list_invitations_for_account(:H65_U5) \gset
  select count(*) + (select count(*) from role_grants) + (select count(*) from officer_terms)
         + (select count(*) from app_roles where organization_id = '65000000-0000-4000-8000-000000000001') as c65_auth
    from group_memberships \gset
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_honoria_inv', :H65_U5, false) where outcome = 'needs_second_factor'),
    1, '65.8 (R42, R45): an elder''s sign_in in place without a verified factor: needs_second_factor');
  select assert_eq((select count(*) from presby_list_invitations_for_account(:H65_U5)),
    1, '65.8: ...non-terminal: the invitation is still open');
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_honoria_inv', :H65_U5, true) where outcome = 'accepted' and person_mode = 'linked_person'),
    1, '65.8 (R42, R45): enrolled and verified: accepted in place');
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_thaddeus_inv', :H65_U4, false) where outcome = 'accepted' and purpose = 'sign_in'),
    1, '65.8: an authority-free sign_in in place needs no factor in the database (G9 parity is TypeScript''s)');
  select assert_eq(
    (select count(*) from group_memberships) + (select count(*) from role_grants) + (select count(*) from officer_terms)
      + (select count(*) from app_roles where organization_id = '65000000-0000-4000-8000-000000000001'),
    :c65_auth, '65.8 (R35): an accepted sign_in writes no group membership, role grant, officer term or role');
  select assert_eq((select count(*) from people where id in (:H65_THADDEUS, :H65_HONORIA) and user_id is not null),
    2, '65.8: both people are linked');
rollback;

begin;
  -- The founding administrator and treasurer always need the factor in place.
  -- A presby_app user at the Quillhaven invitation's address, proven through
  -- the Google writer (the only stamp path presby_app can reach).
  insert into users (id, email, name) values
    ('e6500000-0000-4000-8000-0000000000f4', 'invite.founding.quillhaven@example.invalid', 'Quillhaven Invitee');
  select assert_eq((select presby_record_google_email_proof('e6500000-0000-4000-8000-0000000000f4', 'invite.founding.quillhaven@example.invalid')::int),
    1, '65.8: (fixture) the invitee''s account is proven');
  select invitation_id as h65_qh_fa from presby_list_invitations_for_account('e6500000-0000-4000-8000-0000000000f4')
   where purpose = 'founding_administrator' \gset
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_qh_fa', 'e6500000-0000-4000-8000-0000000000f4', true) where outcome = 'needs_second_factor'),
    1, '65.8 (R45): a founding-administrator invitation in place with no user_totp row: needs_second_factor');
  insert into user_totp (user_id, secret_ciphertext, enrolled_at)
  values ('e6500000-0000-4000-8000-0000000000f4', 'test-rls-65-fixture-ciphertext', now());
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_qh_fa', 'e6500000-0000-4000-8000-0000000000f4', false) where outcome = 'needs_second_factor'),
    1, '65.8 (R45): ...enrolled but not verified this session: needs_second_factor');
  select assert_eq(
    (select count(*) from presby_accept_in_place(:'h65_qh_fa', 'e6500000-0000-4000-8000-0000000000f4', true)
      where outcome = 'accepted' and purpose = 'founding_administrator' and administration_role_key is not null),
    1, '65.8 (R45): enrolled and verified: the designation is accepted in place');
rollback;

-- ===========================================================================
-- (9) The reader and card standing.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_sign_in_invitation_states'
        and array_to_string(proargnames, ',') = 'p_person_ids,p_actor_user_id,person_id,linked,state,sent_at,expires_at,resend_count,next_resend_at,invited_address,address_current,outcome,queue_status,queue_delivered_at,queue_bounced_at,queue_complained_at,connected_via,connected_on'),
    1, '65.9 (R30, R42): the reader''s closed column list');
  select assert_eq(
    (select count(*) from presby_sign_in_invitation_states(
        array[:H65_THADDEUS, :H65_BENEDIKT, :H65_WILFRED]::uuid[], :H65_SENDER)),
    2, '65.9: another organization''s person (Wilfred, Saltmarsh) is omitted');
  select assert_eq(
    (select count(*) from presby_sign_in_invitation_states(array[:H65_THADDEUS]::uuid[], :H65_SENDER)
      where state = 'pending' and not linked and invited_address = 'thaddeus.pembrook.signin65@example.invalid' and address_current),
    1, '65.9: an open invitation reads pending with its current address');
  select assert_eq(
    (select count(*) from presby_sign_in_invitation_states(array[:H65_BENEDIKT]::uuid[], :H65_SENDER)
      where state = 'none' and not linked and connected_via is null),
    1, '65.9: no invitation reads none');
  -- Connect Benedikt and record what connect.ts records; accept Thaddeus in place.
  select assert_eq((select count(*) from presby_connect_signed_in_account(:H65_U2, false) where outcome = 'connected'), 1,
    '65.9: (fixture) Benedikt connects');
  insert into audit_events (action, resource_type, resource_id, metadata)
  values ('tenant.person.sign_in_connected', 'person', :H65_BENEDIKT,
          jsonb_build_object('organizationId', :H65_ORG::text, 'personId', :H65_BENEDIKT::text));
  select invitation_id as h65_thaddeus_inv from presby_list_invitations_for_account(:H65_U4) \gset
  select assert_eq((select count(*) from presby_accept_in_place(:'h65_thaddeus_inv', :H65_U4, false) where outcome = 'accepted'), 1,
    '65.9: (fixture) Thaddeus accepts in place');
  select assert_eq(
    (select count(*) from presby_sign_in_invitation_states(array[:H65_BENEDIKT]::uuid[], :H65_SENDER)
      where state = 'signs_in' and linked and connected_via = 'sign_in' and connected_on = current_date),
    1, '65.9 (R42): a connect reads connected_via sign_in, today');
  select assert_eq(
    (select count(*) from presby_sign_in_invitation_states(array[:H65_THADDEUS]::uuid[], :H65_SENDER)
      where state = 'signs_in' and connected_via = 'invitation' and invited_address is null),
    1, '65.9: an acceptance reads connected_via invitation; linked takes precedence over the row');
  select assert_eq(
    (select count(*) from presby_sign_in_card_standing(:H65_ROSALIND, :H65_SENDER)
      where standing = 'listed' and authority_bearing and not address_shared),
    1, '65.9 (R46): card standing for an elder: listed, authority-bearing, not shared');
  select assert_eq(
    (select count(*) from presby_sign_in_card_standing(:H65_AUGUSTIN, :H65_SENDER) where address_shared),
    1, '65.9 (R29): card standing reports a shared address');
  select assert_eq(
    (select count(*) from presby_sign_in_card_standing(:H65_CLEM, :H65_SENDER) where standing = 'visitor' and not authority_bearing),
    1, '65.9: card standing for a visitor');
  select assert_eq((select count(*) from presby_sign_in_card_standing(:H65_WILFRED, :H65_SENDER)),
    0, '65.9: another organization''s person: zero rows');
rollback;

-- ===========================================================================
-- (10) Isolation, and the limits refuse the 31st send.
-- ===========================================================================
begin;
  -- The Alder Creek clerk is a people.manage holder there; Hollinbrook's
  -- invitation is invisible from Alder Creek's context.
  select set_config('app.current_org_id', :H65_ALDER, true);
  select assert_eq((select count(*) from presby_sign_in_invitation_states(array[:H65_THADDEUS]::uuid[], :H65_CLERK_F3)),
    0, '65.10: a sign_in row is visible to no other organization''s context (the reader omits the person)');
  select assert_eq((select count(*) from presby_revoke_sign_in_invitation(:H65_THADDEUS, :H65_CLERK_F3) where outcome = 'not_open'),
    1, '65.10: ...and another organization cannot cancel it (not_open)');
  select assert_eq((select count(*) from presby_sign_in_card_standing(:H65_THADDEUS, :H65_CLERK_F3)),
    0, '65.10: ...nor read its card standing');
rollback;

begin;
  select set_config('app.current_org_id', :H65_ORG, true);
  do $$
  declare
    v_person uuid;
    v_addr text;
    v_out text;
    i int;
  begin
    for i in 1 .. 31 loop
      -- The id is chosen here: RETURNING would apply people's SELECT policy to
      -- a row that has no membership yet.
      v_person := gen_random_uuid();
      insert into people (id, first_name, last_name) values (v_person, 'Limit', 'Fixture ' || i);
      insert into memberships (organization_id, person_id, engagement_status, current_roll)
      values ('65000000-0000-4000-8000-000000000001', v_person, 'regular', null);
      v_addr := 'limit.' || i || '.signin65@example.invalid';
      insert into contact_methods (person_id, kind, value, is_primary) values (v_person, 'email', v_addr, true);
      select outcome into v_out
        from presby_issue_sign_in_invitation(v_person, md5(i::text) || md5(i::text || 'x'), now() + interval '7 days',
                                             null, v_addr, false, 'e6500000-0000-4000-8000-0000000000a0');
      if i <= 30 and v_out <> 'ok' then
        raise exception 'FAIL 65.10 - send % was %', i, v_out;
      end if;
      if i = 31 and v_out <> 'rate_limited' then
        raise exception 'FAIL 65.10 - the 31st send was %, not rate_limited', v_out;
      end if;
    end loop;
    raise notice 'pass  65.10 (R32, G9): thirty sends in 24 hours, then rate_limited (the 2099-dated fixture rows do not count)';
  end $$;
rollback;

\echo '======================================================'
\echo ' Section 65 (sign-in invitations and connect) complete.'
\echo '======================================================'
