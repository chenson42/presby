-- ---------------------------------------------------------------------------
-- 68. Parish (deacon-district) management (drizzle/0068_presby_parishes.sql;
--     DECISION-242, DECISION-243; F258, F259, F260, F262;
--     docs/work-log/2026-10-25-parish-management.md Phase 2 S2, Phase 3
--     "Staged for integration", Phase 4 Batch A).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner (the staged
--     scripts/parishes/test-rls.sql.integration.patch carries it):
--
--         \ir parishes/test-rls-68.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/parishes/test-rls-68.sql
--
--     after scripts/install-test-helpers.sql (owner), scripts/seed-dev.sql and
--     scripts/parishes/seed-dev-parishes.sql. It names only the synthetic
--     seed-dev organizations (Alder Creek 22222222-..., Bramblewood
--     33333333-..., Northern Reach 11111111-...) and that fixture's people.
--     Every block ends in rollback, so it writes nothing durable.
--
--     Sections:
--       (a) shape and ACL: triggers, functions, the DELETE revoke (R2, F258)
--       (b) org_units vocabulary: unit_type and name-shape CHECKs, the
--           active-name index, archived-name reuse, restore collision, and
--           DELETE refused as presby_app
--       (c) the target guard on households (archived, campus, missing,
--           cross-org; clear and unrelated edits pass; FOR SHARE as presby_app)
--       (d) the target guard on officer_terms (new open term refused; shorten
--           and end pass; re-open refused)
--       (e) the seat-only guards on every resolver arm (R1, F260)
--       (f) the resolver: who holds parishes.assign, and the seat's
--           half-open date boundary
--       (g) org_units isolation, including the archived district
--     What presby_app CANNOT reach (the owner-path delete guard and its
--     fixture-teardown cascade, the two-connection archive race, the
--     migration's own sections and idempotence) is proven on the owner
--     connection in Vitest: src/lib/db/domain/parishes.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

\echo '======================================================'
\echo ' Section 68 (parish management, drizzle/0068) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '68: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Shape and ACL
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname in ('org_units', 'households', 'officer_terms')
        and relrowsecurity and relforcerowsecurity),
    3, '68a: org_units, households and officer_terms have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgenabled = 'O'
        and (t.tgname, t.tgrelid::regclass::text) in (
              ('households_org_unit_target_guard', 'households'),
              ('officer_terms_org_unit_target_guard', 'officer_terms'),
              ('app_role_permissions_seat_key_guard', 'app_role_permissions'),
              ('app_roles_seat_role_guard', 'app_roles'),
              ('role_grants_seat_key_guard', 'role_grants'),
              ('administrative_commissions_seat_key_guard', 'administrative_commissions'),
              ('org_delegations_seat_key_guard', 'org_delegations'),
              ('org_units_guard_delete', 'org_units'))),
    8, '68a: all eight 0068 triggers exist and are enabled');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.prosecdef and pg_get_userbyid(p.proowner) = 'neondb_owner'
        and p.proconfig = array['search_path=public, pg_temp']
        and p.oid in ('presby_seat_key_group(text)'::regprocedure,
                      'presby_guard_seat_key_binding()'::regprocedure,
                      'presby_guard_seat_role_shape()'::regprocedure,
                      'presby_guard_seat_key_grant()'::regprocedure,
                      'presby_guard_seat_key_downward()'::regprocedure)),
    5, '68a: the seat-key map and the four seat guards are SECURITY DEFINER, owned by neondb_owner, search_path pinned (F26)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.prosecdef and pg_get_userbyid(p.proowner) = 'neondb_owner'
        and p.proconfig = array['search_path=public, pg_temp']
        and p.oid = 'presby_sync_derived_group()'::regprocedure),
    1, '68a: presby_sync_derived_group() is SECURITY DEFINER, owned by neondb_owner, search_path pinned, so 0066 and 0068 apply in either order (amendment 1.3)');
  select assert_eq(
    (select count(*) from pg_proc p
      where not p.prosecdef
        and p.proconfig = array['search_path=public, pg_temp']
        and p.oid in ('presby_guard_org_unit_target()'::regprocedure,
                      'presby_org_units_guard_delete()'::regprocedure)),
    2, '68a: the target guard and the delete guard are INVOKER with search_path pinned (DECISION-243)');
  select assert_eq(
    (select count(*) from (values ('presby_seat_key_group(text)'),
                                  ('presby_guard_org_unit_target()'),
                                  ('presby_guard_seat_key_binding()'),
                                  ('presby_guard_seat_role_shape()'),
                                  ('presby_guard_seat_key_grant()'),
                                  ('presby_guard_seat_key_downward()'),
                                  ('presby_org_units_guard_delete()'),
                                  ('presby_sync_derived_group()')) v(f)
      where has_function_privilege(v.f::regprocedure, 'EXECUTE')
         or has_function_privilege('presby_platform', v.f::regprocedure, 'EXECUTE')),
    0, '68a: neither presby_app nor presby_platform may EXECUTE any 0068 function directly');
  select assert_eq(
    (select count(*) from (values ('presby_app'), ('presby_platform')) r(role)
      where has_table_privilege(r.role, 'org_units', 'DELETE')),
    0, '68a: R2/F258 - neither presby_app nor presby_platform holds DELETE on org_units');
  select assert_eq(
    (select count(*) from (values ('SELECT'), ('INSERT'), ('UPDATE')) p(priv)
      where has_table_privilege('presby_app', 'org_units', p.priv)),
    3, '68a: POSITIVE CONTROL - presby_app still holds SELECT, INSERT and UPDATE on org_units (create, rename, archive, FOR SHARE)');
  select assert_eq(
    (select count(*) from permissions where key = 'parishes.assign' and module = 'parishes'
        and sensitivity_tier = 1 and not requires_two_factor),
    1, '68a: parishes.assign is in the tenant catalog, tier 1');
