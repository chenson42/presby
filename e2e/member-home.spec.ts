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

  // test 2: admin signs in and lands on /admin
  //
  // CONTRACT CHANGE, not a green-tests fix. /home is no longer the post-login
  // destination: /launch is, and it routes this fixture — zero congregations,
  // canAccessAdmin, not isPlatformAdmin — straight to /admin (DECISION-034,
  // DECISION-044). /home itself survives and is asserted below.
  test("seeded admin signs in and lands on /admin", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    // Sign-in is two soft navigations: the action redirects to /launch, which
    // computes a destination and redirects again. Waiting only for "not
    // /signin" lands on /launch, mid-flight.
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

    expect(new URL(page.url()).pathname, "admin should land on /admin").toBe("/admin");
  });

  // test 3: admin reaches Platform admin and Account from the avatar menu
  //
  // CONTRACT CHANGE. The header's four bare links became two menus — identity
  // in the avatar, context in the org switcher. "Admin" is now "Platform
  // admin", and both destinations live behind a click. The destinations
  // themselves are unchanged, which is what this still asserts.
  test("admin reaches Platform admin and Account from the avatar menu", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    // Sign-in is two soft navigations: the action redirects to /launch, which
    // computes a destination and redirects again. Waiting only for "not
    // /signin" lands on /launch, mid-flight.
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

    // The admin now lands on /admin, which has its own sidebar and no
    // GlobalNav. This test is about GlobalNav, so go to the page that has one —
    // otherwise it fails for a reason unrelated to what it asserts.
    await page.goto("/home");

    await page.getByTestId("avatar-menu-trigger").click();
    await expect(
      page.getByRole("menuitem", { name: "Platform admin" }),
      "Platform admin item should be visible for admin user",
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Account" }),
      "Account item should be visible",
    ).toBeVisible();
  });

  // test 4: member signs in and lands on /no-organization, no Admin link
  //
  // CONTRACT CHANGE. A signed-in user with no congregation now gets a page
  // about congregations instead of /home's "you have not been granted any
  // roles yet", which was about platform features and read as a bug (G1).
  test("seeded member user signs in and lands on /no-organization, no Admin link visible", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    // Sign-in is two soft navigations: the action redirects to /launch, which
    // computes a destination and redirects again. Waiting only for "not
    // /signin" lands on /launch, mid-flight.
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

    expect(
      new URL(page.url()).pathname,
      "member should land on /no-organization",
    ).toBe("/no-organization");

    await page.goto("/home");
    await page.getByTestId("avatar-menu-trigger").click();
    await expect(
      page.getByRole("menuitem", { name: "Platform admin" }),
      "Platform admin item should NOT be present for member user",
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Developer" }),
      "Developer item should NOT be present for member user",
    ).toHaveCount(0);
  });

  // test 4b: /home's Quick Links stay real links after the P0.5 a7 primitive
  // sweep — regression for the E6 rule (docs/work-log/2026-08-19-brand-foundation.md):
  // a <Link> styled as a button must be <Button asChild><Link/></Button>, never
  // a bare <Button>, or the accessible role and keyboard behavior change silently.
  test("/home Quick Links render as accessible links, not buttons — regression for a7 primitive sweep", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

    await page.goto("/home");
    await expect(
      page.getByRole("link", { name: "Account settings" }),
      "Account settings should be a real link",
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Admin dashboard" }),
      "Admin dashboard should be a real link, visible for an admin user",
    ).toBeVisible();
  });

  // test 5: member navigating directly to /admin is redirected to /access-pending
  test("member navigating directly to /admin is redirected to /access-pending", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    // Sign-in is two soft navigations: the action redirects to /launch, which
    // computes a destination and redirects again. Waiting only for "not
    // /signin" lands on /launch, mid-flight.
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

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
    // Sign-in is two soft navigations: the action redirects to /launch, which
    // computes a destination and redirects again. Waiting only for "not
    // /signin" lands on /launch, mid-flight.
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

    // CONTRACT CHANGE, and the most interesting assertion in this file now.
    // This fixture used to land on /home, where the 2FA gate did not apply, and
    // only met it when it navigated to /admin. After DECISION-034 it routes to
    // /admin immediately, so the two-hop chain (proxy → /totp → /account/2fa)
    // fires on the FIRST screen after sign-in — which is the point of pulling
    // the gate forward, and a visible behavior change for exactly the users the
    // policy protects. The chain itself is unchanged; where it starts is not.
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
    // Sign-in is two soft navigations: the action redirects to /launch, which
    // computes a destination and redirects again. Waiting only for "not
    // /signin" lands on /launch, mid-flight.
    await page.waitForURL(
      (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
      { timeout: 10_000 },
    );

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
