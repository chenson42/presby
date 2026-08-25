-- organization_brands — add light_only (Per-Organization Light-Only Brand
-- Mode, docs/work-log/2026-08-24-light-only-brand.md Phase 4, schema slice).
--
-- An org's brand can opt out of dark mode entirely: its public site and
-- member portal never render the dark theme regardless of visitor system
-- preference. The mechanism enforcing that (extending <BrandTokens>'s
-- existing :root:root.dark emission block to also re-declare the seven
-- platform-fixed tokens at their light values when this flag is set) lives
-- in src/components/brand/brand-tokens.tsx and is out of scope for this
-- migration — this file only adds the column the read path needs.
--
-- Hand-authored per CLAUDE.md / docs/TODO.md: `npm run db:generate`
-- reproducibly fails on the pre-existing drizzle/meta/0008-0012 snapshot
-- collision (confirmed again 2026-08-24, identical error to the one logged
-- in docs/TODO.md), so every migration past 0012 is hand-authored and
-- manually registered in drizzle/meta/_journal.json, matching the house
-- style set by 0013-0022. Idempotent by construction.

alter table organization_brands
  add column if not exists light_only boolean not null default false;

comment on table organization_brands is
  'Per-org brand (DECISION-049). PK is organization_id itself — a DEGENERATE composite key, one row per org, nothing to unique(id, organization_id) against. type_pairing is one of classic, modern, warm, contemporary (DECISION-093 widened the curated set from 3 to 4). light_only (docs/work-log/2026-08-24-light-only-brand.md): when true, this org''s public site and member portal never render the dark theme, regardless of visitor system preference — default false, so every existing brand keeps today''s behavior. NO PUBLIC GRANT ON THIS TABLE, EVER: organizations carries a bare grant because the org tree is public, and following that pattern here is the enumeration oracle DECISION-049 rejects by name.';
