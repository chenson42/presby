/**
 * capture.spec.ts - `npm run help:shots`: the screenshots on the help pages (user-help Inc 1, Batch 4).
 *
 * NEVER part of CI and never run by a bare `playwright test` (playwright.config.ts: the `help-shots`
 * project exists only under PW_HELP_SHOTS=1). Run it on your own server, against a scratch
 * fixture database, with the capture attested:
 *
 *   HELP_SHOTS_DB_OK=1 E2E_BASE_URL=http://localhost:<your port> npm run help:shots
 *
 * Safety, in order (R10; the design's "Determinism and safety"):
 *   1. The fail-closed guard (guard.ts) runs in the project's globalSetup AND in beforeAll, before any
 *      navigation: it refuses any database holding an organization or profile outside the fixture
 *      allow-list, a non-.invalid account address, a different database from the server's, or no
 *      attestation. Branch lineage is not trusted.
 *   2. Fixture users only: the e2e `mfa-enrolled` sign-in, made a founding administrator by fixture.ts,
 *      and nobody signed in for the sign-in form. The avatar menu and the page header are never in a shot.
 *   3. Light scheme, reduced motion, device scale factor 2, Next's dev overlay and toasts hidden.
 *   4. Element screenshots only. Each element's text and field values are asserted free of the time-aware
 *      greeting and of any email address that is not on the reserved .invalid domain (the design said "no @":
 *      the seeded people carry .invalid addresses, which are the fixture's own and harmless), and every
 *      placeholder is hidden (the sign-in form's example address is not ours to publish).
 *   5. The PNG is written to src/content/help/images/<id>.png, then its header size is compared with the
 *      manifest and every manifest `capturedIn` with package.json's version, so the stamp moves only by
 *      re-running this (P3-14).
 * A human reads every image before it is committed: no scanner reads pixels.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import fs from "node:fs";
import path from "node:path";
import { HELP_SHOTS } from "../../src/lib/help/screenshots-data";
import { readPngSize } from "../../src/lib/help/checks";
import { platformSql, type Sql } from "../support/db";
import { E2E_TOTP_TEST_SECRET } from "../support/totp-fixture";
import { enterTotpCode, totpGroup, waitForTotpVerified } from "../support/totp-page";
import { assertFixtureOnlyDatabase } from "./guard";
import { FOUNDER, setupShotsWorld, type ShotsWorld } from "./fixture";

const ROOT = path.resolve(__dirname, "../..");
const IMAGES_DIR = path.join(ROOT, "src/content/help/images");
const PACKAGE_VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;

/** Next's dev indicator, error toast and sonner toasts: never in a help image. */
const HIDE_OVERLAYS = `
  nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay], [data-next-badge-root], [data-nextjs-dev-tools-button],
  [data-sonner-toaster], [data-sonner-toast] { display: none !important; }
  /* A placeholder is not page copy, and the sign-in form's example address is the starter's own. */
  input::placeholder, textarea::placeholder { color: transparent !important; }
`;

interface Recipe {
  /** The element that goes in the image. */
  element: (page: Page) => Locator;
  /** The tallest part of a long element worth showing, in CSS pixels. */
  maxHeight?: number;
}

/** One recipe per manifest id: which element, and nothing else, is photographed. */
const RECIPES: Record<string, Recipe> = {
  // The card with the form, not the page: no header, no footer.
  "signin-form": { element: (p) => p.locator("main") },
  // The six boxes, the Verify button and the recovery toggle.
  "totp-boxes": { element: (p) => p.locator("form").filter({ has: totpGroup(p) }) },
  // The tile grid, not the greeting, the household or the upcoming-events card (the greeting changes by the hour).
  "portal-tiles": { element: (p) => p.locator("#domain-people").locator(".."), maxHeight: 1372 },
  "admin-hub": { element: (p) => p.locator("main > div") },
  "features-list": { element: (p) => p.locator("main > div"), maxHeight: 1160 },
  // Stops after the second person: the seeded addresses further down are .invalid, but nothing needs them.
  "community-list": { element: (p) => p.locator("main > div"), maxHeight: 725 },
  // At 360px the calendar is the list view.
  "calendar-month": { element: (p) => p.locator("main > section"), maxHeight: 1110 },
};

/** Text AND the value of every field in the element: innerText does not see an input's content. */
function assertSafeText(id: string, text: string, fieldValues: string[]) {
  expect(text, `${id}: a time-aware greeting is baked into the element`).not.toMatch(/Good (morning|afternoon|evening)/);
  const emails = `${text}\n${fieldValues.join("\n")}`.match(/[^\s@]+@[^\s@]+/g) ?? [];
  const real = emails.filter((e) => !e.replace(/[.,;:)]+$/, "").toLowerCase().endsWith(".invalid"));
  expect(real.length, `${id}: ${real.length} email-shaped string(s) not on the reserved .invalid domain`).toBe(0);
}

