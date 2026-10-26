import { test, expect } from "@playwright/test";
import { platformSql, withDbRetry } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import { signInOnPage } from "./support/invitation-ui";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { enterTotpCode } from "./support/totp-page";
import {
  createThrowawayUser,
  deleteThrowawayUsers,
  ENROL_PASSWORD,
  readPanelCodes,
  signInViaApi,
  sweepStaleUsers,
  type ThrowawayUser,
} from "./support/enrolment-fixture";
import { generateSync } from "otplib";

/**
 * F344 - minting new recovery codes needs a session that has passed the second
 * factor (docs/work-log/2026-10-26-recovery-codes.md, smoke 6; DECISION-292).
 *
 * Before: regenerateRecoveryCodes checked only that the caller was signed in and
 * enrolled, and /account/2fa is outside the proxy's 2FA wall. A person holding
 * only a password could press Regenerate, read ten fresh codes and use one at
 * /totp. Now the action refuses and audits the attempt, and the page shows a
 * "Confirm it's you" step instead of the button.
 *
 * One throwaway enrolled user (the fixed demo secret, one seeded recovery code):
 *   1. password-only sign-in: the notice, no Regenerate button;
 *   2. the link goes to /totp and returns to /account/2fa; after the code the
 *      button is there, and the new panel SURVIVES the re-render that
 *      revalidatePath sends (the unused count refreshes under it);
 *   3. the refused call: with the page open and verified in tab A, a second
 *      sign-in elsewhere in the same browser resets the shared cookie's claim to
 *      unverified; pressing Regenerate in tab A is refused (the toast), the
 *      stored hashes do not change, and one refusal row is written.
 */

test.setTimeout(150_000);

const PREFIX = "e2e-regen-gate";
const sql = platformSql("totp-regenerate-gate.spec");
const stamp = Date.now();
const created: ThrowawayUser[] = [];
let flags: FlagCapture;

test.beforeAll(async () => {
  await sweepStaleUsers(sql, PREFIX);
  flags = await captureFlags(sql, ["auth.require_2fa"]);
  await setFlag(sql, "auth.require_2fa", true);
});

test.afterAll(async () => {
  await deleteThrowawayUsers(sql, PREFIX, created.map((u) => u.id));
  await flags?.restore();
});

async function hashesOf(userId: string): Promise<string[]> {
  const rows = (await sql`select code_hash from user_totp_recovery_codes where user_id = ${userId}::uuid order by code_hash`) as {
    code_hash: string;
  }[];
  return rows.map((r) => r.code_hash);
}

async function actionsOf(userId: string): Promise<string[]> {
  const rows = (await withDbRetry(
    "read audit actions",
    async () =>
      await sql`select action from audit_events where resource_id = ${userId} and action like 'totp.recovery_codes.%' order by created_at`,
  )) as { action: string }[];
  return rows.map((r) => r.action);
}

test("a password-only session sees the notice, confirms with its app, then regenerates; a stale tab is refused — F344", async ({ page, context }, testInfo) => {
  const user = await createThrowawayUser(sql, { prefix: PREFIX, tag: "a", stamp, twoFactorRequired: true, enrolled: true });
  created.push(user);
  const seeded = await hashesOf(user.id);
  expect(seeded).toHaveLength(1);

  // --- 1. password only: the way back, not the button --------------------------------------------------
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/signin?callbackUrl=/account/2fa");
  await signInOnPage(page, user.email, ENROL_PASSWORD);
  // A required, enrolled account is sent to the challenge at sign-in; the person (or an attacker holding only the
  // password) simply does not answer it, and walks to the account page instead: /account/2fa is outside the 2FA wall.
  await page.waitForURL((url) => url.pathname === "/totp", { timeout: 60_000 });
  await page.goto("/account/2fa");
  await expect(page.getByRole("heading", { name: "Two-factor authentication", level: 1 })).toBeVisible();
  await expect(
    page.getByText("To make new recovery codes, first confirm it's you with your authenticator app or a recovery code."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /regenerate recovery codes/i })).toHaveCount(0);
  const link = page.getByRole("link", { name: "Confirm it's you" });
  await expect(link).toHaveAttribute("href", "/totp?callbackUrl=%2Faccount%2F2fa");
  const box = (await link.boundingBox())!;
  expect(box.height, "the link is a 44px target").toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("f344-notice-360.png"), fullPage: true });

  // --- 2. confirm it's you, come back, regenerate ------------------------------------------------------
  await link.click();
  await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
  await enterTotpCode(page, generateSync({ secret: E2E_TOTP_TEST_SECRET }));
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 30_000 });

  const regenerate = page.getByRole("button", { name: /regenerate recovery codes/i });
  await expect(regenerate).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Confirm it's you" })).toHaveCount(0);
  await expect(page.getByText(/1 unused code remaining \(of 1 total\)/)).toBeVisible();
  await regenerate.click();

  const panelHeading = page.getByRole("heading", { name: "New recovery codes — save these now" });
  await expect(panelHeading).toBeVisible({ timeout: 20_000 });
  const shown = await readPanelCodes(page);
  expect(shown).toHaveLength(10);
  // The revalidatePath re-render has landed when the page's own count says ten: the panel must still be up.
  await expect(page.getByText(/10 unused codes remaining \(of 10 total\)/)).toBeVisible({ timeout: 20_000 });
  await expect(panelHeading).toBeVisible();
  expect(await readPanelCodes(page), "the panel's codes did not change under the re-render").toEqual(shown);
  expect(await page.getByRole("heading", { name: /recovery codes — save these now/i }).count(), "exactly one panel").toBe(1);
  await page.screenshot({ path: testInfo.outputPath("f344-regenerated-360.png"), fullPage: true });
  const afterRegenerate = await hashesOf(user.id);
  expect(afterRegenerate).toHaveLength(10);
  expect(afterRegenerate).not.toContain(seeded[0]);
  expect(await actionsOf(user.id)).toEqual(["totp.recovery_codes.regenerated"]);

  // --- 3. the refused call: a stale tab ----------------------------------------------------------------
  // Reload to get the button back (the panel replaces it), then reset the claim from "another tab".
  await page.reload();
  const again = page.getByRole("button", { name: /regenerate recovery codes/i });
  await expect(again).toBeEnabled({ timeout: 30_000 });
  await signInViaApi(context, user.email, ENROL_PASSWORD); // the shared cookie is now an unverified session
  await again.click();
  await expect(
    page.getByText("Confirm it's you with your authenticator app or a recovery code first. Reload this page to see how."),
  ).toBeVisible({ timeout: 20_000 });
  expect(await hashesOf(user.id), "a refused call changes nothing").toEqual(afterRegenerate);
  expect(await actionsOf(user.id)).toEqual([
    "totp.recovery_codes.regenerated",
    "totp.recovery_codes.regenerate_refused",
  ]);
  expect(await page.getByRole("heading", { name: /recovery codes — save these now/i }).count(), "no panel after a refusal").toBe(0);

  // And the reloaded page now explains the way back.
  await page.reload();
  await expect(page.getByRole("link", { name: "Confirm it's you" })).toBeVisible();
});
