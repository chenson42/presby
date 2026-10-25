-- e2e-baseline-flags.sql - the global feature flags the e2e suite assumes are ON.
--
-- WHY. scripts/seed.ts seeds most org_portal.* and sites.* flags OFF (the
-- go-live posture). The e2e suite was written and run against the long-lived
-- development branch, where an operator had already switched a handful of
-- them on, and several specs assert against that state without setting it
-- ("`org_portal.home_v2` is ON on this branch" - e2e/post-login-routing.spec.ts).
-- A CI database is built from empty by migrate + seed + fixture, so it has only
-- the seeded (OFF) values, and the first real CI run (2026-10-23) failed six
-- specs for exactly that reason: the org home rendered the pre-home_v2 stub,
-- /admin/reports said "isn't turned on", and a public site answered 404.
--
-- Specs that need a flag in a particular state still capture, set and restore
-- it themselves (e2e/support/flags.ts); this file only fixes the BASELINE they
-- restore to. Applied by e2e.yml, on the throwaway branch, as the owner, and by
-- e2e-reset-flags.sql (which first sets every global flag back to its seed
-- value, for a QA run on a pipeline branch). db.yml never applies it: the
-- DB-backed unit suite must run against seeded defaults.
--
-- Add a key here only when a spec asserts against it and does not set it.
update feature_flags
   set enabled = true
 where key in (
   'org_portal.home_v2',
   'org_portal.reports',
   'sites.public_render'
 );

-- Fail loudly if a key is renamed or removed: an UPDATE of zero rows is silent.
do $$
declare n int;
begin
  select count(*) into n from feature_flags
   where enabled and key in ('org_portal.home_v2', 'org_portal.reports', 'sites.public_render');
  if n <> 3 then
    raise exception 'e2e baseline flags: expected 3 enabled, found %', n;
  end if;
end $$;
