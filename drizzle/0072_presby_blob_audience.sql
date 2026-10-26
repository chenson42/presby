-- drizzle/0072_presby_blob_audience.sql
--
-- The public asset route serves only what is public (F289; DECISION-277;
-- closes treasury's F297/F298). blob_assets gains an audience
-- ('public_site' | 'private', fail-closed default 'private', immutable by
-- trigger); every current brand mark and every image a site bundle's
-- imageKeys names is flipped to 'public_site' and everything else stays
-- 'private'; the two private consumers (ticket_messages, giving_statements)
-- pin 'private' inside a three-column composite FK; both anonymous roster
-- functions withhold a photo the person has hidden (operator ruling: hide_photo
-- wins); and one SECURITY DEFINER function, presby_public_site_asset(), is the
-- only door the public asset route uses.
-- (docs/work-log/2026-10-25-public-asset-allowlist.md: Phase 2 R1-R9,
-- Phase 3 "Data Model".)
--
-- Apply (owner, direct endpoint; DDL needs it). `-1` is MANDATORY: this file
-- has no transaction of its own and builds a session temp table, and -1 is
-- what makes it atomic (the pre-flip assertion's refusal rolls back
-- everything before it):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0072_presby_blob_audience.sql
--
-- DEPLOY ORDER (R5, R9; runbook in docs/deployment.md "Pre-deploy runbook:
-- 0072"): apply this file, then promote the code, in ONE release; no
-- site-repo push, logo upload or ticket attachment in between. Old code
-- against the new schema fails closed: its inserts omit audience and land
-- 'private' (broken images until the next ingest, which a NEW commit heals);
-- a ticket upload byte-identical to a public_site image fails the new FK
-- (rare, loud). Statements are unaffected (GIVING_STATEMENTS_ENABLED is off).
--
-- Production measurement (read-only, orchestrator, 2026-10-25): 107 blobs
-- (82 images, 25 JSON, 0 PDF); 0 ticket attachments, 0 statements, 0 people
-- with photo_key; 1 mark, 0 wordmarks; 1 site with a bundle (live). So the
-- pre-flip assertion's private set is empty there, and the flip is the mark
-- plus the live bundle's images.
--
-- Idempotent: `add column if not exists`, drop-then-add for every constraint
-- except blob_assets_id_org_audience_key (added under a pg_constraint guard,
-- never dropped: on a re-run the consumer FKs depend on it), `if not exists`
-- for the index, `create or replace` for every function, drop-then-create for
-- the trigger, revoke-then-grant. A re-run flips only rows that are not yet
-- public_site and are a CURRENT mark or bundle image: it heals a private mark
-- an old-code upload left in the deploy window, and touches nothing else.
-- Proven by applying the whole file twice (work-log, Phase 4 Batch 1, and
-- scripts/assets/test-0072-migration.sh). Unreleased until applied to
-- production, so it may be corrected in place until then (CLAUDE.md ->
-- Project Layout -> drizzle/).
--
--   1. column               blob_assets.audience, default 'private' (metadata
--                           only: no rewrite, no trigger, so the 0056 guard
--                           is never reached)
--   2. vocabulary CHECK     blob_assets_audience_allowed
--   3. pre-flip assertion   raises if a flip candidate is also a ticket
--                           attachment, a statement PDF or a person photo
--   4. flip                 current marks + every bundle's imageKeys images
--   5. image CHECK          public_site implies png/jpeg/webp
--   6. dedup key            (organization_id, audience, content_hash) (F298)
--   7. FK target            unique (id, organization_id, audience)
--   8. private consumers    ticket_messages, giving_statements: constant
--                           asset_audience = 'private' in a 3-column FK
--   9. immutability         blob_assets_audience_immutable (every connection)
--  10. roster functions     hide_photo withholds the photo (both functions)
--  11. index                people (lower(photo_key)) (people is global, D1)
--  12. the door             presby_public_site_asset(org, key)
--  13. comments
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No takedown (Tier 2): a public_site image stays fetchable by its key
--     after it drops out of a bundle. Tracked follow-up (DECISION-277).
--   * No FK on people.photo_key (R4): it is text, nothing writes it, and 0
--     rows carry one in every environment. The door's photo exclusion (12)
--     covers it until the first photo writer converts it to uuid and pins it.
--   * The wordmark, replaced marks (organization_brand_history), the bundle
--     JSON itself, superseded bundles and orphans stay private (R1.4, R2).
--   * No grant change on blob_assets: presby_app keeps SELECT and INSERT
--     only, so the tenant path can never flip an audience at all.

-- ---------------------------------------------------------------------------
-- 1. The column. A constant default is a catalog-only change.
-- ---------------------------------------------------------------------------
alter table blob_assets add column if not exists audience text not null default 'private';

-- ---------------------------------------------------------------------------
-- 2. Closed vocabulary. A named CHECK (widened by drop-and-re-add, as
--    blob_assets_content_type_allowed was in 0019/0020), not an enum.
-- ---------------------------------------------------------------------------
alter table blob_assets drop constraint if exists blob_assets_audience_allowed;
alter table blob_assets add constraint blob_assets_audience_allowed check (audience in ('public_site','private'));

-- ---------------------------------------------------------------------------
-- 3 + 4. The candidate set, the pre-flip assertion, the flip.
--    A session temp table with no ON COMMIT clause (under autocommit an ON
--    COMMIT DROP table would vanish after its own statement); dropped
--    explicitly at the end of step 4. Same-org joins throughout: a bundle or
--    a brand can only ever name its own org's blobs.
-- ---------------------------------------------------------------------------
drop table if exists _blob_audience_flip;
create temp table _blob_audience_flip (organization_id uuid not null, id uuid not null, primary key (organization_id, id));

-- Every current mark (never the wordmark, never a historical mark).
insert into _blob_audience_flip (organization_id, id)
select b.organization_id, b.id
  from organization_brands ob
  join blob_assets b on b.id = ob.mark_asset_key and b.organization_id = ob.organization_id
 where b.content_type in ('image/png','image/jpeg','image/webp')
on conflict do nothing;

-- Every imageKeys value of every current bundle, WHATEVER the site's status
-- (R1.4: a suspended site that is reinstated must still have its images).
do $$
declare
  r record;
  v_keys jsonb;
begin
  for r in
    select s.organization_id, b.bytes
      from organization_sites s
      join blob_assets b on b.id = s.content_bundle_key and b.organization_id = s.organization_id
     where b.content_type = 'application/json'
  loop
    begin
      v_keys := convert_from(r.bytes, 'UTF8')::jsonb -> 'imageKeys';
    exception when others then
      raise notice '0072: the bundle of organization % is not parseable JSON; its images stay private (the site is dark anyway: hydratePublishedSite returns not_found)', r.organization_id;
      continue;
    end;
    if jsonb_typeof(v_keys) is distinct from 'object' then
      continue;
    end if;
    insert into _blob_audience_flip (organization_id, id)
    select r.organization_id, b.id
      from jsonb_each_text(v_keys) k
      join blob_assets b
        on b.organization_id = r.organization_id
       -- CASE, not AND: the cast must never run on a value that is not a uuid.
       and b.id = (case when k.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then k.value::uuid end)
     where b.content_type in ('image/png','image/jpeg','image/webp')
    on conflict do nothing;
  end loop;
end $$;

-- R1.3: fail loudly rather than ship split logic nobody needs. A blob that is
-- both published and used by a private consumer exists only under the old
-- cross-consumer dedup; production and development hold none. Also what
-- guarantees the 0056 statement guard cannot fire during the flip.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from _blob_audience_flip f
   where exists (select 1 from ticket_messages t
                  where t.organization_id = f.organization_id and t.attachment_asset_key = f.id)
      or exists (select 1 from giving_statements g
                  where g.organization_id = f.organization_id and g.blob_asset_id = f.id)
      -- people is GLOBAL (D1: no organization_id). A blob id is a globally
      -- unique uuid, so matching photo_key alone is exact, and stricter.
      or exists (select 1 from people p
                  where p.photo_key is not null and lower(p.photo_key) = f.id::text);
  if v_bad > 0 then
    raise exception '0072: % blob(s) are both published (a mark or a bundle image) and used by a private consumer (a ticket attachment, a contribution statement or a person photo); resolve that before applying (docs/work-log/2026-10-25-public-asset-allowlist.md, R1 step 3)', v_bad
      using errcode = 'check_violation';
  end if;
end $$;

-- Re-run safety: on a second application the trigger from step 9 exists and
-- would refuse the heal. It is re-created below, after the flip.
drop trigger if exists blob_assets_audience_immutable on blob_assets;

do $$
declare
  v_n integer;
begin
  update blob_assets b set audience = 'public_site'
    from _blob_audience_flip f
   where b.id = f.id and b.organization_id = f.organization_id and b.audience <> 'public_site';
  get diagnostics v_n = row_count;
  raise notice '0072: flipped % blob(s) to public_site', v_n;
end $$;

drop table _blob_audience_flip;

-- ---------------------------------------------------------------------------
-- 5. A public_site row is an image, as a database property. After the flip,
--    so the flip is image-only by construction. The route's own type test
--    stays as a second, independent check.
-- ---------------------------------------------------------------------------
alter table blob_assets drop constraint if exists blob_assets_public_site_is_image;
alter table blob_assets add constraint blob_assets_public_site_is_image check (audience = 'private' or content_type in ('image/png','image/jpeg','image/webp'));

-- ---------------------------------------------------------------------------
-- 6. Dedup is per audience (F298): a private upload byte-identical to a
--    public image is its own row, and never resolves to the public one.
-- ---------------------------------------------------------------------------
alter table blob_assets drop constraint if exists blob_assets_org_hash_key;
alter table blob_assets drop constraint if exists blob_assets_org_audience_hash_key;
alter table blob_assets add constraint blob_assets_org_audience_hash_key unique (organization_id, audience, content_hash);

-- ---------------------------------------------------------------------------
-- 7. The FK target. Guarded, never dropped: on a re-run the consumer FKs
--    (step 8) already depend on it. The name is fixed: treasury's 0073
--    receipt FK targets it. blob_assets_id_org_key STAYS (the brand and site
--    FKs reference it).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blob_assets_id_org_audience_key') then
    alter table blob_assets add constraint blob_assets_id_org_audience_key unique (id, organization_id, audience);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The private consumers pin 'private'. Constant column, same constraint
--    names, NO ACTION on both sides (F44: a referenced PDF stays undeletable
--    on every connection). MATCH SIMPLE (the default) keeps a null
--    attachment unchecked. ADD COLUMN with a constant default and ADD
--    CONSTRAINT fire neither giving_statements_freeze (BEFORE UPDATE) nor
--    the insert guard. giving_statements_blob_idx (organization_id,
--    blob_asset_id) still serves the RI check.
-- ---------------------------------------------------------------------------
alter table ticket_messages add column if not exists asset_audience text not null default 'private';
alter table ticket_messages drop constraint if exists ticket_messages_asset_audience_private;
alter table ticket_messages add constraint ticket_messages_asset_audience_private check (asset_audience = 'private');
alter table ticket_messages drop constraint if exists ticket_messages_attachment_fk;
alter table ticket_messages add constraint ticket_messages_attachment_fk
  foreign key (attachment_asset_key, organization_id, asset_audience)
  references blob_assets (id, organization_id, audience);

alter table giving_statements add column if not exists asset_audience text not null default 'private';
alter table giving_statements drop constraint if exists giving_statements_asset_audience_private;
alter table giving_statements add constraint giving_statements_asset_audience_private check (asset_audience = 'private');
alter table giving_statements drop constraint if exists giving_statements_blob_fk;
alter table giving_statements add constraint giving_statements_blob_fk
  foreign key (blob_asset_id, organization_id, asset_audience)
  references blob_assets (id, organization_id, audience) on delete no action on update no action;

-- ---------------------------------------------------------------------------
-- 9. audience is immutable, on EVERY connection: presby_platform and the
--    owner (getPlatformDb() is neondb_owner) hold UPDATE, and only a trigger
--    binds them (F44). Created after the flip. SECURITY INVOKER: it reads no
--    relation, so DEFINER would be cargo cult (DECISION-121 precedent).
--    Independent of blob_assets_giving_statement_guard (0056 6e): both are
--    BEFORE UPDATE, either may raise, neither reads the other.
-- ---------------------------------------------------------------------------
create or replace function presby_blob_assets_audience_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'blob_assets %: audience is immutable (% to %)', old.id, old.audience, new.audience
    using errcode = 'check_violation';
end $$;

revoke all on function presby_blob_assets_audience_immutable() from public, presby_app, presby_platform;

drop trigger if exists blob_assets_audience_immutable on blob_assets;
create trigger blob_assets_audience_immutable before update of audience on blob_assets
  for each row when (old.audience is distinct from new.audience)
  execute function presby_blob_assets_audience_immutable();

-- ---------------------------------------------------------------------------
-- 10. The roster functions: hide_photo wins (operator ruling, 2026-10-25).
--     The bodies are 0042's with ONLY these changes, in every branch:
--       left join person_privacy pp on pp.person_id = p.id
--       case when coalesce(pp.hide_photo, false) then null else p.photo_key end as photo_key
--     person_privacy's primary key is person_id ALONE: a person has at most
--     one privacy row, the member's own choice, tagged with the org it was set
--     in. Joined on person_id alone, so a hidden photo stays hidden on EVERY
--     org's public list, not only that org's (fail closed: a person listed at
--     a presbytery and a congregation who hid their photo at one is not
--     published at the other). The authenticated member directory scopes the
--     same row to the viewing org (src/lib/directory.ts); the public surface
--     is deliberately the stricter of the two. people is global (D1) and has
--     no organization_id; a missing row means hide_photo false, the column's
--     own default.
--     The person stays listed; only the photo is withheld. No other condition
--     changes (no directory_hidden, no merge handling). Signatures and result
--     rows are unchanged, so create or replace is legal and no caller moves.
--     create or replace REPLACES proconfig, so 0048's search_path pin is
--     restated here (it would otherwise be lost silently); the revoke and
--     grant are restated too (create or replace keeps the ACL; belt and
--     braces). presby_public_site_asset (12) calls these, so the page and the
--     asset door read one definition of "listed".
-- ---------------------------------------------------------------------------
create or replace function presby_public_staff_roster(
  p_slug text,
  p_kind text default null,
  p_has_priority boolean default null
)
returns table (
  kind         text,
  role_raw     text,
  department   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.kind, u.role_raw, u.department, u.display_name, u.photo_key
    from (
      select 'staff' as kind, sp.position as role_raw, sp.department,
             coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
             case when coalesce(pp.hide_photo, false) then null else p.photo_key end as photo_key,
             sp.public_display_order
        from staff_positions sp
        join organizations o on o.id = sp.organization_id
        join organization_sites s on s.organization_id = o.id
        join people p on p.id = sp.person_id
        left join person_privacy pp on pp.person_id = p.id
       where o.slug = p_slug
         and o.status = 'active'
         and s.status = 'live'
         and sp.public_listed
         and sp.ends_on is null
      union all
      select 'officer' as kind, ot.office as role_raw, null as department,
             coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
             case when coalesce(pp.hide_photo, false) then null else p.photo_key end as photo_key,
             ot.public_display_order
        from officer_terms ot
        join organizations o on o.id = ot.organization_id
        join organization_sites s on s.organization_id = o.id
        join people p on p.id = ot.person_id
        left join person_privacy pp on pp.person_id = p.id
       where o.slug = p_slug
         and o.status = 'active'
         and s.status = 'live'
         and ot.public_listed
         and ot.ends_on is null
    ) u
   where (p_kind is null or u.kind = p_kind)
     and (p_has_priority is not true or u.public_display_order is not null)
   order by coalesce(u.public_display_order, 2147483647), u.display_name;
$$;

comment on function presby_public_staff_roster(text, text, boolean) is
  'Widened (docs/work-log/2026-08-28-public-directory-primitives.md) with optional p_kind/p_has_priority filter parameters. Department/office matching stays in TypeScript (getPublicStaffRoster()), never duplicated here, because office LABELS live in exactly one place (OFFICE_LABELS, DECISION-131) and this function must not grow a second copy. Ordering is always coalesce(public_display_order, 2147483647), display_name so an org that never curates gets alphabetical for free. drizzle/0072 (DECISION-277, operator ruling hide_photo wins): photo_key is null for a person whose person_privacy.hide_photo is set; the person stays listed. presby_public_site_asset() calls this function, so the asset door serves exactly the photos this lists.';

revoke all on function presby_public_staff_roster(text, text, boolean) from public;
grant execute on function presby_public_staff_roster(text, text, boolean) to presby_app;

create or replace function presby_public_committee_roster(
  p_slug text,
  p_committee text default null,
  p_has_priority boolean default null
)
returns table (
  group_name   text,
  group_role   text,
  display_name text,
  photo_key    text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.name as group_name, gm.group_role,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         case when coalesce(pp.hide_photo, false) then null else p.photo_key end as photo_key
    from group_memberships gm
    join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
    join organizations o on o.id = gm.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = gm.person_id
    left join person_privacy pp on pp.person_id = p.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.ends_on is null
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;

comment on function presby_public_committee_roster(text, text, boolean) is
  'Anonymous, unauthenticated read backing the (public)/site/[slug] committeeDirectory liveSlot (docs/work-log/2026-08-28-public-directory-primitives.md). g.membership_source = ''managed'' is defense-in-depth: a derived Session/Diaconate group_memberships row can never surface here even under a future application-layer bug, mirroring groups.ts''s own two-layer discipline. group_name is the only grouping identifier ever projected; group_id is never selected. drizzle/0072 (DECISION-277, operator ruling hide_photo wins): photo_key is null for a person whose person_privacy.hide_photo is set; the member stays listed. presby_public_site_asset() calls this function, so the asset door serves exactly the photos this lists.';

revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;

-- ---------------------------------------------------------------------------
-- 11. Serves the door's photo exclusion and the pre-flip assertion, which
--     compare lower(photo_key) to the canonical lowercase key: an index on
--     the plain column could not serve that (tech-lead departure (a) from
--     R1.11). people is GLOBAL (D1) and has no organization_id, so the key is
--     lower(photo_key) alone (and the index is not named for an org).
--     Partial: empty everywhere today.
-- ---------------------------------------------------------------------------
create index if not exists people_photo_key_lower_idx on people (lower(photo_key)) where photo_key is not null;

-- ---------------------------------------------------------------------------
-- 12. The one door the public asset route uses (R3). Anonymous: presby_app
--     calls it with NO org context, handing it only the organization id
--     resolveSiteOrganization() returned and the uuid key. Every check is in
--     one statement, and every miss is zero rows:
--       gates   the org is active, its site is live, the blob is the org's
--               own, and it is png/jpeg/webp;
--       photo   a key that is ANY person's photo_key is governed by listing
--               ALONE: served (class 'roster') only while one of the two
--               roster functions lists it for this org, whatever the row's
--               audience. people is global (D1), so "any person" is matched
--               on the key alone; the blob itself is still this org's. So a future photo writer that wrongly stores a
--               photo as public_site still cannot leak an unlisted person's
--               photo (what makes deferring the photo_key FK safe, R4);
--       site    otherwise served (class 'site') only if the row is
--               public_site.
--     The bytes are read for the one row returned; a private row and a
--     nonexistent key take the same path. The CASE keeps the roster call off
--     the hot path: only a photo key pays for it. organization_sites has one
--     row per organization, so the site join cannot fan out. The slug the
--     roster functions need is read from organizations, never from the
--     request. Owned by the migration owner, which holds EXECUTE on the
--     roster functions (their ACL is owner + presby_app).
-- ---------------------------------------------------------------------------
create or replace function presby_public_site_asset(p_org uuid, p_key uuid)
returns table (content_type text, bytes bytea, cache_class text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select b.content_type, b.bytes, case when ph.is_photo then 'roster' else 'site' end
    from organizations o
    join organization_sites s on s.organization_id = o.id
    join blob_assets b on b.organization_id = o.id and b.id = p_key
   cross join lateral (
         select exists (select 1 from people pe
                         where pe.photo_key is not null
                           and lower(pe.photo_key) = p_key::text) as is_photo) ph
   where o.id = p_org
     and o.status = 'active'
     and s.status = 'live'
     and b.content_type in ('image/png','image/jpeg','image/webp')
     and case
           when ph.is_photo then exists (
                  select 1
                    from (select r.photo_key from presby_public_staff_roster(o.slug) r
                          union all
                          select r.photo_key from presby_public_committee_roster(o.slug) r) x
                   where x.photo_key is not null
                     and lower(x.photo_key) = p_key::text)
           else b.audience = 'public_site'
         end;
$$;

revoke all on function presby_public_site_asset(uuid, uuid) from public;
grant execute on function presby_public_site_asset(uuid, uuid) to presby_app;

-- ---------------------------------------------------------------------------
-- 13. Comments.
-- ---------------------------------------------------------------------------
comment on function presby_public_site_asset(uuid, uuid) is
  'The only door the public asset route (/site/<slug>/assets/<key> and /assets/<key> on a custom host) uses, through blob-store.ts resolvePublic() (drizzle/0072, F289, DECISION-277). Zero rows for every miss. Serves a png/jpeg/webp blob of an active org with a live site when EITHER the key is a person''s photo_key that presby_public_staff_roster()/presby_public_committee_roster() currently list (cache_class roster) OR, for any key that is not a person photo, the row is public_site (cache_class site). Tier 1: no takedown of a public_site image that dropped out of a bundle.';
comment on function presby_blob_assets_audience_immutable() is
  'Trigger function for blob_assets_audience_immutable (drizzle/0072, DECISION-277): an audience never changes once stored, on any connection including the owner. EXECUTE held by its owner alone.';
comment on column blob_assets.audience is
  'public_site | private (drizzle/0072, DECISION-277). Default private, permanently: a writer that forgets it fails closed. public_site implies an image type (blob_assets_public_site_is_image) and is what the public asset route may serve; private consumers pin private by composite FK. Immutable by trigger. store() takes it as a required argument.';
comment on column ticket_messages.asset_audience is
  'Constant private (CHECK). Part of ticket_messages_attachment_fk (attachment_asset_key, organization_id, asset_audience) -> blob_assets (id, organization_id, audience): an attachment can never be a public_site blob (drizzle/0072, DECISION-277).';
comment on column giving_statements.asset_audience is
  'Constant private (CHECK). Part of giving_statements_blob_fk (blob_asset_id, organization_id, asset_audience) -> blob_assets (id, organization_id, audience), NO ACTION both ways: the statement PDF is never a public_site blob and stays undeletable while referenced (drizzle/0072, DECISION-277, F44).';
