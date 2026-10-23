-- drizzle/0060_presby_designation_revoke.sql
--
-- Designation-holder revoke: a platform admin may end the current holders of
-- an organization's founding-administrator or treasurer slot from
-- /admin/organizations/<id>, as lockout recovery
-- (docs/work-log/2026-10-22-designation-revoke.md: Phase 2 D1/D3/D4/D5/D6,
-- Phase 3 "Data Model" sections 1-4; DECISION-194/195/196, findings
-- F169/F170/F171).
--
-- A FIX-FORWARD on 0059 (v0.37.0 is shipped), not an in-place correction.
-- Functions only: no table, column, index, policy, trigger or table grant
-- changes, and no change to 0014's DECISION-039 guards.
--
-- Four things, in dependency order (a `language sql` body is validated at
-- create, so the lists must exist before the counts that read them):
--
--   1. list functions        presby_founding_administrator_holder_grants,
--                            presby_giving_manage_holder_grants: one row per
--                            (contributing grant, holder person). THE single
--                            source for "who holds this slot" (D1, F169).
--   2. counts, derived       presby_founding_administrator_holder_count and
--                            presby_giving_manage_holder_count redefined as
--                            count(distinct holder_person_id) over the lists.
--                            Same signatures; callers (issue.ts, the 0059
--                            apply helpers, presby_accept_invitation, the TS
--                            count* wrappers) are untouched. Proof of
--                            identical behaviour: invitations.db.test.ts's
--                            count pin passes UNCHANGED.
--   3. companion grants      presby_founding_administrator_companion_grants:
--                            the stated-clerk office grant the designation
--                            wrote beside the bundle (D3). A separate
--                            function so a companion never counts as a holder.
--   4. the revoke            presby_revoke_designation_holder: the ONLY
--                            platform-side writer of role_grants.ends_on
--                            (D5, D4, D6). Org lock first, derive, row locks
--                            re-filtering effectiveness, compare against the
--                            ids the dialog displayed, clamp ends_on to the
--                            membership end (F171), idempotent outcomes.
--
-- All five new functions: SECURITY DEFINER (they read FORCE-RLS tables across
-- the org on behalf of the platform: F26), `set search_path = public,
-- pg_temp` (DECISION-148, pg_temp last), EXECUTE revoked from PUBLIC,
-- presby_app and presby_platform. Owner only, because a cross-org holder list
-- is an oracle (the 0059 section 5 precedent). There is NO `grant execute` in
-- this file. The audit row is NOT written here: the platform library writes
-- it in the SAME transaction as the function call (the issue.ts precedent).
--
-- IDEMPOTENT: every statement is `create or replace`, revoke, or `comment
-- on`, so the whole file replays cleanly. Proven by applying the whole file
-- twice (work-log, Phase 4 Batch A).
--
-- TRANSACTION HANDLING: this file carries NO begin/commit of its own (no
-- function is dropped and re-created). Apply it with `-1` so it lands
-- atomically:
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0060_presby_designation_revoke.sql
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md). No Drizzle mirror change: no table shape
-- changes (role_grants stays as src/lib/db/domain/authz.ts declares it).
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No change to the founding-administrator count's asymmetry (group arm
--     with no gm.starts_on check, no memberships join, merged people counted).
--     It is kept word for word (D1): it is what makes ghost holders VISIBLE
--     on the list, and therefore revocable. Changing the gate is the separate
--     ruling docs/TODO.md tracks.
--   * No ended_by / ended_reason columns on role_grants (Q7: audit only).
--   * No write to officer_terms, group_memberships, memberships,
--     account_invitations or audit_events. Open invitations are LEFT OPEN
--     (Q8); their ids are reported for the audit row only.

-- ---------------------------------------------------------------------------
-- 1. list functions (owner only): the single source (D1, F169)
-- ---------------------------------------------------------------------------
-- Each body is its 0059 count's predicates, word for word, with ONE mechanical
-- change: the permission test is `exists (select 1 from app_role_permissions
-- ...)` instead of a join, so a role carrying BOTH manage keys yields one row
-- per (grant, holder), not two. That is set-equal to the old join (whose
-- count(distinct) was already hiding the duplication). `union` (not `union
-- all`) collapses a holder with two open rows in one group to one row.
--
-- The joins to app_roles and groups filter nothing: role_grants_role_fk and
-- role_grants_group_fk are composite (id, organization_id), so every grant's
-- role and group exist at the same organization. They only add names.

