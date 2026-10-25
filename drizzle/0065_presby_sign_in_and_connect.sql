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
-- BUILT IN TWO BATCHES, ONE FILE. Batch A1 (this text) is sections 1-10 and
-- is a complete, applyable file on its own. Batch A2 appends sections 11-15
-- (the helpers, the standing core, the bind helper, issue / resend / revoke /
-- reader, the accept core and its two presentations, the listing, connect,
-- and the ACL restatement). Both batches are applied twice, end to end.
--
-- CHAIN: 0059 < 0060 < 0061 < 0062 < 0063 < 0064 < 0065, never reordered.
-- A forward fix on top of 0059 (account_invitations, shipped v0.37.0) and
-- 0064 (person emails, shipped v0.42.0); neither of those files is edited.
--
-- DEPLOY ORDER: apply this file FIRST, then deploy the code. Old code against
-- this schema keeps working: the verify-email page's `update users set email`
-- is allowed and section 3 simply clears the (unread) stamp; the NextAuth
-- adapter's insert carries a null email_verified, which section 3 allows;
-- founding-administrator and treasurer acceptance is byte-identical (the
-- definers are untouched in A1); no old code writes people.user_id. New code
-- before this file would call functions that do not exist yet.
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
