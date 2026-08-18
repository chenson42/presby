/**
 * admin-audit.spec.ts — Audit log viewer at /admin/audit.
 *
 * Uses cached storageState from e2e/support/global-setup.ts (same as
 * role-boundaries.spec.ts and feedback.spec.ts).
 *
 * Test 1 — Admin: /admin/audit renders the page heading and "Audit Log" nav link.
 * Test 2 — Member: /admin/audit is blocked at the proxy level by the
 *   /^\/admin/ ADMIN_DASHBOARD catch-all rule; the member is redirected to
 *   /access-pending before the page-level hasFeature(ADMIN_AUDIT) check runs.
 *   (The inline-403 "You don't have permission" paragraph is reached only by a
 *   user who has admin.dashboard but NOT admin.audit — e.g. a partial-admin
 *   created in a fork.  The seeded member user has neither, so the proxy bounce
 *   is the observable outcome in this environment.)
 * Test 3 — Admin: filter smoke — ?action=feature_flag.toggled renders without a
 *   server error (may show 0 rows; the zero-filter empty state is acceptable).
 */

import { test, expect } from "@playwright/test";
import path from "node:path";

function storageStatePath(role: "admin" | "member"): string {
  return path.resolve(__dirname, "support", ".auth", `${role}.json`);
}

const HAVE_ADMIN = !!(
  process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD
);
const HAVE_MEMBER = !!(
  process.env.SEED_MEMBER_EMAIL && process.env.SEED_MEMBER_PASSWORD
);

// ---------------------------------------------------------------------------
// Test 1 — Admin sees the audit log page
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/audit", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin reaches the audit log page and sees the heading", async ({
    page,
  }) => {
    test.skip(!HAVE_ADMIN, "SEED_ADMIN_EMAIL/PASSWORD not set");

    const response = await page.goto("/admin/audit");
    expect(response?.status(), "/admin/audit should respond 2xx").toBeLessThan(
      400,
    );
    expect(
      new URL(page.url()).pathname,
      "/admin/audit should not redirect",
    ).toBe("/admin/audit");

    await expect(
      page.getByRole("heading", { name: /audit log/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Audit Log nav link is present in the sidebar", async ({ page }) => {
    test.skip(!HAVE_ADMIN, "SEED_ADMIN_EMAIL/PASSWORD not set");

    await page.goto("/admin/audit");

    await expect(
      page.getByRole("link", { name: /audit log/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Member is blocked (proxy bounce to /access-pending)
// ---------------------------------------------------------------------------

test.describe("Member — /admin/audit blocked by proxy", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/audit is redirected to /access-pending", async ({
    page,
  }) => {
    test.skip(!HAVE_MEMBER, "SEED_MEMBER_EMAIL/PASSWORD not set");

    // The proxy's /^\/admin/ catch-all gate requires admin.dashboard.
    // The seeded member has no admin features, so the proxy redirects them
    // to /access-pending before the page-level hasFeature(ADMIN_AUDIT) check
    // ever runs.
    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/\/access-pending/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Filter smoke (admin, with action filter)
// ---------------------------------------------------------------------------

test.describe("Admin — audit filter smoke", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("filtered URL renders without server error (may show zero rows)", async ({
    page,
  }) => {
    test.skip(!HAVE_ADMIN, "SEED_ADMIN_EMAIL/PASSWORD not set");

    const response = await page.goto(
      "/admin/audit?action=feature_flag.toggled",
    );
    expect(response?.status(), "filter URL should respond 2xx").toBeLessThan(
      400,
    );
    expect(
      new URL(page.url()).pathname,
      "filter URL should not redirect",
    ).toBe("/admin/audit");

    // Either the table rows or the zero-filter empty state should be present.
    const heading = page.getByRole("heading", { name: /audit log/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});
