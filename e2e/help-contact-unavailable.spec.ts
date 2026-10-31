/**
 * /help/contact with NO Turnstile keys: the default lane's server has none (the contact lane,
 * `npm run test:e2e:contact`, is the one that has them), so the page must be the unavailable block, not
 * a form that cannot work (user-help Increment 2, docs/work-log/2026-10-31-help-contact.md, Phase 3
 * "E2E", the default lane). Anonymous, 360px: the exit keeps the visitor from a dead end (FC9).
 *
 * If this spec fails with a form on screen, the server it ran against has NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * and TURNSTILE_SECRET_KEY set; that is the contact lane's server, not the default one.
 */
import { test, expect } from "@playwright/test";
import { HELP_CONTACT_EXIT_COPY as EXIT, HELP_CONTACT_FORM_COPY as COPY } from "../src/lib/help-contact/copy";

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 360, height: 740 } });

test.describe("/help/contact without Turnstile keys", () => {
  test("renders the unavailable block with its exit: HTTP 200, noindex, no form, no overflow", async ({ page }) => {
    const res = await page.goto("/help/contact");
    expect(res?.status()).toBe(200);
    expect(res?.headers()["set-cookie"]).toBeUndefined();
    expect(new URL(page.url()).pathname).toBe("/help/contact");

    expect((await page.locator('meta[name="robots"]').first().getAttribute("content")) ?? "").toContain("noindex");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY.title);

    const block = page.getByTestId("contact-unavailable");
    await expect(block.getByRole("heading", { name: EXIT.unavailableHeading })).toBeVisible();
    await expect(block).toContainText(EXIT.unavailableBody);
    await expect(block.getByTestId("contact-exit")).toContainText(EXIT.line1);
    await expect(block.getByRole("link", { name: /PresbyPortal repository/ })).toHaveAttribute("href", "https://github.com/chenson42/presby");

    await expect(page.getByTestId("contact-form")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
