import { test, expect } from "@playwright/test";
import { E2E_USERS } from "./support/users";

const ADMIN = E2E_USERS.admin;

test.describe("Admin sign-in", () => {
  test("seeded admin reaches the admin dashboard, not /access-pending", async ({ page }) => {
    await page.goto("/signin");

    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();

    // Wait for the sign-in form's post to complete (URL leaves /signin).
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    // Now navigate explicitly to /admin and let the proxy decide. `goto`
    // follows the full redirect chain, so the final `page.url()` is stable.
    // The seeded admin holds the admin role + admin.dashboard feature, so
    // the proxy should allow this through. If session-from-JWT drops the
    // `roles` / `features` claims, the proxy will redirect to
    // /access-pending — caught by the pathname assertion below.
    await page.goto("/admin");

    expect(
      new URL(page.url()).pathname,
      "admin should reach /admin, not be bounced to /access-pending",
    ).toBe("/admin");

    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible();

    // Each admin section appears twice on the dashboard — once in the
    // sidebar nav and once as a card. `.first()` keeps the assertion strict
    // about visibility without caring which instance we're checking.
    for (const linkName of [/users & roles/i, /feature flags/i, /release notes/i, /2fa policy/i]) {
      await expect(page.getByRole("link", { name: linkName }).first()).toBeVisible();
    }
  });

  // NOTE: signing in without a callbackUrl now goes to /launch, which computes
  // a destination from the user's organizations (DECISION-034) — for this
  // fixture, /admin. This test navigates to / explicitly after sign-in, so the
  // assertion on the landing page holds regardless of the post-login
  // destination. `/` itself never redirects a signed-in user, deliberately:
  // they are entitled to read the front page.
  test("landing page swaps Sign in for Sign out and greets the signed-in user", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
    await expect(page.getByText(/welcome back/i)).toHaveCount(0);

    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    await page.goto("/");
    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign out$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);

    // Click sign out, confirm we return to the signed-out variant.
    await page.getByRole("button", { name: /^sign out$/i }).click();
    await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText(/welcome back/i)).toHaveCount(0);
  });

  test("admin can open every linked subpage without a runtime error", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    // The dashboard renders fine even when a downstream page is broken, so
    // /admin alone is a weak signal. Walk into each subpage and assert it
    // returns a 2xx with no Next.js runtime error overlay. This is the
    // assertion that catches a query that throws on the server.
    const subpages: Array<{ path: string; heading: RegExp }> = [
      { path: "/admin/users", heading: /^users$/i },
      { path: "/admin/flags", heading: /feature flags/i },
      { path: "/admin/docs", heading: /release notes/i },
      { path: "/admin/2fa", heading: /two-factor policy/i },
    ];

    for (const { path, heading } of subpages) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should respond 2xx`).toBeLessThan(400);
      expect(new URL(page.url()).pathname, `${path} should not bounce`).toBe(path);
      await expect(
        page.getByRole("heading", { name: heading }).first(),
        `${path} should render its main heading`,
      ).toBeVisible();
    }
  });

  test("2FA policy page renders the congregation list, not the permission-denied card", async ({ page }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL((u) => u.pathname !== "/signin", { timeout: 10_000 });

    await page.goto("/admin/2fa");

    // The denial card shares the h1, so the heading alone proves nothing about
    // the admin.two_factor gate. The Congregations table only renders past it.
    await expect(
      page.getByRole("heading", { name: /congregations/i }),
    ).toBeVisible();
    await expect(page.getByText(/required, but not enrolled/i)).toBeVisible();
  });
});
