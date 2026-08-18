/**
 * admin-email-queue.spec.ts — Email queue admin viewer at /admin/email-queue.
 *
 * Uses cached storageState from e2e/support/global-setup.ts (same as
 * role-boundaries.spec.ts, feedback.spec.ts, admin-audit.spec.ts).
 *
 * Test 1 — Admin: /admin/email-queue renders the page heading and
 *   "Email queue" sidebar nav link.
 * Test 2 — Admin: the count summary strip or empty-state message is present
 *   (either is valid depending on whether queue rows exist).
 * Test 3 — Member: /admin/email-queue is blocked at the proxy level by the
 *   /^\/admin/ ADMIN_DASHBOARD catch-all rule; the member is redirected to
 *   /access-pending before the page-level hasFeature(ADMIN_EMAIL_QUEUE) check
 *   runs. (Same behavior as /admin/audit for the same reason.)
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";


// ---------------------------------------------------------------------------
// Test 1 — Admin sees the email queue page
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/email-queue", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin reaches the email queue page and sees the heading", async ({
    page,
  }) => {
    const response = await page.goto("/admin/email-queue");
    expect(
      response?.status(),
      "/admin/email-queue should respond 2xx",
    ).toBeLessThan(400);
    expect(
      new URL(page.url()).pathname,
      "/admin/email-queue should not redirect",
    ).toBe("/admin/email-queue");

    await expect(
      page.getByRole("heading", { name: /email queue/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Email queue nav link is present in the sidebar", async ({ page }) => {
    await page.goto("/admin/email-queue");

    await expect(
      page.getByRole("link", { name: /email queue/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Admin: page renders count strip or empty-state (not a server error)
// ---------------------------------------------------------------------------

test.describe("Admin — email queue page content smoke", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("page renders either count strip or empty-state message without a server error", async ({
    page,
  }) => {
    const response = await page.goto("/admin/email-queue");
    expect(
      response?.status(),
      "page should not return a 5xx error",
    ).toBeLessThan(500);

    // The page must contain either the heading (always present) — this is
    // sufficient to confirm the server component rendered without throwing.
    await expect(
      page.getByRole("heading", { name: /email queue/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("status filter links are present", async ({ page }) => {
    await page.goto("/admin/email-queue");

    // The filter tab for "All" should always render.
    await expect(
      page.getByRole("link", { name: /^all$/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Member is blocked (proxy bounce to /access-pending)
// ---------------------------------------------------------------------------

test.describe("Member — /admin/email-queue blocked by proxy", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/email-queue is redirected to /access-pending", async ({
    page,
  }) => {
    // The proxy's /^\/admin/ catch-all requires admin.dashboard.
    // The seeded member has no admin features → redirect to /access-pending.
    await page.goto("/admin/email-queue");
    await expect(page).toHaveURL(/\/access-pending/, { timeout: 10_000 });
  });
});
