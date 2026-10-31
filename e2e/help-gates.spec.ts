/**
 * help-gates.spec.ts - the proxy gate and the in-app links, in a browser (user-help Inc 1).
 *
 * The auth-touching half of the help work: the diff edits src/proxy.ts and two (auth) pages, so
 * this runs against a real server with the MFA-enrolled fixture (CLAUDE.md Phase 4 gate). It
 * pins what unit tests cannot see: that /help is reachable by someone who has a password-only
 * session and has NOT yet proved a second factor, while /o/<slug> still sends the same person to
 * /totp; that a look-alike path still goes to sign-in; and that every in-app link opens the page
 * it names. No flag is read or set.
 */
import { test, expect, type Page } from "@playwright/test";
import { E2E_USERS, storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";

test.describe.configure({ timeout: 120_000 });

async function signInWithPassword(page: Page, who: "mfa-enrolled" | "member") {
  const user = E2E_USERS[who];
  await page.goto("/signin");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
}

test.describe("the proxy gate", () => {
  test("a look-alike path still goes to sign-in for an anonymous visitor", async ({ page }) => {
    for (const path of ["/helpx", "/helpdesk", "/docsx"]) {
      await page.goto(path);
      await page.waitForURL(/\/signin/, { timeout: 15_000 });
      expect(new URL(page.url()).searchParams.get("callbackUrl"), path).toBe(path);
    }
  });

  test("an MFA-enrolled user who has not entered a code reaches /help while /o/<slug> still goes to /totp", async ({ page }) => {
    await signInWithPassword(page, "mfa-enrolled");
    await page.waitForURL(/\/totp/, { timeout: 15_000 });

    // Password-only session, second factor unverified: help is open, with no /totp hop.
    const help = await page.goto("/help/signing-in");
    expect(help?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/help/signing-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The gate is intact: the same session is challenged on the org portal.
    await page.goto(`/o/${E2E_ORGS.alpha.slug}`);
    await page.waitForURL(/\/totp/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe("/totp");
  });
});

test.describe("the in-app links open the page they name", () => {
  test("/signin shows 'Help with signing in', and it opens /help/signing-in", async ({ page }) => {
    await page.goto("/signin");
    const link = page.getByRole("link", { name: "Help with signing in" });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/help\/signing-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("/totp shows 'Help with two-factor sign-in', and it opens /help/using-your-code", async ({ page }) => {
    await signInWithPassword(page, "mfa-enrolled");
    await page.waitForURL(/\/totp/, { timeout: 15_000 });
    const link = page.getByRole("link", { name: "Help with two-factor sign-in" });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/help\/using-your-code$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the marketing home page shows Help to a signed-out visitor", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Help", exact: true }).click();
    await page.waitForURL(/\/help$/);
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
  });

  test.describe("signed in", () => {
    test.use({ storageState: storageStatePath("member") });

    test("the marketing home page shows Help beside Continue and Sign out", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Continue" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.getByRole("link", { name: "Help", exact: true }).click();
      await page.waitForURL(/\/help$/);
    });

    test("the avatar menu's Help opens /help", async ({ page }) => {
      await page.goto("/home");
      await page.getByTestId("avatar-menu-trigger").click();
      await page.getByRole("menuitem", { name: "Help" }).click();
      await page.waitForURL(/\/help$/);
      await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    });

    test("/access-pending shows 'Why can't I see this?', and it lands on the access-pending section", async ({ page }) => {
      // A member with no admin feature is bounced here by the proxy.
      await page.goto("/admin/email-queue");
      await page.waitForURL(/\/access-pending/, { timeout: 15_000 });
      const link = page.getByRole("link", { name: "Why can't I see this?" });
      await expect(link).toBeVisible();
      await link.click();
      await page.waitForURL(/\/help\/why-cant-i-see-this#access-pending$/);
      await expect(page.locator("#access-pending")).toBeVisible();
    });
  });
});
