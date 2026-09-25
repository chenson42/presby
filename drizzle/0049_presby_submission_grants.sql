-- Submission grants: a token-bearing CREDENTIAL that lets a congregation with
-- no account file one SASR return — increment 6 of the lifecycle/affiliation/
-- returns programme (docs/work-log/2026-09-25-submission-grants.md, Phase 3
-- Data Model; D16; DECISION-147; F80; docs/schema-design-2.md sec 6 "Section P
-- — submission without an account").
--
-- WHAT A GRANT IS, AND WHAT IT IS NOT (DECISION-147). A grant is a THIRD
-- access mechanism alongside permissions and flags: a one-time,
-- single-purpose, single-year, single-congregation, expiring capability. It is
-- never mapped into FEATURES.*, into a session claim, or into the permission
-- resolver. It names its own subject, so the submission function derives BOTH
-- organization ids from the grant row it just authenticated and the
-- application sets NO org GUC on the anonymous path — setting one would be
-- withOrgContext() with the membership check deleted, which is the
-- confused-deputy shape CLAUDE.md's "RLS enforces tenancy, not authorization"
-- paragraph names. The tenant tables are owned by neondb_owner (BYPASSRLS), so
-- a SECURITY DEFINER function needs no org context to write them (F44,
-- measured on this Neon branch 2026-09-25: presby_app rolbypassrls = f,
-- neondb_owner = t).
--
-- THE CHAIN KEEPS ONE WRITER AND ONE ARMING SITE (F55/DECISION-141). Section 3
-- extracts the return -> publication -> projection inserts, the
-- report-year/form-version/recipient-type checks and F80's year-endpoint
-- affiliation collision check into ONE internal, ungranted function,
-- presby_write_return_publication_chain(). Section 4 RE-CREATES
-- presby_publish_sasr_snapshot() (same name, same 62-parameter signature, same
-- external contract) as a thin caller of it, and section 5's
-- presby_submit_granted_return() is the second thin caller — the one that
-- supplies the first NON-NULL attestation this platform has ever recorded
-- (F57). Delegating the grant path to presby_publish_sasr_snapshot() instead
-- would discard that attestation (it writes attested_by_name/attested_role as
-- literal null, deliberately); duplicating the three inserts would falsify
-- F39's "both rows are written by ONE DEFINER function in ONE transaction"
-- non-drift premise.
--
-- SECTION 4 SUPERSEDES drizzle/0047 SECTION 7's FUNCTION BODY. It is a
-- fix-forward `create or replace`, NOT an edit to 0047: 0047 is merged and
-- applied to `development`, other worktrees read it, and a replay applies 0047
-- then 0049 in order with the same end state. Its signature, its return value
-- (the artifact's id), its errcodes and its org-context/recipient-resolution
-- behaviour are unchanged; what moves is where the four shared checks and the
-- three inserts LIVE. The rejection MESSAGE TEXT for the four moved checks now
-- names presby_write_return_publication_chain instead — named as a deviation
-- in the work-log's Phase 4 notes, and safe because scripts/test-rls.sql
-- asserts the ERRCODE (invalid_parameter_value) on every one of them and
-- because Phase 2's grep found no application caller of any kind.
--
-- F80, RULED (Phase 3 ruling 1). The chain enforced TWO affiliation instants:
-- publications.recipient_org_id is resolved at current_date, while
-- congregation_statistics_about_org (drizzle/0045) requires affiliation at an
-- endpoint of the REPORT YEAR. A congregation that changed presbytery after
-- the report year and then files late — exactly D16's late-filing population —
-- had its return and publication written and its projection refused, aborting
-- the chain. The year-endpoint check moves into the shared writer, run ONCE
-- before any insert, so both callers get the same protection from one piece of
-- code and drizzle/0045's trigger becomes unreachable-as-a-refusal BY
-- CONSTRUCTION rather than by convention. The trigger stays: it is the
-- defence-in-depth half against a direct INSERT that goes around the writer.
--
-- THE GRANT'S OWN AFFILIATION INSTANT (Phase 3 ruling 2). The recipient is
-- resolved FRESH from the affiliation history at claim time.
-- grant.organization_id is provenance of ISSUANCE, never authority to RECEIVE
-- (D19 unchanged); it is used only as an equality check against the freshly
-- resolved council. Agreement makes the grant live; disagreement makes it a
-- lapsed credential, refused under the SAME uniform literal as an expired,
-- revoked, spent or nonexistent one.
--
-- CREATION IS GUARDED AS STRONGLY AS MUTATION, in the shape each act deserves
-- (F54-F58/DECISION-141). Issuance is ordinary tenant DML — organization_id is
-- the caller's own presbytery, no cross-council write — so it is guarded by
-- two BEFORE INSERT triggers rather than by function mediation. The CLAIM is
-- cross-boundary and anonymous, so it is function-mediated: presby_app holds a
-- COLUMN-LEVEL update grant on revoked_at alone and cannot reach submitted_at
-- or return_id at all, and the freeze trigger additionally requires a new,
-- unshared transaction-local GUC, presby.grant_claim_active. Not
-- presby.publication_write_active: claiming a credential and writing an
-- artifact are two claims about two subsystems, which is F56's no-reuse case.
-- A marker is not a privilege, and a grant is not a guard — both halves are
-- here.
--
-- MIGRATION NUMBERING. 0049 was PRE-ASSIGNED by the orchestrator at this
-- pipeline's Rule 16 kickoff (0048 belongs to the concurrent lifecycle
-- pipeline). `ls drizzle/` at implementation time found 0047 as the highest
-- number on disk; drizzle/meta/_journal.json gains 0049's entry only, per the
-- same kickoff.
--
-- Hand-written per CLAUDE.md — Drizzle Kit emits no RLS, no trigger, no
-- function and no grant. Every statement is idempotent and the WHOLE FILE was
-- applied twice, end to end, with identical resulting state (proof in the
-- work-log's Phase 4 section).
--
-- Apply with:
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0049_presby_submission_grants.sql
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. statistics_submission_grants — the credential
-- ---------------------------------------------------------------------------
create table if not exists statistics_submission_grants (
  id uuid primary key default gen_random_uuid(),
  -- The ISSUING PRESBYTERY. Tenant scope for the policy below, and provenance
  -- of issuance — NOT authority to receive (see the header, D19).
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The CONGREGATION being asked. Plain FK: the section-17 structural
  -- exception, exactly as publications.organization_id and
  -- congregation_statistics.about_org_id are — `organizations` carries no
  -- tenant scope of its own, it is the public council tree.
  about_org_id uuid not null references organizations(id) on delete cascade,
  report_year integer not null,
  -- sha256 hex of a 32-byte CSPRNG token. NEVER the token itself; the raw
  -- token exists only in the issuance function's scope and in the email.
  token_hash text not null,
  issued_to_name text not null,
  issued_to_email text not null,
  -- The issuing admin. This is NOT the Ruling-A4 acting-user gap: the row is
  -- written by ordinary tenant DML under a real session, never by a SECURITY
  -- DEFINER function serving an anonymous caller, so there is no
  -- caller-supplied identity claim here.
  issued_by uuid not null references users(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- THE CLAIM, in two sanctioned steps inside ONE transaction: submitted_at
  -- moves ALONE first (the atomic, non-repeatable claim), then return_id
  -- follows once the chain writer has produced an artifact. See the freeze
  -- trigger in section 2c for why this is two statements and not one, and why
  -- that is what makes "claim first, write second" and "one indexed
  -- UPDATE ... RETURNING is the concurrency control" both true at once.
  submitted_at timestamptz,
  return_id uuid,
  -- The issuing presbytery's own revocation. Ordinary tenant DML; never
  -- re-cleared (the freeze trigger makes a revoked row terminal).
  revoked_at timestamptz,
  constraint statistics_submission_grants_id_org_key unique (id, organization_id),
  constraint statistics_submission_grants_token_hash_key unique (token_hash),
  constraint statistics_submission_grants_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint statistics_submission_grants_report_year_range
    check (report_year between 1900 and 2100),
  constraint statistics_submission_grants_expiry_shape
    check (expires_at > issued_at),
  constraint statistics_submission_grants_name_shape
    check (char_length(btrim(issued_to_name)) between 1 and 255),
  constraint statistics_submission_grants_email_shape
    check (char_length(issued_to_email) between 3 and 320),
  -- ONE-DIRECTIONAL, not symmetric — F51's lesson applied from the start
  -- rather than corrected later. return_id implies submitted_at; submitted_at
  -- does NOT require return_id, because the mid-claim state (claimed, chain
  -- not yet written) is legal, transient, and closed by the same transaction
  -- that opened it.
  constraint statistics_submission_grants_claim_shape
    check (return_id is null or submitted_at is not null),
  -- THE COMPOSITE FK, AND THE CORRECTION TO THE NAIVE READING (F2). The grant
  -- is owned by the PRESBYTERY (organization_id); the submitted return it
  -- claims is owned by the CONGREGATION. So the column that equals
  -- statistical_returns.organization_id is about_org_id, not organization_id —
  -- the same correction drizzle/0047 already made for
  -- congregation_statistics.publication_id. Writing it the naive way would
  -- reject every row it was meant to protect. MATCH SIMPLE (the default) means
  -- a null return_id — every outstanding grant — is not checked at all.
  constraint statistics_submission_grants_return_fk
    foreign key (return_id, about_org_id)
    references statistical_returns (id, organization_id)
);

-- ONE LIVE GRANT per (presbytery, congregation, year). A revoked or spent
-- grant is not live and does not block a re-issue. Partial, so a table
-- constraint cannot express it.
--
-- F40 (a constraint as a cross-tenant existence oracle), evaluated and clean —
-- recorded here so the security pass does not re-raise it. This index can only
-- collide with the CALLER'S OWN presbytery's row, so it is not an oracle.
-- token_hash's unique IS global across tenants, but a collision requires
-- guessing a 256-bit CSPRNG value, so it is not an exploitable one. The index
-- also deliberately permits two DIFFERENT presbyteries to hold live grants for
-- the same congregation-year; the claim-time affiliation re-verification in
-- section 5 is what kills the stale one.
create unique index if not exists statistics_submission_grants_live_idx
  on statistics_submission_grants (organization_id, about_org_id, report_year)
  where revoked_at is null and submitted_at is null;

create index if not exists statistics_submission_grants_about_org_year_idx
  on statistics_submission_grants (about_org_id, report_year);
create index if not exists statistics_submission_grants_org_idx
  on statistics_submission_grants (organization_id);

alter table statistics_submission_grants enable row level security;
alter table statistics_submission_grants force row level security;

-- Without FORCE the table owner bypasses every policy and RLS is silently
-- inert while every naive test still passes (F1).
drop policy if exists tenant_isolation on statistics_submission_grants;
create policy tenant_isolation on statistics_submission_grants
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- THE GRANT SHAPE (F55/DECISION-141 extended to a credential table).
-- presby_platform is narrowed the SAME way publications was, not left with its
-- blanket drizzle/0009 grant: this table records an authorization event, and a
-- platform-shell connection reading across every tenant should never be able
-- to ISSUE one.
revoke all on statistics_submission_grants from presby_app, presby_platform;
grant select on statistics_submission_grants to presby_app, presby_platform;
grant insert on statistics_submission_grants to presby_app;
-- COLUMN-LEVEL, and this is the half that closes the TENANT path independently
-- of any GUC (QA-2's correction to F56: a marker binds the owner path only).
-- presby_app may revoke its own presbytery's grants and nothing else;
-- submitted_at and return_id are written ONLY inside
-- presby_submit_granted_return(), which runs as the owner (F44).
grant update (revoked_at) on statistics_submission_grants to presby_app;
-- No DELETE grant to either role, and NO DELETE guard trigger — a deliberate,
-- bounded residual (Phase 2 question 7), recorded so the next reviewer does
-- not read it as an oversight. Both organization FKs are ON DELETE CASCADE, so
-- a fixture organization teardown (itself guarded by
-- presby_guard_organizations_delete(), drizzle/0044) removes grant rows for
-- free with no arming needed. The asset protected is an expiring credential,
-- not a permanent record: a submitted grant's evidentiary value is already
-- durable in audit_events and in the immutable return itself.

comment on table statistics_submission_grants is
  'A token-bearing CREDENTIAL (DECISION-147, D16): one presbytery, one congregation, one report year, one write, expiring. Issued by ordinary tenant DML under a session; CLAIMED only by presby_submit_granted_return() (SECURITY DEFINER, drizzle/0049 section 5). The token itself is never stored — token_hash is sha256 hex.';
comment on column statistics_submission_grants.organization_id is
  'The ISSUING presbytery, and the tenant scope of the tenant_isolation policy. Provenance of issuance, NEVER authority to receive: presby_submit_granted_return() re-resolves the recipient from the affiliation history at claim time and uses this column only as a staleness equality check (D19, DECISION-147).';
comment on column statistics_submission_grants.about_org_id is
  'The congregation being asked to file. Plain (non-composite) FK by the section-17 structural exception. Enforced at INSERT by statistics_submission_grants_about_org (affiliated with the issuer TODAY) and statistics_submission_grants_unmanaged (platform_status <> managed), drizzle/0049 section 2.';
comment on column statistics_submission_grants.token_hash is
  'sha256 hex of a 32-byte CSPRNG token, the requestPasswordReset precedent. NOT bcrypt: bcrypt is for low-entropy secrets. The raw token never enters this database.';
comment on column statistics_submission_grants.submitted_at is
  'THE CLAIM. Set alone, by one atomic UPDATE ... RETURNING inside presby_submit_granted_return(), with presby.grant_claim_active armed. presby_app holds no UPDATE privilege on this column at all.';
comment on column statistics_submission_grants.return_id is
  'THE STAMP, set in a second sanctioned UPDATE in the same transaction once the chain writer has produced the artifact. Composite FK is (return_id, about_org_id) -> statistical_returns (id, organization_id): the grant is owned by the presbytery and the return by the CONGREGATION.';
comment on column statistics_submission_grants.revoked_at is
  'The issuing presbytery''s own revocation — the ONE transition ordinary tenant DML may perform, via the column-level UPDATE grant. A revoked grant is terminal: re-issue instead.';

-- ---------------------------------------------------------------------------
-- 2. The three triggers: two on creation, one on mutation
-- ---------------------------------------------------------------------------

-- 2a. The about-org relationship, at ISSUANCE.
-- Reuses drizzle/0045's shared checker through TG_ARGV rather than writing a
-- fifth affiliation trigger. The EMPTY year argument resolves it at
-- current_date — deliberately a DIFFERENT instant from the report-year check
-- inside the chain writer (section 3): issuance asks "is this congregation
-- mine TODAY", submission asks "was this congregation this council's DURING
-- the report year". Both instants are named in DECISION-147; neither is
-- accidental.
drop trigger if exists statistics_submission_grants_about_org on statistics_submission_grants;
create trigger statistics_submission_grants_about_org
  before insert on statistics_submission_grants
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

-- 2b. The `managed` exclusion, at ISSUANCE, IN THE DATABASE (Phase 3 ruling 3).
-- A managed congregation has an account and self-files through its own portal
-- with statistics.publish; a grant is for the unmanaged and invited. The UI
-- picker's filter is a convenience, never authority — CLAUDE.md's own rule is
-- that the check that matters is at write time.
--
-- NOT re-checked at claim time, deliberately: re-checking would add a THIRD
-- instant to reconcile for no protective gain (the credential already expires
-- on its own schedule), and if the congregation's new clerk self-files in the
-- interim, the EXISTING supersession chain resolves the conflict as an
-- ordinary correction. That is what makes this a policy choice, safely
-- relaxable later, rather than a structural dependency.
--
-- SECURITY INVOKER, stated rather than omitted (DECISION-121's warning against
-- cargo-culted DEFINER): `organizations` carries no RLS at all (verified on
-- this Neon branch, relrowsecurity = f), so there is nothing for DEFINER to
-- see past and no owner privilege to escalate into.
create or replace function presby_check_grant_about_org_unmanaged()
returns trigger language plpgsql as $fn$
declare
  v_status text;
begin
  select platform_status into v_status from organizations where id = new.about_org_id;
  if v_status = 'managed' then
    raise exception
      'statistics_submission_grants: % already has an active account and self-files through its own portal; a submission grant is only for an unmanaged or invited congregation',
      new.about_org_id
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end $fn$;

-- Trigger-only (B-M1's rule). EXECUTE on a trigger function is checked when
-- the trigger is CREATED, never when it fires (drizzle/0045 records the same
-- fact and scripts/test-rls.sql sections 29/33 are its proof), so revoking the
-- application roles' grant does not touch the live tenant issuance path.
revoke all on function presby_check_grant_about_org_unmanaged() from public;
revoke execute on function presby_check_grant_about_org_unmanaged() from presby_app, presby_platform;

drop trigger if exists statistics_submission_grants_unmanaged on statistics_submission_grants;
create trigger statistics_submission_grants_unmanaged
  before insert on statistics_submission_grants
  for each row execute function presby_check_grant_about_org_unmanaged();

-- 2c. THE FREEZE — exactly THREE sanctioned transitions, on every connection.
--
-- Three, not two (Phase 3 ruling 4): the claim and the stamp are two separate
-- statements inside one transaction, because the artifact the stamp points at
-- does not exist until after the claim has been won.
--
--   1. REVOCATION — revoked_at null -> set, nothing else moves. No GUC: this
--      is ordinary tenant DML and the column-level grant has already narrowed
--      it to exactly this column.
--   2. THE CLAIM — submitted_at null -> set, return_id STAYS null, nothing
--      else moves, and only while presby.grant_claim_active is armed.
--   3. THE STAMP — from an already-claimed row: return_id null -> set,
--      nothing else moves (not even submitted_at, which must equal
--      old.submitted_at), and only while presby.grant_claim_active is armed.
--
-- A row is TERMINAL once revoked_at or return_id is non-null. Every other
-- UPDATE raises, in presby_freeze_publication()'s own errcode/message shape.
--
-- IT FIRES ON THE OWNER PATH TOO, which is the only reason the claim is
-- actually guarded: getPlatformDb() connects as neondb_owner, which no grant
-- binds and which BYPASSRLS exempts from every policy — but BYPASSRLS exempts
-- a role from RLS POLICIES, never from TRIGGERS (F44).
--
-- SECURITY INVOKER: it reads OLD and NEW and one GUC, and touches no table.
create or replace function presby_freeze_statistics_submission_grant()
returns trigger language plpgsql as $fn$
begin
  if old.revoked_at is not null then
    raise exception 'statistics_submission_grants %: already revoked at %; issue a new grant instead',
      old.id, old.revoked_at using errcode = 'check_violation';
  end if;
  if old.return_id is not null then
    raise exception 'statistics_submission_grants %: already claimed by return %; a spent grant is immutable',
      old.id, old.return_id using errcode = 'check_violation';
  end if;

  if old.submitted_at is not null then
    -- Only the stamp (transition 3) is legal from here.
    if new.return_id is null
       or new.submitted_at is distinct from old.submitted_at
       or new.revoked_at is distinct from old.revoked_at
       or new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.about_org_id is distinct from old.about_org_id
       or new.report_year is distinct from old.report_year
       or new.token_hash is distinct from old.token_hash
       or new.issued_to_name is distinct from old.issued_to_name
       or new.issued_to_email is distinct from old.issued_to_email
       or new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at
       or new.expires_at is distinct from old.expires_at
    then
      raise exception 'statistics_submission_grants %: a claimed grant may only be stamped with return_id, once',
        old.id using errcode = 'check_violation';
    end if;
    if coalesce(current_setting('presby.grant_claim_active', true), '') <> 'true' then
      raise exception 'statistics_submission_grants %: a grant may only be claimed by the sanctioned submission function',
        old.id using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.revoked_at is not null then
    if new.submitted_at is not null or new.return_id is not null
       or new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.about_org_id is distinct from old.about_org_id
       or new.report_year is distinct from old.report_year
       or new.token_hash is distinct from old.token_hash
       or new.issued_to_name is distinct from old.issued_to_name
       or new.issued_to_email is distinct from old.issued_to_email
       or new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at
       or new.expires_at is distinct from old.expires_at
    then
      raise exception 'statistics_submission_grants %: a revocation may only set revoked_at',
        old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.submitted_at is not null then
    if new.return_id is not null or new.revoked_at is not null
       or new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.about_org_id is distinct from old.about_org_id
       or new.report_year is distinct from old.report_year
       or new.token_hash is distinct from old.token_hash
       or new.issued_to_name is distinct from old.issued_to_name
       or new.issued_to_email is distinct from old.issued_to_email
       or new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at
       or new.expires_at is distinct from old.expires_at
    then
      raise exception 'statistics_submission_grants %: a claim must set submitted_at alone; return_id follows separately',
        old.id using errcode = 'check_violation';
    end if;
    if coalesce(current_setting('presby.grant_claim_active', true), '') <> 'true' then
      raise exception 'statistics_submission_grants %: a grant may only be claimed by the sanctioned submission function',
        old.id using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'statistics_submission_grants %: no recognized transition',
    old.id using errcode = 'check_violation';
end $fn$;

revoke all on function presby_freeze_statistics_submission_grant() from public;
revoke execute on function presby_freeze_statistics_submission_grant() from presby_app, presby_platform;

drop trigger if exists statistics_submission_grants_freeze on statistics_submission_grants;
create trigger statistics_submission_grants_freeze
  before update on statistics_submission_grants
  for each row execute function presby_freeze_statistics_submission_grant();

-- ---------------------------------------------------------------------------
-- 3. presby_write_return_publication_chain() — ONE writer, ONE arming site
-- ---------------------------------------------------------------------------
-- Extracted from drizzle/0047 section 7 (Phase 2 ruling 5b, [BINDING]).
-- Everything both callers share lives here and nowhere else: the report-year
-- range check, the form-version-exists check, the recipient-type check, F80's
-- year-endpoint affiliation collision check, the single
-- presby.publication_write_active arming site, and the three inserts.
--
-- NO EXECUTE GRANT TO ANY APPLICATION ROLE. Its only callers are the two
-- SECURITY DEFINER wrappers below, whose inner calls check EXECUTE against
-- neondb_owner, so containment is free.
--
-- WHY THE PROJECTION IS EXTRACTED FROM jsonb RATHER THAN FROM 60 PARAMETERS
-- (Phase 3 ruling 5's named mechanism). jsonb_to_record with an EXPLICIT
-- AS-list of the same name/type pairs already in drizzle/0047's own
-- congregation_statistics INSERT column list — copied from that list, so the
-- only source of truth for "which 60 fields" is one place a diff can catch.
-- Extraction is BY NAME, so a missing key becomes a loud NULL rather than a
-- silently shifted value. jsonb_populate_record against a row type was
-- rejected: it would silently accept a renamed or extra key with no diagnostic
-- at all. This is safe because by the time this INSERT runs,
-- presby_enforce_sasr_field_spec() has ALREADY validated every key in
-- p_payload against the named form version on the statistical_returns insert
-- above — the extraction works from an already-closed allow-list — and because
-- drizzle/0046 section 2's DO block asserts the 2024 field_spec key set equals
-- congregation_statistics's typed-column set.
create or replace function presby_write_return_publication_chain(
  p_org uuid,
  p_recipient uuid,
  p_report_year integer,
  p_form_version text,
  p_payload jsonb,
  p_reconciled boolean,
  p_attested_by_name text,
  p_attested_role text,
  p_authorized_by uuid,
  p_minute_reference text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_recipient_type organization_type;
  v_now            timestamptz := now();
  v_return_id      uuid;
  v_publication_id uuid;
  v_supersedes_id  uuid;
begin
  if p_org is null or p_recipient is null then
    raise exception 'presby_write_return_publication_chain: source and recipient are both required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_report_year is null or p_report_year < 1900 or p_report_year > 2100 then
    raise exception 'presby_write_return_publication_chain: report year % out of range', p_report_year
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from sasr_form_versions where key = p_form_version) then
    raise exception
      'presby_write_return_publication_chain: form version % is not seeded; drizzle/0046 must have been applied',
      p_form_version
      using errcode = 'invalid_parameter_value';
  end if;

  select organization_type into v_recipient_type from organizations where id = p_recipient;
  if v_recipient_type is distinct from 'presbytery' then
    raise exception
      'presby_write_return_publication_chain: the recipient council of % is not a presbytery (found %)',
      p_org, v_recipient_type
      using errcode = 'invalid_parameter_value';
  end if;

  -- THE COLLISION CHECK (F80 / DECISION-147) — ONE location, both callers.
  -- congregation_statistics_about_org (drizzle/0045) re-checks the SAME
  -- predicate on the third insert below; a pass here makes that trigger's own
  -- rejection unreachable BY CONSTRUCTION rather than by convention, which is
  -- what stops a late filer from having two rows written and the third
  -- refused with an opaque about-org message.
  if not (presby_org_affiliated(p_org, p_recipient, make_date(p_report_year, 1, 1))
          or presby_org_affiliated(p_org, p_recipient, make_date(p_report_year, 12, 31))) then
    raise exception
      'presby_write_return_publication_chain: % was not affiliated with % during % — a return for a year before this congregation joined this council cannot be published to it; it belongs to the council that received it, through the import path',
      p_org, p_recipient, p_report_year
      using errcode = 'invalid_parameter_value';
  end if;

  -- ARM THE SANCTIONED-WRITE GUC (F55 / DECISION-141), once, for all three
  -- inserts, AFTER every validation above so a call that is going to be
  -- refused never arms anything. Transaction-local: a session-scoped GUC would
  -- leave the three guards disarmed for the next unrelated request on a pooled
  -- neon-serverless connection. THIS IS THE ONLY SITE IN THE DATABASE THAT
  -- ARMS IT for the publish chain — that property is what
  -- scripts/test-rls.sql section 35 now pins.
  perform set_config('presby.publication_write_active', 'true', true);

  -- 1. THE ARTIFACT, owned by the congregation, about itself.
  insert into statistical_returns (
    organization_id, about_org_id, report_year, form_version_key,
    provenance, payload, reconciled,
    attested_by_name, attested_role, attested_at, created_at
  ) values (
    p_org, p_org, p_report_year, p_form_version,
    'submitted', p_payload, p_reconciled,
    -- NULL from presby_publish_sasr_snapshot() (no acting-user context there,
    -- Ruling A4); the grant path supplies a VERIFIED name and role — the first
    -- non-null attestation F57 anticipated.
    p_attested_by_name, p_attested_role, v_now, v_now
  )
  returning id into v_return_id;

  -- 2. THE EVENT. supersedes is DERIVED, never accepted as a parameter: the
  --    source council's own most recent NON-WITHDRAWN publication for the same
  --    report year. A withdrawn publication is not a thing a new one corrects.
  select p.id into v_supersedes_id
    from publications p
    join statistical_returns r
      on r.id = p.artifact_id and r.organization_id = p.organization_id
   where p.organization_id = p_org
     and p.record_class = 'statistical_return'
     and p.withdrawn_at is null
     and r.report_year = p_report_year
   order by p.published_at desc, r.created_at desc
   limit 1;

  insert into publications (
    organization_id, recipient_org_id, record_class, artifact_id,
    published_at, supersedes_id, authorized_by, minute_reference, withdrawn_at
  ) values (
    p_org, p_recipient, 'statistical_return', v_return_id,
    v_now, v_supersedes_id, p_authorized_by, p_minute_reference, null
  )
  returning id into v_publication_id;

  -- 3. THE PROJECTION, at the recipient, about the source. published_at is
  --    v_now — the SAME instant written to the publication, not a second
  --    now() — so F39's equality assertion is exact rather than approximately
  --    true.
  insert into congregation_statistics (
    organization_id, about_org_id, year, provenance, publication_id,
    published_at, minute_reference,
    gains_professions_under18, gains_professions_18plus, gains_certificate, gains_other,
    losses_certificate, losses_deaths, losses_other,
    ending_active, ending_baptized, ending_affiliate, ending_other_participants,
    gender_woman, gender_man, gender_nonbinary,
    age_17_under, age_18_25, age_26_40, age_41_55, age_56_70, age_71_over, age_unknown,
    race_asian, race_african, race_african_american, race_black, race_hispanic,
    race_middle_eastern, race_native_american, race_white, race_other,
    disability_hearing, disability_mobility, disability_sight, disability_other,
    officers_ruling_elder_count, officers_deacon_count,
    baptisms_children, baptisms_adults,
    youth_4_under, youth_k_5, youth_6_8, youth_9_12,
    avg_weekly_worship_attendance, potential_giving_units,
    receipts_contributions, receipts_capital_building_funds,
    receipts_investment_endowment_income, receipts_bequests, receipts_other_income,
    receipts_subsidy_or_aid,
    exp_local_program, exp_local_mission, exp_capital, exp_investment,
    exp_per_capita_apportionment, exp_validated_mission_pcusa,
    exp_ga_theological_education_fund, exp_other_mission,
    budgeted_income, budgeted_expense
  )
  select p_recipient, p_org, p_report_year, 'published_by_congregation', v_publication_id,
         v_now, p_minute_reference, f.*
    from jsonb_to_record(p_payload) as f(
      gains_professions_under18 integer, gains_professions_18plus integer,
      gains_certificate integer, gains_other integer,
      losses_certificate integer, losses_deaths integer, losses_other integer,
      ending_active integer, ending_baptized integer, ending_affiliate integer,
      ending_other_participants integer,
      gender_woman integer, gender_man integer, gender_nonbinary integer,
      age_17_under integer, age_18_25 integer, age_26_40 integer, age_41_55 integer,
      age_56_70 integer, age_71_over integer, age_unknown integer,
      race_asian integer, race_african integer, race_african_american integer,
      race_black integer, race_hispanic integer, race_middle_eastern integer,
      race_native_american integer, race_white integer, race_other integer,
      disability_hearing integer, disability_mobility integer, disability_sight integer,
      disability_other integer,
      officers_ruling_elder_count integer, officers_deacon_count integer,
      baptisms_children integer, baptisms_adults integer,
      youth_4_under integer, youth_k_5 integer, youth_6_8 integer, youth_9_12 integer,
      avg_weekly_worship_attendance integer, potential_giving_units integer,
      receipts_contributions numeric, receipts_capital_building_funds numeric,
      receipts_investment_endowment_income numeric, receipts_bequests numeric,
      receipts_other_income numeric, receipts_subsidy_or_aid numeric,
      exp_local_program numeric, exp_local_mission numeric, exp_capital numeric,
      exp_investment numeric, exp_per_capita_apportionment numeric,
      exp_validated_mission_pcusa numeric, exp_ga_theological_education_fund numeric,
      exp_other_mission numeric,
      budgeted_income numeric, budgeted_expense numeric
    );

  -- The ARTIFACT's id: the row this chain fundamentally produces.
  return v_return_id;
end $fn$;

revoke all on function presby_write_return_publication_chain(
  uuid, uuid, integer, text, jsonb, boolean, text, text, uuid, text
) from public;
revoke execute on function presby_write_return_publication_chain(
  uuid, uuid, integer, text, jsonb, boolean, text, text, uuid, text
) from presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 4. presby_publish_sasr_snapshot() — RE-CREATED, thin, SUPERSEDES
--    drizzle/0047 SECTION 7's BODY (fix-forward; 0047 is NOT edited)
-- ---------------------------------------------------------------------------
-- SAME NAME, SAME 62-PARAMETER SIGNATURE, byte for byte with drizzle/0047:
-- 1092-1155 — no parameter added, removed or reordered, and the same return
-- value (the statistical_returns id). Phase 2 re-grepped src/ and found no
-- application caller of any kind (only comments and src/lib/dev-docs.ts
-- prose), which is what makes this the cheapest week this refactor will ever
-- be; the signature-stability promise is kept regardless, because the
-- publish-UI pipeline is named and will bind to it.
--
-- WHAT STAYS IN THIS FUNCTION, because it is genuinely specific to this
-- caller: the confused-deputy shape (it accepts NO organization id of any
-- kind and reads presby_current_org(), already membership-verified by
-- withOrgContext()), the recipient resolution from the affiliation history at
-- current_date, the 60-parameter allow-list and its v_count_max / v_money_max
-- range validation, and the three-chunk jsonb_build_object payload assembly
-- (jsonb_build_object caps at 100 arguments and 60 fields are 120 — a
-- consequence of FUNC_MAX_ARGS, not a grouping with meaning).
--
-- WHAT IS DELETED FROM IT, now living once in section 3: the report-year range
-- check, the form-version-exists check, the recipient-TYPE check, F80's
-- year-endpoint collision check, the presby.publication_write_active arming,
-- and the three inserts. The ERRCODE of every moved check is unchanged
-- (invalid_parameter_value), so error-code-based handling is unaffected; the
-- MESSAGE TEXT of those four now names presby_write_return_publication_chain,
-- which is the point — one shared code path, so both callers see the same
-- string and neither can drift.
create or replace function presby_publish_sasr_snapshot(
  p_report_year integer,
  p_minute_reference text,
  p_gains_professions_under18 integer default null,
  p_gains_professions_18plus integer default null,
  p_gains_certificate integer default null,
  p_gains_other integer default null,
  p_losses_certificate integer default null,
  p_losses_deaths integer default null,
  p_losses_other integer default null,
  p_ending_active integer default null,
  p_ending_baptized integer default null,
  p_ending_affiliate integer default null,
  p_ending_other_participants integer default null,
  p_gender_woman integer default null,
  p_gender_man integer default null,
  p_gender_nonbinary integer default null,
  p_age_17_under integer default null,
  p_age_18_25 integer default null,
  p_age_26_40 integer default null,
  p_age_41_55 integer default null,
  p_age_56_70 integer default null,
  p_age_71_over integer default null,
  p_age_unknown integer default null,
  p_race_asian integer default null,
  p_race_african integer default null,
  p_race_african_american integer default null,
  p_race_black integer default null,
  p_race_hispanic integer default null,
  p_race_middle_eastern integer default null,
  p_race_native_american integer default null,
  p_race_white integer default null,
  p_race_other integer default null,
  p_disability_hearing integer default null,
  p_disability_mobility integer default null,
  p_disability_sight integer default null,
  p_disability_other integer default null,
  p_officers_ruling_elder_count integer default null,
  p_officers_deacon_count integer default null,
  p_baptisms_children integer default null,
  p_baptisms_adults integer default null,
  p_youth_4_under integer default null,
  p_youth_k_5 integer default null,
  p_youth_6_8 integer default null,
  p_youth_9_12 integer default null,
  p_avg_weekly_worship_attendance integer default null,
  p_potential_giving_units integer default null,
  p_receipts_contributions numeric default null,
  p_receipts_capital_building_funds numeric default null,
  p_receipts_investment_endowment_income numeric default null,
  p_receipts_bequests numeric default null,
  p_receipts_other_income numeric default null,
  p_receipts_subsidy_or_aid numeric default null,
  p_exp_local_program numeric default null,
  p_exp_local_mission numeric default null,
  p_exp_capital numeric default null,
  p_exp_investment numeric default null,
  p_exp_per_capita_apportionment numeric default null,
  p_exp_validated_mission_pcusa numeric default null,
  p_exp_ga_theological_education_fund numeric default null,
  p_exp_other_mission numeric default null,
  p_budgeted_income numeric default null,
  p_budgeted_expense numeric default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org         uuid := presby_current_org();
  v_recipient   uuid;
  v_payload     jsonb;
  -- Generous integer count bound: no congregation plausibly reports six
  -- figures on any single SASR line. Unchanged from drizzle/0038.
  v_count_max   constant integer := 1000000;
  -- Generous financial bound. Unchanged from drizzle/0038.
  v_money_max   constant numeric := 100000000;
begin
  if v_org is null then
    raise exception 'presby_publish_sasr_snapshot: no org context'
      using errcode = 'insufficient_privilege';
  end if;

  -- D19: the affiliation history, never organizations.parent_id. This caller's
  -- instant is always TODAY.
  v_recipient := presby_affiliation_parent_as_of(v_org, current_date::date);
  if v_recipient is null then
    raise exception
      'presby_publish_sasr_snapshot: organization % has no current affiliation to publish to',
      v_org
      using errcode = 'invalid_parameter_value';
  end if;

  if not (
    (p_gains_professions_under18 is null or p_gains_professions_under18 between 0 and v_count_max) and
    (p_gains_professions_18plus is null or p_gains_professions_18plus between 0 and v_count_max) and
    (p_gains_certificate is null or p_gains_certificate between 0 and v_count_max) and
    (p_gains_other is null or p_gains_other between 0 and v_count_max) and
    (p_losses_certificate is null or p_losses_certificate between 0 and v_count_max) and
    (p_losses_deaths is null or p_losses_deaths between 0 and v_count_max) and
    (p_losses_other is null or p_losses_other between 0 and v_count_max) and
    (p_ending_active is null or p_ending_active between 0 and v_count_max) and
    (p_ending_baptized is null or p_ending_baptized between 0 and v_count_max) and
    (p_ending_affiliate is null or p_ending_affiliate between 0 and v_count_max) and
    (p_ending_other_participants is null or p_ending_other_participants between 0 and v_count_max) and
    (p_gender_woman is null or p_gender_woman between 0 and v_count_max) and
    (p_gender_man is null or p_gender_man between 0 and v_count_max) and
    (p_gender_nonbinary is null or p_gender_nonbinary between 0 and v_count_max) and
    (p_age_17_under is null or p_age_17_under between 0 and v_count_max) and
    (p_age_18_25 is null or p_age_18_25 between 0 and v_count_max) and
    (p_age_26_40 is null or p_age_26_40 between 0 and v_count_max) and
    (p_age_41_55 is null or p_age_41_55 between 0 and v_count_max) and
    (p_age_56_70 is null or p_age_56_70 between 0 and v_count_max) and
    (p_age_71_over is null or p_age_71_over between 0 and v_count_max) and
    (p_age_unknown is null or p_age_unknown between 0 and v_count_max) and
    (p_race_asian is null or p_race_asian between 0 and v_count_max) and
    (p_race_african is null or p_race_african between 0 and v_count_max) and
    (p_race_african_american is null or p_race_african_american between 0 and v_count_max) and
    (p_race_black is null or p_race_black between 0 and v_count_max) and
    (p_race_hispanic is null or p_race_hispanic between 0 and v_count_max) and
    (p_race_middle_eastern is null or p_race_middle_eastern between 0 and v_count_max) and
    (p_race_native_american is null or p_race_native_american between 0 and v_count_max) and
    (p_race_white is null or p_race_white between 0 and v_count_max) and
    (p_race_other is null or p_race_other between 0 and v_count_max) and
    (p_disability_hearing is null or p_disability_hearing between 0 and v_count_max) and
    (p_disability_mobility is null or p_disability_mobility between 0 and v_count_max) and
    (p_disability_sight is null or p_disability_sight between 0 and v_count_max) and
    (p_disability_other is null or p_disability_other between 0 and v_count_max) and
    (p_officers_ruling_elder_count is null or p_officers_ruling_elder_count between 0 and v_count_max) and
    (p_officers_deacon_count is null or p_officers_deacon_count between 0 and v_count_max) and
    (p_baptisms_children is null or p_baptisms_children between 0 and v_count_max) and
    (p_baptisms_adults is null or p_baptisms_adults between 0 and v_count_max) and
    (p_youth_4_under is null or p_youth_4_under between 0 and v_count_max) and
    (p_youth_k_5 is null or p_youth_k_5 between 0 and v_count_max) and
    (p_youth_6_8 is null or p_youth_6_8 between 0 and v_count_max) and
    (p_youth_9_12 is null or p_youth_9_12 between 0 and v_count_max) and
    (p_avg_weekly_worship_attendance is null or p_avg_weekly_worship_attendance between 0 and v_count_max) and
    (p_potential_giving_units is null or p_potential_giving_units between 0 and v_count_max) and
    (p_receipts_contributions is null or p_receipts_contributions between 0 and v_money_max) and
    (p_receipts_capital_building_funds is null or p_receipts_capital_building_funds between 0 and v_money_max) and
    (p_receipts_investment_endowment_income is null or p_receipts_investment_endowment_income between 0 and v_money_max) and
    (p_receipts_bequests is null or p_receipts_bequests between 0 and v_money_max) and
    (p_receipts_other_income is null or p_receipts_other_income between 0 and v_money_max) and
    (p_receipts_subsidy_or_aid is null or p_receipts_subsidy_or_aid between 0 and v_money_max) and
    (p_exp_local_program is null or p_exp_local_program between 0 and v_money_max) and
    (p_exp_local_mission is null or p_exp_local_mission between 0 and v_money_max) and
    (p_exp_capital is null or p_exp_capital between 0 and v_money_max) and
    (p_exp_investment is null or p_exp_investment between 0 and v_money_max) and
    (p_exp_per_capita_apportionment is null or p_exp_per_capita_apportionment between 0 and v_money_max) and
    (p_exp_validated_mission_pcusa is null or p_exp_validated_mission_pcusa between 0 and v_money_max) and
    (p_exp_ga_theological_education_fund is null or p_exp_ga_theological_education_fund between 0 and v_money_max) and
    (p_exp_other_mission is null or p_exp_other_mission between 0 and v_money_max) and
    (p_budgeted_income is null or p_budgeted_income between 0 and v_money_max) and
    (p_budgeted_expense is null or p_budgeted_expense between 0 and v_money_max)
  ) then
    raise exception 'presby_publish_sasr_snapshot: a value is out of the allowed range'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The as-reported payload. jsonb_build_object is capped at 100 arguments,
  -- and 60 fields are 120, so it is built in three chunks and concatenated —
  -- a mechanical consequence of FUNC_MAX_ARGS, not a grouping with meaning.
  -- jsonb_strip_nulls drops unreported fields: the field_spec trigger treats
  -- a JSON null as legal anyway, but an archive of 60 nulls is noise.
  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'gains_professions_under18', p_gains_professions_under18,
      'gains_professions_18plus', p_gains_professions_18plus,
      'gains_certificate', p_gains_certificate,
      'gains_other', p_gains_other,
      'losses_certificate', p_losses_certificate,
      'losses_deaths', p_losses_deaths,
      'losses_other', p_losses_other,
      'ending_active', p_ending_active,
      'ending_baptized', p_ending_baptized,
      'ending_affiliate', p_ending_affiliate,
      'ending_other_participants', p_ending_other_participants,
      'gender_woman', p_gender_woman,
      'gender_man', p_gender_man,
      'gender_nonbinary', p_gender_nonbinary,
      'age_17_under', p_age_17_under,
      'age_18_25', p_age_18_25,
      'age_26_40', p_age_26_40,
      'age_41_55', p_age_41_55,
      'age_56_70', p_age_56_70,
      'age_71_over', p_age_71_over
    ) || jsonb_build_object(
      'age_unknown', p_age_unknown,
      'race_asian', p_race_asian,
      'race_african', p_race_african,
      'race_african_american', p_race_african_american,
      'race_black', p_race_black,
      'race_hispanic', p_race_hispanic,
      'race_middle_eastern', p_race_middle_eastern,
      'race_native_american', p_race_native_american,
      'race_white', p_race_white,
      'race_other', p_race_other,
      'disability_hearing', p_disability_hearing,
      'disability_mobility', p_disability_mobility,
      'disability_sight', p_disability_sight,
      'disability_other', p_disability_other,
      'officers_ruling_elder_count', p_officers_ruling_elder_count,
      'officers_deacon_count', p_officers_deacon_count,
      'baptisms_children', p_baptisms_children,
      'baptisms_adults', p_baptisms_adults,
      'youth_4_under', p_youth_4_under,
      'youth_k_5', p_youth_k_5
    ) || jsonb_build_object(
      'youth_6_8', p_youth_6_8,
      'youth_9_12', p_youth_9_12,
      'avg_weekly_worship_attendance', p_avg_weekly_worship_attendance,
      'potential_giving_units', p_potential_giving_units,
      'receipts_contributions', p_receipts_contributions,
      'receipts_capital_building_funds', p_receipts_capital_building_funds,
      'receipts_investment_endowment_income', p_receipts_investment_endowment_income,
      'receipts_bequests', p_receipts_bequests,
      'receipts_other_income', p_receipts_other_income,
      'receipts_subsidy_or_aid', p_receipts_subsidy_or_aid,
      'exp_local_program', p_exp_local_program,
      'exp_local_mission', p_exp_local_mission,
      'exp_capital', p_exp_capital,
      'exp_investment', p_exp_investment,
      'exp_per_capita_apportionment', p_exp_per_capita_apportionment,
      'exp_validated_mission_pcusa', p_exp_validated_mission_pcusa,
      'exp_ga_theological_education_fund', p_exp_ga_theological_education_fund,
      'exp_other_mission', p_exp_other_mission,
      'budgeted_income', p_budgeted_income,
      'budgeted_expense', p_budgeted_expense
    )
  );

  -- THE SHARED CHAIN. Attestation is null for this caller, deliberately and
  -- unchanged: there is no acting-user context in this platform (only
  -- app.current_org_id exists as a GUC, Ruling A4), and accepting an attester
  -- name as a parameter would be the caller-supplied identity claim this
  -- function's shape refuses. The session minute IS recorded — on the
  -- publication, where it belongs. authorized_by is null for the same reason.
  return presby_write_return_publication_chain(
    v_org, v_recipient, p_report_year, '2024', v_payload, true,
    null, null, null, p_minute_reference
  );
end $fn$;

-- The same explicit parameter-type list drizzle/0047 used, so the CREATE OR
-- REPLACE above genuinely replaced the existing function rather than
-- overloading it, and so the grant survives the replace. (CREATE OR REPLACE
-- preserves privileges; these two statements are re-stated anyway because a
-- replay from zero applies this file against a fresh function.)
revoke all on function presby_publish_sasr_snapshot(
  integer, text,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric
) from public;
grant execute on function presby_publish_sasr_snapshot(
  integer, text,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric
) to presby_app;


-- ---------------------------------------------------------------------------
-- 5. presby_submit_granted_return() — the anonymous write, one transaction
-- ---------------------------------------------------------------------------
-- THE SIGNATURE IS THE TRUST BOUNDARY (Phase 2 [BINDING]): no person id, no
-- organization id, no council id — only a token hash, a payload and an
-- attestation. A reviewer can see at a glance that the anonymous path cannot
-- be handed an org by its caller, and the application sets NO org GUC before
-- calling it.
--
-- ONE UNIFORM REFUSAL LITERAL for every credential-liveness failure — not
-- found, expired, revoked, already submitted, or STALE AFFILIATION — raised
-- with errcode insufficient_privilege, in presby_deny_about_org_write()'s
-- cause-blind style:
--
--   presby_submit_granted_return: grant not usable
--
-- The API layer maps exactly that string/errcode pair to its single "this link
-- is no longer active" response; any OTHER error is a form-validation category
-- and is safe to distinguish, because by then the caller has already proven
-- possession of the token and specificity is no longer an enumeration leak.
--
-- CLAIM FIRST, WRITE SECOND (Phase 2 ruling 5c, [BINDING]). ONE indexed
-- UPDATE ... RETURNING is the concurrency control: a double-click, two tabs
-- and a back-button resubmit all block on the row lock until the first
-- transaction commits, then re-evaluate the WHERE clause and find submitted_at
-- already set. There is deliberately no `select ... for update` "check" in
-- front of it — that is where this pattern usually grows a TOCTOU. If anything
-- below the claim raises, the claim rolls back with it: a failed submission
-- returns the grant to exactly its pre-call state, never a stuck half-claim.
create or replace function presby_submit_granted_return(
  p_token_hash text,
  p_payload jsonb,
  p_attested_by_name text,
  p_attested_role text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_grant     record;
  v_recipient uuid;
  v_return_id uuid;
  v_claimed   uuid;
begin
  -- SECURITY DEFINER is required, not decorative: statistics_submission_grants
  -- is FORCE ROW LEVEL SECURITY and the anonymous caller has no org context at
  -- all, so an invoker-mode read would see zero rows for exactly the case this
  -- function exists to serve (F26). It reads as neondb_owner, which BYPASSRLS
  -- exempts from the policy (F44).
  select * into v_grant
    from statistics_submission_grants
   where token_hash = p_token_hash;

  if v_grant.id is null
     or v_grant.revoked_at is not null
     or v_grant.submitted_at is not null
     or v_grant.expires_at <= now()
  then
    raise exception 'presby_submit_granted_return: grant not usable'
      using errcode = 'insufficient_privilege';
  end if;

  -- THE AFFILIATION INSTANT (Phase 3 ruling 2 / F80). The recipient is
  -- resolved FRESH from the affiliation history — never read from the grant's
  -- stored organization_id, which is provenance of issuance, never authority
  -- to receive (D19). The stored value is used ONLY as a staleness check:
  -- agreement makes the grant live; disagreement means the presbytery that
  -- issued it no longer holds this congregation, and a lapsed credential is
  -- refused under the SAME uniform literal as an expired or revoked one.
  v_recipient := presby_affiliation_parent_as_of(v_grant.about_org_id, current_date::date);
  if v_recipient is null or v_recipient is distinct from v_grant.organization_id then
    raise exception 'presby_submit_granted_return: grant not usable'
      using errcode = 'insufficient_privilege';
  end if;

  -- Attestation bounds. Deliberately NOT folded into the uniform literal: the
  -- token has already been proven live, so a specific message is not an
  -- enumeration leak, and the API layer maps it to the "check your entries"
  -- category. The application validates the same bounds with zod first; this
  -- is the database half of the same rule, for the same reason every other
  -- trust boundary in this schema carries one.
  if p_attested_by_name is null
     or char_length(btrim(p_attested_by_name)) not between 1 and 255 then
    raise exception 'presby_submit_granted_return: attestation out of range'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_attested_role is null
     or char_length(btrim(p_attested_role)) not between 1 and 100 then
    raise exception 'presby_submit_granted_return: attestation out of range'
      using errcode = 'invalid_parameter_value';
  end if;

  -- THE CLAIM. Transition 2 of the freeze trigger: submitted_at alone, armed.
  perform set_config('presby.grant_claim_active', 'true', true);

  update statistics_submission_grants
     set submitted_at = now()
   where id = v_grant.id
     and submitted_at is null
     and revoked_at is null
     and expires_at > now()
  returning id into v_claimed;

  if v_claimed is null then
    raise exception 'presby_submit_granted_return: grant not usable'
      using errcode = 'insufficient_privilege';
  end if;

  -- THE WRITE, through the one sanctioned chain writer. p_reconciled is true
  -- for the same reason presby_publish_sasr_snapshot() passes true: D11's
  -- reconciliation rule applies at write time to a SUBMITTED return. The
  -- attestation is the grant path's whole point (F57) and is the first
  -- non-null value these two columns have ever carried.
  v_return_id := presby_write_return_publication_chain(
    v_grant.about_org_id, v_recipient, v_grant.report_year, '2024',
    p_payload, true,
    btrim(p_attested_by_name), btrim(p_attested_role),
    null, null
  );

  -- THE STAMP. Transition 3: return_id alone, from an already-claimed row,
  -- still armed, still the same transaction.
  update statistics_submission_grants
     set return_id = v_return_id
   where id = v_claimed;

  return v_return_id;
end $fn$;

revoke all on function presby_submit_granted_return(text, jsonb, text, text) from public;
revoke execute on function presby_submit_granted_return(text, jsonb, text, text) from presby_platform;
-- presby_app IS the anonymous request's connection — the credential, not a
-- session, is what authorizes the act, and the function accepts no identity
-- claim it could be lied to with.
grant execute on function presby_submit_granted_return(text, jsonb, text, text) to presby_app;

-- ---------------------------------------------------------------------------
-- 6. presby_preview_granted_return() — the page's read-only resolve
-- ---------------------------------------------------------------------------
-- The public page must render the congregation's NAME and the report year
-- before anything is written, and it must not perform a write to find out
-- whether the link is live. Same one-indexed-lookup shape, same liveness
-- predicate, and NO ROW for every failure state — the caller cannot tell
-- "expired" from "revoked" from "never existed", which is what keeps the page
-- copy byte-identical across all of them.
--
-- It returns only the congregation's own public name (organizations is the
-- PUBLIC council tree, no RLS) and the form version, so there is no
-- cross-tenant leak even though it runs as the owner.
create or replace function presby_preview_granted_return(p_token_hash text)
returns table (
  about_org_name   text,
  report_year      integer,
  form_version_key text
)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select o.name, g.report_year, '2024'::text
    from statistics_submission_grants g
    join organizations o on o.id = g.about_org_id
   where g.token_hash = p_token_hash
     and g.revoked_at is null
     and g.submitted_at is null
     and g.expires_at > now();
$fn$;

revoke all on function presby_preview_granted_return(text) from public;
revoke execute on function presby_preview_granted_return(text) from presby_platform;
grant execute on function presby_preview_granted_return(text) to presby_app;

-- ---------------------------------------------------------------------------
-- 7. Post-conditions, asserted rather than assumed
-- ---------------------------------------------------------------------------
-- Cheap, idempotent, and they fail the migration loudly rather than leaving a
-- half-built credential mechanism behind. Mirrors drizzle/0045 section 0's
-- discipline.
do $$
declare
  v_missing text;
begin
  if not exists (
    select 1 from pg_class
     where relname = 'statistics_submission_grants'
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'statistics_submission_grants: FORCE ROW LEVEL SECURITY is not set (F1)';
  end if;

  if not exists (
    select 1 from pg_policies
     where tablename = 'statistics_submission_grants' and policyname = 'tenant_isolation'
  ) then
    raise exception 'statistics_submission_grants: the tenant_isolation policy is missing';
  end if;

  -- presby_app must hold the COLUMN-level UPDATE on revoked_at and no
  -- table-level UPDATE at all. A blanket grant re-widening this is exactly the
  -- F38 additive-grant drift this assertion exists to catch.
  if not has_column_privilege('presby_app', 'statistics_submission_grants', 'revoked_at', 'UPDATE') then
    raise exception 'statistics_submission_grants: presby_app lost UPDATE (revoked_at) — the presbytery cannot revoke its own grants';
  end if;
  if has_column_privilege('presby_app', 'statistics_submission_grants', 'submitted_at', 'UPDATE')
     or has_column_privilege('presby_app', 'statistics_submission_grants', 'return_id', 'UPDATE') then
    raise exception 'statistics_submission_grants: presby_app can reach the claim columns — the column-level grant did not take';
  end if;

  -- Every SECURITY DEFINER function this migration defines pins search_path
  -- with pg_temp LAST (F60 / DECISION-148).
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.proname in ('presby_write_return_publication_chain',
                       'presby_publish_sasr_snapshot',
                       'presby_submit_granted_return',
                       'presby_preview_granted_return')
     and not ('search_path=public, pg_temp' = any(coalesce(p.proconfig, array['']::text[])));
  if v_missing is not null then
    raise exception 'drizzle/0049: these SECURITY DEFINER functions do not pin search_path = public, pg_temp: %', v_missing;
  end if;

  -- The one-writer property, stated as a catalog fact: nothing but the
  -- extracted chain writer arms presby.publication_write_active.
  if (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and pg_get_functiondef(p.oid) like '%set_config(''presby.publication_write_active''%') <> 1 then
    raise exception 'drizzle/0049: presby.publication_write_active is armed by more (or fewer) than one function — the single-arming-site property is broken';
  end if;

  raise notice 'drizzle/0049 post-conditions clean: FORCE RLS, tenant_isolation, column-level UPDATE, four pinned search_paths, one arming site';
end $$;
