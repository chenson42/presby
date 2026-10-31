-- drizzle/0074_presby_reimbursement_permissions.sql
--
-- Reimbursements (Treasury Increment 1): the four permission keys, their
-- bindings to the `treasurer` template, the new `reimbursement_clerk`
-- template, and the backfill into designation-minted treasurer copies.
-- Data only: no DDL, no function.
--
-- docs/work-log/2026-10-25-treasury-inc1.md -> Phase 3 "Permissions & Flags"
-- and "Migration 0074"; DECISION-269 (amended by P3-2 / F322: the treasurer
-- template also carries request_for_others, and a clerk template carries it
-- alone, because a key nobody holds can never be granted under the subset
-- rule, DECISION-068/106).
--
-- REQUIRES drizzle/0073 (the F301 downward guards must exist before any
-- reimbursement key does).
--
-- APPLY (owner, direct/unpooled endpoint):
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0074_presby_reimbursement_permissions.sql
--
-- IDEMPOTENT, WHOLE FILE: `on conflict do update` for the catalog rows (an
-- in-place description correction takes effect on replay), `on conflict do
-- nothing` for every binding, `where not exists` for the clerk template.
-- Proven by applying the whole file twice (work-log, Phase 4 Batch 1a).
--
-- WHAT THIS FILE NEVER DOES: bind a key to founding_administrator,
-- stated_clerk, session_member, installed_pastor or any wildcard; use
-- grant_reason as a discriminator; touch an organization-owned custom role
-- (adoptTemplate() copies are the treasurer's to manage, F296).
--
-- Production count before apply (read-only, orchestrator 2026-10-25): 1
-- designation-minted treasurer copy. presby_apply_treasurer (drizzle/0059
-- section 6b) copies the template's keys at designation time, so every later
-- designation carries the new keys with no function change.

-- ---------------------------------------------------------------------------
-- 1. The catalog (DECISION-063: permissions carry no org). Tier 2. 2FA for
--    view, pay and manage (manage decides who approves); not for
--    request_for_others. presby_two_factor_required() arm B reads the column
--    generically (0055 section 18), so no function changes.
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier, requires_two_factor) values
  ('reimbursement.request_for_others', 'reimbursement',
   'Enter a reimbursement request on behalf of another member', 2, false),
  ('reimbursement.view', 'reimbursement',
   'View every reimbursement request, receipt and history, and export them', 2, true),
  ('reimbursement.pay', 'reimbursement',
   'Record and reverse reimbursement payments, waive a receipt, send a request back, void it, or approve it when no one else can', 2, true),
  ('reimbursement.manage', 'reimbursement',
   'Choose which groups can receive reimbursement requests, manage categories and the treasury team', 2, true)
on conflict (key) do update set module = excluded.module, description = excluded.description,
  sensitivity_tier = excluded.sensitivity_tier, requires_two_factor = excluded.requires_two_factor;

-- ---------------------------------------------------------------------------
-- 2. The treasurer TEMPLATE carries all four (referred to by key, not by the
--    fixed id 0055 gave it, so a parallel pipeline's fixed ids never collide).
-- ---------------------------------------------------------------------------
insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('reimbursement.request_for_others'), ('reimbursement.view'),
                    ('reimbursement.pay'), ('reimbursement.manage')) as k(key)
 where r.organization_id is null and r.key = 'treasurer'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The reimbursement_clerk TEMPLATE (custom, unprotected, unscoped; a
--    generated id), carrying request_for_others alone. app_roles_org_key does
--    not cover organization_id IS NULL rows, hence `where not exists`.
-- ---------------------------------------------------------------------------
insert into app_roles (organization_id, organization_type_scope, key, name, role_kind, is_protected)
select null, null, 'reimbursement_clerk', 'Reimbursement Clerk', 'custom', false
 where not exists (select 1 from app_roles r where r.organization_id is null and r.key = 'reimbursement_clerk');

insert into app_role_permissions (role_id, permission_key)
select r.id, 'reimbursement.request_for_others'
  from app_roles r
 where r.organization_id is null and r.key = 'reimbursement_clerk'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Backfill (DECISION-269): every DESIGNATION-MINTED treasurer copy gets
