-- P0.5 slice c1 — brand storage schema.
--
-- Three tables, none of which Drizzle Kit can fully express:
--
--   organization_brands          PK IS organization_id (degenerate composite
--                                 key — one row per org). FORCE RLS. No public
--                                 grant, EVER (DECISION-049).
--   organization_brand_history   'updated' | 'neutralized' only, never
--                                 'created' (DECISION-059).
--   blob_assets                  the generic storage adapter (DECISION-030,
--                                 DECISION-055, DECISION-058). Content-
--                                 addressed dedup, SVG rejected, 2MB cap, all
--                                 as CHECK constraints — not just app-level
--                                 validation.
--
-- Every statement here is idempotent: this migration may be re-run against a
-- database that already has some or all of it applied.
--
-- Full rationale: docs/decisions.md DECISION-049/055/058/059,
-- docs/work-log/2026-08-19-brand-foundation.md Phase 3 (re-run) "Data model".

-- ---------------------------------------------------------------------------
-- blob_assets
-- ---------------------------------------------------------------------------
create table if not exists blob_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  content_hash     text not null,
  content_type     text not null,
  byte_size        integer not null,
  bytes            bytea not null,
  created_at       timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'blob_assets_id_org_key'
  ) then
    alter table blob_assets
      add constraint blob_assets_id_org_key unique (id, organization_id);
  end if;
end $$;

-- The dedup key store() checks before inserting (E-c6): two uploads of
-- byte-identical content within one org resolve to the same row.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'blob_assets_org_hash_key'
  ) then
    alter table blob_assets
      add constraint blob_assets_org_hash_key unique (organization_id, content_hash);
  end if;
end $$;

-- Raster only. SVG rejected at the schema (G7) — <script> and
-- <foreignObject> make sanitising it its own project.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'blob_assets_content_type_allowed'
  ) then
    alter table blob_assets
      add constraint blob_assets_content_type_allowed
      check (content_type in ('image/png', 'image/jpeg', 'image/webp'));
  end if;
end $$;

-- The 2MB cap (Flow 2: "That file is 12 MB — we can take up to 2 MB.").
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'blob_assets_byte_size_bounds'
  ) then
    alter table blob_assets
      add constraint blob_assets_byte_size_bounds
      check (byte_size > 0 and byte_size <= 2097152);
  end if;
end $$;

comment on table blob_assets is
  'Generic tenant-scoped blob storage adapter (DECISION-030/055/058). Never queried directly outside src/lib/storage/blob-store.ts. Logo is the first consumer.';

-- ---------------------------------------------------------------------------
-- organization_brands
-- ---------------------------------------------------------------------------
create table if not exists organization_brands (
  organization_id     uuid primary key references organizations(id) on delete cascade,
  seed_hex            text not null,
  type_pairing        text not null default 'classic',
  mark_asset_key      uuid,
  wordmark_asset_key  uuid,
  brand_token_version integer not null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid not null references users(id)
);

-- A7's rule ("never echo the user's string") gets database-level teeth: the
-- generator parses this into numbers, nothing ever re-emits it verbatim into
-- CSS, and the database refuses a value that isn't already a parsed 6-digit
-- lowercase hex triple.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_brands_seed_hex_format'
  ) then
    alter table organization_brands
      add constraint organization_brands_seed_hex_format
      check (seed_hex ~ '^#[0-9a-f]{6}$');
  end if;
end $$;

-- Curated set (src/lib/brand/contract.ts TYPE_PAIRINGS): classic, modern,
-- warm, contemporary — see 0022_presby_brand_pairing_expansion.sql for the
-- widening migration. Adding a pairing later is a migration, deliberately —
-- a curated set that grows silently isn't curated.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_brands_type_pairing_allowed'
  ) then
    alter table organization_brands
      add constraint organization_brands_type_pairing_allowed
      check (type_pairing in ('classic', 'modern', 'warm'));
  end if;
end $$;

