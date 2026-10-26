import { test, expect } from "@playwright/test";
import { platformSql } from "./support/db";
import {
  addRosterPerson,
  auditRowsFor,
  createThrowawayUser,
  grantedRoleKeys,
  invitationRow,
  INVITE_NAMES,
  personAtOrgFor,
  removeInviteOrg,
  rosterUserId,
  seedInvitation,
  setupInviteOrg,
  type InviteOrg,
} from "./support/invitation-fixture";
import {
  collectRequests,
  deadLinkEverSeen,
  installDeadLinkObserver,
  inviteCookie,
} from "./support/invitation-observer";
import { deadHeading, signInOnPage, submitTotp } from "./support/invitation-ui";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { E2E_USERS, storageStatePath } from "./support/users";

/**
 * The existing-account half of the invitation flow (DECISION-183/185,
 * docs/work-log/2026-10-21-invitations.md; Phase 2 addendum 2; Phase 3 QA
 * requirement 2). A person who already has an account opens the link, signs in
 * to accept, and the hand-off cookie carries the token across the sign-in (and,
 * for an MFA account, the /totp challenge) because the token never rides a URL.
 *
 * Case A - no MFA: a throwaway account, invited by the platform operator. After
 *          accepting it is required through the role (F343) and meets the
 *          enrolment wall; it does not land in the congregation.
 * Case B - MFA-enrolled, SELF-designated: the `mfa-enrolled` fixture invited by
 *          itself (the production-shaped case: the operator is the only platform
 *          admin and will be some churches' first administrator), through the
 *          real /totp challenge.
 *
 * Both prove, with a MutationObserver installed before any page script runs,
 * that the dead-link page is NEVER painted on the way back from sign-in - the
 * flash the `Path=/invite` cookie caused, which no polling assertion can see
 * because a refresh repairs it within a second. They also prove the token is in
 * no request URL after leaving the link, the cookie's exact attributes, and the
 * PERSISTED outcome (invitation, person, grants, audit rows - ids only), not
 * just the DOM. Every spec runs on its own throwaway congregation, removed at
 * the end (invitation rows are not deletable except by that cascade).
 */

test.setTimeout(150_000);

const sql = platformSql("invitation-existing-account.spec");
let org: InviteOrg | undefined;

test.beforeEach(async () => {
  org = await setupInviteOrg(sql);
});

test.afterEach(async () => {
  await removeInviteOrg(sql, org);
  org = undefined;
});

/**
 * Everything the spec learned about the token's travels, asserted in one place.
 * Called BEFORE the Accept click: the Accept form's own POST legitimately carries
 * the token in its hidden field (same origin, to the page that just rendered it),
 * so the proof is about everything between leaving the link and that click.
 */
function expectTokenStayedOffTheWire(
  token: string,
  seen: { urls: string[]; bodies: string[] },
  where: string[],
) {
  expect(seen.urls.filter((u) => u.includes(token)), "no request URL after leaving the link carries the token").toEqual([]);
  expect(seen.bodies.filter((b) => b.includes(token)), "no request body after leaving the link carries the token (sign-in POST included)").toEqual([]);
  for (const place of where) expect(place, "the token is in no page URL after the link").not.toContain(token);
}

