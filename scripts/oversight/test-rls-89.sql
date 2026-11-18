-- ---------------------------------------------------------------------------
-- 89. Congregation records, Increment 1: the presbytery's own profile,
--     buildings, photos, appraisals, insurance years and loans about each
--     member congregation (drizzle/0089_presby_oversight_records.sql;
--     DECISION-344, 345, 347, 349; F450, F451; docs/work-log/
--     2026-11-17-congregation-profile.md Phase 3 "Data Model" and "Seed and
--     test files").
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner, and its 44a assertion names
--     the finance key too (scripts/oversight/test-rls.sql.integration.patch):
--
--         \ir oversight/test-rls-89.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/oversight/test-rls-89.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs ONLY the stock
--     scripts/seed-dev.sql fixture: the Northern Reach with Alder Creek,
--     Bramblewood and Quillhaven affiliated today; the Southern Fields
--     (Quillhaven's council until 1995); the Western Basin (no member
--     congregation); the Synod of the Coastal Plain over the Tidewater; the
--     clerk fixture user. It does NOT read scripts/oversight/
--     seed-dev-oversight.sql: every row asserted below is built inside its
--     own block by pg_temp.t89_world(), and every block ends in rollback, so
--     the suite writes nothing durable.
--
--     Sections:
--       (a) structure: FORCE RLS and the one policy on all six, the composite
--           keys and FK shapes, every trigger enabled, the two guards
--           SECURITY INVOKER with search_path pinned and owner-only EXECUTE
--       (b) catalog and bundle: the finance key (tier 2, 2FA, module
--           presbytery), the presbytery arm carries it and no other arm does,
--           the 0085 / 71b byte greps still match, the backfill
--       (c) grants (aclexplode, F38/F253): no DELETE or TRUNCATE for
--           presby_app, nothing for presby_platform, exact UPDATE columns
--       (d) isolation: another council reads none of the rows and cannot
--           write them; a managed congregation's own session (and its
--           administrator) reads zero rows from all six
--       (e) composite keys: a photo, appraisal or loan naming another
--           congregation's building is refused by the FK
--       (f) about-org: never-affiliated and departed congregations refused
--           on insert; an affiliated unmanaged congregation accepted
--       (g) removal one-way, the column grant as immutability, the guard's
--           insert rules, 'imported' refused on the tenant path, the
--           building-live guard, every partial unique
--       (h) presby_public_site_asset() serves no building-photo key; a photo
--           cannot reference a public_site blob
--       (i) CHECK boundaries: years, money, square feet, lengths, pairs
--
--     What presby_app CANNOT reach is proven on the owner connection in
--     Vitest (src/lib/db/domain/oversight.db.test.ts): the guards on the
--     OWNER path (F44) including the immutable-column rule (on presby_app
--     the column grant refuses first), an edit of a departed congregation's
--     row, the FOR SHARE serialization under two connections, the door with
--     a live site (positive control), the teardown order, and the backfill
--     re-run from the migration's own text.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set NREACH    '\'11111111-1111-1111-1111-111111111111\''
\set ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set BRAMBLE   '\'33333333-3333-3333-3333-333333333333\''
\set QUILL     '\'44444444-4444-4444-4444-444444444444\''
\set SFIELDS   '\'f6000000-0000-0000-0000-000000000001\''
\set WBASIN    '\'f7000000-0000-0000-0000-000000000001\''
\set SYNOD     '\'f8000000-0000-0000-0000-000000000001\''
\set TIDE      '\'f8000000-0000-0000-0000-000000000002\''
\set CLERK_U   '\'e0000000-0000-0000-0000-0000000000f3\''

\echo '======================================================'
\echo ' Section 89 (congregation records, drizzle/0089) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '89: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ---------------------------------------------------------------------------
-- Session helpers (pg_temp: they vanish with the session and are never on
-- the search_path, so they cannot shadow anything).
--
-- pg_temp.t89_expect(sql, sqlstate, constraint_or_null, message_like_or_null,
-- label): runs the statement in a subtransaction and passes only if it raises
-- exactly that SQLSTATE and (when given) that CONSTRAINT name and a message
-- matching that LIKE pattern. A statement that SUCCEEDS is a FAIL. The
-- message pattern tells apart the three 42501 sources (RLS WITH CHECK, a
-- column grant, the about-org trigger).
-- ---------------------------------------------------------------------------
create or replace function pg_temp.t89_expect(p_sql text, p_state text, p_constraint text, p_like text, p_label text)
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

