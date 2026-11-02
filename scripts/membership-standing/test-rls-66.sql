-- ---------------------------------------------------------------------------
-- 66. Community Increment 3a: member standing, the derived-row and
--     derived-group guards, the pair, the engagement and roll-cache guards
--     (drizzle/0066_presby_membership_standing.sql; DECISION-232 to 236;
--     F240, F243, F244, F245; docs/work-log/2026-10-22-founding-admin-
--     directory-inc3.md Phase 3 section 12, amended section A13).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner, and loses the one-active-roll
--     block that inserted current_roll as presby_app (it is refused by the
--     roll-cache guard now; the unique-index property moved to the owner
--     connection in src/lib/db/domain/engagement-guards.db.test.ts):
--     scripts/membership-standing/test-rls.sql.integration.patch.
--
--         \ir membership-standing/test-rls-66.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/membership-standing/test-rls-66.sql
--
--     after scripts/install-test-helpers.sql (owner), scripts/seed-dev.sql and
--     its last include, scripts/membership-standing/seed-dev-membership-
--     standing.sql (Alder Creek's calendar_viewer role; block (i) needs it).
--     People and memberships are created INSIDE the blocks, every block that
--     writes ends in rollback, so the suite writes nothing durable and moves
--     no existing count.
--
--     Blocks:
--       (a) structure       FORCE RLS, the unique key, triggers, CHECKs,
--                           definer attributes, EXECUTE grants
--       (b) classifier      presby_standing_is_member,
--                           presby_membership_is_member_standing
--       (c) F240 and F245   the derived-row and derived-group guards
--       (d) sync            both derived rows follow standing and ended_on
--       (e) pair            a presby_app insert of active_membership makes
--                           exactly its own organization's sibling
--       (f) engagement      the three refusals, the vocabulary, the allowed
--                           transitions
--       (g) roll cache      INSERT and UPDATE refused, null roll passes
--       (h) isolation       another organization sees and changes nothing
--       (i) baseline        visitor: events.view, not directory.view
--       (j) archive/restore the SQL semantics the Batch B writer uses
--       (k) groups shape    pairing and five-kind CHECKs
--       (l) section 9       the three re-created 0065 bodies (Batch A2):
--                           a grant on All Current Records is outside the
--                           set T; issue asks no visitor acknowledgement;
--                           connect declines inactive and moved away and
--                           connects regular. Uses the Hollinbrook rows of
--                           scripts/sign-in-invitations/seed-dev-sign-in.sql,
--                           which scripts/seed-dev.sql includes before
--                           this file's own seed include
--
--     What presby_app CANNOT reach (the OWNER path through every guard, the
--     stop-blocks, the backfill re-execution, the live-catalog scans, the
--     officer sync's body) is proven in Vitest:
--     src/lib/membership-standing.db.test.ts,
--     src/lib/db/domain/derived-group-guard.db.test.ts and
--     src/lib/db/domain/engagement-guards.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set M66_ALDER   '\'22222222-2222-2222-2222-222222222222\''
\set M66_BRAMBLE '\'33333333-3333-3333-3333-333333333333\''
\set M66_SOUTH   '\'f6000000-0000-0000-0000-000000000001\''
\set M66_ELDER   '\'c0000000-0000-0000-0000-000000000001\''
\set M66_ROWAN   '\'c0000000-0000-0000-0000-000000000006\''
\set M66_SESSION '\'b0000000-0000-0000-0000-000000000001\''
\set M66_PROPERTY '\'b0000000-0000-0000-0000-000000000004\''
\set M66_VIS     '\'c6600000-0000-4000-8000-000000000001\''
\set M66_REG     '\'c6600000-0000-4000-8000-000000000002\''
\set M66_STAFF   '\'c6600000-0000-4000-8000-000000000003\''
\set M66_H65_ORG    '\'65000000-0000-4000-8000-000000000001\''
\set M66_H65_SENDER '\'e6500000-0000-4000-8000-0000000000a0\''
\set M66_H65_CLEM   '\'c6500000-0000-4000-8000-000000000003\''
\set M66_H65_U3     '\'e6500000-0000-4000-8000-000000000003\''

\echo '======================================================'
\echo ' Section 66 (member standing and the derived-row guards, drizzle/0066) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '66: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname in ('groups', 'group_memberships', 'memberships')
        and relrowsecurity and relforcerowsecurity),
    3, '66a: groups, group_memberships and memberships have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'group_memberships'::regclass and contype = 'u'
        and conname = 'group_memberships_membership_group_key'
        and pg_get_constraintdef(oid) = 'UNIQUE (membership_id, group_id)'),
    1, '66a: one derived row per (membership, group): unique (membership_id, group_id)');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'group_memberships'::regclass
        and conname = 'group_memberships_membership_key'),
    0, '66a: and the old unique (membership_id) is gone');
  select assert_eq(
    (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O'
        and (tgrelid, tgname) in (('groups'::regclass, 'groups_pair_derived'),
                                  ('groups'::regclass, 'groups_reject_derived_edit'),
                                  ('group_memberships'::regclass, 'group_memberships_reject_derived'),
                                  ('memberships'::regclass, 'memberships_sync_derived_group'),
                                  ('memberships'::regclass, 'memberships_guard_engagement'),
                                  ('memberships'::regclass, 'memberships_guard_roll_cache_insert'),
                                  ('memberships'::regclass, 'memberships_guard_roll_cache_update'))),
    7, '66a: the pair, both reject guards, the sync, the engagement guard and both roll-cache triggers are present and enabled');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'memberships'::regclass and contype = 'c' and convalidated
        and conname = 'memberships_engagement_status_allowed'),
    1, '66a (F243): the engagement vocabulary CHECK exists and is VALIDATED');
  select assert_eq(
    (select count(*) from pg_proc where prosecdef
        and array_to_string(proconfig, ',') = 'search_path=public, pg_temp'
        and proname in ('presby_pair_derived_groups', 'presby_sync_derived_membership_group', 'presby_sync_derived_group')),
    3, '66a: the pair and both sync functions are SECURITY DEFINER with search_path pinned (owner path)');
  select assert_eq(
    (select count(*) from pg_proc where not prosecdef
        and array_to_string(proconfig, ',') = 'search_path=public, pg_temp'
        and proname in ('presby_reject_derived_group_write', 'presby_reject_derived_group_edit',
                        'presby_memberships_guard_engagement', 'presby_memberships_guard_roll_cache')),
    4, '66a: the four guards are INVOKER (current_user is the caller) with search_path pinned');
  select assert_eq(
    (select count(*) from (values ('presby_standing_is_member(text)'),
                                  ('presby_membership_is_member_standing(text,text)')) v(f)
      where has_function_privilege('presby_app', f, 'execute')),
    2, '66a: presby_app may EXECUTE the two classifier-layer functions');
  select assert_eq(
    (select count(*) from (values ('presby_pair_derived_groups()'), ('presby_sync_derived_membership_group()'),
                                  ('presby_sync_derived_group()'), ('presby_reject_derived_group_write()'),
                                  ('presby_reject_derived_group_edit()'), ('presby_memberships_guard_engagement()'),
                                  ('presby_memberships_guard_roll_cache()')) v(f),
                         (values ('presby_app'), ('presby_platform')) r(role)
      where has_function_privilege(role, f, 'execute')),
    0, '66a (arch-A3 ii): neither application role may EXECUTE the pair, sync or guard functions');
