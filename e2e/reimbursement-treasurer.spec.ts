/**
 * reimbursement-treasurer.spec.ts - the MFA-enrolled TREASURER, from a signed-out deep
 * link, against a running server (Treasury Increment 1, Batch 7; docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 "New e2e specs" 3, EC45, the Batch 4 Copy
 * amendment S1 to S3 and S7, and the Batch 6 amendment T4).
 *
 * Why it exists beside `reimbursement-treasurer-ui.spec.ts`. That spec runs on a cached,
 * already-verified session and walks the treasurer pages. THIS one is the login path the
 * increment touches indirectly (a deep link through `/signin` and `/totp`, CLAUDE.md
 * Phase 4 gate): a signed-out visitor opens `/o/<slug>/admin/reimbursements/<id>`, is sent
 * to `/signin?callbackUrl=<that path>`, signs in with the PASSWORD, is sent to `/totp`
 * (still carrying the path) because holding a money key makes 2FA required, types the REAL
 * code computed from the enrolled secret, and lands on the request. The rest of the spec
 * then runs in THAT context, so every treasurer verb below is exercised by a session made
 * the way a person's is.
 *
 * It asserts the strings the Batch 4 amendment rules and Batch 6 amendment T4 added:
 * `Choose a date between the day of the expense and today.`, `Write a note.`, one of the six
 * state-refusal sentences reached by POSTing from a page that went stale, the filtered
 * queue's empty sentence, and the CSV export notes. And the verbs: record a payment (a
 * check needs its number), the approver cannot pay (the message before any form), reverse,
 * void, and override-approve with a second pay holder, or the `needs_second_payer` refusal
 * with only one.
 *
 * Everything lives in a THROWAWAY congregation (`e2e-reimbm-<stamp>`, removed in afterAll
 * by one delete of the organization). Invented names, `.invalid` addresses, no real data.
 * Receipts are Batch 2b: the seeded requests waive theirs through the definer.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { signInOnPage, submitTotp } from "./support/invitation-ui";
import {
  noHorizontalScroll,
  orgToday,
  recordPaymentViaDefiner,
  REIMB_NAMES as NAMES,
  removeReimbursementFixture,
  seedRequest,
  setupReimbursementFixture,
  statusOf,
  tallEnough,
  waitHydrated,
  type ReimbursementFixture,
} from "./support/reimbursement-fixture";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { E2E_USERS, storageStatePath } from "./support/users";

let sql: Sql;
let fx: ReimbursementFixture;
/** The context made by the REAL login in the first test; every later test reuses its verified session. */
let treasurerContext: BrowserContext;
const ids: Record<string, string> = {};

const base = () => `/o/${fx.slug}/admin/reimbursements`;