-- pg_temp.t89_ok(sql, label): the statement must succeed (inside a
-- subtransaction, so a pass leaves its row in the caller's transaction).
create or replace function pg_temp.t89_ok(p_sql text, p_label text)
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

-- pg_temp.v(key): an id the world stashed with set_config('t89.<key>').
create or replace function pg_temp.v(p_key text)
returns uuid language sql stable as $$ select current_setting('t89.' || p_key)::uuid $$;

-- pg_temp.t89_blob(org, audience): a tiny blob row as presby_app, its id.
create or replace function pg_temp.t89_blob(p_org uuid, p_audience text)
returns uuid language plpgsql as $$
declare x uuid;
begin
  insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
  values (p_org, md5(random()::text) || md5(clock_timestamp()::text), 'image/webp', 4, '\x52494646'::bytea, p_audience)
  returning id into x;
  return x;
end $$;

-- pg_temp.t89_world(): builds, as presby_app, inside the CALLER's
-- transaction, the Northern Reach's records and one Synod row, and stashes
-- every id (transaction-local). Northern Reach (NR):
--   b1  Alder Creek "T89 Sanctuary", primary
--   b2  Alder Creek "T89 Annex"
--   bb  Bramblewood "T89 Hall"
--   pa  Alder Creek's profile
--   ia  Alder Creek's 2025 insurance year
--   la  Bramblewood's loan
--   ap  b1's 2024 appraisal
--   img, thumb  private blobs; ph  b1's cover photo
-- Synod of the Coastal Plain: sp  a profile about the Tidewater (its member
-- presbytery), so the suite has another council's row to look for.
-- Works with or without scripts/oversight/seed-dev-oversight.sql applied (it
-- stands a seeded primary down and reuses a seeded profile row, inside the
-- caller's rolled-back transaction).
-- Leaves app.current_org_id at the Northern Reach.
create or replace function pg_temp.t89_world()
returns void language plpgsql as $$
declare
  nr uuid := '11111111-1111-1111-1111-111111111111';
  alder uuid := '22222222-2222-2222-2222-222222222222';
  bramble uuid := '33333333-3333-3333-3333-333333333333';
  u uuid := 'e0000000-0000-0000-0000-0000000000f3';
  r record;
  ids jsonb := '{}'::jsonb;
  x uuid;
begin
  ids := ids || jsonb_build_object('nr', nr, 'alder', alder, 'bramble', bramble, 'u', u);

  perform set_config('app.current_org_id', 'f8000000-0000-0000-0000-000000000001', true);
  insert into oversight_profiles (organization_id, about_org_id, city, created_by, updated_by)
  values ('f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000002', 'T89 Synod city', u, u)
  returning id into x;
  ids := ids || jsonb_build_object('sp', x);

  perform set_config('app.current_org_id', nr::text, true);
  -- Tolerate scripts/oversight/seed-dev-oversight.sql (Alder Creek's seeded
  -- primary building and profile): stand the seeded primary down for this
  -- transaction only, and take over the one profile row if it exists.
  update oversight_buildings set is_primary = false
   where organization_id = nr and about_org_id = alder and is_primary and removed_at is null;
  insert into oversight_buildings (organization_id, about_org_id, name, building_type, is_primary, created_by, updated_by)
  values (nr, alder, 'T89 Sanctuary', 'sanctuary', true, u, u) returning id into x;
  ids := ids || jsonb_build_object('b1', x);
  insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by)
  values (nr, alder, 'T89 Annex', 'annex', u, u) returning id into x;
  ids := ids || jsonb_build_object('b2', x);
  insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by)
  values (nr, bramble, 'T89 Hall', 'fellowship_hall', u, u) returning id into x;
  ids := ids || jsonb_build_object('bb', x);
  insert into oversight_profiles (organization_id, about_org_id, city, county, created_by, updated_by)
  values (nr, alder, 'T89 City', 'T89 County', u, u)
  on conflict (organization_id, about_org_id) do update
     set city = excluded.city, county = excluded.county, year_organized = null, street_address = null, phone = null
  returning id into x;
  ids := ids || jsonb_build_object('pa', x);
  insert into oversight_insurance_years (organization_id, about_org_id, policy_year, carrier, created_by, updated_by)
  values (nr, alder, 2025, 'T89 Mutual', u, u) returning id into x;
  ids := ids || jsonb_build_object('ia', x);
  insert into oversight_loans (organization_id, about_org_id, kind, current_balance_cents, balance_as_of, created_by, updated_by)
  values (nr, bramble, 'presbytery_program', 1250000, date '2026-01-01', u, u) returning id into x;
  ids := ids || jsonb_build_object('la', x);
  insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by)
  values (nr, alder, (ids ->> 'b1')::uuid, 2024, 90000000, u) returning id into x;
  ids := ids || jsonb_build_object('ap', x);
  ids := ids || jsonb_build_object('img', pg_temp.t89_blob(nr, 'private'), 'thumb', pg_temp.t89_blob(nr, 'private'));
  insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key,
                                         width, height, is_cover, created_by)
  values (nr, alder, (ids ->> 'b1')::uuid, (ids ->> 'img')::uuid, (ids ->> 'thumb')::uuid, 1200, 900, true, u)
  returning id into x;
  ids := ids || jsonb_build_object('ph', x);

  for r in select key, value from jsonb_each_text(ids) loop
    perform set_config('t89.' || r.key, r.value, true);
  end loop;
end $$;

-- ===========================================================================
-- (a) Structure
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname in ('oversight_profiles', 'oversight_buildings', 'oversight_building_photos',
                          'oversight_building_appraisals', 'oversight_insurance_years', 'oversight_loans')
        and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
    6, '89a: all six oversight tables have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_class c where c.relname like 'oversight\_%' and c.relkind = 'r'),
    6, '89a: and there is no seventh oversight_ table');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename like 'oversight\_%' and policyname = 'tenant_isolation' and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    6, '89a: each carries tenant_isolation with BOTH using and with check on presby_current_org()');
  select assert_eq(
    (select count(*) from pg_policies where tablename like 'oversight\_%'),
    6, '89a: and no other policy (no permission predicate in any policy)');
  -- Composite targets, by column list (F2).
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'u'
        and (c.conname, (select string_agg(a.attname::text, ',' order by k.ord)
                           from unnest(c.conkey) with ordinality k(attnum, ord)
                           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum))
            in (('oversight_profiles_id_org_key', 'id,organization_id'),
                ('oversight_profiles_org_about_key', 'organization_id,about_org_id'),
                ('oversight_buildings_id_org_key', 'id,organization_id'),
                ('oversight_buildings_id_org_about_key', 'id,organization_id,about_org_id'),
                ('oversight_building_photos_id_org_key', 'id,organization_id'),
                ('oversight_building_appraisals_id_org_key', 'id,organization_id'),
                ('oversight_insurance_years_id_org_key', 'id,organization_id'),
                ('oversight_loans_id_org_key', 'id,organization_id'))),
    8, '89a: the eight unique keys exist with exactly these columns (one three-column child target)');
  -- The three building FKs: three columns, NO ACTION, onto the three-column key.
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'oversight_buildings'::regclass and c.confdeltype = 'a'
        and c.conname in ('oversight_building_photos_building_fk', 'oversight_building_appraisals_building_fk',
                          'oversight_loans_building_fk')
        and (select string_agg(a.attname::text, ',' order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = 'building_id,organization_id,about_org_id'
        and (select string_agg(a.attname::text, ',' order by k.ord)
               from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = 'id,organization_id,about_org_id'),
    3, '89a: photos, appraisals and loans reference (building_id, organization_id, about_org_id) -> oversight_buildings, NO ACTION (Gap 12)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass and c.confdeltype = 'a'
        and c.conrelid = 'oversight_building_photos'::regclass
        and c.conname in ('oversight_building_photos_image_fk', 'oversight_building_photos_thumb_fk')
        and array_length(c.conkey, 1) = 3),
    2, '89a: both photo blob FKs are three-column and NO ACTION (the 0078 shape)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid::regclass::text like 'oversight\_%'
        and c.confrelid = 'organizations'::regclass and c.confdeltype = 'c'
        and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'organization_id'),
    6, '89a: organization_id references organizations on delete cascade on all six (reachable only through D10''s guarded teardown)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid::regclass::text like 'oversight\_%'
        and c.confrelid = 'organizations'::regclass and c.confdeltype = 'a'
        and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'about_org_id'),
    6, '89a: about_org_id is a plain NO ACTION FK to organizations on all six (section-17 structural exception)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid::regclass::text like 'oversight\_%'
        and c.confrelid not in ('organizations'::regclass, 'users'::regclass, 'oversight_buildings'::regclass,
                                'blob_assets'::regclass)),
    0, '89a: no other FK target');
  -- Triggers.
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid::regclass::text like 'oversight\_%' and not t.tgisinternal and t.tgenabled = 'O'),
    17, '89a: the 17 oversight triggers exist and are ENABLED (origin) - they fire on the owner path too (F44)');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgfoid = 'presby_check_about_org_affiliated()'::regprocedure
        and t.tgrelid::regclass::text in ('oversight_profiles', 'oversight_buildings', 'oversight_insurance_years', 'oversight_loans')
        and encode(t.tgargs, 'escape') = 'about_org_id\000\000'),
    4, '89a: the 0045 about-org trigger, as of the current date, on profiles, buildings, insurance years and loans');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgfoid = 'presby_check_about_org_affiliated()'::regprocedure
        and t.tgrelid::regclass::text in ('oversight_building_photos', 'oversight_building_appraisals')),
    0, '89a: and not on photos or appraisals (the three-column FK pins them to a checked building)');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgfoid = 'presby_oversight_guard_write()'::regprocedure
        and t.tgrelid::regclass::text in ('oversight_buildings', 'oversight_building_photos', 'oversight_building_appraisals',
                                          'oversight_insurance_years', 'oversight_loans')),
    5, '89a: the removal guard on the five tables with a removal pair');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgfoid = 'presby_oversight_building_live_guard()'::regprocedure
        and t.tgrelid::regclass::text in ('oversight_building_photos', 'oversight_building_appraisals', 'oversight_loans')),
    3, '89a: the building-live guard on photos, appraisals and loans');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgfoid = 'presby_oversight_guard_provenance()'::regprocedure
        and t.tgrelid::regclass::text in ('oversight_profiles', 'oversight_buildings', 'oversight_building_appraisals',
                                          'oversight_insurance_years', 'oversight_loans')
        and t.tgtype & 2 = 2 and t.tgtype & 4 = 4 and t.tgtype & 16 = 16),
    5, '89a: the provenance guard, BEFORE INSERT OR UPDATE, on the five tables with provenance (photos have none)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_oversight_guard_write', 'presby_oversight_building_live_guard',
                          'presby_oversight_guard_provenance')
        and not p.prosecdef and p.proconfig = array['search_path=public, pg_temp']),
    3, '89a: the three guards are SECURITY INVOKER with search_path pinned');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_oversight_guard_write', 'presby_oversight_building_live_guard',
                          'presby_oversight_guard_provenance')
        and p.proacl = array[(pg_get_userbyid(p.proowner) || '=X/' || pg_get_userbyid(p.proowner))::aclitem]),
    3, '89a: the three guards are executable by their owner alone (a trigger needs no EXECUTE at fire time)');