rollback;

-- ===========================================================================
-- (b) Classifier layer
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from (values ('listed', true), ('staff_anchor', true), ('visitor', false),
                                  ('inactive', false), ('unclassified', false)) v(s, expected)
      where presby_standing_is_member(s) is not distinct from expected),
    5, '66b: member standing is exactly listed and staff_anchor');
  select assert_eq(
    (select count(*) from (values
        ('active', 'regular', true), ('active', 'visitor', true), ('active', 'inactive', true),
        ('other_participant', 'regular', true), ('other_participant', 'visitor', true),
        (null, 'regular', true), (null, 'staff', true), (null, 'visitor', false),
        (null, 'inactive', false), (null, 'moved_away', false),
        ('zzz', 'visitor', false), ('zzz', 'regular', true)) v(r, e, expected)
      where presby_membership_is_member_standing(r, e) is not distinct from expected),
    12, '66b: presby_membership_is_member_standing over the R51 matrix values (M1-M12)');
rollback;

-- ===========================================================================
-- (c) F240 (group_memberships) and F245 (groups), as presby_app
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);

  -- F240: a self-labelled derived row in a MANAGED group. Only the 0066 arm
  -- can refuse this (the shipped source check sees a managed group).
  do $$
  begin
    insert into group_memberships (organization_id, group_id, person_id, source)
    values ('22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000004',
            'c0000000-0000-0000-0000-000000000006', 'derived');
    raise exception 'FAIL 66c: presby_app inserted a self-labelled derived row';
  exception when check_violation then
    if sqlerrm not like 'group_memberships:%F240%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c (F240): a self-labelled derived row in a managed group is refused';
  end $$;

  -- F240: a derived row inserted straight into the Active Membership group.
  do $$
  begin
    insert into group_memberships (organization_id, group_id, person_id, source)
    select '22222222-2222-2222-2222-222222222222', g.id, 'c0000000-0000-0000-0000-000000000006', 'derived'
      from groups g where g.organization_id = '22222222-2222-2222-2222-222222222222' and g.derived_from = 'active_membership';
    raise exception 'FAIL 66c: presby_app inserted a row into a derived group';
  exception when check_violation then
    if sqlerrm not like 'group_memberships:%F240%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c (F240): a derived row inserted into the Active Membership group is refused';
  end $$;

  -- F240: ends_on and group_id on an existing derived row.
  do $$
  declare v_row uuid;
  begin
    select gm.id into v_row from group_memberships gm join groups g on g.id = gm.group_id
     where g.organization_id = '22222222-2222-2222-2222-222222222222' and g.derived_from = 'active_membership'
       and gm.person_id = 'c0000000-0000-0000-0000-000000000001' and gm.ends_on is null;
    if v_row is null then raise exception 'FAIL 66c: fixture premise - Alder Creek''s elder has no open Active Membership row'; end if;
    begin
      update group_memberships set ends_on = current_date where id = v_row;
      raise exception 'FAIL 66c: presby_app closed a derived row';
    exception when check_violation then
      if sqlerrm not like 'group_memberships:%F240%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    end;
    begin
      update group_memberships set group_id = (select id from groups where organization_id = '22222222-2222-2222-2222-222222222222'
                                                 and derived_from = 'all_memberships')
       where id = v_row;
      raise exception 'FAIL 66c: presby_app moved a derived row to another group';
    exception when check_violation then
      if sqlerrm not like 'group_memberships:%F240%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    end;
    -- The public listing columns stay writable (Officers, Groups, Staff toggle them).
    update group_memberships set public_display_order = 7 where id = v_row;
    if not found then raise exception 'FAIL 66c: the public listing toggle on a derived row did not apply'; end if;
    -- The shipped DELETE refusal is unchanged.
    begin
      delete from group_memberships where id = v_row;
      raise exception 'FAIL 66c: presby_app deleted a derived row';
    exception when check_violation then
      if sqlerrm not like 'group_memberships:%cannot be deleted directly%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    end;
    raise notice 'pass  66c (F240): ends_on and group_id on a derived row are refused; public_display_order passes; DELETE still refused';
  end $$;

  -- A managed row in a managed group: insert and update still work.
  insert into group_memberships (organization_id, group_id, person_id, source)
  values (:M66_ALDER, :M66_PROPERTY, :M66_ROWAN, 'managed');
  update group_memberships set group_role = 'chair'
   where group_id = :M66_PROPERTY and person_id = :M66_ROWAN and source = 'managed';
  select assert_eq(
    (select count(*) from group_memberships where group_id = :M66_PROPERTY and person_id = :M66_ROWAN and group_role = 'chair'),
    1, '66c: a managed row in a managed group is still inserted and updated by presby_app');

  -- F245 on groups.
  do $$
  begin
    update groups set membership_source = 'managed', derived_from = null
     where id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 66c: presby_app flipped the Session group to managed';
  exception when check_violation then
    if sqlerrm not like 'groups:%F245%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c (F245): the Session group cannot be flipped to managed';
  end $$;
  do $$
  begin
    update groups set derived_from = 'all_memberships'
     where organization_id = '22222222-2222-2222-2222-222222222222' and derived_from = 'active_membership';
    raise exception 'FAIL 66c: presby_app changed a derived group''s kind';
  exception when check_violation then
    if sqlerrm not like 'groups:%F245%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c (F245): active_membership''s derived_from cannot change';
  end $$;
  do $$
  begin
    update groups set is_protected = false
     where organization_id = '22222222-2222-2222-2222-222222222222' and derived_from = 'all_memberships';
    raise exception 'FAIL 66c: presby_app unprotected a derived group';
  exception when check_violation then
    if sqlerrm not like 'groups:%F245%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c (F245): is_protected on a derived group cannot change';
  end $$;
  do $$
  begin
    update groups set membership_source = 'derived', derived_from = 'all_memberships'
     where id = 'b0000000-0000-0000-0000-000000000004';
    raise exception 'FAIL 66c: presby_app flipped a managed group to derived';
  exception when check_violation then
    if sqlerrm not like 'groups:%F245%' then raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c (F245): a managed group cannot be flipped to derived';
  end $$;
  -- The shipped name refusal still binds (unchanged message).
  do $$
  begin
    update groups set name = 'Renamed' where id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 66c: presby_app renamed the Session group';
  exception when check_violation then
    if sqlerrm not like 'groups:%its name, description, and meeting schedule are not editable directly' then
      raise exception 'FAIL 66c: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66c: the shipped derived-group rename refusal is unchanged';
  end $$;
  update groups set name = 'Property Committee (66c)' where id = :M66_PROPERTY;
  select assert_eq((select count(*) from groups where id = :M66_PROPERTY and name = 'Property Committee (66c)'),
    1, '66c (F245): a managed-group rename is still allowed');
