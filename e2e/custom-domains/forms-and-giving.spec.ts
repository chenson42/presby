/**
 * forms-and-giving.spec.ts - the two anonymous write paths of the public site, driven by a real
 * browser on a church's own domain (Track F, Batch 1c; docs/work-log/2026-10-19-custom-domains.md:
 * Phase 2 R5, adversarial A10/A11, T13, DECISION-181). Dev lane only: it needs the dev server's
 * `*.invalid` allowance to hydrate (next.config.ts `allowedDevOrigins`).
 *
 *   - the contact form, submitted from `http://www.church-one.invalid:<port>/`, writes ONE message to
 *     ONE's inbox and none to TWO's; a second submit from TWO's host writes to TWO. The Server Action
 *     POST is a response class of its own for the no-`Set-Cookie` rule, and the browser's cookie jar
 *     stays empty. The organization is not a form field: the action's key is bound on the server;
 *   - the give page is served at the clean `/give` of a church's domain with the ENFORCED CSP (T13: the
 *     `headers()` entry matches the incoming path, before the proxy's rewrite), a way back at `/`, no
 *     platform path in any link, HSTS without `includeSubDomains`, and a clean console; a submit from
 *     the church's domain creates the intent for the DATABASE's organization (the key is re-resolved
 *     server-side) and answers honestly "not available" (no Stripe key exists in the suite);
 *   - `/give/return` renders the same panel with clean links and is never redirected, while the slug
 *     URL's `/give` hands off (307) to the church's domain;
 *   - that a lying Host cannot move `success_url` / `cancel_url` is proven WITHOUT Stripe (no key exists in
 *     the suite): give/actions.test.ts and give-session.test.ts run the real `startGiveSession` with spoofed
 *     headers, and `src/lib/giving/donor-origin.db.test.ts` proves the SQL contract (`serving_host`) against
 *     the real database through `presby_app`.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import {
  GIVING_NAMES,
  addLiveSite,
  latestIntents,
  offerFundOnline,
  removeGivingFixture,
  seedReturnIntent,
  setConnection,
  setGivingToggle,
  setupGivingFixture,
  type GivingFixture,
} from "../support/giving-fixture";
import {
  HOSTS,
  TITLES,
  addDomain,
  bundleFor,
  buildWorld,
  getPublicRenderFlag,
  messagesFor,
  originFor,
  rawGet,
  setDomainsToggle,
  setPublicRenderFlag,
  teardownWorld,
  type World,
} from "../support/custom-hosts";

let sql: Sql;
let world: World;
let fx: GivingFixture;
let connId: string;
let originalFlag: boolean;
const GIVING_HOST = "giving-church.invalid";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  sql = platformSql("custom-domains/forms-and-giving.spec");
  originalFlag = await getPublicRenderFlag(sql);
  world = await buildWorld(sql);
  await setPublicRenderFlag(sql, true);

  // A giving-live congregation whose canonical custom host is `giving-church.invalid`.
  fx = await setupGivingFixture(sql);
  await setGivingToggle(sql, fx, true);
  await offerFundOnline(sql, fx, true, "general");
  connId = (await setConnection(sql, fx, { status: "active", publicOn: true, attested: true, livemode: false }))!;
  await addLiveSite(sql, fx, bundleFor("Giving Church Home", "About Giving Church"));
  await setDomainsToggle(sql, fx.orgId, true);
  await addDomain(sql, { orgId: fx.orgId, hostname: GIVING_HOST, role: "canonical", state: "live", token: 7 });
});

test.afterAll(async () => {
  if (sql) {
    await setPublicRenderFlag(sql, originalFlag);
    expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalFlag);
  }
  await teardownWorld(sql, world);
  if (fx) await removeGivingFixture(sql, fx);
});

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => {
    // The dev server replays its own Node warnings (`[DEP0005] ...`) into the browser console; not the page's.
    if (/\(node:\d+\)/.test(m.text())) return;
    if (m.type() === "error" || /content security policy|violates the following/i.test(m.text())) bad.push(m.text());
  });
  page.on("pageerror", (e) => bad.push(e.message));
  return bad;
}

/** The Server Action POSTs a page makes (Next marks them with a `next-action` request header). */
function watchActionPosts(page: Page): Array<{ url: string; setCookie: string | undefined; status: number }> {
  const seen: Array<{ url: string; setCookie: string | undefined; status: number }> = [];
  page.on("response", (res) => {
    const req = res.request();
    if (req.method() === "POST" && req.headers()["next-action"] !== undefined) {
      seen.push({ url: res.url(), setCookie: res.headers()["set-cookie"], status: res.status() });
    }
  });
  return seen;
}

