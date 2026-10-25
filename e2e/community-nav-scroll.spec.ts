/**
 * community-nav-scroll.spec.ts - the Community view switcher at 360x740
 * (Increment 3a, Batch 0, EC-17). The ButtonGroup scrolls the active segment
 * into view and shows an edge fade on the side that still has content.
 *
 * Counts are read from the DOM rather than hard-coded, so the spec holds as
 * segments are added (the seventh, Inactive, lands in a later batch).
 * Fixture: congregation-clerk with `people.manage`; see community-fixture.ts.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { platformSql, type Sql } from "./support/db";
import {
  COMMUNITY_ORG,
  removeCommunityFixture,
  setupCommunityFixture,
  type CommunityFixtureState,
} from "./support/community-fixture";

const BASE = `/o/${COMMUNITY_ORG.slug}/admin/community`;

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The edge fade as the container's own data attributes report it. */
async function fade(group: Locator) {
  return group.evaluate((el) => ({
    left: (el as HTMLElement).dataset.fadeLeft,
    right: (el as HTMLElement).dataset.fadeRight,
  }));
}

/** Every link sits fully inside the visible box of the scroll container. */
async function fullyVisible(group: Locator, link: Locator) {
  const g = (await group.boundingBox())!;
  const l = (await link.boundingBox())!;
  expect(l.x).toBeGreaterThanOrEqual(g.x - 1);
  expect(l.x + l.width).toBeLessThanOrEqual(g.x + g.width + 1);
}

test.describe("Community nav at 360px", () => {
  test.setTimeout(120_000);
  test.use({
    storageState: storageStatePath("congregation-clerk"),
    viewport: { width: 360, height: 740 },
  });

  let sql: Sql;
  let state: CommunityFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("community-nav-scroll.spec");
    state = await setupCommunityFixture(sql);
  });
  test.afterAll(async () => {
    await removeCommunityFixture(sql, state);
  });

  test("landing on each segment shows it fully, with a fade only on the overflowing side", async ({ page }) => {
    await page.goto(BASE);
    const group = page.getByRole("group", { name: "Community view" });
    await expect(group).toHaveAttribute("data-fade-right", /true|false/); // hydrated
    const hrefs = await group.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThanOrEqual(6);

    // The row overflows at 360px, so it is scrollable and the first segment
    // shows a right fade only.
    expect(await group.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await fade(group)).toEqual({ left: "false", right: "true" });

    for (const href of hrefs) {
      await page.goto(href);
      const g = page.getByRole("group", { name: "Community view" });
      await expect(g).toHaveAttribute("data-fade-right", /true|false/);
      const current = g.locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await fullyVisible(g, current);
      const f = await fade(g);
      const scroll = await g.evaluate((e) => ({ s: e.scrollLeft, max: e.scrollWidth - e.clientWidth }));
      expect(f.left === "true").toBe(scroll.s > 1);
      expect(f.right === "true").toBe(scroll.s < scroll.max - 1);
      await noHorizontalOverflow(page);
    }
  });

  test("landing on ?view=visitors scrolls Visitors into view", async ({ page }) => {
    await page.goto(`${BASE}?view=visitors`);
    const group = page.getByRole("group", { name: "Community view" });
    await expect(group).toHaveAttribute("data-fade-right", /true|false/);
    await fullyVisible(group, group.getByRole("link", { name: "Visitors" }));
    expect((await fade(group)).left).toBe("true");
  });

  test("every segment is reachable by scrolling, and the fade follows", async ({ page }) => {
    await page.goto(BASE);
    const group = page.getByRole("group", { name: "Community view" });
    await expect(group).toHaveAttribute("data-fade-right", /true|false/);
    const last = group.getByRole("link").last();
    await group.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await expect.poll(() => fade(group)).toEqual({ left: "true", right: "false" });
    await fullyVisible(group, last);
    await last.click();
    await expect(page).toHaveURL(/view=/);
    await noHorizontalOverflow(page);
  });
});
