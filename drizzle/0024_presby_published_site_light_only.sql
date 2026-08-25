-- presby_published_site() — widen to project organization_brands.light_only,
-- drop-and-recreate (docs/work-log/2026-08-24-light-only-brand.md Phase 4,
-- schema slice). CREATE OR REPLACE cannot change a RETURNS TABLE(...)
-- signature by appending columns — Postgres errors on the attempt. Must drop
-- first, same pattern as 0021's widening for the profile/service-times
-- columns and 0020's original definition.
--
-- Hand-authored per CLAUDE.md / docs/TODO.md: `npm run db:generate` is
-- broken repo-wide on the drizzle/meta/0008-0012 snapshot collision, so
-- every migration past 0012 is hand-authored and manually registered in
-- drizzle/meta/_journal.json, matching the house style set by 0013-0023.

drop function if exists presby_published_site(text);

create function presby_published_site(p_slug text)
returns table (
  organization_id           uuid,
  organization_name         text,
  organization_type         text,
  content_bundle_key        uuid,
  brand_seed_hex            text,
  brand_type_pairing        text,
  brand_token_version       integer,
  brand_light_only          boolean,
  profile_address           text,
  profile_phone             text,
  profile_facebook_url      text,
  profile_instagram_url     text,
  profile_x_twitter_url     text,
  profile_youtube_url       text,
  profile_other_url         text,
  service_times             jsonb,
  office_hours              jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.organization_type::text,
         s.content_bundle_key,
         b.seed_hex, b.type_pairing, b.brand_token_version, b.light_only,
         p.address, p.phone, p.facebook_url, p.instagram_url,
         p.x_twitter_url, p.youtube_url, p.other_url,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'service') as service_times,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'office_hours') as office_hours
    from organizations o
    join organization_sites s on s.organization_id = o.id
    left join organization_brands b on b.organization_id = o.id
    left join organization_profiles p on p.organization_id = o.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live';
$$;

comment on function presby_published_site(text) is
  'The ONLY presby_app-reachable read of organization_sites, organization_profiles/organization_service_times (DECISION-092), and now organization_brands.light_only (docs/work-log/2026-08-24-light-only-brand.md). Collapses never-provisioned / suspended / nonexistent-slug / org-not-active into the same zero-row result (enumeration-safety, unchanged since 0020). brand_light_only LEFT JOINs in exactly like the other brand_* columns — nullable, so a live site with no organization_brands row returns NULL, which the read path (out of scope for this migration, see src/lib/sites.ts) should treat the same as false. SECURITY DEFINER for the identical F26 reason as before: the anonymous (public)/site/[slug] page reads through presby_app with NO org GUC set.';

revoke all on function presby_published_site(text) from public;
grant execute on function presby_published_site(text) to presby_app;
