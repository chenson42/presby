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
 * Typing the sixth digit SUBMITS the code (DECISION-257), so `enterTotpCode`
 * is the whole act: it never presses Verify, and a caller must not either (the
 * button reads "Verifying…" or is gone). A caller then waits for the outcome
 * itself (`waitForTotpVerified`, or the URL it expects). The Verify button is
 * only the fallback, for a wrong-length paste or recovery mode.
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
 * then send the digits through the keyboard so each lands where focus is. The
 * sixth digit submits the code; this returns once the digits are typed.
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

/**
 * Waits for a typed code to be accepted: by default, until the page has left
 * /totp. Pass a regex or predicate for a specific destination. Replaces the
 * old "click Verify, then wait" pair now that the sixth digit submits.
 */
export async function waitForTotpVerified(
  page: Page,
  destination: RegExp | ((url: URL) => boolean) = (url) => !url.pathname.startsWith("/totp"),
  timeout = 15_000,
): Promise<void> {
  await page.waitForURL(destination, { timeout });
}
