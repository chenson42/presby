-- withOrgContext()'s membership check is unsatisfiable under RLS. This fixes it.
--
-- FOUND: 2026-08-18, in P0 slice C2, the first time anything in the application
-- opened an org-scoped page. Every authenticated visit to /o/<slug> by a
-- genuine member landed on the error boundary.
--
-- THE BUG, exactly. src/lib/authz.ts's withOrgContext() runs, in one
-- transaction and in this order:
--
--   1. select 1 from memberships
--       where person_id = $1 and organization_id = $2 and ended_on is null
--   2. select set_config('app.current_org_id', $2, true)
--   3. the caller's work
--
-- The ordering in step 1 is deliberate and correct: the check must not be
-- satisfiable by the very context it authorizes, so it runs BEFORE the GUC is
-- set (CLAUDE.md -> Isolation Is a Database Property). But `memberships` is
-- FORCE ROW LEVEL SECURITY with policy `organization_id = presby_current_org()`,
-- and with no GUC set presby_current_org() is null — so step 1 sees ZERO ROWS
-- for every person at every organization, and the function throws
-- OrgAccessError for the members it exists to admit. Measured as presby_app:
--
--   no GUC   -> 0 rows      with app.current_org_id set -> 1 row
--
-- THIS IS FINDING F26 IN ITS PUREST FORM. A query that must see across (or
-- before) org context, filtered by the RLS it exists to complement, silently
-- returning zero rows for exactly the case it guards — failing closed, looking
-- correct, and taking the feature with it. It is the third time this shape has
-- appeared in this schema (the roll-freeze probe, presby_two_factor_required,
-- and now this), which is why the answer here is the same one, not a workaround.
--
-- WHY NOT JUST SET THE GUC FIRST. It would work — the organization id is passed
-- explicitly, so RLS could not make a non-member's check pass. But it inverts
-- the one ordering CLAUDE.md names as an invariant, and it leaves an
-- unauthorized organization id sitting in a transaction-local GUC one careless
-- early-return away from being used. The ordering is worth keeping; the query
-- underneath it is what was wrong.
--
-- WHY SECURITY DEFINER IS SAFE HERE. The function takes both identifiers from
-- the caller and returns one boolean, so it can only ever confirm or deny a
-- pair the caller already named — it enumerates nothing and returns no row
-- data. EXECUTE is granted to presby_app alone, which already reaches the same
-- fact through presby_user_organizations(). Contrast
-- presby_guard_position_needs_membership() in 0014, which is deliberately NOT
-- definer because it reads rows at the same organization as the write that
-- triggered it and therefore already has the context it needs.

-- ---------------------------------------------------------------------------
-- presby_membership_is_active(person, organization)
-- ---------------------------------------------------------------------------
create or replace function presby_membership_is_active(
  p_person_id       uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from memberships m
     where m.person_id = p_person_id
       and m.organization_id = p_organization_id
       and m.ended_on is null
  );
$$;

comment on function presby_membership_is_active(uuid, uuid) is
  'Is this person''s relationship with this organization current? Asked by withOrgContext() BEFORE it sets app.current_org_id, which is the whole point: the gate must not be satisfiable by the context it authorizes. SECURITY DEFINER because memberships is FORCE RLS on organization_id = presby_current_org(), so with no GUC set a plain query returns zero rows for every member and the gate rejects everyone (F26). Safe as definer: both identifiers come from the caller and one boolean comes back, so it confirms a pair the caller already named and returns no row data. `ended_on is null` is the definition of current here and must stay identical to the predicate in presby_user_organizations() - if the two drift, a card appears for an organization the gate then refuses.';

revoke all on function presby_membership_is_active(uuid, uuid) from public;
grant execute on function presby_membership_is_active(uuid, uuid) to presby_app;
