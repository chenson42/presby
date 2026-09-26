-- 0050_presby_schema_parity.sql
--
-- Fix-forward for two independent schema-drift findings (Phase 1/2/3 of
-- docs/work-log/2026-09-26-ci-db-tests.md), both confirmed by a
-- migrate-from-empty rehearsal against a scratch database and an
-- information_schema/pg_constraint diff against a live branch.
--
-- The drift: `officer_terms.recorded_by`, `roll_actions.proposed_by`,
-- `administrative_commissions.group_id` and `org_delegations.group_id` all
-- disagree between the committed drizzle/*.sql files on one side and the
-- TypeScript domain model + every live branch on the other. The only shape
-- consistent with that split is an untracked `db:push` / hand-run
-- `ALTER TABLE` against a real branch on 2026-08-17 with no compensating
-- migration. DECISION-146's premise that the posture is "reproducible from
-- drizzle/ alone" has been false since then; this file makes it true and
-- `npm run check:schema-parity` keeps it true.
--
-- Why it stayed invisible for six weeks: drizzle/0010_presby_resolver.sql:88
-- and :105 join `ac.group_id` / `od.group_id` inside a `language plpgsql`
-- body. Postgres does not name-resolve a plpgsql body at CREATE FUNCTION
-- time, so a from-scratch replay of every committed migration reports
-- 50/50 SUCCESS and `presby_effective_permissions()` then raises
-- `column ac.group_id does not exist` on its FIRST CALL — every arm, since
-- the four arms are one UNION. A green migration run was never evidence the
-- resolver worked.
--
-- 0008 and 0010 are long shipped and are never edited (CLAUDE.md ->
-- Project Layout, the drizzle/ fix-forward rule). This is a new migration.
--
-- IDEMPOTENT AND CONVERGENT ON TWO STARTING STATES, by construction:
--   (a) a from-scratch database  — both group_id columns absent, both
--       NOT NULLs present;
--   (b) every already-drifted live branch — both group_id columns present
--       carrying Postgres's default-named plain FK
--       (`*_group_id_fkey`, i.e. a hand-run ALTER TABLE; drizzle-kit push
--       would have named them `..._group_id_groups_id_fk`), both NOT NULLs
--       already dropped.
-- Applying the whole file twice against either state leaves a byte-identical
-- catalog. Verified by a two-run apply + catalog diff, recorded in the
-- work-log's Phase 4 section.

-- ---------------------------------------------------------------------------
-- 1. Relax the two wrongly-NOT-NULL columns (F24, commit 8f358b6,
--    2026-08-17: "recorded_by/proposed_by were not null, making historical
--    import impossible; a church arriving with 20 years of session history
--    has no acting user").
--
--    Null is legitimate provenance, not missing data. Requiring a value here
--    pushes an importer toward inventing a fake user account, and it breaks
--    scripts/seed-dev.sql's `opening_balance` roll actions, which are
--    CORRECT as provenance-free. drizzle/0008 is already internally
--    inconsistent about this — `appointments.recorded_by` (0008:420) and
--    `background_checks.recorded_by` (0008:157) are nullable in the same
--    file; only officer_terms (0008:293) and roll_actions.proposed_by
--    (0008:259) are not.
--
--    The TS model never had the NOT NULL: src/lib/db/domain/officers.ts:124
--    and src/lib/db/domain/roll.ts:96 both already declare these nullable
--    with the F24 rationale in a comment. Only the SQL disagreed.
--
--    Naturally idempotent: dropping a NOT NULL that is already absent is a
--    no-op in Postgres, not an error.
-- ---------------------------------------------------------------------------
alter table officer_terms alter column recorded_by drop not null;
alter table roll_actions alter column proposed_by drop not null;

comment on column officer_terms.recorded_by is
  'Nullable (F24): an imported historical term has no acting user. A church '
  'arriving with twenty years of session history cannot invent one. Relaxed '
  'by drizzle/0050 to match the TS model and every live branch.';

comment on column roll_actions.proposed_by is
  'Nullable (F24): opening_balance and other imported roll actions predate '
  'the platform and have no acting user. Relaxed by drizzle/0050 to match '
  'the TS model and every live branch.';

-- ---------------------------------------------------------------------------
-- 2. administrative_commissions.group_id — add if absent, then re-point it
--    at a COMPOSITE foreign key.
--
--    F27: a commission is a BODY of people, not just a role. Its members are
--    a group at the PARENT council (the council reaching down), never at the
--    target it reaches into — src/lib/db/domain/authz.ts:196-198.
--
--    F2 / Composite Tenant Keys / Two Hierarchies Intersect Nowhere: the
--    plain `references groups(id)` that exists on live branches today is the
--    write-side hole F2 names. It lets a commission whose parent_org_id is
--    org A cite a group actually owned by an unrelated org C; RLS filters
--    reads but not that write. presby_effective_permissions()'s commission
--    arm would then grant A's role INSIDE TARGET ORG B to C's members — a
--    cross-council authority grant with no affiliation behind it. The
--    composite FK makes that unrepresentable in the database rather than on
--    paper.
--
--    Target exists: groups already carries `unique (id, organization_id)` as
--    groups_id_org_key (drizzle/0008:343).
--
--    Existing data is compatible — verified on the pipeline branch before
--    writing this file: 1 administrative_commissions row, 0 org_delegations
--    rows, no null group_id, and the one live row's group
--    (b0000000-...-0005) is owned by 11111111-..., which IS its
--    parent_org_id. No backfill, no data loss.
-- ---------------------------------------------------------------------------
alter table administrative_commissions add column if not exists group_id uuid;

-- The live, hand-created plain FK (state (b)). Absent on a fresh database.
alter table administrative_commissions
  drop constraint if exists administrative_commissions_group_id_fkey;
-- Anything a prior drizzle-kit push might have named it.
alter table administrative_commissions
  drop constraint if exists administrative_commissions_group_id_groups_id_fk;
-- This file's own constraint, so a second run re-adds an identical one
-- rather than erroring on the duplicate name.
alter table administrative_commissions
  drop constraint if exists administrative_commissions_group_id_parent_org_fkey;

alter table administrative_commissions
  add constraint administrative_commissions_group_id_parent_org_fkey
    foreign key (group_id, parent_org_id)
    references groups (id, organization_id);

comment on column administrative_commissions.group_id is
  'F27: the commission is a BODY of people, not just a role — a group at '
  'parent_org_id (the council reaching down), never at target_org_id. '
  'Composite FK to groups(id, organization_id) per F2 (drizzle/0050): a '
  'plain FK would let a commission cite a group owned by an unrelated third '
  'council, and the resolver would then grant the parent role inside the '
  'target org to that third council''s members.';

-- ---------------------------------------------------------------------------
-- 3. org_delegations.group_id — same treatment, mirrored onto the GRANTEE
--    side.
--
--    F27: "the presbytery administers our portal" means a specific staff
--    group at the presbytery, not everyone there — authz.ts:236-238. The
--    holders are a group at the grantee council, so the composite FK pairs
--    group_id with grantee_org_id.
-- ---------------------------------------------------------------------------
alter table org_delegations add column if not exists group_id uuid;

alter table org_delegations
  drop constraint if exists org_delegations_group_id_fkey;
alter table org_delegations
  drop constraint if exists org_delegations_group_id_groups_id_fk;
alter table org_delegations
  drop constraint if exists org_delegations_group_id_grantee_org_fkey;

alter table org_delegations
  add constraint org_delegations_group_id_grantee_org_fkey
    foreign key (group_id, grantee_org_id)
    references groups (id, organization_id);

comment on column org_delegations.group_id is
  'F27: which people at the GRANTEE council actually hold the delegation — '
  'a specific staff group, not everyone at the presbytery. Composite FK to '
  'groups(id, organization_id) per F2 (drizzle/0050): a plain FK would let a '
  'delegation cite a group at any org rather than specifically the grantee.';