rollback;

-- ===========================================================================
-- (b) Catalog and bundle (R2, DECISION-345, F450)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from permissions
      where key = 'congregation_oversight.finance' and module = 'presbytery'
        and sensitivity_tier = 2 and requires_two_factor
        and description = 'See and record a member congregation''s appraisals, insurance and loans (the presbytery''s own record)'),
    1, '89b: congregation_oversight.finance is tier 2, module presbytery, requires two-factor, with the Roles-screen description');
  select assert_eq(
    (select count(*) from permissions
      where key = 'congregation_oversight.manage' and sensitivity_tier = 1 and not requires_two_factor),
    1, '89b: congregation_oversight.manage is unchanged (tier 1, no 2FA)');
  -- The SQL authority. presby_app cannot EXECUTE it (owner only, 0059), but
  -- pg_proc is world-readable.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_founding_administrator_permission_keys(text)'::regprocedure
        and p.prosrc like '%when p_org_type = ''presbytery''%then array[''congregation_oversight.manage'', ''congregation_oversight.finance'']::text[]%'
        and (length(p.prosrc) - length(replace(p.prosrc, 'congregation_oversight.finance', ''))) = length('congregation_oversight.finance')
        and p.prosecdef and p.provolatile = 'i'
        and p.proconfig = array['search_path=public, pg_temp']),
    1, '89b: the presbytery arm carries manage then finance, finance appears nowhere else, still immutable SECURITY DEFINER');
  -- The 0085 (85b) and 0071 (71b) greps still match the re-created body.
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_founding_administrator_permission_keys(text)'::regprocedure
        and p.prosrc like '%''domains.manage'', ''careers.manage'', ''careers.applicants''%'
        and p.prosrc like '%when p_org_type in (''congregation'', ''new_worshiping_community'')%then array[''worship.manage'', ''worship.plan'', ''worship.schedule'']%'
        and p.prosrc like '%worship.schedule%congregation_oversight.manage%'),
    1, '89b: the base and worship arms are byte-for-byte (the 71b and 85b patterns still match)');
  select assert_eq(
    (select count(*) where has_function_privilege('presby_app', 'presby_founding_administrator_permission_keys(text)', 'execute')),
    0, '89b: and presby_app still cannot execute it (the re-create re-applied the revoke)');
  -- The backfill: every presbytery founding role presby_app can see in the
  -- Northern Reach's context holds the key (vacuous where the stock seed has
  -- none; oversight.db.test.ts re-runs section 3 against a fixture role).
  select set_config('app.current_org_id', :NREACH, true);
  select assert_eq(
    (select count(*) from app_roles r
      where r.key = 'founding_administrator' and r.organization_id = :NREACH
        and not exists (select 1 from app_role_permissions rp
                         where rp.role_id = r.id and rp.permission_key = 'congregation_oversight.finance')),
    0, '89b: the Northern Reach''s founding_administrator role, if it has one, holds the finance key (backfill)');
  -- No template carries it (only the bundle delivers it, DECISION-345).
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and rp.permission_key = 'congregation_oversight.finance'),
    0, '89b: no template role carries the finance key (option B, the clerk template, was rejected)');
rollback;

-- ===========================================================================
-- (c) Grants (F38: read from the ACL, not from the migration text)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'oversight\_%' and c.relkind = 'r'
        and a.grantee in ('presby_app'::regrole, 'presby_platform'::regrole)
        and a.privilege_type in ('DELETE', 'TRUNCATE')),
    0, '89c: neither presby_app nor presby_platform holds DELETE or TRUNCATE on any oversight table (all deletes are soft)');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'oversight\_%' and c.relkind = 'r' and a.grantee = 'presby_platform'::regrole),
    0, '89c: presby_platform holds no table privilege on any oversight table (Two Hierarchies)');
  select assert_eq(
    (select count(*) from pg_class c
      where c.relname like 'oversight\_%' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a, lateral aclexplode(a.attacl) x
                     where a.attrelid = c.oid and x.grantee = 'presby_platform'::regrole)),
    0, '89c: and no column privilege either');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'oversight\_%' and c.relkind = 'r' and a.grantee = 'presby_app'::regrole),
    12, '89c: presby_app holds exactly two table-level privileges per oversight table');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'oversight\_%' and c.relkind = 'r' and a.grantee = 'presby_app'::regrole
        and a.privilege_type in ('SELECT', 'INSERT')),
    12, '89c: and they are SELECT and INSERT');
  select assert_eq(
    (select count(*) from pg_class c, lateral aclexplode(c.relacl) a
      where c.relname like 'oversight\_%' and c.relkind = 'r' and a.grantee = 0),
    0, '89c: PUBLIC holds nothing');
  create temp table t89_cols on commit drop as
  select c.relname::text as tbl, x.privilege_type as priv,
         string_agg(a.attname::text, ',' order by a.attname) as cols
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
   where c.relname like 'oversight\_%' and c.relkind = 'r' and x.grantee = 'presby_app'::regrole
   group by 1, 2;
  select assert_eq(
    (select count(*) from t89_cols where (tbl, priv, cols) in (
      ('oversight_profiles', 'UPDATE', 'city,county,phone,row_version,street_address,updated_at,updated_by,year_organized'),
      ('oversight_buildings', 'UPDATE', 'boiler_condition,building_type,first_addition_year,has_fire_alarm,has_security_system,has_sprinklers,hvac_condition,is_primary,name,notes,plumbing_condition,removed_at,removed_by,retired_on,retired_reason,roof_condition,row_version,second_addition_year,square_feet,updated_at,updated_by,year_built'),
      ('oversight_building_photos', 'UPDATE', 'caption,is_cover,removed_at,removed_by'),
      ('oversight_building_appraisals', 'UPDATE', 'removed_at,removed_by'),
      ('oversight_insurance_years', 'UPDATE', 'carrier,notes,policy_expires_on,policy_number,pool_interest,recent_claims,removed_at,removed_by,row_version,updated_at,updated_by'),
      ('oversight_loans', 'UPDATE', 'balance_as_of,building_id,current_balance_cents,grants_amount_cents,guarantee_note,kind,lender,notes,original_amount_cents,paid_off_on,removed_at,removed_by,row_version,status,updated_at,updated_by'))),
    6, '89c: presby_app''s column-limited UPDATE lists are exactly the design''s six');
  select assert_eq(
    (select count(*) from t89_cols),
    6, '89c: and no other column-level privilege');
  select assert_eq(
    (select count(*) from t89_cols
      where cols ~ '(^|,)(id|organization_id|about_org_id|provenance|created_at|created_by|policy_year|assessed_year|amount_cents|image_asset_key|thumb_asset_key|asset_audience|width|height)(,|$)'),
    0, '89c: no UPDATE grant names an identity column, provenance, created_*, a policy or appraisal year, an amount of an appraisal, or a photo''s blob/size');