rollback;

-- ===========================================================================
-- (b) org_units vocabulary, names and DELETE (F259, P3-6, R2)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);

  do $$
  declare v_c text;
  begin
    insert into org_units (organization_id, unit_type, name)
    values ('22222222-2222-2222-2222-222222222222', 'region', 'Upper Region');
    raise exception 'FAIL 68b - a unit_type outside the vocabulary was accepted';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_units_unit_type_check' then
      raise exception 'FAIL 68b - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68b: org_units_unit_type_check refuses unit_type ''region'' (F259)';
  end $$;

  do $$
  declare
    v_c    text;
    v_name text;
    v_n    int := 0;
  begin
    foreach v_name in array array[' Padded District', 'Padded District ', '',
                                  repeat('x', 81), U&'Cafe\0301 District'] loop
      begin
        insert into org_units (organization_id, unit_type, name)
        values ('22222222-2222-2222-2222-222222222222', 'district', v_name);
        raise exception 'FAIL 68b - a mis-shaped name was accepted (length %)', char_length(v_name);
      exception when check_violation then
        get stacked diagnostics v_c = constraint_name;
        if v_c is distinct from 'org_units_name_shape' then
          raise exception 'FAIL 68b - wrong constraint %', v_c;
        end if;
        v_n := v_n + 1;
      end;
    end loop;
    if v_n <> 5 then raise exception 'FAIL 68b - % of 5 names refused', v_n; end if;
    raise notice 'pass  68b: org_units_name_shape refuses leading/trailing space, empty, 81 characters and non-NFC (5 of 5)';
  end $$;

  insert into org_units (organization_id, unit_type, name)
  values ('22222222-2222-2222-2222-222222222222', 'district', repeat('y', 80));
  select assert_eq((select count(*) from org_units where name = repeat('y', 80)),
    1, '68b: POSITIVE CONTROL - an 80-character name is accepted');

  do $$
  declare v_c text;
  begin
    insert into org_units (organization_id, unit_type, name)
    values ('22222222-2222-2222-2222-222222222222', 'parish', 'north DISTRICT');
    raise exception 'FAIL 68b - a case-only duplicate of an active name was accepted';
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_units_active_name_idx' then
      raise exception 'FAIL 68b - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68b: org_units_active_name_idx refuses a case-only duplicate of an active name';
  end $$;

  -- East District is archived (seed-dev-parishes.sql): its name is free.
  insert into org_units (id, organization_id, unit_type, name)
  values ('a0680000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222',
          'district', 'East District');
  select assert_eq((select count(*) from org_units where lower(name) = 'east district'),
    2, '68b: an archived district''s name may be reused by a new active district');

  do $$
  declare v_c text;
  begin
    update org_units set archived_at = null where id = 'a0680000-0000-0000-0000-000000000001';
    raise exception 'FAIL 68b - restoring into a taken active name was accepted';
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_units_active_name_idx' then
      raise exception 'FAIL 68b - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68b: a restore that collides with an active name raises unique_violation on org_units_active_name_idx (-> name_taken)';
  end $$;

  do $$
  begin
    delete from org_units where id = 'a2000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 68b - presby_app deleted a district';
  exception when insufficient_privilege then
    raise notice 'pass  68b: R2/F258 - DELETE on org_units is refused for presby_app (permission denied)';
  end $$;
