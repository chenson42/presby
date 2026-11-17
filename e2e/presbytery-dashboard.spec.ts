/**
 * presbytery-dashboard.spec.ts - `/o/<slug>/admin/insights` for a presbytery
 * (docs/work-log/2026-11-17-presbytery-dashboard.md, Phase 3 "New e2e spec",
 * DECISION-342).
 *
 * Runs against its OWN dev server (port 3101, `E2E_BASE_URL=http://localhost:3101`),
 * never :3000. Every flag it depends on is set here through
 * `captureFlags`/`setFlag` and restored in `afterAll` (the CI reset file seeds
 * `org_portal.insights` false, so nothing relies on the baseline): insights,
 * reports, oversight, credentials and home_v2. Stages one appointment in the
 * e2e presbytery (an installed call that ended two years ago at the alpha
 * congregation, so appointments are recorded and alpha is vacant) and removes
 * it in `afterAll`. Assertions are about structure and the rows this spec
 * staged, never counts: other specs share the e2e presbytery.
 *
 * Who is who: `presbytery-clerk` holds all four report keys; `org-multi` holds
 * `statistics.manage` only at the presbytery (one card, three locked);
 * `presbytery-nogrant` holds none (one forbidden state).
 *
 * Both the viability card list and its table are in the DOM (CSS hides one), so
 * those assertions are scoped by `data-testid`.
 */
import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";

const INSIGHTS = "org_portal.insights";
const REPORTS = "org_portal.reports";
const OVERSIGHT = "org_portal.oversight";
const CREDENTIALS = "org_portal.credentials";
const HOME_V2 = "org_portal.home_v2";
const FLAGS = [INSIGHTS, REPORTS, OVERSIGHT, CREDENTIALS, HOME_V2];

