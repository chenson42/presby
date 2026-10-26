import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { generateSync } from "otplib";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { E2E_TOTP_TEST_SECRET, seedTotpEnrollment } from "./support/totp-fixture";
import { enterTotpCode } from "./support/totp-page";

/**
 * F284 - /developer is 2FA-gated at the Edge and again in the page gate.
 *
 * The Phase 4 auth-e2e gate for the developer-portal pipeline (src/proxy.ts is
 * auth-touching): a platform administrator whose account REQUIRES a second
 * factor and has not verified it must be sent to /totp from any /developer path,
 * schema.json included, and must come back to that same path after a real code.
 *
 * The user is a throwaway: `e2e-devportal-<stamp>-<tag>@example.invalid`, a
 * platform administrator (`is_platform_admin`) with a real TOTP enrolment, so
 * the code is computable from E2E_TOTP_TEST_SECRET. It is removed in afterAll
 * behind a guard on the run's own prefix; no roster user is touched and no
 * person row is created.
 */

const STAMP = `${Date.now()}`;
const PREFIX = `e2e-devportal-${STAMP}-`;
const EMAIL = `${PREFIX}mfa@example.invalid`;
const PLAIN_EMAIL = `${PREFIX}plain@example.invalid`;
const PASSWORD = "e2e-devportal-throwaway-not-a-secret";
const TABLE_PATH = "/developer/tables/roll_actions";

let sql: Sql;

function assertOwnAddress(address: string): void {
  if (!address.startsWith("e2e-devportal-") || !address.endsWith("@example.invalid")) {
    throw new Error(`[developer-2fa-gate] refusing to touch "${address}"`);
  }
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  sql = platformSql("developer-2fa-gate");
  assertOwnAddress(EMAIL);
  assertOwnAddress(PLAIN_EMAIL);
  // A crashed earlier run may have left its user behind.
  await withDbRetry(
    "sweep stale devportal users",
    () => sql`delete from users where email like 'e2e-devportal-%@example.invalid'`,
  );
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [row] = (await withDbRetry(
    "create devportal user",
    () => sql`
      insert into users (email, name, password, email_verified, is_active,
                         two_factor_required, is_platform_admin)
      values (${EMAIL}, 'E2E Devportal Admin', ${hash}, now(), true, true, true)
      returning id`,
  )) as { id: string }[];
  await seedTotpEnrollment(sql, row.id);
  // Signed in with a password, no second factor required, NOT a platform administrator.
  await withDbRetry(
    "create plain devportal user",
    () => sql`
      insert into users (email, name, password, email_verified, is_active,
                         two_factor_required, is_platform_admin)
      values (${PLAIN_EMAIL}, 'E2E Devportal Plain', ${hash}, now(), true, false, false)`,
  );
});

test.afterAll(async () => {
  assertOwnAddress(EMAIL);
  assertOwnAddress(PLAIN_EMAIL);
  await withDbRetry(
    "delete devportal users",
    () => sql`delete from users where email = any(${[EMAIL, PLAIN_EMAIL]})`,
  );
});

async function signIn(
  page: import("@playwright/test").Page,
  callbackUrl: string,
  email: string = EMAIL,
) {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in with email/i }).click();
}

async function verifyTotp(page: import("@playwright/test").Page) {
  await enterTotpCode(page, generateSync({ secret: E2E_TOTP_TEST_SECRET }));
  await page.getByRole("button", { name: /^verify$/i }).click();
}

test.describe("a required, unverified second factor", () => {
  test("1 - /developer/tables/<t> goes to /totp, never renders unverified, and returns to the same path after a real code", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));

    await signIn(page, TABLE_PATH);
    await page.waitForURL(/\/totp/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(TABLE_PATH);
    await expect(
      page.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();
    // Nothing of the portal rendered in between.
    await expect(page.getByText(/roll_actions/)).toHaveCount(0);

    // Going straight to the deep link while still unverified is challenged too.
    await page.goto(TABLE_PATH);
    await page.waitForURL(/\/totp/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(TABLE_PATH);
    await expect(page.getByText(/roll_actions/)).toHaveCount(0);

    await verifyTotp(page);
    await page.waitForURL(`**${TABLE_PATH}`, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "roll_actions" })).toBeVisible();
  });

  test("2 - /developer/schema.json is a redirect to /totp, not JSON, for the unverified user; JSON once verified", async ({
    page,
  }) => {
    await signIn(page, "/developer");
    await page.waitForURL(/\/totp/, { timeout: 30_000 });

    // The raw request shares the page's cookies; do not follow the redirect.
    const unverified = await page.request.get("/developer/schema.json", {
      maxRedirects: 0,
    });
    expect(unverified.status()).toBe(307);
    const location = new URL(unverified.headers()["location"], "http://localhost");
    expect(location.pathname).toBe("/totp");
    expect(location.searchParams.get("callbackUrl")).toBe("/developer/schema.json");

    // The browser lands on /totp as well, with no JSON body.
    await page.goto("/developer/schema.json");
    await page.waitForURL(/\/totp/, { timeout: 30_000 });
    await expect(page.getByText(/"invariants"/)).toHaveCount(0);

    await verifyTotp(page);
    // The challenge returns to the path that was asked for: the JSON itself.
    await page.waitForURL("**/developer/schema.json", { timeout: 60_000 });
    await expect(page.locator("body")).toContainText('"invariants"');

    const verified = await page.request.get("/developer/schema.json");
    expect(verified.status()).toBe(200);
    expect(verified.headers()["cache-control"]).toBe("no-store");
    const body = await verified.json();
    for (const inv of body.invariants as Array<{ enforcement: string; source: unknown }>) {
      expect(["database", "trigger", "paper"]).toContain(inv.enforcement);
      expect(inv).toHaveProperty("source");
    }
    expect(body.tables.length).toBeGreaterThan(100);
    expect(
      body.tables.filter((t: { module: string }) => t.module === "Unclassified"),
    ).toHaveLength(0);
  });

  test("3 - the boundary is a path segment: /developerx is not challenged", async ({ page }) => {
    await signIn(page, "/developer");
    await page.waitForURL(/\/totp/, { timeout: 30_000 });

    const res = await page.goto("/developerx");
    expect(res?.status()).toBe(404);
    expect(page.url()).not.toMatch(/\/totp/);
  });
});

test.describe("signed out", () => {
  test("a deep link goes to /signin carrying the same path", async ({ page }) => {
    await page.goto(TABLE_PATH);
    await page.waitForURL(/\/signin/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(TABLE_PATH);
  });
});

test.describe("signed in but not entitled", () => {
  test("schema.json answers 403 forbidden as no-store JSON", async ({ page }) => {
    await signIn(page, "/home", PLAIN_EMAIL);
    await page.waitForURL((u) => !/\/signin/.test(u.pathname), { timeout: 60_000 });

    const res = await page.request.get("/developer/schema.json", { maxRedirects: 0 });
    expect(res.status()).toBe(403);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});
