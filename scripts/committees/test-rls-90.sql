-- ---------------------------------------------------------------------------
-- 90. Presbytery committees and administrative commission records
--     (drizzle/0090_presby_committees.sql; DECISION-352 to 359; F456 to F460;
--     docs/work-log/2026-11-19-presbytery-committees.md Phase 3 "Data Model"
--     and "Seed and test files").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner
--     (scripts/committees/test-rls.sql.integration.patch):
--
--         \ir committees/test-rls-90.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/committees/test-rls-90.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs ONLY the stock
--     scripts/seed-dev.sql fixture (with its treasury include): the Northern
--     Reach with Alder Creek, Bramblewood, Quillhaven and Fernwood affiliated
--     today; the Southern Fields (Quillhaven's council until 1995); the
--     Western Basin (no member congregation); Fernwood's LIVE site; Alder
--     Creek's chargeable Property Committee chaired by Tobias Renwick; the
--     dev administrative_commissions row on the "Commission on Alder Creek"
--     group (b...0005); the clerk fixture user. It does NOT read
--     scripts/committees/seed-dev-committees.sql: every row asserted below is
--     built inside its own block, and every block ends in rollback, so the
--     suite writes nothing durable (it tolerates the committees seed).
--
--     Sections:
--       (a) structure: FORCE RLS and the one organization-only policy on all
--           three; the guard functions SECURITY INVOKER, search_path pinned,
--           owner-only EXECUTE; every trigger enabled, the about-org trigger
--           under its WHEN; the role CHECK; no role_id / group_id /
--           public_listed on the commission tables; the roster function's
--           shape; the two seat predicates still exact-match on chair/leader
--       (b) grants (aclexplode, F38): presby_app SELECT + INSERT only at table
--           level, the exact UPDATE column lists, no DELETE or TRUNCATE;
--           presby_platform nothing
--       (c) role vocabulary: all seven insert, 'boss' refused; the worship
--           and reimbursement seat predicates ignore the four new titles and
--           honour chair and leader (the architect's R1.3 pin)
--       (d) isolation: another presbytery reads none of the rows and cannot
--           write them; the congregation a commission record is about reads
--           zero rows; no org context reads zero rows
--       (e) composite keys: another organization's group, a person with no
--           membership here, another presbytery's commission record
--       (f) the committee_details guard
--       (g) commission rules: the about-org trigger and its WHEN, one-way end
--           and removal, the insert rules, the live guard, one open seat,
--           every CHECK at its limits
--       (h) presby_public_committee_roster at a congregation with a live
--           site: the predicates 0090 adds, and the pinned column list
--       (i) the permission resolver cannot see a commission-record member
--           (with a sensitivity control that adds the same person to a
--           committee roster and watches the resolver find them)
--       (j) the dev administrative_commissions row is unchanged by 0090
--
--     What presby_app CANNOT reach is proven on the owner connection in
--     Vitest (src/lib/db/domain/committees.db.test.ts): the guards on the
--     OWNER path (F44) including the immutable-column rules (on presby_app
--     the column grant refuses first) and the owner's history allowances,
--     the composite FK behind the details guard (guard disabled in a
--     rolled-back transaction), the FOR SHARE serialization under two
--     connections, the roster at a PRESBYTERY with a live site (dissolved
--     committees, a commission member absent) and the asset door for an
--     unlisted member's photo (presby_app holds no grant on
--     organization_sites, so it cannot stand up a live presbytery site), and
--     the fixture teardown order.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set NREACH    '\'11111111-1111-1111-1111-111111111111\''
\set ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set BRAMBLE   '\'33333333-3333-3333-3333-333333333333\''
\set QUILL     '\'44444444-4444-4444-4444-444444444444\''
\set FERN      '\'55555555-5555-5555-5555-555555555555\''
\set SFIELDS   '\'f6000000-0000-0000-0000-000000000001\''
\set WBASIN    '\'f7000000-0000-0000-0000-000000000001\''
\set CLERK_U   '\'e0000000-0000-0000-0000-0000000000f3\''
\set ROWAN     '\'c0000000-0000-0000-0000-000000000006\''
\set MARG      '\'c0000000-0000-0000-0000-000000000001\''
\set ACGROUP   '\'b0000000-0000-0000-0000-000000000005\''
\set ACTIVEGRP '\'b0000000-0000-0000-0000-000000000006\''

\echo '======================================================'
\echo ' Section 90 (presbytery committees, drizzle/0090) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '90: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ---------------------------------------------------------------------------
-- Session helpers (pg_temp: they vanish with the session and are never on
-- the search_path, so they cannot shadow anything).
--
-- pg_temp.t90_expect(sql, sqlstate, constraint_or_null, message_like_or_null,
-- label): runs the statement in a subtransaction and passes only if it raises
-- exactly that SQLSTATE and (when given) that CONSTRAINT name and a message
-- matching that LIKE pattern. A statement that SUCCEEDS is a FAIL.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.t90_expect(p_sql text, p_state text, p_constraint text, p_like text, p_label text)
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
    if v_state = p_state
       and (p_constraint is null or v_constraint = p_constraint)
       and (p_like is null or v_message like p_like) then
      raise notice 'pass  % (% %)', p_label, v_state, coalesce(nullif(v_constraint, ''), '-');
      return;
    end if;
    raise exception 'FAIL % - expected % % %, got % % (%)', p_label, p_state, coalesce(p_constraint, '-'),
      coalesce(p_like, '-'), v_state, coalesce(nullif(v_constraint, ''), '-'), v_message;
  end;
  raise exception 'FAIL % - expected % %, but the statement succeeded', p_label, p_state, coalesce(p_constraint, '-');
end $$;

-- pg_temp.t90_ok(sql, label): the statement must succeed (no subtransaction:
-- a pass leaves its row in the caller's transaction).
create or replace function pg_temp.t90_ok(p_sql text, p_label text)
returns void language plpgsql as $$
declare
  v_state text;
  v_message text;
begin
  execute p_sql;
  raise notice 'pass  %', p_label;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  raise exception 'FAIL % - expected success, got % (%)', p_label, v_state, v_message;
end $$;

-- pg_temp.t90_eq_text(actual, expected, label): text equality with both
-- values in the failure (the shared assert_eq takes bigint only).
create or replace function pg_temp.t90_eq_text(p_actual text, p_expected text, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL % - expected [%], got [%]', p_label, p_expected, p_actual;
  end if;
  raise notice 'pass  %', p_label;
end $$;

-- pg_temp.t90_rows(sql): how many rows a DML statement touched (via a CTE).
create or replace function pg_temp.t90_rows(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('with x as (%s returning 1) select count(*) from x', p_sql) into n;
  return n;
end $$;

-- pg_temp.v(key): an id stashed with set_config('t90.<key>').
create or replace function pg_temp.v(p_key text)
returns uuid language sql stable as $$ select current_setting('t90.' || p_key)::uuid $$;

-- pg_temp.t90_person(org, label): a new person with a regular membership at
-- `org`, as presby_app in the CALLER's org context (which must be `org`).
-- The id is chosen first: people's SELECT policy needs the membership, so
-- RETURNING on the people insert would be refused.
create or replace function pg_temp.t90_person(p_org uuid, p_label text)
returns uuid language plpgsql as $$
declare x uuid := gen_random_uuid();
begin
  insert into people (id, first_name, last_name) values (x, 'T90', p_label);
  insert into memberships (organization_id, person_id, engagement_status) values (p_org, x, 'regular');
  return x;
end $$;

-- pg_temp.t90_world(): builds, as presby_app, inside the CALLER's
-- transaction, and stashes every id (transaction-local):
--   Western Basin (wb): gw committee group, cdw its details, crw a record
--   Alder Creek (alder): ga a committee group at a CONGREGATION
--   Northern Reach (nr): gc committee "T90 Committee on Ministry" with cd
--     (required); gch a choir; cr a commission record about Alder Creek with
--     pm as its chair; cr0 a record about no congregation; pm, p1..p7 people
--     with memberships at the Northern Reach
-- Leaves app.current_org_id at the Northern Reach.
create or replace function pg_temp.t90_world()
returns void language plpgsql as $$
declare
  nr uuid := '11111111-1111-1111-1111-111111111111';
  alder uuid := '22222222-2222-2222-2222-222222222222';
  wb uuid := 'f7000000-0000-0000-0000-000000000001';
  u uuid := 'e0000000-0000-0000-0000-0000000000f3';
  v_committee uuid := (select id from group_types where key = 'committee');
  v_choir uuid := (select id from group_types where key = 'choir');
  ids jsonb := '{}'::jsonb;
  x uuid;
  i integer;
begin
  perform set_config('app.current_org_id', wb::text, true);
  insert into groups (organization_id, group_type_id, name) values (wb, v_committee, 'T90 WB Committee') returning id into x;
  ids := ids || jsonb_build_object('gw', x);
  insert into committee_details (organization_id, group_id, kind, created_by, updated_by)
  values (wb, x, 'standing', u, u) returning id into x;
  ids := ids || jsonb_build_object('cdw', x);
  insert into commission_records (organization_id, title, appointed_on, created_by, updated_by)
  values (wb, 'T90 WB commission', current_date - 10, u, u) returning id into x;
  ids := ids || jsonb_build_object('crw', x);

  perform set_config('app.current_org_id', alder::text, true);
  insert into groups (organization_id, group_type_id, name) values (alder, v_committee, 'T90 Alder Committee') returning id into x;
  ids := ids || jsonb_build_object('ga', x);

  perform set_config('app.current_org_id', nr::text, true);
  insert into groups (organization_id, group_type_id, name) values (nr, v_committee, 'T90 Committee on Ministry') returning id into x;
  ids := ids || jsonb_build_object('gc', x);
  insert into groups (organization_id, group_type_id, name) values (nr, v_choir, 'T90 Choir') returning id into x;
  ids := ids || jsonb_build_object('gch', x);
  insert into committee_details (organization_id, group_id, kind, created_by, updated_by)
  values (nr, (ids ->> 'gc')::uuid, 'required', u, u) returning id into x;
  ids := ids || jsonb_build_object('cd', x);
  ids := ids || jsonb_build_object('pm', pg_temp.t90_person(nr, 'Commissioner'));
  for i in 1..7 loop
    ids := ids || jsonb_build_object('p' || i, pg_temp.t90_person(nr, 'Person' || i));
  end loop;
  insert into commission_records (organization_id, about_org_id, title, charge, appointed_on, minute_reference, created_by, updated_by)
  values (nr, alder, 'T90 Commission on Alder Creek', 'T90 charge in general terms', current_date - 30, 'T90 minute 1', u, u)
  returning id into x;
  ids := ids || jsonb_build_object('cr', x);
  insert into commission_records (organization_id, title, appointed_on, created_by, updated_by)
  values (nr, 'T90 Commission on no congregation', current_date - 30, u, u) returning id into x;
  ids := ids || jsonb_build_object('cr0', x);
  insert into commission_record_members (organization_id, commission_record_id, person_id, role, starts_on, created_by, updated_by)
  values (nr, (ids ->> 'cr')::uuid, (ids ->> 'pm')::uuid, 'chair', current_date - 30, u, u) returning id into x;
  ids := ids || jsonb_build_object('crm', x);

  perform set_config('t90.' || k, ids ->> k, true) from jsonb_object_keys(ids) k;
end $$;

-- ===========================================================================
-- (a) Structure.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('committee_details', 'commission_records', 'commission_record_members')
        and relkind = 'r' and relrowsecurity and relforcerowsecurity),
    3, '90a: ENABLE + FORCE ROW LEVEL SECURITY on all three tables (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename in ('committee_details', 'commission_records', 'commission_record_members')),
    3, '90a: exactly one policy per table');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename in ('committee_details', 'commission_records', 'commission_record_members')
        and policyname = 'tenant_isolation' and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    3, '90a: the policy is organization-only, USING and WITH CHECK (not the visible-to-both shape of administrative_commissions)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_committee_details_guard', 'presby_commission_guard_write', 'presby_commission_live_guard')
        and not p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
        and p.proacl is not null
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)),
    3, '90a: the three guard functions are SECURITY INVOKER, search_path pinned, EXECUTE owner-only');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgenabled = 'O'
        and (t.tgrelid::regclass::text, t.tgname) in (
          ('committee_details', 'committee_details_guard'),
          ('commission_records', 'commission_records_about_org'),
          ('commission_records', 'commission_records_guard_write'),
          ('commission_record_members', 'commission_record_members_guard_write'),
          ('commission_record_members', 'commission_record_members_live_guard'))),
    5, '90a: the five triggers exist and are enabled');
  select assert_eq(
    (select count(*) from pg_trigger
      where tgname = 'commission_records_about_org' and tgrelid = 'commission_records'::regclass
        and pg_get_triggerdef(oid) like '%WHEN ((new.about_org_id IS NOT NULL))%'
        and pg_get_triggerdef(oid) like '%presby_check_about_org_affiliated(''about_org_id'', '''')%'),
    1, '90a: the about-org trigger is the 0045 function under WHEN (about_org_id is not null)');
  select assert_eq(
    (select count(*) from pg_constraint
      where conname = 'group_memberships_group_role_check' and conrelid = 'group_memberships'::regclass
        and convalidated
        and pg_get_constraintdef(oid) like '%chair%leader%member%vice_chair%clerk%secretary%ex_officio%'),
    1, '90a: group_memberships_group_role_check holds the seven values, validated');
  select assert_eq(
    (select count(*) from pg_attribute
      where attrelid in ('commission_records'::regclass, 'commission_record_members'::regclass)
        and attnum > 0 and not attisdropped
        and attname in ('role_id', 'group_id', 'public_listed')),
    0, '90a: NO role_id, group_id or public_listed column on either commission table (no grant, by construction; DECISION-355)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_committee_roster(text, text, boolean)'::regprocedure
        and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
        and pg_get_function_result(p.oid) = 'TABLE(group_name text, group_role text, display_name text, photo_key text)'
        and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'presby_app'::regrole and a.privilege_type = 'EXECUTE')
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
    1, '90a: presby_public_committee_roster keeps the 0078 signature, the four-column projection, definer, presby_app EXECUTE and no PUBLIC');
  select assert_eq(
    (select count(*) from pg_proc
      where proname in ('presby_reimbursement__is_seat', 'presby_worship_leads_team')
        and prosrc like '%gm.group_role in (''chair'', ''leader'')%'),
    2, '90a: both seat predicates still match exactly (''chair'', ''leader'') (0073, 0085 untouched; DECISION-354)');
rollback;

-- ===========================================================================
-- (b) Grants by aclexplode (F38: the live catalog, not the migration text).
-- ===========================================================================
begin;
  select pg_temp.t90_eq_text(
    (select string_agg(c.relname || ':' || a.privilege_type, ',' order by c.relname, a.privilege_type)
       from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname in ('committee_details', 'commission_records', 'commission_record_members')
        and c.relkind = 'r' and a.grantee = 'presby_app'::regrole),
    'commission_record_members:INSERT,commission_record_members:SELECT,commission_records:INSERT,commission_records:SELECT,committee_details:INSERT,committee_details:SELECT',
    '90b: presby_app holds exactly SELECT and INSERT at table level on the three (no UPDATE, DELETE or TRUNCATE)');
  select pg_temp.t90_eq_text(
    (select string_agg(att.attname, ',' order by att.attname)
       from pg_attribute att, lateral aclexplode(att.attacl) x
      where att.attrelid = 'committee_details'::regclass and x.grantee = 'presby_app'::regrole and x.privilege_type = 'UPDATE'),
    'dissolved_at,dissolved_by,dissolved_on,kind,updated_at,updated_by',
    '90b: committee_details UPDATE columns for presby_app are exactly the label, the dissolved trio and the stamps');
  select pg_temp.t90_eq_text(
    (select string_agg(att.attname, ',' order by att.attname)
       from pg_attribute att, lateral aclexplode(att.attacl) x
      where att.attrelid = 'commission_records'::regclass and x.grantee = 'presby_app'::regrole and x.privilege_type = 'UPDATE'),
    'about_org_id,appointed_on,charge,ended_at,ended_by,ended_minute_reference,ended_on,minute_reference,removed_at,removed_by,row_version,title,updated_at,updated_by',
    '90b: commission_records UPDATE columns for presby_app are exactly the designed fourteen');
  select pg_temp.t90_eq_text(
    (select string_agg(att.attname, ',' order by att.attname)
       from pg_attribute att, lateral aclexplode(att.attacl) x
      where att.attrelid = 'commission_record_members'::regclass and x.grantee = 'presby_app'::regrole and x.privilege_type = 'UPDATE'),
    'ends_on,role,starts_on,updated_at,updated_by',
    '90b: commission_record_members UPDATE columns for presby_app are exactly role, dates and stamps');
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname in ('committee_details', 'commission_records', 'commission_record_members') and c.relkind = 'r'
        and (exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'presby_platform'::regrole)
             or exists (select 1 from pg_attribute att, lateral aclexplode(att.attacl) x
                         where att.attrelid = c.oid and x.grantee = 'presby_platform'::regrole))),
    0, '90b: presby_platform holds nothing on the three, table or column');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname in ('committee_details', 'commission_records', 'commission_record_members') and c.relkind = 'r'
        and a.grantee = 0),
    0, '90b: PUBLIC holds nothing on the three');
rollback;

-- ===========================================================================
-- (c) Role vocabulary, and the seat predicates ignore the four titles.
-- ===========================================================================
begin;
  select pg_temp.t90_world();
  select pg_temp.t90_ok(
    format('insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on) values '
           '(%1$L, %2$L, %3$L, ''chair'', current_date), (%1$L, %2$L, %4$L, ''leader'', current_date), '
           '(%1$L, %2$L, %5$L, ''member'', current_date), (%1$L, %2$L, %6$L, ''vice_chair'', current_date), '
           '(%1$L, %2$L, %7$L, ''clerk'', current_date), (%1$L, %2$L, %8$L, ''secretary'', current_date), '
           '(%1$L, %2$L, %9$L, ''ex_officio'', current_date)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gc'), pg_temp.v('p1'), pg_temp.v('p2'), pg_temp.v('p3'),
           pg_temp.v('p4'), pg_temp.v('p5'), pg_temp.v('p6'), pg_temp.v('p7')),
    '90c: all seven group_role values insert');
  select pg_temp.t90_expect(
    format('insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on) values (%L, %L, %L, ''boss'', current_date)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gc'), pg_temp.v('pm')),
    '23514', 'group_memberships_group_role_check', null, '90c: a role outside the seven (''boss'') is refused by the CHECK');
  select pg_temp.t90_expect(
    format('update group_memberships set group_role = ''president'' where group_id = %L and person_id = %L',
           pg_temp.v('gc'), pg_temp.v('p3')),
    '23514', 'group_memberships_group_role_check', null, '90c: an update to a role outside the seven is refused too');
rollback;

-- Worship: presby_worship_leads_team (0085) at Alder Creek, on a team.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    alder uuid := '22222222-2222-2222-2222-222222222222';
    v_team uuid := (select id from group_types where key = 'team');
    g uuid;
    r record;
    x uuid;
  begin
    insert into groups (organization_id, group_type_id, name) values (alder, v_team, 'T90 Band') returning id into g;
    insert into worship_teams (group_id, organization_id) values (g, alder);
    for r in select * from (values ('chair', true), ('leader', true), ('member', false), ('vice_chair', false),
                                   ('clerk', false), ('secretary', false), ('ex_officio', false)) v(role, leads) loop
      x := pg_temp.t90_person(alder, 'Worship ' || r.role);
      insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on)
      values (alder, g, x, r.role, current_date - 1);
      if presby_worship_leads_team(alder, x, g, current_date) is distinct from r.leads then
        raise exception 'FAIL 90c - presby_worship_leads_team for a % seat returned %, expected %', r.role, not r.leads, r.leads;
      end if;
      raise notice 'pass  90c: presby_worship_leads_team is % for a % seat (R1.3)', r.leads, r.role;
    end loop;
  end $$;
rollback;

-- Reimbursement: presby_reimbursement__is_seat (0073) is owner-only, so it is
-- exercised through its public caller. Tobias Renwick chairs Alder Creek's
-- chargeable Property Committee (the 73d world). With his seat's title
-- switched to each value in turn, a member's submitted request routes to
-- the seat exactly when the title is chair or leader.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  declare
    alder uuid := '22222222-2222-2222-2222-222222222222';
    property uuid := 'b0000000-0000-0000-0000-000000000004';
    tobias uuid := 'c0000000-0000-0000-0000-000000000002';
    marg_user uuid := 'e0000000-0000-0000-0000-0000000000f2';
    category uuid := 'a7300000-0000-4000-8000-000000000021';
    r record;
    s record;
    sub record;
    v_blob uuid;
    v_n integer;
    i integer := 0;
  begin
    for r in select * from (values ('chair', true), ('leader', true), ('vice_chair', false), ('clerk', false),
                                   ('secretary', false), ('ex_officio', false)) v(role, seat) loop
      i := i + 1;
      update group_memberships set group_role = r.role
       where organization_id = alder and group_id = property and person_id = tobias and ends_on is null;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'FAIL 90c - expected Tobias''s one open Property Committee seat (the 73 world), found %', v_n;
      end if;
      select * into s from presby_reimbursement_save_draft('t90-key-' || i, 'reimburse', property, null, null, 2500,
             presby_reimbursement_org_today() - 2, 'T90 paint', category, null, false, marg_user);
      if s.outcome <> 'ok' then
        raise exception 'FAIL 90c - save_draft returned % for the % case', s.outcome, r.role;
      end if;
      v_blob := gen_random_uuid();
      insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
      values (v_blob, alder, md5(random()::text) || md5(clock_timestamp()::text), 'image/jpeg', 3, '\x010203');
      perform presby_reimbursement_attach_receipt(s.request_id, v_blob, repeat('cd', 32), 'image/jpeg', 3, 'receipt.jpg', marg_user);
      select * into sub from presby_reimbursement_submit(s.request_id, 2, marg_user);
      if sub.outcome <> 'ok' then
        raise exception 'FAIL 90c - submit returned % for the % case', sub.outcome, r.role;
      end if;
      if (sub.route = 'seat') is distinct from r.seat then
        raise exception 'FAIL 90c - with Tobias as %, the request routed to % (seat expected: %)', r.role, sub.route, r.seat;
      end if;
      if r.seat and not (tobias = any (sub.notify_person_ids)) then
        raise exception 'FAIL 90c - the % seat routed to the seat but did not name Tobias', r.role;
      end if;
      raise notice 'pass  90c: a % on a chargeable group % the reimbursement seat (route %)', r.role,
        case when r.seat then 'IS' else 'is NOT' end, sub.route;
    end loop;
  end $$;
rollback;

-- ===========================================================================
-- (d) Isolation.
-- ===========================================================================
begin;
  select pg_temp.t90_world();
  -- Another presbytery.
  select set_config('app.current_org_id', :WBASIN, true);
  select assert_eq(
    (select count(*) from committee_details where organization_id = :NREACH)
    + (select count(*) from commission_records where organization_id = :NREACH)
    + (select count(*) from commission_record_members where organization_id = :NREACH),
    0, '90d: the Western Basin reads none of the Northern Reach''s rows in the three tables');
  select assert_eq(
    (select count(*) from committee_details where id = pg_temp.v('cdw'))
    + (select count(*) from commission_records where id = pg_temp.v('crw')),
    2, '90d: (control) the Western Basin reads its own rows');
  select assert_eq(
    pg_temp.t90_rows(format('update committee_details set kind = ''ad_hoc'' where id = %L', pg_temp.v('cd')))
    + pg_temp.t90_rows(format('update commission_records set title = ''T90 hijack'' where id = %L', pg_temp.v('cr')))
    + pg_temp.t90_rows(format('update commission_record_members set role = ''member'' where id = %L', pg_temp.v('crm'))),
    0, '90d: the Western Basin''s updates of the Northern Reach''s rows touch nothing');
  select pg_temp.t90_expect(
    format('insert into commission_records (organization_id, title, appointed_on, created_by, updated_by) values (%L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', 'T90 planted', 'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%row-level security%', '90d: the Western Basin cannot write a commission record into the Northern Reach (WITH CHECK)');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr'), pg_temp.v('p1'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%row-level security%', '90d: ...nor a commission member (WITH CHECK)');
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gch'), 'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'committee_details_target', null,
    '90d: ...nor committee details (the guard, which reads groups under RLS, refuses before WITH CHECK)');

  -- The congregation a commission record is about, and any other congregation.
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from commission_records)
    + (select count(*) from commission_records where about_org_id = :ALDER)
    + (select count(*) from commission_record_members)
    + (select count(*) from committee_details),
    0, '90d: Alder Creek, which the commission record is ABOUT, reads zero rows from all three (organization-only policy)');
  select set_config('app.current_org_id', :FERN, true);
  select assert_eq(
    (select count(*) from commission_records) + (select count(*) from commission_record_members)
    + (select count(*) from committee_details),
    0, '90d: another congregation reads zero rows');
  select set_config('app.current_org_id', '', true);
  select assert_eq(
    (select count(*) from commission_records) + (select count(*) from commission_record_members)
    + (select count(*) from committee_details),
    0, '90d: no org context reads zero rows');
rollback;

-- ===========================================================================
-- (e) Composite keys (F2).
-- ===========================================================================
begin;
  select pg_temp.t90_world();
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gw'), 'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'committee_details_target', null,
    '90e: details naming another presbytery''s group are refused (the guard checks the same (group, organization) pair the composite FK does; the FK alone is proven on the owner path in committees.db.test.ts)');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr'), 'c0000000-0000-0000-0000-000000000001',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23503', 'commission_record_members_person_fk', null,
    '90e: a commission member with no membership at the presbytery (Alder Creek''s Marguerite) is refused by the composite person FK');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('crw'), pg_temp.v('p1'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23503', 'commission_record_members_record_fk', null,
    '90e: a member naming another presbytery''s commission record is refused by the composite record FK');
rollback;

-- ===========================================================================
-- (f) The committee_details guard (on presby_app; the owner path is Vitest).
-- ===========================================================================
begin;
  select pg_temp.t90_world();
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000006',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'committee_details_target', null, '90f: details on a DERIVED group (Active Membership) are refused');
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gch'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'committee_details_target', null, '90f: details on a choir are refused');
  select set_config('app.current_org_id', :ALDER, true);
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '22222222-2222-2222-2222-222222222222', pg_temp.v('ga'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'committee_details_target', null, '90f: details on a CONGREGATION''s committee group are refused (presbyteries only)');
  select set_config('app.current_org_id', :NREACH, true);
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gc'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23505', 'committee_details_group_key', null, '90f: a second details row for one committee is refused (1:1)');
  select pg_temp.t90_expect(
    format('update committee_details set group_id = %L where id = %L', pg_temp.v('gch'), pg_temp.v('cd')),
    '42501', null, '%permission denied%', '90f: group_id cannot change (the column grant; the trigger on the owner path)');
  select pg_temp.t90_expect(
    format('update committee_details set organization_id = %L where id = %L', 'f7000000-0000-0000-0000-000000000001', pg_temp.v('cd')),
    '42501', null, '%permission denied%', '90f: organization_id cannot change');
  select pg_temp.t90_expect(
    format('update committee_details set created_at = now() - interval ''1 day'' where id = %L', pg_temp.v('cd')),
    '42501', null, '%permission denied%', '90f: created_at cannot change');
  select pg_temp.t90_expect(
    format('update committee_details set kind = ''other'' where id = %L', pg_temp.v('cd')),
    '23514', 'committee_details_kind_check', null, '90f: a kind outside required / standing / ad_hoc is refused');
  select pg_temp.t90_ok(
    format('update committee_details set kind = null where id = %L', pg_temp.v('cd')),
    '90f: kind may be null ("Not yet labelled")');
  -- A second committee: dissolved on insert refused; created_at stamped.
  select set_config('t90.gc2', gen_random_uuid()::text, true);
  insert into groups (id, organization_id, group_type_id, name)
  values (pg_temp.v('gc2'), :NREACH, (select id from group_types where key = 'committee'), 'T90 Second Committee');
  select pg_temp.t90_expect(
    format('insert into committee_details (organization_id, group_id, dissolved_on, dissolved_by, dissolved_at, created_by, updated_by) values (%L, %L, current_date, %L, now(), %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('gc2'), 'e0000000-0000-0000-0000-0000000000f3',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'committee_details_insert_dissolved', null, '90f: a non-owner insert of an already-dissolved committee is refused');
  insert into committee_details (organization_id, group_id, kind, created_at, created_by, updated_by)
  values (:NREACH, pg_temp.v('gc2'), 'ad_hoc', '2000-01-01', :CLERK_U, :CLERK_U);
  select assert_eq(
    (select count(*) from committee_details where group_id = pg_temp.v('gc2') and created_at > now() - interval '1 hour'),
    1, '90f: a non-owner insert''s created_at is the server''s clock, not the supplied value');
  -- The dissolved trio and floor, then dissolution, then frozen.
  select pg_temp.t90_expect(
    format('update committee_details set dissolved_on = current_date where id = %L', pg_temp.v('cd')),
    '23514', 'committee_details_dissolved_trio', null, '90f: dissolved_on without dissolved_by and dissolved_at is refused');
  select pg_temp.t90_expect(
    format('update committee_details set dissolved_on = ''1899-12-31'', dissolved_by = %L, dissolved_at = now() where id = %L',
           'e0000000-0000-0000-0000-0000000000f3', pg_temp.v('cd')),
    '23514', 'committee_details_dissolved_floor', null, '90f: dissolved_on 1899-12-31 is refused');
  select pg_temp.t90_ok(
    format('update committee_details set dissolved_on = ''1900-01-01'', dissolved_by = %L, dissolved_at = now(), kind = ''standing'' where id = %L',
           'e0000000-0000-0000-0000-0000000000f3', pg_temp.v('cd')),
    '90f: dissolved_on 1900-01-01 with the trio is accepted (the floor)');
  select pg_temp.t90_expect(
    format('update committee_details set kind = ''required'' where id = %L', pg_temp.v('cd')),
    '23514', 'committee_details_dissolved_final', null, '90f: a dissolved committee''s kind cannot change (frozen)');
  select pg_temp.t90_expect(
    format('update committee_details set dissolved_on = null, dissolved_by = null, dissolved_at = null where id = %L', pg_temp.v('cd')),
    '23514', 'committee_details_dissolved_final', null, '90f: dissolution cannot be undone (one-way)');
  select pg_temp.t90_expect(
    format('update committee_details set updated_at = now() where id = %L', pg_temp.v('cd')),
    '23514', 'committee_details_dissolved_final', null, '90f: no update at all succeeds on a dissolved row');
rollback;

-- ===========================================================================
-- (g) Commission rules.
-- ===========================================================================
begin;
  select pg_temp.t90_world();
  select assert_eq(
    (select count(*) from commission_records where id = pg_temp.v('cr0') and about_org_id is null),
    1, '90g: a record about no congregation is accepted (the trigger''s WHEN skips the null)');
  select assert_eq(
    (select count(*) from commission_records where id = pg_temp.v('cr') and created_at > now() - interval '1 hour'),
    1, '90g: (premise) the record about Alder Creek, affiliated today, was accepted');

  -- About-org: never affiliated, departed, moved.
  select set_config('app.current_org_id', :WBASIN, true);
  select pg_temp.t90_expect(
    format('insert into commission_records (organization_id, about_org_id, title, appointed_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           'f7000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'T90 X',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%',
    '90g: the Western Basin cannot record a commission about Alder Creek (never affiliated; the 0045 trigger)');
  select set_config('app.current_org_id', :SFIELDS, true);
  select pg_temp.t90_expect(
    format('insert into commission_records (organization_id, about_org_id, title, appointed_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           'f6000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'T90 X',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%',
    '90g: the Southern Fields cannot record a new commission about Quillhaven (departed 1995)');
  select set_config('app.current_org_id', :NREACH, true);
  select pg_temp.t90_ok(
    format('update commission_records set title = ''T90 renamed'', charge = ''T90 new charge'' where id = %L', pg_temp.v('cr')),
    '90g: an edit that does not move about_org_id passes (R9)');
  select pg_temp.t90_ok(
    format('update commission_records set about_org_id = %L where id = %L', '33333333-3333-3333-3333-333333333333', pg_temp.v('cr')),
    '90g: moving about_org_id to another affiliated congregation (Bramblewood) passes');
  select pg_temp.t90_expect(
    format('update commission_records set about_org_id = %L where id = %L', 'f7000000-0000-0000-0000-000000000001', pg_temp.v('cr')),
    '42501', null, '%was not affiliated with this council%', '90g: moving about_org_id to a non-member (a presbytery) is refused');
  select pg_temp.t90_ok(
    format('update commission_records set about_org_id = null where id = %L', pg_temp.v('cr')),
    '90g: clearing about_org_id passes (the WHEN)');

  -- Insert rules on the tenant path.
  select pg_temp.t90_expect(
    format('insert into commission_records (organization_id, title, appointed_on, ended_on, ended_by, ended_at, created_by, updated_by) values (%L, %L, current_date - 5, current_date, %L, now(), %L, %L)',
           '11111111-1111-1111-1111-111111111111', 'T90 X', 'e0000000-0000-0000-0000-0000000000f3',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'commission_guard_insert_closed', null, '90g: a non-owner insert of an already-ended record is refused');
  select pg_temp.t90_expect(
    format('insert into commission_records (organization_id, title, appointed_on, removed_at, removed_by, created_by, updated_by) values (%L, %L, current_date, now(), %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', 'T90 X', 'e0000000-0000-0000-0000-0000000000f3',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'commission_guard_insert_closed', null, '90g: a non-owner insert of an already-removed record is refused');
  insert into commission_records (organization_id, title, appointed_on, created_at, created_by, updated_by)
  values (:NREACH, 'T90 stamped', current_date, '2000-01-01', :CLERK_U, :CLERK_U);
  select assert_eq(
    (select count(*) from commission_records where title = 'T90 stamped' and created_at > now() - interval '1 hour'),
    1, '90g: a non-owner insert''s created_at is the server''s clock');

  -- Immutables via the column grant (the trigger is proven on the owner path).
  select pg_temp.t90_expect(
    format('update commission_records set organization_id = %L where id = %L', 'f7000000-0000-0000-0000-000000000001', pg_temp.v('cr')),
    '42501', null, '%permission denied%', '90g: a record''s organization_id cannot change');
  select pg_temp.t90_expect(
    format('update commission_record_members set person_id = %L where id = %L', pg_temp.v('p1'), pg_temp.v('crm')),
    '42501', null, '%permission denied%', '90g: a member''s person_id cannot change');
  select pg_temp.t90_expect(
    format('update commission_record_members set commission_record_id = %L where id = %L', pg_temp.v('cr0'), pg_temp.v('crm')),
    '42501', null, '%permission denied%', '90g: a member''s commission_record_id cannot change');

  -- One open seat per person per record (T8).
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr'), pg_temp.v('pm'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23505', 'commission_record_members_one_open_idx', null, '90g: a second OPEN seat for one person on one record is refused');
  select pg_temp.t90_ok(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, role, starts_on, ends_on, created_by, updated_by) values (%L, %L, %L, ''clerk'', current_date - 60, current_date - 31, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr'), pg_temp.v('pm'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '90g: an ENDED earlier seat for the same person is accepted (history; interval overlap is the application''s)');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, role, starts_on, created_by, updated_by) values (%L, %L, %L, ''leader'', current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr'), pg_temp.v('p1'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'commission_record_members_role_check', null, '90g: ''leader'' is not a commission role (six titles, T6)');
  select pg_temp.t90_expect(
    format('update commission_record_members set starts_on = ''1899-12-31'' where id = %L', pg_temp.v('crm')),
    '23514', 'commission_record_members_starts_floor', null, '90g: a member''s starts_on 1899-12-31 is refused');
  select pg_temp.t90_ok(
    format('update commission_record_members set starts_on = ''1900-01-01'' where id = %L', pg_temp.v('crm')),
    '90g: a member''s starts_on 1900-01-01 is accepted');
  select pg_temp.t90_expect(
    format('update commission_record_members set ends_on = ''1899-12-31'' where id = %L', pg_temp.v('crm')),
    '23514', 'commission_record_members_end_after_start', null, '90g: a member''s ends_on before starts_on is refused');
  select pg_temp.t90_ok(
    format('update commission_record_members set ends_on = starts_on where id = %L', pg_temp.v('crm')),
    '90g: a zero-length member row (ends_on = starts_on) is accepted (a mistaken member, T8)');

  -- CHECK limits on the record.
  select pg_temp.t90_expect(format('update commission_records set title = '''' where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_title_length', null, '90g: an empty title is refused');
  select pg_temp.t90_expect(format('update commission_records set title = ''   '' where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_title_length', null, '90g: a blank title is refused');
  select pg_temp.t90_ok(format('update commission_records set title = repeat(''t'', 200) where id = %L', pg_temp.v('cr0')),
    '90g: a 200-character title is accepted');
  select pg_temp.t90_expect(format('update commission_records set title = repeat(''t'', 201) where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_title_length', null, '90g: a 201-character title is refused');
  select pg_temp.t90_ok(format('update commission_records set charge = repeat(''c'', 500) where id = %L', pg_temp.v('cr0')),
    '90g: a 500-character charge is accepted');
  select pg_temp.t90_expect(format('update commission_records set charge = repeat(''c'', 501) where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_charge_length', null, '90g: a 501-character charge is refused');
  select pg_temp.t90_ok(format('update commission_records set minute_reference = repeat(''m'', 200) where id = %L', pg_temp.v('cr0')),
    '90g: a 200-character minute reference is accepted');
  select pg_temp.t90_expect(format('update commission_records set minute_reference = repeat(''m'', 201) where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_minute_length', null, '90g: a 201-character minute reference is refused');
  select pg_temp.t90_expect(format('update commission_records set appointed_on = ''1899-12-31'' where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_appointed_floor', null, '90g: appointed_on 1899-12-31 is refused');
  select pg_temp.t90_ok(format('update commission_records set appointed_on = ''1900-01-01'' where id = %L', pg_temp.v('cr0')),
    '90g: appointed_on 1900-01-01 is accepted');
  select pg_temp.t90_expect(format('update commission_records set ended_minute_reference = ''x'' where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_ended_minute_needs_end', null, '90g: an ending minute without an end date is refused');
  select pg_temp.t90_expect(format('update commission_records set ended_on = current_date where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_ended_trio', null, '90g: ended_on without ended_by and ended_at is refused');
  select pg_temp.t90_expect(format('update commission_records set removed_at = now() where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_removed_pair', null, '90g: removed_at without removed_by is refused');
  select pg_temp.t90_expect(
    format('update commission_records set ended_on = ''1899-12-31'', ended_by = %L, ended_at = now() where id = %L',
           'e0000000-0000-0000-0000-0000000000f3', pg_temp.v('cr0')),
    '23514', 'commission_records_ended_after_appointed', null, '90g: ended_on before appointed_on is refused');

  -- Ending is one-way; an ended record still edits; then removal is one-way.
  select pg_temp.t90_ok(
    format('update commission_records set ended_on = current_date, ended_by = %L, ended_at = now(), ended_minute_reference = repeat(''e'', 200) where id = %L',
           'e0000000-0000-0000-0000-0000000000f3', pg_temp.v('cr0')),
    '90g: ending a record (with a 200-character ending minute) is accepted');
  select pg_temp.t90_expect(format('update commission_records set ended_minute_reference = repeat(''e'', 201) where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_records_ended_minute_length', null, '90g: a 201-character ending minute is refused');
  select pg_temp.t90_expect(format('update commission_records set ended_on = current_date + 1 where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_ended_final', null, '90g: an ended record''s end date cannot move');
  select pg_temp.t90_expect(format('update commission_records set ended_on = null, ended_by = null, ended_at = null where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_ended_final', null, '90g: an ended record cannot be reopened (ending is one-way)');
  select pg_temp.t90_ok(format('update commission_records set title = ''T90 ended, retitled'', row_version = row_version + 1 where id = %L', pg_temp.v('cr0')),
    '90g: an ended record''s other fields still edit');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr0'), pg_temp.v('p2'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'commission_record_closed', null, '90g: no member may be added to an ENDED record off the owner path (the live guard)');
  select pg_temp.t90_ok(
    format('update commission_records set removed_at = now(), removed_by = %L where id = %L', 'e0000000-0000-0000-0000-0000000000f3', pg_temp.v('cr0')),
    '90g: removing a record is accepted');
  select pg_temp.t90_expect(format('update commission_records set title = ''T90 after removal'' where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_removal_final', null, '90g: a removed record never changes again');
  select pg_temp.t90_expect(format('update commission_records set removed_at = null, removed_by = null where id = %L', pg_temp.v('cr0')),
    '23514', 'commission_removal_final', null, '90g: removal cannot be undone (one-way)');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr0'), pg_temp.v('p3'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'commission_record_closed', null, '90g: no member may be added to a REMOVED record');
  -- A removed but never-ended record refuses a member too.
  update commission_records set removed_at = now(), removed_by = :CLERK_U where id = pg_temp.v('cr');
  select pg_temp.t90_expect(
    format('insert into commission_record_members (organization_id, commission_record_id, person_id, starts_on, created_by, updated_by) values (%L, %L, %L, current_date, %L, %L)',
           '11111111-1111-1111-1111-111111111111', pg_temp.v('cr'), pg_temp.v('p4'),
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '23514', 'commission_record_closed', null, '90g: no member may be added to a removed record that never ended');
rollback;

-- ===========================================================================
-- (h) presby_public_committee_roster at a congregation with a LIVE site
--     (Fernwood). The function is organization-type agnostic; a presbytery
--     with a live site (and so a dissolved committee and a commission member)
--     is the owner-path Vitest's, because presby_app holds no grant on
--     organization_sites.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :FERN, true);
  -- (presby_app holds no grant on organization_sites; the control assertion
  -- below, which lists four rows, is the proof that Fernwood's site is live.)
  do $$
  declare
    fern uuid := '55555555-5555-5555-5555-555555555555';
    u uuid := 'e0000000-0000-0000-0000-0000000000f3';
    g uuid;
    r record;
    x uuid;
  begin
    insert into groups (organization_id, group_type_id, name)
    values (fern, (select id from group_types where key = 'committee'), 'T90 Fern Committee') returning id into g;
    perform set_config('t90.gf', g::text, true);
    for r in select * from (values
        ('Serving',       'chair',      current_date - 10, null::date,        true),
        ('PlannedEnd',    'vice_chair', current_date - 10, current_date + 30, true),
        ('FutureStart',   'clerk',      current_date + 5,  null::date,        true),
        ('EndedSeat',     'secretary',  current_date - 30, current_date,      true),
        ('EndedMember',   'member',     current_date - 30, null::date,        true),
        ('Deceased',      'ex_officio', current_date - 30, null::date,        true),
        ('Unlisted',      'member',     current_date - 30, null::date,        false)) v(label, role, s, e, listed) loop
      x := pg_temp.t90_person(fern, r.label);
      perform set_config('t90.f_' || r.label, x::text, true);
      insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on, ends_on,
                                     public_listed, public_listed_by, public_listed_at)
      values (fern, g, x, r.role, r.s, r.e, r.listed, case when r.listed then u end, case when r.listed then now() end);
    end loop;
  end $$;
  select pg_temp.t90_eq_text(
    (select string_agg(display_name || '/' || group_role, ',' order by display_name)
       from presby_public_committee_roster('fernwood', 'T90 Fern Committee')),
    'T90 Deceased/ex_officio,T90 EndedMember/member,T90 PlannedEnd/vice_chair,T90 Serving/chair',
    '90h: (control, before the membership end and the death) the started, unended, listed seats are listed');
  update memberships set ended_on = current_date - 1
   where organization_id = :FERN and person_id = pg_temp.v('f_EndedMember');
  update people set date_of_death = current_date - 1 where id = pg_temp.v('f_Deceased');
  select pg_temp.t90_eq_text(
    (select string_agg(display_name || '/' || group_role, ',' order by display_name)
       from presby_public_committee_roster('fernwood', 'T90 Fern Committee')),
    'T90 PlannedEnd/vice_chair,T90 Serving/chair',
    '90h: listed are a serving seat and a seat with a PLANNED end; not a future start, an ended seat, an ended membership, a death, or an unlisted seat');
  select assert_eq(
    (select count(*) from presby_public_committee_roster('fernwood') r
      where r.group_name = 'T90 Fern Committee' and r.display_name in ('T90 FutureStart', 'T90 EndedSeat', 'T90 EndedMember', 'T90 Deceased', 'T90 Unlisted')),
    0, '90h: the unfiltered call (the asset door''s shape) excludes the same five');
  select pg_temp.t90_eq_text(
    (select pg_get_function_result('presby_public_committee_roster(text, text, boolean)'::regprocedure)),
    'TABLE(group_name text, group_role text, display_name text, photo_key text)',
    '90h: the projection is exactly group_name, group_role, display_name, photo_key (the kind label, dissolved state and commission data never enter it)');
  select assert_eq(
    (select count(*) from pg_proc where proname = 'presby_public_committee_roster'
        and prosrc not like '%commission_record%' and prosrc like '%from group_memberships gm%'),
    1, '90h: the roster reads group rows only; a commission member (not a group row) is structurally absent');
rollback;

-- ===========================================================================
-- (i) The resolver cannot see a commission-record member.
-- ===========================================================================
begin;
  select pg_temp.t90_world();
  -- pm's only link to anything is commission_record_members on cr (about Alder Creek).
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from presby_effective_permissions(pg_temp.v('pm'), :ALDER, current_date)),
    0, '90i: a person whose only link is a commission record about Alder Creek holds NOTHING at Alder Creek');
  select assert_eq(
    (select (count(*) > 0)::int from presby_effective_permissions(:ROWAN, :ALDER, current_date) where source_kind ilike '%commission%'),
    1, '90i: (premise) the commission arm is live: Rowan, on the dev commission''s committee group, holds keys at Alder Creek through it');
  select set_config('app.current_org_id', :NREACH, true);
  -- At the presbytery pm is a plain member, so the derived membership
  -- group's baseline applies; the commission record must add NOTHING to it.
  select assert_eq(
    (select count(*) from (
       select permission_key from presby_effective_permissions(pg_temp.v('pm'), :NREACH, current_date)
       except
       select permission_key from presby_effective_permissions(pg_temp.v('p1'), :NREACH, current_date)) d)
    + (select count(*) from presby_effective_permissions(pg_temp.v('pm'), :NREACH, current_date)
        where source_kind = 'commission'),
    0, '90i: ...and at the presbytery the commission record adds nothing to what an otherwise identical plain member holds');
  -- Sensitivity control: the SAME person, put on the dev commission's
  -- committee roster (b...0005, the group an administrative_commissions row
  -- names), is found by the resolver's commission arm. So the zero above is
  -- the structure, not a blind query.
  insert into group_memberships (organization_id, group_id, person_id, starts_on)
  values (:NREACH, :ACGROUP, pg_temp.v('pm'), current_date - 1);
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select (count(*) > 0)::int from presby_effective_permissions(pg_temp.v('pm'), :ALDER, current_date) where source_kind ilike '%commission%'),
    1,
    '90i: (sensitivity control) the same person on a committee GROUP that a commission names does acquire permissions at Alder Creek');
rollback;

-- ===========================================================================
-- (j) The dev administrative_commissions row is unchanged by 0090.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :NREACH, true);
  select assert_eq(
    (select count(*) from administrative_commissions
      where parent_org_id = :NREACH and target_org_id = :ALDER and group_id = :ACGROUP
        and role_id = 'f0000000-0000-0000-0000-000000000001'),
    1, '90j: the dev administrative_commissions row still names the Commission on Alder Creek group and its role');
  select assert_eq(
    (select count(*) from groups g join group_types gt on gt.id = g.group_type_id
      where g.id = :ACGROUP and g.membership_source = 'managed' and gt.key = 'committee'),
    1, '90j: that group is still a managed committee group');
  select assert_eq(
    (select count(*) from committee_details where group_id = :ACGROUP and kind is not null),
    0, '90j: that group carries no label from 0090 (no backfill; T16 keeps it "Not yet labelled")');
rollback;

drop function if exists pg_temp.t90_world();
drop function if exists pg_temp.t90_person(uuid, text);
drop function if exists pg_temp.t90_rows(text);
drop function if exists pg_temp.t90_eq_text(text, text, text);
drop function if exists pg_temp.t90_ok(text, text);
drop function if exists pg_temp.t90_expect(text, text, text, text, text);

\echo '======================================================'
\echo ' Section 90 (presbytery committees) complete.'
\echo '======================================================'
