/**
 * invitation-ui.ts - the page-driving helpers the invitation specs share:
 * sign in through the standard form, answer the /totp challenge, find the
 * dead-link heading. Browser-side only; no database.
 */
import { expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { DEAD_LINK_PHRASE } from "./invitation-observer";
import { enterTotpCode } from "./totp-page";

export function deadHeading(page: Page) {
  return page.getByRole("heading", { level: 1 }).filter({ hasText: DEAD_LINK_PHRASE });
}

/** Fills and submits the standard sign-in form (the page must already be on /signin). */
export async function signInOnPage(page: Page, email: string, password: string) {
  const emailInput = page.locator('input[name="email"]');
  await expect(emailInput).toBeEnabled({ timeout: 15_000 });
  await emailInput.fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
}

/**
 * Submits the real code for `secret` on the /totp challenge. If that time step
 * was already spent (an earlier spec, or the enrolment itself), waits for the
 * next one and tries once more. Returns once the page has left /totp.
 */
export async function submitTotp(page: Page, secret: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await enterTotpCode(page, generateSync({ secret }));
    await Promise.race([
      page.waitForURL((url) => url.pathname !== "/totp", { timeout: 15_000 }),
      page.waitForURL(/error=invalid/, { timeout: 15_000 }),
    ]).catch(() => undefined);
    if (new URL(page.url()).pathname !== "/totp") return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_000);
    await page.goto(page.url().replace(/[?&]error=invalid/, ""));
  }
  throw new Error("the TOTP code was rejected twice");
}
