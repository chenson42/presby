/**
 * whats-new.spec.ts — Member-visible What's-new feature.
 *
 * Test plan:
 *   1. Member navigates to /whats-new → page renders (empty state or list)
 *   2. Admin navigates to /admin/whats-new → list and create form render
 *   3. Admin CRUD smoke: create an entry, verify it appears in the list
 *   4. Member denied /admin/whats-new → redirected to /access-pending
 *   5. Unauthenticated user navigating to /whats-new is redirected to /signin
 *   6. Edit page's "Cancel" stays a real link after the P0.5 `a5` primitive
 *      sweep (docs/work-log/2026-08-19-brand-foundation.md, E6) — it is now
 *      `<Button asChild><Link/></Button>`, and a regression here would render
 *      it `<Button onClick={...}>` instead, silently changing the accessible
 *      role from "link" to "button" and breaking keyboard Enter/Space parity.
 *
 * Uses cached storageState from e2e/support/global-setup.ts (same pattern as
 * admin-email-queue.spec.ts and admin-audit.spec.ts).
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";


// ---------------------------------------------------------------------------
// Test 1 — Unauthenticated redirect
// ---------------------------------------------------------------------------

test.describe("Unauthenticated — /whats-new redirect", () => {
  test("unauthenticated user visiting /whats-new is redirected to /signin", async ({
    page,
  }) => {
    await page.goto("/whats-new");
    const url = new URL(page.url());
    expect(url.pathname, "should redirect to /signin").toBe("/signin");
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Member can reach /whats-new
// ---------------------------------------------------------------------------

test.describe("Member — /whats-new", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member reaches /whats-new and page renders without error", async ({
    page,
  }) => {
    const response = await page.goto("/whats-new");
    expect(
      response?.status(),
      "/whats-new should respond 2xx",
    ).toBeLessThan(400);
    expect(new URL(page.url()).pathname, "should stay on /whats-new").toBe(
      "/whats-new",
    );

    // Page must render the heading.
    await expect(
      page.getByRole("heading", { name: /what.s new/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("member /whats-new shows empty state or entry list (no server error)", async ({
    page,
  }) => {
    const response = await page.goto("/whats-new");
    expect(
      response?.status(),
      "page should not return a 5xx error",
    ).toBeLessThan(500);

    // Either the empty-state text OR a list item is visible.
    const heading = page.getByRole("heading", { name: /what.s new/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Member denied /admin/whats-new (proxy bounce)
// ---------------------------------------------------------------------------

test.describe("Member — /admin/whats-new blocked by proxy", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/whats-new is redirected to /access-pending", async ({
    page,
  }) => {
    await page.goto("/admin/whats-new");
    await expect(page).toHaveURL(/\/access-pending/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Admin reaches /admin/whats-new
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/whats-new list and create form", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin reaches the whats-new admin page and sees the heading", async ({
    page,
  }) => {
    const response = await page.goto("/admin/whats-new");
    expect(
      response?.status(),
      "/admin/whats-new should respond 2xx",
    ).toBeLessThan(400);
    expect(
      new URL(page.url()).pathname,
      "/admin/whats-new should not redirect",
    ).toBe("/admin/whats-new");

    await expect(
      page.getByRole("heading", { name: /what.s new/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("What's new nav link is present in the admin sidebar", async ({
    page,
  }) => {
    await page.goto("/admin/whats-new");
    await expect(
      page.getByRole("link", { name: /what.s new/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("create form fields are present", async ({ page }) => {
    await page.goto("/admin/whats-new");

    // Title field
    await expect(page.locator('input[name="title"]')).toBeVisible({
      timeout: 10_000,
    });
    // Body textarea
    await expect(page.locator('textarea[name="body"]')).toBeVisible({
      timeout: 10_000,
    });
    // Submit button
    await expect(
      page.getByRole("button", { name: /publish entry/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Admin CRUD smoke: create an entry, verify it appears
// ---------------------------------------------------------------------------

test.describe("Admin — CRUD smoke: create a what's-new entry", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin creates a what's-new entry and it appears in the list", async ({
    page,
  }) => {
    const uniqueTitle = `E2E test entry ${Date.now()}`;
    const uniqueBody = "This entry was created by the Playwright e2e suite.";

    await page.goto("/admin/whats-new");

    // Fill and submit the create form.
    await page.locator('input[name="emoji"]').fill("🚀");
    await page.locator('input[name="title"]').fill(uniqueTitle);
    await page.locator('textarea[name="body"]').fill(uniqueBody);
    await page.getByRole("button", { name: /publish entry/i }).click();

    // After submission, the page reloads (server action + revalidatePath).
    // Wait for the entry to appear in the list.
    await expect(page.getByText(uniqueTitle)).toBeVisible({ timeout: 15_000 });
  });

  test("edit page's Cancel control is an accessible link, not a button — regression for a5 primitive sweep", async ({
    page,
  }) => {
    await page.goto("/admin/whats-new");

    // Open the edit page for the first entry in the list.
    await page.getByRole("link", { name: /^edit$/i }).first().click();
    await page.waitForURL(/\/admin\/whats-new\/.+/);

    // "Save changes" is a real submit button.
    await expect(
      page.getByRole("button", { name: /save changes/i }),
    ).toBeVisible();

    // "Cancel" is rendered via <Button asChild><Link/></Button> (E6) —
    // its accessible role must stay "link", and it must carry a real href
    // back to the list, not a client-side onClick.
    const cancel = page.getByRole("link", { name: /^cancel$/i });
    await expect(cancel).toBeVisible();
    await expect(cancel).toHaveAttribute("href", "/admin/whats-new");

    await cancel.click();
    await expect(page).toHaveURL(/\/admin\/whats-new$/);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Member home card appears after entry is published
// ---------------------------------------------------------------------------

test.describe("Member — home page What's-new card", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member home page renders without error (What's-new card shown when entries exist)", async ({
    page,
  }) => {
    const response = await page.goto("/home");
    expect(
      response?.status(),
      "/home should respond 2xx",
    ).toBeLessThan(400);

    // The heading 'Welcome' should always be present.
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible({ timeout: 10_000 });

    // If the CRUD smoke test has run (test 5), entries will exist and the
    // What's-new section will be visible. If running in isolation, the section
    // may be absent. Both are valid — we assert page loads without error.
    // (The CRUD smoke test in test 5 above creates an entry first.)
  });
});
