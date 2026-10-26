/**
 * public-calendar.spec.ts - the public events calendar on the PLATFORM host
 * (`/site/<slug>`) and the editor flow that feeds it (docs/work-log/
 * 2026-10-25-public-events-calendar.md, Phase 3 T19; DECISION-238/239/240).
 * The same page on a church's own domain is e2e/custom-domains/public-calendar.spec.ts.
 *
 * Creates only its own rows (a throwaway `e2e-pubcal-*` congregation; on
 * e2e-alpha a live site, the toggle and events titled `E2E Editor flow ...`)
 * and removes them in afterAll, confirmed by SELECT (DECISION-157). Every flag
 * it moves is captured and restored through e2e/support/flags.ts; none is added
 * to scripts/ci/e2e-baseline-flags.sql.
 *
 * The calendar's panels are server-rendered once per month and CSS picks the
 * layout, so visibility, not presence, is what is asserted for what a visitor
 * sees, and `page.content()` (the whole HTML, hidden panels included) is what
 * is asserted for what must NEVER be sent at all.
 */

import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import {
  CAL_PEOPLE,
  grantCalendarRole,
  removeCalendarFixture,
  revokeCalendarRole,
  setupCalendarFixture,
  type CalendarFixtureState,
} from "./support/calendar-fixture";
import {
  ALPHA_EVENT_PREFIX,
  PUBCAL_TEXT,
  PUBCAL_TITLES,
  orgMonths,
  removeAlphaSite,
  removePublicCalendarWorld,
  setListed,
  setMemberCalendarToggle,
  setPublicCalendarToggle,
  setSiteStatus,
  setWorshipCategory,
  setupAlphaSite,
  setupPublicCalendarWorld,
  type AlphaSiteState,
  type OrgMonths,
  type PublicCalendarWorld,
} from "./support/public-calendar-fixture";

const FLAGS = ["sites.public_render", "org_portal.events", "org_portal.feature_categories"];
const UNAVAILABLE = "Our events calendar isn't available right now. Please check back soon.";
const EMPTY = "No events are on this calendar right now.";
const MARKED = [PUBCAL_TITLES.today, PUBCAL_TITLES.listed, PUBCAL_TITLES.second, PUBCAL_TITLES.long];
const NEVER = [PUBCAL_TITLES.membersOnly, PUBCAL_TITLES.cancelled, PUBCAL_TITLES.unlisted, "Session business"];

/** Waits for hydration (the arrows are `disabled` until then) and returns. */
async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: /^Next month/ })).toBeEnabled();
}

/** Clicks Next until the heading reads `label` (at most the window's 14 months). */
async function openMonth(page: Page, label: string) {
  await hydrated(page);
  for (let i = 0; i < 14; i += 1) {
    if ((await page.getByTestId("public-calendar-month").textContent()) === label) return;
    await page.getByRole("button", { name: /^Next month/ }).click();
  }
  await expect(page.getByTestId("public-calendar-month")).toHaveText(label);
}

async function noHorizontalScroll(page: Page, width: number) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw, `scrollWidth ${m.sw} vs viewport ${width}`).toBeLessThanOrEqual(width);
  expect(m.cw).toBeLessThanOrEqual(width);
}

