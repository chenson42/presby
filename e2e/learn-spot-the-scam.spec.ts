/**
 * learn-spot-the-scam.spec.ts - Spot the scam on the PLATFORM host and in the (org) portal
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "E2E plan"; DECISION-330 to 336). The same page on a
 * church's own domain is e2e/custom-domains/learn-spot-the-scam.spec.ts; the pre-hydration guard is
 * e2e/hydration/learn-spot-the-scam.spec.ts.
 *
 * Creates only its own rows (a throwaway `e2e-learn-<stamp>` congregation and an `e2e-learn-pres-<stamp>`
 * presbytery, removed in afterAll and confirmed by SELECT; DECISION-157). Every global flag it moves is
 * captured and restored through e2e/support/flags.ts (`sites.public_render`, `org_portal.home_v2`,
 * `org_portal.features`, `org_portal.feature_categories`); none is added to scripts/ci/e2e-baseline-flags.sql.
 *
 * The signed-in actor is the `mfa-enrolled` fixture, who completes a REAL TOTP challenge once
 * (`verifiedContext`); the actor's Features role is swapped in the database between tests (permissions are
 * read live). Public pages are fetched anonymously.
 *
 * What only a real browser can say, and this spec says: the island makes NO request after it has hydrated
 * (the "nothing sent, nothing stored" promise), no response sets a cookie, focus lands where the design says,
 * the keyboard operates every control, nothing scrolls sideways at 360px, the answer buttons are 44px tall
 * and stack, and print media hides the practice and keeps the rules.
 */

import { test, expect, type BrowserContext, type Page, type Request } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import { verifiedContext } from "./support/giving-fixture";
import { rawGet, setBrand, shape } from "./support/custom-hosts";
import {
  LEARN_TOGGLE_KEY,
  learnToggleAuditRows,
  removeLearnFixture,
  setActingRole,
  setLearnCategory,
  setLearnSiteStatus,
  setLearnToggle,
  setOrgName,
  setSiteBundle,
  setupLearnFixture,
  LEARN_NAMES,
  type LearnFixture,
  type LearnOrg,
} from "./support/learn-fixture";
import { SCENARIOS } from "../src/lib/learn/spot-the-scam/content";
import { RULES } from "../src/lib/learn/spot-the-scam/content";

// `org_portal.chrome_v2` is what renders the portal's own nav row (where the "Learn" entry lives); the design's
// list omitted it because it did not yet assert the nav entry from a real browser.
const FLAGS = ["sites.public_render", "org_portal.home_v2", "org_portal.chrome_v2", "org_portal.feature_categories", "org_portal.features"];
const TOTAL = SCENARIOS.length;

const UNAVAILABLE = "Our scam-spotting practice isn't available right now. Please check back soon.";

let sql: Sql;
let flags: FlagCapture;
let fx: LearnFixture;
let ctx: BrowserContext;

const pub = (org: { slug: string }, path: string) => `/site/${org.slug}${path}`;
const trainerPath = (org: { slug: string }) => pub(org, "/learn/spot-the-scam");
const portalPath = (org: LearnOrg) => `/o/${org.slug}/learn/spot-the-scam`;

async function noHorizontalScroll(page: Page, width: number) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw, `scrollWidth ${m.sw} vs viewport ${width}`).toBeLessThanOrEqual(width);
}

/** Console errors a page logs while the test runs. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Waits until the island has hydrated (its first control is enabled: the HydrationGate's own signal). */
async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: "Looks genuine" }).first()).toBeEnabled({ timeout: 30_000 });
}

/** Answers message `i` correctly (or not), checks the reveal and focus, then advances. */
async function playOne(page: Page, i: number, correct: boolean) {
  const s = SCENARIOS[i]!;
  await expect(page.getByRole("heading", { level: 3, name: `Message ${i + 1} of ${TOTAL}` })).toBeVisible();
  const guessScam = correct ? s.isScam : !s.isScam;
  await page.getByRole("button", { name: guessScam ? "Something's off" : "Looks genuine" }).click();
  const verdict = page.getByRole("heading", { level: 4 });
  await expect(verdict).toContainText(correct ? "Right." : "Not quite.");
  await expect(verdict).toContainText(s.verdictTitle);
  // Focus is moved deliberately: the pressed button unmounted, and focus must not fall to <body>.
  await expect(verdict).toBeFocused();
  await expect(page.getByTestId("reveal")).toContainText(s.lesson);
  await expect(page.getByTestId("reveal")).toContainText(s.tells[0]!);
  await page.getByRole("button", { name: i === TOTAL - 1 ? "See your result" : "Next message" }).click();
}

