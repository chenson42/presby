/**
 * member-calendar.spec.ts - the member calendar, its detail page and the
 * event-types manager, against a running server (2026-10-14-member-calendar).
 *
 * Creates only its own rows at e2e-alpha (ids `e2ca...`, role keys
 * `e2e_calendar_*`, titles `E2E ...`) and removes them in afterAll on the
 * owner connection (DECISION-157). `org_portal.events` is captured and
 * restored with e2e/support/flags.ts.
 *
 * The grid and the list are BOTH in the DOM and CSS picks one (and the filter
 * row renders twice), so every selector below is scoped to the copy that is
 * visible at the viewport under test.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  CAL_IDS,
  CAL_PEOPLE,
  CAL_TITLES,
  grantCalendarRole,
  removeCalendarFixture,
  revokeCalendarRole,
  setCalendarToggle,
  setupCalendarFixture,
  type CalendarFixtureState,
} from "./support/calendar-fixture";

const EVENTS_FLAG = "org_portal.events";
const SLUG = E2E_ORGS.alpha.slug;
const CALENDAR = `/o/${SLUG}/calendar`;

test.describe("Member calendar", () => {
  test.setTimeout(90_000);

  let sql: Sql;
  let flags: FlagCapture;
  let state: CalendarFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("member-calendar.spec");
    flags = await captureFlags(sql, [EVENTS_FLAG]);
    await setFlag(sql, EVENTS_FLAG, true);
    state = await setupCalendarFixture(sql);
    // A crashed prior run may have left grants behind.
    await revokeCalendarRole(sql, "viewer", CAL_PEOPLE.orgSingle);
  });

  test.afterAll(async () => {
    await removeCalendarFixture(sql, state);
    await flags.restore();
  });

  async function worshipTypeId(): Promise<string> {
    return CAL_IDS.typeWorship;
  }

  test.describe("without a grant", () => {
    test.use({ storageState: storageStatePath("org-single") });

    // Every current record at alpha holds `events.view` through two baseline roles: `member` (also
    // `directory.view`, bound to Active Membership), created by main's 0082 baseline backfill, and
    // `calendar_viewer`, bound to All Current Records, created by 0066's backfill. "A member with no
    // events.view" therefore needs those two roles to lack it for this lane only; the spec-owned `viewer`
    // role is untouched, and both are restored in afterAll.
    let baselineEventsView: string[] = [];
    test.beforeAll(async () => {
      const roles = (await sql`
        select r.id from app_roles r
         where r.organization_id = ${E2E_ORGS.alpha.id}::uuid and r.key in ('member', 'calendar_viewer')
           and exists (select 1 from app_role_permissions p where p.role_id = r.id and p.permission_key = 'events.view')`) as { id: string }[];
      baselineEventsView = roles.map((r) => r.id);
      if (baselineEventsView.length > 0) {
        await sql`delete from app_role_permissions where role_id = any(${baselineEventsView}::uuid[]) and permission_key = 'events.view'`;
      }
    });
    test.afterAll(async () => {
      if (baselineEventsView.length > 0) {
        await sql`
          insert into app_role_permissions (role_id, permission_key)
          select unnest(${baselineEventsView}::uuid[]), 'events.view' on conflict do nothing`;
      }
    });

    test("a member with no events.view sees a plain explanation, not a 403 or a blank page", async ({ page }) => {
      const response = await page.goto(CALENDAR);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
      await expect(page.getByText(/isn't available to your account at Wrenfield Presbyterian Church yet/)).toBeVisible();
      await expect(page.getByTestId("calendar-grid")).toHaveCount(0);
    });
  });

  test.describe("as a member with events.view", () => {
    test.beforeAll(async () => {
      await grantCalendarRole(sql, "viewer", CAL_PEOPLE.orgSingle);
    });
    test.afterAll(async () => {
      await revokeCalendarRole(sql, "viewer", CAL_PEOPLE.orgSingle);
    });

    test.describe("at 1280px", () => {
      test.use({ storageState: storageStatePath("org-single"), viewport: { width: 1280, height: 900 } });

      test("shows the grid with seven column headers, today marked, typed entries, no cancelled event, and members-only events", async ({ page }) => {
        await page.goto(CALENDAR);
        const grid = page.getByTestId("calendar-grid");
        await expect(grid.getByRole("table")).toBeVisible();
        await expect(page.getByTestId("calendar-list")).toBeHidden();
        await expect(grid.getByRole("columnheader")).toHaveCount(7);
        await expect(grid.locator('time[aria-current="date"]')).toHaveCount(1);

        const worship = grid.getByRole("link", { name: new RegExp(CAL_TITLES.typed) });
        await expect(worship).toBeVisible();
        await expect(worship.locator("svg")).toHaveCount(1);
        await expect(worship).toContainText("10:30 AM");
        await expect(grid.getByRole("link", { name: new RegExp(CAL_TITLES.untyped) })).toBeVisible();
        await expect(grid.getByText(CAL_TITLES.membersOnly)).toBeVisible();
        await expect(grid.getByText(CAL_TITLES.cancelled)).toHaveCount(0);
      });

      test("the month/list switch is shown at md+ and ?view=list swaps the grid for the list", async ({ page }) => {
        await page.goto(CALENDAR);
        await expect(page.getByRole("group", { name: "Calendar view" })).toBeVisible();
        await page.goto(`${CALENDAR}?view=list`);
        await expect(page.getByTestId("calendar-list")).toBeVisible();
        await expect(page.getByTestId("calendar-grid")).toBeHidden();
      });

      test("prev and next keep the type filter and the view; Today drops the month", async ({ page }) => {
        const typeId = await worshipTypeId();
        await page.goto(`${CALENDAR}?types=${typeId}&view=list`);
        await page.getByRole("link", { name: /^Next month/ }).click();
        await expect(page).toHaveURL(new RegExp(`month=\\d{4}-\\d{2}&types=${typeId}&view=list`));
        await page.getByRole("link", { name: /^Previous month/ }).click();
        await page.getByRole("link", { name: /^Previous month/ }).click();
        await expect(page).toHaveURL(new RegExp(`types=${typeId}&view=list`));
        await page.getByRole("link", { name: "Today" }).click();
        await expect(page).toHaveURL(new RegExp(`${CALENDAR}\\?types=${typeId}&view=list$`));
      });

      test("the detail page shows the type, hides admin-only fields, and Back returns to the same month and filter", async ({ page }) => {
        const typeId = await worshipTypeId();
        await page.goto(`${CALENDAR}?month=${(await currentMonth(page))}&types=${typeId}`);
        const from = new URL(page.url()).pathname + new URL(page.url()).search;
        await page.getByTestId("calendar-grid").getByRole("link", { name: new RegExp(CAL_TITLES.typed) }).click();
        await expect(page).toHaveURL(new RegExp(`${CALENDAR}/${CAL_IDS.eventTyped}\\?from=`));
        await expect(page.getByRole("heading", { level: 1, name: CAL_TITLES.typed })).toBeVisible();
        await expect(page.getByText("E2E Worship", { exact: true })).toBeVisible();
        await expect(page.getByText("Sanctuary")).toBeVisible();
        const body = await page.locator("main").innerText();
        expect(body).not.toMatch(/members only|public|check-in/i);

        await page.getByRole("link", { name: "Back to calendar" }).click();
        await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(from);
      });

      test("a cancelled id, another congregation's id, a missing id and a non-UUID all return the same 404", async ({ page }) => {
        const bodies = new Set<string>();
        for (const id of [CAL_IDS.eventCancelled, CAL_IDS.otherOrgEvent, CAL_IDS.missingEvent, "not-a-uuid"]) {
          const response = await page.goto(`${CALENDAR}/${id}`);
          expect(response?.status(), id).toBe(404);
          bodies.add((await page.locator("main").innerText()).trim());
        }
        expect(bodies.size).toBe(1);
      });

      test("?from=/o/<slug> reads 'Back to home' and a hostile from= falls back to the calendar", async ({ page }) => {
        await page.goto(`${CALENDAR}/${CAL_IDS.eventTyped}?from=${encodeURIComponent(`/o/${SLUG}`)}`);
        await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", `/o/${SLUG}`);
        await page.goto(`${CALENDAR}/${CAL_IDS.eventTyped}?from=${encodeURIComponent("https://evil.example")}`);
        await expect(page.getByRole("link", { name: "Back to calendar" })).toHaveAttribute("href", CALENDAR);
      });

      test("an empty month says so and keeps the month navigation", async ({ page }) => {
        await page.goto(`${CALENDAR}?month=2000-01`);
        await expect(page.getByText("Nothing is scheduled for January 2000.")).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Month" })).toBeVisible();
        await page.goto(`${CALENDAR}?month=0000-01&types=not-a-uuid`);
        await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toBeVisible();
        await expect(page.getByTestId("calendar-grid")).toBeVisible();
      });
    });

    test.describe("at 360px", () => {
      test.use({ storageState: storageStatePath("org-single"), viewport: { width: 360, height: 780 } });

      test("shows the list only, no month/list switch, no horizontal overflow", async ({ page }) => {
        await page.goto(CALENDAR);
        await expect(page.getByTestId("calendar-list")).toBeVisible();
        await expect(page.getByTestId("calendar-grid")).toBeHidden();
        await expect(page.getByRole("group", { name: "Calendar view" })).toBeHidden();
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits).toBe(true);
        await expect(page.getByTestId("calendar-list").getByRole("link", { name: new RegExp(CAL_TITLES.typed) })).toBeVisible();
      });

      test("the filter disclosure opens on a tap of its summary, filtering survives a hard reload", async ({ page }) => {
        await page.goto(CALENDAR);
        const details = page.getByTestId("calendar-filters");
        const summary = details.locator("summary");
        await expect(summary).toContainText("Show filters");
        await expect(details.getByRole("link", { name: "E2E Worship" })).toBeHidden();

        await summary.click();
        await expect(details).toHaveJSProperty("open", true);
        await expect(details.getByRole("link", { name: "E2E Worship" })).toBeVisible();
        await summary.click();
        await expect(details).toHaveJSProperty("open", false);

        await summary.click();
        await details.getByRole("link", { name: "E2E Worship" }).click();
        await expect(page).toHaveURL(new RegExp(`types=${CAL_IDS.typeWorship}`));

        await page.reload();
        const after = page.getByTestId("calendar-filters").locator("summary");
        await expect(after).toContainText("Filters: 1 active");
        const list = page.getByTestId("calendar-list");
        await expect(list.getByRole("link", { name: new RegExp(CAL_TITLES.typed) })).toBeVisible();
        await expect(list.getByText(CAL_TITLES.untyped)).toHaveCount(0);
        await expect(list.getByText(CAL_TITLES.series)).toHaveCount(0);
      });
    });

    test.describe("Copy month", () => {
      test.use({ storageState: storageStatePath("org-single"), viewport: { width: 1280, height: 900 } });

      test("is enabled after hydration, copies the month without members-only titles, and says what was left out", async ({ page, context, browserName }) => {
        test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only");
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.goto(CALENDAR);
        const copy = page.getByTestId("copy-month");
        await expect(copy).toBeEnabled();
        await copy.click();
        await expect(page.getByText("Calendar copied (1 members-only event left out)")).toBeVisible();
        const text = await page.evaluate(() => navigator.clipboard.readText());
        expect(text).toMatch(/^[A-Z][a-z]+ \d{4}\n/);
        expect(text).toContain(CAL_TITLES.typed);
        expect(text).not.toContain(CAL_TITLES.membersOnly);
        expect(text).not.toContain(CAL_TITLES.cancelled);
      });
    });
  });

  test.describe("when the calendar is turned off", () => {
    test.use({ storageState: storageStatePath("org-single") });

    test.beforeAll(async () => {
      await grantCalendarRole(sql, "viewer", CAL_PEOPLE.orgSingle);
      await setCalendarToggle(sql, false);
    });
    test.afterAll(async () => {
      await setCalendarToggle(sql, true);
      await revokeCalendarRole(sql, "viewer", CAL_PEOPLE.orgSingle);
    });

    test("says it isn't turned on and the Calendar tile is gone from the home page", async ({ page }) => {
      await page.goto(CALENDAR);
      await expect(
        page.getByText("The calendar isn't turned on for Wrenfield Presbyterian Church yet."),
      ).toBeVisible();
      await page.goto(`/o/${SLUG}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Calendar\b/ })).toHaveCount(0);
    });
  });

  test.describe("as a manager (events.manage + event_types.manage)", () => {
    test.use({ storageState: storageStatePath("congregation-clerk"), viewport: { width: 1280, height: 900 } });

    test.beforeAll(async () => {
      await grantCalendarRole(sql, "manager", CAL_PEOPLE.congregationClerk);
    });
    test.afterAll(async () => {
      await revokeCalendarRole(sql, "manager", CAL_PEOPLE.congregationClerk);
    });

    test("Add an event and Manage events appear only while org_portal.events is on", async ({ page }) => {
      await page.goto(CALENDAR);
      await expect(page.getByRole("link", { name: "Add an event" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Manage events" })).toBeVisible();

      await setFlag(sql, EVENTS_FLAG, false);
      try {
        await page.goto(CALENDAR);
        await expect(page.getByTestId("calendar-grid")).toBeVisible();
        await expect(page.getByRole("link", { name: "Add an event" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Manage events" })).toHaveCount(0);
      } finally {
        await setFlag(sql, EVENTS_FLAG, true);
      }
    });

    test("the types page creates a type, refuses a duplicate with the exact message, and disables the default type's switch", async ({ page }) => {
      await page.goto(`/o/${SLUG}/admin/events/types`);
      await expect(page.getByRole("heading", { level: 1, name: "Event types" })).toBeVisible();

      const form = page.locator("form").last();
      await form.getByLabel(/^Name/).fill("E2E Choir");
      await form.getByLabel("Violet").check();
      await form.getByLabel("Music").check();
      await form.getByRole("button", { name: "Add event type" }).click();
      await expect(page.getByRole("heading", { level: 3, name: "E2E Choir" })).toBeVisible();

      await form.getByLabel(/^Name/).fill("e2e choir");
      await form.getByRole("button", { name: "Add event type" }).click();
      await expect(page.getByText("You already have an event type called 'e2e choir'.")).toBeVisible();

      const fallbackRow = page.getByRole("listitem").filter({ hasText: "Default" });
      await expect(fallbackRow.getByRole("switch")).toBeDisabled();
      await expect(fallbackRow.getByText("The default type can't be retired.")).toBeVisible();
    });

    test("the type picker is on the new-event and edit-event forms", async ({ page }) => {
      await page.goto(`/o/${SLUG}/admin/events/new`);
      const select = page.getByLabel("Event type (optional)");
      await expect(select).toBeVisible();
      await expect(select.locator("option").first()).toContainText("No type");
      await expect(select.locator("option", { hasText: "E2E Worship" })).toHaveCount(1);

      await page.goto(`/o/${SLUG}/admin/events/${CAL_IDS.eventTyped}/edit`);
      await expect(page.getByLabel("Event type (optional)")).toHaveValue(CAL_IDS.typeWorship);
    });
  });
});

/** The displayed month as `YYYY-MM`, read from the page's own month heading link. */
async function currentMonth(page: Page): Promise<string> {
  await page.goto(CALENDAR);
  const next = await page.getByRole("link", { name: /^Next month/ }).getAttribute("href");
  const m = /month=(\d{4})-(\d{2})/.exec(next ?? "");
  if (!m) throw new Error("no month in next link");
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}
