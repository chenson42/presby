-- Public organization websites — database-admin's commit (1 of 3) of
-- docs/work-log/2026-08-20-public-sites.md Phase 4.
--
-- DECISION-081: the sites-status table is `organization_sites`, shaped like
-- `organization_brands` (degenerate PK = organization_id, FORCE RLS, no
-- public grant, no presby_app table grant either — the only presby_app
-- access is through presby_published_site() below).
-- DECISION-083: `site_contact_messages` is a genuine composite-key tenant
-- table, FORCE RLS, shaped like `congregation_feedback`/`ticket_messages`.
-- DECISION-088: `blob_assets` widens again to admit `application/json` (the
-- normalized site content bundle) — bundled here with the pre-existing
-- Drizzle/DB drift fix (Phase 2 Note 7; see src/lib/db/domain/assets.ts).
--
-- Two new tables, their own FORCE-RLS/grant block (mirrors
-- 0016_presby_brand_storage.sql's brand_tables loop and
-- 0019_presby_ticket_support.sql's support_tables loop exactly — both
-- postdate 0009's original tenant_tables loop), one narrow SECURITY DEFINER
-- read function (presby_published_site, mirrors presby_membership_is_active's
-- shape from 0015_presby_membership_probe.sql), and the blob_assets CHECK
-- widening.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. organization_sites (DECISION-081)
-- ---------------------------------------------------------------------------
create table if not exists organization_sites (
  -- Degenerate PK — one row per org, matching organization_brands.
  organization_id          uuid primary key references organizations(id) on delete cascade,
  -- "org/site-<slug>" — the GitHub Actions OIDC token's `repository` claim
  -- is matched against this string exactly (resolveOrganizationByRepo()).
  repo                     text not null unique,
  status                   text not null default 'provisioning',
  last_ingested_commit_sha text,
  last_ingested_at         timestamptz,
  -- Composite-FK-by-convention -> blob_assets(id, organization_id); NOT
  -- expressible as a Drizzle foreignKey() in src/lib/db/domain/sites.ts for
  -- the identical reason organization_brands.mark_asset_key isn't (assets.ts
  -- <-> org.ts/sites.ts import cycle, see assets.ts's own comment).
  -- Enforced below (section 3), migration-only.
  content_bundle_key       uuid,
  -- NULLABLE, unlike organization_brands.updated_by: machine ingest writes
  -- (recordSiteIngest) have no users.id to attribute; NULL there, set on
  -- admin-initiated provision/status-change writes.
  updated_by               uuid references users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_sites_status_allowed'
  ) then
    alter table organization_sites add constraint organization_sites_status_allowed
      check (status in ('provisioning', 'live', 'suspended'));
  end if;
end $$;

comment on table organization_sites is
  'Per-org public-site provisioning/status (DECISION-081). PK is organization_id itself — a DEGENERATE composite key, one row per org, matching organization_brands. FORCE RLS, and there is NO PUBLIC GRANT and NO presby_app TABLE GRANT, EVER: the only tenant-connection access to this table is through presby_published_site()''s EXECUTE grant. Written exclusively through getPlatformDb() — provisioning (admin operator) and ingest (OIDC-verified machine caller) are both "verified, no membership" callers, the same shape organization_brands already established.';

-- ---------------------------------------------------------------------------
-- 2. site_contact_messages (DECISION-083)
-- ---------------------------------------------------------------------------
create table if not exists site_contact_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,   -- visitor-supplied
  email            text not null,   -- visitor-supplied, for a role-holder to reply out-of-band
  body             text not null,
  status           text not null default 'new',
  created_at       timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_contact_messages_status_allowed'
  ) then
    alter table site_contact_messages add constraint site_contact_messages_status_allowed
      check (status in ('new', 'read'));
  end if;
end $$;

-- Composite-tenant-key convention (docs/schema-design.md sec 3), kept for
-- consistency even though nothing composite-FKs into this table today —
-- organization_brand_history's own precedent is the exact shape to follow.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_contact_messages_id_org_key'
  ) then
    alter table site_contact_messages
      add constraint site_contact_messages_id_org_key unique (id, organization_id);
  end if;
end $$;

-- The tenant review queue (listSiteContactMessages), same shape as
-- congregation_feedback_org_status_created_idx / tickets_org_status_created_idx.
create index if not exists site_contact_messages_org_status_created_idx
  on site_contact_messages (organization_id, status, created_at);

comment on table site_contact_messages is
  'Anonymous ContactForm submissions on a live public site (DECISION-083), FORCE RLS. Written via a blob-store.ts-style trusted-org-context call gated on organization_sites.status = ''live'', never via withOrgContext()''s membership check (the writer has no membership). Read side is a role-holder with tickets.file (DECISION-089) via /o/<slug>/tickets — no platform-side triage surface exists for this table.';

