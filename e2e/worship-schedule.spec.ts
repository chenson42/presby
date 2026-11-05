/**
 * worship-schedule.spec.ts - the scheduling flow, driven at 360px against a running
 * server (worship Increment 1, Batch 6; docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * "E2E"). Two people, two ways in:
 *
 *   - Barnaby (the leader) holds NO worship key: he schedules the Sunday Band by his
 *     leader SEAT alone. He opens "Worship", his team, the board for the first service,
 *     places Wren (a draft, nobody told), a guest, and Posy (a child: a presumed minor),
 *     sends the requests (the Dialog previews the counts first), sees why Posy was not
 *     emailed, records her parent's "yes" on her behalf, and removes a person.
 *   - Celeste (the planner) holds the three worship keys: she sees the hub, adds a team
 *     and a service, edits it, and cancels one with people on it, which closes the open
 *     requests (the cancel hook).
 *
 * Every page is also screenshotted at 360px into `test-results/worship-360/` for the
 * Batch 6 phone walk (a person opens each image). Everything lives in a THROWAWAY
 * congregation (`e2e-worships-<stamp>`) removed in afterAll. Invented names, `.invalid`
 * addresses, no real data.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  assignmentStatus,
  clearQueue,
  newPhonePage,
  noSidewaysScroll,
  queuedTo,
  removeWorshipFixture,
  seedAssignment,
  setupWorshipFixture,
  signedInContext,
  smallTargets,
  waitHydrated,
  WORSHIP_EMAILS,
  WORSHIP_NAMES as NAMES,
  type WorshipFixture,
} from "./support/worship-fixture";

let sql: Sql;
let fx: WorshipFixture;
let leader: BrowserContext;
let planner: BrowserContext;

const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];
const base = () => `/o/${fx.slug}`;

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450); // let any dialog finish its fade before the picture
  await page.screenshot({ path: `test-results/worship-360/${name}.png`, fullPage: true });
}

/** Opens a page, waits for hydration, checks it fits the phone and its targets are thumb-sized. */
async function visit(page: Page, path: string, name: string) {
  await page.goto(path);
  await waitHydrated(page).catch(() => undefined);
  await noSidewaysScroll(page);
  await shot(page, name);
}

test.describe.configure({ mode: "serial" });

