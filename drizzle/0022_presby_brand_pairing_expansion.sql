-- ---------------------------------------------------------------------------
-- organization_brands — widen the curated type_pairing set (DECISION-093)
-- ---------------------------------------------------------------------------
-- Adds "contemporary" (Montserrat / Open Sans) as a fourth curated,
-- self-hosted heading/body pairing — same mechanism as classic/modern/warm,
-- no A8 tradeoff (see src/lib/brand/fonts.ts's header comment). Idempotent by
-- construction: drop-if-exists then add is safe to re-run, since widening a
-- CHECK never invalidates existing rows (same pattern as
-- blob_assets_content_type_allowed, widened twice in 0019/0020).
alter table organization_brands drop constraint if exists organization_brands_type_pairing_allowed;
alter table organization_brands
  add constraint organization_brands_type_pairing_allowed
  check (type_pairing in ('classic', 'modern', 'warm', 'contemporary'));

comment on table organization_brands is
  'Per-org brand (DECISION-049). PK is organization_id itself — a DEGENERATE composite key, one row per org, nothing to unique(id, organization_id) against. type_pairing is one of classic, modern, warm, contemporary (DECISION-093 widened the curated set from 3 to 4). NO PUBLIC GRANT ON THIS TABLE, EVER: organizations carries a bare grant because the org tree is public, and following that pattern here is the enumeration oracle DECISION-049 rejects by name.';
