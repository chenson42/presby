/**
 * worship-respond.spec.ts - the volunteer's side at 360px (worship Increment 1, Batch 6).
 * Wren has a waiting request; she signs in, sees it under "Waiting for your answer", opens it,
 * accepts, changes her mind and declines with a closed-list reason, saves "Dates I can't serve"
 * (twice, the second joining the first), and a confirmed date inside a new range is named but not
 * cancelled. Another member's request id and an unknown id are the SAME 404; the leader's view of a
 * decline names no one in the email. Linus (no request) sees the empty state. Screenshots to
 * `test-results/worship-360/`. Throwaway congregation, `.invalid` addresses, invented names.
 *
 * NOT COVERED HERE (recorded in the work-log): the email link opened signed out by an MFA-enrolled member
 * (needs the enrolled-TOTP fixture on a worship person) and the founding-administrator path through
 * `presby_apply_founding_administrator`.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  assignmentStatus, clearQueue, newPhonePage, noSidewaysScroll, queuedTo, removeWorshipFixture, seedAssignment,
  setupWorshipFixture, signedInContext, smallTargets, waitHydrated, WORSHIP_EMAILS, WORSHIP_NAMES as NAMES, type WorshipFixture,
} from "./support/worship-fixture";

let sql: Sql;
let fx: WorshipFixture;
let wren: BrowserContext;
let linus: BrowserContext;
let waiting = "";
let confirmed = "";
const base = () => `/o/${fx.slug}`;
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `test-results/worship-360/${name}.png`, fullPage: true });
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

test.describe("Worship: answering a request, at 360px", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    sql = platformSql("worship-respond.spec");
    fx = await setupWorshipFixture(sql, { tag: "r" });
    waiting = await seedAssignment(sql, fx, { who: "wren", position: "vocals", upTo: "requested" });
    confirmed = await seedAssignment(sql, fx, { who: "wren", position: "vocals", upTo: "confirmed", event: "second" });
    wren = await signedInContext(browser, "wren", `${base()}/worship`);
    linus = await signedInContext(browser, "linus", `${base()}/worship`);
  });

  test.afterAll(async () => {
    await wren?.close();
    await linus?.close();
    if (sql && fx) await removeWorshipFixture(sql, fx);
  });

  test("Wren sees her request, opens it, accepts, then declines with a reason", async () => {
    const page = await newPhonePage(wren);
    await page.goto(`${base()}/worship`);
    await waitHydrated(page);
    await noSidewaysScroll(page);
    await shot(page, "30-member-home");
    await expect(page.getByTestId("section-waiting")).toContainText("Vocals, Sunday Band");
    await expect(page.getByTestId("section-scheduled")).toContainText("Vocals, Sunday Band");

    await page.getByTestId("section-waiting").getByRole("link", { name: "Vocals, Sunday Band" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your request to serve" })).toBeVisible();
    await waitHydrated(page);
    await expect(page.getByTestId("request-body")).toContainText(`${NAMES.org} asks you to serve as Vocals with Sunday Band on`);
    await shot(page, "31-request");
    await page.getByTestId("accept").click();
    await expect(page.getByText("You're confirmed.")).toBeVisible();
    expect((await assignmentStatus(sql, waiting)).status).toBe("confirmed");

    await page.getByTestId("decline").click();
    await page.getByLabel("Reason (optional)").selectOption("family");
    await shot(page, "32-decline-reason");
    await page.getByTestId("decline-confirm").click();
    await expect(page.getByText("You said you can't serve.")).toBeVisible();
    const row = await assignmentStatus(sql, waiting);
    expect([row.status, row.decline_reason, row.response_source]).toEqual(["declined", "family", "self"]);
    await expect(page.getByTestId("serve-after-all")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await page.close();
  });

  test("another member's request id and an unknown id are the same 404", async () => {
    const page = await newPhonePage(linus);
    const theirs = await page.goto(`${base()}/worship/requests/${waiting}`);
    const unknown = await page.goto(`${base()}/worship/requests/00000000-0000-4085-8000-00000000dead`);
    expect(theirs?.status()).toBe(404);
    expect(unknown?.status()).toBe(404);
    await page.goto(`${base()}/worship`);
    await expect(page.getByText("You're not asked to serve at any upcoming services.")).toBeVisible();
    await shot(page, "33-member-empty");
    await page.close();
  });

  test("dates I can't serve: saved, joined, and a confirmed date is named but not cancelled", async () => {
    const page = await newPhonePage(wren);
    await page.goto(`${base()}/worship/blockouts`);
    await waitHydrated(page);
    await shot(page, "34-blockouts-empty");
    await expect(page.getByText("You haven't saved any dates.")).toBeVisible();
    await page.getByLabel("From", { exact: true }).fill(day(60));
    await page.getByLabel("To", { exact: true }).fill(day(62));
    await page.getByLabel("Reason (optional)").selectOption("away");
    await page.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByText("Dates saved.")).toBeVisible();
    await page.getByLabel("From", { exact: true }).fill(day(63));
    await page.getByLabel("To", { exact: true }).fill(day(64));
    await page.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByText("Saved. We joined it with dates you'd already saved.")).toBeVisible();
    await expect(page.getByTestId("blockout-list").getByRole("listitem")).toHaveCount(1);

    // A range over the confirmed evening service (21 days out): saved anyway, and said so.
    await page.getByLabel("From", { exact: true }).fill(day(15));
    await page.getByLabel("To", { exact: true }).fill(day(30));
    await page.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByTestId("blockout-conflicts")).toContainText("You're already confirmed to serve on");
    expect((await assignmentStatus(sql, confirmed)).status).toBe("confirmed");

    await page.getByLabel("From", { exact: true }).fill(day(70));
    await page.getByLabel("To", { exact: true }).fill(day(69));
    await page.getByRole("button", { name: "Save dates" }).click();
    await expect(page.getByRole("alert").first()).toContainText("The end date can't be before the start date.");
    await shot(page, "35-blockouts-saved");
    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect(page.getByText("Dates removed.")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await page.close();
  });

  test("a decline emails the person who placed her, without her name", async () => {
    await clearQueue(sql, [WORSHIP_EMAILS.leader!]);
    const second = await seedAssignment(sql, fx, { who: "wren", position: "keys", upTo: "requested", event: "second" });
    const page = await newPhonePage(wren);
    await page.goto(`${base()}/worship/requests/${second}`);
    await waitHydrated(page);
    await page.getByTestId("decline").click();
    await page.getByTestId("decline-confirm").click();
    await expect(page.getByText("You said you can't serve.")).toBeVisible();
    const mail = await queuedTo(sql, WORSHIP_EMAILS.leader!);
    expect(mail.map((m) => m.template_key)).toContain("worship.notice.declined");
    const [body] = (await sql`select html_body, text_body from email_queue where lower(to_email) = ${WORSHIP_EMAILS.leader!} and template_key = 'worship.notice.declined' limit 1`) as Array<{ html_body: string; text_body: string | null }>;
    expect(`${body!.html_body} ${body!.text_body ?? ""}`).not.toContain("Pellam");
    await clearQueue(sql, [WORSHIP_EMAILS.leader!]);
    await page.close();
  });
});
