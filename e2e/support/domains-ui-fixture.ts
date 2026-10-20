/**
 * domains-ui-fixture.ts - a throwaway congregation for the custom-domains UI
 * specs (Track F, Batch 1d; docs/work-log/2026-10-19-custom-domains.md).
 *
 * The acting person is the `mfa-enrolled` fixture user (the one e2e user with a
 * computable TOTP secret, so a real 2FA challenge is completed first - the
 * `/o/*` Edge gate requires it), a member of THIS congregation only. Roles are
 * read live per request, so a spec swaps what the user may do with
 * `setDomainsRole` and flips the operator toggle with `setDomainsToggle`
 * (custom-hosts.ts) without logging in again.
 *
 * The organization is `deletable_until`-stamped and removed with one
 * `delete from organizations` (the cascade takes the domain rows, which are never
 * deleted by the application); `removeDomainsUiFixture` confirms by SELECT. Its
 * slug prefix `e2e-domui-` is deliberately NOT `e2e-domains-`, so the
 * custom-hosts world's stale-org sweep never touches (or trips over) it.
 * Everything is synthetic: `*.invalid`, invented names. No Real Data.
 */
import { generateSync } from "otplib";
import type { Browser, BrowserContext } from "@playwright/test";
import type { Sql } from "./db";
import { E2E_TOTP_TEST_SECRET } from "./totp-fixture";
import { E2E_USERS, storageStatePath } from "./users";

export const DOMAINS_UI_NAMES = {
  org: "E2E Domains UI Church",
  first: "Marguerite",
  last: "Oakhollow",
} as const;

export interface DomainsUiFixture {
  orgId: string;
  slug: string;
  name: string;
  personId: string;
  userId: string;
  roleId: string;
}

const PERSON_ID = "e2e94000-0000-4000-8000-000000000002";
const ROLE_ID = "e2e94000-0000-4000-8000-000000000030";

function assertSlug(slug: string) {
  if (!/^e2e-domui-\d+$/.test(slug)) throw new Error(`[domains-ui-fixture] refusing to touch non-fixture slug "${slug}"`);
}

async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await sql`select id from users where email = ${email}`) as { id: string }[];
  if (!rows[0]) throw new Error(`[domains-ui-fixture] no user row for ${email}; globalSetup must run first`);
  return rows[0].id;
}

/** Removes any fixture org a crashed run left, and its fixed-id person. */
async function removeStale(sql: Sql): Promise<void> {
  const stale = (await sql`select id from organizations where slug ~ '^e2e-domui-[0-9]+$'`) as { id: string }[];
  for (const { id } of stale) await removeById(sql, id);
  await sql`delete from people where id = ${PERSON_ID}::uuid`;
}

async function removeById(sql: Sql, orgId: string): Promise<void> {
  // The derived-roster trigger refuses the cascade a fixture org's delete fires against its
  // group_memberships; disabled around the delete, as every other fixture teardown here does.
  await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
  try {
    await sql`delete from organizations where id = ${orgId}::uuid`;
  } finally {
    await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
  }
  await sql`delete from people where id = ${PERSON_ID}::uuid`;
}

/**
 * Creates the congregation with a LIVE site, the `org_portal.domains` toggle ON,
 * and the acting user holding `domains.manage`. Pass `{ toggle: false }` to start
 * with the toggle off.
 */
export async function setupDomainsUiFixture(sql: Sql, opts: { toggle?: boolean; stamp?: number } = {}): Promise<DomainsUiFixture> {
  const stamp = opts.stamp ?? Date.now();
  const slug = `e2e-domui-${stamp}`;
  assertSlug(slug);
  // Unique per run: audit_events is append-only and keeps a run's rows forever.
  const orgId = `e2e94001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  const userId = await userIdByEmail(sql, E2E_USERS["mfa-enrolled"].email);

  await removeStale(sql);

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${DOMAINS_UI_NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  await sql`
    insert into people (id, user_id, first_name, last_name, deletable_until)
    values (${PERSON_ID}::uuid, ${userId}::uuid, ${DOMAINS_UI_NAMES.first}, ${DOMAINS_UI_NAMES.last}, now() + interval '3 hours')`;
  await sql`
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    values (${orgId}::uuid, ${PERSON_ID}::uuid, 'regular', 'active')`;
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${ROLE_ID}::uuid, ${orgId}::uuid, 'e2e_domains_manager', 'E2E Domains Manager', 'custom', false)`;
  await sql`insert into app_role_permissions (role_id, permission_key) values (${ROLE_ID}::uuid, 'domains.manage')`;
  // org_features.manage lets a spec open the church's own Features page (to prove it never lists the operator toggles).
  await sql`insert into app_role_permissions (role_id, permission_key) values (${ROLE_ID}::uuid, 'org_features.manage')`;
  await sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    values (${orgId}::uuid, ${ROLE_ID}::uuid, ${PERSON_ID}::uuid, date '2020-01-01', ${userId}::uuid)`;
  await sql`
    insert into organization_sites (organization_id, repo, status, last_ingested_at)
    values (${orgId}::uuid, ${`org/site-${slug}`}, 'live', now())`;
  if (opts.toggle !== false) await setToggle(sql, orgId, true);

  return { orgId, slug, name: DOMAINS_UI_NAMES.org, personId: PERSON_ID, userId, roleId: ROLE_ID };
}

export async function setToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = 'org_portal.domains'`;
    return;
  }
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, 'org_portal.domains', ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}`;
}

/** Whether the acting user holds `domains.manage` (permissions are read live per request: no re-login). */
export async function setDomainsRole(sql: Sql, fx: DomainsUiFixture, holds: boolean): Promise<void> {
  await sql`delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.personId}::uuid`;
  if (!holds) return;
  await sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    values (${fx.orgId}::uuid, ${fx.roleId}::uuid, ${fx.personId}::uuid, date '2020-01-01', ${fx.userId}::uuid)`;
}

