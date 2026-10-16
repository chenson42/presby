/**
 * giving-fixture.ts - setup and teardown for the giving admin specs
 * (online giving, Batch 2; docs/work-log/2026-10-15-online-giving.md;
 * DECISION-157: a spec creates only its own rows and removes them itself).
 *
 * WHY A THROWAWAY CONGREGATION AND NOT e2e-alpha. Gifts and reversals are
 * append-only and delete-guarded (P3-7/P3-8): a DELETE is refused unless the
 * ROW carries a future `deletable_until` or its organization no longer exists.
 * A gift recorded through the app (the thing these specs exist to test) never
 * carries `deletable_until`, so on the shared, permanent `e2e-alpha` it could
 * never be cleaned up. A fixture congregation stamped `deletable_until` at
 * insert is removed with one `delete from organizations` and the cascade takes
 * every giving row with it. The slug is `e2e-giving-<stamp>` (the `e2e-` prefix
 * is what every owner-connection fixture guard in this suite keys on).
 *
 * WHO HOLDS WHAT. Holding ANY giving key makes that user's sign-in require 2FA
 * (arm B of presby_two_factor_required), so a giving role is granted ONLY to
 *   - the `mfa-enrolled` user (the one fixture with a real, computable TOTP
 *     secret - e2e/support/totp-fixture.ts), given a person and a membership at
 *     THIS fixture congregation, and
 *   - a throwaway member who is never signed in as.
 * `congregation-clerk` and every presbytery user are never touched, so no other
 * spec's login changes. The spec swaps the mfa-enrolled user between roles with
 * `setGivingRole` (permissions are read live, per request) and verifies TOTP
 * once in `verifiedContext`.
 *
 * Idempotent where it can be: every insert is guarded, and `removeGivingFixture`
 * deletes by the ids and slug prefix defined here only.
 */

import { generateSync } from "otplib";
import type { Browser, BrowserContext } from "@playwright/test";
import type { Sql } from "./db";
import { E2E_TOTP_TEST_SECRET } from "./totp-fixture";
import { E2E_USERS, storageStatePath } from "./users";

export const GIVING_TOGGLE_KEY = "org_portal.giving";

export type GivingRoleName = "treasurer" | "recorder" | "viewer" | "manager" | "none";

const ROLE_KEYS: Record<Exclude<GivingRoleName, "none">, string[]> = {
  // view + record + manage: the seeded treasurer's set
  treasurer: ["giving.view", "giving.record", "giving.manage"],
  recorder: ["giving.record"],
  viewer: ["giving.view"],
  manager: ["giving.manage"],
};

export interface GivingFixture {
  orgId: string;
  slug: string;
  name: string;
  /** The people row linked to the mfa-enrolled user (a member of this org). */
  actingPersonId: string;
  actingUserId: string;
  /** A second member, never signed in as - the giving-team target. */
  otherPersonId: string;
  otherPersonName: string;
  /** A member whose email matches a donor's: the member-link proposal fixture. */
  proposedPersonId: string;
  proposedPersonName: string;
  funds: { general: string; building: string; retired: string };
  donors: { imogen: string; matched: string };
  roleIds: Record<Exclude<GivingRoleName, "none">, string>;
  featuresRoleId: string;
}

/** E2E-owned names, one place (the specs assert on them). */
export const GIVING_NAMES = {
  org: "E2E Giving Fixture Church",
  actingFirst: "Octavia",
  actingLast: "Marchetti",
  otherFirst: "Rowan",
  otherLast: "Fenwick",
  proposedFirst: "Winifred",
  proposedLast: "Ashgrove",
  fundGeneral: "E2E General Fund",
  fundBuilding: "E2E Building Fund",
  fundRetired: "E2E Old Missions",
  donorImogen: "Imogen Thackeray",
  donorMatched: "W. Ashgrove",
  matchedEmail: "winifred.e2e@example.invalid",
  imogenEmail: "imogen.e2e@example.invalid",
} as const;

const ID = "e2e92000-0000-4000-8000-";
const id = (n: number) => `${ID}${String(n).padStart(12, "0")}`;

function assertFixtureSlug(slug: string) {
  if (!/^e2e-giving-\d+$/.test(slug)) throw new Error(`[giving-fixture] refusing to touch non-fixture slug "${slug}"`);
}

async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await sql`select id from users where email = ${email}`) as { id: string }[];
  if (!rows[0]) throw new Error(`[giving-fixture] no user row for ${email}; globalSetup must run first`);
  return rows[0].id;
}