test("Case A, no MFA: open the link, sign in to accept, Accept - never the dead-link page, token off the wire, outcome persisted", async ({
  page,
  context,
  baseURL,
}) => {
  const o = org!;
  const operatorId = await rosterUserId(sql, "admin");
  const invitee = await createThrowawayUser(sql, o, { tag: "existing", name: "Existing Invitee" });
  const invitation = await seedInvitation(sql, o, {
    purpose: "founding_administrator",
    email: invitee.email,
    createdByUserId: operatorId,
  });

  await installDeadLinkObserver(page);
  await page.goto(`/invite?token=${invitation.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
  // Nothing was consumed by looking.
  expect((await invitationRow(sql, invitation.id)).accepted_at).toBeNull();

  await page.getByRole("button", { name: "Sign in to accept" }).click();
  // The token left the URL here: the sign-in page is reached with no token anywhere.
  const afterLink = collectRequests(page);
  await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15_000 });
  afterLink.start();
  const visited: string[] = [page.url()];
  expect(new URL(page.url()).pathname).toBe("/signin");

  await signInOnPage(page, invitee.email, invitee.password);

  // Back on /invite via a server-action redirect: the case that used to paint the dead-link page.
  await page.waitForURL((url) => url.pathname === "/invite", { timeout: 20_000 });
  visited.push(page.url());
  // An immediate count, not a retrying assertion: a dead page a refresh repairs in a second must still fail it.
  expect.soft(await deadHeading(page).count(), "no dead-link heading on arrival at /invite, with no reload").toBe(0);
  await expect(page.getByText(/Accepting as/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`${INVITE_NAMES.first} ${INVITE_NAMES.last}`)).toBeVisible();
  await expect(page.getByText(o.name, { exact: false }).first()).toBeVisible();
  expect.soft(await deadLinkEverSeen(page), "the dead-link heading was never painted on the way back").toBe(false);

  // The cookie, exactly as the browser holds it (host-only, Path=/, httpOnly, Lax, <= 30 minutes).
  const cookie = await inviteCookie(context);
  expect.soft(cookie, "the hand-off cookie is held while the invitation is in flight").toBeDefined();
  if (cookie) {
    expect.soft(cookie.path).toBe("/");
    expect.soft(cookie.httpOnly).toBe(true);
    expect.soft(cookie.sameSite).toBe("Lax");
    expect.soft(cookie.domain, "host-only: the domain is the exact host, no leading dot").toBe(new URL(baseURL!).hostname);
    const secondsLeft = cookie.expires - Date.now() / 1000;
    expect.soft(secondsLeft).toBeGreaterThan(0);
    expect.soft(secondsLeft).toBeLessThanOrEqual(1800 + 5);
  }

  expectTokenStayedOffTheWire(invitation.token, afterLink, visited);
  const requestsBeforeAccept = afterLink.urls.length;
  await page.getByRole("button", { name: "Accept invitation" }).click();
  // F343 (DECISION-291, P3-1): the founding-administrator bundle holds roles.manage and role_grants.manage, which
  // are flagged requires_two_factor, so this column-false account is now required THROUGH THE ROLE (arm B of
  // presby_two_factor_required) the moment it accepts. The router sends it to the congregation, the proxy stops it
  // at the wall and, not enrolled, walks it to enrolment with the destination kept - the same wall the treasurer
  // test below asserts. Before 0080 it landed on /o/<slug> directly.
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 40_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(`/o/${o.slug}`);
  visited.push(page.url());
  expect(
    afterLink.urls.slice(requestsBeforeAccept).filter((u) => u.includes(invitation.token)),
    "no request URL during Accept carries the token either",
  ).toEqual([]);
  expect(visited.filter((u) => u.includes(invitation.token))).toEqual([]);
  expect(await inviteCookie(context), "the hand-off cookie is gone after Accept").toBeUndefined();

  // The persisted outcome.
  const row = await invitationRow(sql, invitation.id);
  expect(row.accepted_at).not.toBeNull();
  expect(row.accepted_user_id).toBe(invitee.id);
  const personId = await personAtOrgFor(sql, o, invitee.id);
  expect(personId, "the account is linked to a person at the organization").not.toBeNull();
  expect(row.person_id).toBe(personId);
  expect(await grantedRoleKeys(sql, o, personId!)).toContain("founding_administrator");
  // The requirement came from the role, not the account's own setting: the column is untouched (false) and the
  // definer says required. Removing the role is the only thing that would release it.
  const [twoFactor] = (await sql`
    select u.two_factor_required as own, presby_two_factor_required(u.id) as via_role
      from users u where u.id = ${invitee.id}::uuid`) as { own: boolean; via_role: boolean }[];
  expect(twoFactor, "required through the role, own setting still off").toEqual({ own: false, via_role: true });

  const audit = await auditRowsFor(sql, invitation.id);
  const byAction = Object.fromEntries(audit.map((a) => [a.action, a]));
  expect(Object.keys(byAction).sort()).toEqual(["invitation.accepted", "org.founding_administrator.designated"]);
  expect(byAction["invitation.accepted"].metadata).toMatchObject({
    invitationId: invitation.id,
    organizationId: o.orgId,
    purpose: "founding_administrator",
    personId,
    mode: "existing_account",
    invitedByUserId: operatorId,
    inviterIsInvitee: false,
  });
  expect(byAction["invitation.accepted"].actor_user_id).toBe(invitee.id);
  expect(byAction["org.founding_administrator.designated"].metadata).toMatchObject({
    viaInvitationId: invitation.id,
    invitedByUserId: operatorId,
    inviterIsInvitee: false,
  });
  expect(byAction["org.founding_administrator.designated"].resource_id).toBe(o.orgId);
  // Ids only: the metadata never names the address; the token, its hash and the password are nowhere in a row.
  // (`actor_email` is the ACTOR's own address from their own session - the column exists for that - not the
  // invitation's recipient field.)
  expect(JSON.stringify(audit.map((a) => a.metadata)), "audit metadata carries ids only").not.toContain(invitee.email);
  const everything = JSON.stringify(audit);
  for (const secret of [invitation.token, invitation.tokenHash, invitee.password]) {
    expect(everything).not.toContain(secret);
  }
});

test("Case B, MFA-enrolled and self-designated: through the real /totp challenge, never the dead-link page, inviterIsInvitee on both audit rows", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  const o = org!;
  const self = E2E_USERS["mfa-enrolled"];
  const selfId = await rosterUserId(sql, "mfa-enrolled");
  const invitation = await seedInvitation(sql, o, {
    purpose: "founding_administrator",
    email: self.email,
    createdByUserId: selfId,
  });

  await installDeadLinkObserver(page);
  await page.goto(`/invite?token=${invitation.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in to accept" }).click();

  const afterLink = collectRequests(page);
  await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15_000 });
  afterLink.start();
  const visited: string[] = [page.url()];

  await signInOnPage(page, self.email, self.password);
  // An MFA account is sent straight to the challenge, with /invite as the destination and no token in the URL.
  await page.waitForURL((url) => url.pathname === "/totp", { timeout: 20_000 });
  visited.push(page.url());
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/invite");
  await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible();

  await submitTotp(page, E2E_TOTP_TEST_SECRET);
  await page.waitForURL((url) => url.pathname === "/invite", { timeout: 20_000 });
  visited.push(page.url());
  // An immediate count, not a retrying assertion: a dead page a refresh repairs in a second must still fail it.
  expect.soft(await deadHeading(page).count(), "no dead-link heading on arrival at /invite, with no reload").toBe(0);
  await expect(page.getByText(/Accepting as/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`${INVITE_NAMES.first} ${INVITE_NAMES.last}`)).toBeVisible();
  expect.soft(await deadLinkEverSeen(page), "the dead-link heading was never painted on the way back").toBe(false);

  const cookie = await inviteCookie(context);
  expect.soft(cookie, "the hand-off cookie is held while the invitation is in flight").toBeDefined();
  if (cookie) {
    expect.soft(cookie.path).toBe("/");
    expect.soft(cookie.httpOnly).toBe(true);
    expect.soft(cookie.sameSite).toBe("Lax");
    expect.soft(cookie.domain, "host-only: the domain is the exact host, no leading dot").toBe(new URL(baseURL!).hostname);
    const secondsLeft = cookie.expires - Date.now() / 1000;
    expect.soft(secondsLeft).toBeGreaterThan(0);
    expect.soft(secondsLeft).toBeLessThanOrEqual(1800 + 5);
  }

  expectTokenStayedOffTheWire(invitation.token, afterLink, visited);
  const requestsBeforeAccept = afterLink.urls.length;
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await page.waitForURL((url) => url.pathname === `/o/${o.slug}`, { timeout: 30_000 });
  visited.push(page.url());
  expect(
    afterLink.urls.slice(requestsBeforeAccept).filter((u) => u.includes(invitation.token)),
    "no request URL during Accept carries the token either",
  ).toEqual([]);
  expect(visited.filter((u) => u.includes(invitation.token))).toEqual([]);
  expect(await inviteCookie(context), "the hand-off cookie is gone after Accept").toBeUndefined();

  // The persisted outcome: the account now holds the role through a person it was linked to.
  const row = await invitationRow(sql, invitation.id);
  expect(row.accepted_user_id).toBe(selfId);
  const personId = await personAtOrgFor(sql, o, selfId);
  expect(personId).not.toBeNull();
  expect(await grantedRoleKeys(sql, o, personId!)).toContain("founding_administrator");
  const audit = await auditRowsFor(sql, invitation.id);
  const byAction = Object.fromEntries(audit.map((a) => [a.action, a]));
  expect(Object.keys(byAction).sort()).toEqual(["invitation.accepted", "org.founding_administrator.designated"]);
  expect(byAction["invitation.accepted"].metadata).toMatchObject({
    mode: "existing_account",
    invitedByUserId: selfId,
    inviterIsInvitee: true,
  });
  expect(byAction["org.founding_administrator.designated"].metadata).toMatchObject({
    viaInvitationId: invitation.id,
    invitedByUserId: selfId,
    inviterIsInvitee: true,
  });
  expect(byAction["invitation.accepted"].actor_user_id).toBe(selfId);
  expect(JSON.stringify(audit)).not.toContain(invitation.token);

  // The platform operator's page labels it as what it is.
  const operator = await browser.newContext({ storageState: storageStatePath("admin"), baseURL });
  try {
    const operatorPage = await operator.newPage();
    await operatorPage.goto(`/admin/organizations/${o.orgId}`);
    const section = operatorPage.getByTestId("founding-administrator-section");
    await expect(section.getByText("Self-designated")).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText("Accepted", { exact: false }).first()).toBeVisible();
  } finally {
    await operator.close();
  }
});

