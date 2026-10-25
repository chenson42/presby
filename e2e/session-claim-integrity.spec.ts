import { test, expect } from "@playwright/test";
import { generateSync } from "otplib";
import { E2E_USERS } from "./support/users";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { enterTotpCode } from "./support/totp-page";

/**
 * Session claim integrity (DECISION-230). A browser that has passed only the
 * first factor can reach the session endpoint with a valid CSRF token and any
 * body it likes. That must never change what the 2FA gate sees: the endpoint
 * refuses the request, the gate still sends the session to /totp, and only the
 * real code (which goes through the server-side verification action) completes
 * the sign-in. Runs as the MFA-enrolled fixture against a real dev server.
 */
test.describe("Session claim integrity", () => {
  const USER = E2E_USERS["mfa-enrolled"];

  test("a client-side session update changes nothing; the real code still signs in", async ({
    page,
  }) => {
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(USER.email);
    await page.locator('input[name="password"]').fill(USER.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL(/\/totp/, { timeout: 10_000 });

    // The signed-in browser gets a genuine CSRF token and posts a session
    // update of its own. Refused: no body, no cookie.
    const csrfRes = await page.request.get("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    for (const data of [
      { user: { twoFactorVerified: true } },
      { user: { twoFactorVerified: true, roles: ["Administrator"] } },
      {},
    ]) {
      const res = await page.request.post("/api/auth/session", {
        data: { csrfToken, data },
      });
      expect(res.status()).toBe(405);
      expect(res.headers()["allow"]).toBe("GET");
      expect(res.headers()["set-cookie"]).toBeUndefined();
    }

    // The gate is unmoved: /admin still bounces to the challenge, and the
    // session still reports the second factor as unverified.
    await page.goto("/admin");
    await page.waitForURL(/\/totp/, { timeout: 10_000 });
    await expect(page.getByTestId("greeting-band")).not.toBeVisible();
    const sessionRes = await page.request.get("/api/auth/session");
    const session = (await sessionRes.json()) as {
      user?: { twoFactorVerified?: boolean };
    };
    expect(session.user?.twoFactorVerified).toBe(false);

    // The real code, through the server action, still completes the sign-in.
    const code = generateSync({ secret: E2E_TOTP_TEST_SECRET });
    await enterTotpCode(page, code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(page.getByTestId("greeting-band")).toContainText(USER.name);
    const after = (await (await page.request.get("/api/auth/session")).json()) as {
      user?: { twoFactorVerified?: boolean };
    };
    expect(after.user?.twoFactorVerified).toBe(true);
  });
});
