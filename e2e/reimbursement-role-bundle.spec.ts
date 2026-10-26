/**
 * reimbursement-role-bundle.spec.ts - the ROLE-BUNDLE test, against a running server
 * (Treasury Increment 1, Batch 7; docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "New e2e specs" 4, DECISION-269, F3b, F323, EC31; the Batch 6 amendment T2).
 *
 * The question it answers: does a treasurer made the way a real one is made - by accepting a
 * `treasurer` invitation, which writes the `treasurer` role from the template
 * (`presby_apply_treasurer`) - hold, from that ONE role and nothing else, every key the
 * reimbursement work needs? The platform operator's invitation is accepted through the real
 * sign-in form and the real `/totp` challenge (an MFA-enrolled account); the person holds
 * exactly one role afterwards. Then, with no other grant:
 *   - view: the queue and a request;
 *   - pay: waive a receipt, record a payment, reverse it, add a note, send a request back, void
 *     one, and approve one as treasurer once a second person can pay;
 *   - manage: list and un-list a group, add a category, and use the Treasury team page;
 *   - request_for_others: the new-request form offers "Pay someone else back".
 * The Treasury team page shows the key badges on the treasurer's own row (T2), sets up the
 * Reimbursement Clerk role, and gives the Treasurer role to a SECOND member, who then signs in
 * through the real form and the real challenge and records the payment on the request the first
 * treasurer approved (whoever approves cannot also pay).
 *
 * A parallel DB test covers the same by calling the definers (`role-bundle.db.test.ts`); this one
 * is the browser's account of it. Everything lives in a THROWAWAY congregation (`e2e-invite-
 * <stamp>`, the invitation fixture's, removed in afterAll with its throwaway people and users).
 * Invented names, `.invalid` addresses, no real data.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  addRosterPerson,
  auditRowsFor,
  grantedRoleKeys,
  INVITE_NAMES,
  invitationRow,
  personAtOrgFor,
  removeInviteOrg,
  seedInvitation,
  setupInviteOrg,
  type InviteOrg,
} from "./support/invitation-fixture";
import { deadHeading, signInOnPage, submitTotp } from "./support/invitation-ui";
import {
  addMembership,
  createCategory,
  createGroup,
  createSecondPayer,
  makeChargeable,
  noHorizontalScroll,
  pid,
  REIMB_NAMES as NAMES,
  rosterUserId,
  SECOND_PAYER_EMAIL,
  SECOND_PAYER_PASSWORD,
  seedRequest,
  setToggle,
  statusOf,
  sweepStaleReimbursementFixtures,
  waitHydrated,
} from "./support/reimbursement-fixture";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { E2E_USERS } from "./support/users";

const TREASURER_KEYS = ["reimbursement.manage", "reimbursement.pay", "reimbursement.request_for_others", "reimbursement.view"];

let sql: Sql;
let org: InviteOrg;
let treasurer: BrowserContext;
const ids: Record<string, string> = {};
const who: Record<string, string> = {};

const admin = () => `/o/${org.slug}/admin/reimbursements`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

async function treasurerPage(width = 360, height = 740): Promise<Page> {
  const page = await treasurer.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `test-results/reimbursement-360/role-bundle-${name}.png`, fullPage });
}

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements: the role bundle, from a real treasurer invitation", () => {
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    sql = platformSql("reimbursement-role-bundle.spec");
    await sweepStaleReimbursementFixtures(sql);
    org = await setupInviteOrg(sql);

    who.treasurerUser = await rosterUserId(sql, "mfa-enrolled");
    who.requesterUser = await rosterUserId(sql, "member");
    who.chairUser = await rosterUserId(sql, "presbytery-nogrant");
    // The chair is a throwaway person of this spec's own (`pid(4)`, stamped at insert, in the fixed-id set the
    // sweep and teardown delete), linked to the seeded chair ACCOUNT. The seeded permanent person is never
    // put in the invitation org: that fixture's teardown stamps every member `deletable_until`, and a person
    // who keeps a seeded membership is then left stamped (F-QA-1, fixture-deletable.test.ts).
    who.chairPerson = pid(4);
    const wren = await createSecondPayer(sql, { signsIn: true });
    who.wrenUser = wren.id;
    who.wrenPerson = pid(41);
    who.requesterPerson = pid(2);
    ids.property = pid(10);
    ids.worship = pid(11);
    ids.supplies = pid(20);

    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${who.requesterPerson}::uuid, ${who.requesterUser}::uuid, 'Tamsin', 'Brightwater', now() + interval '3 hours'),
             (${who.wrenPerson}::uuid, ${who.wrenUser}::uuid, 'Wren', 'Podmore', now() + interval '3 hours'),
             (${who.chairPerson}::uuid, ${who.chairUser}::uuid, 'Marlowe', 'Fenwick', now() + interval '3 hours')`;
    for (const person of [who.requesterPerson, who.wrenPerson, who.chairPerson]) await addMembership(sql, org.orgId, person, "regular", "active");
    await createGroup(sql, org.orgId, { id: ids.property, name: NAMES.property, chairPersonId: who.chairPerson });
    await createGroup(sql, org.orgId, { id: ids.worship, name: NAMES.worship });
    await makeChargeable(sql, org.orgId, [ids.property, ids.worship], who.chairUser);
    await createCategory(sql, org.orgId, { id: ids.supplies, name: NAMES.supplies }, who.chairUser);
    await setToggle(sql, org.orgId, true);

    // The treasurer to be: a roster person with the invited account's address on file (what a treasurer invitation resolves).
    who.treasurerPerson = await addRosterPerson(sql, org, {
      first: INVITE_NAMES.rosterFirst,
      last: INVITE_NAMES.rosterLast,
      email: E2E_USERS["mfa-enrolled"].email,
    });

    // Requests, up to the point the treasurer role is not needed for (the chair approves; the treasurer's verbs come later).
    const actors = { orgId: org.orgId, categorySupplies: ids.supplies, requesterUser: who.requesterUser, chairUser: who.chairUser };
    ids.pay = await seedRequest(sql, actors, { key: "rb-pay-0000001", group: ids.property, cents: 4250, purpose: "Folding tables for the fellowship hall", upTo: "approved" });
    ids.sendBack = await seedRequest(sql, actors, { key: "rb-back-000001", group: ids.property, cents: 1999, purpose: "Hymnal repair kit", upTo: "approved" });
    ids.void = await seedRequest(sql, actors, { key: "rb-void-000001", group: ids.property, cents: 3000, purpose: "Candles for Advent", upTo: "submitted" });
    // Worship has no chair or leader: this one waits for the treasurer.
    ids.override = await seedRequest(sql, actors, { key: "rb-over-000001", group: ids.worship, cents: 7500, purpose: "Choir folders", upTo: "submitted" });
  });

  test.afterAll(async () => {
    test.setTimeout(240_000);
    await treasurer?.close().catch(() => undefined);
    await removeInviteOrg(sql, org);
    // The fixed-id people and the second payer's account are this spec's too.
    await sweepStaleReimbursementFixtures(sql);
  });

  // -------------------------------------------------------------------------
  test("the treasurer invitation is accepted through the real sign-in and the real /totp challenge, and the person holds exactly the one role", async ({ browser }) => {
    const self = E2E_USERS["mfa-enrolled"];
    const operatorId = await rosterUserId(sql, "admin");
    const invitation = await seedInvitation(sql, org, {
      purpose: "treasurer",
      email: self.email,
      createdByUserId: operatorId,
      personId: who.treasurerPerson,
    });

    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto(`/invite?token=${invitation.token}`);
    await expect(page.getByRole("heading", { level: 1, name: "You're invited" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in to accept" }).click();
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15_000 });
    await signInOnPage(page, self.email, self.password);
    await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/invite");
    await submitTotp(page, E2E_TOTP_TEST_SECRET);
    await page.waitForURL((url) => url.pathname === "/invite", { timeout: 30_000 });
    expect.soft(await deadHeading(page).count(), "no dead-link heading on the way back").toBe(0);
    // The roster's name is shown for confirmation before anything is linked.
    await expect(page.getByText(`${INVITE_NAMES.rosterFirst} ${INVITE_NAMES.rosterLast}`).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL((url) => url.pathname === `/o/${org.slug}`, { timeout: 40_000 });

    // The persisted outcome: the account is linked to the roster person, who holds ONE role - the template's.
    expect((await invitationRow(sql, invitation.id)).accepted_user_id).toBe(who.treasurerUser);
    expect(await personAtOrgFor(sql, org, who.treasurerUser)).toBe(who.treasurerPerson);
    expect(await grantedRoleKeys(sql, org, who.treasurerPerson)).toEqual(["treasurer"]);
    const designated = (await auditRowsFor(sql, invitation.id)).find((a) => a.action === "org.treasurer.designated");
    expect(designated, "the designation is audited").toBeDefined();
    expect((designated!.metadata.permissionKeys as string[]).filter((k) => k.startsWith("reimbursement.")).sort()).toEqual(TREASURER_KEYS);
    // Nothing else grants a key: the reimbursement keys come from that one role.
    const keys = await rows<{ permission_key: string }>(sql`
      select distinct arp.permission_key
        from role_grants rg join app_role_permissions arp on arp.role_id = rg.role_id
       where rg.organization_id = ${org.orgId}::uuid and rg.person_id = ${who.treasurerPerson}::uuid and arp.permission_key like 'reimbursement.%'
       order by 1`);
    expect(keys.map((k) => k.permission_key)).toEqual(TREASURER_KEYS);
    treasurer = context;
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("view: the queue and a request open from the role alone", async () => {
    const page = await treasurerPage();
    await page.goto(admin());
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursement requests" })).toBeVisible();
    await expect(page.getByTestId("queue-tabs").getByRole("link", { name: "Waiting for payment (2)" })).toBeVisible();
    await expect(page.getByTestId("queue-tabs").getByRole("link", { name: "Needs treasurer approval (1)" })).toBeVisible();
    // No "no one can pay" banner: the treasurer holds pay.
    await expect(page.getByTestId("no-pay-holder")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "queue");
    await page.goto(`${admin()}/${ids.pay}`);
    await expect(page.getByRole("heading", { level: 1, name: "$42.50" })).toBeVisible();
    await page.close();
  });

  test("pay: waive a receipt, record a payment, reverse it, add a note", async () => {
    const page = await treasurerPage();
    await page.goto(`${admin()}/${ids.pay}`);
    await waitHydrated(page);
    await expect(page.getByTestId("payment-block")).toHaveText("Add a receipt or waive it before paying.");
    await page.getByTestId("waive-open").click();
    await page.getByRole("dialog").getByTestId("waive-confirm").click();
    await expect(page.getByText("Receipt waived.").first()).toBeVisible();

    const form = page.getByTestId("payment-form");
    await form.getByLabel("Check number").fill("3001");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Payment recorded.").first()).toBeVisible();
    expect(await statusOf(sql, ids.pay)).toBe("paid");
    await expect(page.getByTestId("payment-row")).toContainText(`Check number 3001`);
    await expect(page.getByTestId("payment-row")).toContainText(`${INVITE_NAMES.rosterFirst} ${INVITE_NAMES.rosterLast}`);

    await page.getByTestId("reverse-open").click();
    const reverse = page.getByRole("dialog");
    await reverse.getByLabel("Reason", { exact: true }).fill("Check went to the wrong payee");
    await reverse.getByTestId("reverse-confirm").click();
    await expect(page.getByText("Payment reversed.").first()).toBeVisible();
    expect(await statusOf(sql, ids.pay)).toBe("approved");

    await page.getByTestId("note-open").click();
    const note = page.getByRole("dialog");
    await note.getByLabel("Note", { exact: true }).fill("Will re-issue on Friday");
    await note.getByTestId("note-confirm").click();
    await expect(page.getByTestId("request-history")).toContainText("Will re-issue on Friday");
    await noHorizontalScroll(page);
    await shot(page, "pay-verbs");
    await page.close();
  });

  test("pay: send an approved request back to the requester, and void an unpaid one", async () => {
    const page = await treasurerPage();
    await page.goto(`${admin()}/${ids.sendBack}`);
    await waitHydrated(page);
    await page.getByTestId("treasury-send-back-open").click();
    const back = page.getByRole("dialog");
    await back.getByLabel("Reason (the requester will see this)").fill("The amount does not match the invoice");
    await back.getByTestId("treasury-send-back-confirm").click();
    await expect(page.getByText("Sent back.").first()).toBeVisible();
    expect(await statusOf(sql, ids.sendBack)).toBe("returned");

    await page.goto(`${admin()}/${ids.void}`);
    await waitHydrated(page);
    await page.getByTestId("void-open").click();
    const voided = page.getByRole("dialog");
    await voided.getByLabel("Reason", { exact: true }).fill("Bought on the church card instead");
    await voided.getByTestId("void-confirm").click();
    await expect(page.getByText("Request voided.").first()).toBeVisible();
    expect(await statusOf(sql, ids.void)).toBe("voided");
    await page.close();
  });

  test("manage: list and un-list a group, add a category; request_for_others: the new-request form offers 'Pay someone else back'", async () => {
    const page = await treasurerPage();
    await page.goto(`${admin()}/settings`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursement settings" })).toBeVisible();
    const worship = page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship });
    await expect(worship.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    // The change is the database's, so the spec waits for IT (a reload straight after the click can beat the action).
    const listed = async () =>
      Number((await rows<{ n: number }>(sql`
        select count(*)::int as n from reimbursement_chargeable_groups
         where organization_id = ${org.orgId}::uuid and group_id = ${ids.worship}::uuid and ended_at is null`))[0]!.n);
    await worship.getByRole("switch").click();
    await expect.poll(listed, { timeout: 15_000 }).toBe(0);
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship }).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship }).getByRole("switch").click();
    await expect.poll(listed, { timeout: 15_000 }).toBe(1);
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship }).getByRole("switch")).toHaveAttribute("aria-checked", "true");

    await page.getByLabel("Name", { exact: true }).fill("Hospitality");
    await page.getByTestId("add-category-submit").click();
    await expect(page.getByTestId("category-row").filter({ hasText: "Hospitality" })).toHaveCount(1);

    // request_for_others: the kind choice that only a holder of the key is offered.
    await page.goto(`/o/${org.slug}/reimbursements/new`);
    await waitHydrated(page);
    await expect(page.getByRole("radio", { name: "Pay someone else back" })).toBeVisible();
    await noHorizontalScroll(page);
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("the Treasury team page: key badges on the treasurer's row, the clerk role set up, the Treasurer role given to a second member", async () => {
    const page = await treasurerPage();
    await page.goto(`${admin()}/team`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "Treasury team" })).toBeVisible();

    // T2: the row names the role's reimbursement keys in Copy's short words, in Copy's order.
    const row = page.getByTestId("team-row").filter({ hasText: INVITE_NAMES.rosterLast });
    await expect(row).toHaveCount(1);
    const keys = row.getByTestId("team-keys");
    await expect(keys).toBeVisible();
    expect((await keys.innerText()).split("\n").map((t) => t.trim()).filter(Boolean)).toEqual([
      "Enter requests for others",
      "View all requests",
      "Record payments",
      "Manage reimbursements",
    ]);
    await expect(keys.getByText("Manage reimbursements")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "team-badges");

    // The clerk role: set up from the template, nothing else is needed for it.
    await page.getByRole("button", { name: "Set up the Reimbursement Clerk role" }).click();
    await expect(page.getByText("Role set up.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up the Reimbursement Clerk role" })).toHaveCount(0);

    // Give the Treasurer role (the one the invitation wrote) to the second member.
    const roleSelect = page.getByLabel("Role", { exact: true });
    const options = await roleSelect.locator("option").allTextContents();
    const treasurerOption = options.find((o) => /^Treasurer\b/.test(o.trim()));
    expect(treasurerOption, `the Role list offers the Treasurer role (saw: ${options.join(" | ")})`).toBeDefined();
    await roleSelect.selectOption({ label: treasurerOption! });
    await page.getByLabel("Person", { exact: true }).selectOption({ label: NAMES.secondPayer });
    await page.getByTestId("team-grant-submit").click();
    await expect(page.getByText("Role given.").first()).toBeVisible();
    const second = page.getByTestId("team-row").filter({ hasText: NAMES.secondPayer });
    await expect(second).toContainText("Treasurer");
    await expect(second.getByTestId("team-keys").getByText("Record payments")).toBeVisible();
    const wrenRoles = await rows<{ key: string }>(sql`
      select r.key from role_grants rg join app_roles r on r.id = rg.role_id
       where rg.organization_id = ${org.orgId}::uuid and rg.person_id = ${who.wrenPerson}::uuid and rg.ends_on is null`);
    expect(wrenRoles.map((r) => r.key)).toEqual(["treasurer"]);
    await shot(page, "team-given");
    await page.close();
  });

  test("approve as treasurer: with a second person who can pay, the request waits for THEM (the approver cannot also pay)", async () => {
    const page = await treasurerPage();
    await page.goto(`${admin()}/${ids.override}`);
    await waitHydrated(page);
    await page.getByTestId("override-open").click();
    await page.getByRole("alertdialog").getByTestId("override-confirm").click();
    await expect(page.getByText("Approved.").first()).toBeVisible();
    expect(await statusOf(sql, ids.override)).toBe("approved");
    await expect(page.getByTestId("approved-by")).toContainText("as treasurer");
    await expect(page.getByTestId("payment-block")).toHaveText("A different person must record this payment.");
    await expect(page.getByTestId("payment-form")).toHaveCount(0);
    await page.close();
  });

  test("the second member signs in through the real form and the real challenge and records the payment on the request the first treasurer approved", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const path = `${admin()}/${ids.override}`;
    await page.goto(path);
    await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);
    await signInOnPage(page, SECOND_PAYER_EMAIL, SECOND_PAYER_PASSWORD);
    // The Treasurer role carries money keys, so 2FA is required of them the moment they hold it (arm B).
    await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);
    await submitTotp(page, E2E_TOTP_TEST_SECRET);
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
    await waitHydrated(page);

    await expect(page.getByRole("heading", { level: 1, name: "$75.00" })).toBeVisible();
    await expect(page.getByTestId("approved-by")).toContainText("as treasurer");
    // Not the approver, so the way to payment is open to them: the request has no receipt, so they waive it first (a pay
    // verb the approver is not barred from), and then the form is offered.
    await expect(page.getByTestId("payment-block")).toHaveText("Add a receipt or waive it before paying.");
    await page.getByTestId("waive-open").click();
    await page.getByRole("dialog").getByTestId("waive-confirm").click();
    await expect(page.getByText("Receipt waived.").first()).toBeVisible();
    const form = page.getByTestId("payment-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Check number").fill("3002");
    await shot(page, "second-payer-form");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Payment recorded.").first()).toBeVisible();
    expect(await statusOf(sql, ids.override)).toBe("paid");
    await expect(page.getByTestId("payment-row")).toContainText("Check number 3002");
    await expect(page.getByTestId("payment-row")).toContainText(NAMES.secondPayer);

    // The persisted truth: approved by the first treasurer, paid by the second, neither self-paid.
    const [done] = await rows<{ approved_by_user: string; approval_path: string; paid_by_user: string; self_paid: boolean }>(sql`
      select r.approved_by_user, r.approval_path, p.paid_by_user, p.self_paid
        from reimbursement_requests r join reimbursement_payments p on p.request_id = r.id and p.kind = 'payment'
       where r.id = ${ids.override}::uuid`);
    expect(done).toMatchObject({ approved_by_user: who.treasurerUser, approval_path: "override", paid_by_user: who.wrenUser, self_paid: false });
    await context.close();
  });

  test("the role bundle outlives the second grant: the treasurer still holds one role, and the org's grants are exactly the two Treasurer grants", async () => {
    const grants = await rows<{ person_id: string; key: string }>(sql`
      select rg.person_id, r.key from role_grants rg join app_roles r on r.id = rg.role_id
       where rg.organization_id = ${org.orgId}::uuid and rg.ends_on is null order by r.key, rg.person_id`);
    expect(grants.map((g) => g.key)).toEqual(["treasurer", "treasurer"]);
    expect(new Set(grants.map((g) => g.person_id))).toEqual(new Set([who.treasurerPerson, who.wrenPerson]));
  });
});
