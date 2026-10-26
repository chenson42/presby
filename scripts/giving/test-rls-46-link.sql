-- ---------------------------------------------------------------------------
-- test-rls-46-link.sql: link a fixture person to a fixture account for ONE
-- rolled-back block, as presby_app, through the sanctioned writer.
--
-- Section 46's blocks used to `update people set user_id = ...` directly so a
-- giving definer could resolve its actor. drizzle/0065 (F186, DECISION-208 as
-- amended) refuses every non-owner write of people.user_id, so the link now
-- goes through presby_connect_signed_in_account(), the second of the two
-- sanctioned writers (R41): the person is given the account's address as a
-- secondary email, the account is enrolled in TOTP (the fixture treasurer and
-- recorder are authority-bearing, so R42 needs a user_totp row AND a verified
-- factor), and connect links them. Everything rolls back with the block.
--
-- Inputs (set_config, transaction-local, in the including block):
--   rls_test.link_person  the person to link
--   rls_test.link_user    the account (proven, active, unlinked)
-- Needs: app.current_org_id set to the person's organization (the contact
-- insert is RLS-checked), and that organization's org_portal.sign_in_connect
-- toggle row (scripts/sign-in-invitations/seed-dev-sign-in.sql seeds one for
-- every organization).
-- ---------------------------------------------------------------------------
do $$
declare
  v_person uuid := current_setting('rls_test.link_person')::uuid;
  v_user uuid := current_setting('rls_test.link_user')::uuid;
  v_email text;
  v_out text;
begin
  select lower(btrim(u.email)) into v_email from users u where u.id = v_user;
  insert into contact_methods (person_id, kind, value, is_primary)
  values (v_person, 'email', v_email, false);
  insert into user_totp (user_id, secret_ciphertext, enrolled_at)
  values (v_user, 'test-rls-46-fixture-ciphertext', now())
  on conflict (user_id) do nothing;
  select c.outcome into v_out from presby_connect_signed_in_account(v_user, true) c;
  if v_out is distinct from 'connected' then
    raise exception 'FAIL 46 (setup): could not link person % to account % through presby_connect_signed_in_account: %',
      v_person, v_user, v_out;
  end if;
end $$;