rollback;

-- ===========================================================================
-- (d) Sync: both derived rows follow standing and ended_on (DECISION-232)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);
  insert into people (id, first_name, last_name) values (:M66_VIS, 'Fixture', 'Visitor66');
  insert into memberships (organization_id, person_id, engagement_status) values (:M66_ALDER, :M66_VIS, 'visitor');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'all_memberships' and gm.ends_on is null and gm.source = 'derived'),
    1, '66d: a visitor membership gets an OPEN All Current Records row');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'active_membership'),
    0, '66d: and NO Active Membership row (F177 Option 1)');

  update memberships set engagement_status = 'regular' where person_id = :M66_VIS and organization_id = :M66_ALDER;
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'active_membership' and gm.ends_on is null
        and gm.starts_on = current_date),
    1, '66d: visitor to regular OPENS the Active Membership row, starting today');

  update memberships set engagement_status = 'inactive' where person_id = :M66_VIS and organization_id = :M66_ALDER;
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'active_membership' and gm.ends_on = current_date),
    1, '66d: regular to inactive CLOSES the Active Membership row at current_date');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'all_memberships' and gm.ends_on is null),
    1, '66d: and the All Current Records row stays open');

  update memberships set ended_on = current_date, ended_reason = 'moved away'
   where person_id = :M66_VIS and organization_id = :M66_ALDER;
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from in ('all_memberships', 'active_membership')
        and gm.ends_on = current_date),
    2, '66d: ending the membership ends both rows');
