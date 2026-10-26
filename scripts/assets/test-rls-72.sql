-- ---------------------------------------------------------------------------
-- 72. Public asset audience (drizzle/0072_presby_blob_audience.sql; F289,
--     DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md
--     Phase 3 "Test Plan" RLS script).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains its section-72 banner
--     and ONE include at its end (patch P2 in the work-log):
--
--         \ir assets/test-rls-72.sql
--
--     Standalone (MUST be presby_app - the owner bypasses RLS and holds UPDATE
--     on blob_assets by ownership, so as the owner most of this proves
--     nothing):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/assets/test-rls-72.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs only the stock
--     scripts/seed-dev.sql fixture (Alder Creek, Bramblewood; no seed change).
--     Every block that writes ends in rollback, so it writes nothing durable.
--
--     Alder Creek's site is `provisioning` and presby_app holds no grant on
--     organization_sites (DECISION-081), so every definer result below is
--     zero rows - that is the gate. The live-site positives (a public_site
--     image served as 'site', a listed photo served as 'roster', and the
--     differential that flips one condition at a time) are on real
--     connections in src/lib/db/domain/public-roster-photo.db.test.ts (Batch 1)
--     and src/lib/storage/public-asset.db.test.ts (Batch 2, D1). What
--     presby_app cannot reach - the trigger binding the OWNER and
--     presby_platform - is src/lib/storage/blob-audience.db.test.ts.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set P72_ALDER   '\'22222222-2222-2222-2222-222222222222\''
\set P72_BRAMBLE '\'33333333-3333-3333-3333-333333333333\''
\set P72_NIL     '\'00000000-0000-0000-0000-000000000000\''

\echo '======================================================'
\echo ' Section 72 (public asset audience, drizzle/0072) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '72: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure: FORCE RLS, grants, CHECKs, the trigger, the functions.
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'blob_assets' and relkind = 'r'
        and relrowsecurity and relforcerowsecurity),
    1, '72a: blob_assets has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from (values ('SELECT', true), ('INSERT', true), ('UPDATE', false), ('DELETE', false)) v(p, want)
      where has_table_privilege('presby_app', 'blob_assets', v.p) = v.want),
    4, '72a: presby_app holds SELECT and INSERT on blob_assets, and neither UPDATE nor DELETE');
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'blob_assets' and column_name = 'audience')
          or (table_name in ('ticket_messages', 'giving_statements') and column_name = 'asset_audience'))
        and is_nullable = 'NO' and column_default = '''private''::text'),
    3, '72a: blob_assets.audience and both asset_audience constants are NOT NULL DEFAULT ''private'' (fail closed, R5)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'c' and c.convalidated
        and ((c.conname = 'blob_assets_audience_allowed' and c.conrelid = 'blob_assets'::regclass
              and pg_get_constraintdef(c.oid) = 'CHECK ((audience = ANY (ARRAY[''public_site''::text, ''private''::text])))')
          or (c.conname = 'blob_assets_public_site_is_image' and c.conrelid = 'blob_assets'::regclass
              and pg_get_constraintdef(c.oid) = 'CHECK (((audience = ''private''::text) OR (content_type = ANY (ARRAY[''image/png''::text, ''image/jpeg''::text, ''image/webp''::text]))))')
          or (c.conname = 'ticket_messages_asset_audience_private' and c.conrelid = 'ticket_messages'::regclass
              and pg_get_constraintdef(c.oid) = 'CHECK ((asset_audience = ''private''::text))')
          or (c.conname = 'giving_statements_asset_audience_private' and c.conrelid = 'giving_statements'::regclass
              and pg_get_constraintdef(c.oid) = 'CHECK ((asset_audience = ''private''::text))'))),
    4, '72a: the vocabulary CHECK, public_site-is-an-image, and both consumer constants exist, validated, with the exact predicate');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'blob_assets'::regclass and c.contype = 'u'
        and c.conname in ('blob_assets_org_audience_hash_key', 'blob_assets_id_org_audience_key', 'blob_assets_id_org_key'))
    + (select count(*) from pg_constraint where conname = 'blob_assets_org_hash_key'),
    3, '72a: dedup is per audience, the three-column FK target exists, blob_assets_id_org_key stays, the old dedup key is gone');
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid = 'blob_assets'::regclass and t.tgname = 'blob_assets_audience_immutable'
        and t.tgenabled = 'O' and not t.tgisinternal
        and pg_get_triggerdef(t.oid) = 'CREATE TRIGGER blob_assets_audience_immutable BEFORE UPDATE OF audience ON public.blob_assets FOR EACH ROW WHEN ((old.audience IS DISTINCT FROM new.audience)) EXECUTE FUNCTION presby_blob_assets_audience_immutable()'),
    1, '72a: blob_assets_audience_immutable is enabled, BEFORE UPDATE OF audience, fires only on a change');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_public_site_asset', 'presby_public_staff_roster', 'presby_public_committee_roster')
        and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
        and (select array_agg(a.grantee order by a.grantee) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = (select array_agg(x order by x) from unnest(array[p.proowner, 'presby_app'::regrole::oid]) x)),
    3, '72a: the asset definer and both roster functions are SECURITY DEFINER, pin search_path, and are executable by the owner and presby_app ALONE (no PUBLIC)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname = 'presby_blob_assets_audience_immutable' and not p.prosecdef
        and p.proconfig = array['search_path=public, pg_temp']
        and not exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner)),
    1, '72a: the immutability trigger function is SECURITY INVOKER, pins search_path, and is executable by its owner alone');
  select assert_eq(
    (select count(*) from (values ('presby_public_site_asset(uuid,uuid)', true),
                                  ('presby_blob_assets_audience_immutable()', false)) v(f, want)
      where has_function_privilege('presby_app', v.f, 'execute') = v.want),
    2, '72a: presby_app may call the asset door and may not call the trigger function');
  select assert_eq(
    (select count(*) from pg_indexes
      where tablename = 'people' and indexname = 'people_photo_key_lower_idx'
        and indexdef = 'CREATE INDEX people_photo_key_lower_idx ON public.people USING btree (lower(photo_key)) WHERE (photo_key IS NOT NULL)'),
    1, '72a: people_photo_key_lower_idx serves the definer''s photo exclusion on lower(photo_key) (people is global, D1)');
rollback;

-- ===========================================================================
-- (b) The catalog rule (R6): every FK into blob_assets is on the
--     public-reference allowlist, or carries an asset_audience column pinned
--     to 'private' by a validated CHECK. A private consumer that forgets the
--     constant fails here (treasury's receipts, drizzle/0073, are the third).
-- ===========================================================================
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
    0, '72b: no FK into blob_assets is outside the public allowlist without pinning asset_audience = ''private''');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass
        and c.conname in ('ticket_messages_attachment_fk', 'giving_statements_blob_fk',
                          'reimbursement_attachments_blob_fk')
        and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
        and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = array['id', 'organization_id', 'audience']),
    3, '72b: (not vacuous) the three private consumers (tickets, statements, treasury receipts from drizzle/0073) reference (id, organization_id, audience), NO ACTION/NO ACTION, validated');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass),
    6, '72b: exactly six FKs point into blob_assets (three public references, three private consumers): a new one is a deliberate edit here');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'blob_assets'::regclass
        and c.conname in ('organization_brands_mark_asset_fk', 'organization_brands_wordmark_asset_fk',
                          'organization_sites_content_bundle_fk')),
    3, '72b: (not vacuous) the three allowlisted names are real constraints');