rollback;

-- ===========================================================================
-- (d) Isolation
-- ===========================================================================
begin;
  select pg_temp.t89_world();
  select assert_eq(
    (select count(*) from oversight_profiles) + (select count(*) from oversight_buildings)
    + (select count(*) from oversight_building_photos) + (select count(*) from oversight_building_appraisals)
    + (select count(*) from oversight_insurance_years) + (select count(*) from oversight_loans),
    (select count(*) from oversight_profiles where organization_id = :NREACH) + (select count(*) from oversight_buildings where organization_id = :NREACH)
    + (select count(*) from oversight_building_photos where organization_id = :NREACH) + (select count(*) from oversight_building_appraisals where organization_id = :NREACH)
    + (select count(*) from oversight_insurance_years where organization_id = :NREACH) + (select count(*) from oversight_loans where organization_id = :NREACH),
    '89d: from the Northern Reach every visible oversight row is the Northern Reach''s own');
  select assert_eq(
    (select count(*) from oversight_profiles where id = pg_temp.v('sp')),
    0, '89d: from the Northern Reach, the Synod''s profile row is invisible');
  select assert_eq(
    (select count(*) from oversight_buildings where id in (pg_temp.v('b1'), pg_temp.v('b2'), pg_temp.v('bb'))),
    3, '89d: (precondition) the Northern Reach sees its own three buildings');

  -- Another presbytery (no member congregations) reads none and writes none.
  select set_config('app.current_org_id', :WBASIN, true);
  select assert_eq(
    (select count(*) from oversight_profiles) + (select count(*) from oversight_buildings)
    + (select count(*) from oversight_building_photos) + (select count(*) from oversight_building_appraisals)
    + (select count(*) from oversight_insurance_years) + (select count(*) from oversight_loans),
    0, '89d: from the Western Basin, no oversight row of any council is visible (cross-presbytery read is zero)');
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'T89 smuggled', 'other', pg_temp.v('u'), pg_temp.v('u')),
    '42501', null, '%row-level security%', '89d: from the Western Basin, an insert stamped with the Northern Reach''s id is refused by RLS WITH CHECK');
  update oversight_buildings set name = 'T89 hijack' where id = pg_temp.v('b1');
  update oversight_loans set current_balance_cents = 0 where id = pg_temp.v('la');
  select set_config('app.current_org_id', :NREACH, true);
  select assert_eq(
    (select count(*) from oversight_buildings where id = pg_temp.v('b1') and name = 'T89 Sanctuary')
    + (select count(*) from oversight_loans where id = pg_temp.v('la') and current_balance_cents = 1250000),
    2, '89d: the Western Basin''s UPDATEs of the Northern Reach''s rows touched nothing (RLS USING)');

  -- The congregation the records are ABOUT reads none of them: a managed
  -- congregation's own session (Alder Creek) sees zero rows from all six.
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from oversight_profiles) + (select count(*) from oversight_buildings)
    + (select count(*) from oversight_building_photos) + (select count(*) from oversight_building_appraisals)
    + (select count(*) from oversight_insurance_years) + (select count(*) from oversight_loans),
    0, '89d: Alder Creek''s own session (a managed congregation) reads zero rows from all six, though the rows are about it');
  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from oversight_loans) + (select count(*) from oversight_buildings),
    0, '89d: Bramblewood''s session reads neither its loan nor its building');
  -- Its administrator holds neither key at the presbytery (RLS is tenancy;
  -- the keys are the authorization the application checks).
  select set_config('app.current_org_id', :NREACH, true);
  select assert_eq(
    (select count(*)
       from unnest(array['c0000000-0000-0000-0000-000000000002'::uuid]) p(id)
       cross join unnest(array['congregation_oversight.manage', 'congregation_oversight.finance']) k(key)
      where presby_has_permission(p.id, :NREACH, k.key)),
    0, '89d: Alder Creek''s stated clerk (Tobias Renwick) holds neither oversight key at the Northern Reach');
  select set_config('app.current_org_id', :SYNOD, true);
  select assert_eq(
    (select count(*) from oversight_buildings) + (select count(*) from oversight_loans),
    0, '89d: the Synod (the presbytery''s own council) reads none of the Northern Reach''s records (access flows up by publication only)');
  select assert_eq(
    (select count(*) from oversight_profiles where id = pg_temp.v('sp')),
    1, '89d: (control) the Synod sees its own row');
rollback;

