-- ---------------------------------------------------------------------------
-- 85. Worship, Increment 1: teams, positions and the Sunday schedule
--     (drizzle/0085_presby_worship.sql; DECISION-317 to 327, F421 to F432;
--     docs/work-log/2026-11-04-worship-inc1.md Phase 3 "Data Model" and
--     "RLS and grants").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner, and its template-role count
--     moves from eight to nine (scripts/worship/test-rls.sql.integration.patch):
--
--         \ir worship/test-rls-85.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/worship/test-rls-85.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs ONLY the stock
--     scripts/seed-dev.sql fixture (Alder Creek's and Fernwood's people, the
--     Northern Reach presbytery). It does NOT read
--     scripts/worship/seed-dev-worship.sql: every team, position, service,
--     assignment, role and grant asserted below is built inside its own
--     block by pg_temp.t85_world(), and every block ends in rollback, so the
--     suite writes nothing durable.
--
--     Sections:
--       (a) structure: FORCE RLS and the one policy on all nine, the
--           composite and three-column keys, every trigger enabled, the
--           guards SECURITY INVOKER with search_path pinned and owner-only
--           EXECUTE, the helpers' EXECUTE
--       (b) catalog, bundle, template, backfill, the deleted flag
--       (c) grants: presby_app's exact column lists, no DELETE or TRUNCATE
--           for presby_app or presby_platform (by aclexplode, F38/F253),
--           presby_platform holds nothing
--       (d) isolation and a cross-organization refusal through EVERY
--           composite FK, plus R5's two three-column keys
--       (e) the guards, presby_app half: team eligibility, the assignment
--           state machine and every actor rule, cancelled / started / removed
--           serving team, the set-once and immutable columns, blockouts
--       (f) the helpers: the seat (per team, date boundary), may_schedule,
--           the toggle composition, the open count, the claim's ACL
--       (g) F434: grant and roster dates against the in-effect day,
--           greatest(organization day, UTC day) (DECISION-328)
--
--     What presby_app CANNOT reach is proven on the owner connection in
--     Vitest (src/lib/db/domain/worship.db.test.ts): every guard on the OWNER
--     path (F44), the FKs a BEFORE guard pre-empts on this connection
--     (worship_teams_group_fk and the five person FKs on assignments), the
--     delete guard and the teardown cascade, the reminder claim, a merged or
--     deceased leader, the 50-blockout cap under two concurrent connections,
--     and the backfill re-run from the migration's own text.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set FERN      '\'55555555-5555-5555-5555-555555555555\''
\set NREACH    '\'11111111-1111-1111-1111-111111111111\''

\echo '======================================================'
\echo ' Section 85 (worship, drizzle/0085) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '85: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ---------------------------------------------------------------------------
-- Session helpers (pg_temp: they vanish with the session and are never on
-- the search_path, so they cannot shadow anything).
--
-- pg_temp.t85_expect(sql, sqlstate, constraint_or_null, label): runs the
-- statement in a subtransaction and passes only if it raises exactly that
-- SQLSTATE and (when given) that CONSTRAINT name. A statement that SUCCEEDS
-- is a FAIL. The guards set CONSTRAINT to worship_guard_<code>; CHECK and FK
-- violations carry the constraint's own name.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.t85_expect(p_sql text, p_state text, p_constraint text, p_label text)
returns void language plpgsql as $$
declare
  v_state text;
  v_constraint text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
    if v_state = p_state and (p_constraint is null or v_constraint = p_constraint) then
      raise notice 'pass  % (% %)', p_label, v_state, coalesce(nullif(v_constraint, ''), '-');
      return;
    end if;
    raise exception 'FAIL % - expected % %, got % % (%)', p_label, p_state, coalesce(p_constraint, '-'),
      v_state, coalesce(nullif(v_constraint, ''), '-'), v_message;
  end;
  raise exception 'FAIL % - expected % %, but the statement succeeded', p_label, p_state, coalesce(p_constraint, '-');
end $$;

-- pg_temp.v(key): an id the world stashed with set_config('t85.<key>').
create or replace function pg_temp.v(p_key text)
returns uuid language sql stable as $$ select current_setting('t85.' || p_key)::uuid $$;

-- pg_temp.t85_world(): builds, as presby_app, inside the CALLER's
-- transaction, two organizations' worth of worship rows and stashes every id
-- (transaction-local). Alder Creek (A):
--   g1  managed `team` "T85 Band", a worship team; p1 Drums (1 slot)
--   g2  managed `choir` "T85 Choir", a worship team; p2 Soprano
--   gc  managed `committee` (NOT eligible as a team)
--   e1, e2  services 7 and 14 days out; e_past started an hour ago
--   serving: (e1,g1) (e1,g2) (e2,g1) (e_past,g1); NOT (e2,g2)
--   st  a service type
--   keyp   Isolde Marchbank: worship.schedule through a role made here
--   leader Corwin Ashgrove: `leader` on g1 only
--   member Wren Thackeray: `member` on g1 and g2; no key, no seat
--   outsider Linnea Brackwater: on no team
--   child  Hallie Vandermeer: `member` on g1 (presumed minor)
-- Fernwood (B): gb, pb, eb (served by gb), stb, ebplain (an event that is
-- not a service); b1 Ines Kirkbride (a
-- Fernwood person with no Alder Creek record).
-- Leaves app.current_org_id at Alder Creek.
create or replace function pg_temp.t85_world()
returns void language plpgsql as $$
declare
  a uuid := '22222222-2222-2222-2222-222222222222';
  b uuid := '55555555-5555-5555-5555-555555555555';
  v_team uuid := (select id from group_types where key = 'team');
  v_choir uuid := (select id from group_types where key = 'choir');
  v_committee uuid := (select id from group_types where key = 'committee');
  v_role uuid;
  r record;
  ids jsonb := '{}'::jsonb;
  x uuid;