test.describe("Public events calendar - platform host", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let flags: FlagCapture;
  let world: PublicCalendarWorld;
  let months: OrgMonths;
  const url = () => `/site/${world.slug}`;

  test.beforeAll(async () => {
    sql = platformSql("public-calendar.spec");
    flags = await captureFlags(sql, FLAGS);
    await setFlag(sql, "sites.public_render", true);
    world = await setupPublicCalendarWorld(sql);
    months = await orgMonths(sql);
    await setPublicCalendarToggle(sql, world.orgId, true);
  });

  test.afterAll(async () => {
    if (world) await removePublicCalendarWorld(sql, world);
    if (flags) await flags.restore();
  });

  test.afterEach(async () => {
    // Every test starts from: toggle on, the four marked events marked, member prompt off, category row absent.
    await setPublicCalendarToggle(sql, world.orgId, true);
    await setMemberCalendarToggle(sql, world.orgId, null);
    await setWorshipCategory(sql, world.orgId, null);
    await setSiteStatus(sql, world.orgId, "live");
    for (const title of MARKED) await setListed(sql, world.orgId, title, true);
    await setFlag(sql, "org_portal.feature_categories", flags.values["org_portal.feature_categories"]!);
  });

  test("the toggle off (no row) shows the one unavailable sentence and none of the events", async ({ page }) => {
    await setPublicCalendarToggle(sql, world.orgId, null);
    const response = await page.goto(url());
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("public-calendar-unavailable")).toHaveText(UNAVAILABLE);
    await expect(page.getByTestId("public-calendar")).toHaveCount(0);
    const html = await page.content();
    for (const title of [...MARKED, ...NEVER]) expect(html).not.toContain(title);
    expect(html).not.toContain(EMPTY);
  });

  test("the toggle on with nothing marked says so plainly, not 'unavailable'", async ({ page }) => {
    for (const title of MARKED) await setListed(sql, world.orgId, title, false);
    await page.goto(url());
    await expect(page.getByTestId("public-calendar-empty")).toContainText(EMPTY);
    await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
    await expect(page.getByTestId("public-calendar")).toHaveCount(0);
  });

  test("a category switched off while the category axis is on gives the same unavailable notice", async ({ page }) => {
    await setFlag(sql, "org_portal.feature_categories", true);
    await setWorshipCategory(sql, world.orgId, false);
    await page.goto(url());
    await expect(page.getByTestId("public-calendar-unavailable")).toHaveText(UNAVAILABLE);

    // The axis off makes the category row inert again.
    await setFlag(sql, "org_portal.feature_categories", false);
    await page.goto(url());
    await expect(page.getByTestId("public-calendar")).toBeVisible();
  });

  test("a site that is not live gives the same notice the toggle off does (nothing about which events exist)", async ({ page }) => {
    await setSiteStatus(sql, world.orgId, "suspended");
    const response = await page.goto(url());
    // A suspended site is not served at all: the neutral 404, never the calendar.
    expect(response?.status()).toBe(404);
    expect(await page.content()).not.toContain(PUBCAL_TITLES.listed);
  });

  test("only the marked events appear; members-only, cancelled and unmarked ones are never sent", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole("region", { name: "Events calendar" })).toBeVisible();
    await expect(page.getByTestId("public-calendar-month")).toHaveText(months.currentLabel);
    await expect(page.getByText(PUBCAL_TITLES.today)).toBeVisible();

    await openMonth(page, months.nextLabel);
    await expect(page.locator("[data-month]:not([hidden])").getByText(PUBCAL_TITLES.listed)).toBeVisible();
    await expect(page.locator("[data-month]:not([hidden])").getByText(PUBCAL_TITLES.second)).toBeVisible();

    const html = await page.content();
    for (const title of NEVER) expect(html, title).not.toContain(title);
    // The projection is an allow-list with no id: no event uuid anywhere in what a visitor receives.
    const dayIds = html.match(/e2e94001-0000-4000-8000-\d{12}/g) ?? [];
    expect(dayIds).toEqual([]);
  });

  test("months switch after hydration, Today returns, and the window's last month states what it covers", async ({ page }) => {
    await page.goto(url());
    await hydrated(page);
    await page.getByRole("button", { name: /^Next month/ }).click();
    await expect(page.getByTestId("public-calendar-month")).toHaveText(months.nextLabel);
    await page.getByRole("button", { name: /^Previous month/ }).click();
    await expect(page.getByTestId("public-calendar-month")).toHaveText(months.currentLabel);
    await expect(page.getByRole("button", { name: "Today" })).toBeDisabled();
    await page.getByRole("button", { name: /^Next month/ }).click();
    await expect(page.getByRole("button", { name: "Today" })).toBeEnabled();
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByTestId("public-calendar-month")).toHaveText(months.currentLabel);

    // Walk to the end: Next disables and the edge note appears there only.
    await expect(page.getByTestId("public-calendar-edge-note")).toHaveCount(0);
    for (let i = 0; i < 14 && (await page.getByRole("button", { name: /^Next month/ }).isEnabled()); i += 1) {
      await page.getByRole("button", { name: /^Next month/ }).click();
    }
    await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
    await expect(page.getByTestId("public-calendar-edge-note")).toContainText("This calendar shows events through");
  });

  test("the member sign-in prompt appears only with the member calendar on, and leads to the platform's member calendar", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole("link", { name: "Member sign-in" })).toHaveCount(0);

    await setMemberCalendarToggle(sql, world.orgId, true);
    await page.goto(url());
    const link = page.getByRole("link", { name: "Member sign-in" });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    expect(new URL(href).pathname).toBe(`/o/${world.slug}/calendar`);
    expect(new URL(href).search).toBe("");
    expect(href).not.toMatch(/callback/i);
  });

  test("unmarking an event and reloading removes it, and the page is never cached", async ({ page }) => {
    const first = await page.goto(url());
    expect(first?.headers()["cache-control"] ?? "").toMatch(/no-store|no-cache/);
    expect(first?.headers()["cache-control"] ?? "").not.toMatch(/public|s-maxage|max-age=[1-9]/);
    await expect(page.getByText(PUBCAL_TITLES.today)).toBeVisible();

    await setListed(sql, world.orgId, PUBCAL_TITLES.today, false);
    const second = await page.reload();
    expect(second?.headers()["cache-control"] ?? "").toMatch(/no-store|no-cache/);
    expect(await page.content()).not.toContain(PUBCAL_TITLES.today);
  });

  test("the /events page carries the same calendar", async ({ page }) => {
    await page.goto(`${url()}/events`);
    await expect(page.getByTestId("public-calendar")).toBeVisible();
    await expect(page.getByText(PUBCAL_TITLES.today)).toBeVisible();
  });

  test.describe("at 360px (a phone)", () => {
    test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

    test("is a list, never a grid, with no horizontal scroll even for a 200-character unbroken title", async ({ page }) => {
      await page.goto(url());
      await expect(page.getByTestId("public-calendar")).toBeVisible();
      // The grid's weekday header row is not on screen on a phone.
      await expect(page.locator("[data-month]:not([hidden])").getByText("Sun", { exact: true })).toBeHidden();
      await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/\w+, \w+ \d+/);

      await openMonth(page, months.nextLabel);
      await expect(page.locator("[data-month]:not([hidden])").getByText(PUBCAL_TITLES.long)).toBeVisible();
      await noHorizontalScroll(page, 360);
      // Only days that have events are listed.
      const days = await page.locator("[data-month]:not([hidden]) [data-testid=public-calendar-day]:visible").count();
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThan(10);
    });

    test("every control is at least 44px, and tapping an event opens its details in place", async ({ page }) => {
      await page.goto(url());
      await hydrated(page);
      for (const name of [/^Previous month/, "Today", /^Next month/]) {
        const box = (await page.getByRole("button", { name }).boundingBox())!;
        expect(box.height, String(name)).toBeGreaterThanOrEqual(44);
        expect(box.width, String(name)).toBeGreaterThanOrEqual(44);
      }
      // The layout choice is for wider screens only.
      await expect(page.getByRole("button", { name: "Month", exact: true })).toBeHidden();

      await openMonth(page, months.nextLabel);
      const summary = page.locator("[data-month]:not([hidden]) summary", { hasText: PUBCAL_TITLES.listed });
      const sbox = (await summary.boundingBox())!;
      expect(sbox.height).toBeGreaterThanOrEqual(44);
      await summary.tap();
      const details = page.locator("[data-month]:not([hidden]) details[open]", { hasText: PUBCAL_TITLES.listed });
      await expect(details.getByText(`Where: ${PUBCAL_TEXT.location}`)).toBeVisible();
      await expect(details.getByText(`Event type: ${PUBCAL_TEXT.typeWorship}`)).toBeVisible();
      await expect(details.getByText(PUBCAL_TEXT.description)).toBeVisible();
      await noHorizontalScroll(page, 360);
    });

    test("the unavailable and empty notices fit too", async ({ page }) => {
      await setPublicCalendarToggle(sql, world.orgId, null);
      await page.goto(url());
      await expect(page.getByTestId("public-calendar-unavailable")).toBeVisible();
      await noHorizontalScroll(page, 360);
    });
  });

  test.describe("at 1280px (a computer)", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("is a seven-column month grid; an event's card opens over it, and the List button switches layouts", async ({ page }) => {
      await page.goto(url());
      await hydrated(page);
      await expect(page.locator("[data-month]:not([hidden])").getByText("Sun", { exact: true })).toBeVisible();
      await expect(page.locator("[data-month]:not([hidden])").getByText("Sat", { exact: true })).toBeVisible();

      await openMonth(page, months.nextLabel);
      const panel = page.locator("[data-month]:not([hidden])");
      // Every day of the month is a cell, empty ones included.
      expect(await panel.locator("[data-testid=public-calendar-day]:visible").count()).toBeGreaterThanOrEqual(28);

      const summary = panel.locator("summary", { hasText: PUBCAL_TITLES.listed });
      await summary.click();
      await expect(panel.getByText(`Where: ${PUBCAL_TEXT.location}`)).toBeVisible();
      await noHorizontalScroll(page, 1280);

      await page.getByRole("button", { name: "List", exact: true }).click();
      await expect(page.getByTestId("public-calendar")).toHaveAttribute("data-view", "list");
      await expect(page.locator("[data-month]:not([hidden])").getByText("Sun", { exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    });
  });
});

