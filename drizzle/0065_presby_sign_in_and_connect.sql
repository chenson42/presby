-- drizzle/0065_presby_sign_in_and_connect.sql
--
-- Community Increment 2b: address proof, the user-link guard, sign-in
-- invitations, auto-connect at sign-in and accepting an invitation in place
-- (docs/work-log/2026-10-22-founding-admin-directory.md, "Increment 2b -
-- Phase 3 amendment 2" section 5; architect addendum 2 R37-R47; DECISION-207
-- and DECISION-208 as amended, DECISION-225 to DECISION-228; findings F186,
-- F187, F192-F199, F230-F233).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0065_presby_sign_in_and_connect.sql
--
-- BUILT IN TWO BATCHES, ONE FILE. Batch A1 wrote sections 1-10, a complete,
-- applyable file on its own. Batch A2 appended sections 11-15 (the helpers,
-- the standing core, the bind helper, issue / resend / revoke / reader / card
-- standing, the accept core and its two presentations, the listing, preview,
-- connect, and the ACL restatement). Both batches were applied twice, end to
-- end, the second run changing no row.
--
-- CHAIN: 0059 < 0060 < 0061 < 0062 < 0063 < 0064 < 0065, never reordered.
-- A forward fix on top of 0059 (account_invitations, shipped v0.37.0) and
-- 0064 (person emails, shipped v0.42.0); neither of those files is edited.
--
-- DEPLOY ORDER: apply this file FIRST, then deploy the code. Old code against
-- this schema keeps working: the verify-email page's `update users set email`
-- is allowed and section 3 simply clears the (unread) stamp; the NextAuth
-- adapter's insert carries a null email_verified, which section 3 allows;
-- founding-administrator and treasurer acceptance is byte-identical (section
-- 13 moves the acceptance body into a shared core without changing what it
-- writes; the designation parity golden is the proof); no old code writes
-- people.user_id. New code before this file would call functions that do not
-- exist yet.
--
-- MEASURED (read-only, counts only, never a value):
--   development, 2026-10-25: 30 users, all 30 stamped, 0 case-duplicate
--     lower(email) groups, 0 stale stamps (stamped users with a
--     user.email_changed audit row), 0 Google accounts, 19 toggle rows over
--     15 organizations, 6 invitation rows (all platform-origin), deploy-day
--     auto-connect wave 0.
--   production, 2026-10-25 (orchestrator): 70 users / 2 active / 27 stamped,
--     0 case-duplicate groups, 0 stale stamps, 0 Google accounts, 661 audit
--     rows, 2 organizations (both managed) / 11 toggle rows, 0 open
--     invitations, 0 shared addresses, deploy-day wave 0 / 0.
--   Section 1 re-counts on every environment and stops the file on any
--   violation; P1 and P2 are re-run just before deploy.
--
-- F196 AND F197 ARE LATENT, NOT LIVE. The acceptance function's implicit
-- "not founding_administrator means treasurer" routing (F196) and the resend
-- guard's address comparison (F197) are defects of shipped code that cannot
-- manifest before a `sign_in` row exists, and none can exist before this file.
-- That is why this is one `feat` migration, committed per batch, not a `fix`
-- with trailers.
--
-- FORWARD-ONLY CAVEAT. Once any `sign_in` / `org` / `person_deceased` value is
-- stored, the widened vocabulary CHECKs of section 5 cannot be narrowed back
-- (rows are never deleted), and re-applying 0059 would fail on them. A
-- rollback of the code leaves the widened CHECKs in place, harmlessly.
--
-- THREE OWNER-PATH FACTS A READER MUST NOT MISS:
--   1. Proof is owner-only. users.email_verified may be set or changed only on
--      the owner path (section 3): by presby_accept_invitation (a new
--      account), presby_record_google_email_proof and
--      presby_complete_email_change (section 10). Any non-owner role may only
--      clear it, and any address change clears an unchanged stamp for every
--      role, the owner included.
--   2. people.user_id is written by exactly two function bodies once A2 lands
--      (presby__bind_person_account and the accept core's created_person
--      insert; DECISION-208 as amended), and section 6 refuses every
--      non-owner role. The owner path (getPlatformDb(), fixtures) is NOT bound:
--      accepted residual, `paper`, mitigated by the A2 source scan.
--   3. presby_app holds no privilege on account_invitations (unchanged since
--      0059); it reaches the table only through SECURITY DEFINER functions.
--
-- The whole file is idempotent: count-only stop-blocks, an update whose
-- predicate stops matching, drop-then-add for every constraint, drop-then-
-- create for every re-predicated index and `if not exists` for every new one,
-- `create or replace` for every function, drop-then-create for every trigger,
-- `on conflict do nothing` for the seed, and revoke-then-grant.
--
--    1. preconditions        stop-blocks, counts only
--    2. stale-proof clean-up provably stale stamps only (1.2 item 3)
--    3. users_guard_email_proof   R37, F230
--    4. users_email_lower_uq      F187, E1
--    5. account_invitations       CHECKs, indexes, insert guard (R28, R33,
--                                 R34, F197)
--    6. people_guard_user_link    F186 (A1: every non-owner role refused)
--    7. 0064 guard message        R43
--    8. toggle seed               org_portal.sign_in_connect (R47)
--    9. audit index               the reader's connected_via date
--   10. proof writers             presby_record_google_email_proof,
--                                 presby_complete_email_change (R38)
--   11. helpers                   presby_membership_standing (S13),
--                                 presby__actor_person, the standing core
--                                 presby__person_sign_in_standing (R40), the
--                                 bind helper presby__bind_person_account
--                                 (R44), presby_deny_sign_in_invitation
--   12. issue core and callables  presby_sign_in__check, issue, resend,
--                                 revoke, the reader, card standing
--   13. accept core and its two   presby__accept_invitation_core, the token
--       presentations             wrapper presby_accept_invitation,
--                                 presby_accept_in_place, the listing,
--                                 presby_preview_invitation, and the update
--                                 guard's two messages (R45, Q2, F196)
--   14. connect                   presby_connect_signed_in_account (R41, R42)
--   15. ACLs and comments         every function of this file, re-stated
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md). Drizzle mirrors: src/lib/db/schema.ts
-- (users), src/lib/db/domain/invitations.ts, src/lib/db/domain/people.ts.
-- The journal entry is added at integration (Rule 16).

-- ---------------------------------------------------------------------------
-- 1. preconditions (stop-blocks)
-- ---------------------------------------------------------------------------
-- Counts only; never selects a value (No Real Data: a production address must
-- not reach a migration log). Any non-zero count raises and the file stops;
-- repair the data, never edit the migration.
--   * case-duplicate lower(users.email): section 4's unique index would fail.
--   * an account_invitations row whose (purpose = 'sign_in') <> (origin =
--     'org'): impossible before this file (neither value is legal yet); the
--     check states section 5's tie as a precondition, and on a re-apply it
--     holds by that CHECK.
--   * user_totp must exist: the A2 second-factor rule (R42a) reads it.
do $$
declare
  v_case_dup bigint;
  v_tie bigint;
begin
  select count(*) into v_case_dup
    from (select 1 from users group by lower(email) having count(*) > 1) x;
  select count(*) into v_tie
    from account_invitations where (purpose = 'sign_in') <> (origin = 'org');
  if v_case_dup + v_tie > 0 then
    raise exception
      '0065: preconditions failed (counts only): case_duplicate_email_groups=%, purpose_origin_tie_violations=%; repair before applying',
      v_case_dup, v_tie
      using errcode = 'check_violation';
  end if;
  if to_regclass('public.user_totp') is null then
    raise exception '0065: user_totp does not exist; the second-factor rule reads it'
      using errcode = 'undefined_table';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. stale-proof clean-up (Phase 3 amendment 2, 1.2 item 3)
-- ---------------------------------------------------------------------------
-- Before this file the verify-email page rewrote users.email and kept the old
-- stamp (F230). A stamp is provably stale only when the user has a
-- user.email_changed audit row: audit_events is append-only for the
-- application (drizzle/0048 revokes UPDATE and DELETE from presby_app; no
-- code or cron deletes from it), so the absence of a row proves no change.
-- Clearing more broadly would strip proof from password-only accounts that
-- have no re-proof path (S11 declined). No backfill. Idempotent: once
-- cleared the predicate stops matching. Runs before section 3's trigger so it
-- does not depend on it (the owner may clear either way).
do $$
declare
  v_n bigint;
begin
  update users set email_verified = null
   where email_verified is not null
     and exists (select 1 from audit_events a
                  where a.action = 'user.email_changed'
                    and a.resource_id = users.id::text);
  get diagnostics v_n = row_count;
  raise notice '0065 section 2: stale email proofs cleared: %', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. users_guard_email_proof (R37, F230; DECISION-225)
-- ---------------------------------------------------------------------------
-- users.email_verified becomes a fact about the account's CURRENT address,
-- recorded only on the owner path. INVOKER, reads only the catalog, binds
-- every role (a BEFORE trigger fires on the owner path too; ownership and
-- BYPASSRLS bypass policies, never triggers).
--
-- Owner test, with no role named: the table's owner (pg_class.relowner for
-- TG_RELID) against current_user. Inside a SECURITY DEFINER function owned by
-- the table owner, current_user IS the owner, so the three sanctioned writers
-- pass while a direct presby_app or presby_platform write does not.
--
--   Non-owner roles (presby_app, presby_platform, any role added later):
--     INSERT with a non-null email_verified raises; an UPDATE that sets the
--     stamp from null, or changes one non-null value to another, raises;
--     clearing it to null is allowed.
--   Every role, the owner included: when lower(email) changes and the stamp
--     was not changed in the same statement, the stamp is cleared. An
--     owner-path definer that changes an address re-stamps explicitly with
--     clock_timestamp() in the same statement (presby_complete_email_change
--     does). A change of letter case only keeps the stamp.
--
-- Consequence recorded for DECISION-225: adding Auth.js's Email (magic-link)
-- provider later needs an owner-path definer for its stamp, because the
-- adapter would then write a non-null emailVerified as presby_app. It is not
-- configured today.
create or replace function presby_users_guard_email_proof()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
begin
  select c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
    into v_owner
    from pg_class c
   where c.oid = tg_relid;
  v_owner := coalesce(v_owner, false);

  if tg_op = 'INSERT' then
    if not v_owner and new.email_verified is not null then
      raise exception 'users: email_verified is recorded only on the owner path, by presby_accept_invitation, presby_record_google_email_proof or presby_complete_email_change'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE
  if not v_owner
     and new.email_verified is not null
     and new.email_verified is distinct from old.email_verified then
    raise exception 'users: email_verified is recorded only on the owner path, by presby_accept_invitation, presby_record_google_email_proof or presby_complete_email_change'
      using errcode = 'insufficient_privilege';
  end if;

  if lower(new.email) is distinct from lower(old.email)
     and new.email_verified is not distinct from old.email_verified then
    new.email_verified := null;
  end if;
  return new;
end $$;

revoke all on function presby_users_guard_email_proof() from public, presby_app, presby_platform;

drop trigger if exists users_guard_email_proof on users;
create trigger users_guard_email_proof
  before insert or update on users
  for each row execute function presby_users_guard_email_proof();

comment on function presby_users_guard_email_proof() is
  'BEFORE INSERT OR UPDATE on users, invoker, binds every role (drizzle/0065 section 3, R37, DECISION-225). A non-owner may not set or change email_verified (clearing it is allowed); for every role, an address change (lower(email) differs) clears a stamp the same statement did not change. Owner test: pg_class.relowner against current_user, no role named.';
comment on column users.email_verified is
  'Proof that the account controls its CURRENT address (DECISION-225). Recorded only on the owner path: presby_accept_invitation (a new account), presby_record_google_email_proof, presby_complete_email_change. users_guard_email_proof refuses any non-owner stamp and clears an unchanged stamp when the address changes (drizzle/0065 section 3). Never derived from contact_methods.verified_at (R43).';

-- ---------------------------------------------------------------------------
-- 4. users_email_lower_uq (F187 narrowed, E1; DECISION-208)
-- ---------------------------------------------------------------------------
-- users_email_unique stops only exact-case collisions; this closes the
-- case-variant race 0059's new-account acceptance named (0059 step 5) and
-- makes acceptance's lower(email) identity match deterministic. Behaviour
-- change recorded in DECISION-208: a Google sign-in whose address is a
-- case-variant of an existing account now fails at the adapter's insert
-- instead of quietly creating a second account. Section 1's stop-block
-- guarantees the build succeeds.
create unique index if not exists users_email_lower_uq on users (lower(email));

comment on index users_email_lower_uq is
  'One account per address regardless of letter case (F187, E1; drizzle/0065 section 4). Acceptance maps a unique_violation on it to account_exists, like users_email_unique.';

-- ---------------------------------------------------------------------------
-- 5. account_invitations: CHECKs, indexes, insert guard (R28, R33, R34, F197)
-- ---------------------------------------------------------------------------
-- Drop-then-add (the 0048 idiom); no function body names any of these
-- constraints (dependency check, Phase 4 kickoff step 6). `<open>` below is
-- the live predicate: accepted_at, revoked_at, superseded_at and blocked_at
-- all null, no expiry term, so an expired open row still blocks until it is
-- superseded (the card handles that).
alter table account_invitations drop constraint if exists account_invitations_purpose_allowed;
alter table account_invitations add constraint account_invitations_purpose_allowed
  check (purpose in ('founding_administrator', 'treasurer', 'sign_in'));

alter table account_invitations drop constraint if exists account_invitations_origin_allowed;
alter table account_invitations add constraint account_invitations_origin_allowed
  check (origin in ('platform', 'org'));

-- A sign-in invitation is always a congregation's own; nothing else is.
alter table account_invitations drop constraint if exists account_invitations_purpose_origin_tie;
alter table account_invitations add constraint account_invitations_purpose_origin_tie
  check ((purpose = 'sign_in') = (origin = 'org'));

alter table account_invitations drop constraint if exists account_invitations_names_by_purpose;
alter table account_invitations add constraint account_invitations_names_by_purpose
  check ((purpose <> 'founding_administrator'
          or (invitee_first_name is not null and invitee_last_name is not null))
     and (purpose <> 'treasurer'
          or (invitee_first_name is null and invitee_last_name is null))
     and (purpose <> 'sign_in'
          or (invitee_first_name is null and invitee_last_name is null)));

