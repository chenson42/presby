/**
 * totp-page.ts - the one place the e2e suite knows how /totp is laid out
 * (review-polish Batch B, Phase 2 R16). The challenge is six digit boxes inside
 * a named group, with a toggle to a single recovery-code field; specs call these
 * helpers instead of reaching for a placeholder or a box locator of their own.
 *
 * Both helpers WAIT for the field to be enabled first: the form sits inside a
 * HydrationGate (a disabled fieldset until the page's JavaScript has run), so a
 * helper that typed straight away would type into a disabled control. Shared by
 * `domains-ui-fixture` and `giving-fixture`, which sign in on a cold server, so
 * the wait is generous.
 *
 * Neither helper presses Verify: a caller asserts on what follows it, and the
 * hydration spec needs the click as its own step.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The wait for hydration on a cold dev server compiling /totp on demand. */
const READY_MS = 30_000;

/** The `role="group"` holding the six digit boxes. */
export function totpGroup(page: Page): Locator {
  return page.getByRole("group", { name: /6-digit code/i });
}

/** Digit box `n` (1-based). */
export function totpBox(page: Page, n: number): Locator {
  return page.getByLabel(new RegExp(`^digit ${n} of 6$`, "i"));
}

export function verifyButton(page: Page): Locator {
  return page.getByRole("button", { name: /^verify$/i });
}

export function recoveryToggle(page: Page): Locator {
  return page.getByRole("button", { name: /use a recovery code instead/i });
}

export function recoveryField(page: Page): Locator {
  return page.getByLabel(/^recovery code$/i);
}

/**
 * Types a six-digit code into the boxes, relying on auto-advance: focus box 1,
 * then send the digits through the keyboard so each lands where focus is.
 */
export async function enterTotpCode(page: Page, code: string): Promise<void> {
  const first = totpBox(page, 1);
  await expect(first).toBeEnabled({ timeout: READY_MS });
  await first.click();
  await page.keyboard.type(code);
}

/** Switches to the recovery field with the toggle and fills it. */
export async function enterRecoveryCode(page: Page, code: string): Promise<void> {
  const toggle = recoveryToggle(page);
  await expect(toggle).toBeEnabled({ timeout: READY_MS });
  await toggle.click();
  const field = recoveryField(page);
  await expect(field).toBeVisible();
  await field.fill(code);
}
