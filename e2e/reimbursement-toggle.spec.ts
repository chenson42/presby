/**
 * reimbursement-toggle.spec.ts - the per-organization TOGGLE, driven from the Features
 * page against a running server (Treasury Increment 1, Batch 7; docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 "Flags each e2e spec depends on", Copy C1 and C2, DECISION-269's
 * toggle, accepted residual 9: the toggle is enforced in TypeScript only).
 *
 *   - OFF (the default): every member and treasurer page answers the honest "isn't turned on"
 *     state at HTTP 200 (never a 404), the CSV, the print form and every other route handler
 *     answer 404, and a `manage`-less viewer is told whom to ask while an
 *     `org_features.manage` holder is told where to turn it on.
 *   - ON from the Features page: the pages work.
 *   - OFF again with requests open: the page asks first (Copy C1: how many are open), and
 *     "Keep it on" leaves it on; "Turn it off" hides every page and DELETES NOTHING.
 *   - ON again: everything is back, the same requests, the same counts.
 *
 * The Features page itself sits behind the PLATFORM flag `org_portal.features`; the spec turns
 * that on and puts it back as it found it through `e2e/support/flags.ts` (captureFlags
 * verifies the restore by SELECT, as `giving-admin.spec.ts` does). Nothing is added to
 * `scripts/ci/e2e-baseline-flags.sql`: the reimbursement toggle is per organization.
 *
 * Cast: Octavia (the `mfa-enrolled` user) holds the four reimbursement keys AND
 * `org_features.manage` through custom roles; Tamsin (the `member` user) is a plain member who
 * holds neither. Everything lives in a THROWAWAY congregation (`e2e-reimbg-<stamp>`) removed
 * in afterAll. Invented names, `.invalid` addresses, no real data.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  createRoleAndGrant,
  noHorizontalScroll,
  REIMB_NAMES as NAMES,
  removeReimbursementFixture,
  seedRequest,
  setupReimbursementFixture,
  verifiedTreasurerContext,
  waitHydrated,
  type ReimbursementFixture,
} from "./support/reimbursement-fixture";
import { storageStatePath } from "./support/users";

const TOGGLE_KEY = "org_portal.reimbursement";
const OFF_BODY =
  "2 requests are open (waiting for approval, for the requester, or for payment). Turning this off hides the pages and nothing is deleted. Turning it back on restores everything.";

let sql: Sql;
let fx: ReimbursementFixture;
let flags: FlagCapture;
let treasurer: BrowserContext;
const ids: Record<string, string> = {};

const member = () => `/o/${fx.slug}/reimbursements`;
const admin = () => `/o/${fx.slug}/admin/reimbursements`;
const features = () => `/o/${fx.slug}/admin/features`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

const toggleRow = async () =>
  (await rows<{ enabled: boolean }>(sql`select enabled from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = ${TOGGLE_KEY}`))[0];
const requestCount = async () =>
  Number((await rows<{ n: number }>(sql`select count(*)::int as n from reimbursement_requests where organization_id = ${fx.orgId}::uuid`))[0]!.n);

async function treasurerPage(width = 360, height = 740): Promise<Page> {
  const page = await treasurer.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `test-results/reimbursement-360/toggle-${name}.png`, fullPage });
}

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements: the organization toggle, from the Features page", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    sql = platformSql("reimbursement-toggle.spec");
    flags = await captureFlags(sql, ["org_portal.features"]);
    // The toggle is OFF to start (no row): the state a congregation is in before anyone turns the feature on.
    fx = await setupReimbursementFixture(sql, { tag: "g", toggle: false });
    await createRoleAndGrant(sql, fx.orgId, {
      roleId: "e2e96000-0000-4000-8000-000000000033",
      key: "e2e_reimb_features",
      name: "E2E Features",
      permissions: ["org_features.manage"],
      personId: fx.treasurerPerson,
      grantedBy: fx.treasurerUser,
    });
    const actors = { orgId: fx.orgId, categorySupplies: fx.categorySupplies, requesterUser: fx.requesterUser, chairUser: fx.chairUser, treasurerUser: fx.treasurerUser };
    // Two OPEN requests (one waiting for approval, one waiting for payment) and one paid: the warning counts the two.
    ids.waiting = await seedRequest(sql, actors, { key: "tog-waiting-001", group: fx.groupProperty, cents: 3000, purpose: "Candles for Advent", upTo: "submitted" });
    ids.payable = await seedRequest(sql, actors, { key: "tog-payable-001", group: fx.groupProperty, cents: 4250, purpose: "Folding tables", upTo: "waived" });
    ids.paid = await seedRequest(sql, actors, { key: "tog-paid-000001", group: fx.groupProperty, cents: 1999, purpose: "Hymnal repair kit", upTo: "paid", reference: "1001" });
    await setFlag(sql, "org_portal.features", true);
    treasurer = await verifiedTreasurerContext(browser, features());
  });

  test.afterAll(async () => {
    test.setTimeout(240_000);
    await treasurer?.close().catch(() => undefined);
    if (fx) await removeReimbursementFixture(sql, fx);
    await flags?.restore();
  });

  // -------------------------------------------------------------------------
  test("OFF (the default): every page is the honest 'isn't turned on' state at HTTP 200, every route handler is a 404, and each viewer is told what they can do", async ({ browser }) => {
    expect(await toggleRow()).toBeUndefined();

    // A plain member: whom to ask.
    const plain = await browser.newContext({ storageState: storageStatePath("member"), viewport: { width: 360, height: 740 } });
    const mine = await plain.newPage();
    for (const path of [member(), `${member()}/new`, `${member()}/${ids.waiting}`]) {
      const res = await mine.goto(path);
      expect(res!.status(), path).toBe(200);
      await expect(mine.getByText(`Reimbursements aren't turned on for ${NAMES.org}.`), path).toBeVisible();
      await expect(mine.getByText("Ask an administrator who manages your organization's features to turn it on."), path).toBeVisible();
      await expect(mine.getByRole("link", { name: "Features" }), path).toHaveCount(0);
    }
    await noHorizontalScroll(mine);
    await shot(mine, "off-member");
    await plain.close();

    // The treasurer, who also manages features: where to turn it on.
    const page = await treasurerPage();
    for (const path of [member(), admin(), `${admin()}/settings`, `${admin()}/team`, `${admin()}/${ids.waiting}`, `${member()}/${ids.waiting}`]) {
      const res = await page.goto(path);
      expect(res!.status(), path).toBe(200);
      await expect(page.getByText(`Reimbursements aren't turned on for ${NAMES.org}.`), path).toBeVisible();
      await expect(page.getByText("You can turn them on under Features."), path).toBeVisible();
      await expect(page.getByRole("link", { name: "Features" }), path).toHaveAttribute("href", features());
    }
    await noHorizontalScroll(page);
    await shot(page, "off-manager");

    // Route handlers have no honest page to render: a 404, never a file.
    for (const path of [`${admin()}/export`, `${member()}/${ids.waiting}/print`]) {
      expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
    await page.close();
  });

  test("the Features page shows Reimbursements (off); turning it on needs no confirmation, and the pages work", async () => {
    const page = await treasurerPage();
    await page.goto(features());
    await waitHydrated(page);
    const reimbursements = page.locator("h3", { hasText: /^Reimbursements$/ });
    await expect(reimbursements).toBeVisible();
    await expect(
      page.getByText("Lets members ask for reimbursement or a vendor payment, lets the chairs and leaders of a group approve it, and lets the treasurer record the payment. It doesn't send money. Turning this off hides every reimbursement page and deletes nothing."),
    ).toBeVisible();
    const toggle = page.getByRole("switch", { name: /^Reimbursements, currently off/ });
    await expect(toggle).toBeVisible();
    await shot(page, "features-off");
    await toggle.click();
    await expect(page.getByText("Reimbursements turned on.").first()).toBeVisible();
    expect(await toggleRow()).toMatchObject({ enabled: true });
    await expect(page.getByRole("switch", { name: /^Reimbursements, currently on/ })).toBeVisible();
    await shot(page, "features-on");

    // The pages now work, and the open requests are all there.
    await page.goto(member());
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursements" })).toBeVisible();
    await expect(page.getByText(`Reimbursements aren't turned on for ${NAMES.org}.`)).toHaveCount(0);
    await page.goto(admin());
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursement requests" })).toBeVisible();
    await expect(page.getByTestId("queue-tabs").getByRole("link", { name: "Waiting for payment (1)" })).toBeVisible();
    await expect(page.getByTestId("queue-tabs").getByRole("link", { name: "In progress (1)" })).toBeVisible();
    expect((await page.request.get(`${admin()}/export`, { maxRedirects: 0 })).status()).toBe(200);
    expect((await page.request.get(`${member()}/${ids.paid}/print`, { maxRedirects: 0 })).status()).toBe(200);
    await page.close();
  });

  test("turning it OFF with requests open asks first and says how many; 'Keep it on' leaves it on", async () => {
    const page = await treasurerPage();
    await page.goto(features());
    await waitHydrated(page);
    await page.getByRole("switch", { name: /^Reimbursements, currently on/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Turn off Reimbursements?");
    // Copy C1's body names the count: 2 open (waiting for approval, and waiting for payment); the paid one is not open.
    await expect(dialog).toContainText(OFF_BODY);
    // The shared Features page titles every off-dialog "Turn off {name}?" and renders only the warning's description;
    // C1's own title ("Reimbursement requests are still open") is the warning's `title`, which that page does not draw
    // (giving's is the same). Pinned as shipped, and reported to the tech-lead as a Copy gap.
    await page.waitForTimeout(400); // let the dialog finish fading in before the screenshot
    await shot(page, "off-warning", false);
    await dialog.getByRole("button", { name: "Keep it on" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await toggleRow()).toMatchObject({ enabled: true });
    await page.close();
  });

  test("'Turn it off' hides every page and deletes NOTHING; turning it back on restores everything", async () => {
    const before = await requestCount();
    expect(before).toBe(3);
    const page = await treasurerPage();
    await page.goto(features());
    await waitHydrated(page);
    await page.getByRole("switch", { name: /^Reimbursements, currently on/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn it off" }).click();
    await expect(page.getByText("Reimbursements turned off.").first()).toBeVisible();
    expect(await toggleRow()).toMatchObject({ enabled: false });

    // Hidden: the honest state at 200 for every page, a 404 for the routes.
    for (const path of [member(), admin(), `${admin()}/${ids.payable}`]) {
      const res = await page.goto(path);
      expect(res!.status(), path).toBe(200);
      await expect(page.getByText(`Reimbursements aren't turned on for ${NAMES.org}.`), path).toBeVisible();
    }
    expect((await page.request.get(`${admin()}/export`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get(`${member()}/${ids.paid}/print`, { maxRedirects: 0 })).status()).toBe(404);
    // ... and nothing was deleted: the same three requests, their events, the payment.
    expect(await requestCount()).toBe(before);
    const events = await rows<{ n: number }>(sql`select count(*)::int as n from reimbursement_events where organization_id = ${fx.orgId}::uuid`);
    expect(events[0]!.n).toBeGreaterThan(0);
    const payments = await rows<{ n: number }>(sql`select count(*)::int as n from reimbursement_payments where organization_id = ${fx.orgId}::uuid`);
    expect(payments[0]!.n).toBe(1);

    // Turning it back on needs no confirmation and restores everything.
    await page.goto(features());
    await waitHydrated(page);
    await page.getByRole("switch", { name: /^Reimbursements, currently off/ }).click();
    await expect(page.getByText("Reimbursements turned on.").first()).toBeVisible();
    await page.goto(admin());
    await expect(page.getByTestId("queue-tabs").getByRole("link", { name: "Waiting for payment (1)" })).toBeVisible();
    await expect(page.getByTestId("queue-tabs").getByRole("link", { name: "In progress (1)" })).toBeVisible();
    await page.goto(`${admin()}/${ids.paid}`);
    await expect(page.getByTestId("payment-row")).toContainText("Check number 1001");
    expect(await requestCount()).toBe(before);
    await noHorizontalScroll(page);
    await page.close();
  });

  test("with nothing open the switch turns off with no question asked", async () => {
    // Close the two open requests the way the app does (void), then the warning has nothing to say.
    for (const key of [ids.waiting, ids.payable]) {
      await sql.query(`
        do $do$
        declare v_out text;
        begin
          perform set_config('app.current_org_id', '${fx.orgId}', true);
          select o.outcome into v_out from presby_reimbursement_void('${key}'::uuid, 'No longer needed', '${fx.treasurerUser}'::uuid) o;
          if v_out <> 'ok' then raise exception 'void refused: %', v_out; end if;
        end $do$`);
    }
    const page = await treasurerPage();
    await page.goto(features());
    await waitHydrated(page);
    await page.getByRole("switch", { name: /^Reimbursements, currently on/ }).click();
    await expect(page.getByText("Reimbursements turned off.").first()).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await toggleRow()).toMatchObject({ enabled: false });
    await page.close();
  });
});
