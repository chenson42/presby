-- ---------------------------------------------------------------------------
-- 78. Person photos (drizzle/0078_presby_person_photos.sql; DECISION-285,
--     286, 289; docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3
--     "Test Plan" R78a-g).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains its section-78 banner
--     and ONE include at its end (docs/work-log/
--     person-photos-inc1.integration.patch):
--
--         \ir person-photos/test-rls-78.sql
--
--     Standalone (MUST be presby_app - the owner bypasses RLS and holds every
--     privilege by ownership, so as the owner most of this proves nothing):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/person-photos/test-rls-78.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs only the stock
--     scripts/seed-dev.sql fixture (Northern Reach, Alder Creek; no seed
--     change). Every block that writes ends in rollback, so it writes nothing
--     durable; the pg_temp helpers vanish with the session and are dropped at
--     the end.
--
--     Alder Creek's site is `provisioning` and presby_app holds no grant on
--     organization_sites (DECISION-081), so the roster functions and the door
--     list nobody there (78e premise). The R3/R5 matrix is therefore asked
--     through presby_person_public_photo_status() - the SAME definer core the
--     roster functions project - and presby_person_directory_photo(). The
--     live-site roster and door positives (a listed photo served, a thumbnail
--     never served, removal stops serving) are on real connections in
--     src/lib/db/domain/public-roster-photo.db.test.ts and
--     src/lib/storage/public-asset.db.test.ts. What presby_app cannot reach -
--     the guards binding the OWNER, the FK behind each guard, and organization
--     deletion - is src/lib/db/domain/person-photos.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P78_NREACH  '\'11111111-1111-1111-1111-111111111111\''
\set P78_ALDER   '\'22222222-2222-2222-2222-222222222222\''
\set P78_USER    '\'e0000000-0000-0000-0000-0000000000f3\''
\set P78_MARG    '\'c0000000-0000-0000-0000-000000000001\''
\set P78_TOBIAS  '\'c0000000-0000-0000-0000-000000000002\''
\set P78_PRIYA   '\'c0000000-0000-0000-0000-000000000003\''
\set P78_DESMOND '\'c0000000-0000-0000-0000-000000000004\''
\set P78_HALLIE  '\'c0000000-0000-0000-0000-000000000005\''
\set P78_ROWAN   '\'c0000000-0000-0000-0000-000000000006\''
\set P78_ALDOUS  '\'c0000000-0000-0000-0000-000000000007\''
\set P78_WREN    '\'c0000000-0000-0000-0000-000000000008\''
\set P78_MARISOL '\'c0000000-0000-0000-0000-000000000009\''
\set P78_IDRIS   '\'c0000000-0000-0000-0000-00000000000a\''

