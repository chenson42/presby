/**
 * totp-challenge.spec.ts - the pre-hydration guard for the /totp challenge
 * (DECISION-192, amending DECISION-159; review-polish Batch B). Same pattern as
 * domains-claim-form.spec.ts: hold every `/_next/static/**.js` chunk, load with
 * `domcontentloaded`, assert the form is inoperable, release the scripts, use
 * control enablement as the hydration signal (no networkidle, no
 * waitForTimeout, no throttling).
 *
 * The persisted state is the point, not just the DOM. Without the gate, a Verify
 * pressed before hydration posts the server-rendered EMPTY `token`; the action
 * counts it as a failed attempt, writes a `totp.verify_failed` audit row and
 * spends one of the ten rate-limit slots. So after the real code completes the
 * sign-in this spec asserts that NO `totp.verify_failed` row exists for the user
 * since the test began.
 *
 * Once released, the typed real code is submitted by its sixth digit with no
 * button press (DECISION-257) and lands on /admin.
 *
 * It also proves the focus rule: box 1 takes focus after hydration, never before
 * (a disabled fieldset cannot take focus).
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in
 * the `prod-build` project. A fresh context from the mfa-enrolled user's
 * credentials-signed-in (not yet TOTP-verified) storage state, so the challenge
 * is the first thing it meets.
 */
import { test, expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { E2E_USERS, storageStatePath } from "../support/users";
import { E2E_TOTP_TEST_SECRET } from "../support/totp-fixture";
import { platformSql, type Sql } from "../support/db";
import {
  enterTotpCode,
  recoveryToggle,
  totpBox,
  totpGroup,
  verifyButton,
  waitForTotpVerified,
} from "../support/totp-page";

/** Holds every `/_next/static/**.js` request until the returned function is called. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("Hydration - /totp challenge (DECISION-192)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let userId: string;

  test.beforeAll(async () => {
    sql = platformSql("hydration/totp-challenge.spec");
    const rows = (await sql`select id from users where email = ${E2E_USERS["mfa-enrolled"].email}`) as { id: string }[];
    expect(rows).toHaveLength(1);
    userId = rows[0]!.id;
  });

  test("the boxes and the toggle are inoperable until hydration, box 1 is focused after it, and no failed attempt is recorded", async ({
    browser,
  }) => {
    // The database's clock, so a skewed laptop clock cannot hide or invent a row.
    const [{ now: since }] = (await sql`select now() as now`) as { now: string }[];

    const context = await browser.newContext({ storageState: storageStatePath("mfa-enrolled") });
    const page = await context.newPage();
    const release = await holdScripts(page);

    await page.goto("/totp?callbackUrl=%2Fadmin", { waitUntil: "domcontentloaded" });

    // Pre-release: server-rendered inside a disabled fieldset.
    await expect(page.locator('fieldset[data-slot="hydration-gate"]').first()).toHaveAttribute("aria-busy", "true");
    await expect(totpGroup(page)).toBeVisible();
    for (let n = 1; n <= 6; n++) await expect(totpBox(page, n)).toBeDisabled();
    await expect(recoveryToggle(page)).toBeDisabled();
    await expect(verifyButton(page)).toBeDisabled();
    // A disabled fieldset cannot take focus, and nothing has grabbed it yet.
    await expect(totpBox(page, 1)).not.toBeFocused();

    release();

    // Hydration is the signal: control enablement, then the focus effect.
    await expect(totpBox(page, 1)).toBeEnabled();
    await expect(recoveryToggle(page)).toBeEnabled();
    await expect(totpBox(page, 1)).toBeFocused();

    // The sixth digit submits the code (DECISION-257): no button press.
    await enterTotpCode(page, generateSync({ secret: E2E_TOTP_TEST_SECRET }));
    await waitForTotpVerified(page, /\/admin$/);

    // The persisted state: the verified sign-in wrote a success row and NO failed attempt.
    const rows = (await sql`
      select action, count(*)::int as n from audit_events
       where actor_user_id = ${userId}::uuid and created_at >= ${since}::timestamptz and action like 'totp.%'
       group by action order by action`) as { action: string; n: number }[];
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    expect(byAction["totp.verify_failed"] ?? 0).toBe(0);
    expect(byAction["totp.recovery_failed"] ?? 0).toBe(0);
    expect(byAction["totp.verify_succeeded"]).toBe(1);

    await context.close();
  });
});
