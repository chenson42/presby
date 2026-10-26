-- ---------------------------------------------------------------------------
-- OPTIONAL dev fixture: a content bundle for Fernwood that carries the
-- `eventsCalendar` live slot, so /site/fernwood can be browsed in dev
-- (docs/work-log/2026-10-25-public-events-calendar.md, Phase 4 Batch 4).
--
-- Deliberately NOT included by scripts/seed-dev.sql (the seed-dev patch only
-- adds seed-dev-public-calendar.sql): a Fernwood bundle turns /site/fernwood from
-- a 404 into a page, and nothing in scripts/ or e2e/ should have to know that.
-- Run it by hand, as the owner, after seed-dev-public-calendar.sql:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/public-calendar/seed-dev-bundle.sql
--
-- and read the page at /site/fernwood (with sites.public_render ON). To undo it:
--
--     update organization_sites set content_bundle_key = null
--      where organization_id = '55555555-5555-5555-5555-555555555555';
--
-- Idempotent: the blob is content-addressed (organization, hash), and the site
-- row is simply pointed at it. Synthetic content only (No Real Data).
-- ---------------------------------------------------------------------------
begin;

with doc as (
  select convert_to(
           '{"schemaVersion":1,"imageKeys":{},"pages":[{"path":"/","frontMatter":{"title":"Fernwood Fellowship","navLabel":"Home"},"mdxAst":{"blocks":['
        || '{"type":"hero","props":{"heading":"Fernwood Fellowship"}},'
        || '{"type":"prose","props":{"body":"Welcome. Here is what is coming up."}},'
        || '{"type":"liveSlot","props":{"slot":"eventsCalendar"}}'
        || ']}}]}', 'UTF8') as bytes
),
ins as (
  insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
  select '55555555-5555-5555-5555-555555555555',
         encode(sha256(doc.bytes), 'hex'), 'application/json', length(doc.bytes), doc.bytes
    from doc
  on conflict (organization_id, content_hash) do nothing
  returning id
)
update organization_sites
   set content_bundle_key = coalesce(
         (select id from ins),
         (select b.id from blob_assets b, doc
           where b.organization_id = '55555555-5555-5555-5555-555555555555'
             and b.content_hash = encode(sha256(doc.bytes), 'hex'))),
       last_ingested_at = now()
 where organization_id = '55555555-5555-5555-5555-555555555555';

commit;
