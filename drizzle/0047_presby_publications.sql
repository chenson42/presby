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
  -- Attribution without the act it attributes is meaningless: a withdrawer
  -- or a withdrawal minute can only exist on a row that is actually
  -- withdrawn. The trigger enforces the TRANSITION; this enforces the
  -- resulting SHAPE, including for the owner's own writes.
  constraint publications_withdrawal_shape
    check (withdrawn_at is not null
           or (withdrawn_by is null and withdrawn_minute_reference is null))
);

-- The two withdrawal-provenance columns are added idempotently as well as in
-- the CREATE above, because `create table if not exists` is a no-op on a
-- database that already ran an earlier form of this migration (the same
-- pattern drizzle/0044 uses for the organizations columns).
alter table publications add column if not exists withdrawn_by uuid references users(id);
alter table publications add column if not exists withdrawn_minute_reference text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'publications_withdrawal_shape') then
    alter table publications
      add constraint publications_withdrawal_shape
      check (withdrawn_at is not null
             or (withdrawn_by is null and withdrawn_minute_reference is null));
  end if;
end $$;

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
revoke all on publications from presby_app, presby_platform;
grant select, insert on publications to presby_app;
grant select, insert on publications to presby_platform;

comment on table publications is
  'The publication EVENT (D20): a source council published an artifact to a recipient council on a date, under a minute. IMMUTABLE except for withdrawn_at, which is the one permitted UPDATE (withdrawal is a column, never a delete). recipient_org_id is resolved once from presby_affiliation_parent_as_of() at write time and never re-derived, so a later redistricting cannot change who received an already-filed return.';
comment on column publications.recipient_org_id is
  'The council the artifact was published TO — the presbytery of current membership at published_at (D19/G-3.0108(a)), resolved via presby_affiliation_parent_as_of() and NEVER from organizations.parent_id. Fixed at write time. The recipient reads through presby_list_published_returns_to_me(), which filters on THIS column rather than on live affiliation, because G-3.0107 makes a ceased council''s records the property of the next higher council — a presbytery must still read a dissolved congregation''s returns after dissolution.';
comment on column publications.minute_reference is
  'The publishing council''s own minute authorizing publication (a congregation''s session minute for an SASR). NOT the same fact as congregation_statistics.minute_reference, which is the presbytery''s data-entry minute on a presbytery_entered row — collapsing them is the one-column-two-facts error this design refuses everywhere else (F39).';
comment on column publications.withdrawn_by is
  'Who withdrew it. Null on every row today: presby_app holds no UPDATE grant, so withdrawal is an owner-only act until presby_withdraw_publication() ships in the publish-UI pipeline — and there is still no acting-USER context in this platform (Ruling A4: only app.current_org_id exists as a GUC).';
comment on column publications.withdrawn_minute_reference is
  'The withdrawing council''s own minute. Distinct from minute_reference, which authorized the PUBLICATION — one column, one fact.';
comment on column publications.withdrawn_at is
  'Withdrawal is a column, not a delete (D20), and it is a MINUTED ACT: withdrawn_at, withdrawn_by and withdrawn_minute_reference move together, exactly once, on a row that is not already withdrawn — DECISION-135''s affiliation-close shape, for the same reason (a close with no attribution is an unattributable mutation of a provenanced record). A withdrawn publication disappears from presby_list_published_returns_to_me(); its congregation_statistics projection row is DELIBERATELY UNTOUCHED — acting on the projection is out of scope for this pipeline and belongs to whichever pipeline ships a withdrawal UI (Phase 3 Edge Cases, "Withdrawn publications and the projection row").';

-- ---------------------------------------------------------------------------
-- 2. publications_freeze — immutable except withdrawn_at
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

  return new;
end $$;

drop trigger if exists publications_freeze on publications;
create trigger publications_freeze
  before update or delete on publications
  for each row execute function presby_freeze_publication();

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
    v_payload := jsonb_strip_nulls(
      to_jsonb(r) - array[
        'id','organization_id','about_org_id','year','provenance',
        'supersedes_publication_id','published_at','minute_reference',
        'entered_by','created_at','publication_id'
      ]
    );

    insert into statistical_returns (
      organization_id, about_org_id, report_year, form_version_key,
      provenance, payload, reconciled, attested_at, source_ref, created_at
    ) values (
      r.about_org_id, r.about_org_id, r.year, '2024',
      'submitted', v_payload, true, r.published_at,
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

alter table publications enable trigger publications_freeze;
alter table congregation_statistics enable trigger congregation_statistics_freeze;

commit;

-- ---------------------------------------------------------------------------
-- 5. The shape CHECK, now that every published row carries a publication
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
language sql stable security definer as $$
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
language plpgsql security definer as $$
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
-- WITHDRAWN PUBLICATIONS ARE EXCLUDED (sec 5 and Ruling 5 both say
-- `withdrawn_at is null`; the Phase 3 API Contract's prose says the opposite,
-- and the work-log records the conflict and this resolution). `withdrawn_at`
-- and its two provenance companions are nevertheless RETAINED IN THE RETURN
-- SIGNATURE — `withdrawn_at` as the API Contract specifies it, plus
-- `withdrawn_by` and `withdrawn_minute_reference` per the 2026-09-24 external
-- review — so that a later decision to surface withdrawn rows is a one-line
-- change to the WHERE clause rather than a signature change every caller has
-- to follow, and so that when it happens the recipient sees WHO withdrew and
-- under which minute rather than merely that something vanished. Under the
-- filter as written all three are always null, and that is stated here rather
-- than left for a reader to discover.
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
language sql stable security definer as $$
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
    and p.withdrawn_at is null
    and (p_about_org_id is null or r.about_org_id = p_about_org_id)
    and (p_year is null or r.report_year = p_year)
  order by r.report_year desc, p.published_at desc;
$$;

revoke all on function presby_list_published_returns_to_me(uuid, integer) from public;
grant execute on function presby_list_published_returns_to_me(uuid, integer) to presby_app;

comment on function presby_list_published_returns_to_me(uuid, integer) is
  'The recipient side of a publication (Ruling 5 / DECISION-135). Returns the artifact behind every non-withdrawn publication addressed to presby_current_org(), joined through the composite (artifact_id, organization_id) FK. Takes no council id: the caller is the GUC, never a parameter. Filters on the recorded publication rather than on live affiliation, so a dissolved congregation''s returns stay readable by the council that received them (G-3.0107).';

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
