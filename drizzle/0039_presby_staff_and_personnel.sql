-- Staff and personnel: paid, non-ordained roles across congregation and
-- presbytery (docs/work-log/2026-08-27-staff-and-personnel.md, Phase 4
-- commit 1 (database-admin) / DECISION-128 (architect) / DECISION-129
-- (tech-lead)).
--
-- Four schema changes, landing together since they're one increment's schema
-- surface (Phase 3 Data Model):
--
--   1. `staff_positions` table — the DELIBERATELY orthogonal-to-officers.ts
--      "who is paid to work here" fact (never "who holds what constitutional
--      office"). organizationId is the employer, personId is F2 composite-FK'd
--      to memberships(personId, organizationId) — never bare people(id) — the
--      identical shape ordinations/officerTerms/appointments already ship in
--      src/lib/db/domain/officers.ts. FORCE ROW LEVEL SECURITY + the standard
--      tenant_isolation policy shape, matching every tenant table added since
--      the 0009 loop was frozen (0026, 0036, 0037 are the most recent
--      examples of this same single-table hand-written shape).
--   2. `staff_positions_no_overlap` GIST exclusion — the identical F22-shaped
--      pattern `officer_terms_no_overlap` already established
--      (drizzle/0009_presby_rls.sql:471-479): blocks a same-title double-open
--      for one person/org, permits different concurrent titles (custodian +
--      part-time secretary) and non-consecutive re-hire in the same title as
--      a new row. Keyed on positionKey (application-computed
--      position.trim().toLowerCase()), not the display-preserving `position`
--      column itself — same equality-normalization gap officer_terms.office
--      has always had, flagged by the architect's Phase 2 review as worth
--      closing here given staff titles are a much more open list than the
--      roughly-six conventional office values that made the gap tolerable
--      there. btree_gist is already enabled (0009); no re-create needed.
--   3. `staff.manage` permission-catalog row (module staff, tier 1) — gates
--      both read and write for v1, matching officers.manage/
--      credentials.manage's "no separate .view" shape.
--   4. `personnel_admin` TEMPLATE role row (organization_id IS NULL,
--      organization_type_scope IS NULL — universal, unlike
--      presbytery_stated_clerk's presbytery-only scope) + its
--      app_role_permissions binding to staff.manage. DECISION-078's
--      constitutional-duty test was run individually against every existing
--      office/role in the catalog (docs/decisions.md DECISION-129) and fails
--      all of them — no PC(USA) office's actual duty is personnel
--      administration — so this role carries NO default binding to any
--      existing office; it starts empty of any inherited grant and gets
--      staff.manage bound to IT specifically. Seeded via the already-wired
--      listTemplateRoles/adoptTemplate machinery (DECISION-109), so any
--      organization (congregation or presbytery) self-serve adopts it through
--      the existing /admin/roles/new UI — no bootstrap gap the way
--      stated_clerk/officers.manage still carry. Seeded directly here (global
--      catalog data, needs no organization to exist first), with a fixed id
--      so this insert is idempotent without relying on app_roles' non-unique-
--      across-NULL (organization_id, key) constraint — same precedent as
--      drizzle/0032_presby_role_definitions.sql's committee_chair template
--      row and drizzle/0037_presby_ministry_credentials.sql's
--      presbytery_stated_clerk template row. Next free fixed template id in
--      that same '00000000-0000-0000-0000-00000000000N' series is 3
--      (0001 = committee_chair, 0002 = presbytery_stated_clerk).
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.
--
-- Migration-numbering note: `ls drizzle/` immediately before this file was
-- written showed 0038_presby_presbytery_program.sql as the highest claimed
-- number, with no concurrent schema pipeline noted in docs/TODO.md's In
-- Flight section at the time of writing. This file claims 0039. A SECOND
-- concurrent pipeline (docs/work-log/2026-08-27-feature-categories.md /
-- DECISION-130) landed `drizzle/0040_presby_org_feature_categories.sql` in
-- the same working tree between that `ls` and this migration's completion —
-- caught via drizzle/meta/_journal.json (its idx-39 entry didn't match its
-- own 0040 filename) rather than a second `ls`. No filename collision
-- resulted (0039 and 0040 are both free, distinct numbers) — only
-- `_journal.json` needed a fix, applied here (this file's entry sequenced at
-- idx 39, ahead of 0040's, matching filename order). See docs/TODO.md's In
-- Flight for the caught-collision note, following the 0031/0035-0036
-- precedent of naming a near-collision rather than silently resolving it.

-- ---------------------------------------------------------------------------
-- 1. staff_positions table.
-- ---------------------------------------------------------------------------
create table if not exists staff_positions (
  id uuid primary key default gen_random_uuid(),
  -- The employer. No aboutOrg/servingOrg split (unlike appointments) —
  -- employment carries no constitutional-membership entanglement, so
  -- organization_id alone is sufficient for both congregation and
  -- presbytery employers.
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null,
  -- Free text — church staff titles are an open list (D8 governs
  -- tenant-defined SCHEMA, not an open string column; the identical shape
  -- officer_terms.office already ships under an F22 GIST exclusion).
  -- Display value, preserves the caller's casing.
  position text not null,
  -- position.trim().toLowerCase(), computed in application code before every
  -- insert — the GIST exclusion's actual equality column below. Never
  -- rendered; never independently editable.
  position_key text not null,
  department text,
  starts_on date not null,
  ends_on date,          -- null = open-ended
  end_reason text,
  minute_reference text,
  -- Nullable — same F24 reasoning as officer_terms.recorded_by: an imported
  -- historical position has no acting user to attribute it to.
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  constraint staff_positions_id_org_key unique (id, organization_id),
  constraint staff_positions_person_fk
    foreign key (person_id, organization_id)
    references memberships (person_id, organization_id)
);

create index if not exists staff_positions_org_person_idx
  on staff_positions (organization_id, person_id);
create index if not exists staff_positions_org_position_idx
  on staff_positions (organization_id, position_key, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- 2. F22-shaped GIST exclusion: no same-title double-open per person/org.
--    btree_gist already enabled by drizzle/0009_presby_rls.sql; re-issuing
--    the guard is idempotent and costs nothing if it's already there.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table staff_positions drop constraint if exists staff_positions_no_overlap;
alter table staff_positions add constraint staff_positions_no_overlap
  exclude using gist (
    organization_id with =,
    person_id       with =,
    position_key    with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[)') with &&
  );

-- ---------------------------------------------------------------------------
-- RLS: same loop-generated shape every post-0009 tenant table has hand-added
-- for itself, never an edit to the historical 0009 loop.
-- ---------------------------------------------------------------------------
alter table staff_positions enable row level security;
alter table staff_positions force row level security;

drop policy if exists tenant_isolation on staff_positions;
create policy tenant_isolation on staff_positions
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on staff_positions to presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. staff.manage permission-catalog row.
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier)
values ('staff.manage', 'staff',
        'Record and end paid, non-ordained staff positions for this organization',
        1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. personnel_admin TEMPLATE role row + its permission binding.
--    organization_id IS NULL, organization_type_scope IS NULL — universal
--    (congregation AND presbytery), unlike presbytery_stated_clerk's
--    presbytery-only scope. Readable by every tenant via the widened
--    app_roles SELECT policy (drizzle/0032_presby_role_definitions.sql),
--    adopted through the already-wired listTemplateRoles/adoptTemplate UI at
--    /admin/roles/new — no new backend or admin surface needed.
-- ---------------------------------------------------------------------------
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000003', null, null,
        'personnel_admin', 'Personnel Administrator', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000003', 'staff.manage')
on conflict (role_id, permission_key) do nothing;
