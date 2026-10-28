import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { generateSync } from "otplib";
import { platformSql } from "./support/db";
import {
  addRosterPerson,
  createThrowawayUser,
  inviteAddress,
  personAtOrgFor,
  removeInviteOrg,
  setupInviteOrg,
  THROWAWAY_PASSWORD,
  type InviteOrg,
} from "./support/invitation-fixture";
import { signInOnPage, submitTotp } from "./support/invitation-ui";
import { E2E_TOTP_TEST_SECRET, seedTotpEnrollment } from "./support/totp-fixture";

/**
 * Community Increment 2b, Batch B1: the running-server smoke of the full login
 * path through the new `jwt` sign-in branch (docs/work-log/2026-10-22-founding-
 * admin-directory.md, Phase 3 amendment 2 sections 7.1 and 8.5 item 4; the
 * CLAUDE.md Phase 4 gate for anything touching `src/auth.ts`). The unit tests
 * mock the database; this drives the real NextAuth handlers, the real
 * `presby_connect_signed_in_account` definer and the real audit write.
 *
 * It is deliberately small. Batch D's `no-organization-connect.spec.ts` owns the
 * full matrix (visitor, shared address, Check again, the second-factor walk);
 * this proves the path a person actually takes: password sign-in, connected at
 * sign-in, landing in the congregation, an MFA-enrolled user still crossing the
 * challenge, and the two cases that must NOT connect.
 *
 * Every case runs on its own throwaway congregation (`e2e-invite-<stamp>`),
 * removed at the end. The toggle row is written by SQL: an organization created
 * by raw SQL has none and auto-connect is off (DECISION-097), which is what keeps
 * every other fixture-based spec unchanged.
 */
test.setTimeout(150_000);

const sql = platformSql("sign-in-connect-smoke.spec");
let org: InviteOrg | undefined;

test.beforeEach(async () => {
  org = await setupInviteOrg(sql);
});

test.afterEach(async () => {
  await removeInviteOrg(sql, org);
  org = undefined;
});

async function toggleConnect(o: InviteOrg, enabled: boolean) {
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
    values (${o.orgId}::uuid, 'org_portal.sign_in_connect', ${enabled}, null)
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`;
}

/** A recorded member at `o` and a proven account for the address on that record. */
async function memberWithAccount(o: InviteOrg, tag: string, options: { twoFactorRequired?: boolean } = {}) {
  const email = inviteAddress(o, tag);
  const personId = await addRosterPerson(sql, o, { first: "Wendeline", last: `Ashgrove${tag}`, email });
  const user = await createThrowawayUser(sql, o, { tag, name: "Smoke Account", twoFactorRequired: options.twoFactorRequired });
  return { email, personId, user };
}

async function connectedAuditRows(personId: string) {
  return (await sql`
    select actor_user_id, resource_type, metadata
      from audit_events
     where action = 'tenant.person.sign_in_connected' and resource_id = ${personId}`) as {
    actor_user_id: string | null;
    resource_type: string;
    metadata: Record<string, unknown>;
  }[];
}

test("an authority-free member who signs in with the address on their record is connected at sign-in and lands in the congregation", async ({ page }) => {
  await toggleConnect(org!, true);
  const m = await memberWithAccount(org!, "free");
  expect(await personAtOrgFor(sql, org!, m.user.id)).toBeNull();

  await page.goto("/signin");
  await signInOnPage(page, m.email, THROWAWAY_PASSWORD);
  await page.waitForURL(new RegExp(`/o/${org!.slug}`), { timeout: 30_000 });

  expect(await personAtOrgFor(sql, org!, m.user.id)).toBe(m.personId);

  const rows = await connectedAuditRows(m.personId);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.actor_user_id).toBe(m.user.id);
  expect(rows[0]!.resource_type).toBe("person");
  expect(Object.keys(rows[0]!.metadata).sort()).toEqual(
    ["authority", "contactMethodCreatedAt", "contactMethodId", "organizationId", "personId", "proof", "secondFactor", "via"],
  );
  expect(rows[0]!.metadata).toMatchObject({ via: "sign_in", proof: "account", secondFactor: false, organizationId: org!.orgId });
  expect(JSON.stringify(rows[0]!.metadata)).not.toContain("@");
});

test("with the congregation's toggle off (or absent) nobody is connected: the account lands on /no-organization and nothing is written", async ({ page }) => {
  // No toggle row at all: absent means off.
  const m = await memberWithAccount(org!, "off");
  await page.goto("/signin");
  await signInOnPage(page, m.email, THROWAWAY_PASSWORD);
  await page.waitForURL(/\/no-organization/, { timeout: 30_000 });
  expect(await personAtOrgFor(sql, org!, m.user.id)).toBeNull();
  expect(await connectedAuditRows(m.personId)).toHaveLength(0);

  // An explicit off row declines the same way (a fresh session).
  await toggleConnect(org!, false);
  await page.context().clearCookies();
  await page.goto("/signin");
  await signInOnPage(page, m.email, THROWAWAY_PASSWORD);
  await page.waitForURL(/\/no-organization/, { timeout: 30_000 });
  expect(await personAtOrgFor(sql, org!, m.user.id)).toBeNull();
  expect(await connectedAuditRows(m.personId)).toHaveLength(0);
});

test("a person who holds a Session seat is NOT connected by a plain sign-in (authority needs a confirmed second factor): /no-organization, unlinked, no row", async ({ page }) => {
  await toggleConnect(org!, true);
  const m = await memberWithAccount(org!, "elder");
  await sql`insert into group_types (key, name) values ('court', 'Court') on conflict do nothing`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${org!.orgId}::uuid, (select id from group_types where key = 'court'), 'Session', 'derived', 'session', true`;
  await sql`
    insert into officer_terms (organization_id, person_id, office, starts_on)
    values (${org!.orgId}::uuid, ${m.personId}::uuid, 'ruling_elder', '2020-01-01')`;

  await page.goto("/signin");
  await signInOnPage(page, m.email, THROWAWAY_PASSWORD);
  await page.waitForURL(/\/no-organization/, { timeout: 30_000 });
  expect(await personAtOrgFor(sql, org!, m.user.id)).toBeNull();
  expect(await connectedAuditRows(m.personId)).toHaveLength(0);
});