begin
  ids := ids || jsonb_build_object(
    'a', a, 'b', b,
    'keyp',     'c0680000-0000-0000-0000-000000000001',
    'leader',   'c0680000-0000-0000-0000-000000000002',
    'outsider', 'c0680000-0000-0000-0000-000000000003',
    'member',   'c0000000-0000-0000-0000-000000000008',
    'child',    'c0000000-0000-0000-0000-000000000005',
    'b1',       'c1000000-0000-0000-0000-000000000003');

  -- Fernwood first.
  perform set_config('app.current_org_id', b::text, true);
  insert into groups (organization_id, group_type_id, name) values (b, v_team, 'T85 Fern band') returning id into x;
  ids := ids || jsonb_build_object('gb', x);
  insert into worship_teams (group_id, organization_id) values (x, b);
  insert into worship_positions (organization_id, group_id, name) values (b, x, 'Bass') returning id into x;
  ids := ids || jsonb_build_object('pb', x);
  insert into events (organization_id, title, starts_at)
  values (b, 'T85 Fern service', presby_worship_org_now(b) + interval '7 days') returning id into x;
  ids := ids || jsonb_build_object('eb', x);
  insert into worship_services (event_id, organization_id) values (x, b);
  insert into worship_service_teams (organization_id, event_id, group_id) values (b, x, (ids ->> 'gb')::uuid);
  insert into worship_service_types (organization_id, name, start_time) values (b, 'T85 Fern Sunday', '10:00')
  returning id into x;
  ids := ids || jsonb_build_object('stb', x);
  insert into events (organization_id, title, starts_at)
  values (b, 'T85 Fern plain event', presby_worship_org_now(b) + interval '8 days') returning id into x;
  ids := ids || jsonb_build_object('ebplain', x);

  -- Alder Creek.
  perform set_config('app.current_org_id', a::text, true);
  insert into groups (organization_id, group_type_id, name) values (a, v_team, 'T85 Band') returning id into x;
  ids := ids || jsonb_build_object('g1', x);
  insert into groups (organization_id, group_type_id, name) values (a, v_choir, 'T85 Choir') returning id into x;
  ids := ids || jsonb_build_object('g2', x);
  insert into groups (organization_id, group_type_id, name) values (a, v_committee, 'T85 Committee') returning id into x;
  ids := ids || jsonb_build_object('gc', x);
  insert into worship_teams (group_id, organization_id) values ((ids ->> 'g1')::uuid, a), ((ids ->> 'g2')::uuid, a);
  insert into worship_positions (organization_id, group_id, name) values (a, (ids ->> 'g1')::uuid, 'Drums')
  returning id into x;
  ids := ids || jsonb_build_object('p1', x);
  insert into worship_positions (organization_id, group_id, name, slots) values (a, (ids ->> 'g2')::uuid, 'Soprano', 4)
  returning id into x;
  ids := ids || jsonb_build_object('p2', x);

  for r in select * from (values ('e1', interval '7 days'), ('e2', interval '14 days'), ('e_past', interval '-1 hour')) v(k, d) loop
    insert into events (organization_id, title, starts_at)
    values (a, 'T85 ' || r.k, presby_worship_org_now(a) + r.d) returning id into x;
    ids := ids || jsonb_build_object(r.k, x);
    insert into worship_services (event_id, organization_id) values (x, a);
  end loop;
  insert into worship_service_teams (organization_id, event_id, group_id) values
    (a, (ids ->> 'e1')::uuid, (ids ->> 'g1')::uuid),
    (a, (ids ->> 'e1')::uuid, (ids ->> 'g2')::uuid),
    (a, (ids ->> 'e2')::uuid, (ids ->> 'g1')::uuid),
    (a, (ids ->> 'e_past')::uuid, (ids ->> 'g1')::uuid);
  insert into worship_service_types (organization_id, name, start_time) values (a, 'T85 Sunday', '09:00')
  returning id into x;
  ids := ids || jsonb_build_object('st', x);

  insert into app_roles (organization_id, key, name, role_kind) values (a, 't85_scheduler', 'T85 Scheduler', 'custom')
  returning id into v_role;
  insert into app_role_permissions (role_id, permission_key) values (v_role, 'worship.schedule');
  insert into role_grants (organization_id, role_id, person_id, starts_on)
  values (a, v_role, (ids ->> 'keyp')::uuid, '2020-01-01');

  insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on) values
    (a, (ids ->> 'g1')::uuid, (ids ->> 'leader')::uuid, 'leader', '2020-01-01'),
    (a, (ids ->> 'g1')::uuid, (ids ->> 'member')::uuid, 'member', '2020-01-01'),
    (a, (ids ->> 'g2')::uuid, (ids ->> 'member')::uuid, 'member', '2020-01-01'),
    (a, (ids ->> 'g1')::uuid, (ids ->> 'child')::uuid,  'member', '2020-01-01');

  for r in select key, value from jsonb_each_text(ids) loop
    perform set_config('t85.' || r.key, r.value, true);
  end loop;
end $$;

-- pg_temp.t85_draft(person, event, group, position, placer): a draft, its id.
create or replace function pg_temp.t85_draft(p_person uuid, p_event uuid, p_group uuid, p_position uuid, p_by uuid)
returns uuid language plpgsql as $$
declare x uuid;
begin
  insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
  values (current_setting('app.current_org_id')::uuid, p_event, p_group, p_position, p_person, p_by)
  returning id into x;
  return x;
end $$;

-- ===========================================================================
-- (a) Structure
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname in ('worship_teams', 'worship_positions', 'worship_position_qualifications',
                          'worship_service_types', 'worship_service_type_teams', 'worship_services',
                          'worship_service_teams', 'worship_assignments', 'worship_blockouts')
        and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
    9, '85a: all nine worship tables have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename like 'worship\_%' and policyname = 'tenant_isolation' and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    9, '85a: each carries tenant_isolation with BOTH using and with check on presby_current_org()');
  select assert_eq(
    (select count(*) from pg_policies where tablename like 'worship\_%'),
    9, '85a: and no other policy');
  -- Composite targets, by column list (F2, R5).
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'u'
        and (c.conname, (select string_agg(a.attname::text, ',' order by k.ord)
                           from unnest(c.conkey) with ordinality k(attnum, ord)
                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum))
            in (('worship_teams_group_org_key', 'group_id,organization_id'),
                ('worship_positions_id_org_key', 'id,organization_id'),
                ('worship_positions_id_team_org_key', 'id,group_id,organization_id'),
                ('worship_position_qualifications_id_org_key', 'id,organization_id'),
                ('worship_service_types_id_org_key', 'id,organization_id'),
                ('worship_services_event_org_key', 'event_id,organization_id'),
                ('worship_service_teams_event_team_org_key', 'event_id,group_id,organization_id'),
                ('worship_assignments_id_org_key', 'id,organization_id'),
                ('worship_blockouts_id_org_key', 'id,organization_id'))),
    9, '85a: the nine composite unique targets exist with exactly these columns (two are R5''s three-column keys)');
  -- Every FK between worship tables and to events, groups, memberships is
  -- composite on organization_id, NO ACTION on delete.
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid::regclass::text like 'worship\_%'
        and c.confrelid::regclass::text not in ('organizations', 'users')
        and c.confdeltype = 'a'
        and (select a.attname from pg_attribute a
              where a.attrelid = c.conrelid and a.attnum = c.conkey[array_length(c.conkey, 1)]) = 'organization_id'),
    18, '85a: 18 tenant FKs, each composite ending in organization_id and NO ACTION on delete (never cascade, never set null)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid::regclass::text like 'worship\_%'
        and c.confrelid::regclass::text not in ('organizations', 'users')),
    18, '85a: and there is no other tenant FK (none single-column)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid::regclass::text like 'worship\_%'
        and c.confrelid = 'organizations'::regclass and c.confdeltype = 'c'),
    9, '85a: organization_id references organizations on delete cascade on all nine (reachable only through D10''s guarded teardown)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conname in ('worship_services_event_fk', 'worship_teams_group_fk')
        and c.confrelid in ('events'::regclass, 'groups'::regclass) and c.confdeltype = 'a'),
    2, '85a: the FKs to events and groups are NO ACTION (R2, R5; the events_event_type_fk precedent)');
  -- Triggers.
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid::regclass::text like 'worship\_%' and not t.tgisinternal and t.tgenabled = 'O'),
    26, '85a: the 26 worship triggers exist and are ENABLED (origin) - they bind the owner too (F44)');
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid::regclass::text like 'worship\_%' and not t.tgisinternal and t.tgenabled = 'O'
        and t.tgname like '%\_guard\_delete'
        and t.tgfoid = 'presby_worship_guard_delete()'::regprocedure),
    9, '85a: a BEFORE DELETE guard on every one of the nine');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_worship_guard_immutable', 'presby_worship_guard_delete',
                          'presby_worship_touch_updated_at', 'presby_worship_teams_guard_insert',
                          'presby_worship_positions_guard_insert', 'presby_worship_service_teams_guard_add',
                          'presby_worship_blockouts_guard_insert', 'presby_worship_assignments_guard_insert',
                          'presby_worship_assignments_guard_update',
                          'presby_worship_enabled', 'presby_worship_leads_team', 'presby_worship_may_schedule')
        and not p.prosecdef
        and p.proconfig = array['search_path=public, pg_temp']),
    12, '85a: the nine trigger functions and the three tenant helpers are SECURITY INVOKER with search_path pinned');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_worship_org_today', 'presby_worship_org_now', 'presby_worship_in_effect_day',
                          'presby_worship_open_count', 'presby_worship_claim_reminders')
        and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']),
    5, '85a: the five definers (today, now, the in-effect day, open count, the claim) pin search_path');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_worship_guard_immutable', 'presby_worship_guard_delete',
                          'presby_worship_touch_updated_at', 'presby_worship_teams_guard_insert',
                          'presby_worship_positions_guard_insert', 'presby_worship_service_teams_guard_add',
                          'presby_worship_blockouts_guard_insert', 'presby_worship_assignments_guard_insert',
                          'presby_worship_assignments_guard_update', 'presby_worship_claim_reminders')
        and p.proacl = array[(pg_get_userbyid(p.proowner) || '=X/' || pg_get_userbyid(p.proowner))::aclitem]),
    10, '85a: the trigger functions and the reminder claim are executable by their owner alone');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_worship_org_today', 'presby_worship_org_now', 'presby_worship_in_effect_day',
                          'presby_worship_enabled', 'presby_worship_leads_team', 'presby_worship_may_schedule',
                          'presby_worship_open_count')
        and has_function_privilege('presby_app', p.oid, 'execute')
        and not has_function_privilege('presby_platform', p.oid, 'execute')
        and not exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)),
    7, '85a: the seven tenant-path helpers: EXECUTE presby_app, not presby_platform, not PUBLIC');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname like 'presby\_worship\_%' and p.pronargdefaults > 0
        and not (p.proname = 'presby_worship_in_effect_day' and p.pronargs = 2 and p.pronargdefaults = 1)),
    0, '85a: no worship function has a defaulted parameter but the in-effect day''s p_now');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname = 'presby_worship_in_effect_day' and p.pronargs = 2 and p.pronargdefaults = 1
        and p.proargtypes = '2950 1184'::oidvector),
    1, '85a: presby_worship_in_effect_day(uuid, timestamptz) exists once, its trailing p_now the one default (a test seam, F434)');