const SLUG = E2E_ORGS.presbytery.slug;
const PAGE = `/o/${SLUG}/admin/insights`;
const STAGED_MINUTE = "e2e presbytery-dashboard staged";

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe.serial("Presbytery dashboard (2026-11-17-presbytery-dashboard)", () => {
  let sql: Sql;
  let flags: FlagCapture;

  async function removeStaged() {
    await sql`delete from appointments where organization_id = ${E2E_ORGS.presbytery.id}::uuid and minute_reference = ${STAGED_MINUTE}`;
  }

  test.beforeAll(async () => {
    sql = platformSql("presbytery-dashboard.spec");
    flags = await captureFlags(sql, FLAGS);
    for (const key of FLAGS) await setFlag(sql, key, true);

    const members = (await sql`
      select person_id from memberships where organization_id = ${E2E_ORGS.presbytery.id}::uuid order by created_at limit 1
    `) as { person_id: string }[];
    await removeStaged();
    await sql`
      insert into appointments (organization_id, person_id, serving_org_id, call_type, starts_on, ends_on, end_reason, minute_reference)
      values (${E2E_ORGS.presbytery.id}::uuid, ${members[0].person_id}::uuid, ${E2E_ORGS.alpha.id}::uuid, 'installed_pastor',
              (current_date - interval '9 years')::date, (current_date - interval '2 years')::date, 'Retired', ${STAGED_MINUTE})
    `;
  });

  test.afterAll(async () => {
    await removeStaged();
    await flags.restore();
  });

  test("the clerk sees the four card headings, a vacant count and the viability list with links to oversight", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await page.goto(PAGE);

    await expect(page.getByRole("heading", { level: 1, name: "Insights & Analytics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Member congregations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ending active members" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vacant pulpits" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Per capita, \d{4}$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Viability" })).toBeVisible();

    await expect(page.getByTestId("dashboard-card-vacant")).toContainText(/\d+ vacant of \d+ congregations/);
    await expect(page.getByText("Locked")).toHaveCount(0);

    const table = page.getByTestId("dashboard-viability-table");
    await expect(table.getByText(E2E_ORGS.alpha.name)).toBeVisible();
    await expect(table.locator(`a[href="/o/${SLUG}/admin/oversight/${E2E_ORGS.alpha.id}"]`)).toBeVisible();
    await context.close();
  });

  test("org-multi (statistics only) sees Ending active members and three Locked cards naming their permissions", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-multi") });
    const page = await context.newPage();
    await page.goto(PAGE);

    await expect(page.getByRole("heading", { name: "Ending active members" })).toBeVisible();
    await expect(page.getByTestId("dashboard-card-trend").getByText("Locked")).toHaveCount(0);
    await expect(page.getByText("Locked")).toHaveCount(3);
    await expect(page.getByTestId("dashboard-card-vacant")).toContainText("manage credentials");
    await expect(page.getByTestId("dashboard-card-per-capita")).toContainText("manage per-capita billing");
    await expect(page.getByTestId("dashboard-viability")).toContainText("manage congregation oversight");
    await context.close();
  });

  test("a member with none of the four keys sees one forbidden state and no card heading", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-nogrant") });
    const page = await context.newPage();
    await page.goto(PAGE);

    await expect(page.getByText(/It summarizes four reports/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Member congregations" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Vacant pulpits" })).toHaveCount(0);
    await expect(page.getByText("Locked")).toHaveCount(0);
    await context.close();
  });

  test("with oversight off the viability names are not links; with reports off the card links are absent and the figures remain", async ({ browser }) => {
    await setFlag(sql, OVERSIGHT, false);
    await setFlag(sql, REPORTS, false);
    try {
      const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
      const page = await context.newPage();
      await page.goto(PAGE);

      await expect(page.getByTestId("dashboard-viability-table").getByText(E2E_ORGS.alpha.name)).toBeVisible();
      await expect(page.getByTestId("dashboard-viability").getByRole("link")).toHaveCount(0);
      for (const id of ["trend", "vacant", "per-capita"]) {
        await expect(page.getByTestId(`dashboard-card-${id}`).getByRole("link")).toHaveCount(0);
      }
      await expect(page.getByTestId("dashboard-card-vacant")).toContainText(/\d+ vacant of \d+ congregations/);
      await context.close();
    } finally {
      await setFlag(sql, OVERSIGHT, true);
      await setFlag(sql, REPORTS, true);
    }
  });

  test("with org_portal.insights off the page says it isn't turned on", async ({ browser }) => {
    await setFlag(sql, INSIGHTS, false);
    try {
      const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
      const page = await context.newPage();
      await page.goto(PAGE);
      await expect(page.getByText(/Insights & Analytics isn.t turned on for/)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Vacant pulpits" })).toHaveCount(0);
      await context.close();
    } finally {
      await setFlag(sql, INSIGHTS, true);
    }
  });

  test("the Insights tile has no Coming soon pill on the presbytery home and has one on a congregation's home", async ({ browser }) => {
    const presbyteryContext = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const presbyteryPage = await presbyteryContext.newPage();
    await presbyteryPage.goto(`/o/${SLUG}`);
    const live = presbyteryPage.locator(`a[href="${PAGE}"]`);
    await expect(live).toBeVisible();
    await expect(live).not.toContainText("Coming soon");
    await presbyteryContext.close();

    const congregationContext = await browser.newContext({ storageState: storageStatePath("org-single") });
    const congregationPage = await congregationContext.newPage();
    await congregationPage.goto(`/o/${E2E_ORGS.alpha.slug}`);
    const stub = congregationPage.locator(`a[href="/o/${E2E_ORGS.alpha.slug}/admin/insights"]`);
    await expect(stub).toBeVisible();
    await expect(stub).toContainText("Coming soon");
    await congregationContext.close();
  });

  test("at 360px there is no horizontal overflow, the viability cards (not the table) show, and the page scrolls to the list", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 740 },
    });
    const page = await context.newPage();
    await page.goto(PAGE);

    await expect(page.getByRole("heading", { level: 1, name: "Insights & Analytics" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await expect(page.getByTestId("dashboard-viability-table")).toBeHidden();
    const cards = page.getByTestId("dashboard-viability-cards");
    await cards.scrollIntoViewIfNeeded();
    await expect(cards).toBeVisible();
    await expect(cards.getByText(E2E_ORGS.alpha.name)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The cards stack in one column: every card is as wide as the first.
    const boxes = await page.getByTestId("dashboard-cards").locator("> section").evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().left)),
    );
    expect(new Set(boxes).size).toBe(1);
    await context.close();
  });
});
