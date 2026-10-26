/**
 * developer-portal.spec.ts - the developer portal's frame and pages
 * (docs/work-log/2026-10-25-developer-portal-inc1.md, Batch C).
 *
 * The required-but-unverified second factor (design cases 1 and 2) is covered
 * by e2e/developer-2fa-gate.spec.ts and not repeated here.
 *
 * Fixture: one THROWAWAY platform administrator,
 * `e2e-devui-<stamp>@example.invalid`, with no second factor required. It is
 * created in beforeAll, signed in once (its storage state is cached in a temp
 * file), and deleted in afterAll behind a guard on its own prefix and the
 * `.invalid` suffix. No roster user is touched, no person row is created and no
 * flag is read. The fixture lives in this file, not in e2e/support/, because
 * e2e/support/* is a shared file in a parallel-pipeline repo (Rule 16).
 *
 * The non-entitled cases use the roster's `member` and `admin` storage states:
 * neither holds users.is_platform_admin, and an ADMIN_ROLE holder without the
 * column is forbidden too (the predicate is unchanged in Increment 1).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { storageStatePath } from "./support/users";

const STAMP = `${Date.now()}`;
const EMAIL = `e2e-devui-${STAMP}@example.invalid`;
const PASSWORD = "e2e-devui-throwaway-not-a-secret";
const STATE_FILE = path.join(mkdtempSync(path.join(tmpdir(), "e2e-devui-")), "state.json");

let sql: Sql;

function assertOwnAddress(address: string): void {
  if (!address.startsWith("e2e-devui-") || !address.endsWith("@example.invalid")) {
    throw new Error(`[developer-portal] refusing to touch "${address}"`);
  }
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  sql = platformSql("developer-portal");
  assertOwnAddress(EMAIL);
  await withDbRetry(
    "sweep stale devui users",
    () => sql`delete from users where email like 'e2e-devui-%@example.invalid'`,
  );
  const hash = await bcrypt.hash(PASSWORD, 10);
  await withDbRetry(
    "create devui user",
    () => sql`
      insert into users (email, name, password, email_verified, is_active,
                         two_factor_required, is_platform_admin)
      values (${EMAIL}, 'E2E Devui Admin', ${hash}, now(), true, false, true)`,
  );

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/signin?callbackUrl=${encodeURIComponent("/developer")}`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL((u) => u.pathname === "/developer", { timeout: 90_000 });
  await context.storageState({ path: STATE_FILE });
  await context.close();
});

test.afterAll(async () => {
  assertOwnAddress(EMAIL);
  await withDbRetry("delete devui user", () => sql`delete from users where email = ${EMAIL}`);
});

async function noHorizontalOverflow(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, "page scrolls sideways").toBeLessThanOrEqual(inner);
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Developer portal" });

for (const role of ["member", "admin"] as const) {
  test.describe(`${role}: signed in but not entitled`, () => {
    test.use({ storageState: storageStatePath(role) });

    test("sees the forbidden page with a header and no nav, at HTTP 200, with no redirect to /home (E5, E6)", async ({ page }) => {
      for (const target of ["/developer", "/developer/tables/no_such_table_at_all", "/developer/erd/no-such-module", "/developer/docs", "/developer/data-model"]) {
        const res = await page.goto(target);
        expect(res?.status(), target).toBe(200);
        expect(new URL(page.url()).pathname, target).toBe(target);
        await expect(page.getByRole("heading", { level: 1, name: "Developer portal" })).toBeVisible();
        await expect(
          page.getByText("Your account doesn't include the developer portal. Ask a platform administrator if you need it."),
        ).toBeVisible();
        // The header (avatar menu, way back) is there; the section nav is not.
        await expect(page.getByRole("link", { name: "← PresbyPortal" })).toBeVisible();
        await expect(page.getByRole("button", { name: /account menu/i })).toBeVisible();
        await expect(nav(page)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveCount(0);
      }
    });

    test("schema.json answers 403 forbidden as no-store JSON (E11)", async ({ page }) => {
      const res = await page.request.get("/developer/schema.json", { maxRedirects: 0 });
      expect(res.status()).toBe(403);
      expect(res.headers()["cache-control"]).toBe("no-store");
      expect(await res.json()).toEqual({ error: "forbidden" });
    });
  });
}

test.describe("an entitled developer", () => {
  test.use({ storageState: STATE_FILE, viewport: { width: 1280, height: 800 } });

  test("home shows both sections with their labels, the nav landmark, and a working skip link", async ({ page }) => {
    const res = await page.goto("/developer");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle("Developer portal");
    await expect(page.getByRole("heading", { level: 1, name: "Developer portal" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Sections" })).toBeVisible();

    const data = page.getByRole("link", { name: /Data model/ }).filter({ hasText: "Generated" });
    await expect(data).toBeVisible();
    const docs = page.getByRole("link", { name: /Documentation/ }).filter({ hasText: "Planned" });
    await expect(docs).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "What the labels mean" })).toBeVisible();

    const n = nav(page);
    await expect(n).toBeVisible();
    await expect(n.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(n.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByText(/^Version /)).toBeVisible();

    // The skip link is the first tab stop and moves focus to <main>.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#developer-main")).toBeFocused();
  });

  test("data model: filter narrows to n of N and says so when nothing matches; a row opens its table; the nav and crumbs agree; the diagram renders", async ({ page }) => {
    await page.goto("/developer/data-model");
    await expect(page).toHaveTitle("Data model · Developer portal");
    await expect(page.getByRole("heading", { level: 1, name: "Data model" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Data model" })).toHaveAttribute("aria-current", "page");

    const count = page.locator(".reg__filterCount");
    await expect(count).toHaveText(/^\d+ tables$/);
    const total = Number((await count.textContent())!.split(" ")[0]);
    expect(total).toBeGreaterThan(100);

    const find = page.getByLabel("Find");
    await find.fill("roll_actions");
    await expect(count).toHaveText(new RegExp(`^\\d+ of ${total}$`));
    await expect(page.getByText("No table matches that.")).toBeHidden();

    await find.fill("zzzz-no-such-thing");
    await expect(count).toHaveText(`0 of ${total}`);
    await expect(page.getByText(`No table matches that. Clear the search to see all ${total}.`)).toBeVisible();

    await find.fill("");
    await expect(count).toHaveText(`${total} tables`);

    // Every module renders under a real heading, none under "Unclassified".
    await expect(page.getByRole("heading", { level: 2, name: "Unclassified" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Platform shell" })).toBeVisible();

    await find.fill("roll_actions");
    await page.locator("a.reg__row", { hasText: "roll_actions" }).first().click();
    await page.waitForURL("**/developer/tables/roll_actions");
    await expect(page.getByRole("heading", { level: 1, name: "roll_actions" })).toBeVisible();
    await expect(page).toHaveTitle("roll_actions · Developer portal");
    // The table page lights Data model.
    await expect(nav(page).getByRole("link", { name: "Data model" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByText("has organization_id")).toBeVisible();

    // Crumbs: 44px, back to the data model.
    const crumb = page.locator(".reg__crumbs").getByRole("link", { name: "Data model" });
    expect((await crumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // The module crumb leads to a diagram that renders an SVG.
    const moduleCrumb = page.locator(".reg__crumbs a").nth(1);
    expect((await moduleCrumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await moduleCrumb.click();
    await page.waitForURL("**/developer/erd/**");
    await expect(page.locator(".reg__erd svg").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 2, name: "Tables in this module" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Data model" })).toHaveAttribute("aria-current", "page");

    await page.locator(".reg__crumbs").getByRole("link", { name: "Data model" }).click();
    await page.waitForURL("**/developer/data-model");
  });

  test("44px targets on the Diagram link and the filter at desktop width (E23)", async ({ page }) => {
    await page.goto("/developer/data-model");
    const diagram = page.getByRole("link", { name: "Diagram →" }).first();
    expect((await diagram.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByLabel("Find").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("an unknown table or diagram is a real 404 inside the chrome (E12)", async ({ page }) => {
    for (const target of ["/developer/tables/no_such_table_at_all", "/developer/erd/no-such-module"]) {
      const res = await page.goto(target);
      expect(res?.status(), target).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "We couldn't find that table or diagram" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to the data model" })).toBeVisible();
      await expect(nav(page)).toBeVisible();
    }
  });

  test("documentation lists seven rows, each marked Planned, with the reviewed date", async ({ page }) => {
    await page.goto("/developer/docs");
    await expect(page).toHaveTitle("Documentation · Developer portal");
    await expect(page.getByRole("heading", { level: 1, name: "Documentation" })).toBeVisible();
    const rows = page.locator("main ul > li");
    await expect(rows).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      await expect(rows.nth(i)).toContainText("Planned");
      await expect(rows.nth(i)).toContainText("Not built yet. Today");
    }
    await expect(page.getByText(/^Reviewed/)).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Documentation" })).toHaveAttribute("aria-current", "page");
  });

  test("schema.json returns the payload with the three-word vocabulary and a source on every rule", async ({ page }) => {
    const res = await page.request.get("/developer/schema.json");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.json();
    expect(body.invariants.length).toBeGreaterThan(15);
    for (const inv of body.invariants as Array<{ enforcement: string; source: unknown }>) {
      expect(["database", "trigger", "paper"]).toContain(inv.enforcement);
      expect(inv).toHaveProperty("source");
    }
    expect(body.tables.filter((t: { module: string }) => t.module === "Unclassified")).toHaveLength(0);
  });

  test("the avatar menu offers Developer to an entitled viewer and no Platform admin item to one without the admin door", async ({ page }) => {
    await page.goto("/developer");
    await page.getByRole("button", { name: /account menu/i }).click();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Platform admin" })).toHaveCount(0);
  });
});

test.describe("phone shell at 360px", () => {
  test.use({ storageState: STATE_FILE, viewport: { width: 360, height: 740 } });

  test("six pages do not scroll sideways, and the Menu sheet works with 44px targets (E22, E24)", async ({ page }) => {
    for (const target of ["/developer", "/developer/data-model", "/developer/tables/roll_actions", "/developer/docs"]) {
      await page.goto(target);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noHorizontalOverflow(page);
    }

    // A diagram page: reach it through the table page's module crumb.
    await page.goto("/developer/tables/roll_actions");
    await page.locator(".reg__crumbs a").nth(1).click();
    await page.waitForURL("**/developer/erd/**");
    await expect(page.locator(".reg__erd svg").first()).toBeVisible({ timeout: 60_000 });
    await noHorizontalOverflow(page);

    await page.goto("/developer");
    await expect(nav(page)).toHaveCount(0);
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menu).toBeVisible();
    expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Developer portal" });
    await expect(sheet).toBeVisible();
    const links = sheet.getByRole("link");
    expect(await links.count()).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect((await links.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(sheet.getByText(/^Version /)).toBeVisible();

    await sheet.getByRole("link", { name: "Documentation", exact: true }).click();
    await page.waitForURL("**/developer/docs");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noHorizontalOverflow(page);
  });

  test("the crumbs, Diagram link and filter are 44px on a phone", async ({ page }) => {
    await page.goto("/developer/data-model");
    expect((await page.getByLabel("Find").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByRole("link", { name: "Diagram →" }).first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto("/developer/tables/roll_actions");
    for (const crumb of await page.locator(".reg__crumbs a").all()) {
      expect((await crumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("phone, not entitled", () => {
  test.use({ storageState: storageStatePath("member"), viewport: { width: 360, height: 740 } });

  test("the forbidden page does not scroll sideways", async ({ page }) => {
    await page.goto("/developer");
    await expect(page.getByRole("heading", { level: 1, name: "Developer portal" })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