-- R34's twin of the (misnamed) treasurer_has_person.
alter table account_invitations drop constraint if exists account_invitations_sign_in_has_person;
alter table account_invitations add constraint account_invitations_sign_in_has_person
  check (purpose <> 'sign_in' or person_id is not null);

alter table account_invitations drop constraint if exists account_invitations_blocked_reason_allowed;
alter table account_invitations add constraint account_invitations_blocked_reason_allowed
  check (blocked_reason in ('has_holders', 'person_elsewhere', 'membership_ended', 'person_merged',
                            'person_linked_elsewhere', 'ambiguous_person', 'not_applicable',
                            'provisioning_incomplete', 'person_deceased'));

-- R28: address uniqueness stays for every purpose except sign_in (written as
-- `<>`, not an allow-list, so a future purpose is covered until someone opts
-- it out). Same name as 0059's index, so issue.ts's constraint-name mapping
-- is preserved.
drop index if exists account_invitations_open_address_uq;
create unique index if not exists account_invitations_open_address_uq
  on account_invitations (organization_id, purpose, email_normalized)
  where purpose <> 'sign_in'
    and accepted_at is null and revoked_at is null
    and superseded_at is null and blocked_at is null;

-- One open sign-in invitation per person per organization.
create unique index if not exists account_invitations_open_sign_in_person_uq
  on account_invitations (organization_id, person_id)
  where purpose = 'sign_in'
    and accepted_at is null and revoked_at is null
    and superseded_at is null and blocked_at is null;

-- The reader's per-person newest-first scan.
create index if not exists account_invitations_person_created_ix
  on account_invitations (person_id, created_at desc)
  where person_id is not null;

-- Insert guard, re-created from the live 0059 body. Unchanged for every
-- purpose but sign_in: rows are born open; a founding-administrator row names
-- its person only at acceptance; a resend's parent is in the same
-- organization, already superseded, same purpose, origin, ADDRESS and person,
-- with resend_count = parent + 1. New: a sign_in row must name its person,
-- and a sign_in resend's lineage compares organization, purpose, origin and
-- person but NOT the address (R33, F197): the address is re-read from the
-- record at each send, so a corrected address must be able to resend.
create or replace function presby_account_invitations_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent account_invitations%rowtype;
begin
  if num_nonnulls(new.accepted_at, new.accepted_user_id, new.revoked_at, new.revoked_by_user_id,
                  new.superseded_at, new.blocked_at, new.blocked_reason, new.redacted_at) <> 0 then
    raise exception 'account_invitations: an invitation is created open; acceptance, blocking, revocation, supersession and redaction are later transitions'
      using errcode = 'insufficient_privilege';
  end if;

  if new.purpose = 'founding_administrator' and new.person_id is not null then
    raise exception 'account_invitations: a founding-administrator invitation names its person only at acceptance'
      using errcode = 'insufficient_privilege';
  end if;

  if new.purpose = 'sign_in' and new.person_id is null then
    raise exception 'account_invitations: a sign-in invitation names its person when it is created'
      using errcode = 'insufficient_privilege';
  end if;

  if new.resent_from_id is not null then
    select * into v_parent from account_invitations p where p.id = new.resent_from_id;
    if new.purpose = 'sign_in' then
      if not found
         or v_parent.organization_id is distinct from new.organization_id
         or v_parent.superseded_at is null
         or v_parent.purpose is distinct from new.purpose
         or v_parent.origin is distinct from new.origin
         or v_parent.person_id is distinct from new.person_id
         or new.resend_count is distinct from v_parent.resend_count + 1 then
        raise exception 'account_invitations: a sign-in resend must follow a superseded sign-in invitation of the same organization, origin and person, with resend_count = parent + 1'
          using errcode = 'insufficient_privilege';
      end if;
    elsif not found
       or v_parent.organization_id is distinct from new.organization_id
       or v_parent.superseded_at is null
       or v_parent.purpose is distinct from new.purpose
       or v_parent.origin is distinct from new.origin
       or v_parent.email_normalized is distinct from new.email_normalized
       or v_parent.person_id is distinct from new.person_id
       or new.resend_count is distinct from v_parent.resend_count + 1 then
      raise exception 'account_invitations: a resend must follow a superseded invitation of the same organization, purpose and address, with resend_count = parent + 1'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end
$$;

revoke all on function presby_account_invitations_guard_insert() from public, presby_app, presby_platform;

comment on constraint account_invitations_purpose_allowed on account_invitations is
  'founding_administrator | treasurer (0059) | sign_in (drizzle/0065 section 5). Forward-only once a sign_in row exists.';
comment on constraint account_invitations_origin_allowed on account_invitations is
  'platform (0059) | org (drizzle/0065 section 5): who sent it. Tied to purpose by account_invitations_purpose_origin_tie.';
comment on constraint account_invitations_purpose_origin_tie on account_invitations is
  'A sign_in invitation is always origin org, and an org-origin invitation is always sign_in (drizzle/0065 section 5).';
comment on constraint account_invitations_sign_in_has_person on account_invitations is
  'R34: a sign_in invitation names its person at creation (the twin of treasurer_has_person; drizzle/0065 section 5).';
comment on index account_invitations_open_address_uq is
  'At most one open invitation per (organization, purpose, address) for every purpose except sign_in (R28; re-predicated by drizzle/0065 section 5, same name as 0059). Open = not accepted, revoked, superseded or blocked; expiry is outside the predicate.';
comment on index account_invitations_open_sign_in_person_uq is
  'At most one open sign_in invitation per (organization, person) (drizzle/0065 section 5). Expiry is outside the predicate: an expired open row blocks until superseded.';
comment on index account_invitations_person_created_ix is
  'The sign-in reader''s per-person newest-first scan (drizzle/0065 section 5).';
comment on function presby_account_invitations_guard_insert() is
  'BEFORE INSERT on account_invitations (0059 section 3a; re-created by drizzle/0065 section 5). Rows are born open; founding_administrator names its person only at acceptance; sign_in names its person at creation; a resend follows a superseded parent of the same organization, purpose, origin and person with resend_count = parent + 1, and for every purpose but sign_in the same address (R33, F197).';

