-- Publications: the publication EVENT, the congregation_statistics retrofit,
-- the rewritten publish function, and the recipient's read-back — increment 5
-- of the lifecycle/affiliation/returns pipeline (docs/work-log/2026-09-24-
-- lifecycle-affiliation-returns.md, Phase 3 Data Model "Increment 5";
-- D19/D20/F36/F39; DECISION-135/137/138/139; docs/schema-design-2.md sec 2c
-- and sec 5).
--
-- WHAT THIS FINISHES RATHER THAN BUILDS. F36: publication is ALREADY
-- half-built. drizzle/0038 shipped frozen `published_by_congregation` rows, a
-- `supersedes_publication_id` self-chain, `published_at`, `minute_reference`,
-- a freeze trigger and presby_publish_sasr_snapshot(). D20 designed a second
-- mechanism and never said what happens to the first. This migration adopts
-- option (a): `congregation_statistics` stays the presbytery's typed
-- keyspace, and its published rows become a PROJECTION of a `publications`
-- row. One mechanism, not two.
--
-- THE RETROFIT IS NARROWER THAN ROUND 3 SPECIFIED (F39 / Phase 2 Ruling 5 /
-- DECISION-137). R3.4(a) moved three columns onto `publications`; two of them
-- break shipped code:
--
--   + publication_id              added
--   - supersedes_publication_id   moves to publications.supersedes_id (no
--                                 reader outside a comment)
--   published_at                  STAYS. src/lib/presbytery.ts:522 orders on
--                                 it and :533-539 coalesces provenance with
--                                 it. `publications.organization_id` is the
--                                 SOURCE congregation, so the presbytery
--                                 cannot read that table at all — moving the
--                                 column would turn the shipped rollup and
--                                 the per-capita basis-year lookup into
--                                 DEFINER joins for no gain.
--   minute_reference              STAYS. Written on `presbytery_entered` rows
--                                 by src/lib/presbytery.ts:637,664 and
--                                 REQUIRED by the live form
--                                 (statistics-schema.ts:22). A
--                                 presbytery_entered row has no publication
--                                 to hold it, and it is a DIFFERENT minute
--                                 (the presbytery's own data-entry minute vs.
--                                 the congregation's session minute
--                                 authorizing publication — `publications`
--                                 gets its own column for the latter).
--
-- The projection is ALLOWED to carry the event's facts; that is what a
-- projection is. Unlike F29's `current_roll` this copy cannot drift: both
-- rows are written by ONE DEFINER function in ONE transaction, and neither is
-- ever updated afterwards (`congregation_statistics_freeze`, drizzle/0038:
-- 286-296, and `publications_freeze` below). scripts/test-rls.sql section 34
-- asserts the equality rather than arguing it.
--
-- ONE CORRECTION TO THE PHASE 3 DATA MODEL, MADE HERE AND NAMED IN THE
-- WORK-LOG. Phase 3 writes the retrofit FK as
--   foreign key (publication_id, organization_id) references publications (id, organization_id)
-- which cannot hold: `congregation_statistics.organization_id` is the
-- RECIPIENT PRESBYTERY and `publications.organization_id` is the SOURCE
-- CONGREGATION, so that constraint would reject every published row it was
-- written to protect. The column that equals `publications.organization_id`
-- is `congregation_statistics.about_org_id`, and the FK is therefore
--   foreign key (publication_id, about_org_id) references publications (id, organization_id)
-- which preserves exactly the F2 property that matters here: a projection
-- cannot claim a publication recorded by a DIFFERENT congregation.
--
-- WITHDRAWAL IS A COLUMN, NOT A DELETE (D20) — and it is itself a MINUTED
-- ACT, so it carries provenance rather than being a bare timestamp. Three
-- columns move together: `withdrawn_at` (required), `withdrawn_by` and
-- `withdrawn_minute_reference`. This is DECISION-135's affiliation-close
-- shape applied to a publication: `organization_affiliations` records who
-- closed a row, when, and under which minute, precisely so a close is never
-- an unattributable mutation of an otherwise provenanced record — and a
-- publication withdrawn with no record of who withdrew it or on whose
-- authority would be exactly that. (Spec addition from the orchestrator,
-- external design review, 2026-09-24; recorded in the work-log's batch C
-- Implementer Notes.)
--
-- `publications_freeze` therefore permits EXACTLY ONE TRANSITION: a row whose
-- three withdrawal columns are all null may be updated to set them, and
-- nothing else on the row may move in that same UPDATE. Every other UPDATE
-- and every DELETE raise, in presby_freeze_lifecycle_event()'s own
-- errcode/message shape (check_violation, "a X is immutable; do Y instead").
-- A withdrawal is not reversible, re-datable or re-minutable: correcting one
-- means publishing again.
--
-- It fires on EVERY connection, including the owner — Ruling A5's finding
-- from batch B applies unchanged (PLATFORM_DATABASE_URL connects as
-- neondb_owner, which no grant binds; BYPASSRLS exempts a role from RLS
-- POLICIES, never from TRIGGERS). `presby_app` additionally holds no UPDATE
-- grant at all, DELIBERATELY AND STILL: the writer is meant to be a future
-- `presby_withdraw_publication()` SECURITY DEFINER function, in the
-- publish-UI pipeline, in the same confused-deputy shape as
-- presby_transfer_affiliation() (no caller-supplied council id; the acting
-- council is presby_current_org()). It is NOT built here, so withdrawal is an
-- owner-only act today.
--
-- sasr_reports IS DROPPED (Phase 2 Ruling 6 / DECISION-137): zero rows on
-- production and development, zero application consumers, and a shape already
-- stale under D25. Its entry in drizzle/0009's `tenant_tables` array is NOT
-- edited — Phase 3's Data Model is explicit that the array is a historical
-- record of what THAT migration did, not re-executed, and 0009 runs before
-- 0047 in any replay from zero. (sec 5's prose says to edit it; Phase 3 is
-- the later authority and wins. Recorded in the work-log as a spec conflict,
-- with the consequence stated: re-applying 0009 ALONE, out of order, after
-- this migration would fail on the missing table — the same additive-grant
-- replay hazard batch B recorded as finding 4.)
--
-- Migration-numbering note: `ls drizzle/` was run immediately before this
-- file was written and found 0046_presby_statistical_returns.sql (this
-- batch's own increment 4) as the highest number on disk, with no gap and no
-- second pipeline's file present; docs/TODO.md's In Flight list was re-read
-- for a concurrent schema pipeline (none). This migration claims 0047.
--
-- Hand-written per CLAUDE.md. Drizzle Kit emits none of this. Every statement
-- is idempotent and the whole file is safe to re-apply; the backfill is
-- guarded on `publication_id is null` so a second run finds nothing to do.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. publications — the event (D20)
-- ---------------------------------------------------------------------------
create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  -- The SOURCE COUNCIL: the body that published. Plain FK to organizations
  -- (section-17 structural exception), tenant scope for the policy below.
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The council the artifact was published TO. Resolved ONCE, at write time,
  -- from presby_affiliation_parent_as_of(source, published_at) — NEVER from
  -- organizations.parent_id, and never re-derived afterwards, so a later
  -- redistricting cannot retroactively change who received an already-filed
  -- return (D19's rule, sec 2b; the reviewing council is G-3.0108(a)).
  recipient_org_id uuid not null references organizations(id),
  -- Generic by design. 'statistical_return' is the only class today; D20
  -- defines publication as the schema expression of "access flows up by
  -- publication", which is not a statistics-only fact.
  record_class text not null default 'statistical_return',
  artifact_id uuid not null,
  published_at timestamptz not null default now(),
  supersedes_id uuid references publications(id),
  authorized_by uuid references users(id),
  -- The CONGREGATION'S SESSION MINUTE authorizing publication. Distinct from
  -- congregation_statistics.minute_reference, which is the PRESBYTERY's own
  -- data-entry minute on a presbytery_entered row (F39).
  minute_reference text,
  -- The withdrawal triple. Nullable, all three, and they move together or
  -- not at all (publications_freeze + the CHECK below). Written today only
  -- by the owner; the future writer is presby_withdraw_publication().
  withdrawn_at timestamptz,
  withdrawn_by uuid references users(id),
  withdrawn_minute_reference text,
  constraint publications_id_org_key unique (id, organization_id),
  -- COMPOSITE, F2-compliant: artifact_id alone would let a publication claim
  -- an artifact recorded under a DIFFERENT organization_id.
  constraint publications_artifact_fk
    foreign key (artifact_id, organization_id)
    references statistical_returns (id, organization_id),
  constraint publications_record_class_allowed
    check (record_class in ('statistical_return')),
  constraint publications_not_self_superseding
    check (supersedes_id is null or supersedes_id <> id),
  -- The three withdrawal columns are all null or all set, and nothing in
  -- between. The trigger enforces the TRANSITION; this enforces the resulting
  -- SHAPE, including for the owner's own writes — CHECK constraints bind the
  -- table owner, unlike RLS policies and unlike grants, so F44 does not
  -- exempt this one.
  --
  -- CORRECTED 2026-09-24 (F51 / DECISION-140, fourth Phase 3 loop-back). The
  -- first build read:
  --     check (withdrawn_at is not null
  --            or (withdrawn_by is null and withdrawn_minute_reference is null))
  -- which is TRUE whenever withdrawn_at is set, whatever the other two hold —
  -- including both null. It therefore permitted precisely the unattributable
  -- withdrawal its own column comment says is impossible, and contradicted
  -- DECISION-135's affiliation-close shape it was written to mirror. The
  -- corrected form is symmetric.
  constraint publications_withdrawal_shape
    check ((withdrawn_at is null
            and withdrawn_by is null
            and withdrawn_minute_reference is null)
        or (withdrawn_at is not null
            and withdrawn_by is not null
            and withdrawn_minute_reference is not null))
);

-- The two withdrawal-provenance columns are added idempotently as well as in
-- the CREATE above, because `create table if not exists` is a no-op on a
-- database that already ran an earlier form of this migration (the same
-- pattern drizzle/0044 uses for the organizations columns).
alter table publications add column if not exists withdrawn_by uuid references users(id);
alter table publications add column if not exists withdrawn_minute_reference text;

-- The idempotent twin of the constraint above. UNCONDITIONAL DROP FIRST, not
-- an `if not exists` guard: the 2026-09-24 correction keeps the constraint's
-- NAME and changes its DEFINITION, so a database that already ran the earlier
-- form of this migration carries the BROKEN predicate under the right name
-- and a presence check would leave it there forever. Dropping and re-adding
-- converges either state, and re-validates the (zero to two) existing rows
-- against the corrected predicate while it is at it.
alter table publications drop constraint if exists publications_withdrawal_shape;
alter table publications
  add constraint publications_withdrawal_shape
  check ((withdrawn_at is null
          and withdrawn_by is null
          and withdrawn_minute_reference is null)
      or (withdrawn_at is not null
          and withdrawn_by is not null
          and withdrawn_minute_reference is not null));

create index if not exists publications_recipient_idx
  on publications (recipient_org_id);
create index if not exists publications_org_artifact_idx
  on publications (organization_id, artifact_id);
create index if not exists publications_supersedes_idx
  on publications (supersedes_id);

alter table publications enable row level security;
alter table publications force row level security;

drop policy if exists tenant_isolation on publications;
create policy tenant_isolation on publications
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- The RECIPIENT cannot read this table under the policy above — its
-- organization_id is the source congregation. That is deliberate and it is
-- why presby_list_published_returns_to_me() (section 7 below) exists: the
-- publication EVENT grants the recipient's read, not the tenant policy.
-- CORRECTED 2026-09-24 (F51 / DECISION-140): INSERT revoked from both roles
-- too. A publication is an EVENT produced by a sanctioned act, and the only
-- writer is presby_publish_sasr_snapshot() — SECURITY DEFINER, so it runs
-- with its owner's privileges and is unaffected by this revoke, exactly as
-- presby_transfer_affiliation() is by DECISION-135's revoke on
-- organization_affiliations. The backfill below is unaffected for the same
-- reason: it runs as the owner during migration. Leaving INSERT granted
-- alongside a DEFINER writer is the half-applied function-mediation this
-- pipeline has now corrected on three tables.
revoke all on publications from presby_app, presby_platform;
grant select on publications to presby_app;
grant select on publications to presby_platform;

comment on table publications is
  'The publication EVENT (D20): a source council published an artifact to a recipient council on a date, under a minute. IMMUTABLE except for the WITHDRAWAL TRIPLE — withdrawn_at, withdrawn_by and withdrawn_minute_reference, which move together in the one permitted UPDATE (withdrawal is a column, never a delete; see the withdrawn_at column comment, which this sentence now matches — F64 corrected it on 2026-09-25 from the narrower "except for withdrawn_at"). recipient_org_id is resolved once from presby_affiliation_parent_as_of() at write time and never re-derived, so a later redistricting cannot change who received an already-filed return.';
comment on column publications.recipient_org_id is
  'The council the artifact was published TO — the presbytery of current membership at published_at (D19/G-3.0108(a)), resolved via presby_affiliation_parent_as_of() and NEVER from organizations.parent_id. Fixed at write time. The recipient reads through presby_list_published_returns_to_me(), which filters on THIS column rather than on live affiliation, because G-3.0107 makes a ceased council''s records the property of the next higher council — a presbytery must still read a dissolved congregation''s returns after dissolution.';
comment on column publications.minute_reference is
  'The publishing council''s own minute authorizing publication (a congregation''s session minute for an SASR). NOT the same fact as congregation_statistics.minute_reference, which is the presbytery''s data-entry minute on a presbytery_entered row — collapsing them is the one-column-two-facts error this design refuses everywhere else (F39).';
comment on column publications.withdrawn_by is
  'Who withdrew it. Null on every row today: presby_app holds no UPDATE grant, so withdrawal is an owner-only act until presby_withdraw_publication() ships in the publish-UI pipeline — and there is still no acting-USER context in this platform (Ruling A4: only app.current_org_id exists as a GUC).';
comment on column publications.withdrawn_minute_reference is
  'The withdrawing council''s own minute. Distinct from minute_reference, which authorized the PUBLICATION — one column, one fact.';
comment on column publications.withdrawn_at is
  'Withdrawal is a column, not a delete (D20), and it is a MINUTED ACT: withdrawn_at, withdrawn_by and withdrawn_minute_reference move together, exactly once, on a row that is not already withdrawn — DECISION-135''s affiliation-close shape, for the same reason (a close with no attribution is an unattributable mutation of a provenanced record). OPTION A (F52/DECISION-140, 2026-09-24): a withdrawn publication STILL APPEARS in presby_list_published_returns_to_me(), carrying the whole triple, and its congregation_statistics projection row gains its own withdrawn_at rather than vanishing — the recipient retains what it received, marked, and excludes it from current calculations itself.';

-- ---------------------------------------------------------------------------
-- 2. publications_freeze — immutable except the WITHDRAWAL TRIPLE
--    (withdrawn_at, withdrawn_by, withdrawn_minute_reference, moving together)
-- ---------------------------------------------------------------------------
-- presby_freeze_lifecycle_event()'s shape (drizzle/0044), widened by exactly
-- one permitted transition. Everything here fires on the owner path too,
-- which is the path that matters: a grant binds presby_app and
-- presby_platform, never neondb_owner.
create or replace function presby_freeze_publication()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'publications %: a publication is an event and is never deleted; withdraw it instead (withdrawn_at, withdrawn_by and withdrawn_minute_reference, set together, once)',
      old.id
      using errcode = 'check_violation';
  end if;

  -- Nothing but the withdrawal triple may move, on any UPDATE.
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.recipient_org_id is distinct from old.recipient_org_id
     or new.record_class is distinct from old.record_class
     or new.artifact_id is distinct from old.artifact_id
     or new.published_at is distinct from old.published_at
     or new.supersedes_id is distinct from old.supersedes_id
     or new.authorized_by is distinct from old.authorized_by
     or new.minute_reference is distinct from old.minute_reference
  then
    raise exception
      'publications %: a publication is immutable; the only permitted UPDATE is a single withdrawal — setting withdrawn_at with its withdrawn_by and withdrawn_minute_reference, and nothing else on the row',
      old.id
      using errcode = 'check_violation';
  end if;

  -- The transition runs ONCE, from a row with no withdrawal recorded at all.
  -- A withdrawal is itself an act: it is corrected by publishing again, never
  -- by editing the act away.
  if old.withdrawn_at is not null
     or old.withdrawn_by is not null
     or old.withdrawn_minute_reference is not null
  then
    raise exception
      'publications %: already withdrawn at %; a withdrawal is itself an act and is neither reversed, re-dated nor re-minuted — publish again instead',
      old.id, old.withdrawn_at
      using errcode = 'check_violation';
  end if;

  -- withdrawn_by / withdrawn_minute_reference are attribution FOR a
  -- withdrawal; on their own they are not one. (The CHECK says the same thing
  -- about the resulting row; this says it about the transition, so the error
  -- names the act rather than the constraint.)
  if new.withdrawn_at is null then
    raise exception
      'publications %: a withdrawal must set withdrawn_at; withdrawn_by and withdrawn_minute_reference alone are not a withdrawal',
      old.id
      using errcode = 'check_violation';
  end if;

  -- THE SANCTIONED-WRITER CONJUNCT (F56 / DECISION-141, added 2026-09-24,
  -- sixth Phase 3 loop-back). Everything above proves the transition is
  -- well-SHAPED. Nothing above proved it was performed by the writer that
  -- withdraws BOTH halves of the pair — this row and the congregation_
  -- statistics projection it is projected into — in one transaction. Until
  -- presby_withdraw_publication() exists, a raw owner connection could
  -- withdraw either half alone and leave the recipient's historical
  -- projection silently disagreeing with the publication it projects.
  --
  -- A NEW, UNSHARED GUC (presby.withdrawal_write_active), not a reuse of
  -- presby.publication_write_active: the future withdraw function is a
  -- different function, in a different transaction, at a different point in
  -- time from the publish path, so there is no transaction-local claim to
  -- piggyback on. This is the identifier table's no-reuse case.
  --
  -- NOTHING ARMS IT TODAY, by design. WHAT THAT DOES AND DOES NOT MEAN —
  -- restated 2026-09-25 (eighth Phase 3 loop-back, QA-2), because the earlier
  -- text here said the transition was "unreachable on every connection until
  -- the writer ships" and that was false for the tenant connection. A GUC is a
  -- marker, not a privilege: any role can set_config() it. What actually
  -- closes each half is a GRANT, and the two halves are closed differently:
  --
  --   publications           — presby_app holds no UPDATE at all (section 2's
  --                            revoke). Grant-closed before any trigger runs.
  --   congregation_statistics — presby_app DOES hold UPDATE, because the live
  --                            setCongregationStatistics() path needs it. Until
  --                            2026-09-25 that was a whole-table grant, so
  --                            presby_app could arm this GUC itself and write
  --                            withdrawn_at alone — QA measured exactly that.
  --                            Closed now by a COLUMN-level narrowing (section
  --                            10 at the foot of this file): presby_app holds
  --                            UPDATE on every column EXCEPT withdrawn_at and
  --                            publication_id. INSERT went the same way on
  --                            2026-09-25 (F61, eleventh loop-back), once
  --                            setCongregationStatistics() moved off Drizzle's
  --                            all-column insert builder: no table-level INSERT
  --                            survives, and the column list excludes those two
  --                            plus published_at.
  --
  -- So this trigger's own guarantee is the owner-connection one: on
  -- neondb_owner, where no grant binds (F44), the transition is refused unless
  -- the transaction claims to be the sanctioned withdrawal writer. The tenant
  -- connection never reaches it for withdrawn_at, because the column grant
  -- refuses first. scripts/test-rls.sql section 35(d) proves the tenant half
  -- (permission denied, marker armed or not, plus has_column_privilege
  -- assertions); src/lib/db/domain/publication.test.ts proves this trigger's
  -- own branch on the owner connection, and that the plumbing the future
  -- presby_withdraw_publication() needs is accepted once armed.
  --
  -- ONE NEW IN-FUNCTION LITERAL RATHER THAN A SHARED HELPER, recorded as a
  -- deliberate choice because Ruling 3 left it open ("the function's existing
  -- exception vocabulary"): this function raises three DISTINCT messages, each
  -- interpolated with old.id, so there is no single "publications" literal to
  -- reuse and a helper could not interpolate the id without becoming a
  -- parameterised helper used exactly once. The per-reason literal below keeps
  -- this function's existing discipline — one message per refused reason,
  -- naming the act rather than the constraint. F40's uniform-literal rule does
  -- not apply here: it exists to stop a cross-tenant EXISTENCE ORACLE on a
  -- table with an EXCLUDE constraint, and every branch of this function is
  -- reachable only by someone who already holds the row (the UPDATE names it).
  if coalesce(current_setting('presby.withdrawal_write_active', true), '') <> 'true' then
    raise exception
      'publications %: a withdrawal is an authorized act and may only be recorded by the sanctioned withdrawal function, which withdraws the publication and its projection together',
      old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists publications_freeze on publications;
create trigger publications_freeze
  before update or delete on publications
  for each row execute function presby_freeze_publication();

-- ---------------------------------------------------------------------------
-- 2a. publications_guard — CREATION guarded as strongly as MUTATION
--     (F55 / DECISION-141, added 2026-09-24, sixth Phase 3 loop-back)
-- ---------------------------------------------------------------------------
-- The freeze above makes a publication immutable once written; nothing made
-- WRITING one a sanctioned act. A raw owner INSERT here mints a publication
-- event — a claim that a council received a filed return at an instant, under
-- a minute — that presby_publish_sasr_snapshot() never performed. The revoke
-- in section 1 does not bind neondb_owner (F44), so the guard is the trigger.
--
-- presby_guard_publication_write() and presby_deny_publication_write() are
-- defined ONCE, in drizzle/0046 section 4b, and shared by all three tables in
-- the chain — see that comment block for the one-GUC-for-one-operation
-- argument and for the full list of places presby.publication_write_active is
-- armed. The function is created there rather than here because
-- statistical_returns is the first table in the chain and 0046 always applies
-- before this file.
drop trigger if exists publications_guard on publications;
create trigger publications_guard
  before insert on publications
  for each row execute function presby_guard_publication_write();

-- ---------------------------------------------------------------------------
-- 2b. presby_check_publication_supersession() — supersession is a CHAIN
--     (F51 / DECISION-140, added 2026-09-24)
-- ---------------------------------------------------------------------------
-- `supersedes_id` was a bare self-FK: any publication could name any other as
-- the thing it corrects, including one belonging to a different congregation,
-- addressed to a different council, of a different record class, or about a
-- different report year. A correction that crosses any of those axes is not a
-- correction — it is a claim about someone else's filing.
--
-- SECURITY DEFINER, and NOT for cross-tenant convenience. `publications` is
-- FORCE ROW LEVEL SECURITY, so an INVOKER-mode version of this check would
-- see zero rows for a forged supersedes_id pointing at another org's
-- publication, conclude "no predecessor found"… and, if written naively,
-- skip. Written as it is below it would instead reject — but it would reject
-- for the wrong reason and, worse, would ALSO reject a legitimate predecessor
-- the caller cannot see under its own policy. Either way the trigger's answer
-- would depend on the caller's RLS view rather than on the fact. This is the
-- same F26 shape drizzle/0044's council-authority checker and drizzle/0046's
-- field-spec freeze both carry; DEFINER is the fix in all three.
--
-- ONE UNIFORM LITERAL, CAUSE-BLIND (F40 / DECISION-139's discipline): a
-- probing caller must not be able to distinguish "no such publication" from
-- "that publication belongs to another congregation" from "wrong year",
-- because the first two together are a cross-tenant existence oracle.
create or replace function presby_check_publication_supersession()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_org       uuid;
  v_prev_recipient uuid;
  v_prev_class     text;
  v_prev_artifact  uuid;
  v_prev_year      integer;
  v_new_year       integer;
begin
  if new.supersedes_id is null then
    return new;
  end if;

  select p.organization_id, p.recipient_org_id, p.record_class, p.artifact_id
    into v_prev_org, v_prev_recipient, v_prev_class, v_prev_artifact
    from publications p
   where p.id = new.supersedes_id;

  if v_prev_org is null
     or v_prev_org is distinct from new.organization_id
     or v_prev_recipient is distinct from new.recipient_org_id
     or v_prev_class is distinct from new.record_class
  then
    raise exception
      'publications: supersedes_id must name this council''s own earlier publication of the same record class to the same recipient'
      using errcode = 'check_violation';
  end if;

  -- For a statistical return the artifact carries the year, and a correction
  -- is by definition a correction OF A YEAR. Joined through the artifacts
  -- rather than stored on the publication so there is one source of truth for
  -- the year (the return), not two that can disagree.
  if new.record_class = 'statistical_return' then
    select r.report_year into v_prev_year
      from statistical_returns r where r.id = v_prev_artifact;
    select r.report_year into v_new_year
      from statistical_returns r where r.id = new.artifact_id;
    if v_prev_year is distinct from v_new_year then
      raise exception
        'publications: supersedes_id must name this council''s own earlier publication of the same record class to the same recipient'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists publications_supersession on publications;
create trigger publications_supersession
  before insert on publications
  for each row execute function presby_check_publication_supersession();

-- ---------------------------------------------------------------------------
-- 3. The congregation_statistics retrofit — the column and its FK
-- ---------------------------------------------------------------------------
-- The CHECK that pairs publication_id with the provenance is added AFTER the
-- backfill (section 5): adding it first would reject the very rows the
-- backfill exists to repair.
alter table congregation_statistics add column if not exists publication_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'congregation_statistics_publication_fk'
  ) then
    -- (publication_id, ABOUT_ORG_ID), not (publication_id, organization_id) —
    -- see the header. about_org_id is the publishing congregation and is what
    -- equals publications.organization_id.
    alter table congregation_statistics
      add constraint congregation_statistics_publication_fk
      foreign key (publication_id, about_org_id)
      references publications (id, organization_id);
  end if;
end $$;

create index if not exists congregation_statistics_publication_idx
  on congregation_statistics (publication_id);

comment on column congregation_statistics.publication_id is
  'The publications row this projection projects (F36). NOT NULL exactly when provenance = ''published_by_congregation'' (CHECK). The composite FK is (publication_id, about_org_id) -> publications (id, organization_id), because this table''s organization_id is the RECIPIENT presbytery while the publication''s is the SOURCE congregation — about_org_id is the column that matches.';

-- 3b. THE PROJECTION'S CREATION GUARD, scoped by WHEN to the published branch
-- ONLY (F55 / DECISION-141, added 2026-09-24).
--
-- This is the third and last table in the chain, and the one where the fix had
-- to be surgical. congregation_statistics carries THREE provenances, and two
-- of them — presbytery_entered and imported — are written by a LIVE,
-- member-facing tenant path today (setCongregationStatisticsAction, through
-- src/lib/presbytery.ts:663, as ordinary RLS-filtered tenant DML). A
-- table-wide BEFORE INSERT guard, which is what the review's prose implies,
-- would have broken that path outright.
--
-- The WHEN clause is the whole mechanism: the trigger is not merely a no-op
-- for those two provenances, it is NEVER INVOKED for them. Only
-- published_by_congregation rows — the projection of a publication, which no
-- tenant may write by hand and which today only presby_publish_sasr_snapshot()
-- and the backfill above produce — reach the guard. That closes the reviewer's
-- "false submitted artifact" repro one step earlier than the other two tables
-- do: a fabricated projection is refused even if its return and publication
-- rows were somehow obtained.
--
-- Proven by the EXISTING suite rather than by a new claim: every
-- congregation_statistics insert in scripts/test-rls.sql (eight sites) and
-- every setCongregationStatistics() test uses presbytery_entered or imported
-- and is UNCHANGED by this loop-back. If the WHEN clause were wrong, they fail.
drop trigger if exists congregation_statistics_publication_guard on congregation_statistics;
create trigger congregation_statistics_publication_guard
  before insert on congregation_statistics
  for each row when (new.provenance = 'published_by_congregation')
  execute function presby_guard_publication_write();

-- ---------------------------------------------------------------------------
-- 4. THE TWO-PASS BACKFILL (F36)
-- ---------------------------------------------------------------------------
-- Every pre-existing `published_by_congregation` row was written by the OLD
-- presby_publish_sasr_snapshot(), which produced a projection and nothing
-- else: there is no statistical_returns row and no publications row for it to
-- point at. So the backfill MINTS BOTH, per row, in dependency order —
-- statistical_returns (the artifact) then publications (the event) — and only
-- then sets publication_id. Phase 3 names this as a two-step backfill rather
-- than a one-shot INSERT ... SELECT for exactly that reason.
--
-- Pass 2 rewrites the supersession chain: the old chain lived in
-- congregation_statistics.supersedes_publication_id as a self-FK between
-- PROJECTION rows, and it becomes publications.supersedes_id between EVENT
-- rows, through the cs_id -> publication_id map pass 1 builds.
--
-- EXPECTED ROW COUNT: zero on production (verified by the orchestrator
-- against branch br-wild-band-ax96gv09: congregation_statistics holds 0 rows
-- of any provenance) and one on development (scripts/seed-dev.sql's Alder
-- Creek fixture). The migration must still be CORRECT and must ASSERT ITS OWN
-- COMPLETENESS, because the publish-UI pipeline will produce real rows
-- quickly and this file is what will run against them.
--
-- THE FORM VERSION IS '2024' FOR EVERY BACKFILLED ROW, and that is a claim
-- about FIELDS, not about calendars: the typed columns on
-- congregation_statistics ARE the 2024 field set (drizzle/0046 asserts the
-- 1:1 correspondence), so recording the reconstructed payload against any
-- other generation would be the lie. Same reasoning as the rewritten publish
-- function below.
--
-- BOTH FREEZE TRIGGERS ARE DISABLED FOR THE DURATION, inside one transaction
-- that restores them. congregation_statistics_freeze refuses any UPDATE of a
-- published row — which is precisely the row this backfill must stamp — and
-- publications_freeze refuses the supersedes_id rewrite in pass 2. Disabling
-- them here is the owner performing a schema migration, not an application
-- path; an error anywhere in the block rolls the whole thing back, triggers
-- included.
begin;

alter table congregation_statistics disable trigger congregation_statistics_freeze;
alter table publications disable trigger publications_freeze;
-- statistical_returns_freeze joins them 2026-09-24, for the convergence
-- UPDATE at the end of this block (F50): a database that ran the EARLIER form
-- of this migration already holds reconstructed rows with null attestation
-- text, and a filed return is frozen on every connection.
alter table statistical_returns disable trigger statistical_returns_freeze;

create temporary table _presby_0047_backfill_map (
  cs_id          uuid primary key,
  return_id      uuid not null,
  publication_id uuid not null
) on commit drop;

do $$
declare
  r             record;
  v_return_id   uuid;
  v_pub_id      uuid;
  v_payload     jsonb;
  v_todo        integer;
  v_chain_before integer;
  v_chain_after  integer;
begin
  -- RE-RUN GUARD. supersedes_publication_id is dropped at the end of this
  -- file, so on a second application of the whole migration there is nothing
  -- to read and nothing to backfill. plpgsql prepares a statement on first
  -- execution, so returning here also keeps the statements below from being
  -- parsed against a column that no longer exists — which is what makes this
  -- file genuinely re-appliable rather than merely no-op-looking.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'congregation_statistics'
       and column_name = 'supersedes_publication_id'
  ) then
    raise notice 'publications backfill: supersedes_publication_id is already gone — this migration has run before; nothing to mint';
    return;
  end if;

  -- ARM THE SANCTIONED-WRITE GUC (F55 / DECISION-141, added 2026-09-24). This
  -- block's PASS 1 inserts statistical_returns and publications rows, both of
  -- which are now BEFORE INSERT-guarded (drizzle/0046 section 4b and section
  -- 2a above). A migration reconstructing artifacts for rows that already
  -- exist IS a sanctioned write — the same claim presby_publish_sasr_snapshot()
  -- makes — so it arms the same GUC rather than disabling the triggers the way
  -- the two freezes above are disabled. Transaction-local, inside the
  -- begin/commit this block already runs in.
  --
  -- Its congregation_statistics write is an UPDATE of publication_id on a
  -- pre-existing row, never an INSERT, so the WHEN-scoped projection guard is
  -- not on this block's path at all; arming covers the two that are.
  perform set_config('presby.publication_write_active', 'true', true);

  select count(*) into v_todo
    from congregation_statistics
   where provenance = 'published_by_congregation' and publication_id is null;

  select count(*) into v_chain_before
    from congregation_statistics
   where provenance = 'published_by_congregation' and supersedes_publication_id is not null;

  -- PASS 1 — mint the artifact and the event, then stamp the projection.
  for r in
    select * from congregation_statistics
     where provenance = 'published_by_congregation' and publication_id is null
     order by published_at nulls first, created_at
  loop
    -- Reconstruct the as-reported payload from the typed columns by
    -- SUBTRACTION rather than by naming 60 columns a second time: anything
    -- that is not identity, provenance or publication bookkeeping IS a SASR
    -- aggregate. drizzle/0046's own assertion guarantees that set equals the
    -- 2024 field_spec, so this cannot silently drift from the spec.
    -- 'withdrawn_at' is in the subtraction list for the F52 column added at
    -- the end of this file. It is null on every backfilled row and
    -- jsonb_strip_nulls would drop it anyway, and on a FRESH apply the column
    -- does not exist yet so the subtraction is a no-op — it is listed so that
    -- a re-apply against a database where the column DOES exist, and where
    -- some future row carries a value, cannot smuggle a key the 2024
    -- field_spec does not declare into an archived payload.
    v_payload := jsonb_strip_nulls(
      to_jsonb(r) - array[
        'id','organization_id','about_org_id','year','provenance',
        'supersedes_publication_id','published_at','minute_reference',
        'entered_by','created_at','publication_id','withdrawn_at'
      ]
    );

    -- ATTESTATION PLACEHOLDERS, corrected 2026-09-24 (F50 / DECISION-140).
    -- The first build left attested_by_name and attested_role null and set
    -- attested_at from r.published_at, which is NULLABLE — so a reconstructed
    -- "submitted" row could carry no attestation at all. Both text columns now
    -- carry synthetic values in the same voice as source_ref two lines below,
    -- and attested_at falls back the same way the publication's own
    -- published_at does, so the two rows agree. The values say plainly that
    -- this is a reconstruction rather than an attestation anybody made.
    insert into statistical_returns (
      organization_id, about_org_id, report_year, form_version_key,
      provenance, payload, reconciled,
      attested_by_name, attested_role, attested_at, source_ref, created_at
    ) values (
      r.about_org_id, r.about_org_id, r.year, '2024',
      'submitted', v_payload, true,
      'backfill: reconstructed (drizzle/0047)', 'backfill',
      coalesce(r.published_at, r.created_at, now()),
      'backfill: reconstructed from congregation_statistics ' || r.id::text || ' (drizzle/0047)',
      coalesce(r.created_at, now())
    )
    returning id into v_return_id;

    insert into publications (
      organization_id, recipient_org_id, record_class, artifact_id,
      published_at, supersedes_id, authorized_by, minute_reference, withdrawn_at
    ) values (
      r.about_org_id, r.organization_id, 'statistical_return', v_return_id,
      coalesce(r.published_at, r.created_at, now()), null, null,
      r.minute_reference, null
    )
    returning id into v_pub_id;

    insert into _presby_0047_backfill_map (cs_id, return_id, publication_id)
      values (r.id, v_return_id, v_pub_id);

    update congregation_statistics
       set publication_id = v_pub_id
     where id = r.id;
  end loop;

  -- PASS 2 — rebuild the supersession chain between EVENT rows from the old
  -- chain between PROJECTION rows, before the column is dropped.
  update publications p
     set supersedes_id = prev.publication_id
    from _presby_0047_backfill_map m
    join congregation_statistics cs on cs.id = m.cs_id
    join _presby_0047_backfill_map prev on prev.cs_id = cs.supersedes_publication_id
   where p.id = m.publication_id
     and cs.supersedes_publication_id is not null;

  get diagnostics v_chain_after = row_count;

  if v_chain_before <> v_chain_after then
    raise exception
      'publications backfill incomplete: % projection row(s) carried a supersedes_publication_id but only % publication chain link(s) were rebuilt',
      v_chain_before, v_chain_after;
  end if;

  raise notice
    'publications backfill complete: % projection row(s) stamped, % supersession link(s) rebuilt, % published row(s) now carry a publication (0 unstamped)',
    v_todo, v_chain_after,
    (select count(*) from congregation_statistics where provenance = 'published_by_congregation');
end $$;

-- THE COMPLETENESS ASSERTION, RUN EVERY TIME — not only on the pass that
-- minted something. This is the proof Phase 3 asks the migration to make
-- about itself, and it has to hold on a re-application (and on a database
-- that had zero published rows to begin with) just as much as on the first
-- run, or "the backfill is complete" is a statement about one execution
-- rather than about the database.
do $$
begin
  if exists (
    select 1 from congregation_statistics
     where provenance = 'published_by_congregation' and publication_id is null
  ) then
    raise exception
      'publications backfill incomplete: % published projection row(s) still carry no publication_id',
      (select count(*) from congregation_statistics
        where provenance = 'published_by_congregation' and publication_id is null);
  end if;

  if exists (
    select 1 from congregation_statistics cs
     where cs.provenance <> 'published_by_congregation' and cs.publication_id is not null
  ) then
    raise exception
      'publications backfill wrong: a non-published projection row carries a publication_id';
  end if;

  -- F39's non-drift claim, proven at write time as well as in test-rls.sql:
  -- every stamped projection's publication must name the same congregation,
  -- the same recipient, the same instant and the same minute.
  if exists (
    select 1
      from congregation_statistics cs
      join publications p on p.id = cs.publication_id
     where cs.provenance = 'published_by_congregation'
       and (p.organization_id is distinct from cs.about_org_id
         or p.recipient_org_id is distinct from cs.organization_id
         or p.published_at is distinct from cs.published_at
         or p.minute_reference is distinct from cs.minute_reference)
  ) then
    raise exception
      'publications backfill wrong: a projection and its publication disagree on congregation, recipient, published_at or minute_reference (F39)';
  end if;

  raise notice
    'publications completeness proven: % published projection row(s), all stamped, all agreeing with their publication on congregation/recipient/published_at/minute_reference',
    (select count(*) from congregation_statistics where provenance = 'published_by_congregation');
end $$;

-- CONVERGENCE FOR A DATABASE THAT RAN THE EARLIER FORM OF THIS MIGRATION
-- (added 2026-09-24, F50). The `development` Neon branch already holds a
-- reconstructed return minted by the first build, with attested_by_name and
-- attested_role null — the exact shape statistical_returns_provenance_shape
-- (section 5 below) is about to refuse, and the reason that CHECK has to be
-- added after this block rather than in drizzle/0046. Matched on source_ref
-- rather than on the null columns alone, so this can only ever touch rows
-- THIS migration minted; idempotent, and a no-op on a fresh apply because the
-- INSERT above now writes the values directly.
update statistical_returns
   set attested_by_name = coalesce(attested_by_name, 'backfill: reconstructed (drizzle/0047)'),
       attested_role    = coalesce(attested_role, 'backfill'),
       attested_at      = coalesce(attested_at, created_at)
 where provenance = 'submitted'
   and source_ref like 'backfill: reconstructed from congregation_statistics%'
   and (attested_by_name is null or attested_role is null or attested_at is null);

alter table statistical_returns enable trigger statistical_returns_freeze;
alter table publications enable trigger publications_freeze;
alter table congregation_statistics enable trigger congregation_statistics_freeze;

commit;

-- ---------------------------------------------------------------------------
-- 5. The shape CHECKs and the projection's RECIPIENT end, now that every
--    published row carries a publication
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'congregation_statistics_publication_shape'
  ) then
    alter table congregation_statistics
      add constraint congregation_statistics_publication_shape
      check ((provenance = 'published_by_congregation') = (publication_id is not null));
  end if;
