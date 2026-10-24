-- drizzle/0064_presby_person_emails.sql
--
-- Multiple email addresses per person: contact_methods becomes end-dated,
-- never deleted, with an immutable identity, exactly one active main address
-- per person whenever any active email exists, and one invoker reader that
-- decides which address a person's mail uses
-- (docs/work-log/2026-10-23-person-emails.md, Phase 2 ER1-ER23b, Phase 3
-- "Data Model" and D1/D2; DECISION-215, DECISION-216; findings F210, F211,
-- F213, F214).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0064_presby_person_emails.sql
--
-- DEPLOY ORDER: apply this file FIRST, then deploy the application code
-- (ER2c). The new code reads created_at and ended_at, so code before schema
-- breaks every Community and directory page. In the window between the two,
-- the OLD code against the NEW schema fails closed, three ways: a mixed-case
-- insert fails contact_methods_value_shape (old code does not lowercase), an
-- in-place value update is refused by contact_methods_guard_write, and a
-- blank-field delete fails the revoke. No row is corrupted.
--
-- Production measurement (read-only, 2026-10-23, orchestrator): 0
-- contact_methods rows. Pipeline branch: 35 rows, 0 violations of every
-- constraint below (Phase 3 Note 1 measurements). Section 1 re-counts on
-- every environment and stops the file on any violation.
--
-- The whole file is idempotent: a count-only stop-block, `add column if not
-- exists`, an update whose predicate no longer matches once applied,
-- drop-then-add for every constraint, `if exists` / `if not exists` for every
-- index, `create or replace` for every function, drop-then-create for every
-- trigger, and revoke-then-grant. Proven by applying the whole file twice
-- (work-log, Phase 4 Batch A). Unreleased until shipped, so it may be
-- corrected in place until then (CLAUDE.md -> Project Layout -> drizzle/).
--
--   1. stop-block            counts every violation of sections 4-7, never a
--                            value; any non-zero count raises
--   2. columns               created_at (F210), ended_at (ER1)
--   3. data fix              email subtype home -> personal (ER18)
--   4. CHECKs                kind, subtype per kind, value shape per kind,
--                            ended-not-primary (ER1d, ER16, ER18), each
--                            NOT VALID then VALIDATE (ER19)
--   5. indexes               drop the unused lower(value) index (S2); one
--                            active primary per (person, kind) (ER15); one
--                            active row per (person, address) (ER17); the
--                            active-email lookup index (S9, moved from 2b)
--   6. guard trigger         contact_methods_guard_write (ER1c, D2)
--   7. deferred check        contact_methods_primary_required (ER15)
--   8. revoke DELETE         presby_app, presby_platform (ER1b)
--   9. reader                presby_person_email (ER11, ER12, D1)
--  10. readers fixed forward presby_preview_invitation and
--                            presby_accept_invitation, `ended_at is null` at
--                            the four contact_methods sites and nothing else
--                            (ER3, F211)
--  11. comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No BEFORE DELETE trigger (ER1b). presby_guard_people_delete (0048)
--     records that a delete guard on any of people's cascade children forces
--     arming in that function. The owner (neondb_owner) keeps DELETE: the
--     deletable_until fixture cascade and the e2e owner-path teardowns
--     (e2e/support/community-fixture.ts, e2e/support/invitation-fixture.ts)
--     need it. Residual, paper: an owner-path delete is not prevented; the
--     Batch 2 single-writer source scan is the mitigation.
--   * No ended_by column (ER1). The audit row written in the same
--     transaction (tenant.person_email.*) is the authoritative "who".
--   * No writing trigger. Auto-promotion of the oldest remaining address
--     (operator Q3) is done by src/lib/contact-methods/store.ts, which audits
--     it; section 7 only checks, it never writes (ER19a).
--   * No policy change. contact_methods stays FORCE RLS with its four
--     person-level policies; the table stays GLOBAL (no organization_id), the
--     accepted cross-organization residual of DECISION-218 (ER21).
--   * person_identifiers is untouched (ER22).
--   * No audit row. A migration has no actor.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md). Drizzle mirror: src/lib/db/domain/
-- people.ts (contactMethods). The journal entry is added at integration
-- (Rule 16); 0062 and 0063 belong to Community Increment 2, 0065 to 2b.