rollback;

-- ===========================================================================
-- (e) The pair: a presby_app insert of an active_membership group
--
--     Needs an organization with NO derived group, which presby_app cannot
--     create (no INSERT on organizations, DECISION-135). On a database built
--     from empty (CI, the from-empty rehearsal) the Southern Fields presbytery
--     fixture is that organization. On a long-lived branch (development and
--     its copies) 0082 gave every organization with no `member` role an Active
--     Membership group, and 0066's backfill then gave it All Current Records,
--     so the premise cannot hold there: the block is SKIPPED with a visible
--     line rather than failing on data drift (Batch A2). The pair is proven on
--     every database by derived-group-guard.db.test.ts, T-G test 1.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_SOUTH, true);
  select (count(*) = 0) as m66_south_bare
    from groups where organization_id = :M66_SOUTH and membership_source = 'derived' \gset
rollback;
\if :m66_south_bare
begin;
  select set_config('app.current_org_id', :M66_SOUTH, true);
  create temp table m66_before on commit drop as
    select (select count(*) from groups where derived_from = 'all_memberships') as all_groups,
           (select count(*) from app_roles) as roles,
           (select count(*) from app_role_permissions) as permissions,
           (select count(*) from role_grants) as grants;
  select assert_eq((select count(*) from groups where organization_id = :M66_SOUTH and membership_source = 'derived'),
    0, '66e: premise - the Southern Fields presbytery fixture has no derived group');
  insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
  values (:M66_SOUTH, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true);
  select assert_eq(
    (select count(*) from groups where organization_id = :M66_SOUTH and derived_from = 'all_memberships'
        and membership_source = 'derived' and is_protected and name = 'All Current Records'
        and group_type_id = (select id from group_types where key = 'roster')),
    1, '66e (arch-A3 i): inserting active_membership as presby_app creates exactly one All Current Records sibling, same organization, fixed literals');
  select assert_eq(
    (select (select count(*) from groups where derived_from = 'all_memberships') - all_groups from m66_before),
    1, '66e: and no sibling anywhere else (the presby_app view counts only this organization)');
  select assert_eq(
    (select ((select count(*) from app_roles) = roles and (select count(*) from app_role_permissions) = permissions
             and (select count(*) from role_grants) = grants)::int from m66_before),
    1, '66e (arch-A3 i): and no role, permission or grant row changed');
