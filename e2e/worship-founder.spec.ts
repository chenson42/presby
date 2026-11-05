/**
 * worship-founder.spec.ts - THE F362 LESSON (worship Increment 1, Batch 6; docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 "E2E"). The founding administrator is minted by the real definer
 * (`presby_apply_founding_administrator`, the same call the platform admin's designation makes), NOT by a
 * hand-made role. She then does the whole job on a phone with NO further grant: opens "Plan worship", makes a
 * team from a ready-made set, adds a service, puts a person on a roster position and places her as a draft.
 * If the minted bundle ever lacks a worship key (as 0071's did before F362 for another feature), this fails at
 * the first page: "You don't have permission to plan worship". A presbytery-type founder is covered by the
 * unit tests (the bundle is not minted for it).
 * The founding bundle carries `role_grants.manage`, which requires a second factor, so the founder is the
 * MFA-enrolled account (real behaviour: the first sign-in asks her to enrol; the fixture enrols her).
 * Throwaway congregation; invented names; `.invalid` addresses.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  newPhonePage, noSidewaysScroll, removeWorshipFixture, setupWorshipFixture, signedInContext, smallTargets, waitHydrated,
  WORSHIP_NAMES as NAMES, type WorshipFixture,
} from "./support/worship-fixture";

let sql: Sql;
let fx: WorshipFixture;
let founder: BrowserContext;
const base = () => `/o/${fx.slug}`;

test.describe("Worship: the founding administrator needs no further grant", () => {
  test.setTimeout(240_000);
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    sql = platformSql("worship-founder.spec");
    fx = await setupWorshipFixture(sql, { tag: "f", founder: true, mfa: ["planner"] });
    founder = await signedInContext(browser, "planner", `${base()}/admin/worship`);
  });
  test.afterAll(async () => {
    await founder?.close();
    if (sql && fx) await removeWorshipFixture(sql, fx);
  });

  test("the minted bundle carries all three keys, and she can set up, schedule and place", async () => {
    const keys = (await sql`
      select distinct p.permission_key from role_grants g join app_role_permissions p on p.role_id = g.role_id
       where g.organization_id = ${fx.orgId}::uuid and g.person_id = ${fx.people.planner}::uuid and p.permission_key like 'worship.%'
       order by 1`) as Array<{ permission_key: string }>;
    expect(keys.map((k) => k.permission_key)).toEqual(["worship.manage", "worship.plan", "worship.schedule"]);

    const page = await newPhonePage(founder);
    await page.goto(`${base()}/admin/worship`);
    await expect(page.getByRole("heading", { level: 1, name: "Plan worship" })).toBeVisible();
    await expect(page.getByTestId("worship-hub").getByRole("link")).toHaveCount(3);
    await page.screenshot({ path: "test-results/worship-360/50-founder-hub.png", fullPage: true });

    // A team from the Greeters set.
    await page.goto(`${base()}/admin/worship/teams/new`);
    await waitHydrated(page);
    await page.getByLabel("Team name").fill("Welcome Team");
    await page.getByLabel("Start with").selectOption("greeters");
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Welcome Team" })).toBeVisible();
    const teamUrl = page.url();

    // A person on the roster who can fill Greeter.
    await waitHydrated(page);
    await page.getByLabel("Add a person").fill("Linus");
    await page.getByTestId("roster-results").getByRole("button", { name: /Add/ }).click();
    await expect(page.getByText("Added to the team.")).toBeVisible();
    const linus = page.getByTestId("roster-person").filter({ hasText: NAMES.linus });
    await linus.getByRole("button", { name: /^Can fill/ }).click();
    await linus.getByLabel("Greeter").check();
    await linus.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(linus).toContainText("Can fill: Greeter");
    expect(teamUrl).toContain("/admin/worship/teams/");
    await page.screenshot({ path: "test-results/worship-360/51-founder-team.png", fullPage: true });

    // A service served by the new team, then place Linus as a draft from the full board.
    await page.goto(`${base()}/admin/worship/services/new`);
    await waitHydrated(page);
    await page.getByLabel("Title").fill("Founders' Sunday");
    await page.getByLabel("Date").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel("Welcome Team").check();
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Founders' Sunday" })).toBeVisible();
    await waitHydrated(page);
    await page.getByRole("button", { name: "Add someone" }).first().click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByTestId("picker-row").first()).toContainText(NAMES.linus);
    await picker.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.getByText("Added. Send requests when you're ready.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("status-chip").filter({ hasText: "Not sent yet" })).toHaveCount(1);
    await expect(page.getByTestId("send-open")).toBeVisible();
    await noSidewaysScroll(page);
    await page.screenshot({ path: "test-results/worship-360/52-founder-board.png", fullPage: true });
    expect(await smallTargets(page)).toEqual([]);
    await page.close();
  });
});