test("treasurer purpose, existing account (no MFA): accepting links the roster person, grants the treasurer role, and the 2FA wall then stands in front of the congregation", async ({
  page,
}) => {
  const o = org!;
  const operatorId = await rosterUserId(sql, "admin");
  const invitee = await createThrowawayUser(sql, o, { tag: "treasurer", name: "Roster Treasurer" });
  // The roster person carries the invitee's address on file (C6 / F159): the invitation names the person.
  const personId = await addRosterPerson(sql, o, {
    first: INVITE_NAMES.rosterFirst,
    last: INVITE_NAMES.rosterLast,
    email: invitee.email,
  });
  const invitation = await seedInvitation(sql, o, {
    purpose: "treasurer",
    email: invitee.email,
    createdByUserId: operatorId,
    personId,
  });

  await installDeadLinkObserver(page);
  await page.goto(`/invite?token=${invitation.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in to accept" }).click();
  await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15_000 });
  await signInOnPage(page, invitee.email, invitee.password);
  await page.waitForURL((url) => url.pathname === "/invite", { timeout: 20_000 });
  expect.soft(await deadHeading(page).count()).toBe(0);
  // The roster's name is shown for confirmation before anything is linked (G3).
  await expect(page.getByText(`${INVITE_NAMES.rosterFirst} ${INVITE_NAMES.rosterLast}`).first()).toBeVisible({ timeout: 20_000 });
  expect(await deadLinkEverSeen(page)).toBe(false);
  await page.getByRole("button", { name: "Accept invitation" }).click();

  // Holding giving.manage forces 2FA (arm B of presby_two_factor_required) for an account that had none:
  // the router sends them to the org, the proxy stops them at the wall and, not enrolled, walks them to enrolment.
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 40_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(`/o/${o.slug}`);

  const row = await invitationRow(sql, invitation.id);
  expect(row.accepted_user_id).toBe(invitee.id);
  expect(row.person_id).toBe(personId);
  const [linked] = (await sql`select user_id::text as user_id from people where id = ${personId}::uuid`) as { user_id: string }[];
  expect(linked.user_id, "the roster person is linked to the accepting account").toBe(invitee.id);
  expect(await grantedRoleKeys(sql, o, personId)).toEqual(["treasurer"]);
  const [contact] = (await sql`
    select verified_at is not null as verified from contact_methods
     where person_id = ${personId}::uuid and kind = 'email'`) as { verified: boolean }[];
  expect(contact.verified, "using the link verifies the address on file").toBe(true);
  const audit = await auditRowsFor(sql, invitation.id);
  expect(audit.map((a) => a.action).sort()).toEqual(["invitation.accepted", "org.treasurer.designated"]);
  expect(audit.find((a) => a.action === "invitation.accepted")!.metadata).toMatchObject({
    purpose: "treasurer",
    mode: "existing_account",
    personId,
    inviterIsInvitee: false,
  });
  expect(audit.find((a) => a.action === "org.treasurer.designated")!.metadata).toMatchObject({
    viaInvitationId: invitation.id,
    organizationId: o.orgId,
    personId,
    permissionKeys: ["giving.manage", "giving.record", "giving.view"],
    inviterIsInvitee: false,
  });
});

test.describe("signed in as a different account", () => {
  test.use({ storageState: storageStatePath("member") });

  test("a visitor signed in as another account is told so, sees only the masked address, and nothing is consumed", async ({
    page,
  }) => {
    const o = org!;
    const operatorId = await rosterUserId(sql, "admin");
    const invitee = await createThrowawayUser(sql, o, { tag: "someone-else", name: "Someone Else" });
    const invitation = await seedInvitation(sql, o, {
      purpose: "founding_administrator",
      email: invitee.email,
      createdByUserId: operatorId,
    });

    await page.goto(`/invite?token=${invitation.token}`);
    await expect(page.getByText(/signed in as another account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
    const text = (await page.locator("main, body").first().textContent()) ?? "";
    expect(text, "the full invited address never reaches the page").not.toContain(invitee.email);
    expect(text).toContain("***@");
    expect(page.url(), "the link is still the only place the token lives").toContain(invitation.token);
    expect((await invitationRow(sql, invitation.id)).accepted_at).toBeNull();
  });
});