/** Plays all seven; `pattern[i]` is whether message i is answered correctly. */
async function playAll(page: Page, pattern: boolean[]) {
  for (let i = 0; i < TOTAL; i += 1) {
    await playOne(page, i, pattern[i]!);
    if (i < TOTAL - 1) await expect(page.getByRole("heading", { level: 3, name: `Message ${i + 2} of ${TOTAL}` })).toBeFocused();
  }
}

/** Every request a page makes from now on, except (optionally) the router's own prefetches. */
function recordRequests(page: Page, options: { ignorePrefetch?: boolean } = {}): Request[] {
  const seen: Request[] = [];
  page.on("request", (req) => {
    if (options.ignorePrefetch && (req.headers()["next-router-prefetch"] || req.headers()["purpose"] === "prefetch")) return;
    seen.push(req);
  });
  return seen;
}

const describeRequests = (reqs: Request[]) => reqs.map((r) => `${r.method()} ${r.resourceType()} ${r.url()}`);

test.describe.configure({ mode: "serial" });

test.describe("Spot the scam - platform host and the (org) portal", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("learn-spot-the-scam.spec");
    flags = await captureFlags(sql, FLAGS);
    await setFlag(sql, "sites.public_render", true);
    await setFlag(sql, "org_portal.home_v2", true);
    await setFlag(sql, "org_portal.chrome_v2", true);
    await setFlag(sql, "org_portal.features", true);
    await setFlag(sql, "org_portal.feature_categories", false);
    fx = await setupLearnFixture(sql);
    await setActingRole(sql, fx, "manager");
    await setLearnToggle(sql, fx.congregation.orgId, true);
    await setLearnToggle(sql, fx.presbytery.orgId, true);
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (fx) await removeLearnFixture(sql, fx);
    await flags?.restore();
  });

  test.afterEach(async () => {
    // Every test starts from: both toggles on, manager role, the default bundle, live sites, the axis off, no category rows.
    for (const org of [fx.congregation, fx.presbytery]) {
      await setLearnToggle(sql, org.orgId, true);
      await setLearnCategory(sql, org.orgId, null);
      await setSiteBundle(sql, org);
      await setLearnSiteStatus(sql, org, "live");
    }
    await setOrgName(sql, fx.congregation, LEARN_NAMES.congregation);
    await setActingRole(sql, fx, "manager");
    await setFlag(sql, "org_portal.feature_categories", false);
  });

  // -------------------------------------------------------------------------
  test("toggle off: the route is the site's 404, a placed slot says the one notice at 200, the portal page says it isn't turned on, and there is no tile", async ({ page }) => {
    await setLearnToggle(sql, fx.congregation.orgId, null);

    const route = await page.goto(trainerPath(fx.congregation));
    expect(route?.status()).toBe(404);
    await expect(page.getByTestId("trainer")).toHaveCount(0);

    const slot = await page.goto(pub(fx.congregation, "/practice"));
    expect(slot?.status()).toBe(200);
    await expect(page.getByTestId("spot-the-scam-unavailable")).toHaveText(UNAVAILABLE);
    await expect(page.getByTestId("trainer")).toHaveCount(0);

    // Portal: a manager sees the Features link, a non-manager is told who to ask; neither sees the practice.
    const portal = await ctx.newPage();
    await portal.goto(portalPath(fx.congregation));
    const off = portal.getByTestId("learn-off");
    await expect(off).toContainText(`Spot the scam isn't turned on for ${fx.congregation.name} yet.`);
    await expect(off.getByRole("link", { name: "Turn it on under Features" })).toHaveAttribute("href", `/o/${fx.congregation.slug}/admin/features`);
    await expect(off.getByRole("link", { name: "How features are turned on" })).toHaveAttribute("href", "/help/turning-features-on-and-off");
    await expect(portal.getByTestId("trainer")).toHaveCount(0);

    await setActingRole(sql, fx, "none");
    await portal.reload();
    await expect(portal.getByTestId("learn-off")).toContainText(`Ask someone who manages ${fx.congregation.name}'s features to turn it on.`);
    await expect(portal.getByRole("link", { name: "Turn it on under Features" })).toHaveCount(0);

    // No tile, no Learn heading and no Learn nav entry while it is off.
    await portal.goto(`/o/${fx.congregation.slug}`);
    await expect(portal.locator(`a[href="/o/${fx.congregation.slug}/learn/spot-the-scam"]`)).toHaveCount(0);
    await expect(portal.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Learn", exact: true })).toHaveCount(0);
    await portal.close();
  });

  // -------------------------------------------------------------------------
  test("toggle on: a full run through all seven, the focus moves, the score, 'Practice again', the six rules, and print hides the practice", async ({ page }) => {
    const errors = watchConsole(page);
    const response = await page.goto(trainerPath(fx.congregation));
    expect(response?.status()).toBe(200);
    expect(await response?.headerValue("set-cookie")).toBeNull();

    await expect(page.getByRole("heading", { level: 1, name: "Spot the scam" })).toBeVisible();
    await expect(page).toHaveTitle(`Spot the scam | ${fx.congregation.name}`);
    await expect(page.getByRole("link", { name: `Back to ${fx.congregation.name}` })).toHaveAttribute("href", `/site/${fx.congregation.slug}`);
    await expect(page.getByTestId("spot-the-scam-frame")).toContainText("Seven made-up messages follow");
    await expect(page.getByTestId("spot-the-scam-frame")).toContainText("They are never sent or saved.");
    await hydrated(page);
    // Nothing has had focus stolen by the page load.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    // Four right, three wrong, mixed.
    await playAll(page, [true, false, true, true, false, false, true]);
    await expect(page.getByRole("heading", { level: 3, name: `4 of ${TOTAL} correct` })).toBeFocused();
    await expect(page.getByText("Every one you missed here is one you'll catch in real life.")).toBeVisible();
    await expect(page.getByText("The six rules are just below. Your browser's Print command will print them without the practice.")).toBeVisible();

    // The six rules are on the page, outside the practice, in order.
    const rules = page.getByTestId("rules-card").locator("li");
    await expect(rules).toHaveCount(6);
    for (let i = 0; i < RULES.length; i += 1) await expect(rules.nth(i)).toHaveText(RULES[i]!);
    await expect(page.getByRole("heading", { level: 2, name: "The six rules to keep" })).toBeVisible();

    // Print: the practice and the back link are hidden, the six rules stay.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("trainer")).toBeHidden();
    await expect(page.getByRole("link", { name: /^Back to / })).toBeHidden();
    await expect(page.getByTestId("rules-card")).toBeVisible();
    await expect(rules.first()).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    // Practice again resets, and a perfect second run says so.
    await page.getByRole("button", { name: "Practice again" }).click();
    await expect(page.getByRole("heading", { level: 3, name: `Message 1 of ${TOTAL}` })).toBeFocused();
    await expect(page.getByText("0 correct so far")).toBeVisible();
    await playAll(page, [true, true, true, true, true, true, true]);
    await expect(page.getByRole("heading", { level: 3, name: `7 of ${TOTAL} correct` })).toBeVisible();
    await expect(page.getByText("A sharp eye. Now share what you know")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  test("nothing is sent or stored: zero requests after hydration through a whole run, no Set-Cookie, no cookie in the context, no storage", async ({ page }) => {
    const response = await page.goto(trainerPath(fx.congregation));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["set-cookie"], "the document response sets no cookie").toBeUndefined();
    await hydrated(page);
    // A quiet period: any request the page makes on its own after hydrating (a prefetch, a beacon) would land here.
    await page.waitForTimeout(1000);

    const seen = recordRequests(page);
    await playAll(page, [true, true, false, true, false, true, true]);
    await page.getByRole("button", { name: "Practice again" }).click();
    await playOne(page, 0, true);
    await page.waitForTimeout(500);
    expect(describeRequests(seen), "requests made after hydration").toEqual([]);

    const cookies = await page.context().cookies();
    expect(cookies.map((c) => c.name), "an anonymous visitor has no cookie at all").toEqual([]);
    const stored = await page.evaluate(() => ({ local: window.localStorage.length, session: window.sessionStorage.length }));
    expect(stored).toEqual({ local: 0, session: 0 });
  });

  // -------------------------------------------------------------------------
  test("the keyboard operates every control: Enter answers, Space advances, and focus lands on the headings", async ({ page }) => {
    await page.goto(trainerPath(fx.congregation));
    await hydrated(page);
    const first = page.getByRole("button", { name: SCENARIOS[0]!.isScam ? "Something's off" : "Looks genuine" });
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 4 })).toBeFocused();
    await expect(page.getByRole("heading", { level: 4 })).toContainText("Right.");
    // The next control is reachable by Tab from the verdict heading, and Space activates it.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Next message" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("heading", { level: 3, name: `Message 2 of ${TOTAL}` })).toBeFocused();
    // Tab order from the message heading: the two answers, in order.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Looks genuine" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Something's off" })).toBeFocused();
  });

  // -------------------------------------------------------------------------
  test("every organization type: a presbytery gets the route, the practice, and the portal page", async ({ page }) => {
    const response = await page.goto(trainerPath(fx.presbytery));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Spot the scam" })).toBeVisible();
    await hydrated(page);
    await playOne(page, 0, true);

    const portal = await ctx.newPage();
    const org = await portal.goto(portalPath(fx.presbytery));
    expect(org?.status()).toBe(200);
    await expect(portal.getByRole("heading", { level: 1, name: "Spot the scam" })).toBeVisible();
    await hydrated(portal);
    await expect(portal.getByTestId("rules-card")).toBeVisible();
    await portal.close();

    // And the toggle is genuinely per organization: turning the presbytery's off leaves the congregation's on.
    await setLearnToggle(sql, fx.presbytery.orgId, null);
    expect((await page.goto(trainerPath(fx.presbytery)))?.status()).toBe(404);
    expect((await page.goto(trainerPath(fx.congregation)))?.status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  test("the (org) page: zero requests after hydration (router prefetches aside), the leader panel's live address, the tile under Learn and the Learn nav entry", async () => {
    const portal = await ctx.newPage();
    await portal.goto(portalPath(fx.congregation));
    await hydrated(portal);
    await expect(portal.getByRole("heading", { level: 1, name: "Spot the scam" })).toBeVisible();
    await portal.waitForTimeout(1000);

    const seen = recordRequests(portal, { ignorePrefetch: true });
    await playAll(portal, [true, true, true, true, true, false, true]);
    await portal.waitForTimeout(500);
    expect(describeRequests(seen), "requests made after hydration (router prefetches excluded)").toEqual([]);

    // Leader panel: the live public address, built from SiteUrls (the platform origin, the database slug).
    const panel = portal.getByTestId("leader-panel");
    await expect(panel.getByRole("heading", { level: 2, name: "Using this outside the portal" })).toBeVisible();
    await expect(panel.getByTestId("leader-live")).toContainText(`/site/${fx.congregation.slug}/learn/spot-the-scam`);
    const address = await panel.getByRole("link", { name: "Open the public page" }).getAttribute("href");
    expect(address).toMatch(new RegExp(`/site/${fx.congregation.slug}/learn/spot-the-scam$`));
    await expect(panel).toContainText("Whoever maintains your website can also place this on a page.");
    await expect(panel).toContainText("The practice messages were last reviewed on");
    await expect(panel.getByRole("link", { name: "About Spot the scam" })).toHaveAttribute("href", "/help/spot-the-scam");

    // The link the panel names is a page that exists: follow its PATH on this server. (The origin is the
    // validated platform origin from the environment, never the request's, so under a test server on its
    // own port it names the configured origin; fetching that absolute URL could reach another checkout's server.)
    const opened = await portal.request.get(new URL(address!).pathname, { maxRedirects: 0 });
    expect(opened.status()).toBe(200);

    // The tile under "Learn", and the Learn entry in the portal nav, while it is on.
    await portal.goto(`/o/${fx.congregation.slug}`);
    await expect(portal.locator("#domain-learn")).toBeVisible();
    await expect(portal.locator("#domain-learn").getByRole("heading", { name: "Learn" })).toBeVisible();
    await expect(portal.locator(`a[href="/o/${fx.congregation.slug}/learn/spot-the-scam"]`).first()).toBeVisible();
    await expect(portal.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Learn", exact: true })).toBeVisible();

    // A site that is not live: the panel says so instead of naming an address that would 404.
    await setLearnSiteStatus(sql, fx.congregation, "suspended");
    await portal.goto(portalPath(fx.congregation));
    await expect(portal.getByTestId("leader-not-live")).toContainText("Your public website isn't showing right now, so there is no public address to share yet.");
    await expect(portal.getByRole("link", { name: "Open the public page" })).toHaveCount(0);
    // ...and the practice itself still works for a member.
    await hydrated(portal);
    await portal.close();
  });

  // -------------------------------------------------------------------------
  test("the category axis: Learn off is the same 404 and the same notice; with the axis off the row is inert", async ({ page }) => {
    await setFlag(sql, "org_portal.feature_categories", true);
    await setLearnCategory(sql, fx.congregation.orgId, false);

    expect((await page.goto(trainerPath(fx.congregation)))?.status()).toBe(404);
    await page.goto(pub(fx.congregation, "/practice"));
    await expect(page.getByTestId("spot-the-scam-unavailable")).toHaveText(UNAVAILABLE);
    const portal = await ctx.newPage();
    await portal.goto(portalPath(fx.congregation));
    await expect(portal.getByTestId("learn-off")).toContainText(`Spot the scam isn't turned on for ${fx.congregation.name} yet.`);
    await portal.goto(`/o/${fx.congregation.slug}`);
    await expect(portal.locator(`a[href="/o/${fx.congregation.slug}/learn/spot-the-scam"]`)).toHaveCount(0);

    // Axis on, the Learn row back on: it is available again.
    await setLearnCategory(sql, fx.congregation.orgId, true);
    expect((await page.goto(trainerPath(fx.congregation)))?.status()).toBe(200);

    // Axis off: the Learn=false row is inert.
    await setLearnCategory(sql, fx.congregation.orgId, false);
    await setFlag(sql, "org_portal.feature_categories", false);
    expect((await page.goto(trainerPath(fx.congregation)))?.status()).toBe(200);
    await portal.close();
  });

  // -------------------------------------------------------------------------
  test("the neutral 404 is byte-identical for four causes: toggle off, category off, site not live, unknown slug (DECISION-040, DECISION-154)", async ({ request, baseURL }) => {
    const get = (org: { slug: string }) => rawGet(request, baseURL, null, pub(org, "/learn/spot-the-scam"));
    const shapeOf = async (org: { slug: string }) => shape(await get(org), org.slug);

    // 1. toggle off on a live site
    await setLearnToggle(sql, fx.congregation.orgId, null);
    const toggleOff = await shapeOf(fx.congregation);
    // 2. category off (axis on), toggle on
    await setLearnToggle(sql, fx.congregation.orgId, true);
    await setFlag(sql, "org_portal.feature_categories", true);
    await setLearnCategory(sql, fx.congregation.orgId, false);
    const categoryOff = await shapeOf(fx.congregation);
    await setLearnCategory(sql, fx.congregation.orgId, null);
    await setFlag(sql, "org_portal.feature_categories", false);
    // 3. site not live
    await setLearnSiteStatus(sql, fx.congregation, "suspended");
    const notLive = await shapeOf(fx.congregation);
    await setLearnSiteStatus(sql, fx.congregation, "live");
    // 4. no such organization at all
    const unknown = await shapeOf({ slug: "e2e-learn-no-such-congregation" });

    // The control: it IS available when none of those holds.
    expect((await get(fx.congregation)).status()).toBe(200);

    for (const [name, snap] of [["category off", categoryOff], ["site not live", notLive], ["unknown slug", unknown]] as const) {
      expect(snap.status, name).toBe(404);
      expect(snap.headers, `${name}: headers`).toEqual(toggleOff.headers);
      expect(snap.body, `${name}: what a visitor sees`).toBe(toggleOff.body);
    }
    expect(toggleOff.status).toBe(404);
    // And it names nothing: no organization, no feature.
    expect(toggleOff.body).not.toContain("Spot the scam");
    expect(toggleOff.body).not.toContain(fx.congregation.name);
  });

  // -------------------------------------------------------------------------
  test("the bundle wins at exactly /learn/spot-the-scam; /learn and /learn/<other> are the bundle's own; with none they are the neutral 404", async ({ page }) => {
    // The bundle has no trainer page: /learn and /learn/other are its own, the trainer is the platform's.
    expect((await page.goto(pub(fx.congregation, "/learn")))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Our own learn page" })).toBeVisible();
    expect((await page.goto(pub(fx.congregation, "/learn/other")))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Our own other learn page" })).toBeVisible();
    await page.goto(trainerPath(fx.congregation));
    await expect(page.getByTestId("trainer")).toBeVisible();

    // The bundle has its own page at exactly that path: it wins, and no platform practice is shown.
    await setSiteBundle(sql, fx.congregation, { ownTrainerPage: true });
    expect((await page.goto(trainerPath(fx.congregation)))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Our own trainer page" })).toBeVisible();
    await expect(page.getByTestId("trainer")).toHaveCount(0);
    // ...even with the toggle off.
    await setLearnToggle(sql, fx.congregation.orgId, null);
    expect((await page.goto(trainerPath(fx.congregation)))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Our own trainer page" })).toBeVisible();

    // No /learn pages in the bundle at all: they are the site's neutral 404 (nothing is reserved for the platform).
    await setLearnToggle(sql, fx.congregation.orgId, true);
    await setSiteBundle(sql, fx.congregation, { noLearnPages: true });
    expect((await page.goto(pub(fx.congregation, "/learn")))?.status()).toBe(404);
    expect((await page.goto(pub(fx.congregation, "/learn/other")))?.status()).toBe(404);
    // A path BELOW the trainer's is not the platform's either.
    expect((await page.goto(pub(fx.congregation, "/learn/spot-the-scam/extra")))?.status()).toBe(404);
    await page.goto(trainerPath(fx.congregation));
    await expect(page.getByTestId("trainer")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  test("the live slot on a bundle page: the practice renders inside the site, with no h1 of its own; two slots on one page are independent", async ({ page }) => {
    const response = await page.goto(pub(fx.congregation, "/practice"));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Practice" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await hydrated(page);
    await expect(page.getByTestId("rules-card")).toBeVisible();
    // The practice works in the slot too.
    await playOne(page, 0, true);

    await page.goto(pub(fx.congregation, "/practice-twice"));
    await expect(page.getByTestId("trainer")).toHaveCount(2);
    // F-QA-1: no id on the page appears twice (the frame and the rules card are named with aria-label).
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(duplicateIds, "no duplicate id when the slot is placed twice").toEqual([]);
    await expect(page.locator('[data-slot="hydration-gate"]:not([disabled])').first()).toBeVisible({ timeout: 30_000 });
    const [one, two] = [page.getByTestId("trainer").nth(0), page.getByTestId("trainer").nth(1)];
    await one.getByRole("button", { name: SCENARIOS[0]!.isScam ? "Something's off" : "Looks genuine" }).click();
    await expect(one.getByTestId("reveal")).toBeVisible();
    // The second island is still on its first prompt.
    await expect(two.getByTestId("reveal")).toHaveCount(0);
    await expect(two.getByRole("heading", { level: 3, name: `Message 1 of ${TOTAL}` })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  test("the route is indexable (operator ruling 2026-11-11), carries a canonical link and tells iOS not to auto-link", async ({ page }) => {
    await page.goto(trainerPath(fx.congregation));
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots ?? "index").not.toMatch(/noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/site/${fx.congregation.slug}/learn/spot-the-scam$`));
    await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute("content", /telephone=no/);
    // The (org) page is the opposite: noindex.
    const portal = await ctx.newPage();
    await portal.goto(portalPath(fx.congregation));
    await expect(portal.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await portal.close();
  });

  // -------------------------------------------------------------------------
  test("the Features page: a Learn ministry switch and a Spot the scam card; turning it on through the real UI writes the existing audit row", async () => {
    await setFlag(sql, "org_portal.feature_categories", true);
    await setLearnToggle(sql, fx.congregation.orgId, null);
    const page = await ctx.newPage();
    await page.goto(`/o/${fx.congregation.slug}/admin/features`);
    await expect(page.getByRole("heading", { level: 2, name: "Ministry areas" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Learn", exact: true })).toBeVisible();
    const card = page.locator("li", { has: page.getByRole("heading", { level: 3, name: "Spot the scam" }) });
    await expect(card).toContainText("A short practice in spotting scam emails, texts and voicemails, with six rules to keep.");
    await expect(card).toContainText("Answers are never sent or saved. Turning this off hides it everywhere.");

    const before = (await learnToggleAuditRows(sql, fx.congregation.orgId)).length;
    const toggle = page.getByRole("switch", { name: /^Spot the scam, currently off/ });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByText("Spot the scam turned on.")).toBeVisible();
    await expect.poll(async () => (await learnToggleAuditRows(sql, fx.congregation.orgId)).length).toBe(before + 1);
    const rows = await learnToggleAuditRows(sql, fx.congregation.orgId);
    expect(rows.at(-1)!.metadata).toMatchObject({ organizationId: fx.congregation.orgId, featureKey: LEARN_TOGGLE_KEY, enabled: true });
    // And it took effect for the anonymous visitor on the very next request.
    const anon = await ctx.browser()!.newContext();
    const p = await anon.newPage();
    expect((await p.goto(trainerPath(fx.congregation)))?.status()).toBe(200);
    await anon.close();

    // The Learn category off: the card says why it is inert and the switch is disabled.
    await page.getByRole("switch", { name: /^Learn, currently on/ }).click();
    await expect(page.getByText("Learn turned off.")).toBeVisible();
    await expect(page.getByText("Turn on Learn above to enable this.")).toBeVisible();
    await expect(page.getByRole("switch", { name: /^Spot the scam, currently on/ })).toBeDisabled();
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("360px under a dark brand: no sideways scroll on the route, a slot page and the (org) page; 44px stacked buttons; a 120-character name wraps", async ({ browser }) => {
    await setBrand(sql, fx.congregation.orgId, "#14213d");
    await setOrgName(sql, fx.congregation, "N".repeat(120));
    const phone = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await phone.newPage();

    // The platform route.
    await page.goto(trainerPath(fx.congregation));
    await hydrated(page);
    await noHorizontalScroll(page, 360);
    const genuine = await page.getByRole("button", { name: "Looks genuine" }).boundingBox();
    const off = await page.getByRole("button", { name: "Something's off" }).boundingBox();
    expect(genuine!.height, "answer button height").toBeGreaterThanOrEqual(44);
    expect(off!.height).toBeGreaterThanOrEqual(44);
    expect(off!.y, "the two answers stack below sm").toBeGreaterThan(genuine!.y + genuine!.height - 1);
    await expect(page.getByRole("link", { name: /^Back to N+$/ })).toBeVisible();
    // The longest message (the business email) and the voicemail, answered through.
    for (let i = 0; i < TOTAL; i += 1) {
      await page.getByRole("button", { name: "Looks genuine" }).click();
      await noHorizontalScroll(page, 360);
      const next = await page.getByRole("button", { name: i === TOTAL - 1 ? "See your result" : "Next message" }).boundingBox();
      expect(next!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole("button", { name: i === TOTAL - 1 ? "See your result" : "Next message" }).click();
    }
    await noHorizontalScroll(page, 360);

    // A bundle page with the slot. The site-kit's own header (not ours) cannot wrap an unbroken 120-character
    // name, so this step uses the ordinary name; the long name is for the two pages whose headings we own.
    await setOrgName(sql, fx.congregation, LEARN_NAMES.congregation);
    await page.goto(pub(fx.congregation, "/practice"));
    await hydrated(page);
    await noHorizontalScroll(page, 360);

    // The (org) page, in a signed-in context at the same viewport.
    const portal = await ctx.newPage();
    await portal.setViewportSize({ width: 360, height: 780 });
    await setOrgName(sql, fx.congregation, "N".repeat(120));
    await portal.goto(portalPath(fx.congregation));
    await hydrated(portal);
    await noHorizontalScroll(portal, 360);
    // The portal's phone menu carries the Learn entry while it is on.
    await portal.getByRole("button", { name: "Open menu" }).click();
    await expect(portal.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Learn", exact: true })).toBeVisible();
    await noHorizontalScroll(portal, 360);
    await portal.goto(`/o/${fx.congregation.slug}`);
    await noHorizontalScroll(portal, 360);
    await portal.close();
    await phone.close();
  });
});