rollback;
\else
\echo 'skip  66e: Southern Fields already holds derived groups (0082 on a long-lived branch); the pair is proven by derived-group-guard.db.test.ts T-G test 1'
\endif

-- ===========================================================================
-- (f) Engagement guard and vocabulary (R53, F243), as presby_app
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);
  insert into people (id, first_name, last_name) values
    (:M66_VIS, 'Fixture', 'Visitor66'), (:M66_STAFF, 'Fixture', 'Staff66');
  insert into memberships (organization_id, person_id, engagement_status) values
    (:M66_ALDER, :M66_VIS, 'visitor'), (:M66_ALDER, :M66_STAFF, 'staff');

  -- Allowed: every transition among the four editable values.
  update memberships set engagement_status = 'regular'    where person_id = :M66_VIS and organization_id = :M66_ALDER;
  update memberships set engagement_status = 'inactive'   where person_id = :M66_VIS and organization_id = :M66_ALDER;
  update memberships set engagement_status = 'moved_away' where person_id = :M66_VIS and organization_id = :M66_ALDER;
  update memberships set engagement_status = 'visitor'    where person_id = :M66_VIS and organization_id = :M66_ALDER;
  select assert_eq((select count(*) from memberships where person_id = :M66_VIS and engagement_status = 'visitor'),
    1, '66f: visitor, regular, inactive, moved_away and back are all allowed transitions');

  do $$
  begin
    update memberships set engagement_status = 'staff'
     where person_id = 'c6600000-0000-4000-8000-000000000001' and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 66f: engagement changed INTO staff';
  exception when check_violation then
    if sqlerrm not like 'memberships: staff is set only when a staff record is created%' then raise exception 'FAIL 66f: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66f (R53): a transition into staff is refused';
  end $$;
  do $$
  begin
    update memberships set engagement_status = 'regular'
     where person_id = 'c6600000-0000-4000-8000-000000000003' and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 66f: engagement changed OUT OF staff';
  exception when check_violation then
    if sqlerrm not like 'memberships: staff is set only when a staff record is created%' then raise exception 'FAIL 66f: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66f (R53): a transition out of staff is refused';
  end $$;
  do $$
  begin
    -- Marguerite Ashcombe is on Alder Creek's roll (the seed's active member).
    update memberships set engagement_status = 'visitor'
     where person_id = 'c0000000-0000-0000-0000-000000000001' and organization_id = '22222222-2222-2222-2222-222222222222';
    if not found then raise exception 'FAIL 66f: fixture premise - the elder has no Alder Creek membership'; end if;
    raise exception 'FAIL 66f: a person on the roll was marked as a visitor';
  exception when check_violation then
    if sqlerrm not like 'memberships: a person on the roll cannot be marked as a visitor%' then raise exception 'FAIL 66f: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66f (R53): visitor on a rolled membership is refused';
  end $$;
  do $$
  begin
    update memberships set engagement_status = 'unknown'
     where person_id = 'c6600000-0000-4000-8000-000000000001' and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 66f: a value outside the vocabulary was stored';
  exception when check_violation then
    if sqlerrm not like '%memberships_engagement_status_allowed%' then raise exception 'FAIL 66f: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66f (F243): a value outside the five is refused by the CHECK';
  end $$;

  update memberships set ended_on = current_date, ended_reason = 'moved away'
   where person_id = :M66_VIS and organization_id = :M66_ALDER;
  do $$
  begin
    update memberships set engagement_status = 'regular'
     where person_id = 'c6600000-0000-4000-8000-000000000001' and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 66f: engagement changed on an ended membership';
  exception when check_violation then
    if sqlerrm not like 'memberships: this membership has ended%' then raise exception 'FAIL 66f: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66f (R53): any engagement change on an ended membership is refused';
  end $$;
rollback;

