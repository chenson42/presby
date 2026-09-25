-- Organization lifecycle, succession topology, and council affiliation
-- (D10 / D19 / D26) — increment 2 of the lifecycle/affiliation/returns
-- pipeline (docs/work-log/2026-09-24-lifecycle-affiliation-returns.md,
-- Phase 3 Data Model "Increment 2"; DECISION-135 through DECISION-139;
-- docs/schema-design-2.md sec 2b/sec 2c F38-F41, sec 3).
--
-- This is the pipeline's riskiest migration and it lands as ONE file, in the
-- order Phase 3 specifies, ending with a backfill-completeness assertion that
-- must hold before the migration commits.
--
-- What it does:
--
--   1. `organizations` gains lifecycle_status / lifecycle_as_of /
--      deletable_until.
--   2. `organization_lifecycle_events` — the minuted acts of G-3.0301(a)
--      (organizing, receiving, merging, dismissing, dissolving a
--      congregation), G-3.0403(c) (a synod on a presbytery) and G-3.0502(d)
--      (the GA on a synod). Append-only; the status column it replaces was
--      editable and remembered nothing.
--   3. `organization_successions` — pure topology (who became whom), with a
--      DEFERRED constraint trigger for per-event cardinality.
--   4. `organization_affiliations` — the THIRD axis: which council a body
--      belongs to, WITH HISTORY. `organizations.parent_id` and
--      `organizations.path` become a derived cache of the currently-open
--      affiliation row and are no longer writable by anyone directly.
--   5. The write path: `presby_transfer_affiliation()`, the
--      `presby_publish_sasr_snapshot()` shape (DECISION-135). No
--      acting-council parameter; the actor is `presby_current_org()`.
--   6. The read path: `presby_org_affiliated()` and
--      `presby_affiliation_parent_as_of()`, both shipped HERE rather than in
--      increment 3 (DECISION-139) because the write path's own standing
--      check depends on the second of them.
--   7. The grant model this design rests on, MADE TRUE rather than assumed
--      (F38, below).
--   8. The affiliation backfill for every org that carries a parent_id
--      today, `effective_from` NULL = unbounded-below (F41).
--   9. CORRECTION, 2026-09-24 (Ruling A5 of the Phase 3 amendment after
--      batch A; DECISION-135's dated correction note): `presby_platform` is
--      narrowed to `select, insert` on `organization_lifecycle_events` and
--      `organization_affiliations` (it had full DML, which Ruling 3 never
--      asked for), and `presby_freeze_lifecycle_event()` refuses UPDATE and
--      DELETE on the lifecycle-events table on EVERY connection, owner
--      included — append-only-by-grant binds the two application roles, not
--      the owner, and the owner path is the one that matters. Applied as a
--      change to THIS file, not a new migration number: it completes
--      increment 2 correctly and the file re-applies idempotently.
--  10. CORRECTION, 2026-09-24 (Phase 5 Finding 1, QA; loop-back disposition
--      recorded in the work-log's Phase 5 section): `organization_successions`
--      is brought under Phase 2 Ruling 1's rule — "cross-council access to the
--      three-axis tables is function-mediated, never policy-mediated."
--      `presby_app` loses INSERT and DELETE (it never held UPDATE) and keeps
--      SELECT, `presby_platform` is narrowed to select+insert (batch B's
--      finding 5), and two triggers land: an event-scope BEFORE INSERT check
--      and a BEFORE UPDATE OR DELETE freeze. Applied as a change to THIS file,
--      not a new migration number, for the same reason item 9 was.
--
-- ---------------------------------------------------------------------------
-- WHY EVERY TRIGGER HERE THAT WRITES organizations IS `SECURITY DEFINER`
-- ---------------------------------------------------------------------------
-- F38, verified against the live development branch before this file was
-- written: `presby_app` held INSERT, UPDATE, DELETE and SELECT on
-- `organizations`, which has neither RLS nor a single trigger.
-- drizzle/0009_presby_rls.sql:93's `grant select on organizations to
-- presby_app` is ADDITIVE — it never revoked anything, and a blanket
-- platform-table grant swept `organizations` in with `users`/`sessions`.
-- `people` (0009:376) was the only table ever explicitly clawed back.
--
-- This migration revokes INSERT/UPDATE/DELETE on `organizations` from
-- `presby_app` (bottom of this file). AFTER that revoke, every trigger
-- function here that writes `parent_id`, `path`, `lifecycle_status` or
-- `lifecycle_as_of` needs `SECURITY DEFINER` **for grant reasons alone** —
-- independently of F26's cross-org-read reasoning. DECISION-121's warning
-- applies in reverse here: the risk is not cargo-culting DEFINER on, it is a
-- later reader stripping DEFINER off `presby_apply_lifecycle_event()`
-- because "that one isn't cross-org." It is not cross-org. It still cannot
-- run without DEFINER.
--
-- ---------------------------------------------------------------------------
-- WHY `organization_affiliations` DML IS REVOKED FROM presby_app (F40)
-- ---------------------------------------------------------------------------
-- A UNIQUE or EXCLUDE constraint is enforced against ALL rows, not the
-- RLS-visible subset. With ordinary tenant DML, Presbytery B could probe
-- `insert (subject => <any org id>, parent => itself, ...)` and learn from
-- the constraint-violation error whether that organization has an open
-- affiliation ANYWHERE — a row B cannot see. That is DECISION-047's
-- enumeration-oracle class arriving through a constraint instead of a page.
-- The DEFINER function is therefore the ONLY writer, it checks standing
-- first, and every rejection raises ONE literal string
-- (`presby_deny_affiliation_change()`) so no cause is distinguishable from
-- any other — DECISION-040's byte-identical discipline applied to a function.
--
-- Hand-written per CLAUDE.md: Drizzle Kit emits no RLS, no trigger, no
-- SECURITY DEFINER function, no EXCLUDE constraint and no revoke. Every
-- statement is idempotent.
--
-- Migration-numbering note: `ls drizzle/` was run immediately before 0043
-- and this file was written in the same pass; 0042 was the highest claimed
-- number on disk, 0043 and 0044 are claimed together and both journal
-- entries are added in the same edit.

create extension if not exists btree_gist;  -- idempotent; already installed
                                            -- (drizzle/0009:471, 0039:120)

-- ---------------------------------------------------------------------------
-- 1. organizations: lifecycle cache + the fixture-deletion window
-- ---------------------------------------------------------------------------
alter table organizations add column if not exists lifecycle_status text not null default 'active';
alter table organizations add column if not exists lifecycle_as_of date;
alter table organizations add column if not exists deletable_until timestamptz;

alter table organizations drop constraint if exists organizations_lifecycle_status_allowed;
alter table organizations add constraint organizations_lifecycle_status_allowed
  check (lifecycle_status in ('active', 'merged', 'divided', 'dismissed', 'dissolved'));

comment on column organizations.lifecycle_status is
  'CACHE of the most recent organization_lifecycle_events row for this org, maintained by presby_apply_lifecycle_event(). The events table is the system of record; this column cannot answer a historical question. Replaces the editable `status` column conceptually — `status` itself still exists because five shipped public-site SECURITY DEFINER functions still read it (see drizzle/0043''s header).';
comment on column organizations.deletable_until is
  'Test-fixture deletion window, and NOTHING else. presby_guard_organizations_delete() permits a DELETE only while this is non-null and in the future, so a stale marker does not grant permanent deletability. Deliberately NOT folded into platform_status (D9''s tenant-participation axis) — mixing a test-lifecycle concern into that column would change the meaning of every platform_status query in presby_user_organizations() and the org chooser.';

-- ---------------------------------------------------------------------------
-- 2. organization_lifecycle_events
-- ---------------------------------------------------------------------------
create table if not exists organization_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  -- The ACTING council (the presbytery that dissolved, the synod that
  -- divided). Tenant scope for RLS.
  organization_id uuid not null references organizations(id),
  -- The body acted upon. PLAIN FK, the about-org structural exception
  -- (docs/schema-design.md sec 17) — never composite.
  subject_org_id uuid not null references organizations(id),
  event text not null,
  effective_on date not null,
  minute_reference text not null,
  -- GA concurrence on a synod act (G-3.0502(e)) is recorded as DATA, never
  -- as a second actor — the actor rule stays one-level-above (Ruling 8).
  concurrence_reference text,
  -- Required for received/dismissed (the counterparty outside this system),
  -- null otherwise.
  external_body text,
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now(),
  notes text,
  constraint organization_lifecycle_events_id_org_key unique (id, organization_id),
  constraint organization_lifecycle_events_event_allowed
    check (event in ('organized', 'received', 'merged', 'divided', 'dismissed', 'dissolved')),
  constraint organization_lifecycle_events_not_self
    check (organization_id <> subject_org_id),
  constraint organization_lifecycle_events_external_body_shape
    check ((event in ('received', 'dismissed')) = (external_body is not null))
);

create index if not exists organization_lifecycle_events_org_idx
  on organization_lifecycle_events (organization_id);
create index if not exists organization_lifecycle_events_subject_idx
  on organization_lifecycle_events (subject_org_id, effective_on);

alter table organization_lifecycle_events enable row level security;
alter table organization_lifecycle_events force row level security;

drop policy if exists tenant_isolation on organization_lifecycle_events;
create policy tenant_isolation on organization_lifecycle_events
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- APPEND-ONLY, resolving Phase 3's explicitly-open call ("whether it needs
-- its own freeze trigger or relies on convention is a Phase 4
-- implementation call"). A minuted act is corrected by recording another
-- act, the roll_actions/void precedent.
--
-- CORRECTED 2026-09-24 (tech-lead Phase 3 amendment after batch A, Ruling
-- A5; DECISION-135's dated correction note). The first build of this file
-- resolved append-only BY GRANT ALONE — no UPDATE/DELETE to presby_app —
-- and reasoned that a freeze trigger would be belt-and-braces over an
-- absent grant. That reasoning is sound for presby_app and INSUFFICIENT for
-- the database as a whole, for two reasons this same migration already
-- establishes elsewhere:
--
--   1. presby_platform (the getPlatformDb() connection) was granted full
--      select, insert, update, delete here. Phase 3's Ruling 3 only ever
--      required INSERT (createOrganization()'s affiliation row, on the
--      OTHER table). A SECURITY DEFINER function runs with its OWNER's
--      privileges regardless of what its caller holds, so
--      presby_transfer_affiliation() never needed that widening — it bought
--      nothing and reopened, on the connection with the most reach, exactly
--      the "a raw mutation bypasses the function's authority check, the
--      uniform-message discipline and the provenance rule" hole
--      DECISION-135's function-mediation rule exists to close.
--   2. A grant is not a guarantee against the OWNER. neondb_owner is
--      BYPASSRLS and holds every privilege by ownership; presby_guard_
--      organizations_delete() in section 14 of this same file already names
--      why that is the path that matters ("BYPASSRLS exempts a role from
--      RLS POLICIES, never from TRIGGERS" — the 2026-08-31 58-org cascade
--      went through getPlatformDb(), not a tenant connection).
--
-- So: the grant is narrowed to select, insert on BOTH roles, AND
-- presby_freeze_lifecycle_event() (section 12 below) refuses UPDATE and
-- DELETE on every connection, owner included — the roll_actions_freeze
-- standard (drizzle/0009:358-373), not a substitute for the grant.
--
-- NARROWED AGAIN 2026-09-25: presby_app is SELECT-ONLY. The INSERT grant
-- above outlived its justification. It was written when this table's INSERT
-- was policy-mediated; F54/DECISION-141 made INSERT function-mediated (the
-- presby.lifecycle_write_active guard, section 12a), and Phase 2 Ruling 1
-- already settled that cross-council access to the three-axis tables is
-- "function-mediated, never policy-mediated". The future writer,
-- presby_record_lifecycle_event(), is SECURITY DEFINER and runs with the
-- owner's privileges whatever its caller holds — exactly the argument point 1
-- above makes about presby_platform — so the tenant grant buys that function
-- nothing, and no application path inserts here today (searched: no
-- non-test, non-dev-docs reference in src/). It is the same shape
-- organization_successions has carried since Phase 5 Finding 1: SELECT for
-- presby_app, select+insert for presby_platform, the two lifecycle tables
-- finally consistent with each other.
--
-- TWO CONSEQUENCES, both deliberate and both load-bearing elsewhere in this
-- file, so they are stated here rather than discovered later:
--   * presby_deny_lifecycle_change() and presby_lifecycle_event_cardinality_
--     check() lose their presby_app EXECUTE grants (section 6 and section
--     13b). They were granted ONLY because an INVOKER guard/trigger reached
--     them on a tenant INSERT. With no INSERT on either lifecycle table,
--     presby_app can no longer fire either path. If a future ruling
--     re-grants INSERT here, BOTH grants must come back with it or the
--     uniform rejection literal degrades to `permission denied for function`
--     and the deferred cardinality check fails with the wrong error.
--   * scripts/test-rls.sql can no longer exercise this table's triggers or
--     CHECKs at all — the grant refuses first. Those probes moved to
--     src/lib/db/domain/lifecycle.test.ts (owner connection), the same move
--     section 32(j) already records for the succession cardinality proofs.
revoke insert, update, delete on organization_lifecycle_events from presby_app;
revoke update, delete on organization_lifecycle_events from presby_platform;
grant select on organization_lifecycle_events to presby_app;
grant select, insert on organization_lifecycle_events to presby_platform;

comment on table organization_lifecycle_events is
  'Minuted lifecycle acts on an organization: G-3.0301(a) for a presbytery acting on a congregation or NWC, G-3.0403(c) for a synod on a presbytery, G-3.0502(d) for the GA on a synod. APPEND-ONLY on every connection: no UPDATE/DELETE grant to presby_app or presby_platform, and presby_freeze_lifecycle_event() refuses both on the owner path too (the roll_actions_freeze standard). presby_app is SELECT-ONLY as of 2026-09-25 — INSERT is function-mediated (presby.lifecycle_write_active, F54/DECISION-141) and the future presby_record_lifecycle_event() is SECURITY DEFINER, so the tenant grant bought it nothing. Correct a recorded act by recording another act. organizations.lifecycle_status is a cache of this table, never the record.';

-- ---------------------------------------------------------------------------
-- 3. organization_successions
-- ---------------------------------------------------------------------------
-- Pure topology, deliberately carrying NO organization_id. A single
-- merged_into_org_id column on `organizations` cannot express 1->N or N->1,
-- which is D10's whole reason for a table.
--
-- WHAT THE ABSENT organization_id DOES AND DOES NOT BUY, CORRECTED 2026-09-24
-- (Phase 5 Finding 1). The first build of this file said "visibility follows
-- the parent event's tenant policy through a join." That is true of a READ
-- that actually performs the join and false of everything else, and QA
-- demonstrated the difference in a rolled-back transaction: as one council,
-- insert a lifecycle event; switch `app.current_org_id` to an unrelated
-- congregation; `select ... from organization_lifecycle_events where id = <that
-- event>` returns 0 rows — and the very next `insert into
-- organization_successions (event_id => <that same invisible event>, ...)`
-- SUCCEEDED. A WRITE joins nothing. The FK checks existence, not visibility
-- (it is enforced against ALL rows, the same property F40 names for the
-- EXCLUDE constraint on organization_affiliations), and the deferred
-- cardinality trigger in section 13 constrains SHAPE, not OWNERSHIP. So a
-- council could write — and, with the DELETE grant, remove — succession rows
-- against a minuted act it cannot read. The confidentiality half is small
-- (topology is public; the org tree already publishes who became whom, and
-- SELECT stays open for exactly that reason). The INTEGRITY half is not: the
-- rows attached to another council's minuted act are that act's content.
--
-- THE FIX, and why append-only-by-grant was not enough on its own. Section 2
-- resolved the lifecycle-events table with a grant plus a freeze trigger.
-- Here the grant alone would still have left INSERT open to every tenant (the
-- table needs SOME writer), and an INSERT is precisely the verb QA exploited.
-- So this table gets the Ruling 1 treatment instead:
--
--   * `presby_app`: SELECT only. No tenant connection writes this table by
--     any verb. The future `presby_record_lifecycle_event()` SECURITY DEFINER
--     function — the lifecycle-UI pipeline's, one family with the deferred
--     `presby_organize_congregation()` named in Phase 2 Ruling 3 — becomes
--     the ONLY tenant-side writer, and it will record the event and its
--     succession rows in one body, having checked standing first, exactly as
--     presby_transfer_affiliation() does for affiliations. Do not re-grant
--     INSERT here to give that pipeline a shortcut; the shortcut is the bug.
--   * `presby_platform`: select + insert (batch B's finding 5 — it held
--     UPDATE, which nothing ever asked for; no caller exists at all today,
--     and INSERT is kept only so a future createOrganization()-class
--     provisioning path is not blocked on a migration).
--   * presby_check_succession_event() (section 13) rejects an INSERT naming
--     an event the current org does not own, with the SAME uniform literal
--     presby_deny_lifecycle_change() raises for every other lifecycle
--     rejection, so "no such event" and "not your event" are byte-identical
--     (DECISION-139 / DECISION-040's discipline). It is the belt to the
--     grant's braces, and it is what protects the DEFINER writer from itself:
--     a function running as owner has no grant stopping it.
--   * presby_freeze_succession() (section 13) refuses UPDATE and DELETE on
--     EVERY connection, owner included — the section-2/roll_actions standard.
--     A succession row is the content of a minuted act and is corrected the
--     same way the act is: by recording another act.
create table if not exists organization_successions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references organization_lifecycle_events(id) on delete cascade,
  predecessor_org_id uuid not null references organizations(id),
  successor_org_id uuid not null references organizations(id),
  constraint organization_successions_not_self
    check (predecessor_org_id <> successor_org_id)
);

create index if not exists organization_successions_event_idx
  on organization_successions (event_id);

-- ADDED 2026-09-24 (F48 / DECISION-140, fourth Phase 3 loop-back). The same
-- edge recorded twice under one event is not two facts; it is one fact
-- written twice. Added as a named constraint swap rather than inline so a
-- database that already has the table from an earlier run converges.
--
-- IT IS NOT CLOSING A CARDINALITY-GAMING BUG, and saying so matters so a
-- future reader does not assume the cardinality trigger was ever weak:
-- presby_check_succession_cardinality() (section 13) counts
-- `count(distinct predecessor_org_id)` / `count(distinct successor_org_id)`,
-- so a duplicate edge could never have inflated a `merged` event's
-- two-predecessor requirement. This is data integrity in its own right.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_successions_edge_unique'
  ) then
    alter table organization_successions
      add constraint organization_successions_edge_unique
      unique (event_id, predecessor_org_id, successor_org_id);
  end if;
end $$;

revoke insert, update, delete on organization_successions from presby_app;
grant select on organization_successions to presby_app;
revoke update, delete on organization_successions from presby_platform;
grant select, insert on organization_successions to presby_platform;

comment on table organization_successions is
  'Pure topology: who became whom (D10). No organization_id and no policy of its own — SELECT is open to both roles because topology is public, the same call `organizations` itself makes. WRITES ARE NOT policy-mediated and never were: an INSERT joins nothing, so the absent organization_id bought no write protection (Phase 5 Finding 1). presby_app holds SELECT ONLY; the future presby_record_lifecycle_event() SECURITY DEFINER function is the sole tenant-side writer. presby_check_succession_event() rejects an INSERT naming an event the current org does not own, with the uniform lifecycle literal, and presby_freeze_succession() refuses UPDATE and DELETE on every connection including the owner.';

-- ---------------------------------------------------------------------------
-- 4. organization_affiliations — the third axis
-- ---------------------------------------------------------------------------
create table if not exists organization_affiliations (
  id uuid primary key default gen_random_uuid(),
  -- The RECORDING council. This is PROVENANCE and never changes: a closed
  -- row keeps the organization_id of whoever recorded it, because re-owning
  -- it to the closing synod would rewrite who acted in 1994.
  organization_id uuid not null references organizations(id),
  -- ON DELETE CASCADE is attached below, as a named constraint swap.
  subject_org_id uuid not null references organizations(id),
  parent_org_id uuid not null references organizations(id),
  relationship_type text not null,
  -- NULLABLE, and null means UNBOUNDED BELOW ("predates our records") — F41.
  -- A backfill with a bounded lower edge would make
  -- presby_org_affiliated(as_of => 1987) false for the entire 41-year PSV
  -- archive and block the import the about-org trigger exists to protect.
  effective_from date,
  effective_to date,          -- null = current/open
  authority text not null default 'recorded',
  reason text,
  minute_reference text,
  concurrence_reference text,
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  -- The close is an attributable act by (often) a DIFFERENT council than the
  -- one that owns the row. Without these four columns it is an
  -- unattributable mutation of a provenanced record.
  closed_by_org_id uuid references organizations(id),
  closed_by uuid references users(id),
  closed_on date,
  closed_minute_reference text,
  constraint organization_affiliations_id_org_key unique (id, organization_id),
  constraint organization_affiliations_relationship_type_allowed
    check (relationship_type in ('member_congregation', 'member_presbytery',
                                 'member_synod', 'member_nwc')),
  constraint organization_affiliations_authority_allowed
    check (authority in ('recorded', 'backfill')),
  -- A minute-less row can only ever be an inferred one, so an inferred
  -- relationship can never be mistaken for a minuted act.
  constraint organization_affiliations_backfill_minute_shape
    check (authority = 'backfill' or minute_reference is not null),
  constraint organization_affiliations_no_overlap
    exclude using gist (
      subject_org_id with =,
      relationship_type with =,
      daterange(effective_from, effective_to, '[)') with &&
    )
);

-- subject_org_id CASCADES, alone among the four organization FKs on this
-- table. An organization's own affiliation history is meaningless once the
-- row it describes is gone, and the only DELETE that can reach
-- `organizations` at all is a `deletable_until`-stamped test fixture (see
-- presby_guard_organizations_delete below) — without the cascade, every
-- hierarchical fixture teardown in the DB-backed suite would fail on this
-- FK instead of cleaning up. organization_id (the recording council) and
-- parent_org_id stay RESTRICT deliberately: a council that still owns or
-- parents live records should refuse to disappear loudly.
-- Written as an explicit drop/add rather than inline so a database that
-- already has the table from an earlier run of this migration converges.
alter table organization_affiliations
  drop constraint if exists organization_affiliations_subject_org_id_fkey;
alter table organization_affiliations
  add constraint organization_affiliations_subject_org_id_fkey
  foreign key (subject_org_id) references organizations(id) on delete cascade;

-- ROW-SHAPE CONSTRAINTS ADDED 2026-09-24 (F49 / DECISION-140, fourth Phase 3
-- loop-back). Written as idempotent adds rather than inline in the `create
-- table if not exists` above, because that statement is a no-op on a database
-- that already ran an earlier form of this migration — the same pattern the
-- FK swap directly above uses, and the one drizzle/0047 uses for
-- publications_withdrawal_shape. They are placed BEFORE the backfill in
-- section 5 deliberately: the backfill must be proven to satisfy them, not
-- exempted from them.
--
-- CHECK constraints bind the TABLE OWNER, unlike RLS policies and unlike
-- grants (F44 does not exempt them), so these three close their holes on
-- getPlatformDb() as well as on presby_app.
do $$
begin
  -- The empty-range loophole. daterange(d, d, '[)') is a VALID, EMPTY range:
  -- it overlaps nothing, so organization_affiliations_no_overlap (the GIST
  -- EXCLUDE above) accepts any number of them. An affiliation that was never
  -- in effect for a single day is not a fact about the church.
  if not exists (
    select 1 from pg_constraint where conname = 'organization_affiliations_range_order'
  ) then
    alter table organization_affiliations
      add constraint organization_affiliations_range_order
      check (effective_to is null
             or effective_from is null
             or effective_to > effective_from);
  end if;

  -- A close is an ATTRIBUTABLE ACT: either the row is open and carries no
  -- close attribution at all, or it is closed and carries all of it.
  --
  -- DEVIATION FROM THE EXTERNAL REVIEW'S LITERAL TEXT, and it is load-bearing:
  -- the review wrote "all four closed_* provenance fields", but `closed_by`
  -- (the acting USER) is permanently null on every close by design — this
  -- platform has no app.current_user_id GUC, only app.current_org_id (Ruling
  -- A4), so presby_transfer_affiliation() writes `closed_by = null`
  -- explicitly. A CHECK demanding it would reject every legitimate close the
  -- system can currently perform. closed_by is excluded ON PURPOSE; it joins
  -- the tuple the day the acting-user GUC lands.
  if not exists (
    select 1 from pg_constraint where conname = 'organization_affiliations_closed_shape'
  ) then
    alter table organization_affiliations
      add constraint organization_affiliations_closed_shape
      check ((effective_to is null
              and closed_by_org_id is null
              and closed_on is null
              and closed_minute_reference is null)
          or (effective_to is not null
              and closed_by_org_id is not null
              and closed_on is not null
              and closed_minute_reference is not null));
  end if;

  -- A body cannot be its own council. The type rule in
  -- presby_assert_council_authority() already rejects actor = subject, but
  -- that is a TRIGGER on INSERT; this binds every write path including a
  -- later UPDATE and the owner's own.
  if not exists (
    select 1 from pg_constraint where conname = 'organization_affiliations_not_self'
  ) then
    alter table organization_affiliations
      add constraint organization_affiliations_not_self
      check (subject_org_id <> parent_org_id);
  end if;
end $$;

-- NOT ADDED, and this is a deliberate departure from F49's fourth CHECK
-- rather than an omission — see the work-log's "Loop-back after external
-- implementation review" Implementer Notes.
--
--   organization_affiliations_recorded_has_from
--     check (authority <> 'recorded' or effective_from is not null)
--
-- Its stated premise ("only 'backfill' rows are null — F41") is false in this
-- repository. A MINUTED historical affiliation whose start predates the
-- surviving records is a real, deliberate, currently-asserted shape:
--   scripts/seed-dev.sql:104-108   Quillhaven's pre-1995 row — authority
--                                  'recorded', a real Southern Fields minute,
--                                  effective_from NULL
--   scripts/test-rls.sql:2972-2977 asserts, with an explicit F41 comment,
--                                  that presby_org_affiliated(quillhaven,
--                                  southern-fields, 1899-01-01) is TRUE —
--                                  which is only true while that row's lower
--                                  bound is unbounded
--   src/lib/db/domain/lifecycle.test.ts:125-135  the same shape again
-- Adding the CHECK would force those rows to authority = 'backfill', which
-- 0044's own comment defines as "nobody claims a minute for it" — relabelling
-- a minuted act as an inference to satisfy a constraint about provenance
-- completeness. F41 ("null means unbounded below, predates our records") and
-- this CHECK ("a minuted act must state its start") are in genuine tension
-- and only Phase 3 can resolve which one yields. Flagged as a loop-back
-- candidate; the other three CHECKs above are unaffected and ship.

create index if not exists organization_affiliations_org_idx
  on organization_affiliations (organization_id);
create index if not exists organization_affiliations_subject_idx
  on organization_affiliations (subject_org_id, effective_to);
create index if not exists organization_affiliations_parent_idx
  on organization_affiliations (parent_org_id);

alter table organization_affiliations enable row level security;
alter table organization_affiliations force row level security;

drop policy if exists tenant_isolation on organization_affiliations;
create policy tenant_isolation on organization_affiliations
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

comment on table organization_affiliations is
  'Which council a body belongs to, with history (D19/D26). organizations.parent_id and organizations.path are a DERIVED CACHE of the currently-open row here and are maintained only by presby_apply_affiliation_to_org_tree(). presby_app holds SELECT only: the DEFINER function presby_transfer_affiliation() is the sole write path (F40 — an EXCLUDE constraint on a FORCE-RLS table is a cross-tenant existence oracle).';

-- The (subject, parent, type, range) projection, with no reason/minute/notes
-- on it. Shipped now so a future cross-council read has a bounded surface
-- that is not the base table.
--
-- DELIBERATELY NOT `security_invoker`. A plain view runs with its OWNER's
-- privileges, so this one sees past organization_affiliations' tenant policy
-- — which is the point, and is the same call `organizations` itself already
-- makes: who belongs to which council is public information (PC(USA)
-- publishes presbytery rosters). What is NOT public is the acting council's
-- own record of WHY, so `reason`, `minute_reference`, `concurrence_reference`
-- and the `closed_*` attribution are absent from the projection and must stay
-- absent. Widening this column list is a policy change, not a convenience.
create or replace view organization_affiliations_public as
  select subject_org_id, parent_org_id, relationship_type, effective_from, effective_to
    from organization_affiliations;
grant select on organization_affiliations_public to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 5. BACKFILL — one affiliation row per org that carries a parent_id today
-- ---------------------------------------------------------------------------
-- Run BEFORE the authority trigger is created, deliberately: the backfill
-- states what the database already believes, and historical data must not be
-- refused by a rule written today. `effective_from` is null (unbounded
-- below, F41); `authority = 'backfill'` and a null minute_reference say, in
-- the schema itself, that nobody claims a minute for it.
insert into organization_affiliations
  (organization_id, subject_org_id, parent_org_id, relationship_type,
   effective_from, effective_to, authority, minute_reference, recorded_at)
select o.parent_id, o.id, o.parent_id,
       case o.organization_type
         when 'congregation' then 'member_congregation'
         when 'new_worshiping_community' then 'member_nwc'
         when 'presbytery' then 'member_presbytery'
         when 'synod' then 'member_synod'
       end,
       null, null, 'backfill', null, now()
  from organizations o
 where o.parent_id is not null
   and not exists (
     select 1 from organization_affiliations a
      where a.subject_org_id = o.id and a.effective_to is null
   );

-- ---------------------------------------------------------------------------
-- 6. The uniform rejection helpers (F40 / DECISION-139)
-- ---------------------------------------------------------------------------
-- One literal string per table, in exactly one place in the codebase, so it
-- cannot drift between call sites and so a probing caller cannot tell "you
-- are not authorized" from "that organization has no open affiliation" from
-- "that id does not exist."
create or replace function presby_deny_affiliation_change()
returns void language plpgsql as $$
begin
  raise exception 'organization_affiliations: this change is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

create or replace function presby_deny_lifecycle_change()
returns void language plpgsql as $$
begin
  raise exception 'organization_lifecycle_events: this change is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

-- B-M1 (security review 2026-09-25 sec B, applied 2026-09-25). A function
-- that only ever runs INSIDE another function or a trigger needs no EXECUTE
-- grant to any application role: the caller that reaches it is either a
-- SECURITY DEFINER function (running as the owner) or the trigger machinery
-- itself, which checks EXECUTE when the trigger is CREATED, never when it
-- fires. Granting it anyway widens the tenant connection's reachable surface
-- for nothing. `revoke ... from presby_app` is written explicitly rather than
-- by deleting the old grant line, because these files are re-applied in place
-- on a database that already ran the earlier form.
--
-- BOTH HELPERS ARE REVOKED, and the second one only became revocable on
-- 2026-09-25. Every caller was enumerated rather than assumed:
--   * presby_deny_affiliation_change() — callers are presby_transfer_
--     affiliation(), presby_apply_affiliation_to_org_tree() and
--     presby_assert_council_authority() (all SECURITY DEFINER, all running as
--     the owner) and presby_guard_organization_affiliations() /
--     presby_guard_organizations_insert() / _reparent() (INVOKER, but
--     presby_app holds SELECT only on both organization_affiliations and
--     organizations, so it cannot fire any of them).
--   * presby_deny_lifecycle_change() — callers are presby_assert_council_
--     authority() and presby_check_succession_event() (SECURITY DEFINER) and
--     presby_guard_lifecycle_write() (INVOKER, section 12a). That last one
--     was reachable by presby_app until the INSERT grant on
--     organization_lifecycle_events was revoked in section 2 of this file on
--     2026-09-25; with SELECT only on BOTH lifecycle tables, no tenant DML
--     can reach it.
--
-- THE COUPLING IS EXPLICIT, because it is the kind that rots quietly: this
-- revoke is valid ONLY while presby_app holds no INSERT on either lifecycle
-- table. Re-grant INSERT there and this grant must come back in the same
-- migration, or the table's uniform rejection literal (DECISION-139/F40)
-- degrades to `permission denied for function presby_deny_lifecycle_change`
-- — a different string carrying the same errcode, which is exactly the
-- byte-identical-message regression F40 exists to prevent.
revoke all on function presby_deny_affiliation_change() from public;
revoke all on function presby_deny_lifecycle_change() from public;
revoke execute on function presby_deny_affiliation_change() from presby_app;
revoke execute on function presby_deny_lifecycle_change() from presby_app;
-- presby_platform KEEPS (in fact gains) execute, and for the reason presby_app
-- lost it: presby_platform still holds INSERT on both lifecycle tables, so a
-- real, non-owner presby_platform login WOULD reach presby_guard_lifecycle_
-- write() and must be able to raise the table's own literal rather than a
-- privilege error. Inert today — PLATFORM_DATABASE_URL authenticates as
-- neondb_owner, which owns the function (F44) — and a statement of intent for
-- the day it is not.
grant execute on function presby_deny_lifecycle_change() to presby_platform;

-- ---------------------------------------------------------------------------
-- 7. presby_assert_council_authority()
-- ---------------------------------------------------------------------------
-- One level above, and no further (Ruling 8):
--   presbytery       -> congregation | new_worshiping_community  G-3.0301(a)
--   synod            -> presbytery                               G-3.0403(c)
--   general_assembly -> synod                                    G-3.0502(d)
-- Both types live on `organizations`, so this cannot be a CHECK.
--
-- DEVIATION FROM PHASE 3, and it is load-bearing. Phase 3's API Contract has
-- this function raise the LIFECYCLE literal always, and has
-- presby_transfer_affiliation() call it as
-- `presby_assert_council_authority(v_actor, subject)`. Both are wrong:
--   (a) raising the lifecycle literal from inside the affiliation write path
--       would distinguish one rejection cause from the others, which is
--       precisely what F40's uniform message exists to prevent. Hence the
--       p_context parameter.
--   (b) checking ACTOR-against-subject inside the affiliation path makes
--       D19's headline scenario unbuildable: in a redistricting the actor is
--       the synod and the subject is a congregation — two levels apart — so
--       the one-level rule would reject the very transfer Ruling 1 exists to
--       enable. On an affiliation row the rule that belongs here is
--       PARENT-fits-CHILD (`parent_org_id` vs `subject_org_id`); the actor's
--       standing is a separate, and different, check inside
--       presby_transfer_affiliation(). On a lifecycle event the acting
--       council IS the one-level-above body, so there the call passes
--       organization_id. Recorded in the work-log's Implementer Notes.
create or replace function presby_assert_council_authority(
  p_actor_org_id uuid,
  p_subject_org_id uuid,
  p_context text default 'organization_affiliations'
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_type   organization_type;
  v_subject_type organization_type;
begin
  select organization_type into v_actor_type from organizations where id = p_actor_org_id;
  select organization_type into v_subject_type from organizations where id = p_subject_org_id;

  if p_actor_org_id is null
     or p_subject_org_id is null
     or p_actor_org_id = p_subject_org_id
     or v_actor_type is null
     or v_subject_type is null
     or not (
       (v_actor_type = 'presbytery'
          and v_subject_type in ('congregation', 'new_worshiping_community'))
       or (v_actor_type = 'synod' and v_subject_type = 'presbytery')
       or (v_actor_type = 'general_assembly' and v_subject_type = 'synod')
     )
  then
    if p_context = 'organization_lifecycle_events' then
      perform presby_deny_lifecycle_change();
    else
      perform presby_deny_affiliation_change();
    end if;
  end if;
end $$;

-- B-M1: trigger-only. Both callers (presby_check_lifecycle_authority and
-- presby_check_affiliation_authority, section 11/12) are SECURITY DEFINER, so
-- this runs as the owner however it is reached; no application code calls it,
-- and scripts/test-rls.sql reaches it only THROUGH the triggers.
revoke all on function presby_assert_council_authority(uuid, uuid, text) from public;
revoke execute on function presby_assert_council_authority(uuid, uuid, text) from presby_app;

-- ---------------------------------------------------------------------------
-- 8. The read path: presby_affiliation_parent_as_of() / presby_org_affiliated()
-- ---------------------------------------------------------------------------
-- Both ship HERE, in increment 2, not increment 3 (DECISION-139):
-- presby_transfer_affiliation()'s own standing check calls the first, so it
-- cannot ship later than the function that calls it. Both are bounded to the
-- public-projection columns — no reason/minute_reference/notes can leak
-- through either.
create or replace function presby_affiliation_parent_as_of(
  p_subject_org_id uuid,
  p_as_of date
) returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.parent_org_id
    from organization_affiliations a
   where a.subject_org_id = p_subject_org_id
     and daterange(a.effective_from, a.effective_to, '[)') @> p_as_of
   limit 1;
$$;

-- "Is the subject affiliated with this council as of that date" means the
-- council is somewhere in the subject's ANCESTRY on that date — not that the
-- council recorded the row. A synod-level about-org check is three levels
-- down, so this walks the chain. Depth-capped so a cycle introduced by a bad
-- write can never hang a request.
create or replace function presby_org_affiliated(
  p_subject_org_id uuid,
  p_council_org_id uuid,
  p_as_of date
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  with recursive ancestry as (
    select a.parent_org_id as org_id, 1 as depth
      from organization_affiliations a
     where a.subject_org_id = p_subject_org_id
       and daterange(a.effective_from, a.effective_to, '[)') @> p_as_of
    union all
    select a.parent_org_id, an.depth + 1
      from ancestry an
      join organization_affiliations a
        on a.subject_org_id = an.org_id
       and daterange(a.effective_from, a.effective_to, '[)') @> p_as_of
     where an.depth < 8
  )
  select exists (select 1 from ancestry where org_id = p_council_org_id);
$$;

revoke all on function presby_affiliation_parent_as_of(uuid, date) from public;
revoke all on function presby_org_affiliated(uuid, uuid, date) from public;
grant execute on function presby_affiliation_parent_as_of(uuid, date) to presby_app;
grant execute on function presby_org_affiliated(uuid, uuid, date) to presby_app;

-- ---------------------------------------------------------------------------
-- 9. presby_apply_affiliation_to_org_tree() — the ONE derivation path
-- ---------------------------------------------------------------------------
-- parent_id and path are derived HERE and nowhere else (Ruling 2.3). The
-- subtree rebuild is the single most likely thing in this pipeline to be
-- subtly wrong, so it must not exist in two copies: both the affiliation
-- trigger and the lifecycle trigger call this.
--
-- The GUC is set with is_local => true. A session-scoped GUC here would
-- leave the organizations guards DISARMED for the next unrelated request on
-- a pooled neon-serverless connection — the same hazard src/lib/db/index.ts
-- documents for app.current_org_id.
--
-- IT IS ALSO SET LATE, NOT FIRST (B-M1, security review 2026-09-25 sec B,
-- added 2026-09-24's loop-back, applied 2026-09-25). The first build armed the
-- guard as this function's opening statement, before the subject lookup, the
-- parent lookup, the missing-parent-path check and the cycle check — so every
-- rejection path below left an armed marker behind for the remainder of the
-- caller's transaction, pre-authorising writes to `organizations` that this
-- function had just decided not to make. Arming immediately before the first
-- UPDATE keeps the marker's scope equal to the writes it exists to authorise.
-- (No live exploit: every caller is a DEFINER function that raises on the
-- rejection paths, so the transaction aborts anyway. It is the same
-- narrow-the-window discipline presby_publish_sasr_snapshot() follows.)
create or replace function presby_apply_affiliation_to_org_tree(
  p_subject_org_id uuid,
  p_as_of date default current_date
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old_path    text;
  v_label       text;
  v_new_parent  uuid;
  v_parent_path text;
  v_new_path    text;
begin
  select o.path, replace(o.slug, '-', '_')
    into v_old_path, v_label
    from organizations o
   where o.id = p_subject_org_id;

  -- Subject gone (deleted earlier in this same transaction): nothing to
  -- derive, and raising here would turn a legal teardown into a failure.
  if v_label is null then
    return;
  end if;

  select a.parent_org_id
    into v_new_parent
    from organization_affiliations a
   where a.subject_org_id = p_subject_org_id
     and a.effective_to is null
   order by a.effective_from desc nulls last
   limit 1;

  if v_new_parent is null then
    -- Top-level org, or a subject whose affiliation was just closed with no
    -- successor yet (a dissolution with no receiving council). Same
    -- root-label rule deriveOrgPath() uses in src/lib/org-provisioning.ts —
    -- that function stays roots-only and is NOT extended; the parent-prefix
    -- rule lives here, permanently.
    v_new_path := v_label;
  else
    select o.path into v_parent_path from organizations o where o.id = v_new_parent;
    if v_parent_path is null then
      perform presby_deny_affiliation_change();
    end if;
    -- A parent that sits INSIDE the subject's own subtree would build a
    -- cycle, and a cycle in `path` hangs every ancestry read afterwards.
    if v_old_path is not null
       and left(v_parent_path, length(v_old_path) + 1) = v_old_path || '.' then
      perform presby_deny_affiliation_change();
    end if;
    v_new_path := v_parent_path || '.' || v_label;
  end if;

  -- Every validation above has passed; from here the function WRITES. Arm the
  -- guard now, not at entry (see the header note on B-M1).
  perform set_config('presby.affiliation_trigger_active', 'true', true);

  update organizations
     set parent_id = v_new_parent,
         path = v_new_path
   where id = p_subject_org_id;

  -- Rebuild the whole subtree in ONE statement, never a per-row loop.
  -- left()/length() rather than LIKE: path labels are full of underscores
  -- and `_` is a LIKE wildcard, so `path like 'northern_reach.%'` would also
  -- match `northernXreach.…`.
  if v_old_path is not null and v_old_path is distinct from v_new_path then
    update organizations
       set path = v_new_path || substring(path from length(v_old_path) + 1)
     where left(path, length(v_old_path) + 1) = v_old_path || '.';
  end if;
end $$;

-- B-M1: internal. Its three callers — presby_apply_affiliation_row(),
-- presby_apply_lifecycle_event() and presby_transfer_affiliation() — are all
-- SECURITY DEFINER. Nothing in src/ calls it directly (src/lib/org-
-- provisioning.ts only names it in comments), and a tenant connection holding
-- EXECUTE on the one function that rewrites parent_id and path for a whole
-- subtree is precisely the surface this item exists to close.
revoke all on function presby_apply_affiliation_to_org_tree(uuid, date) from public;
revoke execute on function presby_apply_affiliation_to_org_tree(uuid, date) from presby_app;

-- ---------------------------------------------------------------------------
-- 10. presby_transfer_affiliation() — the ONLY write path (DECISION-135)
-- ---------------------------------------------------------------------------
-- Accepts NO acting-council id, the strengthened confused-deputy form
-- drizzle/0038:376-380 established: the actor is presby_current_org(),
-- already membership-verified by withOrgContext() before this function is
-- reachable. Standing is read from the AFFILIATION HISTORY, never from
-- organizations.parent_id/path — those are the derived cache this same
-- transaction is about to rewrite, so reading them as the authority is
-- circular.
--
-- PARAMETER ORDER DEVIATES FROM PHASE 3 BY NECESSITY: Phase 3's signature
-- places `p_reason text default null` BEFORE `p_minute_reference text` with
-- no default, which Postgres rejects outright ("input parameters after one
-- with a default value must also have defaults"). p_minute_reference moves
-- ahead of p_reason; it is required anyway, since the row it writes carries
-- authority = 'recorded' and the backfill-shape CHECK then demands a minute.
create or replace function presby_transfer_affiliation(
  p_subject_org_id uuid,
  p_new_parent_org_id uuid,
  p_relationship_type text,
  p_effective_on date,
  p_minute_reference text,
  p_reason text default null,
  p_concurrence_reference text default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor          uuid := presby_current_org();
  v_current_row_id uuid;
  v_current_parent uuid;
  v_current_from   date;
  v_new_id         uuid;
begin
  if v_actor is null then
    perform presby_deny_affiliation_change();
  end if;

  -- MOVED TO THE TOP 2026-09-24 (F49 / DECISION-140). It used to be set
  -- inside presby_apply_affiliation_to_org_tree(), immediately before the
  -- derived-cache rewrite, because the organizations reparent guard was its
  -- only consumer. organization_affiliations now has its own UPDATE/DELETE
  -- guard reading the SAME GUC, and this function's own `update ... set
  -- effective_to` (the close, below) runs before the derivation — so the flag
  -- has to be armed here, at the entry to the sanctioned path, rather than
  -- two calls later.
  --
  -- ONE GUC, ONE MEANING: "this transaction is running the sanctioned
  -- affiliation-transfer path." Both consumers (organizations_guard_reparent
  -- and organization_affiliations_guard) are asking exactly that question,
  -- inside the same function and the same transaction, so the reuse is the
  -- minimum-complexity answer rather than a false economy. Contrast
  -- presby.identifier_trigger_active in drizzle/0043, which is a separate GUC
  -- precisely because it is a different claim about a different subsystem.
  -- Transaction-local (is_local => true): a session-scoped value would leave
  -- both guards DISARMED for the next unrelated request on a pooled
  -- neon-serverless connection.
  perform set_config('presby.affiliation_trigger_active', 'true', true);

  select a.id, a.parent_org_id, a.effective_from
    into v_current_row_id, v_current_parent, v_current_from
    from organization_affiliations a
   where a.subject_org_id = p_subject_org_id
     and a.effective_to is null
   order by a.effective_from desc nulls last
   limit 1;

  -- No open affiliation, or no such organization at all — one message for
  -- both, so the caller learns nothing about which.
  if v_current_row_id is null then
    perform presby_deny_affiliation_change();
  end if;

  -- A close cannot predate the row's own opening, NOR FALL ON IT.
  -- TIGHTENED FROM `>` TO `>=` 2026-09-24, as a consequence of
  -- organization_affiliations_range_order (F49): a same-day open-and-close
  -- produces daterange(d, d, '[)') — valid, empty, and now refused by that
  -- CHECK. Without this tightening the function would still attempt the close
  -- and the caller would receive a raw check_violation naming the constraint
  -- instead of the uniform literal, which is exactly the cause-distinguishing
  -- surface F40's one-message-per-table rule exists to prevent.
  if v_current_from is not null and v_current_from >= p_effective_on then
    perform presby_deny_affiliation_change();
  end if;

  if p_new_parent_org_id = v_current_parent then
    -- A CORRECTION, not a jurisdictional transfer (fixing relationship_type,
    -- or reopening a backfilled row with a real minute). The current parent
    -- is the only council with standing.
    if v_actor is distinct from v_current_parent then
      perform presby_deny_affiliation_change();
    end if;
  else
    -- A TRUE TRANSFER. The actor must be the COMMON SUPERIOR of both
    -- parents as of the effective date — which is the polity, not a
    -- modeling convenience: G-3.0403(c) gives the synod the act between two
    -- presbyteries, G-3.0502(d) gives the GA the equivalent between synods,
    -- and p_concurrence_reference records GA concurrence on a synod act
    -- (G-3.0502(e)) as data, never as a second actor.
    if presby_affiliation_parent_as_of(v_current_parent, p_effective_on) is distinct from v_actor
       or presby_affiliation_parent_as_of(p_new_parent_org_id, p_effective_on) is distinct from v_actor
    then
      perform presby_deny_affiliation_change();
    end if;
  end if;

  -- Parent-type-fits-child-type (see the deviation note on
  -- presby_assert_council_authority above: the rule on an affiliation row is
  -- about the PARENT, not the actor).
  perform presby_assert_council_authority(
    p_new_parent_org_id, p_subject_org_id, 'organization_affiliations');

  -- Close. organization_id is untouched: ownership is provenance.
  update organization_affiliations
     set effective_to = p_effective_on,
         closed_by_org_id = v_actor,
         -- No acting-USER context exists in this platform (there is no
         -- app.current_user_id GUC — only app.current_org_id), so closed_by
         -- and recorded_by below are null for a function-mediated transfer.
         -- Accepting a user id as a parameter would be a caller-supplied
         -- identity claim, which is exactly what this function's shape
         -- refuses. Named in the work-log's Implementer Notes as a gap for
         -- the lifecycle-UI pipeline, not papered over.
         closed_by = null,
         closed_on = current_date,
         closed_minute_reference = p_minute_reference
   where id = v_current_row_id;

  insert into organization_affiliations
    (organization_id, subject_org_id, parent_org_id, relationship_type,
     effective_from, effective_to, authority, reason, minute_reference,
     concurrence_reference, recorded_by, recorded_at)
  values
    (v_actor, p_subject_org_id, p_new_parent_org_id, p_relationship_type,
     p_effective_on, null, 'recorded', p_reason, p_minute_reference,
     p_concurrence_reference, null, now())
  returning id into v_new_id;

  perform presby_apply_affiliation_to_org_tree(p_subject_org_id, p_effective_on);

  return v_new_id;
end $$;

revoke all on function presby_transfer_affiliation(uuid, uuid, text, date, text, text, text) from public;
grant execute on function presby_transfer_affiliation(uuid, uuid, text, date, text, text, text) to presby_app;

-- ---------------------------------------------------------------------------
-- 11. Triggers on organization_affiliations
-- ---------------------------------------------------------------------------
create or replace function presby_check_affiliation_authority()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform presby_assert_council_authority(
    new.parent_org_id, new.subject_org_id, 'organization_affiliations');
  return new;
end $$;

drop trigger if exists organization_affiliations_authority on organization_affiliations;
create trigger organization_affiliations_authority
  before insert on organization_affiliations
  for each row execute function presby_check_affiliation_authority();

create or replace function presby_apply_affiliation_row()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform presby_apply_affiliation_to_org_tree(
    new.subject_org_id, coalesce(new.effective_from, current_date));
  return null;
end $$;

drop trigger if exists organization_affiliations_apply on organization_affiliations;
create trigger organization_affiliations_apply
  after insert or update on organization_affiliations
  for each row execute function presby_apply_affiliation_row();

-- ADDED 2026-09-24 (F49 / DECISION-140, fourth Phase 3 loop-back), and it
-- REVERSES section 15's own argument below. That comment reasoned that "the
-- grant alone is the right instrument for THIS table" because closing a row
-- is a legitimate UPDATE. F44 / Ruling B3 — discovered LATER IN THIS SAME
-- MIGRATION FILE's pipeline — disproves it: PLATFORM_DATABASE_URL
-- authenticates as neondb_owner, which owns this table and holds every
-- privilege by ownership, so the revoke binds nobody who can actually reach
-- the database today. Without this trigger, getPlatformDb() could rewrite
-- 1994 affiliation history directly, around the authority check, around the
-- uniform rejection message and around the provenance rule.
--
-- NOT NAMED `%freeze%`, deliberately: this is not organization_lifecycle_
-- events' unconditional freeze. Closing a row IS legitimate — through
-- presby_transfer_affiliation(), which arms the GUC at its own entry. The
-- name says "guard", matching organizations_guard_reparent, whose shape this
-- mirrors exactly.
--
-- SECURITY DEFINER is not used and is not needed: the function reads no
-- table, only a GUC, so the F26 shape (an invoker-mode reader silently
-- filtered by the RLS it exists to complement) cannot arise. It fires on
-- every connection regardless — BYPASSRLS and ownership exempt a role from
-- policies and grants, never from triggers.
--
-- THE DELETE ARM CANNOT BE AN UNCONDITIONAL FREEZE, and this is the detail a
-- naive "mirror organization_successions" implementation gets wrong.
-- subject_org_id is ON DELETE CASCADE *specifically* so a deletable_until-
-- stamped test fixture's teardown can clean up its affiliation rows (see the
-- FK swap's comment above). An unconditional DELETE freeze would break every
-- one of the 15+ existing teardown sites the day it shipped. Instead the
-- DELETE arm reads the same GUC, and presby_guard_organizations_delete()
-- (section 14) arms it once it has validated OLD.deletable_until — so the
-- cascade Postgres fires immediately afterwards, in the same transaction, is
-- pre-authorized, with no change to any call site.
create or replace function presby_guard_organization_affiliations()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('presby.affiliation_trigger_active', true), '') <> 'true' then
    perform presby_deny_affiliation_change();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists organization_affiliations_guard on organization_affiliations;
create trigger organization_affiliations_guard
  before update or delete on organization_affiliations
  for each row execute function presby_guard_organization_affiliations();

-- ---------------------------------------------------------------------------
-- 12. Triggers on organization_lifecycle_events
-- ---------------------------------------------------------------------------
-- (12a) THE CREATION GUARD — organization_lifecycle_events and
-- organization_successions are ONE immutable aggregate, and INSERT on both is
-- gated by ONE transaction-local GUC (F54 / DECISION-141, added 2026-09-24,
-- sixth Phase 3 loop-back).
--
-- WHY, in one sentence: both tables already refuse UPDATE and DELETE on every
-- connection (the two freeze triggers below and in section 13c), but their
-- INSERT was mediated by a GRANT plus a shape CHECK — and a grant binds
-- presby_app and presby_platform, never neondb_owner, which is the role
-- getPlatformDb() and MIGRATE_DATABASE_URL actually connect as (F44). A shape
-- CHECK proves a row is WELL-FORMED; it never proves the row arrived through
-- the SANCTIONED PATH. The external reviewer's repro is precise: after a valid
-- `merged` A+B -> C is committed, a later raw-owner INSERT of a THIRD
-- predecessor edge into the same event changes what the minute says happened,
-- without violating cardinality (2 predecessors becomes 3, still >= 2) and
-- without tripping the event-scope trigger (the event exists and, on a
-- context-less owner connection, the actor check is skipped by design). Only a
-- trigger reading a transaction-local marker can tell that write apart from
-- the sanctioned writer's own.
--
-- ONE GUC ACROSS BOTH TABLES, and the EXISTING literal reused: this is the
-- affiliation/organizations reuse case (DECISION-139/140), not the identifier
-- table's no-reuse case. One future writer (presby_record_lifecycle_event(),
-- named in docs/TODO.md) inserts the event row and its succession rows in ONE
-- transaction, making one claim — "this transaction is recording a sanctioned
-- lifecycle act". Two flags would be two names for one fact.
--
-- THE MARKER CARRIES AN EVENT ID, NOT A BOOLEAN (corrected 2026-09-25, eighth
-- Phase 3 loop-back, QA-1). Until this correction the GUC held the literal
-- 'true': a self-armable sentinel that named no act. QA measured the
-- consequence on the owner connection — arm the boolean in any transaction,
-- and a third predecessor edge appends cleanly to an already-committed,
-- already-valid `merged` event, because the guard (armed), the event-scope
-- trigger (the event exists; on a context-less connection the actor
-- comparison is skipped by design) and cardinality (3 >= 2) all pass. The
-- marker now carries the organization_lifecycle_events.id, as text, that THIS
-- transaction is recording, and the guard compares the row in front of it
-- against that value:
--
--   set_config('presby.lifecycle_write_active', <event id>::text, true)
--
-- WHAT THIS DOES AND DOES NOT GUARANTEE, stated exactly, because the previous
-- version of this comment overclaimed and that overclaim is what QA-1 caught:
--
--   GUARANTEED — the transaction that arms the marker DECLARES WHICH ACT it
--   is recording, and every row either table accepts in that transaction must
--   belong to that declared act. An armed writer cannot write a row belonging
--   to some OTHER event, in either table, by accident or by drift: the events
--   branch requires new.id = the armed id, the successions branch requires
--   new.event_id = the armed id. "Some sanctioned act is in progress" has
--   become "this specific row belongs to the act now being recorded", which
--   is what presby_record_lifecycle_event()'s contract (mint one fresh id,
--   insert the event and its successions in one transaction, never accept a
--   caller-supplied id for an existing act) satisfies by construction.
--
--   NOT GUARANTEED, and named rather than papered over — an ACCEPTED RESIDUAL
--   of the F44 class: a later, separate transaction that deliberately re-arms
--   the marker to an ALREADY-COMMITTED event's own id is NOT refused. The id
--   is not a secret, so an actor who sets the marker to the target's own id
--   satisfies this check trivially. Closing that needs the guard to prove the
--   referenced event row was created in the CURRENT transaction (an xmin /
--   pg_current_xact_id() check), which would require turning this function
--   into a SECURITY DEFINER reader of a FORCE-RLS table (F26) — an idiom that
--   exists nowhere else in this schema — to close a gap reachable only from an
--   owner-level connection, which can defeat any trigger here with
--   `alter table ... disable trigger` regardless (F44's standing fact; see
--   drizzle/0047 section 5a, which uses that escape hatch deliberately). The
--   residual is recorded on docs/TODO.md's presby_record_lifecycle_event()
--   line and is that function's own scoped design question, not a bolt-on
--   here. Ruling: work-log 2026-09-24-lifecycle-affiliation-returns.md,
--   "Ruling on QA-1/QA-2 after hardening round two", Ruling 1.
--
-- NO '*' WILDCARD FOR BACKFILL CONTEXT, deliberately. A future migration or
-- backfill inserting several historical lifecycle events in one transaction
-- re-arms the GUC to EACH event's own id immediately before that event's own
-- insert (and its succession rows), exactly mirroring the runtime writer's
-- contract. One mechanism, no special case — the same "one GUC, one claim"
-- discipline as DECISION-139/141.
--
-- NOTHING ARMS presby.lifecycle_write_active TODAY, and that is the ruling,
-- not an oversight: until presby_record_lifecycle_event() ships, INSERT on
-- both tables is closed on every connection, which is the reviewer's own
-- fallback suggestion ("seriously consider making successions read-only
-- outside migrations") reached as a consequence of gating the aggregate rather
-- than as a separate rule. Verified before ruling: no application code writes
-- either table (createOrganization() writes only the initial affiliation;
-- scripts/seed-dev.sql writes neither; no migration backfill inserts into
-- either), so the entire cost of this guard falls on direct-INSERT test
-- fixtures, which arm the GUC themselves — scripts/test-rls.sql section 32(k)
-- and src/lib/db/domain/lifecycle.test.ts. A migration or backfill that ever
-- does insert a lifecycle event must arm it the same way.
--
-- FIRING ORDER, checked rather than assumed: triggers on one table fire in
-- alphabetical order by NAME, so on organization_lifecycle_events
-- `..._authority` sorts before `..._guard`, and on organization_successions
-- `..._event_scope` sorts before `..._guard`. Both existing checks therefore
-- still run FIRST and their assertions are unchanged; the GUC guard is the
-- last BEFORE-INSERT layer, ahead of the table's CHECK constraints. A test
-- that wants to prove a CHECK or an authority rejection must arm the GUC, or
-- it proves the guard instead — which is exactly what the fixture sweep in
-- this loop-back is.
--
-- SECURITY DEFINER is NOT used and is not needed: this function reads no
-- table, only a GUC, so F26's "an invoker-mode reader is filtered by the RLS
-- it exists to complement" shape cannot arise (same reasoning as
-- presby_guard_organization_identifiers(), drizzle/0043 section 4).
--
-- ONE LITERAL FOR ALL THREE SUB-REASONS (unarmed, wrong table, wrong id):
-- every branch below raises through the EXISTING presby_deny_lifecycle_change()
-- helper, preserving F40's one-claim-one-literal discipline
-- (DECISION-139/141). The caller learns "this change is not permitted" and
-- nothing about which of the three produced it.
create or replace function presby_guard_lifecycle_write()
returns trigger language plpgsql as $$
declare
  -- Null when unset; never the empty string, so an unarmed transaction and a
  -- deliberately-blanked one take the same branch.
  v_armed text := nullif(current_setting('presby.lifecycle_write_active', true), '');
  v_row   text;
begin
  if v_armed is null then
    perform presby_deny_lifecycle_change();
  end if;

  -- Which column carries the declared act's id depends on which half of the
  -- aggregate is being written. tg_table_name, not a second trigger function:
  -- one claim, one guard (section 12a).
  if tg_table_name = 'organization_lifecycle_events' then
    v_row := new.id::text;
  elsif tg_table_name = 'organization_successions' then
    v_row := new.event_id::text;
  else
    -- A third table attached this guard without extending the branch. Refuse
    -- rather than fall through to an implicit pass.
    perform presby_deny_lifecycle_change();
  end if;

  if v_row is distinct from v_armed then
    perform presby_deny_lifecycle_change();
  end if;

  return new;
end $$;

drop trigger if exists organization_lifecycle_events_guard on organization_lifecycle_events;
create trigger organization_lifecycle_events_guard
  before insert on organization_lifecycle_events
  for each row execute function presby_guard_lifecycle_write();

create or replace function presby_check_lifecycle_authority()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform presby_assert_council_authority(
    new.organization_id, new.subject_org_id, 'organization_lifecycle_events');
  return new;
end $$;

drop trigger if exists organization_lifecycle_events_authority on organization_lifecycle_events;
create trigger organization_lifecycle_events_authority
  before insert on organization_lifecycle_events
  for each row execute function presby_check_lifecycle_authority();

-- SECURITY DEFINER for GRANT reasons (F38), not only for F26: after the
-- revoke at the bottom of this file, presby_app cannot UPDATE organizations
-- at all, same-org or not.
create or replace function presby_apply_lifecycle_event()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  -- organized/received mean the body is now ACTIVE in this system;
  -- everything else maps to itself.
  v_status := case new.event
                when 'organized' then 'active'
                when 'received'  then 'active'
                else new.event
              end;

  update organizations
     set lifecycle_status = v_status,
         lifecycle_as_of = new.effective_on
   where id = new.subject_org_id;

  if new.event in ('dissolved', 'merged', 'divided', 'dismissed') then
    -- ARM THE AFFILIATION GUARD (added 2026-09-24, F49). This function is the
    -- SECOND sanctioned writer of an affiliation close — the external review's
    -- Ruling 3 named only presby_transfer_affiliation() and would have left
    -- every dissolution, merger, division and dismissal rejected by
    -- organization_affiliations_guard. Same GUC, same meaning ("this
    -- transaction is running a sanctioned affiliation write"), same
    -- transaction-local scope. It is armed INSIDE this branch rather than at
    -- the top of the function so an event that closes nothing (organized,
    -- received) leaves the guard armed for nothing.
    perform set_config('presby.affiliation_trigger_active', 'true', true);

    -- Close the subject's open affiliation. The effective_from guard keeps a
    -- back-dated event from building an inverted daterange, which the
    -- EXCLUDE constraint would reject with a raw Postgres error.
    update organization_affiliations
       set effective_to = new.effective_on,
           closed_by_org_id = new.organization_id,
           closed_by = new.recorded_by,
           closed_on = current_date,
           closed_minute_reference = new.minute_reference
     where subject_org_id = new.subject_org_id
       and effective_to is null
       and (effective_from is null or effective_from <= new.effective_on);

    perform presby_apply_affiliation_to_org_tree(new.subject_org_id, new.effective_on);
  end if;
  -- `received` closes nothing: there was no affiliation inside this system
  -- to close. Opening one is presby_transfer_affiliation()'s or
  -- createOrganization()'s job, out of this trigger's scope.

  return null;
end $$;

drop trigger if exists organization_lifecycle_events_apply on organization_lifecycle_events;
create trigger organization_lifecycle_events_apply
  after insert on organization_lifecycle_events
  for each row execute function presby_apply_lifecycle_event();

-- THE FREEZE (Ruling A5 / DECISION-135's 2026-09-24 correction). A minuted
-- act is immutable; it is corrected by recording another act, never by an
-- UPDATE and never by a DELETE. Mirrors presby_freeze_approved_roll_action()
-- (drizzle/0009:358-373) down to the errcode.
--
-- WHY A TRIGGER AND NOT JUST THE ABSENT GRANT (section 2's own note, in
-- full): a grant binds presby_app and presby_platform; it does not bind
-- neondb_owner, which holds every privilege by ownership and is the role
-- getPlatformDb()/MIGRATE_DATABASE_URL actually connect as. BYPASSRLS
-- exempts a role from RLS policies, never from triggers, so this fires on
-- the owner path — the path that matters, and the one the 2026-08-31 58-org
-- cascade took. Deliberately defeatable by `alter table ... disable
-- trigger`, as an owner-only, conspicuous act, exactly like
-- presby_guard_organizations_delete().
--
-- NOT mirrored onto organization_affiliations — SUPERSEDED IN PART,
-- 2026-09-24 (F49 / DECISION-140). Ruling A5.3's reasoning was that closing a
-- row is a legitimate UPDATE, so a freeze there would have to distinguish the
-- DEFINER function's own write from a raw mutation, and the narrowed grant
-- avoided that complexity. The grant does not bind the owner (F44), so the
-- complexity had to be paid after all — organization_affiliations_guard
-- (section 11) makes exactly that distinction, via the transaction-local
-- presby.affiliation_trigger_active GUC that the two sanctioned writers (this
-- function's close branch and presby_transfer_affiliation()) arm. It is a
-- GUARD rather than a FREEZE, and the name says so.
create or replace function presby_freeze_lifecycle_event()
returns trigger language plpgsql as $$
begin
  raise exception
    'organization_lifecycle_events %: a minuted act is immutable; record a correcting act instead',
    old.id
    using errcode = 'check_violation';
end $$;

drop trigger if exists organization_lifecycle_events_freeze on organization_lifecycle_events;
create trigger organization_lifecycle_events_freeze
  before update or delete on organization_lifecycle_events
  for each row execute function presby_freeze_lifecycle_event();

-- ---------------------------------------------------------------------------
-- 13. organization_successions: event scope, cardinality, and the freeze
-- ---------------------------------------------------------------------------
-- (13a) EVENT SCOPE — the trigger half of Phase 5 Finding 1's fix.
--
-- SECURITY DEFINER is load-bearing and is NOT cargo cult (DECISION-121's
-- warning, answered explicitly): this function's own SELECT reads
-- organization_lifecycle_events, which is FORCE ROW LEVEL SECURITY. Run as
-- INVOKER from a tenant connection it would read zero rows for exactly the
-- case it guards — F26's failure mode verbatim — and would then reject every
-- legitimate insert while being unable to tell a foreign event from a
-- nonexistent one. It must see across that table's RLS to compare against it.
--
-- The `presby_current_org() is not null` guard is the owner/migration path:
-- with no org context there is no tenant to check against, and the freeze
-- plus the absent grant are what bound that path. This is the same shape
-- every DEFINER function here uses, EXCEPT that it does not refuse a null
-- context outright — a BEFORE INSERT trigger fires on the migration's own
-- backfills and on platform provisioning, neither of which has a GUC set.
-- Existence is still checked unconditionally.
--
-- Both rejections go through presby_deny_lifecycle_change(), so a probe
-- cannot distinguish "no such event" from "that event is not yours"
-- (DECISION-139; DECISION-040's byte-identical discipline). Note the ORDER a
-- tenant meets these layers in: the missing INSERT grant fires FIRST, as
-- `permission denied for table organization_successions`, and this trigger is
-- never reached from `presby_app` at all. The trigger's guarantee is for the
-- writer that DOES get here — the future DEFINER function, which runs as the
-- owner and therefore has no grant stopping it. scripts/test-rls.sql says
-- which layer each of its assertions proves.
create or replace function presby_check_succession_event()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_event_org uuid;
  v_actor     uuid := presby_current_org();
begin
  select e.organization_id
    into v_event_org
    from organization_lifecycle_events e
   where e.id = new.event_id;

  if v_event_org is null then
    perform presby_deny_lifecycle_change();
  end if;

  if v_actor is not null and v_event_org is distinct from v_actor then
    perform presby_deny_lifecycle_change();
  end if;

  return new;
end $$;

drop trigger if exists organization_successions_event_scope on organization_successions;
create trigger organization_successions_event_scope
  before insert on organization_successions
  for each row execute function presby_check_succession_event();

-- (13a2) THE CREATION GUARD, the second half of section 12a's one aggregate
-- (F54 / DECISION-141, added 2026-09-24). Same GUC, same function, same
-- literal — see 12a for the whole argument, which is not repeated here
-- precisely because the claim is ONE claim across both tables.
--
-- WHAT THIS TRIGGER DOES ABOUT THE REVIEWER'S REPRO — restated exactly, after
-- QA-1 measured the previous version of this comment to be an overclaim
-- (2026-09-25, eighth Phase 3 loop-back; the earlier text said this trigger
-- "stops" a later, separate INSERT of a third predecessor edge into an
-- already-valid, already-committed `merged` event, and it does not).
--
-- Cardinality cannot see that write (3 >= 2 is still valid) and the
-- event-scope trigger cannot (the event exists, and on a context-less owner
-- connection the actor comparison is deliberately skipped). This guard is the
-- only layer that can say anything at all about it, and what it says is:
--
--   REFUSED — the writing transaction is unarmed, or armed for a DIFFERENT
--   act than the one this row's event_id names. That is the whole of the
--   guarantee: a transaction declares which act it is recording and may write
--   only rows belonging to that act.
--
--   NOT REFUSED — a transaction that deliberately arms the marker to the
--   settled event's OWN id. Accepted residual, owner-connection-bounded,
--   F44 class; the full argument and the reason it is declined rather than
--   built are in section 12a above.
drop trigger if exists organization_successions_guard on organization_successions;
create trigger organization_successions_guard
  before insert on organization_successions
  for each row execute function presby_guard_lifecycle_write();

-- (13b) CARDINALITY — DEFERRED, and that is not optional.
-- A `merged` event needs >= 2 predecessor rows, which cannot be true at the
-- instant the first row is inserted. An IMMEDIATE trigger would make the
-- legal case unwritable.
--
-- CHECKED FROM BOTH ENDS SINCE 2026-09-24 (F54 / DECISION-141). The counting
-- and raising logic lived only on organization_successions' own insert/delete,
-- so an event row committed with ZERO succession rows was never checked at
-- all: a `merged` or `divided` lifecycle event with no edges satisfied every
-- constraint the schema had, because the only trigger that could object never
-- fired. The body below is therefore EXTRACTED into a shared function keyed on
-- the event id, called from two deferred constraint triggers — this one on
-- organization_successions and a new one on organization_lifecycle_events
-- (13b2) — rather than copied, so the two cannot drift apart by hand-editing
-- one of them. THIS SHARED HELPER stays SECURITY INVOKER: it runs inside the
-- writer's own transaction against tables that writer just touched, so the F26
-- cross-tenant read shape does not arise for the helper itself. Its two
-- wrapper callers ARE SECURITY DEFINER as of 2026-09-25 (F62, section 13b3
-- below), so this body now runs under the owner's context however it is
-- reached — which is what keeps its opening `select ... where e.id =
-- p_event_id` from silently finding nothing and turning the whole check into
-- the ON DELETE CASCADE no-op.
--
-- The "parent event removed in the same transaction" no-op moved INTO the
-- shared function, so both callers inherit it.
create or replace function presby_lifecycle_event_cardinality_check(p_event_id uuid)
returns void language plpgsql as $$
declare
  v_event text;
  v_pred  integer;
  v_succ  integer;
begin
  select e.event into v_event
    from organization_lifecycle_events e where e.id = p_event_id;
  -- Parent event removed in the same transaction (ON DELETE CASCADE): there
  -- is no cardinality left to check.
  if v_event is null then
    return;
  end if;

  select count(distinct predecessor_org_id), count(distinct successor_org_id)
    into v_pred, v_succ
    from organization_successions where event_id = p_event_id;

  if v_event = 'merged' and not (v_pred >= 2 and v_succ = 1) then
    raise exception
      'organization_successions: a merged event needs at least 2 predecessors and exactly 1 successor (found % / %)',
      v_pred, v_succ using errcode = 'check_violation';
  elsif v_event = 'divided' and not (v_pred = 1 and v_succ >= 2) then
    raise exception
      'organization_successions: a divided event needs exactly 1 predecessor and at least 2 successors (found % / %)',
      v_pred, v_succ using errcode = 'check_violation';
  elsif v_event in ('dissolved', 'dismissed', 'organized', 'received')
        and (v_pred > 0 or v_succ > 0) then
    raise exception
      'organization_successions: a % event carries no succession rows (found % / %)',
      v_event, v_pred, v_succ using errcode = 'check_violation';
  end if;
end $$;

-- EXECUTE WAS THE NAMED EXCEPTION TO B-M1 (security review 2026-09-25 sec B)
-- FOR ONE DAY, AND IS NOW REVOKED TOO — the history is kept because the
-- mechanism it turns on is easy to get wrong twice. Both callers are SECURITY
-- INVOKER trigger functions, so this body runs as whoever fired the trigger,
-- not as the owner. While presby_app held INSERT on
-- organization_lifecycle_events its deferred cardinality check called this
-- function AS presby_app, and revoking the grant failed the check at commit
-- with `permission denied for function` — a real failure, in the wrong
-- vocabulary, caught by a failing run of scripts/test-rls.sql, not by
-- reasoning. The 2026-09-25 revoke of that INSERT grant (section 2) removed
-- the only tenant path into either caller: presby_app now holds SELECT on
-- organization_lifecycle_events and SELECT on organization_successions, so it
-- can fire neither the AFTER INSERT trigger on the events table nor the
-- AFTER INSERT OR DELETE one on the successions table.
--
-- SAME COUPLING as presby_deny_lifecycle_change() in section 6: if INSERT is
-- ever re-granted to presby_app on either lifecycle table, this grant must
-- return in the same migration.
revoke all on function presby_lifecycle_event_cardinality_check(uuid) from public;
revoke execute on function presby_lifecycle_event_cardinality_check(uuid) from presby_app;
grant execute on function presby_lifecycle_event_cardinality_check(uuid) to presby_platform;

-- The successions-side caller, now a thin wrapper. Its messages, its errcode
-- and its pass/fail outcomes are byte-identical to the pre-refactor form —
-- scripts/test-rls.sql section 32 and src/lib/db/domain/lifecycle.test.ts
-- assert the messages, so a drift here fails the suite rather than passing
-- quietly.
--
-- SECURITY DEFINER since 2026-09-25 (F62 / Ruling 3) — the full argument, and
-- the measurement that corrected the ruling's premise about which role a
-- deferred trigger runs as, are in section 13b3 below.
create or replace function presby_check_succession_cardinality()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  if v_event_id is not null then
    perform presby_lifecycle_event_cardinality_check(v_event_id);
  end if;
  return null;
end $$;

drop trigger if exists organization_successions_cardinality on organization_successions;
create constraint trigger organization_successions_cardinality
  after insert or delete on organization_successions
  deferrable initially deferred
  for each row execute function presby_check_succession_cardinality();

-- (13b2) THE EVENT-SIDE HALF of the same check, closing the zero-succession
-- hole directly (F54 / DECISION-141, added 2026-09-24).
--
-- DEFERRED for the same reason 13b is: a `merged` event row is necessarily
-- inserted BEFORE the succession rows it needs, so an IMMEDIATE trigger would
-- make the legal case unwritable. At COMMIT the aggregate must be complete,
-- and either trigger alone is sufficient to say so — in the ordinary case both
-- fire in one transaction and agree.
--
-- SECURITY DEFINER since 2026-09-25 (F62 / Ruling 3), for the same two reasons
-- its successions-side twin is; see section 13b3 below.
create or replace function presby_check_lifecycle_event_cardinality()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform presby_lifecycle_event_cardinality_check(new.id);
  return null;
end $$;

drop trigger if exists organization_lifecycle_events_cardinality on organization_lifecycle_events;
create constraint trigger organization_lifecycle_events_cardinality
  after insert on organization_lifecycle_events
  deferrable initially deferred
  for each row execute function presby_check_lifecycle_event_cardinality();

-- (13b3) THE DEFERRED PATH IS PROVEN THROUGH THE COMMIT-TIME CHECK, NOT ONLY
-- TO FUNCTION RETURN (F62 / eleventh Phase 3 loop-back, Ruling 3, 2026-09-25).
--
-- MEASURED ON PostgreSQL 18.6 (the `development` Neon branch), 2026-09-25,
-- and the measurement CORRECTS Ruling 3's stated premise. The ruling reasoned
-- that a deferred constraint trigger fires "under the session's ambient role"
-- at COMMIT, so a SECURITY DEFINER writer's INSERTs would schedule triggers
-- that later run as presby_app. That is HALF right, and the half that is wrong
-- matters enough to write down rather than let a future reader re-derive it
-- from the same plausible-but-incomplete reasoning:
--
--   * An after-trigger event carries the security context that was current
--     WHEN THE EVENT WAS QUEUED, not the one current when it fires. Probe
--     (scratch table + deferred constraint trigger raising current_user,
--     dropped afterwards): an INSERT performed inside a SECURITY DEFINER
--     function reports `current_user = neondb_owner, session_user =
--     presby_app` inside the deferred trigger — at `SET CONSTRAINTS ALL
--     IMMEDIATE` and at a real COMMIT alike.
--   * A DIRECT INSERT by the tenant role queues an event with presby_app's own
--     context, and the deferred trigger then reports `current_user =
--     presby_app`.
--
-- So the `permission denied` failure the ruling predicted is REAL, but it is
-- reachable on the DIRECT TENANT INSERT path, not through a DEFINER writer.
-- This is not documented by PostgreSQL as version-contingent behavior, but is
-- stated here as measured rather than assumed — re-verify if the production
-- Postgres major version ever diverges from 18.x.
--
-- WHY THE TWO WRAPPERS ABOVE ARE `SECURITY DEFINER` ANYWAY, on the corrected
-- reading. The revoke at 13b (presby_app lost EXECUTE on
-- presby_lifecycle_event_cardinality_check) is correct and stays. Two reasons
-- survive the correction, and the second is the stronger one:
--
--   1. GRANT. The direct-tenant-INSERT path above is grant-closed today
--      (presby_app holds SELECT only on both lifecycle tables) but 13b's own
--      comment already couples "re-grant INSERT and this EXECUTE grant must
--      come back" — a coupling that rots quietly. DEFINER removes the coupling
--      outright: the wrappers reach the helper BY OWNERSHIP (an owner is
--      exempt from its own object's ACL entries), so no grant has to come back
--      and the revoke keeps meaning exactly what it says.
--   2. VISIBILITY, which no grant can fix. presby_lifecycle_event_cardinality_
--      check() opens with `select e.event ... where e.id = p_event_id` and
--      RETURNS SILENTLY when that finds nothing (the legitimate ON DELETE
--      CASCADE no-op). Run as INVOKER under a role for which
--      organization_lifecycle_events' FORCE-RLS policy hides the event row,
--      the whole cardinality check degrades into that no-op and passes — the
--      F26 shape, arriving through a deferred trigger instead of a direct
--      read, and failing OPEN rather than closed. DEFINER is the only thing
--      that makes the check see the aggregate it is checking.
--
-- FAILING-FIRST, RUN NOT ASSUMED (database-admin, tenth Phase 4 pass,
-- 2026-09-25). With the test double below installed and the two wrappers still
-- INVOKER: a direct tenant INSERT of one more succession edge (INSERT
-- temporarily granted on organization_successions, GUC armed to the event's
-- own id) failed at `set constraints all immediate` with exactly `ERROR:
-- permission denied for function presby_lifecycle_event_cardinality_check`,
-- raised from presby_check_succession_cardinality() line 6. After the DEFINER
-- conversion the same probe passes the privilege check and the temporary grant
-- was revoked again. The section-38 positive control (a well-formed `merged`
-- aggregate written through the test double) succeeds both before and after —
-- honestly reported, because of the queued-context fact above — and the
-- negative control raises the cardinality literal unchanged in both states.
--
-- THE TEST DOUBLE, and why it lives in a migration rather than in the suite.
-- scripts/test-rls.sql runs as presby_app, and presby_app cannot create a
-- SECURITY DEFINER function owned by neondb_owner — so the stand-in has to be
-- created by the migration. It is NOT a production API and must not acquire
-- callers: it performs no standing check, takes the acting council from
-- presby_current_org(), and exists only so the deferred path can be exercised
-- as a tenant role before the real writer exists.
--
-- ##### SCAFFOLDING — DROP THIS FUNCTION IN THE SAME MIGRATION THAT SHIPS
-- ##### presby_record_lifecycle_event(). The real writer supersedes it
-- ##### entirely; leaving both would give the tenant connection a second,
-- ##### unchecked way into the lifecycle aggregate. Tracked in docs/TODO.md on
-- ##### presby_record_lifecycle_event()'s own line.
create or replace function presby_test_only_lifecycle_writer_f62(
  p_subject_org_id  uuid,
  p_event           text,
  p_effective_on    date,
  p_minute_reference text,
  p_recorded_by     uuid,
  p_predecessors    uuid[],
  p_successors      uuid[]
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_pred uuid;
  v_succ uuid;
begin
  -- The essential shape of the real writer: one transaction, one act, the
  -- aggregate's own id as the marker (F54 / DECISION-141).
  perform set_config('presby.lifecycle_write_active', v_event_id::text, true);

  insert into organization_lifecycle_events
    (id, organization_id, subject_org_id, event, effective_on, minute_reference,
     recorded_by)
  values
    (v_event_id, presby_current_org(), p_subject_org_id, p_event, p_effective_on,
     p_minute_reference, p_recorded_by);

  foreach v_pred in array coalesce(p_predecessors, array[]::uuid[]) loop
    foreach v_succ in array coalesce(p_successors, array[]::uuid[]) loop
      insert into organization_successions (event_id, predecessor_org_id, successor_org_id)
      values (v_event_id, v_pred, v_succ);
    end loop;
  end loop;

  return v_event_id;
end $$;

comment on function presby_test_only_lifecycle_writer_f62(uuid, text, date, text, uuid, uuid[], uuid[]) is
  'TEST SCAFFOLDING (F62, 2026-09-25). A throwaway SECURITY DEFINER stand-in for the future presby_record_lifecycle_event(), existing only so scripts/test-rls.sql section 38 can drive the deferred cardinality path as presby_app through SET CONSTRAINTS ALL IMMEDIATE. It performs NO standing check. DROP IT in the same migration that ships presby_record_lifecycle_event().';

revoke all on function presby_test_only_lifecycle_writer_f62(uuid, text, date, text, uuid, uuid[], uuid[]) from public;
grant execute on function presby_test_only_lifecycle_writer_f62(uuid, text, date, text, uuid, uuid[], uuid[]) to presby_app;

-- (13c) THE FREEZE. Same instrument and same reasoning as
-- presby_freeze_lifecycle_event() in section 12: a grant binds presby_app and
-- presby_platform, never neondb_owner, and the owner path is the one the
-- 2026-08-31 58-org cascade took. A succession row is the CONTENT of a
-- minuted act; it is corrected the way the act is, by recording another act.
--
-- CHECKED AGAINST 13b's LEGITIMATE FLOWS BEFORE ADDING IT, because a freeze
-- that breaks a legal path is worse than no freeze:
--
--   * The cardinality trigger's DELETE arm (`coalesce(new.event_id,
--     old.event_id)`) is now defence in depth rather than a live path. It
--     stays: it is what still holds if an owner disables THIS trigger, which
--     is the deliberate, conspicuous escape hatch presby_guard_organizations_
--     delete() also leaves.
--   * `event_id ... on delete cascade` is likewise unreachable, and already
--     was — section 12's freeze makes a lifecycle event undeletable, so the
--     cascade can never fire. The clause stays as a statement of intent.
--   * Building a multi-row `merged` incrementally does NOT need DELETE. The
--     cardinality constraint is DEFERRED, so an in-progress shape is legal
--     until commit and a mistake is unwound by ROLLBACK, not by removing
--     rows. scripts/test-rls.sql 32(j) and the owner-connection proofs in
--     src/lib/db/domain/lifecycle.test.ts both work exactly that way.
--   * The `organizations` FKs here are RESTRICT, so a fixture-org teardown
--     that touched a succession row would already fail on the FK — this
--     trigger changes nothing about it.
--
-- So no legal flow needs DELETE, and DELETE is not kept for the owner either.
create or replace function presby_freeze_succession()
returns trigger language plpgsql as $$
begin
  raise exception
    'organization_successions %: a succession row is the content of a minuted act and is immutable; record a correcting act instead',
    old.id
    using errcode = 'check_violation';
end $$;

drop trigger if exists organization_successions_freeze on organization_successions;
create trigger organization_successions_freeze
  before update or delete on organization_successions
  for each row execute function presby_freeze_succession();

-- ---------------------------------------------------------------------------
-- 14. The organizations guards
-- ---------------------------------------------------------------------------
-- All three SECURITY DEFINER (F38). All three fire on BOTH connections:
-- BYPASSRLS exempts a role from RLS POLICIES, never from TRIGGERS, and the
-- owner path (getPlatformDb()) is the one that matters — the 2026-08-31
-- 58-org cascade went through it.
create or replace function presby_guard_organizations_insert()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('presby.affiliation_trigger_active', true), '') <> 'true' then
    raise exception
      'organizations: parent_id is derived from organization_affiliations and may not be set directly; insert the organization as a root and record its affiliation'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists organizations_guard_insert on organizations;
create trigger organizations_guard_insert
  before insert on organizations
  for each row when (new.parent_id is not null)
  execute function presby_guard_organizations_insert();

create or replace function presby_guard_organizations_reparent()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('presby.affiliation_trigger_active', true), '') <> 'true' then
    raise exception
      'organizations: parent_id and path are derived from organization_affiliations and may not be updated directly; record an affiliation change instead'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists organizations_guard_reparent on organizations;
create trigger organizations_guard_reparent
  before update of parent_id, path on organizations
  for each row execute function presby_guard_organizations_reparent();

-- Invariant: an organization is permanent, the `people` rule's twin. A
-- congregation that closes is a lifecycle event, never a deleted row. The
-- one difference from the person rule is load-bearing: a person merge is
-- FOLLOWED (merged_into_id is a chain); a congregation merge is NOT —
-- following organization_successions would attribute a predecessor's 1987
-- return to the successor, the mis-attribution D19 exists to prevent.
create or replace function presby_guard_organizations_delete()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.deletable_until is null or old.deletable_until <= now() then
    raise exception
      'organizations: an organization is permanent; record a lifecycle event instead of deleting it'
      using errcode = 'insufficient_privilege';
  end if;

  -- ADDED 2026-09-24 (F49 / F47 / DECISION-140). The deletion window has now
  -- been validated, so this IS a sanctioned teardown — pre-authorize the
  -- cascades Postgres is about to fire inside this same transaction:
  --   organization_affiliations (ON DELETE CASCADE on subject_org_id)
  --     -> organization_affiliations_guard
  --   organization_identifiers  (ON DELETE CASCADE on organization_id)
  --     -> organization_identifiers_guard  (drizzle/0043)
  -- Both guards refuse an unflagged DELETE on every connection, so without
  -- these two lines every one of the 15+ existing fixture-teardown call sites
  -- would start failing on a cascade it never asked for. Arming them HERE,
  -- once, behind the deletable_until check, is the same design goal
  -- e2e/support/fixture-deletable.ts already states for this guard itself:
  -- the teardown path stays a plain `delete from organizations`.
  --
  -- Two set_config calls rather than one shared flag, because they are two
  -- claims about two unrelated subsystems (see drizzle/0043 section 4). Both
  -- transaction-local.
  perform set_config('presby.affiliation_trigger_active', 'true', true);
  perform set_config('presby.identifier_trigger_active', 'true', true);

  return old;
end $$;

drop trigger if exists organizations_guard_delete on organizations;
create trigger organizations_guard_delete
  before delete on organizations
  for each row execute function presby_guard_organizations_delete();

-- ---------------------------------------------------------------------------
-- 15. The revokes — F38 and F40, made TRUE rather than assumed
-- ---------------------------------------------------------------------------
revoke insert, update, delete on organization_affiliations from presby_app;
grant select on organization_affiliations to presby_app;
-- createOrganization() writes the initial affiliation row for a
-- newly-provisioned hierarchical org (Ruling 3). presby_platform already
-- bypasses RLS by design and is "platform admin pages only, rare and obvious
-- in review", so this narrow grant does not reopen F40's oracle: the oracle
-- needs a role that can probe WITHOUT being able to read.
--
-- CORRECTED 2026-09-24 (Ruling A5.1 / DECISION-135's dated correction note):
-- SELECT + INSERT only. The first build granted UPDATE and DELETE here too,
-- which Ruling 3 never asked for — createOrganization() only ever INSERTs.
-- presby_transfer_affiliation() is SECURITY DEFINER and runs with its
-- OWNER's privileges, so closing a row (this table's one legitimate UPDATE)
-- does not depend on the caller's grant at all; the widening only reopened a
-- raw-mutation path around the function's authority check, its uniform
-- rejection message and its provenance rule, on the connection with the most
-- reach.
--
-- SUPERSEDED IN PART, 2026-09-24 (F49 / DECISION-140). This paragraph used to
-- end "No freeze trigger here — the grant alone is the right instrument for
-- THIS table." That claim was written before F44 / Ruling B3 was discovered
-- later in this same pipeline: the grant binds presby_platform, and nothing
-- authenticates as presby_platform — PLATFORM_DATABASE_URL connects as
-- neondb_owner, the table's owner. organization_affiliations_guard (section
-- 11) now closes the owner path for UPDATE and DELETE. The revokes below are
-- kept and are still correct; they are the belt, not the buckle.
revoke update, delete on organization_affiliations from presby_platform;
grant select, insert on organization_affiliations to presby_platform;

revoke insert, update, delete on organizations from presby_app;
grant select on organizations to presby_app;

-- ---------------------------------------------------------------------------
-- 16. BACKFILL COMPLETENESS ASSERTION (Phase 2 Notes item 3)
-- ---------------------------------------------------------------------------
-- Increment 3's about-org trigger will answer "is X my member congregation"
-- from presby_org_affiliated(), while src/lib/presbytery.ts:143,169 and
-- src/lib/credentials.ts:522,710 still answer it from
-- organizations.parent_id. Those two answers are the same BY CONSTRUCTION
-- only as long as parent_id is a pure cache of the current affiliation. If
-- the backfill missed one row, a presbytery's own UI would offer a
-- congregation the database then refuses — a user-facing error on a shipped
-- page, not a failing test. So this runs inside the migration, before it
-- commits, not as a follow-up check.
do $$
declare
  v_orgs_with_parent  integer;
  v_open_affiliations integer;
begin
  select count(*) into v_orgs_with_parent from organizations where parent_id is not null;
  select count(*) into v_open_affiliations from organization_affiliations where effective_to is null;
  if v_orgs_with_parent <> v_open_affiliations then
    raise exception
      'affiliation backfill incomplete: % orgs have parent_id set but % open affiliation rows exist',
      v_orgs_with_parent, v_open_affiliations;
  end if;
  raise notice 'affiliation backfill complete: % parented orgs, % open affiliation rows',
    v_orgs_with_parent, v_open_affiliations;
end $$;