async function treasurerPage(width = 360, height = 740): Promise<Page> {
  const page = await treasurerContext.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `test-results/reimbursement-360/treasurer-${name}.png`, fullPage });
}

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements: the MFA-enrolled treasurer from a signed-out deep link", () => {
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    sql = platformSql("reimbursement-treasurer.spec");
    fx = await setupReimbursementFixture(sql, { tag: "m" });
    const spec = { orgId: fx.orgId, categorySupplies: fx.categorySupplies, requesterUser: fx.requesterUser, chairUser: fx.chairUser, treasurerUser: fx.treasurerUser };
    // Approved by the chair, receipt waived: payable at once.
    ids.payable = await seedRequest(sql, spec, { key: "mfa-payable-001", group: fx.groupProperty, cents: 1999, purpose: "Hymnal repair kit", upTo: "waived" });
    // The page this one opens is made stale behind its back.
    ids.stale = await seedRequest(sql, spec, { key: "mfa-stale-00001", group: fx.groupProperty, cents: 1234, purpose: "Stale page supplies", upTo: "waived" });
    // Worship has no chair: it waits for the treasurer (override).
    ids.override = await seedRequest(sql, spec, { key: "mfa-override-01", group: fx.groupWorship, cents: 7500, purpose: "Choir folders", upTo: "submitted" });
    ids.voided = await seedRequest(sql, spec, { key: "mfa-void-000001", group: fx.groupProperty, cents: 3000, purpose: "Candles for Advent", upTo: "submitted" });
  });

  test.afterAll(async () => {
    await treasurerContext?.close().catch(() => undefined);
    if (!fx) return; // setup failed before the fixture existed; the next run's sweep clears any leftover
    await removeReimbursementFixture(sql, fx);
  });

  // -------------------------------------------------------------------------
  test("the deep link: signed out, /signin keeps the path, the password leads to /totp which keeps it, the REAL code lands on the request", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const path = `${base()}/${ids.payable}`;
    const treasurer = E2E_USERS["mfa-enrolled"];

    // Signed out: the treasurer address is not served; the visitor is sent to sign in, and the way back is the exact path.
    await page.goto(path);
    await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);

    await signInOnPage(page, treasurer.email, treasurer.password);
    // Holding a money key makes 2FA required: the password alone is not enough, and the challenge carries the path on.
    await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);
    await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible();

    // The real code, computed from the enrolled secret (a replayed time step waits for the next one).
    await submitTotp(page, E2E_TOTP_TEST_SECRET);
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "$19.99" })).toBeVisible();
    await expect(page.getByTestId("request-banner")).toContainText("Waiting for payment.");
    await expect(page.getByTestId("payment-form")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "deep-link-landing");
    await page.close();
    treasurerContext = context;
  });

  test("a signed-in session that has NOT passed the challenge is sent to /totp on the member address too, keeping the path (EC45)", async ({ browser }) => {
    const unverified = await browser.newContext({ storageState: storageStatePath("mfa-enrolled"), viewport: { width: 360, height: 740 } });
    const page = await unverified.newPage();
    for (const path of [`/o/${fx.slug}/reimbursements`, `/o/${fx.slug}/reimbursements/${ids.payable}`, `${base()}/${ids.payable}`]) {
      await page.goto(path);
      await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
      expect(new URL(page.url()).searchParams.get("callbackUrl"), path).toBe(path);
    }
    await unverified.close();
  });

  // -------------------------------------------------------------------------
  test("Record payment from the landing page: a check needs its number, the date has bounds, then it is recorded and shown", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}/${ids.payable}`);
    await waitHydrated(page);
    const form = page.getByTestId("payment-form");
    await expect(form.getByLabel("How was it paid?")).toHaveValue("check");
    await expect(form.getByLabel("Date paid")).toHaveValue(await orgToday(sql));

    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Enter a check number.")).toBeVisible();
    await form.getByLabel("Check number").fill("2044");
    // S1: a date before the expense or after today is one sentence.
    await form.getByLabel("Date paid").fill("2001-01-01");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Choose a date between the day of the expense and today.")).toBeVisible();
    expect(await statusOf(sql, ids.payable)).toBe("approved");

    await form.getByLabel("Date paid").fill(await orgToday(sql));
    await shot(page, "payment-form");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Payment recorded.").first()).toBeVisible();
    expect(await statusOf(sql, ids.payable)).toBe("paid");
    await expect(page.getByTestId("request-banner")).toContainText("Paid on");
    await expect(page.getByTestId("payment-row")).toContainText("Check number 2044");
    await expect(page.getByTestId("payment-row")).toContainText(NAMES.treasurer);
    await noHorizontalScroll(page);
    await shot(page, "paid");
    await page.close();
  });

  test("Reverse: a reason is required, both entries stay, and the request is waiting for payment again", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}/${ids.payable}`);
    await waitHydrated(page);
    await page.getByTestId("reverse-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("reverse-confirm").click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByLabel("Reason", { exact: true }).fill("Check went to the wrong payee");
    await dialog.getByTestId("reverse-confirm").click();
    await expect(page.getByText("Payment reversed.").first()).toBeVisible();
    expect(await statusOf(sql, ids.payable)).toBe("approved");
    await expect(page.getByTestId("payment-row")).toHaveCount(2);
    await expect(page.getByTestId("payment-form")).toBeVisible();
    await page.close();
  });

  test("Add a note: 'Write a note.' for an empty one, then the note shows with the writer's name", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}/${ids.payable}`);
    await waitHydrated(page);
    await page.getByTestId("note-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("note-confirm").click();
    await expect(dialog.getByText("Write a note.")).toBeVisible();
    await dialog.getByLabel("Note", { exact: true }).fill("Re-issued the check");
    await dialog.getByTestId("note-confirm").click();
    await expect(page.getByText("Note added.").first()).toBeVisible();
    await expect(page.getByTestId("request-history")).toContainText("Re-issued the check");
    await expect(page.getByTestId("request-history")).toContainText(NAMES.treasurer);
    await page.close();
  });

  test("a verb posted from a page that went stale is refused in Copy's own sentence (S3: not_voidable), inside the dialog, and nothing changes", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}/${ids.stale}`);
    await waitHydrated(page);
    await expect(page.getByTestId("void-open")).toBeVisible();
    // Behind the open page's back, the request is paid (by the same payer, through the definer).
    await recordPaymentViaDefiner(sql, { orgId: fx.orgId, requestId: ids.stale, payerUser: fx.treasurerUser });
    expect(await statusOf(sql, ids.stale)).toBe("paid");

    await page.getByTestId("void-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason", { exact: true }).fill("Bought on the church card instead");
    await dialog.getByTestId("void-confirm").click();
    await expect(dialog.getByTestId("void-banner")).toHaveText("This request can't be voided. Reload the page to see where it stands.");
    expect(await statusOf(sql, ids.stale)).toBe("paid");
    // What was typed is still there, and a reload shows the truth: no Void button on a paid request.
    await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue("Bought on the church card instead");
    await shot(page, "stale-refusal", false);
    await page.reload();
    await expect(page.getByTestId("request-banner")).toContainText("Paid on");
    await expect(page.getByTestId("void-open")).toHaveCount(0);
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("the queue: a filter that matches nothing says so, and the export notes say what the file covers (T4)", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}?tab=all`);
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursement requests" })).toBeVisible();
    await expect(page.getByTestId("export-note")).toHaveCount(0);
    await page.getByLabel("Submitted from").fill("2001-01-01");
    await page.getByLabel("Submitted to").fill("2001-01-31");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("queue-empty")).toHaveText("No requests match those filters.");
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(`${base()}?tab=all`);
    await expect(page.getByLabel("Submitted from")).toHaveValue("");

    // A group chosen: the file still covers every group.
    await page.getByLabel("Charged to").selectOption({ label: NAMES.worship });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("queue-row")).toHaveCount(1);
    await expect(page.getByTestId("export-note")).toHaveText("The file covers every group, not only the one chosen under Charged to.");
    // On a tab that is not a single status, the file covers every request that has been sent in.
    await page.goto(`${base()}?tab=override`);
    await expect(page.getByTestId("export-note")).toHaveText("The file covers every request that has been sent in, not only this tab's.");
    await page.goto(`${base()}?tab=progress&group=${fx.groupWorship}`);
    await expect(page.getByTestId("export-note")).toHaveText(
      "The file covers every group, not only the one chosen under Charged to. The file covers every request that has been sent in, not only this tab's.",
    );
    await noHorizontalScroll(page);
    await shot(page, "queue-export-notes");
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("override approval with only ONE person who can pay is refused (needs_second_payer) and points to the Treasury team; with a second payer it works, and the approver cannot also pay", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}/${ids.override}`);
    await waitHydrated(page);
    await expect(page.getByTestId("request-banner")).toHaveText("Waiting for the treasurer to approve it.");
    await page.getByTestId("override-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`No one in ${NAMES.worship} is able to approve this. Once approved, a different person who can record payments must pay it.`);
    await dialog.getByTestId("override-confirm").click();
    await expect(dialog.getByTestId("override-refusal")).toContainText(
      "This needs a second person who can record payments before you can approve it. Whoever approves can't also pay. Add one under Treasury team.",
    );
    await expect(dialog.getByTestId("override-team-link")).toHaveAttribute("href", `${base()}/team`);
    expect(await statusOf(sql, ids.override)).toBe("submitted");
    await shot(page, "override-refusal", false);
    await page.keyboard.press("Escape");

    // A second person who can record payments (permissions are read live, so no new sign-in is needed).
    await withDbRetry("grant the payer role to the second payer", () => sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${fx.orgId}::uuid, ${fx.payerRole}::uuid, ${fx.secondPerson}::uuid, date '2020-01-01', ${fx.treasurerUser}::uuid)`);
    await page.reload();
    await waitHydrated(page);
    await page.getByTestId("override-open").click();
    await page.getByRole("alertdialog").getByTestId("override-confirm").click();
    await expect(page.getByText("Approved.").first()).toBeVisible();
    expect(await statusOf(sql, ids.override)).toBe("approved");
    await expect(page.getByTestId("approved-by")).toContainText(`Approved by ${NAMES.treasurer}`);
    await expect(page.getByTestId("approved-by")).toContainText("as treasurer");
    // The approver is told before any form that someone else must pay.
    await expect(page.getByTestId("payment-block")).toHaveText("A different person must record this payment.");
    await expect(page.getByTestId("payment-form")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "approver-cannot-pay");
    await page.close();
  });

  test("Void request: a required reason, then the request is closed and nothing is deleted", async () => {
    const page = await treasurerPage();
    await page.goto(`${base()}/${ids.voided}`);
    await waitHydrated(page);
    await expect(page.getByTestId("payment-block")).toHaveText("This request isn't waiting for payment.");
    await tallEnough(page, "void-open", 360);
    await page.getByTestId("void-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("void-confirm").click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByLabel("Reason", { exact: true }).fill("Bought on the church card instead");
    await dialog.getByTestId("void-confirm").click();
    await expect(page.getByText("Request voided.").first()).toBeVisible();
    expect(await statusOf(sql, ids.voided)).toBe("voided");
    await expect(page.getByTestId("request-banner")).toContainText("This request was closed.");
    const left = (await sql`select count(*)::int as n from reimbursement_requests where id = ${ids.voided}::uuid`) as { n: number }[];
    expect(left[0]!.n).toBe(1);
    await page.close();
  });
});