-- ---------------------------------------------------------------------------
-- 1. stop-block (ER19)
-- ---------------------------------------------------------------------------
-- Counts only; never selects a value (No Real Data: a production address
-- must not reach a migration log). On a re-apply ended_at already exists, so
-- the per-person counts consider ACTIVE rows only, exactly what the indexes
-- in section 5 constrain; on the first apply every row is active. Email
-- subtype 'home' is still legal here: section 3 rewrites it before section 4
-- adds the CHECK.
do $$
declare
  v_active text;
  v_bad_kind bigint;
  v_bad_email bigint;
  v_bad_phone bigint;
  v_bad_email_subtype bigint;
  v_bad_phone_subtype bigint;
  v_multi_primary bigint;
  v_dup_address bigint;
  v_no_primary bigint;
  v_ended_primary bigint := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'contact_methods'
                and column_name = 'ended_at') then
    v_active := 'ended_at is null';
    execute 'select count(*) from contact_methods where ended_at is not null and is_primary'
      into v_ended_primary;
  else
    v_active := 'true';
  end if;

  select count(*) into v_bad_kind
    from contact_methods where kind not in ('email', 'phone');
  select count(*) into v_bad_email
    from contact_methods
   where kind = 'email'
     and not (value = lower(btrim(value))
              and char_length(value) <= 254
              and value ~ '^[^@[:space:],]+@[^@[:space:],]+\.[^@[:space:],]+$');
  select count(*) into v_bad_phone
    from contact_methods
   where kind = 'phone' and not (value = btrim(value) and value <> '');
  select count(*) into v_bad_email_subtype
    from contact_methods
   where kind = 'email' and subtype is not null
     and subtype not in ('personal', 'work', 'other', 'home');
  select count(*) into v_bad_phone_subtype
    from contact_methods
   where kind = 'phone' and subtype is not null
     and subtype not in ('mobile', 'home', 'work');

  execute format(
    'select count(*) from (select 1 from contact_methods where is_primary and %s
       group by person_id, kind having count(*) > 1) x', v_active)
    into v_multi_primary;
  execute format(
    'select count(*) from (select 1 from contact_methods where kind = ''email'' and %s
       group by person_id, lower(btrim(value)) having count(*) > 1) x', v_active)
    into v_dup_address;
  execute format(
    'select count(*) from (select 1 from contact_methods where kind = ''email'' and %s
       group by person_id having count(*) filter (where is_primary) = 0) x', v_active)
    into v_no_primary;

  if v_bad_kind + v_bad_email + v_bad_phone + v_bad_email_subtype + v_bad_phone_subtype
     + v_multi_primary + v_dup_address + v_no_primary + v_ended_primary > 0 then
    raise exception
      '0064: contact_methods violates the new constraints (counts only): bad_kind=%, bad_email_shape=%, bad_phone_shape=%, bad_email_subtype=%, bad_phone_subtype=%, several_active_primaries=%, duplicate_active_address=%, active_emails_without_primary=%, ended_and_primary=%; repair before applying',
      v_bad_kind, v_bad_email, v_bad_phone, v_bad_email_subtype, v_bad_phone_subtype,
      v_multi_primary, v_dup_address, v_no_primary, v_ended_primary
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. columns (ER1, F210, D2)
-- ---------------------------------------------------------------------------
-- created_at is added with the constant default now() (no table rewrite;
-- every existing row gets the migration's timestamp, ties broken by id in
-- the shared order `created_at, id`), then the default becomes
-- clock_timestamp(): now() is the transaction start, so two addresses added
-- in one save would tie and "promote the oldest" would fall to a random
-- UUID (D2). Section 6 also forces it on every non-owner insert.
alter table contact_methods
  add column if not exists created_at timestamptz not null default now();
alter table contact_methods
  alter column created_at set default clock_timestamp();
alter table contact_methods
  add column if not exists ended_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. data fix (ER18)
