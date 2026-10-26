/**
 * totp-enrol-handoff.spec.ts - first enrolment keeps the recovery codes on screen
 * (F166, DECISION-292; docs/work-log/2026-10-26-recovery-codes.md, smoke 1b).
 *
 * Why this lives in e2e/hydration/: the property is a framework one. Finishing
 * enrolment marks the session verified, which writes the session cookie, and in
 * Next 16 any cookie write in a server action re-renders the current route. The
 * page used to swap the enrolment form for the management view at that moment and
 * the codes went with it. The fix holds them in a client component that sits at
 * the root of every branch of the page, so React keeps its state through the
 * re-render. Whether React does is a property of the BUILT app as much as the dev
 * one, so the spec runs in both lanes: `chromium` (dev server) and `prod-build`
 * (`npm run test:e2e:prod`, a production build on its own port).
 *
 * A throwaway required user with no organization (so the production lane needs no
 * seeded congregation): signs in, is walked to /account/2fa?callbackUrl=/launch,
 * types a real code computed from the key the page shows, and:
 *   - the panel with ten codes is visible, and STILL visible after the re-render
 *     settles (network idle plus a dwell; "You enrolled on" never appears);
 *   - GET /api/auth/session then says twoFactorVerified: true (the no-organization
 *     stand-in for "no second challenge": there is no /o/<slug> to be bounced from);
 *   - Continue's href is /launch, and following it never visits /totp;
 *   - no fresh-codes cookie exists at any point;
 *   - the database holds the enrolment, ten hashed codes and a totp.enrolled audit
 *     row saying sessionVerified;
 * all at 360px with no horizontal scroll, Continue at least 44px tall.
 */
import { test, expect } from "@playwright/test";
import { generateSync } from "otplib";
import { platformSql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import { signInOnPage } from "../support/invitation-ui";
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
} from "../support/enrolment-fixture";

test.setTimeout(150_000);

const PREFIX = "e2e-handoff";
const sql = platformSql("hydration/totp-enrol-handoff.spec");
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

test("the ten codes stay on screen through the re-render, the session is verified, Continue goes on without a /totp hop — F166", async ({ page, context }, testInfo) => {
  const user = await createThrowawayUser(sql, { prefix: PREFIX, tag: "a", stamp: Date.now(), twoFactorRequired: true });
  created.push(user);
  await page.setViewportSize({ width: 360, height: 740 });

  await page.goto("/signin?callbackUrl=/launch");
  await signInOnPage(page, user.email, ENROL_PASSWORD);
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 60_000 });
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
  await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();
  await expectNoFreshCodesCookie(context);
  expect((await sessionClaim(page)).twoFactorVerified, "not verified before enrolling").toBe(false);

  const urls = recordUrls(page);
  await typeEnrolmentCode(page, (secret) => generateSync({ secret }));

  // The panel, then the dwell that proves the re-render did not take it away.
  await expect(page.getByRole("heading", { level: 1, name: "Two-factor authentication enabled" })).toBeVisible({ timeout: 30_000 });
  await expectPanelSurvives(page);
  const codes = await readPanelCodes(page);
  expect(codes).toHaveLength(10);
  for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  await expect(
    page.getByText("Your authenticator app is now linked. Save these recovery codes now. They are shown only once: if you reload or leave this page, we cannot show them again."),
  ).toBeVisible();
  // No "asked once more" line: the session was marked verified.
  await expect(page.getByText(/asked for a code from your app once more/i)).toHaveCount(0);
  await expectNoFreshCodesCookie(context);

  // 360px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const cont = page.getByRole("link", { name: "Continue" });
  await expect(cont).toHaveAttribute("href", "/launch");
  const box = (await cont.boundingBox())!;
  expect(box.height, "Continue is a 44px target").toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("handoff-panel-360.png"), fullPage: true });

  // The claim: this is "no second challenge" for a person with no congregation to be bounced from.
  const claim = await sessionClaim(page);
  expect(claim.twoFactorRequired).toBe(true);
  expect(claim.twoFactorVerified, "enrolling marked the session verified").toBe(true);

  // What was persisted.
  const enrolled = (await sql`select 1 from user_totp where user_id = ${user.id}::uuid`) as unknown[];
  expect(enrolled).toHaveLength(1);
  const hashes = (await sql`select count(*)::int as n from user_totp_recovery_codes where user_id = ${user.id}::uuid`) as { n: number }[];
  expect(hashes[0]!.n).toBe(10);
  const audit = (await sql`select metadata from audit_events where resource_id = ${user.id} and action = 'totp.enrolled'`) as { metadata: unknown }[];
  expect(audit).toHaveLength(1);
  expect(audit[0]!.metadata).toEqual({ sessionVerified: true });
  expect(JSON.stringify(audit)).not.toContain(codes[0]!);

  // Continue goes on, and never through /totp.
  await cont.click();
  await page.waitForURL((url) => url.pathname !== "/account/2fa", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(urls.filter((u) => new URL(u).pathname === "/totp"), "no /totp hop after enrolling").toEqual([]);
  expect(new URL(page.url()).pathname).not.toBe("/signin");
  await expectNoFreshCodesCookie(context);
});