rollback;

-- ===========================================================================
-- (c) What presby_app can and cannot write.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P72_ALDER, true);
  do $$
  begin
    update blob_assets set audience = 'public_site' where organization_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL 72c - presby_app changed a blob''s audience';
  exception when insufficient_privilege then
    raise notice 'pass  72c: presby_app holds no UPDATE on blob_assets (audience can never be flipped on the tenant path)';
  end $$;
  do $$
  begin
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
    values ('22222222-2222-2222-2222-222222222222', repeat('a', 64), 'application/json', 2, '\x7b7d'::bytea, 'public_site');
    raise exception 'FAIL 72c - presby_app stored public_site JSON';
  exception when check_violation then
    if sqlerrm not like '%blob_assets_public_site_is_image%' then raise; end if;
    raise notice 'pass  72c: public_site JSON is refused by blob_assets_public_site_is_image on the tenant path';
  end $$;
  do $$
  begin
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
    values ('22222222-2222-2222-2222-222222222222', repeat('b', 64), 'image/png', 2, '\x8950'::bytea, 'shared');
    raise exception 'FAIL 72c - presby_app stored an audience outside the vocabulary';
  exception when check_violation then
    if sqlerrm not like '%blob_assets_audience_allowed%' then raise; end if;
    raise notice 'pass  72c: an audience outside (public_site, private) is refused';
  end $$;
  do $$
  begin
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
    values ('33333333-3333-3333-3333-333333333333', repeat('c', 64), 'image/png', 2, '\x8950'::bytea, 'public_site');
    raise exception 'FAIL 72c - presby_app wrote a blob into another org';
  exception when insufficient_privilege then
    raise notice 'pass  72c: tenancy holds for the new column - a write into Bramblewood under Alder''s context is refused (RLS with check)';
  end $$;
  insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
  values (:P72_ALDER, repeat('d', 64), 'image/png', 2, '\x8950'::bytea);
  select assert_eq(
    (select count(*) from blob_assets where content_hash = repeat('d', 64) and audience = 'private'),
    1, '72c: an insert that omits audience (pre-0072 code) lands private - fail closed');
rollback;

-- ===========================================================================
-- (d) The asset door, called as presby_app with NO org context (exactly how
--     the public route calls it). Alder is provisioning: zero rows for every
--     shape, including a public_site image of its own.
-- ===========================================================================
begin;
  select set_config('app.current_org_id', :P72_ALDER, true);
  insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
  values (:P72_ALDER, repeat('e', 64), 'image/png', 4, '\x89504e47'::bytea, 'public_site')
  returning id as p72_pub \gset
  select set_config('app.current_org_id', '', true);
  select assert_eq(
    (select count(*) from presby_public_site_asset(:P72_ALDER::uuid, :'p72_pub'::uuid)),
    0, '72d: a public_site image of an org whose site is not live is not served (the site gate)');
  select assert_eq(
    (select count(*) from presby_public_site_asset(:P72_BRAMBLE::uuid, :'p72_pub'::uuid)),
    0, '72d: Alder''s key asked for under Bramblewood''s id: zero rows (the definer never leaves the org it is handed)');
  select assert_eq(
    (select count(*) from presby_public_site_asset(gen_random_uuid(), :'p72_pub'::uuid)),
    0, '72d: Alder''s key under an organization id that does not exist: zero rows');
  select assert_eq(
    (select count(*) from presby_public_site_asset(:P72_ALDER::uuid, :P72_NIL::uuid)),
    0, '72d: the nil uuid (the renderer''s MISSING_IMAGE_KEY) is never served');
  select assert_eq(
    (select count(*) from presby_public_staff_roster('alder-creek'))
    + (select count(*) from presby_public_committee_roster('alder-creek')),
    0, '72d: (premise) neither roster lists anyone at Alder Creek while its site is provisioning');
rollback;

\echo '======================================================'
\echo ' Section 72 (public asset audience) complete.'
\echo '======================================================'
