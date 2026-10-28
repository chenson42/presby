/**
 * community-sign-in-invite.spec.ts - Community Increment 2b, Batch D: the
 * congregation's own sign-in invitation, end to end against a running server, at
 * a desktop width and at 360px (docs/work-log/2026-10-22-founding-admin-
 * directory.md, Phase 3 "4. e2e (Batch D)" ten lanes with the Copy of
 * amendment 2 section 10, and section 8.5 item 2).
 *
 * Who: a throwaway congregation (`e2e-invite-<stamp>`) with a SENDER, a linked
 * account holding people.manage, officers.manage, directory.view and
 * roll.propose by a custom role (the "office"). Everything the spec creates goes
 * with the congregation; the shared community fixture's `e2e-alpha` is not used,
 * because invitation rows are permanent and the per-person, per-sender and
 * per-address limits would make a permanent fixture fail on a repeat run.
 *
 * Where a lane needs a link it can open, the invitation is SEEDED with a known
 * token on the owner connection (the raw token never exists in the database, and
 * a sent email's body does not carry it in the clear). The sends that matter
 * (lanes 1, 2's second send and 4) go through the real dialog and the real
 * definer.
 *
 *   1. send from the card: dialog, toast, the pending card, one `invitation.created`
 *      audit row (ids only), one queued email;
 *   2. Send again inside the cooldown is disabled and says why; after the clock
 *      is advanced it succeeds, the earlier link is dead, the chain is recorded;
 *   3. Cancel invitation, and the dead-link page for the old token;
 *   4. a visitor: the acknowledgement paragraph, and Send is refused until the
 *      box is ticked;
 *   5. a person with no email: the no-address state and no Send button;
 *   6. editing the person's email after sending makes the old link the dead-link
 *      page (R27 end to end), and the card says the address changed;
 *   7. a NEW invitee accepts a seeded row, signs in, enrols two-factor (the
 *      codes panel's Continue lands in the congregation with no second /totp
 *      challenge, F166) and sees the baseline only;
 *   8. an existing account accepts through "Sign in to accept";
 *   9. the Community list marker for an elder with no sign-in, its link into the
 *      card, and its absence for a viewer without people.manage (and the Officers
 *      roster beside it);
 *  10. the Session hand-off under the banner, then the state after one is sent.
 *
 * FLAGS. `org_portal.members_create` and `org_portal.officers` (the Community and
 * Officers pages) and `auth.require_2fa` (lane 7's wall) are captured, set and
 * restored; the organization's own members_create toggle is written by SQL on
 * the throwaway congregation. No key is added to `e2e-baseline-flags.sql`.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  addAccount,
  addBaselineMemberRole,
  addMember,
  addSender,
  addSession,
  auditAt,
  backdateInvitation,
  COMMUNITY_FLAG,
  CONNECT_TOGGLE,
  continueFromCodesPanel,
  enrolOnPage,
  expectTargets44,
  invitationsAt,
  noHorizontalOverflow,
  OFFICERS_FLAG,
  personOfUser,
  REQUIRE_2FA_FLAG,
  removeSignInOrg,
  seatElder,
  seedSignInInvitation,
  setOrgToggle,
  signInAs,
  VIEWPORTS,
  type FixtureMember,
  type FixtureSender,
} from "./support/sign-in-invite-fixture";
import { setupInviteOrg, type InviteOrg } from "./support/invitation-fixture";
import { DEAD_LINK_PHRASE } from "./support/invitation-observer";
import { deadHeading } from "./support/invitation-ui";

const PASSWORD = "Brindled-Wren-Cordage-42"; // leak-ok: a throwaway password for a `.invalid` fixture account, deleted at teardown (not a credential)

test.describe("Community sign-in invitation", () => {
  test.setTimeout(240_000);

  const ROLES_FLAG = "org_portal.roles";
  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("community-sign-in-invite.spec");
    // Lane 7 asserts the Roles page's PERMISSION refusal (`/admin/roles`), which is only reachable with
    // `org_portal.roles` on; it is off in the seed and in the CI baseline, so the spec sets it (QA run 1).
    flags = await captureFlags(sql, [COMMUNITY_FLAG, OFFICERS_FLAG, ROLES_FLAG, REQUIRE_2FA_FLAG]);
    for (const key of [COMMUNITY_FLAG, OFFICERS_FLAG, ROLES_FLAG, REQUIRE_2FA_FLAG]) await setFlag(sql, key, true);
  });

  test.afterAll(async () => {
    await flags.restore();
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      let org: InviteOrg | undefined;
      let sender: FixtureSender;

      test.beforeEach(async () => {
        org = await setupInviteOrg(sql);
        await setOrgToggle(sql, org, COMMUNITY_FLAG, true);
        // Connecting at sign-in is on, so the card's connect lines are the "by sign-in" ones; lane 3 turns it off.
        await setOrgToggle(sql, org, CONNECT_TOGGLE, true);
        sender = await addSender(sql, org);
      });

      test.afterEach(async () => {
        await removeSignInOrg(sql, org);
        org = undefined;
      });

      const card = (page: Page) => page.getByTestId("sign-in-card");
      const dialog = (page: Page) => page.getByRole("alertdialog");

      /** Signs the sender in and opens one person's edit page, waiting for the card. */
      async function openCard(page: Page, person: FixtureMember, { signIn = true } = {}) {
        const o = org!;
        if (signIn) await signInAs(page, sender.user, new RegExp(`/o/${o.slug}`));
        await page.goto(`/o/${o.slug}/admin/community/${person.personId}/edit`);
        await expect(card(page)).toBeVisible({ timeout: 60_000 });
        await expect(card(page).getByRole("heading", { name: "Sign in to PresbyPortal" })).toBeVisible();
      }

      /** The dialog sits inside the viewport on both axes, and its buttons are 44px. */
      async function expectDialogFits(page: Page) {
        await expect(async () => {
          const box = (await dialog(page).boundingBox())!;
          expect(box).not.toBeNull();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
          expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
          // Measured inside the retry: the dialog zooms in, and a button caught mid-animation reads short.
          for (const button of await dialog(page).getByRole("button").all()) await expectTargets44(button);
        }).toPass({ timeout: 10_000 });
      }

      async function sendFromDialog(page: Page, label: string) {
        const confirm = dialog(page).getByRole("button", { name: label, exact: true });
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect(dialog(page)).toHaveCount(0, { timeout: 45_000 });
      }

      async function personWithAddress(tag: string, extra: { engagement?: "regular" | "visitor" } = {}) {
        const o = org!;
        return addMember(sql, o, {
          first: "Philippa",
          last: `Drummond${tag}`,
          email: `${o.emailPrefix}${tag}@example.invalid`,
          ...extra,
        });
      }

      // -----------------------------------------------------------------
      test("1. send from the card: the dialog, the toast, the pending card, one audit row and one queued email", async ({ page }) => {
        const o = org!;
        const person = await personWithAddress("send");
        await openCard(page, person);

        await expect(card(page)).toContainText(
          `Invite ${person.name} to sign in. We'll email ${person.email} with a link that works once. Accepting lets them sign in as themselves, and any role or seat they hold here then takes effect.`,
        );
        await expect(card(page)).toContainText(
          `When ${person.name} signs in with ${person.email}, PresbyPortal connects them to this record if it can. An invitation also connects them.`,
        );
        const trigger = card(page).getByRole("button", { name: "Send invitation", exact: true });
        await expect(trigger).toBeEnabled({ timeout: 30_000 });
        await expectTargets44(trigger);
        await noHorizontalOverflow(page);

        await trigger.click();
        await expect(dialog(page).getByRole("heading", { name: `Send an invitation to ${person.name}?` })).toBeVisible();
        await expect(dialog(page)).toContainText(`We'll email ${person.email}. The link works once and expires on `);
        await expect(dialog(page)).toContainText(
          `Only send it if that address belongs to ${person.name}: whoever opens the link becomes ${person.name} on PresbyPortal.`,
        );
        await expect(dialog(page).getByRole("checkbox"), "no acknowledgement for a regular member").toHaveCount(0);
        await expectDialogFits(page);
        await sendFromDialog(page, "Send invitation");

        await expect(page.getByText(/^Invitation (sent to .+\. It expires |saved\. The email will go out shortly)/).first()).toBeVisible({ timeout: 30_000 });
        await expect(card(page)).toContainText(`Invitation sent to ${person.email} on `, { timeout: 45_000 });
        await expect(card(page)).toContainText("It expires ");
        await expect(card(page)).toContainText(
          `While this invitation is open, signing in does not connect ${person.name} by itself. They accept the invitation instead.`,
        );
        // Just sent: the five-minute cooldown is named and Send again waits.
        await expect(card(page)).toContainText("You sent this a moment ago. You can send it again in 5 minutes.");
        await expect(card(page).getByRole("button", { name: "Send again", exact: true })).toBeDisabled();
        await expect(card(page).getByRole("button", { name: "Cancel invitation", exact: true })).toBeEnabled();
        await noHorizontalOverflow(page);

        const rows = await invitationsAt(sql, o);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ purpose: "sign_in", origin: "org", person_id: person.personId, resend_count: 0, accepted_at: null, revoked_at: null });
        const created = (await auditAt(sql, o, "invitation.created")).filter((r) => r.resource_id === rows[0]!.id);
        expect(created).toHaveLength(1);
        expect(created[0]!.actor_user_id).toBe(sender.user.id);
        expect(JSON.stringify(created[0]!.metadata), "audit rows carry ids only").not.toContain("@");
        const queued = (await sql`
          select template_key, to_email from email_queue where id = ${rows[0]!.email_queue_id}::uuid`) as { template_key: string; to_email: string }[];
        expect(queued).toEqual([{ template_key: "account_sign_in_invitation", to_email: person.email! }]);
      });

      // -----------------------------------------------------------------
      test("2. Send again inside the cooldown is disabled and says why; after the clock moves it succeeds and the earlier link is dead", async ({ page }) => {
        const o = org!;
        const person = await personWithAddress("again");
        const first = await seedSignInInvitation(sql, o, { personId: person.personId, address: person.email!, createdByUserId: sender.user.id });
        await openCard(page, person);

        await expect(card(page)).toContainText(`Invitation sent to ${person.email} on `);
        await expect(card(page)).toContainText("You sent this a moment ago. You can send it again in 5 minutes.");
        await expect(card(page).getByRole("button", { name: "Send again", exact: true })).toBeDisabled();

        // Five minutes pass (the fixture moves the row's clock; created_at is immutable to everyone else).
        await backdateInvitation(sql, first.id, 10);
        await page.reload();
        await expect(card(page)).toContainText("Sending again turns off the earlier link.", { timeout: 45_000 });
        const again = card(page).getByRole("button", { name: "Send again", exact: true });
        await expect(again).toBeEnabled({ timeout: 30_000 });
        await expectTargets44(again);
        await again.click();
        await expect(dialog(page).getByRole("heading", { name: "Send this invitation again?" })).toBeVisible();
        await expect(dialog(page)).toContainText(`We'll email ${person.email} a new link. The earlier link stops working.`);
        await expectDialogFits(page);
        await sendFromDialog(page, "Send again");
        await expect(page.getByText(`Invitation sent again to ${person.email}.`)).toBeVisible({ timeout: 30_000 });
        await expect(card(page)).toContainText("You sent this a moment ago.", { timeout: 45_000 });

        const rows = await invitationsAt(sql, o);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.id).toBe(first.id);
        expect(rows[0]!.superseded_at, "the earlier row is superseded").not.toBeNull();
        expect(rows[1]).toMatchObject({ resend_count: 1, resent_from_id: first.id, superseded_at: null, revoked_at: null });
        const resent = (await auditAt(sql, o, "invitation.resent")).filter((r) => r.metadata.invitationId === rows[1]!.id || r.resource_id === rows[1]!.id);
        expect(resent.length).toBeGreaterThan(0);

        // The earlier link is the one dead-link page.
        await page.context().clearCookies();
        await page.goto(`/invite?token=${first.token}`);
        await expect(deadHeading(page)).toBeVisible();
      });

      // -----------------------------------------------------------------
      test("3. Cancel invitation: the dialog, the card goes back to Invite, and the old link is the dead-link page", async ({ page }) => {
        const o = org!;
        const person = await personWithAddress("cancel");
        const seeded = await seedSignInInvitation(sql, o, { personId: person.personId, address: person.email!, createdByUserId: sender.user.id });
        await openCard(page, person);

        const cancel = card(page).getByRole("button", { name: "Cancel invitation", exact: true });
        await expect(cancel).toBeEnabled({ timeout: 30_000 });
        await expectTargets44(cancel);
        await cancel.click();
        await expect(dialog(page).getByRole("heading", { name: "Cancel this invitation?" })).toBeVisible();
        await expect(dialog(page)).toContainText(
          `The link will stop working, and ${person.name} won't be able to sign in until you send a new one.`,
        );
        await expectDialogFits(page);
        const keep = dialog(page).getByRole("button", { name: "Keep it" });
        await keep.click();
        await expect(dialog(page)).toHaveCount(0);
        expect((await invitationsAt(sql, o))[0]!.revoked_at, "Keep it changes nothing").toBeNull();

        await cancel.click();
        await dialog(page).getByRole("button", { name: "Cancel invitation", exact: true }).click();
        await expect(page.getByText("Invitation cancelled.")).toBeVisible({ timeout: 30_000 });
        await expect(card(page)).toContainText(`Invite ${person.name} to sign in.`, { timeout: 45_000 });
        await expect(card(page).getByRole("button", { name: "Send invitation", exact: true })).toBeVisible();
        await expect(card(page)).toContainText(
          `When ${person.name} signs in with ${person.email}, PresbyPortal connects them to this record if it can.`,
        );

        // With connecting turned off for the congregation the card says so, and an invitation still connects.
        await setOrgToggle(sql, o, CONNECT_TOGGLE, false);
        await page.reload();
        await expect(card(page)).toContainText(
          `Connecting people when they sign in is turned off for ${o.name}. An invitation still connects them.`,
          { timeout: 45_000 },
        );
        await noHorizontalOverflow(page);

        const [row] = await invitationsAt(sql, o);
        expect(row!.revoked_at).not.toBeNull();
        const revoked = (await auditAt(sql, o, "invitation.revoked")).filter((r) => r.metadata.invitationId === seeded.id || r.resource_id === seeded.id);
        expect(revoked).toHaveLength(1);

        await page.context().clearCookies();
        await page.goto(`/invite?token=${seeded.token}`);
        await expect(deadHeading(page)).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: DEAD_LINK_PHRASE })).toBeVisible();
      });

      // -----------------------------------------------------------------
      test("4. a visitor: the acknowledgement is shown, and Send is refused until the box is ticked", async ({ page }) => {
        const o = org!;
        const visitor = await personWithAddress("visitor", { engagement: "visitor" });
        await openCard(page, visitor);

        await expect(card(page)).toContainText(
          `${visitor.name} is a visitor, so signing in won't connect them by itself. Send an invitation if you want them to have access.`,
        );
        const trigger = card(page).getByRole("button", { name: "Send invitation", exact: true });
        await expect(trigger).toBeEnabled({ timeout: 30_000 });
        await trigger.click();
        await expect(dialog(page)).toContainText(
          `${visitor.name} is recorded as a visitor. Anyone who signs in can see your member directory and your calendar, with each person's privacy settings applied. Only continue if you want ${visitor.name} to have that.`,
        );
        const box = dialog(page).getByRole("checkbox", { name: "I understand, send it anyway" });
        await expect(box).toBeVisible();
        await expect(box).not.toBeChecked();
        const send = dialog(page).getByRole("button", { name: "Send invitation", exact: true });
        await expect(send, "refused until the box is ticked").toBeDisabled();
        await expectDialogFits(page);
        expect(await invitationsAt(sql, o)).toHaveLength(0);

        await box.check();
        await expect(send).toBeEnabled();
        await send.click();
        await expect(dialog(page)).toHaveCount(0, { timeout: 45_000 });
        await expect(card(page)).toContainText(`Invitation sent to ${visitor.email} on `, { timeout: 45_000 });
        expect(await invitationsAt(sql, o)).toHaveLength(1);
      });

      // -----------------------------------------------------------------
      test("5. a person with no email: the no-address state and no Send button", async ({ page }) => {
        const o = org!;
        const person = await addMember(sql, o, { first: "Leopold", last: "Ainsworth", email: null });
        await openCard(page, person);

        await expect(card(page)).toContainText(`${person.name} has no email address on file. Add one under Contact & address, then come back.`);
        await expect(card(page).getByRole("button")).toHaveCount(0);
        await noHorizontalOverflow(page);
        expect(await invitationsAt(sql, o)).toHaveLength(0);
      });

      // -----------------------------------------------------------------
      test("6. editing the person's email after sending: the old link is the dead-link page and the card says the address changed", async ({ page }) => {
        const o = org!;
        const person = await personWithAddress("typo");
        const seeded = await seedSignInInvitation(sql, o, { personId: person.personId, address: person.email!, createdByUserId: sender.user.id });
        await signInAs(page, sender.user, new RegExp(`/o/${o.slug}`));

        // The link works while the address matches.
        const visitor = await page.context().browser()!.newContext({ viewport: { width: vp.width, height: vp.height } });
        try {
          const stranger = await visitor.newPage();
          await stranger.goto(new URL(`/invite?token=${seeded.token}`, page.url()).toString());
          await expect(stranger.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
          expect(await deadHeading(stranger).count()).toBe(0);
        } finally {
          await visitor.close();
        }

        // The office corrects the address in the person's record.
        const corrected = `${o.emailPrefix}typo-fixed@example.invalid`;
        await page.goto(`/o/${o.slug}/admin/community/${person.personId}/edit`);
        await expect(page.getByRole("button", { name: /^save$/i })).toBeEnabled({ timeout: 60_000 });
        await page.getByLabel("Email address", { exact: true }).first().fill(corrected);
        await page.getByRole("button", { name: /^save$/i }).click();
        await expect(page.getByText("Person updated.", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
        await page.waitForURL((url) => url.pathname === `/o/${o.slug}/admin/community`, { timeout: 45_000 });

        await openCard(page, person, { signIn: false });
        await expect(card(page)).toContainText(
          `The address on file changed after this was sent, so the earlier link no longer works. Send again to reach ${corrected}.`,
          { timeout: 45_000 },
        );
        const sendAgain = card(page).getByRole("button", { name: /^Send again$/ });
        await expect(sendAgain).toBeVisible();
        await noHorizontalOverflow(page);

        // R27 end to end: the link opens the one dead-link page now.
        const after = await page.context().browser()!.newContext({ viewport: { width: vp.width, height: vp.height } });
        try {
          const stranger = await after.newPage();
          await stranger.goto(new URL(`/invite?token=${seeded.token}`, page.url()).toString());
          await expect(deadHeading(stranger)).toBeVisible();
        } finally {
          await after.close();
        }
      });

      // -----------------------------------------------------------------
      test("7. a NEW invitee accepts a seeded row, signs in, enrols two-factor with no second challenge and sees the baseline only", async ({ page }) => {
        const o = org!;
        await addBaselineMemberRole(sql, o);
        const person = await personWithAddress("fresh");
        const seeded = await seedSignInInvitation(sql, o, { personId: person.personId, address: person.email!, createdByUserId: sender.user.id });

        // Nothing about the person is shown before sign-in, and nothing is pre-filled (G5).
        await page.goto(`/invite?token=${seeded.token}`);
        await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
        await expect(page.getByText(`${o.name} invited you to sign in. Signing in lets you see what ${o.name} shares with its people. What you can do depends on your role there.`)).toBeVisible();
        const body = (await page.locator("body").textContent()) ?? "";
        expect(body).not.toContain(person.name);
        expect(body).not.toContain(person.email!);
        expect(body).toContain("***@example.invalid");
        const first = page.locator("#invite-first-name");
        await expect(first).toBeEnabled({ timeout: 30_000 });
        await expect(first).toHaveValue("");
        await expect(page.locator("#invite-last-name")).toHaveValue("");
        await noHorizontalOverflow(page);

        await first.fill("Rosamund");
        await page.locator("#invite-last-name").fill("Tavistock");
        await page.locator("#invite-password").fill(PASSWORD);
        await page.locator("#invite-confirm").fill(PASSWORD);
        await page.getByRole("button", { name: "Create account" }).click();
        await page.waitForURL((url) => url.pathname === "/invite/accepted", { timeout: 45_000 });
        await expect(page.getByRole("heading", { level: 1, name: "Your account is ready" })).toBeVisible();

        const [user] = (await sql`
          select id, two_factor_required, email_verified is not null as verified from users where lower(email) = ${person.email!}`) as {
          id: string; two_factor_required: boolean; verified: boolean;
        }[];
        expect(user).toMatchObject({ two_factor_required: true, verified: true });
        expect(await personOfUser(sql, user!.id), "accepting linked the account to the invited person").toBe(person.personId);

        // Sign in: a new account must use two-factor sign-in, so /totp sends it to enrolment first.
        await page.getByRole("link", { name: "Sign in" }).click();
        await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
        const email = page.locator('input[name="email"]');
        await expect(email).toBeEnabled({ timeout: 30_000 });
        await email.fill(person.email!);
        await page.locator('input[name="password"]').fill(PASSWORD);
        await page.getByRole("button", { name: /sign in with email/i }).click();
        await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 45_000 });
        expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
        await enrolOnPage(page);

        // F166 (DECISION-292, replaces E-35): enrolling verifies the session, so the codes panel's Continue goes
        // through the post-login router straight into the congregation, with no /totp challenge in front of it.
        await continueFromCodesPanel(page, "/launch", (url) => url.pathname === `/o/${o.slug}`);
        await expect(page.getByText(o.name).first()).toBeVisible({ timeout: 30_000 });

        // Baseline only. The home page's tiles are NAVIGATION, never authority (DECISION-003: the tile
        // registry is flag- and toggle-gated and "the destination route stays the sole authority"), so a
        // member sees tiles for the administration pages the congregation has turned on. What must hold is
        // that the destinations refuse them (the pages that check on SUBMIT, like Add person's first
        // step, are covered by the absent "Add person" link below and by the server action's own tests).
        for (const path of ["admin/officers", "admin/roles"]) {
          await page.goto(`/o/${o.slug}/${path}`);
          await expect(page.getByText(/don.t have permission/i).first(), `/${path} refuses a baseline member`).toBeVisible({ timeout: 45_000 });
        }
        await page.goto(`/o/${o.slug}/admin/community`);
        await expect(page.getByRole("heading", { level: 1, name: "Community" })).toBeVisible({ timeout: 45_000 });
        await expect(page.getByRole("link", { name: "Add person" })).toHaveCount(0);
        await expect(page.getByTestId("sign-in-marker")).toHaveCount(0);
        for (const view of ["visitors", "staff", "former"]) {
          await page.goto(`/o/${o.slug}/admin/community?view=${view}`);
          await expect(page.getByText(`You don't have permission to do that at ${o.name}.`)).toBeVisible({ timeout: 45_000 });
        }
        await page.goto(`/o/${o.slug}/admin/community/${person.personId}/edit`);
        await expect(page.getByTestId("sign-in-card"), "no card for a viewer without people.manage").toHaveCount(0);

        const [accepted] = (await invitationsAt(sql, o)).filter((r) => r.id === seeded.id);
        expect(accepted!.accepted_user_id).toBe(user!.id);
        const acceptedAudit = (await auditAt(sql, o, "invitation.accepted")).filter((r) => r.resource_id === seeded.id);
        expect(acceptedAudit).toHaveLength(1);
        expect(acceptedAudit[0]!.metadata).toMatchObject({ purpose: "sign_in", mode: "new_account", personId: person.personId });
      });

      // -----------------------------------------------------------------
      test("8. an existing account accepts through Sign in to accept", async ({ page }) => {
        const o = org!;
        const account = await addAccount(sql, o, "existing");
        const person = await addMember(sql, o, { first: "Hyacinth", last: "Overbury", email: account.email });
        const seeded = await seedSignInInvitation(sql, o, { personId: person.personId, address: account.email, createdByUserId: sender.user.id });

        await page.goto(`/invite?token=${seeded.token}`);
        await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
        const signInToAccept = page.getByRole("button", { name: "Sign in to accept" });
        await expectTargets44(signInToAccept);
        await noHorizontalOverflow(page);
        await signInToAccept.click();
        await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
        const email = page.locator('input[name="email"]');
        await expect(email).toBeEnabled({ timeout: 30_000 });
        await email.fill(account.email);
        await page.locator('input[name="password"]').fill(account.password);
        await page.getByRole("button", { name: /sign in with email/i }).click();

        await page.waitForURL((url) => url.pathname === "/invite", { timeout: 45_000 });
        expect(await deadHeading(page).count(), "no dead-link flash on the way back").toBe(0);
        await expect(page.getByText("Accepting as")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(person.name)).toBeVisible();
        const accept = page.getByRole("button", { name: "Accept invitation" });
        await expect(accept).toBeEnabled({ timeout: 30_000 });
        await expectTargets44(accept);
        await accept.click();
        await page.waitForURL((url) => url.pathname === `/o/${o.slug}`, { timeout: 60_000 });

        expect(await personOfUser(sql, account.id)).toBe(person.personId);
        const [row] = (await invitationsAt(sql, o)).filter((r) => r.id === seeded.id);
        expect(row!.accepted_user_id).toBe(account.id);
        const acceptedAudit = (await auditAt(sql, o, "invitation.accepted")).filter((r) => r.resource_id === seeded.id);
        expect(acceptedAudit).toHaveLength(1);
        expect(acceptedAudit[0]!.metadata).toMatchObject({ purpose: "sign_in", mode: "existing_account", personId: person.personId });
      });

      // -----------------------------------------------------------------
      test("9. the marker on the Community list and the Officers roster: an elder with no sign-in, its link into the card, and its absence for a viewer without people.manage", async ({ page, browser }) => {
        const o = org!;
        await addSession(sql, o);
        const elder = await personWithAddress("elder");
        await seatElder(sql, o, elder.personId);
        const elderNoMail = await addMember(sql, o, { first: "Cuthbert", last: "Nethercote", email: null });
        await seatElder(sql, o, elderNoMail.personId);
        const ordinary = await personWithAddress("ordinary");

        await signInAs(page, sender.user, new RegExp(`/o/${o.slug}`));
        await page.goto(`/o/${o.slug}/admin/community`);
        const elderRow = page.getByRole("listitem").filter({ hasText: elder.name });
        const marker = elderRow.getByTestId("sign-in-marker");
        await expect(marker).toBeVisible({ timeout: 60_000 });
        await expect(marker).toHaveAttribute("data-marker", "not_connected");
        await expect(marker).toContainText("Not connected yet");
        await expect(marker).toHaveAttribute("href", `/o/${o.slug}/admin/community/${elder.personId}/edit#sign-in`);
        await expectTargets44(marker);
        await expect(page.getByRole("listitem").filter({ hasText: elderNoMail.name }).getByTestId("sign-in-marker")).toContainText(
          "Not connected yet. No email on file",
        );
        await expect(
          page.getByRole("listitem").filter({ hasText: ordinary.name }).getByTestId("sign-in-marker"),
          "an ordinary member gets no marker",
        ).toHaveCount(0);
        await noHorizontalOverflow(page);

        // The marker is a way into the card.
        await marker.click();
        await page.waitForURL((url) => url.pathname === `/o/${o.slug}/admin/community/${elder.personId}/edit` && url.hash === "#sign-in", { timeout: 60_000 });
        await expect(card(page)).toBeVisible({ timeout: 60_000 });
        await expect(card(page).getByRole("button", { name: "Send invitation", exact: true })).toBeVisible();

        // Once an invitation is out the marker says so.
        await seedSignInInvitation(sql, o, { personId: elder.personId, address: elder.email!, createdByUserId: sender.user.id });
        await page.goto(`/o/${o.slug}/admin/community`);
        await expect(elderRow.getByTestId("sign-in-marker")).toHaveAttribute("data-marker", "pending", { timeout: 45_000 });
        await expect(elderRow.getByTestId("sign-in-marker")).toContainText("Invitation sent ");

        // The Officers roster carries it beside the Session seats.
        await page.goto(`/o/${o.slug}/admin/officers`);
        await expect(page.getByTestId("sign-in-marker").first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId("sign-in-marker")).toHaveCount(2);
        await noHorizontalOverflow(page);

        // A viewer who can read the directory but not manage people sees none of it.
        const viewer = await addSender(sql, o, { tag: "viewer", permissions: ["directory.view"] });
        const other = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        try {
          const viewerPage = await other.newPage();
          await signInAs(viewerPage, viewer.user, new RegExp(`/o/${o.slug}`));
          await viewerPage.goto(`/o/${o.slug}/admin/community`);
          await expect(viewerPage.getByRole("heading", { level: 1, name: "Community" })).toBeVisible({ timeout: 60_000 });
          await expect(viewerPage.getByRole("listitem").filter({ hasText: elder.name })).toBeVisible();
          await expect(viewerPage.getByTestId("sign-in-marker")).toHaveCount(0);
          await viewerPage.goto(`/o/${o.slug}/admin/community/${elder.personId}/edit`);
          await expect(viewerPage.getByTestId("sign-in-card")).toHaveCount(0);
        } finally {
          await other.close();
        }
      });

      // -----------------------------------------------------------------
      test("10. the Session hand-off under the banner: the rows and their Invite links, then the state after one is sent", async ({ page }) => {
        const o = org!;
        await setOrgToggle(sql, o, CONNECT_TOGGLE, true);
        await addSession(sql, o);
        const elder = await personWithAddress("session");
        await seatElder(sql, o, elder.personId);
        const quiet = await addMember(sql, o, { first: "Lysander", last: "Pettigrew", email: null });
        await seatElder(sql, o, quiet.personId);

        await signInAs(page, sender.user, new RegExp(`/o/${o.slug}`));
        await page.goto(`/o/${o.slug}/admin/community/pending`);
        await expect(
          page.getByText("2 members of the Session are recorded, but none has connected a sign-in yet, so no one can approve."),
        ).toBeVisible({ timeout: 60_000 });
        const rows = page.getByTestId("session-sign-in-rows");
        await expect(rows).toContainText(
          "A member of the Session is also connected when they sign in with the email address on their record, after confirming two-factor sign-in.",
        );
        const withAddress = rows.getByTestId("session-sign-in-row").filter({ hasText: elder.name });
        await expect(withAddress).toContainText("Not invited yet");
        const invite = withAddress.getByRole("link", { name: /^invite/i });
        await expectTargets44(invite);
        await expect(rows.getByTestId("session-sign-in-row").filter({ hasText: quiet.name })).toContainText("No email on file");
        await expect(rows).not.toContainText("Invitations sent to");
        await noHorizontalOverflow(page);

        // Invite takes them to the card; the send happens there.
        await invite.click();
        await page.waitForURL((url) => url.pathname === `/o/${o.slug}/admin/community/${elder.personId}/edit` && url.hash === "#sign-in", { timeout: 60_000 });
        const trigger = card(page).getByRole("button", { name: "Send invitation", exact: true });
        await expect(trigger).toBeEnabled({ timeout: 60_000 });
        await trigger.click();
        await sendFromDialog(page, "Send invitation");
        await expect(card(page)).toContainText(`Invitation sent to ${elder.email} on `, { timeout: 45_000 });

        // Back under the banner: the row says an invitation is out, its link now opens the card, and the count shows.
        await page.goto(`/o/${o.slug}/admin/community/pending`);
        const after = page.getByTestId("session-sign-in-rows").getByTestId("session-sign-in-row").filter({ hasText: elder.name });
        await expect(after).toContainText("Invitation sent ", { timeout: 60_000 });
        await expect(after.getByRole("link", { name: /^open/i })).toBeVisible();
        await expect(page.getByTestId("session-sign-in-rows")).toContainText(
          "Invitations sent to 1 of the 2 members of the Session. Waiting for them to accept.",
        );
        await noHorizontalOverflow(page);
      });
    });
  }
});