\echo '======================================================'
\echo ' Section 78 (person photos, drizzle/0078) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '78: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) R78a catalog: FORCE RLS, the policy, grants, CHECKs, indexes, FKs,
--     triggers, the retirement CHECK, and the functions' shape and ACLs.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class
      where relname in ('person_photos', 'person_photo_designations') and relkind = 'r'
        and relrowsecurity and relforcerowsecurity),
    2, '78a: both tables have row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename in ('person_photos', 'person_photo_designations')),
    2, '78a: exactly one policy per table');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename in ('person_photos', 'person_photo_designations')
        and policyname = 'tenant_isolation' and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    2, '78a: the policy is tenant_isolation, ALL commands, USING and WITH CHECK on presby_current_org()');
  select assert_eq(
    (select count(*) from (values
        ('person_photos', 'SELECT', true), ('person_photos', 'INSERT', true),
        ('person_photos', 'UPDATE', false), ('person_photos', 'DELETE', false),
        ('person_photos', 'TRUNCATE', false), ('person_photos', 'REFERENCES', false), ('person_photos', 'TRIGGER', false),
        ('person_photo_designations', 'SELECT', true), ('person_photo_designations', 'INSERT', true),
        ('person_photo_designations', 'UPDATE', false), ('person_photo_designations', 'DELETE', false),
        ('person_photo_designations', 'TRUNCATE', false), ('person_photo_designations', 'REFERENCES', false),
        ('person_photo_designations', 'TRIGGER', false)) v(t, p, want)
      where has_table_privilege('presby_app', v.t, v.p) = v.want),
    14, '78a: presby_app holds table-level SELECT and INSERT only (no UPDATE, no DELETE, nothing else)');
  select assert_eq(
    (select count(*) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name in ('person_photos', 'person_photo_designations')
        and has_column_privilege('presby_app', c.table_name, c.column_name, 'UPDATE')
            = ((c.table_name = 'person_photos' and c.column_name in ('removed_at', 'removed_by'))
               or (c.table_name = 'person_photo_designations' and c.column_name in ('ended_at', 'ended_by')))),
    (select count(*) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name in ('person_photos', 'person_photo_designations')),
    '78a: presby_app may UPDATE exactly the removal pair and the end pair, and no other column');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname in ('person_photos', 'person_photo_designations')
        and a.grantee not in (c.relowner, 'presby_app'::regrole::oid)),
    0, '78a: nobody but the owner and presby_app holds any privilege (presby_platform and PUBLIC hold nothing)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'c' and c.convalidated
        and ((c.conrelid = 'person_photos'::regclass and (c.conname, pg_get_constraintdef(c.oid)) in (
               ('person_photos_audience_private', 'CHECK ((asset_audience = ''private''::text))'),
               ('person_photos_distinct_assets', 'CHECK ((image_asset_key <> thumb_asset_key))'),
               ('person_photos_dimensions', 'CHECK ((((width >= 1) AND (width <= 2000)) AND ((height >= 1) AND (height <= 2000))))'),
               ('person_photos_removal_pair', 'CHECK (((removed_at IS NULL) = (removed_by IS NULL)))')))
          or (c.conrelid = 'person_photo_designations'::regclass and (c.conname, pg_get_constraintdef(c.oid)) in (
               ('person_photo_designations_purpose', 'CHECK ((purpose = ANY (ARRAY[''directory''::text, ''website''::text])))'),
               ('person_photo_designations_attest_pair', 'CHECK (((public_attested_at IS NULL) = (public_attested_by IS NULL)))'),
               ('person_photo_designations_website_attested', 'CHECK (((purpose <> ''website''::text) OR (public_attested_at IS NOT NULL)))'),
               ('person_photo_designations_end_pair', 'CHECK (((ended_at IS NULL) = (ended_by IS NULL)))')))
          or (c.conrelid = 'people'::regclass and (c.conname, pg_get_constraintdef(c.oid)) in (
               ('people_photo_key_retired', 'CHECK (((photo_key IS NULL) AND (photo_updated_at IS NULL)))'))))),
    9, '78a: the eight CHECKs and people_photo_key_retired exist, VALIDATED, with the exact predicate');
  select assert_eq(
    (select count(*) from pg_indexes where (indexname, indexdef) in (
       ('person_photos_active_image_idx', 'CREATE UNIQUE INDEX person_photos_active_image_idx ON public.person_photos USING btree (organization_id, person_id, image_asset_key) WHERE (removed_at IS NULL)'),
       ('person_photo_designations_active_idx', 'CREATE UNIQUE INDEX person_photo_designations_active_idx ON public.person_photo_designations USING btree (organization_id, person_id, purpose) WHERE (ended_at IS NULL)'),
       ('person_photos_image_key_idx', 'CREATE INDEX person_photos_image_key_idx ON public.person_photos USING btree (organization_id, image_asset_key)'),
       ('person_photos_thumb_key_idx', 'CREATE INDEX person_photos_thumb_key_idx ON public.person_photos USING btree (organization_id, thumb_asset_key)'),
       ('person_photo_designations_photo_idx', 'CREATE INDEX person_photo_designations_photo_idx ON public.person_photo_designations USING btree (organization_id, photo_id)'))),
    5, '78a: the two partial uniques (one active image per person, one active designation per purpose) and the three lookup indexes');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.convalidated and c.confdeltype = 'a' and c.confupdtype = 'a'
        and (c.conname, c.confrelid::regclass::text,
             (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum),
             (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)) in (
          ('person_photos_person_fk', 'memberships', 'person_id,organization_id', 'person_id,organization_id'),
          ('person_photos_image_fk', 'blob_assets', 'image_asset_key,organization_id,asset_audience', 'id,organization_id,audience'),
          ('person_photos_thumb_fk', 'blob_assets', 'thumb_asset_key,organization_id,asset_audience', 'id,organization_id,audience'),
          ('person_photo_designations_photo_fk', 'person_photos', 'photo_id,organization_id,person_id', 'id,organization_id,person_id'))),
    4, '78a: the four composite FKs, column for column, NO ACTION both ways, validated (Composite Tenant Keys, F2)');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgenabled = 'O'
        and (t.tgname, pg_get_triggerdef(t.oid)) in (
          ('person_photos_guard_write', 'CREATE TRIGGER person_photos_guard_write BEFORE INSERT OR UPDATE ON public.person_photos FOR EACH ROW EXECUTE FUNCTION presby_person_photos_guard_write()'),
          ('person_photo_designations_guard_write', 'CREATE TRIGGER person_photo_designations_guard_write BEFORE INSERT OR UPDATE ON public.person_photo_designations FOR EACH ROW EXECUTE FUNCTION presby_person_photo_designations_guard_write()'))),
    2, '78a: both guard triggers are enabled, BEFORE INSERT OR UPDATE, row level');
  select assert_eq(
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgrelid in ('person_photos'::regclass, 'person_photo_designations'::regclass)),
    2, '78a: and there is no other (e.g. no DELETE guard - the 0049/0064 residual; presby_app has no DELETE at all)');
rollback;

-- R78g function privileges.
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proconfig = array['search_path=public, pg_temp']
        and (p.proname, p.prosecdef) in (
          ('presby_person_photos_enabled', false), ('presby_photo_subject_is_minor', false),
          ('presby_person_public_photo', true), ('presby_person_public_photo_status', true),
          ('presby_person_directory_photo', false),
          ('presby_person_photos_guard_write', false), ('presby_person_photo_designations_guard_write', false),
          ('presby_public_staff_roster', true), ('presby_public_committee_roster', true),
          ('presby_public_site_asset', true))),
    10, '78g: the ten functions 0078 creates or replaces pin search_path; definer exactly where designed');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_person_photos_enabled', 'presby_photo_subject_is_minor', 'presby_person_public_photo_status',
                          'presby_person_directory_photo', 'presby_public_staff_roster', 'presby_public_committee_roster',
                          'presby_public_site_asset')
        and (select array_agg(a.grantee order by a.grantee) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = (select array_agg(x order by x) from unnest(array[p.proowner, 'presby_app'::regrole::oid]) x)),
    7, '78g: seven are executable by the owner and presby_app ALONE (no PUBLIC, no presby_platform)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_person_public_photo', 'presby_person_photos_guard_write', 'presby_person_photo_designations_guard_write')
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)),
    3, '78g: the public core and both trigger functions are executable by their owner ALONE');
  select assert_eq(
    (select count(*) from (values
        ('presby_person_photos_enabled(uuid)', true), ('presby_photo_subject_is_minor(uuid,uuid)', true),
        ('presby_person_public_photo(uuid,uuid)', false), ('presby_person_public_photo_status(uuid)', true),
        ('presby_person_directory_photo(uuid,uuid)', true),
        ('presby_person_photos_guard_write()', false), ('presby_person_photo_designations_guard_write()', false)) v(f, want)
      where has_function_privilege('presby_app', v.f, 'execute') = v.want),
    7, '78g: presby_app may call the four helpers it needs and not the core or the trigger functions');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_public_staff_roster', 'presby_public_committee_roster', 'presby_public_site_asset')
        and (p.prosrc ~ '\m(p|pe)\.photo_key\M' or p.prosrc ~ '\mperson_privacy\M')),
    0, '78g: no roster or door body reads people.photo_key or joins person_privacy any more (R5, correction 3)');
