/**
 * giving-settlements.spec.ts - the read-only payouts page against a running
 * server (online giving, Batch 6; docs/work-log/2026-10-15-online-giving.md).
 *
 * The rows are inserted as the ingest path would have stored them
 * (`addSettlement`): the e2e server has no Stripe key, so the real
 * balance-transaction read is covered by the ingest tests, not here. What this
 * proves end to end: the five honest statements about a payout's contents - an
 * AUTOMATIC payout that adds up (with its charge matched to a recorded gift), one
 * that does not, a MANUAL payout ("Reconciliation unavailable", never zero
 * lines), one whose contents have not arrived, and a failed one; the page needs
 * giving.view (a recorder is told it isn't theirs); and it fits a 360 px phone
 * (screenshots to test-results/giving-360/ for a human to read).
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  addLiveOnlineGift,
  addSettlement,
  removeGivingFixture,
  setConnection,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "./support/giving-fixture";

let sql: Sql;
let fx: GivingFixture;
let ctx: BrowserContext;
const ids: Record<string, string> = {};

const page0 = () => `/o/${fx.slug}/admin/giving/settlements`;
const row = (page: Page, key: string) => page.locator(`[data-testid="settlement-row"]`).filter({ hasText: ids[key]! });

test.describe.configure({ mode: "serial" });

test.describe("Giving payouts (settlements)", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("giving-settlements.spec");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "viewer");
    const conn = (await setConnection(sql, fx, { status: "active", livemode: true }))!;
    const pi = `pi_fixturesettle${Date.now().toString(36)}`;
    const gift = await addLiveOnlineGift(sql, fx, conn, { donorId: fx.donors.imogen, amountCents: 5000, occurredOn: "2027-01-28", paymentIntentId: pi });

    ids.balanced = (await addSettlement(sql, fx, {
      connectionId: conn, arrivalDate: "2027-02-03", grossCents: 5000 + 3000 - 1000 - 175 - 117, status: "paid",
      lines: [
        { kind: "charge", grossCents: 5000, feeCents: 175, giftId: gift, paymentIntent: pi },
        { kind: "charge", grossCents: 3000, feeCents: 117, paymentIntent: "pi_notourgift00001" },
        { kind: "refund", grossCents: -1000 },
      ],
    })).payoutId;
    ids.mismatch = (await addSettlement(sql, fx, {
      connectionId: conn, arrivalDate: "2027-01-20", grossCents: 9999,
      lines: [{ kind: "charge", grossCents: 4000, feeCents: 100 }],
    })).payoutId;
    ids.manual = (await addSettlement(sql, fx, { connectionId: conn, arrivalDate: "2027-01-10", grossCents: 40000, automatic: false })).payoutId;
    ids.waiting = (await addSettlement(sql, fx, { connectionId: conn, arrivalDate: "2027-02-10", grossCents: 1500 })).payoutId;
    ids.failed = (await addSettlement(sql, fx, { connectionId: conn, arrivalDate: "2027-01-05", grossCents: 2000, status: "failed" })).payoutId;

    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (sql && fx) await removeGivingFixture(sql, fx);
  });

  test("lists every payout newest first, each with the words its state wears", async () => {
    const page = await ctx.newPage();
    await page.goto(page0());
    await expect(page.getByRole("heading", { level: 1, name: "Payouts" })).toBeVisible();
    await expect(page.getByTestId("settlement-row")).toHaveCount(5);
    const order = await page.getByTestId("settlement-row").evaluateAll((els, keys) => els.map((el) => keys.find((k) => el.textContent!.includes(k[1]))![0]), Object.entries(ids));
    expect(order).toEqual(["waiting", "balanced", "mismatch", "manual", "failed"]);
    await expect(row(page, "failed")).toContainText("Failed");
    await expect(row(page, "balanced")).toContainText("Paid");
    await expect(row(page, "manual")).toContainText("Manual");
    await page.close();
  });

  test("an automatic payout that adds up shows its figures, and says one charge matches no recorded gift", async () => {
    const page = await ctx.newPage();
    await page.goto(page0());
    const r = row(page, "balanced");
    await expect(r).toHaveAttribute("data-reconciliation", "balanced");
    await expect(r).toContainText("$67.08");
    await expect(r).toContainText("Charges (2)");
    await expect(r).toContainText("$80.00");
    await expect(r).toContainText("Refunds and disputes (1)");
    await expect(r).toContainText("-$10.00");
    await expect(r).toContainText("-$2.92");
    await expect(r).toContainText("The transactions below add up to the payout.");
    await expect(r.getByTestId("settlement-matching")).toContainText("1 charge doesn't match a gift recorded here");
    await page.close();
  });

  test("lines that do not add up are said, with both numbers; a manual payout is 'Reconciliation unavailable'; undelivered contents wait", async () => {
    const page = await ctx.newPage();
    await page.goto(page0());
    await expect(row(page, "mismatch")).toContainText("The transactions listed total $39.00, but the payout was $99.99.");
    const manual = row(page, "manual");
    await expect(manual.getByTestId("settlement-manual")).toContainText("Reconciliation unavailable");
    await expect(manual).toContainText("$400.00");
    await expect(manual.getByTestId("settlement-contents")).toHaveCount(0);
    await expect(manual).not.toContainText("Net deposited");
    await expect(row(page, "waiting").getByTestId("settlement-waiting")).toBeVisible();
    await expect(row(page, "failed")).toContainText("nothing to match");
    await page.close();
  });

  test("the page needs giving.view: a recorder is told it isn't theirs, and sees no payout", async () => {
    await setGivingRole(sql, fx, "recorder");
    try {
      const page = await ctx.newPage();
      await page.goto(page0());
      await expect(page.getByText(/Payouts isn.t available to your account at/)).toBeVisible();
      await expect(page.getByTestId("settlement-row")).toHaveCount(0);
      await page.close();
    } finally {
      await setGivingRole(sql, fx, "viewer");
    }
  });

  test("the overview links to it for a viewer", async () => {
    const page = await ctx.newPage();
    await page.goto(`/o/${fx.slug}/admin/giving`);
    await page.getByRole("link", { name: /Payouts/ }).click();
    await expect(page).toHaveURL(new RegExp(`${page0()}$`));
    await page.close();
  });

  test("360 px: no horizontal scroll, the cards read (screenshot read by a human)", async () => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(page0());
    await expect(page.getByTestId("settlement-row")).toHaveCount(5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-results/giving-360/settlements.png", fullPage: true });
    await page.close();
  });
});
