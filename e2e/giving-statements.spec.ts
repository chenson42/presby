/**
 * giving-statements.spec.ts - the year-end statements surface against a running
 * server (online giving, Batch 5b; docs/work-log/2026-10-15-online-giving.md).
 *
 * Everything lives at a THROWAWAY congregation (`e2e-giving-<stamp>`, see
 * support/giving-fixture.ts for why it is not e2e-alpha) and is removed in
 * afterAll by deleting that organization: statements, lines, deliveries and
 * their PDFs are frozen/delete-guarded rows that go with the organization (P3-8).
 * The one thing outside it is the notice test's `email_queue` rows, removed by
 * recipient address and template.
 *
 * The signed-in actor is the `mfa-enrolled` fixture with a real TOTP session
 * (holding a giving key forces 2FA); its giving role is swapped in the database
 * between tests.
 *
 * What this proves end to end: the treasurer issues a year's statements through
 * the dialog's progress loop; the stored PDF downloads as a private, uncacheable
 * attachment and reads right; the print run is one PDF and is audited; a
 * REPLAYED REFUND (the B3 signed-event harness, the real webhook route) turns a
 * statement stale and the overview says so; "Issue corrected statement" makes
 * version 2 titled "Corrected statement, replaces statement dated ...", keeping
 * the original; the notice email carries no `$` and no decimal amounts; absent
 * and malformed statement ids are the same 404; and the page fits a 360 px phone
 * (screenshots to test-results/giving-360/ for a human to read).
 *
 * The member download and the member list are Batch 6; the production gate on
 * issuing (`GIVING_STATEMENTS_ENABLED`) needs a production NODE_ENV and is
 * proven in the library and page tests.
 *
 * REQUIREMENT ON THE SERVER: the replay step needs `STRIPE_WEBHOOK_SECRET`
 * (giving-e2e-signing-secret) like e2e/giving-webhook.spec.ts; `playwright.config.ts`
 * sets it for a server it starts.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  GIVING_NAMES as N,
  addDonor,
  addGivingSettings,
  addLiveOnlineGift,
  addOfflineGift,
  linkDonorToMember,
  removeGivingFixture,
  setConnection,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "./support/giving-fixture";
import { fixtureBody, signStripePayload } from "../src/lib/giving/providers/stripe/testing/sign-event";
import { extractPdfPages, extractPdfText } from "../src/lib/testing/pdf-text";

const YEAR = new Date().getUTCFullYear() - 1;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "giving-e2e-signing-secret";
const NOTICE_TEMPLATE = "giving.statement.notice";

let sql: Sql;
let fx: GivingFixture;
let ctx: BrowserContext;
let connectionId: string;
let account: string;
let donorNowhere: string;
let paymentIntent: string;

const base = () => `/o/${fx.slug}/admin/giving`;
const page0 = () => `${base()}/statements`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];
const flat = (text: string) => text.replace(/\s+/g, " ");
const row = (page: Page, name: string) => page.getByTestId("statement-row").filter({ hasText: name });

const auditCount = async (action: string) =>
  Number(
    (await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action = ${action} and metadata->>'organizationId' = ${fx.orgId}`,
    ))[0]!.n,
  );

async function statementId(donorName: string, version = 1): Promise<string> {
  return (await rows<{ id: string }>(
    sql`select id from giving_statements where organization_id = ${fx.orgId}::uuid and donor_name = ${donorName} and version = ${version}`,
  ))[0]!.id;
}

async function openPage(path: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await ctx.newPage();
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(path);
  return page;
}

test.describe.configure({ mode: "serial" });

test.describe("Year-end statements (treasurer)", () => {
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("giving-statements.spec");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "treasurer");
    await addGivingSettings(sql, fx);
    connectionId = (await setConnection(sql, fx, { status: "active", livemode: true }))!;
    account = (await rows<{ external_account_id: string }>(sql`select external_account_id from giving_provider_connections where id = ${connectionId}::uuid`))[0]!.external_account_id;

    // Imogen: a live online gift ($75.00) and a cash gift ($50.00)  -> a $125.00 statement
    paymentIntent = `pi_fixturestmt${Date.now().toString(36)}`;
    await addLiveOnlineGift(sql, fx, connectionId, { donorId: fx.donors.imogen, amountCents: 7500, occurredOn: `${YEAR}-06-01`, paymentIntentId: paymentIntent });
    await addOfflineGift(sql, fx, { donorId: fx.donors.imogen, amountCents: 5000, occurredOn: `${YEAR}-03-03` });
    // W. Ashgrove: a linked member with an email  -> the only notice candidate
    await addOfflineGift(sql, fx, { donorId: fx.donors.matched, amountCents: 3000, occurredOn: `${YEAR}-04-04` });
    await linkDonorToMember(sql, fx, fx.donors.matched, fx.proposedPersonId);
    // Nowhere Noor: no email, no address  -> issued, but cannot be sent
    donorNowhere = await addDonor(sql, fx, "E2E Nowhere Noor");
    await addOfflineGift(sql, fx, { donorId: donorNowhere, amountCents: 2000, occurredOn: `${YEAR}-05-05` });
    // Loose offering: no donor  -> never a statement
    const plate = await addDonor(sql, fx, "Plate offering", { kind: "unidentified" });
    await addOfflineGift(sql, fx, { donorId: plate, amountCents: 900, occurredOn: `${YEAR}-05-06` });

    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (sql && fx) {
      await sql`delete from email_queue where template_key = ${NOTICE_TEMPLATE} and to_email like '%.e2e@example.invalid'`;
      await removeGivingFixture(sql, fx);
    }
  });

  // -----------------------------------------------------------------------
  test("last year's run, before anything is issued: the counts, the exceptions, and an Issue button", async () => {
    const page = await openPage(page0());
    await expect(page.getByRole("heading", { level: 1, name: "Year-end statements" })).toBeVisible();
    await expect((page.getByLabel("Year")).inputValue()).resolves.toBe(String(YEAR));
    await expect(page.getByTestId("run-counts")).toContainText(`3 donors have gifts in ${YEAR}. 0 already have a statement; 3 are still to issue.`);
    await expect(page.getByTestId("exception-undeliverable")).toContainText("1 donor has no email and no mailing address");
    await expect(page.getByTestId("exception-undeliverable").getByRole("link", { name: "E2E Nowhere Noor" })).toBeVisible();
    await expect(page.getByTestId("exception-plate")).toContainText("1 cash gift was recorded without a donor");
    await expect(page.getByTestId("statements-empty")).toContainText(`No ${YEAR} statements issued yet`);
    await expect(page.getByRole("button", { name: "Issue 3 statements" })).toBeEnabled();
    await expect(page.getByTestId("print-run-link")).toHaveCount(0);
    await page.close();
  });

  test("360 px, before issuing: no horizontal scroll, 44 px controls, the issue dialog fits (screenshots read by a human)", async () => {
    const page = await openPage(page0(), { width: 360, height: 740 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectFitsPhone(page, "statements-before");
    await page.getByRole("button", { name: "Issue 3 statements" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: "test-results/giving-360/statements-issue-dialog.png" });
    await dialog.getByRole("button", { name: "Not yet" }).click();
    await page.close();
  });

  test("a recorder is told Statements isn't theirs, and both routes refuse them with a 403", async () => {
    await setGivingRole(sql, fx, "recorder");
    const page = await openPage(page0());
    await expect(page.getByText(/Statements isn.t available to your account at/)).toBeVisible();
    expect((await page.request.get(`${page0()}/print?year=${YEAR}`)).status()).toBe(403);
    expect((await page.request.get(`${page0()}/${crypto.randomUUID()}/download`)).status()).toBe(403);
    await page.close();
    await setGivingRole(sql, fx, "treasurer");
  });

  test("the treasurer issues the year: a confirm, real progress, then the statements are listed - and each issue is audited", async () => {
    const before = await auditCount("tenant.giving_statement.issued");
    const page = await openPage(page0());
    await page.getByRole("button", { name: "Issue 3 statements" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Issue ${YEAR} statements?`);
    await expect(dialog).toContainText("frozen");
    await dialog.getByRole("button", { name: "Issue statements" }).click();
    await expect(dialog.getByText("Statements issued")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByTestId("issue-progress")).toHaveText("3 issued of 3");
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(page.getByTestId("statement-row")).toHaveCount(3);
    await expect(page.getByTestId("run-counts")).toContainText("3 already have a statement; 0 are still to issue.");
    await expect(row(page, N.donorImogen)).toContainText("$125.00");
    await expect(row(page, N.donorMatched)).toContainText("$30.00");
    await expect(row(page, "E2E Nowhere Noor")).toContainText("No email or address");
    await expect(page.getByRole("button", { name: /^Issue \d+ statements?$/ })).toHaveCount(0);

    const issued = await rows<{ donor_name: string; version: number; gift_count: number; cash: number }>(
      sql`select donor_name, version, gift_count, cash_total_cents::int as cash from giving_statements where organization_id = ${fx.orgId}::uuid order by donor_name`,
    );
    const byName = (a: { donor_name: string }, b: { donor_name: string }) => a.donor_name.localeCompare(b.donor_name);
    expect([...issued].sort(byName)).toEqual(
      [
        { donor_name: N.donorImogen, version: 1, gift_count: 2, cash: 12500 },
        { donor_name: "E2E Nowhere Noor", version: 1, gift_count: 1, cash: 2000 },
        { donor_name: N.donorMatched, version: 1, gift_count: 1, cash: 3000 },
      ].sort(byName),
    );
    expect(await auditCount("tenant.giving_statement.issued")).toBe(before + 3);
    await page.close();
  });

  test("downloading a statement: a private, uncacheable PDF attachment that reads right - audited; absent and malformed ids are one 404", async () => {
    const before = await auditCount("tenant.giving_statement.downloaded");
    const id = await statementId(N.donorImogen);
    const res = await ctx.request.get(`${page0()}/${id}/download`);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-disposition"]).toMatch(/^attachment; filename="statement-\d{4}-v1-[0-9a-f]{8}\.pdf"$/);
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    const bytes = await res.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = flat(extractPdfText(bytes));
    expect(text).toContain("E2E Fixture Presbyterian Church");
    expect(text).toContain("Tax identification number (EIN): 00-0000000");
    expect(text).toContain(`${YEAR} Contribution Statement`);
    expect(text).toContain(`Dear ${N.donorImogen},`);
    expect(text).toContain("Online gift (card)");
    expect(text).toContain("$75.00");
    expect(text).toContain("$50.00");
    expect(text).toContain("$125.00");
    expect(text).toContain("No goods or services were provided in exchange for these contributions.");
    expect(await auditCount("tenant.giving_statement.downloaded")).toBe(before + 1);

    const absent = await ctx.request.get(`${page0()}/${crypto.randomUUID()}/download`);
    const malformed = await ctx.request.get(`${page0()}/not-a-uuid/download`);
    const noOrg = await ctx.request.get(`/o/e2e-no-such-org-${Date.now()}/admin/giving/statements/${id}/download`);
    for (const r of [absent, malformed, noOrg]) expect(r.status()).toBe(404);
    expect(await absent.text()).toBe(await malformed.text());
    expect(await absent.text()).toBe("Not found");
    expect(absent.headers()["cache-control"]).toBe(malformed.headers()["cache-control"]);
    expect(await auditCount("tenant.giving_statement.downloaded")).toBe(before + 1); // refusals are not downloads
  });

  test("the print run is ONE PDF, one statement per page, and the bulk download is audited with a count", async () => {
    const before = await auditCount("tenant.giving_statements.bulk_downloaded");
    const res = await ctx.request.get(`${page0()}/print?year=${YEAR}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toContain(`statements-${YEAR}-`);
    expect(res.headers()["cache-control"]).toBe("private, no-store");
    const pages = extractPdfPages(await res.body());
    expect(pages).toHaveLength(3);
    const names = pages.map((lines) => flat(lines.join(" ")));
    for (const name of [N.donorImogen, N.donorMatched, "E2E Nowhere Noor"]) {
      expect(names.filter((t) => t.includes(`Dear ${name},`))).toHaveLength(1);
    }
    expect(await auditCount("tenant.giving_statements.bulk_downloaded")).toBe(before + 1);
    const [event] = await rows<{ metadata: { taxYear: number; count: number } }>(
      sql`select metadata from audit_events where action = 'tenant.giving_statements.bulk_downloaded' and metadata->>'organizationId' = ${fx.orgId} order by created_at desc limit 1`,
    );
    expect(event!.metadata).toMatchObject({ taxYear: YEAR, count: 3 });

    expect((await ctx.request.get(`${page0()}/print`)).status()).toBe(400);
    expect((await ctx.request.get(`${page0()}/print?year=${YEAR - 8}`)).status()).toBe(404);
    expect(await auditCount("tenant.giving_statements.bulk_downloaded")).toBe(before + 1);
  });

  test("the notice email goes only to a linked member with an email, carries no amounts, and is logged with its queue id", async () => {
    const before = await auditCount("tenant.giving_statement.notice_sent");
    const page = await openPage(page0());
    await page.getByRole("button", { name: "Email a notice (1)" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("shows no amounts and no gifts");
    await dialog.getByRole("button", { name: "Send notices" }).click();
    await expect(page.getByText("1 notice sent.")).toBeVisible({ timeout: 30_000 });
    await expect(row(page, N.donorMatched)).toContainText("Notice emailed");
    await expect(page.getByRole("button", { name: /Email a notice/ })).toHaveCount(0);

    const deliveries = await rows<{ channel: string; email_queue_id: string; donor: string }>(
      sql`select d.channel, d.email_queue_id::text as email_queue_id, s.donor_name as donor
            from giving_statement_deliveries d join giving_statements s on s.id = d.statement_id
           where d.organization_id = ${fx.orgId}::uuid`,
    );
    expect(deliveries).toEqual([{ channel: "email_notice", email_queue_id: expect.any(String), donor: N.donorMatched }]);
    const [mail] = await rows<{ to_email: string; subject: string; html_body: string; text_body: string; template_key: string }>(
      sql`select to_email, subject, html_body, text_body, template_key from email_queue where id = ${deliveries[0]!.email_queue_id}::uuid`,
    );
    expect(mail).toMatchObject({ to_email: N.matchedEmail, template_key: NOTICE_TEMPLATE });
    expect(mail!.subject).toBe(`Your ${YEAR} giving statement from ${N.org}`);
    for (const part of [mail!.subject, mail!.html_body, mail!.text_body]) {
      expect(part).not.toContain("$");
      expect(part).not.toMatch(/\d+\.\d{2}/);
    }
    expect(mail!.text_body).toContain(`/o/${fx.slug}/giving`);
    expect(await auditCount("tenant.giving_statement.notice_sent")).toBe(before + 1);
    await page.close();
  });

  test("marking a statement as mailed shows on the row and is audited once", async () => {
    const before = await auditCount("tenant.giving_statement.delivery_recorded");
    const page = await openPage(page0());
    const target = row(page, "E2E Nowhere Noor");
    await target.getByRole("button", { name: "Mark as mailed" }).click();
    await expect(page.getByText("Marked as mailed.")).toBeVisible();
    await expect(target).toContainText("Mailed");
    await expect(target.getByRole("button", { name: "Mark as mailed" })).toHaveCount(0);
    const delivered = await rows<{ channel: string; email_queue_id: string | null }>(
      sql`select d.channel, d.email_queue_id from giving_statement_deliveries d join giving_statements s on s.id = d.statement_id where s.donor_name = 'E2E Nowhere Noor' and d.organization_id = ${fx.orgId}::uuid`,
    );
    expect(delivered).toEqual([{ channel: "print_mailed", email_queue_id: null }]);
    expect(await auditCount("tenant.giving_statement.delivery_recorded")).toBe(before + 1);
    await page.close();
  });

  test("a REPLAYED REFUND (the signed-event harness) turns the statement stale; the page and the overview say so", async ({ request }) => {
    const id = await statementId(N.donorImogen);
    const refund = fixtureBody("refund-created", {
      replacements: {
        acct_fixtureAccount0001: account,
        pi_fixturePaid000001: paymentIntent,
        re_fixtureRefund000001: `re_fixturestmt${Date.now().toString(36)}`,
      },
      patch(b) {
        b.id = `evt_fixturestmt${Date.now().toString(36)}`;
        b.livemode = true; // the connection is live; the gift is a live-mode gift that statements count
      },
    });
    const res = await request.post("/api/webhooks/stripe", {
      data: refund,
      headers: { "content-type": "application/json", "stripe-signature": signStripePayload(refund, SECRET) },
    });
    expect(res.status()).toBe(200);
    await expect
      .poll(async () => (await rows<{ n: number }>(sql`select count(*)::int as n from giving_gift_reversals where organization_id = ${fx.orgId}::uuid and kind = 'refund'`))[0]!.n, { timeout: 30_000, intervals: [250, 500, 1000] })
      .toBe(1);

    const page = await openPage(page0());
    await expect(row(page, N.donorImogen)).toContainText("Out of date");
    await expect(page.getByTestId("exception-stale")).toContainText("1 statement is out of date");
    await expect(page.getByRole("link", { name: "Out of date (1)" })).toBeVisible();
    await page.getByRole("link", { name: "Out of date (1)" }).click();
    await expect(page.getByTestId("statement-row")).toHaveCount(1);
    // The frozen original is untouched: its PDF still says $125.00.
    const original = flat(extractPdfText(await (await ctx.request.get(`${page0()}/${id}/download`)).body()));
    expect(original).toContain("$125.00");
    await page.close();

    const overview = await openPage(base());
    await expect(overview.getByText(/1 statement is out of date because a gift changed after it was issued/)).toBeVisible();
    await overview.close();
  });

  test("'Issue corrected statement' makes version 2 titled 'Corrected statement, replaces statement dated...', keeps the original, and clears the stale flag", async () => {
    const before = await auditCount("tenant.giving_statement.reissued");
    const v1 = await statementId(N.donorImogen);
    const page = await openPage(`${page0()}?year=${YEAR}&filter=stale`);
    await row(page, N.donorImogen).getByRole("button", { name: "Issue corrected statement" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Issue a corrected ${YEAR} statement?`);
    await expect(dialog).toContainText("The original is kept and marked as replaced");
    await dialog.getByRole("button", { name: "Issue corrected statement" }).click();
    await expect(page.getByText("Corrected statement issued.")).toBeVisible({ timeout: 30_000 });

    const chain = await rows<{ version: number; supersedes_id: string | null; id: string }>(
      sql`select id, version, supersedes_id::text as supersedes_id from giving_statements where organization_id = ${fx.orgId}::uuid and donor_name = ${N.donorImogen} order by version`,
    );
    expect(chain).toHaveLength(2);
    expect(chain[1]).toMatchObject({ version: 2, supersedes_id: v1 });
    expect(await auditCount("tenant.giving_statement.reissued")).toBe(before + 1);

    // Current list: version 2 with a Corrected badge and no stale flag; the original is under Earlier versions.
    await page.goto(page0());
    await expect(row(page, N.donorImogen)).toContainText("Corrected");
    await expect(row(page, N.donorImogen)).not.toContainText("Out of date");
    await expect(page.getByTestId("exception-stale")).toHaveCount(0);
    await page.getByRole("link", { name: "Earlier versions" }).click();
    await expect(row(page, N.donorImogen)).toContainText("Replaced by a newer version");
    await expect(row(page, N.donorImogen).getByRole("button", { name: "Issue corrected statement" })).toHaveCount(0);

    // The new PDF is titled, totals the net ($75 online - $50 refunded + $50 cash), and keeps the original's bytes untouched.
    const v2 = flat(extractPdfText(await (await ctx.request.get(`${page0()}/${chain[1]!.id}/download`)).body()));
    expect(v2).toContain("Corrected statement, replaces statement dated");
    expect(v2).toContain("$75.00"); // total
    expect(v2).toContain("Net of $50.00 refunded or returned");
    const v1text = flat(extractPdfText(await (await ctx.request.get(`${page0()}/${v1}/download`)).body()));
    expect(v1text).toContain("$125.00");
    expect(v1text).not.toContain("Corrected statement");

    // The overview's attention count is clear again, and the print run holds ONLY the latest version of each donor.
    const overview = await openPage(base());
    await expect(overview.getByText(/statement is out of date/)).toHaveCount(0);
    await overview.close();
    const printed = extractPdfPages(await (await ctx.request.get(`${page0()}/print?year=${YEAR}`)).body());
    expect(printed).toHaveLength(3);
    await page.close();
  });

  test("360 px, after issuing: the list, a stale row and its actions fit the phone with 44 px controls (screenshots read by a human)", async () => {
    // Make one statement stale again so the card shows its full set of badges and actions.
    await addOfflineGift(sql, fx, { donorId: fx.donors.matched, amountCents: 1000, occurredOn: `${YEAR}-12-12` });
    const page = await openPage(page0(), { width: 360, height: 740 });
    await expect(page.getByTestId("statement-row")).toHaveCount(3);
    await expect(row(page, N.donorMatched)).toContainText("Out of date");
    await expectFitsPhone(page, "statements-after");
    await page.goto(`${page0()}?year=${YEAR}&filter=stale`);
    await expectFitsPhone(page, "statements-stale");
    await page.close();
  });
});

// ---------------------------------------------------------------------------
/** No horizontal scroll, and no tappable control under 40 px (44 is the target; 40 tolerates the badge row). */
async function expectFitsPhone(page: Page, name: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} has horizontal scroll`).toBeLessThanOrEqual(1);
  const short = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main a[data-slot=button], main button, main input[type=submit]"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((c) => c.h > 0 && c.h < 40),
  );
  expect(short, `${name} has controls shorter than 40px`).toEqual([]);
  await page.screenshot({ path: `test-results/giving-360/${name}.png`, fullPage: true });
}