rollback;

-- ===========================================================================
-- (b) Catalog, bundle, template, backfill, flag (F421, DECISION-319)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from permissions
      where (key, module, sensitivity_tier, requires_two_factor) in
            (('worship.manage', 'worship', 1, false), ('worship.plan', 'worship', 1, false),
             ('worship.schedule', 'worship', 1, false))),
    3, '85b: worship.manage, worship.plan and worship.schedule are tier 1, module worship, no 2FA');
  select assert_eq(
    (select count(*) from permissions where key like 'worship.%'),
    3, '85b: and there is no other worship key (view, library, bulletin arrive with their increments, R8)');
  select assert_eq(
    (select count(*) from app_roles
      where organization_id is null and key = 'worship_leader' and name = 'Worship Leader'
        and organization_type_scope is null and role_kind = 'custom' and not is_protected
        and deactivated_at is null),
    1, '85b: exactly one worship_leader template: custom, unprotected, universal scope');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and r.key = 'worship_leader'
        and rp.permission_key in ('worship.manage', 'worship.plan', 'worship.schedule')),
    3, '85b: it carries the three worship keys');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and r.key = 'worship_leader'),
    3, '85b: and nothing else');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and r.key <> 'worship_leader' and rp.permission_key like 'worship.%'),
    0, '85b: no OTHER template (clerks, treasurer, committee chair...) carries a worship key');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where rp.permission_key like 'worship.%'
        and (r.is_protected or r.role_kind = 'constitutional')),
    0, '85b: no protected or constitutional role carries a worship key (visible rows)');
  -- The SQL authority. presby_app cannot EXECUTE it (owner only, 0059), but
  -- pg_proc is world-readable.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_founding_administrator_permission_keys(text)'::regprocedure
        and p.prosrc like '%''domains.manage'', ''careers.manage'', ''careers.applicants''%'
        and p.prosrc like '%when p_org_type in (''congregation'', ''new_worshiping_community'')%then array[''worship.manage'', ''worship.plan'', ''worship.schedule'']%'
        and p.prosrc like '%worship.schedule%congregation_oversight.manage%'
        and p.prosecdef and p.provolatile = 'i'
        and p.proconfig = array['search_path=public, pg_temp']),
    1, '85b: the founding bundle adds the three worship keys for congregation and new_worshiping_community only, base then worship then oversight, still immutable SECURITY DEFINER');
  select assert_eq(
    (select count(*) where has_function_privilege('presby_app', 'presby_founding_administrator_permission_keys(text)', 'execute')),
    0, '85b: and presby_app still cannot execute it (the re-create re-applied the revoke)');
  -- The backfill. Run with no org context, so presby_app sees no org-owned
  -- role and this is vacuous here; the owner-path db test re-runs section 3
  -- of the migration against a fixture founding_administrator role.
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from app_roles r
      where r.key = 'founding_administrator' and r.organization_id = :ALDER
        and (select count(*) from app_role_permissions rp
              where rp.role_id = r.id and rp.permission_key like 'worship.%') <> 3),
    0, '85b: Alder Creek''s founding_administrator role, if it has one, holds all three keys (backfill)');
  select assert_eq(
    (select count(*) from feature_flags where key = 'org_portal.worship'),
    0, '85b: the global feature_flags row org_portal.worship is gone (the per-org toggle is the only switch)');
rollback;

-- ===========================================================================
-- (c) Grants (F38: read from the ACL, not from the migration text)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'worship\_%' and c.relkind = 'r'
        and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
        and a.privilege_type in ('DELETE', 'TRUNCATE')),
    0, '85c: neither presby_app nor presby_platform holds DELETE or TRUNCATE on any worship table');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'worship\_%' and c.relkind = 'r' and a.grantee = 'presby_platform'::regrole),
    0, '85c: presby_platform holds no table privilege on any worship table (Two Hierarchies)');
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname like 'worship\_%' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a, lateral aclexplode(a.attacl) x
                     where a.attrelid = c.oid and x.grantee = 'presby_platform'::regrole)),
    0, '85c: and no column privilege either');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'worship\_%' and c.relkind = 'r'
        and a.grantee = 'presby_app'::regrole),
    9, '85c: presby_app holds exactly ONE table-level privilege per worship table');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'worship\_%' and c.relkind = 'r'
        and a.grantee = 'presby_app'::regrole and a.privilege_type = 'SELECT'),
    9, '85c: and it is SELECT');
  -- Column-level INSERT and UPDATE, exact, per table.
  create temp table t85_cols on commit drop as
  select c.relname::text as tbl, x.privilege_type as priv,
         string_agg(a.attname::text, ',' order by a.attname) as cols
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
   where c.relname like 'worship\_%' and c.relkind = 'r' and x.grantee = 'presby_app'::regrole
   group by 1, 2;
  select assert_eq(
    (select count(*) from t85_cols where (tbl, priv, cols) in (
      ('worship_teams', 'INSERT', 'created_by,group_id,organization_id'),
      ('worship_teams', 'UPDATE', 'retired_at'),
      ('worship_positions', 'INSERT', 'created_by,group_id,name,organization_id,slots,sort_order'),
      ('worship_positions', 'UPDATE', 'name,retired_at,slots,sort_order'),
      ('worship_position_qualifications', 'INSERT', 'created_by,group_id,organization_id,person_id,position_id'),
      ('worship_position_qualifications', 'UPDATE', 'ended_at'),
      ('worship_service_types', 'INSERT', 'created_by,duration_minutes,location,name,organization_id,start_time'),
      ('worship_service_types', 'UPDATE', 'duration_minutes,location,name,retired_at,start_time'),
      ('worship_service_type_teams', 'INSERT', 'group_id,organization_id,service_type_id'),
      ('worship_service_type_teams', 'UPDATE', 'removed_at'),
      ('worship_services', 'INSERT', 'event_id,organization_id,service_type_id,updated_by'),
      ('worship_services', 'UPDATE', 'updated_by'),
      ('worship_service_teams', 'INSERT', 'event_id,group_id,organization_id'),
      ('worship_service_teams', 'UPDATE', 'removed_at'),
      ('worship_assignments', 'INSERT', 'assigned_by_person_id,decline_reason,event_id,group_id,guest_name,organization_id,person_id,position_id,responded_by_person_id,response_source,status'),
      ('worship_assignments', 'UPDATE', 'decline_reason,notice_outcome,responded_by_person_id,response_source,sent_by_person_id,status,withdrawn_by_person_id,withdrawn_reason'),
      ('worship_blockouts', 'INSERT', 'ends_on,organization_id,person_id,reason,starts_on'),
      ('worship_blockouts', 'UPDATE', 'ended_at'))),
    18, '85c: presby_app''s column-limited INSERT and UPDATE lists are exactly the design''s 18 (the trigger-owned stamps in none)');
  select assert_eq(
    (select count(*) from t85_cols where priv not in ('INSERT', 'UPDATE')),
    0, '85c: and no other column-level privilege (REFERENCES, SELECT-by-column)');
  select assert_eq(
    (select count(*) from t85_cols
      where cols ~ '(^|,)(requested_at|responded_at|withdrawn_at|unanswered_reminded_at|reminded_at|updated_at|created_at|id)(,|$)'),
    0, '85c: no grant names a trigger-owned stamp, created_at, updated_at or an id');