test.describe("Public events calendar - the editor flow (e2e-alpha)", () => {
  test.setTimeout(180_000);
  test.use({ storageState: storageStatePath("congregation-clerk") });

  const SLUG = E2E_ORGS.alpha.slug;
  let sql: Sql;
  let flags: FlagCapture;
  let calState: CalendarFixtureState;
  let alpha: AlphaSiteState | null = null;
  let months: OrgMonths;

  test.beforeAll(async () => {
    sql = platformSql("public-calendar.spec (editor)");
    flags = await captureFlags(sql, ["sites.public_render", "org_portal.events"]);
    await setFlag(sql, "sites.public_render", true);
    await setFlag(sql, "org_portal.events", true);
    // A crashed prior run may have left things behind.
    await removeAlphaSite(sql, null);
    calState = await setupCalendarFixture(sql);
    await revokeCalendarRole(sql, "manager", CAL_PEOPLE.congregationClerk);
    await grantCalendarRole(sql, "manager", CAL_PEOPLE.congregationClerk);
    alpha = await setupAlphaSite(sql);
    months = await orgMonths(sql);
  });

  test.afterAll(async () => {
    await removeAlphaSite(sql, alpha);
    await revokeCalendarRole(sql, "manager", CAL_PEOPLE.congregationClerk);
    await removeCalendarFixture(sql, calState);
    await flags.restore();
  });

  async function publicHas(page: Page, title: string, label: string): Promise<boolean> {
    await page.goto(`/site/${SLUG}`);
    // With nothing marked at all the page shows the "no events posted" sentence and no calendar.
    if ((await page.getByTestId("public-calendar").count()) === 0) return false;
    await hydrated(page);
    await openMonth(page, label);
    return (await page.locator("[data-month]:not([hidden])").getByText(title, { exact: true }).count()) > 0;
  }

  async function fillAndCreate(page: Page, title: string, extra: () => Promise<void> = async () => {}) {
    await page.goto(`/o/${SLUG}/admin/events/new`);
    await expect(page.getByRole("button", { name: "Create event" })).toBeEnabled();
    await page.getByLabel(/^Title/).fill(title);
    await page.getByLabel(/^Starts/).fill(`${months.nextKey}-04T10:00`);
    await extra();
    await page.getByRole("button", { name: "Create event" }).click();
    await page.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/);
  }

  test("an editor ticks the website box, saves, and the event appears; unticking removes it; the audit rows say who and what", async ({ page }) => {
    const title = `${ALPHA_EVENT_PREFIX} single`;

    // The new form: unticked by default, with the exposure stated at the box.
    await page.goto(`/o/${SLUG}/admin/events/new`);
    await expect(page.getByRole("button", { name: "Create event" })).toBeEnabled();
    const box = page.getByLabel("Show on our website's public calendar");
    await expect(box).not.toBeChecked();
    await expect(page.getByText(/Anyone on the internet can read this event's title/)).toBeVisible();
    // Unticking "Open to everyone" disables the website box.
    await page.getByLabel("Open to everyone, not only members").uncheck();
    await expect(box).toBeDisabled();
    await expect(page.getByText("Only events open to everyone can be shown on the website.")).toBeVisible();
    await page.getByLabel("Open to everyone, not only members").check();
    await expect(box).toBeEnabled();

    await fillAndCreate(page, title, async () => {
      await page.getByLabel("Show on our website's public calendar").check();
    });
    await expect(page.getByText(/Marked for the website/)).toBeVisible();
    expect(await publicHas(page, title, months.nextLabel)).toBe(true);

    // Edit: untick and save; the public page loses it on the next load.
    await page.goto(`/o/${SLUG}/admin/events`);
    await page.getByRole("link", { name: title }).click();
    await page.getByRole("link", { name: "Edit event" }).click();
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
    const editBox = page.getByLabel("Show on our website's public calendar");
    await expect(editBox).toBeChecked();
    await editBox.uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/Marked for the website/)).toHaveCount(0);
    expect(await publicHas(page, title, months.nextLabel)).toBe(false);

    const audits = (await sql`
      select action, actor_email from audit_events
       where metadata->>'organizationId' = ${E2E_ORGS.alpha.id}
         and action in ('event.listed_on_website', 'event.unlisted_from_website')
         and resource_id in (select id::text from events where organization_id = ${E2E_ORGS.alpha.id}::uuid and title = ${title})
       order by created_at`) as { action: string; actor_email: string }[];
    expect(audits.map((a) => a.action)).toEqual(["event.listed_on_website", "event.unlisted_from_website"]);
    expect(audits.every((a) => (a.actor_email ?? "").includes("@"))).toBe(true);
  });

  test("the series panel: the dialog's count equals the rows changed, and earlier occurrences stay", async ({ page }) => {
    const title = `${ALPHA_EVENT_PREFIX} series`;
    await fillAndCreate(page, title, async () => {
      await page.getByLabel("Show on our website's public calendar").check();
      await page.getByLabel("This event repeats").check();
      // The default pattern is weekly.
      await page.getByLabel(/^Number of occurrences/).fill("4");
    });
    const listedCount = async () =>
      Number(
        ((await sql`
          select count(*)::int as n from events
           where organization_id = ${E2E_ORGS.alpha.id}::uuid and title = ${title} and website_listed`) as { n: number }[])[0]!.n,
      );
    expect(await listedCount()).toBe(4);

    // Open the SECOND occurrence (the parent page links its children).
    const children = page.locator("table a");
    await expect(children.first()).toBeVisible();
    await children.first().click();
    await page.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Website listing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Put this and later events on the website" })).toHaveCount(0); // nothing to put
    // The trigger is disabled until the page hydrates (Phase 5 N3). The retry stays for a different
    // reason, found when the gate was added: a click in the instant after the client-side navigation
    // to this page can still be lost (the page re-renders once more under it), gate or no gate.
    const takeButton = page.getByRole("button", { name: "Take this and later events off the website" });
    await expect(takeButton).toBeEnabled();
    await expect(async () => {
      await takeButton.click();
      await expect(page.getByText("Take 3 events off the website?")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Yes, take 3 off the website" }).click();
    await expect(page.getByText("3 events no longer marked for the website.")).toBeVisible();

    expect(await listedCount()).toBe(1); // the parent, an earlier occurrence, stays
    const rows = (await sql`
      select action, metadata->>'changed' as changed, metadata->>'via' as via from audit_events
       where metadata->>'organizationId' = ${E2E_ORGS.alpha.id}
         and action = 'event.unlisted_from_website'
         and resource_id in (select id::text from events where organization_id = ${E2E_ORGS.alpha.id}::uuid and title = ${title})`) as {
      changed: string;
      via: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ changed: "3", via: "series" });
  });

  test("the event detail page does not scroll sideways at 360px with the Website listing section showing - regression for Phase 5 FAIL-1", async ({ page }) => {
    const title = `${ALPHA_EVENT_PREFIX} narrow`;
    await fillAndCreate(page, title, async () => {
      await page.getByLabel("Show on our website's public calendar").check();
      await page.getByLabel("This event repeats").check();
      await page.getByLabel(/^Number of occurrences/).fill("4");
    });
    // Leave the third occurrence unmarked so that, from the second, BOTH buttons show.
    await sql`
      update events set website_listed = false
       where id = (select id from events where organization_id = ${E2E_ORGS.alpha.id}::uuid and title = ${title}
                    order by starts_at offset 2 limit 1)`;
    await page.setViewportSize({ width: 360, height: 800 });
    const children = page.locator("table a");
    await expect(children.first()).toBeVisible();
    await children.first().click();
    await page.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Website listing" })).toBeVisible();
    const put = page.getByRole("button", { name: "Put this and later events on the website" });
    const take = page.getByRole("button", { name: "Take this and later events off the website" });
    await expect(put).toBeVisible();
    await expect(take).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const button of [put, take]) {
      const box = await button.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("a members-only event cannot be put on the website from the form", async ({ page }) => {
    const title = `${ALPHA_EVENT_PREFIX} members`;
    await fillAndCreate(page, title, async () => {
      await page.getByLabel("Show on our website's public calendar").check();
      await page.getByLabel("Open to everyone, not only members").uncheck();
    });
    const [row] = (await sql`
      select is_public, website_listed from events where organization_id = ${E2E_ORGS.alpha.id}::uuid and title = ${title}`) as {
      is_public: boolean;
      website_listed: boolean;
    }[];
    expect(row).toEqual({ is_public: false, website_listed: false });
    expect(await publicHas(page, title, months.nextLabel)).toBe(false);
  });
});
