-- presby tenant isolation.
--
-- Drizzle Kit does not emit RLS policies, so this migration is hand-written and
-- must be kept in step with docs/schema-design.md section 3.
--
-- Two findings from review round 1 are enforced here:
--   F1  `force row level security` is REQUIRED. Without it the table owner
--       bypasses every policy, so if migrations and the application share a
--       role, RLS is silently inert and every isolation test still passes.
--   F12 RLS enforces TENANCY, not AUTHORIZATION. The policy trusts whatever org
--       id the app puts in the GUC. The application must verify the user
--       actually belongs to that org BEFORE calling set_config.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- presby_app  : every tenant-facing route. RLS enforced, always. NO BYPASSRLS.
-- presby_platform : platform admin pages only. Bypasses RLS.
--
-- users.is_platform_admin governs which PAGES are reachable. It does not
-- bypass RLS — that is what the second connection is for. This boundary
-- survives application bugs; a boolean check does not.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'presby_app') then
    create role presby_app nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'presby_platform') then
    create role presby_platform bypassrls;
  end if;
end $$;

-- Belt and braces: even if the role is created elsewhere, it must not bypass.
alter role presby_app nobypassrls;

-- ---------------------------------------------------------------------------
-- Standard tenant policy
-- ---------------------------------------------------------------------------
create or replace function presby_current_org() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_org_id', true), '')::uuid;
$$;