-- ---------------------------------------------------------------------------
-- 3. Composite FK: organization_sites.content_bundle_key -> blob_assets(id, organization_id)
-- ---------------------------------------------------------------------------
-- Nullable column, so MATCH SIMPLE (the default) leaves the constraint
-- unenforced until a key is actually set — identical shape to
-- organization_brands_mark_asset_fk.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_sites_content_bundle_fk'
  ) then
    alter table organization_sites
      add constraint organization_sites_content_bundle_fk
      foreign key (content_bundle_key, organization_id)
      references blob_assets (id, organization_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. presby_published_site(p_slug text) — the narrow SECURITY DEFINER reader
-- ---------------------------------------------------------------------------
-- Mirrors presby_membership_is_active's shape exactly (security definer, set
-- search_path = public, revoke all from public, grant execute to
-- presby_app) — the anonymous page reads through the plain `db` connection,
-- which authenticates as presby_app, with NO org GUC set, exactly the F26
-- shape that pattern already solves. Collapses "never provisioned",
-- "suspended", "nonexistent slug", and "org not active" into the same
-- zero-row result — the caller (getPublishedSite()) cannot tell them apart,
-- which is the enumeration-safety property Phase 1 Gap 5 requires.
create or replace function presby_published_site(p_slug text)
returns table (
  organization_id           uuid,
  organization_name         text,
  organization_type         text,
  content_bundle_key        uuid,
  brand_seed_hex             text,
  brand_type_pairing         text,
  brand_token_version        integer
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.organization_type::text,
         s.content_bundle_key,
         b.seed_hex, b.type_pairing, b.brand_token_version
    from organizations o
    join organization_sites s on s.organization_id = o.id
    left join organization_brands b on b.organization_id = o.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live';
$$;

comment on function presby_published_site(text) is
  'The ONLY presby_app-reachable read of organization_sites. Collapses never-provisioned / suspended / nonexistent-slug / org-not-active into the same zero-row result (enumeration-safety, Phase 1 Gap 5 of docs/work-log/2026-08-20-public-sites.md) — the caller cannot distinguish them. SECURITY DEFINER because the anonymous (public)/site/[slug] page reads through presby_app with NO org GUC set, the same F26 shape presby_membership_is_active already solves. Safe as definer: it takes one slug from the caller and returns projected, already-public-safe columns (org name/type, a blob key, brand tokens) — no row-level secret, no enumeration surface beyond what the org tree already publishes.';

revoke all on function presby_published_site(text) from public;
grant execute on function presby_published_site(text) to presby_app;

-- ---------------------------------------------------------------------------
-- 5. Row-level security
-- ---------------------------------------------------------------------------
-- F1: FORCE, not just ENABLE — without it the table owner (and any role that
-- shares the owner's privileges) bypasses every policy, and RLS is silently
-- inert while every naive test still passes. These two tables postdate
-- 0009's original tenant_tables loop, so they get their own block, mirroring
-- 0016_presby_brand_storage.sql's brand_tables loop and
-- 0019_presby_ticket_support.sql's support_tables loop exactly.
do $$
declare
  t text;
  site_tables text[] := array[
    'organization_sites', 'site_contact_messages'
  ];
begin
  foreach t in array site_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants — asymmetric by design (Phase 3's own call; neither table gets both)
-- ---------------------------------------------------------------------------
-- organization_sites: presby_platform full verbs (both provisioning and
-- ingest are getPlatformDb() callers). presby_app gets NO direct table
-- grant — the only presby_app access is through presby_published_site()'s
-- EXECUTE grant above. There is no tenant-facing read of organization_sites
-- itself in this pipeline (no "P4 the church's site editor", confirmed
-- dead), so a forward-looking SELECT grant (the pattern organization_brands
-- used, anticipating slice d) is deliberately NOT added here.
grant select, insert, update, delete on organization_sites to presby_platform;

-- site_contact_messages: presby_app gets select/insert/update — insert is
-- the anonymous trusted-org-context write; select/update back the
-- /o/<slug>/tickets review section (withOrgContext(), a real member).
-- presby_platform gets NO grant — unlike tickets/congregation_feedback,
-- there is no platform-side triage surface for contact messages in this
-- design (DECISION-089); granting presby_platform access with no consumer
-- would be exactly the unused-privilege surface "No Role Carries a
-- Wildcard" warns against, applied at the grant layer rather than the
-- permission layer.
grant select, insert, update on site_contact_messages to presby_app;

-- ---------------------------------------------------------------------------
-- 7. blob_assets — widened again (DECISION-088)
-- ---------------------------------------------------------------------------
-- Adds application/json for the normalized site content bundle (front-matter
-- + parsed MDX AST + resolved image-key map) — structured JSON, not one of
-- the four existing types. The ingest route's own 422-on-malformed-bundle
-- validation is the real per-consumer gate; the shared CHECK is only the
-- outer bound. Idempotent by construction: drop-if-exists then add is safe
-- to re-run, since widening a CHECK never invalidates existing rows.
alter table blob_assets drop constraint if exists blob_assets_content_type_allowed;
alter table blob_assets add constraint blob_assets_content_type_allowed
  check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/json'));

-- The byte-size bound is unchanged (10MB, set by 0019) — restated here only
-- to keep this migration's own comment self-contained; no drop/add needed
-- since the value itself doesn't change.

comment on table blob_assets is
  'Generic tenant-scoped blob storage adapter (DECISION-030/055/058). Never queried directly outside src/lib/storage/blob-store.ts. Accepts image/png, image/jpeg, image/webp, application/pdf (DECISION-071/073), and application/json (DECISION-088, the normalized site content bundle) up to 10MB. Logo was the first consumer; ticket attachments and the site content bundle are the second and third.';
