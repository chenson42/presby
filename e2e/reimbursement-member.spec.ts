/**
 * reimbursement-member.spec.ts - the MEMBER side of reimbursements against a
 * running server (Treasury Increment 1, Batch 5; docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 "New e2e specs" 1 and 2, Copy C2, C3, C5, C6).
 *
 * This is the member-UI slice of the two specs the design names
 * `reimbursement-member` and `reimbursement-approval`. What waits for other
 * batches is named where it would go: the receipt (Batch 2b: F289's adapter),
 * printing the form (Batch 7), the MFA-enrolled treasurer deep link (Batch 7).
 *
 * Everything lives in a THROWAWAY congregation (`e2e-reimb-<stamp>`) removed in
 * afterAll by deleting that organization (the cascade takes every reimbursement
 * row; the six tables refuse a delete while their organization exists, which is
 * why this fixture, like giving's, owns its own organization). Invented names,
 * `.invalid` addresses, no real data.
 *
 * Cast (all signed in through cached storage states, no 2FA: none of them holds
 * a money key, and approval is a SEAT, not a key):
 *   - Tamsin (the `member` fixture user): the requester.
 *   - Cassius (the `presbytery-nogrant` user): chair of the Property Committee,
 *     so the eligible approver. Never holds a key.
 *   - Rosalind (the `org-unmanaged` user): a member who is neither the requester
 *     nor an approver - the stranger who must get the same 404 as a missing id.
 *   - Marisol: a member with no account, the payee of an on-behalf request.
 *
 * The fixture helpers are inline (the Rule 16 `e2e/support/reimbursement-fixture`
 * is Batch 7's); the id ranges are the design's (P3-24).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { E2E_USERS, storageStatePath } from "./support/users";
import { signInOnPage } from "./support/invitation-ui";
import { extractPdfText } from "../src/lib/testing/pdf-text";

const TOGGLE = "org_portal.reimbursement";
const P = "e2e96000-0000-4000-8000-";
const pid = (n: number) => `${P}${String(n).padStart(12, "0")}`;

interface Fixture {
  orgId: string;
  slug: string;
  name: string;
  groupProperty: string;
  groupWorship: string;
  categorySupplies: string;
  requesterPerson: string;
  requesterUser: string;
  chairPerson: string;
  chairUser: string;
  bystanderPerson: string;
  payeePerson: string;
  clerkRole: string;
}

const NAMES = {
  org: "E2E Reimbursement Fixture Church",
  property: "Property Committee",
  worship: "Worship Committee",
  supplies: "Supplies",
  hospitality: "Hospitality",
  requester: "Tamsin Brightwater",
  payee: "Marisol Quillfeather",
} as const;

let sql: Sql;
let fx: Fixture;

const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

async function userIdByEmail(email: string): Promise<string> {
  const found = await rows<{ id: string }>(sql`select id from users where email = ${email}`);
  if (!found[0]) throw new Error(`[reimbursement-member] no user row for ${email}; globalSetup must run first`);
  return found[0].id;
}

async function personIdForUser(userId: string): Promise<string> {
  const found = await rows<{ id: string }>(sql`select id from people where user_id = ${userId}::uuid`);
  if (!found[0]) throw new Error("[reimbursement-member] the seeded fixture user has no person row");
  return found[0].id;
}

/** A membership for a person who may already belong elsewhere: the claim marker is armed in the same statement. */
async function addMembership(orgId: string, personId: string, engagement: "regular" | "visitor", roll: "active" | null) {
  await withDbRetry("add membership", () => sql`
    with armed as (select set_config('app.person_claim_authorized', ${personId}, true))
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    select ${orgId}::uuid, ${personId}::uuid, ${engagement}, ${roll} from armed
    on conflict (person_id, organization_id) do update
      set engagement_status = excluded.engagement_status, current_roll = excluded.current_roll`);
}

async function removeStale() {
  const stale = await rows<{ id: string }>(sql`select id from organizations where slug ~ '^e2e-reimb-[0-9]+$'`);
  for (const { id } of stale) await removeOrg(id);
  await withDbRetry("delete fixture people", () => sql`delete from people where id in (${pid(2)}::uuid, ${pid(4)}::uuid)`);
}

