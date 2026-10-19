/**
 * giving-member.spec.ts - the member's OWN giving against a running server
 * (online giving, Batch 6; docs/work-log/2026-10-15-online-giving.md, Flow 12 and
 * DECISION-162's self-read): `/o/<slug>/giving`, the member statement download,
 * and the parity of its 404.
 *
 * Everything lives at a THROWAWAY congregation (`e2e-giving-<stamp>`, see
 * support/giving-fixture.ts) removed in afterAll by deleting that organization.
 * The signed-in actor is the `mfa-enrolled` fixture with a real TOTP session; its
 * giving role is swapped in the database between tests - a treasurer to issue the
 * statements through the real dialog, then NO giving key at all for everything a
 * member does (the page needs none, and holding none forces no 2FA challenge on
 * these pages: that half is pinned by the page and route unit tests, since this
 * fixture's account requires 2FA at the Edge regardless).
 *
 * Cast: Octavia (the actor) is linked to her own donor; Winifred is another
 * member linked to a different donor; Imogen is a donor linked to nobody. What
 * Octavia sees must be hers alone - never Winifred's gift or statement, never
 * Imogen's.
 *
 * What this proves end to end: the page's four states (populated, empty, toggle
 * off, signed-out redirect); the gifts with the words their state wears; the
 * corrected statement current and its original under "Earlier versions"; the
 * download (a private, uncacheable PDF, audited, `self: true`); the IDENTICAL 404
 * for another member's statement, an absent id, a malformed id, another org's slug
 * and "giving is off"; the portal tile absent when the toggle is off; and the page
 * at 360 px (screenshots to test-results/giving-360/ for a human to read).
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  GIVING_NAMES as N,
  addDonor,
  addGivingSettings,
  addLiveOnlineGift,
  addOfflineGift,
  addRefund,
  addUnsettledOnlineGift,
  linkDonorToMember,
  offerFundOnline,
  removeGivingFixture,
  setConnection,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "./support/giving-fixture";
import { extractPdfText } from "../src/lib/testing/pdf-text";

const YEAR = new Date().getUTCFullYear() - 1;

let sql: Sql;
let fx: GivingFixture;
let ctx: BrowserContext;
let connectionId: string;
let myDonor: string;

const root = () => `/o/${fx.slug}`;
const givingPath = () => `${root()}/giving`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];
const flat = (text: string) => text.replace(/\s+/g, " ");

const auditCount = async (action: string, extra = "") =>
  Number(
    (await rows<{ n: number }>(
      extra === "self"
        ? sql`select count(*)::int as n from audit_events where action = ${action} and metadata->>'organizationId' = ${fx.orgId} and metadata->>'self' = 'true'`
        : sql`select count(*)::int as n from audit_events where action = ${action} and metadata->>'organizationId' = ${fx.orgId}`,
    ))[0]!.n,
  );

async function statementId(donorName: string, version: number): Promise<string> {
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

const giftRow = (page: Page, text: string | RegExp) => page.getByTestId("gift-row").filter({ hasText: text });

test.describe.configure({ mode: "serial" });

test.describe("Member giving: my gifts, my statements, my downloads", () => {
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("giving-member.spec");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await addGivingSettings(sql, fx);
    await offerFundOnline(sql, fx, true, "general");
    connectionId = (await setConnection(sql, fx, { status: "active", livemode: true, publicOn: true, attested: true }))!;

    // Octavia (the signed-in actor): her own donor, linked to her membership.
    myDonor = await addDonor(sql, fx, "Octavia Marchetti", { email: "octavia.e2e@example.invalid" });
    await linkDonorToMember(sql, fx, myDonor, fx.actingPersonId);
    await addOfflineGift(sql, fx, { donorId: myDonor, amountCents: 5000, occurredOn: `${YEAR}-03-03` });
    const online = await addLiveOnlineGift(sql, fx, connectionId, {
      donorId: myDonor, amountCents: 7500, occurredOn: `${YEAR}-06-01`, paymentIntentId: `pi_fixturemember${Date.now().toString(36)}`,
    });
    await addRefund(sql, fx, { giftId: online, connectionId, amountCents: 2000 });
    await addUnsettledOnlineGift(sql, fx, connectionId, { donorId: myDonor, amountCents: 2500, occurredOn: `${YEAR}-12-20`, status: "pending" });
    await addUnsettledOnlineGift(sql, fx, connectionId, { donorId: myDonor, amountCents: 1200, occurredOn: `${YEAR}-12-21`, status: "failed" });
    // Winifred: another MEMBER, linked to a different donor. Imogen: a donor linked to nobody.
    await linkDonorToMember(sql, fx, fx.donors.matched, fx.proposedPersonId);
    await addOfflineGift(sql, fx, { donorId: fx.donors.matched, amountCents: 3000, occurredOn: `${YEAR}-04-04` });
    await addOfflineGift(sql, fx, { donorId: fx.donors.imogen, amountCents: 9900, occurredOn: `${YEAR}-05-05` });

    await setGivingRole(sql, fx, "treasurer");
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (sql && fx) await removeGivingFixture(sql, fx);
  });

  // -----------------------------------------------------------------------
  test("setup: the treasurer issues the year, then a late gift and a corrected statement give Octavia two versions", async () => {
    const page = await openPage(`${root()}/admin/giving/statements`);
    await page.getByRole("button", { name: "Issue 3 statements" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Issue statements" }).click();
    await expect(dialog.getByText("Statements issued")).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("statement-row")).toHaveCount(3);

    await addOfflineGift(sql, fx, { donorId: myDonor, amountCents: 1000, occurredOn: `${YEAR}-12-12` });
    await page.goto(`${root()}/admin/giving/statements?year=${YEAR}&filter=stale`);
    await page.getByTestId("statement-row").filter({ hasText: "Octavia Marchetti" }).getByRole("button", { name: "Issue corrected statement" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Issue corrected statement" }).click();
    await expect(page.getByText("Corrected statement issued.")).toBeVisible({ timeout: 30_000 });
    expect(await statementId("Octavia Marchetti", 2)).toBeTruthy();
    await page.close();
    await setGivingRole(sql, fx, "none");
  });

  // -----------------------------------------------------------------------
  test("a member with NO giving key opens /giving: the Give online entry, her gifts with the words their state wears, nobody else's", async () => {
    const page = await openPage(givingPath());
    await expect(page.getByRole("heading", { level: 1, name: "Giving" })).toBeVisible();
    await expect(page.getByTestId("give-online").getByRole("link", { name: "Give online" })).toHaveAttribute("href", `${givingPath()}/give`);

    await expect(page.getByTestId("gift-row")).toHaveCount(5);
    await expect(giftRow(page, "Didn't go through")).toContainText("$12.00");
    await expect(giftRow(page, "Processing")).toContainText("$25.00");
    await expect(giftRow(page, "Partly refunded or reversed")).toContainText("$75.00");
    await expect(giftRow(page, "Partly refunded or reversed")).toContainText("$20.00 returned");
    await expect(giftRow(page, "$50.00")).toContainText("Received");
    await expect(giftRow(page, "$10.00")).toContainText("Received");
    await expect(page.getByText(/not on a year-end statement until it completes/)).toBeVisible();

    // newest first
    const order = await page.getByTestId("gift-row").allInnerTexts();
    expect(order.map((t) => /\$(\d+\.\d\d)/.exec(t)![1])).toEqual(["12.00", "25.00", "10.00", "75.00", "50.00"]);

    // Winifred's $30.00 and Imogen's $99.00 are not Octavia's, in any form.
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(text).not.toContain("$30.00");
    expect(text).not.toContain("$99.00");
    expect(text).not.toContain("Ashgrove");
    expect(text).not.toContain("Thackeray");
    await page.close();
  });

  test("her statements: the corrected one is current, the original is under 'Earlier versions', both download", async () => {
    const page = await openPage(givingPath());
    const current = page.getByTestId("statements-list").getByTestId("statement-row");
    await expect(current).toHaveCount(1);
    await expect(current).toContainText(`${YEAR} giving statement`);
    await expect(current).toContainText("Corrected statement");
    await expect(current).toContainText("version 2");

    const disclosure = page.getByTestId("statements-previous");
    await expect(disclosure).toContainText("Earlier versions (1)");
    await expect(page.getByTestId("statements-previous-list")).toBeHidden(); // closed until opened
    await disclosure.locator("summary").click();
    const previous = page.getByTestId("statements-previous-list").getByTestId("statement-row");
    await expect(previous).toHaveCount(1);
    await expect(previous).toContainText("Replaced by a newer version");

    // The treasurer's flags are not a member's business.
    await expect(page.locator("main")).not.toContainText(/out of date/i);
    // Only Octavia's two versions: three statements exist in the org, one belongs to each other donor.
    await expect(page.getByTestId("statement-row")).toHaveCount(2);
    await page.close();
  });

  test("downloading: her own statements are private, uncacheable PDFs that read right - and each is audited as a SELF download", async () => {
    const before = await auditCount("tenant.giving_statement.downloaded", "self");
    const v2 = await statementId("Octavia Marchetti", 2);
    const v1 = await statementId("Octavia Marchetti", 1);

    const res = await ctx.request.get(`${givingPath()}/statements/${v2}/download`);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-disposition"]).toMatch(/^attachment; filename="statement-\d{4}-v2-[0-9a-f]{8}\.pdf"$/);
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    const bytes = await res.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = flat(extractPdfText(bytes));
    expect(text).toContain("Corrected statement, replaces statement dated");
    expect(text).toContain("Dear Octavia Marchetti,");

    const original = await ctx.request.get(`${givingPath()}/statements/${v1}/download`);
    expect(original.status()).toBe(200);
    expect(flat(extractPdfText(await original.body()))).not.toContain("Corrected statement");

    expect(await auditCount("tenant.giving_statement.downloaded", "self")).toBe(before + 2);
    const [event] = await rows<{ metadata: Record<string, unknown> }>(
      sql`select metadata from audit_events where action = 'tenant.giving_statement.downloaded' and metadata->>'organizationId' = ${fx.orgId} order by created_at desc limit 1`,
    );
    expect(Object.keys(event!.metadata).sort()).toEqual(["organizationId", "self", "statementId", "taxYear", "version"]);
    expect(JSON.stringify(event!.metadata)).not.toMatch(/Octavia|example\.invalid|\$/);
  });

  test("the 404 PARITY: another member's statement, an absent id, a malformed id and an unknown organization are the SAME answer; none is audited", async () => {
    const before = await auditCount("tenant.giving_statement.downloaded");
    const winifred = await statementId(N.donorMatched, 1);
    const imogen = await statementId(N.donorImogen, 1);
    const answers = [
      await ctx.request.get(`${givingPath()}/statements/${winifred}/download`),
      await ctx.request.get(`${givingPath()}/statements/${imogen}/download`),
      await ctx.request.get(`${givingPath()}/statements/${crypto.randomUUID()}/download`),
      await ctx.request.get(`${givingPath()}/statements/not-a-uuid/download`),
      await ctx.request.get(`/o/e2e-no-such-org-${Date.now()}/giving/statements/${winifred}/download`),
    ];
    for (const r of answers) expect(r.status()).toBe(404);
    const bodies = await Promise.all(answers.map((r) => r.text()));
    expect(new Set(bodies)).toEqual(new Set(["Not found"]));
    const shape = (r: (typeof answers)[number]) =>
      JSON.stringify(Object.entries(r.headers()).filter(([k]) => ["content-type", "cache-control", "content-disposition", "x-content-type-options"].includes(k)).sort());
    expect(new Set(answers.map(shape)).size).toBe(1);
    expect(await auditCount("tenant.giving_statement.downloaded")).toBe(before);
    // ...and the treasurer's route is not a back door for a keyless member: it is a 403, not a PDF.
    expect((await ctx.request.get(`${root()}/admin/giving/statements/${winifred}/download`)).status()).toBe(403);
  });

  test("signed out: the page and the download both send you to sign in and keep the deep link", async ({ request, browser }) => {
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    await page.goto(givingPath());
    await page.waitForURL(/\/signin\?callbackUrl=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("callbackUrl")!)).toBe(givingPath());
    await anonymous.close();

    const id = await statementId("Octavia Marchetti", 2);
    const res = await request.get(`${givingPath()}/statements/${id}/download`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain(`/signin?callbackUrl=${encodeURIComponent(`${givingPath()}/statements/${id}/download`)}`);
  });

  // -----------------------------------------------------------------------
  test("EMPTY: a member whose church office has linked nothing to her sees what will appear, never an error", async () => {
    await sql`update giving_donors set linked_membership_id = null, link_source = null, linked_at = null where id = ${myDonor}::uuid`;
    try {
      const page = await openPage(givingPath());
      await expect(page.getByTestId("gifts-empty")).toContainText("No gifts are linked to you yet");
      await expect(page.getByTestId("gifts-empty")).toContainText("Gifts you give while signed in, or that your church office links to you, will appear here.");
      await expect(page.getByTestId("statements-empty")).toContainText("No statements yet");
      await expect(page.getByTestId("give-online").getByRole("link", { name: "Give online" })).toBeVisible();
      await expect(page.getByText("We can't load your giving history right now.")).toHaveCount(0);
      // a statement that is no longer hers is no longer downloadable by her either
      const id = await statementId("Octavia Marchetti", 2);
      expect((await ctx.request.get(`${givingPath()}/statements/${id}/download`)).status()).toBe(404);
      await page.close();
    } finally {
      await linkDonorToMember(sql, fx, myDonor, fx.actingPersonId);
    }
  });

  test("giving not live (the public page is off): the entry says so, but her history is still there", async () => {
    await sql`update giving_provider_connections set public_enabled_at = null, public_enabled_by = null where id = ${connectionId}::uuid`;
    try {
      const page = await openPage(givingPath());
      await expect(page.getByTestId("giving-unavailable")).toBeVisible();
      await expect(page.getByRole("link", { name: "Give online" })).toHaveCount(0);
      await expect(page.getByTestId("gift-row")).toHaveCount(5);
      await page.close();
    } finally {
      await sql`update giving_provider_connections set public_enabled_at = now() where id = ${connectionId}::uuid`;
    }
  });

  test("TOGGLE OFF: the page says Giving isn't turned on (200, not a 404), the portal tile is gone, the download is the same 404", async () => {
    const id = await statementId("Octavia Marchetti", 2);
    const onHome = await openPage(root());
    await expect(onHome.locator(`a[href="${givingPath()}"]`).first()).toBeVisible(); // the tile, toggle on
    await onHome.close();

    await setGivingToggle(sql, fx, false);
    try {
      const page = await ctx.newPage();
      const response = await page.goto(givingPath());
      expect(response!.status()).toBe(200);
      await expect(page.getByText(`Giving isn't turned on for ${N.org}.`)).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Features" })).toHaveCount(0);
      await expect(page.getByTestId("gift-row")).toHaveCount(0);

      await page.goto(root());
      await expect(page.locator(`a[href="${givingPath()}"]`)).toHaveCount(0);

      const off = await ctx.request.get(`${givingPath()}/statements/${id}/download`);
      const absent = await ctx.request.get(`${givingPath()}/statements/${crypto.randomUUID()}/download`);
      expect(off.status()).toBe(404);
      expect(await off.text()).toBe(await absent.text());
      await page.close();
    } finally {
      await setGivingToggle(sql, fx, true);
    }
  });

  // -----------------------------------------------------------------------
  test("360 px: no horizontal scroll, 44 px controls, the disclosure opens, the cards read (screenshots read by a human)", async () => {
    const page = await openPage(givingPath(), { width: 360, height: 740 });
    await expect(page.getByTestId("gift-row")).toHaveCount(5);
    await expectFitsPhone(page, "member-giving");
    await page.getByTestId("statements-previous").locator("summary").click();
    await expect(page.getByTestId("statements-previous-list")).toBeVisible();
    await expectFitsPhone(page, "member-giving-open");

    await sql`update giving_donors set linked_membership_id = null, link_source = null, linked_at = null where id = ${myDonor}::uuid`;
    try {
      await page.goto(givingPath());
      await expect(page.getByTestId("gifts-empty")).toBeVisible();
      await expectFitsPhone(page, "member-giving-empty");
    } finally {
      await linkDonorToMember(sql, fx, myDonor, fx.actingPersonId);
    }
    await page.close();
  });
});

// ---------------------------------------------------------------------------
/** No horizontal scroll, and no tappable control under 40 px (44 is the target; 40 tolerates the badge row). */
async function expectFitsPhone(page: Page, name: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} has horizontal scroll`).toBeLessThanOrEqual(1);
  const short = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main a[data-slot=button], main button, main summary span, main input[type=submit]"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((c) => c.h > 0 && c.h < 40),
  );
  expect(short, `${name} has controls shorter than 40px`).toEqual([]);
  await page.screenshot({ path: `test-results/giving-360/${name}.png`, fullPage: true });
}
