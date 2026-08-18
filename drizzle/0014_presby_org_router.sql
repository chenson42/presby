-- The org router's database half.
--
-- Three things, all of which Drizzle Kit emits none of:
--
--   1. organizations.slug becomes a URL contract - DNS-label shaped, immutable.
--   2. presby_available_organizations() is dropped and recreated, wider, as
--      presby_user_organizations(). It filters NOTHING; policy moves into two
--      TypeScript wrappers where it is unit-testable and shows up in a diff.
--   3. The membership <-> open-position integrity guard (DECISION-039), which
--      is two triggers rather than one.
--
-- FORWARDING NOTE. drizzle/0013_presby_two_factor_policy.sql:49 carries a
-- comment saying presby_two_factor_required()'s membership predicate "matches
-- presby_available_organizations()". That function no longer exists; the
-- predicate it refers to is now presby_user_organizations()'s
-- `p.user_id = p_user_id and p.merged_into_id is null`, and the two are still
-- deliberately identical. 0013 is NOT edited to say so: every hand-written
-- migration is registered in drizzle/meta/_journal.json, db:migrate compares
-- file hashes, and editing an applied migration makes it look unapplied. A
-- forwarding note here is the correct repair for a stale comment in a file that
-- has already run.

-- ---------------------------------------------------------------------------
-- 1. organizations.slug is a URL contract
-- ---------------------------------------------------------------------------
-- The slug is the path segment in /o/<slug> (DECISION-034) and, in P5, the
-- platform subdomain label <slug>.presby.app. It is therefore already a DNS
-- label whether or not anything constrains it, so constrain it: lowercase
-- alphanumerics and internal hyphens, <= 63 characters, no leading or trailing
-- hyphen.
--
-- All four seeded slugs already conform, so this is free today and never again.
-- Guarded rather than bare because every statement in a hand-written migration
-- has to be idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_slug_format'
  ) then
    alter table organizations
      add constraint organizations_slug_format
      check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');
  end if;
end $$;

comment on column organizations.slug is
  'DNS-label-shaped public identifier, and the URL segment in /o/<slug>. IMMUTABLE: renaming a congregation changes name, never slug. The slug lives in bookmarks, in printed bulletin inserts, and (P5) in the platform subdomain label <slug>.presby.app, so a slug that follows the name breaks all three at once. If one genuinely must change - merger, schism, a typo at onboarding - the answer is a future organization_slug_aliases table serving 301s, not an UPDATE.';

-- ---------------------------------------------------------------------------
-- 2. The org list: dropped, widened, renamed
-- ---------------------------------------------------------------------------
-- presby_available_organizations() returned only current memberships at any
-- platform_status, which is the wrong shape in both directions at once: it hid
-- the ended relationship the "your access to X ended on Y" message needs, and
-- it advertised unmanaged organizations that have no portal to enter.
--
-- The fix is not a second filter. It is to make the function tell the whole
-- truth - "where does this user belong" - and to put policy in TypeScript:
--
--   availableOrganizations()  ended_on is null and platform_status = 'managed'
--   userOrganizations()       everything
--
-- Renamed because once it returns ended and non-tenant relationships,
-- "available" is a lie. Free today: the old function had exactly one wrapper
-- and that wrapper had zero call sites.
drop function if exists presby_available_organizations(uuid);