async function removeOrg(orgId: string) {
  try {
    await withDbRetry(`delete reimbursement org ${orgId}`, async () => {
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organizations where id = ${orgId}::uuid`;
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    });
  } finally {
    await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
  }
}

async function setupFixture(stamp = Date.now()): Promise<Fixture> {
  const slug = `e2e-reimb-${stamp}`;
  const orgId = `e2e96001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  await removeStale();

  const requesterUser = await userIdByEmail(E2E_USERS.member.email);
  const chairUser = await userIdByEmail(E2E_USERS["presbytery-nogrant"].email);
  const bystanderUser = await userIdByEmail(E2E_USERS["org-unmanaged"].email);
  const requesterPerson = pid(2);
  const payeePerson = pid(4);
  const chairPerson = await personIdForUser(chairUser);
  const bystanderPerson = await personIdForUser(bystanderUser);
  const groupProperty = pid(10);
  const groupWorship = pid(11);
  const categorySupplies = pid(20);
  const clerkRole = pid(30);

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  await sql`
    insert into groups (id, organization_id, group_type_id, name, membership_source)
    values (${groupProperty}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), ${NAMES.property}, 'managed'),
           (${groupWorship}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), ${NAMES.worship}, 'managed')`;

  await sql`
    insert into people (id, user_id, first_name, last_name, deletable_until)
    values (${requesterPerson}::uuid, ${requesterUser}::uuid, 'Tamsin', 'Brightwater', now() + interval '3 hours'),
           (${payeePerson}::uuid, null, 'Marisol', 'Quillfeather', now() + interval '3 hours')`;
  await addMembership(orgId, requesterPerson, "regular", "active");
  await addMembership(orgId, payeePerson, "regular", "active");
  await addMembership(orgId, chairPerson, "regular", "active");
  await addMembership(orgId, bystanderPerson, "regular", "active");

  // Cassius chairs the Property Committee; the Worship Committee has no chair or leader (its requests have no approver).
  await sql`
    insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
    values (${orgId}::uuid, ${groupProperty}::uuid, ${chairPerson}::uuid, 'chair', 'managed', date '2020-01-01')`;
  await sql`
    insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
    values (${orgId}::uuid, ${groupProperty}::uuid, ${chairUser}::uuid), (${orgId}::uuid, ${groupWorship}::uuid, ${chairUser}::uuid)`;
  await sql`
    insert into reimbursement_categories (id, organization_id, name, created_by_user)
    values (${categorySupplies}::uuid, ${orgId}::uuid, ${NAMES.supplies}, ${chairUser}::uuid),
           (${pid(21)}::uuid, ${orgId}::uuid, ${NAMES.hospitality}, ${chairUser}::uuid)`;

  // A role carrying request_for_others (no 2FA) and directory.view, granted to the requester when a test needs "Pay someone else back".
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${clerkRole}::uuid, ${orgId}::uuid, 'e2e_reimbursement_clerk', 'E2E Reimbursement Clerk', 'custom', false)`;
  // Plus directory.view: the beneficiary search reads the directory as the actor (a fixture organization has no
  // baseline member role, which is what carries it in a real congregation).
  await sql`
    insert into app_role_permissions (role_id, permission_key)
    values (${clerkRole}::uuid, 'reimbursement.request_for_others'), (${clerkRole}::uuid, 'directory.view')`;

  await setToggle(orgId, true);
  return {
    orgId, slug, name: NAMES.org, groupProperty, groupWorship, categorySupplies,
    requesterPerson, requesterUser, chairPerson, chairUser, bystanderPerson, payeePerson, clerkRole,
  };
}

async function setToggle(orgId: string, enabled: boolean | null) {
  if (enabled === null) {
    await withDbRetry("clear toggle", () => sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${TOGGLE}`);
    return;
  }
  await withDbRetry("set toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${TOGGLE}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
}

async function setRequesterEngagement(engagement: "regular" | "visitor", roll: "active" | null) {
  await addMembership(fx.orgId, fx.requesterPerson, engagement, roll);
}

async function grantClerk(on: boolean) {
  await withDbRetry("clerk grant", async () => {
    await sql`delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.requesterPerson}::uuid`;
    if (on) {
      await sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
        values (${fx.orgId}::uuid, ${fx.clerkRole}::uuid, ${fx.requesterPerson}::uuid, date '2020-01-01', ${fx.chairUser}::uuid)`;
    }
  });
}

interface RequestRow {
  id: string;
  status: string;
  revision: number;
  amount_cents: number;
  purpose: string;
  kind: string;
  beneficiary_person_id: string | null;
  vendor_name: string | null;
  no_receipt_claimed: boolean;
  approval_path: string | null;
  group_id: string;
  category_id: string | null;
}

const requests = () =>
  rows<RequestRow>(sql`select id, status, revision, amount_cents, purpose, kind, beneficiary_person_id, vendor_name,
                              no_receipt_claimed, approval_path, group_id, category_id
                         from reimbursement_requests where organization_id = ${fx.orgId}::uuid order by created_at`);

const eventCount = async (requestId: string) =>
  Number((await rows<{ n: number }>(sql`select count(*)::int as n from reimbursement_events where request_id = ${requestId}::uuid`))[0]!.n);

const base = () => `/o/${fx.slug}/reimbursements`;

async function contextFor(browser: Browser, role: "member" | "presbytery-nogrant" | "org-unmanaged", width = 1280, height = 900) {
  return browser.newContext({ storageState: storageStatePath(role), viewport: { width, height } });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

/** Fills the form's required fields for the Property Committee and ticks "I can't attach a receipt" (receipts are Batch 2b). */
async function fillRequest(page: Page, opts: { amount?: string; purpose?: string; date?: string; group?: string; category?: string } = {}) {
  await page.getByLabel("Charge to").selectOption({ label: opts.group ?? NAMES.property });
  await page.getByLabel("Category").selectOption({ label: opts.category ?? NAMES.supplies });
  await page.getByLabel("Amount").fill(opts.amount ?? "4250");
  await page.getByLabel("Date of the expense").fill(opts.date ?? (await orgToday()));
  await page.getByLabel("What was it for?").fill(opts.purpose ?? "Folding tables for the fellowship hall");
  await page.getByLabel("I can't attach a receipt").check();
}

async function orgToday(): Promise<string> {
  return (await rows<{ d: string }>(sql`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`))[0]!.d;
}

async function waitHydrated(page: Page) {
  await expect(page.locator('fieldset[data-slot="hydration-gate"]').first()).not.toHaveAttribute("aria-busy", "true");
}

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements, member side", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    sql = platformSql("reimbursement-member.spec");
    fx = await setupFixture();
  });

  test.afterAll(async () => {
    if (!fx) return; // setup failed before the fixture existed; the next run's sweep clears any leftover
    await removeOrg(fx.orgId);
    await withDbRetry("delete fixture people", () => sql`delete from people where id in (${pid(2)}::uuid, ${pid(4)}::uuid)`);
  });

  // -------------------------------------------------------------------------
  test("the page for a member with no requests: heading, lead, New request, the empty sentence", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursements" })).toBeVisible();
    await expect(page.getByText(`Ask ${NAMES.org} to pay you back for something you bought for the church, or to pay a vendor.`)).toBeVisible();
    await expect(page.getByRole("link", { name: "New request" })).toBeVisible();
    await expect(page.getByText("You haven't made a request yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Treasurer view" })).toHaveCount(0);
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/list-empty.png", fullPage: true });
    await ctx.close();
  });

  // -------------------------------------------------------------------------
  test("a blank Send names every missing field next to it and creates nothing", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await page.screenshot({ path: "test-results/reimbursement-360/form-blank.png", fullPage: true });
    await page.getByTestId("request-send").click();
    await expect(page.getByText("Choose a group to charge this to.")).toBeVisible();
    await expect(page.getByText("Choose a category.")).toBeVisible();
    await expect(page.getByText("Enter an amount between $0.01 and $100,000.00.")).toBeVisible();
    await expect(page.getByText("Choose a date that isn't in the future or more than a year ago.")).toBeVisible();
    await expect(page.getByText("Tell us what this was for.")).toBeVisible();
    await expect(page.getByText("Add a receipt, or tick “I can't attach a receipt”.")).toBeVisible();
    expect(await requests()).toHaveLength(0);
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/form-errors.png", fullPage: true });
    // The one receipt control that exists until Batch 2b is the box; the picker is not offered.
    await expect(page.getByRole("button", { name: "Add a receipt or invoice" })).toHaveCount(0);
    await ctx.close();
  });

  test("the amount control is digit entry: typing reads as dollars and cents, a bad paste is refused", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    const amount = page.getByLabel("Amount");
    await amount.pressSequentially("1250");
    await expect(amount).toHaveValue("$12.50");
    await amount.press("Backspace");
    await expect(amount).toHaveValue("$1.25");
    await amount.fill("");
    await expect(amount).toHaveValue("");
    // A pasted "12.345" would need rounding: refused, field unchanged, the amount message shown.
    await amount.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text", "12.345");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(amount).toHaveValue("");
    await expect(page.getByText("Enter an amount between $0.01 and $100,000.00.")).toBeVisible();
    await amount.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text", "$1,234.5");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(amount).toHaveValue("$1,234.50");
    await ctx.close();
  });

  test("a save that fails keeps everything that was entered, says so, and a retry then succeeds", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await fillRequest(page, { amount: "777", purpose: "Candles for Advent" });
    // The network drops the server action: nothing reaches the server.
    await page.route(/\/reimbursements\/new$/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByTestId("request-send").click();
    await expect(page.getByTestId("request-form-banner")).toHaveText("We couldn't save that. Your entries are still here. Try again.");
    await expect(page.getByLabel("Amount")).toHaveValue("$7.77");
    await expect(page.getByLabel("What was it for?")).toHaveValue("Candles for Advent");
    await expect(page.getByLabel("Charge to")).toHaveValue(fx.groupProperty);
    await expect(page.getByLabel("I can't attach a receipt")).toBeChecked();
    expect(await requests()).toHaveLength(0);
    await page.unroute(/\/reimbursements\/new$/);
    await page.getByTestId("request-save-draft").click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
    await expect(page).toHaveURL(/\/reimbursements\/[0-9a-f-]{36}\/edit$/);
    const all = await requests();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "draft", amount_cents: 777, purpose: "Candles for Advent" });
    // Reload: the draft is what comes back, and it can be edited and saved again (one request, revision up).
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByLabel("What was it for?")).toHaveValue("Candles for Advent");
    await page.getByLabel("What was it for?").fill("Candles and a wreath for Advent");
    await page.getByTestId("request-save-draft").click();
    await expect(page.getByText("Draft saved.").first()).toBeVisible();
    await expect.poll(async () => (await requests())[0]!.purpose).toBe("Candles and a wreath for Advent");
    expect(await requests()).toHaveLength(1);
    await ctx.close();
  });

  test("a request is filed at 360 px, a double tap on Send makes ONE request, and the group is named", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await fillRequest(page);
    await expect(page.getByLabel("Amount")).toHaveValue("$42.50");
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/form-filled.png", fullPage: true });
    const before = (await requests()).length;
    await page.getByTestId("request-send").dblclick();
    await expect(page.getByText(`Sent to ${NAMES.property} for approval.`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${base()}/[0-9a-f-]{36}$`));
    await expect(page.getByTestId("request-banner")).toHaveText("Waiting for approval.");
    const all = await requests();
    // The earlier draft ("Candles") is still a draft; this Send made exactly one more request.
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)).toMatchObject({ status: "submitted", amount_cents: 4250, kind: "reimburse", no_receipt_claimed: true });
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/detail-requester.png", fullPage: true });
    // The requester sees the amount, the facts and the history in Copy's words, and offers to withdraw, not to decide.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("$42.50");
    await expect(page.getByTestId("status-badge")).toHaveText("Waiting for approval");
    await expect(page.getByText("Folding tables for the fellowship hall")).toBeVisible();
    await expect(page.getByTestId("request-history")).toContainText("Sent for approval");
    await expect(page.getByTestId("approve-open")).toHaveCount(0);
    await expect(page.getByTestId("withdraw-open")).toBeVisible();
    await expect(page.getByTestId("flag-duplicate-receipt")).toHaveCount(0);
    await ctx.close();
  });

  test("the list shows the member's requests as cards with their status, and no sideways scroll at 360 px", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 2, name: "Your requests" })).toBeVisible();
    const rowsOnPage = page.getByTestId("request-row");
    await expect(rowsOnPage).toHaveCount(2);
    await expect(rowsOnPage.filter({ hasText: "Folding tables" })).toContainText("Waiting for approval");
    await expect(rowsOnPage.filter({ hasText: "Candles" })).toContainText("Draft");
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/list-rows.png", fullPage: true });
    await ctx.close();
  });

  test("the chair sees the request waiting, reads it, and approves it through a dialog that states the amount", async ({ browser }) => {
    const ctx = await contextFor(browser, "presbytery-nogrant", 360, 740);
    const page = await ctx.newPage();
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 2, name: "Waiting for your approval (1)" })).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/list-approver.png", fullPage: true });
    await page.getByTestId("waiting-row").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/[0-9a-f-]{36}$`));
    await waitHydrated(page).catch(() => undefined);

    // Approve and Send back are reachable without scrolling sideways, each at least 44 px tall.
    for (const testId of ["approve-open", "send-back-open"]) {
      const button = page.getByTestId(testId);
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/detail-approver.png", fullPage: true });
    await expect(page.getByTestId("request-banner")).toHaveText("Waiting for approval.");
    // The approver does not get the requester-only wording or the requester's actions.
    await expect(page.getByTestId("withdraw-open")).toHaveCount(0);

    await page.getByTestId("approve-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Approve this request?")).toBeVisible();
    await expect(dialog).toContainText(`$42.50 to ${NAMES.requester}, charged to ${NAMES.property}. Once approved it goes to the treasurer for payment.`);
    await page.screenshot({ path: "test-results/reimbursement-360/dialog-approve.png" });
    await dialog.getByTestId("approve-confirm").click();
    await expect(page.getByText("Approved.").first()).toBeVisible();
    await expect(page.getByTestId("request-banner")).toContainText("Waiting for payment.");
    await expect(page.getByTestId("approve-open")).toHaveCount(0);
    const approved = (await requests()).find((r) => r.status === "approved");
    expect(approved).toMatchObject({ approval_path: "seat", amount_cents: 4250 });
    await ctx.close();
  });

  test("Send back needs a reason, goes to the requester in their words, and they edit and send again", async ({ browser }) => {
    // A second request to send back.
    const mine = await contextFor(browser, "member", 360, 740);
    const requester = await mine.newPage();
    await requester.goto(`${base()}/new`);
    await waitHydrated(requester);
    await fillRequest(requester, { amount: "1999", purpose: "Hymnal repair kit", category: NAMES.hospitality });
    await requester.getByTestId("request-send").click();
    await expect(requester).toHaveURL(new RegExp(`${base()}/[0-9a-f-]{36}$`));
    const requestId = requester.url().split("/").at(-1)!;

    const theirs = await contextFor(browser, "presbytery-nogrant", 360, 740);
    const chair = await theirs.newPage();
    await chair.goto(`${base()}/${requestId}`);
    await chair.getByTestId("send-back-open").click();
    const dialog = chair.getByRole("dialog");
    await expect(dialog.getByText("Send this request back?")).toBeVisible();
    await expect(dialog.getByText("The requester can fix it and send it again.")).toBeVisible();
    await expect(dialog.getByText("The request ends here unless the requester withdraws it.")).toBeVisible();
    await chair.screenshot({ path: "test-results/reimbursement-360/dialog-send-back.png" });
    await dialog.getByTestId("send-back-confirm").click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByLabel("Reason (the requester will see this)").fill("Please use the hospitality category and add the date.");
    await dialog.getByTestId("send-back-confirm").click();
    await expect(chair.getByText("Sent back.").first()).toBeVisible();
    await expect(chair.getByTestId("request-banner")).toHaveText("Sent back. Reason: Please use the hospitality category and add the date.");
    await expect(chair.getByTestId("status-badge")).toHaveText("Sent back");
    expect((await requests()).find((r) => r.id === requestId)?.status).toBe("returned");

    // The requester: "Sent back to you", the reason, and a way to fix it.
    await requester.reload();
    await expect(requester.getByTestId("request-banner")).toHaveText("Sent back to you. Reason: Please use the hospitality category and add the date.");
    await expect(requester.getByTestId("status-badge")).toHaveText("Sent back to you");
    await requester.getByRole("link", { name: "Edit and send again" }).click();
    await expect(requester).toHaveURL(new RegExp(`${base()}/${requestId}/edit$`));
    await waitHydrated(requester);
    // Kind, group and payee are frozen once sent: shown as text, no controls.
    await expect(requester.getByTestId("request-form-frozen")).toContainText(NAMES.property);
    await expect(requester.getByLabel("Charge to")).toHaveCount(0);
    await expect(requester.getByLabel("Category")).toHaveValue(/.+/);
    await requester.getByLabel("What was it for?").fill("Hymnal repair kit and binding tape");
    await requester.getByTestId("request-send").click();
    await expect(requester).toHaveURL(new RegExp(`${base()}/${requestId}$`));
    await expect(requester.getByTestId("request-banner")).toHaveText("Waiting for approval.");
    await expect(requester.getByTestId("request-history")).toContainText("Sent again");
    expect((await requests()).find((r) => r.id === requestId)).toMatchObject({ status: "submitted", purpose: "Hymnal repair kit and binding tape" });
    await mine.close();
    await theirs.close();
  });

  test("an approver whose page went stale is told the request changed; one who is late is told when it was decided", async ({ browser }) => {
    const mine = await contextFor(browser, "member");
    const requester = await mine.newPage();
    const theirs = await contextFor(browser, "presbytery-nogrant");
    const staleTab = await theirs.newPage();
    const liveTab = await theirs.newPage();

    // The request this test works on is the one still waiting (the "Hymnal" one, resent).
    const waiting = (await requests()).find((r) => r.status === "submitted" && r.purpose.startsWith("Hymnal"))!;
    await staleTab.goto(`${base()}/${waiting.id}`);
    await expect(staleTab.getByTestId("approve-open")).toBeVisible();

    // Meanwhile it is sent back, edited and sent again: a new revision.
    await liveTab.goto(`${base()}/${waiting.id}`);
    await liveTab.getByTestId("send-back-open").click();
    await liveTab.getByLabel("Reason (the requester will see this)").fill("Add the vendor name.");
    await liveTab.getByTestId("send-back-confirm").click();
    await expect(liveTab.getByText("Sent back.").first()).toBeVisible();
    await requester.goto(`${base()}/${waiting.id}/edit`);
    await waitHydrated(requester);
    await requester.getByLabel("What was it for?").fill("Hymnal repair kit, binding tape and glue");
    await requester.getByTestId("request-send").click();
    await expect(requester).toHaveURL(new RegExp(`${base()}/${waiting.id}$`));

    // The stale tab still says Approve; pressing it answers with the Copy sentence and re-reads the page.
    await staleTab.getByTestId("approve-open").click();
    await staleTab.getByTestId("approve-confirm").click();
    await expect(staleTab.getByText("This request changed after you opened it. Review it again.")).toBeVisible();
    await expect(staleTab.getByText("Hymnal repair kit, binding tape and glue")).toBeVisible();
    expect((await requests()).find((r) => r.id === waiting.id)?.status).toBe("submitted");

    // Approve it for real in one tab; the other tab (opened before) is told it is already approved, with the date.
    await liveTab.goto(`${base()}/${waiting.id}`);
    await staleTab.goto(`${base()}/${waiting.id}`);
    await liveTab.getByTestId("approve-open").click();
    await liveTab.getByTestId("approve-confirm").click();
    await expect(liveTab.getByTestId("request-banner")).toContainText("Waiting for payment.");
    await staleTab.getByTestId("approve-open").click();
    await staleTab.getByTestId("approve-confirm").click();
    await expect(staleTab.getByText(/This was already approved on [A-Z][a-z]+ \d{1,2}, \d{4}\./)).toBeVisible();
    await mine.close();
    await theirs.close();
  });

  test("a request that is not yours to see is the same 404 as one that does not exist", async ({ browser }) => {
    const all = await requests();
    const someone = all[0]!;
    const ctx = await contextFor(browser, "org-unmanaged");
    const page = await ctx.newPage();
    const forbidden = await page.goto(`${base()}/${someone.id}`);
    expect(forbidden!.status()).toBe(404);
    const forbiddenBody = await page.getByTestId("request-unavailable").innerText();
    expect(forbiddenBody).toContain("This request isn't available.");
    const missing = await page.goto(`${base()}/11111111-1111-4111-8111-111111111111`);
    expect(missing!.status()).toBe(404);
    expect(await page.getByTestId("request-unavailable").innerText()).toBe(forbiddenBody);
    const malformed = await page.goto(`${base()}/not-a-uuid`);
    expect(malformed!.status()).toBe(404);
    expect(await page.getByTestId("request-unavailable").innerText()).toBe(forbiddenBody);
    // The edit page of someone else's request answers the same way.
    const edit = await page.goto(`${base()}/${someone.id}/edit`);
    expect(edit!.status()).toBe(404);
    expect(await page.getByTestId("request-unavailable").innerText()).toBe(forbiddenBody);
    await ctx.close();
  });

  test("opening a request twice as an approver changes nothing (no GET mutates)", async ({ browser }) => {
    const target = (await requests()).find((r) => r.status === "approved")!;
    const before = await eventCount(target.id);
    const ctx = await contextFor(browser, "presbytery-nogrant");
    const page = await ctx.newPage();
    await page.goto(`${base()}/${target.id}`);
    await page.reload();
    await page.goto(base());
    const after = (await requests()).find((r) => r.id === target.id)!;
    expect(await eventCount(target.id)).toBe(before);
    expect(after.status).toBe("approved");
    expect(after.revision).toBe(target.revision);
    await ctx.close();
  });

  test("the requester withdraws a request through a dialog, and it is closed, not deleted", async ({ browser }) => {
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await fillRequest(page, { amount: "500", purpose: "Postage for the newsletter", group: NAMES.worship, category: NAMES.hospitality });
    await page.getByTestId("request-send").click();
    // The Worship Committee has no chair or leader, and no one holds the payment key yet: the honest words.
    await expect(page.getByText(`No one in ${NAMES.worship} is able to approve this, and no one can record payments yet. It's saved and waiting. Let your church office know.`)).toBeVisible();
    await expect(page.getByTestId("request-banner")).toHaveText("Waiting for approval. No one is able to approve it yet, so let the church office know.");
    const id = page.url().split("/").at(-1)!;
    await page.getByTestId("withdraw-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Withdraw this request?")).toBeVisible();
    await expect(dialog.getByText("It will be closed. You can start a new one any time.")).toBeVisible();
    await dialog.getByRole("button", { name: "Keep it" }).click();
    expect((await requests()).find((r) => r.id === id)?.status).toBe("submitted");
    await page.getByTestId("withdraw-open").click();
    await page.getByRole("alertdialog").getByTestId("withdraw-confirm").click();
    await expect(page.getByText("Request withdrawn.")).toBeVisible();
    await expect(page.getByTestId("request-banner")).toHaveText("This request was withdrawn.");
    expect((await requests()).find((r) => r.id === id)?.status).toBe("withdrawn");
    await expect(page.getByTestId("withdraw-open")).toHaveCount(0);
    await ctx.close();
  });

  test("prints the form: Print the form downloads a PDF of the request as the requester sees it, an approver may print it too, anyone else gets the one 404, and a GET writes nothing", async ({ browser }) => {
    const target = (await requests()).find((r) => r.kind === "reimburse" && r.status !== "draft" && r.status !== "withdrawn")!;
    const printPath = `${base()}/${target.id}/print`;
    const before = await eventCount(target.id);

    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/${target.id}`);
    const button = page.getByTestId("request-print");
    await expect(button).toHaveText("Print the form");
    await expect(button).toHaveAttribute("href", printPath);
    const box = (await button.boundingBox())!;
    expect(box.height, "a phone thumb target").toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, "inside the viewport").toBeLessThanOrEqual(360);
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/detail-print-button.png", fullPage: true });

    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(download.suggestedFilename()).toBe(`reimbursement-request-${target.id.slice(0, 8)}.pdf`);
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = extractPdfText(bytes).replace(/\s+/g, " ");
    for (const expected of ["Reimbursement request", NAMES.org, "Charged to", NAMES.property, "What it was for", target.purpose, "Printed from PresbyPortal."]) {
      expect(text, expected).toContain(expected);
    }
    // The requester's sheet: no history, no payment, no approver names.
    expect(text).not.toContain("History");
    expect(text).not.toContain("Check number");

    // The headers, read from the route itself (the signed-in member's cookies).
    const res = await ctx.request.get(printPath);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toBe(`attachment; filename="reimbursement-request-${target.id.slice(0, 8)}.pdf"`);
    expect(res.headers()["cache-control"]).toBe("private, no-store");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    await ctx.close();

    // An approver of the group may print it (any viewer of the request); a member who is not a seat holder gets the one 404.
    const chair = await contextFor(browser, "presbytery-nogrant");
    expect((await chair.request.get(printPath)).status()).toBe(target.group_id === fx.groupProperty ? 200 : 404);
    await chair.close();
    const bystander = await contextFor(browser, "org-unmanaged");
    const hidden = await bystander.request.get(printPath);
    expect(hidden.status()).toBe(404);
    const body = await hidden.text();
    expect(body).toBe("Not found");
    const missing = await bystander.request.get(`${base()}/11111111-1111-4111-8111-111111111111/print`);
    expect([missing.status(), await missing.text()]).toEqual([404, body]);
    const malformed = await bystander.request.get(`${base()}/not-a-uuid/print`);
    expect([malformed.status(), await malformed.text()]).toEqual([404, body]);
    await bystander.close();

    // Signed out: sent to sign in, with the print address as the way back.
    const anonymous = await browser.newContext();
    const redirect = await anonymous.request.get(printPath, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    const location = new URL(redirect.headers()["location"]!, "http://localhost");
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe(printPath);
    await anonymous.close();

    // A GET writes nothing: the same events, the same status.
    expect(await eventCount(target.id)).toBe(before);
    expect((await requests()).find((r) => r.id === target.id)!.status).toBe(target.status);
  });

  test("a vendor request, and a request for someone else through the directory search", async ({ browser }) => {
    await grantClerk(true);
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);

    // Pay a vendor.
    await page.getByRole("radio", { name: "Pay a vendor" }).check();
    await page.getByLabel("Vendor name").fill("Harbor Lumber & Supply");
    await fillRequest(page, { amount: "12000", purpose: "Lumber for the ramp rail" });

    // Pay someone else back: the search, "No match.", a short query shows nothing, a pick, Change.
    await page.getByRole("radio", { name: "Pay someone else back" }).check();
    const search = page.getByLabel("Who are we paying back?");
    await expect(page.getByText("Only people who appear in the directory can be chosen.")).toBeVisible();
    await search.fill("Q");
    await expect(page.getByText("No match.")).toHaveCount(0);
    await search.fill("Zzzzzzzz");
    await expect(page.getByText("No match.")).toBeVisible();
    await search.fill("Quillf");
    await expect(page.getByTestId("beneficiary-results")).toContainText(NAMES.payee);
    await expect(page.getByText("1 person found.")).toBeAttached();
    await page.screenshot({ path: "test-results/reimbursement-360/beneficiary-search.png", fullPage: true });
    await page.getByRole("button", { name: NAMES.payee }).click();
    await expect(page.getByTestId("beneficiary-chosen")).toHaveValue(NAMES.payee);
    await page.getByRole("button", { name: "Change who we are paying back" }).click();
    await expect(page.getByLabel("Who are we paying back?")).toHaveValue("");
    // Enter in the search box does not send the request.
    await page.getByLabel("Who are we paying back?").press("Enter");
    expect(new URL(page.url()).pathname).toBe(`${base()}/new`);
    await page.getByLabel("Who are we paying back?").fill("Quillf");
    await page.getByRole("button", { name: NAMES.payee }).click();
    await page.getByTestId("request-send").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/[0-9a-f-]{36}$`));
    const made = (await requests()).at(-1)!;
    expect(made).toMatchObject({ kind: "reimburse", beneficiary_person_id: fx.payeePerson, vendor_name: null, amount_cents: 12000 });
    await expect(page.getByTestId("request-fields")).toContainText(NAMES.payee);
    await grantClerk(false);
    await ctx.close();

    // The payee has no account here, so the on-behalf note is the approver's and the treasury's.
    const chairCtx = await contextFor(browser, "presbytery-nogrant");
    const chair = await chairCtx.newPage();
    await chair.goto(`${base()}/${made.id}`);
    await expect(chair.getByTestId("flag-entered-on-behalf")).toHaveText("Entered on someone's behalf.");
    await chairCtx.close();
  });

  test("a member who may not file is told so, still sees the page, and the form is not offered", async ({ browser }) => {
    await setRequesterEngagement("visitor", null);
    try {
      const ctx = await contextFor(browser, "member", 360, 740);
      const page = await ctx.newPage();
      await page.goto(base());
      const sentence = `Requests can be started by members, regular attenders and staff of ${NAMES.org}. If you think you should be able to, tell the church office.`;
      await expect(page.getByTestId("cannot-file")).toHaveText(sentence);
      await expect(page.getByRole("link", { name: "New request" })).toHaveCount(0);
      await expect(page.getByTestId("request-row").first()).toBeVisible(); // the list still renders
      const form = await page.goto(`${base()}/new`);
      expect(form!.status()).toBe(200);
      await expect(page.getByTestId("cannot-file")).toHaveText(sentence);
      await expect(page.getByTestId("request-form")).toHaveCount(0);
      await ctx.close();
    } finally {
      await setRequesterEngagement("regular", "active");
    }
  });

  test("with the toggle off the pages say so at HTTP 200 and nothing is deleted; back on, everything returns", async ({ browser }) => {
    const before = (await requests()).length;
    await setToggle(fx.orgId, false);
    try {
      const ctx = await contextFor(browser, "member", 360, 740);
      const page = await ctx.newPage();
      for (const path of [base(), `${base()}/new`, `${base()}/${(await requests())[0]!.id}`]) {
        const response = await page.goto(path);
        expect(response!.status()).toBe(200);
        await expect(page.getByText(`Reimbursements aren't turned on for ${NAMES.org}.`)).toBeVisible();
        await expect(page.getByText("Ask an administrator who manages your organization's features to turn it on.")).toBeVisible();
      }
      await page.screenshot({ path: "test-results/reimbursement-360/toggle-off.png", fullPage: true });
      expect((await requests()).length).toBe(before);
      await ctx.close();
    } finally {
      await setToggle(fx.orgId, true);
    }
    const ctx = await contextFor(browser, "member");
    const page = await ctx.newPage();
    await page.goto(base());
    await expect(page.getByTestId("request-row").first()).toBeVisible();
    await ctx.close();
  });

  test("long values wrap: an unbroken 400-character purpose and a long vendor name never scroll the page sideways at 360 px", async ({ browser }) => {
    const long = "x".repeat(400);
    const vendor = "V".repeat(110);
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await page.getByRole("radio", { name: "Pay a vendor" }).check();
    await page.getByLabel("Vendor name").fill(vendor);
    await fillRequest(page, { amount: "100", purpose: long, group: NAMES.worship, category: NAMES.hospitality });
    await noHorizontalScroll(page);
    await page.getByTestId("request-send").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/[0-9a-f-]{36}$`));
    await expect(page.getByText(vendor)).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/detail-long-values.png", fullPage: true });
    await page.goto(base());
    await noHorizontalScroll(page);
    await ctx.close();
  });

  test("every member page at 1280 px: no sideways scroll, screenshots for a human to read", async ({ browser }) => {
    const all = await requests();
    const draft = all.find((r) => r.status === "draft")!;
    const decidable = all.find((r) => r.status === "submitted" && r.group_id === fx.groupProperty)!;
    const mine = await contextFor(browser, "member", 1280, 900);
    const page = await mine.newPage();
    for (const [name, path] of [
      ["list", base()],
      ["new", `${base()}/new`],
      ["edit-draft", `${base()}/${draft.id}/edit`],
      ["detail-requester", `${base()}/${decidable.id}`],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/reimbursement-1280/${name}.png`, fullPage: true });
    }
    await mine.close();
    const theirs = await contextFor(browser, "presbytery-nogrant", 1280, 900);
    const chair = await theirs.newPage();
    await chair.goto(base());
    await noHorizontalScroll(chair);
    await chair.screenshot({ path: "test-results/reimbursement-1280/list-approver.png", fullPage: true });
    await chair.goto(`${base()}/${decidable.id}`);
    await expect(chair.getByTestId("approve-open")).toBeVisible();
    await noHorizontalScroll(chair);
    await chair.screenshot({ path: "test-results/reimbursement-1280/detail-approver.png", fullPage: true });
    await chair.getByTestId("send-back-open").click();
    await chair.screenshot({ path: "test-results/reimbursement-1280/dialog-send-back.png" });
    await chair.keyboard.press("Escape");
    await chair.getByTestId("approve-open").click();
    await chair.screenshot({ path: "test-results/reimbursement-1280/dialog-approve.png" });
    await theirs.close();
  });

  test("a signed-out approver who follows the emailed link signs in and lands on the request", async ({ browser }) => {
    const target = (await requests()).find((r) => r.status === "submitted")!;
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await page.goto(`${base()}/${target.id}`);
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("callbackUrl")!)).toBe(`${base()}/${target.id}`);
    await signInOnPage(page, E2E_USERS["presbytery-nogrant"].email, E2E_USERS["presbytery-nogrant"].password);
    await page.waitForURL((url) => url.pathname === `${base()}/${target.id}`, { timeout: 20_000 });
    await expect(page.getByTestId("approve-open")).toBeVisible();
    await ctx.close();
  });
});

