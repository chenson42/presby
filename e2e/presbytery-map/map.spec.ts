/**
 * map.spec.ts - the presbytery dashboard's congregation map (DECISION-343,
 * docs/work-log/2026-11-17-presbytery-dashboard-map.md, Phase 3 "New e2e").
 *
 * Runs in its OWN lane (`npm run test:e2e:map`, PW_MAP=1): the config starts a dev server of its own
 * on the port of E2E_BASE_URL with a FAKE `NEXT_PUBLIC_MAPTILER_KEY` (a made-up value, never a real
 * key), because the map exists only when a key is set and a key on the shared server would turn it on
 * for every spec. Every request to `https://api.maptiler.com/**` is INTERCEPTED here with a 1x1 PNG
 * (and an SVG for the logo), so nothing reaches the provider.
 *
 * Staging. The e2e presbytery's congregations carry no coordinates unless this spec puts them there:
 * through the owner connection it upserts coordinates for alpha (score 2) and beta (score 1), leaves
 * gamma unplaced, and in `afterAll` puts every row back exactly as it found it (updating a row that
 * existed, deleting only a row it inserted). Flags are set through `captureFlags`/`setFlag` and
 * restored: `org_portal.insights` and `org_portal.oversight` (the CI reset file seeds the first false).
 *
 * Who is who: `presbytery-clerk` holds all four report keys (and so the map); `org-multi` holds
 * `statistics.manage` only (the Viability section is locked: no map, no coordinates, no tile request).
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { storageStatePath } from "../support/users";
import { E2E_ORGS } from "../support/seed-orgs";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";

const INSIGHTS = "org_portal.insights";
const OVERSIGHT = "org_portal.oversight";

const SLUG = E2E_ORGS.presbytery.slug;
const PAGE = `/o/${SLUG}/admin/insights`;
const KEY = "e2e-fake-map-key-0001"; // leak-ok: the made-up value playwright.config.ts gives this lane's server
const TILE_PREFIX = "https://api.maptiler.com/maps/streets-v4/256/";

const ALPHA = { id: E2E_ORGS.alpha.id, name: E2E_ORGS.alpha.name, lat: "39.9612", lng: "-82.9988", score: 2, label: "Fair" };
const BETA = { id: E2E_ORGS.beta.id, name: E2E_ORGS.beta.name, lat: "40.1031", lng: "-83.1501", score: 1, label: "At risk" };
const GAMMA = { id: E2E_ORGS.gamma.id, name: E2E_ORGS.gamma.name };

// A 1x1 transparent PNG and a tiny SVG: enough for the browser to decode a tile and a logo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="#888"/></svg>';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Answers every call to the provider locally and records the URLs asked for. */
async function mockProvider(target: Page | BrowserContext, opts: { tileStatus?: number } = {}): Promise<string[]> {
  const urls: string[] = [];
  await target.route("https://api.maptiler.com/**", async (route) => {
    const url = route.request().url();
    urls.push(url);
    if (url.includes("/resources/logo.svg")) {
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: SVG });
    } else if (opts.tileStatus && opts.tileStatus !== 200) {
      await route.fulfill({ status: opts.tileStatus, contentType: "text/plain", body: "denied" });
    } else {
      await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    }
  });
  return urls;
}

/** Records, without answering, every request the page makes to the provider. */
function watchProvider(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.url().startsWith("https://api.maptiler.com")) urls.push(req.url());
  });
  return urls;
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}


/**
 * Opens the one pin's popup and asks, by `elementFromPoint` at the LEFT EDGE of each part, what is topmost there.
 * Anything but the popup's own element (Leaflet's zoom control is z-index 800, the popup pane 700) means a tap on
 * the start of that part lands on the wrong control. Also asks that the popup sits whole inside the viewport and
 * that its close button is the topmost thing at its own centre. Polled: the pan that brings the popup into view
 * animates.
 */
async function openSinglePinPopup(page: Page, touch: boolean) {
  const pin = page.getByRole("button", { name: `${ALPHA.name}, ${ALPHA.label}` });
  await expect(pin).toHaveCount(1);
  if (touch) await pin.tap();
  else await pin.click();
  await expect(page.locator(".leaflet-popup")).toBeVisible();
  // Let the autopan finish: the popup's box stops moving.
  await expect
    .poll(async () => {
      const a = await page.locator(".leaflet-popup").boundingBox();
      await page.waitForTimeout(350);
      const b = await page.locator(".leaflet-popup").boundingBox();
      return !!a && !!b && a.x === b.x && a.y === b.y;
    })
    .toBe(true);
}

