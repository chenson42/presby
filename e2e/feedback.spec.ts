/**
 * feedback.spec.ts — Member feedback submission + admin triage.
 *
 * Uses cached storageState from e2e/support/global-setup.ts.
 * Each describe block opts in with test.use({ storageState: ... }).
 *
 * Test skip guards mirror role-boundaries.spec.ts: if the required seed env
 * vars are absent, the test is skipped with a clear message rather than failing.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";


// ---------------------------------------------------------------------------
// Member submits feedback from /account (permanent form — no daily-prompt gating)
// ---------------------------------------------------------------------------
test.describe("Member submits feedback from /account", () => {
  test.use({ storageState: storageStatePath("member") });

  test("shows feedback form and submits successfully", async ({ page }) => {
    await page.goto("/account");

    // The "Send feedback" section should be visible
    await expect(
      page.getByRole("heading", { name: "Send feedback" }),
    ).toBeVisible();

    // Fill the textarea — the label is "Message"
    const textarea = page.getByLabel("Message");
    await expect(textarea).toBeVisible();
    await textarea.fill("This is a test suggestion from the e2e suite.");

    // Click the submit button
    await page.getByRole("button", { name: "Send feedback" }).click();

    // Verify success toast
    await expect(
      page.getByText("Thanks — we read every one."),
    ).toBeVisible({ timeout: 10_000 });

    // Textarea should reset after submission
    await expect(textarea).toHaveValue("");
  });
});

// ---------------------------------------------------------------------------
// Admin views feedback triage page
// ---------------------------------------------------------------------------
test.describe("Admin views /admin/feedback", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin can reach the feedback triage page", async ({ page }) => {
    await page.goto("/admin/feedback");

    // Page should show the feedback heading (not a 403 or redirect)
    await expect(
      page.getByRole("heading", { name: "Member feedback" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("feedback page shows empty state or submission rows", async ({
    page,
  }) => {
    await page.goto("/admin/feedback");

    // Either the empty state or at least one table row should be present
    const emptyState = page.getByText("No feedback yet");
    const tableBody = page.locator("tbody tr");

    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const rowCount = await tableBody.count().catch(() => 0);

    expect(hasEmpty || rowCount > 0).toBe(true);
  });
});
