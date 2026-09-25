-- drizzle/0048_presby_security_b.sql
--
-- Security review round B (docs/reviews/2026-09-25-security.md §B,
-- docs/reviews/2026-09-25-test-coverage.md C-3/C-4, external review F70).
-- Work-log: docs/work-log/2026-09-25-security-schema-b.md (Phase 3 design).
-- Whole-file idempotent; safe to re-run. Every statement is either
-- idempotent by nature or preceded by a `drop ... if exists`, and no
-- statement widens a privilege on a re-run.
--
-- *** MUST BE THE LAST FILE RE-APPLIED IF ANY EARLIER drizzle/*.sql FILE IS
-- *** RE-RUN AS PART OF DRIFT REMEDIATION (B-H1's own remediation shape).
-- *** `CREATE OR REPLACE FUNCTION` RESETS `proconfig` WHEN THE REPLACEMENT
-- *** CARRIES NO `SET` CLAUSE OF ITS OWN. Section 3 below `ALTER FUNCTION`s
-- *** fourteen functions defined in 0009/0010/0012/0013/0014/0015/0020/0021/
-- *** 0024/0028/0041/0042; re-running any of those files after this one
-- *** would silently strip the search_path clause this file installs.
-- *** scripts/test-rls.sql's proconfig assertion (section 39, added
-- *** alongside this file) is what catches that if it happens anyway.
--
-- Sections:
--   1. this header
--   2. B-H3  — the presby_app grant model, written down and narrowed
--   3. F70   — SET search_path = public, pg_temp on the fourteen 0001-0042
--              SECURITY DEFINER functions
--   4. B-H2  — app_role_permissions RLS + four policies
--   5. B-M4  — group_types policy split; B-L1 — de-dup + unique constraint
--   6. C-4/B-L3 — revoke both roll DEFINER functions from PUBLIC/presby_app
--   7. B-M3  — five composite tenant FKs; B-L6 — three missing FK indexes
--   8. N-6   — people.deletable_until + the owner-path BEFORE DELETE guard
--   9. Housekeeping notes

-- ---------------------------------------------------------------------------
-- 2. B-H3 — the auth-shell / platform-shell grant model.
--
-- Nothing in drizzle/ granted presby_app anything on the 22 platform-shell
-- tables the NextAuth adapter and recordAudit() write, so a database rebuilt
-- from the migration history alone fails at first sign-in. The live grants
-- were correct-but-undocumented on some tables and WIDER THAN NEEDED on
-- others. This section states the whole posture table by table; the revokes
-- below are the narrowing half and are the only non-no-op statements here.
--
-- F44 applies throughout: none of this binds getPlatformDb(), which connects
-- as neondb_owner and holds every privilege by ownership. A grant documents
-- intent and binds presby_app; only a trigger binds the owner.
--
-- The 25-name exemption list in section 39.5 of scripts/test-rls.sql (the C-3
-- inverted FORCE catch-all) is the same set of tables named here. The two
-- lists are literal and kept in sync by this comment: if you add a table to
-- one, add it to the other.
-- ---------------------------------------------------------------------------

-- Restated from drizzle/0009:37-45 (F25) so this file is a self-sufficient
-- statement of the posture rather than a delta against an untraced history.
-- Both are no-ops against the live database.
grant usage on schema public to presby_app, presby_platform;
grant usage, select on all sequences in schema public to presby_app, presby_platform;

-- Full CRUD. Measured 2026-09-25: every one of these 14 has an INSERT,
-- UPDATE or DELETE call site on `db` (= presby_app) today — src/auth.ts's
-- DrizzleAdapter (users/accounts/sessions/verification_tokens, including
-- deleteUser/unlinkAccount/deleteSession/useVerificationToken), plus
-- src/app/(account)/, src/app/(auth)/totp/, src/app/(admin)/admin/users/,
-- src/app/(password-reset)/ and src/lib/totp-pending.ts.
grant select, insert, update, delete on
  users, accounts, sessions, verification_tokens,
  user_totp, user_totp_recovery_codes, user_totp_pending_enrollments,
  password_reset_tokens, email_verification_tokens,
  user_roles, whats_new_entries, email_queue, feedback, feedback_prompt_state
to presby_app;

-- Append-only. Measured: src/lib/audit.ts, src/lib/email/queue.ts and
-- src/lib/rate-limit.ts INSERT only — there is no UPDATE or DELETE of
-- audit_events anywhere in src/. Append-only is an invariant (Workflow Rule
-- 7); make the grant state it.
grant select, insert on audit_events to presby_app;
revoke update, delete on audit_events from presby_app;

-- Not select-only: src/app/(admin)/admin/flags/actions.ts UPDATEs this on db.
-- No INSERT grant: the only INSERT into feature_flags outside a test is
-- scripts/seed.ts's seedFlags(), which moves to platformDb in the same
-- commit as this revoke (the two are one atomic unit — landing the revoke
-- alone breaks `npm run db:seed`).
grant select, update on feature_flags to presby_app;
revoke insert, delete on feature_flags from presby_app;

-- Global catalogs: code-seeded or migration-seeded, never tenant-writable.
-- scripts/seed.ts's seedRoles(), seedFeatures(), bindAdminFeatures() and
-- bindSupportOperatorFeatures() move to platformDb in the same commit, for
-- the same reason as seedFlags() above.
grant select on permissions, features, role_features, roles, migration_seeds to presby_app;
revoke insert, update, delete on permissions, features, role_features, roles, migration_seeds from presby_app;

-- The org tree: public information, SELECT-only for the tenant role.
-- Restated for completeness; already correct live (drizzle/0044 section 15).
grant select on organizations, organization_identifiers, organization_successions to presby_app;
-- sasr_form_versions carries no organization_id at all — a global catalog,
-- never a tenant table under any predicate (this is why it is NOT on the
-- FORCE catch-all's tenant-shaped exemption reasoning; it is on the list as
-- a global catalog, same class as `features`).
grant select on sasr_form_versions to presby_app;

-- ---------------------------------------------------------------------------
-- 3. F70 — `SET search_path = public, pg_temp` on every SECURITY DEFINER
--    function defined in the released migrations 0001-0042.
--
-- WHY `pg_temp` LAST, AND WHY `SET search_path = public` ALONE IS NOT THE
-- MITIGATION THIS PROJECT HAS BEEN TREATING IT AS: when pg_temp is not named
-- in search_path, PostgreSQL searches it FIRST, ahead of everything including
-- pg_catalog. TEMP is granted to PUBLIC by default and nothing in drizzle/
-- revokes it, so presby_app can create temporary objects. The architect's
-- Phase 2 §3 probe demonstrated this live: `presby_two_factor_required`
-- carries `SET search_path = public` and STILL resolved an unqualified
-- `people` to a caller-created `pg_temp.people` decoy — in the function that
-- decides whether a user must complete 2FA. Naming pg_temp explicitly, last,
-- pins it behind `public` and closes that.
--
-- Signatures were read from pg_proc on the live branch, not guessed from the
-- newest-looking migration file: presby_published_site and
-- presby_public_staff_roster are each defined in more than one migration.
-- presby_current_org() is NOT in this list and must not be added — it is
-- prosecdef = f (measured), so there is no definer privilege to escalate.
--
-- The nineteen 0043-0047 functions plus presby_affiliation_parent_as_of and
-- presby_assert_council_authority (21 by measurement on this branch) are
-- deliberately excluded from THIS file: they are owned by the lifecycle
-- pipeline's eleventh loop-back (F60), which pinned them to
-- `public, pg_temp` in place in drizzle/0043-0047 themselves. That landed on
-- main on 2026-09-25, together with the two cardinality wrappers F62
-- converted to DEFINER (23 in total), so the dated allow-list
-- scripts/test-rls.sql carried for them is gone: section 39.3 now asserts the
-- pin CATALOG-WIDE, and section 36 asserts it over those 23 by name.
-- ---------------------------------------------------------------------------

alter function presby_effective_permissions(uuid, uuid, date) set search_path = public, pg_temp;
alter function presby_guard_membership_insert() set search_path = public, pg_temp;
alter function presby_link_person(text, text, uuid, uuid) set search_path = public, pg_temp;
alter function presby_match_person(text, text, date, jsonb) set search_path = public, pg_temp;
alter function presby_reconcile_current_roll() set search_path = public, pg_temp;
alter function presby_roll_cache_drift() set search_path = public, pg_temp;
alter function presby_sync_current_roll() set search_path = public, pg_temp;
alter function presby_membership_is_active(uuid, uuid) set search_path = public, pg_temp;
alter function presby_person_unclaimed_or_own_org(uuid) set search_path = public, pg_temp;
alter function presby_public_committee_roster(text, text, boolean) set search_path = public, pg_temp;
alter function presby_public_staff_roster(text, text, boolean) set search_path = public, pg_temp;
alter function presby_published_site(text) set search_path = public, pg_temp;
alter function presby_two_factor_required(uuid) set search_path = public, pg_temp;
alter function presby_user_organizations(uuid) set search_path = public, pg_temp;

-- DELIBERATELY NOT DONE HERE: `revoke temporary on database ... from public`.
-- Phase 3 specified it as belt-and-braces on top of the pg_temp-last clause.
-- Measured 2026-09-25 on this branch: it breaks the isolation suite itself —
-- scripts/test-rls.sql:1292 does `create temporary table t20_fresh_person ...`
-- as presby_app, and under the revoke that raises
--   ERROR: permission denied to create temporary tables in database "neondb"
-- which, with \set ON_ERROR_STOP on, means every assertion after line 1292
-- never runs. That is the exact "part of the file ran, the corrected part did
-- not" failure mode B-H1 was. The architect's own Phase 2 §3 ruling is that
-- the pg_temp-last clause is the PRIMARY control and the revoke is
-- "secondary at best"; removing the suite's own temp table is a mid-file edit
-- to a shared file during a parallel pipeline (Workflow Rule 16), so it is
-- deferred to a non-parallel housekeeping pass and named in docs/TODO.md.
-- scripts/test-rls.sql section 39.2 asserts the TEMP privilege as a KNOWN-TRUE
-- fact so the next reader does not re-derive "safe" from the CREATE check
-- alone (which is precisely the reasoning B-M2 got wrong).

-- ---------------------------------------------------------------------------
-- 4. B-H2 — app_role_permissions had NO row-level security at all.
--
-- Measured before this file: relrowsecurity = f, relforcerowsecurity = f, zero
-- policies, presby_app = arwd. As presby_app under Alder Creek's context,
-- app_roles correctly filtered to 15 rows while app_role_permissions returned
-- all 71 — 43 of them bound to role_ids the session could not see — and an
-- INSERT naming one of those invisible role_ids succeeded.
--
-- Tenancy here is INDIRECT: the table has no organization_id of its own, so
-- the policy reaches through role_id -> app_roles, mirroring
-- drizzle/0032:89-106's app_roles_select split.
--
-- THIS BINDS presby_app AND NOTHING ELSE (F44). The owner write path
-- (getPlatformDb(), = neondb_owner, rolbypassrls = t) stays wide open, by
-- construction, and src/lib/org-provisioning.ts:407 depends on that. Closing
-- the owner path needs a trigger; it is named in docs/TODO.md and is not
-- built here. Do not read the policies below as "the write path is now
-- closed on every connection" — that is the sentence class B-H1 proved false.
-- ---------------------------------------------------------------------------

alter table app_role_permissions enable row level security;
alter table app_role_permissions force row level security;

drop policy if exists tenant_isolation on app_role_permissions;
drop policy if exists app_role_permissions_select on app_role_permissions;
drop policy if exists app_role_permissions_insert on app_role_permissions;
drop policy if exists app_role_permissions_update on app_role_permissions;
drop policy if exists app_role_permissions_delete on app_role_permissions;

-- `or r.organization_id is null` is LOAD-BEARING, not belt-and-braces: the
-- subquery reads app_roles under app_roles_select (which already admits
-- globals), but src/lib/role-definitions.ts:804's adoptTemplateRole() reads
-- the GLOBAL template's own bindings through permissionKeysForRole() on `tx`
-- before cloning them into the new org-scoped role. Drop this arm and
-- template adoption silently clones an empty permission set.
create policy app_role_permissions_select on app_role_permissions for select
  using (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and (r.organization_id = presby_current_org() or r.organization_id is null)
  ));

-- I/U/D are own-org only: a template's bindings are seeded by migration and
-- cloned on adoption, never written by a tenant.
create policy app_role_permissions_insert on app_role_permissions for insert
  with check (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ));

-- No live UPDATE caller (measured: role-definitions.ts uses INSERT and DELETE
-- only), but defined for consistency with every other RLS table's four-policy
-- shape. UPDATE stays revoked below, so this policy is inert until a future
-- caller and a future review deliberately grant it.
create policy app_role_permissions_update on app_role_permissions for update
  using (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ))
  with check (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ));

-- The DELETE arm is what setRolePermissions() (src/lib/role-definitions.ts:631)
-- needs to keep clearing removed bindings.
create policy app_role_permissions_delete on app_role_permissions for delete
  using (exists (
    select 1 from app_roles r
     where r.id = app_role_permissions.role_id
       and r.organization_id = presby_current_org()
  ));

grant select, insert, delete on app_role_permissions to presby_app;
revoke update on app_role_permissions from presby_app;

-- ---------------------------------------------------------------------------
-- 5. B-M4 + B-L1 — group_types.
--
-- group_types is classified as a tenant table (it is in drizzle/0009's
-- tenant_tables loop, FORCE RLS, nullable organization_id) while DECISION-110
-- ruling 1 makes it a GLOBAL CATALOG: `groups.group_type_id` always resolves
-- to a platform-wide template row, and 1563 of 1563 rows carry
-- organization_id IS NULL. That single misclassification is the common cause
-- of B-M4, B-L1 and the groups.group_type_id FK question in section 7.
-- Reclassifying the table to the `permissions` shape is the root-cause fix and
-- is named in docs/TODO.md; the policy split below is the correct in-scope
-- treatment of the symptom.
--
-- Mirrors drizzle/0032:89-106 exactly, in drizzle/0028's idempotent
-- single-table-override style. NEVER edit 0009's shared tenant_tables loop.
-- ---------------------------------------------------------------------------

drop policy if exists tenant_isolation on group_types;
drop policy if exists group_types_select on group_types;
drop policy if exists group_types_insert on group_types;
drop policy if exists group_types_update on group_types;
drop policy if exists group_types_delete on group_types;

create policy group_types_select on group_types for select
  using (organization_id = presby_current_org() or organization_id is null);
create policy group_types_insert on group_types for insert
  with check (organization_id = presby_current_org());
create policy group_types_update on group_types for update
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
create policy group_types_delete on group_types for delete
  using (organization_id = presby_current_org());
-- grant unchanged — already select, insert, update, delete to presby_app from
-- the 0009 loop; a policy split needs no new grant.

-- B-L1. Measured before this file: 1563 rows, 100% organization_id IS NULL,
-- 6 distinct keys, 1557 duplicates, with casing drift (roster/Roster,
-- court/Court, committee/Committee) and no created_at to order by.
--
-- Repoint every managed group to one canonical row per key BEFORE any row is
-- removed. Canonical = smallest id, a deliberate data-driven choice; the
-- survivor's display name is normalized separately below so the casing
-- lottery's outcome is not left as the permanent name.
--
-- Idempotent: on a second run there is exactly one row per key, so the
-- correlated `gt.id <> c.canonical_id` predicate matches nothing and both
-- statements report 0 rows.
with canonical as (
  -- (array_agg(id order by id))[1], not min(id): PostgreSQL has no min()
  -- aggregate for uuid (measured — `function min(uuid) does not exist`).
  -- array_agg with an explicit ORDER BY gives the same deterministic
  -- smallest-id choice.
  select key, (array_agg(id order by id))[1] as canonical_id
    from group_types
   where organization_id is null
   group by key
)
update groups g
   set group_type_id = c.canonical_id
  from group_types gt
  join canonical c on c.key = gt.key
 where g.group_type_id = gt.id
   and gt.organization_id is null
   and gt.id <> c.canonical_id;

delete from group_types gt
 using (
   select key, (array_agg(id order by id))[1] as canonical_id
     from group_types
    where organization_id is null
    group by key
 ) c
 where gt.organization_id is null
   and gt.key = c.key
   and gt.id <> c.canonical_id;

-- Normalize to scripts/seed.ts's seedGroupTypes() catalog values. Idempotent
-- by construction (a second run writes the same values).
update group_types set name = case key
  when 'court' then 'Court'
  when 'roster' then 'Roster'
  when 'committee' then 'Committee'
  when 'small_group' then 'Small Group'
  when 'choir' then 'Choir'
  when 'team' then 'Team'
  else name
end
where organization_id is null
  and name is distinct from (case key
    when 'court' then 'Court'
    when 'roster' then 'Roster'
    when 'committee' then 'Committee'
    when 'small_group' then 'Small Group'
    when 'choir' then 'Choir'
    when 'team' then 'Team'
    else name
  end);

-- NULLS NOT DISTINCT is required, not a stylistic choice: every row here is
-- global (organization_id IS NULL), and under the default NULLS DISTINCT a
-- plain `unique (organization_id, key)` constrains NOTHING for exactly the
-- rows that exist — which is how 1557 duplicates accumulated. PostgreSQL 18
-- on this branch, so the clause is available. drizzle/0032's own header
-- already names the NULL-distinctness trap.
--
-- group_types_org_idx (a plain, non-unique index on the same columns) is
-- dropped: the new constraint's own index supersedes it exactly.
drop index if exists group_types_org_idx;
alter table group_types drop constraint if exists group_types_org_key;
alter table group_types add constraint group_types_org_key
  unique nulls not distinct (organization_id, key);

-- ---------------------------------------------------------------------------
-- 6. C-4 + B-L3 — the two cross-org roll DEFINER functions leave the tenant
--    role's surface entirely.
--
-- presby_roll_cache_drift() is SECURITY DEFINER, has no presby_current_org()
-- predicate, and returned other organizations' memberships rows to a tenant
-- connection. Its sibling presby_reconcile_current_roll() is worse: a
-- parameterless cross-org WRITER of memberships.current_roll, and it was
-- live-called from src/app/api/cron/maintenance/route.ts on `db`.
--
-- Neither is the DECISION-135 sanctioned shape (derive the actor from
-- presby_current_org(), check standing, then act) and neither is F26's case
-- (a trigger that must see across orgs inside a guarded operation). Adding an
-- org predicate would keep a cross-org DEFINER reader on the tenant role's
-- attack surface to serve one test assertion. So: revoke, and move the one
-- real caller to the platform connection (that edit is in the same commit,
-- src/app/api/cron/maintenance/route.ts).
--
-- Neither function's EXECUTE was ever explicitly granted to PUBLIC in
-- drizzle/0012 — CREATE FUNCTION grants EXECUTE to PUBLIC by default, which
-- is the actual mechanism behind "granted to PUBLIC". There is no grant
-- statement to find and delete; an explicit revoke is the only way to close
-- it. neondb_owner is unaffected: an owner's privileges on its own objects
-- survive a revoke that does not name the owner.
-- ---------------------------------------------------------------------------

revoke all on function presby_reconcile_current_roll() from public, presby_app;
revoke all on function presby_roll_cache_drift() from public, presby_app;

-- ---------------------------------------------------------------------------
-- 7. B-M3 — five single-column tenant->tenant FKs become composite (F2);
--    B-L6 — the three FK columns with no index at all get one.
--
-- All five were verified zero-violation against live data before this file
-- was written (a direct join-and-count mirroring what ADD CONSTRAINT itself
-- checks). Re-run that check before applying to any other environment: a
-- violation there is a data-integrity problem this migration correctly
-- refuses to mask, not a migration bug.
--
-- DELIBERATELY EXCLUDED: `groups.group_type_id -> group_types`. It CANNOT be
-- composite and nobody should reopen it in a future F2 sweep. Under
-- DECISION-110 ruling 1 every group_types row is global
-- (organization_id IS NULL, 1563/1563 measured, 6/6 after section 5's
-- de-dup), and under MATCH SIMPLE a composite FK from a NOT NULL
-- groups.organization_id to a NULL parent organization_id matches nothing —
-- the constraint would reject every row in the table. The F2 hazard it would
-- close (a group in org B pointing at org A's type) cannot arise, because no
-- org-owned group type exists by design. See section 5's root-cause note.
-- ---------------------------------------------------------------------------

alter table events drop constraint if exists events_parent_event_id_fkey;
alter table events drop constraint if exists events_parent_fk;
alter table events add constraint events_parent_fk
  foreign key (parent_event_id, organization_id) references events (id, organization_id);
-- No new index: events_org_parent_idx (organization_id, parent_event_id)
-- already covers the access pattern.

alter table person_milestones drop constraint if exists person_milestones_roll_action_id_roll_actions_id_fk;
alter table person_milestones drop constraint if exists person_milestones_roll_action_fk;
alter table person_milestones add constraint person_milestones_roll_action_fk
  foreign key (roll_action_id, organization_id) references roll_actions (id, organization_id);
create index if not exists person_milestones_roll_action_idx on person_milestones (roll_action_id);

alter table publications drop constraint if exists publications_supersedes_id_fkey;
alter table publications drop constraint if exists publications_supersedes_fk;
alter table publications add constraint publications_supersedes_fk
  foreign key (supersedes_id, organization_id) references publications (id, organization_id);
-- No new index: publications_supersedes_idx and publications_supersedes_once_idx
-- both already lead with supersedes_id.

alter table roll_actions drop constraint if exists roll_actions_voids_action_id_roll_actions_id_fk;
alter table roll_actions drop constraint if exists roll_actions_voids_fk;
alter table roll_actions add constraint roll_actions_voids_fk
  foreign key (voids_action_id, organization_id) references roll_actions (id, organization_id);
create index if not exists roll_actions_voids_idx on roll_actions (voids_action_id);

-- role_grants.role_id -> app_roles. The security review called this a design
-- decision; it isn't. src/lib/role-definitions.ts:771-850 ADOPTS a template by
-- CLONING it into a new org-scoped app_roles row — a template is never granted
-- directly. Measured: 15 role_grants rows, 0 referencing a global role, 0
-- cross-org. With role_grants.organization_id NOT NULL and default MATCH
-- SIMPLE, the composite FK admits every legal row AND enforces
-- clone-not-grant AT THE DATABASE, converting a code convention into a
-- database property. app_roles needs (id, organization_id) unique first
-- (measured absent — only app_roles_org_key (organization_id, key) existed).
--
-- The ON DELETE CASCADE reproduces the single-column FK's existing behaviour
-- exactly. Do NOT "improve" it to RESTRICT here — that is a separate,
-- already-tracked decision (drizzle/0032's own header names it) and changing
-- it in this diff would conflate two unrelated risk calls.
--
-- ORDER MATTERS FOR THE SECOND RUN: role_grants_role_fk DEPENDS on
-- app_roles_id_org_key, so the dependent FK has to be dropped before the
-- unique constraint it references. Written add-after-drop in that order
-- rather than `if not exists`-style precisely so a re-apply converges instead
-- of raising "cannot drop constraint ... because other objects depend on it".
alter table role_grants drop constraint if exists role_grants_role_id_app_roles_id_fk;
alter table role_grants drop constraint if exists role_grants_role_fk;

alter table app_roles drop constraint if exists app_roles_id_org_key;
alter table app_roles add constraint app_roles_id_org_key unique (id, organization_id);

alter table role_grants add constraint role_grants_role_fk
  foreign key (role_id, organization_id) references app_roles (id, organization_id) on delete cascade;
create index if not exists role_grants_role_idx on role_grants (role_id);

-- ---------------------------------------------------------------------------
-- 8. N-6 — people gets the owner-path BEFORE DELETE guard organizations
--    already has.
--
-- people is presby_app = arw (drizzle/0009:376 already clawed DELETE back) and
-- carried ZERO triggers. So "Never Hard-Delete a Person" was enforced on the
-- tenant connection by a grant and on the owner connection by nothing at all —
-- and getPlatformDb() connects as neondb_owner, whom no grant binds (F44). A
-- BEFORE DELETE trigger is the only control that reaches that path:
-- BYPASSRLS and ownership bypass RLS, never triggers.
--
-- The fixture exemption is the same persisted-column mechanism organizations
-- uses (D10, drizzle/0044), NOT a transaction-local GUC arm: a GUC any
-- owner-connection caller can set is a weaker control than a per-row claim
-- stamped at creation, and consistency with the organizations precedent is
-- worth a column.
-- ---------------------------------------------------------------------------

alter table people add column if not exists deletable_until timestamptz;
comment on column people.deletable_until is
  'Test-fixture deletion window, and NOTHING else — the people-table twin of organizations.deletable_until (drizzle/0044). presby_guard_people_delete() permits a DELETE only while this is non-null and in the future, so a stale marker does not grant permanent deletability. Production person rows never carry a value here: a person who leaves is a roll action (transfer/death/removal), never a deleted row, and the one other legitimate reason a row disappears from view is merged_into_id — which is a MERGE, and a merge is followed as a chain.';

create or replace function presby_guard_people_delete()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.deletable_until is null or old.deletable_until <= now() then
    raise exception
      'people: a person record is never hard-deleted; record a merge instead (merged_into_id)'
      using errcode = 'insufficient_privilege';
  end if;
  -- UNLIKE presby_guard_organizations_delete(): NO set_config calls here, and
  -- that is measured, not an oversight. people's six ON DELETE CASCADE
  -- children — addresses, contact_methods, memberships, person_identifiers,
  -- person_relationships, transfer_certificates — carry no BEFORE DELETE
  -- guard of their own (measured 2026-09-25; memberships' three triggers are
  -- BEFORE INSERT / BEFORE UPDATE / AFTER INSERT-OR-UPDATE). There is nothing
  -- to pre-authorize. If a future pipeline adds a BEFORE DELETE guard to any
  -- of those six, this function needs the same set_config arming the
  -- organizations guard carries — find it here rather than re-deriving the gap.
  return old;
end $$;

drop trigger if exists people_guard_delete on people;
create trigger people_guard_delete
  before delete on people
  for each row execute function presby_guard_people_delete();

-- ---------------------------------------------------------------------------
-- 9. Housekeeping
--
-- * drizzle/meta/_journal.json gains this file's own entry
--   ({ idx: 48, tag: "0048_presby_security_b" }) as an ordinary append.
--   B-L4's three missing back-fill entries (idx 26/27/28) are a MID-ARRAY
--   insert into a shared, idx-ordered file and are applied by the
--   orchestrator at integration, not on this branch (Workflow Rule 16).
-- * The two source comments that name the wrong role — src/lib/db/index.ts:12
--   and scripts/seed.ts:43 — are corrected in the same commit. getPlatformDb()
--   connects as neondb_owner; presby_platform exists in the catalog but is
--   rolcanlogin = false and nothing has ever connected as it (DECISION-146).
-- * scripts/test-rls.sql section 39 is the assertion half of this file. It
--   deletes the old :414-418 presby_roll_cache_drift() call (section 6 above
--   revokes presby_app's EXECUTE, so leaving it is a hard break, not a stale
--   comment) and adds the C-3 inverted FORCE catch-all, the F70 proconfig
--   assertion, and one grant-shape assertion per B-H3 table class.
-- ---------------------------------------------------------------------------
