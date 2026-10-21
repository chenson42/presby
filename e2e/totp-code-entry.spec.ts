/**
 * totp-code-entry.spec.ts - how the six digit boxes on /totp behave in a real
 * browser (review-polish Batch B): focus on box 1 once hydrated, typing
 * advances, Backspace and Delete work across boxes, a pasted or autofilled code
 * is spread across the boxes, the recovery toggle leaves exactly one `token`
 * field in the page, and the boxes fit a 360px phone.
 *
 * jsdom covers the component's logic (one-time-code-input.test.tsx); this proves
 * what jsdom cannot: real focus, real key events, the real clipboard, layout.
 *
 * Each test starts from the mfa-enrolled user's credentials-signed-in storage
 * state, so /totp is the first thing it meets. The full credentials-to-verified
 * path is totp-full-login.spec.ts's job. Nothing here submits a code except the
 * one failed-attempt test (rate limiting is off in e2e).
 */
import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { enterTotpCode, recoveryToggle, totpBox, totpGroup, verifyButton } from "./support/totp-page";

test.use({ storageState: storageStatePath("mfa-enrolled") });

async function openChallenge(page: Page) {
  await page.goto("/totp?callbackUrl=%2Fadmin");
  await expect(totpBox(page, 1)).toBeEnabled({ timeout: 30_000 });
}

async function boxValues(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (let n = 1; n <= 6; n++) out.push(await totpBox(page, n).inputValue());
  return out;
}