-- Applied to every tenant-owned table. `current_setting(..., true)` returns
-- NULL when unset, and `organization_id = NULL` is NULL, so an unset GUC
-- filters every row out. Fail-closed by construction.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'organization_settings', 'org_units',
    'households', 'memberships',
    'tags', 'person_tags',
    'person_milestones', 'person_notes', 'follow_ups',
    'talent_types', 'person_talents', 'background_checks', 'person_medical',
    'roll_actions',
    'ordinations', 'officer_terms',
    'group_types', 'groups', 'group_memberships',
    'app_roles', 'role_grants',
    'person_privacy', 'consents', 'person_demographics', 'person_disabilities',
    'sasr_reports'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
    execute format('grant select, insert, update, delete on %I to presby_app', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Bespoke policies
-- ---------------------------------------------------------------------------

-- `organizations` is NOT tenant-isolated. The org tree is public information:
-- PC(USA) publishes congregation and presbytery lists. Anything sensitive lives
-- in organization_settings, which carries the standard policy above.
grant select on organizations to presby_app;

-- ---------------------------------------------------------------------------
-- Global person tables (D1)
-- ---------------------------------------------------------------------------
-- `people` and the person's own data carry no organization_id, so they cannot
-- use the standard predicate: a row is visible when the current org holds a
-- MEMBERSHIP for that person.
--
-- These are the highest-consequence policies in the schema — the only place a
-- bug leaks identity between congregations. Keep the predicate narrow.
--
-- Duplicate detection genuinely needs to read rows the caller cannot see ("is
-- this person already in the system?"). That does NOT relax these policies. It
-- goes through presby_match_person() below, which returns a token and minimal
-- disclosure, never a row.
do $$
declare
  t text;
  global_person_tables text[] := array[
    'people', 'addresses', 'contact_methods', 'person_relationships',
    'person_identifiers'
  ];
  col text;
begin
  foreach t in array global_person_tables loop
    col := case when t = 'people' then 'id' else 'person_id' end;
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists visible_via_membership on %I', t);
    execute format(
      'create policy visible_via_membership on %I using (exists ('
      '  select 1 from memberships m'
      '   where m.person_id = %I.%I'
      '     and m.organization_id = presby_current_org()))', t, t, col);
    execute format('grant select, insert, update on %I to presby_app', t);
  end loop;
end $$;

grant delete on addresses, contact_methods, person_relationships to presby_app;

-- ---------------------------------------------------------------------------
-- F21: creating a membership must not self-grant visibility
-- ---------------------------------------------------------------------------
-- The policies above say "visible if you hold a membership." Left unguarded,
-- any church could INSERT a membership for an arbitrary person_id and
-- immediately read that person's name, birthdate, address, and phone. The
-- composite foreign keys never protected against this; the check has to live on
-- the act of linking.
--
-- A membership insert is allowed when EITHER:
--   (a) the person has no membership anywhere - this org is creating them, so
--       there is nothing to disclose; or
--   (b) an authorized claim set app.person_claim_authorized for this
--       transaction. presby_claim_person() is the only thing that sets it, and
--       it requires a claimable transfer certificate.
create or replace function presby_guard_membership_insert()
returns trigger language plpgsql as $$
declare
  existing int;
begin
  if coalesce(current_setting('app.person_claim_authorized', true), '') = new.person_id::text then
    return new;
  end if;

  select count(*) into existing from memberships m where m.person_id = new.person_id;
  if existing > 0 then
    raise exception
      'memberships: person % already exists elsewhere; link through presby_claim_person()',
      new.person_id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists memberships_guard_insert on memberships;
create trigger memberships_guard_insert
  before insert on memberships
  for each row execute function presby_guard_membership_insert();

-- Claims a person into the current org against a valid transfer certificate.
-- SECURITY DEFINER so it can read certificates and people across orgs; it
-- returns nothing about the person that the certificate did not already carry.
create or replace function presby_claim_person(p_claim_token text)
returns uuid
language plpgsql security definer as $$
declare
  cert transfer_certificates%rowtype;
  org  uuid := presby_current_org();
begin
  if org is null then
    raise exception 'presby_claim_person: no org context' using errcode = 'insufficient_privilege';
  end if;

  select * into cert from transfer_certificates
   where claim_token = p_claim_token
     and status = 'issued'
     and (expires_on is null or expires_on >= current_date);

  if cert.id is null then
    raise exception 'presby_claim_person: no claimable certificate' using errcode = 'no_data_found';
  end if;

  perform set_config('app.person_claim_authorized', cert.issuing_person_id::text, true);

  update transfer_certificates
     set receiving_org_id = org, claimed_at = now(), status = 'claimed'
   where id = cert.id;

  return cert.issuing_person_id;
end $$;

revoke all on function presby_claim_person(text) from public;
grant execute on function presby_claim_person(text) to presby_app;

-- Duplicate-detection matcher. Returns a confidence band and certificate-style
-- minimal disclosure, never a person row.
--
-- Identifier evidence first, name evidence second. `exact` means a VERIFIED,
-- non-shared identifier matched, which is the only case that can be trusted
-- without a human looking: a shared household email would otherwise merge two
-- spouses into one person.
create or replace function presby_match_person(
  p_last_name text,
  p_first_name text,
  p_date_of_birth date,
  p_identifiers jsonb default '[]'::jsonb   -- [{"kind":"email","value":"..."}]
)
returns table (person_id uuid, display_name text, confidence text)
language sql security definer as $$
  with candidates as (
    -- Verified, unshared identifier: deterministic. Rank 1 is best.
    select pi.person_id, 1 as rank
      from person_identifiers pi
      join jsonb_to_recordset(p_identifiers) as q(kind text, value text)
        on q.kind = pi.kind and lower(q.value) = pi.value_normalized
     where pi.is_verified and not pi.is_shared

    union all

    -- Unverified or shared identifier: a signal, never decisive.
    select pi.person_id, 3
      from person_identifiers pi
      join jsonb_to_recordset(p_identifiers) as q(kind text, value text)
        on q.kind = pi.kind and lower(q.value) = pi.value_normalized
     where not (pi.is_verified and not pi.is_shared)

    union all

    -- Name plus date of birth.
    select p.id,
           case when p.date_of_birth is not distinct from p_date_of_birth
                     and p_date_of_birth is not null
                then 2 else 4 end
      from people p
     where lower(p.last_name) = lower(p_last_name)
       and lower(p.first_name) = lower(p_first_name)
  )
  select c.person_id,
         left(p.first_name, 1) || '. ' || p.last_name,
         -- Explicit rank, not an alphabetical accident: 'low' must sort below
         -- 'medium', which min() on the label would get backwards.
         (array['exact','high','medium','low'])[min(c.rank)]
    from candidates c
    join people p on p.id = c.person_id
   where p.merged_into_id is null
   group by c.person_id, p.first_name, p.last_name
   order by min(c.rank)
   limit 10;
$$;

revoke all on function presby_match_person(text, text, date, jsonb) from public;
grant execute on function presby_match_person(text, text, date, jsonb) to presby_app;



-- transfer_certificates spans two orgs by design: the losing church issues and
-- the receiving church claims by token.
alter table transfer_certificates enable row level security;
alter table transfer_certificates force  row level security;
drop policy if exists certificate_visible_to_either_side on transfer_certificates;
create policy certificate_visible_to_either_side on transfer_certificates
  using (issuing_org_id = presby_current_org()
      or receiving_org_id = presby_current_org());
grant select, insert, update on transfer_certificates to presby_app;

-- The two downward-access exceptions. Readable by both parties so a
-- congregation can always see who has been granted access to it.
do $$
declare t text;
begin
  foreach t in array array['administrative_commissions', 'org_delegations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('grant select, insert, update on %I to presby_app', t);
  end loop;
end $$;

drop policy if exists commission_visible_to_both on administrative_commissions;
create policy commission_visible_to_both on administrative_commissions
  using (parent_org_id = presby_current_org() or target_org_id = presby_current_org());

drop policy if exists delegation_visible_to_both on org_delegations;
create policy delegation_visible_to_both on org_delegations
  using (grantor_org_id = presby_current_org() or grantee_org_id = presby_current_org());

-- Global catalogs: readable by all, written only by migrations and seeds.
grant select on permissions to presby_app;

-- ---------------------------------------------------------------------------
-- Invariant 4: an approved roll action is immutable
-- ---------------------------------------------------------------------------
-- Rows in `pending` are mutable working state. On approval the row freezes;
-- corrections require a `void` action referencing the mistaken one.
create or replace function presby_freeze_approved_roll_action()
returns trigger language plpgsql as $$
begin
  if old.approval_status = 'approved' then
    raise exception
      'roll_actions %: approved actions are immutable; record a void action instead',
      old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists roll_actions_freeze on roll_actions;
create trigger roll_actions_freeze
  before update or delete on roll_actions
  for each row execute function presby_freeze_approved_roll_action();

-- Invariant 7: a person row is never hard-deleted. Use people.merged_into_id.
revoke delete on people from presby_app;

-- Supports the visible_via_membership policies' EXISTS. Without it, every read
-- of a global person table degrades to a scan of memberships.
create index if not exists memberships_person_org_idx
  on memberships (person_id, organization_id);

-- ---------------------------------------------------------------------------
-- Invariant 5: session and diaconate membership is derived, never edited
-- ---------------------------------------------------------------------------
-- The roster is MATERIALIZED into group_memberships rather than exposed as a
-- view, because the permission resolver reads that table — a view would make
-- session members invisible to it, so a role granted to the Session group would
-- resolve to nobody (F3).
create or replace function presby_reject_derived_group_write()
returns trigger language plpgsql as $$
declare src text;
begin
  select membership_source into src from groups
   where id = coalesce(new.group_id, old.group_id);
  if src = 'derived' and coalesce(new.source, old.source) <> 'derived' then
    raise exception
      'group_memberships: % is a derived group; its roster projects from officer_terms',
      coalesce(new.group_id, old.group_id)
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists group_memberships_reject_derived on group_memberships;
create trigger group_memberships_reject_derived
  before insert or update or delete on group_memberships
  for each row execute function presby_reject_derived_group_write();

-- Projects an officer term into the derived group roster. Fails loudly if the
-- org was never seeded with its derived groups (F16) rather than silently
-- skipping, which would leave elders with no session access and no error.
create or replace function presby_sync_derived_group()
returns trigger language plpgsql as $$
declare
  target_group uuid;
  derived_key  text;
begin
  derived_key := case new.office
    when 'ruling_elder' then 'session'
    when 'deacon'       then 'diaconate'
    else null end;
  if derived_key is null then return new; end if;

  select id into target_group from groups
   where organization_id = new.organization_id and derived_from = derived_key;

  if target_group is null then
    raise exception
      'organization % has no derived group %; seed derived groups at org creation',
      new.organization_id, derived_key
      using errcode = 'foreign_key_violation';
  end if;

  insert into group_memberships
    (organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
  values
    (new.organization_id, target_group, new.person_id, 'member', 'derived',
     new.starts_on, new.ends_on)
  on conflict do nothing;

  -- F19: a term that ends must drop access the day it ends, whether it ended by
  -- completion, resignation, removal, or death.
  update group_memberships
     set ends_on = new.ends_on
   where organization_id = new.organization_id
     and group_id = target_group
     and person_id = new.person_id
     and source = 'derived';

  return new;
end $$;

drop trigger if exists officer_terms_sync_derived on officer_terms;
create trigger officer_terms_sync_derived
  after insert or update on officer_terms
  for each row execute function presby_sync_derived_group();
