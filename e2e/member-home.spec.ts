import { test, expect } from "@playwright/test";
import { E2E_USERS } from "./support/users";

const ADMIN_EMAIL = E2E_USERS.admin.email;
const ADMIN_PASSWORD = E2E_USERS.admin.password;
const MEMBER_EMAIL = E2E_USERS.member.email;
const MEMBER_PASSWORD = E2E_USERS.member.password;
const MFA_ADMIN_EMAIL = E2E_USERS["mfa-admin"].email;
const MFA_ADMIN_PASSWORD = E2E_USERS["mfa-admin"].password;

test.describe("Member home and routing invariants", () => {
  // test 1: unauthenticated redirect — no seeded users needed
  test("unauthenticated user visiting /home is redirected to /signin", async ({ page }) => {
    await page.goto("/home");
    const url = new URL(page.url());
    expect(url.pathname, "should redirect to /signin").toBe("/signin");
    expect(
      url.searchParams.get("callbackUrl"),
      "callbackUrl should be /home",
    ).toBe("/home");
  });

  // test 2: admin signs in and lands on /home
  test("seeded admin signs in and lands on /home", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    expect(new URL(page.url()).pathname, "admin should land on /home").toBe("/home");
  });

  // test 3: admin sees Admin link and Account link in global nav
  test("admin sees Admin link and Account link in global nav", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    await expect(
      page.getByRole("link", { name: /^admin$/i }),
      "Admin link should be visible for admin user",
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^account$/i }),
      "Account link should be visible",
    ).toBeVisible();
  });

  // test 4: member signs in and lands on /home, no Admin link
  test("seeded member user signs in and lands on /home, no Admin link visible", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    expect(new URL(page.url()).pathname, "member should land on /home").toBe("/home");
    await expect(
      page.getByRole("link", { name: /^admin$/i }),
      "Admin link should NOT be visible for member user",
    ).toHaveCount(0);
  });

  // test 5: member navigating directly to /admin is redirected to /access-pending
  test("member navigating directly to /admin is redirected to /access-pending", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    await page.goto("/admin");
    expect(
      new URL(page.url()).pathname,
      "member should be bounced to /access-pending when visiting /admin",
    ).toBe("/access-pending");
  });

  // test 6: user with twoFactorRequired=true and no enrollment navigating to /admin
  // is redirected through the two-hop chain: proxy → /totp → /account/2fa
  test("user with twoFactorRequired=true navigating to /admin is redirected to /account/2fa via two-hop chain", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(MFA_ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(MFA_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    // 2FA is NOT required for /home — the user should land there first.
    expect(
      new URL(page.url()).pathname,
      "MFA admin should land on /home (2FA gate does not apply to /home)",
    ).toBe("/home");

    // Now navigate to /admin — the proxy gates it behind TOTP. Because the
    // mfa-admin has no enrollment, /totp immediately redirects to /account/2fa
    // (two-hop chain: proxy → /totp → /account/2fa).
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\/2fa/);
    const afterAdminUrl = new URL(page.url());
    expect(
      afterAdminUrl.searchParams.get("callbackUrl"),
      "callbackUrl should be /admin",
    ).toBe("/admin");
  });

  // test 7: access-pending page has a Back to home link
  test("access-pending page has a Back to home link", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    // Navigate directly to /access-pending (the page is in PUBLIC_PATHS so it
    // loads without triggering a proxy redirect from an /admin attempt).
    await page.goto("/access-pending");
    await expect(
      page.getByRole("link", { name: /back to home/i }),
      "access-pending should show a Back to home link pointing to /home",
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /back to home/i }),
    ).toHaveAttribute("href", "/home");
  });
});
