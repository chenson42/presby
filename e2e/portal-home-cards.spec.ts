/**
 * portal-home-cards.spec.ts - the portal home's main row ("Yours" and
 * "Coming up") at three widths, against a running server
 * (2026-10-14-portal-home-alignment).
 *
 * Creates only its own rows at e2e-alpha (ids `e2ce...`, role keys
 * `e2e_home_*`, names `E2E ...`) and removes them in afterAll on the owner
 * connection (DECISION-157). `org_portal.home_v2`, `org_portal.directory` and
 * `org_portal.directory_v2` are captured and restored with e2e/support/flags.ts;
 * the calendar's per-org toggle is restored by the fixture teardown.
 *
 * Who is who (see home-cards-fixture.ts):
 *   org-single   - household + two groups + directory.view + events.view
 *   org-multi    - events.view only (no household, no groups, no directory.view)
 *
 * The layout assertions are about geometry, not classes: stacked at 360,
 * side by side from md (768), a lone card full width, no empty box.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  HOME_IDS,
  HOME_TITLES,
  LONG_EVENT_TITLE,
  LONG_GROUP_NAME,
  removeHomeFixture,
  setCalendarToggle,
  setupHomeFixture,
  type HomeFixtureState,
} from "./support/home-cards-fixture";

const SLUG = E2E_ORGS.alpha.slug;
const HOME = `/o/${SLUG}`;
const FLAGS = ["org_portal.home_v2", "org_portal.directory", "org_portal.directory_v2"];

const yoursSection = (page: Page) => page.locator('section[aria-labelledby="yours-zone-heading"]');
const comingSection = (page: Page) => page.locator('section[aria-labelledby="upcoming-events-heading"]');

async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

test.describe("Portal home cards", () => {
  test.setTimeout(90_000);

  let sql: Sql;
  let flags: FlagCapture;
  let state: HomeFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("portal-home-cards.spec");
    flags = await captureFlags(sql, FLAGS);
    for (const key of FLAGS) await setFlag(sql, key, true);
    // A crashed prior run may have left rows behind.
    await removeHomeFixture(sql, null);
    state = await setupHomeFixture(sql);
  });

  test.afterAll(async () => {
    await removeHomeFixture(sql, state);
    await flags.restore();
  });

  test.describe("both cards, 360px", () => {
    test.use({ storageState: storageStatePath("org-single"), viewport: { width: 360, height: 800 } });

    test("stack in one column, with no horizontal scroll and wrapped long names", async ({ page }) => {
      await setCalendarToggle(sql, true);
      const response = await page.goto(HOME);
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId("greeting-band")).toBeVisible();

      const yours = await box(yoursSection(page));
      const coming = await box(comingSection(page));
      expect(coming.y).toBeGreaterThanOrEqual(yours.y + yours.height - 1);
      expect(Math.abs(coming.x - yours.x)).toBeLessThanOrEqual(1);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("event rows are at least 44px tall and the group pill is not a link", async ({ page }) => {
      await page.goto(HOME);
      const rows = comingSection(page).locator("ul > li a");
      await expect(rows).toHaveCount(4);
      for (const row of await rows.all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(44);
      }
      const pill = yoursSection(page).getByText(LONG_GROUP_NAME);
      await expect(pill).toBeVisible();
      await expect(pill.locator("xpath=ancestor::a")).toHaveCount(0);
    });
  });

  test.describe("both cards, side by side from md", () => {
    for (const width of [768, 1280]) {
      test.describe(`at ${width}px`, () => {
        test.use({ storageState: storageStatePath("org-single"), viewport: { width, height: 900 } });

        test("share a top edge with Coming up to the right, in outline order", async ({ page }) => {
          await setCalendarToggle(sql, true);
          await page.goto(HOME);
          const yours = await box(yoursSection(page));
          const coming = await box(comingSection(page));
          expect(Math.abs(coming.y - yours.y)).toBeLessThanOrEqual(1);
          expect(coming.x).toBeGreaterThan(yours.x + yours.width - 1);

          const h2s = await page.getByRole("heading", { level: 2 }).allTextContents();
          expect(h2s.slice(0, 2)).toEqual(["Yours", "Coming up"]);

          if (width === 1280) {
            const main = await box(page.locator("main"));
            expect(yours.width).toBeLessThan(main.width * 0.6);
            expect(coming.width).toBeLessThan(main.width * 0.6);
          }
        });
      });
    }
  });

  test.describe("content", () => {
    test.use({ storageState: storageStatePath("org-single"), viewport: { width: 1280, height: 900 } });

    test("lists four events, one per series, with the next occurrence of a series whose parent has passed", async ({ page }) => {
      await setCalendarToggle(sql, true);
      await page.goto(HOME);
      const rows = comingSection(page).locator("ul > li a");
      await expect(rows).toHaveCount(4);

      const series = comingSection(page).getByRole("link", { name: new RegExp(HOME_TITLES.series) });
      await expect(series).toHaveCount(1);
      await expect(series).toContainText(state.seriesNextLabel);
      await expect(series).toContainText("7:00 PM");

      await expect(comingSection(page).getByText(HOME_TITLES.cancelled)).toHaveCount(0);
      await expect(comingSection(page).getByText(HOME_TITLES.beyondLimit)).toHaveCount(0);
      await expect(comingSection(page).getByText(LONG_EVENT_TITLE)).toBeVisible();
    });

    test("Yours shows the household and both groups, and Find a person is present", async ({ page }) => {
      await page.goto(HOME);
      await expect(page.getByLabel("Find a person")).toBeVisible();
      const yours = yoursSection(page);
      await expect(yours.getByText(HOME_TITLES.household)).toBeVisible();
      await expect(yours.getByText("2 members")).toBeVisible();
      await expect(yours.getByText(HOME_TITLES.groupAltar)).toBeVisible();
      await expect(yours.getByText(LONG_GROUP_NAME)).toBeVisible();
      await expect(yours.getByRole("link", { name: /view household/i })).toHaveAttribute(
        "href",
        `${HOME}/directory/households/${HOME_IDS.household}`,
      );
    });

    test("an event row opens its detail page, which reads 'Back to home'; the footer link opens the calendar", async ({ page }) => {
      await page.goto(HOME);
      await comingSection(page).getByRole("link", { name: new RegExp(HOME_TITLES.worship) }).click();
      await expect(page).toHaveURL(new RegExp(`${HOME}/calendar/${HOME_IDS.eventWorship}`));
      await expect(page.getByRole("heading", { level: 1, name: HOME_TITLES.worship })).toBeVisible();
      await page.getByRole("link", { name: "Back to home" }).click();
      await expect(page).toHaveURL(new RegExp(`${HOME}$`));

      await comingSection(page).getByRole("link", { name: /see the full calendar/i }).click();
      await expect(page).toHaveURL(new RegExp(`${HOME}/calendar`));
    });
  });

  test.describe("a lone card takes the full width", () => {
    test.describe("Coming up only (no household, no groups, no directory.view)", () => {
      test.use({ storageState: storageStatePath("org-multi"), viewport: { width: 768, height: 900 } });

      test("Yours and Find a person are absent and Coming up fills the main column", async ({ page }) => {
        await setCalendarToggle(sql, true);
        await page.goto(HOME);
        await expect(page.getByRole("heading", { level: 2, name: "Yours" })).toHaveCount(0);
        await expect(page.getByLabel("Find a person")).toHaveCount(0);
        const coming = await box(comingSection(page));
        const main = await box(page.locator("main"));
        expect(coming.width).toBeGreaterThanOrEqual(main.width * 0.9);
      });
    });

    test.describe("Yours only (calendar turned off for the org)", () => {
      test.use({ storageState: storageStatePath("org-single"), viewport: { width: 768, height: 900 } });

      test("Coming up and every calendar link are absent and Yours fills the main column", async ({ page }) => {
        await setCalendarToggle(sql, false);
        try {
          await page.goto(HOME);
          await expect(page.getByRole("heading", { level: 2, name: "Coming up" })).toHaveCount(0);
          await expect(page.locator('main a[href$="/calendar"]')).toHaveCount(0);
          const yours = await box(yoursSection(page));
          const main = await box(page.locator("main"));
          expect(yours.width).toBeGreaterThanOrEqual(main.width * 0.9);
        } finally {
          await setCalendarToggle(sql, true);
        }
      });
    });
  });

  test.describe("no cards", () => {
    for (const width of [360, 1280]) {
      test.describe(`at ${width}px`, () => {
        test.use({ storageState: storageStatePath("org-multi"), viewport: { width, height: 800 } });

        test("neither heading renders, and the greeting and tiles still do", async ({ page }) => {
          await setCalendarToggle(sql, false);
          try {
            await page.goto(HOME);
            await expect(page.getByTestId("greeting-band")).toBeVisible();
            await expect(page.getByRole("heading", { level: 2, name: "Yours" })).toHaveCount(0);
            await expect(page.getByRole("heading", { level: 2, name: "Coming up" })).toHaveCount(0);
            await expect(page.getByTestId("home-main-row")).toHaveCount(0);
            // The domain tile sections are still there.
            await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
          } finally {
            await setCalendarToggle(sql, true);
          }
        });
      });
    }
  });
});
