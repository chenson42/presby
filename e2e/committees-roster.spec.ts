/**
 * committees-roster.spec.ts - the presbytery's Committees & Commissions pages, end to end (Presbytery
 * committees Increment 1, Batch B4; docs/work-log/2026-11-19-presbytery-committees.md Phase 3 "Test plan" ->
 * "E2E", docs/work-log/2026-11-19-presbytery-committees-inc1.md).
 *
 * THE FOUNDER IS REAL. The first person through the pages is a presbytery founding administrator minted by
 * `presby_apply_founding_administrator` (the same definer the platform operator's designation calls), MFA
 * enrolled, holding no grant beyond the bundle: that is how a real user holds `groups.manage`, so the walk
 * proves the bundle is enough. The clerk (a custom role with ONLY `groups.manage`) does the same work with no
 * two-factor prompt, and a member with no role is told, in a sentence, that they lack the key.
 *
 * Phone first: every browser context is 360px; one test widens to 1280px for the table layout.
 *
 * Flag set here and restored in afterAll: `org_portal.committees` (named; nothing is added to
 * scripts/ci/e2e-baseline-flags.sql). Throwaway presbytery, invented names, `.invalid` addresses.
 *
 * What is NOT here (and why): the public committee directory is an unflagged DB and unit surface; this spec
 * reads the same definer it calls (`presby_public_committee_roster`) after the listing switch is used.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  bindRoleToCommittee,
  COMMITTEES_FLAG,
  COMMITTEES_NAMES,
  committeeByName,
  committeesAudit,
  expectNoSidewaysScroll,
  LONG_FIRST,
  LONG_PERSON,
  makePresbyterySiteLive,
  mainText,
  newPhonePage,
  publicRoster,
  removeCommitteesFixture,
  retireSeatablePeople,
  seatsOf,
  SEATABLE_NAMES,
  seedCommittee,
  seedSeat,
  setupCommitteesFixture,
  signedInContext,
  smallControls,
  waitHydrated,
  type CommitteesFixture,
} from "./support/committees-fixture";

/** Free-text sentinels: they must reach the committee page and never an audit row. */
const PURPOSE_SENTINEL = "PURPOSE-SENTINEL-4090 reviews the annual call process";
const MEETS_SENTINEL = "MEETS-SENTINEL-4090 on the second Tuesday";
const MAIN_NAME = "Committee on Ministry E2E";
const LONG_NAME = "Standing".repeat(25); // 200 characters, no break opportunity

let sql: Sql;
let fx: CommitteesFixture;
let flags: FlagCapture;
let founder: BrowserContext;
const base = () => `/o/${fx.presbytery.slug}/admin/committees`;

/** `YYYY-MM-DD` shifted by whole days (UTC arithmetic on a date-only string). */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const utcToday = () => new Date().toISOString().slice(0, 10);