-- ---------------------------------------------------------------------------
-- Email labels are personal | work | other | null; phone labels keep
-- mobile | home | work | null. A label change, so an in-place update is
-- legal (and section 6's guard permits it on an active row). Matches nothing
-- on a re-apply.
update contact_methods
   set subtype = 'personal'
 where kind = 'email' and subtype = 'home' and ended_at is null;

-- ---------------------------------------------------------------------------
-- 4. CHECKs (ER1d, ER16, ER18), each NOT VALID then VALIDATE (ER19)
-- ---------------------------------------------------------------------------
-- The email shape is a strict subset of account_invitations_email_shape
-- (254 <= 320, and the class here excludes a comma as well): every active
-- contact address can always be written as an invitation's email_normalized
-- (ER13; pinned by src/lib/db/domain/contact-methods.db.test.ts).
-- Normalization is on write (the account_invitations / giving_donors
-- precedent), so every existing `lower(btrim(cm.value))` comparison keeps
-- working unchanged.
alter table contact_methods drop constraint if exists contact_methods_kind_check;
alter table contact_methods add constraint contact_methods_kind_check
  check (kind in ('email', 'phone')) not valid;
alter table contact_methods validate constraint contact_methods_kind_check;

alter table contact_methods drop constraint if exists contact_methods_subtype_check;
alter table contact_methods add constraint contact_methods_subtype_check
  check ((kind = 'email' and (subtype is null or subtype in ('personal', 'work', 'other')))
      or (kind = 'phone' and (subtype is null or subtype in ('mobile', 'home', 'work'))))
  not valid;
alter table contact_methods validate constraint contact_methods_subtype_check;

alter table contact_methods drop constraint if exists contact_methods_value_shape;
alter table contact_methods add constraint contact_methods_value_shape
  check ((kind = 'email'
          and value = lower(btrim(value))
          and char_length(value) <= 254
          and value ~ '^[^@[:space:],]+@[^@[:space:],]+\.[^@[:space:],]+$')
      or (kind = 'phone' and value = btrim(value) and value <> ''))
  not valid;
alter table contact_methods validate constraint contact_methods_value_shape;

alter table contact_methods drop constraint if exists contact_methods_ended_not_primary;
alter table contact_methods add constraint contact_methods_ended_not_primary
  check (ended_at is null or not is_primary) not valid;
alter table contact_methods validate constraint contact_methods_ended_not_primary;

-- ---------------------------------------------------------------------------
-- 5. indexes (ER15, ER17, S2, S9)
-- ---------------------------------------------------------------------------
-- contact_methods_value_idx (lower(value)) is planned by nothing: every
-- reader compares lower(btrim(value)). The partial lookup index replaces it.
-- Partial unique indexes cannot be deferred, so a writer demotes or ends the
-- old primary BEFORE it promotes the new one (store.ts executes in that
-- order).
drop index if exists contact_methods_value_idx;

create unique index if not exists contact_methods_one_primary_uq
  on contact_methods (person_id, kind)
  where is_primary and ended_at is null;

create unique index if not exists contact_methods_person_email_uq
  on contact_methods (person_id, lower(btrim(value)))
  where kind = 'email' and ended_at is null;

create index if not exists contact_methods_email_norm_idx
  on contact_methods (lower(btrim(value)))
  where kind = 'email' and ended_at is null;

-- ---------------------------------------------------------------------------
-- 6. guard trigger (ER1c, ER1e, D2, F214)
-- ---------------------------------------------------------------------------
-- End-and-replace as a database property. INVOKER, reads nothing but the
-- catalog, binds every role (a BEFORE trigger fires on the owner path too;
-- BYPASSRLS and ownership bypass policies, never triggers).
--
-- Owner test, with no role named: the table's owner (pg_class.relowner for
-- TG_RELID) against current_user. Inside a SECURITY DEFINER function owned by
-- the table owner, current_user IS the owner, so presby_accept_invitation's
-- verified_at stamp passes while a direct presby_app write does not.
--
-- On UPDATE, for every role: id, person_id, kind, value and created_at are
-- immutable, and a row whose ended_at is already set is frozen (no
-- un-ending, no re-dating, no relabel of history). For a non-owner:
-- verified_at may not change. The legal in-place changes are subtype,
-- do_not_contact, is_primary and the end itself (null -> a timestamp).
--
-- On INSERT by a non-owner: verified_at and ended_at must be null (a
-- replacement or a re-added address always starts unverified and active),
-- and created_at is forced to clock_timestamp() so a tenant cannot backdate
-- a row to win "promote the oldest". The owner (seeds, fixtures) may supply
-- any of the three.
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
        raise exception 'contact_methods: verified_at is set only by presby_accept_invitation(); a new address starts unverified'
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
    raise exception 'contact_methods: verified_at is set only by presby_accept_invitation()'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