rollback;

-- R78f: 0072's catalog rule still holds with the two new FKs into blob_assets.
begin;
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass
        and c.conname not in ('organization_brands_mark_asset_fk', 'organization_brands_wordmark_asset_fk',
                              'organization_sites_content_bundle_fk')
        and not exists (
          select 1 from unnest(c.conkey) k(attnum)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
           where a.attname = 'asset_audience'
             and exists (select 1 from pg_constraint ck
                          where ck.conrelid = c.conrelid and ck.contype = 'c' and ck.convalidated
                            and pg_get_constraintdef(ck.oid) = 'CHECK ((asset_audience = ''private''::text))'))),
    0, '78f: (72b, unchanged) every FK into blob_assets is on the public allowlist or pins asset_audience = ''private''');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass
        and c.conname in ('person_photos_image_fk', 'person_photos_thumb_fk')),
    2, '78f: (not vacuous) both person-photo FKs are among those 72b examines');
rollback;

-- ---------------------------------------------------------------------------
-- Session helpers (pg_temp, so presby_app may create them; they run as
-- presby_app, under RLS, with presby_app's grants - nothing is borrowed).
-- ---------------------------------------------------------------------------
create or replace function pg_temp.p78_blob(p_org uuid, p_label text, p_type text default 'image/webp', p_audience text default 'private')
returns uuid language sql as $$
  insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
  values (p_org, encode(sha256(convert_to('p78 ' || p_label, 'UTF8')), 'hex'), p_type, 4, '\x52494646'::bytea, p_audience)
  returning id;
$$;

create or replace function pg_temp.p78_photo(p_org uuid, p_person uuid, p_label text)
returns uuid language sql as $$
  insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
  values (p_org, p_person, pg_temp.p78_blob(p_org, p_label || ' image', 'image/jpeg'),
          pg_temp.p78_blob(p_org, p_label || ' thumb'), 800, 1000, 'e0000000-0000-0000-0000-0000000000f3')
  returning id;
$$;

create or replace function pg_temp.p78_designate(p_org uuid, p_person uuid, p_photo uuid, p_purpose text, p_attested boolean)
returns uuid language sql as $$
  insert into person_photo_designations (organization_id, person_id, photo_id, purpose,
                                         public_attested_at, public_attested_by, designated_by)
  values (p_org, p_person, p_photo, p_purpose,
          case when p_attested then now() end,
          case when p_attested then 'e0000000-0000-0000-0000-0000000000f3'::uuid end,
          'e0000000-0000-0000-0000-0000000000f3')
  returning id;
$$;

-- Pre-existing data must not change an answer: end every active designation in
-- the current org's view (inside the caller's rolled-back transaction).
create or replace function pg_temp.p78_clear()
returns void language sql as $$
  update person_photo_designations set ended_at = now(), ended_by = 'e0000000-0000-0000-0000-0000000000f3'
   where ended_at is null;
$$;

-- presby_app's view of the R3 core for the current org: "<withheld>|<source>|<image is the expected key>".
create or replace function pg_temp.p78_pub(p_person uuid, p_expect uuid)
returns text language sql as $$
  select coalesce(string_agg(coalesce(s.withheld, '-') || '|' || coalesce(s.source, '-') || '|'
                             || case when s.image_key is null then 'null'
                                     when s.image_key = p_expect then 'expected' else 'OTHER' end, ';'), 'none')
    from presby_person_public_photo_status(p_person) s;
$$;

-- The directory function for the current org: "<withheld>|<thumb is the expected thumb>".
create or replace function pg_temp.p78_dir(p_person uuid, p_photo uuid)
returns text language sql as $$
  select coalesce(string_agg(coalesce(d.withheld, '-') || '|'
                             || case when d.thumb_key is null then 'null'
                                     when d.thumb_key = (select thumb_asset_key from person_photos where id = p_photo)
                                          and d.photo_id = p_photo then 'expected'
                                     else 'OTHER' end, ';'), 'none')
    from presby_person_directory_photo(presby_current_org(), p_person) d;
$$;