async function popupClearance(page: Page) {
  return page.evaluate(() => {
    const topmostIsPopup = (el: Element, label: string) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 2, r.top + r.height / 2);
      return { label, ok: !!hit && !!hit.closest(".leaflet-popup"), hit: hit ? `${hit.tagName}.${hit.className}` : "none" };
    };
    const popup = document.querySelector(".leaflet-popup") as HTMLElement;
    const parts = [
      topmostIsPopup(popup.querySelector(".presby-popup-name")!, "name"),
      topmostIsPopup(popup.querySelector(".presby-popup-rating")!, "rating"),
      topmostIsPopup(popup.querySelector(".presby-popup-link")!, "link"),
    ];
    const close = popup.querySelector(".leaflet-popup-close-button") as HTMLElement;
    const cr = close.getBoundingClientRect();
    const closeHit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
    const pr = popup.querySelector(".leaflet-popup-content-wrapper")!.getBoundingClientRect();
    return {
      parts,
      closeIsTopmost: !!closeHit && close.contains(closeHit),
      onScreen: pr.left >= 0 && pr.right <= window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe.configure({ timeout: 90_000 });

test.describe.serial("Presbytery dashboard map (2026-11-17-presbytery-dashboard-map)", () => {
  let sql: Sql;
  let flags: FlagCapture;
  let clerkUserId: string;
  let rosterCount: number;
  type Prior = { viability_score: number | null; latitude: string | null; longitude: string | null } | null;
  const priors = new Map<string, Prior>();

  async function stage(orgId: string, score: number | null, lat: string | null, lng: string | null) {
    await sql`
      insert into congregation_oversight (organization_id, about_org_id, viability_score, latitude, longitude, updated_by)
      values (${E2E_ORGS.presbytery.id}::uuid, ${orgId}::uuid, ${score}, ${lat}::numeric, ${lng}::numeric, ${clerkUserId}::uuid)
      on conflict (organization_id, about_org_id)
      do update set viability_score = excluded.viability_score, latitude = excluded.latitude, longitude = excluded.longitude
    `;
  }
  const stageAlphaBeta = async () => {
    await stage(ALPHA.id, ALPHA.score, ALPHA.lat, ALPHA.lng);
    await stage(BETA.id, BETA.score, BETA.lat, BETA.lng);
    await clearGamma();
  };
  async function clearGamma() {
    await sql`
      update congregation_oversight set latitude = null, longitude = null
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid and about_org_id = ${GAMMA.id}::uuid
    `;
  }
  async function clearAll() {
    await sql`
      update congregation_oversight set latitude = null, longitude = null
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid
    `;
  }

  test.beforeAll(async () => {
    sql = platformSql("presbytery-map.spec");
    flags = await captureFlags(sql, [INSIGHTS, OVERSIGHT]);
    await setFlag(sql, INSIGHTS, true);
    await setFlag(sql, OVERSIGHT, true);

    clerkUserId = ((await sql`select id from users where email = 'presbytery-clerk@presby.invalid'`) as { id: string }[])[0].id;
    rosterCount = ((await sql`
      select count(*)::int as n from organizations
       where parent_id = ${E2E_ORGS.presbytery.id}::uuid and organization_type = 'congregation' and lifecycle_status = 'active'
    `) as { n: number }[])[0].n;

    for (const id of [ALPHA.id, BETA.id, GAMMA.id]) {
      const rows = (await sql`
        select viability_score, latitude::text as latitude, longitude::text as longitude
          from congregation_oversight
         where organization_id = ${E2E_ORGS.presbytery.id}::uuid and about_org_id = ${id}::uuid
      `) as NonNullable<Prior>[];
      priors.set(id, rows[0] ?? null);
    }
    await stageAlphaBeta();
  });

  test.afterAll(async () => {
    for (const [id, prior] of priors) {
      if (prior) {
        await sql`
          update congregation_oversight
             set viability_score = ${prior.viability_score}, latitude = ${prior.latitude}::numeric, longitude = ${prior.longitude}::numeric
           where organization_id = ${E2E_ORGS.presbytery.id}::uuid and about_org_id = ${id}::uuid
        `;
      } else {
        await sql`delete from congregation_oversight where organization_id = ${E2E_ORGS.presbytery.id}::uuid and about_org_id = ${id}::uuid`;
      }
    }
    await flags.restore();
  });

  test("1. the clerk sees the map: the caption, the unplaced list, the legend, the attribution, and tile requests that carry only the key", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    const urls = await mockProvider(page);
    await page.goto(PAGE);

    await expect(page.getByRole("heading", { level: 2, name: "Congregation map" })).toBeVisible();
    await expect(page.getByTestId("dashboard-map-caption")).toHaveText(`2 of ${rosterCount} congregations have a location.`);
    const unplaced = page.getByTestId("dashboard-map-unplaced");
    await expect(unplaced.getByRole("heading", { name: "Not on the map" })).toBeVisible();
    await expect(unplaced).toContainText(GAMMA.name);
    await expect(unplaced).not.toContainText(ALPHA.name);
    await expect(unplaced).not.toContainText(BETA.name);

    const region = page.getByRole("region", { name: /viability list below gives the same ratings as text/ });
    await expect(region).toBeVisible();
    for (const word of ["At risk: diamond", "Fair: square", "Healthy: circle", "Not yet assessed: hollow circle"]) {
      await expect(region.getByText(word)).toBeVisible();
    }
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await expect(page.getByRole("button", { name: `${ALPHA.name}, ${ALPHA.label}` })).toHaveCount(1);
    await expect(page.getByRole("button", { name: `${BETA.name}, ${BETA.label}` })).toHaveCount(1);

    // The provider is asked for tiles, on the one host, and the URL carries the key and the z/x/y and nothing else.
    await expect.poll(() => urls.filter((u) => u.includes("/maps/")).length).toBeGreaterThan(0);
    for (const url of urls.filter((u) => u.includes("/maps/"))) {
      expect(url.startsWith(TILE_PREFIX), url).toBe(true);
      expect(url, url).toMatch(/\/\d+\/\d+\/\d+\.png\?key=e2e-fake-map-key-0001$/);
      for (const secret of [SLUG, ALPHA.id, BETA.id, GAMMA.id, ALPHA.name, BETA.name, GAMMA.name, "e2e-alpha", "oversight"]) {
        expect(url).not.toContain(encodeURIComponent(secret));
        expect(url).not.toContain(secret);
      }
    }
    expect(urls.every((u) => u.startsWith("https://api.maptiler.com/"))).toBe(true);
    await expect(page.locator("img.leaflet-tile").first()).toBeAttached();

    // Attribution and the logo are real links with rel.
    const maptiler = page.getByRole("link", { name: "© MapTiler" });
    const osm = page.getByRole("link", { name: "© OpenStreetMap contributors" });
    const logo = page.getByRole("link", { name: "MapTiler logo" });
    await expect(maptiler).toHaveAttribute("href", "https://www.maptiler.com/copyright/");
    await expect(osm).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    await expect(logo).toHaveAttribute("href", "https://www.maptiler.com/");
    for (const link of [maptiler, osm, logo]) await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await context.close();
  });

  test("2. Tab reaches a pin and Enter opens a text popup; the oversight link follows the oversight flag", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await mockProvider(page);
    await page.goto(PAGE);
    await expect(page.locator(".leaflet-container")).toBeVisible();

    // Tab from the map itself lands on a pin.
    await page.locator(".presby-map__canvas").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".leaflet-marker-icon:focus")).toHaveCount(1);

    // A named pin: focus it and press Enter.
    const alphaPin = page.getByRole("button", { name: `${ALPHA.name}, ${ALPHA.label}` });
    await alphaPin.focus();
    await page.keyboard.press("Enter");
    const popup = page.locator(".leaflet-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(ALPHA.name);
    await expect(popup).toContainText(`Viability: ${ALPHA.label}`);
    await expect(popup.getByRole("link", { name: "Open oversight page" })).toHaveAttribute("href", `/o/${SLUG}/admin/oversight/${ALPHA.id}`);
    await context.close();

    // Oversight off: the popup is text only and the unplaced names are not links.
    await setFlag(sql, OVERSIGHT, false);
    try {
      const off = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
      const offPage = await off.newPage();
      await mockProvider(offPage);
      await offPage.goto(PAGE);
      await offPage.getByRole("button", { name: `${ALPHA.name}, ${ALPHA.label}` }).focus();
      await offPage.keyboard.press("Enter");
      const offPopup = offPage.locator(".leaflet-popup");
      await expect(offPopup).toContainText(ALPHA.name);
      await expect(offPopup.getByRole("link")).toHaveCount(0);
      await expect(offPage.getByTestId("dashboard-map-unplaced").getByRole("link")).toHaveCount(0);
      await expect(offPage.getByTestId("dashboard-map-unplaced")).toContainText(/isn't turned on for/);
      await off.close();
    } finally {
      await setFlag(sql, OVERSIGHT, true);
    }
  });

  test("3. with no coordinates the section is the prompt, and no tile request is made and the key is not in the page", async ({ browser }) => {
    await clearAll();
    try {
      const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
      const page = await context.newPage();
      const asked = watchProvider(page);
      await page.goto(PAGE);

      await expect(page.getByRole("heading", { level: 2, name: "Congregation map" })).toBeVisible();
      await expect(page.getByText("No congregation has a usable location yet.")).toBeVisible();
      await expect(page.getByTestId("dashboard-map-empty").getByRole("link", { name: "Open Congregation Oversight" })).toHaveAttribute(
        "href",
        `/o/${SLUG}/admin/oversight`,
      );
      await expect(page.locator(".leaflet-container")).toHaveCount(0);
      await page.waitForTimeout(1000);
      expect(asked).toEqual([]);
      expect(await page.content()).not.toContain(KEY);
      await context.close();
    } finally {
      await stageAlphaBeta();
    }
  });

  test("4. when every tile is refused the map collapses to one line and the viability list still renders", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await mockProvider(page, { tileStatus: 403 });
    await page.goto(PAGE);

    await expect(page.getByText(/The map could not load\. The list below has every congregation\./)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-viability-table").getByText(ALPHA.name)).toBeVisible();
    // The server-rendered parts stay true when the tiles fail.
    await expect(page.getByTestId("dashboard-map-caption")).toHaveText(`2 of ${rosterCount} congregations have a location.`);
    await context.close();
  });

  test("5. a viewer without the viability key sees no map, no coordinates, no key and makes no tile request", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-multi") });
    const page = await context.newPage();
    const asked = watchProvider(page);
    await page.goto(PAGE);

    await expect(page.getByRole("heading", { name: "Ending active members" })).toBeVisible();
    await expect(page.getByTestId("dashboard-viability")).toContainText("manage congregation oversight");
    await expect(page.getByRole("heading", { name: "Congregation map" })).toHaveCount(0);
    await expect(page.getByTestId("dashboard-map")).toHaveCount(0);
    await page.waitForTimeout(1000);
    const html = await page.content();
    for (const secret of [ALPHA.lat, ALPHA.lng, BETA.lat, BETA.lng, KEY, "maptiler"]) expect(html).not.toContain(secret);
    expect(asked).toEqual([]);
    await context.close();
  });

  test("6. [360px, touch] no overflow; one finger scrolls the page past the map; the account menu draws above the map", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 740 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await mockProvider(page);
    await page.goto(PAGE);

    const canvas = page.locator(".presby-map__canvas");
    await expect(canvas).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);

    // The +/- buttons are 44px targets.
    for (const sel of [".leaflet-control-zoom-in", ".leaflet-control-zoom-out"]) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // The legend wraps rather than overflowing.
    await expect(page.getByTestId("dashboard-map-unplaced")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // One finger scrolls the page, not the map. With dragging off on a coarse pointer, Leaflet gives the
    // container `touch-action: pan-x pan-y` (its `leaflet-touch-zoom` rule, without `leaflet-touch-drag`),
    // so the browser keeps one-finger pans for the page and only a pinch reaches the map. Asserted on the
    // computed style rather than with a synthesized swipe: CDP's touch scroll gesture did not scroll at all
    // on CI's headless Chromium (PR #89), on either the old or the fixed code, so it proved nothing there.
    // `dragging: true` turns this into `none` (Leaflet's `leaflet-touch-drag` rule), which fails here.
    const touch = await page.evaluate(() => {
      const el = document.querySelector(".presby-map__canvas .leaflet-container, .presby-map__canvas.leaflet-container") as HTMLElement;
      const chain: string[] = [];
      for (let n: HTMLElement | null = el?.parentElement ?? null; n; n = n.parentElement) {
        const ta = getComputedStyle(n).touchAction;
        if (ta !== "auto") chain.push(ta);
      }
      return { found: !!el, own: el ? getComputedStyle(el).touchAction : "", drag: !!el?.classList.contains("leaflet-touch-drag"), ancestors: chain };
    });
    expect(touch.found).toBe(true);
    expect(touch.drag).toBe(false);
    expect(touch.own).toBe("pan-x pan-y");
    expect(touch.ancestors).toEqual([]);

    // The account menu (the one overlay a phone has on this page) draws ABOVE the map. Pull the map up under
    // the open menu (positioned, with no stacking context of its own on the way, so the map's own isolation is
    // what is under test) and ask what is topmost where they overlap. Without `isolate`, Leaflet's panes
    // (z-index up to 1000) would paint over the menu's z-50.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("avatar-menu-trigger").click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    await page.evaluate(
      ({ menuTop }) => {
        const section = document.querySelector('[data-testid="dashboard-map"]') as HTMLElement;
        const canvasEl = document.querySelector(".presby-map__canvas") as HTMLElement;
        const top = canvasEl.getBoundingClientRect().top + window.scrollY;
        section.style.position = "relative";
        section.style.top = `${-(top - (menuTop + 20))}px`;
      },
      { menuTop: menuBox.y },
    );
    // An open Radix menu sets pointer-events: none on the body, and `elementFromPoint` skips such elements, which
    // would make the question vacuous. Give the map's own elements pointer events back so only PAINT ORDER decides.
    await page.addStyleTag({ content: ".presby-map, .presby-map * { pointer-events: auto !important; }" });
    const canvasBox = (await canvas.boundingBox())!;
    const overlapX = Math.round(Math.max(menuBox.x, canvasBox.x) + 40);
    const overlapY = Math.round(Math.max(menuBox.y, canvasBox.y) + 10);
    expect(overlapY).toBeLessThan(Math.min(menuBox.y + menuBox.height, canvasBox.y + canvasBox.height));
    const topmostIsMenu = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'), [overlapX, overlapY]);
    expect(topmostIsMenu).toBe(true);
    await context.close();
  });

  test("7. the loop: enter a pair on the oversight form, read the toast, then find the pin on Insights", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await mockProvider(page);

    await page.goto(`/o/${SLUG}/admin/oversight/${GAMMA.id}`);
    await expect(page.locator("#oversight-latitude")).toBeEnabled();
    await page.locator("#oversight-latitude").fill("39.7");
    await page.locator("#oversight-longitude").fill("-83.2");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Oversight record saved.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Congregations with a location are shown on the map in Insights & Analytics.")).toBeVisible();

    await page.goto(PAGE);
    await expect(page.getByTestId("dashboard-map-caption")).toHaveText(`3 of ${rosterCount} congregations have a location.`);
    await expect(page.getByRole("button", { name: new RegExp(`^${escapeRe(GAMMA.name)}, `) })).toHaveCount(1);
    // gamma was the only congregation without a location, so the "Not on the map" list is gone.
    await expect(page.getByTestId("dashboard-map-unplaced")).toHaveCount(rosterCount === 3 ? 0 : 1);
    await context.close();
  });
  for (const vp of [
    { label: "360px", width: 360, height: 740, touch: true },
    { label: "390px", width: 390, height: 844, touch: true },
    { label: "desktop", width: 1280, height: 800, touch: false },
  ]) {
    test(`8. [${vp.label}] the single-pin popup is not covered by a map control: name, rating, link and close all take their own taps — regression for the zoom control over the popup`, async ({ browser }) => {
      // One pin only (the common first state): beta (and gamma, which the loop case above placed) are unplaced.
      await stage(BETA.id, BETA.score, null, null);
      await clearGamma();
      try {
        const context = await browser.newContext({
          storageState: storageStatePath("presbytery-clerk"),
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2,
          hasTouch: vp.touch,
          isMobile: vp.touch,
        });
        const page = await context.newPage();
        await mockProvider(page);
        await page.goto(PAGE);
        await expect(page.locator(".leaflet-container")).toBeVisible();
        await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

        await openSinglePinPopup(page, vp.touch);
        const r = await popupClearance(page);
        for (const part of r.parts) expect(part.ok, `${part.label} left edge is topmost-in-popup, got ${part.hit}`).toBe(true);
        expect(r.closeIsTopmost, "the close button takes its own tap").toBe(true);
        expect(r.onScreen, "the popup is inside the viewport").toBe(true);
        expect(r.overflow).toBeLessThanOrEqual(0);

        // A tap on the link's first pixels follows the link (it does not zoom out).
        const link = page.locator(".leaflet-popup .presby-popup-link");
        const box = (await link.boundingBox())!;
        await Promise.all([
          page.waitForURL(`**/admin/oversight/${ALPHA.id}`),
          vp.touch ? page.touchscreen.tap(box.x + 2, box.y + box.height / 2) : page.mouse.click(box.x + 2, box.y + box.height / 2),
        ]);
        await context.close();
      } finally {
        await stageAlphaBeta();
      }
    });
  }
});
