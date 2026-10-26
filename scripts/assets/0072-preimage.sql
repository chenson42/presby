-- scripts/assets/0072-preimage.sql - D5 step 2 (docs/work-log/2026-10-25-
-- public-asset-allowlist.md, Phase 3 "Test Plan" D5). Driven by
-- scripts/assets/test-0072-migration.sh against a SCRATCH database at the
-- pre-0072 schema, after scripts/seed-dev.sql. Never run elsewhere.
--
-- Builds one blob of every class 0072 must classify, records each id (and the
-- statement PDF's md5/content_hash) in p72_harness.fixture for
-- 0072-postimage.sql. The ONE real contribution statement is issued after
-- this file, on a presby_app login (0072-preimage-issue.sql), and recorded by
-- the driver.
--
-- Expected 0072 flip set (3): Alder's current mark and the two image values of
-- Alder's bundle imageKeys. Everything else here stays private.
--
-- Fixture ids use the a7200000- prefix. No Real Data.
\set ON_ERROR_STOP on
\set ALDER      '\'22222222-2222-2222-2222-222222222222\''
\set BRAMBLE    '\'33333333-3333-3333-3333-333333333333\''
\set PRIYA      '\'c0000000-0000-0000-0000-000000000003\''
\set U_FOUNDING '\'e0000000-0000-0000-0000-0000000000f5\''

begin;

create schema if not exists p72_harness;
create table if not exists p72_harness.fixture (
  kind text primary key,
  id uuid not null,
  bytes_md5 text,
  content_hash text
);

-- Raw image-ish bytes (a PNG signature plus a tag): byte-distinct, so the
-- pre-0072 (organization_id, content_hash) dedup key never merges two of them.
with v(kind, id, org, content_type, bytes) as (values
  ('bundle_img1',   'a7200000-0000-4000-8000-000000000001'::uuid, :ALDER::uuid,   'image/png',  '\x89504e470d0a1a0a'::bytea || convert_to('p72 bundle image one', 'UTF8')),
  ('bundle_img2',   'a7200000-0000-4000-8000-000000000002'::uuid, :ALDER::uuid,   'image/jpeg', '\xffd8ffe0'::bytea || convert_to('p72 bundle image two', 'UTF8')),
  ('mark',          'a7200000-0000-4000-8000-000000000003'::uuid, :ALDER::uuid,   'image/png',  '\x89504e470d0a1a0a'::bytea || convert_to('p72 current mark', 'UTF8')),
  ('wordmark',      'a7200000-0000-4000-8000-000000000004'::uuid, :ALDER::uuid,   'image/png',  '\x89504e470d0a1a0a'::bytea || convert_to('p72 wordmark', 'UTF8')),
  ('history_mark',  'a7200000-0000-4000-8000-000000000005'::uuid, :ALDER::uuid,   'image/webp', convert_to('RIFF....WEBP p72 replaced mark', 'UTF8')),
  ('orphan',        'a7200000-0000-4000-8000-000000000006'::uuid, :ALDER::uuid,   'image/png',  '\x89504e470d0a1a0a'::bytea || convert_to('p72 orphan', 'UTF8')),
  ('ticket_img',    'a7200000-0000-4000-8000-000000000007'::uuid, :ALDER::uuid,   'image/png',  '\x89504e470d0a1a0a'::bytea || convert_to('p72 ticket screenshot', 'UTF8')),
  ('bundle_pdf',    'a7200000-0000-4000-8000-000000000008'::uuid, :ALDER::uuid,   'application/pdf', convert_to('%PDF-1.7 p72 named by imageKeys but not an image', 'UTF8')),
  ('bramble_img',   'a7200000-0000-4000-8000-000000000009'::uuid, :BRAMBLE::uuid, 'image/png',  '\x89504e470d0a1a0a'::bytea || convert_to('p72 another org image', 'UTF8')),
  ('bramble_garbage','a7200000-0000-4000-8000-00000000000a'::uuid, :BRAMBLE::uuid, 'application/json', convert_to('{not json at all', 'UTF8')))
insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
select v.id, v.org, encode(sha256(v.bytes), 'hex'), v.content_type, octet_length(v.bytes), v.bytes from v;

insert into p72_harness.fixture (kind, id)
values ('bundle_img1', 'a7200000-0000-4000-8000-000000000001'), ('bundle_img2', 'a7200000-0000-4000-8000-000000000002'),
       ('mark', 'a7200000-0000-4000-8000-000000000003'), ('wordmark', 'a7200000-0000-4000-8000-000000000004'),
       ('history_mark', 'a7200000-0000-4000-8000-000000000005'), ('orphan', 'a7200000-0000-4000-8000-000000000006'),
       ('ticket_img', 'a7200000-0000-4000-8000-000000000007'), ('bundle_pdf', 'a7200000-0000-4000-8000-000000000008'),
       ('bramble_img', 'a7200000-0000-4000-8000-000000000009'), ('bramble_garbage', 'a7200000-0000-4000-8000-00000000000a');

-- Alder's bundle: imageKeys names both images (one in UPPERCASE - the cast
-- must canonicalize it), a PDF (not an image: stays private), another org's
-- image (same-org only: stays private) and a value that is not a uuid (the
-- migration's CASE must keep the cast from running on it).
with b(bytes) as (
  select convert_to(json_build_object(
           'schemaVersion', 1,
           'pages', json_build_array(),
           'imageKeys', json_build_object(
             'hero', 'a7200000-0000-4000-8000-000000000001',
             'gallery', upper('a7200000-0000-4000-8000-000000000002'),
             'brochure', 'a7200000-0000-4000-8000-000000000008',
             'stray', 'a7200000-0000-4000-8000-000000000009',
             'typo', 'hero.png'))::text, 'UTF8'))
insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
select 'a7200000-0000-4000-8000-00000000000b', :ALDER, encode(sha256(b.bytes), 'hex'), 'application/json', octet_length(b.bytes), b.bytes
  from b;
insert into p72_harness.fixture (kind, id) values ('bundle_json', 'a7200000-0000-4000-8000-00000000000b');

-- Alder's site keeps its seeded status (provisioning): the flip reads every
-- bundle WHATEVER the site's status (R1 step 4).
insert into organization_sites (organization_id, repo, status)
values (:ALDER, 'presby-fixtures/p72-alder', 'provisioning')
on conflict (organization_id) do nothing;
update organization_sites set content_bundle_key = 'a7200000-0000-4000-8000-00000000000b' where organization_id = :ALDER;

-- Bramblewood: a site whose bundle is not parseable JSON (the notice path).
insert into organization_sites (organization_id, repo, status, content_bundle_key)
values (:BRAMBLE, 'presby-fixtures/p72-bramble', 'live', 'a7200000-0000-4000-8000-00000000000a')
on conflict (organization_id) do update set content_bundle_key = excluded.content_bundle_key;

-- The brand: current mark and wordmark; a REPLACED mark in history.
insert into organization_brands (organization_id, seed_hex, brand_token_version, updated_by, mark_asset_key, wordmark_asset_key)
values (:ALDER, '#2f4f6f', 1, :U_FOUNDING, 'a7200000-0000-4000-8000-000000000003', 'a7200000-0000-4000-8000-000000000004')
on conflict (organization_id) do update
  set mark_asset_key = excluded.mark_asset_key, wordmark_asset_key = excluded.wordmark_asset_key;
insert into organization_brand_history (organization_id, action, seed_hex, mark_asset_key, changed_by)
values (:ALDER, 'updated', '#2f4f6f', 'a7200000-0000-4000-8000-000000000005', :U_FOUNDING);

-- A ticket with an image attachment (a private consumer, NOT in the flip set).
insert into tickets (id, organization_id, submitter_person_id, subject, change_class, area)
values ('a7200000-0000-4000-8000-0000000000a1', :ALDER, :PRIYA, 'p72 fixture ticket', 'bug', 'website');
insert into ticket_messages (organization_id, ticket_id, author_kind, author_person_id, body, attachment_asset_key)
values (:ALDER, 'a7200000-0000-4000-8000-0000000000a1', 'submitter', :PRIYA, 'p72 screenshot attached',
        'a7200000-0000-4000-8000-000000000007');

commit;

\echo 'p72 preimage: fixture committed'
select kind, id from p72_harness.fixture order by kind;
