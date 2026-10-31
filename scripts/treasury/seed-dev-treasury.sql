-- ---------------------------------------------------------------------------
-- Reimbursements dev fixture (drizzle/0073_presby_reimbursements.sql and
-- drizzle/0074_presby_reimbursement_permissions.sql;
-- docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Files to create",
-- Phase 4 Batch 1a).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE include, after the
-- person-emails include (this file needs Alder Creek's people, groups and
-- the giving fixture's treasurer role):
--
--     \ir treasury/seed-dev-treasury.sql
--
-- (staged in docs/work-log/treasury-inc1.integration.patch). Until then,
-- standalone, AS THE OWNER, after drizzle/0073 and 0074:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/treasury/seed-dev-treasury.sql
--
-- Idempotent: fixed ids and `on conflict do nothing`. Synthetic data only
-- (No Real Data): the seed's invented people. It adds NO people or
-- memberships, so no roster or people count asserted elsewhere moves. It adds
-- ONE user, p73.rowan@example.invalid, linked to Rowan Thistlewood (c...0006),
-- for scripts/treasury/test-rls-73.sql section 73e: since drizzle/0065 (F186)
-- presby_app may not write people.user_id, so the link is the owner's, here.
--
-- What it adds (Alder Creek, 22222222-...):
--   * the four reimbursement keys on Alder's treasurer role (f...0007, held
--     by Priya Balakrishnan). On a database that already had the role when
--     0074 ran, 0074's backfill bound them; on a fresh database the seed
--     runs after the migrations, so the backfill found no role and this
--     restates it (the shape 0074 would have written).
--   * the org_portal.reimbursement toggle ON (a missing row is off).
--   * Tobias Renwick (c...0002, clerk.fixture) as CHAIR of the managed
--     Property Committee (b...0004), so the committee has an eligible
--     approver; the committee and the derived Session (b...0001, no chair:
--     the override path, operator Q5) are chargeable.
--   * two categories, "Building supplies" and "Hospitality".
--   * the p73.rowan@ user, linked to Rowan (the 73e cross-org actor).
-- No request rows: requests are written only through the definers, and
-- scripts/treasury/test-rls-73.sql builds its own inside rolled-back
-- transactions.
-- ---------------------------------------------------------------------------
begin;

insert into app_role_permissions (role_id, permission_key)
select 'f0000000-0000-0000-0000-000000000007', k.key
  from (values ('reimbursement.request_for_others'), ('reimbursement.view'),
               ('reimbursement.pay'), ('reimbursement.manage')) as k(key)
 where exists (select 1 from app_roles r where r.id = 'f0000000-0000-0000-0000-000000000007'
                and r.key = 'treasurer' and r.role_kind = 'constitutional' and r.is_protected)
on conflict (role_id, permission_key) do nothing;

insert into organization_feature_toggles (organization_id, feature_key, enabled)
values ('22222222-2222-2222-2222-222222222222', 'org_portal.reimbursement', true)
on conflict (organization_id, feature_key) do nothing;

insert into group_memberships (id, organization_id, group_id, person_id, group_role, source, starts_on)
values ('a7300000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222',
        'b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002',
        'chair', 'managed', '2024-01-01')
on conflict (id) do nothing;

insert into reimbursement_chargeable_groups (id, organization_id, group_id, created_by_user, created_at)
values
  ('a7300000-0000-4000-8000-000000000011', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-0000000000f3', '2026-01-05T15:00:00Z'),
  ('a7300000-0000-4000-8000-000000000012', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000f3', '2026-01-05T15:00:00Z')
on conflict (id) do nothing;

insert into reimbursement_categories (id, organization_id, name, sort_order, created_by_user, created_at)
values
  ('a7300000-0000-4000-8000-000000000021', '22222222-2222-2222-2222-222222222222',
   'Building supplies', 10, 'e0000000-0000-0000-0000-0000000000f3', '2026-01-05T15:00:00Z'),
  ('a7300000-0000-4000-8000-000000000022', '22222222-2222-2222-2222-222222222222',
   'Hospitality', 20, 'e0000000-0000-0000-0000-0000000000f3', '2026-01-05T15:00:00Z')
on conflict (id) do nothing;

-- Section 73e's actor: Rowan is a live member of Alder Creek and the
-- Presbytery of the Northern Reach. The link is written here, on the owner
-- path, because presby_app may not write people.user_id (drizzle/0065, F186).
-- Only when Rowan is unlinked, so a re-run (or a link made some other way) is
-- left alone.
insert into users (id, email, name)
values ('a7399999-0000-4000-8000-0000000000e1', 'p73.rowan@example.invalid', 'P73 Fixture')
on conflict (id) do nothing;
update people set user_id = 'a7399999-0000-4000-8000-0000000000e1'
 where id = 'c0000000-0000-0000-0000-000000000006' and user_id is null;

commit;
