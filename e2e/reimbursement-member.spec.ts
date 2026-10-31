/**
 * reimbursement-member.spec.ts - the MEMBER side of reimbursements against a
 * running server (Treasury Increment 1, Batch 5; docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 "New e2e specs" 1 and 2, Copy C2, C3, C5, C6).
 *
 * This is the member-UI slice of the two specs the design names
 * `reimbursement-member` and `reimbursement-approval`. Receipts (Batch 2b, on
 * F289's private audience) are the last tests in the file: a synthetic PNG added
 * on a brand-new form at 360 px, refused uploads in words, Remove, the double tap
 * on Send, the download route's headers and who may open it, the printed form with
 * a receipt, and the upload route called directly. Printing the form (Batch 7) and
 * the MFA-enrolled treasurer deep link (Batch 7) are in their own specs.
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
import { attachmentRows, auditRows, jpegSize, minimalPdf, syntheticPng, withExifSegment } from "./support/reimbursement-fixture";

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
  const stale = await rows<{ id: string }>(sql`select id from organizations where slug ~ '^e2e-reimb[a-z]*-[0-9]+$'`);
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

/**
 * Fills the form's required fields for the Property Committee and, unless `claim` is false, ticks
 * "I can't attach a receipt" (the receipt tests add a real one instead).
 */
