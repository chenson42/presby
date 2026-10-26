/**
 * totp-code-entry.spec.ts - how the six digit boxes on /totp behave in a real
 * browser (review-polish Batch B; DECISION-257): focus on box 1 once hydrated,
 * typing advances, Backspace and Delete work across boxes, a pasted or
 * autofilled code is spread across the boxes, the sixth digit SUBMITS the code
 * with no button press (exactly once, with the committed value, re-arming after
 * a failure), an over-long paste fills the boxes and waits for Verify, recovery
 * mode never auto-submits, the recovery toggle leaves exactly one `token` field
 * in the page, and the boxes fit a 360px phone.
 *
 * jsdom covers the component's logic (one-time-code-input.test.tsx and the two
 * form tests); this proves what jsdom cannot: real focus, real key events, the
 * real clipboard, the real server action and its audit rows, layout.
 *
 * Each test starts from the mfa-enrolled user's credentials-signed-in storage
 * state, so /totp is the first thing it meets. The full credentials-to-verified
 * path is totp-full-login.spec.ts's job. Submit-proof tests use the wrong code
 * 000000 (rate limiting is off in e2e); only E-1 submits the real code.
 */
import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { generateSync } from "otplib";
import { E2E_USERS } from "./support/users";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { platformSql, type Sql } from "./support/db";
import {
  enterRecoveryCode,
  enterTotpCode,
  recoveryField,
  recoveryToggle,
  totpBox,
  totpGroup,
  verifyButton,
  waitForTotpVerified,
} from "./support/totp-page";

test.use({ storageState: storageStatePath("mfa-enrolled") });

let sql: Sql;
let userId: string;

test.beforeAll(async () => {
  sql = platformSql("totp-code-entry.spec");
  const rows = (await sql`select id from users where email = ${E2E_USERS["mfa-enrolled"].email}`) as { id: string }[];
  expect(rows).toHaveLength(1);
  userId = rows[0]!.id;
});

/** The database's clock, so a skewed laptop clock cannot hide or invent an audit row. */
async function dbNow(): Promise<string> {
  const [{ now }] = (await sql`select now() as now`) as { now: string }[];
  return now;
}

async function auditCounts(since: string): Promise<Record<string, number>> {
  const rows = (await sql`
    select action, count(*)::int as n from audit_events
     where actor_user_id = ${userId}::uuid and created_at >= ${since}::timestamptz and action like 'totp.%'
     group by action order by action`) as { action: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.action, r.n]));
}

/**
 * Counts the server-action POSTs to /totp that leave and come back, and (when
 * `hold` is set) keeps each one in flight until `release()` so the pending
 * state can be looked at.
 */