rollback;

-- ===========================================================================
-- (c) the target guard on households (DECISION-243)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);

  do $$
  declare v_c text;
  begin
    update households set org_unit_id = 'a0680000-0000-0000-0000-000000000001' -- East (archived)
     where id = 'd0000000-0000-0000-0000-000000000001';                       -- The Renwick Family
    raise exception 'FAIL 68c - a household moved into an archived district';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_unit_target_archived' then
      raise exception 'FAIL 68c - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68c: a move into an archived district is refused (org_unit_target_archived)';
  end $$;

  do $$
  declare v_c text;
  begin
    insert into households (organization_id, name, org_unit_id)
    values ('22222222-2222-2222-2222-222222222222', 'The Fixture Insert Household',
            'a0680000-0000-0000-0000-000000000001');
    raise exception 'FAIL 68c - a household was created inside an archived district';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_unit_target_archived' then
      raise exception 'FAIL 68c - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68c: an INSERT naming an archived district is refused too';
  end $$;

  insert into org_units (id, organization_id, unit_type, name)
  values ('a0680000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222',
          'campus', 'Fixture Campus');
  do $$
  declare v_c text;
  begin
    update households set org_unit_id = 'a0680000-0000-0000-0000-0000000000c1'
     where id = 'd0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 68c - a household moved into a campus';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_unit_target_campus' then
      raise exception 'FAIL 68c - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68c: a move into a campus is refused (org_unit_target_campus)';
  end $$;

  do $$
  declare v_c text;
  begin
    update households set org_unit_id = 'a0680000-0000-0000-0000-0000000000ff' -- no such district
     where id = 'd0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 68c - a household moved into a nonexistent district';
  exception when foreign_key_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_unit_target_missing' then
      raise exception 'FAIL 68c - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68c: a move into a nonexistent district is refused (org_unit_target_missing)';
  end $$;

  -- North District is active; the update succeeds as presby_app, which also
  -- proves the invoker guard's FOR SHARE runs under RLS for this role.
  with moved as (
    update households set org_unit_id = 'a2000000-0000-0000-0000-000000000001' -- North
     where id = 'd0000000-0000-0000-0000-000000000001'
    returning 1)
  select assert_eq((select count(*) from moved),
    1, '68c: POSITIVE CONTROL - a move into an active district succeeds as presby_app (FOR SHARE under RLS)');

  -- Clearing a household out of the archived district, and editing a
  -- household that sits in it without touching the district, both pass.
  with renamed as (
    update households set name = 'The Ashgrove Family (renamed in a rolled-back test)'
     where id = 'd0680000-0000-0000-0000-000000000002'
    returning 1)
  select assert_eq((select count(*) from renamed),
    1, '68c: a household in an archived district stays editable (district untouched)');
  with cleared as (
    update households set org_unit_id = null
     where id = 'd0680000-0000-0000-0000-000000000001'
    returning 1)
  select assert_eq((select count(*) from cleared),
    1, '68c: a household can be cleared out of an archived district');
rollback;

-- Cross-org: Bramblewood's own district is invisible from Alder Creek, so the
-- guard's lookup (by new.organization_id under RLS) finds nothing.
begin;
  select set_config('app.current_org_id', '33333333-3333-3333-3333-333333333333', true);
  insert into org_units (id, organization_id, unit_type, name)
  values ('a0680000-0000-0000-0000-0000000000b1', '33333333-3333-3333-3333-333333333333',
          'district', 'Bramblewood Section 68 District');
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  do $$
  declare v_c text;
  begin
    update households set org_unit_id = 'a0680000-0000-0000-0000-0000000000b1'
     where id = 'd0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 68c - an Alder Creek household moved into another organization''s district';
  exception when foreign_key_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c not in ('org_unit_target_missing', 'households_org_unit_fk') then
      raise exception 'FAIL 68c - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68c: a move into another organization''s district is refused (%), the same answer as nonexistent (F2)', v_c;
  end $$;