test.describe("the contact form on a church's own domain", () => {
  test("a visitor on ONE's host writes to ONE's inbox only; the action POST sets no cookie; the jar stays empty", async ({ page, context, baseURL }) => {
    const bad = watchConsole(page);
    const posts = watchActionPosts(page);

    await page.goto(`${originFor(HOSTS.oneCanonical, baseURL)}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLES.one);
    // There is no organization field in the DOM for a visitor to edit.
    expect(await page.locator('input[name="__slug"]').count()).toBe(0);
    expect(await page.locator('form input[type="hidden"]').count()).toBe(0);

    await page.getByLabel(/^name$/i).fill("E2E Domains Visitor One");
    await page.getByLabel(/^email$/i).fill("visitor.one@example.invalid");
    await page.getByLabel(/^message$/i).fill("Is there a Wednesday service?");
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page.getByText(/thanks — your message has been sent/i)).toBeVisible();

    expect(posts.length, "the form posts exactly one Server Action").toBe(1);
    expect(new URL(posts[0]!.url).hostname, "the POST stays on the church's domain").toBe(HOSTS.oneCanonical);
    expect(posts[0]!.setCookie, "Set-Cookie on the Server Action POST").toBeUndefined();
    expect(await context.cookies(), "no cookie for any host").toEqual([]);
    expect(bad, "console errors / CSP violations").toEqual([]);

    expect((await messagesFor(sql, world.one.orgId)).map((m) => m.name)).toEqual(["E2E Domains Visitor One"]);
    expect(await messagesFor(sql, world.two.orgId), "TWO's inbox is untouched").toEqual([]);
  });

  test("a visitor on TWO's host writes to TWO's inbox, never ONE's", async ({ page, baseURL }) => {
    await page.goto(`${originFor(HOSTS.two, baseURL)}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLES.two);
    await page.getByLabel(/^name$/i).fill("E2E Domains Visitor Two");
    await page.getByLabel(/^email$/i).fill("visitor.two@example.invalid");
    await page.getByLabel(/^message$/i).fill("Hello from the second church.");
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page.getByText(/thanks — your message has been sent/i)).toBeVisible();

    expect((await messagesFor(sql, world.two.orgId)).map((m) => m.name)).toEqual(["E2E Domains Visitor Two"]);
    expect((await messagesFor(sql, world.one.orgId)).map((m) => m.name)).toEqual(["E2E Domains Visitor One"]);
  });

  test("the form stops working the moment the host stops serving (the action re-resolves its key)", async ({ page, baseURL }) => {
    await page.goto(`${originFor(HOSTS.two, baseURL)}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLES.two);
    await page.getByLabel(/^name$/i).fill("E2E Domains Late Visitor");
    await page.getByLabel(/^email$/i).fill("late@example.invalid");
    await page.getByLabel(/^message$/i).fill("Too late.");

    // Between page load and submit the church's toggle goes off: the bound key no longer resolves.
    await setDomainsToggle(sql, world.two.orgId, false);
    try {
      await page.getByRole("button", { name: /send message/i }).click();
      await expect(page.getByText("This site isn't accepting messages right now.", { exact: true }).first()).toBeVisible();
    } finally {
      await setDomainsToggle(sql, world.two.orgId, true);
    }
    expect((await messagesFor(sql, world.two.orgId)).map((m) => m.name)).toEqual(["E2E Domains Visitor Two"]);
  });
});

test.describe("online giving on a church's own domain", () => {
  test("/give serves the platform's give page at the clean path with the ENFORCED CSP and HSTS without includeSubDomains", async ({ page, baseURL }) => {
    const bad = watchConsole(page);
    const res = await page.goto(`${originFor(GIVING_HOST, baseURL)}/give`);
    expect(res!.status()).toBe(200);
    const headers = res!.headers();
    expect(headers["content-security-policy"], "the enforced policy must reach the clean path (T13)").toContain("form-action 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"]).toBe("max-age=63072000");
    expect(headers["set-cookie"]).toBeUndefined();
    for (const [name, value] of Object.entries(headers)) {
      expect(`${name}: ${value}`, "a Stripe origin in a response header").not.toMatch(/stripe\.com/i);
    }

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Give to ${GIVING_NAMES.org}`);
    await expect(page.getByTestId("give-form")).toBeVisible();
    // The way back is the church's own home, not a platform path.
    const back = page.getByRole("link", { name: new RegExp(`Back to ${GIVING_NAMES.org}`) });
    await expect(back).toHaveAttribute("href", "/");
    for (const href of await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href, href).not.toMatch(/\/site\//);
    }
    expect(bad, "console errors / CSP violations").toEqual([]);
  });

  test("a gift started from the church's domain creates the intent for the DATABASE's organization and answers 'not available' (no Stripe key), with no cookie", async ({ page, context, baseURL }) => {
    const posts = watchActionPosts(page);
    await page.goto(`${originFor(GIVING_HOST, baseURL)}/give`);
    await page.getByLabel(/Amount \(US dollars\)/).fill("40");
    await page.getByRole("button", { name: "Give", exact: true }).click();
    await expect(page.getByTestId("give-banner")).toContainText("isn't available right now");

    expect(posts).toHaveLength(1);
    expect(new URL(posts[0]!.url).hostname).toBe(GIVING_HOST);
    expect(posts[0]!.setCookie, "Set-Cookie on the give action POST").toBeUndefined();
    expect(await context.cookies()).toEqual([]);

    await expect.poll(async () => (await latestIntents(sql, fx)).length).toBeGreaterThan(0);
    const [row] = await latestIntents(sql, fx);
    expect(row).toMatchObject({ gift_amount_cents: 4000, status: "failed", frequency: "once" });
    await sql`delete from giving_checkout_intents where organization_id = ${fx.orgId}::uuid and status = 'failed' and checkout_session_id is null`;
  });

  test("/give/return renders its panel with CLEAN links, and is never redirected", async ({ request, page, baseURL }) => {
    await seedReturnIntent(sql, fx, connId, "received", 1);
    const res = await rawGet(request, baseURL, GIVING_HOST, "/give/return?session_id=cs_test_received_fixture");
    expect(res.status()).toBe(200);
    expect(res.headers()["location"]).toBeUndefined();

    await page.goto(`${originFor(GIVING_HOST, baseURL)}/give/return?session_id=cs_test_received_fixture`);
    await expect(page.getByTestId("give-return-received")).toBeVisible();
    for (const href of await page.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href, href).not.toMatch(/\/site\//);
    }
  });

  test("the slug URL's /give hands off to the church's domain; give/return on the slug URL does not", async ({ request, baseURL }) => {
    const give = await rawGet(request, baseURL, "localhost", `/site/${fx.slug}/give?fund=x`);
    expect(give.status()).toBe(307);
    expect(give.headers()["location"]).toBe(`https://${GIVING_HOST}/give?fund=x`);

    const ret = await rawGet(request, baseURL, "localhost", `/site/${fx.slug}/give/return?session_id=cs_test_received_fixture`);
    expect(ret.status()).toBe(200);
    expect(ret.headers()["location"]).toBeUndefined();
  });

  test("another church's host cannot give for this church: a host that is not serving has no give page", async ({ request, baseURL }) => {
    const res = await rawGet(request, baseURL, HOSTS.unknown, "/give");
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(GIVING_NAMES.org);
  });
});

test.describe("a phone viewport on a church's own domain (360 px)", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the home page, the contact form and the give page do not scroll sideways, and the form controls stay usable", async ({ page, baseURL }) => {
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const [host, path, label] of [
      [HOSTS.oneCanonical, "/", "home"],
      [HOSTS.oneCanonical, "/about", "about"],
      [GIVING_HOST, "/give", "give"],
    ] as const) {
      await page.goto(`${originFor(host, baseURL)}${path}`);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await overflow(), `${label} scrolls sideways at 360px`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `test-results/custom-domains-360/${label}.png`, fullPage: true });
    }
    // The contact form's controls are reachable and a usable tap target (the church site-kit button is 36 px tall at the smallest).
    await page.goto(`${originFor(HOSTS.oneCanonical, baseURL)}/`);
    const box = await page.getByRole("button", { name: /send message/i }).boundingBox();
    expect(box, "send button is rendered").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });
});

