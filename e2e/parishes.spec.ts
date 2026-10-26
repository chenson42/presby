/**
 * parishes.spec.ts - parish (deacon-district) management against a running
 * server (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Edge Cases &
 * Risks": tag E2E; it also satisfies the TODO line asking for an e2e spec before
 * `org_portal.directory_v2` is turned on in a real environment).
 *
 * The acting person is the MFA-ENROLLED fixture user (the Phase 1 G15 ask): a real
 * TOTP challenge is completed first, then a verified session is used throughout.
 * That user also carries the platform `admin` role, which is the point of the
 * first test: the platform role confers nothing. Authority is read live per
 * request, so the spec swaps the user between "none", "seat" (a real
 * `deacons_moderator` officer term, no admin keys) and "admin" without logging in
 * again (e2e/support/parish-fixture.ts).
 *
 * The congregation is throwaway (`e2e-parish-<stamp>`) and every flag touched
 * (`org_portal.directory`, `org_portal.directory_v2`, `org_portal.officers`) is
 * captured and restored by SELECT-verified writes. `org_portal.parishes` is a
 * per-org toggle row of the fixture congregation, never a platform flag.
 *
 * The 360px block opens the district list, a district page, the Unassigned page
 * and the bulk-move dialog at a phone width, asserts no horizontal overflow and
 * 44px targets, and saves screenshots under test-results/ for a human look.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  ACTION_MS,
  districtAudit,
  districtOf,
  removeParishFixture,
  setActorRole,
  setToggle,
  setupParishFixture,
  verifiedContext,
  type ParishFixture,
} from "./support/parish-fixture";

const FLAGS = ["org_portal.directory", "org_portal.directory_v2", "org_portal.officers"];

test.describe.configure({ mode: "serial" });

test.describe("Parish management", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let flags: FlagCapture;
  let fx: ParishFixture;
  let context: BrowserContext;

  const base = () => `/o/${fx.slug}/directory/parishes`;
  const unassigned = () => `${base()}/unassigned`;
  const rowOf = (page: Page, householdId: string) => page.locator(`[data-household-id="${householdId}"]`);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("parishes.spec");
    flags = await captureFlags(sql, FLAGS);
    for (const key of FLAGS) await setFlag(sql, key, true);
    fx = await setupParishFixture(sql);
    context = await verifiedContext(browser, `/o/${fx.slug}/directory`);
  });

  test.afterAll(async () => {
    await context?.close();
    await removeParishFixture(sql, fx);
    await flags?.restore();
  });

  test("the platform admin role confers nothing: with no seat and no tenant key the user is refused; recording the seat allows the very next request", async () => {
    await setActorRole(sql, fx, "none");
    const page = await context.newPage();
    try {
      await page.goto(`/o/${fx.slug}/directory`);
      await expect(page.getByRole("heading", { level: 1, name: "Directory" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Parishes" })).toHaveCount(0);

      await page.goto(base());
      await expect(page.getByText(/You don.t have permission to view/)).toBeVisible();
      await page.goto(unassigned());
      await expect(page.getByText(/You don.t have permission to view households by district/)).toBeVisible();
      await page.goto(`${base()}/${fx.districts.north}`);
      await expect(page.getByText(/You don.t have permission to view households by district/)).toBeVisible();

      // Record the seat: the next request is allowed, no re-login.
      await setActorRole(sql, fx, "seat");
      await page.goto(`/o/${fx.slug}/directory`);
      await expect(page.getByRole("link", { name: "Parishes" })).toBeVisible();
      await page.goto(base());
      await expect(page.getByRole("heading", { name: "Districts", exact: true })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("the Moderator (seat holder, no admin keys) sees the districts and the unassigned card but cannot define; households link through", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    try {
      await page.goto(base());
      await expect(page.getByRole("heading", { name: "Districts", exact: true })).toBeVisible();
      await expect(page.getByTestId("district-card")).toHaveCount(3); // North, South and the archived East
      await expect(page.getByRole("heading", { level: 3, name: "North District" })).toBeVisible();
      // Counts every household, including the one whose only member is directory-hidden (the single count).
      await expect(page.getByTestId("district-card").filter({ hasText: "North District" })).toContainText("2 households");
      await expect(page.getByRole("heading", { name: "Archived districts" })).toBeVisible();
      await expect(page.getByTestId("no-district-card")).toContainText("5 households aren't in a district.");
      await expect(page.getByLabel("District name")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Add district|Rename|Archive|Restore/ })).toHaveCount(0);
      await expect(page.getByTestId("seat-callout")).toHaveCount(0);

      await page.getByRole("link", { name: "View households in North District" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "North District" })).toBeVisible();
      await expect(page.getByTestId("household-row")).toHaveCount(2);
      // A directory-hidden member is "Private" to a seat holder; the real name never reaches the page.
      await expect(page.getByText("Private")).toBeVisible();
      await expect(page.getByText("Hollis")).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test("assigning a household from the Unassigned page: an explicit button, an Undo toast, and an audit row stamped viaSeat", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    try {
      await page.goto(unassigned());
      await expect(page.getByRole("heading", { level: 1, name: "Households with no district" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Hide Members (2)" })).toBeVisible();
      const row = rowOf(page, fx.households.unMember);
      await expect(row).toContainText(fx.names.unMember);
      await expect(rowOf(page, fx.households.unHidden)).toContainText("Private");
      await expect(page.locator("body")).not.toContainText(fx.names.unHiddenFirst);

      const select = row.getByLabel(/^Assign to/);
      await expect(select).toBeEnabled({ timeout: ACTION_MS });
      await select.selectOption({ label: "South District" });
      // Selecting alone commits nothing.
      expect(await districtOf(sql, fx.households.unMember)).toBeNull();
      await row.getByRole("button", { name: /^Assign/ }).click();
      await expect(page.getByText("Assigned to South District.")).toBeVisible({ timeout: ACTION_MS });
      expect(await districtOf(sql, fx.households.unMember)).toBe("South District");

      const audit = await districtAudit(sql, fx.households.unMember);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({
        organizationId: fx.orgId,
        fromOrgUnitId: null,
        toOrgUnitId: fx.districts.south,
        viaSeat: true,
      });
      expect(audit[0]!.actor_user_id).toBe(fx.actorUserId);
      expect(JSON.stringify(audit[0]!.metadata)).not.toContain("Ashgrove");

      // Undo restores it (a clear is a write, never a delete).
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText("Undone.")).toBeVisible({ timeout: ACTION_MS });
      expect(await districtOf(sql, fx.households.unMember)).toBeNull();
      expect(await districtAudit(sql, fx.households.unMember)).toHaveLength(2);
    } finally {
      await page.close();
    }
  });

  test("a keyboard user arrowing through the picker commits nothing (F261): no write, no audit row, no toast", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    try {
      await page.goto(unassigned());
      const row = rowOf(page, fx.households.unListed);
      const select = row.getByLabel(/^Assign to/);
      await expect(select).toBeEnabled({ timeout: ACTION_MS });
      await select.focus();
      for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      // A negative assertion has to wait out the server round trip a wrongly-committing handler would make.
      await page.waitForTimeout(3_000);
      await expect(page.getByText(/Assigned to|Moved to|Removed from/)).toHaveCount(0);
      expect(await districtOf(sql, fx.households.unListed)).toBeNull();
      expect(await districtAudit(sql, fx.households.unListed)).toHaveLength(0);
      // Choosing a district and pressing the button is the one thing that writes.
      await select.selectOption({ label: "North District" });
      await row.getByRole("button", { name: /^Assign/ }).click();
      await expect
        .poll(async () => districtOf(sql, fx.households.unListed), { timeout: ACTION_MS })
        .not.toBeNull();
      expect(await districtAudit(sql, fx.households.unListed)).toHaveLength(1);
    } finally {
      await page.close();
    }
  });

  test("the population toggles are links that keep their state in the URL and keep their counts", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    try {
      await page.goto(unassigned());
      await page.getByRole("link", { name: "Hide Members (2)" }).click();
      await expect(page).toHaveURL(/\?hide=members$/);
      await expect(page.getByRole("link", { name: "Show Members (2)" })).toBeVisible();
      await expect(rowOf(page, fx.households.unMember)).toHaveCount(0);
      await expect(rowOf(page, fx.households.unVisitor)).toBeVisible();
      // An unknown token in the URL is ignored, never an error.
      await page.goto(`${unassigned()}?hide=members,bogus`);
      await expect(page.getByRole("link", { name: "Show Members (2)" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Hide Visitors (1)" })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("an ARCHIVED district is emptied in one confirmed move: counts only, an audit row per household and one batch row", async () => {
    await setActorRole(sql, fx, "seat");
    const page = await context.newPage();
    try {
      await page.goto(`${base()}/${fx.districts.east}`);
      await expect(page.getByTestId("archived-notice")).toContainText("This district is archived. No households can be moved into it.");
      const trigger = page.getByRole("button", { name: "Move all 2 households to…" });
      await expect(trigger).toBeEnabled({ timeout: ACTION_MS });
      await trigger.click();
      const picker = page.getByRole("dialog");
      await picker.getByLabel("Move to").selectOption({ label: "South District" });
      await picker.getByRole("button", { name: "Continue" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Move 2 households to South District?");
      await expect(confirm).toContainText("No deacon is recorded for South District yet.");
      await expect(confirm).toContainText("households can't be moved back into it");
      await confirm.getByRole("button", { name: "Move 2 households" }).click();
      await expect(page.getByText("Moved 2 households to South District.")).toBeVisible({ timeout: ACTION_MS });

      expect(await districtOf(sql, fx.households.eastOne)).toBe("South District");
      expect(await districtOf(sql, fx.households.eastTwo)).toBe("South District");
      const per = await districtAudit(sql, fx.households.eastOne);
      expect(per).toHaveLength(1);
      const batchId = per[0]!.metadata.batchId as string;
      expect(typeof batchId).toBe("string");
      const batch = (await sql`
        select metadata from audit_events
         where action = 'tenant.household.district_bulk_moved' and resource_id = ${fx.districts.east}`) as Array<{ metadata: Record<string, unknown> }>;
      expect(batch).toHaveLength(1);
      expect(batch[0]!.metadata).toMatchObject({ batchId, movedCount: 2, skippedCount: 0, toOrgUnitId: fx.districts.south });
      // The empty archived district now says so.
      await page.reload();
      await expect(page.getByTestId("archived-notice")).toContainText("It has no households.");
    } finally {
      await page.close();
    }
  });

  test("the administrator defines, renames, archives and restores a district; the seat callout points at Officers while the seat is empty", async () => {
    await setActorRole(sql, fx, "admin");
    const page = await context.newPage();
    try {
      await page.goto(base());
      await expect(page.getByTestId("seat-callout")).toContainText("No one is recorded in the Moderator seat for the Board of Deacons.");
      await expect(page.getByRole("link", { name: "Record it in Officers" })).toHaveAttribute("href", `/o/${fx.slug}/admin/officers`);

      const name = page.getByLabel("District name");
      await expect(name).toBeEnabled({ timeout: ACTION_MS });
      await name.fill("West District");
      await page.getByRole("button", { name: "Add district" }).click();
      await expect(page.getByRole("heading", { level: 3, name: "West District" })).toBeVisible({ timeout: ACTION_MS });

      // A duplicate (case-insensitive) is refused inline.
      await page.getByLabel("District name").fill("west district");
      await page.getByRole("button", { name: "Add district" }).click();
      await expect(page.getByText("A district with that name already exists.")).toBeVisible({ timeout: ACTION_MS });

      await page.getByRole("button", { name: "Rename West District" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("District name").fill("Westside District");
      await dialog.getByRole("button", { name: "Save name" }).click();
      await expect(page.getByRole("heading", { level: 3, name: "Westside District" })).toBeVisible({ timeout: ACTION_MS });

      await page.getByRole("button", { name: "Archive Westside District" }).click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toContainText("No households are in it. You can restore it later.");
      await alert.getByRole("button", { name: "Archive district" }).click();
      await expect(page.getByText("Westside District archived.")).toBeVisible({ timeout: ACTION_MS });
      await expect(
        page.locator('section[aria-labelledby="archived-heading"]').getByRole("heading", { level: 3, name: "Westside District" }),
      ).toBeVisible({ timeout: ACTION_MS });

      await page.getByRole("button", { name: "Restore Westside District" }).click();
      await expect(page.getByText("Westside District restored.")).toBeVisible({ timeout: ACTION_MS });
      await expect(
        page.locator('section[aria-labelledby="districts-heading"]').getByRole("heading", { level: 3, name: "Westside District" }),
      ).toBeVisible({ timeout: ACTION_MS });

      const audits = (await sql`
        select action from audit_events
         where action like 'tenant.district.%' and metadata->>'organizationId' = ${fx.orgId}
         order by created_at`) as Array<{ action: string }>;
      expect(audits.map((a) => a.action)).toEqual([
        "tenant.district.created",
        "tenant.district.renamed",
        "tenant.district.archived",
        "tenant.district.restored",
      ]);
    } finally {
      await page.close();
    }
  });

  test("an administrator records the Moderator seat from Officers (self-recorded, stated as such); the seat then works without any admin key", async () => {
    await setActorRole(sql, fx, "admin");
    const page = await context.newPage();
    try {
      await page.goto(`/o/${fx.slug}/admin/officers`);
      const person = page.getByLabel(/^Person/);
      await expect(person).toBeEnabled({ timeout: ACTION_MS });
      await person.selectOption({ label: "Marguerite Oakhollow" });
      await page.getByLabel(/^Office/).selectOption({ label: "Moderator of the Board of Deacons" });
      await expect(page.getByTestId("seat-helper")).toContainText(
        "In a congregation, the Moderator of the Board of Deacons can assign households to districts once Parish management is turned on and they have a PresbyPortal account. Administrators can assign households too. Record this only for the person the Board has chosen.",
      );
      await expect(page.getByTestId("self-note")).toContainText(
        "You're recording yourself as Moderator of the Board of Deacons. That's allowed, and the record will show it as self-recorded.",
      );
      await page.getByLabel(/start date/i).fill("2025-01-01");
      await page.getByRole("button", { name: /add officer term/i }).click();
      await expect(page.getByText("Officer term recorded.")).toBeVisible({ timeout: ACTION_MS });
      await expect(page.getByRole("row", { name: /Moderator of the Board of Deacons/ })).toContainText("Self-recorded");

      const audits = (await sql`
        select metadata from audit_events
         where action = 'tenant.officer_term.started' and metadata->>'organizationId' = ${fx.orgId}
           and metadata->>'office' = 'deacons_moderator'`) as Array<{ metadata: Record<string, unknown> }>;
      expect(audits.some((a) => a.metadata.selfRecorded === true)).toBe(true);

      // Drop every admin key and the old fixture seat: only the term just recorded remains.
      await setActorRole(sql, fx, "none");
      await page.goto(base());
      await expect(page.getByRole("heading", { name: "Districts", exact: true })).toBeVisible();
      await expect(page.getByLabel("District name")).toHaveCount(0);
      await page.goto(unassigned());
      await expect(page.getByRole("heading", { level: 1, name: "Households with no district" })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("with the org toggle OFF every new surface says so and the legacy page is unchanged", async () => {
    await setToggle(sql, fx.orgId, false);
    await setActorRole(sql, fx, "admin");
    const page = await context.newPage();
    try {
      await page.goto(unassigned());
      await expect(page.getByText(`Parish management isn't turned on for ${fx.name} yet.`)).toBeVisible();
      await page.goto(`${base()}/${fx.districts.north}`);
      await expect(page.getByText(`Parish management isn't turned on for ${fx.name} yet.`)).toBeVisible();
      // The legacy roster needs directory.view_hidden; the administrator has none, so it refuses as before.
      await page.goto(base());
      await expect(page.getByText(/You don.t have permission to view/)).toBeVisible();
    } finally {
      await page.close();
      await setToggle(sql, fx.orgId, true);
    }
  });
});

test.describe("Parish management at 360px", () => {
  test.setTimeout(120_000);
  test.describe.configure({ mode: "serial" });

  let sql: Sql;
  let flags: FlagCapture;
  let fx: ParishFixture;
  let context: BrowserContext;

  async function shot(page: Page, name: string) {
    await page.screenshot({ path: `test-results/parish-360-${name}.png`, fullPage: true });
  }

  async function noHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
  }

  async function targetsAre44(page: Page, locator: ReturnType<Page["locator"]>) {
    // Polled: a dialog opens with a zoom-in-95 animation, so its buttons measure 95% of their size until it settles.
    await expect
      .poll(async () => {
        const heights = await locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        return heights.length > 0 && heights.every((h) => h >= 43.5);
      })
      .toBe(true);
  }

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("parishes.spec 360");
    flags = await captureFlags(sql, FLAGS);
    for (const key of FLAGS) await setFlag(sql, key, true);
    fx = await setupParishFixture(sql);
    // An 80-character district name proves long names wrap rather than overflow.
    await sql`update org_units set name = ${"W".repeat(40) + " " + "w".repeat(39)} where id = ${fx.districts.south}::uuid`;
    await setActorRole(sql, fx, "admin");
    context = await verifiedContext(browser, `/o/${fx.slug}/directory`);
    // Wider context options cannot be set after creation: use a fresh phone-sized page below.
  });

  test.afterAll(async () => {
    await context?.close();
    await removeParishFixture(sql, fx);
    await flags?.restore();
  });

  test("district list, district page, Unassigned page and the bulk-move dialog fit a phone with 44px targets", async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 780 });
    try {
      const base = `/o/${fx.slug}/directory/parishes`;

      await page.goto(base);
      await expect(page.getByRole("heading", { name: "Districts", exact: true })).toBeVisible();
      await expect(page.getByLabel("District name")).toBeEnabled({ timeout: ACTION_MS });
      await noHorizontalOverflow(page);
      await targetsAre44(page, page.getByTestId("district-card").getByRole("button"));
      await targetsAre44(page, page.getByRole("link", { name: /^View households/ }));
      await shot(page, "1-district-list");

      await page.goto(`${base}/${fx.districts.north}`);
      await expect(page.getByRole("heading", { level: 1, name: "North District" })).toBeVisible();
      const moveButtons = page.getByRole("button", { name: /^Move / });
      await expect(moveButtons.first()).toBeEnabled({ timeout: ACTION_MS });
      await noHorizontalOverflow(page);
      await targetsAre44(page, moveButtons);
      const selectBox = await page.getByLabel(/^Move to/).first().boundingBox();
      expect(selectBox!.height).toBeGreaterThanOrEqual(44);
      await targetsAre44(page, page.getByRole("link", { name: "Back to Parishes" }));
      expect(selectBox!.width).toBeGreaterThan(250); // full width of a 360px card, not a squeezed inline control
      await shot(page, "2-district-page");

      await page.goto(`${base}/unassigned`);
      await expect(page.getByRole("heading", { level: 1, name: "Households with no district" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Assign / }).first()).toBeEnabled({ timeout: ACTION_MS });
      await noHorizontalOverflow(page);
      await targetsAre44(page, page.getByTestId("group-toggles").getByRole("link"));
      await targetsAre44(page, page.getByRole("button", { name: /^Assign / }));
      // The four toggle pills wrap onto more than one line rather than scrolling sideways.
      const toggleBoxes = await page.getByTestId("group-toggles").getByRole("link").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
      expect(new Set(toggleBoxes.map((t) => Math.round(t))).size).toBeGreaterThan(1);
      await targetsAre44(page, page.getByRole("link", { name: "Back to Parishes" }));
      await shot(page, "3-unassigned");

      // The groups-shown-are-empty state: leave only the member household unassigned, hide that group,
      // and "Show all groups" must be a 44px target. Restored whatever happens.
      const movedAway = (await sql`
        select id from households
        where organization_id = ${fx.orgId}::uuid and org_unit_id is null and id <> ${fx.households.unMember}::uuid`) as { id: string }[];
      try {
        for (const row of movedAway) await sql`update households set org_unit_id = ${fx.districts.north}::uuid where id = ${row.id}::uuid`;
        await page.goto(`${base}/unassigned?hide=members`);
        await expect(page.getByTestId("none-in-groups-shown")).toBeVisible();
        await noHorizontalOverflow(page);
        await targetsAre44(page, page.getByRole("link", { name: "Show all groups" }));
        await shot(page, "3b-unassigned-none-shown");
      } finally {
        for (const row of movedAway) await sql`update households set org_unit_id = null where id = ${row.id}::uuid`;
      }

      await page.goto(`${base}/${fx.districts.east}`);
      await expect(page.getByRole("button", { name: "Move all 2 households to…" })).toBeEnabled({ timeout: ACTION_MS });
      await noHorizontalOverflow(page);
      await targetsAre44(page, page.getByRole("link", { name: "Back to Parishes" }));
      await targetsAre44(page, page.getByRole("button", { name: "Move all 2 households to…" }));
      await page.getByRole("button", { name: "Move all 2 households to…" }).click();
      const picker = page.getByRole("dialog");
      await targetsAre44(page, picker.getByLabel("Move to"));
      await picker.getByLabel("Move to").selectOption({ index: 1 });
      await noHorizontalOverflow(page);
      await shot(page, "4-bulk-pick");
      await picker.getByRole("button", { name: "Continue" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      await noHorizontalOverflow(page);
      // The dialog buttons stack (full width, one under the other) on a phone.
      const buttonBoxes = await confirm.getByRole("button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
      expect(buttonBoxes).toHaveLength(2);
      expect(Math.abs(buttonBoxes[0]!.left - buttonBoxes[1]!.left)).toBeLessThan(2);
      await targetsAre44(page, confirm.getByRole("button"));
      await shot(page, "5-bulk-confirm");
    } finally {
      await page.close();
    }
  });
});
