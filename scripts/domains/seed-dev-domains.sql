-- scripts/domains/seed-dev-domains.sql — the custom-domains fixture block
-- (docs/work-log/2026-10-19-custom-domains.md, Phase 3 Data Model item 5;
-- drizzle/0057_presby_org_domains.sql).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE line, placed AFTER
-- its final `commit;` (and after giving's own `\ir` line if that has landed):
--
--     \ir domains/seed-dev-domains.sql
--
-- Standalone:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/domains/seed-dev-domains.sql
--
-- Runs as the OWNER (like seed-dev.sql). Idempotent: both inserts are
-- `on conflict do nothing` on their natural keys.
--
-- DELIBERATELY NO organization_domains ROW. Domain rows are never deleted
-- (organization_domains_guard_delete), the holding index is global, and a
-- durable fixture host would be one more row every suite has to reason about.
-- Specs and DB tests stage their own rows by walking legal edges on the owner
-- connection (e2e/support/domains-fixture.ts) and leave them released or
-- expired; scripts/domains/test-rls-47.sql needs nothing here at all.
--
-- WHAT IS HERE (so the existing sign-in-capable fixture user, Marguerite
-- Ashcombe - elder.fixture@example.invalid, who holds Alder Creek's
-- brand_admin role - can drive /o/alder-creek/admin/domains in Batch 1d):
--   Alder Creek (2222...): the org_portal.domains toggle ON. In production the
--     toggle is operator-enabled per org (operator ruling Q1); here it is on
--     so the page renders past its feature-off state.
--   Alder Creek's brand_admin role (f...000a) bound to domains.manage. Not the
--     founding_administrator bundle (development has no such role): a direct
--     binding on an existing custom role, exactly the "web volunteer" path the
--     Phase 3 Permissions section names.
--
-- Alder Creek's site stays `provisioning` (seed-dev.sql), so nothing serves
-- on a custom host from this fixture alone: the page's pre-flight banner
-- ("your site isn't published yet") is the state it renders.
--
-- No Real Data: no hostname appears in this file.

insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
values ('22222222-2222-2222-2222-222222222222', 'org_portal.domains', true, null)
on conflict (organization_id, feature_key) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('f0000000-0000-0000-0000-00000000000a', 'domains.manage')
on conflict (role_id, permission_key) do nothing;
