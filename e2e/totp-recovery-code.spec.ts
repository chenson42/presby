/**
 * totp-recovery-code.spec.ts - the recovery-code path through /totp, the
 * lockout escape hatch (F164: no running-server e2e covered it before; every
 * other spec types only a six-digit code). Review-polish Batch B.
 *
 * totp-fixture.ts seeds exactly one unused recovery code for the mfa-enrolled
 * user; it is single-use, so beforeEach re-seeds it.
 *
 * Asserts the persisted state, not just the DOM: the audit rows the action
 * writes (`totp.recovery_failed`, `totp.recovery_succeeded`) and the code's
 * `used_at`. A wrong code and an unissued-but-well-formed code show the SAME
 * generic copy as a wrong authenticator code (no enumeration).
 */
import { test, expect } from "@playwright/test";
import { E2E_USERS, storageStatePath } from "./support/users";
import { E2E_RECOVERY_CODE, E2E_WRONG_RECOVERY_CODE, seedRecoveryCode } from "./support/totp-fixture";
import { platformSql, type Sql } from "./support/db";
import { enterRecoveryCode, recoveryField, recoveryToggle, totpBox } from "./support/totp-page";

const USER = E2E_USERS["mfa-enrolled"];

test.describe("/totp - recovery code (F164)", () => {
  test.setTimeout(90_000);

  let sql: Sql;
  let userId: string;
  let since: string;

  test.beforeAll(async () => {
    sql = platformSql("totp-recovery-code.spec");
    const rows = (await sql`select id from users where email = ${USER.email}`) as { id: string }[];
    expect(rows).toHaveLength(1);
    userId = rows[0]!.id;
  });

  test.beforeEach(async () => {
    await seedRecoveryCode(sql, userId);
    since = ((await sql`select now() as now`) as { now: string }[])[0]!.now;
  });

  async function auditCounts(): Promise<Record<string, number>> {
    const rows = (await sql`
      select action, count(*)::int as n from audit_events
       where actor_user_id = ${userId}::uuid and created_at >= ${since}::timestamptz and action like 'totp.%'
       group by action`) as { action: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.action, r.n]));
  }

  test("a wrong recovery code is rejected with the generic copy, the right one signs in, and it cannot be used twice", async ({
    page,
    browser,
  }) => {
    // Full credentials sign-in first, as totp-full-login does.
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(USER.email);
    await page.locator('input[name="password"]').fill(USER.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();
    await page.waitForURL(/\/totp/, { timeout: 30_000 });

    // The toggle is reachable by keyboard: Tab from the focused first box until
    // it lands on the toggle (Verify is disabled, so it is skipped), then Enter.
    await expect(totpBox(page, 1)).toBeFocused();
    const toggle = recoveryToggle(page);
    for (let i = 0; i < 12 && !(await toggle.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");

    // Recovery mode: the digit boxes are gone and the one `token` field has focus.
    await expect(recoveryField(page)).toBeFocused();
    await expect(page.locator('[name="token"]')).toHaveCount(1);
    await expect(totpBox(page, 1)).toHaveCount(0);

    // (a) Wrong, but well formed.
    await page.keyboard.type(E2E_WRONG_RECOVERY_CODE);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    await expect(page.getByText(/didn.t match/i)).toBeVisible();
    // The code never travels in the URL.
    expect(page.url()).not.toContain(E2E_WRONG_RECOVERY_CODE);
    expect(page.url().toLowerCase()).not.toContain("zzzz");
    let counts = await auditCounts();
    expect(counts["totp.recovery_failed"]).toBe(1);
    expect(counts["totp.verify_failed"] ?? 0).toBe(0);

    // (b) The failed attempt reloaded the page, so it is back in digit mode; the
    // helper presses the toggle again. The real code signs in.
    await enterRecoveryCode(page, E2E_RECOVERY_CODE);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/admin$/, { timeout: 15_000 });
    await expect(page.getByTestId("greeting-band")).toContainText(USER.name);
    counts = await auditCounts();
    expect(counts["totp.recovery_succeeded"]).toBe(1);

    const used = (await sql`
      select used_at from user_totp_recovery_codes where user_id = ${userId}::uuid`) as { used_at: string | null }[];
    expect(used).toHaveLength(1);
    expect(used[0]!.used_at).not.toBeNull();

    // (c) Single-use: the same code, in a fresh unverified session, now fails with the same copy.
    const context = await browser.newContext({ storageState: storageStatePath("mfa-enrolled") });
    const again = await context.newPage();
    await again.goto("/totp?callbackUrl=%2Fadmin");
    await enterRecoveryCode(again, E2E_RECOVERY_CODE);
    await again.getByRole("button", { name: /^verify$/i }).click();
    await again.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    await expect(again.getByText(/didn.t match/i)).toBeVisible();
    counts = await auditCounts();
    expect(counts["totp.recovery_failed"]).toBe(2);
    expect(counts["totp.recovery_succeeded"]).toBe(1);
    await context.close();
  });

  test("the toggle goes back to the authenticator boxes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("mfa-enrolled") });
    const page = await context.newPage();
    await page.goto("/totp?callbackUrl=%2Fadmin");
    await enterRecoveryCode(page, "WIP");
    await page.getByRole("button", { name: /use my authenticator app instead/i }).click();
    await expect(totpBox(page, 1)).toBeFocused();
    await expect(page.locator('[name="token"]')).toHaveCount(1);
    await expect(recoveryField(page)).toHaveCount(0);
    await context.close();
  });
});