create or replace function presby_user_organizations(p_user_id uuid)
returns table (
  organization_id       uuid,
  person_id             uuid,
  membership_id         uuid,
  name                  text,
  organization_type     text,
  slug                  text,
  platform_status       text,
  ended_on              date,
  membership_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, p.id, m.id, o.name, o.organization_type::text, o.slug,
         o.platform_status, m.ended_on, m.created_at
    from people p
    join memberships m   on m.person_id = p.id
    join organizations o on o.id = m.organization_id
   where p.user_id = p_user_id
     and p.merged_into_id is null
   order by o.organization_type,
            o.name,
            (m.ended_on is not null),   -- current relationships first
            m.created_at,
            m.id;
$$;

comment on function presby_user_organizations(uuid) is
  'Every organization this user holds a relationship with, filtered by NOTHING but the caller''s own identity. '
  'SECURITY BOUNDARY: `p.user_id = p_user_id and p.merged_into_id is null`. That predicate is the entire reason '
  'SECURITY DEFINER is safe here - it is a genuine cross-org read (with no org context RLS correctly returns '
  'nothing, and with one set it would only ever return that one org), and what makes it disclose nothing is that '
  'it can only ever reach the caller''s OWN person rows. WIDENING THE COLUMNS MUST NEVER TOUCH IT. This function '
  'has already been widened twice - ended_on and platform_status both moved out of the WHERE clause and into the '
  'result - and each time the temptation is to edit "the where clause" as one thing. It is two things: the '
  'security predicate, which is frozen, and the policy filters, which now live in the TypeScript wrappers '
  'availableOrganizations() and userOrganizations() where they are unit-testable and show up in a diff. '
  'MEMBERSHIPS IS THE UNIVERSAL RELATIONSHIP ANCHOR (DECISION-039): roll status is a COLUMN on the relationship, '
  'not its meaning, so there is deliberately no current_roll filter - the presbytery-committee elder, the church '
  'secretary who worships elsewhere, and the installed pastor whose membership is at the presbytery all appear. '
  'NEVER join organizations.path or parent_id here: a presbytery stewarding forty non-tenant congregations gets '
  'exactly ONE card, its own. Stewardship in the card list is downward inheritance through the back door, and it '
  'would arrive looking like a helpful feature. The ORDER BY is part of the contract: the caller de-duplicates by '
  'taking the FIRST row per organization_id, so current relationships must sort before ended ones.';

revoke all on function presby_user_organizations(uuid) from public;
grant execute on function presby_user_organizations(uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 3. An open position implies a live membership (DECISION-039)
-- ---------------------------------------------------------------------------
-- officer_terms and role_grants both composite-FK into
-- memberships(person_id, organization_id), so a position at an organization is
-- structurally impossible without a membership row there (F2 doing its job).
-- What the FK does NOT constrain is `ended_on`. So this state is reachable:
--
--   a membership ends while an officer term at the same organization is open.
--
-- That person keeps a seated, minuted office and silently loses their portal,
-- on a date with no corresponding write - F29's shape applied to office rather
-- than to the roll.
--
-- TWO triggers, not one. A guard enforceable in one direction only is a paper
-- invariant in the other, and the hole is reached by simply reordering the two
-- writes: end the membership first, then open the term.
--
-- It FAILS LOUDLY and never auto-ends the term. Ending a term is a minuted act
-- with an end_reason; a platform that silently ends one to satisfy a cache is
-- doing exactly the class of quiet correction the roll invariant exists to
-- forbid, and the person it quietly unseats is the last to find out.
--
-- NEITHER FUNCTION IS SECURITY DEFINER, and that is deliberate. Both read only
-- rows at the SAME organization as the row being written, and any write that
-- reaches them already has that organization's app.current_org_id set - so RLS
-- shows them precisely what they need to see. This is the opposite case from
-- presby_guard_membership_insert (drizzle/0009_presby_rls.sql), which probes
-- ACROSS organizations and is therefore defeated by RLS unless it is DEFINER
-- (F26). Do not add SECURITY DEFINER here as cargo cult: it would widen these
-- two functions' reach for no reason and blur the boundary that makes F26
-- legible.

-- Direction 1: ending a membership under an open position fails loudly.
create or replace function presby_guard_membership_end()
returns trigger language plpgsql as $$
declare v_what text;
begin
  select 'the ' || ot.office || ' term beginning ' || ot.starts_on into v_what
    from officer_terms ot
   where ot.person_id = new.person_id
     and ot.organization_id = new.organization_id
     and ot.starts_on <= new.ended_on
     and (ot.ends_on is null or ot.ends_on > new.ended_on)
   order by ot.starts_on limit 1;

  if v_what is null then
    select 'a role grant beginning ' || rg.starts_on into v_what
      from role_grants rg
     where rg.person_id = new.person_id
       and rg.organization_id = new.organization_id
       and rg.starts_on <= new.ended_on
       and (rg.ends_on is null or rg.ends_on > new.ended_on)
     order by rg.starts_on limit 1;
  end if;

  if v_what is not null then
    raise exception
      'memberships: cannot end this relationship on % - % is still open at this organization',
      new.ended_on, v_what
      using errcode = 'check_violation',
            hint = 'End the term first, with an end_reason and a minute reference. Ending a term is a minuted act; the platform will not do it silently to satisfy a cache.';
  end if;
  return new;
end $$;

comment on function presby_guard_membership_end() is
  'DECISION-039, direction 1: a membership may not end while an officer term or role grant is still open at the '
  'same organization. Raises check_violation naming the term; never auto-ends it. Deliberately NOT SECURITY '
  'DEFINER - it reads only rows at the organization being written, whose app.current_org_id is already set.';

drop trigger if exists memberships_guard_end on memberships;
create trigger memberships_guard_end
  before update of ended_on on memberships
  for each row
  when (new.ended_on is not null and old.ended_on is distinct from new.ended_on)
  execute function presby_guard_membership_end();

-- Direction 2: opening a position at an org whose membership already ended.
create or replace function presby_guard_position_needs_membership()
returns trigger language plpgsql as $$
declare v_ended date;
begin
  if new.person_id is null then return new; end if;   -- role_grants: group grant

  select m.ended_on into v_ended from memberships m
   where m.person_id = new.person_id
     and m.organization_id = new.organization_id;

  -- Only positions still OPEN when the membership ended are constrained.
  -- Importing twenty years of session history for someone who has since left is
  -- legitimate and must keep working: a term that closed before the membership
  -- did is history, not access.
  if v_ended is not null and (new.ends_on is null or new.ends_on > v_ended) then
    raise exception
      '%: cannot open a position at an organization where the membership ended on %',
      tg_table_name, v_ended
      using errcode = 'check_violation',
            hint = 'Restore the membership first, or record the position as already ended.';
  end if;
  return new;
end $$;

comment on function presby_guard_position_needs_membership() is
  'DECISION-039, direction 2: a position that is still open cannot be recorded at an organization whose '
  'membership has already ended - otherwise direction 1 is bypassed by reordering the writes. A position that '
  'closed on or before the membership did is history and is accepted, so importing a departed member''s past '
  'terms keeps working. Shared by officer_terms and role_grants; deliberately NOT SECURITY DEFINER, same reason '
  'as presby_guard_membership_end().';

drop trigger if exists officer_terms_needs_membership on officer_terms;
create trigger officer_terms_needs_membership
  before insert or update of person_id, ends_on on officer_terms
  for each row execute function presby_guard_position_needs_membership();

drop trigger if exists role_grants_needs_membership on role_grants;
create trigger role_grants_needs_membership
  before insert or update of person_id, ends_on on role_grants
  for each row execute function presby_guard_position_needs_membership();