/** Creates the fixture congregation, its people, funds, donors and roles. The toggle is left OFF (no row). */
export async function setupGivingFixture(sql: Sql, stamp = Date.now()): Promise<GivingFixture> {
  const slug = `e2e-giving-${stamp}`;
  assertFixtureSlug(slug);
  // The organization id is unique PER RUN: audit_events is append-only and keeps
  // a run's rows forever, so an id reused across runs would make every audit
  // count in a spec include earlier runs. Children keep fixed ids (they are
  // deleted with the org / by id each run).
  const orgId = `e2e92001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  const actingPersonId = id(2);
  const otherPersonId = id(3);
  const proposedPersonId = id(4);
  const actingUserId = await userIdByEmail(sql, E2E_USERS["mfa-enrolled"].email);
  const fund = { general: id(10), building: id(11), retired: id(12) };
  const donors = { imogen: id(20), matched: id(21) };
  const roleIds = { treasurer: id(30), recorder: id(31), viewer: id(32), manager: id(33) };
  const featuresRoleId = id(34);

  // A crashed prior run may have left a fixture congregation (and the people
  // under the fixed ids); clear any before building this one.
  await removeStaleGivingFixtures(sql);

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${GIVING_NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;

  for (const [personId, first, last, userId] of [
    [actingPersonId, GIVING_NAMES.actingFirst, GIVING_NAMES.actingLast, actingUserId],
    [otherPersonId, GIVING_NAMES.otherFirst, GIVING_NAMES.otherLast, null],
    [proposedPersonId, GIVING_NAMES.proposedFirst, GIVING_NAMES.proposedLast, null],
  ] as const) {
    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${personId}::uuid, ${userId}::uuid, ${first}, ${last}, now() + interval '3 hours')`;
    await sql`
      insert into memberships (organization_id, person_id, engagement_status, current_roll)
      values (${orgId}::uuid, ${personId}::uuid, 'regular', 'active')`;
  }
  // The proposal fixture: a member whose email matches the "W. Ashgrove" donor.
  await sql`
    insert into person_identifiers (person_id, kind, value_normalized)
    values (${proposedPersonId}::uuid, 'email', ${GIVING_NAMES.matchedEmail})`;

  await sql`
    insert into giving_funds (id, organization_id, name, online_display_name, offered_online, is_active, retired_at, sort_order)
    values (${fund.general}::uuid, ${orgId}::uuid, ${GIVING_NAMES.fundGeneral}, null, false, true, null, 10),
           (${fund.building}::uuid, ${orgId}::uuid, ${GIVING_NAMES.fundBuilding}, null, false, true, null, 20),
           (${fund.retired}::uuid, ${orgId}::uuid, ${GIVING_NAMES.fundRetired}, null, false, false, now(), 30)`;
  await sql`
    insert into giving_donors (id, organization_id, display_name, email)
    values (${donors.imogen}::uuid, ${orgId}::uuid, ${GIVING_NAMES.donorImogen}, ${GIVING_NAMES.imogenEmail}),
           (${donors.matched}::uuid, ${orgId}::uuid, ${GIVING_NAMES.donorMatched}, ${GIVING_NAMES.matchedEmail})`;

  for (const name of Object.keys(ROLE_KEYS) as Array<keyof typeof ROLE_KEYS>) {
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleIds[name]}::uuid, ${orgId}::uuid, ${`e2e_giving_${name}`}, ${`E2E Giving ${name}`}, 'custom', false)`;
    for (const key of ROLE_KEYS[name]) {
      await sql`insert into app_role_permissions (role_id, permission_key) values (${roleIds[name]}::uuid, ${key})`;
    }
  }
  // org_features.manage - so the spec can reach /admin/features and turn Giving on and off.
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${featuresRoleId}::uuid, ${orgId}::uuid, 'e2e_giving_features', 'E2E Giving Features', 'custom', false)`;
  await sql`insert into app_role_permissions (role_id, permission_key) values (${featuresRoleId}::uuid, 'org_features.manage')`;

  return {
    orgId, slug, name: GIVING_NAMES.org, actingPersonId, actingUserId, otherPersonId,
    otherPersonName: `${GIVING_NAMES.otherFirst} ${GIVING_NAMES.otherLast}`,
    proposedPersonId, proposedPersonName: `${GIVING_NAMES.proposedFirst} ${GIVING_NAMES.proposedLast}`,
    funds: fund, donors, roleIds, featuresRoleId,
  };
}

/** Turns the org's Giving toggle on/off (`null` removes the row: the default, off). */
export async function setGivingToggle(sql: Sql, fx: GivingFixture, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await sql`delete from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = ${GIVING_TOGGLE_KEY}`;
    return;
  }
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${fx.orgId}::uuid, ${GIVING_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`;
}

/**
 * Makes the acting (mfa-enrolled) user hold exactly one giving role (or none),
 * optionally also the Features role. Permissions are read live per request, so
 * no re-login is needed. Replaces by deleting this fixture's grants first.
 */
export async function setGivingRole(
  sql: Sql,
  fx: GivingFixture,
  role: GivingRoleName,
  options: { features?: boolean } = {},
): Promise<void> {
  await sql`
    delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.actingPersonId}::uuid`;
  const grants: string[] = [];
  if (role !== "none") grants.push(fx.roleIds[role]);
  if (options.features) grants.push(fx.featuresRoleId);
  for (const roleId of grants) {
    await sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${fx.orgId}::uuid, ${roleId}::uuid, ${fx.actingPersonId}::uuid, date '2020-01-01', ${fx.actingUserId}::uuid)`;
  }
}

