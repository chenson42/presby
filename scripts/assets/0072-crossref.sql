-- scripts/assets/0072-crossref.sql - D5 step 5 (docs/work-log/2026-10-25-
-- public-asset-allowlist.md, Phase 3 "Test Plan" D5): R1 step 3's pre-flip
-- assertion REFUSES a blob that is both published (here: an image Alder's
-- bundle names) and used by a private consumer (here: a ticket attachment).
--
-- Driven by scripts/assets/test-0072-migration.sh on the SCRATCH database at
-- the pre-0072 state left by 0072-preimage.sql. The cross-reference and the
-- whole of 0072 run in ONE transaction (what `psql -1` does), so the expected
-- failure rolls BOTH back: the driver then checks the audience column is
-- absent and the extra ticket message is gone. This also proves the owner
-- connection SEES ticket_messages under FORCE RLS (F26): an assertion that
-- could not see the row would pass silently.
--
-- Expected: psql exits non-zero with
--   0072: 1 blob(s) are both published (a mark or a bundle image) and used by a private consumer ...
\set ON_ERROR_STOP on
begin;
insert into ticket_messages (organization_id, ticket_id, author_kind, author_person_id, body, attachment_asset_key)
values ('22222222-2222-2222-2222-222222222222', 'a7200000-0000-4000-8000-0000000000a1', 'submitter',
        'c0000000-0000-0000-0000-000000000003', 'p72 crossref: the bundle hero image, attached to a ticket',
        'a7200000-0000-4000-8000-000000000001');
\ir ../../drizzle/0072_presby_blob_audience.sql
commit;
