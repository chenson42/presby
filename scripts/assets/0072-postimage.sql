-- scripts/assets/0072-postimage.sql - D5 step 3 (docs/work-log/2026-10-25-
-- public-asset-allowlist.md, Phase 3 "Test Plan" D5): what 0072 did to the
-- pre-image 0072-preimage.sql built. Owner connection on the SCRATCH
-- database, driven by scripts/assets/test-0072-migration.sh; needs
-- scripts/install-test-helpers.sql (assert_eq). Every block that writes ends
-- in rollback.
--
-- Optional psql variable P72_EXPECT_PUBLIC (default 3): how many fixture blobs
-- are public_site. The driver passes 4 after the heal step.
\set ON_ERROR_STOP on
\if :{?P72_EXPECT_PUBLIC}
\else
\set P72_EXPECT_PUBLIC 3
\endif

-- ---------------------------------------------------------------------------
-- (1) Classification, per class.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*) from p72_harness.fixture f join blob_assets b on b.id = f.id
    where f.kind in ('mark', 'bundle_img1', 'bundle_img2') and b.audience = 'public_site'),
  3, 'p72: the current mark and both bundle images (one named in UPPERCASE) are public_site');
select assert_eq(
  (select count(*) from p72_harness.fixture f join blob_assets b on b.id = f.id
    where f.kind in ('bundle_json', 'wordmark', 'history_mark', 'orphan', 'ticket_img', 'bundle_pdf',
                     'bramble_img', 'bramble_garbage', 'statement_pdf')
      and b.audience = 'private'),
  9, 'p72: the bundle JSON, wordmark, replaced mark, orphan, ticket image, imageKeys-named PDF, other org''s image, garbage bundle and statement PDF stay private');
select assert_eq(
  (select count(*) from blob_assets where audience = 'public_site'),
  :P72_EXPECT_PUBLIC, 'p72: and nothing else in the database is public_site');
select assert_eq(
  (select count(*) from blob_assets
    where audience = 'public_site' and content_type not in ('image/png', 'image/jpeg', 'image/webp')),
  0, 'p72: every public_site row is an image');

-- ---------------------------------------------------------------------------
-- (2) The issued statement's PDF: byte-identical, private, and still
--     undeletable / immutable on the owner path (F44).
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*) from p72_harness.fixture f join blob_assets b on b.id = f.id
    where f.kind = 'statement_pdf' and md5(b.bytes) = f.bytes_md5 and b.content_hash = f.content_hash
      and b.audience = 'private' and b.content_type = 'application/pdf'),
  1, 'p72: the statement PDF is byte-identical (md5 and content_hash) and private after 0072');
select assert_eq(
  (select count(*) from giving_statements s join p72_harness.fixture f on f.kind = 'statement' and f.id = s.id
    where s.asset_audience = 'private'),
  1, 'p72: the issued statement carries asset_audience = ''private'' (the constant default reached the existing row)');

begin;
do $$
declare v_pdf uuid := (select id from p72_harness.fixture where kind = 'statement_pdf');
begin
  begin
    delete from blob_assets where id = v_pdf;
    raise exception 'FAIL p72 - the statement PDF was deleted';
  exception when foreign_key_violation then
    if sqlerrm not like '%giving_statements_blob_fk%' then raise; end if;
    raise notice 'pass  p72: DELETE of the statement PDF is refused by giving_statements_blob_fk (NO ACTION, owner path)';
  end;
  begin
    update blob_assets set bytes = bytes || '\x00'::bytea where id = v_pdf;
    raise exception 'FAIL p72 - the statement PDF bytes changed';
  exception when check_violation then
    if sqlerrm not like '%contribution statement is immutable%' then raise; end if;
    raise notice 'pass  p72: UPDATE of its bytes is refused by blob_assets_giving_statement_guard';
  end;
  begin
    update blob_assets set audience = 'public_site' where id = v_pdf;
    raise exception 'FAIL p72 - the statement PDF audience changed';
  exception when check_violation then
    if sqlerrm not like '%audience is immutable%' then raise; end if;
    raise notice 'pass  p72: UPDATE of its audience is refused by blob_assets_audience_immutable';
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- (3) Shapes: the consumer FKs, the roster functions, the new door.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*) from pg_constraint c
    where c.conname in ('ticket_messages_attachment_fk', 'giving_statements_blob_fk')
      and c.confrelid = 'blob_assets'::regclass and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
      and array_length(c.conkey, 1) = 3
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
             join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = array['id', 'organization_id', 'audience']),
  2, 'p72: both consumer FKs are three-column, NO ACTION/NO ACTION, validated');
select assert_eq(
  (select count(*) from pg_proc p
    where p.proname in ('presby_public_staff_roster', 'presby_public_committee_roster', 'presby_public_site_asset')
      and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
      and (select array_agg(a.grantee order by a.grantee) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
          = (select array_agg(x order by x) from unnest(array[p.proowner, 'presby_app'::regrole::oid]) x)),
  3, 'p72: the roster functions keep search_path=public, pg_temp and an owner+presby_app ACL; the door has the same');

-- ---------------------------------------------------------------------------
-- (4) What OLD code does in the deploy window (R5): an insert that omits
--     audience lands private, and a ticket message may reference it.
-- ---------------------------------------------------------------------------
begin;
insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
values ('a7200000-0000-4000-8000-0000000000c1', '22222222-2222-2222-2222-222222222222', repeat('c', 64), 'image/png', 4,
        '\x89504e47'::bytea);
insert into ticket_messages (organization_id, ticket_id, author_kind, author_person_id, body, attachment_asset_key)
values ('22222222-2222-2222-2222-222222222222', 'a7200000-0000-4000-8000-0000000000a1', 'submitter',
        'c0000000-0000-0000-0000-000000000003', 'p72 old-code upload', 'a7200000-0000-4000-8000-0000000000c1');
select assert_eq(
  (select count(*) from blob_assets where id = 'a7200000-0000-4000-8000-0000000000c1' and audience = 'private'),
  1, 'p72: an insert without audience (old code in the window) lands private and a ticket may attach it');
rollback;

\echo 'p72 postimage: all assertions passed'
