-- The permission resolver.
--
-- Answers "what may this person do at this organization, as of this date", and
-- returns WHERE each permission came from. Provenance is not decoration: a
-- union-based model is unauditable within a year without it, it powers the
-- "why can Jane see this" panel on /developer, and it is what makes an AI
-- support worker's access explainable rather than merely bounded.
--
-- FOUR ARMS. The first draft had two, and omitting the last two meant an
-- administrative commission granted nothing at all (F11).
--
--   direct      a role granted to the person at this org
--   group       a role granted to a group they belong to, INCLUDING the derived
--               Session and diaconate rosters (F3)
--   commission  a presbytery acting inside a congregation under original
--               jurisdiction
--   delegation  a congregation that asked another council to administer it
--
-- SECURITY DEFINER is load-bearing, for the reason F26 taught us the hard way:
-- arms 3 and 4 read groups and memberships at the PARENT org, which the target
-- org's RLS hides. Without it those arms silently return nothing — the same
-- failure mode as the membership guard, which read zero rows for exactly the
-- person it was protecting.
--
-- Because it is SECURITY DEFINER it must not become a fishing tool: it answers
-- only for the caller's current org context. Otherwise any tenant could probe
-- another council's role structure one call at a time.

create or replace function presby_effective_permissions(
  p_person_id uuid,
  p_organization_id uuid,
  p_as_of date default current_date
)
returns table (
  permission_key   text,
  sensitivity_tier smallint,
  source_kind      text,
  source_name      text,
  role_name        text,
  grant_id         uuid
)
language plpgsql stable security definer as $$
begin
  -- Guard against fishing. Platform access goes through presby_platform, which
  -- bypasses RLS and does not need this function.
  if presby_current_org() is distinct from p_organization_id then
    raise exception
      'presby_effective_permissions: may only be called for the current org context'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  -- 1. Direct grant to the person.
  select pm.key, pm.sensitivity_tier, 'direct'::text, r.name, r.name, rg.id
    from role_grants rg
    join app_roles r            on r.id = rg.role_id
    join app_role_permissions rp on rp.role_id = r.id
    join permissions pm          on pm.key = rp.permission_key
   where rg.organization_id = p_organization_id
     and rg.person_id = p_person_id
     and rg.starts_on <= p_as_of
     and (rg.ends_on is null or rg.ends_on > p_as_of)

  union
  -- 2. Via group membership. Derived rosters land here too, which is why F3
  --    materializes them into group_memberships instead of exposing a view —
  --    a view would be invisible to this join and an elder granted access
  --    through the Session group would resolve to nothing.
  select pm.key, pm.sensitivity_tier, 'group'::text, g.name, r.name, rg.id
    from role_grants rg
    join groups g                on g.id = rg.group_id
    join group_memberships gm    on gm.group_id = g.id
    join app_roles r             on r.id = rg.role_id
    join app_role_permissions rp on rp.role_id = r.id
    join permissions pm          on pm.key = rp.permission_key
   where rg.organization_id = p_organization_id
     and gm.person_id = p_person_id
     and rg.starts_on <= p_as_of and (rg.ends_on is null or rg.ends_on > p_as_of)
     and gm.starts_on <= p_as_of and (gm.ends_on is null or gm.ends_on > p_as_of)

  union
  -- 3. Administrative commission: the ONE case where a council reaches down
  --    into a congregation. Time-boxed, minuted, and visible in the
  --    congregation's own access log.
  select pm.key, pm.sensitivity_tier, 'commission'::text,
         'Administrative commission (' || ac.scope || ')', r.name, ac.id
    from administrative_commissions ac
    join groups g                on g.id = ac.group_id
    join group_memberships gm    on gm.group_id = g.id
    join app_roles r             on r.id = ac.role_id
    join app_role_permissions rp on rp.role_id = r.id
    join permissions pm          on pm.key = rp.permission_key
   where ac.target_org_id = p_organization_id
     and gm.person_id = p_person_id
     and ac.starts_on <= p_as_of and (ac.ends_on is null or ac.ends_on > p_as_of)
     and gm.starts_on <= p_as_of and (gm.ends_on is null or gm.ends_on > p_as_of)

  union
  -- 4. Delegation: the congregation ASKED another council to administer it.
  --    Granted by session action, revocable, never inherited.
  select pm.key, pm.sensitivity_tier, 'delegation'::text,
         'Delegated to ' || o.name, r.name, od.id
    from org_delegations od
    join organizations o         on o.id = od.grantee_org_id
    join groups g                on g.id = od.group_id
    join group_memberships gm    on gm.group_id = g.id
    join app_roles r             on r.id = od.role_id
    join app_role_permissions rp on rp.role_id = r.id
    join permissions pm          on pm.key = rp.permission_key
   where od.grantor_org_id = p_organization_id
     and gm.person_id = p_person_id
     and od.revoked_at is null
     and od.starts_on <= p_as_of and (od.ends_on is null or od.ends_on > p_as_of)
     and gm.starts_on <= p_as_of and (gm.ends_on is null or gm.ends_on > p_as_of);
end $$;

revoke all on function presby_effective_permissions(uuid, uuid, date) from public;
grant execute on function presby_effective_permissions(uuid, uuid, date) to presby_app;

-- Convenience predicate for route gates. Same guard, same four arms.
create or replace function presby_has_permission(
  p_person_id uuid,
  p_organization_id uuid,
  p_permission_key text,
  p_as_of date default current_date
)
returns boolean
language sql stable as $$
  select exists (
    select 1 from presby_effective_permissions(p_person_id, p_organization_id, p_as_of)
     where permission_key = p_permission_key
  );
$$;

revoke all on function presby_has_permission(uuid, uuid, text, date) from public;
grant execute on function presby_has_permission(uuid, uuid, text, date) to presby_app;