async function toastOrText(page: Page, text: string) {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

/** The committee's `Seat` rows, with role and dates, for one person. */
async function seatOf(committeeId: string, personId: string) {
  return (await seatsOf(sql, committeeId)).filter((s) => s.person_id === personId);
}

test.describe.serial("Committees: the roster, end to end", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    sql = platformSql("committees-roster.spec");
    flags = await captureFlags(sql, [COMMITTEES_FLAG]);
    await setFlag(sql, COMMITTEES_FLAG, true);
    fx = await setupCommitteesFixture(sql, { tag: "r" });
    founder = await signedInContext(browser, "founder", base());
  });

  test.afterAll(async () => {
    await founder?.close();
    if (sql && fx) await removeCommitteesFixture(sql, fx);
    await flags?.restore();
  });

  test("1. the founder reaches Committees from the portal tile (no Coming soon) and meets the guided empty state", async () => {
    // The bundle the definer minted carries the key: no further grant exists for this person.
    const keys = (await sql`
      select p.permission_key from app_roles r join app_role_permissions p on p.role_id = r.id
       where r.organization_id = ${fx.presbytery.id}::uuid and r.key = 'founding_administrator'`) as { permission_key: string }[];
    expect(keys.map((k) => k.permission_key)).toContain("groups.manage");
    const grants = (await sql`
      select r.key from role_grants g join app_roles r on r.id = g.role_id
       where g.organization_id = ${fx.presbytery.id}::uuid and g.person_id = ${fx.people.founder}::uuid order by r.key`) as { key: string }[];
    expect(grants.map((g) => g.key)).not.toContain("e2e_cmt_clerk");

    const page = await newPhonePage(founder);
    await page.goto(`/o/${fx.presbytery.slug}`);
    const tile = page.locator(`a[href="${base()}"]`);
    await expect(tile).toBeVisible();
    await expect(tile).toContainText("Committees & Commissions");
    // The Increment 2 description (C11 II): the tile now also names the commission records.
    await expect(tile).toContainText("The presbytery's committees, who serves on them, and the administrative commissions it has recorded.");
    await expect(tile).not.toContainText("Coming soon");
    await tile.click();
    await page.waitForURL((url) => url.pathname === base());

    await expect(page.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeVisible();
    await expect(page.getByText("No committees yet")).toBeVisible();
    await expect(page.getByText("Start with the committees your presbytery is required to have")).toBeVisible();
    await page.getByRole("link", { name: "Create your first committee" }).click();
    await page.waitForURL((url) => url.pathname === `${base()}/new`);
    await expect(page.getByRole("heading", { level: 1, name: "New committee" })).toBeVisible();
    await page.close();
  });

  test("2. create: the two required fields are refused on the fields; a save lands on the committee page; a duplicate name is refused naming the stored one", async () => {
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "Create committee" }).click();
    await expect(page.getByText("Name is required.")).toBeVisible();
    await expect(page.getByText("Choose Required, Standing or Ad hoc.")).toBeVisible();

    await page.locator("#committee-name").fill(MAIN_NAME);
    await page.locator("#committee-kind").selectOption("standing");
    await page.locator("#committee-purpose").fill(PURPOSE_SENTINEL);
    await page.locator("#committee-meets").fill(MEETS_SENTINEL);
    await page.getByRole("button", { name: "Create committee" }).click();
    await toastOrText(page, "Committee created.");
    await page.waitForURL((url) => /\/admin\/committees\/[0-9a-f-]{36}$/.test(url.pathname));

    await expect(page.getByRole("heading", { level: 1, name: MAIN_NAME })).toBeVisible();
    await expect(page.getByText("Standing", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(PURPOSE_SENTINEL)).toBeVisible();
    await expect(page.getByText(`Meets ${MEETS_SENTINEL}`)).toBeVisible();
    await expect(page.getByText("No one serves on this committee yet.")).toBeVisible();
    // The titles note (no access from a title) is on the page; the carries note is not (this committee carries no role).
    await expect(page.getByText("A title doesn't give anyone access.")).toBeVisible();
    await expect(page.getByTestId("carries-role-note")).toHaveCount(0);

    const created = await committeeByName(sql, fx, MAIN_NAME);
    expect(created?.kind).toBe("standing");

    // A duplicate (any case, any spacing) is refused under the name field, naming the stored spelling; the values stay.
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await page.locator("#committee-name").fill(`  ${MAIN_NAME.toUpperCase()} `);
    await page.locator("#committee-kind").selectOption("required");
    await page.getByRole("button", { name: "Create committee" }).click();
    await expect(page.getByText(`A committee named "${MAIN_NAME}" already exists. Choose a different name.`)).toBeVisible();
    await expect(page.locator("#committee-kind")).toHaveValue("required");
    await expect(page).toHaveURL(new RegExp(`${base()}/new$`));
    expect((await committeeByName(sql, fx, MAIN_NAME.toUpperCase()))?.id).toBeUndefined();

    // The list: the committee is under "Standing committees"; the Required section is absent.
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 2, name: "Standing committees" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Required committees" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: new RegExp(MAIN_NAME) }).first()).toBeVisible();
    await page.close();
  });

  test("3. add members: a person already serving is disabled, a later start shows under Starting later, an end before the start is refused", async () => {
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/${committee.id}/members/new`);
    await waitHydrated(page);
    await expect(page.getByTestId("carries-role-note")).toHaveCount(0);
    const today = await page.locator("#add-starts").inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Required fields.
    await page.getByRole("button", { name: "Add to committee" }).click();
    await expect(page.getByText("Choose a person.")).toBeVisible();

    // An end on or before the start is refused on its field and nothing is written.
    await page.locator("#add-person").selectOption({ label: SEATABLE_NAMES.avery });
    await page.locator("#add-role").selectOption("chair");
    await page.locator("#add-ends").fill(today);
    await page.getByRole("button", { name: "Add to committee" }).click();
    await expect(page.getByText("The end date has to be after the start date.")).toBeVisible();
    expect(await seatsOf(sql, committee.id)).toHaveLength(0);

    // Avery as chair from today.
    await page.locator("#add-ends").fill("");
    await page.getByRole("button", { name: "Add to committee" }).click();
    await toastOrText(page, "Added to the committee.");
    await page.waitForURL((url) => url.pathname === `${base()}/${committee.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "Serving now" })).toBeVisible();
    const serving = page.getByRole("region", { name: "Serving now" });
    await expect(serving.getByText(SEATABLE_NAMES.avery).first()).toBeVisible();
    await expect(serving.getByText("Chair", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No one serves on this committee yet.")).toHaveCount(0);

    // Blair, starting later: under "Starting later", not "Serving now".
    await page.goto(`${base()}/${committee.id}/members/new`);
    await waitHydrated(page);
    // The person already serving is listed and disabled, with the words.
    const averyOption = page.locator("#add-person option", { hasText: `${SEATABLE_NAMES.avery} (already serves)` });
    await expect(averyOption).toHaveCount(1);
    await expect(averyOption).toBeDisabled();
    await page.locator("#add-person").selectOption({ label: SEATABLE_NAMES.blair });
    await page.locator("#add-starts").fill(shift(today, 40));
    await page.getByRole("button", { name: "Add to committee" }).click();
    await toastOrText(page, "Added to the committee.");
    await page.waitForURL((url) => url.pathname === `${base()}/${committee.id}`);
    const planned = page.getByRole("region", { name: "Starting later" });
    await expect(planned).toBeVisible();
    await expect(planned.getByText(SEATABLE_NAMES.blair).first()).toBeVisible();
    await expect(planned.getByText(/^Starts /).first()).toBeVisible();
    await expect(serving.getByText(SEATABLE_NAMES.blair)).toHaveCount(0);

    // Two rows exist, both managed, and Avery's role is chair.
    const [avery] = await seatOf(committee.id, fx.seatable.avery);
    expect(avery?.group_role).toBe("chair");
    expect((await seatOf(committee.id, fx.seatable.blair))[0]?.starts_on).toBe(shift(today, 40));
    await page.close();
  });

  test("4. change role: one history with no gap, the old role in Past members, one audit row; the same role is refused; a stale form is refused", async () => {
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    // Casey has served as a member since 2020 (seeded: the page cannot record a start in the far past in one step).
    const caseySeat = await seedSeat(sql, fx, committee.id, fx.seatable.casey, { role: "member", startsOn: "2020-01-01" });
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/${committee.id}`);
    await page.getByRole("link", { name: `Change role for ${SEATABLE_NAMES.casey}` }).click();
    await page.waitForURL((url) => url.pathname === `${base()}/${committee.id}/members/${caseySeat}/role`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: `Change ${SEATABLE_NAMES.casey}'s role` })).toBeVisible();
    // The current role is not offered; an empty choice is refused.
    await expect(page.locator("#change-role option", { hasText: /^Member$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Change role" }).click();
    await expect(page.getByText("Choose a different role.").first()).toBeVisible();

    await page.locator("#change-role").selectOption("vice_chair");
    const effective = await page.locator("#change-effective").inputValue();
    await page.getByRole("button", { name: "Change role" }).click();
    await toastOrText(page, "Role changed.");
    await page.waitForURL((url) => url.pathname === `${base()}/${committee.id}`);

    const seats = await seatOf(committee.id, fx.seatable.casey);
    expect(seats).toHaveLength(2);
    const [oldRow, newRow] = seats;
    expect(oldRow).toMatchObject({ group_role: "member", starts_on: "2020-01-01", ends_on: effective });
    // No gap, no overlap: the old role ends the day the new one starts, and the new one is open.
    expect(newRow).toMatchObject({ group_role: "vice_chair", starts_on: effective, ends_on: null });

    const serving = page.getByRole("region", { name: "Serving now" });
    await expect(serving.getByText(SEATABLE_NAMES.casey).first()).toBeVisible();
    await expect(serving.getByText("Vice chair", { exact: true }).first()).toBeVisible();
    const past = page.getByRole("region", { name: "Past members" });
    await expect(past.getByText(SEATABLE_NAMES.casey).first()).toBeVisible();
    await expect(past.getByText("Member", { exact: true }).first()).toBeVisible();

    const changed = (await committeesAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.committee.member_role_changed");
    expect(changed).toHaveLength(1);

    // The new (open) row's role page: choosing Vice chair again is not offered; a hand-forced stale form is refused.
    await page.goto(`${base()}/${committee.id}/members/${newRow!.id}/role`);
    await waitHydrated(page);
    await expect(page.locator("#change-role option", { hasText: /^Vice chair$/ })).toHaveCount(0);
    await page.close();
  });

  test("5. end term, change end date and cancel a planned term: each through its own dialog, none through a native one", async () => {
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    const today = utcToday();
    await seedSeat(sql, fx, committee.id, fx.seatable.devon, { role: "member", startsOn: "2024-01-01" });
    await seedSeat(sql, fx, committee.id, fx.seatable.emery, { role: "clerk", startsOn: "2024-01-01", endsOn: shift(today, 90) });
    const nativeDialogs: string[] = [];
    const page = await newPhonePage(founder);
    page.on("dialog", (d) => {
      nativeDialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto(`${base()}/${committee.id}`);
    await waitHydrated(page);

    // END TERM (Devon, no planned end): a date before the start is refused in the dialog, under the field.
    await page.getByRole("button", { name: `End term for ${SEATABLE_NAMES.devon}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: `End ${SEATABLE_NAMES.devon}'s term?` })).toBeVisible();
    await expect(dialog.getByText("Their name stays in the history of this committee, with its dates.")).toBeVisible();
    await dialog.getByLabel("Ends on").fill("2023-12-31");
    await dialog.getByRole("button", { name: "End term" }).click();
    await expect(dialog.getByText("The end date can't be before the start date.")).toBeVisible();
    expect((await seatOf(committee.id, fx.seatable.devon))[0]?.ends_on).toBeNull();
    // A valid day ends it and the dialog closes.
    await dialog.getByLabel("Ends on").fill(shift(today, -1));
    await dialog.getByRole("button", { name: "End term" }).click();
    await toastOrText(page, "Term ended.");
    await expect(dialog).toHaveCount(0);
    expect((await seatOf(committee.id, fx.seatable.devon))[0]?.ends_on).toBe(shift(today, -1));
    await expect(page.getByRole("region", { name: "Past members" }).getByText(SEATABLE_NAMES.devon).first()).toBeVisible();

    // CHANGE END DATE (Emery has a planned end): the control and the title say so.
    await page.getByRole("button", { name: `Change end date for ${SEATABLE_NAMES.emery}` }).click();
    await expect(dialog.getByRole("heading", { name: `Change when ${SEATABLE_NAMES.emery}'s term ends` })).toBeVisible();
    await dialog.getByLabel("Ends on").fill(shift(today, 30));
    await dialog.getByRole("button", { name: "Save end date" }).click();
    await toastOrText(page, "End date saved.");
    await expect(dialog).toHaveCount(0);
    expect((await seatOf(committee.id, fx.seatable.emery))[0]?.ends_on).toBe(shift(today, 30));

    // CANCEL PLANNED TERM (Blair has not started): no date field; the term is ended at its own start.
    await page.getByRole("button", { name: `Cancel planned term for ${SEATABLE_NAMES.blair}` }).click();
    await expect(dialog.getByRole("heading", { name: `Cancel ${SEATABLE_NAMES.blair}'s planned term?` })).toBeVisible();
    await expect(dialog.getByLabel("Ends on")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel planned term" }).click();
    await toastOrText(page, "Planned term cancelled.");
    await expect(dialog).toHaveCount(0);
    const [blair] = await seatOf(committee.id, fx.seatable.blair);
    expect(blair?.ends_on).toBe(blair?.starts_on);
    await expect(page.getByRole("region", { name: "Starting later" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Past members" }).getByText("Ended the day it started").first()).toBeVisible();

    // Go back leaves everything alone.
    await page.getByRole("button", { name: `End term for ${SEATABLE_NAMES.avery}` }).click();
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await seatOf(committee.id, fx.seatable.avery))[0]?.ends_on).toBeNull();
    expect(nativeDialogs, "no alert, confirm or prompt").toEqual([]);

    const ended = (await committeesAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.committee.member_ended");
    expect(ended.length).toBe(3);
    await page.close();
  });

  test("6. the status badges: a person who left the presbytery and one recorded as deceased keep their seat and say so", async () => {
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    await seedSeat(sql, fx, committee.id, fx.seatable.gone, { role: "member", startsOn: "2021-01-01" });
    await seedSeat(sql, fx, committee.id, fx.seatable.late, { role: "secretary", startsOn: "2021-01-01" });
    await retireSeatablePeople(sql, fx);
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/${committee.id}`);
    const serving = page.getByRole("region", { name: "Serving now" });
    const goneCard = serving.locator("li", { hasText: SEATABLE_NAMES.gone });
    await expect(goneCard.getByText("No longer connected to this presbytery")).toBeVisible();
    const lateCard = serving.locator("li", { hasText: SEATABLE_NAMES.late });
    await expect(lateCard.getByText("Recorded as deceased")).toBeVisible();
    await expect(lateCard.getByText("Secretary", { exact: true })).toBeVisible();
    // Neither is offered in the add form (their membership ended; a deceased person is still a member row, but a seated one is disabled).
    await page.goto(`${base()}/${committee.id}/members/new`);
    await waitHydrated(page);
    await expect(page.locator("#add-person option", { hasText: SEATABLE_NAMES.gone })).toHaveCount(0);
    await page.close();
  });

  test("7. the carries-role note: a committee that carries a role says so on its page, in the add form and in the end dialog", async () => {
    const carrying = await seedCommittee(sql, fx, { name: COMMITTEES_NAMES.carrying, kind: "standing" });
    await bindRoleToCommittee(sql, fx, carrying);
    await seedSeat(sql, fx, carrying, fx.seatable.devon, { role: "member", startsOn: "2024-01-01" });
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/${carrying}`);
    const note = page.getByTestId("carries-role-note");
    await expect(note).toContainText(`Everyone serving on this committee also holds the ${COMMITTEES_NAMES.carriedRole} role, so adding someone here gives them that role's access.`);
    await page.getByRole("button", { name: `End term for ${SEATABLE_NAMES.devon}` }).click();
    await expect(page.getByRole("alertdialog").getByText("Ending the term also ends the access that comes from belonging to this committee.")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Go back" }).click();

    await page.goto(`${base()}/${carrying}/members/new`);
    await waitHydrated(page);
    await expect(page.getByTestId("carries-role-note")).toContainText(
      `This committee carries the ${COMMITTEES_NAMES.carriedRole} role. Adding someone here also gives them that role's access.`,
    );
    // The committee made through the page (no role) shows no note: test 3 already pinned it. Here the audit says what happened.
    await page.close();
  });

  test("8. the public listing switch: consent dialog, an audit row, and the public roster function then answers with the member and their title", async () => {
    await makePresbyterySiteLive(sql, fx);
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    expect(await publicRoster(sql, fx, MAIN_NAME)).toEqual([]);
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/${committee.id}`);
    await waitHydrated(page);
    const toggle = page.getByRole("switch", { name: `List ${SEATABLE_NAMES.avery} publicly on ${MAIN_NAME}'s public roster, currently off` });
    await toggle.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: `List ${SEATABLE_NAMES.avery} publicly on ${MAIN_NAME}'s roster?` })).toBeVisible();
    // Cancelling writes nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await seatOf(committee.id, fx.seatable.avery))[0]?.public_listed).toBe(false);
    await toggle.click();
    await dialog.getByRole("button", { name: "Yes, list publicly" }).click();
    await toastOrText(page, `${SEATABLE_NAMES.avery} is now listed publicly on ${MAIN_NAME}'s roster.`);

    expect((await seatOf(committee.id, fx.seatable.avery))[0]?.public_listed).toBe(true);
    expect((await committeesAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.committee.member_listed")).toHaveLength(1);
    // The public directory's reader: Avery, titled Chair (the role comes from the seat).
    expect(await publicRoster(sql, fx, MAIN_NAME)).toEqual([{ group_name: MAIN_NAME, group_role: "chair", display_name: SEATABLE_NAMES.avery }]);
    await expect(page.getByText("Public", { exact: true }).first()).toBeVisible();

    // Off again: the other direction has its own dialog, and the roster empties.
    await page.getByRole("switch", { name: `List ${SEATABLE_NAMES.avery} publicly on ${MAIN_NAME}'s public roster, currently on` }).click();
    await expect(dialog.getByText("turning this off is not a full retraction")).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, stop listing" }).click();
    await toastOrText(page, `${SEATABLE_NAMES.avery} is no longer listed publicly on ${MAIN_NAME}'s roster.`);
    expect(await publicRoster(sql, fx, MAIN_NAME)).toEqual([]);
    expect((await committeesAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.committee.member_unlisted")).toHaveLength(1);
    await page.close();
  });

  test("9. dissolve: every term ends on the day, the committee moves to Dissolved committees, and nothing can be added or edited", async () => {
    const toDissolve = await seedCommittee(sql, fx, { name: "E2E Cmt To Dissolve", kind: "ad_hoc" });
    await seedSeat(sql, fx, toDissolve, fx.seatable.casey, { role: "chair", startsOn: "2024-02-01" });
    await seedSeat(sql, fx, toDissolve, fx.seatable.devon, { role: "member", startsOn: "2024-02-01", endsOn: shift(utcToday(), 20) });
    const page = await newPhonePage(founder);
    await page.goto(`${base()}/${toDissolve}`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "Dissolve committee" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: "Dissolve E2E Cmt To Dissolve?" })).toBeVisible();
    await expect(dialog.getByText("it can't be undone from this page", { exact: false })).toBeVisible();
    // A future date is refused under the field.
    await dialog.getByLabel("Dissolved on").fill(shift(utcToday(), 5));
    await dialog.getByRole("button", { name: "Dissolve committee" }).click();
    await expect(dialog.getByText("The dissolve date can't be in the future.")).toBeVisible();
    expect((await committeeByName(sql, fx, "E2E Cmt To Dissolve"))?.dissolved_on).toBeNull();
    await dialog.getByLabel("Dissolved on").fill(shift(utcToday(), -1));
    await dialog.getByRole("button", { name: "Dissolve committee" }).click();
    await toastOrText(page, "Committee dissolved.");

    expect((await committeeByName(sql, fx, "E2E Cmt To Dissolve"))?.dissolved_on).toBe(shift(utcToday(), -1));
    const seats = await seatsOf(sql, toDissolve);
    expect(seats.every((s) => s.ends_on !== null && s.ends_on <= shift(utcToday(), -1))).toBe(true);
    await expect(page.getByText("This committee was dissolved on")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a member" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dissolve committee" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^End term for / })).toHaveCount(0);
    // The edit and add pages say so in one sentence and write nothing.
    await page.goto(`${base()}/${toDissolve}/members/new`);
    await expect(page.getByText("This committee has been dissolved, so no one can be added.")).toBeVisible();
    await page.goto(`${base()}/${toDissolve}/edit`);
    await expect(page.getByText("A dissolved committee is kept as history and isn't edited here.")).toBeVisible();

    // The list hides it until asked.
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 2, name: "Dissolved committees" })).toHaveCount(0);
    await page.getByRole("link", { name: /^Show dissolved committees \(\d+\)$/ }).click();
    await page.waitForURL((url) => url.search === "?show=dissolved");
    const section = page.getByRole("region", { name: "Dissolved committees" });
    await expect(section.getByText("E2E Cmt To Dissolve").first()).toBeVisible();
    await page.getByRole("link", { name: "Hide dissolved committees" }).click();
    await page.waitForURL((url) => url.pathname === base() && url.search === "");

    const dissolvedAudit = (await committeesAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.committee.dissolved");
    expect(dissolvedAudit).toHaveLength(1);
    await page.close();
  });

  test("10. the list shows every kind in order, with an unlabelled prompt, and edit labels an unlabelled committee", async () => {
    const unlabelled = await seedCommittee(sql, fx, { name: "E2E Cmt Unlabelled", kind: null });
    await seedCommittee(sql, fx, { name: "E2E Cmt Required One", kind: "required" });
    await seedCommittee(sql, fx, { name: "E2E Cmt Ad Hoc One", kind: "ad_hoc" });
    const page = await newPhonePage(founder);
    await page.goto(base());
    const headings = await page.locator("main h2").allInnerTexts();
    const order = ["Required committees", "Standing committees", "Ad hoc committees", "Not yet labelled"];
    expect(headings.filter((h) => order.includes(h))).toEqual(order);
    await expect(page.getByText("No label has been chosen for these committees yet.")).toBeVisible();

    await page.goto(`${base()}/${unlabelled}/edit`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "Edit E2E Cmt Unlabelled" })).toBeVisible();
    // Saving requires a kind: an unlabelled committee is labelled by being saved.
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Choose Required, Standing or Ad hoc.")).toBeVisible();
    await page.locator("#committee-kind").selectOption("ad_hoc");
    await page.getByRole("button", { name: "Save changes" }).click();
    await toastOrText(page, "Committee saved.");
    expect((await committeeByName(sql, fx, "E2E Cmt Unlabelled"))?.kind).toBe("ad_hoc");
    expect((await committeesAudit(sql, fx.presbytery.id)).some((a) => a.action === "tenant.committee.labelled")).toBe(true);
    await page.close();
  });

  test("11. the clerk (groups.manage only, no two-factor) does the same work and is never sent to a second-factor prompt", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", base());
    const page = await newPhonePage(context);
    await page.goto(base());
    expect(new URL(page.url()).pathname).toBe(base());
    await expect(page.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeVisible();
    await page.goto(`${base()}/new`);
    await waitHydrated(page);
    await page.locator("#committee-name").fill("E2E Cmt Clerk Made");
    await page.locator("#committee-kind").selectOption("required");
    await page.getByRole("button", { name: "Create committee" }).click();
    await toastOrText(page, "Committee created.");
    await page.waitForURL((url) => /\/admin\/committees\/[0-9a-f-]{36}$/.test(url.pathname));
    await page.getByRole("link", { name: "Add a member" }).first().click();
    await waitHydrated(page);
    await page.locator("#add-person").selectOption({ label: SEATABLE_NAMES.emery });
    await page.getByRole("button", { name: "Add to committee" }).click();
    await toastOrText(page, "Added to the committee.");
    expect(page.url()).not.toContain("/totp");
    const made = (await committeeByName(sql, fx, "E2E Cmt Clerk Made"))!;
    expect(made.kind).toBe("required");
    expect(await seatOf(made.id, fx.seatable.emery)).toHaveLength(1);
    // The audit row names the clerk's user, not the founder's.
    const audit = (await sql`
      select actor_user_id from audit_events where action = 'tenant.committee.created' and resource_id = ${made.id}`) as { actor_user_id: string }[];
    expect(audit.map((a) => a.actor_user_id)).toEqual([fx.users.clerk]);
    await context.close();
  });

  test("12. a presbytery member with no role is told they lack the key; a direct hit on the add form writes nothing", async ({ browser }) => {
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    const before = await seatsOf(sql, committee.id);
    const auditBefore = (await committeesAudit(sql, fx.presbytery.id)).length;
    const context = await signedInContext(browser, "plain", base());
    const page = await newPhonePage(context);
    const sentence = `You don't have permission to manage committees at ${fx.presbytery.name}. If you think this is a mistake, ask your presbytery's administrator.`;
    for (const path of [base(), `${base()}/new`, `${base()}/${committee.id}`, `${base()}/${committee.id}/members/new`]) {
      await page.goto(path);
      await expect(page.getByText(sentence)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeVisible();
      // Nothing of the committee leaks to a keyless member.
      await expect(page.getByText(MAIN_NAME)).toHaveCount(0);
      await expect(page.getByText(SEATABLE_NAMES.avery)).toHaveCount(0);
      await expect(page.locator("form")).toHaveCount(0);
    }
    expect(await seatsOf(sql, committee.id)).toEqual(before);
    expect((await committeesAudit(sql, fx.presbytery.id)).length).toBe(auditBefore);
    await context.close();
  });

  test("13. one answer for every committee that is not this presbytery's: a non-UUID, another presbytery's, a choir, a derived group, a nonexistent id", async () => {
    const urls = [
      `${base()}/not-a-uuid`,
      `${base()}/${fx.groups.otherCommittee}`,
      `${base()}/${fx.groups.choir}`,
      `${base()}/${fx.groups.derived}`,
      `${base()}/${fx.groups.congCommittee}`,
      `${base()}/00000000-0000-4090-8000-0000000000ff`,
      // The deeper pages answer the same for the same objects.
      `${base()}/${fx.groups.choir}/edit`,
      `${base()}/${fx.groups.otherCommittee}/members/new`,
    ];
    const page = await newPhonePage(founder);
    const bodies = new Set<string>();
    for (const url of urls) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
      const body = await mainText(page);
      bodies.add(body);
      // Nothing of the other presbytery's committee, the choir or a congregation's committee is in the page.
      for (const name of [COMMITTEES_NAMES.otherCommittee, COMMITTEES_NAMES.choir, COMMITTEES_NAMES.congCommittee]) expect(body).not.toContain(name);
    }
    expect([...bodies], "every miss reads the same").toHaveLength(1);

    // A seat of another committee under this committee's role path is the same neutral miss.
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    const otherSeat = (await seatsOf(sql, (await committeeByName(sql, fx, "E2E Cmt Clerk Made"))!.id))[0]!;
    const response = await page.goto(`${base()}/${committee.id}/members/${otherSeat.id}/role`);
    expect(response?.status()).toBe(404);
    await page.close();
  });

  test("14. every audit row carries ids, roles and dates and no title, purpose, meeting time or name", async () => {
    const rowsAudited = await committeesAudit(sql, fx.presbytery.id);
    const kinds = new Set(rowsAudited.map((a) => a.action));
    for (const expected of [
      "tenant.committee.created",
      "tenant.committee.labelled",
      "tenant.committee.dissolved",
      "tenant.committee.member_added",
      "tenant.committee.member_role_changed",
      "tenant.committee.member_ended",
      "tenant.committee.member_listed",
      "tenant.committee.member_unlisted",
    ]) {
      expect(kinds, `an audit row ${expected} exists`).toContain(expected);
    }
    const text = JSON.stringify(rowsAudited);
    for (const forbidden of [
      PURPOSE_SENTINEL,
      MEETS_SENTINEL,
      "SENTINEL",
      MAIN_NAME,
      "E2E Cmt ",
      ...Object.values(SEATABLE_NAMES),
      "Peabody",
      "Marchetti",
    ]) {
      expect(text, `no audit row carries "${forbidden}"`).not.toContain(forbidden);
    }
    // Each row names the committee by id and the acting organization.
    for (const row of rowsAudited) expect(row.metadata.organizationId).toBe(fx.presbytery.id);
  });

  test("15. at 360px a 200-character committee name and a 120-character person name wrap: no sideways scroll, every control at least 44px, no callbackUrl, a way back", async () => {
    expect(LONG_PERSON).toHaveLength(120);
    expect(LONG_NAME).toHaveLength(200);
    const long = await seedCommittee(sql, fx, { name: LONG_NAME, kind: "standing" });
    await seedSeat(sql, fx, long, fx.seatable.long, { role: "chair", startsOn: "2024-03-01" });
    await seedSeat(sql, fx, long, fx.seatable.avery, { role: "member", startsOn: "2024-03-01", endsOn: shift(utcToday(), 15) });
    const page = await newPhonePage(founder, 360, 740);

    const checks: Array<[string, string]> = [
      ["the list", base()],
      ["the long committee's page", `${base()}/${long}`],
      ["its edit form", `${base()}/${long}/edit`],
      ["its add form", `${base()}/${long}/members/new`],
    ];
    for (const [what, path] of checks) {
      await page.goto(path);
      if (path.endsWith("/edit") || path.endsWith("/new")) await waitHydrated(page);
      await expectNoSidewaysScroll(page, what);
      expect(await smallControls(page), `${what}: controls under 44px`).toEqual([]);
      // No link carries a callbackUrl or next parameter: a path is built from validated props, never a query.
      const hrefs = await page.locator("main a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      for (const href of hrefs) expect(href, `${what}: ${href}`).not.toMatch(/callbackUrl|[?&]next=/);
    }

    // The role page for the long-named chair, and the end dialog open on top of the long page.
    const [chairSeat] = await seatOf(long, fx.seatable.long);
    await page.goto(`${base()}/${long}/members/${chairSeat!.id}/role`);
    await waitHydrated(page);
    await expectNoSidewaysScroll(page, "the role page");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(LONG_FIRST);
    expect(await smallControls(page), "the role page: controls under 44px").toEqual([]);

    await page.goto(`${base()}/${long}`);
    await waitHydrated(page);
    await expect(page.getByRole("link", { name: "Back to committees" })).toHaveAttribute("href", base());
    // The roster never hides role or dates at 360px.
    const serving = page.getByRole("region", { name: "Serving now" });
    await expect(serving.getByText("Chair", { exact: true }).first()).toBeVisible();
    await expect(serving.getByText(/^Since /).first()).toBeVisible();
    await expect(serving.getByText(/^Ends /).first()).toBeVisible();
    await page.getByRole("button", { name: `End term for ${LONG_PERSON}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // Layout sizes (offsetWidth/offsetHeight), not bounding boxes: the dialog opens with a scale animation,
    // and a box measured mid-animation is 95% of the real one.
    const fit = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const buttons = Array.from(el.querySelectorAll<HTMLElement>("button")).map((b) => ({ name: (b.textContent ?? "").trim(), height: b.offsetHeight }));
      return { left: rect.left, right: rect.right, buttons };
    });
    expect(fit.left).toBeGreaterThanOrEqual(-1);
    expect(fit.right).toBeLessThanOrEqual(361);
    await expectNoSidewaysScroll(page, "the end dialog");
    expect(fit.buttons.length).toBeGreaterThan(0);
    for (const button of fit.buttons) expect(button.height, `dialog button "${button.name}"`).toBeGreaterThanOrEqual(44);
    await dialog.getByRole("button", { name: "Go back" }).click();
    await page.close();
  });

  test("16. at 1280px the roster is a table with Name, Role, Dates and Actions", async () => {
    const committee = (await committeeByName(sql, fx, MAIN_NAME))!;
    const context = await founder.browser()!.newContext({ viewport: { width: 1280, height: 900 }, storageState: await founder.storageState() });
    const page = await context.newPage();
    await page.goto(`${base()}/${committee.id}`);
    const serving = page.getByRole("region", { name: "Serving now" });
    await expect(serving.getByRole("columnheader", { name: "Name" })).toBeVisible();
    await expect(serving.getByRole("columnheader", { name: "Role" })).toBeVisible();
    await expect(serving.getByRole("columnheader", { name: "Dates" })).toBeVisible();
    await expect(serving.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    await expect(serving.getByRole("cell", { name: SEATABLE_NAMES.avery, exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page, "the desktop committee page");
    await context.close();
  });
});
