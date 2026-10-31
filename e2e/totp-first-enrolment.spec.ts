import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { platformSql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import { signInOnPage } from "./support/invitation-ui";
import {
  createThrowawayUser,
  deleteThrowawayUsers,
  ENROL_PASSWORD,
  expectNoFreshCodesCookie,
  expectPanelSurvives,
  readPanelCodes,
  recordUrls,
  sessionClaim,
  sweepStaleUsers,
  typeEnrolmentCode,
  type ThrowawayUser,
} from "./support/enrolment-fixture";

/**
 * F166 - what a person sees when they enrol for the first time
 * (docs/work-log/2026-10-26-recovery-codes.md, smokes 2 to 5; DECISION-292).
 *
 * Each case is a throwaway `.invalid` account created here and deleted in afterAll.
 *
 *  2. An administrator who must enrol: /signin?callbackUrl=/admin -> /totp ->
 *     /account/2fa?callbackUrl=/admin. The codes stay up, Continue is /admin, and following
 *     it lands on /admin with NO /totp hop (the session was marked verified).
 *  3. A voluntary enrolment (2FA not required, no callbackUrl): Continue is /launch; the
 *     session is verified.
 *  4. Reload while the codes show: none of the earlier code strings is in the page, and the
 *     management view offers the full-width 44px Continue to the sanitized target. No
 *     fresh-codes cookie exists at any checkpoint of 2 to 4.
 *  5. A hostile callbackUrl (`//evil.example`, `/\evil.example`, `/.//evil.example`) is
 *     replaced by /launch on the panel's Continue and the management view's Continue.
 *
 * 360px throughout (no horizontal scroll).
 */

test.setTimeout(180_000);

const PREFIX = "e2e-first-enrol";
const sql = platformSql("totp-first-enrolment.spec");
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

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

/** Full width of its container and at least 44px tall. */
async function expectFullWidthTarget(page: Page, name: string) {
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  const box = (await link.boundingBox())!;
  const parentWidth = await link.evaluate((el) => el.parentElement!.getBoundingClientRect().width);
  expect(box.height, `${name} is a 44px target`).toBeGreaterThanOrEqual(44);
  expect(Math.abs(box.width - parentWidth), `${name} fills its container`).toBeLessThanOrEqual(1);
}

async function enrolAndSeePanel(page: Page, context: BrowserContext) {
  await typeEnrolmentCode(page, (secret) => generateSync({ secret }));
  await expect(page.getByRole("heading", { level: 1, name: "Two-factor authentication enabled" })).toBeVisible({ timeout: 30_000 });
  await expectPanelSurvives(page);
  await expectNoFreshCodesCookie(context);
  return await readPanelCodes(page);
}

test("an administrator who must enrol: the codes stay, Continue lands on /admin with no /totp hop — F166", async ({ page, context }, testInfo) => {
  const user = await createThrowawayUser(sql, { prefix: PREFIX, tag: "adm", stamp, twoFactorRequired: true, roleName: "admin" });
  created.push(user);
  await page.setViewportSize({ width: 360, height: 740 });

  await page.goto("/signin?callbackUrl=/admin");
  await signInOnPage(page, user.email, ENROL_PASSWORD);
  // The proxy puts /totp in front of /admin; /totp sends an unenrolled person on to enrolment, destination kept.
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 60_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/admin");
  await expectNoFreshCodesCookie(context);

  const urls = recordUrls(page);
  const codes = await enrolAndSeePanel(page, context);
  expect(codes).toHaveLength(10);
  await noHorizontalScroll(page);
  await expectFullWidthTarget(page, "Continue");
  await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/admin");
  await page.screenshot({ path: testInfo.outputPath("first-enrol-admin-360.png"), fullPage: true });

  // --- smoke 4: reload while the codes show ----------------------------------------------------------------
  await page.reload();
  await expect(page.getByText(/you enrolled on/i)).toBeVisible({ timeout: 20_000 });
  const html = await page.content();
  for (const c of codes) expect(html, "an earlier code string is not in the reloaded page").not.toContain(c);
  await expectFullWidthTarget(page, "Continue");
  await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/admin");
  await noHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("first-enrol-management-continue-360.png"), fullPage: true });
  await expectNoFreshCodesCookie(context);

  // --- Continue, from the management view: straight to /admin, no challenge -----------------------------------
  expect((await sessionClaim(page)).twoFactorVerified).toBe(true);
  await page.getByRole("link", { name: "Continue" }).click();
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 30_000 });
  expect(urls.filter((u) => new URL(u).pathname === "/totp"), "no /totp hop after enrolling").toEqual([]);
  await expect(page.getByTestId("greeting-band")).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
  await expectNoFreshCodesCookie(context);
});