-- ===========================================================================
-- (e) Composite keys: a child cannot name another congregation's building
-- ===========================================================================
begin;
  select pg_temp.t89_world();
  select pg_temp.t89_expect(
    format('insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (%L, %L, %L, 2023, 1, %L)',
           pg_temp.v('nr'), pg_temp.v('bramble'), pg_temp.v('b1'), pg_temp.v('u')),
    '23503', 'oversight_building_appraisals_building_fk', null,
    '89e: an appraisal about Bramblewood naming Alder Creek''s building is refused by the three-column FK');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('bramble'), pg_temp.v('b1'),
           pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.v('u')),
    '23503', 'oversight_building_photos_building_fk', null,
    '89e: a photo about Bramblewood naming Alder Creek''s building is refused by the three-column FK');
  select pg_temp.t89_expect(
    format('insert into oversight_loans (organization_id, about_org_id, building_id, kind, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('bramble'), pg_temp.v('b1'), 'other', pg_temp.v('u'), pg_temp.v('u')),
    '23503', 'oversight_loans_building_fk', null,
    '89e: a loan about Bramblewood linked to Alder Creek''s building is refused by the three-column FK');
  select pg_temp.t89_expect(
    format('update oversight_loans set building_id = %L where id = %L', pg_temp.v('b1'), pg_temp.v('la')),
    '23503', 'oversight_loans_building_fk', null,
    '89e: re-linking Bramblewood''s loan to Alder Creek''s building is refused too');
  select pg_temp.t89_ok(
    format('update oversight_loans set building_id = %L where id = %L', pg_temp.v('bb'), pg_temp.v('la')),
    '89e: (control) linking it to Bramblewood''s own building is accepted');
  select pg_temp.t89_ok(
    format('insert into oversight_loans (organization_id, about_org_id, kind, created_by, updated_by) values (%L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'other', pg_temp.v('u'), pg_temp.v('u')),
    '89e: a loan with no building at all is accepted (MATCH SIMPLE, T9)');
  select pg_temp.t89_expect(
    format('insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (%L, %L, %L, 2023, 1, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), gen_random_uuid(), pg_temp.v('u')),
    '23503', 'oversight_building_appraisals_building_fk', null,
    '89e: an appraisal of a building that does not exist is refused by the FK (the live guard leaves a miss to it)');
rollback;

-- ===========================================================================
-- (f) About-org: the record must be about a congregation affiliated today
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :WBASIN, true);
  select pg_temp.t89_expect(
    format('insert into oversight_profiles (organization_id, about_org_id, created_by, updated_by) values (%L, %L, %L, %L)',
           'f7000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%',
    '89f: the Western Basin cannot record a profile about Alder Creek (never affiliated; the 0045 trigger)');
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           'f7000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'T89 X', 'other',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%', '89f: ...nor a building');
  select pg_temp.t89_expect(
    format('insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (%L, %L, 2025, %L, %L)',
           'f7000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%', '89f: ...nor an insurance year');
  select pg_temp.t89_expect(
    format('insert into oversight_loans (organization_id, about_org_id, kind, created_by, updated_by) values (%L, %L, %L, %L, %L)',
           'f7000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'other',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%', '89f: ...nor a loan');
  -- Departed: Quillhaven was the Southern Fields' until the 1995 boundary change.
  select set_config('app.current_org_id', :SFIELDS, true);
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           'f6000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'T89 Q', 'other',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%',
    '89f: the Southern Fields cannot add a building about Quillhaven, which departed in 1995 (as of today, R9)');
  -- Affiliated today, unmanaged: accepted.
  select set_config('app.current_org_id', :NREACH, true);
  select pg_temp.t89_ok(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'T89 Quill chapel', 'other',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '89f: the Northern Reach records a building about Quillhaven (unmanaged, affiliated since 1995)');
  -- A presbytery about itself is not "about a member congregation".
  select pg_temp.t89_expect(
    format('insert into oversight_profiles (organization_id, about_org_id, created_by, updated_by) values (%L, %L, %L, %L)',
           '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
           'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'),
    '42501', null, '%was not affiliated with this council%', '89f: the Northern Reach cannot record a profile about itself');
rollback;

-- ===========================================================================
-- (g) Removal, immutability, the guards' insert rules, the partial uniques
-- ===========================================================================
begin;
  select pg_temp.t89_world();
  -- The guard's insert rules (non-owner).
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by, removed_at, removed_by) values (%L, %L, %L, %L, %L, %L, now(), %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'T89 born removed', 'other', pg_temp.v('u'), pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_insert_removed', null, '89g: a new building cannot start removed');
  select pg_temp.t89_expect(
    format('insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by, removed_at, removed_by) values (%L, %L, 2020, %L, %L, now(), %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('u'), pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_insert_removed', null, '89g: ...nor a new insurance year');
  insert into oversight_loans (organization_id, about_org_id, kind, created_at, created_by, updated_by)
  values (:NREACH, :ALDER, 'other', timestamptz '2001-01-01', :CLERK_U, :CLERK_U);
  select assert_eq(
    (select count(*) from oversight_loans where about_org_id = :ALDER and kind = 'other' and created_at > now() - interval '1 hour'),
    1, '89g: a tenant insert''s created_at is the server''s clock, not the value it supplied');

  -- 'imported' is the owner-run import's alone (orchestrator ruling,
  -- 2026-11-18; presby_oversight_guard_provenance).
  select pg_temp.t89_expect(
    format('insert into oversight_profiles (organization_id, about_org_id, provenance, created_by, updated_by) values (%L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('bramble'), 'imported', pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_provenance', null, '89g: a tenant cannot insert an imported profile');
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, provenance, created_by, updated_by) values (%L, %L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'T89 Imported', 'other', 'imported', pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_provenance', null, '89g: ...nor an imported building');
  select pg_temp.t89_expect(
    format('insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, provenance, created_by) values (%L, %L, %L, 2019, 1, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'), 'imported', pg_temp.v('u')),
    '23514', 'oversight_guard_provenance', null, '89g: ...nor an imported appraisal');
  select pg_temp.t89_expect(
    format('insert into oversight_insurance_years (organization_id, about_org_id, policy_year, provenance, created_by, updated_by) values (%L, %L, 2019, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'imported', pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_provenance', null, '89g: ...nor an imported insurance year');
  select pg_temp.t89_expect(
    format('insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'other', 'imported', pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_provenance', null, '89g: ...nor an imported loan');
  select pg_temp.t89_expect(
    format('update oversight_loans set provenance = %L where id = %L', 'imported', pg_temp.v('la')),
    '42501', null, '%permission denied%', '89g: a tenant cannot UPDATE a row to imported (the column grant refuses first)');
  select assert_eq(
    (select count(*) from oversight_loans where id = pg_temp.v('la') and provenance = 'presbytery_entered')
    + (select count(*) from oversight_buildings where id = pg_temp.v('b1') and provenance = 'presbytery_entered'),
    2, '89g: (control) a tenant insert left at the default is presbytery_entered');

  -- The column grant is presby_app's immutability (the guard proves the same
  -- on the owner path, oversight.db.test.ts).
  select pg_temp.t89_expect(
    format('update oversight_buildings set provenance = %L where id = %L', 'imported', pg_temp.v('b1')),
    '42501', null, '%permission denied%', '89g: presby_app cannot change a building''s provenance (column grant)');
  select pg_temp.t89_expect(
    format('update oversight_buildings set about_org_id = %L where id = %L', pg_temp.v('bramble'), pg_temp.v('b2')),
    '42501', null, '%permission denied%', '89g: ...nor move it to another congregation');
  select pg_temp.t89_expect(
    format('update oversight_building_appraisals set amount_cents = 1 where id = %L', pg_temp.v('ap')),
    '42501', null, '%permission denied%', '89g: ...nor edit an appraisal''s amount (T4: record and remove only)');
  select pg_temp.t89_expect(
    format('update oversight_insurance_years set policy_year = 2024 where id = %L', pg_temp.v('ia')),
    '42501', null, '%permission denied%', '89g: ...nor an insurance record''s policy year');
  select pg_temp.t89_expect(
    format('update oversight_profiles set about_org_id = %L where id = %L', pg_temp.v('bramble'), pg_temp.v('pa')),
    '42501', null, '%permission denied%', '89g: ...nor re-point a profile');
  select pg_temp.t89_expect(
    format('update oversight_building_photos set width = 5 where id = %L', pg_temp.v('ph')),
    '42501', null, '%permission denied%', '89g: ...nor change a photo''s size');
  select pg_temp.t89_expect(
    format('delete from oversight_buildings where id = %L', pg_temp.v('b2')),
    '42501', null, '%permission denied%', '89g: presby_app cannot DELETE a building (all deletes are soft)');
  select pg_temp.t89_expect(
    format('delete from oversight_profiles where id = %L', pg_temp.v('pa')),
    '42501', null, '%permission denied%', '89g: ...nor a profile');

  -- Removal is one-way.
  update oversight_buildings set removed_at = now(), removed_by = :CLERK_U where id = pg_temp.v('b2');
  select pg_temp.t89_expect(
    format('update oversight_buildings set name = %L where id = %L', 'T89 renamed', pg_temp.v('b2')),
    '23514', 'oversight_guard_removal_final', null, '89g: a removed building cannot change');
  select pg_temp.t89_expect(
    format('update oversight_buildings set removed_at = null, removed_by = null where id = %L', pg_temp.v('b2')),
    '23514', 'oversight_guard_removal_final', null, '89g: ...including being un-removed');
  select pg_temp.t89_expect(
    format('update oversight_buildings set removed_at = now() where id = %L', pg_temp.v('b1')),
    '23514', 'oversight_buildings_removal_pair', null, '89g: removal sets both halves of the pair');
  update oversight_building_appraisals set removed_at = now(), removed_by = :CLERK_U where id = pg_temp.v('ap');
  select pg_temp.t89_expect(
    format('update oversight_building_appraisals set removed_at = null, removed_by = null where id = %L', pg_temp.v('ap')),
    '23514', 'oversight_guard_removal_final', null, '89g: a removed appraisal cannot come back');
  update oversight_insurance_years set removed_at = now(), removed_by = :CLERK_U where id = pg_temp.v('ia');
  select pg_temp.t89_expect(
    format('update oversight_insurance_years set notes = %L where id = %L', 'x', pg_temp.v('ia')),
    '23514', 'oversight_guard_removal_final', null, '89g: a removed insurance year cannot change');
  update oversight_loans set removed_at = now(), removed_by = :CLERK_U where id = pg_temp.v('la');
  select pg_temp.t89_expect(
    format('update oversight_loans set lender = %L where id = %L', 'x', pg_temp.v('la')),
    '23514', 'oversight_guard_removal_final', null, '89g: a removed loan cannot change');
  update oversight_building_photos set removed_at = now(), removed_by = :CLERK_U where id = pg_temp.v('ph');
  select pg_temp.t89_expect(
    format('update oversight_building_photos set caption = %L where id = %L', 'x', pg_temp.v('ph')),
    '23514', 'oversight_guard_removal_final', null, '89g: a removed photo cannot change');

  -- The building-live guard: nothing new on a removed building (b2).
  select pg_temp.t89_expect(
    format('insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (%L, %L, %L, 2023, 1, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b2'), pg_temp.v('u')),
    '23514', 'oversight_guard_building_removed', null, '89g: no appraisal of a removed building');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b2'),
           pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.v('u')),
    '23514', 'oversight_guard_building_removed', null, '89g: no photo of a removed building');
  select pg_temp.t89_expect(
    format('insert into oversight_loans (organization_id, about_org_id, building_id, kind, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b2'), 'other', pg_temp.v('u'), pg_temp.v('u')),
    '23514', 'oversight_guard_building_removed', null, '89g: no loan linked to a removed building');

  -- Partial uniques. Live name (case-insensitive) refused; a removed name reusable.
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 't89 SANCTUARY', 'other', pg_temp.v('u'), pg_temp.v('u')),
    '23505', 'oversight_buildings_live_name_idx', null, '89g: a second live building of the same name (any case) is refused');
  select pg_temp.t89_ok(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'T89 Annex', 'annex', pg_temp.v('u'), pg_temp.v('u')),
    '89g: a removed building''s name is reusable');
  select pg_temp.t89_ok(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('bramble'), 'T89 Sanctuary', 'sanctuary', pg_temp.v('u'), pg_temp.v('u')),
    '89g: the same name at another congregation is fine');
  select pg_temp.t89_expect(
    format('insert into oversight_buildings (organization_id, about_org_id, name, building_type, is_primary, created_by, updated_by) values (%L, %L, %L, %L, true, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), 'T89 Second primary', 'other', pg_temp.v('u'), pg_temp.v('u')),
    '23505', 'oversight_buildings_one_primary_idx', null, '89g: a second live primary per congregation is refused');
  select pg_temp.t89_expect(
    format('update oversight_buildings set retired_on = current_date, retired_reason = %L where id = %L', 'sold', pg_temp.v('b1')),
    '23514', 'oversight_buildings_primary_not_retired', null, '89g: the primary building cannot be retired while primary');
  select pg_temp.t89_ok(
    format('update oversight_buildings set retired_on = current_date, retired_reason = %L, is_primary = false where id = %L', 'sold', pg_temp.v('b1')),
    '89g: retiring and clearing primary in one update is accepted');
  select pg_temp.t89_ok(
    format('update oversight_buildings set retired_on = null, retired_reason = null where id = %L', pg_temp.v('b1')),
    '89g: retire is reversible (T6)');
  -- Insurance: one live per year; a removed year (ia, 2025) is reusable.
  select pg_temp.t89_ok(
    format('insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (%L, %L, 2025, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('u'), pg_temp.v('u')),
    '89g: a removed insurance year is reusable');
  select pg_temp.t89_expect(
    format('insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (%L, %L, 2025, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('u'), pg_temp.v('u')),
    '23505', 'oversight_insurance_years_live_year_idx', null, '89g: a second live record for the same congregation-year is refused');
  -- Appraisals: one live per building-year; the removed 2024 is reusable.
  select pg_temp.t89_ok(
    format('insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (%L, %L, %L, 2024, 5, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'), pg_temp.v('u')),
    '89g: a removed appraisal year is reusable');
  select pg_temp.t89_expect(
    format('insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (%L, %L, %L, 2024, 6, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'), pg_temp.v('u')),
    '23505', 'oversight_building_appraisals_live_year_idx', null, '89g: a second live appraisal for the same building-year is refused');
  -- Photos: one live cover per building; one live copy of an image per building.
  insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, is_cover, created_by)
  values (:NREACH, :ALDER, pg_temp.v('b1'), pg_temp.t89_blob(:NREACH, 'private'), pg_temp.t89_blob(:NREACH, 'private'), 10, 10, true, :CLERK_U);
  select set_config('t89.img2', (select pg_temp.t89_blob(:NREACH, 'private'))::text, true);
  select set_config('t89.thumb2', (select pg_temp.t89_blob(:NREACH, 'private'))::text, true);
  select pg_temp.t89_ok(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'), pg_temp.v('img2'), pg_temp.v('thumb2'), pg_temp.v('u')),
    '89g: (control) a second, non-cover photo is accepted');
  select pg_temp.t89_expect(
    format('update oversight_building_photos set is_cover = true where image_asset_key = %L', pg_temp.v('img2')),
    '23505', 'oversight_building_photos_one_cover_idx', null, '89g: a second live cover per building is refused');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'), pg_temp.v('img2'), pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.v('u')),
    '23505', 'oversight_building_photos_live_image_idx', null, '89g: the same image twice on one building is refused (already there)');
  -- Profile: one per (presbytery, congregation).
  select pg_temp.t89_expect(
    format('insert into oversight_profiles (organization_id, about_org_id, created_by, updated_by) values (%L, %L, %L, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('u'), pg_temp.v('u')),
    '23505', 'oversight_profiles_org_about_key', null, '89g: a second profile for the same congregation is refused');
rollback;

-- ===========================================================================
-- (h) The public-site door never serves a building photo
-- ===========================================================================
begin;
  select pg_temp.t89_world();
  select assert_eq(
    (select count(*) from presby_public_site_asset(:NREACH, pg_temp.v('img')))
    + (select count(*) from presby_public_site_asset(:NREACH, pg_temp.v('thumb'))),
    0, '89h: presby_public_site_asset() returns nothing for a building photo''s image or thumbnail key');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, asset_audience, width, height, created_by) values (%L, %L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'),
           pg_temp.t89_blob(pg_temp.v('nr'), 'public_site'), pg_temp.t89_blob(pg_temp.v('nr'), 'public_site'), 'public_site', pg_temp.v('u')),
    '23514', 'oversight_building_photos_audience_private', null, '89h: a photo row cannot be public_site');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'),
           pg_temp.t89_blob(pg_temp.v('nr'), 'public_site'), pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.v('u')),
    '23503', 'oversight_building_photos_image_fk', null, '89h: a private photo row cannot point at a public_site blob (image)');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'),
           pg_temp.t89_blob(pg_temp.v('nr'), 'private'), pg_temp.t89_blob(pg_temp.v('nr'), 'public_site'), pg_temp.v('u')),
    '23503', 'oversight_building_photos_thumb_fk', null, '89h: ...nor its thumbnail');
  select pg_temp.t89_expect(
    format('insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (%L, %L, %L, %L, %L, 10, 10, %L)',
           pg_temp.v('nr'), pg_temp.v('alder'), pg_temp.v('b1'), pg_temp.v('img'), pg_temp.v('img'), pg_temp.v('u')),
    '23514', 'oversight_building_photos_distinct_assets', null, '89h: image and thumbnail are distinct blobs');