-- Composite FKs to blob_assets(id, organization_id) — not expressible in
-- src/lib/db/domain/org.ts without a circular module dependency between
-- org.ts and assets.ts; see assets.ts's comment on blobAssets. Nullable
-- columns, so MATCH SIMPLE (the default) leaves the constraint unenforced
-- until a key is actually set.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_brands_mark_asset_fk'
  ) then
    alter table organization_brands
      add constraint organization_brands_mark_asset_fk
      foreign key (mark_asset_key, organization_id)
      references blob_assets (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_brands_wordmark_asset_fk'
  ) then
    alter table organization_brands
      add constraint organization_brands_wordmark_asset_fk
      foreign key (wordmark_asset_key, organization_id)
      references blob_assets (id, organization_id);
  end if;
end $$;

comment on table organization_brands is
  'Per-org brand (DECISION-049). PK is organization_id itself — a DEGENERATE composite key, one row per org, nothing to unique(id, organization_id) against. NO PUBLIC GRANT ON THIS TABLE, EVER: organizations carries a bare grant because the org tree is public, and following that pattern here is the enumeration oracle DECISION-049 rejects by name.';

-- ---------------------------------------------------------------------------
-- organization_brand_history
-- ---------------------------------------------------------------------------
create table if not exists organization_brand_history (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  action               text not null,
  seed_hex             text,
  type_pairing         text,
  mark_asset_key       uuid,
  wordmark_asset_key   uuid,
  brand_token_version  integer,
  changed_by           uuid not null references users(id),
  changed_at           timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_brand_history_id_org_key'
  ) then
    alter table organization_brand_history
      add constraint organization_brand_history_id_org_key unique (id, organization_id);
  end if;
end $$;

-- DECISION-059: only 'updated' and 'neutralized' rows are ever recorded.
-- There is nothing to restore TO from a creation event — the state before a
-- first-ever brand is the platform default, which needs no row.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_brand_history_action_allowed'
  ) then
    alter table organization_brand_history
      add constraint organization_brand_history_action_allowed
      check (action in ('updated', 'neutralized'));
  end if;
end $$;

create index if not exists organization_brand_history_org_idx
  on organization_brand_history (organization_id, changed_at);

comment on table organization_brand_history is
  'Brand change history (DECISION-059). Records only updated/neutralized rows, never created. Gives "restore previous brand" a swatch AND a date, and answers "who made our website purple."';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- F1: FORCE, not just ENABLE — without it the table owner (and any role that
-- shares the owner's privileges) bypasses every policy, and RLS is silently
-- inert while every naive test still passes.
do $$
declare
  t text;
  brand_tables text[] := array[
    'blob_assets', 'organization_brands', 'organization_brand_history'
  ];
begin
  foreach t in array brand_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- presby_platform: table grants from 0009_presby_rls.sql's "grant ... on ALL
-- TABLES in schema public" only covered tables that existed at THAT
-- migration's execution time. Every table created since needs its own grant,
-- or the platform connection (which is how /admin/organizations writes these
-- rows today — no tenant self-serve editor exists yet) cannot reach them.
grant select, insert, update, delete on blob_assets, organization_brands, organization_brand_history
  to presby_platform;

-- presby_app: standard tenant grant, declared now (per the architect's
-- ruling) so slice d's withOrgContext()-based editor needs no migration of
-- its own to start reading/writing through RLS.
--
-- blob_assets deliberately gets SELECT and INSERT only — the BlobStore
-- interface is store()/resolve(), never update or delete. There is no
-- "replace these bytes" operation; a changed logo is a NEW row (new content
-- hash), and nothing in this slice deletes a blob.
grant select, insert on blob_assets to presby_app;

-- organization_brands / organization_brand_history get the full standard
-- verb set, matching every other tenant table's grant in
-- 0009_presby_rls.sql's tenant_isolation loop — NOT a "public" grant, because
-- it is paired with the FORCE RLS policy above. That pairing is the whole
-- point: see the comment on the table itself for what a BARE grant here would
-- mean (DECISION-049's "no public grant, ever").
grant select, insert, update, delete on organization_brands, organization_brand_history
  to presby_app;