rollback;

-- ===========================================================================
-- (d) Isolation and a cross-organization refusal through every composite FK
-- ===========================================================================
begin;
  select pg_temp.t85_world();
  -- Precondition: the people this suite treats as having no worship authority
  -- really have none (a stray founding role on some database would void the
  -- per-team assertions below).
  select assert_eq(
    (select count(*) from (values (pg_temp.v('leader')), (pg_temp.v('member')), (pg_temp.v('outsider')),
                                  (pg_temp.v('child'))) p(id)
      where presby_has_permission(p.id, :ALDER, 'worship.schedule', current_date)),
    0, '85d: precondition - leader, member, outsider and child hold no worship.schedule key at Alder Creek');

  -- Tenant isolation: from Fernwood, Alder Creek's rows are invisible and
  -- cannot be written.
  select set_config('app.current_org_id', :FERN, true);
  select assert_eq(
    (select count(*) from worship_teams where organization_id = :ALDER)
    + (select count(*) from worship_positions where organization_id = :ALDER)
    + (select count(*) from worship_services where organization_id = :ALDER)
    + (select count(*) from worship_service_teams where organization_id = :ALDER),
    0, '85d: from Fernwood, none of Alder Creek''s worship rows is visible');
  select pg_temp.t85_expect(
    format('insert into worship_service_types (organization_id, name, start_time) values (%L, %L, %L)',
           pg_temp.v('a'), 'T85 smuggled', '09:00'),
    '42501', null, '85d: from Fernwood, an insert stamped with Alder Creek''s id is refused by RLS WITH CHECK');
  select assert_eq(
    (select count(*) from worship_teams where organization_id = :FERN),
    1, '85d: Fernwood sees its own team');

  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from worship_teams where organization_id = :FERN)
    + (select count(*) from worship_positions where organization_id = :FERN),
    0, '85d: from Alder Creek, none of Fernwood''s rows is visible');

  -- Every composite FK, from Alder Creek, pointed at a Fernwood row. Where a
  -- BEFORE guard reads the referenced row first, the guard refuses before the
  -- FK is reached on this connection; the FK itself is then proven on the
  -- owner path with the guard disabled (worship.db.test.ts).
  select pg_temp.t85_expect(
    format('insert into worship_teams (group_id, organization_id) values (%L, %L)', pg_temp.v('gb'), pg_temp.v('a')),
    '23514', 'worship_guard_team_not_eligible',
    '85d: worship_teams_group_fk - a team on Fernwood''s group is refused (the insert guard reads the group in this org first)');
  select pg_temp.t85_expect(
    format('insert into worship_positions (organization_id, group_id, name) values (%L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('gb'), 'X'),
    '23503', 'worship_positions_team_fk', '85d: worship_positions_team_fk refuses Fernwood''s team');
  select pg_temp.t85_expect(
    format('insert into worship_position_qualifications (organization_id, group_id, position_id, person_id) values (%L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('gb'), pg_temp.v('pb'), pg_temp.v('member')),
    '23503', 'worship_position_qualifications_position_fk', '85d: worship_position_qualifications_position_fk refuses Fernwood''s position');
  select pg_temp.t85_expect(
    format('insert into worship_position_qualifications (organization_id, group_id, position_id, person_id) values (%L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('b1')),
    '23503', 'worship_position_qualifications_person_fk', '85d: worship_position_qualifications_person_fk refuses a person with no Alder Creek record');
  select pg_temp.t85_expect(
    format('insert into worship_service_type_teams (organization_id, service_type_id, group_id) values (%L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('stb'), pg_temp.v('g1')),
    '23503', 'worship_service_type_teams_type_fk', '85d: worship_service_type_teams_type_fk refuses Fernwood''s service type');
  select pg_temp.t85_expect(
    format('insert into worship_service_type_teams (organization_id, service_type_id, group_id) values (%L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('st'), pg_temp.v('gb')),
    '23503', 'worship_service_type_teams_team_fk', '85d: worship_service_type_teams_team_fk refuses Fernwood''s team');
  select pg_temp.t85_expect(
    format('insert into worship_services (event_id, organization_id) values (%L, %L)', pg_temp.v('ebplain'), pg_temp.v('a')),
    '23503', 'worship_services_event_fk', '85d: worship_services_event_fk refuses Fernwood''s event');
  select pg_temp.t85_expect(
    format($q$with e as (insert into events (organization_id, title, starts_at) values (%L, 'T85 typed', now()::timestamp + interval '30 days') returning id)
              insert into worship_services (event_id, organization_id, service_type_id) select e.id, %L, %L from e$q$,
           pg_temp.v('a'), pg_temp.v('a'), pg_temp.v('stb')),
    '23503', 'worship_services_type_fk', '85d: worship_services_type_fk refuses Fernwood''s service type');
  select pg_temp.t85_expect(
    format('insert into worship_service_teams (organization_id, event_id, group_id) values (%L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('eb'), pg_temp.v('g1')),
    '23503', 'worship_service_teams_service_fk', '85d: worship_service_teams_service_fk refuses Fernwood''s service');
  select pg_temp.t85_expect(
    format('insert into worship_service_teams (organization_id, event_id, group_id) values (%L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('gb')),
    '23503', 'worship_service_teams_team_fk', '85d: worship_service_teams_team_fk refuses Fernwood''s team');
  select pg_temp.t85_expect(
    format('insert into worship_blockouts (organization_id, person_id, starts_on, ends_on) values (%L, %L, current_date + 1, current_date + 2)',
           pg_temp.v('a'), pg_temp.v('b1')),
    '23503', 'worship_blockouts_person_fk', '85d: worship_blockouts_person_fk refuses a person with no Alder Creek record');
  -- Assignments.
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('eb'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23503', 'worship_assignments_service_team_fk', '85d: worship_assignments_service_team_fk refuses Fernwood''s service');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('pb'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23503', 'worship_assignments_position_fk', '85d: worship_assignments_position_fk refuses Fernwood''s position');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('b1'), pg_temp.v('keyp')),
    '23514', 'worship_guard_not_on_roster',
    '85d: worship_assignments_person_fk - a Fernwood person is refused (the roster check runs first on this connection)');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('b1')),
    '23514', 'worship_guard_not_authorized',
    '85d: worship_assignments_assigned_by_fk - a Fernwood placer is refused (the actor check runs first)');
  -- R5's two three-column keys, inside ONE organization.
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p2'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23503', 'worship_assignments_position_fk', '85d: R5 - a position from ANOTHER team of the same organization is refused');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g2'), pg_temp.v('p2'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23503', 'worship_assignments_service_team_fk', '85d: R5 - a team that is not serving this service is refused');
  select pg_temp.t85_expect(
    format('insert into worship_position_qualifications (organization_id, group_id, position_id, person_id) values (%L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('g1'), pg_temp.v('p2'), pg_temp.v('member')),
    '23503', 'worship_position_qualifications_position_fk', '85d: R5 - a qualification for another team''s position is refused');
  -- The update-side actor columns (sent_by, responded_by, withdrawn_by): a
  -- Fernwood actor is refused by the actor check on this connection.
  select set_config('t85.d1', pg_temp.t85_draft(pg_temp.v('member'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('keyp'))::text, true);
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, sent_by_person_id = %L, notice_outcome = %L where id = %L',
           'requested', pg_temp.v('b1'), 'emailed', pg_temp.v('d1')),
    '23514', 'worship_guard_not_authorized', '85d: worship_assignments_sent_by_fk - a Fernwood sender is refused (actor check)');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, responded_by_person_id = %L, response_source = %L where id = %L',
           'confirmed', pg_temp.v('b1'), 'on_behalf', pg_temp.v('d1')),
    '23514', 'worship_guard_not_authorized', '85d: worship_assignments_responded_by_fk - a Fernwood recorder is refused (actor check)');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, withdrawn_by_person_id = %L, withdrawn_reason = %L where id = %L',
           'withdrawn', pg_temp.v('b1'), 'removed', pg_temp.v('d1')),
    '23514', 'worship_guard_not_authorized', '85d: worship_assignments_withdrawn_by_fk - a Fernwood remover is refused (actor check)');
