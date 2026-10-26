/**
 * admin-shell.spec.ts - the platform console's shell and dashboard (platform
 * admin redesign, Increment 1): grouped nav with an active state, the dashboard
 * zones and cards, one sign-out path, a 404 that stays a 404, and the phone
 * (360px) menu with no horizontal overflow.
 *
 * Storage state `admin`; depends on no feature flag. There is no
 * support-operator e2e fixture (adding one touches e2e/support/users.ts, a
 * shared file), so that subset is pinned at unit level (page.test.tsx,
 * visible-nav.test.ts). Forcing one card's reader to fail in a running server
 * has no supported hook; that isolation is pinned in cards.test.tsx and
 * present.test.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";

test.use({ storageState: storageStatePath("admin") });

const ZONES = ["Organizations", "Support", "Access and settings", "Recent operator changes"];

/** Cards stream in per Suspense boundary; wait until no skeleton is left. */
async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

test.describe("desktop shell", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the dashboard shows the four zones and no card failed to load", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("greeting-band")).toBeVisible();
    for (const zone of ZONES) {
      await expect(page.getByRole("heading", { level: 2, name: zone })).toBeVisible();
    }
    await settled(page);
    await expect(page.getByText("We can't load this right now.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New organization" })).toBeVisible();
    await expect(page.getByLabel("Find an organization")).toBeVisible();
    await expect(page.getByText(/^Updated/)).toBeVisible();
    // The console never links into a tenant route.
    await expect(page.locator('a[href^="/o/"]')).toHaveCount(0);
  });

  test("the find box searches the organization list", async ({ page }) => {
    await page.goto("/admin");
    await page.getByLabel("Find an organization").fill("Wrenfield");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/admin\/organizations\?q=Wrenfield/);
    await expect(page.getByRole("link", { name: /Wrenfield/ }).first()).toBeVisible();
  });

  test("the nav groups are headed and the current page is marked", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Platform admin" });

    await page.goto("/admin");
    for (const heading of ["Organizations", "Support", "Access and settings", "Content", "Reference"]) {
      // A group heading is a <p>; "Organizations" is also a link label.
      await expect(nav.locator("p").filter({ hasText: new RegExp(`^${heading}$`) })).toBeVisible();
    }
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await page.goto("/admin/organizations");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Organizations" })).toHaveAttribute("aria-current", "page");

    // The longest href wins: Domains lights, Organizations does not.
    await page.goto("/admin/organizations/domains");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Domains" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Organizations" })).not.toHaveAttribute("aria-current", "page");
  });

  test("signing out from the avatar menu lands on the front page signed out", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();
  });

  test("an organization that does not exist is still a 404 (no loading.tsx turned it into a 200)", async ({ page }) => {
    const response = await page.goto("/admin/organizations/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
  });
});

test.describe("phone shell at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the dashboard does not scroll sideways and the action bar stacks", async ({ page }) => {
    await page.goto("/admin");
    await settled(page);
    await noHorizontalOverflow(page);
    const create = page.getByRole("link", { name: "New organization" });
    const find = page.getByLabel("Find an organization");
    const createBox = (await create.boundingBox())!;
    const findBox = (await find.boundingBox())!;
    expect(createBox.height).toBeGreaterThanOrEqual(44);
    expect(findBox.height).toBeGreaterThanOrEqual(44);
    // Stacked: the input sits below the button, not beside it.
    expect(findBox.y).toBeGreaterThan(createBox.y + createBox.height - 1);
    await page.goto("/admin/organizations");
    await noHorizontalOverflow(page);
  });

  test("the Menu button opens the nav, a link navigates and closes it, Escape returns focus", async ({ page }) => {
    await page.goto("/admin");
    // The avatar trigger's name also contains "menu"; ask for the exact one.
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menu).toBeVisible();
    expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The desktop sidebar is not shown on a phone.
    await expect(page.getByRole("navigation", { name: "Platform admin" })).toHaveCount(0);

    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Platform admin" });
    await expect(sheet).toBeVisible();
    const links = sheet.getByRole("link");
    const n = await links.count();
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < n; i++) {
      expect((await links.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(menu).toBeFocused();

    await menu.click();
    await sheet.getByRole("link", { name: "Organizations", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/admin/organizations");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noHorizontalOverflow(page);
  });
});
