/**
 * no-organization-connect.spec.ts - Community Increment 2b, Batch D: how a
 * proven sign-in becomes a person at a congregation, end to end against a
 * running server, at a desktop width and at 360px (docs/work-log/2026-10-22-
 * founding-admin-directory.md, Phase 3 amendment 2 section 8.5 item 1; TODO 291).
 *
 * Every case runs on its own throwaway congregation (`e2e-invite-<stamp>`) and
 * its own throwaway accounts, all removed at the end; the shared community
 * fixture's `e2e-alpha` is not touched. Accounts are the connect specs' "stamped,
 * unlinked account": a proven address, a password, no enrolment unless a case
 * says so. What it proves, by walking the real pages and then reading what was
 * PERSISTED through the owner connection:
 *
 *   (a) an authority-free member who signs in with the address on their record
 *       is connected at sign-in, lands in the congregation with baseline access
 *       only, and the Community card says "Connected through sign-in on {date}";
 *   (b) a visitor is not connected: N0, then Check again says "Nothing new yet.";
 *   (c) two people sharing an address: neither connects;
 *   (d) an authority-bearing person (a ruling elder) is not connected by sign-in:
 *       N0, Check again says "One more step", and a fresh account walks
 *       /account/2fa to enrolment and /totp to verification (enrolment does NOT
 *       verify the session: E-35), Check again connects, and /o/<slug> loads
 *       through the two-factor wall;
 *   (e) the congregation's toggle off: not connected, and an invitation still works;
 *   (f) an open sign-in invitation blocks auto-connect, shows as a card, and
 *       Accept connects and lands in the congregation (one `invitation.accepted`
 *       row, `via: "in_place"`);
 *   (g) a founding-administrator invitation: the second-factor notice first, then
 *       after the real /totp challenge Accept designates (`via: "in_place"`,
 *       `secondFactor: true`);
 *   (h) an invitation revoked after the page rendered: Accept shows the in-place
 *       dead sentence;
 *   (i) N0's words and "Sign in with a different account";
 *   (j) the bootstrap walk (TODO 291): a founding administrator sees the empty
 *       Session, a recorded elder with no sign-in shows the hand-off, that elder
 *       connects after a second factor, the administrator records themselves as a
 *       ruling elder and approves their own proposal; the audit rows carry
 *       `selfRecorded` and `selfApproved`.
 *
 * FLAGS. Set and restored through `captureFlags` (a flag this run changes is
 * global state): `org_portal.members_create` and `org_portal.officers` (the
 * Community and Officers pages), `org_portal.members_roll_action_edit`, and
 * `auth.require_2fa` (the `/o/*` two-factor wall). Organization toggles are
 * written by SQL on each throwaway congregation and go with it. No key is added
 * to `scripts/ci/e2e-baseline-flags.sql`.
 *
 * THE GOOGLE PATH IS NOT e2e-able (no real provider). It is covered by the `jwt`
 * unit test with mocks and the DB tests, and is one manual production check for
 * the operator after 2b ships. Stated here so nobody mistakes the password cases
 * above for coverage of it.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  acceptAsAccount,
  addMember,
  addAccount,
  addProposal,
  addBaselineMemberRole,
  addSender,
  addSession,
  auditAt,
  auditFor,
  COMMUNITY_FLAG,
  CONNECT_TOGGLE,
  enrolOnPage,
  expectTargets44,
  invitationsAt,
  noHorizontalOverflow,
  OFFICERS_FLAG,
  personOfUser,
  REQUIRE_2FA_FLAG,
  removeSignInOrg,
  revokeInvitation,
  ROLL_ACTION_EDIT_FLAG,
  seatElder,
  seedSignInInvitation,
  setOrgToggle,
  signInAs,
  VIEWPORTS,
} from "./support/sign-in-invite-fixture";
import {
  inviteAddress,
  rosterUserId,
  seedInvitation,
  setupInviteOrg,
  type InviteOrg,
} from "./support/invitation-fixture";
import { submitTotp } from "./support/invitation-ui";
import { E2E_TOTP_TEST_SECRET, seedTotpEnrollment } from "./support/totp-fixture";

const N0_HEADING = "You're not connected to a congregation yet";
const NOTHING_NEW = "Nothing new yet.";

test.describe("Sign-in connect and /no-organization", () => {
  test.setTimeout(240_000);

  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("no-organization-connect.spec");
    flags = await captureFlags(sql, [COMMUNITY_FLAG, OFFICERS_FLAG, ROLL_ACTION_EDIT_FLAG, REQUIRE_2FA_FLAG]);
    for (const key of [COMMUNITY_FLAG, OFFICERS_FLAG, ROLL_ACTION_EDIT_FLAG, REQUIRE_2FA_FLAG]) await setFlag(sql, key, true);
  });

  test.afterAll(async () => {
    await flags.restore();
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      let org: InviteOrg | undefined;

      test.beforeEach(async () => {
        org = await setupInviteOrg(sql);
        // The Community card and list need the platform flag AND the organization's own toggle.
        await setOrgToggle(sql, org, COMMUNITY_FLAG, true);
      });

      test.afterEach(async () => {
        await removeSignInOrg(sql, org);
        org = undefined;
      });

      const n0 = (page: Page) => page.getByRole("heading", { level: 1, name: N0_HEADING });
      const checkAgain = (page: Page) => page.getByRole("button", { name: "Check again", exact: true });
      /** Check again is disabled until the page hydrates: the enabled button is the signal. */
      async function pressCheckAgain(page: Page) {
        const button = checkAgain(page);
        await expect(button).toBeEnabled({ timeout: 30_000 });
        await button.click();
      }

      test("(a) an authority-free member who signs in with the address on their record is connected at sign-in and lands with baseline access only", async ({ page, browser }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        await addBaselineMemberRole(sql, o);
        const account = await addAccount(sql, o, "free");
        const member = await addMember(sql, o, { first: "Wendeline", last: "Ashgrove", email: account.email });
        const sender = await addSender(sql, o);
        expect(await personOfUser(sql, account.id)).toBeNull();

        await signInAs(page, account, new RegExp(`/o/${o.slug}`));
        expect(await personOfUser(sql, account.id)).toBe(member.personId);
        await expect(page.getByText(o.name).first()).toBeVisible({ timeout: 30_000 });
        await noHorizontalOverflow(page);

        // Baseline only: the member role reads the directory and the calendar, and nothing administers.
        await page.goto(`/o/${o.slug}/admin/community`);
        await expect(page.getByRole("link", { name: /add person/i })).toHaveCount(0);
        await expect(page.getByTestId("sign-in-marker")).toHaveCount(0);

        const rows = await auditFor(sql, "tenant.person.sign_in_connected", member.personId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.actor_user_id).toBe(account.id);
        expect(rows[0]!.metadata).toMatchObject({ via: "sign_in", proof: "account", secondFactor: false, organizationId: o.orgId });
        expect(JSON.stringify(rows[0]!.metadata)).not.toContain("@");

        // The person who keeps the records sees how this person was connected, on the card.
        const office = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        try {
          const officePage = await office.newPage();
          await signInAs(officePage, sender.user, new RegExp(`/o/${o.slug}`));
          await officePage.goto(`/o/${o.slug}/admin/community/${member.personId}/edit`);
          const card = officePage.getByTestId("sign-in-card");
          await expect(card).toContainText(/Connected through sign-in on /, { timeout: 45_000 });
          await expect(card).toContainText("To change who signs in as this person, send us a support ticket.");
          await expect(card.getByRole("button")).toHaveCount(0);
        } finally {
          await office.close();
        }
      });

      test("(b) a visitor is not connected: N0, then Check again says Nothing new yet", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        const account = await addAccount(sql, o, "visitor");
        const visitor = await addMember(sql, o, { first: "Perpetua", last: "Quillon", email: account.email, engagement: "visitor" });

        await signInAs(page, account, /\/no-organization/);
        await expect(n0(page)).toBeVisible();
        await pressCheckAgain(page);
        await expect(page.getByText(NOTHING_NEW)).toBeVisible({ timeout: 30_000 });
        expect(new URL(page.url()).pathname).toBe("/no-organization");
        await noHorizontalOverflow(page);

        expect(await personOfUser(sql, account.id)).toBeNull();
        expect(await auditFor(sql, "tenant.person.sign_in_connected", visitor.personId)).toHaveLength(0);
      });

      test("(c) two people who share the address: neither is connected", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        const account = await addAccount(sql, o, "shared");
        const first = await addMember(sql, o, { first: "Hollis", last: "Dunmore", email: account.email });
        const second = await addMember(sql, o, { first: "Marguerite", last: "Dunmore", email: account.email });

        await signInAs(page, account, /\/no-organization/);
        await expect(n0(page)).toBeVisible();
        await pressCheckAgain(page);
        await expect(page.getByText(NOTHING_NEW)).toBeVisible({ timeout: 30_000 });

        expect(await personOfUser(sql, account.id)).toBeNull();
        for (const person of [first, second]) {
          expect(await auditFor(sql, "tenant.person.sign_in_connected", person.personId)).toHaveLength(0);
        }
      });

      test("(d) a ruling elder is not connected by sign-in; a fresh account enrols, verifies, and Check again connects through the two-factor wall", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        await addSession(sql, o);
        const account = await addAccount(sql, o, "elder", { twoFactorRequired: true });
        const elder = await addMember(sql, o, { first: "Thaddeus", last: "Wrenfall", email: account.email });
        await seatElder(sql, o, elder.personId);

        // A fresh account that must use two-factor sign-in is walked /totp -> /account/2fa at sign-in,
        // before it ever reaches /no-organization.
        await signInAs(page, account, (url) => url.pathname === "/account/2fa");
        expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
        const secret = await enrolOnPage(page);
        expect(await personOfUser(sql, account.id), "sign-in itself connected nobody").toBeNull();

        // Enrolment does NOT verify the session (E-35): the post-login router lands on N0, and Check
        // again names the verify step (the account is enrolled, so never the "set up" variant).
        await page.goto("/launch");
        await page.waitForURL((url) => url.pathname === "/no-organization", { timeout: 30_000 });
        await expect(n0(page)).toBeVisible();
        await pressCheckAgain(page);
        const notice = page.getByTestId("second-factor-notice");
        await expect(notice).toContainText(
          "One more step: confirm two-factor sign-in to finish connecting. Then come back here and select Check again.",
          { timeout: 30_000 },
        );
        await expect(notice).not.toContainText("set up two-factor sign-in");
        const verify = notice.getByRole("link", { name: "Continue to verification" });
        await expectTargets44(verify);
        await noHorizontalOverflow(page);
        expect(await personOfUser(sql, account.id)).toBeNull();
        await verify.click();
        await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
        expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/no-organization");
        await submitTotp(page, secret);
        await page.waitForURL((url) => url.pathname === "/no-organization", { timeout: 30_000 });

        // Verified now: Check again connects, and the congregation loads through the wall.
        await pressCheckAgain(page);
        await page.waitForURL(new RegExp(`/o/${o.slug}`), { timeout: 60_000 });
        await expect(page.getByText(o.name).first()).toBeVisible({ timeout: 30_000 });
        expect(new URL(page.url()).pathname, "no second challenge on the way in").toBe(`/o/${o.slug}`);
        expect(await personOfUser(sql, account.id)).toBe(elder.personId);

        const rows = await auditFor(sql, "tenant.person.sign_in_connected", elder.personId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.metadata).toMatchObject({ via: "check_again", secondFactor: true, organizationId: o.orgId });
        expect(rows[0]!.metadata.authority).toMatchObject({ sessionSeat: true });
        expect(JSON.stringify(rows[0]!.metadata)).not.toContain("@");
      });

      test("(d2) an elder whose account is not enrolled is told to set up two-factor sign-in, and the link goes to enrolment and back", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        await addSession(sql, o);
        const account = await addAccount(sql, o, "elder2");
        const elder = await addMember(sql, o, { first: "Isidore", last: "Brackenridge", email: account.email });
        await seatElder(sql, o, elder.personId);

        await signInAs(page, account, /\/no-organization/);
        await expect(n0(page)).toBeVisible();
        await pressCheckAgain(page);
        const notice = page.getByTestId("second-factor-notice");
        await expect(notice).toContainText(
          "One more step: set up two-factor sign-in to finish connecting. Then come back here and select Check again.",
          { timeout: 30_000 },
        );
        const enrol = notice.getByRole("link", { name: "Set up two-factor sign-in" });
        await expectTargets44(enrol);
        await noHorizontalOverflow(page);
        await enrol.click();
        await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 30_000 });
        expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/no-organization");
        await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible({ timeout: 30_000 });
        expect(await personOfUser(sql, account.id)).toBeNull();
      });

      test("(e) with the toggle off nobody is connected, and an invitation still works", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, false);
        const account = await addAccount(sql, o, "off");
        const member = await addMember(sql, o, { first: "Cordelia", last: "Fenwick", email: account.email });
        const sender = await addSender(sql, o);

        await signInAs(page, account, /\/no-organization/);
        await expect(n0(page)).toBeVisible();
        await pressCheckAgain(page);
        await expect(page.getByText(NOTHING_NEW)).toBeVisible({ timeout: 30_000 });
        expect(await personOfUser(sql, account.id)).toBeNull();

        // The congregation invites them; the card appears and Accept connects.
        await seedSignInInvitation(sql, o, { personId: member.personId, address: account.email, createdByUserId: sender.user.id });
        await page.reload();
        await expect(page.getByTestId("invitation-card")).toBeVisible({ timeout: 30_000 });
        const accept = page.getByRole("button", { name: "Accept the invitation" });
        await expect(accept).toBeEnabled({ timeout: 30_000 });
        await accept.click();
        await page.waitForURL(new RegExp(`/o/${o.slug}`), { timeout: 60_000 });
        expect(await personOfUser(sql, account.id)).toBe(member.personId);
      });

      test("(f) an open sign-in invitation blocks auto-connect, shows as a card, and Accept connects in place", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        const account = await addAccount(sql, o, "invitee");
        const member = await addMember(sql, o, { first: "Ambrose", last: "Tillinghast", email: account.email });
        const sender = await addSender(sql, o);
        const invitation = await seedSignInInvitation(sql, o, { personId: member.personId, address: account.email, createdByUserId: sender.user.id });

        // The toggle is on, but an open invitation is the way in (FB5): sign-in lands on the card, unconnected.
        await signInAs(page, account, /\/no-organization/);
        expect(await personOfUser(sql, account.id)).toBeNull();
        await expect(page.getByRole("heading", { level: 1, name: `You're invited to ${o.name}` })).toBeVisible();
        const card = page.getByTestId("invitation-card");
        await expect(card).toHaveCount(1);
        await expect(card).toContainText(
          `${o.name} invited you to sign in. Accepting connects this sign-in to your record there as Ambrose Tillinghast.`,
        );
        await expect(card).toContainText("This invitation expires ");
        await expect(page.getByRole("button", { name: "Sign in with a different account" })).toBeVisible();
        await noHorizontalOverflow(page);
        const accept = page.getByRole("button", { name: "Accept the invitation" });
        await expect(accept).toBeEnabled({ timeout: 30_000 });
        await expectTargets44(accept);

        await accept.click();
        await page.waitForURL(new RegExp(`/o/${o.slug}`), { timeout: 60_000 });
        expect(await personOfUser(sql, account.id)).toBe(member.personId);

        const accepted = await auditFor(sql, "invitation.accepted", invitation.id);
        expect(accepted).toHaveLength(1);
        expect(accepted[0]!.metadata).toMatchObject({ via: "in_place", purpose: "sign_in", personId: member.personId, secondFactor: false });
        expect(accepted[0]!.actor_user_id).toBe(account.id);
        const row = (await invitationsAt(sql, o)).find((r) => r.id === invitation.id)!;
        expect(row.accepted_user_id).toBe(account.id);
      });

      test("(g) a founding-administrator invitation: the second-factor notice first, then after the real challenge Accept designates", async ({ page }) => {
        const o = org!;
        const operatorId = await rosterUserId(sql, "admin");
        // Enrolled, but not REQUIRED by the account: sign-in does not push it through the challenge, so the
        // card meets an unverified session, which a designation always refuses (G9).
        const account = await addAccount(sql, o, "fa");
        await seedTotpEnrollment(sql, account.id);
        const invitation = await seedInvitation(sql, o, {
          purpose: "founding_administrator",
          email: account.email,
          createdByUserId: operatorId,
        });

        // Signed in, but not yet through the challenge: N2 in place of the Accept button.
        await signInAs(page, account, /\/no-organization/);
        await expect(page.getByRole("heading", { level: 1, name: `You're invited to ${o.name}` })).toBeVisible();
        const card = page.getByTestId("invitation-card");
        await expect(card).toContainText(`A PresbyPortal administrator invited you to be the founding administrator at ${o.name}.`);
        await expect(card.getByTestId("second-factor-notice")).toContainText(
          "Accepting this invitation needs two-factor sign-in. Finish verification, then accept.",
        );
        await expect(page.getByRole("button", { name: "Accept the invitation" })).toHaveCount(0);
        const verify = card.getByRole("link", { name: "Continue to verification" });
        await expectTargets44(verify);
        await noHorizontalOverflow(page);
        expect((await invitationsAt(sql, o))[0]!.accepted_at, "looking accepted nothing").toBeNull();

        await verify.click();
        await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
        expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/no-organization");
        await submitTotp(page, E2E_TOTP_TEST_SECRET);
        await page.waitForURL((url) => url.pathname === "/no-organization", { timeout: 30_000 });

        // Verified: the same card now offers Accept, and Accept designates.
        const accept = page.getByRole("button", { name: "Accept the invitation" });
        await expect(accept).toBeEnabled({ timeout: 30_000 });
        await accept.click();
        await page.waitForURL(new RegExp(`/o/${o.slug}`), { timeout: 60_000 });

        const accepted = await auditFor(sql, "invitation.accepted", invitation.id);
        expect(accepted).toHaveLength(1);
        expect(accepted[0]!.metadata).toMatchObject({ via: "in_place", purpose: "founding_administrator", secondFactor: true });
        const designated = (await auditAt(sql, o, "org.founding_administrator.designated")).filter(
          (r) => r.metadata.viaInvitationId === invitation.id,
        );
        expect(designated).toHaveLength(1);
        expect(designated[0]!.metadata).toMatchObject({ via: "in_place", secondFactor: true });
        expect(await personOfUser(sql, account.id)).not.toBeNull();
      });

      test("(h) an invitation revoked after the page rendered: Accept shows the in-place dead sentence", async ({ page }) => {
        const o = org!;
        const account = await addAccount(sql, o, "revoked");
        const member = await addMember(sql, o, { first: "Evander", last: "Pelham", email: account.email });
        const sender = await addSender(sql, o);
        const invitation = await seedSignInInvitation(sql, o, { personId: member.personId, address: account.email, createdByUserId: sender.user.id });

        await signInAs(page, account, /\/no-organization/);
        const accept = page.getByRole("button", { name: "Accept the invitation" });
        await expect(accept).toBeEnabled({ timeout: 30_000 });

        // The office cancels it while this page is still open.
        await revokeInvitation(sql, invitation.id, sender.user.id);
        await accept.click();
        const dead = page.getByRole("alert").filter({ hasText: "This invitation is no longer active." });
        await expect(dead).toHaveText(
          "This invitation is no longer active. Reload the page to see what is current, or ask whoever invited you to send a new one.",
          { timeout: 30_000 },
        );
        await expect(accept, "a finished invitation offers no second try").toHaveCount(0);
        await noHorizontalOverflow(page);
        expect(await personOfUser(sql, account.id)).toBeNull();
        expect(await auditFor(sql, "invitation.accepted", invitation.id)).toHaveLength(0);

        // After a reload the page tells the truth: nothing is waiting.
        await page.reload();
        await expect(n0(page)).toBeVisible();
      });

      test("(i) N0 says who is signed in and who to ask, and Sign in with a different account signs out", async ({ page }) => {
        const o = org!;
        const account = await addAccount(sql, o, "nobody");

        await signInAs(page, account, /\/no-organization/);
        await expect(n0(page)).toBeVisible();
        await expect(page.getByText(`You're signed in as ${account.email}. This sign-in isn't connected to a congregation's records yet.`)).toBeVisible();
        await expect(page.getByText("A congregation can connect you by the email address on your record.")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Ask the office that keeps your records" })).toBeVisible();
        await expect(page.getByText(`Ask them to check that ${account.email} is on your record, or to invite you. Then check again.`)).toBeVisible();
        await expect(page.getByText("If you were invited, the invitation should appear here once it was sent to this address.")).toBeVisible();
        await expect(page.getByText("Signing in doesn't connect you")).toHaveCount(0);
        await expect(page.getByText(/ask your church administrator/i)).toHaveCount(0);
        const different = page.getByRole("button", { name: "Sign in with a different account" });
        await expect(different).toBeEnabled({ timeout: 30_000 });
        await expectTargets44(checkAgain(page), different);
        await noHorizontalOverflow(page);

        await different.click();
        await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
        expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
        // Signed out: the app now treats this browser as a stranger.
        await page.goto("/no-organization");
        await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
      });

      test("(j) the bootstrap walk: the founding administrator sees the empty Session, the hand-off for a recorded elder, that elder connects, and the administrator records themselves and approves their own proposal", async ({ page, browser }) => {
        const o = org!;
        const operatorId = await rosterUserId(sql, "admin");
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        await addSession(sql, o);

        // A REAL founding administrator: the definer creates the roles, the staff membership and the link.
        const founder = await addAccount(sql, o, "founder");
        const designation = await seedInvitation(sql, o, { purpose: "founding_administrator", email: founder.email, createdByUserId: operatorId });
        expect(await acceptAsAccount(sql, designation.token, founder.id)).toBe("accepted");
        expect(await personOfUser(sql, founder.id), "the designation linked the founder").not.toBeNull();

        // A member proposal waits for the Session; an elder-to-be has an address on record and an enrolled account.
        const proposal = await addProposal(sql, o, founder.id, { first: "Marigold", last: "Hartwell" });
        const elderAccount = await addAccount(sql, o, "elderx");
        await seedTotpEnrollment(sql, elderAccount.id);
        const elder = await addMember(sql, o, { first: "Barnaby", last: "Colquhoun", email: elderAccount.email });

        // 1. The administrator signs in and reads the queue in READ mode: the Session is empty.
        await signInAs(page, founder, new RegExp(`/o/${o.slug}`));
        await page.goto(`/o/${o.slug}/admin/community/pending`);
        await expect(page.getByRole("heading", { level: 1, name: "Pending approvals" })).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText(/no one can approve yet|your session roster is empty/i).first()).toBeVisible();
        await expect(page.getByText("Only members of the Session can approve.")).toBeVisible();
        await expect(page.getByRole("button", { name: /^approve/i })).toHaveCount(0);
        await noHorizontalOverflow(page);

        // 2. An elder is recorded who has not connected a sign-in: the banner hands off to the invitation card.
        await seatElder(sql, o, elder.personId);
        await page.reload();
        await expect(
          page.getByText("1 member of the Session is recorded, but none has connected a sign-in yet, so no one can approve."),
        ).toBeVisible({ timeout: 45_000 });
        const rows = page.getByTestId("session-sign-in-rows");
        await expect(rows).toContainText(
          "A member of the Session is also connected when they sign in with the email address on their record, after confirming two-factor sign-in.",
        );
        const row = rows.getByTestId("session-sign-in-row");
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("Barnaby Colquhoun");
        await expect(row).toContainText("Not invited yet");
        const invite = row.getByRole("link", { name: /^invite/i });
        await expectTargets44(invite);
        await expect(invite).toHaveAttribute("href", `/o/${o.slug}/admin/community/${elder.personId}/edit#sign-in`);
        await noHorizontalOverflow(page);

        // 3. The elder signs in on their own device: authority needs the second factor, then Check again connects.
        const device = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        try {
          const elderPage = await device.newPage();
          await signInAs(elderPage, elderAccount, /\/no-organization/);
          await expect(n0(elderPage)).toBeVisible();
          await pressCheckAgain(elderPage);
          await expect(elderPage.getByTestId("second-factor-notice")).toContainText("One more step: confirm two-factor sign-in", { timeout: 30_000 });
          await elderPage.getByRole("link", { name: "Continue to verification" }).click();
          await elderPage.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
          await submitTotp(elderPage, E2E_TOTP_TEST_SECRET);
          await elderPage.waitForURL((url) => url.pathname === "/no-organization", { timeout: 30_000 });
          await pressCheckAgain(elderPage);
          await elderPage.waitForURL(new RegExp(`/o/${o.slug}`), { timeout: 60_000 });
        } finally {
          await device.close();
        }
        expect(await personOfUser(sql, elderAccount.id)).toBe(elder.personId);

        // The hand-off is gone: someone on the Session has a sign-in now.
        await page.reload();
        await expect(page.getByTestId("session-sign-in-rows")).toHaveCount(0, { timeout: 45_000 });

        // 4. The administrator records THEMSELVES as a ruling elder under Officers.
        await page.goto(`/o/${o.slug}/admin/officers`);
        const person = page.locator("#officer-term-person");
        await expect(person).toBeEnabled({ timeout: 45_000 });
        await person.selectOption({ label: "Rosalind Thistlewood" });
        await expect(page.getByTestId("self-note")).toContainText(
          "You're recording yourself as a member of the Session. That's allowed, and the record will show it as self-recorded.",
        );
        await page.locator("#officer-term-starts-on").fill("2024-01-15");
        await page.getByRole("button", { name: "Add officer term" }).click();
        await expect(page.getByText("Officer term recorded.")).toBeVisible({ timeout: 45_000 });
        await noHorizontalOverflow(page);

        // 5. The queue is in DECIDE mode and they approve their own proposal.
        await page.goto(`/o/${o.slug}/admin/community/pending`);
        const pending = page.getByTestId("pending-row").filter({ hasText: proposal.name });
        const approve = pending.getByRole("button", { name: /^approve /i });
        await expect(approve).toBeEnabled({ timeout: 45_000 });
        await approve.click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: /^approve$/i }).click();
        await expect(page.getByText(`${proposal.name}'s roll action approved.`)).toBeVisible({ timeout: 45_000 });
        await noHorizontalOverflow(page);

        // 6. The persisted outcome: both audit rows carry the self stamps.
        const termRows = (await auditAt(sql, o, "tenant.officer_term.started")).filter((r) => r.metadata.selfRecorded === true);
        expect(termRows).toHaveLength(1);
        expect(termRows[0]!.actor_user_id).toBe(founder.id);
        expect(termRows[0]!.metadata).toMatchObject({ office: "ruling_elder", selfRecorded: true });
        const approvals = (await auditAt(sql, o, "tenant.roll_action.approved")).filter((r) => r.resource_id === proposal.rollActionId);
        expect(approvals).toHaveLength(1);
        expect(approvals[0]!.actor_user_id).toBe(founder.id);
        expect(approvals[0]!.metadata).toMatchObject({ kind: "profession_of_faith", selfApproved: true });
        const [rollRow] = (await sql`select approval_status, decided_by from roll_actions where id = ${proposal.rollActionId}::uuid`) as { approval_status: string; decided_by: string }[];
        expect(rollRow).toEqual({ approval_status: "approved", decided_by: founder.id });
      });
    });
  }
});