-- ===========================================================================
-- (b) R78b isolation: Northern Reach's photo set for a person both orgs share
--     is invisible to, and unwritable from, Alder Creek.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P78_NREACH, true);
  select pg_temp.p78_clear();
  select set_config('p78.n1', pg_temp.p78_photo(:P78_NREACH, :P78_ROWAN, 'b n1')::text, true);
  select pg_temp.p78_designate(:P78_NREACH, :P78_ROWAN, current_setting('p78.n1')::uuid, 'website', true);
  select assert_eq(
    (select count(*) from person_photos where id = current_setting('p78.n1')::uuid)
    + (select count(*) from person_photo_designations where photo_id = current_setting('p78.n1')::uuid),
    2, '78b: (premise) Northern Reach sees its own photo and designation of Rowan');

  select set_config('app.current_org_id', :P78_ALDER, true);
  select assert_eq(
    (select count(*) from person_photos where organization_id = :P78_NREACH or id = current_setting('p78.n1')::uuid)
    + (select count(*) from person_photo_designations where organization_id = :P78_NREACH),
    0, '78b: Alder Creek sees zero of Northern Reach''s photo rows for a person both orgs share');
  do $$
  declare v_n integer;
  begin
    update person_photos set removed_at = now(), removed_by = 'e0000000-0000-0000-0000-0000000000f3'
     where id = current_setting('p78.n1')::uuid;
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception 'FAIL 78b - Alder removed Northern Reach''s photo (% rows)', v_n; end if;
    update person_photo_designations set ended_at = now(), ended_by = 'e0000000-0000-0000-0000-0000000000f3'
     where organization_id = '11111111-1111-1111-1111-111111111111';
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception 'FAIL 78b - Alder ended Northern Reach''s designation (% rows)', v_n; end if;
    raise notice 'pass  78b: Alder''s removal and ending of Northern Reach''s rows touch zero rows (RLS USING)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
    select '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000006',
           gen_random_uuid(), gen_random_uuid(), 10, 10, 'e0000000-0000-0000-0000-0000000000f3';
    raise exception 'FAIL 78b - presby_app inserted a photo into another org';
  exception when insufficient_privilege then
    if sqlerrm not like '%row-level security policy%' then raise; end if;
    raise notice 'pass  78b: a photo row carrying Northern Reach''s id, inserted under Alder''s context, is refused by WITH CHECK';
  end $$;
  do $$
  begin
    insert into person_photo_designations (organization_id, person_id, photo_id, purpose, designated_by)
    values ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000006',
            current_setting('p78.n1')::uuid, 'directory', 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 78b - presby_app designated another org''s photo';
  exception when check_violation then
    if sqlerrm not like '%is removed, or is not this person''s photo in this organization%' then raise; end if;
    raise notice 'pass  78b: a designation of Northern Reach''s photo from Alder is refused (the guard cannot see it; WITH CHECK would refuse next)';
  end $$;
rollback;

-- ===========================================================================
-- (c) R78c unrepresentable states (Alder Creek). Each refusal names its
--     mechanism; the FK BEHIND each guard is proven on the owner path in
--     person-photos.db.test.ts (guard disabled inside a rolled-back
--     transaction).
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P78_ALDER, true);
  select pg_temp.p78_clear();
  select set_config('p78.m1', pg_temp.p78_photo(:P78_ALDER, :P78_MARG, 'c m1')::text, true);
  select set_config('p78.t1', pg_temp.p78_photo(:P78_ALDER, :P78_TOBIAS, 'c t1')::text, true);
  -- A Northern Reach blob, made under its own context.
  select set_config('app.current_org_id', :P78_NREACH, true);
  select set_config('p78.nblob', pg_temp.p78_blob(:P78_NREACH, 'c foreign')::text, true);
  select set_config('app.current_org_id', :P78_ALDER, true);

  do $$
  begin
    perform pg_temp.p78_designate('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
                                  current_setting('p78.t1')::uuid, 'directory', false);
    raise exception 'FAIL 78c - a designation of Marguerite pointed at Tobias''s photo';
  exception when check_violation then
    if sqlerrm not like '%is removed, or is not this person''s photo in this organization%' then raise; end if;
    raise notice 'pass  78c: a designation cannot point at another person''s photo (guard; person_photo_designations_photo_fk behind it)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
            current_setting('p78.nblob')::uuid, pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'c thumb for foreign'),
            10, 10, 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 78c - a photo pointed at another org''s blob';
  exception when foreign_key_violation then
    if sqlerrm not like '%person_photos_image_fk%' then raise; end if;
    raise notice 'pass  78c: a photo cannot point at another org''s blob (person_photos_image_fk)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
            pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'c public image', 'image/jpeg', 'public_site'),
            pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'c thumb for public'),
            10, 10, 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 78c - a photo pointed at a public_site blob';
  exception when foreign_key_violation then
    if sqlerrm not like '%person_photos_image_fk%' then raise; end if;
    raise notice 'pass  78c: a photo cannot point at a public_site blob (the FK pins private)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, asset_audience, width, height, created_by)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
            pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'c public image 2', 'image/jpeg', 'public_site'),
            pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'c public thumb 2', 'image/webp', 'public_site'),
            'public_site', 10, 10, 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 78c - a photo row declared itself public_site';
  exception when check_violation then
    if sqlerrm not like '%person_photos_audience_private%' then raise; end if;
    raise notice 'pass  78c: ...nor declare asset_audience public_site to match one (person_photos_audience_private)';
  end $$;
  do $$
  begin
    perform pg_temp.p78_photo('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 'c idris');
    raise exception 'FAIL 78c - a photo was attached to a person who is not a member of this org';
  exception when foreign_key_violation then
    if sqlerrm not like '%person_photos_person_fk%' then raise; end if;
    raise notice 'pass  78c: a photo cannot hang off a person who is not a member of the org (person_photos_person_fk -> memberships)';
  end $$;
  select pg_temp.p78_designate(:P78_ALDER, :P78_MARG, current_setting('p78.m1')::uuid, 'directory', false);
  do $$
  begin
    perform pg_temp.p78_designate('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
                                  current_setting('p78.m1')::uuid, 'directory', true);
    raise exception 'FAIL 78c - a second active directory designation';
  exception when unique_violation then
    if sqlerrm not like '%person_photo_designations_active_idx%' then raise; end if;
    raise notice 'pass  78c: a second ACTIVE designation for the same purpose is refused (person_photo_designations_active_idx)';
  end $$;
  do $$
  begin
    perform pg_temp.p78_designate('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
                                  current_setting('p78.m1')::uuid, 'website', false);
    raise exception 'FAIL 78c - an unattested website designation';
  exception when check_violation then
    if sqlerrm not like '%person_photo_designations_website_attested%' then raise; end if;
    raise notice 'pass  78c: a website designation without an attestation is refused (person_photo_designations_website_attested)';
  end $$;
  do $$
  begin
    insert into person_photo_designations (organization_id, person_id, photo_id, purpose, public_attested_at, designated_by)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
            current_setting('p78.m1')::uuid, 'website', now(), 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 78c - an attestation with no attester';
  exception when check_violation then
    if sqlerrm not like '%person_photo_designations_attest_pair%' then raise; end if;
    raise notice 'pass  78c: an attestation time without the attesting user is refused (attest_pair)';
  end $$;
  do $$
  begin
    perform pg_temp.p78_designate('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
                                  current_setting('p78.m1')::uuid, 'avatar', false);
    raise exception 'FAIL 78c - a purpose outside the vocabulary';
  exception when check_violation then
    if sqlerrm not like '%person_photo_designations_purpose%' then raise; end if;
    raise notice 'pass  78c: a purpose outside (directory, website) is refused';
  end $$;
  -- A removed photo cannot be designated (the remove-versus-designate race).
  update person_photos set removed_at = now(), removed_by = :P78_USER where id = current_setting('p78.t1')::uuid;
  do $$
  begin
    perform pg_temp.p78_designate('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002',
                                  current_setting('p78.t1')::uuid, 'website', true);
    raise exception 'FAIL 78c - a removed photo was designated';
  exception when check_violation then
    if sqlerrm not like '%is removed, or is not this person''s photo in this organization%' then raise; end if;
    raise notice 'pass  78c: a removed photo cannot be designated (person_photo_designations_guard_write)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
    select organization_id, person_id, image_asset_key,
           pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'c m1 second thumb'), 800, 1000, created_by
      from person_photos where id = current_setting('p78.m1')::uuid;
    raise exception 'FAIL 78c - the same image twice in one person''s active set';
  exception when unique_violation then
    if sqlerrm not like '%person_photos_active_image_idx%' then raise; end if;
    raise notice 'pass  78c: the same image cannot be in one person''s ACTIVE set twice (person_photos_active_image_idx)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
    select organization_id, person_id, image_asset_key, image_asset_key, 800, 1000, created_by
      from person_photos where id = current_setting('p78.t1')::uuid;
    raise exception 'FAIL 78c - image and thumbnail are the same blob';
  exception when check_violation then
    if sqlerrm not like '%person_photos_distinct_assets%' then raise; end if;
    raise notice 'pass  78c: the thumbnail is never the master (person_photos_distinct_assets)';
  end $$;