rollback;

-- ===========================================================================
-- (e) The guards, presby_app half
-- ===========================================================================
begin;
  select pg_temp.t85_world();

  -- Team eligibility (R5): managed choir or team only.
  select pg_temp.t85_expect(
    format('insert into worship_teams (group_id, organization_id) values (%L, %L)', pg_temp.v('gc'), pg_temp.v('a')),
    '23514', 'worship_guard_team_not_eligible', '85e: a committee group cannot be a worship team');
  select pg_temp.t85_expect(
    format('insert into worship_teams (group_id, organization_id) values (%L, %L)',
           (select id from groups where organization_id = :ALDER and derived_from = 'active_membership'), pg_temp.v('a')),
    '23514', 'worship_guard_team_not_eligible', '85e: a derived group (Active Membership) cannot be a worship team');
  select pg_temp.t85_expect(
    format('insert into worship_teams (group_id, organization_id) values (%L, %L)', pg_temp.v('g1'), pg_temp.v('a')),
    '23505', null, '85e: a group is a worship team at most once (primary key)');

  -- Positions: name shape, slots, live-name uniqueness.
  select pg_temp.t85_expect(
    format('insert into worship_positions (organization_id, group_id, name) values (%L, %L, %L)', pg_temp.v('a'), pg_temp.v('g1'), ' Drums'),
    '23514', 'worship_positions_name_shape', '85e: a position name must be trimmed');
  select pg_temp.t85_expect(
    format('insert into worship_positions (organization_id, group_id, name, slots) values (%L, %L, %L, 21)', pg_temp.v('a'), pg_temp.v('g1'), 'Keys'),
    '23514', 'worship_positions_slots_range', '85e: slots are 1 to 20');
  select pg_temp.t85_expect(
    format('insert into worship_positions (organization_id, group_id, name) values (%L, %L, %L)', pg_temp.v('a'), pg_temp.v('g1'), 'DRUMS'),
    '23505', 'worship_positions_live_name_idx', '85e: a live position name is unique per team, case-insensitively');

  -- The assignment insert guard: who may place.
  select assert_eq(
    (select count(*) from (select pg_temp.t85_draft(pg_temp.v('member'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('keyp'))) x),
    1, '85e: a worship.schedule holder places a person as a draft');
  select assert_eq(
    (select count(*) from worship_assignments
      where person_id = pg_temp.v('member') and event_id = pg_temp.v('e1') and status = 'draft'
        and requested_at is null and responded_at is null and withdrawn_at is null),
    1, '85e: born draft with every trigger-owned stamp null');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23505', 'worship_assignments_live_person_idx', '85e: one live row per person per position per service');
  select assert_eq(
    (select count(*) from (select pg_temp.t85_draft(pg_temp.v('child'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('leader'))) x),
    1, '85e: the leader of g1 (the seat, no key) places on g1');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g2'), pg_temp.v('p2'), pg_temp.v('member'), pg_temp.v('leader')),
    '23514', 'worship_guard_not_authorized', '85e: the leader of g1 has NO reach into g2 (per team, R7)');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('child'), pg_temp.v('member')),
    '23514', 'worship_guard_not_authorized', '85e: a plain team member cannot place anyone');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('outsider'), pg_temp.v('keyp')),
    '23514', 'worship_guard_not_on_roster', '85e: a person not on the team now cannot be placed');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id, status) values (%L, %L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp'), 'requested'),
    '23514', 'worship_guard_illegal_transition', '85e: a person''s assignment cannot be born requested');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e_past'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23514', 'worship_guard_service_started', '85e: nobody is placed on a service that has started');

  -- Guests (Q11): born confirmed on the placer's behalf; name only.
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), 'Visiting Drummer', pg_temp.v('keyp')),
    '23514', 'worship_guard_guest_shape', '85e: a guest cannot be born a draft');
  insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id,
                                   status, response_source, responded_by_person_id)
  values (:ALDER, pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), 'Visiting Drummer', pg_temp.v('keyp'),
          'confirmed', 'on_behalf', pg_temp.v('keyp'));
  select assert_eq(
    (select count(*) from worship_assignments
      where guest_name = 'Visiting Drummer' and status = 'confirmed' and responded_at is not null),
    1, '85e: a guest is born confirmed, recorded on the placer''s behalf, responded_at stamped');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id, status, response_source, responded_by_person_id) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), E'Two\nLines', pg_temp.v('keyp'), 'confirmed', 'on_behalf', pg_temp.v('keyp')),
    '23514', 'worship_assignments_guest_name_shape', '85e: a guest name with a line break is refused');

  -- SEND: draft -> requested.
  select set_config('t85.s1', (select id::text from worship_assignments where person_id = pg_temp.v('member') and event_id = pg_temp.v('e1')), true);
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, sent_by_person_id = %L where id = %L', 'requested', pg_temp.v('keyp'), pg_temp.v('s1')),
    '23514', 'worship_guard_illegal_transition', '85e: a send without a notice outcome is refused');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, sent_by_person_id = %L, notice_outcome = %L where id = %L',
           'requested', pg_temp.v('member'), 'emailed', pg_temp.v('s1')),
    '23514', 'worship_guard_not_authorized', '85e: a plain member cannot send');
  update worship_assignments set status = 'requested', sent_by_person_id = pg_temp.v('keyp'), notice_outcome = 'emailed'
   where id = pg_temp.v('s1');
  select assert_eq(
    (select count(*) from worship_assignments where id = pg_temp.v('s1') and status = 'requested' and requested_at is not null),
    1, '85e: a scheduler sends; requested_at is stamped by the trigger');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L where id = %L', 'draft', pg_temp.v('s1')),
    '23514', 'worship_guard_illegal_transition', '85e: requested -> draft is refused (nothing returns to draft)');

  -- RESPOND.
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, response_source = %L, responded_by_person_id = %L where id = %L',
           'confirmed', 'self', pg_temp.v('keyp'), pg_temp.v('s1')),
    '23514', 'worship_guard_not_authorized', '85e: a self answer must come from the person asked');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, response_source = %L, responded_by_person_id = %L where id = %L',
           'confirmed', 'link', pg_temp.v('member'), pg_temp.v('s1')),
    '23514', 'worship_guard_link_not_accepted', '85e: response_source link is refused until Increment 1b');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, response_source = %L, responded_by_person_id = %L where id = %L',
           'confirmed', 'on_behalf', pg_temp.v('member'), pg_temp.v('s1')),
    '23514', 'worship_guard_not_authorized', '85e: an on-behalf answer must come from someone who may schedule the team');
  update worship_assignments set status = 'declined', response_source = 'self', responded_by_person_id = pg_temp.v('member'),
                                 decline_reason = 'away'
   where id = pg_temp.v('s1');
  select assert_eq(
    (select count(*) from worship_assignments where id = pg_temp.v('s1') and status = 'declined'
        and decline_reason = 'away' and responded_at is not null and response_source = 'self'),
    1, '85e: the person asked declines with a closed reason; responded_at stamped');
  select pg_temp.t85_expect(
    format('update worship_assignments set decline_reason = %L where id = %L', 'sick', pg_temp.v('s1')),
    '23514', 'worship_assignments_decline_reason_allowed', '85e: the decline reason is a closed choice (R12)');
  update worship_assignments set status = 'confirmed', response_source = 'on_behalf', responded_by_person_id = pg_temp.v('leader')
   where id = pg_temp.v('s1');
  select assert_eq(
    (select count(*) from worship_assignments where id = pg_temp.v('s1') and status = 'confirmed'
        and decline_reason is null and response_source = 'on_behalf' and responded_by_person_id = pg_temp.v('leader')),
    1, '85e: the leader records "I can serve after all" on their behalf; the decline reason is cleared');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, response_source = %L, responded_by_person_id = %L where id = %L',
           'confirmed', 'on_behalf', pg_temp.v('leader'),
           (select id from worship_assignments where guest_name = 'Visiting Drummer')),
    '23514', 'worship_guard_guest_shape', '85e: a guest has no answer to record');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, sent_by_person_id = %L, notice_outcome = %L where id = %L',
           'requested', pg_temp.v('keyp'), 'emailed', pg_temp.v('s1')),
    '23514', 'worship_guard_illegal_transition', '85e: confirmed -> requested is refused');

  -- Trigger-owned and immutable columns are out of reach by GRANT.
  select pg_temp.t85_expect(format('update worship_assignments set requested_at = now() where id = %L', pg_temp.v('s1')),
    '42501', null, '85e: presby_app cannot write requested_at');
  select pg_temp.t85_expect(format('update worship_assignments set reminded_at = now() where id = %L', pg_temp.v('s1')),
    '42501', null, '85e: presby_app cannot write reminded_at (the owner-only claim does)');
  select pg_temp.t85_expect(format('update worship_assignments set person_id = %L where id = %L', pg_temp.v('child'), pg_temp.v('s1')),
    '42501', null, '85e: presby_app cannot re-point an assignment');
  select pg_temp.t85_expect(format('delete from worship_assignments where id = %L', pg_temp.v('s1')),
    '42501', null, '85e: presby_app cannot DELETE an assignment');

  -- WITHDRAW.
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, withdrawn_reason = %L where id = %L', 'withdrawn', 'service_cancelled', pg_temp.v('s1')),
    '23514', 'worship_guard_illegal_transition', '85e: service_cancelled is refused while the service is not cancelled');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, withdrawn_reason = %L, withdrawn_by_person_id = %L where id = %L',
           'withdrawn', 'removed', pg_temp.v('member'), pg_temp.v('s1')),
    '23514', 'worship_guard_not_authorized', '85e: a plain member cannot remove anyone');
  update worship_assignments set status = 'withdrawn', withdrawn_reason = 'removed', withdrawn_by_person_id = pg_temp.v('leader')
   where id = pg_temp.v('s1');
  select assert_eq(
    (select count(*) from worship_assignments where id = pg_temp.v('s1') and status = 'withdrawn' and withdrawn_at is not null),
    1, '85e: the leader removes; withdrawn_at stamped');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, response_source = %L, responded_by_person_id = %L where id = %L',
           'confirmed', 'self', pg_temp.v('member'), pg_temp.v('s1')),
    '23514', 'worship_guard_terminal', '85e: withdrawn is terminal');
  -- A new live row for the same person and position is allowed once the old one is withdrawn.
  select assert_eq(
    (select count(*) from (select pg_temp.t85_draft(pg_temp.v('member'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('keyp'))) x),
    1, '85e: after a withdrawal the person can be placed again (the live-row index ignores withdrawn rows)');

  -- A removed serving team: no new placement; re-adding passes the guard again.
  update worship_service_teams set removed_at = now() where event_id = pg_temp.v('e2') and group_id = pg_temp.v('g1');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23514', 'worship_guard_service_team_removed', '85e: no placement for a team removed from the service');
  update worship_service_teams set removed_at = null where event_id = pg_temp.v('e2') and group_id = pg_temp.v('g1');
  select assert_eq(
    (select count(*) from worship_service_teams where event_id = pg_temp.v('e2') and group_id = pg_temp.v('g1') and removed_at is null),
    1, '85e: a removed team can be re-added (removed_at is clearable)');

  -- Cancel the service (presby_app writes events directly here; the app does it
  -- through events/mutate.ts). The cancel shape, and everything after it.
  select set_config('t85.c1', pg_temp.t85_draft(pg_temp.v('child'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('keyp'))::text, true);
  update events set cancelled_at = now() where id = pg_temp.v('e2');
  select pg_temp.t85_expect(
    format('update worship_assignments set status = %L, withdrawn_reason = %L, withdrawn_by_person_id = %L where id = %L',
           'withdrawn', 'service_cancelled', pg_temp.v('keyp'), pg_temp.v('c1')),
    '23514', 'worship_guard_illegal_transition', '85e: a service_cancelled withdrawal carries no actor');
  update worship_assignments set status = 'withdrawn', withdrawn_reason = 'service_cancelled' where id = pg_temp.v('c1');
  select assert_eq(
    (select count(*) from worship_assignments where id = pg_temp.v('c1') and status = 'withdrawn'
        and withdrawn_reason = 'service_cancelled' and withdrawn_by_person_id is null),
    1, '85e: once the event is cancelled, its open requests are withdrawn with no actor');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23514', 'worship_guard_service_cancelled', '85e: nobody is placed on a cancelled service');
  update worship_service_teams set removed_at = now() where event_id = pg_temp.v('e2') and group_id = pg_temp.v('g1');
  select pg_temp.t85_expect(
    format('update worship_service_teams set removed_at = null where event_id = %L and group_id = %L', pg_temp.v('e2'), pg_temp.v('g1')),
    '23514', 'worship_guard_service_cancelled', '85e: a team cannot be re-added to a cancelled service');

  -- Set-once and immutable columns on the other tables.
  update worship_positions set name = 'Drum kit', slots = 2, sort_order = 5 where id = pg_temp.v('p1');
  select assert_eq((select count(*) from worship_positions where id = pg_temp.v('p1') and name = 'Drum kit' and slots = 2),
    1, '85e: a position can be renamed and resized');
  update worship_positions set retired_at = now() where id = pg_temp.v('p1');
  select pg_temp.t85_expect(format('update worship_positions set retired_at = null where id = %L', pg_temp.v('p1')),
    '23514', 'worship_guard_set_once', '85e: a retired position stays retired (set once)');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('child'), pg_temp.v('keyp')),
    '23514', 'worship_guard_position_retired', '85e: nobody is placed in a retired position');
  update worship_teams set retired_at = now() where group_id = pg_temp.v('g2');
  select pg_temp.t85_expect(format('update worship_teams set retired_at = clock_timestamp() where group_id = %L', pg_temp.v('g2')),
    '23514', 'worship_guard_set_once', '85e: retired_at is set once (it cannot even be re-stamped)');
  select pg_temp.t85_expect(
    format('insert into worship_positions (organization_id, group_id, name) values (%L, %L, %L)', pg_temp.v('a'), pg_temp.v('g2'), 'Alto'),
    '23514', 'worship_guard_team_retired', '85e: no new position on a retired team');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g2'), pg_temp.v('p2'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23514', 'worship_guard_team_retired', '85e: nobody is placed on a retired team');
  select pg_temp.t85_expect(format('update worship_positions set group_id = %L where id = %L', pg_temp.v('g2'), pg_temp.v('p2')),
    '42501', null, '85e: presby_app cannot move a position to another team');
  select pg_temp.t85_expect(format('update worship_services set service_type_id = %L where event_id = %L', pg_temp.v('st'), pg_temp.v('e1')),
    '42501', null, '85e: presby_app cannot re-type a service');
  select pg_temp.t85_expect(format('delete from worship_teams where group_id = %L', pg_temp.v('g1')),
    '42501', null, '85e: presby_app cannot DELETE a team');
  select pg_temp.t85_expect(format('delete from events where id = %L', pg_temp.v('e1')),
    '23503', 'worship_services_event_fk', '85e: a hard delete of an event that is a worship service fails (NO ACTION; narrows F253)');
  -- A team group with no roster, so worship_teams_group_fk is the only FK in the way.
  insert into groups (organization_id, group_type_id, name)
  select :ALDER, gt.id, 'T85 Empty band' from group_types gt where gt.key = 'team';
  insert into worship_teams (group_id, organization_id)
  select g.id, :ALDER from groups g where g.organization_id = :ALDER and g.name = 'T85 Empty band';
  select pg_temp.t85_expect(
    format('delete from groups where id = %L', (select id from groups where organization_id = :ALDER and name = 'T85 Empty band')),
    '23503', 'worship_teams_group_fk', '85e: a hard delete of a group that is a worship team fails (NO ACTION)');

  -- Service types.
  select pg_temp.t85_expect(
    format('insert into worship_service_types (organization_id, name, start_time, duration_minutes) values (%L, %L, %L, 10)', pg_temp.v('a'), 'Short', '09:00'),
    '23514', 'worship_service_types_duration_range', '85e: a service type lasts 15 to 480 minutes');
  select pg_temp.t85_expect(
    format('insert into worship_service_types (organization_id, name, start_time) values (%L, %L, %L)', pg_temp.v('a'), 't85 sunday', '11:00'),
    '23505', 'worship_service_types_live_name_idx', '85e: a live service type name is unique, case-insensitively');

  -- Blockouts (R12, DECISION-327).
  select pg_temp.t85_expect(
    format('insert into worship_blockouts (organization_id, person_id, starts_on, ends_on) values (%L, %L, current_date - 10, current_date - 3)', pg_temp.v('a'), pg_temp.v('member')),
    '23514', 'worship_guard_blockout_past', '85e: a blockout wholly in the past is refused');
  select pg_temp.t85_expect(
    format('insert into worship_blockouts (organization_id, person_id, starts_on, ends_on) values (%L, %L, current_date + 5, current_date + 2)', pg_temp.v('a'), pg_temp.v('member')),
    '23514', 'worship_blockouts_range_order', '85e: a blockout cannot end before it starts');
  select pg_temp.t85_expect(
    format('insert into worship_blockouts (organization_id, person_id, starts_on, ends_on) values (%L, %L, current_date + 1, current_date + 367)', pg_temp.v('a'), pg_temp.v('member')),
    '23514', 'worship_blockouts_range_length', '85e: a blockout covers at most 366 days');
  select pg_temp.t85_expect(
    format('insert into worship_blockouts (organization_id, person_id, starts_on, ends_on, reason) values (%L, %L, current_date + 1, current_date + 2, %L)', pg_temp.v('a'), pg_temp.v('member'), 'medical'),
    '23514', 'worship_blockouts_reason_allowed', '85e: a blockout reason is a closed choice (no free text, R12)');
  -- Top up to exactly 50 live ranges (the dev seed may already hold some for
  -- this person), on days no seeded range uses.
  insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
  select :ALDER, pg_temp.v('member'), current_date + 400 + g, current_date + 400 + g
    from generate_series(1, 50 - (select count(*)::int from worship_blockouts
                                   where person_id = pg_temp.v('member') and ended_at is null)) g;
  select pg_temp.t85_expect(
    format('insert into worship_blockouts (organization_id, person_id, starts_on, ends_on) values (%L, %L, current_date + 300, current_date + 300)', pg_temp.v('a'), pg_temp.v('member')),
    '23514', 'worship_guard_blockout_cap', '85e: the 51st live blockout is refused');
  update worship_blockouts set ended_at = now()
   where id = (select id from worship_blockouts where person_id = pg_temp.v('member') and ended_at is null
                order by starts_on desc limit 1);
  insert into worship_blockouts (organization_id, person_id, starts_on, ends_on)
  values (:ALDER, pg_temp.v('member'), current_date + 300, current_date + 300);
  select assert_eq(
    (select count(*) from worship_blockouts where person_id = pg_temp.v('member') and ended_at is null),
    50, '85e: ending one makes room (the cap counts live ranges)');
  select pg_temp.t85_expect(
    format('update worship_blockouts set ended_at = null where person_id = %L and ended_at is not null', pg_temp.v('member')),
    '23514', 'worship_guard_set_once', '85e: an ended blockout stays ended');
