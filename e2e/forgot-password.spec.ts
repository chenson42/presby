import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;

/**
 * E2E for the forgot-password request flow. We stop at the "check your email"
 * card — actually consuming a reset token would require intercepting the
 * outbound email, which isn't worth the test complexity for a starter. The
 * unit tests in `password-reset-actions.test.ts` cover the consumption logic.
 */
test.describe("Forgot password", () => {
  test.skip(!ADMIN_EMAIL, "SEED_ADMIN_EMAIL must be set in .env.local");

  test("link on /signin leads to /forgot-password and submit shows success card", async ({ page }) => {
    await page.goto("/signin");

    const forgotLink = page.getByRole("link", { name: /forgot password/i });
    await expect(forgotLink).toBeVisible();
    await forgotLink.click();

    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("heading", { name: /forgot password/i })).toBeVisible();

    await page.locator('input[name="email"]').fill(ADMIN_EMAIL!);
    await page.getByRole("button", { name: /send reset link/i }).click();

    // Enumeration guard: same success card regardless of whether the email
    // exists. We use the seeded admin's real email so this exercises the
    // happy path; an unknown email should produce identical UI.
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
    await expect(page.getByText(/expires in 60 minutes/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /back to sign in/i })).toBeVisible();
  });

  test("unknown email produces the same success card (no enumeration)", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.locator('input[name="email"]').fill("nonexistent@example.invalid");
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  });
});
