/**
 * careers.spec.ts - job openings on the PLATFORM host and in the staff admin
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T25; DECISION-264/265/266). The same pages on a
 * church's own domain are e2e/custom-domains/careers.spec.ts; the pre-hydration guard is
 * e2e/hydration/careers-posting-form.spec.ts.
 *
 * Creates only its own rows (a throwaway `e2e-careers-<stamp>` congregation, removed in afterAll by
 * deleting the organization and confirmed by SELECT; DECISION-157). Every global flag it moves is
 * captured and restored through e2e/support/flags.ts, and none is added to
 * scripts/ci/e2e-baseline-flags.sql.
 *
 * The signed-in actor is the `mfa-enrolled` fixture, who completes a REAL TOTP challenge once
 * (`verifiedContext`); the actor's careers role is swapped in the database between tests (permissions
 * are read live). Public pages are fetched anonymously.
 *
 * Postings that only exist to be READ are written through the owner connection by walking the legal
 * status edges; the ones the spec exists to test (create, publish, close, reopen, reorder, a stale
 * save) go through the real UI and are asserted against the PERSISTED row.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import { verifiedContext } from "./support/giving-fixture";
import {
  CAREERS_NAMES,
  addPosting,
  careersAuditRows,
  orgToday,
  postingBySlug,
  removeCareersFixture,
  setCareersRole,
  setCareersToggle,
  setClosingDate,
  setPeopleCategory,
  setSiteBundle,
  setSiteStatus,
  setupCareersFixture,
  type CareersFixture,
} from "./support/careers-fixture";

const FLAGS = ["sites.public_render", "org_portal.home_v2", "org_portal.feature_categories", "org_portal.features"];

const P1 = "Our job openings aren't available right now. Please check back soon.";
const P2 = "We don't have any open positions right now. Please check back soon.";
const P6 = "This position is no longer accepting applications.";
const S8_STALE =
  "This opening was changed by someone else after you opened it, so your changes were not saved. Reload the page to see what changed.";

const T = {
  created: "E2E Created In The Editor",
  hostile: "E2E Hostile Description",
  ordA: "E2E Order Alpha",
  ordB: "E2E Order Beta",
  today: "E2E Closes Today",
  yesterday: "E2E Closed Yesterday",
  long: `E2E${"W".repeat(147)}`, // 150 characters, the title limit (the design said 200; the database and form stop at 150)
  hidden: "E2E Hidden While Off",
  stale: "E2E Stale Target",
  chrome: "E2E Chrome Check",
} as const;

let sql: Sql;
let flags: FlagCapture;
let fx: CareersFixture;
let ctx: BrowserContext;

const pub = (path: string) => `/site/${fx.slug}${path}`;
const staff = (path = "") => `/o/${fx.slug}/admin/careers${path}`;

async function noHorizontalScroll(page: Page, width: number) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw, `scrollWidth ${m.sw} vs viewport ${width}`).toBeLessThanOrEqual(width);
}

/** Console errors a page logs while the test runs. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function openStaff(path: string): Promise<Page> {
  const page = await ctx.newPage();
  const response = await page.goto(staff(path));
  expect(response?.status(), path).toBe(200);
  return page;
}

/** Publishes the draft open on `page` through the real dialog. */
async function publishOnPage(page: Page) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Yes, publish" }).click();
  await expect(page.getByText("Published.")).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("Job openings - platform host and staff admin", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("careers.spec");
    flags = await captureFlags(sql, FLAGS);
    await setFlag(sql, "sites.public_render", true);
    await setFlag(sql, "org_portal.home_v2", true);
    await setFlag(sql, "org_portal.features", true);
    await setFlag(sql, "org_portal.feature_categories", false);
    fx = await setupCareersFixture(sql);
    await setCareersRole(sql, fx, "manager", { features: true });
    await setCareersToggle(sql, fx, true);
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (fx) await removeCareersFixture(sql, fx);
    await flags?.restore();
  });

  test.afterEach(async () => {
    // Every test starts from: toggle on, manager + features role, the default bundle, a live site, categories axis off.
    await setCareersToggle(sql, fx, true);
    await setCareersRole(sql, fx, "manager", { features: true });
    await setPeopleCategory(sql, fx, null);
    await setSiteBundle(sql, fx);
    await setSiteStatus(sql, fx, "live");
    await setFlag(sql, "org_portal.feature_categories", false);
  });

  // -------------------------------------------------------------------------
  test("toggle off: /careers and a posting URL are the site's 404, the slot says P1, and staff see S1", async ({ page }) => {
    await setCareersToggle(sql, fx, null);
    await addPosting(sql, fx, { slug: "hidden-while-off", title: T.hidden, state: "published" });

    const list = await page.goto(pub("/careers"));
    expect(list?.status()).toBe(404);
    const posting = await page.goto(pub("/careers/hidden-while-off"));
    expect(posting?.status()).toBe(404);
    expect(await page.content()).not.toContain(T.hidden);

    // A page an author placed the slot on is a real page: it says the openings aren't available, at 200.
    const slotPage = await page.goto(pub("/employment"));
    expect(slotPage?.status()).toBe(200);
    await expect(page.getByTestId("careers-unavailable")).toHaveText(P1);
    expect(await page.content()).not.toContain(T.hidden);

    // Staff: with the Features permission the page offers the link; without it, who to ask.
    const withLink = await openStaff("");
    await expect(withLink.getByTestId("careers-feature-off")).toContainText(`Job openings aren't turned on for ${fx.name} yet.`);
    await expect(withLink.getByRole("link", { name: "Turn them on under Features" })).toHaveAttribute("href", `/o/${fx.slug}/admin/features`);
    await withLink.close();

    await setCareersRole(sql, fx, "manager");
    const without = await openStaff("");
    await expect(without.getByTestId("careers-feature-off")).toContainText(`Ask someone who manages ${fx.name}'s features to turn them on.`);
    await expect(without.getByRole("link", { name: "Turn them on under Features" })).toHaveCount(0);
    // A new-posting URL typed by hand is gated the same way.
    const newPage = await openStaff("/new");
    await expect(newPage.getByTestId("careers-feature-off")).toBeVisible();
    await expect(newPage.getByLabel(/^Title/)).toHaveCount(0);
    await without.close();
    await newPage.close();

    // Leave nothing public behind for the empty-state test.
    await sql`update job_postings set status = 'closed' where organization_id = ${fx.orgId}::uuid and status = 'published'`;
  });

  test("toggle on with nothing published: P2 with the profile phone on /careers and in the slot", async ({ page }) => {
    const list = await page.goto(pub("/careers"));
    expect(list?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Job openings" })).toBeVisible();
    await expect(page.getByTestId("careers-empty")).toHaveText(`${P2} You can also call us at ${CAREERS_NAMES.phone}.`);
    await expect(page.getByRole("link", { name: `Back to ${fx.name}` })).toHaveAttribute("href", pub(""));

    await page.goto(pub("/employment"));
    await expect(page.getByTestId("careers-empty")).toContainText(P2);
    await expect(page.getByTestId("careers-unavailable")).toHaveCount(0);
  });

  test("the editor: toolbar, live preview, counter, a pasted Word-style fragment and an unfinished link", async () => {
    const page = await openStaff("/new");
    const errors = watchConsole(page);
    const description = page.getByLabel("Description");
    await description.fill("Plain intro");
    await description.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(description).toHaveValue("**Plain intro**");
    await expect(page.getByTestId("description-preview").locator("strong")).toHaveText("Plain intro");

    await description.fill("Duties");
    await description.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Subheading" }).click();
    await expect(description).toHaveValue("### Duties");
    await expect(page.getByTestId("description-preview").getByRole("heading", { level: 3, name: "Duties" })).toBeVisible();

    // The Link button leaves the placeholder selected, and the validator names the unfinished link by line.
    await description.fill("See ");
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await expect(page.getByTestId("description-errors")).toContainText("finish the web address for the link");
    await expect(page.getByTestId("description-count")).toContainText("of 20,000 characters");

    // A pasted Word-style fragment (HTML with mso classes) is converted to markdown at the caret.
    await description.fill("");
    await description.evaluate((el) => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<h1 class="MsoHeading1">Youth Director</h1><p class="MsoNormal">Lead <b>weekly</b> gatherings.<o:p></o:p></p><ul><li>Plan trips</li><li>Recruit volunteers</li></ul>',
      );
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(description).toHaveValue("## Youth Director\n\nLead **weekly** gatherings.\n\n- Plan trips\n- Recruit volunteers");
    await expect(page.getByTestId("description-preview").getByRole("heading", { level: 2, name: "Youth Director" })).toBeVisible();
    await expect(page.getByTestId("description-errors")).toHaveCount(0);

    // A single # is refused by name, with its line.
    await description.fill("# Big title");
    await expect(page.getByTestId("description-errors")).toContainText('Line 1 ("# Big title") starts with a single #');

    expect(errors, errors.join("\n")).toEqual([]);
    await page.close();
  });

  test("create a draft in the editor: it saves, and it is NOT public", async () => {
    const page = await openStaff("/new");
    const errors = watchConsole(page);
    await page.getByLabel(/^Title/).fill(T.created);
    await page.getByLabel("Location").fill("Fellowship Hall");
    await page.getByLabel("Type").selectOption("part_time");
    await page.getByLabel("Lowest").fill("$18");
    await page.getByLabel("Highest").fill("24.50");
    await page.getByLabel("Short summary").fill("Lead the Sunday evening youth group.");
    await page.getByLabel("Description").fill("## About the role\n\nWe walk alongside students.\n\n- Lead youth group\n- Plan the summer trip\n\nWrite to [the office](mailto:office@example.invalid).");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
    await page.waitForURL(/\/admin\/careers\/[0-9a-f-]{36}$/);

    const row = await postingBySlug(sql, fx, "e2e-created-in-the-editor");
    expect(row).toMatchObject({ status: "draft", title: T.created });
    const stored = (await sql`select pay_min_cents, pay_max_cents, pay_unit, employment_type from job_postings where organization_id = ${fx.orgId}::uuid and slug = 'e2e-created-in-the-editor'`) as Record<string, unknown>[];
    expect(stored[0]).toMatchObject({ pay_min_cents: 1800, pay_max_cents: 2450, pay_unit: "hour", employment_type: "part_time" });

    // A draft is not public: its URL is the site's 404 and the list does not name it.
    const direct = await page.request.get(pub("/careers/e2e-created-in-the-editor"));
    expect(direct.status()).toBe(404);
    expect(await (await page.request.get(pub("/careers"))).text()).not.toContain(T.created);
    expect(errors, errors.join("\n")).toEqual([]);
    await page.close();
  });

  test("publish through the dialog: it appears, renders its description, says how to apply, shows no form; the audit row has ids only", async () => {
    const draft = await postingBySlug(sql, fx, "e2e-created-in-the-editor");
    const page = await openStaff("");
    await page.getByTestId("posting-row").filter({ hasText: T.created }).getByRole("link", { name: T.created }).click();
    await page.waitForURL(/\/admin\/careers\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    await publishOnPage(page);

    const published = await postingBySlug(sql, fx, "e2e-created-in-the-editor");
    expect(published?.status).toBe("published");
    expect(published!.version).toBeGreaterThan(draft!.version);

    const anon = await (await page.context().browser()!.newContext()).newPage();
    const errors = watchConsole(anon);
    const response = await anon.goto(pub("/careers/e2e-created-in-the-editor"));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"] ?? "").toMatch(/no-store|no-cache/);
    await expect(anon.getByRole("heading", { level: 1, name: T.created })).toBeVisible();
    await expect(anon.getByRole("heading", { level: 2, name: "About the role" })).toBeVisible();
    await expect(anon.getByText("Lead youth group")).toBeVisible();
    await expect(anon.getByRole("link", { name: "the office" })).toHaveAttribute("href", "mailto:office@example.invalid");
    await expect(anon.getByText("$18 to $24.50 per hour")).toBeVisible();
    await expect(anon.getByRole("heading", { level: 2, name: "How to apply" })).toBeVisible();
    await expect(anon.getByTestId("how-to-apply")).toContainText(`To apply, please contact ${fx.name}. You can reach us at ${CAREERS_NAMES.phone}, or through the contact details on our website.`);
    await expect(anon.locator("main form, main textarea, main input")).toHaveCount(0);
    await expect(anon.getByRole("link", { name: `Back to ${fx.name}` })).toBeVisible();

    // The list and the slot name it, with a link to its page.
    await anon.goto(pub("/careers"));
    await expect(anon.getByRole("heading", { level: 2, name: T.created })).toBeVisible();
    await anon.getByRole("link", { name: /View this position/ }).first().click();
    await expect(anon.getByRole("heading", { level: 1, name: T.created })).toBeVisible();
    await anon.goto(pub("/employment"));
    await expect(anon.getByRole("heading", { level: 2, name: T.created })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);

    // Audit: exactly one row for the publish, ids and an enum only - never the title or the slug.
    const rows = (await careersAuditRows(sql, fx)).filter((r) => r.metadata.postingId !== undefined);
    expect(rows.map((r) => r.action)).toContain("careers.posting.published");
    const publishRow = rows.find((r) => r.action === "careers.posting.published")!;
    expect(Object.keys(publishRow.metadata).sort()).toEqual(["organizationId", "postingId", "via"]);
    expect(publishRow.metadata.via).toBe("staff");
    expect(JSON.stringify(rows)).not.toContain(T.created);
    expect(JSON.stringify(rows)).not.toContain("e2e-created-in-the-editor");

    await anon.context().close();
    await page.close();
  });

  test("a hostile description is text, never markup or a link", async ({ page }) => {
    await addPosting(sql, fx, {
      slug: "hostile",
      title: T.hostile,
      state: "published",
      description: "<script>window.__pwned = true</script>\n\n<img src=x onerror=\"window.__pwned = true\">\n\n[click](javascript:window.__pwned=true) and **bold**",
    });
    await page.goto(pub("/careers/hostile"));
    await expect(page.getByRole("heading", { level: 1, name: T.hostile })).toBeVisible();
    await expect(page.getByText("<script>window.__pwned = true</script>")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
    await expect(page.locator("main script, main img")).toHaveCount(0);
    await expect(page.locator('main a[href^="javascript"]')).toHaveCount(0);
    await expect(page.locator("main strong")).toHaveText("bold");
  });

  test("closing date: today still shows; yesterday is closed at once, on the list, the page and the staff badge", async ({ page }) => {
    const today = await orgToday(sql);
    const yesterday = await orgToday(sql, -1);
    const todayId = await addPosting(sql, fx, { slug: "closes-today", title: T.today, state: "published", closingDate: today });
    const yesterdayId = await addPosting(sql, fx, { slug: "closed-yesterday", title: T.yesterday, state: "published" });
    await setClosingDate(sql, fx, yesterdayId, yesterday);
    expect(todayId).not.toBe(yesterdayId);

    await page.goto(pub("/careers"));
    await expect(page.getByRole("heading", { level: 2, name: T.today })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: T.yesterday })).toHaveCount(0);
    expect(await page.content()).not.toContain("closed-yesterday");

    // The posting itself reads as closed - the title and the sentence, never the description.
    const closed = await page.goto(pub("/careers/closed-yesterday"));
    expect(closed?.status()).toBe(200);
    await expect(page.getByTestId("posting-closed")).toContainText(P6);
    await expect(page.getByRole("link", { name: "See other job openings" })).toBeVisible();
    await expect(page.getByText("A description of the role.")).toHaveCount(0);

    // The staff list calls it what it is, without waiting for the daily sweep.
    const staffPage = await openStaff("");
    const row = staffPage.getByTestId("posting-row").filter({ hasText: T.yesterday });
    await expect(row.getByText("Closing date passed")).toBeVisible();
    await expect(row.getByText("No longer shown on your website. It will be marked Closed automatically.")).toBeVisible();
    await expect(row.getByRole("link", { name: "View on your website" })).toHaveCount(0);
    await staffPage.close();
  });

  test("reorder: Move up changes the stored order and the public order follows; only published rows have buttons", async () => {
    await addPosting(sql, fx, { slug: "order-alpha", title: T.ordA, state: "published" });
    await addPosting(sql, fx, { slug: "order-beta", title: T.ordB, state: "published" });
    // Newest first: beta is above alpha.
    const before = [(await postingBySlug(sql, fx, "order-beta"))!.sort_order, (await postingBySlug(sql, fx, "order-alpha"))!.sort_order];
    expect(before[0]).toBeLessThan(before[1]!);

    const page = await openStaff("");
    const errors = watchConsole(page);
    await expect(page.getByRole("button", { name: `Move ${T.ordA} up` })).toBeEnabled();
    await page.getByRole("button", { name: `Move ${T.ordA} up` }).click();
    await expect(page.getByRole("status").filter({ hasText: `Moved ${T.ordA} up.` })).toBeAttached();
    await expect.poll(async () => (await postingBySlug(sql, fx, "order-alpha"))!.sort_order).toBeLessThan((await postingBySlug(sql, fx, "order-beta"))!.sort_order);

    await expect
      .poll(async () => {
        const titles = await page.getByTestId("posting-row").getByRole("link").allTextContents();
        return titles.indexOf(T.ordA) < titles.indexOf(T.ordB);
      })
      .toBe(true);
    // A draft row has no move buttons at all.
    await expect(page.getByTestId("posting-row").filter({ hasText: "Draft" }).getByRole("button", { name: /^Move / })).toHaveCount(0);

    const anon = await (await page.context().browser()!.newContext()).newPage();
    await anon.goto(pub("/careers"));
    const publicTitles = await anon.getByRole("heading", { level: 2 }).allTextContents();
    expect(publicTitles.indexOf(T.ordA)).toBeGreaterThanOrEqual(0);
    expect(publicTitles.indexOf(T.ordA)).toBeLessThan(publicTitles.indexOf(T.ordB));
    // Reordering is not an audited disclosure change and bumps no version.
    expect((await postingBySlug(sql, fx, "order-alpha"))!.version).toBe(1 + 1); // 1 at insert, +1 at publish
    expect(errors, errors.join("\n")).toEqual([]);
    await anon.context().close();
    await page.close();
  });

  test("close then reopen through the dialogs: the page reads P6 with noindex and no description, then returns", async () => {
    const page = await openStaff("");
    await page.getByTestId("posting-row").filter({ hasText: T.created }).getByRole("link", { name: T.created }).click();
    await page.waitForURL(/\/admin\/careers\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Close this opening" }).click();
    await expect(page.getByText(`Close "${T.created}"?`)).toBeVisible();
    await page.getByRole("button", { name: "Yes, close it" }).click();
    await expect(page.getByText("Closed.", { exact: true })).toBeVisible();
    expect((await postingBySlug(sql, fx, "e2e-created-in-the-editor"))?.status).toBe("closed");

    const anon = await (await page.context().browser()!.newContext()).newPage();
    const response = await anon.goto(pub("/careers/e2e-created-in-the-editor"));
    expect(response?.status()).toBe(200);
    await expect(anon.getByTestId("posting-closed")).toContainText(P6);
    await expect(anon.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(anon.getByText("We walk alongside students.")).toHaveCount(0);
    // Unpublished means off the list at once - the response is not cacheable.
    const list = await anon.goto(pub("/careers"));
    expect(list?.headers()["cache-control"] ?? "").toMatch(/no-store|no-cache/);
    expect(await anon.content()).not.toContain(T.created);

    await page.reload();
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText(`Reopen "${T.created}"?`)).toBeVisible();
    await page.getByRole("button", { name: "Yes, reopen it" }).click();
    await expect(page.getByText("Reopened.")).toBeVisible();
    expect((await postingBySlug(sql, fx, "e2e-created-in-the-editor"))?.status).toBe("published");
    await anon.goto(pub("/careers/e2e-created-in-the-editor"));
    await expect(anon.getByText("We walk alongside students.")).toBeVisible();

    const actions = (await careersAuditRows(sql, fx)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["careers.posting.published", "careers.posting.closed", "careers.posting.reopened"]));
    await anon.context().close();
    await page.close();
  });

  test("discard: a draft goes to Closed as 'Never published', offers no Reopen, writes no audit row, and never appears", async () => {
    const before = (await careersAuditRows(sql, fx)).length;
    await addPosting(sql, fx, { slug: "to-discard", title: "E2E To Discard", state: "draft" });
    const page = await openStaff("");
    await page.getByTestId("posting-row").filter({ hasText: "E2E To Discard" }).getByRole("link", { name: "E2E To Discard" }).click();
    await page.getByRole("button", { name: "Discard this draft" }).click();
    await expect(page.getByText("Discard this draft?", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Yes, discard it" }).click();
    await expect(page.getByText("Draft discarded.")).toBeVisible();
    await expect(page.getByText("Never published", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    expect((await postingBySlug(sql, fx, "to-discard"))?.status).toBe("closed");
    expect((await careersAuditRows(sql, fx)).length).toBe(before);
    expect((await page.request.get(pub("/careers/to-discard"))).status()).toBe(404);
    await page.close();
  });

  test("the web address is read-only after publish: a tampered field is ignored, and the database refuses a change", async () => {
    const page = await openStaff("");
    await page.getByTestId("posting-row").filter({ hasText: T.created }).getByRole("link", { name: T.created }).click();
    const slug = page.getByLabel("Web address");
    await expect(slug).toHaveAttribute("readonly", "");
    await expect(page.getByText("The web address can't be changed after an opening is published, because people may have saved or shared it.")).toBeVisible();
    // Bypass the read-only attribute from the console and save: the form omits a locked slug.
    await slug.evaluate((el: HTMLInputElement) => {
      el.removeAttribute("readonly");
    });
    await slug.fill("tampered-address");
    await page.getByLabel(/^Title/).fill(`${T.created} (edited)`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    const row = await postingBySlug(sql, fx, "e2e-created-in-the-editor");
    expect(row?.title).toBe(`${T.created} (edited)`);
    expect(await postingBySlug(sql, fx, "tampered-address")).toBeNull();
    // Even the owner connection cannot move a published posting's address (the trigger binds it too).
    await expect(sql`update job_postings set slug = 'moved' where organization_id = ${fx.orgId}::uuid and slug = 'e2e-created-in-the-editor'`).rejects.toThrow(/slug is fixed/);
    await page.close();
  });

  test("two tabs: the second save is stale, nothing is overwritten and the typed text stays", async ({ browser }) => {
    const id = await addPosting(sql, fx, { slug: "stale-target", title: T.stale, state: "draft" });
    const tabA = await ctx.newPage();
    const tabB = await ctx.newPage();
    await tabA.goto(staff(`/${id}`));
    await tabB.goto(staff(`/${id}`));
    await tabA.getByLabel(/^Title/).fill("E2E Stale Target - first save");
    await tabA.getByRole("button", { name: "Save draft" }).click();
    await expect(tabA.getByText("Changes saved.")).toBeVisible();

    await tabB.getByLabel(/^Title/).fill("E2E Stale Target - second tab");
    await tabB.getByRole("button", { name: "Save draft" }).click();
    await expect(tabB.getByTestId("posting-stale")).toContainText(S8_STALE);
    await expect(tabB.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(tabB.getByLabel(/^Title/)).toHaveValue("E2E Stale Target - second tab");
    expect((await postingBySlug(sql, fx, "stale-target"))?.title).toBe("E2E Stale Target - first save");
    await tabB.getByRole("button", { name: "Reload" }).click();
    await expect(tabB.getByLabel(/^Title/)).toHaveValue("E2E Stale Target - first save");
    void browser;
    await tabA.close();
    await tabB.close();
  });

  test("a bundle with its own /careers page wins over the list; a bundle with the slot on /employment shows the list inside the site chrome", async ({ page }) => {
    await setSiteBundle(sql, fx, { ownCareersPage: true });
    const own = await page.goto(pub("/careers"));
    expect(own?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Our own careers page" })).toBeVisible();
    await expect(page.getByTestId("careers-list")).toHaveCount(0);
    // The posting pages still belong to the platform.
    expect((await page.goto(pub("/careers/hostile")))?.status()).toBe(200);

    await setSiteBundle(sql, fx);
    await page.goto(pub("/careers"));
    await expect(page.locator(".presby-site")).toHaveCount(0); // platform page: no site chrome
    await expect(page.getByTestId("careers-list")).toBeVisible();
    await page.goto(pub("/employment"));
    await expect(page.locator(".presby-site")).toHaveCount(1); // slot: inside the site's own chrome
    await expect(page.locator(".presby-site").getByTestId("careers-list")).toBeVisible();
  });

  test("the category axis: with it on and People off, the page is a 404 and the slot says P1", async ({ page }) => {
    await setFlag(sql, "org_portal.feature_categories", true);
    await setPeopleCategory(sql, fx, false);
    expect((await page.goto(pub("/careers")))?.status()).toBe(404);
    await page.goto(pub("/employment"));
    await expect(page.getByTestId("careers-unavailable")).toHaveText(P1);
    // The axis off makes the category row inert again.
    await setFlag(sql, "org_portal.feature_categories", false);
    expect((await page.goto(pub("/careers")))?.status()).toBe(200);
  });

  test("a site that is not live is the site's 404 (nothing about the openings)", async ({ page }) => {
    await setSiteStatus(sql, fx, "suspended");
    expect((await page.goto(pub("/careers")))?.status()).toBe(404);
    expect((await page.goto(pub("/careers/hostile")))?.status()).toBe(404);
  });

  test("a member with no permission sees the tile and the S2 state; a holder of careers.applicants alone is forbidden too", async () => {
    await setCareersRole(sql, fx, "none");
    const home = await ctx.newPage();
    await home.goto(`/o/${fx.slug}`);
    const tile = home.locator(`a[href="/o/${fx.slug}/admin/careers"]`).first();
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(home.getByTestId("careers-forbidden")).toContainText(
      `You don't have permission to manage job openings at ${fx.name}. If you think this is a mistake, ask your stated clerk or another administrator there.`,
    );
    await expect(home.getByLabel(/^Title/)).toHaveCount(0);

    await setCareersRole(sql, fx, "applicants");
    await home.goto(staff(""));
    await expect(home.getByTestId("careers-forbidden")).toBeVisible();
    await home.goto(staff("/new"));
    await expect(home.getByTestId("careers-forbidden")).toBeVisible();
    await home.close();
    // Nothing was written by a forbidden visit.
    expect(await postingBySlug(sql, fx, "tampered-address")).toBeNull();
  });

  test("a malformed or unknown posting id is the not-found state", async () => {
    for (const id of ["not-a-guid", "00000000-0000-4000-8000-000000000000"]) {
      const page = await openStaff(`/${id}`);
      await expect(page.getByTestId("careers-not-found")).toContainText("That job opening couldn't be found.");
      await expect(page.getByRole("link", { name: "Back to job openings" })).toHaveAttribute("href", staff(""));
      await page.close();
    }
  });

  test("the placement line reports the published bundle: the slot page, and then no slot at all", async () => {
    const page = await openStaff("");
    await expect(page.getByTestId("careers-placement")).toContainText("Your openings appear on your website's /employment page and in a list at ");
    await setSiteBundle(sql, fx, { ownCareersPage: true });
    await page.reload();
    await expect(page.getByTestId("careers-placement")).toContainText("Your openings appear on your website's /employment page.");
    await setSiteStatus(sql, fx, "provisioning");
    await page.reload();
    await expect(page.getByTestId("careers-placement")).toHaveText("We couldn't check your published website, so we can't say where your openings appear.");
    await page.close();
  });

  // -------------------------------------------------------------------------
  test.describe("at 360px (a phone)", () => {
    test("the public list and a posting with a 200-character unbroken title do not scroll sideways", async ({ browser }) => {
      await addPosting(sql, fx, { slug: "long-title", title: T.long, state: "published", summary: "x".repeat(250) });
      const anon = await browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
      const page = await anon.newPage();
      const errors = watchConsole(page);
      await page.goto(pub("/careers"));
      await expect(page.getByRole("heading", { level: 2, name: T.long })).toBeVisible();
      await noHorizontalScroll(page, 360);
      await page.goto(pub("/careers/long-title"));
      await expect(page.getByRole("heading", { level: 1, name: T.long })).toBeVisible();
      await noHorizontalScroll(page, 360);
      await page.goto(pub("/employment"));
      await expect(page.getByTestId("careers-list")).toBeVisible();
      await noHorizontalScroll(page, 360);
      for (const link of await page.getByRole("link", { name: /View this position/ }).all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(errors, errors.join("\n")).toEqual([]);
      await anon.close();
    });

    test("the status dialogs name the title as typed, fit the phone, and Close keeps a typed edit - regression for the stale dialog title and dropped edits", async () => {
      await addPosting(sql, fx, { slug: "dialog-draft", title: "E2E Dialog Draft", state: "draft" });
      const openId = await addPosting(sql, fx, { slug: "dialog-open", title: "E2E Dialog Open", state: "published" });
      const draftId = (await sql`select id from job_postings where organization_id = ${fx.orgId}::uuid and slug = 'dialog-draft'`)[0]!.id as string;

      const page = await ctx.newPage();
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(staff(`/${draftId}`));
      await page.getByLabel(/^Title/).fill("E2E Dialog Draft Renamed");
      await page.getByRole("button", { name: "Publish" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByText('Publish "E2E Dialog Draft Renamed"?')).toBeVisible();
      // The dialog zooms in; measure once it has settled.
      await expect.poll(async () => (await dialog.getByRole("button").last().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      for (const button of await dialog.getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await noHorizontalScroll(page, 360);
      await dialog.getByRole("button", { name: "Keep as draft" }).click();

      await page.goto(staff(`/${openId}`));
      await page.getByLabel(/^Title/).fill("E2E Dialog Open Renamed");
      await page.getByRole("button", { name: "Close this opening" }).click();
      await expect(page.getByRole("alertdialog").getByText('Close "E2E Dialog Open Renamed"?')).toBeVisible();
      await page.getByRole("button", { name: "Yes, close it" }).click();
      await expect(page.getByText("Closed.", { exact: true })).toBeVisible();
      const row = await postingBySlug(sql, fx, "dialog-open");
      expect(row?.status).toBe("closed");
      expect(row?.title).toBe("E2E Dialog Open Renamed");
      await page.close();
    });

    test("the staff list (long title, move buttons) and the editor (toolbar, preview) fit, with 44px targets", async () => {
      const list = await ctx.newPage();
      await list.setViewportSize({ width: 360, height: 800 });
      const errors = watchConsole(list);
      await list.goto(staff(""));
      await expect(list.getByTestId("posting-row").filter({ hasText: T.long })).toBeVisible();
      await noHorizontalScroll(list, 360);
      const moves = list.getByRole("button", { name: /^Move / });
      await expect(moves.first()).toBeVisible();
      for (const button of await moves.all()) {
        const box = (await button.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await list.close();

      const editor = await ctx.newPage();
      await editor.setViewportSize({ width: 360, height: 800 });
      watchConsole(editor);
      await editor.goto(staff("/new"));
      await editor.getByLabel("Description").fill("## A heading\n\n" + "word ".repeat(60) + "\n\nhttps://example.invalid/" + "a".repeat(120));
      await expect(editor.getByTestId("description-preview").getByRole("heading", { level: 2 })).toBeVisible();
      await noHorizontalScroll(editor, 360);
      for (const button of await editor.getByTestId("description-toolbar").getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      // 16px text in the textarea so iOS does not zoom on focus.
      expect(await editor.getByLabel("Description").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      expect(errors, errors.join("\n")).toEqual([]);
      await editor.close();
    });
  });
});