rollback;

-- ===========================================================================
-- (d) the target guard on officer_terms (DECISION-243)
--     Isolde Marchbank (c0680000-...-0001), an active Alder Creek member with
--     no officer term, so officer_terms_no_overlap cannot be what refuses.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);

  do $$
  declare v_c text;
  begin
    insert into officer_terms (organization_id, person_id, office, org_unit_id, starts_on)
    values ('22222222-2222-2222-2222-222222222222', 'c0680000-0000-0000-0000-000000000001',
            'deacon', 'a0680000-0000-0000-0000-000000000001', current_date);
    raise exception 'FAIL 68d - a new open deacon term was recorded in an archived district';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_unit_target_archived' then
      raise exception 'FAIL 68d - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68d: a new open deacon term in an archived district is refused';
  end $$;

  -- A historical (closed) term in the archived district is history, not
  -- access: it records.
  insert into officer_terms (id, organization_id, person_id, office, org_unit_id, starts_on, ends_on)
  values ('e0680000-0000-0000-0000-0000000000d0', '22222222-2222-2222-2222-222222222222',
          'c0680000-0000-0000-0000-000000000001', 'deacon',
          'a0680000-0000-0000-0000-000000000001', '2019-01-01', '2020-01-01');
  select assert_eq((select count(*) from officer_terms where id = 'e0680000-0000-0000-0000-0000000000d0'),
    1, '68d: a closed (historical) deacon term in an archived district records');

  -- An OPEN term that predates the archive: restore, record, re-archive.
  update org_units set archived_at = null where id = 'a0680000-0000-0000-0000-000000000001';
  insert into officer_terms (id, organization_id, person_id, office, org_unit_id, starts_on)
  values ('e0680000-0000-0000-0000-0000000000d1', '22222222-2222-2222-2222-222222222222',
          'c0680000-0000-0000-0000-000000000002', 'deacon',
          'a0680000-0000-0000-0000-000000000001', current_date - 30);
  update org_units set archived_at = now() where id = 'a0680000-0000-0000-0000-000000000001';

  with shortened as (
    update officer_terms set ends_on = current_date + 30
     where id = 'e0680000-0000-0000-0000-0000000000d1' returning 1)
  select assert_eq((select count(*) from shortened),
    1, '68d: an open term in a now-archived district can be given a future end date');
  with ended as (
    update officer_terms set ends_on = current_date, end_reason = 'completed'
     where id = 'e0680000-0000-0000-0000-0000000000d1' returning 1)
  select assert_eq((select count(*) from ended),
    1, '68d: and ended (archiving a district never makes its deacon term un-endable)');

  do $$
  declare v_c text;
  begin
    update officer_terms set ends_on = null, end_reason = null
     where id = 'e0680000-0000-0000-0000-0000000000d1';
    raise exception 'FAIL 68d - an ended term in an archived district was re-opened';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'org_unit_target_archived' then
      raise exception 'FAIL 68d - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68d: re-opening an ended term in an archived district is refused';
  end $$;
rollback;

