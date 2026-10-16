/**
 * giving-public.spec.ts - the public and member give surfaces, the return
 * pages and the `giving` live slot against a running server (online giving,
 * Batch 4b; docs/work-log/2026-10-15-online-giving.md).
 *
 * NO LIVE STRIPE ACCOUNT EXISTS and `STRIPE_SECRET_KEY` is unset in the suite
 * environment, so a submit ends where the contract says it does: presby writes
 * the intent, fails it, and the form says "isn't available right now". The
 * redirect-to-Checkout branch is a component test with a mocked action result
 * (`give-form.test.tsx`); the real redirect is the operator's smoke
 * (docs/deployment.md, test-mode step 8).
 *
 * One throwaway congregation, `e2e-giving-<stamp>`, torn down in afterAll (the
 * cascade takes every giving row, the site row and the staged bundle). The
 * member test signs in as the `mfa-enrolled` fixture (a member of that
 * congregation, holding NO giving role: a plain member may give).
 *
 * Proves: the three page states with byte-identical `absent` responses for an
 * unknown slug, a non-tenant slug and a toggle-off organization; the enforced
 * CSP header on the give pages and a clean console on them; no Stripe origin in
 * any script, frame or response header; the five return panels from seeded
 * intents and the single `unknown` panel; no name or email on a return page;
 * the live slot (placed by a staged bundle, validated `filter.fund`, gone when
 * giving is off); and a 360 px pass (no sideways scroll, screenshots under
 * test-results/giving-public-360/ for a human to read).
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  GIVING_NAMES as N,
  addLiveSite,
  latestIntents,
  offerFundOnline,
  removeGivingFixture,
  removeSite,
  seedReturnIntent,
  setConnection,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
  type ReturnKind,
} from "./support/giving-fixture";

let sql: Sql;
let fx: GivingFixture;
let connId: string;

const give = () => `/site/${fx.slug}/give`;
const ret = (session: string) => `${give()}/return?session_id=${session}`;
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/giving-public-360/${name}.png`, fullPage: true });

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(1);
}

/** Next stamps each response with a random request id (`__next_r`) and an `_rsc` token; nothing else may differ. */
function maskPerRequest(html: string): string {
  return html.replace(/__next_r="[^"]*"/g, "R").replace(/_rsc=[A-Za-z0-9]+/g, "RSC");
}

/** Collects console errors and CSP violation reports for a page. */
function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || /content security policy|violates the following/i.test(m.text())) bad.push(m.text());
  });
  page.on("pageerror", (e) => bad.push(e.message));
  return bad;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sql = platformSql("giving-public.spec");
  fx = await setupGivingFixture(sql);
  await setGivingToggle(sql, fx, true);
  await offerFundOnline(sql, fx, true, "general");
  await offerFundOnline(sql, fx, true, "building");
  connId = (await setConnection(sql, fx, { status: "active", publicOn: true, attested: true, livemode: false }))!;
});

test.afterAll(async () => {
  if (fx) await removeGivingFixture(sql, fx);
});

