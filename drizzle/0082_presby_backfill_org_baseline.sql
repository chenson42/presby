-- 0082: backfill the baseline setup for organizations created before
-- org provisioning seeded it (bug fix, found in production 2026-10-28;
-- docs/work-log/2026-10-28-org-baseline-backfill.md).
--
-- Every organization gets, at creation (src/lib/org-provisioning.ts,
-- groupSeedPlan()/baselineRoleSeedPlan()), a derived, protected "Active
-- Membership" roster group and a constitutional, protected "member" role
-- holding directory.view and events.view, granted to that group. An
-- organization created before that code existed (one presbytery in
-- production) has neither, so the founding-administrator invitation refuses
-- with provisioning_incomplete (src/lib/onboarding/issue.ts
-- provisioningComplete()).
--
-- This file adds exactly those two things, in that shape, to any
-- organization missing them. Congregation-only seats (session, diaconate,
-- deacons_moderator) were backfilled by 0062 and 0068 and are not touched.
-- An organization that already holds an org-owned `member` role is left
-- alone (a migration never adds authority to a tenant-held role; 0068's
-- rule). Idempotent: a second run inserts nothing. Apply WITH -1, as owner.
--
-- Derived group membership is materialized by trigger on memberships; an
-- organization with live memberships and no group would also need its rows
-- synced. The stop-block below refuses that case rather than guess, so the
-- file stays a pure baseline insert. (Production on 2026-10-28: the one
-- affected organization has 0 memberships.)

do $$
declare
  v_needs_sync bigint;
begin
  if not exists (select 1 from group_types where key = 'roster') then
    raise exception '0082: group type "roster" is missing';
  end if;
  select count(*) into v_needs_sync
    from organizations o
   where not exists (select 1 from groups g
                      where g.organization_id = o.id and g.derived_from = 'active_membership')
     and exists (select 1 from memberships m
                  where m.organization_id = o.id and m.ended_on is null);
  if v_needs_sync > 0 then
    raise exception '0082: % organization(s) lack the active_membership group but have live memberships; sync them deliberately, not here', v_needs_sync;
  end if;
end $$;

insert into groups (organization_id, group_type_id, name, membership_source,
                    derived_from, is_protected)
select o.id, gt.id, 'Active Membership', 'derived', 'active_membership', true
  from organizations o
  join group_types gt on gt.key = 'roster'
 where not exists (select 1 from groups g
                    where g.organization_id = o.id and g.derived_from = 'active_membership')
on conflict (organization_id, derived_from) do nothing;

do $$
declare
  v_org     record;
  v_role_id uuid;
  v_count   int := 0;
begin
  for v_org in
    select o.id as organization_id, g.id as group_id
      from organizations o
      join groups g on g.organization_id = o.id
                   and g.derived_from = 'active_membership'
                   and g.membership_source = 'derived'
     where not exists (select 1 from app_roles r
                        where r.organization_id = o.id and r.key = 'member')
     order by o.id
  loop
    insert into app_roles (organization_id, key, name, role_kind, is_protected)
    values (v_org.organization_id, 'member', 'Member', 'constitutional', true)
    returning id into v_role_id;

    insert into app_role_permissions (role_id, permission_key)
    values (v_role_id, 'directory.view'), (v_role_id, 'events.view');

    insert into role_grants (organization_id, role_id, group_id)
    values (v_org.organization_id, v_role_id, v_org.group_id);

    v_count := v_count + 1;
  end loop;
  raise notice '0082: baseline member role added for % organization(s)', v_count;
end $$;