/**
 * An active monthly gift (an intent with a live subscription behind an
 * onboarding connection), so the Features OFF warning has something to count.
 * Neither table has a write-marker guard (only gifts and reversals do), so
 * plain owner inserts work through the one-statement http driver.
 */
export async function addActiveMonthlyGift(sql: Sql, fx: GivingFixture): Promise<void> {
  const accountId = `acct_fixture${fx.slug.replace(/\D/g, "")}`.slice(0, 40);
  await sql`
    insert into giving_provider_connections (id, organization_id, provider, external_account_id, livemode, status,
           charges_enabled, payouts_enabled, details_submitted, card_enabled, ach_enabled)
    values (${id(40)}::uuid, ${fx.orgId}::uuid, 'stripe', ${accountId}, false, 'onboarding', false, false, false, false, false)
    on conflict (id) do nothing`;
  await sql`
    insert into giving_checkout_intents (id, organization_id, connection_id, fund_id, donor_id, frequency, method_choice,
           cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
           subscription_id, expires_at, completed_at)
    values (${id(41)}::uuid, ${fx.orgId}::uuid, ${id(40)}::uuid, ${fx.funds.general}::uuid, ${fx.donors.imogen}::uuid, 'monthly',
            'card', false, 2500, 0, 2500, false, ${id(42)}, 'completed', 'sub_fixture_e2e_0001', now() + interval '1 day', now())
    on conflict (id) do nothing`;
}

/**
 * An offline gift recorded by ANOTHER user (the platform `admin` fixture), so
 * a spec can prove the actor's "recent entries" never include someone else's.
 * The write marker must be armed in the same statement as the insert (the http
 * driver has no multi-statement transaction), hence the CTE.
 */
export async function addForeignEntry(sql: Sql, fx: GivingFixture, amountCents: number): Promise<void> {
  const otherUserId = await userIdByEmail(sql, E2E_USERS.admin.email);
  await sql`
    with armed as (select set_config('presby.giving_write_active', 'true', true))
    insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status, occurred_on, livemode, recorded_by)
    select ${fx.orgId}::uuid, ${fx.donors.imogen}::uuid, ${fx.funds.general}::uuid, 'offline', 'cash', ${amountCents}, 'succeeded',
           current_date - 1, true, ${otherUserId}::uuid
      from armed`;
}

export type ConnectionSpec = {
  status: "onboarding" | "active" | "restricted" | "disconnected";
  /** Default false: a Stripe TEST-mode account (the badge shows). */
  livemode?: boolean;
  detailsSubmitted?: boolean;
  requirementsDue?: boolean;
  disabledReason?: string | null;
  attested?: boolean;
  publicOn?: boolean;
  disconnectedReason?: "treasurer" | "deauthorized";
  /** Active monthly gifts (intents with a live subscription) to seed behind the connection. */
  schedules?: number;
};

let connectionCounter = 0;

/** Removes this fixture org's inbox events, intents and connections (owner path; no gift or reversal exists to block it). */
export async function clearConnections(sql: Sql, fx: GivingFixture): Promise<void> {
  await sql`delete from giving_provider_events where organization_id = ${fx.orgId}::uuid`;
  await sql`delete from giving_checkout_intents where organization_id = ${fx.orgId}::uuid`;
  await sql`delete from giving_provider_connections where organization_id = ${fx.orgId}::uuid`;
}

/**
 * Replaces the fixture org's connection with exactly one row in the given state
 * (or none, for `null`) - the way the connect-panel spec reaches every state
 * without a Stripe account. The write marker is armed in the SAME statement as
 * the insert (the http driver has no multi-statement transaction), which is the
 * only way past the born-onboarding insert guard. Account ids are `acct_fixture…`.
 * Returns the connection id (or null).
 */