rollback;

-- ===========================================================================
-- (i) CHECK boundaries
-- ===========================================================================
begin;
  select pg_temp.t89_world();
  create temp table t89_cases (n serial, label text, stmt text, ok boolean, con text) on commit drop;
  insert into t89_cases (label, stmt, ok, con) values
    -- years (1600..2100)
    ('profile year_organized 1599', 'update oversight_profiles set year_organized = 1599 where id = ''%pa%''', false, 'oversight_profiles_year_organized_range'),
    ('profile year_organized 1600', 'update oversight_profiles set year_organized = 1600 where id = ''%pa%''', true, null),
    ('profile year_organized 2100', 'update oversight_profiles set year_organized = 2100 where id = ''%pa%''', true, null),
    ('profile year_organized 2101', 'update oversight_profiles set year_organized = 2101 where id = ''%pa%''', false, 'oversight_profiles_year_organized_range'),
    ('building year_built 1599', 'update oversight_buildings set year_built = 1599 where id = ''%bb%''', false, 'oversight_buildings_year_built_range'),
    ('building year_built 2101', 'update oversight_buildings set year_built = 2101 where id = ''%bb%''', false, 'oversight_buildings_year_built_range'),
    ('building year_built 1900', 'update oversight_buildings set year_built = 1900 where id = ''%bb%''', true, null),
    ('first addition before built', 'update oversight_buildings set first_addition_year = 1899 where id = ''%bb%''', false, 'oversight_buildings_first_addition_order'),
    ('first addition 1950', 'update oversight_buildings set first_addition_year = 1950 where id = ''%bb%''', true, null),
    ('second addition before first', 'update oversight_buildings set second_addition_year = 1949 where id = ''%bb%''', false, 'oversight_buildings_second_addition_order'),
    ('second addition 1980', 'update oversight_buildings set second_addition_year = 1980 where id = ''%bb%''', true, null),
    ('policy_year 1899', 'insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (''%nr%'', ''%bramble%'', 1899, ''%u%'', ''%u%'')', false, 'oversight_insurance_years_policy_year_range'),
    ('policy_year 1900', 'insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (''%nr%'', ''%bramble%'', 1900, ''%u%'', ''%u%'')', true, null),
    ('policy_year 2101', 'insert into oversight_insurance_years (organization_id, about_org_id, policy_year, created_by, updated_by) values (''%nr%'', ''%bramble%'', 2101, ''%u%'', ''%u%'')', false, 'oversight_insurance_years_policy_year_range'),
    ('assessed_year 1599', 'insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (''%nr%'', ''%bramble%'', ''%bb%'', 1599, 0, ''%u%'')', false, 'oversight_building_appraisals_assessed_year_range'),
    -- money (0..100,000,000,000 cents)
    ('appraisal 0 cents', 'insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (''%nr%'', ''%bramble%'', ''%bb%'', 2001, 0, ''%u%'')', true, null),
    ('appraisal max', 'insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (''%nr%'', ''%bramble%'', ''%bb%'', 2002, 100000000000, ''%u%'')', true, null),
    ('appraisal max+1', 'insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (''%nr%'', ''%bramble%'', ''%bb%'', 2003, 100000000001, ''%u%'')', false, 'oversight_building_appraisals_amount_range'),
    ('appraisal -1', 'insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by) values (''%nr%'', ''%bramble%'', ''%bb%'', 2004, -1, ''%u%'')', false, 'oversight_building_appraisals_amount_range'),
    ('loan original max+1', 'update oversight_loans set original_amount_cents = 100000000001 where id = ''%la%''', false, 'oversight_loans_original_amount_range'),
    ('loan grants -1', 'update oversight_loans set grants_amount_cents = -1 where id = ''%la%''', false, 'oversight_loans_grants_amount_range'),
    ('loan balance max', 'update oversight_loans set current_balance_cents = 100000000000 where id = ''%la%''', true, null),
    ('loan balance max+1', 'update oversight_loans set current_balance_cents = 100000000001 where id = ''%la%''', false, 'oversight_loans_current_balance_range'),
    -- square feet (1..5,000,000)
    ('square feet 0', 'update oversight_buildings set square_feet = 0 where id = ''%bb%''', false, 'oversight_buildings_square_feet_range'),
    ('square feet 1', 'update oversight_buildings set square_feet = 1 where id = ''%bb%''', true, null),
    ('square feet 5000000', 'update oversight_buildings set square_feet = 5000000 where id = ''%bb%''', true, null),
    ('square feet 5000001', 'update oversight_buildings set square_feet = 5000001 where id = ''%bb%''', false, 'oversight_buildings_square_feet_range'),
    -- lengths
    ('name empty', 'update oversight_buildings set name = '''' where id = ''%bb%''', false, 'oversight_buildings_name_length'),
    ('name 120', 'update oversight_buildings set name = repeat(''n'', 120) where id = ''%bb%''', true, null),
    ('name 121', 'update oversight_buildings set name = repeat(''n'', 121) where id = ''%bb%''', false, 'oversight_buildings_name_length'),
    ('building notes 4001', 'update oversight_buildings set notes = repeat(''x'', 4001) where id = ''%bb%''', false, 'oversight_buildings_notes_length'),
    ('street address 501', 'update oversight_profiles set street_address = repeat(''x'', 501) where id = ''%pa%''', false, 'oversight_profiles_street_address_length'),
    ('street address 500', 'update oversight_profiles set street_address = repeat(''x'', 500) where id = ''%pa%''', true, null),
    ('city 101', 'update oversight_profiles set city = repeat(''x'', 101) where id = ''%pa%''', false, 'oversight_profiles_city_length'),
    ('county 101', 'update oversight_profiles set county = repeat(''x'', 101) where id = ''%pa%''', false, 'oversight_profiles_county_length'),
    ('phone 41', 'update oversight_profiles set phone = repeat(''5'', 41) where id = ''%pa%''', false, 'oversight_profiles_phone_length'),
    ('carrier 201', 'update oversight_insurance_years set carrier = repeat(''x'', 201) where id = ''%ia%''', false, 'oversight_insurance_years_carrier_length'),
    ('policy number 101', 'update oversight_insurance_years set policy_number = repeat(''x'', 101) where id = ''%ia%''', false, 'oversight_insurance_years_policy_number_length'),
    ('insurance notes 2001', 'update oversight_insurance_years set notes = repeat(''x'', 2001) where id = ''%ia%''', false, 'oversight_insurance_years_notes_length'),
    ('lender 201', 'update oversight_loans set lender = repeat(''x'', 201) where id = ''%la%''', false, 'oversight_loans_lender_length'),
    ('guarantee 1001', 'update oversight_loans set guarantee_note = repeat(''x'', 1001) where id = ''%la%''', false, 'oversight_loans_guarantee_note_length'),
    ('loan notes 2001', 'update oversight_loans set notes = repeat(''x'', 2001) where id = ''%la%''', false, 'oversight_loans_notes_length'),
    ('caption 201', 'update oversight_building_photos set caption = repeat(''x'', 201) where id = ''%ph%''', false, 'oversight_building_photos_caption_length'),
    ('caption 200', 'update oversight_building_photos set caption = repeat(''x'', 200) where id = ''%ph%''', true, null),
    ('appraisal notes 1001', 'insert into oversight_building_appraisals (organization_id, about_org_id, building_id, assessed_year, amount_cents, notes, created_by) values (''%nr%'', ''%bramble%'', ''%bb%'', 2010, 1, repeat(''x'', 1001), ''%u%'')', false, 'oversight_building_appraisals_notes_length'),
    -- closed lists and pairs
    ('building type unknown', 'update oversight_buildings set building_type = ''castle'' where id = ''%bb%''', false, 'oversight_buildings_building_type'),
    ('condition unknown', 'update oversight_buildings set roof_condition = ''excellent'' where id = ''%bb%''', false, 'oversight_buildings_roof_condition'),
    ('condition poor', 'update oversight_buildings set roof_condition = ''poor'', hvac_condition = ''good'' where id = ''%bb%''', true, null),
    ('retired without reason', 'update oversight_buildings set retired_on = current_date where id = ''%bb%''', false, 'oversight_buildings_retired_pair'),
    ('retire reason unknown', 'update oversight_buildings set retired_on = current_date, retired_reason = ''lost'' where id = ''%bb%''', false, 'oversight_buildings_retired_reason'),
    ('loan kind unknown', 'update oversight_loans set kind = ''mortgage'' where id = ''%la%''', false, 'oversight_loans_kind'),
    ('loan balance without as-of', 'update oversight_loans set balance_as_of = null where id = ''%la%''', false, 'oversight_loans_balance_pair'),
    ('loan paid off without date', 'update oversight_loans set status = ''paid_off'' where id = ''%la%''', false, 'oversight_loans_paid_off_pair'),
    ('loan open with a date', 'update oversight_loans set paid_off_on = current_date where id = ''%la%''', false, 'oversight_loans_paid_off_pair'),
    ('loan status unknown', 'update oversight_loans set status = ''defaulted'' where id = ''%la%''', false, 'oversight_loans_status'),
    ('loan paid off', 'update oversight_loans set status = ''paid_off'', paid_off_on = current_date, current_balance_cents = 0, balance_as_of = current_date where id = ''%la%''', true, null),
    ('loan reopened', 'update oversight_loans set status = ''open'', paid_off_on = null where id = ''%la%''', true, null),
    ('row_version 0', 'update oversight_loans set row_version = 0 where id = ''%la%''', false, 'oversight_loans_row_version_positive'),
    ('photo width 2001', 'insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by) values (''%nr%'', ''%alder%'', ''%b1%'', ''%img3%'', ''%thumb3%'', 2001, 10, ''%u%'')', false, 'oversight_building_photos_dimensions'),
    -- On the tenant path the provenance guard (BEFORE) refuses anything but
    -- presbytery_entered before the CHECK is reached; the CHECK itself is
    -- proven on the owner path (oversight.db.test.ts).
    ('provenance unknown', 'insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (''%nr%'', ''%alder%'', ''other'', ''guessed'', ''%u%'', ''%u%'')', false, 'oversight_guard_provenance'),
    ('provenance imported', 'insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (''%nr%'', ''%alder%'', ''other'', ''imported'', ''%u%'', ''%u%'')', false, 'oversight_guard_provenance'),
    ('provenance explicit default', 'insert into oversight_loans (organization_id, about_org_id, kind, provenance, created_by, updated_by) values (''%nr%'', ''%alder%'', ''other'', ''presbytery_entered'', ''%u%'', ''%u%'')', true, null);
  select set_config('t89.img3', (select pg_temp.t89_blob(:NREACH, 'private'))::text, true);
  select set_config('t89.thumb3', (select pg_temp.t89_blob(:NREACH, 'private'))::text, true);
  do $$
  declare
    c record;
    s text;
    k text;
    n integer := 0;
  begin
    for c in select * from t89_cases order by n loop
      s := c.stmt;
      foreach k in array array['pa', 'bb', 'b1', 'ia', 'la', 'ph', 'nr', 'alder', 'bramble', 'u', 'img3', 'thumb3'] loop
        s := replace(s, '%' || k || '%', pg_temp.v(k)::text);
      end loop;
      if c.ok then
        perform pg_temp.t89_ok(s, '89i: ' || c.label || ' accepted');
      else
        perform pg_temp.t89_expect(s, '23514', c.con, null, '89i: ' || c.label || ' refused');
      end if;
      n := n + 1;
    end loop;
    raise notice 'pass  89i: % boundary cases', n;
  end $$;
rollback;

\echo '======================================================'
\echo ' Section 89 (congregation records) complete.'
\echo '======================================================'
