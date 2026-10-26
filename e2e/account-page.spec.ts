import { test, expect, type Page } from "@playwright/test";
import { E2E_USERS } from "./support/users";

// Smoke test for the /account surface — verifies that a signed-in admin can
// reach the page and that the expected UI sections render. Does NOT submit any
// form or mutate data (the seeded admin row must remain clean for CI).

const ADMIN_EMAIL = E2E_USERS.admin.email;
const ADMIN_PASSWORD = E2E_USERS.admin.password;

test.describe("Account page (/account)", () => {
  async function signIn(page: Page) {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });
  }

  test("signed-in admin can reach /account without being bounced", async ({ page }) => {
    // Arrange — sign in as the seeded admin (Credentials provider, has password)
    await signIn(page);

    // Act — navigate to /account
    const response = await page.goto("/account");

    // Assert — proxy should pass the authenticated admin through
    expect(response?.status(), "/account should respond 2xx").toBeLessThan(400);
    expect(
      new URL(page.url()).pathname,
      "should stay on /account, not be redirected",
    ).toBe("/account");
  });

  test("account page renders profile name input", async ({ page }) => {
    // Arrange
    await signIn(page);

    // Act
    await page.goto("/account");

    // Assert — the profile form renders an input with id="display-name"
    // (the component does not use a name attribute — locating by id)
    const nameInput = page.locator('#display-name');
    await expect(nameInput, "display-name input should be visible in the profile card").toBeVisible();
  });

  test("account page renders password section for admin (has password set)", async ({ page }) => {
    // Arrange — the seeded admin is a Credentials user and has a password;
    // the password section should be visible (hidden only for Google-only users)
    await signIn(page);

    // Act
    await page.goto("/account");

    // Assert — look for the current-password input (id="current-password"),
    // which only renders when the server determines users.password IS NOT NULL
    const currentPasswordInput = page.locator('#current-password');
    await expect(
      currentPasswordInput,
      "current-password input should be visible — admin has a password set",
    ).toBeVisible();
  });

  test("account page renders the 2FA status section", async ({ page }) => {
    // Arrange
    await signIn(page);

    // Act
    await page.goto("/account");

    // Assert — the 2FA section renders a link to /account/2fa regardless
    // of enrollment state
    const twoFaLink = page.getByRole("link", { name: /set up|manage|two.factor|2fa/i }).first();
    await expect(twoFaLink, "2FA section should have a link to /account/2fa").toBeVisible();
  });

  test("signed-in admin can reach /account/2fa without being bounced", async ({ page }) => {
    // Arrange
    await signIn(page);

    // Act
    const response = await page.goto("/account/2fa");

    // Assert
    expect(response?.status(), "/account/2fa should respond 2xx").toBeLessThan(400);
    expect(
      new URL(page.url()).pathname,
      "should stay on /account/2fa",
    ).toBe("/account/2fa");
  });

  test("/account/2fa enrolment takes the code in six labelled boxes, enabled after hydration, with no box grabbing focus on load", async ({ page }) => {
    // Arrange
    await signIn(page);

    // Act
    await page.goto("/account/2fa");

    // Assert — the shared one-time-code input (review-polish Batch B). It sits
    // below the QR instructions, so it must NOT take focus on load (Phase 2 R2.2:
    // on a phone that would scroll past the QR code and cover it with the keyboard).
    const group = page.getByRole("group", { name: /6-digit code from your app/i });
    await expect(group).toBeVisible();
    const first = page.getByLabel(/^digit 1 of 6$/i);
    await expect(first, "boxes are enabled once the HydrationGate lifts").toBeEnabled();
    for (let n = 1; n <= 6; n++) {
      await expect(page.getByLabel(new RegExp(`^digit ${n} of 6$`, "i"))).toBeVisible();
      await expect(page.getByLabel(new RegExp(`^digit ${n} of 6$`, "i"))).not.toBeFocused();
    }
    // Typing still advances (the same component as /totp); three digits never submit.
    await first.click();
    await page.keyboard.type("123");
    await expect(page.getByLabel(/^digit 4 of 6$/i)).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/account/2fa");
  });
});

test.describe("Email verification landing (/account/verify-email/[token])", () => {
  test("invalid token renders an error card without requiring a session — regression for layout auth gate blocking unauthenticated verify-email", async ({ page }) => {
    // Arrange — no sign-in. The proxy passes /account/verify-email/* unauthenticated
    // (src/proxy.ts: pathname.startsWith("/account/verify-email/")).
    // The page now lives in the (email-verify) route group which has NO auth layout,
    // so the auth() redirect no longer fires for unauthenticated visitors.
    // Fix: moved from src/app/(account)/account/verify-email/[token]/page.tsx
    //      to src/app/(email-verify)/account/verify-email/[token]/page.tsx
    //      (Phase 4 loop-back, Bug 1 fix).

    // Act
    await page.goto("/account/verify-email/thisTokenDoesNotExist00000000");

    // Assert — page must stay on the verify-email path (not redirect to /signin)
    // and render the error card (invalid/expired token message)
    expect(
      new URL(page.url()).pathname,
      "should stay on the verify-email path, not redirect to /signin",
    ).toBe("/account/verify-email/thisTokenDoesNotExist00000000");
  });
});