export async function setSiteStatus(sql: Sql, orgId: string, status: "provisioning" | "live" | "suspended"): Promise<void> {
  await sql`update organization_sites set status = ${status} where organization_id = ${orgId}::uuid`;
}

export async function removeDomainsUiFixture(sql: Sql, fx: DomainsUiFixture | undefined): Promise<void> {
  if (!fx) return;
  assertSlug(fx.slug);
  await sql`delete from organization_sites where organization_id = ${fx.orgId}::uuid`;
  await removeById(sql, fx.orgId);
  const left = (await sql`select 1 from organizations where id = ${fx.orgId}::uuid`) as unknown[];
  if (left.length > 0) throw new Error(`[domains-ui-fixture] ${fx.slug} was not removed`);
  const rows = (await sql`select 1 from organization_domains where organization_id = ${fx.orgId}::uuid`) as unknown[];
  if (rows.length > 0) throw new Error(`[domains-ui-fixture] domain rows of ${fx.slug} survived its removal`);
}

/** One verified-TOTP session for the mfa-enrolled user, in a fresh browser context. */
export async function verifiedContext(browser: Browser, callbackPath = "/home"): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: storageStatePath("mfa-enrolled") });
  const page = await context.newPage();
  await page.goto(`/totp?callbackUrl=${encodeURIComponent(callbackPath)}`);
  await page.getByPlaceholder(/123456/).fill(generateSync({ secret: E2E_TOTP_TEST_SECRET }));
  await page.getByRole("button", { name: /^verify$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/totp"), { timeout: 15_000 });
  await page.close();
  return context;
}

/** Walks a row to a terminal state along legal edges so a spec can reuse the org (the cap counts non-terminal hosts). */
export async function retireDomain(sql: Sql, id: string, state: string): Promise<void> {
  if (state === "released" || state === "expired") return;
  if (state === "pending" || state === "verified") {
    await sql`update organization_domains set state = 'released', release_cause = 'removed', next_check_at = null where id = ${id}::uuid`;
    return;
  }
  if (state !== "release_pending") {
    await sql`
      update organization_domains
         set state = 'release_pending', release_cause = 'force_released',
             force_release_reason = 'Retired by the e2e fixture.', next_check_at = null
       where id = ${id}::uuid`;
  }
  await sql`update organization_domains set state = 'released', next_check_at = null where id = ${id}::uuid`;
}

/** Retires every non-terminal domain row of the org. */
export async function retireAllDomains(sql: Sql, orgId: string): Promise<void> {
  const rows = (await sql`
    select id, state from organization_domains
     where organization_id = ${orgId}::uuid and state not in ('released','expired')`) as { id: string; state: string }[];
  for (const r of rows) await retireDomain(sql, r.id, r.state);
}

/** Writes a row's observation and last-check class (owner path), so the UI can show every banner and record status. */
export async function setObservation(
  sql: Sql,
  id: string,
  o: { observation?: Record<string, unknown>; lastCheckClass?: string | null; lastCheckedAt?: boolean },
): Promise<void> {
  if (o.observation !== undefined) {
    await sql`update organization_domains set observation = ${JSON.stringify(o.observation)}::jsonb where id = ${id}::uuid`;
  }
  if (o.lastCheckClass !== undefined) {
    await sql`update organization_domains set last_check_class = ${o.lastCheckClass} where id = ${id}::uuid`;
  }
  if (o.lastCheckedAt) {
    await sql`update organization_domains set last_checked_at = now() - interval '3 minutes' where id = ${id}::uuid`;
  }
}