test.describe("Worship: scheduling at 360px", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    sql = platformSql("worship-schedule.spec");
    fx = await setupWorshipFixture(sql, { tag: "s" });
    // Two requests already out to Wren (the multi-request email is not under test here): none; the leader makes them.
    leader = await signedInContext(browser, "leader", `${base()}/worship`);
    planner = await signedInContext(browser, "planner", `${base()}/admin/worship`);
  });

  test.afterAll(async () => {
    await leader?.close();
    await planner?.close();
    if (sql && fx) await removeWorshipFixture(sql, fx);
  });

  test("the leader, with no key, opens Worship and his team, and the board refuses everyone else's", async () => {
    const page = await newPhonePage(leader);
    await visit(page, `${base()}/worship`, "01-leader-home-empty");
    await expect(page.getByRole("heading", { level: 1, name: "Worship" })).toBeVisible();
    await expect(page.getByText("You're not asked to serve at any upcoming services.")).toBeVisible();
    const teamLink = page.getByRole("link", { name: new RegExp(NAMES.band) });
    await expect(teamLink).toContainText("You lead");

    await teamLink.click();
    await expect(page.getByRole("heading", { level: 1, name: NAMES.band })).toBeVisible();
    await waitHydrated(page).catch(() => undefined);
    await shot(page, "02-leader-team-page");
    await expect(page.getByText("Upcoming services")).toBeVisible();
    await expect(page.getByTestId("team-person").first()).toBeVisible();

    // He may not schedule a team he does not lead (the choir), whatever the URL says.
    const denied = await page.goto(`${base()}/worship/teams/${fx.choir}/services/${fx.serviceId}`);
    expect(denied?.status()).toBe(404);
    // And the admin tree is not his: no key.
    await page.goto(`${base()}/admin/worship`);
    await expect(page.getByTestId("worship-forbidden")).toBeVisible();
    await shot(page, "03-leader-admin-forbidden");
    await page.close();
  });

  test("the leader places people by the seat, sends, and sees why a child was not emailed", async () => {
    const page = await newPhonePage(leader);
    await clearQueue(sql, [WORSHIP_EMAILS.wren!]);
    await visit(page, `${base()}/worship/teams/${fx.band}/services/${fx.serviceId}`, "04-board-empty");
    await expect(page.getByRole("heading", { level: 1, name: NAMES.serviceTitle })).toBeVisible();
    await expect(page.getByText("Vocals, 0 of 2")).toBeVisible();
    expect(await page.getByTestId("send-open").count()).toBe(0); // nothing to send yet

    // Wren, for Vocals: the picker lists her first ("Can fill this position").
    await page.getByTestId(`add-someone-${fx.positions.vocals}`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("picker-row").first()).toContainText(NAMES.wren);
    await expect(dialog.getByText("Can fill this position")).toBeVisible();
    await shot(page, "05-picker-vocals");
    await dialog.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.getByText("Added. Send requests when you're ready.")).toBeVisible();
    await expect(dialog).toBeHidden();

    // Posy (a child), for Keys: the picker says she will not get an email.
    await page.getByTestId(`add-someone-${fx.positions.keys}`).click();
    const keys = page.getByRole("dialog");
    await expect(keys.getByText("May be under 18. They won't get an email.")).toBeVisible();
    await shot(page, "06-picker-keys-minor");
    await keys.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(keys).toBeHidden();

    // A guest drummer: just a name, and a contact detail is refused with the Copy sentence.
    await page.getByTestId(`add-guest-${fx.positions.drums}`).click();
    const guest = page.getByRole("dialog");
    await waitHydrated(page).catch(() => undefined);
    await guest.getByLabel("Guest name").fill("drummer@example.invalid");
    await guest.getByRole("button", { name: "Add guest" }).click();
    await expect(guest.getByText("Enter just a name. Contact details aren't kept here.")).toBeVisible();
    await shot(page, "07-guest-refused");
    await guest.getByLabel("Guest name").fill("A Visiting Drummer");
    await guest.getByRole("button", { name: "Add guest" }).click();
    await expect(guest).toBeHidden();

    await expect(page.getByText("Vocals, 1 of 2")).toBeVisible();
    await expect(page.getByTestId("status-chip").filter({ hasText: "Not sent yet" })).toHaveCount(2);
    await expect(page.getByTestId("status-chip").filter({ hasText: "Guest" })).toHaveCount(1);
    await shot(page, "08-board-drafts");

    // Send: the Dialog previews, then writes.
    await page.getByTestId("send-open").click();
    const send = page.getByRole("dialog");
    await expect(send.getByTestId("send-body")).toContainText("1 can't be emailed (1 may be under 18, 0 have no email address, 0 are marked do not contact)");
    await shot(page, "09-send-dialog");
    expect(await queuedTo(sql, WORSHIP_EMAILS.wren!)).toHaveLength(0); // opening the dialog wrote nothing
    await send.getByTestId("send-confirm").click();
    await expect(page.getByText("Requests sent. 1 emailed, 1 not emailed.")).toBeVisible();

    await expect(page.getByTestId("status-chip").filter({ hasText: "Waiting for an answer" })).toHaveCount(2);
    await expect(page.getByTestId("reach-note").filter({ hasText: "Request emailed." })).toHaveCount(1);
    await expect(page.getByText("No email sent: may be under 18. Ask a parent or guardian, then record their answer.")).toBeVisible();
    await shot(page, "10-board-sent");

    // One email to Wren, none to Posy (she has no address, and is a child).
    const mail = await queuedTo(sql, WORSHIP_EMAILS.wren!);
    expect(mail.map((m) => m.template_key)).toEqual(["worship.notice.request"]);
    expect(await rows(sql`select 1 from email_queue where subject like '%request to serve%' and lower(to_email) like 'e2e-worship-%' and lower(to_email) <> ${WORSHIP_EMAILS.wren!}`)).toHaveLength(0);
    await clearQueue(sql, [WORSHIP_EMAILS.wren!]);

    // The parent says yes; the leader records it, and it is saved as his.
    const posyRow = page.getByTestId("assignment-row").filter({ hasText: NAMES.posy });
    await posyRow.getByRole("button", { name: "Record answer" }).click();
    const record = page.getByRole("dialog");
    await expect(record.getByText("This is saved as entered by you.")).toBeVisible();
    await shot(page, "11-record-answer");
    await record.getByRole("button", { name: "Record answer" }).click();
    await expect(page.getByText("Answer recorded.")).toBeVisible();
    await expect(posyRow.getByTestId("status-chip")).toContainText("Confirmed");
    await expect(posyRow.getByTestId("recorded-by")).toHaveText(`Recorded by ${NAMES.leader}`);

    // Remove Wren after the Send: the dialog says she is not told.
    const wrenRow = page.getByTestId("assignment-row").filter({ hasText: NAMES.wren });
    await wrenRow.getByRole("button", { name: /^Remove/ }).click();
    const remove = page.getByRole("alertdialog");
    await expect(remove).toContainText("They aren't sent a message about this, so let them know yourself.");
    await shot(page, "12-remove-dialog");
    await remove.getByTestId("remove-confirm").click();
    await expect(page.getByText("Removed.")).toBeVisible();
    await expect(page.getByTestId("assignment-row").filter({ hasText: NAMES.wren })).toHaveCount(0);
    expect(await smallTargets(page)).toEqual([]);
    await page.close();
  });

  test("the planner sees the hub by her keys, adds a team and a service, and cancels one with people on it", async () => {
    const wrenRequest = await seedAssignment(sql, fx, { who: "wren", position: "vocals", upTo: "requested", event: "second" });
    const page = await newPhonePage(planner);
    await visit(page, `${base()}/admin/worship`, "20-hub");
    await expect(page.getByRole("heading", { level: 1, name: "Plan worship" })).toBeVisible();
    await expect(page.getByTestId("worship-hub").getByRole("link")).toHaveCount(3);
    expect(await smallTargets(page)).toEqual([]);

    await visit(page, `${base()}/admin/worship/services`, "21-services");
    await expect(page.getByTestId("services-list")).toContainText("of 5 positions filled");
    await expect(page.getByTestId("services-list")).toContainText("waiting for an answer");

    await visit(page, `${base()}/admin/worship/teams`, "22-teams");
    await expect(page.getByTestId("teams-list")).toContainText(NAMES.band);
    await visit(page, `${base()}/admin/worship/teams/${fx.band}`, "23-team");
    await expect(page.getByTestId("position-row")).toHaveCount(4);

    // A new team, from the ready-made Ushers set.
    await page.goto(`${base()}/admin/worship/teams/new`);
    await waitHydrated(page);
    await shot(page, "24-new-team");
    await page.getByLabel("Team name").fill("Door Ushers");
    await page.getByLabel("Start with").selectOption("ushers");
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Door Ushers" })).toBeVisible();
    await expect(page.getByTestId("position-row")).toHaveCount(2);
    await shot(page, "25-new-team-created");

    // A new service.
    await page.goto(`${base()}/admin/worship/services/new`);
    await waitHydrated(page);
    await shot(page, "26-new-service");
    await page.getByLabel("Title").fill("Christmas Eve candlelight");
    await page.getByLabel("Date").fill(new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel("Starts at").fill("19:00");
    await page.getByLabel("Door Ushers").check();
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Christmas Eve candlelight" })).toBeVisible();
    await shot(page, "27-service-created");

    // Cancel the evening service that has Wren's open request.
    await visit(page, `${base()}/admin/worship/services/${fx.serviceId2}`, "28-service-with-request");
    await page.getByTestId("cancel-service-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("It is marked Cancelled in your services list and leaves the calendar.");
    await shot(page, "29-cancel-dialog");
    await dialog.getByTestId("cancel-service-confirm").click();
    await expect(page.getByText("Service cancelled.")).toBeVisible();
    await expect(page.getByTestId("service-cancelled")).toBeVisible();
    expect((await assignmentStatus(sql, wrenRequest)).status).toBe("withdrawn");
    const notices = await queuedTo(sql, WORSHIP_EMAILS.wren!);
    expect(notices.map((n) => n.template_key)).toContain("worship.notice.cancelled");
    await clearQueue(sql, [WORSHIP_EMAILS.wren!]);

    // A cancelled service offers no editing or scheduling.
    await expect(page.getByTestId("cancel-service-open")).toHaveCount(0);
    await expect(page.getByTestId("edit-service-open")).toHaveCount(0);
    await page.close();
  });
});
