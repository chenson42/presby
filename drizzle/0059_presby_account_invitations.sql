-- drizzle/0059_presby_account_invitations.sql
--
-- Account invitations, Increment 1: platform designations (founding
-- administrator, first treasurer) and the acceptance machinery
-- (docs/work-log/2026-10-21-invitations.md: Phase 2 R1/R2/R5, the operator's
-- R9 reversal, the Phase 2 addendum's conditions on D-1/D-2/D-3/D-5 and the
-- case-insensitive new-account check, and Phase 3 "Data Model" / API Contract
-- section 1; DECISION-183/184/188, findings F153-F159).
--
-- Seven things, in dependency order. The whole file is idempotent: every
-- statement is `if not exists`, drop-then-add, `create or replace`, or
-- revoke-then-grant, so it replays cleanly, including as an in-place
-- correction while this migration is unreleased (CLAUDE.md -> Project Layout
-- -> drizzle/). Proven by applying the whole file twice (work-log, Phase 4
-- Batch 1).
--
--   1. account_invitations   the table, composite keys, CHECKs
--   2. indexes               the two open-row partial uniques (R2 and D-2),
--                            the resend-chain partial unique (D-1), the
--                            limit indexes
--   3. guards                BEFORE INSERT (rows are born open; the resend
--                            chain is a line, D-1), BEFORE UPDATE (identity
--                            frozen; terminal states one-way; the accept and
--                            blocked transitions need the definer-armed
--                            marker), BEFORE DELETE (teardown cascade only).
--                            All three bind the OWNER too (F44:
--                            getPlatformDb() is neondb_owner, which no grant
--                            binds; only triggers do).
--   4. RLS + grants          FORCE, tenant_isolation, presby_app holds NO
--                            table privilege (only two EXECUTEs, section 7)
--   5. single sources        presby_founding_administrator_holder_count,
--                            presby_giving_manage_holder_count,
--                            presby_founding_administrator_permission_keys
--                            (owner only)
--   6. apply helpers         presby_apply_founding_administrator,
--                            presby_apply_treasurer (ungranted; called only
--                            from presby_accept_invitation)
--   7. preview + accept      presby_preview_invitation,
--                            presby_accept_invitation (EXECUTE to presby_app
--                            only), then comments
--
-- TRANSACTION HANDLING: this file carries NO begin/commit of its own (no
-- existing function is dropped and re-created, unlike 0047/0057). Apply it
-- with `-1` so it lands atomically:
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0059_presby_account_invitations.sql
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored. Drizzle mirror: src/lib/db/domain/invitations.ts.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No change to email_queue (the queue-row link is a plain uuid on this
--     side, the 0056 precedent; status 'cancelled' needs no schema change).
--   * No change to users, people, memberships, contact_methods, app_roles,
--     app_role_permissions or role_grants, and no existing function is
--     altered. The users_email_unique constraint stays case-sensitive (a
--     platform-shell table, schema.ts territory); presby_accept_invitation
--     carries the case-insensitive check itself (addendum, contradiction 2).
--   * No audit row: src/lib/onboarding/accept.ts writes the acceptance audit
--     rows in the SAME transaction as the function call (R7, Batch 2c).
--   * No 90-day address redaction sweep: the policy is stated in the table
--     comment as NOT YET ENFORCED (S6, a TODO). Do not claim it anywhere
--     user-facing.

-- ---------------------------------------------------------------------------
-- 1. account_invitations
-- ---------------------------------------------------------------------------
create table if not exists account_invitations (
  id uuid primary key default gen_random_uuid(),
  -- The cascade is reachable only through D10's guarded fixture teardown
  -- (organizations_guard_delete + deletable_until), exactly as giving_* and
  -- organization_domains.
  organization_id uuid not null references organizations(id) on delete cascade,
  purpose text not null,
  origin text not null default 'platform',
  -- Lowercased, trimmed. Null only after redaction (and only then).
  email_normalized text,
  invitee_first_name text,
  invitee_last_name text,
  -- treasurer: required at insert. founding_administrator: null at insert,
  -- set exactly once by the accept transition.
  person_id uuid,
  -- sha256 hex of the raw token. Never rotated (a resend is a new row).
  token_hash text not null,
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- The email_queue row written in the issuing transaction (DECISION-186).
  -- Plain uuid, NO FK (the 0056 giving_statement_deliveries precedent).
  email_queue_id uuid,
  -- Resend lineage points from the NEW row back to the one it superseded
  -- (D-1): no deferred FK and no second write to the frozen old row.
  resent_from_id uuid,
  resend_count integer not null default 0,
  accepted_at timestamptz,
  accepted_user_id uuid references users(id),
  revoked_at timestamptz,
  revoked_by_user_id uuid references users(id),
  superseded_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  redacted_at timestamptz,
  -- Composite Tenant Keys (F2): the target of the self-FK below and of any
  -- future tenant-side reference.
  constraint account_invitations_id_org_key unique (id, organization_id),
  constraint account_invitations_token_hash_key unique (token_hash)
);

