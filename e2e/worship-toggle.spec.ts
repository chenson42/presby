/**
 * worship-toggle.spec.ts - the per-organization Worship toggle (worship Increment 1, Batch 6).
 * OFF (the provisioned default): every worship page answers the honest "isn't turned on" state at
 * HTTP 200, never a 404; a member is told whom to ask, and a holder of org_features.manage is
 * given the link to Features. Nothing is deleted by turning it off: the request is still there
 * when it comes back. A presbytery-type organization is not covered here (its state is pinned by the
 * unit pages test). Throwaway congregation; the toggle is a per-org ROW, not a platform flag, so no
 * flag is captured or restored.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  newPhonePage, noSidewaysScroll, removeWorshipFixture, seedAssignment, setToggle, setupWorshipFixture, signedInContext, waitHydrated,
  type WorshipFixture,
} from "./support/worship-fixture";

let sql: Sql;
let flags: FlagCapture;
let fx: WorshipFixture;
let wren: BrowserContext;
let planner: BrowserContext;
const base = () => `/o/${fx.slug}`;

test.describe.configure({ mode: "serial" });

test.describe("Worship: the organization toggle", () => {
  test.setTimeout(180_000);
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    sql = platformSql("worship-toggle.spec");
    // The Features page sits behind the PLATFORM flag org_portal.features: set it, and put it back as found.
    flags = await captureFlags(sql, ["org_portal.features"]);
    await setFlag(sql, "org_portal.features", true);
    fx = await setupWorshipFixture(sql, { tag: "t", toggle: null });
    await seedAssignment(sql, fx, { who: "wren", position: "vocals", upTo: "requested" });
    wren = await signedInContext(browser, "wren", `${base()}/worship`);
    planner = await signedInContext(browser, "planner", `${base()}/admin/worship`);
  });
  test.afterAll(async () => {
    await wren?.close();
    await planner?.close();
    if (sql && fx) await removeWorshipFixture(sql, fx);
    await flags?.restore();
  });

  test("off: a member is told whom to ask, at 200", async () => {
    const page = await newPhonePage(wren);
    for (const path of ["/worship", "/worship/blockouts", `/worship/teams/${fx.band}`]) {
      const response = await page.goto(`${base()}${path}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId("worship-off")).toContainText(`Worship isn't turned on for ${fx.name} yet.`);
      await expect(page.getByTestId("worship-off")).toContainText(`Ask someone who manages ${fx.name}'s features to turn it on.`);
    }
    await noSidewaysScroll(page);
    await page.screenshot({ path: "test-results/worship-360/40-off-member.png", fullPage: true });
    await page.close();
  });

  test("off: the planner (who manages features) is given the link", async () => {
    const page = await newPhonePage(planner);
    const response = await page.goto(`${base()}/admin/worship`);
    expect(response?.status()).toBe(200);
    const link = page.getByRole("link", { name: "Turn it on under Features" });
    await expect(link).toHaveAttribute("href", `${base()}/admin/features`);
    await page.screenshot({ path: "test-results/worship-360/41-off-planner.png", fullPage: true });
    await page.close();
  });

  test("on: the pages work and the request is still there; off again deletes nothing", async () => {
    await setToggle(sql, fx.orgId, true);
    const page = await newPhonePage(wren);
    await page.goto(`${base()}/worship`);
    await expect(page.getByTestId("section-waiting")).toContainText("Vocals, Sunday Band");
    await setToggle(sql, fx.orgId, false);
    await page.reload();
    await expect(page.getByTestId("worship-off")).toBeVisible();
    const [{ n }] = (await sql`select count(*)::int as n from worship_assignments where organization_id = ${fx.orgId}::uuid`) as Array<{ n: number }>;
    expect(n).toBe(1);
    await setToggle(sql, fx.orgId, true);
    await page.reload();
    await expect(page.getByTestId("section-waiting")).toBeVisible();
    await page.close();
  });

  test("the Features card: Worship (on) asks first and says how many are scheduled; 'Keep it on' leaves it; 'Turn it off' deletes nothing", async () => {
    await setToggle(sql, fx.orgId, true);
    const page = await newPhonePage(planner);
    await page.goto(`${base()}/admin/features`);
    await waitHydrated(page);
    await expect(page.locator("h3", { hasText: /^Worship$/ })).toBeVisible();
    await expect(
      page.getByText("Lets your congregation set up worship teams, plan services on the calendar, and ask people to serve. Turning this off hides every worship page and stops requests and reminders. Nothing is deleted."),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/worship-360/42-features-on.png", fullPage: true });
    await page.getByRole("switch", { name: /^Worship, currently on/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Turn off Worship?");
    // Wren's one open request: Copy G8, singular.
    await expect(dialog).toContainText(
      "1 person is asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted.",
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/worship-360/43-features-off-warning.png", fullPage: true });
    await dialog.getByRole("button", { name: "Keep it on" }).click();
    await expect(dialog).toHaveCount(0);
    const row = async () => (await sql`select enabled from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = 'org_portal.worship'`) as Array<{ enabled: boolean }>;
    expect(await row()).toEqual([{ enabled: true }]);

    await page.getByRole("switch", { name: /^Worship, currently on/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn it off" }).click();
    await expect(page.getByText("Worship turned off.").first()).toBeVisible();
    expect(await row()).toEqual([{ enabled: false }]);
    const [{ n }] = (await sql`select count(*)::int as n from worship_assignments where organization_id = ${fx.orgId}::uuid`) as Array<{ n: number }>;
    expect(n).toBe(1);
    await page.close();
  });
});