async function newShotContext(browser: Browser, baseURL: string, width: number): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    viewport: { width, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

/** The credentials sign-in globalSetup uses, on this context's cookie jar. */
async function signIn(context: BrowserContext, baseURL: string, email: string, password: string) {
  const csrf = (await (await context.request.get(`${baseURL}/api/auth/csrf`)).json()) as { csrfToken: string };
  const res = await context.request.post(`${baseURL}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, callbackUrl: `${baseURL}/launch` },
    maxRedirects: 0,
  });
  expect(res.status(), "credentials sign-in").toBeLessThan(400);
}

async function settle(page: Page) {
  await page.addStyleTag({ content: HIDE_OVERLAYS });
  await page.waitForLoadState("networkidle");
  // Nothing may be focused: a focus ring in a help image is noise.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

async function shoot(page: Page, id: string, recipe: Recipe) {
  const el = recipe.element(page);
  await expect(el, `${id}: the element is on the page`).toBeVisible();
  const fieldValues = await el.evaluate((node) =>
    [...node.querySelectorAll("input:not([type=hidden]), textarea")].map((f) => (f as HTMLInputElement).value ?? ""),
  );
  assertSafeText(id, await el.innerText(), fieldValues);
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const file = path.join(IMAGES_DIR, `${id}.png`);
  await el.scrollIntoViewIfNeeded();
  const box = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  });
  if (recipe.maxHeight && box.height > recipe.maxHeight) {
    await page.screenshot({ path: file, fullPage: true, clip: { ...box, height: recipe.maxHeight }, animations: "disabled" });
  } else {
    await el.screenshot({ path: file, animations: "disabled" });
  }
}

test.describe("help screenshots", () => {
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  let sql: Sql;
  let world: ShotsWorld;

  test.beforeAll(async () => {
    await assertFixtureOnlyDatabase(); // before any navigation, before any write
    sql = platformSql("help-shots/capture.spec");
    world = await setupShotsWorld(sql);
  });

  test.afterAll(async () => {
    await world?.restore();
  });

  test("every manifest entry has a recipe", () => {
    expect(HELP_SHOTS.length).toBeGreaterThan(0);
    for (const shot of HELP_SHOTS) expect(RECIPES[shot.id], `no recipe for ${shot.id}`).toBeDefined();
    for (const id of Object.keys(RECIPES)) expect(HELP_SHOTS.some((s) => s.id === id), `recipe ${id} has no manifest entry`).toBe(true);
  });

  test("the pages, signed out and as the founding administrator", async ({ browser, baseURL }) => {
    const base = baseURL!;
    const shot = (id: string) => {
      const entry = HELP_SHOTS.find((s) => s.id === id);
      if (!entry) throw new Error(`no manifest entry ${id}`);
      return entry;
    };

    // Signed out: the sign-in form.
    {
      const entry = shot("signin-form");
      const ctx = await newShotContext(browser, base, entry.viewport);
      const page = await ctx.newPage();
      await page.goto(entry.route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByLabel(/^email/i)).toBeEnabled(); // hydration is the signal
      await settle(page);
      await shoot(page, entry.id, RECIPES[entry.id]);
      await ctx.close();
    }

    // The founding administrator: password, then /totp (a shot), then a real code, then the portal.
    const first = shot("totp-boxes");
    const ctx = await newShotContext(browser, base, first.viewport);
    await signIn(ctx, base, FOUNDER.email, FOUNDER.password);
    const page = await ctx.newPage();
    await page.goto(first.route);
    await expect(page.getByLabel(/^digit 1 of 6$/i)).toBeEnabled({ timeout: 30_000 });
    await settle(page);
    await shoot(page, first.id, RECIPES[first.id]);
    await enterTotpCode(page, generateSync({ secret: E2E_TOTP_TEST_SECRET }));
    await waitForTotpVerified(page);

    for (const id of ["portal-tiles", "admin-hub", "features-list", "community-list", "calendar-month"]) {
      const entry = shot(id);
      await page.setViewportSize({ width: entry.viewport, height: 800 });
      const res = await page.goto(entry.route);
      expect(res?.status(), entry.route).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await settle(page);
      await shoot(page, id, RECIPES[id]);
    }
    await ctx.close();
  });

  test("the images on disk are the manifest's: sizes match and every capturedIn is this release", () => {
    const stale: string[] = [];
    const wrongSize: string[] = [];
    for (const shot of HELP_SHOTS) {
      if (shot.capturedIn !== PACKAGE_VERSION) stale.push(`${shot.id} (capturedIn ${shot.capturedIn})`);
      const size = readPngSize(fs.readFileSync(path.join(IMAGES_DIR, `${shot.id}.png`)));
      if (!size) wrongSize.push(`${shot.id}: not a PNG`);
      else if (size.width !== shot.width || size.height !== shot.height) {
        wrongSize.push(`${shot.id}: file is ${size.width}x${size.height}, manifest says ${shot.width}x${shot.height}`);
      }
    }
    expect(stale, `set capturedIn to ${PACKAGE_VERSION} for these ids`).toEqual([]);
    expect(wrongSize, "update width and height in src/lib/help/screenshots-data.ts").toEqual([]);
  });
});
