/**
 * role-boundaries.spec.ts — Proxy-gate enforcement using injected storageState.
 *
 * Scope: navigation-and-redirect assertions only. These tests probe proxy.ts
 * gate behavior (redirect on access denial). They do NOT probe server-action
 * permission checks — server actions are not accessible via page.request.post()
 * to a static URL in the starter's architecture, and their authorization is
 * covered by unit tests (api-developer domain). Future spec authors must not
 * attempt to POST to server action URLs here.
 *
 * storageState for each role is produced by e2e/support/global-setup.ts.
 * The mfa-admin storageState is intentionally NOT TOTP-verified
 * (twoFactorRequired=true, twoFactorVerified=false). Use it ONLY to assert
 * the /totp redirect fires. Do not use it to test /admin page content.
 *
 * Fixture identities live in e2e/support/users.ts; globalSetup provisions them.
 * Delete e2e/support/.auth/ if a fixture email ever changes.
 */

import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";


// Test 1 — Unauthenticated: /home redirects to /signin
test("unauthenticated visit to /home redirects to /signin with callbackUrl", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/signin/);
  const url = new URL(page.url());
  expect(url.searchParams.get("callbackUrl")).toBe("/home");
});

// Test 2 — Member: /admin is blocked → /access-pending?from=%2Fadmin
test.describe("Member — /admin blocked", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin is redirected to /access-pending with from param", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/access-pending/);
    const url = new URL(page.url());
    expect(url.searchParams.get("from")).toBe("/admin");
  });
});

// Test 3 — MFA-admin: /admin triggers two-hop redirect gate
// After the fix in 2026-07-02-totp-enrollment-redirect: the mfa-admin (no
// enrollment) is now redirected from /totp → /account/2fa. Test 3 asserts
// the two-hop chain (proxy → /totp → /account/2fa) and stops there — the
// fixture cannot complete enrollment.
test.describe("MFA-admin — two-hop redirect gate", () => {
  // Session is intentionally NOT TOTP-verified (twoFactorRequired=true,
  // twoFactorVerified=false). Use only to assert the /totp redirect fires.
  test.use({ storageState: storageStatePath("mfa-admin") });

  test("mfa-admin navigating to /admin is redirected to /account/2fa with callbackUrl (proxy → /totp → /account/2fa)", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\/2fa/);
    const url = new URL(page.url());
    expect(url.searchParams.get("callbackUrl")).toBe("/admin");
  });
});

// Test 4 — Admin: /admin is reachable (positive gate)
test.describe("Admin — positive gate", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin navigating to /admin reaches the admin dashboard", async ({
    page,
  }) => {
    await page.goto("/admin");
    expect(page.url()).toMatch(/\/admin/);
  });
});

// Test 5 — Member: /admin/feedback is blocked by proxy → /access-pending
test.describe("Feedback admin gate — member cannot access /admin/feedback", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/feedback is redirected to /access-pending", async ({
    page,
  }) => {
    await page.goto("/admin/feedback");
    // proxy.ts gates all /admin/* routes behind admin.dashboard; members
    // without that feature are sent to /access-pending before the page-level
    // check ever runs.
    await expect(page).toHaveURL(/\/access-pending/);
  });
});