test.describe("/totp digit boxes", () => {
  test("box 1 has focus once the page has hydrated", async ({ page }) => {
    await openChallenge(page);
    await expect(totpBox(page, 1)).toBeFocused();
  });

  test("typing advances box to box, then focus moves to Verify without submitting", async ({ page }) => {
    await openChallenge(page);
    await page.keyboard.type("4");
    await expect(totpBox(page, 2)).toBeFocused();
    await page.keyboard.type("82");
    await expect(totpBox(page, 4)).toBeFocused();
    await expect(verifyButton(page)).toBeDisabled();
    await page.keyboard.type("915");
    await expect(verifyButton(page)).toBeEnabled();
    await expect(verifyButton(page)).toBeFocused();
    expect(await boxValues(page)).toEqual(["4", "8", "2", "9", "1", "5"]);
    await expect(page.locator('input[name="token"]')).toHaveValue("482915");
    // No auto-submit: a typo would spend one of ten attempts.
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(page.url()).not.toContain("error");
  });

  test("a non-digit keystroke is ignored", async ({ page }) => {
    await openChallenge(page);
    await page.keyboard.type("a-");
    await expect(totpBox(page, 1)).toBeFocused();
    expect(await boxValues(page)).toEqual(["", "", "", "", "", ""]);
  });

  test("Backspace and Delete erase across boxes", async ({ page }) => {
    await openChallenge(page);
    await page.keyboard.type("123");
    await expect(totpBox(page, 4)).toBeFocused();

    // Backspace on the empty box 4 steps back and clears box 3.
    await page.keyboard.press("Backspace");
    await expect(totpBox(page, 3)).toBeFocused();
    expect(await boxValues(page)).toEqual(["1", "2", "", "", "", ""]);

    // Delete on the (now empty) box 3 does the same, one box further back.
    await page.keyboard.press("Delete");
    await expect(totpBox(page, 2)).toBeFocused();
    expect(await boxValues(page)).toEqual(["1", "", "", "", "", ""]);

    // Backspace on a FILLED box clears it in place.
    await page.keyboard.type("9");
    await page.keyboard.press("ArrowLeft");
    await expect(totpBox(page, 2)).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(totpBox(page, 2)).toBeFocused();
    expect(await boxValues(page)).toEqual(["1", "", "", "", "", ""]);

    // Keep pressing: it unwinds to the start and stops there.
    await page.keyboard.press("Delete");
    await expect(totpBox(page, 1)).toBeFocused();
    await page.keyboard.press("Delete");
    expect(await boxValues(page)).toEqual(["", "", "", "", "", ""]);
    await expect(totpBox(page, 1)).toBeFocused();
  });

  test("arrow keys, Home and End move between boxes", async ({ page }) => {
    await openChallenge(page);
    await page.keyboard.type("12");
    await page.keyboard.press("ArrowLeft");
    await expect(totpBox(page, 2)).toBeFocused();
    await page.keyboard.press("End");
    await expect(totpBox(page, 6)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(totpBox(page, 1)).toBeFocused();
  });

  test("a code pasted from the real clipboard (with a space) fills every box", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openChallenge(page);
    await page.evaluate(() => navigator.clipboard.writeText("482 915"));
    await totpBox(page, 1).click();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator('input[name="token"]')).toHaveValue("482915");
    expect(await boxValues(page)).toEqual(["4", "8", "2", "9", "1", "5"]);
    await expect(verifyButton(page)).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe("/totp");
  });

  test("a paste landing in a later box still takes the first six digits from box 1", async ({ page }) => {
    await openChallenge(page);
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>('[aria-label="Digit 4 of 6"]')!;
      const data = new DataTransfer();
      data.setData("text", "98-76-54-32\n");
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('input[name="token"]')).toHaveValue("987654");
  });

  test("a whole-code input event on box 1 (one-time-code autofill, a keyboard suggestion) is spread across the boxes", async ({
    page,
  }) => {
    await openChallenge(page);
    // fill() sets the whole value and fires one input event: what iOS and Android autofill do.
    await totpBox(page, 1).fill("482915");
    expect(await boxValues(page)).toEqual(["4", "8", "2", "9", "1", "5"]);
    await expect(page.locator('input[name="token"]')).toHaveValue("482915");
    await expect(verifyButton(page)).toBeEnabled();
  });

  test("the recovery toggle leaves exactly one `token` field in either mode", async ({ page }) => {
    await openChallenge(page);
    await expect(page.locator('[name="token"]')).toHaveCount(1);
    await expect(page.locator('input[type="hidden"][name="token"]')).toHaveCount(1);

    await recoveryToggle(page).click();
    await expect(page.locator('[name="token"]')).toHaveCount(1);
    await expect(page.locator('input[name="token"]:not([type="hidden"])')).toHaveCount(1);
    await expect(totpGroup(page)).toHaveCount(0);

    await page.getByRole("button", { name: /use my authenticator app instead/i }).click();
    await expect(page.locator('[name="token"]')).toHaveCount(1);
    await expect(page.locator('input[type="hidden"][name="token"]')).toHaveCount(1);
    await expect(totpBox(page, 1)).toBeFocused();
  });

  test("a wrong code shows the error, keeps the code out of the URL, and returns focus to box 1", async ({ page }) => {
    await openChallenge(page);
    await enterTotpCode(page, "000000");
    await verifyButton(page).click();
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(page.url()).not.toContain("000000");
    await expect(page.locator("#totp-error")).toContainText(/didn.t match/i);
    await expect(totpBox(page, 1)).toBeEnabled();
    await expect(totpBox(page, 1)).toBeFocused();
    // Boxes are cleared, not echoing the failed code, and flagged invalid.
    expect(await boxValues(page)).toEqual(["", "", "", "", "", ""]);
    await expect(totpBox(page, 1)).toHaveAttribute("aria-invalid", "true");
  });

  test("at 360px every box is inside the viewport and at least 44px wide", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openChallenge(page);
    for (let n = 1; n <= 6; n++) {
      const box = await totpBox(page, n).boundingBox();
      expect(box, `box ${n}`).not.toBeNull();
      expect(box!.width, `box ${n} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `box ${n} height`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `box ${n} left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `box ${n} right edge`).toBeLessThanOrEqual(360);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