-- ===========================================================================
-- (e) the seat-only guards (R1, F260; DECISION-242)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);

  select assert_eq(
    (select count(*) from app_roles r
       join app_role_permissions rp on rp.role_id = r.id and rp.permission_key = 'parishes.assign'
       join role_grants rg on rg.role_id = r.id and rg.person_id is null
       join groups g on g.id = rg.group_id and g.derived_from = 'deacons_moderator'
                    and g.membership_source = 'derived' and g.is_protected
      where r.organization_id = '22222222-2222-2222-2222-222222222222'
        and r.key = 'deacons_moderator' and r.role_kind = 'constitutional' and r.is_protected),
    1, '68e: POSITIVE CONTROL - Alder Creek''s seat role carries parishes.assign through one group-arm grant to the seat group');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where rp.permission_key = 'parishes.assign' and r.key <> 'deacons_moderator'),
    0, '68e: no other role in this organization carries parishes.assign');

  -- Binding arm: a custom role.
  insert into app_roles (id, organization_id, key, name, role_kind)
  values ('f0680000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222',
          'fixture_68_custom', 'Fixture 68 custom', 'custom');
  do $$
  declare v_c text;
  begin
    insert into app_role_permissions (role_id, permission_key)
    values ('f0680000-0000-0000-0000-0000000000e1', 'parishes.assign');
    raise exception 'FAIL 68e - parishes.assign was bound to a custom role';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_binding' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: parishes.assign cannot be bound to a custom role (seat_key_binding)';
  end $$;
  insert into app_role_permissions (role_id, permission_key)
  values ('f0680000-0000-0000-0000-0000000000e1', 'directory.view');
  select assert_eq((select count(*) from app_role_permissions where role_id = 'f0680000-0000-0000-0000-0000000000e1'),
    1, '68e: POSITIVE CONTROL - the binding guard ignores an ordinary key');

  -- Person arm: the seat role granted to Wren Thackeray directly.
  do $$
  declare v_c text;
  begin
    insert into role_grants (organization_id, role_id, person_id, starts_on)
    select '22222222-2222-2222-2222-222222222222', r.id, 'c0000000-0000-0000-0000-000000000008', current_date
      from app_roles r
     where r.organization_id = '22222222-2222-2222-2222-222222222222' and r.key = 'deacons_moderator';
    raise exception 'FAIL 68e - the seat role was granted to a person';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_grant' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: the seat role cannot be granted to a person (seat_key_grant)';
  end $$;

  -- Group arm, wrong group: the Session.
  do $$
  declare v_c text;
  begin
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    select '22222222-2222-2222-2222-222222222222', r.id, 'b0000000-0000-0000-0000-000000000001', current_date
      from app_roles r
     where r.organization_id = '22222222-2222-2222-2222-222222222222' and r.key = 'deacons_moderator';
    raise exception 'FAIL 68e - the seat role was granted to the Session group';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_grant' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: the seat role cannot be granted to any group but the seat group (seat_key_grant)';
  end $$;

  -- Re-pointing the existing seat grant at a person is refused too.
  do $$
  declare v_c text;
  begin
    update role_grants rg
       set group_id = null, person_id = 'c0000000-0000-0000-0000-000000000008'
      from app_roles r
     where r.id = rg.role_id and r.key = 'deacons_moderator'
       and rg.organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 68e - the seat grant was re-pointed at a person';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_grant' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: the seat grant cannot be re-pointed from the seat group to a person';
  end $$;

  -- Ending the seat grant is never blocked.
  with ended as (
    update role_grants rg set ends_on = current_date + 1
      from app_roles r
     where r.id = rg.role_id and r.key = 'deacons_moderator'
       and rg.organization_id = '22222222-2222-2222-2222-222222222222'
    returning 1)
  select assert_eq((select count(*) from ended),
    1, '68e: POSITIVE CONTROL - ending the seat grant (ends_on) is not blocked');

  -- Role shape: unprotecting or re-keying the seat role.
  do $$
  declare v_c text;
  begin
    update app_roles set is_protected = false
     where organization_id = '22222222-2222-2222-2222-222222222222' and key = 'deacons_moderator';
    raise exception 'FAIL 68e - the seat role was unprotected';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_role_shape' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: the seat role cannot be unprotected (seat_role_shape)';
  end $$;
  do $$
  declare v_c text;
  begin
    update app_roles set key = 'renamed_seat', role_kind = 'custom'
     where organization_id = '22222222-2222-2222-2222-222222222222' and key = 'deacons_moderator';
    raise exception 'FAIL 68e - the seat role was re-keyed';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_role_shape' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: the seat role cannot be re-keyed or made custom (seat_role_shape)';
  end $$;
  with deactivated as (
    update app_roles set deactivated_at = now()
     where organization_id = '22222222-2222-2222-2222-222222222222' and key = 'deacons_moderator'
    returning 1)
  select assert_eq((select count(*) from deactivated),
    1, '68e: POSITIVE CONTROL - the shape guard does not watch deactivated_at');

  -- Commission arm: the seeded Northern Reach commission into Alder Creek.
  do $$
  declare v_c text;
  begin
    update administrative_commissions ac
       set role_id = r.id
      from app_roles r
     where r.organization_id = '22222222-2222-2222-2222-222222222222' and r.key = 'deacons_moderator'
       and ac.target_org_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 68e - a commission was pointed at the seat role';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_downward' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: an administrative commission cannot carry the seat role (seat_key_downward)';
  end $$;

  -- Delegation arm.
  do $$
  declare v_c text;
  begin
    insert into org_delegations (grantor_org_id, grantee_org_id, role_id, group_id, starts_on)
    select '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', r.id,
           'b0000000-0000-0000-0000-000000000006', current_date
      from app_roles r
     where r.organization_id = '22222222-2222-2222-2222-222222222222' and r.key = 'deacons_moderator';
    raise exception 'FAIL 68e - a delegation carried the seat role';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_downward' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: a delegation cannot carry the seat role (seat_key_downward)';
  end $$;
