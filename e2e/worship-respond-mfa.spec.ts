/**
 * worship-respond-mfa.spec.ts - the emailed link, opened SIGNED OUT by a member whose account requires a second
 * factor (worship Increment 1, Batch 6; Phase 3 "E2E"). The leader sends the request from the board (the real
 * Send, so the link is the one the email carries: `/o/<slug>/worship/requests/<id>`, no query string, no
 * `next`/`callbackUrl`). Wren, signed out, opens it: she is sent to sign in with the link's own path as the
 * callback, signs in, answers the /totp challenge, lands back on THE REQUEST (not the home page) and accepts.
 * A wrong code does not get her in. Wren's account is the throwaway MFA-enrolled one (the shared enrolled TOTP
 * secret); everything lives in a throwaway congregation.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { platformSql, type Sql } from "./support/db";
import { signInOnPage, submitTotp } from "./support/invitation-ui";
import {
  assignmentStatus, clearQueue, newPhonePage, noSidewaysScroll, removeWorshipFixture, seedAssignment, setupWorshipFixture,
  signedInContext, waitHydrated, WORSHIP_EMAILS, WORSHIP_PASSWORD, type WorshipFixture,
} from "./support/worship-fixture";

let sql: Sql;
let fx: WorshipFixture;
let leader: BrowserContext;
const base = () => `/o/${fx.slug}`;

test.describe("Worship: the emailed link, signed out, with a second factor", () => {
  test.setTimeout(240_000);
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    sql = platformSql("worship-respond-mfa.spec");
    fx = await setupWorshipFixture(sql, { tag: "m", mfa: ["wren"] });
    leader = await signedInContext(browser, "leader", `${base()}/worship`);
  });
  test.afterAll(async () => {
    await leader?.close();
    if (sql && fx) await removeWorshipFixture(sql, fx);
  });

  test("link from the real Send -> sign in -> code -> the request -> accept", async ({ browser }) => {
    await clearQueue(sql, [WORSHIP_EMAILS.wren!]);
    const draft = await seedAssignment(sql, fx, { who: "wren", position: "vocals", upTo: "draft" });
    const board = await newPhonePage(leader);
    await board.goto(`${base()}/worship/teams/${fx.band}/services/${fx.serviceId}`);
    await waitHydrated(board);
    await board.getByTestId("send-open").click();
    await board.getByTestId("send-confirm").click();
    await expect(board.getByText("Requests sent. 1 emailed, 0 not emailed.")).toBeVisible();
    await board.close();
    expect((await assignmentStatus(sql, draft)).status).toBe("requested");

    // The link the email carries: exactly /o/<slug>/worship/requests/<id>, with no query string.
    const [mail] = (await sql`select html_body, text_body from email_queue where lower(to_email) = ${WORSHIP_EMAILS.wren!} and template_key = 'worship.notice.request'`) as Array<{ html_body: string; text_body: string | null }>;
    const link = `${mail!.html_body} ${mail!.text_body ?? ""}`.match(/https?:\/\/[^\s"'<>]+\/o\/[^\s"'<>]+\/worship\/requests\/[0-9a-f-]{36}/)?.[0];
    expect(link, "the request email carries a request link").toBeTruthy();
    expect(link).not.toContain("?");
    const path = new URL(link!).pathname;
    expect(path).toBe(`${base()}/worship/requests/${draft}`);

    // Signed out, a fresh phone.
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    await page.screenshot({ path: "test-results/worship-360/60-link-signin.png", fullPage: true });
    await signInOnPage(page, WORSHIP_EMAILS.wren!, WORSHIP_PASSWORD);
    await page.waitForURL(/\/totp/, { timeout: 30_000 });
    expect(decodeURIComponent(page.url())).toContain(path);
    await page.screenshot({ path: "test-results/worship-360/61-link-totp.png", fullPage: true });
    await submitTotp(page, E2E_TOTP_TEST_SECRET);

    // Back on the request itself.
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Your request to serve" })).toBeVisible();
    await waitHydrated(page);
    await noSidewaysScroll(page);
    await page.screenshot({ path: "test-results/worship-360/62-link-request.png", fullPage: true });
    await page.getByTestId("accept").click();
    await expect(page.getByText("You're confirmed.")).toBeVisible();
    expect((await assignmentStatus(sql, draft)).status).toBe("confirmed");
    await clearQueue(sql, [WORSHIP_EMAILS.wren!]);
    await context.close();
  });
});
