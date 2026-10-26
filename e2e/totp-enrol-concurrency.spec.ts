import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { generateSync } from "otplib";
import { platformSql, withDbRetry } from "./support/db";
import { signInOnPage } from "./support/invitation-ui";
import { enterTotpCode } from "./support/totp-page";

/**
 * F342 - the two-factor enrolment secret race, end to end
 * (docs/work-log/2026-10-26-totp-enroll-race.md).
 *
 * The browser fetches /account/2fa more than once on arrival (the /totp redirect), and the
 * helper behind the page used to be find-then-upsert: two concurrent first renders each minted a
 * secret, the last write won, and a page could show a secret the database no longer held, so a
 * correct code for it was refused (~1 in 20 on invitation-new-account). The fix is a conditional
 * upsert; the page now always shows what the database holds.
 *
 * For each of three fresh, unenrolled users (signed in through the real form), the stored pending
 * row is cleared so the next render is a true first render, then 8 GETs of /account/2fa go out at
 * once through the signed-in context. The manual key is read from the server-rendered HTML of each
 * response (the <pre> under "Can't scan? Enter manually"): all eight must carry the same key, a
 * browser reload must show it again, and exactly one pending row must exist. The first user then
 * proves the shown key is the STORED one the only way a person can: a code computed from it
 * enrols. The last runs at 360px (no horizontal scroll, QR and key present).
 *
 * Users are throwaway `.invalid` accounts created here and deleted at the end (the FK cascade
 * takes their pending rows); stale ones from a crashed run are swept first.
 */

test.setTimeout(120_000);

const sql = platformSql("totp-enrol-concurrency.spec");
const PASSWORD = "e2e-enrol-throwaway-not-a-secret"; // leak-ok: throwaway password for a `.invalid` fixture account
const CONCURRENT = 8;
const stamp = Date.now();
const created: string[] = [];

async function sweepStale() {
  await withDbRetry("sweep stale enrol users", async () => {
    await sql`delete from users where email like 'e2e-enrol-%@example.invalid' and created_at < now() - interval '1 hour'`;
  });
}

async function makeUser(tag: string): Promise<{ id: string; email: string }> {
  const email = `e2e-enrol-${stamp}-${tag}@example.invalid`;
  if (!/^e2e-enrol-\d+-[a-z0-9]+@example\.invalid$/.test(email)) throw new Error("refusing a non-fixture address");
  const hash = await bcrypt.hash(PASSWORD, 10);
  const rows = (await withDbRetry(
    "create enrol user",
    async () =>
      await sql`
        insert into users (email, name, password, email_verified, is_active, two_factor_required)
        values (${email}, 'Enrol Concurrency', ${hash}, now(), true, true)
        returning id`,
  )) as { id: string }[];
  created.push(rows[0]!.id);
  return { id: rows[0]!.id, email };
}

/** The manual key in a rendered /account/2fa document. */
function manualKey(html: string): string {
  const m = html.match(/<details[^>]*>[\s\S]*?<pre[^>]*>([A-Z2-7]{16,})<\/pre>/);
  if (!m) throw new Error("no manual key in the server-rendered /account/2fa HTML");
  return m[1]!;
}

async function signInToEnrolment(page: Page, email: string) {
  await page.goto("/signin?callbackUrl=/launch");
  await signInOnPage(page, email, PASSWORD);
  await page.waitForURL((url) => url.pathname === "/account/2fa", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();
}

async function pendingCount(userId: string): Promise<number> {
  const rows = (await sql`select count(*)::int as n from user_totp_pending_enrollments where user_id = ${userId}::uuid`) as { n: number }[];
  return rows[0]!.n;
}

test.beforeAll(async () => {
  await sweepStale();
});

test.afterAll(async () => {
  if (created.length === 0) return;
  await withDbRetry("delete enrol users", async () => {
    await sql`delete from users where id = any(${created}::uuid[]) and email like 'e2e-enrol-%@example.invalid'`;
  });
});

for (const tag of ["a", "b", "c"]) {
  test(`concurrent first renders of /account/2fa all show one key, and a reload shows it again (fresh user ${tag})`, async ({ page }, testInfo) => {
    const user = await makeUser(tag);
    if (tag === "c") await page.setViewportSize({ width: 360, height: 740 });
    await signInToEnrolment(page, user.email);

    // Make the next render a true first render: drop the row the sign-in navigation created.
    await sql`delete from user_totp_pending_enrollments where user_id = ${user.id}::uuid`;
    expect(await pendingCount(user.id)).toBe(0);

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, () => page.request.get("/account/2fa")),
    );
    const keys: string[] = [];
    for (const r of responses) {
      expect(r.status()).toBe(200);
      keys.push(manualKey(await r.text()));
    }
    expect(new Set(keys).size, `eight concurrent renders showed ${new Set(keys).size} different keys`).toBe(1);
    const key = keys[0]!;
    expect(await pendingCount(user.id), "exactly one pending row").toBe(1);

    // A reload in the browser shows the same key.
    await page.reload();
    await expect(page.getByRole("heading", { name: /enroll in two-factor authentication/i })).toBeVisible();
    expect(((await page.locator("details pre").textContent()) ?? "").trim()).toBe(key);

    if (tag === "c") {
      // 360px: QR code (or its placeholder) and the manual key are on the page, nothing scrolls sideways.
      await expect(page.getByAltText(/TOTP QR code/i)).toBeVisible({ timeout: 15_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no horizontal scroll at 360px").toBeLessThanOrEqual(0);
      await page.locator("details summary").click();
      await expect(page.locator("details pre")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("enrol-360.png"), fullPage: true });
    }

    if (tag === "a") {
      // The shown key is the stored one: a code computed from it enrols.
      await enterTotpCode(page, generateSync({ secret: key }));
      await expect(page.getByText(/you enrolled on/i)).toBeVisible({ timeout: 20_000 });
      const enrolled = (await sql`select 1 from user_totp where user_id = ${user.id}::uuid`) as unknown[];
      expect(enrolled).toHaveLength(1);
    }
  });
}