revoke all on function presby_contact_methods_guard_write() from public, presby_app, presby_platform;

drop trigger if exists contact_methods_guard_write on contact_methods;
create trigger contact_methods_guard_write
  before insert or update on contact_methods
  for each row execute function presby_contact_methods_guard_write();

-- ---------------------------------------------------------------------------
-- 7. deferred check: at least one active main email (ER15)
-- ---------------------------------------------------------------------------
-- Section 5's index makes "at most one" a database property; this makes "at
-- least one, whenever any active email exists" one too, so together "exactly
-- one active main" holds at every commit (Increment 2b relies on it).
-- DEFERRABLE INITIALLY DEFERRED: a save that ends the main and promotes
-- another, or inserts a new main after demoting the old, passes through a
-- moment with no main inside the transaction; only the commit-time state is
-- judged.
--
-- SECURITY DEFINER (F26): it must count every row the person has whatever
-- the caller's org context or RLS view; as an invoker on presby_app it would
-- see only rows visible through a membership at presby_current_org() and,
-- in createPerson()'s pre-membership window (D11), none at all. Pinned
-- search_path; the 0044 F62 wrapper pattern (presby_check_succession_
-- cardinality). It only checks; it never writes.
--
-- Fires on INSERT and on UPDATE OF is_primary, ended_at (the only changes
-- that can remove a main); phone rows are ignored (no at-least-one rule for
-- phones). A cascade delete of the person leaves nothing to count, so the
-- deletable_until fixture teardown passes.
create or replace function presby_contact_methods_primary_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active bigint;
  v_primary bigint;
begin
  if new.kind <> 'email' then
    return null;
  end if;
  select count(*), count(*) filter (where cm.is_primary)
    into v_active, v_primary
    from contact_methods cm
   where cm.person_id = new.person_id and cm.kind = 'email' and cm.ended_at is null;
  if v_active > 0 and v_primary = 0 then
    raise exception 'contact_methods: person % has active email addresses and no main address', new.person_id
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

revoke all on function presby_contact_methods_primary_check() from public, presby_app, presby_platform;

drop trigger if exists contact_methods_primary_required on contact_methods;
create constraint trigger contact_methods_primary_required
  after insert or update of is_primary, ended_at on contact_methods
  deferrable initially deferred
  for each row execute function presby_contact_methods_primary_check();

