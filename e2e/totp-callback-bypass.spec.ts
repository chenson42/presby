/**
 * totp-callback-bypass.spec.ts — regression for the Sev-1 2FA bypass fixed in
 * docs/work-log/2026-08-24-totp-callback-bypass-fix.md.
 *
 * Root cause (full account in the work-log's Phase 3): `signInWithCredentials`
 * called `signIn("credentials", { redirectTo: input.callbackUrl })` with
 * NextAuth's default `redirect: true`. When a Server Action reached via
 * `fetch` (not a real browser form POST) throws NEXT_REDIRECT, Next's
 * action-redirect machinery renders the destination route's RSC payload
 * INLINE in the action's own response — no second, browser-visible request
 * ever fires. `src/proxy.ts`'s 2FA gate is Edge middleware keyed on inbound
 * HTTP requests; if the destination never generates one, the gate never runs,
 * and an unverified 2FA-required user reaches a gated page directly.
 *
 * These tests assert on OBSERVED NETWORK REQUESTS and RENDERED DOM CONTENT,
 * not just `page.url()` — a final-URL-only assertion would NOT have caught
 * the original bug (Next can inline a destination's content while the address
 * bar still shows the right-looking URL). See Phase 1's own diagnostic note
 * in the work-log for why this shape of assertion is the one that matters.
 */
import { test, expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { E2E_USERS } from "./support/users";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";

async function signInWithCallback(
  page: Page,
  role: keyof typeof E2E_USERS,
  callbackUrl: string,
) {
  const user = E2E_USERS[role];
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
}

test.describe("2FA callback-bypass regression", () => {
  test("1 — /admin callbackUrl: the bypass path now lands on /totp, proven at the network + DOM level, and the real code still completes sign-in", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    await signInWithCallback(page, "mfa-enrolled", "/admin");

    // The soft-navigated landing must be /totp, not the protected page.
    await page.waitForURL(/\/totp/, { timeout: 10_000 });

    // DOM assertion — the actual security property. Whether or not a discrete
    // GET /admin ever appears in `requests` proves nothing on its own (the
    // inlining mechanism may legitimately apply to the new, SAFE /totp
    // destination too) — what matters is that /admin's content was never
    // rendered into the page.
    await expect(
      page.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).not.toBeVisible();

    // Network-forced re-verification: a REAL top-level navigation Playwright
    // observes directly, from the same session. This reproduces Phase 1's own
    // diagnostic exactly — proving the session the browser holds is genuinely
    // 2FA-unverified and that proxy.ts independently rejects it, not just that
    // the initial soft nav happened to look right.
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/admin");

    // The real code, entered on the /totp landing reached via the forced
    // re-navigation above, still completes sign-in normally.
    const code = generateSync({ secret: E2E_TOTP_TEST_SECRET });
    await page.getByPlaceholder(/123456/).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible();
  });

  test("2 — /o/e2e-alpha callbackUrl: session-expiry / mid-visit re-auth on /o/* is the same vulnerable shape and is covered by the same fix", async ({
    page,
  }) => {
    // mfa-enrolled carries no organizations — irrelevant here. proxy.ts's 2FA
    // gate fires unconditionally on any /o/* pathname BEFORE membership is
    // resolved (membership resolution happens later, in the RSC page, per the
    // (org) contract) — so no org-membership fixture is needed to prove the
    // gate fires.
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    await signInWithCallback(page, "mfa-enrolled", "/o/e2e-alpha");

    await page.waitForURL(/\/totp/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();

    await page.goto("/o/e2e-alpha");
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(
      "/o/e2e-alpha",
    );
  });

  test("3 — control: no callbackUrl still lands on /totp?callbackUrl=/launch and completes to /admin (must not regress totp-full-login.spec.ts's already-safe path)", async ({
    page,
  }) => {
    await page.goto("/signin");
    await page
      .locator('input[name="email"]')
      .fill(E2E_USERS["mfa-enrolled"].email);
    await page
      .locator('input[name="password"]')
      .fill(E2E_USERS["mfa-enrolled"].password);
    await page.getByRole("button", { name: /sign in with email/i }).click();

    await page.waitForURL(/\/totp/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(
      "/launch",
    );

    const code = generateSync({ secret: E2E_TOTP_TEST_SECRET });
    await page.getByPlaceholder(/123456/).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible();
  });

  test("4 — a non-2FA user's direct callbackUrl landing stays one hop, no spurious /totp detour", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    // "admin" carries twoFactorRequired: false and has no organizations, so
    // its /launch-computed destination is /admin — the same shape mfa-enrolled
    // uses in Test 1, isolating the ONE variable that matters (2FA state).
    await signInWithCallback(page, "admin", "/admin");

    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible();

    expect(requests.some((u) => new URL(u).pathname === "/totp")).toBe(false);
  });
});