-- ===========================================================================
-- (g) Roll cache (F244). Each refusal is caught on check_violation AND the
--     memberships: prefix only, never `others`: with the guard removed the
--     insert would reach memberships_one_active_roll_idx and abort the suite
--     loudly with unique_violation instead of passing as "refused" (arch-A4).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);
  insert into people (id, first_name, last_name) values (:M66_REG, 'Fixture', 'Regular66');
  insert into memberships (organization_id, person_id, engagement_status, current_roll)
  values (:M66_ALDER, :M66_REG, 'regular', null);
  select assert_eq((select count(*) from memberships where person_id = :M66_REG and current_roll is null),
    1, '66g: an insert with a null roll passes');

  do $$
  begin
    update memberships set current_roll = 'active'
     where person_id = 'c6600000-0000-4000-8000-000000000002' and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 66g: presby_app wrote current_roll';
  exception when check_violation then
    if sqlerrm not like 'memberships:%F244%' then raise exception 'FAIL 66g: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66g (F244): an UPDATE of current_roll is refused';
  end $$;
  do $$
  begin
    update memberships set current_roll_since = current_date
     where person_id = 'c6600000-0000-4000-8000-000000000002' and organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 66g: presby_app wrote current_roll_since';
  exception when check_violation then
    if sqlerrm not like 'memberships:%F244%' then raise exception 'FAIL 66g: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66g (F244): an UPDATE of current_roll_since is refused';
  end $$;
  do $$
  begin
    -- The elder already holds an active roll elsewhere: without the guard
    -- this would be unique_violation, which this handler does not catch.
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    values ('22222222-2222-2222-2222-222222222222', 'c6600000-0000-4000-8000-000000000001', 'regular', 'active');
    raise exception 'FAIL 66g: presby_app inserted a membership with a roll';
  exception when check_violation then
    if sqlerrm not like 'memberships:%F244%' then raise exception 'FAIL 66g: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66g (F244): an INSERT with current_roll is refused';
  end $$;
  do $$
  begin
    insert into memberships (organization_id, person_id, engagement_status, current_roll_since)
    values ('22222222-2222-2222-2222-222222222222', 'c6600000-0000-4000-8000-000000000001', 'regular', current_date);
    raise exception 'FAIL 66g: presby_app inserted a membership with current_roll_since';
  exception when check_violation then
    if sqlerrm not like 'memberships:%F244%' then raise exception 'FAIL 66g: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66g (F244): an INSERT with current_roll_since is refused';
  end $$;
rollback;

-- The one-active-roll property against a real second roll, as presby_app,
-- moved here from test-rls.sql section 7: the guard refuses first.
begin;
  select set_config('app.current_org_id', :M66_BRAMBLE, true);
  select set_config('app.person_claim_authorized', :M66_ELDER, true);
  do $$
  begin
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    values ('33333333-3333-3333-3333-333333333333',
            'c0000000-0000-0000-0000-000000000001', 'regular', 'active');
    raise exception 'FAIL 66g: a person holds two active-roll memberships';
  exception when check_violation then
    if sqlerrm not like 'memberships:%F244%' then raise exception 'FAIL 66g: wrong refusal: %', sqlerrm; end if;
    raise notice 'pass  66g (F244): a second active roll from presby_app is refused at the roll-cache guard (the unique index is asserted on the owner connection, engagement-guards.db.test.ts)';
  end $$;
rollback;

-- ===========================================================================
-- (h) Isolation
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);
  select m.id as m66_alder_membership from memberships m
   where m.organization_id = :M66_ALDER and m.person_id = :M66_ELDER \gset
  select set_config('app.current_org_id', :M66_BRAMBLE, true);
  select assert_eq(
    (select count(*) from groups where organization_id = :M66_ALDER and derived_from = 'all_memberships'),
    0, '66h: Bramblewood cannot see Alder Creek''s All Current Records group');
  select assert_eq(
    (select count(*) from group_memberships where organization_id = :M66_ALDER),
    0, '66h: nor any of Alder Creek''s group rows');
  with u as (update memberships set household_id = null where id = :'m66_alder_membership' returning 1)
  select assert_eq((select count(*) from u), 0, '66h: an UPDATE of Alder Creek''s membership by id affects zero rows');
rollback;