-- ---------------------------------------------------------------------------
-- 6. people_guard_user_link (F186; DECISION-208 as amended, A1)
-- ---------------------------------------------------------------------------
-- people.user_id is the identity binding presby_user_organizations resolves.
-- Before this file presby_app could UPDATE it freely. The guard refuses a
-- link transition (an INSERT with a non-null user_id, or any change of
-- user_id) whenever current_user is not the owner of people. Deny by
-- default, with no role named: presby_platform also holds INSERT and UPDATE
-- on people, including user_id, and is expected to become a login one day.
-- No marker: any presby_app statement could arm a GUC, so a marker guards
-- nothing on the one connection the finding is about.
--
-- Passes: every owner path (fixtures, getPlatformDb(), the FK ON DELETE SET
-- NULL action, which runs as the owner of people) and every SECURITY DEFINER
-- function owned by the table owner. After A2 the function bodies that write
-- the column are exactly presby__bind_person_account (the `update ... where
-- user_id is null`) and presby__accept_invitation_core (the created_person
-- insert). Accepted residual, `paper`: the owner path is unbound, mitigated by
-- the A2 source scan in boundaries.test.ts.
create or replace function presby_guard_people_user_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
begin
  select c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
    into v_owner
    from pg_class c
   where c.oid = tg_relid;
  if coalesce(v_owner, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is not null then
      raise exception 'people: user_id is bound only on the owner path, by invitation acceptance or by sign-in connection'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.user_id is distinct from old.user_id then
    raise exception 'people: user_id is bound only on the owner path, by invitation acceptance or by sign-in connection'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

revoke all on function presby_guard_people_user_link() from public, presby_app, presby_platform;

drop trigger if exists people_guard_user_link on people;
create trigger people_guard_user_link
  before insert or update of user_id on people
  for each row execute function presby_guard_people_user_link();

comment on function presby_guard_people_user_link() is
  'BEFORE INSERT OR UPDATE OF user_id on people, invoker (drizzle/0065 section 6, F186, DECISION-208). Refuses a link transition (insert with a non-null user_id, any change of user_id) by every role that is not the table owner. Owner test: pg_class.relowner against current_user, no role named, no marker.';
comment on column people.user_id is
  'The identity binding: one human, one login (presby_user_organizations resolves user -> person -> memberships). Written only on the owner path, by invitation acceptance and by sign-in connection (presby__bind_person_account; the accept core''s created_person insert). people_guard_user_link refuses every non-owner role (drizzle/0065 section 6). Residual, paper: the owner path is unbound (A2 source scan).';

-- ---------------------------------------------------------------------------
-- 7. the 0064 guard's message (R43)
-- ---------------------------------------------------------------------------
-- Re-created from the LIVE definition (identical to 0064's text, Phase 4
-- kickoff step 6) with exactly the two message strings changed: "verified_at
-- is set only by presby_accept_invitation()" named one writer, and sign-in
-- connection is the second. Behaviour is byte-identical.
-- contact_methods.verified_at is an OUTPUT of linking and an input to nothing
-- (R43): no proof reads it.
create or replace function presby_contact_methods_guard_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
begin
  select c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
    into v_owner
    from pg_class c
   where c.oid = tg_relid;
  v_owner := coalesce(v_owner, false);

  if tg_op = 'INSERT' then
    if not v_owner then
      if new.verified_at is not null then
        raise exception 'contact_methods: verified_at is set only on the owner path, by invitation acceptance or by sign-in connection; a new address starts unverified'
          using errcode = 'insufficient_privilege';
      end if;
      if new.ended_at is not null then
        raise exception 'contact_methods: a new address starts active; end it with a later update'
          using errcode = 'insufficient_privilege';
      end if;
      new.created_at := clock_timestamp();
    end if;
    return new;
  end if;

  -- UPDATE
  if old.ended_at is not null then
    raise exception 'contact_methods: row % is ended and cannot change; add a new address instead', old.id
      using errcode = 'insufficient_privilege';
  end if;
  if new.id is distinct from old.id
     or new.person_id is distinct from old.person_id
     or new.kind is distinct from old.kind
     or new.value is distinct from old.value
     or new.created_at is distinct from old.created_at then
    raise exception 'contact_methods: id, person_id, kind, value and created_at are immutable; end the row and insert a replacement'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_owner and new.verified_at is distinct from old.verified_at then
    raise exception 'contact_methods: verified_at is set only on the owner path, by invitation acceptance or by sign-in connection'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

revoke all on function presby_contact_methods_guard_write() from public, presby_app, presby_platform;

comment on function presby_contact_methods_guard_write() is
  'BEFORE INSERT OR UPDATE on contact_methods, invoker, binds every role (drizzle/0064 section 6; message re-stated by drizzle/0065 section 7, R43). Identity (id, person_id, kind, value, created_at) is immutable and an ended row is frozen; a non-owner may not set or change verified_at (set only on the owner path, by invitation acceptance or sign-in connection), may not insert an ended row, and has created_at forced to clock_timestamp(). Owner test: pg_class.relowner against current_user, no role named.';
comment on column contact_methods.verified_at is
  'Proof the person controls this address, set when a sign-in is linked to the person. Set only on the owner path, by invitation acceptance or by sign-in connection (presby__bind_person_account); contact_methods_guard_write refuses a non-owner insert or change. An OUTPUT of linking, never an input to any proof (R43): account proof is users.email_verified. A replacement or re-added address starts null.';

-- ---------------------------------------------------------------------------
-- 8. toggle seed: org_portal.sign_in_connect (R47; DECISION-226)
-- ---------------------------------------------------------------------------
-- Auto-connect is on for every existing congregation, as explicit rows, so
-- DECISION-097's "a missing row is off" stays unconditional. `do nothing`
-- means a re-apply never switches back on an organization that switched it
-- off. Organizations created after this file get a row from
-- createOrganization() through the catalog's provisionedOn: true (Batch B1).
-- Organizations created by raw SQL (the e2e and Vitest fixtures) get none and
-- are off, which keeps every existing fixture from auto-connecting.
-- updated_by is null: a provisioning write has no acting user.
insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
select o.id, 'org_portal.sign_in_connect', true, null
  from organizations o
on conflict (organization_id, feature_key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. audit index (the reader's connected_via date)
-- ---------------------------------------------------------------------------
-- A plain build on an append-only table takes a brief write lock; production
-- had 661 audit rows at measurement (P4).
create index if not exists audit_events_sign_in_connected_ix
  on audit_events ((metadata->>'organizationId'), (metadata->>'personId'))
  where action = 'tenant.person.sign_in_connected';

comment on index audit_events_sign_in_connected_ix is
  'tenant.person.sign_in_connected rows by (organization, person): the sign-in reader''s connected_via / connected_on (drizzle/0065 section 9).';

-- ---------------------------------------------------------------------------
-- 10. proof writers (R38; DECISION-225)
-- ---------------------------------------------------------------------------
-- Both SECURITY DEFINER on the owner path, so section 3's guard passes them;
-- EXECUTE to presby_app only, never presby_platform.
--
-- presby_record_google_email_proof(user, address): stamps an active, unstamped
-- account whose address equals the Google-asserted address (case-insensitive,
-- trimmed). Returns whether it stamped. A different address, a null argument,
-- an inactive or already-stamped account stamps nothing and returns false.
-- Accepted residual, `paper` (F187 class): the database cannot check a Google
-- ID token, so any presby_app caller can call it. Mitigations: the single
-- call-site scan (src/auth.ts only, inside the provider === "google" block),
-- and it only ever records a stamp for the account's own current address.
create or replace function presby_record_google_email_proof(p_user_id uuid, p_address text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_n bigint;
begin
  if p_user_id is null or p_address is null then
    return false;
  end if;
  update users
     set email_verified = clock_timestamp()
   where id = p_user_id
     and is_active
     and email_verified is null
     and lower(email) = lower(btrim(p_address));
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- presby_complete_email_change(token hash): the verify-email page's change,
-- moved behind a definer so the new address is stamped as proven in the same
-- statement that writes it (the verification token proves the new mailbox).
-- Outcomes (EMAIL_CHANGE_OUTCOMES, pinned to these literals):
--   invalid     no such token (or no such account)        nothing written
--   expired     the token's expires_at has passed          the token row is deleted (today's behaviour)
--   email_taken the new address is another account's       nothing written; the token stays (today's behaviour)
--               (users_email_unique or users_email_lower_uq)
--   ok          email and email_verified written in one statement, the token deleted;
--               returns the account and the old and new address so TypeScript
--               writes the existing user.email_changed audit row in the same
--               transaction.
-- Lock order: the token row FOR UPDATE, then the account FOR UPDATE; a second
-- concurrent use of the same token waits, then finds no row (invalid).
-- Residual, `paper` (F187 class): presby_app can write
-- email_verification_tokens itself, so this stamp is as strong as the
-- application's token issuance; it is never weaker than the address the
-- account already had.
create or replace function presby_complete_email_change(p_token_hash text)
returns table (outcome text, user_id uuid, old_email text, new_email text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_tok email_verification_tokens%rowtype;
  v_old text;
  v_con text;
begin
  if p_token_hash is null then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_tok from email_verification_tokens t where t.token = p_token_hash for update;
  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_tok.expires_at < clock_timestamp() then
    delete from email_verification_tokens t where t.id = v_tok.id;
    return query select 'expired'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select u.email into v_old from users u where u.id = v_tok.user_id for update;
  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  begin
    update users u
       set email = v_tok.new_email,
           email_verified = clock_timestamp()
     where u.id = v_tok.user_id;
  exception
    when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con in ('users_email_unique', 'users_email_lower_uq') then
        return query select 'email_taken'::text, null::uuid, null::text, null::text;
        return;
      end if;
      raise;
  end;

  delete from email_verification_tokens t where t.id = v_tok.id;
  return query select 'ok'::text, v_tok.user_id, v_old, v_tok.new_email;
end $$;

revoke all on function presby_record_google_email_proof(uuid, text) from public, presby_app, presby_platform;
revoke all on function presby_complete_email_change(text) from public, presby_app, presby_platform;
grant execute on function presby_record_google_email_proof(uuid, text) to presby_app;
grant execute on function presby_complete_email_change(text) to presby_app;

comment on function presby_record_google_email_proof(uuid, text) is
  'R38 (drizzle/0065 section 10, DECISION-225). SECURITY DEFINER, owner path. Stamps users.email_verified for an active, unstamped account whose address equals the Google-asserted address; returns whether it stamped. Called only from src/auth.ts (lib/auth/email-proof.ts) after F231''s gate. Residual, paper: the database cannot check the ID token (F187 class).';
comment on function presby_complete_email_change(text) is
  'R38 (drizzle/0065 section 10, DECISION-225). SECURITY DEFINER, owner path. Consumes an email_verification_tokens row by hash and writes users.email and email_verified in one statement. Outcomes: invalid | expired (token deleted) | email_taken (nothing written) | ok (token deleted; returns the account and the old and new address for the caller''s user.email_changed audit row).';

-- ---------------------------------------------------------------------------
-- 11. helpers and the standing core (R40, R44, S13)
-- ---------------------------------------------------------------------------
-- 11a. presby_membership_standing (S13; Increment 3's R50, introduced here
-- with today's semantics). A plain IMMUTABLE SQL function with no definer
-- and no SET clause, so the planner can inline it; it reads no relation.
-- First match wins:
--   listed        roll active | baptized | affiliate | other_participant, or
--                 engagement regular
--   staff_anchor  engagement staff
--   visitor       engagement visitor
--   inactive      engagement inactive | moved_away
--   unclassified  anything else (an unknown roll or engagement): limited
--                 standing, so it fails closed
-- 2b's callers test standing = 'visitor' only (the Community Visitors list's
-- predicate, F177 condition 3). The one documented difference, fail-closed:
-- a visitor-engagement membership carrying an UNLISTED non-null roll is
-- 'visitor' here but not on today's Visitors list (Phase 3 amendment 2, 1.2
-- item 6). Called from exactly one function body, the standing core (11c).
create or replace function presby_membership_standing(p_current_roll text, p_engagement_status text)
returns text
language sql
immutable
as $$
  select case
           when p_current_roll in ('active', 'baptized', 'affiliate', 'other_participant')
                or p_engagement_status = 'regular' then 'listed'
           when p_engagement_status = 'staff' then 'staff_anchor'
           when p_engagement_status = 'visitor' then 'visitor'
           when p_engagement_status in ('inactive', 'moved_away') then 'inactive'
           else 'unclassified'
         end
$$;

-- 11b. The ONE uniform identity-refusal literal for every sign-in invitation
-- callable (the 0052/0061 shape). INVOKER, touches no table. presby_app keeps
-- EXECUTE so a non-owner caller sees this literal and never a second
-- "permission denied for function" string.
create or replace function presby_deny_sign_in_invitation()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'account_invitations: this sign-in invitation action is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

-- 11c. presby__actor_person (S6, new code only). The sender's live person id
-- when that person is an active member of p_org holding p_key; null
-- otherwise. p_user_id is a users.id the application binds from the session.
-- people.user_id is not unique, so one row is chosen deterministically.
-- presby_has_permission reads presby_effective_permissions, which only
-- answers for presby_current_org(): every caller passes that organization.
-- Owner only (no grant).
create or replace function presby__actor_person(p_org uuid, p_user_id uuid, p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_person uuid;
begin
  if p_org is null or p_user_id is null or p_key is null then
    return null;
  end if;
  select pe.id into v_person
    from people pe
   where pe.user_id = p_user_id and pe.merged_into_id is null
     and presby_membership_is_active(pe.id, p_org)
     and presby_has_permission(pe.id, p_org, p_key)
   order by pe.created_at, pe.id
   limit 1;
  return v_person;
end $$;

-- 11d. presby__person_sign_in_standing: THE STANDING CORE (R40). The one
-- place that knows what makes a person eligible to be bound to a sign-in at
-- p_org. Every caller (issue and resend through presby_sign_in__check, the
-- token and in-place sign_in acceptance, connect, card standing) maps its
-- output through one fixed table (Phase 3 amendment 2 section 5.7) and never
-- re-codes any part of it. Exactly one row, always.
--
--   refusal          person_merged > person_deceased > membership_ended (the
--                    membership at p_org is ended, OR there is no membership
--                    at p_org at all: fail closed; callers that need
--                    not_found check the row first) > person_elsewhere (a
--                    membership at ANY other organization, live or ended,
--                    R31) > null
--   standing         presby_membership_standing() of the live membership at
--                    p_org; null when that membership is ended or missing
--   session_seat,    an open or future seat (ends_on null or after today, NO
--   diaconate_seat   starts_on bound) in p_org's derived session / diaconate
--                    group, read from group_memberships so whichever offices
--                    materialize there (Increment 2's pastors included) count
--   role_keys,       the set T (Phase 3 Refinement 3, A4, A5): roles, and
--   permission_keys  their permission keys, held through person-arm
--                    role_grants and through role_grants of any group the
--                    person belongs to that is NOT one of the closed list of
--                    derived kinds below; every row ends_on null or after
--                    today, no starts_on bound. A derived group with any
--                    other (or a null) derived_from counts in T until it is
--                    classified (fails closed). Commission and delegation
--                    (resolver arms 3 and 4) are not modelled: they reach
--                    only people with a membership elsewhere, which
--                    person_elsewhere refuses first.
--   authority_bearing  session_seat or diaconate_seat or any role in T
--
-- Global by construction (connect and in-place have no organization
-- context), so it reads role_grants directly and never calls
-- presby_effective_permissions (which answers only for the current org).
-- Owner only (no grant).
create or replace function presby__person_sign_in_standing(p_person uuid, p_org uuid)
returns table (refusal text, standing text, authority_bearing boolean,
               session_seat boolean, diaconate_seat boolean,
               role_keys text[], permission_keys text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_merged uuid;
  v_death date;
  v_m memberships%rowtype;
  v_has_m boolean;
  v_elsewhere boolean;
begin
  select p.merged_into_id, p.date_of_death into v_merged, v_death
    from people p where p.id = p_person;

  select * into v_m from memberships m
   where m.person_id = p_person and m.organization_id = p_org;
  v_has_m := found;

  -- R31: any membership at another organization, live or ended.
  v_elsewhere := exists (select 1 from memberships m2
                          where m2.person_id = p_person and m2.organization_id <> p_org);

  refusal := case
               when v_merged is not null then 'person_merged'
               when v_death is not null then 'person_deceased'
               when not v_has_m or v_m.ended_on is not null then 'membership_ended'
               when v_elsewhere then 'person_elsewhere'
               else null
             end;

  standing := case when v_has_m and v_m.ended_on is null
                   then presby_membership_standing(v_m.current_roll, v_m.engagement_status)
              end;

  session_seat := exists (
    select 1 from group_memberships gm
      join groups g on g.id = gm.group_id
     where gm.person_id = p_person and g.organization_id = p_org
       and g.membership_source = 'derived' and g.derived_from = 'session'
       and (gm.ends_on is null or gm.ends_on > current_date));
  diaconate_seat := exists (
    select 1 from group_memberships gm
      join groups g on g.id = gm.group_id
     where gm.person_id = p_person and g.organization_id = p_org
       and g.membership_source = 'derived' and g.derived_from = 'diaconate'
       and (gm.ends_on is null or gm.ends_on > current_date));

  with t as (
    select rg.role_id
      from role_grants rg
     where rg.organization_id = p_org and rg.person_id = p_person
       and (rg.ends_on is null or rg.ends_on > current_date)
    union
    select rg.role_id
      from role_grants rg
      join groups g on g.id = rg.group_id
      join group_memberships gm on gm.group_id = g.id and gm.person_id = p_person
     where rg.organization_id = p_org
       and (rg.ends_on is null or rg.ends_on > current_date)
       and (gm.ends_on is null or gm.ends_on > current_date)
       and not (g.membership_source = 'derived'
                and coalesce(g.derived_from in ('active_membership', 'session', 'diaconate'), false))
  )
  select coalesce((select array_agg(distinct r.key order by r.key)
                     from t join app_roles r on r.id = t.role_id), array[]::text[]),
         coalesce((select array_agg(distinct rp.permission_key order by rp.permission_key)
                     from t join app_role_permissions rp on rp.role_id = t.role_id), array[]::text[])
    into role_keys, permission_keys;

  authority_bearing := session_seat or diaconate_seat or cardinality(role_keys) > 0;
  return next;
end $$;

-- 11e. presby__bind_person_account: THE BIND HELPER (R44). The only function
-- body that runs `update people set user_id` (pinned by a live-catalog scan);
-- its callers are the accept core (linked_person) and connect. Links only
-- from null; any other result raises (P0001, re-raised by the accept core's
-- mapping exactly as its old inline message was, so it surfaces as
-- db_error). Then stamps verified_at on the matching ACTIVE email contact
-- (contact_methods.verified_at is an OUTPUT of linking, never an input, R43)
-- and returns that contact's id and created_at for the connect audit row
-- (both null when no active contact matches, which neither caller allows to
-- happen: each re-checks the contact under a FOR SHARE lock first). Owner
-- only (no grant); people_guard_user_link passes it because current_user
-- inside a definer is the table owner.
create or replace function presby__bind_person_account(p_person uuid, p_user uuid, p_address text)
returns table (contact_method_id uuid, contact_method_created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_n int := 0;
begin
  if p_user is not null then
    update people set user_id = p_user where id = p_person and user_id is null;
    get diagnostics v_n = row_count;
  end if;
  if v_n <> 1 then
    raise exception 'presby__bind_person_account: person % could not be linked', p_person;
  end if;

  update contact_methods cm
     set verified_at = now()
   where cm.person_id = p_person and cm.kind = 'email' and cm.ended_at is null
     and lower(btrim(cm.value)) = lower(btrim(p_address))
     and cm.verified_at is null;

  select cm.id, cm.created_at into contact_method_id, contact_method_created_at
    from contact_methods cm
   where cm.person_id = p_person and cm.kind = 'email' and cm.ended_at is null
     and lower(btrim(cm.value)) = lower(btrim(p_address))
   order by cm.is_primary desc, cm.created_at, cm.id
   limit 1;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 12. issue core and callables (Phase 3 "API Contract", amended by Phase 3
--     amendment 2 section 5.8)
-- ---------------------------------------------------------------------------
-- Every callable: the organization is presby_current_org(); the actor is a
-- users.id bound server-side from the session and resolved by
-- presby__actor_person. Identity refusals (no organization, a null actor, an
-- actor who is not an active member holding people.manage) raise the ONE
-- literal through presby_deny_sign_in_invitation(). State refusals are typed
-- outcomes, exactly one row per call, id columns null and booleans false on a
-- non-ok outcome (already_pending's existing_invitation_expired and
-- cooldown's next_resend_at are the two outcome-specific answers). Every
-- read carries the organization (or the membership join) explicitly: the
-- definer bypasses RLS, so that predicate is the whole isolation (0061).
--
-- LOCK ORDER, shared with acceptance and connect: organization, invitation,
-- users, person, contact method.
--
-- LIMITS (SIGN_IN_INVITATION_LIMITS, pinned to these literals): inside the
-- organization lock, rolling 24 hours, origin = 'org' rows only, bounded
-- created_at <= now() (the 2099 fixtures): 30 per organization, 30 per
-- inviter, 3 per (organization, address); a resend counts as a send. Cooldown
-- 5 minutes; 5 resends per chain (the 0059 CHECK's cap).

-- 12a. presby_sign_in__check: the shared eligibility check issue and resend
-- both call, so the two cannot drift. First failure wins (membership at this
-- organization comes before any state answer, so a foreign id is not_found):
--   not_found -> person_merged | person_deceased | membership_ended (core)
--   -> already_signs_in -> needs_support (core person_elsewhere)
--   -> needs_officers_permission -> exceeds_your_access
--   -> no_email_on_file | address_changed -> address_is_yours
--   -> address_shared -> needs_acknowledgement -> ok
-- The address is presby_person_email(person, 'credential'): the active main.
-- address_ambiguous and address_invalid no longer exist (one active main is a
-- database property; contact_methods_value_shape is a strict subset of the
-- invitation's shape CHECK). The only users row read is the sender's own
-- (DECISION-189). Owner only (no grant).
create or replace function presby_sign_in__check(
  p_org uuid, p_sender_person uuid, p_sender_user uuid, p_person_id uuid,
  p_confirmed_address text, p_acknowledged boolean)
returns table (outcome text, address text, recipient_first_name text, ack_reasons text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_st record;
  v_user_id uuid;
  v_first text;
  v_addr record;
  v_has_addr boolean;
  v_sender_email text;
  v_reasons text[] := array[]::text[];
begin
  -- 1. not_found: no membership of that person at this organization.
  if p_person_id is null
     or not exists (select 1 from memberships m
                     where m.person_id = p_person_id and m.organization_id = p_org) then
    outcome := 'not_found';
    return next;
    return;
  end if;

  select * into v_st from presby__person_sign_in_standing(p_person_id, p_org);

  -- 2. the core's own-organization refusals.
  if v_st.refusal in ('person_merged', 'person_deceased', 'membership_ended') then
    outcome := v_st.refusal;
    return next;
    return;
  end if;

  -- 3. already linked (this also covers the sender's own record).
  select p.user_id, coalesce(nullif(btrim(p.preferred_name), ''), p.first_name)
    into v_user_id, v_first
    from people p where p.id = p_person_id;
  if v_user_id is not null then
    outcome := 'already_signs_in';
    return next;
    return;
  end if;

  -- 4. R31, collapsed for the sender.
  if v_st.refusal = 'person_elsewhere' then
    outcome := 'needs_support';
    return next;
    return;
  end if;

  -- 5. a Session or diaconate seat needs officers.manage.
  if (v_st.session_seat or v_st.diaconate_seat)
     and not presby_has_permission(p_sender_person, p_org, 'officers.manage') then
    outcome := 'needs_officers_permission';
    return next;
    return;
  end if;

  -- 6. R21: T must be a subset of the sender's own effective permissions today.
  if exists (select 1 from unnest(v_st.permission_keys) k(key)
              where not exists (select 1 from presby_effective_permissions(p_sender_person, p_org, current_date) e
                                 where e.permission_key = k.key)) then
    outcome := 'exceeds_your_access';
    return next;
    return;
  end if;

  -- 7. the address.
  select * into v_addr from presby_person_email(p_person_id, 'credential');
  v_has_addr := found;
  if not v_has_addr then
    outcome := 'no_email_on_file';
    return next;
    return;
  end if;
  if lower(btrim(p_confirmed_address)) is distinct from lower(btrim(v_addr.address)) then
    outcome := 'address_changed';
    return next;
    return;
  end if;

  -- 8. the sender's own address on someone else's record.
  select lower(btrim(u.email)) into v_sender_email from users u where u.id = p_sender_user;
  if p_person_id is distinct from p_sender_person
     and v_sender_email = lower(btrim(v_addr.address)) then
    outcome := 'address_is_yours';
    return next;
    return;
  end if;

  -- 9. R29: another unmerged, living person with a live membership at THIS
  -- organization holds the address as an active email. Own rows only.
  if exists (select 1 from contact_methods cm
               join people p2 on p2.id = cm.person_id
               join memberships m2 on m2.person_id = p2.id and m2.organization_id = p_org
                                  and m2.ended_on is null
              where cm.kind = 'email' and cm.ended_at is null
                and lower(btrim(cm.value)) = lower(btrim(v_addr.address))
                and p2.id <> p_person_id
                and p2.merged_into_id is null and p2.date_of_death is null) then
    outcome := 'address_shared';
    return next;
    return;
  end if;

  -- 10. acknowledgements the DEFINER enforces (F177 condition 1).
  if v_addr.do_not_contact then
    v_reasons := v_reasons || 'do_not_contact'::text;
  end if;
  if v_st.standing = 'visitor' then
    v_reasons := v_reasons || 'visitor'::text;
  end if;
  if cardinality(v_reasons) > 0 and not coalesce(p_acknowledged, false) then
    outcome := 'needs_acknowledgement';
    ack_reasons := v_reasons;
    return next;
    return;
  end if;

  outcome := 'ok';
  address := v_addr.address;
  recipient_first_name := v_first;
  ack_reasons := v_reasons;
  return next;
end $$;

-- 12b. presby_issue_sign_in_invitation. Order: identity; organization lock;
-- an OPEN sign_in row for the person -> already_pending (with whether it has
-- expired, so the card can offer Send again); the shared check; the limits;
-- insert. The audit row and the email_queue row are TypeScript's, in the same
-- transaction (p_email_queue_id is that row's id).
create or replace function presby_issue_sign_in_invitation(
  p_person_id uuid, p_token_hash text, p_expires_at timestamptz, p_email_queue_id uuid,
  p_confirmed_address text, p_acknowledged boolean, p_issued_by uuid)
returns table (outcome text, invitation_id uuid, address text, recipient_first_name text,
               organization_name text, sender_name text, invitation_expires_at timestamptz,
               ack_reasons text[], existing_invitation_expired boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_sender uuid;
  v_org_name text;
  v_open_expires timestamptz;
  v_chk record;
  v_id uuid;
begin
  if v_org is null or p_issued_by is null then
    perform presby_deny_sign_in_invitation();
  end if;
  v_sender := presby__actor_person(v_org, p_issued_by, 'people.manage');
  if v_sender is null then
    perform presby_deny_sign_in_invitation();
  end if;

  existing_invitation_expired := false;

  select o.name into v_org_name from organizations o where o.id = v_org for update;

  select i.expires_at into v_open_expires
    from account_invitations i
   where i.organization_id = v_org and i.purpose = 'sign_in' and i.person_id = p_person_id
     and i.accepted_at is null and i.revoked_at is null
     and i.superseded_at is null and i.blocked_at is null
   limit 1;
  if found then
    outcome := 'already_pending';
    existing_invitation_expired := v_open_expires <= now();
    return next;
    return;
  end if;

  select * into v_chk
    from presby_sign_in__check(v_org, v_sender, p_issued_by, p_person_id, p_confirmed_address, p_acknowledged);
  if v_chk.outcome <> 'ok' then
    outcome := v_chk.outcome;
    if v_chk.outcome = 'needs_acknowledgement' then
      ack_reasons := v_chk.ack_reasons;
    end if;
    return next;
    return;
  end if;

  if (select count(*) from account_invitations i
       where i.organization_id = v_org and i.origin = 'org'
         and i.created_at > now() - interval '24 hours' and i.created_at <= now()) >= 30
     or (select count(*) from account_invitations i
          where i.created_by_user_id = p_issued_by and i.origin = 'org'
            and i.created_at > now() - interval '24 hours' and i.created_at <= now()) >= 30
     or (select count(*) from account_invitations i
          where i.organization_id = v_org and i.origin = 'org' and i.email_normalized = v_chk.address
            and i.created_at > now() - interval '24 hours' and i.created_at <= now()) >= 3 then
    outcome := 'rate_limited';
    return next;
    return;
  end if;

  insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id,
                                   token_hash, created_by_user_id, expires_at, email_queue_id)
  values (v_org, 'sign_in', 'org', v_chk.address, p_person_id,
          p_token_hash, p_issued_by, p_expires_at, p_email_queue_id)
  returning id into v_id;

  outcome := 'ok';
  invitation_id := v_id;
  address := v_chk.address;
  recipient_first_name := v_chk.recipient_first_name;
  organization_name := v_org_name;
  select left(coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name, 100)
    into sender_name from people p where p.id = v_sender;
  invitation_expires_at := p_expires_at;
  ack_reasons := v_chk.ack_reasons;
  return next;
end $$;

-- 12c. presby_resend_sign_in_invitation. Order: identity; organization lock;
-- the person's open row FOR UPDATE (none: not_open); cooldown (5 minutes from
-- the open row's created_at; returns next_resend_at); chain_cap (5); the
-- shared check (which RE-READS the current address, the fix for a typo); the
-- limits; supersede the old row, then insert the successor with
-- resent_from_id and resend_count + 1 (R33: the guard compares organization,
-- purpose, origin and person, not the address). Returns the superseded row's
-- email_queue_id so TypeScript cancels a still-queued email in the same
-- transaction.
create or replace function presby_resend_sign_in_invitation(
  p_person_id uuid, p_token_hash text, p_expires_at timestamptz, p_email_queue_id uuid,
  p_confirmed_address text, p_acknowledged boolean, p_issued_by uuid)
returns table (outcome text, invitation_id uuid, cancel_email_queue_id uuid, address text,
               recipient_first_name text, organization_name text, sender_name text,
               invitation_expires_at timestamptz, ack_reasons text[], next_resend_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_sender uuid;
  v_org_name text;
  v_old account_invitations%rowtype;
  v_chk record;
  v_id uuid;
begin
  if v_org is null or p_issued_by is null then
    perform presby_deny_sign_in_invitation();
  end if;
  v_sender := presby__actor_person(v_org, p_issued_by, 'people.manage');
  if v_sender is null then
    perform presby_deny_sign_in_invitation();
  end if;

  select o.name into v_org_name from organizations o where o.id = v_org for update;

  select * into v_old
    from account_invitations i
   where i.organization_id = v_org and i.purpose = 'sign_in' and i.person_id = p_person_id
     and i.accepted_at is null and i.revoked_at is null
     and i.superseded_at is null and i.blocked_at is null
     for update;
  if not found then
    outcome := 'not_open';
    return next;
    return;
  end if;

  if v_old.created_at + interval '5 minutes' > now() then
    outcome := 'cooldown';
    next_resend_at := v_old.created_at + interval '5 minutes';
    return next;
    return;
  end if;

  if v_old.resend_count >= 5 then
    outcome := 'chain_cap';
    return next;
    return;
  end if;

  select * into v_chk
    from presby_sign_in__check(v_org, v_sender, p_issued_by, p_person_id, p_confirmed_address, p_acknowledged);
  if v_chk.outcome <> 'ok' then
    outcome := v_chk.outcome;
    if v_chk.outcome = 'needs_acknowledgement' then
      ack_reasons := v_chk.ack_reasons;
    end if;
    return next;
    return;
  end if;

  if (select count(*) from account_invitations i
       where i.organization_id = v_org and i.origin = 'org'
         and i.created_at > now() - interval '24 hours' and i.created_at <= now()) >= 30
     or (select count(*) from account_invitations i
          where i.created_by_user_id = p_issued_by and i.origin = 'org'
            and i.created_at > now() - interval '24 hours' and i.created_at <= now()) >= 30
     or (select count(*) from account_invitations i
          where i.organization_id = v_org and i.origin = 'org' and i.email_normalized = v_chk.address
            and i.created_at > now() - interval '24 hours' and i.created_at <= now()) >= 3 then
    outcome := 'rate_limited';
    return next;
    return;
  end if;

  update account_invitations set superseded_at = now() where id = v_old.id;

  insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id,
                                   token_hash, created_by_user_id, expires_at, email_queue_id,
                                   resent_from_id, resend_count)
  values (v_org, 'sign_in', 'org', v_chk.address, p_person_id,
          p_token_hash, p_issued_by, p_expires_at, p_email_queue_id,
          v_old.id, v_old.resend_count + 1)
  returning id into v_id;

  outcome := 'ok';
  invitation_id := v_id;
  cancel_email_queue_id := v_old.email_queue_id;
  address := v_chk.address;
  recipient_first_name := v_chk.recipient_first_name;
  organization_name := v_org_name;
  select left(coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name, 100)
    into sender_name from people p where p.id = v_sender;
  invitation_expires_at := p_expires_at;
  ack_reasons := v_chk.ack_reasons;
  next_resend_at := now() + interval '5 minutes';
  return next;
end $$;

-- 12d. presby_revoke_sign_in_invitation. people.manage only (cancelling is
-- never an escalation); organization lock; the person's open row FOR UPDATE
-- (none: not_open); revoked_at and revoked_by_user_id (the 0059 guard allows
-- open -> revoked on the owner path). Terminal; refunds no limit
-- (DECISION-189).
create or replace function presby_revoke_sign_in_invitation(p_person_id uuid, p_revoked_by uuid)
returns table (outcome text, invitation_id uuid, cancel_email_queue_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_old account_invitations%rowtype;
begin
  if v_org is null or p_revoked_by is null
     or presby__actor_person(v_org, p_revoked_by, 'people.manage') is null then
    perform presby_deny_sign_in_invitation();
  end if;

  perform 1 from organizations o where o.id = v_org for update;

  select * into v_old
    from account_invitations i
   where i.organization_id = v_org and i.purpose = 'sign_in' and i.person_id = p_person_id
     and i.accepted_at is null and i.revoked_at is null
     and i.superseded_at is null and i.blocked_at is null
     for update;
  if not found then
    outcome := 'not_open';
    return next;
    return;
  end if;

  update account_invitations
     set revoked_at = now(), revoked_by_user_id = p_revoked_by
   where id = v_old.id;

  outcome := 'ok';
  invitation_id := v_old.id;
  cancel_email_queue_id := v_old.email_queue_id;
  return next;
end $$;

-- 12e. presby_sign_in_invitation_states: the closed-shape reader (R30, plus
-- connected_via / connected_on, R42). Gate: an active member holding
-- people.manage, else the uniform literal. 1 to 500 ids, else it raises. An
-- id with no membership at this organization is OMITTED (indistinguishable
-- from an id that does not exist). One row per eligible person:
--   linked          people.user_id is not null (never read from users), and it
--                   takes precedence: state signs_in, invitation columns null
--   state           from the open sign_in row, else the newest
--                   non-superseded terminal row: pending | expired (open and
--                   past expires_at) | blocked | revoked | none
--   invited_address returned ONLY while address_current (the invited address
--                   is still one of the person's active emails), so the reader
--                   never surfaces an address that has left the record
--   outcome         only for blocked: membership_ended | person_merged |
--                   person_deceased | needs_support (the collapse of
--                   person_elsewhere, person_linked_elsewhere, ambiguous_person)
--   queue_*         the four inputs deliveryState() takes, reached only
--                   through this organization's own row's email_queue_id
--   connected_via   for a linked person: 'invitation' (this organization's
--   connected_on    accepted account_invitations row for the person) or
--                   'sign_in' (this organization's
--                   tenant.person.sign_in_connected audit row for the person,
--                   audit_events_sign_in_connected_ix), whichever is earlier;
--                   null when linked another way (a seed, a fixture). Never
--                   from users (DECISION-189; G20a is the accepted residual)
-- Never returned: token_hash, any email_queue address, subject, body,
-- provider id or failure text, created_by_user_id, the raw blocked_reason,
-- any other organization's row.
create or replace function presby_sign_in_invitation_states(p_person_ids uuid[], p_actor_user_id uuid)
returns table (person_id uuid, linked boolean, state text, sent_at timestamptz,
               expires_at timestamptz, resend_count integer, next_resend_at timestamptz,
               invited_address text, address_current boolean, outcome text,
               queue_status text, queue_delivered_at timestamptz,
               queue_bounced_at timestamptz, queue_complained_at timestamptz,
               connected_via text, connected_on date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
begin
  if v_org is null or p_actor_user_id is null
     or presby__actor_person(v_org, p_actor_user_id, 'people.manage') is null then
    perform presby_deny_sign_in_invitation();
  end if;
  if p_person_ids is null or cardinality(p_person_ids) < 1 or cardinality(p_person_ids) > 500 then
    raise exception 'presby_sign_in_invitation_states: between 1 and 500 person ids'
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  with ppl as (
    select p.id as pid, p.user_id is not null as is_linked
      from people p
     where p.id in (select distinct x from unnest(p_person_ids) x)
       and exists (select 1 from memberships m where m.person_id = p.id and m.organization_id = v_org)
  ), pick as (
    select ppl.pid, ppl.is_linked, r.*,
           (r.id is not null and r.accepted_at is null and r.revoked_at is null and r.blocked_at is null) as is_open,
           (r.id is not null and exists (
              select 1 from contact_methods cm
               where cm.person_id = ppl.pid and cm.kind = 'email' and cm.ended_at is null
                 and lower(btrim(cm.value)) = r.email_normalized)) as is_current
      from ppl
      left join lateral (
        select i.* from account_invitations i
         where i.organization_id = v_org and i.purpose = 'sign_in' and i.person_id = ppl.pid
           and i.superseded_at is null
         order by (i.accepted_at is null and i.revoked_at is null and i.blocked_at is null) desc,
                  i.created_at desc, i.id
         limit 1) r on true
  ), shown as (
    select k.*,
           case when k.is_linked then 'signs_in'
                when k.id is null then 'none'
                when k.is_open and k.expires_at <= now() then 'expired'
                when k.is_open then 'pending'
                when k.blocked_at is not null then 'blocked'
                when k.revoked_at is not null then 'revoked'
                else 'none'
           end as st
      from pick k
  )
  select s.pid,
         s.is_linked,
         s.st,
         case when s.st in ('pending', 'expired', 'blocked', 'revoked') then s.created_at end,
         case when s.st in ('pending', 'expired', 'blocked', 'revoked') then s.expires_at end,
         case when s.st in ('pending', 'expired', 'blocked', 'revoked') then s.resend_count end,
         case when s.st in ('pending', 'expired') then s.created_at + interval '5 minutes' end,
         case when s.st in ('pending', 'expired', 'blocked', 'revoked') and s.is_current
              then s.email_normalized end,
         case when s.st in ('pending', 'expired', 'blocked', 'revoked') then s.is_current end,
         case when s.st = 'blocked' then
                case s.blocked_reason
                  when 'membership_ended' then 'membership_ended'
                  when 'person_merged' then 'person_merged'
                  when 'person_deceased' then 'person_deceased'
                  else 'needs_support'
                end
         end,
         q.status, q.delivered_at, q.bounced_at, q.complained_at,
         c.via, c.at::date
    from shown s
    left join email_queue q
      on q.id = s.email_queue_id and s.st in ('pending', 'expired', 'blocked', 'revoked')
    left join lateral (
      select v.via, v.at from (
        select 'invitation'::text as via, i2.accepted_at as at
          from account_invitations i2
         where i2.organization_id = v_org and i2.person_id = s.pid and i2.accepted_at is not null
        union all
        select 'sign_in'::text, a.created_at
          from audit_events a
         where a.action = 'tenant.person.sign_in_connected'
           and (a.metadata->>'organizationId') = v_org::text
           and (a.metadata->>'personId') = s.pid::text
      ) v
      order by v.at, v.via
      limit 1) c on s.is_linked
   order by s.pid;
end $$;

-- 12f. presby_sign_in_card_standing: the core's answers for ONE person, for
-- the edit page's connect line (R46: own-organization facts only). Gate as
-- the reader; no membership at this organization returns zero rows
-- (indistinguishable from a missing id). address_shared is R29's predicate
-- applied to the person's credential address (false when there is none).
create or replace function presby_sign_in_card_standing(p_person_id uuid, p_actor_user_id uuid)
returns table (standing text, authority_bearing boolean, address_shared boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := presby_current_org();
  v_st record;
  v_addr text;
begin
  if v_org is null or p_actor_user_id is null
     or presby__actor_person(v_org, p_actor_user_id, 'people.manage') is null then
    perform presby_deny_sign_in_invitation();
  end if;
  if p_person_id is null
     or not exists (select 1 from memberships m
                     where m.person_id = p_person_id and m.organization_id = v_org) then
    return;
  end if;

  select * into v_st from presby__person_sign_in_standing(p_person_id, v_org);
  select e.address into v_addr from presby_person_email(p_person_id, 'credential') e;

  standing := v_st.standing;
  authority_bearing := v_st.authority_bearing;
  address_shared := v_addr is not null and exists (
    select 1 from contact_methods cm
      join people p2 on p2.id = cm.person_id
      join memberships m2 on m2.person_id = p2.id and m2.organization_id = v_org
                         and m2.ended_on is null
     where cm.kind = 'email' and cm.ended_at is null
       and lower(btrim(cm.value)) = lower(btrim(v_addr))
       and p2.id <> p_person_id
       and p2.merged_into_id is null and p2.date_of_death is null);
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 13. the accept core and its two presentations (R45, Q2, F196, E1)
-- ---------------------------------------------------------------------------
-- 13a. presby__accept_invitation_core. The live 0064 body of
-- presby_accept_invitation, MOVED, not rewritten (pg_get_functiondef of the
-- live function on the pipeline branch was the source; the diff is recorded
-- in the work-log, Batch A2). The only differences from that body:
--   1. step 1 (the token: null token, hash, id lookup) stays in the wrapper;
--      the core takes the invitation id. The exactly-one-of argument check
--      runs for the token presentation;
--   2. presentation routing: 'token' runs the live steps 2 and 3 untouched;
--      'in_place' runs step 2, then the user gate and the second factor
--      (below); anything else raises internal_error (R35 style). Step 2's
--      re-validation also answers dead for a missing row (unreachable on the
--      token path, whose wrapper resolved the id from an existing row);
--   3. purpose routing (F196): steps 4, 5 and 6 each name founding_
--      administrator, treasurer and sign_in, and end in `else raise ...
--      internal_error`; no branch treats "not X" as "Y". The founding-
--      administrator and treasurer bodies are the live text;
--   4. linked_person calls presby__bind_person_account (R44) instead of the
--      inline `update people set user_id` and its row-count check; the
--      observable behaviour, including the failure mode (db_error), is the
--      same; the created_person insert stays here;
--   5. E1: step 5's unique_violation arm maps users_email_unique AND
--      users_email_lower_uq to account_exists, for every purpose and both
--      presentations.
-- plus the sign_in branch (both presentations): step 2b, the unlocked
-- currency check (the invited address is still an active email of the
-- invitation's person; a miss is dead before any honest non-terminal outcome
-- can be reached); step 4 locks the person, runs the locked FOR SHARE
-- currency re-check (R27's race authority; dead), then the standing core:
-- any refusal blocks with that reason, then person_linked_elsewhere, then for
-- an existing account ambiguous_person or person_elsewhere (the account is
-- already another live person's); the same account on the same person is
-- the harmless no-op (existing_person). Step 5 writes people.user_id through
-- the bind helper and the matching contact's verified_at and NOTHING else.
-- Step 6 returns the four authority columns null.
--
-- In-place (p_presentation = 'in_place', reached only through
-- presby_accept_in_place), gate order so that a foreign id is never an
-- oracle: (1) the row is open, else dead; (2) sign_in: the currency check,
-- else dead; (3) lock the user FOR UPDATE: lower(email) = the invited
-- address AND email_verified is not null AND is_active, any miss is dead;
-- (4) existing_account only (a password hash raises); (5) the second factor:
-- founding_administrator and treasurer always, sign_in when the core says
-- authority_bearing; required = a user_totp row AND p_second_factor_verified,
-- missing = needs_second_factor (non-terminal, nothing written, the token
-- stays live); (6) the purpose gates, unchanged. The definer does not read
-- two_factor_required: an authority-free sign_in follows the token path's G9
-- parity in TypeScript. Everything after step 3 is one code path for both
-- presentations: the blocked reasons, the apply and the claim.
--
-- presby.invitation_accept_active is armed here, and only here, immediately
-- before the claim or blocked update and cleared immediately after (0059's
-- update guard; its two messages are restated in 13f). Owner only (no grant).
create or replace function presby__accept_invitation_core(
  p_invitation_id uuid,
  p_user_id uuid,
  p_password_hash text,
  p_first_name text,
  p_last_name text,
  p_presentation text,
  p_second_factor_verified boolean default false
)
returns table (
  outcome text,
  blocked_reason text,
  invitation_id uuid,
  organization_id uuid,
  organization_slug text,
  purpose text,
  mode text,
  user_id uuid,
  person_id uuid,
  person_mode text,
  created_by_user_id uuid,
  inviter_is_invitee boolean,
  administration_role_key text,
  office_role_key text,
  permission_keys text[],
  treasurer_role_id uuid
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_inv_id uuid := p_invitation_id;
  v_org uuid;
  v_inv account_invitations%rowtype;
  v_org_type text;
  v_slug text;
  v_mode text;
  v_user_id uuid;
  v_user_email text;
  v_user_active boolean;
  v_first text;
  v_last text;
  v_person uuid;
  v_person_mode text;
  v_person_user uuid;
  v_person_merged uuid;
  v_ended date;
  v_found boolean;
  v_n int;
  v_block text := null;
  v_nonterminal text := null;
  v_con text;
  v_msg text;
  v_detail text;
  v_fa record;
  v_tr record;
  v_proven boolean;
  v_factor_ok boolean;
  v_factor_required boolean;
  v_st record;
begin
  -- (Step 1, the token, is the wrapper's: presby_accept_invitation resolves
  -- the id; presby_accept_in_place passes it.)
  if p_presentation = 'token' then
    if (p_user_id is null) = (p_password_hash is null) then
      raise exception 'presby_accept_invitation: exactly one of p_user_id and p_password_hash must be given'
        using errcode = 'invalid_parameter_value';
    end if;
  elsif p_presentation = 'in_place' then
    if p_user_id is null or p_password_hash is not null then
      raise exception 'presby__accept_invitation_core: an in-place acceptance is existing-account only'
        using errcode = 'invalid_parameter_value';
    end if;
  else
    raise exception 'presby__accept_invitation_core: unknown presentation %', p_presentation
      using errcode = 'internal_error';
  end if;
  v_mode := case when p_user_id is not null then 'existing_account' else 'new_account' end;
  -- R42 (a) + (b): a database-enrolled factor AND a session the server
  -- verified. Read here once; used only by the in-place presentation.
  v_factor_ok := coalesce(p_second_factor_verified, false)
                 and exists (select 1 from user_totp t where t.user_id = p_user_id);

  -- Step 2. Organization row first, then the invitation row, re-validated.
  select i.organization_id into v_org from account_invitations i where i.id = v_inv_id;
  select o.organization_type::text, o.slug into v_org_type, v_slug
    from organizations o where o.id = v_org
     for update;
  select * into v_inv from account_invitations i where i.id = v_inv_id for update;
  if not found
     or num_nonnulls(v_inv.accepted_at, v_inv.revoked_at, v_inv.superseded_at, v_inv.blocked_at,
                     v_inv.redacted_at) <> 0
     or v_inv.expires_at <= now() then
    outcome := 'dead';
    return next;
    return;
  end if;

  -- Step 2b (sign_in, both presentations; R27): the invited address must
  -- still be one of the person's ACTIVE emails, else dead with nothing
  -- written, before any honest non-terminal outcome can be reached.
  if v_inv.purpose = 'sign_in'
     and not exists (select 1 from contact_methods cm
                      where cm.person_id = v_inv.person_id and cm.kind = 'email'
                        and cm.ended_at is null
                        and lower(btrim(cm.value)) = v_inv.email_normalized) then
    outcome := 'dead';
    return next;
    return;
  end if;

  -- Step 3. The account.
  if p_presentation = 'in_place' then
    -- The user gate (R45): the account's proven, current address IS the
    -- invited address, and the account is active. Any miss is the one dead,
    -- never email_mismatch or account_inactive: a foreign id is no oracle.
    select u.id, u.email, u.is_active, u.email_verified is not null
      into v_user_id, v_user_email, v_user_active, v_proven
      from users u where u.id = p_user_id
       for update;
    if v_user_id is null or lower(v_user_email) is distinct from v_inv.email_normalized
       or not coalesce(v_user_active, false) or not coalesce(v_proven, false) then
      outcome := 'dead';
      return next;
      return;
    end if;
    v_first := coalesce(nullif(btrim(p_first_name), ''), v_inv.invitee_first_name);
    v_last := coalesce(nullif(btrim(p_last_name), ''), v_inv.invitee_last_name);
    -- The second factor (R42, R45): founding administrator and treasurer
    -- always; sign_in when the standing core says authority_bearing (an
    -- authority-free sign_in follows the token path's G9 parity, enforced in
    -- TypeScript). Missing: needs_second_factor, non-terminal, nothing
    -- written, the invitation stays open.
    if v_inv.purpose = 'founding_administrator' then
      v_factor_required := true;
    elsif v_inv.purpose = 'treasurer' then
      v_factor_required := true;
    elsif v_inv.purpose = 'sign_in' then
      select s.authority_bearing into v_factor_required
        from presby__person_sign_in_standing(v_inv.person_id, v_inv.organization_id) s;
    else
      raise exception 'presby__accept_invitation_core: unknown purpose %', v_inv.purpose
        using errcode = 'internal_error';
    end if;
    if v_factor_required and not v_factor_ok then
      outcome := 'needs_second_factor';
      return next;
      return;
    end if;
  elsif v_mode = 'existing_account' then
    select u.id, u.email, u.is_active into v_user_id, v_user_email, v_user_active
      from users u where u.id = p_user_id
       for update;
    if v_user_id is null or lower(v_user_email) <> v_inv.email_normalized then
      outcome := 'email_mismatch';
      return next;
      return;
    end if;
    if not v_user_active then
      outcome := 'account_inactive';
      return next;
      return;
    end if;
    v_first := coalesce(nullif(btrim(p_first_name), ''), v_inv.invitee_first_name);
    v_last := coalesce(nullif(btrim(p_last_name), ''), v_inv.invitee_last_name);
  else
    if p_password_hash !~ '^\$2[aby]\$[0-9]{2}\$.{53}$' then
      raise exception 'presby_accept_invitation: p_password_hash is not a bcrypt hash'
        using errcode = 'invalid_parameter_value';
    end if;
    v_first := btrim(p_first_name);
    v_last := btrim(p_last_name);
    if v_first is null or v_last is null
       or char_length(v_first) not between 1 and 100
       or char_length(v_last) not between 1 and 100
       or v_first ~ '[[:cntrl:]]' or v_last ~ '[[:cntrl:]]' then
      raise exception 'presby_accept_invitation: a new account needs a first and last name of 1-100 characters'
        using errcode = 'invalid_parameter_value';
    end if;
    -- Case-insensitive (addendum contradiction 2). The users row lock in
    -- existing mode cannot cover a row that does not exist yet; this check
    -- carries it, and the users_email_unique mapping in step 5 is the race
    -- backstop for an exact-case collision.
    if exists (select 1 from users u where lower(u.email) = v_inv.email_normalized) then
      outcome := 'account_exists';
      return next;
      return;
    end if;
  end if;

  -- Step 4. Gates and person resolution. Nothing is written in this step.
  if v_inv.purpose = 'treasurer' then
    if v_org_type not in ('congregation', 'new_worshiping_community') then
      v_block := 'not_applicable';
    elsif presby_giving_manage_holder_count(v_inv.organization_id) > 0 then
      v_block := 'has_holders';
    elsif not exists (select 1 from app_roles t
                       where t.key = 'treasurer' and t.organization_id is null
                         and (t.organization_type_scope is null or t.organization_type_scope::text = v_org_type))
       or not exists (select 1 from app_roles t
                       where t.key = 'giving_recorder' and t.organization_id is null
                         and (t.organization_type_scope is null or t.organization_type_scope::text = v_org_type)) then
      v_block := 'provisioning_incomplete';
    else
      select p.id, p.user_id, p.merged_into_id into v_person, v_person_user, v_person_merged
        from people p where p.id = v_inv.person_id
         for update;
      select m.ended_on into v_ended
        from memberships m
       where m.person_id = v_inv.person_id and m.organization_id = v_inv.organization_id;
      if v_person_merged is not null then
        v_block := 'person_merged';
      elsif v_ended is not null then
        v_block := 'membership_ended';
      elsif v_person_user is not null and v_person_user is distinct from v_user_id then
        v_block := 'person_linked_elsewhere';
      elsif v_user_id is not null and exists (
              select 1 from people p2
               where p2.user_id = v_user_id and p2.merged_into_id is null and p2.id <> v_inv.person_id) then
        -- The account is already someone else. Linking would leave two live
        -- people on one account (F110/F112).
        if exists (select 1 from people p2
                     join memberships m2 on m2.person_id = p2.id
                                        and m2.organization_id = v_inv.organization_id
                    where p2.user_id = v_user_id and p2.merged_into_id is null
                      and p2.id <> v_inv.person_id) then
          v_block := 'ambiguous_person';
        else
          v_block := 'person_elsewhere';
        end if;
      else
        v_person_mode := case when v_person_user is null then 'linked_person' else 'existing_person' end;
      end if;
    end if;
  elsif v_inv.purpose = 'founding_administrator' then
    if presby_founding_administrator_holder_count(v_inv.organization_id) > 0 then
      v_block := 'has_holders';
    elsif not exists (select 1 from groups g
                       where g.organization_id = v_inv.organization_id
                         and g.derived_from = 'active_membership') then
      v_block := 'provisioning_incomplete';
    else
      -- (a) a live person already linked to the accepting account
      v_found := false;
      if v_user_id is not null then
        -- At this org (active or ended) first, then elsewhere, then a person
        -- with no membership anywhere (TS classifyPersonRows(), verbatim).
        -- FOUND, never a selected `true`: SELECT INTO with no row sets its
        -- targets to NULL, and `not null` is not true (caught by the Batch 1c
        -- existing-account tests).
        select p.id, m.ended_on into v_person, v_ended
          from people p
          join memberships m on m.person_id = p.id and m.organization_id = v_inv.organization_id
         where p.user_id = v_user_id and p.merged_into_id is null
         order by (m.ended_on is null) desc, p.created_at
         limit 1;
        if found then
          v_found := true;
          if v_ended is not null then
            v_block := 'membership_ended';
          else
            v_person_mode := 'existing_person';
          end if;
        elsif exists (select 1 from people p join memberships m on m.person_id = p.id
                       where p.user_id = v_user_id and p.merged_into_id is null) then
          v_found := true;
          v_block := 'person_elsewhere';
        else
          select p.id into v_person
            from people p
           where p.user_id = v_user_id and p.merged_into_id is null
           order by p.created_at
           limit 1;
          if found then
            v_found := true;
            v_person_mode := 'existing_person_new_membership';
          end if;
        end if;
        if v_person is not null and v_block is null then
          perform 1 from people p where p.id = v_person for update;
        end if;
      end if;

      -- (b) otherwise match the address on file, restricted to people with a
      -- membership at THIS org (people and contact_methods carry no tenant
      -- column). No fuzzy matching (G3).
      if not v_found then
        select count(*) into v_n from (
          select distinct p.id
            from contact_methods cm
            join people p on p.id = cm.person_id and p.merged_into_id is null
            join memberships m on m.person_id = p.id and m.organization_id = v_inv.organization_id
           where cm.kind = 'email' and cm.ended_at is null and lower(btrim(cm.value)) = v_inv.email_normalized) c;
        if v_n > 1 then
          v_block := 'ambiguous_person';
        elsif v_n = 1 then
          select p.id into v_person
            from contact_methods cm
            join people p on p.id = cm.person_id and p.merged_into_id is null
            join memberships m on m.person_id = p.id and m.organization_id = v_inv.organization_id
           where cm.kind = 'email' and cm.ended_at is null and lower(btrim(cm.value)) = v_inv.email_normalized
           limit 1;
          select p.user_id into v_person_user from people p where p.id = v_person for update;
          select m.ended_on into v_ended
            from memberships m
           where m.person_id = v_person and m.organization_id = v_inv.organization_id;
          if v_ended is not null then
            v_block := 'membership_ended';
          elsif v_person_user is not null and v_person_user is distinct from v_user_id then
            v_block := 'person_linked_elsewhere';
          else
            v_person_mode := 'linked_person';
          end if;
        else
          v_person_mode := 'created_person';
        end if;
      end if;
    end if;
  elsif v_inv.purpose = 'sign_in' then
    -- The person comes only from the invitation row. Lock it, then the locked
    -- FOR SHARE currency re-check on the contact row (R27's race authority;
    -- a miss is dead, nothing written), then the standing core.
    select p.id, p.user_id into v_person, v_person_user
      from people p where p.id = v_inv.person_id
       for update;
    perform 1 from contact_methods cm
     where cm.person_id = v_inv.person_id and cm.kind = 'email' and cm.ended_at is null
       and lower(btrim(cm.value)) = v_inv.email_normalized
       for share;
    if not found then
      outcome := 'dead';
      return next;
      return;
    end if;
    select * into v_st from presby__person_sign_in_standing(v_inv.person_id, v_inv.organization_id);
    -- In place, the factor rule is re-read under the person lock, so authority
    -- gained since step 3 cannot slip through.
    if p_presentation = 'in_place' and v_st.authority_bearing and not v_factor_ok then
      outcome := 'needs_second_factor';
      return next;
      return;
    end if;
    if v_st.refusal is not null then
      v_block := v_st.refusal;
    elsif v_person_user is not null and v_person_user is distinct from v_user_id then
      v_block := 'person_linked_elsewhere';
    elsif v_user_id is not null and exists (
            select 1 from people p2
             where p2.user_id = v_user_id and p2.merged_into_id is null and p2.id <> v_inv.person_id) then
      -- The account is already someone else (F110/F112), as the treasurer gate.
      if exists (select 1 from people p2
                   join memberships m2 on m2.person_id = p2.id
                                      and m2.organization_id = v_inv.organization_id
                  where p2.user_id = v_user_id and p2.merged_into_id is null
                    and p2.id <> v_inv.person_id) then
        v_block := 'ambiguous_person';
      else
        v_block := 'person_elsewhere';
      end if;
    else
      -- The same account on the same person is the harmless no-op.
      v_person_mode := case when v_person_user is null then 'linked_person' else 'existing_person' end;
    end if;
  else
    raise exception 'presby__accept_invitation_core: unknown purpose %', v_inv.purpose
      using errcode = 'internal_error';
  end if;

  -- Step 5. Apply, in a subtransaction.
  if v_block is null then
    begin
      if v_mode = 'new_account' then
        insert into users (email, email_verified, name, password)
        values (v_inv.email_normalized, now(), v_first || ' ' || v_last, p_password_hash)
        returning id into v_user_id;
      end if;

      if v_person_mode = 'created_person' then
        insert into people (first_name, last_name, user_id)
        values (v_first, v_last, v_user_id)
        returning id into v_person;
        -- Staff-kind membership (DECISION-128/129): no roll_actions row.
        insert into memberships (organization_id, person_id, engagement_status)
        values (v_inv.organization_id, v_person, 'staff');
      elsif v_person_mode = 'linked_person' then
        -- R44: the one writer of people.user_id for an existing person. It
        -- links only from null and raises otherwise (re-raised below: db_error).
        perform 1 from presby__bind_person_account(v_person, v_user_id, v_inv.email_normalized);
      elsif v_person_mode = 'existing_person_new_membership' then
        -- TS's defensive zero-membership branch.
        insert into memberships (organization_id, person_id, engagement_status)
        values (v_inv.organization_id, v_person, 'staff');
      end if;

      if v_person is null or v_user_id is null then
        -- Internal invariant: step 4 resolved a person and step 3/5 an
        -- account. Not mapped below, so it aborts the whole call (db_error).
        raise exception 'presby_accept_invitation: no person or account resolved for invitation %', v_inv.id
          using errcode = 'internal_error';
      end if;

      -- The address on file is now proven (the token holder controls it).
      -- Never person_identifiers (G3).
      update contact_methods
         set verified_at = now()
       where person_id = v_person and kind = 'email' and ended_at is null
         and lower(btrim(value)) = v_inv.email_normalized
         and verified_at is null;

      if v_inv.purpose = 'founding_administrator' then
        select * into v_fa from presby_apply_founding_administrator(v_inv.organization_id, v_person, v_inv.created_by_user_id);
        if v_fa.outcome <> 'ok' then
          raise exception 'presby_accept_invitation: apply refused' using detail = v_fa.outcome;
        end if;
      elsif v_inv.purpose = 'treasurer' then
        select * into v_tr from presby_apply_treasurer(v_inv.organization_id, v_person, v_inv.created_by_user_id);
        if v_tr.outcome <> 'ok' then
          raise exception 'presby_accept_invitation: apply refused' using detail = v_tr.outcome;
        end if;
      elsif v_inv.purpose = 'sign_in' then
        -- R35: people.user_id and the matching contact's verified_at, above,
        -- and NOTHING else: no role grant, designation, group or officer row.
        null;
      else
        raise exception 'presby__accept_invitation_core: unknown purpose %', v_inv.purpose
          using errcode = 'internal_error';
      end if;

      perform set_config('presby.invitation_accept_active', 'true', true);
      update account_invitations
         set accepted_at = now(), accepted_user_id = v_user_id, person_id = v_person
       where id = v_inv.id;
      perform set_config('presby.invitation_accept_active', '', true);

    -- EXCEPTION MAPPING (addendum D-5.2). Each arm matches SQLSTATE AND the
    -- constraint name or message text, because the codes are generic; any
    -- other exception RE-RAISES (the whole transaction aborts and accept.ts
    -- returns db_error). Edit this table whenever a guard's message changes;
    -- src/lib/db/domain/invitations.db.test.ts drives every arm.
    --
    --   SQLSTATE                 match                                              -> outcome
    --   23505 unique_violation   CONSTRAINT_NAME = 'users_email_unique' or          -> account_exists (non-terminal)
    --                            'users_email_lower_uq' (E1, drizzle/0065 section 4)
    --   42501 insufficient_priv  MESSAGE 'memberships: person % already exists      -> blocked person_elsewhere
    --                            elsewhere%' (memberships_guard_insert, 0009)
    --   23514 check_violation    MESSAGE 'role_grants: cannot open a position at    -> blocked membership_ended
    --                            an organization where the membership ended on%'
    --                            (role_grants_needs_membership)
    --   23503 foreign_key_viol   MESSAGE 'organization % has no derived group       -> blocked provisioning_incomplete
    --                            active_membership%' (memberships_sync_derived_group)
    --   P0001 raise_exception    MESSAGE = 'presby_accept_invitation: apply         -> blocked <DETAIL> (an apply
    --                            refused'                                              helper's own gate)
    exception
      when unique_violation then
        get stacked diagnostics v_con = constraint_name;
        if v_con in ('users_email_unique', 'users_email_lower_uq') then
          v_nonterminal := 'account_exists';
        else
          raise;
        end if;
      when insufficient_privilege then
        get stacked diagnostics v_msg = message_text;
        if v_msg like 'memberships: person % already exists elsewhere%' then
          v_block := 'person_elsewhere';
        else
          raise;
        end if;
      when check_violation then
        get stacked diagnostics v_msg = message_text;
        if v_msg like 'role_grants: cannot open a position at an organization where the membership ended on%' then
          v_block := 'membership_ended';
        else
          raise;
        end if;
      when foreign_key_violation then
        get stacked diagnostics v_msg = message_text;
        if v_msg like 'organization % has no derived group active_membership%' then
          v_block := 'provisioning_incomplete';
        else
          raise;
        end if;
      when raise_exception then
        get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
        if v_msg = 'presby_accept_invitation: apply refused'
           and v_detail in ('has_holders', 'not_applicable', 'provisioning_incomplete') then
          v_block := v_detail;
        else
          raise;
        end if;
    end;
  end if;

  if v_nonterminal is not null then
    outcome := v_nonterminal;
    return next;
    return;
  end if;

  if v_block is not null then
    -- The subtransaction (if it ran) rolled back, and with it any set_config
    -- made inside it (Postgres reverts GUC changes on subtransaction abort).
    -- Re-arm here, in the outer block, immediately before the blocked update
    -- and clear immediately after (addendum D-5.1).
    perform set_config('presby.invitation_accept_active', 'true', true);
    update account_invitations
       set blocked_at = now(), blocked_reason = v_block
     where id = v_inv.id;
    perform set_config('presby.invitation_accept_active', '', true);

    outcome := 'blocked';
    blocked_reason := v_block;
    invitation_id := v_inv.id;
    organization_id := v_inv.organization_id;
    purpose := v_inv.purpose;
    mode := v_mode;
    -- Null in new mode: the account creation was rolled back or never ran.
    user_id := case when v_mode = 'existing_account' then v_user_id else null end;
    created_by_user_id := v_inv.created_by_user_id;
    return next;
    return;
  end if;

  -- Step 6.
  outcome := 'accepted';
  invitation_id := v_inv.id;
  organization_id := v_inv.organization_id;
  organization_slug := v_slug;
  purpose := v_inv.purpose;
  mode := v_mode;
  user_id := v_user_id;
  person_id := v_person;
  person_mode := case when v_person_mode = 'existing_person_new_membership' then 'existing_person'
                      else v_person_mode end;
  created_by_user_id := v_inv.created_by_user_id;
  inviter_is_invitee := (v_user_id = v_inv.created_by_user_id);
  if v_inv.purpose = 'founding_administrator' then
    administration_role_key := v_fa.administration_role_key;
    office_role_key := v_fa.office_role_key;
    permission_keys := v_fa.permission_keys;
  elsif v_inv.purpose = 'treasurer' then
    administration_role_key := 'treasurer';
    permission_keys := v_tr.permission_keys;
    treasurer_role_id := v_tr.treasurer_role_id;
  elsif v_inv.purpose = 'sign_in' then
    -- administration_role_key, office_role_key, permission_keys and
    -- treasurer_role_id stay null: a sign-in grants nothing.
    null;
  else
    raise exception 'presby__accept_invitation_core: unknown purpose %', v_inv.purpose
      using errcode = 'internal_error';
  end if;
  return next;
end
$function$;

-- 13b. presby_accept_invitation: the TOKEN presentation. Signature, ACL and
-- result columns unchanged (so `create or replace` keeps the shipped ACL).
-- Argument validation, the null-token dead, the hash and the id lookup (the
-- live step 1), then the core with 'token'. The parity golden
-- (src/lib/onboarding/designation-parity.golden.json) is the proof that
-- founding-administrator and treasurer acceptance did not move.
create or replace function presby_accept_invitation(
  p_token text,
  p_user_id uuid default null,
  p_password_hash text default null,
  p_first_name text default null,
  p_last_name text default null
)
returns table (
  outcome text,
  blocked_reason text,
  invitation_id uuid,
  organization_id uuid,
  organization_slug text,
  purpose text,
  mode text,
  user_id uuid,
  person_id uuid,
  person_mode text,
  created_by_user_id uuid,
  inviter_is_invitee boolean,
  administration_role_key text,
  office_role_key text,
  permission_keys text[],
  treasurer_role_id uuid
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_hash text;
  v_inv_id uuid;
begin
  if (p_user_id is null) = (p_password_hash is null) then
    raise exception 'presby_accept_invitation: exactly one of p_user_id and p_password_hash must be given'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Step 1. Unknown token -> dead.
  if p_token is null then
    outcome := 'dead';
    return next;
    return;
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select i.id into v_inv_id from account_invitations i where i.token_hash = v_hash;
  if v_inv_id is null then
    outcome := 'dead';
    return next;
    return;
  end if;

  return query
    select * from presby__accept_invitation_core(v_inv_id, p_user_id, p_password_hash,
                                                 p_first_name, p_last_name, 'token', false);
end
$function$;

-- 13c. presby_accept_in_place: the IN-PLACE presentation (R45, Q2). The
-- credential is still the invitation row and still authorizes only the act
-- the row names; in place, the bearer token is replaced by the account's
-- proven address equalling the row's address, a verified second factor where
-- the core's table requires it, and the click. A null argument returns one
-- dead row (no raise: uniform). The caller passes auth()'s user id and the
-- session's server-granted twoFactorVerified claim (DECISION-230): both are
-- caller-asserted (E-30, an accepted `paper` residual; the user_totp row is
-- the database-side half).
create or replace function presby_accept_in_place(
  p_invitation_id uuid,
  p_user_id uuid,
  p_second_factor_verified boolean
)
returns table (
  outcome text,
  blocked_reason text,
  invitation_id uuid,
  organization_id uuid,
  organization_slug text,
  purpose text,
  mode text,
  user_id uuid,
  person_id uuid,
  person_mode text,
  created_by_user_id uuid,
  inviter_is_invitee boolean,
  administration_role_key text,
  office_role_key text,
  permission_keys text[],
  treasurer_role_id uuid
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if p_invitation_id is null or p_user_id is null or p_second_factor_verified is null then
    outcome := 'dead';
    return next;
    return;
  end if;
  return query
    select * from presby__accept_invitation_core(p_invitation_id, p_user_id, null, null, null,
                                                 'in_place', p_second_factor_verified);
end
$function$;

-- 13d. presby_list_invitations_for_account: the open invitations addressed to
-- a proven, active account (R45 "Listing"). Open = accepted, revoked,
-- superseded, blocked and redacted all null and expires_at in the future;
-- only when lower(users.email) equals the row's address. Ordered by
-- created_at (not returned). person_display_name only for sign_in, from the
-- row's own person (the G5 rule: the session matches by construction). The
-- closed shape never returns a token hash, the inviter, the address, the
-- person id or any other column (pinned by a source scan and a pg_proc
-- check).
create or replace function presby_list_invitations_for_account(p_user_id uuid)
returns table (invitation_id uuid, organization_name text, purpose text,
               expires_at timestamptz, person_display_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  return query
    select i.id,
           o.name,
           i.purpose,
           i.expires_at,
           case when i.purpose = 'sign_in'
                then (select p.first_name || ' ' || p.last_name from people p where p.id = i.person_id)
           end
      from users u
      join account_invitations i on i.email_normalized = lower(u.email)
      join organizations o on o.id = i.organization_id
     where u.id = p_user_id
       and u.is_active and u.email_verified is not null
       and i.accepted_at is null and i.revoked_at is null and i.superseded_at is null
       and i.blocked_at is null and i.redacted_at is null
       and i.expires_at > now()
     order by i.created_at, i.id;
end
$function$;

-- 13e. presby_preview_invitation, re-created from the LIVE 0064 text with the
-- sign_in branch (Phase 3 "Preview and accept") and an explicit `else raise`
-- on purpose (R35, F196). For sign_in: the currency check returns zero rows
-- on a miss; the person is the row's own; person_display_name only when
-- session_matches. Founding administrator and treasurer are byte-identical
-- in behaviour. Signature unchanged, so the shipped ACL survives.
create or replace function presby_preview_invitation(p_token text, p_user_id uuid default null)
returns table (
  organization_name text,
  organization_type text,
  purpose text,
  invitee_first_name text,
  invitee_last_name text,
  person_display_name text,
  masked_email text,
  expires_at timestamptz,
  session_matches boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_inv account_invitations%rowtype;
  v_org_name text;
  v_org_type text;
  v_matches boolean := null;
  v_display text := null;
  v_candidates int;
begin
  if p_token is null then
    return;
  end if;

  select * into v_inv
    from account_invitations i
   where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and i.accepted_at is null and i.revoked_at is null
     and i.superseded_at is null and i.blocked_at is null
     and i.redacted_at is null
     and i.expires_at > now();
  if not found then
    return;
  end if;

  -- sign_in (R27): the invited address must still be one of the person's
  -- active emails; a miss is zero rows, exactly like a dead token.
  if v_inv.purpose = 'sign_in'
     and not exists (select 1 from contact_methods cm
                      where cm.person_id = v_inv.person_id and cm.kind = 'email'
                        and cm.ended_at is null
                        and lower(btrim(cm.value)) = v_inv.email_normalized) then
    return;
  end if;

  select o.name, o.organization_type::text into v_org_name, v_org_type
    from organizations o where o.id = v_inv.organization_id;

  if p_user_id is not null then
    select exists (select 1 from users u
                    where u.id = p_user_id and lower(u.email) = v_inv.email_normalized)
      into v_matches;
  end if;

  if v_inv.purpose = 'treasurer' then
    select p.first_name || ' ' || p.last_name into v_display
      from people p where p.id = v_inv.person_id;
  elsif v_inv.purpose = 'founding_administrator' then
    if v_matches then
      select min(p.first_name || ' ' || p.last_name) into v_display
        from people p
        join memberships m on m.person_id = p.id and m.organization_id = v_inv.organization_id
       where p.user_id = p_user_id and p.merged_into_id is null and m.ended_on is null;
    end if;
    if v_display is null then
      select count(distinct p.id), min(p.first_name || ' ' || p.last_name)
        into v_candidates, v_display
        from contact_methods cm
        join people p on p.id = cm.person_id and p.merged_into_id is null
        join memberships m on m.person_id = p.id and m.organization_id = v_inv.organization_id
       where cm.kind = 'email' and cm.ended_at is null and lower(btrim(cm.value)) = v_inv.email_normalized;
      if v_candidates <> 1 then
        v_display := null;
      end if;
    end if;
    if v_display is null then
      v_display := v_inv.invitee_first_name || ' ' || v_inv.invitee_last_name;
    end if;
  elsif v_inv.purpose = 'sign_in' then
    -- The person comes from the token's row only, never resolved by address,
    -- and is named only to the signed-in account the row is addressed to
    -- (G5). The invitee name columns are null for sign_in (CHECK).
    if v_matches then
      select p.first_name || ' ' || p.last_name into v_display
        from people p where p.id = v_inv.person_id;
    end if;
  else
    raise exception 'presby_preview_invitation: unknown purpose %', v_inv.purpose
      using errcode = 'internal_error';
  end if;

  organization_name := v_org_name;
  organization_type := v_org_type;
  purpose := v_inv.purpose;
  invitee_first_name := v_inv.invitee_first_name;
  invitee_last_name := v_inv.invitee_last_name;
  person_display_name := v_display;
  masked_email := left(split_part(v_inv.email_normalized, '@', 1), 1) || '***@'
                  || split_part(v_inv.email_normalized, '@', 2);
  expires_at := v_inv.expires_at;
  session_matches := v_matches;
  return next;
end
$function$;

-- 13f. presby_account_invitations_guard_update, re-created from the 0059 text
-- (identical to the live definition) with exactly its two refusal messages
-- restated (orchestrator ruling 4 on Batch A1): the marker is now armed by
-- presby__accept_invitation_core, which both presentations call. Behaviour is
-- byte-identical; the guard keys on the marker, never on a function name.
create or replace function presby_account_invitations_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_marker boolean := coalesce(current_setting('presby.invitation_accept_active', true), '') = 'true';
  v_expected account_invitations%rowtype;
begin
  v_expected := old;

  if num_nonnulls(old.accepted_at, old.revoked_at, old.superseded_at, old.blocked_at) > 0 then
    if old.redacted_at is null and new.redacted_at is not null and new.email_normalized is null then
      v_expected.redacted_at := new.redacted_at;
      v_expected.email_normalized := null;
    end if;
    if new is distinct from v_expected then
      raise exception 'account_invitations: invitation % is finished; only redaction may follow', old.id
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.accepted_at is not null then
    if not v_marker then
      raise exception 'account_invitations: an invitation is accepted only through presby_accept_invitation() or presby_accept_in_place(), by the shared acceptance core'
        using errcode = 'insufficient_privilege';
    end if;
    v_expected.accepted_at := new.accepted_at;
    v_expected.accepted_user_id := new.accepted_user_id;
    if old.person_id is null then
      v_expected.person_id := new.person_id;
    end if;
  elsif new.blocked_at is not null then
    if not v_marker then
      raise exception 'account_invitations: an invitation is blocked only through presby_accept_invitation() or presby_accept_in_place(), by the shared acceptance core'
        using errcode = 'insufficient_privilege';
    end if;
    v_expected.blocked_at := new.blocked_at;
    v_expected.blocked_reason := new.blocked_reason;
  elsif new.revoked_at is not null then
    v_expected.revoked_at := new.revoked_at;
    v_expected.revoked_by_user_id := new.revoked_by_user_id;
  elsif new.superseded_at is not null then
    v_expected.superseded_at := new.superseded_at;
  end if;

  if new is distinct from v_expected then
    raise exception 'account_invitations: invitation % may change only by one legal transition (identity columns are immutable)', old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$function$;

revoke all on function presby_account_invitations_guard_update() from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 14. connect (R41, R42, R47; DECISION-226)
-- ---------------------------------------------------------------------------
-- presby_connect_signed_in_account(user, factor): link a proven account to
-- the ONE eligible person record that carries its address. Outcomes:
--   connected            the bind helper ran; the row carries the
--                        organization, slug, person, contact and the
--                        authority snapshot for the caller's
--                        tenant.person.sign_in_connected audit row (written
--                        by TypeScript in this transaction)
--   already_connected    the account is already linked to a live person who
--                        has a live membership at an enterable (managed)
--                        organization (a second tab, Check again after a
--                        sign-in connect)
--   needs_second_factor  everything else holds but the record is
--                        authority_bearing and the account lacks a user_totp
--                        row or the caller did not pass a verified factor
--   declined             every other reason, one literal, nothing else said
-- Checks, in order (first failure wins; all re-run under the locks):
--    1. the account exists and is active;
--    2. it is proven: users.email_verified is not null (DECISION-225; never
--       contact_methods.verified_at, R43);
--    3. it is not linked to any live person (else already_connected, only
--       when that person has a live membership at a managed organization,
--       otherwise declined);
--    4. no open invitation (any organization, any purpose, unexpired) is
--       addressed to its address (FB5);
--    5. the candidate set C has EXACTLY one person: every unmerged, living
--       person who holds the address as an ACTIVE email (exact
--       lower(btrim); no dot, plus or Unicode folding) and has a live
--       membership anywhere. Global: sign-in has no organization context;
--    6. that person's user_id is null;
--    7. the person has exactly one live membership, at a managed
--       organization (isEnterableOrganization: ended_on null and
--       platform_status = 'managed');
--    8. that organization has an ENABLED org_portal.sign_in_connect toggle
--       row (an absent row declines, DECISION-097; the category curation
--       axis is not consulted);
--    9. the standing core's refusal is null;
--   10. the standing is not 'visitor' (S13; Increment 3a changes this one
--       condition);
--   11. authority_bearing needs a user_totp row AND p_second_factor_verified
--       (R42), else needs_second_factor.
-- LOCKING: resolve the candidate without locks, then lock in acceptance's
-- global order (organization FOR UPDATE, user FOR UPDATE, person FOR UPDATE,
-- matching contact FOR SHARE) and re-run every check (READ COMMITTED
-- re-reads); a candidate or organization that moved in between declines. A
-- different order from acceptance could deadlock the two.
-- WRITES: the bind helper only (people.user_id, the contact's verified_at).
-- No membership, role grant, group or officer row. Reads no platform
-- predicate (no is_platform_admin; DECISION-183): a platform administrator
-- connects only as any person does. Callers (pinned by scans): src/auth.ts's
-- sign-in branch (factor always false there) and the Check-again action.
-- Residual (E-30, `paper`): identity and factor are caller-asserted.
create or replace function presby_connect_signed_in_account(p_user_id uuid, p_second_factor_verified boolean)
returns table (outcome text, organization_id uuid, organization_slug text, person_id uuid,
               contact_method_id uuid, contact_method_created_at timestamptz,
               session_seat boolean, diaconate_seat boolean,
               role_keys text[], permission_keys text[])
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_factor_ok boolean;
  v_pass int;
  v_active boolean;
  v_proven boolean;
  v_addr text;
  v_cands uuid[];
  v_person uuid;
  v_org uuid;
  v_first_person uuid;
  v_first_org uuid;
  v_n int;
  v_slug text;
  v_st record;
  v_bind record;
begin
  session_seat := false;
  diaconate_seat := false;
  if p_user_id is null then
    outcome := 'declined';
    return next;
    return;
  end if;
  v_factor_ok := coalesce(p_second_factor_verified, false)
                 and exists (select 1 from user_totp t where t.user_id = p_user_id);

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform 1 from organizations o where o.id = v_first_org for update;
      perform 1 from users u where u.id = p_user_id for update;
      perform 1 from people p where p.id = v_first_person for update;
      perform 1 from contact_methods cm
       where cm.person_id = v_first_person and cm.kind = 'email' and cm.ended_at is null
         and lower(btrim(cm.value)) = v_addr
         for share;
    end if;

    -- 1, 2. active and proven.
    select u.is_active, u.email_verified is not null, lower(btrim(u.email))
      into v_active, v_proven, v_addr
      from users u where u.id = p_user_id;
    if not found or not coalesce(v_active, false) or not coalesce(v_proven, false) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 3. already linked.
    if exists (select 1 from people p where p.user_id = p_user_id and p.merged_into_id is null) then
      if exists (select 1 from people p
                   join memberships m on m.person_id = p.id and m.ended_on is null
                   join organizations o on o.id = m.organization_id and o.platform_status = 'managed'
                  where p.user_id = p_user_id and p.merged_into_id is null) then
        outcome := 'already_connected';
      else
        outcome := 'declined';
      end if;
      return next;
      return;
    end if;

    -- 4. an open invitation to the address holds auto-connect back (FB5).
    if exists (select 1 from account_invitations i
                where i.email_normalized = v_addr
                  and i.accepted_at is null and i.revoked_at is null and i.superseded_at is null
                  and i.blocked_at is null and i.redacted_at is null
                  and i.expires_at > now()) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 5. exactly one candidate, globally.
    select array_agg(distinct p.id) into v_cands
      from contact_methods cm
      join people p on p.id = cm.person_id and p.merged_into_id is null and p.date_of_death is null
     where cm.kind = 'email' and cm.ended_at is null
       and lower(btrim(cm.value)) = v_addr
       and exists (select 1 from memberships m where m.person_id = p.id and m.ended_on is null);
    if coalesce(cardinality(v_cands), 0) <> 1 then
      outcome := 'declined';
      return next;
      return;
    end if;
    v_person := v_cands[1];

    -- 6. the person is not linked to anyone.
    if exists (select 1 from people p where p.id = v_person and p.user_id is not null) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 7. exactly one live membership, at a managed organization.
    select count(*) into v_n from memberships m where m.person_id = v_person and m.ended_on is null;
    select m.organization_id into v_org from memberships m where m.person_id = v_person and m.ended_on is null limit 1;
    if v_n <> 1
       or not exists (select 1 from organizations o where o.id = v_org and o.platform_status = 'managed') then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- Under the locks, the candidate and its organization must be the ones
    -- that were locked.
    if v_pass = 2 and (v_person is distinct from v_first_person or v_org is distinct from v_first_org) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 8. the congregation's toggle (R47): an enabled row, or nothing.
    if not exists (select 1 from organization_feature_toggles t
                    where t.organization_id = v_org
                      and t.feature_key = 'org_portal.sign_in_connect' and t.enabled) then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 9, 10. the standing core.
    select * into v_st from presby__person_sign_in_standing(v_person, v_org);
    if v_st.refusal is not null or v_st.standing is null or v_st.standing = 'visitor' then
      outcome := 'declined';
      return next;
      return;
    end if;

    -- 11. authority needs a second factor (R42).
    if v_st.authority_bearing and not v_factor_ok then
      outcome := 'needs_second_factor';
      return next;
      return;
    end if;

    v_first_person := v_person;
    v_first_org := v_org;
  end loop;

  select * into v_bind from presby__bind_person_account(v_person, p_user_id, v_addr);
  select o.slug into v_slug from organizations o where o.id = v_org;

  outcome := 'connected';
  organization_id := v_org;
  organization_slug := v_slug;
  person_id := v_person;
  contact_method_id := v_bind.contact_method_id;
  contact_method_created_at := v_bind.contact_method_created_at;
  session_seat := v_st.session_seat;
  diaconate_seat := v_st.diaconate_seat;
  role_keys := v_st.role_keys;
  permission_keys := v_st.permission_keys;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 15. ACLs and comments
-- ---------------------------------------------------------------------------
-- Re-stated for every function this file creates or re-creates, so the end
-- state does not depend on history (revoke-then-grant is idempotent).
-- presby_app EXECUTEs exactly these fifteen (section 5.11): issue, resend,
-- revoke, the reader, card standing, accept (token), accept in place,
-- preview, the listing, connect, the two proof writers, the deny raiser, the
-- standing classifier and 0064's presby_person_email (unchanged). None to
-- presby_platform. The internal functions (actor, standing core, bind
-- helper, accept core, the issue check) and the trigger functions have no
-- EXECUTE for public, presby_app or presby_platform. presby_app holds no
-- privilege on account_invitations (unchanged since 0059).
revoke all on function presby_membership_standing(text, text) from public, presby_app, presby_platform;
revoke all on function presby_deny_sign_in_invitation() from public, presby_app, presby_platform;
revoke all on function presby__actor_person(uuid, uuid, text) from public, presby_app, presby_platform;
revoke all on function presby__person_sign_in_standing(uuid, uuid) from public, presby_app, presby_platform;
revoke all on function presby__bind_person_account(uuid, uuid, text) from public, presby_app, presby_platform;
revoke all on function presby_sign_in__check(uuid, uuid, uuid, uuid, text, boolean) from public, presby_app, presby_platform;
revoke all on function presby_issue_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid) from public, presby_app, presby_platform;
revoke all on function presby_resend_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid) from public, presby_app, presby_platform;
revoke all on function presby_revoke_sign_in_invitation(uuid, uuid) from public, presby_app, presby_platform;
revoke all on function presby_sign_in_invitation_states(uuid[], uuid) from public, presby_app, presby_platform;
revoke all on function presby_sign_in_card_standing(uuid, uuid) from public, presby_app, presby_platform;
revoke all on function presby__accept_invitation_core(uuid, uuid, text, text, text, text, boolean) from public, presby_app, presby_platform;
revoke all on function presby_accept_invitation(text, uuid, text, text, text) from public, presby_app, presby_platform;
revoke all on function presby_accept_in_place(uuid, uuid, boolean) from public, presby_app, presby_platform;
revoke all on function presby_list_invitations_for_account(uuid) from public, presby_app, presby_platform;
revoke all on function presby_preview_invitation(text, uuid) from public, presby_app, presby_platform;
revoke all on function presby_connect_signed_in_account(uuid, boolean) from public, presby_app, presby_platform;
revoke all on function presby_record_google_email_proof(uuid, text) from public, presby_app, presby_platform;
revoke all on function presby_complete_email_change(text) from public, presby_app, presby_platform;
revoke all on function presby_person_email(uuid, text) from public, presby_app, presby_platform;
revoke all on function presby_users_guard_email_proof() from public, presby_app, presby_platform;
revoke all on function presby_guard_people_user_link() from public, presby_app, presby_platform;
revoke all on function presby_contact_methods_guard_write() from public, presby_app, presby_platform;
revoke all on function presby_account_invitations_guard_insert() from public, presby_app, presby_platform;
revoke all on function presby_account_invitations_guard_update() from public, presby_app, presby_platform;

grant execute on function presby_issue_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid) to presby_app;
grant execute on function presby_resend_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid) to presby_app;
grant execute on function presby_revoke_sign_in_invitation(uuid, uuid) to presby_app;
grant execute on function presby_sign_in_invitation_states(uuid[], uuid) to presby_app;
grant execute on function presby_sign_in_card_standing(uuid, uuid) to presby_app;
grant execute on function presby_accept_invitation(text, uuid, text, text, text) to presby_app;
grant execute on function presby_accept_in_place(uuid, uuid, boolean) to presby_app;
grant execute on function presby_preview_invitation(text, uuid) to presby_app;
grant execute on function presby_list_invitations_for_account(uuid) to presby_app;
grant execute on function presby_connect_signed_in_account(uuid, boolean) to presby_app;
grant execute on function presby_record_google_email_proof(uuid, text) to presby_app;
grant execute on function presby_complete_email_change(text) to presby_app;
grant execute on function presby_deny_sign_in_invitation() to presby_app;
grant execute on function presby_membership_standing(text, text) to presby_app;
grant execute on function presby_person_email(uuid, text) to presby_app;

comment on function presby_membership_standing(text, text) is
  'S13 / R50 (drizzle/0065 section 11a): listed | staff_anchor | visitor | inactive | unclassified, first match wins; immutable SQL, reads nothing. Called from one function body, the standing core. 2b tests = ''visitor'' only.';
comment on function presby_deny_sign_in_invitation() is
  'The one identity-refusal literal for every sign-in invitation callable (drizzle/0065 section 11b; the 0052/0061 shape). EXECUTE to presby_app so a refusal is never a permission-denied string.';
comment on function presby__actor_person(uuid, uuid, text) is
  'S6 (drizzle/0065 section 11c). The live person of a users.id who is an active member of the organization holding the key, else null. Owner only.';
comment on function presby__person_sign_in_standing(uuid, uuid) is
  'THE STANDING CORE (R40; drizzle/0065 section 11d): refusal (person_merged > person_deceased > membership_ended > person_elsewhere), standing (presby_membership_standing), the Session/diaconate seats and the set T (role and permission keys outside the closed derived list), authority_bearing. Every sign-in caller maps its output through one fixed table; nothing re-codes it. Owner only.';
comment on function presby__bind_person_account(uuid, uuid, text) is
  'THE BIND HELPER (R44; drizzle/0065 section 11e): the only function body that updates people.user_id; links only from null, then stamps the matching active contact''s verified_at and returns it. Called by the accept core and connect. Owner only.';
comment on function presby_sign_in__check(uuid, uuid, uuid, uuid, text, boolean) is
  'The shared issue/resend eligibility check (drizzle/0065 section 12a); first failure wins: not_found, the core''s own-organization refusals, already_signs_in, needs_support, needs_officers_permission, exceeds_your_access, no_email_on_file, address_changed, address_is_yours, address_shared, needs_acknowledgement. Owner only.';
comment on function presby_issue_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid) is
  'Issue a sign-in invitation for one person at presby_current_org() (drizzle/0065 section 12b; DECISION-207). people.manage; identity refusals raise the one literal; state refusals are outcomes; limits 30/30/3 per 24h over origin org rows.';
comment on function presby_resend_sign_in_invitation(uuid, text, timestamptz, uuid, text, boolean, uuid) is
  'Resend: supersede the open sign-in row and insert its successor at the person''s CURRENT address (drizzle/0065 section 12c; R33). Cooldown 5 minutes, 5 resends per chain; returns the superseded row''s email_queue_id to cancel.';
comment on function presby_revoke_sign_in_invitation(uuid, uuid) is
  'Cancel the person''s open sign-in invitation (drizzle/0065 section 12d). people.manage; terminal; refunds no limit.';
comment on function presby_sign_in_invitation_states(uuid[], uuid) is
  'The closed-shape sign-in reader (R30, R42; drizzle/0065 section 12e): 1-500 ids, own-organization rows only, linked from people.user_id, invited_address only while current, connected_via/connected_on from this organization''s accepted invitation or sign_in_connected audit row. Never a token, a queue address or created_by_user_id.';
comment on function presby_sign_in_card_standing(uuid, uuid) is
  'The standing core''s answers for one person, for the edit page card (R46; drizzle/0065 section 12f): standing, authority_bearing, address_shared. people.manage; zero rows for a person outside the organization.';
comment on function presby__accept_invitation_core(uuid, uuid, text, text, text, text, boolean) is
  'The acceptance body (drizzle/0065 section 13a), moved from presby_accept_invitation; both presentations call it (token, in_place), so the audit, the blocked reasons and the apply are one code path. Explicit purpose routing (F196), the sign_in branch, E1. Owner only.';
comment on function presby_accept_invitation(text, uuid, text, text, text) is
  'The token presentation (drizzle/0059; re-created by 0064 and by drizzle/0065 section 13b): resolves the token, then the shared core. Signature, ACL and result unchanged.';
comment on function presby_accept_in_place(uuid, uuid, boolean) is
  'The in-place presentation (R45, Q2; drizzle/0065 section 13c): a proven, active account whose address is the invited address accepts without the emailed link; a second factor for founding administrator, treasurer and an authority-bearing sign_in. Any identity miss is dead.';
comment on function presby_list_invitations_for_account(uuid) is
  'Open invitations addressed to a proven, active account (R45; drizzle/0065 section 13d). Closed shape: id, organization name, purpose, expiry, and a display name for sign_in only.';
comment on function presby_preview_invitation(text, uuid) is
  'The invite page''s preview (drizzle/0059; re-created by 0064 and by drizzle/0065 section 13e with the sign_in branch: currency check, the row''s own person, named only when the session matches).';
comment on function presby_account_invitations_guard_update() is
  'BEFORE UPDATE on account_invitations (0059 section 3b; messages restated by drizzle/0065 section 13f). One legal transition per update; accepted and blocked need the presby.invitation_accept_active marker, armed only by the shared acceptance core.';
comment on function presby_connect_signed_in_account(uuid, boolean) is
  'Auto-connect (R41, R42, R47; drizzle/0065 section 14; DECISION-226): link a proven account to the one eligible person carrying its address. connected | already_connected | needs_second_factor | declined. Writes only through the bind helper; reads no platform predicate. Residual, paper: identity and factor are caller-asserted (E-30).';