rollback;

-- Reverse order, at an organization with no seat role (Northern Reach, a
-- presbytery): a tenant-made role shaped like the seat role may take the key
-- while it has never been granted (positive control), but not after a person
-- grant exists, and it can still never be granted to anything but a seat group,
-- which a presbytery does not have.
begin;
  select set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true);
  insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
  values ('f0680000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
          'deacons_moderator', 'Fixture 68 look-alike', 'constitutional', true);
  insert into role_grants (organization_id, role_id, person_id, starts_on)
  values ('11111111-1111-1111-1111-111111111111', 'f0680000-0000-0000-0000-0000000000e2',
          'c0000000-0000-0000-0000-000000000006', current_date); -- Rowan Thistlewood
  do $$
  declare v_c text;
  begin
    insert into app_role_permissions (role_id, permission_key)
    values ('f0680000-0000-0000-0000-0000000000e2', 'parishes.assign');
    raise exception 'FAIL 68e - the key was bound to a role already granted to a person';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_binding' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: grant-then-bind is refused: the key cannot be added to a role already granted on another arm (seat_key_binding)';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true);
  insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
  values ('f0680000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
          'deacons_moderator', 'Fixture 68 look-alike', 'constitutional', true);
  insert into app_role_permissions (role_id, permission_key)
  values ('f0680000-0000-0000-0000-0000000000e3', 'parishes.assign');
  select assert_eq((select count(*) from app_role_permissions where role_id = 'f0680000-0000-0000-0000-0000000000e3'),
    1, '68e: POSITIVE CONTROL - an ungranted, seat-shaped role may take the key (the guard is not a blanket refusal)');
  do $$
  declare v_c text;
  begin
    insert into role_grants (organization_id, role_id, person_id, starts_on)
    values ('11111111-1111-1111-1111-111111111111', 'f0680000-0000-0000-0000-0000000000e3',
            'c0000000-0000-0000-0000-000000000006', current_date);
    raise exception 'FAIL 68e - bind-then-grant to a person succeeded';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_grant' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: bind-then-grant to a person is refused (seat_key_grant)';
  end $$;
  do $$
  declare v_c text;
  begin
    insert into role_grants (organization_id, role_id, group_id, starts_on)
    values ('11111111-1111-1111-1111-111111111111', 'f0680000-0000-0000-0000-0000000000e3',
            'b0000000-0000-0000-0000-000000000006', current_date); -- Northern Reach Active Membership
    raise exception 'FAIL 68e - the key reached a presbytery group';
  exception when insufficient_privilege then
    get stacked diagnostics v_c = constraint_name;
    if v_c is distinct from 'seat_key_grant' then
      raise exception 'FAIL 68e - wrong constraint %', v_c;
    end if;
    raise notice 'pass  68e: at an organization with no seat group the key reaches no group (seat_key_grant)';
  end $$;
  -- No seat group at a presbytery, so the office cannot be recorded there.
  do $$
  begin
    insert into officer_terms (organization_id, person_id, office, starts_on)
    values ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000006',
            'deacons_moderator', current_date);
    raise exception 'FAIL 68e - a Moderator of the Board of Deacons term recorded at a presbytery';
  exception when foreign_key_violation then
    raise notice 'pass  68e: the seat office cannot be recorded at a presbytery (no derived group)';
  end $$;
rollback;