-- ===========================================================================
-- (i) Baseline: a visitor keeps the calendar and loses the directory
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);
  select assert_eq(
    (select count(*) from app_roles r join app_role_permissions p on p.role_id = r.id
       join role_grants rg on rg.role_id = r.id join groups g on g.id = rg.group_id
      where r.organization_id = :M66_ALDER and r.key = 'calendar_viewer' and r.role_kind = 'constitutional'
        and r.is_protected and p.permission_key = 'events.view' and g.derived_from = 'all_memberships'
        and rg.ends_on is null),
    1, '66i: premise - Alder Creek holds the calendar_viewer role (events.view) on All Current Records (seed include)');
  insert into people (id, first_name, last_name) values
    (:M66_VIS, 'Fixture', 'Visitor66'), (:M66_REG, 'Fixture', 'Regular66');
  insert into memberships (organization_id, person_id, engagement_status) values
    (:M66_ALDER, :M66_VIS, 'visitor'), (:M66_ALDER, :M66_REG, 'regular');
  select assert_eq(presby_has_permission(:M66_VIS, :M66_ALDER, 'events.view')::int, 1,
    '66i: a visitor resolves events.view (Calendar viewer through All Current Records)');
  select assert_eq(presby_has_permission(:M66_VIS, :M66_ALDER, 'directory.view')::int, 0,
    '66i (F177): a visitor does NOT resolve directory.view');
  select assert_eq(presby_has_permission(:M66_REG, :M66_ALDER, 'events.view')::int, 1,
    '66i: a regular attender resolves events.view');
  select assert_eq(presby_has_permission(:M66_REG, :M66_ALDER, 'directory.view')::int, 1,
    '66i: a regular attender resolves directory.view (member through Active Membership)');
rollback;

-- ===========================================================================
-- (j) Archive and restore: the SQL semantics Batch B's writer uses
--     (DECISION-235; marker community_archived)
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_ALDER, true);
  insert into people (id, first_name, last_name) values (:M66_VIS, 'Fixture', 'Visitor66');
  insert into memberships (organization_id, person_id, engagement_status) values (:M66_ALDER, :M66_VIS, 'visitor');
  with u as (
    update memberships set ended_on = current_date, ended_reason = 'community_archived', updated_at = now()
     where organization_id = :M66_ALDER and person_id = :M66_VIS and ended_on is null
       and presby_membership_standing(current_roll, engagement_status) in ('visitor', 'inactive', 'unclassified')
    returning 1)
  select assert_eq((select count(*) from u), 1, '66j: the conditional archive update ends a visitor');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'all_memberships' and gm.ends_on = current_date),
    1, '66j: archive closes the All Current Records row');
  with u as (
    update memberships set ended_on = null, ended_reason = null, updated_at = now()
     where organization_id = :M66_ALDER and person_id = :M66_VIS and ended_on is not null
       and ended_reason = 'community_archived'
    returning 1)
  select assert_eq((select count(*) from u), 1, '66j: restore clears the archive marker');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'all_memberships' and gm.ends_on is null),
    1, '66j: restore REOPENS the All Current Records row');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_VIS and g.derived_from = 'active_membership'),
    0, '66j: and a restored visitor still has no Active Membership row');
  with u as (
    update memberships set ended_on = null, ended_reason = null
     where organization_id = :M66_ALDER and person_id = :M66_ELDER and ended_on is not null
       and ended_reason = 'community_archived'
    returning 1)
  select assert_eq((select count(*) from u), 0, '66j: restore matches only the archive marker (a live member is untouched)');

  -- memberships_guard_end is the backstop: Rowan holds an open role grant.
  do $$
  begin
    update memberships set ended_on = current_date, ended_reason = 'community_archived'
     where organization_id = '22222222-2222-2222-2222-222222222222' and person_id = 'c0000000-0000-0000-0000-000000000006';
    raise exception 'FAIL 66j: a person holding an open role grant was archived';
  exception when check_violation then
    raise notice 'pass  66j: memberships_guard_end refuses to archive a person holding an open role grant';
  end $$;
rollback;