function watchPosts(page: Page, opts: { hold?: boolean } = {}) {
  const requests: import("@playwright/test").Request[] = [];
  let responses = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/totp") requests.push(r);
  });
  page.on("response", (r) => {
    if (r.request().method() === "POST" && new URL(r.url()).pathname === "/totp") responses++;
  });
  if (opts.hold) {
    void page.route(
      (url) => url.pathname === "/totp",
      async (route) => {
        if (route.request().method() === "POST") await gate;
        await route.continue().catch(() => {});
      },
    );
  }
  return { requests, responses: () => responses, release: () => release() };
}

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

  test("E-2: typing advances box to box; five digits do not submit and Verify stays disabled", async ({ page }) => {
    await openChallenge(page);
    const posts = watchPosts(page);
    await page.keyboard.type("4");
    await expect(totpBox(page, 2)).toBeFocused();
    await page.keyboard.type("82");
    await expect(totpBox(page, 4)).toBeFocused();
    await expect(verifyButton(page)).toBeDisabled();
    await page.keyboard.type("91");
    await expect(totpBox(page, 6)).toBeFocused();
    await expect(verifyButton(page)).toBeDisabled();
    expect(await boxValues(page)).toEqual(["4", "8", "2", "9", "1", ""]);
    await expect(page.locator('input[name="token"]')).toHaveValue("48291");
    // A fifth digit is not a code: nothing was sent.
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(page.url()).not.toContain("error");
    expect(posts.requests).toHaveLength(0);
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

  test("E-4: a code pasted from the real clipboard (with a space) is spread across the boxes and submitted once", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openChallenge(page);
    const posts = watchPosts(page);
    await page.evaluate(() => navigator.clipboard.writeText("000 000"));
    await totpBox(page, 1).click();
    await page.keyboard.press("ControlOrMeta+V");
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(posts.requests).toHaveLength(1);
    // The committed value, all six digits, travelled with the one request.
    expect(posts.requests[0]!.postData() ?? "").toContain("000000");
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
    // Eight digits is not the code (it is longer than one); it waits for Verify.
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(page.url()).not.toContain("error");
  });

  test("E-4: a whole-code input event on box 1 (one-time-code autofill, a keyboard suggestion) is submitted once", async ({
    page,
  }) => {
    await openChallenge(page);
    const posts = watchPosts(page);
    // fill() sets the whole value and fires one input event: what iOS and Android autofill do.
    await totpBox(page, 1).fill("000000");
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(posts.requests).toHaveLength(1);
    expect(posts.requests[0]!.postData() ?? "").toContain("000000");
  });

  test("a whole-code input event on box 1 fills every box (spread), before anything is sent", async ({ page }) => {
    await openChallenge(page);
    // Seven digits: spread, but too long to be the code, so nothing submits and the boxes can be read.
    await totpBox(page, 1).fill("4829157");
    expect(await boxValues(page)).toEqual(["4", "8", "2", "9", "1", "5"]);
    await expect(page.locator('input[name="token"]')).toHaveValue("482915");
    await expect(verifyButton(page)).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe("/totp");
  });

  test("E-8: a paste of more than six digits fills six boxes and does not submit; Verify then does", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openChallenge(page);
    const posts = watchPosts(page);
    await page.evaluate(() => navigator.clipboard.writeText("1234567"));
    await totpBox(page, 1).click();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator('input[name="token"]')).toHaveValue("123456");
    await expect(verifyButton(page)).toBeEnabled();
    // Give a wrongly-armed submit its chance to show up before asserting none happened.
    await page.waitForTimeout(750);
    expect(posts.requests).toHaveLength(0);
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(page.url()).not.toContain("error");

    await verifyButton(page).click();
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(posts.requests).toHaveLength(1);
  });

  test("E-8b: three typed digits plus a four-digit paste into box 4 fills six, drops one, and does not submit — regression for O-1", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 360, height: 740 });
    await openChallenge(page);
    const posts = watchPosts(page);
    for (const [i, d] of ["1", "2", "3"].entries()) await totpBox(page, i + 1).pressSequentially(d);
    await page.evaluate(() => navigator.clipboard.writeText("4567"));
    await totpBox(page, 4).click();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator('input[name="token"]')).toHaveValue("123456");
    expect(await boxValues(page)).toEqual(["1", "2", "3", "4", "5", "6"]);
    await expect(verifyButton(page)).toBeEnabled();
    await page.waitForTimeout(750);
    expect(posts.requests).toHaveLength(0);
    expect(new URL(page.url()).pathname).toBe("/totp");
    expect(page.url()).not.toContain("error");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await verifyButton(page).click();
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(posts.requests).toHaveLength(1);
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

  test("E-1: typing the real code with no button press signs in; one success row, no failed attempt", async ({
    page,
  }) => {
    const since = await dbNow();
    await openChallenge(page);
    const posts = watchPosts(page);
    await enterTotpCode(page, generateSync({ secret: E2E_TOTP_TEST_SECRET }));
    await waitForTotpVerified(page, /\/admin$/);
    expect(posts.requests).toHaveLength(1);
    const counts = await auditCounts(since);
    expect(counts["totp.verify_succeeded"]).toBe(1);
    expect(counts["totp.verify_failed"] ?? 0).toBe(0);
  });

  test("E-5: a wrong typed code shows the error once, keeps the code out of the URL, and returns to cleared boxes with box 1 focused", async ({
    page,
  }) => {
    const since = await dbNow();
    await openChallenge(page);
    await enterTotpCode(page, "000000");
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(page.url()).not.toContain("000000");
    await expect(page.locator("#totp-error")).toContainText(/didn.t match/i);
    await expect(totpBox(page, 1)).toBeEnabled();
    await expect(totpBox(page, 1)).toBeFocused();
    // Boxes are cleared, not echoing the failed code, and flagged invalid.
    await expect.poll(() => boxValues(page)).toEqual(["", "", "", "", "", ""]);
    await expect(totpBox(page, 1)).toHaveAttribute("aria-invalid", "true");
    const counts = await auditCounts(since);
    expect(counts["totp.verify_failed"]).toBe(1);
    expect(counts["totp.verify_succeeded"] ?? 0).toBe(0);
  });

  test("E-6 / E-7 (F282): two wrong codes in a row each clear and refocus the boxes, then the real code signs in", async ({
    page,
  }) => {
    const since = await dbNow();
    await openChallenge(page);
    const posts = watchPosts(page);

    await enterTotpCode(page, "000000");
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    await expect.poll(() => posts.responses()).toBe(1);
    await expect(totpBox(page, 1)).toBeFocused();
    await expect.poll(() => boxValues(page)).toEqual(["", "", "", "", "", ""]);
    const firstUrl = page.url();

    // The very same wrong code again: an identical URL comes back, and it must still submit and reset.
    await page.keyboard.type("000000");
    await expect.poll(() => posts.responses()).toBe(2);
    expect(page.url()).toBe(firstUrl);
    await expect(totpBox(page, 1)).toBeFocused();
    await expect.poll(() => boxValues(page)).toEqual(["", "", "", "", "", ""]);
    await expect(totpBox(page, 1)).toHaveAttribute("aria-invalid", "true");

    // A different code after a failure re-arms and signs in.
    await page.keyboard.type(generateSync({ secret: E2E_TOTP_TEST_SECRET }));
    await waitForTotpVerified(page, /\/admin$/);
    expect(posts.requests).toHaveLength(3);
    const counts = await auditCounts(since);
    expect(counts["totp.verify_failed"]).toBe(2);
    expect(counts["totp.verify_succeeded"]).toBe(1);
  });

  test("E-3: while the request is in flight the form shows Verifying, sends nothing more, and does not overflow at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openChallenge(page);
    const posts = watchPosts(page, { hold: true });
    await enterTotpCode(page, "000000");

    const pendingButton = page.getByRole("button", { name: /verifying/i });
    await expect(pendingButton).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Verifying your code.");
    await expect(recoveryToggle(page)).toBeDisabled();
    // Focus stays on box 6; nothing jumped to the button.
    await expect(totpBox(page, 6)).toBeFocused();
    expect(posts.requests).toHaveLength(1);

    // Another complete code while the first is in flight is ignored, and so is the (disabled) button.
    await page.keyboard.type("1");
    await pendingButton.click({ force: true, noWaitAfter: true, timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(500);
    expect(posts.requests).toHaveLength(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    posts.release();
    await page.waitForURL(/\/totp\?.*error=invalid/, { timeout: 15_000 });
    expect(posts.requests).toHaveLength(1);
    await expect(page.getByRole("status")).toHaveText("");
    await expect(totpBox(page, 1)).toBeFocused();
  });

  test("E-9: recovery mode never submits on typing; Verify is the way, and the page keeps one token field", async ({
    page,
  }) => {
    await openChallenge(page);
    const posts = watchPosts(page);
    await enterRecoveryCode(page, "123456");
    await recoveryField(page).pressSequentially("7");
    await page.waitForTimeout(750);
    expect(posts.requests).toHaveLength(0);
    expect(new URL(page.url()).pathname).toBe("/totp");
    await expect(page.locator('[name="token"]')).toHaveCount(1);
    await expect(verifyButton(page)).toBeEnabled();
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