-- ===========================================================================
-- (f) the resolver: who holds parishes.assign (DECISION-242)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);

  select assert_eq(
    presby_has_permission('c0000000-0000-0000-0000-000000000008',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date)::int,
    1, '68f: POSITIVE CONTROL - Wren Thackeray (recorded seat holder, no admin key) holds parishes.assign today');
  select assert_eq(
    (select count(*) from presby_effective_permissions('c0000000-0000-0000-0000-000000000008',
                                                       '22222222-2222-2222-2222-222222222222')
      where permission_key = 'parishes.assign' and source_kind = 'group'
        and source_name = 'Board of Deacons Moderator'
        and role_name = 'Moderator of the Board of Deacons'),
    1, '68f: and through the group arm, named for the seat (explainPermission provenance)');
  select assert_eq(
    presby_has_permission('c0000000-0000-0000-0000-000000000008',
                          '22222222-2222-2222-2222-222222222222', 'directory.view_hidden', current_date)::int,
    0, '68f: the seat confers no directory.view_hidden');
  select assert_eq(
    presby_has_permission('c0000000-0000-0000-0000-000000000003',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date)::int,
    0, '68f: Priya Balakrishnan (an open deacon term) does not hold parishes.assign');
  select assert_eq(
    presby_has_permission('c0000000-0000-0000-0000-000000000006',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date)::int,
    0, '68f: Rowan Thistlewood (installed pastor, on the Session) does not hold parishes.assign');

  -- A moderator (the Session presiding label, DECISION-079) term grants nothing.
  insert into officer_terms (organization_id, person_id, office, starts_on)
  values ('22222222-2222-2222-2222-222222222222', 'c0680000-0000-0000-0000-000000000001',
          'moderator', current_date - 10);
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000001',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date)::int,
    0, '68f: an open moderator term does not confer parishes.assign (DECISION-079 unchanged)');

  -- An ended seat grants nothing today.
  insert into officer_terms (organization_id, person_id, office, starts_on, ends_on, end_reason)
  values ('22222222-2222-2222-2222-222222222222', 'c0680000-0000-0000-0000-000000000002',
          'deacons_moderator', '2026-01-01', '2026-03-01', 'completed');
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000002',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date)::int,
    0, '68f: an ended seat confers nothing');

  -- A future seat: nothing before its start date, from it, and not on its end
  -- date (half-open [starts_on, ends_on), the resolver's own rule).
  insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
  values ('22222222-2222-2222-2222-222222222222', 'c0680000-0000-0000-0000-000000000001',
          'deacons_moderator', current_date + 10, current_date + 20);
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000001',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date)::int,
    0, '68f: a future seat confers nothing today');
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000001',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date + 9)::int,
    0, '68f: nor the day before it starts');
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000001',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date + 10)::int,
    1, '68f: it confers parishes.assign on its start date');
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000001',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date + 19)::int,
    1, '68f: and on the last day before its end date');
  select assert_eq(
    presby_has_permission('c0680000-0000-0000-0000-000000000001',
                          '22222222-2222-2222-2222-222222222222', 'parishes.assign', current_date + 20)::int,
    0, '68f: and not on its end date (half-open)');
rollback;

-- Cross-org: Wren's seat is at Alder Creek; Bramblewood gives her nothing.
begin;
  select set_config('app.current_org_id', '33333333-3333-3333-3333-333333333333', true);
  select assert_eq(
    presby_has_permission('c0000000-0000-0000-0000-000000000008',
                          '33333333-3333-3333-3333-333333333333', 'parishes.assign', current_date)::int,
    0, '68f: a seat at one organization grants nothing at another');
rollback;

-- ===========================================================================
-- (g) org_units isolation, archived district included
-- ===========================================================================
begin;
  select set_config('app.current_org_id', '22222222-2222-2222-2222-222222222222', true);
  select assert_eq((select count(*) from org_units where archived_at is not null),
    1, '68g: Alder Creek sees its one archived district (East)');
  select assert_eq((select count(*) from org_units where organization_id <> '22222222-2222-2222-2222-222222222222'),
    0, '68g: and no other organization''s district');
  with touched as (
    update org_units set archived_at = now()
     where organization_id <> '22222222-2222-2222-2222-222222222222'
    returning 1)
  select assert_eq((select count(*) from touched),
    0, '68g: presby_app cannot archive another organization''s district from this context');
rollback;

begin;
  select set_config('app.current_org_id', '33333333-3333-3333-3333-333333333333', true);
  select assert_eq((select count(*) from org_units where organization_id = '22222222-2222-2222-2222-222222222222'),
    0, '68g: Bramblewood sees none of Alder Creek''s districts, archived or not');
rollback;

\echo '======================================================'
\echo ' Section 68 complete.'
\echo '======================================================'