-- ===========================================================================
-- (k) The shape of groups (arch-A2, D9)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'groups'::regclass and contype = 'c' and convalidated
        and conname in ('groups_derived_pairing_check', 'groups_derived_kind_check')),
    2, '66k: the pairing and kind CHECKs exist and are VALIDATED');
  select assert_eq(
    (select count(*) from pg_constraint where conrelid = 'groups'::regclass and conname = 'groups_derived_kind_check'
        and pg_get_constraintdef(oid) like '%''active_membership''%''all_memberships''%''session''%''diaconate''%''deacons_moderator''%'),
    1, '66k (D9): the kind list names the five kinds');
  select set_config('app.current_org_id', :M66_SOUTH, true);
  do $$
  declare v_con text;
  begin
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
    values ('f6000000-0000-0000-0000-000000000001', (select id from group_types where key = 'committee'),
            'Managed with a kind', 'managed', 'all_memberships');
    raise exception 'FAIL 66k: a managed group with a derived_from was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'groups_derived_pairing_check' then raise exception 'FAIL 66k: wrong constraint %', v_con; end if;
    raise notice 'pass  66k: a managed group with a derived_from is refused (groups_derived_pairing_check)';
  end $$;
  do $$
  declare v_con text;
  begin
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
    values ('f6000000-0000-0000-0000-000000000001', (select id from group_types where key = 'roster'),
            'Derived without a kind', 'derived', null);
    raise exception 'FAIL 66k: a derived group without a derived_from was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con not in ('groups_derived_pairing_check', 'groups_derived_check') then raise exception 'FAIL 66k: wrong constraint %', v_con; end if;
    raise notice 'pass  66k: a derived group without a derived_from is refused';
  end $$;
  do $$
  declare v_con text;
  begin
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
    values ('f6000000-0000-0000-0000-000000000001', (select id from group_types where key = 'roster'),
            'A sixth kind', 'derived', 'fixture_sixth_kind');
    raise exception 'FAIL 66k: a sixth derived kind was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con <> 'groups_derived_kind_check' then raise exception 'FAIL 66k: wrong constraint %', v_con; end if;
    raise notice 'pass  66k (D9): a sixth derived kind is refused (groups_derived_kind_check)';
  end $$;
rollback;

-- ===========================================================================
-- (l) Section 9: the three 0065 bodies re-created (Batch A2; amendment A4.2,
--     D10b; R49, R55). Clementine Ashby (Hollinbrook, visitor, no roll, a
--     proven unlinked account U3) is moved between standings as presby_app
--     inside one rolled-back transaction; connect reads the uncommitted row.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :M66_H65_ORG, true);
  select assert_eq(
    (select count(*) from role_grants rg
       join app_roles r on r.id = rg.role_id and r.key = 'calendar_viewer'
       join groups g on g.id = rg.group_id and g.derived_from = 'all_memberships'
      where rg.organization_id = :M66_H65_ORG and rg.ends_on is null),
    1, '66l premise: Hollinbrook''s calendar_viewer role is granted to All Current Records');
  select assert_eq(
    (select count(*) from group_memberships gm join groups g on g.id = gm.group_id
      where gm.person_id = :M66_H65_CLEM and g.derived_from = 'all_memberships' and gm.ends_on is null),
    1, '66l premise: the visitor holds an open All Current Records row, so the grant reaches her');
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby__person_sign_in_standing'
        and position('derived_from in (''active_membership'', ''all_memberships'', ''session'', ''diaconate'')' in prosrc) > 0
        and position('deacons_moderator' in prosrc) = 0),
    1, '66l (D10b): the core''s T exclusion list is the four kinds; deacons_moderator stays in T');
  select assert_eq(
    (select count(*) from presby_issue_sign_in_invitation(:M66_H65_CLEM, repeat('6', 64), now() + interval '7 days', null,
       'clementine.ashby.signin65@example.invalid', false, :M66_H65_SENDER)
      where outcome = 'ok' and ack_reasons = '{}'),
    1, '66l (check 10): a visitor is invited with no acknowledgement and no reason');
rollback;

begin;
  select set_config('app.current_org_id', :M66_H65_ORG, true);
  update memberships set engagement_status = 'inactive'
   where person_id = :M66_H65_CLEM and organization_id = :M66_H65_ORG;
  select assert_eq(
    (select count(*) from presby_connect_signed_in_account(:M66_H65_U3, true) where outcome = 'declined'),
    1, '66l (connect step 10, R55): an inactive person without a roll is declined (2b connected her)');
  update memberships set engagement_status = 'moved_away'
   where person_id = :M66_H65_CLEM and organization_id = :M66_H65_ORG;
  select assert_eq(
    (select count(*) from presby_connect_signed_in_account(:M66_H65_U3, true) where outcome = 'declined'),
    1, '66l (connect step 10, R55): a moved-away person without a roll is declined');
  update memberships set engagement_status = 'regular'
   where person_id = :M66_H65_CLEM and organization_id = :M66_H65_ORG;
  select assert_eq(
    (select count(*) from presby_connect_signed_in_account(:M66_H65_U3, false)
      where outcome = 'connected' and person_id = :M66_H65_CLEM
        and not session_seat and not diaconate_seat and role_keys = '{}' and permission_keys = '{}'),
    1, '66l (R49): a regular attender holding the calendar_viewer grant connects with NO factor (the grant is outside T)');
rollback;

\echo '======================================================'
\echo ' Section 66 complete.'
\echo '======================================================'