async function fillRequest(
  page: Page,
  opts: { amount?: string; purpose?: string; date?: string; group?: string; category?: string; claim?: boolean } = {},
) {
  await page.getByLabel("Charge to").selectOption({ label: opts.group ?? NAMES.property });
  await page.getByLabel("Category").selectOption({ label: opts.category ?? NAMES.supplies });
  await page.getByLabel("Amount").fill(opts.amount ?? "4250");
  await page.getByLabel("Date of the expense").fill(opts.date ?? (await orgToday()));
  await page.getByLabel("What was it for?").fill(opts.purpose ?? "Folding tables for the fellowship hall");
  if (opts.claim !== false) await page.getByLabel("I can't attach a receipt").check();
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
    // Both receipt controls are offered: the picker and the box. A blank Send creates nothing, receipts included.
    await expect(page.getByRole("button", { name: "Add a receipt or invoice" })).toBeVisible();
    await expect(page.getByText("Photos and PDFs. Each file can be up to 4 MB, and you can add up to 5.")).toBeVisible();
    await expect(page.getByLabel("I can't attach a receipt")).toBeVisible();
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

  // =========================================================================
  // Receipts (Batch 2b). These run last: each makes its own requests, and the
  // earlier tests count and pick requests by order.
  // =========================================================================

  /** A request the receipt tests built: shared by the tests that follow the one that made it. */
  const made: { requestId?: string; photoAttachment?: string; photoJpeg?: Buffer; pdfAttachment?: string } = {};

  const origin = () => new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
  const receiptsUrl = (requestId: string) => `${base()}/${requestId}/receipts`;
  const pick = (page: Page, name: string, mimeType: string, buffer: Buffer) =>
    page.getByTestId("receipt-input").setInputFiles({ name, mimeType, buffer });

  test("a receipt is added to a brand-new form at 360 px: a synthetic PNG becomes a JPEG, refusals are in words, Remove detaches, and a double tap on Send makes ONE request", async ({ browser }) => {
    const before = (await requests()).length;
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);

    // The picker is a phone-sized button, and the hint states the limits Copy promises.
    const add = page.getByTestId("receipt-add");
    await expect(add).toHaveText("Add a receipt or invoice");
    await expect(page.getByText("Photos and PDFs. Each file can be up to 4 MB, and you can add up to 5.")).toBeVisible();
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The file input offers photos and PDFs and has no `capture`: the phone chooses camera, library or files.
    const input = page.getByTestId("receipt-input");
    await expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp,application/pdf");
    await expect(input).not.toHaveAttribute("capture", /.*/);

    // A receipt belongs to a request, so the form saves a draft first; with no group chosen it says so and sends nothing.
    await pick(page, "Hardware store.png", "image/png", syntheticPng(320, 240));
    await expect(page.getByText("Choose a group to charge this to.")).toBeVisible();
    expect((await requests()).length).toBe(before);
    await expect(page.getByTestId("receipt-row")).toHaveCount(0);

    // Fill everything but the claim box, then add the receipt: a draft is made and the PNG is stored as a JPEG.
    await fillRequest(page, { amount: "6350", purpose: "Hymn board numbers and a ladder", claim: false });
    await pick(page, "Hardware store.png", "image/png", syntheticPng(320, 240));
    await expect(page.getByTestId("receipt-row")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Hardware store.jpg" })).toBeVisible();
    const drafts = (await requests()).filter((r) => r.status === "draft" && r.purpose.startsWith("Hymn board"));
    expect(drafts).toHaveLength(1);
    const requestId = drafts[0]!.id;
    made.requestId = requestId;
    let stored = await attachmentRows(sql, requestId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ display_name: "Hardware store.jpg", content_type: "image/jpeg", audience: "private", detached_at: null });
    expect(stored[0]!.byte_size).toBeGreaterThan(0);
    expect(stored[0]!.byte_size).toBeLessThanOrEqual(4_000_000);
    await noHorizontalScroll(page);
    for (const testId of ["receipt-add", "receipt-remove"]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      expect(box.height, testId).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, testId).toBeLessThanOrEqual(360);
    }
    await page.screenshot({ path: "test-results/reimbursement-360/receipt-added.png", fullPage: true });

    // The upload moved the revision; the next Save carries it (it is not "changed in another window").
    await page.getByLabel("What was it for?").fill("Hymn board numbers, a ladder and bolts");
    await page.getByTestId("request-save-draft").click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
    await expect(page.getByText("This request changed in another window. Reload to see the latest.")).toHaveCount(0);
    await expect.poll(async () => (await requests()).find((r) => r.id === requestId)?.purpose).toBe("Hymn board numbers, a ladder and bolts");
    // A draft that got its receipt first still moves to its own address on that Save, so a reload keeps the receipt.
    await expect(page).toHaveURL(new RegExp(`${base()}/${requestId}/edit$`));
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByRole("link", { name: "Hardware store.jpg" })).toBeVisible();

    // Refusals say so in words, naming the person's own file, and add nothing.
    await pick(page, "notes.png", "image/png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'));
    await expect(page.getByTestId("receipt-error")).toHaveText("notes.png isn't a photo or PDF we can use.");
    await pick(page, "Big bill.pdf", "application/pdf", Buffer.concat([minimalPdf("big"), Buffer.alloc(4_100_000)]));
    await expect(page.getByTestId("receipt-error")).toHaveText("Big bill.pdf is larger than 4 MB. Try a photo of it, or a smaller scan.");
    await expect(page.getByTestId("receipt-row")).toHaveCount(1);
    await page.screenshot({ path: "test-results/reimbursement-360/receipt-refused.png", fullPage: true });

    // A PDF is added as it is; the same one again is "already on this request".
    const pdf = minimalPdf("invoice");
    await pick(page, "Invoice 4471.pdf", "application/pdf", pdf);
    await expect(page.getByTestId("receipt-row")).toHaveCount(2);
    await pick(page, "Invoice 4471 copy.pdf", "application/pdf", pdf);
    await expect(page.getByTestId("receipt-error")).toHaveText("That receipt is already on this request.");
    await expect(page.getByTestId("receipt-row")).toHaveCount(2);
    stored = await attachmentRows(sql, requestId);
    expect(stored.map((r) => r.display_name)).toEqual(["Hardware store.jpg", "Invoice 4471.pdf"]);
    expect(stored[1]).toMatchObject({ content_type: "application/pdf", audience: "private" });
    made.pdfAttachment = stored[1]!.id;

    // Remove detaches (soft): the row and its blob stay, the list shrinks, and the next Save still goes through.
    await page.getByRole("button", { name: "Remove Invoice 4471.pdf" }).click();
    await expect(page.getByTestId("receipt-row")).toHaveCount(1);
    stored = await attachmentRows(sql, requestId);
    expect(stored).toHaveLength(2);
    expect(stored[1]!.detached_at).not.toBeNull();
    await page.getByTestId("request-save-draft").click();
    await expect(page.getByText("Draft saved.").first()).toBeVisible();

    // A big photo (a 2400 x 1600 PNG here) is shrunk in the browser to the long edge Copy implies, and a noisy one that
    // is over the 4 MB limit as a file gets through only because it is re-encoded first.
    await pick(page, "Parish hall wide.png", "image/png", syntheticPng(2400, 1600));
    await expect(page.getByTestId("receipt-row")).toHaveCount(2);
    await pick(page, "Phone photo.png", "image/png", syntheticPng(1200, 1200, { noise: true }));
    await expect(page.getByTestId("receipt-row")).toHaveCount(3);
    stored = (await attachmentRows(sql, requestId)).filter((r) => !r.detached_at);
    expect(stored.map((r) => r.display_name)).toEqual(["Hardware store.jpg", "Parish hall wide.jpg", "Phone photo.jpg"]);
    for (const row of stored) expect(row.byte_size, row.display_name).toBeLessThanOrEqual(4_000_000);
    made.photoAttachment = stored[1]!.id;

    // Send with a double tap: the claim box is not needed, and ONE request goes (the draft is the request).
    await page.getByTestId("request-send").dblclick();
    await expect(page.getByText(`Sent to ${NAMES.property} for approval.`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${base()}/${requestId}$`));
    const all = await requests();
    expect(all.filter((r) => r.purpose.startsWith("Hymn board"))).toHaveLength(1);
    expect(all.find((r) => r.id === requestId)).toMatchObject({ status: "submitted", amount_cents: 6350, no_receipt_claimed: false });
    // The request page links every live receipt, and no longer offers to change them.
    await expect(page.getByTestId("request-receipts").getByRole("link")).toHaveCount(3);
    await expect(page.getByTestId("request-receipts")).not.toContainText("No receipt attached.");
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/detail-with-receipts.png", fullPage: true });
    await ctx.close();
  });

  test("a receipt downloads as an image the browser may not sniff, for the requester and the approver (audited), and anyone else gets the one 404", async ({ browser }) => {
    const requestId = made.requestId!;
    const photo = made.photoAttachment!;
    const url = `${receiptsUrl(requestId)}/${photo}`;

    const mine = await contextFor(browser, "member", 360, 740);
    const res = await mine.request.get(url);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-type"]).toBe("image/jpeg");
    expect(headers["content-disposition"]).toBe(`inline; filename="receipt-${photo.slice(0, 8)}.jpg"`);
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    const bytes = await res.body();
    // the 2400 x 1600 PNG arrived as a JPEG whose long edge is the cap (1800 x 1200)
    expect(jpegSize(bytes)).toEqual({ width: 1800, height: 1200 });
    made.photoJpeg = bytes;
    // the uploader's own view writes nothing
    const viewed = () => auditRows(sql, "tenant.reimbursement.receipt_viewed", fx.orgId);
    expect(await viewed()).toHaveLength(0);

    // The requester opens it in the browser: the image shows under the sandbox CSP (it is a picture, not a download).
    const page = await mine.newPage();
    await page.goto(url);
    await expect(page.locator("img")).toBeVisible();
    expect(await page.evaluate(() => (document.querySelector("img") as HTMLImageElement).naturalWidth)).toBe(1800);
    await page.screenshot({ path: "test-results/reimbursement-360/receipt-opened.png" });
    await mine.close();

    // The chair (an eligible approver) may read it, and that view is audited with ids only.
    const chair = await contextFor(browser, "presbytery-nogrant");
    const seen = await chair.request.get(url);
    expect(seen.status()).toBe(200);
    expect((await seen.body()).equals(bytes)).toBe(true);
    const rows = await viewed();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ organizationId: fx.orgId, requestId, attachmentId: photo });
    expect(rows[0]!.actor_user_id).toBe(fx.chairUser);
    // The approver's page shows the receipts as links; the requester-only claim line is not there.
    const chairPage = await chair.newPage();
    await chairPage.goto(`${base()}/${requestId}`);
    await expect(chairPage.getByTestId("request-receipts").getByRole("link")).toHaveCount(3);
    await expect(chairPage.getByTestId("flag-duplicate-receipt")).toHaveCount(0);
    await chair.close();

    // Anyone else, a missing id, a malformed id and a detached receipt are ONE 404 (same status, body and headers).
    const stranger = await contextFor(browser, "org-unmanaged");
    const hidden = await stranger.request.get(url);
    const body = await hidden.text();
    expect([hidden.status(), body]).toEqual([404, "Not found"]);
    const detached = made.pdfAttachment!;
    const mineAgain = await contextFor(browser, "member");
    const misses = [
      await stranger.request.get(`${receiptsUrl("11111111-1111-4111-8111-111111111111")}/${photo}`),
      await stranger.request.get(`${receiptsUrl(requestId)}/11111111-1111-4111-8111-111111111111`),
      await stranger.request.get(`${receiptsUrl(requestId)}/not-a-uuid`),
      await stranger.request.get(`${receiptsUrl("not-a-uuid")}/${photo}`),
      await mineAgain.request.get(`${receiptsUrl(requestId)}/${detached}`),
      await mineAgain.request.get(`${receiptsUrl(requestId)}/11111111-1111-4111-8111-111111111111`),
    ];
    for (const miss of misses) {
      expect([miss.status(), await miss.text()]).toEqual([404, body]);
      expect(miss.headers()["cache-control"]).toBe("no-store");
    }
    await stranger.close();
    await mineAgain.close();
    // no view by a stranger left a row: still just the chair's
    expect(await viewed()).toHaveLength(1);

    // Signed out: sent to sign in, with the receipt's own address as the way back.
    const anonymous = await browser.newContext();
    const redirect = await anonymous.request.get(url, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    const location = new URL(redirect.headers()["location"]!, "http://localhost");
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe(url);
    await anonymous.close();
  });

  test("the printed form of a request with receipts lists the live ones by name, never the detached one and never the bytes", async ({ browser }) => {
    const requestId = made.requestId!;
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/${requestId}`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("request-print").click()]);
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = extractPdfText(bytes).replace(/\s+/g, " ");
    // the live receipts by name; the detached one is not there; the empty-state sentence is not there either
    for (const name of ["Hardware store.jpg", "Parish hall wide.jpg", "Phone photo.jpg"]) expect(text, name).toContain(name);
    expect(text).not.toContain("Invoice 4471.pdf");
    expect(text).not.toContain("No receipt attached.");
    expect(text).toContain("Hymn board numbers, a ladder and bolts");
    // the bytes themselves are never on the sheet
    expect(bytes.includes(made.photoJpeg!.subarray(0, 64))).toBe(false);
    await ctx.close();
  });

  test("the upload route called directly: Origin is required, EXIF is stripped by the server, the cap and the type are held, and only the creator of an editable request may add", async ({ browser }) => {
    const draft = (await requests()).find((r) => r.status === "draft" && r.purpose.startsWith("Candles"))!;
    const post = (
      ctx: { request: import("@playwright/test").APIRequestContext },
      requestId: string,
      file: { name: string; mimeType: string; buffer: Buffer } | null,
      headers: Record<string, string> = { origin: origin() },
    ) => ctx.request.post(receiptsUrl(requestId), { headers, multipart: file ? { file } : {} });
    const mine = await contextFor(browser, "member");

    // Origin: missing and foreign are refused before anything is read.
    const pdf = minimalPdf("route");
    const refusedOrigins: Array<Record<string, string>> = [{}, { origin: "https://evil.example.invalid" }];
    for (const headers of refusedOrigins) {
      const res = await post(mine, draft.id, { name: "a.pdf", mimeType: "application/pdf", buffer: pdf }, headers);
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ kind: "refused", error: "You don't have permission to do that." });
    }
    expect(await attachmentRows(sql, draft.id)).toHaveLength(0);

    // Signed out: the proxy sends it to sign in before the route runs (the form does not follow that redirect: it goes to the
    // request's own page instead, which keeps the way back). Nothing is stored.
    const anonymous = await browser.newContext();
    const signedOut = await anonymous.request.post(receiptsUrl(draft.id), {
      headers: { origin: origin() },
      multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: pdf } },
      maxRedirects: 0,
    });
    expect(signedOut.status()).toBe(307);
    expect(new URL(signedOut.headers()["location"]!, "http://localhost").pathname).toBe("/signin");
    await anonymous.close();
    expect(await attachmentRows(sql, draft.id)).toHaveLength(0);

    // The server strips EXIF itself: a JPEG carrying a camera name and a copyright line comes back without them.
    const exifJpeg = withExifSegment(made.photoJpeg!, "Invented Camera Co / Alder Creek Fixture");
    expect(exifJpeg.includes("Invented Camera Co")).toBe(true);
    const ok = await post(mine, draft.id, { name: "From a camera.jpg", mimeType: "image/jpeg", buffer: exifJpeg });
    expect(ok.status()).toBe(200);
    const added = (await ok.json()) as Record<string, unknown>;
    expect(added).toMatchObject({ displayName: "From a camera.jpg", contentType: "image/jpeg" });
    expect(Object.keys(added).sort()).toEqual(["attachmentId", "byteSize", "contentType", "displayName", "revision"]);
    expect(typeof added.revision).toBe("number");
    const back = await mine.request.get(`${receiptsUrl(draft.id)}/${added.attachmentId}`);
    const clean = await back.body();
    expect(clean.includes("Invented Camera Co")).toBe(false);
    expect(clean.includes("Alder Creek Fixture")).toBe(false);
    expect(clean.includes("Exif")).toBe(false);
    expect(jpegSize(clean)).toEqual({ width: 1800, height: 1200 });
    expect(clean.equals(exifJpeg)).toBe(false);

    // The wrong thing, named plainly: an SVG called a photo (415), a body over the cap (413), a second file part (400).
    const svg = await post(mine, draft.id, { name: "photo.png", mimeType: "image/png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    expect([svg.status(), await svg.json()]).toEqual([415, { kind: "not_allowed" }]);
    const huge = await post(mine, draft.id, { name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.concat([pdf, Buffer.alloc(4_300_000)]) });
    expect([huge.status(), await huge.json()]).toEqual([413, { kind: "too_large" }]);
    const two = await mine.request.post(receiptsUrl(draft.id), {
      headers: { origin: origin() },
      multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: pdf }, note: "hello" },
    });
    expect([two.status(), await two.json()]).toEqual([400, { kind: "not_allowed" }]);
    expect(await attachmentRows(sql, draft.id)).toHaveLength(1);

    // Another member, a missing id and a malformed id: not found (and nothing is stored for the wrong request).
    const chair = await contextFor(browser, "presbytery-nogrant");
    const theirs = await post(chair, draft.id, { name: "a.pdf", mimeType: "application/pdf", buffer: pdf });
    expect([theirs.status(), await theirs.json()]).toEqual([404, { kind: "not_found" }]);
    const missing = await post(mine, "11111111-1111-4111-8111-111111111111", { name: "a.pdf", mimeType: "application/pdf", buffer: pdf });
    expect([missing.status(), await missing.json()]).toEqual([404, { kind: "not_found" }]);
    const malformed = await post(mine, "not-a-uuid", { name: "a.pdf", mimeType: "application/pdf", buffer: pdf });
    expect(malformed.status()).toBe(404);
    await chair.close();

    // The fifth is the last: four more PDFs fill the five places, and the sixth is "the most allowed".
    for (let i = 1; i <= 4; i += 1) {
      const res = await post(mine, draft.id, { name: `Bill ${i}.pdf`, mimeType: "application/pdf", buffer: minimalPdf(`bill-${i}`) });
      expect(res.status(), `bill ${i}`).toBe(200);
    }
    const sixth = await post(mine, draft.id, { name: "Bill 6.pdf", mimeType: "application/pdf", buffer: minimalPdf("bill-6") });
    expect([sixth.status(), await sixth.json()]).toEqual([409, { kind: "too_many" }]);
    expect((await attachmentRows(sql, draft.id)).filter((r) => !r.detached_at)).toHaveLength(5);

    // A request that has been sent is not editable, so a receipt cannot be added to it.
    const sent = await post(mine, made.requestId!, { name: "Late.pdf", mimeType: "application/pdf", buffer: minimalPdf("late") });
    expect([sent.status(), await sent.json()]).toEqual([409, { kind: "not_editable" }]);
    await mine.close();
  });

  test("the edit page of a draft with five receipts shows them and the 'most allowed' sentence in place of the picker, at 360 px", async ({ browser }) => {
    const draft = (await requests()).find((r) => r.status === "draft" && r.purpose.startsWith("Candles"))!;
    const ctx = await contextFor(browser, "member", 360, 740);
    const page = await ctx.newPage();
    await page.goto(`${base()}/${draft.id}/edit`);
    await waitHydrated(page);
    await expect(page.getByTestId("receipt-row")).toHaveCount(5);
    await expect(page.getByTestId("receipt-add")).toHaveCount(0);
    await expect(page.getByTestId("receipt-cap")).toHaveText("You've added the most receipts allowed (5).");
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/reimbursement-360/receipts-five.png", fullPage: true });
    // Removing one brings the picker back.
    await page.getByRole("button", { name: "Remove Bill 4.pdf" }).click();
    await expect(page.getByTestId("receipt-row")).toHaveCount(4);
    await expect(page.getByTestId("receipt-add")).toBeVisible();
    await ctx.close();
  });

});

