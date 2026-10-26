/**
 * reimbursement-approval.spec.ts - the APPROVER's side, from the emailed link, against
 * a running server (Treasury Increment 1, Batch 7; docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 "New e2e specs" 2, P3-1, P3-3, EC16, EC24, EC25, EC45).
 *
 * The emailed link is a bare path (`/o/<slug>/reimbursements/<id>`), so a signed-out chair
 * goes through `/signin?callbackUrl=<that path>` and lands back on the request. Cases:
 *   - a plain chair (no 2FA) opens the link signed out, signs in, and approves;
 *   - an approver whose page went stale (the request was sent back and sent again) is told
 *     the request changed, and a second approve of an approved request is told WHEN;
 *   - a member who is not a seat holder, a request that does not exist and a malformed id
 *     all get the same neutral 404 body (EC16);
 *   - the requester who is also a chair of the group cannot approve their own request, in
 *     the page and in the database;
 *   - opening a request as an approver twice changes nothing (EC24: no GET mutates);
 *   - MFA: a chair who ALSO holds `reimbursement.view` is challenged at `/totp` (the Node-
 *     side check on every reimbursement surface, EC45) and, after the REAL code, lands on
 *     the request and approves it as a seat holder.
 *
 * What the member-side slice (`reimbursement-member.spec.ts`, Batch 5) covers in the same
 * ground, it covers with a cached session; this spec is the signed-out path and the 2FA
 * one. Everything lives in a THROWAWAY congregation (`e2e-reimba-<stamp>`) removed in
 * afterAll by deleting that organization. Invented names, `.invalid` addresses, no real data.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { signInOnPage, submitTotp } from "./support/invitation-ui";
import {
  addMembership,
  approveViaDefiner,
  createRoleAndGrant,
  noHorizontalScroll,
  personIdForUser,
  returnAndResubmitViaDefiner,
  REIMB_NAMES as NAMES,
  removeReimbursementFixture,
  rosterUserId,
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
const ids: Record<string, string> = {};

const base = () => `/o/${fx.slug}/reimbursements`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

async function contextFor(browser: Browser, role: "member" | "presbytery-nogrant" | "org-unmanaged" | "org-single", width = 360, height = 740) {
  return browser.newContext({ storageState: storageStatePath(role), viewport: { width, height } });
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `test-results/reimbursement-360/approval-${name}.png`, fullPage });
}

const eventCount = async (requestId: string) =>
  Number((await rows<{ n: number }>(sql`select count(*)::int as n from reimbursement_events where request_id = ${requestId}::uuid`))[0]!.n);

const revisionOf = async (requestId: string) =>
  Number((await rows<{ revision: number }>(sql`select revision from reimbursement_requests where id = ${requestId}::uuid`))[0]!.revision);

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements: the approver, from the emailed link", () => {
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    sql = platformSql("reimbursement-approval.spec");
    // The treasurer holds no key here: the mfa-enrolled user is made a CHAIR who also holds `view`, below.
    fx = await setupReimbursementFixture(sql, { tag: "a", treasurerHoldsKeys: false });

    // The requester is ALSO a chair of the Worship Committee (the case where the seat holder is the one asking),
    // and so is the mfa-enrolled user, who also holds reimbursement.view (so 2FA is required of them, arm B).
    await sql`
      insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
      values (${fx.orgId}::uuid, ${fx.groupWorship}::uuid, ${fx.requesterPerson}::uuid, 'chair', 'managed', date '2020-01-01'),
             (${fx.orgId}::uuid, ${fx.groupWorship}::uuid, ${fx.treasurerPerson}::uuid, 'chair', 'managed', date '2020-01-01')`;
    await createRoleAndGrant(sql, fx.orgId, {
      roleId: "e2e96000-0000-4000-8000-000000000032",
      key: "e2e_reimb_viewer",
      name: "E2E Viewer",
      permissions: ["reimbursement.view"],
      personId: fx.treasurerPerson,
      grantedBy: fx.chairUser,
    });
    // A member who is neither the requester nor an approver: the bystander who must get the same 404 as a missing id.
    const bystanderUser = await rosterUserId(sql, "org-unmanaged");
    await addMembership(sql, fx.orgId, await personIdForUser(sql, bystanderUser), "regular", "active");

    const actors = { orgId: fx.orgId, categorySupplies: fx.categorySupplies, requesterUser: fx.requesterUser, chairUser: fx.chairUser, treasurerUser: fx.treasurerUser };
    ids.link = await seedRequest(sql, actors, { key: "apr-link-000001", group: fx.groupProperty, cents: 4250, purpose: "Folding tables for the fellowship hall", upTo: "submitted" });
    ids.stale = await seedRequest(sql, actors, { key: "apr-stale-00001", group: fx.groupProperty, cents: 1999, purpose: "Hymnal repair kit", upTo: "submitted" });
    ids.twice = await seedRequest(sql, actors, { key: "apr-twice-00001", group: fx.groupProperty, cents: 3000, purpose: "Candles for Advent", upTo: "submitted" });
    ids.own = await seedRequest(sql, actors, { key: "apr-own-0000001", group: fx.groupWorship, cents: 2500, purpose: "Choir folders", upTo: "submitted" });
    ids.mfa = await seedRequest(sql, actors, { key: "apr-mfa-0000001", group: fx.groupWorship, cents: 7500, purpose: "Sanctuary paraments", upTo: "submitted" });
  });

  test.afterAll(async () => {
    if (!fx) return; // setup failed before the fixture existed; the next run's sweep clears any leftover
    await removeReimbursementFixture(sql, fx);
  });

  // -------------------------------------------------------------------------
  test("the emailed link, signed out: /signin keeps the path, the password lands on the request, the chair approves through the dialog", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const path = `${base()}/${ids.link}`;
    const chair = E2E_USERS["presbytery-nogrant"];

    await page.goto(path);
    await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);
    await signInOnPage(page, chair.email, chair.password);
    // No money key, no 2FA: the password alone lands on the request itself.
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "$42.50" })).toBeVisible();
    await expect(page.getByTestId("request-banner")).toHaveText("Waiting for approval.");
    await tallEnough(page, "approve-open", 360);
    await tallEnough(page, "send-back-open", 360);
    await noHorizontalScroll(page);
    await shot(page, "link-landing");

    await page.getByTestId("approve-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`$42.50 to ${NAMES.requester}, charged to ${NAMES.property}.`);
    await page.waitForTimeout(400); // let the dialog finish fading in before the screenshot
    await shot(page, "approve-dialog", false);
    await dialog.getByTestId("approve-confirm").click();
    await expect(page.getByTestId("request-banner")).toContainText("Waiting for payment.");
    expect(await statusOf(sql, ids.link)).toBe("approved");
    const [approved] = await rows<{ approval_path: string; approved_by_user: string }>(
      sql`select approval_path, approved_by_user from reimbursement_requests where id = ${ids.link}::uuid`,
    );
    expect(approved).toMatchObject({ approval_path: "seat", approved_by_user: fx.chairUser });
    await context.close();
  });

  test("an approver whose page went stale is told the request changed, and nothing is approved", async ({ browser }) => {
    const context = await contextFor(browser, "presbytery-nogrant");
    const page = await context.newPage();
    await page.goto(`${base()}/${ids.stale}`);
    await waitHydrated(page);
    await expect(page.getByTestId("approve-open")).toBeVisible();
    const before = await revisionOf(ids.stale);

    // Behind the open page's back: sent back, then sent again. Same status, a new revision.
    await returnAndResubmitViaDefiner(sql, { orgId: fx.orgId, requestId: ids.stale, returnerUser: fx.chairUser, requesterUser: fx.requesterUser });
    expect(await revisionOf(ids.stale)).toBeGreaterThan(before);
    expect(await statusOf(sql, ids.stale)).toBe("submitted");

    await page.getByTestId("approve-open").click();
    await page.getByTestId("approve-confirm").click();
    await expect(page.getByText("This request changed after you opened it. Review it again.")).toBeVisible();
    expect(await statusOf(sql, ids.stale)).toBe("submitted");
    await context.close();
  });

  test("approving twice: the late approver is told it was already approved, and WHEN", async ({ browser }) => {
    const context = await contextFor(browser, "presbytery-nogrant");
    const first = await context.newPage();
    const late = await context.newPage();
    await first.goto(`${base()}/${ids.twice}`);
    await late.goto(`${base()}/${ids.twice}`);
    await waitHydrated(first);
    await waitHydrated(late);
    await first.getByTestId("approve-open").click();
    await first.getByTestId("approve-confirm").click();
    await expect(first.getByTestId("request-banner")).toContainText("Waiting for payment.");
    await late.getByTestId("approve-open").click();
    await late.getByTestId("approve-confirm").click();
    await expect(late.getByText(/This was already approved on [A-Z][a-z]+ \d{1,2}, \d{4}\./)).toBeVisible();
    // One approval, not two.
    const approvals = await rows<{ n: number }>(
      sql`select count(*)::int as n from reimbursement_events where request_id = ${ids.twice}::uuid and kind = 'approved'`,
    );
    expect(approvals[0]!.n).toBe(1);
    await context.close();
  });

  // -------------------------------------------------------------------------
  test("a member who is not a seat holder, a request that does not exist and a malformed id are the SAME 404; a stranger sees the same for a real and a missing id", async ({ browser }) => {
    const bystander = await contextFor(browser, "org-unmanaged");
    const page = await bystander.newPage();
    const forbidden = await page.goto(`${base()}/${ids.own}`);
    expect(forbidden!.status()).toBe(404);
    const body = await page.getByTestId("request-unavailable").innerText();
    expect(body).toContain("This request isn't available.");
    for (const other of ["11111111-1111-4111-8111-111111111111", "not-a-uuid"]) {
      const res = await page.goto(`${base()}/${other}`);
      expect(res!.status()).toBe(404);
      expect(await page.getByTestId("request-unavailable").innerText()).toBe(body);
    }
    await bystander.close();

    // Someone with no relationship to the congregation at all: whatever the page says about the congregation,
    // it says the same thing for a request that exists and one that does not.
    const stranger = await contextFor(browser, "org-single");
    const strangerPage = await stranger.newPage();
    const real = await strangerPage.goto(`${base()}/${ids.own}`);
    const realText = (await strangerPage.locator("main, body").first().innerText()).trim();
    const missing = await strangerPage.goto(`${base()}/11111111-1111-4111-8111-111111111111`);
    const missingText = (await strangerPage.locator("main, body").first().innerText()).trim();
    expect(real!.status()).toBe(missing!.status());
    expect(realText).toBe(missingText);
    expect(realText).not.toContain("Choir folders");
    await stranger.close();
  });

  test("the requester who is also a chair of the group cannot approve their own request: no button, and the database refuses too", async ({ browser }) => {
    const context = await contextFor(browser, "member");
    const page = await context.newPage();
    await page.goto(`${base()}/${ids.own}`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "$25.00" })).toBeVisible();
    await expect(page.getByTestId("approve-open")).toHaveCount(0);
    await expect(page.getByTestId("send-back-open")).toHaveCount(0);
    // They can still withdraw their own request: the owner's verbs, not the approver's.
    await expect(page.getByTestId("withdraw-open")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "requester-who-is-chair");
    await context.close();

    // The database, asked directly as the requester on the seat path, will not do it either (and nothing changes).
    expect(await approveViaDefiner(sql, { orgId: fx.orgId, requestId: ids.own, actorUser: fx.requesterUser })).toBe("not_approvable");
    expect(await statusOf(sql, ids.own)).toBe("submitted");
  });

  test("opening a request twice as an approver changes nothing: no event, no revision, no status (no GET mutates)", async ({ browser }) => {
    const before = { events: await eventCount(ids.mfa), revision: await revisionOf(ids.mfa), status: await statusOf(sql, ids.mfa) };
    const context = await contextFor(browser, "presbytery-nogrant");
    const page = await context.newPage();
    // The Property chair is not a Worship seat holder: the request is a 404 to them, and still nothing changes.
    await page.goto(`${base()}/${ids.mfa}`);
    await page.reload();
    await page.goto(`${base()}/${ids.stale}`);
    await page.reload();
    await page.goto(base());
    expect({ events: await eventCount(ids.mfa), revision: await revisionOf(ids.mfa), status: await statusOf(sql, ids.mfa) }).toEqual(before);
    await context.close();
  });

  // -------------------------------------------------------------------------
  test("MFA: a chair who also holds reimbursement.view is challenged at /totp keeping the path, and after the REAL code lands on the request and approves it as a seat holder", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const path = `${base()}/${ids.mfa}`;
    const chair = E2E_USERS["mfa-enrolled"];

    await page.goto(path);
    await page.waitForURL((url) => url.pathname === "/signin", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);
    await signInOnPage(page, chair.email, chair.password);
    await page.waitForURL((url) => url.pathname === "/totp", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(path);
    await submitTotp(page, E2E_TOTP_TEST_SECRET);
    // On the MEMBER address (they are a seat holder; a treasury-only viewer would be sent to the admin page).
    await page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "$75.00" })).toBeVisible();
    await expect(page.getByTestId("approve-open")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "mfa-landing");

    await page.getByTestId("approve-open").click();
    await page.getByRole("alertdialog").getByTestId("approve-confirm").click();
    await expect(page.getByTestId("request-banner")).toContainText("Waiting for payment.");
    const [approved] = await rows<{ approval_path: string; approved_by_user: string }>(
      sql`select approval_path, approved_by_user from reimbursement_requests where id = ${ids.mfa}::uuid`,
    );
    expect(approved).toMatchObject({ approval_path: "seat", approved_by_user: fx.treasurerUser });
    await context.close();
  });
});