-- ---------------------------------------------------------------------------
-- 8. revoke DELETE (ER1b)
-- ---------------------------------------------------------------------------
-- Removal is ended_at. presby_platform held DELETE too (the F38 grant
-- residue). SELECT, INSERT and UPDATE stay with both roles. The owner keeps
-- DELETE by ownership regardless of any grant (F44); see the header.
revoke delete on contact_methods from presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 9. reader: presby_person_email (ER11, ER12, D1)
-- ---------------------------------------------------------------------------
-- The one SQL statement of which address a person's mail uses, by purpose.
-- SECURITY INVOKER: it adds no authority and does no scoping of its own. On
-- presby_app it sees what RLS shows (a person with no membership at
-- presby_current_org() returns nothing); called from inside a definer it
-- sees what that definer has already scoped. plpgsql rather than sql only
-- so an unknown purpose can raise with an explicit errcode (D1, R35).
-- Zero or one row. Active email rows only. The order is the shared constant
-- in src/lib/contact-methods/email-routing.ts (ER1a), pinned by a DB test:
--   credential  the active main; do_not_contact is RETURNED, not skipped
--               (the caller acknowledges it, as the invitation path does)
--   role        not do_not_contact; a Work address first, then
--               is_primary desc, created_at, id
--   personal    not do_not_contact, label not Work (null counts as
--               non-Work); is_primary desc, created_at, id
-- `coalesce(subtype = 'work', false) desc`, never `(subtype = 'work') desc`:
-- a null label compares null, and DESC sorts nulls FIRST.
create or replace function presby_person_email(p_person_id uuid, p_purpose text)
returns table (contact_method_id uuid, address text, subtype text, do_not_contact boolean)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_purpose is null or p_purpose not in ('credential', 'role', 'personal') then
    raise exception 'presby_person_email: unknown purpose %', coalesce(p_purpose, '(null)')
      using errcode = 'internal_error';
  end if;

  return query
    select cm.id, cm.value, cm.subtype, cm.do_not_contact
      from contact_methods cm
     where cm.person_id = p_person_id
       and cm.kind = 'email'
       and cm.ended_at is null
       and case p_purpose
             when 'credential' then cm.is_primary
             when 'role' then not cm.do_not_contact
             else not cm.do_not_contact and cm.subtype is distinct from 'work'
           end
     order by case when p_purpose = 'role' then coalesce(cm.subtype = 'work', false) else false end desc,
              cm.is_primary desc, cm.created_at, cm.id
     limit 1;
end $$;

revoke all on function presby_person_email(uuid, text) from public, presby_app, presby_platform;
grant execute on function presby_person_email(uuid, text) to presby_app;

-- ---------------------------------------------------------------------------
-- 10. readers fixed forward: presby_preview_invitation, presby_accept_invitation
--     (ER3, F211)
-- ---------------------------------------------------------------------------
-- Re-created from the LIVE definitions (identical to drizzle/0059's text,
-- verified with pg_get_functiondef on the pipeline branch before this file
-- was written), signatures unchanged so their ACLs survive. The ONLY change
-- is `ended_at is null` at the four sites that read contact_methods:
--   preview  the founding-administrator display-name address match
--   accept   the address-match count (ambiguous_person)
--   accept   the `limit 1` person resolution
--   accept   the verified_at stamp
-- Without it a removed address would still resolve a founding-administrator
-- or treasurer acceptance and still be stamped verified; and since section
-- 6 freezes an ended row, the stamp would now raise. The designation parity
-- golden (src/lib/onboarding/designation-parity.golden.json) is unchanged.
-- The comments, the revoke/grant and every other byte of the two bodies are
-- 0059's; the explanatory comments above each function stay in 0059.

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
  else
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
begin
  if (p_user_id is null) = (p_password_hash is null) then
    raise exception 'presby_accept_invitation: exactly one of p_user_id and p_password_hash must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  v_mode := case when p_user_id is not null then 'existing_account' else 'new_account' end;

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

  -- Step 2. Organization row first, then the invitation row, re-validated.
  select i.organization_id into v_org from account_invitations i where i.id = v_inv_id;
  select o.organization_type::text, o.slug into v_org_type, v_slug
    from organizations o where o.id = v_org
     for update;
  select * into v_inv from account_invitations i where i.id = v_inv_id for update;
  if num_nonnulls(v_inv.accepted_at, v_inv.revoked_at, v_inv.superseded_at, v_inv.blocked_at,
                  v_inv.redacted_at) <> 0
     or v_inv.expires_at <= now() then
    outcome := 'dead';
    return next;
    return;
  end if;

  -- Step 3. The account.
  if v_mode = 'existing_account' then
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
  else
    -- founding_administrator
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
        update people set user_id = v_user_id where id = v_person and user_id is null;
        get diagnostics v_n = row_count;
        if v_n <> 1 then
          raise exception 'presby_accept_invitation: person % could not be linked', v_person;
        end if;
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
      else
        select * into v_tr from presby_apply_treasurer(v_inv.organization_id, v_person, v_inv.created_by_user_id);
        if v_tr.outcome <> 'ok' then
          raise exception 'presby_accept_invitation: apply refused' using detail = v_tr.outcome;
        end if;
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
    --   23505 unique_violation   CONSTRAINT_NAME = 'users_email_unique'             -> account_exists (non-terminal)
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
        if v_con = 'users_email_unique' then
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
  else
    administration_role_key := 'treasurer';
    permission_keys := v_tr.permission_keys;
    treasurer_role_id := v_tr.treasurer_role_id;
  end if;
  return next;