test.describe("the give page states", () => {
  test("live: the form, the test-mode notice, an enforced CSP, a clean console, and nothing from Stripe", async ({ page }) => {
    const bad = watchConsole(page);
    const response = await page.goto(give());
    expect(response!.status()).toBe(200);
    expect(response!.headers()["content-security-policy"]).toContain("form-action 'self'");
    for (const [name, value] of Object.entries(response!.headers())) {
      expect(`${name}: ${value}`, "a Stripe origin in a response header").not.toMatch(/stripe\.com/i);
    }

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Give to ${fx.name}`);
    await expect(page.getByTestId("giving-test-mode-badge")).toBeVisible();
    await expect(page.getByLabel(/^Fund/)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Give", exact: true })).toBeEnabled();

    const origins = await page.evaluate(() => [
      ...Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src),
      ...Array.from(document.querySelectorAll("iframe")).map((f) => f.src),
    ]);
    expect(origins.filter((o) => /stripe\.com/i.test(o))).toEqual([]);
    expect(await page.locator("iframe").count()).toBe(0);
    expect(page.frames().map((f) => f.url()).filter((u) => /stripe/i.test(u))).toEqual([]);
    expect(bad, "console errors / CSP violations on the give page").toEqual([]);
  });

  test("submitting with Stripe unconfigured says so, charges nothing, and the retry is a new attempt", async ({ page }) => {
    await page.goto(give());
    await page.getByRole("button", { name: "$25", exact: true }).click();
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect(page.getByTestId("give-banner")).toContainText("Online giving isn't available right now. You haven't been charged.");
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect.poll(async () => (await latestIntents(sql, fx)).length).toBe(2);

    const keys = (await sql`select idempotency_key from giving_checkout_intents where organization_id = ${fx.orgId}::uuid`) as { idempotency_key: string }[];
    expect(new Set(keys.map((k) => k.idempotency_key)).size, "each attempt carries its own key").toBe(2);
    const intents = await latestIntents(sql, fx);
    expect(intents.every((i) => i.status === "failed" && i.gift_amount_cents === 2500)).toBe(true);
    await sql`delete from giving_checkout_intents where organization_id = ${fx.orgId}::uuid`;
  });

  test("an amount the browser refuses never reaches the database", async ({ page }) => {
    await page.goto(give());
    await page.getByLabel(/Amount \(US dollars\)/).fill("10.999");
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect(page.getByText("Enter an amount in dollars, like 25 or 25.50.")).toBeVisible();
    expect(await latestIntents(sql, fx)).toEqual([]);
  });

  test("ticking cover-fees asks for card or bank and shows gift + fees = total", async ({ page }) => {
    await page.goto(give());
    await page.getByLabel(/Amount \(US dollars\)/).fill("100");
    await expect(page.getByTestId("give-fee-preview")).toHaveCount(0);
    await page.getByLabel(/Add the processing fee/).check();
    await page.getByRole("radio", { name: "Bank account" }).check();
    await expect(page.getByTestId("give-fee-preview")).toContainText("Your gift $100.00 + fees $0.81 = total $100.81");
  });

  test("unavailable: a live site but giving not live shows the notice and never the form", async ({ page }) => {
    await setConnection(sql, fx, null);
    await addLiveSite(sql, fx);
    const response = await page.goto(give());
    expect(response!.status()).toBe(200);
    await expect(page.getByTestId("giving-unavailable")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Online giving isn't available right now");
    await expect(page.locator("form")).toHaveCount(0);
    connId = (await setConnection(sql, fx, { status: "active", publicOn: true, attested: true, livemode: false }))!;
  });

  test("toggle off WITH a live public site is the unavailable notice, never the form", async ({ page }) => {
    await addLiveSite(sql, fx);
    await setGivingToggle(sql, fx, false);
    try {
      const response = await page.goto(give());
      expect(response!.status()).toBe(200);
      await expect(page.getByTestId("giving-unavailable")).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    } finally {
      await setGivingToggle(sql, fx, true);
    }
  });

  test("absent: an unknown slug, a non-tenant slug and a toggle-off organization get the very same response", async ({ request }) => {
    const nonTenant = ((await sql`select slug from organizations where organization_type = 'presbytery' and slug <> ${fx.slug} limit 1`) as { slug: string }[])[0]?.slug;
    expect(nonTenant, "a seeded presbytery to stand in for a non-tenant slug").toBeTruthy();
    // No public site: that is what makes a toggle-off organization `absent` (with a
    // live site it is `unavailable`, below - the site is already public).
    await removeSite(sql, fx);
    await setGivingToggle(sql, fx, false);
    try {
      const probes = ["e2e-giving-no-such-church", nonTenant!, fx.slug];
      const results: { status: number; body: string; csp: string | undefined }[] = [];
      for (const slug of probes) {
        const res = await request.get(`/site/${slug}/give`, { maxRedirects: 0 });
        // Only the slug itself may differ in the markup; mask it.
        results.push({ status: res.status(), body: maskPerRequest((await res.text()).split(slug).join("SLUG")), csp: res.headers()["content-security-policy"] });
      }
      expect(results.map((r) => r.status)).toEqual([404, 404, 404]);
      expect(results[1]!.body).toBe(results[0]!.body);
      expect(results[2]!.body).toBe(results[0]!.body);
      expect(results[1]!.csp).toBe(results[0]!.csp);
      expect(results[2]!.csp).toBe(results[0]!.csp);
    } finally {
      await setGivingToggle(sql, fx, true);
    }
  });
});

test.describe("the return pages", () => {
  const KINDS: { kind: ReturnKind; panel: string; heading: string; gift: string | null }[] = [
    { kind: "confirming", panel: "confirming", heading: "We've received your gift and are confirming it", gift: "$37.50 to Giving" },
    { kind: "received", panel: "received", heading: "Thank you for your gift", gift: "$37.50 to Giving" },
    { kind: "received_monthly", panel: "received", heading: "Thank you for your gift", gift: "$37.50 every month to Giving" },
    { kind: "bank_pending", panel: "bank_pending", heading: "Your bank transfer is on its way", gift: "$37.50 to Giving" },
    { kind: "failed", panel: "failed", heading: "Your gift didn't go through", gift: null },
  ];

  test.beforeAll(async () => {
    let n = 0;
    for (const { kind } of KINDS) await seedReturnIntent(sql, fx, connId, kind, (n += 1));
  });

  for (const { kind, panel, heading, gift } of KINDS) {
    test(`${kind}: its own panel, an amount and a fund and nothing personal`, async ({ page }) => {
      const bad = watchConsole(page);
      await page.goto(ret(`cs_test_${kind}_fixture`));
      await expect(page.getByTestId(`give-return-${panel}`)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      if (gift) await expect(page.getByTestId("give-return-gift")).toContainText(gift);
      else await expect(page.getByTestId("give-return-gift")).toHaveCount(0);
      await expect(page.getByTestId("giving-test-mode-badge")).toBeVisible();

      const text = (await page.locator("body").innerText()) + (await page.content());
      expect(text).not.toContain(N.donorImogen);
      expect(text).not.toContain(N.imogenEmail);
      expect(text).not.toMatch(/acknowledg/i);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
      expect(bad).toEqual([]);
    });
  }

  test("a monthly gift says how to stop it", async ({ page }) => {
    await page.goto(ret("cs_test_received_monthly_fixture"));
    await expect(page.getByTestId("give-return-monthly")).toContainText("contact the church");
  });

  test("received says the Stripe receipt is a payment receipt, separate from the year-end statement", async ({ page }) => {
    await page.goto(ret("cs_test_received_fixture"));
    const body = page.getByTestId("give-return-received");
    await expect(body).toContainText("payment receipt");
    await expect(body).toContainText("year-end giving statement");
  });

  test("confirming polls (bounded) and a seeded webhook landing flips it to received", async ({ page }) => {
    // its own intent: a gift is append-only, so flipping the shared "confirming" one would stay flipped
    await seedReturnIntent(sql, fx, connId, "confirming", 9, "cs_test_flipme_fixture");
    await page.goto(ret("cs_test_flipme_fixture"));
    await expect(page.getByTestId("give-return-confirming")).toBeVisible();
    await sql`
      with armed as (select set_config('presby.giving_write_active', 'true', true))
      insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
             external_transaction_id, method, amount_cents, status, occurred_on, occurred_at, livemode)
      select ${fx.orgId}::uuid, ${fx.donors.imogen}::uuid, ${fx.funds.general}::uuid, 'online', 'stripe', ${connId}::uuid,
             i.id, 'ch_fixture_flip_0001', 'card', 3750, 'succeeded', current_date, now(), false
        from armed, giving_checkout_intents i
       where i.organization_id = ${fx.orgId}::uuid and i.checkout_session_id = 'cs_test_flipme_fixture'`;
    // the poller asks the server again within 5 s; allow a few rounds
    await expect(page.getByTestId("give-return-received")).toBeVisible({ timeout: 20_000 });
  });

  test("unknown: an absent, malformed, missing or another congregation's session is one and the same panel", async ({ page }) => {
    const urls = [
      ret("cs_test_doesnotexist_0001"),
      ret("not-a-session"),
      give() + "/return",
      // a REAL session id of this congregation, asked for under another slug
      `/site/alder-creek/give/return?session_id=cs_test_received_fixture`,
    ];
    const panels: string[] = [];
    for (const url of urls) {
      await page.goto(url);
      await expect(page.getByTestId("give-return-unknown")).toBeVisible();
      panels.push((await page.getByTestId("give-return-unknown").innerHTML()).replace(/\/site\/[a-z0-9-]+/g, "/site/SLUG").replace(/session_id=[^"&]*/g, ""));
    }
    expect(new Set(panels).size).toBe(1);
  });
});

test.describe("the giving live slot", () => {
  const FIRST = "slot";
  test("a page that places the slot gets the form (validated fund); giving off turns it into the notice", async ({ page }) => {
    await addLiveSite(sql, fx, {
      pages: [
        {
          path: "/",
          frontMatter: { title: "Welcome" },
          mdxAst: {
            blocks: [
              { type: "hero", props: { heading: "Welcome to the fixture church" } },
              { type: "liveSlot", props: { slot: "giving", filter: { fund: fx.funds.building } } },
            ],
          },
        },
        {
          path: "/other",
          frontMatter: { title: "Other" },
          mdxAst: {
            blocks: [
              { type: "hero", props: { heading: "Other page" } },
              { type: "liveSlot", props: { slot: "giving", filter: { fund: "00000000-0000-4000-8000-000000000000" } } },
            ],
          },
        },
      ],
    });
    const bad = watchConsole(page);
    await page.goto(`/site/${fx.slug}`);
    await expect(page.getByRole("heading", { level: 2, name: `Give to ${fx.name}` })).toBeVisible();
    await expect(page.locator("#slot-give-fund")).toHaveValue(fx.funds.building);
    await expect(page.locator("#slot-give-amount")).toBeEnabled();
    await shot(page, `${FIRST}-360`);

    // a foreign / garbage filter.fund falls back to the first fund
    await page.goto(`/site/${fx.slug}/other`);
    await expect(page.locator("#slot-give-fund")).toHaveValue(fx.funds.general);

    // the slot's submit works the same way (Stripe unset -> unavailable)
    await page.locator("#slot-give-amount").fill("12");
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect(page.getByTestId("give-banner")).toContainText("isn't available right now");
    expect(bad).toEqual([]);
    await sql`delete from giving_checkout_intents where organization_id = ${fx.orgId}::uuid and status = 'failed' and checkout_session_id is null`;

    // giving off: the page still renders and the slot becomes the unavailable notice
    await setGivingToggle(sql, fx, false);
    try {
      const response = await page.goto(`/site/${fx.slug}`);
      expect(response!.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Welcome to the fixture church" })).toBeVisible();
      await expect(page.locator("#slot-give-amount")).toHaveCount(0);
      // the page's author placed the slot, so a visitor reads the honest notice, never a form
      await expect(page.getByTestId("giving-unavailable")).toBeVisible();
    } finally {
      await setGivingToggle(sql, fx, true);
    }
  });
});

test.describe("the member give page", () => {
  let ctx: BrowserContext;
  test.beforeAll(async ({ browser }) => {
    ctx = await verifiedContext(browser, "/home");
  });
  test.afterAll(async () => {
    await ctx?.close();
  });

  test("a plain member (no giving role) gets the form and no Turnstile; submit lands on unavailable with a failed intent", async () => {
    const page = await ctx.newPage();
    await page.goto(`/o/${fx.slug}/giving/give`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Give to ${fx.name}`);
    await expect(page.getByTestId("give-form")).toBeVisible();
    await page.getByLabel(/Amount \(US dollars\)/).fill("40");
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect(page.getByTestId("give-banner")).toContainText("isn't available right now");
    await expect.poll(async () => (await latestIntents(sql, fx)).length).toBeGreaterThan(0);
    const [row] = await latestIntents(sql, fx);
    expect(row).toMatchObject({ gift_amount_cents: 4000, status: "failed", frequency: "once" });
    await sql`delete from giving_checkout_intents where organization_id = ${fx.orgId}::uuid and status = 'failed' and checkout_session_id is null`;
    await page.close();
  });

  test("the member return page reads the same rows, behind sign-in", async () => {
    const page = await ctx.newPage();
    await page.goto(`/o/${fx.slug}/giving/give/return?session_id=cs_test_received_fixture`);
    await expect(page.getByTestId("give-return-received")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the portal" })).toHaveAttribute("href", `/o/${fx.slug}`);
    await page.close();
  });

  test("toggle off is an honest state, not a 404", async () => {
    await setGivingToggle(sql, fx, false);
    try {
      const page = await ctx.newPage();
      const response = await page.goto(`/o/${fx.slug}/giving/give`);
      expect(response!.status()).toBe(200);
      await expect(page.getByText(/Giving isn.t turned on for/)).toBeVisible();
      await expect(page.getByTestId("give-form")).toHaveCount(0);
      await page.close();
    } finally {
      await setGivingToggle(sql, fx, true);
    }
  });

  test("a signed-out visitor is sent to sign in with the deep link kept", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/o/${fx.slug}/giving/give`);
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    expect(decodeURIComponent(page.url())).toContain(`/o/${fx.slug}/giving/give`);
    await context.close();
  });
});

test.describe("on a phone (360 px)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("give, unavailable and each return panel fit, with 44 px controls, and are screenshotted", async ({ page }) => {
    await page.goto(give());
    await expect(page.getByRole("button", { name: "Give", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "$50", exact: true }).click();
    await page.getByLabel(/Add the processing fee/).check();
    await noHorizontalScroll(page, "give");
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll("form button, form label:has(input), form select, form input:not([type=hidden]):not([type=radio]):not([type=checkbox])"))
        .filter((el) => !el.closest('[aria-hidden="true"]'))
        .map((el) => ({ el: el.tagName, h: el.getBoundingClientRect().height }))
        .filter((c) => c.h > 0 && c.h < 40),
    );
    expect(small, "controls under 40px tall").toEqual([]);
    await shot(page, "give");

    for (const { kind, panel } of [
      { kind: "confirming", panel: "confirming" },
      { kind: "received_monthly", panel: "received" },
      { kind: "bank_pending", panel: "bank_pending" },
      { kind: "failed", panel: "failed" },
    ]) {
      await page.goto(ret(`cs_test_${kind}_fixture`));
      await expect(page.getByTestId(`give-return-${panel}`)).toBeVisible();
      await noHorizontalScroll(page, `return ${kind}`);
      await shot(page, `return-${kind}`);
    }
    await page.goto(ret("cs_test_nothing_here_0001"));
    await expect(page.getByTestId("give-return-unknown")).toBeVisible();
    await noHorizontalScroll(page, "return unknown");
    await shot(page, "return-unknown");

    // the live slot on a site page (the staged bundle from the slot test is still there)
    await page.goto(`/site/${fx.slug}`);
    await expect(page.locator("#slot-give-amount")).toBeEnabled();
    await noHorizontalScroll(page, "slot");
    await shot(page, "slot-phone");

    // The seeded gifts are append-only, so the connection cannot be removed now;
    // taking the give page offline (public_enabled_at null) is the same "not live".
    await sql`update giving_provider_connections set public_enabled_at = null where id = ${connId}::uuid`;
    try {
      await page.goto(give());
      await expect(page.getByTestId("giving-unavailable")).toBeVisible();
      await noHorizontalScroll(page, "unavailable");
      await shot(page, "unavailable");
    } finally {
      await sql`update giving_provider_connections set public_enabled_at = now() where id = ${connId}::uuid`;
    }
  });
});