-- Foreign keys between tenant tables are composite (F2). Drop-then-add so an
-- in-place correction of this unreleased migration actually changes them.
-- people is global (D1), so the relationship row (memberships) carries the
-- tenant: (person_id, organization_id) -> memberships_person_org_key. MATCH
-- SIMPLE, so a null person_id (an unaccepted founding-administrator
-- invitation) is unconstrained.
alter table account_invitations drop constraint if exists account_invitations_person_membership_fk;
alter table account_invitations add constraint account_invitations_person_membership_fk
  foreign key (person_id, organization_id) references memberships (person_id, organization_id);

alter table account_invitations drop constraint if exists account_invitations_resent_from_fk;
alter table account_invitations add constraint account_invitations_resent_from_fk
  foreign key (resent_from_id, organization_id) references account_invitations (id, organization_id);

-- CHECKs are drop-then-add (the drizzle/0048 idiom), not inline.

alter table account_invitations drop constraint if exists account_invitations_purpose_allowed;
alter table account_invitations add constraint account_invitations_purpose_allowed
  check (purpose in ('founding_administrator', 'treasurer'));

alter table account_invitations drop constraint if exists account_invitations_origin_allowed;
alter table account_invitations add constraint account_invitations_origin_allowed
  check (origin in ('platform'));

