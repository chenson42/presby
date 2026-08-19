import { test, expect } from "@playwright/test";
import { generateSync } from "otplib";
import { E2E_USERS } from "./support/users";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";

/**
 * The Phase 4 auth-e2e gate (CLAUDE.md — any change touching
 * `src/app/(auth)/` needs a running-server smoke of the FULL login path,
 * including an MFA-enrolled user, before Phase 5 can begin; P0.5 commit `a6`,
 * work-log 2026-08-19-brand-foundation). This is that smoke.
 *
 * Every other TOTP assertion in the suite (role-boundaries.spec.ts,
 * member-home.spec.ts, post-login-routing.spec.ts) uses mfa-admin, which is
 * deliberately left UN-enrolled — they prove the redirect-to-enrol gate, not
 * a completed challenge. mfa-enrolled (e2e/support/totp-fixture.ts) is the
 * fixture that carries a real, decryptable secret, so this is the one spec
 * that walks credentials → /totp → a verified session end to end, including
 * the rejection path for a wrong code.
 */
test.describe("Full login path with an MFA-enrolled user", () => {
  const USER = E2E_USERS["mfa-enrolled"];

  test("email+password lands on /totp, a wrong code is rejected, and the real code signs in", async ({
    page,
  }) => {
    // (a) — email + password.
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(USER.email);
    await page.locator('input[name="password"]').fill(USER.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();

    // Credentials are correct, but this fixture carries two_factor_required
    // and is enrolled — /launch's computed destination is /admin, and the
    // proxy intercepts that request because the session isn't 2FA-verified
    // yet, landing on /totp with the intended destination preserved in
    // callbackUrl (CLAUDE.md Post-Login Landing: the 2FA challenge fires at
    // the Edge on the destination, not at /launch itself).
    await page.waitForURL(/\/totp/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();

    // (d) — a wrong code is rejected, and the challenge is not consumed.
    await page.getByPlaceholder(/123456/).fill("000000");
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 10_000 });
    await expect(page.getByText(/didn.t match/i)).toBeVisible();

    // (b) — the real code, computed from the same secret the fixture seeded.
    const code = generateSync({ secret: E2E_TOTP_TEST_SECRET });
    await page.getByPlaceholder(/123456/).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();

    // (c) — same shape as the plain `admin` fixture (admin role, no
    // organizations): /launch's matrix lands it on /admin. Reaching it here
    // means the session is now 2FA-verified, which the proxy re-checks on
    // every request to /admin.
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible();
  });
});
