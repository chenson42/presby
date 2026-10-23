/**
 * portal-footer-sitemap.spec.ts - the portal footer as a site map, against a
 * running server (2026-10-23-portal-sitemap-footer, DECISION-220/221).
 *
 * Only global `feature_flags` rows are touched, captured in beforeAll and
 * restored (verified by SELECT) in afterAll with e2e/support/flags.ts. No row
 * is created, so there is nothing else to clean up. Uses the existing
 * synthetic org-single user at e2e-alpha.
 *
 * Flag setup: the chrome flags and the directory/groups/communications tiles
 * ON (so Community and Communications columns exist, the latter carrying a
 * comingSoon tile), `org_portal.admin_hub` ON with exactly one administer
 * tile (`org_portal.roles`) visible.
 *
 * Geometry assertions, not class assertions: no horizontal overflow at 360
 * and 1024, every footer link at least 44px tall, and the Administration
 * column holding only "Administration overview" (operator ruling Q1).
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";

const SLUG = E2E_ORGS.alpha.slug;
const HOME = `/o/${SLUG}`;

const ADMINISTER_FLAGS = [
  "org_portal.roles",
  "org_portal.tickets",
  "org_portal.features",
  "org_portal.branding",
  "org_portal.events",
  "org_portal.reports",
  "org_portal.filings",
];
const FLAGS = [
  "org_portal.chrome_v2",
  "org_portal.chrome_v3",
  "org_portal.admin_hub",
  "org_portal.directory",
  "org_portal.groups",
  "org_portal.communications",
  ...ADMINISTER_FLAGS,
];

const footerNav = (page: Page) => page.getByRole("navigation", { name: "Footer" });
// The nav row's links are display:none behind the Menu button at 360px, so
// they are counted by CSS locator (attached, not necessarily visible).
const navAdministration = (page: Page) =>
  page.locator('nav[aria-label="Portal"] a', { hasText: "Administration" });

async function overflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("Portal footer site map", () => {
  test.setTimeout(90_000);

  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("portal-footer-sitemap.spec");
    flags = await captureFlags(sql, FLAGS);
    for (const key of [
      "org_portal.chrome_v2",
      "org_portal.chrome_v3",
      "org_portal.admin_hub",
      "org_portal.directory",
      "org_portal.groups",
      "org_portal.communications",
      "org_portal.roles",
    ]) {
      await setFlag(sql, key, true);
    }
    for (const key of ADMINISTER_FLAGS.filter((k) => k !== "org_portal.roles")) {
      await setFlag(sql, key, false);
    }
  });

  test.afterAll(async () => {
    await flags.restore();
  });

  for (const viewport of [
    { name: "360", width: 360, height: 800 },
    { name: "1024", width: 1024, height: 800 },
  ]) {
    test.describe(`at ${viewport.name}px`, () => {
      test.use({
        storageState: storageStatePath("org-single"),
        viewport: { width: viewport.width, height: viewport.height },
      });

      test("lists Community with its tools, wraps without overflow, and keeps 44px targets", async ({
        page,
      }) => {
        const response = await page.goto(HOME);
        expect(response?.status()).toBe(200);

        const footer = footerNav(page);
        await expect(footer).toBeVisible();
        await expect(footer.getByRole("heading", { level: 2, name: "Community" })).toBeVisible();
        await expect(footer.getByRole("link", { name: "Directory" })).toBeVisible();
        await expect(footer.getByRole("link", { name: "Home" })).toBeVisible();
        // A heading is text, not a link: there is no footer link named Community
        // beyond the tile itself (none when the members tile flag is off).
        await expect(footer.getByRole("heading", { name: "Community" }).locator("a")).toHaveCount(0);

        // A coming-soon tile carries the words, not just a style.
        const comms = footer.getByRole("list", { name: "Communications" });
        await expect(comms.getByText("Coming soon")).toBeVisible();

        expect(await overflow(page)).toBeLessThanOrEqual(0);

        const links = footer.getByRole("link");
        const count = await links.count();
        expect(count).toBeGreaterThan(2);
        for (let i = 0; i < count; i += 1) {
          const box = await links.nth(i).boundingBox();
          expect(box, `footer link ${i} has a box`).not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(43.5);
        }
      });

      test("an inner page carries the same footer without overflow", async ({ page }) => {
        await page.goto(`${HOME}/directory`);
        await expect(footerNav(page).getByRole("heading", { level: 2, name: "Community" })).toBeVisible();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      });
    });
  }

  test.describe("Administration", () => {
    test.use({
      storageState: storageStatePath("org-single"),
      viewport: { width: 360, height: 800 },
    });

    test("the footer column holds only the overview link, and the nav shows the same entry", async ({
      page,
    }) => {
      await page.goto(HOME);
      const footer = footerNav(page);
      await expect(footer.getByRole("heading", { level: 2, name: "Administration" })).toBeVisible();
      const list = footer.getByRole("list", { name: "Administration" });
      await expect(list.getByRole("link")).toHaveCount(1);
      const overview = list.getByRole("link", { name: "Administration overview" });
      await expect(overview).toHaveAttribute("href", `${HOME}/admin`);
      // Individual administer tiles never reach the footer.
      await expect(footer.getByRole("link", { name: "Roles" })).toHaveCount(0);
      await expect(navAdministration(page)).toHaveCount(1);
    });

    test("with the hub flag off neither the nav nor the footer shows Administration", async ({
      page,
    }) => {
      await setFlag(sql, "org_portal.admin_hub", false);
      try {
        await page.goto(HOME);
        await expect(footerNav(page)).toBeVisible();
        await expect(navAdministration(page)).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 2, name: "Administration" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Administration overview" })).toHaveCount(0);
      } finally {
        await setFlag(sql, "org_portal.admin_hub", true);
      }
    });

    test("with the hub on but no administer tile visible, Administration is absent from both", async ({
      page,
    }) => {
      await setFlag(sql, "org_portal.roles", false);
      try {
        await page.goto(HOME);
        await expect(footerNav(page)).toBeVisible();
        await expect(navAdministration(page)).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Administration overview" })).toHaveCount(0);
      } finally {
        await setFlag(sql, "org_portal.roles", true);
      }
    });
  });
});
