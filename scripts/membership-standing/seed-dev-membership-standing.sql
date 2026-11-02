-- scripts/membership-standing/seed-dev-membership-standing.sql
--
-- Community Increment 3a fixture (drizzle/0066_presby_membership_standing.sql,
-- DECISION-232). Run by scripts/seed-dev.sql's LAST include, as the owner.
--
-- Why it exists. On a database built from empty (db:migrate, then db:seed,
-- then seed-dev.sql), 0066 runs before any organization exists, so its
-- delimited backfill-calendar-viewer block inserts nothing. The seed then
-- creates the fixture organizations by raw SQL: the groups_pair_derived
-- trigger gives each one its all_memberships sibling, but nothing gives it the
-- calendar_viewer baseline role that createOrganization() seeds (Batch B) and
-- that 0066 backfilled on every existing database. This file closes that gap,
-- so the fixture matches provisioning and scripts/membership-standing/
-- test-rls-66.sql can assert events.view for a visitor.
--
-- The statement below is BYTE-IDENTICAL to 0066's `-- BEGIN
-- backfill-calendar-viewer` block (pinned by src/lib/membership-standing.db.
-- test.ts). It is idempotent: an organization that already holds an org-owned
-- calendar_viewer is never touched, and a second run inserts nothing.
-- Synthetic data only (No Real Data); it creates no person and no membership.

begin;

with targets as (
  select g.organization_id, g.id as group_id
    from groups g
   where g.derived_from = 'all_memberships'
     and g.membership_source = 'derived'
     and not exists (select 1 from app_roles r
                      where r.organization_id = g.organization_id and r.key = 'calendar_viewer')
), new_roles as (
  insert into app_roles (organization_id, key, name, role_kind, is_protected)
  select t.organization_id, 'calendar_viewer', 'Calendar viewer', 'constitutional', true
    from targets t
  on conflict (organization_id, key) do nothing
  returning id, organization_id
), new_permissions as (
  insert into app_role_permissions (role_id, permission_key)
  select nr.id, 'events.view' from new_roles nr
  on conflict (role_id, permission_key) do nothing
  returning role_id
)
insert into role_grants (organization_id, role_id, group_id, starts_on,
                         granted_by, grant_reason)
select nr.organization_id, nr.id, t.group_id, current_date, null,
       'Baseline calendar role: events.view for everyone with a current record (drizzle/0066, DECISION-232)'
  from new_roles nr
  join targets t on t.organization_id = nr.organization_id
 where exists (select 1 from new_permissions np where np.role_id = nr.id);

commit;