export async function setConnection(sql: Sql, fx: GivingFixture, spec: ConnectionSpec | null): Promise<string | null> {
  assertFixtureSlug(fx.slug);
  await clearConnections(sql, fx);
  if (spec === null) return null;
  connectionCounter += 1;
  const accountId = `acct_fixture${fx.slug.replace(/\D/g, "")}${connectionCounter}`.slice(0, 40);
  const connId = id(50 + connectionCounter);
  const active = spec.status === "active";
  const open = spec.status !== "disconnected";
  const detailsSubmitted = spec.detailsSubmitted ?? (spec.status !== "onboarding");
  const attested = spec.attested === true || spec.publicOn === true;
  await sql`
    with armed as (select set_config('presby.giving_write_active', 'true', true))
    insert into giving_provider_connections (id, organization_id, provider, external_account_id, livemode, status,
           charges_enabled, payouts_enabled, details_submitted, card_enabled, ach_enabled, requirements_due, disabled_reason,
           payouts_attested_at, public_enabled_at, disconnected_at, disconnected_reason, last_status_at)
    select ${connId}::uuid, ${fx.orgId}::uuid, 'stripe', ${accountId}, ${spec.livemode === true}, ${spec.status},
           ${active}, ${active}, ${open ? detailsSubmitted : true}, ${active}, ${active}, ${spec.requirementsDue === true},
           ${spec.disabledReason ?? null},
           ${attested ? new Date().toISOString() : null}::timestamptz,
           ${spec.publicOn === true ? new Date().toISOString() : null}::timestamptz,
           ${open ? null : new Date().toISOString()}::timestamptz,
           ${open ? null : (spec.disconnectedReason ?? "treasurer")},
           now()
      from armed`;
  for (let n = 0; n < (spec.schedules ?? 0); n += 1) {
    await sql`
      insert into giving_checkout_intents (id, organization_id, connection_id, fund_id, donor_id, frequency, method_choice,
             cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
             subscription_id, expires_at, completed_at)
      values (${id(70 + n)}::uuid, ${fx.orgId}::uuid, ${connId}::uuid, ${fx.funds.general}::uuid, ${fx.donors.imogen}::uuid, 'monthly',
              'card', false, 2500, 0, 2500, ${spec.livemode === true}, ${id(80 + n)}, 'completed',
              ${`sub_fixture_e2e_${connectionCounter}_${n}`}, now() + interval '1 day', now())`;
  }
  return connId;
}

/** Marks one fund as offered online (a go-live prerequisite). */
export async function offerFundOnline(sql: Sql, fx: GivingFixture, on: boolean): Promise<void> {
  await sql`
    update giving_funds set offered_online = ${on}, online_display_name = ${on ? "Giving" : null}
     where id = ${fx.funds.general}::uuid`;
}

/** An inbox event for the fixture org's connection in a given status (a dead letter for the requeue spec). */
export async function addInboxEvent(
  sql: Sql,
  fx: GivingFixture,
  connectionId: string,
  event: { externalEventId: string; status: "received" | "parked" | "dead_letter" | "applied"; type?: string; attempts?: number; lastError?: string },
): Promise<string> {
  const rows = (await sql`
    insert into giving_provider_events (organization_id, connection_id, provider, external_event_id, event_type, livemode,
           raw_body, status, attempts, last_error, processed_at)
    values (${fx.orgId}::uuid, ${connectionId}::uuid, 'stripe', ${event.externalEventId}, ${event.type ?? "charge.refunded"}, false,
            '{"fixture":true}', ${event.status}, ${event.attempts ?? 0}, ${event.lastError ?? null},
            ${event.status === "dead_letter" || event.status === "applied" ? new Date().toISOString() : null}::timestamptz)
    returning id`) as { id: string }[];
  return rows[0]!.id;
}

/** One verified-TOTP session for the mfa-enrolled user, in a fresh browser context (cookies live in the context). */
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

/** Removes every `e2e-giving-<digits>` congregation a crashed run left behind, then the fixed-id people. */
async function removeStaleGivingFixtures(sql: Sql): Promise<void> {
  const stale = (await sql`select id from organizations where slug ~ '^e2e-giving-[0-9]+$'`) as { id: string }[];
  for (const { id: orgId } of stale) await removeGivingFixtureById(sql, orgId);
  await sql`delete from people where id in (${id(2)}::uuid, ${id(3)}::uuid, ${id(4)}::uuid)`;
}

async function removeGivingFixtureById(sql: Sql, orgId: string): Promise<void> {
  // The derived-roster trigger refuses the cascade a fixture org's delete fires
  // against its group_memberships; disabled around the delete, as every other
  // fixture teardown in this repo does (one http call per statement).
  await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
  try {
    await sql`delete from organizations where id = ${orgId}::uuid`;
  } finally {
    await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
  }
  await sql`delete from people where id in (${id(2)}::uuid, ${id(3)}::uuid, ${id(4)}::uuid)`;
}

/** Removes everything the fixture made: the org cascades every giving row, then the people. */
export async function removeGivingFixture(sql: Sql, fx: GivingFixture): Promise<void> {
  assertFixtureSlug(fx.slug);
  await removeGivingFixtureById(sql, fx.orgId);
  const left = (await sql`select 1 from organizations where id = ${fx.orgId}::uuid`) as unknown[];
  if (left.length > 0) throw new Error(`[giving-fixture] the fixture organization ${fx.slug} was not removed`);
}
