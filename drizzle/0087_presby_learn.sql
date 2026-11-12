-- drizzle/0087_presby_learn.sql
--
-- Learn, Increment 1a: Spot the scam - the anonymous toggle read
-- (docs/work-log/2026-11-10-learn-inc1a.md, Phase 2 rulings 1, 2 and 5,
-- Phase 3 "Data Model"; parent docs/work-log/2026-11-10-learn.md;
-- DECISION-330 and DECISION-331).
--
-- No table, no column, no index. Three things and their comments, in
-- dependency order:
--
--   1. organization_feature_categories CHECK   admits 'learn' (DECISION-330)
--   2. presby_learn_enabled(p_org, p_key)       owner-only predicate: the
--                                              toggle composed in SQL over a
--                                              CLOSED list of Learn keys
--   3. presby_public_learn(p_slug, p_key)       the one anonymous entry point
--                                              (SECURITY DEFINER, presby_app)
--   4. comments
--
-- The whole file is idempotent: one atomic drop-and-add of the CHECK,
-- `create or replace` for both functions, revoke-then-grant (F38: a re-apply
-- corrects a hand-added grant). Proven by applying the whole file twice
-- (work-log, Phase 4 Batch 1). A later Learn key extends presby_learn_enabled's
-- two CASE lists with `create or replace` in ITS OWN migration (Rule 16
-- serializes them); src/lib/learn/learn-toggle.test.ts reads the LATEST
-- definition across drizzle/*.sql, so a later migration is what it pins.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md). Drizzle mirror of the CHECK:
-- src/lib/db/domain/org-feature-categories.ts. Neither function has a Drizzle
-- mirror (Drizzle does not model functions).
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No backfill of organization_feature_categories: a missing category row
--     is ON (DECISION-130), so no existing organization changes state.
--   * No toggle row: org_portal.spot_the_scam is provisioned OFF (a missing
--     toggle row is off).
--   * No feature_flags row: no global flag (operator rule, no new platform
--     flags pre-live). The per-organization toggle is the whole off switch.
--   * No grant on presby_learn_enabled to anyone: it is callable only from
--     inside a definer, where it runs as the owner.

-- ===========================================================================
-- 1. The category CHECK (DECISION-330)
-- ===========================================================================
-- The name is the live one: the unnamed inline CHECK of drizzle/0040 takes
-- `organization_feature_categories_category_check` (read from pg_constraint on
-- development and on pipeline-learn, 2026-11-11). Dropped and re-added in ONE
-- statement, so the table is never without the constraint. `administration`
-- stays refused: it is a portal domain, never a selectable category
-- (DECISION-130, Phase 1 Gap 2 of the feature-categories pipeline).
alter table organization_feature_categories
  drop constraint if exists organization_feature_categories_category_check,
  add constraint organization_feature_categories_category_check
    check (category in ('people', 'worship', 'giving', 'governance', 'reports',
                        'communications', 'learn'));

-- ===========================================================================
-- 2. presby_learn_enabled(p_org, p_key) - owner-only (DECISION-331)
-- ===========================================================================
-- In English: true exactly when p_key is one of the Learn keys listed in the
-- two CASE expressions below AND the organization p_org exists AND
--   (a) its organization_type is in the key's allow-list, or the key has no
--       allow-list (org_types null); AND
--   (b) the category axis is off (the feature_flags row
--       org_portal.feature_categories is missing or false), or the
--       organization's row for the key's category is missing or true; AND
--   (c) the organization's toggle row for p_key exists and is true.
-- Anything else - an unknown key, a null key, a non-Learn key such as
-- org_portal.giving, an unknown organization - is false.
--
-- That is exactly orgFeatureEnabledInTx's composition (src/lib/org-features.ts):
-- type, then axis and category, then toggle; axis off when its flag row is
-- missing; category row missing is ON; toggle row missing is OFF.
-- src/lib/learn/learn-toggle.test.ts pins the CASE literals to the
-- ORG_FEATURE_CATALOG entries whose category is `learn`;
-- src/lib/learn/public.db.test.ts compares the result with
-- orgFeatureEnabledInTx over the whole type x axis x category x toggle matrix.
--
-- SECURITY INVOKER, and EXECUTE revoked from public, presby_app and
-- presby_platform with NO grant. It reads two FORCE ROW LEVEL SECURITY tables
-- with no org GUC, which only works as the owner (neondb_owner, rolbypassrls):
-- it is meant to run inside a SECURITY DEFINER caller (presby_public_learn
-- below, and 1b's data-bearing definer later). Because the key list is
-- closed, no caller can use it to ask about any other organization toggle.
create or replace function presby_learn_enabled(p_org uuid, p_key text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce((
    select (k.org_types is null or o.organization_type::text = any (k.org_types))
       and (not coalesce((select f.enabled from feature_flags f
                           where f.key = 'org_portal.feature_categories'), false)
            or coalesce((select c.enabled from organization_feature_categories c
                          where c.organization_id = p_org and c.category = k.category), true))
       and coalesce((select t.enabled from organization_feature_toggles t
                      where t.organization_id = p_org and t.feature_key = p_key), false)
      from organizations o,
           lateral (select case p_key
                             when 'org_portal.spot_the_scam' then 'learn'
                           end as category,
                           case p_key
                             when 'org_portal.spot_the_scam' then null::text[]
                           end as org_types) k
     where o.id = p_org
       and k.category is not null
  ), false);
$function$;

revoke all on function presby_learn_enabled(uuid, text) from public, presby_app, presby_platform;

-- ===========================================================================
-- 3. presby_public_learn(p_slug, p_key) - the anonymous entry point
-- ===========================================================================
-- In English: always exactly one row, (state). `available` exactly when an
-- organization with slug p_slug exists, its status is 'active', it has an
-- organization_sites row whose status is 'live', and
-- presby_learn_enabled(organization, p_key) is true. Every other case - an
-- unknown or null slug, an organization that is not active, a site that is
-- provisioning, suspended or absent, a toggle that is off or missing, a Learn
-- category that is off while the category axis is on, an organization type
-- the key does not admit, an unknown or non-Learn key - is the one row
-- `unavailable`. Byte-identical for every cause (DECISION-040/154: the route
-- maps it to the site's neutral 404).
--
-- Gate order is presby_public_careers' (drizzle/0071 section 7b): org by slug
-- and active, then site live, then the toggle. It returns no organization
-- name or id: the route already holds the name from the resolved site.
-- Later static Learn pages call it unchanged; a data-bearing Learn read gets
-- its own definer that calls presby_learn_enabled.
--
-- SECURITY DEFINER (owner, rolbypassrls): an anonymous presby_app request has
-- no org GUC, and the toggle, category and site tables are FORCE ROW LEVEL
-- SECURITY, so as an invoker it would read zero rows and answer `unavailable`
-- for every organization (F26). EXECUTE: owner and presby_app only.
create or replace function presby_public_learn(p_slug text, p_key text)
returns table (state text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_org record;
begin
  select o.id, o.status into v_org from organizations o where o.slug = p_slug;
  if not found
     or v_org.status is distinct from 'active'
     or not exists (select 1 from organization_sites s
                     where s.organization_id = v_org.id and s.status = 'live')
     or not presby_learn_enabled(v_org.id, p_key) then
    return query select 'unavailable'::text;
    return;
  end if;
  return query select 'available'::text;
end
$function$;

revoke all on function presby_public_learn(text, text) from public, presby_app, presby_platform;
grant execute on function presby_public_learn(text, text) to presby_app;

-- ===========================================================================
-- 4. Comments
-- ===========================================================================
comment on function presby_learn_enabled(uuid, text) is
  'Owner-only Learn toggle predicate (Learn Increment 1a, DECISION-331). True when p_key is in the closed CASE list of Learn keys (today org_portal.spot_the_scam, category learn, every organization type) and the organization type is admitted, the category axis is off or the category row is missing or on, and the toggle row is on; false for every other cause, one answer for all of them. Composition equals orgFeatureEnabledInTx (src/lib/learn/public.db.test.ts); literals pinned to ORG_FEATURE_CATALOG (src/lib/learn/learn-toggle.test.ts). SECURITY INVOKER with no EXECUTE grant: runs only inside a SECURITY DEFINER caller. A new Learn key extends both CASE lists in its own migration.';
comment on function presby_public_learn(text, text) is
  'The one anonymous read for a static Learn page (Learn Increment 1a, DECISION-331). Always exactly one row: state available, or unavailable for every non-serving cause (unknown slug, organization not active, site not live, toggle or category off, unknown or non-Learn key) - one answer for every cause, byte-identical, the neutral 404 (DECISION-040/154). Gate order as presby_public_careers. Returns no name and no id. EXECUTE: owner and presby_app only.';