-- 1a. Founding administrator (0059:466-485 lifted). Person-arm grants
-- directly; group-arm grants through open group_memberships with NO
-- gm.starts_on check, NO memberships join and NO merged-person exclusion:
-- the asymmetry, kept deliberately (D1).
create or replace function presby_founding_administrator_holder_grants(p_org uuid)
returns table (
  grant_id uuid,
  role_id uuid,
  role_key text,
  role_name text,
  arm text,                       -- 'person' | 'group'
  subject_person_id uuid,         -- set when arm = 'person'
  group_id uuid,                  -- set when arm = 'group'
  group_name text,                -- set when arm = 'group'
  group_membership_source text,   -- groups.membership_source: 'managed' | 'derived'
  holder_person_id uuid,          -- the person this row attributes the grant to
  grant_starts_on date,
  grant_reason text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with active_manage_grants as (
    select rg.id as grant_id, rg.role_id, rg.person_id, rg.group_id,
           rg.starts_on, rg.grant_reason
      from role_grants rg
     where rg.organization_id = p_org
       and exists (select 1 from app_role_permissions arp
                    where arp.role_id = rg.role_id
                      and arp.permission_key in ('roles.manage', 'role_grants.manage'))
       and rg.starts_on <= current_date
       and (rg.ends_on is null or rg.ends_on > current_date)
  )
  select amg.grant_id, amg.role_id, r.key, r.name,
         'person'::text, amg.person_id,
         null::uuid, null::text, null::text,
         amg.person_id, amg.starts_on, amg.grant_reason
    from active_manage_grants amg
    join app_roles r on r.id = amg.role_id
   where amg.person_id is not null
  union
  select amg.grant_id, amg.role_id, r.key, r.name,
         'group'::text, null::uuid,
         amg.group_id, g.name, g.membership_source,
         gm.person_id, amg.starts_on, amg.grant_reason
    from active_manage_grants amg
    join app_roles r on r.id = amg.role_id
    join groups g on g.id = amg.group_id and g.organization_id = p_org
    join group_memberships gm on gm.group_id = amg.group_id
   where amg.group_id is not null
     and gm.organization_id = p_org
     and gm.ends_on is null;
$function$;

-- 1b. Treasurer (0059:498-525 lifted). giving.manage; person arm and group
-- arm (gm.starts_on <= current_date, open gm.ends_on), then restricted to
-- holders who are non-merged people with an open membership at p_org:
-- membership-aware, as before. Consequence (named residual, DECISION-196): a
-- person-arm giving.manage grant whose holder's membership ended is not
-- counted, not listed and not revocable here (list = count by construction).
create or replace function presby_giving_manage_holder_grants(p_org uuid)
returns table (
  grant_id uuid,
  role_id uuid,
  role_key text,
  role_name text,
  arm text,
  subject_person_id uuid,
  group_id uuid,
  group_name text,
  group_membership_source text,
  holder_person_id uuid,
  grant_starts_on date,
  grant_reason text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with manage_grants as (
    select rg.id as grant_id, rg.role_id, rg.person_id, rg.group_id,
           rg.starts_on, rg.grant_reason
      from role_grants rg
     where rg.organization_id = p_org
       and exists (select 1 from app_role_permissions arp
                    where arp.role_id = rg.role_id
                      and arp.permission_key = 'giving.manage')
       and rg.starts_on <= current_date
       and (rg.ends_on is null or rg.ends_on > current_date)
  ),
  holder_rows as (
    select mg.grant_id, mg.role_id, 'person'::text as arm, mg.person_id as subject_person_id,
           null::uuid as group_id, mg.person_id as pid, mg.starts_on, mg.grant_reason
      from manage_grants mg
     where mg.person_id is not null
    union
    select mg.grant_id, mg.role_id, 'group'::text, null::uuid,
           mg.group_id, gm.person_id, mg.starts_on, mg.grant_reason
      from manage_grants mg
      join group_memberships gm on gm.group_id = mg.group_id
     where mg.group_id is not null
       and gm.organization_id = p_org
       and gm.starts_on <= current_date
       and (gm.ends_on is null or gm.ends_on > current_date)
  )
  select hr.grant_id, hr.role_id, r.key, r.name,
         hr.arm, hr.subject_person_id,
         hr.group_id, g.name, g.membership_source,
         hr.pid, hr.starts_on, hr.grant_reason
    from holder_rows hr
    join app_roles r on r.id = hr.role_id
    left join groups g on g.id = hr.group_id and g.organization_id = p_org
    join people p on p.id = hr.pid and p.merged_into_id is null
    join memberships m on m.person_id = hr.pid
     and m.organization_id = p_org
     and m.ended_on is null;
$function$;

revoke all on function presby_founding_administrator_holder_grants(uuid) from public, presby_app, presby_platform;
revoke all on function presby_giving_manage_holder_grants(uuid) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 2. counts, derived from the lists (D1, F169)
-- ---------------------------------------------------------------------------
-- Same signatures, still `returns integer language sql stable security
-- definer`, so `create or replace` keeps their owner and ACL; the revokes are
-- restated anyway so this file alone states the posture. "N people hold this"
-- and "N rows to act on" are now one expression: a drift cannot be written.
create or replace function presby_founding_administrator_holder_count(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select count(distinct h.holder_person_id)::int
    from presby_founding_administrator_holder_grants(p_org) h;
$function$;

create or replace function presby_giving_manage_holder_count(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select count(distinct h.holder_person_id)::int
    from presby_giving_manage_holder_grants(p_org) h;
$function$;

revoke all on function presby_founding_administrator_holder_count(uuid) from public, presby_app, presby_platform;
revoke all on function presby_giving_manage_holder_count(uuid) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 3. companion grants (founding administrator only; D3)
-- ---------------------------------------------------------------------------
-- The person-arm, currently effective grants at p_org for p_person_id that
-- presby_apply_founding_administrator wrote BESIDE the bundle: reason
-- 'founding administrator designation' and an org-scoped office role keyed
-- congregation_stated_clerk / presbytery_stated_clerk. As templated, neither
-- office role carries roles.manage or role_grants.manage, so it never counts;
-- a custom clerk role that DOES carry one is a contributing grant (it is in
-- the list) and is excluded here, so contributing and companion are disjoint.
create or replace function presby_founding_administrator_companion_grants(p_org uuid, p_person_id uuid)
returns table (
  grant_id uuid,
  role_id uuid,
  role_key text,
  role_name text,
  grant_starts_on date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select rg.id, rg.role_id, r.key, r.name, rg.starts_on
    from role_grants rg
    join app_roles r on r.id = rg.role_id and r.organization_id = p_org
   where rg.organization_id = p_org
     and rg.person_id = p_person_id
     and rg.grant_reason = 'founding administrator designation'
     and r.key in ('congregation_stated_clerk', 'presbytery_stated_clerk')
     and rg.starts_on <= current_date
     and (rg.ends_on is null or rg.ends_on > current_date)
     and rg.id not in (select h.grant_id from presby_founding_administrator_holder_grants(p_org) h)
   order by rg.id;
$function$;

revoke all on function presby_founding_administrator_companion_grants(uuid, uuid) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 4. the revoke (DECISION-196; D4, D5, D6)
-- ---------------------------------------------------------------------------
-- The ONLY platform-side writer of role_grants.ends_on, and the only write it
-- makes (a test scans pg_get_functiondef to keep that true). The caller (the
-- platform library, on getPlatformDb()) supplies only the org, the slot, the
-- subject and the grant ids its dialog displayed; it writes the audit row in
-- the same transaction, and only on 'revoked'.
--
-- Outcomes (one row; every column after `outcome` is null unless 'revoked'):
--   revoked                 the subject's contributing grants (and, for a
--                           founding-administrator person, the companion)
--                           were end-dated
--   already_removed         nothing effective is left to end, and one of the
--                           displayed ids is this subject's grant at this org
--                           that has since been ended (double submit; the
--                           org-side revokeRole() won the race). No write.
--   changed                 the effective set differs from the displayed set
--                           (a grant appeared, one was ended, or the
--                           companion was not displayed). No write: the
--                           operator never ends a grant the dialog did not
--                           name.
--   not_a_holder            the subject contributes nothing at this org
--                           (never held; another org's subject or grant id).
--                           Neutral: no oracle.
--   derived_group_refused   a group subject whose roster is derived (session,
--                           diaconate, active_membership): D6 as a database
--                           property, not only a hidden button.
--   not_applicable          treasurer slot at an org type outside
--                           congregation / new_worshiping_community
--   no_organization         no such organization (a forged org id)
-- Programmer errors RAISE invalid_parameter_value: an unknown slot or subject
-- kind, or a null/empty expected list (the action validates first).
--
-- LOCK ORDER: the organization row FOR UPDATE first, the same first lock as
-- presby_accept_invitation step 2 and issue.ts lockOrganization. Revoke takes
-- no invitation, users or people lock, so the global order org -> invitation
-- -> users -> person holds and revoke serializes against accept and issue on
-- the org row. Then the grant rows FOR UPDATE; under READ COMMITTED the lock
-- re-evaluates the effectiveness predicate on a row a concurrent org-side
-- revokeRole() just ended, and drops it. The org side never takes the org
-- lock, so there is no cycle.
--
-- F171 / D4: a person-arm grant's end date is least(current_date,
-- memberships.ended_on). role_grants_needs_membership (0014) raises only when
-- ends_on > the membership end; the clamp is never greater, so the guard
-- cannot fire and 0014 is untouched (its own hint: "record the position as
-- already ended"). role_grants_person_fk guarantees the membership row, and
-- memberships_person_org_key makes it unique, so the join neither drops nor
-- duplicates a grant. Group-arm grants get current_date (the guard returns
-- early for a null person_id).
--
-- Zero holders is reachable (G8: recovery). The org-side self_lockout_blocked
-- rule is not applied. Accepted residual: an org-side grantRole() takes no
-- org lock, so holder_count_after can be stale by one concurrent tenant grant.
create or replace function presby_revoke_designation_holder(
  p_org uuid,
  p_slot text,
  p_subject_kind text,
  p_subject_id uuid,
  p_expected_grant_ids uuid[]
)
returns table (
  outcome text,
  grant_ids uuid[],                 -- every grant ended, ordered by id
  role_keys text[],                 -- parallel to grant_ids
  applied_ends_on date[],           -- parallel to grant_ids
  clamped_to_membership_end boolean,
  companion_grant_ids uuid[],       -- the subset of grant_ids that are companions
  revoked_holder_person_ids uuid[],
  holder_count_before integer,
  holder_count_after integer,
  open_invitation_ids uuid[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_org_type text;
  v_found boolean;
  v_contrib uuid[];
  v_companion uuid[] := array[]::uuid[];
  v_all uuid[];
  v_expected uuid[];
  v_locked uuid[];
  v_derived boolean;
  v_ended_ids uuid[];
  v_ended_dates date[];
begin
  -- 1. Programmer errors.
  if p_slot is null or p_slot not in ('founding_administrator', 'treasurer') then
    raise exception 'presby_revoke_designation_holder: unknown slot %', p_slot
      using errcode = 'invalid_parameter_value';
  end if;
  if p_subject_kind is null or p_subject_kind not in ('person', 'group') then
    raise exception 'presby_revoke_designation_holder: unknown subject kind %', p_subject_kind
      using errcode = 'invalid_parameter_value';
  end if;
  if p_org is null or p_subject_id is null then
    raise exception 'presby_revoke_designation_holder: organization and subject are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_expected_grant_ids is null or coalesce(cardinality(p_expected_grant_ids), 0) = 0
     or array_position(p_expected_grant_ids, null) is not null then
    raise exception 'presby_revoke_designation_holder: the displayed grant ids are required'
      using errcode = 'invalid_parameter_value';
  end if;
  select array_agg(distinct e order by e) into v_expected from unnest(p_expected_grant_ids) e;

  -- 2. Organization row first.
  select o.organization_type::text, true into v_org_type, v_found
    from organizations o where o.id = p_org
     for update;
  if v_found is null then
    outcome := 'no_organization';
    return next;
    return;
  end if;

  -- 3. Treasurer applies to congregations and new worshiping communities only.
  if p_slot = 'treasurer' and v_org_type not in ('congregation', 'new_worshiping_community') then
    outcome := 'not_applicable';
    return next;
    return;
  end if;

  -- 4. Derive, after the lock (a fresh snapshot).
  if p_slot = 'founding_administrator' then
    select array_agg(distinct h.grant_id order by h.grant_id),
           bool_or(h.group_membership_source = 'derived')
      into v_contrib, v_derived
      from presby_founding_administrator_holder_grants(p_org) h
     where (p_subject_kind = 'person' and h.arm = 'person' and h.subject_person_id = p_subject_id)
        or (p_subject_kind = 'group' and h.arm = 'group' and h.group_id = p_subject_id);
  else
    select array_agg(distinct h.grant_id order by h.grant_id),
           bool_or(h.group_membership_source = 'derived')
      into v_contrib, v_derived
      from presby_giving_manage_holder_grants(p_org) h
     where (p_subject_kind = 'person' and h.arm = 'person' and h.subject_person_id = p_subject_id)
        or (p_subject_kind = 'group' and h.arm = 'group' and h.group_id = p_subject_id);
  end if;

  -- 5. Nothing contributes. A companion grant alone never makes a subject
  -- revocable (it is not a holder; ending it alone would be a general "end
  -- any grant" path), so this test is on the contributing set.
  if v_contrib is null then
    if exists (
      select 1 from role_grants rg
       where rg.id = any(v_expected)
         and rg.organization_id = p_org
         and ((p_subject_kind = 'person' and rg.person_id = p_subject_id)
           or (p_subject_kind = 'group' and rg.group_id = p_subject_id))
         and rg.ends_on is not null
         and rg.ends_on <= current_date
    ) then
      outcome := 'already_removed';
    else
      outcome := 'not_a_holder';
    end if;
    return next;
    return;
  end if;

  -- 6. D6: a derived group's roster is the court's (or the roll's); ending
  -- its grants is governance, not recovery.
  if p_subject_kind = 'group' and coalesce(v_derived, false) then
    outcome := 'derived_group_refused';
    return next;
    return;
  end if;

  if p_slot = 'founding_administrator' and p_subject_kind = 'person' then
    select coalesce(array_agg(c.grant_id order by c.grant_id), array[]::uuid[]) into v_companion
      from presby_founding_administrator_companion_grants(p_org, p_subject_id) c;
  end if;
  select array_agg(distinct x order by x) into v_all from unnest(v_contrib || v_companion) x;

  -- 7. Lock the grant rows, re-filtering effectiveness under the lock.
  select array_agg(s.id order by s.id) into v_locked
    from (select rg.id
            from role_grants rg
           where rg.id = any(v_all)
             and rg.organization_id = p_org
             and rg.starts_on <= current_date
             and (rg.ends_on is null or rg.ends_on > current_date)
             for update) s;

  -- 8. Everything was ended between the derive and the lock.
  if v_locked is null then
    outcome := 'already_removed';
    return next;
    return;
  end if;

  -- 9. Compare as sets with what the dialog displayed.
  if v_locked is distinct from v_expected then
    outcome := 'changed';
    return next;
    return;
  end if;

  -- 10. Before the write.
  if p_slot = 'founding_administrator' then
    holder_count_before := presby_founding_administrator_holder_count(p_org);
    select array_agg(distinct h.holder_person_id order by h.holder_person_id) into revoked_holder_person_ids
      from presby_founding_administrator_holder_grants(p_org) h
     where h.grant_id = any(v_contrib);
  else
    holder_count_before := presby_giving_manage_holder_count(p_org);
    select array_agg(distinct h.holder_person_id order by h.holder_person_id) into revoked_holder_person_ids
      from presby_giving_manage_holder_grants(p_org) h
     where h.grant_id = any(v_contrib);
  end if;

  -- 11. The write: role_grants.ends_on, nothing else.
  with person_arm as (
    update role_grants rg
       set ends_on = least(current_date, m.ended_on)
      from memberships m
     where rg.id = any(v_locked)
       and rg.person_id is not null
       and m.person_id = rg.person_id
       and m.organization_id = rg.organization_id
    returning rg.id, rg.ends_on
  ),
  group_arm as (
    update role_grants rg
       set ends_on = current_date
     where rg.id = any(v_locked)
       and rg.person_id is null
    returning rg.id, rg.ends_on
  )
  select array_agg(u.id order by u.id), array_agg(u.ends_on order by u.id)
    into v_ended_ids, v_ended_dates
    from (select pa.id, pa.ends_on from person_arm pa
          union all
          select ga.id, ga.ends_on from group_arm ga) u;

  if v_ended_ids is distinct from v_locked then
    -- Unreachable while role_grants_person_fk holds; refuse rather than
    -- report a partial revoke.
    raise exception 'presby_revoke_designation_holder: ended % of % locked grants',
      coalesce(cardinality(v_ended_ids), 0), cardinality(v_locked)
      using errcode = 'internal_error';
  end if;

  grant_ids := v_ended_ids;
  applied_ends_on := v_ended_dates;
  select array_agg(r.key order by rg.id) into role_keys
    from role_grants rg join app_roles r on r.id = rg.role_id
   where rg.id = any(v_ended_ids);
  clamped_to_membership_end := exists (select 1 from unnest(v_ended_dates) d where d < current_date);
  select coalesce(array_agg(x order by x), array[]::uuid[]) into companion_grant_ids
    from unnest(v_companion) x where x = any(v_ended_ids);

  -- 12. After the write (a separate statement: it sees the update).
  if p_slot = 'founding_administrator' then
    holder_count_after := presby_founding_administrator_holder_count(p_org);
  else
    holder_count_after := presby_giving_manage_holder_count(p_org);
  end if;

  -- 13. Open invitations for this slot are LEFT OPEN (Q8); reported only.
  select coalesce(array_agg(i.id order by i.id), array[]::uuid[]) into open_invitation_ids
    from account_invitations i
   where i.organization_id = p_org
     and i.purpose = p_slot
     and i.accepted_at is null and i.revoked_at is null
     and i.superseded_at is null and i.blocked_at is null;

  -- 14.
  outcome := 'revoked';
  return next;
end
$function$;

revoke all on function presby_revoke_designation_holder(uuid, text, text, uuid, uuid[]) from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
comment on function presby_founding_administrator_holder_grants(uuid) is
  'The single source for founding-administrator holders (DECISION-196, F169, drizzle/0060). One row per (effective grant of a role carrying roles.manage or role_grants.manage, holder person); group arm through open group_memberships with the 0059 asymmetry kept word for word (no gm.starts_on check, no memberships join, merged people counted) so ghost holders stay visible and revocable. Owner only (a cross-org list is an oracle).';
comment on function presby_giving_manage_holder_grants(uuid) is
  'The single source for treasurer (giving.manage) holders (DECISION-196, F169, drizzle/0060). One row per (effective grant, holder person), membership-aware: holders are non-merged people with an open membership at the org. Owner only.';
comment on function presby_founding_administrator_holder_count(uuid) is
  'count(distinct holder_person_id) over presby_founding_administrator_holder_grants (drizzle/0060; was a standalone body in 0059). Gates presby_apply_founding_administrator and issue.ts. Owner only.';
comment on function presby_giving_manage_holder_count(uuid) is
  'count(distinct holder_person_id) over presby_giving_manage_holder_grants (drizzle/0060; was a standalone body in 0059). Gates presby_apply_treasurer and issue.ts. Owner only.';
comment on function presby_founding_administrator_companion_grants(uuid, uuid) is
  'The stated-clerk office grant presby_apply_founding_administrator wrote beside the bundle (reason ''founding administrator designation'', role congregation_stated_clerk / presbytery_stated_clerk), effective, for one person, and NOT a contributing grant. Never counts. Ended together with the person by presby_revoke_designation_holder (D3, drizzle/0060). Owner only.';
comment on function presby_revoke_designation_holder(uuid, text, text, uuid, uuid[]) is
  'Platform lockout recovery (DECISION-194/196, drizzle/0060): end one subject''s contributing grants for the founding-administrator or treasurer slot (plus the founding-administrator companion). The ONLY platform-side writer of role_grants.ends_on, and it writes nothing else. Organization row FOR UPDATE first, then the grant rows; compares the effective set with the ids the caller displayed. Person-arm ends_on = least(current_date, membership end) (F171). Derived groups refused (D6). Outcomes: revoked | already_removed | changed | not_a_holder | derived_group_refused | not_applicable | no_organization. The caller writes the audit row in the same transaction. Owner only.';