rollback;

-- ===========================================================================
-- (d) R78d soft delete: no DELETE, immutable columns, one-way removal and
--     ending, stamped times, and people.photo_key held null.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P78_ALDER, true);
  select pg_temp.p78_clear();
  select set_config('p78.m1', pg_temp.p78_photo(:P78_ALDER, :P78_MARG, 'd m1')::text, true);
  select set_config('p78.d1', pg_temp.p78_designate(:P78_ALDER, :P78_MARG, current_setting('p78.m1')::uuid, 'directory', false)::text, true);

  do $$
  begin
    delete from person_photos where id = current_setting('p78.m1')::uuid;
    raise exception 'FAIL 78d - presby_app deleted a person photo';
  exception when insufficient_privilege then
    raise notice 'pass  78d: presby_app cannot DELETE a person photo';
  end $$;
  do $$
  begin
    delete from person_photo_designations where id = current_setting('p78.d1')::uuid;
    raise exception 'FAIL 78d - presby_app deleted a designation';
  exception when insufficient_privilege then
    raise notice 'pass  78d: presby_app cannot DELETE a designation';
  end $$;
  do $$
  begin
    update person_photos set image_asset_key = thumb_asset_key where id = current_setting('p78.m1')::uuid;
    raise exception 'FAIL 78d - presby_app changed a photo''s image';
  exception when insufficient_privilege then
    raise notice 'pass  78d: presby_app cannot UPDATE an immutable photo column (column grant)';
  end $$;
  do $$
  begin
    update person_photo_designations set purpose = 'website' where id = current_setting('p78.d1')::uuid;
    raise exception 'FAIL 78d - presby_app changed a designation''s purpose';
  exception when insufficient_privilege then
    raise notice 'pass  78d: presby_app cannot UPDATE an immutable designation column (column grant)';
  end $$;
  do $$
  begin
    update person_photos set removed_at = now() where id = current_setting('p78.m1')::uuid;
    raise exception 'FAIL 78d - a removal with no remover';
  exception when check_violation then
    if sqlerrm not like '%person_photos_removal_pair%' then raise; end if;
    raise notice 'pass  78d: removal sets both removed_at and removed_by or neither (removal_pair)';
  end $$;

  -- End, then remove: the store.ts order.
  update person_photo_designations set ended_at = now(), ended_by = :P78_USER where id = current_setting('p78.d1')::uuid;
  update person_photos set removed_at = now(), removed_by = :P78_USER where id = current_setting('p78.m1')::uuid;
  select assert_eq(
    (select count(*) from person_photos where id = current_setting('p78.m1')::uuid and removed_at is not null)
    + (select count(*) from person_photo_designations where id = current_setting('p78.d1')::uuid and ended_at is not null),
    2, '78d: presby_app ends a designation and removes a photo through the column grant');
  do $$
  begin
    update person_photos set removed_at = null, removed_by = null where id = current_setting('p78.m1')::uuid;
    raise exception 'FAIL 78d - a removed photo was restored';
  exception when check_violation then
    if sqlerrm not like '%is removed and cannot change (removal is one-way)%' then raise; end if;
    raise notice 'pass  78d: un-removing a photo is refused (guard; one-way)';
  end $$;
  do $$
  begin
    update person_photos set removed_at = now() - interval '1 day' where id = current_setting('p78.m1')::uuid;
    raise exception 'FAIL 78d - a removal was re-dated';
  exception when check_violation then
    if sqlerrm not like '%is removed and cannot change (removal is one-way)%' then raise; end if;
    raise notice 'pass  78d: re-dating a removal is refused (guard)';
  end $$;
  do $$
  begin
    update person_photo_designations set ended_at = null, ended_by = null where id = current_setting('p78.d1')::uuid;
    raise exception 'FAIL 78d - an ended designation was revived';
  exception when check_violation then
    if sqlerrm not like '%is ended and cannot change (ending is one-way)%' then raise; end if;
    raise notice 'pass  78d: un-ending a designation is refused (guard; one-way)';
  end $$;
  do $$
  begin
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by, removed_at, removed_by)
    values ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001',
            pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'd pre-removed image', 'image/jpeg'),
            pg_temp.p78_blob('22222222-2222-2222-2222-222222222222', 'd pre-removed thumb'),
            10, 10, 'e0000000-0000-0000-0000-0000000000f3', now(), 'e0000000-0000-0000-0000-0000000000f3');
    raise exception 'FAIL 78d - presby_app inserted an already-removed photo';
  exception when check_violation then
    if sqlerrm not like '%a new photo starts unremoved%' then raise; end if;
    raise notice 'pass  78d: presby_app cannot insert an already-removed photo (guard)';
  end $$;

  -- Stamped times: a forged created_at / designated_at is overwritten for presby_app.
  insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by, created_at)
  values (:P78_ALDER, :P78_MARG, pg_temp.p78_blob(:P78_ALDER, 'd forged image', 'image/jpeg'),
          pg_temp.p78_blob(:P78_ALDER, 'd forged thumb'), 10, 10, :P78_USER, '2000-01-01')
  returning id as p78_forged \gset
  insert into person_photo_designations (organization_id, person_id, photo_id, purpose, designated_by, designated_at)
  values (:P78_ALDER, :P78_MARG, :'p78_forged', 'directory', :P78_USER, '2000-01-01');
  select assert_eq(
    (select count(*) from person_photos where id = :'p78_forged' and created_at > now() - interval '1 hour')
    + (select count(*) from person_photo_designations where photo_id = :'p78_forged' and designated_at > now() - interval '1 hour'),
    2, '78d: created_at and designated_at are stamped by the guards, never taken from presby_app');

  do $$
  begin
    update people set photo_key = gen_random_uuid()::text where id = 'c0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 78d - people.photo_key was written';
  exception when check_violation then
    if sqlerrm not like '%people_photo_key_retired%' then raise; end if;
    raise notice 'pass  78d: people.photo_key is retired - a write is refused (people_photo_key_retired; the owner path is person-photos.db.test.ts)';
  end $$;
  do $$
  begin
    update people set photo_updated_at = now() where id = 'c0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 78d - people.photo_updated_at was written';
  exception when check_violation then
    if sqlerrm not like '%people_photo_key_retired%' then raise; end if;
    raise notice 'pass  78d: ...and so is people.photo_updated_at';
  end $$;