end $$;

-- F50 / DECISION-140, added 2026-09-24. The two provenances were shapes in
-- prose only: `submitted` with reconciled = false and no attestation at all,
-- and `imported` with reconciled = true, were both legal rows, and nothing
-- but presby_publish_sasr_snapshot()'s own discipline — not the schema — kept
-- a submitted return attested. It is added HERE, after the backfill above,
-- for the reason drizzle/0046 section 8 spells out.
--
-- DEVIATION FROM F50'S LITERAL TEXT, and it is the same deviation, for the
-- same cause, that Ruling A4 forced on organization_affiliations_closed_shape
-- (F49): the ruling's predicate requires `attested_by_name is not null and
-- attested_role is not null`, but presby_publish_sasr_snapshot() —
-- unchanged by this loop-back, and the ONLY live writer of a submitted row —
-- writes both as NULL on purpose (see its own comment: there is no
-- app.current_user_id GUC, and accepting an attester name as a parameter
-- would be the caller-supplied identity claim its whole shape refuses). The
-- CHECK as literally worded would make publishing impossible. The two text
-- columns are therefore excluded and `attested_at` — which the function DOES
-- write, and which the corrected backfill now always writes — carries the
-- attestation half of the shape. Tightening the two text columns is blocked
-- on the acting-user GUC, exactly as closed_by is; recorded as a loop-back
-- candidate in the work-log rather than silently absorbed.
--
-- What the constraint still closes, and it is the half that had no owner:
--   * a submitted return that claims no reconciliation (D11 applies at write
--     time to this provenance by definition);
--   * a submitted return with no attestation instant at all;
--   * an imported return marked reconciled — an imported 1987 row is a
--     historical assertion, and if it does not balance that is a fact about
--     1987, not an error to correct.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'statistical_returns_provenance_shape'
  ) then
    alter table statistical_returns
      add constraint statistical_returns_provenance_shape
      check ((provenance = 'submitted' and reconciled and attested_at is not null)
          or (provenance = 'imported' and not reconciled));
  end if;
end $$;

-- F51 / DECISION-140, added 2026-09-24: supersession may not FORK. Two
-- publications naming the same predecessor would make "which one is current"
-- unanswerable, which is the single question the chain exists to answer.
-- Partial, because null is the overwhelmingly common value and a plain UNIQUE
-- would be a no-op on it in Postgres but would still carry the index cost of
-- every row.
create unique index if not exists publications_supersedes_once_idx
  on publications (supersedes_id) where supersedes_id is not null;

-- THE PROJECTION'S RECIPIENT END (F51 / DECISION-140, added 2026-09-24).
--
-- The existing congregation_statistics_publication_fk proves the SOURCE end:
-- (publication_id, about_org_id) -> publications (id, organization_id), i.e.
-- the projection's congregation is the publication's publishing congregation.
-- Nothing proved the RECIPIENT end — Presbytery B could hold a projection row
-- pointing at a publication whose actual recipient_org_id was Presbytery A,
-- provided the source congregation matched.
--
-- Two FKs, sharing publication_id, both pinning to the same single
-- publications row (id is the primary key), therefore force BOTH
-- about_org_id = publications.organization_id AND organization_id =
-- publications.recipient_org_id on that one row. That is what "the projection
-- is a projection of THIS event" actually means.
--
-- The backfill above already satisfies it with no fixup: it writes the
-- publication's recipient_org_id as r.organization_id, which IS the
-- projection row's own organization_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'publications_id_recipient_key'
  ) then
    alter table publications
      add constraint publications_id_recipient_key unique (id, recipient_org_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'congregation_statistics_publication_recipient_fk'
  ) then
    alter table congregation_statistics
      add constraint congregation_statistics_publication_recipient_fk
      foreign key (publication_id, organization_id)
      references publications (id, recipient_org_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5b. Withdrawal reaches the PROJECTION (F52 / DECISION-140, Option A)
-- ---------------------------------------------------------------------------
-- Added 2026-09-24. Option A says the recipient RETAINS a withdrawn artifact
-- as historical record, marked withdrawn and excluded from current
-- calculations — so the projection needs somewhere to carry the mark. Without
-- this column the recipient's typed surface would go on counting a withdrawn
-- return in every rollup with no way to know, which is the half-Option-A the
-- read function above was just corrected out of.
--
-- Added AFTER the backfill deliberately: the backfill reconstructs each
-- payload by SUBTRACTING known bookkeeping columns from `to_jsonb(r)`, and a
-- column that does not yet exist cannot leak into an archived payload. (It is
-- also named in that subtraction list, for the re-apply case.)
alter table congregation_statistics add column if not exists withdrawn_at timestamptz;

comment on column congregation_statistics.withdrawn_at is
  'Set when the publication this row projects is withdrawn (F52/DECISION-140, Option A). The row STAYS — the recipient retains the received artifact as historical record, the same permanence rule that voids a roll action rather than deleting it — and every consumer computing CURRENT totals must filter withdrawn_at is null. Settable through exactly one transition, by presby_reject_published_statistics_write() below; the future presby_withdraw_publication() sets it together with publications.withdrawn_at/by/minute_reference in one transaction. Unwritable by presby_app: it is one of the two columns excluded from that role''s column-level UPDATE grant (section 10 at the foot of this file, 2026-09-25 / QA-2) — the grant, not the trigger, is what closes the tenant connection here, because a GUC is a marker any role can set and only a privilege is a privilege.';

-- presby_reject_published_statistics_write() is WIDENED BY EXACTLY ONE
-- PERMITTED TRANSITION, mirroring presby_freeze_publication()'s shape.
--
-- It cannot be edited in drizzle/0038, where it was created: 0038 is released.
-- `create or replace function` here, in the file that is still unreleased, is
-- the correct instrument — the trigger definition in 0038 is unchanged and
-- keeps pointing at this name.
--
-- THE COMPARISON IS BY JSONB SUBTRACTION, not by enumerating ~60 columns. The
-- backfill above already uses that technique; hand-listing the columns would
-- be a second place that has to be edited every time a SASR field is added,
-- and the failure mode of forgetting is silent (an unlisted column becomes
-- freely editable on a published row).
--
-- THERE IS NO WITHDRAW FUNCTION YET, and that is deliberate, not an omission.
-- The future presby_withdraw_publication() — still owned by the publish-UI
-- pipeline, named in docs/TODO.md — sets publications.withdrawn_at/by/
-- minute_reference AND this column in ONE transaction; both freeze triggers
-- permit exactly that pair of transitions and nothing else, which is why they
-- are written now, before the writer exists, rather than alongside it.
create or replace function presby_reject_published_statistics_write()
returns trigger language plpgsql as $$
begin
  -- The ONE permitted transition: withdrawn_at moves null -> not null and
  -- NOTHING ELSE on the row moves. A second withdrawal is refused for the
  -- same reason publications_freeze refuses one — a withdrawal is itself an
  -- act, corrected by publishing again, never by editing the act away.
  --
  -- AND the transaction must be inside the sanctioned withdrawal writer
  -- (F56 / DECISION-141, added 2026-09-24, sixth Phase 3 loop-back): the
  -- conjunct is what stops a raw owner connection withdrawing this projection
  -- alone, leaving it disagreeing with the publication it projects. Its twin
  -- lives in presby_freeze_publication() above, and the future
  -- presby_withdraw_publication() arms presby.withdrawal_write_active once and
  -- performs both UPDATEs in one transaction. Falling through raises this
  -- function's EXISTING single literal, unchanged — unlike publications, this
  -- table has exactly one rejection message and reusing it keeps that true
  -- (the message's "published rows are immutable" framing is imprecise about
  -- WHY the withdrawal is refused today, which Ruling 3 accepted explicitly:
  -- the state is temporary, and a second literal for it would outlive its
  -- reason).
  if tg_op = 'UPDATE'
     and old.withdrawn_at is null
     and new.withdrawn_at is not null
     and (to_jsonb(old) - 'withdrawn_at') = (to_jsonb(new) - 'withdrawn_at')
     and coalesce(current_setting('presby.withdrawal_write_active', true), '') = 'true'
  then
    return new;
  end if;

  raise exception
    'congregation_statistics %: published rows are immutable; republish via presby_publish_sasr_snapshot(), which supersedes automatically (the only permitted UPDATE is a single withdrawal — setting withdrawn_at, and nothing else on the row)',
    old.id
    using errcode = 'check_violation';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Drop supersedes_publication_id
-- ---------------------------------------------------------------------------
-- presby_list_own_congregation_publications() returns `setof
-- congregation_statistics`, so its return type is the table's row type. The
-- function is dropped and recreated around the column drop rather than
-- relying on Postgres to re-derive the composite type — cheap, explicit, and
-- it keeps the grant statement next to the definition. Its BODY is unchanged
-- (`select *`), so the congregation-side contract is exactly what it was;
-- only the column list follows the table.
drop function if exists presby_list_own_congregation_publications(integer);

alter table congregation_statistics drop column if exists supersedes_publication_id;

create or replace function presby_list_own_congregation_publications(
  p_year integer default null
)
returns setof congregation_statistics
language sql stable security definer
set search_path = public, pg_temp
as $$
  select *
    from congregation_statistics
   where about_org_id = presby_current_org()
     and provenance = 'published_by_congregation'
     and (p_year is null or year = p_year)
   order by year desc, published_at desc nulls last;
$$;

revoke all on function presby_list_own_congregation_publications(integer) from public;
grant execute on function presby_list_own_congregation_publications(integer) to presby_app;

-- ---------------------------------------------------------------------------
-- 7. presby_publish_sasr_snapshot() — REWRITTEN, same name, same allow-list
-- ---------------------------------------------------------------------------
-- SAME PARAMETER LIST AS drizzle/0038:409-465, byte for byte: no parameter
-- added, none removed, none reordered. Phase 1 confirmed there is no live
-- caller yet, but the signature-stability promise is kept anyway because the
-- publish-UI pipeline is named and will bind to it.
--
-- ONE PART OF THE CONTRACT DOES CHANGE, deliberately and named in the
-- work-log: the RETURN VALUE is now the statistical_returns id, not the
-- congregation_statistics id. The artifact this function fundamentally
-- produces is the return; the caller reaches the publication and the
-- projection through presby_list_own_congregation_publications() exactly as
-- before.
--
-- WHAT IS PRESERVED FROM 0038, unchanged and on purpose:
--   * the CONFUSED-DEPUTY SHAPE (drizzle/0038:376-404). The function accepts
--     NO organization id of any kind, source or target. It reads
--     presby_current_org() — already membership-verified by withOrgContext()
--     before the function is reachable — and there is nothing in the
--     signature a caller could spoof.
--   * the PARAMETER LIST IS THE ALLOW-LIST. No jsonb is accepted or
--     forwarded; a field with no parameter slot cannot smuggle through. The
--     field_spec trigger on statistical_returns (drizzle/0046) is now a
--     SECOND, INDEPENDENT check of the same property, which is the point of
--     having both.
--   * EVERY range validation, verbatim: the same v_count_max (1,000,000) and
--     v_money_max (100,000,000) bounds on the same 60 parameters, and the
--     same 1900-2100 report-year window.
--   * SECURITY DEFINER, load-bearing for the same F26 reason: the function's
--     own INSERT into congregation_statistics carries the PRESBYTERY's
--     organization_id while app.current_org_id is the congregation, which the
--     tenant policy would otherwise reject — that write is the whole point.
--
-- WHAT CHANGES:
--   1. THE RECIPIENT IS RESOLVED FROM THE AFFILIATION HISTORY, never from
--      organizations.parent_id: presby_affiliation_parent_as_of(v_org,
--      current_date). D19's rule (sec 2b / G-3.0108(a)): the report goes to
--      the presbytery of CURRENT membership, and that fact is then frozen
--      onto the publications row so a later redistricting cannot re-route an
--      already-filed return. The rejection text moves from "no parent
--      organization" to "no current affiliation"; the ERRCODE is unchanged
--      (invalid_parameter_value), so error-code-based handling in any future
--      caller is unaffected even though the string moves.
--   2. It writes THREE rows in one transaction — statistical_returns (the
--      artifact) -> publications (the event) -> congregation_statistics (the
--      projection) — instead of one.
--   3. supersedes is derived from publications, not from the projection
--      self-chain, and it ignores WITHDRAWN publications: a withdrawn
--      publication is not the thing a new one corrects.
--   4. published_at and minute_reference are written onto the projection as
--      COPIES of the values just written to the publication (F39). One
--      function, one transaction, two rows that are never updated again — the
--      copy cannot drift, unlike F29's current_roll.
--
-- THE FORM VERSION IS '2024', UNCONDITIONALLY, AND THAT IS A CLAIM ABOUT
-- FIELDS RATHER THAN CALENDARS. This function's typed parameter list IS the
-- 2024 field set — drizzle/0046 asserts the 1:1 correspondence between that
-- spec and congregation_statistics's typed columns — so recording a payload
-- gathered through these parameters under any other generation would be the
-- lie, whatever p_report_year says. Publishing is a CURRENT act by a CURRENT
-- congregation on today's form; the path for genuinely older generations is
-- provenance = 'imported' through D13's staging workflow (increment 7), which
-- is where the 1984/2014/2022 field mappings are owed. Resolving the version
-- from p_report_year instead would make every pre-2024 report year
-- unpublishable today, since those specs are deliberate placeholders.
--
-- THE ONE NEW REJECTION, and it is a collision this migration surfaces rather
-- than invents (see the work-log's loop-back candidates). drizzle/0045's
-- congregation_statistics_about_org trigger checks the projection against the
-- affiliation AS OF THE REPORT YEAR, while D19 resolves the recipient as of
-- TODAY. For a congregation redistricted between the report year and the
-- filing date those two are different councils, and the trigger would refuse
-- the projection with an opaque about-org message after two rows had already
-- been written. The function therefore checks the same question FIRST and
-- raises something a UI can map to human copy. It does not widen 0045's rule:
-- batch B's finding 11 records "a council may legitimately be refused a
-- historical row for one of its present-day member congregations" as
-- deliberate.
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
as $$
declare
  v_org            uuid := presby_current_org();
  v_recipient      uuid;
  v_recipient_type organization_type;
  v_form_version   text := '2024';
  v_now            timestamptz := now();
  v_return_id      uuid;
  v_publication_id uuid;
  v_supersedes_id  uuid;
  v_payload        jsonb;
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

  -- D19: the affiliation history, never organizations.parent_id.
  v_recipient := presby_affiliation_parent_as_of(v_org, current_date::date);
  if v_recipient is null then
    raise exception
      'presby_publish_sasr_snapshot: organization % has no current affiliation to publish to',
      v_org
      using errcode = 'invalid_parameter_value';
  end if;

  select organization_type into v_recipient_type from organizations where id = v_recipient;
  if v_recipient_type is distinct from 'presbytery' then
    raise exception
      'presby_publish_sasr_snapshot: the current council of % is not a presbytery (found %)',
      v_org, v_recipient_type
      using errcode = 'invalid_parameter_value';
  end if;

  if p_report_year is null or p_report_year < 1900 or p_report_year > 2100 then
    raise exception 'presby_publish_sasr_snapshot: report year % out of range', p_report_year
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from sasr_form_versions where key = v_form_version) then
    raise exception
      'presby_publish_sasr_snapshot: form version % is not seeded; drizzle/0046 must have been applied',
      v_form_version
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

  -- THE COLLISION CHECK (see the header). The projection this function is
  -- about to write lands at v_recipient ABOUT v_org for p_report_year, and
  -- drizzle/0045's congregation_statistics_about_org trigger asks whether
  -- those two were affiliated in THAT year — the same year-endpoint rule the
  -- trigger itself uses. Asking it here first turns an opaque about-org
  -- rejection two rows later into a named, mappable error.
  if not (presby_org_affiliated(v_org, v_recipient, make_date(p_report_year, 1, 1))
          or presby_org_affiliated(v_org, v_recipient, make_date(p_report_year, 12, 31))) then
    raise exception
      'presby_publish_sasr_snapshot: % was not affiliated with its current council % during % — a return for a year before this congregation joined this presbytery cannot be published to it; it belongs to the council that received it, through the import path',
      v_org, v_recipient, p_report_year
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

  -- ARM THE SANCTIONED-WRITE GUC (F55 / DECISION-141, added 2026-09-24), once
  -- for all three inserts below. Placed HERE — after every validation above
  -- (org context, recipient resolution, recipient type, report year, form
  -- version, value bounds, the about-org year collision check) and before the
  -- first insert — so a call that is going to be refused never arms anything,
  -- and so the marker covers exactly the writes this function performs.
  -- Transaction-local (is_local => true): a session-scoped GUC would leave the
  -- three guards DISARMED for the next unrelated request on a pooled
  -- neon-serverless connection, which is the same discipline
  -- presby_set_organization_identifier() and presby_transfer_affiliation()
  -- already follow.
  perform set_config('presby.publication_write_active', 'true', true);

  -- 1. THE ARTIFACT. Owned by the publishing congregation; about itself
  --    (statistical_returns_submitted_is_self). `reconciled` is true because
  --    D11's rule applies at write time to a submitted return: the clerk's
  --    review of presby_sasr_projection() IS the reconciliation step for this
  --    provenance. This function does not re-derive the roll balance equation
  --    internally — Phase 3 names that as a possible v2 addition to this same
  --    function, not a blocker.
  insert into statistical_returns (
    organization_id, about_org_id, report_year, form_version_key,
    provenance, payload, reconciled,
    attested_by_name, attested_role, attested_at, created_at
  ) values (
    v_org, v_org, p_report_year, v_form_version,
    'submitted', v_payload, true,
    -- There is no acting-USER context in this platform: only
    -- app.current_org_id exists as a GUC (Ruling A4). Accepting an attester
    -- name as a parameter would be a caller-supplied identity claim of
    -- exactly the kind this function's shape refuses, so attestation is left
    -- null until the publish-UI pipeline and the app.current_user_id GUC
    -- arrive together. The session minute IS recorded — on the publication,
    -- where it belongs.
    null, null, v_now, v_now
  )
  returning id into v_return_id;

  -- 2. THE EVENT. supersedes is DERIVED, never accepted as a parameter (the
  --    same rule 0038 applied to supersedes_publication_id): the caller's own
  --    most recent NON-WITHDRAWN publication for the same report year. A
  --    withdrawn publication is not a thing a new filing corrects.
  select p.id into v_supersedes_id
    from publications p
    join statistical_returns r
      on r.id = p.artifact_id and r.organization_id = p.organization_id
   where p.organization_id = v_org
     and p.record_class = 'statistical_return'
     and p.withdrawn_at is null
     and r.report_year = p_report_year
   order by p.published_at desc, r.created_at desc
   limit 1;

  insert into publications (
    organization_id, recipient_org_id, record_class, artifact_id,
    published_at, supersedes_id, authorized_by, minute_reference, withdrawn_at
  ) values (
    v_org, v_recipient, 'statistical_return', v_return_id,
    v_now, v_supersedes_id,
    -- Same Ruling A4 gap as attested_by_name above: no acting-user context.
    null,
    p_minute_reference, null
  )
  returning id into v_publication_id;

  -- 3. THE PROJECTION, at the RECIPIENT, about the CALLER. Column list
  --    otherwise identical to drizzle/0038:582-620, with publication_id
  --    replacing supersedes_publication_id. published_at is v_now — the SAME
  --    instant written to the publication, not a second now() — so F39's
  --    equality assertion is exact rather than approximately true.
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
  ) values (
    v_recipient, v_org, p_report_year, 'published_by_congregation', v_publication_id,
    v_now, p_minute_reference,
    p_gains_professions_under18, p_gains_professions_18plus, p_gains_certificate, p_gains_other,
    p_losses_certificate, p_losses_deaths, p_losses_other,
    p_ending_active, p_ending_baptized, p_ending_affiliate, p_ending_other_participants,
    p_gender_woman, p_gender_man, p_gender_nonbinary,
    p_age_17_under, p_age_18_25, p_age_26_40, p_age_41_55, p_age_56_70, p_age_71_over, p_age_unknown,
    p_race_asian, p_race_african, p_race_african_american, p_race_black, p_race_hispanic,
    p_race_middle_eastern, p_race_native_american, p_race_white, p_race_other,
    p_disability_hearing, p_disability_mobility, p_disability_sight, p_disability_other,
    p_officers_ruling_elder_count, p_officers_deacon_count,
    p_baptisms_children, p_baptisms_adults,
    p_youth_4_under, p_youth_k_5, p_youth_6_8, p_youth_9_12,
    p_avg_weekly_worship_attendance, p_potential_giving_units,
    p_receipts_contributions, p_receipts_capital_building_funds,
    p_receipts_investment_endowment_income, p_receipts_bequests, p_receipts_other_income,
    p_receipts_subsidy_or_aid,
    p_exp_local_program, p_exp_local_mission, p_exp_capital, p_exp_investment,
    p_exp_per_capita_apportionment, p_exp_validated_mission_pcusa,
    p_exp_ga_theological_education_fund, p_exp_other_mission,
    p_budgeted_income, p_budgeted_expense
  );

  -- The ARTIFACT's id, not the projection's — see the header.
  return v_return_id;
end $$;

-- Unchanged from drizzle/0038: the same explicit parameter-type list, so
-- the CREATE OR REPLACE above genuinely replaced the existing function
-- rather than overloading it.
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
-- 8. presby_list_published_returns_to_me() — the RECIPIENT's read-back
-- ---------------------------------------------------------------------------
-- Phase 2 Ruling 5 / DECISION-135. Without this, D20's "a recipient council
-- reads the artifact published to it" is unenforceable in the permissive
-- direction: statistical_returns is owned by the SUBMITTING CONGREGATION, so
-- the tenant policy filters it to zero rows from the presbytery's context,
-- and the presbytery would only ever see the typed projection — never the
-- payload that was actually attested. This is the mirror of
-- presby_list_own_congregation_publications() (drizzle/0038:665-690) to the
-- other side of the publication, and it is the "controlled read, not a
-- policy" idiom (presby_match_person(), presby_membership_is_active()) —
-- NOT a third named cross-org RLS policy. docs/schema-design.md sec 17's
-- two-named-policies rule is untouched and DECISION-112's refusal of a third
-- stands.
--
-- IT TAKES NO COUNCIL ID. p_about_org_id and p_year are FILTERS over what the
-- caller may already see; the caller's own identity is presby_current_org(),
-- exactly as every other function in this pipeline. There is no parameter
-- through which a presbytery could read another presbytery's inbox.
--
-- IT FILTERS ON THE PUBLICATION, NOT ON LIVE AFFILIATION, and that is polity
-- rather than convenience: G-3.0107 makes a ceased council's records the
-- property of the next higher council, so a presbytery must still read a
-- DISSOLVED congregation's returns after dissolution — which a read gated on
-- a current affiliation would refuse at exactly the moment it matters.
--
-- WITHDRAWN PUBLICATIONS ARE RETURNED, NOT FILTERED OUT — reversed
-- 2026-09-24 (F52 / DECISION-140, Option A decided).
--
-- The first build filtered `and p.withdrawn_at is null`, which was Option B
-- (withdrawal REVOKES the recipient's read authorization) while the
-- congregation_statistics projection was left untouched by withdrawal, which
-- is Option A (the recipient RETAINS the received artifact as historical
-- record, marked withdrawn, excluded from current calculations). Half of each
-- is the one answer that is certainly wrong.
--
-- Option A throughout, for two reasons. This design's whole permanence
-- philosophy: a roll action is voided rather than deleted, a person is merged
-- rather than erased, a publication is withdrawn rather than deleted — a
-- mechanism that makes a withdrawn return simply VANISH from the recipient's
-- read is the odd one out. And G-3.0107: a ceased council's records become
-- the property of the next higher council, which reads oddly beside a
-- disappearing artifact.
--
-- The whole withdrawal triple is in the return signature, so the caller
-- filters — and, when it does, sees WHO withdrew and under which minute
-- rather than merely that something is gone. A consumer computing CURRENT
-- totals adds `withdrawn_at is null`; a consumer showing the recipient's
-- history does not.
--
-- Adding the two columns changes the RETURN TYPE, which CREATE OR REPLACE
-- cannot do, so the function is dropped first. Safe: it ships in this same
-- migration and has no application caller yet.
drop function if exists presby_list_published_returns_to_me(uuid, integer);

create or replace function presby_list_published_returns_to_me(
  p_about_org_id uuid default null,
  p_year integer default null
)
returns table (
  publication_id             uuid,
  published_at               timestamptz,
  minute_reference           text,
  about_org_id               uuid,
  report_year                integer,
  form_version_key           text,
  payload                    jsonb,
  attested_by_name           text,
  attested_role              text,
  attested_at                timestamptz,
  return_id                  uuid,
  withdrawn_at               timestamptz,
  withdrawn_by               uuid,
  withdrawn_minute_reference text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    p.id, p.published_at, p.minute_reference,
    r.about_org_id, r.report_year, r.form_version_key, r.payload,
    r.attested_by_name, r.attested_role, r.attested_at,
    r.id, p.withdrawn_at, p.withdrawn_by, p.withdrawn_minute_reference
  from publications p
  join statistical_returns r
    on r.id = p.artifact_id
   and r.organization_id = p.organization_id
  where p.recipient_org_id = presby_current_org()
    and (p_about_org_id is null or r.about_org_id = p_about_org_id)
    and (p_year is null or r.report_year = p_year)
  order by r.report_year desc, p.published_at desc;
$$;

revoke all on function presby_list_published_returns_to_me(uuid, integer) from public;
grant execute on function presby_list_published_returns_to_me(uuid, integer) to presby_app;

comment on function presby_list_published_returns_to_me(uuid, integer) is
  'The recipient side of a publication (Ruling 5 / DECISION-135). Returns the artifact behind EVERY publication addressed to presby_current_org(), withdrawn ones included and carrying the whole withdrawal triple — Option A, F52/DECISION-140: the recipient retains the received artifact as historical record and a consumer computing CURRENT totals filters withdrawn_at is null itself. Joined through the composite (artifact_id, organization_id) FK. Takes no council id: the caller is the GUC, never a parameter. Filters on the recorded publication rather than on live affiliation, so a dissolved congregation''s returns stay readable by the council that received them (G-3.0107).';

-- ---------------------------------------------------------------------------
-- 9. sasr_reports — dropped (Phase 2 Ruling 6 / DECISION-137)
-- ---------------------------------------------------------------------------
-- Zero rows on production AND development, zero application consumers
-- (src/lib/dev-docs.ts read it only as /developer schema reference), and a
-- shape already stale under D25: `status: draft | session_approved |
-- submitted` with a mutable payload, when `submitted` is no longer a status
-- at all — it is the existence of a statistical_returns row. Keeping a real
-- table with no consumer and a known-wrong shape is the second-source-of-
-- truth pattern this design refuses everywhere else.
--
-- SAID OUT LOUD, because it is a real loss: the congregation now has NO
-- staging surface between computing the live projection and attesting and
-- freezing it. That need returns as a design question OWNED BY the publish-UI
-- pipeline, answered against D25's rules rather than inherited from this
-- pre-round-2 shape — tracked in docs/TODO.md at Phase 6 (Workflow Rule 10),
-- not silently absorbed here.
--
-- drizzle/0009's `tenant_tables` array still names this table and is NOT
-- edited: that array is a historical record of what 0009 did, not something
-- re-executed, and 0009 runs before 0047 in any replay from zero. The stated
-- consequence is that re-applying 0009 ALONE, out of order, after this
-- migration would fail on the missing table — the same additive-replay hazard
-- batch B recorded as finding 4 for the blanket presby_platform grant.
drop table if exists sasr_reports;


-- ---------------------------------------------------------------------------
-- 10. congregation_statistics — COLUMN-LEVEL UPDATE **and INSERT** for
--     presby_app (QA-2 / DECISION-141 correction, 2026-09-25, eighth Phase 3
--     loop-back; the INSERT half added at the ELEVENTH loop-back, F61)
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG. Sections 3b and 5b above gated the withdrawal pair behind a
-- transaction-local GUC (presby.withdrawal_write_active) and claimed the
-- transition was therefore "unreachable on every connection until the writer
-- ships". A GUC is a MARKER, not a PRIVILEGE: set_config() has no privilege
-- check at all, so any role holding UPDATE can arm it and then satisfy the
-- conjunct. presby_app holds UPDATE on this table from drizzle/0038:280 — the
-- live setCongregationStatistics() path needs it — and F55/F56 never narrowed
-- that grant, they only added triggers. QA measured the consequence on the
-- tenant connection: set_config('presby.withdrawal_write_active','true',true)
-- followed by `update congregation_statistics set withdrawn_at = now()`
-- returned UPDATE 1. A recipient presbytery with SQL access could mark a
-- congregation's published projection withdrawn, unpaired from the publication
-- it projects — precisely the state F56 exists to prevent.
--
-- THE INSTRUMENT IS A COLUMN-LEVEL GRANT, because no trigger can express
-- "this ROLE may never touch these two COLUMNS" (a trigger sees the row, not
-- the grantee, and current_user is the wrong axis once a DEFINER function is
-- in the picture). Two columns are excluded from presby_app's UPDATE:
--
--   withdrawn_at   — the withdrawal half. Only the future
--                    presby_withdraw_publication() (SECURITY DEFINER, running
--                    as the owner) has any business setting it. This is the
--                    column QA measured, and this grant is what closes it.
--   publication_id — the projection's link back to the publication that
--                    created it. Only presby_publish_sasr_snapshot() sets it,
--                    and it runs as the owner. Excluded for symmetry: nothing
--                    on the tenant path has ever updated it.
--
-- THE INSERT HALF, BUILT AT LAST (F61, eleventh Phase 3 loop-back,
-- 2026-09-25). It is NOT a change of mind about the measurement below — the
-- measurement still holds exactly as written — it is a change to the OTHER
-- half of the pair, which is what made it buildable:
--
--   (1) Postgres requires column-level INSERT privilege on every column that
--       appears in the INSERT TARGET LIST, including one whose value is the
--       `DEFAULT` keyword. Probe: a table with `grant insert (a, b)`, then
--       `insert into t (a, b, c) values (1, 2, default)` as the grantee ->
--       `permission denied for table t`. Only `insert into t (a, b) values
--       (1, 2)` succeeds.
--   (2) Drizzle's insert builder (drizzle-orm 0.45, pg-core dialect
--       buildInsertQuery) emits EVERY column of the table in the target list,
--       filling every unspecified one with `default`. It has no supported way
--       to omit a column.
--
--   The ninth Phase 4 pass narrowed the grant and left setCongregation-
--   Statistics() on Drizzle's builder; it broke immediately (5 failures in
--   src/lib/presbytery.test.ts, the first two `permission denied for table
--   congregation_statistics` on exactly that upsert) and the INSERT half was
--   removed. F61 changes BOTH halves together: src/lib/presbytery.ts's
--   setCongregationStatistics() now emits an explicit-column raw-SQL upsert
--   naming exactly the 23 columns it sets, so fact (1) never triggers — the
--   excluded columns are not in the target list at all, not even as DEFAULT.
--
-- WHAT THE NARROWING CLOSES, stated as the residual it retires. Until this
-- pass, presby_app held table-level INSERT here, so a recipient council on
-- the tenant connection could self-arm presby.publication_write_active
-- (a GUC is a marker, not a privilege) and manufacture a PERMANENT
-- published_by_congregation projection row — an immutable typed projection
-- claiming facts that were never published, bounded only to publications
-- actually addressed to it. QA demonstrated it end to end; the external
-- reviewer's F61 judged it worth closing rather than accepting, because
-- congregation_statistics feeds operational calculations. It is now closed at
-- the privilege layer: the row must name publication_id to satisfy the CHECK
-- congregation_statistics_publication_shape, and presby_app can no longer
-- name that column at all.
--
-- THREE COLUMNS ARE EXCLUDED FROM INSERT, NOT TWO, and the third is the one
-- the CHECK is silent about:
--
--   publication_id — sufficient on its own to close the residual above: a row
--                    claiming published_by_congregation provenance fails at
--                    the grant the moment it names this column, and fails the
--                    CHECK if it omits it (the column would default NULL).
--   withdrawn_at   — a row cannot be born withdrawn. Symmetric with the
--                    UPDATE exclusion, same reasoning.
--   published_at   — NOT reachable by the CHECK. Nothing stopped a
--                    presbytery_entered row from carrying a fabricated
--                    publication timestamp, and published_at is real content
--                    the rollup at src/lib/presbytery.ts orders and coalesces
--                    on. The live presbytery_entered write never names it, so
--                    excluding it costs nothing and closes a softer forgery
--                    vector.
--
-- THE RESULTING ASYMMETRY IS DELIBERATE: UPDATE excludes two columns,
-- INSERT excludes three. Narrowing the UPDATE grant further to also exclude
-- published_at is not required by anything measured this round and would be
-- scope creep; the live path never updates it either, and the FK/CHECK/GUC
-- stack still governs any attempt to make such an update meaningful.
--
-- presby_publish_sasr_snapshot() IS UNAFFECTED: it runs SECURITY DEFINER and
-- is grant-exempt per F44. So is neondb_owner, for the same reason — the
-- owner-side guarantee on the published branch is the trigger in section 3b,
-- never this grant.
--
-- REVOKE FIRST, THEN GRANT, and in that order for a reason Postgres makes
-- non-obvious: column privileges are ADDITIVE on top of a table-level grant,
-- never subtractive. `revoke update (withdrawn_at) ... from presby_app` while
-- the table-level UPDATE grant still stands removes nothing. Revoking the
-- table-level privilege drops the corresponding column-level privileges with
-- it, so this pair is the whole statement of intent and is idempotent by
-- construction — re-applying it reproduces exactly the same ACL.
--
-- BOTH COLUMN LISTS ARE GENERATED FROM THE CATALOG, never hand-transcribed.
-- This table carries 71 columns and grows with every SASR field; a hand-typed
-- list would be a second place to edit, whose failure mode is silent (a newly
-- added column becomes unwritable by the live path, at runtime, not at tsc).
-- The DO block below reads information_schema.columns twice and excludes
-- exactly the names above, so a column added tomorrow is granted automatically
-- and the exclusion sets stay the only thing this migration asserts.
--
-- SCOPE, stated so it is not read as wider than it is:
--   * presby_platform is UNTOUCHED — it keeps its whole-table DML grant, the
--     same accepted-risk class as its grants elsewhere in this pipeline (F47).
--   * presby_app keeps its table-level SELECT and DELETE. UPDATE and INSERT
--     are both narrowed to column level; no table-level entry for either verb
--     survives in relacl.
--   * neondb_owner is unaffected: it holds every privilege by ownership, which
--     no grant or revoke can change (F44). The owner-side guarantee on these
--     columns is the trigger in sections 3b and 5b, not this grant.
--   * The grants are NOT narrowed to the 19 value columns
--     setCongregationStatistics() writes today. Every SASR demographic/
--     financial column is schema-complete v1 with no application code yet;
--     foreclosing them here would be a different and much larger scope
--     question (v1 field coverage, D13's import function) riding on this
--     ruling's coattails.
--
-- REVOKE FIRST, THEN GRANT, FOR BOTH VERBS — and for INSERT that ordering is
-- what closes QA's Finding 4 outright rather than leaving it as a caveat. A
-- bare table-level grant restores table-level privilege but does not clear
-- column-level entries a prior narrowing left in pg_attribute.attacl (measured:
-- 70 stale entries after one branch's replay). Revoking the verb first drops
-- every column-level entry with it, so each pair below is a FULL restatement
-- and a whole-file re-apply converges on exactly the same ACL, twice running.
--
-- Proven by scripts/test-rls.sql section 35(d) (the UPDATE half) and section
-- 37 (the INSERT half: an armed published_by_congregation insert refused by
-- the GRANT and not by a trigger, the live presbytery_entered upsert shape
-- still succeeding and still idempotent, has_column_privilege false on the
-- three excluded columns and true on two positive controls, no table-level
-- INSERT in relacl, and exactly 68 column-level INSERT entries in attacl),
-- and by src/lib/presbytery.test.ts, which exercises the live
-- setCongregationStatistics() INSERT and UPDATE branches end to end on the
-- presby_app connection.
do $$
declare
  v_update_cols text;
  v_update_n    integer;
  v_insert_cols text;
  v_insert_n    integer;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         count(*)
    into v_update_cols, v_update_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'congregation_statistics'
     and column_name not in ('withdrawn_at', 'publication_id');

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         count(*)
    into v_insert_cols, v_insert_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'congregation_statistics'
     and column_name not in ('withdrawn_at', 'publication_id', 'published_at');

  if v_update_cols is null or v_insert_cols is null then
    raise exception
      'congregation_statistics: no grantable columns found — refusing to issue an empty grant';
  end if;

  -- The table-level revoke drops the column-level UPDATE privileges with it,
  -- so this is a full restatement and not an increment.
  execute 'revoke update on congregation_statistics from presby_app';
  execute format(
    'grant update (%s) on congregation_statistics to presby_app', v_update_cols);

  -- Same shape for INSERT (F61). The revoke is not decoration: drizzle/0038
  -- granted table-level INSERT here and an interim build of this very section
  -- granted it again, so without this line a re-apply would leave the
  -- table-level entry standing and the column list would buy nothing.
  execute 'revoke insert on congregation_statistics from presby_app';
  execute format(
    'grant insert (%s) on congregation_statistics to presby_app', v_insert_cols);

  raise notice
    'congregation_statistics: presby_app granted column-level UPDATE on % columns (withdrawn_at, publication_id excluded) and column-level INSERT on % columns (those two plus published_at excluded); no table-level UPDATE or INSERT remains',
    v_update_n, v_insert_n;
end $$;