end
$function$;

-- 0059's ACL, re-stated so this file's end state does not depend on history
-- (create or replace already preserves it; revoke-then-grant is idempotent).
revoke all on function presby_preview_invitation(text, uuid) from public, presby_app, presby_platform;
revoke all on function presby_accept_invitation(text, uuid, text, text, text) from public, presby_app, presby_platform;
grant execute on function presby_preview_invitation(text, uuid) to presby_app;
grant execute on function presby_accept_invitation(text, uuid, text, text, text) to presby_app;

-- ---------------------------------------------------------------------------
-- 11. comments
-- ---------------------------------------------------------------------------
comment on column contact_methods.created_at is
  'When this row was written (F210). Default clock_timestamp(), forced on every non-owner insert by contact_methods_guard_write (D2), immutable. The shared order is is_primary desc, created_at, id for display and created_at, id for "promote the oldest remaining" (ER1a). Rows that predate drizzle/0064 carry its apply time.';
comment on column contact_methods.ended_at is
  'Null = active. Removal sets it; a row is never deleted (DECISION-215; DELETE revoked from presby_app and presby_platform). An ended row is frozen by contact_methods_guard_write and is never primary (contact_methods_ended_not_primary). Editing an address ends the row and inserts a replacement, so verified_at never travels to a different mailbox (F214). Every reader filters ended_at is null.';
comment on column contact_methods.verified_at is
  'Proof the person controls this address. Set only on the owner path, in practice only by presby_accept_invitation (contact_methods_guard_write refuses a non-owner insert or change). A replacement or re-added address starts null.';
comment on constraint contact_methods_value_shape on contact_methods is
  'Email: normalized (lower, trimmed), <= 254 characters, exactly one @, no whitespace or comma, a dot in the domain (a strict subset of account_invitations_email_shape, ER13). Phone: trimmed, non-empty. Mirrored by src/lib/contact-methods/normalize.ts isValidEmailShape (anything it accepts, this accepts).';
comment on constraint contact_methods_subtype_check on contact_methods is
  'Labels per kind (ER18). Email: personal | work | other | null (shown as "Email"). Phone: mobile | home | work | null.';
comment on constraint contact_methods_ended_not_primary on contact_methods is
  'An ended row is never the main address (ER1d). Ending the main clears is_primary in the same statement; promoting another row is a separate, explicit write.';
comment on index contact_methods_one_primary_uq is
  'At most one active main per (person, kind) (ER15). The at-least-one half for email is the deferred contact_methods_primary_required trigger.';
comment on index contact_methods_person_email_uq is
  'One active row per (person, normalized address) (ER17). Re-adding an ended address inserts a new row.';
comment on index contact_methods_email_norm_idx is
  'Active-email lookup by normalized address: the invitation readers and the shared-address note (S9).';
comment on function presby_contact_methods_guard_write() is
  'BEFORE INSERT OR UPDATE on contact_methods, invoker, binds every role (drizzle/0064 section 6). Identity (id, person_id, kind, value, created_at) is immutable and an ended row is frozen; a non-owner may not set or change verified_at, may not insert an ended row, and has created_at forced to clock_timestamp(). Owner test: pg_class.relowner against current_user, no role named.';
comment on function presby_contact_methods_primary_check() is
  'Deferred constraint trigger contact_methods_primary_required (drizzle/0064 section 7). SECURITY DEFINER (F26). At commit, refuses a person who has active email rows and no active main. Checks only; never writes.';
comment on function presby_person_email(uuid, text) is
  'Which address a person''s mail uses, by purpose: credential | role | personal (DECISION-216, ER11/ER12). SECURITY INVOKER, adds no authority: on presby_app it sees what RLS shows. Zero or one row; an unknown purpose raises internal_error. The credential authority: a credential''s destination is read here, inside a definer, never trusted from TypeScript. src/lib/contact-methods/reader.ts is its only TypeScript caller.';