test("a voluntary enrolment with no callbackUrl: Continue is /launch and the session is verified — F166", async ({ page, context }, testInfo) => {
  const user = await createThrowawayUser(sql, { prefix: PREFIX, tag: "vol", stamp, twoFactorRequired: false });
  created.push(user);
  await page.setViewportSize({ width: 360, height: 740 });

  await page.goto("/signin?callbackUrl=/launch");
  await signInOnPage(page, user.email, ENROL_PASSWORD);
  await page.waitForURL((url) => url.pathname !== "/signin", { timeout: 60_000 });
  await page.goto("/account/2fa");
  await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();
  expect((await sessionClaim(page)).twoFactorRequired).toBe(false);

  const urls = recordUrls(page);
  const codes = await enrolAndSeePanel(page, context);
  expect(codes).toHaveLength(10);
  await noHorizontalScroll(page);
  await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/launch");
  await page.screenshot({ path: testInfo.outputPath("first-enrol-voluntary-360.png"), fullPage: true });
  expect((await sessionClaim(page)).twoFactorVerified).toBe(true);

  // Reload with no callbackUrl: the management view has no Continue (nothing to continue to); Home is the way out.
  await page.reload();
  await expect(page.getByText(/you enrolled on/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Continue" })).toHaveCount(0);
  const html = await page.content();
  for (const c of codes) expect(html).not.toContain(c);

  await page.goto("/account/2fa");
  await page.goBack().catch(() => undefined);
  expect(urls.filter((u) => new URL(u).pathname === "/totp")).toEqual([]);
  await expectNoFreshCodesCookie(context);
});

for (const [tag, hostile] of [
  ["h1", "//evil.example"],
  ["h2", "/\\evil.example"],
  ["h3", "/.//evil.example"],
] as const) {
  test(`a hostile callbackUrl ${JSON.stringify(hostile)} becomes /launch on the panel's Continue and the management Continue — F166`, async ({ page, context }) => {
    const user = await createThrowawayUser(sql, { prefix: PREFIX, tag, stamp, twoFactorRequired: false });
    created.push(user);
    await page.setViewportSize({ width: 360, height: 740 });

    await page.goto("/signin?callbackUrl=/launch");
    await signInOnPage(page, user.email, ENROL_PASSWORD);
    await page.waitForURL((url) => url.pathname !== "/signin", { timeout: 60_000 });
    await page.goto(`/account/2fa?callbackUrl=${encodeURIComponent(hostile)}`);
    await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();

    await enrolAndSeePanel(page, context);
    const panelHref = await page.getByRole("link", { name: "Continue" }).getAttribute("href");
    expect(panelHref).toBe("/launch");

    await page.reload();
    await expect(page.getByText(/you enrolled on/i)).toBeVisible({ timeout: 20_000 });
    const mgmtHref = await page.getByRole("link", { name: "Continue" }).getAttribute("href");
    expect(mgmtHref).toBe("/launch");
    // The request URL itself carries the hostile text (and Next echoes it in its page payload); what matters is that
    // no link on the page leads there.
    expect(await page.locator('a[href*="evil"]').count(), "no link goes to the hostile host").toBe(0);
  });
}