--    the four keys. The discriminator is the shape only presby_apply_treasurer
--    writes: organization-owned, key 'treasurer', role_kind 'constitutional',
--    is_protected (adoptTemplate() always writes custom, unprotected roles).
--    Never grant_reason; never a wildcard; never another role.
-- ---------------------------------------------------------------------------
insert into app_role_permissions (role_id, permission_key)
select r.id, k.key
  from app_roles r
 cross join (values ('reimbursement.request_for_others'), ('reimbursement.view'),
                    ('reimbursement.pay'), ('reimbursement.manage')) as k(key)
 where r.organization_id is not null and r.key = 'treasurer'
   and r.role_kind = 'constitutional' and r.is_protected
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Closing assertions. Raise (and abort the file) unless:
--    (a) the four catalog rows are exactly as above;
--    (b) the treasurer template carries all four and the clerk template
--        carries exactly request_for_others;
--    (c) every designation-minted treasurer copy carries all four;
--    (d) no PROTECTED or CONSTITUTIONAL role other than a treasurer (template
--        or copy) carries a reimbursement key, and no founding_administrator,
--        stated_clerk (either council), session_member or installed_pastor
--        role of any kind does. Organization-owned CUSTOM roles are not
--        asserted on: an adopted clerk copy or a congregation's own role may
--        legitimately carry a key the treasurer delegated (F296), and this
--        migration never writes one. (Departure from the Phase 3 text "any
--        other role", which would make the file fail on replay once a
--        treasurer has used the team page; recorded as D8 in the work-log.)
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad from permissions
   where module = 'reimbursement'
     and not ((key = 'reimbursement.request_for_others' and sensitivity_tier = 2 and not requires_two_factor)
           or (key in ('reimbursement.view', 'reimbursement.pay', 'reimbursement.manage')
               and sensitivity_tier = 2 and requires_two_factor));
  if v_bad <> 0 or (select count(*) from permissions where module = 'reimbursement') <> 4 then
    raise exception 'reimbursement 0074: the catalog is not the four reimbursement keys as designed';
  end if;

  if (select count(*) from app_roles r join app_role_permissions rp on rp.role_id = r.id
       where r.organization_id is null and r.key = 'treasurer' and rp.permission_key like 'reimbursement.%') <> 4 then
    raise exception 'reimbursement 0074: the treasurer template does not carry the four reimbursement keys';
  end if;
  if (select count(*) from app_roles r join app_role_permissions rp on rp.role_id = r.id
       where r.organization_id is null and r.key = 'reimbursement_clerk') <> 1
     or not exists (select 1 from app_roles r join app_role_permissions rp on rp.role_id = r.id
                     where r.organization_id is null and r.key = 'reimbursement_clerk'
                       and rp.permission_key = 'reimbursement.request_for_others') then
    raise exception 'reimbursement 0074: the reimbursement_clerk template must carry exactly reimbursement.request_for_others';
  end if;

  select count(*) into v_bad from app_roles r
   where r.organization_id is not null and r.key = 'treasurer' and r.role_kind = 'constitutional' and r.is_protected
     and (select count(*) from app_role_permissions rp
           where rp.role_id = r.id and rp.permission_key like 'reimbursement.%') <> 4;
  if v_bad <> 0 then
    raise exception 'reimbursement 0074: % designation-minted treasurer copies lack a reimbursement key', v_bad;
  end if;

  select count(*) into v_bad from app_roles r
   where exists (select 1 from app_role_permissions rp join permissions pm on pm.key = rp.permission_key
                  where rp.role_id = r.id and pm.module = 'reimbursement')
     and (r.key in ('founding_administrator', 'stated_clerk', 'congregation_stated_clerk',
                    'presbytery_stated_clerk', 'session_member', 'installed_pastor')
          or ((r.is_protected or r.role_kind <> 'custom') and r.key <> 'treasurer'));
  if v_bad <> 0 then
    raise exception 'reimbursement 0074: % roles carry a reimbursement key they must not', v_bad;
  end if;
end $$;
