-- e2e-reset-flags.sql - put every GLOBAL feature flag back to its scripts/seed.ts
-- value, then apply the e2e baseline (e2e-baseline-flags.sql), in one transaction.
--
-- WHY. A pipeline Neon branch inherits `development`'s flags plus whatever
-- earlier runs and operators left on them. Specs capture and restore the flags
-- they touch (e2e/support/flags.ts), so a polluted branch can pass a spec that
-- CI's from-empty database fails. QA runs this file before an e2e run so the
-- branch starts from the same state CI does (seed values + the baseline), and
-- says in its verdict that it did.
--
-- DESTRUCTIVE ON THE WRONG BRANCH. Run against `development` it switches off
-- every flag an operator turned on for a live demo. So the file refuses unless
-- the caller says, out loud, that this is a pipeline branch:
--
--   npx dotenv -e .env.local -- sh -c \
--     'psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -v pipeline_branch=1 \
--          -f scripts/ci/e2e-reset-flags.sql'
--
-- (the connection string stays in the environment and is never echoed). Use
-- `psql -f` so `\ir` resolves; the Neon MCP run_sql tool cannot run this file,
-- which is intended. The refusal raises inside the transaction, so every later
-- statement errors and the final `commit` rolls back: nothing is applied even
-- if the caller forgot ON_ERROR_STOP.
--
-- SCOPE. Global feature_flags.enabled only. rollout_percent, description and
-- the per-organization toggles (organization_feature_toggles) are NOT touched
-- (accepted residual). A flag in the table that scripts/seed.ts does not seed
-- is left as found and named in a notice.
--
-- TWO SOURCES OF TRUTH, ONE TEST. The rows below mirror seedFlags() in
-- scripts/seed.ts, because psql cannot read it. scripts/e2e-reset-flags.test.mjs
-- parses both and fails `npm test` on any difference. When you add a flag to
-- the seed, add its row here.

\if :{?pipeline_branch}
\else
  \set pipeline_branch ''
\endif

begin;

select set_config('presby.e2e_reset_confirmed', :'pipeline_branch', true);

do $$
begin
  if current_setting('presby.e2e_reset_confirmed', true) is distinct from '1' then
    raise exception 'e2e-reset-flags.sql: refusing to run. It sets every global feature flag back to its scripts/seed.ts value, which switches off flags an operator may have turned on. Run it only against a pipeline Neon branch, and say so with -v pipeline_branch=1. Nothing was changed.';
  end if;
end $$;

create temp table _seed_flags (
  key text primary key,
  enabled boolean not null
) on commit drop;

-- BEGIN seed flags
insert into _seed_flags (key, enabled) values
    ('auth.local_login', true),
    ('auth.require_2fa', true),
    ('ui.brand_theming', true),
    ('org_portal.directory', false),
    ('org_portal.roles', false),
    ('org_portal.home_v2', false),
    ('org_portal.directory_v2', false),
    ('org_portal.tickets', false),
    ('org_portal.chrome_v2', false),
    ('org_portal.chrome_v3', false),
    ('org_portal.feedback', false),
    ('sites.public_render', false),
    ('sites.public_staff_directory', false),
    ('sites.public_committee_directory', false),
    ('org_portal.features', false),
    ('org_portal.members_create', false),
    ('org_portal.members_roll_action_edit', false),
    ('ui.branded_signin', false),
    ('org_portal.officers', false),
    ('org_portal.groups', false),
    ('org_portal.events', false),
    ('org_portal.admin_hub', false),
    ('org_portal.branding', false),
    ('org_portal.motion', false),
    ('org_portal.sensitive_info', false),
    ('org_portal.children_ministry', false),
    ('org_portal.credentials', false),
    ('org_portal.oversight', false),
    ('org_portal.reports', false),
    ('statistics.submission_grants', false),
    ('org_portal.insights', false),
    ('org_portal.statistical_publication', false),
    ('org_portal.filings', false),
    ('org_portal.feature_categories', false),
    ('org_portal.staff', false),
    ('platform.merged_home', true),
    ('org_portal.worship', true),
    ('org_portal.committees', true),
    ('org_portal.communications', true);
-- END seed flags

do $$
declare
  missing text;
  extras text;
  n int;
begin
  select string_agg(s.key, ', ' order by s.key) into missing
    from _seed_flags s
    left join feature_flags f on f.key = s.key
   where f.key is null;
  if missing is not null then
    raise exception 'e2e-reset-flags.sql: seeded flag(s) missing from feature_flags: %. Nothing was changed.', missing;
  end if;

  update feature_flags f
     set enabled = s.enabled,
         updated_at = now()
    from _seed_flags s
   where f.key = s.key
     and f.enabled is distinct from s.enabled;

  select count(*) into n from _seed_flags;
  raise notice 'e2e-reset-flags.sql: set % seeded flags to their seed values.', n;

  select string_agg(f.key, ', ' order by f.key) into extras
    from feature_flags f
   where not exists (select 1 from _seed_flags s where s.key = f.key);
  if extras is not null then
    raise notice 'Flags in the table but not in scripts/seed.ts were left as found: %.', extras;
  end if;
  raise notice 'Per-organization toggles (organization_feature_toggles) were not touched.';
end $$;

\ir e2e-baseline-flags.sql

-- Evidence for the QA verdict: the flags that are ON after the reset.
select key from feature_flags where enabled order by key;

commit;