test("a connected member whose account requires two-factor still crosses the real /totp challenge on the way into the congregation", async ({ page }) => {
  await toggleConnect(org!, true);
  const m = await memberWithAccount(org!, "mfa", { twoFactorRequired: true });
  await seedTotpEnrollment(sql, m.user.id);

  await page.goto("/signin");
  await signInOnPage(page, m.email, THROWAWAY_PASSWORD);

  // Connected at sign-in (the link exists before any challenge), then the proxy
  // challenges on the destination: the cookie carried the new link AND the
  // requirement (E-12).
  await page.waitForURL(/\/totp/, { timeout: 30_000 });
  expect(await personAtOrgFor(sql, org!, m.user.id)).toBe(m.personId);

  expect(generateSync({ secret: E2E_TOTP_TEST_SECRET })).toMatch(/^\d{6}$/);
  await submitTotp(page, E2E_TOTP_TEST_SECRET);
  await page.waitForURL(new RegExp(`/o/${org!.slug}`), { timeout: 30_000 });
});

test("the verify-email link changes the address through the definer: the new address is stamped proven, the token is spent, and the page's old messages hold", async ({ page }) => {
  const user = await createThrowawayUser(sql, org!, { tag: "chg-old", name: "Smoke Change" });
  const newAddress = inviteAddress(org!, "chg-new");
  const raw = `smoke${Date.now()}${Math.floor(Math.random() * 1e9).toString(16)}`;
  await sql`
    insert into email_verification_tokens (user_id, token, new_email, expires_at)
    values (${user.id}::uuid, ${createHash("sha256").update(raw).digest("hex")}, ${newAddress}, now() + interval '1 hour')`;

  // No session: the link must work for a visitor in a fresh browser (the page's own contract).
  await page.goto(`/account/verify-email/${raw}`);
  await page.waitForURL(/\/(account|signin)/, { timeout: 30_000 });

  const [row] = (await sql`select email, email_verified is not null as stamped from users where id = ${user.id}::uuid`) as { email: string; stamped: boolean }[];
  expect(row).toEqual({ email: newAddress, stamped: true });
  const [tok] = (await sql`select count(*)::int as n from email_verification_tokens where user_id = ${user.id}::uuid`) as { n: number }[];
  expect(tok!.n).toBe(0);
  const audit = (await sql`select metadata from audit_events where action = 'user.email_changed' and resource_id = ${user.id}`) as { metadata: Record<string, string> }[];
  expect(audit).toHaveLength(1);
  expect(audit[0]!.metadata).toEqual({ oldEmail: user.email, newEmail: newAddress });

  // The same link again is the old "invalid or has already been used" card.
  await page.goto(`/account/verify-email/${raw}`);
  await expect(page.getByText("This verification link is invalid or has already been used.")).toBeVisible();
});