rollback;

-- ===========================================================================
-- (f) The helpers
-- ===========================================================================
begin;
  select pg_temp.t85_world();
  -- The seat (R7): per team, in date, chair or leader only.
  select assert_eq(
    (select count(*) where presby_worship_leads_team(:ALDER, pg_temp.v('leader'), pg_temp.v('g1'), presby_worship_org_today(:ALDER))),
    1, '85f: the leader of g1 leads g1');
  select assert_eq(
    (select count(*) where presby_worship_leads_team(:ALDER, pg_temp.v('leader'), pg_temp.v('g2'), presby_worship_org_today(:ALDER))),
    0, '85f: and not g2');
  select assert_eq(
    (select count(*) where presby_worship_leads_team(:ALDER, pg_temp.v('member'), pg_temp.v('g1'), presby_worship_org_today(:ALDER))),
    0, '85f: a `member` row is no seat');
  select assert_eq(
    (select count(*) where presby_worship_leads_team(:ALDER, pg_temp.v('leader'), pg_temp.v('g1'), date '2019-12-31')),
    0, '85f: a seat is not held before it starts');
  update group_memberships set ends_on = presby_worship_org_today(:ALDER)
   where group_id = pg_temp.v('g1') and person_id = pg_temp.v('leader');
  select assert_eq(
    (select count(*) where presby_worship_leads_team(:ALDER, pg_temp.v('leader'), pg_temp.v('g1'), presby_worship_org_today(:ALDER))),
    0, '85f: a seat ending today is not held today (ends_on is exclusive)');
  select assert_eq(
    (select count(*) where presby_worship_leads_team(:ALDER, pg_temp.v('leader'), pg_temp.v('g1'), presby_worship_org_today(:ALDER) - 1)),
    1, '85f: and was held yesterday');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('leader')),
    '23514', 'worship_guard_not_authorized', '85f: a leader whose seat ended schedules nothing');
  insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on)
  values (:ALDER, pg_temp.v('g2'), pg_temp.v('leader'), 'chair', '2020-01-01');
  select assert_eq(
    (select count(*) where presby_worship_may_schedule(:ALDER, pg_temp.v('leader'), pg_temp.v('g2'))),
    1, '85f: a `chair` row is a seat too');
  select assert_eq(
    (select count(*) where presby_worship_may_schedule(:ALDER, pg_temp.v('keyp'), pg_temp.v('g1'))
                       and presby_worship_may_schedule(:ALDER, pg_temp.v('keyp'), pg_temp.v('g2'))),
    1, '85f: worship.schedule reaches every team (organization-wide by design, R7)');
  select assert_eq(
    (select count(*) where presby_worship_may_schedule(:ALDER, null, pg_temp.v('g1'))),
    0, '85f: a null actor may not schedule');

  -- The toggle composition (orgFeatureEnabledInTx's, in SQL). Start from a
  -- known state: scripts/worship/seed-dev-worship.sql turns Alder Creek's
  -- toggle ON for the browser walk, so clear it first (rolled back).
  delete from organization_feature_toggles where organization_id = :ALDER and feature_key = 'org_portal.worship';
  delete from organization_feature_categories where organization_id = :ALDER and category = 'worship';
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';
  select assert_eq((select count(*) where presby_worship_enabled(:ALDER)),
    0, '85f: no toggle row - Worship is off (provisioned off)');
  insert into organization_feature_toggles (organization_id, feature_key, enabled) values (:ALDER, 'org_portal.worship', true);
  select assert_eq((select count(*) where presby_worship_enabled(:ALDER)),
    1, '85f: the toggle row on - Worship is on');
  update feature_flags set enabled = true where key = 'org_portal.feature_categories';
  insert into organization_feature_categories (organization_id, category, enabled) values (:ALDER, 'worship', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq((select count(*) where presby_worship_enabled(:ALDER)),
    0, '85f: the category axis on and the worship category off - off');
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';
  select assert_eq((select count(*) where presby_worship_enabled(:ALDER)),
    1, '85f: the axis off - the category row is inert');
  select assert_eq((select count(*) where presby_worship_enabled(:FERN)),
    0, '85f: another organization''s toggle is invisible from here (reads as off)');
  select set_config('app.current_org_id', :NREACH, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled) values (:NREACH, 'org_portal.worship', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  select assert_eq((select count(*) where presby_worship_enabled(:NREACH)),
    0, '85f: a presbytery is never on, even with a stray toggle row (type allow-list)');
  select set_config('app.current_org_id', :ALDER, true);

  -- The open count: distinct people, requested or confirmed, upcoming, uncancelled.
  -- Relative to a baseline: the dev seed may hold open requests at Alder Creek.
  select presby_worship_open_count() as base \gset t85_open_
  -- A person the dev seed never schedules (the world's outsider), on both rosters.
  insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on)
  values (:ALDER, pg_temp.v('g1'), pg_temp.v('outsider'), 'member', '2020-01-01'),
         (:ALDER, pg_temp.v('g2'), pg_temp.v('outsider'), 'member', '2020-01-01');
  select set_config('t85.o1', pg_temp.t85_draft(pg_temp.v('outsider'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('keyp'))::text, true);
  select assert_eq(presby_worship_open_count(), :t85_open_base, '85f: a draft is not counted');
  update worship_assignments set status = 'requested', sent_by_person_id = pg_temp.v('keyp'), notice_outcome = 'emailed'
   where id = pg_temp.v('o1');
  select pg_temp.t85_draft(pg_temp.v('outsider'), pg_temp.v('e1'), pg_temp.v('g2'), pg_temp.v('p2'), pg_temp.v('keyp'));
  update worship_assignments set status = 'confirmed', response_source = 'on_behalf', responded_by_person_id = pg_temp.v('keyp')
   where person_id = pg_temp.v('outsider') and group_id = pg_temp.v('g2');
  insert into worship_assignments (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id,
                                   status, response_source, responded_by_person_id)
  values (:ALDER, pg_temp.v('e1'), pg_temp.v('g2'), pg_temp.v('p2'), 'Guest Singer', pg_temp.v('keyp'),
          'confirmed', 'on_behalf', pg_temp.v('keyp'));
  select assert_eq(presby_worship_open_count(), :t85_open_base + 1,
    '85f: one person with a request and a confirmation counts once; a guest is not a person here');
  select set_config('app.current_org_id', '', true);
  select assert_eq(presby_worship_open_count(), 0, '85f: no organization context - zero');
  select set_config('app.current_org_id', :ALDER, true);

  -- The claim is owner-only; the date helpers are callable.
  select pg_temp.t85_expect('select * from presby_worship_claim_reminders(10)', '42501', null,
    '85f: presby_app cannot execute the reminder claim (owner-only, DECISION-325)');
  select assert_eq(
    (select count(*) where presby_worship_org_today(:ALDER) between current_date - 1 and current_date + 1
                       and presby_worship_org_now(:ALDER) between now()::timestamp - interval '15 hours'
                                                              and now()::timestamp + interval '15 hours'),
    1, '85f: presby_app reads the organization''s today and wall-clock now');
rollback;

-- ===========================================================================
-- (g) F434: the in-effect day (DECISION-328). Grant and roster dates are
-- compared against presby_worship_in_effect_day = greatest(organization day,
-- UTC day), because the platform stamps and revokes them on the UTC day. The
-- zone is chosen at run time so Alder Creek's day differs from UTC's
-- (Etc/GMT+12 before UTC noon, else Etc/GMT-14). Before the fix this block
-- fails in the hours before UTC noon (the F434 window); after UTC noon the old
-- and new rules agree and it is a non-regression check. The always-failing
-- proofs are the p_now seam in src/lib/worship/in-effect-day.db.test.ts and
-- the source scan in boundaries.test.ts.
-- ===========================================================================
begin;
  select pg_temp.t85_world();
  select set_config('t85.tz', case when extract(hour from now() at time zone 'UTC') < 12
                                   then 'Etc/GMT+12' else 'Etc/GMT-14' end, true);
  update organization_settings set time_zone = current_setting('t85.tz') where organization_id = :ALDER;
  select assert_eq(
    (select count(*) where (now() at time zone current_setting('t85.tz'))::date <> current_date
                       and presby_worship_org_today(:ALDER) = (now() at time zone current_setting('t85.tz'))::date),
    1, '85g: precondition - Alder Creek''s day differs from the UTC day (a run straddling UTC midnight or noon: re-run)');
  select assert_eq(
    (select count(*) where presby_worship_in_effect_day(:ALDER)
                           = greatest(current_date, (now() at time zone current_setting('t85.tz'))::date)),
    1, '85g: presby_app reads the in-effect day: greatest(organization day, UTC day)');
  select assert_eq(
    (select count(*) where presby_worship_in_effect_day(:ALDER, timestamptz '2026-11-05 02:35+00') = date '2026-11-05'
                       and presby_worship_in_effect_day(:FERN,  timestamptz '2026-11-05 02:35+00') = date '2026-11-05'),
    1, '85g: at the F434 instant (21:35 New York, 02:35 UTC on the 5th) the in-effect day is the 5th');

  -- A grant stamped exactly as the definers stamp it: no starts_on, the
  -- column default (the UTC day).
  insert into role_grants (organization_id, role_id, person_id)
  values (:ALDER, (select id from app_roles where organization_id = :ALDER and key = 't85_scheduler'),
          pg_temp.v('outsider'));
  select assert_eq(
    (select count(*) from role_grants where person_id = pg_temp.v('outsider') and organization_id = :ALDER
                                        and starts_on = current_date),
    1, '85g: the default stamp is current_date (UTC)');
  select assert_eq(
    (select count(*) where presby_worship_may_schedule(:ALDER, pg_temp.v('outsider'), pg_temp.v('g1'))),
    1, '85g: a grant stamped today (UTC) schedules today, in either zone direction');
  -- Through the trigger, as presby_app (rolled back with the block).
  select pg_temp.t85_draft(pg_temp.v('member'), pg_temp.v('e1'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('outsider'));

  -- A roster row stamped today (UTC) is on the team now.
  insert into group_memberships (organization_id, group_id, person_id, group_role)
  values (:ALDER, pg_temp.v('g2'), pg_temp.v('child'), 'member');
  select assert_eq(
    (select count(*) from group_memberships where person_id = pg_temp.v('child') and group_id = pg_temp.v('g2')
                                              and starts_on = current_date),
    1, '85g: the roster row''s default stamp is current_date (UTC)');
  select pg_temp.t85_draft(pg_temp.v('child'), pg_temp.v('e1'), pg_temp.v('g2'), pg_temp.v('p2'), pg_temp.v('keyp'));

  -- The platform's revoke stamps ends_on = current_date: ended at once, never
  -- kept alive by an organization day that lags UTC.
  update role_grants set ends_on = current_date
   where person_id = pg_temp.v('keyp') and organization_id = :ALDER;
  select assert_eq(
    (select count(*) where presby_worship_may_schedule(:ALDER, pg_temp.v('keyp'), pg_temp.v('g1'))),
    0, '85g: a grant ended today (UTC) no longer schedules');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('keyp')),
    '23514', 'worship_guard_not_authorized', '85g: and the trigger refuses its placement');
  update group_memberships set ends_on = current_date
   where group_id = pg_temp.v('g1') and person_id = pg_temp.v('leader');
  select assert_eq(
    (select count(*) where presby_worship_may_schedule(:ALDER, pg_temp.v('leader'), pg_temp.v('g1'))),
    0, '85g: a seat ended today (UTC) no longer schedules');
  update group_memberships set ends_on = current_date
   where group_id = pg_temp.v('g1') and person_id = pg_temp.v('member');
  select pg_temp.t85_expect(
    format('insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('a'), pg_temp.v('e2'), pg_temp.v('g1'), pg_temp.v('p1'), pg_temp.v('member'), pg_temp.v('outsider')),
    '23514', 'worship_guard_not_on_roster', '85g: a roster row ended today (UTC) is off the team now');
rollback;

\echo '======================================================'
\echo ' Section 85 (worship) complete.'
\echo '======================================================'