rollback;

-- ===========================================================================
-- (e) R78e matrix through the SAME definer core the rosters project
--     (presby_person_public_photo_status) and the directory function. The
--     category axis is forced off first (presby_app holds UPDATE on
--     feature_flags; rolled back), so the toggle row alone decides.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P78_NREACH, true);
  select pg_temp.p78_clear();
  select set_config('app.current_org_id', :P78_ALDER, true);
  select pg_temp.p78_clear();
  select assert_eq(
    (select count(*) from feature_flags where key = 'org_portal.feature_categories'), 1,
    '78e: (premise) the category-axis flag row exists (scripts/seed.ts seeds it), so flipping it below is not a no-op');
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';
  -- "Provisioned off" means NO row; remove any (presby_app holds DELETE here; rolled back).
  delete from organization_feature_toggles where organization_id = :P78_ALDER and feature_key = 'org_portal.person_photos';
  select assert_eq(
    (select count(*) from person_privacy where person_id in (:P78_MARG, :P78_ROWAN, :P78_TOBIAS, :P78_WREN)),
    0, '78e: (premise) the matrix subjects carry no privacy row of their own in this view');

  select set_config('p78.m1', pg_temp.p78_photo(:P78_ALDER, :P78_MARG, 'e m1')::text, true);
  select set_config('p78.m2', pg_temp.p78_photo(:P78_ALDER, :P78_MARG, 'e m2')::text, true);
  select set_config('p78.m1img', (select image_asset_key::text from person_photos where id = current_setting('p78.m1')::uuid), true);
  select set_config('p78.m2img', (select image_asset_key::text from person_photos where id = current_setting('p78.m2')::uuid), true);
  select set_config('p78.m1web', pg_temp.p78_designate(:P78_ALDER, :P78_MARG, current_setting('p78.m1')::uuid, 'website', true)::text, true);

  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, current_setting('p78.m1img')::uuid) = 'toggle_off|website|null'),
    1, '78e: toggle OFF (no row - provisioned off): the website photo is withheld, reason toggle_off');
  select assert_eq(
    (select count(*) where not presby_person_photos_enabled(:P78_ALDER)), 1,
    '78e: presby_person_photos_enabled is false with no toggle row');

  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:P78_ALDER, 'org_portal.person_photos', true);
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, current_setting('p78.m1img')::uuid) = '-|website|expected'),
    1, '78e: SERVED - a listed adult''s website designation, once the toggle is on');
  select assert_eq(
    (select count(*) where pg_temp.p78_dir(:P78_MARG, current_setting('p78.m1')::uuid) = 'none'),
    1, '78e: the directory never falls back to the website photo (no directory designation: none)');

  select pg_temp.p78_designate(:P78_ALDER, :P78_MARG, current_setting('p78.m2')::uuid, 'directory', false);
  select assert_eq(
    (select count(*) where pg_temp.p78_dir(:P78_MARG, current_setting('p78.m2')::uuid) = '-|expected'),
    1, '78e: the directory shows the directory designation''s THUMBNAIL');
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, current_setting('p78.m1img')::uuid) = '-|website|expected'),
    1, '78e: with both, the website designation wins on the website');

  update person_photo_designations set ended_at = now(), ended_by = :P78_USER where id = current_setting('p78.m1web')::uuid;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, null) = 'none'),
    1, '78e: NOT SERVED - an ended website designation, and an UNATTESTED directory photo does not stand in (Q6)');

  update person_photo_designations set ended_at = now(), ended_by = :P78_USER
   where person_id = :P78_MARG and purpose = 'directory' and ended_at is null;
  select pg_temp.p78_designate(:P78_ALDER, :P78_MARG, current_setting('p78.m2')::uuid, 'directory', true);
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, current_setting('p78.m2img')::uuid) = '-|directory_attested|expected'),
    1, '78e: SERVED - an attested directory designation stands in when no website photo is chosen (Q6)');
  select pg_temp.p78_designate(:P78_ALDER, :P78_MARG, current_setting('p78.m1')::uuid, 'website', true);
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, current_setting('p78.m1img')::uuid) = '-|website|expected'),
    1, '78e: a website designation beats an attested directory one');

  -- hide_photo at this org: withheld on both surfaces.
  insert into person_privacy (person_id, organization_id, hide_photo) values (:P78_MARG, :P78_ALDER, true);
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, null) = 'hide_photo|website|null'
                        and pg_temp.p78_dir(:P78_MARG, current_setting('p78.m2')::uuid) = 'hide_photo|null'),
    1, '78e: NOT SERVED - hide_photo withholds the website AND the directory photo');
  update person_privacy set hide_photo = false where person_id = :P78_MARG;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, current_setting('p78.m1img')::uuid) = '-|website|expected'),
    1, '78e: clearing hide_photo brings it back (read live, nothing copied)');

  -- hide_photo set at ANOTHER org (Rowan, Northern Reach): public withheld here too; directory is org-scoped.
  select set_config('p78.r1', pg_temp.p78_photo(:P78_ALDER, :P78_ROWAN, 'e r1')::text, true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_ROWAN, current_setting('p78.r1')::uuid, 'website', true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_ROWAN, current_setting('p78.r1')::uuid, 'directory', false);
  select set_config('app.current_org_id', :P78_NREACH, true);
  insert into person_privacy (person_id, organization_id, hide_photo) values (:P78_ROWAN, :P78_NREACH, true);
  select set_config('app.current_org_id', :P78_ALDER, true);
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_ROWAN, null) = 'hide_photo|website|null'),
    1, '78e: NOT SERVED - hide_photo set at another org withholds the public photo here (person_id alone; F333: the definer sees what presby_app cannot)');
  select assert_eq(
    (select count(*) where pg_temp.p78_dir(:P78_ROWAN, current_setting('p78.r1')::uuid) = '-|expected'),
    1, '78e: ...while the directory, scoped to this org as directory.ts always was, still shows it');

  -- Minors (R4): by date of birth, at the 18th birthday boundary, birth-year-only, and household_role child.
  select set_config('p78.t1', pg_temp.p78_photo(:P78_ALDER, :P78_TOBIAS, 'e t1')::text, true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_TOBIAS, current_setting('p78.t1')::uuid, 'website', true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_TOBIAS, current_setting('p78.t1')::uuid, 'directory', false);
  update people set date_of_birth = current_date - interval '10 years' where id = :P78_TOBIAS;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_TOBIAS, null) = 'minor|website|null'
                        and pg_temp.p78_dir(:P78_TOBIAS, current_setting('p78.t1')::uuid) = 'minor|null'),
    1, '78e: NOT SERVED - a minor by date of birth, on the website and in the directory (read time, no one acting)');
  update people set date_of_birth = (current_date - interval '18 years')::date where id = :P78_TOBIAS;
  select assert_eq(
    (select count(*) where not presby_photo_subject_is_minor(:P78_ALDER, :P78_TOBIAS)
                        and pg_temp.p78_pub(:P78_TOBIAS, (select image_asset_key from person_photos where id = current_setting('p78.t1')::uuid)) = '-|website|expected'),
    1, '78e: 18 today is an adult (children.ts''s arithmetic: date_of_birth > current_date - 18 years)');
  update people set date_of_birth = (current_date - interval '18 years' + interval '1 day')::date where id = :P78_TOBIAS;
  select assert_eq(
    (select count(*) where presby_photo_subject_is_minor(:P78_ALDER, :P78_TOBIAS)), 1,
    '78e: 18 tomorrow is a minor');
  update people set birth_year_only = true,
                    date_of_birth = make_date(extract(year from current_date)::int - 18, 1, 1) where id = :P78_TOBIAS;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_TOBIAS, null) = 'minor|website|null'), 1,
    '78e: NOT SERVED - birth year only, 18 years ago: could still be 17, so a minor');
  update people set date_of_birth = make_date(extract(year from current_date)::int - 19, 1, 1) where id = :P78_TOBIAS;
  select assert_eq(
    (select count(*) where not presby_photo_subject_is_minor(:P78_ALDER, :P78_TOBIAS)), 1,
    '78e: birth year only, 19 years ago: certainly 18, an adult');
  update people set date_of_birth = null, birth_year_only = false where id = :P78_TOBIAS;
  select assert_eq(
    (select count(*) where not presby_photo_subject_is_minor(:P78_ALDER, :P78_TOBIAS)), 1,
    '78e: a null date of birth with no child marker is an adult (operator ruling Q4; accepted residual)');
  update memberships set household_role = 'child' where person_id = :P78_TOBIAS and organization_id = :P78_ALDER;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_TOBIAS, null) = 'minor|website|null'), 1,
    '78e: NOT SERVED - household_role child in this org is a minor even with no date of birth');
  select assert_eq(
    (select count(*) where not presby_photo_subject_is_minor(:P78_NREACH, :P78_TOBIAS)), 1,
    '78e: ...and the household role is read for THIS org only');

  -- A merged tombstone (no merge writer exists yet; the core withholds it anyway, G10).
  select set_config('p78.w1', pg_temp.p78_photo(:P78_ALDER, :P78_WREN, 'e w1')::text, true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_WREN, current_setting('p78.w1')::uuid, 'website', true);
  update people set merged_into_id = :P78_MARISOL where id = :P78_WREN;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_WREN, null) = 'merged|website|null'), 1,
    '78e: NOT SERVED - a merged tombstone');

  -- A removed photo: its designations are inert even if left active (the double filter).
  select set_config('p78.x1', pg_temp.p78_photo(:P78_ALDER, :P78_DESMOND, 'e x1')::text, true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_DESMOND, current_setting('p78.x1')::uuid, 'website', true);
  select pg_temp.p78_designate(:P78_ALDER, :P78_DESMOND, current_setting('p78.x1')::uuid, 'directory', true);
  update person_photos set removed_at = now(), removed_by = :P78_USER where id = current_setting('p78.x1')::uuid;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_DESMOND, null) = 'none'
                        and pg_temp.p78_dir(:P78_DESMOND, current_setting('p78.x1')::uuid) = 'none'),
    1, '78e: NOT SERVED - a removed photo, even with its designations left active (readers filter removed_at)');

  -- The category axis: flag on and the people category off at this org is OFF; a missing category row is ON.
  update feature_flags set enabled = true where key = 'org_portal.feature_categories';
  select assert_eq(
    (select count(*) where presby_person_photos_enabled(:P78_ALDER)
       = coalesce((select enabled from organization_feature_categories where organization_id = :P78_ALDER and category = 'people'), true)),
    1, '78e: with the axis on, the people category decides (a missing category row is on)');
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:P78_ALDER, 'people', false)
  on conflict (organization_id, category) do update set enabled = false;
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, null) = 'toggle_off|website|null'), 1,
    '78e: NOT SERVED - axis on and the people category off withholds it (toggle_off)');
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';
  update organization_feature_toggles set enabled = false
   where organization_id = :P78_ALDER and feature_key = 'org_portal.person_photos';
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_MARG, null) = 'toggle_off|website|null'
                        and pg_temp.p78_dir(:P78_MARG, current_setting('p78.m2')::uuid) = 'toggle_off|null'),
    1, '78e: NOT SERVED - the toggle row turned off withholds every surface (R8)');
  update organization_feature_toggles set enabled = true
   where organization_id = :P78_ALDER and feature_key = 'org_portal.person_photos';

  -- Foreign org and no org: Alder's designations never appear under Northern Reach.
  select set_config('app.current_org_id', :P78_NREACH, true);
  select assert_eq(
    (select count(*) where pg_temp.p78_pub(:P78_ROWAN, null) = 'none'
                        and pg_temp.p78_pub(:P78_MARG, null) = 'none'),
    1, '78e: under Northern Reach, Alder''s designations for a shared person (and for Marguerite) are not there');
  select assert_eq(
    (select count(*) from presby_person_directory_photo(:P78_ALDER, :P78_ROWAN)), 0,
    '78e: the directory function asked for Alder from Northern Reach''s context sees nothing (invoker, RLS)');
  select set_config('app.current_org_id', '', true);
  select assert_eq(
    (select count(*) from presby_person_public_photo_status(:P78_MARG)), 0,
    '78e: the status wrapper returns zero rows with no org context');
  select set_config('app.current_org_id', :P78_ALDER, true);
  do $$
  begin
    perform * from presby_person_public_photo('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 78e - presby_app called the owner-only core directly';
  exception when insufficient_privilege then
    if sqlerrm not like '%permission denied for function presby_person_public_photo%' then raise; end if;
    raise notice 'pass  78e: presby_app cannot call the core with an org of its choosing (owner-only; the designed refusal)';
  end $$;

  -- Door premise (Alder is provisioning): zero rows for an image key and a thumbnail key.
  select assert_eq(
    (select count(*) from person_photos ph, presby_public_site_asset(:P78_ALDER::uuid, ph.image_asset_key) d
      where ph.id = current_setting('p78.m1')::uuid)
    + (select count(*) from person_photos ph, presby_public_site_asset(:P78_ALDER::uuid, ph.thumb_asset_key) d
      where ph.id = current_setting('p78.m1')::uuid)
    + (select count(*) from presby_public_staff_roster('alder-creek'))
    + (select count(*) from presby_public_committee_roster('alder-creek')),
    0, '78e: (premise) the door and both rosters, called as presby_app, run without a permission error and list nothing while Alder''s site is provisioning');
rollback;

drop function if exists pg_temp.p78_dir(uuid, uuid);
drop function if exists pg_temp.p78_clear();
drop function if exists pg_temp.p78_pub(uuid, uuid);
drop function if exists pg_temp.p78_designate(uuid, uuid, uuid, text, boolean);
drop function if exists pg_temp.p78_photo(uuid, uuid, text);
drop function if exists pg_temp.p78_blob(uuid, text, text, text);

\echo '======================================================'
\echo ' Section 78 (person photos) complete.'
\echo '======================================================'