-- Lowercase, trimmed, at most 320, exactly one @ with something either side.
-- The app's zod schema is the real rule set; this is the backstop.
alter table account_invitations drop constraint if exists account_invitations_email_shape;
alter table account_invitations add constraint account_invitations_email_shape
  check (email_normalized is null
         or (email_normalized = lower(btrim(email_normalized))
             and char_length(email_normalized) <= 320
             and email_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+$'));

alter table account_invitations drop constraint if exists account_invitations_email_null_iff_redacted;
alter table account_invitations add constraint account_invitations_email_null_iff_redacted
  check ((email_normalized is null) = (redacted_at is not null));

alter table account_invitations drop constraint if exists account_invitations_names_shape;
alter table account_invitations add constraint account_invitations_names_shape
  check ((invitee_first_name is null
          or (invitee_first_name = btrim(invitee_first_name) and char_length(invitee_first_name) between 1 and 100))
     and (invitee_last_name is null
          or (invitee_last_name = btrim(invitee_last_name) and char_length(invitee_last_name) between 1 and 100)));

-- Founding administrator: the sender supplies both names (G2). Treasurer:
-- the person already exists, so no names are carried.
alter table account_invitations drop constraint if exists account_invitations_names_by_purpose;
alter table account_invitations add constraint account_invitations_names_by_purpose
  check ((purpose <> 'founding_administrator'
          or (invitee_first_name is not null and invitee_last_name is not null))
     and (purpose <> 'treasurer'
          or (invitee_first_name is null and invitee_last_name is null)));

alter table account_invitations drop constraint if exists account_invitations_treasurer_has_person;
alter table account_invitations add constraint account_invitations_treasurer_has_person
  check (purpose <> 'treasurer' or person_id is not null);

alter table account_invitations drop constraint if exists account_invitations_token_hash_shape;
alter table account_invitations add constraint account_invitations_token_hash_shape
  check (token_hash ~ '^[0-9a-f]{64}$');

-- 7 days is issue.ts's default; 30 is the hard cap (Q3).
alter table account_invitations drop constraint if exists account_invitations_expiry_window;
alter table account_invitations add constraint account_invitations_expiry_window
  check (expires_at > created_at and expires_at <= created_at + interval '30 days');

alter table account_invitations drop constraint if exists account_invitations_resend_count_range;
alter table account_invitations add constraint account_invitations_resend_count_range
  check (resend_count between 0 and 5);

alter table account_invitations drop constraint if exists account_invitations_resend_lineage;
alter table account_invitations add constraint account_invitations_resend_lineage
  check ((resent_from_id is null) = (resend_count = 0));

alter table account_invitations drop constraint if exists account_invitations_one_terminal;
alter table account_invitations add constraint account_invitations_one_terminal
  check (num_nonnulls(accepted_at, revoked_at, superseded_at, blocked_at) <= 1);

alter table account_invitations drop constraint if exists account_invitations_accepted_shape;
alter table account_invitations add constraint account_invitations_accepted_shape
  check ((accepted_at is null) = (accepted_user_id is null)
     and (accepted_at is null or person_id is not null));

alter table account_invitations drop constraint if exists account_invitations_revoked_shape;
alter table account_invitations add constraint account_invitations_revoked_shape
  check ((revoked_at is null) = (revoked_by_user_id is null));

alter table account_invitations drop constraint if exists account_invitations_blocked_shape;
alter table account_invitations add constraint account_invitations_blocked_shape
  check ((blocked_at is null) = (blocked_reason is null));

alter table account_invitations drop constraint if exists account_invitations_blocked_reason_allowed;
alter table account_invitations add constraint account_invitations_blocked_reason_allowed
  check (blocked_reason in ('has_holders', 'person_elsewhere', 'membership_ended', 'person_merged',
                            'person_linked_elsewhere', 'ambiguous_person', 'not_applicable',
                            'provisioning_incomplete'));

-- Only a finished invitation can be redacted.
alter table account_invitations drop constraint if exists account_invitations_redacted_terminal;
alter table account_invitations add constraint account_invitations_redacted_terminal
  check (redacted_at is null or num_nonnulls(accepted_at, revoked_at, superseded_at, blocked_at) = 1);

-- ---------------------------------------------------------------------------
-- 2. indexes
-- ---------------------------------------------------------------------------
-- Both open-row partial uniques share the predicate "all four terminal
-- timestamps null". Expiry is derived and sits OUTSIDE the predicate, so an
-- expired-but-open row keeps blocking until a resend supersedes it or the
-- operator revokes it (Flow 5). Per F103 neither is an oracle: organization_id
-- leads and presby_app cannot insert in Increment 1. issue.ts maps a
-- unique_violation on EITHER (matched by constraint name) to already_pending
-- (addendum D-2); resend must supersede the old row BEFORE inserting the new.

-- (R2) one open row per (org, purpose, address): the Increment 2 shape.
create unique index if not exists account_invitations_open_address_uq
  on account_invitations (organization_id, purpose, email_normalized)
  where accepted_at is null and revoked_at is null and superseded_at is null and blocked_at is null;

-- (D-2) one open designation per (org, purpose) regardless of address: G1/Q4
-- as a database property. The purpose list keeps Increment 2's purpose out.
create unique index if not exists account_invitations_open_designation_uq
  on account_invitations (organization_id, purpose)
  where purpose in ('founding_administrator', 'treasurer')
    and accepted_at is null and revoked_at is null and superseded_at is null and blocked_at is null;

-- (D-1) a superseded row has at most one successor: the chain is a line in
-- the database, not a tree.
create unique index if not exists account_invitations_resent_from_uq
  on account_invitations (resent_from_id)
  where resent_from_id is not null;

-- The durable limits (R8): per recipient across orgs, per inviter, per org.
create index if not exists account_invitations_email_created_ix
  on account_invitations (email_normalized, created_at);
create index if not exists account_invitations_inviter_created_ix
  on account_invitations (created_by_user_id, created_at);
create index if not exists account_invitations_org_created_ix
  on account_invitations (organization_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. guards
-- ---------------------------------------------------------------------------
-- All SECURITY INVOKER with a pinned search_path: they lend no owner
-- privilege, and they fire on every connection including the owner's (F44).
-- Refusals raise insufficient_privilege, so a caller (and the tests) can tell
-- a guard refusal from a CHECK.
--
-- The marker: `presby.invitation_accept_active` = 'true', transaction-local,
-- armed ONLY by presby_accept_invitation() immediately before its claim or
-- blocked update and cleared immediately after (grant plus marker,
-- DECISION-141; the presby.affiliation_trigger_active / giving_write_active
-- idiom). presby_app holds no UPDATE, so on the tenant path the grant alone
-- already refuses; the marker is what binds the owner path.

-- 3a. BEFORE INSERT ----------------------------------------------------------
-- Creation is guarded as strongly as mutation (F54-F58): an invitation is
-- born OPEN. The authority-bearing act is acceptance, so a row inserted
-- already accepted or blocked would be exactly the bypass the marker exists
-- to prevent; it is refused here on every connection. A founding-
-- administrator row carries no person until acceptance resolves one. And the
-- resend chain is consistent (addendum D-1, the BEFORE INSERT form): the
-- parent is in the same org, already superseded, same purpose and address,
-- and resend_count = parent + 1, so the per-chain cap does not trust issue.ts
-- alone.
create or replace function presby_account_invitations_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
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

  if new.resent_from_id is not null then
    select * into v_parent from account_invitations p where p.id = new.resent_from_id;
    if not found
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
$function$;

-- 3b. BEFORE UPDATE ----------------------------------------------------------
-- Compares NEW against OLD with only the columns the one legal transition may
-- change overlaid, so any column not named here (including one added later)
-- is frozen by default.
--   open -> accepted     marker required; accepted_at, accepted_user_id, and
--                        person_id null -> value (never value -> other)
--   open -> blocked      marker required; blocked_at, blocked_reason
--   open -> revoked      owner path; revoked_at, revoked_by_user_id
--   open -> superseded   owner path; superseded_at
--   terminal -> redacted owner path; email_normalized -> null with
--                        redacted_at (the CHECKs require a terminal row)
-- Nothing else: an open row that stays open changes nothing, a terminal row
-- never changes state again, and identity columns (id, organization_id,
-- purpose, origin, token_hash, names, created_*, expires_at, email_queue_id,
-- resent_from_id, resend_count) never change at all.
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
      raise exception 'account_invitations: an invitation is accepted only through presby_accept_invitation()'
        using errcode = 'insufficient_privilege';
    end if;
    v_expected.accepted_at := new.accepted_at;
    v_expected.accepted_user_id := new.accepted_user_id;
    if old.person_id is null then
      v_expected.person_id := new.person_id;
    end if;
  elsif new.blocked_at is not null then
    if not v_marker then
      raise exception 'account_invitations: an invitation is blocked only through presby_accept_invitation()'
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

-- 3c. BEFORE DELETE ----------------------------------------------------------
-- Never Hard-Delete: invitation rows are history. The one way out is the
-- sanctioned fixture teardown cascade: by the time the RI cascade fires, the
-- parent organizations row is already gone (and organizations_guard_delete
-- only lets that happen for a deletable_until fixture). The
-- presby_org_domains_guard_delete() idiom from 0057, written out here so this
-- file does not depend on it.
create or replace function presby_account_invitations_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception 'account_invitations: invitation rows are permanent; revoke an invitation instead of deleting it'
    using errcode = 'insufficient_privilege';
end
$function$;

revoke all on function presby_account_invitations_guard_insert() from public, presby_app, presby_platform;
revoke all on function presby_account_invitations_guard_update() from public, presby_app, presby_platform;
revoke all on function presby_account_invitations_guard_delete() from public, presby_app, presby_platform;

drop trigger if exists account_invitations_guard_insert on account_invitations;
create trigger account_invitations_guard_insert
  before insert on account_invitations
  for each row execute function presby_account_invitations_guard_insert();

drop trigger if exists account_invitations_guard_update on account_invitations;
create trigger account_invitations_guard_update
  before update on account_invitations
  for each row execute function presby_account_invitations_guard_update();

drop trigger if exists account_invitations_guard_delete on account_invitations;
create trigger account_invitations_guard_delete
  before delete on account_invitations
  for each row execute function presby_account_invitations_guard_delete();

-- ---------------------------------------------------------------------------
-- 4. RLS + grants
-- ---------------------------------------------------------------------------
alter table account_invitations enable row level security;
alter table account_invitations force row level security;

-- For Increment 2 (an org-originated tenant path). In Increment 1 presby_app
-- holds no table privilege, so the policy filters nothing anyone can reach.
drop policy if exists tenant_isolation on account_invitations;
create policy tenant_isolation on account_invitations
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Revoke-then-grant (F38): a re-apply corrects a hand-added grant.
-- presby_app: NOTHING on the table (the DECISION-171 inbox posture); it
-- reaches this table only through the two SECURITY DEFINER functions in
-- section 7. presby_platform: SELECT (the 0049 idiom; binds the day a real,
-- non-owner presby_platform login exists - today getPlatformDb() is
-- neondb_owner, which no grant binds, so the triggers above are the backstop).
revoke all on account_invitations from public, presby_app, presby_platform;
grant select on account_invitations to presby_platform;

-- ---------------------------------------------------------------------------
-- 5. single sources (owner only)
-- ---------------------------------------------------------------------------
-- All SECURITY DEFINER, `set search_path = public, pg_temp` (DECISION-148,
-- pg_temp last), EXECUTE revoked from PUBLIC, presby_app and presby_platform.
-- Owner only because a cross-org count is an oracle. issue.ts calls the two
-- counts via getPlatformDb() (owner) at send; presby_accept_invitation calls
-- them at accept. The TypeScript count* exports become thin wrappers over
-- these (Batch 2d).

-- 5a. Distinct people currently holding roles.manage OR role_grants.manage at
-- p_org: person-arm grants directly, group-arm grants through open
-- group_memberships. LIFTED VERBATIM from
-- src/lib/onboarding/founding-administrator.ts foundingAdministratorHolderCount()
-- (including its open-ended `gm.ends_on is null` group arm and the absence of
-- a membership join: a behaviour change would be a separate ruling).
create or replace function presby_founding_administrator_holder_count(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with active_manage_grants as (
    select rg.id as grant_id, rg.person_id, rg.group_id
      from role_grants rg
      join app_role_permissions arp on arp.role_id = rg.role_id
     where rg.organization_id = p_org
       and arp.permission_key in ('roles.manage', 'role_grants.manage')
       and rg.starts_on <= current_date
       and (rg.ends_on is null or rg.ends_on > current_date)
  ),
  holder_people as (
    select person_id as pid from active_manage_grants where person_id is not null
    union
    select gm.person_id as pid
      from active_manage_grants amg
      join group_memberships gm on gm.group_id = amg.group_id
     where amg.group_id is not null
       and gm.organization_id = p_org
       and gm.ends_on is null
  )
  select count(distinct pid)::int from holder_people;
$function$;

-- 5b. Distinct people CURRENTLY EFFECTIVELY holding giving.manage at p_org
-- (membership-aware, mirroring the resolver's arms 1 and 2). LIFTED VERBATIM
-- from src/lib/onboarding/treasurer-designation.ts countGivingManageHolders().
create or replace function presby_giving_manage_holder_count(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with manage_grants as (
    select rg.person_id, rg.group_id
      from role_grants rg
      join app_role_permissions arp on arp.role_id = rg.role_id
     where rg.organization_id = p_org
       and arp.permission_key = 'giving.manage'
       and rg.starts_on <= current_date
       and (rg.ends_on is null or rg.ends_on > current_date)
  ),
  holder_people as (
    select mg.person_id as pid
      from manage_grants mg
     where mg.person_id is not null
    union
    select gm.person_id as pid
      from manage_grants mg
      join group_memberships gm on gm.group_id = mg.group_id
     where mg.group_id is not null
       and gm.organization_id = p_org
       and gm.starts_on <= current_date
       and (gm.ends_on is null or gm.ends_on > current_date)
  )
  select count(distinct hp.pid)::int
    from holder_people hp
    join people p on p.id = hp.pid and p.merged_into_id is null
    join memberships m on m.person_id = hp.pid
     and m.organization_id = p_org
     and m.ended_on is null;
$function$;

-- 5c. The founding-administrator ADMINISTRATION bundle (F111/F118/F150). The
-- TypeScript foundingAdministratorPlan() stays as display copy and is PINNED
-- EQUAL to this over every organization_type enum value read from the
-- catalog (src/lib/db/domain/invitations.db.test.ts), so a future key edits
-- this function, that function and a backfill together. Order matches the TS
-- array.
create or replace function presby_founding_administrator_permission_keys(p_org_type text)
returns text[]
language sql
immutable
security definer
set search_path = public, pg_temp
as $function$
  select array['people.manage', 'roles.manage', 'role_grants.manage', 'groups.manage',
               'officers.manage', 'org_features.manage', 'tickets.file', 'staff.manage',
               'domains.manage']::text[]
         || case when p_org_type = 'presbytery'
                 then array['congregation_oversight.manage']::text[]
                 else array[]::text[] end;
$function$;

revoke all on function presby_founding_administrator_holder_count(uuid) from public, presby_app, presby_platform;
revoke all on function presby_giving_manage_holder_count(uuid) from public, presby_app, presby_platform;
revoke all on function presby_founding_administrator_permission_keys(text) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 6. apply helpers (ungranted; called only from presby_accept_invitation)
-- ---------------------------------------------------------------------------
-- The effect of the TypeScript designateFoundingAdministrator() /
-- designateTreasurer() transactions, ported step for step (R1). The caller
-- already holds the organization-row lock and has resolved, linked or
-- created the person; these write roles, permissions and grants only. Both
-- re-check their own gate (defence in depth: the caller checked it under the
-- same lock) and return a non-'ok' outcome rather than raising, so the caller
-- can turn it into a committed blocked_at.
--
-- PARITY: src/lib/onboarding/designation-parity.db.test.ts drives the TS
-- transactions and these helpers (through presby_accept_invitation) over
-- shared fixture shapes and compares app_roles, app_role_permissions,
-- role_grants, people and memberships rows, and pins a golden snapshot that
-- survives the TS deletion in Batch 2d.
--
-- No resolver file is touched or called: no presby_effective_permissions()
-- (F107), no assertPermissionSubset(). granted_by is the INVITER, provenance
-- only (no resolver arm reads it).

-- 6a. Founding administrator: TS steps 1-2 and 7-10.
--   administration role 'founding_administrator' / 'Founding Administrator',
--   reuse-and-reactivate (F109), inserted as custom / unprotected; additive
--   reconcile of the bundle (on conflict do nothing); the office template
--   for the org type (presbytery_stated_clerk / congregation_stated_clerk /
--   none) read from the LIVE template row, its role reused-or-inserted the
--   same way (custom / unprotected, the template's name) with its keys
--   reconciled additively; a missing template skips the office half (as TS);
--   one person-arm grant per role.
create or replace function presby_apply_founding_administrator(p_org uuid, p_person_id uuid, p_granted_by uuid)
returns table (outcome text, administration_role_key text, office_role_key text, permission_keys text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_org_type text;
  v_bundle text[];
  v_admin_role_id uuid;
  v_office_key text;
  v_template_id uuid;
  v_template_name text;
  v_office_role_id uuid;
  v_office_keys text[] := array[]::text[];
  v_deactivated timestamptz;
begin
  select o.organization_type::text into v_org_type from organizations o where o.id = p_org;
  if v_org_type is null then
    raise exception 'presby_apply_founding_administrator: no organization %', p_org
      using errcode = 'invalid_parameter_value';
  end if;

  if presby_founding_administrator_holder_count(p_org) > 0 then
    outcome := 'has_holders';
    return next;
    return;
  end if;

  v_bundle := presby_founding_administrator_permission_keys(v_org_type);

  -- Administration role (F109 reuse-and-reactivate).
  select r.id, r.deactivated_at into v_admin_role_id, v_deactivated
    from app_roles r where r.organization_id = p_org and r.key = 'founding_administrator';
  if v_admin_role_id is null then
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (p_org, 'founding_administrator', 'Founding Administrator', 'custom', false)
    returning id into v_admin_role_id;
  elsif v_deactivated is not null then
    update app_roles set deactivated_at = null where id = v_admin_role_id;
  end if;
  insert into app_role_permissions (role_id, permission_key)
  select v_admin_role_id, k from unnest(v_bundle) k
  on conflict (role_id, permission_key) do nothing;

  -- Office role, when the org type has one and its template exists.
  v_office_key := case v_org_type
                    when 'presbytery' then 'presbytery_stated_clerk'
                    when 'congregation' then 'congregation_stated_clerk'
                    else null end;
  if v_office_key is not null then
    select t.id, t.name into v_template_id, v_template_name
      from app_roles t
     where t.key = v_office_key
       and t.organization_id is null
       and (t.organization_type_scope is null or t.organization_type_scope::text = v_org_type)
     limit 1;
    if v_template_id is not null then
      select coalesce(array_agg(p.permission_key), array[]::text[]) into v_office_keys
        from app_role_permissions p where p.role_id = v_template_id;
      v_deactivated := null;
      select r.id, r.deactivated_at into v_office_role_id, v_deactivated
        from app_roles r where r.organization_id = p_org and r.key = v_office_key;
      if v_office_role_id is null then
        insert into app_roles (organization_id, key, name, role_kind, is_protected)
        values (p_org, v_office_key, v_template_name, 'custom', false)
        returning id into v_office_role_id;
      elsif v_deactivated is not null then
        update app_roles set deactivated_at = null where id = v_office_role_id;
      end if;
      insert into app_role_permissions (role_id, permission_key)
      select v_office_role_id, k from unnest(v_office_keys) k
      on conflict (role_id, permission_key) do nothing;
    else
      v_office_key := null;
    end if;
  end if;

  insert into role_grants (organization_id, role_id, person_id, granted_by, grant_reason)
  values (p_org, v_admin_role_id, p_person_id, p_granted_by, 'founding administrator designation');
  if v_office_role_id is not null then
    insert into role_grants (organization_id, role_id, person_id, granted_by, grant_reason)
    values (p_org, v_office_role_id, p_person_id, p_granted_by, 'founding administrator designation');
  end if;

  outcome := 'ok';
  administration_role_key := 'founding_administrator';
  office_role_key := v_office_key;
  permission_keys := v_bundle || v_office_keys;
  return next;
end
$function$;

-- 6b. Treasurer: TS steps 1-2 and 5-7.
--   not_applicable outside the allow-list (congregation,
--   new_worshiping_community: TREASURER_DESIGNATION_ORG_TYPES); the
--   giving.manage holder gate; BOTH templates (treasurer, giving_recorder)
--   read before any write (provisioning_incomplete if either is missing);
--   each org role reused-and-reactivated or inserted COPYING the template's
--   name, kind and protected flag; additive reconcile; one person-arm grant,
--   treasurer only (the recorder role is minted, never granted, F138).
create or replace function presby_apply_treasurer(p_org uuid, p_person_id uuid, p_granted_by uuid)
returns table (outcome text, permission_keys text[], treasurer_role_id uuid, recorder_role_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_org_type text;
  v_t_id uuid; v_t_name text; v_t_kind text; v_t_protected boolean; v_t_keys text[];
  v_r_id uuid; v_r_name text; v_r_kind text; v_r_protected boolean; v_r_keys text[];
  v_treasurer uuid;
  v_recorder uuid;
  v_deactivated timestamptz;
begin
  select o.organization_type::text into v_org_type from organizations o where o.id = p_org;
  if v_org_type is null then
    raise exception 'presby_apply_treasurer: no organization %', p_org
      using errcode = 'invalid_parameter_value';
  end if;

  if v_org_type not in ('congregation', 'new_worshiping_community') then
    outcome := 'not_applicable';
    return next;
    return;
  end if;

  if presby_giving_manage_holder_count(p_org) > 0 then
    outcome := 'has_holders';
    return next;
    return;
  end if;

  select t.id, t.name, t.role_kind, t.is_protected into v_t_id, v_t_name, v_t_kind, v_t_protected
    from app_roles t
   where t.key = 'treasurer' and t.organization_id is null
     and (t.organization_type_scope is null or t.organization_type_scope::text = v_org_type)
   limit 1;
  select t.id, t.name, t.role_kind, t.is_protected into v_r_id, v_r_name, v_r_kind, v_r_protected
    from app_roles t
   where t.key = 'giving_recorder' and t.organization_id is null
     and (t.organization_type_scope is null or t.organization_type_scope::text = v_org_type)
   limit 1;
  if v_t_id is null or v_r_id is null then
    outcome := 'provisioning_incomplete';
    return next;
    return;
  end if;
  select coalesce(array_agg(p.permission_key), array[]::text[]) into v_t_keys
    from app_role_permissions p where p.role_id = v_t_id;
  select coalesce(array_agg(p.permission_key), array[]::text[]) into v_r_keys
    from app_role_permissions p where p.role_id = v_r_id;

  select r.id, r.deactivated_at into v_treasurer, v_deactivated
    from app_roles r where r.organization_id = p_org and r.key = 'treasurer';
  if v_treasurer is null then
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (p_org, 'treasurer', v_t_name, v_t_kind, v_t_protected)
    returning id into v_treasurer;
  elsif v_deactivated is not null then
    update app_roles set deactivated_at = null where id = v_treasurer;
  end if;
  insert into app_role_permissions (role_id, permission_key)
  select v_treasurer, k from unnest(v_t_keys) k
  on conflict (role_id, permission_key) do nothing;

  v_deactivated := null;
  select r.id, r.deactivated_at into v_recorder, v_deactivated
    from app_roles r where r.organization_id = p_org and r.key = 'giving_recorder';
  if v_recorder is null then
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (p_org, 'giving_recorder', v_r_name, v_r_kind, v_r_protected)
    returning id into v_recorder;
  elsif v_deactivated is not null then
    update app_roles set deactivated_at = null where id = v_recorder;
  end if;
  insert into app_role_permissions (role_id, permission_key)
  select v_recorder, k from unnest(v_r_keys) k
  on conflict (role_id, permission_key) do nothing;

  insert into role_grants (organization_id, role_id, person_id, granted_by, grant_reason)
  values (p_org, v_treasurer, p_person_id, p_granted_by, 'treasurer designation');

  outcome := 'ok';
  -- Byte order (collate "C"), matching the TS `[...new Set(...)].sort()`.
  permission_keys := array(select distinct k collate "C" from unnest(v_t_keys || v_r_keys) k order by 1);
  treasurer_role_id := v_treasurer;
  recorder_role_id := v_recorder;
  return next;
end
$function$;

revoke all on function presby_apply_founding_administrator(uuid, uuid, uuid) from public, presby_app, presby_platform;
revoke all on function presby_apply_treasurer(uuid, uuid, uuid) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 7. preview + accept (EXECUTE to presby_app only)
-- ---------------------------------------------------------------------------
-- Both take the RAW token and hash it in SQL (R5), so reading token_hash
-- never confers the ability to claim (a deliberate divergence from
-- DECISION-147's hash-taking functions; F153). Neither sets an org GUC: org,
-- purpose, address and person come from the token's own row (DECISION-183).
-- Both are SECURITY DEFINER for the F26 reason: account_invitations, people,
-- memberships and contact_methods are FORCE RLS and the anonymous /invite
-- path has no org context.

-- 7a. Preview. STABLE, writes nothing, consumes nothing (a mail scanner may
-- open the link). ZERO ROWS for every non-live state: unknown, malformed,
-- expired, accepted, revoked, superseded, blocked, redacted. Otherwise one
-- row. The address is MASKED IN SQL (first character of the local part,
-- '***@', the domain): the full address never reaches application code on
-- the anonymous path (DECISION-153). session_matches (D-3) is whether
-- p_user_id's account email equals the invited address, case-insensitively;
-- null when p_user_id is null, and with p_user_id null NO users row is read
-- (S1). p_user_id MUST come from the auth() session only, never from form
-- data or the query (addendum D-3; the S4 source scan pins the caller).
-- person_display_name: the treasurer's roster name; for a founding
-- administrator, the person acceptance would reuse (the matching session's
-- own live person at this org, else the single live person at this org with
-- this address on file), else the invitee names.
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
       where cm.kind = 'email' and lower(btrim(cm.value)) = v_inv.email_normalized;
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

-- 7b. Accept. Exactly one of p_user_id (existing account; MUST be the auth()
-- session's user, trusted per DECISION-171's wording) and p_password_hash
-- (new account; bcrypt computed in TypeScript after the G17 72-byte check)
-- is non-null, else it raises (a programmer error, not an outcome). Returns
-- EXACTLY ONE ROW. Outcomes (DECISION-188):
--   dead            unknown / malformed / expired / revoked / superseded /
--                   accepted / blocked / redacted. One outcome, every other
--                   column null (DECISION-147 bucket; identity-uniform).
--   account_exists  new mode, an account with this address already exists
--                   (case-insensitive). Non-terminal: nothing written.
--   email_mismatch  existing mode, the account's address is not the invited
--                   one (case-insensitive) or the account does not exist.
--                   Non-terminal.
--   account_inactive existing mode, users.is_active = false. Non-terminal.
--   blocked         a gate refused after the credential was proven:
--                   blocked_at/blocked_reason COMMITTED, nothing else
--                   written (D-5). blocked_reason in the CHECK's list.
--   accepted        account created or verified, person linked or created,
--                   designation applied, invitation claimed - all in the
--                   caller's transaction.
-- Self-acceptance (accepting user = inviter) is NOT refused (operator's R9
-- reversal); inviter_is_invitee is returned for the audit rows.
--
-- BINDING ORDER (a reorder reopens a finding):
--   1. hash; read the row by hash UNLOCKED; none -> dead
--   2. lock the ORGANIZATION row, then re-select the invitation FOR UPDATE
--      and re-validate (lock order org -> invitation -> users -> person for
--      every writer, issue and accept alike: no resend/accept deadlock)
--   3. existing: lock the users row (serializes acceptances for one account,
--      standing in for the withheld people.user_id index, F110/F112); new:
--      hash shape, names, and lower(email) existence (addendum
--      contradiction 2: users_email_unique is case-sensitive)
--   4. gates and person resolution, nothing written yet; a refusal commits
--      blocked_at (marker armed) and returns
--   5. apply phase in an inner BEGIN ... EXCEPTION block (a subtransaction),
--      so a late trigger refusal leaves nothing behind; the claim UPDATE
--      arms the marker immediately before and clears it immediately after
--   6. return accepted
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
           where cm.kind = 'email' and lower(btrim(cm.value)) = v_inv.email_normalized) c;
        if v_n > 1 then
          v_block := 'ambiguous_person';
        elsif v_n = 1 then
          select p.id into v_person
            from contact_methods cm
            join people p on p.id = cm.person_id and p.merged_into_id is null
            join memberships m on m.person_id = p.id and m.organization_id = v_inv.organization_id
           where cm.kind = 'email' and lower(btrim(cm.value)) = v_inv.email_normalized
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
       where person_id = v_person and kind = 'email'
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

revoke all on function presby_preview_invitation(text, uuid) from public, presby_app, presby_platform;
revoke all on function presby_accept_invitation(text, uuid, text, text, text) from public, presby_app, presby_platform;
grant execute on function presby_preview_invitation(text, uuid) to presby_app;
grant execute on function presby_accept_invitation(text, uuid, text, text, text) to presby_app;

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
comment on table account_invitations is
  'Account invitations (DECISION-183/184, drizzle/0059). A DECISION-147 credential: 32 random bytes held by the recipient, stored ONLY as token_hash (sha256 hex), hashed in SQL from the raw token by presby_preview_invitation / presby_accept_invitation (R5). Increment 1 purposes: founding_administrator, treasurer (platform-originated). Born open (account_invitations_guard_insert); terminal states accepted / revoked / superseded / blocked are exclusive and one-way; accepted and blocked need the transaction-local marker presby.invitation_accept_active that only presby_accept_invitation arms (account_invitations_guard_update, binds the owner too). One open row per (org, purpose, address) and per (org, purpose) for the designation purposes; resend inserts a new row naming the superseded one in resent_from_id (at most one successor). Never deleted (no DELETE grant; account_invitations_guard_delete passes only the fixture-teardown cascade). presby_app holds NO table privilege, only EXECUTE on the two functions. RETENTION: the policy is to null email_normalized (redacted_at) 90 days after an invitation ends; THIS IS NOT YET ENFORCED (no sweep exists, docs/TODO.md S6). Invitee names are retained after redaction (named residual).';
comment on column account_invitations.token_hash is
  'sha256 hex of the raw token. Immutable, never rotated. Reading it confers nothing: both functions take the RAW token (R5, F153).';
comment on column account_invitations.email_normalized is
  'The invited address, lowercased and trimmed. Null iff redacted_at is set (only on a terminal row). The 90-day redaction is policy, NOT YET ENFORCED (S6).';
comment on column account_invitations.resent_from_id is
  'The superseded invitation this resend replaces (D-1). Same organization, purpose and address, resend_count = parent + 1, enforced at insert; account_invitations_resent_from_uq allows one successor per row.';
comment on column account_invitations.email_queue_id is
  'The email_queue row written in the issuing transaction (DECISION-186). Set at insert, immutable. Plain uuid, no FK (0056 precedent).';
comment on function presby_accept_invitation(text, uuid, text, text, text) is
  'The ONLY acceptance path (DECISION-183/188). presby_app EXECUTE only. Takes the raw token; derives org, purpose, address and person from its row; no org GUC. Creates (new mode) or verifies (existing mode, p_user_id = the session user) the account, links or creates the person, applies the designation via presby_apply_founding_administrator / presby_apply_treasurer, and claims the row, in the caller''s transaction. Returns one row: dead | account_exists | email_mismatch | account_inactive (nothing written) | blocked (blocked_at committed, nothing else) | accepted. Self-acceptance is permitted and reported as inviter_is_invitee.';
comment on function presby_preview_invitation(text, uuid) is
  'Read-only preview for /invite (DECISION-183). presby_app EXECUTE only. Zero rows for every non-live state. The address is masked in SQL. p_user_id must be the auth() session user; with it null no users row is read (S1).';
